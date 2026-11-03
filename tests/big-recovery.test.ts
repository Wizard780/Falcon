import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docxBytes, freshStorage, mountApp, unmountAll } from './app-harness';

// A block file is well over the 400k that fits in browser storage (Aarav's NATO AT Neg is ~830k).
const BIG = Array.from({ length: 450 }, (_, i) => `Card ${i} ${'warrant '.repeat(125)}`);
const saveFile = vi.fn(async (o: { path?: string; name: string }) => ({ name: o.name, path: o.path ?? `/x/${o.name}` }));
let disk = '';
const recovery = { read: () => disk, write: vi.fn((text: string) => { disk = text; }) };
/** What the desktop app hands the page: files to open, saves, and its recovery file. */
const desktop = (files: { name: string; data: Uint8Array }[]) => {
  let n = 0;
  return { saveFile, recovery, openFile: async () => ({ ...files[n], path: `/x/${files[n++].name}` }) };
};
const backupWait = 1200; // a backup runs 800 ms after typing stops, at idle
/** Type, then wait for the backup in a second act: inside one, the app doesn't re-render (so its unsaved flag lags). */
const typeAndBackUp = async (app: Awaited<ReturnType<typeof mountApp>>, text: string) => { await app.type(text); await app.act(() => {}, backupWait); };

beforeEach(async () => {
  await freshStorage();
  saveFile.mockClear();
  recovery.write.mockClear();
  disk = '';
});
afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

describe('crash recovery for a file too big for browser storage', () => {
  it('keeps it in the desktop app\'s recovery file and brings the edit back after a crash', async () => {
    const big = { name: 'AT Neg.docx', data: await docxBytes(...BIG) };
    const app = await mountApp(desktop([big]));
    await app.menu('open', 300);
    expect(app.toast()).toBe('Opened AT Neg'); // no "too big for crash recovery"
    await typeAndBackUp(app, 'EDIT ');
    expect(disk).toContain('EDIT ');
    await app.unmount(); // the crash

    const back = await mountApp(desktop([]));
    expect(back.tabs()).toEqual(['AT Neg']);
    expect(back.text().startsWith('EDIT Card 0')).toBe(true);
    expect(back.el.querySelector('.fs-docs .dot')).not.toBeNull(); // still unsaved
  });

  it('keeps the rail\'s order when small and big files come back from different stores', async () => {
    const files = [{ name: 'Speech.docx', data: await docxBytes('speech') }, { name: 'AT Aff.docx', data: await docxBytes(...BIG) }, { name: 'Notes.docx', data: await docxBytes('notes') }];
    const app = await mountApp(desktop(files));
    for (const f of files) { await app.menu('open', 200); await typeAndBackUp(app, `${f.name} edit `); }
    await app.unmount();
    const back = await mountApp(desktop([]));
    expect(back.tabs()).toEqual(['Speech', 'AT Aff', 'Notes']);
  });

  it('empties the file once the big doc is saved and closed', async () => {
    const app = await mountApp(desktop([{ name: 'AT Neg.docx', data: await docxBytes(...BIG) }]));
    await app.menu('open', 300);
    await typeAndBackUp(app, 'EDIT ');
    expect(disk).not.toBe('');
    await app.menu('save', 300);
    await app.menu('close', backupWait);
    expect(disk).toBe('');
  });

  it('still warns on the web, which has no recovery file', async () => {
    const app = await mountApp({ saveFile, openFile: async () => ({ name: 'AT Neg.docx', path: '/x/AT Neg.docx', data: await docxBytes(...BIG) }) });
    await app.menu('open', 300);
    expect(app.toast()).toMatch(/too big for crash recovery/);
  });
});
