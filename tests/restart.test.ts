import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docxBytes, freshStorage, mountApp, tick, unmountAll } from './app-harness';

const AUTOSAVE = 'falcon.autosave.v2';
const saveFile = vi.fn(async (o: { path?: string; name: string }) => ({ name: o.name, path: o.path ?? `/x/${o.name}` }));

beforeEach(async () => {
  await freshStorage();
  saveFile.mockClear();
});
afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

describe('restart after a session whose open file was too big for crash recovery', () => {
  const lastSession = () => {
    // what the previous run left behind: its active tab was Big.docx, and no backup was kept for it
    localStorage.setItem('falcon.meta', JSON.stringify({ name: 'Big', path: '/x/Big.docx' }));
    localStorage.setItem(AUTOSAVE, '[]');
  };

  it('starts on a blank Untitled tab, not one bound to the old file', async () => {
    lastSession();
    const app = await mountApp({ saveFile });
    expect(app.tabs()).toEqual(['Untitled']);
    await app.menu('save');
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0][0].path).toBeUndefined();
  });

  it('opens the real file when asked, instead of calling it already open', async () => {
    lastSession();
    const big = { name: 'Big.docx', path: '/x/Big.docx', data: await docxBytes('real content') };
    const app = await mountApp({ saveFile, openFile: async () => big });
    await app.menu('open');
    expect(app.toast()).not.toMatch(/already open/);
    expect(app.text()).toBe('real content');
    expect(app.tabs()).toEqual(['Big']);
  });
});

describe('restart with a crash-recovery copy', () => {
  it('brings back the unsaved edit under the same file, so Save still writes that file', async () => {
    const file = { name: 'A.docx', path: '/x/A.docx', data: await docxBytes('aaa') };
    const first = await mountApp({ saveFile, openFile: async () => file });
    await first.menu('open');
    await first.type('edited ');
    await tick(1100);
    await first.unmount();

    const again = await mountApp({ saveFile });
    expect(again.tabs()).toEqual(['A']);
    expect(again.text()).toContain('edited');
    await again.menu('save');
    expect(saveFile.mock.calls[0][0].path).toBe('/x/A.docx');
  });
});

describe('reload right after typing', () => {
  it('writes the waiting crash-recovery copy on the way out, so the last edit comes back', async () => {
    const first = await mountApp({ saveFile });
    await first.type('first ');
    await tick(1100); // backed up
    await first.type('last');
    dispatchEvent(new Event('pagehide')); // the page goes away before the backup's timer fires
    await first.unmount();

    const again = await mountApp({ saveFile });
    expect(again.text()).toBe('first last');
  });
});

describe('crash recovery when storage is nearly full', () => {
  it('keeps the unsaved docs that fit when the open doc is too big to keep', async () => {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === AUTOSAVE && v.length > 1700) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    const app = await mountApp({ saveFile });
    await app.type('a'.repeat(700));
    await app.menu('new');
    await app.type('c'.repeat(800));
    await app.menu('new');
    await app.type('b'.repeat(401_000), 1000);
    expect(app.tabs()).toHaveLength(3);
    await app.unmount();
    vi.restoreAllMocks();

    const again = await mountApp({ saveFile });
    expect(again.tabs()).toHaveLength(1);
    expect([again.text().length, again.text()[0]]).toEqual([700, 'a']);
  });
});
