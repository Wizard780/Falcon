import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, mountApp, tick, unmountAll } from './app-harness';

// Settings > Sharing > Relay in the real <App/>: an address is still saved when it's entered, and then checked the way the
// guide checks one. When no Falcon relay answers there, a line under the box says so. Only entering an address checks it.
const NOWHERE = 'https://falcon-relay.debate.invalid'; // no such domain, like the address a real user had saved
const RELAY = 'https://falcon-relay.coach.workers.dev';
const PAGE = 'https://example.test'; // something answers, but not a Falcon relay
const SLOW = 'https://slow.test';

let checks: string[] = [], slow: ((r: Response | Error) => void)[] = [];
const fetch = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  // Settings > Sharing's usage bar reads the relay's day too: an older relay here, and not one of the checks this counts
  if (u.endsWith('/v1/usage')) return new Response('{"error":"not_found"}', { status: 404 });
  if (u.endsWith(`/v1/inbox/${'0'.repeat(64)}`) && init?.method === 'POST') checks.push(u.replace(/\/v1\/.*$/, ''));
  if (u.startsWith(`${RELAY}/`)) return new Response(JSON.stringify({ error: 'bad_envelope' }), { status: 400 });
  if (u.startsWith(`${PAGE}/`)) return new Response('<!doctype html><title>Hi</title>', { status: 200 });
  if (u.startsWith(`${SLOW}/`)) {
    const r = await new Promise<Response | Error>((res) => slow.push(res));
    if (r instanceof Error) throw r;
    return r;
  }
  throw new TypeError('Failed to fetch'); // no such host
});
// the app connects to a saved relay too; these never open, which is all this needs
class Quiet { readyState = 0; onopen = null; onclose = null; onmessage = null; onerror = null; send() {} close() { this.readyState = 3; } }

beforeEach(async () => {
  checks = []; slow = [];
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('WebSocket', Quiet);
  await new Promise<void>((r, j) => { const q = indexedDB.deleteDatabase('falcon-collab'); q.onsuccess = () => r(); q.onerror = () => j(q.error); });
});
afterEach(async () => { await unmountAll(); vi.unstubAllGlobals(); });

const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel);
async function relayBox() {
  await freshStorage({});
  const app = await mountApp();
  await app.click($('.fstrip [aria-label="Settings"]'));
  await app.click([...document.querySelectorAll('[aria-label="Settings sections"] button')].find((b) => b.textContent?.trim() === 'Sharing')!);
  const box = () => $('input[aria-label="Relay address"]') as HTMLInputElement;
  const enter = () => app.act(() => { box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, 100);
  const warning = () => box().closest('.st-row')?.querySelector('.st-relay small')?.textContent ?? '';
  return { app, box, enter, warning };
}
const NO_RELAY = /^No Falcon relay answered at that address\. Cards sent to your code won't arrive until one does\. The \? beside Relay shows how to set one up\.$/;

describe('the Relay box checks the address it saves', () => {
  it('an address where nothing answers is still saved, and a quiet line under the box says cards to your code won\'t arrive', async () => {
    const { app, box, enter, warning } = await relayBox();
    await app.fill(box(), 'falcon-relay.debate.inv');
    await app.fill(box(), 'falcon-relay.debate.invalid');
    expect(checks).toEqual([]); // nothing is checked as it's typed
    await enter();
    expect(localStorage.getItem('falcon.relayUrl')).toBe(NOWHERE); // saved all the same: a relay can be briefly offline
    expect(checks).toEqual([NOWHERE]);
    expect(warning()).toMatch(NO_RELAY);
    expect(box().closest('.st-row')?.querySelector('.st-relay small')?.hasAttribute('data-bad')).toBe(true);
    expect(box().disabled).toBe(false);

    // typing hides it at once; a relay that answers shows nothing
    await app.fill(box(), RELAY);
    expect(warning()).toBe('');
    await enter();
    expect(localStorage.getItem('falcon.relayUrl')).toBe(RELAY);
    expect(checks).toEqual([NOWHERE, RELAY]);
    expect(warning()).toBe('');

    // something that answers but isn't a relay is no relay either
    await app.fill(box(), PAGE);
    await enter();
    expect(warning()).toMatch(NO_RELAY);
  });

  it('leaving the box saves and checks once; an empty box checks nothing and shows nothing', async () => {
    const { app, box, enter, warning } = await relayBox();
    await app.fill(box(), NOWHERE);
    await app.act(() => { box().dispatchEvent(new FocusEvent('blur')); box().dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }, 100);
    expect(checks).toEqual([NOWHERE]);
    expect(warning()).toMatch(NO_RELAY);
    await app.fill(box(), '');
    await enter();
    expect(localStorage.getItem('falcon.relayUrl')).toBe('');
    expect(checks).toEqual([NOWHERE]);
    expect(warning()).toBe('');
  });

  it('an answer shows only while the box shows the address it was for, and an older check\'s answer is dropped', async () => {
    const { app, box, enter, warning } = await relayBox();
    await app.fill(box(), SLOW);
    await enter();
    expect(slow.length).toBe(1);
    await app.fill(box(), `${SLOW}/x`); // typing again while it checks
    await app.act(() => slow[0](new TypeError('Failed to fetch')));
    expect(warning()).toBe('');
    await app.act(() => { box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(box().value).toBe(SLOW); // Escape puts the saved address back, and with it what its check found
    expect(warning()).toMatch(NO_RELAY);

    await app.fill(box(), `${SLOW}/x`);
    await enter(); // a newer address, then the older check comes back late
    expect(slow.length).toBe(2);
    await app.fill(box(), RELAY);
    await enter();
    await app.act(() => slow[1](new TypeError('Failed to fetch')));
    await tick(50);
    expect(warning()).toBe('');
    expect(localStorage.getItem('falcon.relayUrl')).toBe(RELAY);
  });

  it('the guide opening and closing starts the box over: it may have saved the same address, checked', async () => {
    const { app, box, enter, warning } = await relayBox();
    await app.fill(box(), NOWHERE);
    await enter();
    expect(warning()).toMatch(NO_RELAY);
    await app.click($('.st-help'));
    expect($('.rg')).toBeTruthy();
    await app.act(() => { $('.rg')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect($('.rg')).toBeNull();
    expect(box().value).toBe(NOWHERE);
    expect(warning()).toBe('');
  });
});
