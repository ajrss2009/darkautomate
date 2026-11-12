import * as fs from 'node:fs';
import * as path from 'node:path';
import { run } from './ffmpeg';
import { contentWords, sharedWords, titleVerdict, type TitleVerdict } from './title-score';

/*
 * A THUMBNAIL DEPOIS DE PRONTA — o teste que faltava.
 *
 *  - 168×94: o tamanho em que o feed entrega a thumbnail. O app grava essa versão
 *    para o usuário ver o que sobrevive; o que não sobrevive é ruído.
 *  - Brief: no máximo 3 palavras, um ponto focal, paleta com contraste real,
 *    título e thumb dizendo coisas diferentes.
 *
 * Tudo determinístico, sem IA. Visão (Ollama) pode entrar depois como uma
 * checagem a mais — aqui o que dá para medir, é medido.
 */

export const FEED_SIZE = { w: 168, h: 94 };

export interface ThumbCheck {
  id: 'focal' | 'words' | 'contrast' | 'overlap' | 'avoid';
  label: string;
  weight: number;
  score: number;
  ok: boolean;
  detail: string;
}

export interface ThumbBriefInput {
  /** descrição do texto do brief ("2 palavras, Impact branco…") ou o próprio texto */
  textOverlay?: string;
  palette?: string[];
  focal?: string;
  avoid?: string[];
  title?: string;
}

export interface ThumbScore {
  score: number;
  verdict: TitleVerdict;
  checks: ThumbCheck[];
  /** quantidade de palavras do texto da thumbnail, quando dá para saber */
  words?: number;
  /** texto da thumbnail, quando o brief traz entre aspas */
  text?: string;
}

export interface ThumbQa extends ThumbScore {
  title: string;
  /** arquivo 168×94 gerado (o teste do feed) */
  mobile?: string;
  checkedAt: string;
}

/** Luminância relativa (WCAG) de uma cor hex. */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return 0;
  const n = parseInt(h, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** Contraste WCAG entre duas cores (1 = nenhum, 21 = preto × branco). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Quantas palavras o texto da thumbnail tem.
 * O brief costuma descrever ("2 palavras, fonte bold"), então primeiro lê o número
 * declarado; depois o texto entre aspas; por último, um texto curto e cru.
 */
export function overlayWordCount(textOverlay: string | undefined): number | undefined {
  const s = textOverlay?.trim();
  if (!s) return undefined;
  const declared = /(\d+)\s*palavra/i.exec(s);
  if (declared) return Number(declared[1]);
  const quoted = /["“'‘]([^"”'’]+)["”'’]/.exec(s);
  if (quoted) return (quoted[1]!.trim().split(/\s+/).filter(Boolean)).length;
  if (/[,;:·|]/.test(s) || s.length > 40) return undefined;   // é descrição, não texto
  const n = s.split(/\s+/).filter(Boolean).length;
  return n <= 3 ? n : undefined;
}

/** Texto entre aspas do brief (o que realmente vai na imagem), se houver. */
export function overlayText(textOverlay: string | undefined): string | undefined {
  const quoted = /["“'‘]([^"”'’]+)["”'’]/.exec(textOverlay ?? '');
  return quoted?.[1]?.trim() || undefined;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Nota do brief da thumbnail (o que dá para medir sem enxergar a imagem). */
export function scoreThumbBrief(input: ThumbBriefInput): ThumbScore {
  const text = overlayText(input.textOverlay);
  const words = overlayWordCount(input.textOverlay);
  const checks: ThumbCheck[] = [];

  /* um ponto focal só */
  const focal = input.focal?.trim();
  checks.push({
    id: 'focal', label: 'um ponto focal', weight: 10, score: focal ? 10 : 0, ok: !!focal,
    detail: focal ? focal.slice(0, 120) : 'sem ponto focal declarado',
  });

  /* no máximo 3 palavras (0 palavra também passa: thumb sem texto é válida) */
  const wScore = words === undefined ? -1 : words <= 3 ? (words === 0 ? 24 : 30) : words === 4 ? 12 : 0;
  checks.push({
    id: 'words', label: 'texto com até 3 palavras', weight: wScore < 0 ? 0 : 30, score: Math.max(0, wScore), ok: wScore < 0 || words! <= 3,
    detail: words === undefined ? 'texto não declarado (não medido)' : `${words} palavra(s)${words > 3 ? ' — o feed corta' : ''}`,
  });

  /* paleta com contraste real (WCAG ≥ 4,5:1 entre as duas cores mais distantes) */
  const pal = (input.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  let ratio = 0;
  for (let i = 0; i < pal.length; i++) for (let j = i + 1; j < pal.length; j++) ratio = Math.max(ratio, contrastRatio(pal[i]!, pal[j]!));
  const cScore = pal.length < 2 ? -1 : ratio >= 4.5 ? 30 : ratio >= 3 ? 20 : 8;
  checks.push({
    id: 'contrast', label: 'contraste do texto/overlay', weight: cScore < 0 ? 0 : 30, score: Math.max(0, cScore), ok: cScore < 0 || cScore >= 20,
    detail: cScore < 0 ? 'paleta não declarada (não medido)' : `${ratio.toFixed(1)}:1${ratio >= 4.5 ? '' : ' — abaixo de 4,5:1'}`,
  });

  /* título e thumb dizem coisas diferentes */
  const title = input.title?.trim();
  const declared = /palavra/i.test(input.textOverlay ?? '');
  const thumbText = text ?? (words !== undefined && words > 0 && words <= 3 && !declared ? input.textOverlay?.trim() : undefined);
  let oScore = -1, overlap: string[] = [];
  if (title && thumbText) {
    overlap = sharedWords(title, thumbText);
    oScore = overlap.length === 0 ? 20 : overlap.length === 1 ? 10 : 0;
  }
  checks.push({
    id: 'overlap', label: 'não repete o título', weight: oScore < 0 ? 0 : 20, score: Math.max(0, oScore), ok: oScore < 0 || oScore >= 10,
    detail: oScore < 0 ? 'sem texto de thumbnail para comparar (não medido)' : overlap.length ? `repete: ${overlap.join(', ')}` : 'thumb acrescenta o que o título não diz',
  });

  /* o que evitar, declarado */
  const avoid = (input.avoid ?? []).filter((x) => x.trim()).length;
  checks.push({
    id: 'avoid', label: 'o que evitar declarado', weight: 10, score: avoid >= 3 ? 10 : avoid ? 5 : 0, ok: avoid >= 3,
    detail: avoid ? `${avoid} item(ns)` : 'o brief não diz o que evitar',
  });

  const applicable = checks.reduce((a, c) => a + c.weight, 0);
  const earned = checks.reduce((a, c) => a + c.score, 0);
  const score = applicable ? clamp(Math.round((earned / applicable) * 100), 0, 100) : 100;
  return { score, verdict: titleVerdict(score), checks, words, text };
}

/**
 * O TESTE DO FEED: reduz a thumbnail pronta para 168×94 e grava o arquivo.
 * É o tamanho em que o YouTube mostra a imagem na lista de vídeos.
 */
export async function renderFeedSize(ffmpeg: string, thumb: string, out: string, signal?: AbortSignal): Promise<string> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await run(ffmpeg, ['-y', '-i', thumb, '-vf', `scale=${FEED_SIZE.w}:${FEED_SIZE.h}:force_original_aspect_ratio=decrease,pad=${FEED_SIZE.w}:${FEED_SIZE.h}:(ow-iw)/2:(oh-ih)/2:color=black`, '-frames:v', '1', out], signal);
  return out;
}

/** Mede a thumbnail final: brief (se houver) + arquivo do feed; grava `<outDir>/thumb-qa.json`. */
export async function checkThumb(ffmpeg: string, o: { thumb: string; outDir: string; brief?: ThumbBriefInput; title: string; signal?: AbortSignal }): Promise<ThumbQa> {
  const brief = scoreThumbBrief({ ...(o.brief ?? {}), title: o.title });
  let mobile: string | undefined;
  try { mobile = await renderFeedSize(ffmpeg, o.thumb, path.join(o.outDir, 'thumb-168x94.png'), o.signal); } catch { /* sem ffmpeg: o brief ainda vale */ }
  const qa: ThumbQa = { ...brief, title: o.title, mobile, checkedAt: new Date().toISOString() };
  try {
    fs.mkdirSync(o.outDir, { recursive: true });
    fs.writeFileSync(path.join(o.outDir, 'thumb-qa.json'), JSON.stringify(qa, null, 1));
  } catch { /* o log ainda leva o resultado */ }
  return qa;
}

/** Linha curta para o log. */
export function thumbQaLine(q: ThumbQa): string {
  const bad = q.checks.filter((c) => !c.ok).map((c) => c.label);
  return `QA da thumbnail: ${q.score}/100 (${q.verdict})${bad.length ? ` — reprova: ${bad.join(', ')}` : ' — passa no brief e no feed'}${q.mobile ? ` · teste do feed em ${path.basename(q.mobile)}` : ''}`;
}

/** Palavras do texto do brief (para a UI mostrar "3 palavras"). */
export { contentWords };
