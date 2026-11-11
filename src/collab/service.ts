/**
 * Card sharing for the app: my code and name, contacts, cards waiting, and the link to the relay.
 * Every window reads the same IndexedDB and hears the others' changes over a BroadcastChannel; only
 * one window per launch (whoever holds a Web Lock) keeps the relay socket open.
 */
import { DOMParser, DOMSerializer, Fragment } from 'prosemirror-model';
import { schema } from '../editor/schema';
import { P, onPrefs, pref } from '../editor/prefs';
import { encodeCode, inboxId, parseCode } from './code';
import { BadEnvelope, MAX_ENVELOPE, open, proveKey, seal, type Identity } from './crypto';
import { DEFAULT_RELAY, nextUtcMidnight, relayTransport, type Link, type Transport } from './relay';
import * as store from './store';
import type { Contact, Received } from './store';

export type { Contact, Received };
export type CollabState = {
  status: 'loading' | 'unavailable' | 'ready';
  code: string; name: string; contacts: Contact[]; cards: Received[];
  /** the relay in use ('' = none set) */
  relay: string;
  link: Link;
  /** a send hit the relay's daily limit: nothing goes until then */
  pausedUntil: number;
};

const LABEL_MAX = 40;
let state: CollabState = { status: 'loading', code: '', name: '', contacts: [], cards: [], relay: '', link: { kind: 'off' }, pausedUntil: 0 };
const subs = new Set<() => void>();
const arrivals = new Set<(c: Received, contact: Contact | undefined) => void>();
const set = (p: Partial<CollabState>) => { state = { ...state, ...p }; for (const f of subs) f(); };
let me: (Identity & { inbox: string }) | null = null;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('falcon-collab') : null;
const told = (m: { t: 'changed' } | { t: 'card'; id: string }) => channel?.postMessage(m);

export const relayUrl = () => (pref(P.relayUrl).trim() || DEFAULT_RELAY).replace(/\/+$/, '');
export const contactFor = (code: string) => state.contacts.find((c) => c.code === code);

/** "Warming causes war", cut to fit a toast or a row. */
export function cardLabel(content: Fragment): string {
  let text = '';
  content.forEach((n) => { if (!text && n.textContent.trim()) text = n.textContent.trim().replace(/\s+/g, ' '); });
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1).trimEnd()}…` : text || 'A card';
}

/** Pictures that came in a card: only ones carried in the card itself. A web address would load from
 *  wherever the sender pointed it, telling that server when you opened the card. */
function embeddedOnly(nodes: unknown): unknown {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.filter((n) => !(n?.type === 'image' && !/^data:image\//i.test(String(n?.attrs?.src ?? ''))))
    .map((n) => (n && typeof n === 'object' && Array.isArray(n.content) ? { ...n, content: embeddedOnly(n.content) } : n));
}

/**
 * A received card's content as editor nodes, or null when it isn't something Falcon's documents can hold.
 * The JSON is drawn as the clipboard draws it and read back through the schema's paste rules, as a copy
 * and paste inside Falcon is, so a style, color or size the schema doesn't know can't reach the page.
 * It's drawn into a document of its own, which loads nothing.
 */
export function cardFragment(content: unknown): Fragment | null {
  try {
    const raw = Fragment.fromJSON(schema, embeddedOnly(content) as object[]);
    const inert = document.implementation.createHTMLDocument('');
    const box = inert.createElement('div');
    box.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(raw, { document: inert }));
    const f = DOMParser.fromSchema(schema).parse(box, { preserveWhitespace: 'full' }).content;
    if (!f.childCount || !f.textBetween(0, f.size, ' ', ' ').trim()) return null;
    schema.topNodeType.create(null, f).check();
    return f;
  } catch { return null; }
}

async function loadMe() {
  const id = await store.identity();
  me = { ...id, inbox: await inboxId(id.pub) };
  return encodeCode(id.pub);
}

async function reload() {
  const inbox = me?.inbox;
  const [code, name, contacts, cards] = await Promise.all([loadMe(), store.loadName(), store.loadContacts(), store.loadCards()]);
  set({ status: 'ready', code, name, contacts, cards, relay: relayUrl() });
  if (inbox && inbox !== me!.inbox) relisten(); // the code changed in another window
}

// ---------- listening ----------

let leading = false;
let stopListen: (() => void) | null = null;
/** The one transport there is so far; a LAN host would be picked here. */
const transportFor = (url: string): Transport => relayTransport(url);

async function onCard(id: string, envelope: Uint8Array) {
  if (!me) throw new Error('no identity yet');
  let got;
  try { got = await open(me, envelope); } catch (e) { if (e instanceof BadEnvelope) return; throw e; } // junk is acked and dropped
  const content = cardFragment(got.card.content);
  if (!content) return;
  const from = encodeCode(got.from);
  const card: Received = { id, from, claimed: got.card.name, sentAt: got.card.at, gotAt: Date.now(), label: cardLabel(content), content: got.card.content as unknown[] };
  if (!(await store.keepCard(card))) return; // had it already (an ack that didn't make it)
  set({ cards: [...state.cards, card] });
  told({ t: 'card', id });
  for (const f of arrivals) f(card, contactFor(from));
}

function relisten() {
  stopListen?.();
  stopListen = null;
  const url = relayUrl();
  set({ relay: url });
  if (!leading || !me || !url) { set({ link: { kind: 'off' } }); return; }
  const mine = me;
  stopListen = transportFor(url).listen(
    { pub: mine.pub, inbox: mine.inbox, prove: (eph, nonce) => proveKey(mine.priv, eph, nonce, mine.inbox) },
    { card: onCard, link: (link) => set({ link }) },
  );
}

/**
 * Load the saved state and, when `listen`, take this launch's one relay socket (or wait for it).
 * Called once by the app; the returned function undoes it.
 */
export function start(listen: boolean): () => void {
  if (!store.storeAvailable()) { set({ status: 'unavailable' }); return () => {}; }
  set({ status: 'loading' }); // until this start's own load is in (a restart must not read the last one's)
  let live = true;
  const hold = new AbortController();
  let release = () => {};
  const onMsg = async (e: MessageEvent<{ t: string; id?: string }>) => {
    if (!live) return;
    await reload().catch(() => {});
    const c = e.data.t === 'card' ? state.cards.find((x) => x.id === e.data.id) : null;
    if (c) for (const f of arrivals) f(c, contactFor(c.from));
  };
  channel?.addEventListener('message', onMsg);
  const offPrefs = onPrefs(() => { if (relayUrl() !== state.relay) relisten(); });
  void reload().then(() => {
    if (!live || !listen) return;
    const lead = () => { leading = true; relisten(); };
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) { lead(); return; }
    // held until this window closes or stops: then the next window waiting gets the socket
    void locks.request('falcon-collab-inbox', { signal: hold.signal }, () => new Promise<void>((r) => { release = r; if (live) lead(); else r(); })).catch(() => {});
  }, () => set({ status: 'unavailable' }));
  return () => {
    live = false;
    leading = false;
    channel?.removeEventListener('message', onMsg);
    offPrefs();
    stopListen?.();
    stopListen = null;
    hold.abort();
    release();
  };
}

export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const current = () => state;
/** A card came in (in this window or another): for the toast. */
export const onArrive = (f: (c: Received, contact: Contact | undefined) => void) => { arrivals.add(f); return () => { arrivals.delete(f); }; };

// ---------- changes ----------

const saved = async (p: Promise<unknown>) => { await p; told({ t: 'changed' }); };

/** Add (or rename) a contact. Returns why not, or null. */
export async function addContact(codeText: string, name: string): Promise<string | null> {
  const p = parseCode(codeText);
  if (!p.ok) return p.error;
  if (p.code === state.code) return "That's your own code";
  const nm = name.trim();
  if (!nm) return 'Give them a name';
  const contacts = [...state.contacts.filter((c) => c.code !== p.code), { code: p.code, name: nm.slice(0, 60) }];
  set({ contacts });
  await saved(store.saveContacts(contacts));
  return null;
}
export async function removeContact(code: string) {
  const contacts = state.contacts.filter((c) => c.code !== code);
  set({ contacts });
  await saved(store.saveContacts(contacts));
}
export async function setName(name: string) {
  set({ name });
  await saved(store.saveName(name.slice(0, 60)));
}
export async function newCode() {
  const id = await store.regenerate();
  me = { ...id, inbox: await inboxId(id.pub) };
  set({ code: encodeCode(id.pub) });
  relisten();
  told({ t: 'changed' });
}
/** Done with a card that came in (inserted, copied and let go, or dismissed). */
export async function drop(id: string) {
  set({ cards: state.cards.filter((c) => c.id !== id) });
  await saved(store.dropCard(id));
}

/** The local time the daily limits reset (00:00 UTC): "7:00 PM". */
export const resetTime = (until: number) => new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Seal a card to a contact and hand it to the relay. Resolves with what to tell the user, and whether it went. */
export async function send(contact: Contact, content: Fragment): Promise<{ ok: boolean; message: string }> {
  const label = cardLabel(content);
  const url = relayUrl();
  if (!url) return { ok: false, message: "No relay is set, so cards can't be sent yet. Add one in Settings > General > Card sharing" };
  if (state.pausedUntil > Date.now()) return { ok: false, message: `Card sharing is paused until ${resetTime(state.pausedUntil)}, when the relay's daily limit resets. The card wasn't sent` };
  const p = parseCode(contact.code);
  if (!p.ok || !me) return { ok: false, message: "Couldn't send: card sharing isn't ready yet" };
  let env: Uint8Array;
  try { env = await seal(me, p.pub, { name: state.name.trim(), at: Date.now(), content: content.toJSON() ?? [] }); } catch { return { ok: false, message: "Couldn't seal the card. It wasn't sent" }; }
  if (env.length > MAX_ENVELOPE) return { ok: false, message: 'That card is too big to send (over 1 MB, usually from pictures). It wasn\'t sent' };
  const r = await transportFor(url).send(await inboxId(p.pub), env);
  if (r.ok) return { ok: true, message: `Sent “${label}” to ${contact.name}` };
  if (r.error === 'daily_limit') {
    const until = nextUtcMidnight();
    set({ pausedUntil: until });
    return { ok: false, message: `Card sharing is paused until ${resetTime(until)}, when the relay's daily limit resets. The card wasn't sent` };
  }
  const why: Record<string, string> = {
    unreachable: "Couldn't reach the relay. Check the wifi. The card wasn't sent",
    too_large: "That card is too big for the relay. It wasn't sent",
    inbox_full: `${contact.name} has too many cards waiting. The card wasn't sent`,
    bad_envelope: "The relay turned the card down. It wasn't sent",
    relay_error: "The relay had a problem. The card wasn't sent",
  };
  return { ok: false, message: why[r.error] };
}
