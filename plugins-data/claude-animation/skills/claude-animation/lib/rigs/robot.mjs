// robot.mjs — a chunky walking robot: painted metal torso with panel seams and rivets, boxy head with an LED
// visor, blinking antenna, piston arms with claw hands, jointed legs with heavy feet. Same textured style as
// the other rigs (gradient, hatch, specular, ink outline).
//
// LOCAL SPACE: facing +x, origin on the ground between the feet, feet on y = 0. About 130 wide × 210 tall at s = 1.
//   robot(ctx, x, groundY, s, pose)
// pose: { color (paint, default steel blue), flip (face -x), gait (walk phase, radians; omit to stand),
//         rot (tip over about the feet: ±1.5 = lying down), squash (0..1 crushed), flash (0..1 white hit),
//         hurt (x visor, bent antenna, sparks), angry (red visor), punch (0..1 front arm straight out),
//         eyes ("on" | "off"), smoke (0..1 puffs from the head), t (blink, sparks, smoke) }
import { clamp, lerp, ellipse, stroke, fill, line, poly, rrect, hatch, rad, hash, INK } from "../core.mjs";

function shade(hex, k) { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(clamp(k > 0 ? v + (255 - v) * k : v * (1 + k), 0, 255))); return `rgb(${c.join(",")})`; }
const box = (ctx, x, y, w, h, r) => poly(ctx, rrect(x, y, w, h, r));

export function robot(ctx, x, y, s = 1, p = {}) {
  const col = p.color || "#5B7FA6", flip = !!p.flip, sq = p.squash || 0, t = p.t || 0, ph = p.gait, pu = clamp(p.punch || 0);
  const bob = ph === undefined ? 0 : Math.abs(Math.sin(ph)) * 6;
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (flip ? -1 : 1), s * (1 - sq * .55));
  if (!p.rot) { ctx.save(); ctx.globalAlpha *= .25; ellipse(ctx, 0, 2, 74, 8); fill(ctx, "#10141A"); ctx.restore(); }
  if (p.rot) ctx.rotate(p.rot);
  const metal = (x0, y0, x1, y1, c = col) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, shade(c, .4)); g.addColorStop(.5, c); g.addColorStop(1, shade(c, -.45)); return g; };
  // legs: hip → knee → ankle, feet as heavy blocks; the far leg is darker and drawn first
  const leg = (far) => {
    const set = far ? Math.PI : 0, sw = ph === undefined ? 0 : Math.sin(ph + set) * 20, lift = ph === undefined ? 0 : Math.max(0, Math.cos(ph + set)) * 12;
    const hx = far ? -14 : 14, hy = -88 + bob, ax = hx + sw, ay = -18 - lift, kx = (hx + ax) / 2 + 10, ky = (hy + ay) / 2;
    const c = far ? shade(col, -.35) : col;
    line(ctx, [[hx, hy], [kx, ky], [ax, ay]], 17, INK); line(ctx, [[hx, hy], [kx, ky], [ax, ay]], 11, shade(c, -.2));
    ellipse(ctx, kx, ky, 9, 9); fill(ctx, metal(kx - 9, ky - 9, kx + 9, ky + 9, c)); stroke(ctx, 2.6);          // knee joint
    box(ctx, ax - 22, ay - 6, 46, 24 - (ay + 18 > 0 ? 0 : 0), 6); fill(ctx, metal(ax, ay - 6, ax, ay + 18, shade(c, -.15))); stroke(ctx, 3);   // foot
  };
  leg(true);
  // back arm (behind the torso)
  const arm = (front) => {
    const sx = front ? 30 : -30, sy = -150 + bob, ext = front ? pu : 0;
    const swing = ph === undefined ? 0 : Math.sin(ph + (front ? Math.PI : 0)) * .35;
    const a1 = lerp(1.35 + swing, 0.05, ext), a2 = lerp(.5, 0, ext);
    const ex = sx + Math.cos(a1) * 38, ey = sy + Math.sin(a1) * 38, hx = ex + Math.cos(a1 - a2) * 40, hy = ey + Math.sin(a1 - a2) * 40;
    const c = front ? col : shade(col, -.35);
    line(ctx, [[sx, sy], [ex, ey], [hx, hy]], 15, INK); line(ctx, [[sx, sy], [ex, ey], [hx, hy]], 9, shade(c, -.15));
    ellipse(ctx, sx, sy, 12, 12); fill(ctx, metal(sx - 12, sy - 12, sx + 12, sy + 12, c)); stroke(ctx, 2.8);   // shoulder
    ellipse(ctx, ex, ey, 7, 7); fill(ctx, shade(c, -.2)); stroke(ctx, 2.2);                                       // elbow
    const ca = a1 - a2;                                                                                              // claw
    for (const d of [-1, 1]) { const o = d * (.5 - ext * .25); line(ctx, [[hx, hy], [hx + Math.cos(ca + o) * 16, hy + Math.sin(ca + o) * 16], [hx + Math.cos(ca + o * .2) * 24, hy + Math.sin(ca + o * .2) * 24]], 5, INK); }
    if (front && ext > .6) for (let k = 0; k < 3; k++) line(ctx, [[sx - 20 - k * 16, sy - 14 + k * 12], [sx - 44 - k * 16, sy - 14 + k * 12]], 2.4, INK);   // speed lines
  };
  arm(false);
  // torso: painted box with a panel seam, chest light and rivets
  const T = () => box(ctx, -46, -178 + bob, 92, 96, 16);
  T(); fill(ctx, metal(-46, -178, 46, -82));
  ctx.save(); T(); ctx.clip();
  hatch(ctx, () => box(ctx, -46, -130 + bob, 92, 48, 10), rad(-35), 6, "#0E141C", 1.1, .3, [-60, -190, 60, -70]);
  ctx.restore(); T(); stroke(ctx, 3.4);
  line(ctx, [[-46, -128 + bob], [46, -128 + bob]], 2, "rgba(10,16,24,.55)");
  for (const [rx, ry] of [[-36, -168], [36, -168], [-36, -92], [36, -92]]) { ellipse(ctx, rx, ry + bob, 3, 3); fill(ctx, shade(col, .5)); stroke(ctx, 1.2); }
  const blink = (Math.sin(t * 5) > 0) ? 1 : .35;
  box(ctx, -18, -158 + bob, 36, 20, 5); fill(ctx, "#1A222C"); stroke(ctx, 2.2);
  for (let k = 0; k < 3; k++) { ellipse(ctx, -10 + k * 10, -148 + bob, 3.4, 3.4); fill(ctx, p.hurt ? "#FF5A3A" : `rgba(120,255,170,${k === Math.floor(t * 3) % 3 ? 1 : .35})`); }
  ellipse(ctx, -26, -166 + bob, 12, 4, -.2); fill(ctx, "rgba(255,255,255,.5)");
  // neck + head with LED visor
  const hb = -178 + bob;
  box(ctx, -10, hb - 10, 20, 12, 3); fill(ctx, shade(col, -.4)); stroke(ctx, 2.4);
  const H = () => box(ctx, -34, hb - 62, 70, 54, 12);
  H(); fill(ctx, metal(-34, hb - 62, 36, hb - 8)); stroke(ctx, 3.2);
  ellipse(ctx, -18, hb - 54, 10, 3.4, -.2); fill(ctx, "rgba(255,255,255,.55)");
  box(ctx, -6, hb - 48, 40, 18, 8); fill(ctx, "#121820"); stroke(ctx, 2.4);                                        // visor (faces +x)
  const eyeOn = p.eyes !== "off";
  if (p.hurt) { for (const ex of [6, 22]) { line(ctx, [[ex - 5, hb - 44], [ex + 5, hb - 34]], 3, "#FF5A3A"); line(ctx, [[ex + 5, hb - 44], [ex - 5, hb - 34]], 3, "#FF5A3A"); } }
  else if (eyeOn) {
    const ec = p.angry ? "255,70,50" : "90,230,255";
    for (const ex of [6, 22]) { const gl = ctx.createRadialGradient(ex, hb - 39, 1, ex, hb - 39, 14); gl.addColorStop(0, `rgba(${ec},.7)`); gl.addColorStop(1, `rgba(${ec},0)`); ctx.fillStyle = gl; ctx.fillRect(ex - 14, hb - 53, 28, 28);
      box(ctx, ex - 5, hb - (p.angry ? 41 : 43), 10, p.angry ? 5 : 8, 2); fill(ctx, `rgb(${ec})`); }
    if (p.angry) line(ctx, [[-2, hb - 52], [30, hb - 46]], 3.4);
  }
  // antenna (bent when hurt) with a blinking bulb
  const bend = p.hurt ? .9 : Math.sin(t * 3) * .08;
  const tx = -6 + Math.sin(bend) * 30, ty = hb - 62 - Math.cos(bend) * 30;
  line(ctx, [[-6, hb - 62], [tx, ty]], 3, INK);
  ellipse(ctx, tx, ty, 6, 6); fill(ctx, p.hurt ? "#777" : `rgba(255,80,60,${blink})`); stroke(ctx, 2);
  leg(false);
  arm(true);
  // hurt: sparks around the head; smoke puffs
  if (p.hurt) for (let k = 0; k < 6; k++) { const a = hash(k + Math.floor(t * 12) * 7) * Math.PI * 2, r = 30 + hash(k * 3 + Math.floor(t * 12)) * 30;
    line(ctx, [[Math.cos(a) * r, hb - 35 + Math.sin(a) * r], [Math.cos(a) * (r + 12), hb - 35 + Math.sin(a) * (r + 12)]], 2.6, "#FFD35A"); }
  if (p.smoke > 0) for (let k = 0; k < 4; k++) { const f = (t * .8 + k / 4) % 1; ctx.save(); ctx.globalAlpha *= p.smoke * (1 - f) * .6;
    ellipse(ctx, -10 + Math.sin(k * 2 + t) * 10, hb - 70 - f * 90, 10 + f * 22, 9 + f * 18); fill(ctx, "#8A8F96"); ctx.restore(); }
  if (p.flash > 0) { ctx.save(); ctx.globalAlpha *= p.flash; T(); fill(ctx, "#FFFFFF"); H(); fill(ctx, "#FFFFFF"); ctx.restore(); }
  ctx.restore();
}
