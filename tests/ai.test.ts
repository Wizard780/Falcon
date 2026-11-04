import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAi } = require('../electron/ai.cjs');
const Anthropic = require('@anthropic-ai/sdk');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString().slice(4),
};
const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-ai-')), 'key.bin');
function clientWith(...answers: unknown[]) {
  const create = vi.fn(async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a; });
  return { create, Client: class { beta = { messages: { create } }; } };
}
const done = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const req = { system: 's', text: 't', model: '', maxTokens: 8192 };

describe('the API key', () => {
  it('is kept encrypted and can be removed', () => {
    const f = file();
    const ai = createAi({ safeStorage, file: f });
    expect(ai.hasKey()).toBe(false);
    expect(ai.setKey(' abc ')).toBe(true);
    expect(fs.readFileSync(f, 'utf8')).toBe('enc:abc');
    expect(ai.hasKey()).toBe(true);
    ai.setKey('');
    expect(ai.hasKey()).toBe(false);
  });
  it('is never stored in the clear', () => {
    const f = file();
    expect(createAi({ safeStorage: { ...safeStorage, isEncryptionAvailable: () => false }, file: f }).setKey('abc')).toBe(false);
    expect(fs.existsSync(f)).toBe(false);
  });
  it('without one, nothing is sent', async () => {
    const { create, Client } = clientWith();
    expect((await createAi({ safeStorage, file: file(), Client }).ask(req)).stop).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('asking', () => {
  const ready = (Client: unknown) => { const ai = createAi({ safeStorage, file: file(), Client }); ai.setKey('k'); return ai; };
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
  it('ignores a malformed model and holds max tokens to the minimum', async () => {
    const { create, Client } = clientWith(done('hi'));
    await ready(Client).ask({ ...req, model: 'not a model!', maxTokens: 50 });
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 1024 });
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
