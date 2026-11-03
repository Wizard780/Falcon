import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshStorage, mountApp, unmountAll } from './app-harness';
import { RAIL_MAX, RAIL_MIN, RAIL_NAMES, railWidth } from '../src/ui/rail';
import { P, setPref } from '../src/editor/prefs';

beforeEach(async () => { await freshStorage({ 'falcon.railResize': 'on' }); });
afterEach(async () => { await unmountAll(); });

const railW = () => document.documentElement.style.getPropertyValue('--rail-w');
const names = (el: Element) => [...el.querySelectorAll('.doc-row .lbl')].map((l) => l.textContent);
const grip = (el: Element) => el.querySelector('.rail-grip') as HTMLElement;
const pointer = (type: string, clientX: number) => new (window.PointerEvent ?? MouseEvent)(type, { clientX, button: 0, bubbles: true, cancelable: true });

describe('railWidth', () => {
  it('snaps short drags back to icons and the rest up to room for names', () => {
    expect(railWidth(40)).toBe(RAIL_MIN);
    expect(railWidth(97)).toBe(RAIL_MIN);
    expect(railWidth(98)).toBe(RAIL_NAMES);
    expect(railWidth(200.4)).toBe(200);
    expect(railWidth(5000)).toBe(RAIL_MAX);
    expect(railWidth(280, 240)).toBe(240);
    expect(railWidth(NaN)).toBe(RAIL_MIN);
  });
});

describe('the rail', () => {
  it('starts as icons only', async () => {
    const app = await mountApp();
    expect(railW()).toBe(`${RAIL_MIN}px`);
    expect(app.el.querySelector('.fstrip')!.hasAttribute('data-wide')).toBe(false);
    expect(names(app.el)).toEqual([]);
    expect(grip(app.el).getAttribute('role')).toBe('separator');
  });

  it('drags wider, shows the names, and keeps the width after a restart', async () => {
    const app = await mountApp();
    await app.act(() => {
      grip(app.el).dispatchEvent(pointer('pointerdown', RAIL_MIN));
      window.dispatchEvent(pointer('pointermove', 150));
      window.dispatchEvent(pointer('pointermove', 220));
      window.dispatchEvent(pointer('pointerup', 220));
    });
    expect(railW()).toBe('220px');
    expect(localStorage.getItem('falcon.rail')).toBe('220');
    expect(names(app.el)).toEqual(['Untitled']);
    await app.unmount();

    const again = await mountApp();
    expect(railW()).toBe('220px');
    expect(names(again.el)).toEqual(['Untitled']);
  });

  it('resets on a double-click of the handle', async () => {
    localStorage.setItem('falcon.rail', '240');
    const app = await mountApp();
    expect(names(app.el)).toEqual(['Untitled']);
    await app.act(() => { grip(app.el).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(railW()).toBe(`${RAIL_MIN}px`);
    expect(localStorage.getItem('falcon.rail')).toBe(String(RAIL_MIN));
    expect(names(app.el)).toEqual([]);
  });

  it('steps with the arrow keys', async () => {
    const app = await mountApp();
    const key = (k: string) => app.act(() => { grip(app.el).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
    await key('ArrowRight');
    expect(railW()).toBe(`${RAIL_NAMES}px`);
    await key('ArrowRight');
    expect(railW()).toBe(`${RAIL_NAMES + 16}px`);
    await key('End');
    expect(railW()).toBe(`${RAIL_MAX}px`);
    await key('Home');
    expect(railW()).toBe(`${RAIL_MIN}px`);
  });

  it('ignores a stored width it could never have set', async () => {
    localStorage.setItem('falcon.rail', '9000');
    await mountApp();
    expect(railW()).toBe(`${RAIL_MAX}px`);
  });
});

describe('the Resizable rail setting', () => {
  it('is off by default: no handle, icons only, even with a width saved', async () => {
    await freshStorage({ 'falcon.rail': '240' });
    const app = await mountApp();
    expect(grip(app.el)).toBeNull();
    expect(railW()).toBe(`${RAIL_MIN}px`);
    expect(names(app.el)).toEqual([]);
  });

  it('turning it on brings back the saved width, and off goes back to icons', async () => {
    await freshStorage({ 'falcon.rail': '240' });
    const app = await mountApp();
    await app.act(() => { setPref(P.railResize, true); });
    expect(grip(app.el)).not.toBeNull();
    expect(railW()).toBe('240px');
    expect(names(app.el)).toEqual(['Untitled']);
    await app.act(() => { setPref(P.railResize, false); });
    expect(grip(app.el)).toBeNull();
    expect(railW()).toBe(`${RAIL_MIN}px`);
    expect(localStorage.getItem('falcon.rail')).toBe('240');
  });
});
