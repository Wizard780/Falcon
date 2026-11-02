import type { Node as PMNode } from 'prosemirror-model';
import { LEVEL, levelOf, schema, type ParaStyle } from './schema';
import { isMarker, readView } from './read';

/** The four ways Save As can write the doc. Only As-Is is the document itself; the rest are copies. */
export type SaveMode = 'asis' | 'send' | 'read' | 'marked';

const level = levelOf;
const docOf = (paras: PMNode[]) => (paras.length ? schema.node('doc', null, paras) : null);

/** Send Doc: the file for the other team, without analytics (and any text under them) and undertags. */
export function sendDoc(doc: PMNode): PMNode | null {
  const keep: PMNode[] = [];
  let inAnalytic = false;
  doc.forEach((p) => {
    if (level(p) > 0) inAnalytic = p.attrs.style === 'analytic';
    if (!inAnalytic && p.attrs.style !== 'undertag') keep.push(p);
  });
  return docOf(keep);
}

/**
 * Read Doc: what read mode shows, as a file. Headings stay whole; in cards only the shown runs stay,
 * with one space where hidden text sat between two of them, and the body paragraphs that flow together
 * in read mode become one paragraph under the cite.
 */
export function readDoc(doc: PMNode): PMNode | null {
  const view = readView(doc);
  const keep: PMNode[] = [];
  // the paragraph being built; `flow` when it is a run of flowing paragraphs, which later ones join
  let prev: { attrs: Record<string, unknown>; content: PMNode[]; flow: boolean } | null = null;
  const flush = () => { if (prev) keep.push(schema.node('paragraph', prev.attrs, prev.content)); prev = null; };
  const glue = (into: PMNode[], next: PMNode) => {
    const last = into[into.length - 1];
    if (last?.isText && next.isText && !/\s$/.test(last.text!) && !/^\s/.test(next.text!)) into.push(schema.text(' '));
    into.push(next);
  };
  doc.forEach((para, _pos, i) => {
    const { heading, shown, flow } = view[i];
    if (heading) { flush(); keep.push(para); return; }
    if (!shown.some(Boolean)) return;
    const runs: PMNode[] = [];
    let gap = false;
    para.forEach((n, _o, j) => {
      if (!shown[j]) { gap = runs.length > 0; return; }
      if (gap) glue(runs, n); else runs.push(n);
      gap = false;
    });
    // on screen a flowing paragraph is inline: it starts a new line after the cite, and the next ones join it
    if (flow && prev?.flow) { for (const r of runs) glue(prev.content, r); return; }
    flush();
    prev = { attrs: para.attrs, content: runs, flow };
  });
  flush();
  return docOf(keep);
}

/** Red as marking counts it: #FF0000, or the marker color Settings picks. */
const isRed = (n: PMNode) => isMarker(n.marks);
/**
 * A card (a tag or analytic and the paragraphs under it) is marked when all of its text is red: marking
 * a card turns the whole thing red. A red "Marked 3:15" reading stamp in an otherwise black card is not.
 */
const isMarkedCard = (card: PMNode[]) => {
  let any = false, all = true;
  // undertags are the user's own notes: they don't decide whether the card is marked
  for (const p of card) if (p.attrs.style !== 'undertag') p.forEach((n) => { if (n.isText && n.text!.trim()) { any = true; if (!isRed(n)) all = false; } });
  return any && all;
};

/**
 * Marked Doc: only the marked cards (all their text red), under the pocket, hat and block headings they sit
 * in. Headings with no marked card below them, and anything outside a card, are left out.
 */
export function markedDoc(doc: PMNode): PMNode | null {
  const paras: PMNode[] = [];
  doc.forEach((p) => paras.push(p));
  const keep: PMNode[] = [];
  const heads: PMNode[] = []; // the pocket/hat/block path above the current spot, not yet written
  for (let i = 0; i < paras.length; i++) {
    const l = level(paras[i]);
    if (l === 0) continue; // text outside any card
    if (l < 4) {
      while (heads.length && level(heads[heads.length - 1]) >= l) heads.pop();
      heads.push(paras[i]);
      continue;
    }
    let end = i + 1;
    while (end < paras.length && level(paras[end]) === 0) end++;
    const card = paras.slice(i, end);
    if (isMarkedCard(card)) {
      // write the heading path once: heads already written are cleared from the list
      keep.push(...heads.splice(0));
      keep.push(...card);
    }
    i = end - 1;
  }
  return docOf(keep);
}

export function docForMode(doc: PMNode, mode: SaveMode): PMNode | null {
  return mode === 'send' ? sendDoc(doc) : mode === 'read' ? readDoc(doc) : mode === 'marked' ? markedDoc(doc) : doc;
}
