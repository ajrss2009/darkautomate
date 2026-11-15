import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolveBin } from './ffmpeg';
import { decodeMono } from './visualizer';

/*
 * MÉTRICAS QUANTIFICÁVEIS da clonagem (canal ou vídeo) — tudo medido, sem IA:
 *  - áudio: volume da voz, da música por baixo da voz (nas pausas entre palavras) e efeitos sonoros (transientes
 *    agudos fora das bordas das palavras) por minuto;
 *  - descrição: tamanho, linhas, hashtags, links, capítulos, emojis e chamadas para ação;
 *  - arte: paleta dominante, brilho, saturação, contraste, contornos e "chapado" (cores planas) → classe de arte.
 * As médias/medianas de vários vídeos viram números para a skill copiar.
 */

export interface WordT { start: number; end: number; word?: string }
export interface AudioQuant {
  /** volume médio da voz (dBFS, durante as palavras) */
  speechDb?: number;
  /** volume nas pausas entre palavras (dBFS) — a música/ambiente por baixo */
  bedDb?: number;
  /** música em relação à voz (dB; ex.: −18 = música 18 dB abaixo da voz) */
  musicRelDb?: number;
  musicPresent?: boolean;
  /** efeitos sonoros por minuto (transientes agudos fora do início das palavras) */
  sfxPerMin?: number;
  /** mediana dos intervalos entre efeitos (s) */
  sfxMedianGapSec?: number;
  sfxCount?: number;
}
export interface DescQuant {
  chars: number; words: number; lines: number; paragraphs: number; firstLineChars: number;
  hashtags: number; links: number; chapters: number; emojis: number; ctas: number; mentions: number;
}
export interface ArtQuant {
  /** cores dominantes (#rrggbb), da mais usada para a menos */
  palette: string[];
  brightness: number; saturation: number; contrast: number;
  /** fração de pixels de contorno (desenho com traço alto; foto/3D suave baixo) */
  edgeDensity: number;
  /** fração da imagem coberta pelas 8 cores mais comuns (cores chapadas → alto) */
  flatness: number;
  /** classe estimada: flat-2d | cartoon-linha | 3d-render | foto-real | escuro-cinematografico */
  artClass: string;
  frames: number;
  /* LUZ */
  /** fração de pixels escuros (< 20%) e claros (> 80%) */
  darkShare?: number; brightShare?: number;
  /** temperatura: (R − B) médio, −1 frio … +1 quente */
  warmth?: number;
  /** desvio do brilho entre quadros (luz constante ≈ 0; muda de cena para cena > 0,1) */
  brightnessVar?: number;
  /** clave: baixa (sombras), média, alta (claro) */
  lightKey?: string;
}
/** movimento de câmera medido entre quadros (2 por segundo): frações do tempo e intensidade */
export interface MotionQuant {
  staticShare: number; panShare: number; tiltShare: number; zoomInShare: number; zoomOutShare: number; handheldShare: number;
  /** deslocamento médio (% da largura por segundo) */
  speedPctPerSec: number;
  /** trocas bruscas de imagem (cortes) por minuto */
  cutsPerMin: number;
}

const db = (rms: number) => Math.round(20 * Math.log10(Math.max(rms, 1e-6)) * 10) / 10;
export const median = (xs: number[]): number | undefined => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};
const r1 = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 10) / 10);
const r2 = (x: number) => Math.round(x * 100) / 100;

/* ───────── áudio ───────── */

function rmsOf(s: Float32Array, a: number, b: number): number {
  let e = 0, n = 0;
  for (let i = Math.max(0, a); i < Math.min(s.length, b); i++) { e += s[i]! * s[i]!; n++; }
  return n ? Math.sqrt(e / n) : 0;
}

/**
 * Mede voz, música por baixo e efeitos sonoros (função pura sobre as amostras mono).
 * Com palavras (Whisper): voz = trechos das palavras; música = pausas ≥ 0,25 s entre palavras.
 * Sem palavras: voz ≈ percentil 90 do RMS em janelas de 100 ms; fundo ≈ percentil 15.
 */
export function audioQuantFromSamples(s: Float32Array, rate: number, words?: WordT[]): AudioQuant {
  const out: AudioQuant = {};
  const dur = s.length / rate;
  if (dur < 1) return out;
  const w = (words ?? []).filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  if (w.length >= 10) {
    let se = 0, sn = 0, ge = 0, gn = 0;
    for (const x of w) { const a = Math.round(x.start * rate), b = Math.round(x.end * rate); for (let i = a; i < b && i < s.length; i++) { se += s[i]! * s[i]!; sn++; } }
    /* pausas de verdade (≥ 0,4 s), sem 0,12 s de cada borda (os tempos do Whisper vazam o fim/começo da voz).
       O fundo é a MEDIANA do RMS de janelas de 50 ms nessas pausas: respiração/eco isolados não sobem o número. */
    const gw = Math.round(rate * 0.05), gaps: number[] = [];
    for (let i = 1; i < w.length; i++) {
      const g0 = w[i - 1]!.end + 0.12, g1 = w[i]!.start - 0.12;
      if (g1 - g0 < 0.16) continue;
      for (let a = Math.round(g0 * rate); a + gw <= Math.round(g1 * rate) && a + gw <= s.length; a += gw) { const r = rmsOf(s, a, a + gw); gaps.push(r); ge += r * r; gn++; }
    }
    if (sn) out.speechDb = db(Math.sqrt(se / sn));
    if (gaps.length >= 10) out.bedDb = db(median(gaps)!);
  } else {
    const win = Math.round(rate * 0.1), rms: number[] = [];
    for (let i = 0; i + win <= s.length; i += win) rms.push(rmsOf(s, i, i + win));
    const sorted = [...rms].sort((a, b) => a - b);
    out.speechDb = db(sorted[Math.floor(sorted.length * 0.9)] ?? 0);
    out.bedDb = db(sorted[Math.floor(sorted.length * 0.15)] ?? 0);
  }
  if (out.speechDb !== undefined && out.bedDb !== undefined) {
    out.musicRelDb = r1(out.bedDb - out.speechDb);
    out.musicPresent = out.bedDb > -50 && out.musicRelDb! > -40;
  }
  /* efeitos: energia do sinal "agudo" (diferença de amostras) em janelas de 20 ms; transiente = 6× a mediana
     do último 1,5 s e acima de −42 dBFS; 250 ms de intervalo mínimo; ignora ±80 ms do início das palavras */
  const fw = Math.round(rate * 0.02), hist: number[] = [], onsets: number[] = [];
  /* bordas de palavra (início e fim) não contam como efeito */
  const starts = w.flatMap((x) => [x.start, x.end]).sort((p, q) => p - q);
  let wi = 0, last = -1;
  for (let i = fw; i + fw <= s.length; i += fw) {
    let e = 0;
    for (let k = i; k < i + fw; k++) { const d = s[k]! - s[k - 1]!; e += d * d; }
    e = Math.sqrt(e / fw);
    const t = i / rate;
    /* salto em relação ao fundo (mediana de 1,5 s) E aos últimos 100 ms: som contínuo (voz, música) não conta */
    const recent = hist.length >= 5 ? hist.slice(-5).reduce((a, b) => a + b, 0) / 5 : 0;
    const base = Math.max(median(hist) ?? 0, recent);
    hist.push(e); if (hist.length > 75) hist.shift();
    while (wi < starts.length && starts[wi]! < t - 0.08) wi++;
    const nearWord = wi < starts.length && Math.abs(starts[wi]! - t) <= 0.08;
    if (hist.length >= 25 && e > base * 6 && db(e) > -42 && t - last >= 0.25 && !nearWord) { onsets.push(t); last = t; }
  }
  out.sfxCount = onsets.length;
  out.sfxPerMin = r1((onsets.length / dur) * 60);
  out.sfxMedianGapSec = r1(median(onsets.slice(1).map((t, i) => t - onsets[i]!)));
  return out;
}

export async function audioQuant(ffmpeg: string, file: string, words?: WordT[], signal?: AbortSignal): Promise<AudioQuant> {
  const rate = 16000;
  const s = await decodeMono(ffmpeg, file, rate, signal);
  return audioQuantFromSamples(s, rate, words);
}

/** Palavras com tempo do JSON do Whisper do app ({ words: [{ start, end, word }] }). */
export function readWords(file: string): WordT[] | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { words?: WordT[]; segments?: Array<{ words?: WordT[] }> };
    const w = j.words ?? j.segments?.flatMap((x) => x.words ?? []);
    return w?.filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end));
  } catch { return undefined; }
}

/* ───────── descrição ───────── */

export function descQuant(desc: string): DescQuant {
  const d = (desc ?? '').replace(/\r\n/g, '\n');
  const lines = d.split('\n');
  return {
    chars: d.length,
    words: d.split(/\s+/).filter(Boolean).length,
    lines: lines.filter((l) => l.trim()).length,
    paragraphs: d.split(/\n\s*\n/).filter((p) => p.trim()).length,
    firstLineChars: (lines.find((l) => l.trim()) ?? '').trim().length,
    hashtags: (d.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length,
    links: (d.match(/https?:\/\/\S+/g) ?? []).length,
    chapters: lines.filter((l) => /^\s*\(?\d{1,2}:\d{2}(:\d{2})?\)?\s+\S/.test(l)).length,
    emojis: (d.match(/\p{Extended_Pictographic}/gu) ?? []).length,
    ctas: (d.match(/inscrev|subscribe|curt[ae]|like|coment|comment|compartilh|share|sino|bell|segue|follow|link na|patreon|membro|join/gi) ?? []).length,
    mentions: (d.match(/(^|\s)@[\w.-]+/g) ?? []).length,
  };
}

/* ───────── arte (pixels) ───────── */

function rawRgb(ffmpeg: string, file: string, w: number, h: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(resolveBin(ffmpeg), ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true });
    const ch: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => ch.push(d));
    signal?.addEventListener('abort', () => p.kill(), { once: true });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve(Buffer.concat(ch)) : reject(new Error(`ffmpeg ${c}`))));
  });
}

/** Métricas de arte de um quadro RGB (função pura). */
export function artOfPixels(px: Uint8Array, w: number, h: number): Omit<ArtQuant, 'palette' | 'artClass' | 'frames' | 'brightnessVar' | 'lightKey'> & { darkShare: number; brightShare: number; warmth: number; hist: Map<number, number> } {
  const n = w * h, L = new Float64Array(n);
  let sb = 0, ss = 0;
  const hist = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = px[i * 3]!, g = px[i * 3 + 1]!, b = px[i * 3 + 2]!;
    const l = 0.299 * r + 0.587 * g + 0.114 * b; L[i] = l; sb += l;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); ss += mx ? (mx - mn) / mx : 0;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);              // 4 bits por canal
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
  const mean = sb / n;
  let sd = 0; for (let i = 0; i < n; i++) sd += (L[i]! - mean) ** 2;
  let edges = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = L[i + 1]! - L[i - 1]!, gy = L[i + w]! - L[i - w]!;
    if (Math.hypot(gx, gy) > 60) edges++;
  }
  const top8 = [...hist.values()].sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0);
  let dark = 0, bright = 0, warm = 0;
  for (let i = 0; i < n; i++) { if (L[i]! < 51) dark++; else if (L[i]! > 204) bright++; warm += (px[i * 3]! - px[i * 3 + 2]!) / 255; }
  return { brightness: r2(mean / 255), saturation: r2(ss / n), contrast: r2(Math.sqrt(sd / n) / 128), edgeDensity: r2(edges / ((w - 2) * (h - 2))), flatness: r2(top8 / n), darkShare: r2(dark / n), brightShare: r2(bright / n), warmth: r2(warm / n), hist };
}

export function artClass(a: Pick<ArtQuant, 'brightness' | 'saturation' | 'edgeDensity' | 'flatness' | 'contrast'>): string {
  if (a.flatness >= 0.55 && a.edgeDensity >= 0.04) return 'cartoon-linha';
  if (a.flatness >= 0.45) return 'flat-2d';
  if (a.brightness < 0.28 && a.contrast >= 0.35) return 'escuro-cinematografico';
  if (a.edgeDensity < 0.03 && a.saturation >= 0.35) return '3d-render';
  return 'foto-real';
}

/** Mede até `max` quadros (JPG/PNG) e devolve as médias + paleta dominante somada. */
export async function artQuant(ffmpeg: string, frames: string[], max = 24, signal?: AbortSignal): Promise<ArtQuant | undefined> {
  const pick = frames.length <= max ? frames : Array.from({ length: max }, (_, i) => frames[Math.floor((i * frames.length) / max)]!);
  const W = 160, H = 90, acc = { brightness: 0, saturation: 0, contrast: 0, edgeDensity: 0, flatness: 0, darkShare: 0, brightShare: 0, warmth: 0 }, all = new Map<number, number>(), bs: number[] = [];
  let n = 0;
  for (const f of pick) {
    try {
      const px = await rawRgb(ffmpeg, f, W, H, signal);
      if (px.length < W * H * 3) continue;
      const a = artOfPixels(px, W, H);
      for (const k of Object.keys(acc) as Array<keyof typeof acc>) acc[k] += a[k];
      bs.push(a.brightness);
      for (const [k, v] of a.hist) all.set(k, (all.get(k) ?? 0) + v);
      n++;
    } catch { /* quadro ilegível */ }
  }
  if (!n) return undefined;
  const avg = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, r2(v / n)])) as typeof acc;
  const palette = [...all.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => '#' + [k >> 8, (k >> 4) & 15, k & 15].map((c) => (c * 17).toString(16).padStart(2, '0')).join(''))
    .filter((c, i, arr) => arr.indexOf(c) === i).slice(0, 6);
  const bm = bs.reduce((x, y) => x + y, 0) / bs.length, bvar = r2(Math.sqrt(bs.reduce((x, y) => x + (y - bm) ** 2, 0) / bs.length));
  const lightKey = avg.darkShare >= 0.4 || avg.brightness < 0.3 ? 'baixa' : avg.brightShare >= 0.3 || avg.brightness > 0.65 ? 'alta' : 'média';
  return { ...avg, palette, artClass: artClass(avg), frames: n, brightnessVar: bvar, lightKey };
}

/* ───────── movimento de câmera ───────── */

function grayFrames(ffmpeg: string, file: string, w: number, h: number, fps: number, maxSec: number, signal?: AbortSignal): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(resolveBin(ffmpeg), ['-v', 'error', '-t', String(maxSec), '-i', file, '-vf', `fps=${fps},scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
    const ch: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => ch.push(d));
    signal?.addEventListener('abort', () => p.kill(), { once: true });
    p.on('error', reject);
    p.on('close', (c) => {
      if (c !== 0) return reject(new Error('ffmpeg ' + c));
      const b = Buffer.concat(ch), size = w * h, out: Uint8Array[] = [];
      for (let o = 0; o + size <= b.length; o += size) out.push(new Uint8Array(b.buffer, b.byteOffset + o, size));
      resolve(out);
    });
  });
}

/** deslocamento (dx, dy) que melhor alinha a região de A com B (busca ±r, amostrando 1 a cada 2 pixels) */
function shiftOf(a: Uint8Array, b: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, r: number): [number, number] {
  let best = Infinity, bx = 0, by = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    let sad = 0, n = 0;
    for (let y = Math.max(y0, r); y < Math.min(y1, h - r); y += 2) for (let x = Math.max(x0, r); x < Math.min(x1, w - r); x += 2) { sad += Math.abs(a[y * w + x]! - b[(y + dy) * w + (x + dx)]!); n++; }
    const v = sad / (n || 1) + (Math.abs(dx) + Math.abs(dy)) * 0.02;
    if (v < best) { best = v; bx = dx; by = dy; }
  }
  return [bx, by];
}

/**
 * Movimento de câmera entre quadros consecutivos (função pura sobre quadros em cinza w×h a fps):
 * deslocamento dos 4 quadrantes → pan/tilt (todos iguais), zoom in/out (afastam/aproximam do centro),
 * câmera na mão (pequeno e mudando de direção), estático. Trocas bruscas contam como corte e são ignoradas.
 */
export function motionFromFrames(frames: Uint8Array[], w: number, h: number, fps: number): MotionQuant {
  const cls = { st: 0, pan: 0, tilt: 0, zin: 0, zout: 0, hand: 0 };
  let cuts = 0, pairs = 0, speed = 0, prevDx = 0;
  const r = Math.max(3, Math.round(w / 32));
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!, b = frames[i]!;
    let mad = 0; for (let k = 0; k < a.length; k += 3) mad += Math.abs(a[k]! - b[k]!);
    if (mad / (a.length / 3) > 38) { cuts++; continue; }
    const hw = w / 2, hh = h / 2;
    const q = [shiftOf(a, b, w, h, 0, 0, hw, hh, r), shiftOf(a, b, w, h, hw, 0, w, hh, r), shiftOf(a, b, w, h, 0, hh, hw, h, r), shiftOf(a, b, w, h, hw, hh, w, h, r)];
    const dx = (q[0]![0] + q[1]![0] + q[2]![0] + q[3]![0]) / 4, dy = (q[0]![1] + q[1]![1] + q[2]![1] + q[3]![1]) / 4;
    /* divergência: no zoom in o conteúdo foge do centro (quadrantes da esquerda andam para a esquerda, da
       direita para a direita…) → div negativo; zoom out → positivo */
    const div = ((q[0]![0] + q[2]![0]) - (q[1]![0] + q[3]![0]) + (q[0]![1] + q[1]![1]) - (q[2]![1] + q[3]![1])) / 4;
    const m = Math.hypot(dx, dy);
    pairs++; speed += (m / w) * 100 * fps;
    if (Math.abs(div) >= 0.75 && Math.abs(div) >= m * 0.6) { if (div < 0) cls.zin++; else cls.zout++; }
    else if (m < 0.75) cls.st++;
    else if (m < 2.5 && Math.sign(dx) !== 0 && Math.sign(dx) === -Math.sign(prevDx)) cls.hand++;
    else if (Math.abs(dx) >= Math.abs(dy)) cls.pan++; else cls.tilt++;
    prevDx = dx;
  }
  const t = pairs || 1, mins = frames.length / fps / 60 || 1;
  return { staticShare: r2(cls.st / t), panShare: r2(cls.pan / t), tiltShare: r2(cls.tilt / t), zoomInShare: r2(cls.zin / t), zoomOutShare: r2(cls.zout / t), handheldShare: r2(cls.hand / t),
    speedPctPerSec: r2(speed / t), cutsPerMin: r1(cuts / mins)! };
}

export async function motionQuant(ffmpeg: string, file: string, maxSec = 300, signal?: AbortSignal): Promise<MotionQuant | undefined> {
  const w = 192, h = 108, fps = 2;
  const frames = await grayFrames(ffmpeg, file, w, h, fps, maxSec, signal);
  return frames.length > 3 ? motionFromFrames(frames, w, h, fps) : undefined;
}

/** O que não dá para medir só pelos pixels: a IA CONTA nas folhas de 1 quadro/s e escreve as porcentagens. */
export const SHOT_COUNT_RULE = 'CONTE nas folhas a 1 quadro por segundo (cada quadro = 1 s) e escreva na skill.md, na Etapa scene_plan, as PORCENTAGENS do tempo de: enquadramento (plano geral/aberto, médio, close, detalhe/macro), ângulo (altura dos olhos, plongée/de cima, contra-plongée/de baixo, zenital/top-down, holandês), tipo de imagem (render 3D, foto, ilustração 2D, gráfico/infográfico, texto na tela) e luz (natural, estúdio, neon/brilho, dramática/contraluz). Some 100% em cada grupo. Use os números medidos de luz e câmera acima como verdade.';

/* ───────── resumo de vários vídeos ───────── */

export interface CloneQuant {
  videos: number;
  durationSec?: number; wpm?: number; cutsPerMin?: number; avgShotSec?: number; wordsPerSentence?: number; secPerFact?: number;
  lufs?: number; speechDb?: number; musicRelDb?: number; musicShare?: number; sfxPerMin?: number; sfxMedianGapSec?: number;
  desc?: Partial<Record<keyof DescQuant, number>>;
  art?: ArtQuant;
  motion?: Partial<Record<keyof MotionQuant, number>>;
  titles?: { avgChars?: number; withNumbers?: number; withQuestion?: number };
}

/** Mediana de cada métrica entre os vídeos (robusta a um vídeo fora da curva). */
export function summarizeQuant(per: Array<{ metrics?: { durationSec?: number; wpm?: number; cutsPerMin?: number; avgShotSec?: number; wordsPerSentence?: number; secPerFact?: number; audio?: { lufs?: number } }; aq?: AudioQuant; dq?: DescQuant; mq?: MotionQuant }>, art?: ArtQuant): CloneQuant {
  const mqs = per.map((p) => p.mq).filter((x): x is MotionQuant => !!x);
  const mk: Array<keyof MotionQuant> = ['staticShare', 'panShare', 'tiltShare', 'zoomInShare', 'zoomOutShare', 'handheldShare', 'speedPctPerSec', 'cutsPerMin'];
  const m = (f: (x: (typeof per)[number]) => number | undefined) => r1(median(per.map(f).filter((x): x is number => typeof x === 'number')));
  const keys: Array<keyof DescQuant> = ['chars', 'words', 'lines', 'paragraphs', 'firstLineChars', 'hashtags', 'links', 'chapters', 'emojis', 'ctas', 'mentions'];
  const dqs = per.map((p) => p.dq).filter((x): x is DescQuant => !!x);
  const withAq = per.filter((p) => p.aq?.musicPresent !== undefined);
  return {
    videos: per.length,
    durationSec: m((p) => p.metrics?.durationSec), wpm: m((p) => p.metrics?.wpm), cutsPerMin: m((p) => p.metrics?.cutsPerMin), avgShotSec: m((p) => p.metrics?.avgShotSec),
    wordsPerSentence: m((p) => p.metrics?.wordsPerSentence), secPerFact: m((p) => p.metrics?.secPerFact), lufs: m((p) => p.metrics?.audio?.lufs),
    speechDb: m((p) => p.aq?.speechDb), musicRelDb: m((p) => (p.aq?.musicPresent ? p.aq.musicRelDb : undefined)),
    musicShare: withAq.length ? r2(withAq.filter((p) => p.aq!.musicPresent).length / withAq.length) : undefined,
    sfxPerMin: m((p) => p.aq?.sfxPerMin), sfxMedianGapSec: m((p) => p.aq?.sfxMedianGapSec),
    desc: dqs.length ? Object.fromEntries(keys.map((k) => [k, r1(median(dqs.map((d) => d[k])))])) : undefined,
    art,
    motion: mqs.length ? Object.fromEntries(mk.map((k) => [k, r2(median(mqs.map((x) => x[k]))!)])) : undefined,
  };
}

/** Texto com os números (para o roteiro/planejador e para a skill). */
export function quantText(q: CloneQuant, label = 'vídeos de referência'): string {
  const L: string[] = [`MÉTRICAS MEDIDAS (mediana de ${q.videos} ${label}) — siga estes números:`];
  const add = (cond: unknown, s: string) => { if (cond !== undefined && cond !== null && cond !== '') L.push(`- ${s}`); };
  add(q.durationSec, `duração: ${q.durationSec} s`);
  add(q.wpm, `fala: ${q.wpm} palavras/min${q.wordsPerSentence ? `, ${q.wordsPerSentence} palavras por frase` : ''}${q.secPerFact ? `, 1 fato novo a cada ${q.secPerFact} s` : ''}`);
  add(q.cutsPerMin, `edição: ${q.cutsPerMin} cortes/min (plano médio ${q.avgShotSec} s)`);
  add(q.speechDb, `voz: ${q.speechDb} dBFS${q.lufs !== undefined ? ` · loudness ${q.lufs} LUFS` : ''}`);
  add(q.musicShare, q.musicShare === 0 ? 'música de fundo: ausente' : `música de fundo: em ${Math.round((q.musicShare ?? 0) * 100)}% dos vídeos${q.musicRelDb !== undefined ? `, ${q.musicRelDb} dB em relação à voz` : ''}`);
  add(q.sfxPerMin, `efeitos sonoros: mediana de ${q.sfxPerMin}/min${q.sfxMedianGapSec ? ` (1 a cada ${q.sfxMedianGapSec} s)` : ''}`);
  if (q.desc) add(q.desc.chars, `descrição: ~${q.desc.chars} caracteres, ${q.desc.lines} linhas, ${q.desc.paragraphs} parágrafos, 1ª linha ${q.desc.firstLineChars} car., ${q.desc.hashtags} hashtags, ${q.desc.links} links, ${q.desc.chapters} capítulos, ${q.desc.emojis} emojis, ${q.desc.ctas} chamadas para ação`);
  if (q.art) add(q.art.artClass, `arte: ${q.art.artClass} · paleta ${q.art.palette.join(' ')} · brilho ${q.art.brightness} · saturação ${q.art.saturation} · contraste ${q.art.contrast} · contornos ${q.art.edgeDensity} · cores chapadas ${q.art.flatness} (0–1)`);
  if (q.art?.lightKey) add(1, 'luz: clave ' + q.art.lightKey + ' · ' + Math.round((q.art.darkShare ?? 0) * 100) + '% da imagem em sombra, ' + Math.round((q.art.brightShare ?? 0) * 100) + '% em alta luz · temperatura ' + ((q.art.warmth ?? 0) > 0.05 ? 'quente' : (q.art.warmth ?? 0) < -0.05 ? 'fria' : 'neutra') + ' (' + q.art.warmth + ') · variação de luz entre cenas ' + q.art.brightnessVar);
  if (q.motion) { const p = (x?: number) => Math.round((x ?? 0) * 100) + '%'; add(1, 'câmera: estática ' + p(q.motion.staticShare) + ' · pan ' + p(q.motion.panShare) + ' · tilt ' + p(q.motion.tiltShare) + ' · zoom in ' + p(q.motion.zoomInShare) + ' · zoom out ' + p(q.motion.zoomOutShare) + ' · na mão ' + p(q.motion.handheldShare) + ' do tempo · velocidade ' + q.motion.speedPctPerSec + '% da largura/s'); }
  return L.join('\n');
}
