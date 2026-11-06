// engine/kit3d.js — reusable 3D building blocks for reconstructions. 1 unit = 1 metre, y up.
// Everything is deterministic (seeded) and shadow-ready. Import via engine/api.js as K.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, lerp, clamp, mixVal } from './core.js';
export { THREE, mergeGeometries };

const UP = new THREE.Vector3(0, 1, 0);
export const V3 = (a, b, c) => (Array.isArray(a) ? new THREE.Vector3(...a) : a?.isVector3 ? a.clone() : new THREE.Vector3(a || 0, b || 0, c || 0));
const deg = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------- materials & textures
const _mats = new Map();
// mat('#e9e6df', {rough:.6, metal:0, flat:false, emissive, opacity, side:'double'}) — cached by parameters
export function mat(color = '#eeeeee', o = {}) {
  const k = color + JSON.stringify(o);
  if (_mats.has(k)) return _mats.get(k);
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: o.rough ?? 0.7, metalness: o.metal ?? 0, flatShading: !!o.flat,
    side: o.side === 'double' ? THREE.DoubleSide : o.side === 'back' ? THREE.BackSide : THREE.FrontSide });
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.glow ?? 1; }
  if (o.opacity != null && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = o.depthWrite ?? false; }
  if (o.map) m.map = o.map;
  _mats.set(k, m); return m;
}
export const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: o.opacity != null, opacity: o.opacity ?? 1, depthWrite: o.depthWrite ?? true, side: o.side === 'double' ? THREE.DoubleSide : THREE.FrontSide, fog: o.fog ?? true });
export const glowMat = (color, power = 2.5) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), toneMapped: false }); return m; };
export function canvasTex(w, h, draw, o = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...o.repeat); }
  t.canvas = c; return t;
}
// panel covered with little dark rectangles / dots: overhead panels, pedestals, consoles (seeded)
export function buttonPanelTex(o = {}) {
  const { w = 512, h = 512, base = '#e9e8e4', ink = '#3a3c40', density = 90, seed = 4, accent = null } = o;
  const r = rng(seed);
  return canvasTex(w, h, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < density; i++) {
      const x = r() * w, y = r() * h, kind = r();
      g.fillStyle = accent && r() < 0.06 ? accent : ink; g.globalAlpha = 0.55 + r() * 0.4;
      if (kind < 0.45) g.fillRect(x, y, 6 + r() * 16, 3 + r() * 5);
      else if (kind < 0.8) { g.beginPath(); g.arc(x, y, 2 + r() * 4, 0, 7); g.fill(); }
      else g.fillRect(x, y, 3 + r() * 4, 3 + r() * 4);
    }
    g.globalAlpha = 1;
  });
}
// building facade: window grid
export function facadeTex(o = {}) {
  const { cols = 6, rows = 3, wall = '#d9ccb4', win = '#5d6f80', frame = '#f2efe8', lit = 0, litColor = '#ffd38a', seed = 1 } = o;
  const r = rng(seed);
  return canvasTex(cols * 64, rows * 80, (g, W, H) => {
    g.fillStyle = wall; g.fillRect(0, 0, W, H);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = i * 64 + 14, y = j * 80 + 16; g.fillStyle = frame; g.fillRect(x - 3, y - 3, 42, 52);
      g.fillStyle = r() < lit ? litColor : win; g.fillRect(x, y, 36, 46); g.fillStyle = frame; g.fillRect(x + 16, y, 4, 46); g.fillRect(x, y + 21, 36, 4);
    }
  });
}
// text on a plane (signs, labels baked into the scene)
export function textTex(text, o = {}) {
  const { w = 1024, h = 256, bg = null, color = '#ffffff', font = '800 150px Archivo, Inter, sans-serif', align = 'center', stroke = null, spacing = 0 } = o;
  return canvasTex(w, h, (g, W, H) => { if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); } g.font = font; g.textAlign = align; g.textBaseline = 'middle'; if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
    const x = align === 'center' ? W / 2 : align === 'left' ? 30 : W - 30;
    if (stroke) { g.lineWidth = stroke[1]; g.strokeStyle = stroke[0]; g.strokeText(text, x, H / 2); } g.fillStyle = color; g.fillText(text, x, H / 2); });
}
export function textPlane(text, width, o = {}) {
  const t = textTex(text, o), aspect = (o.h || 256) / (o.w || 1024);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * aspect), new THREE.MeshStandardMaterial({ map: t, transparent: !o.bg, roughness: 0.8, emissive: o.glow ? new THREE.Color('#ffffff') : new THREE.Color('#000'), emissiveMap: o.glow ? t : null, emissiveIntensity: o.glow || 0, side: THREE.DoubleSide }));
  return m;
}

// ---------------------------------------------------------------- tiny geometry helpers
export const shadowed = (m, cast = true, recv = true) => { m.traverse?.((x) => { if (x.isMesh) { x.castShadow = cast; x.receiveShadow = recv; } }); return m; };
export function mesh(geo, material, pos, rot) { const m = new THREE.Mesh(geo, material); m.castShadow = m.receiveShadow = true; if (pos) m.position.set(...pos); if (rot) m.rotation.set(...rot.map(deg)); return m; }
export const box = (w, h, d, material, pos, rot) => mesh(new THREE.BoxGeometry(w, h, d), material, pos, rot);
export const rbox = (w, h, d, material, pos, rot, radius = 0.05) => mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), material, pos, rot);
export const cyl = (rt, rb, h, material, pos, rot, seg = 20) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material, pos, rot);
export const sphere = (r, material, pos, seg = 20) => mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)), material, pos);
// geometry transformed into place (for merging)
export function placed(geo, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) { return geo.applyMatrix4(new THREE.Matrix4().compose(V3(pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map(deg))), V3(scl))); }
// capsule between two points
export function capsuleBetween(a, b, r, seg = 10) { const A = V3(a), B = V3(b), d = B.clone().sub(A), len = d.length(); const g = new THREE.CapsuleGeometry(r, Math.max(1e-3, len), 4, seg); return g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1))); }
// merge [{geo, mat}] groups by material into few meshes
export function mergeByMaterial(parts) {
  const by = new Map(); for (const p of parts) { if (!by.has(p.mat)) by.set(p.mat, []); by.get(p.mat).push(p.geo.index ? p.geo.toNonIndexed() : p.geo); }
  const g = new THREE.Group();
  for (const [m, list] of by) { for (const x of list) { for (const a of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(a)) x.deleteAttribute(a); if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); }
    const mm = new THREE.Mesh(mergeGeometries(list), m); mm.castShadow = mm.receiveShadow = true; g.add(mm); }
  return g;
}

// ---------------------------------------------------------------- mannequin rig
// Faces +Z, y up; character's LEFT is +X. Root origin = pelvis. m.legLength = pelvis height when standing.
// Pose fields (degrees): hips [pitch,yaw,roll], spine, chest, neck, head [pitch(+fwd), yaw, roll(side)],
//   shL/shR [fwd(+raise forward), out(+raise sideways), twist], elL/elR flex (+bend), wrL/wrR,
//   hipL/hipR [fwd(+leg forward), out, twist], knL/knR flex (+bend), anL/anR flex.
export const POSES = {
  stand:   { shL: [4, 7, 0], shR: [4, 7, 0], elL: 10, elR: 10 },
  attention: { shL: [0, 3, 0], shR: [0, 3, 0], elL: 4, elR: 4 },
  sit:     { hips: [-4, 0, 0], hipL: [88, 4, 0], hipR: [88, 4, 0], knL: 88, knR: 88, anL: -2, anR: -2, shL: [24, 8, 0], shR: [24, 8, 0], elL: 62, elR: 62, spine: [-4, 0, 0] },
  pilot:   { hips: [-8, 0, 0], hipL: [84, 6, 0], hipR: [84, 6, 0], knL: 78, knR: 78, shL: [52, 12, 0], shR: [52, 12, 0], elL: 48, elR: 48, spine: [-2, 0, 0], head: [6, 0, 0] },
  ride:    { hips: [-12, 0, 0], hipL: [96, 5, 0], hipR: [96, 5, 0], knL: 98, knR: 98, shL: [42, 14, 0], shR: [42, 14, 0], elL: 38, elR: 38, spine: [-6, 0, 0] },
  rideArmsUp: { hips: [-12, 0, 0], hipL: [96, 5, 0], hipR: [96, 5, 0], knL: 98, knR: 98, shL: [168, 14, 0], shR: [168, 14, 0], elL: 8, elR: 8, spine: [-6, 0, 0] },
  rideOneUp: { hips: [-12, 0, 0], hipL: [96, 5, 0], hipR: [96, 5, 0], knL: 98, knR: 98, shL: [165, 18, 0], shR: [42, 14, 0], elL: 10, elR: 38, spine: [-6, 0, 0] },
  armsUp:  { shL: [168, 12, 0], shR: [168, 12, 0], elL: 6, elR: 6 },
  wave:    { shL: [4, 7, 0], shR: [150, 30, 0], elL: 10, elR: 30 },
  point:   { shL: [4, 7, 0], shR: [86, 6, 0], elL: 10, elR: 4, head: [0, -10, 0] },
  reach:   { shL: [82, 8, 0], shR: [82, 8, 0], elL: 6, elR: 6, spine: [14, 0, 0] },
  defend:  { shL: [96, 18, 0], shR: [96, 18, 0], elL: 118, elR: 118, spine: [8, 0, 0], head: [12, 0, 0] },
  strike:  { shL: [60, 10, 0], shR: [160, 20, 0], elL: 40, elR: 70, spine: [6, -14, 0] },
  handsHead: { shL: [130, 40, 0], shR: [130, 40, 0], elL: 140, elR: 140, head: [18, 0, 0] },
  phone:   { shL: [4, 7, 0], shR: [36, 18, 0], elR: 140, elL: 10, head: [8, 0, 6] },
  crouch:  { hips: [30, 0, 0], hipL: [105, 8, 0], hipR: [105, 8, 0], knL: 128, knR: 128, anL: 30, anR: 30, spine: [20, 0, 0], shL: [70, 8, 0], shR: [70, 8, 0], elL: 30, elR: 30 },
  kneel:   { hipL: [0, 4, 0], knL: 90, hipR: [92, 4, 0], knR: 90, anL: 40, spine: [6, 0, 0], shL: [30, 8, 0], shR: [30, 8, 0], elL: 30, elR: 30 },
  lieBack: { hips: [-90, 0, 0], shL: [10, 34, 0], shR: [10, 30, 0], elL: 20, elR: 14, hipL: [8, 6, 0], hipR: [2, 4, 0], knL: 16, knR: 4, head: [-4, 18, 0] },
  lieSide: { hips: [-90, 0, 80], shL: [60, 10, 0], shR: [80, 6, 0], elL: 60, elR: 40, hipL: [40, 0, 0], hipR: [20, 0, 0], knL: 60, knR: 30 },
  sprawl:  { hips: [-90, 0, 14], shL: [130, 50, 0], shR: [40, 60, 0], elL: 30, elR: 50, hipL: [36, 14, 0], hipR: [4, 10, 0], knL: 70, knR: 10, head: [0, 30, 10] },
  fallForward: { hips: [60, 0, 0], spine: [20, 0, 0], shL: [120, 30, 0], shR: [110, 30, 0], elL: 20, elR: 20, hipL: [-10, 6, 0], hipR: [20, 6, 0], knL: 20, knR: 40 },
  struggleA: { hips: [10, 20, 0], spine: [16, 10, 0], shL: [110, 20, 0], shR: [70, 30, 0], elL: 40, elR: 90, hipL: [20, 10, 0], knL: 25, knR: 10 },
  struggleB: { hips: [-14, -10, 6], spine: [-10, -8, 0], shL: [100, 30, 0], shR: [130, 10, 0], elL: 100, elR: 60, hipL: [10, 6, 0], hipR: [30, 6, 0], knR: 30 },
};
export function walkPose(phase, amt = 1) {
  const s = Math.sin(phase), c = Math.cos(phase);
  return { hipL: [24 * s * amt, 3, 0], hipR: [-24 * s * amt, 3, 0], knL: Math.max(0, -40 * c) * amt + 6, knR: Math.max(0, 40 * c) * amt + 6,
    shL: [-18 * s * amt, 7, 0], shR: [18 * s * amt, 7, 0], elL: 18, elR: 18, hips: [0, 4 * s * amt, 0], spine: [3, 0, 0] };
}
// running: same with bigger swings
export const runPose = (phase) => { const p = walkPose(phase, 1.7); p.spine = [12, 0, 0]; p.elL = p.elR = 80; return p; };

const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR'];
function fullPose(p) { const o = {}; for (const j of JOINTS) { const v = p?.[j]; o[j] = Array.isArray(v) ? [v[0] || 0, v[1] || 0, v[2] || 0] : [v || 0, 0, 0]; } return o; }
export const blendPose = (a, b, k) => mixVal(fullPose(typeof a === 'string' ? POSES[a] : a), fullPose(typeof b === 'string' ? POSES[b] : b), k);

// taper capsule: radius r1 at top -> r2 at bottom, hanging down from origin along -y by len
function taper(r1, r2, len, seg = 12) {
  const pts = []; const n = 6;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r2, -len - Math.cos(a) * r2 + r2 * 0.0)); }
  pts.reverse(); const top = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; top.push(new THREE.Vector2(Math.sin(a) * r1, Math.cos(a) * r1)); }
  top.reverse();
  // build profile from top pole to bottom pole
  const prof = [...top.map((v) => new THREE.Vector2(v.x, v.y)), ...pts.reverse().map((v) => new THREE.Vector2(v.x, v.y))];
  prof.sort((a, b) => b.y - a.y);
  return new THREE.LatheGeometry(prof, seg);
}
// mannequin({ style:'clay'|'smooth', color, height:1.78, pose, outfit:{vest, cap, shirt} })
export function mannequin(o = {}) {
  const { style = 'clay', color = '#efede8', height = 1.78, pose = 'stand', outfit = {}, rough = 0.72 } = o;
  const s = height / 1.78, M = o.material || mat(color, { rough });
  const root = new THREE.Group(); root.name = 'mannequin';
  const J = {}; const parts = [];
  const add = (parent, geo, material = M, pos = [0, 0, 0], scl) => { const m = new THREE.Mesh(geo, material); m.position.set(...pos); if (scl) m.scale.set(...scl); m.castShadow = m.receiveShadow = true; parent.add(m); parts.push(m); return m; };
  const joint = (name, parent, pos) => { const g = new THREE.Group(); g.position.set(...pos.map((v) => v * s)); g.rotation.order = 'YXZ'; parent.add(g); J[name] = g; return g; };
  const smooth = style === 'smooth';
  const hips = joint('hips', root, [0, 0, 0]);
  add(hips, new THREE.CapsuleGeometry(0.135 * s, 0.13 * s, 4, 12), M, [0, 0.02 * s, 0], [1, 1, 0.78]).rotation.z = Math.PI / 2;
  const spine = joint('spine', hips, [0, 0.07, 0]);
  add(spine, smooth ? taper(0.13 * s, 0.125 * s, 0.13 * s) : new THREE.CapsuleGeometry(0.125 * s, 0.1 * s, 4, 12), M, [0, smooth ? 0.13 * s : 0.1 * s, 0], [1.05, 1, 0.74]);
  const chest = joint('chest', spine, [0, 0.2, 0]);
  add(chest, smooth ? taper(0.17 * s, 0.135 * s, 0.2 * s) : new THREE.CapsuleGeometry(0.155 * s, 0.17 * s, 4, 14), M, [0, smooth ? 0.24 * s : 0.13 * s, 0], [1.08, 1, 0.68]);
  if (outfit.vest) add(chest, new THREE.CapsuleGeometry(0.168 * s, 0.17 * s, 4, 14), mat(outfit.vest, { rough: 0.6 }), [0, 0.13 * s, 0.002], [1.1, 1.02, 0.72]);
  if (outfit.shirt) add(chest, new THREE.CapsuleGeometry(0.16 * s, 0.17 * s, 4, 14), mat(outfit.shirt, { rough: 0.8 }), [0, 0.13 * s, 0.001], [1.09, 1.01, 0.7]);
  const neck = joint('neck', chest, [0, 0.31, 0]);
  add(neck, new THREE.CylinderGeometry(0.048 * s, 0.056 * s, 0.1 * s, 12), M, [0, 0.04 * s, 0]);
  const head = joint('head', neck, [0, 0.09, 0]);
  add(head, new THREE.SphereGeometry(0.108 * s, 22, 16), M, [0, 0.1 * s, 0.006 * s], smooth ? [0.9, 1.14, 1.0] : [0.98, 1.1, 1.02]);
  if (smooth) { add(head, new THREE.SphereGeometry(0.02 * s, 10, 8), M, [0, 0.085 * s, 0.1 * s], [0.8, 1.3, 1]); add(head, new THREE.SphereGeometry(0.06 * s, 12, 10), M, [0, 0.03 * s, 0.035 * s], [1.2, 0.7, 1.1]); }
  if (outfit.cap) { add(head, new THREE.SphereGeometry(0.113 * s, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(outfit.cap), [0, 0.125 * s, 0.004 * s], [1, 0.8, 1.04]); add(head, new THREE.CylinderGeometry(0.1 * s, 0.1 * s, 0.012 * s, 18, 1, false, -0.9, 1.8), mat(outfit.cap), [0, 0.13 * s, 0.07 * s]); }
  if (outfit.hair) add(head, new THREE.SphereGeometry(0.114 * s, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(outfit.hair, { rough: 0.9 }), [0, 0.112 * s, -0.008 * s], [0.99, 1.12, 1.04]);
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const sh = joint('sh' + side, chest, [0.19 * sx, 0.255, 0]);
    add(sh, new THREE.SphereGeometry(0.062 * s, 14, 10), M, [0, 0, 0]);
    add(sh, smooth ? taper(0.058 * s, 0.045 * s, 0.24 * s) : new THREE.CapsuleGeometry(0.05 * s, 0.2 * s, 4, 10), M, [0, smooth ? 0 : -0.14 * s, 0]);
    const el = joint('el' + side, sh, [0, -0.29, 0]);
    add(el, smooth ? taper(0.045 * s, 0.036 * s, 0.22 * s) : new THREE.CapsuleGeometry(0.043 * s, 0.19 * s, 4, 10), M, [0, smooth ? 0 : -0.13 * s, 0]);
    const wr = joint('wr' + side, el, [0, -0.265, 0]);
    add(wr, new THREE.SphereGeometry(0.05 * s, 12, 10), M, [0, -0.05 * s, 0.01 * s], [0.75, 1.15, 1]);
    const hp = joint('hip' + side, hips, [0.095 * sx, -0.03, 0]);
    add(hp, smooth ? taper(0.085 * s, 0.058 * s, 0.38 * s) : new THREE.CapsuleGeometry(0.075 * s, 0.34 * s, 4, 12), M, [0, smooth ? 0 : -0.22 * s, 0]);
    const kn = joint('kn' + side, hp, [0, -0.44, 0]);
    add(kn, smooth ? taper(0.058 * s, 0.042 * s, 0.37 * s) : new THREE.CapsuleGeometry(0.058 * s, 0.33 * s, 4, 12), M, [0, smooth ? 0 : -0.21 * s, 0]);
    const an = joint('an' + side, kn, [0, -0.43, 0]);
    add(an, new RoundedBoxGeometry(0.095 * s, 0.07 * s, 0.24 * s, 2, 0.03 * s), M, [0, -0.03 * s, 0.06 * s]);
  }
  root.joints = J; root.parts = parts; root.legLength = 0.955 * s; root.height = height;
  root.setPose = (p) => {
    const P = fullPose(typeof p === 'string' ? (POSES[p] || POSES.stand) : p);
    const side = (n) => (n.endsWith('L') ? 1 : -1);
    J.hips.rotation.set(deg(P.hips[0]), deg(P.hips[1]), deg(P.hips[2]));
    for (const n of ['spine', 'chest', 'neck', 'head']) J[n].rotation.set(deg(P[n][0]), deg(P[n][1]), deg(P[n][2]));
    for (const n of ['shL', 'shR']) { J[n].rotation.set(-deg(P[n][0]), deg(P[n][2]) * side(n), deg(P[n][1]) * side(n)); }
    for (const n of ['elL', 'elR']) J[n].rotation.set(-deg(P[n][0]), 0, 0);
    for (const n of ['wrL', 'wrR']) J[n].rotation.set(-deg(P[n][0]), deg(P[n][1]), 0);
    for (const n of ['hipL', 'hipR']) J[n].rotation.set(-deg(P[n][0]), deg(P[n][2]) * side(n), deg(P[n][1]) * side(n));
    for (const n of ['knL', 'knR']) J[n].rotation.set(deg(P[n][0]), 0, 0);
    for (const n of ['anL', 'anR']) J[n].rotation.set(-deg(P[n][0]), 0, 0);
    return root;
  };
  root.blend = (a, b, k) => root.setPose(blendPose(a, b, k));
  // stand on the floor at (x, z) facing yaw degrees
  root.standAt = (x, z, yaw = 0, y = 0) => { root.position.set(x, y + root.legLength, z); root.rotation.set(0, deg(yaw), 0); return root; };
  root.setColor = (c) => { M.color?.set?.(c); return root; };
  root.setPose(pose);
  return root;
}
// bake one posed mannequin into a single geometry (for instanced crowds)
const _baked = new Map();
export function bakeMannequin(pose = 'sit', o = {}) {
  const k = JSON.stringify([pose, o.style, o.height]);
  if (_baked.has(k)) return _baked.get(k);
  const m = mannequin({ ...o, pose }); m.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(m.matrixWorld).invert(); const geos = [];
  m.traverse((x) => { if (x.isMesh) { const g = x.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, x.matrixWorld)); const n = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(n.attributes)) if (!['position', 'normal'].includes(a)) n.deleteAttribute(a); geos.push(n); } });
  const g = mergeGeometries(geos); _baked.set(k, g); return g;
}
// crowd([{pos:[x,y,z] (pelvis), yaw, pose, scale, color}], {style, color}) -> Group of InstancedMeshes (one per pose)
export function crowd(list, o = {}) {
  const g = new THREE.Group(); const byPose = new Map();
  for (const it of list) { const p = typeof it.pose === 'string' ? it.pose : JSON.stringify(it.pose || 'sit'); if (!byPose.has(p)) byPose.set(p, []); byPose.get(p).push(it); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  for (const [p, items] of byPose) {
    const geo = bakeMannequin(p.startsWith('{') ? JSON.parse(p) : p, { style: o.style });
    const im = new THREE.InstancedMesh(geo, mat(o.color || '#efede8', { rough: 0.72 }), items.length);
    items.forEach((it, i) => { q.setFromEuler(new THREE.Euler(0, deg(it.yaw || 0), 0)); const sc = it.scale || 1; im.setMatrixAt(i, m4.compose(V3(it.pos), q, new THREE.Vector3(sc, sc, sc))); if (it.color) im.setColorAt(i, col.set(it.color)); });
    im.castShadow = im.receiveShadow = true; g.add(im);
  }
  return g;
}

// ---------------------------------------------------------------- paths, sweeps, tubes
// path(points, {closed, tension, bank}) -> { curve, L, frame(s) -> {P,T,N,B}, point(s), wrap(s) }
// Frames use world-up (no inversions). bank(s) in degrees rolls the frame around T (for banked turns).
export function path(points, o = {}) {
  const pts = points.map((p) => V3(p));
  const curve = new THREE.CatmullRomCurve3(pts, !!o.closed, o.type || 'centripetal', o.tension ?? 0.5);
  curve.arcLengthDivisions = Math.max(2000, Math.round(curve.getLength() * 6));
  const L = curve.getLength();
  const wrap = (s) => (o.closed ? (((s % L) + L) % L) : clamp(s, 0, L));
  const frame = (s) => {
    const u = wrap(s) / L, P = curve.getPointAt(u), T = curve.getTangentAt(u).normalize();
    let B = new THREE.Vector3().crossVectors(T, UP); if (B.lengthSq() < 1e-6) B.set(0, 0, 1); B.normalize();
    let N = new THREE.Vector3().crossVectors(B, T).normalize();
    const bank = o.bank ? o.bank(wrap(s)) : 0;
    if (bank) { const q = new THREE.Quaternion().setFromAxisAngle(T, deg(bank)); N.applyQuaternion(q); B.applyQuaternion(q); }
    return { P, T, N, B };
  };
  // arc length of the highest point, and where height first drops below y before it (useful: lift hills)
  const crest = () => { let best = -1e9, bs = 0; for (let s = 0; s < L; s += 0.25) { const y = curve.getPointAt(s / L).y; if (y > best) { best = y; bs = s; } } return bs; };
  return { curve, L, frame, wrap, closed: !!o.closed, point: (s) => curve.getPointAt(wrap(s) / L), crest };
}
export const basisMatrix = (f, pos) => new THREE.Matrix4().makeBasis(f.T, f.N, f.B).setPosition(pos || f.P);
// sweep a closed polygon profile ([[n,b],...] in the N/B plane) along a path between s0..s1 (hard edges per side)
export function sweep(P, s0, s1, step, profile, o = {}) {
  const n = Math.max(2, Math.ceil(Math.abs(s1 - s0) / step)), geos = [];
  const frames = []; for (let i = 0; i <= n; i++) frames.push(P.frame(s0 + (s1 - s0) * i / n));
  const K = profile.length;
  for (let k = 0; k < (o.open ? K - 1 : K); k++) {
    const a = profile[k], b = profile[(k + 1) % K], pos = [], idx = [];
    frames.forEach((f, i) => { for (const c of [a, b]) { const p = f.P.clone().addScaledVector(f.N, c[0]).addScaledVector(f.B, c[1]); pos.push(p.x, p.y, p.z); } if (i < n) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); geos.push(g);
  }
  const m = new THREE.Mesh(mergeGeometries(geos), o.material || mat('#888', { side: 'double' })); m.castShadow = m.receiveShadow = true; return m;
}
export const rectProfile = (cy, cz, hy, hz) => [[cy + hy, cz - hz], [cy + hy, cz + hz], [cy - hy, cz + hz], [cy - hy, cz - hz]];
// tube offset from the path centreline
export function tubeAlong(P, s0, s1, step, offN, offB, radius, o = {}) {
  const pts = [], n = Math.ceil(Math.abs(s1 - s0) / step), closed = !!o.closed;
  for (let i = 0; i < (closed ? n : n + 1); i++) { const f = P.frame(s0 + (s1 - s0) * i / n); pts.push(f.P.clone().addScaledVector(f.N, offN).addScaledVector(f.B, offB)); }
  const c = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  const m = new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(8, pts.length * 2), radius, o.radial || 8, closed), o.material || mat('#555')); m.castShadow = m.receiveShadow = true; return m;
}
// instance a geometry every `step` metres along the path, oriented to the frame (T=x, N=y, B=z)
export function alongPath(P, s0, s1, step, geo, material, o = {}) {
  const n = Math.max(1, Math.floor(Math.abs(s1 - s0) / step)); const im = new THREE.InstancedMesh(geo, material, n);
  for (let i = 0; i < n; i++) { const s = s0 + i * step; const f = P.frame(s); const pos = f.P.clone().addScaledVector(f.N, o.offN || 0).addScaledVector(f.B, o.offB || 0);
    const M4 = o.horizontal ? (() => { const Th = new THREE.Vector3(f.T.x, 0, f.T.z).normalize(), Bh = new THREE.Vector3().crossVectors(Th, UP).normalize(); return new THREE.Matrix4().makeBasis(Th, UP, Bh).setPosition(pos); })() : basisMatrix(f, pos);
    im.setMatrixAt(i, M4); }
  im.castShadow = im.receiveShadow = true; return im;
}
// flat ribbon on the ground following points (roads, paths, queue lines). y lifted slightly to avoid z-fighting.
export function ribbon(points, width, material, o = {}) {
  const P = path(points.map((p) => (p.length === 2 ? [p[0], o.y ?? 0.02, p[1]] : p)), { closed: !!o.closed });
  const n = Math.max(2, Math.ceil(P.L / (o.step || 1))); const pos = [], idx = [], uv = [];
  for (let i = 0; i <= n; i++) { const f = P.frame((P.L * i) / n); const B = new THREE.Vector3(f.B.x, 0, f.B.z).normalize();
    for (const sgn of [-1, 1]) { const p = f.P.clone().addScaledVector(B, (sgn * width) / 2); pos.push(p.x, (o.y ?? 0.02) + (o.follow ? f.P.y : 0), p.z); uv.push(sgn < 0 ? 0 : 1, (P.L * i) / n / width); }
    if (i < n) { const j = i * 2; idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); m.receiveShadow = true; return m;
}

// ---------------------------------------------------------------- roller coaster
// coaster({ points, closed:true, colors:{track, rail, support, walk, chain}, gauge:1.12, spine:'box'|'tube', supports:{every:9, minY:3.4},
//           catwalk:[s0,s1] | 'lift', chain:[s0,s1] | 'lift', ties:1.0 }) -> { group, P, crestS, liftS, frame }
export function coaster(o = {}) {
  const C = { track: '#169a87', rail: '#66757a', support: '#d8d6cf', walk: '#b9bbb8', chain: '#2a2c2c', ...(o.colors || {}) };
  const P = path(o.points, { closed: o.closed ?? true, bank: o.bank });
  const G = new THREE.Group(); const half = (o.gauge || 1.12) / 2;
  const mT = mat(C.track, { rough: 0.55, metal: 0.15, side: 'double' }), mR = mat(C.rail, { rough: 0.42, metal: 0.1 }), mS = mat(C.support, { rough: 0.6 });
  const crestS = P.crest(); let liftS = crestS; for (let s = crestS; s > crestS - 400; s -= 0.25) { if (P.point(s).y < (o.liftBaseY ?? 6)) { liftS = s; break; } }
  const s0 = 0, s1 = P.L;
  if ((o.spine || 'box') === 'box') G.add(sweep(P, s0, s1, 0.6, rectProfile(-0.8, 0, 0.42, 0.36), { material: mT }));
  else G.add(tubeAlong(P, s0, s1, 0.6, -0.7, 0, 0.42, { closed: P.closed, material: mT }));
  G.add(tubeAlong(P, s0, s1, 0.6, 0, half, 0.13, { closed: P.closed, material: mR }), tubeAlong(P, s0, s1, 0.6, 0, -half, 0.13, { closed: P.closed, material: mR }));
  const tieStep = o.ties ?? 1.0;
  G.add(alongPath(P, 0, P.L, tieStep, new THREE.BoxGeometry(0.18, 0.2, half * 2 + 0.2), mT, { offN: -0.2 }), alongPath(P, 0, P.L, tieStep, new THREE.BoxGeometry(0.18, 0.5, 0.34), mT, { offN: -0.42 }));
  const range = (v) => (v === 'lift' ? [liftS + 2, crestS - 2] : v);
  if (o.chain !== false) { const [a, b] = range(o.chain || 'lift'); G.add(sweep(P, a, b, 0.6, rectProfile(-0.05, 0, 0.05, 0.11), { material: mat(C.chain, { side: 'double' }) })); }
  if (o.catwalk !== false) {
    const [a, b] = range(o.catwalk || 'lift'); const mW = mat(C.walk, { rough: 0.7, side: 'double' });
    G.add(sweep(P, a, b - 4, 0.6, rectProfile(-0.62, -1.55, 0.06, 0.4), { material: mW }), tubeAlong(P, a, b - 4, 0.6, 0.45, -1.98, 0.035, { material: mW }));
    G.add(alongPath(P, a, b - 4, 0.32, new THREE.BoxGeometry(0.24, 0.05, 0.78), mW, { offN: -0.52, offB: -1.55, horizontal: true }));
    G.add(alongPath(P, a, b - 4, 1.6, new THREE.CylinderGeometry(0.03, 0.03, 1.05, 6), mW, { offN: -0.08, offB: -1.98, horizontal: true }));
  }
  // supports: paired columns + cross beams
  const sp = { every: 9, minY: 3.4, spread: 1.35, ...(o.supports || {}) }; const cols = [], beams = [];
  if (o.supports !== false) for (let s = 0; s < P.L; s += sp.every) {
    const f = P.frame(s); if (f.P.y < sp.minY || Math.abs(f.T.y) > 0.8) continue;
    const Bh = new THREE.Vector3(f.B.x, 0, f.B.z).normalize(); const top = f.P.clone().addScaledVector(f.N, -1.25); const h = top.y - 0.25 - (o.groundY || 0);
    for (const sd of [-1, 1]) cols.push({ x: top.x + Bh.x * sp.spread * sd, z: top.z + Bh.z * sp.spread * sd, h });
    beams.push({ c: new THREE.Vector3(top.x, top.y - 0.25, top.z), dir: Bh, len: sp.spread * 2 + 0.7 });
    if (h > 20) for (let y = 14; y < h - 6; y += 15) beams.push({ c: new THREE.Vector3(top.x, (o.groundY || 0) + y, top.z), dir: Bh, len: sp.spread * 2 + 0.2 });
  }
  if (cols.length) {
    const cm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.38, 1, 14).translate(0, 0.5, 0), mS, cols.length), m4 = new THREE.Matrix4();
    cols.forEach((c, i) => cm.setMatrixAt(i, m4.compose(new THREE.Vector3(c.x, o.groundY || 0, c.z), new THREE.Quaternion(), new THREE.Vector3(1, c.h, 1))));
    const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.42, 0.42), mS, beams.length);
    beams.forEach((b, i) => bm.setMatrixAt(i, m4.compose(b.c, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.dir), new THREE.Vector3(b.len, 1, 1))));
    for (const m of [cm, bm]) { m.castShadow = m.receiveShadow = true; G.add(m); }
  }
  return { group: G, P, crestS, liftS, frame: P.frame, colors: C };
}
// train({ cars:9, across:4, gap:2.75, colors:{body, seat, bar, dark, metal, rider}, riders:true, riderStyle:'smooth', poses:[...], seed, nose:true })
// -> { group, cars:[{group, seats:[{rider, bar, barPivot, z}]}], place(P, sHead), length }
export function train(o = {}) {
  const C = { body: '#ebe8e1', seat: '#2b8a7b', bar: '#ea9128', dark: '#1e2224', metal: '#a7abae', rider: '#efede8', ...(o.colors || {}) };
  const N = o.cars ?? 9, across = o.across ?? 4, gap = o.gap ?? 2.75, r = rng(o.seed ?? 11);
  const poses = o.poses || ['ride', 'ride', 'ride', 'rideOneUp', 'rideArmsUp'];
  const width = across * 0.72; const zs = [...Array(across)].map((_, i) => (i - (across - 1) / 2) * 0.72);
  const G = new THREE.Group(); const cars = [];
  const mB = mat(C.body, { rough: 0.5 }), mSe = mat(C.seat, { rough: 0.55 }), mBa = mat(C.bar, { rough: 0.45 }), mD = mat(C.dark, { rough: 0.7 }), mM = mat(C.metal, { rough: 0.35, metal: 0.6 });
  for (let c = 0; c < N; c++) {
    const g = new THREE.Group(); g.matrixAutoUpdate = false; const parts = [];
    const P_ = (geo, m) => parts.push({ geo, mat: m });
    P_(placed(new RoundedBoxGeometry(2.4, 0.3, width + 0.25, 2, 0.12), [0, 0.5, 0]), mB);
    for (const z of [-(width + 0.15) / 2, (width + 0.15) / 2]) P_(placed(new RoundedBoxGeometry(2.3, 0.42, 0.1, 2, 0.04), [0, 0.78, z]), mB);
    if (c === 0 && o.nose !== false) P_(placed(new RoundedBoxGeometry(0.7, 0.5, width + 0.25, 2, 0.2), [1.25, 0.62, 0], [0, 0, -20]), mB);
    for (const sx of [-0.78, 0.78]) for (const sz of [-0.56, 0.56]) P_(placed(new RoundedBoxGeometry(0.62, 0.42, 0.3, 2, 0.04), [sx, 0.02, sz]), mD);
    P_(placed(new RoundedBoxGeometry(2.0, 0.16, 0.5, 2, 0.04), [0, 0.22, 0]), mD);
    const seats = [];
    for (const z of zs) {
      P_(placed(new RoundedBoxGeometry(0.56, 0.13, 0.52, 2, 0.05), [-0.42, 0.84, z]), mSe);
      P_(placed(new RoundedBoxGeometry(0.15, 1.0, 0.54, 2, 0.07), [-0.8, 1.3, z], [0, 0, 9]), mSe);
      P_(placed(new RoundedBoxGeometry(0.12, 0.08, 0.06, 1, 0.02), [0.26, 0.75, z]), mM);
      // lap bar on its own pivot (animate S.cars[i].seats[j].barPivot.rotation.z to open: positive = up/forward)
      const pivot = new THREE.Group(); pivot.position.set(0.26, 0.76, z); g.add(pivot);
      const post = mesh(capsuleBetween([0, 0, 0], [-0.28, 0.29, 0], 0.035), mM); pivot.add(post);
      const pad = rbox(0.34, 0.25, 0.46, mBa, [-0.36, 0.37, 0], [0, 0, -9], 0.09); pivot.add(pad);
      let rider = null;
      if (o.riders !== false) { rider = mannequin({ style: o.riderStyle || 'smooth', color: C.rider, pose: poses[Math.floor(r() * poses.length)], height: 1.62 + r() * 0.22 }); rider.position.set(-0.47, 0.98, z); rider.rotation.y = Math.PI / 2; g.add(rider); }
      seats.push({ z, pivot, barPivot: pivot, bar: pad, rider });
    }
    g.add(mergeByMaterial(parts)); G.add(g); cars.push({ group: g, seats });
  }
  const place = (P, sHead) => cars.forEach((car, i) => { const f = P.frame(sHead - 1.4 - i * gap); car.group.matrix.copy(basisMatrix(f)); car.group.matrixWorldNeedsUpdate = true; });
  return { group: G, cars, place, gap, length: N * gap, colors: C };
}
// riders in the train face +x (along the track). (rider.rotation.y = 90° maps mannequin +Z to car +X)

// ---------------------------------------------------------------- vegetation & ground
const PALETTES = {
  autumn: ['#4e6a2b', '#5c7a30', '#3f5a28', '#46622a', '#55702c', '#3b5226', '#6f7631', '#7e7a34', '#6a6e2e', '#5a6c2c', '#b8742c', '#bb862f', '#955a2c', '#8a6a2e', '#c29a3a'],
  summer: ['#3f6a2a', '#4b7a30', '#36592a', '#557f34', '#2f5226', '#5f8a3a', '#46702e', '#3a6430'],
  pine:   ['#2f4a2a', '#2a4226', '#37522c', '#30482b'],
  dry:    ['#7d7a45', '#8b8550', '#6a6a3c', '#9a8f58', '#5f6438'],
  tropical: ['#2f7a3a', '#3c8a40', '#2a6a34', '#4a9a48'],
  winter: ['#5a5e58', '#6a6d66', '#4e524c', '#7a7c74'],
  clay:   ['#f0efec', '#e9e8e4', '#e3e1dc'],
};
// forest({ center:[x,z], rMin:0, rMax:240, from:-180, to:180 (deg wedge), count:2000, farMax:1150, farCount:9000,
//          palette:'autumn', conifers:0.1, height:[11,19], exclude:(x,z)=>bool, seed }) -> Group
export function forest(o = {}) {
  const { center = [0, 0], rMin = 0, rMax = 240, from = -180, to = 180, count = 2000, farMax = 0, farCount = 0, conifers = 0.1, height = [11, 19], seed = 7, groundY = 0 } = o;
  const PAL = Array.isArray(o.palette) ? o.palette : PALETTES[o.palette || 'autumn']; const r = rng(seed);
  const near = [], far = [], trunks = [], cones = [];
  const place = (d0, d1, n, isNear) => {
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(lerp(d0 * d0, d1 * d1, r())), a = deg(lerp(from, to, r()));
      const x = center[0] + Math.cos(a) * d, z = center[1] + Math.sin(a) * d;
      if (o.exclude && o.exclude(x, z)) continue;
      const h = lerp(height[0], height[1], r());
      if (r() < conifers) { cones.push({ x, z, h: h * 1.15 }); continue; }
      const base = new THREE.Color(PAL[Math.floor(r() * PAL.length)]); const blobs = isNear ? 3 + Math.floor(r() * 3) : 2;
      if (isNear) trunks.push({ x, z, h: h * 0.55 });
      for (let b = 0; b < blobs; b++) { const rad = lerp(2.6, 4.4, r()) * (isNear ? 1 : 1.3) * (h / 15);
        (isNear ? near : far).push({ p: new THREE.Vector3(x + lerp(-2.4, 2.4, r()), groundY + h * lerp(0.58, 0.86, r()), z + lerp(-2.4, 2.4, r())), r: rad, sy: lerp(0.8, 1.05, r()), col: base.clone().offsetHSL(lerp(-0.015, 0.015, r()), lerp(-0.05, 0.05, r()), lerp(-0.05, 0.05, r())) }); }
    }
  };
  place(rMin, rMax, count, true); if (farCount) place(rMax, farMax || rMax * 4, farCount, false);
  const G = new THREE.Group(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true });
  const blobMesh = (list, geo, cast) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, leaf, list.length);
    list.forEach((b, i) => { q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, 0)); im.setMatrixAt(i, m4.compose(b.p, q, new THREE.Vector3(b.r, b.r * b.sy, b.r))); im.setColorAt(i, b.col); });
    im.castShadow = cast; im.receiveShadow = true; G.add(im); };
  blobMesh(near, new THREE.IcosahedronGeometry(1, 1), true); blobMesh(far, new THREE.IcosahedronGeometry(1, 0), false);
  if (trunks.length) { const tr = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.28, 1, 6).translate(0, 0.5, 0), mat('#4b3a2b', { rough: 1 }), trunks.length);
    trunks.forEach((t, i) => tr.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, groundY, t.z), new THREE.Quaternion(), new THREE.Vector3(1, t.h, 1)))); tr.castShadow = true; G.add(tr); }
  if (cones.length) { const cg = mergeGeometries([0, 1, 2].map((k) => new THREE.ConeGeometry(1 - k * 0.22, 0.5, 8).translate(0, 0.35 + k * 0.24, 0)));
    const cm = new THREE.InstancedMesh(cg, leaf, cones.length); const PC = PALETTES.pine;
    cones.forEach((c, i) => { cm.setMatrixAt(i, m4.compose(new THREE.Vector3(c.x, groundY, c.z), new THREE.Quaternion(), new THREE.Vector3(c.h * 0.24, c.h, c.h * 0.24))); cm.setColorAt(i, new THREE.Color(PC[i % PC.length])); });
    cm.castShadow = cm.receiveShadow = true; G.add(cm); }
  return G;
}
// single stylised tree / bush (foreground hero trees)
export function tree(o = {}) { const { h = 8, color = '#4e6a2b', seed = 3, blobs = 5 } = o; const r = rng(seed), g = new THREE.Group();
  g.add(cyl(0.18 * h / 8, 0.3 * h / 8, h * 0.55, mat('#4b3a2b', { rough: 1 }), [0, h * 0.275, 0], null, 8));
  for (let i = 0; i < blobs; i++) g.add(mesh(new THREE.IcosahedronGeometry(h * lerp(0.2, 0.32, r()), 1), mat(new THREE.Color(color).offsetHSL(0, 0, lerp(-0.05, 0.05, r())).getStyle(), { flat: true, rough: 0.9 }), [lerp(-1, 1, r()) * h * 0.15, h * lerp(0.6, 0.85, r()), lerp(-1, 1, r()) * h * 0.15]));
  return g; }
export function ground(o = {}) { const { size = 4000, color = '#3b4827', y = 0 } = o; const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), o.material || mat(color, { rough: 1 })); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; return m; }
// paved plaza with tile seams
export function plaza(w, d, o = {}) { const { color = '#c9c2b3', seam = 'rgba(0,0,0,.12)', tile = 2.5 } = o;
  const t = canvasTex(256, 256, (g, W, H) => { g.fillStyle = color; g.fillRect(0, 0, W, H); g.strokeStyle = seam; g.lineWidth = 3; g.strokeRect(0, 0, W, H); }, { repeat: [w / tile, d / tile] });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 })); m.rotation.x = -Math.PI / 2; m.position.y = o.y ?? 0.01; m.receiveShadow = true; return m; }

// ---------------------------------------------------------------- built environment
// building({ w, h, d, wall:'#d9ccb4', roof:'#7a5a48', floors, cols, lit, roofType:'flat'|'gable', trim }) — origin at ground centre
export function building(o = {}) {
  const { w = 20, h = 10, d = 14, wall = '#d9ccb4', roof = '#8a8a86', roofType = 'flat', seed = 1, lit = 0 } = o;
  const floors = o.floors ?? Math.max(1, Math.round(h / 3.4)), cols = o.cols ?? Math.max(2, Math.round(w / 3.2));
  const G = new THREE.Group();
  const front = facadeTex({ cols, rows: floors, wall, seed, lit, win: o.win || '#5d6f80', frame: o.frame || '#f2efe8' });
  const side = facadeTex({ cols: Math.max(2, Math.round(d / 3.2)), rows: floors, wall, seed: seed + 1, lit, win: o.win || '#5d6f80', frame: o.frame || '#f2efe8' });
  const mF = new THREE.MeshStandardMaterial({ map: front, roughness: 0.9 }), mS = new THREE.MeshStandardMaterial({ map: side, roughness: 0.9 }), mW = mat(wall, { rough: 0.9 });
  if (lit) { mF.emissive = new THREE.Color('#ffffff'); mF.emissiveMap = front; mF.emissiveIntensity = 0.35; mS.emissive = new THREE.Color('#ffffff'); mS.emissiveMap = side; mS.emissiveIntensity = 0.35; }
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mS, mS, mW, mW, mF, mF]); b.position.y = h / 2; b.castShadow = b.receiveShadow = true; G.add(b);
  if (roofType === 'gable') { const shape = new THREE.Shape([new THREE.Vector2(-d / 2 - 0.4, 0), new THREE.Vector2(d / 2 + 0.4, 0), new THREE.Vector2(0, d * 0.32)]); const rg = new THREE.ExtrudeGeometry(shape, { depth: w + 0.8, bevelEnabled: false }); rg.translate(0, 0, -(w + 0.8) / 2); const rm = mesh(rg, mat(roof, { rough: 0.85, flat: true }), [0, h, 0], [0, 90, 0]); G.add(rm); }
  else { G.add(box(w + 0.4, 0.5, d + 0.4, mat(o.trim || roof, { rough: 0.8 }), [0, h + 0.25, 0])); }
  if (o.pos) G.position.set(o.pos[0], 0, o.pos[1]); if (o.yaw) G.rotation.y = deg(o.yaw);
  return G;
}
// open canopy / station roof on columns: canopy({w, d, h, color, columns:[cx, cz], roofColor})
export function canopy(o = {}) { const { w = 30, d = 10, h = 4.5, color = '#d8d6cf', roofColor = '#e8e6e0', nx = 6, nz = 2 } = o; const G = new THREE.Group();
  G.add(box(w, 0.35, d, mat(roofColor, { rough: 0.6 }), [0, h, 0]));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) G.add(cyl(0.16, 0.16, h, mat(color, { rough: 0.4, metal: 0.4 }), [(-w / 2 + 0.6) + (i * (w - 1.2)) / Math.max(1, nx - 1), h / 2, (-d / 2 + 0.6) + (j * (d - 1.2)) / Math.max(1, nz - 1)], null, 12));
  if (o.pos) G.position.set(o.pos[0], o.pos[1] || 0, o.pos[2] || 0); return G; }
// railing along points [[x,z],...] at height h
export function railing(points, o = {}) { const { h = 1.05, color = '#c9cdd0', y = 0, post = 1.6, r = 0.03 } = o; const G = new THREE.Group(); const m = mat(color, { rough: 0.35, metal: 0.5 });
  const pts3 = points.map((p) => new THREE.Vector3(p[0], y + h, p[1])); const c = new THREE.CatmullRomCurve3(pts3, false, 'centripetal', 0); G.add(mesh(new THREE.TubeGeometry(c, pts3.length * 8, r, 6), m));
  const mid = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], y + h * 0.5, p[1])), false, 'centripetal', 0); G.add(mesh(new THREE.TubeGeometry(mid, pts3.length * 8, r * 0.8, 6), m));
  const L = c.getLength(); for (let s = 0; s <= L; s += post) { const p = c.getPointAt(s / L); G.add(cyl(r, r, h, m, [p.x, y + h / 2, p.z], null, 6)); } return G; }
export function stairs(o = {}) { const { w = 3, steps = 12, rise = 0.18, run = 0.3, color = '#cfc9bd' } = o; const G = new THREE.Group(); const m = mat(color, { rough: 0.9 });
  for (let i = 0; i < steps; i++) G.add(box(w, rise * (i + 1), run, m, [0, (rise * (i + 1)) / 2, -i * run])); return G; }
export function lamp(o = {}) { const { h = 4.2, color = '#2a2c2e', light = '#fff2c8', on = false } = o; const G = new THREE.Group(); G.add(cyl(0.06, 0.09, h, mat(color, { rough: 0.5, metal: 0.4 }), [0, h / 2, 0], null, 10));
  G.add(sphere(0.22, on ? glowMat(light, 3) : mat('#f4f1e8', { rough: 0.3 }), [0, h + 0.1, 0])); if (on) { const pl = new THREE.PointLight(new THREE.Color(light), 6, 14, 2); pl.position.set(0, h, 0); G.add(pl); } return G; }
export function bench(o = {}) { const m = mat(o.color || '#6b4a32', { rough: 0.8 }); const G = new THREE.Group(); G.add(box(1.8, 0.06, 0.45, m, [0, 0.45, 0]), box(1.8, 0.4, 0.06, m, [0, 0.72, -0.2], [-12, 0, 0])); for (const x of [-0.8, 0.8]) G.add(box(0.06, 0.45, 0.45, mat('#2a2c2e'), [x, 0.22, 0])); return G; }
// sign board with text: sign('RIDE NAME', {w:6, h:1.4, color:'#0f6b5e', text:'#fff', posts:true})
export function sign(text, o = {}) { const { w = 6, h = 1.4, color = '#0f6b5e', ink = '#ffffff', posts = true, glow = 0 } = o; const G = new THREE.Group();
  const t = textTex(text, { w: 1024, h: Math.round(1024 * h / w), bg: color, color: ink, font: `900 ${Math.round(1024 * h / w * 0.62)}px Archivo, Inter, sans-serif` });
  const face = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.15), [mat(color), mat(color), mat(color), mat(color), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: glow ? new THREE.Color('#fff') : new THREE.Color('#000'), emissiveMap: glow ? t : null, emissiveIntensity: glow }), mat(color)]);
  face.position.y = (posts ? (o.postH ?? 2.2) : 0) + h / 2; face.castShadow = true; G.add(face);
  if (posts) for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) G.add(cyl(0.08, 0.08, o.postH ?? 2.2, mat('#2a2c2e'), [x, (o.postH ?? 2.2) / 2, 0], null, 8)); return G; }

// ---------------------------------------------------------------- markers & highlights
// ground ring that pulses: const r = ring({radius:3, color}); r.animate(t)
export function ring(o = {}) { const { radius = 3, color = '#2f6fdb', width = 0.18, y = 0.05 } = o; const g = new THREE.Group();
  const m1 = new THREE.Mesh(new THREE.RingGeometry(radius - width, radius, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  const m2 = new THREE.Mesh(new THREE.RingGeometry(radius - width * 0.6, radius, 64), m1.material.clone()); m1.rotation.x = m2.rotation.x = -Math.PI / 2; m1.position.y = m2.position.y = y; g.add(m1, m2);
  g.animate = (t, period = 1.6) => { const k = (t % period) / period; m2.scale.setScalar(1 + k * 0.8); m2.material.opacity = (1 - k) * 0.8; }; return g; }
// translucent highlight blob (ellipse on the ground or floating), like a "this area" callout
export function zone(o = {}) { const { rx = 10, rz = 7, color = '#38d24a', opacity = 0.45, y = 0.3 } = o; const m = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })); m.scale.set(rx, rz, 1); m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 5; return m; }
export function glowDot(o = {}) { const { r = 0.5, color = '#ffd98a', power = 4 } = o; return new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), glowMat(color, power)); }
export function arrow3D(o = {}) { const { len = 3, color = '#2f6fdb', r = 0.12 } = o; const g = new THREE.Group(); const m = mat(color, { rough: 0.4, emissive: color, glow: 0.4 });
  g.add(cyl(r, r, len * 0.75, m, [0, len * 0.375, 0], null, 12)); g.add(mesh(new THREE.ConeGeometry(r * 2.6, len * 0.25, 16), m, [0, len * 0.875, 0])); return g; }
// vertical light beam (e.g. a location pin on a map or "here" in a wide shot)
export function beam(o = {}) { const { h = 40, r = 0.5, color = '#ffd98a', opacity = 0.35 } = o; const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })); m.position.y = h / 2; return m; }
