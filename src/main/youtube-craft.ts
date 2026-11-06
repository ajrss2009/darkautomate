import { httpFetch } from './http';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HarnessId, Settings, ThumbnailTemplate } from '../shared/types';
import { activeAgyEnv } from './automations';
import { listChannel, listChannelClones } from './channel-clone';
import { llmJson } from './editor';
import { isHttpHarness, resolveHarness, runHarness } from './harness';
import { slugify } from './library';
import { ensureYtDlp } from './youtube';

/*
 * Títulos e thumbnails "no padrão" de um canal ou vídeo de referência.
 *  - Títulos: a ESTRUTURA dos títulos da referência (medida aqui, sem IA) + as regras de CTR guiam a IA,
 *    que escreve títulos novos para a ideia do projeto (busca, navegação e híbrido).
 *  - Thumbnail: as thumbnails da referência (canal clonado, canal, vídeo ou link) são baixadas e uma IA com
 *    visão escreve um template de thumbnail do FilmForge + um brief (ponto focal, texto, paleta em hex,
 *    composição, legibilidade no celular, o que evitar e 3 variantes A/B).
 * Regras de título/thumbnail/retenção adaptadas de "claude-youtube" (Daniel Agrici, licença MIT —
 * https://github.com/AgriciDaniel/claude-youtube).
 */

import { RETENTION_RULES, THUMB_RULES, TITLE_RULES } from './youtube-rules';
export { RETENTION_RULES, THUMB_RULES, TITLE_RULES };


/* ───────── origem: canal clonado, canal, vídeo, link ou arquivo ───────── */

export type CraftSource =
  | { kind: 'clone'; id: string }
  | { kind: 'channel'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'link'; url: string }
  | { kind: 'file'; path: string };

import type { RefTitle } from './youtube-rules';
interface RefData { label: string; titles: RefTitle[]; primary?: string; patterns?: string; thumbUrls: string[]; thumbFiles: string[] }

export const youtubeVideoId = (u: string) => /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(u)?.[1];
const isChannelUrl = (u: string) => /youtube\.com\/(@[\w.-]+|channel\/|c\/|user\/)/i.test(u) || /^@[\w.-]+$/.test(u.trim());

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    c.stdout.on('data', (d: Buffer) => { out += d.toString(); }); c.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    const abort = () => c.kill();
    signal?.addEventListener('abort', abort, { once: true });
    c.on('error', (e) => resolve({ code: -1, out, err: err + e.message }));
    c.on('close', (code) => { signal?.removeEventListener('abort', abort); resolve({ code, out, err }); });
  });
}

async function fetchImage(url: string, file: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const r = await fetch(url, { signal: signal ?? AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Mozilla/5.0 FilmForge' } });
    if (!r.ok || !/^image\//i.test(r.headers.get('content-type') ?? 'image/')) return undefined;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length < 1500) return undefined;          // i.ytimg devolve um placeholder minúsculo quando não há maxres
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, b);
    return file;
  } catch { return undefined; }
}
const ytThumbs = (id: string) => [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`];

/** Títulos e thumbnails de referência (nada de IA aqui). */
async function referenceData(s: Settings, src: CraftSource, log: (l: string) => void, signal?: AbortSignal): Promise<RefData> {
  if (src.kind === 'clone') {
    const c = listChannelClones(s).find((x) => x.id === src.id);
    if (!c) throw new Error('canal clonado não encontrado');
    const bendTitles = c.bends.flatMap((b) => b.exampleTitles ?? []);
    return {
      label: `canal clonado "${c.source.name}"`,
      titles: [...c.recent.map((r) => ({ title: r.title, views: r.views })), ...bendTitles.map((t) => ({ title: t }))],
      patterns: [c.analysis['titlePatterns'], c.analysis['thumbnailStyle'] ? `thumbnails: ${String(c.analysis['thumbnailStyle'])}` : ''].filter(Boolean).map(String).join('\n'),
      thumbUrls: [], thumbFiles: c.recent.map((r) => r.thumb).filter((f): f is string => !!f && fs.existsSync(f)).slice(0, 8),
    };
  }
  const url = src.kind === 'file' ? '' : src.url.trim();
  if (src.kind === 'file') return { label: path.basename(src.path), titles: [], thumbUrls: [], thumbFiles: [src.path] };
  const vid = youtubeVideoId(url);
  if (src.kind === 'video' || (src.kind === 'link' && vid)) {
    if (!vid) throw new Error('link de vídeo do YouTube inválido');
    const exe = await ensureYtDlp(s, log);
    log('lendo o vídeo de referência…');
    const r = await run(exe, ['-J', '--skip-download', '--no-warnings', '--', `https://www.youtube.com/watch?v=${vid}`], signal);
    let info: { title?: string; view_count?: number; channel_url?: string; uploader_url?: string; channel?: string } = {};
    try { info = JSON.parse(r.out); } catch { /* sem metadados: segue só com a thumbnail */ }
    const out: RefData = { label: `vídeo "${info.title ?? vid}"`, titles: info.title ? [{ title: info.title, views: info.view_count }] : [], primary: info.title, thumbUrls: ytThumbs(vid), thumbFiles: [] };
    /* os outros títulos do mesmo canal mostram a estrutura que se repete */
    const ch = info.channel_url ?? info.uploader_url;
    if (ch) try { const l = await listChannel(s, ch, log, signal); out.titles.push(...(l.entries ?? []).filter((e) => e.id !== vid && e.title).slice(0, 25).map((e) => ({ title: e.title!, views: e.view_count ?? undefined }))); } catch { /* só o vídeo */ }
    return out;
  }
  if (src.kind === 'channel' || isChannelUrl(url)) {
    const l = await listChannel(s, url, log, signal);
    const entries = (l.entries ?? []).filter((e) => e.title);
    const top = [...entries].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)).slice(0, 8);
    return { label: `canal "${l.channel ?? l.uploader ?? url}"`, titles: entries.map((e) => ({ title: e.title!, views: e.view_count ?? undefined })), thumbUrls: top.flatMap((e) => [`https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`]), thumbFiles: [] };
  }
  /* link qualquer: imagem direta */
  if (!/^https?:\/\//i.test(url)) throw new Error('cole um link http(s) de imagem, vídeo ou canal do YouTube');
  return { label: url.replace(/^https?:\/\//, '').slice(0, 60), titles: [], thumbUrls: [url], thumbFiles: [] };
}

import { titleStructure, type TitleStructure } from './youtube-rules';
export { titleStructure, type TitleStructure };

/* ───────── títulos sugeridos ───────── */

export interface TitleSuggestInput { source: CraftSource; idea: string; language?: string; count?: number; harness?: HarnessId | 'auto'; model?: string }
export interface TitleSuggestion { title: string; type: 'busca' | 'navegação' | 'híbrido'; formula?: string; why?: string; thumbText?: string }
export interface TitleSuggestResult { label: string; structure: TitleStructure; pattern: string; titles: TitleSuggestion[] }

export async function suggestTitles(s: Settings, input: TitleSuggestInput, log: (l: string) => void, signal?: AbortSignal): Promise<TitleSuggestResult> {
  if (!input.idea?.trim()) throw new Error('escreva a ideia do vídeo para sugerir títulos');
  const ref = await referenceData(s, input.source, log, signal);
  if (!ref.titles.length) throw new Error(`não encontrei títulos em ${ref.label}`);
  const st = titleStructure(ref.titles);
  const n = Math.max(3, Math.min(20, input.count ?? 10));
  const lang = input.language || 'pt-BR';
  const prompt = `Você é o especialista em títulos do YouTube do FilmForge. Escreva ${n} títulos NOVOS para o vídeo abaixo, seguindo a ESTRUTURA dos títulos da referência (${ref.label}) — o mesmo esqueleto, ritmo, tamanho, uso de números/perguntas/caixa alta/separadores — sem copiar assunto, nomes nem frases.

## Vídeo a ser titulado
${input.idea.trim()}
Idioma dos títulos: ${lang}.

## Estrutura medida nos títulos da referência
${st.summary}
${ref.primary ? `Título principal (o vídeo de referência): "${ref.primary}"\n` : ''}${ref.patterns ? `Padrões já identificados na análise do canal: ${ref.patterns}\n` : ''}
Títulos da referência (do mais visto para o menos visto):
${st.examples.map((t) => `- ${t}`).join('\n')}
${ref.titles.filter((t) => !st.examples.includes(t.title)).slice(0, 25).map((t) => `- ${t.title}`).join('\n')}

## Regras de CTR
${TITLE_RULES}

## Resposta
JSON: {"pattern": "a fórmula/esqueleto dos títulos da referência em 1–2 frases (ex.: '[Número] + [coisa surpreendente] + que [consequência] | sem pergunta, 45–55 caracteres')",
 "titles": [{"title": "...", "type": "busca|navegação|híbrido", "formula": "qual esqueleto usou", "why": "por que deve funcionar (curto)", "thumbText": "até 3 palavras para a thumbnail, sem repetir o título"}]}
Pelo menos 3 de cada tipo. Ordene do mais forte para o mais fraco.`;
  const dir = path.join(s.workspace, 'craft', `titles-${Date.now()}`);
  const { json } = await llmJson([{ type: 'harness', harness: input.harness ?? 'auto', model: input.model || undefined }], s, dir, prompt, signal ?? new AbortController().signal, log);
  const j = (json ?? {}) as { pattern?: string; titles?: TitleSuggestion[] };
  const titles = (Array.isArray(j.titles) ? j.titles : []).filter((t) => t && typeof t.title === 'string' && t.title.trim()).map((t) => ({ ...t, title: t.title.trim() }));
  if (!titles.length) throw new Error('a IA não devolveu títulos');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignora */ }
  return { label: ref.label, structure: st, pattern: String(j.pattern ?? ''), titles };
}

/* ───────── modelagem de thumbnail ───────── */

export interface ThumbModelInput { source: CraftSource; name?: string; harness?: HarnessId | 'auto'; model?: string; note?: string }
export interface ThumbBrief { focal?: string; textOverlay?: string; palette?: string[]; composition?: string; emotion?: string; mobile?: string; avoid?: string[] }
export interface ThumbModelResult { template: ThumbnailTemplate; brief: ThumbBrief; variants: Array<{ name: string; change: string; hypothesis?: string }>; refs: string[]; label: string; dir: string }

const LAYOUTS = ['impacto', 'explicativo', 'documentario', 'minimal', 'split'] as const;

export async function modelThumbnail(s: Settings, input: ThumbModelInput, log: (l: string) => void, signal?: AbortSignal): Promise<ThumbModelResult> {
  const ref = await referenceData(s, input.source, log, signal);
  const dir = path.join(s.workspace, 'thumbnails', 'models', `${slugify(input.name || ref.label).slice(0, 40) || 'modelo'}-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  /* imagens de referência dentro da pasta (os CLIs com visão abrem os arquivos daqui) */
  const refs: string[] = [];
  for (const f of ref.thumbFiles.slice(0, 8)) { const dest = path.join(dir, `ref-${String(refs.length + 1).padStart(2, '0')}${path.extname(f) || '.jpg'}`); fs.copyFileSync(f, dest); refs.push(dest); }
  const vid = input.source.kind !== 'file' && input.source.kind !== 'clone' ? youtubeVideoId(input.source.url) : undefined;
  for (const u of ref.thumbUrls) {
    if (refs.length >= 8) break;
    const dest = path.join(dir, `ref-${String(refs.length + 1).padStart(2, '0')}.jpg`);
    if (await fetchImage(u, dest, signal)) { refs.push(dest); if (vid && u.includes(vid)) break; }   // maxres do vídeo achado: não baixa a hq repetida
  }
  if (!refs.length) throw new Error(`não consegui obter nenhuma thumbnail de ${ref.label}`);
  log(`${refs.length} thumbnail(s) de referência em ${dir}`);

  const out = path.join(dir, 'model.json');
  const prompt = `Você é o DIRETOR DE ARTE de thumbnails do FilmForge. OLHE as imagens de referência (${ref.label}) nesta pasta: ${refs.map((f) => path.basename(f)).join(', ')}.
${ref.titles.length ? `Títulos que acompanham essas thumbnails: ${ref.titles.slice(0, 8).map((t) => `"${t.title}"`).join(', ')}.\n` : ''}${input.note?.trim() ? `Pedido do usuário: ${input.note.trim()}\n` : ''}
Modele o ESTILO dessas thumbnails (composição, enquadramento, tamanho e posição do texto, tipografia, paleta, contraste, iluminação, tratamento do fundo, emoção) para reproduzi-lo em vídeos NOVOS — sem copiar marcas, logotipos, rostos reais nem textos.

Regras de thumbnail que o modelo deve respeitar:
${THUMB_RULES}

Grave ${out} (e também imprima) como JSON válido:
{
  "name": "nome curto do estilo",
  "layout": "${LAYOUTS.join('|')}",
  "prompt": "prompt de IA de imagem, em inglês, que reproduz o estilo — use os marcadores {{title}} (tema do vídeo), {{thumb_text}} (texto curto da thumbnail) e {{style}}; descreva composição, posição do ponto focal, fonte e cor do texto, paleta em hex, luz e fundo; termine com 'YouTube thumbnail, 16:9, high contrast, legible at small size'",
  "rules": "regras curtas para textos e composição (português)",
  "brief": { "focal": "o que o olho vê primeiro, posição e % do quadro", "textOverlay": "quantas palavras, fonte, cor, contorno, posição", "palette": ["#hex dominante", "#hex destaque", "#hex pop"],
    "composition": "terços, espaço negativo, profundidade, fluxo do olhar", "emotion": "emoção/expressão (se houver rosto)", "mobile": "o que precisa sobreviver a 168×94 px", "avoid": ["3+ coisas a evitar"] },
  "variants": [ 3 itens { "name": "...", "change": "a ÚNICA variável alterada", "hypothesis": "por que pode ter CTR maior" } ]
}`;
  const { id, cfg, model } = await resolveHarness(s, { type: 'harness', harness: input.harness ?? 'auto', model: input.model || undefined });
  log(`modelando a thumbnail com ${id}${model ? '/' + model : ''}…`);
  const http = isHttpHarness(cfg);
  const res = await runHarness(cfg, { cwd: dir, prompt, model, signal: signal ?? new AbortController().signal, onLine: (l) => log(l.slice(0, 300)), timeoutSec: 900,
    env: id === 'antigravity' ? activeAgyEnv(s) : undefined, tools: http ? undefined : { roots: [dir], allowShell: false }, images: http ? refs : undefined });
  const parse = (t: string) => { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) return undefined; try { return JSON.parse(t.slice(a, b + 1)) as Record<string, unknown>; } catch { return undefined; } };
  const j = (fs.existsSync(out) ? parse(fs.readFileSync(out, 'utf8')) : undefined) ?? parse(res.stdout);
  if (!j || typeof j['prompt'] !== 'string') throw new Error(`${id} não devolveu o modelo de thumbnail${res.ok ? '' : `: ${res.stderr.slice(-300)}`}`);
  fs.writeFileSync(out, JSON.stringify(j, null, 2));
  const brief = (j['brief'] ?? {}) as ThumbBrief;
  const name = String(input.name?.trim() || j['name'] || 'Modelo de thumbnail');
  const briefText = [brief.focal && `Ponto focal: ${brief.focal}`, brief.textOverlay && `Texto: ${brief.textOverlay}`, brief.palette?.length && `Paleta: ${brief.palette.join(', ')}`,
    brief.composition && `Composição: ${brief.composition}`, brief.mobile && `Celular: ${brief.mobile}`, brief.avoid?.length && `Evitar: ${brief.avoid.join('; ')}`].filter(Boolean).join('. ');
  const template: ThumbnailTemplate = {
    id: `modelo-${slugify(name).slice(0, 40) || 'thumb'}-${Date.now().toString(36).slice(-4)}`, name: `🧬 ${name}`,
    prompt: [String(j['prompt']), j['rules'] ? String(j['rules']) : '', briefText].filter(Boolean).join('\n'),
    layout: LAYOUTS.includes(j['layout'] as typeof LAYOUTS[number]) ? j['layout'] as ThumbnailTemplate['layout'] : undefined,
    preview: refs[0],
  };
  const variants = (Array.isArray(j['variants']) ? j['variants'] : []) as ThumbModelResult['variants'];
  return { template, brief, variants, refs, label: ref.label, dir };
}
