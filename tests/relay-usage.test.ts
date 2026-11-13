import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, tick } from './app-harness';
import { RELAY, fakeRelay } from './collab-relay-fake';

// What's left of the relay's free day: the maths (relay.ts), and when the app asks the relay (service.ts). The relay's
// own counting is relay/test/relay.test.mjs.
const { FREE_DAY, nextUtcMidnight, percentLeft, usage, usageView, utcDay } = await import('../src/collab/relay');
const collab = await import('../src/collab/service');
const { makeIdentity } = await import('../src/collab/crypto');
const { encodeCode } = await import('../src/collab/code');
const { schema } = await import('../src/editor/schema');
const { P, setPref } = await import('../src/editor/prefs');

const NOW = Date.UTC(2026, 10, 13, 15, 0);
const today = utcDay(NOW);
const read = (p: Partial<{ day: string; requests: number; objects: number; rows: number; msgs: number }> = {}) => ({ day: today, requests: 0, objects: 0, rows: 0, msgs: 0, ...p });

describe('percent left', () => {
  it('is the lowest of the limits, rounded down', () => {
    expect(percentLeft(read(), NOW)).toBe(100);
    expect(percentLeft(read({ requests: 1 }), NOW)).toBe(99); // anything used is under 100
    expect(percentLeft(read({ requests: 19_000, objects: 5_000, rows: 40_000 }), NOW)).toBe(60); // rows decide
    expect(percentLeft(read({ requests: 90_500, rows: 10 }), NOW)).toBe(9); // requests decide
    expect(percentLeft(read({ rows: 19_998 }), NOW)).toBe(80);
    expect(percentLeft(read({ rows: 20_001 }), NOW)).toBe(79);
  });

  it('counts socket messages 20 to 1 as Durable Object requests', () => {
    expect(percentLeft(read({ objects: 10_000, msgs: 400_000 }), NOW)).toBe(70); // 10,000 + 20,000 of 100,000
    expect(percentLeft(read({ msgs: 19 }), NOW)).toBe(99);
  });

  it('is clamped to 0 to 100', () => {
    expect(percentLeft(read({ rows: FREE_DAY.rows * 3 }), NOW)).toBe(0);
    expect(percentLeft(read({ objects: FREE_DAY.objects }), NOW)).toBe(0);
  });

  it('has nothing to say about another day', () => {
    expect(percentLeft(read({ day: '2026-11-12' }), NOW)).toBeNull();
    // just past midnight UTC, yesterday's reading is stale
    expect(percentLeft(read(), Date.UTC(2026, 10, 14, 0, 0, 1))).toBeNull();
  });
});

describe('what the bar shows', () => {
  const st = (p: Partial<Parameters<typeof usageView>[0]> = {}) => ({ relay: RELAY, pausedUntil: 0, usage: null, ...p });
  it('nothing with no relay, and the bar\'s room while the first reading comes', () => {
    expect(usageView(st({ relay: '' }), NOW)).toEqual({ kind: 'none' });
    expect(usageView(st(), NOW)).toEqual({ kind: 'loading' });
    // a reading of the last relay is not this one's
    expect(usageView(st({ usage: { relay: 'https://other.test', got: read() } }), NOW)).toEqual({ kind: 'loading' });
  });
  it('what\'s left, low at 15% or under', () => {
    expect(usageView(st({ usage: { relay: RELAY, got: read({ rows: 19_000 }) } }), NOW)).toEqual({ kind: 'left', left: 81, low: false });
    expect(usageView(st({ usage: { relay: RELAY, got: read({ rows: 85_000 }) } }), NOW)).toEqual({ kind: 'left', left: 15, low: true });
    expect(usageView(st({ usage: { relay: RELAY, got: read({ rows: 84_999 }) } }), NOW)).toEqual({ kind: 'left', left: 15, low: true });
    expect(usageView(st({ usage: { relay: RELAY, got: read({ rows: 84_000 }) } }), NOW)).toEqual({ kind: 'left', left: 16, low: false });
  });
  it('paused beats the counts: a send that hit the limit, the count itself over it, or nothing left', () => {
    const until = nextUtcMidnight(NOW);
    expect(usageView(st({ pausedUntil: until, usage: { relay: RELAY, got: read() } }), NOW)).toEqual({ kind: 'paused', until });
    expect(usageView(st({ usage: { relay: RELAY, got: 'daily_limit' } }), NOW)).toEqual({ kind: 'paused', until });
    expect(usageView(st({ usage: { relay: RELAY, got: read({ objects: 100_000 }) } }), NOW)).toEqual({ kind: 'paused', until });
    // a pause that has run out is over
    expect(usageView(st({ pausedUntil: NOW - 1, usage: { relay: RELAY, got: read() } }), NOW)).toEqual({ kind: 'left', left: 100, low: false });
  });
  it('an older relay (404) asks to be updated; one that can\'t be reached, or a stale reading, shows nothing extra', () => {
    expect(usageView(st({ usage: { relay: RELAY, got: 'none' } }), NOW)).toEqual({ kind: 'old' });
    expect(usageView(st({ usage: { relay: RELAY, got: 'unreachable' } }), NOW)).toEqual({ kind: 'none' });
    expect(usageView(st({ usage: { relay: RELAY, got: read({ day: '2026-11-12' }) } }), NOW)).toEqual({ kind: 'none' });
  });
});

describe('usage(): GET /v1/usage', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const answering = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
  it('reads the tallies, and tells an older relay, a spent day and a failure apart', async () => {
    answering(200, { usage: 1, day: today, requests: 5, objects: 4, rows: 3, msgs: 2 });
    expect(await usage(RELAY)).toEqual({ day: today, requests: 5, objects: 4, rows: 3, msgs: 2 });
    answering(404, { error: 'not_found' }); expect(await usage(RELAY)).toBe('none');
    answering(429, { error: 'daily_limit' }); expect(await usage(RELAY)).toBe('daily_limit');
    answering(503, { error: 'relay_error' }); expect(await usage(RELAY)).toBe('unreachable');
    answering(200, { usage: 1, day: today, requests: 'lots' }); expect(await usage(RELAY)).toBe('unreachable');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); })); expect(await usage(RELAY)).toBe('unreachable');
  });
});

describe('when the app asks', () => {
  let relay: ReturnType<typeof fakeRelay>, stop = () => {};
  beforeEach(async () => {
    relay = fakeRelay(['https://theirs.test']);
    relay.install();
    await new Promise<void>((r, j) => { const q = indexedDB.deleteDatabase('falcon-collab'); q.onsuccess = () => r(); q.onerror = () => j(q.error); });
    await freshStorage({ 'falcon.relayUrl': RELAY });
    stop = collab.start(true);
    for (let i = 0; i < 100 && collab.current().status !== 'ready'; i++) await tick(20);
  });
  afterEach(() => { stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const asks = () => relay.usageAsks.length;
  const settle = async () => { for (let i = 0; i < 10; i++) await tick(10); };

  it('never by itself: only when a bar opens, and not again while time passes', async () => {
    await settle();
    expect(asks()).toBe(0); // loading card sharing asks nothing
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    const close = collab.watchUsage();
    await vi.advanceTimersByTimeAsync(10);
    expect(asks()).toBe(1);
    expect(collab.current().usage).toMatchObject({ relay: RELAY, got: { requests: 0 } });
    await vi.advanceTimersByTimeAsync(3 * 3600_000); // hours with the bar up: no timer asks again
    expect(asks()).toBe(1);
    close();
  });

  it('asks at most once more for any number of asks while one is out', async () => {
    const closes = [collab.watchUsage(), collab.watchUsage(), collab.watchUsage()];
    collab.usageChanged(); collab.usageChanged();
    await settle();
    expect(asks()).toBe(2);
    for (const c of closes) c();
  });

  it('after a send through my relay while a bar shows; not after one through theirs, nor with no bar', async () => {
    const card = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('A card')])]).content;
    const mine = { code: encodeCode((await makeIdentity()).pub), name: 'Ana' };
    const theirs = { code: encodeCode((await makeIdentity()).pub, 'https://theirs.test'), name: 'Bo' };
    expect((await collab.send(mine, card)).ok).toBe(true); // no bar up
    await settle();
    expect(asks()).toBe(0);
    const close = collab.watchUsage();
    await settle();
    expect(asks()).toBe(1);
    expect((await collab.send(mine, card)).ok).toBe(true);
    await settle();
    expect(asks()).toBe(2);
    expect(collab.current().usage).toMatchObject({ got: { requests: 2 } }); // the number moved with the send
    expect((await collab.send(theirs, card)).ok).toBe(true);
    await settle();
    expect(asks()).toBe(2);
    close();
    expect((await collab.send(mine, card)).ok).toBe(true);
    await settle();
    expect(asks()).toBe(2);
  });

  it('when the relay address changes while a bar shows, and the old reading goes', async () => {
    const close = collab.watchUsage();
    await settle();
    relay.usage(404);
    setPref(P.relayUrl, 'https://theirs.test');
    expect(collab.current().usage).toBeNull();
    await settle();
    expect(relay.usageAsks).toEqual([`${RELAY}/v1/usage`, 'https://theirs.test/v1/usage']);
    expect(collab.current().usage).toEqual({ relay: 'https://theirs.test', got: 'none' });
    close();
  });

  it('a reading of another day is asked for once more, and not shown', async () => {
    relay.usage({ day: '2000-01-01' });
    const close = collab.watchUsage();
    await settle();
    expect(asks()).toBe(2);
    expect(usageView(collab.current()).kind).toBe('none');
    close();
  });
});
