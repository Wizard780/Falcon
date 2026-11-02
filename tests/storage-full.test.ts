import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docxBytes, freshStorage, mountApp, unmountAll } from './app-harness';

const saveFile = vi.fn(async (o: { path?: string; name: string }) => ({ name: o.name, path: o.path ?? `/x/${o.name}` }));
const fillStorage = () => vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });

beforeEach(async () => {
  await freshStorage();
  saveFile.mockClear();
});
afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

describe('browser storage is full', () => {
  it('still starts', async () => {
    fillStorage();
    const app = await mountApp({ saveFile });
    expect(app.tabs()).toEqual(['Untitled']);
  });

  it('keeps the editor on screen when a file is opened and saved', async () => {
    const file = { name: 'A.docx', path: '/x/A.docx', data: await docxBytes('aaa') };
    const app = await mountApp({ saveFile, openFile: async () => file });
    fillStorage();
    await app.menu('open');
    expect(app.tabs()).toEqual(['A']);
    expect(app.text()).toBe('aaa');
    await app.type('more ');
    await app.menu('save');
    expect(saveFile.mock.calls[0][0].path).toBe('/x/A.docx');
    expect(app.toast()).toBe('Saved A');
  });
});
