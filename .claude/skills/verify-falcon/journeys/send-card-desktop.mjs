// Send Card in the Electron app (file:// page, no visible window) through relay/ under `wrangler dev`.
// The partner is this script, using Falcon's own client crypto (src/collab). It proves the socket,
// Web Locks and IndexedDB work from the desktop page, a card goes both ways with its marks, and the
// identity survives a relaunch. Needs `npm run build` (dist/) and `npm ci` in relay/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { _electron as electron } from 'playwright';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const { makeIdentity, open, seal, proveKey, b64url, unb64url } = await import(path.join(REPO, 'src/collab/crypto.ts'));
const { encodeCode, inboxId, keyOf, parseCode } = await import(path.join(REPO, 'src/collab/code.ts'));
const out = path.join(process.env.FALCON_EVIDENCE, 'send-card-desktop');
fs.mkdirSync(out, { recursive: true });
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); console.log(results[results.length - 1]); return ok; };
// a step that hangs fails the run with what got done, instead of hanging it
setTimeout(() => { console.log('FAIL timed out after the checks above'); process.exit(1); }, 180_000).unref();

const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-relay-desktop-'));
const port = 19300 + Math.floor(Math.random() * 400);
const RELAY = `http://127.0.0.1:${port}`;
const relay = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--show-interactive-dev-session=false'],
  { cwd: path.join(REPO, 'relay'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: 'ignore', detached: true });
const stopRelay = () => { try { process.kill(-relay.pid, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stopRelay);
relay.unref();
for (let i = 0; ; i++) {
  try { if ((await fetch(`${RELAY}/x`)).status === 404) break; } catch { /* not up */ }
  if (i > 120) throw new Error('wrangler dev never came up');
  await new Promise((r) => setTimeout(r, 500));
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-collab-desktop-'));
const env = { ...process.env, FALCON_HEADLESS: '1', FALCON_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
async function launch() {
  const app = await electron.launch({ args: ['.'], cwd: REPO, env });
  const win = await app.firstWindow();
  await win.waitForSelector('.ProseMirror');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  return { app, win };
}
const command = async (win, text) => {
  await win.keyboard.press(`${MOD}+Shift+Space`);
  await win.waitForSelector('.cc input');
  await win.fill('.cc input', text);
  await win.waitForTimeout(150);
  await win.keyboard.press('Enter');
  await win.waitForTimeout(300);
};

let { app, win } = await launch();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
want(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible())), 'the window is never shown');
want((await win.evaluate(() => location.protocol)) === 'file:', 'the page is the desktop build on file://');
// the relay, through Settings
await win.click('.fstrip [aria-label="Settings"]');
await win.fill('[aria-label="Search settings"]', 'relay');
await win.waitForTimeout(200);
await win.fill('input[aria-label="Relay address"]', RELAY);
await win.press('input[aria-label="Relay address"]', 'Enter'); // the address is saved on Enter, not as it's typed
await win.keyboard.press('Escape'); await win.keyboard.press('Escape');
await win.waitForTimeout(300);
await command(win, 'card sharing');
const live = await win.waitForFunction(() => document.querySelector('.co-line')?.textContent?.startsWith('Connected'), null, { timeout: 15000 }).then(() => true, () => false);
want(live, `desktop: connected to the relay and proved its key (${await win.textContent('.co-line')})`);
const code = (await win.textContent('.co-code')).trim();
const parsed = parseCode(code);
want(parsed.ok, `desktop: shows a valid pairing code ${code}`);
await win.screenshot({ path: path.join(out, '01-desktop-panel.png') });

// the partner (this script) sends a formatted card to that code
const partner = await makeIdentity();
await win.fill('input[aria-label="Their pairing code"]', encodeCode(partner.pub));
await win.fill('input[aria-label="Their name"]', 'Robin');
await win.click('.co-add button[type="submit"]');
await win.keyboard.press('Escape');
const card = [
  { type: 'paragraph', attrs: { style: 'tag', indent: 0 }, content: [{ type: 'text', text: 'Desktop gets cards' }] },
  { type: 'paragraph', attrs: { style: 'normal', indent: 0 }, content: [{ type: 'text', text: 'Lee 25', marks: [{ type: 'cite' }] }] },
  { type: 'paragraph', attrs: { style: 'normal', indent: 0 }, content: [
    { type: 'text', text: 'boxed', marks: [{ type: 'emphasis' }, { type: 'highlight', attrs: { color: 'green' } }] }, { type: 'text', text: ' and ' },
    { type: 'text', text: 'underlined', marks: [{ type: 'underline' }] }] },
];
const r = await fetch(`${RELAY}/v1/inbox/${await inboxId(parsed.pub)}`, { method: 'POST', body: await seal(partner, parsed.pub, { name: 'Robin', at: Date.now(), content: card }) });
want(r.status === 201, `the partner's card was stored by the relay (${r.status})`);
await win.click('.ProseMirror:not(.hm-doc)');
await win.keyboard.type('Typing here.');
const toastSeen = await win.waitForFunction(() => document.querySelector('.toast')?.textContent?.startsWith('Card from Robin'), null, { timeout: 15000 }).then(() => true, () => false);
want(toastSeen, 'desktop: a toast says Robin sent a card');
await win.screenshot({ path: path.join(out, '02-desktop-arrived.png') });
await win.click('.fstrip [aria-label="Cards waiting (1)"]');
await win.click('.co-card button:has-text("Insert")');
await win.waitForTimeout(300);
const map = await win.evaluate(() => window.__falconMarkMap());
want(map === 'normal: Typing here.\ntag: Desktop gets cards\nnormal: [Lee 25]{cite}\nnormal: [boxed]{emphasis+highlight:green} and [underlined]{underline}', `desktop: inserted with its marks:\n${map}`);

// and sends one back
await win.click('.ProseMirror:not(.hm-doc) :text("Desktop gets cards")');
await command(win, 'send card');
await win.keyboard.press('Enter');
await win.waitForFunction(() => document.querySelector('.toast')?.textContent?.startsWith('Sent'), null, { timeout: 10000 }).catch(() => {});
want((await win.textContent('.toast')).trim() === 'Sent “Desktop gets cards” to Robin', 'desktop: Send Card to… sends it back');
// the partner collects it the way Falcon does: prove the key, take the card, ack it
const inbox = await inboxId(partner.pub);
const got = await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${RELAY.replace('http', 'ws')}/v1/inbox/${inbox}`);
  ws.binaryType = 'arraybuffer';
  const t = setTimeout(() => reject(new Error('no card')), 10000);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', pub: b64url(partner.pub) }));
  ws.onmessage = async (e) => {
    if (typeof e.data === 'string') {
      const m = JSON.parse(e.data);
      if (m.t === 'challenge') ws.send(JSON.stringify({ t: 'proof', mac: b64url(await proveKey(partner.priv, unb64url(m.eph), unb64url(m.nonce), inbox)) }));
      return;
    }
    const b = new Uint8Array(e.data);
    ws.send(JSON.stringify({ t: 'ack', ids: [new TextDecoder().decode(b.subarray(0, 36))] }));
    clearTimeout(t);
    setTimeout(() => ws.close(), 100);
    resolve(await open(partner, b.slice(36)));
  };
});
want(keyOf(encodeCode(got.from)) === keyOf(code) && parsed.ok && parsed.relay === RELAY, "the card the partner got is proven to come from the desktop code's key (the code also carries the desktop's relay)");
want(isDeepStrictEqual(got.card.content, card), `and it is the same card, marks and all:\n${JSON.stringify(got.card.content)}`);

// relaunch on the same profile: same identity, same contact
await app.close();
({ app, win } = await launch());
await command(win, 'card sharing');
await win.waitForFunction(() => /^[0-9A-Z]/.test(document.querySelector('.co-code')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
want((await win.textContent('.co-code')).trim() === code, 'after a relaunch the pairing code is the same (the key lives in IndexedDB)');
want((await win.$$eval('.co-ct .nm', (x) => x.map((n) => n.textContent))).join() === 'Robin', 'and Robin is still a contact');
await win.screenshot({ path: path.join(out, '03-desktop-relaunched.png') });
await app.close();
if (errors.length) want(false, `page errors: ${errors.join(' | ')}`);
fs.rmSync(userData, { recursive: true, force: true });
stopRelay();
fs.rmSync(persist, { recursive: true, force: true });
fs.writeFileSync(path.join(out, 'results.txt'), results.join('\n') + '\n');
console.log(`evidence: ${out}`);
process.exitCode = results.some((x) => x.startsWith('FAIL')) ? 1 : 0;
