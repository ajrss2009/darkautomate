# Engine API (sets, shots, overlays, kit)

Every frame is rendered in headless Chromium:
- **Three.js** (+ N8AO ambient occlusion, bloom, tone mapping and vignette via `postprocessing`) draws the 3D set.
- **An HTML/CSS layer** draws the 2D graphics on top.
- **`render.mjs`** captures frame *f* at time *f / fps*, deterministically, so frames can render in parallel and out of order.
  - Never use `Math.random()` or wall-clock time; use `rng(seed)` and `t`.
  - Units are metres and seconds.

Learn from the working demo: `examples/demo/scenes/` (7 sets, 16 shots: park coaster, US map, clay cockpit, clay cabin, sky, clay map with route, ratchet mechanism, article, quote, chart, hero stat, list, statement, photo, triptych). Read 3–4 of them before writing your own.

## Project layout
```
projects/<slug>/
  config.json            format, resolution, fps, voiceover, ui, music, sfx, loudness
  story/shots.json       THE timeline: contiguous shots {id,start,end,line,scene,...}
  timeline/words.json    word timings (from transcribe.py) — drives wordTime()/info.w()
  scenes/lib/*.js        optional shared helpers (loaded first)
  scenes/sets/*.js       registerSet(...)  — built once per render worker, cached (LRU 3)
  scenes/shots/*.js      registerShot(...) — one file per shot or per group of shots
  assets/{photos,articles,docs,stills}/   images, served at /project/assets/...
  research/ script/ audio/ build/ out/
```
`render.mjs` imports every `.js` under `scenes/lib`, then `sets`, then `shots` (alphabetically). Import the engine from `/engine/api.js`.

## Imports
```js
import { registerSet, registerShot, K, cam, THREE, E, V, ease, key, prog, clamp, lerp, mixVal, rng, noise, drift,
         wordTime, wordEnd, wordsBetween, toStage, LOOKS } from '/engine/api.js';
```
- `E`: runtime state. `E.W × E.H` is the logical stage (1920×1080, or 1080×1920 for 9:16), plus `E.vertical`, `E.fps`, `E.cfg`, `E.words`.
- `V(landscape, vertical)` picks a value by aspect: `V(36, 52)` for an fov, `V([0, 2, 9], [0, 2.4, 12])` for a camera position.
- **Easing:**
  - `ease.inOut | out | in | sine | linear | outBack | outExpo | inQuad | outQuad`;
  - `prog(t, a, b)` gives 0..1 between a and b;
  - `key(t, [[t0, v0], [t1, v1, ease.out], …])` interpolates numbers, arrays and objects.
- `drift(t, amp, freq, seed)` → [x, y, z] smooth noise, for floating motion.

## Sets
```js
registerSet('cockpit', async (W) => {
  W.shadowArea([0.3, 1, 0], 4);     // where shadows must be sharp: centre + radius (m). Small for interiors, large for landscapes
  W.noFog();                        // or W.fogScale(0.3)
  const ck = K.cockpit({ doorOpen: 0 }); W.add(ck.group);
  const cap = K.mannequin({ style: 'clay', pose: 'pilot' }); cap.position.copy(ck.capSeat); cap.rotation.y = Math.PI / 2; W.add(cap);
  return { ck, cap };               // this object is "S" in shots
});
```
- `W` gives you `THREE`, `scene`, `camera`, `add(...objs)`, `shadowArea(center, radius)`, `fogScale(k)`, `noFog()`, `look(spec)` and `E`.
- Build everything once here. Shots only move, show or hide objects.
- Keep objects you will animate in the returned object.
- Use `K.mergeByMaterial(parts)` or `K.crowd()` for big static or repeated geometry (crowds, seats, trees) to keep draw calls low.

## Shots
```js
registerShot('s012', {
  set: 'cockpit', look: 'clay',          // omit set for a 2D-only card; look may be {base:'dusk', sun:{intensity:2}}
  badge: 'RECONSTRUCTION',               // string | false (default from config.ui.badge)
  setup(W, S, info) { /* once when the shot is entered (per worker): show/hide, colours */ },
  update(W, S, t, info) { /* every frame: camera + animation; t = seconds since shot start */ },
  ui(U, t, info, S) { /* every frame: 2D overlay */ },
  bg: '#0d0f12',                         // 2D-only shots: background (default = look2d's bg)
  theme: 'light' | 'dark',               // overlay theme override
  footnote: '…',                         // or put "footnote" in shots.json
});
```
**`info`** contains:
- `id`, `dur`, `start`, `end`, `line` (the narration in the shot), `params` (from shots.json);
- `info.w('phrase', fallback)`: the local time (s from shot start) when the phrase starts. This is how everything syncs to the voice: `at: info.w('control column', 1.5)`.
- `info.wEnd('phrase', fallback)`: when the phrase ends.
- The globals `wordTime(phrase, after)` and `wordEnd()` give absolute times.

In shots, `W` is the **set's state**, not the builder API: use `W.camera`, `W.scene`, `W.sun`, `W.hemi` and `W.look` (the resolved look). Build and add objects only in the set builder (or once in `setup()` with `W.scene.add(...)`); `W.add`, `W.shadowArea` and `W.noFog` exist only inside `registerSet`. A per-shot look goes in the shot's `look` field.

**Several shots on one set** share the cached set. Because shots can render in any order, `update()` must set *every* property it animates every frame (camera, positions, visibility). Don't rely on what an earlier shot left behind; reset it in `setup()`.

## Cameras (`cam.*`; all deterministic in t)
- `cam.dolly(W.camera, t, [[0, {pos, look, fov, roll}], [info.dur, {...}, ease.out]])`: keyframed position and look-at.
- `cam.orbit(W.camera, t, {target, radius: r | [r0, r1], height: h | [h0, h1], from: deg, to: deg, dur, fov})`.
- `cam.follow(W.camera, t, (t) => Vector3, {posA, posB, lookA, lookB, dur, fov})`: offsets relative to a moving target, e.g. a train or a plane.
- `cam.handheld(W.camera, t, 0.02, seed)`: subtle float, applied after positioning. Keep it at 0.01–0.03.
- `toStage(camera, worldPoint)` → `{x, y, visible, depth}` in logical px, for custom overlay placement.

**Typical fov:** 30–40 for exteriors and maps, 45–60 inside cabins and cockpits.

## Looks (`engine/looks.js`)
`clay`, `day`, `golden`, `dusk`, `night`, `overcast`, `darkmap`, `studio`. Each defines:
- `ui` (overlay theme), `bg`, `sky` (`flat`, or `gradient` with zenith, mid, horizon and sunGlow);
- `fog` (exp2: about 0.001 for landscapes, about 0.006 for clay interiors);
- `hemi`, `sun` (colour, intensity, dir);
- `tone` (`aces`, `agx`, `neutral`);
- `ao` (radius in metres: interiors about 0.6, landscapes about 3), `bloom`, `vignette`;
- `palette` (base, soft, mid, dark, ink, accent, warn, warm, glass).

Override per shot: `look: {base: 'day', sun: {intensity: 2.4, dir: [-0.3, 0.4, 0.6]}, fog: {density: 0.0016}}`. Add a project look by importing `LOOKS` in a `scenes/lib` file and adding a key.

## Kit (`K.*`)
**Materials and primitives:**
- `K.mat(color, {rough, metal, flat, emissive, glow, opacity, side: 'double' | 'back', map})` (cached), `K.basic(color)`, `K.glowMat(color, power)`;
- `K.box(w, h, d, mat, pos, rot)`, `K.rbox(..., radius)` (rounded), `K.cyl(rt, rb, h, mat, pos, rot)`, `K.sphere(r, mat, pos)`, `K.capsuleBetween(a, b, r)`;
- `K.mergeByMaterial(parts)`, `K.placed(geo, pos, rot, scl)`;
- `K.canvasTex(w, h, (g, W, H) => draw)`, `K.textTex(text, {font, color, bg})`, `K.textPlane(text, width, o)`;
- `K.facadeTex`, `K.buttonPanelTex` (cockpit overhead panels).

**People:**
- `K.mannequin({style: 'clay' | 'smooth', color, height: 1.78, pose, outfit: {vest, cap, shirt, hair}})`. It returns a Group (root = pelvis) with:
  - `.setPose(name | object)`, `.blend(a, b, k)`;
  - `.standAt(x, z, yawDeg)`, which places the feet on the floor;
  - `.legLength`, `.joints`, `.setColor(c)`.
  - It faces +Z, with its left side at +X.
- `K.POSES`: `stand`, `attention`, `sit`, `pilot`, `ride`, `rideArmsUp`, `rideOneUp`, `armsUp`, `wave`, `point`, `reach`, `defend`, `strike`, `handsHead`, `phone`, `crouch`, `kneel`, `lieBack`, `lieSide`, `sprawl`, `fallForward`, `struggleA`, `struggleB`.
- `K.walkPose(phase, amt)`, `K.runPose(phase)` (phase = t × 2π × steps/s), `K.blendPose(a, b, k)`.
  - Joints are in degrees: `{hips, spine, chest, neck, head, shL, shR, elL, elR, wrL, wrR, hipL, hipR, knL, knR, anL, anR}`.
- `K.crowd([{pos, yaw, pose, scale, color}], {style})`: instanced. Use it for 50+ people (cabins, queues, stands).

**Paths and rides:**
- `K.path(points, {closed, bank})` → `{curve, L, frame(s) → {P, T, N, B}, point(s), wrap(s), crest()}`. Arc-length `s` is in metres, and the frames use world-up.
- `K.sweep`, `K.tubeAlong`, `K.alongPath`, `K.ribbon` build geometry along paths: rails, ties, catwalks, handrails, roads, rivers.
- `K.coaster({points, closed, colors: {track, rail, support, walk, chain}, supports, catwalk, chain})` → `{group, P, crestS, liftS}`.
- `K.train({cars, across, gap, colors: {body, seat, bar, …}, riders, riderStyle, poses, seed})` → `{group, cars: [{group, seats: [{pivot, barPivot, bar, rider}]}], place(P, sHead), length}`.
  - Call `T.place(P, sHead)` every frame.
  - The lap bar opens with a negative `barPivot.rotation.z`.

**Landscape and built environment:**
- `K.ground({color, size})`, `K.plaza(w, d, {color, tile})`;
- `K.forest({center, rMax, from, to, count, farMax, farCount, palette: 'autumn' | 'summer' | 'pine' | 'dry' | 'tropical' | 'winter' | 'clay', conifers, exclude: (x, z) => bool, seed})`, `K.tree()`;
- `K.building({w, h, d, wall, roof, roofType: 'flat' | 'gable', lit})`, `K.canopy`, `K.railing(points)`, `K.stairs`, `K.lamp({on})`, `K.bench`, `K.sign(text, {w, h, color, glow})`.

**Vehicles and rooms** (aircraft: nose +X, up +Y, LEFT = −Z, so the captain and left wing are at −Z):
- `K.airliner({length: 39.5, radius: 1.9, color, accent, windows, cutaway: 'top', engines})`. The tail is at x = 0 and the nose at x = length.
- `K.cabin({rows, pitch, left, right, width, passengers: 0..1, seed, cutaway})` → `{group, seat('13A') → Vector3, rowX(r), aisle(r), door, doorPos, frontX}`.
- `K.cockpit({doorOpen: 0..1, cutaway})` → `{group, capSeat, foSeat, capYoke, foYoke, door, setDoor(k), doorPos, pedestal, displays: {pfdL, ndL, eicas, …, redraw}, axe}`.
- `K.car({color, len})`, `K.room({w, d, h, open: 'front', door, windows})`, `K.table`, `K.chair`, `K.screenProp({draw})`, `K.phone`, `K.crate`, `K.cone`, `K.barrier`, `K.axe`.
- **Anything not in the kit:** build it from primitives in a `scenes/lib/<thing>.js` helper. Ships, trains, bridges, cranes and stadiums are all boxes, cylinders, sweeps and lathes. Get the proportions from `research/reconstruction_brief.md`.

**Maps** (async; Natural Earth via world-atlas and us-atlas; 1 unit = `kmPerUnit` km):
- `await K.worldMap({center: [lon, lat], span: [dLon, dLat], kmPerUnit, res: '50m' | '110m', land, seaColor, border, extrude, highlight: {'Name': '#2f6fdb'}, raise: {'Name': 1.2}})` → `{group, at(lon, lat, y), country(name), names}`.
- `await K.usMap({center, kmPerUnit, land, border, highlight: {'Georgia': '#2f6fdb'}, extrude, glow})`.
- `K.route(map, [[lon, lat], …], {height, arc, radius, color, greatCircle})`. It returns a mesh with `.setProgress(k)`, `.pointAt(k)` and `.tangentAt(k)`.
- `K.pin(map, lon, lat, {color, r, ring})` returns a pin with `.animate(t)`.

**Markers:**
- `K.ring({radius, color}).animate(t)` (pulse), `K.zone({rx, rz, color, opacity})`;
- `K.glowDot({r, color, power})`, `K.arrow3D({len, color})`, `K.beam({h, r, color})`.

## Overlay layer (`U.*` in `ui()`)
**Common options:**
- `at` (local s; reveal time) and `out` (hide time);
- `pos` (`'tl' | 'tr' | 'bl' | 'br' | 'c' | 't' | 'b' | 'cl'` or `{x, y, ax, ay}` in logical px);
- `key` (a stable id when the same call appears twice).

Elements are keyed per shot, so nothing leaks between shots.

| Call | Notes |
|---|---|
| `U.bg(color \| 'theme')`, `U.scrim('bl' \| 'b' \| 't' \| 'full', 0.5, {at})` | backgrounds; the scrim darkens behind text on colour shots |
| `U.badge(text)`, `U.footnote(text)` | usually automatic (config, shots.json) |
| `U.lowerThird({name, sub})`, `U.timeChip({time, sub})`, `U.timeStack({date, time, place})`, `U.title({title, kicker})` | |
| `U.pin(worldPoint, text, {style: 'tag' \| 'chip' \| 'note' \| 'card', sub, leader, dir: 'up' \| 'down' \| 'left' \| 'right', value: () => n, unit, decimals, at})` | label on a 3D point; hidden if behind the camera; `card` + `value` = live number ("ft") |
| `U.ring(worldPoint, {r, color, width, at})`, `U.measure(a, b, label, {at, drawDur})` | circle callout; dimension line between two 3D points |
| `U.stat({value, countFrom, decimals, prefix, suffix, label, kicker, sub}, {style: 'plate' \| 'hero', countDur})` | numbers count up |
| `U.quote({text, who, role, source, photo, tag}, {style: 'card' \| 'side'})`, `U.statement(text, {sub})` | quotes verbatim from `research/quotes.md` |
| `U.list({kicker, items: [{title, sub}], numbered}, {times: [...]})`, `U.compare({a: {title, sub}, b: {...}}, {times})` | items reveal at their words |
| `U.phone({kicker, title, sub, play})` | describes a video instead of showing it |
| `U.chart({points: [[x, y]...], x: {min, max, ticks}, y: {...}, title, color, area, annotations: [{x, y, text, at}], marker: 'dot' \| 'plane'}, {drawFrom, drawTo, box})` | |
| `U.article({outlet, color, headline, byline, date, paragraphs, highlights: ['exact phrase']}, {hlAt: [t], zoom: [[t, scale, pageX, pageY]], width})` | re-typeset excerpt; the highlight sweeps at `hlAt` |
| `U.document({header: [...], paragraphs (use [[6]] for a 6-em redaction bar), highlights}, {hlAt, zoom})` | |
| `U.screenshot({src, w, h, boxes: [{x, y, w, h, at}]}, {zoom})` | real capture from `capture_article.mjs` or `doc_page.py`: load its `.json` and pass the boxes with `at` times |
| `U.photo({src, caption: {kicker, title}, credit, name}, {kb: [[t, scale, cx, cy]], vignette})` | full-frame photo with a Ken Burns move |
| `U.triptych({items: [{src, label}]}, {times})` | possibility panels; `src` like `/project/assets/stills/12.5s_12.50.png` (from `render.mjs --stills 12.5 --noui --out assets/stills`) |
| `U.captions({karaoke})` | automatic when `config.captions` |
| `U.html(key, html, style)`, `U.svg(key, inner)` | escape hatch for one-off graphics (escape any text) |

**Screenshot boxes from a capture:** in a `scenes/lib` file, fetch the JSON (`const cap = await (await fetch('/project/assets/articles/x.png.json')).json()`), or paste the boxes into the shot. Then: `U.screenshot({src: cap.src, w: cap.w, h: cap.h, boxes: cap.boxes.map((b) => ({...b, at: info.w(b.phrase.split(' ').slice(0, 3).join(' '), 1)}))}, {zoom: [[0, 0.9, cap.boxes[0].x + 300, cap.boxes[0].y], [info.dur, 1.05, cap.boxes[0].x + 300, cap.boxes[0].y + 40]]})`.

## shots.json (owned by you; timing from beats.py)
```json
{ "title": "…", "duration": 942.3,
  "music": [{"start": 0, "end": 95, "mood": "investigation", "intensity": 0.35}, …],
  "shots": [
    { "id": "s001", "start": 0.0, "end": 4.62, "line": "words spoken in this shot",
      "scene": "cockpit: slow push over captain's shoulder, tags on both columns",
      "footnote": "Positions approximate · based on passenger accounts",
      "in": {"type": "cut" | "dip" | "dipWhite" | "flash", "dur": 0.5},
      "sfx": [{"at": 0.2, "name": "whoosh", "gain": -10}], "amb": {"name": "cabin", "gain": -24},
      "params": {}, "captions": true, "notes": "" } ] }
```
**Rules:**
- Shots are contiguous: `end[i] == start[i+1]`, the first starts at 0, and `duration == last end`.
- Cut 0.1–0.2 s before the phrase starts.
- `scene` is a precise description: set, camera, action and overlays.

## config.json (main keys)
| Key | Values |
|---|---|
| `title` | |
| `format` | `long` \| `short` |
| `aspect` | `16:9` \| `9:16` |
| `resolution` | `720p`, `1080p`, `1440p`, `2160p` |
| `fps` | 30 |
| `look` | default look for 3D shots and sets that don't name one (`clay`, `day`, …); a set builder can set its own with `W.look('dusk')` |
| `quality` | `draft` \| `standard` \| `high` |
| `voiceover` | `audio/voiceover.wav` |
| `duration` | |
| `captions` | |
| `fadeIn`, `fadeOut` | |
| `ui` | `{badge: 'RECONSTRUCTION' \| null, look2d: 'clay' \| 'darkmap' \| …, karaoke, theme}` |
| `music` | `{enabled, source: 'score' \| 'file' \| 'procedural', gainDb (vs the voice, −19), lufs (score loudness, −20), soundfont, file, seed}`; the score lives in `audio/score.py` (compose-music skill) |
| `sfx` | `{enabled, gainDb}` |
| `loudness` | −14 |
| `voice` | `{engine, voice, pauses}` |
| `setCache` | number of sets kept in memory per worker (3) |

## Performance
- **Polygon budget:** about 2–4 M triangles visible per set is fine on a GPU. On SwiftShader, keep forests at `farCount` ≤ 6000 for previews.
- **Draw calls:** merge static parts (`mergeByMaterial`) and instance repeats (`crowd`, `forest` already do).
- **Shadows:** keep the `shadowArea` tight around what the camera sees. One huge shadow area makes blurry shadows.
- **Textures:** canvas textures should be about 512–2048 px wide, and reused.
- **Speed:** `--quality draft` drops AO, MSAA and bloom for fast previews. The final render uses `standard` or `high`.
