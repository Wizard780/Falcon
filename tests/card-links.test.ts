import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { createState } from '../src/editor/editor';
import { schema, type ParaStyle } from '../src/editor/schema';
import { canGoBack, cardIndex, cardLinksKey, linkBack, parseCite, refAt, refsIn } from '../src/editor/card-links';
import { at } from './helpers';

const cite = schema.marks.cite.create();
/** [style, text] paragraphs; a body paragraph written "[[Clare 23]] rest" gets "Clare 23" cite-marked. */
function doc(paras: [ParaStyle, string][]) {
  return createState(schema.node('doc', null, paras.map(([style, text]) => {
    const m = /^\[\[(.+?)\]\](.*)$/.exec(text);
    const content = m ? [schema.text(m[1], [cite]), ...(m[2] ? [schema.text(m[2])] : [])] : text ? [schema.text(text)] : [];
    return schema.node('paragraph', { style }, content);
  })));
}
const FILE: [ParaStyle, string][] = [
  ['block', 'Frontlines'],
  ['analytic', 'Extend clare 23, and Altman 2026 is the impact turn. Jones 19 is not in the file.'],
  ['normal', 'Their Smith 22 cards do not answer it.'],
  ['block', 'Evidence'],
  ['tag', 'Compute caps survive treaty collapse'],
  ['undertag', 'a note above the cite'],
  ['normal', '[[Clare 23]] (Stephen Clare, 80,000 Hours)'],
  ['normal', 'The body of Clare'],
  ['tag', 'AI race risk outweighs'],
  ['normal', "[[Altman '26]] (Sam Altman, testimony)"],
  ['normal', 'Altman body'],
  ['tag', 'Treaties fail'],
  ['normal', '[[Smith 22]] (Jordan Smith)'],
  ['tag', 'Partial verification deters'],
  ['normal', '[[Smith, 2022]] (Alana Smith)'],
  ['analytic', 'An analytic, no cite line'],
  ['normal', 'Clare 23 says so (plain text, not a cite)'],
];
const posOf = (s: EditorState, t: string) => { let p = -1; s.doc.forEach((n, o) => { if (p < 0 && n.textContent === t) p = o; }); return p; };

describe('card links', () => {
  it('reads a cite name and year in the usual shapes', () => {
    expect(parseCite('Clare 23')).toEqual({ name: 'Clare', year: '23' });
    expect(parseCite("Altman '26")).toEqual({ name: 'Altman', year: '26' });
    expect(parseCite('Smith, 2022 [Jordan Smith]')).toEqual({ name: 'Smith', year: '22' });
    expect(parseCite('Smith and Jones 21')).toEqual({ name: 'Smith and Jones', year: '21' });
    expect(parseCite('No year here')).toBeNull();
  });

  it('indexes each card under its cite, skipping undertags, and keeps cards that share a name', () => {
    const s = doc(FILE);
    const idx = cardIndex(s.doc);
    expect([...idx.cards.keys()].sort()).toEqual(['altman 26', 'clare 23', 'smith 22']);
    expect(idx.cards.get('clare 23')![0].pos).toBe(posOf(s, 'Compute caps survive treaty collapse'));
    expect(idx.cards.get('clare 23')![0].end).toBe(posOf(s, 'AI race risk outweighs'));
    expect(idx.cards.get('smith 22')).toHaveLength(2);
  });

  it('finds typed names in any case and year form, but not unknown names or the cite itself', () => {
    const s = doc(FILE);
    const para = s.doc.child(1);
    const names = refsIn(s.doc, para, s.doc.child(0).nodeSize + 1).map((r) => s.doc.textBetween(r.from, r.to));
    expect(names).toEqual(['clare 23', 'Altman 2026']);
    expect(refAt(s.doc, at(s, 'Smith 22', 3))!.cards).toHaveLength(2);
    expect(refAt(s.doc, at(s, 'Jones 19', 2))).toBeNull();
  });

  it('a name typed as plain text in a body paragraph links, the cite-marked one does not', () => {
    const s = doc(FILE);
    expect(refAt(s.doc, at(s, 'Clare 23 says', 2))).not.toBeNull();
    const citeLine = posOf(s, 'Clare 23 (Stephen Clare, 80,000 Hours)');
    expect(refAt(s.doc, citeLine + 3)).toBeNull();
  });

  it('Back returns to where the link was clicked, mapped through edits', () => {
    let s = doc(FILE);
    expect(canGoBack(s)).toBe(false);
    const from = at(s, 'Extend', 3);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, from)));
    const card = cardIndex(s.doc).cards.get('clare 23')![0];
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, card.pos + 1)).setMeta(cardLinksKey, { push: s.selection.head, flash: [card.pos, card.end] }));
    expect(canGoBack(s)).toBe(true);
    s = s.apply(s.tr.insertText('xx', 2)); // typing above the spot moves it
    let next = s;
    expect(linkBack(s, (tr) => { next = s.apply(tr); })).toBe(true);
    expect(next.selection.head).toBe(from + 2);
    expect(canGoBack(next)).toBe(false);
    expect(linkBack(next)).toBe(false);
  });
});
