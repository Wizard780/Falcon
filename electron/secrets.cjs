// Secrets like API keys live here, in the main process. The page names one ('anthropic') and never
// sees its value: the value is typed into a window main owns, and only main code reads it back.
const fs = require('node:fs');
const path = require('node:path');

const NAMES = { anthropic: 'Anthropic API key', openrouter: 'OpenRouter API key' }; // add a provider here
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

/**
 * Asks for a secret in a small window main owns, and resolves with what was typed ('' if it was closed). Only main
 * code gets the value: the page that asked never sees it. `look` is the page's CSS variables, so it matches the app;
 * `note` and `button` change the line under the box and the Save button.
 */
function askSecret({ BrowserWindow, parent, label, note, button, look, show = true }) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      parent, modal: !!parent, show: false, width: 460, height: 185, useContentSize: true, resizable: false, minimizable: false, maximizable: false,
      title: label, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'secret-preload.cjs'), contextIsolation: true, sandbox: true },
    });
    let value = '';
    const onSubmit = (e, v) => {
      if (e.sender !== w.webContents) return; // only this window may hand in the value
      value = typeof v === 'string' ? v.trim() : '';
      w.close();
    };
    const { ipcMain } = require('electron');
    ipcMain.on('falcon:secret-submit', onSubmit);
    w.on('closed', () => { ipcMain.off('falcon:secret-submit', onSubmit); resolve(value); });
    // from the page's look, only its colors (CSS variables) and its font: the words in this window are main's
    const style = Object.fromEntries(Object.entries(look && typeof look === 'object' ? look : {}).filter(([k, v]) => (k.startsWith('--') || k === 'font') && typeof v === 'string'));
    w.loadFile(path.join(__dirname, 'secret-prompt.html'), { query: { ...style, label, ...(note ? { note } : {}), ...(button ? { button } : {}) } });
    if (show) w.once('ready-to-show', () => w.show());
  });
}

/** Asks for a secret by name and saves it encrypted. Resolves true if one was saved. */
function promptSecret({ BrowserWindow, parent, secrets, id, look, show = true }) {
  if (!ok(id)) return Promise.resolve(false);
  return askSecret({ BrowserWindow, parent, label: NAMES[id], look, show }).then((v) => !!v && secrets.set(id, v));
}

module.exports = { createSecrets, askSecret, promptSecret, SECRET_NAMES: NAMES };
