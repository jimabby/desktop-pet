# 🐾 Desktop Pet

A cross-platform (macOS + Windows + Linux) desktop companion built with Electron.
It floats on top of your screen, you can drag/poke/chat with it, and it **reacts
when an AI assistant (Claude, ChatGPT, Gemini, DeepSeek, Copilot, Cursor, Ollama, …)
is working**.

> The built-in CSS character has expressive gestures and four skins. You can also
> load a sprite sheet from Settings.

## Features

- Transparent, frameless, always-on-top window
- **Click-through** on empty areas — it won't block the app behind it
- **Drag** to reposition anywhere — **position is remembered** across restarts
- **Resize** — scroll over the pet (or use the tray) to scale it 0.6×–2.5×, **size is remembered**
- **Click/poke** reactions — keep petting and it warms up, showering hearts; pet
  it enough and it pops on a little **party hat** 🎉
- **Pick it up** — drag it around and it kicks its legs and squeals "wheee~",
  then lands with a squish. With **throw physics** on, *fling* it and it slides
  and bounces off the screen edges, **perching** if it lands near the top
- **Wander mode** — left alone and awake, the pet occasionally walks a short way,
  facing where it's going (the 3D animals trot with a real walk cycle). It stays
  put while asleep, busy, or waiting on you
- **Skins** — pick **Slime**, **Kitten 3D**, or **Puppy 3D** in Settings
- **Cosmetics** — wear a free **bow tie** or **flower**, then unlock **glasses**,
  a **cap**, **headphones**, a **scarf**, and a **crown** by completing tasks.
  The 3D accessories follow the pet’s head and body.
- **Tricks on demand** — **right-click the pet** (or use the tray's **Tricks** menu) to make it **dance**
  (with music notes 🎵), **backflip**, **wave**, **spin**, **yawn & stretch**,
  **curious tilt**, **shake it off**, **blow a kiss**, **sniff around**, **give a paw**, or **groom**
- **Hover to tickle** — rest your cursor on the pet (no click) and it giggles
- **Waves hello** — it waves when it first appears or when you summon it back
- **Time-of-day tint** — warmer/dimmer at night, brighter midday
- **Easter eggs** — **double-click** for a delighted spin; enter the **Konami code**
  (while the pet is focused) to go full rainbow 🌈
- **Focus mode (Pomodoro)** — start a work/break timer from the tray; the pet perks
  up during focus blocks and naps on breaks
- **Eyes follow your cursor** while idle, so it feels like it's watching you
- **Decorations**: a leaf sprout + **blooming flower** on its head, little waving
  **arms** and stubby **feet**, glossy eyes, a drifting body shine, ambient sparkles
- **Speech bubbles** — including a **"done · 2m 13s"** note showing how long the
  AI's last task took
- **Idle behaviors**: blinking, little hops, curious tilts, shakes and kisses,
  without repeating the last idle action; yawns before falling asleep when ignored
- **Respects "reduce motion"** — calms its looping animations if your OS asks
- **Per-AI tint + badges** — a colored glow and badges show which assistant is driving it
- **Multi-AI and multi-session** — if Claude, ChatGPT, Gemini, etc. are active together, the
  pet switches into a team-up bounce. Several Claude Code sessions are tracked separately
  (the badge reads `C×2`): one finishing never clears another, and each session's
  confirm prompt waits on its own (`+1 more waiting`)
- **Context-usage ring** — a gauge around the pet fills (green → amber → red) as the
  conversation's context window fills up, with a compact `85k`-style token label
- **Daily stats** — the tray's **Today** menu tallies per-AI tasks, active time,
  confirms, and errors (resets each day)
- **Activity window** — tray ▸ **Activity…** charts the last 7 days of completed
  tasks, per-assistant totals for today, and the recent-event log
- **While you were away** — hide the pet or step away from the computer, and when
  you're back it sums up what happened (`while you were away: 3 done, 1 waiting on you`)
- **Missed-event log** — the tray's **Recent** menu shows the last ~8 confirms,
  errors, and completions with how long ago they happened (repeats of the same
  event are folded together instead of flooding it)
- **Name + color** — name your pet and pick its body color in **Settings…** (saved)
- **Global hotkeys** — show/hide the pet from anywhere (default `Cmd/Ctrl+Alt+Shift+P`),
  and jump straight to the newest prompt waiting on you (default `Cmd/Ctrl+Alt+Shift+J`)
- **Sound chimes** on done/error (toggle from the tray)
- **Confirm prompts** — when an AI needs your approval, the pet bounces with a `!`,
  chimes, and shows a clickable link back to your editor (or, on macOS, your
  terminal); **left unanswered it keeps nudging**, getting more insistent until you respond
- **Notifies you when hidden** — hide the pet and a confirm or error still
  reaches you as a system notification; click it to bring the pet back (or jump
  straight to the editor)
- **Quiet hours** — a do-not-disturb window where the pet keeps working and
  keeps counting but stops chiming, notifying, and escalating its nudges
- **Sprite-sheet art** — drop in your own animated sheet from **Settings** and it
  replaces the drawn pet, mood for mood
- **Tray menu**: connection status, show/hide, wake/poke, tricks, focus session,
  Today stats, Activity window, Recent log, settings, behavior toggles (wander /
  physics / time-of-day / notify-when-hidden / quiet hours), resize, mute, launch
  at login, reset position, check for updates, quit
- **AI integration** via a tiny local control server + Claude Code hooks
- **Token auth by default** — a secret is generated on first run so no web page
  you have loaded can puppet your pet
- **Auto-update** for packaged builds published with an update channel

## Companion center

Open **Companion center…** from the tray or the pet’s right-click menu. The
Activity window now includes:

- **Connection diagnostics**: last received assistant/session event, active port,
  environment-token override status, an authenticated connection test, and a
  redacted diagnostic export. Exported diagnostics omit tokens, project names,
  messages, and session identifiers.
- **Sessions & prompts**: project labels, separate working/waiting time, and
  **Open**, **Acknowledge**, or **Snooze 5m** for each prompt. Acknowledging only
  silences the pet; it does not approve a command in your assistant. A snoozed
  prompt returns if its session has not moved on.
- **Temporary quiet** for 15, 30, or 60 minutes, or until the current focus phase
  ends. Presentation mode hides the pet and silences notifications while events
  continue to be tracked. Ending it restores the previous visibility.
- **Affection** that persists without hunger or decay. Petting, treats, and the
  20-second cursor-chase toy earn points; milestones at 10, 30, and 100 trigger
  a wave, dance, or spin. The toy stops for AI work, prompts, quiet mode, reduced
  motion, dragging, or a hidden window.
- **Perch & profiles**: choose a preferred monitor/corner and a stationary perch.
  Work, Play, and Minimal provide presets; save your own current appearance,
  size, sound, and movement preferences into any of those slots.
- **Backup & export**: versioned settings backups include profiles, affection,
  and managed sprite art. Tokens, login state, task history, and live sessions
  are excluded. Restore validates the file and backs up the existing config
  before applying it. Export today’s per-assistant statistics or the current/
  recent session list as CSV. Session rows are retained in memory for up to an
  hour after activity ends; task totals remain persisted across restarts.

Task lifecycle is tracked independently of appearance. Starting a session no
longer counts as completing work, high-context completions still count, and
separate turns/sessions with identical messages remain independent. Active time
is the sum of per-session working intervals, excluding permission waiting; two
simultaneously working sessions contribute two intervals.

Integrations may send `event` (`start`, `busy`, `done`, `error`, `confirm`,
`idle`, `session-start`, or `session-end`), `eventId` (a retry identifier scoped
to the source/session), `project` (a display label), and `leaseMs` alongside the
existing mood fields. Without `event`, the legacy mood mapping remains supported.
Use a new `eventId` for each distinct task event, and reuse it only when retrying
that same event. The UI connection test calls authenticated `GET /connection`;
`GET /health` remains public for discovery.

The app writes a private `pet-connection.json` next to its config so hooks can
find the running instance and effective authentication token. The hook installer
passes the exact config location. `PET_CONFIG` or `pet --config /path/to/pet-config.json`
selects a particular install; `PET_PORT` and `PET_TOKEN` remain explicit overrides.
Settings marks an environment-managed token read-only.

The browser bridge creates a separate session per page and reports connection
errors in the browser console at most once per minute. `pet-wrap` (or the existing
shell wrapper) creates a session per command and sends heartbeats until exit.
Direct CLI calls share a session with their invoking shell; use `PET_SESSION`
for explicit session identity. Manual failures exit nonzero; assistant hooks
remain best-effort. Long tool hooks receive a bounded 30-minute lease; the
`leaseMs` protocol field can request up to one hour. Wrappers renew their
120-second lease every 30 seconds. Abandoned work therefore eventually expires.

Linux’s **Launch at login** control is explicitly unavailable; configure startup
through your desktop environment. The app now constrains the window size to
its display work area and rescues it after monitor changes.

## Setup, recovery, and customization

- **Companion center → Connect an integration** sends an authenticated sample
  through the real state endpoint and checks receipt. Show or copy the terminal
  command to test from your shell; it uses the current port and token. The command
  contains your token, so keep it private. Verify `setup-check` in the last event.
  Claude Code still uses the hook installer in Settings; no new external adapter
  or account connection is required.
- **Dismiss locally** removes stale prompts from the inbox and ends their local
  waiting clock. It never approves or cancels a command in the assistant. A new
  confirm event can reopen the prompt. Expired sessions show their last event
  time and whether their lease ended or the computer suspended.
- **Settings → Low-power animation** reduces 3D idle rendering from 30 to 10 FPS,
  makes sleeping poses static, and suppresses spontaneous wandering and idle
  gestures. **Use low power on battery** enables it automatically when the OS
  reports battery power. Both options are off by default and included in profiles
  and settings backups. This is not a measured battery-life guarantee.
- **Settings → Sprite art** now previews frames and lets you choose each mood’s
  row, frame count, and FPS. Row numbers in the editor start at 1. Grid dimensions
  must divide the image evenly. Edits stay in the preview until **Apply animation
  mapping**; **Discard mapping edits** reloads the saved mapping. Choosing an image
  still imports it immediately. Reduced-motion mode shows a static preview.
- **Companion center → Focus recaps** retains the last ten work-block summaries,
  including early stops: completed tasks, measured active time, and outstanding
  prompts at the end. Concurrent sessions contribute overlapping active time.
  Recaps persist locally and are excluded from settings backups.

Busy events without an explicit TTL receive a 120-second lease in both the
session tracker and pet display. Renew long-running work with heartbeats.
Source/session names containing `|` or `%` are kept independent. Position drafts
survive periodic refreshes, and placement fits the destination monitor.
Restored sprites are cleaned up when replaced or removed; before-restore config
backups retain a separate copy of their previous image for recovery.

## Run it

Requires [Node.js](https://nodejs.org) 22.12+ (needed by Electron 44).

```bash
cd desktop-pet
npm install
npm start
```

The pet appears bottom-right (or wherever you last left it). Everything else —
show/hide, mute sounds, resize, launch at login, reset position, quit — lives in
the **tray icon** (the menu bar on macOS; there's no dock icon by design).

## Moving & resizing

- **Move** — drag the pet anywhere. A small click is treated as a poke; an
  actual drag moves it. The position is saved and restored on next launch.
- **Resize** — hover the pointer over the pet and **scroll** (two-finger swipe up
  on a Mac trackpad = bigger, down = smaller), or use the tray menu
  **Size → Bigger / Smaller / Reset size**. The scale (0.6×–2.5×) is remembered.

## Customizing your pet

Open **Settings…** from the tray (or **right-click the pet ▸ Settings…**). The window covers:

- **Name** — it'll introduce itself now and then, and the name shows in the tray
- **Color** — pick a body/fur color; Natural restores the original animal coat.
  Peach, Cream, and Cocoa join the existing palette.
- **Skin** — Slime, Kitten 3D, or Puppy 3D
- **Cosmetic** — equip any headwear you've unlocked (locked ones show how many
  completed tasks they need: glasses at 10, headphones at 30, scarf at 50, crown
  at 120)
- **Behavior** — toggle sound effects, time-of-day tint, wander, and throw physics
- **Focus** — set the work/break minutes for the Pomodoro timer
- **Claude Code** — one click installs the pet's hooks into `~/.claude/settings.json`
- **Advanced** — the **show/hide** and **answer-confirm** shortcuts (Electron
  accelerators, blank to disable; a shortcut another app already owns is flagged),
  the **stress threshold** (k tokens before the pet looks strained, 0 = off), and
  the control-server **token** (see *The token*)

Settings saves each control as you change it, and stays in step with changes made
from the tray while it's open.

Everything is remembered across restarts. The wander / physics / time-of-day
toggles are also in the tray's **Behavior** submenu, and a focus session starts
and stops from the tray.

The **Today** tray submenu shows what your assistants did today — completed
tasks, total active time, confirm prompts, and errors per AI — and rolls over at
midnight (or hit **Reset today**). The **Recent** submenu is a rolling log of the
last few confirms, errors, and completions so you can catch up after stepping away.

The **context-usage ring** treats a 200k-token window as "full" by default. If
your model has a different context window, launch with `PET_CTX_MAX` set (e.g.
`PET_CTX_MAX=1000000 npm start`).

## How AI reactions work

When the app runs it starts a local control server on `http://127.0.0.1:7337`.
Copy the token from Settings into `PET_TOKEN` before using raw HTTP. Anything
that POSTs an authenticated mood makes the pet react:

```bash
curl -s localhost:7337/state \
  -H 'Content-Type: application/json' \
  -H "X-Pet-Token: $PET_TOKEN" \
  -d '{"mood":"working","text":"Refactoring auth...","source":"chatgpt","ttl":8000}'
```

| field      | values                                                              |
| ---------- | ------------------------------------------------------------------- |
| `mood`     | `idle` `thinking` `working` `happy` `stressed` `sleeping` `error`   |
| `text`     | optional speech-bubble message                                      |
| `source`   | optional label shown before the text (e.g. `claude`)               |
| `ttl`      | optional ms, then the pet returns to idle automatically            |
| `link`     | optional URL opened when the bubble (or pet) is clicked; safe schemes only (`http` `https` `vscode` `vscode-insiders` `cursor` `windsurf`) |
| `linkText` | optional label for that link (default `Open →`)                     |
| `attention`| optional bool; `true` marks a confirm/permission prompt so the pet bounces + chimes for you, even when no `link` is provided |
| `ctx`      | optional number; current context-window size in tokens, drives the usage ring (compared against `PET_CTX_MAX`, default 200000) |

`GET /health` returns `{ ok: true }` so scripts can check the pet is up.

The `source` is also used to tint the pet (`claude`, `chatgpt`, `gemini`,
`deepseek`, `copilot`, `cursor`, `ollama` each get their own glow color). Active
sources also appear as little badges above the pet. If multiple sources are active at once, the pet shows a
combined glow, bouncy team-up animation, and a bubble like
`Claude + ChatGPT + Gemini are working together...`.

Try the three-AI state manually:

```bash
curl -s localhost:7337/state -H "X-Pet-Token: $PET_TOKEN" -H 'Content-Type: application/json' \
  -d '{"mood":"thinking","text":"Claude is planning...","source":"claude","ttl":15000}'
curl -s localhost:7337/state -H "X-Pet-Token: $PET_TOKEN" -H 'Content-Type: application/json' \
  -d '{"mood":"working","text":"ChatGPT is drafting...","source":"chatgpt","ttl":15000}'
curl -s localhost:7337/state -H "X-Pet-Token: $PET_TOKEN" -H 'Content-Type: application/json' \
  -d '{"mood":"thinking","text":"Gemini is checking...","source":"gemini","ttl":15000}'
```

Send a specific source back to idle when it finishes:

```bash
curl -s localhost:7337/state -H "X-Pet-Token: $PET_TOKEN" -H 'Content-Type: application/json' \
  -d '{"mood":"idle","source":"gemini"}'
```

Or clear every active AI:

```bash
curl -s localhost:7337/state -H "X-Pet-Token: $PET_TOKEN" -H 'Content-Type: application/json' \
  -d '{"mood":"idle"}'
```

`happy` and `error` moods play a short chime unless you've muted sounds from the
tray.

### The token (on by default)

The control server only listens on `127.0.0.1`, but CORS is open — so without a
token, any web page you happen to have loaded could POST to it: drive the pet,
and plant a link in its bubble. So **the app generates a token on first run** and
requires it on `/state`. There is nothing to set up:

- `hooks/pet-notify.js` reads the token straight out of the app's config file, so
  Claude Code hooks and the `pet` command just work.
- Anything that *can't* read that file — the browser userscript, a script on
  another machine — needs the value from **Settings… ▸ Advanced ▸ Control-server
  token**, sent as an `X-Pet-Token` header.
- `PET_TOKEN` in the environment overrides the saved one, on both sides.
- `GET /health` stays public, so scripts can check the pet is up without it.

```bash
TOKEN='…from Settings…'
curl -s localhost:7337/state -H "X-Pet-Token: $TOKEN" \
  -H 'Content-Type: application/json' -d '{"mood":"happy"}'
```

Editing the token in Settings takes effect live, with no restart. It can't be
cleared (that would open the pet to any page in your browser); use
**Regenerate** if it has leaked. The hook picks a new token up automatically.

**A note on bubble links.** A confirm prompt can carry a link back to your
editor, and clicking the bubble's link opens it. Poking the pet only *dismisses*
the nudge — it never follows the link — so an incidental click can't send you
somewhere you didn't read. Only `http`, `https`, `vscode`, `vscode-insiders`,
`cursor`, and `windsurf` URLs are accepted, plus the pet's own
`pet-focus://app/<TERM_PROGRAM>`, which only ever brings one of a fixed list of
terminal apps to the front (macOS).

### If port 7337 is taken

The pet walks up to the next free port and writes it into its config, so
`pet-notify.js` still finds it. The tray's top line and **Settings ▸ Advanced ▸
Connection** both show where it actually landed — and say so loudly if it
couldn't get a port at all, rather than sitting there looking healthy while
ignoring every event.

### Claude Code (automatic)

Open **Settings ▸ Claude Code ▸ Install Claude Code hooks…**. It shows exactly
what it will add, backs up `~/.claude/settings.json` to `settings.json.pet-backup`,
keeps all your other settings and hooks, and replaces pet hooks left over from an
older install path. The hooks run `node`, so Node.js must be on your PATH.

To do it by hand instead: open
[hooks/claude-settings-example.json](hooks/claude-settings-example.json), replace
`ABSOLUTE_PATH` with the full path to this folder, and merge the `hooks` block into
your `~/.claude/settings.json`.

Now the pet thinks when you submit a prompt, works while tools run, and cheers
when Claude finishes (and quiets down on session end). The hook script fails
silently if the pet isn't running. If you set a `PET_TOKEN`, export it in the
environment Claude Code runs in too.

**Confirm / permission prompts.** When Claude needs your approval to run a tool
it fires a **`PermissionRequest`** event, and usually a `permission_prompt`
`Notification` too; the pet treats them as one prompt (counted once, notified
once). It bounces with a `!` badge, chimes, and shows the message plus an
**"Open editor →"** link. Clicking the link focuses your editor on the project so you can answer.
The idle "Claude is waiting for your input" reminder is ignored — it isn't a
prompt, just the end of a turn. Subagents finishing count as progress, not as
finished tasks. Each event carries Claude Code's `session_id`, so separate
sessions don't interfere with each other.
Poking the pet only dismisses its reminder. Make sure the
`PermissionRequest` hook from the example is in your settings (older setups that
only wired up `Notification` won't react to permission prompts). The link is
auto-built from the project path and editor:

- `PET_EDITOR_SCHEME` — force the scheme (`vscode`, `vscode-insiders`, `cursor`,
  `windsurf`). Default: auto-detected from the terminal, falling back to `vscode`.
- `PET_OPEN_URL` — override the link entirely with a URL of your choice.

If Claude Code is running in a plain terminal on macOS, the link reads **"Open
terminal →"** and brings that terminal app forward (iTerm, Terminal, Warp,
Ghostty, WezTerm, Hyper, Tabby, kitty, Alacritty — detected from
`TERM_PROGRAM`). Elsewhere the pet still bounces + chimes and shows the message,
just without a clickable link.

The **answer-confirm shortcut** (`Cmd/Ctrl+Alt+Shift+J` by default) does the same
for the newest waiting prompt without reaching for the mouse, and stops the pet
nudging about it.

### ChatGPT / Gemini web (automatic, via userscript)

There's no hook system for the web UIs, so a small **userscript** infers the
state from the page (it watches for the "stop generating" button, which only
exists while the model is streaming) and pings the pet for you.

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/) in your browser.
2. Create a new script and paste in
   [hooks/pet-userscript.user.js](hooks/pet-userscript.user.js).
3. Copy the control-server token from **Settings ▸ Advanced** into the
   `TOKEN` constant at the top of the script (or use your `PET_TOKEN` override).

Now ChatGPT and Gemini drive the pet automatically: it shows that AI's tint +
badge while a response streams and cheers when it's done. The script is scoped
to `chatgpt.com`, `chat.openai.com`, and `gemini.google.com`. Open both in
tabs at once and you'll get the multi-AI team-up animation for free.

### Anything else (DeepSeek, APIs, CLIs)

Trigger the same endpoint from wherever you can:

- **API wrappers / your own scripts**: call `localhost:7337/state` before/after
  a request (or use [hooks/pet-notify.js](hooks/pet-notify.js)):
  ```bash
  PET_SOURCE=chatgpt node hooks/pet-notify.js thinking "asking ChatGPT..."
  PET_SOURCE=chatgpt node hooks/pet-notify.js happy "got an answer!"
  PET_SOURCE=gemini node hooks/pet-notify.js working "asking Gemini..."
  ```
- **CLI tools**: wrap them with [hooks/pet-wrap.sh](hooks/pet-wrap.sh), which
  pings the pet around any command and passes its exit code straight through:
  ```bash
  PET_SOURCE=aider ./hooks/pet-wrap.sh aider --model sonnet
  ./hooks/pet-wrap.sh npm test
  ```

[hooks/OTHER-AGENTS.md](hooks/OTHER-AGENTS.md) has ready-made wiring for Codex
CLI, Aider, Cursor/VS Code tasks, git hooks, and raw HTTP.

### The `pet` command

`package.json` exposes a `pet` bin (run `npm link` once, or `npx pet …`) that
wraps the notifier so any script can drive the pet in one word:

```bash
pet working "building..."   # show a working mood + bubble
pet done                    # cheer
pet error "tests failed"    # error buzz
pet idle                    # back to idle
pet --help                  # the full list of moods and aliases
```

Busy moods sent this way carry a safety-net TTL, so a script that crashes or
gets Ctrl-C'd before its `pet done` can't leave the pet working forever. An
unrecognized mood exits `2` with a usage message rather than quietly resetting
the pet to idle.

It honours the same `PET_SOURCE` and `PET_TOKEN` env vars, e.g.
`PET_SOURCE=ollama pet thinking "asking llama3..."`. `PET_PORT` overrides the
port, which it otherwise reads from the app's config.

## Project layout

```
src/
  main.js            Electron main: window, tray, play menu, drag, throw physics, wander, focus timer, hotkeys, stats, away summary, notifications, updates, starts the server
  claude-hooks.js    Pure merge of the pet's hooks into Claude Code's settings.json (used by the installer)
  preload.js         Safe IPC bridge to the pet renderer
  settings-preload.js  IPC bridge for the settings window
  stats-preload.js   Read-only IPC bridge for the activity window
  server.js          Local control server (the AI -> pet endpoint + token auth)
  store.js           Tiny JSON config store (position, settings, stats, events, unlocks) in userData
  quiet.js           Do-not-disturb window maths (pure, so it's testable without Electron)
  renderer/
    index.html       Pet markup (body, skins, cosmetics, ring, badges)
    style.css        Pet art + mood animations + skins + cosmetics + per-source tint
    pet.js           Behavior: moods, bubbles, idle loop, click/drag, sounds, ctx ring, skins, focus, easter eggs
    settings.html    Settings window markup (name, color, skin, cosmetic, behavior, quiet hours, focus, advanced, sprite art)
    settings.js      Settings window behavior
    stats.html       Activity window markup (7-day chart, per-AI table, recent events)
    stats.js         Activity window rendering
hooks/
  pet-notify.js      Sends a mood to the pet (CLI args or hook JSON on stdin)
  pet-wrap.sh        Runs any command with the pet reacting to it, passing the exit code through
  pet-userscript.user.js  Browser userscript: ChatGPT/Gemini web -> pet (auto)
  claude-settings-example.json
  OTHER-AGENTS.md    Wiring up Codex, Aider, Cursor, git hooks, and raw HTTP
build/
  icon.png           App icon (electron-builder converts it per platform)
  entitlements.mac.plist
pettest.js           Server + hook + quiet-hours tests (npm run test:server)
wiringtest.js        Loads main.js against a stubbed Electron to check the IPC
                     handlers, tray menu, and settings/stats payloads (npm run test:wiring)
renderertest.js      Runs pet.js against a tiny DOM + fake clock: gestures, confirms,
                     sessions, sleep, walking
.github/workflows/   CI: npm test + 3D bundle build on every push and PR
```

## Swapping in real art (sprite sheets)

The default pet is hand-built from CSS (no image assets — crisp at any size and
consistent across every mood and skin). To use your own art instead, open
**Settings ▸ Sprite art ▸ Choose image…** and pick a sheet. No config-file
editing, no restart.

Lay the sheet out as a grid: **columns are animation frames, rows are moods**,
top to bottom, every frame square:

```
row 0  idle      [f0][f1][f2][f3][f4][f5]
row 1  thinking  [f0][f1][f2][f3][f4][f5]
row 2  working   [f0][f1][f2][f3][f4][f5]
row 3  happy     …
row 4  stressed  …
row 5  sleeping  …
row 6  error     …
```

Then set **Columns**, **Rows**, and **FPS** to match. A sheet with fewer than
seven rows just reuses its last row for the remaining moods, so a two-row
idle/working sheet still animates everything. PNG, GIF, or WebP, up to 4 MB.

The image is copied into the app's userData dir (as `sprite.png`/`.gif`/`.webp`,
next to `pet-config.json`), so your sheet keeps working if you move or delete the
original. It is kept out of the config file itself, which is rewritten on every
AI event and read by every hook call. Configs from older versions that held the
image inline are moved over automatically.

When a sprite is active the CSS character is hidden and the sheet plays the
matching mood row; cosmetics, the AI ring, badges, speech bubble, and particles
still layer on top. **Use drawn pet** puts the CSS art back. (Reduce-motion
pauses the sprite on its first frame.)

<details>
<summary>Hand-editing the config instead</summary>

The GUI writes a `sprite` block into `pet-config.json` in the app's userData
dir. You can still write one yourself for finer control — per-mood row/frame
counts and per-mood FPS:

```json
{
  "sprite": {
    "file": "sprite.png",   // in the userData dir — or "url": a path under src/renderer/
    "cols": 6,
    "rows": 7,
    "fps": 8,
    "moods": {
      "idle":     { "row": 0, "frames": 4 },
      "thinking": { "row": 1, "frames": 4 },
      "working":  { "row": 2, "frames": 6 },
      "happy":    { "row": 3, "frames": 4 },
      "stressed": { "row": 4, "frames": 4 },
      "sleeping": { "row": 5, "frames": 2, "fps": 3 },
      "error":    { "row": 6, "frames": 4 }
    }
  }
}
```

Picking a new sheet in Settings overwrites the `moods` map with the default
one-row-per-mood layout.

</details>

## Staying out of your way

The pet is built to be noticeable exactly when it matters and invisible the rest
of the time.

- **Quiet hours** (Settings ▸ Quiet hours, or the tray's Behavior menu) — set a
  do-not-disturb window and the pet keeps working, keeps counting, and keeps
  showing its mood, but stops chiming, stops sending notifications, and stops
  escalating its nudges. The window wraps past midnight (`22:00` → `08:00`).
- **Notify when hidden** — hiding the pet used to mean a permission prompt had
  nowhere to appear. Now a confirm or error arrives as a system notification;
  clicking it brings the pet back, or jumps straight to your editor when the
  event carried a link. Turn it off in Settings ▸ Behavior.
- **Mute** silences chimes without hiding anything.
- **While you were away** — when you come back (unhiding the pet, or returning
  after 5+ minutes away from the keyboard) it sums up what finished, what failed,
  and what's still waiting on you. The once-a-day greeting likewise waits for your
  first activity of the day rather than firing at midnight.

## Seeing what happened

Tray ▸ **Activity…** opens a window with:

- **totals** for the week and all time,
- a **7-day chart** of completed tasks,
- **today by assistant** — tasks, active time, confirms and errors per AI,
- the **recent-event log**.

It updates live while it's open. The tray's **Today** and **Recent** submenus
show the same data in a glanceable form.

## Packaging (distributables)

[electron-builder](https://www.electron.build/) is already configured in
`package.json`. After `npm install`:

```bash
npm run dist          # build for your current OS
npm run dist:mac      # .dmg
npm run dist:win      # NSIS .exe installer
npm run dist:linux    # AppImage
```

Output lands in `dist/`. macOS builds include both DMG and ZIP artifacts; publish
both so the updater has its required ZIP payload. The same code produces all three. The app icon comes
from [build/icon.png](build/icon.png) — electron-builder converts it to `.icns`
and `.ico` per platform. The `hooks/` folder ships alongside the app (in
`Contents/Resources/hooks` on macOS), so someone who installed the `.dmg` still
has `pet-notify.js` to point their Claude Code hooks at.

### Releasing updates

Packaged builds check for a new release on launch and offer a **Restart to
update** item in the tray once one has downloaded. (Toggle the check in
Settings ▸ Advanced.) The update channel is GitHub Releases, configured in the
`build.publish` block of `package.json`:

```jsonc
"publish": [{ "provider": "github", "owner": "jimabby", "repo": "desktop-pet" }]
```

Bump `version`, then `GH_TOKEN=… npm run dist:mac -- --publish always`.
electron-builder writes `app-update.yml` into the bundle and uploads the
artifacts plus the `latest-*.yml` manifests the updater reads to a draft
release; publish the draft to ship it. **Check for updates…** stays disabled in a
dev run.
Updates on macOS require the build to be **signed** (see below); an unsigned app
can download an update but not install it.

### Signing & notarizing the macOS build

Without this, macOS Gatekeeper shows a scary *"app is damaged / from an
unidentified developer"* warning and users must right-click → Open. A signed +
notarized `.dmg` opens cleanly. The build is **already configured** for it
(hardened runtime, `build/entitlements.mac.plist`, `"notarize": true`); you just
supply the credentials.

**One-time setup:**

1. **Create a *Developer ID Application* certificate** (this is _not_ the same as
   the "Apple Development" cert Xcode makes by default). In Xcode → Settings →
   Accounts → your team → **Manage Certificates… → + → Developer ID Application**,
   or via [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates).
   Confirm it landed in your keychain:

   ```bash
   security find-identity -v -p codesigning   # look for "Developer ID Application: …"
   ```

2. **Make an app-specific password** for notarization at
   [appleid.apple.com](https://appleid.apple.com) → Sign-In & Security →
   App-Specific Passwords.

3. **Find your Team ID** at [developer.apple.com/account](https://developer.apple.com/account)
   (Membership details) — a 10-character string like `AB12CD34EF`.

**Build:** export the three notarization vars and run the mac target. electron-builder
auto-discovers the Developer ID cert in your keychain and notarizes via `notarytool`:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="AB12CD34EF"
npm run dist:mac
```

Notarization adds a few minutes (Apple processes the upload). On success the
ticket is stapled into the `.dmg` in `dist/`. Verify:

```bash
spctl -a -vvv -t install "dist/Desktop Pet-0.1.0.dmg"   # → "accepted / source=Notarized Developer ID"
```

If the cert lives in a `.p12` file instead of the keychain (e.g. CI), point
electron-builder at it with `CSC_LINK=/path/to/cert.p12` and
`CSC_KEY_PASSWORD=…` instead of relying on keychain discovery.


## Blender characters: Kitten 3D / Puppy 3D

Run `npm start`, right-click the pet, then choose **Settings… → Appearance →
Kitten 3D / Puppy 3D**. The selection is saved. Settings shows a live 3D preview.
If a custom sprite sheet is active, choose **Sprite art → Use drawn pet** to
reveal the 3D character. The color palette changes their fur and markings while
keeping eyes, noses, and cream patches intact. **Natural** restores the original
coat. Settings previews both colors and cosmetics. Bow tie and Flower are free;
Glasses unlock at 10 tasks, Cap at 20, Headphones at 30, Scarf at 50, and Crown
at 120. Select **None** to remove the equipped accessory.

These are original Blender models with 18 bones each: torso, head, jaw, eyes,
independent ears, four legs, four paws and a two-part tail, plus the root.
They contain 16 animation clips: idle, working, happy, sleeping, wave, dance,
curious, shake, yawn, kiss, grabbed, petting, sniff, paw, groom and walk (a trot
played while the pet wanders, turned toward the direction of travel). Right-click
the pet to try the tricks.
Cursor head tracking and blinking layer over the animations. Existing spin and
backflip effects move the whole character. Reduced motion uses a still pose;
hidden windows stop rendering. If WebGL/model loading fails, the drawn pet remains.

- Editable sources: `assets/blender/kitten.blend`, `assets/blender/puppy.blend`
- Packaged models: `src/renderer/models/*.glb`
- Reproducible model generator: `scripts/create-animals.py`
- Renderer: `src/renderer/pet3d.js` (Three.js, bundled locally)

Blender is only needed to edit/regenerate art. The desktop pet renders the GLB
files directly and works offline. `npm start` and `npm run dist*` build the
renderer bundle automatically. After source changes, use `npm run build:3d`.

See [the Blender asset notes](assets/blender/README.md) for regeneration and
editing instructions. Run `npm run test:3d` for GLB joint/animation checks and
an isolated Electron/WebGL smoke test, including live Settings previews.

## Validation commands

```bash
npm test          # server/hooks, main wiring, renderer, session clocks, config/export safety
npm run test:3d   # actual Electron/WebGL models, cosmetics, animation and Settings checks
npm run test:ui   # isolated real Electron companion center and integration checks
npm audit         # includes the build dependency graph
```

The UI tests use temporary profiles and do not install hooks or edit your live
pet configuration. Native signing/notarization, update installation, OS login,
notifications, and monitor/drag behavior should also be checked on release
hardware for each supported platform.
