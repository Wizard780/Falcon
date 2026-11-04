// openCaselist from the main process: sign in, your Tabroom rounds, your team's page, post a round.
// The engine is the debate-uploader plugin's (lib/caselist.mjs). The password lives only in the login
// request; `store` keeps the {token, expires} that comes back. Nothing here imports Electron, so tests
// run it with a fake fetch.
const CASELIST_BASE = 'https://api.opencaselist.com/v1';
const MAX_BYTES = 10 * 1024 * 1024;

const seg = (s) => encodeURIComponent(String(s ?? ''));
const text = (s) => String(s ?? '').trim();

function normalizeSide(side) {
  const s = text(side).toLowerCase();
  if (['a', 'aff', 'pro'].includes(s)) return 'A';
  if (['n', 'neg', 'con'].includes(s)) return 'N';
  return null;
}

/** What openCaselist takes for a round. The body matches Verbatim's UploadToCaselist (opensource + filename). */
function roundBody({ tournament, side, round, opponent, judge, report }, filename, bytes) {
  const t = text(tournament), r = text(round), sd = normalizeSide(side);
  if (!t || !r || !sd) throw new Error('bad_round');
  if (!filename || !bytes?.length) throw new Error('no_file');
  if (bytes.length > MAX_BYTES) throw new Error('too_large');
  return {
    tournament: t, side: sd, round: r, opponent: text(opponent), judge: text(judge), report: text(report),
    opensource: Buffer.from(bytes).toString('base64'), filename,
  };
}

const roundShape = (r) => ({
  id: r.id, tournament: r.tournament ?? '', round: r.round ?? '', side: r.side ?? '',
  opponent: r.opponent ?? '', judge: r.judge ?? '', start_time: r.start_time ?? null,
});
const choice = (x) => {
  const name = String(x?.name ?? x?.slug ?? '');
  const out = { name, label: String(x?.display_name ?? name) };
  if (x?.event) out.event = String(x.event);
  return out;
};

function createCaselist({ base = CASELIST_BASE, fetchImpl = (...a) => fetch(...a), timeoutMs = 20_000, store } = {}) {
  async function request(url, init, ms = timeoutMs) {
    try { return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) }); } catch { throw new Error('unreachable'); }
  }
  async function json(res) {
    try { return await res.json(); } catch { throw new Error('bad_response'); }
  }
  /** Runs fn with the stored token. A 401 forgets it, unless a newer login has replaced it. */
  async function authed(fn) {
    const session = store.read();
    if (!session?.token) throw new Error('not_logged_in');
    try { return await fn(session.token); } catch (err) {
      if (err.message === 'login_expired' && store.read()?.token === session.token) store.clear();
      throw err;
    }
  }
  async function list(token, path) {
    const res = await request(`${base}${path}`, { headers: { Cookie: `caselist_token=${token}` } });
    if (res.status === 401) throw new Error('login_expired');
    if (!res.ok) throw new Error(`http_${res.status}`);
    const body = await json(res);
    if (!Array.isArray(body)) throw new Error('bad_response');
    return body;
  }
  const lists = (path) => authed(async (t) => (await list(t, path)).map(choice).filter((c) => c.name));

  return {
    signedIn: () => !!store.read()?.token,
    async login({ username, password }) {
      if (!username || !password) throw new Error('bad_login');
      const res = await request(`${base}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, remember: true }),
      });
      if ([400, 401, 403].includes(res.status)) throw new Error('bad_login');
      if (!res.ok) throw new Error(`http_${res.status}`);
      const body = await json(res);
      if (typeof body?.token !== 'string' || !body.token) throw new Error('bad_response');
      store.write({ token: body.token, expires: body.expires ?? null });
      return true;
    },
    logout: () => store.clear(),
    /** Your rounds on Tabroom: the current ones, else the ten latest. */
    rounds: () => authed(async (t) => {
      const current = (await list(t, '/tabroom/rounds?current=true')).map(roundShape);
      if (current.length) return { current: true, rounds: current };
      const all = (await list(t, '/tabroom/rounds')).map(roundShape);
      all.sort((a, b) => (Date.parse(b.start_time) || 0) - (Date.parse(a.start_time) || 0));
      return { current: false, rounds: all.slice(0, 10) };
    }),
    caselists: () => authed(async (t) => (await list(t, '/caselists')).filter((c) => c && !c.archived).map(choice).filter((c) => c.name)),
    schools: (caselist) => lists(`/caselists/${seg(caselist)}/schools`),
    teams: (caselist, school) => lists(`/caselists/${seg(caselist)}/schools/${seg(school)}/teams`),
    /** What's already on the team's page: its tournament numbering, and whether this round is up already. */
    posted: ({ caselist, school, team }) => authed(async (t) => (await list(t, `/caselists/${seg(caselist)}/schools/${seg(school)}/teams/${seg(team)}/rounds`))
      .map((r) => ({ tournament: String(r.tournament ?? ''), round: String(r.round ?? ''), side: String(r.side ?? '') }))),
    /** Public and permanent. Anything short of a clear yes or no comes back as upload_unknown: check the page before posting again. */
    post({ caselist, school, team }, round, filename, bytes) {
      if (!caselist || !school || !team) throw new Error('no_team');
      const body = roundBody(round, filename, bytes);
      return authed(async (t) => {
        let res;
        try {
          res = await fetchImpl(`${base}/caselists/${seg(caselist)}/schools/${seg(school)}/teams/${seg(team)}/rounds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: `caselist_token=${t}` },
            body: JSON.stringify(body),
            redirect: 'manual', // a followed redirect turns the POST into a GET that "succeeds"
            signal: AbortSignal.timeout(60_000),
          });
        } catch { throw new Error('upload_unknown'); }
        if (res.status === 401) throw new Error('login_expired');
        if (res.status >= 200 && res.status < 300) return { filename };
        if (res.status >= 500 || (res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') throw new Error('upload_unknown');
        let msg = `http_${res.status}`;
        try { const b = await res.json(); if (b?.message) msg = String(b.message); } catch { /* the status will do */ }
        throw new Error(`caselist_rejected:${msg}`);
      });
    },
  };
}

module.exports = { createCaselist, roundBody, normalizeSide, CASELIST_BASE, MAX_BYTES };
