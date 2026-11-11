/**
 * An in-memory relay that speaks relay/'s wire protocol, installed as `fetch` and `WebSocket` for
 * https://relay.test, so the app's real relay transport (src/collab/relay.ts) runs unchanged in jsdom.
 * relay/test/relay.test.mjs covers the real Worker; this covers the app's side of the conversation.
 */
import { vi } from 'vitest';
import { proveKey, b64url, unb64url } from '../src/collab/crypto';
import { inboxId } from '../src/collab/code';

export const RELAY = 'https://relay.test';
type Msg = { id: string; data: Uint8Array };

export function fakeRelay() {
  const inboxes = new Map<string, Msg[]>();
  const sockets = new Set<FakeSocket>();
  /** what the relay answers a POST with; null = store it (201). 'down' = the network fails */
  let answer: number | 'down' | null = null;
  let up = true;
  const posted: { inbox: string; data: Uint8Array; headers: Headers }[] = [];
  const box = (id: string) => { if (!inboxes.has(id)) inboxes.set(id, []); return inboxes.get(id)!; };
  let n = 0;

  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    binaryType = 'blob';
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    inbox: string;
    expect: Uint8Array | null = null;
    proven = false;
    constructor(url: string) {
      this.inbox = /\/v1\/inbox\/([0-9a-f]{64})$/.exec(url)![1];
      setTimeout(() => {
        if (!up) { this.readyState = 3; this.onclose?.(); return; }
        sockets.add(this);
        this.readyState = 1;
        this.onopen?.();
      }, 1);
    }
    private say(m: unknown) { setTimeout(() => this.onmessage?.({ data: typeof m === 'string' ? m : m }), 1); }
    deliver(m: Msg) {
      const f = new Uint8Array(36 + m.data.length);
      f.set(new TextEncoder().encode(m.id));
      f.set(m.data, 36);
      this.say(f.buffer);
    }
    async send(raw: string) {
      const m = JSON.parse(raw);
      if (m.t === 'hello') {
        const pub = unb64url(m.pub);
        if ((await inboxId(pub)) !== this.inbox) return this.close();
        const eph = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
        const nonce = crypto.getRandomValues(new Uint8Array(32));
        this.expect = await proveKey(eph.privateKey, pub, nonce, this.inbox);
        this.say(JSON.stringify({ t: 'challenge', eph: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))), nonce: b64url(nonce) }));
      } else if (m.t === 'proof') {
        if (!this.expect || b64url(this.expect) !== m.mac) return this.close();
        this.proven = true;
        this.say(JSON.stringify({ t: 'ready' }));
        for (const x of box(this.inbox)) this.deliver(x);
      } else if (m.t === 'ack' && this.proven) {
        inboxes.set(this.inbox, box(this.inbox).filter((x) => !m.ids.includes(x.id)));
        acks.push(...m.ids);
      }
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; sockets.delete(this); setTimeout(() => this.onclose?.(), 1); }
  }
  const acks: string[] = [];

  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).startsWith(RELAY)) throw new TypeError('offline');
    if (!up || answer === 'down') throw new TypeError('Failed to fetch');
    const inbox = /\/v1\/inbox\/([0-9a-f]{64})$/.exec(String(url))![1];
    const data = new Uint8Array(init!.body as Uint8Array);
    posted.push({ inbox, data, headers: new Headers(init?.headers) });
    if (answer) return new Response('{}', { status: answer });
    const m = { id: `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`, data };
    box(inbox).push(m);
    for (const s of sockets) if (s.proven && s.inbox === inbox) s.deliver(m);
    return new Response(JSON.stringify({ id: m.id }), { status: 201 });
  });

  return {
    install() { vi.stubGlobal('fetch', fetch); vi.stubGlobal('WebSocket', FakeSocket); },
    inboxes, posted, acks,
    /** POST from outside the app (another person's Falcon) */
    post: (inbox: string, data: Uint8Array) => fetch(`${RELAY}/v1/inbox/${inbox}`, { method: 'POST', body: data as Uint8Array<ArrayBuffer> }),
    answer: (a: number | 'down' | null) => { answer = a; },
    /** the relay goes away: sockets drop and nothing connects */
    down: () => { up = false; for (const s of [...sockets]) s.close(); },
    proven: () => [...sockets].filter((s) => s.proven).length,
    provenOn: (inbox: string) => [...sockets].filter((s) => s.proven && s.inbox === inbox).length,
  };
}
