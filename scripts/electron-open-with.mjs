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
for (const f of [first, second, third]) fs.copyFileSync(seed, f);
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
await app.evaluate(() => { globalThis.falconSkipUnloadGuard = true; });
await app.close();

console.log('tabs:', after, '| active:', active);
const want = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } };
want(launched && textOk, 'a .docx on the launch command line opens as a tab with its text');
want(whileRunning, 'open-file while running opens the file');
want(after.filter((t) => t === 'Clicked First').length === 1 && active === 'Clicked First', `opening an already-open file switches to it, no duplicate: ${after} / ${active}`);
want(childExited && handedOver, `a second launch with a file hands it to the running app and quits: exited ${childExited}, opened ${handedOver}`);
want(!errors.length, `page errors: ${errors.join('; ')}`);
if (!process.exitCode) console.log('open-with: all checks pass');
