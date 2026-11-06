// roach.mjs — a cockroach: long flat glossy body, two leathery wings with a seam, tan-rimmed pronotum
// shield over a small head, very long whip antennae, six spiny legs that scuttle, cerci at the tail.
// Same textured style as the ant and the bug (gradient, hatch, specular, rim light).
//
// LOCAL SPACE: facing +x, origin on the ground under the body, feet on y = 0. Body ≈ 190 × 50 at s = 1.
//   roach(ctx, x, groundY, s, pose)
// pose: { color (body, default glossy brown), flip (face -x), gait (run phase, radians; omit to stand),
//         rot (spin about the body), squash (0..1 flattened), flash (0..1 white hit), hurt (x eyes),
//         angry, wings (0..1 open, for a flying leap), rear (0..1 front lifted, attack pose), t (antennae) }
import { clamp, rad, ellipse, stroke, fill, line, hatch, INK } from "../core.mjs";

function shade(hex, k) { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(clamp(k > 0 ? v + (255 - v) * k : v * (1 + k), 0, 255))); return `rgb(${c.join(",")})`; }

export function roach(ctx, x, y, s = 1, p = {}) {
  const col = p.color || "#6B3A1E", flip = !!p.flip, sq = p.squash || 0, t = p.t || 0, ph = p.gait, rear = clamp(p.rear || 0), wo = clamp(p.wings || 0);
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (flip ? -1 : 1), s * (1 - sq * .6));
  if (!p.rot) { ctx.save(); ctx.globalAlpha *= .25; ellipse(ctx, 0, 2, 112, 8); fill(ctx, "#140C06"); ctx.restore(); }
  if (p.rot) { ctx.translate(0, -40); ctx.rotate(p.rot); ctx.translate(0, 40); }
  // legs (three pairs, spiny): hip under the body, knee high beside it, foot splayed
  const legs = (far) => { for (let i = 0; i < 3; i++) {
    const hx = 40 - i * 42 + (far ? -8 : 0), hy = -24, set = (i % 2) ^ (far ? 1 : 0);
    const sw = ph === undefined ? 0 : Math.sin(ph + set * Math.PI) * 18, lift = ph === undefined ? 0 : Math.max(0, Math.cos(ph + set * Math.PI)) * 10;
    const kx = hx + (1 - i) * 40 + 4 + sw * .5, ky = -40 - lift, fx = hx + (1 - i) * 70 + sw, fy = -lift - (i === 0 ? rear * 30 : 0);
    const pts = [[hx, hy], [kx, ky], [fx, fy]];
    line(ctx, pts, far ? 5.4 : 6.8, INK); line(ctx, pts, far ? 2.6 : 3.4, far ? "#3A2414" : "#5A3820");
    for (let k = 1; k <= 3; k++) { const sx = kx + (fx - kx) * k / 4, sy = ky + (fy - ky) * k / 4; line(ctx, [[sx, sy], [sx + 5, sy - 6]], 1.6, INK); }   // spines
    line(ctx, [[fx, fy], [fx + 8, fy + 1]], 2.6, INK); } };
  // whole body tilts up at the front when rearing
  ctx.save(); ctx.translate(-60, -20); ctx.rotate(-rear * .35); ctx.translate(60, 20);
  legs(true);
  // cerci (tail feelers)
  for (const d of [-1, 1]) line(ctx, [[-92, -26], [-112, -22 + d * 6], [-122, -16 + d * 9]], 3, INK);
  // abdomen under the wings (darker), visible when the wings open
  ellipse(ctx, -14, -30, 90, 18); fill(ctx, shade(col, -.5)); stroke(ctx, 3);
  for (let k = 0; k < 6; k++) line(ctx, [[-80 + k * 22, -44], [-76 + k * 22, -16]], 1.4, "rgba(0,0,0,.35)");
  // wings: two leathery plates over the back with a dark seam; they lift and part for a flying leap
  const wing = (dir) => { ctx.beginPath(); ctx.moveTo(34, -44); ctx.bezierCurveTo(10, -62, -80, -60, -104, -36); ctx.quadraticCurveTo(-60, -22, 34, -28); ctx.closePath(); };
  for (const [dir, a] of [[1, -wo * .55], [-1, -wo * .25]]) {
    ctx.save(); ctx.translate(30, -40); ctx.rotate(a); ctx.translate(-30, 40);
    const g = ctx.createLinearGradient(0, -64, 0, -24); g.addColorStop(0, shade(col, .38)); g.addColorStop(.55, col); g.addColorStop(1, shade(col, -.4));
    wing(dir); fill(ctx, g);
    ctx.save(); wing(dir); ctx.clip();
    hatch(ctx, () => ellipse(ctx, -30, -40, 90, 24), rad(-28), 6, "#1A0C04", 1.1, .3, [-120, -70, 40, -20]);
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(20, -42); ctx.quadraticCurveTo(-30, -56 + k * 6, -96, -40 + k * 3); stroke(ctx, 1.2, "rgba(30,14,4,.45)"); }   // veins
    ctx.restore(); wing(dir); stroke(ctx, 3.2);
    if (dir > 0) { ctx.beginPath(); ctx.moveTo(26, -40); ctx.bezierCurveTo(0, -48, -60, -46, -98, -36); stroke(ctx, 2.4, "rgba(20,8,2,.7)"); }   // seam
    ctx.restore();
  }
  ellipse(ctx, -30, -54, 34, 5, -.06); fill(ctx, "rgba(255,240,220,.55)");   // specular
  // pronotum: the round shield over the head, dark centre and tan rim
  ctx.beginPath(); ctx.moveTo(30, -30); ctx.bezierCurveTo(30, -62, 84, -60, 86, -32); ctx.quadraticCurveTo(58, -22, 30, -30); ctx.closePath();
  const pg = ctx.createRadialGradient(56, -46, 2, 56, -40, 34); pg.addColorStop(0, shade(col, -.35)); pg.addColorStop(.62, shade(col, -.15)); pg.addColorStop(.8, "#C9965A"); pg.addColorStop(1, "#A9733E");
  fill(ctx, pg); stroke(ctx, 3);
  ellipse(ctx, 50, -50, 12, 3.4, -.2); fill(ctx, "rgba(255,240,220,.6)");
  legs(false);
  // head, tucked under the front of the shield
  ctx.save(); ctx.translate(88, -26);
  ellipse(ctx, 0, 0, 15, 12, .3); fill(ctx, shade(col, -.3)); stroke(ctx, 2.6);
  for (const sg of [-1, 1]) line(ctx, [[10, 6], [18, 8 + sg * 4]], 2.4, INK);          // palps
  if (p.hurt) { line(ctx, [[-2, -8], [8, 2]], 3); line(ctx, [[8, -8], [-2, 2]], 3); }
  else { ellipse(ctx, 3, -4, 6, 7, .4); fill(ctx, "#1A0E06"); stroke(ctx, 1.6); ellipse(ctx, 1.5, -6.5, 1.8, 1.8); fill(ctx, "#fff");
    if (p.angry) line(ctx, [[-6, -14], [10, -9]], 3.4); }
  // antennae: very long, whip back over the body
  for (const [sw, len] of [[0, 1], [1.7, .86]]) {
    const w1 = Math.sin(t * 6 + sw) * 14, w2 = Math.sin(t * 4.3 + sw * 2) * 22;
    ctx.beginPath(); ctx.moveTo(4, -10); ctx.bezierCurveTo(30, -70 * len, -40 + w1, -110 * len, -150 * len + w2, -96 * len + w1 * .5);
    stroke(ctx, 2.4); }
  ctx.restore();
  ctx.restore();   // rear tilt
  if (p.flash > 0) { ctx.save(); ctx.globalAlpha *= p.flash; ellipse(ctx, -10, -38, 104, 24); fill(ctx, "#FFFFFF"); ctx.restore(); }
  ctx.restore();
}
