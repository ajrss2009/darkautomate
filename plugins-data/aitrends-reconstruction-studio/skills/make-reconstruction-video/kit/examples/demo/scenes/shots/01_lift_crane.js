// s01 — crane move riding with the train up the lift hill; time block + live height card
import { registerShot, THREE, ease, clamp } from '/engine/api.js';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
registerShot('s01', {
  set: 'park', look: 'day',
  update(W, S, t, info) {
    const sHead = S.crestS - 22 + 2.6 * t;               // lift speed 2.6 m/s, front car crests near the end
    S.T.place(S.P, sHead);
    const k = ease.inOut(clamp((t - 0.3) / (info.dur - 0.3)));
    const head = S.P.frame(sHead - 0.2).P;
    W.camera.position.copy(head).add(V(-3.2, 2.0, 10.5).lerp(V(-16, 7.5, 22), k));
    W.camera.lookAt(head.clone().add(V(-4.6, 0.5, 0).lerp(V(10, -5, -1.5), k)));
    W.camera.fov = 36; W.camera.updateProjectionMatrix();
    S._sHead = sHead;
  },
  ui(U, t, info, S) {
    U.scrim('bl', 0.5, { at: 0.3 });
    U.timeStack({ date: 'Saturday 17 Oct 2026', time: '4:02 p.m.', place: 'The lift hill · demo' }, { at: 0.5 });
    const f = S.P.frame(S._sHead - 1.4);
    U.pin(f.P.clone().addScaledVector(f.N, 2.3), '', { style: 'card', sub: 'FRONT CAR · HEIGHT', unit: 'ft', leader: 120, at: 1.4, value: () => Math.min(200, S.P.frame(S._sHead - 0.2).P.y * 3.28084) });
    U.footnote('Geometry approximate · illustrative reconstruction');
  },
});
