'use strict';

// Deterministic renderer regressions: run real behavior with a tiny DOM and clock.
const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
function harness() {
  let now = 100000, next = 0;
  const timers = new Map(), events = {}, nodes = new Map();
  class Element {
    constructor() {
      this.classes = new Set(); this.style = { setProperty() {} }; this.listeners = {};
      this.children = []; this.textContent = '';
      this.classList = {
        add: (...xs) => xs.forEach(x => this.classes.add(x)),
        remove: (...xs) => xs.forEach(x => this.classes.delete(x)),
        contains: x => this.classes.has(x),
        toggle: (x, yes) => yes ? this.classes.add(x) : this.classes.delete(x),
        [Symbol.iterator]: () => this.classes.values()
      };
    }
    set className(s) { this.classes = new Set(s.split(/\s+/)); }
    get className() { return [...this.classes].join(' '); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    appendChild(el) { this.children.push(el); }
    replaceChildren() { this.children = []; }
    remove() {}
    contains(el) { return el === this; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 90 }; }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const schedule = (fn, delay, interval = false) => {
    const id = ++next; timers.set(id, { fn, at: now + delay, delay, interval }); return id;
  };
  const api = new Proxy({}, { get: (_, key) => key.startsWith('on')
    ? fn => { events[key] = fn; } : () => {} });
  const ctx = vm.createContext({
    document: { getElementById: node, querySelector: node,
      querySelectorAll: () => [node('pupil1'), node('pupil2')],
      documentElement: node('root'), createElement: () => new Element(), hidden: false },
    window: { petAPI: api, matchMedia: () => ({ matches: false }), addEventListener() {} },
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, d) => schedule(fn, d), clearTimeout: id => timers.delete(id),
    setInterval: (fn, d) => schedule(fn, d, true), clearInterval: id => timers.delete(id),
    console
  });
  vm.runInContext(fs.readFileSync('src/renderer/pet.js', 'utf8'), ctx);
  return { events, node, run: s => vm.runInContext(s, ctx), advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due; now = t.at; timers.delete(id);
      if (t.interval) timers.set(id, { ...t, at: now + t.delay });
      t.fn();
    }
    now = end;
  } };
}
{
  const h = harness();
  for (const name of ['yawn', 'curious', 'shake', 'kiss', 'sniff', 'paw', 'groom']) {
    h.events.onTrick(name);
    assert(h.node('pet').classList.contains('act-' + name));
    h.advance(1800);
    assert(!h.node('pet').classList.contains('act-' + name));
  }
  h.events.onTrick('kiss');
  h.events.onAiState({ mood: 'working', source: 'claude', ttl: 10000 });
  h.advance(2000);
  assert(h.node('pet').classList.contains('mood-working'));
  assert(!h.node('pet').classList.contains('act-kiss'));
}
{
  const h = harness();
  h.events.onAiState({ mood: 'thinking', source: 'claude', attention: true, ttl: 1000 });
  h.events.onTrick('dance');
  h.advance(32000);
  assert(h.node('pet').classList.contains('attention'));
  assert(h.node('pet').classList.contains('mood-stressed'));
  assert(!h.node('pet').classList.contains('act-dance'));
}
{
  const h = harness();
  h.run('Math.random = () => 0.99');
  h.advance(28500);
  assert(h.node('pet').classList.contains('act-yawn'));
  h.advance(3000);
  assert(h.node('pet').classList.contains('mood-sleeping'));
  assert(!h.node('pet').classList.contains('act-yawn'));
  h.events.onFocus({ phase: 'break', minutes: 5 });
  h.events.onClick();
  h.advance(1600);
  assert(h.node('pet').classList.contains('mood-sleeping'));
  h.run("say('open', 1000, 'https://example.com'); say('')");
  assert.equal(h.run('pendingLink'), '');
}
{
  const h = harness();
  h.node('pet').classList.add('has-model');
  h.events.onClick();
  assert(h.node('pet').classList.contains('act-petting'));
  assert(!h.node('pet').classList.contains('act-wiggle'));
  h.advance(1600);
  assert(!h.node('pet').classList.contains('act-petting'));
  h.events.onClick();
  h.events.onAiState({ mood: 'working', source: 'claude', ttl: 10000 });
  assert(!h.node('pet').classList.contains('act-petting'));
  h.advance(1600);
  assert(h.node('pet').classList.contains('mood-working'));
  h.node('pet').classList.add('has-sprite');
  h.events.onClick();
  assert(h.node('pet').classList.contains('act-wiggle'));
}
{
  // Two sessions of one assistant: B working must not dismiss A's prompt.
  const h = harness();
  h.events.onAiState({ mood: 'thinking', source: 'claude', key: 'claude|A', attention: true, text: 'allow Bash?', ttl: 60000 });
  h.events.onAiState({ mood: 'working', source: 'claude', key: 'claude|B', ttl: 45000 });
  assert(h.run('confirmPending'), 'B dismissed A\'s confirm');
  assert(h.node('pet').classList.contains('mood-stressed'));
  assert.equal(h.run('confirmInfo.key'), 'claude|A');
  h.events.onAiState({ mood: 'thinking', source: 'claude', key: 'claude|B', attention: true, text: 'allow Edit?', ttl: 60000 });
  assert.equal(h.run('pendingConfirms.size'), 2);
  assert.match(h.node('bubble-text').textContent, /\+1 more waiting/);
  // Answering B (via the hotkey) brings A's prompt back on screen.
  h.events.onConfirmAck('claude|B');
  assert(h.run('confirmPending'));
  h.advance(1600);
  assert.match(h.node('bubble-text').textContent, /allow Bash\?/);
  // A's own next event answers it; nothing is left waiting.
  h.events.onAiState({ mood: 'working', source: 'claude', key: 'claude|A', ttl: 45000 });
  assert(!h.run('confirmPending'));
  assert(h.node('pet').classList.contains('mood-working'));
  // One badge for the assistant, counting its sessions.
  assert.equal(h.node('ai-badges').children.length, 1);
  assert.equal(h.node('ai-badges').children[0].textContent, 'C×2');
  // A session-less idle clears every session of that source.
  h.events.onAiState({ mood: 'idle', source: 'claude' });
  assert.equal(h.run('activeAis.size'), 0);
}
{
  // Walking only while idle, and it stops on its own.
  const h = harness();
  h.events.onWalk({ dir: 'left', ms: 1200 });
  assert(h.node('pet').classList.contains('walking'));
  assert(h.node('pet').classList.contains('face-left'));
  h.advance(1300);
  assert(!h.node('pet').classList.contains('walking'));
  h.events.onAiState({ mood: 'working', source: 'claude', key: 'claude|', ttl: 10000 });
  h.events.onWalk({ dir: 'right', ms: 1200 });
  assert(!h.node('pet').classList.contains('walking'), 'a busy pet should not walk');
}
console.log('Renderer regressions passed: gestures, AI interruption, confirmation, sleep, focus, sessions and walking.');
