'use strict';

const pet = document.getElementById('pet');
const zone = document.getElementById('pet-zone');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleLink = document.getElementById('bubble-link');
const aiBadges = document.getElementById('ai-badges');

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
const activeAis = new Map();
let muted = false;

// Known AI sources get their own tint; anything else falls back to default.
const KNOWN_SOURCES = ['claude', 'chatgpt', 'gemini', 'deepseek'];
const SOURCE_LABELS = {
  claude: 'C',
  chatgpt: 'GPT',
  gemini: 'Gem',
  deepseek: 'D'
};

// ---------------------------------------------------------------------------
// Settings from main (mute toggle)
// ---------------------------------------------------------------------------
window.petAPI.onSettings((s) => {
  if (typeof s.muted === 'boolean') muted = s.muted;
});

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

// Open the pending link (clicking the bubble link, or the pet while one is up).
function openPendingLink() {
  if (!pendingLink) return false;
  window.petAPI.openLink(pendingLink);
  pendingLink = '';
  bubbleLink.classList.add('hidden');
  pet.classList.remove('attention');
  clearTimeout(attentionTimer);
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

  if (goingIdle) {
    if (state.source) {
      removeActiveAi(source);
    } else {
      activeAis.forEach((active) => {
        if (active.timer) clearTimeout(active.timer);
      });
      activeAis.clear();
      renderFromActiveAis();
    }
  } else {
    const previous = activeAis.get(source);
    if (previous && previous.timer) clearTimeout(previous.timer);
    const active = {
      source,
      mood: MOODS.includes(state.mood) ? state.mood : 'thinking',
      timer: null
    };
    if (state.ttl && state.ttl > 0) {
      active.timer = setTimeout(() => removeActiveAi(source), state.ttl);
    }
    activeAis.set(source, active);
    renderFromActiveAis();
  }

  if (state.link) {
    // A confirm/permission prompt: show the message + a link back to the editor.
    const prefix = state.source ? `${state.source}: ` : '';
    say(prefix + (state.text || 'needs you to confirm'), state.ttl || 60000, state.link, state.linkText);
    attention();
  } else if (state.text) {
    const prefix = state.source ? `${state.source}: ` : '';
    say(prefix + state.text, state.ttl || 6000);
  } else if (goingIdle) {
    say(activeAis.size ? summarizeActiveAis() : '');
  } else if (activeAis.size > 1) {
    say(summarizeActiveAis(), 4500);
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

function react() {
  lastInteraction = Date.now();
  // If a confirm prompt is waiting, a poke opens the editor instead of playing.
  if (openPendingLink()) return;
  setSource('');
  setMood('happy', { silent: true }); // poking shouldn't spam the chime
  say(POKE_LINES[(Math.random() * POKE_LINES.length) | 0], 1800);
  clearTimeout(happyResetTimer);
  happyResetTimer = setTimeout(() => {
    if (activeAis.size) renderFromActiveAis();
    else setMood('idle');
  }, 1500);
}

window.petAPI.onClick(() => react());

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
let interactiveNow = false;
window.addEventListener('mousemove', (e) => {
  const over = isOverInteractive(e.clientX, e.clientY);
  if (over !== interactiveNow) {
    interactiveNow = over;
    window.petAPI.setInteractive(over);
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
  if (r < 0.3) action = 'hop';
  else if (r < 0.5) action = 'wiggle';
  else if (r < 0.68) action = 'look';
  else if (r < 0.83) action = 'stretch';
  else if (r < 0.92) action = 'chatter';
  else action = 'spin';

  if (action === 'chatter') {
    say(IDLE_LINES[(Math.random() * IDLE_LINES.length) | 0], 1800);
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
