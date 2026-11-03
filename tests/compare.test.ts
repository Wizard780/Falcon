import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { compareDecorations, compareKey, compareText, compareTexts, selectionText, summary, TOAST_EVENT, type CompareOpts } from '../src/editor/doc-tools/compare';
import { createView } from '../src/editor/editor';
import { bridge } from '../src/editor/host';
import { BINDINGS } from '../src/editor/keybinds';
import '../src/editor/keymap';
import { at, make, select } from './helpers';

/** Each edit as "removed>added", in the two texts. */
const show = (a: string, b: string, opts: CompareOpts = {}) =>
  compareTexts(a, b, opts).edits.map((e) => `${a.slice(e.aFrom, e.aTo)}>${b.slice(e.bFrom, e.bTo)}`);

beforeEach(() => localStorage.clear());

describe('compareTexts', () => {
  it('finds nothing in identical text', () => {
    expect(show('The plan solves war.', 'The plan solves war.')).toEqual([]);
  });
  it('marks a swapped word whole', () => {
    expect(show('growth is nearly certain', 'growth is almost certain')).toEqual(['nearly>almost']);
  });
  it('marks just the letters when the words mostly match', () => {
    expect(show('the colour of money', 'the color of money')).toEqual(['u>']);
    expect(show('it’s over', "it's over")).toEqual(['’>\'']);
  });
  it('finds a dropped and an added word', () => {
    expect(show('China will not attack Taiwan', 'China will attack Taiwan')).toEqual(['not >']);
    expect(show('China will attack Taiwan', 'China will not attack Taiwan')).toEqual(['>not ']);
  });
  it('joins a rewritten phrase across a short match', () => {
    expect(show('a sharp rise in the rates', 'a sudden fall in the prices')).toEqual(['sharp rise>sudden fall', 'rates>prices']);
  });
  it('ignores spacing and line breaks when asked', () => {
    expect(show('one two\nthree', 'one  two three', { ignoreSpace: true })).toEqual([]);
    expect(show('one two\nthree', 'one  two three')).toEqual(['> ', '\n> ']);
  });
  it('ignores case only when asked', () => {
    expect(show('The Plan', 'the plan')).toEqual(['T>t', 'P>p']);
    expect(show('The Plan', 'the plan', { ignoreCase: true })).toEqual([]);
  });
  it('leaves the rest of the copied article out when the selection is part of it', () => {
    const card = 'The economy grows when trade is open.';
    const article = 'Last year was hard. The plan failed. The economy grows when trade is open. Critics disagree.';
    const r = compareTexts(card, article, { ignoreSpace: true });
    expect(r.edits).toEqual([]);
    expect(r.moreBefore && r.moreAfter).toBe(true);
    expect(summary(card, article, r, { ignoreSpace: true })).toBe('Matches the clipboard (ignoring spacing). The clipboard also has text before and after it');
  });
  it('still finds a change inside an excerpt', () => {
    const article = 'Intro text. The economy grows when trade is open. Critics disagree.';
    expect(show('The economy shrinks when trade is open.', article, { ignoreSpace: true })).toEqual(['shrinks>grows']);
  });
  it('says identical only when the text is the same byte for byte', () => {
    const r = compareTexts('a b', 'a  b', { ignoreSpace: true });
    expect(summary('a b', 'a  b', r, { ignoreSpace: true })).toBe('Matches the clipboard (ignoring spacing)');
    expect(summary('a b', 'a b', compareTexts('a b', 'a b'), {})).toBe('Identical to the clipboard');
  });
});

describe('marks on the page', () => {
  const doc = () => make([['tag', 'Tag'], ['normal', 'alpha beta'], ['normal', 'gamma delta']]);
  it('reads the selection with a break between paragraphs and keeps each character’s position', () => {
    const s = select(doc(), 'beta', 'gamma');
    const { text, pos } = selectionText(s);
    expect(text).toBe('beta\ngamma');
    expect(pos[0]).toBe(at(s, 'beta'));
    expect(pos[4]).toBe(-1);
    expect(pos[5]).toBe(at(s, 'gamma'));
  });
  it('strikes removed words and puts clipboard-only text where it goes', () => {
    const s = select(doc(), 'alpha', 'delta');
    const { text, pos } = selectionText(s);
    const b = 'alpha beta gamma new delta';
    const r = compareTexts(text, b, { ignoreSpace: true });
    const set = compareDecorations(s.doc, pos, b, r.edits, s.selection.to);
    const found = set.find();
    expect(found).toHaveLength(1);
    expect(found[0].from).toBe(at(s, 'gamma', 5)); // right after "gamma"
    const r2 = compareTexts(text, 'alpha gamma delta', { ignoreSpace: true });
    const del = compareDecorations(s.doc, pos, 'alpha gamma delta', r2.edits, s.selection.to).find();
    expect(del.map((d) => [d.from, d.to])).toEqual([[at(s, 'beta'), at(s, 'beta', 4)]]);
  });
});

describe('the Compare Text command', () => {
  let toasts: string[] = [];
  const onToast = (e: Event) => toasts.push((e as CustomEvent<string>).detail);
  beforeEach(() => { toasts = []; addEventListener(TOAST_EVENT, onToast); });
  afterEach(() => { removeEventListener(TOAST_EVENT, onToast); delete bridge.readClipboardText; vi.restoreAllMocks(); });

  it('is a command in the command center, not a menu item', () => {
    expect(BINDINGS.find((b) => b.id === 'compareText')?.label).toBe('Compare Text');
  });
  it('marks the selection against the clipboard, and an edit or Esc clears the marks', async () => {
    const host = document.createElement('div');
    const view = createView(host, () => {}, make([['normal', 'China will not attack Taiwan today']]).doc);
    bridge.readClipboardText = async () => 'China will attack Taiwan soon';
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
    expect(compareText(view.state, view.dispatch, view)).toBe(true);
    await vi.waitFor(() => expect(compareKey.getState(view.state)).not.toBeNull());
    expect(host.querySelector('.f-cmp-del')?.textContent).toBe('not');
    expect(host.querySelector('.f-cmp-ins')?.textContent).toBe('soon');
    expect(toasts[0]).toMatch(/^2 differences/);
    view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(compareKey.getState(view.state)).toBeNull();
    view.destroy();
  });
  it('asks for a selection first', () => {
    const view = createView(document.createElement('div'), () => {}, make([['normal', 'text']]).doc);
    expect(compareText(view.state, view.dispatch, view)).toBe(true);
    expect(toasts[0]).toMatch(/^Select the text/);
    view.destroy();
  });
});
