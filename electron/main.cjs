// Falcon main process: one window, native file dialogs, and the clipboard bridge.
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createIndex } = require('./indexer.cjs');
const { createCardIndex } = require('./cards.cjs');
const updater = require('./updater.cjs');
const telemetry = require('./telemetry.cjs');

const DEV = process.env.FALCON_DEV === '1';
const HEADLESS = process.env.FALCON_HEADLESS === '1'; // tests: never show a window
// tests: a throwaway profile, so they never touch the user's recents, pens or crash-recovery copy
// tests: closing never waits on the unsaved-docs question (the smoke test turns this off to check it)
globalThis.falconSkipUnloadGuard = HEADLESS;
if (process.env.FALCON_USER_DATA) app.setPath('userData', process.env.FALCON_USER_DATA);
// One Falcon per profile: a second launch (Windows opens a double-clicked file that way) hands its
// files to the running one and quits. The lock lives in userData, so test runs (their own profile) never
// collide with it; dev runs skip it, so several checkouts can run at once.
const primary = DEV || app.requestSingleInstanceLock();
if (!primary) app.quit();

// The theme's background, kept from the last run, so the window opens in it instead of flashing graphite.
const themeFile = () => path.join(app.getPath('userData'), 'theme.json');
function lastTheme() {
  try {
    const t = JSON.parse(fsSync.readFileSync(themeFile(), 'utf8'));
    if (/^#[0-9a-f]{6}$/i.test(t.bg)) return { bg: t.bg, dark: t.dark !== false, system: t.system === true };
  } catch { /* first run, or no theme saved yet */ }
  return { bg: '#0f0f10', dark: true, system: false };
}

// System leaves the native theme on the OS setting: forcing it would also fix the page's prefers-color-scheme
const themeSource = (dark, system) => (system ? 'system' : dark ? 'dark' : 'light');

function createWindow() {
  const theme = lastTheme();
  nativeTheme.themeSource = themeSource(theme.dark, theme.system);
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    show: false,
    backgroundColor: theme.bg,
    title: 'Falcon',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true, // Chromium's checker: the system dictionary on a Mac, Hunspell on Windows and Linux
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
  win.webContents.on('context-menu', (_e, p) => {
    const items = contextMenu(win.webContents, p);
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  // a reload or crash drops the page's listener: hold OS opens until the new page asks again
  const unlisten = () => { if (openTarget === win.webContents) openTarget = null; };
  win.webContents.on('did-start-loading', unlisten);
  win.webContents.on('render-process-gone', unlisten);
  // the app is one page: block every navigation away from it
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  return win;
}

// Right-click: spelling suggestions and Add to Dictionary on a misspelled word, then Cut, Copy and Paste,
// the menu every text app has. Pages that draw their own menu (the outline) stop the event, so this never runs there.
function contextMenu(wc, p) {
  const items = [];
  if (p.misspelledWord) {
    const guesses = p.dictionarySuggestions.slice(0, 5);
    for (const g of guesses) items.push({ label: g, click: () => wc.replaceMisspelling(g) });
    if (!guesses.length) items.push({ label: 'No Guesses Found', enabled: false });
    items.push({ type: 'separator' },
      { label: 'Add to Dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) },
      { type: 'separator' });
  }
  if (p.isEditable) items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste });
  else if (p.selectionText) items.push({ role: 'copy' });
  return items;
}
globalThis.falconContextMenu = contextMenu; // the smoke test checks the menu a misspelled word gets

const DOCX = [{ name: 'Word documents', extensions: ['docx'] }];
// Files picked in a dialog in earlier sessions, so Home and the files panel can reopen them.
// Only paths in this list (and only .docx) can be opened without a dialog.
const MAX_RECENT = 50;
const recentFile = () => path.join(app.getPath('userData'), 'recent-paths.json');
let recentPaths = null;
let recentLoad = null; // one read, shared: several files opened at once must not each start from their own copy
function loadRecent() {
  recentLoad ??= fs.readFile(recentFile(), 'utf8')
    .then((t) => JSON.parse(t).filter((p) => typeof p === 'string'), () => [])
    .then((list) => { recentPaths = list; });
  return recentLoad.then(() => recentPaths); // the current list, not the one first read
}
let recentWrite = Promise.resolve(); // writes in order, so the file ends with the latest list
async function rememberPath(p) {
  await loadRecent();
  recentPaths = [p, ...recentPaths.filter((x) => x !== p)].slice(0, MAX_RECENT);
  recentWrite = recentWrite.then(() => fs.writeFile(recentFile(), JSON.stringify(recentPaths))).catch(() => { /* recents are a convenience */ });
  await recentWrite;
}

// Files the OS asks us to open: a double-click in Finder or Explorer, or Open With. macOS sends
// open-file (before ready, when the click is what launched the app); Windows puts the path on the command
// line, of this launch or of a second one. They wait here until the page says it's listening. Each becomes
// a recent, which is what lets the page's openPath read it.
const pendingOpens = [];
let openTarget = null; // the page listening for them
async function requestOpen(paths) {
  const docx = paths.filter((p) => typeof p === 'string' && p.toLowerCase().endsWith('.docx')).map((p) => path.resolve(p));
  for (const p of docx) await rememberPath(p);
  pendingOpens.push(...docx);
  flushOpens();
}
function flushOpens() {
  if (!app.isReady()) return; // whenReady makes the window, and its page asks for these
  if (!openTarget || openTarget.isDestroyed()) {
    openTarget = null;
    if (pendingOpens.length && BrowserWindow.getAllWindows().length === 0) createWindow(); // Mac: app open, no window
    return;
  }
  const win = BrowserWindow.fromWebContents(openTarget);
  if (win && !HEADLESS) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  if (pendingOpens.length) openTarget.send('falcon:open-paths', pendingOpens.splice(0));
}
if (primary) {
  app.on('open-file', (e, p) => { e.preventDefault(); void requestOpen([p]); });
  app.on('second-instance', (_e, argv) => { void requestOpen(argv.slice(1)); flushOpens(); });
  ipcMain.on('falcon:open-paths-ready', (e) => { openTarget = e.sender; flushOpens(); });
  void requestOpen(process.argv.slice(1));
}

// File search: the folders allowed in Settings (see indexer.cjs)
let fileIndex = null;
const index = () => (fileIndex ??= createIndex(path.join(app.getPath('userData'), 'index-folders.json')));
// Search cards: the cards in those same folders (see cards.cjs)
let cardIndex = null;
const cards = () => (cardIndex ??= createCardIndex(path.join(app.getPath('userData'), 'card-index.json'), () => index().files()));

let quitting = false; // the window is closing because the app is quitting (Cmd-Q), not just the window
app.on('before-quit', () => { quitting = true; });
ipcMain.on('falcon:force-close', (e, quit) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  win.falconForceClose = true;
  if (quit) app.quit(); else win.close();
});

let lastThemeJson = '';
ipcMain.on('falcon:theme', (e, bg, dark, system) => {
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return;
  BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(bg);
  nativeTheme.themeSource = themeSource(dark === true, system === true);
  const json = JSON.stringify({ bg, dark: dark === true, system: system === true });
  if (json !== lastThemeJson) { lastThemeJson = json; fs.writeFile(themeFile(), json).catch(() => { /* a convenience */ }); }
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
// the words the user added with Add to Dictionary, for Settings to list and remove
const dictWords = async (e) => (await e.sender.session.listWordsInSpellCheckerDictionary()).sort((a, b) => a.localeCompare(b));
ipcMain.handle('falcon:dict-words', dictWords);
ipcMain.handle('falcon:dict-remove', async (e, w) => {
  if (typeof w !== 'string') throw new Error('bad remove request');
  e.sender.session.removeWordFromSpellCheckerDictionary(w);
  return (await dictWords(e)).filter((x) => x !== w); // the list can lag the removal by a moment
});
ipcMain.handle('falcon:index-files', () => index().files());
ipcMain.handle('falcon:card-search', (_e, q) => cards().search(typeof q === 'string' ? q.slice(0, 200) : '', 60));
async function saveFile(e, opts) {
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
  try {
    await fs.writeFile(tmp, Buffer.from(opts.data));
    await fs.rename(tmp, p);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return { path: p, name: path.basename(p) };
}
// Saves run one at a time, in the order asked: a quick second save of a file can't mix its bytes into the first
// one's temp file, or finish first and be overwritten by the older copy.
let saving = Promise.resolve();
ipcMain.handle('falcon:save-file', (e, opts) => {
  const turn = saving.then(() => saveFile(e, opts));
  saving = turn.catch(() => {});
  return turn;
});

// "Mod-Shift-s" (a keymap name, as Settings saves it) as an Electron accelerator, "Cmd+Shift+S"
const ACC = { Mod: 'Cmd', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space' };
const accelerator = (k) => (k ? k.split(/-(?!$)/).map((p) => ACC[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join('+') : undefined);
const MENU_KEYS = { settings: 'Mod-,', new: 'Mod-n', newSpeech: 'Mod-Shift-n', open: 'Mod-o', save: 'Mod-s', saveAs: 'Mod-Shift-s', close: 'Mod-w' };

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
    { label: 'File', submenu: [item('New', 'new'), item('New Speech Doc…', 'newSpeech'), item('Open…', 'open'), { type: 'separator' }, item('Save', 'save'), item('Save As…', 'saveAs'), { type: 'separator' }, item('Close Document', 'close')] },
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

// anonymous feature counts (electron/telemetry.cjs); the page only sends them when Settings allows
ipcMain.on('falcon:track', (_e, event, props) => {
  if (telemetry.enabled({ dev: DEV, headless: HEADLESS })) telemetry.track(event, props);
});

if (primary) app.whenReady().then(() => {
  buildMenu();
  createWindow();
  updater.start();
  // read changed files into the card index after launch settles, so Search cards is current when first opened
  if (!HEADLESS) setTimeout(() => void cards().scan().catch(() => {}), 10000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
