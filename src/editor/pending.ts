import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { levelOf } from './schema';
import { deleteSections, sectionAt, topSections, type Section } from './nav/sections';
import { isReading } from './read';

/**
 * Pending cards: cards Claude added (or that came in from disk) that the user hasn't approved yet. A pending
 * heading's section (the card, or a whole block) is drawn on a light orange background with Approve and
 * Reject on its heading. Approve clears the mark; Reject deletes the section. The mark is the heading's
 * `pending` attr. On save it changes the heading's id bookmark from `_fc_<id>` to `_fcp_<id>`, which Word
 * and Verbatim never draw, so a file opens clean anywhere but Falcon.
 */
export { PENDING_PREFIX } from './card-ids';

/** Positions of the pending headings, in document order. */
export function pendingHeads(doc: PMNode): number[] {
  const out: number[] = [];
  doc.forEach((n, pos) => { if (n.attrs.pending && levelOf(n)) out.push(pos); });
  return out;
}

/** The pending sections, outermost only (a pending card inside a pending block is part of the block's). */
export const pendingSections = (doc: PMNode): Section[] => topSections(doc, pendingHeads(doc));

/** The pending section the cursor is in, or null. */
function pendingAt(state: EditorState): Section | null {
  const at = state.selection.from;
  return pendingSections(state.doc).find((s) => at >= s.from && at <= s.to) ?? null;
}

/** Clear the mark on every heading in `sec`. */
function approveIn(tr: Transaction, sec: Section) {
  tr.doc.nodesBetween(sec.from, sec.to, (n, pos) => {
    if (n.attrs.pending) tr.setNodeAttribute(pos, 'pending', false);
    return false;
  });
}

/** Put the cursor at the start of the next pending card after `from` (wrapping around), if any. */
function toNext(tr: Transaction, from: number): boolean {
  const heads = pendingSections(tr.doc).map((s) => s.from);
  const next = heads.find((h) => h >= from) ?? heads[0];
  if (next === undefined) return false;
  tr.setSelection(TextSelection.create(tr.doc, next + 1)).setMeta(pendingKey, next).scrollIntoView();
  return true;
}

/** Review a card: in a pending card, approve or reject it and go on to the next one; anywhere else, go to the next one. */
const review = (act: 'approve' | 'reject'): Command => (state, dispatch) => {
  if (isReading(state)) return false;
  const sec = pendingAt(state);
  if (!sec) {
    const tr = state.tr;
    if (!toNext(tr, state.selection.to)) return false;
    dispatch?.(tr);
    return true;
  }
  if (!dispatch) return true;
  let tr: Transaction;
  if (act === 'approve') { tr = state.tr; approveIn(tr, sec); }
  else tr = deleteSections(state, [sec.from])!;
  toNext(tr, tr.mapping.map(sec.to));
  dispatch(tr);
  return true;
};
export const approveCard = review('approve');
export const rejectCard = review('reject');

export const approveAll: Command = (state, dispatch) => {
  const secs = pendingSections(state.doc);
  if (!secs.length || isReading(state)) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const s of secs) approveIn(tr, s);
    dispatch(tr);
  }
  return true;
};

export const nextPending: Command = (state, dispatch) => {
  const tr = state.tr;
  const sec = pendingAt(state);
  if (!toNext(tr, sec ? sec.to : state.selection.to)) return false;
  dispatch?.(tr);
  return true;
};

/** Approve or reject the pending card headed at `head` (the buttons on the card). */
export function reviewAt(view: EditorView, head: number, act: 'approve' | 'reject') {
  const s = view.state;
  const sec = sectionAt(s.doc, head);
  if (!sec || !s.doc.nodeAt(head)?.attrs.pending) return;
  const tr = s.tr.setSelection(TextSelection.create(s.doc, head + 1));
  view.dispatch(tr);
  (act === 'approve' ? approveCard : rejectCard)(view.state, view.dispatch);
  view.focus();
}

function bar(view: EditorView, getPos: () => number | undefined): HTMLElement {
  const el = document.createElement('span');
  el.className = 'f-pending-bar';
  el.contentEditable = 'false';
  for (const [act, label, text] of [['approve', 'Approve card', '✓ Approve'], ['reject', 'Reject card', '✕ Reject']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `f-pending-${act}`;
    b.setAttribute('aria-label', label);
    b.title = `${label} (${act === 'approve' ? 'keeps it' : 'deletes it'})`;
    b.textContent = text;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the caret where it is until the click lands
    b.addEventListener('click', () => { const p = getPos(); if (p !== undefined) reviewAt(view, p - 1, act); });
    el.append(b);
  }
  return el;
}

function decorate(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  for (const s of pendingSections(doc)) {
    doc.nodesBetween(s.from, s.to, (n, pos) => {
      decos.push(Decoration.node(pos, pos + n.nodeSize, { class: pos === s.from ? 'f-pending f-pending-head' : 'f-pending' }));
      return false;
    });
    decos.push(Decoration.widget(s.from + 1, bar, { side: -1, key: `pending-${doc.nodeAt(s.from)!.attrs.card ?? s.from}`, ignoreSelection: true, stopEvent: () => true }));
  }
  return DecorationSet.create(doc, decos);
}

/** decos: the orange; jump: the heading a review key just went to (scrolled to a quarter down the page, not the edge). */
type PendingState = { decos: DecorationSet; jump: number | null };
export const pendingKey = new PluginKey<PendingState>('pending');
export const pendingPlugin = new Plugin<PendingState>({
  key: pendingKey,
  state: {
    init: (_c, state) => ({ decos: decorate(state.doc), jump: null }),
    apply: (tr, old) => ({ decos: tr.docChanged ? decorate(tr.doc) : old.decos, jump: tr.getMeta(pendingKey) ?? null }),
  },
  props: {
    decorations: (state) => pendingKey.getState(state)!.decos,
    handleScrollToSelection(view) {
      const jump = pendingKey.getState(view.state)!.jump;
      const el = jump === null ? null : (view.nodeDOM(jump) as HTMLElement | null);
      const sc = view.dom.closest('.f-scroll');
      if (!el || !sc) return false;
      sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight / 4;
      return true;
    },
  },
});
