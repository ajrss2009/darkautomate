// FilmForge "Curta cartoon 3D": a deterministic three.js stage for scene pages (window.__forge seek(t)).
// The look (characters, painted textures, two-tone light, card shading, ink outlines, lens blur, grade) is ported from
// github.com/mromidev/claude-animated-shorts (MIT, (c) 2026 Mr omi); this file replaces its Remotion/R3F/postprocessing
// glue with a plain WebGL composer so a page only needs `import * as C from "cartoon3d"`.
import * as THREE from "three";
import {
  Pen, bodyFront, bodySide, Outfit, Expr, Prop, fxBurst, fxSplash, fxPuff, fxStars, fxNote, fxRing, fxCreak, fxCloud, fxContact,
  INK, SKIN, SKINS, mix, townsfolk, soldier, KID, PARENT, OFFICER, RIFLEMAN,
} from "./toon";
import { facadeHD, roofHD, stoneHD, cobbleHD, grassHD, planksHD, beamHD, brick, rep, ctex, cloudHD, CLOUD_DAY, CLOUD_GOLD } from "./paint";
import { TONE, CHAR, twoTone, untone } from "./shade";
import { LIGHTS, LOOK, LightPreset, WorldLook } from "./lights";
import { cardShade, CARD_K, blobMaterial } from "./cardshade";
import { InkPass, NOINK } from "./ink";

type V3 = [number, number, number];
const V = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);
const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// ---------------- light presets (day / golden from the bridge short; night / interior are FilmForge's) ----------------
export type LightName = "day" | "golden" | "night" | "interior";
const NIGHT: LightPreset = {
  ...LIGHTS.day, az: 40, el: 38,
  lit: [0.62, 0.72, 1.12], shade: [0.1, 0.11, 0.24], lift: [0.03, 0.04, 0.1], lambert: 0.35, sideK: 0.8, term: 0.15,
  charTint: [0.78, 0.84, 1.0], charShade: 0.82, charGrad: 0.09, bodyGrad: 0.24, sideTint: [0.8, 0.82, 0.98],
  blob: [0.55, 0.55, 0.66], actorShadow: false,
  top: "#0d1b3d", hor: "#3a4f86", fog: "#2d3d6b", fogNear: 18, fogFar: 200, sunDisc: "#000000",
  sunCol: "#a8baff", sunI: 1.6, sky: "#3a4f86", ground: "#2a2a3a", hemiI: 0.4,
};
const INTERIOR: LightPreset = {
  ...LIGHTS.golden, az: 60, el: 35,
  lit: [1.42, 1.08, 0.72], shade: [0.2, 0.15, 0.24], lift: [0.05, 0.04, 0.08], lambert: 0.35, sideK: 0.85, term: 0.18,
  charTint: [1.0, 0.86, 0.7], charShade: 0.86, charGrad: 0.09, bodyGrad: 0.22, sideTint: [0.86, 0.8, 0.92],
  blob: [0.6, 0.55, 0.6], actorShadow: false,
  top: "#3a2a2a", hor: "#6b4a3a", fog: "#4a3530", fogNear: 30, fogFar: 260, sunDisc: "#000000",
  sunCol: "#ffcf8a", sunI: 3, sky: "#c89a7a", ground: "#5a4030", hemiI: 0.5,
};
export const LIGHT_PRESETS: Record<LightName, LightPreset> = { day: LIGHTS.day, golden: LIGHTS.golden, night: NIGHT, interior: INTERIOR };
const LOOKS: Record<LightName, WorldLook> = {
  day: LOOK.day, golden: LOOK.golden,
  night: { ...LOOK.day, sky: { c: ["#3a4f86", "#2c3f75", "#1f2f5e", "#16244c", "#0d1b3d"], e: [0, 4, 10, 20, 40] }, cloud: { lit: "#9aa8d0", mid: "#6f7fae", shade: "#4a5888" }, sat: 1.0, bounce: [0, 0, 0] },
  interior: { ...LOOK.golden, sky: { c: ["#6b4a3a", "#5a3e34", "#4a332e", "#3e2b28", "#3a2a2a"], e: [0, 4, 10, 20, 40] }, sat: 1.05, bounce: [0.03, 0.015, 0] },
};

// ---------------- grade presets (bridge round-2 fits) ----------------
type GradeParams = { ky: number[]; sat: V3; tintS: [number, number]; tintM: [number, number]; tintH: [number, number]; vig: [number, number] };
const GRADES: Record<LightName, GradeParams> = {
  day: { ky: [0, 0.1, 0.28, 0.6, 0.835, 0.945, 1], sat: [1.0, 1.05, 1.0], tintS: [0.01, 0.002], tintM: [0, 0], tintH: [0.006, 0], vig: [0.12, 0.45] },
  golden: { ky: [0, 0.09, 0.245, 0.54, 0.8, 0.93, 1], sat: [1.0, 1.12, 1.15], tintS: [0.02, 0.002], tintM: [0, 0], tintH: [-0.012, 0.006], vig: [0.2, 0.4] },
  night: { ky: [0, 0.09, 0.25, 0.55, 0.81, 0.935, 1], sat: [0.95, 1.05, 1.0], tintS: [0.03, -0.004], tintM: [0.01, 0], tintH: [0, 0], vig: [0.22, 0.4] },
  interior: { ky: [0, 0.09, 0.25, 0.56, 0.82, 0.94, 1], sat: [1.0, 1.1, 1.1], tintS: [0.02, 0.004], tintM: [0, 0.004], tintH: [-0.01, 0.006], vig: [0.22, 0.4] },
};
const KX = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
function monoTangents(ky: number[]): number[] {
  const n = KX.length, h: number[] = [], d: number[] = [], m = new Array(n).fill(0);
  for (let k = 0; k < n - 1; k++) { h.push(KX[k + 1] - KX[k]); d.push((ky[k + 1] - ky[k]) / h[k]); }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) { m[k] = 0; continue; }
    const w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1];
    m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
  }
  return m;
}
const tintRGB = (cb: number, cr: number) => new THREE.Vector3(cr * 1.5748, cb * -0.18733 + cr * -0.46813, cb * 1.8556);

// ---------------- shaders ----------------
const FS_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const SKY_VERT = "varying vec3 vDir; void main(){ vDir = (modelMatrix * vec4(position, 0.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }";
const SKY_FRAG = `uniform vec3 c[5]; uniform float e[5]; varying vec3 vDir;
void main(){ float el = degrees(asin(clamp(normalize(vDir).y, -1.0, 1.0))); vec3 col = c[0];
  for (int i = 1; i < 5; i++) col = mix(col, c[i], smoothstep(e[i-1], e[i], el));
  gl_FragColor = vec4(col, 1.0); }`;
// thin-lens gather (lensblur.ts "main" stage folded into one pass): CoC = cInf * |1 - focus / depth|
const DOF_FRAG = `#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 texel; uniform float cNear; uniform float cFar;
uniform float focus; uniform float cInf; uniform float nearScale; uniform float maxCoC; uniform float pxs; varying vec2 vUv;
#define GOLDEN 2.39996323
#define TAPS 64
#define NEAR_TAPS 24
float distAt(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cNear, cFar); }
float cocAt(float d){ float c = cInf * pxs * (1.0 - focus / max(d, 1e-3)); if (c < 0.0) c *= nearScale; return clamp(c, -maxCoC * pxs, maxCoC * pxs); }
void main(){
  vec4 base = texture2D(tColor, vUv);
  if (cInf < 0.25) { gl_FragColor = base; return; }
  float d0 = distAt(vUv); float R = abs(cocAt(d0)) * 0.96;
  vec3 acc = base.rgb; float ws = 1.0;
  if (R > 0.5) for (int i = 0; i < TAPS; i++) {
    float rr = sqrt((float(i) + 0.5) / float(TAPS)) * R; float a = float(i) * GOLDEN;
    vec2 suv = vUv + vec2(cos(a), sin(a)) * rr * texel; float ds = distAt(suv);
    float rs = abs(cocAt(ds)) * 0.96; if (ds > d0) rs = min(rs, R);
    float w = clamp(rs - rr + 0.5, 0.0, 1.0); acc += texture2D(tColor, suv).rgb * w; ws += w;
  }
  vec3 col = acc / ws;
  float M = maxCoC * pxs; vec3 fg = vec3(0.0); float fw = 0.0, cov = 0.0;
  for (int i = 0; i < NEAR_TAPS; i++) {
    float rr = sqrt((float(i) + 0.5) / float(NEAR_TAPS)) * M; if (rr <= R) continue;
    float a = float(i) * GOLDEN + 1.0; vec2 suv = vUv + vec2(cos(a), sin(a)) * rr * texel; float ds = distAt(suv);
    if (ds >= d0 * 0.97) continue; float rs = abs(cocAt(ds)); float w = clamp(rs - rr + 0.5, 0.0, 1.0);
    fg += texture2D(tColor, suv).rgb * w; fw += w; cov += w * (M * M) / max(rs * rs, 1.0);
  }
  if (fw > 0.0) col = mix(col, fg / fw, clamp(cov / float(NEAR_TAPS), 0.0, 1.0));
  gl_FragColor = vec4(col, base.a);
}`;
// PBR Neutral tone map, then the fitted grade (grade.ts), written as sRGB straight to the canvas; flash = white flash
const FINAL_FRAG = `uniform sampler2D tColor; uniform float ky[7]; uniform float km[7]; uniform vec3 sat; uniform vec3 tS; uniform vec3 tM; uniform vec3 tH;
uniform vec2 vig; uniform float amount; uniform float flash; uniform float exposure; varying vec2 vUv;
vec3 neutral(vec3 c){ float x = min(c.r, min(c.g, c.b)); float off = x < 0.08 ? x - 6.25 * x * x : 0.04; c -= off;
  float peak = max(c.r, max(c.g, c.b)); const float S = 0.76; if (peak < S) return c; const float d = 1.0 - S;
  float np = 1.0 - d * d / (peak + d - S); c *= np / peak; float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0); return mix(c, vec3(np), g); }
vec3 enc(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
float herm(float v, float x0, float x1, float y0, float y1, float m0, float m1){ float h = x1 - x0, t = (v - x0) / h, t2 = t * t, t3 = t2 * t;
  return (2.0*t3 - 3.0*t2 + 1.0) * y0 + (t3 - 2.0*t2 + t) * h * m0 + (-2.0*t3 + 3.0*t2) * y1 + (t3 - t2) * h * m1; }
float curve(float v){ v = clamp(v, 0.0, 1.0);
  if (v < 0.1) return herm(v, 0.0, 0.1, ky[0], ky[1], km[0], km[1]);
  if (v < 0.25) return herm(v, 0.1, 0.25, ky[1], ky[2], km[1], km[2]);
  if (v < 0.5) return herm(v, 0.25, 0.5, ky[2], ky[3], km[2], km[3]);
  if (v < 0.75) return herm(v, 0.5, 0.75, ky[3], ky[4], km[3], km[4]);
  if (v < 0.9) return herm(v, 0.75, 0.9, ky[4], ky[5], km[4], km[5]);
  return herm(v, 0.9, 1.0, ky[5], ky[6], km[5], km[6]); }
void main(){
  vec3 src = enc(neutral(texture2D(tColor, vUv).rgb * exposure));
  vec3 c = vec3(curve(src.r), curve(src.g), curve(src.b));
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722)); float wS = 1.0 - smoothstep(0.0, 0.55, y), wH = smoothstep(0.45, 1.0, y), wM = 1.0 - wS - wH;
  float s = sat.y + (sat.x - sat.y) * wS + (sat.z - sat.y) * wH; c = vec3(y) + s * (c - vec3(y)); c += wS * tS + wM * tM + wH * tH;
  float r = length(vUv * 2.0 - 1.0) * 0.70710678; c *= 1.0 - vig.x * smoothstep(vig.y, 1.0, r);
  c = mix(src, clamp(c, 0.0, 1.0), amount);
  gl_FragColor = vec4(mix(c, vec3(1.0), clamp(flash, 0.0, 1.0)), 1.0);
}`;

// ---------------- drawing cache (one canvas per distinct drawing) ----------------
const LRU = 420;
class DrawCache {
  private m = new Map<string, THREE.CanvasTexture>();
  private pinned = new Set<string>();
  /** never evicted (posters keep their texture for the whole video) */
  pin(key: string) { this.pinned.add(key); }
  get(key: string, w: number, h: number, k: number, draw: (p: Pen) => void, soft = false): THREE.CanvasTexture {
    let t = this.m.get(key);
    if (t) { this.m.delete(key); this.m.set(key, t); return t; }
    const cv = document.createElement("canvas"); cv.width = Math.max(2, Math.round(w)); cv.height = Math.max(2, Math.round(h));
    const g = cv.getContext("2d")!; g.setTransform(k, 0, 0, k, 0, 0); draw(new Pen(g));
    t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (soft) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    this.m.set(key, t);
    if (this.m.size > LRU) for (const [k0, old] of this.m) { if (this.pinned.has(k0)) continue; this.m.delete(k0); old.dispose(); break; }
    return t;
  }
}
const q = (v: number, n = 100) => Math.round(v * n) / n;
/** WCAG contrast ratio between two hex colours (1..21) */
function contrastRatio(a: string, b: string): number {
  const L = (hex: string) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** biggest text written with fillText/strokeText while run() draws (as fractions of the canvas) + measured contrast */
type TextInfo = { text: string; cap: number; cx: number; cy: number; bw: number; bh: number; contrast: number };
function captureText(g: CanvasRenderingContext2D, run: () => void): TextInfo | null {
  const seen: Array<{ text: string; px: number; x0: number; y0: number; x1: number; y1: number }> = [];
  const own = g as unknown as Record<string, unknown>, fill = g.fillText, stroke = g.strokeText;
  const rec = (t: unknown, x: number, y: number) => {
    try {
      const s = String(t ?? "").trim(); if (!/[\p{L}\p{N}][\s\S]*[\p{L}\p{N}]/u.test(s)) return;
      const m = /(\d+(?:\.\d+)?)px/.exec(g.font); if (!m) return;
      const T = g.getTransform(), mt = g.measureText(s), sy = Math.hypot(T.c, T.d) || 1;
      const xs = [x - mt.actualBoundingBoxLeft, x + mt.actualBoundingBoxRight], ys = [y - mt.actualBoundingBoxAscent, y + mt.actualBoundingBoxDescent];
      const pts = xs.flatMap((px) => ys.map((py) => T.transformPoint(new DOMPoint(px, py))));
      seen.push({ text: s.slice(0, 40), px: Number(m[1]) * sy, x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) });
    } catch { /* medição opcional */ }
  };
  own.fillText = function (t: string, x: number, y: number, mw?: number) { rec(t, x, y); return mw === undefined ? fill.call(g, t, x, y) : fill.call(g, t, x, y, mw); };
  own.strokeText = function (t: string, x: number, y: number, mw?: number) { rec(t, x, y); return mw === undefined ? stroke.call(g, t, x, y) : stroke.call(g, t, x, y, mw); };
  try { run(); } finally { delete own.fillText; delete own.strokeText; }
  if (!seen.length) return null;
  const big = seen.reduce((a, b) => (b.px > a.px * 1.02 ? b : a));
  const W = g.canvas.width, H = g.canvas.height;
  const x0 = clamp(Math.floor(big.x0), 0, W - 1), y0 = clamp(Math.floor(big.y0), 0, H - 1), x1 = clamp(Math.ceil(big.x1), x0 + 1, W), y1 = clamp(Math.ceil(big.y1), y0 + 1, H);
  /* contraste medido nos pixels sob o texto: luminância dos 10% mais claros contra os 10% mais escuros */
  let contrast = 21;
  try {
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data, lum: number[] = [], step = Math.max(1, Math.floor(d.length / 4 / 40000));
    const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    for (let i = 0; i < d.length; i += 4 * step) if (d[i + 3]! >= 128) lum.push(0.2126 * lin(d[i]!) + 0.7152 * lin(d[i + 1]!) + 0.0722 * lin(d[i + 2]!));
    if (lum.length >= 20) { lum.sort((a, b) => a - b); const lo = lum[Math.floor(lum.length * 0.1)]!, hi = lum[Math.floor(lum.length * 0.9)]!; contrast = (hi + 0.05) / (lo + 0.05); }
  } catch { /* canvas sem leitura: não mede */ }
  return { text: big.text, cap: (big.px * 0.72) / H, cx: (big.x0 + big.x1) / 2 / W, cy: (big.y0 + big.y1) / 2 / H, bw: (big.x1 - big.x0) / W, bh: (big.y1 - big.y0) / H, contrast };
}

// ---------------- outfits ----------------
/** Ready outfits (toon.ts Outfit). Hats: "shako" | "shako_tall" | "tophat" | "cap" | "hair" | "bonnet". */
export const OUTFITS = {
  townsfolk, soldier,
  kid: KID, parent: PARENT, officer: OFFICER, rifleman: RIFLEMAN,
  police: { jacket: "#2c3e70", pants: "#22283a", boots: INK, hat: "shako", buttons: "#e8c45a", belt: "#1b1b22", build: "stout" } as Outfit,
  gangster: { jacket: "#3a3a46", pants: "#2b2b33", boots: "#1c1c22", hat: "tophat", buttons: "#d9dde0", moustache: "#2a201a", skin: "#f5c9a0" } as Outfit,
  barman: { jacket: "#f1efe6", pants: "#2b2b33", boots: "#3a2a20", hat: "hair", hair: "#3a2618", moustache: "#3a2618", belt: "#7a2a2a" } as Outfit,
  flapper: { jacket: "#c25a7a", pants: "#3b3f52", boots: "#2b2b33", hat: "bonnet", dress: "#c25a7a", skin: "#ffe2c2" } as Outfit,
  worker: { jacket: "#5d7a3a", pants: "#3b3f52", boots: "#4a3426", hat: "cap", cap: "#6b5a44", skin: "#ecd0b6" } as Outfit,
  preacher: { jacket: "#22222a", pants: "#22222a", boots: "#111116", hat: "tophat", buttons: "#d9dde0", skin: "#f5c9a0" } as Outfit,
  reporter: { jacket: "#8c6a4a", pants: "#4a4038", boots: "#3a2a20", hat: "cap", cap: "#5a4a3a", skin: "#ffe2c2" } as Outfit,
};
export { INK, SKIN, SKINS, mix };

// ---------------- deterministic helpers ----------------
/** 0..1 smootherstep */
export const ease = (x: number) => { const t = clamp(x, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
/** blink lid 0..1 at time t: a 4-frame blink every 0.5-2.3 s, different per seed (deterministic) */
export function blink(t: number, seed = 1): number {
  let at = 0.4 + (Math.abs(Math.sin(seed * 12.9898)) % 1) * 1.2, i = 0;
  while (at < t + 1) {
    const d = t - at;
    if (d >= 0 && d < 4 / 30) return d < 1 / 30 || d >= 3 / 30 ? 0.5 : 1;
    i++; at += 0.5 + (Math.abs(Math.sin((seed + i) * 78.233)) % 1) * 1.8;
    if (i > 400) break;
  }
  return 0;
}
/** impact shake: flips sign every frame and decays over 7 frames after `at` (s); returns a value in -amp..amp */
export function kick(t: number, at: number, amp = 1): number {
  const f = Math.floor((t - at) * 30);
  if (f < 0 || f > 7) return 0;
  return amp * (f % 2 ? -1 : 1) * (1 - f / 8);
}
export type CamKey = { t: number; pos: V3; look: V3; fov?: number; roll?: number; cut?: boolean };
/** camera path: smootherstep glides between keys (cut: true jumps), every hold creeps in (push-in), optional kicks */
export function camAt(keys: CamKey[], t: number, creep = 0.0025): { pos: V3; look: V3; fov: number; roll: number } {
  const ks = keys.slice().sort((a, b) => a.t - b.t);
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1].t <= t) i++;
  const a = ks[i], b = ks[i + 1];
  let pos = V(a.pos), look = V(a.look), fov = a.fov ?? 40, roll = a.roll ?? 0, held = t - a.t;
  if (b && !b.cut && t > a.t) {
    const u = ease((t - a.t) / Math.max(1e-3, b.t - a.t));
    pos = pos.lerp(V(b.pos), u); look = look.lerp(V(b.look), u); fov += ((b.fov ?? 40) - fov) * u; roll += ((b.roll ?? 0) - roll) * u; held = 0;
  }
  if (held > 0 && creep > 0) { const k = 1 - Math.min(0.3, creep * held * 30); pos = look.clone().add(pos.clone().sub(look).multiplyScalar(k)); }
  return { pos: [pos.x, pos.y, pos.z], look: [look.x, look.y, look.z], fov, roll };
}

// ---------------- the stage ----------------
export type StageOpts = { canvas?: HTMLCanvasElement; width?: number; height?: number; light?: LightName; scale?: number };
export type ActorOpts = {
  x?: number; y?: number; z?: number; scale?: number; seed?: number; res?: number;
  mode?: "march" | "stroll" | "stand" | "sit" | "fall"; phase?: number; expr?: Expr; look?: number; blink?: number | boolean;
  wave?: number; prop?: Prop; tilt?: number; headTilt?: number; facing?: -1 | 0 | 1;
  /** side view (profile walking), facing screen right; mirror flips it */
  side?: boolean; mirror?: boolean; stride?: number; visible?: boolean; shadow?: boolean;
  /** name used by the framing check (FilmForge reports who leaves the frame) */
  name?: string;
};
const SU = 0.00216; // metres per design unit (1000 units = 2.16 m)

export class Actor {
  mesh: THREE.Mesh; blobMesh: THREE.Mesh; o: Outfit; s: ActorOpts;
  private mat: THREE.MeshLambertMaterial; private dmat: THREE.MeshDepthMaterial;
  constructor(private st: Stage, outfit: Outfit, opts: ActorOpts = {}) {
    this.o = outfit; this.s = { x: 0, y: 0, z: 0, scale: 1, seed: 1, res: 0.6, mode: "stand", phase: 0, expr: "neutral", visible: true, shadow: true, ...opts };
    const blank = st.blank;
    this.mat = cardShade(new THREE.MeshLambertMaterial({ map: blank, alphaTest: 0.5, side: THREE.DoubleSide }));
    this.dmat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: blank, alphaTest: 0.5, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(st.bodyGeo, this.mat);
    this.mesh.customDepthMaterial = this.dmat;
    this.mesh.onBeforeRender = (r) => { const rt = r.getRenderTarget(); CARD_K.uPx.value = (rt ? rt.height : r.domElement.height) / 1920; };
    this.mesh.receiveShadow = true; this.mesh.renderOrder = 1; this.mesh.rotation.order = "YXZ"; this.mesh.layers.set(NOINK);
    this.blobMesh = new THREE.Mesh(st.flatGeo, blobMaterial(blank));
    this.blobMesh.rotation.x = -Math.PI / 2; this.blobMesh.renderOrder = 0.5; this.blobMesh.layers.set(NOINK);
    st.world.add(this.mesh, this.blobMesh);
  }
  /** change pose / position (call inside seek(t)); unspecified fields keep their value */
  set(o: ActorOpts) { Object.assign(this.s, o); return this; }
  /** internal: draw + place for this frame */
  update(cam: THREE.PerspectiveCamera, lightAng: number) {
    const s = this.s;
    this.mesh.visible = this.blobMesh.visible = s.visible !== false;
    if (!this.mesh.visible) return;
    const k = clamp(s.res ?? 0.6, 0.3, 1.2), outfitKey = JSON.stringify(this.o);
    const la = Math.round(lightAng / rad(10)) * rad(10);
    const key = s.side
      ? `side|${outfitKey}|${s.mode}|${q(s.phase ?? 0, 24)}|${s.expr}|${q(+(s.blink ?? 0), 2)}|${s.seed}|${q(s.stride ?? 1, 10)}|${la}|${k}`
      : `front|${outfitKey}|${s.mode}|${q(s.phase ?? 0, 24)}|${s.expr}|${q(s.look ?? 0, 4)}|${q(+(s.blink ?? 0), 2)}|${q(s.wave ?? -1, 12)}|${JSON.stringify(s.prop ?? null)}|${q(s.tilt ?? 0, 20)}|${q(s.headTilt ?? 0, 20)}|${s.facing ?? 0}|${s.seed}|${la}|${k}`;
    const tex = this.st.cache.get(key, 600 * k, 1000 * k, k, (p) => {
      if (s.side) bodySide(p, this.o, { phase: s.phase, expr: s.expr, mode: (s.mode === "stroll" ? "march" : s.mode === "march" ? "march" : "stand") as never, blink: s.blink, stride: s.stride, light: la, seed: s.seed });
      else bodyFront(p, this.o, { phase: s.phase, expr: s.expr, mode: s.mode, look: s.look, blink: s.blink, wave: s.wave, prop: s.prop ?? null, tilt: s.tilt, headTilt: s.headTilt, light: la, facing: s.facing, seed: s.seed });
    });
    this.mat.map = tex; this.dmat.map = tex;
    const sc = s.scale ?? 1;
    this.mesh.position.set(s.x ?? 0, s.y ?? 0, s.z ?? 0);
    this.mesh.scale.set(sc * (s.mirror ? -1 : 1), sc, sc);
    this.mesh.rotation.y = Math.atan2(cam.position.x - (s.x ?? 0), cam.position.z - (s.z ?? 0)); // yaw-only billboard
    this.mesh.castShadow = this.st.preset.actorShadow;
    const c = this.st.preset.blob, hex = "#" + new THREE.Color(c[0], c[1], c[2]).getHexString();
    (this.blobMesh.material as THREE.MeshBasicMaterial).map = this.st.cache.get(`blob|${hex}`, 128, 128, 1, (p) => fxContact(p, hex), true);
    this.blobMesh.visible = this.mesh.visible && s.shadow !== false && s.mode !== "sit";
    this.blobMesh.position.set(s.x ?? 0, (s.y ?? 0) + 0.02, s.z ?? 0);
    this.blobMesh.scale.set(0.95 * sc, 0.5 * sc, 1);
    this.blobMesh.rotation.z = -this.mesh.rotation.y;
  }
}

export type FxKind = "burst" | "splash" | "puff" | "stars" | "note" | "note2" | "ring" | "creak" | "cloud";
export type FxOpts = { x: number; y: number; z: number; size?: number; t?: number; color?: string; flat?: boolean };
type CardDraw = { key: string; cw: number; ch: number; draw: (p: Pen) => void; x: number; y: number; z: number; w: number; h: number; flat?: boolean; soft?: boolean; lit?: boolean };

export class Stage {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); world = new THREE.Group(); camera: THREE.PerspectiveCamera;
  W: number; H: number; preset: LightPreset = LIGHTS.day; look: WorldLook = LOOK.day; lightName: LightName = "day";
  cache = new DrawCache(); blank: THREE.CanvasTexture; bodyGeo: THREE.BufferGeometry; flatGeo = new THREE.PlaneGeometry(1, 1);
  actors: Actor[] = []; flash = 0; exposure = 1; dof = { focus: 0, cInf: 0 };
  private sun = new THREE.DirectionalLight(); private hemi = new THREE.HemisphereLight();
  private sky: THREE.Mesh; private skyMat: THREE.ShaderMaterial; private rtMain: THREE.WebGLRenderTarget; private rtDof: THREE.WebGLRenderTarget;
  private ink: InkPass; private dofMat: THREE.ShaderMaterial; private finalMat: THREE.ShaderMaterial;
  private fsScene = new THREE.Scene(); private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); private quad: THREE.Mesh;
  private cards: THREE.Mesh[] = []; private cardUse = 0; private cardMats = new Map<string, THREE.Material>();
  private sunFrozen: THREE.Vector3 | null = null;

  constructor(o: StageOpts = {}) {
    this.W = o.width ?? 1080; this.H = o.height ?? 1920;
    const canvas = o.canvas ?? (document.getElementById("c") as HTMLCanvasElement | null) ?? document.body.appendChild(document.createElement("canvas"));
    canvas.width = this.W; canvas.height = this.H;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1); this.renderer.setSize(this.W, this.H, false);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; this.renderer.shadowMap.autoUpdate = true;
    this.renderer.toneMapping = THREE.NoToneMapping; this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(40, this.W / this.H, 0.2, 1500);
    this.camera.layers.enable(NOINK);
    const bc = document.createElement("canvas"); bc.width = bc.height = 2; this.blank = new THREE.CanvasTexture(bc);
    this.bodyGeo = new THREE.PlaneGeometry(600 * SU, 1000 * SU); this.bodyGeo.translate(0, (975 - 500) * SU, 0);
    this.scene.add(this.world, this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 160;
    this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { c: { value: [0, 1, 2, 3, 4].map(() => new THREE.Color()) }, e: { value: [0, 3, 8, 16, 40] } } });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false; this.sky.layers.set(NOINK); this.scene.add(this.sky);
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter } as const;
    this.rtMain = new THREE.WebGLRenderTarget(this.W, this.H, { ...rtOpts, samples: 4, depthTexture: new THREE.DepthTexture(this.W, this.H, THREE.UnsignedIntType) });
    this.rtDof = new THREE.WebGLRenderTarget(this.W, this.H, { ...rtOpts, depthBuffer: false });
    this.ink = new InkPass(this.scene, this.camera);
    this.ink.setSize(this.W, this.H); this.ink.setDepthTexture(this.rtMain.depthTexture!);
    const fs = (frag: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.dofMat = fs(DOF_FRAG, { tColor: { value: this.rtMain.texture }, tDepth: { value: this.rtMain.depthTexture }, texel: { value: new THREE.Vector2(1 / this.W, 1 / this.H) },
      cNear: { value: 0.2 }, cFar: { value: 1500 }, focus: { value: 10 }, cInf: { value: 0 }, nearScale: { value: 1.2 }, maxCoC: { value: 24 }, pxs: { value: this.H / 1920 } });
    this.finalMat = fs(FINAL_FRAG, { tColor: { value: this.rtDof.texture }, ky: { value: [] }, km: { value: [] }, sat: { value: new THREE.Vector3() },
      tS: { value: new THREE.Vector3() }, tM: { value: new THREE.Vector3() }, tH: { value: new THREE.Vector3() }, vig: { value: new THREE.Vector2() },
      amount: { value: 1 }, flash: { value: 0 }, exposure: { value: 1 } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dofMat); this.quad.frustumCulled = false; this.fsScene.add(this.quad);
    this.setLight(o.light ?? "day");
  }

  /** "day" (blue sky, high sun), "golden" (backlit sunset), "night" (moonlight), "interior" (warm lamps) */
  setLight(name: LightName) {
    this.lightName = name; const P = this.preset = LIGHT_PRESETS[name] ?? LIGHTS.day; const L = this.look = LOOKS[name] ?? LOOK.day;
    TONE.uLitCol.value.set(...P.lit); TONE.uShadeCol.value.set(...P.shade); TONE.uShadeLift.value.set(...P.lift);
    TONE.uLambert.value = P.lambert; TONE.uSideK.value = P.sideK; TONE.uTerm.value = P.term; TONE.uSat.value = L.sat; TONE.uBounce.value.set(...L.bounce);
    CHAR.uCharTint.value.set(...P.charTint); CHAR.uCharShade.value = P.charShade; CHAR.uGrad.value = P.charGrad; CHAR.uBodyGrad.value = P.bodyGrad; CHAR.uSideTint.value.set(...P.sideTint);
    this.sun.color.set(P.sunCol); this.sun.intensity = P.sunI; this.sun.shadow.bias = P.bias; this.sun.shadow.normalBias = P.normalBias;
    this.hemi.color.set(P.sky); this.hemi.groundColor.set(P.ground); this.hemi.intensity = P.hemiI;
    this.scene.fog = new THREE.Fog(untone(P.fog), P.fogNear, P.fogFar);
    (this.skyMat.uniforms.c.value as THREE.Color[]).forEach((c, i) => untone(L.sky.c[i], c));
    this.skyMat.uniforms.e.value = L.sky.e.slice();
    const G = GRADES[name], u = this.finalMat.uniforms;
    u.ky.value = G.ky.slice(); u.km.value = monoTangents(G.ky); (u.sat.value as THREE.Vector3).set(...G.sat);
    u.tS.value = tintRGB(...G.tintS); u.tM.value = tintRGB(...G.tintM); u.tH.value = tintRGB(...G.tintH); (u.vig.value as THREE.Vector2).set(...G.vig);
    return this;
  }
  /** sun fixed in the world (else it follows each camera: az/el of the preset relative to the camera forward) */
  freezeSun(dir?: V3) { this.sunFrozen = dir ? V(dir).normalize() : null; return this; }

  /** place the camera: pos, look-at point, vertical fov (deg), roll (deg); returns the stage */
  cam(pos: V3, look: V3, fov = 40, roll = 0) {
    const c = this.camera; c.fov = fov; c.position.set(...pos); c.up.set(0, 1, 0); c.lookAt(...look); c.rotateZ(rad(roll)); c.updateProjectionMatrix();
    this.dof.focus = c.position.distanceTo(V(look));
    return this;
  }
  /** apply a camAt() result */
  camFrom(k: { pos: V3; look: V3; fov: number; roll: number }, shake: V3 = [0, 0, 0]) {
    return this.cam([k.pos[0] + shake[0], k.pos[1] + shake[1], k.pos[2] + shake[2]], k.look, k.fov, k.roll);
  }

  // ---------------- world building ----------------
  private mats = new Map<string, THREE.Material>();
  /** two-tone world material: colour hex or a painted texture */
  mat(key: string, make: () => THREE.MeshLambertMaterialParameters): THREE.Material {
    let m = this.mats.get(key);
    if (!m) { m = twoTone(new THREE.MeshLambertMaterial(make())); this.mats.set(key, m); }
    return m;
  }
  color(hex: string) { return this.mat("c" + hex, () => ({ color: hex })); }
  add<T extends THREE.Object3D>(o: T, cast = true): T {
    o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.castShadow = cast; m.receiveShadow = true; } });
    this.world.add(o); return o;
  }
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material | string, at: V3 = [0, 0, 0], yaw = 0) {
    const m = new THREE.Mesh(geo, typeof mat === "string" ? this.color(mat) : mat); m.position.set(...at); m.rotation.y = rad(yaw); return this.add(m);
  }
  /** painted ground: "cobble" | "grass" | "stone" | "planks" | "dirt" | a colour hex; size in metres (square) */
  ground(kind = "cobble", size = 140, at: V3 = [0, 0, 0]) {
    const n = size / 6;
    const mat = kind === "cobble" ? this.mat("gcob" + n, () => ({ map: rep(cobbleHD(), n, n) })) : kind === "grass" ? this.mat("ggr" + n, () => ({ map: rep(grassHD(), n, n) }))
      : kind === "stone" ? this.mat("gst" + n, () => ({ map: rep(stoneHD(), n, n) })) : kind === "planks" ? this.mat("gpl" + n, () => ({ map: rep(planksHD(), n / 1.5, n / 1.5) }))
      : kind === "dirt" ? this.color("#a07a55") : this.color(kind);
    const g = new THREE.PlaneGeometry(size, size); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat); m.position.set(...at); m.castShadow = false; m.receiveShadow = true; m.name = "chão " + kind; this.world.add(m); return m;
  }
  /** gabled painted house; facade (with door) faces local +z; yaw in degrees; style 0..5 or custom colours */
  house(o: { x?: number; z?: number; yaw?: number; w?: number; d?: number; h?: number; style?: number; wall?: string; shutter?: string; roof?: string; brick?: boolean; timber?: boolean; door?: boolean; sign?: string } = {}) {
    const STY = [{ wall: "#e8d7b0", shutter: "#3f6fb5", roof: "#b5553c" }, { wall: "#c9714f", shutter: "#2f5f6a", roof: "#5a4a48", brick: true },
      { wall: "#d9a441", shutter: "#8c3b4a", roof: "#7a3f32" }, { wall: "#efe6d2", shutter: "#5d7a3a", roof: "#8f97a8", timber: true },
      { wall: "#b7c3a0", shutter: "#7b5ac9", roof: "#a94a36" }, { wall: "#e2b7a0", shutter: "#3b5b9a", roof: "#6b5a54" }];
    const si = o.style ?? 0, st = { ...STY[si % STY.length], ...(o.wall ? { wall: o.wall } : {}), ...(o.shutter ? { shutter: o.shutter } : {}), ...(o.roof ? { roof: o.roof } : {}),
      ...(o.brick !== undefined ? { brick: o.brick } : {}), ...(o.timber !== undefined ? { timber: o.timber } : {}) };
    const w = o.w ?? 7, d = o.d ?? 7, h = o.h ?? 8.4, hw = w / 2, hd = d / 2, rh = d * 0.42, ov = 0.35;
    const key = `${st.wall}${st.shutter}${st.brick ? "b" : ""}${st.timber ? "t" : ""}`;
    const front = this.mat(`hf${key}_${w}_${h}_${o.door !== false}`, () => ({ map: facadeHD(`hf${key}_${w}_${h}_${o.door !== false}`, w, h, { ...st, door: o.door !== false }) }));
    const side = this.mat(`hs${key}_${h}`, () => ({ map: facadeHD(`hs${key}_${h}`, 8, h, st) }));
    const gable = this.color(st.brick ? "#c8643f" : st.wall);
    const roof = this.mat("roof" + st.roof, () => ({ map: roofHD(st.roof, st.roof === "#8f97a8"), side: THREE.DoubleSide }));
    const g = new THREE.Group();
    const quad = (pts: number[][], m: THREE.Material, u = 1, v = 1) => {
      const [a, b, c, dd] = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), geo = new THREE.BufferGeometry();
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(dd, a)).normalize();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([a, b, c, a, c, dd].flatMap((p) => [p.x, p.y, p.z]), 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(6).fill(0).flatMap(() => [n.x, n.y, n.z]), 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, u, 0, u, v, 0, 0, u, v, 0, v], 2));
      g.add(new THREE.Mesh(geo, m));
    };
    const tri = (pts: number[][], m: THREE.Material) => {
      const [a, b, c] = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), geo = new THREE.BufferGeometry();
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([a, b, c].flatMap((p) => [p.x, p.y, p.z]), 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 2].flatMap(() => [n.x, n.y, n.z]), 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      g.add(new THREE.Mesh(geo, m));
    };
    quad([[-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd]], front);
    quad([[hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd]], side);
    quad([[-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd]], side);
    quad([[hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd]], side);
    tri([[-hw, h, -hd], [-hw, h, hd], [-hw, h + rh, 0]], gable);
    tri([[hw, h, hd], [hw, h, -hd], [hw, h + rh, 0]], gable);
    const ru = (w + 2 * ov) / 4, rv = Math.hypot(hd + ov, rh) / 4;
    quad([[-hw - ov, h - 0.25, hd + ov], [hw + ov, h - 0.25, hd + ov], [hw + ov, h + rh, 0], [-hw - ov, h + rh, 0]], roof, ru, rv);
    quad([[hw + ov, h - 0.25, -hd - ov], [-hw - ov, h - 0.25, -hd - ov], [-hw - ov, h + rh, 0], [hw + ov, h + rh, 0]], roof, ru, rv);
    const trim = this.color("#efe3c8"), box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m); b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); g.add(b); };
    box(-hw - 0.07, hw + 0.07, -0.05, 0.45, -hd - 0.07, hd + 0.07, this.mat("plinth", () => ({ map: stoneHD("copeHD") })));
    box(-hw - 0.12, hw + 0.12, h - 0.52, h - 0.25, hd, hd + 0.17, trim);
    const cx = hw * 0.45 * (si % 2 ? 1 : -1);
    box(cx - 0.4, cx + 0.4, h + rh * 0.3, h + rh + 1.1, -hd * 0.35 - 0.4, -hd * 0.35 + 0.4, this.mat("chim", () => ({ map: rep(brick(), 1, 1) })));
    box(cx - 0.52, cx + 0.52, h + rh + 1.1, h + rh + 1.26, -hd * 0.35 - 0.52, -hd * 0.35 + 0.52, this.color("#9a8778"));
    if (o.sign) { const sg = this.signMesh(o.sign, Math.min(w * 0.7, 4.2), 0.9); sg.position.set(0, Math.min(h - 1.2, 3.4), hd + 0.12); g.add(sg); }
    g.position.set(o.x ?? 0, 0, o.z ?? 0); g.rotation.y = rad(o.yaw ?? 0); g.name = o.sign ? `casa "${o.sign}"` : "casa";
    return this.add(g);
  }
  /** a street along z (from z0 to z0 - length) with painted houses on both sides facing the street */
  street(o: { length?: number; width?: number; z0?: number; seed?: number; sides?: "both" | "left" | "right"; ground?: string } = {}) {
    const len = o.length ?? 70, wid = o.width ?? 10, z0 = o.z0 ?? 12, seed = o.seed ?? 3;
    this.ground(o.ground ?? "cobble", Math.max(160, len * 2.4));
    let i = 0;
    for (const s of o.sides === "left" ? [-1] : o.sides === "right" ? [1] : [-1, 1]) {
      for (let z = z0; z > z0 - len; i++) {
        const w = [6.5, 7.5, 8.5, 7][(i + seed) % 4], h = [7, 8.4, 9.8, 8.4][(i * 3 + seed) % 4], d = 7;
        this.house({ x: s * (wid / 2 + d / 2), z: z - w / 2, yaw: s < 0 ? 90 : -90, w, d, h, style: (i * 5 + seed) % 6 });
        z -= w + 0.4;
      }
    }
    const curb = this.mat("curb", () => ({ map: rep(stoneHD(), 20, 1) }));
    for (const s of [-1, 1]) this.mesh(new THREE.BoxGeometry(0.3, 0.16, len + 20), curb, [s * (wid / 2 - 1.4), 0.08, z0 - len / 2]);
    return this;
  }
  /** a room seen from inside (open toward +z): floor planks, painted walls, optional wainscot */
  room(o: { w?: number; d?: number; h?: number; wall?: string; floor?: string; wainscot?: string; at?: V3 } = {}) {
    const w = o.w ?? 12, d = o.d ?? 10, h = o.h ?? 4, at = o.at ?? [0, 0, 0], g = new THREE.Group();
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), o.floor ? this.color(o.floor) : this.mat("roomfloor", () => ({ map: rep(planksHD(), w / 3, d / 3) })));
    const wall = this.color(o.wall ?? "#7a3b33"), wain = this.color(o.wainscot ?? "#5a3a26");
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wall); back.position.set(0, h / 2, -d / 2);
    const l = new THREE.Mesh(new THREE.PlaneGeometry(d, h), wall); l.rotation.y = Math.PI / 2; l.position.set(-w / 2, h / 2, 0);
    const r = new THREE.Mesh(new THREE.PlaneGeometry(d, h), wall); r.rotation.y = -Math.PI / 2; r.position.set(w / 2, h / 2, 0);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2), this.color("#3a2a24")); ceil.position.y = h;
    const wb = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 0.12), wain); wb.position.set(0, 0.55, -d / 2 + 0.06);
    g.add(fl, back, l, r, ceil, wb); g.position.set(...at); g.name = "sala";
    return this.add(g, false);
  }
  /** simple props: "barrel" | "crate" | "bottle" | "table" | "chair" | "lamppost" | "car" | "tree" | "bar" | "door" | "fence" | "box" */
  prop(kind: string, o: { x?: number; y?: number; z?: number; yaw?: number; scale?: number; color?: string; w?: number; h?: number; d?: number } = {}) {
    const g = new THREE.Group(), c = (hex: string) => this.color(hex), wood = this.mat("propwood", () => ({ map: rep(beamHD(), 1, 1) }));
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, rz = 0) => { const k = new THREE.Mesh(geo, m); k.position.set(x, y, z); k.rotation.x = rx; k.rotation.z = rz; g.add(k); return k; };
    switch (kind) {
      case "barrel":
        add(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 18), c(o.color ?? "#9a6a3e"), 0, 0.5);
        add(new THREE.CylinderGeometry(0.48, 0.48, 0.1, 18), c("#3a3236"), 0, 0.2); add(new THREE.CylinderGeometry(0.48, 0.48, 0.1, 18), c("#3a3236"), 0, 0.8);
        add(new THREE.CylinderGeometry(0.5, 0.5, 0.36, 18), c(o.color ?? "#a8744a"), 0, 0.5); break;
      case "crate": add(new THREE.BoxGeometry(0.9, 0.7, 0.9), wood, 0, 0.35); break;
      case "bottle":
        add(new THREE.CylinderGeometry(0.07, 0.08, 0.26, 12), c(o.color ?? "#3f7a4a"), 0, 0.13);
        add(new THREE.CylinderGeometry(0.025, 0.06, 0.12, 12), c(o.color ?? "#3f7a4a"), 0, 0.32); break;
      case "table":
        add(new THREE.CylinderGeometry(0.7, 0.7, 0.07, 24), c(o.color ?? "#8a5a3c"), 0, 0.78);
        add(new THREE.CylinderGeometry(0.06, 0.06, 0.76, 10), c("#3a2a24"), 0, 0.38); add(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 16), c("#3a2a24"), 0, 0.02); break;
      case "chair":
        add(new THREE.BoxGeometry(0.45, 0.06, 0.45), c(o.color ?? "#7a4f33"), 0, 0.46);
        add(new THREE.BoxGeometry(0.45, 0.5, 0.06), c(o.color ?? "#7a4f33"), 0, 0.72, -0.2);
        for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) add(new THREE.BoxGeometry(0.05, 0.46, 0.05), c("#3a2a24"), x, 0.23, z); break;
      case "lamppost":
        add(new THREE.CylinderGeometry(0.07, 0.1, 3.6, 10), c("#2b2b33"), 0, 1.8);
        add(new THREE.BoxGeometry(0.36, 0.5, 0.36), c("#2b2b33"), 0, 3.75);
        add(new THREE.BoxGeometry(0.26, 0.36, 0.26), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.6, 1.4) }), 0, 3.75); break;
      case "car": { // 1920s sedan, length along local x
        const body = c(o.color ?? "#1f2a44");
        add(new THREE.BoxGeometry(3.6, 0.55, 1.6), body, 0, 0.75);
        add(new THREE.BoxGeometry(1.9, 0.85, 1.5), body, -0.35, 1.45);
        add(new THREE.BoxGeometry(1.2, 0.5, 1.2), c("#2b2b33"), 1.25, 1.15);
        add(new THREE.BoxGeometry(1.75, 0.5, 1.52), c("#a9c4d8"), -0.35, 1.5);
        add(new THREE.BoxGeometry(3.9, 0.08, 1.9), c("#151518"), 0, 0.5);
        for (const [x, z] of [[-1.15, 0.82], [1.15, 0.82], [-1.15, -0.82], [1.15, -0.82]]) add(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 20), c("#151518"), x, 0.42, z, Math.PI / 2);
        for (const z of [-0.5, 0.5]) add(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 1.6) }), 1.88, 1.0, z);
        break;
      }
      case "tree":
        add(new THREE.CylinderGeometry(0.18, 0.26, 2.4, 10), c("#8a5a3c"), 0, 1.2);
        add(new THREE.IcosahedronGeometry(1.5, 1), c(o.color ?? "#62ae4c"), 0, 3.2); add(new THREE.IcosahedronGeometry(1.1, 1), c(o.color ?? "#56a447"), 0.8, 2.8, 0.3); break;
      case "bar": // counter along local x, customers on +z
        add(new THREE.BoxGeometry(o.w ?? 5, 1.05, 0.8), wood, 0, 0.525); add(new THREE.BoxGeometry((o.w ?? 5) + 0.2, 0.08, 1.0), c("#5a3a26"), 0, 1.09);
        add(new THREE.BoxGeometry(o.w ?? 5, 2.2, 0.4), c("#4a2e20"), 0, 1.1 + 0.4, -1.4);
        for (let i = 0; i < 9; i++) for (const y of [1.7, 2.3]) {
          add(new THREE.CylinderGeometry(0.06, 0.07, 0.28, 10), c(["#3f7a4a", "#8a5a2a", "#6a2a2a", "#c9a24a"][(i + (y > 2 ? 2 : 0)) % 4]), -((o.w ?? 5) / 2) + 0.4 + i * (((o.w ?? 5) - 0.8) / 8), y, -1.1);
        }
        break;
      case "door": add(new THREE.BoxGeometry(1.1, 2.2, 0.12), c(o.color ?? "#5a3a26"), 0, 1.1); add(new THREE.BoxGeometry(0.3, 0.12, 0.04), c("#2b2b33"), 0, 1.75, 0.08); break;
      case "fence": for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(0.1, 1.0, 0.06), c(o.color ?? "#e8dcc0"), -1.5 + i * 0.5, 0.5);
        add(new THREE.BoxGeometry(3.3, 0.1, 0.05), c(o.color ?? "#e8dcc0"), 0, 0.75, 0.04); add(new THREE.BoxGeometry(3.3, 0.1, 0.05), c(o.color ?? "#e8dcc0"), 0, 0.3, 0.04); break;
      default: add(new THREE.BoxGeometry(o.w ?? 1, o.h ?? 1, o.d ?? 1), c(o.color ?? "#c9a46a"), 0, (o.h ?? 1) / 2);
    }
    g.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0); g.rotation.y = rad(o.yaw ?? 0); g.scale.setScalar(o.scale ?? 1); g.name = kind;
    return this.add(g);
  }
  /** painted sign board with short text (unlit face so it stays readable) */
  signMesh(text: string, w = 3, h = 0.8, bg = "#f6ecd2", fg = "#2b1b1e") {
    const tex = ctex(`sign|${text}|${bg}|${fg}|${w}x${h}`, Math.round(256 * w), Math.round(256 * h), (g) => {
      const W = g.canvas.width, H = g.canvas.height;
      g.fillStyle = bg; g.fillRect(0, 0, W, H); g.lineWidth = Math.max(8, H * 0.08); g.strokeStyle = fg; g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth);
      g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
      let fs = H * 0.6; g.font = `900 ${fs}px Georgia, serif`; while (g.measureText(text).width > W * 0.88 && fs > 10) { fs -= 2; g.font = `900 ${fs}px Georgia, serif`; }
      g.fillText(text, W / 2, H / 2 + fs * 0.04);
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [this.color("#3a2a24"), this.color("#3a2a24"), this.color("#3a2a24"), this.color("#3a2a24"),
      new THREE.MeshBasicMaterial({ map: tex }), this.color("#3a2a24")]);
    m.name = `letreiro "${text}"`;
    const fit = Math.min(1, (0.88 * w) / Math.max(1e-6, 0.6 * h * 0.62 * text.length));
    this.signs.push({ mesh: m, text, gw: w, gh: h, contrast: contrastRatio(bg, fg), ox: 0, oy: 0, hw: 0.44, hh: 0.35, lh: 0.6 * fit * 0.72 });
    return m;
  }
  sign(text: string, o: { x?: number; y?: number; z?: number; yaw?: number; w?: number; h?: number; bg?: string; fg?: string } = {}) {
    const m = this.signMesh(text, o.w ?? 3, o.h ?? 0.8, o.bg, o.fg); m.position.set(o.x ?? 0, o.y ?? 2.5, o.z ?? 0); m.rotation.y = rad(o.yaw ?? 0); return this.add(m);
  }
  /** drifting painted clouds far away (unlit cards on the NOINK layer) */
  clouds(n = 6, seed = 1) {
    const pal = this.lightName === "golden" ? CLOUD_GOLD : this.lightName === "night" ? { lit: "#9aa8d0", mid: "#6f7fae", shade: "#4a5888" } : CLOUD_DAY;
    for (let i = 0; i < n; i++) {
      const tex = cloudHD(seed * 7 + i, pal), m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
      const a = rad(-60 + (120 * i) / Math.max(1, n - 1) + 9 * Math.sin(i * 3.1)), r = 380, el = rad(8 + 10 * ((i * 37) % 7) / 7);
      m.position.set(Math.sin(a) * r * Math.cos(el), r * Math.sin(el), -Math.cos(a) * r * Math.cos(el)); m.scale.set(130, 65, 1); m.lookAt(0, m.position.y, 0);
      m.renderOrder = -9; m.layers.set(NOINK); this.scene.add(m);
    }
    return this;
  }

  // ---------------- characters & cards ----------------
  /** a lit flat cartoon character (yaw-only billboard). Pose it every frame with actor.set({...}). */
  actor(outfit: Outfit, opts: ActorOpts = {}) { const a = new Actor(this, outfit, { name: opts.name ?? `personagem ${this.actors.length + 1}`, ...opts }); this.actors.push(a); return a; }

  // ---------------- scene check (read by FilmForge after the render) ----------------
  /**
   * One entry per render(). frames: status per actor — 0 ok, 1 face cut (eyes outside the frame), 2 cut at the side
   * (less than 60 % of the body width inside), 3 out of the frame, 4 face BLOCKED by something in front, 5 half of the
   * body hidden behind something, -1 hidden (visible: false).
   * signs: per sign — -1 not on screen, 0 readable, 1 letters too small, 2 seen too obliquely, 3 covered, 4 low contrast, 5 cut by the frame edge.
   * jumps: abrupt colour changes of a material between two frames (and light preset switches).
   */
  private framing = { names: [] as string[], frames: [] as string[], signNames: [] as string[], signs: [] as string[], jumps: [] as Array<{ f: number; name: string; from: string; to: string }> };
  /** readable texts: sign boards, and the biggest text written (fillText) in a poster or a per-frame draw card.
   *  gw/gh = geometry size; ox/oy (centre), hw/hh (half size) and lh (cap height) are fractions of it. */
  private signs: Array<{ mesh: THREE.Mesh; text: string; gw: number; gh: number; contrast: number; ox: number; oy: number; hw: number; hh: number; lh: number; card?: string; seen?: number }> = [];
  private textInfo = new Map<string, TextInfo | null>();
  private textSign(mesh: THREE.Mesh, info: TextInfo, gw: number, gh: number, card?: string) {
    const e = { mesh, text: info.text, gw, gh, contrast: info.contrast, ox: info.cx - 0.5, oy: 0.5 - info.cy, hw: info.bw / 2, hh: info.bh / 2, lh: info.cap, card, seen: this.framing.frames.length };
    const i = card ? this.signs.findIndex((s) => s.card === card) : -1;
    if (i >= 0) this.signs[i] = e; else this.signs.push(e);
  }
  private ray = new THREE.Raycaster();
  private lastCol = new Map<string, number>();
  private lastLight = "";
  private visibleChain(o: THREE.Object3D) { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; }
  private recordFraming(cam: THREE.PerspectiveCamera) {
    const F = this.framing, fi = F.frames.length;
    this.scene.updateMatrixWorld();                                 // 1º quadro: objetos ainda sem matriz (raycast acharia tudo na origem)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), P = new THREE.Vector3();
    const proj = (x: number, y: number, z: number) => { P.set(x, y, z).project(cam); return { x: P.x, y: P.y, front: P.z < 1 && P.z > -1 }; };
    /* occluders: visible world meshes (not the characters, not see-through) + opaque posters */
    const actorMeshes = new Set<THREE.Object3D>(this.actors.flatMap((a) => [a.mesh, a.blobMesh]));
    const occ: THREE.Object3D[] = [], meshes: THREE.Mesh[] = [];
    this.world.traverseVisible((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh || actorMeshes.has(m)) return;
      meshes.push(m);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every((x) => (x.transparent && x.opacity < 0.95) || x.depthWrite === false)) return;
      occ.push(m);
    });
    for (const p of this.posters) if (this.visibleChain(p.mesh) && !(p.mesh.material as THREE.Material).transparent) occ.push(p.mesh);
    this.ray.layers.enableAll();
    const camPos = cam.position, tmp = new THREE.Vector3();
    const blocked = (x: number, y: number, z: number, skip?: THREE.Object3D) => {
      tmp.set(x, y, z); const d = tmp.distanceTo(camPos); if (d < 0.3) return false;
      this.ray.set(camPos, tmp.clone().sub(camPos).normalize()); this.ray.near = cam.near; this.ray.far = d - 0.12;
      return this.ray.intersectObjects(occ, false).some((h) => h.object !== skip);
    };
    /* other characters in front also block (screen-space, their body box narrowed to the opaque middle) */
    const boxes = this.actors.map((a) => {
      const s = a.s; if (s.visible === false) return null;
      const sc = s.scale ?? 1, H = (a.o.build === "kid" ? 1.35 : 1.75) * sc, Wd = 0.22 * sc, x = s.x ?? 0, y = s.y ?? 0, z = s.z ?? 0;
      const l = proj(x - right.x * Wd, y + H * 0.1, z - right.z * Wd), r = proj(x + right.x * Wd, y + H * 0.92, z + right.z * Wd);
      return { x0: Math.min(l.x, r.x), x1: Math.max(l.x, r.x), y0: Math.min(l.y, r.y), y1: Math.max(l.y, r.y), d: camPos.distanceTo(tmp.set(x, y + H * 0.5, z)) };
    });
    const byActor = (i: number, x: number, y: number, z: number) => {
      const p = proj(x, y, z), d = camPos.distanceTo(tmp.set(x, y, z));
      return boxes.some((b, j) => b && j !== i && b.d < d - 0.3 && p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1);
    };
    const codes = this.actors.map((a, i) => {
      const s = a.s;
      if (s.visible === false) return -1;
      const sc = s.scale ?? 1, H = (a.o.build === "kid" ? 1.35 : 1.75) * sc, Wd = 0.36 * sc, x = s.x ?? 0, y = s.y ?? 0, z = s.z ?? 0;
      const pts = [proj(x, y, z), proj(x, y + H, z), proj(x + right.x * Wd, y + H * 0.55, z + right.z * Wd), proj(x - right.x * Wd, y + H * 0.55, z - right.z * Wd)];
      if (!pts.every((p) => p.front)) return 3;
      const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
      if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1) return 3;
      const eyes = proj(x, y + H * 0.84, z);
      if (eyes.y > 1 || eyes.y < -1) return 1;
      const inside = (Math.min(maxX, 1) - Math.max(minX, -1)) / Math.max(1e-6, maxX - minX);
      if (inside < 0.6) return 2;
      const hid = (px: number, py: number, pz: number) => blocked(px, py, pz) || byActor(i, px, py, pz);
      if (hid(x, y + H * 0.84, z)) return 4;
      const body = [[0, 0.62], [0.5, 0.55], [-0.5, 0.55], [0, 0.38], [0, 0.18]].filter(([dx, hy]) => hid(x + right.x * Wd * dx, y + H * hy, z + right.z * Wd * dx)).length;
      return body >= 3 ? 5 : 0;
    });
    F.names = this.actors.map((a) => a.s.name ?? "");
    F.frames.push(codes.join(","));
    /* signs: letter height on screen, viewing angle, cover, contrast */
    const fwd = new THREE.Vector3(), q4 = new THREE.Quaternion(), c = new THREE.Vector3();
    F.signNames = this.signs.map((g) => g.text);
    F.signs.push(this.signs.map((g) => {
      if (g.card !== undefined && g.seen !== fi) return -1;        // per-frame drawing not drawn this frame
      if (!g.mesh.parent || !this.visibleChain(g.mesh)) return -1;
      g.mesh.updateWorldMatrix(true, false);
      const W = (fx: number, fy: number) => g.mesh.localToWorld(new THREE.Vector3(fx * g.gw, fy * g.gh, 0));
      c.copy(W(g.ox, g.oy)); g.mesh.getWorldQuaternion(q4);
      fwd.set(0, 0, 1).applyQuaternion(q4); const toCam = camPos.clone().sub(c).normalize();
      const cos = fwd.dot(toCam);
      if (cos < 0.05) return -1;                                   // seen from behind: not on screen as a sign
      /* cantos da área do texto: nenhum na tela = fora; centro fora mas algum canto dentro = cortado pela borda */
      const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => { const k = W(g.ox + g.hw * sx, g.oy + g.hh * sy); return proj(k.x, k.y, k.z); }));
      const inside = corners.filter((k) => k.front && Math.abs(k.x) <= 1 && Math.abs(k.y) <= 1).length;
      const pc = proj(c.x, c.y, c.z);
      if (!pc.front || Math.abs(pc.x) > 1 || Math.abs(pc.y) > 1) return inside ? 5 : -1;
      const tw = W(g.ox, g.oy + g.lh / 2), bw = W(g.ox, g.oy - g.lh / 2);
      const top = proj(tw.x, tw.y, tw.z), bot = proj(bw.x, bw.y, bw.z);
      const letterPx = Math.hypot((top.x - bot.x) * this.W, (top.y - bot.y) * this.H) / 2;   // cap height of the text on screen
      if (blocked(c.x + toCam.x * 0.06, c.y + toCam.y * 0.06, c.z + toCam.z * 0.06, g.mesh)) return 3;
      if (g.contrast < 3) return 4;
      if (cos < 0.45) return 2;
      if (inside < 4) return 5;                                    // texto cortado pela borda do quadro
      return letterPx < Math.min(this.W, this.H) * 0.028 ? 1 : 0;
    }).join(","));
    /* abrupt colour changes: every visible world mesh's material colour vs the previous frame */
    const seen = new Map<string, number>();
    for (const m of meshes.slice(0, 2500)) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mt, k) => {
        const col = (mt as THREE.MeshLambertMaterial).color; if (!col) return;
        const em = (mt as THREE.MeshLambertMaterial).emissive;
        const v = (Math.round(clamp(col.r + (em?.r ?? 0), 0, 1) * 255) << 16) | (Math.round(clamp(col.g + (em?.g ?? 0), 0, 1) * 255) << 8) | Math.round(clamp(col.b + (em?.b ?? 0), 0, 1) * 255);
        const key = m.uuid + ":" + k; seen.set(key, v);
        const was = this.lastCol.get(key);
        if (was === undefined || was === v || F.jumps.length >= 200) return;
        const d = Math.max(Math.abs((was >> 16) - (v >> 16)), Math.abs(((was >> 8) & 255) - ((v >> 8) & 255)), Math.abs((was & 255) - (v & 255)));
        if (d < 56) return;                                          // a gradual tween moves less than ~22 % per frame
        let name = m.name; for (let p = m.parent; !name && p && p !== this.world; p = p.parent) name = p.name;
        const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
        F.jumps.push({ f: fi, name: name || "material " + hex(was), from: hex(was), to: hex(v) });
      });
    }
    this.lastCol = seen;
    if (this.lastLight && this.lastLight !== this.lightName && F.jumps.length < 200) F.jumps.push({ f: fi, name: "luz", from: this.lastLight, to: this.lightName });
    this.lastLight = this.lightName;
    for (const k of ["frames", "signs"] as const) if (F[k].length > 4000) F[k].splice(0, F[k].length - 4000);
    try { (window as unknown as { __cartoon3dFraming?: unknown }).__cartoon3dFraming = F; } catch { /* sem window */ }
  }
  private card(d: CardDraw): THREE.Mesh {
    let m = this.cards[this.cardUse];
    if (!m) { m = new THREE.Mesh(this.flatGeo, new THREE.MeshBasicMaterial()); m.layers.set(NOINK); this.scene.add(m); this.cards.push(m); }
    this.cardUse++;
    const tex = this.cache.get(d.key, d.cw, d.ch, 1, d.draw, !!d.soft);
    const mk = `${d.soft ? "s" : "c"}|${tex.uuid}`;
    let mat = this.cardMats.get(mk);
    if (!mat) { mat = d.soft ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }) : new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }); this.cardMats.set(mk, mat); }
    m.material = mat; m.visible = true;
    m.position.set(d.x, d.y, d.z); m.scale.set(d.w, d.h, 1);
    if (d.flat) m.rotation.set(-Math.PI / 2, 0, 0); else { m.rotation.set(0, Math.atan2(this.camera.position.x - d.x, this.camera.position.z - d.z), 0); }
    return m;
  }
  private posters: Array<{ mesh: THREE.Mesh; face: boolean }> = [];
  /**
   * Persistent flat drawing (poster, newspaper, big bottle, icon) that STAYS in the world: returns a THREE.Mesh you
   * can move / scale / hide in seek (mesh.position, mesh.scale, mesh.visible). face: true turns it to the camera every
   * frame. Create it once, outside seek.
   */
  poster(key: string, o: { x: number; y: number; z: number; w: number; h: number; cw?: number; ch?: number; yaw?: number; face?: boolean; soft?: boolean }, fn: (p: Pen, g: CanvasRenderingContext2D) => void): THREE.Mesh {
    const cw = o.cw ?? 512, ch = o.ch ?? Math.round(512 * (o.h / o.w));
    const ck = `poster|${key}|${cw}x${ch}`;
    const tex = this.cache.get(ck, cw, ch, 1, (p) => this.textInfo.set(ck, captureText(p.g, () => fn(p, p.g))), !!o.soft);
    this.cache.pin(ck);
    const mat = o.soft ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }) : new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), mat);
    mesh.position.set(o.x, o.y, o.z); mesh.rotation.y = rad(o.yaw ?? 0); mesh.layers.set(NOINK);
    this.scene.add(mesh); this.posters.push({ mesh, face: o.face !== false && o.yaw === undefined });
    const info = this.textInfo.get(ck); if (info) this.textSign(mesh, info, o.w, o.h);
    return mesh;
  }
  /** 2D cartoon effect at a 3D point for this frame: burst, splash, puff, stars, note, note2, ring (flat), creak, cloud. t = 0..1 progress */
  fx(kind: FxKind, o: FxOpts) {
    const t = q(clamp(o.t ?? 0.5, 0, 1), 30), s = o.size ?? 1, col = o.color;
    const D: Record<FxKind, [number, number, (p: Pen) => void, number, number, boolean?]> = {
      burst: [500, 500, (p) => fxBurst(p, t, col), 1, 1], splash: [800, 800, (p) => fxSplash(p, t), 2.4, 2.4], puff: [300, 300, (p) => fxPuff(p, t), 0.9, 0.9, true],
      stars: [420, 210, (p) => fxStars(p, t), 0.75, 0.375], note: [220, 260, (p) => fxNote(p, 0, col), 0.4, 0.47], note2: [220, 260, (p) => fxNote(p, 1, col), 0.4, 0.47],
      ring: [600, 600, (p) => fxRing(p, t), 2, 2], creak: [300, 300, (p) => fxCreak(p, t), 0.6, 0.6], cloud: [600, 300, (p) => fxCloud(p, 3), 2, 1, true],
    };
    const [cw, ch, draw, w, h, soft] = D[kind];
    return this.card({ key: `fx|${kind}|${t}|${col ?? ""}`, cw, ch, draw, x: o.x, y: o.y, z: o.z, w: w * s, h: h * s, flat: kind === "ring" || o.flat, soft });
  }
  /** your own flat drawing (Canvas2D through the Pen API or p.g) as a camera-facing card for THIS FRAME (call inside
   *  seek every frame it should show; returns that frame's mesh). For one that stays, use poster(). */
  draw(key: string, o: { x: number; y: number; z: number; w: number; h: number; cw?: number; ch?: number; flat?: boolean; soft?: boolean }, fn: (p: Pen, g: CanvasRenderingContext2D) => void) {
    const cw = o.cw ?? 512, ch = o.ch ?? Math.round(512 * (o.h / o.w));
    const ck = `draw|${key}|${cw}x${ch}`;
    const m = this.card({ key: ck, cw, ch, draw: (p) => this.textInfo.set(ck, captureText(p.g, () => fn(p, p.g))), x: o.x, y: o.y, z: o.z, w: o.w, h: o.h, flat: o.flat, soft: o.soft });
    const info = this.textInfo.get(ck); if (info) this.textSign(m, info, 1, 1, key);   // card geometry is 1x1, scaled to w x h
    return m;
  }

  // ---------------- frame ----------------
  /** render the current frame: ink → lens blur → Neutral tone map → grade (MSAA 4). Call once at the end of seek(t). */
  render(opts: { dof?: number; focus?: number; flash?: number } = {}) {
    const r = this.renderer, cam = this.camera, P = this.preset;
    cam.updateMatrixWorld();
    this.sky.position.copy(cam.position);
    // sun: preset az/el relative to the camera's forward (frozen with freezeSun)
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = this.sunFrozen ?? fwd.clone().multiplyScalar(Math.cos(rad(P.az))).add(right.clone().multiplyScalar(Math.sin(rad(P.az)))).multiplyScalar(Math.cos(rad(P.el))).setY(Math.sin(rad(P.el))).normalize();
    const focusPt = cam.position.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(Math.min(this.dof.focus || 12, 40)));
    this.sun.target.position.copy(focusPt); this.sun.position.copy(focusPt).add(dir.clone().multiplyScalar(80)); this.sun.target.updateMatrixWorld();
    // characters: painted crescent / thick outline on the side away from the sun (canvas angle the light comes FROM)
    const lx = dir.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion));
    const lightAng = rad(-90 - 30 * clamp(-lx * 3, -1, 1));
    for (const a of this.actors) a.update(cam, lightAng);
    this.recordFraming(cam);
    for (const p of this.posters) if (p.face) p.mesh.rotation.y = Math.atan2(cam.position.x - p.mesh.position.x, cam.position.z - p.mesh.position.z);
    for (let i = this.cardUse; i < this.cards.length; i++) this.cards[i].visible = false;
    this.cardUse = 0;
    // 1) scene → MSAA HDR target (+ depth), 2) world ink written back into it
    r.setRenderTarget(this.rtMain); r.setClearColor(0x000000, 1); r.clear(true, true, true); r.render(this.scene, cam);
    this.ink.render(r, this.rtMain);
    // 3) lens blur
    const u = this.dofMat.uniforms;
    u.cNear.value = cam.near; u.cFar.value = cam.far; u.focus.value = opts.focus ?? this.dof.focus; u.cInf.value = opts.dof ?? this.dof.cInf;
    this.quad.material = this.dofMat; r.setRenderTarget(this.rtDof); r.render(this.fsScene, this.fsCam);
    // 4) tone map + grade → canvas
    this.finalMat.uniforms.flash.value = opts.flash ?? this.flash; this.finalMat.uniforms.exposure.value = this.exposure;
    this.quad.material = this.finalMat; r.setRenderTarget(null); r.render(this.fsScene, this.fsCam);
    return this;
  }
}

/** create the stage on <canvas id="c"> (or opts.canvas), sized for the project aspect (default 1080 x 1920) */
export const createStage = (o: StageOpts = {}) => new Stage(o);
export { Pen, bodyFront, bodySide, NOINK };
export type { Outfit, Expr, Prop };
