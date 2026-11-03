// Crash recovery for a file too big for browser storage (any block file): launch the real app, hidden, with a
// big .docx, type into it, kill the app outright, launch it again on the same profile, and check the edit came
// back unsaved. FALCON_BIG=<path.docx> uses a real file (a copy: it is never saved); otherwise one is made.
// Screenshots go to FALCON_SHOTS when set.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
env.FALCON_USER_DATA = fs.mkdtempSync(`${os.tmpdir()}/falcon-recovery-`);
const dir = fs.mkdtempSync(`${os.tmpdir()}/falcon-recovery-docs-`);
const big = path.join(dir, 'Big Block File.docx');
if (process.env.FALCON_BIG) fs.copyFileSync(process.env.FALCON_BIG, big);
else {
  // ~900k characters of cards: over the 400k that fits in browser storage
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (style, text) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const body = Array.from({ length: 1200 }, (_, i) => p('Heading4', `Tag ${i}`) + p('', `Card ${i} ${'warrant '.repeat(90)}`)).join('');
  fs.writeFileSync(big, zipSync({ 'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body}</w:body></w:document>`) }));
}
const name = path.basename(big, '.docx');
const shots = process.env.FALCON_SHOTS;
const opts = (args) => ({ env: { ...env, FALCON_HEADLESS: '1' }, args: ['.', ...args] });
const want = (cond, msg) => { console.log(cond ? 'ok  ' : 'FAIL', msg); if (!cond) process.exitCode = 1; };

let app = await electron.launch(opts([big]));
let win = await app.firstWindow();
await win.setViewportSize({ width: 1300, height: 820 });
await win.waitForFunction((n) => [...document.querySelectorAll('.doc-nm')].some((b) => b.getAttribute('aria-label') === n), name, { timeout: 30000 });
await win.waitForTimeout(300);
const toast = await win.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
want(!/too big/.test(toast), `opening says nothing about being too big: "${toast}"`);
// a hidden window has no OS focus, so the caret is placed the way f.select does; the typing is real keys
await win.evaluate(() => {
  const v = window.__falconView; let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isTextblock && n.textContent.length > 200) at = pos + 1; return at < 0; });
  const S = v.state.selection.constructor.near(v.state.doc.resolve(at)).constructor; v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, at))); v.focus();
});
await win.keyboard.type('CRASHPROOF ');
await win.waitForTimeout(2000); // the backup runs 800 ms after typing stops, at idle
const file = path.join(env.FALCON_USER_DATA, 'recovery.json');
want(fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('CRASHPROOF'), 'the edit is in userData/recovery.json');
if (shots) await win.screenshot({ path: path.join(shots, 'recovery-1-edited.png') });
app.process().kill('SIGKILL'); // the crash: no close, no pagehide
await new Promise((r) => setTimeout(r, 800));

app = await electron.launch(opts([]));
win = await app.firstWindow();
await win.setViewportSize({ width: 1300, height: 820 });
await win.waitForSelector('.ProseMirror');
await win.waitForTimeout(800);
const tabs = await win.evaluate(() => [...document.querySelectorAll('.doc-row')].map((r) => `${r.querySelector('.doc-nm')?.getAttribute('aria-label')}${r.querySelector('i[aria-label="unsaved"], .dot') ? ' (unsaved)' : ''}`));
const text = await win.evaluate(() => window.__falconView.state.doc.textContent);
want(tabs.includes(`${name} (unsaved)`), `after the crash the file is back, unsaved: ${tabs.join(', ')}`);
want(text.includes('CRASHPROOF'), 'with the edit in it');
if (shots) {
  await win.screenshot({ path: path.join(shots, 'recovery-2-relaunched.png') });
  await win.keyboard.press('Escape'); // Home -> the recovered file
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(shots, 'recovery-3-recovered-doc.png') });
}
await app.evaluate(() => { globalThis.falconSkipUnloadGuard = true; });
app.process().kill('SIGKILL');
