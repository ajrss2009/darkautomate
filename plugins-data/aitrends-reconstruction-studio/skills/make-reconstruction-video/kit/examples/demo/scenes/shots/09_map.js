// s09 — clay map; the route draws, a small plane rides its tip; place chips
import { registerShot, cam, ease, prog, THREE } from '/engine/api.js';
registerShot('s09', {
  set: 'mapme', look: 'clay',
  update(W, S, t, info) {
    const k = ease.inOut(prog(t, 0.3, info.dur - 0.6)); S.track.setProgress(0.35 + 0.65 * k);
    const p = S.track.pointAt(0.35 + 0.65 * k), d = S.track.tangentAt(0.35 + 0.65 * k);
    S.plane.position.copy(p).add(new THREE.Vector3(0, 0.6, 0)); S.plane.rotation.set(0, Math.atan2(-d.z, d.x), 0);
    cam.dolly(W.camera, t, [[0, { pos: [40, 150, 170], look: [20, 0, 10], fov: 30 }], [info.dur, { pos: [18, 115, 140], look: [6, 0, 8], fov: 30 }]], ease.sine);
  },
  ui(U, t, info, S) {
    U.pin(S.places.israel, 'Israel', { style: 'chip', leader: 0, ay: 1.2, at: 0.3 });
    U.pin(S.places.tabuk, 'Tabuk', { style: 'chip', leader: 0, ay: 1.2, at: 0.5 });
    U.pin(S.places.jordan, 'Jordan', { style: 'tag', leader: 0, at: 0.7 });
    U.timeChip({ time: '08:42 local time', sub: 'turns west · demo track' }, { at: info.w('west', 1.5) });
    U.footnote('Track illustrative · not the published path');
  },
});
