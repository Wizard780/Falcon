// The only bridge between the page and the OS. The page gets these functions and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('falcon', {
  platform: process.platform,
  readClipboardText: () => ipcRenderer.invoke('falcon:read-clipboard-text'),
  openFile: () => ipcRenderer.invoke('falcon:open-file'),
  openPath: (p) => ipcRenderer.invoke('falcon:open-path', p),
  saveFile: (opts) => ipcRenderer.invoke('falcon:save-file', opts),
  indexFolders: () => ipcRenderer.invoke('falcon:index-folders'),
  addIndexFolder: () => ipcRenderer.invoke('falcon:index-add'),
  removeIndexFolder: (p) => ipcRenderer.invoke('falcon:index-remove', p),
  indexedFiles: () => ipcRenderer.invoke('falcon:index-files'),
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
    return () => ipcRenderer.removeListener('falcon:open-paths', on);
  },
  setMenuKeys: (keys) => ipcRenderer.send('falcon:menu-keys', keys),
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
  installUpdate: () => ipcRenderer.invoke('falcon:update-install'),
  checkUpdate: () => ipcRenderer.invoke('falcon:update-check'),
  track: (event, props) => ipcRenderer.send('falcon:track', String(event), props ?? {}),
  forceClose: (quit) => ipcRenderer.send('falcon:force-close', quit === true),
});
