// Demo set: clay extruded map of the Levant / northern Saudi Arabia with an illustrative flight track.
import { registerSet, K, THREE } from '/engine/api.js';
registerSet('mapme', async (W) => {
  W.fogScale(0.15);
  const map = await K.worldMap({ center: [36.5, 29.5], span: [16, 11], kmPerUnit: 10, res: '50m', land: '#f3f2ef', seaColor: '#d5d9de', border: '#c4c1ba', extrude: 0.9 });
  W.add(map.group);
  W.shadowArea([0, 0, 0], 90);
  const track = K.route(map, [[45.5, 26.8], [40.5, 28.4], [37.6, 29.4], [36.9, 29.9], [37.4, 29.7], [36.6, 28.4]], { color: '#2f6fdb', radius: 0.32, height: 2.2, greatCircle: false });
  W.add(track);
  const plane = K.airliner({ length: 39.5 }); plane.scale.setScalar(0.22); W.add(plane);
  return { map, track, plane, places: { israel: map.at(34.85, 31.9), tabuk: map.at(36.6, 28.4), jordan: map.at(36.4, 30.9) } };
});
