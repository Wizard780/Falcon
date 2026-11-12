/**
 * An in-memory relay with live-editing rooms that speaks relay/'s Room protocol, installed as `WebSocket` and `fetch`
 * for https://rooms.test, so the app's real session code (src/collab/live.ts) runs unchanged in jsdom.
 * relay/test/relay.test.mjs covers the real Worker; this covers the app's side of the conversation.
 */
import { vi } from 'vitest';

export const ROOMS = 'https://rooms.test';
type Seat = { slot: number; at: number; joined: boolean };

export function fakeRooms() {
  const rooms = new Map<string, Set<FakeSocket>>();
  /** 'old': a relay from before rooms (404 everywhere); 'down': nothing answers; 'daily': the day's allowance is spent
   *  (the room says so); 'capped': the Worker's own request cap is spent (a socket can't open, /v1/rooms is 429);
   *  'broken': the socket can't open and /v1/rooms is 503 */
  let mode: 'up' | 'old' | 'down' | 'daily' | 'capped' | 'broken' = 'up';
  let at = 0;
  const frames: { room: string; slot: number; kind: number; size: number }[] = [];

  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    binaryType = 'blob';
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    room: string;
    seat: Seat | null = null;
    constructor(url: string) {
      this.room = /\/v1\/room\/([0-9a-f]{64})$/.exec(url)![1];
      setTimeout(() => {
        if (mode === 'down' || mode === 'old' || mode === 'capped' || mode === 'broken') { this.readyState = 3; this.onclose?.(); return; }
        this.readyState = 1;
        if (mode === 'daily') { this.onopen?.(); this.say(JSON.stringify({ t: 'error', code: 'daily_limit' })); setTimeout(() => this.drop(), 2); return; }
        const all = rooms.get(this.room) ?? new Set();
        rooms.set(this.room, all);
        this.seat = { slot: Math.max(0, ...[...all].map((s) => s.seat!.slot)) + 1, at: at++, joined: false };
        all.add(this);
        this.onopen?.();
      }, 1);
    }
    private say(m: unknown) { setTimeout(() => { if (this.readyState === 1) this.onmessage?.({ data: m }); }, 1); }
    private others() { return [...(rooms.get(this.room) ?? [])].filter((s) => s !== this && s.seat?.joined).sort((a, b) => a.seat!.at - b.seat!.at); }
    send(raw: string | Uint8Array) {
      if (this.readyState !== 1 || !this.seat) return;
      if (typeof raw === 'string') {
        if (JSON.parse(raw).t !== 'join') return;
        const peers = this.others();
        this.seat.joined = true;
        this.say(JSON.stringify({ t: 'welcome', slot: this.seat.slot, peers: peers.map((s) => s.seat!.slot) }));
        for (const s of peers) s.say(JSON.stringify({ t: 'joined', slot: this.seat.slot }));
        return;
      }
      const b = new Uint8Array(raw);
      frames.push({ room: this.room, slot: this.seat.slot, kind: b[0], size: b.length });
      const out = (body: Uint8Array) => { const f = new Uint8Array(5 + body.length); f[0] = b[0]; new DataView(f.buffer).setUint32(1, this.seat!.slot); f.set(body, 5); return f.buffer; };
      const peers = this.others();
      if (b[0] === 1) for (const s of peers) s.say(out(b.subarray(1)));
      else if (b[0] === 2) { if (peers.length) peers[b[1] % peers.length].say(out(b.subarray(2))); else this.say(JSON.stringify({ t: 'alone' })); }
      else if (b[0] === 3) { const slot = new DataView(b.buffer, b.byteOffset).getUint32(1); peers.find((s) => s.seat!.slot === slot)?.say(out(b.subarray(5))); }
    }
    /** the connection drops (the relay or the network): the room tells the others */
    drop() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      const all = rooms.get(this.room);
      all?.delete(this);
      if (this.seat?.joined) for (const s of [...(all ?? [])].filter((x) => x.seat?.joined)) s.say(JSON.stringify({ t: 'left', slot: this.seat.slot }));
      setTimeout(() => this.onclose?.(), 1);
    }
    close() { this.drop(); }
  }

  const realFetch = globalThis.fetch;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (!u.startsWith(ROOMS)) return realFetch(url, init);
    if (mode === 'down') throw new TypeError('Failed to fetch');
    if (mode === 'capped') return new Response('<html>error 1027</html>', { status: 429 });
    if (mode === 'broken') return new Response('oops', { status: 503 });
    if (new URL(u).pathname === '/v1/rooms' && mode !== 'old') return new Response(JSON.stringify({ rooms: 1 }), { status: 200 });
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  });
  return {
    frames,
    setMode: (m: typeof mode) => { mode = m; },
    /** every socket in every room drops, as when the relay restarts or the wifi goes */
    dropAll: () => { for (const all of rooms.values()) for (const s of [...all]) s.drop(); },
    restore: () => vi.unstubAllGlobals(),
  };
}
