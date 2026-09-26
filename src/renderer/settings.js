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

const SKIN_LABELS = { slime: 'Slime', cat: 'Cat', ghost: 'Ghost', bunny: 'Bunny', kitten: 'Kitten 3D · 小猫', puppy: 'Puppy 3D · 小狗' };
const COSMETIC_LABELS = {
  none: 'None', glasses: 'Glasses', scarf: 'Scarf', headphones: 'Headphones', crown: 'Crown'
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
  for (const skin of ['kitten', 'puppy']) modelPreview.classList.toggle('skin-' + skin, selectedSkin === skin);
  $('model-hint').textContent = ['kitten', 'puppy'].includes(selectedSkin)
    ? 'Blender 3D character · natural fur colors; use Tricks to wave, dance and play. Custom sprite art overrides the desktop character: choose Use drawn pet below to show 3D.'
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
      renderPreview();
      save();
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
      renderPreview();
      save();
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
      save();
    }, { disabled: !isUnlocked, selected: key === selectedCosmetic });
    cosmeticsEl.appendChild(chip);
  });
  lifetimeEl.textContent = `· ${cfg.lifetimeTasks || 0} done so far`;
}

function save() {
  window.settingsAPI.set({
    name: nameInput.value.trim(),
    color: selectedColor,
    skin: selectedSkin,
    cosmetic: selectedCosmetic,
    muted: !$('sound').checked, // UI shows "Sound effects" (inverse of muted)
    timeOfDay: $('timeOfDay').checked,
    wander: $('wander').checked,
    physics: $('physics').checked,
    notifyWhenHidden: $('notifyWhenHidden').checked,
    autoUpdate: $('autoUpdate').checked,
    hotkey: $('hotkey').value.trim(),
    stressTokens: Math.max(0, Number($('stress').value) || 0) * 1000,
    ctxMax: Math.max(1, Number($('ctxMax').value) || 200) * 1000,
    token: $('token').value,
    quiet: {
      enabled: $('quietEnabled').checked,
      from: $('quietFrom').value,
      to: $('quietTo').value
    },
    focus: {
      work: Number($('focusWork').value) || 25,
      break: Number($('focusBreak').value) || 5
    }
  });
}

// ---------------------------------------------------------------------------
// Sprite art. Picking runs in main (native dialog); we only ever hold metadata.
// ---------------------------------------------------------------------------
function renderSprite(sprite) {
  const has = !!sprite;
  $('spriteGeom').hidden = !has;
  $('spriteHint').hidden = !has;
  $('spriteClear').disabled = !has;
  if (has) {
    $('spriteStatus').textContent = `Using ${sprite.name} — ${sprite.cols}×${sprite.rows} @ ${sprite.fps} fps.`;
    $('spriteCols').value = sprite.cols;
    $('spriteRows').value = sprite.rows;
    $('spriteFps').value = sprite.fps;
  } else {
    $('spriteStatus').textContent = 'Using the built-in drawn pet.';
  }
}

function saveSpriteGeometry() {
  window.settingsAPI.setSprite({
    cols: Number($('spriteCols').value) || 1,
    rows: Number($('spriteRows').value) || 1,
    fps: Number($('spriteFps').value) || 8
  });
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

['spriteCols', 'spriteRows', 'spriteFps'].forEach((id) =>
  $(id).addEventListener('change', saveSpriteGeometry)
);

nameInput.addEventListener('input', () => {
  renderPreview();
  save();
});

// Save the rest of the controls on change.
[
  'sound', 'timeOfDay', 'wander', 'physics', 'notifyWhenHidden', 'autoUpdate',
  'focusWork', 'focusBreak', 'hotkey', 'stress', 'ctxMax', 'token',
  'quietEnabled', 'quietFrom', 'quietTo'
].forEach((id) => $(id).addEventListener('change', save));

$('done').addEventListener('click', () => window.settingsAPI.close());

(async () => {
  cfg = await window.settingsAPI.get();
  palette = cfg.palette || {};
  selectedColor = cfg.color && palette[cfg.color] ? cfg.color : Object.keys(palette)[0];
  selectedSkin = cfg.skin || 'slime';
  selectedCosmetic = cfg.cosmetic || 'none';

  nameInput.value = cfg.name || '';
  $('sound').checked = !cfg.muted;
  $('timeOfDay').checked = cfg.timeOfDay !== false;
  $('wander').checked = cfg.wander !== false;
  $('physics').checked = cfg.physics !== false;
  $('notifyWhenHidden').checked = cfg.notifyWhenHidden !== false;
  $('autoUpdate').checked = cfg.autoUpdate !== false;
  $('hotkey').value = cfg.hotkey || '';
  $('stress').value = Math.round((cfg.stressTokens || 0) / 1000);
  $('ctxMax').value = Math.round((cfg.ctxMax || 200000) / 1000);
  $('token').value = cfg.token || '';
  $('focusWork').value = (cfg.focus && cfg.focus.work) || 25;
  $('focusBreak').value = (cfg.focus && cfg.focus.break) || 5;

  const quiet = cfg.quiet || {};
  $('quietEnabled').checked = !!quiet.enabled;
  $('quietFrom').value = quiet.from || '22:00';
  $('quietTo').value = quiet.to || '08:00';

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

  renderSprite(cfg.sprite);
  renderSwatches();
  renderSkins();
  renderCosmetics();
  renderPreview();
})();
