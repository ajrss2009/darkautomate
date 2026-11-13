import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * PESQUISA POR LACUNA ("sem palpite"): o usuário escolhe uma FRONTEIRA (mercado, categoria, janela e teto de
 * canal), o app colhe uma amostra de vídeos, agrupa em FORMATOS e mede a lacuna de cada um.
 *
 * Este módulo é PURO em relação ao Electron e à rede: a coleta recebe a função de busca por parâmetro, então os
 * testes rodam com fixture (nenhuma chamada externa). A persistência é em `<workspace>/research/` (runs/, gaps/ e
 * cache/ com TTL de 24 h). A pesquisa acontece ANTES do projeto existir e não mexe na rota: o que sai daqui é
 * `formato · lacuna · confiança · motivo_do_vazio`, que vira memória do projeto novo.
 */

export type TrendShape = 'estavel' | 'subindo' | 'serrilhado' | 'caindo';
export type Motivation = 'curto' | 'medio' | 'longo' | '—';

/** Fronteira: o lugar onde se procura. Não é um tema — é um recorte de mercado. */
export interface Frontier {
  id: string;
  market: string;          // pt-BR, en-US…
  category: string;        // Educação, Finanças…
  windowDays: number;      // 90
  maxSubs: number;         // teto de canal (100 mil)
  languages: string[];     // ['pt', 'en', 'es']
  createdAt: string;
}

/** Vídeo da amostra (o que o Finder já sabe ler). */
export interface SampleVideo {
  id: string;
  title: string;
  channel: string;
  views: number;
  subs?: number;
  publishedAt?: string;
  ageDays?: number;
  durationSec?: number;
  language: string;
  url?: string;
}

/** Saída da pesquisa para um formato: é isso que a tela mostra e o projeto recebe. */
export interface Gap {
  id: string;
  /** rótulo legível ("linha do tempo · 60 s") */
  format: string;
  key: string;
  /** 0–1: quão confiável é a lacuna (amostra + escassez) */
  confidence: number;
  /** quantos vídeos do formato apareceram na janela */
  n90: number;
  /** vídeos por semana no formato */
  density: number;
  /** concentração de canais (Herfindahl, 0–1) */
  hhi: number;
  /** escassez: 0.6·log(1+n90) + 0.4·HHI */
  scarcity: number;
  /** índice de oportunidade E = D ÷ (1 + S) */
  opportunity: number;
  motivation: Motivation;
  trend: TrendShape;
  /** série semanal (views normalizadas) para o gráfico */
  series: number[];
  medianViews: number;
  p75: number;
  outliers: number;
  videos: SampleVideo[];
  suggestion: ProductionSuggestion;
}

export interface ProductionSuggestion {
  skillId: string;
  routeId: string;
  seconds: number;
  aspect: '9:16' | '16:9';
  /** linha pronta para o campo "memórias" do projeto */
  memories: string[];
}

export interface CollectedRun {
  seed: string;
  language: string;
  videos: SampleVideo[];
  warnings: string[];
}

export interface Collection {
  videos: SampleVideo[];
  runs: CollectedRun[];
  warnings: string[];
}

/** Resultado mínimo que a busca injetada precisa devolver (o Finder devolve mais campos). */
export interface SearchHit { id: string; title: string; channel: string; views: number; subs?: number; publishedAt?: string; ageDays?: number; durationSec?: number; language?: string; url?: string; searchLang?: string }
export type SearchFn = (q: { query: string; languages: string[]; period: 'week' | 'month' | 'year' | 'any'; perLanguage: number; maxSubs?: number; periodDays?: number }) => Promise<{ videos: SearchHit[]; warnings?: string[] }>;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Peso das palavras que descrevem FORMATO no título (o que o Finder não agrupa hoje). */
const FORMAT_TAGS: Array<[string, RegExp[]]> = [
  ['linha do tempo', [/\blinha do tempo\b/i, /\btimeline\b/i, /\bem \d+ (?:marcos|etapas|fases)\b/i]],
  ['mapa animado', [/\bmapa\b/i, /\bmap\b/i, /\bgeografia\b/i, /\bterrit[óo]rio\b/i]],
  ['antes / depois', [/\bantes e depois\b/i, /\bantes\s*\/\s*depois\b/i, /\bbefore and after\b/i, /\btransforma[çc][ãa]o\b/i]],
  ['react', [/\breact\b/i, /\breagindo\b/i, /\breaction\b/i]],
  ['curiosidades', [/\bcuriosidade/i, /\bfatos?\b/i, /\bfacts?\b/i, /\bvoc[êe] sabia\b/i, /\bdid you know\b/i]],
  ['restauro', [/\brestaur/i, /\brestor/i, /\bconsert/i, /\breparo\b/i]],
  ['comparação', [/\bcompara[çc][ãa]o\b/i, /\bvs\.?\b/i, /\bversus\b/i, /\bqual [ée] melhor\b/i]],
  ['top lista', [/\btop \d+/i, /\branking\b/i, /\blista\b/i, /\b\d+ (?:dicas|erros|formas)\b/i]],
  ['tutorial', [/\bcomo\b/i, /\bhow to\b/i, /\bpasso a passo\b/i, /\btutorial\b/i, /\bc[óo]mo\b/i]],
  ['história', [/\bhist[óo]ria\b/i, /\bstory\b/i, /\bverdadeira\b/i, /\btrue story\b/i]],
  ['3 planos', [/\b3 planos\b/i, /\btr[êe]s planos\b/i, /\b3 atos\b/i, /\bthree acts\b/i]],
  ['tela dividida', [/\btela dividida\b/i, /\bsplit screen\b/i, /\blado a lado\b/i]],
  ['explicado', [/\bexplicad[oa]\b/i, /\bentenda\b/i, /\bafinal\b/i, /\bexplained\b/i]],
  ['quiz', [/\bquiz\b/i, /\bteste\b/i, /\bdesafio\b/i, /\bchallenge\b/i]],
];

/** Formatos que o título revela (função pura). */
export const formatTags = (title: string): string[] => FORMAT_TAGS.filter(([, res]) => res.some((re) => re.test(title))).map(([t]) => t);

/** Faixa de duração (curto ≤ 35 s · médio ≤ 75 s · longo). Função pura. */
export const durationBand = (sec?: number): 'curto' | 'medio' | 'longo' => (sec ?? 45) <= 35 ? 'curto' : (sec ?? 45) <= 75 ? 'medio' : 'longo';

/** Assinatura do formato: a tag principal + faixa de duração; sem tag, a duração manda. Função pura.
    Usa só a PRIMEIRA estrutura do título para não fragmentar o cluster (o rótulo pode citar duas). */
export function formatSignature(v: { title: string; durationSec?: number }): { key: string; tags: string[]; band: 'curto' | 'medio' | 'longo' } {
  const tags = formatTags(v.title).slice(0, 3);
  const band = durationBand(v.durationSec);
  return { key: `${tags[0] ?? 'sem-estrutura'}|${band}`, tags, band };
}

/** Rótulo legível do formato a partir das tags dominantes do grupo. Função pura. */
export function formatLabel(tags: string[], band: 'curto' | 'medio' | 'longo', durationSec?: number): string {
  const base = tags.length ? tags.slice(0, 2).join(' · ') : 'sem estrutura declarada';
  const secs = durationSec ? ` · ${Math.round(durationSec)} s` : band === 'curto' ? ' · curto' : band === 'medio' ? ' · médio' : ' · longo';
  return `${base}${secs}`;
}

/** Mediana de uma lista (0 se vazia). Função pura. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Percentil (0–100) por interpolação linear. Função pura. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), at = clamp(p, 0, 100) / 100 * (s.length - 1);
  const lo = Math.floor(at), hi = Math.ceil(at);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}

/** Concentração de canais (Herfindahl): 1 = um canal só, ~0 = muitos canais. Função pura. */
export function hhi(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  return round(counts.reduce((a, c) => a + (c / total) ** 2, 0));
}

/** Escassez S = 0.6·log(1+n90) + 0.4·HHI (a fórmula do catálogo). Função pura. */
export const scarcityScore = (n90: number, concentration: number) => round(0.6 * Math.log(1 + Math.max(0, n90)) + 0.4 * clamp(concentration, 0, 1));

/** Índice de oportunidade E = D ÷ (1 + S). D = vídeos por semana. Função pura. */
export const opportunityScore = (density: number, scarcity: number) => round(density / (1 + Math.max(0, scarcity)));

/**
 * Confiança da lacuna: escassez (poucos vídeos = lacuna mais clara) + tamanho da amostra.
 * 4 vídeos e amostra grande ≈ 0,92–0,95; 60 vídeos ≈ 0,6–0,7. Função pura.
 */
export const gapConfidence = (n90: number, sampleSize: number) =>
  round(clamp(0.5 + 0.3 * (1 - Math.min(1, Math.max(0, n90) / 25)) + 0.2 * (1 - Math.exp(-Math.max(0, sampleSize) / 120)), 0, 0.99), 2);

/** Motivo do vazio pela oferta (curto ≤ 10 · médio ≤ 40 · longo ≥ 80 · — no meio). Função pura. */
export function motivationFor(n90: number): Motivation {
  if (n90 <= 10) return 'curto';
  if (n90 <= 40) return 'medio';
  if (n90 >= 80) return 'longo';
  return '—';
}

/** Série semanal de views (normalizada 0–1) da amostra do formato. Função pura. */
export function weeklySeries(videos: Array<{ views: number; ageDays?: number }>, windowDays: number, now = Date.now()): number[] {
  const weeks = Math.max(2, Math.ceil(windowDays / 7));
  const out = new Array<number>(weeks).fill(0);
  for (const v of videos) {
    const age = v.ageDays ?? 0;
    if (age > windowDays) continue;
    const w = clamp(weeks - 1 - Math.floor(age / 7), 0, weeks - 1);
    out[w]! += Math.max(0, v.views);
  }
  const max = Math.max(...out, 1);
  return out.map((x) => round(x / max));
}

/**
 * Forma da curva (não é medida de volume): estável (estrutural), subindo (janela aberta),
 * serrilhado (sazonal, agendar) e caindo (moda morta, vetar). Função pura.
 */
export function classifyTrend(series: number[]): TrendShape {
  const s = series.filter((x) => Number.isFinite(x));
  if (s.length < 3) return 'estavel';
  const n = s.length, meanX = (n - 1) / 2, meanY = s.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - meanX) * (s[i]! - meanY); den += (i - meanX) ** 2; }
  const slope = den ? num / den : 0;
  /* serrilhado: sobe e desce várias vezes com amplitude relevante */
  let turns = 0, swing = 0;
  for (let i = 1; i < n; i++) {
    const d = s[i]! - s[i - 1]!;
    if (i > 1) { const prev = s[i - 1]! - s[i - 2]!; if (d * prev < 0) turns++; }
    swing += Math.abs(d);
  }
  const seasonal = turns >= 2 && swing / n >= 0.22 && Math.abs(slope) < 0.1;
  if (seasonal) return 'serrilhado';
  if (slope >= 0.09) return 'subindo';
  if (slope <= -0.09) return 'caindo';
  return 'estavel';
}

/** Veredito da forma da curva (o índice não decide sozinho). */
export function trendVerdict(t: TrendShape): { label: string; action: string; tone: 'good' | 'warn' | 'bad' } {
  if (t === 'subindo') return { label: 'janela aberta', action: 'vale', tone: 'good' };
  if (t === 'serrilhado') return { label: 'sazonal', action: 'agendar', tone: 'warn' };
  if (t === 'caindo') return { label: 'moda morta', action: 'vetar', tone: 'bad' };
  return { label: 'estrutural', action: 'vale', tone: 'good' };
}

/** Sugestão de produção: skill/rota reais do app a partir do formato. Função pura. */
export function suggestionFor(tags: string[], band: 'curto' | 'medio' | 'longo', durationSec: number | undefined): ProductionSuggestion {
  const short = band === 'curto' || (durationSec ?? 60) <= 45;
  const text = tags.join(' ');
  const pick = (): { skillId: string; routeId: string } => {
    if (/react|curiosidade|quiz|top lista/.test(text)) return { skillId: 'shorts-viral', routeId: 'shorts-autopilot' };
    if (/restauro|hist[óo]ria|3 planos/.test(text)) return { skillId: 'documentario', routeId: 'documentario-3d' };
    if (/mapa|linha do tempo|tela dividida|compara/.test(text)) return { skillId: 'explicativo-codigo', routeId: 'explainer-mixed' };
    return { skillId: 'explicativo-codigo', routeId: 'explainer-mixed' };
  };
  const { skillId, routeId } = pick();
  const seconds = clamp(Math.round(durationSec ?? (short ? 45 : 90)), 15, 180);
  return { skillId, routeId, seconds, aspect: seconds <= 70 ? '9:16' : '16:9', memories: [] };
}

/** Memória do projeto a partir da lacuna (o brief nasce com os números medidos). */
export const gapMemory = (frontier: Frontier, g: Pick<Gap, 'format' | 'n90' | 'p75' | 'motivation'>) =>
  `Lacuna ${frontier.market} · ${frontier.category}: "${g.format}" — ${g.n90} vídeo(s) em ${frontier.windowDays} dias, p75 ${g.p75.toFixed(1)}x · motivo: ${g.motivation}.`;

/**
 * O que o botão "Criar projeto" preenche: a IDEIA é o formato (o tema nasce do brief), a skill/rota vêm da
 * sugestão e os números entram como memória — o projeto começa sabendo o que foi medido.
 * Função pura: o main só chama `createProject` com este resultado e acrescenta `memories`.
 */
export function gapToProjectInput(frontier: Frontier, g: Gap) {
  return {
    name: g.format.replace(/\s*·\s*/g, ' · ').slice(0, 70) || 'Projeto da lacuna',
    idea: `${g.format}. Formato medido na fronteira ${frontier.category} (${frontier.market}, ${frontier.windowDays} dias): ${g.n90} vídeo(s), p75 ${g.p75.toFixed(1)}x, confiança ${Math.round(g.confidence * 100)}%.`,
    skillId: g.suggestion.skillId,
    routeId: g.suggestion.routeId,
    aspect: g.suggestion.aspect,
    targetDurationSec: g.suggestion.seconds,
    memories: [...g.suggestion.memories],
  };
}

/** Sementes da fronteira: a árvore de sugestões (o tema aparece no fim, não no começo). Função pura. */
export function frontierSeeds(frontier: Pick<Frontier, 'category' | 'languages'>): string[] {
  const cat = frontier.category.trim() || 'curiosidades';
  const templates: Record<string, string[]> = {
    pt: ['como funciona', 'por que', 'qual a diferença', 'antes e depois', 'linha do tempo', 'mapa animado', 'curiosidades sobre', 'explicado em 3 minutos'],
    en: ['how does work', 'why', 'what is the difference', 'before and after', 'timeline of', 'animated map', 'facts about', 'explained in 3 minutes'],
    es: ['cómo funciona', 'por qué', 'cuál es la diferencia', 'antes y después', 'línea de tiempo', 'mapa animado', 'curiosidades de', 'explicado en 3 minutos'],
  };
  const langs = frontier.languages.length ? frontier.languages : ['pt'];
  const seeds: string[] = [];
  for (const l of langs) {
    const t = templates[l.slice(0, 2)] ?? templates.en!;
    for (const s of t) seeds.push(`${s} ${cat}`.trim());
  }
  return [...new Set(seeds)];
}

/** Converte um vídeo do Finder na amostra da pesquisa. Função pura. */
export function toSample(v: SearchHit, language: string): SampleVideo {
  const publishedAt = v.publishedAt;
  const ageDays = v.ageDays ?? (publishedAt ? Math.max(0, (Date.now() - Date.parse(publishedAt)) / 86_400_000) : undefined);
  return { id: v.id, title: v.title, channel: v.channel, views: v.views, subs: v.subs, publishedAt, ageDays, durationSec: v.durationSec, language: v.language ?? language, url: v.url };
}

/** Colhe a amostra: sementes × idiomas, sem repetidos. A busca é injetada (Finder em produção, fixture nos testes). */
export async function collectFrontier(frontier: Frontier, search: SearchFn, o: { maxSeeds?: number; perLanguage?: number; signal?: AbortSignal; log?: (l: string) => void } = {}): Promise<Collection> {
  const seeds = frontierSeeds(frontier).slice(0, o.maxSeeds ?? 6);
  const perLanguage = o.perLanguage ?? 12;
  const videos = new Map<string, SampleVideo>();
  const runs: CollectedRun[] = [], warnings: string[] = [];
  for (const seed of seeds) {
    if (o.signal?.aborted) break;
    o.log?.(`🔎 ${seed}`);
    try {
      const r = await search({ query: seed, languages: frontier.languages.length ? frontier.languages : ['pt'], period: frontier.windowDays <= 30 ? 'month' : frontier.windowDays <= 120 ? 'month' : 'year', perLanguage, maxSubs: frontier.maxSubs || undefined });
      const list = r.videos.map((v) => toSample(v, v.language ?? v.searchLang ?? frontier.languages[0] ?? 'pt'));
      runs.push({ seed, language: frontier.languages[0] ?? 'pt', videos: list, warnings: r.warnings ?? [] });
      if (r.warnings?.length) warnings.push(...r.warnings);
      /* dentro da janela da fronteira (quando a idade é conhecida) */
      for (const v of list) if (v.ageDays === undefined || v.ageDays <= frontier.windowDays) videos.set(v.id, v);
    } catch (e) {
      const msg = (e as Error).message;
      warnings.push(`${seed}: ${msg}`);
      runs.push({ seed, language: frontier.languages[0] ?? 'pt', videos: [], warnings: [msg] });
    }
  }
  return { videos: [...videos.values()], runs, warnings };
}

/** Analisa a amostra e devolve os formatos ranqueados (a tabela da aba Lacunas). */
export function analyzeGaps(frontier: Frontier, videos: SampleVideo[], now = Date.now()): Gap[] {
  const groups = new Map<string, { tags: string[]; band: 'curto' | 'medio' | 'longo'; list: SampleVideo[]; durs: number[] }>();
  for (const v of videos) {
    const sig = formatSignature(v);
    const g = groups.get(sig.key) ?? { tags: [], band: sig.band, list: [], durs: [] };
    /* tags dominantes do grupo */
    for (const t of sig.tags) if (!g.tags.includes(t)) g.tags.push(t);
    g.list.push(v);
    if (v.durationSec && v.durationSec > 0) g.durs.push(v.durationSec);
    groups.set(sig.key, g);
  }
  const sampleSize = videos.length;
  const out: Gap[] = [];
  for (const [key, g] of groups) {
    const tagCounts = new Map<string, number>();
    for (const v of g.list) for (const t of formatTags(v.title)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const tags = g.tags.sort((a, b) => (tagCounts.get(b) ?? 0) - (tagCounts.get(a) ?? 0)).slice(0, 2);
    const durations = g.list.map((v) => v.durationSec).filter((d): d is number => !!d && d > 0);
    const dur = durations.length ? median(durations) : undefined;
    const n90 = g.list.length;
    const density = round(n90 / Math.max(1, frontier.windowDays / 7));
    const concentration = hhi([...g.list.reduce((m, v) => m.set(v.channel, (m.get(v.channel) ?? 0) + 1), new Map<string, number>()).values()]);
    const scarcity = scarcityScore(n90, concentration);
    const series = weeklySeries(g.list, frontier.windowDays, now);
    /* p75 = views ÷ inscritos do canal (a mediana do canal quando há vários vídeos dele na amostra).
       Sem inscritos, usa a mediana do próprio grupo como régua — sem inventar canal grande. */
    const knownSubs = g.list.map((v) => v.subs).filter((x): x is number => typeof x === 'number' && x > 0);
    const ruler = knownSubs.length ? median(knownSubs) : Math.max(1, median(g.list.map((v) => v.views)));
    const ratios = g.list.map((v) => v.views / Math.max(1, v.subs ?? ruler));
    const p75 = percentile(ratios, 75);
    const gap: Gap = {
      id: crypto.createHash('sha1').update(`${key}|${frontier.market}|${frontier.category}`).digest('hex').slice(0, 10),
      format: formatLabel(tags, g.band, dur),
      key,
      confidence: gapConfidence(n90, sampleSize),
      n90,
      density,
      hhi: concentration,
      scarcity,
      opportunity: opportunityScore(density, scarcity),
      motivation: motivationFor(n90),
      trend: classifyTrend(series),
      series,
      medianViews: Math.round(median(g.list.map((v) => v.views))),
      p75: round(p75, 1),
      outliers: ratios.filter((r) => r >= 3).length,
      videos: [...g.list].sort((a, b) => b.views - a.views).slice(0, 12),
      suggestion: suggestionFor(tags, g.band, dur),
    };
    gap.suggestion.memories = [gapMemory(frontier, gap)];
    out.push(gap);
  }
  /* a tabela ordena pela confiança da lacuna (e, no empate, pela escassez) */
  return out.sort((a, b) => b.confidence - a.confidence || a.n90 - b.n90);
}

/* ───────── persistência (workspace/research) ───────── */

export const researchRoot = (workspace: string) => path.join(workspace, 'research');
export const frontierId = (f: Pick<Frontier, 'market' | 'category' | 'windowDays' | 'maxSubs'>) =>
  `${f.category.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'fronteira'}-${crypto.createHash('sha1').update(`${f.market}|${f.windowDays}|${f.maxSubs}`).digest('hex').slice(0, 6)}`;

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  try { fs.renameSync(tmp, file); } catch { fs.copyFileSync(tmp, file); fs.rmSync(tmp, { force: true }); }
}

export function readJson<T>(file: string): T | undefined {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return undefined; }
}

/** Salva a fronteira (uma por recorte) e o resultado da coleta/análise. */
export function saveResearch(workspace: string, frontier: Frontier, collection: Collection, gaps: Gap[]) {
  const dir = path.join(researchRoot(workspace), frontier.id);
  writeJson(path.join(dir, 'frontier.json'), frontier);
  writeJson(path.join(dir, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`), { at: new Date().toISOString(), frontier, seeds: [...new Set(collection.runs.map((r) => r.seed))], videos: collection.videos.length, warnings: collection.warnings, runs: collection.runs });
  writeJson(path.join(dir, 'gaps.json'), { at: new Date().toISOString(), frontier, sample: collection.videos.length, gaps });
  writeJson(path.join(dir, 'sample.json'), collection.videos);
  writeJson(path.join(researchRoot(workspace), 'latest.json'), { frontierId: frontier.id, at: new Date().toISOString() });
  return dir;
}

export function loadGaps(workspace: string, id: string): { at: string; frontier: Frontier; sample: number; gaps: Gap[] } | undefined {
  return readJson(path.join(researchRoot(workspace), id, 'gaps.json'));
}

export function listFrontiers(workspace: string): Frontier[] {
  const root = researchRoot(workspace);
  let names: string[] = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  const out: Frontier[] = [];
  for (const n of names) {
    const f = readJson<Frontier>(path.join(root, n, 'frontier.json'));
    if (f) out.push(f);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Cache de coleta com TTL (padrão 24 h), separado por recorte, profundidade e sementes. */
export function cacheFile(workspace: string, frontier: Frontier, depth: ResearchDepth = 'padrao'): string {
  const key = crypto.createHash('sha1').update(JSON.stringify([frontier.market, frontier.category, frontier.windowDays, frontier.maxSubs, frontier.languages, depth])).digest('hex').slice(0, 16);
  return path.join(researchRoot(workspace), 'cache', `${key}.json`);
}

export type ResearchDepth = 'rapida' | 'padrao' | 'profunda';

/** Cache ainda válido? (arquivo gravado há menos de `ttlMs`) */
export function cacheFresh(file: string, ttlMs = 24 * 3600_000, now = Date.now()): boolean {
  try { return now - fs.statSync(file).mtimeMs < ttlMs; } catch { return false; }
}

/** Quantas sementes e quantos vídeos por busca cada profundidade pede (sem API, cada busca é uma chamada do yt-dlp). */
export const depthPlan = (depth: ResearchDepth): { seeds: number; perLanguage: number } =>
  depth === 'rapida' ? { seeds: 4, perLanguage: 8 } : depth === 'profunda' ? { seeds: 12, perLanguage: 18 } : { seeds: 8, perLanguage: 12 };

export function cachedCollection(workspace: string, frontier: Frontier, depth: ResearchDepth = 'padrao', now = Date.now()): Collection | undefined {
  const file = cacheFile(workspace, frontier, depth);
  if (!cacheFresh(file, 24 * 3600_000, now)) return undefined;
  return readJson<{ collection: Collection }>(file)?.collection;
}

export function saveCachedCollection(workspace: string, frontier: Frontier, collection: Collection, depth: ResearchDepth = 'padrao') {
  writeJson(cacheFile(workspace, frontier, depth), { at: new Date().toISOString(), collection });
}

/** Nova fronteira com id e data (a tela só escolhe mercado/categoria/janela/teto). */
export function makeFrontier(input: Pick<Frontier, 'market' | 'category' | 'windowDays' | 'maxSubs'> & { languages?: string[] }, now = new Date()): Frontier {
  const base = { ...input, languages: input.languages?.length ? input.languages : ['pt'], createdAt: now.toISOString() };
  return { ...base, id: frontierId(base) };
}
