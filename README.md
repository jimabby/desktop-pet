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
- **Resize** — scroll over the pet (or use the tray) to scale it 0.6×–2.5×, **size is remembered**
- **Click/poke** reactions — keep petting and it warms up, showering hearts
- **Eyes follow your cursor** while idle, so it feels like it's watching you
- **Decorations**: a little leaf sprout on its head + ambient sparkles
- **Speech bubbles**
- **Idle behaviors**: blinking, little hops, sparkles, falls asleep when ignored
- **Per-AI tint + badges** — a colored glow and badges show which assistant is driving it
- **Multi-AI mode** — if Claude, ChatGPT, Gemini, etc. are active together, the pet switches into a team-up bounce
- **Sound chimes** on done/error (toggle from the tray)
- **Confirm prompts** — when an AI needs your approval, the pet bounces with a `!`, chimes, and shows a clickable link back to your editor
- **Tray menu**: show/hide, mute sounds, resize, launch at login, reset position, quit
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
| `mood`     | `idle` `thinking` `working` `happy` `sleeping` `error`              |
| `text`     | optional speech-bubble message                                      |
| `source`   | optional label shown before the text (e.g. `claude`)               |
| `ttl`      | optional ms, then the pet returns to idle automatically            |
| `link`     | optional URL opened when the bubble (or pet) is clicked; safe schemes only (`http` `https` `vscode` `vscode-insiders` `cursor` `windsurf`) |
| `linkText` | optional label for that link (default `Open →`)                     |
| `attention`| optional bool; `true` marks a confirm/permission prompt so the pet bounces + chimes for you, even when no `link` is provided |

`GET /health` returns `{ ok: true }` so scripts can check the pet is up.

The `source` is also used to tint the pet (`claude`, `chatgpt`, `gemini`,
`deepseek` each get their own glow color). Active sources also appear as little
badges above the pet. If multiple sources are active at once, the pet shows a
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

**Confirm / permission prompts.** On Claude Code's `Notification` event (when it
needs your approval or is waiting on you), the pet bounces with a `!` badge,
chimes, and shows the message plus an **"Open editor →"** link. Clicking the link
— or just poking the pet — focuses your editor on the project so you can answer.
The link is auto-built from the project path and editor:

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
