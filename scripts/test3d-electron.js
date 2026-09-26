'use strict';
// Actual Electron/WebGL smoke test, isolated from the user's pet and config.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-3d-check-'));
app.setPath('userData', path.join(scratch, 'profile'));
// Keep the harness alive while replacing its pet window with Settings.
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('3D smoke test timed out'); app.exit(1); }, 45000).unref();
const pause = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 640, show: false,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  try {
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'));
    win.webContents.setZoomFactor(2);
    const read = code => win.webContents.executeJavaScript(code);
    for (const skin of ['kitten', 'puppy']) {
      win.webContents.send('settings', { muted: true, appearance: { skin, timeOfDay: false, sprite: null } });
      for (let i = 0; i < 150; i++) {
        if (await read("document.getElementById('pet').dataset.modelStatus === 'ready'")) break;
        await pause(100);
      }
      assert.equal(await read("document.getElementById('pet').dataset.modelStatus"), 'ready', errors.join('\n'));
      assert.equal(await read("getComputedStyle(document.querySelector('.body')).display"), 'none');
      await pause(400);
      const idle = await win.webContents.capturePage();
      assert(!idle.isEmpty());
      fs.writeFileSync(path.join(scratch, skin + '.png'), idle.toPNG());
      win.webContents.send('pet-trick', 'wave');
      await pause(600);
      const wave = await win.webContents.capturePage();
      assert(!wave.toPNG().equals(idle.toPNG()), 'wave must visibly change the frame');
      fs.writeFileSync(path.join(scratch, skin + '-wave.png'), wave.toPNG());
      win.webContents.send('ai-state', { mood: 'sleeping', source: 'test', ttl: 0 });
      await pause(450);
      fs.writeFileSync(path.join(scratch, skin + '-sleep.png'), (await win.webContents.capturePage()).toPNG());
      win.webContents.send('ai-state', { mood: 'idle' });
      console.log('PASS 3D load, visibility, wave and sleep:', skin);
    }
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    win.webContents.send('ai-state', { mood: 'sleeping', source: 'test', ttl: 0 });
    await pause(500);
    assert(await read("matchMedia('(prefers-reduced-motion: reduce)').matches"));
    await read("say(''); particles.replaceChildren()");
    await pause(100);
    const calm = await win.webContents.capturePage();
    await pause(400);
    assert(calm.toPNG().equals((await win.webContents.capturePage()).toPNG()), 'reduced motion sleeping pose stays still');
    win.webContents.debugger.detach();
    console.log('PASS reduced-motion static pose');
    // Out-of-order model loads must not overwrite the last chosen skin.
    for (const skin of ['kitten', 'slime', 'puppy']) {
      win.webContents.send('settings', { appearance: { skin } });
      await pause(20);
    }
    await pause(1000);
    assert(await read("document.getElementById('pet').classList.contains('skin-puppy') && document.getElementById('pet').dataset.modelStatus === 'ready'"));
    win.webContents.send('settings', { appearance: { skin: 'slime' } });
    await pause(100);
    assert.equal(await read("getComputedStyle(document.querySelector('.model-view')).display"), 'none');
    assert.notEqual(await read("getComputedStyle(document.querySelector('.body')).display"), 'none');
    assert.deepEqual(errors, []);
    console.log('PASS rapid switching and original character fallback');
    console.log('Screenshots:', scratch);
    win.destroy();
    let chosen = '';
    ipcMain.handle('settings:get', () => ({ name: 'Mochi', skin: 'kitten', color: 'green',
      palette: { green: ['#7ee8a0', '#45c97a'] }, skins: ['slime', 'cat', 'kitten', 'puppy'],
      cosmeticUnlocks: { none: 0 }, unlocked: ['none'] }));
    ipcMain.on('settings:set', (_e, cfg) => { chosen = cfg.skin; });
    const settings = new BrowserWindow({ width: 440, height: 850, show: false,
      webPreferences: { preload: path.resolve(__dirname, '../src/settings-preload.js'),
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    settings.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    await settings.loadFile(path.resolve(__dirname, '../src/renderer/settings.html'));
    for (let i = 0; i < 100; i++) {
      if (await settings.webContents.executeJavaScript("document.getElementById('model-preview').dataset.modelStatus === 'ready'")) break;
      await pause(100);
    }
    await settings.webContents.executeJavaScript("[...document.querySelectorAll('#skins .chip')].find(e => e.textContent.includes('Puppy')).click()");
    await pause(1000);
    assert.equal(chosen, 'puppy');
    assert(await settings.webContents.executeJavaScript("document.getElementById('model-preview').classList.contains('skin-puppy') && document.getElementById('model-preview').dataset.modelStatus === 'ready'"));
    fs.writeFileSync(path.join(scratch, 'settings.png'), (await settings.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log('PASS settings selection and live 3D preview');
    settings.destroy(); app.exit(0);
  } catch (error) { console.error(error); console.error(errors); if (!win.isDestroyed()) win.destroy(); app.exit(1); }
});
