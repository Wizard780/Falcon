import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { docxBytes, freshStorage, mountApp, tick, unmountAll } from './app-harness';

const FILE = '/Users/me/Debate/Aff.docx';
const hit = { path: FILE, ordinal: 1, file: 'Aff', tag: 'Warming causes extinction', cite: 'Chen 25 [Nature]', headings: ['1AC'], copies: 1 };
const status = { files: 1, cards: 3, scanning: false, done: 1, total: 1 };
const bridge = (asked: string[]) => ({
  indexFolders: async () => [{ path: '/Users/me/Debate', count: 1, missing: false }],
  searchCards: async (q: string) => { asked.push(q); return { hits: q.trim() ? [hit] : [], status }; },
  openPath: async (p: string) => ({ name: 'Aff.docx', path: p, data: await docxBytes('First card', 'Warming causes extinction', 'Last card') }),
});
const box = () => document.querySelector('.pk[aria-label="Search cards"]');
// Preact's act runs effects as it ends, so the box's search (a moment after typing) answers in the next one
const settle = (app: Awaited<ReturnType<typeof mountApp>>) => app.act(() => {}, 150);
const caretText = (app: Awaited<ReturnType<typeof mountApp>>) => app.view().state.selection.$head.parent.textContent;
const enter = async (app: Awaited<ReturnType<typeof mountApp>>, init: KeyboardEventInit = {}) =>
  app.act(() => box()!.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })), 200);

beforeEach(async () => { await freshStorage(); });
afterEach(async () => { await unmountAll(); });

describe('Search cards', () => {
  it('opens with its shortcut, swaps with Cmd-K, and closes on a second press', async () => {
    const app = await mountApp(bridge([]));
    await app.press('K', { ctrlKey: true, shiftKey: true, keyCode: 75 });
    expect(box()).not.toBeNull();
    await settle(app);
    expect(box()!.textContent).toContain('3 cards in 1 files');
    await app.press('k', { ctrlKey: true });
    expect(box()).toBeNull();
    expect(document.querySelector('.pk[aria-label="Search files"]')).not.toBeNull();
    await app.press('K', { ctrlKey: true, shiftKey: true, keyCode: 75 });
    expect(box()).not.toBeNull();
    await app.press('K', { ctrlKey: true, shiftKey: true, keyCode: 75 });
    expect(document.querySelector('.pk')).toBeNull();
  });

  it('lists matches, and Enter opens the file with the caret on the card', async () => {
    const asked: string[] = [];
    const app = await mountApp(bridge(asked));
    await app.press('K', { ctrlKey: true, shiftKey: true, keyCode: 75 });
    await app.fill(box()!.querySelector('input'), 'chen warming');
    await settle(app);
    expect(asked).toContain('chen warming');
    expect(box()!.querySelector('.pk-card[data-on] .pk-nm')!.textContent).toBe('Warming causes extinction');
    expect(box()!.querySelector('.pk-card[data-on] .pk-cite')!.textContent).toBe('Chen 25');
    await enter(app);
    expect(box()).toBeNull();
    expect(app.tabs()).toContain('Aff');
    expect(caretText(app)).toBe('Warming causes extinction');
  });

  it('Mod-Enter puts a copy of the card into the open document, which stays open', async () => {
    const app = await mountApp(bridge([]));
    await app.type('My speech');
    await app.press('K', { ctrlKey: true, shiftKey: true, keyCode: 75 });
    await app.fill(box()!.querySelector('input'), 'warming');
    await settle(app);
    await enter(app, { ctrlKey: true });
    await tick(100);
    expect(app.tabs()).not.toContain('Aff');
    expect(app.text()).toBe('My speechWarming causes extinction');
  });

  it('is a command in the command center', async () => {
    const app = await mountApp(bridge([]));
    await app.press(' ', { ctrlKey: true, shiftKey: true, code: 'Space' });
    const input = document.querySelector('.cc input, [aria-label="Search everything"]');
    expect(input).not.toBeNull();
    await app.fill(input, 'search cards', 100);
    const row = [...document.querySelectorAll('[role="option"]')].find((r) => r.textContent?.includes('Search cards'));
    expect(row).toBeTruthy();
    await app.click(row!, 200);
    expect(box()).not.toBeNull();
  });
});
