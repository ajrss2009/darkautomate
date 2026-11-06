// render.mjs — deterministic frame renderer (headless Chromium -> ffmpeg), parallel workers.
//   node render.mjs --project projects/my-video                      full video  -> build/video_silent.mp4
//   node render.mjs --project P --from 30 --to 45 --scale 0.5         preview a range -> build/preview.mp4
//   node render.mjs --project P --shots s012,s013 --scale 0.5         preview just these shots
//   node render.mjs --project P --sheet [--scale 0.4]                 one still per shot -> build/sheets/sheet_XX.png
//   node render.mjs --project P --stills 3.5,12,40                    stills at times -> build/stills
// Options: --quality draft|standard|high  --workers N  --scale K  --gl auto|gpu|swiftshader  --crf 18  --preset medium
//          --format png|jpeg  --out FILE (relative to the project)  --debug  --noui (hide the 2D layer: clean stills for photos / possibility panels)
//   node render.mjs --project P --stills 12.5,40 --noui --out assets/stills       stills kept in the project (for triptychs / photo cards)
//   node render.mjs --project P --shots s042 --patch                               re-render shots and splice them into build/video_silent.mp4
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = {}; { const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; args[k] = v; } } }
if (!args.project) { console.error('usage: node render.mjs --project projects/<name> [options]'); process.exit(1); }
const PROJECT = path.resolve(args.project);
if (!fs.existsSync(path.join(PROJECT, 'config.json'))) { console.error(`no project at ${PROJECT} (config.json missing) — create it with tools/new_project.py`); process.exit(1); }
const BUILD = path.join(PROJECT, 'build'); fs.mkdirSync(BUILD, { recursive: true });
// --out paths: absolute, or relative to the project folder (a path that already points inside the project also works)
const projPath = (p) => { if (path.isAbsolute(p)) return p; const viaCwd = path.resolve(p); return viaCwd.startsWith(PROJECT + path.sep) ? viaCwd : path.join(PROJECT, p); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream' };

function listScenes(dir, base) { let out = []; if (!fs.existsSync(dir)) return out; for (const f of fs.readdirSync(dir).sort()) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) out = out.concat(listScenes(p, `${base}/${f}`)); else if (f.endsWith('.js') && !f.startsWith('_')) out.push(`${base}/${f}`); } return out; }
const manifest = () => { const s = path.join(PROJECT, 'scenes'); return [...listScenes(path.join(s, 'lib'), '/project/scenes/lib'), ...listScenes(path.join(s, 'sets'), '/project/scenes/sets'), ...listScenes(path.join(s, 'shots'), '/project/scenes/shots')]; };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__manifest') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(manifest())); }
  const p = url.startsWith('/project/') ? path.join(PROJECT, url.slice(9)) : path.join(ROOT, url);
  const ok = (p.startsWith(ROOT) || p.startsWith(PROJECT)) && fs.existsSync(p) && !fs.statSync(p).isDirectory();
  if (!ok) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(p).pipe(res);
}).listen(0);
const PORT = server.address().port;
const gl = args.gl || (process.platform === 'linux' ? 'swiftshader' : 'auto');
const LAUNCH = { args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', ...(gl === 'swiftshader' ? ['--use-gl=angle', '--use-angle=swiftshader'] : []), ...(gl === 'gpu' ? ['--enable-gpu', '--use-angle=default'] : [])] };
const FORMAT = args.format === 'jpeg' ? 'jpeg' : 'png';
const CFG = JSON.parse(fs.readFileSync(path.join(PROJECT, 'config.json'), 'utf8'));
const FPS = CFG.fps || 30;

async function openPlayer(browser) {
  const qs = new URLSearchParams(); if (args.scale) qs.set('scale', args.scale); if (args.quality) qs.set('quality', args.quality); if (args.debug) qs.set('debug', '1'); if (args.noui) qs.set('noui', '1');
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { const t = m.text(); if (/ERROR|missing|not registered/i.test(t)) console.log('[page]', t); });
  await page.goto(`http://localhost:${PORT}/player.html?${qs}`);
  await page.waitForFunction('window.READY === true || !!window.BOOT_ERROR', null, { timeout: 180000 });
  const boot = await page.evaluate('window.BOOT_ERROR'); if (boot) throw new Error('Player failed to boot: ' + boot);
  const [w, h] = await page.evaluate('window.OUT'); await page.setViewportSize({ width: w, height: h });
  return page;
}
async function gpuInfo(page) { return page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; }); }
const shot = async (page, f) => { await page.evaluate((i) => window.renderFrame(i), f); return page.screenshot({ type: FORMAT, ...(FORMAT === 'jpeg' ? { quality: 94 } : {}) }); };
const fmtT = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;

async function renderVideo() {
  const b0 = await chromium.launch(LAUNCH); const p0 = await openPlayer(b0);
  const total = await p0.evaluate('window.TOTAL_FRAMES'); const list = await p0.evaluate('window.SHOT_LIST');
  const gpu = await gpuInfo(p0); const soft = /swiftshader|llvmpipe|software/i.test(gpu);
  console.log(`GPU: ${gpu}${soft ? '  (software rendering: slower; use a machine with a graphics card or --quality draft for previews)' : ''}`);
  const missing = list.filter((s) => !s.ok); if (missing.length) console.log(`WARNING: ${missing.length} shots have no scene file yet: ${missing.slice(0, 12).map((s) => s.id).join(', ')}${missing.length > 12 ? ' …' : ''}`);
  await b0.close();
  let f0 = Math.max(0, Math.round((+args.from || 0) * FPS)), f1 = Math.min(total, args.to ? Math.round(+args.to * FPS) : total);
  if (args.shots) { const ids = String(args.shots).split(','); const sel = list.filter((s) => ids.includes(s.id)); if (!sel.length) throw new Error('no such shots: ' + args.shots); f0 = Math.round(Math.min(...sel.map((s) => s.start)) * FPS); f1 = Math.round(Math.max(...sel.map((s) => s.end)) * FPS); }
  if (args.patch) {
    if (!fs.existsSync(path.join(BUILD, 'video_silent.mp4'))) throw new Error('--patch needs an existing build/video_silent.mp4 (render the full video first)');
    if (args.scale && +args.scale !== 1) throw new Error('--patch renders at full size: drop --scale');
    if (!(args.from || args.to || args.shots)) throw new Error('--patch needs --shots ids or --from/--to');
  }
  const defW = soft ? 1 : Math.max(1, Math.min(6, Math.floor(os.cpus().length / 2)));
  const W = Math.max(1, Math.min(+(args.workers || defW), Math.ceil((f1 - f0) / (FPS * 2))));
  const partsDir = path.join(BUILD, 'parts'); fs.rmSync(partsDir, { recursive: true, force: true }); fs.mkdirSync(partsDir, { recursive: true });
  const chunk = Math.ceil((f1 - f0) / W); let done = 0; const t0 = Date.now(); const errs = new Set();
  console.log(`Rendering frames ${f0}-${f1} (${((f1 - f0) / FPS).toFixed(1)} s at ${FPS} fps) with ${W} worker(s)…`);
  const work = async (k) => {
    const a = f0 + k * chunk, b = Math.min(f1, a + chunk); if (a >= b) return null;
    const browser = await chromium.launch(LAUNCH); const page = await openPlayer(browser);
    const out = path.join(partsDir, `part_${String(k).padStart(3, '0')}.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', args.preset || 'medium', '-crf', String(args.crf || 18), '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let f = a; f < b; f++) {
      const img = await shot(page, f); if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r)); done++;
      if (done % 60 === 0) { const el = (Date.now() - t0) / 1000, eta = (el / done) * (f1 - f0 - done); console.log(`  ${done}/${f1 - f0} frames  ${(done / el).toFixed(2)} fps  elapsed ${fmtT(el)}  eta ${fmtT(eta)}`); }
    }
    (await page.evaluate('window.ERRORS')).forEach((e) => errs.add(e));
    ff.stdin.end(); await new Promise((r) => ff.on('close', r)); await browser.close(); return out;
  };
  const parts = (await Promise.all([...Array(W)].map((_, k) => work(k)))).filter(Boolean);
  const lst = path.join(partsDir, 'list.txt'); fs.writeFileSync(lst, parts.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const isPreview = (args.from || args.to || args.shots) && !args.patch;
  const out = args.patch ? path.join(BUILD, 'patch.mp4') : args.out ? projPath(args.out) : path.join(BUILD, isPreview ? 'preview.mp4' : 'video_silent.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await new Promise((res, rej) => spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' }).on('close', (c) => (c ? rej(new Error('concat failed')) : res())));
  if (isPreview && CFG.voiceover && fs.existsSync(path.join(PROJECT, CFG.voiceover))) { // add the narration to previews so timing can be judged
    const withA = out.replace(/\.mp4$/, '_vo.mp4'); const ss = (f0 / FPS).toFixed(3), dd = ((f1 - f0) / FPS).toFixed(3);
    await new Promise((r) => spawn('ffmpeg', ['-y', '-v', 'error', '-i', out, '-ss', ss, '-t', dd, '-i', path.join(PROJECT, CFG.voiceover), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', withA], { stdio: 'inherit' }).on('close', r));
    if (fs.existsSync(withA)) fs.renameSync(withA, out);
  }
  if (args.patch) { // splice the re-rendered range into the existing full render (frame-accurate re-encode of the whole file)
    const full = path.join(BUILD, 'video_silent.mp4'); const bak = path.join(BUILD, 'video_silent_prev.mp4'); const tmp = path.join(BUILD, 'video_silent_patched.mp4');
    fs.copyFileSync(full, bak); const segs = [], ins = ['-i', bak, '-i', out]; let fc = '';
    if (f0 > 0) { fc += `[0:v]trim=start_frame=0:end_frame=${f0},setpts=PTS-STARTPTS[a];`; segs.push('[a]'); }
    fc += '[1:v]setpts=PTS-STARTPTS[b];'; segs.push('[b]');
    if (f1 < total) { fc += `[0:v]trim=start_frame=${f1},setpts=PTS-STARTPTS[c];`; segs.push('[c]'); }
    fc += `${segs.join('')}concat=n=${segs.length}:v=1:a=0[v]`;
    console.log(`Splicing frames ${f0}-${f1} into build/video_silent.mp4 (re-encode; previous version kept as video_silent_prev.mp4)…`);
    await new Promise((res, rej) => spawn('ffmpeg', ['-y', '-v', 'error', ...ins, '-filter_complex', fc, '-map', '[v]', '-c:v', 'libx264', '-preset', args.preset || 'medium', '-crf', String(args.crf || 18), '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', tmp], { stdio: 'inherit' }).on('close', (c) => (c ? rej(new Error('splice failed')) : res())));
    fs.renameSync(tmp, full); fs.rmSync(out, { force: true });
    console.log('Patched build/video_silent.mp4 — run audio/mix.py again to rebuild out/<title>.mp4');
  }
  if (errs.size) { console.log(`\n${errs.size} shot error(s):`); [...errs].slice(0, 40).forEach((e) => console.log('  ' + e)); }
  console.log(`\nDone: ${args.patch ? path.join(BUILD, 'video_silent.mp4') : out}  (${fmtT((Date.now() - t0) / 1000)})`);
}
// grid of labelled images, laid out by the browser
async function contactSheet(browser, items, outFile, cols = 4, cellW = 460) {
  const page = await browser.newPage({ viewport: { width: cols * (cellW + 12) + 12, height: 400 } });
  const html = `<html><body style="margin:0;background:#111;font:600 15px sans-serif;color:#eee"><div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:12px;padding:12px">${items.map((it) => `<div><img src="data:image/${FORMAT};base64,${it.img.toString('base64')}" style="width:${cellW}px;display:block;border-radius:4px"><div style="padding:5px 2px">${it.label.replace(/</g, '&lt;')}</div></div>`).join('')}</div></body></html>`;
  await page.setContent(html); await page.screenshot({ path: outFile, fullPage: true }); await page.close();
}
async function renderStills() {
  const dir = args.stills && args.out ? projPath(args.out) : path.join(BUILD, args.sheet ? 'sheets' : 'stills');
  if (!(args.stills && args.out)) fs.rmSync(dir, { recursive: true, force: true });   // never leave an old sheet behind if this run fails
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch(LAUNCH); const page = await openPlayer(browser);
  console.log(`GPU: ${await gpuInfo(page)}`);
  let targets; const list = await page.evaluate('window.SHOT_LIST');
  if (args.sheet) { const only = args.shots ? String(args.shots).split(',') : null; const at = +(args.at || 0.55);
    targets = list.filter((s) => !only || only.includes(s.id)).map((s) => ({ t: s.start + (s.end - s.start) * at, label: `${s.id}  ${s.start.toFixed(1)}s${s.ok ? '' : '  (MISSING)'}${s.set ? '  [' + s.set + ']' : ''}` })); }
  else targets = String(args.stills || args.at || '1').split(',').map(Number).map((t) => ({ t, label: `${t}s` }));
  const all = []; const t0 = Date.now();
  for (const tg of targets) { const img = await shot(page, Math.round(tg.t * FPS)); const name = `${tg.label.split(' ')[0].replace(/[^\w.]/g, '')}_${tg.t.toFixed(2)}.${FORMAT}`; fs.writeFileSync(path.join(dir, name), img); all.push({ img, label: tg.label }); }
  (await page.evaluate('window.ERRORS')).forEach((e) => console.log('  shot error:', e));
  const per = 20; if (!(args.stills && args.out)) for (let i = 0; i < all.length; i += per) await contactSheet(browser, all.slice(i, i + per), path.join(dir, `sheet_${String(i / per + 1).padStart(2, '0')}.png`), 4, 460);
  await browser.close(); console.log(`Wrote ${all.length} stills + contact sheet(s) to ${dir}  (${fmtT((Date.now() - t0) / 1000)})`);
}
try { if (args.sheet || args.stills) await renderStills(); else await renderVideo(); }
catch (e) { console.error('RENDER FAILED:', e.message); process.exitCode = 1; }
finally { server.close(); }
