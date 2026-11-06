// s02 — low wide shot up at the crest; tags pinned to the train and the lift hill
import { registerShot, cam, THREE } from '/engine/api.js';
registerShot('s02', {
  set: 'park', look: 'day',
  update(W, S, t, info) {
    S.T.place(S.P, S.crestS + 1 + 1.2 * t);
    cam.dolly(W.camera, t, [[0, { pos: [60, 2.4, 84], look: [-2, 38, 0], fov: 34 }], [info.dur, { pos: [52, 3.4, 74], look: [-3, 41, 0], fov: 32 }]]);
  },
  ui(U, t, info, S) {
    const crest = S.P.point(S.crestS);
    U.pin(crest.clone().add(new THREE.Vector3(0, 3, 0)), '9 cars · 36 riders', { style: 'tag', leader: 70, at: info.w('nine', 0.3) });
    U.pin(S.P.point(S.crestS - 40).add(new THREE.Vector3(0, 1, 0)), 'Lift hill · 200 ft', { style: 'tag', leader: 60, dir: 'down', at: info.w('one', 1.6) });
    U.footnote('Source: park ride data · track layout approximate');
  },
});
