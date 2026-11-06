import { BrowserWindow, session } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Aspect, Attachment, Project } from '../shared/types';
import { frameEncoder } from './render';
import { resolution } from './ffmpeg';
import { userDir } from './attachments';
import { findLink, pageDoc, scrollPlan, type PageInfo } from './weblink';

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

export interface WebCapture { url: string; title: string; video: string; md: string; shots: Array<{ file: string; title: string }>; seconds: number }

/** Abre o link, lê, tira prints e grava a rolagem em `dir` (pagina.mp4, pagina.md, pagina.json, prints). */
export async function captureWebPage(o: { url: string; dir: string; ffmpeg: string; aspect: Aspect; maxSec?: number; fps?: number; log?: (l: string) => void; signal?: AbortSignal }): Promise<WebCapture> {
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
  const shot = async () => { await wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); return wc.capturePage({ x: 0, y: 0, width: w, height: h }); };
  try {
    o.log?.(`🌐 abrindo o link no navegador invisível: ${o.url}`);
    await Promise.race([wc.loadURL(o.url).catch((e: Error) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }), sleep(45_000)]);
    wc.setZoomFactor(zoom);
    await sleep(2500);
    await wc.insertCSS(CLEAN_CSS);
    /* desce a página uma vez para carregar imagens "lazy" e volta ao topo */
    await wc.executeJavaScript(`(async () => { const se = document.scrollingElement || document.documentElement; for (let i = 0; i < 40 && scrollY + innerHeight < se.scrollHeight - 4; i++) { scrollBy(0, innerHeight * 0.9); await new Promise((r) => setTimeout(r, 140)); } scrollTo(0, 0); })()`);
    await sleep(900);
    const raw = await wc.executeJavaScript(READ_PAGE) as Omit<PageInfo, 'url'>;
    const info: PageInfo = { ...raw, url: wc.getURL() || o.url };
    o.log?.(`página lida: "${info.title}" — ${info.sections.length} seção(ões), ${info.text.length} caracteres, altura ${Math.round(info.maxY + info.viewH)} px`);
    /* prints: topo + até 6 seções */
    const shots: WebCapture['shots'] = [];
    const save = async (y: number, file: string, title: string) => {
      await wc.executeJavaScript(`scrollTo({ top: ${Math.max(0, Math.round(y))}, behavior: 'instant' })`); await sleep(250);
      fs.writeFileSync(path.join(o.dir, file), (await shot()).toPNG()); shots.push({ file: `web/${file}`, title });
    };
    await save(0, 'pagina-topo.png', `topo da página — ${info.title}`);
    for (const [i, s] of info.sections.filter((x) => x.y > info.viewH * 0.5).slice(0, 6).entries()) await save(s.y - info.viewH * 0.12, `secao-${i + 1}.png`, s.title);
    /* vídeo: rolagem com paradas nas seções */
    const plan = scrollPlan({ maxY: info.maxY, viewH: info.viewH, sections: info.sections, fps, maxSec: o.maxSec ?? 40 });
    o.log?.(`gravando a página rolando: ${plan.seconds} s, ${plan.marks.length} parada(s) nas seções…`);
    const video = path.join(o.dir, 'pagina.mp4');
    const enc = frameEncoder(o.ffmpeg, { fps, w, h, out: video, crf: 18, lanczos: true });
    try {
      let last = -1;
      for (const y of plan.ys) {
        if (o.signal?.aborted) throw new Error('cancelado');
        if (y !== last) { await wc.executeJavaScript(`scrollTo({ top: ${y}, behavior: 'instant' })`); last = y; }
        await enc.frame(await shot());
      }
      await enc.end();
    } catch (e) { enc.kill(); throw e; }
    const md = pageDoc(info, plan, { video: 'web/pagina.mp4', shots });
    fs.writeFileSync(path.join(o.dir, 'pagina.md'), md, 'utf8');
    fs.writeFileSync(path.join(o.dir, 'pagina.json'), JSON.stringify({ url: o.url, finalUrl: info.url, title: info.title, seconds: plan.seconds, marks: plan.marks, shots, at: new Date().toISOString() }, null, 1));
    o.log?.(`captura pronta: web/pagina.mp4 (${plan.seconds} s) + ${shots.length} print(s) + web/pagina.md`);
    return { url: info.url, title: info.title, video, md: path.join(o.dir, 'pagina.md'), shots, seconds: plan.seconds };
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
  const p = o.project, url = p.skill?.linkCapture ? findLink(p.idea) : undefined;
  if (!url) return false;
  const dir = path.join(userDir(o.projectDir), 'web');
  let meta: { url?: string; shots?: WebCapture['shots']; seconds?: number; title?: string } = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'pagina.json'), 'utf8')); } catch { /* ainda não capturou */ }
  if (meta.url !== url || !fs.existsSync(path.join(dir, 'pagina.mp4'))) {
    const cap = await captureWebPage({ url, dir, ffmpeg: o.ffmpeg, aspect: p.aspect ?? '16:9', log: o.log, signal: o.signal });
    meta = { url, shots: cap.shots, seconds: cap.seconds, title: cap.title };
  } else o.log?.(`🌐 captura do link já existe (web/pagina.mp4, ${meta.seconds ?? '?'} s) — reaproveitada`);
  const want: Attachment[] = [
    { file: 'web/pagina.mp4', kind: 'video', use: 'scene', note: `Captura da página ${url} rolando de cima para baixo (${meta.seconds ?? '?'} s, sem som). Use TRECHOS dela nas cenas (clipStart = instante da seção em web/pagina.md).` },
    { file: 'web/pagina.md', kind: 'text', use: 'reference', note: `Conteúdo do link ${url} (título, seções com os instantes na captura e texto) — FONTE do roteiro.` },
    ...(meta.shots ?? []).map((s): Attachment => ({ file: s.file, kind: 'image', use: 'scene', note: `Print da página: ${s.title}` })),
  ];
  const list = (p.attachments ?? []).filter((a) => !a.file.startsWith('web/') || want.some((x) => x.file === a.file));
  let changed = list.length !== (p.attachments ?? []).length;
  for (const a of want) if (!list.some((x) => x.file === a.file)) { list.push(a); changed = true; }
  p.attachments = list;
  return changed;
}
