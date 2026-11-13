// Live editing in the Electron app (file:// page, no visible window) through relay/ under `wrangler dev`, with a web
// Falcon as the other person. Proves the CRDT's chunk (its wasm inline) loads from file://, the desktop page holds a
// room socket, and edits go both ways. Needs `npm run build` (dist/), a falcon-verify run (FALCON_URL) and `npm ci` in relay/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { openFalcon, MOD } from '../lib/falcon.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const out = path.join(process.env.FALCON_EVIDENCE, 'live-editing-desktop');
fs.mkdirSync(out, { recursive: true });
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); console.log(results[results.length - 1]); return ok; };
setTimeout(() => { console.log('FAIL timed out after the checks above'); process.exit(1); }, 240_000).unref();

const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-live-desktop-'));
const port = 19700 + Math.floor(Math.random() * 200);
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

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-live-desktop-profile-'));
const env = { ...process.env, FALCON_HEADLESS: '1', FALCON_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], cwd: REPO, env });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
const loaded = []; // scripts the page asked for, in order
win.on('request', (r) => { if (/\.js$/.test(r.url())) loaded.push(r.url()); });
await win.waitForSelector('.ProseMirror');
await win.keyboard.press('Escape');
await win.waitForTimeout(300);
const B = await openFalcon('live-editing-desktop/web');

const command = async (page, text) => {
  await page.keyboard.press(`${MOD}+Shift+Space`);
  await page.waitForSelector('.cc input');
  await page.fill('.cc input', text);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
};
async function setUp(page, name) {
  await page.click('.fstrip [aria-label="Settings"]');
  await page.fill('[aria-label="Search settings"]', 'relay');
  await page.waitForTimeout(200);
  await page.fill('input[aria-label="Relay address"]', RELAY);
  await page.press('input[aria-label="Relay address"]', 'Enter');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await command(page, 'card sharing');
  await page.fill('#co-name', name);
  await page.waitForFunction(() => document.querySelector('.co-line')?.textContent?.startsWith('Connected'), null, { timeout: 15000 }).catch(() => {});
  const code = (await page.textContent('.co-code')).trim();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return code;
}
async function addContact(page, code, name) {
  await command(page, 'card sharing');
  await page.click('.cf.co .rcp-new');
  await page.fill('input[aria-label="Their pairing code"]', code);
  await page.fill('input[aria-label="Their name"]', name);
  await page.click('.rcp-add button[type="submit"]');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}
const bit = (page) => page.getAttribute('.who', 'aria-label').catch(() => '');
const map = (page) => page.evaluate(() => window.__falconMarkMap());

want(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible())), 'the window is never shown');
want((await win.evaluate(() => location.protocol)) === 'file:', 'the page is the desktop build on file://');
const codeD = await setUp(win, 'Dana');
const codeB = await setUp(B.page, 'Blake');
await addContact(win, codeB, 'Blake');
await addContact(B.page, codeD, 'Dana');
await win.click('.ProseMirror:not(.hm-doc)');
await win.keyboard.press('F7');
await win.keyboard.type('Desktop tag');
await win.keyboard.press('Enter');
await win.keyboard.type('Body from the desktop.');

const beforeStart = loaded.filter((u) => /live-doc-[^/]*\.js$/.test(u)).length;
await command(win, 'start live editing');
want(await win.waitForFunction(() => document.querySelector('.co-live .lv-line')?.textContent?.startsWith('Live.'), null, { timeout: 20000 }).then(() => true, () => false),
  `desktop: the session starts, so the CRDT chunk loaded from file:// and the room socket is open (${await win.textContent('.co-live .lv-line').catch(() => '')})`);
const chunk = loaded.filter((u) => /live-doc-[^/]*\.js$/.test(u));
want(beforeStart === 0 && chunk.length === 1 && chunk[0].startsWith('file://'), `the CRDT came in its own chunk, from file://, only once a session started (${beforeStart} before; ${chunk.map((u) => path.basename(u)).join()})`);
await win.click('.co-live section[aria-label="Invite"] .co-ct:has-text("Blake") button');
await win.waitForTimeout(500);
await win.keyboard.press('Escape');
want(await B.page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('invited you to live-edit'), null, { timeout: 15000 }).then(() => true, () => false), 'web: the invite from the desktop arrives');
await B.page.click('.toast button:has-text("Join")');
want(await B.page.waitForFunction(() => document.querySelector('.who')?.getAttribute('aria-label') === 'Live editing with Dana', null, { timeout: 20000 }).then(() => true, () => false), `web: joined, with Dana (${await bit(B.page)})`);
want((await map(B.page)) === (await map(win)), `web: the doc is the desktop's:\n${await map(win)}`);
await B.page.evaluate(() => { const v = window.__falconView; let at = -1; v.state.doc.descendants((n, p) => { if (at < 0 && n.isTextblock && n.textContent.startsWith('Body')) at = p + 1; return at < 0; }); const S = v.state.selection.constructor; v.dispatch(v.state.tr.setSelection(S.near(v.state.doc.resolve(at)))); v.focus(); });
await B.page.keyboard.type('Web says hi. ');
want(await win.waitForFunction(() => window.__falconMarkMap().includes('Web says hi.'), null, { timeout: 10000 }).then(() => true, () => false), 'desktop: the web Falcon\'s typing arrives');
await win.waitForTimeout(300);
await win.keyboard.type(' And back.');
want(await B.page.waitForFunction(() => window.__falconMarkMap().includes('And back.'), null, { timeout: 10000 }).then(() => true, () => false), 'web: the desktop\'s typing arrives');
// the web Falcon typed ahead of the desktop's caret in the same paragraph: the desktop's next keys still land where it left off
want((await map(win)).includes('normal: Web says hi. Body from the desktop. And back.'), `desktop: its caret moved along with the text typed ahead of it:\n${await map(win)}`);
want(await win.waitForFunction(() => document.querySelector('.who')?.getAttribute('aria-label') === 'Live editing with Blake', null, { timeout: 10000 }).then(() => true, () => false), `desktop: Live · Blake (${await bit(win)})`);
want(await win.waitForFunction(() => !!document.querySelector('.ProseMirror .f-peer'), null, { timeout: 10000 }).then(() => true, () => false), "desktop: Blake's caret shows");
await win.screenshot({ path: path.join(out, '01-desktop-live.png') });
await B.shot('web-live');
if (errors.length) want(false, `desktop page errors: ${errors.join(' | ')}`);
if (B.errors.length) want(false, `web page errors: ${B.errors.join(' | ')}`);
await app.close();
await B.browser.close();
fs.writeFileSync(path.join(out, 'results.txt'), results.join('\n') + '\n');
console.log(`evidence: ${out}`);
stopRelay();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
