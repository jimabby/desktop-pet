# 🐾 Desktop Pet

A cross-platform (macOS + Windows + Linux) desktop companion built with Electron.
It floats on top of your screen, you can drag/poke/chat with it, and it **reacts
when an AI assistant (Claude, ChatGPT, Gemini, DeepSeek, Copilot, Cursor, Ollama, …)
is working**.

> v1 uses a simple CSS slime as placeholder art. Swap in sprite sheets later
> without touching any of the behavior code.

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
- **Wander mode** — left alone, the pet occasionally strolls a few px on its own
- **Skins** — pick **slime**, **cat** (ears!), or **ghost** in Settings
- **Unlockable cosmetics** — earn **glasses**, a **scarf**, and a **crown** by
  racking up completed tasks, then equip them in Settings
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
- **Idle behaviors**: blinking, little hops, sparkles, falls asleep when ignored
- **Respects "reduce motion"** — calms its looping animations if your OS asks
- **Per-AI tint + badges** — a colored glow and badges show which assistant is driving it
- **Multi-AI mode** — if Claude, ChatGPT, Gemini, etc. are active together, the pet switches into a team-up bounce
- **Context-usage ring** — a gauge around the pet fills (green → amber → red) as the
  conversation's context window fills up, with a compact `85k`-style token label
- **Daily stats** — the tray's **Today** menu tallies per-AI tasks, active time,
  confirms, and errors (resets each day)
- **Missed-event log** — the tray's **Recent** menu shows the last ~8 confirms,
  errors, and completions with how long ago they happened
- **Name + color** — name your pet and pick its body color in **Settings…** (saved)
- **Global hotkey** — show/hide the pet from anywhere (default `Cmd/Ctrl+Shift+P`)
- **Sound chimes** on done/error (toggle from the tray)
- **Confirm prompts** — when an AI needs your approval, the pet bounces with a `!`,
  chimes, and shows a clickable link back to your editor; **left unanswered it keeps
  nudging**, getting more insistent until you respond
- **Tray menu**: show/hide, focus session, Today stats, Recent log, settings,
  behavior toggles (wander / physics / time-of-day), resize, mute, launch at
  login, reset position, quit
- **AI integration** via a tiny local control server + Claude Code hooks
- **Optional token auth** so random web pages can't puppet your pet

## Run it

Requires [Node.js](https://nodejs.org) 18+.

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

Open **Settings…** from the tray. The window covers:

- **Name** — it'll introduce itself now and then, and the name shows in the tray
- **Color** — pick a body color from a palette
- **Skin** — slime, cat, or ghost
- **Cosmetic** — equip any headwear you've unlocked (locked ones show how many
  completed tasks they need: glasses at 10, scarf at 40, crown at 120)
- **Behavior** — toggle sound effects, time-of-day tint, wander, and throw physics
- **Focus** — set the work/break minutes for the Pomodoro timer
- **Advanced** — set the global show/hide **hotkey** (an Electron accelerator,
  blank to disable), the **stress threshold** (k tokens before the pet looks
  strained, 0 = off), and the control-server **token** (see *Locking it down*)

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
Anything that POSTs a mood makes the pet react:

```bash
curl -s localhost:7337/state \
  -H 'Content-Type: application/json' \
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
curl -s localhost:7337/state -H 'Content-Type: application/json' \
  -d '{"mood":"thinking","text":"Claude is planning...","source":"claude","ttl":15000}'
curl -s localhost:7337/state -H 'Content-Type: application/json' \
  -d '{"mood":"working","text":"ChatGPT is drafting...","source":"chatgpt","ttl":15000}'
curl -s localhost:7337/state -H 'Content-Type: application/json' \
  -d '{"mood":"thinking","text":"Gemini is checking...","source":"gemini","ttl":15000}'
```

Send a specific source back to idle when it finishes:

```bash
curl -s localhost:7337/state -H 'Content-Type: application/json' \
  -d '{"mood":"idle","source":"gemini"}'
```

Or clear every active AI:

```bash
curl -s localhost:7337/state -H 'Content-Type: application/json' \
  -d '{"mood":"idle"}'
```

`happy` and `error` moods play a short chime unless you've muted sounds from the
tray.

### Locking it down (optional token)

The control server only listens on `127.0.0.1`, but CORS is open so any web page
you visit could POST to it. To require a shared secret, launch the pet with a
`PET_TOKEN` set and send the same token as an `X-Pet-Token` header:

```bash
PET_TOKEN=hunter2 npm start
# then:
curl -s localhost:7337/state -H 'X-Pet-Token: hunter2' \
  -H 'Content-Type: application/json' -d '{"mood":"happy"}'
```

You can also set the token in **Settings… → Advanced** (it takes effect live, no
restart needed). `hooks/pet-notify.js` reads `PET_TOKEN` from its environment
automatically, and falls back to the token saved in the app's config file when
the env var isn't set — so a token typed into Settings reaches the hook too.
`/health` stays public.

### Claude Code (automatic)

1. Open [hooks/claude-settings-example.json](hooks/claude-settings-example.json).
2. Replace `ABSOLUTE_PATH` with the full path to this folder.
3. Merge the `hooks` block into your `~/.claude/settings.json`.

Now the pet thinks when you submit a prompt, works while tools run, and cheers
when Claude finishes (and quiets down on session end). The hook script fails
silently if the pet isn't running. If you set a `PET_TOKEN`, export it in the
environment Claude Code runs in too.

**Confirm / permission prompts.** When Claude needs your approval to run a tool
it fires a **`PermissionRequest`** event (idle/other notices use `Notification`);
the pet handles both — it bounces with a `!` badge, chimes, and shows the message
plus an **"Open editor →"** link. Clicking the link — or just poking the pet —
focuses your editor on the project so you can answer. Make sure the
`PermissionRequest` hook from the example is in your settings (older setups that
only wired up `Notification` won't react to permission prompts). The link is
auto-built from the project path and editor:

- `PET_EDITOR_SCHEME` — force the scheme (`vscode`, `vscode-insiders`, `cursor`,
  `windsurf`). Default: auto-detected from the terminal, falling back to `vscode`.
- `PET_OPEN_URL` — override the link entirely with a URL of your choice.

If Claude Code is running in a plain terminal (no detectable editor), the pet
still bounces + chimes and shows the message — just without a clickable link.

### ChatGPT / Gemini web (automatic, via userscript)

There's no hook system for the web UIs, so a small **userscript** infers the
state from the page (it watches for the "stop generating" button, which only
exists while the model is streaming) and pings the pet for you.

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/) in your browser.
2. Create a new script and paste in
   [hooks/pet-userscript.user.js](hooks/pet-userscript.user.js).
3. (Only if you launched the pet with `PET_TOKEN`) set the same value in the
   `TOKEN` constant at the top of the script.

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
- **CLI tools**: wrap them in a shell function that pings the pet around the call.

### The `pet` command

`package.json` exposes a `pet` bin (run `npm link` once, or `npx pet …`) that
wraps the notifier so any script can drive the pet in one word:

```bash
pet working "building..."   # show a working mood + bubble
pet done                    # cheer
pet error "tests failed"    # error buzz
pet idle                    # back to idle
```

It honours the same `PET_PORT`, `PET_SOURCE`, and `PET_TOKEN` env vars, e.g.
`PET_SOURCE=ollama pet thinking "asking llama3..."`.

## Project layout

```
src/
  main.js            Electron main: window, tray, drag, throw physics, wander, focus timer, hotkey, stats, starts the server
  preload.js         Safe IPC bridge to the renderer
  settings-preload.js  IPC bridge for the settings window
  server.js          Local control server (the AI -> pet endpoint, optional token)
  store.js           Tiny JSON config store (position, settings, stats, events, unlocks) in userData
  renderer/
    index.html       Pet markup (body, skins, cosmetics, ring, badges)
    style.css        Pet art + mood animations + skins + cosmetics + per-source tint
    pet.js           Behavior: moods, bubbles, idle loop, click/drag, sounds, ctx ring, skins, focus, easter eggs
    settings.html    Settings window markup (name, color, skin, cosmetic, behavior, focus, advanced)
    settings.js      Settings window behavior
hooks/
  pet-notify.js      Sends a mood to the pet (CLI args or hook JSON on stdin)
  pet-userscript.user.js  Browser userscript: ChatGPT/Gemini web -> pet (auto)
  claude-settings-example.json
pettest.js           Smoke test for the server + hook script (npm test)
```

## Swapping in real art later

In `style.css` the pet is built from divs. To use sprite sheets instead, replace
the `.body` / mood classes with `background-image` sprites and step animations,
keyed off the same `mood-*` classes that `pet.js` already toggles. None of the
behavior code needs to change.

## Packaging (distributables)

[electron-builder](https://www.electron.build/) is already configured in
`package.json`. After `npm install`:

```bash
npm run dist          # build for your current OS
npm run dist:mac      # .dmg
npm run dist:win      # NSIS .exe installer
npm run dist:linux    # AppImage
```

Output lands in `dist/`. The same code produces all three.
