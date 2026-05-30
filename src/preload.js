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

  // Open the Settings window (e.g. from right-clicking the pet).
  openSettings: () => ipcRenderer.send('open-settings'),

  // Events from main
  onClick: (cb) => ipcRenderer.on('pet-click', () => cb()),
  onGrab: (cb) => ipcRenderer.on('pet-grabbed', () => cb()),
  onDrop: (cb) => ipcRenderer.on('pet-dropped', () => cb()),
  onAiState: (cb) => ipcRenderer.on('ai-state', (_e, state) => cb(state)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, settings) => cb(settings)),
  onFocus: (cb) => ipcRenderer.on('focus', (_e, f) => cb(f)),
  onNotice: (cb) => ipcRenderer.on('notice', (_e, text) => cb(text)),
  onTrick: (cb) => ipcRenderer.on('pet-trick', (_e, name) => cb(name))
});
