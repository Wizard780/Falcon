import { beforeEach, describe, expect, it } from 'vitest';
import { undo } from 'prosemirror-history';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { falconKeys as K } from '../src/editor/keymap';
import { CARD_TOOLS } from '../src/editor/card-tools';
import { schema } from '../src/editor/schema';
import { toggleRead } from '../src/editor/read';
import {
  backgroundToHighlight, condenseWithWarning, extractCard, extractUndertag, highlightToBackground, lockHighlighting, nearestHighlight,
} from '../src/editor/card-tools/edit';
import { referenceHTML, referenceNodes } from '../src/editor/card-tools/reference';
import { at, caret, make, map, run, select } from './helpers';

const M = schema.marks;
const card = () => make([
  ['block', 'Block'],
  ['tag', 'Grid tag'],
  ['normal', 'Smith 24, Professor at MIT'],
  ['normal', 'First   para  of text.'],
  ['normal', 'Second para here.'],
  ['normal', 'Third para last.'],
  ['tag', 'Next tag'],
  ['normal', 'Jones 23'],
  ['normal', 'Other card body.'],
]);
const lines = (s: EditorState) => map(s).split('\n');
/** Apply a mark to the first occurrence of text. */
function mark(s: EditorState, text: string, m: ReturnType<typeof M.cite.create>) {
  const t = select(s, text);
  return t.apply(t.tr.addMark(t.selection.from, t.selection.to, m));
}
/** The color marks on the first character of text: [highlight color, shading color]. */
function colors(s: EditorState, text: string) {
  const pos = select(s, text).selection.from;
  const marks = s.doc.resolve(pos + 1).marks();
  return [M.highlight.isInSet(marks)?.attrs.color ?? null, M.shading.isInSet(marks)?.attrs.color ?? null];
}
const unchanged = (s: EditorState, cmd: Parameters<typeof run>[1]) => {
  expect(cmd(s, () => {})).toBe(false);
  expect(run(s, cmd).doc.eq(s.doc)).toBe(true);
};
const reading = (s: EditorState) => run(s, toggleRead);

beforeEach(() => localStorage.clear());

describe('Card menu', () => {
  it('lists the CardMirror sections and keys', () => {
    expect(CARD_TOOLS.map((s) => s.title)).toEqual(['Condense', 'Excerpt', 'Highlighting']);
    expect(CARD_TOOLS[0].items.map((i) => i.key)).toEqual(['F3', 'Alt-F3', 'Mod-Alt-F3', undefined, undefined, 'Mod-Alt-Shift-F3']);
    expect(K['Alt-Shift-F8']).toBe(extractCard);
  });
  it('editing items do nothing in read mode', () => {
    const s = reading(caret(card(), 'First'));
    for (const it of CARD_TOOLS.flatMap((x) => x.items)) if (it.label !== 'Create Reference') expect(it.run(s, () => {})).toBe(false);
  });
});

describe('Condense With Warning', () => {
  it('merges the touched paragraphs between pause and resume lines, in one undo step', () => {
    const s0 = select(card(), 'para  of', 'Second para');
    const s = run(s0, condenseWithWarning(false));
    expect(lines(s).slice(2, 7)).toEqual([
      'normal: Smith 24, Professor at MIT',
      'normal: [PARAGRAPH INTEGRITY PAUSES]',
      'normal: First para of text. Second para here.',
      'normal: [PARAGRAPH INTEGRITY RESUMES]',
      'normal: Third para last.',
    ]);
    expect(run(s, undo).doc.eq(s0.doc)).toBe(true);
  });
  it('and Shrink shrinks the merged text but not the markers, still one undo step', () => {
    const s0 = select(mark(card(), 'para here', M.underline.create()), 'First', 'here');
    const s = run(s0, condenseWithWarning(true));
    expect(lines(s).slice(3, 6)).toEqual([
      'normal: [PARAGRAPH INTEGRITY PAUSES]',
      'normal: [First para of text. Second ]{size:8pt}[para here]{underline}[.]{size:8pt}',
      'normal: [PARAGRAPH INTEGRITY RESUMES]',
    ]);
    expect(run(s, undo).doc.eq(s0.doc)).toBe(true);
  });
  it('does nothing without a selection, on the tag or cite, across cards, or outside a card', () => {
    const cmd = condenseWithWarning(false);
    unchanged(caret(card(), 'First'), cmd);
    unchanged(select(card(), 'tag', 'First'), cmd);
    unchanged(select(card(), 'Smith', 'First'), cmd);
    unchanged(select(card(), 'last', 'Other'), cmd);
    unchanged(select(card(), 'Block'), cmd);
    unchanged(reading(select(card(), 'First')), cmd);
  });
  it('ignores a paragraph the selection only grazes, and a selection of just a line break', () => {
    const s = card();
    const end = at(s, 'para  of text.', 'para  of text.'.length), next = at(s, 'Third');
    const grazed = s.apply(s.tr.setSelection(TextSelection.create(s.doc, end, at(s, 'Second', 6))));
    expect(lines(run(grazed, condenseWithWarning(false))).slice(4, 7)).toEqual([
      'normal: [PARAGRAPH INTEGRITY PAUSES]', 'normal: Second para here.', 'normal: [PARAGRAPH INTEGRITY RESUMES]',
    ]);
    unchanged(s.apply(s.tr.setSelection(TextSelection.create(s.doc, next - 2, next))), condenseWithWarning(false));
    const blank = make([['tag', 'T'], ['normal', 'Cite'], ['normal', 'One'], ['normal', ''], ['normal', 'Two']]);
    const e = at(blank, 'One', 3) + 2;
    unchanged(blank.apply(blank.tr.setSelection(TextSelection.create(blank.doc, e, e + 2))), condenseWithWarning(false));
    unchanged(blank.apply(blank.tr.setSelection(TextSelection.create(blank.doc, e, e + 2))), extractCard);
  });
  it('survives a .docx round trip as plain text', async () => {
    const { docToDocx } = await import('../src/docx/export');
    const { docxToDoc } = await import('../src/docx/import');
    const s = run(select(card(), 'First'), condenseWithWarning(false));
    const back = await docxToDoc(await docToDocx(s.doc));
    const texts: string[] = [];
    back.forEach((p) => texts.push(`${p.attrs.style}: ${p.textContent}`));
    expect(texts.slice(3, 6)).toEqual(['normal: [PARAGRAPH INTEGRITY PAUSES]', 'normal: First para of text.', 'normal: [PARAGRAPH INTEGRITY RESUMES]']);
  });
});

describe('Extract Undertag', () => {
  it('copies the selection into an undertag under the tag, below existing undertags', () => {
    let s = make([['tag', 'Tag'], ['undertag', 'Old note'], ['normal', 'Smith 24'], ['normal', 'Key  phrase in body.']]);
    s = run(select(s, 'Key  phrase'), extractUndertag);
    expect(lines(s)).toEqual(['tag: Tag', 'undertag: Old note', 'undertag: Key phrase', 'normal: Smith 24', 'normal: Key  phrase in body.']);
    expect(s.selection.empty && s.selection.$from.parent.textContent === 'Key phrase').toBe(true);
  });
  it('wraps in quotes when the setting is on', () => {
    localStorage.setItem('falcon.extractUndertag.quotes', 'on');
    const s = run(select(card(), 'Second para', 'Third'), extractUndertag);
    expect(lines(s)[2]).toBe('undertag: "Second para here. Third"');
  });
  it('does nothing with no selection, under an analytic, or outside a card', () => {
    unchanged(caret(card(), 'First'), extractUndertag);
    unchanged(select(make([['analytic', 'An'], ['normal', 'Body']]), 'Body'), extractUndertag);
    unchanged(select(card(), 'Block'), extractUndertag);
  });
});

describe('Extract Card (Alt-Shift-F8)', () => {
  it('copies the selected text under the tag and cite as a new card below, leaving the source and selection alone', () => {
    const s0 = select(card(), 'para  of', 'Second');
    const out = run(s0, K['Alt-Shift-F8']);
    expect(lines(out).slice(1, 11)).toEqual([
      'tag: Grid tag',
      'normal: Smith 24, Professor at MIT',
      'normal: First   para  of text.',
      'normal: Second para here.',
      'normal: Third para last.',
      'tag: Grid tag',
      'normal: Smith 24, Professor at MIT',
      'normal: para  of text.',
      'normal: Second',
      'tag: Next tag',
    ]);
    expect([out.selection.from, out.selection.to]).toEqual([s0.selection.from, s0.selection.to]);
    let scrolled: boolean | undefined;
    extractCard(s0, (tr) => { scrolled = tr.scrolledIntoView; });
    expect(scrolled).toBe(false);
  });
  it('works under an analytic, copying a cite only when it is marked', () => {
    const s = run(select(make([['analytic', 'An'], ['normal', 'Body one'], ['normal', 'Body two']]), 'two'), extractCard);
    expect(lines(s)).toEqual(['analytic: An', 'normal: Body one', 'normal: Body two', 'analytic: An', 'normal: two']);
  });
  it('does nothing with no selection, in the tag or cite, across cards, or in read mode', () => {
    unchanged(caret(card(), 'First'), extractCard);
    unchanged(select(card(), 'Grid'), extractCard);
    unchanged(select(card(), 'Professor'), extractCard);
    unchanged(select(card(), 'last', 'Jones'), extractCard);
    unchanged(reading(select(card(), 'First')), extractCard);
  });
});

describe('Create Reference', () => {
  const hl = () => mark(mark(card(), 'Smith 24', M.cite.create()), 'para here', M.highlight.create({ color: 'green' }));
  it('builds a <<CITE FOR REFERENCE>> line and the selection 3pt smaller with highlights as gray background', () => {
    const nodes = referenceNodes(select(hl(), 'Second', 'last'))!;
    expect(nodes.map((n) => n.textContent)).toEqual(['<<SMITH 24 FOR REFERENCE>>', 'Second para here.', 'Third para last']);
    const doc = schema.node('doc', null, nodes);
    const s = make([['normal', 'x']]);
    const r = s.apply(s.tr.replaceWith(0, s.doc.content.size, doc.content));
    expect(colors(r, 'para here')).toEqual([null, '#C0C0C0']);
    expect(lines(r)[1]).toBe('normal: [Second ]{size:8pt}[para here]{shading+size:8pt}[.]{size:8pt}');
    const html = referenceHTML(nodes);
    expect(html).toContain('&lt;&lt;SMITH 24 FOR REFERENCE&gt;&gt;');
    expect(html).toMatch(/background-color: ?(#C0C0C0|rgb\(192, 192, 192\))/);
    expect(html).toMatch(/font-size: ?8pt/);
  });
  it('follows the settings: no heading, no shrink, same-color background', () => {
    localStorage.setItem('falcon.reference.heading', 'off');
    localStorage.setItem('falcon.reference.shrink', '0');
    localStorage.setItem('falcon.reference.highlights', 'convert');
    const nodes = referenceNodes(select(hl(), 'para here'))!;
    expect(nodes.length).toBe(1);
    expect(nodes[0].firstChild!.marks.map((m) => `${m.type.name}:${m.attrs.color}`)).toEqual(['shading:#00FF00']);
  });
  it('does nothing outside card body text', () => {
    expect(referenceNodes(caret(card(), 'First'))).toBeNull();
    expect(referenceNodes(select(card(), 'Smith'))).toBeNull();
    expect(referenceNodes(select(card(), 'last', 'Jones'))).toBeNull();
  });
});

describe('Lock Highlighting', () => {
  const hl = () => mark(mark(mark(card(), 'Grid', M.highlight.create()), 'First', M.highlight.create({ color: 'cyan' })), 'Other', M.highlight.create());
  it('locks the whole card at the cursor and nothing else', () => {
    const s = run(caret(hl(), 'Third'), lockHighlighting);
    expect(colors(s, 'Grid')).toEqual([null, '#C0C0C0']);
    expect(colors(s, 'First')).toEqual([null, '#C0C0C0']);
    expect(colors(s, 'Other')).toEqual(['yellow', null]);
  });
  it('locks just the selection, keeping a background already there', () => {
    const base = mark(hl(), 'First', M.shading.create({ color: '#FFF2CC' }));
    const s = run(select(base, 'First', 'Other'), lockHighlighting);
    expect(colors(s, 'Grid')).toEqual(['yellow', null]);
    expect(colors(s, 'First')).toEqual([null, '#FFF2CC']);
    expect(colors(s, 'Other')).toEqual([null, '#C0C0C0']);
  });
  it('does nothing under a block heading, or with no highlights', () => {
    unchanged(caret(hl(), 'Block'), lockHighlighting);
    unchanged(caret(card(), 'First'), lockHighlighting);
  });
});

describe('Highlight and background conversion', () => {
  it('Highlight to Background keeps the color', () => {
    const s = run(select(mark(card(), 'First', M.highlight.create({ color: 'cyan' })), 'Smith', 'Second'), highlightToBackground);
    expect(colors(s, 'First')).toEqual([null, '#00FFFF']);
  });
  it('Background to Highlight picks the nearest highlight color', () => {
    const s = run(select(mark(card(), 'First', M.shading.create({ color: '#D9D9D9' })), 'First'), backgroundToHighlight);
    expect(colors(s, 'First')).toEqual(['lightGray', null]);
    expect(nearestHighlight('#FFFF00')).toBe('yellow');
    expect(nearestHighlight('#00807F')).toBe('darkCyan');
  });
  it('do nothing without a selection or with nothing to convert', () => {
    const s = mark(card(), 'First', M.highlight.create());
    unchanged(caret(s, 'First'), highlightToBackground);
    unchanged(select(s, 'Second'), highlightToBackground);
    unchanged(select(s, 'First'), backgroundToHighlight);
  });
});

