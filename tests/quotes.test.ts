import { describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createView } from '../src/editor/editor';
import { schema } from '../src/editor/schema';

// type one character the way the browser does: through handleTextInput, falling back to a plain insert
const type = (view: EditorView, text: string) => {
  const { from, to } = view.state.selection;
  const handled = view.someProp('handleTextInput', (f) => f(view, from, to, text, () => view.state.tr.insertText(text, from, to)));
  if (!handled) view.dispatch(view.state.tr.insertText(text, from, to));
};
const typed = (start: string, keys: string) => {
  const doc = schema.node('doc', null, [schema.node('paragraph', { style: 'normal' }, start ? [schema.text(start)] : [])]);
  const view = createView(document.createElement('div'), () => {}, doc);
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  for (const k of keys) type(view, k);
  return view.state.doc.textContent;
};

describe('opening quote before a year or a space', () => {
  it('turns ‘ into ’ when a digit follows (Orth ’10)', () => expect(typed('Orth ', '‘10-26')).toBe('Orth ’10-26'));
  it('turns ‘ into ’ when a space follows', () => expect(typed('rock ', '‘ n')).toBe('rock ’ n'));
  it('works at the start of a line', () => expect(typed('', '‘90s')).toBe('’90s'));
  it('leaves a real opening quote alone', () => expect(typed('he said ', '‘no’')).toBe('he said ‘no’'));
  it('leaves straight quotes alone', () => expect(typed('Orth ', "'10")).toBe("Orth '10"));
});
