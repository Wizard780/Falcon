import { afterEach, describe, expect, it, vi } from 'vitest';
import { docxBytes, freshStorage, mountApp, tick, unmountAll } from './app-harness';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { undo } from 'prosemirror-history';
import { make, run, select } from './helpers';

// each of these is a state that outlived what it belonged to: a doc that left the view, a room left behind,
// a dialog whose doc changed, a click armed for something else

afterEach(async () => { await unmountAll(); vi.restoreAllMocks(); });

const pending = <T,>() => { let done!: (v: T) => void; const p = new Promise<T>((r) => { done = r; }); return { p, done }; };
const reply = '[[CITE]]\nSmith 24 [x]\n[[TOKENS]]\nSmith 24\n[[END]]';

describe('an AI request when its doc leaves the view', () => {
  async function twoDocs() {
    await freshStorage();
    const { schema } = await import('../src/editor/schema');
    const { bridge } = await import('../src/editor/host');
    const { P, setPref } = await import('../src/editor/prefs');
    const { aiCitePlugin } = await import('../src/editor/ai-cite');
    setPref(P.aiOn, true);
    const para = (t: string, cite = false) => schema.node('paragraph', null, [schema.text(t, cite ? [schema.marks.cite.create()] : [])]);
    const state = (p: ReturnType<typeof para>) => EditorState.create({ doc: schema.node('doc', null, [p]), plugins: [aiCitePlugin] });
    let a = state(para('Smith 24 source', true));
    a = a.apply(a.tr.setSelection(TextSelection.create(a.doc, 1, 9)));
    const view = new EditorView(document.createElement('div'), { state: a });
    const ask = pending<{ text: string }>();
    bridge.aiAsk = vi.fn(() => ask.p);
    return { view, ask, other: state(para('another doc')) };
  }

  it('says so, and the text is not left locked', async () => {
    const { formatCite } = await import('../src/editor/ai-cite');
    const { view, ask, other } = await twoDocs();
    const say = vi.fn();
    const job = formatCite(view, say);
    const left = view.state;
    view.updateState(other); // a tab switch, as App's show() does it
    ask.done({ text: reply });
    await job;
    expect(say).toHaveBeenLastCalledWith("You left that document, so the cite wasn't put in.");
    expect(view.state.doc.textContent).toBe('another doc');
    view.updateState(left);
    expect(view.dom.querySelector('.ai-busy')).toBeNull();
    view.dispatch(view.state.tr.insertText('X', 3));
    expect(view.state.doc.textContent).toBe('SmXith 24 source');
  });

  it('still lands if you came back before the answer', async () => {
    const { formatCite } = await import('../src/editor/ai-cite');
    const { view, ask, other } = await twoDocs();
    const job = formatCite(view, () => {});
    const left = view.state;
    view.updateState(other);
    view.updateState(left);
    view.dispatch(view.state.tr.insertText('X', 3)); // still locked while it's out
    expect(view.state.doc.textContent).toBe('Smith 24 source');
    ask.done({ text: reply });
    await job;
    expect(view.state.doc.textContent).toBe('Smith 24 [x] source');
  });

  it('ends a Reformat pass instead of throwing out of it', async () => {
    const { reformatCites } = await import('../src/editor/ai-cite');
    const { view, ask, other } = await twoDocs();
    const pass = reformatCites(view, { stopped: () => false, progress: () => {} });
    view.updateState(other);
    ask.done({ text: reply });
    expect(await pass).toMatchObject({ done: 0, failed: 1, stopped: true });
  });
});

describe('the find bar', () => {
  it('Find and Replace opens the replace row on every press', async () => {
    await freshStorage();
    const app = await mountApp();
    const { navBinds } = await import('../src/editor/nav-keys');
    const replace = navBinds.find((b) => b.id === 'replace')!;
    for (let i = 0; i < 3; i++) {
      await app.act(() => { replace.run(app.view().state, app.view().dispatch); });
      expect(document.querySelector('.findbar .fb-with')).not.toBeNull();
      await app.act(() => { document.querySelector('.findbar input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
      expect(document.querySelector('.findbar')).toBeNull();
    }
  });

  it('Replace All does not claim matches an AI edit kept it from changing', async () => {
    await freshStorage();
    const { P, setPref } = await import('../src/editor/prefs');
    const { bridge } = await import('../src/editor/host');
    const { formatCite } = await import('../src/editor/ai-cite');
    const { requestFind } = await import('../src/editor/find');
    const app = await mountApp();
    setPref(P.aiOn, true);
    await app.type('alpha beta alpha');
    const v = app.view();
    await app.act(() => { v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, v.state.doc.content.size - 1))); });
    const ask = pending<{ text: string }>();
    bridge.aiAsk = vi.fn(() => ask.p);
    const job = formatCite(v, () => {});
    await app.act(() => { requestFind({ replace: true }); });
    await app.fill(document.querySelector('.findbar input'), 'alpha');
    await app.fill(document.querySelector('.findbar .fb-with'), 'zzz');
    const all = [...document.querySelectorAll('.findbar button')].find((b) => b.textContent === 'All')!;
    await app.act(() => { all.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
    expect(v.state.doc.textContent).toBe('alpha beta alpha');
    expect(app.toast()).toBe('An AI edit is working on some of those matches. Try again in a moment.');
    ask.done({ text: '' });
    await app.act(() => job);
  });
});

describe('Home Clear and Undo', () => {
  const recent = (name: string) => ({ name, path: `/x/${name}.docx`, folder: 'x', cards: 0, blocks: [], when: Date.now() });
  const stored = () => (JSON.parse(localStorage.getItem('falcon.recents.v1') ?? '[]') as { name: string }[]).map((r) => r.name);

  it('Undo brings back the whole list, not just the rows Home showed', async () => {
    const all = Array.from({ length: 20 }, (_, i) => `F${i}`);
    await freshStorage({ 'falcon.openHome': 'on', 'falcon.recents.v1': JSON.stringify(all.map(recent)) });
    const app = await mountApp();
    await app.click(document.querySelector('.hm-clear'));
    expect(stored()).toEqual([]);
    await app.click(document.querySelector('.hm-undo button'));
    expect(stored()).toEqual(all);
  });
});

describe('deleting an AI preset', () => {
  it('a Delete armed on one preset never deletes another', async () => {
    await freshStorage();
    const { P, setPref } = await import('../src/editor/prefs');
    const { citePresets, newPreset, usePreset } = await import('../src/editor/ai-cite');
    const app = await mountApp({ aiAsk: async () => ({ text: '' }) });
    await app.act(() => { setPref(P.aiOn, true); newPreset(); newPreset(); usePreset(1); });
    await app.press(',', { ctrlKey: true });
    await app.click([...document.querySelectorAll('.st-navb')].find((b) => b.textContent === 'AI') ?? null);
    const del = () => [...document.querySelectorAll('.st-btn')].find((b) => /Delete|Really/.test(b.textContent ?? '')) ?? null;
    await app.click(del());
    expect(del()?.textContent).toBe('Really delete?');
    await app.press('Escape');
    await app.press('Escape');
    expect(document.querySelector('.st-nav')).toBeNull();
    await app.act(() => { usePreset(2); });
    await app.press(',', { ctrlKey: true });
    expect(del()?.textContent).toBe('Delete');
    await app.click(del());
    expect(citePresets()).toHaveLength(2);
    await app.click(del());
    expect(citePresets().map((p) => p.name)).toEqual(['Preset 1']);
  });
});

describe('card numbers', () => {
  it('a number removed after an undo stays removed through the next delete and undo', async () => {
    const { deleteSections } = await import('../src/editor/nav/sections');
    const { numberMarks, toggleRole } = await import('../src/editor/nav/numbering');
    const pos = (s: EditorState, t: string) => { let p = -1; s.doc.forEach((n, o) => { if (p < 0 && n.textContent === t) p = o; }); return p; };
    const numbered = (s: EditorState) => numberMarks(s).has(pos(s, 'T2'));
    const cut = (s: EditorState) => run(s.apply(deleteSections(s, [pos(s, 'T2')])!), undo);
    let s = run(select(make([['tag', 'T1'], ['normal', 'b1'], ['tag', 'T2'], ['normal', 'b2'], ['tag', 'T3']]), 'T1', 'T3'), toggleRole('number'));
    s = cut(s);
    expect(numbered(s)).toBe(true);
    s = run(select(s, 'T2', 'T2'), toggleRole('number'));
    expect(numbered(s)).toBe(false);
    s = cut(s);
    expect(numbered(s)).toBe(false);
  });
});

describe('Save As while a file is opening', () => {
  it('writes the doc the dialog was opened on', async () => {
    await freshStorage();
    const { docxToDoc } = await import('../src/docx/import');
    const saveFile = vi.fn(async (o: { name: string; data: Uint8Array }) => ({ name: o.name, path: `/x/${o.name}` }));
    const file = pending<{ name: string; path: string; data: Uint8Array }>();
    const app = await mountApp({ saveFile, openFile: () => file.p });
    await app.type('the first doc');
    await app.menu('open'); // still reading the file
    await app.menu('saveAs');
    file.done({ name: 'B.docx', path: '/x/B.docx', data: await docxBytes('the second doc') });
    await app.act(() => {}, 200);
    expect(app.text()).toBe('the second doc');
    await app.click(document.querySelector('.sa-mode[data-mode="asis"]'), 200);
    expect((await docxToDoc(saveFile.mock.calls[0][0].data)).textContent).toBe('the first doc');
  });
});

describe('SpeechDrop answers from a room you left', () => {
  it('a late upload leaves the next room alone, and the rest of the batch stays unsent', async () => {
    await freshStorage();
    const rooms: Record<string, { name: string; files: { index: number; name: string; ctime: number }[] }> = {
      rd3abc: { name: 'Round 3', files: [] },
      rd4xyz: { name: 'Round 4', files: [{ index: 0, name: 'Round 4 file.docx', ctime: 1 }] },
    };
    const first = pending<{ ok: true; value: { files: { index: number; name: string; ctime: number }[]; index: number } }>();
    const api = {
      room: vi.fn(async (room: string) => ({ ok: true, value: { room, ...rooms[room] } })),
      upload: vi.fn(() => first.p),
      pick: vi.fn(async () => ({ ok: true, value: [{ name: 'one.docx', data: new Uint8Array(1) }, { name: 'two.docx', data: new Uint8Array(1) }] })),
      watch: vi.fn(() => () => {}),
    };
    const app = await mountApp({ speechdrop: api });
    const button = (t: string) => [...document.querySelectorAll('.sd button')].find((b) => b.textContent?.includes(t)) ?? null;
    const code = () => document.querySelector('input[aria-label="Room code"]');
    await app.act(() => window.dispatchEvent(new Event('falcon:sd-show')));
    await app.fill(code(), 'rd3abc', 100);
    await app.click(button('Upload a file') ?? button('Upload file') ?? button('files'));
    expect(api.upload).toHaveBeenCalledTimes(1);
    await app.click(button('Leave'));
    await app.fill(code(), 'rd4xyz', 100);
    first.done({ ok: true, value: { files: [{ index: 0, name: 'one.docx', ctime: 2 }], index: 0 } });
    await app.act(() => {}, 100);
    expect([...document.querySelectorAll('.sd-f .nm')].map((n) => n.textContent)).toEqual(['Round 4 file.docx']);
    expect(api.upload).toHaveBeenCalledTimes(1);
  });
});

describe('read mode', () => {
  it('the Doc menu Insert items do nothing', async () => {
    const { DOC_TOOLS } = await import('../src/editor/doc-tools');
    const { toggleRead } = await import('../src/editor/read');
    const s = run(make([['normal', 'text']]), toggleRead);
    const dispatch = vi.fn();
    for (const it of DOC_TOOLS[0].items) expect(it.run(s, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('a linked app asking to connect', () => {
  it('takes the question down when the main process stops waiting', async () => {
    await freshStorage();
    let ask!: (kind: string, p: Record<string, unknown>) => Promise<unknown>;
    let expired!: () => void;
    const app = await mountApp({ onBridge: (f: typeof ask) => { ask = f; return () => {}; }, onBridgeExpired: (f: () => void) => { expired = f; return () => {}; } });
    let answer: unknown;
    await app.act(() => { void ask('consent', { name: 'nimbus' }).then((a) => { answer = a; }); });
    expect(document.querySelector('.cf')?.textContent).toContain('Let Nimbus send cards');
    await app.act(() => { expired(); });
    expect(document.querySelector('.cf')).toBeNull();
    await tick(0);
    expect(answer).toEqual({ answer: null });
  });

  it('leaves a different question up', async () => {
    await freshStorage();
    let expired!: () => void;
    const app = await mountApp({ onBridgeExpired: (f: () => void) => { expired = f; return () => {}; } });
    await app.type('unsaved');
    await app.menu('close');
    expect(document.querySelector('.cf')).not.toBeNull();
    await app.act(() => { expired(); });
    expect(document.querySelector('.cf')).not.toBeNull();
  });
});
