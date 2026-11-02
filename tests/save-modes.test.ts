import { describe, expect, it } from 'vitest';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { schema, type ParaStyle } from '../src/editor/schema';
import { markedDoc, readDoc, sendDoc } from '../src/editor/save-modes';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';

const M = schema.marks;
const hl = () => M.highlight.create({ color: 'cyan' });
const red = () => M.color.create({ color: '#FF0000' });
const cite = () => M.cite.create();
type Run = string | [string, Mark[]];
const p = (style: ParaStyle, ...runs: Run[]) =>
  schema.node('paragraph', { style }, runs.map((r) => (typeof r === 'string' ? schema.text(r) : schema.text(r[0], r[1]))));
const doc = (...paras: PMNode[]) => schema.node('doc', null, paras);
const lines = (d: PMNode | null) => {
  const out: string[] = [];
  d?.forEach((n) => out.push(`${n.attrs.style}: ${n.textContent}`));
  return out;
};

describe('Send Doc', () => {
  it('drops analytics and undertags and keeps the cards', () => {
    const d = doc(p('block', 'AT: Econ'), p('analytic', 'They concede growth'), p('tag', 'Growth is high'), p('undertag', 'read this first'), p('normal', 'Smith 24'), p('normal', 'body'));
    expect(lines(sendDoc(d))).toEqual(['block: AT: Econ', 'tag: Growth is high', 'normal: Smith 24', 'normal: body']);
  });
  it('drops the text under an analytic with it', () => {
    const d = doc(p('tag', 'A'), p('normal', 'a body'), p('analytic', 'B'), p('normal', 'b more'), p('tag', 'C'), p('normal', 'c body'));
    expect(lines(sendDoc(d))).toEqual(['tag: A', 'normal: a body', 'tag: C', 'normal: c body']);
  });
  it('keeps formatting on what stays', () => {
    const d = doc(p('tag', 'T'), p('normal', ['read', [hl()]], ' skip'));
    expect(sendDoc(d)!.child(1).eq(d.child(1))).toBe(true);
  });
});

describe('Read Doc', () => {
  it('keeps headings, the cite and only highlighted text, one space where text was cut', () => {
    const d = doc(
      p('hat', 'Contention 1'),
      p('tag', 'Warming is real'),
      p('normal', ['Smith 24', [cite()]], ', professor'),
      p('normal', 'unread start ', ['the planet', [hl()]], ' is ', ['warming', [hl()]], ' fast'),
      p('normal', 'all unread'),
      p('normal', ['and it', [hl()]], ' will ', ['kill us', [hl()]]),
    );
    const r = readDoc(d)!;
    expect(lines(r)).toEqual(['hat: Contention 1', 'tag: Warming is real', 'normal: Smith 24', 'normal: the planet warming and it kill us']);
    // the highlight survives, so Word shows the same thing
    let marked = 0;
    r.child(3).forEach((n) => { if (n.marks.some((m) => m.type.name === 'highlight')) marked++; });
    expect(marked).toBe(4);
  });
  it('shows red markers and leaves text outside cards out', () => {
    const d = doc(p('normal', ['intro highlighted', [hl()]]), p('tag', 'T'), p('normal', ['read', [hl()]], ' x ', [' Marked 3:15 ', [red()]]));
    // the marker's own space stands in for the cut text: no double space in Word
    expect(lines(readDoc(d))).toEqual(['tag: T', 'normal: read Marked 3:15 ']);
  });
  it('round-trips through .docx with only the read text', async () => {
    const d = doc(p('tag', 'T'), p('normal', 'hidden ', ['shown', [hl()]], ' hidden'));
    const back = await docxToDoc(await docToDocx(readDoc(d)!));
    expect(lines(back)).toEqual(['tag: T', 'normal: shown']);
  });
});

describe('Marked Doc', () => {
  const d = doc(
    p('pocket', 'Aff'),
    p('hat', 'Contention 1'),
    p('tag', 'Unmarked card'), p('normal', 'body one'),
    p('tag', 'Marked card'), p('normal', 'read up to ', [' Marked ', [red()]], ' here'),
    p('hat', 'Contention 2'),
    p('tag', 'Also unmarked'), p('normal', 'body'),
    p('pocket', 'Neg'),
    p('block', 'AT: Thing'),
    p('analytic', ['red analytic', [red()]]),
    p('tag', 'Second marked'), p('normal', ['all red', [red()]]),
  );
  it('keeps only cards with red text, under the headings they sit in', () => {
    expect(lines(markedDoc(d))).toEqual([
      'pocket: Aff', 'hat: Contention 1', 'tag: Marked card', 'normal: read up to  Marked  here',
      'pocket: Neg', 'block: AT: Thing', 'analytic: red analytic', 'tag: Second marked', 'normal: all red',
    ]);
  });
  it('is empty when nothing is marked', () => {
    expect(markedDoc(doc(p('tag', 'T'), p('normal', 'b')))).toBeNull();
  });
  it('counts other colors as unmarked', () => {
    const blue = M.color.create({ color: '#0000FF' });
    expect(markedDoc(doc(p('tag', 'T'), p('normal', ['blue', [blue]])))).toBeNull();
  });
});
