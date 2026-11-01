import type { Node as PMNode } from 'prosemirror-model';
import { LEVEL, type ParaStyle } from './schema';

export type OutlineItem = { pos: number; level: number; text: string; style: ParaStyle; cards: number; hasKids: boolean };

/** Headings in document order, each with the number of cards (tags/analytics) under it. */
export function buildOutline(doc: PMNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  const stack: OutlineItem[] = [];
  doc.forEach((node, pos) => {
    const style = node.attrs.style as ParaStyle;
    const level = LEVEL[style];
    if (!level) return;
    const item: OutlineItem = { pos, level, text: node.textContent.trim(), style, cards: 0, hasKids: false };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
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
export function readWords(doc: PMNode): number {
  let n = 0;
  doc.forEach((para) => {
    const level = LEVEL[para.attrs.style as ParaStyle];
    if (level === 4) { n += count(para.textContent); return; }
    if (level > 0) return;
    let buf = '';
    para.forEach((t) => {
      const read = t.marks.some((m) => m.type.name === 'highlight' || m.type.name === 'cite');
      buf += read ? (t.text ?? '') : ' ';
    });
    n += count(buf);
  });
  return n;
}
const count = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
