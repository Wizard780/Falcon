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

  it('shows the download, which clicks can\'t install, then becomes the install button', async () => {
    let push: (u: UpdateInfo | null) => void = () => {};
    let installs = 0;
    const app = await mountApp({ onUpdate: (f: (u: UpdateInfo | null) => void) => { push = f; f(null); return () => {}; }, installUpdate: async () => { installs++; } });
    await app.act(() => push({ ...ready, state: 'downloading', done: 45e6, total: 123e6 }));
    const btn = () => app.el.querySelector('.fs-b.upd') as HTMLButtonElement;
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    expect(btn().style.getPropertyValue('--p')).toMatch(/^36\.5/);
    expect(app.el.querySelector('.upd-act')?.textContent).toContain('45 of 123 MB');
    await app.act(() => btn().click());
    expect(app.el.querySelector('.cf')).toBeNull();
    await app.act(() => push(ready));
    expect(btn().hasAttribute('aria-disabled')).toBe(false);
    expect(installs).toBe(0);
  });

  it('says so when the download fails, and goes back to the check button', async () => {
    let push: (u: UpdateInfo | null) => void = () => {};
    const app = await mountApp({ onUpdate: (f: (u: UpdateInfo | null) => void) => { push = f; f(null); return () => {}; }, checkUpdate: async () => 'none' });
    await app.act(() => push({ ...ready, state: 'downloading', done: 0, total: 1 }));
    await app.act(() => push(null));
    expect(toast(app.el)).toContain("didn't finish downloading");
    expect(chk(app.el)).not.toBeNull();
  });

  it('warns before restarting: Cancel stays put, confirming installs', async () => {
    let installs = 0, asked = '';
    const app = await mountApp({ onUpdate: (f: (u: UpdateInfo | null) => void) => { f(ready); return () => {}; }, installUpdate: async (v: string) => { installs++; asked = v; } });
    const click = () => app.act(() => (app.el.querySelector('.fs-b.upd') as HTMLButtonElement).click());
    await click();
    expect(app.el.querySelector('#cf-t')?.textContent).toBe('Install Falcon 9.9.9 and restart?');
    await app.act(() => (app.el.querySelector('.cf-btns button') as HTMLButtonElement).click());
    expect(installs).toBe(0);
    await click();
    expect(app.el.querySelector('.cf-ok')?.textContent).toBe('Install and Restart');
    await app.act(() => (app.el.querySelector('.cf-ok') as HTMLButtonElement).click());
    expect(installs).toBe(1);
    expect(asked).toBe('9.9.9');
  });

  it('names the unsaved docs in the other windows too: the restart closes every window', async () => {
    let installs = 0;
    const app = await mountApp({ onUpdate: (f: (u: UpdateInfo | null) => void) => { f(ready); return () => {}; }, installUpdate: async () => { installs++; }, unsavedElsewhere: () => ['AT Neg'] });
    await app.act(() => (app.el.querySelector('.fs-b.upd') as HTMLButtonElement).click());
    expect(app.el.querySelector('.cf')?.textContent).toContain('AT Neg');
    expect(app.el.querySelector('.cf-ok')?.textContent).toBe('Restart Without Saving');
    await app.act(() => (app.el.querySelector('.cf-btns button') as HTMLButtonElement).click());
    expect(installs).toBe(0);
  });
  it('opens the disk image with no warning when nothing restarts', async () => {
    let installs = 0;
    const app = await mountApp({ onUpdate: (f: (u: UpdateInfo | null) => void) => { f({ ...ready, manual: true }); return () => {}; }, installUpdate: async () => { installs++; } });
    await app.act(() => (app.el.querySelector('.fs-b.upd') as HTMLButtonElement).click());
    expect(app.el.querySelector('.cf')).toBeNull();
    expect(installs).toBe(1);
  });

  it('is not there without the desktop app', async () => {
    const app = await mountApp();
    expect(chk(app.el)).toBeNull();
  });
});
