'use strict';

const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, globalShortcut,
  Notification, dialog, powerMonitor
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { startControlServer, ALLOWED_LINK_SCHEMES } = require('./server');
const { createStore } = require('./store');
const { parseClock, isQuietNow } = require('./quiet');
const { mergePetHooks, petHooksInstalled } = require('./claude-hooks');

const PET_PORT = Number(process.env.PET_PORT) || 7337;

// How big a context window counts as "full" for the pet's usage ring. The env
// var wins; otherwise it's whatever the Settings window last saved.
function ctxMax() {
  const fromEnv = Number(process.env.PET_CTX_MAX);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const saved = Number(store && store.get('ctxMax'));
  return Number.isFinite(saved) && saved > 0 ? saved : 200000;
}

// Body color presets the settings window offers (key -> [stop1, stop2]).
const PALETTE = {
  natural: ['#e9bd86', '#ac754b'],
  peach: ['#ffc49e', '#ec956d'],
  cream: ['#fff0ce', '#e4cca0'],
  cocoa: ['#b58b72', '#785643'],
  green: ['#7ee8a0', '#45c97a'],
  blue: ['#8fd2ff', '#4aa8f0'],
  pink: ['#ffc2d6', '#ff7eb6'],
  purple: ['#c3b5ff', '#8f6fff'],
  yellow: ['#ffe27a', '#ffc24a'],
  gray: ['#cfd6e0', '#9aa7b8']
};

const SKINS = ['slime', 'kitten', 'puppy'];

// Cosmetics and the lifetime-task count needed to unlock each. 'none' is free.
const COSMETIC_UNLOCKS = { none: 0, bowtie: 0, flower: 0, glasses: 10, cap: 20, headphones: 30, scarf: 50, crown: 120 };

let win = null;
let tray = null;
let store = null;
let settingsWin = null;
let statsWin = null;
// Where the control server actually bound, and why it didn't if it couldn't.
let serverPort = 0;
let serverError = '';

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

// ---------------------------------------------------------------------------
// Auth token. The control server speaks over an open CORS policy, so without a
// token any web page you have loaded could puppet the pet — and, worse, plant a
// bubble link. Generating one on first run makes auth the default with no setup
// on the user's part: the bundled hook reads the same config file we write here.
// ---------------------------------------------------------------------------
function ensureToken() {
  if (store.get('token')) return;
  store.set('token', crypto.randomBytes(24).toString('hex'));
  store.flushNow(); // the hook may read the file before our debounce fires
}

// ---------------------------------------------------------------------------
// Do-not-disturb. While a quiet window is active the pet keeps working (moods,
// stats, the ring) but stops demanding attention: no chimes, no OS
// notifications, no escalating nudges. The window maths lives in ./quiet so it
// can be tested without Electron.
// ---------------------------------------------------------------------------
function inQuietHours(now = new Date()) {
  return isQuietNow(store.get('quiet'), now);
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

// What the renderer last reported about the pet: asleep, busy, or waiting on
// a confirm. Wandering checks it so a sleeping or busy pet stays put.
let petState = { mood: 'idle', busy: false, confirm: false, reducedMotion: false };

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
  // Only an idle, awake pet with nothing pending goes for a stroll.
  if (petState.mood !== 'idle' || petState.busy || petState.confirm || petState.reducedMotion) return;
  const [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  const dx = (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 70);
  const dy = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 14);
  const target = clampToScreen(Math.round(x + dx), Math.round(y + dy), w, h);
  if (target.x === x && target.y === y) return;
  // Walk at a steady pace rather than gliding: the renderer plays a walk
  // cycle facing the direction of travel for exactly as long as the move.
  const dist = Math.hypot(target.x - x, target.y - y);
  const ms = Math.round(Math.min(2600, Math.max(900, dist * 20)));
  win.webContents.send('walk', { dir: target.x < x ? 'left' : 'right', ms });
  animateWindowTo(target.x, target.y, ms, savePosition);
}

ipcMain.on('pet-state', (_e, st) => {
  if (!st || typeof st !== 'object') return;
  petState = {
    mood: typeof st.mood === 'string' ? st.mood : petState.mood,
    busy: !!st.busy,
    confirm: !!st.confirm,
    reducedMotion: !!st.reducedMotion
  };
});

function defaultPosition() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { x: Math.round(width * 0.65), y: Math.round(height * 0.4) };
}

// Keep the window on a visible display (handles unplugged monitors / changed resolutions).
function clampToScreen(x, y, w = WIN_W, h = WIN_H) {
  const area = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - w),
    y: Math.min(Math.max(y, area.y), area.y + area.height - h)
  };
}

// Unplugging a monitor (or changing its resolution) can strand the pet on
// coordinates that no longer belong to any display — invisible, and only
// recoverable via the tray's "Reset position". Re-clamp it onto a real screen
// whenever the display layout changes.
function rescueOffscreenWindow() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  const next = clampToScreen(x, y, w, h);
  if (next.x === x && next.y === y) return;
  cancelMoveAnim(); // a fling/stroll aimed at the old geometry is now meaningless
  win.setPosition(next.x, next.y);
  savePosition();
}

function watchDisplays() {
  screen.on('display-removed', rescueOffscreenWindow);
  screen.on('display-added', rescueOffscreenWindow);
  screen.on('display-metrics-changed', rescueOffscreenWindow);
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
    pushSprite();
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

// The sprite-sheet config from the store, or null. The image itself lives in
// its own file next to the config (sp.file); a hand-written config may instead
// give a url under src/renderer/. The renderer clamps the geometry.
function spriteConfig() {
  const sp = store.get('sprite');
  if (!sp || typeof sp !== 'object') return null;
  const hasFile = typeof sp.file === 'string' && sp.file;
  const hasUrl = typeof sp.url === 'string' && sp.url;
  return hasFile || hasUrl ? sp : null;
}

// Send the full settings bundle (mute, context-window size, appearance) to the
// pet renderer. Called on load and whenever any of them change.
function pushSettings() {
  pushSettingsWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('settings', {
    muted: store.get('muted'),
    // Quiet hours read as "muted" to the renderer's sound + nudge logic, but
    // are surfaced separately so the pet can also skip the escalating bounce.
    quiet: inQuietHours(),
    ctxMax: ctxMax(),
    appearance: appearance()
  });
}

// Keep an open Settings window in step with changes made elsewhere (tray
// toggles, unlocks), so what it shows is what's actually stored.
function pushSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings:changed', settingsPayload());
  }
}

// The sprite with its image, for the pet window only. Sent on its own channel
// and only when it changes: the image can be megabytes, and the settings
// bundle goes out on every toggle.
let spriteUrlCache = { key: '', url: '' };
function spriteImageUrl(sp) {
  if (sp.url) return sp.url;
  const file = path.join(app.getPath('userData'), path.basename(sp.file));
  try {
    const key = `${file}:${fs.statSync(file).mtimeMs}`;
    if (spriteUrlCache.key !== key) {
      const mime = SPRITE_MIME[path.extname(file).toLowerCase()] || 'image/png';
      spriteUrlCache = { key, url: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` };
    }
    return spriteUrlCache.url;
  } catch (err) {
    console.error('[pet] sprite image unreadable:', err.message);
    return '';
  }
}

function pushSprite() {
  if (!win || win.isDestroyed()) return;
  const sp = spriteConfig();
  const url = sp ? spriteImageUrl(sp) : '';
  win.webContents.send('sprite', url ? { ...sp, url } : null);
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

// Show a greeting bubble once per calendar day, the first time you're
// actually around for it (launch, or your first activity after midnight — not
// at the stroke of midnight to an empty room). If yesterday had tasks, the pet
// mentions them. Returns true when it greeted.
function sendMorningGreeting() {
  const today = todayStr();
  if (store.get('lastGreetDate') === today) return false;
  store.set('lastGreetDate', today);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toLocaleDateString('en-CA');
  const yDay = (store.get('weekHistory') || []).find((d) => d.date === yStr);
  const total = yDay ? yDay.tasks || 0 : 0;

  const h = new Date().getHours();
  let msg;
  if (h < 5) msg = 'still up? 🌙 a new day already';
  else if (total > 0) msg = `good morning! ${total} task${total > 1 ? 's' : ''} done yesterday 🌟`;
  else if (h < 12) msg = 'good morning! 🌅';
  else if (h < 17) msg = 'good afternoon! ☀️';
  else msg = 'good evening! 🌙';

  // Fire after the wave-hello trick (700ms) has finished playing (~1.7s).
  setTimeout(() => notice(msg), 2500);
  return true;
}

// ---------------------------------------------------------------------------
// "While you were away". The pet notes when you leave (hiding it, or the
// machine going idle) and when you come back sums up what happened, so a
// finished task or a waiting prompt isn't lost.
// ---------------------------------------------------------------------------
const AWAY_IDLE_SECS = 5 * 60;
let awaySince = 0;

function markAway(at = Date.now()) {
  if (!awaySince) awaySince = at;
}

function awaySummary(since) {
  const n = { done: 0, confirm: 0, error: 0 };
  for (const e of store.get('events') || []) {
    if (e.at >= since && e.kind in n) n[e.kind]++;
  }
  const waiting = [...openConfirms.values()].filter((c) => !c.acked).length;
  const parts = [];
  if (n.done) parts.push(`${n.done} done`);
  if (n.error) parts.push(`${n.error} error${n.error > 1 ? 's' : ''}`);
  if (waiting) parts.push(`${waiting} waiting on you`);
  return parts.length ? `while you were away: ${parts.join(', ')} 📋` : '';
}

function welcomeBack() {
  const since = awaySince;
  awaySince = 0;
  const greeted = sendMorningGreeting();
  if (!since) return;
  const msg = awaySummary(since);
  if (msg) setTimeout(() => notice(msg), greeted ? 6500 : 2500);
}

// Polled from the minute timer: notice the user leaving and returning by the
// system idle time, which covers walking away without hiding the pet.
function pollPresence() {
  if (!powerMonitor || typeof powerMonitor.getSystemIdleTime !== 'function') return;
  const idle = powerMonitor.getSystemIdleTime();
  if (idle >= AWAY_IDLE_SECS) {
    markAway(Date.now() - idle * 1000);
    return;
  }
  if (idle > 30 || !win || win.isDestroyed() || !win.isVisible()) return;
  if (awaySince || store.get('lastGreetDate') !== todayStr()) welcomeBack();
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
  // Today plus the six days before it — the same window the chart draws, so the
  // "this week" total and the bars always agree.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
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

// ---------------------------------------------------------------------------
// Event classification. Each incoming state is classified once, up front, so
// the stats tally, the event log and the OS notification all agree on whether
// it is new, with no ordering dependency between them.
// ---------------------------------------------------------------------------
// Confirms not yet answered, keyed by source + session. Claude Code announces
// one prompt several times (PermissionRequest, then a permission_prompt
// Notification, then reminders); while one is open, further confirms from the
// same session are that prompt again, not new ones.
const openConfirms = new Map(); // key -> { at, source, session, text, link }
const CONFIRM_OPEN_MS = 10 * 60000; // an older one is treated as a new prompt

function sourceKey(state) {
  return `${(state.source || '').toLowerCase().trim()}|${state.session || ''}`;
}

function classify(state) {
  const src = (state.source || '').toLowerCase().trim();
  const key = sourceKey(state);
  const kind = state.attention
    ? 'confirm'
    : state.mood === 'error'
      ? 'error'
      : state.mood === 'happy'
        ? 'done'
        : '';
  const text = state.text || DEFAULT_EVENT_TEXT[kind] || '';
  let repeat = false;
  if (kind === 'confirm') {
    const now = Date.now();
    const open = openConfirms.get(key);
    repeat = !!open && now - open.at < CONFIRM_OPEN_MS;
    openConfirms.set(key, {
      at: repeat ? open.at : now,
      source: src,
      session: state.session || '',
      text,
      link: state.link || (repeat ? open.link : '')
    });
  } else {
    // Any other event from that session means its prompt was answered.
    if (!src && state.mood === 'idle') openConfirms.clear(); // blanket clear
    else openConfirms.delete(key);
    if (kind) repeat = isRepeatEvent(src, kind, text);
  }
  return { src, key, kind, text, repeat };
}

// Fold one incoming AI state into the running daily tally.
function recordStat(state, info) {
  const { src, kind, text, repeat } = info;
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
  // Claude Code re-announces a pending prompt, so the same confirm can arrive
  // many times over (classify() marks those as repeats). Counting each one
  // would inflate the confirm tally and flood the event log.
  const counted =
    !repeat && (state.attention || state.mood === 'error' || state.mood === 'happy');
  if (state.attention && !repeat) a.confirms++;
  if (state.mood === 'error' && !repeat) a.errors++;
  if (state.mood === 'happy' && !repeat) {
    a.tasks++; // a completed turn/task
    bumpLifetime();
  }

  store.set('stats', s);

  // Push updated counts to the renderer only when a visible number changed.
  if (counted) {
    refreshWeekHistory();
    pushDailyStats();
    pushWeeklyStats();
    pushActivity();
  }

  // Feed the missed-event log for the states worth catching up on later.
  if (kind && !repeat) logEvent(src, kind, text);

  scheduleTrayRefresh();
}

// ---------------------------------------------------------------------------
// Missed-event log — a small ring buffer of the last notable states, so you can
// glance at the tray and see what happened while you were away.
// ---------------------------------------------------------------------------
// Kept longer than the tray shows, so "while you were away" can summarise.
const MAX_EVENTS = 50;
const RECENT_IN_TRAY = 8;

const DEFAULT_EVENT_TEXT = {
  confirm: 'needs you to confirm',
  error: 'hit an error',
  done: 'finished a task'
};

// An identical (source, kind, text) inside this window is treated as the same
// event re-announced rather than a new one. Long enough to swallow Claude
// Code's repeating "still waiting" notifications, short enough that genuinely
// repeated work (two identical tool errors a minute apart) still both register.
const EVENT_REPEAT_MS = 90000;

function isRepeatEvent(source, kind, text) {
  // Look through the whole recent window, not just the newest entry, so two
  // sources reporting alternately can't defeat the check.
  const t = String(text).slice(0, 120);
  const now = Date.now();
  return (store.get('events') || []).some(
    (e) => e.source === source && e.kind === kind && e.text === t && now - e.at < EVENT_REPEAT_MS
  );
}

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
    .slice(-RECENT_IN_TRAY)
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
  pushSettingsWindow();
}

// A transient celebratory bubble that doesn't disturb the active-AI mood state.
// Fires from the async HTTP path (bumpLifetime), so guard against teardown.
function notice(text) {
  if (win && !win.isDestroyed()) win.webContents.send('notice', text);
}

// ---------------------------------------------------------------------------
// Native notification fallback. Hiding the pet (hotkey or tray) would otherwise
// make the one moment that matters — a permission prompt — invisible: the
// renderer still chimes, but there is nothing on screen to look at. When the pet
// is hidden we hand the important states to the OS instead, and clicking the
// notification brings the pet back (or jumps to the editor when we have a link).
// ---------------------------------------------------------------------------
function notifyWhenHidden(state, info) {
  if (win && !win.isDestroyed() && win.isVisible()) return; // the pet itself is the notice
  if (store.get('notifyWhenHidden') === false) return;
  if (inQuietHours()) return;
  if (!Notification.isSupported()) return;

  const important = state.attention || state.mood === 'error';
  if (!important) return;

  const who = SOURCE_NAMES[info.src] || state.source || 'AI';
  const text = info.text;
  // A re-announced prompt shouldn't stack up notifications while you're away.
  if (info.repeat) return;

  const name = store.get('name');
  const n = new Notification({
    title: state.attention
      ? `${who} needs you${name ? ` — ${name} is waiting` : ''}`
      : `${who} hit an error`,
    body: String(text).slice(0, 200),
    silent: !!store.get('muted')
  });
  n.on('click', () => {
    if (state.link && openLinkSafely(state.link)) return;
    showPet();
  });
  n.show();
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
// Opening links from the bubble, a notification, or the confirm hotkey.
// ---------------------------------------------------------------------------
// Terminal apps a pet-focus://app/<TERM_PROGRAM> link may bring forward. The
// name comes from the network, so only these exact values are ever acted on.
const FOCUSABLE_TERMINALS = {
  'iTerm.app': 'iTerm',
  Apple_Terminal: 'Terminal',
  WarpTerminal: 'Warp',
  ghostty: 'Ghostty',
  WezTerm: 'WezTerm',
  Hyper: 'Hyper',
  Tabby: 'Tabby',
  kitty: 'kitty',
  alacritty: 'Alacritty'
};

// Open a link if its scheme is allowed. Returns true when something was opened.
function openLinkSafely(url) {
  if (typeof url !== 'string') return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!ALLOWED_LINK_SCHEMES.has(u.protocol)) return false;
  if (u.protocol === 'pet-focus:') {
    let term = '';
    try {
      term = decodeURIComponent(u.pathname.replace(/^\//, ''));
    } catch {
      return false;
    }
    const known = u.hostname === 'app' && Object.prototype.hasOwnProperty.call(FOCUSABLE_TERMINALS, term);
    if (!known || process.platform !== 'darwin') return false;
    execFile('open', ['-a', FOCUSABLE_TERMINALS[term]], (err) => {
      if (err) console.error('[pet] could not focus terminal:', err.message);
    });
    return true;
  }
  shell.openExternal(url);
  return true;
}

// The bubble's link (e.g. "jump back to the editor to confirm").
ipcMain.on('open-link', (_e, url) => {
  openLinkSafely(url);
});

ipcMain.on('drag-end', () => {
  // The renderer sends drag-end on every mouseup (it listens on window), so a
  // right-click release or a mouseup that never started a drag lands here too.
  // Without a matching drag-start there is nothing to finish — and treating it
  // as a click would fire a phantom poke (e.g. while opening Settings).
  if (!isDragging) return;
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
  if (win.isVisible()) {
    win.hide();
    markAway();
    store.set('hidden', true);
    buildTrayMenu();
  } else {
    showPet();
  }
}

// Bring the pet back (tray, hotkey, notification click, second launch) with a
// little hello and a summary of anything that happened while it was hidden.
function showPet() {
  if (!win || win.isDestroyed()) return;
  const wasHidden = !win.isVisible();
  win.show();
  store.set('hidden', false);
  if (tray) buildTrayMenu();
  if (wasHidden) {
    win.webContents.send('pet-trick', 'wave');
    welcomeBack();
  }
}

// Ask the pet to perform a trick (tray ▸ Tricks). The renderer animates it.
function doTrick(name) {
  if (win) win.webContents.send('pet-trick', name);
}

const TRICKS = [
  ['💃 Dance', 'dance'],
  ['🤸 Backflip', 'flip'],
  ['👋 Wave', 'wave'],
  ['🌀 Spin', 'spin'],
  ['🥱 Yawn & stretch', 'yawn'],
  ['👀 Curious tilt', 'curious'],
  ['🐾 Shake it off', 'shake'],
  ['💕 Blow a kiss', 'kiss'],
  ['👃 Sniff around', 'sniff'],
  ['🐾 Give a paw', 'paw'],
  ['✨ Groom', 'groom']
];

function trickMenuItems() {
  return TRICKS.map(([label, name]) => ({ label, click: () => doTrick(name) }));
}

// Right-clicking the pet opens this play menu, so the tricks are one click
// away instead of buried in the tray.
function showPetMenu() {
  if (!win || win.isDestroyed()) return;
  Menu.buildFromTemplate([
    ...trickMenuItems(),
    { type: 'separator' },
    { label: focusLabel(), click: toggleFocus },
    { label: 'Activity…', click: openStats },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Hide pet', click: togglePetVisible }
  ]).popup({ window: win });
}

ipcMain.on('pet-menu', () => showPetMenu());

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

// Toggle a behavior flag stored as a boolean (wander / physics / timeOfDay /
// notifyWhenHidden) — all of which default to on.
function toggleFlag(key) {
  const next = store.get(key) === false;
  store.set(key, next);
  pushSettings();
  buildTrayMenu();
}

function quietLabel() {
  const q = store.get('quiet') || {};
  if (!q.enabled) return 'Quiet hours';
  return `Quiet hours (${q.from}–${q.to})${inQuietHours() ? ' · on now' : ''}`;
}

function toggleQuiet() {
  const q = { ...(store.get('quiet') || {}) };
  q.enabled = !q.enabled;
  store.set('quiet', q);
  pushSettings();
  buildTrayMenu();
}

// ---------------------------------------------------------------------------
// Global hotkeys: show/hide the pet, and answer the latest waiting confirm.
// A failure is kept so Settings can say why the shortcut does nothing.
// ---------------------------------------------------------------------------
let hotkeyErrors = { hotkey: '', confirmHotkey: '' };

function bindHotkey(key, fn) {
  const hk = store.get(key);
  if (!hk) return;
  try {
    if (!globalShortcut.register(hk, fn)) hotkeyErrors[key] = `${hk} is already used by another app`;
  } catch {
    hotkeyErrors[key] = `"${hk}" isn't a valid shortcut`;
  }
  if (hotkeyErrors[key]) console.error('[pet] hotkey:', hotkeyErrors[key]);
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyErrors = { hotkey: '', confirmHotkey: '' };
  bindHotkey('hotkey', togglePetVisible);
  bindHotkey('confirmHotkey', answerLatestConfirm);
}

// Jump to the newest confirm nobody has answered yet: open its link (editor or
// terminal) and tell the renderer to stop nudging about it.
function answerLatestConfirm() {
  let latest = null;
  for (const [key, c] of openConfirms) {
    if (!c.acked && (!latest || c.at > latest.c.at)) latest = { key, c };
  }
  if (!latest) {
    showPet();
    notice('nothing is waiting on you ✨');
    return;
  }
  // Stays in the map (marked) so a re-announcement still counts as the same
  // prompt rather than a new one.
  latest.c.acked = true;
  if (win && !win.isDestroyed()) win.webContents.send('confirm-ack', latest.key);
  if (!(latest.c.link && openLinkSafely(latest.c.link))) showPet();
}

// ---------------------------------------------------------------------------
// Auto-update. Only meaningful for a packaged build that was published with an
// update channel (electron-builder writes app-update.yml into the bundle when
// a `publish` target is configured — see "Releasing updates" in the README).
// Loaded lazily so a dev run, or a build without the dependency, still boots.
// ---------------------------------------------------------------------------
let updaterChecking = false;
// Set once an update has been downloaded and only needs a restart to apply.
let updateReady = '';

function canAutoUpdate() {
  if (!app.isPackaged) return false;
  try {
    require.resolve('electron-updater');
    return true;
  } catch {
    return false;
  }
}

function checkForUpdates({ interactive = false } = {}) {
  if (!canAutoUpdate()) {
    if (interactive) notice('updates only work in a packaged build');
    return;
  }
  if (updaterChecking) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('[pet] updater unavailable:', err.message);
    return;
  }

  updaterChecking = true;
  // We tell the user ourselves, in the pet's own voice, rather than letting the
  // updater pop native dialogs over whatever they're doing.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.removeAllListeners();

  autoUpdater.on('update-available', (info) => notice(`update ${info.version} downloading… ⬇️`));
  autoUpdater.on('update-not-available', () => {
    if (interactive) notice("you're up to date! ✨");
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = info.version;
    notice(`update ${info.version} ready — restart to apply 🎉`);
    buildTrayMenu();
  });
  autoUpdater.on('error', (err) => {
    updaterChecking = false;
    console.error('[pet] update check failed:', err && err.message);
    if (interactive) notice('could not check for updates 😞');
  });

  Promise.resolve(autoUpdater.checkForUpdates())
    .catch((err) => {
      console.error('[pet] update check failed:', err && err.message);
      if (interactive) notice('no update channel configured');
    })
    .finally(() => {
      updaterChecking = false;
    });
}

function installUpdateAndRestart() {
  try {
    const { autoUpdater } = require('electron-updater');
    store.flushNow();
    autoUpdater.quitAndInstall();
  } catch (err) {
    console.error('[pet] could not install update:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Activity window — the 7-day history and per-AI breakdown we already collect,
// shown as an actual chart instead of a line of text in a tray submenu.
// ---------------------------------------------------------------------------
function openStats() {
  if (statsWin && !statsWin.isDestroyed()) {
    statsWin.show();
    statsWin.focus();
    return;
  }
  statsWin = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Pet Activity',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'stats-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  statsWin.loadFile(path.join(__dirname, 'renderer', 'stats.html'));
  statsWin.once('ready-to-show', () => statsWin.show());
  statsWin.on('closed', () => (statsWin = null));
}

// The full activity payload the stats window renders.
function activityReport() {
  const today = getStats();
  const history = getWeekHistory();
  // Fill in the days with no activity so the chart shows a real week, not just
  // the days that happened to have events.
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toLocaleDateString('en-CA');
    const found = history.find((h) => h.date === date);
    days.push({
      date,
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      tasks: found ? found.tasks || 0 : 0,
      activeMs: found ? found.activeMs || 0 : 0
    });
  }
  return {
    days,
    totals: weeklyTotals(),
    perAi: Object.entries(today.perAi || {}).map(([src, a]) => ({
      source: src,
      name: SOURCE_NAMES[src] || src,
      tasks: a.tasks || 0,
      confirms: a.confirms || 0,
      errors: a.errors || 0,
      activeMs: a.activeMs || 0
    })),
    lifetimeTasks: store.get('lifetimeTasks') || 0,
    events: (store.get('events') || []).slice().reverse().map((e) => ({
      ...e,
      name: SOURCE_NAMES[e.source] || e.source || 'AI',
      ago: timeAgo(e.at)
    }))
  };
}

ipcMain.handle('stats:get', () => activityReport());

// Push a refresh to an open stats window whenever the numbers move.
function pushActivity() {
  if (statsWin && !statsWin.isDestroyed()) {
    statsWin.webContents.send('activity', activityReport());
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
    width: 380,
    // Tall enough for the common case, and resizable/scrollable because the
    // panel has grown well past what a fixed height can promise on every screen.
    height: 760,
    minWidth: 340,
    minHeight: 400,
    resizable: true,
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

ipcMain.handle('settings:get', () => settingsPayload());

function settingsPayload() {
  const f = focusDurations();
  return {
    name: store.get('name') || '',
    color: PALETTE[store.get('color')] ? store.get('color') : 'green',
    palette: PALETTE,
    skin: SKINS.includes(store.get('skin')) ? store.get('skin') : 'slime',
    skins: SKINS,
    cosmetic: appearance().cosmetic,
    cosmeticUnlocks: COSMETIC_UNLOCKS,
    unlocked: unlockedCosmetics(),
    lifetimeTasks: store.get('lifetimeTasks') || 0,
    timeOfDay: store.get('timeOfDay') !== false,
    wander: store.get('wander') !== false,
    physics: store.get('physics') !== false,
    muted: !!store.get('muted'),
    hotkey: store.get('hotkey') || '',
    confirmHotkey: store.get('confirmHotkey') || '',
    hotkeyErrors: { ...hotkeyErrors },
    stressTokens: Number(store.get('stressTokens')) || 0,
    ctxMax: ctxMax(),
    ctxMaxLocked: Number.isFinite(Number(process.env.PET_CTX_MAX)) && Number(process.env.PET_CTX_MAX) > 0,
    notifyWhenHidden: store.get('notifyWhenHidden') !== false,
    autoUpdate: store.get('autoUpdate') !== false,
    canAutoUpdate: canAutoUpdate(),
    quiet: { ...(store.get('quiet') || {}) },
    sprite: spriteMeta(),
    token: store.get('token') || '',
    port: serverPort || Number(store.get('port')) || PET_PORT,
    serverError,
    focus: { work: f.work, break: f.break },
    hooksPath: hookScriptPath(),
    hooksInstalled: claudeHooksInstalled()
  };
}

// The settings window saves on every keystroke, so this handler must be cheap
// and idempotent: only act on values that actually changed. Re-registering the
// global hotkey or rebuilding the native tray menu once per typed character is
// both wasteful and harmful — unregisterAll() leaves the shortcut dead for a
// beat each time, and a taken accelerator would log a failure per keystroke.
function setIfChanged(key, value) {
  if (store.get(key) === value) return false;
  store.set(key, value);
  return true;
}

ipcMain.on('settings:set', (_e, cfg) => {
  if (!cfg || typeof cfg !== 'object') return;

  let trayDirty = false;

  if (typeof cfg.name === 'string') {
    trayDirty = setIfChanged('name', cfg.name.slice(0, 24)) || trayDirty;
  }
  if (typeof cfg.color === 'string' && PALETTE[cfg.color]) setIfChanged('color', cfg.color);
  if (typeof cfg.skin === 'string' && SKINS.includes(cfg.skin)) setIfChanged('skin', cfg.skin);
  // Only let the user equip a cosmetic they've actually unlocked.
  if (typeof cfg.cosmetic === 'string' && unlockedCosmetics().includes(cfg.cosmetic)) {
    setIfChanged('cosmetic', cfg.cosmetic);
  }
  if (typeof cfg.timeOfDay === 'boolean') trayDirty = setIfChanged('timeOfDay', cfg.timeOfDay) || trayDirty;
  if (typeof cfg.wander === 'boolean') trayDirty = setIfChanged('wander', cfg.wander) || trayDirty;
  if (typeof cfg.physics === 'boolean') trayDirty = setIfChanged('physics', cfg.physics) || trayDirty;
  if (typeof cfg.muted === 'boolean') trayDirty = setIfChanged('muted', cfg.muted) || trayDirty;
  if (typeof cfg.notifyWhenHidden === 'boolean') {
    trayDirty = setIfChanged('notifyWhenHidden', cfg.notifyWhenHidden) || trayDirty;
  }
  if (typeof cfg.autoUpdate === 'boolean') setIfChanged('autoUpdate', cfg.autoUpdate);
  if (typeof cfg.stressTokens === 'number' && cfg.stressTokens >= 0) {
    setIfChanged('stressTokens', Math.min(2e6, Math.round(cfg.stressTokens)));
  }
  if (typeof cfg.ctxMax === 'number' && cfg.ctxMax > 0) {
    setIfChanged('ctxMax', Math.min(1e7, Math.max(1000, Math.round(cfg.ctxMax))));
  }
  if (cfg.focus && typeof cfg.focus === 'object') {
    // Either duration may be sent alone; the other keeps its current value.
    const cur = focusDurations();
    const next = {
      work: Math.max(1, Math.min(180, Number(cfg.focus.work) || cur.work)),
      break: Math.max(1, Math.min(60, Number(cfg.focus.break) || cur.break))
    };
    if (cur.work !== next.work || cur.break !== next.break) store.set('focus', next);
  }
  if (cfg.quiet && typeof cfg.quiet === 'object') {
    const cur = store.get('quiet') || {};
    const next = {
      enabled: typeof cfg.quiet.enabled === 'boolean' ? cfg.quiet.enabled : !!cur.enabled,
      // Reject an unparseable time rather than storing it — an empty or
      // half-typed field would otherwise silently disable the whole window.
      from: parseClock(cfg.quiet.from) != null ? String(cfg.quiet.from) : cur.from,
      to: parseClock(cfg.quiet.to) != null ? String(cfg.quiet.to) : cur.to
    };
    if (cur.enabled !== next.enabled || cur.from !== next.from || cur.to !== next.to) {
      store.set('quiet', next);
      trayDirty = true;
    }
  }
  let hotkeysDirty = false;
  if (typeof cfg.hotkey === 'string') hotkeysDirty = setIfChanged('hotkey', cfg.hotkey.trim()) || hotkeysDirty;
  if (typeof cfg.confirmHotkey === 'string') {
    hotkeysDirty = setIfChanged('confirmHotkey', cfg.confirmHotkey.trim()) || hotkeysDirty;
  }
  if (hotkeysDirty) registerHotkeys();
  // An empty token would switch auth off and let any web page drive the pet,
  // so it is refused; use Regenerate to replace it instead.
  if (typeof cfg.token === 'string' && cfg.token.trim()) {
    if (setIfChanged('token', cfg.token.trim().slice(0, 200))) store.flushNow(); // hooks read it from disk
  }

  pushSettings(); // also refreshes the Settings window (e.g. a hotkey error)
  if (trayDirty) {
    buildTrayMenu();
    if (tray && !serverError) {
      tray.setToolTip(store.get('name') ? `${store.get('name')} — Desktop Pet` : 'Desktop Pet');
    }
  }
});

// ---------------------------------------------------------------------------
// Sprite-sheet art. The picked image is copied into the userData dir (so it
// survives the original being moved) and kept out of pet-config.json: that
// file is rewritten on every AI event and parsed by every hook call, so a
// multi-megabyte image inside it made both slow. The pet window gets it as a
// data URI, since its CSP only allows same-origin resources.
// ---------------------------------------------------------------------------
const MAX_SPRITE_BYTES = 4 * 1024 * 1024;
const SPRITE_MIME = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

// Rows map to moods top-to-bottom in this order; a sheet with fewer rows just
// reuses the last one it has, so a 2-row sheet still animates every mood.
const SPRITE_MOOD_ORDER = ['idle', 'thinking', 'working', 'happy', 'stressed', 'sleeping', 'error'];

function spriteMoodMap(cols, rows) {
  const moods = {};
  SPRITE_MOOD_ORDER.forEach((mood, i) => {
    moods[mood] = { row: Math.min(i, rows - 1), frames: cols };
  });
  return moods;
}

// Normalize whatever geometry the UI sent into a complete, safe sprite config.
// `file` is the image's name in the userData dir.
function buildSprite(file, geom = {}) {
  const cols = Math.max(1, Math.min(64, Math.round(Number(geom.cols) || 1)));
  const rows = Math.max(1, Math.min(64, Math.round(Number(geom.rows) || 1)));
  const fps = Math.max(1, Math.min(60, Math.round(Number(geom.fps) || 8)));
  return { file, cols, rows, fps, moods: spriteMoodMap(cols, rows) };
}

// What the Settings window needs to render — never the multi-megabyte data URI.
function spriteMeta() {
  const sp = spriteConfig();
  if (!sp) return null;
  return { cols: sp.cols, rows: sp.rows, fps: sp.fps, name: sp.name || 'sprite sheet' };
}

function removeSpriteFiles() {
  for (const ext of Object.keys(SPRITE_MIME)) {
    try {
      fs.unlinkSync(path.join(app.getPath('userData'), 'sprite' + ext));
    } catch {
      /* not there */
    }
  }
}

// Earlier builds stored the image inline as a data URI. Move it to its own file.
function migrateInlineSprite() {
  const sp = store.get('sprite');
  if (!sp || typeof sp !== 'object' || typeof sp.url !== 'string') return;
  const m = /^data:image\/(png|gif|webp);base64,(.*)$/s.exec(sp.url);
  if (!m) return; // a url under src/renderer/ — nothing inline to move
  const file = 'sprite.' + m[1];
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), file), Buffer.from(m[2], 'base64'));
  } catch (err) {
    console.error('[pet] could not move sprite out of the config:', err.message);
    return;
  }
  const next = { ...sp, file };
  delete next.url;
  store.set('sprite', next);
  store.flushNow();
}

ipcMain.handle('settings:pickSprite', async () => {
  const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined;
  const res = await dialog.showOpenDialog(parent, {
    title: 'Choose a sprite sheet',
    properties: ['openFile'],
    filters: [{ name: 'Sprite sheet', extensions: ['png', 'gif', 'webp'] }]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };

  const file = res.filePaths[0];
  const ext = path.extname(file).toLowerCase();
  const mime = SPRITE_MIME[ext];
  if (!mime) return { ok: false, error: 'unsupported image type' };

  try {
    if (fs.statSync(file).size > MAX_SPRITE_BYTES) {
      return { ok: false, error: 'sprite sheet is larger than 4 MB' };
    }
    removeSpriteFiles();
    fs.copyFileSync(file, path.join(app.getPath('userData'), 'sprite' + ext));
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const prev = spriteConfig() || {};
  const sprite = buildSprite('sprite' + ext, prev);
  sprite.name = path.basename(file);
  store.set('sprite', sprite);
  pushSprite();
  return { ok: true, sprite: spriteMeta() };
});

ipcMain.on('settings:setSprite', (_e, geom) => {
  const sp = spriteConfig();
  if (!sp || !geom || typeof geom !== 'object') return;
  const next = { ...buildSprite(sp.file, geom), name: sp.name };
  if (sp.url) {
    next.url = sp.url;
    delete next.file;
  }
  if (next.cols === sp.cols && next.rows === sp.rows && next.fps === sp.fps) return;
  store.set('sprite', next);
  pushSprite();
});

ipcMain.on('settings:clearSprite', () => {
  if (!store.get('sprite')) return;
  store.set('sprite', null);
  removeSpriteFiles();
  pushSprite();
});

// A fresh token, for when the old one leaked or was pasted somewhere public.
// Hooks pick it up from the config file; the userscript needs it pasted in.
ipcMain.handle('settings:regenToken', () => {
  store.set('token', crypto.randomBytes(24).toString('hex'));
  store.flushNow();
  return store.get('token');
});

// ---------------------------------------------------------------------------
// One-click Claude Code setup: merge the pet's hooks into ~/.claude/settings.json
// (after asking, and with a backup), pointing at this install's hook script.
// ---------------------------------------------------------------------------
function hookScriptPath() {
  // Packaged builds ship hooks/ as extraResources, outside the asar archive.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'hooks', 'pet-notify.js')
    : path.join(__dirname, '..', 'hooks', 'pet-notify.js');
}

function claudeSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function hookCommand() {
  return `node "${hookScriptPath()}"`;
}

function readClaudeSettings() {
  const file = claudeSettingsPath();
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}

function claudeHooksInstalled() {
  try {
    return petHooksInstalled(readClaudeSettings(), hookCommand());
  } catch {
    return false;
  }
}

ipcMain.handle('settings:installHooks', async () => {
  const file = claudeSettingsPath();
  let current;
  try {
    current = readClaudeSettings();
  } catch (err) {
    return { ok: false, error: `couldn't read ${file}: ${err.message}` };
  }
  const { settings, changed } = mergePetHooks(current, hookCommand());
  if (!changed) return { ok: true, changed: false };

  const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined;
  const { response } = await dialog.showMessageBox(parent, {
    type: 'question',
    buttons: ['Install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Add the pet to Claude Code?',
    detail: `This adds hook entries to ${file} that run:\n${hookCommand()}\n\nYour other settings and hooks are kept, and the current file is backed up first. Needs Node.js on your PATH.`
  });
  if (response !== 0) return { ok: false, cancelled: true };

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.pet-backup');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: true, changed: true, file };
});

ipcMain.on('settings:close', () => {
  if (settingsWin) settingsWin.close();
});

// Right-clicking the pet opens the Settings window.
ipcMain.on('open-settings', () => openSettings());

// The OS owns the login item: the user can remove it in System Settings, so
// read it back instead of trusting the stored flag. (Linux has no login-item
// API in Electron, so there the stored flag is all we have.)
function syncLaunchAtLogin() {
  if (process.platform === 'linux' || typeof app.getLoginItemSettings !== 'function') return;
  try {
    store.set('launchAtLogin', !!app.getLoginItemSettings().openAtLogin);
  } catch (err) {
    console.error('[pet] could not read login item:', err.message);
  }
}

// One-off upgrades of settings written by older builds.
function migrateConfig() {
  const version = Number(store.get('configVersion')) || 0;
  if (version < 1) {
    // The old default show/hide shortcut, Cmd/Ctrl+Shift+P, is VS Code's
    // command palette. Registered globally, it stole that keystroke from
    // every app. Anyone still on the old default moves to the new one.
    if (store.get('hotkey') === 'CommandOrControl+Shift+P') {
      store.set('hotkey', 'CommandOrControl+Alt+Shift+P');
    }
  }
  if (version < 1) store.set('configVersion', 1);
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
    { label: store.get('name') ? `🐾 ${store.get('name')}` : 'Desktop Pet', enabled: false },
    // Connection status: without this, a server that never bound leaves the pet
    // looking perfectly healthy while silently ignoring every AI event.
    serverError
      ? { label: `⚠️ offline — ${serverError}`, enabled: false }
      : {
          label: serverPort
            ? `● listening on :${serverPort}${serverPort === PET_PORT ? '' : ' (fallback)'}`
            : '○ starting…',
          enabled: false
        },
    { type: 'separator' },
    { label: visible ? 'Hide pet' : 'Show pet', click: togglePetVisible },
    { label: 'Wake / Poke', click: () => win && win.webContents.send('pet-click') },
    { label: 'Tricks', submenu: trickMenuItems() },
    { label: focusLabel(), click: toggleFocus },
    { label: 'Today', submenu: statsSubmenu() },
    { label: 'Recent', submenu: recentSubmenu() },
    { label: 'Activity…', click: openStats },
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
        },
        { type: 'separator' },
        {
          label: 'Notify when hidden',
          type: 'checkbox',
          checked: store.get('notifyWhenHidden') !== false,
          click: () => toggleFlag('notifyWhenHidden')
        },
        {
          label: quietLabel(),
          type: 'checkbox',
          checked: !!(store.get('quiet') || {}).enabled,
          click: toggleQuiet
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
    updateReady
      ? {
          label: `Restart to update to ${updateReady}`,
          click: installUpdateAndRestart
        }
      : {
          label: 'Check for updates…',
          enabled: canAutoUpdate(),
          click: () => checkForUpdates({ interactive: true })
        },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  // A tiny green blob icon (with eyes), built inline so we need no asset files.
  // 16px for standard displays plus a 32px @2x representation for retina.
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAtElEQVR42mNgGAVYQcGD6Seg+D8Ug/lEac65N+U/PoxTY+adSScy70z6D8IgAGPjEMN0Teqt/v8gjAzwiaFoTrrZeyLpZi9ckba21X90gCwGUgvSAzcg7nr3ibjr3f9BGBngEwPpgRsQdbXjRNTVjv8wDALIfBxiqOEQfrntPykYIxCDL7acCL7Y8p9IjD1NBJxvPBFwvvE/AYw/QfmcrT/hc7b+Pw58gqQk7Xm65gQI41MDAPeMaajVesAbAAAAAElFTkSuQmCC'
  );
  icon.addRepresentation({
    scaleFactor: 2,
    dataURL:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABVUlEQVR42u2WW2oCMRSG3Y876A4sRRQRUUREEVGKdAGlVfGKN9RKt3SgrffbeKndyREHR8KQqGcmeSjMD9/L5M/ke0qOy+XEiRMnhLz8fQIDmrisST84dxhA7jBAIvZFnn8/4AxaRN9v6fDsvg/ZfR8lQZPI7HqQ2fVQMvdJpLddSG+7aOYU3ndi97ZEatOB1KaDBryw68TudYGk1oak1kYWXswdYlcskdBakNBaaMDG7X7QMcL2iF2xQHzdhPi6iSy8n5o7xK5YILZqQGzVQBZezB1iVywQXdYhuqwjj1NEa8SuWCCyqEFkUUPFiAXC8yqE51VUjFggNKtAaFZBxVy/C4LTMgSnZVTE7ZswMClBYFJCRdz3HvjHRfCPiygZ2ovoGxXANyqgJKzNBN5hHrzDPNrE3mT09PMOZ5CIvk/aXPj4/QYMKODSUT4he75egeXfjvpHnqBF6IJZYSAAAAAASUVORK5CYII='
  });
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
    if (!win) return;
    if (win.isVisible()) win.webContents.send('pet-click');
    else showPet();
  });

  app.whenReady().then(() => {
    store = createStore(app);
    // Auth on by default: without a token the open CORS policy would let any
    // web page you have loaded drive the pet. Must run before the server starts.
    ensureToken();
    migrateConfig();
    migrateInlineSprite();
    syncLaunchAtLogin();

    createWindow();
    createTray();
    registerHotkeys();
    watchDisplays();
    scheduleWander();

    // Look for a new release shortly after launch, once the app has settled.
    if (store.get('autoUpdate') !== false) {
      setTimeout(() => checkForUpdates({ interactive: false }), 8000);
    }

    // Keep long-running sessions fresh: when the calendar day rolls over, the
    // renderer's "N today" line and the tray's Today submenu still show
    // yesterday until the next AI event — refresh them, and greet the new
    // morning. Also re-render the tray while a focus session is counting down
    // so its "~Nm — Stop" label stays roughly accurate.
    let lastSeenDate = todayStr();
    let lastQuiet = inQuietHours();
    setInterval(() => {
      if (focusState && tray) buildTrayMenu();
      // Quiet hours start and end on the clock, not on an event — tell the
      // renderer the moment they flip so it stops (or resumes) making noise.
      const quietNow = inQuietHours();
      if (quietNow !== lastQuiet) {
        lastQuiet = quietNow;
        pushSettings();
        if (tray) buildTrayMenu();
      }
      const today = todayStr();
      if (today === lastSeenDate) return;
      lastSeenDate = today;
      pushDailyStats();
      pushWeeklyStats();
      pushActivity();
      if (tray) buildTrayMenu();
      // No greeting here: pollPresence greets on the first activity of the day.
    }, 60000);
    setInterval(pollPresence, 15000);

    // Local control server: any AI / script POSTs a mood here. The auth token is
    // read live from the store so the Settings window can change it on the fly.
    startControlServer(
      PET_PORT,
      (state) => {
        const info = classify(state);
        notifyWhenHidden(state, info);
        recordStat(state, info);
        // The renderer tracks sessions by the same key, so hand it over rather
        // than have two places derive it.
        const forwarded = { ...state, key: info.key };
        // This fires async from an HTTP request, which can land while the app
        // is quitting and the window is being torn down — guard accordingly.
        if (win && !win.isDestroyed()) win.webContents.send('ai-state', forwarded);
      },
      {
        getToken: () => store.get('token') || process.env.PET_TOKEN || '',
        // Persist wherever we actually landed so the hook can find the pet even
        // if 7337 was taken and the server fell back to another port.
        onListen: (boundPort) => {
          serverPort = boundPort;
          if (store.get('port') !== boundPort) {
            store.set('port', boundPort);
            store.flushNow();
          }
          if (tray) buildTrayMenu();
        },
        // No socket at all means the pet will sit there looking healthy while
        // reacting to nothing. Say so, loudly, in the two places the user looks.
        onFatal: (err) => {
          serverError = err.message;
          if (tray) {
            tray.setToolTip(`Desktop Pet — offline (${err.message})`);
            buildTrayMenu();
          }
          notice("can't listen for AI events — see the tray 😞");
        }
      }
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

// None of the app's windows ever navigates or opens new windows; block both, so
// a file dropped on the pet (or a stray link) can't replace its page.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// Keep running with no windows (it's a tray/pet app).
app.on('window-all-closed', () => {});

if (process.platform === 'darwin' && app.dock) {
  app.dock.hide(); // no dock icon; live in the tray
}
