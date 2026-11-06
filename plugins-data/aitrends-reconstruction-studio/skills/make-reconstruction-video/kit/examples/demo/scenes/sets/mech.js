// Demo set: dark studio close-up of a ratchet lock: toothed wheel, pawl, lap-bar arm.
import { registerSet, K, THREE } from '/engine/api.js';
registerSet('mech', async (W) => {
  W.shadowArea([0, 0.3, 0], 2);
  const g = new THREE.Group(); W.add(g);
  const steel = K.mat('#b9bec6', { rough: 0.28, metal: 0.85 }), dark = K.mat('#2a2d33', { rough: 0.5, metal: 0.4 });
  // toothed wheel: extruded gear outline
  const teeth = 18, R = 0.42, r = 0.36, sh = new THREE.Shape();
  for (let i = 0; i <= teeth * 2; i++) { const a = (i / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? r : R; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? sh.lineTo(x, y) : sh.moveTo(x, y); }
  sh.holes.push(new THREE.Path().absarc(0, 0, 0.08, 0, Math.PI * 2, true));
  const wheel = K.mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 }), steel, [0, 0.6, 0]);
  g.add(wheel);
  g.add(K.cyl(0.08, 0.08, 0.3, dark, [0, 0.6, 0.04], [90, 0, 0]));
  // pawl
  const pawl = new THREE.Group(); pawl.position.set(0.55, 1.05, 0.04); g.add(pawl);
  pawl.add(K.box(0.36, 0.07, 0.06, steel, [-0.18, 0, 0], [0, 0, 28]));
  // lap-bar arm rising from the wheel hub
  const arm = new THREE.Group(); arm.position.set(0, 0.6, 0.14); g.add(arm);
  arm.add(K.cyl(0.04, 0.04, 1.1, K.mat('#9aa0a8', { rough: 0.3, metal: 0.7 }), [0, 0.55, 0], [0, 0, -25]));
  arm.add(K.rbox(0.36, 0.22, 0.46, K.mat('#ea9128', { rough: 0.45 }), [0.5, 1.05, 0], [0, 0, -20], 0.08));
  g.add(K.box(3, 0.05, 2, K.mat('#15171a', { rough: 0.9 }), [0, 0, 0]));
  return { wheel, pawl, arm };
});
