/**
 * Card envelopes, protocol v1. Only these bytes ever reach the relay:
 *
 *   [1 version][32 sender public key][16 salt][12 IV][AES-256-GCM ciphertext + tag]
 *
 * The AES key is HKDF-SHA-256 (that salt, info "falcon card v1") over the X25519 secret of the
 * sender's private key and the recipient's public key, and the additional data is the version byte
 * and both public keys. Only the holder of the sender's private key could have made a key that opens
 * it, so a good decrypt proves which code sent it. The plaintext is deflated JSON (see Card).
 * WebCrypto only: the same code runs in Electron, the web build, Node (tests) and Workers.
 */
import { deflateSync, inflateSync } from 'fflate';

export const ENVELOPE_VERSION = 1;
const KEY_LEN = 32, SALT_LEN = 16, IV_LEN = 12, TAG_LEN = 16;
const HEAD = 1 + KEY_LEN + SALT_LEN + IV_LEN;
export const MIN_ENVELOPE = HEAD + TAG_LEN;
/** The relay turns away anything bigger (relay/src/index.ts); a card with pictures can get there. */
export const MAX_ENVELOPE = 1_000_000;
/** A card unpacks to at most this, so a tiny envelope can't unpack into gigabytes. Sealing refuses past it too. */
export const MAX_PLAIN = 2 * MAX_ENVELOPE;
const te = new TextEncoder(), td = new TextDecoder();
const CARD_INFO = te.encode('falcon card v1');
const PROOF_INFO = te.encode('falcon relay proof v1');
const subtle = () => crypto.subtle;
const buf = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export type Identity = { priv: CryptoKey; pub: Uint8Array };

/** One per install. The private key can't be read back out, only used. */
export async function makeIdentity(): Promise<Identity> {
  const pair = (await subtle().generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
  return { priv: pair.privateKey, pub: new Uint8Array(await subtle().exportKey('raw', pair.publicKey)) };
}

const publicKey = (raw: Uint8Array) => subtle().importKey('raw', buf(raw), { name: 'X25519' }, false, []);

/** An AES-GCM or HMAC key from HKDF-SHA-256 over X25519(priv, pub). */
async function derive(priv: CryptoKey, pub: Uint8Array, salt: Uint8Array, info: Uint8Array, usage: 'aes' | 'hmac'): Promise<CryptoKey> {
  const secret = await subtle().deriveBits({ name: 'X25519', public: await publicKey(pub) }, priv, 256);
  const ikm = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) };
  return usage === 'aes'
    ? subtle().deriveKey(params, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    : subtle().deriveKey(params, ikm, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
}

const aad = (from: Uint8Array, to: Uint8Array) => { const a = new Uint8Array(1 + 2 * KEY_LEN); a[0] = ENVELOPE_VERSION; a.set(from, 1); a.set(to, 1 + KEY_LEN); return a; };

/** What a card envelope carries: who it says it's from, when it was sent, the card (a ProseMirror Fragment's JSON),
 *  and the sender's own id for this send, so one that reaches the relay twice is shown once. An invite to a live-editing
 *  room rides in the same envelope with empty content (an older Falcon shows it as a card it can't open). */
export type Card = { name: string; at: number; content: unknown; mid?: string; invite?: Invite;
  /** the sender's own code, with their relay (Add contact uses it); the recipient checks it is the key that sealed this */
  code?: string };
/** A live-editing room: the relay it is on (the host's), its id there, its key (base64url, 32 bytes) and the doc's name.
 *  Only the envelope carries the key. */
export type Invite = { room: string; key: string; doc: string; relay?: string };
const inviteOf = (j: unknown): Invite | undefined => {
  const i = j as Partial<Invite> | null;
  if (!i || typeof i.room !== 'string' || !/^[0-9a-f]{64}$/.test(i.room) || typeof i.key !== 'string' || typeof i.doc !== 'string') return undefined;
  try { if (unb64url(i.key).length !== ROOM_KEY_LEN) return undefined; } catch { return undefined; }
  // the relay is checked as an address where it's kept (service.ts onInvite); this file stays free of imports Node can't load
  return { room: i.room, key: i.key, doc: i.doc.slice(0, 120), relay: typeof i.relay === 'string' && i.relay.length <= 200 ? i.relay : undefined };
};
/** A card too big to send: thrown by seal. */
export class TooBig extends Error {}

export async function seal(me: Identity, to: Uint8Array, card: Card): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN)), iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await derive(me.priv, to, salt, CARD_INFO, 'aes');
  const json = te.encode(JSON.stringify({ v: 1, name: card.name, at: card.at, content: card.content, mid: card.mid, invite: card.invite, code: card.code }));
  if (json.length > MAX_PLAIN) throw new TooBig();
  const plain = deflateSync(json);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(me.pub, to) }, key, plain));
  const out = new Uint8Array(HEAD + ct.length);
  out[0] = ENVELOPE_VERSION;
  out.set(me.pub, 1);
  out.set(salt, 1 + KEY_LEN);
  out.set(iv, 1 + KEY_LEN + SALT_LEN);
  out.set(ct, HEAD);
  return out;
}

export class BadEnvelope extends Error {}

/** Open an envelope sent to `me`: the sender's public key (proven by the decrypt) and the card. Throws BadEnvelope. */
export async function open(me: Identity, env: Uint8Array): Promise<{ from: Uint8Array; card: Card }> {
  if (env.length < MIN_ENVELOPE || env.length > MAX_ENVELOPE) throw new BadEnvelope('size');
  if (env[0] !== ENVELOPE_VERSION) throw new BadEnvelope('version');
  const from = env.slice(1, 1 + KEY_LEN), salt = env.slice(1 + KEY_LEN, 1 + KEY_LEN + SALT_LEN), iv = env.slice(1 + KEY_LEN + SALT_LEN, HEAD);
  let plain: Uint8Array;
  try {
    const key = await derive(me.priv, from, salt, CARD_INFO, 'aes');
    plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aad(from, me.pub) }, key, buf(env.subarray(HEAD))));
  } catch { throw new BadEnvelope('decrypt'); }
  let card: Card;
  try {
    const out = inflateSync(plain, { out: new Uint8Array(MAX_PLAIN + 1) }); // fills at most this much
    if (out.length > MAX_PLAIN) throw new Error('too big');
    const j = JSON.parse(td.decode(out));
    if (j?.v !== 1 || typeof j.name !== 'string' || typeof j.at !== 'number' || !Array.isArray(j.content)) throw new Error('shape');
    card = { name: j.name.slice(0, 80), at: j.at, content: j.content, mid: typeof j.mid === 'string' && j.mid.length <= 64 ? j.mid : undefined, invite: inviteOf(j.invite), code: typeof j.code === 'string' && j.code.length <= 400 ? j.code : undefined };
  } catch { throw new BadEnvelope('content'); }
  return { from, card };
}

/**
 * The relay's proof of key: it sends a one-time public key and a nonce, and only the holder of the
 * inbox's private key can answer with HMAC(HKDF(X25519(priv, ephemeral)), nonce || inbox id).
 */
export async function proveKey(priv: CryptoKey, eph: Uint8Array, nonce: Uint8Array, inbox: string): Promise<Uint8Array> {
  const key = await derive(priv, eph, nonce, PROOF_INFO, 'hmac');
  const msg = new Uint8Array(nonce.length + inbox.length);
  msg.set(nonce);
  msg.set(te.encode(inbox), nonce.length);
  return new Uint8Array(await subtle().sign('HMAC', key, msg));
}

export const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// ---------- live-editing rooms ----------

/**
 * A room frame, protocol v1: [12 IV][AES-256-GCM ciphertext + tag] under the room's key, a random 32 bytes made by
 * whoever started the session and handed to each person invited inside a sealed card envelope. The additional data is
 * "falcon room v1", the room id and the frame's kind, so a frame can't be replayed into another room or as another kind.
 * The relay sees the room id, the kind, which socket sent it, and the size.
 */
export const ROOM_KEY_LEN = 32;
const ROOM_INFO = te.encode('falcon room v1');
const frameAad = (room: string, kind: number) => { const r = te.encode(room), a = new Uint8Array(ROOM_INFO.length + r.length + 1); a.set(ROOM_INFO); a.set(r, ROOM_INFO.length); a[a.length - 1] = kind; return a; };
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** A new room: its id (64 hex, random, unrelated to the key) and its key. */
export function newRoom(): { room: string; key: Uint8Array } {
  return { room: hexOf(crypto.getRandomValues(new Uint8Array(32))), key: crypto.getRandomValues(new Uint8Array(ROOM_KEY_LEN)) };
}
export const roomKey = (raw: Uint8Array) => subtle().importKey('raw', buf(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function sealFrame(key: CryptoKey, room: string, kind: number, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: frameAad(room, kind) }, key, buf(plain)));
  const out = new Uint8Array(IV_LEN + ct.length);
  out.set(iv);
  out.set(ct, IV_LEN);
  return out;
}
/** Open a room frame. Throws BadEnvelope for anything not sealed with this room's key as this kind. */
export async function openFrame(key: CryptoKey, room: string, kind: number, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < IV_LEN + TAG_LEN) throw new BadEnvelope('size');
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(sealed.subarray(0, IV_LEN)), additionalData: frameAad(room, kind) }, key, buf(sealed.subarray(IV_LEN))));
  } catch { throw new BadEnvelope('decrypt'); }
}
