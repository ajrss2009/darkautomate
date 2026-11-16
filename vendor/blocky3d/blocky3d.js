/*
 * blocky3d — avatar "blocky" (bloco de brinquedo, proporções R6) para cenas por código em Three.js.
 * Escrito para o FilmForge/Dark Automate. Cabeça cilíndrica de bordas arredondadas, tronco 2×2×1, braços e pernas
 * 1×2×1, cabelos e acessórios por blocos, rosto em CAMADAS vindo de dois atlas 4×4 (olhos e boca) projetados na
 * frente da cabeça, expressões, gestos com overshoot, caminhada, fala (lip flap) e piscadas. Determinístico:
 * tudo é função de t (nada de relógio), como o renderizador quadro a quadro exige.
 *
 *   import * as THREE from 'three';
 *   import { loadFaces, avatar, studio, EXPR } from '../../../kit/blocky3d.js';
 *   const faces = await loadFaces('../../../kit/faces/', ['kid', 'girl']);   // kid_eyes.png + kid_mouth.png …
 *   const eddie = avatar({ skin:'#f1dfc6', shirt:'#8db8ee', pants:'#3c5cbc', hair:'spiky', hairColor:'#7c4426', face:'kid' }, faces);
 *   scene.add(eddie.group); eddie.group.position.set(0, 0, 0);
 *   // em render(t): eddie.update(t, { expr: 'shock', gesture: 'hands_head', walk: 0, talk: [ [0.4, 1.6] ] });
 */
import * as THREE from 'three';

export const EYE = { normal: 0, wide: 1, half: 2, closed: 3, happy: 4, squint: 5, side_l: 6, side_r: 7, terror: 8, worried: 9, angry: 10, scared: 11, wink: 12, up: 13, down: 14, cry: 15 };
export const MOUTH = { flat: 0, smile: 1, open_smile: 2, laugh: 3, frown: 4, o: 5, talk: 6, talk_wide: 7, grimace: 8, grimace_wide: 9, scream: 10, smirk: 11, wavy: 12, yawn: 13, grin: 14, ah: 15 };
export const EXPR = {
  neutral: ['normal', 'flat'], happy: ['normal', 'open_smile'], joy: ['happy', 'laugh'], smile: ['normal', 'smile'], grin: ['happy', 'grin'],
  shock: ['wide', 'grimace'], gasp: ['wide', 'o'], terror: ['terror', 'grimace_wide'], scream: ['scared', 'scream'], worried: ['worried', 'frown'],
  angry: ['angry', 'grimace'], furious: ['angry', 'scream'], smug: ['half', 'smirk'], bored: ['half', 'flat'], sleepy: ['half', 'wavy'],
  yawn: ['closed', 'yawn'], sus: ['squint', 'wavy'], side_l: ['side_l', 'frown'], side_r: ['side_r', 'frown'], wink: ['wink', 'smirk'],
  cry: ['cry', 'ah'], scared: ['scared', 'frown'], talk: ['normal', 'talk'], shout: ['angry', 'talk_wide'], determined: ['angry', 'flat'],
  relief: ['closed', 'smile'], confused: ['squint', 'o'], lookup: ['up', 'o'], lookdown: ['down', 'frown'], panic: ['terror', 'scream'],
};
/* gestos: ângulos em graus — braço [x: para frente(+)/trás(−), z: abrir(+)], tronco/cabeça [x inclina, y gira, z tomba] */
export const GESTURES = {
  idle: { armL: [0, 4], armR: [0, 4] },
  shock: { armL: [35, 55], armR: [35, 55], torso: [-8, 0, 0], head: [-10, 0, 0] },
  hands_head: { armL: [150, 25], armR: [150, 25], head: [-6, 0, 0] },
  hands_face: { armL: [120, 8], armR: [120, 8], head: [8, 0, 0] },
  cheer: { armL: [170, 25], armR: [170, 25], head: [-12, 0, 0] },
  point: { armR: [90, 4], armL: [0, 6] }, point_l: { armL: [90, 4], armR: [0, 6] },
  shrug: { armL: [20, 40], armR: [20, 40], head: [0, 0, 8] },
  recoil: { armL: [50, 30], armR: [50, 30], torso: [-14, 0, 0], head: [-14, 0, 0] },
  lean: { torso: [14, 0, 0], head: [6, 0, 0] }, slump: { armL: [-6, 2], armR: [-6, 2], torso: [18, 0, 0], head: [22, 0, 0] },
  think: { armR: [115, -10], armL: [40, -20], head: [0, 0, -10] }, cross: { armL: [80, -45], armR: [80, -45] },
  phone: { armR: [120, -15], head: [12, 0, 0] }, reach: { armL: [95, 6], armR: [95, 6], torso: [10, 0, 0] },
  push: { armL: [90, 0], armR: [90, 0], torso: [12, 0, 0] }, hold: { armL: [60, -18], armR: [60, -18] },
  wave: { armR: [160, 30] }, fists: { armL: [70, -10], armR: [70, -10], torso: [6, 0, 0] },
  facepalm: { armR: [128, -12], head: [14, 0, 0] }, brace: { armL: [60, 45], armR: [60, 45], torso: [-6, 0, 0] },
};

const rad = (d) => (d * Math.PI) / 180;
const col = (hex) => new THREE.Color(hex);
const plastic = (hex, rough = 0.42) => new THREE.MeshStandardMaterial({ color: col(hex), roughness: rough, metalness: 0.02 });

/** Carrega os atlas de rosto (<nome>_eyes.png e <nome>_mouth.png, 4×4 células) antes do 1º quadro. */
export async function loadFaces(dir, names) {
  const base = dir.endsWith('/') ? dir : dir + '/';
  const load = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
  const out = {};
  for (const n of names) out[n] = { eyes: await load(`${base}${n}_eyes.png`), mouth: await load(`${base}${n}_mouth.png`) };
  return out;
}

/* textura do rosto (olhos + boca) por combinação, em cache */
function faceTexture(face, eyes, mouth, cache) {
  const key = `${eyes}|${mouth}`;
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  const cell = (img, idx) => { if (!img) return; const s = img.width / 4; g.drawImage(img, (idx % 4) * s, Math.floor(idx / 4) * s, s, s, 0, 0, 512, 512); };
  cell(face?.eyes, EYE[eyes] ?? 0); cell(face?.mouth, MOUTH[mouth] ?? 0);
  if (!face?.eyes) { /* sem atlas: rosto simples desenhado */ g.fillStyle = '#1b1b1b'; g.beginPath(); g.ellipse(190, 230, 22, 34, 0, 0, Math.PI * 2); g.ellipse(322, 230, 22, 34, 0, 0, Math.PI * 2); g.fill(); g.lineWidth = 14; g.beginPath(); g.arc(256, 300, 70, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/* casca da frente da cabeça com UV planar (projeção frontal 1,5 × 1,5, como no rig do kit) */
function faceShell(r, h) {
  const geo = new THREE.CylinderGeometry(r, r, h, 48, 1, true, -Math.PI / 2, Math.PI);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 1.5 + 0.5, (pos.getY(i) + 0.06) / 1.5 + 0.5);
  uv.needsUpdate = true;
  return geo;
}

function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 2, 2, 2), mat); }

/**
 * Cria o avatar. spec: { skin, shirt, pants, hair, hairColor, face, sleeves:'short'|'long'|'none', shirtKind:'stripes'|'checker',
 * shirtC2, bolt:'#hex', vneck:'#hex', extras:['glasses','beard','collar','backpack','backpack:TEXTO'], scale }
 */
export function avatar(spec = {}, faces = {}) {
  const s = { skin: '#f1dfc6', shirt: '#8db8ee', pants: '#3d5fb8', hair: 'spiky', hairColor: '#a05f37', face: 'kid', sleeves: 'short', extras: [], ...spec };
  const M = { skin: plastic(s.skin), shirt: plastic(s.shirt, 0.5), pants: plastic(s.pants, 0.5), hair: plastic(s.hairColor, 0.38) };
  if (s.shirtKind === 'stripes' || s.shirtKind === 'checker') {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
    g.fillStyle = s.shirt; g.fillRect(0, 0, 64, 64); g.fillStyle = s.shirtC2 || '#ffffff';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (s.shirtKind === 'stripes' ? i % 2 === 0 : (i + j) % 2 === 0) g.fillRect(s.shirtKind === 'stripes' ? 0 : j * 16, i * 16, s.shirtKind === 'stripes' ? 64 : 16, 8 + (s.shirtKind === 'checker' ? 8 : 0));
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
    M.shirt = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  }
  const group = new THREE.Group(); group.name = s.name || 'avatar';
  const hip = new THREE.Group(); hip.position.y = 2; group.add(hip);
  const torso = box(2, 2, 1, M.shirt); torso.position.y = 1; hip.add(torso);
  const neck = new THREE.Group(); neck.position.y = 2; hip.add(neck);
  const head = new THREE.Group(); head.position.y = 0.62; neck.add(head);
  const headMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.86, 40), M.skin); head.add(headMesh);
  for (const y of [0.43, -0.43]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 40, 16), M.skin); cap.scale.set(1, 0.3, 1); cap.position.y = y; head.add(cap); }
  const faceCache = new Map();
  const faceMat = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const faceMesh = new THREE.Mesh(faceShell(0.628, 1.2), faceMat); head.add(faceMesh);
  const fdata = faces[s.face];
  const setFace = (eyes, mouth) => { faceMat.map = faceTexture(fdata, eyes, mouth, faceCache); faceMat.needsUpdate = true; };
  setFace('normal', 'flat');
  /* braços: pivô no ombro; manga até a altura escolhida */
  const cut = { short: 0.0, long: -0.9, none: 0.9 }[s.sleeves] ?? 0;
  const arm = (x) => {
    const piv = new THREE.Group(); piv.position.set(x, 1.55, 0); hip.add(piv);
    const top = 0.45, bot = -1.55, mid = Math.max(bot, Math.min(top, cut));
    if (top - mid > 0.01) { const m = box(1, top - mid, 1, M.shirt); m.position.y = (top + mid) / 2; piv.add(m); }
    if (mid - bot > 0.01) { const m = box(1, mid - bot, 1, M.skin); m.position.y = (mid + bot) / 2; piv.add(m); }
    return piv;
  };
  const armL = arm(1.5), armR = arm(-1.5);
  const leg = (x) => { const piv = new THREE.Group(); piv.position.set(x, 0, 0); hip.add(piv); const m = box(0.98, 2, 1, M.pants); m.position.y = -1; piv.add(m); return piv; };
  const legL = leg(0.5), legR = leg(-0.5);
  /* decalques no peito (frente = +z) */
  if (s.vneck) { const sh = new THREE.Shape([new THREE.Vector2(-0.42, 0), new THREE.Vector2(0.42, 0), new THREE.Vector2(0, -0.55)]); const v = new THREE.Mesh(new THREE.ShapeGeometry(sh), plastic(s.vneck, 0.5)); v.position.set(0, 1.98, 0.505); hip.add(v); }
  if (s.bolt) {
    const pts = [[0.05, 0.62], [-0.28, 0], [-0.02, 0.02], [-0.16, -0.62], [0.26, 0.12], [0, 0.1], [0.2, 0.62]].map(([x, y]) => new THREE.Vector2(x * 1.05, y * 1.05));
    const b = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), plastic(s.bolt, 0.45)); b.position.set(0.05, 0.95, 0.506); hip.add(b);
  }
  hairOf(s.hair, M.hair, head);
  for (const ex of s.extras || []) extraOf(String(ex), head, hip, M);
  if (s.scale) group.scale.setScalar(s.scale);

  const parts = { hip, torso, neck, head, armL, armR, legL, legR, face: faceMesh };
  const setRot = (o, [x = 0, y = 0, z = 0] = []) => o.rotation.set(rad(x), rad(y), rad(z));
  /**
   * Um quadro do personagem em t. o: { expr, eyes, mouth, gesture, gestureAt (s, início do gesto p/ overshoot),
   * walk (velocidade: 0 parado, 1 andando, 2 correndo), talk ([[ini, fim], …] trechos de fala), blink (true) }
   */
  function update(t, o = {}) {
    const [e0, m0] = EXPR[o.expr] ?? [o.eyes ?? 'normal', o.mouth ?? 'flat'];
    let eyes = o.eyes ?? e0, mouth = o.mouth ?? m0;
    const talking = (o.talk ?? []).some(([a, b]) => t >= a && t <= b);
    if (talking) mouth = Math.floor(t * 9) % 3 === 0 ? (mouth === 'flat' ? 'talk' : mouth) : Math.floor(t * 9) % 3 === 1 ? 'talk_wide' : 'flat';
    if (o.blink !== false && eyes !== 'closed') { const ph = (t + (s.seed ?? 0) * 0.37) % 3.1; if (ph < 0.12) eyes = 'closed'; }
    setFace(eyes, mouth);
    /* gesto com overshoot: chega a 115% e assenta em 100% */
    const g = GESTURES[o.gesture] ?? GESTURES.idle;
    const dt = Math.max(0, t - (o.gestureAt ?? -10));
    const k = dt >= 0.45 ? 1 : dt < 0.18 ? (dt / 0.18) * 1.15 : 1.15 - ((dt - 0.18) / 0.27) * 0.15;
    const armPose = (p, side) => (p ? [-p[0] * k, 0, side * p[1] * k] : [0, 0, side * 4]);
    setRot(armL, armPose(g.armL, 1)); setRot(armR, armPose(g.armR, -1));
    setRot(hip, (g.torso ?? [0, 0, 0]).map((v) => v * k)); setRot(neck, (g.head ?? [0, 0, 0]).map((v) => v * k));
    /* caminhada/corrida: pernas e braços em oposição, quique leve */
    const w = o.walk ?? 0;
    if (w > 0) {
      const sp = w >= 2 ? 11 : 7, amp = w >= 2 ? 55 : 32, ph = Math.sin(t * sp);
      legL.rotation.x = rad(amp * ph); legR.rotation.x = rad(-amp * ph);
      if (!g.armL) armL.rotation.x = rad(-amp * 0.8 * ph);
      if (!g.armR) armR.rotation.x = rad(amp * 0.8 * ph);
      hip.position.y = 2 + Math.abs(Math.cos(t * sp)) * (w >= 2 ? 0.22 : 0.1);
    } else { legL.rotation.x = 0; legR.rotation.x = 0; hip.position.y = 2 + Math.sin(t * 2.2) * 0.02; }
  }
  return { group, parts, update, setFace, spec: s };
}

function hairOf(kind, M, head) {
  if (!kind || kind === 'none' || kind === 'bald') return;
  const add = (geo, x, y, z, sx = 1, sy = 1, sz = 1, mat = M) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); head.add(m); return m; };
  const cap = () => add(new THREE.SphereGeometry(0.7, 32, 16), 0, 0.56, -0.08, 1, 0.5, 1);
  if (['spiky', 'slick', 'short', 'messy'].includes(kind)) {
    cap();
    [-0.48, -0.3, -0.1, 0.1, 0.3, 0.48].forEach((x) => add(new THREE.SphereGeometry(0.19, 16, 10), x, 0.58 - Math.abs(x) * 0.06, 0.5 - Math.abs(x) * 0.36, 1, 0.5, 0.45));
    if (kind === 'spiky') for (let i = 0; i < 12; i++) {
      const yaw = (i / 12) * Math.PI * 2, tilt = rad(i % 3 === 0 ? 20 : 45), ln = 0.75;
      const d = new THREE.Vector3(Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt), Math.cos(yaw) * Math.sin(tilt));
      const c = add(new THREE.ConeGeometry(0.25, ln, 12), d.x * 0.42 + d.x * ln / 2, 0.54 + d.y * 0.2 + d.y * ln / 2, -0.08 + d.z * 0.42 + d.z * ln / 2);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    }
    if (kind === 'messy') for (let i = 0; i < 7; i++) add(new THREE.SphereGeometry(0.24, 12, 8), Math.sin(i * 1.7) * 0.45, 0.78 + (i % 2) * 0.08, Math.cos(i * 1.7) * 0.45 - 0.08);
  } else if (kind === 'buzz') add(new THREE.SphereGeometry(0.66, 32, 16), 0, 0.5, -0.04, 1, 0.42, 1);
  else if (kind === 'bob') { cap(); add(new THREE.BoxGeometry(0.3, 0.95, 1.05), 0.66, 0.08, -0.12); add(new THREE.BoxGeometry(0.3, 0.95, 1.05), -0.66, 0.08, -0.12); add(new THREE.BoxGeometry(1.3, 1.0, 0.3), 0, 0.1, -0.66); }
  else if (kind === 'bun') { cap(); add(new THREE.SphereGeometry(0.32, 16, 12), 0, 0.95, -0.35); }
  else if (kind === 'cap') { add(new THREE.SphereGeometry(0.68, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.42, 0, 1, 0.75, 1); add(new THREE.BoxGeometry(0.9, 0.06, 0.6), 0, 0.46, 0.85); }
  else if (kind === 'helmet') { add(new THREE.SphereGeometry(0.75, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.35, 0); add(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 32), 0, 0.36, 0); }
  else if (kind === 'tophat') { add(new THREE.CylinderGeometry(0.5, 0.5, 0.9, 32), 0, 1.05, 0); add(new THREE.CylinderGeometry(0.85, 0.85, 0.06, 32), 0, 0.62, 0); }
  else if (kind === 'pilot') { cap(); add(new THREE.BoxGeometry(1.2, 0.2, 0.1), 0, 0.5, 0.62, 1, 1, 1, new THREE.MeshStandardMaterial({ color: '#6fb6ff', roughness: 0.1, metalness: 0.3 })); }
  else cap();
}

function extraOf(ex, head, hip, M) {
  const [kind, text] = ex.split(':');
  const dark = plastic('#1d1d1d', 0.3);
  if (kind === 'glasses') { for (const x of [-0.24, 0.24]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 24), dark); r.position.set(x, 0.1, 0.64); head.add(r); } const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), dark); b.position.set(0, 0.12, 0.65); head.add(b); }
  else if (kind === 'beard') { const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.25), M.hair); b.position.set(0, -0.42, 0.52); head.add(b); }
  else if (kind === 'collar') { const c = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.4), plastic('#f4f4f4', 0.5)); c.position.set(0, 2.02, 0.35); hip.add(c); }
  else if (kind === 'backpack') {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.6, 0.6), plastic('#c0392b', 0.5)); p.position.set(0, 1.05, -0.8); hip.add(p);
    if (text) { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.fillText(text.slice(0, 8), 128, 84);
      const l = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true })); l.position.set(0, 1.05, -1.11); l.rotation.y = Math.PI; hip.add(l); }
  }
}

/** Luz de estúdio saturada (céu, sol e preenchimento) — o look de brinquedo de plástico. */
export function studio(scene, o = {}) {
  scene.background = new THREE.Color(o.sky ?? '#7ec8ff');
  scene.add(new THREE.HemisphereLight(o.skyLight ?? '#dff2ff', o.ground ?? '#8a7a5a', 1.25));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.9); sun.position.set(6, 12, 9); scene.add(sun);
  const fill = new THREE.DirectionalLight('#bcd7ff', 0.55); fill.position.set(-8, 5, 6); scene.add(fill);
  return { sun, fill };
}

/** Chão de placas (baseplate) com textura de pinos — o piso clássico dos mundos de blocos. */
export function baseplate(scene, o = {}) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  g.fillStyle = o.color ?? '#5fae4f'; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(32, 32, 14, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set((o.size ?? 120) / 2, (o.size ?? 120) / 2); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(o.size ?? 120, o.size ?? 120), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
  m.rotation.x = -Math.PI / 2; scene.add(m); return m;
}

/** Placa/cartaz com uma imagem (textura do kit), de frente para a câmera. */
export async function imageCard(scene, src, w, h, pos = [0, 2, 0], rotY = 0) {
  const tex = await new Promise((ok) => new THREE.TextureLoader().load(src, ok, undefined, () => ok(null)));
  if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), [plastic('#ddd'), plastic('#ddd'), plastic('#ddd'), plastic('#ddd'), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), plastic('#ddd')]);
  m.position.set(...pos); m.rotation.y = rotY; scene.add(m); return m;
}

/** Câmera: push-in, crash zoom e tremida, sempre em função de t (nunca parada). */
export function camMove(cam, t, o = {}) {
  const [x, y, z] = o.from ?? [0, 3.6, 9]; const [tx, ty, tz] = o.target ?? [0, 3.4, 0];
  const push = 1 - Math.min(1, t / (o.dur ?? 3)) * (o.push ?? 0.2);
  const crash = o.crashAt !== undefined && t >= o.crashAt ? Math.max(0.55, 1 - (t - o.crashAt) * 4) : 1;
  const sh = o.shake ? Math.sin(t * 37) * 0.04 + Math.sin(t * 23) * 0.03 : 0;
  cam.position.set(tx + (x - tx) * push * crash + sh, ty + (y - ty) * push * crash + sh * 0.6, tz + (z - tz) * push * crash);
  cam.lookAt(tx, ty, tz);
}
