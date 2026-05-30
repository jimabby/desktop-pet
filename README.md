# 🐾 Desktop Pet

A cross-platform (macOS + Windows + Linux) desktop companion built with Electron.
It floats on top of your screen, you can drag/poke/chat with it, and it **reacts
when an AI assistant (Claude, ChatGPT, Gemini, DeepSeek, …) is working**.

> v1 uses a simple CSS slime as placeholder art. Swap in sprite sheets later
> without touching any of the behavior code.

## Features

- Transparent, frameless, always-on-top window
- **Click-through** on empty areas — it won't block the app behind it
- **Drag** to reposition anywhere
- **Click/poke** reactions
- **Speech bubbles**
- **Idle behaviors**: blinking, little hops, falls asleep when ignored
- **AI integration** via a tiny local control server + Claude Code hooks

## Run it

Requires [Node.js](https://nodejs.org) 18+.

```bash
cd desktop-pet
npm install
npm start
```

The pet appears bottom-right. Quit / reset position from the **tray icon**.

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

### Claude Code (automatic)

1. Open [hooks/claude-settings-example.json](hooks/claude-settings-example.json).
2. Replace `ABSOLUTE_PATH` with the full path to this folder.
3. Merge the `hooks` block into your `~/.claude/settings.json`.

Now the pet thinks when you submit a prompt, works while tools run, and cheers
when Claude finishes. The hook script fails silently if the pet isn't running.

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
  main.js            Electron main: window, tray, drag, starts the server
  preload.js         Safe IPC bridge to the renderer
  server.js          Local control server (the AI -> pet endpoint)
  renderer/
    index.html       Pet markup
    style.css        Pet art + mood animations (placeholder CSS slime)
    pet.js           Behavior: moods, bubbles, idle loop, click/drag
hooks/
  pet-notify.js      Sends a mood to the pet (CLI args or hook JSON on stdin)
  claude-settings-example.json
```

## Swapping in real art later

In `style.css` the pet is built from divs. To use sprite sheets instead, replace
the `.body` / mood classes with `background-image` sprites and step animations,
keyed off the same `mood-*` classes that `pet.js` already toggles. None of the
behavior code needs to change.

## Packaging (distributables)

Add [electron-builder](https://www.electron.build/) when you're ready to ship:

```bash
npm install --save-dev electron-builder
# then configure "build" in package.json and run `electron-builder`
```

It produces a `.dmg` (macOS) and `.exe`/NSIS installer (Windows) from the same code.
```
