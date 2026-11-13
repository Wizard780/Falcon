// model calls stay in the main process so the key never reaches the page
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_TOKENS = 8192; // thinking spends from this too
const MIN_TOKENS = 1024;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// not every model takes these, and a custom model id can be anything
const hasFallbacks = (m) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(m);
const ROUTER_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const ROUTER_TIMEOUT = 180000; // slow reasoning models are fine, a hung one shouldn't lock the text forever
const tokens = (n) => Math.max(MIN_TOKENS, Math.round(n) || DEFAULT_TOKENS);

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
  // anything else (the SDK saying no before it sends, a bad answer): say what it was, or nobody can fix it
  return { error: e?.message ? `The AI request failed: ${String(e.message).slice(0, 200)}` : 'The AI request failed.' };
}

function routerFailure(code, said, model) {
  if (code === 401) return { error: 'OpenRouter turned down your API key. Check it in Settings > AI.', stop: true };
  if (code === 402) return { error: 'Your OpenRouter account is out of credit.', stop: true };
  if (code === 429) return { error: 'OpenRouter says too many requests. Try again in a minute.' };
  // 404 can also mean your privacy settings ruled out every provider, so keep what it said
  if (code === 404) return { error: said ? `OpenRouter said: ${said}` : `OpenRouter has no model called ${model}. Check Settings > AI.`, stop: true };
  return { error: said ? `OpenRouter said: ${said}` : `OpenRouter error ${code ?? ''}`.trim(), stop: /not a valid model/i.test(said ?? '') || undefined };
}

async function askRouter(post, apiKey, { system, text, model, maxTokens }) {
  const m = typeof model === 'string' ? model.trim() : '';
  if (!m) return { error: 'Paste an OpenRouter model in Settings > AI.', stop: true };
  let res, data;
  try {
    res = await post(`${ROUTER_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/Wizard780/Falcon', 'X-Title': 'Falcon' },
      body: JSON.stringify({ model: m, max_tokens: tokens(maxTokens), messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }),
      signal: AbortSignal.timeout(ROUTER_TIMEOUT),
    });
    data = await res.json().catch((e) => { if (e?.name === 'TimeoutError') throw e; return null; });
  } catch (e) {
    return { error: e?.name === 'TimeoutError' ? 'OpenRouter took too long on this one.' : 'Couldn\'t reach OpenRouter. Are you online?' };
  }
  // a failure can come back as a 200, so the body has to be checked too
  const choice = data?.choices?.[0];
  const err = data?.error ?? choice?.error;
  if (!res.ok || err) return routerFailure(Number(err?.code) || res.status, err?.message, m);
  if (!choice) return { error: 'The AI request failed.' };
  if (choice.finish_reason === 'content_filter') return { error: 'The AI declined to format this one.' };
  // reasoning models can spend it all before they write anything
  if (choice.finish_reason === 'length') return { error: 'The AI ran out of room on this one. Raise max output tokens in Settings > AI.' };
  const content = choice.message?.content;
  return { text: typeof content === 'string' ? content : '' };
}

/** `key(id)` reads a key from the secrets store (electron/secrets.cjs); it never comes from the page. */
function createAi({ key, Client = Anthropic, post = fetch, timeout = ROUTER_TIMEOUT }) {
  return {
    /** `system` is the prompt, `text` what the user picked. Answers { text } or { error, stop }. */
    async ask({ provider, system, text, model, maxTokens }) {
      const router = provider === 'openrouter';
      const apiKey = key(router ? 'openrouter' : 'anthropic');
      if (!apiKey) return { error: `Add your ${router ? 'OpenRouter' : 'Anthropic'} API key in Settings > AI.`, stop: true };
      if (router) return askRouter(post, apiKey, { system, text, model, maxTokens });
      const m = (typeof model === 'string' && model.trim()) || DEFAULT_MODEL; // whatever you pasted goes as is
      const body = {
        model: m,
        max_tokens: tokens(maxTokens),
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: text }],
      };
      if (hasFallbacks(m)) Object.assign(body, { betas: [FALLBACK_BETA], fallbacks: 'default' });
      let late = false;
      try {
        const client = new Client({ apiKey, maxRetries: 2 });
        // streamed, so a big max output tokens works: the SDK refuses those without streaming before it even sends.
        // The SDK's own timeout ends once the answer starts, so a stream that stalls after that is cut off here, as
        // OpenRouter's is: the picked text stays locked until the AI answers
        const stream = client.beta.messages.stream(body);
        const timer = setTimeout(() => { late = true; stream.abort?.(); }, timeout);
        let res;
        try { res = await stream.finalMessage(); } finally { clearTimeout(timer); }
        if (res.stop_reason === 'refusal') return { error: 'The AI declined to format this one.' };
        if (res.stop_reason === 'max_tokens') return { error: 'The AI ran out of room on this one.' };
        return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('') };
      } catch (e) {
        if (late) return { error: 'Anthropic took too long on this one.' };
        return failure(e, m);
      }
    },
  };
}

module.exports = { createAi, DEFAULT_MODEL };
