// The relay's Worker code run by `wrangler dev` (workerd, as in production), driven over HTTP and
// WebSocket by Falcon's real client crypto (src/collab). Run: npm test (from relay/).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeIdentity, open, proveKey, seal, b64url, unb64url } from '../../src/collab/crypto.ts';
import { inboxId } from '../../src/collab/code.ts';

const here = new URL('..', import.meta.url).pathname;
const servers = [];

async function startRelay(vars = {}) {
  const persist = mkdtempSync(join(tmpdir(), 'falcon-relay-'));
  const port = 18000 + Math.floor(Math.random() * 2000);
  const args = ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--log-level', 'warn', '--show-interactive-dev-session=false',
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])];
  const proc = spawn('npx', args, { cwd: here, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
after(() => { for (const s of servers) { try { process.kill(-s.proc.pid, 'SIGTERM'); } catch { /* gone */ } rmSync(s.persist, { recursive: true, force: true }); } });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const opened = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
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
