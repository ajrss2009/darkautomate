// engine/maps.js — 3D maps from Natural Earth (world-atlas) and US states (us-atlas), routes and pins.
// Projection: local equirectangular around `center` [lon, lat]; north = -Z, east = +X, up = +Y.
// 1 world unit = `kmPerUnit` km (default 10). Land is extruded slightly so coastlines show a side wall.
import * as THREE from 'three';
import { feature, mesh as topoMesh } from 'topojson-client';
import { mat, glowMat, mesh, ring } from './kit3d.js';
import { clamp } from './core.js';

const cache = {};
async function topo(path) { if (!cache[path]) cache[path] = await (await fetch(path)).json(); return cache[path]; }
export async function loadCountries(res = '50m') { const t = await topo(`/node_modules/world-atlas/countries-${res}.json`); return { topo: t, fc: feature(t, t.objects.countries) }; }
export async function loadStates() { const t = await topo('/node_modules/us-atlas/states-10m.json'); return { topo: t, fc: feature(t, t.objects.states) }; }

export function projector(o = {}) {
  const [lon0, lat0] = o.center || [0, 0], k = o.kmPerUnit || 10, c = Math.cos((lat0 * Math.PI) / 180);
  const ll2xz = (lon, lat) => { let d = lon - lon0; if (d > 180) d -= 360; if (d < -180) d += 360; return [(d * c * 111.32) / k, -((lat - lat0) * 110.57) / k]; };
  return { center: [lon0, lat0], kmPerUnit: k, ll2xz, at: (lon, lat, y = 0) => { const [x, z] = ll2xz(lon, lat); return new THREE.Vector3(x, y, z); }, km: (km) => km / k };
}
function ringsToShapes(geom, P, bbox) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const shapes = [];
  for (const poly of polys) {
    const outer = poly[0]; if (!outer || outer.length < 4) continue;
    if (bbox) { let hit = false; for (const [lo, la] of outer) if (lo >= bbox[0] && lo <= bbox[2] && la >= bbox[1] && la <= bbox[3]) { hit = true; break; } if (!hit) continue; }
    let jump = false; for (let i = 1; i < outer.length; i++) if (Math.abs(outer[i][0] - outer[i - 1][0]) > 180) { jump = true; break; } if (jump) continue;
    const toV = (r) => r.map(([lo, la]) => { const [x, z] = P.ll2xz(lo, la); return new THREE.Vector2(x, -z); });
    const sh = new THREE.Shape(toV(outer)); for (const hole of poly.slice(1)) sh.holes.push(new THREE.Path(toV(hole))); shapes.push(sh);
  }
  return shapes;
}
// worldMap({ center:[lon,lat], span:[dLon,dLat], kmPerUnit:10, res:'50m', land, sea, border, extrude:0.6,
//            highlight:{'Israel':'#2f6fdb'}, raise:{'Jordan':1.2}, dim:{'Egypt':0.2}, sea:true })
// -> { group, P, at(lon,lat,y), country(name) -> {mesh, centroid}, names }
export async function worldMap(o = {}) {
  const { center = [0, 20], span = [60, 40], res = '50m', land = '#f2f1ee', seaColor = '#d9dde2', border = '#bdbab3', extrude = 0.6, glowHighlight = false } = o;
  const P = projector({ center, kmPerUnit: o.kmPerUnit || 10 });
  const bbox = [center[0] - span[0], center[1] - span[1], center[0] + span[0], center[1] + span[1]];
  const { topo: T, fc } = await loadCountries(res); const G = new THREE.Group(); const countries = {};
  if (o.sea !== false) { const [w, d] = [P.km(span[0] * 2.4 * 111 * Math.cos((center[1] * Math.PI) / 180)), P.km(span[1] * 2.4 * 111)]; const sea = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(seaColor, { rough: 1 })); sea.rotation.x = -Math.PI / 2; sea.position.y = -0.02; sea.receiveShadow = true; G.add(sea); }
  for (const f of fc.features) {
    const name = f.properties?.name || f.id; const shapes = ringsToShapes(f.geometry, P, bbox); if (!shapes.length) continue;
    const hi = o.highlight?.[name], up = o.raise?.[name] || 0;
    const color = hi || land; const m = hi && glowHighlight ? new THREE.MeshStandardMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: 0.6, roughness: 0.8 }) : mat(color, { rough: 0.9 });
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: extrude + up, bevelEnabled: false, curveSegments: 1 }); geo.rotateX(-Math.PI / 2);
    const cm = new THREE.Mesh(geo, m); cm.castShadow = cm.receiveShadow = true; cm.name = name; G.add(cm);
    geo.computeBoundingBox(); const bb = geo.boundingBox; countries[name] = { mesh: cm, centroid: new THREE.Vector3((bb.min.x + bb.max.x) / 2, extrude + up, (bb.min.z + bb.max.z) / 2), top: extrude + up };
  }
  if (border) { // shared borders as thin lines on top of the land
    const ml = topoMesh(T, T.objects.countries, (a, b) => a !== b); const pos = [];
    for (const line of ml.coordinates) { for (let i = 1; i < line.length; i++) { const [a, b] = [line[i - 1], line[i]]; if (Math.abs(a[0] - b[0]) > 180) continue;
      if (!((a[0] >= bbox[0] && a[0] <= bbox[2] && a[1] >= bbox[1] && a[1] <= bbox[3]))) continue; const [x1, z1] = P.ll2xz(...a), [x2, z2] = P.ll2xz(...b); pos.push(x1, extrude + 0.02, z1, x2, extrude + 0.02, z2); } }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); G.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(border) })));
  }
  return { group: G, P, at: (lon, lat, y = extrude) => P.at(lon, lat, y), country: (n) => countries[n], names: Object.keys(countries), extrude };
}
// usMap({ center:[-96,38], kmPerUnit:20, land:'#2a2d33', border:'#3d424b', highlight:{'Georgia':'#2f6fdb'}, extrude:0.4, glow:true })
export async function usMap(o = {}) {
  const { center = [-96, 38.5], land = '#2a2d33', border = '#3d424b', extrude = 0.4 } = o;
  const P = projector({ center, kmPerUnit: o.kmPerUnit || 20 }); const { topo: T, fc } = await loadStates(); const G = new THREE.Group(); const states = {};
  for (const f of fc.features) { const name = f.properties?.name; if (o.skip?.includes(name) || (!o.alaska && (name === 'Alaska' || name === 'Hawaii'))) continue;
    const shapes = ringsToShapes(f.geometry, P); if (!shapes.length) continue; const hi = o.highlight?.[name];
    const m = hi ? new THREE.MeshStandardMaterial({ color: new THREE.Color(hi), emissive: new THREE.Color(hi), emissiveIntensity: o.glow === false ? 0 : 0.8, roughness: 0.7 }) : mat(land, { rough: 0.9 });
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: extrude + (hi ? (o.raiseHighlight ?? 0.3) : 0), bevelEnabled: false, curveSegments: 1 }); geo.rotateX(-Math.PI / 2);
    const sm = new THREE.Mesh(geo, m); sm.receiveShadow = true; sm.castShadow = true; sm.name = name; G.add(sm); geo.computeBoundingBox(); const bb = geo.boundingBox; states[name] = { mesh: sm, centroid: new THREE.Vector3((bb.min.x + bb.max.x) / 2, extrude, (bb.min.z + bb.max.z) / 2) }; }
  if (border) { const ml = topoMesh(T, T.objects.states, (a, b) => a !== b); const pos = []; for (const line of ml.coordinates) for (let i = 1; i < line.length; i++) { const [x1, z1] = P.ll2xz(...line[i - 1]), [x2, z2] = P.ll2xz(...line[i]); pos.push(x1, extrude + 0.02, z1, x2, extrude + 0.02, z2); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); G.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(border) }))); }
  return { group: G, P, at: (lon, lat, y = extrude) => P.at(lon, lat, y), state: (n) => states[n], extrude };
}
// great-circle interpolation for long routes
function gcPoints(a, b, n) { const rad = Math.PI / 180; const toV = ([lo, la]) => new THREE.Vector3(Math.cos(la * rad) * Math.cos(lo * rad), Math.sin(la * rad), Math.cos(la * rad) * Math.sin(lo * rad)); const A = toV(a), B = toV(b); const out = [];
  const ang = A.angleTo(B); for (let i = 0; i <= n; i++) { const t = i / n; const v = ang < 1e-6 ? A.clone() : A.clone().multiplyScalar(Math.sin((1 - t) * ang) / Math.sin(ang)).add(B.clone().multiplyScalar(Math.sin(t * ang) / Math.sin(ang))); out.push([Math.atan2(v.z, v.x) / rad, Math.asin(clamp(v.y, -1, 1)) / rad]); } return out; }
// route(map, [[lon,lat],...], {height:0.8, arc:0, radius:0.12, color, greatCircle:true}) -> mesh with .setProgress(k 0..1), .pointAt(k), .curve
export function route(map, lonlats, o = {}) {
  const { height = map.extrude + 0.5, arc = 0, radius = 0.12, color = '#2f6fdb', greatCircle = true } = o; let ll = [];
  for (let i = 1; i < lonlats.length; i++) { const seg = greatCircle ? gcPoints(lonlats[i - 1], lonlats[i], 24) : [lonlats[i - 1], lonlats[i]]; ll = ll.concat(i > 1 ? seg.slice(1) : seg); }
  const pts = ll.map(([lo, la], i) => map.at(lo, la, height + arc * Math.sin((Math.PI * i) / Math.max(1, ll.length - 1))));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'); const tub = Math.max(32, pts.length * 3), radial = 8;
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, tub, radius, radial, false), new THREE.MeshStandardMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: 0.35, roughness: 0.5 })); m.castShadow = true;
  m.setProgress = (k) => { k = clamp(k); m.geometry.setDrawRange(0, Math.floor(k * tub) * radial * 6); m.visible = k > 0.001; };
  m.pointAt = (k) => curve.getPointAt(clamp(k)); m.tangentAt = (k) => curve.getTangentAt(clamp(k, 0.0001, 0.9999)); m.curve = curve; m.setProgress(1); return m;
}
// pin(map, lon, lat, {color, r, ring:true}) -> group with .animate(t)
export function pin(map, lon, lat, o = {}) { const { color = '#2f6fdb', r = 0.35, glow = 1.8 } = o; const g = new THREE.Group(); g.position.copy(map.at(lon, lat, map.extrude + 0.05));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), glow ? glowMat(color, glow) : mat(color))); if (o.ring !== false) { const rr = ring({ radius: r * 3, width: r * 0.5, color, y: 0.02 }); g.add(rr); g.animate = (t) => rr.animate(t); } else g.animate = () => {}; return g; }
