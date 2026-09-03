'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Safe bridge for the settings window.
contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (cfg) => ipcRenderer.send('settings:set', cfg),
  close: () => ipcRenderer.send('settings:close'),

  // Sprite-sheet art. The picker runs in main (it needs a native file dialog),
  // stores the image, and hands back only its metadata — never the image data.
  pickSprite: () => ipcRenderer.invoke('settings:pickSprite'),
  setSprite: (geom) => ipcRenderer.send('settings:setSprite', geom),
  clearSprite: () => ipcRenderer.send('settings:clearSprite')
});
