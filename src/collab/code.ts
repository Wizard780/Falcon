/**
 * Pairing codes. A code is a version byte, the install's raw X25519 public key, and a CRC-16 of what
 * comes before it, in Crockford base32 (no I, L, O or U, so it reads aloud and survives retyping),
 * grouped by 7 with dashes. Codes get swapped between people, so a format never changes: a new one
 * gets a new version byte, and older Falcons say "update" instead of misreading it.
 *
 *   v1  [1][key 32][crc 2]                         56 characters. No relay: whoever adds it sends
 *                                                  through their own relay.
 *   v2  [2][key 32][kind 1][relay ...][crc 2]      The owner's relay, so each person can run their own
 *                                                  and still be reached: kind 1 is the <sub> of
 *                                                  https://falcon-relay.<sub>.workers.dev (what the relay
 *                                                  guide deploys), kind 2 the address in full.
 */

export const CODE_VERSION = 1;
export const CODE_V2 = 2;
const KEY_LEN = 32;
const CODE_BYTES = 1 + KEY_LEN + 2;
export const CODE_CHARS = Math.ceil((CODE_BYTES * 8) / 5); // 56, a v1 code; a v2 one is longer
/** The longest relay address a code carries (Settings' Relay box takes 200). */
export const MAX_RELAY = 200;
const RELAY_SUB = 1, RELAY_URL = 2;
const WORKERS = /^https:\/\/falcon-relay\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.workers\.dev$/;
const te = new TextEncoder(), td = new TextDecoder('utf-8', { fatal: true });

/** A relay address as a code carries it: http(s), no trailing slash, no query or fragment. Null for anything else. */
export function relayKey(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.search || u.hash) return null;
  const out = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  return te.encode(out).length <= MAX_RELAY ? out : null;
}
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function crc16(bytes: Uint8Array): number {
  // CRC-16/CCITT-FALSE: catches every one- and two-letter typo in a code this short (checked one by one for a v1 code
  // and a workers.dev v2 one, 76 letters: 0 of 2.7M two-letter typos read as another valid code)
  let c = 0xffff;
  for (const b of bytes) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

function toBase32(bytes: Uint8Array): string {
  let out = '', bits = 0, value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Uint8Array {
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of text) {
    value = ((value << 5) | ALPHABET.indexOf(ch)) & 0xffff;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}

/** The code for a raw public key and, when there is one, the owner's relay (v2); with none, v1's 56 letters and digits. */
export function encodeCode(pub: Uint8Array, relay?: string | null): string {
  if (pub.length !== KEY_LEN) throw new Error('A public key is 32 bytes');
  const r = relayKey(relay);
  const sub = r ? WORKERS.exec(r) : null;
  const tail = !r ? null : sub ? [RELAY_SUB, ...te.encode(sub[1])] : [RELAY_URL, ...te.encode(r)];
  const body = new Uint8Array(1 + KEY_LEN + (tail?.length ?? 0) + 2);
  body[0] = tail ? CODE_V2 : CODE_VERSION;
  body.set(pub, 1);
  if (tail) body.set(tail, 1 + KEY_LEN);
  const c = crc16(body.subarray(0, body.length - 2));
  body[body.length - 2] = c >> 8;
  body[body.length - 1] = c & 255;
  return toBase32(body).match(/.{1,7}/g)!.join('-');
}

/** What a v2 code's relay bytes say, or null when they don't make an address. */
function relayFrom(b: Uint8Array): string | null {
  if (b.length < 2) return null;
  let text: string;
  try { text = td.decode(b.subarray(1)); } catch { return null; }
  if (b[0] === RELAY_SUB) return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text) ? `https://falcon-relay.${text}.workers.dev` : null;
  return b[0] === RELAY_URL && relayKey(text) === text ? text : null;
}

/** `relay`: the owner's relay (a v2 code), or null (v1: send through your own). */
export type Parsed = { ok: true; pub: Uint8Array; code: string; relay: string | null } | { ok: false; error: string };

/** Read a pasted code: any case, spaces and dashes ignored, O read as 0 and I or L as 1. */
export function parseCode(input: string): Parsed {
  const text = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!text) return { ok: false, error: 'Paste a pairing code' };
  if (/[^0-9A-Z]/.test(text) || text.includes('U')) return { ok: false, error: 'Pairing codes are only letters and numbers' };
  const bytes = fromBase32(text);
  const n = bytes.length;
  const crcOk = n >= 3 && crc16(bytes.subarray(0, n - 2)) === ((bytes[n - 2] << 8) | bytes[n - 1]);
  const v = bytes[0];
  if (crcOk && v !== CODE_VERSION && v !== CODE_V2) return { ok: false, error: 'That code is from a newer Falcon. Update Falcon to add it' };
  const fits = crcOk && (v === CODE_VERSION ? n === CODE_BYTES : n > CODE_BYTES + 1);
  if (!fits) {
    if (text.length < CODE_CHARS) return { ok: false, error: `A pairing code is at least ${CODE_CHARS} letters and numbers. This one has ${text.length}` };
    return { ok: false, error: 'That code has a typo. Copy it again' };
  }
  const pub = bytes.slice(1, 1 + KEY_LEN);
  if (v === CODE_VERSION) return { ok: true, pub, code: encodeCode(pub), relay: null };
  const relay = relayFrom(bytes.subarray(1 + KEY_LEN, n - 2));
  if (!relay) return { ok: false, error: "That code's relay address isn't one Falcon can use. Ask them for their code again" };
  return { ok: true, pub, code: encodeCode(pub, relay), relay };
}

/** The public key's hex: who a code is, whichever version and relay it has. Null for a code that doesn't parse. */
export function keyOf(code: string): string | null {
  const p = parseCode(code);
  return p.ok ? toHex(p.pub) : null;
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Where the relay keeps cards for a key: hex SHA-256 of the raw public key. */
export async function inboxId(pub: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', pub as BufferSource)));
}

/** The code's two ends, for telling recipients apart at a glance: 09NM…WY3G (the Card sharing mockup's K7QD…X2MF). */
export const shortCode = (code: string) => { const c = code.replace(/[^0-9a-z]/gi, ''); return c.length > 8 ? `${c.slice(0, 4)}…${c.slice(-4)}` : code; };
