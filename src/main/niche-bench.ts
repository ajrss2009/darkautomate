import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Settings } from '../shared/types';
import { listChannel, listChannelClones } from './channel-clone';
import { slugify } from './library';
import { normalizeText } from './title-score';
import { ensureYtDlp } from './youtube';
import { titleStructure, type RefTitle, type TitleStructure } from './youtube-rules';

/*
 * BENCHMARK DE NICHO — trinta títulos de um canal é anedota; o nicho pede escala.
 *
 * A régua do catálogo não é "o que este canal faz", é "o que o nicho aprova".
 * Aqui o corpus cresce sem API: busca o tema por vários ângulos (yt-dlp), abre
 * os canais que aparecem e acumula títulos entre execuções. O resultado é uma
 * estrutura medida em centenas/milhares de títulos — e a diferença, em pontos
 * percentuais, entre o canal de referência e o mercado.
 */

export interface NicheCorpus {
  /** slug estável (o arquivo em workspace/craft/niche/<id>.json) */
  id: string;
  label: string;
  query?: string;
  channelId?: string;
  channelUrl?: string;
  builtAt: string;
  channels: Array<{ url?: string; name?: string; titles: number }>;
  /** títulos do canal de referência (para comparar canal × nicho) */
  seedTitles?: RefTitle[];
  /** títulos do nicho, sem repetição */
  titles: RefTitle[];
}

export interface NicheBuildInput {
  channelId?: string;
  channelUrl?: string;
  query?: string;
  /** quantos títulos o corpus deve ter (default 1000) */
  target?: number;
  /** quantos canais abrir além da busca (default 12) */
  maxChannels?: number;
}

export interface NicheDeps {
  search?: (q: string, n: number) => Promise<Array<{ title: string; channelUrl?: string; views?: number }>>;
  channel?: (url: string) => Promise<{ name?: string; titles: RefTitle[] }>;
}

/** Ângulos de busca: o nicho não está só na primeira página do termo exato. */
export const QUERY_ANGLES = ['', 'como', 'por que', 'dicas', 'erros', 'para iniciantes', '2026', 'vale a pena', 'história', 'review'];

const dirOf = (s: Settings) => path.join(s.workspace, 'craft', 'niche');

/** Id estável do corpus: o termo (ou o canal) em slug. */
export function nicheId(input: Pick<NicheBuildInput, 'query' | 'channelId' | 'channelUrl'>): string {
  return slugify(input.query || input.channelId || input.channelUrl || 'nicho').slice(0, 48) || 'nicho';
}

export function readNiche(s: Settings, id: string): NicheCorpus | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dirOf(s), `${id}.json`), 'utf8')) as NicheCorpus;
    return j && Array.isArray(j.titles) ? j : undefined;
  } catch { return undefined; }
}

export function listNiches(s: Settings): NicheCorpus[] {
  try {
    return fs.readdirSync(dirOf(s)).filter((f) => f.endsWith('.json')).map((f) => readNiche(s, f.replace(/\.json$/, ''))).filter((x): x is NicheCorpus => !!x);
  } catch { return []; }
}

/** Normaliza a URL do canal para comparar "@canal", "youtube.com/@canal" e a URL completa. */
const normUrl = (u?: string): string =>
  (u ?? '').trim().toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '').replace(/^youtube\.com\//, '');

/** O corpus do nicho que corresponde à referência (canal clonado, URL do canal ou termo). */
export function findNiche(s: Settings, src: { kind: string; id?: string; url?: string }): NicheCorpus | undefined {
  const all = listNiches(s);
  if (src.kind === 'clone' && src.id) return all.find((c) => c.channelId === src.id);
  if (src.kind === 'channel' && src.url) {
    const want = normUrl(src.url);
    return all.find((c) => c.channelUrl && normUrl(c.channelUrl) === want);
  }
  return all.find((c) => c.query && (src.kind === 'video' || src.kind === 'link'));
}

/** Junta títulos sem repetição (o mesmo vídeo pode aparecer em buscas e no canal). */
export function mergeTitles(base: RefTitle[], add: RefTitle[]): RefTitle[] {
  const by = new Map<string, RefTitle>();
  for (const t of [...base, ...add]) {
    const title = t.title?.trim();
    if (!title) continue;
    const k = normalizeText(title).replace(/\s+/g, ' ');
    const prev = by.get(k);
    by.set(k, { title: prev?.title ?? title, views: Math.max(prev?.views ?? 0, t.views ?? 0) });
  }
  return [...by.values()];
}

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    c.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    c.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    const abort = () => c.kill();
    signal?.addEventListener('abort', abort, { once: true });
    c.on('error', (e) => resolve({ code: -1, out, err: err + e.message }));
    c.on('close', (code) => { signal?.removeEventListener('abort', abort); resolve({ code, out, err }); });
  });
}

interface YtEntry { title?: string; view_count?: number; channel_url?: string; uploader_url?: string; channel_id?: string; channel?: string; id?: string }

/** Busca no YouTube (yt-dlp, sem baixar) — a matéria-prima do nicho. */
async function searchVideos(s: Settings, q: string, n: number, log: (l: string) => void, signal?: AbortSignal): Promise<Array<{ title: string; channelUrl?: string; views?: number }>> {
  const exe = await ensureYtDlp(s, log);
  const r = await run(exe, [`ytsearch${Math.max(1, Math.min(100, n))}:${q}`, '--dump-json', '--flat-playlist', '--no-warnings', '--skip-download'], signal);
  if (r.code !== 0) { log(`nicho: busca "${q}" falhou (${(r.err || r.out).split('\n').slice(-1)[0]?.slice(0, 120)})`); return []; }
  const out: Array<{ title: string; channelUrl?: string; views?: number }> = [];
  for (const line of r.out.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const e = JSON.parse(line) as YtEntry;
      if (!e.title) continue;
      const channelUrl = e.channel_url ?? e.uploader_url ?? (e.channel_id ? `https://www.youtube.com/channel/${e.channel_id}` : undefined);
      out.push({ title: e.title, channelUrl, views: e.view_count });
    } catch { /* linha inválida */ }
  }
  return out;
}

/** Constrói (ou amplia) o corpus do nicho. Deps injetáveis para testar sem rede. */
export async function buildNiche(s: Settings, input: NicheBuildInput, log: (l: string) => void, signal?: AbortSignal, deps: NicheDeps = {}): Promise<NicheCorpus> {
  const id = nicheId(input);
  const target = Math.max(60, Math.min(5000, input.target ?? 1000));
  const maxChannels = Math.max(0, Math.min(40, input.maxChannels ?? 12));
  const prev = readNiche(s, id);
  const corpus: NicheCorpus = prev ?? {
    id, label: input.query ? `nicho "${input.query}"` : `nicho de ${input.channelUrl ?? input.channelId ?? 'referência'}`,
    query: input.query, channelId: input.channelId, channelUrl: input.channelUrl, builtAt: new Date().toISOString(), channels: [], titles: [],
  };
  corpus.query = input.query ?? corpus.query;
  corpus.channelId = input.channelId ?? corpus.channelId;
  corpus.channelUrl = input.channelUrl ?? corpus.channelUrl;
  corpus.label = input.query ? `nicho "${input.query}"` : corpus.label;

  const search = deps.search ?? ((q, n) => searchVideos(s, q, n, log, signal));
  const channel = deps.channel ?? (async (url) => {
    try {
      const l = await listChannel(s, url, log, signal);
      return { name: l.channel ?? l.uploader ?? undefined, titles: (l.entries ?? []).filter((e) => e.title).map((e) => ({ title: e.title!, views: e.view_count ?? undefined })) };
    } catch { return { titles: [] as RefTitle[] }; }
  });

  const addChannel = (url: string | undefined, name: string | undefined, n: number) => {
    if (!url) return;
    const cur = corpus.channels.find((c) => c.url === url);
    if (cur) cur.titles = Math.max(cur.titles, n);
    else corpus.channels.push({ url, name, titles: n });
  };

  const save = () => {
    corpus.titles = mergeTitles([], corpus.titles);
    fs.mkdirSync(dirOf(s), { recursive: true });
    fs.writeFileSync(path.join(dirOf(s), `${id}.json`), JSON.stringify(corpus, null, 1));
  };

  /* semente: o próprio canal de referência (o padrão que o público reconhece) */
  if (corpus.channelId) {
    const c = listChannelClones(s).find((x) => x.id === corpus.channelId);
    const seed = [...(c?.recent ?? []).map((r) => ({ title: r.title, views: r.views })), ...(c?.bends.flatMap((b) => b.exampleTitles ?? []) ?? []).map((t) => ({ title: t }))];
    corpus.seedTitles = mergeTitles([], seed);
    corpus.titles = mergeTitles(corpus.titles, seed);
    addChannel(c?.source?.url, c?.source?.name, seed.length);
    log(`nicho: ${seed.length} títulos do canal de referência`);
  } else if (corpus.channelUrl) {
    const seed = await channel(corpus.channelUrl);
    corpus.seedTitles = mergeTitles([], seed.titles);
    corpus.titles = mergeTitles(corpus.titles, seed.titles);
    addChannel(corpus.channelUrl, seed.name, seed.titles.length);
    log(`nicho: ${seed.titles.length} títulos do canal de referência`);
  }

  /* busca por vários ângulos: cada rodada traz títulos e canais novos */
  if (corpus.query) {
    for (const angle of QUERY_ANGLES) {
      if (corpus.titles.length >= target || signal?.aborted) break;
      const q = angle ? `${corpus.query} ${angle}` : corpus.query;
      const hits = await search(q, 100);
      corpus.titles = mergeTitles(corpus.titles, hits.map((h) => ({ title: h.title, views: h.views })));
      for (const h of hits) addChannel(h.channelUrl, undefined, 0);
      log(`nicho: busca "${q}" → ${corpus.titles.length} títulos de ${corpus.channels.length} canais`);
      save();
    }
  }

  /* abre os canais que mais apareceram: cada um rende ~30 títulos e mostra o padrão do nicho */
  const toOpen = corpus.channels.filter((c) => c.url && c.url !== corpus.channelUrl).slice(0, maxChannels);
  for (const ch of toOpen) {
    if (corpus.titles.length >= target || signal?.aborted) break;
    const r = await channel(ch.url!);
    if (!r.titles.length) continue;
    corpus.titles = mergeTitles(corpus.titles, r.titles);
    ch.name = r.name ?? ch.name;
    ch.titles = r.titles.length;
    log(`nicho: canal "${r.name ?? ch.url}" → ${corpus.titles.length} títulos`);
    save();
  }

  corpus.titles = mergeTitles([], corpus.titles).slice(0, 5000);
  corpus.builtAt = new Date().toISOString();
  save();
  if (corpus.titles.length < 300) log(`nicho: amostra pequena (${corpus.titles.length} títulos) — rode de novo para acumular`);
  log(`nicho: ${corpus.titles.length} títulos de ${corpus.channels.length} canais (${corpus.label})`);
  return corpus;
}

/**
 * A diferença entre o canal e o nicho, em pontos percentuais — é o que separa
 * "título no padrão do canal" de "título que o nicho aprova".
 */
export function nicheVsChannel(one: TitleStructure, niche: TitleStructure): string[] {
  const d = (a: number, b: number) => {
    const diff = b - a;
    return `${diff >= 0 ? '+' : ''}${diff} p.p.`;
  };
  return [
    `caracteres (média): canal ${one.avgLen} · nicho ${niche.avgLen}`,
    `até 60 caracteres: canal ${one.within60}% · nicho ${niche.within60}% (${d(one.within60, niche.within60)})`,
    `com número: canal ${one.numbers}% · nicho ${niche.numbers}% (${d(one.numbers, niche.numbers)})`,
    `com pergunta: canal ${one.questions}% · nicho ${niche.questions}% (${d(one.questions, niche.questions)})`,
    `1ª pessoa: canal ${one.firstPerson}% · nicho ${niche.firstPerson}% (${d(one.firstPerson, niche.firstPerson)})`,
    `emoji: canal ${one.emoji}% · nicho ${niche.emoji}% (${d(one.emoji, niche.emoji)})`,
    `começam com como/por que/o que: canal ${one.howWhy}% · nicho ${niche.howWhy}% (${d(one.howWhy, niche.howWhy)})`,
  ];
}

/** Estrutura do corpus (é a que entra no prompt quando a amostra é grande o bastante). */
export function nicheStructure(corpus: NicheCorpus): TitleStructure {
  return titleStructure(corpus.titles);
}
