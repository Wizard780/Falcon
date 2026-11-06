// The only bridge between the page and the OS. The page gets these functions and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('falcon', {
  platform: process.platform,
  readClipboardText: () => ipcRenderer.invoke('falcon:read-clipboard-text'),
  openFile: () => ipcRenderer.invoke('falcon:open-file'),
  openPath: (p) => ipcRenderer.invoke('falcon:open-path', p),
  saveFile: (opts) => ipcRenderer.invoke('falcon:save-file', opts),
  pickTemplateFiles: () => ipcRenderer.invoke('falcon:pick-template-files'),
  indexFolders: () => ipcRenderer.invoke('falcon:index-folders'),
  addIndexFolder: () => ipcRenderer.invoke('falcon:index-add'),
  removeIndexFolder: (p) => ipcRenderer.invoke('falcon:index-remove', p),
  importIndexFolders: (paths) => ipcRenderer.invoke('falcon:index-import', paths),
  indexedFiles: () => ipcRenderer.invoke('falcon:index-files'),
  searchCards: (q, hidden) => ipcRenderer.invoke('falcon:card-search', q, hidden),
  dictionaryWords: () => ipcRenderer.invoke('falcon:dict-words'),
  removeDictionaryWord: (w) => ipcRenderer.invoke('falcon:dict-remove', w),
  onMenu: (f) => {
    const on = (_e, cmd) => { if (typeof cmd === 'string') f(cmd); };
    ipcRenderer.on('falcon:menu', on);
    return () => ipcRenderer.removeListener('falcon:menu', on);
  },
  // Files double-clicked in Finder/Explorer. Subscribing tells the main process the page is ready for them.
  onOpenPaths: (f) => {
    const on = (_e, paths) => { if (Array.isArray(paths)) f(paths.filter((p) => typeof p === 'string')); };
    ipcRenderer.on('falcon:open-paths', on);
    ipcRenderer.send('falcon:open-paths-ready');
    return () => { ipcRenderer.removeListener('falcon:open-paths', on); ipcRenderer.send('falcon:open-paths-gone'); };
  },
  setMenuKeys: (keys) => ipcRenderer.send('falcon:menu-keys', keys),
  // other debate apps (Nimbus...) asking for the open docs, inserting a card, jumping back, or asking to connect.
  // f(kind, payload) answers with a promise; subscribing tells the main process the page can answer
  onBridge: (f) => {
    const on = async (_e, id, kind, payload) => {
      let a;
      try { a = await f(String(kind), payload ?? {}); } catch { a = { ok: false, error: 'internal' }; }
      ipcRenderer.send('falcon:bridge-answer', id, a ?? null);
    };
    ipcRenderer.on('falcon:bridge', on);
    ipcRenderer.send('falcon:bridge-ready');
    return () => ipcRenderer.removeListener('falcon:bridge', on);
  },
  onBridgeExpired: (f) => {
    const on = () => f();
    ipcRenderer.on('falcon:bridge-expired', on);
    return () => ipcRenderer.removeListener('falcon:bridge-expired', on);
  },
  // secrets go by name; their values stay in the main process
  secretList: () => ipcRenderer.invoke('falcon:secret-list'),
  secretPrompt: (id, look) => ipcRenderer.invoke('falcon:secret-prompt', id, look),
  secretRemove: (id) => ipcRenderer.invoke('falcon:secret-remove', id),
  aiAsk: (req) => ipcRenderer.invoke('falcon:ai-ask', req),
  linkedApps: () => ipcRenderer.invoke('falcon:bridge-apps'),
  allowLinkedApp: (id, on) => ipcRenderer.invoke('falcon:bridge-allow', id, on),
  onConfirmClose: (f) => {
    const on = (_e, quit) => f(quit === true);
    ipcRenderer.on('falcon:confirm-close', on);
    return () => ipcRenderer.removeListener('falcon:confirm-close', on);
  },
  setTheme: (bg, dark, system) => ipcRenderer.send('falcon:theme', String(bg), dark === true, system === true),
  // a newer Falcon, downloaded and ready (or null). Subscribing gets the current state too.
  onUpdate: (f) => {
    const on = (_e, u) => f(u ?? null);
    ipcRenderer.on('falcon:update', on);
    void ipcRenderer.invoke('falcon:update-get').then((u) => f(u ?? null));
    return () => ipcRenderer.removeListener('falcon:update', on);
  },
  installUpdate: (version) => ipcRenderer.invoke('falcon:update-install', version),
  checkUpdate: () => ipcRenderer.invoke('falcon:update-check'),
  track: (event, props) => ipcRenderer.send('falcon:track', String(event), props ?? {}),
  // SpeechDrop: each call answers { ok, value } or { ok: false, error } (a SpeechDrop error code)
  speechdrop: {
    room: (room) => ipcRenderer.invoke('falcon:sd-room', room),
    make: (name) => ipcRenderer.invoke('falcon:sd-make', name),
    upload: (room, name, data) => ipcRenderer.invoke('falcon:sd-upload', { room, name, data }),
    remove: (room, index) => ipcRenderer.invoke('falcon:sd-delete', room, index),
    pick: () => ipcRenderer.invoke('falcon:sd-pick'),
    open: (room, index, name) => ipcRenderer.invoke('falcon:sd-open', room, index, name),
    download: (room, index, name) => ipcRenderer.invoke('falcon:sd-download', room, index, name),
    archive: (room, title) => ipcRenderer.invoke('falcon:sd-archive', room, title),
    // the live list of `room`, one watch per room; returns an unsubscribe
    watch: (room, files, f) => {
      const on = (_e, u) => { if (u && u.room === room) f(u); };
      ipcRenderer.on('falcon:sd-files', on);
      ipcRenderer.send('falcon:sd-watch', room, files);
      return () => { ipcRenderer.removeListener('falcon:sd-files', on); ipcRenderer.send('falcon:sd-unwatch', room); };
    },
  },
  forceClose: (quit) => ipcRenderer.send('falcon:force-close', quit === true),
  // crash recovery for docs too big for localStorage: read once as the page starts, written on every backup
  recovery: { read: () => ipcRenderer.sendSync('falcon:recovery-read'), write: (text) => ipcRenderer.send('falcon:recovery-write', String(text)) },
});
