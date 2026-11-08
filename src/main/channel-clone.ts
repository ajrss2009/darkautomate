import { httpFetch } from './http';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChannelBrand, ChannelPlatform, HarnessId, Route, Settings, Skill, ThumbnailTemplate } from '../shared/types';
import type { CostEstimate, CostInput, ProductPlan } from './clone-business';
import { ensureYtDlp } from './youtube';
import * as ff from './ffmpeg';
import { isHttpHarness, resolveHarness, runHarness } from './harness';
import { activeAgyEnv } from './automations';
import { ensureFolds, getAnyRoute, saveRoute, saveSkill, slugify } from './library';
import { finalizeSkillMd, prepareReference, skillRules, type VideoRef } from './skillgen';
import type { RenderHtml } from './executors';
import { applyDnaToSkill, audioSummary, averageMetrics, catchphrases, channelTitleStructure, frameSheets, measureVideo, normalizeDna, normalizeLanguages, pickVideos,
  type AudioProfile, type ChannelDna, type LanguagePick, type PickedVideo, type VideoMetrics } from './channel-dna';
import type { TitleStructure } from './youtube-rules';
import { LocalCloneStore } from './clone-store';

/*
 * CLONAR CANAL (Obter vídeos → Canais):
 * 1) lista os últimos vídeos do canal (yt-dlp) e calcula as métricas (views, duração, cadência, títulos);
 * 2) baixa os N mais recentes e extrai quadros-chave + transcrição; baixa as thumbnails, o banner e o avatar;
 * 3) um provedor com visão escreve: skill.md (o MESMO estilo e tipo de vídeo, já com a dobra de nicho escolhida),
 *    channel.json (análise, 10 dobras de nicho, idioma, marca, descrição, banner e estilo de thumbnail) e
 *    três páginas por código: banner.html, thumb.html (thumbnail modelo) e demo.html (vídeo de 10 s do estilo);
 * 4) o app salva a skill, uma rota própria do canal e o template de thumbnail, e renderiza banner, thumb e demo.
 * Copia o ESTILO e o formato, nunca o conteúdo, a marca, o nome ou os personagens do canal original.
 */

export interface ChannelCloneInput {
  channelUrl: string; channelName?: string;
  harness: HarnessId | 'auto'; model?: string;
  /** quantos vídeos recentes analisar a fundo (baixa, quadros, transcrição) */
  deep?: number;
  /** idioma alvo do canal novo (vazio = a IA sugere) */
  language?: string;
  /** observação do usuário (nicho de interesse, público, restrições) */
  note?: string;
  /** retomar um clone interrompido: reaproveita a pasta (thumbnails, quadros, transcrições e o que a IA já gravou) */
  resumeDir?: string;
}
export interface NicheBend { title: string; angle: string; why: string; audience?: string; exampleTitles?: string[];
  /** melhores idiomas para esta dobra (nota 0–10) */
  languages?: LanguagePick[]; demand?: string; competition?: string; cpm?: string }
/** Vídeo analisado a fundo: por que foi escolhido, o que se mediu e as folhas de contato. */
export interface AnalyzedVideo extends PickedVideo { metrics?: VideoMetrics; sheet?: string; /** folhas a 1 quadro/segundo, em ordem */ sheets?: string[]; audio?: AudioProfile; frames?: string[]; transcriptWords?: number }
/** Etapas da clonagem (para a interface mostrar o progresso). */
export type CloneStage = 'list' | 'thumbs' | 'videos' | 'ai' | 'render' | 'save' | 'done';
export interface CloneProgress { stage: CloneStage; pct: number; label: string; name?: string }
export type { ChannelBrand };
export interface ChannelMetrics {
  subs?: number; listed: number; avgViews: number; medianViews: number; maxViews: number; topTitle?: string;
  avgDurationSec: number; shortsShare: number; viewsPerSub?: number; uploadsPerWeek?: number;
  avgTitleLen: number; titlesWithNumbers: number; titlesWithQuestion: number;
}
export interface ChannelCloneResult {
  id: string; dir: string; createdAt: string;
  source: { url: string; name: string; subs?: number; description?: string; avatar?: string; banner?: string };
  metrics: ChannelMetrics;
  recent: Array<{ id: string; title: string; views?: number; durationSec?: number; thumb?: string }>;
  analysis: Record<string, unknown>;
  bends: NicheBend[]; chosenBend: number;
  /** ids das dobras persistidas em library/folds (mesma ordem de `bends`) */
  foldIds?: string[];
  /** canal dono das dobras (slug do nome da marca) */
  channelKey?: string;
  language?: { code: string; why?: string };
  brand: ChannelBrand;
  thumbnail?: { name?: string; prompt?: string; layout?: ThumbnailTemplate['layout']; rules?: string };
  demoIdea?: string;
  skill: Skill; route: Route; thumbnailTemplate?: ThumbnailTemplate;
  files: { banner?: string; thumb?: string; demo?: string };
  warnings: string[];
  /* ── DNA do canal (esquema 2) ── */
  /** vídeos analisados a fundo (mínimo 3), com o motivo da escolha e as métricas medidas */
  videos?: AnalyzedVideo[];
  /** médias medidas (cortes/min, plano médio, palavras/min…) */
  measured?: Partial<VideoMetrics>;
  /** estrutura dos títulos do canal (medida, sem IA) */
  titleStructure?: TitleStructure;
  /** visual, direção de arte, câmera, edição, roteiro, títulos, thumbnail, narração e trilha */
  dna?: ChannelDna;
  /** idiomas recomendados para o canal novo, do melhor para o pior */
  languages?: LanguagePick[];
  /** canal do usuário (aba Canais) associado a este clone — YouTube, TikTok, Facebook, Kwai ou Instagram */
  linked?: { channelId: string; platform: ChannelPlatform; name: string; at: string };
  /** monetização e custo: produtos sugeridos e estimativa de custo de produção */
  business?: { products?: ProductPlan; cost?: CostEstimate; costInput?: CostInput };
}

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

type Entry = { id?: string; title?: string; duration?: number | null; view_count?: number | null; url?: string };
type Listing = { title?: string; channel?: string; uploader?: string; description?: string; channel_follower_count?: number; channel_url?: string; uploader_url?: string;
  thumbnails?: Array<{ id?: string; url?: string; width?: number }>; entries?: Entry[] };

/** URL da aba de vídeos do canal (aceita @handle, /channel/UC…, /c/…, link de vídeo não serve). */
export function channelTabUrl(raw: string, tab: 'videos' | 'shorts' = 'videos'): string {
  let u = raw.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (/^@[\w.-]+$/.test(u)) u = `https://www.youtube.com/${u}`;
  if (!/^https?:\/\//i.test(u)) throw new Error('informe o link do canal (https://www.youtube.com/@canal)');
  u = u.replace(/\/(videos|shorts|streams|featured|playlists|about|community)$/i, '');
  return `${u}/${tab}`;
}

const median = (a: number[]) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m]! : (b[m - 1]! + b[m]!) / 2; };

/** Métricas do canal a partir da lista de vídeos recentes e das datas dos vídeos analisados (função pura). */
export function channelMetrics(entries: Entry[], subs: number | undefined, uploadDates: string[]): ChannelMetrics {
  const views = entries.map((e) => e.view_count ?? 0).filter((v) => v > 0);
  const durs = entries.map((e) => e.duration ?? 0).filter((d) => d > 0);
  const titles = entries.map((e) => e.title ?? '').filter(Boolean);
  const top = [...entries].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0))[0];
  const avg = views.length ? views.reduce((a, b) => a + b, 0) / views.length : 0;
  const days = uploadDates.map((d) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  const spanDays = days.length >= 2 ? (days[days.length - 1]! - days[0]!) / 864e5 : 0;
  return {
    subs, listed: entries.length, avgViews: Math.round(avg), medianViews: Math.round(median(views)), maxViews: top?.view_count ?? 0, topTitle: top?.title,
    avgDurationSec: Math.round(durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0),
    shortsShare: durs.length ? Math.round((durs.filter((d) => d <= 60).length / durs.length) * 100) / 100 : 0,
    viewsPerSub: subs ? Math.round((avg / subs) * 100) / 100 : undefined,
    uploadsPerWeek: spanDays > 0 ? Math.round(((days.length - 1) / spanDays) * 7 * 10) / 10 : undefined,
    avgTitleLen: Math.round(titles.reduce((a, t) => a + t.length, 0) / Math.max(1, titles.length)),
    titlesWithNumbers: Math.round((titles.filter((t) => /\d/.test(t)).length / Math.max(1, titles.length)) * 100) / 100,
    titlesWithQuestion: Math.round((titles.filter((t) => /[?¿]/.test(t)).length / Math.max(1, titles.length)) * 100) / 100,
  };
}

export async function listChannel(s: Settings, url: string, log: (l: string) => void, signal?: AbortSignal): Promise<Listing> {
  const exe = await ensureYtDlp(s, log);
  let best: Listing | undefined;
  for (const tab of ['videos', 'shorts'] as const) {
    const u = channelTabUrl(url, tab);
    log(`listando ${u}…`);
    const r = await run(exe, ['-J', '--flat-playlist', '--playlist-end', '30', '--no-warnings', '--', u], signal);
    if (r.code !== 0) continue;
    try { const j = JSON.parse(r.out) as Listing; if (!best || (j.entries?.length ?? 0) > (best.entries?.length ?? 0)) best = j; } catch { /* JSON inválido */ }
    if ((best?.entries?.length ?? 0) >= 6) break;
  }
  if (!best?.entries?.length) throw new Error('não consegui listar os vídeos do canal (o link é de um canal?)');
  best.entries = best.entries.filter((e) => e.id);
  return best;
}

async function fetchTo(url: string, file: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const r = await fetch(url, { signal: signal ?? AbortSignal.timeout(30_000) });
    if (!r.ok) return undefined;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length < 500) return undefined;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, b);
    return file;
  } catch { return undefined; }
}

function parseJsonLoose(text: string): Record<string, unknown> | undefined {
  const t = text.replace(/^﻿/, '').replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return undefined;
  try { return JSON.parse(t.slice(a, b + 1)) as Record<string, unknown>; } catch { return undefined; }
}

/** Conteúdo de um arquivo pedido na resposta do modelo (sem cercas de código nem texto em volta). */
export function extractFile(name: string, out: string): string | undefined {
  const t = out.replace(/^\uFEFF/, '').trim();
  if (!t) return undefined;
  if (name.endsWith('.json')) { const j = parseJsonLoose(t); return j ? JSON.stringify(j, null, 2) : undefined; }
  /* skill.md pode ter blocos de código dentro: corta só a cerca externa do fim */
  if (name.endsWith('.md')) { const i = t.indexOf('---'); return i >= 0 ? t.slice(i).replace(/\n```\s*$/, '').trim() + '\n' : undefined; }
  const unfenced = (/```[a-z]*\n([\s\S]*?)```/i.exec(t)?.[1] ?? t).trim();
  const a = unfenced.search(/<!doctype html|<html/i), b = unfenced.toLowerCase().lastIndexOf('</html>');
  if (a < 0) return undefined;
  return unfenced.slice(a, b > a ? b + 7 : undefined);
}

const fmtN = (n?: number) => (n === undefined ? '?' : n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} mil` : String(n));

function buildPrompt(s: Settings, input: ChannelCloneInput, list: Listing, m: ChannelMetrics, videos: VideoRef[], thumbs: string[], refs: { banner?: string; avatar?: string }, aspect: string,
  dna: { analyzed: AnalyzedVideo[]; measured: Partial<VideoMetrics>; titles: TitleStructure; phrases?: string[] }): string {
  const name = list.channel ?? list.uploader ?? list.title ?? input.channelName ?? 'canal';
  const recent = (list.entries ?? []).slice(0, 30).map((e, i) => `${i + 1}. ${e.title ?? '—'} · ${fmtN(e.view_count ?? undefined)} views · ${e.duration ? `${Math.round(e.duration)} s` : '?'}`).join('\n');
  const vids = videos.map((v) => {
    const i = v.info;
    const a = dna.analyzed.find((x) => x.id && String(v.url ?? '').includes(x.id));
    const mt = a?.metrics;
    const au = a?.audio ?? mt?.audio;
    const sheets = a?.sheets ?? (a?.sheet ? [a.sheet] : []);
    return `### Vídeo analisado ${v.idx}: ${String(i['title'] ?? '—')}${a ? ` — escolhido porque ${a.reason}` : ''}\n- publicado: ${String(i['upload_date'] ?? '?')} · ${fmtN(Number(i['view_count']) || undefined)} views · ${fmtN(Number(i['like_count']) || undefined)} curtidas · ${fmtN(Number(i['comment_count']) || undefined)} comentários · ${String(i['duration'] ?? '?')} s\n` +
      (mt ? `- MEDIDO: ${mt.shots} planos, plano médio ${mt.avgShotSec} s, ${mt.cutsPerMin} cortes/min${mt.wpm ? `, ${mt.wpm} palavras/min, ${mt.wordsPerSentence} palavras/frase, ${mt.questions} perguntas, ${mt.secondPerson}% "você"` : ''}\n` : '') +
      (au ? `- ÁUDIO MEDIDO: ${audioSummary(au)}${au.bassRatio !== undefined ? ` · grave ${Math.round(au.bassRatio * 100)}% da energia${au.musicLikely ? ' (indício de trilha de fundo; confirme pelo contexto)' : ' (sem indício de trilha; voz seca)'}` : ''}\n` : '') +
      (mt?.hook ? `- primeiras palavras (gancho real): "${mt.hook}"\n` : '') +
      `- tags: ${Array.isArray(i['tags']) ? (i['tags'] as string[]).slice(0, 15).join(', ') : '—'}\n- descrição: ${String(i['description'] ?? '').slice(0, 500).replace(/\n+/g, ' ')}\n` +
      (sheets.length ? `- QUADROS A 1 POR SEGUNDO (${sheets.length} folhas 4×3 = 12 s cada, em ordem: ${sheets.slice(0, 3).join(', ')}${sheets.length > 3 ? ` … ${sheets[sheets.length - 1]}` : ''}) — ABRA TODAS e leia o texto na tela, legendas, tipografia, planos, cortes e direção de arte segundo a segundo:\n${sheets.map((s) => `  - ${s}`).join('\n')}\n` : '') +
      (v.frames.length ? `- quadros-chave adicionais (abra e OLHE): ${v.frames.join(', ')}\n` : '') +
      `- transcrição (${v.transcript ? `transcripts/video${v.idx}.txt` : 'indisponível'}):\n${(v.transcript ?? 'indisponível').slice(0, 6000)}`;
  }).join('\n\n');
  const me = dna.measured;
  const lang = input.language?.trim();
  return `Você é o ESTRATEGISTA DE CANAIS do FilmForge. Tarefa: CLONAR o formato do canal do YouTube "${name}" para um canal NOVO — o mesmo estilo e tipo de vídeo, replicado com exatidão (visual, direção de arte, câmeras, edição, roteiro, TEXTO NA TELA, áudio, trilha sonora, títulos e thumbnails), mas com DOBRA DE NICHO (mesmo formato vencedor aplicado a um SUBNICHO vizinho/novo, para não competir de frente e não copiar conteúdo).

## Canal de origem
- link: ${input.channelUrl}
- inscritos: ${fmtN(list.channel_follower_count)} · descrição: ${(list.description ?? '').slice(0, 600).replace(/\n+/g, ' ')}
- métricas dos últimos ${m.listed} vídeos: média ${fmtN(m.avgViews)} views, mediana ${fmtN(m.medianViews)}, recorde ${fmtN(m.maxViews)} ("${m.topTitle ?? ''}"), duração média ${m.avgDurationSec} s, ${Math.round(m.shortsShare * 100)}% Shorts${m.viewsPerSub !== undefined ? `, ${m.viewsPerSub}× views por inscrito` : ''}${m.uploadsPerWeek !== undefined ? `, ≈${m.uploadsPerWeek} vídeos/semana` : ''}
- RITMO MEDIDO nos ${dna.analyzed.length} vídeos analisados: plano médio ${me.avgShotSec ?? '?'} s, ${me.cutsPerMin ?? '?'} cortes/min${me.jumpCutShare !== undefined ? `, ${Math.round(me.jumpCutShare * 100)}% dos takes < 1,5 s (jump cuts)` : ''}${me.shotStdSec !== undefined ? `, desvio dos takes ${me.shotStdSec} s` : ''}${me.wpm ? `, narração a ${me.wpm} palavras/min, ${me.wordsPerSentence} palavras por frase, ${me.secondPerson}% de "você"` : ''}${me.secPerFact ? `, um fato novo a cada ≈ ${me.secPerFact} s` : ''}
${dna.phrases?.length ? `- ABERTURAS DE FRASE RECORRENTES (bordões/conectivos medidos nas transcrições — descreva a FUNÇÃO deles em script.transitions, não copie): ${dna.phrases.map((x) => `"${x}"`).join(', ')}` : ''}
- ESTRUTURA MEDIDA DOS TÍTULOS: ${dna.titles.summary}
- últimos vídeos (título · views · duração):
${recent}
- thumbnails recentes (OLHE as imagens): ${thumbs.join(', ') || '—'}
${refs.banner ? `- banner atual: ${refs.banner}` : ''}${refs.avatar ? `\n- avatar: ${refs.avatar}` : ''}

${vids}
${input.note?.trim() ? `\n## Pedido do usuário\n${input.note.trim()}\n` : ''}
## O que entregar (grave TODOS estes arquivos nesta pasta)

### 1) channel.json
{
  "analysis": { "format": "...", "videoType": "...", "duration": "...", "cadence": "...", "hook": "o que acontece nos 3–5 s iniciais", "structure": "...",
    "visualStyle": "...", "palette": ["#hex", ...], "typography": "...", "camera": "...", "editing": "ritmo de cortes, transições, efeitos", "narration": "voz, tom, velocidade",
    "music": "...", "titlePatterns": "fórmulas de título", "thumbnailStyle": "composição, texto, cores, rosto/objeto, contraste", "audience": "...", "successFactors": ["...", "..."] },
  "dna": {
    "visual": { "style": "estilo visual preciso (2D/3D/foto/colagem…, nível de detalhe)", "palette": ["#hex", "#hex", "#hex", "#hex"],
      "paletteRoles": { "background": "#hex fundo", "text": "#hex texto", "accent": "#hex cor de destaque", "secondary": "#hex" },
      "graphicStyle": ["recortes 2D|mockups de UI|vetores flat|3D isométrico|stock footage|foto real|whiteboard|colagem|pixel art — os que aparecem"],
      "aiStylePrompt": "prompt BASE de estilo para IA de imagem/vídeo (só o estilo, sem assunto — ex.: 'flat vector, thick outlines, muted teal and orange, soft grain')",
      "lighting": "...", "texture": "grão, traço, ruído…", "composition": "...", "colorGrade": "..." },
    "artDirection": { "world": "universo/ambientação", "characters": "como são personagens/apresentador (sem copiar ninguém real)", "props": "...", "typography": "fontes, tamanho, animação de texto", "graphics": "setas, mapas, gráficos, ícones", "motifs": "elementos recorrentes", "dos": ["..."], "donts": ["..."] },
    "camera": { "shots": "tipos de plano e proporção (ex.: 50% close, 30% médio, 20% aberto)", "movement": "push-in, pan, estático, handheld…", "angles": "...", "lenses": "profundidade de campo, grande-angular…", "transitions": "corte seco, whip, match cut…",
      "moves": ["estatica|handheld-shake|push-in-lento|pull-out|pan|snap-zoom|drone|orbita — os usados"], "snapZoomSfx": true, "lens": "grande-angular|normal|teleobjetiva", "depthOfField": "rasa (fundo desfocado)|profunda", "jumpCuts": "quando e quanto: só na fala, a cada frase, nunca…" },
    "editing": { "pace": "como o ritmo muda ao longo do vídeo", "patternInterrupts": "a cada quanto e como", "broll": "...", "sfx": "..." },
    "script": { "hook": "fórmula do gancho (0–15 s)", "hookAnatomy": ["0–3 s: ...", "3–8 s: ...", "8–15 s: ..."], "timeToRewardSec": <segundos até a 1ª recompensa>,
      "actModel": "3-atos|retencao", "acts": [ { "name": "Gancho", "pct": 5, "goal": "..." }, { "name": "...", "pct": 30 }, "... (somam 100)" ],
      "structure": ["bloco 1", "bloco 2", "..."], "voice": "pessoa, tom, vocabulário", "sentences": "tamanho e ritmo das frases",
      "nlp": "padrões de linguagem/PNL (loops abertos, pressuposições, contraste, futuro, 'imagine…')", "transitions": ["FUNÇÃO dos bordões/conectivos de transição (ex.: 'virada: só que…', 'escalada: e piora')"], "secPerFact": <segundos por fato novo>,
      "retention": "técnicas de retenção", "cta": "...", "ending": "...", "sampleHook": "um gancho NOVO, no estilo, para a dobra escolhida" },
    "titles": { "formula": "esqueleto dos títulos", "patterns": ["..."], "do": ["..."], "avoid": ["..."] },
    "thumbnail": { "focal": "ponto focal, posição e % do quadro", "text": "palavras, fonte, cor, contorno", "palette": ["#hex", "#hex", "#hex"], "composition": "...", "emotion": "...", "mobile": "o que sobrevive a 168×94 px", "avoid": ["..."] },
    "narration": { "voice": "...", "pace": "...", "energy": "..." },
    "music": "gênero, andamento, quando entra/sai",
    "text": { "onScreen": "o que aparece ESCRITO na tela (título, palavra-chave, legenda, contador, CTA)", "typography": "fonte, peso, caixa, contorno, sombra, animação",
      "family": "família tipográfica (ex.: Montserrat ExtraBold)", "outline": "contorno (ex.: 6 px preto)", "shadow": "sombra (ex.: dura 4 px)", "case": "ALTA|título|frase", "animation": "pop/spring|fade|typewriter|slide|karaoke|palavra por palavra",
      "captions": "legendas: posição, tamanho, cor, palavra por palavra ou frase inteira", "emphasis": "como as palavras-chave são destacadas (cor, zoom, caixa alta, karaokê)", "pacing": "a cada quanto entra texto novo; quanto tempo fica na tela" },
    "audio": { "narration": "voz: timbre, idade, sotaque, energia", "voiceProcessing": "limpa|podcast (compressão, grave)|rádio (banda estreita)|fita/vintage|reverb", "loudness": "LUFS/pico medidos e como o volume se comporta", "mix": "voz vs trilha vs SFX: quem domina; ducking; silêncios",
      "sfx": "quais efeitos, quando e com que intensidade", "sfxPerMin": <efeitos por minuto>, "sfxKind": "organico|digital|misto" },
    "soundtrack": { "genre": "gênero musical", "mood": "clima (tenso, épico, divertido, lo-fi…)", "tempo": "BPM aproximado e se muda no vídeo", "bpm": <número>, "instruments": "instrumentos/texturas", "entry": "quando entra, se para em pausas e como fecha",
      "silenceBeforeReveal": true, "cutsOnBeat": false, "genreByAct": ["clima do ato 1", "ato 2", "..."] }
  },
  "bends": [ 10 itens { "title": "nome do SUBNICHO dobrado", "angle": "o que muda no assunto mantendo o formato (vizinho, não cópia)", "why": "por que funciona (demanda, concorrência, público)", "audience": "...", "exampleTitles": ["3 títulos NOVOS seguindo a estrutura medida dos títulos"],
    "demand": "baixa|média|alta", "competition": "baixa|média|alta", "cpm": "baixo|médio|alto", "languages": [ 3 itens { "code": "pt-BR|en|es|hi|…", "score": 0-10, "why": "..." } ] } ],
  "chosenBend": <índice 0–9 da dobra mais promissora>,
  "languages": [ 5 itens, do melhor para o pior, para o canal novo na dobra escolhida: { "code": "...", "score": 0-10, "why": "tamanho do público, concorrência nesse idioma, CPM", "audience": "tamanho estimado do público", "competition": "baixa|média|alta", "cpm": "baixo|médio|alto" } ],
  "language": { "code": "${lang || 'o melhor dos languages'}", "why": "por que esse idioma" },
  "brand": { "names": ["5 nomes de canal originais"], "handle": "@...", "tagline": "...", "description": "descrição do canal pronta para colar no YouTube (no idioma do canal, 600–1000 caracteres, com palavras-chave)",
    "keywords": ["..."], "colors": ["#hex primária", "#hex secundária", "#hex destaque", "#hex fundo"], "fonts": "...", "logoIdea": "...", "bannerPrompt": "prompt para gerar o banner 2560×1440 por IA de imagem", "avatarPrompt": "...", "tone": "..." },
  "thumbnail": { "name": "nome curto do estilo", "prompt": "prompt de imagem que reproduz o ESTILO das thumbnails do canal (sem marcas/rostos reais)", "layout": "impacto|explicativo|documentario|minimal|split", "rules": "regras de texto, cor e composição" },
  "demoIdea": "ideia do vídeo de 10 s que mostra o estilo do canal novo"
}
Tudo baseado no que você VIU (folhas a 1 quadro por segundo, quadros e thumbnails) e no que foi MEDIDO — seja específico (hex, segundos, % de planos, palavras por frase, LUFS, BPM, SFX por minuto, % de cada ato).
PRINCÍPIO: do canal de origem extraia a ESTRUTURA (ritmo, gancho, atos, densidade, takes, câmera, SFX, dinâmica da trilha); a identidade do canal novo (nome, marca, paleta, fontes, bordões, assuntos) é PRÓPRIA — nunca copie frases, marca ou conteúdo. As dobras precisam ser SUBNICHOS diferentes entre si e diferentes do canal de origem; nada de copiar nome, marca, personagens ou assuntos específicos.

## Como analisar (obrigatório)
1) **TEXTO NA TELA (1 quadro/segundo)**: percorra as folhas em ordem e descreva o estilo do texto — tipografia, caixa, contorno, posição, legendas (palavra a palavra ou frase), palavras de destaque, quanto tempo cada texto fica e a cada quantos segundos entra um novo. Isso entra em dna.text e na skill (etapas code_scene/motion_graphics/subtitles).
2) **VISUAL**: paleta (hex), luz, textura, composição, personagens, cenários e grafismos — nas mesmas folhas.
3) **ÁUDIO**: use a transcrição (ritmo, vocabulário, gancho) e o ÁUDIO MEDIDO (LUFS, picos, % de silêncio/pausas, % de grave). Diga se há trilha de fundo, se a voz domina, se há SFX e como o volume se comporta. Isso entra em dna.audio.
4) **TRILHA SONORA**: gênero, clima, andamento aproximado, instrumentos e quando entra/sai (o grave medido ajuda a inferir). Isso entra em dna.soundtrack e na etapa music.
5) **SUBNICHOS**: proponha 10 dobras que sejam SUBNICHOS vizinhos (não o mesmo assunto com outra palavra), cada uma com ângulo, público, por que funciona, concorrência e 3 títulos novos. A dobra escolhida vira o canal novo; as outras ficam como alternativas para explorar sem copiar.

### 2) skill.md — a skill que PRODUZ os vídeos do canal novo
Replique exatamente o estilo e o tipo de vídeo do canal (estrutura, ritmo medido, visual, direção de arte, câmeras, narração, duração, formato ${aspect}) aplicado à dobra escolhida (chosenBend). Use o "dna" em cada etapa: roteiro ← dna.script; plano de cenas ← camera/editing; imagem/vídeo/cenas por código ← visual + artDirection + camera; thumbnail ← dna.thumbnail; metadados ← dna.titles e a estrutura medida dos títulos.
IMPORTANTE — plano ≠ cena: o plano médio medido (${me.avgShotSec ?? '?'} s) é o ritmo de CORTES, que acontecem DENTRO de cada cena do FilmForge (punch-in, troca de ângulo, contraplano). Cada cena do FilmForge tem 2 a 4 planos (${me.avgShotSec ? Math.round(Math.max(8, Math.min(16, me.avgShotSec * 3))) : 10}–16 s); NUNCA mande criar uma cena por corte (cada cena é uma chamada de IA: um vídeo de 5 min deve ter ~20–30 cenas, não 90).
${skillRules(s, lang || 'pt-BR')}

### 3) banner.html, thumb.html e demo.html — páginas desenhadas por código
Regras comuns: HTML+CSS+JS inline, sem rede, sem bibliotecas externas, sem imagens externas (Canvas 2D/SVG/CSS), fontes do sistema, determinístico.
Contrato: window.__forge = { duration, fps: 30, seek(t){ desenha o quadro em t, síncrono, sem lançar exceção }, pause(){} } — sem Date.now/Math.random sem semente.
- banner.html: 2560×1440 (body sem margem), banner do canal novo com nome, tagline e cores da marca; textos e logo dentro da área segura central 1546×423. duration 0.1.
- thumb.html: 1280×720, uma thumbnail MODELO no estilo das thumbnails do canal de origem (composição, contraste, texto grande) para um título da dobra escolhida. duration 0.1.
- demo.html: ${aspect === '9:16' ? '1080×1920' : '1920×1080'}, duration 10 — vídeo de 10 s que mostra o estilo do canal novo: abertura com a marca, 2–3 "planos" no visual do canal (paleta, tipografia, movimentos, câmera e transições observados), texto de exemplo da dobra escolhida e fechamento com o nome do canal. Pode declarar window.__forge.sfx = [{ t, name }] (whoosh, pop, impact, click, riser, ding).

Os vídeos já foram baixados e analisados pelo app: use SÓ os arquivos desta pasta (não baixe nada). Grave os 5 arquivos: channel.json, skill.md, banner.html, thumb.html, demo.html.`;
}

/** Renderiza uma página por código em PNG (1 quadro) ou MP4. */
async function renderPage(renderHtml: RenderHtml, s: Settings, html: string, out: string, w: number, h: number, duration: number, log: (l: string) => void): Promise<string | undefined> {
  if (!fs.existsSync(html)) return undefined;
  try {
    const mp4 = out.replace(/\.\w+$/, '') + (out.endsWith('.png') ? '.frame.mp4' : '.mp4');
    await renderHtml(html, mp4, { w, h, ffmpeg: s.ffmpeg || 'ffmpeg', duration, fps: 30, log });
    if (!out.endsWith('.png')) return mp4;
    await ff.run(s.ffmpeg || 'ffmpeg', ['-y', '-i', mp4, '-frames:v', '1', out]);
    fs.rmSync(mp4, { force: true });
    return out;
  } catch (e) { log(`não consegui renderizar ${path.basename(html)}: ${(e as Error).message.slice(0, 200)}`); return undefined; }
}

export const channelsRoot = (s: Settings) => path.join(s.workspace, 'channels');

/** Clones interrompidos (já analisados, sem resultado): podem ser retomados sem baixar de novo. */
export function listPendingClones(s: Settings): Array<{ dir: string; url: string; name: string; startedAt?: string; ready: string[] }> {
  const root = channelsRoot(s);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.existsSync(path.join(d, 'videos.json')) && fs.existsSync(path.join(d, 'source.json')) && !fs.existsSync(path.join(d, 'result.json')))
    .map((d) => { const src = JSON.parse(fs.readFileSync(path.join(d, 'source.json'), 'utf8')) as { url: string; name: string; startedAt?: string };
      return { dir: d, url: src.url, name: src.name, startedAt: src.startedAt, ready: ['channel.json', 'skill.md', 'banner.html', 'thumb.html', 'demo.html'].filter((f) => fs.existsSync(path.join(d, f))) }; });
}

/** Armazenamento dos clones (hoje local e portátil; a interface é a mesma de um banco na nuvem). */
export const cloneStore = (s: Settings, appVersion?: string) => new LocalCloneStore(channelsRoot(s), appVersion);

/** Clones já feitos (mais recentes primeiro). */
export function listChannelClones(s: Settings): ChannelCloneResult[] {
  return cloneStore(s).list();
}

export async function cloneChannel(s: Settings, input: ChannelCloneInput, o: { toolsDir: string; renderHtml?: RenderHtml; log: (l: string) => void; signal?: AbortSignal; progress?: (p: CloneProgress) => void; appVersion?: string }): Promise<ChannelCloneResult> {
  const { log, signal } = o;
  let who = input.channelName ?? '';
  const step = (stage: CloneStage, pct: number, label: string) => { o.progress?.({ stage, pct: Math.round(Math.max(0, Math.min(100, pct))), label, name: who }); };
  step('list', 2, 'listando os vídeos do canal');
  const list = await listChannel(s, input.channelUrl, log, signal);
  const srcName = list.channel ?? list.uploader ?? input.channelName ?? 'canal';
  const resume = input.resumeDir && fs.existsSync(path.join(input.resumeDir, 'videos.json')) ? path.resolve(input.resumeDir) : undefined;
  const id = resume ? path.basename(resume) : `${slugify(srcName).slice(0, 40) || 'canal'}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`;
  const dir = resume ?? path.join(channelsRoot(s), id);
  if (resume) log(`retomando o clone em ${dir}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify({ url: input.channelUrl, name: srcName, harness: input.harness, model: input.model, language: input.language, note: input.note, startedAt: new Date().toISOString() }, null, 1));
  fs.mkdirSync(dir, { recursive: true });
  const entries = list.entries ?? [];
  who = srcName;
  log(`${srcName}: ${entries.length} vídeos recentes · ${fmtN(list.channel_follower_count)} inscritos`);

  /* thumbnails recentes, banner e avatar (o que o canal mostra) */
  step('thumbs', 6, 'baixando thumbnails, banner e avatar');
  const thumbs: string[] = [];
  for (const [i, e] of entries.slice(0, 12).entries()) {
    const rel = `thumbs/${String(i + 1).padStart(2, '0')}.jpg`;
    if (resume && fs.existsSync(path.join(dir, rel))) { thumbs.push(rel); continue; }
    if (await fetchTo(`https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`, path.join(dir, rel), signal)) thumbs.push(rel);
  }
  const pick = (re: RegExp) => [...(list.thumbnails ?? [])].filter((t) => re.test(t.id ?? '')).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
  const refs: { banner?: string; avatar?: string } = {};
  const bUrl = pick(/banner/i), aUrl = pick(/avatar/i);
  if (bUrl && await fetchTo(bUrl, path.join(dir, 'ref', 'banner.jpg'), signal)) refs.banner = 'ref/banner.jpg';
  if (aUrl && await fetchTo(aUrl, path.join(dir, 'ref', 'avatar.jpg'), signal)) refs.avatar = 'ref/avatar.jpg';
  log(`${thumbs.length} thumbnails${refs.banner ? ', banner' : ''}${refs.avatar ? ' e avatar' : ''} baixados`);

  /* análise a fundo: os vídeos que MAIS performaram (views ÷ mediana) + os mais recentes; mínimo 3 */
  const picked = pickVideos(entries, input.deep ?? 4);
  log(`vídeos escolhidos para análise a fundo (${picked.length}): ${picked.map((p) => `"${p.title.slice(0, 50)}" — ${p.reason}`).join(' · ')}`);
  type SavedRef = VideoRef & { dna?: AnalyzedVideo };
  const videos: SavedRef[] = resume ? JSON.parse(fs.readFileSync(path.join(dir, 'videos.json'), 'utf8')) as SavedRef[] : [];
  for (const [k, pv] of (resume ? [] : picked).entries()) {
    if (signal?.aborted) throw new Error('cancelado');
    const base = 12 + (k / picked.length) * 50;
    step('videos', base, `vídeo ${k + 1}/${picked.length}: baixando, quadros e transcrição`);
    try {
      const ref: SavedRef = await prepareReference(s, dir, k + 1, { url: `https://www.youtube.com/watch?v=${pv.id}` }, 8, o.toolsDir, log, signal, 300);
      /* medido no arquivo baixado (antes de apagar): cortes, ritmo de fala e folha de contato */
      step('videos', base + 25 / picked.length, `vídeo ${k + 1}/${picked.length}: medindo cortes, fala e folha de contato`);
      const file = fs.existsSync(path.join(dir, 'videos')) ? fs.readdirSync(path.join(dir, 'videos')).filter((f) => f.startsWith(`video${k + 1}.`) && /\.(mp4|webm|mkv|mov)$/i.test(f)).map((f) => path.join(dir, 'videos', f))[0] : undefined;
      const a: AnalyzedVideo = { ...pv, frames: ref.frames, transcriptWords: ref.transcript?.split(/\s+/).length };
      if (file) {
        a.metrics = await measureVideo(s.ffmpeg || 'ffmpeg', s.ffprobe || 'ffprobe', file, ref.transcript, signal);
        /* 1 QUADRO POR SEGUNDO: folhas de 12 s (4×3) em ordem — a IA lê texto/legendas/tipografia e o ritmo real */
        const abs = await frameSheets(s.ffmpeg || 'ffmpeg', file, path.join(dir, 'sheets', `video${k + 1}`), 300, signal);
        a.sheets = abs.map((f) => path.relative(dir, f).replace(/\\/g, '/'));
        a.audio = a.metrics.audio;
        if (a.sheets[0]) a.sheet = a.sheets[0];
        log(`vídeo ${k + 1}: ${a.metrics.shots} planos (${a.metrics.avgShotSec} s cada, ${a.metrics.cutsPerMin} cortes/min)` +
          `${a.metrics.wpm ? `, ${a.metrics.wpm} palavras/min` : ''} · ${a.sheets.length} folhas a 1 quadro/s (${Math.min(300, a.metrics.durationSec)} s)` +
          `${a.audio ? ` · áudio: ${audioSummary(a.audio)}` : ''}`);
      }
      ref.dna = a;
      videos.push(ref);
    } catch (err) { log(`vídeo ${k + 1} ignorado: ${(err as Error).message.slice(0, 160)}`); }
  }
  if (!videos.length) throw new Error('nenhum vídeo do canal pôde ser analisado');
  if (videos.length < 3 && !resume) log(`⚠ só ${videos.length} vídeo(s) puderam ser analisados (o ideal é 3 ou mais)`);
  fs.rmSync(path.join(dir, 'videos'), { recursive: true, force: true });
  /* o que foi analisado fica salvo (sem os vídeos): permite retomar sem baixar de novo */
  const KEEP = ['title', 'upload_date', 'view_count', 'like_count', 'comment_count', 'duration', 'tags', 'description', 'uploader', 'channel'];
  if (!resume) fs.writeFileSync(path.join(dir, 'videos.json'), JSON.stringify(videos.map((v) => ({ ...v, info: Object.fromEntries(KEEP.map((k) => [k, k === 'description' ? String(v.info[k] ?? '').slice(0, 800) : v.info[k]])) })), null, 1));
  const metrics = channelMetrics(entries, list.channel_follower_count, videos.map((v) => String(v.info['upload_date'] ?? '')).filter(Boolean));
  const shorts = metrics.shortsShare >= 0.5;
  const aspect = shorts ? '9:16' : '16:9';
  const analyzed: AnalyzedVideo[] = videos.map((v) => v.dna).filter((x): x is AnalyzedVideo => !!x);
  const measured = averageMetrics(analyzed.map((a) => a.metrics).filter((x): x is VideoMetrics => !!x));
  const titleStr = channelTitleStructure(entries.filter((e) => e.title).map((e) => ({ title: e.title!, views: e.view_count ?? undefined })));
  /* bordões/conectivos recorrentes nas transcrições (medido, sem IA) */
  const phrases = catchphrases(videos.map((v) => v.transcript ?? '').filter(Boolean));

  /* provedor com visão escreve tudo */
  step('ai', 64, 'a IA está analisando o DNA do canal (visual, câmeras, roteiro, títulos, thumbnails, idiomas)');
  const { id: hid, cfg, model } = await resolveHarness(s, { type: 'harness', harness: input.harness, model: input.model });
  const full = buildPrompt(s, input, list, metrics, videos, thumbs, refs, aspect, { analyzed, measured, titles: titleStr, phrases });
  const http = isHttpHarness(cfg);
  const env = hid === 'antigravity' ? activeAgyEnv(s) : undefined;
  const ac = signal ?? new AbortController().signal;
  /* imagens para o modelo local (os CLIs abrem os arquivos pela pasta): folhas a 1 fps + quadros + thumbnails */
  const images = [...analyzed.flatMap((a) => (a.sheets?.length ? a.sheets.slice(0, 3) : a.sheet ? [a.sheet] : [])),
    ...videos.flatMap((v) => v.frames.filter((_, i) => i % 2 === 0)).slice(0, 6), ...thumbs.slice(0, 6)].map((f) => path.join(dir, f));
  let lastErr = '';
  if (!http && !(fs.existsSync(path.join(dir, 'channel.json')) && fs.existsSync(path.join(dir, 'skill.md')))) {
    log(`analisando o canal com ${hid}${model ? '/' + model : ''}… (pode levar alguns minutos)`);
    const res = await runHarness(cfg, { cwd: dir, prompt: full, model, signal: ac, onLine: (l) => log(l.slice(0, 300)), timeoutSec: 2400, env, tools: { roots: [dir], allowShell: false } });
    if (!res.ok) lastErr = res.stderr.slice(-300);
    const chMaybe = path.join(dir, 'channel.json');
    if (!fs.existsSync(chMaybe) && parseJsonLoose(res.stdout)) fs.writeFileSync(chMaybe, JSON.stringify(parseJsonLoose(res.stdout), null, 2));
  }
  /* modelo local (Ollama/LM Studio/llama.cpp) ou arquivo que faltou: pede UM arquivo por vez e grava a resposta */
  for (const f of ['channel.json', 'skill.md', 'banner.html', 'thumb.html', 'demo.html']) {
    const file = path.join(dir, f);
    if (fs.existsSync(file) && fs.statSync(file).size > 20) continue;
    if (ac.aborted) throw new Error('cancelado');
    log(`gerando ${f} com ${hid}${model ? '/' + model : ''}…`);
    step('ai', 66 + ['channel.json', 'skill.md', 'banner.html', 'thumb.html', 'demo.html'].indexOf(f) * 3, `a IA está escrevendo ${f}`);
    const decided = f !== 'channel.json' && fs.existsSync(path.join(dir, 'channel.json')) ? `\nUse a análise e a marca já decididas (channel.json):\n${fs.readFileSync(path.join(dir, 'channel.json'), 'utf8').slice(0, 7000)}` : '';
    const prompt = `${full}\n\n---\nATENÇÃO: nesta resposta entregue SOMENTE o conteúdo completo do arquivo ${f} — sem explicações, sem cercas de código e sem os outros arquivos.${decided}`;
    const r = await runHarness(cfg, { cwd: dir, prompt, model, signal: ac, onLine: (l) => log(l.slice(0, 300)), timeoutSec: 1800, env,
      tools: http ? undefined : { roots: [dir], allowShell: false }, images: http && (f === 'channel.json' || f === 'skill.md') ? images : undefined });
    if (fs.existsSync(file) && fs.statSync(file).size > 20) continue;
    const body = extractFile(f, r.stdout);
    if (body) fs.writeFileSync(file, body);
    else { lastErr = r.ok ? `resposta sem ${f}` : r.stderr.slice(-300); log(`${hid} não entregou ${f}${lastErr ? ` (${lastErr.slice(0, 160)})` : ''}`); }
  }
  const chFile = path.join(dir, 'channel.json');
  const ch = fs.existsSync(chFile) ? parseJsonLoose(fs.readFileSync(chFile, 'utf8')) : undefined;
  if (!ch) throw new Error(`${hid} não gravou channel.json${lastErr ? `: ${lastErr}` : ''}`);
  const mdFile = path.join(dir, 'skill.md');
  if (!fs.existsSync(mdFile)) throw new Error(`${hid} não gravou skill.md`);

  const bends = ((Array.isArray(ch['bends']) ? ch['bends'] : []) as Array<NicheBend & { languages?: unknown }>)
    .map((b) => ({ ...b, languages: normalizeLanguages(b.languages, 3) }));
  const chosenBend = Math.max(0, Math.min(bends.length - 1, Number(ch['chosenBend']) || 0));
  const brand = (ch['brand'] ?? {}) as ChannelBrand;
  const thumbnail = ch['thumbnail'] as ChannelCloneResult['thumbnail'];
  /* idiomas: ranking com nota; o idioma do canal é o escolhido pelo usuário ou o melhor do ranking */
  const languages = normalizeLanguages(ch['languages'], 5);
  const language: ChannelCloneResult['language'] = input.language ? { code: input.language, why: 'escolhido pelo usuário' }
    : (ch['language'] as ChannelCloneResult['language']) ?? (languages[0] ? { code: languages[0].code, why: languages[0].why } : undefined);
  const dna = normalizeDna(ch['dna']);
  const warnings: string[] = [];
  if (bends.length < 10) warnings.push(`a IA sugeriu ${bends.length} dobras de nicho (pedido: 10)`);
  if (!ch['dna']) warnings.push('a IA não devolveu o DNA detalhado (visual/câmera/roteiro); a skill usa só as métricas medidas');
  step('save', 82, 'criando skill, rota, dobras e template de thumbnail');
  const brandName = brand.names?.[0]?.trim() || `${srcName} (dobra)`;

  /* skill + rota própria do canal */
  const fin = finalizeSkillMd(s, fs.readFileSync(mdFile, 'utf8'), {
    language: input.language || language?.code, fallbackId: `canal-${slugify(brandName)}`,
    sourceNote: `Clone do formato de ${srcName} (${input.channelUrl}) com dobra de nicho: ${bends[chosenBend]?.title ?? '—'}`,
    preview: videos[0]?.frames[Math.floor(videos[0].frames.length / 2)] ? path.join(dir, videos[0].frames[Math.floor(videos[0].frames.length / 2)]!) : undefined,
  });
  warnings.push(...fin.warnings);
  const base = getAnyRoute(s, fin.route.id) ?? fin.route;
  let rid = `canal-${slugify(brandName) || 'novo'}`, k = 2;
  while (getAnyRoute(s, rid)) rid = `canal-${slugify(brandName) || 'novo'}-${k++}`;
  const route = saveRoute(s, { ...JSON.parse(JSON.stringify(base)) as Route, id: rid, name: `Canal ${brandName} — ${base.name}`,
    description: `Rota do canal "${brandName}" (formato de ${srcName}, dobra: ${bends[chosenBend]?.title ?? '—'}). Base: ${base.name}.` });

  /* dobras persistentes: cada sugestão vira um registro em library/folds, ligado à skill e à rota */
  const channelKey = slugify(brandName) || `canal-${id.slice(-6)}`;
  const join = (...xs: Array<string | undefined>) => xs.filter((x): x is string => !!x?.trim()).join(' · ');
  const foldModel = {
    format: join(dna.visual?.style, dna.camera?.shots, dna.editing?.pace),
    text: join(dna.text?.onScreen, dna.text?.typography, dna.text?.captions, dna.text?.emphasis),
    visual: join(dna.visual?.style, dna.artDirection?.world, dna.visual?.palette?.join(', '), dna.visual?.colorGrade),
    audio: join(dna.audio?.narration, dna.audio?.mix, dna.audio?.loudness, dna.audio?.sfx),
    soundtrack: join(dna.soundtrack?.genre, dna.soundtrack?.mood, dna.soundtrack?.tempo, dna.soundtrack?.instruments) || dna.music,
  };
  const savedFolds = ensureFolds(s, {
    channel: channelKey, channelName: brandName, sourceChannel: srcName, sourceUrl: input.channelUrl,
    skillId: fin.skill.id, routeId: route.id, language: input.language || language?.code, aspect: fin.skill.aspect,
    bends, chosen: chosenBend, model: foldModel,
  });
  const foldIds = savedFolds.map((f) => f.id);
  if (foldIds.length) log(`${foldIds.length} dobras de nicho salvas (canal ${channelKey})`);

  /* páginas por código: banner, thumbnail modelo e vídeo de 10 s */
  const files: ChannelCloneResult['files'] = {};
  if (o.renderHtml) {
    step('render', 88, 'renderizando banner, thumbnail modelo e o vídeo de 10 s');
    log('renderizando banner, thumbnail modelo e o vídeo de 10 s…');
    files.banner = await renderPage(o.renderHtml, s, path.join(dir, 'banner.html'), path.join(dir, 'banner.png'), 2560, 1440, 0.1, log);
    files.thumb = await renderPage(o.renderHtml, s, path.join(dir, 'thumb.html'), path.join(dir, 'thumb.png'), 1280, 720, 0.1, log);
    files.demo = await renderPage(o.renderHtml, s, path.join(dir, 'demo.html'), path.join(dir, 'demo.mp4'), shorts ? 1080 : 1920, shorts ? 1920 : 1080, 10, log);
  }

  /* template de thumbnail do canal (o exemplo é a thumb modelo ou a do vídeo mais recente) */
  const tplPreview = files.thumb ?? (thumbs[0] ? path.join(dir, thumbs[0]) : undefined);
  const LAYOUTS = ['impacto', 'explicativo', 'documentario', 'minimal', 'split'];
  const tb = dna.thumbnail;
  const brief = [tb?.focal && `Focal point: ${tb.focal}`, tb?.text && `Text: ${tb.text}`, tb?.palette?.length && `Palette: ${tb.palette.join(', ')}`, tb?.composition && `Composition: ${tb.composition}`,
    tb?.emotion && `Emotion: ${tb.emotion}`, tb?.mobile && `Legible at 168x94: ${tb.mobile}`, tb?.avoid?.length && `Avoid: ${tb.avoid.join('; ')}`].filter(Boolean).join('. ');
  const thumbnailTemplate: ThumbnailTemplate | undefined = thumbnail?.prompt ? {
    id: `canal-${slugify(brandName) || 'novo'}`, name: `Canal ${brandName}${thumbnail.name ? ` — ${thumbnail.name}` : ''}`,
    prompt: [thumbnail.prompt, thumbnail.rules, brief].filter(Boolean).join('\n'), layout: LAYOUTS.includes(String(thumbnail.layout)) ? thumbnail.layout : undefined, preview: tplPreview,
  } : undefined;
  /* o DNA (medido + descrito) entra garantido nas diretrizes e nas etapas da skill */
  let skill = saveSkill(s, applyDnaToSkill(fin.skill, dna, measured, titleStr, srcName, phrases));
  if (skill.routeId !== route.id || thumbnailTemplate) skill = saveSkill(s, { ...skill, routeId: route.id, thumbnailTemplate: thumbnailTemplate?.id ?? skill.thumbnailTemplate });
  if (files.demo && !skill.previewMedia?.endsWith('.mp4')) {
    const dest = path.join(s.workspace, 'library', 'skill-media', `${skill.id}.mp4`);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(files.demo, dest);
    skill = saveSkill(s, { ...skill, previewMedia: dest });
  }

  const result: ChannelCloneResult = {
    id, dir, createdAt: new Date().toISOString(),
    source: { url: input.channelUrl, name: srcName, subs: list.channel_follower_count, description: list.description?.slice(0, 1500), avatar: refs.avatar && path.join(dir, refs.avatar), banner: refs.banner && path.join(dir, refs.banner) },
    metrics, recent: entries.slice(0, 12).map((e, i) => ({ id: e.id!, title: e.title ?? '', views: e.view_count ?? undefined, durationSec: e.duration ?? undefined, thumb: thumbs[i] && path.join(dir, thumbs[i]!) })),
    analysis: (ch['analysis'] ?? {}) as Record<string, unknown>, bends, chosenBend, foldIds, channelKey, language, brand, thumbnail, demoIdea: typeof ch['demoIdea'] === 'string' ? ch['demoIdea'] : undefined,
    skill, route, thumbnailTemplate, files, warnings,
    videos: analyzed.map((a) => ({ ...a, sheet: a.sheet && path.join(dir, a.sheet), frames: a.frames?.map((f) => path.join(dir, f)) })),
    measured, titleStructure: titleStr, dna, languages,
  };
  /* gravado pelo armazenamento: esquema versionado, caminhos relativos (portátil) e estado de sincronização */
  const saved = cloneStore(s, o.appVersion).save(result);
  step('done', 100, `canal clonado: ${brandName}`);
  log(`canal clonado: skill "${skill.name}", rota "${route.name}"`);
  return saved;
}
