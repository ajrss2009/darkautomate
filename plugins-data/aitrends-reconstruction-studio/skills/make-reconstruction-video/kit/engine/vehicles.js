// engine/vehicles.js — aircraft (exterior + cutaway), cabin interior, cockpit, car, generic room and props.
// Conventions: aircraft nose points +X, up +Y, LEFT side -Z (captain's seat, left wing). Rooms: floor at y=0, origin at floor centre.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mat, mesh, box, rbox, cyl, sphere, placed, mergeByMaterial, canvasTex, buttonPanelTex, crowd, mannequin, glowMat } from './kit3d.js';
import { rng, lerp } from './core.js';
const deg = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------- narrow-body airliner (737/A320 class)
// airliner({ length:39.5, radius:1.9, color, accent, windows:true, cutaway:false|'top', engines:true, tailColor })
// Nose at +X (x = length), tail at x = 0, up +Y, LEFT wing -Z. Returns Group with .noseX, .fuselageR, .floorY, .length
export function airliner(o = {}) {
  const { length = 39.5, radius = 1.9, color = '#eeede9', accent = '#c9c7c2', windowColor = '#2a2f36', tailColor = color } = o;
  const G = new THREE.Group();
  const mBody = mat(color, { rough: 0.45, side: o.cutaway ? 'double' : 'front' }), mAcc = mat(accent, { rough: 0.5 }), mTail = mat(tailColor, { rough: 0.45 });
  const tailL = 10.5, noseL = 4.6, upsweep = radius * 0.85;
  // profile (radius, position along the body from tail=0 to nose=length)
  const prof = []; for (let i = 0; i <= 16; i++) { const k = i / 16; prof.push(new THREE.Vector2(Math.max(0.001, radius * (0.1 + 0.9 * Math.pow(k, 0.6))), k * tailL)); }
  for (let i = 1; i <= 18; i++) { const k = i / 18; prof.push(new THREE.Vector2(Math.max(0.001, radius * Math.sqrt(Math.max(0, 1 - k * k))), length - noseL + k * noseL)); }
  prof.splice(17, 0, new THREE.Vector2(radius, length - noseL));
  const fg = new THREE.LatheGeometry(prof, 64, o.cutaway === 'top' ? Math.PI : 0, o.cutaway === 'top' ? Math.PI : Math.PI * 2);
  fg.rotateZ(-Math.PI / 2);                                  // lathe axis +Y -> +X
  const pa = fg.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i); if (x < tailL) pa.setY(i, pa.getY(i) + Math.pow(1 - x / tailL, 1.6) * upsweep); } fg.computeVertexNormals();
  G.add(mesh(fg, mBody));
  if (!o.cutaway) { const cw = mesh(new THREE.SphereGeometry(radius * 1.006, 32, 10, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.3, Math.PI * 0.14), mat('#20252c', { rough: 0.2 }));
    cw.scale.set(noseL / radius * 0.9, 1, 1); cw.position.set(length - noseL, 0, 0); G.add(cw); }
  if (o.windows !== false) { const wg = new THREE.CapsuleGeometry(0.1, 0.13, 2, 8); const n = Math.floor((length - noseL - tailL - 1.5) / 0.53); const im = new THREE.InstancedMesh(wg, mat(windowColor, { rough: 0.2 }), n * 2); const m4 = new THREE.Matrix4(); let k = 0;
    for (const sd of [1, -1]) { if (o.cutaway && sd < 0) continue; for (let i = 0; i < n; i++) { const x = length - noseL - 1.6 - i * 0.53; m4.compose(new THREE.Vector3(x, radius * 0.3, sd * radius * 0.965), new THREE.Quaternion().setFromEuler(new THREE.Euler(-sd * 0.3, 0, 0)), new THREE.Vector3(1, 1, 1)); im.setMatrixAt(k++, m4); } }
    im.count = k; G.add(im); }
  // planform helper: shape in (x = chordwise, y = spanwise), extruded thin, laid flat (span -> -Z or +Z)
  const planform = (span, root, tip, sweep, thick) => { const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-root, 0), new THREE.Vector2(-sweep - tip, span), new THREE.Vector2(-sweep, span)]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.25, bevelSize: thick * 0.25, bevelSegments: 2 }); g.rotateX(Math.PI / 2); g.translate(0, thick / 2, 0); return g; }; // shape y -> +Z
  const wingX = length * 0.6, wingY = -radius * 0.45;
  for (const sd of [1, -1]) {
    const wgeo = planform(16.4, 7.2, 1.4, 8.4, 0.34); if (sd < 0) wgeo.scale(1, 1, -1);
    const w = mesh(wgeo, mBody, [wingX, wingY, 0]); w.rotation.x = sd * THREE.MathUtils.degToRad(-5.5); G.add(w);
    const tipY = wingY + 16.4 * Math.sin(THREE.MathUtils.degToRad(5.5));
    G.add(box(1.1, 2.0, 0.08, mAcc, [wingX - 8.4 - 0.9, tipY + 1.0, sd * 16.45], [0, 0, -28]));
    if (o.engines !== false) { const eng = new THREE.Group(); eng.position.set(wingX + 1.9, -radius * 1.0, sd * 5.0);
      eng.add(mesh(new THREE.CylinderGeometry(0.98, 0.86, 4.0, 28, 1, true).rotateZ(Math.PI / 2), mat(accent, { rough: 0.4, side: 'double' })));
      eng.add(mesh(new THREE.CircleGeometry(0.93, 28).rotateY(Math.PI / 2), mat('#2a2d31'), [1.95, 0, 0]));
      eng.add(mesh(new THREE.ConeGeometry(0.45, 1.2, 18).rotateZ(Math.PI / 2), mat('#9a9c9e'), [-2.5, 0, 0]));
      eng.add(box(2.8, 0.8, 0.22, mAcc, [-1.0, 0.75, 0])); G.add(eng); }
    const hs = planform(6.2, 3.6, 1.2, 3.6, 0.2); if (sd < 0) hs.scale(1, 1, -1); G.add(mesh(hs, mTail, [5.2, radius * 0.25 + upsweep * 0.45, 0]));
  }
  const fin = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-6.4, 0), new THREE.Vector2(-9.0, 7.4), new THREE.Vector2(-6.8, 7.4)]), { depth: 0.28, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1 });
  G.add(mesh(fin, mTail, [9.6, radius * 0.55 + upsweep * 0.3, -0.14]));
  G.noseX = length; G.tailX = 0; G.fuselageR = radius; G.floorY = -radius * 0.42; G.length = length;
  return G;
}

// ---------------------------------------------------------------- cabin interior (aisle along X, nose +X, LEFT = -Z)
// cabin({ rows:31, pitch:0.79, left:3, right:3, width:3.54, passengers:0.9, seed, startX:0, cutaway:false })
// returns { group, seat('13A') -> pelvis Vector3, rowX(row), aisle(row), door (pivot Group), doorPos, frontX, length }
export function cabin(o = {}) {
  const { rows = 31, pitch = 0.79, left = 3, right = 3, width = 3.54, passengers = 0.9, seed = 5, startX = 0, seatColor = '#e6e4df', wallColor = '#f2f1ee', carpet = '#d7d5cf' } = o;
  const G = new THREE.Group(); const r = rng(seed);
  const mWall = mat(wallColor, { rough: 0.8, side: 'double' }), mSeat = mat(seatColor, { rough: 0.75 }), mFloor = mat(carpet, { rough: 1 });
  const length = rows * pitch + 4.5, frontX = startX + length, R = width * 0.56, cy = 0.5;
  G.add(box(length, 0.1, width, mFloor, [startX + length / 2, -0.05, 0]));
  if (!o.cutaway) { // curved sidewalls + ceiling: partial cylinder along X
    const sh = new THREE.CylinderGeometry(R, R, length, 56, 1, true, THREE.MathUtils.degToRad(-14), THREE.MathUtils.degToRad(208)); sh.rotateZ(Math.PI / 2);
    G.add(mesh(sh, mWall, [startX + length / 2, cy, 0]));
  }
  const wallZ = (y) => Math.sqrt(Math.max(0, R * R - (y - cy) ** 2));
  for (const sd of [1, -1]) G.add(rbox(length - 2, 0.42, 0.6, mat('#f6f5f2', { rough: 0.7 }), [startX + length / 2, 1.8, sd * (wallZ(1.8) - 0.34)], null, 0.06));
  const wIm = new THREE.InstancedMesh(new RoundedBoxGeometry(0.02, 0.32, 0.24, 2, 0.08), glowMat('#ffffff', 1.25), rows * 2); const m4 = new THREE.Matrix4(); let wk = 0;
  const nSeats = rows * (left + right); const pan = new THREE.InstancedMesh(new RoundedBoxGeometry(0.46, 0.12, 0.44, 2, 0.04), mSeat, nSeats), back = new THREE.InstancedMesh(new RoundedBoxGeometry(0.1, 0.72, 0.44, 2, 0.04), mSeat, nSeats);
  const seatsPos = {}, people = []; let k = 0; const letters = 'ABCDEFGHJK';
  for (let row = 0; row < rows; row++) {
    const x = startX + 1 + row * pitch, rowNum = rows - row;
    for (let i = 0; i < left + right; i++) {
      const isLeft = i < left; const z = isLeft ? -(width / 2 - 0.3 - i * 0.46) : (width / 2 - 0.3 - (left + right - 1 - i) * 0.46);
      pan.setMatrixAt(k, m4.compose(new THREE.Vector3(x, 0.44, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
      back.setMatrixAt(k, m4.compose(new THREE.Vector3(x - 0.25, 0.86, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, THREE.MathUtils.degToRad(8))), new THREE.Vector3(1, 1, 1))); k++;
      seatsPos[`${rowNum}${letters[i]}`] = new THREE.Vector3(x - 0.05, 0.6, z);
      if (r() < passengers) people.push({ pos: [x - 0.04, 0.6, z], yaw: 90 + lerp(-12, 12, r()), pose: r() < 0.82 ? 'sit' : 'phone', scale: lerp(0.92, 1.06, r()) });
    }
    for (const sd of [1, -1]) wIm.setMatrixAt(wk++, m4.compose(new THREE.Vector3(x, 1.12, sd * (wallZ(1.12) - 0.03)), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
  }
  for (const m of [pan, back]) { m.castShadow = m.receiveShadow = true; G.add(m); } if (!o.cutaway) G.add(wIm);
  if (people.length) G.add(crowd(people, { style: o.style || 'clay', color: o.passengerColor || '#efede8' }));
  const bx = frontX - 0.2; G.add(box(0.12, 2.25, width * 0.92, mWall, [bx, 1.12, 0]));
  const door = new THREE.Group(); door.position.set(bx - 0.08, 0, -0.42); door.add(rbox(0.06, 1.95, 0.84, mat('#e9e8e4', { rough: 0.6 }), [0, 0.98, 0.42], null, 0.02));
  door.add(sphere(0.03, mat('#222'), [-0.04, 1.55, 0.42]), box(0.02, 0.06, 0.18, mat('#2a2c2e'), [-0.04, 1.0, 0.72])); G.add(door);
  const rowX = (rowNum) => startX + 1 + (rows - rowNum) * pitch;
  return { group: G, seat: (id) => seatsPos[id]?.clone() || new THREE.Vector3(startX, 0.6, 0), rowX, aisle: (rowNum) => new THREE.Vector3(rowX(rowNum), 0, 0), door, doorPos: new THREE.Vector3(bx - 0.1, 0, 0), frontX, length };
}

// ---------------------------------------------------------------- cockpit (forward = +X, captain LEFT = -Z)
// cockpit({ doorOpen:0..1, cutaway:false (no ceiling/shell, for top-down views) })
// -> { group, capSeat, foSeat (pelvis positions), capYoke, foYoke, door (pivot), setDoor(k), doorPos, pedestal, displays, axe }
export function cockpit(o = {}) {
  const { base = '#ecebe7', trim = '#d9d7d1', glass = '#efe3cf', screen = '#0f1318', seed = 9 } = o;
  const G = new THREE.Group(); const mB = mat(base, { rough: 0.75 }), mT = mat(trim, { rough: 0.7 }), mBs = mat(base, { rough: 0.8, side: 'double' }), mD = mat('#2a2c2f', { rough: 0.6 });
  const btn = new THREE.MeshStandardMaterial({ map: buttonPanelTex({ seed, density: 150 }), roughness: 0.8 }), btn2 = new THREE.MeshStandardMaterial({ map: buttonPanelTex({ seed: seed + 3, density: 80 }), roughness: 0.8 });
  const R = 1.85, cy = 0.75, x0 = -1.6, x1 = 1.75;
  G.add(box(x1 - x0 + 0.5, 0.08, 3.4, mB, [(x0 + x1) / 2 + 0.2, -0.04, 0]));
  if (!o.cutaway) {
    const sh = new THREE.CylinderGeometry(R, R, x1 - x0, 48, 1, true, THREE.MathUtils.degToRad(-18), THREE.MathUtils.degToRad(216)); sh.rotateZ(Math.PI / 2); G.add(mesh(sh, mBs, [(x0 + x1) / 2, cy, 0]));
    // nose: windshield + side windows (warm light through glass) set into a tapering frame
    const glassM = new THREE.MeshStandardMaterial({ color: new THREE.Color(glass), emissive: new THREE.Color(glass), emissiveIntensity: 0.85, roughness: 0.4, side: THREE.DoubleSide });
    const panes = [[-1.15, -0.42], [-0.4, 0.38], [0.4, 1.16]];
    for (const [z0, z1] of [[-1.25, -0.04], [0.04, 1.25]]) { const pane = mesh(new THREE.PlaneGeometry(0.62, Math.abs(z1 - z0)), glassM, [x1 + 0.28, 1.5, (z0 + z1) / 2]); pane.rotation.set(0, -Math.PI / 2, 0); pane.rotateX(0); pane.rotation.z = 0; pane.rotateOnAxis(new THREE.Vector3(1, 0, 0), 0); pane.rotation.order = 'YXZ'; pane.rotation.x = THREE.MathUtils.degToRad(-50); G.add(pane); }
    G.add(box(0.5, 0.75, 0.08, mT, [x1 + 0.28, 1.5, 0], [0, 0, -40]));
    const cap = mesh(new THREE.CircleGeometry(R, 48), mBs, [x1 + 0.62, cy, 0]); cap.rotation.y = -Math.PI / 2; G.add(cap);   // closes the nose behind the glass
    for (const sd of [1, -1]) { const sw = mesh(new THREE.PlaneGeometry(0.9, 0.5), glassM, [1.25, 1.52, sd * 1.66]); sw.rotation.y = sd > 0 ? Math.PI : 0; sw.rotateX(sd * THREE.MathUtils.degToRad(-14)); G.add(sw);
      G.add(box(1.0, 0.06, 0.06, mT, [1.25, 1.78, sd * 1.6]), box(1.0, 0.06, 0.06, mT, [1.25, 1.26, sd * 1.68])); }
    // overhead panel
    G.add(mesh(new THREE.BoxGeometry(1.5, 0.07, 1.2), [mB, mB, mB, btn, mB, mB], [0.75, 2.2, 0], [0, 0, 16]));
    G.add(box(x1 - x0, 0.06, 3.0, mBs, [(x0 + x1) / 2 - 0.2, 2.42, 0]));
  }
  // glareshield, panel with displays, side consoles
  G.add(rbox(0.62, 0.2, 2.95, mB, [1.5, 1.2, 0], null, 0.09));
  G.add(rbox(0.12, 0.62, 2.85, mT, [1.68, 0.86, 0], [0, 0, -9], 0.03));
  const displays = {};
  const disp = (name, z, draw) => { const tex = canvasTex(256, 256, draw); const m = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.4 }));
    m.position.set(1.61, 0.9, z); m.rotation.order = 'YXZ'; m.rotation.y = -Math.PI / 2; m.rotation.x = THREE.MathUtils.degToRad(-9); G.add(m); displays[name] = { mesh: m, tex, redraw: (fn) => { fn(tex.canvas.getContext('2d'), 256, 256); tex.needsUpdate = true; } }; return m; };
  const pfd = (g, W, H) => { g.fillStyle = screen; g.fillRect(0, 0, W, H); g.fillStyle = '#3f86d8'; g.fillRect(44, 34, 168, 96); g.fillStyle = '#a0612e'; g.fillRect(44, 130, 168, 92); g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(44, 130); g.lineTo(212, 130); g.stroke(); g.fillStyle = '#ffd200'; g.fillRect(100, 126, 56, 8); g.fillStyle = '#2b2f36'; g.fillRect(6, 34, 30, 188); g.fillRect(220, 34, 30, 188); };
  const nd = (g, W, H) => { g.fillStyle = screen; g.fillRect(0, 0, W, H); g.strokeStyle = '#e6e6e6'; g.lineWidth = 2; for (const rr of [60, 100]) { g.beginPath(); g.arc(128, 200, rr, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); } g.strokeStyle = '#d64ad6'; g.beginPath(); g.moveTo(128, 200); g.lineTo(150, 70); g.stroke(); };
  const eic = (g, W, H) => { g.fillStyle = screen; g.fillRect(0, 0, W, H); g.strokeStyle = '#e6e6e6'; g.lineWidth = 3; for (const [x, y] of [[70, 70], [186, 70], [70, 170], [186, 170]]) { g.beginPath(); g.arc(x, y, 34, Math.PI * 0.75, Math.PI * 2.1); g.stroke(); } };
  if (o.displays !== false) { disp('pfdL', -1.22, pfd); disp('ndL', -0.86, nd); disp('eicas', -0.18, eic); disp('eicas2', 0.18, eic); disp('ndR', 0.86, nd); disp('pfdR', 1.22, pfd); }
  for (const sd of [1, -1]) G.add(mesh(new THREE.BoxGeometry(1.5, 0.12, 0.42), [mB, mB, btn2, mB, mB, mB], [0.45, 0.7, sd * 1.3]));
  // centre pedestal + throttles
  const ped = new THREE.Group(); ped.position.set(0.85, 0, 0);
  ped.add(mesh(new THREE.BoxGeometry(1.15, 0.72, 0.6), [mB, mB, btn2, mB, mB, mB], [0, 0.36, 0]));
  ped.add(mesh(new THREE.BoxGeometry(0.55, 0.2, 0.56), [mB, mB, btn, mB, mB, mB], [0.5, 0.8, 0], [0, 0, -18]));
  for (const z of [-0.09, 0.09]) { ped.add(cyl(0.022, 0.022, 0.32, mT, [0.18, 0.86, z], [0, 0, -25], 8)); ped.add(rbox(0.05, 0.07, 0.12, mB, [0.25, 1.01, z], null, 0.02)); }
  G.add(ped);
  // pilot seats, yokes
  const seatObj = (z) => { const s = new THREE.Group(); s.position.set(0.15, 0, z); s.add(rbox(0.6, 0.15, 0.58, mB, [0, 0.48, 0], null, 0.06), rbox(0.15, 0.85, 0.56, mB, [-0.31, 0.95, 0], [0, 0, 10], 0.07), rbox(0.13, 0.22, 0.32, mB, [-0.36, 1.46, 0], [0, 0, 10], 0.05), cyl(0.06, 0.09, 0.42, mT, [0, 0.21, 0], null, 12));
    for (const sd of [1, -1]) s.add(rbox(0.42, 0.06, 0.07, mB, [0.0, 0.69, sd * 0.31], null, 0.02)); return s; };
  G.add(seatObj(-0.62), seatObj(0.62));
  const yoke = (z) => { const y = new THREE.Group(); y.position.set(1.12, 0, z); y.add(cyl(0.05, 0.065, 0.92, mB, [0, 0.46, 0], [0, 0, -6], 12)); const w = new THREE.Group(); w.position.set(-0.04, 0.96, 0); w.add(box(0.06, 0.06, 0.34, mB));
    for (const sd of [1, -1]) { const h = mesh(new THREE.TorusGeometry(0.09, 0.024, 8, 16, Math.PI), mB, [0, -0.01, sd * 0.17]); h.rotation.set(0, 0, sd > 0 ? -Math.PI / 2 : Math.PI / 2); h.rotateY(Math.PI / 2); w.add(h); } y.add(w); return y; };
  G.add(yoke(-0.62), yoke(0.62));
  // rear wall, door (hinged on the right side looking aft), crash axe on the wall behind the captain
  G.add(box(0.1, 2.3, 3.2, mB, [x0 + 0.05, 1.15, 0]));
  const door = new THREE.Group(); door.position.set(x0 + 0.1, 0, -0.45);
  door.add(rbox(0.06, 1.95, 0.88, mat('#e2e0dc', { rough: 0.6 }), [0.03, 0.98, 0.44], null, 0.02), sphere(0.025, mD, [0.07, 1.58, 0.44]), box(0.03, 0.05, 0.2, mD, [0.07, 1.02, 0.78]));
  door.rotation.y = THREE.MathUtils.degToRad((o.doorOpen ?? 0) * 95); G.add(door);
  const axe = new THREE.Group(); const ax = axeProp(); ax.rotation.z = Math.PI / 2; axe.add(ax); axe.position.set(x0 + 0.13, 1.25, -1.1); axe.rotation.y = Math.PI / 2; G.add(axe);
  return { group: G, capSeat: new THREE.Vector3(0.12, 0.6, -0.62), foSeat: new THREE.Vector3(0.12, 0.6, 0.62), capYoke: new THREE.Vector3(1.08, 0.96, -0.62), foYoke: new THREE.Vector3(1.08, 0.96, 0.62),
    door, setDoor: (k) => { door.rotation.y = THREE.MathUtils.degToRad(k * 95); }, doorPos: new THREE.Vector3(x0 + 0.1, 1.0, 0), pedestal: new THREE.Vector3(0.85, 0.8, 0), panelX: 1.62, displays, axe, floorY: 0, rearX: x0 };
}
function axeProp() { const G = new THREE.Group(); G.add(cyl(0.018, 0.022, 0.75, mat('#d43a2f', { rough: 0.6 }), [0, 0.375, 0], null, 10)); const head = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.16, -0.05), new THREE.Vector2(0.18, 0.1), new THREE.Vector2(0, 0.06), new THREE.Vector2(-0.06, 0.03)]); G.add(mesh(new THREE.ExtrudeGeometry(head, { depth: 0.02, bevelEnabled: false }), mat('#9aa0a6', { rough: 0.3, metal: 0.7 }), [0, 0.66, -0.01])); return G; }

// ---------------------------------------------------------------- car, room, props
export function car(o = {}) { const { color = '#3a5a8a', glass = '#2a323c', len = 4.5, w = 1.85, h = 1.45 } = o; const G = new THREE.Group(); const m = mat(color, { rough: 0.35, metal: 0.3 });
  G.add(rbox(len, h * 0.5, w, m, [0, h * 0.4, 0], null, 0.18)); G.add(rbox(len * 0.52, h * 0.42, w * 0.9, mat(glass, { rough: 0.15, metal: 0.4 }), [-len * 0.05, h * 0.82, 0], null, 0.16));
  for (const x of [len * 0.32, -len * 0.32]) for (const z of [w / 2 - 0.12, -w / 2 + 0.12]) G.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20).rotateX(Math.PI / 2), mat('#1a1a1c'), [x, 0.34, z]));
  for (const z of [0.6, -0.6]) G.add(sphere(0.1, glowMat('#fff6d8', o.lights ? 3 : 0.6), [len / 2, 0.55, z * w / 2])); return G; }
// room({ w:8, d:6, h:3, wall, floor, ceiling:true, open:'front'|'none', door:{wall:'back', x:0, w:0.9, h:2.1}, windows:[{wall:'left', x, y, w, h}] })
export function room(o = {}) { const { w = 8, d = 6, h = 3, wall = '#efeeea', floor = '#d6d2ca', open = 'front', ceiling = true } = o; const G = new THREE.Group(); const mW = mat(wall, { rough: 0.9, side: 'double' });
  G.add(box(w, 0.1, d, mat(floor, { rough: 1 }), [0, -0.05, 0])); if (ceiling) G.add(box(w, 0.1, d, mW, [0, h + 0.05, 0]));
  const wallPanel = (name, len, pos, rotY) => { const holes = [o.door, ...(o.windows || [])].filter((x) => x && x.wall === name); const shape = new THREE.Shape([new THREE.Vector2(-len / 2, 0), new THREE.Vector2(len / 2, 0), new THREE.Vector2(len / 2, h), new THREE.Vector2(-len / 2, h)]);
    for (const hl of holes) { const y0 = hl.y ?? 0, hh = hl.h ?? 2.1, ww = hl.w ?? 0.9, x0 = hl.x ?? 0; shape.holes.push(new THREE.Path([new THREE.Vector2(x0 - ww / 2, y0), new THREE.Vector2(x0 + ww / 2, y0), new THREE.Vector2(x0 + ww / 2, y0 + hh), new THREE.Vector2(x0 - ww / 2, y0 + hh)])); }
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }); const m = mesh(g, mW, pos); m.rotation.y = rotY; G.add(m); };
  if (open !== 'back') wallPanel('back', w, [0, 0, -d / 2 - 0.06], 0); if (open !== 'front') wallPanel('front', w, [0, 0, d / 2 - 0.06], 0);
  if (open !== 'left') wallPanel('left', d, [w / 2, 0, 0], -Math.PI / 2); if (open !== 'right') wallPanel('right', d, [-w / 2, 0, 0], Math.PI / 2);
  return G; }
export function table(o = {}) { const { w = 1.6, d = 0.8, h = 0.75, color = '#c9b79c' } = o; const G = new THREE.Group(); const m = mat(color, { rough: 0.7 }); G.add(box(w, 0.05, d, m, [0, h, 0])); for (const x of [w / 2 - 0.06, -w / 2 + 0.06]) for (const z of [d / 2 - 0.06, -d / 2 + 0.06]) G.add(box(0.05, h, 0.05, m, [x, h / 2, z])); return G; }
export function chair(o = {}) { const { color = '#3a3c40' } = o; const G = new THREE.Group(); const m = mat(color, { rough: 0.7 }); G.add(box(0.46, 0.05, 0.46, m, [0, 0.46, 0]), box(0.05, 0.5, 0.44, m, [-0.21, 0.72, 0])); for (const x of [0.2, -0.2]) for (const z of [0.2, -0.2]) G.add(box(0.035, 0.46, 0.035, m, [x, 0.23, z])); return G; }
export function screenProp(o = {}) { const { w = 0.6, h = 0.36, draw } = o; const G = new THREE.Group(); const tex = canvasTex(512, Math.round(512 * h / w), draw || ((g, W, H) => { g.fillStyle = '#0f1318'; g.fillRect(0, 0, W, H); }));
  G.add(rbox(w + 0.03, h + 0.03, 0.03, mat('#1d1f22'), [0, h / 2 + 0.12, 0], null, 0.01)); const sc = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color('#fff'), emissiveMap: tex, emissiveIntensity: 0.8 })); sc.position.set(0, h / 2 + 0.12, 0.017); G.add(sc); G.add(box(0.05, 0.12, 0.05, mat('#1d1f22'), [0, 0.06, 0])); G.screen = { tex, redraw: (fn) => { fn(tex.canvas.getContext('2d'), tex.canvas.width, tex.canvas.height); tex.needsUpdate = true; } }; return G; }
export function phone(o = {}) { const G = new THREE.Group(); G.add(rbox(0.075, 0.155, 0.009, mat('#1b1c1f', { rough: 0.3 }), [0, 0, 0], null, 0.008)); G.add(box(0.068, 0.145, 0.001, glowMat(o.screen || '#9fc4ff', 0.9), [0, 0, 0.0052])); return G; }
export function crate(o = {}) { const { s = 0.6, color = '#b48a5a' } = o; return rbox(s, s, s, mat(color, { rough: 0.9 }), [0, s / 2, 0], null, 0.02); }
export function cone(o = {}) { const G = new THREE.Group(); G.add(mesh(new THREE.ConeGeometry(0.17, 0.7, 20), mat(o.color || '#ff7a1a', { rough: 0.6 }), [0, 0.35, 0])); G.add(box(0.4, 0.03, 0.4, mat('#222'), [0, 0.015, 0])); return G; }
export function barrier(o = {}) { const { w = 2, color = '#e9e6df', stripe = '#d7443b' } = o; const G = new THREE.Group(); G.add(box(w, 0.12, 0.05, mat(stripe), [0, 0.95, 0]), box(w, 0.12, 0.05, mat(color), [0, 0.7, 0])); for (const x of [w / 2 - 0.1, -w / 2 + 0.1]) G.add(box(0.06, 1.0, 0.4, mat('#2a2c2e'), [x, 0.5, 0])); return G; }
// a generic hand tool / axe (handle along +Y)
export function axe(o = {}) { const G = new THREE.Group(); G.add(cyl(0.018, 0.022, 0.75, mat(o.handle || '#d43a2f', { rough: 0.6 }), [0, 0.375, 0], null, 10)); const head = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.16, -0.05), new THREE.Vector2(0.18, 0.1), new THREE.Vector2(0, 0.06), new THREE.Vector2(-0.06, 0.03)]); G.add(mesh(new THREE.ExtrudeGeometry(head, { depth: 0.02, bevelEnabled: false }), mat('#9aa0a6', { rough: 0.3, metal: 0.7 }), [0, 0.66, -0.01])); return G; }
