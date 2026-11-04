// The debate-app bridge (electron/editor-bridge.cjs): Nimbus and friends call it like CardMirror's.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { createEditorBridge } = createRequire(import.meta.url)('../electron/editor-bridge.cjs');

type Ask = (kind: string, payload: Record<string, unknown>) => Promise<unknown>;
let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; });

async function setup(ask: Ask) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-bridge-'));
  const b = createEditorBridge({ dir, appVersion: '9.9.9', consentFile: path.join(dir, 'consent', 'apps.json'), ask });
  await b.start();
  stop = () => b.stop();
  const session = JSON.parse(fs.readFileSync(path.join(dir, 'falcon.session.json'), 'utf8'));
  const call = async (method: string, route: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`http://127.0.0.1:${session.port}${route}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'X-Bridge-Token': session.token, 'X-App-Id': 'nimbus', ...headers },
    });
    return { status: r.status, json: await r.json() };
  };
  return { dir, b, session, call };
}

const page = (over: Partial<Record<string, (p: Record<string, unknown>) => unknown>> = {}): Ask => async (kind, p) => {
  const f = over[kind];
  if (f) return f(p);
  if (kind === 'consent') return { answer: 'allow' };
  if (kind === 'ping') return { hasActiveDoc: true };
  if (kind === 'docs') return { docs: [{ target: 'falcon-1', title: 'Speech', focusedWindow: false, isSpeech: true }] };
  if (kind === 'insert') return p.target === 'falcon-1' ? { ok: true, docTitle: 'Speech' } : { ok: false, error: 'target-not-found' };
  return { ok: true };
};

describe('handshake files', () => {
  it('writes falcon.json and a private session file, and only drops the session file on quit', async () => {
    const { dir, b, session } = await setup(page());
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'falcon.json'), 'utf8'))).toEqual({ schema: 1, app: 'falcon', appVersion: '9.9.9', kind: 'editor' });
    expect(session.pid).toBe(process.pid);
    expect(session.token).toMatch(/^[0-9a-f]{48}$/);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'falcon.session.json')).mode & 0o777).toBe(0o600);
    b.stop(); stop = null;
    expect(fs.existsSync(path.join(dir, 'falcon.session.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'falcon.json'))).toBe(true);
  });
  it('leaves a newer launch\'s session file alone', async () => {
    const { dir, b, session } = await setup(page());
    fs.writeFileSync(path.join(dir, 'falcon.session.json'), JSON.stringify({ ...session, pid: process.pid + 1 }));
    b.stop(); stop = null;
    expect(fs.existsSync(path.join(dir, 'falcon.session.json'))).toBe(true);
  });
});

describe('routes, the way CardMirror answers them', () => {
  it('ping says who it is', async () => {
    const { call } = await setup(page());
    expect((await call('GET', '/ping')).json).toEqual({ ok: true, app: 'falcon', appVersion: '9.9.9', schema: 2, hasActiveDoc: true });
  });
  it('turns away a wrong token, a browser page, and an app that won\'t say who it is', async () => {
    const { call } = await setup(page());
    expect((await call('GET', '/docs', undefined, { 'X-Bridge-Token': 'nope' })).status).toBe(403);
    expect((await call('GET', '/docs', undefined, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('GET', '/docs', undefined, { 'X-App-Id': '' })).json.error).toBe('unidentified');
  });
  it('lists docs and inserts into the one named, and a closed doc is target-not-found', async () => {
    const { call } = await setup(page());
    // first contact asks the user
    expect((await call('GET', '/docs')).json).toEqual({ ok: true, docs: null, pending: 'consent' });
    await new Promise((r) => setTimeout(r, 20));
    expect((await call('GET', '/docs')).json.docs[0]).toEqual({ target: 'falcon-1', title: 'Speech', focusedWindow: false, isSpeech: true });
    expect((await call('POST', '/insert', { target: 'falcon-1', html: '<p>x</p>', text: 'x' })).json).toEqual({ ok: true, inserted: true, docTitle: 'Speech' });
    expect((await call('POST', '/insert', { target: 'falcon-7', html: '<p>x</p>', text: 'x' })).json).toEqual({ ok: false, error: 'target-not-found' });
    expect((await call('POST', '/insert', { target: 'falcon-1' })).status).toBe(400);
  });
  it('an insert that asked first still lands once the user allows', async () => {
    const got: unknown[] = [];
    let allow: (v: unknown) => void = () => {};
    const { call } = await setup(page({ consent: () => new Promise((r) => { allow = r; }), insert: (p) => { got.push(p.text); return { ok: true }; } }));
    expect((await call('POST', '/insert', { target: 'falcon-1', html: '<p>card</p>', text: 'card' })).json).toEqual({ ok: true, inserted: false, pending: 'consent' });
    expect(got).toEqual([]);
    allow({ answer: 'allow' });
    await new Promise((r) => setTimeout(r, 20));
    expect(got).toEqual(['card']);
  });
  it('remembers no, and Settings can take it back', async () => {
    const { b, call } = await setup(page({ consent: () => ({ answer: 'deny' }) }));
    await call('GET', '/docs');
    await new Promise((r) => setTimeout(r, 20));
    expect((await call('POST', '/insert', { target: 'falcon-1', text: 'x' })).json).toEqual({ ok: false, error: 'not-allowed' });
    expect(b.apps()).toEqual([{ id: 'nimbus', name: 'nimbus', allowed: false }]);
    b.setAllowed('nimbus', true);
    expect((await call('POST', '/insert', { target: 'falcon-1', text: 'x' })).json.ok).toBe(true);
  });
  it('jump goes to the page', async () => {
    const { call } = await setup(page({ consent: () => ({ answer: 'allow' }), jump: (p) => (p.source === 'falcon1.ok' ? { ok: true } : { ok: false, error: 'not-found' }) }));
    await call('GET', '/docs'); await new Promise((r) => setTimeout(r, 20));
    expect((await call('POST', '/jump', { source: 'falcon1.ok' })).json).toEqual({ ok: true });
    expect((await call('POST', '/jump', { source: 'falcon1.gone' })).json).toEqual({ ok: false, error: 'not-found' });
  });
});
