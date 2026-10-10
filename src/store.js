'use strict';

// Tiny JSON config store in the app's userData dir. No external deps.
// Holds window position + user settings (mute, launch-at-login, hidden).

const fs = require('fs');
const path = require('path');

function createStore(app) {
  const file = path.join(app.getPath('userData'), 'pet-config.json');

  const defaults = {
    affection: 0,
    snoozeUntil: 0,
    quietFocus: false,
    presentation: false,
    presentationWasHidden: false,
    perch: false,
    profiles: {},
    preferredDisplay: '',
    preferredCorner: 'bottom-right',
    x: null,
    y: null,
    scale: 1,
    muted: false,
    launchAtLogin: false,
    hidden: false,
    name: '',
    color: 'green',
    skin: 'slime', // character: slime | kitten | puppy
    cosmetic: 'none', // equipped headwear: none | bowtie | flower | glasses | cap | scarf | headphones | crown
    timeOfDay: true, // tint the pet warmer at night / brighter by day
    wander: true, // let the pet stroll a few px on its own when idle
    physics: true, // fling/throw the pet so it slides + bounces off edges
    // Global shortcuts ('' to disable). Deliberately three-modifier: these are
    // registered system-wide and would otherwise steal app shortcuts such as
    // VS Code's Cmd/Ctrl+Shift+P command palette.
    hotkey: 'CommandOrControl+Alt+Shift+P', // show/hide the pet
    confirmHotkey: 'CommandOrControl+Alt+Shift+J', // jump to the latest waiting confirm
    configVersion: 0, // bumped by migrateConfig() in main.js
    // Shared secret the control server requires. Generated on first run (see
    // ensureToken in main.js) so the pet is never open to any web page you
    // happen to have loaded; the hook reads it back out of this same file.
    token: '',
    // Port the control server actually bound to. Written back after startup so
    // the hook can find the pet even when 7337 was taken and we fell back.
    port: 0,
    stressTokens: 120000, // context size that flips the pet into the strained look
    ctxMax: 200000, // context size treated as "full" by the pet's usage ring
    // Native OS notification when a confirm arrives while the pet is hidden —
    // otherwise the one moment that matters is invisible.
    notifyWhenHidden: true,
    autoUpdate: true, // check for new releases on launch (needs a publish target)
    sprite: null, // optional sprite-sheet art: { file, name, cols, rows, fps, moods } (image in userData)
    // Do-not-disturb window. While active the pet stays silent and still: no
    // chimes, no notifications, no escalating nudges.
    quiet: { enabled: false, from: '22:00', to: '08:00' },
    focus: { work: 25, break: 5 }, // pomodoro durations, in minutes
    stats: null, // { date: 'YYYY-MM-DD', perAi: { claude: {...}, ... } }
    lifetimeTasks: 0, // total completed tasks ever (drives cosmetic unlocks)
    weekHistory: [], // rolling 7 days: [{ date, tasks, activeMs }]
    events: [] // missed-event log: [{ at, source, kind, text }], newest last
  };

  // Nested-object keys need a per-key merge: a config written by an older
  // build may hold e.g. { quiet: { enabled: true } } with no 'from'/'to', and a
  // plain spread would drop those defaults on the floor.
  const NESTED_KEYS = ['focus', 'quiet'];

  let data = { ...defaults };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid configuration');
    data = { ...defaults, ...saved };
    for (const key of NESTED_KEYS) {
      if (saved[key] && typeof saved[key] === 'object' && !Array.isArray(saved[key])) {
        data[key] = { ...defaults[key], ...saved[key] };
      } else {
        data[key] = { ...defaults[key] };
      }
    }
  } catch {
    try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.recovery-' + Date.now()); } catch {}
  }

  const beforeValidation = JSON.stringify(data);
  data = validateConfig(data, defaults);
  if (JSON.stringify(data) !== beforeValidation && fs.existsSync(file)) {
    try { fs.copyFileSync(file, file + '.recovery-' + Date.now()); } catch {}
  }

  // Retired characters fall back to the default on existing installations.
  if (!['slime', 'kitten', 'puppy'].includes(data.skin)) data.skin = 'slime';

  let writeTimer = null;
  function flush() {
    // Write to a sibling temp file and rename over the real one, so a crash or
    // power loss mid-write can never leave a half-written (unparseable) config
    // — the rename is atomic, and the reader above falls back to defaults only
    // if the *complete* previous file is somehow unreadable.
    clearTimeout(writeTimer);
    const tmp = file + '.tmp';
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[pet] could not save config:', err.message);
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* nothing to clean up */
      }
    }
  }

  return {
    get: (key) => data[key],
    set(key, value) {
      data[key] = value;
      // debounce writes (drag fires often)
      clearTimeout(writeTimer);
      writeTimer = setTimeout(flush, 300);
    },
    flushNow: flush,
    path: file
  };
}

function validateConfig(saved, defaults) {
  const data = { ...defaults, ...saved };
  for (const [key, value] of Object.entries(defaults)) {
    if (typeof value === 'boolean' && typeof data[key] !== 'boolean') data[key] = value;
    if (typeof value === 'string' && typeof data[key] !== 'string') data[key] = value;
    if (typeof value === 'number' && (!Number.isFinite(data[key]) || data[key] < 0)) data[key] = value;
  }
  for (const key of ['x', 'y']) if (!Number.isFinite(data[key])) data[key] = null;
  if (data.x === null || data.y === null) data.x = data.y = null;
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const num = v => Number.isFinite(v) && v >= 0 ? v : 0;
  if (!obj(data.stats) || typeof data.stats.date !== 'string' || !obj(data.stats.perAi)) data.stats = null;
  else data.stats = { date: data.stats.date, perAi: Object.fromEntries(Object.entries(data.stats.perAi).filter(([,v]) => obj(v)).map(([k,v]) => [k, { tasks: num(v.tasks), confirms: num(v.confirms), errors: num(v.errors), activeMs: num(v.activeMs) }])) };
  data.events = Array.isArray(data.events) ? data.events.filter(e => obj(e) && Number.isFinite(e.at) && typeof e.source === 'string' && typeof e.text === 'string' && ['done','error','confirm'].includes(e.kind)).slice(-50) : [];
  data.weekHistory = Array.isArray(data.weekHistory) ? data.weekHistory.filter(d => obj(d) && /^\d{4}-\d{2}-\d{2}$/.test(d.date)).map(d => ({date:d.date,tasks:num(d.tasks),activeMs:num(d.activeMs)})).slice(-7) : [];
  if (!obj(data.profiles)) data.profiles = {};
  for (const key of ['focus','quiet']) if (!obj(data[key])) data[key] = {...defaults[key]};
  data.focus = {work: Math.max(1, Math.min(180, Number(data.focus.work) || 25)), break: Math.max(1, Math.min(60, Number(data.focus.break) || 5))};
  const {parseClock} = require('./quiet');
  data.quiet = {enabled: data.quiet.enabled === true, from: parseClock(data.quiet.from) !== null ? String(data.quiet.from) : defaults.quiet.from, to: parseClock(data.quiet.to) !== null ? String(data.quiet.to) : defaults.quiet.to};
  if (!obj(data.sprite)) data.sprite = null;
  if (typeof data.lastGreetDate !== 'string') delete data.lastGreetDate;
  return data;
}
module.exports = { createStore, validateConfig };
