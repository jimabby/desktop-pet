#!/usr/bin/env node
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: pet-wrap <command> [args...]');
  process.exit(2);
}
const env = { ...process.env, PET_SESSION: crypto.randomUUID() };
let notifications = Promise.resolve();
const notify = (mood, text) => {
  notifications = notifications.then(
    () =>
      new Promise((resolve) => {
        const notifier = spawn(
          process.execPath,
          [path.join(__dirname, 'pet-notify.js'), mood, text],
          { env, stdio: 'ignore' }
        );
        notifier.on('error', resolve);
        notifier.on('close', resolve);
      })
  );
  return notifications;
};
(async () => {
  await notify('working', [command, ...args].join(' '));
  const heartbeat = setInterval(
    () => notify('working', 'still working…'),
    30000
  );
  const child = spawn(command, args, { stdio: 'inherit', shell: false });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, () => child.kill(signal));
  let ended = false;
  function finish(code, signal) {
    if (ended) return;
    ended = true;
    clearInterval(heartbeat);
    notify(
      code === 0 ? 'done' : 'error',
      signal
        ? `interrupted (${signal})`
        : code === 0
          ? 'command finished'
          : `command failed (${code})`
    );
    process.exitCode = signal
      ? 128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }[signal] || 1)
      : code;
  }
  child.on('error', (err) => {
    console.error(err.message);
    finish(127);
  });
  child.on('exit', (code, signal) => finish(code ?? 1, signal));
})();
