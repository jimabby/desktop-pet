(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const moods = ['idle', 'thinking', 'working', 'happy', 'stressed', 'sleeping', 'error'];
  const canvas = $('spriteCanvas'), context = canvas.getContext('2d');
  let image = null, generation = 0, timer = null, frame = 0;
  const fields = new Map();
  for (const mood of moods) {
    const option = document.createElement('option'); option.value = option.textContent = mood; $('spriteMood').append(option);
    const row = document.createElement('p');
    const controls = {};
    for (const [key, label, max] of [['row', 'Row (1-based)', 64], ['frames', 'Frames', 64], ['fps', 'FPS', 60]]) {
      const wrapper = document.createElement('label'); wrapper.textContent = `${mood} ${label} `;
      const input = document.createElement('input'); input.type = 'number'; input.min = 1; input.max = max;
      input.style.width = '62px'; input.setAttribute('aria-label', `${mood} ${label}`);
      input.addEventListener('input', preview); wrapper.append(input); row.append(wrapper); controls[key] = input;
    }
    fields.set(mood, controls); $('spriteMappings').append(row);
  }
  function draft() {
    const cols = Number($('spriteCols').value), rows = Number($('spriteRows').value), fps = Number($('spriteFps').value);
    if (![cols, rows, fps].every(Number.isInteger) || cols < 1 || rows < 1 || fps < 1 || cols > 64 || rows > 64 || fps > 60)
      throw new Error('Use 1–64 columns/rows and 1–60 FPS.');
    if (!image) throw new Error('Loading image…');
    if (image.naturalWidth < cols || image.naturalHeight < rows || image.naturalWidth % cols || image.naturalHeight % rows)
      throw new Error('The image dimensions must divide evenly into the selected grid.');
    const mapping = {};
    for (const [mood, f] of fields) {
      const row = Number(f.row.value) - 1, frames = Number(f.frames.value), speed = Number(f.fps.value);
      if (![row, frames, speed].every(Number.isInteger) || row < 0 || row >= rows || frames < 1 || frames > cols || speed < 1 || speed > 60)
        throw new Error(`${mood}: choose a row inside the grid, 1–${cols} frames, and 1–60 FPS.`);
      mapping[mood] = {row, frames, fps:speed};
    }
    return {cols, rows, fps, moods:mapping};
  }
  function preview() {
    clearTimeout(timer); frame = 0;
    context.clearRect(0, 0, canvas.width, canvas.height);
    let config;
    try { config = draft(); $('spriteValidation').textContent = 'Preview ready. Apply to save these animation settings.'; $('spriteApply').disabled = false; }
    catch (e) { $('spriteValidation').textContent = e.message; $('spriteApply').disabled = true; return; }
    const mood = config.moods[$('spriteMood').value];
    const width = image.naturalWidth / config.cols, height = image.naturalHeight / config.rows;
    const scale = Math.min(canvas.width / width, canvas.height / height);
    function draw() {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(image, (frame++ % mood.frames) * width, mood.row * height, width, height,
        (canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2, width * scale, height * scale);
      if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        timer = setTimeout(draw, 1000 / mood.fps);
    }
    draw();
  }
  async function load() {
    const id = ++generation; clearTimeout(timer); image = null; $('spriteApply').disabled = true;
    try {
      const sp = await window.settingsAPI.spritePreview();
      if (id !== generation) return;
      $('spriteEditor').hidden = !sp;
      if (!sp) { image = null; return; }
      for (const k of ['cols', 'rows', 'fps']) $('sprite' + k[0].toUpperCase() + k.slice(1)).value = sp[k];
      moods.forEach((m, i) => {
        const value = sp.moods?.[m] || {row:Math.min(i, sp.rows - 1),frames:sp.cols};
        const f = fields.get(m); f.row.value = value.row + 1; f.frames.value = value.frames; f.fps.value = value.fps || sp.fps;
      });
      const next = new Image();
      next.onload = () => { if (id === generation) { image = next; preview(); } };
      next.onerror = () => { if (id === generation) { image = null; $('spriteValidation').textContent = 'The image could not be loaded.'; $('spriteApply').disabled = true; } };
      next.src = sp.url;
    } catch (e) { $('spriteValidation').textContent = e.message; }
  }
  $('spriteApply').onclick = async () => {
    try {
      const result = await window.settingsAPI.applySprite(draft());
      if (!result.ok) throw new Error(result.error);
      $('spriteValidation').textContent = 'Animation mapping saved.';
    } catch (e) { $('spriteValidation').textContent = e.message; }
  };
  $('spriteReset').onclick = load;
  $('spriteMood').onchange = preview;
  for (const id of ['spriteCols', 'spriteRows', 'spriteFps']) $(id).addEventListener('input', preview);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else if (image) preview(); });
  window.addEventListener('sprite-metadata', load);
  window.addEventListener('pagehide', () => { ++generation; clearTimeout(timer); });
  load();
})();
