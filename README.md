# 🐾 Desktop Pet

A cross-platform (macOS + Windows + Linux) desktop companion built with Electron.
It floats on top of your screen, you can drag/poke/chat with it, and it **reacts
when an AI assistant (Claude, ChatGPT, Gemini, DeepSeek, …) is working**.

> v1 uses a simple CSS slime as placeholder art. Swap in sprite sheets later
> without touching any of the behavior code.

## Features

- Transparent, frameless, always-on-top window
- **Click-through** on empty areas — it won't block the app behind it
- **Drag** to reposition anywhere — **position is remembered** across restarts
- **Click/poke** reactions
- **Speech bubbles**
- **Idle behaviors**: blinking, little hops, falls asleep when ignored
- **Per-AI tint** — a colored glow shows which assistant is driving it
- **Sound chimes** on done/error (toggle from the tray)
- **Tray menu**: show/hide, mute sounds, launch at login, reset position, quit
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
show/hide, mute sounds, launch at login, reset position, quit — lives in the
**tray icon** (the menu bar on macOS; there's no dock icon by design).

## How AI reactions work

When the app runs it starts a local control server on `http://127.0.0.1:7337`.
Anything that POSTs a mood makes the pet react:

```bash
curl -s localhost:7337/state \
  -H 'Content-Type: application/json' \
  -d '{"mood":"working","text":"Refactoring auth...","source":"chatgpt","ttl":8000}'
```

| field    | values                                                        |
| -------- | ------------------------------------------------------------- |
| `mood`   | `idle` `thinking` `working` `happy` `sleeping` `error`        |
| `text`   | optional speech-bubble message                                |
| `source` | optional label shown before the text (e.g. `claude`)          |
| `ttl`    | optional ms, then the pet returns to idle automatically       |

`GET /health` returns `{ ok: true }` so scripts can check the pet is up.

The `source` is also used to tint the pet (`claude`, `chatgpt`, `gemini`,
`deepseek` each get their own glow color); `happy` and `error` moods play a
short chime unless you've muted sounds from the tray.

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

`hooks/pet-notify.js` reads `PET_TOKEN` from its environment automatically, so
export the same value wherever your hooks run. `/health` stays public.

### Claude Code (automatic)

1. Open [hooks/claude-settings-example.json](hooks/claude-settings-example.json).
2. Replace `ABSOLUTE_PATH` with the full path to this folder.
3. Merge the `hooks` block into your `~/.claude/settings.json`.

Now the pet thinks when you submit a prompt, works while tools run, and cheers
when Claude finishes (and quiets down on session end). The hook script fails
silently if the pet isn't running. If you set a `PET_TOKEN`, export it in the
environment Claude Code runs in too.

### ChatGPT / Gemini / DeepSeek / anything else

There's no universal hook system for those, so trigger the same endpoint from
wherever you can:

- **API wrappers / your own scripts**: call `localhost:7337/state` before/after
  a request (or use [hooks/pet-notify.js](hooks/pet-notify.js)):
  ```bash
  node hooks/pet-notify.js working "asking ChatGPT..."
  node hooks/pet-notify.js happy "got an answer!"
  ```
- **Browser extension / userscript** (ChatGPT/Gemini web): watch for the
  "generating" state and `fetch('http://localhost:7337/state', …)`. CORS is open.
- **CLI tools**: wrap them in a shell function that pings the pet around the call.

## Project layout

```
src/
  main.js            Electron main: window, tray, drag, position, starts the server
  preload.js         Safe IPC bridge to the renderer
  server.js          Local control server (the AI -> pet endpoint, optional token)
  store.js           Tiny JSON config store (position + settings) in userData
  renderer/
    index.html       Pet markup
    style.css        Pet art + mood animations + per-source tint (placeholder CSS slime)
    pet.js           Behavior: moods, bubbles, idle loop, click/drag, sounds
hooks/
  pet-notify.js      Sends a mood to the pet (CLI args or hook JSON on stdin)
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
