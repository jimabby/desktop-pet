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
const dailyBar = document.getElementById('daily-bar');
const dailyCount = document.getElementById('daily-count');
const body = document.querySelector('.body');
const pupils = document.querySelectorAll('.pupil');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const focusPhonesEl = document.querySelector('.focus-phones');

let storedDailyStats = null;
let storedWeeklyStats = null;

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
let lastActiveClear = 0; // when activeAis last transitioned from non-empty to empty
let bubbleTimer = null;
let happyResetTimer = null;
let attentionTimer = null;
let pendingLink = '';
// An unanswered confirm/permission prompt keeps nudging (bounce + re-chime),
// getting more insistent, until you answer it or a new AI event arrives.
let confirmPending = false;
let confirmLevel = 0;
let confirmNudgeTimer = null;
// Unanswered confirms, keyed by source + session (main supplies the key), so
// two sessions can each be waiting without one dismissing the other. The
// newest is the one on screen (confirmInfo).
const pendingConfirms = new Map(); // key -> { text, link, linkText }
const confirmInfo = { key: '', text: '', link: '', linkText: '' };
// Busy assistants, keyed the same way: { key, source, mood, timer, startedAt, ctx }.
const activeAis = new Map();
let muted = false;
// Do-not-disturb, computed in main from the configured window and pushed here
// whenever it flips. The pet keeps working; it just stops making noise and
// stops escalating its nudges.
let quiet = false;

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
  if (typeof s.quiet === 'boolean') {
    quiet = s.quiet;
    // Entering a quiet window shouldn't leave an escalation mid-flight.
    if (quiet) clearTimeout(confirmNudgeTimer);
    else if (confirmPending) scheduleNextNudge();
  }
  if (Number.isFinite(s.ctxMax) && s.ctxMax > 0) ctxMax = s.ctxMax;
  if (s.appearance) applyAppearance(s.appearance);
});

// ---------------------------------------------------------------------------
// Daily + weekly activity bar — hidden when idle; shows task counts when an
// AI is active. Weekly total comes from a rolling 7-day store in main.
// ---------------------------------------------------------------------------
function updateActivityBar() {
  if (activeAis.size === 0) {
    dailyBar.classList.add('hidden');
    return;
  }
  const today = storedDailyStats;
  const weekly = storedWeeklyStats;
  const todayTasks = today ? today.tasks : 0;
  const todayErrors = today ? today.errors : 0;
  const weekTasks = weekly ? weekly.tasks : 0;

  if (todayTasks <= 0 && todayErrors <= 0 && weekTasks <= 0) {
    dailyBar.classList.add('hidden');
    return;
  }

  let text = '';
  if (todayTasks > 0) text = `✓ ${todayTasks} today`;
  // Errors matter even on a day with no completed tasks yet.
  if (todayErrors > 0) text += (text ? '  ' : '') + `⚠ ${todayErrors}`;
  if (weekTasks > todayTasks) {
    text += text ? `  ·  ${weekTasks} this week` : `${weekTasks} this week`;
  }
  dailyCount.textContent = text;
  dailyBar.classList.remove('hidden');
}

window.petAPI.onDailyStats((stats) => {
  storedDailyStats = stats;
  updateActivityBar();
});

window.petAPI.onWeeklyStats((stats) => {
  storedWeeklyStats = stats;
  updateActivityBar();
});

// ---------------------------------------------------------------------------
// Context-usage slider — a thin bar below the pet that fills as the
// conversation's context window fills up. Token counts arrive on each AI
// state as `ctx`.
// ---------------------------------------------------------------------------
let ctxMax = 200000; // overridden by settings (PET_CTX_MAX)

function ringColor(pct) {
  if (pct >= 85) return '#f25b5b'; // red — running low on room
  if (pct >= 60) return '#ffb02e'; // amber — filling up
  return '#59c98a'; // green — plenty of headroom
}

function updateCtxRing() {
  // The session currently driving the pet's mood owns the ring, so two
  // sessions don't make it flicker between their sizes.
  const strongest = strongestActive();
  const lastCtx = strongest ? strongest.ctx : 0;
  // Only show while an AI is actively working — hide completely when idle
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

  // Always show the token label so you can see the session size at a glance
  ctxBarLabel.textContent = `${Math.round(lastCtx / 1000)}k`;
  ctxBarLabel.style.setProperty('--label-color', color);
  ctxBarLabel.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Appearance (name, body color, skin shape, cosmetic, time-of-day) from settings.
// ---------------------------------------------------------------------------
let petName = '';
const SKINS = ['slime', 'kitten', 'puppy'];
const COSMETICS = ['none', 'glasses', 'scarf', 'headphones', 'crown', 'bowtie', 'flower', 'cap'];
let timeOfDayEnabled = true;

function applyAppearance(a) {
  if (typeof a.name === 'string') petName = a.name.trim();
  if (Array.isArray(a.colorStops) && a.colorStops.length === 2) {
    document.documentElement.style.setProperty('--body-1', a.colorStops[0]);
    document.documentElement.style.setProperty('--body-2', a.colorStops[1]);
    pet.style.setProperty('--model-fur', a.color === 'natural' ? 'natural' : a.colorStops[0]);
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

// Sprite art arrives on its own channel, only when it changes (it can be large).
window.petAPI.onSprite((sprite) => applySprite(sprite));

// ---------------------------------------------------------------------------
// Optional sprite-sheet art. When a sprite config is supplied, the CSS-drawn
// character is hidden and a single .sprite layer plays the matching mood row
// (see the `.sprite` rules in style.css). Absent/invalid config => CSS art.
//   sprite = { url, cols, rows, fps?, moods: { idle:{row,frames,fps?}, ... } }
// ---------------------------------------------------------------------------
let spriteCfg = null;
let spriteGeneration = 0;
function applySprite(sprite, verified = false) {
  if (!verified) {
    const generation = ++spriteGeneration;
    if (sprite?.url && typeof Image !== 'undefined') {
      const image = new Image();
      image.onload = () => { if (generation === spriteGeneration) applySprite(sprite, true); };
      image.onerror = () => { if (generation === spriteGeneration) { applySprite(null, true); say('Sprite unavailable — showing drawn pet', 5000); } };
      image.src = sprite.url; return;
    }
  }
  const rootStyle = document.documentElement.style;
  if (!sprite || typeof sprite !== 'object' || typeof sprite.url !== 'string' || !sprite.url) {
    spriteCfg = null;
    pet.classList.remove('has-sprite');
    return;
  }
  spriteCfg = sprite;
  // url() value is built here (not user-typed CSS) and the image must be a
  // same-origin local file under renderer/ — the page CSP blocks remote images.
  rootStyle.setProperty('--sprite-url', `url("${String(sprite.url).replace(/["\\]/g, '')}")`);
  rootStyle.setProperty('--sprite-cols', String(Math.max(1, sprite.cols | 0 || 1)));
  rootStyle.setProperty('--sprite-rows', String(Math.max(1, sprite.rows | 0 || 1)));
  pet.classList.add('has-sprite');
  updateSpriteFrame();
}
function updateSpriteFrame() {
  if (!spriteCfg) return;
  const moods = spriteCfg.moods || {};
  const m = moods[currentMood] || moods.idle || {};
  const frames = Math.max(1, m.frames | 0 || 1);
  const fps = m.fps || spriteCfg.fps || 8;
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--sprite-row', String(Math.max(0, m.row | 0)));
  rootStyle.setProperty('--sprite-frames', String(frames));
  rootStyle.setProperty('--sprite-dur', (frames / fps).toFixed(3) + 's');
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
  if (muted || quiet) return;
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
const STAR_GLYPHS = ['⭐', '🌟', '✨'];
const NOTE_GLYPHS = ['♪', '♫', '♩', '♬'];
const FLOWER_GLYPHS = ['✿', '❀', '🌸', '🌺'];
const GLYPHS = { heart: HEART_GLYPHS, sparkle: SPARKLE_GLYPHS, star: STAR_GLYPHS, note: NOTE_GLYPHS, flower: FLOWER_GLYPHS };

function spawnParticle(type) {
  if (reducedMotion.matches || document.hidden) return;
  const el = document.createElement('span');
  el.className = 'particle ' + type;
  const glyphs = GLYPHS[type] || SPARKLE_GLYPHS;
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
  setTimeout(() => el.remove(), 1600); // also clean up when animations are disabled
}

function burst(type, count) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => spawnParticle(type), i * 80);
  }
}

// ---------------------------------------------------------------------------
// Mood control
// ---------------------------------------------------------------------------
// Flags that describe lasting state (not mood/source) and must survive a mood
// change. Without preserving these, a setMood() would wipe the skin, equipped
// cosmetic, focus glow, party hat, carry wobble, or the confirm-nudge bounce.
const PERSISTENT_FLAGS = [
  'blink', 'attention', 'attention-strong', 'party',
  'grabbed', 'rainbow', 'focusing', 'has-sprite', 'has-model',
  'walking', 'face-left', 'face-right',
  // The task-done flourish outlives the setMood() that triggers it.
  'big-celebrate'
];
function isPersistentClass(c) {
  return (
    c.startsWith('skin-') ||
    c.startsWith('cosmetic-') ||
    c.startsWith('act-') ||
    PERSISTENT_FLAGS.includes(c)
  );
}

function applyClasses() {
  // Keep skins, cosmetics, transient acts, and state flags; only the mood-* and
  // source-* classes are recomputed here.
  const keep = [...pet.classList].filter(isPersistentClass);
  pet.className = 'mood-' + currentMood;
  keep.forEach((c) => pet.classList.add(c));
  if (activeSourceCounts().size > 1) {
    pet.classList.add('source-many');
  } else if (currentSource && KNOWN_SOURCES.includes(currentSource)) {
    pet.classList.add('source-' + currentSource);
  }
  reportState();
}

// Tell main what the pet is up to, only when it changes. Main uses it to
// decide whether wandering off is appropriate.
let lastReported = '';
function reportState() {
  const st = {
    mood: currentMood,
    busy: activeAis.size > 0,
    confirm: confirmPending,
    reducedMotion: reducedMotion.matches
  };
  const sig = JSON.stringify(st);
  if (sig === lastReported) return;
  lastReported = sig;
  window.petAPI.reportState(st);
}

function setMood(mood, { silent = false } = {}) {
  if (!MOODS.includes(mood)) mood = 'idle';
  const changed = mood !== currentMood;
  currentMood = mood;
  applyClasses();
  updateSpriteFrame();
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
  pendingLink = link || '';
  if (!text && !link) {
    bubble.classList.add('hidden');
    return;
  }
  bubbleText.textContent = text || '';

  // Optional clickable link (e.g. "jump back to the editor to confirm").
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
    else setMood(focusPhase === 'break' ? 'sleeping' : 'idle');
  }, 8000);
}

// The bubble text for the confirm on screen, noting any others still waiting.
function confirmBubbleText() {
  const more = pendingConfirms.size - 1;
  return confirmInfo.text + (more > 0 ? ` (+${more} more waiting)` : '');
}

function sayConfirm(ms = 60000) {
  say(confirmBubbleText(), ms, confirmInfo.link, confirmInfo.linkText);
}

// Put the newest waiting confirm on screen.
function showLatestConfirm() {
  const [key, c] = [...pendingConfirms].pop();
  Object.assign(confirmInfo, { key }, c);
}

// One session's prompt was answered. Returns true while others still wait
// (the newest of them is then on screen).
function resolveConfirm(key) {
  pendingConfirms.delete(key);
  if (!pendingConfirms.size) return false;
  showLatestConfirm();
  return true;
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

// After this many rounds the pet stops chiming and re-popping the bubble. It
// stays visibly flagged (bouncing, stressed) so the prompt isn't forgotten, but
// a confirm you've deliberately left sitting stops making noise every 8s.
const MAX_LOUD_NUDGES = 6;

function scheduleNextNudge() {
  clearTimeout(confirmNudgeTimer);
  // During do-not-disturb the pet still shows it's waiting (stressed, bubble up)
  // but never escalates: no re-chime, no bigger bounce, no re-popped bubble.
  if (quiet) return;
  if (confirmLevel >= MAX_LOUD_NUDGES) return; // gone quiet; pet stays flagged
  // First re-nudge after ~14s, then a touch sooner each round (min 8s).
  const delay = Math.max(8000, 16000 - confirmLevel * 1500);
  confirmNudgeTimer = setTimeout(() => {
    if (!confirmPending) return;
    confirmLevel++;
    pet.classList.add('attention');
    pet.classList.toggle('attention-strong', confirmLevel >= 3); // bigger bounce
    setMood('stressed', { silent: true });
    playSound('attention');
    if (confirmInfo.text) sayConfirm(18000);
    scheduleNextNudge();
  }, delay);
}

// Stop nudging (answered, poked, or a new AI event arrived). restore=true puts
// the pet back to a sensible mood; pass false when the caller sets it next.
// Also forgets every waiting confirm: callers use it when all of them are
// answered or acknowledged at once.
function stopConfirmNudge({ restore = true } = {}) {
  const wasActive = confirmPending || confirmNudgeTimer;
  pendingConfirms.clear();
  confirmPending = false;
  confirmLevel = 0;
  clearTimeout(confirmNudgeTimer);
  confirmNudgeTimer = null;
  clearTimeout(attentionTimer);
  pet.classList.remove('attention', 'attention-strong');
  if (wasActive && restore) {
    if (activeAis.size) renderFromActiveAis();
    else setMood(focusPhase === 'break' ? 'sleeping' : 'idle');
  }
  reportState();
}

// Open the pending link. Only ever called from a deliberate click on the
// bubble's link element — never from a poke or any other incidental gesture.
function openPendingLink() {
  if (!pendingLink) return false;
  window.petAPI.acknowledge(confirmInfo.key);
  window.petAPI.openLink(pendingLink);
  pendingLink = '';
  bubbleLink.classList.add('hidden');
  answeredConfirm(confirmInfo.key);
  return true;
}

// The confirm on screen (or the one main says the hotkey answered) is being
// dealt with. Move on to the next waiting one, or settle down if none are left.
function answeredConfirm(key) {
  if (pendingConfirms.has(key) && resolveConfirm(key)) {
    setTimeout(() => {
      if (confirmPending) sayConfirm();
    }, 1500);
    say('on my way! 🚀', 1500);
    return;
  }
  stopConfirmNudge({ restore: true });
  say('on my way! 🚀', 1500);
}

window.petAPI.onConfirmAck((key) => {
  if (pendingConfirms.has(key)) answeredConfirm(key);
});

bubbleLink.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openPendingLink();
  }
});

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

// Busy sessions per assistant, e.g. { claude: 2, chatgpt: 1 }.
function activeSourceCounts() {
  const counts = new Map();
  activeAis.forEach((a) => counts.set(a.source, (counts.get(a.source) || 0) + 1));
  return counts;
}

function summarizeActiveAis() {
  const counts = activeSourceCounts();
  const sources = [...counts].map(([s, n]) => (n > 1 ? `${sourceName(s)} ×${n}` : sourceName(s)));
  if (sources.length === 0) return '';
  if (sources.length === 1) {
    return activeAis.size === 1 ? `${sources[0]} is ${currentMood}...` : `${sources[0]} are busy...`;
  }
  if (sources.length === 2) return `${sources[0]} + ${sources[1]} are teaming up...`;
  return `${sources.slice(0, 3).join(' + ')} are working together...`;
}

// One badge per assistant, with a session count when it has several going.
function renderBadges() {
  aiBadges.replaceChildren();
  if (activeAis.size === 0) {
    aiBadges.classList.add('hidden');
    return;
  }

  aiBadges.classList.remove('hidden');
  [...activeSourceCounts()].slice(0, 4).forEach(([source, n]) => {
    const badge = document.createElement('span');
    badge.className = `ai-badge source-${source}`;
    const label = SOURCE_LABELS[source] || sourceName(source).slice(0, 3);
    badge.textContent = n > 1 ? `${label}×${n}` : label;
    badge.title = n > 1 ? `${sourceName(source)} — ${n} sessions` : sourceName(source);
    aiBadges.appendChild(badge);
  });
}

function removeActiveAi(key) {
  const active = activeAis.get(key);
  if (active && active.timer) clearTimeout(active.timer);
  activeAis.delete(key);
  renderFromActiveAis();
}

// The busiest session (ties go to the most recently updated).
function strongestActive() {
  let strongest = null;
  activeAis.forEach((active) => {
    if (!strongest || MOOD_PRIORITY[active.mood] >= MOOD_PRIORITY[strongest.mood]) {
      strongest = active;
    }
  });
  return strongest;
}

function renderFromActiveAis() {
  renderBadges();
  updateCtxRing();
  updateActivityBar();
  reportState();
  if (confirmPending) return;
  if (activeAis.size === 0) {
    lastActiveClear = Date.now(); // sleep timer starts from here, not last hook event
    setSource('');
    setMood(focusPhase === 'break' ? 'sleeping' : 'idle');
    flushNotice();
    return;
  }

  const strongest = strongestActive();
  setSource(activeSourceCounts().size > 1 ? 'many' : strongest.source);
  setMood(strongest.mood);
}

// ---------------------------------------------------------------------------
// Incoming AI state (from the local control server, via main process)
// ---------------------------------------------------------------------------
window.petAPI.onAiState((state) => {
  if (state.suppressed) return;
  cancelReaction();
  stopWalking();
  lastInteraction = Date.now();
  const source = normalizeSource(state.source);
  const key = state.key || `${source}|${state.session || ''}`;
  const prefix = state.source ? `${sourceName(source)}: ` : '';
  const goingIdle = state.mood === 'idle';
  const isConfirm = state.event ? state.event === 'confirm' : !!(state.attention || state.link);
  // Set when a session finishes a timed task, e.g. " · 2m 13s"; appended to the
  // "done!" bubble so you can see how long the AI took.
  let finishedSuffix = '';

  // Any other event from a session means its pending confirm was answered (or
  // superseded). Other sessions' prompts keep waiting. An idle with no session
  // clears the whole source; one with no source clears everything.
  const confirmShownBefore = confirmInfo.key;
  const hadPendingConfirm = confirmPending;
  if (!isConfirm) {
    if (goingIdle && !state.source) pendingConfirms.clear();
    else if (goingIdle && !state.session) {
      [...pendingConfirms.keys()].filter((k) => k.startsWith(source + '|')).forEach((k) => pendingConfirms.delete(k));
    } else pendingConfirms.delete(key);
    if (pendingConfirms.size) showLatestConfirm();
    else {
      stopConfirmNudge({ restore: false });
      if (hadPendingConfirm) say('');
    }
  }

  if (goingIdle) {
    const clear = (k) => {
      const a = activeAis.get(k);
      if (a && a.timer) clearTimeout(a.timer);
      activeAis.delete(k);
    };
    if (!state.source) [...activeAis.keys()].forEach(clear);
    else if (!state.session) {
      [...activeAis].filter(([, a]) => a.source === source).forEach(([k]) => clear(k));
    } else clear(key);
    renderFromActiveAis();
  } else {
    const previous = activeAis.get(key);
    if (previous && previous.timer) clearTimeout(previous.timer);
    const mood = MOODS.includes(state.mood) ? state.mood : 'thinking';

    // Time the task: remember when this session first started being busy, and
    // carry that start time across refreshes. When it lands on "happy" (done)
    // we can report how long it ran.
    let startedAt = previous ? previous.startedAt : 0;
    if (BUSY_MOODS.has(mood) && !startedAt) startedAt = Date.now();
    if (mood === 'happy' && previous && previous.startedAt) {
      const elapsed = Date.now() - previous.startedAt;
      if (elapsed > 4000) finishedSuffix = ` · ${formatDuration(elapsed)}`;
      startedAt = 0; // reset for the next task
    }

    const ctx = Number.isFinite(state.ctx) && state.ctx > 0 ? state.ctx : previous ? previous.ctx : 0;
    const active = { key, source, mood, timer: null, startedAt, ctx };
    if (state.ttl && state.ttl > 0) {
      active.timer = setTimeout(() => removeActiveAi(key), state.ttl);
    }
    // Re-insert so the most recently active session wins ties.
    activeAis.delete(key);
    activeAis.set(key, active);
    renderFromActiveAis();

    // Big task-done celebration: flowers + stars when an AI finishes a real task.
    if (mood === 'happy' && previous && BUSY_MOODS.has(previous.mood)) {
      pet.classList.add('big-celebrate');
      burst('flower', 4);
      burst('star', 4);
      setTimeout(() => burst('sparkle', 6), 180);
      setTimeout(() => burst('flower', 2), 400);
      setTimeout(() => pet.classList.remove('big-celebrate'), 800);
    }
  }

  if (isConfirm) {
    // A confirm/permission prompt. The link (jump back to the editor or
    // terminal) is optional — the bounce + chime fire either way.
    const alreadyPending = pendingConfirms.has(key);
    pendingConfirms.delete(key);
    pendingConfirms.set(key, {
      text: prefix + (state.text || 'needs you to confirm'),
      link: state.link || '',
      linkText: state.linkText || ''
    });
    showLatestConfirm();
    sayConfirm(state.ttl || 60000);
    if (!alreadyPending) {
      attention();
      startConfirmNudge(); // keep nudging until it's answered
    }
  } else if (confirmPending) {
    // Another session is still waiting on you: keep its prompt on screen
    // rather than covering it with this session's chatter.
    if (confirmInfo.key !== confirmShownBefore) sayConfirm();
  } else if (state.text) {
    say(prefix + state.text + finishedSuffix, state.ttl || 6000);
  } else if (goingIdle) {
    say(activeAis.size ? summarizeActiveAis() : '');
  } else if (activeSourceCounts().size > 1) {
    say(summarizeActiveAis(), 4500);
  }
});

// ---------------------------------------------------------------------------
// A transient celebratory bubble from main (e.g. "unlocked the crown!"), shown
// without disturbing whatever mood the pet is currently in.
// ---------------------------------------------------------------------------
let deferredNotice = '';
function flushNotice() {
  if (!deferredNotice || confirmPending || activeAis.size || focusPhase) return;
  const text = deferredNotice; deferredNotice = '';
  say(text, 4000);
}
window.petAPI.onNotice((text) => {
  if (!text) return;
  if (confirmPending || activeAis.size || focusPhase) { deferredNotice = String(text); return; }
  lastInteraction = Date.now();
  burst('sparkle', 5);
  say(String(text), 4000);
});

// ---------------------------------------------------------------------------
// Focus mode (Pomodoro) — main runs the timer and tells us when the phase
// changes. The pet cheers at the start of a work block and naps on breaks.
// ---------------------------------------------------------------------------
let focusPhase = null; // 'work' | 'break' | null
let focusNoteTimer = null;

function startFocusNotes() {
  clearInterval(focusNoteTimer);
  // Spawn a floating music note every ~2.8s while in focus work mode.
  focusNoteTimer = setInterval(() => {
    if (focusPhase === 'work') spawnParticle('note');
  }, 2800);
}
function stopFocusNotes() {
  clearInterval(focusNoteTimer);
  focusNoteTimer = null;
}

function showFocusPhones(show) {
  if (focusPhonesEl) focusPhonesEl.classList.toggle('active', show);
}

window.petAPI.onFocus((f) => {
  cancelReaction();
  focusPhase = f && f.phase ? f.phase : null;
  lastInteraction = Date.now();
  if (confirmPending || activeAis.size) {
    pet.classList.toggle('focusing', focusPhase === 'work');
    showFocusPhones(focusPhase === 'work');
    if (focusPhase === 'work') startFocusNotes(); else stopFocusNotes();
    return;
  }
  if (focusPhase === 'work') {
    pet.classList.add('focusing');
    showFocusPhones(true);
    setSource('');
    setMood('happy', { silent: true });
    say(`focus time! ${f.minutes || 25}m 💪`, 3000);
    burst('note', 3);
    startFocusNotes();
    clearTimeout(happyResetTimer);
    happyResetTimer = setTimeout(() => {
      if (activeAis.size) renderFromActiveAis();
      else setMood('idle');
    }, 1500);
  } else if (focusPhase === 'break') {
    stopFocusNotes();
    showFocusPhones(false);
    pet.classList.remove('focusing');
    setMood('sleeping');
    say(`break — back in ${f.minutes || 5}m 😴`, 4000);
  } else {
    stopFocusNotes();
    showFocusPhones(false);
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
  '*happy sigh*',
  'boop!',
  'i missed you',
  '^_^'
];
// Said when you keep petting — the pet warms up the more you poke it.
const LOVE_LINES = ['hehe that tickles!', 'more more~', "you're the best!", 'I love you! 💕', '*happy sigh*'];

// Track how fast you're poking so repeated pets escalate into a heart shower.
let pokeStreak = 0;
let pokeStreakTimer = null;

function react() {
  cancelReaction();
  lastInteraction = Date.now();

  // A poke acknowledges a waiting confirm — it stops the pet pestering you —
  // but deliberately does NOT open its link. Anything that can reach the
  // control server can choose that URL, so opening it on an incidental poke
  // would make one stray click enough to follow a link nobody read. The link
  // stays on screen instead, one deliberate click away.
  const hadConfirm = confirmPending || !!pendingLink;
  if (hadConfirm) {
    const link = pendingLink;
    window.petAPI.acknowledge(confirmInfo.key);
    answeredConfirm(confirmInfo.key);
    if (pendingConfirms.size) return;
    stopConfirmNudge({ restore: true });
    if (link) say(confirmInfo.text || 'still waiting on you', 15000, link, confirmInfo.linkText);
    return;
  }

  window.petAPI.affection();
  pokeStreak++;
  clearTimeout(pokeStreakTimer);
  pokeStreakTimer = setTimeout(() => (pokeStreak = 0), 1400);

  setSource('');
  setMood('happy', { silent: true }); // poking shouldn't spam the chime
  pet.classList.remove(...ACT_CLASSES);
  void pet.offsetWidth; // restart so rapid pokes re-trigger the wiggle
  pet.classList.add(pet.classList.contains('has-model') && !pet.classList.contains('has-sprite') ? 'act-petting' : 'act-wiggle');

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
    pet.classList.remove('act-wiggle', 'act-petting');
    if (activeAis.size) renderFromActiveAis();
    else setMood(focusPhase === 'break' ? 'sleeping' : 'idle');
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
  if (confirmPending || pendingLink || pet.classList.contains('grabbed')) return;
  lastInteraction = Date.now();
  cancelReaction();
  pet.classList.remove(...ACT_CLASSES);
  void pet.offsetWidth;
  pet.classList.add('act-spin');
  burst('sparkle', 6);
  setMood('happy', { silent: true });
  say(DBL_LINES[(Math.random() * DBL_LINES.length) | 0], 1600);
  happyResetTimer = setTimeout(() => {
    pet.classList.remove('act-spin');
    if (activeAis.size) renderFromActiveAis();
    else setMood(focusPhase === 'break' ? 'sleeping' : 'idle');
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
  if (confirmPending) { pet.classList.add('grabbed'); return; }
  cancelReaction();
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
  if (confirmPending) { sayConfirm(); return; }
  // Land with a little squish + sparkle, then settle back.
  pet.classList.add('act-stretch');
  burst('sparkle', 2);
  say('hehe~', 1400);
  clearTimeout(happyResetTimer);
  happyResetTimer = setTimeout(() => {
    pet.classList.remove('act-stretch');
    if (activeAis.size) renderFromActiveAis();
    else setMood(focusPhase === 'break' ? 'sleeping' : 'idle');
  }, 900);
});

// ---------------------------------------------------------------------------
// Tricks — perform on demand (tray ▸ Tricks, or a wave hello when shown). Each
// is a CSS act-* class played briefly with a matching line + little flourish.
// ---------------------------------------------------------------------------
const TRICK_ACT = { dance: 'act-dance', flip: 'act-flip', wave: 'act-wave', spin: 'act-spin',
  yawn: 'act-yawn', curious: 'act-curious', shake: 'act-shake', kiss: 'act-kiss',
  sniff: 'act-sniff', paw: 'act-paw', groom: 'act-groom' };
const TRICK_LINES = {
  sniff: ['*sniff sniff*', 'something interesting?'],
  paw: ['a paw for you!', 'high five!'],
  groom: ['*tidy tidy*', 'looking my best~'],
  yawn: ['*yaaawn*', 'big stretch~'],
  curious: ['what’s that?', 'hmm? 👀'],
  shake: ['*shake shake*', 'all fluffed up!'],
  kiss: ['mwah! ♥', 'a little love for you~'],
  dance: ['💃 woo!', '~ ♪ ~', 'dance party!', 'feel the beat!'],
  flip: ['hup!', 'ta-da! 🤸', 'nailed it!', 'did you see that?!'],
  wave: ['hi there!', 'hellooo~', 'hey you! 👋', '*waves*'],
  spin: ['wheee!', 'spinny!', '🌀', 'so dizzy~']
};

function playTrick(name) {
  if (confirmPending || pendingLink || pet.classList.contains('grabbed')) return;
  cancelReaction();
  if (!TRICK_ACT[name]) name = 'dance';
  lastInteraction = Date.now();
  clearTimeout(happyResetTimer);
  stopConfirmNudge({ restore: false });
  pet.classList.remove(...ACT_CLASSES);
  setSource('');
  setMood('happy', { silent: true });
  void pet.offsetWidth; // restart so a repeat trick re-triggers
  pet.classList.add(TRICK_ACT[name]);
  burst(name === 'kiss' ? 'heart' : name === 'dance' ? 'note' : 'sparkle', name === 'flip' ? 6 : 4);
  const lines = TRICK_LINES[name];
  say(lines[(Math.random() * lines.length) | 0], 1800);
  happyResetTimer = setTimeout(() => {
    pet.classList.remove(TRICK_ACT[name]);
    if (activeAis.size) renderFromActiveAis();
    else setMood(focusPhase === 'break' ? 'sleeping' : 'idle');
  }, name === 'flip' ? 1000 : 1700);
}
window.petAPI.onTrick((name) => playTrick(name));

// ---------------------------------------------------------------------------
// Dragging (handled in main; we just signal start/end + keep interactive)
// ---------------------------------------------------------------------------
// While a drag is in progress the window must keep receiving mouse events:
// if a fast flick put the cursor outside the pet and we turned click-through
// back on, the mouseup would go to the app underneath and the pet would stay
// stuck to the cursor.
let dragging = false;
function endDrag() {
  dragging = false;
  window.petAPI.dragEnd();
}
zone.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  lastInteraction = Date.now();
  dragging = true;
  stopWalking();
  window.petAPI.dragStart();
});
window.addEventListener('mouseup', endDrag);
// Belt and braces: losing focus mid-drag (e.g. a system dialog) ends it too.
window.addEventListener('blur', () => {
  if (dragging) endDrag();
});

// Right-click the pet for the play menu (tricks, focus, settings).
zone.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  lastInteraction = Date.now();
  window.petAPI.openMenu();
});

// ---------------------------------------------------------------------------
// Walking: main moves the window when the pet wanders and tells us which way
// and for how long, so the pet walks facing where it's going instead of
// gliding.
// ---------------------------------------------------------------------------
let walkTimer = null;
function stopWalking() {
  clearTimeout(walkTimer);
  walkTimer = null;
  pet.classList.remove('walking', 'face-left', 'face-right');
}
window.petAPI.onWalk((w) => {
  if (!w || currentMood !== 'idle' || activeAis.size || confirmPending) return;
  cancelReaction();
  stopWalking();
  pet.classList.add('walking', w.dir === 'left' ? 'face-left' : 'face-right');
  walkTimer = setTimeout(stopWalking, Math.max(300, Math.min(4000, Number(w.ms) || 1200)));
});

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

// Hover-to-tickle: rest the cursor on the pet for a moment (without clicking)
// and it giggles. Once per hover, and only when it isn't busy or being summoned
// for a confirm — so it never gets in the way of real work.
const TICKLE_LINES = ['hehe~', 'that tickles!', '*giggle*', 'eep!', '^_^', 'hihi~'];
let tickleTimer = null;
let tickledThisHover = false;

function startTickleDwell() {
  tickledThisHover = false;
  clearTimeout(tickleTimer);
  tickleTimer = setTimeout(maybeTickle, 1400);
}
function cancelTickleDwell() {
  clearTimeout(tickleTimer);
  tickleTimer = null;
}
function maybeTickle() {
  if (!interactiveNow || tickledThisHover) return;
  if (confirmPending || activeAis.size || focusPhase || pet.classList.contains('grabbed')) return; // stay out of the way
  cancelReaction();
  tickledThisHover = true;
  lastInteraction = Date.now();
  if (currentMood === 'sleeping') setMood('idle'); // hovering gently wakes it
  burst('heart', 2);
  pet.classList.remove(...ACT_CLASSES);
  void pet.offsetWidth;
  pet.classList.add('act-wiggle');
  idleActionTimer = setTimeout(() => {
    pet.classList.remove('act-wiggle');
    idleActionTimer = null;
  }, 700);
  say(TICKLE_LINES[(Math.random() * TICKLE_LINES.length) | 0], 1400);
}

let interactiveNow = false;
window.addEventListener('mousemove', (e) => {
  const over = isOverInteractive(e.clientX, e.clientY);
  if (over !== interactiveNow && !(dragging && !over)) {
    interactiveNow = over;
    window.petAPI.setInteractive(over);
    if (over) startTickleDwell();
    else cancelTickleDwell();
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
  // A sleeping pet keeps its eyes shut — but the loop must still reschedule,
  // otherwise blinking stops for good the first time the pet nods off.
  if (currentMood !== 'sleeping' && !reducedMotion.matches) {
    pet.classList.add('blink');
    setTimeout(() => pet.classList.remove('blink'), 140);
  }
  // schedule next blink at a random interval
  setTimeout(blink, 2200 + Math.random() * 3500);
}
setTimeout(blink, 2000);

// Little things the pet does while it's just sitting around. Each is a CSS
// class added briefly (see .act-* in style.css), except 'chatter' which is a
// quick speech bubble. Weighted so hops/wiggles are common, spins are rare.
const IDLE_LINES = ['hmm~', 'la la la~', '*yawn*', 'still here!', 'boop?', '~ ♪', 'so quiet...'];
const ACT_CLASSES = [
  'act-hop', 'act-wiggle', 'act-spin', 'act-stretch', 'act-look',
  'act-petting', 'act-sniff', 'act-paw', 'act-groom',
  'act-dance', 'act-flip', 'act-wave', 'act-yawn', 'act-curious', 'act-shake', 'act-kiss'
];

let idleActionTimer = null;
let lastIdleAction = '';
function cancelReaction() {
  clearTimeout(happyResetTimer);
  clearTimeout(idleActionTimer);
  idleActionTimer = null;
  pet.classList.remove(...ACT_CLASSES);
}

function performIdleAction(action, duration = 1700) {
  cancelReaction();
  lastIdleAction = action;
  pet.classList.add('act-' + action);
  idleActionTimer = setTimeout(() => {
    pet.classList.remove('act-' + action);
    idleActionTimer = null;
  }, duration);
}

function doIdleAction() {
  const choices = pet.classList.contains('has-model') && !pet.classList.contains('has-sprite')
    ? ['sniff', 'groom', 'paw', 'curious', 'yawn', 'look', 'chatter']
    : ['hop', 'wiggle', 'look', 'stretch', 'chatter', 'sparkle',
    'curious', 'curious', 'shake', 'kiss'];
  const pool = choices.filter((action) => action !== lastIdleAction);
  const action = pool[Math.floor(Math.random() * pool.length)];
  lastIdleAction = action;

  if (action === 'chatter') {
    let line = IDLE_LINES[(Math.random() * IDLE_LINES.length) | 0];
    // Now and then the pet introduces itself by its given name.
    if (petName && Math.random() < 0.3) line = `I'm ${petName}! ^_^`;
    say(line, 1800);
    return;
  }

  if (action === 'sparkle') {
    // A burst of sparkles, or now and then a shower of stars instead.
    burst(Math.random() < 0.3 ? 'star' : 'sparkle', 2 + ((Math.random() * 2) | 0));
    return;
  }

  performIdleAction(action);
}

// Idle loop: random little actions + fall asleep when left alone.
const SLEEP_AFTER_MS = 30000;
setInterval(() => {
  if (activeAis.size || confirmPending || pendingLink || document.hidden ||
      pet.classList.contains('grabbed') || pet.classList.contains('walking')) return;
  // During a focus work block the pet stays awake and attentive; on a break it
  // is already napping and shouldn't be nudged out of it by idle actions.
  if (focusPhase) return;
  // Use whichever is more recent: last user/AI event, or when the active AI
  // cleared. Without lastActiveClear, the pet can sleep immediately after a
  // TTL fires (TTL=45s > SLEEP_AFTER_MS=30s, so 45s since last hook event
  // looks like "already been idle too long" even mid-task).
  const idleFor = Date.now() - Math.max(lastInteraction, lastActiveClear);

  if (idleFor > SLEEP_AFTER_MS) {
    if (currentMood !== 'sleeping') {
      cancelReaction();
      setMood('sleeping');
      say('');
    }
    return;
  }

  if (currentMood === 'sleeping') setMood('idle');

  if (!quiet && !reducedMotion.matches && idleFor > SLEEP_AFTER_MS - 4000 && currentMood === 'idle') {
    if (lastIdleAction !== 'yawn') performIdleAction('yawn', 3000);
    return;
  }
  if (idleActionTimer || quiet || reducedMotion.matches) return;

  // ~1 in 4 chance of a little idle action each tick
  if (currentMood === 'idle' && Math.random() < 0.25) {
    doIdleAction();
  }
}, 1500);

pet.addEventListener('model-error', () => say('3D unavailable — showing drawn pet', 5000));

// Wake on any local interaction handled above; start idle.
setMood('idle');
