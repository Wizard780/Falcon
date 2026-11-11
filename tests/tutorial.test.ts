import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import '../src/editor/keymap'; // registers the formatting bindings
import { bindingOf, setKey, resetKey } from '../src/editor/keybinds';
import { between, isFreshProfile, nextStep, placeCard, ringBox } from '../src/ui/Tutorial';
import { SAMPLE, STEPS, findText, marked, sampleDoc, styleOf, type Step, type TourCtx } from '../src/ui/tutorial-steps';

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

describe('the ring', () => {
  const vw = 1440, vh = 900;
  it('pads a button all round', () => {
    expect(ringBox({ left: 100, top: 100, width: 40, height: 30 }, vw, vh)).toEqual({ left: 94, top: 94, width: 52, height: 42 }); // no line flag
  });
  it('keeps a line of text\'s edge (1.5 px, drawn outside) off the lines touching it', () => {
    const line = { left: 366, top: 150, width: 1050, height: 19 };
    const r = ringBox(line, vw, vh, { above: 0, below: 0 });
    expect(r.top - 1.5).toBeGreaterThanOrEqual(line.top);
    expect(r.top + r.height + 1.5).toBeLessThanOrEqual(line.top + line.height);
    expect(r.line).toBe(true);
    expect(r.left).toBe(360); // still padded sideways
  });
  it('uses up to half of a gap, and the full pad past it', () => {
    const line = { left: 0, top: 100, width: 10, height: 20 };
    const r = ringBox(line, vw, vh, { above: 8, below: 40 });
    expect(r.top - 1.5).toBeGreaterThanOrEqual(100 - 4); // half the 8 px gap
    expect(r.top + r.height).toBe(124.25); // 6 px pad, less the 1.5 px edge and a quarter pixel
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
  const ctx = (state: EditorState): TourCtx => ({ view: () => ({ state }) as never, ccOpen: () => false, closeCc: () => {}, depth: () => 3, setDepth: () => {} });
  const byTitle = (t: string) => STEPS.find((s) => s.title === t)!;
  it('the sample starts as a block heading over one unformatted card', () => {
    const doc = sampleDoc();
    expect(doc.childCount).toBe(4);
    expect(doc.firstChild!.attrs.style).toBe('block');
    expect(doc.firstChild!.textContent).toBe(SAMPLE.block);
    doc.forEach((p, _, k) => { if (k > 0) expect(p.attrs.style).toBe('normal'); });
    expect(doc.textContent).toContain(SAMPLE.author);
    expect(doc.textContent).toContain(SAMPLE.sentence);
  });
  it('each is done only after its command runs', () => {
    let s = EditorState.create({ doc: sampleDoc() });
    s = pick(s, SAMPLE.tag);
    expect(byTitle('Make a tag').done!(ctx(s))).toBe(false);
    s = run('tag', s);
    expect(styleOf(s.doc, SAMPLE.tag)).toBe('tag');
    expect(styleOf(s.doc, SAMPLE.block)).toBe('block'); // the heading above is left alone
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
  it('the outline step shows down to tags, then puts your depth back', () => {
    const s = byTitle('The outline');
    let depth = 2;
    const c: TourCtx = { view: () => null, ccOpen: () => false, closeCc: () => {}, depth: () => depth, setDepth: (n) => { depth = n; } };
    s.enter!(c);
    expect(depth).toBe(4);
    s.leave!(c);
    expect(depth).toBe(2);
  });
  it('the outline text mentions the tag only once there is one', () => {
    let st = EditorState.create({ doc: sampleDoc() });
    const body = () => (byTitle('The outline').body as (c: TourCtx) => string)(ctx(st));
    expect(body()).not.toContain('tag you made');
    st = run('tag', pick(st, SAMPLE.tag));
    expect(body()).toContain('tag you made');
  });
  it('the command center step is done once it opens', () => {
    const s = byTitle('The command center');
    const c = { view: () => null, closeCc: () => {}, depth: () => 3, setDepth: () => {} };
    expect(s.done!({ ...c, ccOpen: () => true })).toBe(true);
    expect(s.done!({ ...c, ccOpen: () => false })).toBe(false);
  });
  it('the text names the key as it is bound now, and a button when it has none', () => {
    const body = () => (byTitle('Make a tag').body as () => string)();
    expect(body()).toContain('F7');
    setKey('tag', 'F2');
    expect(body()).toContain('F2');
    setKey('tag', '');
    expect(body()).toMatch(/^Your cursor is on the card's first line\. Click Tag/);
    resetKey('tag');
  });
});
