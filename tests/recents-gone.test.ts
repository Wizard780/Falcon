import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, mountApp, unmountAll } from './app-harness';

const recent = (name: string) => ({ name, path: `/x/${name}.docx`, folder: 'x', cards: 0, blocks: [], when: Date.now() });
const stored = () => (JSON.parse(localStorage.getItem('falcon.recents.v1') ?? '[]') as { name: string }[]).map((r) => r.name);
const homeRows = () => [...document.querySelectorAll('.hm-row .nm')].map((r) => r.textContent);
const openPath = vi.fn(async (p: string) => { throw new Error(`ENOENT: no such file or directory, open '${p}'`); });

beforeEach(async () => {
  await freshStorage({ 'falcon.openHome': 'on', 'falcon.recents.v1': JSON.stringify([recent('Gone'), recent('Here')]) });
});
afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

describe('a recent file that was moved or deleted', () => {
  it('leaves the Home list once opening it fails', async () => {
    const app = await mountApp({ openPath });
    expect(homeRows()).toEqual(['Gone', 'Here']);
    await app.click(document.querySelector('.hm-row'));
    expect(app.toast()).toMatch(/^Couldn't open Gone/);
    expect(homeRows()).toEqual(['Here']);
    expect(stored()).toEqual(['Here']);
  });

  it('leaves the Cmd-K list once opening it fails', async () => {
    const app = await mountApp({ openPath });
    await app.press('k', { ctrlKey: true });
    const row = [...document.querySelectorAll('.pk-row')].find((r) => r.querySelector('.pk-nm')?.textContent === 'Gone');
    // Mod-click opens it (a plain click first asks open or search its blocks)
    await app.act(() => row!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })), 100);
    expect(app.toast()).toMatch(/^Couldn't open Gone/);
    expect(stored()).toEqual(['Here']);
  });
});
