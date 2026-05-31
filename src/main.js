'use strict';

const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, globalShortcut
} = require('electron');
const path = require('path');
const { startControlServer } = require('./server');
const { createStore } = require('./store');

const PET_PORT = Number(process.env.PET_PORT) || 7337;
// How big a context window counts as "full" for the pet's usage ring.
const CTX_MAX = Number(process.env.PET_CTX_MAX) || 200000;

// Body color presets the settings window offers (key -> [stop1, stop2]).
const PALETTE = {
  green: ['#7ee8a0', '#45c97a'],
  blue: ['#8fd2ff', '#4aa8f0'],
  pink: ['#ffc2d6', '#ff7eb6'],
  purple: ['#c3b5ff', '#8f6fff'],
  yellow: ['#ffe27a', '#ffc24a'],
  gray: ['#cfd6e0', '#9aa7b8']
};

const SKINS = ['slime', 'cat', 'ghost', 'bunny'];

// Cosmetics and the lifetime-task count needed to unlock each. 'none' is free.
const COSMETIC_UNLOCKS = { none: 0, glasses: 10, scarf: 40, headphones: 75, crown: 120 };

let win = null;
let tray = null;
let store = null;
let settingsWin = null;

const WIN_W = 240;
const WIN_H = 320;

// How big the pet can get. 1 = default size.
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.1;

function clampScale(s) {
  if (!Number.isFinite(s)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

// ---- Drag state (handled in main so coordinates stay in global screen space) ----
let dragTimer = null;
let dragOffset = { x: 0, y: 0 };
let dragStart = { x: 0, y: 0 };
let movedDistance = 0;
let isDragging = false;
// Pointer velocity (px/ms) sampled during a drag, so releasing can fling the pet.
let dragVel = { x: 0, y: 0 };
let lastSample = { x: 0, y: 0, t: 0 };

// ---- Self-motion (wander + thrown physics) share one animation loop ----
let moveAnim = null;
function cancelMoveAnim() {
  if (moveAnim) {
    clearInterval(moveAnim);
    moveAnim = null;
  }
}

// Smoothly tween the window to (tx, ty) over `dur` ms (used by wander).
function animateWindowTo(tx, ty, dur, done) {
  if (!win) return;
  cancelMoveAnim();
  const [sx, sy] = win.getPosition();
  const start = Date.now();
  moveAnim = setInterval(() => {
    if (!win || win.isDestroyed()) return cancelMoveAnim();
    const t = Math.min(1, (Date.now() - start) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    win.setPosition(Math.round(sx + (tx - sx) * e), Math.round(sy + (ty - sy) * e));
    if (t >= 1) {
      cancelMoveAnim();
      if (done) done();
    }
  }, 16);
}

// Fling the pet with the release velocity: it slides with friction and bounces
// off the screen edges, then settles (perching if it lands near the top).
function flingPet(vx, vy) {
  if (!win) return;
  const [w, h] = win.getSize();
  let [x, y] = win.getPosition();
  const area = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
  let fx = vx * 16; // px per ~16ms frame
  let fy = vy * 16;
  // Ignore a barely-moving release (treated as a plain drop).
  if (Math.hypot(fx, fy) < 3) return settleOrPerch();

  const FRICTION = 0.93;
  const BOUNCE = 0.6;
  cancelMoveAnim();
  moveAnim = setInterval(() => {
    if (!win || win.isDestroyed()) return cancelMoveAnim();
    x += fx;
    y += fy;
    if (x < area.x) { x = area.x; fx = -fx * BOUNCE; }
    else if (x > area.x + area.width - w) { x = area.x + area.width - w; fx = -fx * BOUNCE; }
    if (y < area.y) { y = area.y; fy = -fy * BOUNCE; }
    else if (y > area.y + area.height - h) { y = area.y + area.height - h; fy = -fy * BOUNCE; }
    fx *= FRICTION;
    fy *= FRICTION;
    win.setPosition(Math.round(x), Math.round(y));
    if (Math.abs(fx) < 0.4 && Math.abs(fy) < 0.4) {
      cancelMoveAnim();
      settleOrPerch();
    }
  }, 16);
}

// After motion stops, snap to the top edge of the screen if the pet ended up
// near it ("perching"); otherwise just remember where it landed.
function settleOrPerch() {
  if (!win) return;
  const [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  const area = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
  if (store.get('physics') !== false && y - area.y < 44) {
    animateWindowTo(x, area.y, 200, savePosition);
  } else {
    savePosition();
  }
}

// Wander: every so often the idle pet strolls a few px on its own.
let wanderTimer = null;
function scheduleWander() {
  clearTimeout(wanderTimer);
  wanderTimer = setTimeout(() => {
    maybeWander();
    scheduleWander();
  }, 14000 + Math.random() * 20000);
}
function maybeWander() {
  if (store.get('wander') === false) return;
  if (!win || win.isDestroyed() || !win.isVisible() || isDragging || moveAnim || focusState) return;
  const [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  const dx = (Math.random() < 0.5 ? -1 : 1) * (24 + Math.random() * 56);
  const target = clampToScreen(Math.round(x + dx), y, w, h);
  if (target.x === x) return;
  animateWindowTo(target.x, target.y, 900, savePosition);
}

function defaultPosition() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { x: width - WIN_W - 40, y: height - WIN_H - 20 };
}

// Keep the window on a visible display (handles unplugged monitors / changed resolutions).
function clampToScreen(x, y, w = WIN_W, h = WIN_H) {
  const area = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - w),
    y: Math.min(Math.max(y, area.y), area.y + area.height - h)
  };
}

function createWindow() {
  const scale = clampScale(store.get('scale'));
  const w = Math.round(WIN_W * scale);
  const h = Math.round(WIN_H * scale);

  let { x, y } = store.get('x') != null
    ? { x: store.get('x'), y: store.get('y') }
    : defaultPosition();
  ({ x, y } = clampToScreen(x, y, w, h));

  win = new BrowserWindow({
    width: w,
    height: h,
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

  // Drop our reference once the window is gone so the many `if (win)` guards
  // (and the async control-server callback) don't poke a destroyed object.
  win.on('closed', () => {
    win = null;
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Click-through everywhere except over the pet. The renderer toggles this
  // by telling us when the cursor is over an interactive element.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Push current settings to the renderer once it's ready.
  win.webContents.on('did-finish-load', () => {
    // Zoom the whole UI to match the window size so the pet scales cleanly
    // (hit-testing stays correct because this is a real layout zoom).
    win.webContents.setZoomFactor(scale);
    pushSettings();
    pushDailyStats();
    pushWeeklyStats();
    if (!store.get('hidden')) {
      setTimeout(() => win && win.webContents.send('pet-trick', 'wave'), 700);
      sendMorningGreeting();
    }
  });
}

// Which cosmetics the user has earned, given their lifetime task count.
function unlockedCosmetics() {
  const earned = store.get('lifetimeTasks') || 0;
  return Object.keys(COSMETIC_UNLOCKS).filter((c) => earned >= COSMETIC_UNLOCKS[c]);
}

// The pet's appearance (name, color, skin, cosmetic, time-of-day) from the store.
function appearance() {
  const color = store.get('color');
  const skin = store.get('skin');
  // Only honour an equipped cosmetic the user has actually unlocked.
  let cosmetic = store.get('cosmetic') || 'none';
  if (!unlockedCosmetics().includes(cosmetic)) cosmetic = 'none';
  return {
    name: store.get('name') || '',
    color: PALETTE[color] ? color : 'green',
    colorStops: PALETTE[color] || PALETTE.green,
    skin: SKINS.includes(skin) ? skin : 'slime',
    cosmetic,
    timeOfDay: store.get('timeOfDay') !== false
  };
}

// Send the full settings bundle (mute, context-window size, appearance) to the
// pet renderer. Called on load and whenever any of them change.
function pushSettings() {
  if (!win) return;
  win.webContents.send('settings', {
    muted: store.get('muted'),
    ctxMax: CTX_MAX,
    appearance: appearance()
  });
}

// Push today's aggregate task/error/confirm counts to the renderer so it can
// show a compact "N tasks today" line below the pet.
function pushDailyStats() {
  if (!win || win.isDestroyed()) return;
  const s = getStats();
  let tasks = 0, confirms = 0, errors = 0;
  for (const a of Object.values(s.perAi || {})) {
    tasks += a.tasks || 0;
    confirms += a.confirms || 0;
    errors += a.errors || 0;
  }
  win.webContents.send('daily-stats', { tasks, confirms, errors });
}

// Show a greeting bubble once per calendar day. If yesterday had tasks, the
// pet mentions them; otherwise it just says good morning/afternoon/evening.
function sendMorningGreeting() {
  const today = todayStr();
  if (store.get('lastGreetDate') === today) return;
  store.set('lastGreetDate', today);

  const s = store.get('stats');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toLocaleDateString('en-CA');

  let msg;
  if (s && s.date === yStr) {
    let total = 0;
    for (const a of Object.values(s.perAi || {})) total += a.tasks || 0;
    if (total > 0) {
      msg = `good morning! ${total} task${total > 1 ? 's' : ''} done yesterday 🌟`;
    }
  }
  if (!msg) {
    const h = new Date().getHours();
    if (h < 12) msg = 'good morning! 🌅';
    else if (h < 17) msg = 'good afternoon! ☀️';
    else msg = 'good evening! 🌙';
  }

  // Fire after the wave-hello trick (700ms) has finished playing (~1.7s).
  setTimeout(() => {
    if (win && !win.isDestroyed()) win.webContents.send('notice', msg);
  }, 2500);
}

// ---------------------------------------------------------------------------
// Daily activity stats (shown in the tray's "Today" submenu)
// ---------------------------------------------------------------------------
function todayStr() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
}

// Return today's stats, rolling over (resetting) at the start of a new day.
function getStats() {
  const s = store.get('stats');
  if (s && s.date === todayStr() && s.perAi) return s;
  return { date: todayStr(), perAi: {} };
}

// ---------------------------------------------------------------------------
// Weekly usage — rolling 7-day history of completed tasks + active time.
// Stored as an array of {date, tasks, activeMs} in the 'weekHistory' key.
// ---------------------------------------------------------------------------
function getWeekHistory() {
  const history = store.get('weekHistory') || [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toLocaleDateString('en-CA');
  return history.filter((d) => d.date >= cutoffStr);
}

function refreshWeekHistory() {
  const today = todayStr();
  const s = getStats();
  let tasks = 0, activeMs = 0;
  for (const a of Object.values(s.perAi || {})) {
    tasks += a.tasks || 0;
    activeMs += a.activeMs || 0;
  }
  const history = getWeekHistory();
  const idx = history.findIndex((d) => d.date === today);
  if (idx >= 0) {
    history[idx] = { date: today, tasks, activeMs };
  } else {
    history.push({ date: today, tasks, activeMs });
  }
  store.set('weekHistory', history);
}

function weeklyTotals() {
  return getWeekHistory().reduce(
    (acc, d) => ({ tasks: acc.tasks + (d.tasks || 0), activeMs: acc.activeMs + (d.activeMs || 0) }),
    { tasks: 0, activeMs: 0 }
  );
}

function pushWeeklyStats() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('weekly-stats', weeklyTotals());
}

// Fold one incoming AI state into the running daily tally.
function recordStat(state) {
  const src = (state.source || '').toLowerCase().trim();
  if (!src) return; // unattributed (e.g. a blanket idle clear) — nothing to log
  const s = getStats();
  const a =
    s.perAi[src] ||
    (s.perAi[src] = { tasks: 0, confirms: 0, errors: 0, activeMs: 0, lastBusyAt: 0 });

  const now = Date.now();
  const busy = state.mood === 'thinking' || state.mood === 'working' || state.mood === 'stressed';
  if (busy) {
    // Accumulate active time from the stream of busy events. A gap under a
    // minute counts as continuous work; longer gaps (idle/waiting) don't.
    if (a.lastBusyAt && now - a.lastBusyAt < 60000) a.activeMs += now - a.lastBusyAt;
    a.lastBusyAt = now;
  }
  const counted = state.attention || state.mood === 'error' || state.mood === 'happy';
  if (state.attention) a.confirms++;
  if (state.mood === 'error') a.errors++;
  if (state.mood === 'happy') {
    a.tasks++; // a completed turn/task
    bumpLifetime();
  }

  store.set('stats', s);

  // Push updated counts to the renderer only when a visible number changed.
  if (counted) {
    refreshWeekHistory();
    pushDailyStats();
    pushWeeklyStats();
  }

  // Feed the missed-event log for the states worth catching up on later.
  if (state.attention) logEvent(src, 'confirm', state.text || 'needs you to confirm');
  else if (state.mood === 'error') logEvent(src, 'error', state.text || 'hit an error');
  else if (state.mood === 'happy') logEvent(src, 'done', state.text || 'finished a task');

  scheduleTrayRefresh();
}

// ---------------------------------------------------------------------------
// Missed-event log — a small ring buffer of the last notable states, so you can
// glance at the tray and see what happened while you were away.
// ---------------------------------------------------------------------------
const MAX_EVENTS = 8;
function logEvent(source, kind, text) {
  const events = (store.get('events') || []).slice(-(MAX_EVENTS - 1));
  events.push({ at: Date.now(), source, kind, text: String(text).slice(0, 120) });
  store.set('events', events);
}

const EVENT_ICON = { confirm: '👀', error: '⚠️', done: '✅' };
function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function recentSubmenu() {
  const events = store.get('events') || [];
  if (!events.length) return [{ label: 'Nothing yet', enabled: false }];
  const items = events
    .slice()
    .reverse()
    .map((e) => {
      const who = SOURCE_NAMES[e.source] || e.source || 'AI';
      const icon = EVENT_ICON[e.kind] || '•';
      return { label: `${icon} ${who}: ${e.text}  (${timeAgo(e.at)})`, enabled: false };
    });
  items.push({ type: 'separator' });
  items.push({
    label: 'Clear log',
    click: () => {
      store.set('events', []);
      buildTrayMenu();
    }
  });
  return items;
}

// Count a completed task toward the lifetime total and surface any newly
// unlocked cosmetic with a little celebratory bubble.
function bumpLifetime() {
  const before = store.get('lifetimeTasks') || 0;
  const after = before + 1;
  store.set('lifetimeTasks', after);
  for (const [name, need] of Object.entries(COSMETIC_UNLOCKS)) {
    if (need > 0 && before < need && after >= need) {
      notice(`unlocked the ${name}! 🎁 (tray ▸ Settings to wear it)`);
    }
  }
}

// A transient celebratory bubble that doesn't disturb the active-AI mood state.
function notice(text) {
  if (win) win.webContents.send('notice', text);
}

function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const SOURCE_NAMES = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini', deepseek: 'DeepSeek' };

function statsSubmenu() {
  const s = store.get('stats');
  if (!s || s.date !== todayStr() || !Object.keys(s.perAi || {}).length) {
    return [{ label: 'No activity yet today', enabled: false }];
  }
  const items = Object.entries(s.perAi).map(([src, a]) => {
    let label = `${SOURCE_NAMES[src] || src}: ${a.tasks} done · ${fmtDur(a.activeMs)} active`;
    if (a.confirms) label += ` · ${a.confirms} confirm${a.confirms > 1 ? 's' : ''}`;
    if (a.errors) label += ` · ${a.errors} err`;
    return { label, enabled: false };
  });
  items.push({ type: 'separator' });
  items.push({
    label: 'Reset today',
    click: () => {
      store.set('stats', { date: todayStr(), perAi: {} });
      buildTrayMenu();
    }
  });
  return items;
}

// Rebuild the tray menu at most once every couple seconds so a burst of AI
// events doesn't thrash it (the menu only matters when actually opened).
let trayRefreshTimer = null;
function scheduleTrayRefresh() {
  if (trayRefreshTimer) return;
  trayRefreshTimer = setTimeout(() => {
    trayRefreshTimer = null;
    if (tray) buildTrayMenu();
  }, 2000);
}

// Resize the pet by changing the window size + matching the page zoom, keeping
// the pet (which sits at the bottom-center) visually anchored in place.
function applyScale(scale) {
  scale = clampScale(scale);
  store.set('scale', scale);
  if (!win) return;

  const w = Math.round(WIN_W * scale);
  const h = Math.round(WIN_H * scale);
  const [x, y] = win.getPosition();
  const [ow, oh] = win.getSize();

  const next = clampToScreen(
    Math.round(x + (ow - w) / 2),
    Math.round(y + (oh - h)),
    w,
    h
  );

  win.setBounds({ x: next.x, y: next.y, width: w, height: h });
  win.webContents.setZoomFactor(scale);
  savePosition();
}

function stepScale(direction) {
  applyScale(clampScale(store.get('scale')) + direction * SCALE_STEP);
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
  cancelMoveAnim(); // grabbing it mid-fling/stroll stops the motion
  isDragging = true;
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  dragOffset = { x: cursor.x - wx, y: cursor.y - wy };
  dragStart = { x: cursor.x, y: cursor.y };
  movedDistance = 0;
  dragVel = { x: 0, y: 0 };
  lastSample = { x: wx, y: wy, t: Date.now() };

  let grabbed = false;
  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      clearInterval(dragTimer);
      dragTimer = null;
      isDragging = false;
      return;
    }
    const p = screen.getCursorScreenPoint();
    movedDistance = Math.max(
      movedDistance,
      Math.hypot(p.x - dragStart.x, p.y - dragStart.y)
    );
    // Once it's clearly a drag (not a poke), tell the renderer it's being
    // carried so the pet kicks its legs / looks delighted. Fire once.
    if (!grabbed && movedDistance >= 6) {
      grabbed = true;
      win.webContents.send('pet-grabbed');
    }
    const nx = p.x - dragOffset.x;
    const ny = p.y - dragOffset.y;
    // Smooth the pointer velocity so a flick at release reads cleanly.
    const now = Date.now();
    const dt = now - lastSample.t || 16;
    dragVel.x = 0.7 * dragVel.x + 0.3 * ((nx - lastSample.x) / dt);
    dragVel.y = 0.7 * dragVel.y + 0.3 * ((ny - lastSample.y) / dt);
    lastSample = { x: nx, y: ny, t: now };
    win.setPosition(nx, ny);
  }, 16);
});

// Scroll the wheel over the pet to resize it.
ipcMain.on('resize-step', (_e, direction) => {
  stepScale(direction > 0 ? 1 : -1);
});

// ---------------------------------------------------------------------------
// IPC: open a link from the bubble (e.g. "jump back to the editor to confirm")
// ---------------------------------------------------------------------------
const ALLOWED_LINK_SCHEMES = new Set([
  'http:',
  'https:',
  'vscode:',
  'vscode-insiders:',
  'cursor:',
  'windsurf:'
]);
ipcMain.on('open-link', (_e, url) => {
  if (typeof url !== 'string') return;
  try {
    if (ALLOWED_LINK_SCHEMES.has(new URL(url).protocol)) shell.openExternal(url);
  } catch {
    /* not a valid URL — ignore */
  }
});

ipcMain.on('drag-end', () => {
  clearInterval(dragTimer);
  dragTimer = null;
  isDragging = false;
  if (!win) return;
  // Small movement => treat as a click/pet, not a drag.
  if (movedDistance < 6) {
    win.webContents.send('pet-click');
    return;
  }
  win.webContents.send('pet-dropped');
  // Throw physics: a flick at release sends the pet sliding + bouncing; a gentle
  // release just settles (and may perch on the top edge). Disabled => plain drop.
  if (store.get('physics') !== false) {
    flingPet(dragVel.x, dragVel.y);
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
  if (nowHidden) {
    win.hide();
  } else {
    win.show();
    win.webContents.send('pet-trick', 'wave'); // a little hello when it reappears
  }
  store.set('hidden', nowHidden);
  buildTrayMenu();
}

// Ask the pet to perform a trick (tray ▸ Tricks). The renderer animates it.
function doTrick(name) {
  if (win) win.webContents.send('pet-trick', name);
}

function toggleMuted() {
  const muted = !store.get('muted');
  store.set('muted', muted);
  pushSettings();
  buildTrayMenu();
}

// ---------------------------------------------------------------------------
// Focus mode (Pomodoro): main runs the work/break timer; the pet perks up for
// work blocks and naps on breaks (handled in the renderer's onFocus).
// ---------------------------------------------------------------------------
let focusTimer = null;
let focusState = null; // { phase: 'work' | 'break', endsAt }

function focusDurations() {
  const f = store.get('focus') || {};
  return {
    work: Math.max(1, Math.min(180, Number(f.work) || 25)),
    break: Math.max(1, Math.min(60, Number(f.break) || 5))
  };
}

function startFocusPhase(phase) {
  const minutes = focusDurations()[phase];
  focusState = { phase, endsAt: Date.now() + minutes * 60000 };
  if (win) win.webContents.send('focus', { phase, minutes });
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    startFocusPhase(phase === 'work' ? 'break' : 'work');
  }, minutes * 60000);
  buildTrayMenu();
}

function stopFocus() {
  clearTimeout(focusTimer);
  focusTimer = null;
  focusState = null;
  if (win) win.webContents.send('focus', { phase: null });
  buildTrayMenu();
}

function toggleFocus() {
  if (focusState) stopFocus();
  else startFocusPhase('work');
}

function focusLabel() {
  if (!focusState) return 'Start focus session';
  const left = Math.max(0, Math.ceil((focusState.endsAt - Date.now()) / 60000));
  return `${focusState.phase === 'work' ? 'Focusing' : 'On break'} · ~${left}m — Stop`;
}

// Toggle a behavior flag stored as a boolean (wander / physics / timeOfDay).
function toggleFlag(key) {
  const next = store.get(key) === false; // default-on flags
  store.set(key, next);
  pushSettings();
  buildTrayMenu();
}

// ---------------------------------------------------------------------------
// Global hotkey to show/hide the pet.
// ---------------------------------------------------------------------------
function registerHotkey() {
  globalShortcut.unregisterAll();
  const hk = store.get('hotkey');
  if (!hk) return;
  try {
    const ok = globalShortcut.register(hk, togglePetVisible);
    if (!ok) console.error('[pet] hotkey registration failed (taken?):', hk);
  } catch (err) {
    console.error('[pet] invalid hotkey:', hk, err.message);
  }
}

// ---------------------------------------------------------------------------
// Settings window (name + color picker)
// ---------------------------------------------------------------------------
function openSettings() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 360,
    height: 660,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Pet Settings',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => (settingsWin = null));
}

ipcMain.handle('settings:get', () => {
  const f = focusDurations();
  return {
    name: store.get('name') || '',
    color: PALETTE[store.get('color')] ? store.get('color') : 'green',
    palette: PALETTE,
    skin: SKINS.includes(store.get('skin')) ? store.get('skin') : 'slime',
    skins: SKINS,
    cosmetic: store.get('cosmetic') || 'none',
    cosmeticUnlocks: COSMETIC_UNLOCKS,
    unlocked: unlockedCosmetics(),
    lifetimeTasks: store.get('lifetimeTasks') || 0,
    timeOfDay: store.get('timeOfDay') !== false,
    wander: store.get('wander') !== false,
    physics: store.get('physics') !== false,
    muted: !!store.get('muted'),
    hotkey: store.get('hotkey') || '',
    stressTokens: Number(store.get('stressTokens')) || 0,
    token: store.get('token') || '',
    focus: { work: f.work, break: f.break }
  };
});

ipcMain.on('settings:set', (_e, cfg) => {
  if (!cfg || typeof cfg !== 'object') return;
  if (typeof cfg.name === 'string') store.set('name', cfg.name.slice(0, 24));
  if (typeof cfg.color === 'string' && PALETTE[cfg.color]) store.set('color', cfg.color);
  if (typeof cfg.skin === 'string' && SKINS.includes(cfg.skin)) store.set('skin', cfg.skin);
  // Only let the user equip a cosmetic they've actually unlocked.
  if (typeof cfg.cosmetic === 'string' && unlockedCosmetics().includes(cfg.cosmetic)) {
    store.set('cosmetic', cfg.cosmetic);
  }
  if (typeof cfg.timeOfDay === 'boolean') store.set('timeOfDay', cfg.timeOfDay);
  if (typeof cfg.wander === 'boolean') store.set('wander', cfg.wander);
  if (typeof cfg.physics === 'boolean') store.set('physics', cfg.physics);
  if (typeof cfg.muted === 'boolean') store.set('muted', cfg.muted);
  if (typeof cfg.stressTokens === 'number' && cfg.stressTokens >= 0) {
    store.set('stressTokens', Math.min(2e6, Math.round(cfg.stressTokens)));
  }
  if (cfg.focus && typeof cfg.focus === 'object') {
    store.set('focus', {
      work: Math.max(1, Math.min(180, Number(cfg.focus.work) || 25)),
      break: Math.max(1, Math.min(60, Number(cfg.focus.break) || 5))
    });
  }
  if (typeof cfg.hotkey === 'string') {
    store.set('hotkey', cfg.hotkey.trim());
    registerHotkey();
  }
  if (typeof cfg.token === 'string') store.set('token', cfg.token.slice(0, 200));

  pushSettings();
  buildTrayMenu();
  if (tray) tray.setToolTip(store.get('name') ? `${store.get('name')} — Desktop Pet` : 'Desktop Pet');
});

ipcMain.on('settings:close', () => {
  if (settingsWin) settingsWin.close();
});

// Right-clicking the pet opens the Settings window.
ipcMain.on('open-settings', () => openSettings());

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
    { label: store.get('name') ? `🐾 ${store.get('name')}` : 'Desktop Pet', enabled: false },
    { type: 'separator' },
    { label: visible ? 'Hide pet' : 'Show pet', click: togglePetVisible },
    { label: 'Wake / Poke', click: () => win && win.webContents.send('pet-click') },
    {
      label: 'Tricks',
      submenu: [
        { label: '💃 Dance', click: () => doTrick('dance') },
        { label: '🤸 Backflip', click: () => doTrick('flip') },
        { label: '👋 Wave', click: () => doTrick('wave') },
        { label: '🌀 Spin', click: () => doTrick('spin') }
      ]
    },
    { label: focusLabel(), click: toggleFocus },
    { label: 'Today', submenu: statsSubmenu() },
    { label: 'Recent', submenu: recentSubmenu() },
    { label: 'Settings…', click: openSettings },
    {
      label: 'Behavior',
      submenu: [
        {
          label: 'Wander on its own',
          type: 'checkbox',
          checked: store.get('wander') !== false,
          click: () => toggleFlag('wander')
        },
        {
          label: 'Throw physics',
          type: 'checkbox',
          checked: store.get('physics') !== false,
          click: () => toggleFlag('physics')
        },
        {
          label: 'Time-of-day tint',
          type: 'checkbox',
          checked: store.get('timeOfDay') !== false,
          click: () => toggleFlag('timeOfDay')
        }
      ]
    },
    {
      label: 'Reset position',
      click: () => {
        if (!win) return;
        const { x, y } = defaultPosition();
        win.setPosition(x, y);
        savePosition();
      }
    },
    {
      label: 'Size',
      submenu: [
        {
          label: 'Bigger',
          enabled: clampScale(store.get('scale')) < MAX_SCALE,
          click: () => {
            stepScale(1);
            buildTrayMenu();
          }
        },
        {
          label: 'Smaller',
          enabled: clampScale(store.get('scale')) > MIN_SCALE,
          click: () => {
            stepScale(-1);
            buildTrayMenu();
          }
        },
        {
          label: 'Reset size',
          click: () => {
            applyScale(1);
            buildTrayMenu();
          }
        }
      ]
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
  tray.setToolTip(store.get('name') ? `${store.get('name')} — Desktop Pet` : 'Desktop Pet');
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
    registerHotkey();
    scheduleWander();

    // Local control server: any AI / script POSTs a mood here. The auth token is
    // read live from the store so the Settings window can change it on the fly.
    startControlServer(
      PET_PORT,
      (state) => {
        recordStat(state);
        // This fires async from an HTTP request, which can land while the app
        // is quitting and the window is being torn down — guard accordingly.
        if (win && !win.isDestroyed()) win.webContents.send('ai-state', state);
      },
      { getToken: () => store.get('token') || process.env.PET_TOKEN || '' }
    );

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    savePosition();
    if (store) store.flushNow();
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
}

// Keep running with no windows (it's a tray/pet app).
app.on('window-all-closed', () => {});

if (process.platform === 'darwin' && app.dock) {
  app.dock.hide(); // no dock icon; live in the tray
}
