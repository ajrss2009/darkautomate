import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Aspect, FinalEffects, FxFilter, FxMove, FxSegment, FxTexture, FxTransition, FxVignette, Scene, SceneEffects, SubtitleKind, SubtitleStyle, Watermark } from '../shared/types';
import { subtitleFontName } from '../shared/subtitle-fonts';

/** ffmpeg/ffprobe fora do PATH: procura nas pastas comuns antes de desistir. */
const BIN_CACHE = new Map<string, string>();
const isWin = process.platform === 'win32';
const exeName = (name: string) => (isWin ? `${name}.exe` : name);

/** Procura o executável nas pastas do PATH (sem depender de `where`). */
function fromPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, exeName(name));
    try { if (fs.existsSync(file)) return file; } catch { /* entrada inválida no PATH */ }
  }
  return undefined;
}

/** Pastas comuns (instalação, WinGet, pasta do app e Downloads/Documentos com ffmpeg extraído). */
function candidateDirs(): string[] {
  const home = os.homedir();
  const env = process.env;
  const dirs: string[] = [
    path.dirname(process.execPath),
    String((process as unknown as { resourcesPath?: string }).resourcesPath ?? ''),
    path.join(env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links'),
    path.join(env.ProgramFiles ?? '', 'ffmpeg', 'bin'),
    path.join(env['ProgramFiles(x86)'] ?? '', 'ffmpeg', 'bin'),
    path.join(home, 'ffmpeg', 'bin'),
  ];
  /* ffmpeg baixado e extraído (ex.: Downloads\ffmpeg-7.1-full_build\bin) */
  for (const base of [path.join(home, 'Downloads'), path.join(home, 'Documents'), home]) {
    try {
      for (const d of fs.readdirSync(base, { withFileTypes: true })) {
        if (!d.isDirectory() || !/ffmpeg|ffprobe/i.test(d.name)) continue;
        dirs.push(path.join(base, d.name, 'bin'), path.join(base, d.name));
      }
    } catch { /* pasta ausente */ }
  }
  return dirs.filter(Boolean);
}

/** Pastas do próprio app: ffmpeg embutido (ao lado do .exe ou em resources/tools/ffmpeg). */
function appDirs(): string[] {
  const exeDir = path.dirname(process.execPath);
  const res = String((process as unknown as { resourcesPath?: string }).resourcesPath ?? '');
  return [
    path.join(exeDir, 'ffmpeg'),          /* win-unpacked\ffmpeg\ffmpeg.exe (ao lado do FilmForge.exe) */
    path.join(exeDir, 'bin'),
    res ? path.join(res, 'tools', 'ffmpeg', 'win') : '', /* empacotado: resources\tools\ffmpeg\win */
    res ? path.join(res, 'ffmpeg') : '',
    /* rodando da pasta do código (electron . / --run-project): tools\ffmpeg\win do projeto */
    path.join(__dirname, '..', '..', 'tools', 'ffmpeg', 'win'),
    path.join(process.cwd(), 'tools', 'ffmpeg', 'win'),
  ].filter(Boolean);
}

const firstIn = (dirs: string[], name: string): string | undefined =>
  dirs.map((d) => path.join(d, exeName(name))).find((f) => { try { return fs.existsSync(f); } catch { return false; } });

/** ffmpeg/ffprobe encontrados agora (para o botão "Detectar" das configurações). */
export function detectBins(): { ffmpeg?: string; ffprobe?: string } {
  /* a cópia do próprio app ganha do PATH: funciona mesmo com outra versão instalada/bloqueada */
  const find = (name: string) => firstIn(appDirs(), name) ?? fromPath(name) ?? firstIn(candidateDirs(), name);
  return { ffmpeg: find('ffmpeg'), ffprobe: find('ffprobe') };
}

export function resolveBin(bin: string): string {
  const raw = (bin ?? '').trim() || 'ffmpeg';
  const name = path.basename(raw).toLowerCase().replace(/\.exe$/i, '');
  const explicit = raw !== name && raw !== `${name}.exe`;
  /* caminho configurado: usa se existir; se sumiu, procura de novo em vez de falhar */
  if (explicit && fs.existsSync(raw)) return raw;
  const cached = BIN_CACHE.get(name);
  if (cached && fs.existsSync(cached)) return cached;
  /* 1º a cópia do próprio app (funciona mesmo sem ffmpeg instalado / com o PATH bloqueado) */
  const found = firstIn(appDirs(), name) ?? fromPath(name) ?? firstIn(candidateDirs(), name);
  const out = found ?? raw;
  BIN_CACHE.set(name, out);
  return out;
}

/** Testa se ffmpeg/ffprobe executam de verdade (pega bloqueio de antivírus, DLL faltando…). */
export async function probeBins(): Promise<{ ok: boolean; message: string }> {
  const found = detectBins();
  const lines: string[] = [];
  let ok = true;
  for (const name of ['ffmpeg', 'ffprobe'] as const) {
    const exe = found[name];
    if (!exe) { ok = false; lines.push(`${name}: não encontrado`); continue; }
    try {
      const { stdout } = await run(exe, ['-version']);
      lines.push(`${name}: ${(stdout.split('\n')[0] ?? '').trim() || 'ok'}`);
    } catch (e) {
      ok = false;
      const msg = (e as Error).message;
      lines.push(`${name}: falhou — ${msg.slice(0, 180)}${/EPERM|EACCES|spawn|bloquead|denied|negad/i.test(msg) ? ' (antivírus bloqueando o executável?)' : ''}`);
    }
  }
  return { ok, message: `${lines.join(' · ')}${found.ffmpeg ? ` — ${found.ffmpeg}` : ''}` };
}

export function run(bin: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  const exe = resolveBin(bin);
  return new Promise((resolve, reject) => {
    const c = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    c.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); });
    const onAbort = () => { c.kill('SIGKILL'); reject(new Error('abortado')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    c.on('error', (e) => reject(new Error(`falha ao executar ${bin}: ${e.message}`)));
    c.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${bin} saiu com código ${code}: ${stderr.slice(-600)}`));
    });
  });
}

/** Quantos quadros realmente mudam no vídeo (mpdecimate descarta os repetidos); poucos = animação parada. */
export async function distinctFrames(bin: string, file: string, signal?: AbortSignal): Promise<number> {
  const { stdout } = await run(bin, ['-v', 'error', '-i', file, '-vf', 'scale=320:-2,mpdecimate', '-fps_mode', 'vfr', '-an', '-f', 'framemd5', '-'], signal);
  return stdout.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
}

export const resolution = (a: Aspect): { w: number; h: number } =>
  ({ '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 }, '1:1': { w: 1080, h: 1080 }, '4:5': { w: 1080, h: 1350 } }[a]);

export async function duration(ffprobe: string, file: string): Promise<number> {
  try {
    const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch { return 0; }
}

export async function silenceTrim(ffmpeg: string, input: string, output: string, signal?: AbortSignal) {
  await run(ffmpeg, ['-y', '-i', input, '-af',
    'silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.35:stop_threshold=-45dB',
    output], signal);
}

/** Volume padrão dos efeitos sonoros sob a narração (15%). */
/** Volume padrão dos efeitos sonoros (5%: o desenho de som fica sob a voz, não por cima). */
export const SFX_DEFAULT_VOLUME = 0.05;
export interface SegmentInput { visual?: string; audio?: string; seconds: number; effects?: SceneEffects; loop?: boolean; sfx?: string; sfxVolume?: number; /** segundos pulados no começo do visual (vídeo), da narração e dos efeitos (corte do editor) */ trimStart?: number; /** volume da narração (1 = 100%) */ narrationVolume?: number; /** duração em quadros (manda no corte; default: `seconds × fps`) */ frames?: number; /** fps do projeto (default 30) */ fps?: number; /** silencia o áudio desta cena (legenda continua) */ muted?: boolean; /** espelha a imagem (hflip) */ mirror?: boolean }

/** Filtros de vídeo dos efeitos da cena (Ken Burns, cor, desfoque, fade). */
/** Filtros de cor (cena e vídeo final). */
export function colorFilter(filter?: FxFilter): string[] {
  switch (filter) {
    case 'bw': return ['hue=s=0'];
    case 'sepia': return ['colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'];
    case 'vivid': return ['eq=saturation=1.45:contrast=1.06'];
    case 'warm': return ['colorbalance=rs=.08:gs=.02:bs=-.08'];
    case 'cool': return ['colorbalance=rs=-.06:bs=.1'];
    case 'blur': return ['boxblur=4:1'];
    case 'cinematic': return ['eq=contrast=1.1:saturation=0.9', 'colorbalance=rs=-.04:bs=.05:rh=.05:bh=-.04'];
    case 'teal_orange': return ['colorbalance=rs=-.1:gs=-.02:bs=.12:rh=.12:gh=.03:bh=-.1', 'eq=saturation=1.1'];
    case 'vintage': return ['curves=preset=vintage'];
    case 'noir': return ['hue=s=0', 'eq=contrast=1.35:brightness=-0.03'];
    case 'matte': return ["curves=all='0/0.08 1/0.94'", 'eq=saturation=0.85'];
    case 'dramatic': return ['eq=contrast=1.25:saturation=1.15:gamma=0.95'];
    default: return [];
  }
}
export const vignetteFilter = (v?: FxVignette): string[] => v === 'soft' ? ['vignette=angle=PI/5'] : v === 'strong' ? ['vignette=angle=PI/3.2'] : [];

/** Trechos de filtro/vinheta da timeline: cada filtro só vale no seu intervalo (opção `enable` do ffmpeg). */
export function segmentFilters(segs: FxSegment[] | undefined, total: number): string[] {
  const out: string[] = [];
  for (const s of [...(segs ?? [])].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))) {   // camadas de baixo para cima
    const end = s.toEnd ? Math.max(total, s.start) + 1 : s.end;
    const en = s.toEnd ? `enable='gte(t\\,${s.start.toFixed(2)})'` : `enable='between(t\\,${s.start.toFixed(2)}\\,${end.toFixed(2)})'`;
    for (const f of s.kind === 'filter' ? colorFilter(s.value as FxFilter) : vignetteFilter(s.value as FxVignette)) out.push(`${f}:${en}`);
  }
  return out;
}

/** Acabamento do vídeo final inteiro: cor, vinheta, grão de filme e faixas de cinema. */
export function finalFilters(e: FinalEffects | undefined): string[] {
  if (!e) return [];
  const f = [...colorFilter(e.filter), ...vignetteFilter(e.vignette)];
  if (e.grain) f.push('noise=alls=9:allf=t');
  if (e.letterbox) f.push('drawbox=x=0:y=0:w=iw:h=ih*0.1:color=black:t=fill', 'drawbox=x=0:y=ih*0.9:w=iw:h=ih*0.1:color=black:t=fill');
  return f;
}

/* ── texturas (chuviscado, VHS, poeira…) e marca d'água ── */

export const FX_TEXTURES: Array<{ id: FxTexture; label: string }> = [
  { id: 'static', label: 'Chuviscado (TV)' }, { id: 'vhs', label: 'VHS' }, { id: 'dust', label: 'Poeira + cintilação' }, { id: 'old_film', label: 'Filme antigo' },
  { id: 'crt', label: 'Tela CRT (linhas)' }, { id: 'glitch', label: 'Glitch' }, { id: 'paper', label: 'Papel / granulado' },
];
/** Filtros ffmpeg de cada textura (só filtros de cadeia simples: entram no -vf do segmento). Função pura. */
export function textureFilters(t: FxTexture | undefined): string[] {
  switch (t) {
    case 'static': return ['noise=alls=38:allf=t+u', 'eq=saturation=0.75:contrast=1.1'];
    case 'vhs': return ['rgbashift=rh=-4:bh=4', 'gblur=sigma=0.8', 'eq=saturation=1.35:contrast=1.06', 'noise=alls=10:allf=t', 'drawgrid=w=iw:h=4:t=1:color=black@0.22'];
    case 'dust': return ['noise=c0s=22:c0f=t+u', "eq=brightness='0.025*sin(37*t)':contrast=1.08:eval=frame", 'vignette=PI/5'];
    case 'old_film': return ['colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131', 'noise=alls=20:allf=t+u', "eq=brightness='0.035*sin(29*t)':eval=frame", 'vignette=PI/4'];
    case 'crt': return ['drawgrid=w=iw:h=3:t=1:color=black@0.35', 'gblur=sigma=0.5', 'eq=contrast=1.12:saturation=1.15', 'vignette=PI/4.5'];
    case 'glitch': return ['rgbashift=rh=3:bh=-3', "rgbashift=rh=16:gv=-5:bh=-12:enable='lt(mod(t\\,1.3)\\,0.12)'", 'noise=alls=12:allf=t', 'eq=contrast=1.12'];
    case 'paper': return ['noise=alls=12:allf=u', 'eq=saturation=0.85:brightness=0.03', 'colorbalance=rs=.05:gs=.03:bs=-.05'];
    default: return [];
  }
}

/** Posição da marca d'água (expressões do drawtext/overlay: W/H = vídeo, w/h = marca). Margem de 3% da altura. */
export function watermarkXY(pos: Watermark['position'], v: { W: string; H: string; w: string; h: string } = { W: 'W', H: 'H', w: 'w', h: 'h' }): { x: string; y: string } {
  const m = `${v.H}*0.03`;
  switch (pos) {
    case 'tl': return { x: m, y: m };
    case 'tr': return { x: `${v.W}-${v.w}-${m}`, y: m };
    case 'bl': return { x: m, y: `${v.H}-${v.h}-${m}` };
    case 'center': return { x: `(${v.W}-${v.w})/2`, y: `(${v.H}-${v.h})/2` };
    default: return { x: `${v.W}-${v.w}-${m}`, y: `${v.H}-${v.h}-${m}` };
  }
}
/** Fonte do drawtext (Windows tem Arial Bold; outros sistemas usam a padrão do fontconfig). */
const wmFont = () => { const f = 'C:/Windows/Fonts/arialbd.ttf'; return process.platform === 'win32' && fs.existsSync(f) ? `fontfile='${filterPath(f)}':` : ''; };
/** Grafo da marca d'água (texto e/ou imagem). Entrada [0:v] (e [1:v] = imagem); saída [wm]. Função pura (menos a fonte). */
export function watermarkGraph(wm: Watermark, textFile: string | undefined, videoW: number): string | undefined {
  const op = Math.max(0.05, Math.min(1, wm.opacity || 0.6)).toFixed(2), size = Math.max(1, Math.min(60, wm.size || 6));
  const parts: string[] = [];
  let cur = '0:v';
  if (wm.image) {
    /* imagem: largura = size% da largura do vídeo (em pixels: funciona em qualquer versão do ffmpeg), opacidade no canal alfa */
    const p = watermarkXY(wm.position, { W: 'main_w', H: 'main_h', w: 'overlay_w', h: 'overlay_h' });
    parts.push(`[1:v]format=rgba,colorchannelmixer=aa=${op}[wmi]`, `[wmi]scale=${Math.max(8, Math.round(videoW * size / 100 / 2) * 2)}:-2[wms]`, `[${cur}][wms]overlay=x=${p.x}:y=${p.y}:shortest=1[wimg]`);
    cur = 'wimg';
  }
  if (textFile) {
    /* texto: altura da fonte = size% da altura do vídeo; contorno escuro para ler em qualquer fundo */
    const p = watermarkXY(wm.position, { W: 'w', H: 'h', w: 'tw', h: 'th' });
    parts.push(`[${cur}]drawtext=${wmFont()}textfile='${filterPath(textFile)}':expansion=none:fontsize=h*${(size / 100).toFixed(3)}:fontcolor=white@${op}:borderw=2:bordercolor=black@${(Number(op) * 0.6).toFixed(2)}:x=${p.x}:y=${p.y}[wtxt]`);
    cur = 'wtxt';
  }
  if (!parts.length) return undefined;
  parts.push(`[${cur}]format=yuv420p[wm]`);
  return parts.join(';');
}
/** Grava a marca d'água no vídeo (texto via arquivo — sem problemas de escape —, imagem com opacidade). */
export async function applyWatermark(ffmpeg: string, video: string, wm: Watermark, out: string, videoW: number, signal?: AbortSignal): Promise<boolean> {
  if (!wm.enabled) return false;
  const img = wm.image && fs.existsSync(wm.image) ? wm.image : undefined;
  const text = wm.text?.trim();
  const tf = text ? out + '.wm.txt' : undefined;
  if (tf) fs.writeFileSync(tf, text!);
  const g = watermarkGraph({ ...wm, image: img }, tf, videoW);
  if (!g) return false;
  try {
    await run(ffmpeg, ['-y', '-i', video, ...(img ? ['-loop', '1', '-i', img] : []), '-filter_complex', g, '-map', '[wm]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', '-shortest', out], signal);
  } finally { if (tf) fs.rmSync(tf, { force: true }); }
  return true;
}

/**
 * Junta os segmentos com transições (xfade) SEM deslocar áudio e legendas: o vídeo
 * da cena com transição é estendido (último quadro congelado) pela duração da
 * transição, que acontece sobre o começo da próxima cena. O áudio é a concatenação
 * original dos segmentos — a duração total não muda.
 */
export async function concatWithTransitions(ffmpeg: string, segs: Array<{ file: string; seconds: number; transition?: FxTransition; transitionSec?: number }>, out: string, signal?: AbortSignal) {
  const tr = (i: number) => {
    const s = segs[i]!;
    if (i >= segs.length - 1 || !s.transition || s.transition === 'none') return 0;
    return Math.min(Math.max(0.2, s.transitionSec ?? 0.6), 2, segs[i + 1]!.seconds * 0.8);
  };
  if (!segs.some((_, i) => tr(i) > 0)) return concat(ffmpeg, segs.map((s) => s.file), out, signal);
  const audio = out.replace(/\.\w+$/, '.audio.m4a');
  const list = out + '.txt';
  fs.writeFileSync(list, segs.map((s) => `file '${s.file.replace(/'/g, "'\\''")}'`).join('\n'));
  await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vn', '-c:a', 'aac', '-b:a', '192k', audio], signal);
  fs.rmSync(list, { force: true });
  const parts: string[] = [];
  segs.forEach((_, i) => parts.push(`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS${tr(i) ? `,tpad=stop_mode=clone:stop_duration=${tr(i).toFixed(3)}` : ''}[v${i}]`));
  let cur = 'v0', acc = 0;
  for (let i = 1; i < segs.length; i++) {
    acc += segs[i - 1]!.seconds;
    const d = tr(i - 1);
    const next = `x${i}`;
    parts.push(d > 0
      ? `[${cur}][v${i}]xfade=transition=${segs[i - 1]!.transition}:duration=${d.toFixed(3)}:offset=${acc.toFixed(3)}[${next}]`
      : `[${cur}][v${i}]concat=n=2:v=1:a=0[${next}]`);
    cur = next;
  }
  const inputs = segs.flatMap((s) => ['-i', s.file]);
  await run(ffmpeg, ['-y', ...inputs, '-i', audio, '-filter_complex', parts.join(';'), '-map', `[${cur}]`, '-map', `${segs.length}:a`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', out], signal);
  fs.rmSync(audio, { force: true });
}

/**
 * Movimentos de câmera (zoompan): zoom in/out, panorâmicas (esquerda/direita/cima/baixo)
 * com zoom fixo de 18% e zoom com deslocamento lateral.
 */
export function moveExpr(m: FxMove | undefined, frames: number): { z: string; x: string; y: string } | undefined {
  const p = `on/${frames}`, cx = 'iw/2-(iw/zoom/2)', cy = 'ih/2-(ih/zoom/2)';
  switch (m) {
    case 'in': return { z: `1+0.15*${p}`, x: cx, y: cy };
    case 'out': return { z: `1.15-0.15*${p}`, x: cx, y: cy };
    case 'pan_left': return { z: '1.18', x: `(iw-iw/zoom)*(1-${p})`, y: cy };
    case 'pan_right': return { z: '1.18', x: `(iw-iw/zoom)*${p}`, y: cy };
    case 'pan_up': return { z: '1.18', x: cx, y: `(ih-ih/zoom)*(1-${p})` };
    case 'pan_down': return { z: '1.18', x: cx, y: `(ih-ih/zoom)*${p}` };
    case 'in_left': return { z: `1+0.18*${p}`, x: `(${cx})*(1-${p})`, y: cy };
    case 'in_right': return { z: `1+0.18*${p}`, x: `(${cx})+(${cx})*${p}`, y: cy };
    /* câmera na mão: zoom fixo pequeno + tremor suave (senos de frequências diferentes, sem aleatório = determinístico) */
    case 'shake': return { z: '1.08', x: `${cx}+iw*0.012*sin(on*0.9)+iw*0.006*sin(on*2.3)`, y: `${cy}+ih*0.012*cos(on*1.1)+ih*0.005*sin(on*2.9)` };
    /* pulso: zoom que "respira" uma vez por segundo (batida) */
    case 'pulse': return { z: '1.06+0.04*sin(2*PI*on/30)', x: cx, y: cy };
    /* deriva: zoom leve e deslocamento diagonal lento */
    case 'drift': return { z: `1.1+0.04*${p}`, x: `(iw-iw/zoom)*(0.2+0.6*${p})`, y: `(ih-ih/zoom)*(0.3+0.4*${p})` };
    default: return undefined;
  }
}

export function effectFilters(e: SceneEffects | undefined, seconds: number, w: number, h: number): string[] {
  const f: string[] = [];
  if (!e) return f;
  const frames = Math.max(1, Math.round(seconds * 30));
  const mv = moveExpr(e.zoom, frames);
  if (mv) f.push(`zoompan=z='${mv.z}':x='${mv.x}':y='${mv.y}':d=1:s=${w}x${h}:fps=30`);
  f.push(...colorFilter(e.filter), ...vignetteFilter(e.vignette), ...textureFilters(e.texture));
  if (e.fadeIn) f.push('fade=t=in:st=0:d=0.4');
  if (e.fadeOut && seconds > 0.8) f.push(`fade=t=out:st=${(seconds - 0.4).toFixed(2)}:d=0.4`);
  return f;
}
const audioFades = (e: SceneEffects | undefined, seconds: number): string[] => [
  ...(e?.fadeIn ? ['afade=t=in:st=0:d=0.3'] : []),
  ...(e?.fadeOut && seconds > 0.8 ? [`afade=t=out:st=${(seconds - 0.3).toFixed(2)}:d=0.3`] : []),
];

export async function makeSegment(ffmpeg: string, seg: SegmentInput, out: string, aspect: Aspect, signal?: AbortSignal) {
  const { w, h } = resolution(aspect);
  /* A DURAÇÃO VEM DOS QUADROS: `-t segundos` fechava no quadro seguinte e o erro de
     cada cena ia para a próxima na emenda. Aqui o arquivo tem exatamente N quadros e
     o áudio é preenchido/cortado para a mesma duração — sempre, não só com efeitos. */
  const fps = seg.fps && seg.fps > 0 ? seg.fps : 30;
  const frames = seg.frames && seg.frames > 0 ? Math.round(seg.frames) : Math.max(1, Math.round(seg.seconds * fps));
  const seconds = frames / fps, dur = seconds.toFixed(6);
  const vf = [`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`, ...effectFilters(seg.effects, seconds, w, h), ...(seg.mirror ? ['hflip'] : []), 'format=yuv420p'].join(',');
  const af = audioFades(seg.effects, seconds);
  /* mudo da cena: silencia só esta fala; o clipe e a legenda continuam */
  const mute = seg.muted ? ['volume=0'] : [];
  /* apad sempre: o stream de áudio tem que ter a mesma duração do de vídeo */
  const pad = ['apad', `atrim=duration=${dur}`, 'asetpts=PTS-STARTPTS'];
  const args: string[] = ['-y'];
  const isVideo = !!seg.visual && /\.(mp4|webm|mov|mkv|gif)$/i.test(seg.visual);
  const ss = seg.trimStart && seg.trimStart > 0 ? ['-ss', seg.trimStart.toFixed(3)] : [];
  if (!seg.visual) args.push('-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:r=${fps}`);
  else if (isVideo) {
    /* Quando a duração vem em QUADROS, repetir o clipe é o que garante o arquivo com
       exatamente N quadros: se o clipe termina antes (fps de origem ≠ 30, trim perto do
       fim), `-frames:v N` não inventa quadros e a cena sairia curta — o erro voltaria a
       somar na emenda. Se o clipe for mais longo, o corte em N quadros para antes de repetir. */
    if (seg.loop !== false || seg.frames !== undefined) args.push('-stream_loop', '-1');
    args.push(...ss, '-i', seg.visual);
  }
  else args.push('-loop', '1', '-framerate', String(fps), '-i', seg.visual);
  if (seg.audio) args.push(...ss, '-i', seg.audio); else args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  /* volume da narração (slider do editor) */
  const nv = Math.max(0, Math.min(2, seg.narrationVolume ?? 1)), nvf = Math.abs(nv - 1) > 0.005 ? `volume=${nv.toFixed(2)}` : '';
  /* efeitos sonoros da cena somados à narração (volume próprio, sem abaixar a voz) */
  const sfxVol = Math.max(0, Math.min(1.5, seg.sfxVolume ?? SFX_DEFAULT_VOLUME));
  const withSfx = !!seg.sfx && fs.existsSync(seg.sfx) && sfxVol > 0;
  if (withSfx) args.push(...ss, '-i', seg.sfx!);
  const audioArgs = withSfx
    ? ['-filter_complex', `[1:a]aformat=channel_layouts=stereo${nvf ? ',' + nvf : ''},apad[n];[2:a]aformat=channel_layouts=stereo,volume=${sfxVol.toFixed(2)}[x];[n][x]amix=inputs=2:duration=first:normalize=0${af.length ? ',' + af.join(',') : ''}${mute.length ? ',' + mute.join(',') : ''},${pad.join(',')}[a]`, '-map', '0:v:0', '-map', '[a]']
    : ['-map', '0:v:0', '-map', '1:a:0', '-af', [nvf, ...af, ...mute, ...pad].filter(Boolean).join(',')];
  args.push(...audioArgs, '-frames:v', String(frames), '-t', dur, '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-ar', '44100', '-ac', '2', out);
  await run(ffmpeg, args, signal);
}

export async function concat(ffmpeg: string, segments: string[], out: string, signal?: AbortSignal) {
  const list = out + '.txt';
  fs.writeFileSync(list, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
  await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], signal);
  fs.rmSync(list, { force: true });
}

/** Mixa trilha com ducking (sidechain) sob a narração. */
export async function mixMusic(ffmpeg: string, video: string, music: string, out: string, signal?: AbortSignal, volume = 0.05) {
  const vol = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.5)).toFixed(3);
  /* sem `-shortest`: ele cortava o último quadro do vídeo quando o áudio (com o priming do
     AAC) terminava alguns milissegundos depois. O áudio é fechado no tamanho do vídeo depois. */
  await run(ffmpeg, ['-y', '-i', video, '-stream_loop', '-1', '-i', music, '-filter_complex',
    `[1:a]volume=${vol}[m];[0:a]asplit=2[vo][sc];[m][sc]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=400[duck];[vo][duck]amix=inputs=2:duration=first:normalize=0[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', out], signal);
}

const ts = (s: number) => {
  const ms = Math.round(s * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** Caminho para o filtro subtitles= do ffmpeg (barras normais, ':' e aspas escapados — necessário no Windows). */
export const filterPath = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const assColor = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); const c = m ? m[1]! : 'ffffff'; return `&H00${c.slice(4, 6)}${c.slice(2, 4)}${c.slice(0, 2)}`.toUpperCase(); };
/** force_style do libass a partir do estilo da legenda (tamanho em px de um quadro de 1080 linhas). */
export function subtitleForceStyle(st: SubtitleStyle): string {
  const align = st.position === 'top' ? 8 : st.position === 'middle' ? 5 : 2;
  const size = Math.max(8, Math.round((st.size || 46) * 288 / 1080));
  const font = subtitleFontName(st.font);
  return [`Fontsize=${size}`, `PrimaryColour=${assColor(st.color || '#ffffff')}`, `Alignment=${align}`, 'MarginV=24',
    ...(font ? [`Fontname=${font}`] : []),
    st.box ? 'BorderStyle=3,Outline=1,BackColour=&H80000000' : 'BorderStyle=1,Outline=2,Shadow=0'].join(',');
}
export async function burnSubtitles(ffmpeg: string, video: string, srt: string, st: SubtitleStyle, out: string, signal?: AbortSignal) {
  await run(ffmpeg, ['-y', '-i', video, '-vf', `subtitles='${filterPath(srt)}':force_style='${subtitleForceStyle(st)}'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', out], signal);
}

/* ── legendas estilizadas (.ass): posição embaixo/meio/em cima + tipo (classic, box, bold, karaoke, word, neon, minimal) ── */

export interface SubWord { w: string; start: number; end: number }
export const SUBTITLE_KINDS: Array<{ id: SubtitleKind; label: string }> = [
  { id: 'classic', label: 'Clássica (contorno)' }, { id: 'box', label: 'Tarja (fundo escuro)' }, { id: 'bold', label: 'Shorts (caixa alta, palavra em destaque)' },
  { id: 'karaoke', label: 'Karaokê (preenche no tempo da fala)' }, { id: 'word', label: 'Palavra por palavra (pop)' }, { id: 'neon', label: 'Neon (brilho colorido)' }, { id: 'minimal', label: 'Minimalista (pequena, sombra)' },
  { id: 'highlight', label: 'Marca-texto (palavra falada com fundo colorido)' }, { id: 'reveal', label: 'Revelação (palavras surgem ao serem faladas)' },
  { id: 'typewriter', label: 'Máquina de escrever (letra por letra)' }, { id: 'comic', label: 'Cartoon (contorno grosso + sombra colorida)' },
  { id: 'slide', label: 'Deslizando (cada frase sobe e aparece)' },
];
export const subtitleKind = (st: SubtitleStyle): SubtitleKind => st.kind ?? (st.box ? 'box' : 'classic');

/**
 * Palavras com tempo, no tempo do vídeo inteiro: as palavras do texto da legenda (grafia certa) nos tempos do Whisper
 * da cena (por proporção quando a contagem difere); sem tempos, distribui o texto pela duração da cena. Função pura.
 */
export function subtitleWords(items: Array<{ scene: Scene; seconds: number; words?: SubWord[] }>): SubWord[] {
  const out: SubWord[] = [];
  let t0 = 0;
  for (const { scene, seconds, words } of items) {
    const custom = !!scene.subtitle?.trim();
    const text = (scene.subtitle?.trim() || scene.narration || '').trim().split(/\s+/).filter(Boolean);
    const tw = !custom && words?.length ? words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)) : [];
    const times = alignWords(text, tw, seconds);
    text.forEach((w, i) => out.push({ w, start: t0 + times[i]!.start, end: t0 + times[i]!.end }));
    t0 += seconds;
  }
  return out;
}

/**
 * Tempos de cada palavra do texto a partir das palavras do Whisper, por alinhamento
 * forçado monótono (LCS/DP) sobre o roteiro: "3" casa com "três", flexão casa por
 * prefixo e nenhuma palavra é inventada — só as realmente ausentes no áudio são
 * interpoladas entre as vizinhas casadas. Sempre crescente, dentro de [0, seconds].
 * Função pura.
 */
export function alignWords(text: string[], tw: SubWord[], seconds: number): Array<{ start: number; end: number }> {
  const n = text.length, out: Array<{ start: number; end: number } | undefined> = Array(n).fill(undefined);
  if (!n) return [];
  if (!tw.length) { const per = seconds / n; return text.map((_, i) => ({ start: i * per, end: (i + 1) * per })); }
  /* DP monótono: casa o máximo de palavras na ordem em que foram faladas */
  const score: number[][] = Array.from({ length: n }, () => new Array<number>(tw.length).fill(0));
  const dp: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(tw.length + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= tw.length; j++) {
      const s = wordScore(text[i - 1]!, tw[j - 1]!.w);
      score[i - 1]![j - 1] = s;
      dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!, s > 0 ? dp[i - 1]![j - 1]! + s : -Infinity);
    }
  }
  let i = n, j = tw.length;
  while (i > 0 && j > 0) {
    const s = score[i - 1]![j - 1]!;
    if (s > 0 && Math.abs(dp[i]![j]! - (dp[i - 1]![j - 1]! + s)) < 1e-9) {
      out[i - 1] = { start: tw[j - 1]!.start, end: tw[j - 1]!.end };
      i--; j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) i--;
    else j--;
  }
  /* sem nenhuma palavra casada: proporção pelo intervalo coberto pelo ASR */
  if (!out.some(Boolean)) {
    const from = tw[0]!.start, to = tw[tw.length - 1]!.end;
    const per = (to - from) / n;
    text.forEach((_, k) => { out[k] = { start: from + k * per, end: from + (k + 1) * per }; });
  }
  /* lacunas: só as palavras que o ASR não falou — divide o intervalo pelas letras */
  for (let k = 0; k < n;) {
    if (out[k]) { k++; continue; }
    let e = k; while (e < n && !out[e]) e++;
    const from = k > 0 ? out[k - 1]!.end : Math.max(0, (out[e]?.start ?? seconds) - 0.35 * (e - k));
    const to = e < n ? out[e]!.start : Math.min(seconds, from + 0.35 * (e - k));
    const weights = text.slice(k, e).map((w) => Math.max(1, w.length));
    const total = weights.reduce((a, x) => a + x, 0) || 1;
    let acc = 0;
    for (let q = k; q < e; q++) {
      const a = from + ((to - from) * acc) / total; acc += weights[q - k]!;
      out[q] = { start: a, end: from + ((to - from) * acc) / total };
    }
    k = e;
  }
  let last = 0;
  return out.map((t) => {
    const start = Math.min(seconds, Math.max(last, t!.start)), end = Math.min(seconds, Math.max(start + 0.05, t!.end));
    last = start + 0.01;
    return { start, end };
  });
}

/** Números por extenso (pt) que o ASR devolve em dígitos, ou o contrário. */
const PT_NUMBERS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16,
  dezessete: 17, dezassete: 17, dezoito: 18, dezenove: 19, dezanove: 19, vinte: 20, trinta: 30, quarenta: 40,
  cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200,
  trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800,
  novecentos: 900, mil: 1000, milhao: 1000000, milhoes: 1000000, bilhao: 1000000000, bilhoes: 1000000000,
};

const wordKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Forma canônica: sem acento/pontuação; dígitos e "três"/"3" viram o mesmo token. */
function canonical(s: string): string {
  const k = wordKey(s);
  if (!k) return '';
  if (/^\d{1,3}(\.\d{3})+$/.test(k)) return k.replace(/\./g, '');
  if (/^\d+,\d+$/.test(k)) return k.replace(',', '.');
  if (PT_NUMBERS[k] !== undefined) return String(PT_NUMBERS[k]);
  return k;
}

/** Distância de edição (só para palavras próximas; barata nas palavras curtas). */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = new Array<number>(b.length + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]!; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length]!;
}

/** Quanto duas palavras "são a mesma": exata, número, prefixo/flexão ou 1 letra de diferença. */
function wordScore(a: string, b: string): number {
  const x = canonical(a), y = canonical(b);
  if (!x || !y) return 0;
  if (x === y) return 3;
  const min = Math.min(x.length, y.length);
  if (min >= 4 && (x.startsWith(y) || y.startsWith(x))) return 2;
  if (min >= 5 && editDistance(x, y) <= 1) return 1.5;
  return 0;
}

/** Agrupa as palavras em blocos de legenda (máx. N palavras; quebra em pontuação e em pausas). Função pura. */
export function subtitleCues(words: SubWord[], max: number): SubWord[][] {
  const cues: SubWord[][] = [];
  let cur: SubWord[] = [];
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (cur.length && (cur.length >= max || (prev && w.start - prev.end > 0.6))) { cues.push(cur); cur = []; }
    cur.push(w);
    if (cur.length >= 2 && /[.!?;:]$/.test(w.w) && i < words.length - 1) { cues.push(cur); cur = []; }
  });
  if (cur.length) cues.push(cur);
  return cues;
}

/**
 * Regras de exibição (o que o olho nota antes do número): cue de 0,8 s no mínimo,
 * no máximo 20 caracteres por segundo, 0,08 s de intervalo entre cues, linha de 42
 * caracteres e no máximo 2 linhas, nunca sobrepostas.
 */
export interface CueRules { maxChars: number; maxLines: number; minSeconds: number; gap: number; maxCps: number }
export const SUBTITLE_RULES: CueRules = { maxChars: 42, maxLines: 2, minSeconds: 0.8, gap: 0.08, maxCps: 20 };

export interface CueBox { words: SubWord[]; text: string; lines: string[]; start: number; end: number }

/** Quebra o texto em linhas de até `maxChars` caracteres, sem cortar palavra. */
export function wrapCue(text: string, maxChars = SUBTITLE_RULES.maxChars): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w;
    else if ([...cur].length + 1 + [...w].length <= maxChars) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Agrupa por pausa (>0,6 s) e pontuação — a mesma quebra de frase da legenda. */
function groupCues(words: SubWord[]): SubWord[][] {
  const cues: SubWord[][] = [];
  let cur: SubWord[] = [];
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (cur.length && prev && w.start - prev.end > 0.6) { cues.push(cur); cur = []; }
    cur.push(w);
    if (cur.length >= 2 && /[.!?;:]$/.test(w.w) && i < words.length - 1) { cues.push(cur); cur = []; }
  });
  if (cur.length) cues.push(cur);
  return cues;
}

/** Divide um grupo em cues que caibam em `maxLines` linhas de `maxChars`. */
function packCues(group: SubWord[], rules: CueRules): SubWord[][] {
  const cues: SubWord[][] = [];
  let cur: SubWord[] = [];
  for (const w of group) {
    const next = [...cur, w];
    if (cur.length && wrapCue(next.map((x) => x.w).join(' '), rules.maxChars).length > rules.maxLines) {
      cues.push(cur); cur = [w];
    } else cur = next;
  }
  if (cur.length) cues.push(cur);
  return cues;
}

/**
 * Tempos de exibição dos cues: duração mínima, intervalo entre cues, sem sobreposição
 * e CPS dentro do limite (estende a cue no silêncio seguinte quando possível).
 * Função pura.
 */
export function cueWindows(cues: SubWord[][], rules: Partial<CueRules> = {}): Array<{ start: number; end: number }> {
  const r = { ...SUBTITLE_RULES, ...rules };
  const out: Array<{ start: number; end: number }> = [];
  let prevEnd = -Infinity;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]!;
    const natStart = cue[0]!.start, natEnd = cue[cue.length - 1]!.end;
    const nextNat = cues[i + 1]?.[0]?.start ?? Infinity;
    const limit = Number.isFinite(nextNat) ? nextNat - r.gap : Infinity;
    let start = Math.max(natStart, prevEnd + r.gap);
    let end = Math.min(natEnd + 0.35, limit);
    if (end < start + r.minSeconds) end = Math.min(limit, Math.max(start + 0.2, start + r.minSeconds));
    if (end < start + 0.2) end = start + 0.2;
    /* CPS: o texto precisa de `chars / 20` segundos — usa o silêncio seguinte, sem invadir o próximo cue */
    const need = cue.map((w) => w.w).join(' ').length / r.maxCps;
    if (end - start < need) end = Math.min(limit, Math.max(end, start + need));
    if (end < start + 0.2) end = start + 0.2;
    prevEnd = end;
    out.push({ start: +start.toFixed(3), end: +end.toFixed(3) });
  }
  return out;
}

/**
 * Cues prontos para exibir: texto quebrado em até 2 linhas de 42 caracteres e tempos
 * que respeitam as regras de exibição. Função pura.
 */
export function layoutCues(words: SubWord[], rules: Partial<CueRules> = {}): CueBox[] {
  const r = { ...SUBTITLE_RULES, ...rules };
  const cues = groupCues(words).flatMap((g) => packCues(g, r));
  const times = cueWindows(cues, r);
  return cues.map((cw, i) => {
    const text = cw.map((w) => w.w).join(' ');
    return { words: cw, text, lines: wrapCue(text, r.maxChars), start: times[i]!.start, end: times[i]!.end };
  });
}

const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const assEsc = (s: string) => s.replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ');

/** Documento .ass das legendas no tamanho do vídeo. Função pura. */
export function buildAss(words: SubWord[], st: SubtitleStyle, size: { w: number; h: number }): string {
  const kind = subtitleKind(st), H = size.h, W = size.w, tall = H > W;
  const base = Math.max(12, Math.round((st.size || 46) * H / 1080));
  const fs = kind === 'word' ? Math.round(base * 1.6) : kind === 'bold' || kind === 'highlight' || kind === 'comic' ? Math.round(base * (tall ? 1.05 : 1.25)) : kind === 'minimal' ? Math.round(base * 0.8) : base;
  const color = assColor(st.color || '#ffffff'), accent = assColor(st.accent || (kind === 'neon' ? '#00e5ff' : '#ffe14d'));
  const align = st.position === 'top' ? 8 : st.position === 'middle' ? 5 : 2;
  const marginV = st.position === 'middle' ? 0 : Math.round(H * (tall ? (st.position === 'top' ? 0.12 : 0.16) : 0.07));
  const font = subtitleFontName(st.font) || (kind === 'bold' || kind === 'word' || kind === 'highlight' || kind === 'comic' ? 'Arial Black' : kind === 'typewriter' ? 'Courier New' : 'Arial');
  const ol = (k: number) => Math.max(1, Math.round(fs * k));
  /* Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding */
  const style = (() => {
    const m = Math.round(W * 0.06);
    switch (kind) {
      case 'box': return `Main,${font},${fs},${color},${color},&H64000000,&H64000000,-1,0,0,0,100,100,0,0,3,${ol(0.22)},0,${align},${m},${m},${marginV},1`;
      case 'bold': return `Main,${font},${fs},${color},${color},&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,${ol(0.11)},${ol(0.05)},${align},${m},${m},${marginV},1`;
      case 'karaoke': return `Main,${font},${fs},${accent},${color},&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,${ol(0.08)},${ol(0.03)},${align},${m},${m},${marginV},1`;
      case 'word': return `Main,${font},${fs},${color},${color},&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,${ol(0.1)},${ol(0.05)},${align},${m},${m},${marginV},1`;
      case 'neon': return `Main,${font},${fs},${color},${color},${accent},&H00000000,-1,0,0,0,100,100,1,0,1,${ol(0.12)},0,${align},${m},${m},${marginV},1`;
      case 'highlight': return `Main,${font},${fs},${color},${color},&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,${ol(0.08)},${ol(0.04)},${align},${m},${m},${marginV},1`;
      case 'comic': return `Main,${font},${fs},${color},${color},&H00000000,${accent},-1,0,0,0,100,100,1,0,1,${ol(0.14)},${ol(0.1)},${align},${m},${m},${marginV},1`;
      case 'typewriter': return `Main,${font},${fs},${color},${color},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${ol(0.07)},${ol(0.04)},${align},${m},${m},${marginV},1`;
      case 'minimal': return `Main,${font},${fs},${color},${color},&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,0,${ol(0.06)},${align},${m},${m},${marginV},1`;
      default: return `Main,${font},${fs},${color},${color},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${ol(0.08)},0,${align},${m},${m},${marginV},1`;
    }
  })();
  const max = kind === 'word' ? 1 : kind === 'bold' || kind === 'comic' ? 3 : kind === 'highlight' ? 4 : tall ? 4 : 6;
  /* tipos de bloco seguem as regras de exibição (2 linhas de 42, 0,8 s, 0,08 s de intervalo);
     os tipos palavra-por-palavra mantêm o tempo de fala de cada palavra */
  const block = kind === 'classic' || kind === 'box' || kind === 'minimal' || kind === 'slide' || kind === 'comic' || kind === 'neon';
  const boxes = block ? layoutCues(words) : undefined;
  const cues = boxes ? boxes.map((b) => b.words) : subtitleCues(words, max);
  const windows = block ? cueWindows(cues) : undefined;
  const cueText = (cue: SubWord[], ci: number) => (boxes ? boxes[ci]!.lines.join('\\N') : cue.map((w) => w.w).join(' '));
  const lines: string[] = [];
  const up = (s: string) => (kind === 'bold' || kind === 'word' || kind === 'highlight' || kind === 'comic' ? s.toUpperCase() : s);
  /* ponto de ancoragem do texto (para \move): centro horizontal, base/topo/meio conforme a posição */
  const ax = Math.round(W / 2), ay = st.position === 'top' ? marginV : st.position === 'middle' ? Math.round(H / 2) : H - marginV;
  const ms = (x: number) => Math.max(0, Math.round(x * 1000));
  cues.forEach((cue, ci) => {
    const next = cues[ci + 1]?.[0]?.start;
    const a = windows ? windows[ci]!.start : cue[0]!.start;
    const b = windows ? windows[ci]!.end : Math.max(a + 0.25, Math.min(next ?? Infinity, cue[cue.length - 1]!.end + 0.35));
    if (kind === 'bold') {
      /* uma linha por palavra falada: o bloco inteiro na tela, a palavra da vez na cor de destaque e um pouco maior */
      let prevEnd = a;
      cue.forEach((w, wi) => {
        const wa = Math.max(prevEnd, wi === 0 ? a : w.start), wb = Math.max(wa + 0.05, wi === cue.length - 1 ? b : cue[wi + 1]!.start);
        prevEnd = wb;
        const txt = cue.map((x, xi) => (xi === wi ? `{\\c${accent}\\fscx110\\fscy110}${assEsc(up(x.w))}{\\c${color}\\fscx100\\fscy100}` : assEsc(up(x.w)))).join(' ');
        lines.push(`Dialogue: 0,${assTime(wa)},${assTime(Math.max(wa + 0.05, wb))},Main,,0,0,0,,${txt}`);
      });
    } else if (kind === 'highlight') {
      /* marca-texto: a palavra falada ganha um contorno grosso na cor de destaque (fundo) e texto escuro */
      let prevEnd = a;
      cue.forEach((w, wi) => {
        const wa = Math.max(prevEnd, wi === 0 ? a : w.start), wb = Math.max(wa + 0.05, wi === cue.length - 1 ? b : cue[wi + 1]!.start);
        prevEnd = wb;
        const txt = cue.map((x, xi) => (xi === wi ? `{\\c&H101010&\\3c${accent}\\bord${ol(0.3)}\\shad0}${assEsc(up(x.w))}{\\c${color}\\3c&H000000&\\bord${ol(0.08)}\\shad${ol(0.04)}}` : assEsc(up(x.w)))).join(' ');
        lines.push(`Dialogue: 0,${assTime(wa)},${assTime(wb)},Main,,0,0,0,,${txt}`);
      });
    } else if (kind === 'reveal') {
      /* revelação: o bloco inteiro ocupa o lugar (invisível) e cada palavra aparece quando é falada — o texto não pula */
      let prevEnd = a;
      cue.forEach((w, wi) => {
        const wa = Math.max(prevEnd, wi === 0 ? a : w.start), wb = Math.max(wa + 0.05, wi === cue.length - 1 ? b : cue[wi + 1]!.start);
        prevEnd = wb;
        const seen = cue.slice(0, wi + 1).map((x) => assEsc(x.w)).join(' '), rest = cue.slice(wi + 1).map((x) => assEsc(x.w)).join(' ');
        lines.push(`Dialogue: 0,${assTime(wa)},${assTime(wb)},Main,,0,0,0,,${seen}${rest ? ` {\\alpha&HFF&}${rest}` : ''}`);
      });
    } else if (kind === 'typewriter') {
      /* máquina de escrever: cada letra aparece no tempo da sua palavra (as letras dividem a duração da palavra) */
      const parts: string[] = [];
      cue.forEach((w, wi) => {
        const ws = Math.max(0, w.start - a), we = Math.max(ws + 0.05, (wi < cue.length - 1 ? cue[wi + 1]!.start : w.end) - a);
        const chars = [...assEsc(w.w)], per = (we - ws) / Math.max(1, chars.length);
        parts.push(chars.map((ch, k) => { const t = ms(ws + per * k); return `{\\alpha&HFF&\\t(${t},${t + 1},\\alpha&H00&)}${ch}`; }).join(''));
      });
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,${parts.join(' ')}`);
    } else if (kind === 'comic') {
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,{\\frz-3\\fscx60\\fscy60\\t(0,120,\\fscx108\\fscy108)\\t(120,200,\\fscx100\\fscy100)}${assEsc(up(cueText(cue, ci)))}`);
    } else if (kind === 'slide') {
      const dy = Math.round(H * 0.045);
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,{\\move(${ax},${ay + dy},${ax},${ay},0,220)\\fad(180,140)}${assEsc(cueText(cue, ci))}`);
    } else if (kind === 'karaoke') {
      const txt = cue.map((w, wi) => `{\\kf${Math.max(1, Math.round(((wi < cue.length - 1 ? cue[wi + 1]!.start : w.end) - w.start) * 100))}}${assEsc(w.w)}`).join(' ');
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,${cue[0]!.start > a ? `{\\k${Math.round((cue[0]!.start - a) * 100)}}` : ''}${txt}`);
    } else if (kind === 'word') {
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,{\\fscx70\\fscy70\\t(0,90,\\fscx112\\fscy112)\\t(90,160,\\fscx100\\fscy100)}${assEsc(up(cue[0]!.w))}`);
    } else if (kind === 'neon') {
      /* brilho: camada 0 borrada e grossa na cor de destaque; camada 1 = texto nítido com contorno fino */
      const t = assEsc(cueText(cue, ci));
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,{\\bord${ol(0.22)}\\blur${Math.max(4, Math.round(fs * 0.18))}\\1a&HFF&\\fad(120,120)}${t}`);
      lines.push(`Dialogue: 1,${assTime(a)},${assTime(b)},Main,,0,0,0,,{\\bord${ol(0.04)}\\blur1\\fad(120,120)}${t}`);
    } else {
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,${kind === 'minimal' ? '{\\fad(150,150)}' : ''}${assEsc(cueText(cue, ci))}`);
    }
  });
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: ${style}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`;
}

/** Grava a legenda no vídeo a partir do .ass (estilo completo: tipo, posição, palavra em destaque). */
export async function burnAss(ffmpeg: string, video: string, ass: string, out: string, signal?: AbortSignal) {
  await run(ffmpeg, ['-y', '-i', video, '-vf', `subtitles='${filterPath(ass)}'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', out], signal);
}

/** .srt com os mesmos blocos do .ass (para YouTube e players): usa os tempos das palavras quando houver. */
export function writeSrtFromWords(file: string, words: SubWord[], _max = 6) {
  /* as regras de exibição valem para o arquivo que o player mostra: 2 linhas de 42,
     0,8 s por cue, 0,08 s entre cues, sem sobreposição e CPS ≤ 20 */
  const cues = layoutCues(words);
  const out = cues.map((cue, i) => `${i + 1}\n${ts(cue.start)} --> ${ts(cue.end)}\n${cue.lines.join('\n')}\n`).join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out + '\n');
}

export function writeSrt(file: string, items: Array<{ scene: Scene; seconds: number }>) {
  let t = 0, n = 1, out = '';
  for (const { scene, seconds } of items) {
    const words = (scene.subtitle?.trim() || scene.narration).trim().split(/\s+/).filter(Boolean);
    const chunk = 6;
    const parts = Math.max(1, Math.ceil(words.length / chunk));
    const per = seconds / parts;
    for (let i = 0; i < parts; i++) {
      out += `${n++}\n${ts(t + i * per)} --> ${ts(t + (i + 1) * per)}\n${words.slice(i * chunk, (i + 1) * chunk).join(' ')}\n\n`;
    }
    t += seconds;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
}
