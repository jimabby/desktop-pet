'use strict';

// Merging the pet's hook entries into a Claude Code settings.json object. Pure
// functions (no fs, no Electron) so the merge can be tested on its own — it
// edits a file the user cares about, so it must never drop their other hooks.

// The hook events the pet listens to, and the matcher each one needs.
const PET_HOOK_EVENTS = {
  SessionStart: null,
  UserPromptSubmit: null,
  PreToolUse: '*',
  PostToolUse: '*',
  PermissionRequest: null,
  Notification: null,
  Stop: null,
  SubagentStop: null,
  SessionEnd: null
};

const PET_SCRIPT = 'pet-notify.js';

function isPetHook(h) {
  return !!h && typeof h.command === 'string' && h.command.includes(PET_SCRIPT);
}

// Returns { settings, changed }. Existing pet entries (e.g. from an older
// install path) are replaced; everything else is kept as it was.
function mergePetHooks(current, command) {
  const before = JSON.stringify(current || {});
  const settings = JSON.parse(before);
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }

  for (const [event, matcher] of Object.entries(PET_HOOK_EVENTS)) {
    const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const others = group.hooks.filter((h) => !isPetHook(h));
      // Drop a group only if it held nothing but pet hooks.
      if (others.length) kept.push({ ...group, hooks: others });
      else if (!group.hooks.length) kept.push(group);
    }
    const entry = { type: 'command', command };
    kept.push(matcher ? { matcher, hooks: [entry] } : { hooks: [entry] });
    settings.hooks[event] = kept;
  }

  return { settings, changed: JSON.stringify(settings) !== before };
}

// True when every event the pet needs already runs exactly this command.
function petHooksInstalled(current, command) {
  const hooks = current && current.hooks;
  if (!hooks || typeof hooks !== 'object') return false;
  return Object.keys(PET_HOOK_EVENTS).every(
    (event) =>
      Array.isArray(hooks[event]) &&
      hooks[event].some(
        (g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => h && h.command === command)
      )
  );
}

module.exports = { mergePetHooks, petHooksInstalled, PET_HOOK_EVENTS };
