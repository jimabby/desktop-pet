# Project audit — 11 October 2026

## Implementation follow-up

The findings below are the original audit record. The subsequent implementation
addresses all eleven prioritized defects and adds all six proposed feature areas.

- Authentication now uses one effective token and a private running-instance
  descriptor; installed hooks select their exact config. Settings shows overrides.
- macOS targets include DMG and ZIP. Task lifecycle and event identity are
  independent of mood, with per-session clocks and bounded leases/heartbeats.
- Main owns prompt acknowledgement/snooze state; renderer notices, focus changes,
  and dragging preserve prompts. Source-wide clears agree in both processes.
- Browser tabs and wrapped commands have separate sessions. Sprite replacement
  validates before atomic replacement. Activity updates follow event persistence;
  resets update all views. Statistics use safe own-property dictionary entries.
- Companion center supplies diagnostics, a prompt/session inbox, quiet/presentation
  controls, persistent affection/treats/toy, perch/profiles, backups and CSV exports.
- Additional gaps addressed: explicit unsupported Linux login control, manual CLI
  errors, rate-limited browser connection errors, fresh hook-settings merge after
  confirmation, keyboard focus preservation, config validation/recovery, small
  display sizing, and suspend/resume handling. Reduced motion also suppresses blinks.
- Build dependency override updates global-agent to its compatible bootstrap API
  on the maintained v4 line, removing the vulnerable transitive logging chain.

Validation includes the expanded `npm test`, actual Electron companion UI and
WebGL tests, an unsigned macOS packaging smoke build, and dependency auditing.
No signed upgrade, notarization, or native Windows/Linux interactive certification
is claimed. Those require release credentials and platform hardware.


Reviewed the main process, persistence, HTTP server, IPC bridges, pet/settings/activity renderers, 3D rendering and assets, integrations, build configuration, CI, documentation, and tests. Application code was not changed. P1 means a supported workflow is blocked; P2 means a functional defect worth fixing next.

## Prioritized findings

1. **P1 — `PET_TOKEN` overrides break authentication.** `src/main.js:1928` prefers the saved token, and `ensureToken()` guarantees one exists. `hooks/pet-notify.js:61` prefers the environment token. Launching both with the documented override therefore makes the hook receive 401 responses. Use one effective-token policy in the server, Settings, and notifier; make environment overrides visible in Settings.

2. **P1 — macOS releases lack the update payload.** `package.json:50` explicitly builds only `dmg`; the installed `electron-updater` Mac implementation selects a ZIP and rejects a release without it. Add `zip` alongside `dmg` and validate a signed upgrade between two versions. This requirement is also documented in the [electron-builder v26 update guide](https://www.electron.build/v26/docs/features/auto-update/). Packaging and a real signed upgrade were not executed during this review.

3. **P2 — distinct completed tasks are discarded as duplicates.** `src/main.js:658` deduplicates by source, kind, and text for 90 seconds, excluding session and task identity. Claude Stop always normally says `done!`. A targeted reproduction with completions from sessions A and B counted **one task instead of two**. Two fast turns in the same session are also collapsed. This affects daily/lifetime totals, unlocks, and away summaries. Introduce explicit event/task identity; keep notification-repeat suppression separate from task accounting.

4. **P2 — mood is incorrectly used as task lifecycle.** `hooks/pet-notify.js:92` sends SessionStart as `happy`, which `recordStat()` counts as a completion. Conversely, lines 355–357 turn Stop into `stressed` above the context threshold, so a real completion is not counted. The actual notifier reproduced `SessionStart → happy` and a 150k-context `Stop → stressed`. Preserve completion/start semantics independently of the visual mood.

5. **P2 — confirmation state diverges between main and renderer.** `src/main.js:577` replaces an existing confirmation without preserving its `acked` flag, so a duplicate notification reopens a hotkey-acknowledged prompt. Source-wide idle deletes only one main-process key, while the renderer deletes every session for that source. Bubble clicks and pokes clear renderer confirmations without informing main. Reproductions confirmed acknowledgement loss and a stale main confirmation after source-wide idle. Use main as the authoritative prompt store, with explicit per-session acknowledgement IPC and consistent clear rules.

6. **P2 — low-priority messages can obscure a permission prompt.** `src/renderer/pet.js:772` handles notices with unconditional `say()`, replacing the prompt and clearing its clickable link. Focus transitions similarly overwrite its message/mood. Reproduced a notice replacing `allow?` and a break changing a waiting pet to sleeping. Also, an AI TTL expiring during a break returns the pet to idle rather than sleep. Apply a shared priority order: pending confirmation, active AI, focus phase, then incidental messages. Defer greetings/unlock notices until prompts are resolved.

7. **P2 — stale development config can disconnect the packaged app's hooks.** `hooks/pet-notify.js:42` always accepts the first readable `desktop-pet` config before trying `Desktop Pet`, without checking which instance is running. On a case-sensitive filesystem where both directories exist, a previous development install can supply the wrong port/token after installing a packaged build. Pass the intended config path from the installer or use explicit instance discovery. This is conditional on distinct directories; default case-insensitive macOS storage may alias them.

8. **P2 — concurrent browser tabs and wrapped commands overwrite each other.** `hooks/pet-userscript.user.js:58` sends no session identifier. Manual notifier mode likewise leaves SESSION empty, and `pet-wrap.sh` provides no per-command identity. Two ChatGPT tabs or two wrapped commands therefore share a source key; one completing can replace another's working state. Generate stable per-tab/per-command session IDs and reuse them on every lifecycle event. Browser DOM selector compatibility was not live-tested against the services.

9. **P2 — failed sprite replacement can delete the working image.** `src/main.js:1561` removes existing sprite files before copying the replacement. A copy/read failure leaves the saved config pointing at a missing image. Selecting the managed sprite itself also deletes the source before copying it. Copy and validate into a temporary file first, then atomically replace the managed image and update metadata. Image decoding is also not validated before hiding the drawn pet.

10. **P2 — activity updates omit the event that triggered them.** `src/main.js:629` calls `pushActivity()` before `logEvent()` at line 633. An open Activity window receives new counts with the previous event list, and the latest event stays absent until another refresh. Reset today and Clear log rebuild only the tray; Reset today also leaves weekly history and renderer totals unchanged until later activity. Centralize store mutations and publish all derived views afterwards.

11. **P2 — special source names collide with inherited object properties.** `src/main.js:599` uses `s.perAi[src]` on an ordinary object. An authenticated state with source `__proto__` selects Object.prototype rather than creating a stats entry; the targeted reproduction recorded no enumerable assistant and wrote statistics fields onto the prototype. Names such as `constructor` also collide. Use an own-property check and safe dictionary entries (including after JSON loading), or a Map. This is an authenticated input-handling issue, not an unauthenticated remote exploit.

## Additional gaps

- Active duration is not measured per task/session. Busy-event gaps under a minute count, including some permission-wait/idle gaps; the final busy-to-completion interval is omitted. Sparse or long-running work can show zero activity. Track task intervals and explicit waiting/idle transitions.
- Linux has no autostart implementation here: the menu only calls Electron's login-item API and saves a flag. Add an XDG autostart entry or mark the option unsupported. Linux native behavior was not exercised.
- The userscript ignores non-success HTTP responses; wrong tokens and ports look like silent inactivity. The notifier intentionally fails quietly for hook safety, but manual CLI mode could report useful errors.
- The hook installer reads settings before awaiting its confirmation dialog, then writes that snapshot. Concurrent edits while the dialog is open can be lost. Re-read and merge immediately before writing.
- Settings keyboard selection rebuilds all swatches/chips, removing the focused element. Preserve focus on the selected replacement control.
- Config loading merges defaults but does little type validation for coordinates, events, statistics, and history. A malformed but valid JSON config can still break startup. Validate fields and preserve a recoverable backup.
- Default 45-second hook TTL and 120-second CLI TTL can mark a long-running tool idle while it is still running. Heartbeats or explicit lifecycle leases would distinguish slow work from abandoned sessions.
- Native monitor changes, maximum scaling on small screens, dragging, system notifications, login behavior, sleep/resume, and Windows/Linux packaging still need manual platform checks.

## Validation

- `npm test`: passed, including 80 server/hook checks, main-process wiring checks, and deterministic renderer regressions.
- `npm run test:3d`: passed bundle build, both GLB skeleton/animation checks, and actual isolated Electron/WebGL checks for kitten/puppy animation, appearance, all seven cosmetics, reduced motion, rapid switching, fallback, and Settings preview.
- Additional isolated executions of real source reproduced task deduplication, confirmation acknowledgement loss, stale source-wide confirms, special-source handling, prompt replacement, and focus-break restoration defects. The notifier was also exercised against a temporary HTTP receiver and transcript. These probes used temporary/in-memory state, not the user's live pet configuration.
- `npm audit`: eight moderate dependency entries, all in the development/build chain stemming from the reported sprintf-js advisory. This is not eight independent vulnerabilities. No high or critical findings. The proposed automatic fix includes a builder downgrade, so it needs review rather than blind application.
- `npm audit --omit=dev`: zero reported vulnerabilities. This does not certify every runtime component or establish exploitability of the build-time advisory.
- No release was published, no hooks installed, and no application source fixes made.

## Features worth adding

These are proposals based on the project's existing behavior, in recommended order.

1. **Integration diagnostics.** Show the last received event, assistant/session, last successful connection, effective port/token override status, and a Test connection button. Offer a redacted diagnostic export. This directly addresses silent setup failures.
2. **Session and prompt inbox.** List active sessions with project labels, pending prompts, elapsed work/wait time, and Open / Acknowledge / Snooze actions. Make simultaneous assistants useful beyond a badge count.
3. **Temporary do-not-disturb and presentation mode.** Offer 15/30/60-minute snooze, quiet-until-focus-ends, and optional hiding during presentations. Keep prompts in the inbox for later.
4. **Persistent affection and small interactions.** Save a lightweight bond level; add a treat, a toy to follow, and a few earned reactions. Avoid punitive hunger/decay so a productivity companion does not become a chore.
5. **Position and behavior profiles.** Remember preferred display/corner, offer a stationary perch, and save Work / Play / Minimal profiles with size, sound, wandering, and appearance settings.
6. **Settings backup and activity export.** Export/import versioned settings and sprite art, with tokens excluded by default. Export session statistics as CSV after fixing task and duration accounting.

Suggested implementation sequence: repair authentication and macOS updates; establish a single event/session lifecycle with regression tests; fix prompt priority and Activity synchronization; then build diagnostics and the session inbox. Cosmetic additions can follow on that foundation.
