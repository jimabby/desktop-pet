(() => {
  'use strict';
  const hub = document.getElementById('companion');
  const status = document.getElementById('companion-status');
  let current;
  let setupCommand = '';
  let resetPosition = false;
  const sections = new Map();
  let displaySignature = '';
  function button(label, action) {
    const b = document.createElement('button');
    b.textContent = label;
    b.type = 'button';
    b.dataset.action = JSON.stringify(action());
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await window.statsAPI.action(action());
        if (r.command) setupCommand = r.command;
        status.textContent = r.ok
          ? r.message || 'Saved'
          : r.error || 'Could not complete action';
        if (r.ok && ['position','loadProfile','restore'].includes(action().type)) resetPosition = true;
        await refresh();
      } catch (e) {
        status.textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
    return b;
  }
  function section(title) {
    const s = sections.get(title) || document.createElement('section'),
      h = document.createElement('h2');
    if (!sections.has(title)) { sections.set(title, s); hub.append(s); }
    if (title === 'Perch & profiles' && s.children.length && !resetPosition) return s;
    s.replaceChildren();
    h.textContent = title;
    s.append(h);
    return s;
  }
  function line(parent, text) {
    const p = document.createElement('p');
    p.textContent = text;
    parent.append(p);
    return p;
  }
  function select(label, options, value) {
    const l = document.createElement('label');
    l.textContent = label + ' ';
    const s = document.createElement('select');
    for (const [v, t] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      s.append(o);
    }
    s.value = value;
    l.append(s);
    return { label: l, input: s };
  }
  function time(at) {
    return at ? new Date(at).toLocaleTimeString() : 'Never';
  }
  function duration(ms) {
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }
  function render(data) {
    current = data;
    const nextDisplays = JSON.stringify(data.displays);
    if (displaySignature && displaySignature !== nextDisplays) resetPosition = true;
    displaySignature = nextDisplays;
    const focusedAction = hub.contains(document.activeElement)
      ? document.activeElement.dataset.action
      : null;
    const d = section('Connection');
    const last = data.diagnostics.lastEvent;
    line(
      d,
      `Local port ${data.diagnostics.port || 'starting'} · token ${data.diagnostics.tokenOverride ? 'set by environment' : 'managed by app'}`
    );
    if (data.diagnostics.lastTest)
      line(
        d,
        `Connection test ${data.diagnostics.lastTest.ok ? 'passed' : 'failed'} at ${time(data.diagnostics.lastTest.at)}`
      );
    line(
      d,
      last
        ? `Last event: ${last.source || 'AI'} · ${last.session || 'default session'} · ${last.event} at ${time(last.at)}`
        : 'No integration events received yet.'
    );
    d.append(
      button('Test connection', () => ({ type: 'test' })),
      button('Export diagnostics', () => ({ type: 'diagnostics' }))
    );
    const setup = section('Connect an integration');
    line(setup, '1. Send a sample to check this app. 2. Generate and run a command in your terminal. 3. Verify that setup-check appears as the last received event. For Claude Code, install hooks in Settings and start a new session.');
    setup.append(button('Send sample event', () => ({type:'sampleEvent'})), button('Show terminal command', () => ({type:'setupCommand'})));
    if (data.diagnostics.lastSample) line(setup, `Sample ${data.diagnostics.lastSample.ok ? 'received' : 'failed'} at ${time(data.diagnostics.lastSample.at)}`);
    if (setupCommand) {
      line(setup, 'This command contains your local token. Keep it private; regenerate it after changing the token or port.');
      const command = document.createElement('textarea'); command.readOnly = true; command.value = setupCommand; command.rows = 5; command.setAttribute('aria-label', 'Authenticated setup command');
      setup.append(command, button('Copy terminal command', () => ({type:'copySetupCommand'})));
    }
    const inbox = section('Sessions & prompts');
    if (!data.sessions.length && !data.prompts.length)
      line(inbox, 'No active sessions or waiting prompts.');
    line(inbox, 'Dismiss removes a stale prompt from this pet. It does not approve or cancel anything in your assistant.');
    const prompts = new Map(data.prompts.map((p) => [p.key, p]));
    for (const session of data.sessions) {
      const row = document.createElement('article');
      line(
        row,
        `${session.project || session.source || 'AI'} · ${session.session || 'default'} · ${session.status} · ${duration(session.activeMs)} working · ${duration(session.waitingMs)} waiting`
      );

      line(row, `Last event ${time(session.updatedAt)}${session.status === 'expired' ? ' · ' + session.expiryReason : ''}`);
      const p = prompts.get(session.key);
      if (p) {
        renderPrompt(row, p);
        prompts.delete(session.key);
      }
      inbox.append(row);
    }
    for (const p of prompts.values()) {
      const row = document.createElement('article');
      renderPrompt(row, p);
      inbox.append(row);
    }
    const recaps = section('Focus recaps');
    if (!data.focusRecaps?.length) line(recaps, 'Finish a focus work block to see completed tasks, active time, and outstanding prompts here.');
    for (const recap of [...(data.focusRecaps || [])].reverse()) {
      line(recaps, `${new Date(recap.endedAt).toLocaleString()} · ${recap.completed ? 'Completed' : 'Stopped early'} · ${recap.tasks} done · ${duration(recap.activeMs)} active · ${recap.pending} waiting at the end`);
    }
    line(recaps, 'Active time sums working sessions; parallel sessions can exceed the block’s elapsed time.');
    const quiet = section('Quiet & presentation');
    line(
      quiet,
      data.presentation
        ? 'Presentation mode: pet hidden; events are still tracked.'
        : data.quietFocus
          ? 'Quiet until this focus block ends.'
          : data.snoozeUntil > Date.now()
            ? `Quiet until ${time(data.snoozeUntil)}`
            : data.diagnostics.quiet
              ? 'Scheduled quiet hours are active.'
              : 'Notifications are available.'
    );
    for (const minutes of [15, 30, 60])
      quiet.append(
        button(`${minutes}m quiet`, () => ({ type: 'snooze', minutes }))
      );
    quiet.append(
      button('End temporary quiet', () => ({ type: 'endQuiet' })),
      button('Quiet for focus block', () => ({ type: 'quietFocus' })),
      button(
        data.presentation ? 'End presentation' : 'Start presentation',
        () => ({ type: 'presentation', enabled: !current.presentation })
      )
    );
    const play = section('Your companion');
    line(play, `${data.bond} · ${data.affection} affection points`);
    line(
      play,
      'Petting earns affection. Treats and play earn extra points; affection never decays.'
    );
    play.append(
      button('Give a treat', () => ({ type: 'treat' })),
      button(data.toy ? 'Stop toy' : 'Chase cursor toy · 20s', () => ({
        type: 'toy'
      }))
    );
    const positions = section('Perch & profiles');
    if (positions.children.length === 1 || resetPosition) {
      resetPosition = false;
      const displays = select(
        'Display',
        data.displays.map((d) => [d.id, d.label]),
        data.preferredDisplay || data.displays[0]?.id
      );
      const corner = select(
        'Corner',
        ['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((v) => [
          v,
          v.replace('-', ' ')
        ]),
        data.preferredCorner
      );
      const perch = select(
        'Movement',
        [
          ['false', 'Wandering allowed'],
          ['true', 'Stationary perch']
        ],
        String(!!data.perch)
      );
      positions.append(
        displays.label,
        corner.label,
        perch.label,
        button('Set position', () => ({
          type: 'position',
          display: displays.input.value,
          corner: corner.input.value,
          perch: perch.input.value === 'true'
        }))
      );
      for (const name of data.profiles) {
        const row = document.createElement('p');
        row.append(
          button(`Use ${name}`, () => ({ type: 'loadProfile', name })),
          button(`Save current as ${name}`, () => ({ type: 'saveProfile', name }))
        );
        positions.append(row);
      }
    }
    const backup = section('Backup & export');
    line(
      backup,
      'Backups include preferences, affection, profiles, and sprite art. Tokens and task history stay on this computer.'
    );
    backup.append(
      button('Export settings', () => ({ type: 'backup' })),
      button('Restore settings', () => ({ type: 'restore' })),
      button('Export today as CSV', () => ({ type: 'csv' })),
      button('Export sessions as CSV', () => ({ type: 'sessionCsv' }))
    );
    if (focusedAction)
      [...hub.querySelectorAll('button')]
        .find((b) => b.dataset.action === focusedAction)
        ?.focus();
  }
  function renderPrompt(row, p) {
    line(
      row,
      `${p.source}: ${p.text}${p.acked ? ' · acknowledged' : p.snoozedUntil > Date.now() ? ' · snoozed' : ''}`
    );
    if (p.link)
      row.append(button('Open', () => ({ type: 'open', key: p.key })));
    row.append(
      button('Acknowledge', () => ({ type: 'ack', key: p.key })),
      button('Snooze 5m', () => ({ type: 'snoozePrompt', key: p.key })),
      button('Dismiss locally', () => ({ type: 'dismiss', key: p.key }))
    );
  }
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      render(await window.statsAPI.companion());
      const activity = await window.statsAPI.get();
      window.dispatchEvent(
        new CustomEvent('activity-refresh', { detail: activity })
      );
    } catch (e) {
      status.textContent = e.message;
    } finally {
      refreshing = false;
    }
  }
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 3000);
})();
