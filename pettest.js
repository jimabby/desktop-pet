'use strict';

// Smoke test for the control server + hook script.
//
// NOTE: the server runs in THIS process, so the client calls must be async.
// A blocking call (e.g. execSync of curl) would freeze the event loop and the
// in-process server could never answer the request -> deadlock.

const http = require('http');
const { spawn } = require('child_process');
const { startControlServer } = require('./src/server');

const PORT = 7350;
const received = [];
const srv = startControlServer(PORT, (s) => received.push(s));

function request(path, json) {
  return new Promise((resolve, reject) => {
    const body = json ? JSON.stringify(json) : '';
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method: json ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve(out));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

function notify(args, stdin) {
  return new Promise((resolve) => {
    const child = spawn('node', ['hooks/pet-notify.js', ...args], {
      env: { ...process.env, PET_PORT: String(PORT) }
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    child.on('close', () => resolve());
  });
}

(async () => {
  await request('/state', { mood: 'working', text: 'Refactoring auth', source: 'chatgpt', ttl: 8000 });
  await notify(['done', 'all done!']);
  await notify([], '{"hook_event_name":"PreToolUse"}');
  await notify([], '{"hook_event_name":"Stop"}');
  const health = await request('/health');

  // give the async hook POSTs a beat to land
  await new Promise((r) => setTimeout(r, 300));

  console.log('HEALTH:', health);
  console.log('RECEIVED:\n' + JSON.stringify(received, null, 2));
  srv.close();
  process.exit(0);
})();
