'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  // Click-through control
  setInteractive: (v) => ipcRenderer.send('set-interactive', !!v),

  // Dragging
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),

  // Events from main
  onClick: (cb) => ipcRenderer.on('pet-click', () => cb()),
  onAiState: (cb) => ipcRenderer.on('ai-state', (_e, state) => cb(state))
});
