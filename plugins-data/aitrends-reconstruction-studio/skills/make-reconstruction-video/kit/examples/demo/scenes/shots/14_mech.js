// s14 — dark studio: the ratchet clicks a few teeth; ring callout on the pawl
import { registerShot, cam, THREE, ease, prog } from '/engine/api.js';
registerShot('s14', {
  set: 'mech', look: 'studio',
  update(W, S, t, info) {
    const clicks = Math.floor(prog(t, 0.6, info.dur - 0.8) * 4); const sub = ease.out(prog((t - 0.6) % ((info.dur - 1.4) / 4), 0, 0.12));
    S.wheel.rotation.z = -(clicks + sub) * (Math.PI * 2 / 18); S.arm.rotation.z = -(clicks + sub) * 0.06; S.pawl.rotation.z = Math.sin(sub * Math.PI) * 0.18;
    cam.orbit(W.camera, t, { target: [0.2, 0.75, 0], radius: [2.6, 2.2], height: [0.5, 0.35], from: 18, to: -8, dur: info.dur, fov: 34 });
  },
  ui(U, t, info, S) { U.ring(new THREE.Vector3(0.42, 0.98, 0.1), { r: 70, at: info.w('ratchet', 1.2), color: '#ffffff', width: 5 }); U.pin(new THREE.Vector3(0.42, 0.98, 0.1), 'Pawl · ratchet tooth', { style: 'tag', leader: 140, dir: 'right', at: info.w('ratchet', 1.2) + 0.2 }); },
});
