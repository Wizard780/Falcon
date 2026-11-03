import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshStorage, mountApp, unmountAll } from './app-harness';
import type { UpdateInfo } from '../src/editor/host';

beforeEach(async () => { await freshStorage(); });
afterEach(async () => { await unmountAll(); });

const chk = (el: Element) => el.querySelector('.fs-b.chk') as HTMLButtonElement | null;
const toast = (el: Element) => el.querySelector('.toast')?.textContent ?? '';
const ready: UpdateInfo = { version: '9.9.9', date: '', notes: '', url: '', state: 'ready', manual: false };

describe('the update spot in the rail', () => {
  it('is a check button when no update waits, and says when Falcon is up to date', async () => {
    let calls = 0;
    const app = await mountApp({ onUpdate: (f: (u: UpdateInfo | null) => void) => { f(null); return () => {}; }, checkUpdate: async () => { calls++; return 'none'; } });
    expect(app.el.querySelector('.fs-b.upd')).toBeNull();
    await app.act(() => chk(app.el)!.click());
    expect(calls).toBe(1);
    expect(toast(app.el)).toContain('up to date');
  });

  it('spins while it checks, and a found update replaces it with the install button', async () => {
    let push: (u: UpdateInfo | null) => void = () => {};
    let done: (r: 'ready') => void = () => {};
    const app = await mountApp({ onUpdate: (f: (u: UpdateInfo | null) => void) => { push = f; f(null); return () => {}; }, checkUpdate: () => new Promise((r) => { done = r; }) });
    await app.act(() => chk(app.el)!.click());
    expect(chk(app.el)!.hasAttribute('data-busy')).toBe(true);
    await app.act(() => { push(ready); done('ready'); });
    expect(chk(app.el)).toBeNull();
    expect(app.el.querySelector('.fs-b.upd')).not.toBeNull();
  });

  it('says so when the check fails', async () => {
    const app = await mountApp({ checkUpdate: async () => 'failed' });
    await app.act(() => chk(app.el)!.click());
    expect(toast(app.el)).toContain("Couldn't check");
    expect(chk(app.el)!.hasAttribute('data-busy')).toBe(false);
  });

  it('is not there without the desktop app', async () => {
    const app = await mountApp();
    expect(chk(app.el)).toBeNull();
  });
});
