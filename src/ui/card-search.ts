/** Search cards: finding a card from the index in the opened file. Pure, so it's unit tested. */
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { levelOf } from '../editor/schema';
import { cardAround } from '../editor/commands';

const squash = (s: string) => s.replace(/\s+/g, '');

/**
 * The doc position of the card the index calls the `ordinal`th tag or analytic, with tag text `tag`.
 * The file may have changed since it was indexed: the same tag text nearest that spot wins, then the spot itself.
 */
export function findCard(doc: PMNode, tag: string, ordinal: number): number | null {
  const cards: { pos: number; text: string }[] = [];
  doc.forEach((n, pos) => { if (levelOf(n) === 4) cards.push({ pos, text: squash(n.textContent) }); });
  const want = squash(tag);
  let best = -1;
  // the index keeps only the start of a long tag
  cards.forEach((c, i) => { if (want && c.text.startsWith(want) && (best < 0 || Math.abs(i - ordinal) < Math.abs(best - ordinal))) best = i; });
  if (best < 0 && ordinal < cards.length) best = ordinal;
  return best < 0 ? null : cards[best].pos;
}

/** The whole card at `pos` (tag through the end of its body), as paragraphs to insert elsewhere. */
export function cardContent(doc: PMNode, pos: number): Fragment | null {
  const c = cardAround(doc, pos + 1);
  if (!c) return null;
  const paras: PMNode[] = [];
  for (let i = c.head; i < c.end; i++) paras.push(doc.child(i));
  return Fragment.from(paras);
}

/** The short part of a cite (author and year, before the bracket), for the result row. */
export const shortCite = (cite: string) => cite.split(/\s[[(]/)[0].slice(0, 80);
