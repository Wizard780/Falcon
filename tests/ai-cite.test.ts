import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../src/editor/schema';
import { bridge } from '../src/editor/host';
import { P, resetPrefs, setPref } from '../src/editor/prefs';
import { BUILT_IN_PROMPT, MAX_PRESETS, aiCitePlugin, citeLines, citeNodes, citePresets, citePrompt, currentPreset, deletePreset, editPreset, savePreset, formatCite, newPreset, parseCite, reformatCites, usePreset } from '../src/editor/ai-cite';

const para = (text: string, cite = '') => schema.node('paragraph', null, [
  ...(cite ? [schema.text(cite, [schema.marks.cite.create()])] : []),
  ...(text ? [schema.text(text)] : []),
]);
function viewOf(paras: ReturnType<typeof para>[], from?: number, to?: number) {
  const doc = schema.node('doc', null, paras);
  let state = EditorState.create({ doc, plugins: [aiCitePlugin] });
  if (from !== undefined) state = state.apply(state.tr.setSelection(TextSelection.create(doc, from, to)));
  return new EditorView(document.createElement('div'), { state });
}
const reply = (cite: string, token: string) => `[[CITE]]\n${cite}\n[[TOKENS]]\n${token}\n[[END]]`;
const marked = (v: EditorView, i = 0) => {
  const out: string[] = [];
  v.state.doc.child(i).forEach((n) => { if (schema.marks.cite.isInSet(n.marks)) out.push(n.text!); });
  return out.join('|');
};

beforeEach(() => { resetPrefs(); localStorage.clear(); setPref(P.aiOn, true); });

describe('reading the reply', () => {
  it('splits the cite from its tokens', () => {
    expect(parseCite(`sure\n[[CITE]]\nSmith '24 [Jo; May 1; Prof]\n[[TOKENS]]\nSmith '24\n[[END]]`)).toEqual({ cite: "Smith '24 [Jo; May 1; Prof]", tokens: ["Smith '24"] });
  });
  it('takes a reply cut off before [[END]]', () => {
    expect(parseCite('[[CITE]]\nA 1 [b]\n[[TOKENS]]\nA 1')?.tokens).toEqual(['A 1']);
  });
  it('takes a plain answer from a prompt of your own as the cite', () => {
    expect(parseCite('Doe, Jane. "A Title."\nJournal, 2020.\n')).toEqual({ cite: 'Doe, Jane. "A Title." Journal, 2020.', tokens: [] });
    expect(parseCite('```\nDoe 20 [x]\n```')).toEqual({ cite: 'Doe 20 [x]', tokens: [] });
  });
  it('never lets a marker into the doc', () => {
    expect(parseCite('[[CITE]] Doe 20 [x]\n[[END]]')).toEqual({ cite: 'Doe 20 [x]', tokens: [] });
    expect(parseCite('[[CITE]]\nDoe 20 [x]')).toEqual({ cite: 'Doe 20 [x]', tokens: [] });
    expect(parseCite('Doe 20 [x]\n[[TOKENS]]\nDoe 20\n[[END]]')).toEqual({ cite: 'Doe 20 [x]', tokens: ['Doe 20'] });
    expect(parseCite('[[CITE]] Doe 20 [x] [[TOKENS]] Doe 20 [[END]]')).toEqual({ cite: 'Doe 20 [x]', tokens: ['Doe 20'] });
  });
  it('refuses an empty answer', () => {
    expect(parseCite('  \n ')).toBeNull();
    expect(parseCite('[[CITE]]\n\n[[TOKENS]]\nx\n[[END]]')).toBeNull();
  });
  it('marks a token even when the quotes differ', () => {
    const { nodes, marked: ok } = citeNodes({ cite: 'Smith ’24 [Jo]', tokens: ["Smith '24"] });
    expect(ok).toBe(true);
    expect(nodes.map((n) => n.text)).toEqual(['Smith ’24', ' [Jo]']);
  });
  it('says so when no token is there', () => {
    expect(citeNodes({ cite: 'Smith 24', tokens: ['Jones'] }).marked).toBe(false);
  });
});

describe('Format cite', () => {
  it('swaps the selection for a marked cite, in one undo step', async () => {
    bridge.aiAsk = vi.fn(async () => ({ text: reply('Smith 24 [Jo Smith]', 'Smith 24') }));
    const v = viewOf([para('john smith 2024')], 1, 16);
    const say = vi.fn();
    await formatCite(v, say);
    expect(v.state.doc.textContent).toBe('Smith 24 [Jo Smith]');
    expect(marked(v)).toBe('Smith 24');
    expect(say).toHaveBeenLastCalledWith('Cite formatted.');
  });
  it('sends the prompt with today filled in', async () => {
    const ask = vi.fn(async () => ({ text: reply('A 1', 'A 1') }));
    bridge.aiAsk = ask;
    await formatCite(viewOf([para('x')], 1, 2), () => {});
    const req = (ask.mock.calls[0] as unknown[])[0] as { system: string; maxTokens: number };
    expect(req.system).not.toContain('{DATE}');
    expect(req.system).toContain(String(new Date().getFullYear()));
    expect(req.maxTokens).toBe(8192);
  });
  it('merges a citation pasted over two lines', async () => {
    bridge.aiAsk = vi.fn(async () => ({ text: reply('Smith 24 [x]', 'Smith 24') }));
    const v = viewOf([para('one'), para('two'), para('after')], 1, 9);
    await formatCite(v, () => {});
    expect(v.state.doc.childCount).toBe(2);
    expect(v.state.doc.child(0).textContent).toBe('Smith 24 [x]');
  });
  it('leaves the next line alone on a triple click', async () => {
    bridge.aiAsk = vi.fn(async () => ({ text: reply('Smith 24 [x]', 'Smith 24') }));
    const v = viewOf([para('one'), para('two')], 1, 6);
    await formatCite(v, () => {});
    expect(v.state.doc.childCount).toBe(2);
    expect(v.state.doc.child(1).textContent).toBe('two');
  });
  it('lands in the right place after edits above it', async () => {
    let answer!: (r: { text: string }) => void;
    bridge.aiAsk = vi.fn(() => new Promise<{ text: string }>((r) => { answer = r; }));
    const v = viewOf([para('top'), para('cite')], 6, 10);
    const run = formatCite(v, () => {});
    v.dispatch(v.state.tr.insertText('more ', 1));
    answer({ text: reply('Smith 24', 'Smith 24') });
    await run;
    expect(v.state.doc.child(0).textContent).toBe('more top');
    expect(v.state.doc.child(1).textContent).toBe('Smith 24');
  });
  it('locks the text while it works, and leaves the rest editable', async () => {
    let answer!: (r: { text: string }) => void;
    bridge.aiAsk = vi.fn(() => new Promise<{ text: string }>((r) => { answer = r; }));
    const v = viewOf([para('cite'), para('other')], 1, 5);
    const run = formatCite(v, () => {});
    v.dispatch(v.state.tr.insertText('X', 3));
    expect(v.state.doc.child(0).textContent).toBe('cite');
    v.dispatch(v.state.tr.insertText('Y', 7));
    expect(v.state.doc.child(1).textContent).toBe('Yother');
    answer({ text: reply('Smith 24', 'Smith 24') });
    await run;
    expect(v.state.doc.child(0).textContent).toBe('Smith 24');
  });
  it('a second run on the same text waits its turn', async () => {
    let answer!: (r: { text: string }) => void;
    const ask = vi.fn(() => new Promise<{ text: string }>((r) => { answer = r; }));
    bridge.aiAsk = ask;
    const v = viewOf([para('cite')], 1, 5);
    const run = formatCite(v, () => {});
    const say = vi.fn();
    await formatCite(v, say);
    expect(say.mock.lastCall![0]).toContain('Try again');
    expect(ask).toHaveBeenCalledTimes(1);
    answer({ text: reply('A', 'A') });
    await run;
  });
  it('asks nothing with AI off or no selection', async () => {
    const ask = vi.fn();
    bridge.aiAsk = ask;
    setPref(P.aiOn, false);
    const say = vi.fn();
    await formatCite(viewOf([para('x')], 1, 2), say);
    expect(say.mock.lastCall![0]).toContain('Settings > AI');
    setPref(P.aiOn, true);
    await formatCite(viewOf([para('x')], 1, 1), say);
    expect(say.mock.lastCall![0]).toContain('Select');
    expect(ask).not.toHaveBeenCalled();
  });
  it('shows the error and keeps the text', async () => {
    bridge.aiAsk = vi.fn(async () => ({ error: 'nope' }));
    const v = viewOf([para('x')], 1, 2);
    const say = vi.fn();
    await formatCite(v, say);
    expect(v.state.doc.textContent).toBe('x');
    expect(say).toHaveBeenLastCalledWith('nope');
  });
});

describe('prompt presets', () => {
  it('starts on the built-in prompt', () => {
    expect(currentPreset()).toBeNull();
    expect(citePrompt()).toContain('[[TOKENS]]');
  });
  it('the prompt editor saves a new preset only on Save, then edits it in place', () => {
    const id = savePreset(null, '  ', 'mine on {DATE}')!;
    expect(currentPreset()).toMatchObject({ id, name: 'Preset 1', prompt: 'mine on {DATE}' });
    expect(savePreset(id, 'House', 'changed')).toBe(id);
    expect(citePresets()).toEqual([{ id, name: 'House', prompt: 'changed' }]);
    // a blank name keeps the old one
    savePreset(id, '', 'changed again');
    expect(currentPreset()?.name).toBe('House');
  });
  it('fills {DATE} the way CardMirror does, M-D-YYYY', () => {
    savePreset(null, 'd', 'on {DATE}.');
    const d = new Date();
    expect(citePrompt()).toBe(`on ${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}.`);
  });
  it('New preset copies the prompt in use and starts using it', () => {
    newPreset();
    expect(currentPreset()).toMatchObject({ name: 'Preset 1', prompt: BUILT_IN_PROMPT });
    editPreset(currentPreset()!.id, { prompt: 'first on {DATE}' });
    newPreset();
    expect(currentPreset()).toMatchObject({ name: 'Preset 2', prompt: 'first on {DATE}' });
    expect(citePrompt()).not.toContain('{DATE}');
  });
  it('a blank preset falls back to the built-in prompt', () => {
    newPreset();
    editPreset(currentPreset()!.id, { prompt: '  ' });
    expect(citePrompt()).toContain('[[CITE]]');
  });
  it('the Use Prompt Preset commands count from one, and zero is the built-in', () => {
    newPreset();
    newPreset();
    expect(usePreset(1)).toBe('Preset 1');
    expect(currentPreset()!.name).toBe('Preset 1');
    expect(usePreset(0)).toBe('the built-in prompt');
    expect(currentPreset()).toBeNull();
    expect(usePreset(9)).toBeNull();
  });
  it('deleting the one in use goes back to the built-in', () => {
    newPreset();
    deletePreset(currentPreset()!.id);
    expect(currentPreset()).toBeNull();
    expect(citePresets()).toEqual([]);
  });
  it('stops at ten, and survives a broken list', () => {
    for (let i = 0; i < MAX_PRESETS + 2; i++) newPreset();
    expect(citePresets()).toHaveLength(MAX_PRESETS);
    setPref(P.aiCitePresets, 'not json');
    expect(citePresets()).toEqual([]);
  });
});

describe('Reformat every cite', () => {
  const docWith = () => viewOf([para(' [a]', 'A 1'), para('body text'), para(' [b]', 'B 2'), para(' [c]', 'C 3')]);
  const stay = { stopped: () => false, progress: () => {} };
  it('finds the lines holding a cite', () => {
    expect(citeLines(docWith().state.doc)).toHaveLength(3);
  });
  it('rewrites each one once, in order', async () => {
    const seen: string[] = [];
    bridge.aiAsk = vi.fn(async (r: { text: string }) => { seen.push(r.text); return { text: reply(`New ${seen.length} [longer than it was]`, `New ${seen.length}`) }; });
    const v = docWith();
    const rep = await reformatCites(v, stay);
    expect(seen).toEqual(['A 1 [a]', 'B 2 [b]', 'C 3 [c]']);
    expect(rep).toMatchObject({ done: 3, failed: 0, stopped: false });
    expect(v.state.doc.child(1).textContent).toBe('body text');
    expect(v.state.doc.child(3).textContent).toBe('New 3 [longer than it was]');
  });
  it('moves past a failed cite instead of retrying it', async () => {
    const seen: string[] = [];
    bridge.aiAsk = vi.fn(async (r: { text: string }) => { seen.push(r.text); return seen.length === 1 ? { error: 'x' } : { text: reply('N', 'N') }; });
    const rep = await reformatCites(docWith(), stay);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    expect(rep).toMatchObject({ done: 2, failed: 1 });
  });
  it('ends on a bad key, and after three failures in a row', async () => {
    const stop = vi.fn(async () => ({ error: 'bad key', stop: true }));
    bridge.aiAsk = stop;
    expect(await reformatCites(docWith(), stay)).toMatchObject({ failed: 1, stopped: true });
    expect(stop).toHaveBeenCalledTimes(1);
    const fail = vi.fn(async () => ({ error: 'x' }));
    bridge.aiAsk = fail;
    const four = viewOf([para(' [a]', 'A 1'), para(' [b]', 'B 2'), para(' [c]', 'C 3'), para(' [d]', 'D 4')]);
    expect(await reformatCites(four, stay)).toMatchObject({ failed: 3, stopped: true });
    expect(fail).toHaveBeenCalledTimes(3);
  });
  it('Esc stops before the next cite', async () => {
    let stop = false;
    bridge.aiAsk = vi.fn(async () => { stop = true; return { text: reply('N', 'N') }; });
    expect(await reformatCites(docWith(), { stopped: () => stop, progress: () => {} })).toMatchObject({ done: 1, stopped: true });
  });
});

describe('cites with several authors', () => {
  const four = `[[CITE]]\nAndrew S. Bowen ’26. Analyst at CRS.\nSarah E. Garding. Analyst at CRS.\nDerek E. Mix. Specialist at CRS.\n“Title.” CRS. August 11, 2026. https://x.gov/a.pdf.\n[[TOKENS]]\nBowen ’26\nGarding\nMix\n[[END]]`;
  it('keeps each line of a [[CITE]] block', () => {
    expect(parseCite(four)!.cite.split('\n')).toHaveLength(4);
  });
  it('puts the lines in as hard breaks in one paragraph, cite mark on the lead, bold on co-authors', () => {
    const { nodes, marked: ok } = citeNodes(parseCite(four)!);
    expect(ok).toBe(true);
    expect(nodes.filter((n) => n.type.name === 'hard_break')).toHaveLength(3);
    const withMark = (m: string) => nodes.filter((n) => n.marks.some((k) => k.type.name === m)).map((n) => n.text);
    expect(withMark('cite')).toEqual(['Bowen ’26']);
    expect(withMark('bold')).toEqual(['Garding', 'Mix']);
  });
  it('still gives a CardMirror-style second token with the date the cite mark', () => {
    const { nodes } = citeNodes({ cite: 'Laura Weiss & John Bresnahan 3/26 [x]', tokens: ['Weiss & ', 'Bresnahan 3/26'] });
    expect(nodes.filter((n) => n.marks.some((k) => k.type.name === 'cite')).map((n) => n.text)).toEqual(['Weiss & ', 'Bresnahan 3/26']);
  });
  it('formats a four-author cite into one paragraph with line breaks', async () => {
    bridge.aiAsk = vi.fn(async () => ({ text: four }));
    const v = viewOf([para('Bowen ’8-11 [stuff]')], 1, 20);
    await formatCite(v, () => {});
    expect(v.state.doc.childCount).toBe(1);
    expect(v.state.doc.textBetween(0, v.state.doc.content.size, '\n', '\n').split('\n')).toHaveLength(4);
    expect(marked(v)).toBe('Bowen ’26');
  });
});
