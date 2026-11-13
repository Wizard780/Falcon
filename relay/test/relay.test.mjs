// The relay's Worker code run by `wrangler dev` (workerd, as in production), driven over HTTP and
// WebSocket by Falcon's real client crypto (src/collab). Run: npm test (from relay/).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeIdentity, open, proveKey, seal, b64url, unb64url } from '../../src/collab/crypto.ts';
import { inboxId } from '../../src/collab/code.ts';

const here = new URL('..', import.meta.url).pathname;
const servers = [];

async function startRelay(vars = {}, cwd = here) {
  const persist = mkdtempSync(join(tmpdir(), 'falcon-relay-'));
  const port = 18000 + Math.floor(Math.random() * 2000);
  const args = ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--log-level', 'warn', '--show-interactive-dev-session=false',
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])];
  const proc = spawn('npx', args, { cwd, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${url}/nope`); if (r.status === 404) break; } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error(`wrangler dev exited:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
    if (i === 119) throw new Error(`wrangler dev never came up:\n${log}`);
  }
  const s = { url, persist, proc, log: () => log };
  servers.push(s);
  return s;
}
/** Folders a test made for a relay to run from: removed only once that relay is stopped (wrangler run from a folder that's gone doesn't stop). */
const dirs = [];
after(() => {
  for (const s of servers) { try { process.kill(-s.proc.pid, 'SIGTERM'); } catch { /* gone */ } rmSync(s.persist, { recursive: true, force: true }); }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** A socket's open, or a failure after 10 s: an upgrade that never answers fails the test instead of hanging the run. */
const opening = (ws) => new Promise((r, j) => { const t = setTimeout(() => j(new Error('socket never opened')), 10_000); ws.onopen = () => { clearTimeout(t); r(); }; ws.onerror = (e) => { clearTimeout(t); j(e); }; });
const card = (text) => ({ name: 'Alex', at: Date.now(), content: [{ type: 'paragraph', attrs: { style: 'tag' }, content: [{ type: 'text', text }] }] });
const post = (url, inbox, body) => fetch(`${url}/v1/inbox/${inbox}`, { method: 'POST', body });

/** A WebSocket on an inbox that records what arrives. `who` is the identity it claims (its pub) and proves with (its priv). */
function connect(url, inbox) {
  const ws = new WebSocket(`${url.replace('http', 'ws')}/v1/inbox/${inbox}`);
  ws.binaryType = 'arraybuffer';
  const got = { text: [], cards: [], closed: null };
  const waiters = [];
  const poke = () => { for (const w of [...waiters]) if (w.ok()) { waiters.splice(waiters.indexOf(w), 1); w.done(); } };
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') got.text.push(JSON.parse(e.data));
    else { const b = new Uint8Array(e.data); got.cards.push({ id: new TextDecoder().decode(b.subarray(0, 36)), env: b.slice(36) }); }
    poke();
  };
  ws.onclose = (e) => { got.closed = e.code; poke(); };
  const until = (ok, ms = 5000) => new Promise((res, rej) => {
    if (ok()) return res();
    const t = setTimeout(() => rej(new Error(`timed out; got ${JSON.stringify({ text: got.text, cards: got.cards.length, closed: got.closed })}`)), ms);
    waiters.push({ ok, done: () => { clearTimeout(t); res(); } });
  });
  const opened = opening(ws);
  return { ws, got, until, opened, send: (m) => ws.send(JSON.stringify(m)) };
}

/** Connect and prove the key, the way Falcon does. */
async function owner(url, me) {
  const c = connect(url, await inboxId(me.pub));
  await c.opened;
  c.send({ t: 'hello', pub: b64url(me.pub) });
  await c.until(() => c.got.text.some((m) => m.t === 'challenge'));
  const ch = c.got.text.find((m) => m.t === 'challenge');
  c.send({ t: 'proof', mac: b64url(await proveKey(me.priv, unb64url(ch.eph), unb64url(ch.nonce), await inboxId(me.pub))) });
  await c.until(() => c.got.text.some((m) => m.t === 'ready'));
  return c;
}

let relay;
before(async () => { relay = await startRelay(); });

describe('relay', () => {
  test('a card waits, and is delivered only after the owner proves the key', async () => {
    const a = await makeIdentity(), b = await makeIdentity(), inbox = await inboxId(b.pub);
    const r = await post(relay.url, inbox, await seal(a, b.pub, card('First card')));
    assert.equal(r.status, 201);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    // a hello alone gets a challenge and nothing else
    const c = connect(relay.url, inbox);
    await c.opened;
    c.send({ t: 'hello', pub: b64url(b.pub) });
    await c.until(() => c.got.text.length > 0);
    assert.equal(c.got.text[0].t, 'challenge');
    await wait(300);
    assert.equal(c.got.cards.length, 0);
    c.ws.close();
    // proving it delivers the card, which opens as the one sent
    const o = await owner(relay.url, b);
    await o.until(() => o.got.cards.length === 1);
    const { card: got, from } = await open(b, o.got.cards[0].env);
    assert.equal(got.content[0].content[0].text, 'First card');
    assert.deepEqual([...from], [...a.pub]);
    o.send({ t: 'ack', ids: [o.got.cards[0].id] });
    await wait(200);
    o.ws.close();
  });

  test('a stranger with only the code can neither read nor delete', async () => {
    const a = await makeIdentity(), b = await makeIdentity(), eve = await makeIdentity(), inbox = await inboxId(b.pub);
    await post(relay.url, inbox, await seal(a, b.pub, card('Secret card')));
    // a key that isn't this inbox's
    const c1 = connect(relay.url, inbox);
    await c1.opened;
    c1.send({ t: 'hello', pub: b64url(eve.pub) });
    await c1.until(() => c1.got.closed !== null);
    assert.equal(c1.got.text[0].code, 'bad_key');
    assert.equal(c1.got.closed, 4001);
    // the right public key (it's in the code), but a proof made with another private key
    const c2 = connect(relay.url, inbox);
    await c2.opened;
    c2.send({ t: 'hello', pub: b64url(b.pub) });
    await c2.until(() => c2.got.text.some((m) => m.t === 'challenge'));
    const ch = c2.got.text[0];
    c2.send({ t: 'proof', mac: b64url(await proveKey(eve.priv, unb64url(ch.eph), unb64url(ch.nonce), inbox)) });
    await c2.until(() => c2.got.closed !== null);
    assert.equal(c2.got.text[1].code, 'bad_proof');
    assert.equal(c2.got.closed, 4003);
    assert.equal(c2.got.cards.length, 0);
    // an ack before any proof is refused, and deletes nothing
    const c3 = connect(relay.url, inbox);
    await c3.opened;
    c3.send({ t: 'ack', ids: ['00000000-0000-0000-0000-000000000000'] });
    await c3.until(() => c3.got.closed !== null);
    assert.equal(c3.got.closed, 4000);
    // so the owner still gets it
    const o = await owner(relay.url, b);
    await o.until(() => o.got.cards.length === 1);
    assert.equal((await open(b, o.got.cards[0].env)).card.content[0].content[0].text, 'Secret card');
    o.ws.close();
  });

  test('a socket that has not proven the key gets nothing pushed; a proven one gets each card as it comes', async () => {
    const a = await makeIdentity(), b = await makeIdentity(), inbox = await inboxId(b.pub);
    const o = await owner(relay.url, b);
    const lurker = connect(relay.url, inbox);
    await lurker.opened;
    lurker.send({ t: 'hello', pub: b64url(b.pub) }); // challenged, never answers
    await lurker.until(() => lurker.got.text.length === 1);
    await post(relay.url, inbox, await seal(a, b.pub, card('Live card')));
    await o.until(() => o.got.cards.length === 1);
    await wait(300);
    assert.equal(lurker.got.cards.length, 0);
    lurker.ws.close(); o.ws.close();
  });

  test('an ack deletes the card; without one it comes again on the next connect', async () => {
    const a = await makeIdentity(), b = await makeIdentity(), inbox = await inboxId(b.pub);
    await post(relay.url, inbox, await seal(a, b.pub, card('One')));
    await post(relay.url, inbox, await seal(a, b.pub, card('Two')));
    let o = await owner(relay.url, b);
    await o.until(() => o.got.cards.length === 2);
    const [one, two] = o.got.cards;
    o.send({ t: 'ack', ids: [one.id] }); // Two is never acked: the app closed before it was stored
    await wait(200);
    o.ws.close();
    o = await owner(relay.url, b);
    await o.until(() => o.got.cards.length === 1);
    await wait(300);
    assert.deepEqual(o.got.cards.map((c) => c.id), [two.id]);
    o.send({ t: 'ack', ids: [two.id] });
    await wait(200);
    o.ws.close();
    o = await owner(relay.url, b);
    await wait(400);
    assert.equal(o.got.cards.length, 0);
    o.ws.close();
  });

  test('size and queue caps answer with their own status codes', async () => {
    const b = await makeIdentity(), inbox = await inboxId(b.pub);
    const env = (n) => { const e = new Uint8Array(n); e[0] = 1; return e; };
    assert.equal((await post(relay.url, inbox, env(1_000_001))).status, 413);
    assert.deepEqual(await (await post(relay.url, inbox, env(1_000_001))).json(), { error: 'too_large', max: 1_000_000 });
    assert.equal((await post(relay.url, inbox, env(20))).status, 400);
    const v2 = env(200); v2[0] = 2;
    assert.equal((await post(relay.url, inbox, v2)).status, 400);
    assert.equal((await post(relay.url, 'f'.repeat(63), env(200))).status, 404);
    assert.equal((await fetch(`${relay.url}/v1/inbox/${inbox}`, { method: 'PUT', body: env(200) })).status, 405);
    // ten of the largest fill the 10 MB an inbox may hold
    for (let i = 0; i < 10; i++) assert.equal((await post(relay.url, inbox, env(1_000_000))).status, 201);
    const full = await post(relay.url, inbox, env(200));
    assert.equal(full.status, 507);
    assert.deepEqual(await full.json(), { error: 'inbox_full' });
    // and fifty small ones fill the count
    const c = await makeIdentity(), inbox2 = await inboxId(c.pub);
    for (let i = 0; i < 50; i++) assert.equal((await post(relay.url, inbox2, env(200))).status, 201);
    assert.equal((await post(relay.url, inbox2, env(200))).status, 507);
  });

  test('a body sent without a length is cut off at the cap, not read to its end', async () => {
    const inbox = await inboxId((await makeIdentity()).pub);
    let sent = 0;
    const body = new ReadableStream({ pull(c) { if (sent >= 3_000_000) return c.close(); const b = new Uint8Array(65536); b[0] = 1; sent += b.length; c.enqueue(b); } });
    const r = await fetch(`${relay.url}/v1/inbox/${inbox}`, { method: 'POST', body, duplex: 'half' });
    assert.equal(r.status, 413);
  });

  test('a CORS preflight is answered for any origin, and a plain POST needs none', async () => {
    const r = await fetch(`${relay.url}/v1/inbox/${'a'.repeat(64)}`, { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('access-control-allow-methods'), /POST/);
  });
});

describe('expiry', () => {
  test('an undelivered card is deleted by the inbox alarm once it expires', { timeout: 60_000 }, async () => {
    const short = await startRelay({ EXPIRY_MS: '10000' }); // 3 hours in production; seconds here
    const a = await makeIdentity(), b = await makeIdentity(), inbox = await inboxId(b.pub);
    assert.equal((await post(short.url, inbox, await seal(a, b.pub, card('Stale')))).status, 201);
    await wait(4000);
    assert.equal((await post(short.url, inbox, await seal(a, b.pub, card('Fresh')))).status, 201); // due at 14 s
    const rows = () => {
      const dir = join(short.persist, 'v3', 'do', 'falcon-relay-Inbox');
      return readdirSync(dir).filter((f) => f.endsWith('.sqlite')).reduce((n, f) => {
        const db = new DatabaseSync(join(dir, f), { readOnly: true });
        try {
          // the namespace also keeps an empty metadata database beside each object's own
          const has = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'msg'").get();
          return n + (has ? db.prepare('SELECT COUNT(*) AS n FROM msg').get().n : 0);
        } finally { db.close(); }
      }, 0);
    };
    assert.equal(rows(), 2);
    await wait(7500); // 11.5 s: the first is 1.5 s past due and its alarm has run; the second has 2.5 s to go
    assert.equal(rows(), 1);
    let o = await owner(short.url, b);
    await o.until(() => o.got.cards.length === 1, 1000);
    assert.equal((await open(b, o.got.cards[0].env)).card.content[0].content[0].text, 'Fresh');
    o.ws.close();
    await wait(4000); // about 16 s, past 14: the alarm set itself again for the second card
    assert.equal(rows(), 0);
    o = await owner(short.url, b);
    await wait(400);
    assert.equal(o.got.cards.length, 0);
    o.ws.close();
  });
});

// ---------- live-editing rooms ----------

const ROOM = 'c'.repeat(63);
/** A socket on a room, joined, recording text and binary frames ({kind, from, body}). */
async function seat(url, room, join = true) {
  const ws = new WebSocket(`${url.replace('http', 'ws')}/v1/room/${room}`);
  ws.binaryType = 'arraybuffer';
  const got = { text: [], frames: [], closed: null };
  const waiters = [];
  const poke = () => { for (const w of [...waiters]) if (w.ok()) { waiters.splice(waiters.indexOf(w), 1); w.done(); } };
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') got.text.push(JSON.parse(e.data));
    else { const b = new Uint8Array(e.data); got.frames.push({ kind: b[0], from: new DataView(b.buffer).getUint32(1), body: new TextDecoder().decode(b.subarray(5)) }); }
    poke();
  };
  ws.onclose = (e) => { got.closed = e.code; poke(); };
  const until = (ok, ms = 5000) => new Promise((res, rej) => {
    if (ok()) return res();
    const t = setTimeout(() => rej(new Error(`timed out; got ${JSON.stringify(got)}`)), ms);
    waiters.push({ ok, done: () => { clearTimeout(t); res(); } });
  });
  await opening(ws);
  const s = { ws, got, until, frame: (kind, body, extra = []) => ws.send(new Uint8Array([kind, ...extra, ...new TextEncoder().encode(body)])) };
  if (join) { ws.send(JSON.stringify({ t: 'join' })); await until(() => got.text.some((m) => m.t === 'welcome')); s.slot = got.text.find((m) => m.t === 'welcome').slot; }
  return s;
}
const roomRows = (persist) => {
  const dir = join(persist, 'v3', 'do', 'falcon-relay-Room');
  let rows = 0, tables = [];
  for (const f of (() => { try { return readdirSync(dir); } catch { return []; } })().filter((x) => x.endsWith('.sqlite'))) {
    const db = new DatabaseSync(join(dir, f), { readOnly: true });
    try {
      // __miniflare_do_name is wrangler dev's own note of each object's name (production has none)
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> '__miniflare_do_name'").all()) {
        tables.push(name);
        rows += db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
      }
    } finally { db.close(); }
  }
  return { rows, tables };
};

describe('rooms', () => {
  test('GET /v1/rooms says this relay has rooms, without a Durable Object', async () => {
    const r = await fetch(`${relay.url}/v1/rooms`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal((await r.json()).rooms, 1);
  });

  test('join, broadcast, ask the longest-in peer, answer one peer, leave', async () => {
    const room = `${ROOM}1`;
    const a = await seat(relay.url, room), b = await seat(relay.url, room);
    assert.deepEqual(a.got.text[0], { t: 'welcome', slot: a.slot, peers: [] });
    assert.deepEqual(b.got.text[0], { t: 'welcome', slot: b.slot, peers: [a.slot] });
    await a.until(() => a.got.text.some((m) => m.t === 'joined' && m.slot === b.slot));
    // an update goes to everyone else, never back
    b.frame(1, 'sealed update');
    await a.until(() => a.got.frames.length === 1);
    assert.deepEqual(a.got.frames[0], { kind: 1, from: b.slot, body: 'sealed update' });
    await wait(200);
    assert.equal(b.got.frames.length, 0);
    // an ask goes to the one in longest; attempt 1 goes to the next
    const c = await seat(relay.url, room);
    assert.deepEqual(c.got.text[0].peers, [a.slot, b.slot]);
    c.frame(2, 'ask', [0]);
    await a.until(() => a.got.frames.some((f) => f.kind === 2));
    assert.deepEqual(a.got.frames.find((f) => f.kind === 2), { kind: 2, from: c.slot, body: 'ask' });
    c.frame(2, 'ask again', [1]);
    await b.until(() => b.got.frames.some((f) => f.kind === 2));
    assert.equal(b.got.frames.find((f) => f.kind === 2).body, 'ask again');
    // an answer goes to the slot it names only
    const to = new Uint8Array(4); new DataView(to.buffer).setUint32(0, c.slot);
    a.frame(3, 'snapshot piece', [...to]);
    await c.until(() => c.got.frames.some((f) => f.kind === 3));
    assert.deepEqual(c.got.frames.find((f) => f.kind === 3), { kind: 3, from: a.slot, body: 'snapshot piece' });
    await wait(200);
    assert.equal(b.got.frames.filter((f) => f.kind === 3).length, 0);
    // leaving tells the others
    b.ws.close();
    await a.until(() => a.got.text.some((m) => m.t === 'left' && m.slot === b.slot));
    await c.until(() => c.got.text.some((m) => m.t === 'left' && m.slot === b.slot));
    a.ws.close(); c.ws.close();
  });

  test('an ask with nobody else in is answered "alone"; frames before join, and too big, are refused', async () => {
    const room = `${ROOM}2`;
    const a = await seat(relay.url, room);
    a.frame(2, 'anyone?', [0]);
    await a.until(() => a.got.text.some((m) => m.t === 'alone'));
    const early = await seat(relay.url, room, false);
    early.frame(1, 'not joined');
    await early.until(() => early.got.closed !== null);
    assert.deepEqual(early.got.text, [{ t: 'error', code: 'bad_request' }]);
    a.ws.send(new Uint8Array(1_048_576 + 6));
    await a.until(() => a.got.closed !== null);
    assert.equal(a.got.text.at(-1).code, 'too_large');
  });

  test('a ninth person is turned away: room_full', async () => {
    const room = `${ROOM}3`;
    const in8 = [];
    for (let i = 0; i < 8; i++) in8.push(await seat(relay.url, room));
    const ninth = await seat(relay.url, room, false);
    await ninth.until(() => ninth.got.closed !== null);
    assert.deepEqual(ninth.got.text, [{ t: 'error', code: 'room_full' }]);
    for (const s of in8) s.ws.close();
  });

  test('a room writes nothing to storage: a burst of frames leaves no rows', async () => {
    const room = `${ROOM}4`;
    const a = await seat(relay.url, room), b = await seat(relay.url, room);
    for (let i = 0; i < 50; i++) a.frame(1, `update ${i}`);
    await b.until(() => b.got.frames.length === 50);
    b.frame(2, 'ask', [0]);
    await a.until(() => a.got.frames.some((f) => f.kind === 2));
    a.ws.close(); b.ws.close();
    await wait(500);
    const { rows, tables } = roomRows(relay.persist);
    assert.equal(rows, 0, `rows in ${tables.join(', ')}`);
    assert.deepEqual(tables, []);
  });

  test('a room id that is not 64 hex is 404, and a plain GET is told to use a WebSocket', async () => {
    assert.equal((await fetch(`${relay.url}/v1/room/xyz`)).status, 404);
    assert.equal((await fetch(`${relay.url}/v1/room/${ROOM}5`)).status, 426);
  });
});

// ---------- usage: the relay counting its own day ----------

const usage = async (url) => { const r = await fetch(`${url}/v1/usage`); return { status: r.status, body: await r.json(), cors: r.headers.get('access-control-allow-origin') }; };
/** What changed between two readings. */
const delta = (a, b) => Object.fromEntries(['requests', 'objects', 'rows', 'msgs'].map((k) => [k, b[k] - a[k]]));

describe('usage', () => {
  let metered;
  before(async () => { metered = await startRelay({ METER_TEST: 'on' }); });

  test('GET /v1/usage answers the raw tallies for today (UTC), and nothing else', async () => {
    const u = await usage(metered.url);
    assert.equal(u.status, 200);
    assert.equal(u.cors, '*');
    assert.deepEqual(Object.keys(u.body).sort(), ['day', 'msgs', 'objects', 'requests', 'rows', 'usage']);
    assert.equal(u.body.usage, 1);
    assert.equal(u.body.day, new Date().toISOString().slice(0, 10));
  });

  test('a card sent, and an inbox connect, are counted with what they cost', async () => {
    const a = await makeIdentity(), b = await makeIdentity(), inbox = await inboxId(b.pub);
    const u0 = (await usage(metered.url)).body; // nothing counted since the last test's answer: that one again
    assert.equal((await post(metered.url, inbox, await seal(a, b.pub, card('Counted')))).status, 201);
    const u1 = (await usage(metered.url)).body;
    // the GET above, the POST and this GET; the inbox, the card's alarm to come and the Meter call; the card's 5 rows and
    // the Meter's upsert; its ack
    assert.deepEqual(delta(u0, u1), { requests: 3, objects: 3, rows: 6, msgs: 1 });
    // a card turned away before any Durable Object is a Worker request only
    assert.equal((await post(metered.url, inbox, new Uint8Array(20))).status, 400);
    const o = await owner(metered.url, b);
    await o.until(() => o.got.cards.length === 1);
    o.ws.close();
    const u2 = (await usage(metered.url)).body;
    // the 400, the connect and this GET; the inbox and the Meter; the upsert; hello, proof and an ack
    assert.deepEqual(delta(u1, u2), { requests: 3, objects: 2, rows: 1, msgs: 3 });
  });

  test('the answer is kept for a while: asking again costs no Durable Object request, until something is counted', async () => {
    const u1 = (await usage(metered.url)).body; // the last test's answer, kept
    const u2 = (await usage(metered.url)).body;
    assert.deepEqual(u2, u1); // the same answer: the Meter wasn't asked
    await fetch(`${metered.url}/v1/rooms`); // a Worker request only: still the same answer
    assert.deepEqual((await usage(metered.url)).body, u1);
    const b = await makeIdentity();
    assert.equal((await post(metered.url, await inboxId(b.pub), await seal(await makeIdentity(), b.pub, card('x')))).status, 201);
    const u3 = (await usage(metered.url)).body;
    // the three kept answers and the rooms check reach it now, with the POST and this GET: they were counted all along
    assert.deepEqual(delta(u1, u3), { requests: 6, objects: 3, rows: 6, msgs: 1 });
  });

  test('a room counts incoming messages through hibernation, and hands the rest over when the socket closes', { timeout: 60_000 }, async () => {
    const room = `${ROOM}6`;
    const u0 = (await usage(metered.url)).body; // the last test's answer, kept
    const a = await seat(metered.url, room), b = await seat(metered.url, room);
    for (let i = 0; i < 10; i++) a.frame(1, `before ${i}`);
    await b.until(() => b.got.frames.length === 10);
    await wait(20_000); // idle: the room hibernates and is evicted (wrangler dev does it after about 10 s)
    for (let i = 0; i < 10; i++) a.frame(1, `after ${i}`);
    await b.until(() => b.got.frames.length === 20);
    a.ws.close(); b.ws.close();
    await wait(1000);
    const u1 = (await usage(metered.url)).body;
    // the kept GET, two connects and this GET; their rooms, one flush and this GET's: the first to leave hands its count to
    // the one still there, and only the last tells the Meter; 2 joins and 20 frames
    assert.deepEqual(delta(u0, u1), { requests: 4, objects: 4, rows: 2, msgs: 22 });
  });

  test('a busy room hands over a batch every 400 messages, without waiting for a close', async () => {
    const room = `${ROOM}7`;
    const a = await seat(metered.url, room), b = await seat(metered.url, room);
    await wait(300);
    const u0 = (await usage(metered.url)).body;
    for (let i = 0; i < 399; i++) a.frame(1, 'x'); // with a's join, 400
    await b.until(() => b.got.frames.length === 399);
    await wait(500);
    // the room hands its batch to the Meter itself, so the Worker's kept answer doesn't know: a connect (counted here) makes
    // the next answer fresh. That socket never joins, so it adds no message
    const c = await seat(metered.url, `${ROOM}9`, false);
    const u1 = (await usage(metered.url)).body;
    assert.equal(u1.msgs - u0.msgs, 400);
    c.ws.close();
    a.ws.close(); b.ws.close();
  });

  test('a new UTC day starts from nothing: yesterday\'s row is replaced', async () => {
    const r = await fetch(`${metered.url}/v1/usage`, { method: 'PUT', body: JSON.stringify({ day: '2000-01-01', requests: 99_000, objects: 99_000, rows: 99_000, msgs: 99_000 }) });
    assert.equal(r.status, 200);
    const u = (await usage(metered.url)).body;
    assert.equal(u.day, new Date().toISOString().slice(0, 10));
    assert.ok(u.requests < 10 && u.objects < 10 && u.rows < 10 && u.msgs < 10, JSON.stringify(u));
  });

  test('only tests can set the row: on a relay without METER_TEST a PUT is refused', async () => {
    assert.equal((await fetch(`${relay.url}/v1/usage`, { method: 'PUT', body: '{}' })).status, 405);
  });

  test('a relay deployed without the Meter\'s binding still sends, connects and passes room frames', { timeout: 60_000 }, async () => {
    // the same code with METER left out of the config: every hand-over finds no Meter
    const dir = mkdtempSync(join(tmpdir(), 'falcon-relay-nometer-'));
    dirs.push(dir);
    cpSync(join(here, 'src'), join(dir, 'src'), { recursive: true });
    symlinkSync(join(here, 'node_modules'), join(dir, 'node_modules'));
    writeFileSync(join(dir, 'wrangler.jsonc'), readFileSync(join(here, 'wrangler.jsonc'), 'utf8').replace(/, \{ "name": "METER", "class_name": "Meter" \}/, ''));
    assert.doesNotMatch(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'), /"METER"/);
    const bare = await startRelay({}, dir);
    const a = await makeIdentity(), b = await makeIdentity(), inbox = await inboxId(b.pub);
    for (let i = 0; i < 30; i++) assert.equal((await post(bare.url, inbox, await seal(a, b.pub, card(`Card ${i}`)))).status, 201);
    for (let i = 0; i < 110; i++) assert.equal((await fetch(`${bare.url}/v1/rooms`)).status, 200); // past the request flush too
    const o = await owner(bare.url, b);
    await o.until(() => o.got.cards.length === 30);
    o.ws.close();
    const x = await seat(bare.url, `${ROOM}a`), y = await seat(bare.url, `${ROOM}a`);
    for (let i = 0; i < 450; i++) x.frame(1, 'x'); // past a room's 400
    await y.until(() => y.got.frames.length === 450);
    x.ws.close();
    await y.until(() => y.got.text.some((m) => m.t === 'left'));
    y.ws.close();
    assert.equal((await usage(bare.url)).status, 503);
  });

  test('a Meter that fails (over the day\'s limit) costs no send and breaks no room; /v1/usage says daily_limit', async () => {
    const over = await startRelay({ METER_TEST: 'over' });
    const a = await makeIdentity(), b = await makeIdentity(), inbox = await inboxId(b.pub);
    // past the 25 a flush waits for, so flushes run (and fail) along the way
    for (let i = 0; i < 30; i++) assert.equal((await post(over.url, inbox, await seal(a, b.pub, card(`Card ${i}`)))).status, 201);
    const o = await owner(over.url, b);
    await o.until(() => o.got.cards.length === 30);
    o.ws.close();
    const x = await seat(over.url, `${ROOM}8`), y = await seat(over.url, `${ROOM}8`);
    x.frame(1, 'still passes');
    await y.until(() => y.got.frames.length === 1);
    x.ws.close(); y.ws.close();
    const u = await usage(over.url);
    assert.equal(u.status, 429);
    assert.deepEqual(u.body, { error: 'daily_limit' });
  });
});
