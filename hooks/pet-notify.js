#!/usr/bin/env node
'use strict';

/**
 * Tell the desktop pet what mood to show.
 *
 * Usage:
 *   node pet-notify.js <mood> [text...]
 *   node pet-notify.js working "Editing files..."
 *   node pet-notify.js done
 *
 * Or pipe Claude Code hook JSON on stdin (it reads hook_event_name and maps it).
 *
 * Env:
 *   PET_PORT          (default 7337)
 *   PET_SOURCE        (default "claude")
 *   PET_TOKEN         (optional; must match the app's PET_TOKEN if it set one)
 *   PET_EDITOR_SCHEME (default "vscode"; e.g. "cursor", "vscode-insiders")
 *   PET_OPEN_URL      (optional; overrides the auto-built editor link entirely)
 */

const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.PET_PORT) || 7337;
const SOURCE = process.env.PET_SOURCE || 'claude';
const TOKEN = process.env.PET_TOKEN || '';

// When the conversation's context grows past this many tokens, the pet shows a
// strained "stressed" look instead of its normal active/done mood. Tunable via
// PET_STRESS_TOKENS (set 0 to disable).
const STRESS_TOKENS = process.env.PET_STRESS_TOKENS != null
  ? Number(process.env.PET_STRESS_TOKENS)
  : 120000;

// Safety-net TTL for "active" states. Interrupting Claude fires no hook, so a
// lingering working/thinking state would otherwise stick forever. Each new tool
// event refreshes this timer, so it only expires once events actually stop.
const ACTIVE_TTL = 45000;

// Map Claude Code hook events -> pet moods.
const EVENT_MOOD = {
  UserPromptSubmit: { mood: 'thinking', text: 'on it...', ttl: ACTIVE_TTL },
  PreToolUse: { mood: 'working', text: 'working...', ttl: ACTIVE_TTL },
  PostToolUse: { mood: 'working', text: '', ttl: ACTIVE_TTL },
  Notification: { mood: 'thinking', text: 'needs you 👀', ttl: 60000 },
  Stop: { mood: 'happy', text: 'done!', ttl: 4000 },
  SubagentStop: { mood: 'happy', text: 'subtask done!', ttl: 4000 },
  SessionStart: { mood: 'happy', text: 'hello!', ttl: 3000 },
  SessionEnd: { mood: 'idle', text: '', ttl: 0 }
};

const MOOD_ALIASES = {
  think: 'thinking',
  thinking: 'thinking',
  work: 'working',
  working: 'working',
  done: 'happy',
  success: 'happy',
  happy: 'happy',
  error: 'error',
  fail: 'error',
  stressed: 'stressed',
  heavy: 'stressed',
  idle: 'idle',
  sleep: 'sleeping',
  sleeping: 'sleeping'
};

// Claude Code's exact spinner verb set (its IJ8 default list). One is picked
// per hook event so the pet's bubble keeps changing as it works.
const GERUNDS = [
  "Accomplishing", "Actioning", "Actualizing", "Architecting", "Baking", "Beaming",
  "Beboppin'", "Befuddling", "Billowing", "Blanching", "Bloviating", "Boogieing",
  "Boondoggling", "Booping", "Bootstrapping", "Brewing", "Bunning", "Burrowing",
  "Calculating", "Canoodling", "Caramelizing", "Cascading", "Catapulting", "Cerebrating",
  "Channeling", "Channelling", "Choreographing", "Churning", "Clauding", "Coalescing",
  "Cogitating", "Combobulating", "Composing", "Computing", "Concocting", "Considering",
  "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Crystallizing",
  "Cultivating", "Deciphering", "Deliberating", "Determining", "Dilly-dallying", "Discombobulating",
  "Doing", "Doodling", "Drizzling", "Ebbing", "Effecting", "Elucidating",
  "Embellishing", "Enchanting", "Envisioning", "Evaporating", "Fermenting", "Fiddle-faddling",
  "Finagling", "Flambéing", "Flibbertigibbeting", "Flowing", "Flummoxing", "Fluttering",
  "Forging", "Forming", "Frolicking", "Frosting", "Gallivanting", "Galloping",
  "Garnishing", "Generating", "Gesticulating", "Germinating", "Gitifying", "Grooving",
  "Gusting", "Harmonizing", "Hashing", "Hatching", "Herding", "Honking",
  "Hullaballooing", "Hyperspacing", "Ideating", "Imagining", "Improvising", "Incubating",
  "Inferring", "Infusing", "Ionizing", "Jitterbugging", "Julienning", "Kneading",
  "Leavening", "Levitating", "Lollygagging", "Manifesting", "Marinating", "Meandering",
  "Metamorphosing", "Misting", "Moonwalking", "Moseying", "Mulling", "Mustering",
  "Musing", "Nebulizing", "Nesting", "Newspapering", "Noodling", "Nucleating",
  "Orbiting", "Orchestrating", "Osmosing", "Perambulating", "Percolating", "Perusing",
  "Philosophising", "Photosynthesizing", "Pollinating", "Pondering", "Pontificating", "Pouncing",
  "Precipitating", "Prestidigitating", "Processing", "Proofing", "Propagating", "Puttering",
  "Puzzling", "Quantumizing", "Razzle-dazzling", "Razzmatazzing", "Recombobulating", "Reticulating",
  "Roosting", "Ruminating", "Sautéing", "Scampering", "Schlepping", "Scurrying",
  "Seasoning", "Shenaniganing", "Shimmying", "Simmering", "Skedaddling", "Sketching",
  "Slithering", "Smooshing", "Sock-hopping", "Spelunking", "Spinning", "Sprouting",
  "Stewing", "Sublimating", "Swirling", "Swooping", "Symbioting", "Synthesizing",
  "Tempering", "Thinking", "Thundering", "Tinkering", "Tomfoolering", "Topsy-turvying",
  "Transfiguring", "Transmuting", "Twisting", "Undulating", "Unfurling", "Unravelling",
  "Vibing", "Waddling", "Wandering", "Warping", "Whatchamacalliting", "Whirlpooling",
  "Whirring", "Whisking", "Wibbling", "Working", "Wrangling", "Zesting",
  "Zigzagging"
];

function pickGerund() {
  return GERUNDS[(Math.random() * GERUNDS.length) | 0] + '…';
}

// Are we running inside a VSCode-family editor's integrated terminal?
function inEditor() {
  return (
    process.env.TERM_PROGRAM === 'vscode' ||
    !!process.env.VSCODE_PID ||
    !!process.env.VSCODE_GIT_IPC_HANDLE ||
    !!process.env.CURSOR_TRACE_ID
  );
}

// Build a deep link that focuses the editor on the project, so clicking the
// pet's bubble jumps straight back to the confirm prompt. Returns '' if we
// can't build one (e.g. Claude Code running in a plain terminal, no cwd).
function buildOpenLink(cwd) {
  if (process.env.PET_OPEN_URL) return process.env.PET_OPEN_URL;
  if (!cwd || !inEditor()) return '';
  const scheme =
    process.env.PET_EDITOR_SCHEME ||
    (process.env.CURSOR_TRACE_ID ? 'cursor' : 'vscode');
  // vscode://file/<absolute path> opens & focuses that folder's window.
  return `${scheme}://file${encodeURI(cwd)}`;
}

// Pull the latest context size (in tokens) from a Claude Code transcript. The
// last assistant message's usage reflects how full the context window is:
// fresh input + cached input both count toward what the model had to read.
// Returns 0 if anything is unreadable — we never want to break the host.
function contextTokens(transcriptPath) {
  if (!transcriptPath) return 0;
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const u = row && row.message && row.message.usage;
      if (u) {
        return (u.input_tokens || 0) +
          (u.cache_read_input_tokens || 0) +
          (u.cache_creation_input_tokens || 0) +
          (u.output_tokens || 0);
      }
    }
  } catch {
    /* transcript missing or unreadable — ignore */
  }
  return 0;
}

function send(state) {
  const body = JSON.stringify({ source: SOURCE, ...state });
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  };
  if (TOKEN) headers['X-Pet-Token'] = TOKEN;

  const req = http.request(
    { host: '127.0.0.1', port: PORT, path: '/state', method: 'POST', headers, timeout: 1500 },
    (res) => res.resume()
  );
  // Never block or crash the AI host if the pet isn't running.
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.write(body);
  req.end();
}

const [, , moodArg, ...rest] = process.argv;

if (moodArg) {
  send({ mood: MOOD_ALIASES[moodArg.toLowerCase()] || moodArg, text: rest.join(' ') });
} else {
  // No args: read Claude Code hook JSON from stdin and map the event.
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(input || '{}');
    } catch {
      /* ignore malformed hook payloads */
    }
    const state = EVENT_MOOD[payload.hook_event_name];
    if (!state) return;

    // A Notification means Claude needs the user (permission / confirm / idle
    // prompt). Carry the real message + a link back to the editor so the user
    // can click the pet to jump straight to the prompt.
    if (payload.hook_event_name === 'Notification') {
      const link = buildOpenLink(payload.cwd);
      return send({
        mood: 'thinking',
        text: payload.message ? String(payload.message).slice(0, 160) : state.text,
        ttl: state.ttl,
        link,
        linkText: link ? 'Open editor →' : ''
      });
    }

    // Swap the flat "working..." for a rotating spinner word. PostToolUse keeps
    // its empty text, so the word doesn't flicker between back-to-back tools.
    let text = state.text;
    if (text && (state.mood === 'working' || state.mood === 'thinking')) {
      text = pickGerund();
    }

    // Heavy context -> show the strained look instead of the normal mood, but
    // keep the event's TTL so it still self-heals after an interrupt.
    const overridable = state.mood === 'working' || state.mood === 'thinking' || state.mood === 'happy';
    if (STRESS_TOKENS > 0 && overridable) {
      const ctx = contextTokens(payload.transcript_path);
      if (ctx >= STRESS_TOKENS) {
        return send({ mood: 'stressed', text: `phew… ${Math.round(ctx / 1000)}k ctx`, ttl: state.ttl });
      }
    }
    send({ mood: state.mood, text, ttl: state.ttl });
  });
  // If nothing arrives on stdin quickly, just exit.
  setTimeout(() => process.exit(0), 1000);
}
