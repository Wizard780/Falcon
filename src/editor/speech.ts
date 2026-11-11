import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { Selection, type EditorState, type Transaction } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';
import { cardAround } from './commands';
import { MultiSelection } from './multi';

const LABEL_MAX = 40;

/** The selected stretch of each paragraph it touches, as whole paragraphs that keep their style and indent. */
function selectedParas(doc: PMNode, from: number, to: number): PMNode[] {
  const out: PMNode[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const a = Math.max(from, pos + 1) - pos - 1;
    const b = Math.min(to, pos + 1 + node.content.size) - pos - 1;
    // a blank line counts only when the selection runs across it, not when it merely touches its edge
    if (b > a || (!node.content.size && from <= pos && to > pos + 1)) out.push(node.copy(node.content.cut(a, b)));
    return false;
  });
  return out;
}

/** What Send to speech sends: the multi-selection, the selected text, or with a bare caret the card or heading section it sits in. */
export function sendContent(state: EditorState): { content: Fragment; label: string } | null {
  const { doc, selection } = state;
  let paras: PMNode[] = [];
  if (selection instanceof MultiSelection) selection.content().content.forEach((p) => paras.push(p));
  else if (!selection.empty) paras = selectedParas(doc, selection.from, selection.to);
  else {
    const c = cardAround(doc, selection.from);
    if (!c) return null;
    for (let i = c.head; i < c.end; i++) paras.push(doc.child(i));
  }
  const first = paras.find((p) => p.textContent.trim());
  if (!first) return null;
  const text = first.textContent.trim().replace(/\s+/g, ' ');
  return { content: Fragment.from(paras), label: text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1).trimEnd()}…` : text };
}

/** Insert after the paragraph holding the caret and leave the caret at the end, so the next send lands below.
 *  An empty speech doc's one blank line is replaced; any other blank line is a separator and stays. */
export function insertIntoSpeech(state: EditorState, content: Fragment): Transaction {
  const { doc } = state;
  const i = Math.min(state.selection.$to.index(0), doc.childCount - 1);
  let start = 0;
  for (let k = 0; k < i; k++) start += doc.child(k).nodeSize;
  const para = doc.child(i);
  const tr = closeHistory(state.tr); // each send is its own undo step, even two in quick succession
  const blank = doc.childCount === 1 && !para.content.size;
  if (blank) tr.replaceWith(start, start + para.nodeSize, content);
  else tr.insert(start + para.nodeSize, content);
  const end = start + (blank ? 0 : para.nodeSize) + content.size;
  return tr.setSelection(Selection.near(tr.doc.resolve(end), -1));
}

/** Add at the end of the doc (an empty doc's one blank line is replaced). The caret stays where it is. */
export function insertAtEnd(state: EditorState, content: Fragment): Transaction {
  const { doc } = state;
  const tr = closeHistory(state.tr);
  if (doc.childCount === 1 && !doc.child(0).content.size) return tr.replaceWith(0, doc.content.size, content).setSelection(Selection.near(tr.doc.resolve(0)));
  return tr.insert(doc.content.size, content);
}
