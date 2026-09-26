'use strict';

// Wiring tests for the main process.
//
// main.js can't be required under plain Node — it pulls in Electron — so this
// stubs the Electron module and loads it for real. That exercises the IPC
// handlers, the tray-menu builder, and the settings/stats payloads end to end,
// catching undefined identifiers and wrong shapes that a syntax check misses
// and that would otherwise only show up as a dead menu item in the built app.
//
// The store writes into a throwaway userData dir, so this never touches the
// real pet's config.
const Module = require('module');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ipcHandlers = new Map();
const ipcListeners = new Map();
let trayTemplate = null;
const sent = [];

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-wiring-'));

const fakeWin = {
  isDestroyed: () => false,
  isVisible: () => true,
  show() {}, hide() {}, focus() {},
  getPosition: () => [100, 100],
  getSize: () => [240, 320],
  setPosition() {}, setBounds() {}, setAlwaysOnTop() {},
  setVisibleOnAllWorkspaces() {}, setIgnoreMouseEvents() {}, loadFile() {},
  on() {}, once(ev, cb) { if (ev === 'ready-to-show') cb(); },
  webContents: {
    on(ev, cb) { if (ev === 'did-finish-load') setImmediate(cb); },
    send: (ch, payload) => sent.push([ch, payload]),
    setZoomFactor() {}
  }
};

const electron = {
  app: {
    isPackaged: false,
    getPath: () => userData,
    whenReady: () => Promise.resolve(),
    on() {}, quit() {},
    requestSingleInstanceLock: () => true,
    setLoginItemSettings() {},
    dock: { hide() {} }
  },
  BrowserWindow: function () { return fakeWin; },
  ipcMain: {
    on: (ch, cb) => ipcListeners.set(ch, cb),
    handle: (ch, cb) => ipcHandlers.set(ch, cb)
  },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    on() {}
  },
  Tray: function () {
    return { setToolTip() {}, setContextMenu() {} };
  },
  Menu: { buildFromTemplate: (t) => { trayTemplate = t; return t; } },
  nativeImage: { createFromDataURL: () => ({ addRepresentation() {} }) },
  shell: { openExternal() {} },
  globalShortcut: { register: () => true, unregisterAll() {} },
  Notification: Object.assign(function () { return { on() {}, show() {} }; }, {
    isSupported: () => true
  }),
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
};
electron.BrowserWindow.getAllWindows = () => [fakeWin];

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron;
  return origLoad.apply(this, arguments);
};

process.env.PET_PORT = '7391';
require(path.resolve('src/main.js'));

(async () => {
  await new Promise((r) => setTimeout(r, 600));

  let fails = 0;
  const ok = (name, cond, extra) => {
    if (cond) console.log(`  ok  ${name}`);
    else { fails++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
  };

  // --- settings:get ---
  const cfg = await ipcHandlers.get('settings:get')();
  ok('settings:get returns a config', !!cfg);
  for (const key of ['name','color','palette','skin','skins','cosmetic','cosmeticUnlocks',
                     'unlocked','lifetimeTasks','timeOfDay','wander','physics','muted',
                     'hotkey','stressTokens','ctxMax','ctxMaxLocked','notifyWhenHidden',
                     'autoUpdate','canAutoUpdate','quiet','sprite','token','port',
                     'serverError','focus']) {
    ok(`settings:get has ${key}`, key in cfg);
  }
  ok('token was generated on first run', typeof cfg.token === 'string' && cfg.token.length >= 32, `len=${(cfg.token||'').length}`);
  ok('quiet has from/to defaults', cfg.quiet.from === '22:00' && cfg.quiet.to === '08:00', JSON.stringify(cfg.quiet));
  ok('sprite is null with none configured', cfg.sprite === null, JSON.stringify(cfg.sprite));
  ok('port reflects the bound port', cfg.port === 7391, String(cfg.port));

  // --- settings:set ---
  const set = ipcListeners.get('settings:set');
  set(null, { name: 'Mochi', quiet: { enabled: true, from: '23:30', to: '07:15' },
              ctxMax: 500000, notifyWhenHidden: false, hotkey: 'CommandOrControl+Shift+J' });
  const after = await ipcHandlers.get('settings:get')();
  ok('settings:set stores the name', after.name === 'Mochi', after.name);
  ok('settings:set stores quiet hours', after.quiet.from === '23:30' && after.quiet.enabled === true, JSON.stringify(after.quiet));
  ok('settings:set stores ctxMax', after.ctxMax === 500000, String(after.ctxMax));
  ok('settings:set stores notifyWhenHidden', after.notifyWhenHidden === false);
  ok('settings:set stores the hotkey', after.hotkey === 'CommandOrControl+Shift+J', after.hotkey);

  for (const skin of ['kitten', 'puppy']) {
    ok('settings offers ' + skin, cfg.skins.includes(skin));
    set(null, { skin });
    ok('settings saves ' + skin, (await ipcHandlers.get('settings:get')()).skin === skin);
  }

  // An unparseable time must not wipe the stored one.
  set(null, { quiet: { enabled: true, from: '', to: '07:15' } });
  const after2 = await ipcHandlers.get('settings:get')();
  ok('a half-typed time is rejected, not stored', after2.quiet.from === '23:30', after2.quiet.from);

  // --- sprite handlers ---
  const pick = await ipcHandlers.get('settings:pickSprite')();
  ok('cancelled sprite pick reports not-ok', pick.ok === false);
  ipcListeners.get('settings:setSprite')(null, { cols: 4, rows: 2, fps: 12 }); // no sprite: no-op
  ipcListeners.get('settings:clearSprite')(null);
  ok('sprite handlers survive having no sprite', true);

  // --- stats:get ---
  const report = await ipcHandlers.get('stats:get')();
  ok('stats:get returns 7 days', Array.isArray(report.days) && report.days.length === 7, String(report.days && report.days.length));
  ok('stats:get days have labels', report.days.every((d) => d.label && d.date));
  ok('stats:get has totals', report.totals && typeof report.totals.tasks === 'number');
  ok('stats:get has perAi', Array.isArray(report.perAi));
  ok('stats:get has events', Array.isArray(report.events));

  // --- tray menu ---
  const labels = (trayTemplate || []).map((i) => i.label).filter(Boolean);
  for (const want of ['Activity…', 'Settings…', 'Today', 'Recent', 'Behavior', 'Quit']) {
    ok(`tray has "${want}"`, labels.includes(want), labels.join(' | '));
  }
  ok('tray shows the listening port',
    labels.some((l) => l.includes('listening on :7391')), labels.join(' | '));
  const behavior = (trayTemplate || []).find((i) => i.label === 'Behavior');
  const bLabels = (behavior.submenu || []).map((i) => i.label).filter(Boolean);
  ok('Behavior has "Notify when hidden"', bLabels.includes('Notify when hidden'), bLabels.join(' | '));
  ok('Behavior has quiet hours', bLabels.some((l) => l.startsWith('Quiet hours')), bLabels.join(' | '));

  // --- renderer messages ---
  const settingsMsg = sent.filter(([ch]) => ch === 'settings').pop();
  ok('renderer got a settings push', !!settingsMsg);
  ok('settings push carries quiet', settingsMsg && typeof settingsMsg[1].quiet === 'boolean');
  ok('settings push carries ctxMax', settingsMsg && settingsMsg[1].ctxMax === 500000, JSON.stringify(settingsMsg && settingsMsg[1].ctxMax));

  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup of the throwaway config dir */
  }

  console.log(fails ? `\n${fails} wiring failures` : '\nall wiring checks passed');
  process.exit(fails ? 1 : 0);
})();
