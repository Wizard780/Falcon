import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { LEVEL, schema, type ParaStyle } from '../schema';
import { cardAround } from '../commands';
import { MultiSelection } from '../multi';

/**
 * A heading section: the heading paragraph and everything under it, up to the next heading at its
 * level or above (for a tag or analytic, up to the next heading of any kind). Sections are what the
 * outline and page drag, copy, cut, delete and sort.
 */
export type Section = { from: number; to: number; level: number };

export const levelOf = (n: PMNode) => LEVEL[n.attrs.style as ParaStyle] ?? 0;

/** The section headed by the paragraph at `head` (a top-level position), or null if it isn't a heading. */
export function sectionAt(doc: PMNode, head: number): Section | null {
  if (head < 0 || head >= doc.content.size) return null;
  const $h = doc.resolve(head);
  if ($h.depth !== 0) return null;
  const node = doc.nodeAt(head);
  const level = node ? levelOf(node) : 0;
  if (!node || !level) return null;
  let to = head + node.nodeSize;
  for (let i = $h.index(0) + 1; i < doc.childCount; i++) {
    const n = doc.child(i), l = levelOf(n);
    if (l > 0 && l <= level) break;
    to += n.nodeSize;
  }
  return { from: head, to, level };
}

/** Sections for a set of headings, in document order; one nested inside another chosen one is dropped. */
export function topSections(doc: PMNode, heads: number[]): Section[] {
  const out: Section[] = [];
  for (const h of [...new Set(heads)].sort((a, b) => a - b)) {
    const s = sectionAt(doc, h);
    if (s && !(out.length && s.from < out[out.length - 1].to)) out.push(s);
  }
  return out;
}

/**
 * Whether sections may land at `gap`: the end of the document, or the start of a heading at the
 * dragged sections' top level or above (so a block never lands among another block's cards, where it
 * would swallow them). Never strictly inside a dragged section.
 */
export function canDrop(doc: PMNode, secs: Section[], gap: number): boolean {
  if (!secs.length || secs.some((s) => gap > s.from && gap < s.to)) return false;
  if (gap === doc.content.size) return true;
  if (gap < 0 || gap > doc.content.size || doc.resolve(gap).depth !== 0) return false;
  const l = levelOf(doc.nodeAt(gap)!);
  return l > 0 && l <= Math.min(...secs.map((s) => s.level));
}

/** The headings' paragraphs stitched together in document order. */
export function sectionsContent(doc: PMNode, secs: Section[]): Fragment {
  const nodes: PMNode[] = [];
  for (const s of secs) doc.slice(s.from, s.to).content.forEach((n) => nodes.push(n));
  return Fragment.from(nodes);
}
export const sectionsSlice = (doc: PMNode, heads: number[]) => new Slice(sectionsContent(doc, topSections(doc, heads)), 0, 0);

/** Move (or copy) the sections to `gap`. Null when the drop isn't allowed or changes nothing. */
export function moveSections(state: EditorState, heads: number[], gap: number, copy = false): Transaction | null {
  const doc = state.doc, secs = topSections(doc, heads);
  if (!canDrop(doc, secs, gap)) return null;
  // dropped at its own edge (several adjacent sections included): nothing moves
  const together = secs.every((s, i) => i === 0 || secs[i - 1].to === s.from);
  if (!copy && together && (gap === secs[0].from || gap === secs[secs.length - 1].to)) return null;
  const tr = state.tr.insert(gap, sectionsContent(doc, secs));
  if (!copy) {
    for (const s of [...secs].reverse()) tr.delete(tr.mapping.map(s.from, 1), tr.mapping.map(s.to, -1));
  }
  const start = tr.mapping.slice(1).map(gap, -1);
  return tr.setSelection(TextSelection.create(tr.doc, start + 1)).scrollIntoView();
}

/** Delete the sections, one step. A document never ends up with no paragraph at all. */
export function deleteSections(state: EditorState, heads: number[]): Transaction | null {
  const secs = topSections(state.doc, heads);
  if (!secs.length) return null;
  const tr = state.tr;
  for (const s of [...secs].reverse()) {
    if (s.from === 0 && s.to === tr.doc.content.size) tr.replaceWith(0, s.to, schema.nodes.paragraph.create());
    else tr.delete(s.from, s.to);
  }
  const at = Math.min(tr.mapping.map(secs[0].from), tr.doc.content.size - 1);
  return tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(at, 0)))).scrollIntoView();
}

/** Select the sections: one stretch, or a multi-selection for scattered ones. */
export function selectSections(state: EditorState, heads: number[]): Transaction | null {
  const secs = topSections(state.doc, heads);
  if (!secs.length) return null;
  const spans = secs.map((s) => ({ from: s.from + 1, to: s.to - 1 }));
  return state.tr.setSelection(MultiSelection.create(state.doc, spans));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Sort the sections by heading text ("Card 2" before "Card 10", case ignored). Each sorted section
 * lands in one of the slots the selection held, so headings that weren't chosen stay put.
 */
export function alphabetize(state: EditorState, heads: number[]): Transaction | null {
  const doc = state.doc, secs = topSections(doc, heads);
  if (secs.length < 2) return null;
  const text = (s: Section) => doc.nodeAt(s.from)!.textContent.trim();
  const sorted = [...secs].sort((a, b) => collator.compare(text(a), text(b)));
  if (sorted.every((s, i) => s === secs[i])) return null;
  const tr = state.tr;
  for (let k = secs.length - 1; k >= 0; k--) tr.replaceWith(secs[k].from, secs[k].to, doc.slice(sorted[k].from, sorted[k].to).content);
  return tr.scrollIntoView();
}

const posOfIndex = (doc: PMNode, index: number) => { let p = 0; for (let i = 0; i < index; i++) p += doc.child(i).nodeSize; return p; };

/** The heading of the card or section at the cursor. */
export function headAtCursor(state: EditorState): number | null {
  const c = cardAround(state.doc, state.selection.from);
  return c ? posOfIndex(state.doc, c.head) : null;
}

/** Scroll so the paragraph at `pos` sits just under the top, where an outline click puts it. */
export function scrollToTop(view: EditorView, pos: number) {
  const el = view.nodeDOM(pos) as HTMLElement | null;
  const sc = view.dom.closest('.f-scroll') as HTMLElement | null;
  if (!el || !sc || !el.getBoundingClientRect) return;
  // off-screen paragraphs have estimated heights: re-aim until the target holds still
  for (let i = 0; i < 4; i++) sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 16;
}

/** Go to the next/previous heading of one style (Next Tag skips blocks and analytics). */
export function gotoStyle(style: ParaStyle, dir: -1 | 1): Command {
  return (state, dispatch, view) => {
    const doc = state.doc, $h = state.selection.$head;
    if ($h.depth < 1) return false;
    const idx = $h.index(0);
    let target = -1;
    if (dir > 0) { for (let i = idx + 1; i < doc.childCount; i++) if (doc.child(i).attrs.style === style) { target = i; break; } }
    else { for (let i = $h.parentOffset === 0 ? idx - 1 : idx; i >= 0; i--) if (doc.child(i).attrs.style === style) { target = i; break; } }
    if (target < 0) return true;
    const pos = posOfIndex(doc, target);
    if (dispatch) {
      dispatch(state.tr.setSelection(TextSelection.create(doc, pos + 1)).scrollIntoView());
      if (view) scrollToTop(view, pos);
    }
    return true;
  };
}
