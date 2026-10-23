'use strict';
const fs = require('fs');
const path = require('path');
const MOODS = ['idle', 'thinking', 'working', 'happy', 'stressed', 'sleeping', 'error'];
function geometry(input) {
  const out = {};
  for (const k of ['cols', 'rows', 'fps']) {
    const n = input[k];
    if (!Number.isInteger(n) || n < 1 || n > (k === 'fps' ? 60 : 64))
      throw new Error(`Invalid ${k}`);
    out[k] = n;
  }
  out.moods = Object.fromEntries(MOODS.map((m, i) => {
    const v = input.moods?.[m] || { row: Math.min(i, out.rows - 1), frames: out.cols, fps: out.fps };
    if (!Number.isInteger(v.row) || v.row < 0 || v.row >= out.rows ||
        !Number.isInteger(v.frames) || v.frames < 1 || v.frames > out.cols ||
        (v.fps !== undefined && (!Number.isInteger(v.fps) || v.fps < 1 || v.fps > 60)))
      throw new Error(`Invalid ${m} animation`);
    return [m, { row: v.row, frames: v.frames, fps: v.fps || out.fps }];
  }));
  return out;
}
function removeManagedSprite(dir, file, keep = '') {
  if (typeof file !== 'string' || file === keep || !/^sprite(?:-restored-\d+)?\.(png|gif|webp)$/.test(file)) return;
  try { fs.unlinkSync(path.join(dir, file)); } catch (e) { if (e.code !== 'ENOENT') console.warn('[pet] sprite cleanup:', e.message); }
}
module.exports = { geometry, removeManagedSprite, MOODS };
