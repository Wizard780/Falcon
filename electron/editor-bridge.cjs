// The debate-app bridge: other apps on this computer (Nimbus, ebb) send cards into Falcon the way they
// send them into CardMirror. Same shared folder, same handshake files, same four routes and answers, so an
// app that already talks to CardMirror only has to look for falcon.session.json too.
//
//   <bridge dir>/falcon.json          who we are, kept after quit (pickers list closed apps too)
//   <bridge dir>/falcon.session.json  port, token, pid. Gone when Falcon isn't running
//
// GET /ping, GET /docs, POST /insert { target, html, text }, POST /jump { source }. Loopback only, a fresh
// token per launch, requests from a browser page (Origin/Referer) refused, and every app asks the user once.
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const SCHEMA = 2; // CardMirror's bridge schema these answers match
const APP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BODY_MAX = 4 * 1024 * 1024; // a big card with pictures, not a whole file

/** The shared folder every debate app uses (CardMirror's rule, so we all land in the same place). */
function bridgeDir(appData) {
  if (process.env.CARDMIRROR_BRIDGE_DIR) return process.env.CARDMIRROR_BRIDGE_DIR;
  if (process.platform === 'linux') return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'cardmirror-bridge');
  return path.join(appData, 'cardmirror-bridge');
}

function writeSecret(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => { size += c.length; if (size > BODY_MAX) { reject(new Error('too-big')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * `dir`: the bridge folder. `consentFile`: where allow/deny per app is kept. `ask(kind, payload)` hands a
 * request to the page and resolves with its answer: kind is 'ping', 'docs', 'insert', 'jump' or 'consent'.
 */
function createEditorBridge({ dir, appVersion, consentFile, ask }) {
  let server = null, token = '', port = 0;
  const sessionFile = path.join(dir, 'falcon.session.json');

  const decisions = () => { try { const d = JSON.parse(fs.readFileSync(consentFile, 'utf8')); return d && typeof d === 'object' ? d : {}; } catch { return {}; } };
  const decide = (appId, v) => {
    const d = decisions();
    if (v === null) delete d[appId]; else d[appId] = v;
    try { fs.mkdirSync(path.dirname(consentFile), { recursive: true }); writeSecret(consentFile, d); } catch { /* kept for this run only */ }
  };
  const appName = (appId) => {
    try { const id = JSON.parse(fs.readFileSync(path.join(dir, `${appId}.json`), 'utf8')); return typeof id.app === 'string' ? id.app : appId; } catch { return appId; }
  };

  // one prompt per app at a time; requests that come in while it's up wait for the same answer
  const asking = new Map();
  // `then` runs once the user allows: like CardMirror, the insert they were asked about still lands
  async function allowed(appId, then) {
    const d = decisions()[appId];
    if (d === 'allow' || d === 'deny') return d === 'allow';
    if (!asking.has(appId)) {
      asking.set(appId, ask('consent', { appId, name: appName(appId) }).then((a) => {
        const v = a?.answer === 'allow' ? 'allow' : a?.answer === 'deny' ? 'deny' : null;
        if (v) decide(appId, v);
        return v === 'allow';
      }, () => false).finally(() => asking.delete(appId)));
    }
    if (then) void asking.get(appId).then((yes) => { if (yes) then(); });
    return 'pending';
  }

  async function handle(req, res) {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    // a web page can reach 127.0.0.1 too; real apps never send these
    if (req.headers.origin || req.headers.referer) return send(403, { ok: false, error: 'unauthorized' });
    const given = String(req.headers['x-bridge-token'] ?? '');
    if (given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) return send(403, { ok: false, error: 'unauthorized' });
    const url = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && url === '/ping') {
      const r = await ask('ping', {}).catch(() => null);
      return send(200, { ok: true, app: 'falcon', appVersion, schema: SCHEMA, hasActiveDoc: !!r?.hasActiveDoc });
    }
    const route = `${req.method} ${url}`;
    if (!['GET /docs', 'POST /insert', 'POST /jump'].includes(route)) return send(404, { ok: false, error: 'bad-request' });
    let body = {};
    if (req.method === 'POST') {
      try { body = JSON.parse(await readBody(req)); } catch { return send(400, { ok: false, error: 'bad-request' }); }
      if (!body || typeof body !== 'object') return send(400, { ok: false, error: 'bad-request' });
      if (url === '/insert' && typeof body.text !== 'string' && typeof body.html !== 'string') return send(400, { ok: false, error: 'bad-request' });
      if (url === '/jump' && (typeof body.source !== 'string' || !body.source)) return send(400, { ok: false, error: 'bad-request' });
    }
    const appId = String(req.headers['x-app-id'] ?? '').toLowerCase();
    if (!APP_ID.test(appId)) return send(200, { ok: false, error: 'unidentified', message: 'Falcon needs apps to say who they are with an X-App-Id header. Update the sending app.' });
    const kind = url.slice(1);
    const payload = { appId, name: appName(appId), ...(kind === 'docs' ? {} : body) };
    const ok = await allowed(appId, kind === 'docs' ? null : () => ask(kind, payload).catch(() => {}));
    if (ok === 'pending') {
      // same as CardMirror: say it's waiting on the user, and the app tries again after they answer
      return send(200, url === '/docs' ? { ok: true, docs: null, pending: 'consent' } : { ok: true, [url === '/jump' ? 'jumped' : 'inserted']: false, pending: 'consent' });
    }
    if (!ok) return send(200, { ok: false, error: 'not-allowed' });
    let ack;
    try { ack = await ask(kind, payload); } catch { return send(500, { ok: false, error: 'internal' }); }
    if (!ack || typeof ack !== 'object') return send(500, { ok: false, error: 'internal' });
    if (kind === 'docs') return send(200, { ok: true, docs: Array.isArray(ack.docs) ? ack.docs : [] });
    if (ack.ok) return send(200, kind === 'insert' ? { ok: true, inserted: true, docTitle: ack.docTitle } : { ok: true });
    return send(200, { ok: false, error: typeof ack.error === 'string' ? ack.error : 'internal', ...(ack.docTitle ? { docTitle: ack.docTitle } : {}) });
  }

  return {
    async start() {
      if (server) return port;
      token = crypto.randomBytes(24).toString('hex');
      server = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch { /* gone */ } }); });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      port = server.address().port;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try { fs.chmodSync(dir, 0o700); } catch { /* windows */ }
      writeSecret(path.join(dir, 'falcon.json'), { schema: 1, app: 'falcon', appVersion, kind: 'editor' });
      writeSecret(sessionFile, { port, token, pid: process.pid });
      return port;
    },
    /** Quit: drop the session file, but only if it's still ours (a quick relaunch may have written its own). */
    stop() {
      try { if (JSON.parse(fs.readFileSync(sessionFile, 'utf8')).pid === process.pid) fs.unlinkSync(sessionFile); } catch { /* none */ }
      server?.close();
      server = null;
    },
    /** Settings: the apps that asked, and what the user said. */
    apps: () => Object.entries(decisions()).map(([id, v]) => ({ id, name: appName(id), allowed: v === 'allow' })),
    forget: (appId) => decide(appId, null),
    setAllowed: (appId, on) => decide(appId, on ? 'allow' : 'deny'),
  };
}

module.exports = { createEditorBridge, bridgeDir };
