// Falcon main process: the windows, native file dialogs, and the clipboard bridge.
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme, net, safeStorage, shell, utilityProcess } = require('electron');
const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createIndex } = require('./indexer.cjs');
const updater = require('./updater.cjs');
const speechdrop = require('./speechdrop.cjs');
const telemetry = require('./telemetry.cjs');
const { createEditorBridge, bridgeDir } = require('./editor-bridge.cjs');
const { createSecrets, askSecret, promptSecret } = require('./secrets.cjs');

const DEV = process.env.FALCON_DEV === '1';
const HEADLESS = process.env.FALCON_HEADLESS === '1'; // tests: never show a window
// scripts/idle-bench.mjs: a shown window that paints like the user's, but can't be seen or clicked (macOS keeps
// 40px of any window on screen, so it's see-through too), and isn't slowed for being out of sight
const BENCH = process.env.FALCON_BENCH === '1';
if (BENCH) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}
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

// The document windows, by page. All of them load the same page and share its storage, so each gets a `slot`
// to keep its crash-recovery copy under ('' for the first), and tells us what it holds: `paths` are its open
// files, `speech` the name of the speech doc when it has it. `start` is what a new window opens with.
const windows = new Map(); // webContents -> { win, slot, paths, speech, start, listening, ready, isReady }
let speechHolder = null; // the page holding the speech doc: there is one for the whole app
let nextSlot = 0;
const focusWin = (win) => { globalThis.falconFocused = win.id; if (!HEADLESS) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } };
/** The window a request with no window of its own goes to: the focused one, or else the newest. */
function frontPage(ok = () => true) {
  const live = [...windows].filter(([wc, w]) => !wc.isDestroyed() && ok(w));
  return (live.find(([, w]) => w.win.isFocused()) ?? live[live.length - 1])?.[0] ?? null;
}
/** Tell every page what the others hold: the files for Restore open files, and whether they have the speech doc. */
function tellWindows() {
  const session = [...new Set([...windows.values()].flatMap((w) => w.paths))];
  const speech = speechHolder && windows.get(speechHolder)?.speech;
  for (const wc of windows.keys()) if (!wc.isDestroyed()) wc.send('falcon:windows', { session, speech: wc === speechHolder ? null : speech ?? null });
}

function createWindow(start = null) {
  const theme = lastTheme();
  nativeTheme.themeSource = themeSource(theme.dark, theme.system);
  // a new window starts down and right of the newest one, so it doesn't land exactly on top of it
  const from = [...windows.values()].at(-1)?.win.getBounds();
  const win = new BrowserWindow({
    width: from?.width ?? 1400,
    height: from?.height ?? 900,
    ...(from ? { x: from.x + 28, y: from.y + 28 } : {}),
    minWidth: 800,
    minHeight: 500,
    show: false,
    ...(BENCH ? { x: -20000, y: -20000, opacity: 0, focusable: false, hasShadow: false } : {}),
    backgroundColor: theme.bg,
    title: 'Falcon',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // the round's clocks run in this page and draw into the timer window, which stays up when this one is hidden
      spellcheck: true, // Chromium's checker: the system dictionary on a Mac, Hunspell on Windows and Linux
    },
  });
  const page = win.webContents;
  const entry = { win, slot: windows.size ? `${Date.now().toString(36)}-${nextSlot++}` : '', paths: start?.path ? [start.path] : [], unsaved: [], speech: start?.speech ?? null, start, listening: false, isReady: () => {} };
  entry.ready = new Promise((resolve) => { entry.isReady = resolve; });
  windows.set(page, entry);
  if (entry.speech) { speechHolder = page; tellWindows(); } // now, not when its page is up: a send meanwhile must find it
  win.once('closed', () => {
    windows.delete(page);
    entry.isReady();
    if (speechHolder === page) speechHolder = null;
    if (!keepSession) tellWindows();
  });
  if (BENCH) win.once('ready-to-show', () => { win.setIgnoreMouseEvents(true); win.showInactive(); });
  else if (!HEADLESS) win.once('ready-to-show', () => (start?.inactive ? win.showInactive() : win.show()));
  if (DEV) win.loadURL('http://localhost:5173/');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // links open in the browser, never inside the app
  // except the timer window (src/ui/TimerWindow.tsx): a blank page the app draws its clocks into, kept on top
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === 'falcon-timer' && url === 'about:blank') {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 300, height: 312, useContentSize: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        alwaysOnTop: true, show: !HEADLESS, title: 'Timer', backgroundColor: lastTheme().bg, autoHideMenuBar: true,
      } };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => {
    child.setMenu(null); // Windows and Linux: no File menu bar on a clock
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', (e) => e.preventDefault());
    const closeChild = () => { if (!child.isDestroyed()) child.close(); };
    win.once('closed', closeChild);
    child.once('closed', () => { if (!win.isDestroyed()) win.removeListener('closed', closeChild); });
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
  const unlisten = () => { entry.listening = false; entry.answers = false; };
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
// A backfile's bytes wait here for a GC after they're sent, and this process's heap is too small to start one on its
// own for a long while: 40 MB more after three backfiles open. So ask for one when the opens stop. Not after each
// crash-recovery write (every typing pause in a big file, and a full GC grows with the card index): V8 collects
// those itself once they add up. --expose-gc set now reaches a new context's globals.
require('node:v8').setFlagsFromString('--expose-gc');
const collect = require('node:vm').runInNewContext('gc');
let collectTimer = null;
const collectSoon = () => { clearTimeout(collectTimer); collectTimer = setTimeout(collect, 1000); };
// A file's bytes for the page: the Buffer read, not a copy (a 16 MB backfile would sit here twice). Copied only when
// it's a slice of a shared pool, since IPC sends a view's whole ArrayBuffer
const readBytes = async (p) => { const b = await fs.readFile(p); collectSoon(); return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? new Uint8Array(b.buffer) : new Uint8Array(b); };
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

// Files picked for a template in Settings. The picker is the say-so, as with Open, and unlike recents they never
// age out, so a template still opens long after its files were last used.
const templateFile = () => path.join(app.getPath('userData'), 'template-paths.json');
let templateLoad = null;
const templatePaths = () => (templateLoad ??= fs.readFile(templateFile(), 'utf8')
  .then((t) => new Set(JSON.parse(t).filter((p) => typeof p === 'string')))
  .catch(() => new Set())); // missing or damaged: every other way of opening a file waits on this, so it can't throw

// Files the OS asks us to open: a double-click in Finder or Explorer, or Open With. macOS sends
// open-file (before ready, when the click is what launched the app); Windows puts the path on the command
// line, of this launch or of a second one. They wait here until the page says it's listening. Each becomes
// a recent, which is what lets the page's openPath read it.
const pendingOpens = [];
async function requestOpen(paths) {
  const docx = paths.filter((p) => typeof p === 'string' && p.toLowerCase().endsWith('.docx')).map((p) => path.resolve(p));
  for (const p of docx) await rememberPath(p);
  pendingOpens.push(...docx);
  flushOpens();
}
function flushOpens() {
  if (!app.isReady()) return; // whenReady makes the window, and its page asks for these
  const target = frontPage((w) => w.listening); // the page listening for them
  if (!target) {
    if (pendingOpens.length && !windows.size) createWindow(); // Mac: app open, no window
    return;
  }
  focusWin(windows.get(target).win);
  if (pendingOpens.length) target.send('falcon:open-paths', pendingOpens.splice(0));
}
if (primary) {
  app.on('open-file', (e, p) => { e.preventDefault(); void requestOpen([p]); });
  app.on('second-instance', (_e, argv) => { void requestOpen(argv.slice(1)); flushOpens(); });
  ipcMain.on('falcon:open-paths-ready', (e) => { const w = windows.get(e.sender); if (w) w.listening = true; flushOpens(); });
  // the page is up but the app isn't (the crash screen): hold opens until Reload brings a listener back
  ipcMain.on('falcon:open-paths-gone', (e) => { const w = windows.get(e.sender); if (w) w.listening = false; });
  void requestOpen(process.argv.slice(1));
}

// File search: the folders allowed in Settings (see indexer.cjs)
let fileIndex = null;
const index = () => (fileIndex ??= createIndex(path.join(app.getPath('userData'), 'index-folders.json')));
// Search cards: the cards in those same folders (see cards.cjs), kept by a process that only runs while it's used
// (cards-host.cjs). A search sent just as it quits idle goes to a new one.
let cardHost = null;
const cardAsks = new Map();
let cardNext = 0;
function cardProcess() {
  if (cardHost) return cardHost;
  const child = (cardHost = utilityProcess.fork(path.join(__dirname, 'cards-host.cjs'), [path.join(app.getPath('userData'), 'card-index.json')], { serviceName: 'Falcon card search' }));
  child.on('message', (m) => {
    if (m.files) {
      index().files().then((list) => child.postMessage({ files: m.files, list }), (e) => child.postMessage({ files: m.files, error: String(e?.message ?? e) }));
      return;
    }
    const a = cardAsks.get(m.id);
    if (!a) return;
    cardAsks.delete(m.id);
    if (m.error) a.reject(new Error(m.error)); else a.resolve(m.r);
  });
  child.once('exit', () => {
    if (cardHost === child) cardHost = null;
    for (const a of cardAsks.values()) if (a.child === child) sendCardAsk(a);
  });
  return child;
}
function sendCardAsk(a) {
  if (a.tries++ >= 3) { cardAsks.delete(a.msg.id); a.reject(new Error('Search cards stopped')); return; }
  a.child = cardProcess();
  a.child.postMessage(a.msg);
}
const searchCards = (query, limit, hide) => new Promise((resolve, reject) => {
  const a = { msg: { id: ++cardNext, query, limit, hide }, resolve, reject, tries: 0, child: null };
  cardAsks.set(a.msg.id, a);
  sendCardAsk(a);
});

let quitting = false; // the window is closing because the app is quitting (Cmd-Q), not just the window
// a quit keeps the list of open files, for Restore open files. Windows close while others still ask about unsaved
// work, so this lasts past `quitting`, until a page reports in: then a window said Cancel and the app is in use
let keepSession = false;
app.on('before-quit', () => { quitting = true; keepSession = true; });
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
  return { name: path.basename(p), path: p, data: await readBytes(p) };
});
ipcMain.handle('falcon:open-path', async (_e, p) => {
  if (typeof p !== 'string') throw new Error('bad open request');
  const abs = path.resolve(p);
  if (!abs.toLowerCase().endsWith('.docx')) throw new Error('Falcon only opens .docx files');
  if (!(await loadRecent()).includes(abs) && !(await templatePaths()).has(abs) && !(await index().allows(abs))) throw new Error('Open this file with Open first');
  const data = await readBytes(abs);
  await rememberPath(abs);
  return { name: path.basename(abs), path: abs, data };
});
ipcMain.handle('falcon:pick-template-files', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { title: 'Add files to template', buttonLabel: 'Add', properties: ['openFile', 'multiSelections'], filters: DOCX });
  if (r.canceled) return [];
  const picked = r.filePaths.map((p) => path.resolve(p)), allowed = await templatePaths();
  for (const p of picked) allowed.add(p);
  await fs.writeFile(templateFile(), JSON.stringify([...allowed])).catch(() => { /* still opens until Falcon quits */ });
  return picked;
});
ipcMain.handle('falcon:index-folders', () => index().folders());
ipcMain.handle('falcon:index-add', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { title: 'Add folders to file search', buttonLabel: 'Add', properties: ['openDirectory', 'multiSelections'] });
  if (!r.canceled && r.filePaths.length) await index().add(r.filePaths);
  return index().folders();
});
// a settings import naming search folders: only real folders on this computer get added
ipcMain.handle('falcon:index-import', async (e, paths) => {
  if (!Array.isArray(paths)) throw new Error('bad import request');
  const real = [];
  for (const p of paths.slice(0, 50)) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
    if (await fs.stat(p).then((s) => s.isDirectory(), () => false)) real.push(p);
  }
  // the allowed folders decide which files the page can read, so the user says yes, as with the picker
  if (real.length) {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Add folders', 'Skip'], defaultId: 0, cancelId: 1,
      message: `Add ${real.length === 1 ? 'this folder' : `these ${real.length} folders`} to file search?`,
      detail: real.join('\n'),
    });
    if (r.response === 0) await index().add(real);
  }
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
ipcMain.handle('falcon:card-search', (_e, q, hidden) => searchCards(typeof q === 'string' ? q.slice(0, 200) : '', 60, Array.isArray(hidden) ? hidden.filter((h) => typeof h === 'string') : []));
// the same file whatever the case of its name, on the Mac's and Windows' case-insensitive disks
const samePath = (a, b) => (process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase());
const openElsewhere = (sender, p) => [...windows].some(([wc, w]) => wc !== sender && w.paths.some((q) => samePath(q, p)));
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
    // a file open in another window: that window would write its own copy over this one on its next Save
    if (openElsewhere(e.sender, p)) throw new Error(`${path.basename(p)} is open in another window. Close it there first, or save under another name.`);
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

// Crash recovery for docs too big for the page's localStorage (about 5M characters, so any block file): the
// page sends their backup here and it's kept in userData. Only the newest copy waits while one is written, and
// each write goes through a temp file so a crash mid-write keeps the last good copy. Empty removes the file.
// The preload sends it as UTF-8 bytes: a string would arrive as a second two-byte copy (60 MB for a 30 MB
// backfile) and be encoded again for the write.
// Each window has its own file, named by its slot.
const recoveryFile = (slot = '') => path.join(app.getPath('userData'), slot ? `recovery-${slot}.json` : 'recovery.json');
const recoveryQueues = new Map(); // slot -> { next, busy }
function writeRecovery(slot, text) {
  const q = recoveryQueues.get(slot) ?? { next: null, busy: null };
  recoveryQueues.set(slot, q);
  q.next = text;
  q.busy ??= (async () => {
    while (q.next !== null) {
      const t = q.next;
      q.next = null;
      const p = recoveryFile(slot), tmp = `${p}.tmp`;
      try {
        if (!t.length) await fs.rm(p, { force: true });
        else { await fs.writeFile(tmp, t); await fs.rename(tmp, p); }
      } catch { /* a full disk: the next backup tries again */ }
    }
    q.busy = null;
  })();
}
ipcMain.on('falcon:recovery-write', (e, text) => { if (typeof text === 'string' || text instanceof Uint8Array) writeRecovery(windows.get(e.sender)?.slot ?? '', text); });
// read once, as the page starts: synchronous, so these docs come back with the rest before the first render
ipcMain.on('falcon:recovery-read', (e) => {
  try { e.returnValue = fsSync.readFileSync(recoveryFile(windows.get(e.sender)?.slot), 'utf8'); } catch { e.returnValue = ''; }
});
// The only window left picks up what closed or crashed windows left in their files. The files go as they're read:
// the page's next backup holds whatever it keeps.
ipcMain.on('falcon:recovery-orphans', (e) => {
  const dir = app.getPath('userData'), out = [], own = path.basename(recoveryFile(windows.get(e.sender)?.slot));
  try {
    for (const f of fsSync.readdirSync(dir)) {
      if (!/^recovery-.+\.json$/.test(f) || f === own) continue;
      try { out.push(fsSync.readFileSync(path.join(dir, f), 'utf8')); fsSync.rmSync(path.join(dir, f), { force: true }); } catch { /* unreadable: skip it */ }
    }
  } catch { /* no folder yet */ }
  e.returnValue = out;
});

// What a page needs before its first render: its slot, whether it's the only window (so it takes over what the
// others left), and what it was opened with. A reload gets the slot alone and comes back from its own backup.
ipcMain.on('falcon:window-start', (e) => {
  const w = windows.get(e.sender);
  e.returnValue = { slot: w?.slot ?? '', alone: windows.size <= 1, ...w?.start };
  if (w) w.start = null;
});
// Open a file or a doc in a window of its own. A file already open in another window is shown there instead,
// `alone` or not; answers false when the page should open it itself.
ipcMain.on('falcon:window-open', (e, r) => {
  const p = typeof r?.path === 'string' ? r.path : undefined;
  const there = p && !r.backup && [...windows].find(([wc, w]) => wc !== e.sender && w.paths.includes(p));
  if (there) {
    focusWin(there[1].win);
    void askPage('shown', { path: p, card: r.card }, there[0]);
    e.returnValue = true;
    return;
  }
  // a file that's gone (moved or deleted since a template or the last session listed it) gets no window of its
  // own: the page tries it itself and says it couldn't open it, or skips it, instead of leaving an empty window
  if (r?.alone && p && !r.backup && !fsSync.statSync(p, { throwIfNoEntry: false })?.isFile()) { e.returnValue = false; return; }
  if (r?.alone) createWindow({ path: p, card: r.card, backup: typeof r.backup === 'string' ? r.backup : undefined, speech: typeof r.speech === 'string' ? r.speech : null, inactive: r.inactive === true, caretEnd: r.caretEnd === true });
  e.returnValue = r?.alone === true;
});
// the last doc in this window closed: the window goes too, unless it's the only one
ipcMain.on('falcon:window-leave', (e) => {
  const w = windows.get(e.sender);
  const leaving = !!w && windows.size > 1;
  e.returnValue = leaving;
  if (leaving) { w.win.falconForceClose = true; setImmediate(() => { if (!w.win.isDestroyed()) w.win.close(); }); }
});
ipcMain.on('falcon:window-cycle', (e, dir) => {
  const list = [...windows.values()], i = list.findIndex((w) => w === windows.get(e.sender));
  if (i >= 0 && list.length > 1) focusWin(list[(i + (dir < 0 ? -1 : 1) + list.length) % list.length].win);
});
ipcMain.on('falcon:window-report', (e, r) => {
  const w = windows.get(e.sender);
  if (!w) return;
  keepSession = false;
  const speech = typeof r?.speech === 'string' ? r.speech : null;
  // only a doc newly marked takes the speech doc over: a report sent before this page heard it was taken mustn't take it back
  if (speech && !w.speech) speechHolder = e.sender;
  else if (!speech && speechHolder === e.sender) speechHolder = null;
  w.speech = speech;
  w.paths = Array.isArray(r?.paths) ? r.paths.filter((p) => typeof p === 'string') : [];
  w.unsaved = Array.isArray(r?.unsaved) ? r.unsaved.filter((n) => typeof n === 'string').slice(0, 200) : [];
  tellWindows();
});
// the names of unsaved docs in the app's other windows: an update restarts every window, so its question lists them too
ipcMain.on('falcon:window-unsaved', (e) => { e.returnValue = [...windows].flatMap(([wc, w]) => (wc === e.sender ? [] : w.unsaved)); });
// Send to speech from a window that doesn't hold the speech doc: the page that does puts it in
ipcMain.handle('falcon:speech-ask', (e, kind, payload) => (speechHolder && speechHolder !== e.sender ? askPage(kind, payload, speechHolder) : { ok: false, error: 'no-target-doc' }));

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
// SpeechDrop: the SpeechDrop tab's room, files and uploads (electron/speechdrop.cjs). The URLs can point
// at a local stand-in for tests; downloads land in ~/Downloads/SpeechDrop/<room>/, as the plugin's did.
const sd = speechdrop.createSpeechDrop({
  base: process.env.FALCON_SD_BASE || undefined,
  media: process.env.FALCON_SD_MEDIA || undefined,
});
const sdDownloads = () => process.env.FALCON_SD_DOWNLOADS || path.join(app.getPath('downloads'), 'SpeechDrop');
// one watcher per room joined (a tab each), each owned by the page that asked for it
const sdWatches = new Map(); // room -> { w, wc }
const sdWatcher = (room) => speechdrop.createWatcher({
  wsUrl: process.env.FALCON_SD_WS || undefined,
  WebSocketImpl: process.env.FALCON_SD_WS === 'off' ? null : globalThis.WebSocket,
  list: (r) => sd.list(r),
  onFiles: (u) => { const x = sdWatches.get(room); if (x && !x.wc.isDestroyed()) x.wc.send('falcon:sd-files', u); },
});
const sdStop = (room) => { const x = sdWatches.get(room); if (x) { sdWatches.delete(room); x.w.stop(); } };
// files come from strangers: Falcon opens .docx itself, and hands only plain document types to their app
// (.doc, .rtf and .docm can carry macros or embedded objects, and Falcon's downloads have no quarantine mark: those only show in the folder)
const SD_OPENS = new Set(['.pdf', '.txt', '.odt', '.pages']);
const sdSafe = (f) => async (_e, ...a) => {
  try { return { ok: true, value: await f(_e, ...a) }; } catch (err) { return { ok: false, error: String(err?.message || err) }; }
};
/** Download one file the room lists in that slot (never a name the page made up) into the room's folder. */
async function sdFetch(room, index, name) {
  const entry = (await sd.list(room)).find((f) => f.index === index && f.name === name);
  if (!entry) throw new Error('gone');
  const bytes = await sd.download({ room, index, name: entry.name });
  return speechdrop.saveUnique(path.join(sdDownloads(), room), speechdrop.safeName(entry.name), bytes);
}
ipcMain.handle('falcon:sd-room', sdSafe((_e, room) => sd.room(String(room))));
ipcMain.handle('falcon:sd-make', sdSafe((_e, name) => sd.make(String(name))));
ipcMain.handle('falcon:sd-upload', sdSafe((_e, o) => {
  if (!o || typeof o.name !== 'string' || !(o.data instanceof Uint8Array)) throw new Error('bad_request');
  return sd.upload({ room: String(o.room), name: path.basename(o.name), bytes: Buffer.from(o.data) });
}));
ipcMain.handle('falcon:sd-delete', sdSafe((_e, room, index) => sd.remove(String(room), Number(index))));
// Upload file…: the native picker, any type SpeechDrop takes; the page uploads what comes back one by one
ipcMain.handle('falcon:sd-pick', sdSafe(async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Upload to SpeechDrop', buttonLabel: 'Upload', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documents', extensions: Object.keys(speechdrop.MIME).map((x) => x.slice(1)) }],
  });
  if (r.canceled) return [];
  return Promise.all(r.filePaths.map(async (p) => {
    const s = await fs.stat(p);
    return s.size > speechdrop.MAX_BYTES ? { name: path.basename(p), size: s.size } : { name: path.basename(p), size: s.size, data: await readBytes(p) };
  }));
}));
// Open: a .docx becomes a Falcon tab (a recent, so openPath may read it); other documents open in their app
ipcMain.handle('falcon:sd-open', sdSafe(async (_e, room, index, name) => {
  const p = await sdFetch(String(room), Number(index), String(name));
  if (p.toLowerCase().endsWith('.docx')) { await rememberPath(p); return { path: p, docx: true }; }
  if (SD_OPENS.has(path.extname(p).toLowerCase())) { const err = await shell.openPath(p); if (err) shell.showItemInFolder(p); }
  else shell.showItemInFolder(p);
  return { path: p, docx: false };
}));
ipcMain.handle('falcon:sd-download', sdSafe(async (_e, room, index, name) => {
  const p = await sdFetch(String(room), Number(index), String(name));
  shell.showItemInFolder(p);
  return p;
}));
// Download all: every file, oldest first, in ~/Downloads/SpeechDrop/<room name>.zip, shown in Finder/Explorer.
// Files the room lists but no longer serves are skipped and counted.
ipcMain.handle('falcon:sd-archive', sdSafe(async (_e, room, title) => {
  const files = (await sd.list(String(room))).reverse();
  if (!files.length) throw new Error('empty');
  await fs.mkdir(sdDownloads(), { recursive: true });
  const out = await speechdrop.freeName(sdDownloads(), `${speechdrop.safeName(title || room)}.zip`);
  const zip = await speechdrop.createZipWriter(out);
  let skipped = 0;
  try {
    for (const f of files) {
      let bytes;
      try { bytes = await sd.download({ room: String(room), index: f.index, name: f.name }); } catch { skipped++; continue; }
      await zip.add(speechdrop.safeName(f.name), bytes);
    }
    await zip.close();
  } catch (err) { await zip.abort(); await fs.rm(out, { force: true }); throw err; }
  shell.showItemInFolder(out);
  return { path: out, count: files.length - skipped, skipped };
}));
// the page watching a room owns it: a reload, crash or closed window stops its rooms, and another page's stop doesn't
const sdPages = new WeakSet();
const sdRelease = (wc) => () => { for (const [room, x] of sdWatches) if (x.wc === wc) sdStop(room); };
ipcMain.on('falcon:sd-watch', (e, room, files) => {
  if (typeof room !== 'string' || !room) return;
  if (!sdPages.has(e.sender)) {
    sdPages.add(e.sender);
    const release = sdRelease(e.sender);
    e.sender.once('destroyed', release);
    e.sender.on('did-start-loading', release);
    e.sender.on('render-process-gone', release);
  }
  let x = sdWatches.get(room);
  if (!x) sdWatches.set(room, x = { w: sdWatcher(room), wc: e.sender });
  x.wc = e.sender;
  try { x.w.watch(room, Array.isArray(files) ? files : null); } catch { sdStop(room); }
});
ipcMain.on('falcon:sd-unwatch', (e, room) => { if (sdWatches.get(room)?.wc === e.sender) sdStop(room); });
app.on('will-quit', () => { for (const room of [...sdWatches.keys()]) sdStop(room); });

// Nimbus and other debate apps send cards in over the same local bridge CardMirror has (see editor-bridge.cjs).
// Each request goes to the page, which knows the open docs, and comes back with its answer.
const bridgeWaits = new Map();
async function askPage(kind, payload, wc) {
  // a window just made hears nothing until its page is up; one that never comes up mustn't hang the asker
  await Promise.race([windows.get(wc)?.ready, new Promise((r) => { setTimeout(r, 15000); })]);
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'no-target-doc' };
  return new Promise((resolve) => {
    const id = crypto.randomBytes(8).toString('hex');
    // a person reads the consent question; everything else answers right away
    const timer = setTimeout(() => {
      bridgeWaits.delete(id);
      if (kind === 'consent' && !wc.isDestroyed()) wc.send('falcon:bridge-expired'); // take the question down: an answer now reaches nothing
      resolve(kind === 'consent' ? { answer: null } : { ok: false, error: 'internal' });
    }, kind === 'consent' ? 180000 : 5000);
    bridgeWaits.set(id, (a) => { clearTimeout(timer); resolve(a); });
    // the question shows in Falcon while the user is in the other app: make the Dock or taskbar say so
    if (kind === 'consent' && !HEADLESS) { if (process.platform === 'darwin') app.dock?.bounce('critical'); else BrowserWindow.fromWebContents(wc)?.flashFrame(true); }
    wc.send('falcon:bridge', id, kind, payload);
  });
}
/** A linked app's request: `docs` lists every window's, an insert goes to the window with its target. */
async function askApp(kind, payload) {
  const front = frontPage((w) => w.answers);
  if (!front) return kind === 'docs' ? { docs: [] } : kind === 'ping' ? { hasActiveDoc: false } : kind === 'consent' ? { answer: null } : { ok: false, error: 'no-target-doc' };
  const pages = [...windows].filter(([, w]) => w.answers).map(([wc]) => wc);
  if (kind === 'docs') {
    const lists = await Promise.all(pages.map(async (wc) => ({ wc, docs: (await askPage('docs', payload, wc)).docs ?? [] })));
    return { docs: lists.flatMap(({ wc, docs }) => docs.map((d) => ({ ...d, focusedWindow: d.focusedWindow === true && wc === front }))) };
  }
  if (kind === 'insert' && payload?.target) {
    for (const wc of pages) {
      const a = await askPage('insert', payload, wc);
      if (a?.error !== 'target-not-found') return a;
    }
    return { ok: false, error: 'target-not-found' };
  }
  // no target: the speech doc, wherever it is
  return askPage(kind, payload, kind === 'insert' && speechHolder ? speechHolder : front);
}
ipcMain.on('falcon:bridge-ready', (e) => { const w = windows.get(e.sender); if (w) { w.answers = true; w.isReady(); } });
ipcMain.on('falcon:bridge-answer', (_e, id, answer) => { const done = bridgeWaits.get(id); if (done) { bridgeWaits.delete(id); done(answer); } });
let editorBridge = null;
const linkedApps = () => editorBridge?.apps() ?? [];
let secretsApi = null;
const secrets = () => (secretsApi ??= createSecrets({ safeStorage, dir: path.join(app.getPath('userData'), 'secrets') }));
// the page names a secret; it can ask for one to be entered or removed, never read one
ipcMain.handle('falcon:secret-list', () => secrets().list());
ipcMain.handle('falcon:secret-prompt', (e, id, look) => promptSecret({ BrowserWindow, parent: BrowserWindow.fromWebContents(e.sender), secrets: secrets(), id, look, show: !HEADLESS }));
ipcMain.handle('falcon:secret-remove', (_e, id) => { secrets().remove(id); return secrets().list(); });
let aiApi = null;
// required on first use: the model SDK takes about 30 ms to load, and the window waits on everything above
const ai = () => (aiApi ??= require('./ai.cjs').createAi({ key: (id) => secrets().get(id) }));
ipcMain.handle('falcon:ai-ask', (_e, r) => ai().ask({ provider: r?.provider === 'openrouter' ? 'openrouter' : 'anthropic', system: String(r?.system ?? ''), text: String(r?.text ?? '').slice(0, 20000), model: String(r?.model ?? ''), maxTokens: Number(r?.maxTokens) }));
// Settings > Sharing's guide: Falcon puts the user's own relay on their Cloudflare account (relay-setup.cjs). The token is
// typed into a window main owns, used for this one run and dropped. The page gets the steps and the answer, never the token.
let relayBusy = false;
ipcMain.handle('falcon:relay-setup', async (e, look) => {
  if (relayBusy) return { ok: false, error: 'busy' };
  relayBusy = true;
  try {
    let worker;
    try { worker = JSON.parse(fsSync.readFileSync(path.join(__dirname, '..', 'dist', 'relay-worker.json'), 'utf8')); } catch { return { ok: false, error: 'missing' }; }
    const token = await askSecret({ BrowserWindow, parent: BrowserWindow.fromWebContents(e.sender), label: 'Cloudflare token', note: 'Used once to set up your relay, then forgotten.',
      button: 'Set up', look, show: !HEADLESS });
    if (!token) return { ok: false, error: 'cancelled' };
    // off the clipboard, so a paste into a card later can't put it in a document (and from there in a file or a shared card)
    if ((await clipboard.readText().catch(() => '')).trim() === token) clipboard.clear();
    // tests only: a stand-in for Cloudflare's API, and the address to report. A shipped app only ever sends the token to Cloudflare
    const test = HEADLESS && process.env.FALCON_CF_API ? { api: process.env.FALCON_CF_API, relayUrl: process.env.FALCON_CF_RELAY_URL || null } : {};
    // Chromium's network stack, as the updater uses: the system's proxy and certificates, which school networks need
    return await require('./relay-setup.cjs').createRelaySetup({ worker, fetch: (url, init) => net.fetch(url, init), ...test })
      .deploy(token, (step) => { if (!e.sender.isDestroyed()) e.sender.send('falcon:relay-step', step); });
  } catch {
    return { ok: false, error: 'failed' }; // a thrown error's message would reach the page; nothing from a run may
  } finally { relayBusy = false; }
});
ipcMain.handle('falcon:bridge-apps', () => linkedApps());
ipcMain.handle('falcon:bridge-allow', (_e, appId, on) => { if (typeof appId === 'string') { if (on === null) editorBridge?.forget(appId); else editorBridge?.setAllowed(appId, on === true); } return linkedApps(); });
function startEditorBridge() {
  if (HEADLESS && !process.env.CARDMIRROR_BRIDGE_DIR) return; // tests never show up in the real folder
  editorBridge = createEditorBridge({ dir: bridgeDir(app.getPath('appData')), appVersion: app.getVersion(), consentFile: path.join(app.getPath('userData'), 'linked-apps.json'), ask: askApp });
  editorBridge.start().catch(() => { editorBridge = null; });
}
app.on('will-quit', () => editorBridge?.stop());

ipcMain.on('falcon:track', (_e, event, props) => {
  if (telemetry.enabled({ dev: DEV, headless: HEADLESS })) telemetry.track(event, props);
});

if (primary) app.whenReady().then(() => {
  if (BENCH) app.dock?.hide();
  buildMenu();
  createWindow();
  updater.start();
  startEditorBridge();
  app.on('activate', () => { if (!windows.size) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
