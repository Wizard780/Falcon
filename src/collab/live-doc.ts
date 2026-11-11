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
import { LoroDoc, UndoManager } from 'loro-crdt';
import {
  CursorEphemeralStore, LoroEphemeralCursorPlugin, LoroSyncPlugin, LoroUndoPlugin, createNodeFromLoroObj, loroSyncPluginKey,
  redo, undo, updateLoroToPmState, type LoroDocType,
} from 'loro-prosemirror';
import { Mark, type Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { schema } from '../editor/schema';
import { liveHooks } from '../editor/live-hooks';

export type Peer = { name: string; color: string };
/** One live doc on this peer: the CRDT, its undo stack (this peer's edits only) and everyone's carets. */
export type Binding = {
  doc: LoroDoc; undo: UndoManager; presence: CursorEphemeralStore;
  /** Whether this peer tidies up after remote changes (see guard). One peer does, so two never repair the same thing. */
  fixer: () => boolean;
};

/** Remote carets that stopped moving stay shown this long; leaving the room removes them at once (live.ts). */
const PRESENCE_TIMEOUT = 10 * 60_000;

export function newBinding(doc = new LoroDoc()): Binding {
  // edits close together (typing a word) undo together, as prosemirror-history's 500 ms did
  const undoManager = new UndoManager(doc, { mergeInterval: 500, maxUndoSteps: 200 });
  undoManager.addExcludeOriginPrefix('sys:');
  styleMarks(doc);
  return { doc, undo: undoManager, presence: new CursorEphemeralStore(doc.peerIdStr, PRESENCE_TIMEOUT), fixer: () => true };
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

/** The doc Loro holds now, or null when it holds none yet (nothing synced). */
export function docOf(b: Binding): PMNode | null {
  const root = (b.doc as LoroDocType).getMap('doc');
  if (!root.size) return null;
  const node = createNodeFromLoroObj(schema, root, new Map());
  return node?.type === schema.topNodeType ? node : null;
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
  el.style.setProperty('--peer', user?.color ?? '#888');
  el.title = user?.name ?? 'Someone';
  el.append('⁠');
  return el;
}

/** The state `state` becomes in a live session: same doc and selection, Loro's sync, undo and carets in place of history. */
export function liveState(state: EditorState, b: Binding, me: Peer): EditorState {
  const keep = state.plugins.filter((p) => !isHistory(p) && !isLive(p)).map((p) => guard(p, b));
  return state.reconfigure({
    plugins: [
      ...keep,
      LoroSyncPlugin({ doc: b.doc as LoroDocType }),
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
  return new Plugin({
    key: ATTACHED,
    view(view) {
      let sub: (() => void) | null = null, mapped: unknown = null;
      const grab = () => {
        const s = loroSyncPluginKey.getState(view.state);
        sub = (s?.docSubscription as (() => void) | null | undefined) ?? sub;
        if (s?.docSubscription && s.mapping !== mapped) {
          mapped = s.mapping;
          updateLoroToPmState(b.doc as LoroDocType, s.mapping, view.state);
        }
      };
      return {
        update: grab,
        destroy: () => {
          grab();
          sub?.();
          b.presence.setLocal({}); // not in an editor: no caret to show the others
        },
      };
    },
  });
}

/**
 * The binding answers every remote change by replacing the whole doc with one it rebuilt (unchanged paragraphs are the
 * same objects). Applied as is, that maps every decoration, kept height and caret through a replace of everything. This
 * turns it into a replace of each run of top-level nodes that differs, narrowed again inside it; the doc is the same.
 */
export function narrowLoroReplace(state: EditorState, tr: Transaction): Transaction {
  const meta = tr.getMeta(loroSyncPluginKey) as { type?: string } | undefined;
  if (!meta || (meta.type !== 'non-local-updates' && meta.type !== 'update-state') || tr.steps.length !== 1) return tr;
  const a = state.doc, b = tr.doc;
  const out = state.tr.setMeta(loroSyncPluginKey, meta).setMeta('addToHistory', false);
  try {
    for (const g of gaps(a, b).reverse()) { // from the end, so the positions of earlier ones still hold
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
  return tr;
}

/**
 * The runs of top-level nodes where `b` differs from `a`, as position ranges in each. Unchanged nodes are the very same
 * objects in both, so they anchor the runs: the longest increasing chain found greedily, which is every node when the
 * change is edits in place (a moved card shows as a run deleted in one place and one inserted in another).
 */
function gaps(a: PMNode, b: PMNode) {
  const at = new Map<PMNode, number>(), offA: number[] = [], offB: number[] = [];
  let pos = 0;
  a.forEach((n, _o, i) => { if (!at.has(n)) at.set(n, i); offA.push(pos); pos += n.nodeSize; });
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
