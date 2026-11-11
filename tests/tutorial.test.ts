import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import '../src/editor/keymap'; // registers the formatting bindings
import { bindingOf, setKey, resetKey } from '../src/editor/keybinds';
import { between, isFreshProfile, nextStep, placeCard } from '../src/ui/Tutorial';
import { SAMPLE, STEPS, findText, firstStyle, marked, sampleDoc, type Step, type TourCtx } from '../src/ui/tutorial-steps';

const step = (title: string, extra: Partial<Step> = {}): Step => ({ title, body: '', ...extra });

describe('walking the steps', () => {
  const steps = [step('a'), step('b', { target: '.gone' }), step('c'), step('d', { target: '.gone' })];
  const has = (s: Step) => s.target !== '.gone';
  it('skips a step whose target is missing, both ways', () => {
    expect(nextStep(steps, -1, 1, has)).toBe(0);
    expect(nextStep(steps, 0, 1, has)).toBe(2);
    expect(nextStep(steps, 2, -1, has)).toBe(0);
  });
  it('ends past the last step (a missing last step too), and Back stops at the first', () => {
    expect(nextStep(steps, 2, 1, has)).toBe(-1);
    expect(nextStep(steps, 0, -1, has)).toBe(0);
    expect(nextStep([step('x', { target: '.gone' })], -1, 1, has)).toBe(-1); // nothing to show: it ends, never stalls
  });
});

describe('the card', () => {
  const vw = 1440, vh = 900, w = 320, h = 130;
  const inside = (p: { left: number; top: number }) => p.left >= 0 && p.top >= 0 && p.left + w <= vw && p.top + h <= vh;
  it('centers with no target', () => {
    expect(placeCard([], w, h, vw, vh)).toEqual({ left: 560, top: 385 });
  });
  it('goes below a target near the top, above one near the bottom, and stays inside the window', () => {
    const top = placeCard([{ left: 0, top: 10, width: 36, height: 36 }], w, h, vw, vh);
    expect(top.top).toBeGreaterThan(46);
    expect(inside(top)).toBe(true);
    const low = placeCard([{ left: 4, top: 850, width: 36, height: 36 }], w, h, vw, vh);
    expect(low.top + h).toBeLessThan(850);
    expect(inside(low)).toBe(true);
  });
  it('keeps off every target, not just the first', () => {
    const line = { left: 360, top: 120, width: 1060, height: 20 }, button = { left: 340, top: 45, width: 90, height: 36 };
    const p = placeCard([line, button], w, h, vw, vh);
    for (const r of [line, button]) expect(p.top > r.top + r.height || p.top + h < r.top || p.left > r.left + r.width || p.left + w < r.left).toBe(true);
  });
  it('a target as big as the window still gets a card inside it', () => {
    expect(inside(placeCard([{ left: 0, top: 0, width: vw, height: vh }], w, h, vw, vh))).toBe(true);
  });
  it('the ring glides between same-sized lists and jumps otherwise', () => {
    const a = [{ left: 0, top: 0, width: 10, height: 10 }], b = [{ left: 100, top: 100, width: 20, height: 20 }];
    expect(between(a, b, 0)).toEqual(a);
    expect(between(a, b, 1)).toEqual(b);
    expect(between(a, b, 0.5)[0].left).toBeGreaterThan(50); // ease-out: past halfway at half time
    expect(between([], b, 0.2)).toEqual(b);
  });
});

describe('a fresh profile', () => {
  const store = (keys: Record<string, string>) => ({ getItem: (k: string) => keys[k] ?? null }) as Storage;
  it('is one Falcon has never launched in', () => {
    expect(isFreshProfile(store({}))).toBe(true);
    expect(isFreshProfile(store({ 'falcon.lineHeightMoved': 'on' }))).toBe(true); // written as modules load, before the check
  });
  it('is not an existing install, even one without the seen flag', () => {
    expect(isFreshProfile(store({ 'falcon.zoom': '1' }))).toBe(false);
    expect(isFreshProfile(store({ 'falcon.recents.v1': '[]' }))).toBe(false);
  });
});

describe('the hands-on steps', () => {
  const run = (id: string, state: EditorState) => { let out = state; bindingOf(id)!.run!(state, (tr) => { out = state.apply(tr); }); return out; };
  const pick = (state: EditorState, text: string) => {
    const r = findText(state.doc, text)!;
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, r.from, r.to)));
  };
  const ctx = (state: EditorState): TourCtx => ({ view: () => ({ state }) as never, ccOpen: () => false, closeCc: () => {} });
  const byTitle = (t: string) => STEPS.find((s) => s.title === t)!;
  it('the sample starts as one unformatted card', () => {
    const doc = sampleDoc();
    expect(doc.childCount).toBe(3);
    doc.forEach((p) => expect(p.attrs.style).toBe('normal'));
    expect(doc.textContent).toContain(SAMPLE.author);
    expect(doc.textContent).toContain(SAMPLE.sentence);
  });
  it('each is done only after its command runs', () => {
    let s = EditorState.create({ doc: sampleDoc() });
    s = pick(s, SAMPLE.tag);
    expect(byTitle('Make a tag').done!(ctx(s))).toBe(false);
    s = run('tag', s);
    expect(firstStyle(s.doc)).toBe('tag');
    expect(byTitle('Make a tag').done!(ctx(s))).toBe(true);
    s = pick(s, SAMPLE.author);
    expect(byTitle('Mark the cite').done!(ctx(s))).toBe(false);
    s = run('cite', s);
    expect(byTitle('Mark the cite').done!(ctx(s))).toBe(true);
    s = pick(s, SAMPLE.sentence);
    expect(byTitle('Underline').done!(ctx(s))).toBe(false);
    s = run('underline', s);
    expect(marked(s.doc, SAMPLE.sentence, 'underline')).toBe(true);
    expect(byTitle('Highlight').done!(ctx(s))).toBe(false);
    s = run('highlight', s);
    expect(byTitle('Highlight').done!(ctx(s))).toBe(true);
  });
  it('the command center step is done once it opens', () => {
    const s = byTitle('The command center');
    expect(s.done!({ view: () => null, ccOpen: () => true, closeCc: () => {} })).toBe(true);
    expect(s.done!({ view: () => null, ccOpen: () => false, closeCc: () => {} })).toBe(false);
  });
  it('the text names the key as it is bound now, and a button when it has none', () => {
    const body = () => (byTitle('Make a tag').body as () => string)();
    expect(body()).toContain('F7');
    setKey('tag', 'F2');
    expect(body()).toContain('F2');
    setKey('tag', '');
    expect(body()).toMatch(/^Your cursor is on the first line\. Click Tag/);
    resetKey('tag');
  });
});
