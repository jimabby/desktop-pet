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
    skin: 'slime', // body shape: slime | cat | ghost
    cosmetic: 'none', // equipped headwear: none | glasses | scarf | crown
    timeOfDay: true, // tint the pet warmer at night / brighter by day
    wander: true, // let the pet stroll a few px on its own when idle
    physics: true, // fling/throw the pet so it slides + bounces off edges
    hotkey: 'CommandOrControl+Shift+P', // global show/hide toggle ('' to disable)
    token: '', // shared secret the control server requires (also read by the hook)
    stressTokens: 120000, // context size that flips the pet into the strained look
    focus: { work: 25, break: 5 }, // pomodoro durations, in minutes
    stats: null, // { date: 'YYYY-MM-DD', perAi: { claude: {...}, ... } }
    lifetimeTasks: 0, // total completed tasks ever (drives cosmetic unlocks)
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
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[pet] could not save config:', err.message);
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
