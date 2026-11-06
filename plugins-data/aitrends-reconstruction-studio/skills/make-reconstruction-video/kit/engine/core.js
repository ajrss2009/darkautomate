// engine/core.js — shared runtime state, timing, easing, keyframes, word sync and the shot/set registries.
// Logical stage: 16:9 = 1920x1080, 9:16 = 1080x1920. UI sizes are authored at that scale.
export const E = {
  W: 1920, H: 1080, outW: 1920, outH: 1080, s: 1, vertical: false, fps: 30,
  cfg: {}, words: [], shots: [], shot: null, t: 0, quality: 'standard',
};
export const V = (landscape, vertical) => (E.vertical ? vertical : landscape); // pick by aspect

// ---------------------------------------------------------------- math
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, k) => a + (b - a) * k;
export const prog = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
export const ease = {
  linear: (x) => clamp(x),
  in: (x) => clamp(x) ** 3,
  out: (x) => 1 - (1 - clamp(x)) ** 3,
  inOut: (x) => ((x = clamp(x)) < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  sine: (x) => -(Math.cos(Math.PI * clamp(x)) - 1) / 2,
  inQuad: (x) => clamp(x) ** 2,
  outQuad: (x) => 1 - (1 - clamp(x)) ** 2,
  outBack: (x) => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; },
  outExpo: (x) => (clamp(x) === 1 ? 1 : 1 - 2 ** (-10 * clamp(x))),
};
// keyframes: key(t, [[0, 1], [2, 1.2, ease.out], [4, 1]]) -> number | array | object (numbers/arrays interpolate)
export function key(t, frames, fn = ease.inOut) {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [t1, v1, f] = frames[i];
    if (t <= t1) { const [t0, v0] = frames[i - 1]; return mixVal(v0, v1, (f || fn)((t - t0) / (t1 - t0 || 1))); }
  }
  return frames[frames.length - 1][1];
}
export function mixVal(a, b, k) {
  if (typeof a === 'number') return lerp(a, b, k);
  if (Array.isArray(a)) return a.map((v, i) => mixVal(v, b[i] ?? v, k));
  if (a && typeof a === 'object') { const o = {}; for (const kk in a) o[kk] = (typeof a[kk] === 'number' || Array.isArray(a[kk]) || (a[kk] && typeof a[kk] === 'object')) ? mixVal(a[kk], b?.[kk] ?? a[kk], k) : (k < 0.5 ? a[kk] : b?.[kk] ?? a[kk]); return o; }
  return k < 0.5 ? a : b;
}
// seeded random (never use Math.random in scenes: frames render out of order on parallel workers)
export function rng(seed = 1) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export function noise(x, seed = 0) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i + seed * 57), hash(i + 1 + seed * 57), u) * 2 - 1; }
// smooth handheld drift, amplitude in whatever units you apply it to
export const drift = (t, amp = 1, freq = 0.35, seed = 3) => [noise(t * freq, seed) * amp, noise(t * freq, seed + 9) * amp, noise(t * freq, seed + 21) * amp];

// ---------------------------------------------------------------- word sync
const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
// global time (s) when a word (or the first word of a phrase) is spoken at/after `after`; null if not found
export function wordTime(match, after = 0) {
  const parts = String(match).trim().split(/\s+/).map(norm).filter(Boolean);
  if (!parts.length) return null;
  const W = E.words;
  for (let i = 0; i < W.length; i++) {
    if (W[i].start < after - 0.05) continue;
    let ok = true;
    for (let k = 0; k < parts.length; k++) { const w = W[i + k]; if (!w || !norm(w.word).startsWith(parts[k])) { ok = false; break; } }
    if (ok) return W[i].start;
  }
  return null;
}
// end time of a phrase
export function wordEnd(match, after = 0) {
  const parts = String(match).trim().split(/\s+/).map(norm).filter(Boolean);
  const W = E.words;
  for (let i = 0; i < W.length; i++) {
    if (W[i].start < after - 0.05) continue;
    let ok = true;
    for (let k = 0; k < parts.length; k++) { const w = W[i + k]; if (!w || !norm(w.word).startsWith(parts[k])) { ok = false; break; } }
    if (ok) return W[i + parts.length - 1].end;
  }
  return null;
}
export const wordsBetween = (a, b) => E.words.filter((w) => w.start >= a && w.end <= b);

// ---------------------------------------------------------------- registries
const SHOTS = {}, SETS = {};
// registerShot('s012', { set:'cockpit', look:'clay', setup(W,S,info), update(W,S,t,info), ui(U,t,info), bg })
export function registerShot(id, def) { SHOTS[id] = def; }
// registerSet('cockpit', async (W) => { ...build...; return { anchors... } })
export function registerSet(id, build) { SETS[id] = build; }
export const getShot = (id) => SHOTS[id];
export const getSetBuilder = (id) => SETS[id];
export const allShots = () => SHOTS;

// per-shot helper handed to update()/ui(): local time of a word in the current shot
export function shotInfo(shot) {
  const dur = shot.end - shot.start;
  const info = {
    shot, id: shot.id, dur, start: shot.start, end: shot.end, line: shot.line || '', params: shot.params || {},
    // local time (s from shot start) of a spoken word/phrase in this shot; fallback if not found
    w: (phrase, fallback = 0) => { const g = wordTime(phrase, shot.start - 0.35); return g == null || g > shot.end + 0.5 ? fallback : g - shot.start; },
    wEnd: (phrase, fallback = dur) => { const g = wordEnd(phrase, shot.start - 0.35); return g == null || g > shot.end + 1 ? fallback : g - shot.start; },
  };
  return info;
}
