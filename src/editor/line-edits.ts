import { Plugin, Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';

/**
 * Two fixes for selections that cover whole lines, as CardMirror has them:
 * - typing or pasting over a selection that runs to the very start of the next line (what a triple click picks on a
 *   Mac) replaces only up to the end of the line before, so the next line doesn't get pulled up into a tag
 * - Backspace, Delete or cut on whole lines takes the lines too, instead of leaving an empty one behind
 */

/** Where the last line a selection covers ends, when the selection stops at the very start of a later line. */
function endBeforeLineStart(state: EditorState): number | null {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || sel.empty) return null;
  const { $from, $to } = sel;
  if (!$to.parent.isTextblock || $to.parentOffset !== 0) return null;
  const end = Selection.near(state.doc.resolve($to.before()), -1).to;
  return end > $from.pos && end < $to.pos ? end : null;
}

/** From the start of a line to the end of the same line or a later one. */
const coversWholeLines = (state: EditorState) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || sel.empty) return false;
  const { $from, $to } = sel;
  return $from.parent.isTextblock && $from.parentOffset === 0 && $to.parent.isTextblock && $to.parentOffset === $to.parent.content.size;
};

/** Takes out the empty line at `pos`, unless it's the only thing where it sits. */
function dropEmptyLine(tr: Transaction, pos: number) {
  const $p = tr.doc.resolve(pos);
  const line = $p.parent, d = $p.depth;
  if (!line.isTextblock || line.content.size || !d) return false;
  const holder = $p.node(d - 1), i = $p.index(d - 1);
  if (holder.childCount <= 1 || !holder.canReplace(i, i + 1)) return false;
  const at = $p.before(d);
  tr.delete(at, $p.after(d));
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size)), 1));
  return true;
}

/** Backspace and Delete on whole lines. */
export const deleteWholeLines: Command = (state, dispatch) => {
  if (!coversWholeLines(state)) return false;
  const tr = state.tr.deleteSelection();
  if (!dropEmptyLine(tr, tr.mapping.map(state.selection.from))) return false;
  dispatch?.(tr.scrollIntoView());
  return true;
};

export const lineEditsPlugin = new Plugin({
  props: {
    // a paste over the same selection: narrowed first, then the editor's own paste (and the other paste handlers)
    // replace just those lines, so the cite under a triple-clicked tag stays its own line
    handlePaste(view) {
      const end = endBeforeLineStart(view.state);
      if (end !== null) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from, end)));
      return false;
    },
    handleTextInput(view, from, _to, text) {
      const end = endBeforeLineStart(view.state);
      if (end === null || from !== view.state.selection.from) return false;
      const tr = view.state.tr.insertText(text, from, end);
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + text.length)).scrollIntoView());
      return true;
    },
  },
  // cut goes through the editor's own path, so the leftover line comes out after it
  appendTransaction(trs, old, state) {
    const cut = trs.find((tr) => tr.getMeta('uiEvent') === 'cut' && tr.docChanged);
    if (!cut || trs.length !== 1 || !coversWholeLines(old)) return null;
    const tr = state.tr;
    return dropEmptyLine(tr, cut.mapping.map(old.selection.from)) ? tr : null;
  },
});
