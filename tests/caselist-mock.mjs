// A local stand-in for api.opencaselist.com/v1, following the routes the debate-uploader plugin uses. Tests and
// the desktop check point Falcon at it (FALCON_CASELIST_BASE), so no round is ever posted to the real site.
//   node tests/caselist-mock.mjs [port]   prints "CLMOCK <url>"; sign in with any email and the password "test-pass"
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const body = (req) => new Promise((resolve) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => resolve(Buffer.concat(b).toString('utf8'))); });

export async function startMock({ port = 0 } = {}) {
  const TOKEN = 'mock-token';
  const state = {
    posts: [], // every round posted, as openCaselist would get it
    rounds: [ // Tabroom's pairing
      { id: 41, tournament: 'Blake', round: '3', side: 'Con', opponent: 'Sharon SS', judge: 'Raj Khan', start_time: '2026-11-04T16:00:00Z' },
      { id: 40, tournament: 'Blake', round: '2', side: 'Pro', opponent: 'McLean KR', judge: 'Kenny Qiu', start_time: '2026-11-04T14:00:00Z' },
    ],
    page: [ // what the team's page has so far
      { id: 1, tournament: '1---National Speech and Debate Season Opener', round: '1', side: 'A', opponent: 'Sharon SS', judge: 'Raj Khan', report: '1NC---Offshoring DA, Econ DA' },
      { id: 2, tournament: '2---Fullerton', round: '2', side: 'A', opponent: 'National Debate Club (NDC) MG', judge: 'Bashir Eltyeb', report: '1AC---Econ, AGI' },
    ],
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method === 'POST' && url.pathname === '/login') {
      const { username, password } = JSON.parse(await body(req));
      return username && password === 'test-pass' ? send(200, { token: TOKEN, expires: '2027-01-01' }) : send(401, { message: 'Invalid login' });
    }
    if ((req.headers.cookie ?? '') !== `caselist_token=${TOKEN}`) return send(401, { message: 'Not Authorized' });
    if (url.pathname === '/tabroom/rounds') return send(200, state.rounds);
    if (url.pathname === '/caselists') return send(200, [{ name: 'hspf26', display_name: 'HS PF 2026-27', event: 'pf' }, { name: 'hsld26', display_name: 'HS LD 2026-27', event: 'ld' }, { name: 'hspf25', display_name: 'HS PF 2025-26', event: 'pf', archived: true }]);
    if (parts[0] === 'caselists' && parts[2] === 'schools' && parts.length === 3) return send(200, [{ name: 'Jericho', display_name: 'Jericho' }, { name: 'Sharon', display_name: 'Sharon' }]);
    if (parts[2] === 'schools' && parts[4] === 'teams' && parts.length === 5) return send(200, [{ name: 'XG', display_name: 'Jericho XG' }]);
    if (parts[4] === 'teams' && parts[6] === 'rounds' && parts.length === 7) {
      if (req.method === 'GET') return send(200, state.page);
      if (req.method === 'POST') {
        const round = JSON.parse(await body(req));
        state.posts.push({ path: url.pathname, ...round });
        state.page.push({ id: state.page.length + 1, ...round });
        return send(201, { message: 'Round added' });
      }
    }
    return send(404, { message: 'Not found' });
  });
  await new Promise((r) => { server.listen(port, '127.0.0.1', r); });
  return { url: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((r) => { server.close(r); }) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const m = await startMock({ port: Number(process.argv[2]) || 0 });
  console.log(`CLMOCK ${m.url}`);
}
