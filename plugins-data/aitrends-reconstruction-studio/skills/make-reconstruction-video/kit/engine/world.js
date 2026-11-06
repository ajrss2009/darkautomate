// engine/world.js — WebGL renderer, post chain, sets (one THREE.Scene each), looks, camera helpers.
// 1 world unit = 1 metre. Sets are built once (async allowed) and cached; shots only move things.
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { E, key, ease, clamp, lerp, drift, getSetBuilder } from './core.js';
import { resolveLook } from './looks.js';
export { THREE };

export const QUALITY = {
  draft:    { msaa: 0, ao: false, shadow: 1024, bloom: false },
  standard: { msaa: 2, ao: true, aoHalf: true, shadow: 2048, bloom: true },
  high:     { msaa: 4, ao: true, aoHalf: false, shadow: 4096, bloom: true },
};
const C = (c) => new THREE.Color(c);
let R = null, composer = null, renderPass = null, aoPass = null, fxPass = null, fx = {};
const sets = new Map();   // id -> { scene, camera, api, look, lights, sky }
let current = null;

export function initRenderer(canvas) {
  const Q = QUALITY[E.quality] || QUALITY.standard;
  R = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  R.setPixelRatio(1); R.setSize(E.outW, E.outH, false);
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  R.toneMapping = THREE.NoToneMapping; R.outputColorSpace = THREE.SRGBColorSpace;
  composer = new EffectComposer(R, { frameBufferType: THREE.HalfFloatType, multisampling: Q.msaa });
  const dummyScene = new THREE.Scene(), dummyCam = new THREE.PerspectiveCamera();
  renderPass = new RenderPass(dummyScene, dummyCam); composer.addPass(renderPass);
  if (Q.ao) {
    aoPass = new N8AOPostPass(dummyScene, dummyCam, E.outW, E.outH);
    Object.assign(aoPass.configuration, { aoSamples: 16, denoiseSamples: 8, denoiseRadius: 10, halfRes: !!Q.aoHalf, gammaCorrection: false });
    composer.addPass(aoPass);
  }
  fx.bloom = new BloomEffect({ intensity: 0.3, luminanceThreshold: 0.86, luminanceSmoothing: 0.25, mipmapBlur: true });
  fx.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  fx.vig = new VignetteEffect({ offset: 0.3, darkness: 0.4 });
  fxPass = new EffectPass(dummyCam, ...(Q.bloom ? [fx.bloom] : []), fx.tone, fx.vig);
  composer.addPass(fxPass);
  return R;
}
export const renderer = () => R;

// ---------------------------------------------------------------- sky + look
function skyDome(look) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: true, fog: false,
    uniforms: { zen: { value: C('#000') }, mid: { value: C('#000') }, hor: { value: C('#000') }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glow: { value: 0.1 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 zen, mid, hor, sunDir; uniform float glow; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.14, h)); c = mix(c, zen, smoothstep(0.10, 0.65, h));
        if (d.y < 0.0) c = hor;
        float s = max(dot(d, sunDir), 0.0); c += vec3(1.0, 0.92, 0.8) * (pow(s, 10.0) * glow + pow(s, 400.0) * glow * 6.0);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(2800, 48, 24), mat); m.frustumCulled = false; m.renderOrder = -10;
  return m;
}
export function applyLook(S, spec) {
  const L = resolveLook(spec, S.lookName || E.cfg.look || 'day'); S.look = L;
  const sc = S.scene;
  // always a dome (also for flat colours): background pixels then have real depth, which keeps the AO pass clean
  if (!S.sky) { S.sky = skyDome(L); sc.add(S.sky); }
  S.sky.visible = true; const u = S.sky.material.uniforms;
  if (L.sky.type === 'gradient') { u.zen.value.set(L.sky.zenith); u.mid.value.set(L.sky.mid); u.hor.value.set(L.sky.horizon); u.glow.value = L.sky.sunGlow ?? 0.1; }
  else { const c = L.sky.color || L.bg; u.zen.value.set(c); u.mid.value.set(c); u.hor.value.set(c); u.glow.value = 0; }
  u.sunDir.value.set(...L.sun.dir).normalize(); sc.background = C(L.bg);
  sc.fog = L.fog && S.fog !== false ? new THREE.FogExp2(C(L.fog.color), (S.fogScale ?? 1) * L.fog.density) : null;
  S.hemi.color.set(L.hemi.sky); S.hemi.groundColor.set(L.hemi.ground); S.hemi.intensity = L.hemi.intensity;
  S.sun.color.set(L.sun.color); S.sun.intensity = L.sun.intensity;
  S.sunDir.set(...L.sun.dir).normalize(); placeSun(S);
  return L;
}
function placeSun(S) { S.sun.position.copy(S.sunDir).multiplyScalar(S.shadow.dist).add(S.shadow.center); S.sun.target.position.copy(S.shadow.center); S.sun.target.updateMatrixWorld(); }

// ---------------------------------------------------------------- sets
// The builder receives W (this API) and returns anything (anchors, objects, functions) — available to shots as S.
export async function getSet(id, lookSpec) {
  if (sets.has(id)) { const s = sets.get(id); s.used = performance.now(); return s; }
  const build = getSetBuilder(id); if (!build) throw new Error(`set '${id}' is not registered (scenes/sets/*.js)`);
  if (sets.size >= (E.cfg.setCache || 3)) {          // free the least recently used set
    const old = [...sets.entries()].sort((a, b) => a[1].used - b[1].used)[0]; disposeSet(old[1]); sets.delete(old[0]);
  }
  const Q = QUALITY[E.quality] || QUALITY.standard;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, E.W / E.H, 0.05, 6000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const S = { id, scene, camera, hemi, sun, sunDir: new THREE.Vector3(0, 1, 0), shadow: { center: new THREE.Vector3(), radius: 30, dist: 200 }, used: performance.now(), lookName: E.cfg.look || 'day' };
  // W: the builder API
  const W = {
    THREE, scene, camera, set: S, E,
    add: (...o) => { o.forEach((x) => scene.add(x)); return o[0]; },
    // where the sun's shadow map should be sharp: a sphere around `center` with `radius` metres
    shadowArea(center, radius = 30) { S.shadow.center.set(...center); S.shadow.radius = radius; S.shadow.dist = Math.max(60, radius * 3);
      Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: S.shadow.dist * 2.2 }); sun.shadow.camera.updateProjectionMatrix(); placeSun(S); },
    fogScale(k) { S.fogScale = k; }, noFog() { S.fog = false; },
    look: (spec) => { S.lookName = typeof spec === 'string' ? spec : spec?.base || S.lookName; S.lookSpec = spec; return applyLook(S, spec); },   // the set's default look
  };
  W.shadowArea([0, 0, 0], 30);
  applyLook(S, lookSpec || S.lookName);
  S.api = (await build(W)) || {};
  applyLook(S, lookSpec || S.lookSpec || S.lookName);   // builder may have set its own default look / fog / shadow settings
  sets.set(id, S);
  return S;
}
function disposeSet(S) { S.scene.traverse((x) => { x.geometry?.dispose?.(); [].concat(x.material || []).forEach((m) => { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose?.(); }); }); }

// make a set current for this frame (look may be overridden per shot)
export function useSet(S, lookSpec) {
  const lk = JSON.stringify(lookSpec || null);
  if (current === S && S._lookKey === lk) return;
  applyLook(S, lookSpec || S.lookSpec || S.lookName); S._lookKey = lk;
  current = S;
  composer.setMainScene(S.scene); composer.setMainCamera(S.camera);
  if (aoPass) { aoPass.scene = S.scene; aoPass.camera = S.camera; const a = S.look.ao || {}; Object.assign(aoPass.configuration, { aoRadius: a.radius ?? 1, intensity: a.intensity ?? 2, distanceFalloff: a.falloff ?? 1 }); }
  fx.bloom.intensity = S.look.bloom ?? 0.3;
  fx.tone.mode = { aces: ToneMappingMode.ACES_FILMIC, agx: ToneMappingMode.AGX, neutral: ToneMappingMode.NEUTRAL, linear: ToneMappingMode.LINEAR }[S.look.tone] ?? ToneMappingMode.ACES_FILMIC;
  fx.vig.darkness = S.look.vignette ?? 0.4;
  S.camera.aspect = E.W / E.H; S.camera.updateProjectionMatrix();
}
export function renderSet(S) {
  if (S.sky) S.sky.position.copy(S.camera.position);
  S.camera.updateMatrixWorld(); composer.render(1 / E.fps);
}
export function clearCanvas(color = '#000') { R.setClearColor(C(color), 1); R.setRenderTarget(null); R.clear(true, true, true); }

// ---------------------------------------------------------------- camera helpers (all deterministic in t)
const V3 = (a) => (a?.isVector3 ? a.clone() : new THREE.Vector3(...a));
// dolly(cam, t, [[0, {pos:[x,y,z], look:[x,y,z], fov:40}], [5, {...}, ease.out]])
export function dolly(cam, t, keys, fn = ease.inOut) {
  const v = key(t, keys.map((k) => [k[0], { pos: [...V3(k[1].pos).toArray()], look: [...V3(k[1].look).toArray()], fov: k[1].fov ?? cam.fov, roll: k[1].roll ?? 0 }, k[2]]), fn);
  cam.position.set(...v.pos); cam.up.set(0, 1, 0); cam.lookAt(...v.look);
  if (v.roll) cam.rotateZ(v.roll);
  if (Math.abs(cam.fov - v.fov) > 1e-4) { cam.fov = v.fov; cam.updateProjectionMatrix(); }
}
// orbit(cam, t, {target, radius:[a,b]|r, height:[a,b]|h, from:deg, to:deg, dur, fov})
export function orbit(cam, t, o = {}) {
  const { target = [0, 1, 0], radius = 8, height = 3, from = -30, to = 20, dur = 6, fov, e = ease.inOut } = o;
  const k = e(clamp(t / dur)), a = THREE.MathUtils.degToRad(lerp(from, to, k));
  const r = Array.isArray(radius) ? lerp(radius[0], radius[1], k) : radius, h = Array.isArray(height) ? lerp(height[0], height[1], k) : height;
  const T = V3(target); cam.position.set(T.x + Math.sin(a) * r, T.y + h, T.z + Math.cos(a) * r); cam.lookAt(T);
  if (fov && cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
}
// follow(cam, t, getTargetPos(t)->Vector3, {posA, posB, lookA, lookB, dur}) offsets relative to the moving target
export function follow(cam, t, target, o = {}) {
  const { posA = [0, 2, 8], posB = posA, lookA = [0, 0, 0], lookB = lookA, dur = 6, e = ease.inOut, fov } = o;
  const k = e(clamp(t / dur)), p = target(t);
  cam.position.copy(p).add(V3(posA).lerp(V3(posB), k)); cam.lookAt(p.clone().add(V3(lookA).lerp(V3(lookB), k)));
  if (fov && cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
}
// subtle handheld float added after positioning (amp metres / radians)
export function handheld(cam, t, amp = 0.02, seed = 1) { const [x, y, z] = drift(t, amp, 0.4, seed); cam.position.x += x; cam.position.y += y; cam.position.z += z; const [a, b] = drift(t + 7, amp * 0.25, 0.3, seed + 5); cam.rotation.x += a; cam.rotation.y += b; }
// world point -> stage coordinates (logical px) for pinning UI; returns {x, y, visible, depth}
export function toStage(cam, p) {
  const v = V3(p).project(cam); const behind = v.z > 1;
  return { x: (v.x + 1) / 2 * E.W, y: (1 - v.y) / 2 * E.H, visible: !behind && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2, depth: v.z };
}
