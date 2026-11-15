import { spawn } from 'node:child_process';
import { resolveBin } from './ffmpeg';

/*
 * Visualizador de música desenhado pelo app (sem depender dos filtros do ffmpeg, que somem em músicas calmas):
 * decodifica o áudio, calcula o espectro de cada quadro (FFT, bandas em escala logarítmica, subida rápida e
 * queda suave) e desenha o estilo escolhido num quadro RGBA transparente. Os quadros vão por pipe para o ffmpeg
 * da montagem, que sobrepõe ao vídeo. Funções de desenho são puras (testáveis).
 */

export type VisualizerStyle = 'bars' | 'mirror' | 'circle' | 'peaks' | 'smooth' | 'dots';
/** estilos do app (os demais — line, p2p, cline, dot — continuam no showwaves do ffmpeg) */
export const VISUALIZER_STYLES: Array<{ id: VisualizerStyle; label: string }> = [
  { id: 'bars', label: 'Barras de espectro' },
  { id: 'mirror', label: 'Espectro espelhado (centro)' },
  { id: 'circle', label: 'Círculo de barras' },
  { id: 'peaks', label: 'Barras com picos caindo' },
  { id: 'smooth', label: 'Onda suave (curva do espectro)' },
  { id: 'dots', label: 'Pontos saltando' },
];
export const isAppVisualizer = (s: string | undefined): s is VisualizerStyle => VISUALIZER_STYLES.some((x) => x.id === s);

/** tamanho e posição do visualizador no quadro 1920×1080 */
export function visualizerBox(style: VisualizerStyle): { w: number; h: number; x: string; y: string } {
  if (style === 'circle') return { w: 640, h: 640, x: '(W-w)/2', y: '(H-h)/2' };
  if (style === 'mirror') return { w: 1800, h: 300, x: '(W-w)/2', y: 'H-h-30' };
  return { w: 1800, h: 260, x: '(W-w)/2', y: 'H-h-40' };
}

/* ───────── FFT e bandas ───────── */

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci, xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr; im[b] = im[a]! - xi; re[a] = re[a]! + xr; im[a] = im[a]! + xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/**
 * Energia de `bands` bandas (log de 40 Hz a 16 kHz) no instante t, normalizada 0–1 pelo nível em dB.
 * `samples` é mono a `rate` Hz.
 */
export function spectrumAt(samples: Float32Array, rate: number, t: number, bands: number, size = 2048): number[] {
  const re = new Float64Array(size), im = new Float64Array(size);
  const start = Math.round(t * rate) - size / 2;
  for (let i = 0; i < size; i++) {
    const s = samples[start + i] ?? 0;
    re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));      // janela de Hann
  }
  fft(re, im);
  const out: number[] = [];
  const fMin = 40, fMax = Math.min(16000, rate / 2 - 1);
  for (let b = 0; b < bands; b++) {
    const f0 = fMin * Math.pow(fMax / fMin, b / bands), f1 = fMin * Math.pow(fMax / fMin, (b + 1) / bands);
    const k0 = Math.max(1, Math.floor((f0 * size) / rate)), k1 = Math.max(k0 + 1, Math.ceil((f1 * size) / rate));
    let e = 0;
    for (let k = k0; k < k1 && k < size / 2; k++) e = Math.max(e, Math.hypot(re[k]!, im[k]!));
    const db = 20 * Math.log10(e / (size / 4) + 1e-9);                          // ~0 dB = seno de amplitude 1
    out.push(Math.max(0, Math.min(1, (db + 62) / 56)));                          // −62 dB … −6 dB → 0 … 1
  }
  return out;
}

/* ───────── desenho (RGBA, fundo transparente) ───────── */

type Rgb = [number, number, number];
export function hexColor(hex: string | undefined, fallback: Rgb = [0, 229, 255]): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return fallback;
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function blend(buf: Uint8Array, w: number, h: number, x: number, y: number, c: Rgb, a: number) {
  if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
  const i = (y * w + x) * 4, ia = buf[i + 3]! / 255, na = a + ia * (1 - a);
  for (let k = 0; k < 3; k++) buf[i + k] = Math.round((c[k]! * a + buf[i + k]! * ia * (1 - a)) / (na || 1));
  buf[i + 3] = Math.round(na * 255);
}
function rect(buf: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, top: Rgb, bottom: Rgb, a: number) {
  const ya = Math.max(0, Math.floor(Math.min(y0, y1))), yb = Math.min(h, Math.ceil(Math.max(y0, y1)));
  const xa = Math.max(0, Math.floor(x0)), xb = Math.min(w, Math.ceil(x1));
  for (let y = ya; y < yb; y++) {
    const c = mix(top, bottom, (y - ya) / Math.max(1, yb - ya));
    for (let x = xa; x < xb; x++) blend(buf, w, h, x, y, c, a);
  }
}
function disc(buf: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, c: Rgb, a: number) {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r + 0.5) blend(buf, w, h, x, y, c, a * Math.min(1, r + 0.5 - d));
  }
}
function line(buf: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, c: Rgb, a: number, thick: number) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= n; i++) disc(buf, w, h, x0 + ((x1 - x0) * i) / (n || 1), y0 + ((y1 - y0) * i) / (n || 1), thick / 2, c, a);
}

/** Desenha um quadro do estilo com os níveis (0–1) e os picos (barras com picos caindo). */
export function drawFrame(style: VisualizerStyle, levels: number[], peaks: number[], w: number, h: number, color: Rgb): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  const n = levels.length, light: Rgb = mix(color, [255, 255, 255], 0.55), deep: Rgb = mix(color, [20, 20, 60], 0.35);
  if (style === 'circle') {
    const cx = w / 2, cy = h / 2, r0 = Math.min(w, h) * 0.24, rMax = Math.min(w, h) * 0.24;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2, len = 4 + levels[i]! * rMax;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      line(buf, w, h, cx + cos * r0, cy + sin * r0, cx + cos * (r0 + len), cy + sin * (r0 + len), mix(color, light, levels[i]!), 0.9, 6);
    }
    for (let a = 0; a < 360; a += 0.5) disc(buf, w, h, cx + Math.cos((a * Math.PI) / 180) * (r0 - 6), cy + Math.sin((a * Math.PI) / 180) * (r0 - 6), 1.5, light, 0.8);
    return buf;
  }
  const gap = Math.max(2, Math.round(w / n / 4)), bw = w / n;
  if (style === 'smooth') {
    let px = 0, py = h - 1;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * bw, y = h - 4 - levels[i]! * (h - 12);
      rect(buf, w, h, x - bw / 2, y, x + bw / 2, h, color, deep, 0.25);
      if (i) line(buf, w, h, px, py, x, y, light, 0.95, 5);
      px = x; py = y;
    }
    return buf;
  }
  for (let i = 0; i < n; i++) {
    const x0 = i * bw + gap / 2, x1 = (i + 1) * bw - gap / 2, v = levels[i]!;
    if (style === 'mirror') {
      const mid = h / 2, half = 3 + v * (h / 2 - 6);
      rect(buf, w, h, x0, mid - half, x1, mid, light, color, 0.9);
      rect(buf, w, h, x0, mid, x1, mid + half, color, deep, 0.55);
    } else if (style === 'dots') {
      const cell = Math.max(6, Math.round(bw - gap)), rows = Math.floor(h / cell), on = Math.round(v * rows);
      for (let r = 0; r < on; r++) disc(buf, w, h, (x0 + x1) / 2, h - cell / 2 - r * cell, cell / 2 - 1, mix(color, light, r / Math.max(1, rows)), 0.9);
    } else {
      const top = h - 3 - v * (h - 10);
      rect(buf, w, h, x0, top, x1, h, light, color, 0.9);
      if (style === 'peaks') { const py = h - 3 - (peaks[i] ?? 0) * (h - 10); rect(buf, w, h, x0, py - 6, x1, py - 2, [255, 255, 255], [255, 255, 255], 0.95); }
    }
  }
  return buf;
}

/* ───────── render por pipe ───────── */

/** Áudio inteiro em mono float32 (44,1 kHz). */
export function decodeMono(ffmpeg: string, file: string, rate = 22050, signal?: AbortSignal): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(resolveBin(ffmpeg), ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { windowsHide: true });
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    let err = '';
    p.stderr.on('data', (d) => { err = (err + String(d)).slice(-800); });
    signal?.addEventListener('abort', () => p.kill(), { once: true });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`decodificar áudio falhou: ${err}`));
      const b = Buffer.concat(chunks);
      resolve(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)));
    });
  });
}

/**
 * Gera os quadros do visualizador (fps, duração `seconds`) e escreve no stream (RGBA cru, w×h), respeitando a
 * contrapressão. Níveis com subida rápida e queda suave; picos caem devagar.
 */
export async function writeVisualizer(stream: NodeJS.WritableStream, samples: Float32Array, rate: number, o: { style: VisualizerStyle; seconds: number; fps?: number; color?: string; signal?: AbortSignal }): Promise<void> {
  const fps = o.fps ?? 30, { w, h } = visualizerBox(o.style), color = hexColor(o.color);
  const bands = o.style === 'circle' ? 96 : o.style === 'dots' ? 48 : o.style === 'smooth' ? 72 : 64;
  let lv = new Array<number>(bands).fill(0), pk = new Array<number>(bands).fill(0);
  const frames = Math.ceil(o.seconds * fps);
  for (let f = 0; f < frames; f++) {
    if (o.signal?.aborted) throw new Error('cancelado');
    const s = spectrumAt(samples, rate, f / fps, bands, 2048);
    lv = lv.map((v, i) => (s[i]! > v ? v + (s[i]! - v) * 0.7 : v + (s[i]! - v) * 0.18));
    pk = pk.map((p, i) => Math.max(lv[i]!, p - 0.012));
    const buf = drawFrame(o.style, lv, pk, w, h, color);
    if (!stream.write(Buffer.from(buf.buffer))) await new Promise<void>((r) => stream.once('drain', () => r()));
  }
  stream.end();
}
