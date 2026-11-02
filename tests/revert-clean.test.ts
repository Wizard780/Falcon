import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docxBytes, freshStorage, mountApp, unmountAll } from './app-harness';
import { undo } from 'prosemirror-history';

const saveFile = vi.fn(async (o: { path?: string; name: string }) => ({ name: 'A.docx', path: o.path ?? '/x/A.docx' }));

async function openA() {
  const file = { name: 'A.docx', path: '/x/A.docx', data: await docxBytes('aaa') };
  const app = await mountApp({ saveFile, openFile: async () => file });
  await app.menu('open');
  const unsaved = () => !!app.el.querySelector('.fs-docs .dot');
  /** Delete the `n` characters before the caret, the way Backspace does. */
  const backspace = (n: number) => app.act(() => { const v = app.view(), at = v.state.selection.from; v.dispatch(v.state.tr.delete(at - n, at)); });
  return { app, unsaved, backspace };
}

beforeEach(async () => {
  await freshStorage();
  saveFile.mockClear();
});
afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

describe('a doc edited back to how it was opened', () => {
  it('is clean again after deleting what was typed', async () => {
    const { app, unsaved, backspace } = await openA();
    expect(unsaved()).toBe(false);
    await app.type('xyz');
    expect(unsaved()).toBe(true);
    await backspace(3);
    expect(app.text()).toBe('aaa');
    expect(unsaved()).toBe(false);
  });

  it('is clean again after undo', async () => {
    const { app, unsaved } = await openA();
    await app.type('xyz');
    expect(unsaved()).toBe(true);
    await app.act(() => { const v = app.view(); undo(v.state, v.dispatch); });
    expect(app.text()).toBe('aaa');
    expect(unsaved()).toBe(false);
  });

  it('closes without asking', async () => {
    const { app, backspace } = await openA();
    await app.type('xyz');
    await backspace(3);
    await app.menu('close');
    expect(app.tabs()).toEqual(['Untitled']); // a dirty doc would stop at the confirm and stay open
  });

  it('compares against the last save, not the open', async () => {
    const { app, unsaved, backspace } = await openA();
    await app.type('b');
    await app.menu('save', 200);
    expect(unsaved()).toBe(false);
    await app.type('c');
    expect(unsaved()).toBe(true);
    await backspace(1);
    expect(unsaved()).toBe(false); // back to the saved "baaa"
    await backspace(1);
    expect(unsaved()).toBe(true); // back to the opened "aaa", which is no longer what's on disk
  });

  it('a new Untitled typed into and cleared is clean', async () => {
    const app = await mountApp({});
    const unsaved = () => !!app.el.querySelector('.fs-docs .dot');
    await app.type('hi');
    expect(unsaved()).toBe(true);
    await app.act(() => { const v = app.view(); v.dispatch(v.state.tr.delete(v.state.selection.from - 2, v.state.selection.from)); });
    expect(unsaved()).toBe(false);
  });
});
