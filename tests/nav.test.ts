import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { undo } from 'prosemirror-history';
import { make, caret, select, run } from './helpers';
import { alphabetize, canDrop, deleteSections, gotoStyle, moveSections, sectionAt, sectionsSlice, selectSections, topSections } from '../src/editor/nav/sections';
import { compute, letters, numberMarks, outlineNumbers, toggleRestart, toggleRole, setNavScope } from '../src/editor/nav/numbering';
import { navKeys } from '../src/editor/nav-keys';
import type { ParaStyle } from '../src/editor/schema';
import { buildOutline, searchOutline } from '../src/editor/outline';

const DOC: [ParaStyle, string][] = [
  ['block', 'B1'], ['tag', 'T1'], ['normal', 'b1'], ['tag', 'T2'], ['normal', 'b2'],
  ['block', 'B2'], ['tag', 'T3'], ['normal', 'b3'], ['analytic', 'A4'],
  ['hat', 'H'], ['block', 'B3'], ['tag', 'T5'],
];
const lines = (s: EditorState) => { const o: string[] = []; s.doc.forEach((n) => o.push(n.textContent)); return o.join(' '); };
/** Top-level position of the paragraph whose text is exactly `t`. */
const pos = (s: EditorState, t: string) => { let p = -1; s.doc.forEach((n, o) => { if (p < 0 && n.textContent === t) p = o; }); if (p < 0) throw new Error(t); return p; };
const apply = (s: EditorState, tr: ReturnType<typeof moveSections>) => { expect(tr).toBeTruthy(); return s.apply(tr!); };

describe('sections', () => {
  it('a section runs to the next heading at its level or above', () => {
    const s = make(DOC);
    const b1 = sectionAt(s.doc, pos(s, 'B1'))!;
    expect(b1.to).toBe(pos(s, 'B2'));
    expect(sectionAt(s.doc, pos(s, 'T1'))!.to).toBe(pos(s, 'T2'));
    expect(sectionAt(s.doc, pos(s, 'b1'))).toBeNull();
    // nested picks collapse into the outer section
    expect(topSections(s.doc, [pos(s, 'T1'), pos(s, 'B1')])).toHaveLength(1);
  });

  it('drops only where the structure allows', () => {
    const s = make(DOC);
    const block = topSections(s.doc, [pos(s, 'B1')]);
    expect(canDrop(s.doc, block, pos(s, 'B2'))).toBe(true);
    expect(canDrop(s.doc, block, pos(s, 'H'))).toBe(true);
    expect(canDrop(s.doc, block, s.doc.content.size)).toBe(true);
    expect(canDrop(s.doc, block, pos(s, 'T3'))).toBe(false); // would swallow T3's block's cards
    expect(canDrop(s.doc, block, pos(s, 'T2'))).toBe(false); // inside itself
    const card = topSections(s.doc, [pos(s, 'T1')]);
    expect(canDrop(s.doc, card, pos(s, 'T3'))).toBe(true);
    expect(canDrop(s.doc, card, pos(s, 'b3'))).toBe(false); // body text, not a boundary
  });

  it('moves a card into another block, carrying its body', () => {
    const s = make(DOC);
    const n = apply(s, moveSections(s, [pos(s, 'T1')], pos(s, 'A4')));
    expect(lines(n)).toBe('B1 T2 b2 B2 T3 b3 T1 b1 A4 H B3 T5');
  });

  it('moves a block down past the next one, and a no-op move does nothing', () => {
    const s = make(DOC);
    expect(lines(apply(s, moveSections(s, [pos(s, 'B1')], pos(s, 'H'))))).toBe('B2 T3 b3 A4 B1 T1 b1 T2 b2 H B3 T5');
    expect(moveSections(s, [pos(s, 'B1')], pos(s, 'B2'))).toBeNull();
    expect(moveSections(s, [pos(s, 'B1')], pos(s, 'T3'))).toBeNull();
  });

  it('copies instead of moving', () => {
    const s = make(DOC);
    expect(lines(apply(s, moveSections(s, [pos(s, 'T5')], pos(s, 'T1'), true)))).toBe('B1 T5 T1 b1 T2 b2 B2 T3 b3 A4 H B3 T5');
  });

  it('moves a scattered multi-selection stitched in document order', () => {
    const s = make(DOC);
    const n = apply(s, moveSections(s, [pos(s, 'T3'), pos(s, 'T1')], s.doc.content.size));
    expect(lines(n)).toBe('B1 T2 b2 B2 A4 H B3 T5 T1 b1 T3 b3');
  });

  it('deletes several sections as one undo step', () => {
    const s = make(DOC);
    const n = s.apply(deleteSections(s, [pos(s, 'T1'), pos(s, 'B2')])!);
    expect(lines(n)).toBe('B1 T2 b2 H B3 T5');
    expect(lines(run(n, undo))).toBe(lines(s));
  });

  it('deleting everything leaves one empty paragraph', () => {
    const s = make([['pocket', 'P'], ['tag', 'T']]);
    const n = s.apply(deleteSections(s, [0])!);
    expect(n.doc.childCount).toBe(1);
    expect(n.doc.textContent).toBe('');
  });

  it('copies and selects the heading with everything under it', () => {
    const s = make(DOC);
    const c = sectionsSlice(s.doc, [pos(s, 'T3'), pos(s, 'T1')]).content;
    expect(c.textBetween(0, c.size, '|')).toBe('T1|b1|T3|b3');
    const sel = s.apply(selectSections(s, [pos(s, 'T1')])!).selection;
    expect(s.doc.textBetween(sel.from, sel.to, '|')).toBe('T1|b1');
    expect(s.apply(selectSections(s, [pos(s, 'T1'), pos(s, 'T3')])!).selection.ranges).toHaveLength(2);
  });

  it('alphabetizes into the selected slots, numbers in numeric order, one step', () => {
    const s = make([['block', 'B'], ['tag', 'Card 10'], ['normal', 'x'], ['tag', 'keep'], ['tag', 'card 2'], ['normal', 'y'], ['tag', 'Apple']]);
    const n = s.apply(alphabetize(s, [pos(s, 'Card 10'), pos(s, 'card 2'), pos(s, 'Apple')])!);
    expect(lines(n)).toBe('B Apple keep card 2 y Card 10 x');
    expect(lines(run(n, undo))).toBe(lines(s));
    expect(alphabetize(n, [pos(n, 'Apple'), pos(n, 'card 2')])).toBeNull(); // already sorted
  });

  it('goes to the next and previous heading of one style', () => {
    let s = caret(make(DOC), 'b1');
    s = run(s, gotoStyle('tag', 1));
    expect(s.selection.$head.parent.textContent).toBe('T2');
    s = run(s, gotoStyle('tag', 1));
    expect(s.selection.$head.parent.textContent).toBe('T3'); // past the block
    s = run(s, gotoStyle('tag', 1));
    expect(s.selection.$head.parent.textContent).toBe('T5'); // analytics are skipped
    s = run(s, gotoStyle('block', -1));
    expect(s.selection.$head.parent.textContent).toBe('B3');
    s = run(s, gotoStyle('block', -1));
    expect(s.selection.$head.parent.textContent).toBe('B2');
    s = run(s, gotoStyle('hat', 1));
    expect(s.selection.$head.parent.textContent).toBe('H');
    s = run(s, gotoStyle('pocket', 1)); // none: stays
    expect(s.selection.$head.parent.textContent).toBe('H');
  });

  it('select and delete current heading keys act on the card at the cursor', () => {
    const s = caret(make(DOC), 'b3');
    const sel = run(s, navKeys['Alt-a']).selection;
    expect(s.doc.textBetween(sel.from, sel.to, '|')).toBe('T3|b3');
    expect(lines(run(s, navKeys['Mod-Alt-Backspace']))).toBe('B1 T1 b1 T2 b2 B2 A4 H B3 T5');
  });
});

describe('numbering', () => {
  const NUM: [ParaStyle, string][] = [['block', 'B1'], ['tag', 'T1'], ['tag', 'T2'], ['tag', 'T3'], ['tag', 'T4'], ['block', 'B2'], ['tag', 'T5'], ['tag', 'T6']];
  const labels = (s: EditorState) => outlineNumbers(s).join(',');

  it('letters', () => { expect([1, 2, 26, 27, 28].map(letters)).toEqual(['a', 'b', 'z', 'aa', 'ab']); });

  it('numbers cards, letters substructure, skips unmarked ones, restarts at blocks', () => {
    let s = select(make(NUM), 'T1', 'T6');
    s = run(s, toggleRole('number'));
    expect(labels(s)).toBe(',1.,2.,3.,4.,,1.,2.');
    s = run(caret(s, 'T2'), toggleRole('sub'));
    s = run(caret(s, 'T3'), toggleRole('sub'));
    s = run(caret(s, 'T4'), toggleRole('number'));
    expect(labels(s)).toBe(',1.,a.,b.,,,1.,2.');
    s = run(caret(s, 'T4'), toggleRole('number'));
    expect(labels(s)).toBe(',1.,a.,b.,2.,,1.,2.');
    // a block that continues
    s = run(caret(s, 'B2'), toggleRestart);
    expect(labels(s)).toBe(',1.,a.,b.,2.,,3.,4.');
    // a card that restarts
    s = run(caret(s, 'T6'), toggleRestart);
    expect(labels(s)).toBe(',1.,a.,b.,2.,,3.,1.');
    // display only: the text is untouched
    expect(s.doc.textContent).toBe('B1T1T2T3T4B2T5T6');
  });

  it('follows its cards through typing, moves and undo', () => {
    let s = run(select(make(NUM), 'T1', 'T4'), toggleRole('number'));
    expect(labels(s)).toBe(',1.,2.,3.,4.,,,');
    s = s.apply(s.tr.insertText('new text ', 1));
    expect(labels(s)).toBe(',1.,2.,3.,4.,,,');
    // T1 moves to the second block and keeps its number there
    s = apply(s, moveSections(s, [pos(s, 'T1')], s.doc.content.size));
    expect(numberMarks(s).size).toBe(4);
    expect(labels(s)).toBe(',1.,2.,3.,,,,1.');
    s = run(s, undo);
    expect(labels(s)).toBe(',1.,2.,3.,4.,,,');
    // a restyle to analytic keeps it
    s = s.apply(s.tr.setNodeMarkup(pos(s, 'T2'), undefined, { style: 'analytic', indent: 0 }));
    expect(labels(s)).toBe(',1.,2.,3.,4.,,,');
  });

  it('a deleted card gets its number back on undo; a card turned into text loses it', () => {
    let s = run(select(make(NUM), 'T1', 'T4'), toggleRole('number'));
    s = s.apply(deleteSections(s, [pos(s, 'T2')])!);
    expect(labels(s)).toBe(',1.,2.,3.,,,');
    s = run(s, undo);
    expect(labels(s)).toBe(',1.,2.,3.,4.,,,');
    s = s.apply(s.tr.setNodeMarkup(pos(s, 'T3'), undefined, { style: 'normal', indent: 0 }));
    expect(labels(s)).toBe(',1.,2.,3.,,,');
    expect(numberMarks(s).size).toBe(3);
  });

  it('acts on the outline selection when there is one', () => {
    let s = caret(make(NUM), 'T1');
    setNavScope(() => [pos(s, 'T5'), pos(s, 'T6'), pos(s, 'B2')]);
    s = run(s, toggleRole('number'));
    expect(labels(s)).toBe(',,,,,,1.,2.');
    setNavScope(() => []);
  });

  it('no marks, no cost', () => {
    const s = make(NUM);
    expect(compute(s.doc, new Map()).outline).toEqual([]);
  });
});

describe('outline search', () => {
  const S: [ParaStyle, string][] = [['block', 'Nuclear war'], ['tag', 'Warming bad'], ['normal', 'the “NUCLEAR” option'], ['block', 'Econ'], ['tag', 'Trade'], ['analytic', 'nuclear winter']];
  const rows = (s: EditorState) => buildOutline(s.doc);
  it('matches heading text, ignoring case and curly quotes, at one level or all', () => {
    const s = make(S);
    expect(searchOutline(rows(s), s.doc, 'NUCLEAR', 0, false)).toEqual([0, 4]);
    expect(searchOutline(rows(s), s.doc, 'nuclear', 3, false)).toEqual([0]);
    expect(searchOutline(rows(s), s.doc, '"nuclear"', 0, false)).toEqual([]);
  });
  it('with card text, a hit goes to the heading of the chosen level that holds it', () => {
    const s = make(S);
    expect(searchOutline(rows(s), s.doc, '"nuclear"', 0, true)).toEqual([1]);
    expect(searchOutline(rows(s), s.doc, 'option', 3, true)).toEqual([0]);
    expect(searchOutline(rows(s), s.doc, 'winter', 3, true)).toEqual([2]);
  });
});
