import { execFile } from 'node:child_process';
import type { Project, StyleRef } from '../shared/types';

/*
 * ESTILO A PARTIR DE UMA IMAGEM (Novo projeto → "🖼 Estilo de uma imagem"):
 *  - a paleta é MEDIDA nos pixels (ffmpeg reduz a imagem e o app agrupa as cores: k-means simples);
 *  - a IA (harness que abre imagens, ou modelo de visão local no Ollama) descreve o estilo: técnica/meio, luz,
 *    traço, textura, enquadramento — um "style prompt" para os modelos de imagem/vídeo, o que evitar e etiquetas;
 *  - o projeto guarda o estilo (project.styleRef) e ele entra em todas as cenas (imagem, vídeo, thumbnail, código).
 * Só o ESTILO vem da imagem: personagens, marcas e textos dela não são copiados.
 */

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** Agrupa pixels RGB (buffer rgb24) em até k cores, da mais frequente para a menos (função pura, determinística). */
export function paletteFromPixels(buf: Uint8Array, k = 5): string[] {
  const px: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < buf.length; i += 3) px.push([buf[i]!, buf[i + 1]!, buf[i + 2]!]);
  if (!px.length) return [];
  /* sementes: pixels espalhados pela ordem de luminância (determinístico) */
  const byLum = [...px].sort((a, b) => (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11) - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
  let cents = Array.from({ length: Math.min(k, px.length) }, (_, i) => [...byLum[Math.floor(((i + 0.5) / k) * byLum.length)]!] as [number, number, number]);
  let groups: number[] = [];
  for (let it = 0; it < 12; it++) {
    groups = px.map((p) => { let best = 0, bd = Infinity; cents.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } }); return best; });
    cents = cents.map((c, j) => {
      const m = px.filter((_, i) => groups[i] === j);
      return m.length ? [m.reduce((a, p) => a + p[0], 0) / m.length, m.reduce((a, p) => a + p[1], 0) / m.length, m.reduce((a, p) => a + p[2], 0) / m.length] as [number, number, number] : c;
    });
  }
  const counts = cents.map((_, j) => groups.filter((g) => g === j).length);
  const out: string[] = [];
  cents.map((c, j) => ({ c, n: counts[j]! })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).forEach(({ c }) => {
    /* junta tons quase iguais */
    if (!out.some((h) => { const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16); return Math.abs(r - c[0]) + Math.abs(g - c[1]) + Math.abs(b - c[2]) < 36; })) out.push(hex(...c));
  });
  return out;
}

/** Mede a paleta da imagem com o ffmpeg (24×24 px, rgb24). */
export function measurePalette(ffmpeg: string, file: string, k = 5): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-v', 'error', '-i', file, '-vf', 'scale=24:24:flags=area', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 20, windowsHide: true },
      (err, stdout) => resolve(err || !stdout?.length ? [] : paletteFromPixels(new Uint8Array(stdout), k)));
  });
}

/** Pedido à IA de visão (o arquivo é aberto pelo harness ou enviado ao modelo local). */
export function styleRequest(imageName: string, measured: string[]): string {
  return `Abra e OLHE a imagem "${imageName}". Descreva SÓ o ESTILO VISUAL dela para outro modelo reproduzir em imagens e vídeos novos (não descreva o assunto, as pessoas, marcas ou textos da imagem).
Cores medidas nos pixels: ${measured.join(', ') || 'não medidas'}.
Responda SOMENTE com JSON:
{
  "stylePrompt": "2–3 frases em INGLÊS para modelos de imagem/vídeo: técnica e meio (foto, 3D, aquarela, anime, pixel art…), luz, contraste, saturação, textura/granulação, traço/contorno, lente/profundidade, composição",
  "avoid": "o que NÃO fazer para não quebrar o estilo (inglês, curto)",
  "medium": "meio/técnica em português (ex.: render 3D estilizado, foto analógica, aquarela)",
  "lighting": "luz em português (ex.: contraluz dourada, neon frio, luz suave de estúdio)",
  "tags": ["4 a 8 etiquetas curtas em português"],
  "palette": ["#hex", "#hex", "#hex", "#hex", "#hex"]
}`;
}

const s = (v: unknown, n = 600) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, n) : undefined);

/** Normaliza o estilo (paleta: a da IA se válida, senão a medida). Função pura. */
export function normalizeStyleRef(raw: unknown, measured: string[], file?: string, by?: string): StyleRef {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const stylePrompt = s(o['stylePrompt'], 700);
  if (!stylePrompt) throw new Error('a IA não descreveu o estilo da imagem');
  const pal = Array.isArray(o['palette']) ? (o['palette'] as unknown[]).map(String).filter((x) => /^#[0-9a-f]{6}$/i.test(x)).map((x) => x.toLowerCase()) : [];
  return { file, stylePrompt, avoid: s(o['avoid'], 300), medium: s(o['medium'], 80), lighting: s(o['lighting'], 120),
    tags: Array.isArray(o['tags']) ? (o['tags'] as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : undefined,
    palette: (pal.length >= 3 ? pal : measured).slice(0, 6), by, at: new Date().toISOString() };
}

/** Normaliza o estilo editado na interface (texto do usuário). */
export function userStyleRef(raw: Partial<StyleRef> | undefined): StyleRef | undefined {
  if (!raw) return undefined;
  const stylePrompt = s(raw.stylePrompt, 700);
  if (!stylePrompt) return undefined;
  return { file: s(raw.file, 400), stylePrompt, avoid: s(raw.avoid, 300), medium: s(raw.medium, 80), lighting: s(raw.lighting, 120),
    tags: Array.isArray(raw.tags) ? raw.tags.map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : undefined,
    palette: Array.isArray(raw.palette) ? raw.palette.filter((x) => /^#[0-9a-f]{6}$/i.test(String(x))).slice(0, 6) : undefined, by: s(raw.by, 60), at: raw.at ?? new Date().toISOString() };
}

const PLAN = new Set(['brief', 'ideation', 'script', 'scene_plan', 'asset_design']);
const CODE = new Set(['code_scene', 'motion_graphics', 'free']);

/** Bloco do estilo para o prompt de cada etapa (função pura). */
export function styleBlock(p: Pick<Project, 'styleRef'>, stepKind: string): string {
  const st = p.styleRef;
  if (!st) return '';
  const pal = st.palette?.length ? st.palette.join(', ') : '';
  if (PLAN.has(stepKind) || CODE.has(stepKind)) {
    return `ESTILO VISUAL DO PROJETO (extraído de uma imagem de referência do usuário — vale para TODAS as cenas; copie só o estilo, nunca o conteúdo da imagem):\n` +
      [`- ${st.stylePrompt}`, st.medium && `- meio/técnica: ${st.medium}`, st.lighting && `- luz: ${st.lighting}`, pal && `- paleta: ${pal}`, st.avoid && `- evite: ${st.avoid}`, st.tags?.length && `- etiquetas: ${st.tags.join(', ')}`]
        .filter(Boolean).join('\n') + (CODE.has(stepKind) ? '\nNo código: use essas cores, essa luz e esse acabamento (traço, textura, sombra).' : '');
  }
  return '';
}

/** Trecho em inglês para os prompts de imagem/vídeo/thumbnail. */
export const styleVisual = (p: Pick<Project, 'styleRef'>) => p.styleRef ? `Visual style (follow exactly): ${p.styleRef.stylePrompt}${p.styleRef.palette?.length ? ` Palette: ${p.styleRef.palette.join(', ')}.` : ''}` : '';
/** O que evitar (vai no negativo dos modelos que aceitam). */
export const styleNegative = (p: Pick<Project, 'styleRef'>) => p.styleRef?.avoid ?? '';
