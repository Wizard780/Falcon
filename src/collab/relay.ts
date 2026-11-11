/**
 * How sealed cards travel. A Transport sends an envelope to an inbox and listens on this install's
 * inbox; the crypto and the UI only ever talk to this interface, so another way of carrying
 * envelopes (a LAN host, say) slots in beside the relay without touching either.
 *
 * The relay one (relay/ in this repo) is built for Cloudflare's free plan, where every request and
 * socket message counts: it never polls, keeps one socket, and backs off when it can't connect.
 */
import { b64url, unb64url } from './crypto';

/** The relay a fresh install uses. Empty until one is deployed (relay/README.md); Settings > General can set one. */
export const DEFAULT_RELAY = '';

export type SendError = 'unreachable' | 'too_large' | 'inbox_full' | 'daily_limit' | 'bad_envelope' | 'relay_error';
export type SendResult = { ok: true } | { ok: false; error: SendError };

/** The listening socket: off, on its way, live, or waiting to try again (at a time). */
export type Link = { kind: 'off' } | { kind: 'connecting' } | { kind: 'live' } | { kind: 'retry'; at: number };

export type Me = { pub: Uint8Array; inbox: string; prove: (eph: Uint8Array, nonce: Uint8Array) => Promise<Uint8Array> };
export type Handlers = {
  /** A card for me. Resolve once it is safely stored (or found to be junk): only then is it acked and deleted from the relay. Reject to leave it there. */
  card: (id: string, envelope: Uint8Array) => Promise<void>;
  link: (l: Link) => void;
};

export interface Transport {
  send(inbox: string, envelope: Uint8Array): Promise<SendResult>;
  /** Listen on my inbox until the returned stop is called. */
  listen(me: Me, on: Handlers): () => void;
}

/** 00:00 UTC next, when the free plan's daily limits reset. */
export const nextUtcMidnight = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

const FIRST_RETRY = 2_000;
const MAX_RETRY = 5 * 60_000;
/** A link that lasted this long was a good one: the next retry starts short again. One that keeps dropping keeps backing off. */
const STABLE = 60_000;
/** The clock jumping this far between ticks means the computer slept: the socket is likely dead without knowing it. */
const TICK = 30_000, SLEPT = 150_000;
const ID_LEN = 36;

export function relayTransport(base: string): Transport {
  const root = base.trim().replace(/\/+$/, '');
  const at = (inbox: string) => `${root}/v1/inbox/${inbox}`;
  return {
    async send(inbox, envelope) {
      let r: Response;
      // no Content-Type and no custom headers: a "simple" request, so the browser sends no preflight first
      try { r = await fetch(at(inbox), { method: 'POST', body: envelope as Uint8Array<ArrayBuffer> }); } catch { return { ok: false, error: 'unreachable' }; }
      if (r.ok) return { ok: true };
      const error: SendError = r.status === 413 ? 'too_large' : r.status === 507 ? 'inbox_full' : r.status === 429 ? 'daily_limit' : r.status === 400 ? 'bad_envelope' : 'relay_error';
      return { ok: false, error };
    },

    listen(me, on) {
      let ws: WebSocket | null = null, timer = 0, stopped = false, delay = FIRST_RETRY, liveAt = 0, ticked = Date.now();
      let chain = Promise.resolve(), acks: string[] = [], pending = 0;
      const flush = () => { if (acks.length && ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ t: 'ack', ids: acks })); acks = []; } };
      const later = () => {
        if (stopped) return;
        const wait = Math.round(delay * (0.75 + Math.random() * 0.5));
        delay = Math.min(delay * 2, MAX_RETRY);
        on.link({ kind: 'retry', at: Date.now() + wait });
        timer = window.setTimeout(connect, wait);
      };
      const connect = () => {
        window.clearTimeout(timer);
        if (stopped) return;
        on.link({ kind: 'connecting' });
        let sock: WebSocket;
        try { sock = new WebSocket(`${at(me.inbox).replace(/^http/, 'ws')}`); } catch { later(); return; }
        ws = sock;
        sock.binaryType = 'arraybuffer';
        sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', pub: b64url(me.pub) }));
        sock.onmessage = (e) => {
          if (typeof e.data === 'string') {
            let m: { t?: string; eph?: string; nonce?: string };
            try { m = JSON.parse(e.data); } catch { return; }
            if (m.t === 'challenge' && m.eph && m.nonce) {
              void me.prove(unb64url(m.eph), unb64url(m.nonce)).then((mac) => sock.send(JSON.stringify({ t: 'proof', mac: b64url(mac) })), () => sock.close());
            } else if (m.t === 'ready') { liveAt = Date.now(); on.link({ kind: 'live' }); flush(); } // acks a dropped socket didn't get to send
            return;
          }
          const b = new Uint8Array(e.data as ArrayBuffer);
          if (b.length <= ID_LEN) return;
          const id = new TextDecoder().decode(b.subarray(0, ID_LEN)), env = b.slice(ID_LEN);
          // one at a time, and the acks go out together once the cards that came in a burst are stored
          pending++;
          chain = chain.then(() => on.card(id, env)).then(() => { acks.push(id); }, () => { /* not stored: it stays on the relay for next time */ })
            .then(() => { if (!--pending) flush(); });
        };
        sock.onclose = () => {
          if (ws !== sock) return;
          ws = null;
          if (liveAt && Date.now() - liveAt >= STABLE) delay = FIRST_RETRY;
          liveAt = 0;
          later();
        };
      };
      // back online after a dropped connection: try now instead of waiting out the backoff
      const online = () => { if (!ws && !stopped) { delay = FIRST_RETRY; connect(); } };
      addEventListener('online', online);
      // after a sleep the socket can sit dead while looking open (nothing is ever sent on it to find out): start a new one.
      // A local clock check, not a ping: it costs the relay nothing until the computer really slept.
      const wake = window.setInterval(() => {
        const now = Date.now(), slept = now - ticked > SLEPT;
        ticked = now;
        if (!slept || stopped || !ws) return;
        const s = ws;
        ws = null; liveAt = 0;
        s.close();
        connect();
      }, TICK);
      connect();
      return () => {
        stopped = true;
        window.clearTimeout(timer);
        window.clearInterval(wake);
        removeEventListener('online', online);
        const s = ws;
        ws = null;
        s?.close();
        on.link({ kind: 'off' });
      };
    },
  };
}
