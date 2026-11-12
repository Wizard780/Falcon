// @vitest-environment node
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { relayWorker } from '../vite.config';
// @ts-expect-error plain .mjs test helper
import { FAKE_TOKEN, fakeCloudflare } from './cloudflare-fake.mjs';

// electron/relay-setup.cjs against a stand-in for Cloudflare's API that answers the way the real one did for the same
// calls. The worker is the one the build ships (vite.config.ts), made from relay/ here so this needs no build.
const require = createRequire(import.meta.url);
const { createRelaySetup, migrationsFor } = require('../electron/relay-setup.cjs');
const worker = relayWorker();
type Fake = ReturnType<typeof fakeCloudflare>;
type Result = { ok: boolean; url?: string; created?: boolean; error?: string; said?: string };

/** Math.random that walks through `letters` (a then b...), so the subdomains Falcon picks are known. */
const picks = (...names: string[]) => { const s = names.join('').split('').map((c) => (c.charCodeAt(0) - 97 + 0.5) / 26); let i = 0; return () => s[i++ % s.length]; };
async function run(cf: Fake, token: string = cf.token, random = picks('qwerty')) {
  const steps: string[] = [];
  const r: Result = await createRelaySetup({ worker, fetch: cf.fetch, random }).deploy(token, (s: string) => steps.push(s));
  // whatever happens, the token goes out only as the Authorization header, and never comes back in an answer
  if (token.length >= 5) {
    expect(JSON.stringify(r)).not.toContain(token);
    for (const { call, auth } of cf.state.log) { expect(call).not.toContain(token); expect(auth).toBe(`Bearer ${token}`); }
  }
  return { r, steps, calls: cf.state.log.map((l: { call: string }) => l.call) };
}
const relay = (cf: Fake) => cf.state.scripts.get('falcon-relay');

describe('Falcon sets up the relay on a Cloudflare account', () => {
  it('a brand-new account: uploads the relay with both migrations, picks a workers.dev subdomain without asking, and turns its address on', async () => {
    const cf = fakeCloudflare();
    const { r, steps, calls } = await run(cf);
    expect(r).toEqual({ ok: true, url: 'https://falcon-relay.falcon-qwerty.workers.dev', created: true });
    expect(steps).toEqual(['account', 'upload', 'address']);
    expect(cf.state.subdomain).toBe('falcon-qwerty');
    expect(relay(cf).tag).toBe('v2');
    expect([...relay(cf).classes]).toEqual(['Inbox', 'Room']);
    expect(relay(cf).workersDev).toBe(true);
    expect(relay(cf).code).toBe(worker.code);
    expect(relay(cf).meta).toMatchObject({ main_module: 'index.js', compatibility_date: worker.compatibility_date, observability: { enabled: false },
      bindings: [{ type: 'durable_object_namespace', name: 'INBOX', class_name: 'Inbox' }, { type: 'durable_object_namespace', name: 'ROOM', class_name: 'Room' }] });
    // the relay goes up before an address is picked, as wrangler does it
    expect(calls.indexOf('PUT /accounts/0123456789abcdef0123456789abcdef/workers/scripts/falcon-relay'))
      .toBeLessThan(calls.indexOf('PUT /accounts/0123456789abcdef0123456789abcdef/workers/subdomain'));
  });

  it('a subdomain someone else has: tries another name until one is free', async () => {
    const cf = fakeCloudflare({ taken: ['falcon-qwerty', 'falcon-asdfgh'] });
    const { r } = await run(cf, cf.token, picks('qwerty', 'asdfgh', 'zxcvbn'));
    expect(r).toMatchObject({ ok: true, url: 'https://falcon-relay.falcon-zxcvbn.workers.dev' });
    const cf2 = fakeCloudflare({ taken: ['falcon-qwerty'] });
    expect((await run(cf2, cf2.token, picks('qwerty'))).r).toEqual({ ok: false, error: 'no_subdomain' }); // five tries, all taken
  });

  it('an account that has a subdomain keeps it: Falcon never sends the PUT that would rename it', async () => {
    const cf = fakeCloudflare({ subdomain: 'coach' });
    const { r, calls } = await run(cf);
    expect(r).toEqual({ ok: true, url: 'https://falcon-relay.coach.workers.dev', created: false });
    expect(calls.some((c: string) => c.startsWith('PUT') && c.endsWith('/subdomain'))).toBe(false);
    expect(cf.state.renamed).toBe(false);
  });

  it('only "no subdomain" (10007) makes one: any other failure reading it stops, and nothing is renamed', async () => {
    const cf = fakeCloudflare({ subdomain: 'coach' });
    const flaky = async (url: string, init?: RequestInit) => (url.endsWith('/workers/subdomain') && !init?.method?.startsWith('P')
      ? new Response(JSON.stringify({ success: false, errors: [{ code: 10013, message: 'An unknown error has occurred' }] }), { status: 500 })
      : cf.fetch(url, init));
    const r: Result = await createRelaySetup({ worker, fetch: flaky }).deploy(cf.token);
    expect(r).toEqual({ ok: false, error: 'cloudflare', said: 'An unknown error has occurred' });
    expect(cf.state.renamed).toBe(false);
    expect(cf.state.subdomain).toBe('coach');
  });

  it('an answer that names no subdomain without saying there is none stops too, instead of making one', async () => {
    const cf = fakeCloudflare({ subdomain: 'coach' });
    const blank = async (url: string, init?: RequestInit) => (url.endsWith('/workers/subdomain') && !init?.method?.startsWith('P')
      ? new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { subdomain: null } }), { status: 200 })
      : cf.fetch(url, init));
    const r: Result = await createRelaySetup({ worker, fetch: blank }).deploy(cf.token);
    expect(r).toEqual({ ok: false, error: 'cloudflare' });
    expect(cf.state.log.some((l: { call: string }) => l.call.startsWith('PUT') && l.call.endsWith('/subdomain'))).toBe(false);
    expect(cf.state.subdomain).toBe('coach');
  });

  it('redeploys over an existing relay safely: a current one gets no migration, an older one only the steps it lacks', async () => {
    const now = fakeCloudflare({ subdomain: 'coach', scripts: { 'falcon-relay': { tag: 'v2', classes: ['Inbox', 'Room'], workersDev: true } } });
    expect((await run(now)).r.ok).toBe(true);
    expect(relay(now).meta.migrations).toBeUndefined();

    const old = fakeCloudflare({ subdomain: 'coach', scripts: { 'falcon-relay': { tag: 'v1', classes: ['Inbox'], workersDev: true } } });
    expect((await run(old)).r).toEqual({ ok: true, url: 'https://falcon-relay.coach.workers.dev', created: false });
    expect(relay(old).meta.migrations).toEqual({ old_tag: 'v1', new_tag: 'v2', steps: [{ new_sqlite_classes: ['Room'] }] });
    expect([...relay(old).classes]).toEqual(['Inbox', 'Room']);
  });

  it('a relay from a newer Falcon is left alone', async () => {
    const cf = fakeCloudflare({ subdomain: 'coach', scripts: { 'falcon-relay': { tag: 'v3', classes: ['Inbox', 'Room', 'Later'] } } });
    const { r, calls } = await run(cf);
    expect(r).toEqual({ ok: false, error: 'newer_relay' });
    expect(calls.some((c: string) => c.startsWith('PUT'))).toBe(false);
  });

  it('migrationsFor follows wrangler: all steps for a new script, the rest after its tag, none when current', () => {
    const list = [{ tag: 'v1', new_sqlite_classes: ['Inbox'] }, { tag: 'v2', new_sqlite_classes: ['Room'] }];
    expect(migrationsFor(list, undefined)).toEqual({ new_tag: 'v2', steps: [{ new_sqlite_classes: ['Inbox'] }, { new_sqlite_classes: ['Room'] }] });
    expect(migrationsFor(list, 'v1')).toEqual({ old_tag: 'v1', new_tag: 'v2', steps: [{ new_sqlite_classes: ['Room'] }] });
    expect(migrationsFor(list, 'v2')).toBeUndefined();
  });

  it('a token Cloudflare won\'t take, or one that can\'t do the job, is bad_token', async () => {
    const cf = fakeCloudflare();
    expect((await run(cf, `${cf.token.slice(0, -3)}nop`)).r).toEqual({ ok: false, error: 'bad_token' }); // token-shaped, but not this account's
    expect(cf.state.log.length).toBe(1); // Cloudflare was asked, and said no
    const weak = fakeCloudflare({ noPermission: true });
    expect((await run(weak)).r).toEqual({ ok: false, error: 'bad_token' });
  });

  it('what is plainly not a token is not_token, before any step and without asking Cloudflare: the name at the top of the token page, a few words, a key', async () => {
    const junk = ['', 'short', 'snowy-morning-63bf', 'quiet-butterfly-3f2a', 'Edit Cloudflare Workers', 'has a space in it 0123456789abcdefghijklmnop',
      `tab\there${'0'.repeat(40)}`, `${'x'.repeat(30)}\n`, 'x'.repeat(39), '0123456789abcdef0123456789abcdef01234', 'Bearer', '""',
      `https://dash.cloudflare.com/${'0'.repeat(32)}/api-tokens`, 'someone.with.a.long.name@example-school.edu'];
    for (const t of junk) {
      const quiet = fakeCloudflare();
      const { r, steps } = await run(quiet, t);
      expect(r, JSON.stringify(t)).toEqual({ ok: false, error: 'not_token' });
      expect(steps).toEqual([]); // so the guide marks Getting the token, not Finding your Cloudflare account
      expect(quiet.state.log).toEqual([]);
    }
  });

  it('takes both shapes a real token has: cfat_ and 48 more (account tokens, 53 in all), and the older 40-character user tokens', async () => {
    const shapes = [`cfat_${'aB3dE6gH9-'.repeat(5).slice(0, 48)}`, `cfut_${'Zy_8xW7vU6'.repeat(5).slice(0, 48)}`, 'Qm4-Lp7_Rt2sVw9xYz1Ab5Cd8Ef0Gh3Jk6Mn9Pq2'];
    expect(shapes.map((s) => s.length)).toEqual([53, 53, 40]);
    for (const token of shapes) {
      const cf = fakeCloudflare({ token });
      expect((await run(cf, token)).r).toMatchObject({ ok: true });
    }
  });

  it('quotes, a Bearer in front and spaces pasted along with the token are dropped, and only the token itself is sent', async () => {
    const t = FAKE_TOKEN;
    for (const pasted of [`"${t}"`, `'${t}'`, `“${t}”`, `\`${t}\``, `Bearer ${t}`, `bearer  ${t}`, `"Bearer ${t}"`, `Bearer "${t}"`, `  ${t}\n`]) {
      const cf = fakeCloudflare();
      const r: Result = await createRelaySetup({ worker, fetch: cf.fetch, random: picks('qwerty') }).deploy(pasted);
      expect(r, pasted).toMatchObject({ ok: true });
      expect(cf.state.log.every((l: { auth: string }) => l.auth === `Bearer ${t}`)).toBe(true);
    }
  });

  it('says what is wrong with the account: none the token can see, more than one, or an email not confirmed yet', async () => {
    expect((await run(fakeCloudflare({ accounts: [] }))).r).toEqual({ ok: false, error: 'no_account' });
    const two = fakeCloudflare({ accounts: [{ id: 'a'.repeat(32), name: 'Mine' }, { id: 'b'.repeat(32), name: 'Team' }] });
    expect((await run(two)).r).toEqual({ ok: false, error: 'many_accounts' });
    const unconfirmed = fakeCloudflare({ unverified: true });
    expect((await run(unconfirmed)).r).toEqual({ ok: false, error: 'verify_email' });
    expect(unconfirmed.state.subdomain).toBeNull(); // stopped before picking an address
  });

  it('offline is offline, and what fetch threw (which could quote the request) stays inside', async () => {
    const down = async () => { throw new TypeError(`fetch failed: Bearer ${FAKE_TOKEN}`); };
    const r: Result = await createRelaySetup({ worker, fetch: down }).deploy(FAKE_TOKEN);
    expect(r).toEqual({ ok: false, error: 'offline' });
  });

  it('the stripped relay the app ships runs: it answers the two checks Falcon makes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'falcon-relay-bundle-'));
    writeFileSync(join(dir, 'cloudflare-workers.mjs'), 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }');
    const code = worker.code.replace(/from ['"]cloudflare:workers['"]/, `from ${JSON.stringify(pathToFileURL(join(dir, 'cloudflare-workers.mjs')).href)}`);
    writeFileSync(join(dir, 'index.mjs'), code);
    const mod = await import(/* @vite-ignore */ pathToFileURL(join(dir, 'index.mjs')).href);
    const env = { INBOX: { idFromName: () => 'id', get: () => ({}) } };
    const rooms = await mod.default.fetch(new Request('https://r.example/v1/rooms'), env);
    expect(await rooms.json()).toMatchObject({ rooms: 1 });
    const one = await mod.default.fetch(new Request(`https://r.example/v1/inbox/${'0'.repeat(64)}`, { method: 'POST', body: new Uint8Array([1]) }), env);
    expect(one.status).toBe(400);
    expect(await one.json()).toEqual({ error: 'bad_envelope' });
    expect(typeof mod.Inbox).toBe('function');
    expect(typeof mod.Room).toBe('function');
  });
});
