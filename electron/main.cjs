// Falcon main process: one window, native file dialogs, and the clipboard bridge.
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createIndex } = require('./indexer.cjs');

const DEV = process.env.FALCON_DEV === '1';
const HEADLESS = process.env.FALCON_HEADLESS === '1'; // tests: never show a window
// tests: a throwaway profile, so they never touch the user's recents, pens or crash-recovery copy
// tests: closing never waits on the unsaved-docs question (the smoke test turns this off to check it)
globalThis.falconSkipUnloadGuard = HEADLESS;
if (process.env.FALCON_USER_DATA) app.setPath('userData', process.env.FALCON_USER_DATA);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    show: false,
    backgroundColor: '#0f0f10',
    title: 'Falcon',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (!HEADLESS) win.once('ready-to-show', () => win.show());
  if (DEV) win.loadURL('http://localhost:5173/');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // links open in the browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // the page blocks unloading while a doc is unsaved: the close stops here, and the page asks in its own
  // dialog. If the user says close anyway, the page sends falcon:force-close and the next try goes through.
  win.webContents.on('will-prevent-unload', (e) => {
    if (globalThis.falconSkipUnloadGuard || win.falconForceClose) { e.preventDefault(); return; }
    // the question shows in the window: bring it forward, or a quit from the Dock would look like it did nothing
    if (win.isMinimized()) win.restore();
    if (!HEADLESS) { win.show(); win.focus(); }
    win.webContents.send('falcon:confirm-close', quitting);
    quitting = false; // a cancelled quit is over; a confirmed one quits again
  });
  // the app is one page: block every navigation away from it
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  return win;
}

const DOCX = [{ name: 'Word documents', extensions: ['docx'] }];
// Files picked in a dialog in earlier sessions, so Home and the files panel can reopen them.
// Only paths in this list (and only .docx) can be opened without a dialog.
const MAX_RECENT = 50;
const recentFile = () => path.join(app.getPath('userData'), 'recent-paths.json');
let recentPaths = null;
async function loadRecent() {
  if (recentPaths) return recentPaths;
  try { recentPaths = JSON.parse(await fs.readFile(recentFile(), 'utf8')).filter((p) => typeof p === 'string'); }
  catch { recentPaths = []; }
  return recentPaths;
}
async function rememberPath(p) {
  const list = await loadRecent();
  recentPaths = [p, ...list.filter((x) => x !== p)].slice(0, MAX_RECENT);
  try { await fs.writeFile(recentFile(), JSON.stringify(recentPaths)); } catch { /* recents are a convenience */ }
}

// File search: the folders allowed in Settings (see indexer.cjs)
let fileIndex = null;
const index = () => (fileIndex ??= createIndex(path.join(app.getPath('userData'), 'index-folders.json')));

let quitting = false; // the window is closing because the app is quitting (Cmd-Q), not just the window
app.on('before-quit', () => { quitting = true; });
ipcMain.on('falcon:force-close', (e, quit) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  win.falconForceClose = true;
  if (quit) app.quit(); else win.close();
});

ipcMain.handle('falcon:read-clipboard-text', () => clipboard.readText());
ipcMain.handle('falcon:open-file', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: DOCX });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = path.resolve(r.filePaths[0]);
  await rememberPath(p);
  return { name: path.basename(p), path: p, data: new Uint8Array(await fs.readFile(p)) };
});
ipcMain.handle('falcon:open-path', async (_e, p) => {
  if (typeof p !== 'string') throw new Error('bad open request');
  const abs = path.resolve(p);
  if (!abs.toLowerCase().endsWith('.docx')) throw new Error('Falcon only opens .docx files');
  if (!(await loadRecent()).includes(abs) && !(await index().allows(abs))) throw new Error('Open this file with Open first');
  const data = new Uint8Array(await fs.readFile(abs));
  await rememberPath(abs);
  return { name: path.basename(abs), path: abs, data };
});
ipcMain.handle('falcon:index-folders', () => index().folders());
ipcMain.handle('falcon:index-add', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { title: 'Add folders to file search', buttonLabel: 'Add', properties: ['openDirectory', 'multiSelections'] });
  if (!r.canceled && r.filePaths.length) await index().add(r.filePaths);
  return index().folders();
});
ipcMain.handle('falcon:index-remove', async (_e, p) => {
  if (typeof p !== 'string') throw new Error('bad remove request');
  await index().remove(p);
  return index().folders();
});
ipcMain.handle('falcon:index-files', () => index().files());
ipcMain.handle('falcon:save-file', async (e, opts) => {
  if (!opts || !(opts.data instanceof Uint8Array)) throw new Error('bad save request');
  // Save writes straight into the document's own file, wherever it lives, as long as it's still there.
  // A file that was moved or deleted gets Save As, opened in its old folder (writing to the stale path
  // would quietly recreate it there).
  const asked = typeof opts.path === 'string' && opts.path.toLowerCase().endsWith('.docx') ? path.resolve(opts.path) : null;
  let p = asked && (await fs.stat(asked).then((s) => s.isFile(), () => false)) ? asked : null;
  if (!p) {
    const win = BrowserWindow.fromWebContents(e.sender);
    const name = typeof opts.name === 'string' ? path.basename(opts.name) : 'Untitled.docx';
    const dir = asked && (await fs.stat(path.dirname(asked)).then((s) => s.isDirectory(), () => false)) ? path.dirname(asked) : null;
    const r = await dialog.showSaveDialog(win, { defaultPath: dir ? path.join(dir, name) : name, filters: DOCX });
    if (r.canceled || !r.filePath) return null;
    p = path.resolve(r.filePath.toLowerCase().endsWith('.docx') ? r.filePath : `${r.filePath}.docx`);
    await rememberPath(p);
  }
  if (!p.toLowerCase().endsWith('.docx')) throw new Error('Falcon only saves .docx files');
  // write to a temp file first so a crash mid-save never truncates the real file
  const tmp = `${p}.falcon-tmp`;
  await fs.writeFile(tmp, Buffer.from(opts.data));
  await fs.rename(tmp, p);
  return { path: p, name: path.basename(p) };
});

// "Mod-Shift-s" (a keymap name, as Settings saves it) as an Electron accelerator, "Cmd+Shift+S"
const ACC = { Mod: 'Cmd', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space' };
const accelerator = (k) => (k ? k.split(/-(?!$)/).map((p) => ACC[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join('+') : undefined);
const MENU_KEYS = { settings: 'Mod-,', new: 'Mod-n', open: 'Mod-o', save: 'Mod-s', saveAs: 'Mod-Shift-s', close: 'Mod-w' };

function buildMenu(keys = MENU_KEYS) {
  const mac = process.platform === 'darwin';
  // Windows/Linux: no menu bar. A visible one takes F10 (Emphasis) and Alt for itself, and
  // Ctrl-C/X/V/A already work in the editor without menu roles.
  if (!mac) { Menu.setApplicationMenu(null); return; }
  // File items show their shortcuts but don't take the keys (registerAccelerator: false): the page
  // already handles them, and a menu accelerator would swallow the key before the page sees it.
  const send = (cmd) => (_item, win) => win?.webContents.send('falcon:menu', cmd);
  const item = (label, cmd) => ({ label, accelerator: accelerator(keys[cmd]), registerAccelerator: false, click: send(cmd) });
  // Edit roles give Cmd/Ctrl-C/X/V/A to the editor; the editor handles its own undo, so no undo roles here.
  const template = [
    { role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, item('Settings…', 'settings'), { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [item('New', 'new'), item('Open…', 'open'), { type: 'separator' }, item('Save', 'save'), item('Save As…', 'saveAs'), { type: 'separator' }, item('Close Document', 'close')] },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    // no fullscreen/reload roles: their default keys (F11, F5, Ctrl-R) are formatting keys here
    ...(DEV ? [{ label: 'Dev', submenu: [{ role: 'reload', accelerator: 'CmdOrCtrl+Alt+R' }, { role: 'toggleDevTools' }] }] : []),
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Settings > Keybindings changed a File menu key: show the new one
ipcMain.on('falcon:menu-keys', (_e, keys) => {
  if (!keys || typeof keys !== 'object') return;
  const clean = {};
  for (const id of Object.keys(MENU_KEYS)) clean[id] = typeof keys[id] === 'string' ? keys[id] : MENU_KEYS[id];
  try { buildMenu(clean); } catch { buildMenu(); }
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
