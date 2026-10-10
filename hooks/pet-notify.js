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
 *   PET_PORT          (default: the port the app saved, else 7337)
 *   PET_SOURCE        (default "claude")
 *   PET_TOKEN         (optional; read from the app's config file when unset)
 *   PET_EDITOR_SCHEME (default "vscode"; e.g. "cursor", "vscode-insiders")
 *   PET_OPEN_URL      (optional; overrides the auto-built editor link entirely)
 *
 * Hook payloads carry a session_id, which is forwarded so the pet can tell two
 * Claude Code sessions apart instead of letting one clear the other.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cliArgs = process.argv.slice(2);
let configPath = process.env.PET_CONFIG || '';
const configIndex = cliArgs.indexOf('--config');
if (configIndex >= 0) { configPath = cliArgs[configIndex + 1] || ''; cliArgs.splice(configIndex, 2); }

const SOURCE = process.env.PET_SOURCE || 'claude';

// The pet app saves its settings (token, stress threshold, …) to a JSON file in
// its userData dir. We read it as a fallback so values set in the GUI reach the
// hook too. Env vars still win, and any failure is silently ignored.
function readPetConfig() {
  const home = os.homedir();
  let base;
  if (process.platform === 'darwin') base = path.join(home, 'Library', 'Application Support');
  else if (process.platform === 'win32') base = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  else base = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const files = configPath ? [configPath] : ['desktop-pet', 'Desktop Pet'].map(dir => path.join(base, dir, 'pet-config.json'));
  const candidates = [];
  for (const file of files) {
    try {
      const live = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'pet-connection.json'), 'utf8'));
      if (Number.isInteger(live.pid) && live.pid > 0) { process.kill(live.pid, 0); return live; }
    } catch { /* no live instance descriptor */ }
    try { const value=JSON.parse(fs.readFileSync(file,'utf8')); if(value && typeof value==='object') candidates.push({value,mtime:fs.statSync(file).mtimeMs}); } catch {}
  }
  if (candidates.length) return candidates.sort((a,b)=>b.mtime-a.mtime)[0].value;
  return {};
}

const PET_CONFIG = readPetConfig();

// Where the pet is actually listening. The app writes back the port it bound
// to, which matters when 7337 was taken and it fell back to 7338+ — otherwise
// every hook event would go to a dead socket and the pet would never react.
const PORT =
  Number(process.env.PET_PORT) || Number(PET_CONFIG.port) || 7337;

// The app generates a token on first run and saves it here, so auth works with
// no setup. PET_TOKEN still wins for anyone running the pet with an explicit one.
const TOKEN = process.env.PET_TOKEN || PET_CONFIG.token || '';

// When the conversation's context grows past this many tokens, the pet shows a
// strained "stressed" look instead of its normal active/done mood. Tunable via
// PET_STRESS_TOKENS (env) or the app's Settings window; set 0 to disable.
const STRESS_TOKENS =
  process.env.PET_STRESS_TOKENS != null
    ? Number(process.env.PET_STRESS_TOKENS)
    : Number.isFinite(PET_CONFIG.stressTokens)
      ? PET_CONFIG.stressTokens
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
  // Permission dialog ("can I run this tool?") — Claude Code fires this distinct
  // event for confirm prompts; Notification is only idle/other notices.
  PermissionRequest: { mood: 'thinking', text: 'can I run this? 👀', ttl: 120000 },
  Notification: { mood: 'thinking', text: 'needs you 👀', ttl: 60000 },
  Stop: { mood: 'happy', text: 'done!', ttl: 4000 },
  // A subagent finishing is progress, not the end of the task: the parent is
  // still working, and counting it as "done" would inflate the task tally.
  SubagentStop: { mood: 'working', text: 'subtask done!', ttl: ACTIVE_TTL },
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

// Build a deep link that jumps straight back to the confirm prompt: the editor
// window for the project, or (macOS) the terminal app Claude Code is running
// in. Returns { link, text }, with an empty link if we can't build one.
function buildOpenLink(cwd) {
  if (process.env.PET_OPEN_URL) return { link: process.env.PET_OPEN_URL, text: 'Open →' };
  if (cwd && inEditor()) {
    const scheme =
      process.env.PET_EDITOR_SCHEME ||
      (process.env.CURSOR_TRACE_ID ? 'cursor' : 'vscode');
    // vscode://file/<absolute path> opens & focuses that folder's window.
    return { link: `${scheme}://file${encodeURI(cwd)}`, text: 'Open editor →' };
  }
  // The pet only knows how to focus terminals on macOS, and only ones on its
  // own allowlist — it checks the name again before acting on it.
  const term = process.env.TERM_PROGRAM;
  if (process.platform === 'darwin' && term && /^[\w.-]{1,40}$/.test(term)) {
    return { link: `pet-focus://app/${encodeURIComponent(term)}`, text: 'Open terminal →' };
  }
  return { link: '', text: '' };
}

// Pull the latest context size (in tokens) from a Claude Code transcript. The
// last assistant message's usage reflects how full the context window is:
// fresh input + cached input both count toward what the model had to read.
// Returns 0 if anything is unreadable — we never want to break the host.
//
// Only the end of the transcript is ever needed (we want the *last* usage
// block), and transcripts grow to many MB over a long session — so read a
// bounded tail rather than slurping the whole file on every single hook event.
const TAIL_BYTES = 256 * 1024;

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function contextTokens(transcriptPath) {
  if (!transcriptPath) return 0;
  try {
    // The first line of a tail read is usually a partial record; JSON.parse
    // fails on it and the loop just skips it, which is exactly what we want.
    const lines = readTail(transcriptPath).split('\n');
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

// Set from the hook payload; '' for CLI use.
let SESSION = process.env.PET_SESSION || `cli-${process.ppid}`;
let EVENT = process.env.PET_EVENT || '';
let EVENT_ID = '';
let PROJECT = '';
let LEASE = Number(process.env.PET_LEASE_MS) || 0;

function send(state) {
  const body = JSON.stringify({ source: SOURCE, session: SESSION, event: EVENT, eventId: EVENT_ID, project: PROJECT, leaseMs: LEASE, ...state });
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  };
  if (TOKEN) headers['X-Pet-Token'] = TOKEN;

  const req = http.request(
    { host: '127.0.0.1', port: PORT, path: '/state', method: 'POST', headers, timeout: 1500 },
    (res) => { res.resume(); if (moodArg && res.statusCode !== 200) { console.error(`pet: server returned HTTP ${res.statusCode}; check token and port in Settings`); process.exitCode = 1; } }
  );
  // Never block or crash the AI host if the pet isn't running.
  req.on('error', (err) => { if (moodArg) { console.error('pet: ' + err.message); process.exitCode = 1; } });
  req.on('timeout', () => req.destroy());
  req.write(body);
  req.end();
}

const [moodArg, ...rest] = cliArgs;

// Manual (CLI) states need a TTL of their own. Without one the pet would hold a
// 'working' mood forever: nothing else is coming to clear it, since a script
// that crashes or is Ctrl-C'd never sends its matching 'done'.
const CLI_TTL = { thinking: 120000, working: 120000, stressed: 120000, happy: 6000, error: 8000 };

function usage(problem) {
  const moods = [...new Set(Object.values(MOOD_ALIASES))].sort().join(', ');
  const text = `usage: pet <mood> [message...]
moods: ${moods}
       (aliases: ${Object.keys(MOOD_ALIASES).sort().join(', ')})
example: pet working "building the bundle..."`;
  if (problem) {
    console.error(`pet: ${problem}\n${text}`);
    process.exit(2);
  }
  console.log(text);
  process.exit(0);
}

if (moodArg === '--help' || moodArg === '-h') usage('');

if (moodArg) {
  // An unrecognized word used to be forwarded as-is, and the server quietly
  // coerced anything it didn't know to 'idle' — so a typo read as success while
  // actually clearing the pet. Fail loudly instead.
  const mood = MOOD_ALIASES[moodArg.toLowerCase()];
  if (!mood) usage(`unknown mood "${moodArg}"`);
  send({ mood, text: rest.join(' '), ttl: CLI_TTL[mood] || 0 });
} else {
  // No args: read Claude Code hook JSON from stdin and map the event.
  let input = '';
  let stdinTimeout = null;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    let payload = {};
    try {
      payload = JSON.parse(input || '{}');
    } catch {
      /* ignore malformed hook payloads */
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const state = EVENT_MOOD[payload.hook_event_name];
    if (!state) return;
    SESSION = '';
    EVENT = ({SessionStart:'session-start',SessionEnd:'session-end',Stop:'done',UserPromptSubmit:'start',PermissionRequest:'confirm',Notification:'confirm'})[payload.hook_event_name] || 'busy';
    PROJECT = typeof payload.cwd === 'string' ? path.basename(payload.cwd) : '';
    // Tool execution may legitimately run for many minutes without another hook.
    LEASE = ['PreToolUse','SubagentStop'].includes(payload.hook_event_name) ? 1800000 : 0;
    if (payload.hook_event_name === 'Stop' && payload.transcript_path) {
      try { EVENT_ID = crypto.createHash('sha256').update(payload.hook_event_name + ':' + readTail(payload.transcript_path)).digest('hex'); } catch {}
    }
    if (typeof payload.session_id === 'string') SESSION = payload.session_id.slice(0, 80);

    // Notification covers several situations. Only the ones that block on the
    // user deserve the confirm treatment: the idle "waiting for your input"
    // reminder fires after every finished turn, and auth_success is just news.
    const kind = payload.notification_type;
    if (payload.hook_event_name === 'Notification' && (kind === 'idle_prompt' || kind === 'auth_success')) {
      return;
    }

    // PermissionRequest (a confirm/permission dialog) and Notification (idle /
    // other notices) both mean Claude needs the user. Carry the real message +
    // a link back to the editor so the user can click the pet to jump straight
    // to the prompt.
    if (
      payload.hook_event_name === 'PermissionRequest' ||
      payload.hook_event_name === 'Notification'
    ) {
      const { link, text: linkText } = buildOpenLink(payload.cwd);
      // Prefer Claude's own message; for a bare permission request, name the
      // tool it wants to run (e.g. "allow Bash?").
      let text = payload.message ? String(payload.message) : '';
      if (!text && payload.tool_name) text = `allow ${payload.tool_name}?`;
      if (!text) text = state.text;
      return send({
        mood: 'thinking',
        text: String(text).slice(0, 160),
        ttl: state.ttl,
        link,
        linkText,
        // Always grab the user's attention for a confirm prompt — the link is a
        // nice-to-have shortcut, not the trigger. (A plain-terminal Claude Code
        // builds no link, but the pet should still bounce + chime.)
        attention: true
      });
    }

    // Swap the flat "working..." for a rotating spinner word. PostToolUse keeps
    // its empty text, so the word doesn't flicker between back-to-back tools.
    let text = state.text;
    if (text && (state.mood === 'working' || state.mood === 'thinking')) {
      text = pickGerund();
    }

    // How full is the context window? Sent along so the pet can draw a usage
    // ring, and used here to flip into the strained look when it's getting big.
    const ctx = contextTokens(payload.transcript_path);

    // Heavy context -> show the strained look instead of the normal mood, but
    // keep the event's TTL so it still self-heals after an interrupt.
    const overridable = state.mood === 'working' || state.mood === 'thinking';
    if (STRESS_TOKENS > 0 && overridable && ctx >= STRESS_TOKENS) {
      return send({ mood: 'stressed', text: `phew… ${Math.round(ctx / 1000)}k ctx`, ttl: state.ttl, ctx });
    }
    send({ mood: state.mood, text, ttl: state.ttl, ctx });
  });
  // If nothing arrives on stdin quickly, just exit. Cleared once we've read the
  // payload, so the timer can't fire mid-POST and kill the request before it
  // reaches the pet (send() is async and can outlive this 1s window).
  stdinTimeout = setTimeout(() => process.exit(0), 1000);
}
