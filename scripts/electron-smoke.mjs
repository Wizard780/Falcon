// Launches the Electron app (dev tree, or a packaged build via FALCON_EXE) with no visible window,
// types and formats a card with the real keys, checks the result, and screenshots it.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const { ELECTRON_RUN_AS_NODE, ...env } = process.env; // set by some hosts; it turns Electron into plain Node
const exe = process.env.FALCON_EXE;
const app = await electron.launch(exe ? { executablePath: exe, env: { ...env, FALCON_HEADLESS: '1' } } : { args: ['.'], env: { ...env, FALCON_HEADLESS: '1' } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.ProseMirror');
await win.click('.ProseMirror');
await win.keyboard.press(`${mod}+a`); await win.keyboard.press('Backspace');
await win.keyboard.type('Electron tag'); await win.keyboard.press('F7'); await win.keyboard.press('Enter');
await win.keyboard.type('Body text in the desktop app');
// a hidden window has no OS focus, so the browser's own caret movement is off; select through the editor instead
const selectLast = (n) => win.evaluate((n) => { const v = window.__falconView; const S = v.state.selection.constructor; const to = v.state.selection.$head.end(); v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, to - n, to))); }, n);
await selectLast(3); await win.keyboard.press('F9'); await win.keyboard.press('F11');
await selectLast(11); await win.keyboard.press('F10');
const map = await win.evaluate(() => window.__falconMarkMap());
const bridge = await win.evaluate(() => Object.keys(window.falcon || {}).sort().join(','));
const platform = await win.evaluate(() => window.falcon?.platform);
const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
const menu = await app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).map((i) => i.label));
fs.mkdirSync('shots', { recursive: true });
await win.screenshot({ path: `shots/electron-${process.platform}.png` });
await app.close();

console.log(map, '\nplatform:', platform, '| bridge:', bridge, '| visible:', visible, '| menu:', menu);
const want = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } };
// emphasis replaced the underline on "app"; highlight stays on "app"
want(map === 'tag: Electron tag\nnormal: Body text in the [desktop ]{emphasis}[app]{emphasis+highlight:yellow}', `marks: ${JSON.stringify(map)}`);
want(bridge === 'openFile,platform,readClipboardText,saveFile', 'preload bridge');
want(visible.every((v) => !v), 'window stayed hidden');
want(process.platform === 'darwin' || menu.length === 0, 'no menu bar on Windows/Linux (F10 and Alt belong to the editor)');
want(!errors.length, `page errors: ${errors.join('; ')}`);
