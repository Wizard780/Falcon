import { afterEach, describe, expect, it } from 'vitest';
import { Fragment, Slice } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { falconKeys as K } from '../src/editor/keymap';
import { createView } from '../src/editor/editor';
import { schema, type ParaStyle } from '../src/editor/schema';
import { P, resetPrefs, setPref } from '../src/editor/prefs';
import { IS_MAC } from '../src/editor/keybinds';
import { at, make, map, run } from './helpers';

const card = () => make([['tag', 'Tag'], ['normal', 'Smith 24'], ['normal', 'body']]);
const pick = (s: ReturnType<typeof make>, from: number, to: number) => s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));

let views: EditorView[] = [];
afterEach(() => { views.forEach((v) => { v.destroy(); v.dom.parentElement?.remove(); }); views = []; resetPrefs(); });
function view(paras: [ParaStyle, string][]) {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const v = createView(mount, () => {}, schema.node('doc', null, paras.map(([style, text]) => schema.node('paragraph', { style }, text ? [schema.text(text)] : []))));
  views.push(v);
  return v;
}
const type = (v: EditorView, text: string) => {
  const { from, to } = v.state.selection;
  if (!v.someProp('handleTextInput', (f) => f(v, from, to, text, () => v.state.tr.insertText(text, from, to)))) v.dispatch(v.state.tr.insertText(text, from, to));
};
const key = (v: EditorView, k: string, mods: KeyboardEventInit = {}) => v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: k, ...mods })));
const select = (v: EditorView, from: number, to = from) => v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, to)));

describe('typing over whole lines', () => {
  it('stops at the end of the line, so the next line keeps its own style', () => {
    const v = view([['tag', 'Tag'], ['normal', 'Smith 24']]);
    select(v, at(v.state, 'Tag'), at(v.state, 'Smith'));
    type(v, 'N'); type(v, 'ew');
    expect(map(v.state)).toBe('tag: New\nnormal: Smith 24');
  });
  it('a paste over a triple-clicked tag stops at the end of the line too', () => {
    // jsdom has no ClipboardEvent; ProseMirror's pasteText and pasteHTML only make one to pass to the handlers
    const g = globalThis as unknown as { ClipboardEvent?: unknown };
    g.ClipboardEvent ??= class extends Event { clipboardData = null; };
    for (const paste of [(v: EditorView) => v.pasteText('New'), (v: EditorView) => v.pasteHTML('<p>New</p>')]) {
      const v = view([['tag', 'Tag'], ['normal', 'Smith 24'], ['normal', 'body']]);
      select(v, at(v.state, 'Tag'), at(v.state, 'Smith'));
      paste(v);
      expect(map(v.state)).toBe('tag: New\nnormal: Smith 24\nnormal: body');
    }
  });
  it('leaves an ordinary selection to the editor', () => {
    const v = view([['tag', 'Tag'], ['normal', 'Smith 24']]);
    select(v, at(v.state, 'Tag'), at(v.state, 'Smith', 2));
    type(v, 'X');
    expect(map(v.state)).toBe('tag: Xith 24');
  });
});

describe('deleting whole lines', () => {
  it('Backspace and Delete take the line, not just its text', () => {
    const s = card();
    for (const k of [K.Backspace, K.Delete]) {
      const after = run(pick(s, at(s, 'Tag'), at(s, 'Tag', 3)), k);
      expect(map(after)).toBe('normal: Smith 24\nnormal: body');
      expect(after.selection.from).toBe(at(after, 'Smith'));
    }
    const two = run(pick(s, at(s, 'Tag'), at(s, 'Smith 24', 8)), K.Backspace);
    expect(map(two)).toBe('normal: body');
  });
  it('keeps the last line there is, and leaves part of a line alone', () => {
    const one = make([['tag', 'Only']]);
    expect(map(run(pick(one, 1, 5), K.Backspace))).toBe('tag: ');
    const s = card();
    expect(map(run(pick(s, at(s, 'Smith'), at(s, 'Smith', 5)), K.Backspace))).toBe('tag: Tag\nnormal:  24\nnormal: body');
  });
  it('cut takes the line too', () => {
    const v = view([['tag', 'Tag'], ['normal', 'Smith 24']]);
    select(v, at(v.state, 'Tag'), at(v.state, 'Tag', 3));
    v.dispatch(v.state.tr.deleteSelection().setMeta('uiEvent', 'cut'));
    expect(map(v.state)).toBe('normal: Smith 24');
  });
});

describe('Redo repeats the last action', () => {
  const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true };
  const redo = (v: EditorView) => key(v, 'y', mod);
  it('is off by default', () => {
    const v = view([['normal', 'one two']]);
    select(v, at(v.state, 'one', 3));
    type(v, '!');
    expect(redo(v)).toBeFalsy();
  });
  it('types the same text again, pastes again, and runs the same key again', () => {
    setPref(P.repeatRedo, true);
    const v = view([['normal', 'one two three']]);
    select(v, at(v.state, 'one', 3));
    type(v, ' x'); type(v, 'y');
    select(v, at(v.state, 'three', 5));
    redo(v);
    expect(v.state.doc.textContent).toBe('one xy two three xy');
    // a formatting key: F8 cites, then Redo cites the next selection
    select(v, at(v.state, 'one'), at(v.state, 'one', 3));
    key(v, 'F8');
    select(v, at(v.state, 'two'), at(v.state, 'two', 3));
    redo(v);
    expect(map(v.state)).toBe('normal: [one]{cite} xy [two]{cite} three xy');
    // a paste: the editor's own paste path runs after the plugins look at it
    const slice = new Slice(Fragment.from(schema.text('P')), 0, 0);
    select(v, at(v.state, 'three'));
    if (!v.someProp('handlePaste', (f) => f(v, new Event('paste') as ClipboardEvent, slice))) v.dispatch(v.state.tr.replaceSelection(slice));
    select(v, 1);
    redo(v);
    expect(v.state.doc.textContent).toBe('Pone xy two Pthree xy');
  });
  it('real redo still wins when there is something to redo', () => {
    setPref(P.repeatRedo, true);
    const v = view([['normal', 'abc']]);
    select(v, 4);
    type(v, 'd');
    key(v, 'z', mod);
    expect(v.state.doc.textContent).toBe('abc');
    redo(v);
    expect(v.state.doc.textContent).toBe('abcd');
  });
});
