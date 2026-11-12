/**
 * Live co-editing, the network half: a session is one room on the relay (relay/src/index.ts, Room), one Loro doc
 * (live-doc.ts) and everyone's carets. Every frame is sealed with the room key (crypto.ts sealFrame), so the relay
 * passes along bytes it can't read and stores none of them.
 *
 * Built for the Workers free plan (scripts/live-free-tier.mjs), where each frame a client sends is 1/20 of a request:
 * - this peer's own edits go out at most once every BATCH_MS, all of them in one frame, with its caret. Nothing it
 *   only received is sent on (that would multiply frames by the number of people), and an idle peer sends nothing;
 * - nobody stores the doc but the people in the room. Joining (or coming back after a drop) asks one peer for what's
 *   missing by version vector, and sends back what that peer lacks;
 * - when the relay's day is spent, or anything else drops the socket, the doc stays editable here and catches up once
 *   the room is reachable again.
 *
 * Plaintext of a frame: [msg u32][piece u16][pieces u16][slice of the message]. A message is parts, [tag u8][len u32][bytes]
 * each, cut into pieces of at most PIECE bytes (a whole block file, when someone joins).
 */
import { VersionVector } from 'loro-crdt';
import { b64url, BadEnvelope, newRoom, openFrame, roomKey, sealFrame, unb64url, type Invite } from './crypto';
import { docOf, newBinding, seed, type Binding, type Peer } from './live-doc';
import { checkRooms, nextUtcMidnight } from './relay';
import type { Node as PMNode } from 'prosemirror-model';

/** One frame of this peer's edits per this long, at most (scripts/live-free-tier.mjs is worked out at 400). */
export const BATCH_MS = 400;
const PIECE = 256 * 1024;
/** No answer to an ask in this long: ask the next peer. */
const ASK_WAIT = 10_000;
const FIRST_RETRY = 1_000, MAX_RETRY = 30_000, STABLE = 60_000;
const TICK = 30_000, SLEPT = 150_000;
const FRAME_UPDATE = 1, FRAME_ASK = 2, FRAME_TO = 3;
const T_UPDATE = 1, T_PRESENCE = 2, T_VERSION = 3, T_ME = 4;
/** Caret colors, one per peer (chosen from its Loro peer id, so it's the same on every screen). */
const COLORS = ['#2563eb', '#db2777', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

export type LiveStatus =
  | { kind: 'connecting' }
  /** in the room, getting the doc (or what came in while away) from someone */
  | { kind: 'syncing' }
  /** in the room with no doc yet, and nobody in it has one to give */
  | { kind: 'waiting' }
  | { kind: 'live' }
  | { kind: 'retry'; at: number }
  /** the relay's free plan is spent for the day: nothing is tried until it resets */
  | { kind: 'paused'; until: number }
  | { kind: 'full' }
  /** the relay is older than live editing: whoever set it up redeploys it */
  | { kind: 'no_rooms' }
  | { kind: 'ended' };
export type Member = { slot: number; name: string; color: string; peer?: string };

const te = new TextEncoder(), td = new TextDecoder();
function parts(list: [number, Uint8Array][]): Uint8Array {
  const out = new Uint8Array(list.reduce((n, [, b]) => n + 5 + b.length, 0));
  const dv = new DataView(out.buffer);
  let at = 0;
  for (const [tag, b] of list) { out[at] = tag; dv.setUint32(at + 1, b.length); out.set(b, at + 5); at += 5 + b.length; }
  return out;
}
function unparts(b: Uint8Array): [number, Uint8Array][] {
  const out: [number, Uint8Array][] = [], dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let at = 0; at + 5 <= b.length;) {
    const len = dv.getUint32(at + 1);
    if (at + 5 + len > b.length) break;
    out.push([b[at], b.subarray(at + 5, at + 5 + len)]);
    at += 5 + len;
  }
  return out;
}
const colorOf = (peer: string) => COLORS[Number(BigInt(peer) % BigInt(COLORS.length))];

export type SessionOpts = { relay: string; room: string; key: Uint8Array; doc: string; name: string; onChange: () => void;
  /** how long an ask waits for its answer before trying the next peer (tests shorten it) */
  askWait?: number };

export class LiveSession {
  readonly binding: Binding;
  readonly me: Peer;
  status: LiveStatus = { kind: 'connecting' };
  /** the others in the room now, longest in first */
  members: Member[] = [];
  /** frames this peer has sent (for the free-plan check in the journey) */
  sent = 0;
  /** resolves once there is a doc to show: at once for the host, after the first sync for someone joining */
  readonly ready: Promise<PMNode>;

  private key: Promise<CryptoKey>;
  private ws: WebSocket | null = null;
  private joined = false;
  private slot = 0;
  private earlier = new Set<number>(); // slots in before me: the one in longest tidies remote changes (Binding.fixer)
  private names = new Map<number, Member>();
  private pending: Uint8Array[] = [];
  private meDirty = true;
  private caretDirty = false;
  private timer = 0;
  private lastSent = 0;
  private retry = 0;
  private delay = FIRST_RETRY;
  private liveAt = 0;
  private everWelcomed = false;
  private stopped = false;
  private ask = { attempt: 0, timer: 0, peers: 0 };
  /** Loro's version when the socket last dropped: what's newer here than that, the room may lack (edits made offline) */
  private droppedAt: VersionVector | null = null;
  private msg = 1;
  private pieces = new Map<string, { n: number; got: Uint8Array[]; count: number }>();
  private chain = Promise.resolve();
  private resolveReady!: (d: PMNode) => void;
  private offs: (() => void)[] = [];

  constructor(private o: SessionOpts, binding: Binding) {
    this.binding = binding;
    this.me = { name: o.name.trim() || 'Someone', color: colorOf(binding.doc.peerIdStr) };
    this.key = roomKey(o.key);
    this.ready = new Promise((r) => { this.resolveReady = r; });
    binding.fixer = () => !this.joined || this.earlier.size === 0;
    const now = docOf(binding);
    if (now) this.resolveReady(now);
    this.offs.push(binding.doc.subscribeLocalUpdates((u) => { this.pending.push(u); this.kick(); }));
    this.offs.push(binding.presence.subscribe((e) => {
      const mine = binding.doc.peerIdStr;
      if (e.by === 'local' && (e.added.includes(mine) || e.updated.includes(mine) || e.removed.includes(mine))) { this.caretDirty = true; this.kick(); }
      if (e.by !== 'local') o.onChange();
    }));
    // after a sleep the socket can look open and be dead: a local clock check, which costs the relay nothing
    let ticked = Date.now();
    const wake = window.setInterval(() => {
      const now = Date.now(), slept = now - ticked > SLEPT;
      ticked = now;
      if (slept && this.ws && !this.stopped) this.ws.close();
    }, TICK);
    const online = () => { if (!this.ws && !this.stopped && this.status.kind === 'retry') { this.delay = FIRST_RETRY; this.connect(); } };
    addEventListener('online', online);
    this.offs.push(() => { clearInterval(wake); removeEventListener('online', online); });
    this.connect();
  }

  /** What an invite to this room carries: the room is on the host's relay, wherever the invitee's own is. */
  invite(): Invite { return { room: this.o.room, key: b64url(this.o.key), doc: this.o.doc, relay: this.o.relay }; }
  get room() { return this.o.room; }
  get relay() { return this.o.relay; }

  /** Leave: the socket closes and the others see you go. The doc stays as it is here. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.retry);
    window.clearTimeout(this.ask.timer);
    for (const f of this.offs) f();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.pieces.clear();
    // the others' carets go (an empty store also stops its expiry timer)
    for (const k of this.binding.presence.keys()) if (k !== this.binding.doc.peerIdStr) this.binding.presence.delete(k as `${number}`);
    this.set({ kind: 'ended' });
  }

  private set(s: LiveStatus) { this.status = s; this.o.onChange(); }
  private setMembers() {
    this.members = [...this.names.values()].sort((a, b) => a.slot - b.slot);
    this.o.onChange();
  }

  // ---------- the socket ----------

  private connect() {
    window.clearTimeout(this.retry);
    if (this.stopped) return;
    this.set({ kind: 'connecting' });
    let ws: WebSocket;
    try { ws = new WebSocket(`${this.o.relay.replace(/^http/, 'ws')}/v1/room/${this.o.room}`); } catch { this.later(); return; }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    let refused = false;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
    ws.onmessage = (e) => {
      const data = e.data as string | ArrayBuffer;
      this.chain = this.chain.then(() => (ws === this.ws ? this.onMessage(data, () => { refused = true; }) : undefined)).catch(() => {});
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.ws = null;
      if (this.joined && !this.droppedAt) this.droppedAt = this.binding.doc.oplogVersion();
      this.joined = false;
      this.pieces.clear(); // a half-sent message never finishes on another socket
      this.earlier.clear();
      this.names.clear();
      this.setMembers();
      window.clearTimeout(this.ask.timer);
      if (this.stopped || refused) return;
      if (this.liveAt && Date.now() - this.liveAt >= STABLE) this.delay = FIRST_RETRY;
      this.liveAt = 0;
      // never got in: an older relay answers a room with 404, which a socket shows as just a failure
      if (!this.everWelcomed) void checkRooms(this.o.relay).then((r) => { if (this.stopped) return; if (r === 'no_rooms') this.set({ kind: 'no_rooms' }); else if (r === 'daily_limit') this.pause(); else this.later(); });
      else this.later();
    };
  }

  /** The relay's free day is spent: nothing is tried until it resets (00:00 UTC), then it connects again. */
  private pause() {
    const until = nextUtcMidnight();
    this.set({ kind: 'paused', until });
    window.clearTimeout(this.retry);
    this.retry = window.setTimeout(() => { this.delay = FIRST_RETRY; this.connect(); }, until - Date.now() + 5_000);
  }

  private later() {
    if (this.stopped) return;
    const wait = Math.round(this.delay * (0.75 + Math.random() * 0.5));
    this.delay = Math.min(this.delay * 2, MAX_RETRY);
    this.set({ kind: 'retry', at: Date.now() + wait });
    this.retry = window.setTimeout(() => this.connect(), wait);
  }

  private async onMessage(data: string | ArrayBuffer, refuse: () => void) {
    if (typeof data === 'string') {
      let m: { t?: string; slot?: number; peers?: number[]; code?: string };
      try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'welcome' && typeof m.slot === 'number') return this.welcome(m.slot, (m.peers ?? []).filter((x) => typeof x === 'number'));
      if (m.t === 'joined' && typeof m.slot === 'number') { this.names.set(m.slot, { slot: m.slot, name: '…', color: '#888' }); this.setMembers(); this.meDirty = true; this.kick(); return; }
      if (m.t === 'left' && typeof m.slot === 'number') return this.left(m.slot);
      if (m.t === 'alone') return this.synced();
      if (m.t === 'error') {
        if (m.code === 'daily_limit') { refuse(); this.pause(); } else if (m.code === 'room_full') { refuse(); this.set({ kind: 'full' }); this.retry = window.setTimeout(() => this.connect(), MAX_RETRY); }
      }
      return;
    }
    const b = new Uint8Array(data);
    if (b.length < 6) return;
    const kind = b[0], from = new DataView(b.buffer, b.byteOffset).getUint32(1);
    let plain: Uint8Array;
    try { plain = await openFrame(await this.key, this.o.room, kind, b.subarray(5)); } catch (e) { if (e instanceof BadEnvelope) return; throw e; }
    if (plain.length < 8) return;
    const dv = new DataView(plain.buffer, plain.byteOffset);
    const id = dv.getUint32(0), i = dv.getUint16(4), n = dv.getUint16(6), slice = plain.subarray(8);
    let whole: Uint8Array | null = slice;
    if (n > 1) {
      const k = `${from}:${kind}:${id}`;
      const p = this.pieces.get(k) ?? { n, got: [], count: 0 };
      if (!p.got[i]) { p.got[i] = slice.slice(); p.count++; }
      this.pieces.set(k, p);
      if (p.count < p.n) return;
      this.pieces.delete(k);
      whole = new Uint8Array(p.got.reduce((s, x) => s + x.length, 0));
      let at = 0;
      for (const x of p.got) { whole.set(x, at); at += x.length; }
    }
    this.onParts(kind, from, unparts(whole));
  }

  private welcome(slot: number, peers: number[]) {
    this.joined = true;
    this.everWelcomed = true;
    this.liveAt = Date.now();
    this.slot = slot;
    this.earlier = new Set(peers);
    for (const p of peers) this.names.set(p, { slot: p, name: '…', color: '#888' });
    this.setMembers();
    // what changed here while the socket was down goes with the sync, not as frames queued then
    this.pending = [];
    this.meDirty = true;
    this.caretDirty = true;
    this.ask = { attempt: 0, timer: 0, peers: peers.length };
    if (peers.length) { this.set({ kind: 'syncing' }); this.sendAsk(); }
    else this.synced();
  }

  private left(slot: number) {
    for (const k of [...this.pieces.keys()]) if (k.startsWith(`${slot}:`)) this.pieces.delete(k); // the next to get this slot starts clean
    const m = this.names.get(slot);
    this.names.delete(slot);
    this.earlier.delete(slot);
    if (m?.peer) this.binding.presence.delete(m.peer as `${number}`); // their caret goes at once
    this.setMembers();
  }

  private sendAsk() {
    window.clearTimeout(this.ask.timer);
    void this.send(FRAME_ASK, [[T_VERSION, this.binding.doc.oplogVersion().encode()], this.mePart()], [this.ask.attempt]);
    this.ask.timer = window.setTimeout(() => {
      if (!this.joined || this.status.kind !== 'syncing') return;
      // no answer: ask the next one (the first may be asleep with its socket not yet known dead)
      if (++this.ask.attempt < Math.max(1, this.ask.peers)) { this.sendAsk(); return; }
      // nobody answered: the room still gets what was made here while the socket was down
      this.sendSince(this.droppedAt);
      this.synced();
    }, this.o.askWait ?? ASK_WAIT);
  }

  /** Send the room what this peer has beyond `from` (nothing when it has nothing more). */
  private sendSince(from: VersionVector | null) {
    if (!from) return;
    const cmp = this.binding.doc.oplogVersion().compare(from);
    if (cmp !== undefined && cmp <= 0) return;
    this.lastSent = Date.now(); // it counts as this window's frame
    void this.send(FRAME_UPDATE, [[T_UPDATE, this.binding.doc.export({ mode: 'update', from })], this.mePart()]);
  }

  /** Done syncing, with whatever there is. */
  private synced() {
    window.clearTimeout(this.ask.timer);
    this.droppedAt = null;
    const doc = docOf(this.binding);
    if (doc) this.resolveReady(doc);
    this.set(doc ? { kind: 'live' } : { kind: 'waiting' });
    this.kick();
  }

  private mePart(): [number, Uint8Array] { return [T_ME, te.encode(JSON.stringify({ peer: this.binding.doc.peerIdStr, name: this.me.name, color: this.me.color }))]; }

  private onParts(kind: number, from: number, list: [number, Uint8Array][]) {
    const updates: Uint8Array[] = [];
    let version: Uint8Array | null = null;
    for (const [tag, bytes] of list) {
      if (tag === T_UPDATE) updates.push(bytes.slice());
      else if (tag === T_VERSION) version = bytes;
      else if (tag === T_PRESENCE) { try { this.binding.presence.apply(bytes); } catch { /* not ours */ } }
      else if (tag === T_ME) {
        try {
          const j = JSON.parse(td.decode(bytes)) as { peer?: unknown; name?: unknown; color?: unknown };
          if (typeof j.peer === 'string' && /^\d{1,20}$/.test(j.peer) && typeof j.name === 'string') {
            this.names.set(from, { slot: from, peer: j.peer, name: j.name.slice(0, 60) || 'Someone', color: COLORS.includes(String(j.color)) ? String(j.color) : colorOf(j.peer) });
            this.setMembers();
          }
        } catch { /* skip */ }
      }
    }
    if (updates.length) {
      try { this.binding.doc.importBatch(updates); } catch { /* a frame Loro can't read: the next sync covers it */ }
    }
    if (kind === FRAME_ASK && version) this.answer(from, version);
    else if (kind === FRAME_TO && this.status.kind === 'syncing') {
      // they sent what I lacked; now send everyone what they lack (edits made here while away)
      if (version) this.sendSince(VersionVector.decode(version));
      this.synced();
    } else if (this.status.kind === 'waiting' && docOf(this.binding)) this.synced();
  }

  /** Someone asked for what they're missing: send it to them alone. Someone with nothing gets the whole doc as a snapshot. */
  private answer(to: number, version: Uint8Array) {
    const theirs = VersionVector.decode(version), doc = this.binding.doc;
    const list: [number, Uint8Array][] = [];
    if (docOf(this.binding)) list.push([T_UPDATE, theirs.length() ? doc.export({ mode: 'update', from: theirs }) : doc.export({ mode: 'snapshot' })]);
    list.push([T_VERSION, doc.oplogVersion().encode()], this.mePart(), [T_PRESENCE, this.binding.presence.encodeAll()]);
    const target = new Uint8Array(4);
    new DataView(target.buffer).setUint32(0, to);
    void this.send(FRAME_TO, list, [...target]);
  }

  // ---------- sending ----------

  /** Something of mine to send: now if the last frame went out BATCH_MS ago, else when it's due. */
  private kick() {
    if (this.timer || this.stopped) return;
    this.timer = window.setTimeout(() => { this.timer = 0; this.flush(); }, Math.max(0, this.lastSent + BATCH_MS - Date.now()));
  }

  private flush() {
    if (!this.joined || this.status.kind === 'syncing') return; // the sync carries it
    if (!this.pending.length && !this.meDirty && !this.caretDirty) return;
    const list: [number, Uint8Array][] = this.pending.map((u) => [T_UPDATE, u]);
    if (this.caretDirty) { try { list.push([T_PRESENCE, this.binding.presence.encode(this.binding.doc.peerIdStr as `${number}`)]); } catch { /* no caret yet */ } }
    if (this.meDirty || this.caretDirty) list.push(this.mePart());
    this.pending = [];
    this.meDirty = this.caretDirty = false;
    this.lastSent = Date.now();
    void this.send(FRAME_UPDATE, list);
  }

  private async send(kind: number, list: [number, Uint8Array][], extra: number[] = []) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const body = parts(list), id = this.msg++, n = Math.max(1, Math.ceil(body.length / PIECE)), key = await this.key;
    for (let i = 0; i < n; i++) {
      const slice = body.subarray(i * PIECE, (i + 1) * PIECE), plain = new Uint8Array(8 + slice.length), dv = new DataView(plain.buffer);
      dv.setUint32(0, id); dv.setUint16(4, i); dv.setUint16(6, n);
      plain.set(slice, 8);
      const sealed = await sealFrame(key, this.o.room, kind, plain);
      const frame = new Uint8Array(1 + extra.length + sealed.length);
      frame[0] = kind;
      frame.set(extra, 1);
      frame.set(sealed, 1 + extra.length);
      if (ws !== this.ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(frame);
      this.sent++;
    }
  }
}

/** Start a session on this doc: a new room, the doc put into Loro. */
export function host(o: Omit<SessionOpts, 'room' | 'key'>, doc: PMNode): LiveSession {
  const b = newBinding();
  seed(b, doc);
  const { room, key } = newRoom();
  return new LiveSession({ ...o, room, key }, b);
}

/** Join a room from an invite: the doc comes from whoever is in it (`ready`). */
export function join(o: Omit<SessionOpts, 'room' | 'key' | 'doc'>, invite: Invite): LiveSession {
  // the room is on the relay the invite names (the host's); `o.relay` is for an invite that names none
  return new LiveSession({ ...o, relay: invite.relay || o.relay, room: invite.room, key: unb64url(invite.key), doc: invite.doc }, newBinding());
}
