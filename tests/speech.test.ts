import { describe, expect, it } from 'vitest';
import { undo } from 'prosemirror-history';
import { AllSelection, TextSelection, type EditorState } from 'prosemirror-state';
import { createState } from '../src/editor/editor';
import { falconKeys as K } from '../src/editor/keymap';
import { MultiSelection } from '../src/editor/multi';
import { schema } from '../src/editor/schema';
import { insertIntoSpeech, sendContent } from '../src/editor/speech';
import { at, caret, make, map, run, select } from './helpers';

const file = () => {
  let s = make([
    ['pocket', 'Pocket one'], ['hat', 'Hat A'], ['block', 'Block one'],
    ['tag', 'Tag one'], ['normal', 'Smith 24, Professor'], ['normal', 'Body one text here'],
    ['tag', 'Tag two'], ['normal', 'Jones 23, Analyst'], ['normal', 'Body two text here'],
    ['block', 'Block two'], ['tag', 'Tag three'], ['normal', 'Body three text here'],
  ]);
  s = run(select(s, 'one text'), K.F9);
  return s;
};
const blank = () => createState();
/** `~` pressed in `source`, applied to the speech doc, the way the app does it. */
function send(source: EditorState, speech: EditorState = blank()): EditorState {
  const sent = sendContent(source);
  if (!sent) throw new Error('nothing to send');
  return speech.apply(insertIntoSpeech(speech, sent.content));
}
const lines = (s: EditorState) => map(s).split('\n');

const CARD_ONE = ['tag: Tag one', 'normal: Smith 24, Professor', 'normal: Body [one text]{underline} here'];
const CARD_TWO = ['tag: Tag two', 'normal: Jones 23, Analyst', 'normal: Body two text here'];

describe('what ~ sends', () => {
  it('a caret in a card body sends the tag and everything under it, marks kept', () => {
    expect(lines(send(caret(file(), 'Body one', 3)))).toEqual(CARD_ONE);
  });
  it('a caret on a tag sends the same card', () => {
    expect(lines(send(caret(file(), 'Tag two', 2)))).toEqual(CARD_TWO);
  });
  it('a caret on a block heading sends the block with all its cards', () => {
    expect(lines(send(caret(file(), 'Block one', 2)))).toEqual(['block: Block one', ...CARD_ONE, ...CARD_TWO]);
  });
  it('a caret on a hat sends everything under the hat', () => {
    expect(lines(send(caret(file(), 'Hat A', 1)))).toEqual(['hat: Hat A', 'block: Block one', ...CARD_ONE, ...CARD_TWO, 'block: Block two', 'tag: Tag three', 'normal: Body three text here']);
  });
  it('a partial selection inside one paragraph keeps that paragraph\'s style', () => {
    expect(lines(send(select(file(), 'Tag')))).toEqual(['tag: Tag']);
    expect(lines(send(select(file(), 'two text')))).toEqual(['normal: two text']);
    expect(lines(send(select(file(), 'one text')))).toEqual(['normal: [one text]{underline}']);
  });
  it('a selection across paragraphs sends closed paragraphs, cut at both ends', () => {
    const f = file();
    const s = f.apply(f.tr.setSelection(TextSelection.create(f.doc, at(f, 'Tag one', 4), at(f, 'Body one', 4))));
    expect(lines(send(s))).toEqual(['tag: one', 'normal: Smith 24, Professor', 'normal: Body']);
  });
  it('select-all sends the whole doc', () => {
    const s = file();
    const all = s.apply(s.tr.setSelection(new AllSelection(s.doc)));
    expect(lines(send(all))).toEqual(lines(s));
  });
  it('separate stretches (Ctrl-click) are sent as one paragraph each', () => {
    const s = file();
    const sel = MultiSelection.create(s.doc, [
      { from: at(s, 'Tag two'), to: at(s, 'Tag two', 3) },
      { from: at(s, 'Body three', 5), to: at(s, 'Body three', 10) },
    ]);
    expect(lines(send(s.apply(s.tr.setSelection(sel))))).toEqual(['tag: Tag', 'normal: three']);
  });
  it('keeps indent', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', { style: 'tag' }, [schema.text('Tag')]), schema.node('paragraph', { indent: 2 }, [schema.text('indented')])]);
    const s = createState(doc);
    const out = send(s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1))));
    expect(out.doc.child(1).attrs.indent).toBe(2);
  });
  it('sends nothing above the first heading, from an empty doc, or for blank text', () => {
    expect(sendContent(caret(make([['normal', 'loose line'], ['tag', 'Tag']]), 'loose', 2))).toBeNull();
    expect(sendContent(blank())).toBeNull();
    const heading = make([['tag', ''], ['normal', '']]);
    expect(sendContent(heading)).toBeNull();
    const spaced = make([['tag', 'Tag'], ['normal', '   ']]);
    expect(sendContent(select(spaced, '   '))).toBeNull();
  });
  it('labels the toast with the first line, cut when long', () => {
    expect(sendContent(caret(file(), 'Body one', 3))!.label).toBe('Tag one');
    const long = make([['tag', 'A very long tag line that goes on and on well past the limit']]);
    const label = sendContent(caret(long, 'A very', 1))!.label;
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label.endsWith('…')).toBe(true);
  });
  it('leaves the source doc and its selection alone', () => {
    const s = caret(file(), 'Body one', 3);
    const before = { doc: s.doc, map: map(s), from: s.selection.from, to: s.selection.to };
    send(s);
    expect(s.doc).toBe(before.doc);
    expect(map(s)).toBe(before.map);
    expect([s.selection.from, s.selection.to]).toEqual([before.from, before.to]);
  });
});

describe('landing in the speech doc', () => {
  it('a fresh blank speech doc starts with the card, no empty line above it', () => {
    const out = send(caret(file(), 'Tag two', 2));
    expect(lines(out)).toEqual(CARD_TWO);
    expect(out.doc.childCount).toBe(3);
  });
  it('two sends land in order and the caret ends after the last one', () => {
    let speech = send(caret(file(), 'Tag two', 2));
    speech = send(caret(file(), 'Tag one', 2), speech);
    expect(lines(speech)).toEqual([...CARD_TWO, ...CARD_ONE]);
    expect(speech.selection.empty).toBe(true);
    expect(speech.selection.$head.parent.textContent).toBe('Body one text here');
    expect(speech.selection.$head.parentOffset).toBe('Body one text here'.length);
  });
  it('lands after the paragraph the speech doc\'s caret is in', () => {
    let speech = send(caret(file(), 'Tag two', 2));
    speech = send(caret(file(), 'Tag one', 2), speech);
    speech = speech.apply(speech.tr.setSelection(TextSelection.create(speech.doc, at(speech, 'Tag two', 2))));
    speech = send(select(file(), 'Body three'), speech);
    expect(lines(speech)).toEqual(['tag: Tag two', 'normal: Body three', ...CARD_TWO.slice(1), ...CARD_ONE]);
  });
  it('the blank line that ends a sent card stays between it and the next send', () => {
    const spaced = () => make([['tag', 'Tag one'], ['normal', 'Body one'], ['normal', ''], ['tag', 'Tag two'], ['normal', 'Body two'], ['normal', '']]);
    let speech = send(caret(spaced(), 'Tag one', 2));
    speech = send(caret(spaced(), 'Tag two', 2), speech);
    expect(lines(speech)).toEqual(['tag: Tag one', 'normal: Body one', 'normal: ', 'tag: Tag two', 'normal: Body two', 'normal: ']);
  });
  it('undo takes back just the last send, even when two come in quick succession', () => {
    let speech = send(caret(file(), 'Tag two', 2));
    speech = send(caret(file(), 'Tag one', 2), speech);
    undo(speech, (tr) => { speech = speech.apply(tr); });
    expect(lines(speech)).toEqual(CARD_TWO);
    undo(speech, (tr) => { speech = speech.apply(tr); });
    expect(lines(speech)).toEqual(['normal: ']);
  });
});
