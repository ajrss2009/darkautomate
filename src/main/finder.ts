import { httpFetch } from './http';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import { spawn } from 'node:child_process';
import type { Settings } from '../shared/types';
import { ensureYtDlp } from './youtube';

/**
 * "Obter vídeos" → YouTube: encontra vídeos que estão arrebentando (outliers) e explica por quê.
 * Pontuação 0–100: outlier (views ÷ inscritos), velocidade (views/dia), engajamento, canal pequeno,
 * canal novo e idioma. Com a chave da YouTube Data API v3 usa a API oficial (rápida, com idade do canal);
 * sem chave usa o yt-dlp (sem idade do canal).
 */

export interface FinderQuery {
  query: string; languages: string[]; period: 'week' | 'month' | 'year' | 'any';
  perLanguage?: number; minViews?: number; maxSubs?: number; format?: 'any' | 'shorts' | 'long';
  /** consultas já traduzidas por idioma (opcional; senão usa a mesma em todos) */
  queries?: Record<string, string>;
  /**
   * OUTLIERS sem nicho: ignora o termo, varre buscas amplas por idioma e fica só com vídeos que explodiram em canais
   * PEQUENOS (≤ maxSubs, padrão 100 mil) com views ≥ 3× os inscritos/seguidores.
   */
  outliers?: boolean;
}

/** Padrões do modo Outliers. */
export const OUTLIER_MAX_SUBS = 100_000;
export const OUTLIER_MIN_RATIO = 3;

/** Buscas AMPLAS por idioma (sem nicho) para o modo Outliers; nas redes curtas, hashtags genéricas. Função pura. */
export function outlierSeeds(lang: string, platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'kwai' = 'youtube'): string[] {
  const l = (lang || 'en').slice(0, 2).toLowerCase();
  const yt: Record<string, string[]> = {
    pt: ['você sabia', 'como fazer', 'história real'], en: ['did you know', 'how to', 'true story'], es: ['sabías que', 'cómo hacer', 'historia real'],
    fr: ['le saviez-vous', 'comment faire', 'histoire vraie'], de: ['wusstest du', 'wie man', 'wahre geschichte'], it: ['lo sapevi', 'come fare', 'storia vera'],
    hi: ['क्या आप जानते हैं', 'कैसे करें', 'सच्ची कहानी'], ja: ['知ってた', 'やり方', '実話'], ko: ['알고 계셨나요', '하는 방법', '실화'], ar: ['هل تعلم', 'كيف', 'قصة حقيقية'],
    ru: ['а вы знали', 'как сделать', 'реальная история'], id: ['tahukah kamu', 'cara membuat', 'kisah nyata'], tr: ['biliyor muydunuz', 'nasıl yapılır', 'gerçek hikaye'],
  };
  const social: Record<string, string[]> = {
    pt: ['viral', 'curiosidades', 'fyp'], en: ['viral', 'fyp', 'facts'], es: ['viral', 'curiosidades', 'parati'], fr: ['viral', 'pourtoi', 'astuce'], de: ['viral', 'fürdich', 'fakten'],
    it: ['virale', 'perte', 'curiosità'], id: ['viral', 'fyp', 'faktaunik'], tr: ['viral', 'keşfet', 'bilgi'], ru: ['вирусное', 'рекомендации', 'факты'],
  };
  if (platform === 'youtube') return yt[l] ?? yt['en']!;
  return social[l] ?? social['en']!;
}

/**
 * Filtro do modo Outliers (função pura): canal pequeno (≤ maxSubs) E views ≥ 3× o tamanho do canal.
 * Vídeos sem inscritos/seguidores conhecidos só ficam se NENHUM tiver (algumas redes não informam).
 */
export function outlierFilter<T extends { views: number; subs?: number }>(list: T[], maxSubs = OUTLIER_MAX_SUBS, minRatio = OUTLIER_MIN_RATIO): { kept: T[]; unknownSubs: boolean } {
  const known = list.filter((v) => v.subs !== undefined);
  if (!known.length) return { kept: list, unknownSubs: list.length > 0 };
  return { kept: known.filter((v) => v.subs! <= maxSubs && v.views / Math.max(v.subs!, 100) >= minRatio), unknownSubs: false };
}
export interface FinderParts { outlier: number; velocity: number; engagement: number; small: number; young: number; language: number }
export interface FinderVideo {
  id: string; title: string; url: string; thumb: string; channel: string; channelId?: string; channelUrl?: string;
  subs?: number; views: number; likes?: number; comments?: number; publishedAt?: string; ageDays?: number;
  channelAgeDays?: number; channelVideos?: number; durationSec?: number; language?: string; searchLang: string;
  score: number; parts: FinderParts; reasons: string[];
  /** rede do vídeo (ausente = YouTube) */
  platform?: 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'kwai';
}
export interface FinderResult { videos: FinderVideo[]; channels: FinderChannel[]; engine: 'api' | 'yt-dlp' | 'browser'; warnings: string[]; platform?: FinderVideo['platform']; loginWall?: boolean }
export interface FinderChannel { platform?: FinderVideo['platform']; channel: string; channelId?: string; channelUrl?: string; subs?: number; channelAgeDays?: number; best: number; hits: number; languages: string[]; avgRatio: number }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} mil` : String(Math.round(n));
const LANG_NAMES: Record<string, string> = { pt: 'português', en: 'inglês', es: 'espanhol', fr: 'francês', de: 'alemão', it: 'italiano', hi: 'hindi', ja: 'japonês', ko: 'coreano', ar: 'árabe', ru: 'russo', id: 'indonésio', tr: 'turco', zh: 'chinês' };

type UiLang = 'pt-BR' | 'en' | 'es';
const LANG_NAMES_I18N: Record<'en' | 'es', Record<string, string>> = {
  en: { pt: 'Portuguese', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', hi: 'Hindi', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', ru: 'Russian', id: 'Indonesian', tr: 'Turkish', zh: 'Chinese' },
  es: { pt: 'portugués', en: 'inglés', es: 'español', fr: 'francés', de: 'alemán', it: 'italiano', hi: 'hindi', ja: 'japonés', ko: 'coreano', ar: 'árabe', ru: 'ruso', id: 'indonesio', tr: 'turco', zh: 'chino' },
};
/** Motivos do sucesso no idioma da interface. */
const REASONS = {
  'pt-BR': {
    outlier: (big: boolean, views: string, subs: string, x: string) => `🚀 ${big ? 'Explodiu' : 'Furou a bolha'}: ${views} views com ${subs} inscritos (${x}× o tamanho do canal) — o algoritmo entregou para fora da base.`,
    velocity: (perDay: string, age?: number) => `⚡ Velocidade alta: ≈${perDay} views por dia${age !== undefined ? ` em ${age} dia(s)` : ''}.`,
    engagement: (pct: string) => `❤️ Engajamento forte: ${pct}% (curtidas + comentários) — o público reage e o YouTube recomenda mais.`,
    small: (subs: string) => `🌱 Canal pequeno (${subs} inscritos): prova de que o TEMA/formato puxou a audiência, não o tamanho do canal.`,
    young: (d: number) => `🆕 Canal novo (${d < 60 ? `${d} dias` : `${Math.round(d / 30)} meses`}): o nicho ainda tem espaço.`,
    number: '🔢 Título com número (lista, valor, tempo): promessa concreta e clicável.',
    question: '❓ Título em forma de pergunta/curiosidade: abre uma lacuna que o espectador quer fechar.',
    impact: '🔥 Palavras de alto impacto no título (segredo, nunca, verdade, melhor/pior…).',
    shorts: '📱 Formato Shorts: distribuição em massa no feed vertical.',
    long: '⏱️ Duração de 8–25 min: bom tempo de exibição por visualização.',
    recent: '🗓️ Recente: ainda está em alta agora.',
    lang: (name: string) => `🌐 Em ${name}: idioma pedido na busca.`,
  },
  en: {
    outlier: (big: boolean, views: string, subs: string, x: string) => `🚀 ${big ? 'Exploded' : 'Broke out'}: ${views} views with ${subs} subscribers (${x}× the channel's size) — the algorithm pushed it beyond the subscriber base.`,
    velocity: (perDay: string, age?: number) => `⚡ High velocity: ≈${perDay} views per day${age !== undefined ? ` over ${age} day(s)` : ''}.`,
    engagement: (pct: string) => `❤️ Strong engagement: ${pct}% (likes + comments) — the audience reacts and YouTube recommends it more.`,
    small: (subs: string) => `🌱 Small channel (${subs} subscribers): proof that the TOPIC/format drew the audience, not the channel's size.`,
    young: (d: number) => `🆕 New channel (${d < 60 ? `${d} days` : `${Math.round(d / 30)} months`}): the niche still has room.`,
    number: '🔢 Title with a number (list, value, time): a concrete, clickable promise.',
    question: '❓ Question/curiosity title: opens a gap the viewer wants to close.',
    impact: '🔥 High-impact words in the title (secret, never, truth, best/worst…).',
    shorts: '📱 Shorts format: mass distribution in the vertical feed.',
    long: '⏱️ 8–25 min length: good watch time per view.',
    recent: '🗓️ Recent: still trending right now.',
    lang: (name: string) => `🌐 In ${name}: a language you searched for.`,
  },
  es: {
    outlier: (big: boolean, views: string, subs: string, x: string) => `🚀 ${big ? 'Explotó' : 'Rompió la burbuja'}: ${views} vistas con ${subs} suscriptores (${x}× el tamaño del canal) — el algoritmo lo llevó fuera de la base.`,
    velocity: (perDay: string, age?: number) => `⚡ Velocidad alta: ≈${perDay} vistas por día${age !== undefined ? ` en ${age} día(s)` : ''}.`,
    engagement: (pct: string) => `❤️ Interacción fuerte: ${pct}% (me gusta + comentarios) — el público reacciona y YouTube lo recomienda más.`,
    small: (subs: string) => `🌱 Canal pequeño (${subs} suscriptores): prueba de que el TEMA/formato atrajo la audiencia, no el tamaño del canal.`,
    young: (d: number) => `🆕 Canal nuevo (${d < 60 ? `${d} días` : `${Math.round(d / 30)} meses`}): el nicho aún tiene espacio.`,
    number: '🔢 Título con número (lista, valor, tiempo): promesa concreta y clicable.',
    question: '❓ Título en forma de pregunta/curiosidad: abre un vacío que el espectador quiere cerrar.',
    impact: '🔥 Palabras de alto impacto en el título (secreto, nunca, verdad, mejor/peor…).',
    shorts: '📱 Formato Shorts: distribución masiva en el feed vertical.',
    long: '⏱️ Duración de 8–25 min: buen tiempo de visualización por vista.',
    recent: '🗓️ Reciente: sigue en tendencia ahora.',
    lang: (name: string) => `🌐 En ${name}: idioma pedido en la búsqueda.`,
  },
};
const fmtL = (n: number, ui: UiLang) => ui === 'pt-BR' ? fmt(n) : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(Math.round(n));

/** Pontuação e motivos do sucesso (função pura: testável). */
export function scoreVideo(v: Omit<FinderVideo, 'score' | 'parts' | 'reasons'>, wanted: string[], ui: UiLang = 'pt-BR'): { score: number; parts: FinderParts; reasons: string[] } {
  const R = REASONS[ui] ?? REASONS['pt-BR'];
  const fmt = (n: number) => fmtL(n, ui);
  const reasons: string[] = [];
  const subs = v.subs ?? 0;
  const ratio = v.views / Math.max(subs, 500);
  const outlier = clamp((Math.log10(Math.max(ratio, 1)) / 2) * 35, 0, 35);
  const perDay = v.views / Math.max(v.ageDays ?? 30, 1);
  const velocity = clamp(((Math.log10(Math.max(perDay, 1)) - 2) / 4) * 25, 0, 25);
  const eng = v.likes !== undefined ? ((v.likes ?? 0) + 2 * (v.comments ?? 0)) / Math.max(v.views, 1) : undefined;
  const engagement = eng === undefined ? 0 : clamp((eng / 0.06) * 15, 0, 15);
  const small = v.subs === undefined ? 0 : subs < 1000 ? 10 : subs < 10_000 ? 9 : subs < 100_000 ? 6 : subs < 1_000_000 ? 3 : 0;
  const young = v.channelAgeDays === undefined ? 0 : v.channelAgeDays < 180 ? 10 : v.channelAgeDays < 365 ? 8 : v.channelAgeDays < 730 ? 5 : v.channelAgeDays < 1825 ? 2 : 0;
  const lang = (v.language ?? v.searchLang).slice(0, 2).toLowerCase();
  const language = !wanted.length || wanted.includes(lang) ? 5 : 0;
  if (v.subs !== undefined && ratio >= 3) reasons.push(R.outlier(ratio >= 100, fmt(v.views), fmt(subs), ratio >= 10 ? String(Math.round(ratio)) : ratio.toFixed(1)));
  if (perDay >= 10_000) reasons.push(R.velocity(fmt(perDay), v.ageDays));
  if (eng !== undefined && eng >= 0.04) reasons.push(R.engagement((eng * 100).toFixed(1)));
  if (v.subs !== undefined && subs < 10_000) reasons.push(R.small(fmt(subs)));
  if (v.channelAgeDays !== undefined && v.channelAgeDays < 365) reasons.push(R.young(v.channelAgeDays));
  const t = v.title;
  if (/\d/.test(t)) reasons.push(R.number);
  if (/\?|¿|por que|porque|why|como |how |what |qual |o que /i.test(t)) reasons.push(R.question);
  if (/segredo|ningu[eé]m|nunca|jamais|verdade|proibid|chocante|incr[ií]vel|secret|never|nobody|truth|insane|shocking|crazy|mistake|erro|pior|melhor|best|worst/i.test(t)) reasons.push(R.impact);
  if (v.durationSec !== undefined && v.durationSec <= 60) reasons.push(R.shorts);
  else if (v.durationSec !== undefined && v.durationSec >= 480 && v.durationSec <= 1500) reasons.push(R.long);
  if (v.ageDays !== undefined && v.ageDays <= 14) reasons.push(R.recent);
  if (language && wanted.length > 1) reasons.push(R.lang((ui === 'pt-BR' ? LANG_NAMES : LANG_NAMES_I18N[ui])[lang] ?? lang));
  const parts = { outlier, velocity, engagement, small, young, language };
  const score = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
  return { score, parts, reasons };
}

/* ───────── YouTube Data API v3 ───────── */

const API = 'https://www.googleapis.com/youtube/v3';
const iso = (p: FinderQuery['period']) => p === 'any' ? undefined : new Date(Date.now() - (p === 'week' ? 7 : p === 'month' ? 30 : 365) * 864e5).toISOString();
const dur = (s?: string) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s ?? ''); return m ? (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) : undefined; };
const days = (d?: string) => (d ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 864e5)) : undefined);

async function api<T>(path: string, key: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${API}/${path}&key=${encodeURIComponent(key)}`, { signal });
  const j = await r.json() as T & { error?: { message?: string } };
  if (!r.ok) throw new Error(`YouTube API: ${(j as { error?: { message?: string } }).error?.message ?? r.status}`);
  return j;
}

async function searchApi(key: string, q: FinderQuery, signal?: AbortSignal): Promise<Array<Omit<FinderVideo, 'score' | 'parts' | 'reasons'>>> {
  const out: Array<Omit<FinderVideo, 'score' | 'parts' | 'reasons'>> = [];
  const after = iso(q.period);
  for (const lang of q.languages.length ? q.languages : ['']) {
    /* Outliers: sem termo — a API aceita a busca só com idioma, período e ordem por views */
    const text = q.outliers ? '' : q.queries?.[lang] || q.query;
    const dur2 = q.format === 'shorts' ? '&videoDuration=short' : q.format === 'long' ? '&videoDuration=medium' : '';
    /* até 100 por idioma: a API devolve no máximo 50 por página — pagina com nextPageToken */
    const want = clamp(q.perLanguage ?? 15, 5, 100);
    const ids: string[] = [];
    let page: string | undefined;
    do {
      const s = await api<{ items?: Array<{ id: { videoId: string } }>; nextPageToken?: string }>(`search?part=id&type=video&maxResults=${Math.min(50, want - ids.length)}&order=viewCount${text ? `&q=${encodeURIComponent(text)}` : ''}${lang ? `&relevanceLanguage=${lang}` : ''}${after ? `&publishedAfter=${after}` : ''}${dur2}${page ? `&pageToken=${page}` : ''}`, key, signal);
      ids.push(...(s.items ?? []).map((x) => x.id.videoId).filter(Boolean));
      page = s.nextPageToken;
    } while (page && ids.length < want);
    if (!ids.length) continue;
    /* videos/channels aceitam até 50 ids por chamada */
    const chunks = <T,>(a: T[]) => Array.from({ length: Math.ceil(a.length / 50) }, (_, i) => a.slice(i * 50, i * 50 + 50));
    const vItems: any[] = [];
    for (const part of chunks(ids)) vItems.push(...((await api<{ items?: any[] }>(`videos?part=snippet,statistics,contentDetails&id=${part.join(',')}`, key, signal)).items ?? []));
    const chIds = [...new Set(vItems.map((x) => x.snippet?.channelId).filter(Boolean))] as string[];
    const chItems: any[] = [];
    for (const part of chunks(chIds)) chItems.push(...((await api<{ items?: any[] }>(`channels?part=snippet,statistics&id=${part.join(',')}`, key, signal)).items ?? []));
    const chMap = new Map(chItems.map((c) => [c.id, c]));
    for (const it of vItems) {
      const c = chMap.get(it.snippet?.channelId);
      out.push({
        id: it.id, title: it.snippet?.title ?? '', url: `https://www.youtube.com/watch?v=${it.id}`, thumb: it.snippet?.thumbnails?.high?.url ?? `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`,
        channel: it.snippet?.channelTitle ?? '', channelId: it.snippet?.channelId, channelUrl: `https://www.youtube.com/channel/${it.snippet?.channelId}`,
        subs: c?.statistics?.hiddenSubscriberCount ? undefined : Number(c?.statistics?.subscriberCount ?? NaN) || undefined,
        views: Number(it.statistics?.viewCount ?? 0), likes: it.statistics?.likeCount !== undefined ? Number(it.statistics.likeCount) : undefined, comments: it.statistics?.commentCount !== undefined ? Number(it.statistics.commentCount) : undefined,
        publishedAt: it.snippet?.publishedAt, ageDays: days(it.snippet?.publishedAt), channelAgeDays: days(c?.snippet?.publishedAt), channelVideos: Number(c?.statistics?.videoCount ?? NaN) || undefined,
        durationSec: dur(it.contentDetails?.duration), language: it.snippet?.defaultAudioLanguage ?? it.snippet?.defaultLanguage, searchLang: lang || 'any',
      });
    }
  }
  return out;
}

/* ───────── yt-dlp (sem chave) ───────── */

function run(exe: string, args: string[], signal?: AbortSignal): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const kill = () => { try { child.kill('SIGKILL'); } catch { /* ignora */ } };
    const timer = setTimeout(kill, 6 * 60_000);
    signal?.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}
const SP: Record<FinderQuery['period'], string> = { week: 'CAMSAggD', month: 'CAMSAggE', year: 'CAMSAggF', any: 'CAM%3D' };   // ordenar por views + período

async function searchYtDlp(s: Settings, q: FinderQuery, log: (l: string) => void, signal?: AbortSignal): Promise<Array<Omit<FinderVideo, 'score' | 'parts' | 'reasons'>>> {
  const exe = await ensureYtDlp(s, log);
  const out: Array<Omit<FinderVideo, 'score' | 'parts' | 'reasons'>> = [];
  for (const lang of q.languages.length ? q.languages : ['']) {
    const text = q.queries?.[lang] || q.query;
    const n = clamp(q.perLanguage ?? 12, 5, 100);
    log(`buscando "${text}"${lang ? ` (${LANG_NAMES[lang] ?? lang})` : ''}…`);
    const flat = await run(exe, [`https://www.youtube.com/results?search_query=${encodeURIComponent(text)}&sp=${SP[q.period]}`, '--flat-playlist', '--dump-json', '--playlist-end', String(n), '--no-warnings'], signal);
    const ids = flat.out.split(/\r?\n/).flatMap((l) => { try { const j = JSON.parse(l) as { id?: string; ie_key?: string }; return j.id && j.id.length === 11 ? [j.id] : []; } catch { return []; } });
    if (!ids.length) continue;
    /* metadados completos (inscritos, views, curtidas, comentários, data) de todos de uma vez */
    const full = await run(exe, ['--dump-json', '--skip-download', '--no-warnings', '--ignore-errors', ...ids.map((id) => `https://www.youtube.com/watch?v=${id}`)], signal);
    for (const l of full.out.split(/\r?\n/)) {
      let j: any; try { j = JSON.parse(l); } catch { continue; }
      if (!j?.id) continue;
      const up = j.upload_date ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}T00:00:00Z` : undefined;
      out.push({
        id: j.id, title: j.title ?? '', url: j.webpage_url ?? `https://www.youtube.com/watch?v=${j.id}`, thumb: `https://i.ytimg.com/vi/${j.id}/hqdefault.jpg`,
        channel: j.channel ?? j.uploader ?? '', channelId: j.channel_id, channelUrl: j.channel_url,
        subs: typeof j.channel_follower_count === 'number' ? j.channel_follower_count : undefined, views: Number(j.view_count ?? 0),
        likes: typeof j.like_count === 'number' ? j.like_count : undefined, comments: typeof j.comment_count === 'number' ? j.comment_count : undefined,
        publishedAt: up, ageDays: days(up), durationSec: j.duration, language: j.language ?? undefined, searchLang: lang || 'any',
      });
    }
  }
  return out;
}

/** Busca, pontua, filtra e agrupa por canal. */
export async function findOutliers(s: Settings, q: FinderQuery, o: { log?: (l: string) => void; signal?: AbortSignal } = {}): Promise<FinderResult> {
  const log = o.log ?? (() => {});
  const key = s.stock?.youtube?.apiKey?.trim();
  const warnings: string[] = [];
  let raw: Array<Omit<FinderVideo, 'score' | 'parts' | 'reasons'>> = [];
  let engine: FinderResult['engine'] = key ? 'api' : 'yt-dlp';
  if (key) {
    try { raw = await searchApi(key, q, o.signal); }
    catch (e) { warnings.push(`API do YouTube falhou (${(e as Error).message}) — usando o yt-dlp`); engine = 'yt-dlp'; }
  }
  if (engine === 'yt-dlp') {
    if (q.outliers) {
      /* sem chave: 3 buscas AMPLAS por idioma (sem nicho), dividindo a quantidade pedida */
      const per = Math.max(5, Math.ceil((q.perLanguage ?? 30) / 3));
      raw = [];
      for (let i = 0; i < 3; i++) {
        const queries = Object.fromEntries((q.languages.length ? q.languages : ['en']).map((l) => [l, outlierSeeds(l)[i] ?? outlierSeeds(l)[0]!]));
        raw.push(...await searchYtDlp(s, { ...q, query: queries[q.languages[0] ?? 'en'] ?? 'viral', queries, perLanguage: per }, log, o.signal));
      }
    } else raw = await searchYtDlp(s, q, log, o.signal);
    warnings.push('Sem a chave da YouTube Data API a idade do canal não é conhecida (o critério "canal novo" fica de fora).');
  }
  if (q.outliers) warnings.push(`🔥 Outliers: só canais com até ${(q.maxSubs || OUTLIER_MAX_SUBS).toLocaleString('pt-BR')} inscritos e views ≥ ${OUTLIER_MIN_RATIO}× o tamanho do canal, sem filtro de nicho.`);
  const { videos, channels } = rankVideos(raw, q, s.uiLanguage === 'en' || s.uiLanguage === 'es' ? s.uiLanguage : 'pt-BR');
  log(`${videos.length} vídeos pontuados · ${channels.length} canais`);
  return { videos, channels, engine, warnings };
}

/** Dias do período da busca (undefined = qualquer data). */
export const periodDays = (p: FinderQuery['period']): number | undefined => (p === 'week' ? 7 : p === 'month' ? 30 : p === 'year' ? 365 : undefined);

/**
 * Os MESMOS critérios para todas as plataformas: sem repetidos, views mínimas, máximo de inscritos/seguidores,
 * formato (Shorts ≤ 60 s / longos), período (quando a data é conhecida), nota e agrupamento por canal/perfil.
 */
export function rankVideos(raw: Array<Omit<FinderVideo, 'score' | 'parts' | 'reasons'>>, q: FinderQuery, ui: UiLang = 'pt-BR'): { videos: FinderVideo[]; channels: FinderChannel[]; unknownSubs?: boolean } {
  const maxAge = periodDays(q.period);
  const seen = new Set<string>();
  const filtered = raw.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)))
    .filter((v) => (q.minViews ? v.views >= q.minViews : true) && (q.maxSubs && v.subs !== undefined ? v.subs <= q.maxSubs : true))
    .filter((v) => (q.format === 'shorts' ? (v.durationSec ?? 61) <= 60 : q.format === 'long' ? (v.durationSec ?? 0) > 60 : true))
    .filter((v) => (maxAge === undefined || v.ageDays === undefined ? true : v.ageDays <= maxAge));
  /* modo Outliers: só canais pequenos com views muito acima do tamanho do canal */
  const out = q.outliers ? outlierFilter(filtered, q.maxSubs || OUTLIER_MAX_SUBS) : { kept: filtered, unknownSubs: false };
  const videos = out.kept
    .map((v) => ({ ...v, ...scoreVideo(v, q.languages, ui) }))
    .sort((a, b) => b.score - a.score);
  const map = new Map<string, FinderChannel>();
  for (const v of videos) {
    const k = v.channelId ?? v.channel;
    const c = map.get(k) ?? { platform: v.platform, channel: v.channel, channelId: v.channelId, channelUrl: v.channelUrl, subs: v.subs, channelAgeDays: v.channelAgeDays, best: 0, hits: 0, languages: [], avgRatio: 0 };
    c.best = Math.max(c.best, v.score); c.hits++;
    if (!c.languages.includes(v.searchLang)) c.languages.push(v.searchLang);
    c.avgRatio = (c.avgRatio * (c.hits - 1) + v.views / Math.max(v.subs ?? 500, 500)) / c.hits;
    map.set(k, c);
  }
  const channels = [...map.values()].sort((a, b) => b.best - a.best || b.avgRatio - a.avgRatio);
  return { videos, channels, unknownSubs: out.unknownSubs || undefined };
}
