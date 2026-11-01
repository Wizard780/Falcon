// Launches the built Electron app with no visible window, types a card, and screenshots it.
import { _electron as electron } from 'playwright';
const app = await electron.launch({ args: ['.'], env: (({ ELECTRON_RUN_AS_NODE, ...rest }) => ({ ...rest, FALCON_HEADLESS: '1' }))(process.env) });
const win = await app.firstWindow();
win.on('pageerror', (e) => console.log('PAGEERR', e.message, e.stack?.split('\n').slice(0, 8).join(' | ')));
await win.waitForSelector('.ProseMirror');
await win.click('.ProseMirror');
await win.keyboard.press('Meta+a'); await win.keyboard.press('Backspace');
await win.keyboard.type('Electron tag'); await win.keyboard.press('F7'); await win.keyboard.press('Enter');
await win.keyboard.type('Body text in the desktop app');
// a hidden window has no OS focus, so the browser's own caret movement is off; select through the editor instead
await win.evaluate(() => { const v = window.__falconView; const S = v.state.selection.constructor; const to = v.state.selection.from; v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, to - 3, to))); }); await win.keyboard.press('F9'); await win.keyboard.press('F11');
const map = await win.evaluate(() => window.__falconMarkMap());
const bridge = await win.evaluate(() => Object.keys(window.falcon || {}).join(','));
const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
await win.screenshot({ path: 'shots/electron.png' });
console.log(map, '\nbridge:', bridge, '\nvisible windows:', visible);
await app.close();
