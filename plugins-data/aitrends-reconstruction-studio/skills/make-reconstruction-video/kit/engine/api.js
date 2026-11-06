// engine/api.js — the one import for scene files:
//   import { registerSet, registerShot, THREE, K, cam, ease, key, V, E } from '/engine/api.js';
export { E, V, clamp, lerp, prog, ease, key, mixVal, rng, noise, drift, wordTime, wordEnd, wordsBetween, registerShot, registerSet } from './core.js';
export { THREE, dolly, orbit, follow, handheld, toStage } from './world.js';
export { LOOKS } from './looks.js';
import * as kit3d from './kit3d.js';
import * as vehicles from './vehicles.js';
import * as maps from './maps.js';
import { dolly, orbit, follow, handheld } from './world.js';
// K = every 3D builder (kit3d + vehicles + maps); cam = camera helpers
export const K = { ...kit3d, ...vehicles, ...maps };
export const cam = { dolly, orbit, follow, handheld };
