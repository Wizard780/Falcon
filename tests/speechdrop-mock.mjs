// A local stand-in for speechdrop.net, following its routes (github.com/yunyu/speechdrop,
// SpeechDropApplication.java): every GET hands out an XSRF-TOKEN cookie, and every POST must send the
// same token back in the X-XSRF-TOKEN header or it gets a 403. Tests and the desktop check point Falcon
// at it (FALCON_SD_BASE / FALCON_SD_MEDIA), so nothing is ever made or uploaded on the real site.
//   node tests/speechdrop-mock.mjs [port]   prints "SDMOCK <url>" and seeds a room "abc234"
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const body = (req) => new Promise((resolve) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => resolve(Buffer.concat(b))); });
const cookieOf = (req, k) => (req.headers.cookie ?? '').split(/;\s*/).map((c) => c.split('=')).find(([n]) => n === k)?.slice(1).join('=');

export async function startMock({ port = 0 } = {}) {
  const rooms = new Map(); // code -> { name, files: [{ name, ctime, bytes } | null] }
  const log = [];
  let next = 0;
  const index = (r) => JSON.stringify(r.files.map((f) => (f ? { name: f.name, ctime: f.ctime } : null)));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    log.push(`${req.method} ${url.pathname}`);
    const send = (status, text = '', headers = {}) => { res.writeHead(status, headers); res.end(text); };
    if (req.method === 'GET') res.setHeader('Set-Cookie', [`XSRF-TOKEN=${randomBytes(8).toString('hex')}.${Date.now()}; Path=/; SameSite=Strict`]);
    if (req.method === 'POST') {
      const tok = cookieOf(req, 'XSRF-TOKEN');
      if (!tok || req.headers['x-xsrf-token'] !== tok) return send(403, 'Forbidden');
    }
    const raw = req.method === 'POST' ? await body(req) : null;
    const form = async () => new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] ?? '' }, body: raw }).formData();

    if (req.method === 'GET' && parts.length === 0) return send(200, '<!doctype html><title>SpeechDrop</title>', { 'Content-Type': 'text/html' });
    if (req.method === 'POST' && parts[0] === 'makeroom') {
      const name = String((await form()).get('name') ?? '').trim();
      if (!name || name.length > 60) return send(302, '', { Location: '/' });
      const code = `rm${String(++next).padStart(4, '0')}`;
      rooms.set(code, { name, files: [] });
      return send(302, '', { Location: `/${code}` });
    }
    if (req.method === 'GET' && parts[0] === 'media' && parts[1] === 'uploads') {
      const f = rooms.get(parts[2])?.files[Number(parts[3])];
      if (!f || f.name !== parts[4]) return send(404);
      return send(200, f.bytes, { 'Content-Type': 'application/octet-stream' });
    }
    const r = rooms.get(parts[0]);
    if (parts.length === 1 && req.method === 'GET') {
      if (!r) return send(302, '', { Location: '/' });
      const config = { mediaUrl: '/media/uploads/', roomName: esc(r.name), roomId: parts[0], allowedMimes: '', purgeIntervalInSeconds: 604800, initialFiles: JSON.parse(index(r)) };
      return send(200, `<!DOCTYPE html><html><head>\n    <script>\n      window.roomConfig = ${JSON.stringify(config)};\n    </script>\n</head><body></body></html>`, { 'Content-Type': 'text/html' });
    }
    if (parts[1] === 'index' && req.method === 'GET') return r ? send(200, index(r), { 'Content-Type': 'application/json' }) : send(404, '[]');
    if (parts[1] === 'upload' && req.method === 'POST') {
      if (!r) return send(404, '[]');
      const file = (await form()).get('file');
      if (!file || typeof file === 'string') return send(400, JSON.stringify({ err: 'no_file' }));
      if (/\.exe$/i.test(file.name)) return send(400, JSON.stringify({ err: 'bad_type' }));
      r.files.push({ name: file.name, ctime: Date.now(), bytes: Buffer.from(await file.arrayBuffer()) });
      return send(200, index(r), { 'Content-Type': 'application/json', 'X-Uploaded-File-Index': String(r.files.length - 1) });
    }
    if (parts[1] === 'delete' && req.method === 'POST') {
      if (!r) return send(404, '[]');
      const i = Number(new URLSearchParams(raw.toString()).get('fileIndex'));
      if (r.files[i]) r.files[i] = null;
      return send(200, index(r), { 'Content-Type': 'application/json' });
    }
    return send(404);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    rooms,
    log,
    /** A room with these files, oldest first. */
    seed(code, name, files = []) { rooms.set(code, { name, files: files.map((f, i) => ({ ctime: Date.now() - (files.length - i) * 60_000, ...f, bytes: Buffer.from(f.bytes ?? f.name) })) }); },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMock({ port: Number(process.argv[2]) || 0 });
  m.seed('abc234', 'Round 3 <Flight A>', [{ name: 'Aff 1AC.txt', bytes: 'the 1AC' }, { name: 'Neg 1NC.pdf', bytes: '%PDF-1.4' }]);
  console.log(`SDMOCK ${m.url}`);
}
