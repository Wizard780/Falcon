const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('secret', { submit: (v) => ipcRenderer.send('falcon:secret-submit', String(v ?? '')) });
