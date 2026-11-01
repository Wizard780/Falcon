// The only bridge between the page and the OS. The page gets these functions and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('falcon', {
  platform: process.platform,
  readClipboardText: () => ipcRenderer.invoke('falcon:read-clipboard-text'),
  openFile: () => ipcRenderer.invoke('falcon:open-file'),
  openPath: (p) => ipcRenderer.invoke('falcon:open-path', p),
  saveFile: (opts) => ipcRenderer.invoke('falcon:save-file', opts),
  onMenu: (f) => {
    const on = (_e, cmd) => { if (typeof cmd === 'string') f(cmd); };
    ipcRenderer.on('falcon:menu', on);
    return () => ipcRenderer.removeListener('falcon:menu', on);
  },
});
