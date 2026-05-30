'use strict';

const pet = document.getElementById('pet');
const zone = document.getElementById('pet-zone');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleLink = document.getElementById('bubble-link');
const aiBadges = document.getElementById('ai-badges');
const particles = document.getElementById('particles');
const ctxBar = document.getElementById('ctx-bar');
const ctxBarLabel = document.getElementById('ctx-bar-label');
const body = document.querySelector('.body');
const pupils = document.querySelectorAll('.pupil');

const MOODS = ['idle', 'thinking', 'working', 'happy', 'stressed', 'sleeping', 'error'];
const MOOD_PRIORITY = {
  idle: 0,
  sleeping: 0,
  happy: 1,
  thinking: 2,
  working: 3,
  stressed: 4,
  error: 5
};

let currentMood = 'idle';
let currentSource = '';
let lastInteraction = Date.now();
let bubbleTimer = null;
let happyResetTimer = null;
let attentionTimer = null;
let pendingLink = '';
// An unanswered confirm/permission prompt keeps nudging (bounce + re-chime),
// getting more insistent, until you answer it or a new AI event arrives.
let confirmPending = false;
let confirmLevel = 0;
let confirmNudgeTimer = null;
const confirmInfo = { text: '', link: '', linkText: '' };
const activeAis = new Map();
let muted = false;

// Moods that mean an AI is actively busy (used to time how long a task ran).
const BUSY_MOODS = new Set(['thinking', 'working', 'stressed']);

// "2m 13s" / "47s" — a compact human duration for the "done in …" note.
function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

// Known AI sources get their own tint; anything else falls back to default.
const KNOWN_SOURCES = ['claude', 'chatgpt', 'gemini', 'deepseek', 'copilot', 'cursor', 'ollama'];
const SOURCE_LABELS = {
  claude: 'C',
  chatgpt: 'GPT',
  gemini: 'Gem',
  deepseek: 'D',
  copilot: 'Co',
  cursor: 'Cur',
  ollama: 'Ol'
};

// ---------------------------------------------------------------------------
// Settings from main (mute toggle)
// ---------------------------------------------------------------------------
window.petAPI.onSettings((s) => {
  if (typeof s.muted === 'boolean') muted = s.muted;
  if (Number.isFinite(s.ctxMax) && s.ctxMax > 0) ctxMax = s.ctxMax;
  if (s.appearance) applyAppearance(s.appearance);
});

// ---------------------------------------------------------------------------
// Context-usage slider — a thin bar below the pet that fills as the
// conversation's context window fills up. Token counts arrive on each AI
// state as `ctx`.
// ---------------------------------------------------------------------------
let ctxMax = 200000; // overridden by settings (PET_CTX_MAX)
let lastCtx = 0;

function ringColor(pct) {
  if (pct >= 85) return '#f25b5b'; // red — running low on room
  if (pct >= 60) return '#ffb02e'; // amber — filling up
  return '#59c98a'; // green — plenty of headroom
}

function updateCtxRing() {
  if (lastCtx <= 0) {
    ctxBar.classList.add('hidden');
    ctxBarLabel.classList.add('hidden');
    return;
  }
  const pct = Math.max(0, Math.min(100, (lastCtx / ctxMax) * 100));
  const color = ringColor(pct);
  ctxBar.style.setProperty('--pct', pct.toFixed(1));
  ctxBar.style.setProperty('--ring-color', color);
  ctxBar.classList.remove('hidden');
  // dim it when no AI is actively working, so an idle pet stays uncluttered
  ctxBar.classList.toggle('dim', activeAis.size === 0);

  // Compact token label, shown once usage is meaningful.
  if (pct >= 25) {
    ctxBarLabel.textContent = `${Math.round(lastCtx / 1000)}k`;
    ctxBarLabel.style.setProperty('--label-color', color);
    ctxBarLabel.classList.remove('hidden');
  } else {
    ctxBarLabel.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Appearance (name, body color, skin shape, cosmetic, time-of-day) from settings.
// ---------------------------------------------------------------------------
let petName = '';
const SKINS = ['slime', 'cat', 'ghost'];
const COSMETICS = ['none', 'glasses', 'scarf', 'crown'];
let timeOfDayEnabled = true;

function applyAppearance(a) {
  if (typeof a.name === 'string') petName = a.name.trim();
  if (Array.isArray(a.colorStops) && a.colorStops.length === 2) {
    document.documentElement.style.setProperty('--body-1', a.colorStops[0]);
    document.documentElement.style.setProperty('--body-2', a.colorStops[1]);
  }
  // Skin shape — a class on #pet so the CSS can reshape the body / ears / etc.
  if (typeof a.skin === 'string') {
    SKINS.forEach((s) => pet.classList.remove('skin-' + s));
    pet.classList.add('skin-' + (SKINS.includes(a.skin) ? a.skin : 'slime'));
  }
  // Equipped cosmetic — a class on #pet that reveals the matching accessory.
  if (typeof a.cosmetic === 'string') {
    COSMETICS.forEach((c) => pet.classList.remove('cosmetic-' + c));
    const c = COSMETICS.includes(a.cosmetic) ? a.cosmetic : 'none';
    if (c !== 'none') pet.classList.add('cosmetic-' + c);
  }
  if (typeof a.timeOfDay === 'boolean') {
    timeOfDayEnabled = a.timeOfDay;
    applyTimeOfDay();
  }
}

// Tint the whole pet warmer/dimmer at night and brighter midday. Implemented as
// a CSS filter on #pet so it layers over every mood/skin without touching colors.
function applyTimeOfDay() {
  if (!timeOfDayEnabled) {
    pet.style.filter = '';
    return;
  }
  const h = new Date().getHours();
  let filter = '';
  if (h >= 21 || h < 6) {
    filter = 'brightness(0.82) saturate(0.85) hue-rotate(-8deg)'; // late night
  } else if (h < 9) {
    filter = 'brightness(0.95) saturate(0.95)'; // early morning
  } else if (h >= 18) {
    filter = 'brightness(0.92) sepia(0.12) saturate(1.05)'; // golden evening
  } else {
    filter = 'brightness(1.04) saturate(1.06)'; // bright daytime
  }
  pet.style.filter = filter;
}
// Re-evaluate the tint every few minutes so it tracks the clock without a reload.
setInterval(applyTimeOfDay, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// Tiny WebAudio chimes — no asset files needed. Skipped while muted.
// ---------------------------------------------------------------------------
let audioCtx = null;
function tone(freq, when, dur, gain = 0.06) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(when);
  osc.stop(when + dur);
}
function playSound(name) {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    if (name === 'happy') {
      tone(523.25, t, 0.14);        // C5
      tone(783.99, t + 0.1, 0.18);  // G5 — little rising "ta-da"
    } else if (name === 'error') {
      tone(196, t, 0.22, 0.07);     // low G3 buzz
      tone(155.56, t + 0.12, 0.22, 0.07);
    } else if (name === 'attention') {
      tone(659.25, t, 0.12);        // E5
      tone(880, t + 0.13, 0.16);    // A5 — bright "ding-ding" to look over
    }
  } catch {
    /* audio not available — ignore */
  }
}

// ---------------------------------------------------------------------------
// Particles — little hearts (petting) and sparkles (delight). Each is a span
// that floats up and fades via CSS, then removes itself. Pointer-events: none,
// so they never affect the click-through hit-testing.
// ---------------------------------------------------------------------------
const HEART_GLYPHS = ['♥', '❤', '💕'];
const SPARKLE_GLYPHS = ['✦', '✧', '⋆', '✨'];

function spawnParticle(type) {
  const el = document.createElement('span');
  el.className = 'particle ' + type;
  const glyphs = type === 'heart' ? HEART_GLYPHS : SPARKLE_GLYPHS;
  el.textContent = glyphs[(Math.random() * glyphs.length) | 0];
  // Randomize the start x, sideways drift, rotation, and size so a burst looks
  // organic rather than a stack of identical glyphs.
  el.style.left = 30 + Math.random() * 50 + 'px';
  el.style.setProperty('--dx', (Math.random() * 40 - 20).toFixed(0) + 'px');
  el.style.setProperty('--rot', (Math.random() * 60 - 30).toFixed(0) + 'deg');
  el.style.fontSize = 12 + Math.random() * 8 + 'px';
  el.style.animationDuration = 900 + Math.random() * 500 + 'ms';
  el.addEventListener('animationend', () => el.remove());
  particles.appendChild(el);
}

function burst(type, count) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => spawnParticle(type), i * 80);
  }
}

// ---------------------------------------------------------------------------
// Mood control
// ---------------------------------------------------------------------------
function applyClasses() {
  pet.className = 'mood-' + currentMood;
  const activeCount = activeAis.size;
  if (activeCount > 1) {
    pet.classList.add('source-many');
  } else if (currentSource && KNOWN_SOURCES.includes(currentSource)) {
    pet.classList.add('source-' + currentSource);
  }
}

function setMood(mood, { silent = false } = {}) {
  if (!MOODS.includes(mood)) mood = 'idle';
  const changed = mood !== currentMood;
  currentMood = mood;
  applyClasses();
  if (changed && !silent && (mood === 'happy' || mood === 'error')) {
    playSound(mood);
    if (mood === 'happy') burst('sparkle', 3); // a little "done!" celebration
  }
}

function setSource(source) {
  currentSource = (source || '').toLowerCase();
  applyClasses();
}

function say(text, ms = 4000, link = '', linkText = '') {
  clearTimeout(bubbleTimer);
  if (!text && !link) {
    bubble.classList.add('hidden');
    return;
  }
  bubbleText.textContent = text || '';

  // Optional clickable link (e.g. "jump back to the editor to confirm").
  pendingLink = link || '';
  if (pendingLink) {
    bubbleLink.textContent = linkText || 'Open →';
    bubbleLink.classList.remove('hidden');
  } else {
    bubbleLink.textContent = '';
    bubbleLink.classList.add('hidden');
  }

  bubble.classList.remove('hidden');
  // restart pop animation
  bubble.style.animation = 'none';
  void bubble.offsetWidth;
  bubble.style.animation = '';
  if (ms > 0) {
    bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms);
  }
}

// A confirm/permission prompt needs the user — bounce, chime, and tint the pet
// so it's noticeable even out of the corner of your eye.
function attention() {
  setSource('');
  setMood('stressed', { silent: true });
  pet.classList.add('attention');
  playSound('attention');
  clearTimeout(attentionTimer);
  attentionTimer = setTimeout(() => {
    pet.classList.remove('attention');
    if (activeAis.size) renderFromActiveAis();
    else setMood('idle');
  }, 8000);
}

// Start (or restart) nudging for an unanswered confirm. attention() already
// bounced + chimed once; here we keep it bouncing and re-chime on a growing
// cadence so a prompt left sitting is impossible to miss.
function startConfirmNudge() {
  confirmPending = true;
  confirmLevel = 1;
  clearTimeout(attentionTimer); // don't let attention() auto-revert mid-wait
  scheduleNextNudge();
}

function scheduleNextNudge() {
  clearTimeout(confirmNudgeTimer);
  // First re-nudge after ~14s, then a touch sooner each round (min 8s).
  const delay = Math.max(8000, 16000 - confirmLevel * 1500);
  confirmNudgeTimer = setTimeout(() => {
    if (!confirmPending) return;
    confirmLevel++;
    pet.classList.add('attention');
    pet.classList.toggle('attention-strong', confirmLevel >= 3); // bigger bounce
    setMood('stressed', { silent: true });
    playSound('attention');
    if (confirmInfo.text) say(confirmInfo.text, 18000, confirmInfo.link, confirmInfo.linkText);
    scheduleNextNudge();
  }, delay);
}

// Stop nudging (answered, poked, or a new AI event arrived). restore=true puts
// the pet back to a sensible mood; pass false when the caller sets it next.
function stopConfirmNudge({ restore = true } = {}) {
  const wasActive = confirmPending || confirmNudgeTimer;
  confirmPending = false;
  confirmLevel = 0;
  clearTimeout(confirmNudgeTimer);
  confirmNudgeTimer = null;
  clearTimeout(attentionTimer);
  pet.classList.remove('attention', 'attention-strong');
  if (wasActive && restore) {
    if (activeAis.size) renderFromActiveAis();
    else setMood('idle');
  }
}

// Open the pending link (clicking the bubble link, or the pet while one is up).
function openPendingLink() {
  if (!pendingLink) return false;
  window.petAPI.openLink(pendingLink);
  pendingLink = '';
  bubbleLink.classList.add('hidden');
  stopConfirmNudge({ restore: true });
  say('on my way! 🚀', 1500);
  return true;
}

bubbleLink.addEventListener('click', (e) => {
  e.stopPropagation();
  openPendingLink();
});

function normalizeSource(source) {
  return (source || 'ai').toLowerCase().trim() || 'ai';
}

function sourceName(source) {
  if (source === 'chatgpt') return 'ChatGPT';
  if (source === 'deepseek') return 'DeepSeek';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function summarizeActiveAis() {
  const sources = [...activeAis.keys()].map(sourceName);
  if (sources.length === 0) return '';
  if (sources.length === 1) return `${sources[0]} is ${currentMood}...`;
  if (sources.length === 2) return `${sources[0]} + ${sources[1]} are teaming up...`;
  return `${sources.slice(0, 3).join(' + ')} are working together...`;
}

function renderBadges() {
  aiBadges.replaceChildren();
  if (activeAis.size === 0) {
    aiBadges.classList.add('hidden');
    return;
  }

  aiBadges.classList.remove('hidden');
  [...activeAis.keys()].slice(0, 4).forEach((source) => {
    const badge = document.createElement('span');
    badge.className = `ai-badge source-${source}`;
    badge.textContent = SOURCE_LABELS[source] || sourceName(source).slice(0, 3);
    badge.title = sourceName(source);
    aiBadges.appendChild(badge);
  });
}

function removeActiveAi(source) {
  const active = activeAis.get(source);
  if (active && active.timer) clearTimeout(active.timer);
  activeAis.delete(source);
  renderFromActiveAis();
}

function renderFromActiveAis() {
  renderBadges();
  updateCtxRing();
  if (activeAis.size === 0) {
    setSource('');
    setMood('idle');
    return;
  }

  let strongest = null;
  activeAis.forEach((active) => {
    if (!strongest || MOOD_PRIORITY[active.mood] >= MOOD_PRIORITY[strongest.mood]) {
      strongest = active;
    }
  });

  setSource(activeAis.size > 1 ? 'many' : strongest.source);
  setMood(strongest.mood);
}

// ---------------------------------------------------------------------------
// Incoming AI state (from the local control server, via main process)
// ---------------------------------------------------------------------------
window.petAPI.onAiState((state) => {
  lastInteraction = Date.now();
  const source = normalizeSource(state.source);
  const goingIdle = state.mood === 'idle';
  // Set when a source finishes a timed task, e.g. " · 2m 13s"; appended to the
  // "done!" bubble so you can see how long the AI took.
  let finishedSuffix = '';

  if (Number.isFinite(state.ctx) && state.ctx > 0) lastCtx = state.ctx;

  // Any event that isn't itself a confirm means the pending one was answered
  // (or superseded) — stop nudging. The mood is set by the rest of this handler.
  if (!(state.attention || state.link)) stopConfirmNudge({ restore: false });

  if (goingIdle) {
    if (state.source) {
      removeActiveAi(source);
    } else {
      activeAis.forEach((active) => {
        if (active.timer) clearTimeout(active.timer);
      });
      activeAis.clear();
      lastCtx = 0; // whole session cleared — drop the context ring too
      renderFromActiveAis();
    }
  } else {
    const previous = activeAis.get(source);
    if (previous && previous.timer) clearTimeout(previous.timer);
    const mood = MOODS.includes(state.mood) ? state.mood : 'thinking';

    // Time the task: remember when this source first started being busy, and
    // carry that start time across refreshes. When it lands on "happy" (done)
    // we can report how long it ran.
    let startedAt = previous ? previous.startedAt : 0;
    if (BUSY_MOODS.has(mood) && !startedAt) startedAt = Date.now();
    if (mood === 'happy' && previous && previous.startedAt) {
      const elapsed = Date.now() - previous.startedAt;
      if (elapsed > 4000) finishedSuffix = ` · ${formatDuration(elapsed)}`;
      startedAt = 0; // reset for the next task
    }

    const active = { source, mood, timer: null, startedAt };
    if (state.ttl && state.ttl > 0) {
      active.timer = setTimeout(() => removeActiveAi(source), state.ttl);
    }
    activeAis.set(source, active);
    renderFromActiveAis();
  }

  if (state.attention || state.link) {
    // A confirm/permission prompt. The link (jump back to the editor) is
    // optional — the bounce + chime fire either way so it's never missed.
    const prefix = state.source ? `${state.source}: ` : '';
    const text = prefix + (state.text || 'needs you to confirm');
    confirmInfo.text = text;
    confirmInfo.link = state.link || '';
    confirmInfo.linkText = state.linkText || '';
    say(text, state.ttl || 60000, state.link, state.linkText);
    attention();
    startConfirmNudge(); // keep nudging until it's answered
  } else if (state.text) {
    const prefix = state.source ? `${state.source}: ` : '';
    say(prefix + state.text + finishedSuffix, state.ttl || 6000);
  } else if (goingIdle) {
    say(activeAis.size ? summarizeActiveAis() : '');
  } else if (activeAis.size > 1) {
    say(summarizeActiveAis(), 4500);
  }
});

// ---------------------------------------------------------------------------
// A transient celebratory bubble from main (e.g. "unlocked the crown!"), shown
// without disturbing whatever mood the pet is currently in.
// ---------------------------------------------------------------------------
window.petAPI.onNotice((text) => {
  if (!text) return;
  lastInteraction = Date.now();
  burst('sparkle', 5);
  say(String(text), 4000);
});

// ---------------------------------------------------------------------------
// Focus mode (Pomodoro) — main runs the timer and tells us when the phase
// changes. The pet cheers at the start of a work block and naps on breaks.
// ---------------------------------------------------------------------------
let focusPhase = null; // 'work' | 'break' | null
window.petAPI.onFocus((f) => {
  focusPhase = f && f.phase ? f.phase : null;
  lastInteraction = Date.now();
  if (focusPhase === 'work') {
    pet.classList.add('focusing');
    setSource('');
    setMood('happy', { silent: true });
    say(`focus time! ${f.minutes || 25}m 💪`, 3000);
    clearTimeout(happyResetTimer);
    happyResetTimer = setTimeout(() => {
      if (activeAis.size) renderFromActiveAis();
      else setMood('idle');
    }, 1500);
  } else if (focusPhase === 'break') {
    pet.classList.remove('focusing');
    setMood('sleeping');
    say(`break — back in ${f.minutes || 5}m 😴`, 4000);
  } else {
    pet.classList.remove('focusing');
    say('focus done — nice work! 🎉', 3000);
    if (activeAis.size) renderFromActiveAis();
    else setMood('idle');
  }
});

// ---------------------------------------------------------------------------
// Click / poke reaction
// ---------------------------------------------------------------------------
const POKE_LINES = [
  'hi!',
  'hehe~',
  "let's go!",
  '*wiggle*',
  'boop!',
  'i missed you',
  '^_^'
];
// Said when you keep petting — the pet warms up the more you poke it.
const LOVE_LINES = ['hehe that tickles!', 'more more~', "you're the best!", 'I love you! 💕', '*happy wiggle*'];

// Track how fast you're poking so repeated pets escalate into a heart shower.
let pokeStreak = 0;
let pokeStreakTimer = null;

function react() {
  lastInteraction = Date.now();
  // If a confirm prompt is waiting, a poke opens the editor instead of playing.
  if (openPendingLink()) return;
  // A poke also acknowledges a link-less confirm — stop pestering.
  stopConfirmNudge({ restore: false });

  pokeStreak++;
  clearTimeout(pokeStreakTimer);
  pokeStreakTimer = setTimeout(() => (pokeStreak = 0), 1400);

  setSource('');
  setMood('happy', { silent: true }); // poking shouldn't spam the chime
  pet.classList.remove(...ACT_CLASSES);
  void pet.offsetWidth; // restart so rapid pokes re-trigger the wiggle
  pet.classList.add('act-wiggle');

  // A few pets in a row -> gush hearts + a sweeter line; otherwise a small boop.
  if (pokeStreak >= 4) {
    burst('heart', 4 + Math.min(pokeStreak, 6));
    say(LOVE_LINES[(Math.random() * LOVE_LINES.length) | 0], 1800);
  } else {
    burst('heart', 2);
    say(POKE_LINES[(Math.random() * POKE_LINES.length) | 0], 1800);
  }

  // Showered with affection -> the pet pops on a little party hat as a reward.
  if (pokeStreak >= 7) partyHat();

  clearTimeout(happyResetTimer);
  happyResetTimer = setTimeout(() => {
    pet.classList.remove('act-wiggle');
    if (activeAis.size) renderFromActiveAis();
    else setMood('idle');
  }, 1500);
}

// Party hat as a reward for an enthusiastic petting spree. Stays on a few
// seconds, refreshing if you keep going, then tips off with a sparkle.
let partyTimer = null;
function partyHat() {
  if (!pet.classList.contains('party')) burst('sparkle', 5);
  pet.classList.add('party');
  clearTimeout(partyTimer);
  partyTimer = setTimeout(() => pet.classList.remove('party'), 4500);
}

window.petAPI.onClick(() => react());

// ---------------------------------------------------------------------------
// Easter eggs: double-click does a delighted spin; the Konami code goes rainbow.
// (Keyboard events only reach the pet while its window has focus — click it
//  first. Double-click works any time the cursor is over the pet.)
// ---------------------------------------------------------------------------
const DBL_LINES = ['wheee!', 'spinny!', 'again again!', '★彡', 'dizzy~ 🌀'];
zone.addEventListener('dblclick', (e) => {
  e.preventDefault();
  lastInteraction = Date.now();
  clearTimeout(happyResetTimer);
  pet.classList.remove(...ACT_CLASSES);
  void pet.offsetWidth;
  pet.classList.add('act-spin');
  burst('sparkle', 6);
  setMood('happy', { silent: true });
  say(DBL_LINES[(Math.random() * DBL_LINES.length) | 0], 1600);
  happyResetTimer = setTimeout(() => {
    pet.classList.remove('act-spin');
    if (activeAis.size) renderFromActiveAis();
    else setMood('idle');
  }, 1500);
});

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'
];
let konamiPos = 0;
let rainbowTimer = null;
window.addEventListener('keydown', (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  konamiPos = key === KONAMI[konamiPos] ? konamiPos + 1 : (key === KONAMI[0] ? 1 : 0);
  if (konamiPos === KONAMI.length) {
    konamiPos = 0;
    partyHat();
    pet.classList.add('rainbow');
    burst('sparkle', 12);
    burst('heart', 6);
    say('🌈 WOOHOO! 🌈', 3000);
    clearTimeout(rainbowTimer);
    rainbowTimer = setTimeout(() => pet.classList.remove('rainbow'), 8000);
  }
});

// ---------------------------------------------------------------------------
// Being carried: while you drag the pet around it kicks its legs and beams.
// ---------------------------------------------------------------------------
const CARRY_LINES = ['wheee~', 'whooaa!', 'flying! 🛸', 'where to?', '*giggles*'];
window.petAPI.onGrab(() => {
  lastInteraction = Date.now();
  clearTimeout(happyResetTimer);
  pet.classList.remove(...ACT_CLASSES);
  setSource('');
  setMood('happy', { silent: true });
  pet.classList.add('grabbed');
  say(CARRY_LINES[(Math.random() * CARRY_LINES.length) | 0], 4000);
});
window.petAPI.onDrop(() => {
  lastInteraction = Date.now();
  pet.classList.remove('grabbed');
  // Land with a little squish + sparkle, then settle back.
  pet.classList.add('act-stretch');
  burst('sparkle', 2);
  say('hehe~', 1400);
  clearTimeout(happyResetTimer);
  happyResetTimer = setTimeout(() => {
    pet.classList.remove('act-stretch');
    if (activeAis.size) renderFromActiveAis();
    else setMood('idle');
  }, 900);
});

// ---------------------------------------------------------------------------
// Dragging (handled in main; we just signal start/end + keep interactive)
// ---------------------------------------------------------------------------
zone.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  lastInteraction = Date.now();
  window.petAPI.dragStart();
});
window.addEventListener('mouseup', () => window.petAPI.dragEnd());

// ---------------------------------------------------------------------------
// Resizing: scroll the wheel over the pet to make it bigger / smaller.
// (Only fires while the cursor is over the pet, so it never hijacks scrolling.)
// ---------------------------------------------------------------------------
let lastResizeAt = 0;
zone.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    lastInteraction = Date.now();
    // Throttle so a single trackpad flick doesn't race through the whole range.
    const now = Date.now();
    if (now - lastResizeAt < 90) return;
    lastResizeAt = now;
    window.petAPI.resizeStep(e.deltaY < 0 ? 1 : -1);
  },
  { passive: false }
);

// ---------------------------------------------------------------------------
// Click-through toggle: interactive only while cursor is over the pet/bubble.
// (mousemove still fires because main forwards events while ignoring them.)
// ---------------------------------------------------------------------------
function isOverInteractive(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && (zone.contains(el) || bubble.contains(el));
}

// Eyes follow the cursor while idle, so it feels like the pet is watching you.
// Active moods animate the pupils themselves, so we only track during idle.
let lastEyeAt = 0;
function updateEyes(x, y) {
  if (currentMood !== 'idle') {
    pupils.forEach((p) => (p.style.transform = ''));
    return;
  }
  const rect = body.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height * 0.42;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy) || 1;
  const max = 3.2; // how far the pupils can shift, in px
  const ux = ((dx / dist) * max).toFixed(1);
  const uy = ((dy / dist) * max).toFixed(1);
  pupils.forEach((p) => (p.style.transform = `translate(${ux}px, ${uy}px)`));
}

let interactiveNow = false;
window.addEventListener('mousemove', (e) => {
  const over = isOverInteractive(e.clientX, e.clientY);
  if (over !== interactiveNow) {
    interactiveNow = over;
    window.petAPI.setInteractive(over);
  }
  // Throttle the eye tracking — mousemove fires very often.
  const now = Date.now();
  if (now - lastEyeAt > 40) {
    lastEyeAt = now;
    updateEyes(e.clientX, e.clientY);
  }
});

// ---------------------------------------------------------------------------
// Idle behaviors: blinking, occasional hop, sleep after inactivity
// ---------------------------------------------------------------------------
function blink() {
  if (currentMood === 'sleeping') return;
  pet.classList.add('blink');
  setTimeout(() => pet.classList.remove('blink'), 140);
  // schedule next blink at a random interval
  setTimeout(blink, 2200 + Math.random() * 3500);
}
setTimeout(blink, 2000);

// Little things the pet does while it's just sitting around. Each is a CSS
// class added briefly (see .act-* in style.css), except 'chatter' which is a
// quick speech bubble. Weighted so hops/wiggles are common, spins are rare.
const IDLE_LINES = ['hmm~', 'la la la~', '*yawn*', 'still here!', 'boop?', '~ ♪', 'so quiet...'];
const ACT_CLASSES = ['act-hop', 'act-wiggle', 'act-spin', 'act-stretch', 'act-look'];

function doIdleAction() {
  const r = Math.random();
  let action;
  if (r < 0.26) action = 'hop';
  else if (r < 0.44) action = 'wiggle';
  else if (r < 0.6) action = 'look';
  else if (r < 0.74) action = 'stretch';
  else if (r < 0.84) action = 'chatter';
  else if (r < 0.93) action = 'sparkle';
  else action = 'spin';

  if (action === 'chatter') {
    let line = IDLE_LINES[(Math.random() * IDLE_LINES.length) | 0];
    // Now and then the pet introduces itself by its given name.
    if (petName && Math.random() < 0.3) line = `I'm ${petName}! ^_^`;
    say(line, 1800);
    return;
  }

  if (action === 'sparkle') {
    burst('sparkle', 2 + ((Math.random() * 2) | 0));
    return;
  }

  // Clear any leftover action class, then play the new one.
  pet.classList.remove(...ACT_CLASSES);
  const cls = 'act-' + action;
  pet.classList.add(cls);
  setTimeout(() => pet.classList.remove(cls), 1300);
}

// Idle loop: random little actions + fall asleep when left alone.
const SLEEP_AFTER_MS = 30000;
setInterval(() => {
  if (activeAis.size) return;
  // During a focus work block the pet stays awake and attentive; on a break it
  // is already napping and shouldn't be nudged out of it by idle actions.
  if (focusPhase) return;
  const idleFor = Date.now() - lastInteraction;

  if (idleFor > SLEEP_AFTER_MS) {
    if (currentMood !== 'sleeping') {
      setMood('sleeping');
      say('');
    }
    return;
  }

  if (currentMood === 'sleeping') setMood('idle');

  // ~1 in 4 chance of a little idle action each tick
  if (currentMood === 'idle' && Math.random() < 0.25) {
    doIdleAction();
  }
}, 1500);

// Wake on any local interaction handled above; start idle.
setMood('idle');
