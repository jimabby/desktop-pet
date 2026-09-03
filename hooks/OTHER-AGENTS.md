# Hooking up other assistants

The pet has no idea which assistant is talking to it — it just takes HTTP POSTs
on its local control server. Anything that can run a command or make a request
can drive it. `claude-settings-example.json` covers Claude Code and
`pet-userscript.user.js` covers ChatGPT/Gemini in the browser; this file covers
everything else.

Two things every integration needs:

- **The port.** Normally 7337. If that was taken the pet falls back to the next
  free port and writes it into its config; `pet-notify.js` reads that
  automatically, and the pet's Settings ▸ Advanced ▸ Connection shows it.
- **The token.** Generated on first run, since the control server is otherwise
  reachable from any web page you have loaded. `pet-notify.js` reads it from the
  pet's config file for you. Anything that can't read that file (a browser
  userscript, another machine) needs the value from Settings ▸ Advanced.

Set `PET_SOURCE` so the pet can tell your assistants apart — it tints the pet,
labels the badge, and keeps a separate row in the activity window.

## Any CLI — wrap it

`pet-wrap.sh` pings the pet around any command and passes the exit code through:

```bash
PET_SOURCE=aider ./hooks/pet-wrap.sh aider --model sonnet
./hooks/pet-wrap.sh npm test
```

As a shell alias, so every run of a long build reports back:

```bash
alias build='~/desktop-pet/hooks/pet-wrap.sh npm run build'
```

## Codex CLI / Aider / any REPL-style agent

These don't expose per-event hooks, so wrap the session as a whole — the pet
shows "working" for as long as the agent is running:

```bash
PET_SOURCE=codex ./hooks/pet-wrap.sh codex
PET_SOURCE=aider ./hooks/pet-wrap.sh aider
```

For finer-grained reactions, Aider can run a command on each commit:

```bash
# .aider.conf.yml
lint-cmd: "node ~/desktop-pet/hooks/pet-notify.js working 'aider is editing...'"
test-cmd: "node ~/desktop-pet/hooks/pet-notify.js done 'aider finished'"
```

## Cursor / VS Code tasks

Add a task that pings the pet, then chain it as a `dependsOn` of your build:

```jsonc
// .vscode/tasks.json
{
  "label": "pet: working",
  "type": "shell",
  "command": "node ${workspaceFolder}/../desktop-pet/hooks/pet-notify.js working 'building...'",
  "presentation": { "reveal": "never" }
}
```

Set `PET_EDITOR_SCHEME=cursor` so the confirm bubble's link opens Cursor rather
than VS Code.

## Git hooks

```bash
# .git/hooks/pre-push
node ~/desktop-pet/hooks/pet-notify.js working "pushing..."

# .git/hooks/post-commit
node ~/desktop-pet/hooks/pet-notify.js done "committed ✓"
```

## Raw HTTP — anything at all

```bash
TOKEN=$(node -e "…read it from Settings…")
curl -s localhost:7337/state \
  -H 'Content-Type: application/json' \
  -H "X-Pet-Token: $TOKEN" \
  -d '{"source":"ollama","mood":"working","text":"asking llama3...","ttl":30000}'
```

Fields: `mood` (idle | thinking | working | happy | stressed | sleeping |
error), `text`, `source`, `ttl` (ms until the pet clears this source on its
own — **always set one** for a busy mood, or the pet stays busy forever if your
script dies), `ctx` (context size in tokens, drives the usage ring), `attention`
(true for a prompt that needs the user), `link` + `linkText` (a deep link the
user can click; only http/https/vscode/cursor/windsurf schemes are accepted).

`GET /health` needs no token and answers `{"ok":true}` — use it to check the pet
is up before wiring anything else.
