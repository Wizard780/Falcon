import 'fake-indexeddb/auto';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, mountApp, tick, unmountAll } from './app-harness';
import { RELAY, fakeRelay } from './collab-relay-fake';

// Card sharing in the real <App/>: its IndexedDB (fake-indexeddb), its relay transport over a fake
// relay that speaks the real protocol, and the other person played by the same crypto module.
const { encodeCode, inboxId, keyOf, parseCode } = await import('../src/collab/code');
const { b64url, makeIdentity, open, seal } = await import('../src/collab/crypto');
const { schema } = await import('../src/editor/schema');
const { markMap } = await import('../src/editor/editor');
const collab = await import('../src/collab/service');
const { nextUtcMidnight } = await import('../src/collab/relay');

let relay: ReturnType<typeof fakeRelay>;
beforeEach(async () => {
  relay = fakeRelay();
  relay.install();
  // each test is a fresh install: no identity, no contacts
  // only once it's really gone: a delete blocked by the last test's open connection finishes later and would wipe this one's
  await new Promise<void>((r, j) => { const q = indexedDB.deleteDatabase('falcon-collab'); q.onsuccess = () => r(); q.onerror = () => j(q.error); });
});
afterEach(async () => { await unmountAll(); vi.unstubAllGlobals(); });

const KEYS = { 'falcon.key.sendCard': 'Mod-Shift-F1', 'falcon.key.collab': 'Mod-Shift-F2' };
const $ = (sel: string) => document.querySelector(sel);
// a button in the dialog that's up (the toolbar has its own Insert)
const button = (text: string, within: ParentNode = [...document.querySelectorAll('.cf-back')].pop() ?? document) => [...within.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
/** The recipients' names as their rows show them (each is a box you can edit), or only the ones folding away. */
const names = (sel = '.rcp-row') => [...document.querySelectorAll<HTMLInputElement>(`${sel} .rcp-nm`)].map((n) => n.value);
const until = async (ok: () => boolean, what: string, ms = 3000) => {
  for (let t = 0; t < ms; t += 20) { if (ok()) return; await tick(20); }
  throw new Error(`timed out waiting for ${what}`);
};

/** A card the way Falcon writes one: tag, cite, and a body with underline, highlight and an emphasis box. */
function formattedCard() {
  const s = schema, t = (text: string, ...m: ReturnType<typeof s.mark>[]) => s.text(text, m);
  return [
    s.node('paragraph', { style: 'tag' }, [t('Warming causes resource wars')]),
    s.node('paragraph', null, [t('Smith 24', s.mark('cite')), t(', Professor at Yale')]),
    s.node('paragraph', null, [t('studies show that '), t('rising heat', s.mark('underline'), s.mark('highlight', { color: 'cyan' })), t(' leads to '), t('conflict', s.mark('emphasis'), s.mark('highlight'))]),
  ];
}

async function setup(storage: Record<string, string> = { 'falcon.relayUrl': RELAY }) {
  await freshStorage({ ...KEYS, ...storage });
  const app = await mountApp();
  await until(() => collab.current().status === 'ready', 'card sharing to load');
  return app;
}
const openPanel = async (app: Awaited<ReturnType<typeof mountApp>>) => { await app.press('F2', { ctrlKey: true, shiftKey: true }, 100); };

describe('card sharing in the app', () => {
  it('a formatted card from someone arrives without taking focus, and Insert puts it in the document with its marks', async () => {
    const app = await setup();
    await until(() => relay.proven() === 1, 'the app to prove its key to the relay');
    // the app's code, as the panel shows it
    await openPanel(app);
    const code = $('.co-code')?.textContent ?? '';
    expect(parseCode(code).ok).toBe(true);
    await app.click(button('Close'));
    await app.type('My own notes. ');
    const focused = document.activeElement;

    // Sam's Falcon seals a card to that code and posts it
    const sam = await makeIdentity();
    const content = formattedCard();
    const env = await seal(sam, parseCode(code).ok ? (parseCode(code) as { pub: Uint8Array }).pub : new Uint8Array(), { name: 'Sam', at: Date.now(), content: content.map((n) => n.toJSON()) });
    const inbox = await inboxId((parseCode(code) as { pub: Uint8Array }).pub);
    expect((await relay.post(inbox, env)).status).toBe(201);
    await until(() => relay.acks.length === 1, 'the card to be stored and acked');
    await app.act(() => {}, 50);

    // noticed: a toast and the rail's cue; not taken: focus and the document are as they were
    expect(app.toast()).toContain("Card from a code not in your recipients, who says they're Sam: “Warming causes resource wars”");
    expect($('.fstrip [aria-label="Sharing, 1 card waiting"] .share-n')?.textContent).toBe('1');
    expect(document.activeElement).toBe(focused);
    expect(app.text()).toBe('My own notes. ');
    expect(relay.inboxes.get(inbox)).toEqual([]); // acked only after it was stored, so the relay forgot it

    // the panel lists it from an unknown code; Add recipient opens the add row with their code and what they call themselves
    await app.click($('.fstrip [aria-label="Sharing, 1 card waiting"]'));
    expect($('.co-card .co-what span')?.textContent).toContain("From a code not in your recipients, who says they're Sam");
    await app.click(button('Add recipient', $('.co-card')!));
    expect(($('input[aria-label="Their pairing code"]') as HTMLInputElement).value).toBe(encodeCode(sam.pub));
    expect(($('input[aria-label="Their name"]') as HTMLInputElement).value).toBe('Sam');
    await app.click(button('Add'));
    expect(collab.current().contacts).toEqual([{ code: encodeCode(sam.pub), name: 'Sam' }]);
    expect($('.co-card .co-what span')?.textContent).toContain('From Sam');

    // Insert: below the caret's paragraph, marks and styles intact
    await app.click(button('Insert'));
    expect(app.toast()).toBe('Inserted “Warming causes resource wars”');
    expect($('.cf.co')).toBeNull();
    const map = markMap(app.view().state.doc);
    const sent = markMap(schema.node('doc', null, content));
    expect(map).toContain(sent);
    expect(map).toContain('[rising heat]{highlight:cyan+underline}');
    expect(map).toContain('[conflict]{emphasis+highlight:yellow}');
    expect(collab.current().cards).toEqual([]);
    expect($('.fstrip [aria-label="Sharing"]')).not.toBeNull(); // the button stays, its count gone
    expect($('.fstrip .share-n')).toBeNull();
    // the panel opened again starts with the add row shut (that draft is done), so Esc closes it
    await openPanel(app);
    expect($('.rcp-add')).toBeNull();
    await app.press('Escape');
    expect($('.cf.co')).toBeNull();
    // and it's done for good: gone after a restart too
    await unmountAll();
    await mountApp();
    await until(() => collab.current().status === 'ready', 'reload');
    expect(collab.current().cards).toEqual([]);
    expect(collab.current().contacts.map((c) => c.name)).toEqual(['Sam']);
  });

  it('Send Card to… seals the card at the caret to a contact; only they can open it, and it says it came from this Falcon', async () => {
    const app = await setup();
    const pat = await makeIdentity();
    await openPanel(app);
    await app.click(button('Add recipient'));
    await app.fill($('input[aria-label="Their pairing code"]'), encodeCode(pat.pub).toLowerCase());
    await app.fill($('input[aria-label="Their name"]'), 'Pat');
    await app.fill($('#co-name'), 'Jordan');
    await app.click(button('Add'));
    expect(collab.current().contacts).toEqual([{ code: encodeCode(pat.pub), name: 'Pat' }]);
    await app.click(button('Close'));

    // a card in the doc, caret in it
    const v = app.view();
    await app.act(() => v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, formattedCard())));
    await app.press('F1', { ctrlKey: true, shiftKey: true }, 100);
    expect($('#co-st')?.textContent).toBe('Send “Warming causes resource wars” to…');
    await app.click($('.co-pk'), 300);
    expect(app.toast()).toBe('Sent “Warming causes resource wars” to Pat');

    expect(relay.posted).toHaveLength(1);
    const { inbox, data, headers } = relay.posted[0];
    expect(inbox).toBe(await inboxId(pat.pub));
    expect([...headers.keys()]).toEqual([]); // no Content-Type or custom header: no CORS preflight
    const got = await open(pat, data);
    // sealed by this Falcon's key, and carrying its code (with its relay) for Add contact
    expect(keyOf(encodeCode(got.from))).toBe(keyOf(collab.current().code));
    expect(got.card.code).toBe(collab.current().code);
    expect(parseCode(collab.current().code).ok && (parseCode(collab.current().code) as { relay: string }).relay).toBe(RELAY);
    expect(got.card.name).toBe('Jordan');
    expect(markMap(schema.node('doc', null, (got.card.content as object[]).map((n) => schema.nodeFromJSON(n))))).toBe(markMap(schema.node('doc', null, formattedCard())));
    await expect(open(await makeIdentity(), data)).rejects.toThrow();
  });

  it('with no relay set, sharing is inert and says so; the code and recipients still work', async () => {
    const app = await setup({});
    await openPanel(app);
    expect($('.co-line')?.textContent).toBe('No relay is set, so nobody can send you cards yet, and yours go only to recipients whose code carries their relay. Add one in Settings > Sharing');
    expect(parseCode($('.co-code')?.textContent ?? '').ok).toBe(true);
    expect((parseCode($('.co-code')?.textContent ?? '') as { relay: string | null }).relay).toBeNull(); // a v1 code: who you are, no relay
    expect($('.co-me')?.previousElementSibling?.textContent).toMatch(/^Nobody can send you cards until you set a relay in Settings > Sharing/);
    const pat = await makeIdentity();
    await app.click(button('Add recipient'));
    await app.fill($('input[aria-label="Their pairing code"]'), encodeCode(pat.pub));
    await app.fill($('input[aria-label="Their name"]'), 'Pat');
    await app.click(button('Add'));
    await app.click(button('Close'));
    const v = app.view();
    await app.act(() => v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, formattedCard())));
    await app.press('F1', { ctrlKey: true, shiftKey: true }, 100);
    await app.click($('.co-pk'), 200);
    expect(app.toast()).toBe("No relay is set, so cards can't be sent yet. Add one in Settings > Sharing");
    expect(relay.posted).toHaveLength(0);
    await app.type(' still types');
    expect(app.text()).toContain('still types');
  });

  it('my code carries my relay; a new relay makes a new code, and the panel says people need it', async () => {
    const app = await setup();
    await openPanel(app);
    const first = $('.co-code')?.textContent ?? '';
    expect((parseCode(first) as { relay: string }).relay).toBe(RELAY);
    expect($('.co-me')?.previousElementSibling?.textContent).toMatch(/^Give it to whoever will send you cards\. It carries your relay/);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText: async () => {} } }));
    await app.click($('.co-me button'), 100); // Copy: the code given out
    await until(() => collab.current().gave === first, 'the copied code to be kept');
    await app.click(button('Close'));
    const { P, setPref } = await import('../src/editor/prefs');
    await app.act(async () => { setPref(P.relayUrl, 'https://falcon-relay.my-team.workers.dev'); await tick(50); });
    await openPanel(app);
    const now = $('.co-code')?.textContent ?? '';
    expect(now).not.toBe(first);
    expect((parseCode(now) as { relay: string }).relay).toBe('https://falcon-relay.my-team.workers.dev');
    expect(keyOf(now)).toBe(keyOf(first)); // the same person
    expect(now.replace(/-/g, '').length).toBeLessThan(80); // the workers.dev shortcut keeps it short
    const note = $('.co-me')?.previousElementSibling;
    expect(note?.textContent).toBe('Your relay changed, so your code did too. People who send you cards need this new one.');
    expect(note?.hasAttribute('data-changed')).toBe(true);
  });

  it('a new relay says people need the new code even when it was never copied with Copy', async () => {
    const app = await setup();
    await openPanel(app);
    const first = $('.co-code')?.textContent ?? '';
    await app.click(button('Close'));
    const { P, setPref } = await import('../src/editor/prefs');
    await app.act(async () => { setPref(P.relayUrl, 'https://falcon-relay.other-team.workers.dev'); await tick(50); });
    await openPanel(app);
    expect($('.co-code')?.textContent).not.toBe(first);
    expect($('.co-me')?.previousElementSibling?.textContent).toBe('Your relay changed, so your code did too. People who send you cards need this new one.');
  });

  it("a card goes to the relay its contact's code carries, even with no relay of my own; a v1 contact uses mine", async () => {
    const other = 'https://pat-relay.test';
    relay = fakeRelay([other]);
    relay.install();
    const app = await setup({});
    const pat = await makeIdentity(), kim = await makeIdentity();
    expect(await collab.addContact(encodeCode(pat.pub, other), 'Pat')).toBeNull();
    const v = app.view();
    await app.act(() => v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, formattedCard())));
    expect((await collab.send(collab.current().contacts[0], v.state.doc.content)).message).toBe('Sent “Warming causes resource wars” to Pat');
    expect(relay.posted.map((x) => x.url)).toEqual([`${other}/v1/inbox/${await inboxId(pat.pub)}`]);
    expect((await open(pat, relay.posted[0].data)).card.code).toBe(collab.current().code); // a v1 code: I set no relay
    // the same person again with a new relay: one contact, the new code
    expect(await collab.addContact(encodeCode(pat.pub, 'https://falcon-relay.pats-new.workers.dev'), 'Pat')).toBeNull();
    expect(collab.current().contacts).toEqual([{ code: encodeCode(pat.pub, 'https://falcon-relay.pats-new.workers.dev'), name: 'Pat' }]);
    // a contact from a v1 code, with no relay of mine: nothing to send through
    expect(await collab.addContact(encodeCode(kim.pub), 'Kim')).toBeNull();
    const k = collab.current().contacts.find((c) => c.name === 'Kim')!;
    expect((await collab.send(k, v.state.doc.content)).message).toBe("No relay is set, so cards can't be sent yet. Add one in Settings > Sharing");
    expect(relay.posted).toHaveLength(1);
  });

  it("a flood of live-editing invites from strangers never pushes out a contact's", async () => {
    const app = await setup();
    await until(() => relay.proven() === 1, 'connected');
    const me = parseCode(collab.current().code) as { pub: Uint8Array };
    const inbox = await inboxId(me.pub);
    const pat = await makeIdentity();
    await collab.addContact(encodeCode(pat.pub), 'Pat');
    const invite = (n: number) => ({ room: n.toString(16).padStart(64, '0'), key: b64url(new Uint8Array(32).fill(n % 256)), doc: `Doc ${n}` });
    await relay.post(inbox, await seal(pat, me.pub, { name: 'Pat', at: Date.now(), content: [], mid: 'pat-1', invite: invite(1) }));
    await until(() => collab.current().invites.length === 1, "Pat's invite");
    await until(() => app.toast().startsWith('Pat invited you to live-edit “Doc 1”'), "Pat's toast");
    // a stranger is named as one, and their name is only what they say it is
    await relay.post(inbox, await seal(await makeIdentity(), me.pub, { name: 'Coach Smith', at: Date.now(), content: [], mid: 'x-coach', invite: invite(99) }));
    await until(() => app.toast().startsWith("A code not in your recipients, who says they're Coach Smith, invited you to live-edit “Doc 99”"), `the stranger's toast (${app.toast()})`);
    for (let i = 0; i < 21; i++) {
      const x = await makeIdentity();
      await relay.post(inbox, await seal(x, me.pub, { name: 'Stranger', at: Date.now(), content: [], mid: `x${i}`, invite: invite(100 + i) }));
    }
    await until(() => collab.current().invites.some((v) => v.invite.doc === 'Doc 120'), 'the last stranger', 10000);
    const docs = collab.current().invites.map((v) => v.invite.doc);
    expect(docs).toHaveLength(20);
    expect(docs).toContain('Doc 1'); // Pat's stays
    expect(docs).not.toContain('Doc 99'); // the oldest strangers' went
    expect(docs).not.toContain('Doc 100');
    expect(collab.current().cards).toHaveLength(0); // and none of it counts as a card waiting
  });

  it('Sharing is one dialog: a Cards | Live switch, each command and key landing on its tab', async () => {
    const app = await setup({ 'falcon.relayUrl': RELAY, 'falcon.key.live': 'Mod-Shift-F3' });
    const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('.sh-sw [role="tab"]')];
    const lit = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;
    const key = async (el: Element, k: string) => { await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); await tick(50); }); };
    // Card sharing's key opens it on Cards, focus on the panel's first button
    await openPanel(app);
    const dlg = $('.cf.co[role="dialog"]');
    expect(document.getElementById(dlg?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Sharing');
    expect(lit()).toBe('Cards');
    expect($('.co-code')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('Copy');
    // the switch: a click goes to Live and leaves focus on the switch, the arrows come back
    await app.click(tabs()[1]);
    expect(lit()).toBe('Live');
    expect($('.cf.co-live section[aria-label="Invites"]')).not.toBeNull();
    expect($('.co-code')).toBeNull();
    expect($('.cf.co')).toBe(dlg); // the same dialog, not another
    expect($('#sh-pane')?.getAttribute('aria-labelledby')).toBe('sh-live');
    await key(tabs()[1], 'ArrowLeft');
    expect(lit()).toBe('Cards');
    expect(document.activeElement).toBe(tabs()[0]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1]);
    await key(tabs()[0], 'ArrowRight');
    expect(lit()).toBe('Live');
    expect(document.activeElement).toBe(tabs()[1]);
    // Esc closes it from either tab
    await app.press('Escape');
    expect($('.cf.co')).toBeNull();
    // Live editing's key opens it on Live
    await app.press('F3', { ctrlKey: true, shiftKey: true }, 100);
    expect(lit()).toBe('Live');
    expect(document.activeElement?.textContent).toBe('Start live editing');
    await app.press('Escape');
    // the rail's Sharing button, nothing waiting: Cards
    await app.click($('.fstrip [aria-label="Sharing"]'));
    expect(lit()).toBe('Cards');
    await app.click(button('Close'));
    expect($('.cf.co')).toBeNull();
  });

  it("an invite from a stranger waits on the rail's Sharing button until it's joined or dismissed", async () => {
    const app = await setup();
    await until(() => relay.proven() === 1, 'connected');
    const me = parseCode(collab.current().code) as { pub: Uint8Array };
    const inbox = await inboxId(me.pub);
    const invite = (n: number) => ({ room: n.toString(16).padStart(64, '0'), key: b64url(new Uint8Array(32).fill(n)), doc: `Doc ${n}` });
    expect($('.fstrip [aria-label="Sharing"]')).not.toBeNull(); // always there, nothing waiting
    await relay.post(inbox, await seal(await makeIdentity(), me.pub, { name: 'Quinn', at: Date.now(), content: [], mid: 'q-1', invite: invite(1) }));
    await until(() => app.toast().startsWith("A code not in your recipients, who says they're Quinn, invited you to live-edit “Doc 1”"), `the toast (${app.toast()})`);
    const btn = $('.fstrip [aria-label="Sharing, 1 invite waiting"]');
    expect(btn?.querySelector('.share-n')?.textContent).toBe('1');
    expect(btn?.getAttribute('title') ?? (btn as HTMLElement | null)?.dataset.tip).toBe('1 invite waiting for you. Show live editing');
    // only invites wait: it opens Live editing, where the invite is
    await app.click(btn);
    expect($('.cf.co-live')).not.toBeNull();
    expect($('.co-live section[aria-label="Invites"] .lv-inv')?.textContent).toContain("From a code not in your recipients, who says they're Quinn");
    // still waiting after the toast has gone and after a restart, until it's dealt with
    await unmountAll();
    await mountApp();
    await until(() => !!$('.fstrip [aria-label="Sharing, 1 invite waiting"]'), 'the count after a restart');
    await app.press('Escape');
    // Dismiss: the count goes
    await relay.post(inbox, await seal(await makeIdentity(), me.pub, { name: 'Rae', at: Date.now(), content: [], mid: 'r-1', invite: invite(2) }));
    await until(() => !!$('.fstrip [aria-label="Sharing, 2 invites waiting"]'), 'two waiting');
    await app.click($('.fstrip [aria-label="Sharing, 2 invites waiting"]'));
    await app.click([...document.querySelectorAll('.co-live .lv-inv')].find((r) => r.textContent?.includes('Doc 2'))!.querySelector('button:last-child'));
    await until(() => !!$('.fstrip [aria-label="Sharing, 1 invite waiting"]'), 'one left after Dismiss');
    // joined: it stays listed (to join again after leaving) and no longer waits
    await collab.joinedInvite(collab.current().invites[0].id);
    await until(() => !!$('.fstrip [aria-label="Sharing"]') && !$('.fstrip .share-n'), 'none waiting once joined');
    expect(collab.current().invites).toHaveLength(1);
    expect(collab.waiting()).toEqual({ cards: 0, invites: 0 });
  });

  it('a relay that is down or out of its daily requests says so plainly, and the editor keeps working', async () => {
    const app = await setup();
    await until(() => relay.proven() === 1, 'connected');
    const pat = await makeIdentity();
    await collab.addContact(encodeCode(pat.pub), 'Pat');
    const v = app.view();
    await app.act(() => v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, formattedCard())));
    relay.down();
    await until(() => collab.current().link.kind === 'retry', 'the socket to back off');
    await openPanel(app);
    expect($('.co-line')?.textContent).toMatch(/^Can't reach the relay: no connection, or it's over its daily limit until .+\. Trying again in under a minute$/);
    await app.click(button('Close'));
    await app.press('F1', { ctrlKey: true, shiftKey: true }, 100);
    await app.click($('.co-pk'), 200);
    expect(app.toast()).toBe("Couldn't reach the relay. Check the wifi, then send it again");

    relay.answer(429);
    // back up, but over the free plan's daily limit
    const r2 = fakeRelay(); r2.answer(429); r2.install();
    await app.press('F1', { ctrlKey: true, shiftKey: true }, 100);
    await app.click($('.co-pk'), 200);
    const until0 = new Date(nextUtcMidnight()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(app.toast()).toBe(`Card sharing is paused until ${until0}, when the relay's daily limit resets. The card wasn't sent`);
    expect(new Date(nextUtcMidnight()).getUTCHours()).toBe(0);
    expect(nextUtcMidnight() - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
    await app.type(' and more');
    expect(app.text()).toContain(' and more');
  });

  it('New code… asks first (Esc keeps the panel), then listens on the new inbox; the old code goes dead', async () => {
    const app = await setup();
    await until(() => relay.proven() === 1, 'connected');
    await openPanel(app);
    const old = collab.current().code;
    await app.click(button('New code…'));
    expect($('.cf[role="alertdialog"] #cf-t')?.textContent).toBe('Make a new pairing code?');
    await app.press('Escape');
    expect($('.cf[role="alertdialog"]')).toBeNull(); // Esc answered the question
    expect($('.cf.co')).not.toBeNull(); // and left the panel up
    expect(collab.current().code).toBe(old);
    await app.click(button('New code…'));
    await app.click($('.cf-ok'));
    await until(() => collab.current().code !== old, 'a new code');
    const fresh = collab.current().code;
    expect($('.co-code')?.textContent).toBe(fresh);
    const pubOf = (c: string) => (parseCode(c) as { pub: Uint8Array }).pub;
    const newInbox = await inboxId(pubOf(fresh)), oldInbox = await inboxId(pubOf(old));
    await until(() => relay.provenOn(newInbox) === 1, 'the socket on the new inbox');
    expect(relay.provenOn(oldInbox)).toBe(0);
    const sam = await makeIdentity();
    await relay.post(oldInbox, await seal(sam, pubOf(old), { name: 'Sam', at: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'To the old code' }] }] }));
    await relay.post(newInbox, await seal(sam, pubOf(fresh), { name: 'Sam', at: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'To the new code' }] }] }));
    await until(() => collab.current().cards.length === 1, 'the card to the new code');
    await app.act(() => {}, 100);
    expect(collab.current().cards.map((c) => c.label)).toEqual(['To the new code']);
    expect(relay.inboxes.get(oldInbox)).toHaveLength(1); // nobody collects it; the relay expires it
    // and the new code is the one kept
    await unmountAll();
    await mountApp();
    await until(() => collab.current().status === 'ready', 'reload');
    expect(collab.current().code).toBe(fresh);
  });

  it('Remove takes a recipient off for good', async () => {
    const app = await setup({});
    const pat = await makeIdentity(), kim = await makeIdentity();
    expect(await collab.addContact(encodeCode(pat.pub), 'Pat')).toBeNull();
    expect(await collab.addContact(encodeCode(kim.pub), 'Kim')).toBeNull();
    await openPanel(app);
    expect($('.cf.co')).not.toBeNull();
    expect(names()).toEqual(['Pat', 'Kim']);
    ($('[aria-label="Remove Pat"]') as HTMLElement).focus(); // as a real click does
    await app.click($('[aria-label="Remove Pat"]'));
    // the row folds shut where it is, then goes
    expect(names('.co-fold[data-gone] .rcp-row')).toEqual(['Pat']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove Kim'); // focus went to the next row
    await app.act(() => {}, 400);
    expect(names()).toEqual(['Kim']);
    await unmountAll();
    await mountApp();
    await until(() => collab.current().status === 'ready', 'reload');
    expect(collab.current().contacts.map((c) => c.name)).toEqual(['Kim']);
  });

  it('a card or recipient whose save fails stays, and says so in its row; Dismiss all asks first and takes every card', async () => {
    const store = await import('../src/collab/store');
    const app = await setup();
    await until(() => relay.proven() === 1, 'connected');
    const me = parseCode(collab.current().code) as { pub: Uint8Array };
    const inbox = await inboxId(me.pub);
    const eve = await makeIdentity();
    for (const i of [1, 2, 3]) await relay.post(inbox, await seal(eve, me.pub, { name: 'E', at: i, content: [{ type: 'paragraph', content: [{ type: 'text', text: `Card ${i}` }] }] }));
    await until(() => collab.current().cards.length === 3, 'three cards in');
    expect(await collab.addContact(encodeCode((await makeIdentity()).pub), 'Pat')).toBeNull();
    await openPanel(app);
    const row = (i: number) => document.querySelectorAll('.co-card')[i];
    // a save that fails: the card is still in the list and in the store, and its row says why
    const drop = vi.spyOn(store, 'dropCard').mockRejectedValueOnce(new Error('disk full'));
    await app.click(button('Dismiss', row(1)));
    expect(collab.current().cards.length).toBe(3);
    expect(document.querySelector('.co-fold[data-gone]')).toBeNull();
    expect(row(1).querySelector('[role="alert"]')?.textContent).toBe("Couldn't save that, so this card is still here. Try again");
    expect((button('Dismiss', row(1)) as HTMLButtonElement).disabled).toBe(false);
    // again, and it goes
    await app.click(button('Dismiss', row(1)));
    await until(() => document.querySelectorAll('.co-card').length === 2, 'the row folded shut and went');
    expect(drop).toHaveBeenCalledTimes(2);
    expect([...document.querySelectorAll('.co-card b')].map((b) => b.textContent)).toEqual(['Card 1', 'Card 3']);
    // the same for a recipient
    vi.spyOn(store, 'updateContacts').mockRejectedValueOnce(new Error('disk full'));
    await app.click($('[aria-label="Remove Pat"]'));
    expect(collab.current().contacts.map((c) => c.name)).toEqual(['Pat']);
    expect(document.querySelector('.rcp-row [role="alert"]')?.textContent).toBe("Couldn't save that. Try again");
    // Dismiss all: Cancel keeps them, Dismiss all takes both and the section with them
    await app.click(button('Dismiss all'));
    expect($('#cf-t')?.textContent).toBe('Dismiss all 2 cards?');
    await app.click(button('Cancel'));
    expect(collab.current().cards.length).toBe(2);
    await app.click(button('Dismiss all'));
    await app.click(button('Dismiss all', [...document.querySelectorAll('.cf-back')].pop()!));
    await until(() => !$('[aria-label="Cards waiting"]'), 'the section folded shut and went');
    expect(collab.current().cards.length).toBe(0);
    expect((await store.loadCards()).length).toBe(0);
    vi.restoreAllMocks();
  });

  it('junk sent to the code is dropped (and acked, so it never comes back); a card it already has is not shown twice', async () => {
    const app = await setup();
    await until(() => relay.proven() === 1, 'connected');
    const me = parseCode(collab.current().code) as { pub: Uint8Array };
    const inbox = await inboxId(me.pub);
    const eve = await makeIdentity();
    const good = await seal(eve, me.pub, { name: 'E', at: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fine card' }] }] });
    const bad = good.slice(); bad[bad.length - 1] ^= 1; // tampered
    const notACard = await seal(eve, me.pub, { name: 'E', at: 1, content: [{ type: 'nonsense' }] });
    for (const e of [bad, notACard, good]) await relay.post(inbox, e);
    await until(() => relay.acks.length === 3, 'all three acked');
    await app.act(() => {}, 50);
    // the tampered one is gone; the one this Falcon can't open is shown so it isn't lost without a word, with only Dismiss
    expect(collab.current().cards.map((c) => c.label)).toEqual(["A card this Falcon can't open", 'Fine card']);
    await openPanel(app);
    const odd = document.querySelectorAll('.co-card')[0];
    expect([...odd.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Add recipient', 'Dismiss']);
    expect(odd.textContent).toContain('It may need a newer Falcon');
    await app.click(button('Dismiss', odd));
    await app.click(button('Close'));
    expect(collab.current().cards.map((c) => c.label)).toEqual(['Fine card']);
    // the same card delivered again (its ack was lost): stored once
    const id = collab.current().cards[0].id;
    await collab.drop(id);
    const shown = vi.fn();
    const off = collab.onArrive(shown);
    relay.inboxes.set(inbox, [{ id, data: good }]);
    relay.down();
    const r2 = fakeRelay(); r2.inboxes.set(inbox, [{ id, data: good }]); r2.install();
    window.dispatchEvent(new Event('online'));
    await until(() => r2.acks.length === 1, 'redelivery acked');
    await app.act(() => {}, 50);
    expect(collab.current().cards).toEqual([]);
    expect(shown).not.toHaveBeenCalled();
    off();
  });

  it('a send that may have got through is sent again under the same id, so it arrives once', async () => {
    const app = await setup();
    await until(() => relay.proven() === 1, 'connected');
    const me = parseCode(collab.current().code) as { pub: Uint8Array };
    const inbox = await inboxId(me.pub);
    const sam = await makeIdentity();
    const content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Sent twice' }] }];
    // Sam's first POST was stored but its answer was lost, so Sam's Falcon sent the card again
    for (let i = 0; i < 2; i++) await relay.post(inbox, await seal(sam, me.pub, { name: 'Sam', at: 1, content, mid: 'same-send' }));
    // someone else using the same id is a different card
    await relay.post(inbox, await seal(await makeIdentity(), me.pub, { name: 'Eve', at: 1, content, mid: 'same-send' }));
    await until(() => relay.acks.length === 3, 'all acked');
    await app.act(() => {}, 50);
    expect(collab.current().cards.map((c) => c.claimed)).toEqual(['Sam', 'Eve']);

    // and this Falcon does the same: no answer, then the same card again → the same id inside both envelopes
    const bo = await makeIdentity();
    await collab.addContact(encodeCode(bo.pub), 'Bo');
    const frag = (await import('prosemirror-model')).Fragment.fromJSON(schema, content);
    relay.answer('down');
    const first = await collab.send(collab.current().contacts[0], frag);
    expect(first.ok).toBe(false);
    expect(first.message).toContain("Couldn't reach the relay");
    expect(first.message).not.toContain("wasn't sent"); // it can't know that
    relay.answer(null);
    expect((await collab.send(collab.current().contacts[0], frag)).ok).toBe(true);
    expect((await collab.send(collab.current().contacts[0], frag)).ok).toBe(true); // a new send of the same card is a new card
    const mids = await Promise.all(relay.posted.filter((p) => p.inbox !== inbox).map(async (p) => (await open(bo, p.data)).card.mid));
    expect(mids.length).toBe(2); // the failed one never reached the relay
    expect(mids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(mids[1]).not.toBe(mids[0]);
  });

  it('holds at most 50 cards: more wait on the relay, unacked, and come in once some are dealt with', async () => {
    const app = await setup();
    await until(() => relay.proven() === 1, 'connected');
    const me = parseCode(collab.current().code) as { pub: Uint8Array };
    const inbox = await inboxId(me.pub);
    const eve = await makeIdentity();
    const card = (i: number) => seal(eve, me.pub, { name: 'E', at: i, content: [{ type: 'paragraph', content: [{ type: 'text', text: `Card ${i}` }] }], mid: `m${i}` });
    for (let i = 0; i < 52; i++) await relay.post(inbox, await card(i));
    await until(() => relay.acks.length === 50, 'fifty stored and acked', 8000);
    await app.act(() => {}, 200);
    expect(collab.current().cards.length).toBe(50);
    expect(relay.acks.length).toBe(50);
    expect(relay.inboxes.get(inbox)!.length).toBe(2); // not lost: still on the relay
    // room for one: the app asks the relay again and takes one more
    await app.act(() => collab.drop(collab.current().cards[0].id), 50);
    await until(() => relay.acks.length === 51, 'one more taken in', 8000);
    await app.act(() => {}, 200);
    expect(collab.current().cards.length).toBe(50);
    expect(relay.inboxes.get(inbox)!.length).toBe(1);
  }, 30_000);

  it("the relay's address is saved on Enter, not as it's typed, and one without https:// gets it", async () => {
    const app = await setup({});
    await app.menu('settings');
    await app.fill($('input[aria-label="Search settings"]'), 'relay');
    const box = () => $('input[aria-label="Relay address"]') as HTMLInputElement;
    const sockets = vi.fn();
    const Real = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', class extends (Real as unknown as new (u: string) => object) { constructor(u: string) { super(u); sockets(u); } });
    await app.fill(box(), 'relay.te');
    await app.fill(box(), 'relay.test');
    expect(localStorage.getItem('falcon.relayUrl') ?? '').toBe('');
    expect(collab.current().relay).toBe('');
    expect(sockets).not.toHaveBeenCalled(); // no half-typed address was connected to
    await app.act(() => { box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, 100);
    expect(box().value).toBe('https://relay.test');
    await until(() => relay.proven() === 1, 'connected to the address once it was entered');
    expect(sockets.mock.calls.every(([u]) => String(u).startsWith('wss://relay.test/'))).toBe(true);
  });
});
