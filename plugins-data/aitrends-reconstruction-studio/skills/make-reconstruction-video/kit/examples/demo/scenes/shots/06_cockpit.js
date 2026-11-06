// s06 — clay cockpit, slow push-in over the captain's shoulder; lower third + tags on the control columns
import { registerShot, cam, THREE } from '/engine/api.js';
registerShot('s06', {
  set: 'cockpit', look: 'clay', badge: 'RECONSTRUCTION',
  update(W, S, t, info) {
    cam.dolly(W.camera, t, [[0, { pos: [-0.75, 1.8, 0.12], look: [1.6, 0.95, -0.3], fov: 56 }], [info.dur, { pos: [-0.5, 1.74, 0.08], look: [1.6, 0.95, -0.36], fov: 52 }]]);
  },
  ui(U, t, info, S) {
    U.lowerThird({ name: 'The captain', sub: 'left seat · demo' }, { at: 0.4 });
    U.pin(S.ck.foYoke.clone().add(new THREE.Vector3(0, 0.22, 0)), 'Control column', { style: 'tag', leader: 46, at: info.w('control', 1.8) });
    U.pin(S.ck.capYoke.clone().add(new THREE.Vector3(0, 0.22, 0)), 'Control column', { style: 'tag', leader: 46, at: info.w('control', 1.8) + 0.15 });
  },
});
