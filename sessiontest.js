'use strict';
const assert = require('assert/strict');
const { createSessions, eventOf } = require('./src/sessions');
const { safeSettings, csvCell } = require('./src/companion');
const { createStore } = require('./src/store');
const fs = require('fs'),
  os = require('os'),
  path = require('path');
let now = 1000;
const durations = [];
const tracker = createSessions(
  (source, start, end) => durations.push({ source, start, end }),
  () => now
);
tracker.accept({ source: 'claude', session: 'A', event: 'start', ttl: 120000 });
now += 1000;
tracker.accept({ source: 'claude', session: 'B', event: 'start', ttl: 120000 });
now += 1000;
tracker.accept({ source: 'claude', session: 'A', event: 'confirm' });
now += 5000;
tracker.accept({ source: 'claude', session: 'A', event: 'busy', ttl: 120000 });
now += 2000;
tracker.accept({
  source: 'claude',
  session: 'A',
  event: 'done',
  eventId: 'turn-1'
});
assert.equal(
  durations
    .filter((d) => d.source === 'claude')
    .reduce((n, d) => n + d.end - d.start, 0),
  12000,
  'each busy session accrues time, waiting does not'
);
assert.equal(tracker.list().find((s) => s.session === 'A').activeMs, 4000);
assert.equal(tracker.list().find((s) => s.session === 'A').waitingMs, 5000);
assert.equal(
  tracker.accept({
    source: 'claude',
    session: 'A',
    event: 'done',
    eventId: 'turn-1'
  }).duplicate,
  true
);
assert.equal(
  tracker.accept({
    source: 'claude',
    session: 'B',
    event: 'done',
    eventId: 'turn-1'
  }).duplicate,
  false,
  'same event id in a different session is independent'
);
assert.equal(
  tracker.accept({
    source: 'claude',
    session: 'A',
    event: 'done',
    eventId: 'turn-2'
  }).duplicate,
  false
);
assert.equal(
  eventOf({ event: 'session-start', mood: 'happy' }),
  'session-start'
);
assert.equal(eventOf({ event: 'done', mood: 'stressed' }), 'done');
tracker.accept({ source: 'claude', mood: 'idle' });
assert.equal(tracker.list().length, 0);
tracker.accept({ source: 'slow', event: 'busy', ttl: 45000, leaseMs: 1800000 });
now += 120000;
tracker.tick();
assert.equal(tracker.list()[0].status, 'busy');
tracker.suspend();
now += 3600000;
tracker.tick();
assert.equal(tracker.list().length, 0);
assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
assert.deepEqual(
  safeSettings({
    token: 'never-export',
    name: 'Mochi',
    scale: 99,
    profiles: { __proto__: { token: 'oops' } }
  }),
  { name: 'Mochi', scale: 2.5, profiles: {} }
);
assert.throws(() => safeSettings(null));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-config-test-'));
try {
  fs.writeFileSync(
    path.join(dir, 'pet-config.json'),
    JSON.stringify({
      x: 'bad',
      y: 5,
      events: 'wrong',
      weekHistory: {},
      stats: { date: 'today', perAi: null },
      profiles: [],
      focus: null
    })
  );
  const store = createStore({ getPath: () => dir });
  assert.equal(store.get('x'), null);
  assert.equal(store.get('y'), null);
  assert.deepEqual(store.get('events'), []);
  assert.deepEqual(store.get('weekHistory'), []);
  assert.equal(store.get('stats'), null);
  assert.deepEqual(store.get('focus'), { work: 25, break: 5 });
  assert(fs.readdirSync(dir).some((f) => f.includes('.recovery-')));
  store.set('affection', 30);
  store.flushNow();
  assert.equal(createStore({ getPath: () => dir }).get('affection'), 30);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(
  'Session clocks, lifecycle, leases, export safety and config recovery passed.'
);
