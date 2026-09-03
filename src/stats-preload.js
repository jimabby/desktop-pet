'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Read-only bridge for the activity window.
contextBridge.exposeInMainWorld('statsAPI', {
  get: () => ipcRenderer.invoke('stats:get'),
  onActivity: (cb) => ipcRenderer.on('activity', (_e, data) => cb(data))
});
