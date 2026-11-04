// @vitest-environment node
import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain .mjs test helper
import { startMock } from './caselist-mock.mjs';

// electron/caselist.cjs against the local stand-in, with real HTTP. Nothing here reaches openCaselist.
const require = createRequire(import.meta.url);
const { createCaselist, roundBody } = require('../electron/caselist.cjs');

type Mock = Awaited<ReturnType<typeof startMock>>;
const memory = () => { let s: unknown = null; return { read: () => s, write: (v: unknown) => { s = v; }, clear: () => { s = null; } }; };
const TEAM = { caselist: 'hspf26', school: 'Jericho', team: 'XG' };
const ROUND = { tournament: ' 3---Blake ', side: 'Con', round: '3', opponent: 'Sharon SS', judge: 'Raj Khan', report: '1NC---Offshoring DA, Econ DA' };
const DOC = new Uint8Array([80, 75, 3, 4]);

let mock: Mock;
beforeAll(async () => { mock = await startMock(); });
afterAll(() => mock.close());
beforeEach(() => { mock.state.posts.length = 0; });
const signedIn = async () => { const store = memory(); const cl = createCaselist({ base: mock.url, store }); await cl.login({ username: 'a@b.c', password: 'test-pass' }); return { cl, store }; };

describe('the round body', () => {
  it('is what Verbatim sends: trimmed fields, A or N, the doc as base64 under opensource', () => {
    expect(roundBody(ROUND, '1NC.docx', DOC)).toEqual({
      tournament: '3---Blake', side: 'N', round: '3', opponent: 'Sharon SS', judge: 'Raj Khan', report: '1NC---Offshoring DA, Econ DA',
      opensource: 'UEsDBA==', filename: '1NC.docx',
    });
    expect(roundBody({ ...ROUND, side: 'Pro' }, 'x.docx', DOC).side).toBe('A');
  });
  it('turns away a round the page could not show', () => {
    for (const bad of [{ tournament: ' ' }, { round: '' }, { side: 'both' }]) expect(() => roundBody({ ...ROUND, ...bad }, 'x.docx', DOC)).toThrow('bad_round');
    expect(() => roundBody(ROUND, '', DOC)).toThrow('no_file');
    expect(() => roundBody(ROUND, 'x.docx', new Uint8Array())).toThrow('no_file');
    expect(() => roundBody(ROUND, 'x.docx', new Uint8Array(10 * 1024 * 1024 + 1))).toThrow('too_large');
  });
});

describe('openCaselist engine', () => {
  it('keeps the token, never the password', async () => {
    const store = memory();
    const cl = createCaselist({ base: mock.url, store });
    expect(cl.signedIn()).toBe(false);
    await cl.login({ username: 'a@b.c', password: 'test-pass' });
    expect(store.read()).toEqual({ token: 'mock-token', expires: '2027-01-01' });
    expect(JSON.stringify(store.read())).not.toContain('test-pass');
    cl.logout();
    expect(cl.signedIn()).toBe(false);
  });
  it('says so on a wrong password, and stores nothing', async () => {
    const store = memory();
    await expect(createCaselist({ base: mock.url, store }).login({ username: 'a@b.c', password: 'nope' })).rejects.toThrow('bad_login');
    expect(store.read()).toBeNull();
  });
  it('needs a sign-in, and a 401 forgets the stale one', async () => {
    const store = memory();
    const cl = createCaselist({ base: mock.url, store });
    await expect(cl.rounds()).rejects.toThrow('not_logged_in');
    store.write({ token: 'old' });
    await expect(cl.rounds()).rejects.toThrow('login_expired');
    expect(store.read()).toBeNull();
  });
  it('reads rounds, open caselists, schools, teams and the team page', async () => {
    const { cl } = await signedIn();
    const r = await cl.rounds();
    expect(r.current).toBe(true);
    expect(r.rounds[0]).toMatchObject({ tournament: 'Blake', round: '3', side: 'Con', opponent: 'Sharon SS', judge: 'Raj Khan' });
    expect((await cl.caselists()).map((c: { name: string }) => c.name)).toEqual(['hspf26', 'hsld26']); // the archived year is out
    expect((await cl.schools('hspf26'))[0]).toEqual({ name: 'Jericho', label: 'Jericho' });
    expect((await cl.teams('hspf26', 'Jericho'))[0]).toEqual({ name: 'XG', label: 'Jericho XG' });
    expect((await cl.posted(TEAM))[1]).toEqual({ tournament: '2---Fullerton', round: '2', side: 'A' });
  });
  it('posts the round to the team\'s page, doc attached', async () => {
    const { cl } = await signedIn();
    await expect(cl.post(TEAM, ROUND, '1NC.docx', DOC)).resolves.toEqual({ filename: '1NC.docx' });
    expect(mock.state.posts).toEqual([expect.objectContaining({ path: '/caselists/hspf26/schools/Jericho/teams/XG/rounds', tournament: '3---Blake', side: 'N', opensource: 'UEsDBA==', filename: '1NC.docx' })]);
  });
  it('anything but a clear answer on a post is upload_unknown: check the page before posting twice', async () => {
    const store = memory();
    store.write({ token: 't' });
    const answer = (res: unknown) => createCaselist({ base: 'http://x', store, fetchImpl: vi.fn(async () => res) }).post(TEAM, ROUND, 'x.docx', DOC);
    await expect(answer({ status: 500 })).rejects.toThrow('upload_unknown');
    await expect(answer({ status: 302 })).rejects.toThrow('upload_unknown');
    await expect(createCaselist({ base: 'http://x', store, fetchImpl: vi.fn(async () => { throw new TypeError('offline'); }) }).post(TEAM, ROUND, 'x.docx', DOC)).rejects.toThrow('upload_unknown');
    await expect(answer({ status: 400, json: async () => ({ message: 'Bad side' }) })).rejects.toThrow('caselist_rejected:Bad side');
  });
  it('won\'t post without a team', () => {
    const cl = createCaselist({ base: 'http://x', store: memory() });
    expect(() => cl.post({ caselist: 'hspf26', school: '', team: '' }, ROUND, 'x.docx', DOC)).toThrow('no_team');
  });
});
