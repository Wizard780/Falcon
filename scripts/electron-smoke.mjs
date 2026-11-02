// Launches the Electron app (dev tree, or a packaged build via FALCON_EXE) with no visible window,
// types and formats a card with the real keys, checks the result, and screenshots it.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const { ELECTRON_RUN_AS_NODE, ...env } = process.env; // set by some hosts; it turns Electron into plain Node
const exe = process.env.FALCON_EXE;
env.FALCON_USER_DATA = fs.mkdtempSync(`${os.tmpdir()}/falcon-smoke-`);
// any existing .docx, never picked in a dialog: Save must write it in place, with no dialog
const keptDoc = path.join(fs.mkdtempSync(`${os.tmpdir()}/falcon-kept-`), 'Kept.docx');
fs.writeFileSync(keptDoc, 'old');
const app = await electron.launch(exe ? { executablePath: exe, env: { ...env, FALCON_HEADLESS: '1' } } : { args: ['.'], env: { ...env, FALCON_HEADLESS: '1' } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.ProseMirror');
const homeAtLaunch = await win.evaluate(() => !!document.querySelector('.home.open'));
await win.keyboard.press('Escape'); await win.waitForTimeout(400); // close Home
const homeAfterEsc = await win.evaluate(() => !!document.querySelector('.home.open'));
// reopening by path only works for files picked in a dialog before
const strayOpen = await win.evaluate(() => window.falcon.openPath('/etc/hosts.docx').then(() => 'opened', (e) => 'refused: ' + e.message));
await win.click('.ProseMirror');
await win.keyboard.press(`${mod}+a`); await win.keyboard.press('Backspace');
await win.keyboard.type('Electron tag'); await win.keyboard.press('F7'); await win.keyboard.press('Enter');
await win.keyboard.type('Body text in the desktop app');
// a hidden window has no OS focus, so the browser's own caret movement is off; select through the editor instead
const selectLast = (n) => win.evaluate((n) => { const v = window.__falconView; const S = v.state.selection.constructor; const to = v.state.selection.$head.end(); v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, to - n, to))); }, n);
await selectLast(3); await win.keyboard.press('F9'); await win.keyboard.press('F11');
await selectLast(11); await win.keyboard.press('F10');
const map = await win.evaluate(() => window.__falconMarkMap());
// select "Body" in the page and press F9 in the same task, before selectionchange can run (what a
// busy page does with a key right after a selection): the key must format "Body", not the old selection
const raced = await win.evaluate(() => {
  const v = window.__falconView;
  const walk = document.createTreeWalker(v.dom, NodeFilter.SHOW_TEXT);
  let n; while ((n = walk.nextNode()) && !n.data.includes('Body'));
  const r = document.createRange(); const i = n.data.indexOf('Body'); r.setStart(n, i); r.setEnd(n, i + 4);
  getSelection().removeAllRanges(); getSelection().addRange(r);
  v.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', code: 'F9', keyCode: 120, bubbles: true, cancelable: true }));
  return window.__falconMarkMap().split('\n')[1];
});
// Electron builds the window's drag region in document order: drag elements add, no-drag ones cut.
// Replay that and list any visible button whose center ends up draggable (a click there moves the window).
const dragged = await win.evaluate(() => {
  const ops = [...document.querySelectorAll('*')].map((el) => ({ el, r: el.getBoundingClientRect(), a: getComputedStyle(el).getPropertyValue('-webkit-app-region').trim() }))
    .filter((o) => (o.a === 'drag' || o.a === 'no-drag') && o.r.width && o.r.height);
  const inDrag = (x, y) => ops.reduce((d, o) => (x >= o.r.left && x < o.r.right && y >= o.r.top && y < o.r.bottom ? o.a === 'drag' : d), false);
  return [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length && !b.closest('[inert]'))
    .filter((b) => { const r = b.getBoundingClientRect(); return inDrag(r.left + r.width / 2, r.top + r.height / 2); })
    .map((b) => b.getAttribute('aria-label') || b.textContent.trim());
});
const savedInPlace = await win.evaluate((p) => Promise.race([
  window.falcon.saveFile({ path: p, name: 'Kept.docx', data: new Uint8Array([80, 75]) }).then((r) => r?.path ?? 'null'),
  new Promise((ok) => setTimeout(() => ok('dialog'), 3000)),
]), keptDoc);
// a file that was moved away: Save asks where, starting in its old folder (dialog stubbed, so nothing shows)
const gone = path.join(path.dirname(keptDoc), 'Moved.docx');
await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async (_w, o) => { globalThis.__asked = o.defaultPath; return { canceled: true }; }; });
const goneResult = await win.evaluate((p) => window.falcon.saveFile({ path: p, name: 'Moved.docx', data: new Uint8Array([80, 75]) }), gone);
const askedAt = await app.evaluate(() => globalThis.__asked);
const bridge = await win.evaluate(() => Object.keys(window.falcon || {}).sort().join(','));
const platform = await win.evaluate(() => window.falcon?.platform);
const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
const menu = await app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).map((i) => i.label));
fs.mkdirSync('shots', { recursive: true });
// Windows doesn't paint hidden windows; on CI runners (no user to disturb) show it without focus to capture it
if (process.env.CI) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.showInactive()));
try { await win.screenshot({ path: `shots/electron-${process.platform}.png`, timeout: 15000 }); }
catch (e) { console.error('screenshot failed:', e.message.split('\n')[0]); process.exitCode = 1; }
await app.close();

console.log(map, '\nplatform:', platform, '| bridge:', bridge, '| visible:', visible, '| menu:', menu);
const want = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } };
// emphasis replaced the underline on "app"; highlight stays on "app"
want(map === 'tag: Electron tag\nnormal: Body text in the [desktop ]{emphasis}[app]{emphasis+highlight:yellow}', `marks: ${JSON.stringify(map)}`);
want(bridge === 'onMenu,openFile,openPath,platform,readClipboardText,saveFile', 'preload bridge');
want(homeAtLaunch && !homeAfterEsc, 'Home shows at launch and Esc closes it');
want(strayOpen.startsWith('refused'), `openPath refuses files never picked: ${strayOpen}`);
want(visible.every((v) => !v), 'window stayed hidden (checked before any CI-only capture)');
want(process.platform === 'darwin' || menu.length === 0, 'no menu bar on Windows/Linux (F10 and Alt belong to the editor)');
want(!dragged.length, `buttons under a window-drag region (clicks would be dead): ${dragged.join(', ')}`);
want(savedInPlace === keptDoc && fs.readFileSync(keptDoc, 'utf8') === 'PK', `Save writes any existing .docx in place: ${savedInPlace}`);
want(goneResult === null && askedAt === gone && !fs.existsSync(gone), `a moved file gets Save As in its old folder, not a silent recreate: ${askedAt}`);
want(raced.startsWith('normal: [Body]{underline} text'), `a key right after a new selection formats that selection: ${raced}`);
want(!errors.length, `page errors: ${errors.join('; ')}`);
