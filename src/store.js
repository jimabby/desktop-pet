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
    token: '', // shared secret the control server requires (also read by the hook)
    stressTokens: 120000, // context size that flips the pet into the strained look
    focus: { work: 25, break: 5 }, // pomodoro durations, in minutes
    stats: null, // { date: 'YYYY-MM-DD', perAi: { claude: {...}, ... } }
    lifetimeTasks: 0, // total completed tasks ever (drives cosmetic unlocks)
    weekHistory: [], // rolling 7 days: [{ date, tasks, activeMs }]
    events: [] // missed-event log: [{ at, source, kind, text }], newest last
  };

  let data = { ...defaults };
  try {
    data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
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
