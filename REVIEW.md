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

## Remaining findings and worthwhile next steps

- `maybeWander()` in `src/main.js` checks focus and dragging but does not know the
  renderer's sleeping/busy state. Share that state before adding walking footfalls,
  turning and edge reactions; otherwise a sleeping pet can slide around.
- Confirmation state is global in `pet.js`: an event from another assistant can
  dismiss the current prompt. Track pending confirmations per source for reliable
  multi-assistant use.
- Activity duration is estimated from busy-event intervals under one minute; it
  is not precise task timing. Track explicit task/session identifiers if accurate
  reports are needed.
- Settings currently sends the whole form on each change; a stale settings window
  can overwrite tray changes. Send only changed fields and synchronize updates.
- A small play menu on the character would make tricks easier to discover.
- Optional feeding, a toy to follow, and persistent affection could give interaction
  more purpose. Keep these optional so the pet does not become a chore.
- For a more lifelike silhouette, build dedicated per-skin movement cycles and
  artwork; this change improves the existing CSS character rather than replacing
  its art with a realistic model.

## Validation

`npm test` covers server/hooks, main-process wiring and deterministic renderer
regressions. Renderer tests cover gesture cleanup, AI interruption, confirmation
expiry, sleep transition and focus-break recovery. These use a simulated DOM;
manual Electron checks are still needed for visual quality, native dragging,
multiple monitors, imported sprite rendering and macOS/Windows/Linux packaging.
