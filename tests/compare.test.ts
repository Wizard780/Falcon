import { describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { COMPARE_EVENT, compareText, compareTexts, selectionText, type Piece } from '../src/editor/doc-tools/compare';
import { createView } from '../src/editor/editor';
import { BINDINGS } from '../src/editor/keybinds';
import '../src/editor/keymap';
import { make } from './helpers';

// the plugin's own cases, so Falcon's panel finds the same differences
const marked = (pieces: Piece[]) => pieces.filter((p) => p.kind).map((p) => (p.kind === 3 ? '|' : p.text));
const joined = (pieces: Piece[]) => pieces.map((p) => p.text).join('');

describe('compareTexts', () => {
  it('finds no differences in identical texts', () => {
    const r = compareTexts('Same text.\nTwo lines.', 'Same text.\nTwo lines.');
    expect(r.diffs).toBe(0);
    expect(r.left).toEqual([{ text: 'Same text.\nTwo lines.', kind: 0, g: -1 }]);
  });
  it('rebuilds each side’s own text exactly', () => {
    const pairs = [['The big red dog ran home.', 'The small blue dog ran.'], ['', 'only right'], ['only left', ''],
      ['Hello  World\nagain', 'hello World again'], ['a b c d e f', 'f e d c b a'], ['don’t — stop', "don't - stop!"]];
    for (const [a, b] of pairs) for (const o of [{}, { mode: 'chars' as const }, { ignoreCase: true, ignoreSpace: true }, { mode: 'chars' as const, ignoreSpace: true }]) {
      const r = compareTexts(a, b, o);
      expect(joined(r.left), JSON.stringify([a, b, o])).toBe(a);
      expect(joined(r.right), JSON.stringify([a, b, o])).toBe(b);
    }
  });
  it('makes a rewritten phrase one difference, and an insertion leaves a marker on the other side', () => {
    const r = compareTexts('The big red dog ran home.', 'The small blue dog ran home.');
    expect(r.diffs).toBe(1);
    expect([marked(r.left), marked(r.right)]).toEqual([['big red'], ['small blue']]);
    expect([r.removed, r.added, r.unit]).toEqual([2, 2, 'word']);
    const merged = compareTexts('hyperscalers a recession', 'investors a slowdown');
    expect(merged.diffs).toBe(1);
    expect([merged.removed, merged.added]).toEqual([2, 2]);
    const ins = compareTexts('cause a recession.', 'could cause a severe recession.');
    expect(ins.diffs).toBe(2);
    expect([marked(ins.left), marked(ins.right)]).toEqual([['|', '|'], ['could ', ' severe']]);
  });
  it('marks the exact byte in Characters mode when the words mostly match, whole words otherwise', () => {
    const quote = compareTexts('don’t stop', "don't stop", { mode: 'chars' });
    expect([marked(quote.left), marked(quote.right)]).toEqual([['don', '’', 't'], ['don', "'", 't']]);
    expect(quote.left.filter((p) => p.kind === 2).map((p) => p.text)).toEqual(['’']);
    expect([quote.removed, quote.added, quote.unit]).toEqual([1, 1, 'character']);
    const swap = compareTexts('nearly all', 'almost all', { mode: 'chars' });
    expect([marked(swap.left), marked(swap.right)]).toEqual([['nearly'], ['almost']]);
  });
  it('flags spacing and case in Words mode; the Ignore options hide only those', () => {
    expect(compareTexts('Data  center', 'Data center').diffs).toBe(1);
    expect(compareTexts('Data center', 'data center').diffs).toBe(1);
    expect(compareTexts('Data  center\nboom', 'Data center boom', { ignoreSpace: true }).diffs).toBe(0);
    expect(compareTexts('DATA center', 'data Center', { ignoreCase: true }).diffs).toBe(0);
    expect(compareTexts('Data center', 'Datacenter', { ignoreSpace: true }).diffs).toBe(1);
    const comma = compareTexts('a, b', 'a b');
    expect([comma.diffs, comma.removed, comma.added]).toEqual([1, 0, 0]);
  });
  it('compares a card against its whole source article fast and exactly', () => {
    const words = Array.from({ length: 9000 }, (_, i) => `w${(i * 7919) % 1000}`);
    const t = Date.now();
    const r = compareTexts(words.slice(4000, 4300).join(' '), words.join(' '));
    expect(Date.now() - t).toBeLessThan(1000);
    expect(r.timedOut).toBe(false);
    expect(r.removed).toBe(0);
  });
});

describe('the Compare Text command', () => {
  it('is a command, and reads the selection with each paragraph on its own line', () => {
    expect(BINDINGS.find((b) => b.id === 'compareText')?.label).toBe('Compare Text');
    const s = make([['normal', 'alpha beta'], ['normal', 'gamma delta']]);
    const s2 = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 7, s.doc.content.size - 7)));
    expect(selectionText(s2)).toBe('beta\ngamma');
  });
  it('opens the panel with the selection as Text 1', () => {
    const got: string[] = [];
    const on = (e: Event) => got.push((e as CustomEvent<string>).detail);
    addEventListener(COMPARE_EVENT, on);
    const view = createView(document.createElement('div'), () => {}, make([['normal', 'China will attack']]).doc);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    expect(compareText(view.state, view.dispatch, view)).toBe(true);
    removeEventListener(COMPARE_EVENT, on);
    view.destroy();
    expect(got).toEqual(['China']);
  });
});
