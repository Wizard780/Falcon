/**
 * Pairing codes, protocol v1. A code is a version byte, the install's raw X25519 public key and a
 * CRC-16 of both, in Crockford base32 (no I, L, O or U, so it reads aloud and survives retyping),
 * grouped by 7 with dashes. Codes get swapped between people, so this format can't change: a new
 * format gets a new version byte, and older Falcons say "update" instead of misreading it.
 */

export const CODE_VERSION = 1;
const KEY_LEN = 32;
const CODE_BYTES = 1 + KEY_LEN + 2;
export const CODE_CHARS = Math.ceil((CODE_BYTES * 8) / 5); // 56
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function crc16(bytes: Uint8Array): number {
  // CRC-16/CCITT-FALSE: catches every one- and two-letter typo in a code this short
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

/** The code for a raw public key: 56 letters and digits in groups of 7. */
export function encodeCode(pub: Uint8Array): string {
  if (pub.length !== KEY_LEN) throw new Error('A public key is 32 bytes');
  const body = new Uint8Array(CODE_BYTES);
  body[0] = CODE_VERSION;
  body.set(pub, 1);
  const c = crc16(body.subarray(0, CODE_BYTES - 2));
  body[CODE_BYTES - 2] = c >> 8;
  body[CODE_BYTES - 1] = c & 255;
  return toBase32(body).match(/.{1,7}/g)!.join('-');
}

export type Parsed = { ok: true; pub: Uint8Array; code: string } | { ok: false; error: string };

/** Read a pasted code: any case, spaces and dashes ignored, O read as 0 and I or L as 1. */
export function parseCode(input: string): Parsed {
  const text = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!text) return { ok: false, error: 'Paste a pairing code' };
  if (/[^0-9A-Z]/.test(text) || text.includes('U')) return { ok: false, error: 'Pairing codes are only letters and numbers' };
  const bytes = fromBase32(text);
  const n = bytes.length;
  const crcOk = n >= 3 && crc16(bytes.subarray(0, n - 2)) === ((bytes[n - 2] << 8) | bytes[n - 1]);
  if (crcOk && bytes[0] !== CODE_VERSION) return { ok: false, error: 'That code is from a newer Falcon. Update Falcon to add it' };
  if (!crcOk || n !== CODE_BYTES) {
    if (text.length !== CODE_CHARS) return { ok: false, error: `A pairing code is ${CODE_CHARS} letters and numbers. This one has ${text.length}` };
    return { ok: false, error: 'That code has a typo. Copy it again' };
  }
  const pub = bytes.slice(1, 1 + KEY_LEN);
  return { ok: true, pub, code: encodeCode(pub) };
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Where the relay keeps cards for a key: hex SHA-256 of the raw public key. */
export async function inboxId(pub: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', pub as BufferSource)));
}

/** The code's first and last groups, for telling contacts apart at a glance. */
export const shortCode = (code: string) => { const g = code.split('-'); return g.length > 2 ? `${g[0]}…${g[g.length - 1]}` : code; };
