// engine/player.js — loads a project, maps global time -> shot, renders one frame deterministically.
// window.renderFrame(f) (async) draws frame f: 3D set (if the shot has one) + HTML overlay layer.
import { E, getShot, shotInfo, clamp, ease, prog } from './core.js';
import { initRenderer, getSet, useSet, renderSet, clearCanvas, renderer } from './world.js';
import { createUI } from './ui.js';
import { resolveLook } from './looks.js';

const q = new URLSearchParams(location.search);
const PROJ = '/project';
const RES = { '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160, '4k': 2160 };
const errors = (window.ERRORS = []);
let U = null, fxDiv = null, missingDiv = null, cfgUi = {};

async function loadFonts() {
  const F = [['Inter', 400], ['Inter', 500], ['Inter', 600], ['Inter', 700], ['Inter', 800], ['Inter', 900], ['Archivo', 700], ['Archivo', 800], ['Archivo', 900],
    ['IBM Plex Mono', 400, 'ibm-plex-mono'], ['IBM Plex Mono', 500, 'ibm-plex-mono'], ['Source Serif 4', 400, 'source-serif-4'], ['Source Serif 4', 600, 'source-serif-4'], ['Source Serif 4', 700, 'source-serif-4']];
  for (const [fam, w, dir] of F) { const d = dir || fam.toLowerCase(); try { const ff = new FontFace(fam, `url(/node_modules/@fontsource/${d}/files/${d}-latin-${w}-normal.woff2)`, { weight: String(w) }); await ff.load(); document.fonts.add(ff); } catch (e) { console.log('font missing', fam, w); } }
}
async function boot() {
  const cfg = await (await fetch(`${PROJ}/config.json`)).json();
  const story = await (await fetch(`${PROJ}/story/shots.json`)).json();
  let words = []; try { const r = await fetch(`${PROJ}/timeline/words.json`); if (r.ok) { const j = await r.json(); words = j.words || j; } } catch {}
  const vertical = (cfg.aspect || '16:9') === '9:16';
  const short = RES[cfg.resolution || '1080p'] || 1080, long = Math.round((short * 16) / 9 / 2) * 2, scale = +(q.get('scale') || 1);
  const outW = Math.round(((vertical ? short : long) * scale) / 2) * 2, outH = Math.round(((vertical ? long : short) * scale) / 2) * 2;
  Object.assign(E, { vertical, W: vertical ? 1080 : 1920, H: vertical ? 1920 : 1080, outW, outH, fps: cfg.fps || 30, cfg, words, shots: story.shots, story, quality: q.get('quality') || cfg.quality || 'standard' });
  cfgUi = cfg.ui || {};
  await loadFonts();
  const stage = document.getElementById('stage'); stage.style.width = outW + 'px'; stage.style.height = outH + 'px';
  const canvas = document.getElementById('gl'); canvas.width = outW; canvas.height = outH; canvas.style.width = outW + 'px'; canvas.style.height = outH + 'px';
  initRenderer(canvas);
  U = createUI(stage); U.layout(); if (q.has('noui')) U.root.style.display = 'none';
  fxDiv = document.createElement('div'); Object.assign(fxDiv.style, { position: 'absolute', left: 0, top: 0, width: outW + 'px', height: outH + 'px', background: '#000', opacity: 0, zIndex: 100, pointerEvents: 'none' }); stage.appendChild(fxDiv);
  // load scene modules (sets first, then shots)
  const list = await (await fetch('/__manifest')).json();
  for (const f of list) { try { await import(f); } catch (e) { errors.push(`import ${f}: ${e.message}`); console.log('IMPORT ERROR', f, e.message); } }
  const dur = story.duration || E.shots[E.shots.length - 1].end;
  window.DURATION = dur; window.TOTAL_FRAMES = Math.ceil(dur * E.fps); window.OUT = [outW, outH];
  window.SHOT_LIST = E.shots.map((s) => ({ id: s.id, start: s.start, end: s.end, ok: !!getShot(s.id), set: getShot(s.id)?.set || null }));
  window.READY = true;
}
function shotIndexAt(t) { const S = E.shots; for (let i = 0; i < S.length; i++) if (t < S[i].end) return i; return S.length - 1; }
const prepared = new Map();   // shot id -> set state after setup()

async function drawShot(shot, lt) {
  const def = getShot(shot.id); const info = shotInfo(shot); E.shot = shot; E.t = lt;
  if (!def) { clearCanvas('#20141c'); U.begin(lt, info, null, 'dark'); U.bg('#20141c'); U.html('missing', `<div style="font:800 64px Inter;color:#ff6f61">MISSING SHOT ${shot.id}</div><div style="font:500 30px 'IBM Plex Mono';color:#fff;margin-top:20px;max-width:1500px">${(shot.line || '').slice(0, 160)}</div>`, { left: '120px', top: '380px' }); await U.end(); return; }
  try {
    let S = null, theme = def.theme || cfgUi.theme;
    if (def.set) {
      S = await getSet(def.set, def.look || undefined);
      useSet(S, def.look || undefined);
      if (prepared.get(shot.id) !== S) { def.setup?.(S, S.api, info); prepared.set(shot.id, S); for (const [k, v] of prepared) if (v === S && k !== shot.id) prepared.delete(k); }
      def.update?.(S, S.api, lt, info);
      renderSet(S);
      theme = theme || S.look.ui;
    } else { const L = resolveLook(def.look || cfgUi.look2d || 'clay'); clearCanvas(def.bg || L.bg); theme = theme || L.ui; }
    U.begin(lt, info, S ? S.camera : null, theme);
    if (!S || def.bg) U.bg(def.bg || 'theme');
    if (S && def.badge !== false && (def.badge || cfgUi.badge)) U.badge(typeof def.badge === 'string' ? def.badge : cfgUi.badge || 'RECONSTRUCTION');
    def.ui?.(U, lt, info, S?.api, S);
    if (shot.footnote || def.footnote) U.footnote(shot.footnote || def.footnote, { key: 'auto' });
    if (E.cfg.captions && shot.captions !== false) U.captions({ key: 'cap', karaoke: !!cfgUi.karaoke });
    await U.end();
  } catch (e) {
    const msg = `${shot.id}@${lt.toFixed(2)}: ${e.message}`; if (!errors.includes(msg) && errors.length < 200) errors.push(msg); console.log('SHOT ERROR', msg, e.stack?.split('\n').slice(0, 3).join(' | '));
    U.begin(lt, info, null, 'dark'); U.html('err', `<div style="font:800 40px Inter;color:#ff4040;max-width:1600px">ERROR ${msg.slice(0, 160)}</div>`, { left: '100px', top: '480px' }); await U.end();
  }
}
window.renderFrame = async function (f) {
  const t = f / E.fps, i = shotIndexAt(t), shot = E.shots[i], lt = t - shot.start;
  await drawShot(shot, lt);
  // transitions & fades (overlay div): shot.in = {type:'dip'|'dipWhite'|'flash'|'cut', dur}
  let a = 0, col = '#000';
  const tr = shot.in || {}; const next = E.shots[i + 1]; const ntr = next?.in || {};
  if ((tr.type === 'dip' || tr.type === 'dipWhite') && i > 0) { const d = (tr.dur ?? 0.5) / 2; if (lt < d) { a = 1 - lt / d; col = tr.type === 'dip' ? '#000' : '#fff'; } }
  if ((ntr.type === 'dip' || ntr.type === 'dipWhite') && next) { const d = (ntr.dur ?? 0.5) / 2, left = shot.end - t; if (left < d) { a = Math.max(a, 1 - left / d); col = ntr.type === 'dip' ? '#000' : '#fff'; } }
  if (tr.type === 'flash' && lt < (tr.dur ?? 0.35)) { a = Math.max(a, (1 - lt / (tr.dur ?? 0.35)) ** 2); col = '#fff'; }
  const fi = E.cfg.fadeIn ?? 0.4, fo = E.cfg.fadeOut ?? 1.0, dur = window.DURATION;
  const fade = Math.max(fi > 0 ? 1 - t / fi : 0, fo > 0 ? 1 - (dur - t) / fo : 0); if (fade > a) { a = fade; col = '#000'; }
  fxDiv.style.background = col; fxDiv.style.opacity = clamp(a);
  if (q.has('debug')) U.html('dbg', `<div style="background:rgba(0,0,0,.65);color:#fff;font:600 24px 'IBM Plex Mono';padding:10px 18px">${shot.id}  ${t.toFixed(2)}s (${lt.toFixed(2)}/${(shot.end - shot.start).toFixed(2)})  ${(shot.line || '').slice(0, 80)}</div>`, { left: 0, top: E.H - 50 + 'px', width: E.W + 'px' });
  renderer().getContext().finish?.();
  return true;
};
boot().catch((e) => { window.BOOT_ERROR = e.message + '\n' + e.stack; console.log('BOOT ERROR', e.message); });
