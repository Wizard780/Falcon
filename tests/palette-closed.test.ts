import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, mountApp, unmountAll } from './app-harness';

const scans = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/ui/file-search', async (orig) => {
  const m = await orig<typeof import('../src/ui/file-search')>();
  return { ...m, collectHits: (...a: Parameters<typeof m.collectHits>) => { scans.n++; return m.collectHits(...a); } };
});

const files = Array.from({ length: 3000 }, (_, i) => ({ path: `/Users/me/Debate/Topic ${i % 40}/Aff---File ${i}.docx`, root: '/Users/me/Debate', mtime: i }));
const index = { indexFolders: async () => [{ path: '/Users/me/Debate', count: files.length, missing: false }], indexedFiles: async () => files };
const pk = () => document.querySelector('.pk');

beforeEach(async () => { await freshStorage(); scans.n = 0; });
afterEach(async () => { await unmountAll(); vi.restoreAllMocks(); });

describe('Cmd-K file search', () => {
  it('does no work while closed, however much the editor re-renders', async () => {
    const app = await mountApp(index);
    await app.press('k', { ctrlKey: true });
    expect(pk()).not.toBeNull();
    await app.press('k', { ctrlKey: true });
    expect(pk()).toBeNull();

    scans.n = 0;
    for (const ch of 'hello') await app.type(ch, 0);
    expect(app.text()).toBe('hello');
    expect(scans.n).toBe(0);
  });

  it('still finds indexed files after being closed and reopened', async () => {
    const app = await mountApp(index);
    await app.press('k', { ctrlKey: true });
    await app.press('k', { ctrlKey: true });
    await app.press('k', { ctrlKey: true });
    await app.fill(pk()!.querySelector('input'), 'file 2999');
    const rows = [...document.querySelectorAll('.pk-row .pk-nm')].map((r) => r.textContent);
    expect(rows).toContain('Aff---File 2999');
  });
});
