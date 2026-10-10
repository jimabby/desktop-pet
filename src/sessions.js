'use strict';

const keyOf = (s) =>
  `${(s.source || '').trim().toLowerCase()}|${s.session || ''}`;
function eventOf(s) {
  if (s.event) return s.event;
  if (s.attention || s.link) return 'confirm';
  return (
    { happy: 'done', error: 'error', idle: 'idle', sleeping: 'idle' }[s.mood] ||
    'busy'
  );
}

// Session clocks are independent of appearance. Leases bound abandoned work;
// heartbeats extend a lease without losing the beginning of the task.
function createSessions(onTime, clock = Date.now) {
  const sessions = new Map(),
    seen = new Map();
  function accrue(s, now) {
    const end = Math.min(now, s.expiresAt);
    if (s.status === 'busy' && end > s.accountedAt) {
      s.activeMs += end - s.accountedAt;
      onTime(s.source, s.accountedAt, end);
    }
    if (s.status === 'confirm') s.waitingMs += Math.max(0, now - s.accountedAt);
    s.accountedAt = now;
    if (now >= s.expiresAt && s.status === 'busy') s.status = 'expired';
  }
  function tick() {
    const now = clock();
    for (const [key, s] of sessions) {
      accrue(s, now);
      if (
        !['busy', 'confirm'].includes(s.status) &&
        now - s.updatedAt > 3600000
      )
        sessions.delete(key);
    }
    for (const [id, at] of seen) if (now - at > 3600000) seen.delete(id);
  }
  function accept(state) {
    tick();
    const now = clock(),
      key = keyOf(state),
      event = eventOf(state);
    const id = state.eventId ? `${key}|${state.eventId}` : '';
    if (id && seen.has(id)) return { key, event, duplicate: true };
    if (id) {
      seen.set(id, now);
      if (seen.size > 5000) seen.delete(seen.keys().next().value);
    }
    if (event === 'idle' || event === 'session-end') {
      for (const [k, s] of sessions) {
        if (
          !state.source ||
          (s.source === state.source.trim().toLowerCase() &&
            (!state.session || k === key))
        )
          sessions.delete(k);
      }
      return { key, event, duplicate: false };
    }
    const previous = sessions.get(key);
    const status =
      event === 'confirm'
        ? 'confirm'
        : event === 'busy' || event === 'start'
          ? 'busy'
          : event;
    const continuing =
      previous && ['busy', 'confirm'].includes(previous.status);
    const lease = state.leaseMs || state.ttl || 120000;
    sessions.set(key, {
      key,
      source: (state.source || '').trim().toLowerCase(),
      session: state.session || '',
      project: state.project || previous?.project || '',
      status,
      startedAt: continuing ? previous.startedAt : now,
      activeMs: continuing ? previous.activeMs : 0,
      waitingMs: continuing ? previous.waitingMs : 0,
      updatedAt: now,
      accountedAt: now,
      expiresAt: now + lease,
      text: state.text || '',
      link: state.link || previous?.link || ''
    });
    if (sessions.size > 1000) sessions.delete(sessions.keys().next().value);
    return { key, event, duplicate: false };
  }
  function suspend() {
    tick();
    for (const s of sessions.values())
      if (s.status === 'busy') s.status = 'expired';
  }
  return {
    accept,
    tick,
    suspend,
    list: () => [...sessions.values()].map((s) => ({ ...s }))
  };
}
module.exports = { createSessions, keyOf, eventOf };
