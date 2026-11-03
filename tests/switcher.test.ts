import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshStorage, mountApp, tick, unmountAll } from './app-harness';
import { holdMods, recentOrder } from '../src/ui/Switcher';

beforeEach(async () => { await freshStorage(); });
afterEach(async () => { await unmountAll(); });

describe('recentOrder', () => {
  it('puts the current doc first, then by last use, then docs never visited in tab order', () => {
    expect(recentOrder([1, 2, 3, 4], [3, 1], 3)).toEqual([3, 1, 2, 4]);
    expect(recentOrder([1, 2, 3], [2, 3, 1], 1)).toEqual([1, 2, 3]);
  });
});

describe('holdMods', () => {
  it('holds the binding’s modifiers but not Shift', () => {
    expect(holdMods('Ctrl-Tab')).toEqual(['ctrlKey']);
    expect(holdMods('Ctrl-Shift-Tab')).toEqual(['ctrlKey']);
    expect(holdMods('Alt-q')).toEqual(['altKey']);
    expect(holdMods('F3')).toEqual([]);
  });
});

/** Three docs, A, B, C, opened in that order: C is open, B was the one before. */
async function threeDocs() {
  const app = await mountApp();
  await app.type('alpha');
  for (const t of ['bravo', 'charlie']) { await app.menu('new'); await app.type(t); }
  return app;
}
const ctrlTab = (app: Awaited<ReturnType<typeof mountApp>>, shift = false) => app.press('Tab', { ctrlKey: true, shiftKey: shift }, 0);
const release = (app: Awaited<ReturnType<typeof mountApp>>, wait = 50) =>
  app.act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true })); }, wait);
const names = (el: Element) => [...el.querySelectorAll('.sw-it .sw-nm span')].map((n) => n.textContent);
const lit = (el: Element) => el.querySelector('.sw-it[data-on] .sw-nm span')?.textContent;

describe('Ctrl-Tab', () => {
  it('a quick tap flips between the two most recent docs, without drawing the switcher', async () => {
    const app = await threeDocs();
    expect(app.text()).toBe('charlie');
    await ctrlTab(app);
    await release(app);
    expect(app.el.querySelector('.sw')).toBeNull();
    expect(app.text()).toBe('bravo');
    await ctrlTab(app); await release(app);
    expect(app.text()).toBe('charlie');
  });

  it('held, shows every open doc with a preview, most recent first, and opens the lit one on release', async () => {
    const app = await threeDocs();
    await ctrlTab(app);
    await app.act(() => tick(200));
    expect(names(app.el)).toHaveLength(3);
    expect(lit(app.el)).toBe(names(app.el)[1]);
    // previews draw each doc's own text
    expect([...app.el.querySelectorAll('.sw-doc')].map((d) => d.textContent)).toEqual(['charlie', 'bravo', 'alpha']);
    await ctrlTab(app); // Tab again, Ctrl still down
    expect(lit(app.el)).toBe(names(app.el)[2]);
    expect(app.text()).toBe('charlie'); // nothing switches while held
    await release(app);
    expect(app.el.querySelector('.sw')).toBeNull();
    expect(app.text()).toBe('alpha');
    // alpha is now the most recent; charlie the one before
    await ctrlTab(app); await release(app);
    expect(app.text()).toBe('charlie');
  });

  it('Shift walks backward and Esc stays on the current doc', async () => {
    const app = await threeDocs();
    await ctrlTab(app, true);
    await app.act(() => tick(200));
    expect(app.el.querySelector('.sw-it[data-on] .sw-doc')?.textContent).toBe('alpha');
    await app.press('Escape', { ctrlKey: true }, 0);
    expect(app.el.querySelector('.sw')).toBeNull();
    await release(app);
    expect(app.text()).toBe('charlie');
  });

  it('clicking a preview opens that doc', async () => {
    const app = await threeDocs();
    await ctrlTab(app);
    await app.act(() => tick(200));
    const alpha = [...app.el.querySelectorAll('.sw-it')].find((it) => it.querySelector('.sw-doc')?.textContent === 'alpha')!;
    await app.act(() => { alpha.dispatchEvent(new (window.PointerEvent ?? MouseEvent)('pointerdown', { bubbles: true, cancelable: true })); });
    expect(app.el.querySelector('.sw')).toBeNull();
    expect(app.text()).toBe('alpha');
  });

  it('keys typed while the switcher is up never reach the page', async () => {
    const app = await threeDocs();
    await ctrlTab(app);
    await app.press('x', { ctrlKey: true }, 0);
    await release(app);
    expect(app.text()).toBe('bravo');
  });

  it('a menu command while held closes the switcher, and letting go then switches nothing', async () => {
    const app = await threeDocs();
    await ctrlTab(app);
    await app.act(() => tick(200));
    await app.menu('close');
    expect(app.el.querySelector('.sw')).toBeNull();
    expect(app.tabs()).toHaveLength(3);
    await release(app);
    expect(app.text()).toBe('charlie');
  });

  it('a held Tab’s auto-repeat after Esc does not start the switcher again', async () => {
    const app = await threeDocs();
    await ctrlTab(app);
    await app.press('Escape', { ctrlKey: true }, 0);
    await app.press('Tab', { ctrlKey: true, repeat: true }, 200);
    expect(app.el.querySelector('.sw')).toBeNull();
    await release(app);
    expect(app.text()).toBe('charlie');
  });
});
