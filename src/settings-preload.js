'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Safe bridge for the little settings window (name + color picker).
contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (cfg) => ipcRenderer.send('settings:set', cfg),
  close: () => ipcRenderer.send('settings:close')
});
