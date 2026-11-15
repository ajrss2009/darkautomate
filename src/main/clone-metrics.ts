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
    for (let i = 1; i < w.length; i++) {
      const g0 = w[i - 1]!.end + 0.05, g1 = w[i]!.start - 0.05;
      if (g1 - g0 < 0.25) continue;
      const a = Math.round(g0 * rate), b = Math.round(g1 * rate);
      for (let k = a; k < b && k < s.length; k++) { ge += s[k]! * s[k]!; gn++; }
    }
    if (sn) out.speechDb = db(Math.sqrt(se / sn));
    if (gn > rate * 0.5) out.bedDb = db(Math.sqrt(ge / gn));
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
export function artOfPixels(px: Uint8Array, w: number, h: number): Omit<ArtQuant, 'palette' | 'artClass' | 'frames'> & { hist: Map<number, number> } {
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
  return { brightness: r2(mean / 255), saturation: r2(ss / n), contrast: r2(Math.sqrt(sd / n) / 128), edgeDensity: r2(edges / ((w - 2) * (h - 2))), flatness: r2(top8 / n), hist };
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
  const W = 160, H = 90, acc = { brightness: 0, saturation: 0, contrast: 0, edgeDensity: 0, flatness: 0 }, all = new Map<number, number>();
  let n = 0;
  for (const f of pick) {
    try {
      const px = await rawRgb(ffmpeg, f, W, H, signal);
      if (px.length < W * H * 3) continue;
      const a = artOfPixels(px, W, H);
      for (const k of Object.keys(acc) as Array<keyof typeof acc>) acc[k] += a[k];
      for (const [k, v] of a.hist) all.set(k, (all.get(k) ?? 0) + v);
      n++;
    } catch { /* quadro ilegível */ }
  }
  if (!n) return undefined;
  const avg = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, r2(v / n)])) as typeof acc;
  const palette = [...all.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => '#' + [k >> 8, (k >> 4) & 15, k & 15].map((c) => (c * 17).toString(16).padStart(2, '0')).join(''))
    .filter((c, i, arr) => arr.indexOf(c) === i).slice(0, 6);
  return { ...avg, palette, artClass: artClass(avg), frames: n };
}

/* ───────── resumo de vários vídeos ───────── */

export interface CloneQuant {
  videos: number;
  durationSec?: number; wpm?: number; cutsPerMin?: number; avgShotSec?: number; wordsPerSentence?: number; secPerFact?: number;
  lufs?: number; speechDb?: number; musicRelDb?: number; musicShare?: number; sfxPerMin?: number; sfxMedianGapSec?: number;
  desc?: Partial<Record<keyof DescQuant, number>>;
  art?: ArtQuant;
  titles?: { avgChars?: number; withNumbers?: number; withQuestion?: number };
}

/** Mediana de cada métrica entre os vídeos (robusta a um vídeo fora da curva). */
export function summarizeQuant(per: Array<{ metrics?: { durationSec?: number; wpm?: number; cutsPerMin?: number; avgShotSec?: number; wordsPerSentence?: number; secPerFact?: number; audio?: { lufs?: number } }; aq?: AudioQuant; dq?: DescQuant }>, art?: ArtQuant): CloneQuant {
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
  return L.join('\n');
}
