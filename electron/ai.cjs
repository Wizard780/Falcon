// model calls stay in the main process so the key never reaches the page
const fs = require('node:fs');
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_TOKENS = 8192; // thinking spends from this too
const MIN_TOKENS = 1024;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// not every model takes these, and a custom model id can be anything
const hasFallbacks = (m) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(m);

function failure(e, model) {
  if (e instanceof Anthropic.AuthenticationError) return { error: 'Anthropic turned down your API key. Check it in Settings > AI.', stop: true };
  if (e instanceof Anthropic.NotFoundError) return { error: `Anthropic has no model called ${model}, or your key can't use it. Check Settings > AI.`, stop: true };
  if (e instanceof Anthropic.RateLimitError) return { error: 'Anthropic says too many requests. Try again in a minute.' };
  if (e instanceof Anthropic.APIConnectionError) return { error: 'Couldn\'t reach Anthropic. Are you online?' };
  if (e instanceof Anthropic.APIError) {
    const out = /credit balance/i.test(e.message ?? '');
    if (out) return { error: 'Your Anthropic account is out of credit.', stop: true };
    // a pasted model can have its own limits, so pass on what Anthropic said
    const said = e.error?.error?.message;
    return { error: said ? `Anthropic said: ${said}` : `Anthropic error ${e.status ?? ''}`.trim() };
  }
  return { error: 'The AI request failed.' };
}

function createAi({ safeStorage, file, Client = Anthropic }) {
  const key = () => {
    try { return safeStorage.decryptString(fs.readFileSync(file)); } catch { return ''; }
  };
  return {
    hasKey: () => !!key(),
    /** An empty key removes it. False when this machine can't encrypt it: we don't keep it in the clear. */
    setKey(k) {
      const v = typeof k === 'string' ? k.trim() : '';
      if (!v) { fs.rmSync(file, { force: true }); return true; }
      if (!safeStorage.isEncryptionAvailable()) return false;
      fs.writeFileSync(file, safeStorage.encryptString(v), { mode: 0o600 });
      return true;
    },
    /** `system` is the prompt, `text` what the user picked. Answers { text } or { error, stop }. */
    async ask({ system, text, model, maxTokens }) {
      const apiKey = key();
      if (!apiKey) return { error: 'Add your Anthropic API key in Settings > AI.', stop: true };
      const m = (typeof model === 'string' && model.trim()) || DEFAULT_MODEL; // whatever you pasted goes as is
      const body = {
        model: m,
        max_tokens: Math.max(MIN_TOKENS, Math.round(maxTokens) || DEFAULT_TOKENS),
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: text }],
      };
      if (hasFallbacks(m)) Object.assign(body, { betas: [FALLBACK_BETA], fallbacks: 'default' });
      try {
        const client = new Client({ apiKey, maxRetries: 2 });
        const res = await client.beta.messages.create(body);
        if (res.stop_reason === 'refusal') return { error: 'The AI declined to format this one.' };
        if (res.stop_reason === 'max_tokens') return { error: 'The AI ran out of room on this one.' };
        return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('') };
      } catch (e) {
        return failure(e, m);
      }
    },
  };
}

module.exports = { createAi, DEFAULT_MODEL };
