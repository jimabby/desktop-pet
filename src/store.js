'use strict';

// Tiny JSON config store in the app's userData dir. No external deps.
// Holds window position + user settings (mute, launch-at-login, hidden).

const fs = require('fs');
const path = require('path');

function createStore(app) {
  const file = path.join(app.getPath('userData'), 'pet-config.json');

  const defaults = {
    x: null,
    y: null,
    scale: 1,
    muted: false,
    launchAtLogin: false,
    hidden: false,
    name: '',
    color: 'green',
    skin: 'slime', // body shape: slime | cat | ghost | bunny
    cosmetic: 'none', // equipped headwear: none | glasses | scarf | headphones | crown
    timeOfDay: true, // tint the pet warmer at night / brighter by day
    wander: true, // let the pet stroll a few px on its own when idle
    physics: true, // fling/throw the pet so it slides + bounces off edges
    hotkey: 'CommandOrControl+Shift+P', // global show/hide toggle ('' to disable)
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
    sprite: null, // optional sprite-sheet art: { url, cols, rows, fps?, moods }
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
    data = { ...defaults, ...saved };
    for (const key of NESTED_KEYS) {
      if (saved[key] && typeof saved[key] === 'object' && !Array.isArray(saved[key])) {
        data[key] = { ...defaults[key], ...saved[key] };
      } else {
        data[key] = { ...defaults[key] };
      }
    }
  } catch {
    /* first run or unreadable — use defaults */
  }

  let writeTimer = null;
  function flush() {
    // Write to a sibling temp file and rename over the real one, so a crash or
    // power loss mid-write can never leave a half-written (unparseable) config
    // — the rename is atomic, and the reader above falls back to defaults only
    // if the *complete* previous file is somehow unreadable.
    const tmp = file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
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

module.exports = { createStore };
