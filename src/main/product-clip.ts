import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProductClip } from '../shared/types';
import * as ff from './ffmpeg';

/*
 * CLIP DE VENDA DE PRODUTO dentro do vídeo: um vídeo curto (arquivo do usuário ou o final.mp4 de outro projeto, como
 * um UGC feito no app) entra no início, no meio, no fim ou num segundo escolhido — sempre numa FRONTEIRA DE CENA,
 * para não cortar uma fala. O clip é ajustado ao formato do projeto (escala + barras), a 30 fps, e o áudio dele é
 * masterizado em -14 LUFS como o resto. Depois: as legendas .srt andam o tempo do clip e o link/chamada do produto
 * entra na descrição publicada. Funções puras + a montagem com ffmpeg.
 */

/** Segundo de inserção: início = 0, fim = total, meio/segundo = a fronteira de cena mais próxima (nunca no meio de uma cena). */
export function clipInsertAt(boundaries: number[], total: number, position: ProductClip['position']): number {
  if (position === 'start') return 0;
  if (position === 'end') return total;
  const target = position === 'middle' ? total / 2 : Math.max(0, Math.min(total, Number(position) || 0));
  const inner = [...new Set(boundaries.filter((b) => b > 0.05 && b < total - 0.05).map((b) => Math.round(b * 1000) / 1000))];
  if (!inner.length) return position === 'middle' ? total / 2 : target;
  return inner.reduce((best, b) => (Math.abs(b - target) < Math.abs(best - target) ? b : best), inner[0]!);
}

const srtTime = (t: string) => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : 0; };
const fmt = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
/** Legendas depois do ponto de inserção andam `by` segundos (o clip de venda não tem legenda). Função pura. */
export function shiftSrt(srt: string, at: number, by: number): string {
  return srt.replace(/(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/g, (_m, a: string, b: string) => {
    const s = srtTime(a), e = srtTime(b);
    return s >= at - 0.001 ? `${fmt(s + by)} --> ${fmt(e + by)}` : `${a} --> ${b}`;
  });
}

/** Descrição com a chamada + link do produto no topo (não repete se o link já está lá). Função pura. */
export function withProductLink(description: string, info: Pick<ProductClip, 'link' | 'cta' | 'name'> | undefined): string {
  const link = info?.link?.trim();
  if (!link || description.includes(link)) return description;
  const cta = info?.cta?.trim() || (info?.name?.trim() ? `🛍 ${info.name.trim()}:` : '🛍 Produto do vídeo:');
  return `${cta} ${link}${description.trim() ? `\n\n${description.trim()}` : ''}`;
}

/** out/product-clip.json (gravado na montagem): onde o clip entrou e o link — lido na publicação. */
export const productClipInfoFile = (outDir: string) => path.join(outDir, 'product-clip.json');
export function readProductClipInfo(outDir: string): (Pick<ProductClip, 'link' | 'cta' | 'name'> & { at?: number; seconds?: number }) | undefined {
  try { return JSON.parse(fs.readFileSync(productClipInfoFile(outDir), 'utf8')); } catch { return undefined; }
}
/** Descrição para publicar já com o link do clip de venda (se o projeto tem um). */
export const descriptionWithProduct = (outDir: string, description: string) => withProductLink(description, readProductClipInfo(outDir));

async function hasAudio(ffprobe: string, file: string, signal?: AbortSignal): Promise<boolean> {
  try { const r = await ff.run(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], signal); return r.stdout.trim().length > 0; }
  catch { return false; }
}

/**
 * Insere o clip no vídeo final (re-encode): [antes] + [clip] + [depois]. Devolve a duração do clip e o ponto.
 * O áudio do final já está masterizado; o do clip é masterizado aqui (-14 LUFS) — clip mudo ganha silêncio.
 */
export async function insertProductClip(o: { ffmpeg: string; ffprobe: string; final: string; clip: ProductClip; at: number; total: number; w: number; h: number; fps: number; outDir: string; signal?: AbortSignal; log: (l: string) => void }): Promise<{ at: number; seconds: number }> {
  if (!fs.existsSync(o.clip.file)) throw new Error(`clip de venda não encontrado: ${o.clip.file}`);
  const norm = path.join(o.outDir, 'product-clip.norm.mp4');
  /* proporção diferente (ex.: clip vertical num vídeo 16:9): o fundo é o próprio clip ampliado e desfocado, sem barras pretas */
  const vf = `[0:v]split=2[bgsrc][fgsrc];[bgsrc]scale=${o.w}:${o.h}:force_original_aspect_ratio=increase,crop=${o.w}:${o.h},boxblur=24:2,eq=brightness=-0.06[bg];` +
    `[fgsrc]scale=${o.w}:${o.h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=${o.fps},format=yuv420p[v]`;
  const vol = o.clip.volume ?? 1;
  const af = `${vol !== 1 ? `volume=${vol},` : ''}loudnorm=I=-14:TP=-1:LRA=11,aresample=48000`;
  const audio = await hasAudio(o.ffprobe, o.clip.file, o.signal);
  await ff.run(o.ffmpeg, ['-y', '-i', o.clip.file, ...(audio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
    '-filter_complex', vf, '-map', '[v]', '-map', audio ? '0:a:0' : '1:a:0', '-af', af, ...(audio ? [] : ['-shortest']),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', norm], o.signal);
  const seconds = (await ff.duration(o.ffprobe, norm)) || 0;
  if (seconds <= 0.2) throw new Error('clip de venda sem duração (arquivo inválido?)');
  const at = Math.max(0, Math.min(o.total, o.at));
  const same = `scale=${o.w}:${o.h},setsar=1,fps=${o.fps},format=yuv420p`;
  const parts: string[] = [], labels: string[] = [];
  if (at > 0.05) { parts.push(`[0:v]trim=0:${at.toFixed(3)},setpts=PTS-STARTPTS,${same}[v0]`, `[0:a]atrim=0:${at.toFixed(3)},asetpts=PTS-STARTPTS[a0]`); labels.push('[v0][a0]'); }
  parts.push(`[1:v]setpts=PTS-STARTPTS,${same}[vc]`, `[1:a]asetpts=PTS-STARTPTS[ac]`); labels.push('[vc][ac]');
  if (at < o.total - 0.05) { parts.push(`[0:v]trim=start=${at.toFixed(3)},setpts=PTS-STARTPTS,${same}[v1]`, `[0:a]atrim=start=${at.toFixed(3)},asetpts=PTS-STARTPTS[a1]`); labels.push('[v1][a1]'); }
  const graph = `${parts.join(';')};${labels.join('')}concat=n=${labels.length}:v=1:a=1[v][a]`;
  const tmp = path.join(o.outDir, 'final.product.mp4');
  await ff.run(o.ffmpeg, ['-y', '-i', o.final, '-i', norm, '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', tmp], o.signal);
  try { fs.renameSync(tmp, o.final); } catch { fs.copyFileSync(tmp, o.final); fs.rmSync(tmp, { force: true }); }
  fs.rmSync(norm, { force: true });
  /* legendas .srt (publicação/YouTube) andam o tempo do clip */
  for (const f of fs.readdirSync(o.outDir).filter((x) => /\.srt$/i.test(x))) {
    const p = path.join(o.outDir, f);
    try { fs.writeFileSync(p, shiftSrt(fs.readFileSync(p, 'utf8'), at, seconds)); } catch { /* legenda opcional */ }
  }
  fs.writeFileSync(productClipInfoFile(o.outDir), JSON.stringify({ at, seconds, name: o.clip.name, link: o.clip.link, cta: o.clip.cta }, null, 2));
  o.log(`🛍 clip de venda${o.clip.name ? ` "${o.clip.name}"` : ''} (${seconds.toFixed(1)} s) inserido em ${at.toFixed(1)} s`);
  return { at, seconds };
}
