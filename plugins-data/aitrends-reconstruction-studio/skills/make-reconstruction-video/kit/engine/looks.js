// engine/looks.js — lighting + grading presets. A set picks a look; a shot may override it ({look:'dusk'} or
// {look:{base:'day', sun:{intensity:2}}}). Colours are sRGB hex. ui = which overlay theme reads best on it.
//   sky:   {type:'flat', color} | {type:'gradient', zenith, mid, horizon, sunGlow}
//   fog:   null | {color, density}   (exp2; density ~0.001 landscapes, ~0.02 interiors)
//   ao:    N8AO ambient occlusion {radius (m), intensity, falloff} — radius scales with the scene (interiors ~0.6, landscapes ~3)
export const LOOKS = {
  // White mannequin "studio" reconstruction (airliner cockpit / cabin style): everything off-white, soft daylight, strong contact shading.
  clay: {
    ui: 'light', bg: '#e7e7e5',
    sky: { type: 'flat', color: '#e7e7e5' },
    fog: { color: '#e4e4e2', density: 0.006 },
    hemi: { sky: '#ffffff', ground: '#c9c6bf', intensity: 1.55 },
    sun: { color: '#fffdf8', intensity: 1.9, dir: [-0.42, 0.82, 0.38] },
    exposure: 1.0, tone: 'agx', ao: { radius: 0.7, intensity: 3.2, falloff: 0.7 },
    bloom: 0.12, vignette: 0.22,
    palette: { base: '#f0efec', soft: '#e3e1dc', mid: '#c8c6c0', dark: '#2a2c2f', ink: '#16171a', accent: '#2f6fdb', warn: '#d7443b', warm: '#e9dcc6', glass: '#b8c7d4' },
  },
  // Full-colour outdoor daylight (theme-park exterior style): deep blue zenith, pale haze horizon, warm sun, soft shadows.
  day: {
    ui: 'dark', bg: '#6d8fbf',
    sky: { type: 'gradient', zenith: '#0d2c78', mid: '#5a8ccc', horizon: '#c6d3de', sunGlow: 0.12 },
    fog: { color: '#c6d3de', density: 0.00105 },
    hemi: { sky: '#bcd0f5', ground: '#5b6038', intensity: 1.25 },
    sun: { color: '#fff1da', intensity: 3.0, dir: [-0.62, 0.58, 0.53] },
    exposure: 1.0, tone: 'aces', ao: { radius: 3.0, intensity: 2.2, falloff: 1.2 },
    bloom: 0.35, vignette: 0.42,
    palette: { base: '#ebe8e1', soft: '#d8d6cf', mid: '#a7abae', dark: '#1e2224', ink: '#101214', accent: '#2f6fdb', warn: '#e0483e', warm: '#ea9128', glass: '#9fb7c9' },
  },
  golden: {
    ui: 'dark', bg: '#c98d5a',
    sky: { type: 'gradient', zenith: '#24407e', mid: '#d79a62', horizon: '#f3c98f', sunGlow: 0.35 },
    fog: { color: '#e9bf8f', density: 0.0012 },
    hemi: { sky: '#e8c7a8', ground: '#4a3a24', intensity: 1.0 },
    sun: { color: '#ffc37a', intensity: 3.2, dir: [-0.8, 0.28, 0.5] },
    exposure: 1.0, tone: 'aces', ao: { radius: 3.0, intensity: 2.4, falloff: 1.2 },
    bloom: 0.5, vignette: 0.45,
    palette: { base: '#efe2cf', soft: '#d9c5a8', mid: '#a58f74', dark: '#2a1e16', ink: '#120c08', accent: '#3b7be0', warn: '#e0483e', warm: '#f0a040', glass: '#c7b59c' },
  },
  dusk: {
    ui: 'dark', bg: '#3a3550',
    sky: { type: 'gradient', zenith: '#141a3c', mid: '#5d4a78', horizon: '#e8906a', sunGlow: 0.3 },
    fog: { color: '#7a6080', density: 0.0016 },
    hemi: { sky: '#8f86b8', ground: '#2c2430', intensity: 0.75 },
    sun: { color: '#ff9a6a', intensity: 1.6, dir: [-0.85, 0.15, 0.5] },
    exposure: 1.05, tone: 'aces', ao: { radius: 3.0, intensity: 2.0, falloff: 1.2 },
    bloom: 0.75, vignette: 0.5,
    palette: { base: '#d9d2d6', soft: '#b5a9b8', mid: '#7d7287', dark: '#1d1824', ink: '#0d0a12', accent: '#4a8cff', warn: '#ff5a4a', warm: '#ffb060', glass: '#8f8aa8' },
  },
  night: {
    ui: 'dark', bg: '#0b1020',
    sky: { type: 'gradient', zenith: '#03060f', mid: '#0b1430', horizon: '#26324f', sunGlow: 0.0 },
    fog: { color: '#141c30', density: 0.0022 },
    hemi: { sky: '#3a4a78', ground: '#0c0e14', intensity: 0.55 },
    sun: { color: '#a8bcff', intensity: 0.7, dir: [0.3, 0.6, 0.4] },
    exposure: 1.1, tone: 'aces', ao: { radius: 3.0, intensity: 1.6, falloff: 1.2 },
    bloom: 1.0, vignette: 0.55,
    palette: { base: '#b8bcc8', soft: '#7d8396', mid: '#4b5163', dark: '#12141c', ink: '#05060a', accent: '#4a8cff', warn: '#ff4a3a', warm: '#ffc070', glass: '#4a5878' },
  },
  overcast: {
    ui: 'dark', bg: '#9aa3ab',
    sky: { type: 'gradient', zenith: '#6f7a86', mid: '#9ea7b0', horizon: '#c9ced2', sunGlow: 0 },
    fog: { color: '#c3c8cc', density: 0.0018 },
    hemi: { sky: '#dfe4ea', ground: '#5d5f55', intensity: 1.6 },
    sun: { color: '#f4f4f2', intensity: 1.1, dir: [-0.3, 0.9, 0.3] },
    exposure: 1.0, tone: 'aces', ao: { radius: 3.0, intensity: 2.6, falloff: 1.2 },
    bloom: 0.15, vignette: 0.35,
    palette: { base: '#e3e3e0', soft: '#c9cbc8', mid: '#9a9e9f', dark: '#222628', ink: '#0f1112', accent: '#2f6fdb', warn: '#d7443b', warm: '#d99a4a', glass: '#a9b6c0' },
  },
  // Black map room: dark land masses, glowing points ("where else did this happen" map)
  darkmap: {
    ui: 'dark', bg: '#050608',
    sky: { type: 'flat', color: '#050608' },
    fog: null,
    hemi: { sky: '#8a93a6', ground: '#0a0b0e', intensity: 0.9 },
    sun: { color: '#ffffff', intensity: 0.8, dir: [-0.2, 1, 0.35] },
    exposure: 1.0, tone: 'aces', ao: { radius: 1.5, intensity: 1.0, falloff: 1.0 },
    bloom: 1.2, vignette: 0.55,
    palette: { base: '#2a2d33', soft: '#22252b', mid: '#3a3e46', dark: '#0b0c0f', ink: '#000000', accent: '#3d7bff', warn: '#ff4a3a', warm: '#ffb347', glass: '#30343c' },
  },
  // Dark product/mechanism studio (ratchet close-ups): near-black backdrop, one hard key, rim light
  studio: {
    ui: 'dark', bg: '#0c0d10',
    sky: { type: 'flat', color: '#0c0d10' },
    fog: { color: '#0c0d10', density: 0.035 },
    hemi: { sky: '#5a6070', ground: '#060608', intensity: 0.45 },
    sun: { color: '#ffffff', intensity: 3.4, dir: [-0.5, 0.75, 0.45] },
    exposure: 1.0, tone: 'aces', ao: { radius: 0.4, intensity: 2.5, falloff: 0.6 },
    bloom: 0.6, vignette: 0.6,
    palette: { base: '#c9ccd2', soft: '#8a8f99', mid: '#5a5f69', dark: '#16181c', ink: '#050506', accent: '#4a8cff', warn: '#ff4a3a', warm: '#ffb347', glass: '#6a7280' },
  },
};

// merge a look override onto its base: resolveLook('day') | resolveLook({base:'day', sun:{intensity:2}})
export function resolveLook(spec, fallback = 'day') {
  if (!spec) return structuredClone(LOOKS[fallback]);
  if (typeof spec === 'string') return structuredClone(LOOKS[spec] || LOOKS[fallback]);
  const base = structuredClone(LOOKS[spec.base] || LOOKS[fallback]);
  const deep = (a, b) => { for (const k in b) { if (k === 'base') continue; if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deep(a[k], b[k]); else a[k] = b[k]; } return a; };
  return deep(base, spec);
}
