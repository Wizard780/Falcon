import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, mountApp, tick, unmountAll } from './app-harness';
import { RELAY, fakeRelay } from './collab-relay-fake';

// Recipients in the real <App/>: one list, on one store, in Settings > Sharing and in the Card sharing panel. Its order,
// hidden and starred are kept, and Send Card to… and Send Card to starred follow them.
const { encodeCode, inboxId, parseCode } = await import('../src/collab/code');
const { makeIdentity } = await import('../src/collab/crypto');
const { schema } = await import('../src/editor/schema');
const collab = await import('../src/collab/service');

let relay: ReturnType<typeof fakeRelay>;
beforeEach(async () => {
  relay = fakeRelay();
  relay.install();
  await new Promise<void>((r, j) => { const q = indexedDB.deleteDatabase('falcon-collab'); q.onsuccess = () => r(); q.onerror = () => j(q.error); });
});
afterEach(async () => { await unmountAll(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const KEYS = { 'falcon.key.sendCard': 'Mod-Shift-F1', 'falcon.key.collab': 'Mod-Shift-F2', 'falcon.key.sendStarred': 'Mod-Shift-F3' };
const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel);
const button = (text: string, within: ParentNode = document) => [...within.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
const until = async (ok: () => boolean, what: string, ms = 3000) => {
  for (let t = 0; t < ms; t += 20) { if (ok()) return; await tick(20); }
  throw new Error(`timed out waiting for ${what}`);
};
/** The recipients' names as a list shows them (each is a box you can edit). */
const names = (root: ParentNode = document) => [...root.querySelectorAll<HTMLInputElement>('.rcp-row .rcp-nm')].map((n) => n.value);
const pressed = (label: string) => $(`[aria-label="${label}"]`)?.getAttribute('aria-pressed');
const picker = () => [...document.querySelectorAll('.co-pk .nm')].map((n) => n.textContent);
const people = async () => { const [a, b, c] = await Promise.all([makeIdentity(), makeIdentity(), makeIdentity()]); return { pat: encodeCode(a.pub), kim: encodeCode(b.pub), lee: encodeCode(c.pub), keys: { pat: a.pub, kim: b.pub, lee: c.pub } }; };

async function setup() {
  await freshStorage({ ...KEYS, 'falcon.relayUrl': RELAY });
  const app = await mountApp();
  await until(() => collab.current().status === 'ready', 'card sharing to load');
  return app;
}
type App = Awaited<ReturnType<typeof setup>>;
async function sharing(app: App) {
  await app.click($('.fstrip [aria-label="Settings"]'));
  await app.click(button('Sharing', $('[aria-label="Settings sections"]')!));
  return $('.st')!;
}
/** A card in the open doc, caret in it: what Send Card sends. */
async function aCard(app: App) {
  const v = app.view();
  await app.act(() => v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, [schema.node('paragraph', { style: 'tag' }, [schema.text('Trade solves war')])])));
}

describe('Recipients', () => {
  it('Settings > Sharing has your code with Copy, your name, and Recipients; a bad code is turned down in the row, with the code parser\'s reason', async () => {
    const app = await setup();
    const st = await sharing(app);
    const labels = [...st.querySelectorAll('.st-row .st-txt > span')].map((s) => s.textContent);
    expect(labels.slice(0, 4)).toEqual(['Relay?', 'Your pairing code', 'Your name', 'Recipients']);
    expect($('.co-code', st)?.textContent).toBe(collab.current().code);
    await app.fill($('input[aria-label="Your name"]', st), 'Jordan');
    await until(() => collab.current().name === 'Jordan', 'the name saved');
    expect($('.rcp-none', st)?.textContent).toBe('No one yet. Add the pairing code someone gave you.');

    await app.click(button('Add recipient', st));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Their pairing code');
    await app.fill($('input[aria-label="Their pairing code"]'), 'ABCD-EFGH');
    await app.fill($('input[aria-label="Their name"]'), 'Pat');
    await app.click(button('Add', st));
    const why = parseCode('ABCD-EFGH');
    expect(why.ok).toBe(false);
    expect($('.rcp-why[role="alert"]', st)?.textContent).toBe((why as { error: string }).error);
    expect($('input[aria-label="Their pairing code"]')?.hasAttribute('data-bad')).toBe(true);
    expect(collab.current().contacts).toEqual([]);

    const { pat } = await people();
    await app.fill($('input[aria-label="Their pairing code"]'), pat);
    await app.fill($('input[aria-label="Their name"]'), '  ');
    await app.click(button('Add', st));
    expect($('.rcp-why', st)?.textContent).toBe('Give them a name');
    await app.fill($('input[aria-label="Their name"]'), 'Pat');
    await app.click(button('Add', st));
    expect(app.toast()).toBe('Added Pat');
    expect(names(st)).toEqual(['Pat']);
    expect($('.rcp-cd', st)?.textContent).toMatch(/^\w+…\w+$/); // its ends; the whole code is its title
    expect($('.rcp-cd', st)?.getAttribute('title')).toBe(pat);
    expect(collab.current().contacts).toEqual([{ code: pat, name: 'Pat' }]);
    expect(document.activeElement?.textContent).toBe('Add recipient'); // ready for the next one
  });

  it('one list in two places: a change in Settings shows in the Card sharing panel, and one in the panel shows in Settings', async () => {
    const app = await setup();
    const { pat, kim } = await people();
    await collab.addContact(pat, 'Pat');
    await collab.addContact(kim, 'Kim');
    const st = await sharing(app);
    expect(names(st)).toEqual(['Pat', 'Kim']);
    const kimBox = st.querySelectorAll<HTMLInputElement>('.rcp-nm')[1];
    await app.fill(kimBox, 'Kimberly');
    await app.act(() => { kimBox.dispatchEvent(new FocusEvent('blur')); kimBox.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    await until(() => collab.current().contacts[1].name === 'Kimberly', 'the rename saved');
    // the Card sharing panel draws the same list, and a change there shows in Settings
    await app.click($('[aria-label="Close settings"]'));
    await app.press('F2', { ctrlKey: true, shiftKey: true }, 100);
    const panel = $('.cf.co')!;
    expect(names(panel)).toEqual(['Pat', 'Kimberly']);
    await app.click($('[aria-label="Move Kimberly up"]', panel));
    await until(() => names(panel).join() === 'Kimberly,Pat', 'the move in the panel');
    await app.click(button('Close', panel));
    expect(names(await sharing(app))).toEqual(['Kimberly', 'Pat']);
  });

  it('order, hidden and starred are kept, and Send Card to… and Send Card to starred follow them', async () => {
    const app = await setup();
    const { pat, kim, lee, keys } = await people();
    for (const [c, n] of [[pat, 'Pat'], [kim, 'Kim'], [lee, 'Lee']]) await collab.addContact(c, n);
    const st = await sharing(app);
    ($('[aria-label="Move Lee up"]', st) as HTMLElement).focus();
    await app.click($('[aria-label="Move Lee up"]', st));
    await app.act(() => {}, 20);
    expect(names(st)).toEqual(['Pat', 'Lee', 'Kim']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move Lee up'); // focus followed the row
    expect(($('[aria-label="Move Pat up"]', st) as HTMLButtonElement).disabled).toBe(true); // the first can't go up
    expect(($('[aria-label="Move Kim down"]', st) as HTMLButtonElement).disabled).toBe(true);

    await app.click($('[aria-label="Hide Pat from Send Card"]', st));
    expect(pressed('Hide Pat from Send Card')).toBe('true');
    expect($('.rcp-row[data-hidden] .rcp-nm', st)).toHaveProperty('value', 'Pat');
    await app.click($('[aria-label="Star Kim"]', st));
    expect(pressed('Star Kim')).toBe('true');
    await app.click($('[aria-label="Star Lee"]', st)); // the star moves: one at a time
    expect([pressed('Star Kim'), pressed('Star Lee')]).toEqual(['false', 'true']);

    // kept: after a restart, the same
    const again = await mountAppAgain();
    expect(collab.current().contacts).toEqual([{ code: pat, name: 'Pat', hidden: true }, { code: lee, name: 'Lee', starred: true }, { code: kim, name: 'Kim' }]);

    // Send Card to…: the list's order, without the hidden one
    await aCard(again);
    await again.press('F1', { ctrlKey: true, shiftKey: true }, 100);
    expect(picker()).toEqual(['Lee', 'Kim']);
    await again.click(button('Cancel'));
    // Send Card to starred: straight to Lee, no list
    await again.press('F3', { ctrlKey: true, shiftKey: true }, 300);
    expect($('.co-send')).toBeNull();
    expect(again.toast()).toBe('Sent “Trade solves war” to Lee');
    expect(relay.posted.map((p) => p.inbox)).toEqual([await inboxId(keys.lee)]);
    // a hidden one still gets it when starred
    await collab.starContact(pat, true);
    await again.press('F3', { ctrlKey: true, shiftKey: true }, 300);
    expect(again.toast()).toBe('Sent “Trade solves war” to Pat');
    expect(relay.posted.at(-1)!.inbox).toBe(await inboxId(keys.pat));
    // nobody starred: it says where to star someone, and sends nothing
    await collab.starContact(pat, false);
    await again.press('F3', { ctrlKey: true, shiftKey: true }, 300);
    expect(again.toast()).toBe('No one is starred. Star a recipient in Settings > Sharing first.');
    expect(relay.posted).toHaveLength(2);
    // everyone hidden: the list says so instead of looking empty
    await collab.hideContact(lee, true);
    await collab.hideContact(kim, true);
    await again.press('F1', { ctrlKey: true, shiftKey: true }, 100);
    expect(picker()).toEqual([]);
    expect($('.co-send .co-sub')?.textContent).toBe('Everyone is hidden from this list. Show someone again with the eye in Settings > Sharing.');
  });

  it('Remove folds the row shut where it is, and focus goes to the next row\'s Remove, then to Add recipient', async () => {
    const app = await setup();
    const { pat, kim } = await people();
    await collab.addContact(pat, 'Pat');
    await collab.addContact(kim, 'Kim');
    const st = await sharing(app);
    ($('[aria-label="Remove Pat"]', st) as HTMLElement).focus();
    await app.click($('[aria-label="Remove Pat"]', st));
    expect([...st.querySelectorAll<HTMLInputElement>('.co-fold[data-gone] .rcp-nm')].map((n) => n.value)).toEqual(['Pat']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove Kim');
    expect(app.toast()).toBe('Removed Pat');
    await app.act(() => {}, 400);
    expect(names(st)).toEqual(['Kim']);
    await app.click($('[aria-label="Remove Kim"]', st));
    expect(document.activeElement?.textContent).toBe('Add recipient');
    await app.act(() => {}, 400);
    expect(names(st)).toEqual([]);
    expect(collab.current().contacts).toEqual([]);
  });

  it("the relay guide's last step offers Add a recipient, which opens the add row in Settings", async () => {
    const app = await setup();
    // a relay that answers the guide's two checks
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => (String(url).endsWith('/v1/rooms') ? new Response('{"rooms":1}')
      : String(url).endsWith(`/v1/inbox/${'0'.repeat(64)}`) ? new Response('{"error":"bad_envelope"}', { status: 400 }) : inner(url, init)));
    const st = await sharing(app);
    await app.click($('.st-help', st));
    while (!$('.rg input[aria-label="Relay address"]')) await app.click(button('Next', $('.rg')!));
    await app.click(button('Check and save', $('.rg')!), 200);
    await until(() => /^It works/.test($('.rg-note')?.textContent ?? ''), 'the check');
    expect($('.rg-body')?.textContent).toMatch(/Next, swap pairing codes with each person you'll send cards to\. .*Their code goes under Recipients/);
    await app.click(button('Add a recipient', $('.rg')!));
    expect($('.rg')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Their pairing code');
  });
});

/** The app again on the same storage (a restart), without the setup's fresh storage. */
async function mountAppAgain() {
  await unmountAll();
  const app = await mountApp();
  await until(() => collab.current().status === 'ready', 'reload');
  return app;
}
