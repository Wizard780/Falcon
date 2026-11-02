import { Fragment, type Mark, type MarkType, type Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { condense, shrink } from '../commands';
import { HIGHLIGHTS, schema } from '../schema';
import { readSetting, type SettingSpec } from '../tools';
import { bodySelection, cardAt, editing, posOf } from './scope';

const M = schema.marks;
const para = (style: string, text: string) => schema.nodes.paragraph.create({ style }, text ? schema.text(text) : null);

/** Run `cmd` on `doc` with `from`..`to` selected, adding its steps to `tr` (so a composed tool is one undo step). */
function replay(cmd: Command, doc: PMNode, from: number, to: number, tr: Transaction) {
  const s = EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
  return cmd(s, (t) => t.steps.forEach((step) => tr.step(step)));
}

export const PAUSE = '[PARAGRAPH INTEGRITY PAUSES]';
export const RESUME = '[PARAGRAPH INTEGRITY RESUMES]';

/**
 * Condense With Warning: merge the body paragraphs the selection touches into one, between plain
 * pause and resume lines, so a reader knows the break was cut. With `andShrink`, the merged text's
 * unread words also shrink (the markers stay full size, so they stay readable).
 */
export function condenseWithWarning(andShrink: boolean): Command {
  return editing((state, dispatch) => {
    const b = bodySelection(state);
    if (!b) return false;
    if (!dispatch) return true;
    const a = posOf(state.doc, b.first), z = posOf(state.doc, b.last + 1);
    const tr = state.tr;
    replay(condense('merge'), state.doc, a + 1, z - 1, tr);
    const from = tr.mapping.map(a), to = tr.mapping.map(z);
    if (andShrink && to - from > 2) replay(shrink, tr.doc, from + 1, to - 1, tr);
    tr.insert(to, para('normal', RESUME)).insert(from, para('normal', PAUSE));
    dispatch(tr);
    return true;
  });
}

export const undertagQuotes: SettingSpec = {
  section: 'Card tools', kind: 'toggle', default: false, key: 'falcon.extractUndertag.quotes',
  label: 'Extract Undertag wraps the text in quotes',
};

/** Extract Undertag: the selected text, on one line, becomes a new undertag under the tag (below any others). */
export const extractUndertag: Command = editing((state, dispatch) => {
  const sel = state.selection;
  if (sel.empty || sel.$from.depth < 1) return false;
  const card = cardAt(state.doc, sel.from);
  if (!card || state.doc.child(card.head).attrs.style !== 'tag' || sel.to > posOf(state.doc, card.end)) return false;
  const raw = state.doc.textBetween(sel.from, sel.to, ' ', ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  if (!dispatch) return true;
  let after = card.head;
  for (let i = card.start; i < card.end; i++) if (state.doc.child(i).attrs.style === 'undertag') after = i;
  const at = posOf(state.doc, after + 1);
  const node = para('undertag', readSetting(undertagQuotes) ? `"${raw}"` : raw);
  const tr = state.tr.insert(at, node);
  dispatch(tr.setSelection(TextSelection.create(tr.doc, at + node.nodeSize - 1)).scrollIntoView());
  return true;
});

/**
 * Alt-Shift-F8, Extract Card: the selected body text, under copies of the card's tag and cite, as a new card
 * right below this one. The source card, the selection and the scroll position all stay as they were.
 */
export const extractCard: Command = editing((state, dispatch) => {
  const b = bodySelection(state);
  if (!b) return false;
  if (!dispatch) return true;
  const { doc, selection: sel } = state;
  const nodes = [doc.child(b.card.head)];
  if (b.card.cite !== null) nodes.push(doc.child(b.card.cite));
  for (let i = b.first; i <= b.last; i++) {
    const p = doc.child(i), start = posOf(doc, i) + 1;
    const cut = p.copy(p.content.cut(Math.max(0, sel.from - start), Math.min(p.content.size, sel.to - start)));
    if (cut.content.size) nodes.push(cut);
  }
  const tr = state.tr.insert(posOf(doc, b.card.end), Fragment.fromArray(nodes));
  dispatch(tr.setSelection(sel.map(tr.doc, tr.mapping)));
  return true;
});

/** Swap one color mark for another over a range, run by run. Null when nothing in the range had `type`. */
function convert(state: EditorState, from: number, to: number, type: MarkType, swap: (m: Mark, marks: readonly Mark[]) => Mark | null) {
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos) => {
    const m = node.isText ? type.isInSet(node.marks) : undefined;
    if (!m) return true;
    const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
    tr.removeMark(a, b, type);
    const next = swap(m, node.marks);
    if (next) tr.addMark(a, b, next);
    return true;
  });
  return tr.docChanged ? tr : null;
}

/** The light gray that locked and referenced highlighting turns into. */
export const LOCKED = '#C0C0C0';

/**
 * Lock Highlighting: highlights become a light-gray background, in place, freeing the highlight layer for a
 * new pass. No selection locks the card at the cursor, never a whole pocket, hat or block. A background
 * already there stays.
 */
export const lockHighlighting: Command = editing((state, dispatch) => {
  let { from, to } = state.selection;
  if (state.selection.empty) {
    const c = cardAt(state.doc, from);
    if (!c) return false;
    from = posOf(state.doc, c.head);
    to = posOf(state.doc, c.end);
  }
  const tr = convert(state, from, to, M.highlight, (_m, marks) => (M.shading.isInSet(marks) ? null : M.shading.create({ color: LOCKED })));
  if (!tr) return false;
  dispatch?.(tr);
  return true;
});

/** Highlight to Background: the selection's highlights become a background of the same color. */
export const highlightToBackground: Command = editing((state, dispatch) => {
  const { from, to, empty } = state.selection;
  const tr = !empty && convert(state, from, to, M.highlight, (m) => M.shading.create({ color: HIGHLIGHTS[m.attrs.color] ?? HIGHLIGHTS.yellow }));
  if (!tr) return false;
  dispatch?.(tr);
  return true;
});

const rgb = (hex: string) => {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? 'D9D9D9';
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
/** The Word highlight color closest to a background color (highlights only come in Word's 15). */
export function nearestHighlight(hex: string): string {
  const [r, g, b] = rgb(hex);
  let best = 'yellow', bestD = Infinity;
  for (const [name, css] of Object.entries(HIGHLIGHTS)) {
    const [r2, g2, b2] = rgb(css);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) { best = name; bestD = d; }
  }
  return best;
}

/** Background to Highlight: the selection's backgrounds become the nearest highlight color. */
export const backgroundToHighlight: Command = editing((state, dispatch) => {
  const { from, to, empty } = state.selection;
  const tr = !empty && convert(state, from, to, M.shading, (m) => M.highlight.create({ color: nearestHighlight(m.attrs.color) }));
  if (!tr) return false;
  dispatch?.(tr);
  return true;
});
