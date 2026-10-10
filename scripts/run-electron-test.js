'use strict';
const { spawn } = require('child_process');
const path = require('path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  require('electron'),
  [path.join(__dirname, 'test-companion-electron.js')],
  { env, stdio: 'inherit' }
);
child.on('error', (e) => {
  console.error(e);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
