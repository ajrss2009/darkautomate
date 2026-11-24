import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * ÍNDICE DO BANCO DE MÍDIA (catálogo, Parte XX — "pasta → índice → grade → encaixe"): para cada arquivo da pasta,
 * ffprobe (duração, resolução, rotação, fps), hash rápido (sha256 do tamanho + 1º e último MB), hash perceptual
 * (dHash 64 bits do quadro do meio), cor média e 3 cores dominantes, e movimento (diferença média entre quadros).
 * Fica em <pasta>/.filmforge-index.json e só recalcula o arquivo que mudou (tamanho/data).
 */
export interface MediaMeta {
  size: number; mtime: number;
  duration?: number; width?: number; height?: number; rotation?: number; fps?: number;
  qsha?: string; dhash?: string;
  /** cor média e dominantes em hex */
  avg?: string; colors?: string[];
  /** 0..1 — quanto a imagem muda entre quadros (vídeo); imagem = 0 */
  motion?: number;
  error?: string;
}
export type MediaIndex = Record<string, MediaMeta>;
export const indexFile = (dir: string) => path.join(dir, '.filmforge-index.json');

export function loadIndex(dir: string): MediaIndex {
  try { const j = JSON.parse(fs.readFileSync(indexFile(dir), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
export function saveIndex(dir: string, idx: MediaIndex): void {
  try { fs.writeFileSync(indexFile(dir), JSON.stringify(idx)); } catch { /* pasta só leitura: índice só em memória */ }
}

/** sha256 de tamanho + primeiro e último MB: igual = mesmo arquivo, mesmo com outro nome. */
export function quickSha(file: string): string {
  const st = fs.statSync(file);
  const h = crypto.createHash('sha256').update(String(st.size));
  const fd = fs.openSync(file, 'r');
  try {
    const n = Math.min(st.size, 1 << 20);
    const a = Buffer.alloc(n); fs.readSync(fd, a, 0, n, 0); h.update(a);
    if (st.size > n) { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); h.update(b); }
  } finally { fs.closeSync(fd); }
  return h.digest('hex').slice(0, 32);
}

/** dHash 64 bits de um quadro 9×8 em cinza (hex). Função pura. */
export function dHash(gray9x8: Uint8Array | Buffer): string {
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray9x8[y * 9 + x]! > gray9x8[y * 9 + x + 1]! ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16); while (x) { d += x & 1; x >>= 1; } }
  return d + Math.abs(a.length - b.length) * 4;
}
/** Mesmo arquivo (hash) ou quase a mesma imagem (dHash a ≤ 6 bits) — "não repetir" pega cópias renomeadas e reexportadas. */
export function nearDuplicate(a: MediaMeta | undefined, b: MediaMeta | undefined): boolean {
  if (!a || !b) return false;
  if (a.qsha && a.qsha === b.qsha) return true;
  return !!a.dhash && !!b.dhash && hamming(a.dhash, b.dhash) <= 6;
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export function rgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** distância de cor 0..1 (RGB ponderado ~ percepção). Função pura. */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const d = Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
  return Math.min(1, d / 765);
}
/** Cor média + 3 dominantes de um quadro pequeno RGB (k-means de 3 passos). Função pura. */
export function palette(rgb24: Uint8Array | Buffer): { avg: string; colors: string[] } {
  const px: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < rgb24.length; i += 3) px.push([rgb24[i]!, rgb24[i + 1]!, rgb24[i + 2]!]);
  if (!px.length) return { avg: '#808080', colors: [] };
  const mean = px.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => v / px.length) as [number, number, number];
  let cs: Array<[number, number, number]> = [px[0]!, px[Math.floor(px.length / 2)]!, px[px.length - 1]!];
  let counts = [0, 0, 0];
  for (let it = 0; it < 4; it++) {
    const acc = cs.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      cs.forEach((c, i) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; bi = i; } });
      const a = acc[bi]!; a[0]! += p[0]; a[1]! += p[1]; a[2]! += p[2]; a[3]! += 1;
    }
    cs = acc.map((a, i) => (a[3]! ? [a[0]! / a[3]!, a[1]! / a[3]!, a[2]! / a[3]!] : cs[i]!)) as Array<[number, number, number]>;
    counts = acc.map((a) => a[3]!);
  }
  const order = [0, 1, 2].sort((a, b) => counts[b]! - counts[a]!);
  return { avg: hex(...mean), colors: order.map((i) => hex(...cs[i]!)) };
}

function raw(ffmpeg: string, args: string[]): Buffer {
  return execFileSync(ffmpeg, ['-v', 'error', ...args, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26, windowsHide: true, timeout: 60_000 });
}

/** Mede um arquivo (síncrono). Erro de leitura vira `error` no índice (o arquivo segue escolhível só por nome). */
export function measure(ffmpeg: string, ffprobe: string, file: string, kind: 'image' | 'video'): MediaMeta {
  const st = fs.statSync(file);
  const m: MediaMeta = { size: st.size, mtime: Math.round(st.mtimeMs) };
  try {
    m.qsha = quickSha(file);
    const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:stream_side_data=rotation:stream_tags=rotate:format=duration', '-of', 'json', file], { windowsHide: true, timeout: 30_000 }).toString());
    const s = j.streams?.[0] ?? {};
    m.width = Number(s.width) || undefined; m.height = Number(s.height) || undefined;
    const rot = Number(s.side_data_list?.find((d: { rotation?: number }) => d.rotation !== undefined)?.rotation ?? s.tags?.rotate ?? 0);
    if (rot) m.rotation = rot;
    if (kind === 'video') {
      m.duration = Number(j.format?.duration) || undefined;
      const [a, b] = String(s.r_frame_rate ?? '').split('/').map(Number);
      if (a && b) m.fps = Math.round((a / b) * 100) / 100;
    }
    const at = kind === 'video' && m.duration ? ['-ss', String(Math.max(0, m.duration / 2))] : [];
    m.dhash = dHash(raw(ffmpeg, [...at, '-i', file, '-frames:v', '1', '-vf', 'scale=9:8:flags=area,format=gray', '-pix_fmt', 'gray']));
    Object.assign(m, palette(raw(ffmpeg, [...at, '-i', file, '-frames:v', '1', '-vf', 'scale=8:8:flags=area', '-pix_fmt', 'rgb24'])));
    if (kind === 'video') {
      const fr = raw(ffmpeg, ['-i', file, '-t', '8', '-vf', 'fps=2,scale=32:18:flags=area,format=gray', '-pix_fmt', 'gray']);
      const N = 32 * 18, n = Math.floor(fr.length / N);
      let d = 0;
      for (let k = 1; k < n; k++) for (let i = 0; i < N; i++) d += Math.abs(fr[k * N + i]! - fr[(k - 1) * N + i]!);
      m.motion = n > 1 ? Math.round(Math.min(1, d / ((n - 1) * N * 255) * 6) * 1000) / 1000 : 0;
    } else m.motion = 0;
  } catch (e) { m.error = (e as Error).message.split('\n')[0]!.slice(0, 160); }
  return m;
}

/** Meta do arquivo pelo índice (recalcula se mudou); `dirty` avisa para gravar o índice. */
export function metaOf(idx: MediaIndex, bankDir: string, rel: string, kind: 'image' | 'video', tools: { ffmpeg: string; ffprobe: string }): { meta: MediaMeta; dirty: boolean } {
  const file = path.join(bankDir, rel);
  const st = fs.statSync(file);
  const old = idx[rel];
  if (old && old.size === st.size && old.mtime === Math.round(st.mtimeMs)) return { meta: old, dirty: false };
  const meta = measure(tools.ffmpeg, tools.ffprobe, file, kind);
  idx[rel] = meta;
  return { meta, dirty: true };
}

/**
 * Pontuação do catálogo: 0,35·encaixe + 0,30·paleta + 0,25·movimento + 0,10·ineditismo (0..1). Função pura.
 * encaixe = texto da cena (0..1) e, no vídeo, duração ≥ cena; paleta = perto da cor do plano anterior (continuidade)
 * ou da paleta do projeto; movimento = o vídeo tem ação (imagem = neutro); ineditismo = nunca usado em outro vídeo.
 */
export function catalogScore(o: { text: number; meta?: MediaMeta; kind: 'image' | 'video'; sceneSec?: number; targetColor?: string; usedElsewhere?: boolean }): number {
  const m = o.meta;
  const durFit = o.kind === 'video' && m?.duration && o.sceneSec ? Math.min(1, m.duration / o.sceneSec) : 1;
  const encaixe = 0.7 * o.text + 0.3 * durFit;
  const paleta = o.targetColor && m?.avg ? 1 - colorDistance(o.targetColor, m.avg) : 0.5;
  const mov = o.kind === 'video' ? (m?.motion !== undefined ? Math.min(1, 0.3 + m.motion * 2) : 0.5) : 0.5;
  const ined = o.usedElsewhere ? 0 : 1;
  return Math.round((0.35 * encaixe + 0.3 * paleta + 0.25 * mov + 0.1 * ined) * 1000) / 1000;
}
