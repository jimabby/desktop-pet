// Bundled locally by build:3d. No CDN, network service or Blender installation
// is needed when the packaged pet runs.
import * as THREE from 'three';
import { createModelAppearance } from './model-appearance.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_SKINS = ['kitten', 'puppy'];
const loader = new GLTFLoader();
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function disposeModel(root) {
  const geometries = new Set(), materials = new Set(), skeletons = new Set();
  root?.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) for (const m of [o.material].flat()) materials.add(m);
    if (o.skeleton) skeletons.add(o.skeleton);
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
  skeletons.forEach(s => s.dispose());
}

function createView(host) {
  const owner = host.parentElement;
  let renderer, root, mixer, clips = {}, action, skin = '', requestId = 0;
  let updateAppearance;
  let raf = 0, lastFrame = 0, failed = false, stopped = false;
  let gazeX = 0, gazeY = 0, actionOneShot = false;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.45, 1.45, 1.45, -1.45, .1, 30);
  camera.position.set(0, 1.9, 7);
  camera.lookAt(0, 1.1, 0);
  scene.add(new THREE.HemisphereLight(0xfff3df, 0x596078, 2.5));
  const key = new THREE.DirectionalLight(0xffefd9, 3.3);
  key.position.set(-3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xc5dcff, 2);
  rim.position.set(3, 3, -2); scene.add(rim);

  function syncAppearance() {
    const color = getComputedStyle(owner).getPropertyValue('--model-fur').trim() || 'natural';
    const cosmetic = [...owner.classList].find(c => c.startsWith('cosmetic-'))?.slice(9) || 'none';
    updateAppearance?.(color, cosmetic, owner.classList.contains('focusing'));
  }
  function desiredClip() {
    const c = owner.classList;
    if (c.contains('grabbed')) return 'grabbed';
    for (const name of ['petting', 'sniff', 'paw', 'groom', 'wave', 'dance', 'curious', 'shake', 'yawn', 'kiss']) {
      if (c.contains('act-' + name)) return name;
    }
    for (const [gesture, clip] of Object.entries({ look: 'curious', stretch: 'yawn', wiggle: 'petting', hop: 'happy' })) {
      if (c.contains('act-' + gesture)) return clip;
    }
    if (c.contains('mood-sleeping')) return 'sleeping';
    if (c.contains('mood-happy')) return 'happy';
    if (c.contains('mood-working')) return 'working';
    if (c.contains('mood-thinking') || c.contains('mood-stressed')) return 'curious';
    if (c.contains('mood-error')) return 'shake';
    return 'idle';
  }
  function active() { return !failed && root && skin && !owner.classList.contains('has-sprite') && !document.hidden; }
  function draw(now) {
    raf = 0;
    if (!active() || stopped) return;
    if (now - lastFrame < 1000 / 30) { raf = requestAnimationFrame(draw); return; }
    const dt = Math.min((now - lastFrame) / 1000 || 0, .08);
    lastFrame = now;
    mixer.update(reduced.matches ? 0 : dt);
    const overlays = [];
    function remember(object, property) {
      overlays.push([object, property, object[property].clone()]);
    }
    // Bone names are part of the exported model contract. Head tracking and
    // eyelid compression layer on top of the authored clips, never the mesh.
    if (!reduced.matches && desiredClip() === 'idle') {
      const head = root.getObjectByName('Head');
      if (head?.isBone) {
        remember(head, 'quaternion');
        head.rotation.y += gazeX * .13;
        head.rotation.x += gazeY * .08;
      }
    }
    if (owner.classList.contains('blink')) {
      for (const side of ['L', 'R']) {
        const eye = root.getObjectByName('Eye_' + side);
        if (eye?.isBone) { remember(eye, 'scale'); eye.scale.y *= .08; }
      }
    }
    renderer.render(scene, camera);
    // Restore mixer-owned transforms; otherwise static tracks can accumulate
    // cursor offsets or keep the eyes compressed after a blink.
    for (const [object, property, value] of overlays) object[property].copy(value);
    if (!reduced.matches) raf = requestAnimationFrame(draw);
  }
  function wake() {
    if (active() && !raf && !stopped) { lastFrame = performance.now() - 34; raf = requestAnimationFrame(draw); }
  }
  function syncClip(restart = false) {
    if (!mixer) return;
    const clip = clips[desiredClip()] || clips.idle;
    if (!clip) return;
    const next = mixer.clipAction(clip);
    const oneShot = ['petting', 'sniff', 'paw', 'groom', 'wave', 'curious', 'shake', 'yawn', 'kiss'].includes(clip.name) &&
      [...owner.classList].some(c => c.startsWith('act-'));
    if (next !== action || oneShot !== actionOneShot || (restart === true && oneShot)) {
      action?.fadeOut(.2);
      next.reset();
      actionOneShot = oneShot;
      next.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
      next.clampWhenFinished = oneShot;
      next.setDuration(oneShot ? 1.4 : clip.duration);
      next.fadeIn(.2).play();
      action = next;
    }
    if (reduced.matches) {
      mixer.stopAllAction();
      next.reset().play();
      mixer.update(.35); // settled expression, no continuously moving limbs
      action = next;
    }
    wake();
  }
  function ensureRenderer() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(160, 160, false);
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      fail(new Error('3D graphics context lost'));
    });
  }
  function fail(error) {
    console.error('[pet] 3D character unavailable:', error);
    failed = true;
    owner.classList.remove('has-model');
    owner.dataset.modelStatus = 'unavailable';
    host.dispatchEvent(new CustomEvent('model-error', { bubbles: true }));
    cancelAnimationFrame(raf); raf = 0;
  }
  async function sync(records = []) {
    if (stopped) return;
    const nextSkin = MODEL_SKINS.find(s => owner.classList.contains('skin-' + s)) || '';
    if (nextSkin === skin) {
      // Removing/re-adding an action in one task is a fresh interaction.
      // Blink and unrelated class changes must not restart a gesture.
      const gesture = 'act-' + desiredClip();
      const restart = owner.classList.contains(gesture) && records.some(r =>
        r.oldValue != null && !r.oldValue.split(/\s+/).includes(gesture));
      if (!failed) { syncAppearance(); syncClip(restart); }
      return;
    }
    skin = nextSkin; failed = false;
    const id = ++requestId;
    owner.classList.remove('has-model');
    cancelAnimationFrame(raf); raf = 0;
    mixer?.stopAllAction();
    if (root) { mixer?.uncacheRoot(root); scene.remove(root); disposeModel(root); }
    root = null; updateAppearance = null; mixer = null; action = null; clips = {};
    if (!skin) { delete owner.dataset.modelStatus; return; }
    owner.dataset.modelStatus = 'loading';
    try {
      ensureRenderer();
      const gltf = await loader.loadAsync(new URL(`models/${skin}.glb`, document.baseURI).href);
      if (id !== requestId || stopped) { disposeModel(gltf.scene); return; }
      root = gltf.scene;
      root.rotation.y = -.12;
      scene.add(root);
      updateAppearance = createModelAppearance(root);
      syncAppearance();
      mixer = new THREE.AnimationMixer(root);
      clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
      if (!clips.idle) throw new Error('Model has no idle animation');
      owner.classList.add('has-model');
      owner.dataset.modelStatus = 'ready';
      syncClip();
    } catch (e) { if (id === requestId) fail(e); }
  }
  const observer = new MutationObserver(sync);
  observer.observe(owner, { attributes: true, attributeFilter: ['class', 'style'], attributeOldValue: true });
  const visibility = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else wake(); };
  const pointer = e => {
    const rect = host.getBoundingClientRect();
    gazeX = THREE.MathUtils.clamp((e.clientX - rect.left - rect.width / 2) / 100, -1, 1);
    gazeY = THREE.MathUtils.clamp((e.clientY - rect.top - rect.height / 2) / 100, -1, 1);
  };
  window.addEventListener('mousemove', pointer);
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', syncClip);
  window.addEventListener('pagehide', () => {
    stopped = true; requestId++;
    observer.disconnect(); cancelAnimationFrame(raf);
    window.removeEventListener('mousemove', pointer);
    document.removeEventListener('visibilitychange', visibility);
    reduced.removeEventListener('change', syncClip);
    mixer?.stopAllAction(); disposeModel(root); renderer?.dispose();
  }, { once: true });
  sync();
}

document.querySelectorAll('[data-model-view]').forEach(createView);
