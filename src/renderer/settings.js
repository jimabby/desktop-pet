'use strict';

const $ = (id) => document.getElementById(id);
const nameInput = $('name');
const swatchesEl = $('swatches');
const skinsEl = $('skins');
const cosmeticsEl = $('cosmetics');
const lifetimeEl = $('lifetime');
const previewBlob = $('preview-blob');
const previewName = $('preview-name');

let cfg = {};
let palette = {};
let selectedColor = 'green';
let selectedSkin = 'slime';
let selectedCosmetic = 'none';

const SKIN_LABELS = { slime: 'Slime', cat: 'Cat', ghost: 'Ghost' };
const COSMETIC_LABELS = { none: 'None', glasses: 'Glasses', scarf: 'Scarf', crown: 'Crown' };

function blobGradient(stops) {
  return `linear-gradient(160deg, ${stops[0]} 0%, ${stops[1]} 100%)`;
}

function renderPreview() {
  const stops = palette[selectedColor];
  if (stops) previewBlob.style.background = blobGradient(stops);
  previewName.textContent = nameInput.value.trim() || 'your companion';
}

function renderSwatches() {
  swatchesEl.replaceChildren();
  Object.entries(palette).forEach(([key, stops]) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (key === selectedColor ? ' selected' : '');
    sw.style.background = blobGradient(stops);
    sw.title = key;
    sw.addEventListener('click', () => {
      selectedColor = key;
      renderSwatches();
      renderPreview();
      save();
    });
    swatchesEl.appendChild(sw);
  });
}

function renderSkins() {
  skinsEl.replaceChildren();
  (cfg.skins || ['slime']).forEach((key) => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (key === selectedSkin ? ' selected' : '');
    chip.textContent = SKIN_LABELS[key] || key;
    chip.addEventListener('click', () => {
      selectedSkin = key;
      renderSkins();
      save();
    });
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
    chip.addEventListener('click', () => {
      if (!isUnlocked) return;
      selectedCosmetic = key;
      renderCosmetics();
      save();
    });
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
    hotkey: $('hotkey').value.trim(),
    stressTokens: Math.max(0, Number($('stress').value) || 0) * 1000,
    token: $('token').value,
    focus: {
      work: Number($('focusWork').value) || 25,
      break: Number($('focusBreak').value) || 5
    }
  });
}

nameInput.addEventListener('input', () => {
  renderPreview();
  save();
});

// Save the rest of the controls on change.
['sound', 'timeOfDay', 'wander', 'physics', 'focusWork', 'focusBreak', 'hotkey', 'stress', 'token']
  .forEach((id) => $(id).addEventListener('change', save));

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
  $('hotkey').value = cfg.hotkey || '';
  $('stress').value = Math.round((cfg.stressTokens || 0) / 1000);
  $('token').value = cfg.token || '';
  $('focusWork').value = (cfg.focus && cfg.focus.work) || 25;
  $('focusBreak').value = (cfg.focus && cfg.focus.break) || 5;

  renderSwatches();
  renderSkins();
  renderCosmetics();
  renderPreview();
})();
