'use strict';
const { app, BrowserWindow, dialog, nativeImage } = require('electron');
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  http = require('http'),
  assert = require('assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-companion-ui-'));
app.setPath('userData', scratch);
process.env.PET_PORT = '17439';
process.env.PET_TOKEN = 'isolated-ui-test';
fs.writeFileSync(
  path.join(scratch, 'pet-config.json'),
  JSON.stringify({
    hidden: true,
    hotkey: '',
    confirmHotkey: '',
    muted: true,
    wander: false,
    autoUpdate: false,
    token: 'saved-token'
  })
);
require('../src/main');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => {
  console.error('Companion UI test timed out');
  app.exit(1);
}, 45000).unref();
app.whenReady().then(async () => {
  await pause(500);
  const errors = [];
  const win = new BrowserWindow({
    show: false,
    width: 650,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../src/stats-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push(message);
  });
  const run = (code) => win.webContents.executeJavaScript(code);
  try {
    const { decodeSprite } = require('../src/sprite-image');
    assert(
      await decodeSprite(
        Buffer.from(
          'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          'base64'
        ),
        'image/gif',
        { nativeImage, BrowserWindow }
      )
    );
    assert.equal(
      await decodeSprite(Buffer.from('invalid'), 'image/gif', {
        nativeImage,
        BrowserWindow
      }),
      false
    );
    await win.loadFile(path.join(__dirname, '../src/renderer/stats.html'));
    await pause(500);
    assert(
      await run(
        "document.getElementById('companion').textContent.includes('Sessions & prompts')"
      )
    );
    const post = (body) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: 17439,
            path: '/state',
            method: 'POST',
            headers: {
              'X-Pet-Token': process.env.PET_TOKEN,
              'Content-Type': 'application/json'
            }
          },
          (res) => {
            res.resume();
            res.on('end', () =>
              res.statusCode === 200
                ? resolve()
                : reject(new Error('HTTP ' + res.statusCode))
            );
          }
        );
        req.on('error', reject);
        req.end(JSON.stringify(body));
      });
    await post({
      source: 'test',
      session: 'one',
      event: 'start',
      mood: 'working',
      project: 'Example project'
    });
    await pause(1200);
    await post({
      source: 'test',
      session: 'one',
      event: 'confirm',
      mood: 'thinking',
      text: 'Allow test?',
      link: 'https://example.com'
    });
    await pause(3200);
    assert(
      await run(
        "document.getElementById('companion').textContent.includes('Example project')"
      )
    );
    assert(
      await run(
        "document.getElementById('companion').textContent.includes('Allow test?')"
      )
    );
    await run(
      "[...document.querySelectorAll('button')].find(b=>b.textContent==='Acknowledge').click()"
    );
    await pause(300);
    assert((await run('window.statsAPI.companion()')).prompts[0].acked);
    await run(
      "[...document.querySelectorAll('button')].find(b=>b.textContent==='Test connection').click()"
    );
    await pause(400);
    assert(
      await run(
        "document.getElementById('companion-status').textContent.includes('passed')"
      )
    );
    await run(
      "[...document.querySelectorAll('button')].find(b=>b.textContent==='15m quiet').click()"
    );
    await pause(200);
    assert((await run('window.statsAPI.companion()')).diagnostics.quiet);
    await post({
      source: 'test',
      session: 'one',
      event: 'done',
      mood: 'happy',
      text: 'Done'
    });
    await pause(3200);
    assert.equal(
      await run("document.getElementById('week-tasks').textContent"),
      '1'
    );
    const report = await run('window.statsAPI.get()');
    assert(report.perAi[0].activeMs >= 1000);
    assert.equal(report.events[0].kind, 'done');
    const backup = path.join(scratch, 'backup.json');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
    assert((await run("window.statsAPI.action({type:'backup'})")).ok);
    assert(!fs.readFileSync(backup, 'utf8').includes(process.env.PET_TOKEN));
    assert(
      (await run("window.statsAPI.action({type:'loadProfile',name:'Minimal'})"))
        .ok
    );
    assert.equal((await run('window.statsAPI.companion()')).perch, true);
    await pause(200);

    // Refreshes must preserve position drafts and keep diagnostics updating.
    await run(`const controls=document.querySelectorAll('#companion select'); controls[1].value='top-left'; controls[1].dispatchEvent(new Event('change')); document.querySelector('#companion button').focus();`);
    await pause(3400);
    assert.equal(await run("document.querySelectorAll('#companion select')[1].value"), 'top-left');
    assert((await run("window.statsAPI.action({type:'sampleEvent'})")).message.includes('received'));
    assert((await run("window.statsAPI.action({type:'setupCommand'})")).command.includes(process.env.PET_TOKEN));
    await post({source:'test',session:'stale',event:'confirm',mood:'thinking',text:'Stale prompt'});
    assert((await run("window.statsAPI.action({type:'dismiss',key:'test|stale'})")).ok);
    assert(!(await run('window.statsAPI.companion()')).prompts.some(p=>p.key==='test|stale'));
    const settings = new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../src/settings-preload.js'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    settings.webContents.on('console-message', (_e,level,message)=>{if(level>=3) errors.push(message);});
    await settings.loadFile(path.join(__dirname,'../src/renderer/settings.html'));
    const edit = code => settings.webContents.executeJavaScript(code);
    const png = await edit(`(() => {const c=document.createElement('canvas');c.width=4;c.height=4;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,4,4);return c.toDataURL().split(',')[1];})()`);
    const spritePath=path.join(scratch,'test-sheet.png');fs.writeFileSync(spritePath,Buffer.from(png,'base64'));
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[spritePath]});
    assert((await edit('window.settingsAPI.pickSprite()')).ok);
    await edit("document.getElementById('spriteReset').click()"); await pause(250);
    assert.equal(await edit("document.getElementById('spriteEditor').hidden"),false);
    await edit(`document.getElementById('spriteCols').value='2';document.getElementById('spriteRows').value='2';var f=document.querySelector('[aria-label="idle Row (1-based)"]');f.value='3';f.dispatchEvent(new Event('input'));`);
    assert(await edit("document.getElementById('spriteApply').disabled"));
    await edit(`var f=document.querySelector('[aria-label="idle Row (1-based)"]');f.value='2';f.dispatchEvent(new Event('input'));document.getElementById('spriteApply').click();`);
    await pause(250);
    assert.equal((await edit('window.settingsAPI.get()')).sprite.moods.idle.row,1);
    await edit("document.getElementById('lowPower').click()");await pause(100);
    assert((await edit('window.settingsAPI.get()')).lowPower);
    // Restore creates a distinct managed filename; clearing must delete it.
    dialog.showSaveDialog=async()=>({canceled:false,filePath:backup});
    assert((await run("window.statsAPI.action({type:'backup'})")).ok);
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});
    dialog.showMessageBox=async()=>({response:0});
    assert((await run("window.statsAPI.action({type:'restore'})")).ok);
    const restored=fs.readdirSync(scratch).find(f=>/^sprite-restored-/.test(f));assert(restored);
    await edit('window.settingsAPI.clearSprite()');await pause(100);
    assert(!fs.existsSync(path.join(scratch,restored)));
    settings.destroy();
    console.log('PASS retained position drafts, setup event, local dismissal, sprite preview/mapping/cleanup and low power settings');
    fs.writeFileSync(
      path.join(scratch, 'companion.png'),
      (await win.webContents.capturePage()).toPNG()
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS real Electron companion UI: sessions, prompt acknowledgement, auth override, diagnostics, quiet, profile, backup and live activity.'
    );
    console.log('Screenshot:', path.join(scratch, 'companion.png'));
    app.exit(0);
  } catch (e) {
    console.error(e);
    console.error(errors);
    app.exit(1);
  }
});
