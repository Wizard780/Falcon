/**
 * Falcon's card relay. One SQLite-backed Durable Object per inbox (hex SHA-256 of a public key) holds
 * sealed card envelopes until their owner connects and acks them. It never sees a card: only the
 * ciphertext, and the inbox id it is addressed to. Built for the Workers free plan: the Worker only
 * forwards, idle sockets hibernate, and each inbox has at most one alarm.
 *
 *   POST /v1/inbox/:id   body = envelope bytes  → 201 {id} | 400 | 404 | 413 | 429 | 503 | 507
 *   GET  /v1/inbox/:id   WebSocket. Client → relay text frames:
 *        {"t":"hello","pub":b64url}  {"t":"proof","mac":b64url}  {"t":"ack","ids":[...]}
 *     relay → client: {"t":"challenge","eph","nonce"} {"t":"ready"} {"t":"error","code"},
 *     and each card as a binary frame: 36 bytes of ASCII id, then the envelope.
 *
 * Live editing rooms (protocol in README.md): one Durable Object per room that passes sealed frames
 * between the people in it and keeps nothing. No storage, no alarms: who is in the room lives in each
 * socket's attachment, which survives hibernation. A late joiner gets the document from a peer.
 *
 *   GET /v1/rooms        → 200 {rooms:1,...}: this relay has rooms (an older one answers 404)
 *   GET /v1/room/:id     WebSocket, :id 64 hex. Text {"t":"join"} first; binary frames after.
 */
import { DurableObject } from 'cloudflare:workers';

/** Over this, an envelope is turned away (413). SQLite rows hold up to 8 MB; this leaves room. */
const MAX_ENVELOPE = 1_000_000;
const MIN_ENVELOPE = 1 + 32 + 16 + 12 + 16;
/** Per inbox: at most this many cards waiting, and this many bytes (507 past either). */
const MAX_QUEUED = 50;
const MAX_QUEUED_BYTES = 10_000_000;
const EXPIRY_MS = 3 * 3600_000;
const MAX_CONTROL = 4096; // a hello, proof or ack is far smaller
const ID_LEN = 36;

/** Room limits: people at once, and the largest frame (a peer sends a big doc in pieces well under it). */
const ROOM_PEERS = 8;
const MAX_FRAME = 1_048_576 + 5;
const FRAME_UPDATE = 1, FRAME_ASK = 2, FRAME_TO = 3;

interface Env { INBOX: DurableObjectNamespace<Inbox>; ROOM: DurableObjectNamespace<Room>; EXPIRY_MS?: string }
type Att = { inbox: string; expect?: string; proven?: boolean };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' };
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const te = new TextEncoder();
const b64url = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/** What the inbox owner must send back: HMAC(HKDF(X25519(eph, inbox key), salt nonce), nonce || inbox id). Same as src/collab/crypto.ts proveKey. */
async function expectedProof(eph: CryptoKey, inboxPub: Uint8Array, nonce: Uint8Array, inbox: string): Promise<Uint8Array> {
  const pub = await crypto.subtle.importKey('raw', inboxPub, { name: 'X25519' }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'X25519', public: pub } as unknown as SubtleCryptoDeriveKeyAlgorithm, eph, 256);
  const ikm = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: nonce, info: te.encode('falcon relay proof v1') }, ikm, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  const msg = new Uint8Array(nonce.length + inbox.length);
  msg.set(nonce);
  msg.set(te.encode(inbox), nonce.length);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
}

/**
 * The free plan's daily caps fail calls with "Exceeded allowed rows written in Durable Objects free tier"
 * (or rows read, duration, volume of requests). Cloudflare doesn't document the text; this is what it is
 * reported to say. Anything else (CPU, memory, a bug) is the relay breaking, not the day's allowance.
 */
const overLimit = (e: unknown) => /exceeded allowed .* free tier/i.test(String((e as Error)?.message ?? e));

/** The body, or null once it runs past `max` (a body sent without a length isn't read to its end first). */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const parts: Uint8Array[] = [];
  let n = 0;
  if (req.body) for await (const c of req.body) { n += c.length; if (n > max) return null; parts.push(c); }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * A socket that only says why it is closing. A WebSocket handshake that fails shows the page no status or body,
 * so the reason (the free plan's daily limit, mostly) comes as a message on a socket the Worker itself answers.
 */
function refuse(code: string) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.send(JSON.stringify({ t: 'error', code }));
  server.close(4029, code);
  return new Response(null, { status: 101, webSocket: client });
}

async function room(req: Request, env: Env, id: string): Promise<Response> {
  if (req.method !== 'GET') return reply(405, { error: 'method' });
  if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reply(426, { error: 'websocket_only' });
  try {
    return await env.ROOM.get(env.ROOM.idFromName(id)).fetch(req);
  } catch (e) {
    return refuse(overLimit(e) ? 'daily_limit' : 'relay_error');
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(req.url).pathname;
    // the Worker answers this itself: telling an up-to-date relay from an older one costs no Durable Object request
    if (path === '/v1/rooms') return reply(200, { rooms: 1, peers: ROOM_PEERS, frame: MAX_FRAME });
    const r = /^\/v1\/room\/([0-9a-f]{64})$/.exec(path);
    if (r) return room(req, env, r[1]);
    const m = /^\/v1\/inbox\/([0-9a-f]{64})$/.exec(path);
    if (!m) return reply(404, { error: 'not_found' });
    const inbox = m[1];
    const stub = env.INBOX.get(env.INBOX.idFromName(inbox));
    try {
      if (req.method === 'GET') {
        if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reply(426, { error: 'websocket_only' });
        return await stub.fetch(req);
      }
      if (req.method !== 'POST') return reply(405, { error: 'method' });
      if (Number(req.headers.get('Content-Length') ?? 0) > MAX_ENVELOPE) return reply(413, { error: 'too_large', max: MAX_ENVELOPE });
      const body = await readCapped(req, MAX_ENVELOPE);
      if (!body) return reply(413, { error: 'too_large', max: MAX_ENVELOPE });
      if (body.length < MIN_ENVELOPE || body[0] !== 1) return reply(400, { error: 'bad_envelope' });
      const r = await stub.put(inbox, body);
      return reply(r.status, r.body);
    } catch (e) {
      return overLimit(e) ? reply(429, { error: 'daily_limit' }) : reply(503, { error: 'relay_error' });
    }
  },
} satisfies ExportedHandler<Env>;

export class Inbox extends DurableObject<Env> {
  private sql: SqlStorage;
  private expiry: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.expiry = Number(env.EXPIRY_MS) > 0 ? Number(env.EXPIRY_MS) : EXPIRY_MS;
    this.sql.exec('CREATE TABLE IF NOT EXISTS msg (id TEXT PRIMARY KEY, at INTEGER NOT NULL, data BLOB NOT NULL)');
  }

  /** Store an envelope and push it to the owner's proven sockets. */
  async put(inbox: string, data: Uint8Array): Promise<{ status: number; body: { id?: string; error?: string } }> {
    const now = Date.now();
    const q = this.sql.exec<{ n: number; bytes: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM msg WHERE at > ?', now - this.expiry).one();
    if (q.n >= MAX_QUEUED || q.bytes + data.length > MAX_QUEUED_BYTES) return { status: 507, body: { error: 'inbox_full' } };
    const id = crypto.randomUUID();
    this.sql.exec('INSERT INTO msg (id, at, data) VALUES (?, ?, ?)', id, now, data);
    // one alarm per inbox: set only when none is pending (each setAlarm is a row write)
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + this.expiry);
    const frame = this.frame(id, data);
    // the card is stored: a socket that's closing mustn't turn that into a failed send
    for (const ws of this.ctx.getWebSockets()) if (this.att(ws)?.proven && this.att(ws)?.inbox === inbox) try { ws.send(frame); } catch { /* it gets it when it reconnects */ }
    return { status: 201, body: { id } };
  }

  async fetch(req: Request): Promise<Response> {
    const inbox = /([0-9a-f]{64})$/.exec(new URL(req.url).pathname)![1];
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ inbox } satisfies Att);
    return new Response(null, { status: 101, webSocket: client });
  }

  private att = (ws: WebSocket) => ws.deserializeAttachment() as Att | null;
  private frame(id: string, data: ArrayBuffer | Uint8Array) {
    const d = data instanceof Uint8Array ? data : new Uint8Array(data);
    const out = new Uint8Array(ID_LEN + d.length);
    out.set(te.encode(id));
    out.set(d, ID_LEN);
    return out;
  }
  private fail(ws: WebSocket, code: string, close: number) {
    try { ws.send(JSON.stringify({ t: 'error', code })); ws.close(close, code); } catch { /* already gone */ }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const att = this.att(ws);
    if (!att || typeof raw !== 'string' || raw.length > MAX_CONTROL) return this.fail(ws, 'bad_request', 4000);
    let m: { t?: unknown; pub?: unknown; mac?: unknown; ids?: unknown };
    try { m = JSON.parse(raw); } catch { return this.fail(ws, 'bad_request', 4000); }

    if (m.t === 'hello') {
      if (att.expect || att.proven || typeof m.pub !== 'string') return this.fail(ws, 'bad_request', 4000);
      let pub: Uint8Array;
      try { pub = unb64url(m.pub); } catch { return this.fail(ws, 'bad_key', 4001); }
      if (pub.length !== 32 || hex(await crypto.subtle.digest('SHA-256', pub)) !== att.inbox) return this.fail(ws, 'bad_key', 4001);
      const eph = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const expect = await expectedProof(eph.privateKey, pub, nonce, att.inbox);
      // only the answer is kept (it survives hibernation); the one-time private key is dropped here
      ws.serializeAttachment({ inbox: att.inbox, expect: b64url(expect) } satisfies Att);
      const ephPub = new Uint8Array((await crypto.subtle.exportKey('raw', eph.publicKey)) as ArrayBuffer);
      ws.send(JSON.stringify({ t: 'challenge', eph: b64url(ephPub), nonce: b64url(nonce) }));
      return;
    }

    if (m.t === 'proof') {
      if (!att.expect || att.proven || typeof m.mac !== 'string') return this.fail(ws, 'bad_request', 4000);
      let mac: Uint8Array;
      try { mac = unb64url(m.mac); } catch { mac = new Uint8Array(); }
      const want = unb64url(att.expect);
      let diff = mac.length ^ want.length;
      for (let i = 0; i < want.length; i++) diff |= (mac[i] ?? 0) ^ want[i];
      if (diff) return this.fail(ws, 'bad_proof', 4003);
      ws.serializeAttachment({ inbox: att.inbox, proven: true } satisfies Att);
      ws.send(JSON.stringify({ t: 'ready' }));
      const rows = this.sql.exec<{ id: string; data: ArrayBuffer }>('SELECT id, data FROM msg WHERE at > ? ORDER BY at', Date.now() - this.expiry).toArray();
      for (const r of rows) ws.send(this.frame(r.id, r.data));
      return;
    }

    if (m.t === 'ack') {
      // nothing is deleted for a socket that hasn't proven it holds the key
      if (!att.proven) return this.fail(ws, 'bad_request', 4000);
      const ids = Array.isArray(m.ids) ? m.ids.filter((x): x is string => typeof x === 'string' && x.length === ID_LEN).slice(0, MAX_QUEUED) : [];
      if (ids.length) this.sql.exec(`DELETE FROM msg WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
      return;
    }
    this.fail(ws, 'bad_request', 4000);
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 ? 1000 : code); } catch { /* already closed */ }
  }

  /** Expiry: drop what has waited 3 hours, then sleep until the next oldest card is due. */
  async alarm() {
    const now = Date.now();
    this.sql.exec('DELETE FROM msg WHERE at <= ?', now - this.expiry);
    const next = this.sql.exec<{ at: number | null }>('SELECT MIN(at) AS at FROM msg').one().at;
    if (next !== null) await this.ctx.storage.setAlarm(next + this.expiry);
  }
}

type Seat = { slot: number; at: number; joined?: boolean };

/**
 * A live-editing room. It passes binary frames between the sockets in it, never reads them (they are sealed with a key
 * only the people invited have), and stores nothing. Frames in: [kind][to: u32, FRAME_TO only][sealed]. Frames out:
 * [kind][from: u32][sealed].
 *   FRAME_UPDATE  to everyone else in the room
 *   FRAME_ASK     to one peer only, the one who has been in longest (a joiner's "send me what I'm missing")
 *   FRAME_TO      to the slot named (the answer to an ask, in pieces)
 * FRAME_ASK carries one more byte after the kind: the attempt, which picks the next peer when asking again.
 * Text out: {"t":"welcome","slot","peers":[slots, longest first]}, {"t":"joined","slot"}, {"t":"left","slot"},
 * {"t":"alone"} (an ask nobody can answer), {"t":"error","code"} then a close.
 */
export class Room extends DurableObject<Env> {
  private seat = (ws: WebSocket) => ws.deserializeAttachment() as Seat | null;
  /** The others in the room who have joined, longest first. */
  private others(me: WebSocket) {
    return this.ctx.getWebSockets().filter((w) => w !== me && this.seat(w)?.joined).sort((a, b) => this.seat(a)!.at - this.seat(b)!.at || this.seat(a)!.slot - this.seat(b)!.slot);
  }
  private send(ws: WebSocket, m: string | Uint8Array) { try { ws.send(m); } catch { /* closing: it hears about it when it reconnects */ } }
  private fail(ws: WebSocket, code: string, close: number) { this.send(ws, JSON.stringify({ t: 'error', code })); try { ws.close(close, code); } catch { /* gone */ } }

  async fetch(): Promise<Response> {
    const all = this.ctx.getWebSockets();
    if (all.length >= ROOM_PEERS) return refuse('room_full');
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    // a slot no one in the room has: one past the highest
    const slot = all.reduce((n, w) => Math.max(n, this.seat(w)?.slot ?? 0), 0) + 1;
    server.serializeAttachment({ slot, at: Date.now() } satisfies Seat);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const seat = this.seat(ws);
    if (!seat) return this.fail(ws, 'bad_request', 4000);
    if (typeof raw === 'string') {
      let m: { t?: unknown };
      try { m = raw.length <= 64 ? JSON.parse(raw) : {}; } catch { m = {}; }
      if (m.t !== 'join' || seat.joined) return this.fail(ws, 'bad_request', 4000);
      const peers = this.others(ws);
      ws.serializeAttachment({ ...seat, joined: true } satisfies Seat);
      this.send(ws, JSON.stringify({ t: 'welcome', slot: seat.slot, peers: peers.map((w) => this.seat(w)!.slot) }));
      for (const w of peers) this.send(w, JSON.stringify({ t: 'joined', slot: seat.slot }));
      return;
    }
    const b = new Uint8Array(raw);
    if (!seat.joined || b.length < 2 || b.length > MAX_FRAME) return this.fail(ws, b.length > MAX_FRAME ? 'too_large' : 'bad_request', 4000);
    const kind = b[0];
    const out = (body: Uint8Array) => {
      const f = new Uint8Array(5 + body.length);
      f[0] = kind;
      new DataView(f.buffer).setUint32(1, seat.slot);
      f.set(body, 5);
      return f;
    };
    if (kind === FRAME_UPDATE) {
      const f = out(b.subarray(1));
      for (const w of this.others(ws)) this.send(w, f);
    } else if (kind === FRAME_ASK) {
      // [kind][attempt][sealed]: the first ask goes to whoever has been in longest; asking again (no answer: that
      // peer's laptop may be asleep with its socket not yet known dead) goes to the next one
      const peers = this.others(ws);
      if (peers.length) this.send(peers[b[1] % peers.length], out(b.subarray(2)));
      else this.send(ws, JSON.stringify({ t: 'alone' }));
    } else if (kind === FRAME_TO && b.length >= 5) {
      const slot = new DataView(b.buffer, b.byteOffset).getUint32(1);
      const to = this.others(ws).find((w) => this.seat(w)!.slot === slot);
      if (to) this.send(to, out(b.subarray(5)));
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    const seat = this.seat(ws);
    if (seat?.joined) for (const w of this.others(ws)) this.send(w, JSON.stringify({ t: 'left', slot: seat.slot }));
    try { ws.close(code === 1005 ? 1000 : code); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws, 1011); }
}
