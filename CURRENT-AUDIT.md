# Desktop Pet review — 23 October 2026

Reviewed application source, IPC bridges, persistence, session accounting, HTTP input handling, integrations, renderers, model loading/appearance, build configuration, CI, documentation, and tests. Existing historical audit findings were checked against the current implementation rather than repeated as current defects. Application changes are described in the implementation follow-up below.

## Implementation follow-up

All five findings below have been addressed, and all five proposed feature areas
are now implemented. The findings are retained as the rationale for the changes.

- Busy leases are shared with the renderer; session/retry identities use escaped
  components and unambiguous event tuples.
- Position controls remain mounted during refresh; placement and restored window
  sizing use the destination display’s available area.
- Managed restored images are removed on clear/replacement. Before-restore backups
  preserve a separate copy of the old image.
- Companion center includes a real authenticated sample event, generated/copyable
  terminal setup command, local prompt dismissal, expiry reasons, and focus recaps.
- Settings includes manual/automatic-on-battery low power and a validated sprite
  preview/editor with per-mood rows, frame counts, and frame rates.
- README examples include authentication; historical review notes are marked.

Validation results are recorded at the end of this document. Native platform
and release checks listed below remain unverified, rather than being represented
as software defects that can be fixed by this patch alone.

## Original findings

### 1. P2 — Default session expiry leaves the pet permanently busy

Locations: `src/sessions.js:72`, `src/main.js:2019`, `src/renderer/pet.js:732`.

An authenticated custom integration can send `{ "source": "custom", "session": "one", "mood": "working" }` without the optional TTL. Main gives the session a 120-second lease, but forwards a zero TTL to the renderer. The renderer only schedules expiry for a positive TTL. Main's periodic session tick does not publish expiry to the renderer.

Reproduced with the real session module and existing deterministic renderer harness: after 121 seconds the session status is `expired`, while the renderer still has one active assistant and mood `working`. This also prevents idle wandering/toy use and can indefinitely defer incidental notices.

Fix: calculate the effective busy lease once and forward it, or make main publish authoritative expiry transitions. Cover missing/zero TTL, explicit leases, and renewed leases in a regression test.

### 2. P2 — Companion center refresh discards position edits

Locations: `src/renderer/companion.js:62`, `src/renderer/companion.js:156`, `src/renderer/companion.js:241`.

The whole panel is rebuilt every three seconds using saved preferences. Rebuilding is deferred only while a select has focus. Change the corner, tab to Set position, and pause: the next refresh resets the selection before it is submitted. Clicking elsewhere before applying has the same problem. Holding select focus also freezes the session/prompt panel.

Reproduced in actual Electron using an isolated test configuration: selected `top-left`, moved focus away, waited 3.5 seconds, and observed `bottom-right` again.

Fix: retain a separate draft for display/corner/movement or update the session and diagnostic sections without rebuilding the form. Test keyboard navigation across a periodic refresh.

### 3. P2 — Moving to a smaller monitor does not fit the pet to it

Location: `src/companion.js:169` (`place()`).

Set position and profile placement read the current window dimensions and change its position only. A 2.5× pet is 600×800; moving it from a large monitor to an 800×600 work area leaves 200 vertical pixels off-screen. Display rescue only runs on display topology/metrics changes, so ordinary placement does not trigger it. Profile loading scales against the old display before placement.

Reproduced through the actual companion action handler with a simulated smaller display: it returned success and retained an 800-pixel window height on a 600-pixel work area. Native mixed-monitor behavior was not exercised.

Fix: fit size against the selected destination before placing it. Apply the same policy to startup restoration and profile loading.

### 4. P2 — Delimiter collisions merge independent sessions and retry IDs

Locations: `src/sessions.js:3`, `src/sessions.js:46`, `src/main.js:627`.

The server accepts `|` in source, session, and event IDs, while internal identity concatenates these fields with `|`. `{source:'a|b', session:'c'}` and `{source:'a', session:'b|c'}` both become `a|b|c`. Distinct session/event-ID combinations can similarly collide in the retry cache. One session can overwrite another or a legitimate event can be discarded as a retry.

Reproduced by accepting both distinct sessions through `createSessions()`: only one entry remained. Bundled integrations normally use simple source names and UUID-like session IDs, so this primarily affects custom integrations.

Fix: encode tuples unambiguously (for example, JSON arrays or nested Maps), centralize identity generation, and replace renderer prefix-based source clearing with comparisons of stored source values.

### 5. P3 — Restored sprite files accumulate after replacement/removal

Locations: `src/companion.js:467`, `src/main.js:1561`, `src/main.js:1614`.

Restore creates `sprite-restored-<timestamp>.<ext>`. Clear and replacement clean up only fixed names such as `sprite.png`, leaving restored files behind. Repeated restore/clear cycles accumulate images of up to 4 MB each. This is a source-confirmed cleanup mismatch; no user sprite files were touched.

Fix: clean up the previous managed image after successful replacement, with an explicit managed-file allowlist. Decide separately whether restore backups should retain their referenced image assets.

## Documentation and validation gaps

- README's three-assistant examples and subsequent idle/clear examples omit `X-Pet-Token`, despite authentication being enabled by default. They return 401 when copied as written.
- `REVIEW.md` contains superseded statements, including estimated activity duration and proposed features that now exist. Mark historical sections clearly or link readers to one maintained status document.
- Browser bridges were source-reviewed but not run against live ChatGPT/Gemini pages. Their DOM selectors, browser local-network permissions, and page CSP compatibility need a browser compatibility check.
- Native Windows/Linux interaction, mixed-DPI monitors, signed packaging, notarization, and a real installed-version upgrade were not tested in this review.

## Features worth adding next

These are product proposals, not claims about external services or existing integrations.

1. **Guided integration setup.** Build on existing diagnostics with copyable authenticated commands and an end-to-end “send a sample event, then verify receipt” flow. Add adapters only where the target assistant exposes a supported event mechanism. Value: less manual token/port setup.
2. **Resolve stale prompts and explain expired sessions.** Add a clearly labeled local Dismiss action and show why a session expired, with its last event/heartbeat time. Acknowledgement currently silences a prompt but leaves it in the inbox. Value: recover from interrupted integrations without restarting or crafting HTTP requests.
3. **Battery-aware animation.** Offer an explicit low-power setting with reduced idle frame rate and static sleeping poses. Measure CPU/GPU use before choosing defaults. Value: an always-running companion should remain inexpensive on laptops.
4. **Sprite-sheet preview and mood mapping.** Preview the selected grid, choose rows/frame counts per mood, and show validation before applying. The current UI exposes only columns, rows, and FPS. Value: makes existing custom-art support practical for more sheets.
5. **Focus-session recap.** At the end of a focus block, show completed tasks, active work, and outstanding prompts, using the session accounting already present. Value: connect the existing Pomodoro and activity features.

Recommended sequence: fix expiry and form persistence, fix placement/identity/cleanup, then add guided setup and stale-prompt recovery before more cosmetics.

## Checks executed

- `npm test` — passed: 87 server/hook checks plus main wiring, renderer regressions, session clocks, lifecycle, leases, exports, and config recovery.
- `npm run test:3d` — passed: bundle, GLB checks, actual Electron/WebGL rendering and animation, colors/accessories, reduced motion, switching/fallback, and settings preview.
- `npm run test:ui` — passed: actual isolated Electron companion UI, prompts, auth override, diagnostics, quiet, profiles, backups, and activity updates.
- `npm audit --json` — zero reported vulnerabilities across the installed dependency tree. This is a registry advisory result, not proof that the application has no security defects.
- Additional targeted probes reproduced findings 1–4 using real modules, the existing deterministic renderer harness, an isolated Electron window, and simulated display geometry.

The follow-up changes application source, regression tests, and documentation. Test builds regenerated the ignored renderer bundle. Temporary probe files and screenshots were written outside the repository; tests used isolated configurations.


## Follow-up validation

- Expanded `npm test`: passed, including default lease forwarding, identifier and
  retry tuple collisions, local dismissal, setup command/copy/sample receipt,
  focus recap accounting and prompt priority, destination display sizing, and
  sprite validation/managed-file cleanup.
- Expanded `npm run test:ui`: passed in isolated Electron windows. Tests exercise
  position drafts across refresh, sample receipt, stale-prompt dismissal, sprite
  preview, invalid and valid mood mappings, low-power preferences, and deletion
  of a restored sprite after clearing it.
- Expanded `npm run test:3d`: passed, including actual WebGL submission counting.
  In the measured equal-length idle intervals, normal mode submitted 1,000 draw
  calls and low power submitted 360; sleeping submitted zero after settling.
  These are draw-call measurements on this machine, not battery-life estimates.
- `git diff --check`: passed. Dependencies were unchanged from the zero-advisory
  audit above. No release was published and no personal hooks/config were changed.
