import * as THREE from 'three';

// Accessories are authored in the model's rest coordinates, then attached to
// bones with their world transforms preserved so every head tilt carries them.
export function createModelAppearance(root) {
  const materials = new Map();
  root.traverse(o => {
    for (const m of o.material ? [o.material].flat() : []) {
      if (!materials.has(m)) materials.set(m, m.color.clone());
    }
  });
  const accessories = new Map();
  const mat = color => new THREE.MeshStandardMaterial({ color, roughness: .45 });
  const ink = mat('#30354a'), red = mat('#df526c'), gold = mat('#ffc857');
  const violet = mat('#8974e8'), green = mat('#51a88d'), cream = mat('#fff0c7');
  function mesh(group, geometry, material, x, y, z, scale) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    if (scale) m.scale.set(...scale);
    group.add(m);
    return m;
  }
  function ball(g, material, x, y, z, scale) {
    return mesh(g, new THREE.SphereGeometry(1, 16, 12), material, x, y, z, scale);
  }
  function tube(g, material, points, radius) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return mesh(g, new THREE.TubeGeometry(curve, 24, radius, 8, false), material, 0, 0, 0);
  }
  function accessory(name, bone, build) {
    const group = new THREE.Group();
    group.name = 'Accessory_' + name;
    build(group);
    root.add(group);
    root.updateMatrixWorld(true);
    root.getObjectByName(bone).attach(group);
    group.visible = false;
    accessories.set(name, group);
  }
  accessory('glasses', 'Head', g => {
    for (const x of [-.23, .23]) {
      mesh(g, new THREE.TorusGeometry(.16, .023, 8, 32), ink, x, 1.64, .475, [1, 1.08, 1]);
    }
    tube(g, ink, [[-.07,1.66,.475],[0,1.69,.49],[.07,1.66,.475]], .019);
    for (const sign of [-1, 1]) tube(g, ink, [[sign*.39,1.66,.46],[sign*.51,1.66,.28],[sign*.53,1.63,.05]], .018);
  });
  accessory('scarf', 'Torso', g => {
    const ring = mesh(g, new THREE.TorusGeometry(.34, .075, 10, 36), red, 0, 1.14, .025);
    ring.rotation.x = Math.PI / 2;
    ball(g, red, -.16, .96, .36, [.09,.22,.05]);
    ball(g, gold, -.16, .82, .37, [.095,.03,.052]);
  });
  accessory('headphones', 'Head', g => {
    tube(g, ink, [[-.59,1.63,0],[-.55,1.96,0],[0,2.08,0],[.55,1.96,0],[.59,1.63,0]], .05);
    for (const x of [-.60, .60]) {
      ball(g, ink, x, 1.63, .01, [.10,.21,.18]);
      ball(g, violet, x*1.08, 1.63, .05, [.07,.15,.14]);
    }
  });
  accessory('crown', 'Head', g => {
    mesh(g, new THREE.CylinderGeometry(.25,.28,.13,32), gold, 0, 2.01, .01);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      mesh(g, new THREE.ConeGeometry(.07,.22,4), gold, Math.cos(a)*.22,2.16,Math.sin(a)*.22+.01);
    }
    ball(g, red, 0, 2.03, .275, [.055,.055,.025]);
  });
  accessory('bowtie', 'Torso', g => {
    for (const sign of [-1, 1]) {
      const wing = ball(g, violet, sign*.13,1.09,.395,[.15,.10,.055]);
      wing.rotation.z = sign*-.25;
    }
    ball(g, gold, 0,1.09,.44,[.055,.065,.035]);
  });
  accessory('flower', 'Head', g => {
    for (let i=0; i<6; i++) {
      const a=i/6*Math.PI*2;
      ball(g, red, -.35+Math.cos(a)*.115,1.92+Math.sin(a)*.115,.25,[.085,.085,.04]);
    }
    ball(g, gold,-.35,1.92,.30,[.075,.075,.045]);
    ball(g, green,-.22,1.83,.23,[.12,.045,.03]).rotation.z=.5;
  });
  accessory('cap', 'Head', g => {
    mesh(g, new THREE.SphereGeometry(.34,24,12,0,Math.PI*2,0,Math.PI/2), green,0,1.98,.015,[1,.6,1]);
    ball(g, green,0,1.99,.28,[.37,.028,.26]);
    ball(g, cream,0,2.18,.015,[.045,.035,.045]);
  });
  return function update(color, cosmetic, focusing = false) {
    for (const [material, original] of materials) {
      material.color.copy(original);
      if (color && color !== 'natural') {
        const name = material.name.replace(/\.\d+$/, '');
        if (name === 'Fur') material.color.set(color);
        if (name === 'Markings') material.color.set(color).multiplyScalar(.42);
      }
    }
    for (const [name, group] of accessories) group.visible = name === cosmetic || (focusing && name === 'headphones');
  };
}
