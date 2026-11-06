// Demo set: a hyper-coaster in a wooded park (colour look). Lift hill climbs +X to a 61 m (200 ft) crest.
import { registerSet, K, THREE } from '/engine/api.js';

registerSet('park', async (W) => {
  W.shadowArea([-14, 30, 4], 75);
  // centreline: station run -> lift -> crest -> first drop curving toward +Z -> airtime hill -> turnaround -> back
  const pts = [[-150, 3.2, -6], [-118, 3.2, -4], [-98, 3.4, -2], [-88, 4.6, -0.8], [-80, 8.1, 0], [-65, 19.6, 0], [-45, 35, 0], [-25, 50.5, 0],
    [-13, 58.6, 0], [-5, 61, 0], [0, 61.2, 0], [5, 60.7, 0.3], [11, 55.8, 1.3], [17, 44, 3.3], [23, 29, 6.6], [29, 15, 11], [36, 5.2, 16.2],
    [45, 3.6, 22], [57, 7.5, 27], [70, 19, 29.5], [83, 31, 29.5], [94, 36.5, 27], [104, 36.8, 23], [114, 31.5, 18], [125, 20.5, 12],
    [137, 10.5, 6], [152, 6.5, -4], [166, 7.5, -24], [170, 10, -52], [160, 13, -82], [132, 18, -104], [92, 26, -116], [48, 31, -122],
    [5, 32, -124], [-38, 26, -120], [-80, 15, -108], [-118, 7, -84], [-146, 4.2, -54], [-160, 3.4, -28]];
  const C = K.coaster({ points: pts, closed: true });
  W.add(C.group);
  const T = K.train({ cars: 9, across: 4, riderStyle: 'smooth', seed: 5 });
  W.add(T.group);
  W.add(K.ground({ color: '#3b4827' }));
  // station canopy over the low run + queue plaza + a few park buildings
  W.add(K.canopy({ w: 34, d: 9, h: 6.2, pos: [-120, 0, -4] }));
  const pl = K.plaza(60, 26, {}); pl.position.set(-118, 0.01, 12); W.add(pl);
  for (const [x, z, w, h, d, c] of [[-112, 34, 26, 9, 14, '#d9ccb4'], [-150, 28, 18, 7, 12, '#c9b8a0'], [-80, 40, 20, 11, 14, '#e2d6c2']]) W.add(K.building({ w, h, d, wall: c, pos: [x, z], seed: x }));
  const sign = K.sign('TITAN', { w: 7, h: 1.6, color: '#0f6b5e' }); sign.position.set(-104, 0, 16); W.add(sign);
  // forest wedge around the visible area (keep clear of the low track and the station)
  const low = []; for (let s = 0; s < C.P.L; s += 2) { const p = C.P.point(s); if (p.y < 13) low.push(p); }
  const exclude = (x, z) => { if ((x - 58) ** 2 + (z - 80) ** 2 < 30 ** 2) return true; if (x < -70 && x > -175 && z > -20 && z < 50) return true; for (const p of low) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 49) return true; return false; };
  W.add(K.forest({ center: [-12, 12], rMax: 240, from: -170, to: 35, count: 2200, farMax: 1150, farCount: 14000, exclude, seed: 7 }));
  return { C, T, P: C.P, crestS: C.crestS, liftS: C.liftS };
});
