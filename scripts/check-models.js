'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawn } = require('child_process');
for (const skin of ['kitten', 'puppy']) {
  const bytes = fs.readFileSync(path.join(__dirname, '../src/renderer/models', skin + '.glb'));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const joints = new Set(json.skins.flatMap(s => s.joints.map(i => json.nodes[i].name)));
  for (const joint of ['Root', 'Torso', 'Head', 'Jaw', 'Ear_L', 'Ear_R', 'Tail', 'TailTip',
    'Foreleg_L', 'Foreleg_R', 'FrontPaw_L', 'FrontPaw_R', 'HindLeg_L', 'HindLeg_R', 'HindPaw_L', 'HindPaw_R']) {
    assert(joints.has(joint), skin + ' missing joint ' + joint);
  }
  for (const clip of ['idle', 'happy', 'working', 'sleeping', 'wave', 'dance', 'curious', 'shake', 'yawn', 'kiss', 'grabbed']) {
    assert(json.animations.some(a => a.name === clip && a.channels.length), skin + ' missing animation ' + clip);
  }
  const dimensions = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };
  const binaryOffset = 28 + bytes.readUInt32LE(12);
  const moving = new Set();
  for (const animation of json.animations) for (const channel of animation.channels) {
    const accessor = json.accessors[animation.samplers[channel.sampler].output];
    const view = json.bufferViews[accessor.bufferView];
    const size = dimensions[accessor.type];
    assert(size && accessor.componentType === 5126);
    const start = binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    let changed = false;
    for (let i = 0; i < accessor.count; i++) for (let c = 0; c < size; c++) {
      const value = bytes.readFloatLE(start + i * (view.byteStride || size * 4) + c * 4);
      assert(Number.isFinite(value), 'animation must contain finite transforms');
      if (Math.abs(value - bytes.readFloatLE(start + c * 4)) > .001) changed = true;
    }
    // Constant non-rest poses (sleeping eyes / jaw) also differ across clips.
    if (changed) moving.add(json.nodes[channel.target.node].name);
  }
  for (const name of ['Root', 'Torso', 'Head', 'Jaw', 'Tail', 'TailTip', 'Ear_L', 'Ear_R',
    'Foreleg_L', 'Foreleg_R', 'FrontPaw_L', 'FrontPaw_R', 'HindLeg_L', 'HindLeg_R', 'HindPaw_L', 'HindPaw_R']) {
    assert(moving.has(name), skin + ': joint must actually move: ' + name);
  }
  console.log('PASS GLB skeleton and animation clips:', skin);
}
if (!process.argv.includes('--assets-only')) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [path.join(__dirname, 'test3d-electron.js')], { env, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
