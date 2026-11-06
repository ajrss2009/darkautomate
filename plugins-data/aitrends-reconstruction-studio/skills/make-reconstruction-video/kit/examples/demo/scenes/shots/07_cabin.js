// s07 — clay cabin from the aisle looking forward to the cockpit door; stat plate
import { registerShot, cam } from '/engine/api.js';
registerShot('s07', {
  set: 'cabin', look: 'clay', badge: true,
  update(W, S, t, info) { const x = S.cb.frontX; cam.dolly(W.camera, t, [[0, { pos: [x - 16, 1.55, 0.1], look: [x, 1.2, 0], fov: 46 }], [info.dur, { pos: [x - 12, 1.55, 0.05], look: [x, 1.2, 0], fov: 46 }]]); },
  ui(U, t, info) { U.stat({ value: 174, countFrom: 120, label: 'passengers on board' }, { style: 'plate', at: info.w('one', 0.8), countDur: 1.2 }); },
});
