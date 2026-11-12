/**
 * Live co-editing, the document half: one ProseMirror doc bound to a Loro CRDT doc through loro-prosemirror
 * (both MIT). This file knows nothing about sockets or keys; live.ts carries the Loro updates between peers.
 *
 * What it adds around the binding:
 * - the host's doc goes into Loro before the binding sees it (the binding empties an editor whose Loro doc is empty),
 *   and a joiner's editor is built from Loro after the first sync, never before (two peers each making the root would fight);
 * - prosemirror-history comes out of a live doc: it would undo other people's edits. Mod-Z goes to Loro's UndoManager,
 *   which only undoes this peer's own changes (editor/undo.ts routes it);
 * - two marks that exclude each other (underline and emphasis, sup and sub) can both land on the same text when two
 *   people format it at once. Every peer settles that the same way (the later mark in the schema stays), so they agree;
 * - the binding stops listening while its doc is out of the editor (another tab is showing): it would write that doc
 *   into whatever the editor holds now. Shown again, it rebuilds from Loro, so nothing that came in meanwhile is lost.
 */
import { LoroDoc, UndoManager, type Container, type LoroEventBatch } from 'loro-crdt';
import {
  CursorEphemeralStore, LoroEphemeralCursorPlugin, LoroSyncPlugin, LoroUndoPlugin, createNodeFromLoroObj, loroSyncPluginKey,
  redo, undo, updateLoroToPmState, type LoroDocType, type LoroNodeMapping,
} from 'loro-prosemirror';
import { Fragment, Mark, Slice, type Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { EditorState, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { PARA_STYLES, schema } from '../editor/schema';
import { liveHooks } from '../editor/live-hooks';

export type Peer = { name: string; color: string };
/** One live doc on this peer: the CRDT, its undo stack (this peer's edits only) and everyone's carets. */
export type Binding = {
  doc: LoroDoc; undo: UndoManager; presence: CursorEphemeralStore;
  /** Whether this peer tidies up after remote changes (see guard). One peer does, so two never repair the same thing. */
  fixer: () => boolean;
  /**
   * Told when the doc goes into an editor (true) and out of one (false, with its state as it left). While it's out, whoever
   * set this keeps the tab's stored state up to date with remote changes (applyRemote), so edits to it are let through.
   */
  shown?: (shown: boolean, last: EditorState | null) => void;
};

/** Remote carets that stopped moving stay shown this long; leaving the room removes them at once (live.ts). */
const PRESENCE_TIMEOUT = 10 * 60_000;

/**
 * The binding's caret store, minus one slip: when the text under someone else's caret is deleted, the binding's
 * cursor plugin writes that caret's new place into this peer's own state (the next frame would show my caret at theirs).
 * Only this peer's own caret, which the plugin sets with the `me` it was given, goes in.
 */
class Cursors extends CursorEphemeralStore {
  mine?: Peer;
  setLocal(s: Parameters<CursorEphemeralStore['setLocal']>[0]) {
    if ((s.anchor || s.focus) && s.user !== this.mine) return;
    super.setLocal(s);
  }
}

export function newBinding(doc = new LoroDoc()): Binding {
  // edits close together (typing a word) undo together, as prosemirror-history's 500 ms did
  const undoManager = new UndoManager(doc, { mergeInterval: 500, maxUndoSteps: 200 });
  undoManager.addExcludeOriginPrefix('sys:');
  styleMarks(doc);
  return { doc, undo: undoManager, presence: new Cursors(doc.peerIdStr, PRESENCE_TIMEOUT), fixer: () => true };
}

/**
 * How each mark grows when text is typed at its edge, which Loro must know before the first mark goes in (the binding
 * only sets it once an editor starts). The binding's own rule: inclusive marks grow at their end, the rest don't.
 */
function styleMarks(doc: LoroDoc) {
  doc.configTextStyle(Object.fromEntries(Object.entries(schema.marks).map(([name, t]) => [name, { expand: t.spec.inclusive !== false ? 'after' : 'none' }])));
}

/** Put the host's doc into an empty Loro doc. The commit is marked sys:init, so it isn't an undo step. */
export function seed(b: Binding, doc: PMNode) {
  updateLoroToPmState(b.doc as LoroDocType, new Map(), EditorState.create({ schema, doc }));
}

/** The doc Loro holds now (repaired: see repairDoc), or null when it holds none yet (nothing synced). */
export function docOf(b: Binding): PMNode | null {
  const root = (b.doc as LoroDocType).getMap('doc');
  if (!root.size) return null;
  const node = createNodeFromLoroObj(schema, root, new Map());
  return node?.type === schema.topNodeType ? repairDoc(node) : null;
}

/**
 * A doc built from Loro, made into one Falcon can lay out. Loro holds whatever the other people's Falcons put there, and a
 * modified one could put anything: a table cell spanning a billion columns, content a node can't hold, a paragraph style
 * that doesn't exist. Inline styles are safe whatever the attrs (the schema checks them as it draws). What's repaired
 * goes back into Loro as an edit, so everyone ends up with the same repaired doc. Nodes in `known` (the editor's own,
 * unchanged) are skipped, so a remote change costs a pass over what it touched.
 */
let repaired = false; // repairDoc changed something since the last remote change began (see wroteBack)
export function repairDoc(doc: PMNode, known?: Map<PMNode, number>): PMNode {
  const kids: PMNode[] = [];
  let changed = false;
  doc.forEach((c) => {
    const r = known?.has(c) ? c : c.isInline ? schema.nodes.paragraph.create(null, c.isText ? c : null) : repair(c);
    if (r !== c) changed = true;
    kids.push(r);
  });
  if (!kids.length) { kids.push(schema.nodes.paragraph.create()); changed = true; }
  if (changed) repaired = true;
  return changed ? schema.topNodeType.create(doc.attrs, kids) : doc;
}
const MAX_SPAN = 63;
const spanOf = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_SPAN ? (v as number) : 1);
function repair(n: PMNode): PMNode {
  if (n.isLeaf) return n;
  let kids: PMNode[] | null = null;
  n.forEach((c, _o, i) => {
    const r = repair(c);
    if (r !== c && !kids) { kids = []; n.forEach((x, _p, j) => { if (j < i) kids!.push(x); }); }
    kids?.push(r);
  });
  let attrs = n.attrs;
  const role = n.type.spec.tableRole;
  if (role === 'cell' || role === 'header_cell') {
    const cw = n.attrs.colwidth, colspan = spanOf(n.attrs.colspan), rowspan = spanOf(n.attrs.rowspan);
    const colwidth = Array.isArray(cw) && cw.length === colspan && cw.every((x) => typeof x === 'number' && x >= 0 && x < 1e5) ? cw : null;
    if (colspan !== n.attrs.colspan || rowspan !== n.attrs.rowspan || colwidth !== cw) attrs = { ...attrs, colspan, rowspan, colwidth };
  } else if (n.type === schema.nodes.paragraph) {
    const style = (PARA_STYLES as readonly unknown[]).includes(n.attrs.style) ? n.attrs.style : 'normal';
    const indent = Number.isInteger(n.attrs.indent) && n.attrs.indent >= 0 && n.attrs.indent <= 8 ? n.attrs.indent : 0;
    if (style !== n.attrs.style || indent !== n.attrs.indent) attrs = { ...attrs, style, indent };
  }
  const content = kids ? Fragment.fromArray(kids) : n.content;
  if (attrs === n.attrs && content === n.content && n.type.validContent(content)) return n;
  if (n.type.validContent(content)) return n.type.create(attrs, content, n.marks);
  // content this node can't hold: what's missing is filled in (a cell with no paragraph gets one), else it becomes its text
  return n.type.createAndFill(attrs, content, n.marks) ?? n.type.createAndFill(attrs) ?? schema.nodes.paragraph.create(null, n.textContent ? schema.text(n.textContent) : null);
}

const isHistory = (p: Plugin) => (p as unknown as { key: string }).key.startsWith('history$');
const isLive = (p: Plugin) => LIVE_KEYS.some((k) => (p as unknown as { key: string }).key.startsWith(k));
const LIVE_KEYS = ['loro-sync$', 'loro-undo$', 'loro-ephemeral-cursor$', 'falcon-live$', 'falcon-live-settle$'];
const SETTLE = new PluginKey('falcon-live-settle'), ATTACHED = new PluginKey('falcon-live');

/** A remote caret: a thin bar in their color, their name on hover. No label riding along the text. */
function caret(b: Binding, peer: string) {
  const user = b.presence.getAll()[peer as `${number}`]?.user;
  const el = document.createElement('span');
  el.className = 'f-peer';
  el.style.setProperty('--peer', /^#[0-9a-f]{6}$/i.test(String(user?.color)) ? user!.color : '#888'); // their Falcon says it: only a plain color goes in
  el.title = user?.name ?? 'Someone';
  el.append('⁠');
  return el;
}

/** The state `state` becomes in a live session: same doc and selection, Loro's sync, undo and carets in place of history. */
export function liveState(state: EditorState, b: Binding, me: Peer): EditorState {
  (b.presence as Cursors).mine = me;
  const keep = state.plugins.filter((p) => !isHistory(p) && !isLive(p)).map((p) => guard(p, b));
  // The binding's node map, filled for this doc now. The carets plugin reads it as soon as the state exists, before the
  // binding attaches: with it empty, each other person's caret (a joiner always has the host's) logged the whole doc
  // as JSON once per paragraph, and a 4,800-paragraph join froze the page for over a minute. Equal docs: nothing is written.
  const mapping: LoroNodeMapping = new Map();
  updateLoroToPmState(b.doc as LoroDocType, mapping, state);
  return state.reconfigure({
    plugins: [
      ...keep,
      LoroSyncPlugin({ doc: b.doc as LoroDocType, mapping }),
      LoroUndoPlugin({ doc: b.doc, undoManager: b.undo }),
      LoroEphemeralCursorPlugin(b.presence, { user: me, createCursor: (peer) => caret(b, peer), createSelection: () => ({ class: 'f-peer-sel' }) }),
      settle,
      attached(b),
    ],
  });
}

/** Back to a plain doc: the live plugins out, `plugins` (what the doc had before, history included, empty) back in. */
export function localState(state: EditorState, plugins: readonly Plugin[]): EditorState {
  return state.reconfigure({ plugins: [...plugins] });
}

/**
 * Falcon's plugins that tidy the doc after a change (fixTables squaring up a table, the line kept after a table, gap
 * bridging) would each run on every peer for the same remote change, and their fixes would add up: two peers each
 * adding the missing cell to a ragged row makes it too long, and so on. On a remote change only the fixer runs them.
 */
function guard(p: Plugin, b: Binding): Plugin {
  const append = p.spec.appendTransaction;
  if (!append) return p;
  return new Plugin({
    ...p.spec,
    appendTransaction: (trs, old, state) => (!b.fixer() && trs.some(remote) ? null : append.call(p, trs, old, state)),
  });
}
const remote = (tr: Transaction) => { const t = (tr.getMeta(loroSyncPluginKey) as { type?: string } | undefined)?.type; return t === 'non-local-updates' || t === 'update-state'; };

export const isLiveState = (state: EditorState) => !!loroSyncPluginKey.getState(state);

/**
 * Settle marks that exclude each other on text a remote change touched. The rule only reads the doc, so every peer
 * that sees the same merged doc removes the same mark, and their removals agree.
 */
const settle = new Plugin({
  key: SETTLE,
  appendTransaction(trs, _old, state) {
    if (!trs.some(remote)) return null;
    let tr: Transaction | null = null;
    for (const [from, to] of touched(trs, state.doc)) {
      state.doc.nodesBetween(from, to, (n, pos) => {
        if (!n.isText || n.marks.length < 2) return;
        let ok = Mark.none;
        for (const m of n.marks) ok = m.addToSet(ok);
        if (Mark.sameSet(ok, n.marks)) return;
        tr ??= state.tr;
        for (const m of n.marks) if (!m.isInSet(ok)) tr.removeMark(pos, pos + n.nodeSize, m);
      });
    }
    return tr;
  },
});

/** The ranges of `doc` that the transactions changed. */
function touched(trs: readonly Transaction[], doc: PMNode): [number, number][] {
  const out: [number, number][] = [];
  trs.forEach((tr, i) => tr.mapping.maps.forEach((map, j) => map.forEach((_a, _b, from, to) => {
    let f = from, t = to;
    for (let k = j + 1; k < tr.mapping.maps.length; k++) { f = tr.mapping.maps[k].map(f, -1); t = tr.mapping.maps[k].map(t, 1); }
    for (const later of trs.slice(i + 1)) { f = later.mapping.map(f, -1); t = later.mapping.map(t, 1); }
    out.push([Math.max(0, f), Math.min(doc.content.size, t)]);
  })));
  return out;
}

/**
 * Keeps the binding's Loro subscription only while its doc is in an editor. Plugin views are made when a state goes
 * into a view and destroyed when it leaves (a tab switch swaps states), so that is where to let go.
 *
 * Also, once the binding has attached: it builds a copy of every node from Loro and maps containers to those, while
 * the editor keeps its own (narrowLoroReplace finds them equal). Until the map points at the editor's nodes, nothing is
 * the same object, so each remote change looks like it touched everything (fixTables alone re-walks the whole doc).
 * One pass over the doc points it back; the docs are equal, so nothing is written to Loro.
 */
function attached(b: Binding) {
  // Whether this doc is as Loro has it, so an edit to it is safe to write into Loro. In an editor, not until the binding
  // has rebuilt it from Loro after the doc went in: until then it can be the one its tab held when it was put away,
  // without what came in since, and writing that would take out paragraphs others added (a timeout of 0, so nothing a
  // person types). Out of an editor, only while the session keeps the tab's state up to date (Binding.shown).
  let ready = false;
  return new Plugin({
    key: ATTACHED,
    filterTransaction: (tr) => ready || !tr.docChanged || !!tr.getMeta(loroSyncPluginKey),
    view(view) {
      ready = false;
      // the binding's attach gives it a new node map: until then the state's map is the stale one it came in with
      let mapped: unknown = loroSyncPluginKey.getState(view.state)?.mapping, sub: (() => void) | null = null, last = view.state;
      return {
        update: () => {
          last = view.state;
          const s = loroSyncPluginKey.getState(view.state);
          if (!s || s.doc !== b.doc || s.mapping === mapped) return;
          mapped = s.mapping;
          // the binding's own listener goes, and Falcon's takes its place (listen, below)
          (s.docSubscription as (() => void) | null | undefined)?.();
          sub?.();
          sub = listen(view, b);
          ready = true;
          updateLoroToPmState(b.doc as LoroDocType, s.mapping, view.state);
          b.shown?.(true, null);
        },
        // view.state is the incoming doc by now: everything here comes from what update saw
        destroy: () => {
          sub?.();
          sub = null;
          b.presence.setLocal({}); // not in an editor: no caret to show the others
          b.shown?.(false, last);
          ready = !!b.shown;
        },
      };
    },
  });
}

/** The replace that brings `state` up to Loro after a change that came in (or an undo), or null for one that didn't. */
function remoteTr(state: EditorState, b: Binding, event: LoroEventBatch): Transaction | null {
  if (event.by === 'local' && event.origin !== 'undo') return null;
  const s = loroSyncPluginKey.getState(state);
  if (!s || s.doc !== b.doc) return null;
  for (const e of event.events) {
    for (let c: Container | undefined = b.doc.getContainerById(e.target); c; c = c.parent()) s.mapping.delete(c.id);
  }
  const node = createNodeFromLoroObj(state.schema, (b.doc as LoroDocType).getMap('doc'), s.mapping);
  return state.tr.replace(0, state.doc.content.size, new Slice(Fragment.from(node), 0, 0)).setMeta(loroSyncPluginKey, { type: 'non-local-updates' });
}

/** A put-away tab's state brought up to Loro after a remote change (see Binding.shown), or null when nothing changed. */
export function applyRemote(state: EditorState, b: Binding, event: LoroEventBatch): EditorState | null {
  const tr = remoteTr(state, b, event);
  if (!tr) return null;
  repaired = false;
  const next = state.apply(narrowLoroReplace(state, tr));
  wroteBack(next, b);
  return next;
}

/**
 * Remote changes (and undo) into the editor, in the binding's place. It does what the binding's listener does (forget
 * the changed containers' nodes, rebuild the doc from Loro, replace it, which narrowLoroReplace narrows) but leaves the
 * caret to ProseMirror. The binding then also puts the caret back from Loro cursors, which it works out from the old
 * positions in the doc against Loro's text as the change has already left it: text typed ahead of the caret in the same
 * paragraph moved the caret a character or more off, so the next key landed early. Narrowed, ProseMirror maps the caret
 * through the change itself. (Undo still puts it back from the cursors the binding kept when the edit was made.)
 */
function listen(view: EditorView, b: Binding): () => void {
  return b.doc.subscribe((event) => {
    if (view.isDestroyed) return;
    const tr = remoteTr(view.state, b, event);
    if (!tr) return;
    repaired = false;
    view.dispatch(tr);
    wroteBack(view.state, b);
  });
}

/**
 * A repair the editor made to what came in goes back into Loro, so everyone (and anyone joining) gets it. When the
 * repaired doc differs from what the editor showed, the binding writes it anyway; when it's the same (a bad value set
 * over a good one), nothing else would. Every peer writes the same values, so they agree.
 */
function wroteBack(state: EditorState, b: Binding) {
  if (!repaired) return;
  repaired = false;
  const s = loroSyncPluginKey.getState(state);
  if (s) updateLoroToPmState(b.doc as LoroDocType, s.mapping, state);
}

/**
 * The binding answers every remote change by replacing the whole doc with one it rebuilt (unchanged paragraphs are the
 * same objects). Applied as is, that maps every decoration, kept height and caret through a replace of everything. This
 * turns it into a replace of each run of top-level nodes that differs, narrowed again inside it; the doc is the same.
 */
export function narrowLoroReplace(state: EditorState, tr: Transaction): Transaction {
  const meta = tr.getMeta(loroSyncPluginKey) as { type?: string } | undefined;
  if (!meta || (meta.type !== 'non-local-updates' && meta.type !== 'update-state') || tr.steps.length !== 1) return tr;
  const a = state.doc;
  const known = new Map<PMNode, number>();
  a.forEach((n, _o, i) => { if (!known.has(n)) known.set(n, i); });
  const b = repairDoc(tr.doc, known); // what came from Loro, made layable: the editor's own nodes are skipped
  const out = state.tr.setMeta(loroSyncPluginKey, meta).setMeta('addToHistory', false);
  try {
    for (const g of gaps(a, b, known).reverse()) { // from the end, so the positions of earlier ones still hold
      const fa = a.content.cut(g.a0, g.a1), fb = b.content.cut(g.b0, g.b1);
      const startA = fa.findDiffStart(fb, g.a0);
      if (startA === null) continue;
      const startB = startA - g.a0 + g.b0;
      let { a: endA, b: endB } = fa.findDiffEnd(fb, g.a1, g.b1)!;
      const overlap = Math.max(0, startA - endA, startB - endB);
      endA += overlap; endB += overlap;
      out.replace(startA, endA, b.slice(startB, endB));
    }
    if (out.doc.eq(b)) return out;
  } catch { /* fall through */ }
  return state.tr.replace(0, a.content.size, new Slice(b.content, 0, 0)).setMeta(loroSyncPluginKey, meta).setMeta('addToHistory', false);
}

/**
 * The runs of top-level nodes where `b` differs from `a`, as position ranges in each. Unchanged nodes are the very same
 * objects in both, so they anchor the runs: the longest increasing chain found greedily, which is every node when the
 * change is edits in place (a moved card shows as a run deleted in one place and one inserted in another).
 */
function gaps(a: PMNode, b: PMNode, at: Map<PMNode, number>) {
  const offA: number[] = [], offB: number[] = [];
  let pos = 0;
  a.forEach((n) => { offA.push(pos); pos += n.nodeSize; });
  offA.push(pos);
  pos = 0;
  b.forEach((n) => { offB.push(pos); pos += n.nodeSize; });
  offB.push(pos);
  const out: { a0: number; a1: number; b0: number; b1: number }[] = [];
  let i = 0, j = 0; // the next unmatched node in each
  b.forEach((n, _o, jj) => {
    const ii = at.get(n);
    if (ii === undefined || ii < i) return;
    if (ii > i || jj > j) out.push({ a0: offA[i], a1: offA[ii], b0: offB[j], b1: offB[jj] });
    i = ii + 1; j = jj + 1;
  });
  if (i < a.childCount || j < b.childCount) out.push({ a0: offA[i], a1: offA[a.childCount], b0: offB[j], b1: offB[b.childCount] });
  return out;
}

Object.assign(liveHooks, { undo, redo, narrow: narrowLoroReplace });
