// s03 — dark map; dots light up one by one; counter of closed coasters; Georgia label
import { registerShot, cam, ease, clamp, prog } from '/engine/api.js';
registerShot('s03', {
  set: 'usmap', look: 'darkmap',
  update(W, S, t, info) {
    S.dots.forEach((d, i) => { const k = ease.outBack(prog(t, 0.4 + i * 0.18, 0.75 + i * 0.18)); d.d.scale.setScalar(Math.max(0.001, k)); });
    cam.dolly(W.camera, t, [[0, { pos: [4, 250, 165], look: [4, 0, 8], fov: 32 }], [info.dur, { pos: [10, 225, 150], look: [6, 0, 8], fov: 32 }]], ease.sine);
  },
  ui(U, t, info, S) {
    U.pin(S.georgia, 'Georgia', { style: 'chip', dir: 'down', leader: 0, ay: -0.6, at: 0.3 });
    U.stat({ value: 12, countFrom: 0, label: 'coasters shut' }, { style: 'plate', pos: { x: 960, y: 1000, ax: 0.5, ay: 1 }, at: info.w('twelve', 0.8), countDur: 1.4 });
  },
});
