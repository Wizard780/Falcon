// A stand-in for the parts of Cloudflare's API that electron/relay-setup.cjs uses, answering the way the real one did
// for the same calls (captured against a real account with a throwaway Worker): the { success, errors, messages,
// result } envelope, 9109 for a token it doesn't know, 10007 for an account with no workers.dev subdomain, 10031 for a
// name that's taken, and an upload turned down when its migrations don't start from the script's tag or leave a
// binding without its class. `fetch` serves it in-process; `serve()` over HTTP for the desktop app.
import http from 'node:http';
import { Readable } from 'node:stream';

const ACCOUNT = { id: '0123456789abcdef0123456789abcdef', name: 'Someone@example.com\'s Account', type: 'standard' };

export function fakeCloudflare({ token = 'fake-token-0123456789abcdefghij', accounts = [ACCOUNT], subdomain = null, taken = [], scripts = {}, unverified = false, noPermission = false } = {}) {
  const state = {
    subdomain,
    renamed: false, // a PUT over an existing subdomain renames it: Falcon must never do that
    scripts: new Map(Object.entries(scripts).map(([id, s]) => [id, { tag: s.tag, classes: new Set(s.classes ?? []), workersDev: !!s.workersDev }])),
    log: [], // "METHOD /path" for each request, and the Authorization header it came with
    hold: 0, // ms an upload takes, so a test can look at Falcon while it's under way
  };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const ok = (result) => reply(200, { success: true, errors: [], messages: [], result });
  const fail = (status, code, message) => reply(status, { success: false, errors: [{ code, message }], messages: [], result: null });

  async function handle(req) {
    const url = new URL(req.url), p = url.pathname.replace(/^\/client\/v4/, ''), m = req.method;
    const auth = req.headers.get('authorization') ?? '';
    state.log.push({ call: `${m} ${p}`, auth });
    if (!/^Bearer \S+$/.test(auth)) return fail(400, 6003, 'Invalid request headers');
    if (auth !== `Bearer ${token}`) return fail(403, 9109, 'Invalid access token');
    if (m === 'GET' && p === '/accounts') return ok(accounts);
    const at = /^\/accounts\/([0-9a-f]{32})\/workers(\/.*)$/.exec(p);
    if (!at || !accounts.some((a) => a.id === at[1])) return fail(404, 7003, 'Could not route to the requested resource');
    if (noPermission) return fail(403, 10000, 'Authentication error');
    const rest = at[2];
    if (m === 'GET' && rest === '/scripts') return ok([...state.scripts].map(([id, s]) => ({ id, ...(s.tag ? { migration_tag: s.tag } : {}), has_modules: true })));
    if (m === 'GET' && rest === '/subdomain') return state.subdomain ? ok({ subdomain: state.subdomain }) : fail(404, 10007, 'This subdomain does not exist');
    if (m === 'PUT' && rest === '/subdomain') {
      const { subdomain: want } = await req.json();
      if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(want ?? '')) return fail(400, 10032, 'Invalid subdomain');
      if (taken.includes(want)) return fail(409, 10031, 'Subdomain unavailable');
      if (state.subdomain) state.renamed = true;
      state.subdomain = want;
      return ok({ subdomain: want });
    }
    const script = /^\/scripts\/([a-z0-9-]+)(\/subdomain)?$/.exec(rest);
    if (script && m === 'PUT' && !script[2]) {
      if (unverified) return fail(403, 10034, 'workers.api.error.email_verification_required');
      if (state.hold) await new Promise((r) => setTimeout(r, state.hold));
      const form = await req.formData();
      const meta = JSON.parse(await form.get('metadata').text());
      const main = form.get(meta.main_module);
      if (!main || main.type !== 'application/javascript+module') return fail(400, 10021, 'No such module');
      const was = state.scripts.get(script[1]), classes = new Set(was?.classes ?? []);
      let tag = was?.tag;
      if (meta.migrations) {
        if ((meta.migrations.old_tag ?? undefined) !== tag) return fail(400, 10079, `Migration tag precondition failed; current tag is ${tag ?? 'none'}`);
        for (const step of meta.migrations.steps ?? [meta.migrations]) {
          for (const c of step.new_sqlite_classes ?? []) {
            if (classes.has(c)) return fail(400, 10074, `Cannot apply new-sqlite-class migration to class '${c}' that is already depended on`);
            classes.add(c);
          }
        }
        tag = meta.migrations.new_tag;
      }
      for (const b of meta.bindings ?? []) {
        if (b.type === 'durable_object_namespace' && !classes.has(b.class_name)) return fail(400, 10061, `Cannot create binding for class '${b.class_name}' that is not exported by the script`);
      }
      state.scripts.set(script[1], { tag, classes, workersDev: was?.workersDev ?? false, meta, code: await main.text() });
      return ok({ id: script[1], ...(tag ? { migration_tag: tag } : {}), has_modules: true });
    }
    if (script && m === 'POST' && script[2]) {
      const s = state.scripts.get(script[1]);
      if (!s) return fail(404, 10007, 'This Worker does not exist on your account');
      const body = await req.json();
      s.workersDev = body.enabled === true;
      return ok({ enabled: s.workersDev, previews_enabled: body.previews_enabled === true });
    }
    return fail(404, 7003, 'Could not route to the requested resource');
  }

  return {
    state,
    token,
    fetch: (url, init) => handle(new Request(url, init)),
    /** Over HTTP on 127.0.0.1; resolves to { url, close }. The url is the API base, like https://api.cloudflare.com/client/v4. */
    serve: () => new Promise((resolve) => {
      const server = http.createServer(async (q, s) => {
        const body = q.method === 'GET' || q.method === 'HEAD' ? undefined : Readable.toWeb(q);
        const res = await handle(new Request(`http://127.0.0.1${q.url}`, { method: q.method, headers: q.headers, body, duplex: 'half' }));
        s.writeHead(res.status, Object.fromEntries(res.headers));
        s.end(Buffer.from(await res.arrayBuffer()));
      });
      server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/client/v4`, close: () => server.close() }));
    }),
  };
}
