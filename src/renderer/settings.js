'use strict';

const $ = (id) => document.getElementById(id);
const nameInput = $('name');
const swatchesEl = $('swatches');
const skinsEl = $('skins');
const cosmeticsEl = $('cosmetics');
const lifetimeEl = $('lifetime');
const previewBlob = $('preview-blob');
const previewName = $('preview-name');

$('model-preview').addEventListener('model-error', () => {
  $('model-hint').textContent = '3D preview could not load. The drawn pet is still available; try reopening Settings.';
});

let cfg = {};
let palette = {};
let selectedColor = 'green';
let selectedSkin = 'slime';
let selectedCosmetic = 'none';

const SKIN_LABELS = { slime: 'Slime', kitten: 'Kitten 3D · 小猫', puppy: 'Puppy 3D · 小狗' };
const COSMETIC_LABELS = {
  none: 'None', glasses: 'Glasses', scarf: 'Scarf', headphones: 'Headphones', crown: 'Crown', bowtie: 'Bow tie', flower: 'Flower', cap: 'Cap'
};

function blobGradient(stops) {
  return `linear-gradient(160deg, ${stops[0]} 0%, ${stops[1]} 100%)`;
}

// Make a clickable div usable from the keyboard too (Tab + Enter/Space).
function makePressable(el, onPress, { disabled = false, selected = false } = {}) {
  el.setAttribute('role', 'button');
  el.setAttribute('aria-pressed', String(selected));
  if (disabled) {
    el.setAttribute('aria-disabled', 'true');
    return;
  }
  el.tabIndex = 0;
  el.addEventListener('click', onPress);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  });
}

function renderPreview() {
  const stops = palette[selectedColor];
  if (stops) previewBlob.style.background = blobGradient(stops);
  const modelPreview = $('model-preview');
  modelPreview.style.setProperty('--model-fur', selectedColor === 'natural' ? 'natural' : stops?.[0] || 'natural');
  for (const cosmetic of Object.keys(COSMETIC_LABELS)) {
    modelPreview.classList.toggle('cosmetic-' + cosmetic, selectedCosmetic === cosmetic);
    previewBlob.classList.toggle('cosmetic-' + cosmetic, selectedCosmetic === cosmetic);
  }
  for (const skin of ['kitten', 'puppy']) modelPreview.classList.toggle('skin-' + skin, selectedSkin === skin);
  $('model-hint').textContent = ['kitten', 'puppy'].includes(selectedSkin)
    ? 'Colors tint the fur; Natural restores the original coat. Accessories follow the character as it moves. Custom sprite art overrides the desktop character.'
    : 'Kitten 3D / Puppy 3D: articulated Blender characters with moving ears, paws and tails.';
  previewName.textContent = nameInput.value.trim() || 'your companion';
}

function renderSwatches() {
  swatchesEl.replaceChildren();
  Object.entries(palette).forEach(([key, stops]) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (key === selectedColor ? ' selected' : '');
    sw.style.background = blobGradient(stops);
    sw.title = key;
    sw.setAttribute('aria-label', key);
    makePressable(sw, () => {
      selectedColor = key;
      renderSwatches();
      swatchesEl.querySelector('[aria-pressed="true"]')?.focus();
      renderPreview();
      save({ color: key });
    }, { selected: key === selectedColor });
    swatchesEl.appendChild(sw);
  });
}

function renderSkins() {
  skinsEl.replaceChildren();
  (cfg.skins || ['slime']).forEach((key) => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (key === selectedSkin ? ' selected' : '');
    chip.textContent = SKIN_LABELS[key] || key;
    makePressable(chip, () => {
      selectedSkin = key;
      renderSkins();
      skinsEl.querySelector('[aria-pressed="true"]')?.focus();
      renderPreview();
      save({ skin: key });
    }, { selected: key === selectedSkin });
    skinsEl.appendChild(chip);
  });
}

function renderCosmetics() {
  cosmeticsEl.replaceChildren();
  const unlocks = cfg.cosmeticUnlocks || { none: 0 };
  const unlocked = cfg.unlocked || ['none'];
  Object.keys(unlocks).forEach((key) => {
    const isUnlocked = unlocked.includes(key);
    const chip = document.createElement('div');
    chip.className =
      'chip' + (key === selectedCosmetic ? ' selected' : '') + (isUnlocked ? '' : ' locked');
    chip.textContent = COSMETIC_LABELS[key] || key;
    if (!isUnlocked) {
      const lock = document.createElement('span');
      lock.className = 'lock';
      lock.textContent = `🔒 ${unlocks[key]} tasks`;
      chip.appendChild(lock);
    }
    makePressable(chip, () => {
      selectedCosmetic = key;
      renderCosmetics();
      cosmeticsEl.querySelector('[aria-pressed="true"]')?.focus();
      renderPreview();
      save({ cosmetic: key });
    }, { disabled: !isUnlocked, selected: key === selectedCosmetic });
    cosmeticsEl.appendChild(chip);
  });
  lifetimeEl.textContent = `· ${cfg.lifetimeTasks || 0} done so far`;
}

// Each control saves only its own value. Sending the whole form would let a
// Settings window left open write stale values over a change made from the
// tray (e.g. un-muting the pet again).
function save(fields) {
  window.settingsAPI.set(fields);
}

const FIELD_SAVERS = {
  lowPower: () => ({lowPower: $('lowPower').checked}),
  lowPowerOnBattery: () => ({lowPowerOnBattery: $('lowPowerOnBattery').checked}),
  sound: () => ({ muted: !$('sound').checked }), // UI shows "Sound effects" (inverse of muted)
  timeOfDay: () => ({ timeOfDay: $('timeOfDay').checked }),
  wander: () => ({ wander: $('wander').checked }),
  physics: () => ({ physics: $('physics').checked }),
  notifyWhenHidden: () => ({ notifyWhenHidden: $('notifyWhenHidden').checked }),
  autoUpdate: () => ({ autoUpdate: $('autoUpdate').checked }),
  hotkey: () => ({ hotkey: $('hotkey').value.trim() }),
  confirmHotkey: () => ({ confirmHotkey: $('confirmHotkey').value.trim() }),
  stress: () => ({ stressTokens: Math.max(0, Number($('stress').value) || 0) * 1000 }),
  ctxMax: () => ({ ctxMax: Math.max(1, Number($('ctxMax').value) || 200) * 1000 }),
  token: () => ({ token: $('token').value }),
  quietEnabled: () => ({ quiet: { enabled: $('quietEnabled').checked } }),
  quietFrom: () => ({ quiet: { from: $('quietFrom').value } }),
  quietTo: () => ({ quiet: { to: $('quietTo').value } }),
  focusWork: () => ({ focus: { work: Number($('focusWork').value) || 0 } }),
  focusBreak: () => ({ focus: { break: Number($('focusBreak').value) || 0 } })
};

// ---------------------------------------------------------------------------
// Sprite art. Picking runs in main (native dialog); we only ever hold metadata.
// ---------------------------------------------------------------------------
function renderSprite(sprite) {
  const has = !!sprite;
  $('spriteGeom').hidden = !has;
  $('spriteHint').hidden = !has;
  $('spriteClear').disabled = !has;
  window.dispatchEvent(new CustomEvent('sprite-metadata', {detail:sprite}));
  if (has) {
    $('spriteStatus').textContent = `Using ${sprite.name} — ${sprite.cols}×${sprite.rows} @ ${sprite.fps} fps.`;
    $('spriteCols').value = sprite.cols;
    $('spriteRows').value = sprite.rows;
    $('spriteFps').value = sprite.fps;
  } else {
    $('spriteStatus').textContent = 'Using the built-in drawn pet.';
  }
}

$('spritePick').addEventListener('click', async () => {
  const res = await window.settingsAPI.pickSprite();
  if (res && res.ok) renderSprite(res.sprite);
  else if (res && res.error) $('spriteStatus').textContent = `Couldn't use that file: ${res.error}`;
});

$('spriteClear').addEventListener('click', () => {
  window.settingsAPI.clearSprite();
  renderSprite(null);
});

// Geometry and per-mood edits are previewed and applied together by sprite-editor.js.

nameInput.addEventListener('input', () => {
  renderPreview();
  save({ name: nameInput.value.trim() });
});

// Save the rest of the controls on change.
Object.entries(FIELD_SAVERS).forEach(([id, fields]) =>
  $(id).addEventListener('change', () => {
    if (id === 'token' && !$('token').value.trim()) {
      // Refused by main; put the real one back rather than show a blank.
      $('token').value = cfg.token || '';
      $('tokenHint').classList.add('warn');
      return;
    }
    save(fields());
  })
);

$('regenToken').addEventListener('click', async () => {
  const token = await window.settingsAPI.regenToken();
  cfg.token = token;
  $('token').value = token;
  $('tokenHint').classList.remove('warn');
  $('tokenHint').textContent =
    'New token saved. The Claude Code hook picks it up automatically; update the userscript if you use it.';
});

$('installHooks').addEventListener('click', async () => {
  $('installHooks').disabled = true;
  const res = await window.settingsAPI.installHooks();
  $('installHooks').disabled = false;
  if (res.ok) {
    cfg.hooksInstalled = true;
    $('hooksStatus').textContent = res.changed
      ? `Installed into ${res.file} (previous version saved as settings.json.pet-backup). New Claude Code sessions will drive the pet.`
      : 'Already installed — nothing to change.';
  } else if (!res.cancelled) {
    $('hooksStatus').textContent = `Couldn't install: ${res.error}`;
  }
});

$('done').addEventListener('click', () => window.settingsAPI.close());

// Fill the form from a settings payload. Used on open and whenever settings
// change elsewhere; a text field being edited is left alone so live updates
// never yank the caret out from under you.
function applyConfig(next) {
  const focused = document.activeElement;
  const focusGroup = focused?.parentElement?.id;
  const focusIndex = ['swatches','skins','cosmetics'].includes(focusGroup) ? [...focused.parentElement.children].indexOf(focused) : -1;
  cfg = next;
  palette = cfg.palette || {};
  selectedColor = cfg.color && palette[cfg.color] ? cfg.color : Object.keys(palette)[0];
  selectedSkin = cfg.skin || 'slime';
  selectedCosmetic = (cfg.unlocked || ['none']).includes(cfg.cosmetic) ? cfg.cosmetic : 'none';

  const setValue = (el, value) => {
    if (document.activeElement !== el) el.value = value;
  };
  setValue(nameInput, cfg.name || '');
  $('lowPower').checked = !!cfg.lowPower;
  $('lowPowerOnBattery').checked = !!cfg.lowPowerOnBattery;
  $('sound').checked = !cfg.muted;
  $('timeOfDay').checked = cfg.timeOfDay !== false;
  $('wander').checked = cfg.wander !== false;
  $('physics').checked = cfg.physics !== false;
  $('notifyWhenHidden').checked = cfg.notifyWhenHidden !== false;
  $('autoUpdate').checked = cfg.autoUpdate !== false;
  setValue($('hotkey'), cfg.hotkey || '');
  setValue($('confirmHotkey'), cfg.confirmHotkey || '');
  setValue($('stress'), Math.round((cfg.stressTokens || 0) / 1000));
  setValue($('ctxMax'), Math.round((cfg.ctxMax || 200000) / 1000));
  setValue($('token'), cfg.token || '');
  $('token').disabled = !!cfg.tokenLocked;
  $('regenToken').disabled = !!cfg.tokenLocked;
  if (cfg.tokenLocked) $('tokenHint').textContent = 'Overridden by PET_TOKEN. Change the environment and restart to edit it.';
  setValue($('focusWork'), (cfg.focus && cfg.focus.work) || 25);
  setValue($('focusBreak'), (cfg.focus && cfg.focus.break) || 5);

  const quiet = cfg.quiet || {};
  $('quietEnabled').checked = !!quiet.enabled;
  setValue($('quietFrom'), quiet.from || '22:00');
  setValue($('quietTo'), quiet.to || '08:00');

  // A shortcut that failed to register does nothing, so say why.
  const errors = cfg.hotkeyErrors || {};
  for (const id of ['hotkey', 'confirmHotkey']) {
    const hint = $(id + 'Hint');
    if (!hint.dataset.base) hint.dataset.base = hint.textContent;
    hint.textContent = errors[id] ? `⚠️ ${errors[id]} — pick another.` : hint.dataset.base;
    hint.classList.toggle('warn', !!errors[id]);
  }

  // PET_CTX_MAX in the environment overrides whatever is saved here, so say so
  // rather than letting the field look editable but have no effect.
  if (cfg.ctxMaxLocked) {
    $('ctxMax').disabled = true;
    $('ctxMaxHint').textContent = 'Overridden by the PET_CTX_MAX environment variable.';
  }

  $('serverStatus').textContent = cfg.serverError
    ? `⚠️ offline — ${cfg.serverError}`
    : `Listening on 127.0.0.1:${cfg.port}.`;

  if (!cfg.canAutoUpdate) {
    $('autoUpdate').disabled = true;
    $('autoUpdateHint').textContent = 'Only available in a packaged, published build.';
  }

  $('hooksStatus').textContent = cfg.hooksInstalled
    ? '✓ Installed in ~/.claude/settings.json.'
    : `Adds the pet to ~/.claude/settings.json (backed up first), running ${cfg.hooksPath}. Needs Node.js.`;

  if (JSON.stringify(cfg.sprite) !== JSON.stringify(window.savedSpriteMetadata)) {
    window.savedSpriteMetadata = cfg.sprite; renderSprite(cfg.sprite);
  }
  renderSwatches();
  renderSkins();
  renderCosmetics();
  renderPreview();
  if (focusIndex >= 0) $(focusGroup).children[focusIndex]?.focus();
}

window.settingsAPI.onChanged(applyConfig);

(async () => {
  applyConfig(await window.settingsAPI.get());
})();
