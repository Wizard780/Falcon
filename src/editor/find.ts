import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { isReading } from './read';

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

// No character lowercases shorter, so equal lengths mean every character mapped one to one. 'İ' lowercases
// to two; it stays as it is, so offsets into the result are offsets into the text.
const lower = (s: string) => {
  const l = s.toLowerCase();
  return l.length === s.length ? l : s.replace(/./gsu, (c) => (c.toLowerCase().length === c.length ? c.toLowerCase() : c));
};
// case and curly-vs-straight quotes don't matter
export const norm = (s: string) => lower(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

const CAT: Record<string, number> = { pocket: 0, hat: 0, block: 0, tag: 1, analytic: 2, undertag: 3 };
function category(para: PMNode): number {
  const c = CAT[para.attrs.style as string];
  if (c !== undefined) return c;
  let cite = false;
  para.forEach((n) => { if (!cite && n.marks.some((m) => m.type.name === 'cite')) cite = true; });
  return cite ? 4 : 5;
}

/** Each line's matches (offsets into it) and category, by node: lines an edit didn't touch are the same node, so typing searches only the line it is in. */
const searched = new WeakMap<PMNode, { q: string; at: number[]; cat: number }>();

function search(doc: PMNode, query: string): Match[] {
  const q = norm(query);
  if (!q) return [];
  const out: Match[] = [];
  // every paragraph, including the ones in table cells
  doc.descendants((para, pos) => {
    if (!para.isTextblock) return true;
    let hit = searched.get(para);
    if (hit?.q !== q) {
      const text = norm(para.textBetween(0, para.content.size, undefined, '￼'));
      const at: number[] = [];
      for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) at.push(i);
      searched.set(para, (hit = { q, at, cat: category(para) }));
    }
    for (const i of hit.at) out.push({ from: pos + 1 + i, to: pos + 1 + i + q.length, cat: hit.cat });
    return false;
  });
  return out;
}

type Span = { from: number; to: number };
const current = (st: FindState | undefined) => (st && st.index >= 0 ? st.matches[st.order[st.index]] : undefined);

/** Sort key: [category (grouped only), before the cursor?, position]. */
const keyOf = (m: Match, anchor: number, grouped: boolean) => [grouped ? m.cat : 0, m.from >= anchor ? 0 : 1, m.from];
const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The matches sorted by keyOf: they are in document order already, so a bucket per [category, before the cursor?] does it. */
function sortOrder(matches: Match[], anchor: number, grouped: boolean): number[] {
  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  matches.forEach((m, i) => buckets[(grouped ? m.cat : 0) * 2 + (m.from >= anchor ? 0 : 1)].push(i));
  return buckets.flat();
}
const clamp = (index: number, n: number) => (n ? Math.min(Math.max(index, 0), n - 1) : -1);
const deco = (m: Span, cur: boolean) => Decoration.inline(m.from, m.to, { class: cur ? 'f-find f-find-cur' : 'f-find' });

function build(doc: PMNode, query: string, index: number, anchor: number, grouped: boolean): FindState {
  const matches = search(doc, query);
  const order = sortOrder(matches, anchor, grouped);
  const i = clamp(index, matches.length);
  const cur = i >= 0 ? order[i] : -1;
  const decos = DecorationSet.create(doc, matches.map((m, k) => deco(m, k === cur)));
  return { query, matches, order, index: i, anchor, grouped, decos };
}

/** The textblocks an edit touched, whole, in the new doc, in document order. */
function touchedBlocks(tr: Transaction): Span[] {
  const out = new Map<number, Span>();
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_a, _b, from, to) => {
      tr.doc.nodesBetween(rest.map(from, -1), rest.map(to, 1), (n, pos) => {
        if (!n.isTextblock) return true;
        out.set(pos, { from: pos, to: pos + n.nodeSize });
        return false;
      });
    });
  });
  return [...out.values()].sort((x, y) => x.from - y.from);
}

/** Move the current-match highlight from `was` (when a match is still there) to `now`. */
function moveCurrent(decos: DecorationSet, doc: PMNode, was: Span | undefined, now: Match | undefined) {
  const exact = (r: Span | undefined) => (r ? decos.find(r.from, r.to).filter((d) => d.from === r.from && d.to === r.to) : []);
  const old = exact(was).filter((d) => !now || d.from !== now.from || d.to !== now.to);
  return decos.remove([...old, ...exact(now)]).add(doc, [...old.map((d) => deco(d, false)), ...(now ? [deco(now, true)] : [])]);
}

/**
 * Building the highlights costs every match times every paragraph (ProseMirror's DecorationSet.create), too
 * slow to redo per keystroke in a long document. So an edit carries the old highlights over and redoes only
 * the lines it touched, and stepping only moves the current one. Carrying them over costs a pass over the
 * highlighted lines per step, so an edit with many steps (Replace All) builds them afresh instead.
 */
const MAX_PATCH_STEPS = 100;

function patch(prev: FindState, tr: Transaction, index: number, anchor: number, grouped: boolean): FindState {
  let { matches, order, decos } = prev;
  if (tr.docChanged) {
    matches = search(tr.doc, prev.query);
    const blocks = touchedBlocks(tr);
    let k = 0;
    const redrawn = matches.filter((m) => {
      while (k < blocks.length && blocks[k].to <= m.from) k++;
      return k < blocks.length && m.from > blocks[k].from;
    });
    decos = decos.map(tr.mapping, tr.doc);
    decos = decos.remove(blocks.flatMap((r) => decos.find(r.from, r.to))).add(tr.doc, redrawn.map((m) => deco(m, false)));
  }
  if (tr.docChanged || anchor !== prev.anchor || grouped !== prev.grouped) order = sortOrder(matches, anchor, grouped);
  const i = clamp(index, matches.length);
  const was = current(prev);
  const mapped = was && { from: tr.mapping.map(was.from, 1), to: tr.mapping.map(was.to, -1) };
  decos = moveCurrent(decos, tr.doc, mapped, i >= 0 ? matches[order[i]] : undefined);
  return { query: prev.query, matches, order, index: i, anchor, grouped, decos };
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ query: '', matches: [], order: [], index: -1, anchor: 0, grouped: true, decos: DecorationSet.empty }),
    apply(tr: Transaction, prev: FindState) {
      const meta = tr.getMeta(findKey) as Meta | undefined;
      const query = meta?.query ?? prev.query;
      if (!meta && !(tr.docChanged && query)) return prev;
      const anchor = meta?.anchor ?? (tr.docChanged ? tr.mapping.map(prev.anchor) : prev.anchor);
      const index = meta?.index ?? prev.index, grouped = meta?.grouped ?? prev.grouped;
      if (query !== prev.query || !query || tr.steps.length > MAX_PATCH_STEPS) return build(tr.doc, query, index, anchor, grouped);
      return patch(prev, tr, index, anchor, grouped);
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

function reveal(view: EditorView) {
  const m = current(findKey.getState(view.state));
  if (!m) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView());
  // ProseMirror skips scrollIntoView while the DOM selection is outside the editor (the caret in the find box)
  const sc = view.dom.closest('.f-scroll') as HTMLElement | null;
  if (!sc || view.hasFocus()) return;
  // off-screen paragraphs have estimated heights: re-aim until the match holds still
  for (let i = 0; i < 4; i++) {
    const r = view.coordsAtPos(m.from), box = sc.getBoundingClientRect();
    if (r.top >= box.top && r.bottom <= box.bottom) return;
    sc.scrollTop += r.top - (box.top + box.height / 3);
  }
}

/** Replace the current match and go on to the next one. False if an AI edit's lock refused the change. */
export function replaceOne(view: EditorView, text: string): boolean {
  const st = findKey.getState(view.state);
  const m = current(st);
  if (!st || !m || isReading(view.state)) return true;
  const tr = text ? view.state.tr.insertText(text, m.from, m.to) : view.state.tr.delete(m.from, m.to);
  const before = view.state.doc;
  view.dispatch(tr);
  if (view.state.doc === before) return false;
  // the next match is the first one past the replacement, in the same order
  const now = findKey.getState(view.state)!;
  const past = keyOf({ ...m, from: m.from + text.length }, now.anchor, now.grouped);
  const i = now.order.findIndex((k) => cmp(keyOf(now.matches[k], now.anchor, now.grouped), past) >= 0);
  view.dispatch(view.state.tr.setMeta(findKey, { index: i < 0 ? 0 : i }));
  reveal(view);
  return true;
}

/** Replace every match, as one undo step. Returns how many were replaced, or -1 if an AI edit's lock refused the change. */
export function replaceAll(view: EditorView, text: string): number {
  const st = findKey.getState(view.state);
  if (!st || !st.matches.length || isReading(view.state)) return 0;
  const tr = closeHistory(view.state.tr);
  for (const m of [...st.matches].reverse()) {
    if (text) tr.insertText(text, m.from, m.to); else tr.delete(m.from, m.to);
  }
  const before = view.state.doc;
  view.dispatch(tr.scrollIntoView());
  return view.state.doc === before ? -1 : st.matches.length;
}

export function clearFind(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(findKey, { query: '', index: -1 }));
}

export const findInfo = (state: EditorState) => findKey.getState(state);

/** A key asked for the find bar: with the replace row, or in position order (read once by the bar). */
export let findRequest: { replace?: boolean; byPosition?: boolean } = {};
export function requestFind(req: { replace?: boolean; byPosition?: boolean }) {
  findRequest = { ...req }; // the bar wipes it once read, and a key's request is used again
  window.dispatchEvent(new CustomEvent('falcon-find'));
}
