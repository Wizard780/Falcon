import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { RelayGuide, TOKEN_PAGE, WAITING } from '../src/ui/RelayGuide';
import { bridge, type RelaySetupResult } from '../src/editor/host';
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
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.innerHTML = ''; delete bridge.relaySetup; vi.useRealTimers(); vi.unstubAllGlobals(); });

const note = () => document.querySelector('.rg-note')?.textContent ?? '';
const saved = () => localStorage.getItem('falcon.relayUrl');
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.rg button')].find((b) => b.textContent?.trim() === text)!;
const later = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
async function openGuide() {
  const el = document.body.appendChild(document.createElement('div'));
  await act(async () => { root = createRoot(el); root.render(createElement(RelayGuide, { onClose: () => {} })); });
}
const title = () => document.querySelector('.rg h2')?.textContent;
const stepOf = () => document.querySelector('.rg .co-sub')?.textContent;
async function connectStep() {
  await openGuide();
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

describe('in the desktop app, Falcon sets the relay up itself', () => {
  const rows = () => [...document.querySelectorAll('.rg-steps li')].map((li) => `${li.getAttribute('data-st')} ${li.textContent}`);
  /** A main process that walks the steps; `answer` is what it ends with. It's handed the look and the step callback, and nothing else crosses. */
  function main(answer: RelaySetupResult, upTo = 'address') {
    const seen: unknown[][] = [];
    bridge.relaySetup = vi.fn(async (...args: unknown[]) => {
      seen.push(args);
      const onStep = args[1] as (s: string) => void;
      for (const s of ['account', 'upload', 'address']) { onStep(s); await Promise.resolve(); if (s === upTo) break; }
      return answer;
    });
    return seen;
  }
  async function setUpStep() {
    await openGuide();
    while (title() !== 'Set up your relay') await act(async () => button('Next').click());
  }

  it('four steps, the third opening Cloudflare\'s token page with just the two permissions it needs', async () => {
    main({ ok: true, url: ADDR, created: true });
    await openGuide();
    const titles = [title()];
    while (button('Next')) { await act(async () => button('Next').click()); titles.push(title()); }
    expect(titles).toEqual(['Set up card sharing', 'Make a free Cloudflare account', 'Make a token for Falcon', 'Set up your relay']);
    const u = new URL(TOKEN_PAGE);
    expect(`${u.origin}${u.pathname}`).toBe('https://dash.cloudflare.com/profile/api-tokens');
    expect(JSON.parse(u.searchParams.get('permissionGroupKeys')!)).toEqual([{ key: 'workers_scripts', type: 'edit' }, { key: 'account_settings', type: 'read' }]);
    expect([u.searchParams.get('accountId'), u.searchParams.get('zoneId'), u.searchParams.get('name')]).toEqual(['*', 'all', 'Falcon relay']);
    await act(async () => button('Back').click());
    expect(document.querySelector<HTMLAnchorElement>('.rg a[href*="api-tokens"]')?.href).toBe(TOKEN_PAGE);
  });

  it('one click: shows each stage, waits for the new address to come online, then saves it', async () => {
    const seen = main({ ok: true, url: ADDR, created: true });
    await setUpStep();
    expect(document.activeElement?.textContent).toBe('Set up my relay');
    await act(async () => button('Set up my relay').click());
    await later(0);
    // all that crosses to the main process: the page's colors and font, and where to report the steps
    expect(seen.length).toBe(1);
    expect(seen[0].length).toBe(2);
    expect(Object.keys(seen[0][0] as object).every((k) => k.startsWith('--') || k === 'font')).toBe(true);
    expect(typeof seen[0][1]).toBe('function');
    expect(document.activeElement).toBe(document.querySelector('.rg')); // the button went away; focus stays in the dialog
    expect(rows()).toEqual(['done Getting the token', 'done Finding your Cloudflare account', 'done Uploading the relay', 'done Turning on its address', 'now Checking it works']);
    expect(note()).toBe(WAITING);
    expect(saved()).toBeNull();
    await later(WAIT_EVERY * 20); // three minutes and more
    expect(note()).toBe(WAITING);
    online = true;
    await later(WAIT_EVERY);
    expect(rows().every((r) => r.startsWith('done'))).toBe(true);
    expect(note()).toBe(`It works. Your relay is at ${ADDR}, and Falcon saved it. Card sharing and live editing are ready`);
    expect(saved()).toBe(ADDR);
    expect(document.querySelector('.rg-body')?.textContent).toMatch(/Falcon didn't keep the token/);
  });

  it('a failure says what to do, marks where it stopped, and Try again starts over', async () => {
    main({ ok: false, error: 'bad_token' }, 'account');
    await setUpStep();
    await act(async () => button('Set up my relay').click());
    await later(0);
    expect(rows()).toEqual(['done Getting the token', 'bad Finding your Cloudflare account', 'todo Uploading the relay', 'todo Turning on its address', 'todo Checking it works']);
    expect(note()).toBe('Cloudflare turned down that token. Make a new one with the link in step 3, copy all of it, and try again');
    expect(document.activeElement?.textContent).toBe('Try again');
    expect(document.querySelector('.rg-note')?.hasAttribute('data-bad')).toBe(true);
    expect(saved()).toBeNull();
    online = true;
    main({ ok: true, url: ADDR, created: false });
    await act(async () => button('Try again').click());
    await later(0);
    expect(saved()).toBe(ADDR);
    expect(note()).toMatch(/^It works/);
  });

  it('what Cloudflare said is passed on, and closing the token window just goes back', async () => {
    main({ ok: false, error: 'cloudflare', said: 'Your account has hit its limit of Workers.' }, 'upload');
    await setUpStep();
    await act(async () => button('Set up my relay').click());
    await later(0);
    expect(note()).toBe('Cloudflare said: Your account has hit its limit of Workers. Try again, or set it up by hand');
    main({ ok: false, error: 'cancelled' }, 'none');
    await act(async () => button('Try again').click());
    await later(0);
    expect(document.querySelector('.rg-steps')).toBeNull();
    expect(button('Set up my relay')).toBeTruthy();
    expect(note()).toBe('');
    expect(document.activeElement?.textContent).toBe('Set up my relay');
  });

  it('if the main process throws, the guide says so instead of hanging', async () => {
    bridge.relaySetup = vi.fn(async () => { throw new Error('boom'); });
    await setUpStep();
    await act(async () => button('Set up my relay').click());
    await later(0);
    expect(note()).toBe('Something went wrong. Try again, or set it up by hand');
    expect(button('Try again')).toBeTruthy();
  });

  it('an address that never comes online: Try again only checks again, without asking for another token', async () => {
    main({ ok: true, url: ADDR, created: true });
    await setUpStep();
    await act(async () => button('Set up my relay').click());
    await later(WAIT_FOR + WAIT_EVERY);
    expect(note()).toBe("The relay is on Cloudflare, but its address didn't come online in 10 minutes. Click Try again to keep checking");
    expect(rows().at(-1)).toBe('bad Checking it works');
    online = true;
    await act(async () => button('Try again').click());
    await later(0);
    expect(bridge.relaySetup).toHaveBeenCalledTimes(1);
    expect(saved()).toBe(ADDR);
    expect(note()).toMatch(/^It works/);
  });

  it('going Back, or to the terminal steps, while it waits stops the waiting', async () => {
    main({ ok: true, url: ADDR, created: true });
    await setUpStep();
    await act(async () => button('Set up my relay').click());
    await later(WAIT_EVERY);
    await act(async () => button('Back').click());
    const n = calls.length;
    online = true;
    await later(WAIT_EVERY * 5);
    expect(calls.length).toBe(n);
    expect(saved()).toBeNull();

    online = false;
    await act(async () => button('Next').click());
    await act(async () => button('Set up my relay').click());
    await later(WAIT_EVERY);
    await act(async () => button('Set it up by hand').click());
    const m = calls.length;
    online = true;
    await later(WAIT_EVERY * 5);
    expect(calls.length).toBe(m);
    expect(saved()).toBeNull();
  });

  it('Set it up by hand goes to the terminal steps, which end at the same Connect', async () => {
    main({ ok: true, url: ADDR, created: true });
    await setUpStep();
    await act(async () => button('Set it up by hand').click());
    expect([stepOf(), title()]).toEqual(['Step 3 of 8', 'Install Node.js']);
    while (button('Next')) await act(async () => button('Next').click());
    expect(title()).toBe('Connect Falcon');
    expect(document.querySelector('.rg input[aria-label="Relay address"]')).toBeTruthy();
  });

  it('the web build, with no main process to do it, only has the terminal steps', async () => {
    await openGuide();
    expect(stepOf()).toBe('Step 1 of 8');
    expect(document.querySelector('.rg-body')?.textContent).toMatch(/You set one up once/);
  });
});

describe('an older relay, from the live-editing panel', () => {
  it('points the desktop at Set up my relay, and the web build at the terminal', async () => {
    const { liveLine } = await import('../src/ui/Live');
    const old = { status: { kind: 'no_rooms' } } as unknown as Parameters<typeof liveLine>[0];
    expect(liveLine(old, ADDR)).toMatch(/npx wrangler deploy/);
    bridge.relaySetup = vi.fn();
    expect(liveLine(old, ADDR)).toBe('Your relay is from before live editing. Whoever set it up updates it: the ? beside Relay in Settings > Sharing, then Set up my relay. Card sharing keeps working meanwhile');
  });
});
