import type { Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import { cardAt } from '../commands';
import { isReading } from '../read';

/** Document position where paragraph `index` starts. */
export function posOf(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/**
 * A selection of card body text: inside one card, touching neither its tag, an undertag, nor its cite line.
 * Returns the card and the first and last paragraph touched, or null (the command then does nothing).
 */
export function bodySelection(state: EditorState) {
  const { $from, $to, empty } = state.selection;
  if (empty || $from.depth < 1 || $to.depth < 1) return null;
  // nothing but a paragraph break (Shift-Right on an empty line) selects no text to work on
  if (!state.doc.textBetween($from.pos, $to.pos).trim()) return null;
  const card = cardAt(state.doc, $from.pos);
  if (!card) return null;
  // a selection starting at the very end of a paragraph, or ending at the very start of one, doesn't take it
  const first = $from.parentOffset === $from.parent.content.size && $from.index(0) < $to.index(0) ? $from.index(0) + 1 : $from.index(0);
  const last = $to.parentOffset === 0 && $to.index(0) > first ? $to.index(0) - 1 : $to.index(0);
  if (first < card.start || last >= card.end) return null;
  for (let i = first; i <= last; i++) {
    if (state.doc.child(i).attrs.style !== 'normal' || i === card.cite) return null;
  }
  return { card, first, last };
}

/** Menu items run straight from the toolbar, past read mode's keyboard lock: editing tools do nothing there. */
export const editing = (cmd: Command): Command => (state, dispatch, view) => !isReading(state) && cmd(state, dispatch, view);
