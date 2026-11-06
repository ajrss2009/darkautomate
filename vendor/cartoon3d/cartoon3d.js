/* cartoon3d for FilmForge — look ported from github.com/mromidev/claude-animated-shorts (MIT, (c) 2026 Mr omi). */
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value);

// vendor/cartoon3d/src/stage.ts
import * as THREE5 from "three";

// vendor/cartoon3d/src/toon.ts
var INK = "#241726", SKIN = "#ffe2c2", WHITE = "#ffffff", MOUTH = "#5a1e28", TONGUE = "#e86e78", SH_SKIN = [0.96, 0.86, 0.84], SH_CLOTH = [0.64, 0.66, 0.74], SH_FELT = [0.62, 0.62, 0.7], rad = (d) => d * Math.PI / 180, clamp = (x, a, b) => Math.max(a, Math.min(b, x)), mul = (c, m) => {
  let n = parseInt(c.slice(1), 16), ch = (v, k) => Math.min(255, Math.round(v * k)).toString(16).padStart(2, "0");
  return `#${ch(n >> 16 & 255, m[0])}${ch(n >> 8 & 255, m[1])}${ch(n & 255, m[2])}`;
}, shade = (c, k) => mul(c, [k, k, k]), mix = (a, b, t) => {
  let A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16), ch = (s) => Math.round((A >> s & 255) * (1 - t) + (B >> s & 255) * t).toString(16).padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}, rnd = (seed, k) => {
  let x = Math.sin(seed * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}, rotPts = (pts, a, cx, cy) => pts.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]), rotAbout = (q2, a, c) => rotPts([q2], a, c[0], c[1])[0], lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], curve = (a, k, b, n = 10) => {
  let c = [2 * k[0] - (a[0] + b[0]) / 2, 2 * k[1] - (a[1] + b[1]) / 2], out = [];
  for (let i = 0; i <= n; i++) {
    let t = i / n, s = 1 - t;
    out.push([s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]]);
  }
  return out;
}, RIFLEMAN = { jacket: "#357650", pants: "#3d4440", boots: INK, hat: "shako", belt: "#f1efe6", buttons: "#d9dde0", rifle: !0 }, OFFICER = { ...RIFLEMAN, hat: "shako_tall", buttons: "#e8c45a", sash: "#c0353a", sword: !0, moustache: "#4a3020", rifle: !1, belt: null, build: "stout" }, KID = { jacket: "#f08a2c", pants: "#3b5b9a", boots: "#f4f1ea", hat: "cap", cap: "#e2453c", build: "kid" }, PARENT = { jacket: "#7b5ac9", pants: "#3b3f52", boots: "#5a3b2a", hat: "hair", hair: "#5a3b2a" }, SKINS = [SKIN, "#f5c9a0", "#ecd0b6", "#c99067"], soldier = (v = 0, extra = {}) => {
  let o = { ...RIFLEMAN, skin: SKINS[v % 4] };
  return v % 4 === 1 && (o.moustache = "#4a3426"), v % 4 === 3 && (o.moustache = "#2a201a"), { ...o, ...extra };
}, townsfolk = (v = 0) => {
  let o = { jacket: ["#3f6fb5", "#8c3b4a", "#5d7a3a", "#b5653f", "#2f5f6a", "#7b5ac9"][v % 6], pants: "#3b3f52", boots: "#4a3426", skin: SKINS[v % 4] };
  return v % 2 ? { ...o, hat: "bonnet", dress: ["#d9a441", "#c25a7a", "#5a8fc2"][v % 3] } : { ...o, hat: "tophat" };
}, Pen = class {
  constructor(g) {
    __publicField(this, "g");
    __publicField(this, "ol", 12);
    /** [angle, cx, cy] rotation about (cx, cy), optional post-translation [.., dx, dy] */
    __publicField(this, "rot", null);
    this.g = g;
  }
  P(x, y) {
    if (!this.rot) return [x, y];
    let r = this.rot, a = r[0], cx = r[1], cy = r[2], dx = r.length > 3 ? r[3] : 0, dy = r.length > 4 ? r[4] : 0, c = Math.cos(a), s = Math.sin(a);
    return [cx + (x - cx) * c - (y - cy) * s + dx, cy + (x - cx) * s + (y - cy) * c + dy];
  }
  path(pts, close) {
    let g = this.g;
    g.beginPath(), pts.forEach((p, i) => {
      let [x, y] = this.P(p[0], p[1]);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }), close && g.closePath();
  }
  /** filled shape with an ink outline; fill=null draws the outline only */
  poly(pts, fill, ol) {
    let g = this.g, w = ol ?? this.ol;
    this.path(pts, !0), fill && (g.fillStyle = fill, g.fill()), w && (g.lineWidth = w, g.strokeStyle = INK, g.lineJoin = "round", g.stroke());
  }
  ell(cx, cy, rx, ry, fill, ol, a0 = 0, a1 = 360, rot = 0) {
    this.poly(ellPts(cx, cy, rx, ry, a0, a1, rot), fill, ol);
  }
  /** thick round-capped limb with an ink rim (effects, rope) */
  line(pts, fill, w, ink = !0) {
    let g = this.g;
    g.lineCap = "round", g.lineJoin = "round", ink && (this.path(pts, !1), g.strokeStyle = INK, g.lineWidth = w + 2 * this.ol * 0.9, g.stroke()), this.path(pts, !1), g.strokeStyle = fill, g.lineWidth = w, g.stroke();
  }
  stroke(pts, w, fill = INK) {
    let g = this.g;
    g.lineCap = "round", g.lineJoin = "round", this.path(pts, !1), g.strokeStyle = fill, g.lineWidth = w, g.stroke();
  }
  arc(cx, cy, rx, ry, a0, a1, w, fill = INK) {
    let pts = [];
    for (let i = 0; i <= 24; i++) pts.push([cx + rx * Math.cos(rad(a0 + (a1 - a0) * i / 24)), cy + ry * Math.sin(rad(a0 + (a1 - a0) * i / 24))]);
    this.stroke(pts, w, fill);
  }
  dot(cx, cy, r, fill = INK) {
    let [x, y] = this.P(cx, cy);
    this.g.beginPath(), this.g.arc(x, y, r, 0, Math.PI * 2), this.g.fillStyle = fill, this.g.fill();
  }
  /** draw with a closed shape as clip */
  clip(pts, fn) {
    let g = this.g;
    g.save(), this.path(pts, !0), g.clip(), fn(), g.restore();
  }
  /** flat fill + soft crescent on the side away from the light (light = canvas angle the light comes FROM).
   *  Radial ramp centred `shift` R toward the light: flat out to ~0.6 R on the far side, full shadow by ~0.8 R. */
  shadedFill(pts, base, shadow, light, R, shift = 0.45, r0 = 1.05, r1 = 1.25) {
    let g = this.g, n = pts.length, cx = 0, cy = 0;
    for (let [x, y] of pts)
      cx += x / n, cy += y / n;
    let [gx, gy] = this.P(cx + Math.cos(light) * shift * R, cy + Math.sin(light) * shift * R), gr = g.createRadialGradient(gx, gy, 0, gx, gy, r1 * R);
    gr.addColorStop(0, base), gr.addColorStop(r0 / r1, base), gr.addColorStop(1, shadow), this.path(pts, !0), g.fillStyle = gr, g.fill();
  }
  /** broad gradient across a shape along the light: lit edge = base, far edge = shadow (torsos, coats) */
  gradFill(pts, base, shadow, light, flat = 0.22) {
    let g = this.g, dx = Math.cos(light), dy = Math.sin(light), n = pts.length, cx = 0, cy = 0, lo = 1 / 0, hi = -1 / 0;
    for (let [x, y] of pts) {
      cx += x / n, cy += y / n;
      let d = x * dx + y * dy;
      lo = Math.min(lo, d), hi = Math.max(hi, d);
    }
    let dc = cx * dx + cy * dy, [ax, ay] = this.P(cx + dx * (hi - dc), cy + dy * (hi - dc)), [bx, by] = this.P(cx + dx * (lo - dc), cy + dy * (lo - dc)), gr = g.createLinearGradient(ax, ay, bx, by);
    gr.addColorStop(0, base), gr.addColorStop(flat, base), gr.addColorStop(1, shadow), this.path(pts, !0), g.fillStyle = gr, g.fill();
  }
  /** thick-thin ink ring: w(θ) = w0 (1 + k cos(θ − thick)), θ from the contour centroid (canvas angles) */
  inkRing(pts, w0, thick, k = 0.45, col = INK) {
    let n = pts.length, cx = 0, cy = 0;
    for (let [x, y] of pts)
      cx += x / n, cy += y / n;
    let out = [], inn = [];
    pts.forEach((q2, i) => {
      let a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], nx = b[1] - a[1], ny = a[0] - b[0], l = Math.hypot(nx, ny) || 1;
      nx /= l, ny /= l;
      let h = 0.5 * w0 * (1 + k * Math.cos(Math.atan2(q2[1] - cy, q2[0] - cx) - thick));
      out.push([q2[0] + nx * h, q2[1] + ny * h]), inn.push([q2[0] - nx * h, q2[1] - ny * h]);
    });
    let g = this.g, trace = (r) => {
      r.forEach(([x0, y0], i) => {
        let [x, y] = this.P(x0, y0);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }), g.closePath();
    };
    g.beginPath(), trace(out), trace(inn.reverse()), g.fillStyle = col, g.fill("evenodd");
  }
  /** flat strap with a thin ink rim (cross belts, sash, rifle, handles) */
  band(pts, fill, w, rim, cap = "butt") {
    let g = this.g;
    g.lineCap = cap, g.lineJoin = "round", this.path(pts, !1), g.strokeStyle = INK, g.lineWidth = w + 2 * rim, g.stroke(), this.path(pts, !1), g.strokeStyle = fill, g.lineWidth = w, g.stroke(), g.lineCap = "round";
  }
}, ellPts = (cx, cy, rx, ry, a0 = 0, a1 = 360, rot = 0, n = 48) => {
  let r = rad(rot), pts = [];
  for (let i = 0; i <= n; i++) {
    let a = rad(a0 + (a1 - a0) * i / n), x = rx * Math.cos(a), y = ry * Math.sin(a);
    pts.push([cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)]);
  }
  return pts;
}, rrect = (x0, y0, x1, y1, r, n = 8) => {
  let pts = [];
  for (let [cx, cy, a] of [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]])
    for (let i = 0; i <= n; i++) pts.push([cx + r * Math.cos(rad(a + 90 * i / n)), cy + r * Math.sin(rad(a + 90 * i / n))]);
  return pts;
}, taper = (p, a, b, wa, wb, col = INK) => {
  let dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  p.poly([
    [a[0] + nx * wa / 2, a[1] + ny * wa / 2],
    [b[0] + nx * wb / 2, b[1] + ny * wb / 2],
    [b[0] - nx * wb / 2, b[1] - ny * wb / 2],
    [a[0] - nx * wa / 2, a[1] - ny * wa / 2]
  ], col, 0), p.dot(a[0], a[1], wa / 2, col), p.dot(b[0], b[1], wb / 2, col);
}, blobPts = (cx, cy, B, n = 72) => {
  let ph = [rnd(B.seed, 11), rnd(B.seed, 12), rnd(B.seed, 13)].map((v) => v * Math.PI * 2), pts = [];
  for (let i = 0; i < n; i++) {
    let t = i / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), e = 2 / (s < 0 ? B.nTop : B.nBot), X = Math.sign(c) * Math.abs(c) ** e, Y = Math.sign(s) * Math.abs(s) ** e;
    X *= (1 + B.egg * Y) * (1 + B.asym * Math.sign(X));
    let r = 1 + B.noise * (Math.cos(2 * t + ph[0]) + 0.7 * Math.cos(3 * t + ph[1]) + 0.5 * Math.cos(4 * t + ph[2])), x = B.a * X * r, y = B.b * Y * r;
    pts.push([cx + x * Math.cos(B.rot) - y * Math.sin(B.rot), cy + x * Math.sin(B.rot) + y * Math.cos(B.rot)]);
  }
  return pts;
}, headBlob = (seed, a = 118, facing = 0) => ({
  a,
  b: a * (0.94 + 0.08 * (rnd(seed, 1) - 0.5)),
  nTop: 1.75 + 0.3 * (rnd(seed, 2) - 0.5),
  nBot: 2.3 + 0.3 * (rnd(seed, 3) - 0.5),
  egg: -0.12 + 0.06 * (rnd(seed, 4) - 0.5),
  asym: (0.06 + 0.04 * rnd(seed, 5)) * (facing || (rnd(seed, 6) < 0.5 ? -1 : 1)),
  rot: rad(8 * (rnd(seed, 7) - 0.5)),
  noise: 8e-3,
  seed
}), thickAngle = (light) => Math.atan2(-Math.sin(light) + 0.8, -Math.cos(light)), DEF_LIGHT = rad(-120), FACE = {
  neutral: { eye: ["lid", "lid"], brow: [0, -1], mouth: "dash" },
  stern: { eye: ["lid", "lid"], brow: [3, -2], mouth: "frown" },
  grin: { eye: ["happy", "happy"], brow: [-3, -3], mouth: "grin" },
  laugh: { eye: ["squeeze", "squeeze"], brow: [-4, -4], mouth: "laugh" },
  whistle: { eye: ["dash", "dash"], brow: [-2, -4], mouth: "o" },
  nervous: { eye: ["small", "small"], brow: [-3, 2], mouth: "wave" },
  shock: { eye: ["shock", "shock"], brow: [-7, -6], mouth: "O" },
  relief: { eye: ["happy", "happy"], brow: [-2, 1], mouth: "smileWide" },
  relief_open: { eye: ["happy", "happy"], brow: [-2, 1], mouth: "grin" },
  dazed: { eye: ["spiral", "spiral"], brow: [-3, 2], mouth: "wave" },
  pained: { eye: ["squeeze", "lid"], brow: [-3, 2], mouth: "teeth" },
  smile: { eye: ["dot", "dot"], brow: [0, -1], mouth: "smirk" },
  smile_closed: { eye: ["happy", "happy"], brow: [0, -1], mouth: "smile" },
  lick: { eye: ["dot", "dot"], brow: [0, -1], mouth: "lick" }
}, halfLid = (k) => k === "dot" || k === "small" ? "lid" : k === "lid" ? "slit" : k === "shock" ? "shockHalf" : k, eyeKind = (k, lid) => lid >= 1 && k !== "happy" && k !== "squeeze" && k !== "spiral" ? "dash" : lid > 0 ? halfLid(k) : k, lidOf = (b) => b === !0 ? 1 : Number(b) || 0, eye = (p, kind, x, ey, u, side, look, skin) => {
  let lx = x + look * 3 * u, lw = 3.8 * u;
  switch (kind) {
    case "dot":
      p.ell(lx, ey, 3.8 * u, 5.5 * u, INK, 0);
      break;
    case "small":
      p.ell(lx, ey, 3 * u, 4.4 * u, INK, 0);
      break;
    case "lid":
      p.ell(lx, ey - u, 7 * u, 6 * u, INK, 0, 0, 180), p.stroke([[x - 9 * u, ey - u], [x + 9 * u, ey - u]], lw);
      break;
    case "slit":
      p.ell(lx, ey, 7 * u, 2.6 * u, INK, 0, 0, 180), p.stroke([[x - 9 * u, ey], [x + 9 * u, ey]], lw);
      break;
    case "happy":
      p.arc(x, ey + 3 * u, 8 * u, 6 * u, 200, 340, lw);
      break;
    case "dash":
      p.stroke([[x - 8.5 * u, ey], [x + 8.5 * u, ey]], lw);
      break;
    case "squeeze":
      p.stroke([[x + 6 * u * side, ey - 5 * u], [x - 6 * u * side, ey], [x + 6 * u * side, ey + 5 * u]], lw);
      break;
    case "shock":
    case "shockHalf":
      p.ell(x, ey, 11 * u, 11 * u, WHITE, 2.6 * u), p.dot(lx - side * 1.5 * u, ey + 1.5 * u, 3 * u), kind === "shockHalf" && (p.ell(x, ey, 11 * u, 11 * u, skin, 0, 180, 360), p.stroke([[x - 11 * u, ey], [x + 11 * u, ey]], 2.6 * u));
      break;
    default: {
      let s = [];
      for (let t = 1; t < 15; t++) s.push([x + Math.cos(t * 0.9) * t * 0.55 * u, ey + Math.sin(t * 0.9) * t * 0.55 * u]);
      p.stroke(s, 2.4 * u);
    }
  }
}, dmouth = (p, mx, y, rx, ry, u, tongue = !1) => {
  p.ell(mx, y, rx, ry, MOUTH, 0, 0, 180), p.clip([[mx - rx, y], [mx + rx, y], [mx + rx, y + 3 * u], [mx - rx, y + 3 * u]], () => p.ell(mx, y, rx, ry, WHITE, 0, 0, 180)), tongue && p.ell(mx + 2 * u, y + 0.62 * ry, 0.4 * rx, 0.28 * ry, TONGUE, 0), p.ell(mx, y, rx, ry, null, 3 * u, 0, 180);
}, mouth = (p, kind, mx, my, u, k = 1) => {
  let mw = 4 * u;
  switch (kind) {
    case "dash":
      p.stroke([[mx - 5.5 * u * k, my], [mx + 5.5 * u * k, my - 0.8 * u]], mw);
      break;
    case "frown":
      p.arc(mx, my + 3 * u, 6.5 * u * k, 3.5 * u, 200, 340, mw);
      break;
    case "smirk":
      p.arc(mx + u, my - 3 * u, 7 * u * k, 4 * u, 10, 150, mw);
      break;
    case "smile":
      p.arc(mx, my - 3 * u, 8 * u * k, 4.5 * u, 20, 160, mw);
      break;
    case "smileWide":
      p.arc(mx, my - 4 * u, 11 * u * k, 6 * u, 15, 165, mw);
      break;
    case "grin":
      dmouth(p, mx, my - u, 12 * u * k, 8 * u, u);
      break;
    case "laugh":
      dmouth(p, mx, my, 16 * u * k, 11 * u, u, !0);
      break;
    case "o":
      p.ell(mx + 4 * u, my, 3.5 * u, 4 * u, MOUTH, 2.8 * u);
      break;
    case "O":
      p.ell(mx, my + 2 * u, 9 * u * k, 11 * u, MOUTH, 3.2 * u);
      break;
    case "wave": {
      let s = [];
      for (let i = 0; i <= 12; i++) s.push([mx - 9 * u * k + i * 1.5 * u * k, my + 1.5 * u * Math.sin(i * 1.3)]);
      p.stroke(s, 3 * u);
      break;
    }
    case "teeth":
      p.poly([[mx - 12 * u * k, my - 4 * u], [mx + 12 * u * k, my - 4 * u], [mx + 11 * u * k, my + 4 * u], [mx - 11 * u * k, my + 4 * u]], WHITE, 3 * u);
      for (let j of [-1, 0, 1]) p.stroke([[mx + j * 6 * u * k, my - 4 * u], [mx + j * 6 * u * k, my + 4 * u]], 1.5 * u);
      break;
    case "lick":
      p.arc(mx, my - 3 * u, 8 * u * k, 4.5 * u, 20, 160, mw), p.ell(mx + 6 * u * k, my + 3 * u, 3.6 * u, 4.6 * u, TONGUE, 2.4 * u);
      break;
  }
}, faceFront = (p, cx, cy, W, expr, facing, look, lid, brim, skin, moustache, stout = !1) => {
  let u = W / 100, F = FACE[expr], fx = cx + 7 * u * facing, ex = (F.eye[0] === "shock" ? 12 : 13) * u, ey = cy;
  for (let side of [-1, 1]) {
    let x = fx + side * ex, kind = eyeKind(F.eye[(facing ? side === facing : side > 0) ? 1 : 0], lid);
    eye(p, kind, x, ey, u, side, look, skin);
    let [dI, dO] = F.brow, by = ey - (brim ? 17 : 20) * u;
    kind === "shock" || kind === "shockHalf" ? p.arc(x, by - 6 * u, 9 * u, 3 * u, 200, 340, 4 * u) : taper(p, [x - side * 8.5 * u, by + dI * u], [x + side * 8.5 * u, by + dO * u], 5 * u, 2.5 * u);
  }
  let mx = cx + 8 * u * facing, my = cy + 20 * u;
  if (mouth(p, F.mouth, mx, my, u), moustache) for (let s of [-1, 1])
    taper(p, [mx + s * 1.5 * u, cy + 12.5 * u], [mx + s * (stout ? 19 : 15) * u, cy + (stout ? 10.5 : 15) * u], stout ? 5.5 * u : 4.5 * u, 1.6 * u, moustache);
  expr === "nervous" && p.ell(cx + 40 * u * (facing || 1), cy - 22 * u, 3 * u, 5 * u, "#9fd4ff", 2 * u);
}, faceSide = (p, hx, hy, W, expr, lid, brim, skin, moustache, stout = !1) => {
  let u = W / 100, F = FACE[expr], ex = hx + 27 * u, ey = hy, kind = eyeKind(F.eye[1], lid);
  eye(p, kind, ex, ey, u, 1, 0.6, skin);
  let by = ey - (brim ? 17 : 20) * u, [dI, dO] = F.brow;
  kind === "shock" || kind === "shockHalf" ? p.arc(ex, by - 6 * u, 9 * u, 3 * u, 200, 340, 4 * u) : taper(p, [ex + 8 * u, by + dI * u], [ex - 7 * u, by - u + dO * u], 5 * u, 2.5 * u), p.stroke([[hx + 44 * u, hy + 4 * u], [hx + 47.5 * u, hy + 9 * u], [hx + 43 * u, hy + 10 * u]], 3 * u), mouth(p, F.mouth, hx + 33 * u, hy + 21 * u, u, 0.62), moustache && taper(p, [hx + 41 * u, hy + 13.5 * u], [hx + 25 * u, hy + (stout ? 11.5 : 16) * u], stout ? 5.5 * u : 4.5 * u, 1.6 * u, moustache), expr === "nervous" && p.ell(hx - 30 * u, hy - 24 * u, 3 * u, 5 * u, "#9fd4ff", 2 * u);
}, BONNET = "#e9cf8f", BONNET_BRIM = "#d6b46a", hatBehind = (p, o, H, cx, hc, light, thick, ow, side) => {
  if (o.hat !== "bonnet") return;
  let bb = blobPts(cx - (side ? 12 : 0) * (H.a / 50), hc - 0.07 * 2 * H.b, { ...H, a: H.a * 1.17, b: H.b * 1.13, asym: 0, egg: 0.04, seed: H.seed + 3 });
  p.shadedFill(bb, BONNET, mul(BONNET, SH_CLOTH), light, H.a * 1.17), p.inkRing(bb, ow * 0.85, thick);
}, hatOn = (p, o, hp, H, cx, hc, light, seed, facing, side) => {
  let W = 2 * H.a, HH = 2 * H.b, u = W / 100, crown = hc - H.b, ow = 0.85 * 5 * u, a = H.rot + rad(4 * (rnd(seed, 20) - 0.5)), R = (pts) => rotPts(pts, a, cx, hc), sag = (yb, wb) => {
    let base = [];
    for (let i = 0; i <= 12; i++) {
      let t = i / 12;
      base.push([cx + wb * (2 * t - 1), yb + 3 * u * (1 - (2 * t - 1) ** 2)]);
    }
    return base;
  };
  if (o.hat === "shako" || o.hat === "shako_tall") {
    let tall = o.hat === "shako_tall", yb = crown + 0.25 * HH, ht = (tall ? 0.66 : 0.56) * HH, wb = 46 * u, wt = 52 * u, body = R([...sag(yb, wb).reverse(), [cx - wt, yb - ht], [cx + wt, yb - ht]]);
    p.shadedFill(body, "#3a3d47", "#24262d", light, wt, 0.4), tall && p.clip(body, () => p.band(R([[cx - wt - 5 * u, yb - ht + 0.07 * HH], [cx + wt + 5 * u, yb - ht + 0.07 * HH]]), "#e8c45a", 0.06 * HH, 1.5 * u)), p.poly(body, null, ow);
    let deg = a * 180 / Math.PI;
    if (side) {
      p.poly(R([[cx + 36 * u, yb - 1 * u], [cx + 60 * u, yb + 8 * u], [cx + 34 * u, yb + 6 * u]]), "#16171b", 2.5 * u);
      let [tx, ty] = R([[cx + 24 * u, yb - ht - 6 * u]])[0];
      p.ell(tx, ty, 7 * u, 7 * u, "#2b7a4b", 2.5 * u);
    } else {
      let [px, py] = R([[cx + 3 * u * facing, yb + 3 * u]])[0];
      p.ell(px, py, 34 * u, 0.045 * HH, "#16171b", 2.5 * u, 0, 180, deg);
      let [bx, by] = R([[cx, yb - 0.45 * ht]])[0];
      p.ell(bx, by, 7 * u, 6 * u, tall ? "#e8c45a" : "#c9ccd2", 2 * u, 0, 360, deg), p.arc(bx, by, 3.5 * u, 2.8 * u, 200, 500, 1.6 * u);
      let [tx, ty] = R([[cx, yb - ht - 6 * u]])[0];
      p.ell(tx, ty, 7 * u, 7 * u, "#2b7a4b", 2.5 * u);
    }
  } else if (o.hat === "cap" || o.hat === "hair") {
    let cut = crown + (o.hat === "cap" ? 0.3 : 0.42) * HH, keep = (x, y) => y < cut || side && o.hat === "hair" && x < cx - 6 * u && y < hc + 0.42 * H.b, n = hp.length, startIdx = Math.max(0, hp.findIndex(([x, y], i) => keep(x, y) && !keep(hp[(i + n - 1) % n][0], hp[(i + n - 1) % n][1]))), arc = [...hp.slice(startIdx), ...hp.slice(0, startIdx)].filter(([x, y]) => keep(x, y)).map(([x, y]) => [cx + (x - cx) * 1.03, hc + (y - hc) * 1.03]);
    if (arc.length < 3) return;
    if (o.hat === "hair") {
      let [x0, y0] = arc[arc.length - 1], [x1, y1] = arc[0];
      for (let i = 1; i < 6; i++) arc.push([x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6 + (i % 2 ? 4 * u : 0)]);
    }
    let col = o.hat === "cap" ? o.cap : o.hair;
    if (p.shadedFill(arc, col, mul(col, SH_FELT), light, H.a, 0.35), p.poly(arc, null, ow), o.hat === "hair") {
      let s = side ? -1 : facing || 1;
      p.stroke([[cx + s * 10 * u, cut - 30 * u], [cx + s * 2 * u, cut - 12 * u]], 1.2 * u);
    }
    if (o.hat === "cap") {
      let deg = a * 180 / Math.PI;
      if (side) p.poly(R([[cx + 40 * u, cut - 2 * u], [cx + 74 * u, cut + 4 * u], [cx + 40 * u, cut + 6 * u]]), shade(col, 0.8), ow);
      else {
        let s = facing || (rnd(seed, 21) < 0.5 ? -1 : 1), [px, py] = R([[cx + s * 4 * u, cut + 1.5 * u]])[0];
        p.ell(px, py, 32 * u, 0.06 * HH, shade(col, 0.8), ow, 0, 180, deg);
      }
    }
  } else if (o.hat === "tophat") {
    let yb = crown + 0.22 * HH, ht = 0.8 * HH, wb = 0.31 * W, wt = 0.33 * W, col = "#2e2a36", body = R([...sag(yb, wb).reverse(), [cx - wt, yb - ht], [cx + wt, yb - ht]]);
    p.shadedFill(body, col, mul(col, SH_FELT), light, wt, 0.4), p.clip(body, () => p.band(R([[cx - wt - 4 * u, yb - 0.13 * HH], [cx + wt + 4 * u, yb - 0.13 * HH]]), shade(o.jacket, 0.9), 0.14 * HH, 0.8 * u)), p.poly(body, null, ow);
    let [bx, by] = R([[cx, yb + 1 * u]])[0];
    p.ell(bx, by, 0.45 * W, 0.05 * HH, "#1d1b22", ow, 0, 360, a * 180 / Math.PI);
  } else if (o.hat === "bonnet") {
    let [bx, by] = R([[cx + (side ? 6 * u : 0), crown + 0.16 * HH]])[0];
    p.arc(bx, by, 0.5 * W, 0.2 * HH, 200, 340, 7 * u, BONNET_BRIM), p.arc(bx, by, 0.5 * W + 3.5 * u, 0.2 * HH + 3.5 * u, 200, 340, 1.2 * u);
    let cy = hc + H.b * 0.98;
    p.stroke([[cx - 14 * u, cy - 4 * u], [cx, cy + 2 * u], [cx + 14 * u, cy - 4 * u]], 2 * u, BONNET_BRIM);
  }
}, BUILD = {
  adult: { a: 118, torso: 1.1, legs: 1.4, tw: 0.8 },
  stout: { a: 118, torso: 1.15, legs: 1.32, tw: 0.92 },
  kid: { a: 112, torso: 0.85, legs: 1, tw: 0.72 }
}, footStroke = (p, a, b, w, col) => {
  col !== INK && p.stroke([a, b], w + 3, INK), p.stroke([a, b], w, col);
}, bodyFront = (p, o, opts) => {
  let {
    phase = 0,
    expr = "neutral",
    mode = "march",
    look = 0,
    blink: blink2 = !1,
    lift = 60,
    prop = null,
    tilt = 0,
    headTilt = 0,
    wave,
    light = DEF_LIGHT,
    facing = 0,
    seed = 1
  } = opts, Bd = BUILD[o.build ?? "adult"], skin = o.skin ?? SKIN, two = Math.PI * 2, lid = lidOf(blink2), H = headBlob(seed, Bd.a, facing), W = 2 * H.a, HH = 2 * H.b, u = W / 100, tall = (1 + Bd.torso + Bd.legs) * HH, sole = 975, bob = mode === "march" ? 0.025 * tall * Math.cos(2 * two * phase) : mode === "stroll" ? 0.015 * tall * Math.cos(2 * two * phase) : 0, torsoBot = mode === "sit" ? sole - 0.2 * HH : sole - Bd.legs * HH + bob, chin = torsoBot - Bd.torso * HH, hc = chin - H.b, crown = hc - H.b, hipY = torsoBot - 0.12 * HH, thick = thickAngle(light), ow = 5 * u, legCol = mix(o.pants, INK, 0.55), armCol = mix(o.jacket, INK, 0.5), footCol = o.boots, legW = 5.8 * u, footW = 7.5 * u;
  if (p.rot = null, mode === "sit")
    for (let side of [-1, 1]) {
      let h = [300 + side * 15 * u, hipY], k = [300 + side * 36 * u, hipY + 0.2 * HH], f = [300 + side * 44 * u, sole - 8 * u];
      p.stroke(curve(h, k, f), legW, legCol), footStroke(p, [f[0] - side * 2 * u, f[1]], [f[0] + side * 12 * u, f[1] - 5 * u], footW, footCol);
    }
  else if (mode === "fall")
    [
      [[300 - 15 * u, hipY], [300 - 46 * u, hipY + 0.5 * HH], [300 - 70 * u, hipY + 0.72 * HH]],
      [[300 + 15 * u, hipY], [300 + 50 * u, hipY + 0.45 * HH], [300 + 76 * u, hipY + 0.22 * HH]]
    ].forEach(([h, k, f], i) => {
      p.stroke(curve(h, k, f), legW, legCol), footStroke(p, f, [f[0] + (i ? 14 : -14) * u, f[1] + (i ? -6 : 4) * u], footW, footCol);
    });
  else if (o.dress)
    for (let side of [-1, 1]) {
      let fx = 300 + side * 12 * u, fy = sole - 4 * u;
      p.stroke([[fx, sole - 0.4 * HH], [fx + side * u, fy]], legW, legCol), footStroke(p, [fx - side * 3 * u, fy], [fx + side * 12 * u, fy + u], footW, footCol);
    }
  else {
    let L = mode === "march" ? lift * 1.25 : mode === "stroll" ? lift * 0.55 : 0;
    for (let [side, ph] of [[-1, 0], [1, 0.5]]) {
      let up = Math.max(0, Math.sin(two * (phase + ph))) * L, hx = 300 + side * 15 * u, fx = 300 + side * 22 * u, fy = sole - 4 * u - up, k = [(hx + fx) / 2 + side * (1.5 * u + up * 0.16), (hipY + fy) / 2 - up * 0.08];
      p.stroke(curve([hx, hipY], k, [fx, fy]), legW, legCol), footStroke(p, [fx - side * 3 * u, fy], [fx + side * 13 * u, fy + 0.5 * u], footW, footCol);
    }
  }
  let sway = mode === "march" ? 1.6 * Math.sin(two * phase) : mode === "stroll" ? 1 * Math.sin(two * phase) : 0, A = tilt + sway;
  p.rot = A ? [rad(A), 300, hipY] : null;
  let dress = !!o.dress && mode !== "sit" && mode !== "fall", T = {
    a: Bd.tw / 2 * W / 1.06,
    b: 0.5 * (torsoBot - (chin - 0.25 * HH)),
    nTop: 2.2,
    nBot: 2.6,
    egg: o.build === "stout" ? 0.17 : 0.12,
    asym: 0.04 * facing,
    rot: 0,
    noise: 6e-3,
    seed: seed + 7
  }, tcx = 300 + 3 * u * facing, tcy = torsoBot - T.b, tp = blobPts(tcx, tcy, T), sh = (side) => [tcx + side * 0.85 * T.a, chin + 0.12 * HH], hang = (side, fwd) => {
    let S = sh(side), ex = tcx + side * (1.12 * T.a + 4 * u), hx = ex + side * 3 * u - side * 6 * u * Math.max(0, fwd) + side * 4 * u * Math.max(0, -fwd);
    return [S, [ex, S[1] + 0.48 * HH], [hx, chin + 1.04 * HH - Math.abs(fwd) * 9 * u]];
  }, sw = mode === "march" || mode === "stroll" ? Math.sin(two * phase) : 0, R0 = [300 + 47 * u, torsoBot + 0.12 * HH], R1 = [300 + 64 * u, crown - 0.32 * HH], rifle = !!o.rifle && (mode === "march" || mode === "stand" || mode === "stroll"), arms = [];
  if (mode === "sit") for (let side of [-1, 1]) arms.push({ pts: [sh(side), [tcx + side * (1.1 * T.a + 6 * u), sh(side)[1] + 0.4 * HH], [tcx + side * (1.2 * T.a + 10 * u), torsoBot + 0.04 * HH]], front: !1 });
  else if (mode === "fall") for (let side of [-1, 1]) arms.push({ pts: [sh(side), [tcx + side * (1.15 * T.a + 12 * u), sh(side)[1] - 0.25 * HH], [tcx + side * (1.3 * T.a + 24 * u), sh(side)[1] - 0.68 * HH]], front: !1 });
  else if (arms.push({ pts: prop === "shako" ? hang(-1, 0) : hang(-1, -sw), front: !1 }), rifle) {
    let G = lerp2(R0, R1, 0.1);
    arms.push({ pts: [sh(1), [tcx + 1.12 * T.a + 5 * u, sh(1)[1] + 0.45 * HH], G], front: !1 });
  } else if (wave !== void 0) {
    let S = sh(1);
    arms.push({ pts: [S, [tcx + 1.1 * T.a + 10 * u + 3 * u * wave, S[1] - 0.22 * HH], [tcx + 1.18 * T.a + 16 * u + 12 * u * wave, S[1] - 0.6 * HH]], front: !1 });
  } else if (prop === "icecream") {
    let S = sh(1);
    arms.push({ pts: [S, [tcx + 1.05 * T.a + 4 * u, S[1] + 0.45 * HH], [tcx + 0.5 * T.a, S[1] + 0.4 * HH]], front: !0 });
  } else if (Array.isArray(prop)) {
    let S = sh(1), k = clamp(prop[1], 0, 1), E = lerp2([tcx + 1.1 * T.a + 10 * u, S[1] - 0.15 * HH], [tcx + 1.2 * T.a + 10 * u, S[1] + 0.3 * HH], k), Hd = lerp2([tcx + 1.15 * T.a + 14 * u, S[1] - 0.55 * HH], [tcx + 1.45 * T.a + 22 * u, S[1] + 0.35 * HH], k);
    arms.push({ pts: [S, E, Hd], front: !0 });
  } else arms.push({ pts: hang(1, sw), front: !1 });
  let drawArm = (a) => {
    p.stroke(curve(a.pts[0], a.pts[1], a.pts[2]), 5.2 * u, armCol), p.dot(a.pts[2][0], a.pts[2][1], 5.5 * u);
  };
  if (rifle && (p.band([R0, R1], "#7a4b2a", 5 * u, 1.5 * u, "round"), p.band([lerp2(R0, R1, 0.6), R1], "#8d949c", 2.4 * u, 1.2 * u, "round")), o.sword && mode !== "sit") {
    let s0 = [tcx - 0.75 * T.a, torsoBot - 0.2 * HH];
    p.band([s0, [s0[0] - Math.sin(rad(25)) * 0.8 * HH, s0[1] + Math.cos(rad(25)) * 0.8 * HH]], "#c9ccd2", 3 * u, 1.2 * u, "round");
  }
  for (let a of arms) a.front || drawArm(a);
  if (dress) {
    let D = { a: 0.5 * W * 0.98, b: 0.5 * (sole - 0.35 * HH - (chin - 0.2 * HH)), nTop: 2, nBot: 3, egg: 0.35, asym: 0.03 * facing, rot: 0, noise: 6e-3, seed: seed + 9 }, dp = blobPts(300, sole - 0.35 * HH - D.b, D);
    p.gradFill(dp, o.dress, mul(o.dress, SH_CLOTH), light), p.inkRing(dp, ow, thick);
    let Sw = { a: 0.37 * W, b: 0.3 * HH, nTop: 2.2, nBot: 2.4, egg: 0.1, asym: 0, rot: 0, noise: 6e-3, seed: seed + 8 }, sp = blobPts(300, chin + 0.12 * HH, Sw);
    p.gradFill(sp, o.jacket, mul(o.jacket, SH_CLOTH), light), p.inkRing(sp, ow * 0.9, thick);
  } else {
    if (p.gradFill(tp, o.jacket, mul(o.jacket, SH_CLOTH), light), p.clip(tp, () => {
      if (o.belt) {
        for (let s of [-1, 1]) p.band([[tcx - s * 0.75 * T.a, chin - 0.05 * HH], [tcx + s * 0.8 * T.a, torsoBot - 0.1 * HH]], o.belt, 5.5 * u, 1.8 * u);
        let xc = tcx + 0.025 * T.a, yc = chin - 0.05 * HH + (torsoBot - 0.1 * HH - (chin - 0.05 * HH)) * (0.75 / 1.55);
        p.poly([[xc - 3.5 * u, yc - 3.5 * u], [xc + 3.5 * u, yc - 3.5 * u], [xc + 3.5 * u, yc + 3.5 * u], [xc - 3.5 * u, yc + 3.5 * u]], "#d9dde0", 1.5 * u);
      }
      o.sash && p.band([[tcx - 1.3 * T.a, torsoBot - 0.32 * HH], [tcx + 1.3 * T.a, torsoBot - 0.32 * HH]], o.sash, 0.13 * HH, 1.8 * u);
      for (let i = 0; i < 4; i++) {
        let y = chin + 0.12 * HH + i * 0.2 * HH;
        o.sash && Math.abs(y - (torsoBot - 0.32 * HH)) < 0.08 * HH || (p.dot(tcx + 2 * u * facing, y, 2.2 * u + 0.8 * u, INK), p.dot(tcx + 2 * u * facing, y, 2.2 * u, o.buttons ?? shade(o.jacket, 0.7)));
      }
    }), o.sash) {
      let s = facing || 1;
      p.poly([[tcx + s * 0.55 * T.a, torsoBot - 0.3 * HH], [tcx + s * 0.75 * T.a, torsoBot + 0.05 * HH], [tcx + s * 0.45 * T.a, torsoBot + 0.02 * HH]], o.sash, 1.6 * u);
    }
    p.inkRing(tp, ow, thick);
  }
  for (let a of arms) if (a.front) {
    drawArm(a);
    let [hx, hy] = a.pts[2];
    if (prop === "icecream")
      p.poly([[hx - 8 * u, hy - 12 * u], [hx + 8 * u, hy - 12 * u], [hx, hy + 7 * u]], "#e0a35a", 1.8 * u), p.ell(hx, hy - 19 * u, 11 * u, 10 * u, "#f7c6d9", 2.2 * u), p.dot(hx, hy, 5.5 * u);
    else if (Array.isArray(prop)) {
      let ang = rad(-70 + 105 * clamp(prop[1], 0, 1)), Rh = (pts) => rotPts(pts, ang, hx, hy);
      p.band(Rh([[hx, hy + 12 * u], [hx, hy - 44 * u]]), "#8a5a34", 5 * u, 1.5 * u, "round"), p.poly(Rh([[hx - 12 * u, hy - 58 * u], [hx + 20 * u, hy - 58 * u], [hx + 20 * u, hy - 42 * u], [hx - 12 * u, hy - 42 * u]]), "#7d848c", 2.2 * u), p.dot(hx, hy, 5.5 * u);
    }
  }
  if (prop === "shako") {
    let [hx, hy] = arms[0].pts[2];
    p.poly([[hx - 14 * u, hy + 3 * u], [hx + 14 * u, hy + 3 * u], [hx + 16 * u, hy + 30 * u], [hx - 16 * u, hy + 30 * u]], "#3a3d47", 2.2 * u), p.ell(hx, hy + 31 * u, 3.5 * u, 3.5 * u, "#2b7a4b", 1.5 * u), p.dot(hx, hy, 5.5 * u);
  }
  let Ah = A + headTilt, [cpx, cpy] = rotAbout([300, chin], rad(A), [300, hipY]);
  p.rot = Ah ? [rad(Ah), 300, chin, cpx - 300, cpy - chin] : null, hatBehind(p, o, H, 300, hc, light, thick, ow, !1);
  let hp = blobPts(300, hc, H);
  p.shadedFill(hp, skin, mul(skin, SH_SKIN), light, H.a), p.inkRing(hp, ow, thick), hatOn(p, o, hp, H, 300, hc, light, seed, facing, !1);
  let brim = !!o.hat && o.hat !== "hair" && o.hat !== "bonnet" && o.hat !== "cap";
  faceFront(p, 300, hc, W, expr, facing, look, lid, brim, skin, o.moustache, o.build === "stout"), p.rot = null;
}, ik = (hip, ank, l1, l2) => {
  let dx = ank[0] - hip[0], dy = ank[1] - hip[1], d = clamp(Math.hypot(dx, dy), 1, l1 + l2 - 0.01), A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)), k = Math.atan2(dy, dx) - A;
  return [hip[0] + l1 * Math.cos(k), hip[1] + l1 * Math.sin(k)];
}, SWING_HIP = 733, bodySide = (p, o, opts) => {
  let { phase = 0, expr = "neutral", mode = "march", blink: blink2 = !1, stomp = 1, pose = 0, stride = 1, light = DEF_LIGHT, seed = 1 } = opts, Bd = BUILD[o.build ?? "adult"], skin = o.skin ?? SKIN, two = Math.PI * 2, lid = lidOf(blink2), H = { ...headBlob(seed, Bd.a, 1), asym: 0.12, rot: rad(3 + 3 * (rnd(seed, 7) - 0.5)) }, W = 2 * H.a, HH = 2 * H.b, u = W / 100, sole = 975, ankY = sole - 4 * u, thick = thickAngle(light), ow = 5 * u, legLen = (Bd.legs + 0.12) * HH - 4 * u, l1 = legLen / 2, l2 = legLen / 2, nearCol = mix(o.pants, INK, 0.55), farCol = mix(o.pants, INK, 0.75), footCol = o.boots, legs = [], hipY = ankY - legLen * 0.995, lean = 0, nearFwd = 0;
  if (mode === "march") {
    let S2 = 370 * stride, liftH = Math.max(22, 40 + 70 * (stomp - 1)), st = (ph) => {
      let c = ((phase + ph) % 1 + 1) % 1;
      if (c < 0.5) {
        let s2 = c / 0.5;
        return { x: S2 / 2 - S2 * s2, h: 0, stance: !0, s: s2 };
      }
      let s = (c - 0.5) / 0.5;
      return { x: -S2 / 2 + S2 * s - S2 / Math.PI * Math.sin(2 * Math.PI * s), h: liftH * Math.sin(Math.PI * s), stance: !1, s };
    }, nL = st(0), fL = st(0.5), stance = nL.stance ? nL : fL, Leff = legLen * (1 - 0.035 * Math.sin(Math.PI * stance.s));
    hipY = ankY - Math.sqrt(Math.max(1, Leff * Leff - stance.x * stance.x));
    for (let [L, near2] of [[fL, !1], [nL, !0]])
      legs.push({ ank: [300 + L.x, ankY - L.h], pitch: L.stance ? 0 : rad(35 * Math.sin(Math.PI * L.s) * (1 - 1.6 * L.s)), near: near2 });
    lean = 4 + 3 * Math.cos(2 * two * phase), nearFwd = nL.x / (S2 / 2);
  } else if (mode === "push")
    hipY = ankY - 0.87 * legLen, legs.push({ ank: [300 - 0.5 * legLen, ankY], pitch: rad(-8), near: !1 }, { ank: [300 + 0.32 * legLen, ankY], pitch: 0, near: !0 }), lean = 14 * pose;
  else if (mode === "swing") {
    hipY = SWING_HIP;
    let a = rad(60 * pose);
    for (let [dx, near2] of [[-6, !1], [0, !0]]) {
      let knee = [300 + l1 * 0.98 + dx * u, hipY + 6 * u];
      legs.push({ ank: [knee[0] + l2 * Math.sin(a), knee[1] + l2 * Math.cos(a)], pitch: -a * 0.5, near: near2 });
    }
  } else
    legs.push({ ank: [300 - 4 * u, ankY], pitch: 0, near: !1 }, { ank: [300 + 4 * u, ankY], pitch: 0, near: !0 });
  let torsoBot = hipY + 0.12 * HH, chin = torsoBot - Bd.torso * HH, hc = chin - H.b, crown = hc - H.b, hip = [300, hipY];
  p.rot = null;
  for (let L of legs) {
    let knee = mode === "swing" ? [300 + l1 * 0.98 + (L.near ? 0 : -6 * u), hipY + 6 * u] : ik(hip, L.ank, l1, l2), hp0 = [300 + (L.near ? 0 : -5 * u), hipY];
    p.stroke([hp0, knee, L.ank], 5.8 * u, L.near ? nearCol : farCol);
    let c = Math.cos(L.pitch), s = Math.sin(L.pitch);
    footStroke(
      p,
      [L.ank[0] - 3 * u * c, L.ank[1] - 3 * u * s],
      [L.ank[0] + 13 * u * c, L.ank[1] + 13 * u * s + 0.5 * u],
      7.5 * u,
      L.near ? footCol : footCol === INK ? INK : shade(footCol, 0.82)
    );
  }
  p.rot = lean ? [rad(lean), 300, hipY] : null;
  let T = {
    a: (o.build === "stout" ? 0.36 : 0.31) * W,
    b: 0.5 * (torsoBot - (chin - 0.25 * HH)),
    nTop: 2.2,
    nBot: 2.5,
    egg: 0.1,
    asym: 0.06,
    rot: 0,
    noise: 6e-3,
    seed: seed + 7
  }, tcx = 300 + 2 * u, tcy = torsoBot - T.b, tp = blobPts(tcx, tcy, T), armCol = mix(o.jacket, INK, 0.5), farArm = mix(o.jacket, INK, 0.68), S = [tcx + 0.05 * T.a, chin + 0.14 * HH], aLen = 0.95 * HH, swingArm = (ang) => {
    let e = [S[0] + Math.sin(ang) * aLen * 0.5, S[1] + Math.cos(ang) * aLen * 0.5], a2 = ang + rad(16) * Math.sign(ang || 1);
    return [S, e, [e[0] + Math.sin(a2) * aLen * 0.5, e[1] + Math.cos(a2) * aLen * 0.5]];
  }, rifle = !!o.rifle && (mode === "march" || mode === "stand"), B0 = [tcx + 0.72 * T.a, chin + 0.58 * HH], B1 = [tcx - 0.95 * T.a - 22 * u, crown - 0.4 * HH], near, far;
  if (mode === "swing")
    near = [S, [S[0] + 12 * u, S[1] - 0.16 * HH], [300 + 6 * u, chin - 0.3 * HH]], far = [S, [S[0] + 8 * u, S[1] - 0.18 * HH], [300 + 2 * u, chin - 0.36 * HH]];
  else if (mode === "push") {
    let reach = 0.55 * HH + 0.45 * HH * pose, hN = [S[0] + reach, S[1] + 0.06 * HH];
    if (opts.hand) {
      let th = -rad(lean), dx = opts.hand[0] - 300, dy = opts.hand[1] - hipY, tg = [300 + dx * Math.cos(th) - dy * Math.sin(th), hipY + dx * Math.sin(th) + dy * Math.cos(th)];
      hN = [hN[0] + (tg[0] - hN[0]) * pose, hN[1] + (tg[1] - hN[1]) * pose];
    }
    near = [S, [(S[0] + hN[0]) / 2, (S[1] + hN[1]) / 2 + 0.06 * HH], hN], far = [S, [(S[0] + hN[0]) / 2 - 4 * u, (S[1] + hN[1]) / 2 - 0.02 * HH], [hN[0] - 6 * u, hN[1] - 0.08 * HH]];
  } else rifle ? (near = [S, [S[0] - 4 * u, S[1] + 0.42 * HH], B0], far = swingArm(mode === "march" ? rad(30) * nearFwd : 0)) : (near = swingArm(rad(-30) * nearFwd), far = mode === "march" ? swingArm(rad(30) * nearFwd) : null);
  far && (p.stroke(curve(far[0], far[1], far[2]), 5.2 * u, farArm), p.dot(far[2][0], far[2][1], 5.5 * u)), p.gradFill(tp, o.jacket, mul(o.jacket, SH_CLOTH), light), p.clip(tp, () => {
    if (o.belt && p.band([[tcx - 0.65 * T.a, chin - 0.05 * HH], [tcx + 0.75 * T.a, torsoBot - 0.1 * HH]], o.belt, 5.5 * u, 1.8 * u), o.sash && p.band([[tcx - 1.3 * T.a, torsoBot - 0.32 * HH], [tcx + 1.3 * T.a, torsoBot - 0.32 * HH]], o.sash, 0.13 * HH, 1.8 * u), !o.dress) for (let i = 0; i < 3; i++) {
      let y = chin + 0.16 * HH + i * 0.24 * HH;
      p.dot(tcx + 0.8 * T.a, y, 3 * u, INK), p.dot(tcx + 0.8 * T.a, y, 2.2 * u, o.buttons ?? shade(o.jacket, 0.7));
    }
  }), p.inkRing(tp, ow, thick), rifle && (p.band([B0, B1], "#7a4b2a", 5 * u, 1.5 * u, "round"), p.band([lerp2(B0, B1, 0.6), B1], "#8d949c", 2.4 * u, 1.2 * u, "round")), p.stroke(curve(near[0], near[1], near[2]), 5.2 * u, armCol), p.dot(near[2][0], near[2][1], 5.5 * u);
  let hx = 300 + 4 * u;
  hatBehind(p, o, H, hx, hc, light, thick, ow, !0);
  let hp = blobPts(hx, hc, H);
  p.shadedFill(hp, skin, mul(skin, SH_SKIN), light, H.a), p.inkRing(hp, ow, thick), hatOn(p, o, hp, H, hx, hc, light, seed, 1, !0);
  let brim = !!o.hat && o.hat !== "hair" && o.hat !== "bonnet" && o.hat !== "cap";
  faceSide(p, hx, hc, W, expr, lid, brim, skin, o.moustache, o.build === "stout"), p.rot = null;
};
var fxNote = (p, kind, col = "#1f2a44") => {
  p.ell(70, 200, 46, 34, col, 8, 0, 360, -20), p.stroke([[110, 190], [110, 40]], 14), kind === 0 ? p.poly([[110, 40], [170, 70], [170, 110], [110, 82]], col, 8) : (p.ell(150, 170, 40, 30, col, 8, 0, 360, -20), p.stroke([[186, 160], [186, 20]], 14), p.poly([[110, 40], [186, 20], [186, 50], [110, 70]], col, 8));
}, fxBurst = (p, t, col = "#fff3b0", rays = 10, r0 = 40, r1 = 230) => {
  let e = 1 - (1 - t) ** 3;
  for (let i = 0; i < rays; i++) {
    let a = rad(i * 360 / rays + 7 * (i % 2)), ra = r0 + (r1 - r0) * e * (0.75 + 0.25 * (i % 2));
    p.poly([
      [250 + r0 * 0.5 * Math.cos(a + 0.18), 250 + r0 * 0.5 * Math.sin(a + 0.18)],
      [250 + ra * Math.cos(a), 250 + ra * Math.sin(a)],
      [250 + r0 * 0.5 * Math.cos(a - 0.18), 250 + r0 * 0.5 * Math.sin(a - 0.18)]
    ], col, Math.max(3, 8 * (1 - t)));
  }
  t < 0.5 && p.ell(250, 250, r0 * (1.4 - t), r0 * (1.4 - t), WHITE, 8);
}, fxSplash = (p, t) => {
  let rise = Math.sin(Math.min(1, t * 1.3) * Math.PI), blue = "#bfe8ff", deep = "#6cc0f0";
  if (rise > 0.02) {
    let pts = [];
    for (let i = 0; i < 19; i++) {
      let h = (i % 2 ? 260 : 130) * rise * (0.7 + 0.3 * Math.sin(i * 1.7));
      pts.push([70 + 660 * i / 18, 680 - h]);
    }
    p.poly([...pts, [730, 710], [70, 710]], blue, 10), p.ell(400, 700, 360, 46, deep, 10);
  }
  for (let i = 0; i < 8; i++) {
    let a = rad(200 + i * 18), d = 120 + 380 * t, y = 640 + d * Math.sin(a) + 520 * t * t, r = 26 * (1 - t) + 6;
    t > 0.08 && y < 760 && p.ell(400 + d * Math.cos(a), y, r, r * 1.25, blue, 7);
  }
}, fxPuff = (p, t) => {
  for (let i = 0; i < 5; i++) {
    let a = rad(160 + i * 55), d = 40 + 70 * t, r = (34 + 20 * (i % 2)) * (1 - 0.6 * t);
    p.ell(150 + d * Math.cos(a), 180 + d * 0.45 * Math.sin(a), r, r * 0.8, `rgba(238,225,205,${(1 - t).toFixed(3)})`, 0);
  }
}, fxStars = (p, t) => {
  for (let i = 0; i < 4; i++) {
    let a = t * Math.PI * 2 + i * Math.PI / 2, x = 210 + 150 * Math.cos(a), y = 110 + 40 * Math.sin(a), pts = [];
    for (let k = 0; k < 10; k++) {
      let r = k % 2 ? 14 : 34, b = rad(k * 36 - 90);
      pts.push([x + r * Math.cos(b), y + r * Math.sin(b)]);
    }
    p.poly(pts, "#ffd84a", 6);
  }
}, fxCreak = (p, t) => {
  let j = 6 * Math.sin(t * 40);
  for (let a of [-30, 0, 30]) {
    let b = rad(a - 90);
    p.stroke([
      [150 + 70 * Math.cos(b) + j, 230 + 70 * Math.sin(b)],
      [150 + 100 * Math.cos(b) + 10 + j, 230 + 100 * Math.sin(b)],
      [150 + 130 * Math.cos(b) + j, 230 + 130 * Math.sin(b)]
    ], 10);
  }
}, fxRing = (p, t) => {
  let g = p.g;
  for (let k = 0; k < 3; k++) {
    let u = t - k * 0.22;
    u <= 0 || u >= 1 || (g.beginPath(), g.ellipse(300, 300, 60 + 230 * u, 60 + 230 * u, 0, 0, Math.PI * 2), g.strokeStyle = k === 0 ? "#f6fcff" : "#cfe8fa", g.lineWidth = 9 * (1 - u) + 3, g.stroke());
  }
}, fxSign = (p) => {
  let g = p.g, RED = "#d42f2f";
  p.poly(rrect(14, 14, 686, 506, 40), "#f6ecd2", 0), p.poly(rrect(14, 14, 686, 506, 40), null, 14), p.poly(rrect(70, 352, 630, 384, 8), "#8a5a3a", 9), g.beginPath(), g.moveTo(112, 470), g.quadraticCurveTo(350, 300, 588, 470), g.strokeStyle = INK, g.lineWidth = 16, g.lineCap = "round", g.stroke();
  for (let x of [88, 612]) p.poly(rrect(x - 16, 384, x + 16, 470, 4), "#8a5a3a", 9);
  for (let x of [150, 278, 406, 534])
    p.poly(rrect(x - 30, 150, x + 30, 214, 14), "#357650", 9), p.stroke([[x - 8, 210], [x + 34, 262], [x + 46, 338]], 15, INK), p.stroke([[x + 6, 210], [x - 12, 274], [x - 36, 336]], 15, INK), p.poly(rrect(x + 30, 330, x + 74, 350, 9), INK, 0), p.poly(rrect(x - 52, 328, x - 8, 348, 9), INK, 0);
  for (let [a, b] of [[[96, 70], [604, 452]], [[604, 70], [96, 452]]])
    p.stroke([a, b], 58, "#ffffff"), p.stroke([a, b], 42, RED);
}, fxCloud = (p, seed) => {
  let blobs = [[150, 190, 80], [250, 150, 105], [360, 160, 95], [450, 195, 70], [300, 210, 90]];
  for (let [x, y, r] of blobs) p.ell(x + seed * 37 % 20 - 10, y, r, r * 0.8, "#ffffff", 0);
  p.ell(300, 235, 230, 40, "#ffffff", 0);
};
var fxContact = (p, col) => {
  let g = p.g;
  g.fillStyle = WHITE, g.fillRect(0, 0, 128, 128);
  let gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (let [r, k] of [[0, 0], [0.32, 0.02], [0.5, 0.22], [0.66, 0.58], [0.82, 0.88], [1, 1]]) gr.addColorStop(r, mix(col, WHITE, k));
  g.fillStyle = gr, g.fillRect(0, 0, 128, 128);
};

// vendor/cartoon3d/src/paint.ts
import * as THREE from "three";
var rng = (seed) => {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => (s = s * 16807 % 2147483647, (s - 1) / 2147483646);
}, cache = /* @__PURE__ */ new Map(), ctex = (key, w, h, draw) => {
  let t = cache.get(key);
  if (!t) {
    let cv = document.createElement("canvas");
    cv.width = w, cv.height = h, draw(cv.getContext("2d"), rng(key.length * 131 + key.charCodeAt(0))), t = new THREE.CanvasTexture(cv), t.colorSpace = THREE.SRGBColorSpace, t.anisotropy = 8, t.wrapS = t.wrapT = THREE.RepeatWrapping, cache.set(key, t);
  }
  return t;
}, rep = (t, x, y) => {
  let c = t.clone();
  return c.repeat.set(x, y), c.needsUpdate = !0, c;
}, pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
var _jc = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 }, jit = (r, hex, dv = 0.1, dh = 5, ds = 0.15) => {
  _jc.set(hex).getHSL(_hsl);
  let k = (a) => 1 + (r() * 2 - 1) * a;
  return _jc.setHSL((_hsl.h + (r() * 2 - 1) * dh / 360 + 1) % 1, Math.min(1, _hsl.s * k(ds)), Math.min(0.97, _hsl.l * k(dv))), "#" + _jc.getHexString();
};
var brickCol = (r) => {
  let c = jit(r, pick(r, ["#c0583a", "#b44f35", "#c8643f", "#a94a33", "#cf6e45", "#b9603f"]), 0.24, 6, 0.15), u = r();
  return u < 0.12 ? dim(c, 0.68) : u > 0.9 ? dim(c, 1.22) : c;
}, dim = (hex, k) => (_jc.set(hex).getHSL(_hsl), _jc.setHSL(_hsl.h, _hsl.s, Math.min(0.92, _hsl.l * k)), "#" + _jc.getHexString()), brick = () => ctex("brick", 512, 512, (g, r) => {
  g.fillStyle = "#e6d3b3", g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 16; row++) for (let i = 0; i < 8; i++) {
    let c = brickCol(r), x = i * 64 + row % 2 * 32 + 2, y = row * 32 + 2;
    for (let ox of [0, -512])
      g.fillStyle = c, g.fillRect(x + ox, y, 60, 28), g.fillStyle = "rgba(255,235,210,0.16)", g.fillRect(x + ox + 2, y, 56, 3), g.fillStyle = "rgba(70,30,20,0.14)", g.fillRect(x + ox + 2, y + 25, 56, 3);
  }
  for (let i = 0; i < 9; i++) {
    let x = r() * 512, y = r() * 512, rad3 = 30 + r() * 70;
    for (let ox of [-512, 0, 512]) for (let oy of [-512, 0, 512]) {
      g.save(), g.translate(x + ox, y + oy), g.scale(1.3, 1);
      let gr = g.createRadialGradient(0, 0, 0, 0, 0, rad3);
      gr.addColorStop(0, "rgba(70,45,35,0.13)"), gr.addColorStop(1, "rgba(70,45,35,0)"), g.fillStyle = gr, g.fillRect(-rad3, -rad3, 2 * rad3, 2 * rad3), g.restore();
    }
  }
});
var U = (r, a, b) => a + (b - a) * r(), TAU = Math.PI * 2, wrapX = (W, x, w, fn) => {
  fn(x), x + w > W && fn(x - W), x < 0 && fn(x + W);
}, wrap2 = (W, H, x, y, rad3, fn) => {
  for (let ox of [0, -W, W]) for (let oy of [0, -H, H]) {
    let X = x + ox, Y = y + oy;
    X + rad3 > 0 && X - rad3 < W && Y + rad3 > 0 && Y - rad3 < H && fn(X, Y);
  }
}, rr = (g, x, y, w, h, k) => {
  k = Math.max(0, Math.min(k, w / 2, h / 2)), g.beginPath(), g.moveTo(x + k, y), g.arcTo(x + w, y, x + w, y + h, k), g.arcTo(x + w, y + h, x, y + h, k), g.arcTo(x, y + h, x, y, k), g.arcTo(x, y, x + w, y, k), g.closePath();
}, blotch = (g, x, y, rad3, sx, rgb, a) => {
  g.save(), g.translate(x, y), g.scale(sx, 1);
  let gr = g.createRadialGradient(0, 0, 0, 0, 0, rad3);
  gr.addColorStop(0, `rgba(${rgb},${a})`), gr.addColorStop(1, `rgba(${rgb},0)`), g.fillStyle = gr, g.fillRect(-rad3, -rad3, rad3 * 2, rad3 * 2), g.restore();
}, grain = (g, r, W, x, y, len, amp, lw, col) => {
  let n = Math.max(2, Math.round(len / 180)), dy = Array.from({ length: n + 1 }, () => (r() - 0.5) * 2 * amp);
  wrapX(W, x, len, (xx) => {
    g.strokeStyle = col, g.lineWidth = lw, g.lineCap = "round", g.beginPath(), g.moveTo(xx, y + dy[0]);
    for (let i = 1; i <= n; i++) {
      let x1 = xx + len * i / n;
      g.quadraticCurveTo(x1 - len / n / 2, y + (dy[i - 1] + dy[i]) / 2 + (i % 2 ? 0.3 : -0.3) * amp, x1, y + dy[i]);
    }
    g.stroke();
  });
}, nail = (g, x, y, rad3, col = "#3a2212") => {
  g.fillStyle = col, g.beginPath(), g.arc(x, y, rad3, 0, TAU), g.fill(), g.fillStyle = "rgba(255,240,215,0.55)", g.beginPath(), g.arc(x - rad3 * 0.32, y - rad3 * 0.32, rad3 * 0.36, 0, TAU), g.fill();
}, planksHD = () => ctex("planksHD", 2048, 2048, (g, r) => {
  let fills = ["#c99669", "#c18e64", "#d19f6e", "#bb8961", "#c69466", "#c79b6f"];
  for (let i = 0; i < 8; i++) {
    let y = i * 256;
    g.save(), g.beginPath(), g.rect(0, y, 2048, 256), g.clip(), g.fillStyle = jit(r, pick(r, fills), 0.05, 3, 0.08), g.fillRect(0, y, 2048, 256);
    for (let k = 0; k < 5; k++) {
      let x = U(r, 0, 2048), rad3 = U(r, 120, 260), light = r() > 0.5;
      wrapX(2048, x - rad3 * 3, rad3 * 6, (xx) => blotch(g, xx + rad3 * 3, y + 256 / 2, rad3, 3, light ? "255,236,200" : "110,60,25", light ? 0.12 : 0.1));
    }
    for (let k = 0; k < 18; k++) {
      let light = r() < 0.25;
      grain(
        g,
        r,
        2048,
        U(r, 0, 2048),
        y + U(r, 16, 240),
        U(r, 500, 1600),
        U(r, 2, 8),
        U(r, 2, 4),
        light ? "rgba(255,232,195,0.2)" : "rgba(95,48,18,0.3)"
      );
    }
    for (let k = 0; k < 4; k++)
      grain(g, r, 2048, U(r, 0, 2048), y + U(r, 30, 226), U(r, 900, 1900), U(r, 4, 10), 3.5, "rgba(70,32,10,0.4)");
    if (r() < 0.35) {
      let kx = U(r, 120, 1928), ky = y + U(r, 70, 186), rx = U(r, 14, 24), ry = rx * U(r, 0.45, 0.6);
      g.strokeStyle = "rgba(140,82,36,0.20)", g.lineWidth = 2, g.beginPath(), g.ellipse(kx, ky, rx * 2.3, ry * 1.9, 0, 0, TAU), g.stroke(), g.fillStyle = "rgba(150,88,38,0.30)", g.beginPath(), g.ellipse(kx, ky, rx, ry, 0, 0, TAU), g.fill(), g.strokeStyle = "rgba(105,55,22,0.55)", g.lineWidth = 2.5, g.stroke();
    }
    for (let k = 0; k < 3; k++) blotch(g, U(r, 100, 1948), y + U(r, 40, 216), U(r, 40, 110), 1.6, "120,70,30", 0.06);
    g.fillStyle = "rgba(255,238,200,0.35)", g.fillRect(0, y + 12 / 2 + 1, 2048, 3);
    let sh = g.createLinearGradient(0, y + 256 - 12 / 2 - 18, 0, y + 256 - 12 / 2);
    sh.addColorStop(0, "rgba(80,35,10,0)"), sh.addColorStop(1, "rgba(80,35,10,0.24)"), g.fillStyle = sh, g.fillRect(0, y + 256 - 12 / 2 - 18, 2048, 18);
    let jx = U(r, 90, 1958);
    g.fillStyle = "#24110a", g.fillRect(jx - 3, y, 7, 256), g.fillStyle = "rgba(255,238,200,0.30)", g.fillRect(jx + 4, y, 2, 256);
    for (let nx of [jx - 24, jx + 24]) for (let f of [0.28, 0.72]) nail(g, nx, y + 256 * f, 5, "#22140c");
    for (let nx of [512, 1536]) for (let f of [0.3, 0.7]) nail(g, nx + U(r, -3, 3), y + 256 * f, 5, "#22140c");
    g.restore();
  }
  for (let i = 0; i <= 8; i++)
    g.fillStyle = "rgba(40,18,8,0.6)", g.fillRect(0, i * 256 - 12 / 2 - 3, 2048, 18), g.fillStyle = "#1c0c05", g.fillRect(0, i * 256 - 12 / 2, 2048, 12);
}), beamHD = () => ctex("beamHD", 1024, 512, (g, r) => {
  let T = 73.14285714285714;
  for (let k = 0; k < 7; k++) {
    let y = k * T;
    g.save(), g.beginPath(), g.rect(0, y, 1024, T), g.clip(), g.fillStyle = pick(r, ["#a8743f", "#9e6b39", "#b07a44"]), g.fillRect(0, y, 1024, T);
    for (let i = 0; i < 6; i++) {
      let light = r() < 0.3;
      grain(g, r, 1024, U(r, 0, 1024), y + U(r, 8, T - 8), U(r, 250, 700), U(r, 1.5, 4), U(r, 1.5, 3), light ? "rgba(255,232,190,0.12)" : "rgba(85,48,20,0.16)");
    }
    g.fillStyle = "rgba(255,235,195,0.30)", g.fillRect(0, y + 3, 1024, 3);
    let sh = g.createLinearGradient(0, y + T - 12, 0, y + T);
    sh.addColorStop(0, "rgba(60,28,8,0)"), sh.addColorStop(1, "rgba(60,28,8,0.26)"), g.fillStyle = sh, g.fillRect(0, y + T - 12, 1024, 12);
    let jx = U(r, 120, 904);
    g.fillStyle = "#4a2510", g.fillRect(jx - 2, y, 4, T);
    for (let bx of [jx - 30, jx + 30]) nail(g, bx, y + T / 2, 7, "#2f2a2a");
    g.restore(), g.fillStyle = "#4a2510", g.fillRect(0, y - 1.5, 1024, 3);
  }
}), STONE_PAL = {
  stoneHD: { cols: ["#d6c4a8", "#cbb89c", "#decfb5", "#c2ae91", "#d0bea2"], mortar: "#a08e76" },
  towerHD: { cols: ["#d6c4a8", "#cbb89c", "#decfb5", "#c2ae91", "#d0bea2"], mortar: "#a08e76" },
  tstoneHD: { cols: ["#e2d5bc", "#d7c8ac", "#e9dec9", "#ccbca1"], mortar: "#a69881" },
  wallHD: { cols: ["#c3b198", "#b8a68b", "#cdbda3", "#af9c83", "#beac94"], mortar: "#887762" },
  copeHD: { cols: ["#e5d9c1", "#dbcdb5", "#ebe1ce", "#d3c4ac"], mortar: "#a99982" }
}, STONE_BIG = /* @__PURE__ */ new Set(["towerHD", "tstoneHD", "wallHD", "stoneHD"]), stoneHD = (key = "stoneHD", cols = ["#ddd0bf", "#d3c5b3", "#e5d9c9", "#cabba8"], mortar = "#a39584") => {
  let pal = STONE_PAL[key];
  pal && (cols = pal.cols, mortar = pal.mortar);
  let S = STONE_BIG.has(key) ? 2048 : 1024, t = ctex(key, S, S, (g, r) => {
    g.fillStyle = mortar, g.fillRect(0, 0, S, S);
    for (let row = 0; row < S / 128; row++) {
      let y = row * 128, ws = [], sum = 0;
      for (; sum < S; ) {
        let w = U(r, 200, 360);
        ws.push(w), sum += w;
      }
      let k = S / sum, x = row % 2 * 140 + U(r, 0, 60);
      for (let w0 of ws) {
        let w = w0 * k, col = jit(r, pick(r, cols), 0.1, 5, 0.18), dl = U(r, -1, 1), sp = Array.from({ length: 16 }, () => [r(), r(), U(r, 1, 2.2), r() < 0.6 ? 1 : 0]), crack = r() < 0.15 ? Array.from({ length: 4 }, () => [r(), r()]) : null;
        wrapX(S, x % S, w, (xx) => {
          let X = xx + 3.5, Y = y + 7 / 2, BW = w - 7, BH = 121;
          rr(g, X, Y, BW, BH, 5), g.fillStyle = col, g.fill(), g.fillStyle = dl > 0 ? `rgba(255,252,245,${0.07 * dl})` : `rgba(70,55,45,${-0.06 * dl})`, g.fill(), g.fillStyle = "rgba(255,252,245,0.22)", g.fillRect(X + 3, Y, BW - 6, 6), g.fillStyle = "rgba(255,252,245,0.10)", g.fillRect(X, Y + 4, 4, BH - 8), g.fillStyle = "rgba(70,55,45,0.14)", g.fillRect(X + 3, Y + BH - 5, BW - 6, 5);
          for (let [u, v, s, dark] of sp)
            g.fillStyle = dark ? "rgba(95,82,72,0.38)" : "rgba(255,255,255,0.35)", g.beginPath(), g.arc(X + 6 + u * (BW - 12), Y + 8 + v * (BH - 16), s, 0, TAU), g.fill();
          crack && (g.strokeStyle = "rgba(110,90,70,0.45)", g.lineWidth = 1.2, g.beginPath(), crack.forEach(([u, v], i) => {
            let px = X + 10 + u * (BW - 20), py = Y + 10 + v * (BH - 20);
            i ? g.lineTo(px, py) : g.moveTo(px, py);
          }), g.stroke());
        }), x += w;
      }
    }
    let n = (S / 1024) ** 2;
    for (let i = 0; i < 14 * n; i++) {
      let x = U(r, 0, S), y = U(r, 0, S), rad3 = U(r, 50, 170), dark = r() < 0.75;
      wrap2(S, S, x, y, rad3 * 1.4, (xx, yy) => blotch(g, xx, yy, rad3, 1.4, dark ? "105,82,55" : "255,246,225", dark ? U(r, 0.07, 0.13) : 0.09));
    }
    for (let i = 0; i < 8 * n; i++) {
      let x = U(r, 0, S), y = U(r, 0, S * 0.8), w = U(r, 8, 26), h = U(r, 90, 300), gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, "rgba(95,75,52,0.14)"), gr.addColorStop(1, "rgba(95,75,52,0)"), wrapX(S, x, w, (xx) => {
        g.fillStyle = gr, g.fillRect(xx, y, w, h);
      });
    }
    for (let i = 0; i < 160 * n; i++) {
      let x = U(r, 0, S), y = U(r, 0, S), s = U(r, 1.2, 3), d = r() < 0.65;
      g.fillStyle = d ? "rgba(90,70,50,0.32)" : "rgba(255,248,230,0.35)", g.beginPath(), g.arc(x, y, s, 0, TAU), g.fill();
    }
  });
  return t.repeat.set(1024 / S, 1024 / S), t;
}, cobbleHD = () => {
  let t = ctex("cobbleHD", 2048, 2048, (g, r) => {
    let CH = 42.666666666666664, J = 5;
    g.fillStyle = "#867967", g.fillRect(0, 0, 2048, 2048);
    let cols = ["#c4b6a0", "#b8aa93", "#cdc1ab", "#af9f88", "#c7baa3", "#bdb19b", "#b8ad9c"];
    for (let row = 0; row < 48; row++) {
      let y = row * CH, ws = [], sum = 0;
      for (; sum < 2048; ) {
        let w = U(r, 48, 72);
        ws.push(w), sum += w;
      }
      let k = 2048 / sum, x = U(r, 0, 60);
      for (let w0 of ws) {
        let w = w0 * k, col = jit(r, pick(r, cols), 0.1, 6, 0.2), dy = U(r, -1.5, 1.5), rad3 = U(r, 7, 12), sp = Array.from({ length: 3 }, () => [r(), r(), r() < 0.5 ? 1 : 0]);
        wrapX(2048, x % 2048, w, (xx) => {
          let X = xx + J / 2, Y = y + J / 2 + dy, W = w - J, H = CH - J;
          rr(g, X, Y, W, H, rad3), g.fillStyle = col, g.fill(), g.save(), rr(g, X, Y, W, H, rad3), g.clip();
          let gr = g.createLinearGradient(X, Y, X + W * 0.6, Y + H);
          gr.addColorStop(0, "rgba(255,250,240,0.20)"), gr.addColorStop(0.5, "rgba(255,250,240,0)"), gr.addColorStop(1, "rgba(70,58,45,0.16)"), g.fillStyle = gr, g.fillRect(X, Y, W, H), g.restore();
          for (let [u, v, d] of sp)
            g.fillStyle = d ? "rgba(90,80,68,0.35)" : "rgba(255,255,255,0.3)", g.beginPath(), g.arc(X + 5 + u * (W - 10), Y + 5 + v * (H - 10), 1.4, 0, TAU), g.fill();
        }), x += w;
      }
    }
    for (let i = 0; i < 40; i++) {
      let x = U(r, 0, 2048), y = U(r, 0, 2048), rad3 = U(r, 60, 220), d = r() < 0.7;
      wrap2(2048, 2048, x, y, rad3 * 1.3, (xx, yy) => blotch(g, xx, yy, rad3, 1.3, d ? "90,70,48" : "255,244,220", d ? U(r, 0.06, 0.12) : 0.1));
    }
    for (let i = 0; i < 260; i++) {
      let x = U(r, 0, 2048), y = U(r, 0, 2048), rx = U(r, 2, 5), d = r() < 0.4;
      wrap2(2048, 2048, x, y, 8, (xx, yy) => {
        g.fillStyle = d ? "rgba(95,78,58,0.55)" : pick(r, ["rgba(245,232,205,0.8)", "rgba(230,214,185,0.8)"]), g.beginPath(), g.ellipse(xx, yy, rx, rx * 0.75, 0, 0, TAU), g.fill();
      });
    }
  });
  return t.repeat.set(0.5, 0.5), t;
}, roofHD = (col, slate = !1) => ctex("roofHD" + col, 1024, 1024, (g, r) => {
  let TW = slate ? 52 : 77;
  g.fillStyle = col, g.fillRect(0, 0, 1024, 1024);
  for (let row = 0; row < 1024 / 64; row++) {
    let y = row * 64, off = row % 2 * TW / 2 + U(r, -6, 6), n = Math.ceil(1024 / TW) + 1;
    for (let i = 0; i < n; i++) {
      let x = i * TW - off, tone = U(r, -1, 1), fill = tone > 0 ? `rgba(255,240,225,${0.1 * tone})` : `rgba(60,25,20,${-0.1 * tone})`;
      wrapX(1024, x, TW, (xx) => {
        g.fillStyle = fill, g.fillRect(xx, y, TW, 64);
        let gr = g.createLinearGradient(xx, 0, xx + TW, 0);
        gr.addColorStop(0, "rgba(255,240,225,0.12)"), gr.addColorStop(0.55, "rgba(255,240,225,0)"), gr.addColorStop(1, slate ? "rgba(20,25,35,0.10)" : "rgba(60,25,20,0.12)"), g.fillStyle = gr, g.fillRect(xx, y, TW, 64), g.fillStyle = slate ? "rgba(20,25,35,0.25)" : "rgba(60,25,20,0.22)", g.fillRect(xx, y, 2, 64);
      });
    }
    g.fillStyle = slate ? "rgba(220,230,245,0.18)" : "rgba(255,235,220,0.22)", g.fillRect(0, y + 64 - 9, 1024, 3), g.fillStyle = slate ? "rgba(15,20,30,0.32)" : "rgba(55,22,18,0.32)", g.fillRect(0, y + 64 - 5, 1024, 5);
  }
  for (let i = 0; i < 18; i++) {
    let x = U(r, 0, 1024), y = U(r, 0, 1024), rad3 = U(r, 40, 120);
    wrap2(1024, 1024, x, y, rad3 * 1.5, (xx, yy) => blotch(g, xx, yy, rad3, 1.5, "70,60,40", 0.08));
  }
}), grassHD = () => ctex("grassHD", 1024, 1024, (g, r) => {
  g.fillStyle = "#73b23d", g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 16; i++) {
    let x = U(r, 0, 1024), y = U(r, 0, 1024), rad3 = U(r, 120, 320), light = r() > 0.5;
    wrap2(1024, 1024, x, y, rad3 * 1.4, (xx, yy) => blotch(g, xx, yy, rad3, 1.4, light ? "140,198,80" : "92,154,48", 0.35));
  }
  g.lineWidth = 2, g.lineCap = "round", g.lineJoin = "round";
  for (let i = 0; i < 1400; i++) {
    let x = U(r, 0, 1024), y = U(r, 0, 1024), h = U(r, 7, 16), lean = U(r, -3, 3), light = r() < 0.4;
    wrap2(1024, 1024, x, y, 20, (xx, yy) => {
      g.strokeStyle = light ? "rgba(165,218,98,0.35)" : "rgba(78,138,38,0.45)", g.beginPath(), g.moveTo(xx - 3 + lean, yy - h), g.lineTo(xx, yy), g.lineTo(xx + 3 + lean, yy - h * 0.8), g.stroke();
    });
  }
  for (let i = 0; i < 12; i++) {
    let x = U(r, 0, 1024), y = U(r, 0, 1024), c = pick(r, ["#f7f3e8", "#f4d24a", "#f3a9bb", "#f7f3e8"]);
    wrap2(1024, 1024, x, y, 8, (xx, yy) => {
      g.fillStyle = c, g.beginPath(), g.arc(xx, yy, 3.5, 0, TAU), g.fill(), g.fillStyle = "rgba(240,190,60,0.9)", g.beginPath(), g.arc(xx, yy, 1.3, 0, TAU), g.fill();
    });
  }
}), facadeHD = (key, wm, hm, o) => {
  let PX = Math.min(72, 2048 / Math.max(wm, hm)), W = Math.round(wm * PX), H = Math.round(hm * PX), m = (v) => v * PX;
  return ctex("facHD" + key, W, H, (g, r) => {
    if (o.brick) {
      g.fillStyle = "#e9d3b4", g.fillRect(0, 0, W, H);
      let bw = m(0.25), bh = m(0.085);
      for (let y = 0, row = 0; y < H; y += bh, row++) for (let x = -(row % 2) * bw / 2; x < W; x += bw)
        g.fillStyle = brickCol(r), g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      let n = Math.round(wm * hm / 12) + 3;
      for (let i = 0; i < n; i++) blotch(g, U(r, 0, W), U(r, 0, H), m(U(r, 0.4, 1.4)), 1.4, "70,40,30", U(r, 0.06, 0.12));
    } else {
      g.fillStyle = o.wall, g.fillRect(0, 0, W, H);
      let n = Math.round(wm * hm / 3) + 6;
      for (let i = 0; i < n; i++) {
        let light = r() > 0.5;
        blotch(g, U(r, 0, W), U(r, 0, H), m(U(r, 0.4, 1.5)), 1.5, light ? "255,255,255" : "120,90,60", light ? 0.07 : 0.05);
      }
      for (let i = 0; i < 4; i++) {
        let x = U(r, 0, W), y = U(r, 0, H * 0.8);
        g.strokeStyle = "rgba(120,100,80,0.35)", g.lineWidth = 1, g.beginPath(), g.moveTo(x, y);
        for (let k = 0; k < 4; k++)
          x += m(U(r, -0.08, 0.08)), y += m(U(r, 0.04, 0.12)), g.lineTo(x, y);
        g.stroke();
      }
    }
    let floors = Math.max(1, Math.floor(hm / 2.8)), nWin = Math.max(1, Math.floor(wm / 2.2));
    g.fillStyle = "rgba(70,55,45,0.28)", g.fillRect(0, H - m(0.45), W, m(0.45)), g.fillStyle = "rgba(70,55,45,0.35)", g.fillRect(0, H - m(0.45), W, 2);
    let timberBeam = (x, y, w, h) => {
      g.fillStyle = "#6e4a30", g.fillRect(x, y, w, h), g.strokeStyle = "rgba(40,25,15,0.5)", g.lineWidth = 2, g.strokeRect(x + 1, y + 1, w - 2, h - 2), g.fillStyle = "rgba(255,230,200,0.22)", g.fillRect(x + 2, y + 2, w - 4, 2);
    };
    if (o.timber) {
      let t = m(0.18);
      timberBeam(0, 0, t, H), timberBeam(W - t, 0, t, H), timberBeam(0, 0, W, t);
      for (let fl = 1; fl < floors; fl++) timberBeam(0, H - m(fl * 2.8) - t / 2, W, t);
      for (let i = 1; i < nWin; i++) timberBeam(i * W / nWin - t / 2, 0, t, H - m(2.8));
    }
    let door = (cx) => {
      let dw = m(1.1), dh = m(2.1), path = (k) => {
        g.beginPath(), g.moveTo(cx - dw / 2 - k, H), g.lineTo(cx - dw / 2 - k, H - dh + dw / 2), g.arc(cx, H - dh + dw / 2, dw / 2 + k, Math.PI, 0), g.lineTo(cx + dw / 2 + k, H), g.closePath();
      };
      path(m(0.1)), g.fillStyle = "#e9e2d4", g.fill(), g.strokeStyle = "rgba(60,45,40,0.6)", g.lineWidth = 1.5, g.stroke(), path(0), g.fillStyle = "#7a4a2c", g.fill(), g.save(), path(0), g.clip();
      for (let x = cx - dw / 2 + m(0.14); x < cx + dw / 2; x += m(0.14))
        g.fillStyle = "rgba(40,20,10,0.45)", g.fillRect(x - 1, H - dh, 2, dh), g.fillStyle = "rgba(255,225,190,0.15)", g.fillRect(x + 1, H - dh, 2, dh);
      g.restore(), path(0), g.strokeStyle = "rgba(40,25,15,0.7)", g.lineWidth = 2, g.stroke(), nail(g, cx + dw / 3, H - dh / 2, m(0.035), "#d9b04a");
    };
    for (let fl = 0; fl < floors; fl++) for (let i = 0; i < nWin; i++) {
      let cx = (i + 0.5) * W / nWin, by = H - m(fl * 2.8 + 0.9);
      if (o.door && fl === 0 && i === Math.floor(nWin / 2)) {
        door(cx);
        continue;
      }
      let ww = m(0.85), wh = m(1.25), x0 = cx - ww / 2, y0 = by - wh, tr = m(0.08), sw = m(0.45);
      for (let sx of [x0 - tr - sw - m(0.02), x0 + ww + tr + m(0.02)]) {
        g.fillStyle = o.shutter, g.fillRect(sx, y0, sw, wh);
        let lw = Math.max(1.5, m(0.012));
        for (let ly = y0 + m(0.06); ly < y0 + wh - m(0.04); ly += m(0.06))
          g.fillStyle = "rgba(0,0,0,0.22)", g.fillRect(sx + m(0.04), ly, sw - m(0.08), lw), g.fillStyle = "rgba(255,255,255,0.14)", g.fillRect(sx + m(0.04), ly + lw, sw - m(0.08), 1);
        g.strokeStyle = "rgba(0,0,0,0.18)", g.lineWidth = m(0.03), g.strokeRect(sx + m(0.015), y0 + m(0.015), sw - m(0.03), wh - m(0.03)), g.strokeStyle = "rgba(40,30,40,0.55)", g.lineWidth = 1.5, g.strokeRect(sx, y0, sw, wh);
      }
      g.fillStyle = "#f7f2e8", g.fillRect(x0 - tr, y0 - tr, ww + 2 * tr, wh + 2 * tr);
      let gl = g.createLinearGradient(0, y0, 0, y0 + wh);
      gl.addColorStop(0, "#8d9cdb"), gl.addColorStop(1, "#5761a8"), g.fillStyle = gl, g.fillRect(x0, y0, ww, wh), r() < 0.35 && (g.fillStyle = pick(r, ["#f5c4c8", "#f3e3c6", "#d7e6cf"]), g.beginPath(), g.moveTo(x0, y0), g.lineTo(x0 + ww * 0.42, y0), g.lineTo(x0, y0 + wh * 0.75), g.fill(), g.beginPath(), g.moveTo(x0 + ww, y0), g.lineTo(x0 + ww * 0.58, y0), g.lineTo(x0 + ww, y0 + wh * 0.75), g.fill()), g.save(), g.beginPath(), g.rect(x0, y0, ww, wh), g.clip(), g.fillStyle = "rgba(255,255,255,0.5)";
      for (let [a, b] of [[0.3, m(0.07)], [0.58, m(0.035)]])
        g.save(), g.translate(x0 + ww * a, y0 + wh * 0.5), g.rotate(Math.PI / 4), g.fillRect(-b / 2, -wh, b, wh * 2), g.restore();
      g.restore(), g.fillStyle = "#f7f2e8", g.fillRect(cx - m(0.02), y0, m(0.04), wh), g.fillRect(x0, y0 + wh * 0.45 - m(0.02), ww, m(0.04)), g.strokeStyle = "rgba(60,45,40,0.6)", g.lineWidth = 1.5, g.strokeRect(x0 - tr, y0 - tr, ww + 2 * tr, wh + 2 * tr), g.strokeStyle = "rgba(60,45,40,0.45)", g.strokeRect(x0, y0, ww, wh), g.fillStyle = "#ebe3d4", g.fillRect(x0 - tr - m(0.06), by + tr, ww + 2 * tr + m(0.12), m(0.07)), g.fillStyle = "rgba(60,45,40,0.35)", g.fillRect(x0 - tr - m(0.06), by + tr + m(0.07), ww + 2 * tr + m(0.12), m(0.03));
    }
  });
};
var CLOUD_DAY = { lit: "#fbf8f1", mid: "#e1e5f3", shade: "#c3cbe9" }, CLOUD_GOLD = { lit: "#ffd2a8", mid: "#f2a08f", shade: "#a98fc4" }, cloudHD = (seed, pal = CLOUD_DAY) => ctex(`cloudHD_${pal.lit}_${seed}`, 1024, 512, (g) => {
  let r = rng(seed * 7919 + 17), W = 1024, H = 512, base = 400, n = 6 + Math.floor(r() * 4), lobes = [];
  for (let i = 0; i < n; i++) {
    let t = (i + 0.5) / n, rad3 = (60 + 110 * Math.sin(Math.PI * t) ** 0.8) * U(r, 0.75, 1.15);
    lobes.push({ x: 150 + t * 724 + U(r, -30, 30), y: base - rad3 * U(r, 0.35, 0.65), r: rad3 });
  }
  for (let i = 0; i < Math.floor(n / 2); i++) {
    let t = U(r, 0.25, 0.75), rad3 = U(r, 60, 110);
    lobes.push({ x: 150 + t * 724, y: base - 150 - rad3 * U(r, 0.3, 0.7), r: rad3 });
  }
  let layer = (dx, dy, k, col, blur) => {
    g.save(), g.filter = `blur(${blur}px)`, g.fillStyle = col, g.beginPath();
    for (let l of lobes) {
      let x = l.x + dx * l.r, y = l.y + dy * l.r;
      g.moveTo(x + l.r * k, y), g.arc(x, y, l.r * k, 0, TAU);
    }
    g.fill(), g.restore();
  };
  layer(0, 0, 1, pal.shade, 6), layer(-0.04, -0.12, 0.9, pal.mid, 8), layer(-0.1, -0.26, 0.72, pal.lit, 10), g.globalCompositeOperation = "destination-in";
  let m = g.createLinearGradient(0, base - 18, 0, base + 6);
  m.addColorStop(0, "rgba(0,0,0,1)"), m.addColorStop(1, "rgba(0,0,0,0)"), g.fillStyle = m, g.fillRect(0, 0, W, H), g.globalCompositeOperation = "source-over";
});

// vendor/cartoon3d/src/shade.ts
import * as THREE2 from "three";
var TONE = {
  uLitCol: { value: new THREE2.Vector3(1.5, 1.44, 1.32) },
  uShadeCol: { value: new THREE2.Vector3(0.6, 0.58, 0.86) },
  uShadeLift: { value: new THREE2.Vector3() },
  uLambert: { value: 0.35 },
  uSideK: { value: 0.84 },
  uTerm: { value: 0.2 },
  uBounce: { value: new THREE2.Vector3() },
  // warm bounce on shaded faces turned to the camera (golden only; day = 0)
  uSat: { value: 1 }
  // world albedo saturation around its luminance (characters are not twoTone, so unaffected)
}, CHAR = {
  uCharTint: { value: new THREE2.Vector3(1, 0.94, 0.92) },
  uCharShade: { value: 0.86 },
  uGrad: { value: 0.07 },
  uBodyGrad: { value: 0.2 },
  uSideTint: { value: new THREE2.Vector3(0.92, 0.9, 0.96) }
}, LFB = THREE2.ShaderChunk.lights_fragment_begin.replace(
  "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]",
  "sunVis = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]"
).replace("vDirectionalShadowCoord[ i ] ) : 1.0;", `vDirectionalShadowCoord[ i ] ) : 1.0;
		directLight.color *= sunVis;`);
if (!LFB.includes("directLight.color *= sunVis")) throw new Error("shade.ts: three lights_fragment_begin changed");
var TWO_TONE = (
  /* glsl */
  `
#if NUM_DIR_LIGHTS > 0
{
  vec3 sunV = directionalLights[ 0 ].direction;                               // view space, towards the sun
  vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float ndl = max( dot( geometryNormal, sunV ), 0.0 );
  float sunTerm = sunVis * smoothstep( 0.0, uTerm, ndl );                     // 0 = cast/form shadow, 1 = lit
  float skyK = mix( uSideK, 1.0, 0.5 + 0.5 * dot( geometryNormal, upV ) );    // up-facing a bit brighter
  vec3 lit = uLitCol * mix( 1.0, ndl, uLambert );                             // keep some cosine modelling
  float facing = max( dot( geometryNormal, geometryViewDir ), 0.0 );        // 1 = faces the lens
  vec3 alb = max( mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, uSat ), 0.0 );
  reflectedLight.directDiffuse = alb * ( mix( uShadeCol, lit, sunTerm ) * skyK + uBounce * facing * clamp( 1.0 - dot( geometryNormal, upV ), 0.0, 1.0 ) * ( 1.0 - sunTerm ) )
    + uShadeLift * LIFT_K * ( 1.0 - sunTerm );
  reflectedLight.indirectDiffuse = vec3( 0.0 );                               // hemisphere/fill no longer used here
}
#endif
`
), DECL = `#include <common>
uniform vec3 uLitCol; uniform vec3 uShadeCol; uniform vec3 uShadeLift; uniform float uLambert; uniform float uSideK; uniform float uTerm; uniform vec3 uBounce; uniform float uSat;`;
function twoTone(m, liftK = 1) {
  return m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, TONE), sh.fragmentShader = sh.fragmentShader.replace("#include <common>", DECL + `
#define LIFT_K ${liftK.toFixed(3)}`).replace("#include <lights_fragment_begin>", `float sunVis = 1.0;
` + LFB).replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
` + TWO_TONE);
  }, m.customProgramCacheKey = () => "twoTone5_" + liftK.toFixed(3), m;
}
var neutral = (c) => {
  let x = Math.min(c[0], c[1], c[2]), off = x < 0.08 ? x - 6.25 * x * x : 0.04, v = c.map((k) => k - off), peak = Math.max(v[0], v[1], v[2]), S = 0.76;
  if (peak < S) return v;
  let d = 1 - S, np = 1 - d * d / (peak + d - S), g = 1 - 1 / (0.15 * (peak - np) + 1);
  return v.map((k) => k * np / peak * (1 - g) + np * g);
}, untone = (target, out = new THREE2.Color()) => {
  let t = new THREE2.Color(target), tt = [t.r, t.g, t.b].map((k) => Math.min(k, 0.985)), c = tt.slice();
  for (let i = 0; i < 60; i++) {
    let y = neutral(c);
    c = c.map((k, j) => Math.max(0, k + (tt[j] - y[j])));
  }
  return out.setRGB(c[0], c[1], c[2]);
};

// vendor/cartoon3d/src/lights.ts
var LIGHTS = {
  day: {
    az: 75,
    el: 48,
    lit: [1.58, 1.5, 1.33],
    shade: [0.3, 0.29, 0.36],
    lift: [0.05, 0.06, 0.11],
    lambert: 0.35,
    sideK: 0.84,
    term: 0.2,
    charTint: [1, 0.94, 0.92],
    charShade: 0.86,
    charGrad: 0.07,
    bodyGrad: 0.2,
    sideTint: [0.92, 0.9, 0.96],
    blob: [0.62, 0.58, 0.58],
    actorShadow: !1,
    top: "#3e7fd2",
    hor: "#b8d0ec",
    skyCurve: [0, 0.5, 0.6],
    fog: "#b8d0ec",
    fogNear: 25,
    fogFar: 300,
    sunDisc: "#000000",
    sunCol: "#fff3e0",
    sunI: 2.8,
    sky: "#dcecff",
    ground: "#b49a78",
    hemiI: 0.55,
    bias: -25e-5,
    normalBias: 0.015
  },
  golden: {
    az: 6,
    el: 7,
    lit: [1.5, 0.68, 0.24],
    shade: [0.15, 0.15, 0.3],
    lift: [0.04, 0.06, 0.17],
    lambert: 0.35,
    sideK: 0.82,
    term: 0.07,
    charTint: [1, 0.78, 0.56],
    charShade: 0.88,
    charGrad: 0.1,
    bodyGrad: 0.25,
    sideTint: [0.85, 0.8, 0.95],
    blob: [0.75, 0.74, 0.9],
    actorShadow: !0,
    top: "#6a4f8c",
    hor: "#ffd08a",
    skyCurve: [0.05, 0.6, 1],
    fog: "#efb489",
    fogNear: 50,
    fogFar: 380,
    sunDisc: "#ffcf9e",
    sunCol: "#ffab5e",
    sunI: 5.5,
    sky: "#d8b0b8",
    ground: "#8a6a60",
    hemiI: 0.5,
    bias: -6e-4,
    normalBias: 0.03
  }
}, LOOK = {
  day: {
    // depth.md 2.2: horizon #9fb6e6 just above the skyline, upper sky #5e93d9 at ~20 deg (grade: frame top #5997e2)
    sky: { c: ["#b8d0ec", "#9cbfea", "#6a9fe0", "#4f8cdb", "#3373cc"], e: [0, 3, 8, 16, 40] },
    water: { near: "#22a7b6", mid: "#167fb2", far: "#1a5596", crest: "#7ddfe8", trough: "#0e4a80", glint: "#ffffff", shade: [0.5, 0.56, 0.72] },
    cloud: { lit: "#fbf8f1", mid: "#e1e5f3", shade: "#c3cbe9" },
    bounce: [0, 0, 0],
    sat: 1.08
  },
  golden: {
    // sunset, not dusk: #ffd08a horizon, peach/orange through ~10 deg, warm rose at 20, muted warm mauve only near the top
    // (the golden grade adds ~+11/255 blue to shadows/mids, so these lean warm)
    sky: { c: ["#ffc47c", "#f7ae78", "#e8967c", "#c4848e", "#8a6f8a"], e: [0, 4, 10, 20, 40] },
    water: { near: "#1e3a6e", mid: "#355f96", far: "#d4a48e", crest: "#d9a088", trough: "#16294f", glint: "#ffe2b0", shade: [0.42, 0.46, 0.72] },
    cloud: { lit: "#ffd2a8", mid: "#f2a08f", shade: "#a98fc4" },
    bounce: [0.04, 0.02, 0],
    sat: 1.1
  }
};

// vendor/cartoon3d/src/cardshade.ts
import * as THREE3 from "three";
var GRAD_K = 5.5, GRAD_KB = 1.6, TINT_K = 0.55, CARD = (
  /* glsl */
  `
vec3 tintK = mix( vec3( 1.0 ), uCharTint, uTintK );
tintK /= pow( max( dot( tintK, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.2 ), uNorm );             // same face value day and golden
vec3 outgoingLight = diffuseColor.rgb * tintK;
#if NUM_DIR_LIGHTS > 0
{
  vec3 sunV = directionalLights[ 0 ].direction;                                          // view space, towards the sun
  vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float side = sign( sunV.x ) * smoothstep( 0.0, 0.35, abs( sunV.x ) );                     // saturates: even a near-frontal sun shades one side                                          // + = sun on screen right
  float head = smoothstep( 0.565, 0.6, vMapUv.y );                                        // head zone vs body
  float hw = mix( 0.15, 0.2, head );
  float uu = clamp( ( vMapUv.x - 0.5 ) / hw, -1.0, 1.0 ) * sign( dFdx( vMapUv.x ) + 1e-7 ); // -1..1 screen left..right
  float t = uu * side;                                                                     // +1 = edge facing the sun
  float g = mix( uBodyGrad * uGradKB, min( uGrad * uGradK, 0.4 ), head );
  float dark = smoothstep( -0.15, 0.9, -t );                                                 // far side
  vec3 sideK = mix( vec3( 1.0 ), uSideTint, dark * clamp( g / max( min( uGrad * uGradK, 0.4 ), 1e-3 ), 0.0, 1.5 ) * 0.5 );
  float top = 1.0 + 0.05 * clamp( ( vMapUv.y - 0.69 ) / 0.11, -1.0, 1.0 ) * clamp( dot( sunV, upV ) * 2.0, 0.0, 1.0 ) * head;
  float lift = 1.0 + 0.04 * smoothstep( 0.0, 0.9, t );
  outgoingLight *= mix( uCharShade, 1.0, sunVis ) * ( 1.0 - g * dark ) * sideK * top * lift * uGain;
  #ifdef USE_MAP
  {
    // INNER warm rim, golden only: the outermost ~2 px (at 1080 wide) of the HEAD skin / TORSO silhouette on the
    // sun-facing edge. No offset copy: we only test whether the next pixels toward the sun are outside the card.
    // Hats, legs, rifles and other thin parts are skipped (inner sample must be skin, or torso at least ~40 units thick).
    float warm = smoothstep( 0.2, 0.4, 1.0 - uCharTint.b );
    float sl = length( sunV.xy );
    vec2 d2 = sunV.xy / max( sl, 1e-4 );
    vec2 duv = 2.0 * uPx * ( d2.x * dFdx( vMapUv ) + d2.y * dFdy( vMapUv ) );
    float edge = step( texture2D( map, vMapUv + duv ).a, 0.5 );
    vec2 dirU = normalize( duv + vec2( 1e-9 ) );
    vec4 c1 = texture2D( map, vMapUv - dirU * vec2( 0.027, 0.016 ) );   // ~16 design units inward (past the ink line)
    vec4 c2 = texture2D( map, vMapUv - dirU * vec2( 0.067, 0.04 ) );    // ~40 units inward: thick parts only
    float skin = step( 0.5, c1.a ) * step( 0.3, c1.r ) * step( c1.b + 0.12, c1.r ) * step( c1.g, c1.r + 0.02 );
    float torso = step( 0.27, vMapUv.y ) * step( vMapUv.y, 0.57 ) * step( 0.5, c1.a ) * step( 0.5, c2.a ) * step( 0.04, max( c1.r, max( c1.g, c1.b ) ) );
    float rim = warm * smoothstep( 0.1, 0.4, sl ) * edge * max( skin * head, torso ) * mix( 0.6, 1.0, sunVis );
    outgoingLight += vec3( 0.95, 0.52, 0.16 ) * rim;
  }
  #endif
}
#endif
`
), DECL2 = `#include <common>
uniform vec3 uCharTint; uniform float uCharShade; uniform float uGrad; uniform float uBodyGrad; uniform vec3 uSideTint; uniform float uGradK; uniform float uGradKB; uniform float uTintK; uniform float uNorm; uniform float uGain; uniform float uPx;`, CARD_K = { uGradK: { value: GRAD_K }, uGradKB: { value: GRAD_KB }, uTintK: { value: TINT_K }, uNorm: { value: 0.7 }, uGain: { value: 1.03 }, uPx: { value: 0.5 } };
function cardShade(m) {
  return m.emissive.set(0), m.emissiveIntensity = 0, m.emissiveMap = null, m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, CHAR, CARD_K), sh.fragmentShader = sh.fragmentShader.replace("#include <common>", DECL2).replace("#include <lights_fragment_begin>", `float sunVis = 1.0;
` + LFB).replace("vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;", CARD);
  }, m.customProgramCacheKey = () => "card9", m;
}
var blobMaterial = (map) => new THREE3.MeshBasicMaterial({
  map,
  transparent: !1,
  depthWrite: !1,
  fog: !1,
  toneMapped: !1,
  blending: THREE3.CustomBlending,
  blendEquation: THREE3.AddEquation,
  blendSrc: THREE3.ZeroFactor,
  blendDst: THREE3.SrcColorFactor,
  polygonOffset: !0,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  side: THREE3.DoubleSide
});

// vendor/cartoon3d/src/ink.ts
import * as THREE4 from "three";
var NOINK = 3, DEF = {
  // round 2 (reviewer: "world outlines ~1.5x thicker, pure black on every silhouette"): widths x1.5 (creases follow
  // via creaseScale), pure near-black, far opacity 0.75 -> 0.95; fog tint of the ink 0.6 -> 0.3 (compMat fogInk)
  color: "#030303",
  strength: 1,
  widthNear: 5.1,
  widthFar: 3.3,
  distNear: 6,
  distFar: 90,
  creaseScale: 0.8,
  // round 3: creases 0.64 -> 0.8 (building corners)
  depthLo: 0.01,
  depthHi: 0.03,
  angleLo: 35,
  angleHi: 50,
  concaveGain: 0.7,
  // depth jumps from 1 %; creases from 35 deg (roof eaves)
  farOpacity: 0.95,
  fadeNear: 150,
  fadeFar: 450
}, FS_VERT = (
  /* glsl */
  `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`
), NORMAL_VERT = (
  /* glsl */
  `
#include <common>
uniform mat3 cutUv;
varying vec3 vN;
varying vec3 vV;
varying vec2 vCut;
void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  vN = transformedNormal;
  vCut = (cutUv * vec3(uv, 1.0)).xy;
  #include <begin_vertex>
  #include <project_vertex>
  vV = mvPosition.xyz;
}`
), NORMAL_FRAG = (
  /* glsl */
  `
uniform sampler2D tCut;
uniform float cut;
varying vec3 vN;
varying vec3 vV;
varying vec2 vCut;
void main() {
  if (cut > 0.0 && texture2D(tCut, vCut).a < cut) discard;
  vec3 n;
  if (dot(vN, vN) < 1e-8) n = normalize(cross(dFdx(vV), dFdy(vV)));   // geometry without normals
  else n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);            // back faces of double-sided planes
  gl_FragColor = vec4(n, 1.0);
}`
), MASK_FRAG = (
  /* glsl */
  `
#include <packing>
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tMainDepth;
uniform vec2 texel;
uniform float cNear;
uniform float cFar;
uniform float p00;
uniform float p11;
uniform float wNear;
uniform float wFar;
uniform float dNear;
uniform float dFar;
uniform float creaseScale;
uniform float depthLo;
uniform float depthHi;
uniform float cosLo;
uniform float cosHi;
uniform float concaveGain;
uniform float farOpacity;
uniform float fadeNear;
uniform float fadeFar;
uniform float strength;
uniform float useMain;
uniform float pxScale;   // output px per 1080x1920 px
uniform vec2 fogRange;   // scene fog near / far (m); far <= near = no fog tint
uniform float fogStart;  // ink stays pure black up to here (m), then tints toward the fog colour
varying vec2 vUv;

// pixel steps along x, y and both diagonals, and their length in px
const vec2 STEP[4] = vec2[4](vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(1.0, 1.0), vec2(1.0, -1.0));
const float SLEN[4] = float[4](1.0, 1.0, 1.41421, 1.41421);
#define RMAX 9   // covers 5.1 px x pxScale 1.333 = 6.8 px at 1440x2560 (+0.5 AA ramp)

// textureLod: explicit LOD inside loops (nearest-filtered targets, no derivatives needed)
float dist(sampler2D t, vec2 uv) { return -perspectiveDepthToViewZ(textureLod(t, uv, 0.0).x, cNear, cFar); }
vec3 viewPos(vec2 uv, float d) { vec2 n = uv * 2.0 - 1.0; return vec3(n.x * d / p00, n.y * d / p11, -d); }

// crease strength between this pixel (n0, P0) and a neighbour
float crease(vec3 n0, vec3 P0, float zc, vec2 uq, float zq) {
  vec4 nq = textureLod(tNormal, uq, 0.0);
  if (nq.a < 0.5 || abs(zq - zc) > zc * depthLo) return 0.0;       // sky / depth jump: not a crease
  float k = 1.0 - smoothstep(cosHi, cosLo, dot(n0, nq.xyz));
  if (dot(viewPos(uq, zq) - P0, n0) > 0.0) k *= concaveGain;        // neighbour in front of our tangent plane: concave
  return k;
}

void main() {
  vec4 nc = textureLod(tNormal, vUv, 0.0);
  if (nc.a < 0.5) { gl_FragColor = vec4(0.0); return; }          // sky / empty: ink lives on the near object only
  float zc = dist(tDepth, vUv);

  // characters, cards etc. (not in the world buffer) in front of this pixel: no world ink over them
  if (useMain > 0.5) {
    float zm = dist(tMainDepth, vUv);
    zm = min(zm, dist(tMainDepth, vUv + vec2(texel.x, 0.0)));
    zm = min(zm, dist(tMainDepth, vUv - vec2(texel.x, 0.0)));
    zm = min(zm, dist(tMainDepth, vUv + vec2(0.0, texel.y)));
    zm = min(zm, dist(tMainDepth, vUv - vec2(0.0, texel.y)));
    if (zm < zc * 0.985 - 0.03) { gl_FragColor = vec4(0.0); return; }
  }

  float t = clamp(log(zc / dNear) / log(dFar / dNear), 0.0, 1.0);
  float w = mix(wNear, wFar, t) * pxScale;           // silhouette line width (output px) at this distance, near side only
  float hc = 0.5 * w * creaseScale;                  // crease line half width (px), drawn on both faces
  float Wc = 1.0 / zc;
  vec3 n0 = nc.xyz;
  vec3 P0 = viewPos(vUv, zc);
  float eD = 0.0, eN = 0.0;
  for (int a = 0; a < 4; a++) {
    for (int r = 1; r <= RMAX; r++) {
      vec2 o = STEP[a] * texel * float(r);
      float d = (float(r) - 0.5) * SLEN[a];          // distance of this pixel's centre to an edge first seen at r
      float cw = clamp(w + 0.5 - d, 0.0, 1.0);       // continuous coverage -> no width popping, built-in AA
      float ch = clamp(hc + 0.5 - d, 0.0, 1.0);
      if (cw <= 0.0 && ch <= 0.0) break;
      float z1 = dist(tDepth, vUv - o), z2 = dist(tDepth, vUv + o);
      // depth jump: this pixel is in front of its neighbours (2nd difference of 1/z < 0; exactly 0 on planes)
      float s = (1.0 / z1 + 1.0 / z2 - 2.0 * Wc) / Wc;
      eD = max(eD, smoothstep(depthLo, depthHi, -s) * cw);
      // crease: normal turns towards a neighbour at the same depth
      if (ch > 0.0) eN = max(eN, max(crease(n0, P0, zc, vUv - o, z1), crease(n0, P0, zc, vUv + o, z2)) * ch);
    }
  }

  float ink = max(eD, eN) * strength * mix(1.0, farOpacity, t) * (1.0 - smoothstep(fadeNear, fadeFar, zc));
  float f0 = max(fogRange.x, fogStart);
  float fogK = fogRange.y > f0 ? clamp((zc - f0) / (fogRange.y - f0), 0.0, 1.0) : 0.0;
  gl_FragColor = vec4(ink, fogK, 0.0, 1.0);
}`
), COMP_FRAG = (
  /* glsl */
  `
uniform sampler2D inputBuffer;
uniform sampler2D tMask;
uniform sampler2D tNormal;
uniform vec2 texel;
uniform vec3 inkColor;
uniform vec3 fogColor;
uniform float fogInk;   // how far fully fogged ink moves toward the fog colour (0.3)
uniform int debug;
varying vec2 vUv;
float m(float x, float y) { return texture2D(tMask, vUv + vec2(x, y) * texel).r; }
void main() {
  float a = (4.0 * m(0.0, 0.0)
    + 2.0 * (m(1.0, 0.0) + m(-1.0, 0.0) + m(0.0, 1.0) + m(0.0, -1.0))
    + m(1.0, 1.0) + m(-1.0, 1.0) + m(1.0, -1.0) + m(-1.0, -1.0)) / 16.0;   // 1-2-1 tent = anti-aliasing
  vec4 c = texture2D(inputBuffer, vUv);
  if (debug == 1) { gl_FragColor = vec4(vec3(1.0 - a), 1.0); return; }               // mask only
  if (debug == 2) { gl_FragColor = vec4(texture2D(tNormal, vUv).xyz * 0.5 + 0.5, 1.0); return; } // world normals
  // blend in display (gamma) space like Canvas2D does for the character drawings: coverage -> darkness is linear
  // on screen, so the measured line widths equal the coverage widths (a linear-light blend reads ~30 % thinner)
  float fk = texture2D(tMask, vUv).g;                       // fog amount of the line (max over the AA footprint)
  fk = max(fk, max(texture2D(tMask, vUv + vec2(texel.x, 0.0)).g, texture2D(tMask, vUv - vec2(texel.x, 0.0)).g));
  fk = max(fk, max(texture2D(tMask, vUv + vec2(0.0, texel.y)).g, texture2D(tMask, vUv - vec2(0.0, texel.y)).g));
  vec3 inkC = mix(inkColor, fogColor, fk * fogInk);
  vec3 g = pow(max(c.rgb, 0.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(pow(mix(g, pow(inkC, vec3(1.0 / 2.2)), a), vec3(2.2)), c.a);
}`
), COPY_FRAG = (
  /* glsl */
  `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tSrc, vUv);
  #include <colorspace_fragment>
}`
), InkPass = class {
  constructor(scene, camera, options = {}) {
    __publicField(this, "renderToScreen", !1);
    /** 0 = normal, 1 = show the ink mask, 2 = show the world normal buffer */
    __publicField(this, "debug", 0);
    __publicField(this, "world");
    __publicField(this, "cam");
    __publicField(this, "rt");
    __publicField(this, "maskRT");
    __publicField(this, "tmpRT");
    __publicField(this, "normalMat");
    __publicField(this, "maskMat");
    __publicField(this, "compMat");
    __publicField(this, "copyMat");
    __publicField(this, "fsScene", new THREE4.Scene());
    __publicField(this, "fsCam", new THREE4.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    __publicField(this, "quad");
    __publicField(this, "clearCol", new THREE4.Color());
    let o = { ...DEF, ...options };
    this.world = scene, this.cam = camera, this.cam.layers.enable(NOINK), this.rt = new THREE4.WebGLRenderTarget(1, 1, {
      type: THREE4.HalfFloatType,
      minFilter: THREE4.NearestFilter,
      magFilter: THREE4.NearestFilter,
      generateMipmaps: !1,
      depthBuffer: !0,
      samples: 0,
      depthTexture: new THREE4.DepthTexture(1, 1, THREE4.UnsignedIntType)
    }), this.maskRT = new THREE4.WebGLRenderTarget(1, 1, {
      type: THREE4.UnsignedByteType,
      minFilter: THREE4.NearestFilter,
      magFilter: THREE4.NearestFilter,
      generateMipmaps: !1,
      depthBuffer: !1
    }), this.tmpRT = new THREE4.WebGLRenderTarget(1, 1, {
      type: THREE4.HalfFloatType,
      minFilter: THREE4.LinearFilter,
      magFilter: THREE4.LinearFilter,
      generateMipmaps: !1,
      depthBuffer: !1
    }), this.normalMat = new THREE4.ShaderMaterial({
      vertexShader: NORMAL_VERT,
      fragmentShader: NORMAL_FRAG,
      side: THREE4.DoubleSide,
      uniforms: { tCut: { value: null }, cut: { value: 0 }, cutUv: { value: new THREE4.Matrix3() } }
    }), this.normalMat.onBeforeRender = (_r, _s, _c, _g, object, group) => {
      let mat = object.material, gi = group?.materialIndex ?? 0, src = Array.isArray(mat) ? mat[gi] : mat, u = this.normalMat.uniforms, map = src && src.alphaTest > 0 ? src.map : null;
      u.tCut.value = map, u.cut.value = map ? src.alphaTest : 0, map && (map.updateMatrix(), u.cutUv.value.copy(map.matrix)), this.normalMat.uniformsNeedUpdate = !0;
    };
    let fs = (fragmentShader, uniforms) => new THREE4.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader, uniforms, depthTest: !1, depthWrite: !1 }), texel = new THREE4.Vector2(1, 1);
    this.maskMat = fs(MASK_FRAG, {
      tNormal: { value: this.rt.texture },
      tDepth: { value: this.rt.depthTexture },
      tMainDepth: { value: null },
      texel: { value: texel },
      cNear: { value: 0.2 },
      cFar: { value: 1500 },
      p00: { value: 1 },
      p11: { value: 1 },
      wNear: { value: o.widthNear },
      wFar: { value: o.widthFar },
      dNear: { value: o.distNear },
      dFar: { value: o.distFar },
      creaseScale: { value: o.creaseScale },
      depthLo: { value: o.depthLo },
      depthHi: { value: o.depthHi },
      cosLo: { value: Math.cos(o.angleLo * Math.PI / 180) },
      cosHi: { value: Math.cos(o.angleHi * Math.PI / 180) },
      concaveGain: { value: o.concaveGain },
      farOpacity: { value: o.farOpacity },
      fadeNear: { value: o.fadeNear },
      fadeFar: { value: o.fadeFar },
      strength: { value: o.strength },
      useMain: { value: 0 },
      pxScale: { value: 1 },
      fogRange: { value: new THREE4.Vector2(0, 0) },
      fogStart: { value: 60 }
    }), this.compMat = fs(COMP_FRAG, {
      inputBuffer: { value: null },
      tMask: { value: this.maskRT.texture },
      tNormal: { value: this.rt.texture },
      texel: { value: texel },
      inkColor: { value: new THREE4.Color(o.color) },
      debug: { value: 0 },
      fogColor: { value: new THREE4.Color() },
      fogInk: { value: 0.3 }
    }), this.copyMat = fs(COPY_FRAG, { tSrc: { value: this.tmpRT.texture } }), this.quad = new THREE4.Mesh(new THREE4.PlaneGeometry(2, 2), this.maskMat), this.quad.frustumCulled = !1, this.fsScene.add(this.quad);
  }
  /** live tuning, e.g. ink.set({ widthNear: 4.2, concaveGain: 0.5 }) */
  set(options) {
    let u = this.maskMat.uniforms, map = [
      ["widthNear", "wNear"],
      ["widthFar", "wFar"],
      ["distNear", "dNear"],
      ["distFar", "dFar"],
      ["creaseScale", "creaseScale"],
      ["depthLo", "depthLo"],
      ["depthHi", "depthHi"],
      ["concaveGain", "concaveGain"],
      ["farOpacity", "farOpacity"],
      ["fadeNear", "fadeNear"],
      ["fadeFar", "fadeFar"],
      ["strength", "strength"]
    ];
    for (let [k, n] of map) options[k] !== void 0 && (u[n].value = options[k]);
    options.angleLo !== void 0 && (u.cosLo.value = Math.cos(options.angleLo * Math.PI / 180)), options.angleHi !== void 0 && (u.cosHi.value = Math.cos(options.angleHi * Math.PI / 180)), options.color !== void 0 && this.compMat.uniforms.inkColor.value.set(options.color);
  }
  setDepthTexture(depthTexture) {
    this.maskMat.uniforms.tMainDepth.value = depthTexture ?? null, this.maskMat.uniforms.useMain.value = depthTexture ? 1 : 0;
  }
  setSize(width, height) {
    this.rt.setSize(width, height), this.maskRT.setSize(width, height), this.tmpRT.setSize(width, height), this.maskMat.uniforms.texel.value.set(1 / width, 1 / height), this.maskMat.uniforms.pxScale.value = height / 1920;
  }
  render(renderer, inputBuffer) {
    let scene = this.world, cam = this.cam, autoClear = renderer.autoClear, shadowAuto = renderer.shadowMap.autoUpdate, mask = cam.layers.mask, override = scene.overrideMaterial, background = scene.background;
    renderer.getClearColor(this.clearCol);
    let clearAlpha = renderer.getClearAlpha();
    renderer.autoClear = !1, cam.layers.disable(NOINK), scene.overrideMaterial = this.normalMat, scene.background = null, renderer.shadowMap.autoUpdate = !1, renderer.setClearColor(0, 0), renderer.setRenderTarget(this.rt), renderer.clear(!0, !0, !1), renderer.render(scene, cam), cam.layers.mask = mask, scene.overrideMaterial = override, scene.background = background, renderer.shadowMap.autoUpdate = shadowAuto, renderer.setClearColor(this.clearCol, clearAlpha);
    let u = this.maskMat.uniforms, e = cam.projectionMatrix.elements;
    u.cNear.value = cam.near, u.cFar.value = cam.far, u.p00.value = e[0], u.p11.value = e[5];
    let fog = scene.fog;
    fog && fog.isFog ? (u.fogRange.value.set(fog.near, fog.far), this.compMat.uniforms.fogColor.value.copy(fog.color)) : u.fogRange.value.set(0, 0), this.quad.material = this.maskMat, renderer.setRenderTarget(this.maskRT), renderer.render(this.fsScene, this.fsCam), this.compMat.uniforms.inputBuffer.value = inputBuffer.texture, this.compMat.uniforms.debug.value = this.debug, this.quad.material = this.compMat, renderer.setRenderTarget(this.tmpRT), renderer.render(this.fsScene, this.fsCam), this.quad.material = this.copyMat, renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer), renderer.render(this.fsScene, this.fsCam), renderer.autoClear = autoClear;
  }
  dispose() {
    this.rt.depthTexture?.dispose(), this.rt.dispose(), this.maskRT.dispose(), this.tmpRT.dispose(), this.normalMat.dispose(), this.maskMat.dispose(), this.compMat.dispose(), this.copyMat.dispose(), this.quad.geometry.dispose();
  }
};

// vendor/cartoon3d/src/stage.ts
var V = (a) => new THREE5.Vector3(a[0], a[1], a[2]), rad2 = (d) => d * Math.PI / 180, clamp2 = (x, a, b) => Math.max(a, Math.min(b, x)), NIGHT = {
  ...LIGHTS.day,
  az: 40,
  el: 38,
  lit: [0.62, 0.72, 1.12],
  shade: [0.1, 0.11, 0.24],
  lift: [0.03, 0.04, 0.1],
  lambert: 0.35,
  sideK: 0.8,
  term: 0.15,
  charTint: [0.78, 0.84, 1],
  charShade: 0.82,
  charGrad: 0.09,
  bodyGrad: 0.24,
  sideTint: [0.8, 0.82, 0.98],
  blob: [0.55, 0.55, 0.66],
  actorShadow: !1,
  top: "#0d1b3d",
  hor: "#3a4f86",
  fog: "#2d3d6b",
  fogNear: 18,
  fogFar: 200,
  sunDisc: "#000000",
  sunCol: "#a8baff",
  sunI: 1.6,
  sky: "#3a4f86",
  ground: "#2a2a3a",
  hemiI: 0.4
}, INTERIOR = {
  ...LIGHTS.golden,
  az: 60,
  el: 35,
  lit: [1.42, 1.08, 0.72],
  shade: [0.2, 0.15, 0.24],
  lift: [0.05, 0.04, 0.08],
  lambert: 0.35,
  sideK: 0.85,
  term: 0.18,
  charTint: [1, 0.86, 0.7],
  charShade: 0.86,
  charGrad: 0.09,
  bodyGrad: 0.22,
  sideTint: [0.86, 0.8, 0.92],
  blob: [0.6, 0.55, 0.6],
  actorShadow: !1,
  top: "#3a2a2a",
  hor: "#6b4a3a",
  fog: "#4a3530",
  fogNear: 30,
  fogFar: 260,
  sunDisc: "#000000",
  sunCol: "#ffcf8a",
  sunI: 3,
  sky: "#c89a7a",
  ground: "#5a4030",
  hemiI: 0.5
}, LIGHT_PRESETS = { day: LIGHTS.day, golden: LIGHTS.golden, night: NIGHT, interior: INTERIOR }, LOOKS = {
  day: LOOK.day,
  golden: LOOK.golden,
  night: { ...LOOK.day, sky: { c: ["#3a4f86", "#2c3f75", "#1f2f5e", "#16244c", "#0d1b3d"], e: [0, 4, 10, 20, 40] }, cloud: { lit: "#9aa8d0", mid: "#6f7fae", shade: "#4a5888" }, sat: 1, bounce: [0, 0, 0] },
  interior: { ...LOOK.golden, sky: { c: ["#6b4a3a", "#5a3e34", "#4a332e", "#3e2b28", "#3a2a2a"], e: [0, 4, 10, 20, 40] }, sat: 1.05, bounce: [0.03, 0.015, 0] }
}, GRADES = {
  day: { ky: [0, 0.1, 0.28, 0.6, 0.835, 0.945, 1], sat: [1, 1.05, 1], tintS: [0.01, 2e-3], tintM: [0, 0], tintH: [6e-3, 0], vig: [0.12, 0.45] },
  golden: { ky: [0, 0.09, 0.245, 0.54, 0.8, 0.93, 1], sat: [1, 1.12, 1.15], tintS: [0.02, 2e-3], tintM: [0, 0], tintH: [-0.012, 6e-3], vig: [0.2, 0.4] },
  night: { ky: [0, 0.09, 0.25, 0.55, 0.81, 0.935, 1], sat: [0.95, 1.05, 1], tintS: [0.03, -4e-3], tintM: [0.01, 0], tintH: [0, 0], vig: [0.22, 0.4] },
  interior: { ky: [0, 0.09, 0.25, 0.56, 0.82, 0.94, 1], sat: [1, 1.1, 1.1], tintS: [0.02, 4e-3], tintM: [0, 4e-3], tintH: [-0.01, 6e-3], vig: [0.22, 0.4] }
}, KX = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
function monoTangents(ky) {
  let n = KX.length, h = [], d = [], m = new Array(n).fill(0);
  for (let k = 0; k < n - 1; k++)
    h.push(KX[k + 1] - KX[k]), d.push((ky[k + 1] - ky[k]) / h[k]);
  m[0] = d[0], m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) {
      m[k] = 0;
      continue;
    }
    let w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1];
    m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
  }
  return m;
}
var tintRGB = (cb, cr) => new THREE5.Vector3(cr * 1.5748, cb * -0.18733 + cr * -0.46813, cb * 1.8556), FS_VERT2 = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }", SKY_VERT = "varying vec3 vDir; void main(){ vDir = (modelMatrix * vec4(position, 0.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }", SKY_FRAG = `uniform vec3 c[5]; uniform float e[5]; varying vec3 vDir;
void main(){ float el = degrees(asin(clamp(normalize(vDir).y, -1.0, 1.0))); vec3 col = c[0];
  for (int i = 1; i < 5; i++) col = mix(col, c[i], smoothstep(e[i-1], e[i], el));
  gl_FragColor = vec4(col, 1.0); }`, DOF_FRAG = `#include <packing>
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
}`, FINAL_FRAG = `uniform sampler2D tColor; uniform float ky[7]; uniform float km[7]; uniform vec3 sat; uniform vec3 tS; uniform vec3 tM; uniform vec3 tH;
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
}`, LRU = 420, DrawCache = class {
  constructor() {
    __publicField(this, "m", /* @__PURE__ */ new Map());
    __publicField(this, "pinned", /* @__PURE__ */ new Set());
  }
  /** never evicted (posters keep their texture for the whole video) */
  pin(key) {
    this.pinned.add(key);
  }
  get(key, w, h, k, draw, soft = !1) {
    let t = this.m.get(key);
    if (t)
      return this.m.delete(key), this.m.set(key, t), t;
    let cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(w)), cv.height = Math.max(2, Math.round(h));
    let g = cv.getContext("2d");
    if (g.setTransform(k, 0, 0, k, 0, 0), draw(new Pen(g)), t = new THREE5.CanvasTexture(cv), t.colorSpace = THREE5.SRGBColorSpace, t.anisotropy = 8, soft && (t.generateMipmaps = !1, t.minFilter = THREE5.LinearFilter), this.m.set(key, t), this.m.size > LRU) {
      for (let [k0, old] of this.m)
        if (!this.pinned.has(k0)) {
          this.m.delete(k0), old.dispose();
          break;
        }
    }
    return t;
  }
}, q = (v, n = 100) => Math.round(v * n) / n;
function contrastRatio(a, b) {
  let L = (hex) => {
    let c = new THREE5.Color(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  }, x = L(a), y = L(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function captureText(g, run) {
  let seen = [], own = g, fill = g.fillText, stroke = g.strokeText, rec = (t, x, y) => {
    try {
      let s = String(t ?? "").trim();
      if (!/[\p{L}\p{N}][\s\S]*[\p{L}\p{N}]/u.test(s)) return;
      let m = /(\d+(?:\.\d+)?)px/.exec(g.font);
      if (!m) return;
      let T = g.getTransform(), mt = g.measureText(s), sy = Math.hypot(T.c, T.d) || 1, xs = [x - mt.actualBoundingBoxLeft, x + mt.actualBoundingBoxRight], ys = [y - mt.actualBoundingBoxAscent, y + mt.actualBoundingBoxDescent], pts = xs.flatMap((px) => ys.map((py) => T.transformPoint(new DOMPoint(px, py))));
      seen.push({ text: s.slice(0, 40), px: Number(m[1]) * sy, x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) });
    } catch {
    }
  };
  own.fillText = function(t, x, y, mw) {
    return rec(t, x, y), mw === void 0 ? fill.call(g, t, x, y) : fill.call(g, t, x, y, mw);
  }, own.strokeText = function(t, x, y, mw) {
    return rec(t, x, y), mw === void 0 ? stroke.call(g, t, x, y) : stroke.call(g, t, x, y, mw);
  };
  try {
    run();
  } finally {
    delete own.fillText, delete own.strokeText;
  }
  if (!seen.length) return null;
  let big = seen.reduce((a, b) => b.px > a.px * 1.02 ? b : a), W = g.canvas.width, H = g.canvas.height, x0 = clamp2(Math.floor(big.x0), 0, W - 1), y0 = clamp2(Math.floor(big.y0), 0, H - 1), x1 = clamp2(Math.ceil(big.x1), x0 + 1, W), y1 = clamp2(Math.ceil(big.y1), y0 + 1, H), contrast = 21;
  try {
    let d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data, lum = [], step = Math.max(1, Math.floor(d.length / 4 / 4e4)), lin = (v) => (v /= 255, v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    for (let i = 0; i < d.length; i += 4 * step) d[i + 3] >= 128 && lum.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
    if (lum.length >= 20) {
      lum.sort((a, b) => a - b);
      let lo = lum[Math.floor(lum.length * 0.1)];
      contrast = (lum[Math.floor(lum.length * 0.9)] + 0.05) / (lo + 0.05);
    }
  } catch {
  }
  return { text: big.text, cap: big.px * 0.72 / H, cx: (big.x0 + big.x1) / 2 / W, cy: (big.y0 + big.y1) / 2 / H, bw: (big.x1 - big.x0) / W, bh: (big.y1 - big.y0) / H, contrast };
}
var OUTFITS = {
  townsfolk,
  soldier,
  kid: KID,
  parent: PARENT,
  officer: OFFICER,
  rifleman: RIFLEMAN,
  police: { jacket: "#2c3e70", pants: "#22283a", boots: INK, hat: "shako", buttons: "#e8c45a", belt: "#1b1b22", build: "stout" },
  gangster: { jacket: "#3a3a46", pants: "#2b2b33", boots: "#1c1c22", hat: "tophat", buttons: "#d9dde0", moustache: "#2a201a", skin: "#f5c9a0" },
  barman: { jacket: "#f1efe6", pants: "#2b2b33", boots: "#3a2a20", hat: "hair", hair: "#3a2618", moustache: "#3a2618", belt: "#7a2a2a" },
  flapper: { jacket: "#c25a7a", pants: "#3b3f52", boots: "#2b2b33", hat: "bonnet", dress: "#c25a7a", skin: "#ffe2c2" },
  worker: { jacket: "#5d7a3a", pants: "#3b3f52", boots: "#4a3426", hat: "cap", cap: "#6b5a44", skin: "#ecd0b6" },
  preacher: { jacket: "#22222a", pants: "#22222a", boots: "#111116", hat: "tophat", buttons: "#d9dde0", skin: "#f5c9a0" },
  reporter: { jacket: "#8c6a4a", pants: "#4a4038", boots: "#3a2a20", hat: "cap", cap: "#5a4a3a", skin: "#ffe2c2" }
};
var ease = (x) => {
  let t = clamp2(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
function blink(t, seed = 1) {
  let at = 0.4 + Math.abs(Math.sin(seed * 12.9898)) % 1 * 1.2, i = 0;
  for (; at < t + 1; ) {
    let d = t - at;
    if (d >= 0 && d < 4 / 30) return d < 1 / 30 || d >= 3 / 30 ? 0.5 : 1;
    if (i++, at += 0.5 + Math.abs(Math.sin((seed + i) * 78.233)) % 1 * 1.8, i > 400) break;
  }
  return 0;
}
function kick(t, at, amp = 1) {
  let f = Math.floor((t - at) * 30);
  return f < 0 || f > 7 ? 0 : amp * (f % 2 ? -1 : 1) * (1 - f / 8);
}
function camAt(keys, t, creep = 25e-4) {
  let ks = keys.slice().sort((a2, b2) => a2.t - b2.t), i = 0;
  for (; i < ks.length - 1 && ks[i + 1].t <= t; ) i++;
  let a = ks[i], b = ks[i + 1], pos = V(a.pos), look = V(a.look), fov = a.fov ?? 40, roll = a.roll ?? 0, held = t - a.t;
  if (b && !b.cut && t > a.t) {
    let u = ease((t - a.t) / Math.max(1e-3, b.t - a.t));
    pos = pos.lerp(V(b.pos), u), look = look.lerp(V(b.look), u), fov += ((b.fov ?? 40) - fov) * u, roll += ((b.roll ?? 0) - roll) * u, held = 0;
  }
  if (held > 0 && creep > 0) {
    let k = 1 - Math.min(0.3, creep * held * 30);
    pos = look.clone().add(pos.clone().sub(look).multiplyScalar(k));
  }
  return { pos: [pos.x, pos.y, pos.z], look: [look.x, look.y, look.z], fov, roll };
}
var SU = 216e-5, Actor = class {
  constructor(st, outfit, opts = {}) {
    this.st = st;
    __publicField(this, "mesh");
    __publicField(this, "blobMesh");
    __publicField(this, "o");
    __publicField(this, "s");
    __publicField(this, "mat");
    __publicField(this, "dmat");
    this.o = outfit, this.s = { x: 0, y: 0, z: 0, scale: 1, seed: 1, res: 0.6, mode: "stand", phase: 0, expr: "neutral", visible: !0, shadow: !0, ...opts };
    let blank = st.blank;
    this.mat = cardShade(new THREE5.MeshLambertMaterial({ map: blank, alphaTest: 0.5, side: THREE5.DoubleSide })), this.dmat = new THREE5.MeshDepthMaterial({ depthPacking: THREE5.RGBADepthPacking, map: blank, alphaTest: 0.5, side: THREE5.DoubleSide }), this.mesh = new THREE5.Mesh(st.bodyGeo, this.mat), this.mesh.customDepthMaterial = this.dmat, this.mesh.onBeforeRender = (r) => {
      let rt = r.getRenderTarget();
      CARD_K.uPx.value = (rt ? rt.height : r.domElement.height) / 1920;
    }, this.mesh.receiveShadow = !0, this.mesh.renderOrder = 1, this.mesh.rotation.order = "YXZ", this.mesh.layers.set(NOINK), this.blobMesh = new THREE5.Mesh(st.flatGeo, blobMaterial(blank)), this.blobMesh.rotation.x = -Math.PI / 2, this.blobMesh.renderOrder = 0.5, this.blobMesh.layers.set(NOINK), st.world.add(this.mesh, this.blobMesh);
  }
  /** change pose / position (call inside seek(t)); unspecified fields keep their value */
  set(o) {
    return Object.assign(this.s, o), this;
  }
  /** internal: draw + place for this frame */
  update(cam, lightAng) {
    let s = this.s;
    if (this.mesh.visible = this.blobMesh.visible = s.visible !== !1, !this.mesh.visible) return;
    let k = clamp2(s.res ?? 0.6, 0.3, 1.2), outfitKey = JSON.stringify(this.o), la = Math.round(lightAng / rad2(10)) * rad2(10), key = s.side ? `side|${outfitKey}|${s.mode}|${q(s.phase ?? 0, 24)}|${s.expr}|${q(+(s.blink ?? 0), 2)}|${s.seed}|${q(s.stride ?? 1, 10)}|${la}|${k}` : `front|${outfitKey}|${s.mode}|${q(s.phase ?? 0, 24)}|${s.expr}|${q(s.look ?? 0, 4)}|${q(+(s.blink ?? 0), 2)}|${q(s.wave ?? -1, 12)}|${JSON.stringify(s.prop ?? null)}|${q(s.tilt ?? 0, 20)}|${q(s.headTilt ?? 0, 20)}|${s.facing ?? 0}|${s.seed}|${la}|${k}`, tex = this.st.cache.get(key, 600 * k, 1e3 * k, k, (p) => {
      s.side ? bodySide(p, this.o, { phase: s.phase, expr: s.expr, mode: s.mode === "stroll" || s.mode === "march" ? "march" : "stand", blink: s.blink, stride: s.stride, light: la, seed: s.seed }) : bodyFront(p, this.o, { phase: s.phase, expr: s.expr, mode: s.mode, look: s.look, blink: s.blink, wave: s.wave, prop: s.prop ?? null, tilt: s.tilt, headTilt: s.headTilt, light: la, facing: s.facing, seed: s.seed });
    });
    this.mat.map = tex, this.dmat.map = tex;
    let sc = s.scale ?? 1;
    this.mesh.position.set(s.x ?? 0, s.y ?? 0, s.z ?? 0), this.mesh.scale.set(sc * (s.mirror ? -1 : 1), sc, sc), this.mesh.rotation.y = Math.atan2(cam.position.x - (s.x ?? 0), cam.position.z - (s.z ?? 0)), this.mesh.castShadow = this.st.preset.actorShadow;
    let c = this.st.preset.blob, hex = "#" + new THREE5.Color(c[0], c[1], c[2]).getHexString();
    this.blobMesh.material.map = this.st.cache.get(`blob|${hex}`, 128, 128, 1, (p) => fxContact(p, hex), !0), this.blobMesh.visible = this.mesh.visible && s.shadow !== !1 && s.mode !== "sit", this.blobMesh.position.set(s.x ?? 0, (s.y ?? 0) + 0.02, s.z ?? 0), this.blobMesh.scale.set(0.95 * sc, 0.5 * sc, 1), this.blobMesh.rotation.z = -this.mesh.rotation.y;
  }
}, Stage = class {
  constructor(o = {}) {
    __publicField(this, "renderer");
    __publicField(this, "scene", new THREE5.Scene());
    __publicField(this, "world", new THREE5.Group());
    __publicField(this, "camera");
    __publicField(this, "W");
    __publicField(this, "H");
    __publicField(this, "preset", LIGHTS.day);
    __publicField(this, "look", LOOK.day);
    __publicField(this, "lightName", "day");
    __publicField(this, "cache", new DrawCache());
    __publicField(this, "blank");
    __publicField(this, "bodyGeo");
    __publicField(this, "flatGeo", new THREE5.PlaneGeometry(1, 1));
    __publicField(this, "actors", []);
    __publicField(this, "flash", 0);
    __publicField(this, "exposure", 1);
    __publicField(this, "dof", { focus: 0, cInf: 0 });
    __publicField(this, "sun", new THREE5.DirectionalLight());
    __publicField(this, "hemi", new THREE5.HemisphereLight());
    __publicField(this, "sky");
    __publicField(this, "skyMat");
    __publicField(this, "rtMain");
    __publicField(this, "rtDof");
    __publicField(this, "ink");
    __publicField(this, "dofMat");
    __publicField(this, "finalMat");
    __publicField(this, "fsScene", new THREE5.Scene());
    __publicField(this, "fsCam", new THREE5.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    __publicField(this, "quad");
    __publicField(this, "cards", []);
    __publicField(this, "cardUse", 0);
    __publicField(this, "cardMats", /* @__PURE__ */ new Map());
    __publicField(this, "sunFrozen", null);
    // ---------------- world building ----------------
    __publicField(this, "mats", /* @__PURE__ */ new Map());
    // ---------------- scene check (read by FilmForge after the render) ----------------
    /**
     * One entry per render(). frames: status per actor — 0 ok, 1 face cut (eyes outside the frame), 2 cut at the side
     * (less than 60 % of the body width inside), 3 out of the frame, 4 face BLOCKED by something in front, 5 half of the
     * body hidden behind something, -1 hidden (visible: false).
     * signs: per sign — -1 not on screen, 0 readable, 1 letters too small, 2 seen too obliquely, 3 covered, 4 low contrast, 5 cut by the frame edge.
     * jumps: abrupt colour changes of a material between two frames (and light preset switches).
     */
    __publicField(this, "framing", { names: [], frames: [], signNames: [], signs: [], jumps: [] });
    /** readable texts: sign boards, and the biggest text written (fillText) in a poster or a per-frame draw card.
     *  gw/gh = geometry size; ox/oy (centre), hw/hh (half size) and lh (cap height) are fractions of it. */
    __publicField(this, "signs", []);
    __publicField(this, "textInfo", /* @__PURE__ */ new Map());
    __publicField(this, "ray", new THREE5.Raycaster());
    __publicField(this, "lastCol", /* @__PURE__ */ new Map());
    __publicField(this, "lastLight", "");
    __publicField(this, "posters", []);
    this.W = o.width ?? 1080, this.H = o.height ?? 1920;
    let canvas = o.canvas ?? document.getElementById("c") ?? document.body.appendChild(document.createElement("canvas"));
    canvas.width = this.W, canvas.height = this.H, this.renderer = new THREE5.WebGLRenderer({ canvas, antialias: !1, preserveDrawingBuffer: !0, powerPreference: "high-performance" }), this.renderer.setPixelRatio(1), this.renderer.setSize(this.W, this.H, !1), this.renderer.shadowMap.enabled = !0, this.renderer.shadowMap.type = THREE5.PCFSoftShadowMap, this.renderer.shadowMap.autoUpdate = !0, this.renderer.toneMapping = THREE5.NoToneMapping, this.renderer.outputColorSpace = THREE5.SRGBColorSpace, this.camera = new THREE5.PerspectiveCamera(40, this.W / this.H, 0.2, 1500), this.camera.layers.enable(NOINK);
    let bc = document.createElement("canvas");
    bc.width = bc.height = 2, this.blank = new THREE5.CanvasTexture(bc), this.bodyGeo = new THREE5.PlaneGeometry(600 * SU, 1e3 * SU), this.bodyGeo.translate(0, 475 * SU, 0), this.scene.add(this.world, this.sun, this.sun.target, this.hemi), this.sun.castShadow = !0, this.sun.shadow.mapSize.set(2048, 2048);
    let sc = this.sun.shadow.camera;
    sc.left = -28, sc.right = 28, sc.top = 28, sc.bottom = -28, sc.near = 1, sc.far = 160, this.skyMat = new THREE5.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE5.BackSide,
      depthWrite: !1,
      fog: !1,
      uniforms: { c: { value: [0, 1, 2, 3, 4].map(() => new THREE5.Color()) }, e: { value: [0, 3, 8, 16, 40] } }
    }), this.sky = new THREE5.Mesh(new THREE5.SphereGeometry(900, 32, 16), this.skyMat), this.sky.renderOrder = -10, this.sky.frustumCulled = !1, this.sky.layers.set(NOINK), this.scene.add(this.sky);
    let rtOpts = { type: THREE5.HalfFloatType, depthBuffer: !0, generateMipmaps: !1, minFilter: THREE5.LinearFilter, magFilter: THREE5.LinearFilter };
    this.rtMain = new THREE5.WebGLRenderTarget(this.W, this.H, { ...rtOpts, samples: 4, depthTexture: new THREE5.DepthTexture(this.W, this.H, THREE5.UnsignedIntType) }), this.rtDof = new THREE5.WebGLRenderTarget(this.W, this.H, { ...rtOpts, depthBuffer: !1 }), this.ink = new InkPass(this.scene, this.camera), this.ink.setSize(this.W, this.H), this.ink.setDepthTexture(this.rtMain.depthTexture);
    let fs = (frag, uniforms) => new THREE5.ShaderMaterial({ vertexShader: FS_VERT2, fragmentShader: frag, uniforms, depthTest: !1, depthWrite: !1 });
    this.dofMat = fs(DOF_FRAG, {
      tColor: { value: this.rtMain.texture },
      tDepth: { value: this.rtMain.depthTexture },
      texel: { value: new THREE5.Vector2(1 / this.W, 1 / this.H) },
      cNear: { value: 0.2 },
      cFar: { value: 1500 },
      focus: { value: 10 },
      cInf: { value: 0 },
      nearScale: { value: 1.2 },
      maxCoC: { value: 24 },
      pxs: { value: this.H / 1920 }
    }), this.finalMat = fs(FINAL_FRAG, {
      tColor: { value: this.rtDof.texture },
      ky: { value: [] },
      km: { value: [] },
      sat: { value: new THREE5.Vector3() },
      tS: { value: new THREE5.Vector3() },
      tM: { value: new THREE5.Vector3() },
      tH: { value: new THREE5.Vector3() },
      vig: { value: new THREE5.Vector2() },
      amount: { value: 1 },
      flash: { value: 0 },
      exposure: { value: 1 }
    }), this.quad = new THREE5.Mesh(new THREE5.PlaneGeometry(2, 2), this.dofMat), this.quad.frustumCulled = !1, this.fsScene.add(this.quad), this.setLight(o.light ?? "day");
  }
  /** "day" (blue sky, high sun), "golden" (backlit sunset), "night" (moonlight), "interior" (warm lamps) */
  setLight(name) {
    this.lightName = name;
    let P = this.preset = LIGHT_PRESETS[name] ?? LIGHTS.day, L = this.look = LOOKS[name] ?? LOOK.day;
    TONE.uLitCol.value.set(...P.lit), TONE.uShadeCol.value.set(...P.shade), TONE.uShadeLift.value.set(...P.lift), TONE.uLambert.value = P.lambert, TONE.uSideK.value = P.sideK, TONE.uTerm.value = P.term, TONE.uSat.value = L.sat, TONE.uBounce.value.set(...L.bounce), CHAR.uCharTint.value.set(...P.charTint), CHAR.uCharShade.value = P.charShade, CHAR.uGrad.value = P.charGrad, CHAR.uBodyGrad.value = P.bodyGrad, CHAR.uSideTint.value.set(...P.sideTint), this.sun.color.set(P.sunCol), this.sun.intensity = P.sunI, this.sun.shadow.bias = P.bias, this.sun.shadow.normalBias = P.normalBias, this.hemi.color.set(P.sky), this.hemi.groundColor.set(P.ground), this.hemi.intensity = P.hemiI, this.scene.fog = new THREE5.Fog(untone(P.fog), P.fogNear, P.fogFar), this.skyMat.uniforms.c.value.forEach((c, i) => untone(L.sky.c[i], c)), this.skyMat.uniforms.e.value = L.sky.e.slice();
    let G = GRADES[name], u = this.finalMat.uniforms;
    return u.ky.value = G.ky.slice(), u.km.value = monoTangents(G.ky), u.sat.value.set(...G.sat), u.tS.value = tintRGB(...G.tintS), u.tM.value = tintRGB(...G.tintM), u.tH.value = tintRGB(...G.tintH), u.vig.value.set(...G.vig), this;
  }
  /** sun fixed in the world (else it follows each camera: az/el of the preset relative to the camera forward) */
  freezeSun(dir) {
    return this.sunFrozen = dir ? V(dir).normalize() : null, this;
  }
  /** place the camera: pos, look-at point, vertical fov (deg), roll (deg); returns the stage */
  cam(pos, look, fov = 40, roll = 0) {
    let c = this.camera;
    return c.fov = fov, c.position.set(...pos), c.up.set(0, 1, 0), c.lookAt(...look), c.rotateZ(rad2(roll)), c.updateProjectionMatrix(), this.dof.focus = c.position.distanceTo(V(look)), this;
  }
  /** apply a camAt() result */
  camFrom(k, shake = [0, 0, 0]) {
    return this.cam([k.pos[0] + shake[0], k.pos[1] + shake[1], k.pos[2] + shake[2]], k.look, k.fov, k.roll);
  }
  /** two-tone world material: colour hex or a painted texture */
  mat(key, make) {
    let m = this.mats.get(key);
    return m || (m = twoTone(new THREE5.MeshLambertMaterial(make())), this.mats.set(key, m)), m;
  }
  color(hex) {
    return this.mat("c" + hex, () => ({ color: hex }));
  }
  add(o, cast = !0) {
    return o.traverse((c) => {
      let m = c;
      m.isMesh && (m.castShadow = cast, m.receiveShadow = !0);
    }), this.world.add(o), o;
  }
  mesh(geo, mat, at = [0, 0, 0], yaw = 0) {
    let m = new THREE5.Mesh(geo, typeof mat == "string" ? this.color(mat) : mat);
    return m.position.set(...at), m.rotation.y = rad2(yaw), this.add(m);
  }
  /** painted ground: "cobble" | "grass" | "stone" | "planks" | "dirt" | a colour hex; size in metres (square) */
  ground(kind = "cobble", size = 140, at = [0, 0, 0]) {
    let n = size / 6, mat = kind === "cobble" ? this.mat("gcob" + n, () => ({ map: rep(cobbleHD(), n, n) })) : kind === "grass" ? this.mat("ggr" + n, () => ({ map: rep(grassHD(), n, n) })) : kind === "stone" ? this.mat("gst" + n, () => ({ map: rep(stoneHD(), n, n) })) : kind === "planks" ? this.mat("gpl" + n, () => ({ map: rep(planksHD(), n / 1.5, n / 1.5) })) : kind === "dirt" ? this.color("#a07a55") : this.color(kind), g = new THREE5.PlaneGeometry(size, size);
    g.rotateX(-Math.PI / 2);
    let m = new THREE5.Mesh(g, mat);
    return m.position.set(...at), m.castShadow = !1, m.receiveShadow = !0, m.name = "ch\xE3o " + kind, this.world.add(m), m;
  }
  /** gabled painted house; facade (with door) faces local +z; yaw in degrees; style 0..5 or custom colours */
  house(o = {}) {
    let STY = [
      { wall: "#e8d7b0", shutter: "#3f6fb5", roof: "#b5553c" },
      { wall: "#c9714f", shutter: "#2f5f6a", roof: "#5a4a48", brick: !0 },
      { wall: "#d9a441", shutter: "#8c3b4a", roof: "#7a3f32" },
      { wall: "#efe6d2", shutter: "#5d7a3a", roof: "#8f97a8", timber: !0 },
      { wall: "#b7c3a0", shutter: "#7b5ac9", roof: "#a94a36" },
      { wall: "#e2b7a0", shutter: "#3b5b9a", roof: "#6b5a54" }
    ], si = o.style ?? 0, st = {
      ...STY[si % STY.length],
      ...o.wall ? { wall: o.wall } : {},
      ...o.shutter ? { shutter: o.shutter } : {},
      ...o.roof ? { roof: o.roof } : {},
      ...o.brick !== void 0 ? { brick: o.brick } : {},
      ...o.timber !== void 0 ? { timber: o.timber } : {}
    }, w = o.w ?? 7, d = o.d ?? 7, h = o.h ?? 8.4, hw = w / 2, hd = d / 2, rh = d * 0.42, ov = 0.35, key = `${st.wall}${st.shutter}${st.brick ? "b" : ""}${st.timber ? "t" : ""}`, front = this.mat(`hf${key}_${w}_${h}_${o.door !== !1}`, () => ({ map: facadeHD(`hf${key}_${w}_${h}_${o.door !== !1}`, w, h, { ...st, door: o.door !== !1 }) })), side = this.mat(`hs${key}_${h}`, () => ({ map: facadeHD(`hs${key}_${h}`, 8, h, st) })), gable = this.color(st.brick ? "#c8643f" : st.wall), roof = this.mat("roof" + st.roof, () => ({ map: roofHD(st.roof, st.roof === "#8f97a8"), side: THREE5.DoubleSide })), g = new THREE5.Group(), quad = (pts, m, u = 1, v = 1) => {
      let [a, b, c, dd] = pts.map((p) => new THREE5.Vector3(p[0], p[1], p[2])), geo = new THREE5.BufferGeometry(), n = new THREE5.Vector3().subVectors(b, a).cross(new THREE5.Vector3().subVectors(dd, a)).normalize();
      geo.setAttribute("position", new THREE5.Float32BufferAttribute([a, b, c, a, c, dd].flatMap((p) => [p.x, p.y, p.z]), 3)), geo.setAttribute("normal", new THREE5.Float32BufferAttribute(new Array(6).fill(0).flatMap(() => [n.x, n.y, n.z]), 3)), geo.setAttribute("uv", new THREE5.Float32BufferAttribute([0, 0, u, 0, u, v, 0, 0, u, v, 0, v], 2)), g.add(new THREE5.Mesh(geo, m));
    }, tri = (pts, m) => {
      let [a, b, c] = pts.map((p) => new THREE5.Vector3(p[0], p[1], p[2])), geo = new THREE5.BufferGeometry(), n = new THREE5.Vector3().subVectors(b, a).cross(new THREE5.Vector3().subVectors(c, a)).normalize();
      geo.setAttribute("position", new THREE5.Float32BufferAttribute([a, b, c].flatMap((p) => [p.x, p.y, p.z]), 3)), geo.setAttribute("normal", new THREE5.Float32BufferAttribute([0, 1, 2].flatMap(() => [n.x, n.y, n.z]), 3)), geo.setAttribute("uv", new THREE5.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2)), g.add(new THREE5.Mesh(geo, m));
    };
    quad([[-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd]], front), quad([[hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd]], side), quad([[-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd]], side), quad([[hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd]], side), tri([[-hw, h, -hd], [-hw, h, hd], [-hw, h + rh, 0]], gable), tri([[hw, h, hd], [hw, h, -hd], [hw, h + rh, 0]], gable);
    let ru = (w + 2 * ov) / 4, rv = Math.hypot(hd + ov, rh) / 4;
    quad([[-hw - ov, h - 0.25, hd + ov], [hw + ov, h - 0.25, hd + ov], [hw + ov, h + rh, 0], [-hw - ov, h + rh, 0]], roof, ru, rv), quad([[hw + ov, h - 0.25, -hd - ov], [-hw - ov, h - 0.25, -hd - ov], [-hw - ov, h + rh, 0], [hw + ov, h + rh, 0]], roof, ru, rv);
    let trim = this.color("#efe3c8"), box = (x0, x1, y0, y1, z0, z1, m) => {
      let b = new THREE5.Mesh(new THREE5.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
      b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), g.add(b);
    };
    box(-hw - 0.07, hw + 0.07, -0.05, 0.45, -hd - 0.07, hd + 0.07, this.mat("plinth", () => ({ map: stoneHD("copeHD") }))), box(-hw - 0.12, hw + 0.12, h - 0.52, h - 0.25, hd, hd + 0.17, trim);
    let cx = hw * 0.45 * (si % 2 ? 1 : -1);
    if (box(cx - 0.4, cx + 0.4, h + rh * 0.3, h + rh + 1.1, -hd * 0.35 - 0.4, -hd * 0.35 + 0.4, this.mat("chim", () => ({ map: rep(brick(), 1, 1) }))), box(cx - 0.52, cx + 0.52, h + rh + 1.1, h + rh + 1.26, -hd * 0.35 - 0.52, -hd * 0.35 + 0.52, this.color("#9a8778")), o.sign) {
      let sg = this.signMesh(o.sign, Math.min(w * 0.7, 4.2), 0.9);
      sg.position.set(0, Math.min(h - 1.2, 3.4), hd + 0.12), g.add(sg);
    }
    return g.position.set(o.x ?? 0, 0, o.z ?? 0), g.rotation.y = rad2(o.yaw ?? 0), g.name = o.sign ? `casa "${o.sign}"` : "casa", this.add(g);
  }
  /** a street along z (from z0 to z0 - length) with painted houses on both sides facing the street */
  street(o = {}) {
    let len = o.length ?? 70, wid = o.width ?? 10, z0 = o.z0 ?? 12, seed = o.seed ?? 3;
    this.ground(o.ground ?? "cobble", Math.max(160, len * 2.4));
    let i = 0;
    for (let s of o.sides === "left" ? [-1] : o.sides === "right" ? [1] : [-1, 1])
      for (let z = z0; z > z0 - len; i++) {
        let w = [6.5, 7.5, 8.5, 7][(i + seed) % 4], h = [7, 8.4, 9.8, 8.4][(i * 3 + seed) % 4], d = 7;
        this.house({ x: s * (wid / 2 + d / 2), z: z - w / 2, yaw: s < 0 ? 90 : -90, w, d, h, style: (i * 5 + seed) % 6 }), z -= w + 0.4;
      }
    let curb = this.mat("curb", () => ({ map: rep(stoneHD(), 20, 1) }));
    for (let s of [-1, 1]) this.mesh(new THREE5.BoxGeometry(0.3, 0.16, len + 20), curb, [s * (wid / 2 - 1.4), 0.08, z0 - len / 2]);
    return this;
  }
  /** a room seen from inside (open toward +z): floor planks, painted walls, optional wainscot */
  room(o = {}) {
    let w = o.w ?? 12, d = o.d ?? 10, h = o.h ?? 4, at = o.at ?? [0, 0, 0], g = new THREE5.Group(), fl = new THREE5.Mesh(new THREE5.PlaneGeometry(w, d).rotateX(-Math.PI / 2), o.floor ? this.color(o.floor) : this.mat("roomfloor", () => ({ map: rep(planksHD(), w / 3, d / 3) }))), wall = this.color(o.wall ?? "#7a3b33"), wain = this.color(o.wainscot ?? "#5a3a26"), back = new THREE5.Mesh(new THREE5.PlaneGeometry(w, h), wall);
    back.position.set(0, h / 2, -d / 2);
    let l = new THREE5.Mesh(new THREE5.PlaneGeometry(d, h), wall);
    l.rotation.y = Math.PI / 2, l.position.set(-w / 2, h / 2, 0);
    let r = new THREE5.Mesh(new THREE5.PlaneGeometry(d, h), wall);
    r.rotation.y = -Math.PI / 2, r.position.set(w / 2, h / 2, 0);
    let ceil = new THREE5.Mesh(new THREE5.PlaneGeometry(w, d).rotateX(Math.PI / 2), this.color("#3a2a24"));
    ceil.position.y = h;
    let wb = new THREE5.Mesh(new THREE5.BoxGeometry(w, 1.1, 0.12), wain);
    return wb.position.set(0, 0.55, -d / 2 + 0.06), g.add(fl, back, l, r, ceil, wb), g.position.set(...at), g.name = "sala", this.add(g, !1);
  }
  /** simple props: "barrel" | "crate" | "bottle" | "table" | "chair" | "lamppost" | "car" | "tree" | "bar" | "door" | "fence" | "box" */
  prop(kind, o = {}) {
    let g = new THREE5.Group(), c = (hex) => this.color(hex), wood = this.mat("propwood", () => ({ map: rep(beamHD(), 1, 1) })), add = (geo, m, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
      let k = new THREE5.Mesh(geo, m);
      return k.position.set(x, y, z), k.rotation.x = rx, k.rotation.z = rz, g.add(k), k;
    };
    switch (kind) {
      case "barrel":
        add(new THREE5.CylinderGeometry(0.42, 0.42, 1, 18), c(o.color ?? "#9a6a3e"), 0, 0.5), add(new THREE5.CylinderGeometry(0.48, 0.48, 0.1, 18), c("#3a3236"), 0, 0.2), add(new THREE5.CylinderGeometry(0.48, 0.48, 0.1, 18), c("#3a3236"), 0, 0.8), add(new THREE5.CylinderGeometry(0.5, 0.5, 0.36, 18), c(o.color ?? "#a8744a"), 0, 0.5);
        break;
      case "crate":
        add(new THREE5.BoxGeometry(0.9, 0.7, 0.9), wood, 0, 0.35);
        break;
      case "bottle":
        add(new THREE5.CylinderGeometry(0.07, 0.08, 0.26, 12), c(o.color ?? "#3f7a4a"), 0, 0.13), add(new THREE5.CylinderGeometry(0.025, 0.06, 0.12, 12), c(o.color ?? "#3f7a4a"), 0, 0.32);
        break;
      case "table":
        add(new THREE5.CylinderGeometry(0.7, 0.7, 0.07, 24), c(o.color ?? "#8a5a3c"), 0, 0.78), add(new THREE5.CylinderGeometry(0.06, 0.06, 0.76, 10), c("#3a2a24"), 0, 0.38), add(new THREE5.CylinderGeometry(0.35, 0.35, 0.04, 16), c("#3a2a24"), 0, 0.02);
        break;
      case "chair":
        add(new THREE5.BoxGeometry(0.45, 0.06, 0.45), c(o.color ?? "#7a4f33"), 0, 0.46), add(new THREE5.BoxGeometry(0.45, 0.5, 0.06), c(o.color ?? "#7a4f33"), 0, 0.72, -0.2);
        for (let [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) add(new THREE5.BoxGeometry(0.05, 0.46, 0.05), c("#3a2a24"), x, 0.23, z);
        break;
      case "lamppost":
        add(new THREE5.CylinderGeometry(0.07, 0.1, 3.6, 10), c("#2b2b33"), 0, 1.8), add(new THREE5.BoxGeometry(0.36, 0.5, 0.36), c("#2b2b33"), 0, 3.75), add(new THREE5.BoxGeometry(0.26, 0.36, 0.26), new THREE5.MeshBasicMaterial({ color: new THREE5.Color(3.2, 2.6, 1.4) }), 0, 3.75);
        break;
      case "car": {
        let body = c(o.color ?? "#1f2a44");
        add(new THREE5.BoxGeometry(3.6, 0.55, 1.6), body, 0, 0.75), add(new THREE5.BoxGeometry(1.9, 0.85, 1.5), body, -0.35, 1.45), add(new THREE5.BoxGeometry(1.2, 0.5, 1.2), c("#2b2b33"), 1.25, 1.15), add(new THREE5.BoxGeometry(1.75, 0.5, 1.52), c("#a9c4d8"), -0.35, 1.5), add(new THREE5.BoxGeometry(3.9, 0.08, 1.9), c("#151518"), 0, 0.5);
        for (let [x, z] of [[-1.15, 0.82], [1.15, 0.82], [-1.15, -0.82], [1.15, -0.82]]) add(new THREE5.CylinderGeometry(0.42, 0.42, 0.22, 20), c("#151518"), x, 0.42, z, Math.PI / 2);
        for (let z of [-0.5, 0.5]) add(new THREE5.SphereGeometry(0.13, 12, 8), new THREE5.MeshBasicMaterial({ color: new THREE5.Color(2.4, 2.2, 1.6) }), 1.88, 1, z);
        break;
      }
      case "tree":
        add(new THREE5.CylinderGeometry(0.18, 0.26, 2.4, 10), c("#8a5a3c"), 0, 1.2), add(new THREE5.IcosahedronGeometry(1.5, 1), c(o.color ?? "#62ae4c"), 0, 3.2), add(new THREE5.IcosahedronGeometry(1.1, 1), c(o.color ?? "#56a447"), 0.8, 2.8, 0.3);
        break;
      case "bar":
        add(new THREE5.BoxGeometry(o.w ?? 5, 1.05, 0.8), wood, 0, 0.525), add(new THREE5.BoxGeometry((o.w ?? 5) + 0.2, 0.08, 1), c("#5a3a26"), 0, 1.09), add(new THREE5.BoxGeometry(o.w ?? 5, 2.2, 0.4), c("#4a2e20"), 0, 1.1 + 0.4, -1.4);
        for (let i = 0; i < 9; i++) for (let y of [1.7, 2.3])
          add(new THREE5.CylinderGeometry(0.06, 0.07, 0.28, 10), c(["#3f7a4a", "#8a5a2a", "#6a2a2a", "#c9a24a"][(i + (y > 2 ? 2 : 0)) % 4]), -((o.w ?? 5) / 2) + 0.4 + i * (((o.w ?? 5) - 0.8) / 8), y, -1.1);
        break;
      case "door":
        add(new THREE5.BoxGeometry(1.1, 2.2, 0.12), c(o.color ?? "#5a3a26"), 0, 1.1), add(new THREE5.BoxGeometry(0.3, 0.12, 0.04), c("#2b2b33"), 0, 1.75, 0.08);
        break;
      case "fence":
        for (let i = 0; i < 7; i++) add(new THREE5.BoxGeometry(0.1, 1, 0.06), c(o.color ?? "#e8dcc0"), -1.5 + i * 0.5, 0.5);
        add(new THREE5.BoxGeometry(3.3, 0.1, 0.05), c(o.color ?? "#e8dcc0"), 0, 0.75, 0.04), add(new THREE5.BoxGeometry(3.3, 0.1, 0.05), c(o.color ?? "#e8dcc0"), 0, 0.3, 0.04);
        break;
      default:
        add(new THREE5.BoxGeometry(o.w ?? 1, o.h ?? 1, o.d ?? 1), c(o.color ?? "#c9a46a"), 0, (o.h ?? 1) / 2);
    }
    return g.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0), g.rotation.y = rad2(o.yaw ?? 0), g.scale.setScalar(o.scale ?? 1), g.name = kind, this.add(g);
  }
  /** painted sign board with short text (unlit face so it stays readable) */
  signMesh(text, w = 3, h = 0.8, bg = "#f6ecd2", fg = "#2b1b1e") {
    let tex = ctex(`sign|${text}|${bg}|${fg}|${w}x${h}`, Math.round(256 * w), Math.round(256 * h), (g) => {
      let W = g.canvas.width, H = g.canvas.height;
      g.fillStyle = bg, g.fillRect(0, 0, W, H), g.lineWidth = Math.max(8, H * 0.08), g.strokeStyle = fg, g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth), g.fillStyle = fg, g.textAlign = "center", g.textBaseline = "middle";
      let fs = H * 0.6;
      for (g.font = `900 ${fs}px Georgia, serif`; g.measureText(text).width > W * 0.88 && fs > 10; )
        fs -= 2, g.font = `900 ${fs}px Georgia, serif`;
      g.fillText(text, W / 2, H / 2 + fs * 0.04);
    });
    tex.wrapS = tex.wrapT = THREE5.ClampToEdgeWrapping;
    let m = new THREE5.Mesh(new THREE5.BoxGeometry(w, h, 0.08), [
      this.color("#3a2a24"),
      this.color("#3a2a24"),
      this.color("#3a2a24"),
      this.color("#3a2a24"),
      new THREE5.MeshBasicMaterial({ map: tex }),
      this.color("#3a2a24")
    ]);
    m.name = `letreiro "${text}"`;
    let fit = Math.min(1, 0.88 * w / Math.max(1e-6, 0.6 * h * 0.62 * text.length));
    return this.signs.push({ mesh: m, text, gw: w, gh: h, contrast: contrastRatio(bg, fg), ox: 0, oy: 0, hw: 0.44, hh: 0.35, lh: 0.6 * fit * 0.72 }), m;
  }
  sign(text, o = {}) {
    let m = this.signMesh(text, o.w ?? 3, o.h ?? 0.8, o.bg, o.fg);
    return m.position.set(o.x ?? 0, o.y ?? 2.5, o.z ?? 0), m.rotation.y = rad2(o.yaw ?? 0), this.add(m);
  }
  /** drifting painted clouds far away (unlit cards on the NOINK layer) */
  clouds(n = 6, seed = 1) {
    let pal = this.lightName === "golden" ? CLOUD_GOLD : this.lightName === "night" ? { lit: "#9aa8d0", mid: "#6f7fae", shade: "#4a5888" } : CLOUD_DAY;
    for (let i = 0; i < n; i++) {
      let tex = cloudHD(seed * 7 + i, pal), m = new THREE5.Mesh(new THREE5.PlaneGeometry(1, 1), new THREE5.MeshBasicMaterial({ map: tex, transparent: !0, depthWrite: !1, fog: !1 })), a = rad2(-60 + 120 * i / Math.max(1, n - 1) + 9 * Math.sin(i * 3.1)), r = 380, el = rad2(8 + 10 * (i * 37 % 7) / 7);
      m.position.set(Math.sin(a) * r * Math.cos(el), r * Math.sin(el), -Math.cos(a) * r * Math.cos(el)), m.scale.set(130, 65, 1), m.lookAt(0, m.position.y, 0), m.renderOrder = -9, m.layers.set(NOINK), this.scene.add(m);
    }
    return this;
  }
  // ---------------- characters & cards ----------------
  /** a lit flat cartoon character (yaw-only billboard). Pose it every frame with actor.set({...}). */
  actor(outfit, opts = {}) {
    let a = new Actor(this, outfit, { name: opts.name ?? `personagem ${this.actors.length + 1}`, ...opts });
    return this.actors.push(a), a;
  }
  textSign(mesh, info, gw, gh, card) {
    let e = { mesh, text: info.text, gw, gh, contrast: info.contrast, ox: info.cx - 0.5, oy: 0.5 - info.cy, hw: info.bw / 2, hh: info.bh / 2, lh: info.cap, card, seen: this.framing.frames.length }, i = card ? this.signs.findIndex((s) => s.card === card) : -1;
    i >= 0 ? this.signs[i] = e : this.signs.push(e);
  }
  visibleChain(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return !1;
    return !0;
  }
  recordFraming(cam) {
    let F = this.framing, fi = F.frames.length;
    this.scene.updateMatrixWorld();
    let right = new THREE5.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), P = new THREE5.Vector3(), proj = (x, y, z) => (P.set(x, y, z).project(cam), { x: P.x, y: P.y, front: P.z < 1 && P.z > -1 }), actorMeshes = new Set(this.actors.flatMap((a) => [a.mesh, a.blobMesh])), occ = [], meshes = [];
    this.world.traverseVisible((o) => {
      let m = o;
      !m.isMesh || actorMeshes.has(m) || (meshes.push(m), (Array.isArray(m.material) ? m.material : [m.material]).every((x) => x.transparent && x.opacity < 0.95 || x.depthWrite === !1)) || occ.push(m);
    });
    for (let p of this.posters) this.visibleChain(p.mesh) && !p.mesh.material.transparent && occ.push(p.mesh);
    this.ray.layers.enableAll();
    let camPos = cam.position, tmp = new THREE5.Vector3(), blocked = (x, y, z, skip) => {
      tmp.set(x, y, z);
      let d = tmp.distanceTo(camPos);
      return d < 0.3 ? !1 : (this.ray.set(camPos, tmp.clone().sub(camPos).normalize()), this.ray.near = cam.near, this.ray.far = d - 0.12, this.ray.intersectObjects(occ, !1).some((h) => h.object !== skip));
    }, boxes = this.actors.map((a) => {
      let s = a.s;
      if (s.visible === !1) return null;
      let sc = s.scale ?? 1, H = (a.o.build === "kid" ? 1.35 : 1.75) * sc, Wd = 0.22 * sc, x = s.x ?? 0, y = s.y ?? 0, z = s.z ?? 0, l = proj(x - right.x * Wd, y + H * 0.1, z - right.z * Wd), r = proj(x + right.x * Wd, y + H * 0.92, z + right.z * Wd);
      return { x0: Math.min(l.x, r.x), x1: Math.max(l.x, r.x), y0: Math.min(l.y, r.y), y1: Math.max(l.y, r.y), d: camPos.distanceTo(tmp.set(x, y + H * 0.5, z)) };
    }), byActor = (i, x, y, z) => {
      let p = proj(x, y, z), d = camPos.distanceTo(tmp.set(x, y, z));
      return boxes.some((b, j) => b && j !== i && b.d < d - 0.3 && p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1);
    }, codes = this.actors.map((a, i) => {
      let s = a.s;
      if (s.visible === !1) return -1;
      let sc = s.scale ?? 1, H = (a.o.build === "kid" ? 1.35 : 1.75) * sc, Wd = 0.36 * sc, x = s.x ?? 0, y = s.y ?? 0, z = s.z ?? 0, pts = [proj(x, y, z), proj(x, y + H, z), proj(x + right.x * Wd, y + H * 0.55, z + right.z * Wd), proj(x - right.x * Wd, y + H * 0.55, z - right.z * Wd)];
      if (!pts.every((p) => p.front)) return 3;
      let minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
      if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1) return 3;
      let eyes = proj(x, y + H * 0.84, z);
      if (eyes.y > 1 || eyes.y < -1) return 1;
      if ((Math.min(maxX, 1) - Math.max(minX, -1)) / Math.max(1e-6, maxX - minX) < 0.6) return 2;
      let hid = (px, py, pz) => blocked(px, py, pz) || byActor(i, px, py, pz);
      return hid(x, y + H * 0.84, z) ? 4 : [[0, 0.62], [0.5, 0.55], [-0.5, 0.55], [0, 0.38], [0, 0.18]].filter(([dx, hy]) => hid(x + right.x * Wd * dx, y + H * hy, z + right.z * Wd * dx)).length >= 3 ? 5 : 0;
    });
    F.names = this.actors.map((a) => a.s.name ?? ""), F.frames.push(codes.join(","));
    let fwd = new THREE5.Vector3(), q4 = new THREE5.Quaternion(), c = new THREE5.Vector3();
    F.signNames = this.signs.map((g) => g.text), F.signs.push(this.signs.map((g) => {
      if (g.card !== void 0 && g.seen !== fi || !g.mesh.parent || !this.visibleChain(g.mesh)) return -1;
      g.mesh.updateWorldMatrix(!0, !1);
      let W = (fx, fy) => g.mesh.localToWorld(new THREE5.Vector3(fx * g.gw, fy * g.gh, 0));
      c.copy(W(g.ox, g.oy)), g.mesh.getWorldQuaternion(q4), fwd.set(0, 0, 1).applyQuaternion(q4);
      let toCam = camPos.clone().sub(c).normalize(), cos = fwd.dot(toCam);
      if (cos < 0.05) return -1;
      let inside = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => {
        let k = W(g.ox + g.hw * sx, g.oy + g.hh * sy);
        return proj(k.x, k.y, k.z);
      })).filter((k) => k.front && Math.abs(k.x) <= 1 && Math.abs(k.y) <= 1).length, pc = proj(c.x, c.y, c.z);
      if (!pc.front || Math.abs(pc.x) > 1 || Math.abs(pc.y) > 1) return inside ? 5 : -1;
      let tw = W(g.ox, g.oy + g.lh / 2), bw = W(g.ox, g.oy - g.lh / 2), top = proj(tw.x, tw.y, tw.z), bot = proj(bw.x, bw.y, bw.z), letterPx = Math.hypot((top.x - bot.x) * this.W, (top.y - bot.y) * this.H) / 2;
      return blocked(c.x + toCam.x * 0.06, c.y + toCam.y * 0.06, c.z + toCam.z * 0.06, g.mesh) ? 3 : g.contrast < 3 ? 4 : cos < 0.45 ? 2 : inside < 4 ? 5 : letterPx < Math.min(this.W, this.H) * 0.028 ? 1 : 0;
    }).join(","));
    let seen = /* @__PURE__ */ new Map();
    for (let m of meshes.slice(0, 2500))
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt, k) => {
        let col = mt.color;
        if (!col) return;
        let em = mt.emissive, v = Math.round(clamp2(col.r + (em?.r ?? 0), 0, 1) * 255) << 16 | Math.round(clamp2(col.g + (em?.g ?? 0), 0, 1) * 255) << 8 | Math.round(clamp2(col.b + (em?.b ?? 0), 0, 1) * 255), key = m.uuid + ":" + k;
        seen.set(key, v);
        let was = this.lastCol.get(key);
        if (was === void 0 || was === v || F.jumps.length >= 200 || Math.max(Math.abs((was >> 16) - (v >> 16)), Math.abs((was >> 8 & 255) - (v >> 8 & 255)), Math.abs((was & 255) - (v & 255))) < 56) return;
        let name = m.name;
        for (let p = m.parent; !name && p && p !== this.world; p = p.parent) name = p.name;
        let hex = (n) => "#" + n.toString(16).padStart(6, "0");
        F.jumps.push({ f: fi, name: name || "material " + hex(was), from: hex(was), to: hex(v) });
      });
    this.lastCol = seen, this.lastLight && this.lastLight !== this.lightName && F.jumps.length < 200 && F.jumps.push({ f: fi, name: "luz", from: this.lastLight, to: this.lightName }), this.lastLight = this.lightName;
    for (let k of ["frames", "signs"]) F[k].length > 4e3 && F[k].splice(0, F[k].length - 4e3);
    try {
      window.__cartoon3dFraming = F;
    } catch {
    }
  }
  card(d) {
    let m = this.cards[this.cardUse];
    m || (m = new THREE5.Mesh(this.flatGeo, new THREE5.MeshBasicMaterial()), m.layers.set(NOINK), this.scene.add(m), this.cards.push(m)), this.cardUse++;
    let tex = this.cache.get(d.key, d.cw, d.ch, 1, d.draw, !!d.soft), mk = `${d.soft ? "s" : "c"}|${tex.uuid}`, mat = this.cardMats.get(mk);
    return mat || (mat = d.soft ? new THREE5.MeshBasicMaterial({ map: tex, transparent: !0, depthWrite: !1, side: THREE5.DoubleSide }) : new THREE5.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE5.DoubleSide }), this.cardMats.set(mk, mat)), m.material = mat, m.visible = !0, m.position.set(d.x, d.y, d.z), m.scale.set(d.w, d.h, 1), d.flat ? m.rotation.set(-Math.PI / 2, 0, 0) : m.rotation.set(0, Math.atan2(this.camera.position.x - d.x, this.camera.position.z - d.z), 0), m;
  }
  /**
   * Persistent flat drawing (poster, newspaper, big bottle, icon) that STAYS in the world: returns a THREE.Mesh you
   * can move / scale / hide in seek (mesh.position, mesh.scale, mesh.visible). face: true turns it to the camera every
   * frame. Create it once, outside seek.
   */
  poster(key, o, fn) {
    let cw = o.cw ?? 512, ch = o.ch ?? Math.round(512 * (o.h / o.w)), ck = `poster|${key}|${cw}x${ch}`, tex = this.cache.get(ck, cw, ch, 1, (p) => this.textInfo.set(ck, captureText(p.g, () => fn(p, p.g))), !!o.soft);
    this.cache.pin(ck);
    let mat = o.soft ? new THREE5.MeshBasicMaterial({ map: tex, transparent: !0, depthWrite: !1, side: THREE5.DoubleSide }) : new THREE5.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE5.DoubleSide }), mesh = new THREE5.Mesh(new THREE5.PlaneGeometry(o.w, o.h), mat);
    mesh.position.set(o.x, o.y, o.z), mesh.rotation.y = rad2(o.yaw ?? 0), mesh.layers.set(NOINK), this.scene.add(mesh), this.posters.push({ mesh, face: o.face !== !1 && o.yaw === void 0 });
    let info = this.textInfo.get(ck);
    return info && this.textSign(mesh, info, o.w, o.h), mesh;
  }
  /** 2D cartoon effect at a 3D point for this frame: burst, splash, puff, stars, note, note2, ring (flat), creak, cloud. t = 0..1 progress */
  fx(kind, o) {
    let t = q(clamp2(o.t ?? 0.5, 0, 1), 30), s = o.size ?? 1, col = o.color, D = {
      burst: [500, 500, (p) => fxBurst(p, t, col), 1, 1],
      splash: [800, 800, (p) => fxSplash(p, t), 2.4, 2.4],
      puff: [300, 300, (p) => fxPuff(p, t), 0.9, 0.9, !0],
      stars: [420, 210, (p) => fxStars(p, t), 0.75, 0.375],
      note: [220, 260, (p) => fxNote(p, 0, col), 0.4, 0.47],
      note2: [220, 260, (p) => fxNote(p, 1, col), 0.4, 0.47],
      ring: [600, 600, (p) => fxRing(p, t), 2, 2],
      creak: [300, 300, (p) => fxCreak(p, t), 0.6, 0.6],
      cloud: [600, 300, (p) => fxCloud(p, 3), 2, 1, !0]
    }, [cw, ch, draw, w, h, soft] = D[kind];
    return this.card({ key: `fx|${kind}|${t}|${col ?? ""}`, cw, ch, draw, x: o.x, y: o.y, z: o.z, w: w * s, h: h * s, flat: kind === "ring" || o.flat, soft });
  }
  /** your own flat drawing (Canvas2D through the Pen API or p.g) as a camera-facing card for THIS FRAME (call inside
   *  seek every frame it should show; returns that frame's mesh). For one that stays, use poster(). */
  draw(key, o, fn) {
    let cw = o.cw ?? 512, ch = o.ch ?? Math.round(512 * (o.h / o.w)), ck = `draw|${key}|${cw}x${ch}`, m = this.card({ key: ck, cw, ch, draw: (p) => this.textInfo.set(ck, captureText(p.g, () => fn(p, p.g))), x: o.x, y: o.y, z: o.z, w: o.w, h: o.h, flat: o.flat, soft: o.soft }), info = this.textInfo.get(ck);
    return info && this.textSign(m, info, 1, 1, key), m;
  }
  // ---------------- frame ----------------
  /** render the current frame: ink → lens blur → Neutral tone map → grade (MSAA 4). Call once at the end of seek(t). */
  render(opts = {}) {
    let r = this.renderer, cam = this.camera, P = this.preset;
    cam.updateMatrixWorld(), this.sky.position.copy(cam.position);
    let fwd = new THREE5.Vector3();
    cam.getWorldDirection(fwd), fwd.y = 0, fwd.lengthSq() < 1e-6 && fwd.set(0, 0, -1), fwd.normalize();
    let right = new THREE5.Vector3(-fwd.z, 0, fwd.x), dir = this.sunFrozen ?? fwd.clone().multiplyScalar(Math.cos(rad2(P.az))).add(right.clone().multiplyScalar(Math.sin(rad2(P.az)))).multiplyScalar(Math.cos(rad2(P.el))).setY(Math.sin(rad2(P.el))).normalize(), focusPt = cam.position.clone().add(cam.getWorldDirection(new THREE5.Vector3()).multiplyScalar(Math.min(this.dof.focus || 12, 40)));
    this.sun.target.position.copy(focusPt), this.sun.position.copy(focusPt).add(dir.clone().multiplyScalar(80)), this.sun.target.updateMatrixWorld();
    let lx = dir.dot(new THREE5.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)), lightAng = rad2(-90 - 30 * clamp2(-lx * 3, -1, 1));
    for (let a of this.actors) a.update(cam, lightAng);
    this.recordFraming(cam);
    for (let p of this.posters) p.face && (p.mesh.rotation.y = Math.atan2(cam.position.x - p.mesh.position.x, cam.position.z - p.mesh.position.z));
    for (let i = this.cardUse; i < this.cards.length; i++) this.cards[i].visible = !1;
    this.cardUse = 0, r.setRenderTarget(this.rtMain), r.setClearColor(0, 1), r.clear(!0, !0, !0), r.render(this.scene, cam), this.ink.render(r, this.rtMain);
    let u = this.dofMat.uniforms;
    return u.cNear.value = cam.near, u.cFar.value = cam.far, u.focus.value = opts.focus ?? this.dof.focus, u.cInf.value = opts.dof ?? this.dof.cInf, this.quad.material = this.dofMat, r.setRenderTarget(this.rtDof), r.render(this.fsScene, this.fsCam), this.finalMat.uniforms.flash.value = opts.flash ?? this.flash, this.finalMat.uniforms.exposure.value = this.exposure, this.quad.material = this.finalMat, r.setRenderTarget(null), r.render(this.fsScene, this.fsCam), this;
  }
}, createStage = (o = {}) => new Stage(o);
export {
  Actor,
  INK,
  LIGHTS,
  LIGHT_PRESETS,
  LOOK,
  NOINK,
  OUTFITS,
  Pen,
  SKIN,
  SKINS,
  Stage,
  beamHD,
  blink,
  bodyFront,
  bodySide,
  brick,
  camAt,
  cobbleHD,
  createStage,
  ctex,
  ease,
  facadeHD,
  fxBurst,
  fxCloud,
  fxCreak,
  fxNote,
  fxPuff,
  fxRing,
  fxSign,
  fxSplash,
  fxStars,
  grassHD,
  kick,
  mix,
  planksHD,
  rep,
  roofHD,
  soldier,
  stoneHD,
  townsfolk
};
