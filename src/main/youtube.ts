import { httpFetch } from './http';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Settings } from '../shared/types';
import type { StockHit } from './stock';
import { resolveBin } from './ffmpeg';
import { judgeFrame } from './vision';

const UA = 'FilmForge/1.x (video production tool)';

/** Opções do YouTube como banco de mídia (Configurações → Bancos de mídia → YouTube). */
export const ytCfg = (s: Settings) => (s.stock?.youtube ?? {}) as NonNullable<Settings['stock']>['youtube'] & { crop?: { top?: number; bottom?: number }; visionCheck?: boolean };
/** Trecho capturado: 2 a 4 s (padrão 3 s). */
export const ytClipSeconds = (s: Settings, wanted?: number) => Math.min(4, Math.max(2, ytCfg(s)?.clipSeconds ?? wanted ?? 3));

/** Caminho do yt-dlp configurado ou <workspace>/tools/yt-dlp[.exe]. */
export function ytDlpPath(s: Settings): string {
  const custom = (s.stock?.youtube as { ytDlp?: string } | undefined)?.ytDlp;
  if (custom?.trim()) return custom.trim();
  return path.join(s.workspace, 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

function run(exe: string, args: string[], signal?: AbortSignal): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 10 * 60_000);
    const abort = () => { try { child.kill('SIGKILL'); } catch { /* ignore */ } };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-8000); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}\n${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({ code, out, err }); });
  });
}

/** Baixa o yt-dlp.exe na primeira utilização (GitHub releases). */
export async function ensureYtDlp(s: Settings, log?: (l: string) => void): Promise<string> {
  const exe = ytDlpPath(s);
  if (fs.existsSync(exe)) return exe;
  if (process.platform !== 'win32') {
    // Linux/macOS: tenta o do PATH; se não existir, baixa o binário oficial.
    const which = await run('yt-dlp', ['--version']).catch(() => null);
    if (which?.code === 0) return 'yt-dlp';
  }
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  const url = process.platform === 'win32'
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  log?.(`baixando yt-dlp… (${url})`);
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`não foi possível baixar o yt-dlp (HTTP ${r.status}). Instale manualmente e aponte o caminho em Configurações → Bancos de mídia → YouTube.`);
  fs.writeFileSync(exe, Buffer.from(await r.arrayBuffer()));
  if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
  log?.(`yt-dlp pronto: ${exe}`);
  return exe;
}

interface YtEntry {
  id?: string; title?: string; description?: string; duration?: number | null; live_status?: string | null;
  channel?: string; uploader?: string; webpage_url?: string; url?: string; license?: string | null;
  view_count?: number | null; thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
}

function toHit(e: YtEntry): StockHit | undefined {
  const url = e.webpage_url ?? (e.id ? `https://www.youtube.com/watch?v=${e.id}` : undefined);
  if (!url) return undefined;
  const thumb = [...(e.thumbnails ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
  const w = 1280, h = 720;
  return {
    source: 'youtube', kind: 'video', url, thumb, width: w, height: h,
    author: e.channel ?? e.uploader, license: e.license?.trim() || 'YouTube — confira a licença e o uso permitido',
    page: url, title: e.title,
  };
}

/**
 * Busca vídeos no YouTube (scraping via yt-dlp) e devolve os que têm duração
 * suficiente. A consulta deve vir da narração/cena (searchTerms), então o vídeo
 * escolhido tem relação com o áudio.
 */
export async function searchYouTube(
  s: Settings, query: string, limit: number, o: { minSeconds?: number; signal?: AbortSignal; log?: (l: string) => void } = {},
): Promise<StockHit[]> {
  const exe = await ensureYtDlp(s, o.log);
  const n = Math.max(3, Math.min(15, limit * 2));
  const cfg = ytCfg(s);
  /* só Creative Commons: o filtro de licença da própria busca do YouTube (sp=EgIwAQ%3D%3D) */
  const target = cfg.ccOnly ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIwAQ%253D%253D` : `ytsearch${n}:${query}`;
  const args = [target, '--dump-json', '--flat-playlist', '--no-warnings', '--skip-download', '--no-write-subs', ...(cfg.ccOnly ? ['--playlist-end', String(n)] : [])];
  const r = await run(exe, args, o.signal);
  if (r.code !== 0) throw new Error(`yt-dlp busca falhou: ${(r.err || r.out).split('\n').slice(-2).join(' ').slice(0, 300)}`);
  const min = o.minSeconds ?? 6;
  const entries: YtEntry[] = [];
  for (const line of r.out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { entries.push(JSON.parse(t) as YtEntry); } catch { /* linha inválida */ }
  }
  const usable = entries.filter((e) => e.id && e.duration && e.duration >= min && e.live_status !== 'is_live' && e.live_status !== 'is_upcoming')
    /* sem legendas / marcas d'água: evita títulos de vídeos com legenda embutida, lyric, react, compilação com logo */
    .filter((e) => !(cfg.noSubtitles && /legendad|subtitled|lyrics?|letra|karaok|caption/i.test(e.title ?? '')) && !(cfg.noWatermark && /react|compila|tiktok|reels|meme|watermark|marca d.?água/i.test(e.title ?? '')))
    /* sem transições: prefere planos contínuos (b-roll, timelapse, drone) e evita edições rápidas */
    .filter((e) => !(cfg.noTransitions && /montage|montagem|trailer|edit\b|highlights|melhores momentos|amv|recap/i.test(e.title ?? '')));
  /* Ranking de qualidade: prefere 4K/HD, stock footage/cinemático, clipes curtos e
     com audiência; penaliza "ambience/10 hours/sleep/relax" (visual parado e sem foco). */
  const score = (e: YtEntry) => {
    const t = (e.title ?? '').toLowerCase();
    let s = 0;
    if (/4k|uhd|2160/.test(t)) s += 3; else if (/1080|full hd|\bhd\b/.test(t)) s += 1;
    if (/cinematic|stock footage|no copyright|royalty.free|free footage|footage/.test(t)) s += 2;
    if (/ambience|relax|sleep|study|10 hours|1 hour|loop|storm|hurricane/.test(t)) s -= 3;
    if ((e.view_count ?? 0) > 100_000) s += 1;
    if (/creative commons/i.test(e.license ?? '')) s += 2;
    if (cfg.noTransitions && /drone|aerial|timelapse|time-lapse|one take|single shot|b-?roll|plano/.test(t)) s += 2;
    const d = e.duration ?? 0;
    if (d >= 8 && d <= 600) s += 2; else if (d > 3600) s -= 2;
    return s;
  };
  usable.sort((a, b) => score(b) - score(a) || (b.view_count ?? 0) - (a.view_count ?? 0));
  const hits = usable.map(toHit).filter((x): x is StockHit => !!x);
  o.log?.(`YouTube: ${hits.length} vídeo(s) para "${query}"`);
  return hits.slice(0, limit);
}

/** Instantes (s) de corte de cena no arquivo (filtro scdet do ffmpeg). */
export async function sceneCuts(ffmpeg: string, file: string, signal?: AbortSignal): Promise<number[]> {
  /* "ffmpeg" sem caminho: usa o mesmo que o resto do app (cópia embutida, WinGet, PATH…) */
  const r = await run(resolveBin(ffmpeg), ['-hide_banner', '-i', file, '-vf', 'scale=320:-2,scdet=threshold=12', '-an', '-f', 'null', '-'], signal);
  return [...(r.err + r.out).matchAll(/lavfi\.scd\.time:\s*([\d.]+)/g)].map((m) => Number(m[1])).filter((x) => Number.isFinite(x));
}
/** Começo de uma janela de `len` s sem cortes dentro de [0, total] (com 0,2 s de folga), ou undefined. */
export function cleanWindow(cuts: number[], len: number, total: number): number | undefined {
  const pts = [0, ...cuts.filter((c) => c > 0.05 && c < total - 0.05).sort((a, b) => a - b), total];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]! + (i ? 0.2 : 0), b = pts[i + 1]! - (i + 1 < pts.length - 1 ? 0.2 : 0);
    if (b - a >= len) return Math.round(a * 100) / 100;
  }
  return undefined;
}

/**
 * Baixa só o trecho necessário, sem arquivos de legenda, e recorta as bordas
 * (marcas d'água/créditos costumam ficar nas bordas; legendas queimadas no rodapé).
 * O corte é conservador (4% nas laterais/topo e 12% no rodapé) e configurável.
 */
export async function downloadYouTubeClip(
  s: Settings, hit: StockHit, dest: string, o: { seconds: number; start?: number; width?: number; height?: number; context?: string; signal?: AbortSignal; log?: (l: string) => void },
): Promise<{ start: number; seconds: number }> {
  const exe = await ensureYtDlp(s, o.log);
  const ffmpeg = resolveBin(s.ffmpeg || 'ffmpeg');
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  const cfg = ytCfg(s) ?? {};
  const seconds = ytClipSeconds(s, o.seconds);
  const start = Math.max(0, Math.round(o.start ?? 3));
  /* sem transições: baixa uma janela maior e escolhe um trecho sem corte de cena */
  const extra = cfg.noTransitions ? 6 : 1;
  const template = path.join(dir, `.yt-${Date.now()}-%(id)s.%(ext)s`);
  const ffmpegDir = path.dirname(ffmpeg);
  const args = [
    '-f', 'bv*[height<=720][ext=mp4]/bv*[height<=720]/b[height<=720]',
    '--no-playlist', '--no-write-subs', '--no-write-auto-subs', '--no-warnings',
    '--ffmpeg-location', ffmpegDir,
    '--download-sections', `*${start}-${start + seconds + extra}`,
    '-o', template, '--', hit.url,
  ];
  o.log?.(`YouTube: baixando ${seconds.toFixed(1)}s de "${(hit.title ?? hit.url).slice(0, 70)}"…`);
  const r = await run(exe, args, o.signal);
  if (r.code !== 0) throw new Error(`yt-dlp download falhou: ${(r.err || r.out).split('\n').slice(-2).join(' ').slice(0, 300)}`);
  const downloaded = fs.readdirSync(dir).filter((f) => f.startsWith('.yt-')).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (!downloaded) throw new Error('yt-dlp não produziu arquivo');
  const crop = cfg.crop;
  /* sem legendas: corta a faixa do rodapé (12%); sem marcas d'água: corta 7% das bordas (logos ficam nos cantos) */
  const subs = cfg.noSubtitles !== false;
  const wm = cfg.noWatermark !== false;
  const top = Math.min(0.2, Math.max(0, crop?.top ?? (wm ? 0.07 : 0.02)));
  const bottom = Math.min(0.3, Math.max(0, crop?.bottom ?? (subs ? 0.12 : wm ? 0.07 : 0)));
  const side = wm ? 0.07 : 0;
  /* início do trecho: com "sem transições", a maior janela sem corte de cena */
  let offset = 0;
  if (cfg.noTransitions) {
    const cuts = await sceneCuts(ffmpeg, downloaded, o.signal);
    const win = cleanWindow(cuts, seconds, seconds + extra);
    if (win === undefined) { fs.rmSync(downloaded, { force: true }); throw new Error(`trecho com transições/cortes (${cuts.length} corte(s)) — tentando outro vídeo`); }
    offset = win;
    if (cuts.length) o.log?.(`YouTube: ${cuts.length} corte(s) de cena; usando ${offset.toFixed(1)}–${(offset + seconds).toFixed(1)} s (contínuo)`);
  }
  const w = Math.max(320, Math.round(o.width ?? 1280));
  const h = Math.max(320, Math.round(o.height ?? 720));
  /* corta a faixa de legendas/rodapé e depois faz "cover" na resolução do projeto
     (sem barras pretas); o cover também remove sobras nas laterais. */
  const vf = `crop=iw*${(1 - 2 * side).toFixed(3)}:ih*${(1 - top - bottom).toFixed(3)}:iw*${side.toFixed(3)}:ih*${top.toFixed(3)},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  const tmp = dest + '.raw.mp4';
  const ffr = await run(ffmpeg, ['-y', '-ss', offset.toFixed(2), '-i', downloaded, '-t', seconds.toFixed(2), '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp], o.signal);
  fs.rmSync(downloaded, { force: true });
  if (ffr.code !== 0) { fs.rmSync(tmp, { force: true }); throw new Error(`ffmpeg falhou no recorte: ${(ffr.err || '').slice(-300)}`); }
  fs.copyFileSync(tmp, dest);
  fs.rmSync(tmp, { force: true });
  o.log?.(`YouTube: trecho salvo (${seconds.toFixed(1)}s, sem legendas/áudio original)`);

  /* "ver a cena": modelo de visão local confere se o frame combina com a narração
     e se tem legenda/marca d'água; se não, rejeita e o próximo resultado é tentado. */
  const visionOn = cfg.visionCheck !== false;
  if (o.context && visionOn) {
    const frame = dest + '.vision.jpg';
    const fr = await run(ffmpeg, ['-y', '-ss', '0.7', '-i', dest, '-frames:v', '1', '-vf', 'scale=640:-2', frame], o.signal);
    if (fr.code === 0 && fs.existsSync(frame) && fs.statSync(frame).size > 1000) {
      const ol = s.harnesses?.ollama?.command?.trim();
      const v = await judgeFrame(frame, o.context, o.log, ol && /^https?:\/\//i.test(ol) ? ol : undefined);
      fs.rmSync(frame, { force: true });
      if (v) {
        /* texto na imagem só reprova quando o usuário pediu sem legendas/marcas d'água */
        const ok = v.match >= 5 && !(v.hasText && (subs || wm));
        o.log?.(`YouTube: visão ${v.match}/10${v.hasText ? ' + texto/marca' : ''} → ${ok ? 'aceito' : 'rejeitado'}`);
        if (!ok) {
          fs.rmSync(dest, { force: true });
          throw new Error(`rejeitado pela visão (match ${v.match}/10${v.hasText ? ', texto/marca d’água' : ''})`);
        }
      }
    } else {
      o.log?.('visão: frame inválido - checagem ignorada');
      fs.rmSync(frame, { force: true });
    }
  }
  /* início efetivo (com a janela escolhida em "sem transições"), para o próximo
     trecho continuar exatamente daqui em vez de repetir o mesmo pedaço. */
  return { start: start + offset, seconds };
}
