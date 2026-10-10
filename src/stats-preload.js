'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Narrow bridge for the activity and companion controls.
contextBridge.exposeInMainWorld('statsAPI', {
  companion: () => ipcRenderer.invoke('companion:get'),
  action: (action) => ipcRenderer.invoke('companion:action', action),
  get: () => ipcRenderer.invoke('stats:get'),
  onActivity: (cb) => ipcRenderer.on('activity', (_e, data) => cb(data))
});
