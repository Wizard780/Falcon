import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { createState, markMap } from '../src/editor/editor';
import { schema, type ParaStyle } from '../src/editor/schema';

/** Build a doc from [style, text] pairs. */
export function make(paras: [ParaStyle, string][]) {
  return createState(schema.node('doc', null, paras.map(([style, text]) => schema.node('paragraph', { style }, text ? [schema.text(text)] : []))));
}
/** Position of the nth occurrence of text (start), offset by `off`. */
export function at(state: EditorState, text: string, off = 0): number {
  let found = -1;
  state.doc.forEach((para, pos) => {
    if (found >= 0) return;
    const i = para.textBetween(0, para.content.size, undefined, '\uFFFC').indexOf(text);
    if (i >= 0) found = pos + 1 + i + off;
  });
  if (found < 0) throw new Error(`no ${text}`);
  return found;
}
export function select(state: EditorState, text: string, endText?: string) {
  const from = at(state, text);
  const to = endText ? at(state, endText, endText.length) : from + text.length;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}
export function caret(state: EditorState, text: string, off = 0) {
  const p = at(state, text, off);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, p)));
}
export function run(state: EditorState, cmd: Command): EditorState {
  let next = state;
  cmd(state, (tr) => { next = state.apply(tr); });
  return next;
}
export const map = (s: EditorState) => markMap(s.doc);
