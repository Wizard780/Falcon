import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from 'prosemirror-state';
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
type NumState = { marks: Map<number, NumMark>; decos: DecorationSet; outline: string[] };

export const numberingKey = new PluginKey<NumState>('numbering');

/** 1 → a, 26 → z, 27 → aa */
export function letters(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
  return s;
}

/** One pass over the top-level paragraphs: page decorations, and a label per outline row. */
export function compute(doc: PMNode, marks: Map<number, NumMark>, prev: string[] = []): NumState {
  if (!marks.size) return { marks, decos: DecorationSet.empty, outline: prev.length ? [] : prev };
  const decos: Decoration[] = [];
  const outline: string[] = [];
  let num = 0, sub = 0;
  doc.forEach((node, pos) => {
    const lv = levelOf(node);
    if (!lv) return;
    const m = marks.get(pos);
    let label = '';
    if (lv <= 2) num = sub = 0;
    else if (lv === 3) {
      if (m?.flip) decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-num-cont': '' }));
      else num = sub = 0;
    } else {
      if (m?.flip) num = sub = 0;
      if (m?.role === 'number') { num++; sub = 0; label = `${num}.`; }
      else if (m?.role === 'sub') { sub++; label = `${letters(sub)}.`; }
      if (label) decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-num': label, class: m!.role === 'sub' ? 'f-num-sub' : 'f-num' }));
    }
    outline.push(label);
  });
  // the outline re-renders only when a label actually changed
  const same = outline.length === prev.length && outline.every((l, i) => l === prev[i]);
  return { marks, decos: DecorationSet.create(doc, decos), outline: same ? prev : outline };
}

/** Carry each mark to where its heading went. A moved heading (cut out and put back in) is the same
 *  node object, so it's found again by identity; a restyled one by its level and text. */
function remap(marks: Map<number, NumMark>, tr: Transaction, oldDoc: PMNode): Map<number, NumMark> {
  const out = new Map<number, NumMark>();
  const lost = new Map<PMNode, NumMark>();
  const doc = tr.doc;
  const top = (p: number) => p < doc.content.size && doc.resolve(p).depth === 0;
  for (const [pos, m] of marks) {
    const old = oldDoc.nodeAt(pos);
    if (!old) continue;
    const r = tr.mapping.mapResult(pos, 1);
    const node = top(r.pos) ? doc.nodeAt(r.pos) : null;
    if (node && (r.deleted ? levelOf(node) === levelOf(old) && node.textContent === old.textContent : levelOf(node) >= 3)) out.set(r.pos, m);
    else lost.set(old, m);
  }
  if (lost.size) doc.forEach((n, p) => { const m = lost.get(n); if (m && !out.has(p)) out.set(p, m); });
  return out;
}

export const numberingPlugin = new Plugin<NumState>({
  key: numberingKey,
  state: {
    init: () => ({ marks: new Map(), decos: DecorationSet.empty, outline: [] }),
    apply(tr, prev, oldState) {
      const meta = tr.getMeta(numberingKey) as Map<number, NumMark> | undefined;
      if (!meta && !(tr.docChanged && prev.marks.size)) return prev;
      const marks = meta ?? remap(prev.marks, tr, oldState.doc);
      return compute(tr.doc, marks, prev.outline);
    },
  },
  props: { decorations: (state) => numberingKey.getState(state)?.decos },
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
