/*
 * PESQUISAR em TikTok, Instagram, Facebook e Kwai SEM API: o app abre a página de busca da rede num navegador
 * invisível (sessão própria por rede — o usuário faz o login uma vez, numa janela visível, se a rede exigir),
 * rola a página, lê os cartões de vídeo (link, texto, autor, contagens visíveis) e dá uma nota a cada um.
 * No TikTok, o yt-dlp completa views/curtidas/comentários/data de cada vídeo (não precisa de login).
 * Este arquivo é puro (nada de electron): quem abre a página é injetado (main.ts) — testável.
 */

import { rankVideos, type FinderQuery, type FinderResult, type FinderVideo } from './finder';

export type SocialPlatform = 'tiktok' | 'instagram' | 'facebook' | 'kwai';

export interface SocialSite { label: string; icon: string; home: string; search: (q: string) => string; tag?: (q: string) => string; login: string; needsLogin: boolean; note: string }

const enc = encodeURIComponent;
const tagOf = (q: string) => q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

export const SOCIAL_SITES: Record<SocialPlatform, SocialSite> = {
  tiktok: { label: 'TikTok', icon: '🎵', home: 'https://www.tiktok.com/', search: (q) => `https://www.tiktok.com/search/video?q=${enc(q)}`, tag: (q) => `https://www.tiktok.com/tag/${enc(tagOf(q))}`,
    login: 'https://www.tiktok.com/login', needsLogin: false, note: 'funciona sem login; com login a busca traz mais resultados' },
  instagram: { label: 'Instagram', icon: '📸', home: 'https://www.instagram.com/', search: (q) => `https://www.instagram.com/explore/search/keyword/?q=${enc(q)}`, tag: (q) => `https://www.instagram.com/explore/tags/${enc(tagOf(q))}/`,
    login: 'https://www.instagram.com/accounts/login/', needsLogin: true, note: 'precisa de login (o Instagram não mostra a busca para visitantes)' },
  facebook: { label: 'Facebook', icon: '📘', home: 'https://www.facebook.com/', search: (q) => `https://www.facebook.com/search/videos/?q=${enc(q)}`,
    login: 'https://www.facebook.com/login', needsLogin: true, note: 'precisa de login (a busca de vídeos do Facebook é só para contas)' },
  kwai: { label: 'Kwai', icon: '🎬', home: 'https://www.kwai.com/', search: (q) => `https://www.kwai.com/discover/${enc(q.trim().replace(/\s+/g, '-'))}`,
    login: 'https://www.kwai.com/', needsLogin: false, note: 'usa as páginas públicas de tema do Kwai (melhor esforço)' },
};

export const isSocialPlatform = (x: unknown): x is SocialPlatform => typeof x === 'string' && x in SOCIAL_SITES;

/** Cartão cru lido da página (o script de extração devolve isto). */
export interface RawCard { href: string; text?: string; img?: string; label?: string }

export interface SocialVideo {
  platform: SocialPlatform; id: string; url: string; title: string; author?: string; authorUrl?: string; thumb?: string;
  /** seguidores do perfil (quando o yt-dlp informa) */
  followers?: number; language?: string;
  views?: number; likes?: number; comments?: number; shares?: number; durationSec?: number; publishedAt?: string; ageDays?: number;
  score: number; reasons: string[];
}
export interface SocialAuthor { author: string; authorUrl?: string; hits: number; best: number; views: number }
export interface SocialResult { platform: SocialPlatform; query: string; url: string; videos: SocialVideo[]; authors: SocialAuthor[]; warnings: string[]; loginWall?: boolean }

/**
 * "1,2 mi", "3.4M", "12 mil", "12K", "1.234", "1 234 visualizações" → número. Função pura.
 * Vírgula ou ponto com 1–2 casas antes do sufixo = decimal; com 3 dígitos depois = milhar.
 */
export function parseCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /(\d[\d.,\s ]*)\s*(mi(?:l(?:h(?:ões|ão))?)?|mil|bi|k|m|b|mln|tsd)?\b/i.exec(raw.replace(/ /g, ' '));
  if (!m) return undefined;
  let digits = m[1]!.trim().replace(/[\s ]/g, '');
  const suf = (m[2] ?? '').toLowerCase();
  const mult = suf === 'k' || suf === 'mil' || suf === 'tsd' ? 1e3 : suf === 'm' || suf === 'mi' || suf === 'mln' || suf.startsWith('milh') ? 1e6 : suf === 'b' || suf === 'bi' ? 1e9 : 1;
  if (mult > 1) digits = digits.replace(',', '.').replace(/\.(?=.*\.)/g, '');
  else digits = /[.,]\d{3}$/.test(digits) || /[.,]\d{3}[.,]/.test(digits) ? digits.replace(/[.,]/g, '') : digits.replace(',', '.');
  const n = Number(digits) * mult;
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** Conta perto de uma palavra-chave no texto do cartão ("12 mil curtidas", "views 3.4M"). */
function countNear(text: string, words: RegExp): number | undefined {
  const re = new RegExp(`(\\d[\\d.,\\s]*\\s*(?:mi|mil|k|m|b|bi)?)\\s*(?:${words.source})|(?:${words.source})\\s*[:·]?\\s*(\\d[\\d.,]*\\s*(?:mi|mil|k|m|b|bi)?)`, 'i');
  const m = re.exec(text);
  return m ? parseCount(m[1] ?? m[2]) : undefined;
}

/** id e autor a partir do link do vídeo/post, por rede. */
export function parseSocialUrl(platform: SocialPlatform, href: string): { id: string; url: string; author?: string; authorUrl?: string } | undefined {
  let u: URL;
  try { u = new URL(href, SOCIAL_SITES[platform].home); } catch { return undefined; }
  const p = u.pathname;
  if (platform === 'tiktok') {
    const m = /^\/@([^/]+)\/(?:video|photo)\/(\d+)/.exec(p);
    return m ? { id: m[2]!, url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`, author: `@${m[1]}`, authorUrl: `https://www.tiktok.com/@${m[1]}` } : undefined;
  }
  if (platform === 'instagram') {
    const m = /^\/(?:([\w.]+)\/)?(reel|reels|p)\/([\w-]+)/.exec(p);
    return m ? { id: m[3]!, url: `https://www.instagram.com/${m[2] === 'p' ? 'p' : 'reel'}/${m[3]}/`, author: m[1] ? `@${m[1]}` : undefined, authorUrl: m[1] ? `https://www.instagram.com/${m[1]}/` : undefined } : undefined;
  }
  if (platform === 'facebook') {
    const v = u.searchParams.get('v');
    if (/^\/watch\/?$/.test(p) && v) return { id: v, url: `https://www.facebook.com/watch/?v=${v}` };
    const r = /^\/reel\/(\d+)/.exec(p);
    if (r) return { id: r[1]!, url: `https://www.facebook.com/reel/${r[1]}` };
    const m = /^\/([\w.]+)\/videos\/(?:[\w-]+\/)?(\d+)/.exec(p);
    return m ? { id: m[2]!, url: `https://www.facebook.com/${m[1]}/videos/${m[2]}`, author: m[1], authorUrl: `https://www.facebook.com/${m[1]}` } : undefined;
  }
  /* kwai: /@autor/video/123 ou /photo/123 ou /short-video/123 */
  const m = /^\/(?:@([\w.-]+)\/)?(?:video|photo|short-video)\/([\w-]+)/.exec(p);
  return m ? { id: m[2]!, url: `https://www.kwai.com${m[1] ? `/@${m[1]}` : ''}/video/${m[2]}`, author: m[1] ? `@${m[1]}` : undefined, authorUrl: m[1] ? `https://www.kwai.com/@${m[1]}` : undefined } : undefined;
}

const VIEWS = /visualiza(?:ções|ção|coes)|views?|plays?|reproduç(?:ões|ão)|vistas?/;
const LIKES = /curtidas?|likes?|reações|reactions|me gusta/;
const COMMENTS = /comentários?|comments?|comentarios?/;

/** Cartões crus → vídeos (sem repetidos), com contagens lidas do texto do cartão. Função pura. */
export function cardsToVideos(platform: SocialPlatform, cards: RawCard[]): Array<Omit<SocialVideo, 'score' | 'reasons'>> {
  const seen = new Set<string>();
  const out: Array<Omit<SocialVideo, 'score' | 'reasons'>> = [];
  for (const c of cards) {
    const id = parseSocialUrl(platform, c.href);
    if (!id || seen.has(id.id)) continue;
    seen.add(id.id);
    const text = `${c.label ?? ''} ${c.text ?? ''}`.replace(/\s+/g, ' ').trim();
    /* TikTok mostra só o número de views no cartão (sem palavra) — o primeiro número curto do cartão */
    const bare = platform === 'tiktok' || platform === 'kwai' ? parseCount(/(?:^|\s)(\d[\d.,]*\s*[kmb]?)(?=\s|$)/i.exec(c.text ?? '')?.[1]) : undefined;
    const title = (c.label || c.text || '').replace(/\s+/g, ' ').replace(/(?:^|\s)\d[\d.,]*\s*[kmb]?(?=\s|$)/gi, ' ').trim().slice(0, 160) || id.id;
    out.push({ platform, ...id, title, thumb: c.img, views: countNear(text, VIEWS) ?? bare, likes: countNear(text, LIKES), comments: countNear(text, COMMENTS) });
  }
  return out;
}

const pct = (sorted: number[], v: number) => (sorted.length <= 1 ? 1 : sorted.filter((x) => x < v).length / (sorted.length - 1));

/**
 * Nota 0–100 RELATIVA à busca (sem inscritos conhecidos): views no percentil da busca (45), velocidade (25,
 * views por dia), engajamento (20, curtidas+comentários ÷ views) e ser recente (10). Função pura.
 */
export function scoreSocial(list: Array<Omit<SocialVideo, 'score' | 'reasons'>>, now = Date.now()): SocialVideo[] {
  const age = (v: { publishedAt?: string; ageDays?: number }) => v.ageDays ?? (v.publishedAt ? Math.max(0, Math.round((now - Date.parse(v.publishedAt)) / 864e5)) : undefined);
  const views = list.map((v) => v.views ?? 0).sort((a, b) => a - b);
  const vel = list.map((v) => { const a = age(v); return v.views && a !== undefined ? v.views / Math.max(1, a) : 0; }).sort((a, b) => a - b);
  return list.map((v) => {
    const a = age(v);
    const reasons: string[] = [];
    let s = 0;
    if (v.views !== undefined) { const p = pct(views, v.views); s += 45 * p; if (p >= 0.8) reasons.push(`🚀 entre os mais vistos da busca (${v.views.toLocaleString('pt-BR')} views)`); }
    if (v.views && a !== undefined) { const perDay = v.views / Math.max(1, a); const p = pct(vel, perDay); s += 25 * p; if (p >= 0.8) reasons.push(`⚡ ${Math.round(perDay).toLocaleString('pt-BR')} views por dia`); }
    if (v.views && (v.likes !== undefined || v.comments !== undefined)) {
      const e = ((v.likes ?? 0) + (v.comments ?? 0) + (v.shares ?? 0)) / v.views;
      s += 20 * Math.min(1, e / 0.1);
      if (e >= 0.06) reasons.push(`❤️ engajamento de ${Math.round(e * 1000) / 10}%`);
    }
    if (a !== undefined && a <= 14) { s += 10; reasons.push(`🆕 publicado há ${a} dia(s)`); }
    return { ...v, ageDays: a, score: Math.round(Math.min(100, s)), reasons };
  }).sort((x, y) => y.score - x.score);
}

/** Autores que mais aparecem e com melhor nota (para clonar/estudar o perfil). */
export function groupAuthors(list: SocialVideo[]): SocialAuthor[] {
  const m = new Map<string, SocialAuthor>();
  for (const v of list) {
    if (!v.author) continue;
    const a = m.get(v.author) ?? { author: v.author, authorUrl: v.authorUrl, hits: 0, best: 0, views: 0 };
    a.hits++; a.best = Math.max(a.best, v.score); a.views += v.views ?? 0;
    m.set(v.author, a);
  }
  return [...m.values()].sort((a, b) => b.best - a.best || b.views - a.views);
}

/** Página pedindo login (sem cartões): detecta pelo texto/URL. */
export const looksLikeLoginWall = (url: string, text: string): boolean =>
  /\/(accounts\/)?login|checkpoint/.test(url) || /(entre|faça login|log in|inicia sesión|sign up).{0,40}(para (ver|continuar)|to (see|continue))/i.test(text);

/**
 * Script executado na página de busca: rola algumas vezes e devolve os cartões (link do vídeo, texto do
 * cartão, imagem e aria-label). Seletores amplos de propósito — as redes mudam as classes com frequência.
 */
export function extractScript(platform: SocialPlatform, max = 40, scrolls = 6): string {
  const pattern = platform === 'tiktok' ? '/video/' : platform === 'instagram' ? '/reel|/p/' : platform === 'facebook' ? '/videos/|/reel/|/watch' : '/video/|/photo/|/short-video/';
  return `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const re = new RegExp(${JSON.stringify(pattern)});
  const seen = new Map();
  for (let i = 0; i <= ${scrolls}; i++) {
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.href; if (!re.test(href) || seen.has(href)) continue;
      let card = a; for (let k = 0; k < 4 && card.parentElement && (card.innerText || '').length < 30; k++) card = card.parentElement;
      const img = a.querySelector('img') || card.querySelector('img');
      seen.set(href, { href, text: (card.innerText || '').slice(0, 500), img: img ? (img.currentSrc || img.src || '') : '', label: (a.getAttribute('aria-label') || img?.getAttribute('alt') || '').slice(0, 300) });
      if (seen.size >= ${max}) break;
    }
    if (seen.size >= ${max}) break;
    window.scrollBy(0, window.innerHeight * 0.9); await sleep(1200);
  }
  return { url: location.href, text: (document.body && document.body.innerText || '').slice(0, 1500), cards: [...seen.values()] };
})()`;
}

/** Dados que o yt-dlp devolve de um vídeo (TikTok) → campos do vídeo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ytdlpEnrich(v: Omit<SocialVideo, 'score' | 'reasons'>, j: any): Omit<SocialVideo, 'score' | 'reasons'> {
  if (!j || typeof j !== 'object') return v;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const up = typeof j.timestamp === 'number' ? new Date(j.timestamp * 1000).toISOString() : typeof j.upload_date === 'string' ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}T00:00:00Z` : undefined;
  return { ...v, title: (j.title || j.description || v.title || '').slice(0, 160), views: n(j.view_count) ?? v.views, likes: n(j.like_count) ?? v.likes, comments: n(j.comment_count) ?? v.comments,
    shares: n(j.repost_count) ?? v.shares, durationSec: n(j.duration) ?? v.durationSec, publishedAt: up ?? v.publishedAt, thumb: v.thumb || j.thumbnail,
    author: v.author ?? (j.uploader ? `@${String(j.uploader).replace(/^@/, '')}` : undefined),
    authorUrl: v.authorUrl ?? (typeof j.uploader_url === 'string' ? j.uploader_url : typeof j.channel_url === 'string' ? j.channel_url : undefined),
    followers: n(j.channel_follower_count) ?? v.followers, language: typeof j.language === 'string' ? j.language : v.language };
}

export interface SocialDeps {
  /** abre a URL num navegador invisível com a sessão da rede, roda o script e devolve o resultado */
  browse: (platform: SocialPlatform, url: string, script: string) => Promise<{ url: string; text: string; cards: RawCard[] }>;
  /** metadados de vários vídeos pelo yt-dlp (opcional) */
  ytdlp?: (urls: string[]) => Promise<unknown[]>;
  log?: (l: string) => void;
}

/** Pesquisa numa rede: página de busca (e, se vier vazia, a página da hashtag), nota e autores. */
export async function searchSocial(platform: SocialPlatform, query: string, d: SocialDeps, o: { max?: number; enrich?: boolean } = {}): Promise<SocialResult> {
  const r = await scrapeSocial(platform, query, d, o);
  const videos = scoreSocial(r.raw);
  return { platform, query: query.trim(), url: r.url, videos, authors: groupAuthors(videos), warnings: r.warnings, loginWall: r.loginWall };
}

/** Rolagens necessárias para juntar `max` cartões (≈ 6 novos por tela). */
export const scrollsFor = (max: number) => Math.max(3, Math.min(40, Math.ceil(max / 5) + 2));

/** Lê a busca (sem nota): cartões → vídeos, reserva pela hashtag e números completados pelo yt-dlp. */
export async function scrapeSocial(platform: SocialPlatform, query: string, d: SocialDeps, o: { max?: number; enrich?: boolean } = {}): Promise<{ raw: Array<Omit<SocialVideo, 'score' | 'reasons'>>; url: string; warnings: string[]; loginWall?: boolean }> {
  const site = SOCIAL_SITES[platform];
  const q = query.trim();
  if (!q) throw new Error('escreva o termo da pesquisa');
  const max = Math.max(8, Math.min(100, o.max ?? 30));
  const warnings: string[] = [];
  const log = d.log ?? (() => {});
  let url = site.search(q);
  log(`${site.label}: abrindo ${url}`);
  let page = await d.browse(platform, url, extractScript(platform, max, scrollsFor(max)));
  let raw = cardsToVideos(platform, page.cards);
  if (!raw.length && site.tag) {
    url = site.tag(q);
    log(`${site.label}: sem resultados na busca — tentando a hashtag ${url}`);
    page = await d.browse(platform, url, extractScript(platform, max, scrollsFor(max)));
    raw = cardsToVideos(platform, page.cards);
  }
  const loginWall = !raw.length && (site.needsLogin || looksLikeLoginWall(page.url, page.text));
  if (loginWall) warnings.push(`${site.label} pediu login: clique em "Entrar no ${site.label}", faça o login na janela e pesquise de novo (${site.note}).`);
  else if (!raw.length) warnings.push(`${site.label} não mostrou vídeos para "${q}" (a página pode ter mudado ou exigir login).`);
  raw = raw.slice(0, max);
  /* views/curtidas/data/seguidores: o yt-dlp lê cada vídeo (TikTok sem login; as outras com os cookies da sessão) */
  if (raw.length && d.ytdlp && (o.enrich ?? true)) {
    try {
      const infos = await d.ytdlp(raw.slice(0, 40).map((v) => v.url));
      const byId = new Map(infos.map((j) => [String((j as { id?: unknown })?.id ?? ''), j]));
      raw = raw.map((v) => (byId.has(v.id) ? ytdlpEnrich(v, byId.get(v.id)) : v));
      log(`${site.label}: ${byId.size} vídeo(s) completados pelo yt-dlp (views, curtidas, data)`);
    } catch (e) { warnings.push(`não consegui completar os números pelo yt-dlp (${(e as Error).message.slice(0, 120)})`); }
  }
  if (raw.length && raw.every((v) => v.views === undefined)) warnings.push(`${site.label} não mostra views na busca: a nota usa só o que estava visível.`);
  return { raw, url, warnings, loginWall: loginWall || undefined };
}

/** Cookies da sessão (Electron) → cookies.txt no formato Netscape que o yt-dlp lê. Função pura. */
export function netscapeCookies(list: Array<{ name: string; value: string; domain?: string; hostOnly?: boolean; path?: string; secure?: boolean; expirationDate?: number }>): string {
  const rows = list.filter((c) => c.domain && c.name).map((c) => {
    const host = !c.hostOnly && !c.domain!.startsWith('.') ? `.${c.domain}` : c.domain!;
    return [host, host.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', String(Math.round(c.expirationDate ?? 0)), c.name, c.value].join('\t');
  });
  return ['# Netscape HTTP Cookie File', ...rows, ''].join('\n');
}

/** Página do perfil que mostra a grade de vídeos (Facebook: /videos). */
export function profileGridUrl(platform: SocialPlatform, url: string): string {
  const u = url.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  return platform === 'facebook' && !/\/(videos|reels)$/.test(u) ? `${u}/videos` : u;
}

/**
 * Vídeos de um perfil (para CLONAR o canal de TikTok/Instagram/Facebook/Kwai): grade do perfil no navegador
 * da pesquisa + yt-dlp para views, duração e data. Devolve o formato da listagem do yt-dlp que o clone usa.
 */
export async function listProfile(platform: SocialPlatform, url: string, d: SocialDeps, max = 30): Promise<{ title?: string; channel?: string; channel_follower_count?: number; description?: string;
  entries: Array<{ id: string; title: string; duration?: number | null; view_count?: number | null; url: string; thumbnail?: string }> }> {
  const site = SOCIAL_SITES[platform];
  const grid = profileGridUrl(platform, url);
  d.log?.(`${site.label}: lendo os vídeos do perfil ${grid}`);
  const page = await d.browse(platform, grid, extractScript(platform, max, scrollsFor(max)));
  let raw = cardsToVideos(platform, page.cards).slice(0, max);
  if (raw.length && d.ytdlp) {
    try {
      const infos = await d.ytdlp(raw.slice(0, 30).map((v) => v.url));
      const byId = new Map(infos.map((j) => [String((j as { id?: unknown })?.id ?? ''), j]));
      raw = raw.map((v) => (byId.has(v.id) ? ytdlpEnrich(v, byId.get(v.id)) : v));
    } catch { /* fica com o que a página mostrou */ }
  }
  const handle = /@[\w.-]+/.exec(url)?.[0] ?? raw.find((v) => v.author)?.author ?? new URL(grid).pathname.split('/').filter(Boolean)[0];
  return {
    title: handle, channel: handle, channel_follower_count: raw.find((v) => v.followers !== undefined)?.followers,
    entries: raw.map((v) => ({ id: v.id, title: v.title, duration: v.durationSec ?? null, view_count: v.views ?? null, url: v.url, thumbnail: v.thumb })),
  };
}

/** Vídeo da rede → o formato do YouTube (mesma nota, mesmos filtros, mesmos cartões e ações na interface). */
export function toFinderVideo(v: Omit<SocialVideo, 'score' | 'reasons'>, searchLang: string, now = Date.now()): Omit<FinderVideo, 'score' | 'parts' | 'reasons'> {
  const ageDays = v.ageDays ?? (v.publishedAt ? Math.max(0, Math.round((now - Date.parse(v.publishedAt)) / 864e5)) : undefined);
  return {
    platform: v.platform, id: v.id, title: v.title, url: v.url, thumb: v.thumb ?? '',
    channel: v.author ?? SOCIAL_SITES[v.platform].label, channelId: v.author ? `${v.platform}:${v.author}` : undefined, channelUrl: v.authorUrl,
    subs: v.followers, views: v.views ?? 0, likes: v.likes, comments: v.comments, publishedAt: v.publishedAt, ageDays,
    durationSec: v.durationSec, language: v.language, searchLang: searchLang || 'any',
  };
}

/**
 * Pesquisa numa rede com os MESMOS critérios da aba YouTube: termo traduzido por idioma, período, formato,
 * vídeos por idioma (até 100), views mínimas, máximo de seguidores; nota (scoreVideo) e canais/perfis.
 */
export async function findSocial(platform: SocialPlatform, q: FinderQuery, d: SocialDeps, ui: 'pt-BR' | 'en' | 'es' = 'pt-BR'): Promise<FinderResult> {
  const warnings: string[] = [];
  const raw: Array<Omit<FinderVideo, 'score' | 'parts' | 'reasons'>> = [];
  let loginWall = false;
  const langs = q.languages.length ? q.languages : [''];
  const done = new Set<string>();
  for (const lang of langs) {
    const term = (q.queries?.[lang] || q.query).trim();
    if (!term || done.has(term.toLowerCase())) continue;   // mesma consulta em dois idiomas: uma busca só
    done.add(term.toLowerCase());
    const r = await scrapeSocial(platform, term, d, { max: q.perLanguage ?? 30 });
    loginWall ||= !!r.loginWall;
    for (const w of r.warnings) if (!warnings.includes(w)) warnings.push(w);
    raw.push(...r.raw.map((v) => toFinderVideo(v, lang)));
  }
  if (!raw.some((v) => v.subs !== undefined) && raw.length) warnings.push(`${SOCIAL_SITES[platform].label}: seguidores dos perfis não informados — o critério "canal pequeno" e o filtro de máximo de seguidores ficam de fora.`);
  const { videos, channels } = rankVideos(raw, q, ui);
  d.log?.(`${SOCIAL_SITES[platform].label}: ${videos.length} vídeos pontuados · ${channels.length} perfis`);
  return { videos, channels, engine: 'browser', warnings, platform, loginWall: loginWall || undefined };
}
