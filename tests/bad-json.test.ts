import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docxBytes, freshStorage, mountApp, unmountAll } from './app-harness';

beforeEach(async () => { await freshStorage(); });
afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

describe('storage holding text that is not JSON', () => {
  it('starts on a blank Untitled when the last-session list is cut off', async () => {
    localStorage.setItem('falcon.session', '["/x/A.doc');
    const app = await mountApp();
    expect(app.tabs()).toEqual(['Untitled']);
  });

  it('starts when the old file name entry is cut off', async () => {
    localStorage.setItem('falcon.meta', '{"name":"Big","pa');
    const app = await mountApp();
    expect(app.tabs()).toEqual(['Untitled']);
  });

  it('starts when the recent files list is cut off', async () => {
    localStorage.setItem('falcon.recents.v1', '[{"name":"A"');
    const app = await mountApp();
    expect(app.tabs()).toEqual(['Untitled']);
  });
});

describe('reopening last session', () => {
  it('opens the files listed, reading the list once however often the app re-renders', async () => {
    localStorage.setItem('falcon.reopen', 'on');
    localStorage.setItem('falcon.session', JSON.stringify(['/x/A.docx']));
    const openPath = vi.fn(async () => ({ name: 'A.docx', path: '/x/A.docx', data: await docxBytes('aaa') }));
    const get = Storage.prototype.getItem;
    let reads = 0;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
      if (k === 'falcon.session') reads++;
      return get.call(this, k);
    });
    const app = await mountApp({ openPath });
    await app.act(() => {}, 200);
    for (const ch of 'abc') await app.type(ch);
    expect(app.tabs()).toEqual(['A']);
    expect(reads).toBe(1);
  });
});
