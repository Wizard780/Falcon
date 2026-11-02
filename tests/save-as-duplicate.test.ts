import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docxBytes, freshStorage, mountApp, unmountAll } from './app-harness';

// the user picks A.docx in the native Save As dialog, and Save writes wherever it is told
const saveFile = vi.fn(async (o: { path?: string; name: string }) => ({ name: 'A.docx', path: o.path ?? '/x/A.docx' }));
const session = () => JSON.parse(localStorage.getItem('falcon.session') ?? '[]') as string[];

/** Two files open, B in front; the next Save As will name its target A.docx, the file open in the other tab. */
async function twoFilesOpen() {
  const files = [
    { name: 'A.docx', path: '/x/A.docx', data: await docxBytes('aaa') },
    { name: 'B.docx', path: '/x/B.docx', data: await docxBytes('bbb') },
  ];
  let n = 0;
  const app = await mountApp({ saveFile, openFile: async () => files[n++] });
  await app.menu('open');
  return { app, openB: () => app.menu('open') };
}
async function saveAsOntoA(app: Awaited<ReturnType<typeof mountApp>>) {
  await app.menu('saveAs');
  await app.click(document.querySelector('.sa-mode[data-mode="asis"]'), 200);
}

beforeEach(async () => {
  await freshStorage();
  saveFile.mockClear();
});
afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

describe('Save As onto the file another tab has open', () => {
  it('closes the other tab when it has no unsaved changes', async () => {
    const { app, openB } = await twoFilesOpen();
    await openB();
    expect(app.tabs()).toEqual(['A', 'B']);
    await saveAsOntoA(app);
    expect(app.tabs()).toEqual(['A']);
    expect(app.text()).toBe('bbb');
    expect(session()).toEqual(['/x/A.docx']);
  });

  it('keeps the other tab when it has unsaved changes, but Save there can no longer overwrite the file', async () => {
    const { app, openB } = await twoFilesOpen();
    await app.type('unsaved ');
    await openB();
    await saveAsOntoA(app);
    expect(app.tabs()).toEqual(['A', 'A']);
    expect(session()).toEqual(['/x/A.docx']);

    await app.click(app.tab('A'));
    expect(app.text()).toBe('unsaved aaa');
    saveFile.mockClear();
    await app.menu('save');
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0][0].path).toBeUndefined();
  });
});

describe('a Send, Read or Marked doc saved onto the file another tab has open', () => {
  it('closes that tab, so its old copy can never be saved back over the export', async () => {
    const { app, openB } = await twoFilesOpen();
    await openB();
    await app.menu('saveAs');
    await app.click(document.querySelector('.sa-mode[data-mode="send"]'), 200);
    expect(saveFile.mock.calls.at(-1)![0].path).toBeUndefined();
    expect(app.tabs()).toEqual(['B']);
    expect(session()).toEqual(['/x/B.docx']);
  });
});
