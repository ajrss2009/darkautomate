import type { Route } from '../shared/types';

/*
 * NEGÓCIO DO CANAL CLONADO (Pesquisar → Clonar canal):
 *  - produtos para vender no canal: infoprodutos (Hotmart, Kiwify, Eduzz, ClickBank, Udemy…) e produtos
 *    físicos (Amazon, Mercado Livre, Shopee, AliExpress…), pesquisados pela IA para o nicho/dobra do canal;
 *    os links são de BUSCA montados pelo app (a IA nunca inventa URL de produto);
 *  - custo de criação: custo por vídeo (texto, voz, imagens, vídeo IA, trilha, thumbnail, GPU local,
 *    mão de obra) e custo total do período, a partir da rota e do DNA do formato (WPM, take médio).
 * Funções puras (o pedido à IA fica no main): testáveis sem rede.
 */

/* ───────── produtos ───────── */

export type ProductKind = 'info' | 'physical';
export interface ProductIdea {
  kind: ProductKind;
  name: string;
  /** categoria do produto (curso, e-book, mentoria, template / eletrônico, livro, acessório…) */
  category?: string;
  /** onde vender/afiliar */
  platform?: string;
  priceRange?: string;
  commission?: string;
  /** por que combina com o público e o formato do canal */
  why?: string;
  /** como encaixar no vídeo (CTA, review, lista, comparativo) */
  placement?: string;
  /** nota de aderência 0–10 */
  fit: number;
  /** termos de busca (o app monta os links) */
  search?: string;
  links?: Array<{ label: string; url: string }>;
}
export interface ProductPlan { info: ProductIdea[]; physical: ProductIdea[]; notes?: string; at: string; by?: string }

const SEARCH: Record<string, (q: string) => string> = {
  hotmart: (q) => `https://hotmart.com/pt-br/marketplace/produtos?q=${encodeURIComponent(q)}`,
  kiwify: (q) => `https://www.google.com/search?q=${encodeURIComponent(`site:kiwify.com.br ${q}`)}`,
  eduzz: (q) => `https://www.google.com/search?q=${encodeURIComponent(`site:eduzz.com ${q}`)}`,
  clickbank: (q) => `https://www.clickbank.com/?s=${encodeURIComponent(q)}`,
  udemy: (q) => `https://www.udemy.com/courses/search/?q=${encodeURIComponent(q)}`,
  amazon: (q) => `https://www.amazon.com.br/s?k=${encodeURIComponent(q)}`,
  'mercado livre': (q) => `https://lista.mercadolivre.com.br/${encodeURIComponent(q.replace(/\s+/g, '-'))}`,
  shopee: (q) => `https://shopee.com.br/search?keyword=${encodeURIComponent(q)}`,
  aliexpress: (q) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}`,
};

/** Links de busca para um produto: a plataforma sugerida primeiro, depois as padrão do tipo. */
export function productLinks(p: Pick<ProductIdea, 'kind' | 'platform' | 'search' | 'name'>): Array<{ label: string; url: string }> {
  const q = (p.search || p.name).trim();
  if (!q) return [];
  const want = (p.platform ?? '').toLowerCase();
  const defaults = p.kind === 'info' ? ['hotmart', 'kiwify', 'udemy'] : ['amazon', 'mercado livre', 'shopee'];
  const keys = [...new Set([...Object.keys(SEARCH).filter((k) => want.includes(k)), ...defaults])].slice(0, 3);
  return keys.map((k) => ({ label: k.replace(/\b\w/g, (c) => c.toUpperCase()), url: SEARCH[k]!(q) }));
}

const s = (v: unknown, n = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);

/** Normaliza a resposta da IA: listas separadas, nota 0–10, sem repetidos, links de busca do app. */
export function normalizeProducts(raw: unknown, by?: string): ProductPlan {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const one = (x: unknown, kind: ProductKind): ProductIdea | undefined => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const name = s(r['name'], 120);
    if (!name) return undefined;
    const p: ProductIdea = { kind, name, category: s(r['category'], 80), platform: s(r['platform'], 60), priceRange: s(r['priceRange'] ?? r['price'], 60),
      commission: s(r['commission'], 60), why: s(r['why']), placement: s(r['placement']), fit: Math.max(0, Math.min(10, Math.round(Number(r['fit'] ?? r['score']) || 0))),
      search: s(r['search'] ?? r['searchTerms'], 100) };
    p.links = productLinks(p);
    return p;
  };
  const list = (k: string, kind: ProductKind) => {
    const seen = new Set<string>();
    return (Array.isArray(o[k]) ? o[k] as unknown[] : []).map((x) => one(x, kind)).filter((x): x is ProductIdea => !!x)
      .filter((x) => !seen.has(x.name.toLowerCase()) && !!seen.add(x.name.toLowerCase())).sort((a, b) => b.fit - a.fit).slice(0, 10);
  };
  return { info: list('info', 'info').concat(list('infoproducts', 'info')).slice(0, 10), physical: list('physical', 'physical').concat(list('products', 'physical')).slice(0, 10),
    notes: s(o['notes'], 800), at: new Date().toISOString(), by };
}

/** Pedido à IA (pesquisa de produtos) a partir do resumo do clone. */
export function productsPrompt(ctx: { niche: string; audience?: string; format?: string; language?: string; country?: string; titles?: string[]; linkedPlatform?: string }): string {
  return `Você é um estrategista de monetização de canais. Pesquise (use busca na web se puder) produtos REAIS e categorias que vendem para este canal.

CANAL: ${ctx.niche}
${ctx.audience ? `PÚBLICO: ${ctx.audience}` : ''}
${ctx.format ? `FORMATO: ${ctx.format}` : ''}
${ctx.linkedPlatform ? `PLATAFORMA PRINCIPAL: ${ctx.linkedPlatform}` : ''}
${ctx.titles?.length ? `EXEMPLOS DE TÍTULOS: ${ctx.titles.slice(0, 5).join(' | ')}` : ''}
PAÍS/IDIOMA: ${ctx.country ?? 'Brasil'} / ${ctx.language ?? 'pt-BR'}

Responda SOMENTE com JSON:
{
  "info": [ 6 a 8 infoprodutos { "name": "produto ou tipo de produto (curso, e-book, mentoria, template, comunidade)", "category": "...", "platform": "Hotmart|Kiwify|Eduzz|ClickBank|Udemy|produto próprio", "priceRange": "faixa de preço", "commission": "comissão típica de afiliado", "why": "por que o público compra", "placement": "como entra no vídeo (CTA no meio, link fixado, descrição)", "fit": 0-10, "search": "termos para achar o produto no marketplace" } ],
  "physical": [ 6 a 8 produtos físicos { "name": "...", "category": "...", "platform": "Amazon|Mercado Livre|Shopee|AliExpress", "priceRange": "...", "commission": "comissão de afiliado típica", "why": "...", "placement": "review, lista de top 5, comparativo, aparece no B-roll", "fit": 0-10, "search": "..." } ],
  "notes": "estratégia de monetização em 2–3 frases (o que vender primeiro, quando criar produto próprio)"
}
Não invente URLs nem nomes de marca que não existam; prefira categorias quando não tiver certeza do produto exato. Respeite as regras das plataformas (nada de promessa de ganho fácil).`;
}

/* ───────── custo de criação ───────── */

export interface CostRates {
  currency: string;
  /** texto (roteiro, plano, metadados, cenas por código): por 1.000 tokens */
  textPer1kTokens: number;
  /** voz (TTS): por 1.000 caracteres */
  ttsPer1kChars: number;
  imagePerUnit: number;
  /** vídeo por IA: por segundo gerado */
  videoPerSec: number;
  /** banco de mídia pago: por clipe (0 = Pexels/Pixabay) */
  stockPerClip: number;
  musicPerTrack: number;
  thumbPerUnit: number;
  /** GPU local (energia + desgaste): por hora */
  gpuPerHour: number;
  /** mão de obra (revisão/edição/publicação): por hora */
  laborPerHour: number;
  /** assinaturas fixas por mês (harness, banco de voz, ferramentas) */
  fixedPerMonth: number;
}

export const DEFAULT_RATES: CostRates = {
  currency: 'USD', textPer1kTokens: 0.005, ttsPer1kChars: 0.15, imagePerUnit: 0.02, videoPerSec: 0.05, stockPerClip: 0,
  musicPerTrack: 0, thumbPerUnit: 0.04, gpuPerHour: 0.12, laborPerHour: 0, fixedPerMonth: 0,
};

export interface CostInput {
  durationSec: number;
  /** palavras por minuto da narração (DNA do formato; padrão 150) */
  wpm?: number;
  /** duração média da cena (s) — padrão: 3 takes do formato ou 10 s */
  sceneSec?: number;
  /** vídeos por mês (padrão: cadência do canal de origem) */
  videosPerMonth: number;
  months: number;
  /** de onde vem o visual das cenas (frações que somam ~1) */
  mix?: { image?: number; video?: number; stock?: number; code?: number };
  /** quem gera: 'api' (pago por uso), 'local' (GPU local), 'free' (assinatura/grátis) */
  engines?: { text?: 'api' | 'local' | 'free'; voice?: 'api' | 'local' | 'free'; image?: 'api' | 'local' | 'free'; video?: 'api' | 'local' | 'free'; music?: 'api' | 'local' | 'free' | 'code' };
  /** minutos de GPU local por minuto de vídeo (padrão 12) */
  gpuMinPerVideoMin?: number;
  /** minutos de trabalho humano por vídeo (padrão 0) */
  laborMinPerVideo?: number;
  rates?: Partial<CostRates>;
}

export interface CostLine { item: string; qty: string; cost: number }
export interface CostEstimate {
  currency: string;
  perVideo: number;
  perMonth: number;
  total: number;
  videos: number;
  lines: CostLine[];
  fixedPerMonth: number;
  assumptions: string[];
}

const money = (n: number) => Math.round(n * 100) / 100;

/** Infere de onde vem cada categoria pela rota (api = paga, comfyui/wan2gp = GPU local, harness = texto). */
export function enginesFromRoute(route?: Pick<Route, 'steps'>): { mix: NonNullable<CostInput['mix']>; engines: NonNullable<CostInput['engines']> } {
  const steps = (route?.steps ?? []).filter((st) => st.enabled);
  const first = (kinds: string[]) => steps.find((st) => kinds.includes(st.kind))?.bindings[0];
  const eng = (b?: { type: string }): 'api' | 'local' | 'free' | undefined => !b ? undefined : b.type === 'api' || b.type === 'flow' ? 'api' : b.type === 'comfyui' || b.type === 'wan2gp' ? 'local' : 'free';
  const has = (k: string) => steps.some((st) => st.kind === k);
  const parts = { image: has('image') ? 1 : 0, video: has('video') ? 1 : 0, stock: has('stock_media') ? 1 : 0, code: has('code_scene') || has('motion_graphics') ? 1 : 0 };
  const n = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
  const musicB = first(['music']);
  return {
    mix: { image: parts.image / n, video: parts.video / n, stock: parts.stock / n, code: parts.code / n },
    engines: { text: eng(first(['script', 'scene_plan'])) ?? 'free', voice: eng(first(['narration'])) ?? 'local', image: eng(first(['image'])) ?? 'local', video: eng(first(['video'])) ?? 'local',
      music: musicB ? (musicB.type === 'builtin' ? 'code' : eng(musicB)) : 'code' },
  };
}

/** Custo por vídeo e total do período (função pura). */
export function estimateCost(input: CostInput): CostEstimate {
  const r: CostRates = { ...DEFAULT_RATES, ...(input.rates ?? {}) };
  const min = Math.max(0.1, input.durationSec / 60);
  const wpm = Math.max(60, Math.min(260, input.wpm ?? 150));
  const words = Math.round(wpm * min);
  const chars = words * 6;
  const sceneSec = Math.max(3, input.sceneSec ?? 10);
  const scenes = Math.max(1, Math.round(input.durationSec / sceneSec));
  const mix = input.mix ?? { image: 1 };
  const tot = Object.values(mix).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const share = (k: keyof NonNullable<CostInput['mix']>) => (mix[k] ?? 0) / tot;
  const e = { text: 'free', voice: 'local', image: 'api', video: 'api', music: 'code', ...(input.engines ?? {}) } as Required<NonNullable<CostInput['engines']>>;
  const lines: CostLine[] = [];
  const add = (item: string, qty: string, cost: number) => lines.push({ item, qty, cost: money(cost) });
  /* texto: roteiro + plano + metadados + cenas por código (prompt com skill/DNA ≈ 8k + 6k por minuto + 3k por cena de código) */
  const tokens = Math.round(8000 + 6000 * min + 3000 * scenes * share('code'));
  add('Texto (roteiro, plano, metadados, código)', `${Math.round(tokens / 1000)}k tokens`, e.text === 'api' ? (tokens / 1000) * r.textPer1kTokens : 0);
  add('Narração (voz)', `${chars.toLocaleString('pt-BR')} caracteres`, e.voice === 'api' ? (chars / 1000) * r.ttsPer1kChars : 0);
  const imgs = Math.round(scenes * share('image') * 2);   // 2 imagens por cena (planos internos)
  if (imgs) add('Imagens por IA', `${imgs} imagens`, e.image === 'api' ? imgs * r.imagePerUnit : 0);
  const vidSec = Math.round(input.durationSec * share('video'));
  if (vidSec) add('Vídeo por IA', `${vidSec} s`, e.video === 'api' ? vidSec * r.videoPerSec : 0);
  const clips = Math.round(scenes * share('stock') * 2);
  if (clips) add('Banco de mídia', `${clips} clipes`, clips * r.stockPerClip);
  add('Trilha', e.music === 'code' ? 'por código' : '1 faixa', e.music === 'api' ? r.musicPerTrack : 0);
  add('Thumbnail', '1 + 1 variação', 2 * r.thumbPerUnit);
  const localShare = (e.image === 'local' ? share('image') : 0) + (e.video === 'local' ? share('video') * 3 : 0) + (e.voice === 'local' ? 0.1 : 0) + (e.text === 'local' ? 0.3 : 0);
  const gpuMin = Math.round(min * (input.gpuMinPerVideoMin ?? 12) * Math.max(0.1, localShare));
  if (gpuMin) add('GPU local (energia)', `${gpuMin} min`, (gpuMin / 60) * r.gpuPerHour);
  const labor = input.laborMinPerVideo ?? 0;
  if (labor) add('Mão de obra', `${labor} min`, (labor / 60) * r.laborPerHour);
  const perVideo = money(lines.reduce((a, l) => a + l.cost, 0));
  const vpm = Math.max(0, input.videosPerMonth);
  const months = Math.max(1, Math.round(input.months));
  const perMonth = money(perVideo * vpm + r.fixedPerMonth);
  return {
    currency: r.currency, perVideo, perMonth, total: money(perMonth * months), videos: Math.round(vpm * months), lines, fixedPerMonth: r.fixedPerMonth,
    assumptions: [
      `${Math.round(input.durationSec)} s por vídeo · ${wpm} palavras/min (${words} palavras) · ${scenes} cenas de ≈ ${sceneSec} s`,
      `${vpm} vídeos/mês × ${months} ${months === 1 ? 'mês' : 'meses'}${r.fixedPerMonth ? ` + ${r.currency} ${r.fixedPerMonth}/mês fixos` : ''}`,
      `texto: ${e.text} · voz: ${e.voice} · imagem: ${e.image} · vídeo: ${e.video} · trilha: ${e.music}`,
    ],
  };
}
