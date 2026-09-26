'use strict';

// Smoke + regression tests for the control server and the hook script.
//
// NOTE: the servers run in THIS process, so client calls must be async. A
// blocking call (e.g. execSync of curl) would freeze the event loop and the
// in-process server could never answer -> deadlock.

const http = require('http');
const { spawn } = require('child_process');
const { startControlServer } = require('./src/server');

const PORT = 7350;
const TOKEN_PORT = 7360;
const FALLBACK_PORT = 7370;

let failures = 0;
let checks = 0;

function check(name, cond, detail) {
  checks++;
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function request(port, path, json, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = json !== undefined ? JSON.stringify(json) : '';
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: json !== undefined ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers
        }
      },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode, body: out }));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

// Run the hook script and resolve with its exit code + captured output.
function notify(args, stdin, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', ['hooks/pet-notify.js', ...args], {
      env: { ...process.env, PET_PORT: String(PORT), ...env }
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    if (stdin !== undefined) child.stdin.end(stdin);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const received = [];
  const srv = startControlServer(PORT, (s) => received.push(s));
  const last = () => received[received.length - 1];

  console.log('\n— control server —');
  const health = await request(PORT, '/health');
  eq('GET /health is 200', health.status, 200);
  eq('GET /health body', health.body, '{"ok":true}');

  eq('unknown route is 404', (await request(PORT, '/nope')).status, 404);

  for (const invalid of [null, [], 42, 'hello']) {
    eq('reject non-object JSON ' + JSON.stringify(invalid),
      (await request(PORT, '/state', invalid)).status, 400);
  }

  await request(PORT, '/state', {
    mood: 'working', text: 'Refactoring auth', source: 'chatgpt', ttl: 8000
  });
  eq('mood passes through', last().mood, 'working');
  eq('source passes through', last().source, 'chatgpt');
  eq('ttl passes through', last().ttl, 8000);

  await request(PORT, '/state', { mood: 'interpretive-dance' });
  eq('unknown mood falls back to idle', last().mood, 'idle');

  await request(PORT, '/state', { mood: 'working', ttl: 999999 });
  eq('ttl is clamped', last().ttl, 120000);

  await request(PORT, '/state', { mood: 'working', text: 'x'.repeat(500) });
  eq('text is truncated', last().text.length, 280);

  await request(PORT, '/state', { mood: 'thinking', link: 'https://example.com/ok' });
  eq('https link is kept', last().link, 'https://example.com/ok');

  await request(PORT, '/state', { mood: 'thinking', link: 'file:///etc/passwd' });
  eq('file: link is rejected', last().link, '');

  await request(PORT, '/state', { mood: 'thinking', link: 'javascript:alert(1)' });
  eq('javascript: link is rejected', last().link, '');

  const bad = await request(PORT, '/state', undefined, {});
  eq('empty POST body is accepted as idle', bad.status, 404); // GET /state -> 404

  const malformed = await new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: '/state', method: 'POST',
        headers: { 'Content-Type': 'application/json' } },
      (res) => { let o = ''; res.on('data', (c) => (o += c)); res.on('end', () => resolve({ status: res.statusCode, body: o })); }
    );
    req.end('{not json');
  });
  eq('malformed JSON is 400', malformed.status, 400);

  const huge = await request(PORT, '/state', { mood: 'working', text: 'x'.repeat(200000) });
  eq('oversize payload is 413, not a hung socket', huge.status, 413);

  console.log('\n— auth —');
  const tokenSrv = startControlServer(TOKEN_PORT, () => {}, { getToken: () => 's3cret' });
  await wait(60);
  eq('no token is 401', (await request(TOKEN_PORT, '/state', { mood: 'happy' })).status, 401);
  eq('wrong token is 401',
    (await request(TOKEN_PORT, '/state', { mood: 'happy' }, { 'X-Pet-Token': 'nope' })).status, 401);
  eq('right token is 200',
    (await request(TOKEN_PORT, '/state', { mood: 'happy' }, { 'X-Pet-Token': 's3cret' })).status, 200);
  eq('/health needs no token', (await request(TOKEN_PORT, '/health')).status, 200);
  tokenSrv.close();

  console.log('\n— port fallback —');
  const first = startControlServer(FALLBACK_PORT, () => {});
  await wait(80);
  const second = startControlServer(FALLBACK_PORT, () => {});
  await wait(200);
  eq('first server takes the requested port', first.getPort(), FALLBACK_PORT);
  eq('second server falls back to the next one', second.getPort(), FALLBACK_PORT + 1);
  first.close();
  second.close();

  console.log('\n— hook: CLI —');
  const help = await notify(['--help']);
  eq('--help exits 0', help.code, 0);
  check('--help lists the moods', help.out.includes('working'), help.out.trim());

  const badMood = await notify(['interpretive-dance']);
  eq('unknown mood exits non-zero', badMood.code, 2);
  check('unknown mood explains itself', badMood.err.includes('unknown mood'), badMood.err.trim());

  received.length = 0;
  await notify(['working', 'building...']);
  await wait(200);
  check('CLI working state arrives', !!last(), 'nothing received');
  eq('CLI working mood', last().mood, 'working');
  check('CLI busy state carries a TTL so it self-heals', last().ttl > 0, `ttl=${last().ttl}`);

  received.length = 0;
  await notify(['done', 'all done!']);
  await wait(200);
  eq('"done" aliases to happy', last().mood, 'happy');
  eq('CLI text passes through', last().text, 'all done!');

  console.log('\n— hook: Claude Code events —');
  received.length = 0;
  await notify([], '{"hook_event_name":"PreToolUse"}');
  await wait(200);
  eq('PreToolUse -> working', last().mood, 'working');
  check('PreToolUse has a safety-net TTL', last().ttl > 0, `ttl=${last().ttl}`);

  received.length = 0;
  await notify([], '{"hook_event_name":"Stop"}');
  await wait(200);
  eq('Stop -> happy', last().mood, 'happy');

  received.length = 0;
  await notify([], '{"hook_event_name":"PermissionRequest","tool_name":"Bash"}');
  await wait(200);
  eq('PermissionRequest asks for attention', last().attention, true);
  check('PermissionRequest names the tool', last().text.includes('Bash'), last().text);

  received.length = 0;
  await notify([], '{"hook_event_name":"NotAThing"}');
  await wait(200);
  eq('unknown hook event sends nothing', received.length, 0);

  received.length = 0;
  await notify([], 'not json at all');
  await wait(200);
  eq('malformed hook payload sends nothing', received.length, 0);

  srv.close();

  console.log('\n— quiet hours —');
  const { parseClock, isQuietNow } = require('./src/quiet');
  const at = (h, m = 0) => new Date(2026, 0, 15, h, m);

  eq('parses HH:MM', parseClock('22:30'), 22 * 60 + 30);
  eq('parses a single-digit hour', parseClock('7:05'), 7 * 60 + 5);
  eq('rejects a bad hour', parseClock('25:00'), null);
  eq('rejects a bad minute', parseClock('10:75'), null);
  eq('rejects junk', parseClock('later'), null);
  eq('rejects empty', parseClock(''), null);

  const night = { enabled: true, from: '22:00', to: '08:00' };
  check('wrapping window: 23:00 is quiet', isQuietNow(night, at(23)));
  check('wrapping window: 02:00 is quiet', isQuietNow(night, at(2)));
  check('wrapping window: 07:59 is quiet', isQuietNow(night, at(7, 59)));
  check('wrapping window: 08:00 is not', !isQuietNow(night, at(8)));
  check('wrapping window: midday is not', !isQuietNow(night, at(12)));
  check('wrapping window: 21:59 is not', !isQuietNow(night, at(21, 59)));

  const lunch = { enabled: true, from: '12:00', to: '13:00' };
  check('same-day window: 12:30 is quiet', isQuietNow(lunch, at(12, 30)));
  check('same-day window: 13:00 is not', !isQuietNow(lunch, at(13)));
  check('same-day window: 11:59 is not', !isQuietNow(lunch, at(11, 59)));

  check('disabled window is never quiet', !isQuietNow({ ...night, enabled: false }, at(23)));
  check('from === to is treated as no window',
    !isQuietNow({ enabled: true, from: '09:00', to: '09:00' }, at(9)));
  check('unparseable bounds are ignored',
    !isQuietNow({ enabled: true, from: 'soon', to: '08:00' }, at(23)));
  check('missing config is not quiet', !isQuietNow(undefined, at(23)));

  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('test harness crashed:', err);
  process.exit(1);
});
