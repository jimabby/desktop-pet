'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // Click-through control
  setInteractive: (v) => ipcRenderer.send('set-interactive', !!v),

  // Dragging
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),

  // Resizing (scroll wheel over the pet). direction > 0 grows, < 0 shrinks.
  resizeStep: (direction) => ipcRenderer.send('resize-step', direction),

  // Open a link from the bubble (e.g. jump back to the editor to confirm).
  openLink: (url) => ipcRenderer.send('open-link', url),

  // Events from main
  onClick: (cb) => ipcRenderer.on('pet-click', () => cb()),
  onAiState: (cb) => ipcRenderer.on('ai-state', (_e, state) => cb(state)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, settings) => cb(settings))
});
