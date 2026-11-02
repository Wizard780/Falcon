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
  setMenuKeys: (keys) => ipcRenderer.send('falcon:menu-keys', keys),
  onConfirmClose: (f) => {
    const on = (_e, quit) => f(quit === true);
    ipcRenderer.on('falcon:confirm-close', on);
    return () => ipcRenderer.removeListener('falcon:confirm-close', on);
  },
  setTheme: (bg, dark, system) => ipcRenderer.send('falcon:theme', String(bg), dark === true, system === true),
  forceClose: (quit) => ipcRenderer.send('falcon:force-close', quit === true),
});
