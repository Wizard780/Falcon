// Falcon main process: one window, native file dialogs, and the clipboard bridge.
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEV = process.env.FALCON_DEV === '1';
const HEADLESS = process.env.FALCON_HEADLESS === '1'; // tests: never show a window
// tests: a throwaway profile, so they never touch the user's recents, pens or crash-recovery copy
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
  // the app is one page: block every navigation away from it
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  return win;
}

const DOCX = [{ name: 'Word documents', extensions: ['docx'] }];
// The page can only save over files the user picked in a dialog this session, and only .docx.
const userPaths = new Set();
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
  userPaths.add(p);
  const list = await loadRecent();
  recentPaths = [p, ...list.filter((x) => x !== p)].slice(0, MAX_RECENT);
  try { await fs.writeFile(recentFile(), JSON.stringify(recentPaths)); } catch { /* recents are a convenience */ }
}

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
  if (!abs.toLowerCase().endsWith('.docx') || !(await loadRecent()).includes(abs)) throw new Error('Open this file with Open first');
  const data = new Uint8Array(await fs.readFile(abs));
  await rememberPath(abs);
  return { name: path.basename(abs), path: abs, data };
});
ipcMain.handle('falcon:save-file', async (e, opts) => {
  if (!opts || !(opts.data instanceof Uint8Array)) throw new Error('bad save request');
  let p = typeof opts.path === 'string' && userPaths.has(path.resolve(opts.path)) ? path.resolve(opts.path) : null;
  if (!p) {
    const win = BrowserWindow.fromWebContents(e.sender);
    const name = typeof opts.name === 'string' ? path.basename(opts.name) : 'Untitled.docx';
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: DOCX });
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

function buildMenu() {
  const mac = process.platform === 'darwin';
  // Windows/Linux: no menu bar. A visible one takes F10 (Emphasis) and Alt for itself, and
  // Ctrl-C/X/V/A already work in the editor without menu roles.
  if (!mac) { Menu.setApplicationMenu(null); return; }
  // File items show their shortcuts but don't take the keys (registerAccelerator: false): the page
  // already handles them, and a menu accelerator would swallow the key before the page sees it.
  const send = (cmd) => (_item, win) => win?.webContents.send('falcon:menu', cmd);
  const item = (label, accelerator, cmd) => ({ label, accelerator, registerAccelerator: false, click: send(cmd) });
  // Edit roles give Cmd/Ctrl-C/X/V/A to the editor; the editor handles its own undo, so no undo roles here.
  const template = [
    { role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, item('Settings…', 'Cmd+,', 'settings'), { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [item('New', 'Cmd+N', 'new'), item('Open…', 'Cmd+O', 'open'), { type: 'separator' }, item('Save', 'Cmd+S', 'save'), item('Save As…', 'Cmd+Shift+S', 'saveAs'), { type: 'separator' }, item('Close Document', 'Cmd+W', 'close')] },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    // no fullscreen/reload roles: their default keys (F11, F5, Ctrl-R) are formatting keys here
    ...(DEV ? [{ label: 'Dev', submenu: [{ role: 'reload', accelerator: 'CmdOrCtrl+Alt+R' }, { role: 'toggleDevTools' }] }] : []),
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
