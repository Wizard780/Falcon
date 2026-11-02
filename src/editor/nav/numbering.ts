import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { headAtCursor, levelOf } from './sections';

/**
 * Card numbering, display only: the numbers are drawn next to the tags (and in the outline) and never
 * become text, so they're not in the saved file. What a card carries (a number, a sub-letter, a
 * restart) lives in this plugin's state, keyed by the heading's position and carried along through
 * edits and moves. It isn't saved with the file and isn't part of undo.
 *
 * Counting, like CardMirror: a numbered card counts 1, 2, 3; a sub card counts a, b, c under the
 * last number. Cards with neither are skipped without breaking the run. The count starts over at
 * every pocket, hat and block, unless a block is set to continue from the one above; a card set
 * to restart starts over at itself.
 */
export type Role = 'number' | 'sub';
export type NumMark = { role?: Role; flip?: boolean };
/** `win`: the stretch of the doc (positions) whose cards get drawn numbers; null for all of it. */
type Win = [number, number] | null;
type NumState = { marks: Map<number, NumMark>; decos: DecorationSet; outline: string[]; win: Win };

export const numberingKey = new PluginKey<NumState>('numbering');

/** 1 → a, 26 → z, 27 → aa */
export function letters(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
  return s;
}

/**
 * One pass over the top-level paragraphs: a label per outline row, and the page decorations. When
 * the labels came out the same and `mapped` (the old decorations carried through the edit) is given,
 * that is used instead of building new ones, so typing doesn't redraw every numbered card.
 * Only the cards inside `win` (around what's on screen) are drawn: ProseMirror checks every
 * paragraph against every top-level decoration on each update, so thousands would slow typing.
 */
export function compute(doc: PMNode, marks: Map<number, NumMark>, prev: string[] = [], win: Win = null, mapped?: DecorationSet): NumState {
  if (!marks.size) return { marks, decos: DecorationSet.empty, outline: prev.length ? [] : prev, win };
  const shown = (pos: number) => !win || (pos >= win[0] && pos <= win[1]);
  const decos: Decoration[] = [];
  const outline: string[] = [];
  const used = new Map<number, NumMark>();
  let num = 0, sub = 0;
  doc.forEach((node, pos) => {
    const lv = levelOf(node);
    if (!lv) return;
    const m = marks.get(pos);
    if (m) used.set(pos, m);
    let label = '';
    if (lv <= 2) num = sub = 0;
    else if (lv === 3) {
      if (m?.flip && shown(pos)) decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-num-cont': '' }));
      else num = sub = 0;
    } else {
      if (m?.flip) num = sub = 0;
      if (m?.role === 'number') { num++; sub = 0; label = `${num}.`; }
      else if (m?.role === 'sub') { sub++; label = `${letters(sub)}.`; }
      if (label && shown(pos)) decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-num': label, class: m!.role === 'sub' ? 'f-num-sub' : 'f-num' }));
    }
    outline.push(label);
  });
  // the outline re-renders only when a label actually changed
  const same = outline.length === prev.length && outline.every((l, i) => l === prev[i]);
  // marks whose heading stopped being one are dropped
  const kept = used.size === marks.size ? marks : used;
  return { marks: kept, decos: same && mapped ? mapped : DecorationSet.create(doc, decos), outline: same ? prev : outline, win };
}

/** Carry each mark to where its heading went. A moved heading (cut out and put back in) is the same
 *  node object, so it's found again by identity; a restyled one by its level and text. `shifted`:
 *  every heading simply moved along (nothing was cut out or restyled). */
function remap(marks: Map<number, NumMark>, tr: Transaction, oldDoc: PMNode): { marks: Map<number, NumMark>; shifted: boolean } {
  const out = new Map<number, NumMark>();
  const lost = new Map<PMNode, NumMark>();
  const doc = tr.doc;
  for (const [pos, m] of marks) {
    const r = tr.mapping.mapResult(pos, 1);
    if (!r.deleted) { out.set(r.pos, m); continue; } // the usual case, typing: no lookups
    const old = oldDoc.nodeAt(pos);
    if (!old) continue;
    const node = r.pos < doc.content.size && doc.resolve(r.pos).depth === 0 ? doc.nodeAt(r.pos) : null;
    if (node && levelOf(node) === levelOf(old) && node.textContent === old.textContent) out.set(r.pos, m);
    else lost.set(old, m);
  }
  if (lost.size) doc.forEach((n, p) => { const m = lost.get(n); if (m && !out.has(p)) out.set(p, m); });
  // what's still missing was deleted: remember it by node, so undo brings the number back
  for (const [n, m] of lost) ghosts.set(n, m);
  const revived = revive(tr, out);
  return { marks: out, shifted: out.size === marks.size && !lost.size && !revived };
}

/** Deleted headings, by node: putting the same node back (undo) restores its mark. */
const ghosts = new WeakMap<PMNode, NumMark>();
/** Look for remembered headings among the whole paragraphs this transaction inserted. Cheap: only
 *  the inserted paragraphs are looked at. */
function revive(tr: Transaction, out: Map<number, NumMark>): boolean {
  let found = false;
  tr.steps.forEach((step, i) => {
    if (!(step instanceof ReplaceStep) || step.slice.openStart || !step.slice.content.childCount) return;
    const after = tr.mapping.slice(i + 1);
    step.slice.content.forEach((n, o) => {
      const m = ghosts.get(n);
      if (!m) return;
      const p = after.map(step.from + o, 1);
      if (tr.doc.nodeAt(p) === n && !out.has(p)) { out.set(p, m); found = true; }
    });
  });
  return found;
}

export const numberingPlugin = new Plugin<NumState>({
  key: numberingKey,
  state: {
    init: () => ({ marks: new Map(), decos: DecorationSet.empty, outline: [], win: null }),
    apply(tr, prev, oldState) {
      const meta = tr.getMeta(numberingKey) as Map<number, NumMark> | { win: Win } | undefined;
      const win: Win = prev.win && tr.docChanged ? [tr.mapping.map(prev.win[0]), tr.mapping.map(prev.win[1])] : prev.win;
      if (meta instanceof Map) return compute(tr.doc, meta, prev.outline, win);
      if (meta) return prev.marks.size ? compute(tr.doc, prev.marks, prev.outline, meta.win) : { ...prev, win: meta.win };
      if (!tr.docChanged) return prev;
      if (!prev.marks.size) { const back = new Map<number, NumMark>(); return revive(tr, back) ? compute(tr.doc, back, prev.outline, win) : { ...prev, win }; }
      const { marks, shifted } = remap(prev.marks, tr, oldState.doc);
      // the old decorations still fit when no paragraph was added or removed and every heading only shifted
      const fits = shifted && tr.doc.childCount === oldState.doc.childCount;
      return compute(tr.doc, marks, prev.outline, win, fits ? prev.decos.map(tr.mapping, tr.doc) : undefined);
    },
  },
  props: { decorations: (state) => numberingKey.getState(state)?.decos },
  // keep the drawn stretch around the screen as it scrolls
  view(view) {
    const sc = view.dom.closest('.f-scroll');
    let raf = 0;
    const check = () => {
      raf = 0;
      const st = numberingKey.getState(view.state);
      if (!st?.marks.size || !sc || !view.dom.isConnected) return;
      const r = sc.getBoundingClientRect(), left = view.dom.getBoundingClientRect().left + 4;
      const a = view.posAtCoords({ left, top: r.top + 2 })?.pos ?? 0;
      const b = view.posAtCoords({ left, top: r.bottom - 2 })?.pos ?? view.state.doc.content.size;
      const span = Math.max(b - a, 25000); // positions: a few dozen cards either side
      const w = st.win;
      if (w && a - span / 2 >= w[0] && b + span / 2 <= w[1]) return;
      view.dispatch(view.state.tr.setMeta(numberingKey, { win: [a - 2 * span, b + 2 * span] }).setMeta('addToHistory', false));
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(check); };
    sc?.addEventListener('scroll', soon, { passive: true });
    return {
      update(v, prevState) { if (numberingKey.getState(v.state) !== numberingKey.getState(prevState)) soon(); },
      destroy() { sc?.removeEventListener('scroll', soon); cancelAnimationFrame(raf); },
    };
  },
});

/** The number shown on each outline row (by row index), '' for none. */
export const outlineNumbers = (state: EditorState): string[] => numberingKey.getState(state)?.outline ?? [];
export const numberMarks = (state: EditorState) => numberingKey.getState(state)?.marks ?? new Map<number, NumMark>();

// the outline's multi-selection, when there is one, is what the numbering keys act on
let navScope: () => number[] = () => [];
export function setNavScope(f: () => number[]) { navScope = f; }

/** Headings the numbering commands act on: the outline's selection, else the headings in the
 *  selection, else the card (or block) at the cursor. */
function scope(state: EditorState, want: (level: number) => boolean): number[] {
  const doc = state.doc;
  const ok = (p: number) => { const n = p < doc.content.size ? doc.nodeAt(p) : null; return !!n && doc.resolve(p).depth === 0 && want(levelOf(n)); };
  const nav = navScope().filter(ok);
  if (nav.length) return nav;
  const sel = state.selection;
  if (!sel.empty) {
    const out: number[] = [];
    doc.nodesBetween(sel.from, sel.to, (_n, p) => { if (ok(p)) out.push(p); return false; });
    if (out.length) return out;
  }
  const h = headAtCursor(state);
  return h !== null && ok(h) ? [h] : [];
}

function setMarks(state: EditorState, heads: number[], change: (m: NumMark) => NumMark, dispatch?: (tr: Transaction) => void) {
  if (!heads.length) return false;
  if (dispatch) {
    const marks = new Map(numberMarks(state));
    for (const h of heads) {
      const m = change({ ...marks.get(h) });
      if (m.role || m.flip) marks.set(h, m); else marks.delete(h);
    }
    dispatch(state.tr.setMeta(numberingKey, marks).setMeta('addToHistory', false));
  }
  return true;
}

/** Number (or sub-letter) the cards in scope; if they all have it already, take it off. */
export function toggleRole(role: Role): Command {
  return (state, dispatch) => {
    const heads = scope(state, (l) => l === 4);
    const all = heads.every((h) => numberMarks(state).get(h)?.role === role);
    return setMarks(state, heads, (m) => ({ ...m, role: all ? undefined : role }), dispatch);
  };
}

/** Blocks in scope: continue the count from the block above (or go back to restarting).
 *  Cards: restart the count at this card (or stop). */
export const toggleRestart: Command = (state, dispatch) => {
  const blocks = scope(state, (l) => l === 3);
  const heads = blocks.length ? blocks : scope(state, (l) => l === 4);
  const all = heads.every((h) => numberMarks(state).get(h)?.flip);
  return setMarks(state, heads, (m) => ({ ...m, flip: !all }), dispatch);
};

/** Take every number off this document. */
export const clearNumbering: Command = (state, dispatch) => {
  if (!numberMarks(state).size) return false;
  dispatch?.(state.tr.setMeta(numberingKey, new Map()).setMeta('addToHistory', false));
  return true;
};
