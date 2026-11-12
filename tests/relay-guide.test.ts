import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { RelayGuide, WAITING } from '../src/ui/RelayGuide';
import { WAIT_EVERY, WAIT_FOR } from '../src/collab/relay';

// The guide's Connect step against a relay that isn't online yet: a new workers.dev address fails its TLS handshake
// for a few minutes, which fetch reports like any unreachable address. The clock is faked; nothing really waits.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ADDR = 'https://falcon-relay.someone.workers.dev';

let root: Root | null = null, calls: string[] = [], online = false;
const relay = vi.fn(async (url: string, init?: RequestInit) => {
  calls.push(`${init?.method ?? 'GET'} ${url}`);
  if (!online) throw new TypeError('fetch failed'); // what a failed TLS handshake looks like from the page
  if (url.endsWith('/v1/rooms')) return new Response(JSON.stringify({ rooms: 1 }), { status: 200 });
  return new Response(JSON.stringify({ error: 'bad_envelope' }), { status: 400 });
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal('fetch', relay);
  localStorage.clear(); calls = []; online = false;
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals(); });

const note = () => document.querySelector('.rg-note')?.textContent ?? '';
const saved = () => localStorage.getItem('falcon.relayUrl');
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.rg button')].find((b) => b.textContent?.trim() === text)!;
const later = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
async function connectStep() {
  const el = document.body.appendChild(document.createElement('div'));
  await act(async () => { root = createRoot(el); root.render(createElement(RelayGuide, { onClose: () => {} })); });
  while (!document.querySelector('.rg input[aria-label="Relay address"]')) await act(async () => button('Next').click());
  const box = document.querySelector<HTMLInputElement>('.rg input')!;
  await act(async () => { box.value = ADDR; box.dispatchEvent(new Event('input', { bubbles: true })); });
  return box;
}

describe('the relay guide waits for a new address to come online', () => {
  it('keeps trying an unreachable address, says so, and saves it once it answers', async () => {
    await connectStep();
    await act(async () => button('Check and save').click());
    expect(note()).toBe('Checking…');
    await later(0);
    expect(note()).toBe(WAITING);
    expect(note()).not.toMatch(/check the address/i);
    expect(button('Check and save').disabled).toBe(false); // clicking again starts over; it doesn't lock the box
    expect(saved()).toBeNull();
    await later(WAIT_EVERY * 3);
    expect(calls.filter((c) => c.startsWith('POST')).length).toBe(4); // tried again every 10 s
    expect(note()).toBe(WAITING);
    online = true; // about four minutes in, its certificate is there
    await later(WAIT_EVERY);
    expect(note()).toMatch(/^It works\. Falcon is connected and saved the address/);
    expect(saved()).toBe(ADDR);
    const n = calls.length;
    await later(WAIT_FOR);
    expect(calls.length).toBe(n); // and then it stops
  });

  it('gives up after about 10 minutes and only then says to check the address', async () => {
    await connectStep();
    await act(async () => button('Check and save').click());
    await later(WAIT_FOR - WAIT_EVERY);
    expect(note()).toBe(WAITING);
    await later(2 * WAIT_EVERY);
    expect(note()).toMatch(/^Couldn't reach it for 10 minutes\. Check the address is the one ending in \.workers\.dev/);
    expect(saved()).toBeNull();
    const tries = calls.length;
    expect(tries).toBeGreaterThanOrEqual(55);
    expect(tries).toBeLessThanOrEqual(61);
    await later(WAIT_FOR);
    expect(calls.length).toBe(tries);
  });

  it('stops trying when the address is edited, or the guide closes', async () => {
    const box = await connectStep();
    await act(async () => button('Check and save').click());
    await later(WAIT_EVERY);
    await act(async () => { box.value = `${ADDR}x`; box.dispatchEvent(new Event('input', { bubbles: true })); });
    const afterEdit = calls.length;
    await later(WAIT_EVERY * 5);
    expect(calls.length).toBe(afterEdit);
    expect(note()).toBe('');

    await act(async () => button('Check and save').click());
    await later(WAIT_EVERY);
    await act(async () => root?.unmount()); root = null;
    const afterClose = calls.length;
    online = true;
    await later(WAIT_EVERY * 5);
    expect(calls.length).toBe(afterClose);
    expect(saved()).toBeNull();
  });

  it('a second click starts one fresh check instead of a second loop', async () => {
    await connectStep();
    await act(async () => button('Check and save').click());
    await later(WAIT_EVERY / 2);
    await act(async () => button('Check and save').click());
    const n = calls.length;
    await later(WAIT_EVERY * 3);
    expect(calls.length - n).toBe(3); // one loop: one try per 10 s, not two
  });
});
