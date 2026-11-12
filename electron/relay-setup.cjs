// Puts the user's own relay (relay/) on their Cloudflare account through Cloudflare's API, the way `wrangler deploy`
// does, so setting one up needs no terminal, Node or npm. The relay comes prebuilt with the app (dist/relay-worker.json,
// made by vite.config.ts). The token is used for this one run and then dropped: never kept on disk, never logged,
// never sent to the page, and never put in an answer or an error.
const API = 'https://api.cloudflare.com/client/v4';

// What Cloudflare answers for a token it won't take: a malformed or unknown one is 6003 (6111 in its chain), one
// without a permission it needs is 10000. 9106/9107/9109 and 1000 are the older shapes of the same.
const BAD_TOKEN = new Set([1000, 6003, 6111, 9106, 9107, 9109, 10000]);
const NO_SUBDOMAIN = 10007; // the account has no workers.dev subdomain yet (wrangler checks the same code)
const TAKEN = 10031; // that workers.dev subdomain belongs to someone else

/** Why a run stopped: a code the page turns into words, and, for one Cloudflare refused, what Cloudflare said. */
class Stop extends Error {
  constructor(code, said) { super(code); this.code = code; this.said = said; }
}

/** The migration steps the script still needs, from the tag it has now (wrangler's rule), or undefined for none. */
function migrationsFor(list, tag) {
  const steps = (from) => list.slice(from).map(({ tag: _tag, ...step }) => step);
  const last = list[list.length - 1].tag;
  if (!tag) return { new_tag: last, steps: steps(0) };
  const at = list.findIndex((m) => m.tag === tag);
  // a tag this Falcon doesn't know is a newer Falcon's relay: putting this older one over it would break it
  if (at < 0) throw new Stop('newer_relay');
  return at === list.length - 1 ? undefined : { old_tag: tag, new_tag: last, steps: steps(at + 1) };
}

/**
 * `worker` is dist/relay-worker.json. `api` and `relayUrl` are for tests only (main.cjs passes them on only for a
 * headless test run): a stand-in for Cloudflare's API, and the address to report instead of the workers.dev one.
 */
function createRelaySetup({ worker, fetch = globalThis.fetch, api = API, relayUrl = null, random = Math.random }) {
  return {
    /** Answers { ok: true, url, created } or { ok: false, error, said? }. `step` is told 'account', 'upload' and 'address' as each starts. */
    async deploy(token, step = () => {}) {
      const name = worker.name;
      const call = async (method, path, { json, form, headers } = {}) => {
        let r;
        try {
          r = await fetch(`${api}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
            body: json ? JSON.stringify(json) : form,
            signal: AbortSignal.timeout(60_000),
          });
        } catch { throw new Stop('offline'); } // no message passed on: it could quote the request
        let body = null;
        try { body = await r.json(); } catch { /* not JSON: a proxy's page, or an outage */ }
        if (body?.success === true) return { ok: true, result: body.result };
        const errors = Array.isArray(body?.errors) ? body.errors : [];
        const codes = errors.flatMap((e) => [e?.code, ...(Array.isArray(e?.error_chain) ? e.error_chain.map((c) => c?.code) : [])]);
        return { ok: false, status: r.status, codes, said: typeof errors[0]?.message === 'string' ? errors[0].message.slice(0, 300) : '' };
      };
      // a refusal every step can get: the token, an email not confirmed yet, or anything else Cloudflare says
      const must = (res) => {
        if (res.ok) return res.result;
        if (res.status === 401 || res.codes.some((c) => BAD_TOKEN.has(c))) throw new Stop('bad_token');
        if (/email_verification_required|verify your (account's )?email/i.test(res.said)) throw new Stop('verify_email');
        throw new Stop('cloudflare', res.said);
      };

      try {
        // a token is printable ASCII with no spaces; anything else would never be sent (and could end up in an error)
        if (typeof token !== 'string' || !/^[\x21-\x7e]{20,400}$/.test(token)) throw new Stop('bad_token');
        step('account');
        const accounts = must(await call('GET', '/accounts?per_page=50'));
        if (!Array.isArray(accounts) || !accounts.length) throw new Stop('no_account'); // no Account Settings permission
        if (accounts.length > 1) throw new Stop('many_accounts');
        const at = `/accounts/${encodeURIComponent(accounts[0].id)}/workers`;
        const scripts = must(await call('GET', `${at}/scripts`));
        const tag = (Array.isArray(scripts) ? scripts : []).find((s) => s?.id === name)?.migration_tag;
        const migrations = migrationsFor(worker.migrations, tag);

        // the relay first, as wrangler does it: a bad token or an unconfirmed email stops here, before an address is picked
        step('upload');
        const form = new FormData();
        form.set('metadata', new Blob([JSON.stringify({
          main_module: 'index.js',
          compatibility_date: worker.compatibility_date,
          bindings: worker.bindings.map((b) => ({ type: 'durable_object_namespace', name: b.name, class_name: b.class_name })),
          ...(migrations && { migrations }),
          observability: worker.observability,
        })], { type: 'application/json' }));
        form.set('index.js', new Blob([worker.code], { type: 'application/javascript+module' }), 'index.js');
        must(await call('PUT', `${at}/scripts/${name}`, { form }));

        step('address');
        // The account's workers.dev subdomain. Only Cloudflare saying there is none (10007) makes a new one: a PUT
        // here renames one that exists, which would move every Worker the account has, this relay too.
        const now = await call('GET', `${at}/subdomain`);
        let subdomain = now.ok ? now.result?.subdomain : null, created = false;
        if (!now.ok && !now.codes.includes(NO_SUBDOMAIN)) must(now);
        for (let i = 0; !subdomain && i < 5; i++) {
          const pick = `falcon-${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(random() * 26))).join('')}`;
          const made = await call('PUT', `${at}/subdomain`, { json: { subdomain: pick } });
          if (made.ok) { subdomain = made.result?.subdomain || pick; created = true; } else if (!made.codes.includes(TAKEN)) must(made);
        }
        if (!subdomain) throw new Stop('no_subdomain');
        must(await call('POST', `${at}/scripts/${name}/subdomain`, {
          json: { enabled: true, previews_enabled: false },
          headers: { 'Cloudflare-Workers-Script-Api-Date': '2025-08-01' }, // what wrangler sends with this call
        }));
        return { ok: true, url: relayUrl ?? `https://${name}.${subdomain}.workers.dev`, created };
      } catch (e) {
        if (e instanceof Stop) return { ok: false, error: e.code, ...(e.said ? { said: e.said } : {}) };
        return { ok: false, error: 'failed' }; // never e.message: nothing from inside a run leaves it
      }
    },
  };
}

module.exports = { createRelaySetup, migrationsFor };
