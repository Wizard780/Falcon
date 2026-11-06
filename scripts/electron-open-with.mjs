// Double-clicking a .docx (Finder, Explorer, Open With) opens it in Falcon. Launches the real app,
// hidden, with a file on the command line (how Windows, and a Mac launch from a click, hand it over),
// then sends macOS's open-file for a second file while it runs, and once more for the first.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
env.FALCON_USER_DATA = fs.mkdtempSync(`${os.tmpdir()}/falcon-openwith-`);
const dir = fs.mkdtempSync(`${os.tmpdir()}/falcon-openwith-docs-`);
const seed = '.claude/skills/verify-falcon/fixtures/seed.docx';
const first = path.join(dir, 'Clicked First.docx');
const second = path.join(dir, 'Clicked Second.docx');
const third = path.join(dir, 'Clicked Third.docx');
const many = [1, 2, 3].map((i) => path.join(dir, `Many ${i}.docx`));
for (const f of [first, second, third, ...many]) fs.copyFileSync(seed, f);
const exe = process.env.FALCON_EXE;
const opts = { env: { ...env, FALCON_HEADLESS: '1' } };
const app = await electron.launch(exe ? { ...opts, executablePath: exe, args: [first] } : { ...opts, args: ['.', first] });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.ProseMirror');
const tabs = () => win.evaluate(() => [...document.querySelectorAll('.doc-nm')].map((b) => b.getAttribute('aria-label')));
const waitTab = (name) => win.waitForFunction((n) => [...document.querySelectorAll('.doc-nm')].some((b) => b.getAttribute('aria-label') === n), name, { timeout: 8000 }).then(() => true, () => false);
const launched = await waitTab('Clicked First');
const textOk = await win.evaluate(() => window.__falconView.state.doc.textContent.length > 0);
await app.evaluate(({ app }, p) => app.emit('open-file', { preventDefault() {} }, p), second);
const whileRunning = await waitTab('Clicked Second');
await app.evaluate(({ app }, p) => app.emit('open-file', { preventDefault() {} }, p), first);
await win.waitForTimeout(800);
const after = await tabs();
const active = await win.evaluate(() => document.querySelector('.doc-nm[aria-selected="true"]')?.getAttribute('aria-label'));
// Windows: a double-click starts a second Falcon with the file; it hands the file over and quits
const bin = exe ?? createRequire(import.meta.url)('electron');
const child = spawn(bin, exe ? [third] : ['.', third], { env: { ...env, FALCON_HEADLESS: '1' }, stdio: 'ignore' });
const childExited = await new Promise((ok) => { child.on('exit', () => ok(true)); setTimeout(() => { child.kill(); ok(false); }, 8000); });
const handedOver = await waitTab('Clicked Third');
// several files picked in Finder at once arrive as open-file events back to back: every one opens
await app.evaluate(({ app }, ps) => { for (const p of ps) app.emit('open-file', { preventDefault() {} }, p); }, many);
const allMany = (await Promise.all(['Many 1', 'Many 2', 'Many 3'].map(waitTab))).every(Boolean);
// a file sent while the page reloads waits for the new page instead of being dropped
await app.evaluate(() => { globalThis.falconSkipUnloadGuard = true; });
const reloadFile = path.join(dir, 'After Reload.docx'); fs.copyFileSync(seed, reloadFile);
await app.evaluate(({ app, BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.reload(); app.emit('open-file', { preventDefault() {} }, p); }, reloadFile);
await win.waitForSelector('.ProseMirror');
const afterReload = await waitTab('After Reload');
// a file sent while the crash screen is up has no listener to reach: it waits for Reload. Array methods that
// throw for one render are what puts the screen up, since nothing in a healthy app can
await win.evaluate(() => {
  const { map, filter } = Array.prototype;
  window.dispatchEvent(new Event('falcon:sd-show'));
  Array.prototype.map = Array.prototype.filter = () => { throw new Error('boom'); };
  setTimeout(() => Object.assign(Array.prototype, { map, filter }), 30);
});
const crashed = await win.waitForSelector('[role=alert] h1', { timeout: 3000 }).then(() => true, () => false);
const crashFile = path.join(dir, 'While Crashed.docx'); fs.copyFileSync(seed, crashFile);
await app.evaluate(({ app }, p) => app.emit('open-file', { preventDefault() {} }, p), crashFile);
await win.waitForTimeout(500);
await win.click('[role=alert] button').catch(() => {});
await win.waitForSelector('.ProseMirror');
const afterCrash = await waitTab('While Crashed');
await app.close();

console.log('tabs:', after, '| active:', active);
const want = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } };
want(launched && textOk, 'a .docx on the launch command line opens as a tab with its text');
want(whileRunning, 'open-file while running opens the file');
want(after.filter((t) => t === 'Clicked First').length === 1 && active === 'Clicked First', `opening an already-open file switches to it, no duplicate: ${after} / ${active}`);
want(childExited && handedOver, `a second launch with a file hands it to the running app and quits: exited ${childExited}, opened ${handedOver}`);
want(allMany, 'several files opened at once all open');
want(afterReload, 'a file sent during a page reload opens in the reloaded page');
want(crashed && afterCrash, `a file sent while the crash screen is up opens after Reload: screen ${crashed}, opened ${afterCrash}`);
want(!errors.filter((e) => e !== 'boom').length, `page errors: ${errors.filter((e) => e !== 'boom').join('; ')}`);
if (!process.exitCode) console.log('open-with: all checks pass');
