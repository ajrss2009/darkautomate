import { spawn } from 'node:child_process';
import type { Channel, ChannelAnalytics, ChannelPlatform, Settings } from '../shared/types';
import { httpFetch } from './http';
import { ensureYtDlp } from './youtube';
import { parseChannelLink } from './channel-setup';

/*
 * ANÁLISE DE CANAL (aba Canais): métricas do canal/perfil do usuário.
 *  - YouTube: YouTube Data API v3 com a chave de Configurações → Bancos de mídia (stock.youtube.apiKey);
 *  - TikTok: Display API (token de usuário: user.info.stats + video.list);
 *  - Facebook: Graph API (token de página: fan_count + vídeos/publicações);
 *  - Instagram: Graph API (token + id da conta profissional; business_discovery para qualquer perfil comercial);
 *  - Kwai: sem API pública de métricas → yt-dlp (melhor esforço).
 * Sem chave/token, ou se a API falhar, cai no yt-dlp (lista pública dos últimos itens). Só leitura.
 * O resumo (médias, engajamento, cadência, melhor dia/hora) é função pura — testável sem rede.
 */

type FetchFn = typeof fetch;

/** Item publicado (vídeo, reel, post) no formato comum das plataformas. */
export interface MediaItem {
  id: string; title?: string; url?: string;
  views?: number; likes?: number; comments?: number; shares?: number;
  durationSec?: number;
  /** ISO 8601 */
  publishedAt?: string;
}

const median = (a: number[]) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m]! : (b[m - 1]! + b[m]!) / 2; };
const r1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? n : undefined; };

/** Métricas a partir dos itens (função pura). */
export function summarizeItems(items: MediaItem[], base: Pick<ChannelAnalytics, 'platform' | 'source'> & Partial<ChannelAnalytics>): ChannelAnalytics {
  const views = items.map((i) => i.views).filter((v): v is number => typeof v === 'number' && v >= 0);
  const avg = views.length ? views.reduce((a, b) => a + b, 0) / views.length : undefined;
  /* engajamento = (curtidas + comentários + compartilhamentos) ÷ views, só nos itens com views */
  const eng = items.filter((i) => (i.views ?? 0) > 0 && (i.likes !== undefined || i.comments !== undefined));
  const engagementRate = eng.length ? r1((eng.reduce((a, i) => a + (i.likes ?? 0) + (i.comments ?? 0) + (i.shares ?? 0), 0) / eng.reduce((a, i) => a + (i.views ?? 0), 0)) * 100) : undefined;
  const dates = items.map((i) => (i.publishedAt ? Date.parse(i.publishedAt) : NaN)).filter((d) => !Number.isNaN(d)).sort((a, b) => a - b);
  const spanDays = dates.length >= 2 ? (dates[dates.length - 1]! - dates[0]!) / 864e5 : 0;
  const durs = items.map((i) => i.durationSec).filter((d): d is number => typeof d === 'number' && d > 0);
  /* melhor dia da semana / hora (UTC): média de views por grupo, exigindo ≥ 2 itens no grupo */
  const best = (key: (d: Date) => number): number | undefined => {
    const g = new Map<number, number[]>();
    for (const i of items) { if (!i.publishedAt || i.views === undefined) continue; const d = new Date(i.publishedAt); if (Number.isNaN(d.getTime())) continue; const k = key(d); g.set(k, [...(g.get(k) ?? []), i.views]); }
    const rows = [...g.entries()].filter(([, v]) => v.length >= 2).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length] as const).sort((a, b) => b[1] - a[1]);
    return rows[0]?.[0];
  };
  const top = [...items].filter((i) => i.views !== undefined).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5)
    .map((i) => ({ id: i.id, title: i.title ?? '', views: i.views, url: i.url, at: i.publishedAt }));
  const out: ChannelAnalytics = {
    at: new Date().toISOString(), ...base,
    sample: items.length,
    avgViews: avg !== undefined ? Math.round(avg) : undefined,
    medianViews: views.length ? Math.round(median(views)) : undefined,
    maxViews: views.length ? Math.max(...views) : undefined,
    engagementRate,
    uploadsPerWeek: spanDays > 0 ? r1(((dates.length - 1) / spanDays) * 7) : undefined,
    avgDurationSec: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : undefined,
    shortsShare: durs.length ? Math.round((durs.filter((d) => d <= 60).length / durs.length) * 100) / 100 : undefined,
    bestWeekday: best((d) => d.getUTCDay()), bestHourUtc: best((d) => d.getUTCHours()),
    top,
  };
  out.insights = [...(base.insights ?? []), ...ruleInsights(out)];
  return out;
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Recomendações por regra (sem IA), a partir das métricas. */
export function ruleInsights(a: ChannelAnalytics): string[] {
  const out: string[] = [];
  if (a.followers && a.avgViews !== undefined) {
    const ratio = a.avgViews / a.followers;
    if (ratio < 0.05) out.push(`Views médias são ${Math.round(ratio * 1000) / 10}% dos seguidores: o público atual não está vendo os vídeos — teste ganchos e thumbnails novos (o algoritmo está entregando pouco).`);
    else if (ratio > 0.5) out.push(`Views médias passam de ${Math.round(ratio * 100)}% dos seguidores: o conteúdo viaja além da base — é hora de aumentar a frequência.`);
  }
  if (a.medianViews && a.maxViews && a.maxViews > a.medianViews * 5) out.push(`Há outliers (recorde ${a.maxViews.toLocaleString('pt-BR')} vs. mediana ${a.medianViews.toLocaleString('pt-BR')}): repita o formato e o tema do vídeo mais visto (${a.top?.[0]?.title?.slice(0, 60) ?? '—'}).`);
  if (a.uploadsPerWeek !== undefined) {
    if (a.uploadsPerWeek < 1) out.push(`Cadência baixa (${a.uploadsPerWeek}/semana): canais que crescem publicam ao menos 2–3 vezes por semana; produza em lote.`);
    else if (a.uploadsPerWeek >= 7) out.push(`Cadência alta (${a.uploadsPerWeek}/semana): confira se a mediana de views não está caindo com o volume.`);
  }
  if (a.engagementRate !== undefined) {
    if (a.engagementRate < 1) out.push(`Engajamento baixo (${a.engagementRate}%): peça uma ação específica no meio do vídeo (comentar uma resposta) em vez de só no final.`);
    else if (a.engagementRate > 6) out.push(`Engajamento alto (${a.engagementRate}%): a comunidade responde — use os comentários como fonte de pautas.`);
  }
  if (a.bestWeekday !== undefined) out.push(`Melhor dia (views médias): ${WEEKDAYS[a.bestWeekday]}${a.bestHourUtc !== undefined ? `, por volta de ${a.bestHourUtc}h UTC` : ''}.`);
  if (a.shortsShare !== undefined && a.platform === 'youtube') {
    if (a.shortsShare >= 0.8) out.push('Quase só Shorts: inclua vídeos longos para monetizar melhor (RPM do longo é bem maior).');
    else if (a.shortsShare < 0.1) out.push('Quase sem Shorts: cortes verticais dos vídeos longos trazem inscritos novos a custo baixo.');
  }
  return out;
}

/* ───────── leitores das APIs (respostas → MediaItem), puros ───────── */

const isoDur = (s?: string) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s ?? ''); return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : undefined; };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function youtubeItems(videos: { items?: any[] }): MediaItem[] {
  return (videos.items ?? []).map((v) => ({
    id: String(v.id), title: v.snippet?.title, url: `https://www.youtube.com/watch?v=${v.id}`,
    views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount),
    durationSec: isoDur(v.contentDetails?.duration), publishedAt: v.snippet?.publishedAt,
  }));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tiktokItems(list: { data?: { videos?: any[] } }): MediaItem[] {
  return (list.data?.videos ?? []).map((v) => ({
    id: String(v.id), title: v.title || v.video_description, url: v.share_url,
    views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count),
    durationSec: num(v.duration), publishedAt: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : undefined,
  }));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function facebookItems(list: { data?: any[] }): MediaItem[] {
  return (list.data ?? []).map((v) => ({
    id: String(v.id), title: v.title ?? v.description?.slice(0, 80) ?? v.message?.slice(0, 80), url: v.permalink_url,
    views: num(v.views), likes: num(v.likes?.summary?.total_count ?? v.reactions?.summary?.total_count), comments: num(v.comments?.summary?.total_count),
    shares: num(v.shares?.count), durationSec: num(v.length), publishedAt: v.created_time,
  }));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function instagramItems(media: { data?: any[] }): MediaItem[] {
  return (media.data ?? []).map((v) => ({
    id: String(v.id), title: v.caption?.slice(0, 80), url: v.permalink,
    /* business_discovery não devolve views: os reels trazem view_count/play_count quando a conta é a própria */
    views: num(v.view_count ?? v.play_count ?? v.video_view_count), likes: num(v.like_count), comments: num(v.comments_count),
    publishedAt: v.timestamp,
  }));
}
/** Entrada do yt-dlp (-J --flat-playlist) → item. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ytdlpItems(j: { entries?: any[] }): MediaItem[] {
  return (j.entries ?? []).filter((e) => e?.id).map((e) => ({
    id: String(e.id), title: e.title, url: e.url ?? e.webpage_url,
    views: num(e.view_count), likes: num(e.like_count), comments: num(e.comment_count),
    durationSec: num(e.duration),
    publishedAt: e.timestamp ? new Date(Number(e.timestamp) * 1000).toISOString() : e.upload_date ? `${String(e.upload_date).slice(0, 4)}-${String(e.upload_date).slice(4, 6)}-${String(e.upload_date).slice(6, 8)}T00:00:00Z` : undefined,
  }));
}

/* ───────── rede ───────── */

async function getJson<T>(f: FetchFn, url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const r = await f(url, { ...init, signal: signal ?? AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => ({})) as T & { error?: { message?: string } | string };
  if (!r.ok) {
    const e = (j as { error?: { message?: string } | string }).error;
    throw new Error(typeof e === 'string' ? e : e?.message ?? `HTTP ${r.status}`);
  }
  return j;
}

const YT = 'https://www.googleapis.com/youtube/v3';
const GRAPH = 'https://graph.facebook.com/v19.0';

export async function youtubeApi(key: string, link: string, f: FetchFn, signal?: AbortSignal): Promise<ChannelAnalytics> {
  const l = parseChannelLink(link);
  const k = `key=${encodeURIComponent(key)}`;
  const sel = l.id ? `id=${encodeURIComponent(l.id)}` : `forHandle=${encodeURIComponent(l.handle ?? '')}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ch = await getJson<{ items?: any[] }>(f, `${YT}/channels?part=snippet,statistics,contentDetails&${sel}&${k}`, undefined, signal);
  const c = ch.items?.[0];
  if (!c) throw new Error('canal não encontrado na API do YouTube');
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pl = uploads ? await getJson<{ items?: any[] }>(f, `${YT}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}&${k}`, undefined, signal) : { items: [] };
  const ids = (pl.items ?? []).map((x) => x.contentDetails?.videoId).filter(Boolean).slice(0, 50);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vids = ids.length ? await getJson<{ items?: any[] }>(f, `${YT}/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}&${k}`, undefined, signal) : { items: [] };
  return summarizeItems(youtubeItems(vids), {
    platform: 'youtube', source: 'api', title: c.snippet?.title, handle: c.snippet?.customUrl ?? l.handle,
    followers: c.statistics?.hiddenSubscriberCount ? undefined : num(c.statistics?.subscriberCount),
    totalViews: num(c.statistics?.viewCount), mediaCount: num(c.statistics?.videoCount),
  });
}

export async function tiktokApi(token: string, f: FetchFn, signal?: AbortSignal): Promise<ChannelAnalytics> {
  const auth = { Authorization: `Bearer ${token}` };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = await getJson<{ data?: { user?: any } }>(f, 'https://open.tiktokapis.com/v2/user/info/?fields=display_name,username,follower_count,likes_count,video_count', { headers: auth }, signal);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = await getJson<{ data?: { videos?: any[] } }>(f, 'https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,share_url,view_count,like_count,comment_count,share_count,duration,create_time',
    { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_count: 20 }) }, signal);
  const user = u.data?.user ?? {};
  return summarizeItems(tiktokItems(v), { platform: 'tiktok', source: 'api', title: user.display_name, handle: user.username ? `@${user.username}` : undefined,
    followers: num(user.follower_count), mediaCount: num(user.video_count) });
}

export async function facebookApi(token: string, page: string, f: FetchFn, signal?: AbortSignal): Promise<ChannelAnalytics> {
  const t = `access_token=${encodeURIComponent(token)}`;
  const id = encodeURIComponent(page || 'me');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = await getJson<any>(f, `${GRAPH}/${id}?fields=name,username,fan_count,followers_count&${t}`, undefined, signal);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = await getJson<{ data?: any[] }>(f, `${GRAPH}/${id}/videos?fields=title,description,created_time,length,views,permalink_url,likes.summary(true),comments.summary(true)&limit=25&${t}`, undefined, signal)
    .catch(() => getJson<{ data?: any[] }>(f, `${GRAPH}/${id}/posts?fields=message,created_time,permalink_url,shares,reactions.summary(true),comments.summary(true)&limit=25&${t}`, undefined, signal));
  return summarizeItems(facebookItems(v), { platform: 'facebook', source: 'api', title: p.name, handle: p.username ? `@${p.username}` : undefined,
    followers: num(p.followers_count ?? p.fan_count) });
}

export async function instagramApi(token: string, userId: string, username: string, f: FetchFn, signal?: AbortSignal): Promise<ChannelAnalytics> {
  if (!userId) throw new Error('informe o id da conta profissional do Instagram (Configurações → Canais)');
  const t = `access_token=${encodeURIComponent(token)}`;
  const u = username.replace(/^@/, '');
  const fields = `business_discovery.username(${encodeURIComponent(u)}){name,username,followers_count,media_count,media.limit(25){caption,like_count,comments_count,timestamp,media_type,permalink}}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await getJson<{ business_discovery?: any }>(f, `${GRAPH}/${encodeURIComponent(userId)}?fields=${fields}&${t}`, undefined, signal);
  const b = r.business_discovery ?? {};
  const out = summarizeItems(instagramItems(b.media ?? {}), { platform: 'instagram', source: 'api', title: b.name, handle: b.username ? `@${b.username}` : undefined,
    followers: num(b.followers_count), mediaCount: num(b.media_count) });
  if (out.avgViews === undefined) out.warnings = [...(out.warnings ?? []), 'a API não informa views de perfis de terceiros: engajamento e cadência vêm de curtidas e comentários'];
  return out;
}

/** Lista pública (yt-dlp) — reserva universal, sem chave. */
export async function ytdlpListing(s: Settings, url: string, platform: ChannelPlatform, log: (l: string) => void, signal?: AbortSignal): Promise<ChannelAnalytics> {
  const exe = await ensureYtDlp(s, log);
  const target = platform === 'youtube' ? `${url.replace(/\/+$/, '').replace(/\/(videos|shorts|featured)$/i, '')}/videos` : url;
  log(`listando ${target} pelo yt-dlp…`);
  const r = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const c = spawn(exe, ['-J', '--flat-playlist', '--playlist-end', '30', '--no-warnings', '--', target], { windowsHide: true });
    let out = '', err = '';
    c.stdout.on('data', (d: Buffer) => { out += d.toString(); }); c.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
    const kill = () => c.kill(); signal?.addEventListener('abort', kill, { once: true });
    c.on('error', (e) => resolve({ code: -1, out, err: e.message }));
    c.on('close', (code) => { signal?.removeEventListener('abort', kill); resolve({ code, out, err }); });
  });
  if (r.code !== 0) throw new Error(`o yt-dlp não conseguiu listar o perfil (${r.err.trim().split('\n').pop()?.slice(0, 160) ?? 'erro'})`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let j: any; try { j = JSON.parse(r.out); } catch { throw new Error('resposta inválida do yt-dlp'); }
  return summarizeItems(ytdlpItems(j), { platform, source: 'yt-dlp', title: j.channel ?? j.uploader ?? j.title, followers: num(j.channel_follower_count) });
}

export interface AnalyzeOptions { log?: (l: string) => void; signal?: AbortSignal; fetch?: FetchFn; ytdlp?: typeof ytdlpListing }

/** Analisa o canal: API oficial quando há credencial; senão (ou se falhar) yt-dlp. */
export async function analyzeChannel(s: Settings, ch: Channel, o: AnalyzeOptions = {}): Promise<ChannelAnalytics> {
  const log = o.log ?? (() => {});
  const f = o.fetch ?? httpFetch();
  if (!ch.url) throw new Error('o canal precisa do link para ser analisado');
  const l = parseChannelLink(ch.url);
  const apis = s.channelApis ?? {};
  const warnings: string[] = [];
  let api: (() => Promise<ChannelAnalytics>) | undefined;
  if (ch.platform === 'youtube') { const k = s.stock?.youtube?.apiKey?.trim(); if (k) api = () => youtubeApi(k, ch.url!, f, o.signal); else warnings.push('sem a chave da YouTube Data API (Configurações → Bancos de mídia → YouTube) — usando o yt-dlp'); }
  if (ch.platform === 'tiktok') { const t = apis.tiktok?.token?.trim(); if (t) api = () => tiktokApi(t, f, o.signal); else warnings.push('sem o token da TikTok Display API — usando o yt-dlp'); }
  if (ch.platform === 'facebook') { const t = apis.facebook?.token?.trim(); if (t) api = () => facebookApi(t, l.id ?? l.handle?.replace(/^@/, '') ?? 'me', f, o.signal); else warnings.push('sem o token da Graph API do Facebook — usando o yt-dlp'); }
  if (ch.platform === 'instagram') { const t = apis.instagram?.token?.trim(); if (t) api = () => instagramApi(t, apis.instagram?.userId?.trim() ?? '', l.handle ?? ch.handle ?? '', f, o.signal); else warnings.push('sem o token da Graph API do Instagram — usando o yt-dlp'); }
  if (ch.platform === 'kwai') warnings.push('o Kwai não tem API pública de métricas — análise pela lista pública (yt-dlp), melhor esforço');
  if (api) {
    try { const a = await api(); log(`análise pela API oficial: ${a.sample} itens`); return a; }
    catch (e) { warnings.push(`API falhou (${(e as Error).message.slice(0, 160)}) — usando o yt-dlp`); }
  }
  const a = await (o.ytdlp ?? ytdlpListing)(s, ch.url, ch.platform, log, o.signal);
  a.warnings = [...warnings, ...(a.warnings ?? [])];
  return a;
}

/** Resumo de uma linha (para prompts: marca, clone e insights por IA). */
export function analyticsLine(a?: ChannelAnalytics): string {
  if (!a) return '';
  return [a.followers !== undefined && `${a.followers} seguidores`, a.avgViews !== undefined && `média ${a.avgViews} views`, a.medianViews !== undefined && `mediana ${a.medianViews}`,
    a.engagementRate !== undefined && `engajamento ${a.engagementRate}%`, a.uploadsPerWeek !== undefined && `${a.uploadsPerWeek} posts/semana`,
    a.avgDurationSec !== undefined && `duração média ${a.avgDurationSec} s`, a.top?.[0] && `mais visto: "${a.top[0].title.slice(0, 60)}"`].filter(Boolean).join(' · ');
}
