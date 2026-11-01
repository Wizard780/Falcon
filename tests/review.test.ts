import { describe, expect, it } from 'vitest';
import { AllSelection } from 'prosemirror-state';
import { falconKeys as K } from '../src/editor/keymap';
import { insertPlainText } from '../src/editor/commands';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { markMap } from '../src/editor/editor';
import { schema } from '../src/editor/schema';
import { createState } from '../src/editor/editor';
import { caret, make, map, run, select } from './helpers';

const all = (s: ReturnType<typeof make>) => s.apply(s.tr.setSelection(new AllSelection(s.doc)));

describe('review regressions', () => {
  it('condense handles line breaks inside a paragraph', () => {
    const p = schema.node('paragraph', null, [schema.text('a'), schema.nodes.hard_break.create(), schema.text('b  c')]);
    const s0 = createState(schema.node('doc', null, [schema.node('paragraph', { style: 'tag' }, [schema.text('T')]), schema.node('paragraph', null, [schema.text('cite')]), p]));
    const s = run(caret(s0, 'cite'), K.F3);
    expect(s.doc.child(2).textBetween(0, s.doc.child(2).content.size, undefined, '|')).toBe('a|b c');
  });
  it('condense trims leading and trailing spaces without touching the paragraph boundary', () => {
    const s0 = make([['tag', 'T'], ['normal', 'cite'], ['normal', ' text '], ['normal', 'a  b ']]);
    expect(map(run(caret(s0, 'cite'), K.F3))).toBe('tag: T\nnormal: cite\nnormal: text\nnormal: a b');
  });
  it('merge never joins body text into a heading in the selection', () => {
    const s0 = make([['normal', 'A body'], ['tag', 'T'], ['normal', 'B body']]);
    expect(map(run(select(s0, 'A body', 'B body'), K['Alt-F3']))).toBe('normal: A body\ntag: T\nnormal: B body');
  });
  it('F2 multi-line paste over select-all', () => {
    const s = run(all(make([['tag', 'T'], ['normal', 'x']])), insertPlainText('one\ntwo'));
    expect(map(s)).toBe('normal: one\nnormal: two');
  });
  it('motion keys and Alt-F8 do nothing on select-all instead of throwing', () => {
    const s0 = all(make([['tag', 'T'], ['normal', 'x']]));
    for (const key of ['PageUp', 'PageDown', 'Ctrl-ArrowUp', 'Ctrl-ArrowDown', 'Alt-F8']) expect(() => run(s0, K[key])).not.toThrow();
  });
  it('uncondense only splits pilcrows inside the selection', () => {
    const s0 = make([['tag', 'T'], ['normal', 'one ¶ two ¶ three']]);
    expect(map(run(select(s0, 'two ¶ three'), K['Mod-Alt-Shift-F3']))).toBe('tag: T\nnormal: one ¶ two\nnormal: three');
  });
  it('export drops characters XML cannot hold', async () => {
    const s = make([['normal', 'bad\u000Bchar\u0001s']]);
    expect(markMap(await docxToDoc(await docToDocx(s.doc)))).toBe('normal: badchars');
  });
});

describe('end-of-doc positions', () => {
  it('cardAround handles the position after the last paragraph', async () => {
    const { cardAround } = await import('../src/editor/commands');
    const s = make([['tag', 'T'], ['normal', 'x']]);
    expect(cardAround(s.doc, s.doc.content.size)).toEqual({ head: 0, start: 1, end: 2 });
  });
});

describe('read mode', () => {
  it('locks typing, shows only read text, and Space drops then removes a marker', async () => {
    const { readKey, toggleRead, toggleMarker, isReading } = await import('../src/editor/read');
    let s = make([['normal', 'loose'], ['tag', 'Tag'], ['normal', 'Smith 24 cite'], ['normal', 'body text here']]);
    s = run(select(s, 'Smith 24'), K.F8);
    s = run(select(s, 'text'), K.F11);
    s = run(s, toggleRead);
    expect(isReading(s)).toBe(true);
    const cls = (d: unknown) => String((d as { type: { attrs: { class: string } } }).type.attrs.class);
    const decos = readKey.getState(s)!.decos.find();
    const text = (want: string) => decos.filter((d) => cls(d).split(' ').includes(want)).map((d) => s.doc.textBetween(d.from, d.to, '|')).sort();
    expect(text('f-read-hidden')).toEqual([' cite', ' here', 'body ', 'loose'].sort());
    expect(text('f-read-shown')).toEqual(['Smith 24', 'text']);
    expect(text('f-read-gap')).toEqual([]); // 'body ' comes before the first shown run, so it needs no gap
    s = run(caret(s, 'here'), toggleMarker);
    expect(map(s)).toMatch(/body \[text\]\{highlight:yellow\} \[ Marked \d+:\d\d \]\{color\}here/);
    s = run(caret(s, 'Marked', 2), toggleMarker);
    expect(map(s).split('\n')[3]).toBe('normal: body [text]{highlight:yellow} here');
  });
});
