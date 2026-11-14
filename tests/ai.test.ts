import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAi } = require('../electron/ai.cjs');
const { createSecrets } = require('../electron/secrets.cjs');
const Anthropic = require('@anthropic-ai/sdk');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString().slice(4),
};
const dir = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-ai-')), 'secrets');
function clientWith(...answers: unknown[]) {
  const create = vi.fn(async (_body?: unknown) => { const a = answers.shift(); if (a instanceof Error) throw a; return a; });
  // the app streams, so stream(body).finalMessage() stands in for one create(body)
  return { create, Client: class { beta = { messages: { create, stream: (body: unknown) => ({ finalMessage: () => create(body) }) } }; } };
}
const done = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const req = { system: 's', text: 't', model: '', maxTokens: 8192 };

describe('a stalled Anthropic stream', () => {
  it('is cut off after the deadline, so the picked text does not stay locked', async () => {
    let aborted = false;
    // answers nothing until it's aborted: the headers came, then the stream went quiet
    const Client = class { beta = { messages: { stream: () => { let fail = (_e: Error) => {}; return { finalMessage: () => new Promise((_ok, no) => { fail = no; }), abort: () => { aborted = true; fail(new Error('Request was aborted.')); } }; } } }; };
    const out = await createAi({ key: () => 'k', Client, timeout: 30 }).ask(req);
    expect(aborted).toBe(true);
    expect(out).toEqual({ error: 'Anthropic took too long on this one.' });
  });
});

describe('secrets', () => {
  it('are kept encrypted, listed by name only, and can be removed', () => {
    const d = dir();
    const s = createSecrets({ safeStorage, dir: d });
    expect(s.list()).toEqual([]);
    expect(s.set('anthropic', ' abc ')).toBe(true);
    expect(fs.readFileSync(path.join(d, 'anthropic.bin'), 'utf8')).toBe('enc:abc');
    expect(s.list()).toEqual(['anthropic']);
    expect(s.get('anthropic')).toBe('abc');
    s.remove('anthropic');
    expect(s.list()).toEqual([]);
  });
  it('are never stored in the clear', () => {
    const d = dir();
    expect(createSecrets({ safeStorage: { ...safeStorage, isEncryptionAvailable: () => false }, dir: d }).set('anthropic', 'abc')).toBe(false);
    expect(fs.existsSync(d)).toBe(false);
  });
  it('only take known names, so a name cannot walk out of the folder', () => {
    const s = createSecrets({ safeStorage, dir: dir() });
    expect(s.set('../x', 'abc')).toBe(false);
    expect(s.get('__proto__')).toBe('');
  });
  it('without a key, nothing is sent', async () => {
    const { create, Client } = clientWith();
    expect((await createAi({ key: () => '', Client }).ask(req)).stop).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('OpenRouter', () => {
  const answer = (body: unknown, status = 200) => vi.fn(async (_url: string, _init: { headers: Record<string, string>; body: string }) => new Response(JSON.stringify(body), { status }));
  const ok = (content: unknown, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { role: 'assistant', content } }] });
  const ask = { ...req, provider: 'openrouter', model: 'deepseek/deepseek-chat' };
  const router = (post: unknown, key = (id: string) => (id === 'openrouter' ? 'rk' : '')) => createAi({ key, post });

  it('keeps its key apart from the Anthropic one', () => {
    const s = createSecrets({ safeStorage, dir: dir() });
    s.set('openrouter', 'rk');
    expect([s.list(), s.get('anthropic')]).toEqual([['openrouter'], '']);
  });
  it('sends the prompt, the text and the pasted model with its own key', async () => {
    const post = answer(ok('hi'));
    expect(await router(post).ask(ask)).toEqual({ text: 'hi' });
    const [url, init] = post.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer rk');
    expect(JSON.parse(init.body)).toEqual({ model: 'deepseek/deepseek-chat', max_tokens: 8192, messages: [{ role: 'system', content: 's' }, { role: 'user', content: 't' }] });
  });
  it('sends nothing without a key or a model', async () => {
    const post = answer(ok('hi'));
    expect(await router(post, () => '').ask(ask)).toMatchObject({ stop: true, error: expect.stringContaining('OpenRouter API key') });
    expect(await router(post).ask({ ...ask, model: ' ' })).toMatchObject({ stop: true, error: expect.stringContaining('Paste an OpenRouter model') });
    expect(post).not.toHaveBeenCalled();
  });
  it('never touches Anthropic', async () => {
    const { create, Client } = clientWith();
    await createAi({ key: () => 'k', Client, post: answer(ok('hi')) }).ask(ask);
    expect(create).not.toHaveBeenCalled();
  });
  it('stops a run on a bad key, no credit or a bad model, and not on a busy one', async () => {
    const bad = (code: number, message: string) => router(answer({ error: { code, message } }, code)).ask(ask);
    expect(await bad(401, 'no')).toMatchObject({ stop: true });
    expect(await bad(402, 'no')).toMatchObject({ stop: true, error: expect.stringContaining('credit') });
    expect(await bad(400, 'gpt-x is not a valid model ID')).toMatchObject({ stop: true, error: expect.stringContaining('gpt-x') });
    expect(await bad(404, 'No endpoints found')).toMatchObject({ stop: true, error: expect.stringContaining('No endpoints') });
    expect((await bad(429, 'slow')).stop).toBeUndefined();
    expect(await bad(502, 'model is down')).toEqual({ error: 'OpenRouter said: model is down' });
  });
  it('catches a failure that comes back as a 200', async () => {
    expect((await router(answer({ error: { code: 502, message: 'all providers failed' } })).ask(ask)).error).toContain('all providers failed');
    expect((await router(answer({ choices: [{ error: { code: 500, message: 'died' } }] })).ask(ask)).error).toContain('died');
    expect((await router(answer({})).ask(ask)).error).toBe('The AI request failed.');
  });
  it('says when a model declined or ran out of room', async () => {
    expect((await router(answer(ok('x', 'content_filter'))).ask(ask)).error).toContain('declined');
    expect((await router(answer(ok(null, 'length'))).ask(ask)).error).toContain('Raise max output tokens');
  });
  it('turns no content into an empty answer, not a crash', async () => {
    expect(await router(answer(ok(null))).ask(ask)).toEqual({ text: '' });
  });
  it('says so when it can\'t get through or takes too long', async () => {
    expect((await router(vi.fn(async () => { throw new TypeError('fetch failed'); })).ask(ask)).error).toContain('online');
    const slow = vi.fn(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); });
    expect((await router(slow).ask(ask)).error).toContain('too long');
  });
  it('survives a body that isn\'t JSON', async () => {
    const post = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await router(post).ask(ask)).toEqual({ error: 'OpenRouter error 502' });
  });
});

describe('asking', () => {
  const ready = (Client: unknown) => createAi({ key: () => 'k', Client });
  it('defaults to Opus 5.5 with refusal fallbacks and a cached prompt', async () => {
    const { create, Client } = clientWith(done('hi'));
    expect(await ready(Client).ask(req)).toEqual({ text: 'hi' });
    const b = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(b).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
    expect((b.system as { cache_control: unknown }[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });
  it('leaves off what a smaller model would reject', async () => {
    const { create, Client } = clientWith(done('hi'));
    await ready(Client).ask({ ...req, model: 'claude-haiku-4-5' });
    const b = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(b.model).toBe('claude-haiku-4-5');
    expect(b.fallbacks).toBeUndefined();
    expect(b.betas).toBeUndefined();
  });
  it('sends any pasted model as is and holds max tokens to the minimum', async () => {
    const { create, Client } = clientWith(done('hi'));
    await ready(Client).ask({ ...req, model: ' vendor/some-model:v2 ', maxTokens: 50 });
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({ model: 'vendor/some-model:v2', max_tokens: 1024 });
  });
  it('names a model Anthropic does not have, and passes on what it said about a bad request', async () => {
    const c1 = clientWith(new Anthropic.NotFoundError(404, {}, 'no', new Headers()));
    expect(await ready(c1.Client).ask({ ...req, model: 'gpt-x' })).toMatchObject({ stop: true, error: expect.stringContaining('gpt-x') });
    const c2 = clientWith(new Anthropic.BadRequestError(400, { error: { message: 'max_tokens is too big' } }, 'no', new Headers()));
    expect((await ready(c2.Client).ask(req)).error).toContain('max_tokens is too big');
  });
  it('says what went wrong when the SDK itself gives up, instead of a bare failure', async () => {
    const { Client } = clientWith(new Error('Streaming is required for operations that may take longer than 10 minutes.'));
    expect((await ready(Client).ask(req)).error).toBe('The AI request failed: Streaming is required for operations that may take longer than 10 minutes.');
  });
  it('turns a refusal into a message', async () => {
    const { Client } = clientWith({ stop_reason: 'refusal', content: [] });
    expect((await ready(Client).ask(req)).error).toContain('declined');
  });
  it('says what went wrong, and when retrying is pointless', async () => {
    const bad = new Anthropic.AuthenticationError(401, {}, 'no', new Headers());
    const { Client } = clientWith(bad);
    expect(await ready(Client).ask(req)).toMatchObject({ stop: true });
    const c2 = clientWith(new Anthropic.RateLimitError(429, {}, 'slow', new Headers()));
    const r = await ready(c2.Client).ask(req);
    expect(r.error).toContain('too many');
    expect(r.stop).toBeUndefined();
  });
});
