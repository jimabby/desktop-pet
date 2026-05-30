'use strict';

const pet = document.getElementById('pet');
const zone = document.getElementById('pet-zone');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');

const MOODS = ['idle', 'thinking', 'working', 'happy', 'sleeping', 'error'];

let currentMood = 'idle';
let lastInteraction = Date.now();
let ttlTimer = null;
let bubbleTimer = null;
let happyResetTimer = null;
let aiActive = false; // an AI is driving the pet right now

// ---------------------------------------------------------------------------
// Mood control
// ---------------------------------------------------------------------------
function setMood(mood) {
  if (!MOODS.includes(mood)) mood = 'idle';
  currentMood = mood;
  pet.className = '';
  pet.classList.add('mood-' + mood);
}

function say(text, ms = 4000) {
  clearTimeout(bubbleTimer);
  if (!text) {
    bubble.classList.add('hidden');
    return;
  }
  bubbleText.textContent = text;
  bubble.classList.remove('hidden');
  // restart pop animation
  bubble.style.animation = 'none';
  void bubble.offsetWidth;
  bubble.style.animation = '';
  if (ms > 0) {
    bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms);
  }
}

// ---------------------------------------------------------------------------
// Incoming AI state (from the local control server, via main process)
// ---------------------------------------------------------------------------
window.pet.onAiState((state) => {
  lastInteraction = Date.now();
  clearTimeout(ttlTimer);

  const goingIdle = state.mood === 'idle';
  aiActive = !goingIdle;

  setMood(state.mood);

  if (state.text) {
    const prefix = state.source ? `${state.source}: ` : '';
    say(prefix + state.text, state.ttl || 6000);
  } else if (goingIdle) {
    say('');
  }

  if (state.ttl && state.ttl > 0 && !goingIdle) {
    ttlTimer = setTimeout(() => {
      aiActive = false;
      setMood('idle');
      say('');
    }, state.ttl);
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
  setMood('happy');
  say(POKE_LINES[(Math.random() * POKE_LINES.length) | 0], 1800);
  clearTimeout(happyResetTimer);
  happyResetTimer = setTimeout(() => {
    if (!aiActive) setMood('idle');
  }, 1500);
}

window.pet.onClick(() => react());

// ---------------------------------------------------------------------------
// Dragging (handled in main; we just signal start/end + keep interactive)
// ---------------------------------------------------------------------------
zone.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  lastInteraction = Date.now();
  window.pet.dragStart();
});
window.addEventListener('mouseup', () => window.pet.dragEnd());

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
    window.pet.setInteractive(over);
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

// Idle loop: random little hop + fall asleep when left alone.
const SLEEP_AFTER_MS = 30000;
setInterval(() => {
  if (aiActive) return;
  const idleFor = Date.now() - lastInteraction;

  if (idleFor > SLEEP_AFTER_MS) {
    if (currentMood !== 'sleeping') {
      setMood('sleeping');
      say('');
    }
    return;
  }

  if (currentMood === 'sleeping') setMood('idle');

  // ~1 in 8 chance of a little idle hop
  if (currentMood === 'idle' && Math.random() < 0.12) {
    pet.style.transition = 'transform 0.25s ease';
    pet.style.transform = 'translateY(-8px)';
    setTimeout(() => (pet.style.transform = ''), 260);
  }
}, 1500);

// Wake on any local interaction handled above; start idle.
setMood('idle');
