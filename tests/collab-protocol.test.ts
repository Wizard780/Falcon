import { describe, expect, it } from 'vitest';
import { Fragment } from 'prosemirror-model';
import { deflateSync } from 'fflate';
import { CODE_CHARS, encodeCode, inboxId, parseCode } from '../src/collab/code';
import { BadEnvelope, b64url, makeIdentity, newRoom, open, openFrame, proveKey, roomKey, seal, sealFrame, unb64url, type Identity, TooBig } from '../src/collab/crypto';

// Fixed test keys (never used anywhere else). These pin protocol v1: codes people have already swapped
// and envelopes already sent must keep reading the same way.
const A = { jwk: { kty: 'OKP', crv: 'X25519', d: 'WFaXt96RrQoM8ReFUtxbcqXO8H4-2IfkxhhbRj_cEFU', x: 'd9gZWGXVD2LNQcpvbWK78rXwzwmod2TfAzCIumbJQCk' },
  code: '05VXG6A-RCQAGYR-PD8756Y-VB2QFSB-BW6F16M-7ES6Z0C-R8HEK6S-502K8T2', inbox: 'baf2749e4ef1ad87c80da14dd434fc019a56c012b24c4a610a3e5bddc680a59d' };
const B = { jwk: { kty: 'OKP', crv: 'X25519', d: 'wNE6iCmjIl9aFFr9vVl9QG8jUYvwUeOajTa6nZUOLEQ', x: 'IBTgdITD9AcQVjlblgXA1dGShnyobbc1G3vbGYS-6GA' },
  code: '04G19R3-MGK1Z81-RGARWNQ-5G5R3AX-34M6FJM-6VDSN3D-XXP6C4Q-VM60G1Y' };
// A to B: { name: 'Alex', at: 1762800000000, content: one tag, "Golden card" }
const GOLDEN = 'AXfYGVhl1Q9izUHKb21iu_K18M8JqHdk3wMwiLpmyUApKOkI290jIBE5BCvo13p5TRwwTV8mAszumBrENTSgo9RlnahHGwpUaF8EwFFx88Vw8F6eOB01ov1X2PPrY17EUWEa4Ji_3Yby2hDZVVo7kr49uGeVEgbP3oVjvv6wsLWBfWzKq0ad-VoQSAABKIFkhKcqHE9H0uyGWH2FEiXbhsBTdudYm-oPicj_-ZrwJkEDJToa-2U';

async function fixed(k: { jwk: JsonWebKey & { x: string } }): Promise<Identity> {
  const priv = await crypto.subtle.importKey('jwk', k.jwk, { name: 'X25519' }, false, ['deriveBits']);
  return { priv, pub: unb64url(k.jwk.x) };
}
const card = { name: 'Sam', at: 1_762_900_000_000, content: [{ type: 'paragraph', attrs: { style: 'tag' }, content: [{ type: 'text', text: 'Warming causes war' }] }] };

describe('pairing codes', () => {
  it('a fixed key gives the pinned code and inbox id', async () => {
    const a = await fixed(A);
    expect(encodeCode(a.pub)).toBe(A.code);
    expect(A.code.replace(/-/g, '')).toHaveLength(CODE_CHARS);
    expect(await inboxId(a.pub)).toBe(A.inbox);
  });

  it('reads a code back, in any case, with spaces, and with O for 0 and l for 1', () => {
    const p = parseCode(` ${A.code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l')} `);
    expect(p.ok && p.code).toBe(A.code);
    expect(p.ok && Array.from(p.pub)).toEqual(Array.from(unb64url(A.jwk.x)));
  });

  it('a mistyped letter is caught by the checksum', () => {
    for (const at of [0, 9, 30, 55]) {
      const chars = A.code.replace(/-/g, '').split('');
      chars[at] = chars[at] === 'X' ? 'Y' : 'X';
      const p = parseCode(chars.join(''));
      expect(p.ok).toBe(false);
      expect(!p.ok && p.error).toBe('That code has a typo. Copy it again');
    }
  });

  it('a short or padded code says how long a code is', () => {
    const p = parseCode(A.code.slice(0, -3));
    expect(!p.ok && p.error).toMatch(/^A pairing code is 56 letters and numbers\. This one has 53$/);
    expect(parseCode('').ok).toBe(false);
    expect(!parseCode('hello!').ok && (parseCode('hello!') as { error: string }).error).toBe('Pairing codes are only letters and numbers');
  });

  it('a code with a version this Falcon does not know is refused, not misread', async () => {
    // a well-formed code (checksum and all) whose version byte is 2
    const body = new Uint8Array(35);
    body[0] = 2;
    body.set(unb64url(A.jwk.x), 1);
    let c = 0xffff;
    for (const b of body.subarray(0, 33)) { c ^= b << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
    body[33] = c >> 8; body[34] = c & 255;
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let bits = '';
    for (const b of body) bits += b.toString(2).padStart(8, '0');
    const text = bits.match(/.{1,5}/g)!.map((g) => alphabet[parseInt(g.padEnd(5, '0'), 2)]).join('');
    const p = parseCode(text);
    expect(!p.ok && p.error).toBe('That code is from a newer Falcon. Update Falcon to add it');
  });
});

describe('envelopes', () => {
  it('the pinned envelope still opens, and says who sent it', async () => {
    const b = await fixed(B);
    const got = await open(b, unb64url(GOLDEN));
    expect(encodeCode(got.from)).toBe(A.code);
    expect(got.card).toEqual({ name: 'Alex', at: 1762800000000, content: [{ type: 'paragraph', attrs: { style: 'tag' }, content: [{ type: 'text', text: 'Golden card' }] }] });
  });

  it('round trips a card, and the sender is the key that sealed it', async () => {
    const a = await makeIdentity(), b = await makeIdentity();
    expect(a.priv.extractable).toBe(false);
    const env = await seal(a, b.pub, card);
    expect(env[0]).toBe(1);
    expect(Array.from(env.subarray(1, 33))).toEqual(Array.from(a.pub)); // the sender's key rides in the clear
    expect(new TextDecoder().decode(env)).not.toContain('Warming'); // the card does not
    const got = await open(b, env);
    expect(got.card).toEqual(card);
    expect(Array.from(got.from)).toEqual(Array.from(a.pub));
  });

  it('a changed byte anywhere is refused', async () => {
    const a = await makeIdentity(), b = await makeIdentity();
    const env = await seal(a, b.pub, card);
    for (const at of [0, 5, 40, 60, env.length - 20, env.length - 1]) {
      const bad = env.slice();
      bad[at] ^= 1;
      await expect(open(b, bad)).rejects.toBeInstanceOf(BadEnvelope);
    }
    await expect(open(b, env.subarray(0, 50))).rejects.toBeInstanceOf(BadEnvelope);
  });

  it('only the recipient can open it', async () => {
    const a = await makeIdentity(), b = await makeIdentity(), eve = await makeIdentity();
    const env = await seal(a, b.pub, card);
    await expect(open(eve, env)).rejects.toThrow('decrypt');
    await expect(open(a, env)).rejects.toThrow('decrypt'); // not even the sender
  });

  it('someone who swaps in another sender key cannot pass it off as theirs', async () => {
    // Eve has A's code (public key) but not A's private key: she seals with her own key and writes A's key in the header
    const a = await makeIdentity(), b = await makeIdentity(), eve = await makeIdentity();
    const env = await seal(eve, b.pub, card);
    env.set(a.pub, 1);
    await expect(open(b, env)).rejects.toThrow('decrypt');
  });

  it('a sender with the key but a broken card inside is refused, not delivered', async () => {
    const a = await makeIdentity(), b = await makeIdentity();
    // the real seal with a card that isn't one
    const bad = await seal(a, b.pub, { name: 'x', at: 1, content: 'not a list' as unknown as unknown[] });
    await expect(open(b, bad)).rejects.toThrow('content');
  });

  it('a card that unpacks past 2 MB is refused: by seal, and by open when a sender skips seal', async () => {
    const a = await makeIdentity(), b = await makeIdentity();
    const big = 'x'.repeat(3 * 1024 * 1024);
    await expect(seal(a, b.pub, { name: 'x', at: 1, content: [big] })).rejects.toBeInstanceOf(TooBig);
    // the envelope built by hand, as someone with their own client would: a few KB on the wire
    const te = new TextEncoder(), salt = new Uint8Array(16), iv = new Uint8Array(12);
    const secret = await crypto.subtle.deriveBits({ name: 'X25519', public: await crypto.subtle.importKey('raw', b.pub as Uint8Array<ArrayBuffer>, { name: 'X25519' }, false, []) }, a.priv, 256);
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('falcon card v1') }, await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const sealRaw = async (json: string) => {
      const aad = new Uint8Array([1, ...a.pub, ...b.pub]);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, deflateSync(te.encode(json))));
      return new Uint8Array([1, ...a.pub, ...salt, ...iv, ...ct]);
    };
    const fine = await sealRaw(JSON.stringify({ v: 1, name: 'x', at: 1, content: ['ok'] }));
    expect((await open(b, fine)).card.content).toEqual(['ok']); // the hand-built envelope is a real one
    const bomb = await sealRaw(JSON.stringify({ v: 1, name: 'x', at: 1, content: [big] }));
    expect(bomb.length).toBeLessThan(10_000);
    await expect(open(b, bomb)).rejects.toThrow('content');
  });

  it("carries the sender's id for the send, and reads a card without one", async () => {
    const a = await makeIdentity(), b = await makeIdentity();
    expect((await open(b, await seal(a, b.pub, { name: 'x', at: 1, content: [], mid: 'abc' }))).card.mid).toBe('abc');
    expect((await open(b, await seal(a, b.pub, { name: 'x', at: 1, content: [] }))).card.mid).toBeUndefined();
    expect((await open(b, await seal(a, b.pub, { name: 'x', at: 1, content: [], mid: 'm'.repeat(65) }))).card.mid).toBeUndefined();
  });
});

describe('proof of key', () => {
  it('only the private key matches what the relay computes', async () => {
    const me = await makeIdentity(), other = await makeIdentity();
    const inbox = await inboxId(me.pub);
    // the relay's side: a one-time pair, X25519 with the inbox's public key
    const eph = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const relayView = await proveKey(eph.privateKey, me.pub, nonce, inbox);
    expect(Array.from(await proveKey(me.priv, ephPub, nonce, inbox))).toEqual(Array.from(relayView));
    expect(Array.from(await proveKey(other.priv, ephPub, nonce, inbox))).not.toEqual(Array.from(relayView));
  });
});

describe('what a received card may put in a document', async () => {
  const { cardFragment } = await import('../src/collab/service');
  const { markMap } = await import('../src/editor/editor');
  const { schema } = await import('../src/editor/schema');
  const para = (attrs: object, content: object[]) => ({ type: 'paragraph', attrs, content });
  const text = (t: string, marks: object[] = []) => ({ type: 'text', text: t, marks });

  it('keeps every style and mark Falcon writes', () => {
    const json = [
      para({ style: 'tag' }, [text('Tag')]),
      para({ style: 'normal', indent: 1 }, [text('Smith 24', [{ type: 'cite' }]), text(' body '), text('under', [{ type: 'underline' }, { type: 'highlight', attrs: { color: 'green' } }]),
        text('box', [{ type: 'emphasis' }]), text(' big', [{ type: 'size', attrs: { pt: 14 } }]), text(' red', [{ type: 'color', attrs: { color: '#c00000' } }])]),
    ];
    const f = cardFragment(json)!;
    expect(markMap(schema.node('doc', null, f))).toBe(markMap(schema.node('doc', null, Fragment.fromJSON(schema, json))));
    expect(f.child(1).attrs.indent).toBe(1);
  });

  it('refuses a style the schema has no drawing for, and drops a color that would inject CSS', () => {
    expect(cardFragment([para({ style: 'bogus' }, [text('x')])])).toBeNull();
    const f = cardFragment([para({ style: 'normal' }, [text('x', [{ type: 'color', attrs: { color: 'red;background:url(https://evil.test/p)' } }])])])!;
    expect(f.child(0).firstChild!.marks).toEqual([]);
    expect(cardFragment([{ type: 'nonsense' }])).toBeNull();
    expect(cardFragment([])).toBeNull();
    expect(cardFragment('x')).toBeNull();
  });

  it('refuses a table whose cell spans what no table has', () => {
    const table = (attrs: object) => [{ type: 'table', content: [{ type: 'table_row', content: [{ type: 'table_cell', attrs, content: [para({ style: 'normal' }, [text('x')])] }] }] }];
    expect(cardFragment(table({ colspan: 2, rowspan: 1 }))).not.toBeNull();
    for (const bad of [{ colspan: 1e7 }, { colspan: -5 }, { colspan: 1.5 }, { colspan: 0 }, { rowspan: 64 }, { colspan: '2' }]) expect(cardFragment(table(bad)), JSON.stringify(bad)).toBeNull();
  });

  it("gives a footnote's text the same pass: a color that would load from the web is dropped, plain marks stay", () => {
    const note = [text('see ', [{ type: 'underline' }]), text('this', [{ type: 'color', attrs: { color: 'red;background:url(https://evil.test/p)' } }]), text(' ok', [{ type: 'color', attrs: { color: '#c00000' } }])];
    const f = cardFragment([para({ style: 'normal' }, [text('body'), { type: 'footnote', attrs: { content: note } }])])!;
    let got: { text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }[] = [];
    f.descendants((n) => { if (n.type.name === 'footnote') got = n.attrs.content; });
    expect(got.map((n) => n.text).join('')).toBe('see this ok');
    expect(JSON.stringify(got)).not.toContain('evil.test');
    expect(got[0].marks?.map((m) => m.type)).toEqual(['underline']);
    expect(got.at(-1)!.marks?.[0].attrs?.color).toMatch(/^#c00000$/i);
  });

  it('keeps a picture carried in the card, and drops one that would load from the web', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const f = cardFragment([para({ style: 'normal' }, [text('a'), { type: 'image', attrs: { src: png } }, { type: 'image', attrs: { src: 'https://tracker.test/p.png' } }, text('b')])])!;
    const srcs: string[] = [];
    f.descendants((n) => { if (n.type.name === 'image') srcs.push(n.attrs.src); });
    expect(srcs).toEqual([png]);
  });
});

describe('live-editing invites and room frames', () => {
  it('an invite rides in a sealed card envelope, and comes out whole', async () => {
    const a = await makeIdentity(), b = await makeIdentity();
    const { room, key } = newRoom();
    const invite = { room, key: b64url(key), doc: 'Econ DA' };
    const got = await open(b, await seal(a, b.pub, { name: 'Avery', at: 1, content: [], mid: 'm1', invite }));
    expect(got.card.invite).toEqual(invite);
    expect(got.card.content).toEqual([]);
  });
  it('a malformed invite is dropped, the envelope still opens', async () => {
    const a = await makeIdentity(), b = await makeIdentity();
    for (const bad of [{ room: 'nothex', key: b64url(new Uint8Array(32)), doc: 'x' }, { room: 'a'.repeat(64), key: b64url(new Uint8Array(5)), doc: 'x' }, { room: 'a'.repeat(64), key: 1, doc: 'x' }]) {
      const got = await open(b, await seal(a, b.pub, { name: 'Avery', at: 1, content: [], invite: bad as never }));
      expect(got.card.invite).toBeUndefined();
    }
  });
  it('a room frame opens only with its room key, room id and kind', async () => {
    const { room, key } = newRoom(), other = newRoom();
    const k = await roomKey(key);
    const sealed = await sealFrame(k, room, 1, new TextEncoder().encode('an update'));
    expect(new TextDecoder().decode(await openFrame(k, room, 1, sealed))).toBe('an update');
    await expect(openFrame(k, room, 3, sealed)).rejects.toThrow(BadEnvelope); // replayed as another kind
    await expect(openFrame(k, other.room, 1, sealed)).rejects.toThrow(BadEnvelope); // into another room
    await expect(openFrame(await roomKey(other.key), room, 1, sealed)).rejects.toThrow(BadEnvelope);
    expect(room).toMatch(/^[0-9a-f]{64}$/);
    expect(room).not.toBe(other.room);
  });
});
