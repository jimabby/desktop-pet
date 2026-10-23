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

// Custom identifiers must remain independent, including retry-cache tuple boundaries.
{
  const {keyOf, leaseOf} = require('./src/sessions');
  const s = createSessions(() => {}, () => now);
  for (const entry of [{source:'a|b',session:'c'}, {source:'a',session:'b|c'}, {source:'a%7Cb',session:'c'}])
    s.accept({...entry,event:'busy'});
  assert.equal(s.list().length, 3);
  assert.notEqual(keyOf({source:'a|b',session:'c'}), keyOf({source:'a',session:'b|c'}));
  assert.equal(s.accept({source:'a',session:'x|y',event:'done',eventId:'z'}).duplicate, false);
  assert.equal(s.accept({source:'a',session:'x',event:'done',eventId:'y|z'}).duplicate, false);
  now += leaseOf({}) + 1; s.tick();
  assert(s.list().filter(x => x.status === 'expired').every(x => x.expiryReason.includes('heartbeat')));
  s.accept({source:'p',event:'confirm'}); s.dismiss(keyOf({source:'p'}));
  assert.equal(s.list().find(x => x.source === 'p').status, 'dismissed');
}
{
  const {geometry,removeManagedSprite} = require('./src/sprite-config');
  assert.throws(() => geometry({cols:2,rows:1,fps:8,moods:{idle:{row:1,frames:2}}}));
  const mapped = geometry({cols:2,rows:2,fps:8,moods:{idle:{row:1,frames:1,fps:4}}});
  assert.deepEqual(mapped.moods.idle, {row:1,frames:1,fps:4});
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'pet-cleanup-'));
  try {
    for (const f of ['sprite-restored-123.png','sprite.png','other.png']) fs.writeFileSync(path.join(tmp,f),'x');
    removeManagedSprite(tmp,'sprite-restored-123.png');
    removeManagedSprite(tmp,'sprite.png','sprite.png');
    removeManagedSprite(tmp,'other.png');
    removeManagedSprite(tmp,'../other.png');
    assert(!fs.existsSync(path.join(tmp,'sprite-restored-123.png')));
    assert(fs.existsSync(path.join(tmp,'sprite.png')) && fs.existsSync(path.join(tmp,'other.png')));
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
}
console.log('Collision-safe identities, expiry reasons, local dismissal and sprite validation/cleanup passed.');
