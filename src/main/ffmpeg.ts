import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Aspect, FinalEffects, FxFilter, FxMove, FxSegment, FxTransition, FxVignette, Scene, SceneEffects, SubtitleKind, SubtitleStyle } from '../shared/types';

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
export const SFX_DEFAULT_VOLUME = 0.15;
export interface SegmentInput { visual?: string; audio?: string; seconds: number; effects?: SceneEffects; loop?: boolean; sfx?: string; sfxVolume?: number }

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
    default: return undefined;
  }
}

export function effectFilters(e: SceneEffects | undefined, seconds: number, w: number, h: number): string[] {
  const f: string[] = [];
  if (!e) return f;
  const frames = Math.max(1, Math.round(seconds * 30));
  const mv = moveExpr(e.zoom, frames);
  if (mv) f.push(`zoompan=z='${mv.z}':x='${mv.x}':y='${mv.y}':d=1:s=${w}x${h}:fps=30`);
  f.push(...colorFilter(e.filter), ...vignetteFilter(e.vignette));
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
  const vf = [`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`, ...effectFilters(seg.effects, seg.seconds, w, h), 'format=yuv420p'].join(',');
  const af = audioFades(seg.effects, seg.seconds);
  const args: string[] = ['-y'];
  const isVideo = !!seg.visual && /\.(mp4|webm|mov|mkv|gif)$/i.test(seg.visual);
  if (!seg.visual) args.push('-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:r=30`);
  else if (isVideo) { if (seg.loop !== false) args.push('-stream_loop', '-1'); args.push('-i', seg.visual); }
  else args.push('-loop', '1', '-framerate', '30', '-i', seg.visual);
  if (seg.audio) args.push('-i', seg.audio); else args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  /* efeitos sonoros da cena somados à narração (volume próprio, sem abaixar a voz) */
  const sfxVol = Math.max(0, Math.min(1.5, seg.sfxVolume ?? SFX_DEFAULT_VOLUME));
  const withSfx = !!seg.sfx && fs.existsSync(seg.sfx) && sfxVol > 0;
  if (withSfx) args.push('-i', seg.sfx!);
  const audioArgs = withSfx
    ? ['-filter_complex', `[1:a]aformat=channel_layouts=stereo,apad[n];[2:a]aformat=channel_layouts=stereo,volume=${sfxVol.toFixed(2)}[x];[n][x]amix=inputs=2:duration=first:normalize=0${af.length ? ',' + af.join(',') : ''}[a]`, '-map', '0:v:0', '-map', '[a]']
    : ['-map', '0:v:0', '-map', '1:a:0', ...(af.length ? ['-af', af.join(',')] : [])];
  args.push(...audioArgs, '-t', seg.seconds.toFixed(3), '-vf', vf,
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
export async function mixMusic(ffmpeg: string, video: string, music: string, out: string, signal?: AbortSignal, volume = 0.15) {
  const vol = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.5)).toFixed(3);
  await run(ffmpeg, ['-y', '-i', video, '-stream_loop', '-1', '-i', music, '-filter_complex',
    `[1:a]volume=${vol}[m];[0:a]asplit=2[vo][sc];[m][sc]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=400[duck];[vo][duck]amix=inputs=2:duration=first:normalize=0[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out], signal);
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
  return [`Fontsize=${size}`, `PrimaryColour=${assColor(st.color || '#ffffff')}`, `Alignment=${align}`, 'MarginV=24',
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
 * Tempos de cada palavra do texto a partir das palavras do Whisper: casa pela grafia (sem acento/pontuação, olhando
 * até 4 adiante) e interpola as que não casam entre as vizinhas. Sempre crescente, dentro de [0, seconds]. Função pura.
 */
export function alignWords(text: string[], tw: SubWord[], seconds: number): Array<{ start: number; end: number }> {
  const n = text.length, out: Array<{ start: number; end: number } | undefined> = Array(n).fill(undefined);
  if (!n) return [];
  if (!tw.length) { const per = seconds / n; return text.map((_, i) => ({ start: i * per, end: (i + 1) * per })); }
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  let j = 0;
  text.forEach((w, i) => {
    const k = norm(w);
    for (let d = 0; d < 5 && j + d < tw.length; d++) if (k && norm(tw[j + d]!.w) === k) { out[i] = { start: tw[j + d]!.start, end: tw[j + d]!.end }; j += d + 1; return; }
  });
  /* sem nenhuma palavra casada: proporção pela contagem */
  if (!out.some(Boolean)) text.forEach((_, i) => { const a = tw[Math.min(tw.length - 1, Math.floor((i * tw.length) / n))]!; out[i] = { start: a.start, end: a.end }; });
  /* lacunas: divide o intervalo entre as vizinhas casadas */
  for (let i = 0; i < n;) {
    if (out[i]) { i++; continue; }
    let e = i; while (e < n && !out[e]) e++;
    const from = i > 0 ? out[i - 1]!.end : Math.max(0, (out[e]?.start ?? seconds) - 0.4 * (e - i));
    const to = e < n ? out[e]!.start : Math.min(seconds, from + 0.4 * (e - i));
    const per = Math.max(0.05, (to - from) / (e - i));
    for (let k = i; k < e; k++) out[k] = { start: from + (k - i) * per, end: from + (k - i + 1) * per };
    i = e;
  }
  let last = 0;
  return out.map((t) => {
    const start = Math.min(seconds, Math.max(last, t!.start)), end = Math.min(seconds, Math.max(start + 0.05, t!.end));
    last = start + 0.01;
    return { start, end };
  });
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

const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const assEsc = (s: string) => s.replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ');

/** Documento .ass das legendas no tamanho do vídeo. Função pura. */
export function buildAss(words: SubWord[], st: SubtitleStyle, size: { w: number; h: number }): string {
  const kind = subtitleKind(st), H = size.h, W = size.w, tall = H > W;
  const base = Math.max(12, Math.round((st.size || 46) * H / 1080));
  const fs = kind === 'word' ? Math.round(base * 1.6) : kind === 'bold' ? Math.round(base * (tall ? 1.05 : 1.25)) : kind === 'minimal' ? Math.round(base * 0.8) : base;
  const color = assColor(st.color || '#ffffff'), accent = assColor(st.accent || (kind === 'neon' ? '#00e5ff' : '#ffe14d'));
  const align = st.position === 'top' ? 8 : st.position === 'middle' ? 5 : 2;
  const marginV = st.position === 'middle' ? 0 : Math.round(H * (tall ? (st.position === 'top' ? 0.12 : 0.16) : 0.07));
  const font = kind === 'bold' || kind === 'word' ? 'Arial Black' : 'Arial';
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
      case 'minimal': return `Main,${font},${fs},${color},${color},&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,0,${ol(0.06)},${align},${m},${m},${marginV},1`;
      default: return `Main,${font},${fs},${color},${color},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${ol(0.08)},0,${align},${m},${m},${marginV},1`;
    }
  })();
  const max = kind === 'word' ? 1 : kind === 'bold' ? 3 : tall ? 4 : 6;
  const cues = subtitleCues(words, max), lines: string[] = [];
  const up = (s: string) => (kind === 'bold' || kind === 'word' ? s.toUpperCase() : s);
  cues.forEach((cue, ci) => {
    const a = cue[0]!.start, next = cues[ci + 1]?.[0]?.start;
    const b = Math.max(a + 0.25, Math.min(next ?? Infinity, cue[cue.length - 1]!.end + 0.35));
    if (kind === 'bold') {
      /* uma linha por palavra falada: o bloco inteiro na tela, a palavra da vez na cor de destaque e um pouco maior */
      let prevEnd = a;
      cue.forEach((w, wi) => {
        const wa = Math.max(prevEnd, wi === 0 ? a : w.start), wb = Math.max(wa + 0.05, wi === cue.length - 1 ? b : cue[wi + 1]!.start);
        prevEnd = wb;
        const txt = cue.map((x, xi) => (xi === wi ? `{\\c${accent}\\fscx110\\fscy110}${assEsc(up(x.w))}{\\c${color}\\fscx100\\fscy100}` : assEsc(up(x.w)))).join(' ');
        lines.push(`Dialogue: 0,${assTime(wa)},${assTime(Math.max(wa + 0.05, wb))},Main,,0,0,0,,${txt}`);
      });
    } else if (kind === 'karaoke') {
      const txt = cue.map((w, wi) => `{\\kf${Math.max(1, Math.round(((wi < cue.length - 1 ? cue[wi + 1]!.start : w.end) - w.start) * 100))}}${assEsc(w.w)}`).join(' ');
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,${cue[0]!.start > a ? `{\\k${Math.round((cue[0]!.start - a) * 100)}}` : ''}${txt}`);
    } else if (kind === 'word') {
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,{\\fscx70\\fscy70\\t(0,90,\\fscx112\\fscy112)\\t(90,160,\\fscx100\\fscy100)}${assEsc(up(cue[0]!.w))}`);
    } else if (kind === 'neon') {
      /* brilho: camada 0 borrada e grossa na cor de destaque; camada 1 = texto nítido com contorno fino */
      const t = assEsc(cue.map((w) => w.w).join(' '));
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,{\\bord${ol(0.22)}\\blur${Math.max(4, Math.round(fs * 0.18))}\\1a&HFF&\\fad(120,120)}${t}`);
      lines.push(`Dialogue: 1,${assTime(a)},${assTime(b)},Main,,0,0,0,,{\\bord${ol(0.04)}\\blur1\\fad(120,120)}${t}`);
    } else {
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,${kind === 'minimal' ? '{\\fad(150,150)}' : ''}${assEsc(cue.map((w) => w.w).join(' '))}`);
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
export function writeSrtFromWords(file: string, words: SubWord[], max = 6) {
  const cues = subtitleCues(words, max);
  const out = cues.map((cue, i) => {
    const a = cue[0]!.start, b = Math.max(a + 0.25, Math.min(cues[i + 1]?.[0]?.start ?? Infinity, cue[cue.length - 1]!.end + 0.35));
    return `${i + 1}\n${ts(a)} --> ${ts(b)}\n${cue.map((w) => w.w).join(' ')}\n`;
  }).join('\n');
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
