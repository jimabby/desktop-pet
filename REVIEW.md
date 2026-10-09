# Project review

Reviewed the Electron main process, IPC bridges, renderer behavior and styles,
settings/activity UI, persistence, control server, hooks, launch and packaging
configuration, and existing tests. This is a source review with regression tests,
not a dependency vulnerability audit or cross-platform release certification.

## Fixed

- Non-object JSON (including `null`) could crash the local control server.
- Imported sprite data URLs were blocked by the pet page's image policy.
- Shell notifier paths broke when the installation directory contained spaces.
- Old reaction timers and action classes could interfere with incoming AI moods.
- Source expiry and idle sleep could visually overwrite an unanswered confirmation.
- Tray tricks could dismiss a confirmation and replace its message.
- A cleared bubble retained its pending link; the link also lacked keyboard activation.
- Interaction during a focus break returned the pet to idle instead of sleep.
- Reduced-motion styling missed several animations; particles depended solely on
  animation-end for cleanup.
- README instructions incorrectly made userscript authentication optional and
  claimed poking opened editor links.

## Character improvements

Four new tray tricks: yawn/stretch, curious head tilt, shake, and blow a kiss.
Expressions include coordinated eyes, mouth, arms and skin-specific ears, with
anticipation and recovery poses. Idle selection avoids consecutive repeats and
includes the new gestures. A yawn precedes sleep. Quiet hours and reduced motion
suppress spontaneous gestures; confirmation prompts take priority over tricks.

The character picker now contains Slime, Kitten 3D and Puppy 3D; retired
Cat/Ghost/Bunny selections fall back to Slime. The 3D models no longer inherit
whole-character CSS reactions (except deliberate flip/spin tricks). Clicking
uses a gentle head/ear/tail petting clip. Sniff, give a paw, and species-specific
grooming are available in the tray and the animals' idle repertoire. Interaction
clips play once and fade back to the current mood; AI events interrupt them.

## Color and cosmetic fixes

Color selection now updates 3D fur and markings, with Natural restoring the
original materials. Peach, Cream, and Cocoa expand the palette. Glasses, scarf,
headphones and crown use bone-attached 3D geometry; the old flat overlays are
hidden on models. Bow tie and Flower are free, and Cap unlocks at 20 tasks.
Settings previews selected colors and cosmetics for both drawn and 3D pets.
Locked saved cosmetics now display the same effective selection as the pet.
Electron checks cover recoloring, exact Natural reset, all seven accessories,
removing accessories, and Settings selection. Wiring checks cover persistence
and unlock enforcement.

## Second review: fixes

- Sprite images were stored inline in `pet-config.json`, which is rewritten on
  every AI event and parsed by every hook call. They now live in their own file
  in userData; old configs are migrated, and the pet window receives the image
  on its own IPC channel only when it changes.
- Upgraded Electron 33 → 44 and electron-builder 25 → 26. Shipped dependencies
  have no known advisories. `three` moved to devDependencies (it is bundled),
  so 32 MB no longer ships in the app.
- Sessions: hooks forward Claude Code's `session_id`. Active state and pending
  confirms are tracked per source + session, so one session finishing no longer
  clears another or dismisses its prompt.
- Settings saves only the control that changed and receives live updates, so
  an open Settings window can't undo tray changes.
- Notification types: the idle "waiting for your input" reminder is ignored.
  A prompt announced by both `PermissionRequest` and a `permission_prompt`
  Notification counts and notifies once.
- Dragging keeps the window interactive, so a fast flick can no longer leave
  the pet stuck to the cursor.
- The weekly total covers the same 7 days as the chart.
- The daily greeting waits for the first activity of the day, not midnight.
- `SubagentStop` no longer counts as a finished task.
- Duplicate detection scans the recent window, not only the newest event.
- An empty token is refused (Regenerate replaces it).
- Hotkey registration failures show in Settings.
- The login-item state is read back from the OS.
- All windows block navigation and window.open.
- The old default show/hide hotkey, `Cmd/Ctrl+Shift+P`, was registered
  globally and stole VS Code's command palette. The new defaults use three
  modifiers, and old configs are migrated.

## Second review: features

- Wandering only happens while the pet is idle and awake. It walks, facing its
  direction, using a new `walk` trot clip in both GLB models.
- **Open terminal →** links (macOS) bring the terminal running Claude Code to
  the front, using `pet-focus://` and a fixed allowlist of terminal apps.
- Per-session badges (`C×2`) and `+N more waiting` on stacked confirms. The
  context ring follows the session currently driving the pet's mood.
- "While you were away" summary when the pet is unhidden, or when you return
  after 5+ minutes away from the keyboard.
- Answer-confirm global shortcut: jumps to the newest waiting prompt.
- Right-click play menu with tricks, focus, Activity, Settings and Hide.
- One-click Claude Code hook installer. It previews the change, backs up the
  file, keeps the user's other hooks and replaces stale pet entries.
- GitHub Actions CI (Linux/macOS/Windows) and a GitHub Releases publish target.

## Remaining ideas

- Activity duration is still estimated from busy-event intervals.
- Terminal focusing is macOS-only, and it brings the app forward rather than
  the exact tab.
- Optional feeding, a toy to follow, and persistent affection could give
  interaction more purpose.

## Validation

`npm test` covers server/hooks, the hook installer merge, main-process wiring
(including config migrations, per-session confirm counting, partial saves,
hotkeys, the play menu and the away summary) and deterministic renderer
regressions (gestures, confirms across sessions, sleep, focus and walking).
`npm run test:3d` runs the GLB checks and an Electron/WebGL smoke test with
walk screenshots and Settings live-sync checks. These use a simulated DOM;
manual Electron checks are still needed for visual quality, native dragging,
multiple monitors, imported sprite rendering and macOS/Windows/Linux packaging.
