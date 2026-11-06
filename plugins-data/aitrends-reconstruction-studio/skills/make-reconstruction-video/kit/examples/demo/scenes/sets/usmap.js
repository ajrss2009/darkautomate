// Demo set: dark US map with glowing points (darkmap look). 1 unit = 20 km.
import { registerSet, K, THREE } from '/engine/api.js';
const PARKS = [['Georgia', -84.55, 33.77], ['Illinois', -87.93, 42.37], ['California', -118.6, 34.42], ['New Jersey', -74.44, 40.14],
  ['Ohio', -84.27, 39.34], ['North Carolina', -80.94, 35.1], ['Ontario', -79.54, 43.84], ['Texas', -97.07, 32.75], ['Florida', -81.46, 28.41], ['Missouri', -90.67, 38.51], ['Massachusetts', -72.62, 42.04], ['Colorado', -105.02, 39.75]];
registerSet('usmap', async (W) => {
  W.noFog();
  const map = await K.usMap({ center: [-92, 38.5], kmPerUnit: 20, highlight: { Georgia: '#2f6fdb' } });
  W.add(map.group);
  const sea = K.ground({ color: '#07080a', size: 2000, y: -0.05 }); W.add(sea);
  const dots = PARKS.map(([name, lon, lat], i) => { const d = K.glowDot({ r: 1.1, color: i === 0 ? '#ffffff' : '#ffd98a', power: i === 0 ? 4 : 3 }); d.position.copy(map.at(lon, lat, map.extrude + 0.8)); W.add(d); return { name, d, p: d.position.clone() }; });
  W.shadowArea([0, 0, 0], 160);
  return { map, dots, georgia: map.at(-84.55, 33.77, map.extrude + 0.8) };
});
