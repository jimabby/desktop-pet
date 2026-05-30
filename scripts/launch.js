'use strict';

// Launch Electron with a clean environment.
//
// Some hosts (notably the VSCode integrated terminal) set ELECTRON_RUN_AS_NODE=1,
// which makes the Electron binary boot as plain Node. That makes `require('electron')`
// return a path string instead of the API object, so `ipcMain`/`app`/etc. are
// undefined and the app crashes on startup. The variable has to be absent *before*
// Electron launches, so we strip it here and spawn the real binary.
//
// Run under Node, `require('electron')` resolves to the path of the binary — exactly
// what we want to spawn.

const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env
});

child.on('close', (code) => process.exit(code ?? 0));
