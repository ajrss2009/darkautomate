// engine/ui.js — the 2D information layer: HTML/CSS components drawn over the 3D frame, immediate-mode.
// Each frame the player calls U.begin(), the shot's ui(U, t, info) calls components, then U.end().
// Elements are reused by key, so images/fonts stay loaded. All animation is computed from t (no CSS transitions).
// Units are logical stage px (1920x1080 or 1080x1920); the layer is scaled to the output size.
import { E, clamp, ease, prog, lerp, key as kf } from './core.js';
import { toStage } from './world.js';

const CSS = `
.ui{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;pointer-events:none;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.ui *{box-sizing:border-box}
.ui .abs{position:absolute}
.ui .mono{font-family:'IBM Plex Mono',monospace}
.ui .arch{font-family:Archivo,Inter,sans-serif}
.ui .serif{font-family:'Source Serif 4',Georgia,serif}
.ui[data-theme=light]{--ink:#17181a;--sub:#6d6e72;--card:#ffffff;--cardB:rgba(0,0,0,.07);--shadow:0 14px 48px rgba(20,24,30,.10),0 2px 6px rgba(20,24,30,.05);--accent:#2f6fdb;--chip:#141517;--chipInk:#fff;--tag:rgba(255,255,255,.93);--tagB:rgba(0,0,0,.2);--tagInk:#2b2c2f;--line:#17181a;--bgc:#e7e7e5}
.ui[data-theme=dark]{--ink:#ffffff;--sub:rgba(255,255,255,.82);--card:rgba(10,16,26,.74);--cardB:rgba(255,255,255,.10);--shadow:0 14px 48px rgba(0,0,0,.35);--accent:#4a8cff;--chip:#0d0e10;--chipInk:#fff;--tag:rgba(8,14,24,.62);--tagB:rgba(255,255,255,.6);--tagInk:#fff;--line:#ffffff;--bgc:#000}
.ui .badge{font:500 21px 'IBM Plex Mono',monospace;letter-spacing:.14em;padding:9px 16px;border:1.5px solid var(--tagB);background:var(--tag);color:var(--tagInk);text-transform:uppercase;white-space:nowrap}
.ui .foot{font:400 19px 'IBM Plex Mono',monospace;color:var(--sub);letter-spacing:.02em;white-space:nowrap;text-shadow:var(--fsh,none)}
.ui[data-theme=dark] .foot{--fsh:0 0 10px rgba(0,10,30,.55)}
.ui .lt{background:#121315;padding:16px 26px 15px;border-radius:5px;box-shadow:0 10px 30px rgba(0,0,0,.18)}
.ui .lt .n{font:800 44px Archivo,Inter,sans-serif;color:#fff;letter-spacing:.01em;text-transform:uppercase;line-height:1.02;white-space:nowrap}
.ui .lt .s{font:400 21px 'IBM Plex Mono',monospace;color:#b8b9bd;letter-spacing:.06em;text-transform:uppercase;margin-top:6px;white-space:nowrap}
.ui .chipT{border-left:7px solid var(--accent);padding:2px 0 2px 20px}
.ui .chipT .n{font:800 50px Archivo,Inter,sans-serif;color:var(--ink);text-transform:uppercase;letter-spacing:.01em;line-height:1;white-space:nowrap}
.ui .chipT .s{font:400 22px 'IBM Plex Mono',monospace;color:var(--sub);text-transform:uppercase;letter-spacing:.06em;margin-top:10px;white-space:nowrap}
.ui .stack div{color:#fff;text-shadow:0 2px 22px rgba(0,10,30,.38)}
.ui .stack .d{font-weight:500;font-size:34px;opacity:.88;margin-bottom:4px}
.ui .stack .t{font-weight:800;font-size:104px;letter-spacing:-.025em;line-height:.98}
.ui .stack .p{font-weight:500;font-size:32px;opacity:.85;margin-top:8px}
.ui .pin-tag{font:500 20px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;padding:7px 12px;background:var(--tag);border:1.5px solid var(--tagB);color:var(--tagInk);white-space:nowrap}
.ui .pin-tag .s{display:block;font-size:16px;opacity:.75;text-transform:none;letter-spacing:.02em;margin-top:2px}
.ui .pin-chip{font:800 30px Archivo,Inter,sans-serif;letter-spacing:.03em;text-transform:uppercase;padding:7px 14px 6px;background:var(--chip);color:var(--chipInk);border-radius:4px;white-space:nowrap}
.ui .pin-chip.sm{font-size:22px;padding:5px 10px}
.ui .pin-note{background:var(--card);box-shadow:var(--shadow);border:1px solid var(--cardB);padding:12px 18px;white-space:nowrap}
.ui .pin-note .n{font:500 26px 'IBM Plex Mono',monospace;color:var(--ink);letter-spacing:.04em;text-transform:uppercase}
.ui .pin-note .s{font:400 18px 'IBM Plex Mono',monospace;color:var(--sub);margin-top:4px}
.ui .pin-card{background:rgba(8,18,32,.68);border-radius:6px;padding:14px 20px 12px;box-shadow:0 8px 30px rgba(0,10,30,.25);white-space:nowrap;color:#fff}
.ui .pin-card .s{display:block;font:500 19px 'IBM Plex Mono',monospace;letter-spacing:.12em;margin-bottom:6px;opacity:.9;text-transform:uppercase}
.ui .pin-card .v{font-weight:800;font-size:84px;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1}
.ui .pin-card .u{font-weight:600;font-size:36px;margin-left:8px;opacity:.92}
.ui .plate{background:var(--card);box-shadow:var(--shadow);border-radius:8px;padding:22px 34px 18px;text-align:center}
.ui .plate .v{font:800 92px Archivo,Inter,sans-serif;color:var(--ink);letter-spacing:-.01em;line-height:1;font-variant-numeric:tabular-nums}
.ui .plate .l{font:500 20px 'IBM Plex Mono',monospace;color:var(--sub);letter-spacing:.16em;text-transform:uppercase;margin-top:10px}
.ui .hero{text-align:center}
.ui .hero .k{font:500 22px 'IBM Plex Mono',monospace;color:var(--sub);letter-spacing:.3em;text-transform:uppercase;margin-bottom:14px}
.ui .hero .v{font:500 230px 'IBM Plex Mono',monospace;color:var(--ink);letter-spacing:.04em;line-height:.95;font-variant-numeric:tabular-nums}
.ui .hero .l{display:inline-block;background:var(--chip);color:var(--chipInk);font:800 40px Archivo,Inter,sans-serif;letter-spacing:.08em;padding:6px 18px;margin-top:14px;text-transform:uppercase}
.ui .hero .s{font:400 18px 'IBM Plex Mono',monospace;color:var(--sub);margin-top:16px}
.ui .quote{background:var(--card);box-shadow:var(--shadow);border:1px solid var(--cardB);border-radius:8px;padding:44px 58px 40px 58px;max-width:1320px;min-width:880px}
.ui .quote .qm{font:900 92px Archivo,Inter,sans-serif;color:var(--accent);line-height:.6;height:40px}
.ui .quote .q{font:700 58px Inter,sans-serif;color:var(--ink);line-height:1.18;letter-spacing:-.01em}
.ui .quote .w{font:700 28px Inter,sans-serif;color:var(--ink);margin-top:24px}
.ui .quote .r{font:400 21px 'IBM Plex Mono',monospace;color:var(--sub);margin-top:6px}
.ui .quote .src{position:absolute;right:16px;top:-14px;font:600 15px 'IBM Plex Mono',monospace;background:var(--chip);color:#fff;padding:4px 9px;letter-spacing:.08em;text-transform:uppercase}
.ui .side{display:flex;align-items:center;gap:70px}
.ui .side .ph{width:520px;height:620px;background:#ddd center/cover;box-shadow:0 20px 60px rgba(0,0,0,.22);border:12px solid #fff;border-bottom-width:40px}
.ui .side .q{font:500 34px Inter,sans-serif;color:var(--ink);line-height:1.32;max-width:640px}
.ui .side .w{font:700 22px Inter,sans-serif;color:var(--ink);margin-top:20px}
.ui .side .r{font:400 17px 'IBM Plex Mono',monospace;color:var(--sub);margin-top:6px}
.ui .stmt{text-align:center;width:100%}
.ui .stmt .q{font:800 120px Inter,sans-serif;color:var(--ink);letter-spacing:-.03em;line-height:1.04}
.ui .stmt .s{font:400 22px 'IBM Plex Mono',monospace;color:var(--sub);margin-top:26px}
.ui .list .k{font:500 20px 'IBM Plex Mono',monospace;color:var(--sub);letter-spacing:.2em;text-transform:uppercase;margin-bottom:16px}
.ui .list .it{background:var(--card);box-shadow:var(--shadow);border:1px solid var(--cardB);border-radius:6px;padding:20px 28px;margin-bottom:16px;display:flex;align-items:center;gap:26px;width:1180px}
.ui .list .num{font:800 54px Archivo,Inter,sans-serif;color:var(--accent);width:40px;text-align:center}
.ui .list .t{font:700 36px Inter,sans-serif;color:var(--ink)}
.ui .list .s{font:400 20px 'IBM Plex Mono',monospace;color:var(--sub);margin-top:6px}
.ui .cmp{display:flex;align-items:center;gap:44px}
.ui .cmp .c{background:var(--card);box-shadow:var(--shadow);border:1px solid var(--cardB);border-radius:6px;padding:30px 44px;min-width:380px}
.ui .cmp .t{font:800 50px Archivo,Inter,sans-serif;color:var(--ink);text-transform:uppercase}
.ui .cmp .s{font:400 20px 'IBM Plex Mono',monospace;color:var(--sub);margin-top:8px}
.ui .cmp .ar{font:300 80px Inter,sans-serif;color:var(--accent)}
.ui .ttl .k{font:500 22px 'IBM Plex Mono',monospace;color:var(--sub);letter-spacing:.2em;text-transform:uppercase;margin-top:14px}
.ui .ttl .t{font:900 76px Archivo,Inter,sans-serif;color:var(--ink);text-transform:uppercase;letter-spacing:.01em;line-height:1}
.ui .phone{width:420px;height:760px;border:14px solid #111;border-radius:56px;background:var(--card);box-shadow:var(--shadow);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px}
.ui .phone .k{font:500 17px 'IBM Plex Mono',monospace;color:var(--sub);letter-spacing:.2em;text-transform:uppercase}
.ui .phone .pl{width:96px;height:96px;border-radius:50%;background:#111;margin:34px auto;position:relative}
.ui .phone .pl:after{content:'';position:absolute;left:38px;top:28px;border-left:30px solid #fff;border-top:20px solid transparent;border-bottom:20px solid transparent}
.ui .phone .t{font:700 30px Inter,sans-serif;color:var(--ink);line-height:1.25}
.ui .art{background:#fff;color:#151515;box-shadow:0 30px 90px rgba(0,0,0,.35);transform-origin:0 0}
.ui .art .bar{height:54px}
.ui .art .hd{font:800 66px Inter,sans-serif;line-height:1.1;letter-spacing:-.015em;margin:44px 70px 0}
.ui .art .by{font:500 24px Inter,sans-serif;color:#555;margin:26px 70px 0}
.ui .art .by b{color:#1a5fd0;font-weight:600}
.ui .art .dt{font:400 22px Inter,sans-serif;color:#666;margin:8px 70px 0}
.ui .art .bd{font:400 44px 'Source Serif 4',Georgia,serif;line-height:1.55;margin:40px 70px 60px;color:#1b1b1b}
.ui .art .bd p{margin:0 0 30px}
.ui .doc{background:#fff;color:#111;box-shadow:0 30px 90px rgba(0,0,0,.35);transform-origin:0 0;padding:70px 90px;font:400 36px 'Source Serif 4',Georgia,serif;line-height:1.5}
.ui .doc .h{text-align:center;font-weight:700;font-size:40px;margin-bottom:26px}
.ui .doc .red{display:inline-block;background:#111;height:.9em;vertical-align:middle}
.ui mark{background:none;color:inherit;padding:0 .08em;margin:0 -.08em;background-image:linear-gradient(#ffe94a,#ffe94a);background-repeat:no-repeat;background-position:0 55%;border-radius:2px}
.ui .shot img{display:block;width:100%;height:100%;object-fit:cover}
.ui .hlbox{position:absolute;background:#ffe94a;mix-blend-mode:multiply}
.ui .ph-cap .k{font:500 30px Inter,sans-serif;color:#fff;opacity:.88;text-shadow:0 2px 18px rgba(0,0,0,.5)}
.ui .ph-cap .t{font:700 40px Inter,sans-serif;color:#fff;text-shadow:0 2px 18px rgba(0,0,0,.5);margin-top:4px}
.ui .ph-credit{font:400 15px 'IBM Plex Mono',monospace;color:rgba(255,255,255,.7)}
.ui .name-pill{font:700 32px Inter,sans-serif;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.6)}
.ui .tri{display:flex;gap:22px}
.ui .tri .p img{width:560px;height:315px;object-fit:cover;display:block;border-radius:4px}
.ui .tri .p .l{font:600 22px Inter,sans-serif;color:#fff;margin-top:12px;opacity:.9}
.ui .cap{text-align:center;font:700 46px Inter,sans-serif;color:#fff;text-shadow:0 0 6px rgba(0,0,0,.9),0 2px 14px rgba(0,0,0,.8);line-height:1.2}
.ui .cap .on{color:#ffe94a}
.ui .pill{font:500 24px 'IBM Plex Mono',monospace;background:var(--accent);color:#fff;padding:8px 14px;border-radius:3px;white-space:nowrap}
`;
let styleAdded = false;
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function createUI(host) {
  if (!styleAdded) { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); styleAdded = true; }
  const root = document.createElement('div'); root.className = 'ui'; host.appendChild(root);
  const pool = new Map(); let used = new Set(), counters = {}, pending = [];
  const U = { root, t: 0, info: null, cam: null, theme: 'dark', dur: 1 };
  U.layout = () => { root.style.width = E.W + 'px'; root.style.height = E.H + 'px'; root.style.transform = `scale(${E.outW / E.W})`; };
  U.begin = (t, info, cam, theme) => { U.t = t; U.info = info; U.prefix = info?.id || ''; U.dur = info?.dur ?? 1; U.cam = cam; U.theme = theme || 'dark'; root.dataset.theme = U.theme; used = new Set(); counters = {}; pending = []; };
  U.end = async () => { for (const [k, el] of pool) { if (!used.has(k)) { el.style.display = 'none'; } } if (pending.length) await Promise.all(pending); };
  // get/create a keyed element
  function el(type, o, cls, z = 10) {
    const k = `${U.prefix}|${type}:${o?.key ?? (counters[type] = (counters[type] || 0) + 1)}`; used.add(k);
    let e = pool.get(k); if (!e) { e = document.createElement('div'); e.style.zIndex = z; root.appendChild(e); pool.set(k, e); e._html = null; }
    const cn = 'abs ' + (cls || ''); if (e.className !== cn) e.className = cn;
    e.style.display = ''; return e;
  }
  const setHTML = (e, html) => { if (e._html !== html) { e.innerHTML = html; e._html = html; e.querySelectorAll('img').forEach((im) => { if (!im.complete) pending.push(im.decode().catch(() => {})); }); } };
  // timing: visible from `at` to `out` with an animated reveal; returns {k (0..1 in), o (opacity)}
  function timing(o, dIn = 0.45, dOut = 0.3) { const at = o?.at ?? 0, out = o?.out ?? 1e9, t = U.t; const kIn = ease.out(prog(t, at, at + (o?.inDur ?? dIn))), kOut = 1 - ease.inOut(prog(t, out, out + (o?.outDur ?? dOut))); return { k: kIn, o: Math.min(kIn, kOut), on: t >= at && t < out + (o?.outDur ?? dOut) }; }
  function anim(e, tm, kind = 'rise', o = {}) {
    const k = tm.k; let tr = '';
    if (kind === 'rise') tr = `translateY(${(1 - k) * (o.dist ?? 18)}px)`;
    else if (kind === 'slide') tr = `translateX(${(1 - k) * -(o.dist ?? 28)}px)`;
    else if (kind === 'pop') tr = `scale(${0.92 + 0.08 * ease.outBack(k)})`;
    e.style.opacity = tm.o; e.style.filter = kind === 'blur' || o.blur ? `blur(${(1 - k) * 10}px)` : 'none';
    e.style.transform = (o.base || '') + ' ' + tr;
  }
  const place = (e, pos, w, h) => { // pos: 'tl','tr','bl','br','c','b','t', or {x,y} (anchor px) with optional ax/ay alignment
    const m = U.margin ?? (E.vertical ? 64 : 72);
    const P = typeof pos === 'object' ? pos : ({ tl: { x: m, y: m }, tr: { x: E.W - m, y: m, ax: 1 }, bl: { x: m, y: E.H - m * 1.35, ay: 1 }, br: { x: E.W - m, y: E.H - m * 1.35, ax: 1, ay: 1 }, c: { x: E.W / 2, y: E.H / 2, ax: 0.5, ay: 0.5 }, b: { x: E.W / 2, y: E.H - m * 1.5, ax: 0.5, ay: 1 }, t: { x: E.W / 2, y: m * 1.2, ax: 0.5 }, cl: { x: m * 1.6, y: E.H / 2, ay: 0.5 } }[pos || 'c']);
    e.style.left = P.x + 'px'; e.style.top = P.y + 'px'; return `translate(${-(P.ax || 0) * 100}%, ${-(P.ay || 0) * 100}%)`;
  };

  // ------------------------------------------------ backgrounds & framing
  U.bg = (c = 'theme', o = {}) => { const e = el('bg', o, '', 1); e.style.inset = '0'; e.style.left = '0'; e.style.top = '0'; e.style.width = E.W + 'px'; e.style.height = E.H + 'px';
    e.style.background = c === 'theme' ? 'var(--bgc)' : c === 'light' ? '#e7e7e5' : c === 'dark' ? '#000' : c; e.style.opacity = o.opacity ?? 1; return e; };
  U.scrim = (where = 'bl', strength = 0.55, o = {}) => { const e = el('scrim', o, '', 2); const tm = timing(o, 0.8); e.style.opacity = tm.o; Object.assign(e.style, { left: 0, top: 0, width: E.W + 'px', height: E.H + 'px' });
    const c = `rgba(4,14,30,${strength})`; e.style.background = where === 'bl' ? `radial-gradient(ellipse 60% 70% at 0% 100%, ${c}, rgba(4,14,30,${strength * 0.4}) 55%, transparent 100%)` : where === 'b' ? `linear-gradient(to top, ${c}, transparent 45%)` : where === 't' ? `linear-gradient(to bottom, ${c}, transparent 35%)` : `rgba(4,14,30,${strength})`; return e; };
  U.badge = (text = 'RECONSTRUCTION', o = {}) => { const e = el('badge', o, 'badge', 40); setHTML(e, esc(text)); const tm = timing({ at: 0.2, ...o }, 0.4); const tr = place(e, o.pos || 'tr'); anim(e, tm, 'fade', { base: tr }); return e; };
  U.footnote = (text, o = {}) => { const e = el('foot', o, 'foot', 40); setHTML(e, esc(text)); const m = E.vertical ? 64 : 72; const tm = timing({ at: 0.5, ...o }, 0.5); const tr = place(e, o.pos || { x: m - 34 + 34, y: E.H - 38, ay: 1 }); anim(e, tm, 'fade', { base: tr }); return e; };

  // ------------------------------------------------ name / time / place
  U.lowerThird = ({ name, sub }, o = {}) => { const e = el('lt', o, 'lt', 30); setHTML(e, `<div class="n">${esc(name)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}`); const tm = timing({ at: 0.4, ...o }); const tr = place(e, o.pos || 'bl'); anim(e, tm, 'slide', { base: tr }); return e; };
  U.timeChip = ({ time, sub }, o = {}) => { const e = el('chipT', o, 'chipT', 30); setHTML(e, `<div class="n">${esc(time)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}`); const tm = timing({ at: 0.3, ...o }); const tr = place(e, o.pos || 'bl'); anim(e, tm, 'slide', { base: tr }); return e; };
  U.timeStack = ({ date, time, place: where }, o = {}) => { const e = el('stack', o, 'stack', 30); setHTML(e, `${date ? `<div class="d">${esc(date)}</div>` : ''}<div class="t">${esc(time)}</div>${where ? `<div class="p">${esc(where)}</div>` : ''}`);
    const tr = place(e, o.pos || 'bl'); e.style.transform = tr; const at = o.at ?? 0.5; [...e.children].forEach((c, i) => { const tm = timing({ ...o, at: at + i * 0.16 }, 0.7); c.style.opacity = tm.o; c.style.transform = `translateY(${(1 - tm.k) * 16}px)`; c.style.filter = `blur(${(1 - tm.k) * 9}px)`; }); return e; };
  U.title = ({ title, kicker }, o = {}) => { const e = el('ttl', o, 'ttl', 30); setHTML(e, `<div class="t">${esc(title)}</div>${kicker ? `<div class="k">${esc(kicker)}</div>` : ''}`); const tm = timing({ at: 0.15, ...o }, 0.6); const tr = place(e, o.pos || { x: E.vertical ? 64 : 110, y: E.vertical ? 260 : 150 }); anim(e, tm, 'blur', { base: tr }); return e; };

  // ------------------------------------------------ labels pinned to 3D points
  // U.pin(worldPoint, 'TABUK', {style:'chip'|'tag'|'note'|'card', sub, leader:110, dir:'up'|'down'|'left'|'right', at, value:()=>n, unit})
  U.pin = (world, text, o = {}) => {
    if (!U.cam) return null; const p = toStage(U.cam, world); const style = o.style || 'tag';
    const tm = timing({ at: 0.3, ...o }, 0.5); const e = el('pin', o, 'pin-' + style + (o.small ? ' sm' : ''), 25);
    let html;
    if (style === 'card') html = `<span class="s">${esc(o.sub || '')}</span><span class="v">${esc(o.value ? fmt(o.value(U.t), o.decimals || 0) : text)}</span>${o.unit ? `<span class="u">${esc(o.unit)}</span>` : ''}`;
    else if (style === 'note') html = `<div class="n">${esc(text)}</div>${o.sub ? `<div class="s">${esc(o.sub)}</div>` : ''}`;
    else html = `${esc(text)}${o.sub && style === 'tag' ? `<span class="s">${esc(o.sub)}</span>` : ''}`;
    setHTML(e, html);
    const lead = o.leader ?? (style === 'card' ? 120 : 0), dir = o.dir || 'up';
    const bx = dir === 'right' ? p.x + lead : dir === 'left' ? p.x - lead : p.x, by = dir === 'up' ? p.y - lead : dir === 'down' ? p.y + lead : p.y;
    const ax = o.ax ?? (dir === 'right' ? 0 : dir === 'left' ? 1 : style === 'card' ? 0 : 0.5), ay = o.ay ?? (dir === 'up' ? 1 : dir === 'down' ? 0 : 0.5);
    e.style.left = bx + 'px'; e.style.top = by + 'px'; e.style.opacity = p.visible ? tm.o : 0; e.style.filter = `blur(${(1 - tm.k) * 6}px)`; e.style.transform = `translate(${-ax * 100}%, ${-ay * 100}%) translate(${style === 'card' && dir === 'up' ? -2 : 0}px, 0)`;
    if (lead > 0 || o.dot) { const L = el('pinL', { key: (o.key ?? '') + '_l' + (counters.pin || 0) }, '', 24); const len = lead * tm.k; const ang = { up: -90, down: 90, left: 180, right: 0 }[dir];
      L.style.left = p.x + 'px'; L.style.top = p.y + 'px'; L.style.width = Math.max(0, len) + 'px'; L.style.height = '2.5px'; L.style.background = 'var(--line)'; L.style.transformOrigin = '0 50%'; L.style.transform = `rotate(${ang}deg)`; L.style.opacity = p.visible ? tm.o : 0;
      const D = el('pinD', { key: (o.key ?? '') + '_d' + (counters.pin || 0) }, '', 24); const pulse = ((U.t - (o.at ?? 0.3)) % 1.6) / 1.6;
      setHTML(D, `<div style="position:absolute;left:-7px;top:-7px;width:14px;height:14px;border-radius:50%;background:var(--line)"></div><div style="position:absolute;left:${-7 - 20 * pulse}px;top:${-7 - 20 * pulse}px;width:${14 + 40 * pulse}px;height:${14 + 40 * pulse}px;border-radius:50%;border:2px solid var(--line);opacity:${(1 - pulse) * 0.7}"></div>`);
      D.style.left = p.x + 'px'; D.style.top = p.y + 'px'; D.style.opacity = p.visible ? tm.o : 0; }
    return e;
  };
  // circle callout around a 3D point (radius in px)
  U.ring = (world, o = {}) => { if (!U.cam) return null; const p = toStage(U.cam, world); const e = el('ring', o, '', 22); const tm = timing(o, 0.4); const r = (o.r ?? 60) * (0.7 + 0.3 * ease.outBack(tm.k));
    Object.assign(e.style, { left: p.x - r + 'px', top: p.y - r + 'px', width: r * 2 + 'px', height: r * 2 + 'px', borderRadius: '50%', border: `${o.width ?? 6}px solid ${o.color || 'var(--line)'}`, opacity: p.visible ? tm.o : 0 }); return e; };
  // measuring line between two 3D points with a label
  U.measure = (a, b, label, o = {}) => { if (!U.cam) return null; const A = toStage(U.cam, a), B = toStage(U.cam, b); const tm = timing(o, o.drawDur ?? 1.2); const k = ease.inOut(tm.k);
    const e = el('meas', o, '', 22); const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) * k, ang = Math.atan2(dy, dx) * 180 / Math.PI;
    Object.assign(e.style, { left: A.x + 'px', top: A.y + 'px', width: len + 'px', height: '3px', background: 'var(--line)', transformOrigin: '0 50%', transform: `rotate(${ang}deg)`, opacity: tm.o > 0 ? 1 : 0 });
    if (label) { const l = el('measL', o, 'pill', 23); setHTML(l, esc(typeof label === 'function' ? label(k) : label)); Object.assign(l.style, { left: A.x + dx * k + (o.lx ?? 18) + 'px', top: A.y + dy * k + 'px', opacity: clamp(k * 3) * tm.o, transform: 'translate(0,-50%)' }); } return e; };

  // ------------------------------------------------ numbers & cards
  // U.stat({value:174, label:'PASSENGERS ON BOARD', countFrom:0, decimals:0, prefix, suffix, kicker, sub}, {style:'plate'|'hero', pos, at, countDur})
  U.stat = (d, o = {}) => { const style = o.style || 'plate'; const e = el('stat', o, style, 30); const tm = timing({ at: 0.2, ...o }, 0.5);
    const cd = o.countDur ?? (d.countFrom != null ? 1.2 : 0); const kc = cd ? ease.out(prog(U.t, o.at ?? 0.2, (o.at ?? 0.2) + cd)) : 1;
    const v = typeof d.value === 'number' ? (d.prefix || '') + fmt(lerp(d.countFrom ?? d.value, d.value, kc), d.decimals || 0) + (d.suffix || '') : d.value;
    if (style === 'hero') setHTML(e, `${d.kicker ? `<div class="k">${esc(d.kicker)}</div>` : ''}<div class="v">${esc(v)}</div>${d.label ? `<div class="l">${esc(d.label)}</div>` : ''}${d.sub ? `<div class="s">${esc(d.sub)}</div>` : ''}`);
    else setHTML(e, `<div class="v">${esc(v)}</div>${d.label ? `<div class="l">${esc(d.label)}</div>` : ''}`);
    const tr = place(e, o.pos || 'c'); anim(e, tm, style === 'hero' ? 'blur' : 'pop', { base: tr }); return e; };
  // U.quote({text, who, role, source, photo, tag}, {style:'card'|'side', pos, at})
  U.quote = (d, o = {}) => { const style = o.style || (d.photo ? 'side' : 'card'); const e = el('quote', o, style === 'side' ? 'side' : 'quote', 30); const tm = timing({ at: 0.2, ...o }, 0.55);
    if (style === 'side') setHTML(e, `<div class="ph" style="background-image:url('${d.photo}')"></div><div><div class="q">“${esc(d.text)}”</div>${d.who ? `<div class="w">${esc(d.who)}</div>` : ''}${d.role ? `<div class="r">${esc(d.role)}</div>` : ''}</div>`);
    else setHTML(e, `${d.tag ? `<div class="src">${esc(d.tag)}</div>` : ''}<div class="qm">“</div><div class="q">${esc(d.text)}</div>${d.who ? `<div class="w">${esc(d.who)}</div>` : ''}${d.role || d.source ? `<div class="r">${esc([d.role, d.source].filter(Boolean).join(' · '))}</div>` : ''}`);
    if (style === 'side' && d.photo) { const img = new Image(); img.src = d.photo; if (!img.complete) pending.push(img.decode().catch(() => {})); }
    const tr = place(e, o.pos || 'c'); anim(e, tm, 'rise', { base: tr }); return e; };
  U.statement = (text, o = {}) => { const e = el('stmt', o, 'stmt', 30); setHTML(e, `<div class="q">${esc(text)}</div>${o.sub ? `<div class="s">${esc(o.sub)}</div>` : ''}`); const tm = timing({ at: 0.15, ...o }, 0.6); const tr = place(e, o.pos || 'c'); anim(e, tm, 'blur', { base: tr }); return e; };
  // U.list({kicker, items:[{title, sub}], numbered}, {at, times:[...] per item, pos})
  U.list = (d, o = {}) => { const e = el('list', o, 'list', 30); const items = d.items || [];
    setHTML(e, `${d.kicker ? `<div class="k">${esc(d.kicker)}</div>` : ''}${items.map((it, i) => `<div class="it">${d.numbered ? `<div class="num">${i + 1}</div>` : ''}<div><div class="t">${esc(it.title)}</div>${it.sub ? `<div class="s">${esc(it.sub)}</div>` : ''}</div></div>`).join('')}`);
    const tr = place(e, o.pos || 'c'); e.style.transform = tr; const at = o.at ?? 0.2; const k0 = timing({ ...o, at }, 0.4); if (e.firstChild && d.kicker) e.firstChild.style.opacity = k0.o;
    [...e.querySelectorAll('.it')].forEach((c, i) => { const tm = timing({ ...o, at: o.times?.[i] ?? at + 0.25 * (i + 1) }, 0.45); c.style.opacity = tm.o; c.style.transform = `translateY(${(1 - tm.k) * 16}px)`; c.style.filter = i >= (o.dimAfter ?? 99) ? 'opacity(.5)' : 'none'; }); return e; };
  U.compare = (d, o = {}) => { const e = el('cmp', o, 'cmp', 30); setHTML(e, `<div class="c"><div class="t">${esc(d.a.title)}</div>${d.a.sub ? `<div class="s">${esc(d.a.sub)}</div>` : ''}</div><div class="ar">→</div><div class="c"><div class="t">${esc(d.b.title)}</div>${d.b.sub ? `<div class="s">${esc(d.b.sub)}</div>` : ''}</div>`);
    const tr = place(e, o.pos || 'c'); e.style.transform = tr; const at = o.at ?? 0.2; [...e.children].forEach((c, i) => { const tm = timing({ ...o, at: o.times?.[i] ?? at + i * 0.3 }, 0.45); c.style.opacity = tm.o; c.style.transform = `translateX(${(1 - tm.k) * -18}px)`; }); return e; };
  U.phone = (d, o = {}) => { const e = el('phone', o, 'phone', 30); setHTML(e, `${d.kicker ? `<div class="k">${esc(d.kicker)}</div>` : ''}${d.play !== false ? '<div class="pl"></div>' : ''}<div class="t">${esc(d.title || '')}</div>${d.sub ? `<div class="k" style="margin-top:22px">${esc(d.sub)}</div>` : ''}`);
    const tm = timing({ at: 0.2, ...o }, 0.55); const tr = place(e, o.pos || 'c'); anim(e, tm, 'rise', { base: tr }); return e; };

  // ------------------------------------------------ charts (SVG)
  // U.chart({points:[[x,y],...], x:{min,max,ticks:[[x,'label']]}, y:{min,max,ticks:[[y,'label']]}, title, color, area:true, annotations:[{x,y,text,at}], marker:'dot'|'plane'},
  //          {at, drawFrom, drawTo (local s), box:[x,y,w,h]})
  U.chart = (d, o = {}) => { const e = el('chart', o, '', 20); const [bx, by, bw, bh] = o.box || [140, 170, E.W - 280, E.H - 380];
    const pts = d.points, X = d.x || { min: pts[0][0], max: pts[pts.length - 1][0] }, Y = d.y || { min: Math.min(...pts.map((p) => p[1])), max: Math.max(...pts.map((p) => p[1])) };
    const sx = (x) => bx + ((x - X.min) / (X.max - X.min)) * bw, sy = (y) => by + bh - ((y - Y.min) / (Y.max - Y.min)) * bh;
    const kd = ease.inOut(prog(U.t, o.drawFrom ?? 0.3, o.drawTo ?? Math.max(1.2, U.dur * 0.7))); const xEnd = X.min + (X.max - X.min) * kd;
    const vis = []; for (let i = 0; i < pts.length; i++) { if (pts[i][0] <= xEnd) vis.push(pts[i]); else { const a = pts[i - 1] || pts[i]; const b = pts[i]; const f = (xEnd - a[0]) / ((b[0] - a[0]) || 1); vis.push([xEnd, a[1] + (b[1] - a[1]) * clamp(f)]); break; } }
    const col = d.color || 'var(--accent)'; const line = vis.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
    const area = vis.length > 1 && d.area !== false ? `<path d="${line}L${sx(vis[vis.length - 1][0]).toFixed(1)},${by + bh}L${sx(vis[0][0]).toFixed(1)},${by + bh}Z" fill="${col}" opacity=".10"/>` : '';
    const grid = (Y.ticks || []).map(([v, l]) => `<line x1="${bx}" x2="${bx + bw}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--sub)" stroke-opacity=".25" stroke-width="1.5"/><text x="${bx - 18}" y="${sy(v) + 7}" text-anchor="end" font-family="IBM Plex Mono" font-size="20" fill="var(--sub)">${esc(l)}</text>`).join('')
      + (X.ticks || []).map(([v, l]) => `<text x="${sx(v)}" y="${by + bh + 40}" text-anchor="middle" font-family="IBM Plex Mono" font-size="20" fill="var(--sub)">${esc(l)}</text>`).join('');
    const last = vis[vis.length - 1]; const mk = d.marker && last ? (d.marker === 'plane' ? `<g transform="translate(${sx(last[0])},${sy(last[1])})"><path d="M-26,-4 L18,-4 L30,0 L18,4 L-26,4 Z M-6,-4 L4,-22 L10,-22 L6,-4 Z M-6,4 L4,22 L10,22 L6,4 Z M-24,-4 L-20,-14 L-16,-14 L-16,-4Z" fill="var(--ink)" opacity=".85"/></g>` : `<circle cx="${sx(last[0])}" cy="${sy(last[1])}" r="9" fill="${col}"/>`) : '';
    const ann = (d.annotations || []).map((a) => { const tm = timing({ at: a.at ?? (o.drawTo ?? 2) }, 0.4); return `<g opacity="${tm.o}" transform="translate(${sx(a.x) + (a.dx ?? 16)},${sy(a.y) + (a.dy ?? -16)})"><rect x="0" y="-26" rx="3" width="${a.text.length * 15 + 34}" height="44" fill="${col}"/><text x="17" y="4" font-family="IBM Plex Mono" font-size="24" fill="#fff">${esc(a.text)}</text></g>`; }).join('');
    const title = d.title ? `<text x="${bx}" y="${by - 50}" font-family="IBM Plex Mono" font-size="21" letter-spacing="3" fill="var(--sub)">${esc(d.title.toUpperCase())}</text>` : '';
    setHTML(e, `<svg width="${E.W}" height="${E.H}" viewBox="0 0 ${E.W} ${E.H}">${title}${grid}${area}<path d="${line}" fill="none" stroke="${col}" stroke-width="${d.width || 5}" stroke-linejoin="round" stroke-linecap="round"/>${mk}${ann}</svg>`);
    Object.assign(e.style, { left: 0, top: 0 }); e.style.opacity = timing({ at: o.at ?? 0 }, 0.4).o; return e; };

  // ------------------------------------------------ evidence: articles, documents, screenshots
  // U.article({outlet, color, headline, byline, date, paragraphs:[...], highlights:['phrase', ...]}, {at, hlAt:[t...], zoom:[[t,s,x,y],...], width})
  U.article = (d, o = {}) => { const e = el('art', o, 'art', 20); const W0 = o.width || (E.vertical ? 1000 : 1500);
    const paras = (d.paragraphs || []).map((p) => { let h = esc(p); (d.highlights || []).forEach((ph, i) => { const pe = esc(ph); h = h.replace(pe, `<mark data-i="${i}">${pe}</mark>`); }); return `<p>${h}</p>`; }).join('');
    setHTML(e, `<div class="bar" style="background:${d.color || '#c8102e'}"></div><div class="hd">${esc(d.headline)}</div>${d.byline ? `<div class="by">By <b>${esc(d.byline)}</b></div>` : ''}${d.date ? `<div class="dt">${esc(d.date)}</div>` : ''}<div class="bd">${paras}</div>`);
    e.style.width = W0 + 'px'; highlightMarks(e, d, o); zoomPage(e, o, W0); return e; };
  U.document = (d, o = {}) => { const e = el('doc', o, 'doc', 20); const W0 = o.width || (E.vertical ? 980 : 1400);
    const body = (d.paragraphs || []).map((p) => { let h = esc(p).replace(/\[\[(\d+)\]\]/g, (_, n) => `<span class="red" style="width:${n}em"></span>`); (d.highlights || []).forEach((ph, i) => { const pe = esc(ph); h = h.replace(pe, `<mark data-i="${i}">${pe}</mark>`); }); return `<p style="margin:0 0 26px">${h}</p>`; }).join('');
    setHTML(e, `${(d.header || []).map((h) => `<div class="h">${esc(h)}</div>`).join('')}${body}`); e.style.width = W0 + 'px'; highlightMarks(e, d, o); zoomPage(e, o, W0); return e; };
  // U.screenshot({src, w, h (image px), boxes:[{x,y,w,h, at}]}, {zoom:[[t,s,x,y]...]}) — x,y,w,h in image px
  U.screenshot = (d, o = {}) => { const e = el('shot', o, 'shot', 20); const W0 = o.width || Math.min(d.w || 1500, E.vertical ? 1000 : 1600), sc = W0 / (d.w || W0);
    setHTML(e, `<img src="${d.src}" style="width:${W0}px;height:auto">${(d.boxes || []).map((b, i) => `<div class="hlbox" data-i="${i}" style="left:${b.x * sc}px;top:${b.y * sc}px;height:${b.h * sc}px;width:0"></div>`).join('')}`);
    e.style.width = W0 + 'px'; e.style.background = '#fff'; e.style.boxShadow = '0 30px 90px rgba(0,0,0,.35)'; e.style.transformOrigin = '0 0';
    (d.boxes || []).forEach((b, i) => { const k = ease.inOut(prog(U.t, b.at ?? 0.6, (b.at ?? 0.6) + (b.dur ?? 0.6))); const bx = e.querySelector(`.hlbox[data-i="${i}"]`); if (bx) bx.style.width = b.w * sc * k + 'px'; });
    zoomPage(e, o, W0); return e; };
  function highlightMarks(e, d, o) { e.querySelectorAll('mark').forEach((m) => { const i = +m.dataset.i; const at = o.hlAt?.[i] ?? 0.8 + i * 0.9; const k = ease.inOut(prog(U.t, at, at + (o.hlDur ?? 0.7))); m.style.backgroundSize = `${k * 100}% 100%`; }); }
  function zoomPage(e, o, W0) { // zoom keys: [[t, scale, x, y]] where x,y = page point (px) to keep at stage centre
    const Z = o.zoom || [[0, 1.0, W0 / 2, 520], [U.dur, 1.1, W0 / 2, 600]]; const [s, x, y] = kf(U.t, Z.map((z) => [z[0], [z[1], z[2], z[3]]]), ease.sine);
    const tm = timing({ at: o.at ?? 0 }, 0.35); e.style.left = '0'; e.style.top = '0'; e.style.opacity = tm.o; e.style.transform = `translate(${E.W / 2 - x * s}px, ${E.H / 2 - y * s}px) scale(${s})`; }

  // ------------------------------------------------ photos
  // U.photo({src, caption:{kicker, title}, credit}, {kb:[[t, scale, cx, cy]] cx,cy 0..1 focus, vignette:.5, at, pos})
  U.photo = (d, o = {}) => { const e = el('photo', o, 'shot', 15); Object.assign(e.style, { left: 0, top: 0, width: E.W + 'px', height: E.H + 'px', overflow: 'hidden', background: '#000' });
    setHTML(e, `<img src="${d.src}" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 50%"><div style="position:absolute;inset:0;background:radial-gradient(ellipse 75% 75% at 50% 50%, transparent 55%, rgba(0,0,0,${o.vignette ?? 0.55}) 100%)"></div>`);
    const KB = o.kb || [[0, 1.04, 0.5, 0.5], [U.dur, 1.14, 0.52, 0.46]]; const [s, cx, cy] = kf(U.t, KB.map((z) => [z[0], [z[1], z[2], z[3]]]), ease.linear);
    const img = e.firstChild; img.style.transform = `scale(${s}) translate(${(0.5 - cx) * 100 / s}%, ${(0.5 - cy) * 100 / s}%)`;
    e.style.opacity = timing({ at: o.at ?? 0 }, o.fade ?? 0.01).o;
    if (d.caption) { const c = el('phcap', o, 'ph-cap', 30); setHTML(c, `${d.caption.kicker ? `<div class="k">${esc(d.caption.kicker)}</div>` : ''}${d.caption.title ? `<div class="t">${esc(d.caption.title)}</div>` : ''}`); const tm = timing({ at: o.capAt ?? 0.6 }, 0.6); const tr = place(c, o.capPos || 'bl'); anim(c, tm, 'blur', { base: tr }); }
    if (d.credit) { const c = el('phcr', o, 'ph-credit', 30); setHTML(c, esc(d.credit)); Object.assign(c.style, { right: '24px', bottom: '18px', left: 'auto', top: 'auto' }); }
    if (d.name) { const c = el('phname', o, 'name-pill', 30); setHTML(c, esc(d.name)); const tm = timing({ at: o.nameAt ?? 0.5 }, 0.5); const tr = place(c, { x: E.W / 2, y: E.H - 110, ax: 0.5, ay: 1 }); anim(c, tm, 'rise', { base: tr }); }
    return e; };
  // U.triptych({kicker, items:[{src, label}]}, {times:[...], pos})
  U.triptych = (d, o = {}) => { const e = el('tri', o, 'tri', 30); setHTML(e, d.items.map((it) => `<div class="p"><img src="${it.src}"><div class="l">${esc(it.label || '')}</div></div>`).join(''));
    const tr = place(e, o.pos || 'c'); e.style.transform = tr; [...e.children].forEach((c, i) => { const tm = timing({ at: o.times?.[i] ?? 0.3 + i * 0.5 }, 0.45); c.style.opacity = tm.o; c.style.transform = `translateY(${(1 - tm.k) * 14}px)`; }); return e; };

  // ------------------------------------------------ captions (burned subtitles from the word timings)
  U.captions = (o = {}) => { const g = U.info.start + U.t; const W = E.words; if (!W.length) return null;
    let i = W.findIndex((w) => w.end >= g); if (i < 0) return null; const max = o.words || (E.vertical ? 4 : 7);
    // chunk boundaries: every `max` words or at sentence ends / gaps
    let a = i; while (a > 0 && i - a < max - 1 && !/[.!?]$/.test(W[a - 1].word) && W[a].start - W[a - 1].end < 0.45) a--;
    const chunkStart = Math.floor((i - a) / max) * max + a; const words = W.slice(chunkStart, chunkStart + max); if (!words.length || g < words[0].start - 0.2 || g > words[words.length - 1].end + 0.4) return null;
    const e = el('cap', o, 'cap', 50); setHTML(e, words.map((w) => `<span class="${o.karaoke && g >= w.start && g <= w.end + 0.05 ? 'on' : ''}">${esc(w.word)}</span>`).join(' '));
    e.style.width = (E.W - 240) + 'px'; const tr = place(e, { x: E.W / 2, y: E.vertical ? E.H * 0.72 : E.H - 90, ax: 0.5, ay: 1 }); e.style.transform = tr; e.style.fontSize = (E.vertical ? 64 : 46) + 'px'; return e; };

  // ------------------------------------------------ escape hatches
  U.html = (keyName, html, style = {}, o = {}) => { const e = el('html', { key: keyName }, o.cls || '', o.z ?? 20); setHTML(e, html); Object.assign(e.style, style); return e; };
  U.svg = (keyName, inner, o = {}) => { const e = el('svg', { key: keyName }, '', o.z ?? 20); setHTML(e, `<svg width="${E.W}" height="${E.H}" viewBox="0 0 ${E.W} ${E.H}">${inner}</svg>`); Object.assign(e.style, { left: 0, top: 0, opacity: o.opacity ?? 1 }); return e; };
  U.timing = timing; U.place = place; U.anim = anim; U.fmt = fmt;
  return U;
}
