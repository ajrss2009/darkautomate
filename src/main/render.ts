import { BrowserWindow, protocol, session } from 'electron';

/*
 * Sessão PRÓPRIA do render: as janelas invisíveis que desenham cenas/kits bloqueiam http(s) (cenas sem rede).
 * Antes usavam a sessão padrão — o bloqueio valia também para a janela principal e as thumbs do YouTube
 * (i.ytimg.com) da aba Pesquisar paravam de carregar depois da primeira cena renderizada.
 */
export const RENDER_PARTITION = 'forge-render';
let renderSessionReady = false;
function renderSession() {
  const ses = session.fromPartition(RENDER_PARTITION);
  if (!renderSessionReady) { renderSessionReady = true; ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^https?:/i.test(d.url) })); }
  return ses;
}
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolveBin } from './ffmpeg';
import type { RenderHtml } from './executors';
import * as crypto from 'node:crypto';
import { parseRange } from './render-range';

/* ───────── kits de plugin (motor próprio do plugin: player.html/engine ou peça montada) ─────────
 * Cada kit é "montado" num host próprio do forge-scene:// (forge-scene://k<hash>/…), com o mesmo layout que o
 * servidor do plugin usa: /engine/… e /player.html do kit, /project/… do projeto, /node_modules/… das dependências
 * e /__manifest (lista dos módulos de cena). Caminhos absolutos dos módulos ("/engine/core.js") funcionam. */
export interface KitMount { root: string; project?: string; modules?: string; /** fonte entregue no lugar de uma fonte que não existe (evita que a página quebre) */ fallbackFont?: string }
const mounts = new Map<string, KitMount>();
export function kitHost(m: KitMount): string {
  const key = 'k' + crypto.createHash('sha1').update([m.root, m.project ?? '', m.modules ?? ''].map((x) => path.resolve(x || '.')).join('|')).digest('hex').slice(0, 16);
  mounts.set(key, m);
  return key;
}
function listScenes(dir: string, base: string): string[] {
  let out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out = out.concat(listScenes(p, `${base}/${f}`));
    else if (f.endsWith('.js') && !f.startsWith('_')) out.push(`${base}/${f}`);
  }
  return out;
}
function serveKit(m: KitMount, pathname: string): Response {
  const rel = decodeURIComponent(pathname);
  if (rel === '/__manifest') return new Response(JSON.stringify(m.project ? listScenes(path.join(m.project, 'scenes'), '/project/scenes') : []), { headers: { 'Content-Type': 'application/json' } });
  const pick = (base: string, sub: string) => { const f = path.resolve(base, '.' + sub); return f.startsWith(path.resolve(base) + path.sep) ? f : undefined; };
  const file = rel.startsWith('/project/') && m.project ? pick(m.project, rel.slice(8))
    : rel.startsWith('/@film/') && m.project ? pick(m.project, rel.slice(6))
    : rel.startsWith('/node_modules/') && m.modules && fs.existsSync(path.join(m.modules, rel.slice(14).split('/')[0]!)) ? pick(m.modules, rel.slice(13))
    : pick(m.root, rel);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    /* fonte ausente (repositórios não versionam fontes de terceiros): entrega a fonte de reserva */
    if (m.fallbackFont && /\.(ttf|otf|woff2?)$/i.test(rel) && fs.existsSync(m.fallbackFont)) return new Response(fs.readFileSync(m.fallbackFont), { headers: { 'Content-Type': MIME[path.extname(m.fallbackFont).toLowerCase()] ?? 'font/woff2', 'Access-Control-Allow-Origin': '*' } });
    return new Response('not found', { status: 404 });
  }
  return new Response(fs.readFileSync(file), { headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*' } });
}

/**
 * Codificador por pipe: os quadros (BGRA cru do capturePage) vão direto para o stdin do ffmpeg,
 * enquanto a captura continua. Sem PNG (codificar + gravar + o ffmpeg reler cada quadro) —
 * era a maior parte do tempo de uma cena por código.
 */
export function frameEncoder(ffmpeg: string, o: { fps: number; w: number; h: number; out: string; crf: number; lanczos?: boolean }) {
  let size: { width: number; height: number } | undefined;
  let proc: ChildProcess | undefined;
  let last: Buffer | undefined;
  let failed: Error | undefined;
  let stderr = '';
  let exited: Promise<number | null> | undefined;
  const start = (sz: { width: number; height: number }) => {
    size = sz;
    /* "ffmpeg" sem caminho (padrão das configurações) não está no PATH do Windows: resolve como o resto do app */
    proc = spawn(resolveBin(ffmpeg), ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${sz.width}x${sz.height}`, '-framerate', String(o.fps), '-i', 'pipe:0',
      '-vf', `scale=${o.w}:${o.h}${o.lanczos ? ':flags=lanczos' : ''},format=yuv420p`, '-r', String(o.fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf), o.out],
    { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    proc.stderr!.on('data', (d) => { stderr = (stderr + String(d)).slice(-2000); });
    proc.stdin!.on('error', (e) => { failed = failed ?? e; });
    exited = new Promise((res) => { proc!.on('error', (e) => { failed = failed ?? e; res(null); }); proc!.on('close', (c) => res(c)); });
  };
  const write = async (buf: Buffer) => {
    if (failed) throw new Error(`ffmpeg (codificação da cena): ${failed.message} ${stderr}`.trim());
    if (!proc!.stdin!.write(buf)) await new Promise<void>((res) => { proc!.stdin!.once('drain', res); proc!.once('close', () => res()); });
  };
  return {
    /** um quadro capturado (redimensionado se o tamanho mudar no meio, ex.: DPI) */
    async frame(img: Electron.NativeImage) {
      const sz = img.getSize();
      if (!size) start(sz);
      const fit = sz.width === size!.width && sz.height === size!.height ? img : img.resize({ width: size!.width, height: size!.height });
      last = fit.toBitmap();
      await write(last);
    },
    /** repete o quadro anterior (seek que falhou num quadro isolado) */
    async repeat() { if (last) await write(last); },
    async end() {
      if (!proc) throw new Error('nenhum quadro capturado');
      proc.stdin!.end();
      const code = await exited;
      if (failed || code !== 0) throw new Error(`ffmpeg (codificação da cena) saiu com ${code}: ${failed?.message ?? ''} ${stderr}`.trim());
    },
    kill() { try { proc?.kill(); } catch { /* já saiu */ } },
  };
}

/** Renderiza quadros de uma página de kit: "player" (window.renderFrame(índice), READY/BOOT_ERROR) ou "piece" (renderFrame(segundos)). */
export async function renderKitFrames(o: {
  url: string; w: number; h: number; ffmpeg: string; fps: number; mode: 'player' | 'piece' | 'page';
  from: number; to: number; out?: string; stills?: number[]; stillDir?: string; log?: (l: string) => void;
}): Promise<{ errors: string[]; files: string[] }> {
  /* enableLargerThanScreen: sem ele o Windows limita a janela à área útil da tela (1080 − barra de tarefas) e o quadro saía com faixas pretas e esticado */
  const win = new BrowserWindow({ show: false, width: o.w, height: o.h, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: RENDER_PARTITION } });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-kit-'));
  const pageErrors: string[] = [];
  win.webContents.on('console-message', (...a: unknown[]) => {
    const ev = a[0] as { message?: string } | undefined;
    const msg = typeof a[2] === 'string' ? a[2] : ev?.message ?? '';
    if (/ERROR|missing|Uncaught/i.test(msg) && pageErrors.length < 50) pageErrors.push(msg.slice(0, 400));
  });
  try {
    renderSession();
    await win.loadURL(o.url);
    const ready = o.mode === 'player'
      ? await win.webContents.executeJavaScript(`(async()=>{for(let i=0;i<1200;i++){ if(window.READY===true) return {ok:true, out: window.OUT}; if(window.BOOT_ERROR) return {err: String(window.BOOT_ERROR)}; await new Promise(r=>setTimeout(r,100)); } return {err:'o player não ficou pronto'}; })()`)
      : o.mode === 'page'
      ? await (async () => {
        /* espera o READY; se a página já lançou erro (ex.: arquivo de mídia ausente) e não fica pronta em 12 s, desiste */
        const t0 = Date.now();
        for (;;) {
          const st = await win.webContents.executeJavaScript(`({ ok: window.READY === true && typeof window.render === 'function', dur: Number(window.DUR) || 0, err: window.__FORGE_ERR ? String(window.__FORGE_ERR) : '' })`) as { ok: boolean; dur: number; err: string };
          if (st.ok) return { ok: true, dur: st.dur };
          if (st.err) return { err: st.err };
          if (Date.now() - t0 > 12_000 && pageErrors.some((e) => /Uncaught|NetworkError|Failed to fetch|is not defined/i.test(e))) return { err: 'a página lançou erro antes de ficar pronta' };
          if (Date.now() - t0 > 180_000) return { err: 'a página não definiu window.READY/window.render(t)' };
          await new Promise((res) => setTimeout(res, 200));
        }
      })()
      : await win.webContents.executeJavaScript(`(async()=>{for(let i=0;i<600;i++){ if(typeof window.renderFrame==='function') return {ok:true}; await new Promise(r=>setTimeout(r,100)); } return {err:'a peça não definiu renderFrame'}; })()`);
    const r = ready as { ok?: boolean; err?: string; out?: [number, number] };
    if (!r.ok) throw new Error(`${r.err}${pageErrors.length ? ' — ' + pageErrors.slice(0, 3).join(' | ') : ''}`);
    const [cw, ch] = r.out ?? [o.w, o.h];
    if (cw !== o.w || ch !== o.h) win.setContentSize(cw, ch);
    win.webContents.setFrameRate(o.fps);
    const call = (t: number) => o.mode === 'player' ? `window.renderFrame(${Math.round(t * o.fps)})` : o.mode === 'page' ? `await Promise.resolve(window.render(${(Math.round(t * o.fps) / o.fps).toFixed(5)}))` : `renderFrame(${(Math.round(t * o.fps) / o.fps).toFixed(5)})`;
    const files: string[] = [];
    const grab = async (t: number, file: string) => {
      await win.webContents.executeJavaScript(`(async()=>{ try { ${call(t)}; return null; } catch(e) { return String(e && e.message || e); } })()`).then((e) => { if (e && pageErrors.length < 50) pageErrors.push(`t=${t.toFixed(2)}: ${e}`); });
      await new Promise((res) => setTimeout(res, 6));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: cw, height: ch });
      fs.writeFileSync(file, img.toPNG());
    };
    /* aquecimento: o 1º quadro inicializa o 3D/fontes (sem isso saía preto) */
    await win.webContents.executeJavaScript(`(async()=>{ try { ${call(o.stills?.[0] ?? o.from)}; } catch {} })()`);
    await new Promise((res) => setTimeout(res, 400));
    if (o.stills?.length) {
      fs.mkdirSync(o.stillDir ?? tmp, { recursive: true });
      for (const [i, t] of o.stills.entries()) { const f = path.join(o.stillDir ?? tmp, `still_${i + 1}.png`); await grab(t, f); files.push(f); }
    }
    if (o.out) {
      /* quadros direto para o ffmpeg (sem PNG em disco) */
      const n = Math.max(1, Math.round((o.to - o.from) * o.fps));
      const enc = frameEncoder(o.ffmpeg, { fps: o.fps, w: o.w, h: o.h, out: o.out, crf: 19, lanczos: true });
      try {
        for (let i = 0; i < n; i++) {
          const t = o.from + i / o.fps;
          await win.webContents.executeJavaScript(`(async()=>{ try { ${call(t)}; return null; } catch(e) { return String(e && e.message || e); } })()`).then((e) => { if (e && pageErrors.length < 50) pageErrors.push(`t=${t.toFixed(2)}: ${e}`); });
          await new Promise((res) => setTimeout(res, 6));
          await enc.frame(await win.webContents.capturePage({ x: 0, y: 0, width: cw, height: ch }));
        }
        await enc.end();
      } catch (e) { enc.kill(); throw e; }
      files.push(o.out);
    }
    const errs = o.mode === 'player' ? ((await win.webContents.executeJavaScript('(window.ERRORS||[]).slice(0,50)')) as string[]) : [];
    return { errors: [...new Set([...errs, ...pageErrors])], files };
  } finally {
    win.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Esquema das cenas (registrar ANTES do app ficar pronto, em protocol.registerSchemesAsPrivileged). */
export const SCENE_SCHEME = { scheme: 'forge-scene', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } };
const MIME: Record<string, string> = { '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
/**
 * Proteções do render de cenas por código, instaladas depois que a página carregou:
 *  - CANVAS: guarda o transform/alfa/composição de cada contexto 2D como estavam depois da preparação da cena e
 *    os repõe antes de cada quadro. Um ctx.save() sem ctx.restore() fazia o translate se acumular quadro a quadro
 *    e a cena "escorregava" para fora da tela (o print e os destaques sumiam);
 *  - VÍDEO: a cena desenha o <video> logo depois de mudar currentTime, antes de o quadro novo estar decodificado.
 *    Depois do seek, espera os vídeos terminarem de pular e chama seek de novo (agora com o quadro certo).
 */
const SEEK_GUARDS_SETUP = `try {
  const ctxs = []; const base = new Map();
  /* base = identidade; só uma escala uniforme igual à proporção do canvas (HiDPI: ctx.scale(dpr) na preparação) é mantida —
     a prévia já rodou alguns quadros antes daqui, então um translate "vazado" não pode virar a base */
  const keep = (c) => { if (c && !base.has(c)) { ctxs.push(c); try {
    const m = c.getTransform(), cv = c.canvas, ratio = cv && cv.clientWidth ? cv.width / cv.clientWidth : 1;
    const hidpi = m.b === 0 && m.c === 0 && m.e === 0 && m.f === 0 && Math.abs(m.a - m.d) < 1e-6 && Math.abs(m.a - ratio) < 1e-3 && m.a !== 1;
    base.set(c, { m: hidpi ? m : new DOMMatrix(), a: 1, o: 'source-over' }); } catch {} } };
  document.querySelectorAll('canvas').forEach((cv) => { try { keep(cv.getContext('2d')); } catch {} });
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) { const c = gc.call(this, type, ...a); if (type === '2d') keep(c); return c; };
  /* restore() a mais com a pilha vazia não faz nada: desfaz os save() sem par e depois repõe a base */
  window.__forgeBefore = () => { for (const c of ctxs) { const b = base.get(c); if (!b) continue; try { for (let i = 0; i < 32; i++) c.restore(); c.setTransform(b.m); c.globalAlpha = b.a; c.globalCompositeOperation = b.o; c.shadowBlur = 0; c.shadowColor = 'transparent'; c.filter = 'none'; } catch {} } };
  const vids = new Set(); document.querySelectorAll('video').forEach((v) => vids.add(v));
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  if (d && d.set) Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get() { return d.get.call(this); }, set(v) { if (this instanceof HTMLVideoElement) vids.add(this); d.set.call(this, v); } });
  window.__forgeAfter = async (t) => {
    let waited = false;
    for (let i = 0; i < 80; i++) {
      const busy = [...vids].filter((v) => v.seeking || (v.readyState < 2 && v.networkState !== 3 && !v.error));
      if (!busy.length) break;
      waited = true; await new Promise((r) => setTimeout(r, 25));
    }
    if (waited) { try { window.__forgeBefore(); } catch {} await window.__forge.seek(t); }
  };
} catch {}`;

/**
 * Resposta de arquivo com suporte a PEDIDO PARCIAL (Range → 206). Sem isso o <video> não é "navegável":
 * currentTime volta para 0 e a cena por código que mostra um trecho da captura fica presa no 1º quadro.
 */
function fileResponse(file: string, range: string | null): Response {
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const size = fs.statSync(file).size;
  const r = parseRange(range, size);
  const base = { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
  if (!r) return new Response(fs.readFileSync(file), { headers: { ...base, 'Content-Length': String(size) } });
  const [start, end] = r;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(end - start + 1);
    fs.readSync(fd, buf, 0, buf.length, start);
    return new Response(buf, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(buf.length) } });
  } finally { fs.closeSync(fd); }
}

/**
 * forge-scene://scene/<caminho codificado>: serve as cenas e as bibliotecas dos plugins copiadas no projeto
 * com origem própria, para que <script type="module"> e import map funcionem (file:// bloqueia módulos).
 * Só entrega arquivos dentro das pastas permitidas.
 */
export function registerSceneProtocol(roots: () => string[]) {
  /* a mesma origem forge-scene:// na sessão padrão e na do render */
  const handler = (req: Request): Response => {
    try {
      const u = new URL(req.url);
      const kit = mounts.get(u.hostname);
      if (kit) return serveKit(kit, u.pathname);
      const file = path.resolve(u.pathname.replace(/^\//, '').split('/').map(decodeURIComponent).join(path.sep));
      const ok = roots().map((x) => path.resolve(x) + path.sep);
      if (!ok.some((root) => file.startsWith(root)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('not found', { status: 404 });
      return fileResponse(file, req.headers.get('range'));
    } catch { return new Response('bad request', { status: 400 }); }
  };
  protocol.handle('forge-scene', handler);
  renderSession().protocol.handle('forge-scene', handler);
}

/** URL forge-scene:// para um arquivo local (cada segmento codificado; o protocolo é registrado no main). */
export const sceneUrl = (file: string) => 'forge-scene://scene/' + path.resolve(file).split(path.sep).map(encodeURIComponent).join('/');

/**
 * Renderiza uma página HTML "determinística" (window.__forge.seek(t)) em MP4.
 *
 * Regras para não "piscar"/acelerar:
 *  - usa a DURAÇÃO DA CENA e o fps do vídeo final (30), não o que a página declarar;
 *  - congela o loop de pré-visualização (pause() e/ou desliga requestAnimationFrame);
 *  - captura exatamente round(duração × fps) quadros, um por 1/fps.
 */
/** Foto (PNG, sem perda) de uma página parada — thumbnails visuais. Espera o window.__forge.seek(0) (imagens e fontes). */
export async function snapHtml(htmlFile: string, out: string, o: { w: number; h: number }): Promise<void> {
  const win = new BrowserWindow({
    show: false, width: o.w, height: o.h, useContentSize: true, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: RENDER_PARTITION },
  });
  try {
    renderSession();
    win.setContentSize(o.w, o.h);
    await win.loadURL(sceneUrl(htmlFile));
    await win.webContents.executeJavaScript(`(async()=>{try{await (window.__forge&&window.__forge.seek&&window.__forge.seek(0))}catch(e){};await new Promise(r=>setTimeout(r,200));return true})()`);
    let img = await win.webContents.capturePage({ x: 0, y: 0, width: o.w, height: o.h });
    const sz = img.getSize();
    if (sz.width !== o.w || sz.height !== o.h) img = img.resize({ width: o.w, height: o.h, quality: 'best' });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, img.toPNG());
  } finally { win.destroy(); }
}

export const renderHtml: RenderHtml = async (htmlFile, out, { w, h, ffmpeg, duration, fps: fpsOpt, log }) => {
  const win = new BrowserWindow({
    show: false, width: w, height: h, useContentSize: true, enableLargerThanScreen: true,  // sem isso: faixas pretas (janela limitada à área útil da tela)
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: RENDER_PARTITION },
  });
  /* erros da página (console.error / exceções não tratadas) entram na mensagem: o "Script failed to execute"
     do Electron não diz nada, e quem corrige a cena precisa da mensagem real */
  const pageErrors: string[] = [];
  win.webContents.on('console-message', (...a: unknown[]) => {
    const ev = a[0] as { level?: string; message?: string; lineNumber?: number } | undefined;
    const level = typeof a[1] === 'number' ? a[1] : ev?.level === 'error' ? 3 : 0;
    const msg = typeof a[2] === 'string' ? a[2] : ev?.message ?? '';
    const line = typeof a[3] === 'number' ? a[3] : ev?.lineNumber;
    if (level >= 3 && msg && pageErrors.length < 8) pageErrors.push(`${msg}${line ? ` (linha ${line})` : ''}`);
  });
  const errs = () => (pageErrors.length ? ` — console: ${[...new Set(pageErrors)].slice(0, 3).join(' | ')}` : '');
  try {
    renderSession();
    /* origem forge-scene://: módulos ES e import map funcionam (a cena pode importar a biblioteca de um plugin) */
    win.setContentSize(w, h);   // garante w×h mesmo se a janela nasceu limitada à tela
    await win.loadURL(sceneUrl(htmlFile));
    /* módulos carregam de forma assíncrona: espera o window.__forge aparecer (até 8 s) */
    const info = await win.webContents.executeJavaScript(
      `(async()=>{for(let i=0;i<80;i++){const f=window.__forge; if(f&&typeof f.seek==='function') return {d:Number(f.duration)||4, fps:Number(f.fps)||30}; await new Promise(r=>setTimeout(r,100));} return null;})()`);
    if (!info) throw new Error(`a página não define window.__forge.seek(t)${errs()}`);

    const fps = Math.min(60, Math.max(1, Math.round(fpsOpt ?? 30)));
    const total = Math.max(0.2, Number(duration ?? info.d) || info.d);
    const frames = Math.max(1, Math.round(total * fps));

    /* congela a pré-visualização: o RAF do HTML continuava desenhando enquanto
       capturávamos, gerando quadros fora de ordem ("piscando"/acelerado). */
    await win.webContents.executeJavaScript(`(() => {
      try { if (window.__forge && typeof window.__forge.pause === 'function') window.__forge.pause(); } catch {}
      try { window.__forgeRAF = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; } catch {}
      try { window.cancelAnimationFrame = () => {}; } catch {}
      /* raio negativo (easing que passa do alvo) lança IndexSizeError e derrubava a cena inteira: trava em 0 */
      try {
        const P = CanvasRenderingContext2D.prototype, pos = (v) => (v > 0 ? v : 0);
        const rg = P.createRadialGradient; P.createRadialGradient = function (x0, y0, r0, x1, y1, r1) { return rg.call(this, x0, y0, pos(r0), x1, y1, pos(r1)); };
        const arc = P.arc; P.arc = function (x, y, r, ...a) { return arc.call(this, x, y, pos(r), ...a); };
        const el = P.ellipse; P.ellipse = function (x, y, rx, ry, ...a) { return el.call(this, x, y, pos(rx), pos(ry), ...a); };
        const at = P.arcTo; P.arcTo = function (x1, y1, x2, y2, r) { return at.call(this, x1, y1, x2, y2, pos(r)); };
      } catch {}
      try {
        const st = document.createElement('style');
        /* sem barras de rolagem no quadro (canvas do tamanho exato da janela gerava rolagem) */
        st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}html,body{overflow:hidden!important}::-webkit-scrollbar{display:none!important}';
        document.head && document.head.appendChild(st);
      } catch {}
      try { if (window.__forge) { window.__forge.duration = ${total}; window.__forge.fps = ${fps}; } } catch {}
      ${SEEK_GUARDS_SETUP}
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 120));
    win.webContents.setFrameRate(fps);

    /* URLs forge-scene:// (caminho absoluto inteiro) comiam os 600 caracteres: a linha da página que chamou a biblioteca sumia */
    const seekJs = (t: number) => `Promise.resolve().then(() => { try { window.__forgeBefore && window.__forgeBefore(); } catch {} return window.__forge.seek(${t.toFixed(5)}); })
      .then(() => (window.__forgeAfter ? window.__forgeAfter(${t.toFixed(5)}) : null))
      .then(() => null, (e) => String((e && (e.stack || e.message)) || e).replace(/forge-scene:\\/\\/scene\\/[^\\s)]*\\//g, '').slice(0, 600))`;
    /* checagem rápida ANTES de capturar: seek em ~2 pontos por segundo + o último quadro, sem capturar.
       Um erro no meio da cena aparece em ~1 s (e vai para a IA corrigir) em vez de depois de capturar metade dela. */
    const probes = [...new Set([...Array.from({ length: Math.ceil(total * 2) }, (_, k) => Math.min(frames - 1, Math.round((k / 2) * fps))), frames - 1])];
    const probeErrs: string[] = [];
    for (const i of probes) {
      const err = await win.webContents.executeJavaScript(seekJs(i / fps)) as string | null;
      if (err) probeErrs.push(`t=${(i / fps).toFixed(2)}s: ${err}`);
    }
    if (probeErrs.length > Math.max(1, probes.length * 0.1) || probeErrs[0]?.startsWith('t=0.00s'))
      throw new Error(`a cena lançou erro em seek(${probeErrs[0]})${errs()}`);

    /* seek(t) que lança erro: o erro volta como texto (com a pilha). Falhas isoladas repetem o quadro anterior;
       se falhar no 1º quadro ou em muitos quadros, a cena é rejeitada com a mensagem real (para a IA corrigir).
       Os quadros vão direto para o ffmpeg (BGRA cru por pipe), codificados enquanto a captura continua. */
    let failed = 0; let firstErr = '';
    const limit = Math.max(2, Math.floor(frames * 0.1));
    const enc = frameEncoder(ffmpeg, { fps, w, h, out, crf: 20 });
    try {
      for (let i = 0; i < frames; i++) {
        const t = i / fps;
        const err = await win.webContents.executeJavaScript(seekJs(t)) as string | null;
        if (err) {
          failed++;
          if (!firstErr) firstErr = `t=${t.toFixed(2)}s: ${err}`;
          if (i === 0 || failed > limit) throw new Error(`a cena lançou erro em seek(${firstErr})${errs()}`);
          await enc.repeat();
          continue;
        }
        await new Promise((r) => setTimeout(r, 6)); // deixa o compositor pintar o quadro
        await enc.frame(await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h }));
      }
    } catch (e) { enc.kill(); throw e; }

    if (failed) (log ?? console.warn)(`aviso: ${failed} de ${frames} quadro(s) lançaram erro e repetiram o quadro anterior — ${firstErr.slice(0, 300)}`);

    /* efeitos sonoros PROGRAMÁTICOS: a própria cena declara window.__forge.sfx = [{t, name, gain?}]
       nos instantes da animação; gravados ao lado do clipe para a etapa de efeitos usar. */
    try {
      const cues = await win.webContents.executeJavaScript(`(() => { try { const s = (window.__forge && window.__forge.sfx) || (typeof SFX !== 'undefined' ? SFX : null); return Array.isArray(s) ? JSON.parse(JSON.stringify(s)).slice(0, 64) : null; } catch { return null; } })()`) as unknown;
      const sidecar = out.replace(/\.mp4$/i, '') + '.sfx.json';
      if (Array.isArray(cues) && cues.length) fs.writeFileSync(sidecar, JSON.stringify(cues, null, 1));
      else fs.rmSync(sidecar, { force: true });
    } catch { /* cena sem sons declarados */ }
    /* enquadramento medido pela biblioteca cartoon3d (um status por personagem a cada quadro): os últimos `frames`
       registros são os quadros do render (antes dele a página ainda rodava a prévia) */
    try {
      const fr = await win.webContents.executeJavaScript(`(() => { try { const f = window.__cartoon3dFraming; if (!f) return null; const off = f.frames.length - ${frames}; return { names: f.names.slice(), frames: f.frames.slice(-${frames}), signNames: (f.signNames || []).slice(), signs: (f.signs || []).slice(-${frames}), jumps: (f.jumps || []).map((j) => ({ ...j, f: j.f - off })).filter((j) => j.f > 0) }; } catch { return null; } })()`) as { names: string[]; frames: string[]; signNames?: string[]; signs?: string[]; jumps?: Array<{ f: number; name: string; from: string; to: string }> } | null;
      const sidecar = out.replace(/\.mp4$/i, '') + '.framing.json';
      if (fr && fr.frames.length) fs.writeFileSync(sidecar, JSON.stringify({ fps, ...fr }));
      else fs.rmSync(sidecar, { force: true });
    } catch { /* página sem a biblioteca */ }

    await enc.end();
  } finally {
    win.destroy();
  }
};
