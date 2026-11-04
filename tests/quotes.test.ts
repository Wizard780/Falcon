import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createView } from '../src/editor/editor';
import { schema } from '../src/editor/schema';
import { P, setPref } from '../src/editor/prefs';

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
});

describe('smart quotes, as in CardMirror', () => {
  const session = (start: string) => {
    const doc = schema.node('doc', null, [schema.node('paragraph', { style: 'normal' }, start ? [schema.text(start)] : [])]);
    const view = createView(document.createElement('div'), () => {}, doc);
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    return {
      keys: (ks: string) => { for (const k of ks) type(view, k); },
      backspace: () => view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Backspace' }))) ?? false,
      get text() { return view.state.doc.textContent; },
    };
  };
  afterEach(() => setPref(P.smartQuotes, true));
  it('curls by what comes before', () => {
    expect(typed('', `don't`)).toBe('don’t');
    expect(typed('', `he said "hi" (and 'bye')`)).toBe('he said “hi” (and ‘bye’)');
    expect(typed('', `'tis`)).toBe('‘tis');
  });
  it('a cite date flips to an apostrophe', () => expect(typed('Orth ', "'10")).toBe('Orth ’10'));
  it('Backspace right after puts the straight quote back, once', () => {
    const s = session('dogs');
    s.keys("'");
    expect(s.text).toBe('dogs’');
    expect(s.backspace()).toBe(true);
    expect(s.text).toBe("dogs'");
    expect(s.backspace()).toBe(false); // the next one is a normal delete
  });
  it('then a space curls it', () => {
    const s = session('Orth ');
    s.keys("'");
    expect(s.text).toBe('Orth ‘');
    s.backspace();
    s.keys(' ');
    expect(s.text).toBe('Orth ’ ');
    const d = session('said');
    d.keys('"'); d.backspace(); d.keys(' ');
    expect(d.text).toBe('said” ');
  });
  it('a straight quote stays put until a space, and typing on leaves the undo behind', () => {
    const s = session('dogs');
    s.keys("'x");
    expect(s.backspace()).toBe(false);
  });
  it('keeps the marks of the text it lands in', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', { style: 'normal' }, [schema.text('lit', [schema.marks.highlight.create()])])]);
    const view = createView(document.createElement('div'), () => {}, doc);
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    type(view, "'");
    expect(view.state.doc.firstChild!.childCount).toBe(1);
  });
  it('off in Settings: quotes stay straight', () => {
    setPref(P.smartQuotes, false);
    expect(typed('', `don't "x"`)).toBe(`don't "x"`);
  });
});
