'use strict';

// Do-not-disturb window maths. Pure functions in their own module so they can
// be tested without booting Electron — the wrap-past-midnight case is exactly
// the kind of thing that quietly breaks and nobody notices until 2am.

// 'HH:MM' -> minutes since midnight, or null if unparseable.
function parseClock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Is `now` inside the configured quiet window?
//   quiet = { enabled, from: 'HH:MM', to: 'HH:MM' }
// A window whose end is before its start wraps past midnight (22:00 -> 08:00),
// which is the common case. from === to is treated as "no window" rather than
// "always", so a mis-set pair can't silence the pet forever.
function isQuietNow(quiet, now = new Date()) {
  if (!quiet || !quiet.enabled) return false;
  const from = parseClock(quiet.from);
  const to = parseClock(quiet.to);
  if (from == null || to == null || from === to) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return from < to ? mins >= from && mins < to : mins >= from || mins < to;
}

module.exports = { parseClock, isQuietNow };
