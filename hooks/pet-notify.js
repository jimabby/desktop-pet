#!/usr/bin/env node
'use strict';

/**
 * Tell the desktop pet what mood to show.
 *
 * Usage:
 *   node pet-notify.js <mood> [text...]
 *   node pet-notify.js working "Editing files..."
 *   node pet-notify.js done
 *
 * Or pipe Claude Code hook JSON on stdin (it reads hook_event_name and maps it).
 *
 * Env:
 *   PET_PORT   (default 7337)
 *   PET_SOURCE (default "claude")
 */

const http = require('http');

const PORT = Number(process.env.PET_PORT) || 7337;
const SOURCE = process.env.PET_SOURCE || 'claude';

// Map Claude Code hook events -> pet moods.
const EVENT_MOOD = {
  UserPromptSubmit: { mood: 'thinking', text: 'on it...', ttl: 0 },
  PreToolUse: { mood: 'working', text: 'working...', ttl: 0 },
  PostToolUse: { mood: 'working', text: '', ttl: 0 },
  Notification: { mood: 'thinking', text: 'needs you 👀', ttl: 0 },
  Stop: { mood: 'happy', text: 'done!', ttl: 4000 },
  SubagentStop: { mood: 'happy', text: 'subtask done!', ttl: 4000 },
  SessionStart: { mood: 'happy', text: 'hello!', ttl: 3000 },
  SessionEnd: { mood: 'idle', text: '', ttl: 0 }
};

function send(state) {
  const body = JSON.stringify({ source: SOURCE, ...state });
  const req = http.request(
    {
      host: '127.0.0.1',
      port: PORT,
      path: '/state',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 1500
    },
    (res) => res.resume()
  );
  // Never block or crash the AI host if the pet isn't running.
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.write(body);
  req.end();
}

const [, , moodArg, ...rest] = process.argv;

if (moodArg) {
  send({ mood: moodArg, text: rest.join(' ') });
  return;
}

// No args: try reading hook JSON from stdin.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let evt = '';
  try {
    evt = (JSON.parse(input || '{}').hook_event_name) || '';
  } catch {
    /* ignore */
  }
  const state = EVENT_MOOD[evt] || { mood: 'idle', text: '' };
  send(state);
});
// If nothing arrives on stdin quickly, just exit.
setTimeout(() => process.exit(0), 1000);
