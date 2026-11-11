// Open files in new windows, in the real app, hidden: two windows can't end up saving the same file, and a file
// that's gone gets no empty window of its own. Screenshots go to FALCON_SHOTS when it's set.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
env.FALCON_USER_DATA = fs.mkdtempSync(`${os.tmpdir()}/falcon-guards-`);
env.CARDMIRROR_BRIDGE_DIR = fs.mkdtempSync(`${os.tmpdir()}/falcon-guards-bridge-`);
const dir = fs.mkdtempSync(`${os.tmpdir()}/falcon-guards-docs-`);
const file = (n) => { const p = path.join(dir, `${n}.docx`); fs.copyFileSync('.claude/skills/verify-falcon/fixtures/seed.docx', p); return p; };
const [one, two] = ['One', 'Two'].map(file);
const shots = process.env.FALCON_SHOTS;
const want = (cond, msg) => { console.log(cond ? 'ok  ' : 'FAIL', msg); if (!cond) process.exitCode = 1; };
const until = async (f, ms = 10000) => { const t = Date.now(); for (;;) { const v = await f().catch(() => false); if (v || Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 100)); } };

const app = await electron.launch({ env: { ...env, FALCON_HEADLESS: '1' }, args: ['.', one] });
const errors = [];
app.on('window', (p) => p.on('pageerror', (e) => errors.push(e.message)));
const first = await app.firstWindow();
first.on('pageerror', (e) => errors.push(e.message));
await first.waitForSelector('.ProseMirror');
const editors = async () => { const out = []; for (const p of app.windows()) if (await p.locator('.ProseMirror').count().catch(() => 0)) out.push(p); return out; };
const names = (p) => p.evaluate(() => [...document.querySelectorAll('.doc-nm')].map((b) => b.getAttribute('aria-label')));
const page = async (n) => { for (const p of await editors()) if ((await names(p)).includes(n)) return p; return null; };
const toast = (p) => p.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const anyToast = async (re) => { for (const p of await editors()) { const x = await toast(p).catch(() => ''); if (re.test(x)) return { p, x }; } return false; };
await until(async () => (await names(first)).includes('One'));
await first.click('.fstrip [aria-label="Settings"]');
await first.click('[role=switch][aria-label="Open files in new windows"]');
await first.keyboard.press('Escape');
await app.evaluate(({ app: a }, f) => a.emit('open-file', { preventDefault() {} }, f), two);
want(await until(async () => (await editors()).length === 2 && !!(await page('Two'))), 'Two opens in a window of its own');
const winTwo = await page('Two');

// Two has unsaved work; in One's window, Save As picks Two.docx (the OS dialog is stubbed to answer that)
await winTwo.evaluate(() => { const v = window.__falconView; v.dispatch(v.state.tr.insertText('UNSAVED IN TWO ', 1)); });
await until(async () => (await winTwo.locator('i[aria-label="unsaved"]').count()) > 0);
await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, two);
const before = fs.readFileSync(two);
await first.bringToFront();
const r = await first.evaluate(() => window.falcon.saveFile({ name: 'One.docx', data: new Uint8Array([80, 75, 3, 4]) }).then(() => 'saved', (e) => e.message));
want(/Two\.docx is open in another window/.test(r), `Save As onto a file open in another window is refused: ${r}`);
want(fs.readFileSync(two).equals(before), 'and Two.docx on disk is untouched');
// the same through the app's own Save As (tool row, As-Is): the toast says why
await first.click('.tools [aria-label="Save As…"]');
await first.waitForSelector('.cf.sa .sa-mode[data-mode=asis]', { timeout: 5000 });
await first.click('.cf.sa .sa-mode[data-mode=asis]');
const said = await until(() => anyToast(/open in another window/));
want(!!said, `the Save As toast explains it: ${said ? said.x : await toast(first)}`);
if (shots) await first.screenshot({ path: path.join(shots, 'save-as-refused.png') });
want(fs.readFileSync(two).equals(before), 'Two.docx still untouched after the app Save As');

// a file that's gone: no empty window, and the page says it couldn't open it
const gone = path.join(dir, 'Gone.docx');
await app.evaluate(({ app: a }, f) => a.emit('open-file', { preventDefault() {} }, f), gone);
const t = await until(() => anyToast(/Couldn't open Gone/), 5000);
await new Promise((res) => setTimeout(res, 1000));
want((await editors()).length === 2, `a missing file opens no window: ${(await editors()).length} windows`);
want(!!t, `and says it couldn't open it: ${t ? t.x : await toast(first)}`);
if (shots && t) await t.p.screenshot({ path: path.join(shots, 'missing-file.png') });

want(!errors.length, `no page errors: ${errors.join(' / ')}`);
await app.evaluate(() => { globalThis.falconSkipUnloadGuard = true; });
await app.close();
for (const d of [env.FALCON_USER_DATA, env.CARDMIRROR_BRIDGE_DIR, dir]) fs.rmSync(d, { recursive: true, force: true });
