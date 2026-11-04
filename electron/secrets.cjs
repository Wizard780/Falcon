// Secrets like API keys live here, in the main process. The page names one ('anthropic') and never
// sees its value: the value is typed into a window main owns, and only main code reads it back.
const fs = require('node:fs');
const path = require('node:path');

const NAMES = { anthropic: 'Anthropic API key', caselist: 'openCaselist sign-in' }; // add a provider here
const ok = (id) => typeof id === 'string' && Object.hasOwn(NAMES, id);

function createSecrets({ safeStorage, dir }) {
  const file = (id) => path.join(dir, `${id}.bin`);
  const get = (id) => {
    if (!ok(id)) return '';
    try { return safeStorage.decryptString(fs.readFileSync(file(id))); } catch { return ''; }
  };
  return {
    /** Main process only. Never send this over IPC. */
    get,
    /** The names that have a value saved: all the page may know. */
    list: () => Object.keys(NAMES).filter((id) => !!get(id)),
    /** False when this machine can't encrypt it: we don't keep secrets in the clear. */
    set(id, value) {
      const v = typeof value === 'string' ? value.trim() : '';
      if (!ok(id) || !v || !safeStorage.isEncryptionAvailable()) return false;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file(id), safeStorage.encryptString(v), { mode: 0o600 });
      return true;
    },
    remove(id) { if (ok(id)) fs.rmSync(file(id), { force: true }); },
  };
}

/** Asks for a secret in a small window main owns. Resolves true if one was saved. */
function promptSecret({ BrowserWindow, parent, secrets, id, show = true }) {
  if (!ok(id)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      parent, modal: !!parent, show: false, width: 440, height: 200, resizable: false, minimizable: false, maximizable: false,
      title: NAMES[id], autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'secret-preload.cjs'), contextIsolation: true, sandbox: true },
    });
    let saved = false;
    const onSubmit = (e, value) => {
      if (e.sender !== w.webContents) return; // only this window may hand in the value
      saved = secrets.set(id, value);
      w.close();
    };
    const { ipcMain } = require('electron');
    ipcMain.on('falcon:secret-submit', onSubmit);
    w.on('closed', () => { ipcMain.off('falcon:secret-submit', onSubmit); resolve(saved); });
    w.loadFile(path.join(__dirname, 'secret-prompt.html'), { query: { label: NAMES[id] } });
    if (show) w.once('ready-to-show', () => w.show());
  });
}

module.exports = { createSecrets, promptSecret, SECRET_NAMES: NAMES };
