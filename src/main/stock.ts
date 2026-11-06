import { httpFetch } from './http';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Settings, StockSource } from '../shared/types';
import { downloadYouTubeClip, searchYouTube, ytClipSeconds } from './youtube';
import { concat as ffConcat, duration as ffDuration, run as ffRun } from './ffmpeg';

export interface StockHit {
  source: StockSource; kind: 'image' | 'video'; url: string; thumb?: string;
  width?: number; height?: number; author?: string; license?: string; page?: string; title?: string;
}

export const STOCK_DEFAULT_BASE: Record<StockSource, string> = {
  pexels: 'https://api.pexels.com',
  pixabay: 'https://pixabay.com',
  wikipedia: 'https://commons.wikimedia.org',
  youtube: 'https://www.youtube.com',
  nasa: 'https://images-api.nasa.gov',
  archive: 'https://archive.org',
  openverse: 'https://api.openverse.org',
  smithsonian: 'https://api.si.edu',
  unsplash: 'https://api.unsplash.com',
};

const base = (s: Settings, src: StockSource) => (s.stock?.[src]?.baseUrl || STOCK_DEFAULT_BASE[src]).replace(/\/+$/, '');
const key = (s: Settings, src: StockSource) => s.stock?.[src]?.apiKey ?? '';
const UA = { 'User-Agent': 'FilmForge/1.x (video production tool)' };

async function getJson(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${new URL(url).host}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const orient = (w: number, h: number) => (w === h ? 'square' : h > w ? 'portrait' : 'landscape');

/* GTA VI: lista de reserva (gameplay/trailers oficiais). Usada SÓ quando a busca
   pelo termo exato da cena não devolve nada confiável — o termo da cena manda. */
const GTA_VIDEO_IDS: Array<[string, string]> = [
  ['kow3wVkFXP0', 'GTA 6 Gameplay Trailer 4K (No Commentary)'],
  ['bl2wea5pG3s', 'GTA 6 Full 30 Minutes Gameplay 4K No Commentary'],
  ['UPAQLbHRp1I', 'GTA VI Full Netflix Extended Gameplay Reveal 4K'],
  ['iSbkO576j5Y', 'GTA 6 Netflix Full Extended Look 4K Jason and Lucia'],
  ['fSmzttwW6PM', 'GTA 6 PS5 4K HDR Gameplay Jason and Lucia Mission'],
  ['qrxAPA7x-lk', 'GTA 6 Extended Look Full 27 Min Gameplay No Commentary'],
];

function gtaCuratedHits(seedText: string): StockHit[] {
  let hash = 0;
  for (const ch of seedText) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const start = hash % GTA_VIDEO_IDS.length;
  const ordered = GTA_VIDEO_IDS.slice(start).concat(GTA_VIDEO_IDS.slice(0, start));
  return ordered.map(([id, title]) => ({
    source: 'youtube' as const, kind: 'video' as const,
    url: `https://www.youtube.com/watch?v=${id}`, width: 1280, height: 720,
    title, license: 'YouTube - confira a licença e o uso permitido',
    page: `https://www.youtube.com/watch?v=${id}`,
  }));
}

/** Busca em um banco. Retorna acertos já ordenados por relevância da própria fonte. */
export async function searchStock(
  s: Settings, src: StockSource, query: string, media: 'image' | 'video', o: { width: number; height: number; limit?: number; signal?: AbortSignal; seed?: string },
): Promise<StockHit[]> {
  const limit = o.limit ?? 5;
  const q = encodeURIComponent(query);
  const orientation = orient(o.width, o.height);
  if (src === 'youtube') {
    if (media === 'image') return [];
    /* Duas buscas: b-roll "stock footage" + a consulta exata da cena. O termo da
       cena (searchTerms) vem primeiro no ranking; a reserva de GTA VI só entra
       se nada confiável for encontrado. A checagem visual pode rejeitar um hit e
       o próximo é tentado. */
    const clean = await searchYouTube(s, `${query} stock footage`, Math.max(4, limit * 2), { minSeconds: 6, signal: o.signal }).catch(() => []);
    const base = await searchYouTube(s, query, Math.max(4, limit * 3), { minSeconds: 6, signal: o.signal }).catch(() => []);
    const seen = new Set<string>();
    const all = [...base, ...clean].filter((hit) => (seen.has(hit.url) ? false : (seen.add(hit.url), true)));
    /* GTA VI: descarta mods de GTA V, concept trailers e comparativos de gráficos
       que aparecem como "GTA 6" no título. Não substitui o termo da cena. */
    if (/gta\s*(vi|6)\b|grand theft auto (vi|6)|leonida/i.test(query)) {
      const good = /gta\s*(vi|6)\b|grand theft auto (vi|6)\b/i;
      const bad = /gta\s*5|gta\s*v\b|los santos|\bmods?\b|graphics comparison|rtx\s*3080|concept|fan.?made|unreal engine|\bue5\b|fake|parody|animation|testing|remake|definitive edition|vice city definitive|gta vice city/i;
      const strict = all.filter((h) => good.test(h.title ?? '') && !bad.test(h.title ?? ''));
      if (strict.length) {
        /* cena sobre mapa/mundo: os clipes com "map/Leonida/Vice City" ilustram
           melhor a frase e vêm antes dos gameplays genéricos. */
        if (/map|mapa|leonida|vice city|terrain|region/i.test(query)) {
          const maps = strict.filter((h) => /map|mapa|leonida|vice city|terrain|region|world/i.test(h.title ?? ''));
          if (maps.length) return [...maps, ...strict.filter((h) => !maps.includes(h))];
        }
        return strict;
      }
      /* fallback: trailer/gameplay oficial de GTA VI, que sempre existe. */
      const fb = await searchYouTube(s, 'GTA 6 official gameplay trailer 4K no commentary', Math.max(6, limit * 3), { minSeconds: 6, signal: o.signal }).catch(() => []);
      const fbStrict = fb.filter((h) => good.test(h.title ?? '') && !bad.test(h.title ?? ''));
      if (fbStrict.length) return fbStrict;
      return gtaCuratedHits(String(o.seed ?? query));
    }
    return all;
  }
  if (src === 'pexels') {
    if (!key(s, src)) throw new Error('Pexels sem chave de API (Configurações → Bancos de mídia)');
    const h = { Authorization: key(s, src) };
    if (media === 'image') {
      const j = await getJson(`${base(s, src)}/v1/search?query=${q}&per_page=${limit}&orientation=${orientation}`, h, o.signal);
      return (j.photos ?? []).map((p: any): StockHit => ({ source: src, kind: 'image', url: p.src?.large2x ?? p.src?.large ?? p.src?.original, thumb: p.src?.medium,
        width: p.width, height: p.height, author: p.photographer, license: 'Pexels License', page: p.url, title: p.alt }));
    }
    const j = await getJson(`${base(s, src)}/videos/search?query=${q}&per_page=${limit}&orientation=${orientation}`, h, o.signal);
    return (j.videos ?? []).flatMap((v: any): StockHit[] => {
      const files = (v.video_files ?? []).filter((f: any) => /mp4/.test(f.file_type ?? '') && f.link).sort((a: any, b: any) => Math.abs((a.height ?? 0) - 1080) - Math.abs((b.height ?? 0) - 1080));
      const f = files[0];
      return f ? [{ source: src, kind: 'video', url: f.link, thumb: v.image, width: f.width, height: f.height, author: v.user?.name, license: 'Pexels License', page: v.url }] : [];
    });
  }
  if (src === 'pixabay') {
    if (!key(s, src)) throw new Error('Pixabay sem chave de API (Configurações → Bancos de mídia)');
    const k = encodeURIComponent(key(s, src));
    if (media === 'image') {
      const j = await getJson(`${base(s, src)}/api/?key=${k}&q=${q}&image_type=photo&orientation=${orientation === 'portrait' ? 'vertical' : 'horizontal'}&per_page=${Math.max(3, limit)}&safesearch=true`, {}, o.signal);
      return (j.hits ?? []).slice(0, limit).map((p: any): StockHit => ({ source: src, kind: 'image', url: p.largeImageURL ?? p.webformatURL, thumb: p.previewURL,
        width: p.imageWidth, height: p.imageHeight, author: p.user, license: 'Pixabay Content License', page: p.pageURL, title: p.tags }));
    }
    const j = await getJson(`${base(s, src)}/api/videos/?key=${k}&q=${q}&per_page=${Math.max(3, limit)}&safesearch=true`, {}, o.signal);
    return (j.hits ?? []).slice(0, limit).flatMap((v: any): StockHit[] => {
      const f = v.videos?.large?.url ? v.videos.large : v.videos?.medium?.url ? v.videos.medium : v.videos?.small;
      return f?.url ? [{ source: src, kind: 'video', url: f.url, width: f.width, height: f.height, author: v.user, license: 'Pixabay Content License', page: v.pageURL, title: v.tags }] : [];
    });
  }
  if (src === 'nasa') {
    /* NASA Image and Video Library: sem chave; a lista de arquivos de cada item vem de /asset/<id> */
    const j = await getJson(`${base(s, src)}/search?q=${q}&media_type=${media}&page_size=${Math.max(5, limit * 2)}`, {}, o.signal);
    const items = (j.collection?.items ?? []) as any[];
    const out: StockHit[] = [];
    for (const it of items.slice(0, limit * 2)) {
      if (out.length >= limit) break;
      const d = it.data?.[0] ?? {};
      try {
        const a = await getJson(`${base(s, src)}/asset/${encodeURIComponent(d.nasa_id)}`, {}, o.signal);
        const files = ((a.collection?.items ?? []) as any[]).map((x) => String(x.href).replace(/^http:/, 'https:'));
        const pick = media === 'video' ? (files.find((f) => /~large\.mp4$/.test(f)) ?? files.find((f) => /~medium\.mp4$/.test(f)) ?? files.find((f) => /~orig\.mp4$/.test(f)))
          : (files.find((f) => /~large\.jpg$/.test(f)) ?? files.find((f) => /~orig\.jpg$/.test(f)) ?? files.find((f) => /\.jpe?g$/.test(f)));
        if (pick) out.push({ source: src, kind: media, url: pick, thumb: it.links?.[0]?.href, author: d.center ? `NASA ${d.center}` : 'NASA', license: 'NASA (domínio público em geral)', page: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, title: d.title });
      } catch { /* item sem arquivos acessíveis */ }
    }
    return out;
  }
  if (src === 'archive') {
    /* Internet Archive: busca avançada (filmes ou imagens) só com licença aberta declarada; arquivos em /metadata/<id> */
    const lic = '(licenseurl:*publicdomain* OR licenseurl:*creativecommons*)';
    const mt = media === 'video' ? 'movies' : 'image';
    const j = await getJson(`${base(s, src)}/advancedsearch.php?q=${encodeURIComponent(`(${query}) AND mediatype:${mt} AND ${lic}`)}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=licenseurl&fl%5B%5D=creator&rows=${Math.max(6, limit * 3)}&output=json`, {}, o.signal);
    const out: StockHit[] = [];
    /* só licenças que permitem uso comercial e edição (descarta -nc e -nd) */
    for (const d of ((j.response?.docs ?? []) as any[]).filter((x) => !/-nc|-nd|\/nc|\/nd/i.test(String(x.licenseurl ?? '')))) {
      if (out.length >= limit) break;
      try {
        const m = await getJson(`${base(s, src)}/metadata/${encodeURIComponent(d.identifier)}`, {}, o.signal);
        const files = (m.files ?? []) as any[];
        const f = media === 'video'
          ? (files.find((x) => /\.mp4$/i.test(x.name) && /h\.264|mpeg4/i.test(x.format ?? '')) ?? files.find((x) => /\.mp4$/i.test(x.name)))
          : files.find((x) => /\.(jpe?g|png)$/i.test(x.name) && !/thumb/i.test(x.format ?? '') && !/thumbs\//.test(x.name));
        if (f) out.push({ source: src, kind: media, url: `https://archive.org/download/${encodeURIComponent(d.identifier)}/${String(f.name).split('/').map(encodeURIComponent).join('/')}`,
          author: Array.isArray(d.creator) ? d.creator[0] : d.creator, license: d.licenseurl ?? 'ver página', page: `https://archive.org/details/${d.identifier}`, title: Array.isArray(d.title) ? d.title[0] : d.title });
      } catch { /* item sem arquivos */ }
    }
    return out;
  }
  if (src === 'openverse') {
    if (media === 'video') return [];
    const aspect = orientation === 'portrait' ? 'tall' : orientation === 'square' ? 'square' : 'wide';
    const j = await getJson(`${base(s, src)}/v1/images/?q=${q}&page_size=${Math.max(5, limit * 2)}&license_type=commercial&aspect_ratio=${aspect}&mature=false`, {}, o.signal);
    return ((j.results ?? []) as any[]).filter((r) => r.url).slice(0, limit).map((r): StockHit => ({ source: src, kind: 'image', url: r.url, thumb: r.thumbnail, width: r.width, height: r.height,
      author: r.creator, license: `${String(r.license ?? '').toUpperCase()} ${r.license_version ?? ''}`.trim(), page: r.foreign_landing_url, title: r.title }));
  }
  if (src === 'smithsonian') {
    if (media === 'video') return [];
    const k = key(s, src) || 'DEMO_KEY';
    const j = await getJson(`${base(s, src)}/openaccess/api/v1.0/search?q=${encodeURIComponent(`${query} AND online_media_type:Images`)}&rows=${Math.max(6, limit * 3)}&api_key=${encodeURIComponent(k)}`, {}, o.signal);
    const out: StockHit[] = [];
    for (const r of (j.response?.rows ?? []) as any[]) {
      const md = r.content?.descriptiveNonRepeating?.online_media?.media ?? [];
      const img = (md as any[]).find((x) => x.type === 'Images' && /cc0/i.test(x.usage?.access ?? '') && x.content);
      if (img) out.push({ source: src, kind: 'image', url: `${img.content}?max=1920`, thumb: img.thumbnail, author: r.unitCode ? `Smithsonian ${r.unitCode}` : 'Smithsonian', license: 'CC0', page: r.content?.descriptiveNonRepeating?.record_link ?? 'https://www.si.edu/openaccess', title: r.title });
      if (out.length >= limit) break;
    }
    return out;
  }
  if (src === 'unsplash') {
    if (media === 'video') return [];
    if (!key(s, src)) throw new Error('Unsplash sem chave de API (Configurações → Bancos de mídia)');
    const h = { Authorization: `Client-ID ${key(s, src)}`, 'Accept-Version': 'v1' };
    const j = await getJson(`${base(s, src)}/search/photos?query=${q}&per_page=${limit}&orientation=${orientation === 'square' ? 'squarish' : orientation}&content_filter=high`, h, o.signal);
    return ((j.results ?? []) as any[]).map((p): StockHit => {
      /* diretriz da Unsplash: avisar o download (sem esperar) */
      if (p.links?.download_location) void fetch(p.links.download_location, { headers: { ...UA, ...h } }).catch(() => {});
      return { source: src, kind: 'image', url: p.urls?.full ?? p.urls?.regular, thumb: p.urls?.small, width: p.width, height: p.height, author: p.user?.name, license: 'Unsplash License', page: p.links?.html, title: p.alt_description ?? p.description };
    });
  }
  // Wikimedia Commons (sem chave): imagens e vídeos (.webm / .ogv)
  if (media === 'video') {
    const jv = await getJson(`${base(s, src)}/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${Math.max(5, limit * 2)}&gsrsearch=${encodeURIComponent(`${query} filetype:video`)}&prop=imageinfo&iiprop=url|mime|size|extmetadata`, {}, o.signal);
    const strip = (v?: { value?: string }) => (v?.value ?? '').replace(/<[^>]+>/g, '').trim();
    return (Object.values(jv.query?.pages ?? {}) as any[]).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((p): StockHit[] => {
      const ii = p.imageinfo?.[0];
      if (!ii || !/^video\//.test(ii.mime ?? '')) return [];
      const md = ii.extmetadata ?? {};
      return [{ source: src, kind: 'video', url: String(ii.url).replace(/\?.*$/, ''), width: ii.width, height: ii.height, author: strip(md.Artist), license: strip(md.LicenseShortName) || 'ver página', page: ii.descriptionurl, title: String(p.title ?? '').replace(/^File:/, '') }];
    }).slice(0, limit);
  }
  const url = `${base(s, src)}/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${Math.max(5, limit * 2)}&gsrsearch=${q}` +
    `&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1600`;
  const j = await getJson(url, {}, o.signal);
  const pages = Object.values(j.query?.pages ?? {}) as any[];
  return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((p): StockHit[] => {
    const ii = p.imageinfo?.[0];
    if (!ii || !/^image\/(jpeg|png|webp)/.test(ii.mime ?? '')) return [];
    const md = ii.extmetadata ?? {};
    const strip = (v?: { value?: string }) => (v?.value ?? '').replace(/<[^>]+>/g, '').trim();
    return [{ source: src, kind: 'image', url: ii.thumburl ?? ii.url, width: ii.thumbwidth ?? ii.width, height: ii.thumbheight ?? ii.height,
      author: strip(md.Artist), license: strip(md.LicenseShortName) || 'ver página', page: ii.descriptionurl, title: String(p.title ?? '').replace(/^File:/, '') }];
  }).slice(0, limit);
}

export async function downloadTo(url: string, dest: string, signal?: AbortSignal): Promise<void> {
  const r = await fetch(url, { headers: UA, signal });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

/** Fontes cujos vídeos são longos (filmes, transmissões): só um trecho é baixado, já em MP4. */
const CLIP_SOURCES = new Set<StockSource>(['nasa', 'archive', 'wikipedia']);

/** Identificação com contato (política de User-Agent do Wikimedia: https://meta.wikimedia.org/wiki/User-Agent_policy). */
const contactUA = (s: Settings) => { const c = s.stock?.wikipedia?.contact?.trim(); return c ? `FilmForge/1.0 (${c}) ffmpeg` : ''; };

/** Baixa só um trecho de um vídeo remoto (o ffmpeg lê por faixas HTTP) e converte para MP4; pula o começo (cartelas). */
export async function downloadClip(s: Settings, url: string, dest: string, seconds: number, signal?: AbortSignal): Promise<void> {
  const wm = /wikimedia\.org/i.test(url);
  if (wm && !contactUA(s)) throw new Error('Wikimedia: para baixar vídeos informe um contato (site ou e-mail) em Configurações → Bancos de mídia → Wikimedia Commons');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  /* Wikimedia e outros acervos recusam downloads sem identificação (User-Agent) */
  const args = (start: number) => ['-y', '-user_agent', (wm ? contactUA(s) : '') || UA['User-Agent'], '-ss', String(start), '-i', url, '-t', seconds.toFixed(2), '-an', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest];
  try { await ffRun(s.ffmpeg, args(4), signal); }
  catch { await ffRun(s.ffmpeg, args(0), signal); }          // vídeo curto: do começo
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 2000) throw new Error('trecho de vídeo vazio');
}

const extOf = (hit: StockHit) => {
  if (hit.kind === 'video' && CLIP_SOURCES.has(hit.source)) return 'mp4';
  const m = /\.(jpe?g|png|webp|mp4|mov|webm)(?:\?|$)/i.exec(hit.url);
  return m ? m[1]!.toLowerCase().replace('jpeg', 'jpg') : hit.kind === 'video' ? 'mp4' : 'jpg';
};

export interface StockAsset { file: string; hit: StockHit }

/**
 * Inícios dos trechos extras do mesmo vídeo, depois do primeiro (que começa em 3 s).
 * Ex.: trecho de 4 s para cena de 8 s => [7]; cena de 12 s => [7, 11].
 */
export function youtubeFillStarts(clipSeconds: number, sceneSeconds: number): number[] {
  const clip = Math.max(1, clipSeconds);
  if (sceneSeconds <= clip + 0.05) return [];
  /* +1 de folga para o caso de o encoder entregar alguns quadros a menos. */
  const extras = Math.min(7, Math.ceil((sceneSeconds - clip) / clip) + 1);
  return Array.from({ length: extras }, (_, i) => 3 + (i + 1) * clip);
}

/**
 * Baixa um trecho de YouTube e, se ele for menor que a cena, completa com trechos
 * seguintes do MESMO vídeo (sem repetir o mesmo pedaço e sem sobreposição).
 * A montagem só repete o clipe se o vídeo de origem realmente acabar antes da cena.
 */
async function downloadYouTubeForScene(
  s: Settings, hit: StockHit, dest: string,
  o: { seconds: number; sceneSeconds?: number; width: number; height: number; context?: string; signal?: AbortSignal; log?: (l: string) => void },
): Promise<void> {
  const clipSeconds = ytClipSeconds(s, o.seconds);
  const target = Math.max(clipSeconds, o.sceneSeconds ?? clipSeconds);
  const first = await downloadYouTubeClip(s, hit, dest, {
    seconds: clipSeconds, width: o.width, height: o.height, context: o.context, signal: o.signal, log: o.log,
  });
  let total = await ffDuration(s.ffprobe, dest);
  if (total + 0.05 >= target) return;
  /* onde o primeiro trecho terminou de fato (pode ter sido ajustado pelo "sem transições") */
  let nextStart = first.start + first.seconds;

  const parts = [dest];
  const plan = youtubeFillStarts(clipSeconds, target);
  try {
    for (let i = 0; i < plan.length && total + 0.05 < target; i++) {
      const extra = `${dest}.part${i + 1}.mp4`;
      try {
        const part = await downloadYouTubeClip(s, hit, extra, {
          seconds: clipSeconds, start: nextStart, width: o.width, height: o.height,
          /* o primeiro trecho já passou pela checagem visual; os seguintes são do
             mesmo vídeo e servem para cobrir a cena sem repetir o mesmo frame. */
          signal: o.signal, log: o.log,
        });
        const d = await ffDuration(s.ffprobe, extra);
        if (d < 0.5) { fs.rmSync(extra, { force: true }); break; }
        nextStart = part.start + part.seconds;
        parts.push(extra);
        total += d;
        o.log?.(`YouTube: +${d.toFixed(1)}s do mesmo vídeo (${total.toFixed(1)}/${target.toFixed(1)}s)`);
      } catch (e) {
        fs.rmSync(extra, { force: true });
        o.log?.(`YouTube: não foi possível completar com outro trecho do mesmo vídeo: ${(e as Error).message}`);
        break;
      }
    }
    if (parts.length > 1) {
      const filled = `${dest}.filled.mp4`;
      try {
        await ffConcat(s.ffmpeg, parts, filled, o.signal);
        const filledDuration = await ffDuration(s.ffprobe, filled);
        if (filledDuration > total - 0.2) {
          fs.copyFileSync(filled, dest);
          o.log?.(`YouTube: trecho de ${filledDuration.toFixed(1)}s montado com ${parts.length} partes do mesmo vídeo`);
        }
      } catch (e) {
        o.log?.(`YouTube: trecho completo indisponível (mantendo ${total.toFixed(1)}s): ${(e as Error).message}`);
      } finally {
        fs.rmSync(filled, { force: true });
      }
    }
  } finally {
    for (const p of parts.slice(1)) fs.rmSync(p, { force: true });
  }
}

/** Busca nas fontes (em ordem) e baixa até `count` arquivos. Escreve stock.json com créditos. */
export async function fetchForScene(
  s: Settings, sources: StockSource[], media: 'image' | 'video' | 'both', query: string, dir: string,
  o: { width: number; height: number; count?: number; seconds?: number; sceneSeconds?: number; context?: string; signal?: AbortSignal; log?: (l: string) => void; seed?: string },
): Promise<StockAsset[]> {
  const count = o.count ?? 3;
  const kinds: Array<'image' | 'video'> = media === 'both' ? ['video', 'image'] : [media];
  const assets: StockAsset[] = [];
  const errors: string[] = [];
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* arquivos imutáveis: sobrescreve */ }
  fs.mkdirSync(dir, { recursive: true });
  outer: for (const kind of kinds) {
    for (const src of sources) {
      if (assets.length >= count) break outer;
      try {
        const hits = await searchStock(s, src, query, kind, { ...o, limit: count });
        for (const hit of hits) {
          if (assets.length >= count) break outer;
          const file = path.join(dir, `stock-${assets.length + 1}.${extOf(hit)}`);
          try {
            if (src === 'youtube') await downloadYouTubeForScene(s, hit, file, { seconds: o.seconds ?? 4, sceneSeconds: o.sceneSeconds, width: o.width, height: o.height, context: o.context, signal: o.signal, log: o.log });
            else if (hit.kind === 'video' && CLIP_SOURCES.has(src)) await downloadClip(s, hit.url, file, (o.seconds ?? 5) + 1, o.signal);
            else await downloadTo(hit.url, file, o.signal);
            assets.push({ file, hit });
          }
          catch (e) { errors.push(`${src}: ${(e as Error).message}`); }
        }
      } catch (e) { errors.push(`${src}/${kind}: ${(e as Error).message}`); o.log?.(`stock ${src}/${kind}: ${(e as Error).message}`); }
    }
  }
  fs.writeFileSync(path.join(dir, 'stock.json'), JSON.stringify({ query, assets: assets.map((a) => ({ file: path.basename(a.file), ...a.hit })), errors }, null, 2));
  if (assets.length === 0) throw new Error(`nenhuma mídia encontrada para "${query}"${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
  return assets;
}

/** Teste rápido de uma fonte (usado em Configurações). */
export async function testSource(s: Settings, src: StockSource): Promise<{ ok: boolean; message: string }> {
  try {
    const media = src === 'youtube' ? 'video' : 'image';
    if (src === 'archive') { const hits = await searchStock(s, src, 'bees', 'video', { width: 1920, height: 1080, limit: 1, signal: AbortSignal.timeout(45000) }); return hits.length ? { ok: true, message: `ok — exemplo: ${hits[0]!.title ?? hits[0]!.url}`.slice(0, 160) } : { ok: false, message: 'respondeu sem resultados' }; }
    const hits = await searchStock(s, src, 'nature', media, { width: 1920, height: 1080, limit: 1, signal: AbortSignal.timeout(30000) });
    return hits.length ? { ok: true, message: `ok — exemplo: ${hits[0]!.title ?? hits[0]!.url}`.slice(0, 160) } : { ok: false, message: 'respondeu sem resultados' };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
