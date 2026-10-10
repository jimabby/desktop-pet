'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { decodeSprite } = require('./sprite-image');

const PROFILE_KEYS = [
  'scale',
  'muted',
  'wander',
  'physics',
  'timeOfDay',
  'skin',
  'color',
  'cosmetic',
  'perch',
  'preferredDisplay',
  'preferredCorner'
];
const BACKUP_KEYS = [
  ...PROFILE_KEYS,
  'name',
  'focus',
  'quiet',
  'notifyWhenHidden',
  'stressTokens',
  'ctxMax',
  'hotkey',
  'confirmHotkey',
  'affection',
  'profiles'
];
const PRESETS = {
  Work: { muted: true, wander: false, physics: false, perch: true, scale: 1 },
  Play: { muted: false, wander: true, physics: true, perch: false, scale: 1.2 },
  Minimal: {
    muted: true,
    wander: false,
    physics: false,
    perch: true,
    scale: 0.7
  }
};
function safeSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid settings');
  const out = {};
  const enums = {
    skin: ['slime', 'kitten', 'puppy'],
    color: [
      'natural',
      'peach',
      'cream',
      'cocoa',
      'green',
      'blue',
      'pink',
      'purple',
      'yellow',
      'gray'
    ],
    cosmetic: [
      'none',
      'bowtie',
      'flower',
      'glasses',
      'cap',
      'headphones',
      'scarf',
      'crown'
    ],
    preferredCorner: ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  };
  for (const key of BACKUP_KEYS) {
    const v = input[key];
    if (v === undefined) continue;
    if (enums[key]) {
      if (enums[key].includes(v)) out[key] = v;
    } else if (
      [
        'muted',
        'wander',
        'physics',
        'timeOfDay',
        'perch',
        'notifyWhenHidden'
      ].includes(key)
    ) {
      if (typeof v === 'boolean') out[key] = v;
    } else if (
      ['name', 'hotkey', 'confirmHotkey', 'preferredDisplay'].includes(key)
    ) {
      if (typeof v === 'string')
        out[key] = v.slice(0, key === 'name' ? 24 : 120);
    } else if (key === 'scale') {
      if (Number.isFinite(v)) out[key] = Math.max(0.6, Math.min(2.5, v));
    } else if (['stressTokens', 'ctxMax', 'affection'].includes(key)) {
      if (Number.isFinite(v) && v >= 0) out[key] = Math.min(1e7, Math.round(v));
    } else if (key === 'focus' && v && typeof v === 'object') {
      if (Number.isFinite(v.work) && Number.isFinite(v.break))
        out.focus = {
          work: Math.max(1, Math.min(180, v.work)),
          break: Math.max(1, Math.min(60, v.break))
        };
    } else if (key === 'quiet' && v && typeof v === 'object') {
      const { parseClock } = require('./quiet');
      if (
        typeof v.enabled === 'boolean' &&
        parseClock(v.from) !== null &&
        parseClock(v.to) !== null
      )
        out.quiet = { enabled: v.enabled, from: v.from, to: v.to };
    } else if (key === 'profiles' && v && typeof v === 'object') {
      out.profiles = {};
      for (const name of Object.keys(PRESETS))
        if (Object.hasOwn(v, name))
          out.profiles[name] = safeSettings(
            Object.fromEntries(
              PROFILE_KEYS.filter((k) => Object.hasOwn(v[name] || {}, k)).map(
                (k) => [k, v[name][k]]
              )
            )
          );
    }
  }
  return out;
}
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function installCompanion(c) {
  const { app, ipcMain, dialog, nativeImage, screen, store } = c;
  let toyTimer = null,
    toyEnd = 0,
    lastAffection = 0;
  const parent = () => c.getStatsWindow() || c.getWindow();
  const snapshot = (keys) =>
    Object.fromEntries(keys.map((k) => [k, store.get(k)]));
  function refresh() {
    c.pushSettings();
    c.pushSprite();
    c.pushActivity();
    c.buildTrayMenu();
  }
  function stopToy() {
    clearInterval(toyTimer);
    toyTimer = null;
  }
  function affection(amount) {
    if (Date.now() - lastAffection < 1000) return;
    lastAffection = Date.now();
    const before = store.get('affection') || 0,
      after = before + amount;
    store.set('affection', after);
    for (const [threshold, trick] of [
      [10, 'wave'],
      [30, 'dance'],
      [100, 'spin']
    ]) {
      if (before < threshold && after >= threshold) {
        c.doTrick(trick);
        c.notice(`friendship milestone: ${threshold} affection! 💕`);
      }
    }
    c.pushActivity();
  }
  ipcMain.on('pet:affection', () => affection(1));
  function place() {
    const win = c.getWindow();
    if (!win) return;
    const displays = screen.getAllDisplays
      ? screen.getAllDisplays()
      : [screen.getPrimaryDisplay()];
    const display =
      displays.find((d) => String(d.id) === store.get('preferredDisplay')) ||
      screen.getPrimaryDisplay();
    const a = display.workArea || { x: 0, y: 0, ...display.workAreaSize },
      [w, h] = win.getSize();
    const corner = store.get('preferredCorner') || 'bottom-right';
    win.setPosition(
      a.x + (corner.endsWith('right') ? Math.max(0, a.width - w) : 0),
      a.y + (corner.startsWith('bottom') ? Math.max(0, a.height - h) : 0)
    );
    c.savePosition();
  }
  function payload() {
    const points = store.get('affection') || 0;
    return {
      sessions: c.sessions
        .list()
        .map((s) => ({ ...s, prompt: c.openConfirms.get(s.key) || null })),
      // Some prompts can outlive the active lease; keep every one in the inbox.
      prompts: [...c.openConfirms].map(([key, v]) => ({ key, ...v })),
      diagnostics: {
        ...c.getDiagnostics(),
        port: c.getPort(),
        tokenOverride: !!process.env.PET_TOKEN,
        quiet: !!c.inQuietHours()
      },
      snoozeUntil: store.get('snoozeUntil'),
      quietFocus: store.get('quietFocus'),
      presentation: store.get('presentation'),
      affection: points,
      bond:
        points >= 100
          ? 'Best friends'
          : points >= 30
            ? 'Close companions'
            : points >= 10
              ? 'Getting to know you'
              : 'New friends',
      toy: !!toyTimer,
      perch: store.get('perch'),
      preferredDisplay: store.get('preferredDisplay'),
      preferredCorner: store.get('preferredCorner'),
      displays: (screen.getAllDisplays
        ? screen.getAllDisplays()
        : [screen.getPrimaryDisplay()]
      ).map((d, i) => ({
        id: String(d.id),
        label: d.label || `Display ${i + 1}`
      })),
      profiles: Object.keys(PRESETS),
      savedProfiles: Object.keys(store.get('profiles') || {})
    };
  }
  ipcMain.handle('companion:get', () => payload());
  async function saveFile(defaultPath, text) {
    const r = await dialog.showSaveDialog(parent(), { defaultPath });
    if (r.canceled || !r.filePath) return { cancelled: true };
    const tmp = r.filePath + '.tmp';
    try {
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, r.filePath);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
    return { message: 'Saved ' + path.basename(r.filePath) };
  }
  function apply(settings) {
    for (const [k, v] of Object.entries(safeSettings(settings)))
      store.set(k, v);
    c.applyScale(store.get('scale'));
    c.registerHotkeys();
    refresh();
  }
  async function action(a) {
    if (!a || typeof a !== 'object') throw new Error('Invalid action');
    if (a.type === 'endQuiet') {
      store.set('snoozeUntil', 0);
      store.set('quietFocus', false);
      refresh();
      return { message: 'Temporary quiet ended' };
    }
    if (a.type === 'test') {
      const result = await new Promise((resolve) => {
        const req = http.get(
          {
            hostname: '127.0.0.1',
            port: c.getPort(),
            path: '/connection',
            headers: { 'X-Pet-Token': c.effectiveToken() },
            timeout: 2000
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () =>
              resolve(res.statusCode === 200 && body.includes('"ok":true'))
            );
          }
        );
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(false));
      });
      c.getDiagnostics().lastTest = { at: Date.now(), ok: result };
      return {
        message: result
          ? 'Connection and authentication passed. Waiting for events from your integrations.'
          : 'Connection failed: check the tray server status.'
      };
    }
    if (a.type === 'diagnostics') {
      const d = payload().diagnostics;
      return saveFile(
        'pet-diagnostics.json',
        JSON.stringify(
          {
            version: 1,
            platform: process.platform,
            port: d.port,
            tokenOverride: d.tokenOverride,
            quiet: d.quiet,
            lastTest: d.lastTest || null,
            lastEvent: d.lastEvent
              ? { at: d.lastEvent.at, event: d.lastEvent.event }
              : null,
            sessionCount: c.sessions.list().length
          },
          null,
          2
        )
      );
    }
    if (['open', 'ack', 'snoozePrompt'].includes(a.type)) {
      const prompt = c.openConfirms.get(a.key);
      if (!prompt) throw new Error('This prompt is no longer pending');
      if (a.type === 'open') {
        if (!prompt.link || !c.openLinkSafely(prompt.link))
          throw new Error('This integration did not provide an openable link');
      }
      c.acknowledgeConfirm(a.key, a.type === 'snoozePrompt' ? 5 * 60000 : 0);
    } else if (a.type === 'snooze') {
      const minutes = [0, 15, 30, 60].includes(a.minutes) ? a.minutes : 0;
      store.set('snoozeUntil', minutes ? Date.now() + minutes * 60000 : 0);
      refresh();
    } else if (a.type === 'quietFocus') {
      if (!c.isFocusing()) throw new Error('Start a focus session first');
      store.set('quietFocus', true);
      refresh();
    } else if (a.type === 'presentation') {
      const enabled = !!a.enabled;
      if (enabled && !store.get('presentation')) {
        store.set('presentationWasHidden', !!store.get('hidden'));
        c.hidePet();
      }
      store.set('presentation', enabled);
      if (!enabled && !store.get('presentationWasHidden')) c.showPet();
      refresh();
    } else if (a.type === 'treat') {
      affection(3);
      c.doTrick('kiss');
      c.notice('a treat! thank you 💕');
    } else if (a.type === 'toy') {
      if (toyTimer) stopToy();
      else {
        if (c.inQuietHours() || !c.canPlay())
          throw new Error(
            'Play is available when the pet is idle, with quiet mode and reduced motion off'
          );
        c.showPet();
        toyEnd = Date.now() + 20000;
        toyTimer = setInterval(() => {
          const win = c.getWindow();
          if (
            !win ||
            win.isDestroyed() ||
            !win.isVisible() ||
            Date.now() > toyEnd ||
            c.inQuietHours() ||
            !c.canPlay()
          ) {
            stopToy();
            return;
          }
          const cursor = screen.getCursorScreenPoint(),
            [x, y] = win.getPosition(),
            [w, h] = win.getSize();
          const tx = cursor.x - w / 2,
            ty = cursor.y - h / 2;
          if (Math.hypot(tx - x, ty - y) < 35) return;
          const next = c.clampToScreen(
            Math.round(x + (tx - x) * 0.08),
            Math.round(y + (ty - y) * 0.08),
            w,
            h
          );
          win.setPosition(next.x, next.y);
          win.webContents.send('walk', {
            dir: tx < x ? 'left' : 'right',
            ms: 200
          });
          c.savePosition();
        }, 80);
        affection(2);
        c.notice('move your cursor — I’ll chase it! 🧶');
      }
    } else if (a.type === 'position') {
      const settings = safeSettings({
        preferredDisplay: a.display,
        preferredCorner: a.corner,
        perch: !!a.perch
      });
      for (const [k, v] of Object.entries(settings)) store.set(k, v);
      place();
      refresh();
    } else if (a.type === 'saveProfile' || a.type === 'loadProfile') {
      if (!Object.hasOwn(PRESETS, a.name)) throw new Error('Unknown profile');
      if (a.type === 'saveProfile')
        store.set('profiles', {
          ...store.get('profiles'),
          [a.name]: snapshot(PROFILE_KEYS)
        });
      else {
        apply(
          Object.hasOwn(store.get('profiles'), a.name)
            ? store.get('profiles')[a.name]
            : PRESETS[a.name]
        );
        place();
      }
    } else if (a.type === 'backup') {
      const sp = store.get('sprite');
      let sprite = null;
      if (sp?.file) {
        const file = path.join(app.getPath('userData'), path.basename(sp.file));
        const bytes = fs.readFileSync(file);
        if (bytes.length > 4 * 1024 * 1024)
          throw new Error('Sprite is too large');
        sprite = {
          ...sp,
          file: path.basename(sp.file),
          data: bytes.toString('base64')
        };
        delete sprite.url;
      }
      return saveFile(
        'pet-settings.json',
        JSON.stringify(
          { version: 1, settings: safeSettings(snapshot(BACKUP_KEYS)), sprite },
          null,
          2
        )
      );
    } else if (a.type === 'restore') {
      const r = await dialog.showOpenDialog(parent(), {
        properties: ['openFile'],
        filters: [{ name: 'Pet backup', extensions: ['json'] }]
      });
      if (r.canceled || !r.filePaths.length) return { cancelled: true };
      if (fs.statSync(r.filePaths[0]).size > 6 * 1024 * 1024)
        throw new Error('Backup is too large');
      const backup = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      if (backup.version !== 1) throw new Error('Unsupported backup version');
      const settings = safeSettings(backup.settings);
      let sprite = null,
        bytes = null;
      if (backup.sprite) {
        const sp = backup.sprite,
          ext = path.extname(sp.file || '').toLowerCase();
        if (
          !['.png', '.gif', '.webp'].includes(ext) ||
          typeof sp.data !== 'string'
        )
          throw new Error('Invalid sprite');
        bytes = Buffer.from(sp.data, 'base64');
        if (
          !(await decodeSprite(
            bytes,
            { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[
              ext
            ],
            { nativeImage, BrowserWindow: c.BrowserWindow }
          ))
        )
          throw new Error('Invalid sprite image');
        for (const k of ['cols', 'rows', 'fps'])
          if (
            !Number.isInteger(sp[k]) ||
            sp[k] < 1 ||
            sp[k] > (k === 'fps' ? 60 : 64)
          )
            throw new Error('Invalid sprite geometry');
        sprite = {
          file: 'sprite-restored-' + Date.now() + ext,
          name:
            typeof sp.name === 'string'
              ? sp.name.slice(0, 100)
              : 'Restored sprite',
          cols: sp.cols,
          rows: sp.rows,
          fps: sp.fps,
          moods: Object.fromEntries(
            [
              'idle',
              'thinking',
              'working',
              'happy',
              'stressed',
              'sleeping',
              'error'
            ].map((m, i) => [
              m,
              { row: Math.min(i, sp.rows - 1), frames: sp.cols }
            ])
          )
        };
      }
      if (
        sprite &&
        backup.sprite.moods &&
        typeof backup.sprite.moods === 'object'
      ) {
        for (const mood of Object.keys(sprite.moods)) {
          const m = backup.sprite.moods[mood];
          if (!m) continue;
          if (
            !Number.isInteger(m.row) ||
            m.row < 0 ||
            m.row >= sprite.rows ||
            !Number.isInteger(m.frames) ||
            m.frames < 1 ||
            m.frames > sprite.cols
          )
            throw new Error('Invalid sprite mood');
          sprite.moods[mood] = { row: m.row, frames: m.frames };
          if (m.fps !== undefined) {
            if (!Number.isFinite(m.fps) || m.fps < 1 || m.fps > 60)
              throw new Error('Invalid sprite FPS');
            sprite.moods[mood].fps = m.fps;
          }
        }
      }
      const answer = await dialog.showMessageBox(parent(), {
        type: 'question',
        buttons: ['Restore', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: 'Restore appearance and preferences?',
        detail:
          'Your current config will be backed up. Tokens, task totals, login settings, and live sessions are kept.'
      });
      if (answer.response !== 0) return { cancelled: true };
      store.flushNow();
      fs.copyFileSync(store.path, store.path + '.before-restore-' + Date.now());
      if (sprite)
        fs.writeFileSync(
          path.join(app.getPath('userData'), sprite.file),
          bytes
        );
      store.set('sprite', sprite);
      apply(settings);
      store.flushNow();
      return {
        message: 'Settings restored. Authentication and task history were kept.'
      };
    } else if (a.type === 'sessionCsv') {
      c.sessions.tick();
      const rows = [
        [
          'Assistant',
          'Session',
          'Project',
          'Status',
          'Started',
          'Updated',
          'Active milliseconds',
          'Waiting milliseconds'
        ],
        ...c.sessions
          .list()
          .map((s) => [
            s.source,
            s.session,
            s.project,
            s.status,
            new Date(s.startedAt).toISOString(),
            new Date(s.updatedAt).toISOString(),
            s.activeMs,
            s.waitingMs
          ])
      ];
      return saveFile(
        'pet-sessions.csv',
        rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
      );
    } else if (a.type === 'csv') {
      c.sessions.tick();
      const report = c.activityReport();
      const rows = [
        [
          'Date',
          'Assistant',
          'Tasks',
          'Active milliseconds',
          'Confirmations',
          'Errors'
        ],
        ...report.perAi.map((r) => [
          new Date().toLocaleDateString('en-CA'),
          r.source,
          r.tasks,
          r.activeMs,
          r.confirms,
          r.errors
        ])
      ];
      return saveFile(
        'pet-activity.csv',
        rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
      );
    } else if (!['open', 'ack', 'snoozePrompt'].includes(a.type))
      throw new Error('Unknown action');
    return { message: 'Saved', state: payload() };
  }
  ipcMain.handle('companion:action', async (_e, a) => {
    try {
      return { ok: true, ...(await action(a)) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Apply a saved stationary perch after startup; display changes are clamped by main.
  setTimeout(() => {
    if (store.get('perch')) place();
  }, 1000);
}
module.exports = { installCompanion, safeSettings, csvCell };
