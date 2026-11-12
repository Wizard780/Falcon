/**
 * Card sharing for the app: my code and name, contacts, cards waiting, and the link to the relay.
 * Every window reads the same IndexedDB and hears the others' changes over a BroadcastChannel; only
 * one window per launch (whoever holds a Web Lock) keeps the relay socket open.
 */
import { DOMParser, DOMSerializer, Fragment, type Node as PMNode } from 'prosemirror-model';
import { noteNodes, schema } from '../editor/schema';
import { P, onPrefs, pref } from '../editor/prefs';
import { encodeCode, inboxId, keyOf, parseCode, relayKey } from './code';
import { BadEnvelope, MAX_ENVELOPE, TooBig, open, proveKey, seal, type Identity } from './crypto';
import { DEFAULT_RELAY, nextUtcMidnight, relayTransport, type Link, type Transport } from './relay';
import * as store from './store';
import type { Contact, Invited, Received } from './store';
import type { Invite } from './crypto';

export type { Contact, Invited, Received };
export type CollabState = {
  status: 'loading' | 'unavailable' | 'ready';
  code: string; name: string; contacts: Contact[]; cards: Received[];
  /** the code last copied from the panel: when mine differs (my relay changed), people need the new one */
  gave: string;
  /** invites to live-editing sessions waiting to be joined (they aren't cards: not in the rail's count) */
  invites: Invited[];
  /** my relay ('' = none set): I listen there, and my code carries it */
  relay: string;
  link: Link;
  /** a send through my relay hit its daily limit: nothing goes through it until then */
  pausedUntil: number;
};

const LABEL_MAX = 40;
let state: CollabState = { status: 'loading', code: '', name: '', contacts: [], cards: [], invites: [], gave: '', relay: '', link: { kind: 'off' }, pausedUntil: 0 };
const subs = new Set<() => void>();
const arrivals = new Set<(c: Received, contact: Contact | undefined) => void>();
const invitedArrivals = new Set<(i: Invited, contact: Contact | undefined) => void>();
const set = (p: Partial<CollabState>) => { state = { ...state, ...p }; for (const f of subs) f(); };
let me: (Identity & { inbox: string }) | null = null;
/** Relays whose daily limit a send hit, and until when: each person's relay has its own allowance. */
const paused = new Map<string, number>();
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('falcon-collab') : null;
const told = (m: { t: 'changed' } | { t: 'card'; id: string } | { t: 'invite'; id: string }) => channel?.postMessage(m);

/** The relay's address, or '' for none: anything that isn't an http(s) address counts as none. */
export const relayUrl = () => { const u = (pref(P.relayUrl).trim() || DEFAULT_RELAY).replace(/\/+$/, ''); return /^https?:\/\/\S+$/i.test(u) ? u : ''; };
/** The contact a code is, whichever of their codes it is (a v1 one, or one with an older relay): the same key. */
export const contactFor = (code: string) => { const k = keyOf(code); return k ? state.contacts.find((c) => keyOf(c.code) === k) : undefined; };
/** Where a card for this contact goes: the relay their code carries, else mine (a v1 code), else '' (none). */
export const relayFor = (c: Contact) => { const p = parseCode(c.code); return (p.ok && p.relay) || relayUrl(); };

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
    const f = withCleanNotes(repaste(Fragment.fromJSON(schema, embeddedOnly(content) as object[])));
    if (!f.childCount || !f.textBetween(0, f.size, ' ', ' ').trim()) return null;
    let sane = true;
    // a cell spanning millions of columns (or none, or half of one) breaks the table code when it's laid out
    f.descendants((n) => { for (const k of ['colspan', 'rowspan']) { const v = n.attrs[k]; if (v !== undefined && !(Number.isInteger(v) && v >= 1 && v <= MAX_SPAN)) sane = false; } return sane; });
    if (!sane) return null;
    schema.topNodeType.create(null, f).check();
    return f;
  } catch { return null; }
}
const MAX_SPAN = 63;
/** Draw nodes as the clipboard does and read them back through the paste rules. */
function repaste(raw: Fragment): Fragment {
  const inert = document.implementation.createHTMLDocument('');
  const box = inert.createElement('div');
  box.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(raw, { document: inert }));
  return DOMParser.fromSchema(schema).parse(box, { preserveWhitespace: 'full' }).content;
}
/** A footnote's text rides in an attribute, which the paste rules don't look inside: give it the same pass. */
function withCleanNotes(f: Fragment): Fragment {
  const out: PMNode[] = [];
  f.forEach((n) => {
    if (n.type === schema.nodes.footnote) {
      const text = noteNodes(n.attrs.content);
      const clean = text.length ? noteNodes(repaste(Fragment.from(schema.nodes.paragraph.create(null, text))).firstChild?.content.toJSON() ?? []) : [];
      out.push(n.type.create({ ...n.attrs, content: clean.map((x) => x.toJSON()) }, null, n.marks));
    } else out.push(n.isLeaf ? n : n.copy(withCleanNotes(n.content)));
  });
  return Fragment.fromArray(out);
}

/** My code: my key and the relay I listen on (v2), or the key alone while no relay is set (v1). */
const myCode = () => (me ? encodeCode(me.pub, relayUrl()) : '');

async function loadMe() {
  const id = await store.identity();
  me = { ...id, inbox: await inboxId(id.pub) };
  return myCode();
}

async function reload() {
  const inbox = me?.inbox;
  const [code, name, contacts, cards, invites, gave] = await Promise.all([loadMe(), store.loadName(), store.loadContacts(), store.loadCards(), store.loadInvites(), store.loadGave()]);
  set({ status: 'ready', code, name, contacts, cards, invites, gave, relay: relayUrl() });
  if (inbox && inbox !== me!.inbox) relisten(); // the code changed in another window
}

// ---------- listening ----------

let leading = false;
let stopListen: (() => void) | null = null;
/** Cards were left on the relay because MAX_WAITING are waiting here: fetch them once there's room. */
let full = false;
const roomAgain = () => { if (full && leading && state.cards.length < store.MAX_WAITING) { full = false; relisten(); } };
/** The one transport there is so far; a LAN host would be picked here. */
const transportFor = (url: string): Transport => relayTransport(url);

async function onCard(id: string, envelope: Uint8Array) {
  if (!me) throw new Error('no identity yet');
  let got;
  try { got = await open(me, envelope); } catch (e) { if (e instanceof BadEnvelope) return; throw e; } // junk is acked and dropped
  // the sender's code as they gave it (with their relay), when it is theirs: the key the envelope proved
  const said = got.card.code ? parseCode(got.card.code) : null;
  const from = said?.ok && keyOf(said.code) === keyOf(encodeCode(got.from)) ? said.code : encodeCode(got.from);
  // the sender's id for this send (theirs alone: another sender can't claim it), so a resend isn't a second card
  const key = got.card.mid ? `${from}:${got.card.mid}` : id;
  if (got.card.invite) { await onInvite({ id: key, from, claimed: got.card.name, sentAt: got.card.at, gotAt: Date.now(), invite: got.card.invite }); return; }
  const content = cardFragment(got.card.content);
  // one this Falcon can't open (a newer Falcon's, say) is still shown, so it isn't lost without a word
  const card: Received = content
    ? { id: key, from, claimed: got.card.name, sentAt: got.card.at, gotAt: Date.now(), label: cardLabel(content), content: got.card.content as unknown[] }
    : { id: key, from, claimed: got.card.name, sentAt: got.card.at, gotAt: Date.now(), label: "A card this Falcon can't open", content: [], unreadable: true };
  let kept;
  try { kept = await store.keepCard(card); } catch (e) { if (e instanceof store.InboxFull) full = true; throw e; } // not acked: it waits on the relay
  if (!kept) return; // had it already (an ack that didn't make it, or a resend)
  set({ cards: [...state.cards, card] });
  told({ t: 'card', id });
  for (const f of arrivals) f(card, contactFor(from));
}

/** An invite came in: kept (then acked), and told to the app for its toast. Not a card: the rail's count leaves it out. */
async function onInvite(inv: Invited) {
  if (!(await store.keepInvite(inv))) return;
  set({ invites: [...state.invites.filter((x) => x.invite.room !== inv.invite.room), inv] });
  told({ t: 'invite', id: inv.id });
  for (const f of invitedArrivals) f(inv, contactFor(inv.from));
}

function relisten() {
  stopListen?.();
  stopListen = null;
  const url = relayUrl();
  set({ relay: url, code: myCode() }); // my code carries my relay: a new relay is a new code
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
  set({ status: 'loading', pausedUntil: 0 }); // until this start's own load is in (a restart must not read the last one's)
  paused.clear();
  let live = true;
  const hold = new AbortController();
  let release = () => {};
  const onMsg = async (e: MessageEvent<{ t: string; id?: string }>) => {
    if (!live) return;
    await reload().catch(() => {});
    roomAgain(); // another window dismissed some
    const c = e.data.t === 'card' ? state.cards.find((x) => x.id === e.data.id) : null;
    if (c) for (const f of arrivals) f(c, contactFor(c.from));
    const i = e.data.t === 'invite' ? state.invites.find((x) => x.id === e.data.id) : null;
    if (i) for (const f of invitedArrivals) f(i, contactFor(i.from));
  };
  channel?.addEventListener('message', onMsg);
  const offPrefs = onPrefs(() => { if (relayUrl() !== state.relay) { set({ pausedUntil: 0 }); relisten(); } });
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
/** An invite to a live-editing session came in (in this window or another): for the toast. */
export const onInvited = (f: (i: Invited, contact: Contact | undefined) => void) => { invitedArrivals.add(f); return () => { invitedArrivals.delete(f); }; };
/** Done with an invite (joined or dismissed). It leaves the list once the save went through. */
export async function dropInvite(id: string) {
  await saved(store.dropInvite(id));
  set({ invites: state.invites.filter((x) => x.id !== id) });
}

// ---------- changes ----------

const saved = async (p: Promise<unknown>) => { await p; told({ t: 'changed' }); };

/** Add (or rename) a contact. Returns why not, or null. */
export async function addContact(codeText: string, name: string): Promise<string | null> {
  const p = parseCode(codeText);
  if (!p.ok) return p.error;
  if (keyOf(p.code) === keyOf(state.code)) return "That's your own code";
  const nm = name.trim();
  if (!nm) return 'Give them a name';
  await inTurn(async () => {
    // the same person with a new code (a new relay) takes the old one's place
    const contacts = [...state.contacts.filter((c) => keyOf(c.code) !== keyOf(p.code)), { code: p.code, name: nm.slice(0, 60) }];
    set({ contacts });
    await saved(store.saveContacts(contacts));
  });
  return null;
}
let turn: Promise<unknown> = Promise.resolve();
/** Contact saves, one at a time: each writes the whole list, so each works from what the last one left. */
function inTurn<T>(f: () => Promise<T>): Promise<T> {
  const mine = turn.then(f);
  turn = mine.catch(() => {});
  return mine;
}
/** Remove a contact. It leaves the list once the save went through, so a save that fails (it rejects) keeps them. */
export const removeContact = (code: string): Promise<void> => inTurn(async () => {
  await saved(store.saveContacts(state.contacts.filter((c) => c.code !== code)));
  set({ contacts: state.contacts.filter((c) => c.code !== code) }); // the list as it is now: another window may have changed it meanwhile
});
export async function setName(name: string) {
  set({ name });
  await saved(store.saveName(name.slice(0, 60)));
}
export async function newCode() {
  const id = await store.regenerate();
  me = { ...id, inbox: await inboxId(id.pub) };
  set({ code: myCode() });
  relisten();
  told({ t: 'changed' });
}
/** Done with a card that came in (inserted, copied and let go, or dismissed). It leaves the list once the save went
 *  through, so a save that fails (it rejects) keeps the card. */
export async function drop(id: string) {
  await saved(store.dropCard(id));
  set({ cards: state.cards.filter((c) => c.id !== id) });
  roomAgain();
}

/** The local time the daily limits reset (00:00 UTC): "7:00 PM". */
export const resetTime = (until: number) => new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The last send whose fate isn't known (no answer came back): the same card sent again keeps its id. */
let unsure: { what: string; mid: string } | null = null;

/** Copied my code from the panel: kept, so the panel can say when my code has changed since (a new relay). */
export async function gaveCode() {
  set({ gave: state.code });
  await saved(store.saveGave(state.code));
}

/** How long sends through `url` wait for its daily limit, or 0. */
const pausedFor = (url: string) => { const t = paused.get(url) ?? 0; return t > Date.now() ? t : 0; };
function pause(url: string) {
  const until = nextUtcMidnight();
  paused.set(url, until);
  if (url === relayUrl()) set({ pausedUntil: until });
  return until;
}

/** Seal a card to a contact and hand it to their relay (or mine, for a code without one). Resolves with what to tell the user, and whether it went. */
export async function send(contact: Contact, content: Fragment): Promise<{ ok: boolean; message: string }> {
  const label = cardLabel(content);
  const url = relayFor(contact);
  if (!url) return { ok: false, message: "No relay is set, so cards can't be sent yet. Add one in Settings > Sharing" };
  if (pausedFor(url)) return { ok: false, message: `Card sharing is paused until ${resetTime(pausedFor(url))}, when the relay's daily limit resets. The card wasn't sent` };
  const p = parseCode(contact.code);
  if (!p.ok || !me) return { ok: false, message: "Couldn't send: card sharing isn't ready yet" };
  const json = content.toJSON() ?? [];
  // sending the same card again after a send that may have got through reuses its id, so it arrives once
  const what = `${contact.code}\n${JSON.stringify(json)}`;
  const mid = unsure?.what === what ? unsure.mid : crypto.randomUUID();
  const tooBig = { ok: false, message: 'That card is too big to send (over 1 MB, usually from pictures). It wasn\'t sent' };
  let env: Uint8Array;
  try { env = await seal(me, p.pub, { name: state.name.trim(), at: Date.now(), content: json, mid, code: state.code }); } catch (e) { return e instanceof TooBig ? tooBig : { ok: false, message: "Couldn't seal the card. It wasn't sent" }; }
  if (env.length > MAX_ENVELOPE) return tooBig;
  const r = await transportFor(url).send(await inboxId(p.pub), env);
  unsure = !r.ok && (r.error === 'unreachable' || r.error === 'relay_error') ? { what, mid } : null;
  if (r.ok) return { ok: true, message: `Sent “${label}” to ${contact.name}` };
  if (r.error === 'daily_limit') {
    const until = pause(url);
    return { ok: false, message: `Card sharing is paused until ${resetTime(until)}, when the relay's daily limit resets. The card wasn't sent` };
  }
  const theirs = url !== relayUrl();
  const why: Record<string, string> = {
    // no answer came back, so whether it got there isn't known: sent again, it still arrives once
    unreachable: theirs ? `Couldn't reach ${contact.name}'s relay. Check the wifi, then send it again` : "Couldn't reach the relay. Check the wifi, then send it again",
    too_large: "That card is too big for the relay. It wasn't sent",
    inbox_full: `${contact.name} has too many cards waiting. The card wasn't sent`,
    bad_envelope: "The relay turned the card down. It wasn't sent",
    relay_error: "The relay had a problem. Send the card again later",
  };
  return { ok: false, message: why[r.error] };
}

/**
 * Invite a contact to a live-editing session: the room's id and key go to them sealed, through their inbox, the way a
 * card does (an older Falcon shows it as a card it can't open). Resolves with what to tell the user.
 */
export async function sendInvite(contact: Contact, invite: Invite): Promise<{ ok: boolean; message: string }> {
  const url = relayFor(contact);
  if (!url) return { ok: false, message: "No relay is set, so invites can't be sent. Add one in Settings > Sharing" };
  if (pausedFor(url)) return { ok: false, message: `Sharing is paused until ${resetTime(pausedFor(url))}, when the relay's daily limit resets. The invite wasn't sent` };
  const p = parseCode(contact.code);
  if (!p.ok || !me) return { ok: false, message: "Couldn't send: card sharing isn't ready yet" };
  let env: Uint8Array;
  try { env = await seal(me, p.pub, { name: state.name.trim(), at: Date.now(), content: [], mid: crypto.randomUUID(), invite, code: state.code }); } catch { return { ok: false, message: "Couldn't seal the invite. It wasn't sent" }; }
  const r = await transportFor(url).send(await inboxId(p.pub), env);
  if (r.ok) return { ok: true, message: `Invited ${contact.name} to “${invite.doc}”` };
  if (r.error === 'daily_limit') { const until = pause(url); return { ok: false, message: `Sharing is paused until ${resetTime(until)}, when the relay's daily limit resets. The invite wasn't sent` }; }
  const why: Record<string, string> = {
    unreachable: url !== relayUrl() ? `Couldn't reach ${contact.name}'s relay. Check the wifi, then invite them again` : "Couldn't reach the relay. Check the wifi, then invite them again",
    too_large: "The relay turned the invite down. It wasn't sent",
    inbox_full: `${contact.name} has too many cards waiting. The invite wasn't sent`,
    bad_envelope: "The relay turned the invite down. It wasn't sent",
    relay_error: 'The relay had a problem. Invite them again later',
  };
  return { ok: false, message: why[r.error] };
}
