import { BrowserWindow, session } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Aspect, Attachment, Project } from '../shared/types';
import { frameEncoder } from './render';
import { resolution, run } from './ffmpeg';
import { userDir } from './attachments';
import { findLinks, linkBudget, linksDoc, pageDoc, scrollPlan, youTubeId, type PageClip, type PageInfo } from './weblink';

/*
 * Vídeo explicativo de link: antes da rota, abre o link num navegador invisível (sessão própria, em memória, sem os
 * logins do usuário), lê título/seções/texto, tira prints das seções e grava um vídeo da página rolando. Tudo vira
 * anexo do projeto em assets/user/web/ — o roteiro lê o conteúdo e as cenas por código mostram trechos da captura.
 */
const WEB_PARTITION = 'forge-web';
let webReady = false;
function webSession() {
  const ses = session.fromPartition(WEB_PARTITION);
  if (!webReady) {
    webReady = true;
    ses.on('will-download', (_e, item) => item.cancel());                               // nada é baixado
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));                     // sem câmera, notificação, localização…
  }
  return ses;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Prazo para uma promessa da página. `executeJavaScript` numa promessa que nunca resolve (um `play()` pendente, um
 * requestAnimationFrame que não chega numa janela invisível) não tem timeout no Electron: a etapa ficaria "executando"
 * para sempre e a fila do lote nunca andaria. Com prazo, a captura segue sem aquele pedaço em vez de travar tudo.
 */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`tempo esgotado (${Math.round(ms / 1000)} s) em ${what}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/** Esconde banners fixos de cookies/consentimento (não aceita nada) e desliga a rolagem suave. */
const CLEAN_CSS = `html,body{scroll-behavior:auto!important}
[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],[aria-label*="cookie" i],
#onetrust-banner-sdk,.onetrust-pc-dark-filter,#CybotCookiebotDialog,.fc-consent-root,.cc-window,.qc-cmp2-container{display:none!important}
::-webkit-scrollbar{display:none}`;

/** Lê a página (roda dentro dela; texto puro). */
const READ_PAGE = String.raw`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const meta = (n) => clean(document.querySelector('meta[name="' + n + '"],meta[property="' + n + '"]')?.getAttribute('content'));
  const root = document.querySelector('main, article, [role=main]') || document.body;
  const sections = [...document.querySelectorAll('h1, h2, h3')].filter(vis).map((h) => ({ title: clean(h.innerText).slice(0, 90), y: Math.round(h.getBoundingClientRect().top + scrollY) })).filter((s) => s.title.length > 1).slice(0, 40);
  const se = document.scrollingElement || document.documentElement;
  return { title: clean(document.title).slice(0, 160), description: meta('description') || meta('og:description'), lang: document.documentElement.lang || '',
    text: (root.innerText || '').replace(/\n\s*\n\s*\n+/g, '\n\n').trim().slice(0, 20000), sections,
    maxY: Math.max(0, se.scrollHeight - innerHeight), viewH: innerHeight };
})()`;

/** Acha os vídeos da página (inclusive dentro de shadow DOM, como o player do Reddit) e os vídeos embutidos. */
const FIND_VIDEOS = String.raw`(() => {
  const vids = [];
  const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'VIDEO') vids.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
  walk(document);
  const heads = [...document.querySelectorAll('h1, h2, h3')].map((h) => ({ y: h.getBoundingClientRect().top + scrollY, t: (h.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) }));
  const near = (y) => { let best = ''; for (const h of heads) if (h.y <= y + 5) best = h.t; return best; };
  window.__forgeVids = vids;
  const list = vids.map((v, i) => { const r = v.getBoundingClientRect(); return { i, w: r.width, h: r.height, y: Math.round(r.top + scrollY), near: near(r.top + scrollY),
    label: (v.getAttribute('aria-label') || v.title || '').replace(/\s+/g, ' ').slice(0, 80) }; }).filter((x) => x.w >= 160 && x.h >= 90)
    /* o vídeo principal é o maior: banners animados de perfil (topo, largos e baixos) ficam por último */
    .sort((a, b) => (b.w * b.h * (b.w / b.h > 3 ? 0.2 : 1)) - (a.w * a.h * (a.w / a.h > 3 ? 0.2 : 1)));
  const embeds = [...document.querySelectorAll('iframe')].map((f) => f.src).filter((s) => /youtube\.com\/embed|youtube-nocookie|player\.vimeo|streamable\.com|tiktok\.com\/embed/.test(s)).slice(0, 5);
  /* vídeos do YouTube citados pela página: player embutido, post do Reddit que aponta para o YouTube, og:video */
  const yt = [...embeds,
    ...[...document.querySelectorAll('shreddit-post')].map((p) => p.getAttribute('content-href') || ''),
    ...[...document.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]')].map((m) => m.getAttribute('content') || '')]
    .filter((s) => /youtu\.?be/.test(s));
  return { list, embeds, yt };
})()`;
/** Põe o vídeo i no meio da tela e dá play sem som; devolve se está tocando e o retângulo (frações da tela). */
const PLAY_VIDEO = String.raw`(async (i) => {
  const v = (window.__forgeVids || [])[i]; if (!v) return { playing: false };
  v.scrollIntoView({ block: 'center', behavior: 'instant' });
  v.muted = true; v.loop = true; v.playsInline = true;
  /* play() pode ficar pendente numa janela invisível: não deixa a promessa sem prazo */
  try { await Promise.race([v.play(), new Promise((r) => setTimeout(r, 5000))]); } catch (e) { /* reprodução automática bloqueada */ }
  await new Promise((r) => setTimeout(r, 1800));
  const r = v.getBoundingClientRect();
  return { playing: !v.paused && v.currentTime > 0.2, x: r.left / innerWidth, y: r.top / innerHeight, w: r.width / innerWidth, h: r.height / innerHeight };
})`;

/**
 * Grava a tela em TEMPO REAL por `seconds` (o vídeo da página está tocando): captura o mais rápido que der e repete o
 * último quadro até o relógio alcançar o próximo, para o trecho durar o mesmo que durou de verdade.
 */
async function recordRealtime(wc: Electron.WebContents, shot: () => Promise<Electron.NativeImage>, ffmpeg: string,
  o: { fps: number; w: number; h: number; out: string; seconds: number; signal?: AbortSignal }): Promise<void> {
  const enc = frameEncoder(ffmpeg, { fps: o.fps, w: o.w, h: o.h, out: o.out, crf: 18 });
  const total = Math.round(o.seconds * o.fps), t0 = Date.now();
  /* trava de segurança: a gravação é em tempo real, então nunca deve passar de poucas vezes o trecho pedido */
  const limit = t0 + Math.max(20_000, Math.round(o.seconds * 4000));
  let written = 0;
  try {
    while (written < total) {
      if (o.signal?.aborted) throw new Error('cancelado');
      if (Date.now() > limit) throw new Error(`gravação do trecho travou (${o.seconds} s pedidos, ${Math.round((Date.now() - t0) / 1000)} s decorridos)`);
      const img = await shot();
      const due = Math.min(total, Math.max(written + 1, Math.floor(((Date.now() - t0) / 1000) * o.fps)));
      while (written < due) { await enc.frame(img); written++; }
    }
    await enc.end();
  } catch (e) { enc.kill(); throw e; }
  void wc;
}

/** Esconde os controles e sobreposições do player do YouTube (fica só a imagem do vídeo). */
const YT_CSS = `.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-pause-overlay,.ytp-watermark,.ytp-impression-link,
.ytp-show-cards-title,.ytp-ce-element,.ytp-spinner,.ytp-cued-thumbnail-overlay,.ytp-paid-content-overlay,.ytp-title,.ytp-youtube-button,.iv-branding,
.ytp-contextmenu,.ytp-tooltip,.ytp-overflow-button,.ytp-large-play-button,.ytp-bezel,#movie_player>*:not(.html5-video-container){display:none!important}
body *{visibility:hidden!important}.html5-video-container,.html5-video-container *{visibility:visible!important}
body{background:#000!important;cursor:none!important}`;   // o player novo põe os controles fora do #movie_player: só o vídeo fica visível
/** Dentro do player embutido: espera o anúncio passar, dá play sem som e pula para ~1/4 do vídeo. */
const YT_PLAY = String.raw`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    const v = document.querySelector('video'), ad = document.querySelector('.ad-showing, .ad-interrupting');
    const err = document.querySelector('.ytp-error-content-wrap-reason, .ytp-error');
    if (err && err.offsetParent && (err.innerText || '').trim()) return { playing: false, why: (err.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) };
    if (v && !ad) {
      v.muted = true;
      if (v.paused) { try { await v.play(); } catch (e) { document.querySelector('.ytp-large-play-button')?.click(); } }
      if (!v.paused && v.duration > 0) {
        if (!window.__forgeSeek) { window.__forgeSeek = 1; if (v.duration > 40) v.currentTime = Math.min(v.duration * 0.25, v.duration - 20); await wait(1800); continue; }
        if (!v.paused && v.readyState >= 3) return { playing: true, duration: v.duration, at: v.currentTime };
      }
    }
    await wait(500);
  }
  return { playing: false, why: document.querySelector('.ad-showing') ? 'anúncio não terminou' : 'o player não começou' };
})()`;

/**
 * Grava um trecho de um vídeo do YouTube que a página cita (embutido ou, no Reddit, o post que aponta para ele): abre
 * o player embutido (youtube-nocookie, sem som, sem controles) numa janela invisível do mesmo tamanho e grava em tempo real.
 */
async function recordYouTube(id: string, o: { out: string; w: number; h: number; fps: number; seconds: number; ffmpeg: string; referrer: string; signal?: AbortSignal; log?: (l: string) => void }): Promise<boolean> {
  const win = new BrowserWindow({ show: false, width: o.w, height: o.h, useContentSize: true, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, session: webSession() } });
  const wc = win.webContents;
  const abort = () => { try { win.destroy(); } catch { /* já fechada */ } };
  o.signal?.addEventListener('abort', abort, { once: true });
  try {
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.setFrameRate(o.fps);
    wc.setUserAgent(wc.getUserAgent().replace(/\s(Electron|filmforge)\/\S+/gi, ''));
    const url = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&iv_load_policy=3&disablekb=1&fs=0`;
    /* o player embutido recusa abrir sem a página de origem (erro 153): manda o link da página como referência */
    await Promise.race([wc.loadURL(url, { httpReferrer: o.referrer }).catch((e: Error) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }), sleep(30_000)]);
    await wc.insertCSS(YT_CSS);
    const st = await withTimeout(wc.executeJavaScript(YT_PLAY), 90_000, 'dar play no vídeo do YouTube') as { playing: boolean; why?: string; duration?: number; at?: number };
    if (!st.playing) { o.log?.(`vídeo do YouTube ${id} não tocou (${st.why ?? '?'}) — ignorado`); return false; }
    await wc.insertCSS(YT_CSS);   // de novo: o player cria as sobreposições depois do play
    await sleep(1200);
    const shot = async () => {
      await withTimeout(wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'), 15_000, 'esperar o quadro do YouTube');
      return withTimeout(wc.capturePage({ x: 0, y: 0, width: o.w, height: o.h }), 15_000, 'capturar o quadro do YouTube');
    };
    await recordRealtime(wc, shot, o.ffmpeg, { fps: o.fps, w: o.w, h: o.h, out: o.out, seconds: o.seconds, signal: o.signal });
    o.log?.(`trecho do YouTube gravado a partir de ${Math.round(st.at ?? 0)} s (vídeo de ${Math.round(st.duration ?? 0)} s)`);
    return true;
  } finally {
    o.signal?.removeEventListener('abort', abort);
    abort();
  }
}

export interface WebCapture { url: string; title: string; video: string; md: string; shots: Array<{ file: string; title: string }>; seconds: number; clips: PageClip[] }

/** Abre o link, lê, tira prints e grava a rolagem em `dir` (pagina.mp4, pagina.md, pagina.json, prints). */
export async function captureWebPage(o: { url: string; dir: string; ffmpeg: string; aspect: Aspect; maxSec?: number; fps?: number; log?: (l: string) => void; signal?: AbortSignal; /** caminho dos arquivos visto pelo roteiro (web ou web/l2) */ prefix?: string; /** quanto texto da página entra no resumo */ textMax?: number; /** trechos de vídeo da página a gravar e duração de cada */ clips?: number; clipSec?: number }): Promise<WebCapture> {
  const pre = o.prefix ?? 'web';
  if (!/^https?:\/\//i.test(o.url)) throw new Error('link inválido (só http/https)');
  const { w, h } = resolution(o.aspect), tall = h > w, zoom = tall ? 2.5 : 1.5, fps = o.fps ?? 30;
  fs.mkdirSync(o.dir, { recursive: true });
  const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, zoomFactor: zoom, backgroundThrottling: false, session: webSession() } });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.setFrameRate(fps);
  wc.setUserAgent(tall ? MOBILE_UA : wc.getUserAgent().replace(/\s(Electron|filmforge)\/\S+/gi, ''));
  const abort = () => { try { win.destroy(); } catch { /* já fechada */ } };
  o.signal?.addEventListener('abort', abort, { once: true });
  /** script na página com prazo (ver `withTimeout`): nada aqui pode segurar a fila do lote sem fim */
  const js = <T,>(code: string, ms: number, what: string) => withTimeout(wc.executeJavaScript(code) as Promise<T>, ms, what);
  const shot = async () => {
    await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))', 15_000, 'esperar o quadro da página');
    return withTimeout(wc.capturePage({ x: 0, y: 0, width: w, height: h }), 15_000, 'capturar o quadro da página');
  };
  try {
    o.log?.(`🌐 abrindo o link no navegador invisível: ${o.url}`);
    await Promise.race([wc.loadURL(o.url).catch((e: Error) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }), sleep(45_000)]);
    wc.setZoomFactor(zoom);
    await sleep(2500);
    await wc.insertCSS(CLEAN_CSS);
    /* desce a página uma vez para carregar imagens "lazy" e volta ao topo */
    await js(`(async () => { const se = document.scrollingElement || document.documentElement; for (let i = 0; i < 40 && scrollY + innerHeight < se.scrollHeight - 4; i++) { scrollBy(0, innerHeight * 0.9); await new Promise((r) => setTimeout(r, 140)); } scrollTo(0, 0); })()`, 60_000, 'carregar as imagens da página');
    await sleep(900);
    const raw = await js<Omit<PageInfo, 'url'>>(READ_PAGE, 45_000, 'ler a página');
    const info: PageInfo = { ...raw, url: wc.getURL() || o.url };
    o.log?.(`página lida: "${info.title}" — ${info.sections.length} seção(ões), ${info.text.length} caracteres, altura ${Math.round(info.maxY + info.viewH)} px`);
    /* prints: topo + até 6 seções */
    const shots: WebCapture['shots'] = [];
    const save = async (y: number, file: string, title: string) => {
      await js(`scrollTo({ top: ${Math.max(0, Math.round(y))}, behavior: 'instant' })`, 15_000, 'rolar a página'); await sleep(250);
      fs.writeFileSync(path.join(o.dir, file), (await shot()).toPNG()); shots.push({ file: `${pre}/${file}`, title });
    };
    await save(0, 'pagina-topo.png', `topo da página — ${info.title}`);
    for (const [i, s] of info.sections.filter((x) => x.y > info.viewH * 0.5).slice(0, 6).entries()) await save(s.y - info.viewH * 0.12, `secao-${i + 1}.png`, s.title);
    /* vídeos da página: grava TRECHOS CURTOS tocando (sem som), em tempo real, recortados no tamanho do vídeo */
    const clips: PageClip[] = [];
    let embeds: string[] = [];
    if ((o.clips ?? 2) > 0) {
      try {
        const found = await js<{ list: Array<{ i: number; near: string; label: string }>; embeds: string[]; yt: string[] }>(FIND_VIDEOS, 60_000, 'ler os vídeos da página');
        embeds = found.embeds;
        if (found.list.length) o.log?.(`a página tem ${found.list.length} vídeo(s) — gravando até ${o.clips ?? 2} trecho(s) de ${o.clipSec ?? 10} s`);
        for (const v of found.list) {
          if (clips.length >= (o.clips ?? 2) || o.signal?.aborted) break;
          let st: { playing: boolean; x: number; y: number; w: number; h: number };
          try {
            st = await js<{ playing: boolean; x: number; y: number; w: number; h: number }>(`${PLAY_VIDEO}(${v.i})`, 30_000, `dar play no vídeo ${v.i + 1}`);
          } catch (e) {
            /* play() travado (janela invisível): este trecho é ignorado, a captura da página continua */
            o.log?.(`vídeo ${v.i + 1} travou ao tocar (${(e as Error).message.slice(0, 120)}) — ignorado`);
            continue;
          }
          if (!st.playing) { o.log?.(`vídeo ${v.i + 1} não tocou sozinho (reprodução bloqueada) — ignorado`); continue; }
          const n = clips.length + 1, raw = path.join(o.dir, `video-${n}.raw.mp4`), file = path.join(o.dir, `video-${n}.mp4`);
          await recordRealtime(wc, shot, o.ffmpeg, { fps, w, h, out: raw, seconds: o.clipSec ?? 10, signal: o.signal });
          /* recorte do retângulo do vídeo (na tela); fora da tela é cortado */
          const X = Math.max(0, st.x), Y = Math.max(0, st.y), W = Math.min(1 - X, st.w - (X - st.x)), H = Math.min(1 - Y, st.h - (Y - st.y));
          if (W < 0.1 || H < 0.1) { fs.rmSync(raw, { force: true }); continue; }
          await run(o.ffmpeg, ['-y', '-i', raw, '-vf', `crop=iw*${W.toFixed(4)}:ih*${H.toFixed(4)}:iw*${X.toFixed(4)}:ih*${Y.toFixed(4)},scale=trunc(iw/2)*2:trunc(ih/2)*2`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', file], o.signal);
          fs.rmSync(raw, { force: true });
          clips.push({ file: `${pre}/video-${n}.mp4`, seconds: o.clipSec ?? 10, near: v.near || undefined, label: v.label || undefined });
          o.log?.(`trecho de vídeo gravado: ${pre}/video-${n}.mp4 (${o.clipSec ?? 10} s)`);
        }
        await js(`(window.__forgeVids || []).forEach((v) => { try { v.pause(); } catch {} }); scrollTo(0, 0)`, 15_000, 'parar os vídeos da página');
        /* vídeos do YouTube citados pela página (embutidos ou link do post): trecho pelo player embutido */
        const ytIds = [...new Set(found.yt.map(youTubeId).filter((x): x is string => !!x))];
        if (ytIds.length && clips.length < (o.clips ?? 2)) o.log?.(`a página cita ${ytIds.length} vídeo(s) do YouTube — gravando trecho pelo player embutido`);
        for (const id of ytIds) {
          if (clips.length >= (o.clips ?? 2) || o.signal?.aborted) break;
          const n = clips.length + 1, file = path.join(o.dir, `video-${n}.mp4`);
          if (!await recordYouTube(id, { out: file, w, h, fps, seconds: o.clipSec ?? 10, ffmpeg: o.ffmpeg, referrer: wc.getURL() || o.url, signal: o.signal, log: o.log })) continue;
          clips.push({ file: `${pre}/video-${n}.mp4`, seconds: o.clipSec ?? 10, label: `vídeo do YouTube (youtu.be/${id})` });
          embeds = embeds.filter((u) => youTubeId(u) !== id);
          o.log?.(`trecho de vídeo gravado: ${pre}/video-${n}.mp4 (${o.clipSec ?? 10} s, YouTube)`);
        }
      } catch (e) { if (o.signal?.aborted) throw e; o.log?.(`vídeos da página ignorados: ${(e as Error).message.slice(0, 160)}`); }
    }
    /* vídeo: rolagem com paradas nas seções */
    const plan = scrollPlan({ maxY: info.maxY, viewH: info.viewH, sections: info.sections, fps, maxSec: o.maxSec ?? 40 });
    o.log?.(`gravando a página rolando: ${plan.seconds} s, ${plan.marks.length} parada(s) nas seções…`);
    const video = path.join(o.dir, 'pagina.mp4');
    const enc = frameEncoder(o.ffmpeg, { fps, w, h, out: video, crf: 18, lanczos: true });
    try {
      let last = -1;
      for (const y of plan.ys) {
        if (o.signal?.aborted) throw new Error('cancelado');
        if (y !== last) { await js(`scrollTo({ top: ${y}, behavior: 'instant' })`, 15_000, 'rolar a página'); last = y; }
        await enc.frame(await shot());
      }
      await enc.end();
    } catch (e) { enc.kill(); throw e; }
    const md = pageDoc(info, plan, { video: `${pre}/pagina.mp4`, shots, clips, embeds }, o.textMax);
    fs.writeFileSync(path.join(o.dir, 'pagina.md'), md, 'utf8');
    fs.writeFileSync(path.join(o.dir, 'pagina.json'), JSON.stringify({ url: o.url, finalUrl: info.url, title: info.title, seconds: plan.seconds, marks: plan.marks, shots, clips, at: new Date().toISOString() }, null, 1));
    o.log?.(`captura pronta: ${pre}/pagina.mp4 (${plan.seconds} s) + ${shots.length} print(s) + ${pre}/pagina.md`);
    return { url: info.url, title: info.title, video, md: path.join(o.dir, 'pagina.md'), shots, seconds: plan.seconds, clips };
  } finally {
    o.signal?.removeEventListener('abort', abort);
    abort();
  }
}

/**
 * Skill com `linkCapture`: se a ideia tem um link, captura a página (uma vez por link) e registra os anexos web/ no
 * projeto (vídeo para as cenas, texto como fonte do roteiro, prints). Devolve true se o projeto mudou.
 */
export async function ensureLinkCapture(o: { project: Project; projectDir: string; ffmpeg: string; log?: (l: string) => void; signal?: AbortSignal }): Promise<boolean> {
  const p = o.project, urls = p.skill?.linkCapture ? findLinks(p.idea) : [];
  if (!urls.length) return false;
  /* um link: web/ (como sempre); vários: web/l1, web/l2… (cada um com a sua captura) + web/links.md com o índice */
  const multi = urls.length > 1, budget = linkBudget(urls.length);
  if (multi) o.log?.(`🌐 ${urls.length} links na ideia — capturando cada um (o vídeo explica todos, na ordem)`);
  const want: Attachment[] = [], index: Parameters<typeof linksDoc>[0] = [];
  for (const [i, url] of urls.entries()) {
    const rel = multi ? `web/l${i + 1}` : 'web', dir = path.join(userDir(o.projectDir), ...rel.split('/'));
    const tag = multi ? `LINK ${i + 1}/${urls.length}: ` : '';
    let meta: { url?: string; shots?: WebCapture['shots']; seconds?: number; title?: string; clips?: PageClip[] } = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'pagina.json'), 'utf8')); } catch { /* ainda não capturou */ }
    if (meta.url !== url || !fs.existsSync(path.join(dir, 'pagina.mp4'))) {
      try {
        const cap = await captureWebPage({ url, dir, ffmpeg: o.ffmpeg, aspect: p.aspect ?? '16:9', log: o.log, signal: o.signal, prefix: rel, maxSec: budget.maxSec, textMax: budget.textMax, clips: budget.clips, clipSec: budget.clipSec });
        meta = { url, shots: cap.shots, seconds: cap.seconds, title: cap.title, clips: cap.clips };
      } catch (e) {
        /* com vários links, um que falha não derruba os outros */
        if (!multi || o.signal?.aborted) throw e;
        o.log?.(`⚠ não foi possível capturar o link ${i + 1} (${url}): ${(e as Error).message.slice(0, 160)} — segue com os outros`);
        continue;
      }
    } else o.log?.(`🌐 captura do link${multi ? ` ${i + 1}` : ''} já existe (${rel}/pagina.mp4, ${meta.seconds ?? '?'} s) — reaproveitada`);
    index.push({ url, title: meta.title, dir: rel, seconds: meta.seconds });
    want.push(
      { file: `${rel}/pagina.mp4`, kind: 'video', use: 'scene', note: `${tag}Captura da página ${url} rolando de cima para baixo (${meta.seconds ?? '?'} s, sem som). Use TRECHOS dela nas cenas (clipStart = instante da seção em ${rel}/pagina.md).` },
      { file: `${rel}/pagina.md`, kind: 'text', use: 'reference', note: `${tag}Conteúdo do link ${url} (título, seções com os instantes na captura e texto) — FONTE do roteiro.` },
      ...(meta.shots ?? []).map((s): Attachment => ({ file: s.file, kind: 'image', use: 'scene', note: `${tag}Print da página: ${s.title}` })),
      ...(meta.clips ?? []).map((c): Attachment => ({ file: c.file, kind: 'video', use: 'scene', note: `${tag}Trecho de ${c.seconds} s de um vídeo da página (tocando, sem som${c.near ? `, perto de "${c.near}"` : ''}). Conteúdo de terceiros: use só em cena curta, numa moldura, comentando por cima.` })),
    );
  }
  if (multi && index.length) {
    fs.writeFileSync(path.join(userDir(o.projectDir), 'web', 'links.md'), linksDoc(index), 'utf8');
    want.unshift({ file: 'web/links.md', kind: 'text', use: 'reference', note: `Índice dos ${index.length} links a explicar, na ordem, com a pasta da captura de cada um — leia primeiro.` });
  }
  const list = (p.attachments ?? []).filter((a) => !a.file.startsWith('web/') || want.some((x) => x.file === a.file));
  let changed = list.length !== (p.attachments ?? []).length;
  for (const a of want) if (!list.some((x) => x.file === a.file)) { list.push(a); changed = true; }
  p.attachments = list;
  return changed;
}
