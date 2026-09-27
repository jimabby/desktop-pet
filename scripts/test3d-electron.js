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
      win.webContents.send('pet-click');
      await pause(350);
      assert(await read("document.getElementById('pet').classList.contains('act-petting')"));
      assert.equal(await read("getComputedStyle(document.getElementById('pet')).animationName"), 'none');
      assert.equal(await read("getComputedStyle(document.getElementById('pet')).transform"), 'none');
      fs.writeFileSync(path.join(scratch, skin + '-petting.png'), (await win.webContents.capturePage()).toPNG());
      for (const gesture of ['sniff', 'paw', 'groom']) {
        win.webContents.send('pet-trick', gesture);
        await pause(650);
        assert(await read(`document.getElementById('pet').classList.contains('act-${gesture}')`));
        const pose = await win.webContents.capturePage();
        assert(!pose.toPNG().equals(idle.toPNG()), gesture + ' must change the frame');
        fs.writeFileSync(path.join(scratch, skin + '-' + gesture + '.png'), pose.toPNG());
      }
      win.webContents.send('pet-trick', 'wave');
      await pause(600);
      const wave = await win.webContents.capturePage();
      assert(!wave.toPNG().equals(idle.toPNG()), 'wave must visibly change the frame');
      fs.writeFileSync(path.join(scratch, skin + '-wave.png'), wave.toPNG());
      win.webContents.send('ai-state', { mood: 'sleeping', source: 'test', ttl: 0 });
      await pause(450);
      fs.writeFileSync(path.join(scratch, skin + '-sleep.png'), (await win.webContents.capturePage()).toPNG());
      win.webContents.send('ai-state', { mood: 'idle' });
      console.log('PASS 3D load, planted petting, sniff/paw/groom, wave and sleep:', skin);
      // Freeze animations so pixel comparisons isolate appearance changes.
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      });
      await read("say(''); particles.replaceChildren()");
      async function look(color, colorStops, cosmetic) {
        win.webContents.send('settings', { appearance: { skin, color, colorStops, cosmetic, timeOfDay: false } });
        await pause(350);
        return (await win.webContents.capturePage()).toPNG();
      }
      const natural = await look('natural', ['#e9bd86', '#ac754b'], 'none');
      const pink = await look('pink', ['#ffc2d6', '#ff7eb6'], 'none');
      assert(!natural.equals(pink), 'fur color must visibly change');
      fs.writeFileSync(path.join(scratch, skin + '-pink.png'), pink);
      const restored = await look('natural', ['#e9bd86', '#ac754b'], 'none');
      assert(natural.equals(restored), 'Natural must restore the original materials exactly');
      for (const cosmetic of ['glasses', 'scarf', 'headphones', 'crown', 'bowtie', 'flower', 'cap']) {
        const dressed = await look('natural', ['#e9bd86', '#ac754b'], cosmetic);
        assert(!dressed.equals(natural), cosmetic + ' must render on ' + skin);
        const selector = cosmetic === 'flower' ? '.flower-pin' : '.' + cosmetic;
        assert.equal(await read(`getComputedStyle(document.querySelector('#pet > ${selector}')).display`), 'none');
        fs.writeFileSync(path.join(scratch, skin + '-' + cosmetic + '.png'), dressed);
      }
      assert(natural.equals(await look('natural', ['#e9bd86', '#ac754b'], 'none')), 'None removes every accessory');
      win.webContents.debugger.detach();
      console.log('PASS fur recolor/reset and all seven 3D cosmetics:', skin);
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
      palette: { green: ['#7ee8a0', '#45c97a'], pink: ['#ffc2d6', '#ff7eb6'], natural: ['#e9bd86', '#ac754b'] }, skins: ['slime', 'kitten', 'puppy'],
      cosmeticUnlocks: { none: 0, bowtie: 0, flower: 0, crown: 120 }, unlocked: ['none', 'bowtie', 'flower'] }));
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
    await settings.webContents.executeJavaScript("document.querySelector('#swatches [aria-label=pink]').click(); [...document.querySelectorAll('#cosmetics .chip')].find(e => e.textContent === 'Bow tie').click()");
    await pause(250);
    assert(await settings.webContents.executeJavaScript("document.getElementById('model-preview').classList.contains('cosmetic-bowtie') && getComputedStyle(document.getElementById('model-preview')).getPropertyValue('--model-fur').trim() === '#ffc2d6'"));
    assert(await settings.webContents.executeJavaScript("[...document.querySelectorAll('#cosmetics .chip')].find(e => e.textContent.startsWith('Crown')).getAttribute('aria-disabled') === 'true'"));
    fs.writeFileSync(path.join(scratch, 'settings.png'), (await settings.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log('PASS settings selection and live 3D preview');
    settings.destroy(); app.exit(0);
  } catch (error) { console.error(error); console.error(errors); if (!win.isDestroyed()) win.destroy(); app.exit(1); }
});
