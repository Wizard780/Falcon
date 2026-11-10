import type { Node as PMNode } from 'prosemirror-model';
import { levelOf, type ParaStyle } from './schema';
import { norm } from './find';

export type OutlineItem = { pos: number; level: number; text: string; style: ParaStyle; cards: number; hasKids: boolean; key: string };

/**
 * Headings in document order, each with the number of cards (tags/analytics) under it. `key` names the
 * heading by its text and the headings above it (plus a count among same-named siblings), so a fold
 * follows "Answers under Link" and not every "Answers" in the file, and survives typing above it.
 */
export function buildOutline(doc: PMNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  const stack: OutlineItem[] = [];
  const seen: Map<string, number>[] = [new Map()];
  doc.forEach((node, pos) => {
    const style = node.attrs.style as ParaStyle;
    const level = levelOf(node);
    if (!level) return;
    const text = node.textContent.trim();
    while (stack.length && stack[stack.length - 1].level >= level) { stack.pop(); seen.pop(); }
    const parent = stack[stack.length - 1];
    const under = seen[seen.length - 1];
    const name = `${level}:${text}`;
    const n = under.get(name) ?? 0;
    under.set(name, n + 1);
    const item: OutlineItem = { pos, level, text, style, cards: 0, hasKids: false, key: `${parent ? parent.key + '/' : ''}${name}#${n}` };
    seen.push(new Map());
    for (const s of stack) {
      s.hasKids = true;
      if (level === 4) s.cards++;
    }
    stack.push(item);
    items.push(item);
  });
  return items;
}

/** Index of the outline item that contains pos (the last heading at or before it). */
export function currentItem(items: OutlineItem[], pos: number): number {
  let lo = 0, hi = items.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].pos <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Words a reader would say: tags and analytics, cites, and highlighted body text (not pockets/hats/blocks). */
export const readWords = (doc: PMNode): number => { const r = readSplit(doc); return r.cards + r.tags; };

/** The read words split by how fast they're read: highlighted card text, and tags, analytics and cites. */
export type ReadSplit = { cards: number; tags: number };
export function readSplit(doc: PMNode): ReadSplit {
  const r: ReadSplit = { cards: 0, tags: 0 };
  doc.forEach((para) => {
    let s = splits.get(para);
    if (!s) splits.set(para, (s = splitOf(para)));
    r.cards += s.cards;
    r.tags += s.tags;
  });
  return r;
}
/** Each top-level child's share, by node: an edit keeps every paragraph it didn't touch, so a key recounts one, not 15k. */
const splits = new WeakMap<PMNode, ReadSplit>();
function splitOf(para: PMNode): ReadSplit {
  const r: ReadSplit = { cards: 0, tags: 0 };
  const body = (p: PMNode) => { const [all, cites] = bodyWords(p); r.tags += cites; r.cards += all - cites; };
  // a table's highlighted and cited text is read too
  if (!para.isTextblock) { para.descendants((p) => { if (p.isTextblock) body(p); return !p.isTextblock; }); return r; }
  const level = levelOf(para);
  if (level === 4) r.tags += count(para.textContent);
  else if (level === 0) body(para);
  return r;
}
/** [read words, how many of them are cite words] in one body paragraph. */
function bodyWords(para: PMNode): [number, number] {
  let buf = '', cite = '';
  para.forEach((t) => {
    const isCite = t.marks.some((m) => m.type.name === 'cite');
    const read = isCite || t.marks.some((m) => m.type.name === 'highlight');
    buf += read ? (t.text ?? '') : ' ';
    cite += isCite ? (t.text ?? '') : ' ';
  });
  const all = count(buf);
  return [all, Math.min(all, count(cite))];
}
/** Seconds to read `r` at `cardWpm`, with tags, analytics and cites at `tagWpm` (0: the card speed). */
export const readSeconds = (r: ReadSplit, cardWpm: number, tagWpm = 0) => (r.cards / cardWpm + r.tags / (tagWpm || cardWpm)) * 60;
const count = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;

/**
 * Outline search: the rows whose heading text contains the query, limited to one level when `level`
 * isn't 0. With `content`, a heading also matches when text under it does, and the hit goes to the
 * heading of the chosen level that holds it (with no level, the nearest heading). Case and curly
 * quotes don't matter. Row indices, in order.
 */
export function searchOutline(items: OutlineItem[], doc: PMNode, query: string, level: number, content: boolean): number[] {
  const q = norm(query);
  if (!q) return [];
  const hits = new Set<number>();
  items.forEach((it, i) => { if ((!level || it.level === level) && norm(it.text).includes(q)) hits.add(i); });
  if (content) {
    let h = -1;
    const stack: { i: number; lv: number }[] = [];
    doc.forEach((node) => {
      const lv = levelOf(node);
      if (lv) {
        if (++h >= items.length) return;
        while (stack.length && stack[stack.length - 1].lv >= lv) stack.pop();
        stack.push({ i: h, lv });
        if (!level || lv === level) return; // its own text was checked above
      }
      const t = level ? stack.find((s) => s.lv === level)?.i : stack[stack.length - 1]?.i;
      if (t !== undefined && !hits.has(t) && norm(node.textContent).includes(q)) hits.add(t);
    });
  }
  return [...hits].sort((a, b) => a - b);
}
