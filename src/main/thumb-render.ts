import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, Settings, ThumbnailTemplate } from '../shared/types';
import { THUMB_DESIGN_TEMPLATES, thumbPage, thumbTree, type ThumbDesign } from '../shared/thumbdesign';
import * as ff from './ffmpeg';

/** Foto de uma página HTML parada (render.ts → snapHtml). */
export type SnapHtml = (htmlFile: string, out: string, o: { w: number; h: number }) => Promise<void>;

/** Templates de thumbnail: os do usuário/IA + os visuais que vêm com o app. */
export function allThumbTemplates(s: Settings): ThumbnailTemplate[] {
  const mine = s.thumbnails ?? [];
  return [...mine, ...THUMB_DESIGN_TEMPLATES.filter((t) => !mine.some((m) => m.id === t.id))];
}

/** Desenho da thumbnail do projeto: o do estúdio (projeto) vence o do template. */
export function projectThumbDesign(s: Settings, p: Project): ThumbDesign | undefined {
  if (p.thumbDesign) return p.thumbDesign;
  return allThumbTemplates(s).find((t) => t.id === p.thumbnailTemplate)?.design;
}

/** Tamanho da thumbnail: 1280×720 no 16:9 (padrão do YouTube); capa vertical/quadrada no tamanho do vídeo. */
export const thumbSize = (aspect: Project['aspect']) => (aspect === '16:9' || !aspect ? { w: 1280, h: 720 } : ff.resolution(aspect));

/** Texto da thumbnail: o do desenho, o do SEO (metadata.json) ou as 3 primeiras palavras do título. */
export function thumbText(projectDir: string, p: Project, d?: ThumbDesign): string {
  if (d?.text?.trim()) return d.text.trim();
  try { const m = JSON.parse(fs.readFileSync(path.join(projectDir, 'out', 'metadata.json'), 'utf8')) as { thumbnailText?: string }; if (m.thumbnailText?.trim()) return m.thumbnailText.trim(); } catch { /* sem SEO */ }
  return (p.titleModel?.thumbText || p.name).split(/\s+/).slice(0, 3).join(' ');
}

/** Instante "bom" para o fundo: meio da cena visual mais longa, senão 35% do vídeo. */
export function autoFrameTime(p: Project, total: number): number {
  let t = total * 0.35, acc = 0, best = -1;
  for (const s of p.scenes) {
    const d = s.durationSec ?? 4;
    if ((s.kind === 'video' || s.kind === 'image' || s.kind === 'stock' || s.kind === 'code') && d > best) { best = d; t = acc + d / 2; }
    acc += d;
  }
  return Math.max(0, Math.min(t, Math.max(0, total - 0.1)));
}

/**
 * Nota de um quadro pequeno (RGB): colorido e com luz (Hasler–Süsstrunk) vale mais; quase preto (cartela, fade)
 * ou lavado vale pouco. Função pura.
 */
export function frameScore(rgb: Uint8Array): number {
  let rg = 0, yb = 0, rg2 = 0, yb2 = 0, lum = 0, n = 0;
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const r = rgb[i]!, g = rgb[i + 1]!, b = rgb[i + 2]!;
    const a = r - g, c = 0.5 * (r + g) - b;
    rg += a; yb += c; rg2 += a * a; yb2 += c * c; lum += 0.2126 * r + 0.7152 * g + 0.0722 * b; n++;
  }
  if (!n) return 0;
  const mrg = rg / n, myb = yb / n, srg = Math.sqrt(Math.max(0, rg2 / n - mrg * mrg)), syb = Math.sqrt(Math.max(0, yb2 / n - myb * myb));
  const colorful = Math.sqrt(srg * srg + syb * syb) + 0.3 * Math.sqrt(mrg * mrg + myb * myb);
  const L = lum / n / 255;
  const light = L < 0.12 ? L / 0.12 * 0.3 : L > 0.88 ? 0.5 : 1;   // escuro demais quase zera
  return colorful * light;
}

/** Instantes candidatos: o meio de cada cena (até 10) + 25/50/75% do vídeo. */
export function frameCandidates(p: Project, total: number): number[] {
  const out: number[] = []; let acc = 0;
  for (const s of p.scenes) { const d = s.durationSec ?? 4; out.push(acc + d / 2); acc += d; }
  const step = Math.max(1, Math.ceil(out.length / 10));
  const pick = out.filter((_, i) => i % step === 0);
  for (const f of [0.25, 0.5, 0.75]) pick.push(total * f);
  return [...new Set(pick.map((t) => Math.round(Math.max(0.5, Math.min(t, total - 0.2)) * 10) / 10))].filter((t) => t >= 0 && t <= total);
}

/** Escolhe o quadro mais "thumb" (colorido, claro, sem cartela preta) entre os candidatos. */
export async function bestFrameTime(ffmpeg: string, video: string, p: Project, total: number, workDir: string, signal?: AbortSignal): Promise<number> {
  const cands = frameCandidates(p, total);
  fs.mkdirSync(workDir, { recursive: true });
  let best = autoFrameTime(p, total), bestScore = -1;
  for (const [i, t] of cands.entries()) {
    const f = path.join(workDir, `cand-${i}.ppm`);
    try {
      await ff.run(ffmpeg, ['-y', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=48:27', '-f', 'image2', '-c:v', 'ppm', f], signal);
      const buf = fs.readFileSync(f);
      /* cabeçalho P6: "P6\n48 27\n255\n" — os bytes RGB vêm depois do 3º fim de linha */
      let nl = 0, at = 0; while (at < buf.length && nl < 3) { if (buf[at] === 10) nl++; at++; }
      const sc = frameScore(new Uint8Array(buf.subarray(at)));
      if (sc > bestScore) { bestScore = sc; best = t; }
    } catch { /* candidato ruim: ignora */ }
    finally { fs.rmSync(f, { force: true }); }
  }
  return best;
}

/** Extrai um quadro do vídeo final (JPEG) para o fundo. */
export async function grabFrame(ffmpeg: string, video: string, t: number, out: string, signal?: AbortSignal): Promise<string> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await ff.run(ffmpeg, ['-y', '-ss', Math.max(0, t).toFixed(2), '-i', video, '-frames:v', '1', '-q:v', '2', out], signal);
  return out;
}

/**
 * Desenha a thumbnail do projeto com o layout `design` e grava `out` (PNG). Fundo = `bgFile` (imagem da IA) ou
 * quadros do vídeo final (design.frame / automático; o "split" usa dois).
 */
export async function renderThumb(o: { settings: Settings; snap: SnapHtml; projectDir: string; project: Project; design: ThumbDesign; out: string; bgFile?: string; signal?: AbortSignal }): Promise<{ file: string; text: string; frames: number[] }> {
  const { settings: s, project: p, design: d } = o;
  const work = path.join(o.projectDir, 'out', 'thumb-work');
  fs.mkdirSync(work, { recursive: true });
  const final = path.join(o.projectDir, 'out', 'final.mp4');
  const frames: number[] = [];
  let bg1: string | undefined, bg2: string | undefined;
  if (o.bgFile && fs.existsSync(o.bgFile)) {
    bg1 = path.join(work, `bg-ia${path.extname(o.bgFile)}`); fs.copyFileSync(o.bgFile, bg1);
  } else if (fs.existsSync(final)) {
    const total = await ff.duration(s.ffprobe, final).catch(() => 0);
    const t1 = d.frame ?? await bestFrameTime(s.ffmpeg, final, p, total, work, o.signal);
    frames.push(t1);
    bg1 = await grabFrame(s.ffmpeg, final, t1, path.join(work, 'bg1.jpg'), o.signal);
    if (d.layout === 'split') {
      const t2 = d.frame2 ?? Math.min(Math.max(0, total - 0.5), t1 < total / 2 ? total * 0.85 : total * 0.15);
      frames.push(t2);
      bg2 = await grabFrame(s.ffmpeg, final, t2, path.join(work, 'bg2.jpg'), o.signal);
    }
  }
  const { w, h } = thumbSize(p.aspect);
  const text = thumbText(o.projectDir, p, d);
  const html = path.join(work, 'thumb.html');
  fs.writeFileSync(html, thumbPage(thumbTree(d, { w, h, text, bg: bg1 && path.basename(bg1), bg2: bg2 && path.basename(bg2) }), w, h), 'utf8');
  await o.snap(html, o.out, { w, h });
  return { file: o.out, text, frames };
}
