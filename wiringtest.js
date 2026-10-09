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
let popupTemplate = null;
const shortcuts = new Map();
const sent = [];

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-wiring-'));

// Seed a config as an older build would have left it: an inline sprite image,
// the old default hotkey, and week history reaching back further than 7 days.
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
fs.writeFileSync(path.join(userData, 'pet-config.json'), JSON.stringify({
  hotkey: 'CommandOrControl+Shift+P',
  sprite: { url: 'data:image/png;base64,' + PNG_1PX, cols: 1, rows: 1, fps: 8, name: 'old.png' },
  weekHistory: [{ date: day(7), tasks: 5, activeMs: 0 }, { date: day(6), tasks: 1, activeMs: 0 }]
}));

let visible = true;
const fakeWin = {
  isDestroyed: () => false,
  isVisible: () => visible,
  show() { visible = true; }, hide() { visible = false; }, focus() {},
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
    getLoginItemSettings: () => ({ openAtLogin: false }),
    whenReady: () => Promise.resolve(),
    on() {}, quit() {},
    requestSingleInstanceLock: () => true,
    setLoginItemSettings() {},
    dock: { hide() {} }
  },
  BrowserWindow: function () { return fakeWin; },
  powerMonitor: { getSystemIdleTime: () => 0 },
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
    return { setToolTip() {}, setContextMenu: (m) => { trayTemplate = m.items; } };
  },
  Menu: {
    buildFromTemplate: (t) => {
      // The pet's play menu is popped up; the tray menu is set on the tray.
      return { items: t, popup() { popupTemplate = t; } };
    }
  },
  nativeImage: { createFromDataURL: () => ({ addRepresentation() {} }) },
  shell: { openExternal() {} },
  globalShortcut: {
    register: (accel, fn) => {
      if (accel === 'Taken+Key') return false;
      shortcuts.set(accel, fn);
      return true;
    },
    unregisterAll: () => shortcuts.clear()
  },
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

  // --- migrations from an older config ---
  const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'pet-config.json'), 'utf8'));
  ok('inline sprite image moved to its own file', fs.existsSync(path.join(userData, 'sprite.png')));
  ok('config no longer holds the image', !saved().sprite.url && saved().sprite.file === 'sprite.png',
    JSON.stringify(saved().sprite).slice(0, 80));
  const spriteMsg = sent.filter(([ch]) => ch === 'sprite').pop();
  ok('pet window gets the sprite image', spriteMsg && spriteMsg[1].url.startsWith('data:image/png;base64,'));
  ok('settings push no longer carries the image',
    !JSON.stringify(sent.filter(([ch]) => ch === 'settings').pop()).includes('base64'));
  ok('old default hotkey (VS Code palette) is migrated', saved().hotkey === 'CommandOrControl+Alt+Shift+P', saved().hotkey);

  // --- settings:get ---
  const cfg = await ipcHandlers.get('settings:get')();
  ok('settings:get returns a config', !!cfg);
  for (const key of ['name','color','palette','skin','skins','cosmetic','cosmeticUnlocks',
                     'unlocked','lifetimeTasks','timeOfDay','wander','physics','muted',
                     'hotkey','stressTokens','ctxMax','ctxMaxLocked','notifyWhenHidden',
                     'autoUpdate','canAutoUpdate','quiet','sprite','token','port',
                     'serverError','focus','confirmHotkey','hotkeyErrors','hooksPath',
                     'hooksInstalled']) {
    ok(`settings:get has ${key}`, key in cfg);
  }
  ok('token was generated on first run', typeof cfg.token === 'string' && cfg.token.length >= 32, `len=${(cfg.token||'').length}`);
  ok('quiet has from/to defaults', cfg.quiet.from === '22:00' && cfg.quiet.to === '08:00', JSON.stringify(cfg.quiet));
  ok('sprite metadata survives the migration', cfg.sprite && cfg.sprite.name === 'old.png', JSON.stringify(cfg.sprite));
  ipcListeners.get('settings:clearSprite')(null);
  ok('clearing the sprite deletes its file', !fs.existsSync(path.join(userData, 'sprite.png')));
  ok('sprite is null once cleared', (await ipcHandlers.get('settings:get')()).sprite === null);
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

  for (const color of ['natural', 'peach', 'cream', 'cocoa', 'pink']) {
    set(null, { color });
    ok('settings saves color ' + color, (await ipcHandlers.get('settings:get')()).color === color);
  }
  for (const cosmetic of ['bowtie', 'flower']) {
    set(null, { cosmetic });
    ok('free cosmetic can be equipped: ' + cosmetic, (await ipcHandlers.get('settings:get')()).cosmetic === cosmetic);
  }
  set(null, { cosmetic: 'crown' });
  ok('locked cosmetics cannot be equipped', (await ipcHandlers.get('settings:get')()).cosmetic === 'flower');

  // An unparseable time must not wipe the stored one.
  set(null, { quiet: { enabled: true, from: '', to: '07:15' } });
  const after2 = await ipcHandlers.get('settings:get')();
  ok('a half-typed time is rejected, not stored', after2.quiet.from === '23:30', after2.quiet.from);

  // --- partial saves (a stale Settings window must not undo tray changes) ---
  set(null, { muted: true });
  set(null, { name: 'Mochi2' });
  ok('saving one field leaves the others alone', (await ipcHandlers.get('settings:get')()).muted === true);
  set(null, { focus: { work: 40 } });
  const f1 = (await ipcHandlers.get('settings:get')()).focus;
  ok('focus work saves without resetting break', f1.work === 40 && f1.break === 5, JSON.stringify(f1));
  set(null, { quiet: { to: '06:45' } });
  const q1 = (await ipcHandlers.get('settings:get')()).quiet;
  ok('quiet end saves alone', q1.to === '06:45' && q1.from === '23:30' && q1.enabled === true, JSON.stringify(q1));

  // --- token ---
  set(null, { token: '   ' });
  ok('an empty token is refused', (await ipcHandlers.get('settings:get')()).token === cfg.token);
  const fresh = await ipcHandlers.get('settings:regenToken')();
  ok('token can be regenerated', fresh && fresh !== cfg.token && saved().token === fresh);

  // --- hotkeys ---
  set(null, { confirmHotkey: 'Taken+Key' });
  const hk = await ipcHandlers.get('settings:get')();
  ok('a hotkey that fails to register is reported', /already used/.test(hk.hotkeyErrors.confirmHotkey), JSON.stringify(hk.hotkeyErrors));
  set(null, { confirmHotkey: 'CommandOrControl+Alt+Shift+K' });
  ok('a working hotkey clears the error', !(await ipcHandlers.get('settings:get')()).hotkeyErrors.confirmHotkey);

  // --- per-session confirms through the real control server ---
  const post = (body) => new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = require('http').request({ host: '127.0.0.1', port: 7391, path: '/state', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pet-Token': fresh } }, (res) => { res.resume(); res.on('end', resolve); });
    req.end(data);
  });
  const confirms = async () => (await ipcHandlers.get('stats:get')()).perAi
    .filter((a) => a.source === 'claude').reduce((n, a) => n + a.confirms, 0);
  await post({ source: 'claude', session: 'A', mood: 'thinking', attention: true, text: 'allow Bash?' });
  await post({ source: 'claude', session: 'A', mood: 'thinking', attention: true, text: 'Claude needs your permission to use Bash' });
  ok('one prompt announced twice counts once', (await confirms()) === 1, String(await confirms()));
  await post({ source: 'claude', session: 'B', mood: 'thinking', attention: true, text: 'allow Bash?' });
  ok('another session\'s prompt counts separately', (await confirms()) === 2, String(await confirms()));
  await post({ source: 'claude', session: 'A', mood: 'working' });
  await post({ source: 'claude', session: 'A', mood: 'thinking', attention: true, text: 'allow Bash?' });
  ok('a new prompt after an answer counts again', (await confirms()) === 3, String(await confirms()));
  const fwd = sent.filter(([ch]) => ch === 'ai-state').pop();
  ok('renderer gets the session key', fwd && fwd[1].key === 'claude|A', JSON.stringify(fwd && fwd[1].key));

  sent.length = 0;
  shortcuts.get('CommandOrControl+Alt+Shift+K')();
  ok('confirm hotkey acknowledges the newest prompt',
    sent.some(([ch, key]) => ch === 'confirm-ack' && key === 'claude|A'), JSON.stringify(sent));
  sent.length = 0;
  shortcuts.get('CommandOrControl+Alt+Shift+K')();
  ok('confirm hotkey then moves to the next one',
    sent.some(([ch, key]) => ch === 'confirm-ack' && key === 'claude|B'), JSON.stringify(sent));

  // --- while you were away ---
  const trayItem = (label) => (trayTemplate || []).find((i) => i.label === label);
  trayItem('Hide pet').click();
  ok('hiding the pet works', visible === false);
  await post({ source: 'claude', session: 'C', mood: 'happy', text: 'refactor finished' });
  sent.length = 0;
  trayItem('Show pet').click();
  await new Promise((r) => setTimeout(r, 2700));
  const away = sent.filter(([ch]) => ch === 'notice').map(([, t]) => t);
  ok('coming back summarises what happened', away.some((t) => /while you were away: 1 done/.test(t)), JSON.stringify(away));
  ok('answered prompts are not reported as waiting', !away.some((t) => /waiting on you/.test(t)), JSON.stringify(away));

  // --- play menu ---
  ipcListeners.get('pet-menu')();
  const playLabels = (popupTemplate || []).map((i) => i.label).filter(Boolean);
  ok('right-click play menu offers tricks', playLabels.includes('💃 Dance'), playLabels.join(' | '));
  ok('play menu reaches Settings', playLabels.includes('Settings…'));

  // --- sprite handlers ---
  const pick = await ipcHandlers.get('settings:pickSprite')();
  ok('cancelled sprite pick reports not-ok', pick.ok === false);
  ipcListeners.get('settings:setSprite')(null, { cols: 4, rows: 2, fps: 12 }); // no sprite: no-op
  ipcListeners.get('settings:clearSprite')(null);
  ok('sprite handlers survive having no sprite', true);

  // --- stats:get ---
  const report = await ipcHandlers.get('stats:get')();
  ok('stats:get returns 7 days', Array.isArray(report.days) && report.days.length === 7, String(report.days && report.days.length));
  ok('weekly total covers the same 7 days as the chart',
    report.totals.tasks === report.days.reduce((n, d) => n + d.tasks, 0),
    `${report.totals.tasks} vs ${report.days.reduce((n, d) => n + d.tasks, 0)}`);
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
  set(null, { muted: false }); // the log was cleared above; trigger a fresh push
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
