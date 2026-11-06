// s08 — clay airliner cruising; camera tracks alongside; time chip
import { registerShot, cam, THREE } from '/engine/api.js';
registerShot('s08', {
  set: 'sky', look: 'clay', badge: true,
  update(W, S, t, info) { S.plane.position.set(t * 0.8, 0, 0); S.plane.rotation.set(0, 0, 0);
    cam.dolly(W.camera, t, [[0, { pos: [44, 6, 46], look: [18, 0, 0], fov: 30 }], [info.dur, { pos: [30, 4, 44], look: [20, 0, 0], fov: 30 }]]); },
  ui(U, t, info) { U.timeChip({ time: '08:21 local time', sub: 'level at 34,000 ft · demo' }, { at: 0.3 }); U.footnote('Aircraft type approximate'); },
});
