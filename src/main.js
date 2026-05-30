'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { startControlServer } = require('./server');
const { createStore } = require('./store');

const PET_PORT = Number(process.env.PET_PORT) || 7337;

let win = null;
let tray = null;
let store = null;

const WIN_W = 240;
const WIN_H = 320;

// ---- Drag state (handled in main so coordinates stay in global screen space) ----
let dragTimer = null;
let dragOffset = { x: 0, y: 0 };
let dragStart = { x: 0, y: 0 };
let movedDistance = 0;

function defaultPosition() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { x: width - WIN_W - 40, y: height - WIN_H - 20 };
}

// Keep the window on a visible display (handles unplugged monitors / changed resolutions).
function clampToScreen(x, y) {
  const area = screen.getDisplayMatching({ x, y, width: WIN_W, height: WIN_H }).workArea;
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - WIN_W),
    y: Math.min(Math.max(y, area.y), area.y + area.height - WIN_H)
  };
}

function createWindow() {
  let { x, y } = store.get('x') != null
    ? { x: store.get('x'), y: store.get('y') }
    : defaultPosition();
  ({ x, y } = clampToScreen(x, y));

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false, // we move it ourselves
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    show: !store.get('hidden'),
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

  // Push current settings to the renderer once it's ready.
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('settings', { muted: store.get('muted') });
  });
}

function savePosition() {
  if (!win) return;
  const [x, y] = win.getPosition();
  store.set('x', x);
  store.set('y', y);
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
  } else {
    savePosition();
  }
});

// ---------------------------------------------------------------------------
// Tray (gives a way to quit a frameless app + toggles)
// ---------------------------------------------------------------------------
function togglePetVisible() {
  if (!win) return;
  const nowHidden = win.isVisible();
  if (nowHidden) win.hide();
  else win.show();
  store.set('hidden', nowHidden);
  buildTrayMenu();
}

function toggleMuted() {
  const muted = !store.get('muted');
  store.set('muted', muted);
  if (win) win.webContents.send('settings', { muted });
  buildTrayMenu();
}

function toggleLaunchAtLogin() {
  const open = !store.get('launchAtLogin');
  store.set('launchAtLogin', open);
  try {
    app.setLoginItemSettings({ openAtLogin: open, openAsHidden: true });
  } catch (err) {
    console.error('[pet] could not update login item:', err.message);
  }
  buildTrayMenu();
}

function buildTrayMenu() {
  const visible = win ? win.isVisible() : true;
  const menu = Menu.buildFromTemplate([
    { label: 'Desktop Pet', enabled: false },
    { type: 'separator' },
    { label: visible ? 'Hide pet' : 'Show pet', click: togglePetVisible },
    { label: 'Wake / Poke', click: () => win && win.webContents.send('pet-click') },
    {
      label: 'Reset position',
      click: () => {
        if (!win) return;
        const { x, y } = defaultPosition();
        win.setPosition(x, y);
        savePosition();
      }
    },
    { type: 'separator' },
    { label: 'Mute sounds', type: 'checkbox', checked: !!store.get('muted'), click: toggleMuted },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: !!store.get('launchAtLogin'),
      click: toggleLaunchAtLogin
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  // A tiny green blob icon, built inline so we need no asset files.
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAVUlEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIwCAJ4kAAGS0aS3AAAAAElFTkSuQmCC'
  );
  tray = new Tray(icon);
  tray.setToolTip('Desktop Pet');
  buildTrayMenu();
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
// Single instance: a second launch just pokes the existing pet.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.webContents.send('pet-click');
    }
  });

  app.whenReady().then(() => {
    store = createStore(app);

    // Re-assert the login-item setting only when the user has opted in, so a
    // normal launch doesn't poke OS settings (or log a permission error).
    if (store.get('launchAtLogin')) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    }

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

  app.on('before-quit', () => {
    savePosition();
    if (store) store.flushNow();
  });
}

// Keep running with no windows (it's a tray/pet app).
app.on('window-all-closed', () => {});

if (process.platform === 'darwin' && app.dock) {
  app.dock.hide(); // no dock icon; live in the tray
}
