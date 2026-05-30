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
    muted: false,
    launchAtLogin: false,
    hidden: false
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
