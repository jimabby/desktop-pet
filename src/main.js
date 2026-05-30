'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { startControlServer } = require('./server');

const PET_PORT = Number(process.env.PET_PORT) || 7337;

let win = null;
let tray = null;

// ---- Drag state (handled in main so coordinates stay in global screen space) ----
let dragTimer = null;
let dragOffset = { x: 0, y: 0 };
let dragStart = { x: 0, y: 0 };
let movedDistance = 0;

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const WIN_W = 240;
  const WIN_H = 320;

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: screenW - WIN_W - 40,
    y: screenH - WIN_H - 20,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false, // we move it ourselves
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Click-through everywhere except over the pet. The renderer toggles this
  // by telling us when the cursor is over an interactive element.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // win.webContents.openDevTools({ mode: 'detach' });
}

// ---------------------------------------------------------------------------
// IPC: interactivity toggle (click-through)
// ---------------------------------------------------------------------------
ipcMain.on('set-interactive', (_e, interactive) => {
  if (!win) return;
  if (interactive) {
    win.setIgnoreMouseEvents(false);
  } else {
    win.setIgnoreMouseEvents(true, { forward: true });
  }
});

// ---------------------------------------------------------------------------
// IPC: dragging the pet around the screen
// ---------------------------------------------------------------------------
ipcMain.on('drag-start', () => {
  if (!win) return;
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  dragOffset = { x: cursor.x - wx, y: cursor.y - wy };
  dragStart = { x: cursor.x, y: cursor.y };
  movedDistance = 0;

  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    movedDistance = Math.max(
      movedDistance,
      Math.hypot(p.x - dragStart.x, p.y - dragStart.y)
    );
    win.setPosition(p.x - dragOffset.x, p.y - dragOffset.y);
  }, 16);
});

ipcMain.on('drag-end', () => {
  clearInterval(dragTimer);
  dragTimer = null;
  // Small movement => treat as a click/pet, not a drag.
  if (win && movedDistance < 6) {
    win.webContents.send('pet-click');
  }
});

// ---------------------------------------------------------------------------
// Tray (gives a way to quit a frameless app)
// ---------------------------------------------------------------------------
function createTray() {
  // A tiny green blob icon, built inline so we need no asset files.
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAVUlEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIwCAJ4kAAGS0aS3AAAAAElFTkSuQmCC'
  );
  tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    { label: 'Desktop Pet', enabled: false },
    { type: 'separator' },
    {
      label: 'Reset position',
      click: () => {
        if (!win) return;
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        const [w, h] = win.getSize();
        win.setPosition(width - w - 40, height - h - 20);
      }
    },
    {
      label: 'Wake / Poke',
      click: () => win && win.webContents.send('pet-click')
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setToolTip('Desktop Pet');
  tray.setContextMenu(menu);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  createWindow();
  createTray();

  // Local control server: any AI / script POSTs a mood here.
  startControlServer(PET_PORT, (state) => {
    if (win) win.webContents.send('ai-state', state);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Keep running with no windows (it's a tray/pet app).
app.on('window-all-closed', () => {});

if (process.platform === 'darwin' && app.dock) {
  app.dock.hide(); // no dock icon; live in the tray
}
