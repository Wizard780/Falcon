import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

/** Where a match sits: 0 pocket/hat/block, 1 tag, 2 analytic, 3 undertag, 4 cite line, 5 anything else. */
type Match = { from: number; to: number; cat: number };
/**
 * matches are in document order (for drawing); `order` is the order Enter steps through them, and
 * `index` the place in it. Both orders start at the cursor and wrap; grouped puts headings first,
 * then tags, analytics, undertags, cites, then card text, like CardMirror.
 */
type FindState = { query: string; matches: Match[]; order: number[]; index: number; anchor: number; grouped: boolean; decos: DecorationSet };
type Meta = { query?: string; index?: number; anchor?: number; grouped?: boolean };

export const findKey = new PluginKey<FindState>('find');

// case and curly-vs-straight quotes don't matter
export const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

const CAT: Record<string, number> = { pocket: 0, hat: 0, block: 0, tag: 1, analytic: 2, undertag: 3 };
function category(para: PMNode): number {
  const c = CAT[para.attrs.style as string];
  if (c !== undefined) return c;
  let cite = false;
  para.forEach((n) => { if (!cite && n.marks.some((m) => m.type.name === 'cite')) cite = true; });
  return cite ? 4 : 5;
}

function search(doc: PMNode, query: string): Match[] {
  const q = norm(query);
  if (!q) return [];
  const out: Match[] = [];
  // every paragraph, including the ones in table cells
  doc.descendants((para, pos) => {
    if (!para.isTextblock) return true;
    const offset = pos;
    const text = norm(para.textBetween(0, para.content.size, undefined, '￼'));
    let cat = -1;
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
      if (cat < 0) cat = category(para);
      out.push({ from: offset + 1 + i, to: offset + 1 + i + q.length, cat });
    }
    return false;
  });
  return out;
}

/** Sort key: [category (grouped only), before the cursor?, position]. */
const keyOf = (m: Match, anchor: number, grouped: boolean) => [grouped ? m.cat : 0, m.from >= anchor ? 0 : 1, m.from];
const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function build(doc: PMNode, query: string, index: number, anchor: number, grouped: boolean): FindState {
  const matches = search(doc, query);
  const keys = matches.map((m) => keyOf(m, anchor, grouped));
  const order = matches.map((_, i) => i).sort((a, b) => cmp(keys[a], keys[b]));
  const i = matches.length ? Math.min(Math.max(index, 0), matches.length - 1) : -1;
  const cur = i >= 0 ? order[i] : -1;
  const decos = DecorationSet.create(doc, matches.map((m, k) => Decoration.inline(m.from, m.to, { class: k === cur ? 'f-find f-find-cur' : 'f-find' })));
  return { query, matches, order, index: i, anchor, grouped, decos };
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ query: '', matches: [], order: [], index: -1, anchor: 0, grouped: true, decos: DecorationSet.empty }),
    apply(tr: Transaction, prev: FindState) {
      const meta = tr.getMeta(findKey) as Meta | undefined;
      const anchor = tr.docChanged ? tr.mapping.map(prev.anchor) : prev.anchor;
      if (meta) return build(tr.doc, meta.query ?? prev.query, meta.index ?? prev.index, meta.anchor ?? anchor, meta.grouped ?? prev.grouped);
      if (tr.docChanged && prev.query) return build(tr.doc, prev.query, prev.index, anchor, prev.grouped);
      return prev;
    },
  },
  props: { decorations: (state) => findKey.getState(state)?.decos },
});

/** Set the query and select the first match (the order starts at the cursor). `grouped` keeps the last choice when left out. */
export function setQuery(view: EditorView, query: string, grouped?: boolean) {
  view.dispatch(view.state.tr.setMeta(findKey, { query, index: 0, anchor: view.state.selection.from, grouped }));
  reveal(view);
}

/** Switch between grouped and position order, staying on the same match. */
export function setGrouped(view: EditorView, grouped: boolean) {
  const st = findKey.getState(view.state);
  if (!st || st.grouped === grouped) return;
  const cur = st.matches[st.order[st.index]];
  view.dispatch(view.state.tr.setMeta(findKey, { grouped }));
  const next = findKey.getState(view.state)!;
  if (cur) view.dispatch(view.state.tr.setMeta(findKey, { index: next.order.findIndex((k) => next.matches[k].from === cur.from) }));
}

export function step(view: EditorView, dir: 1 | -1) {
  const st = findKey.getState(view.state);
  if (!st || !st.matches.length) return;
  const n = st.matches.length;
  view.dispatch(view.state.tr.setMeta(findKey, { index: (st.index + dir + n) % n }));
  reveal(view);
}

const current = (st: FindState | undefined) => (st && st.index >= 0 ? st.matches[st.order[st.index]] : undefined);

function reveal(view: EditorView) {
  const m = current(findKey.getState(view.state));
  if (!m) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView());
}

/** Replace the current match and go on to the next one. */
export function replaceOne(view: EditorView, text: string) {
  const st = findKey.getState(view.state);
  const m = current(st);
  if (!st || !m) return;
  const tr = text ? view.state.tr.insertText(text, m.from, m.to) : view.state.tr.delete(m.from, m.to);
  view.dispatch(tr);
  // the next match is the first one past the replacement, in the same order
  const now = findKey.getState(view.state)!;
  const past = keyOf({ ...m, from: m.from + text.length }, now.anchor, now.grouped);
  const i = now.order.findIndex((k) => cmp(keyOf(now.matches[k], now.anchor, now.grouped), past) >= 0);
  view.dispatch(view.state.tr.setMeta(findKey, { index: i < 0 ? 0 : i }));
  reveal(view);
}

/** Replace every match, as one undo step. Returns how many were replaced. */
export function replaceAll(view: EditorView, text: string): number {
  const st = findKey.getState(view.state);
  if (!st || !st.matches.length) return 0;
  const tr = closeHistory(view.state.tr);
  for (const m of [...st.matches].reverse()) {
    if (text) tr.insertText(text, m.from, m.to); else tr.delete(m.from, m.to);
  }
  view.dispatch(tr.scrollIntoView());
  return st.matches.length;
}

export function clearFind(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(findKey, { query: '', index: -1 }));
}

export const findInfo = (state: EditorState) => findKey.getState(state);

/** A key asked for the find bar: with the replace row, or in position order (read once by the bar). */
export let findRequest: { replace?: boolean; byPosition?: boolean } = {};
export function requestFind(req: { replace?: boolean; byPosition?: boolean }) {
  findRequest = req;
  window.dispatchEvent(new CustomEvent('falcon-find'));
}
