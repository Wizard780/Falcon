import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, mountApp, tick, unmountAll } from './app-harness';
import { RELAY, fakeRelay } from './collab-relay-fake';

// Card sharing in the real <App/>: its IndexedDB (fake-indexeddb), its relay transport over a fake
// relay that speaks the real protocol, and the other person played by the same crypto module.
const { encodeCode, inboxId, parseCode } = await import('../src/collab/code');
const { makeIdentity, open, seal } = await import('../src/collab/crypto');
const { schema } = await import('../src/editor/schema');
const { markMap } = await import('../src/editor/editor');
const collab = await import('../src/collab/service');
const { nextUtcMidnight } = await import('../src/collab/relay');

let relay: ReturnType<typeof fakeRelay>;
beforeEach(async () => {
  relay = fakeRelay();
  relay.install();
  // each test is a fresh install: no identity, no contacts
  await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('falcon-collab'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
});
afterEach(async () => { await unmountAll(); vi.unstubAllGlobals(); });

const KEYS = { 'falcon.key.sendCard': 'Mod-Shift-F1', 'falcon.key.collab': 'Mod-Shift-F2' };
const $ = (sel: string) => document.querySelector(sel);
// a button in the dialog that's up (the toolbar has its own Insert)
const button = (text: string, within: ParentNode = [...document.querySelectorAll('.cf-back')].pop() ?? document) => [...within.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
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
    expect(app.toast()).toContain('Card from a code not in your contacts: “Warming causes resource wars”');
    expect($('[aria-label="Cards waiting (1)"]')).not.toBeNull();
    expect(document.activeElement).toBe(focused);
    expect(app.text()).toBe('My own notes. ');
    expect(relay.inboxes.get(inbox)).toEqual([]); // acked only after it was stored, so the relay forgot it

    // the panel lists it from an unknown code; Add contact fills in what they call themselves
    await app.click($('[aria-label="Cards waiting (1)"]'));
    expect($('.co-card .co-what span')?.textContent).toContain("From a code not in your contacts, who says they're Sam");
    await app.click(button('Add contact'));
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
    expect($('[aria-label^="Cards waiting"]')).toBeNull();
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
    expect(encodeCode(got.from)).toBe(collab.current().code);
    expect(got.card.name).toBe('Jordan');
    expect(markMap(schema.node('doc', null, (got.card.content as object[]).map((n) => schema.nodeFromJSON(n))))).toBe(markMap(schema.node('doc', null, formattedCard())));
    await expect(open(await makeIdentity(), data)).rejects.toThrow();
  });

  it('with no relay set, sharing is inert and says so; the code and contacts still work', async () => {
    const app = await setup({});
    await openPanel(app);
    expect($('.co-line')?.textContent).toBe("No relay is set, so cards can't be sent or received yet. Add one in Settings > General > Card sharing");
    expect(parseCode($('.co-code')?.textContent ?? '').ok).toBe(true);
    const pat = await makeIdentity();
    await app.fill($('input[aria-label="Their pairing code"]'), encodeCode(pat.pub));
    await app.fill($('input[aria-label="Their name"]'), 'Pat');
    await app.click(button('Add'));
    await app.click(button('Close'));
    const v = app.view();
    await app.act(() => v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, formattedCard())));
    await app.press('F1', { ctrlKey: true, shiftKey: true }, 100);
    await app.click($('.co-pk'), 200);
    expect(app.toast()).toBe("No relay is set, so cards can't be sent yet. Add one in Settings > General > Card sharing");
    expect(relay.posted).toHaveLength(0);
    await app.type(' still types');
    expect(app.text()).toContain('still types');
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
    expect($('.co-line')?.textContent).toMatch(/^Can't reach the relay\. Trying again in under a minute$/);
    await app.click(button('Close'));
    await app.press('F1', { ctrlKey: true, shiftKey: true }, 100);
    await app.click($('.co-pk'), 200);
    expect(app.toast()).toBe("Couldn't reach the relay. Check the wifi. The card wasn't sent");

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
});
