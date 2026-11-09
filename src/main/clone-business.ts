import type { Channel, ChannelProduct, ChannelProducts, Project, Route } from '../shared/types';

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

/* ───────── produtos do CANAL do usuário (aba Canais) e CTA no roteiro ───────── */

/** Contexto do pedido de produtos a partir do canal (tipo, marca, análise). */
export function channelProductsContext(ch: Pick<Channel, 'name' | 'platform' | 'type' | 'language' | 'brand' | 'analytics'>, typeLabel?: string): Parameters<typeof productsPrompt>[0] {
  const b = ch.brand;
  const niche = [ch.name, typeLabel ?? ch.type, b?.tagline, b?.description?.slice(0, 300), b?.keywords?.length ? `palavras-chave: ${b.keywords.slice(0, 10).join(', ')}` : '']
    .filter(Boolean).join(' — ');
  return { niche, audience: b?.tone ? `tom ${b.tone}` : undefined, format: typeLabel, language: ch.language, titles: (ch.analytics?.top ?? []).map((t) => t.title).filter(Boolean), linkedPlatform: ch.platform };
}

/**
 * Junta a pesquisa (IA ou clone) com a lista atual do canal: mantém escolha e link do usuário pelo nome;
 * itens escolhidos que não vieram na nova pesquisa continuam (o usuário escolheu, não some).
 */
export function mergeChannelProducts(prev: ChannelProducts | undefined, plan: Pick<ProductPlan, 'info' | 'physical' | 'notes' | 'by'>, source: 'ai' | 'clone'): ChannelProducts {
  const key = (n: string) => n.trim().toLowerCase();
  const old = new Map((prev?.items ?? []).map((x) => [key(x.name), x]));
  const fresh = [...plan.info, ...plan.physical].map((p): ChannelProduct => {
    const o = old.get(key(p.name));
    return { ...p, links: p.links ?? productLinks(p), chosen: o?.chosen, url: o?.url };
  });
  const names = new Set(fresh.map((x) => key(x.name)));
  const kept = (prev?.items ?? []).filter((x) => (x.chosen || x.url) && !names.has(key(x.name)));
  return { items: [...kept, ...fresh].slice(0, 30), notes: plan.notes ?? prev?.notes, at: new Date().toISOString(), by: plan.by, source,
    cta: prev?.cta ?? { enabled: true, placement: 'middle', max: 1 } };
}

/** Aplica escolhas do usuário (marcar produto, link próprio, regras do CTA). Link só http(s). */
export function patchChannelProducts(cp: ChannelProducts, patch: { chosen?: Record<string, boolean>; urls?: Record<string, string>; cta?: Partial<NonNullable<ChannelProducts['cta']>>; remove?: string[] }): ChannelProducts {
  const key = (n: string) => n.trim().toLowerCase();
  const ch = new Map(Object.entries(patch.chosen ?? {}).map(([k, v]) => [key(k), !!v]));
  const us = new Map(Object.entries(patch.urls ?? {}).map(([k, v]) => [key(k), String(v ?? '').trim()]));
  const rm = new Set((patch.remove ?? []).map(key));
  const items = cp.items.filter((x) => !rm.has(key(x.name))).map((x) => {
    const k = key(x.name); const y = { ...x };
    if (ch.has(k)) { if (ch.get(k)) y.chosen = true; else delete y.chosen; }
    if (us.has(k)) { const u = us.get(k)!; if (/^https?:\/\/\S+$/i.test(u)) y.url = u.slice(0, 500); else delete y.url; }
    return y;
  });
  const c0 = cp.cta ?? { enabled: true, placement: 'middle' as const, max: 1 };
  const c = patch.cta ?? {};
  const cta = { enabled: c.enabled ?? c0.enabled, placement: (['middle', 'end', 'both'] as const).includes(c.placement as 'middle') ? c.placement! : c0.placement, max: Math.max(1, Math.min(3, Math.round(Number(c.max ?? c0.max) || 1))) };
  return { ...cp, items, cta };
}

/** Produtos que entram no vídeo: os escolhidos, os de maior aderência primeiro, até o máximo do CTA. */
export function ctaProducts(cp: ChannelProducts | undefined): ChannelProduct[] {
  if (!cp?.cta?.enabled) return [];
  return cp.items.filter((x) => x.chosen).sort((a, b) => b.fit - a.fit).slice(0, cp.cta.max || 1);
}

/** Bloco do prompt: roteiro (onde e como falar do produto) e metadados (descrição com os links). */
export function productCtaPrompt(cp: ChannelProducts | undefined, stepKind: string): string {
  const list = ctaProducts(cp);
  if (!list.length) return '';
  const where = cp!.cta!.placement === 'end' ? 'no fim, antes da despedida' : cp!.cta!.placement === 'both' ? 'uma menção curta no meio (depois de uma recompensa) e o chamado no fim' : 'no meio do vídeo, logo depois de uma recompensa (nunca no gancho)';
  const line = (p: ChannelProduct) => `- ${p.name}${p.category ? ` (${p.category})` : ''}${p.why ? ` — por que o público quer: ${p.why}` : ''}${p.placement ? ` — encaixe sugerido: ${p.placement}` : ''}`;
  if (stepKind === 'script' || stepKind === 'scene_plan') {
    return `PRODUTO(S) DO CANAL — CTA (escolhidos pelo usuário):\n${list.map(line).join('\n')}\n` +
      `Inclua o CTA ${where}, em 1–2 frases naturais ligadas ao assunto do vídeo ("o link está na descrição"). ` +
      'Sem promessa de ganho, sem preço inventado, sem falar mal de concorrente; se o produto não tiver relação com o tema, faça só uma menção leve no fim.' +
      (stepKind === 'scene_plan' ? ' Marque a cena do CTA no "visualIntent" (o produto ou o tema dele na tela, com texto curto "link na descrição").' : '');
  }
  if (stepKind === 'metadata') {
    return `PRODUTOS NA DESCRIÇÃO: acrescente um bloco "🛒 Indicados neste vídeo" com:\n${list.map((p) => `- ${p.name}: ${p.url ?? '[coloque aqui o seu link]'}`).join('\n')}\n` +
      'Use exatamente esses links (não invente outros) e, se houver link de afiliado, avise "link de afiliado" na mesma linha.';
  }
  return '';
}

/* ───────── custo estimado de UM projeto (selo $ da lista de projetos) ───────── */

/** Custo por vídeo de um projeto: rota (quem gera), cenas do plano (tipos e durações) ou a duração alvo. */
export function projectCost(p: Pick<Project, 'targetDurationSec' | 'scenes' | 'route' | 'skill' | 'sceneSec'>, rates?: Partial<CostRates>): CostEstimate {
  const fromRoute = enginesFromRoute(p.route);
  const scenes = p.scenes ?? [];
  const dur = scenes.reduce((a, s) => a + (s.durationSec && s.durationSec > 0 ? s.durationSec : 0), 0) || p.targetDurationSec || 60;
  let mix = fromRoute.mix;
  if (scenes.length) {
    const c = { image: 0, video: 0, stock: 0, code: 0 };
    for (const s of scenes) {
      const k = s.kind === 'video' ? 'video' : s.kind === 'stock' ? 'stock' : s.kind === 'code' || s.kind === 'motion' ? 'code' : 'image';
      c[k] += s.durationSec && s.durationSec > 0 ? s.durationSec : 1;
    }
    const t = Object.values(c).reduce((a, b) => a + b, 0) || 1;
    mix = { image: c.image / t, video: c.video / t, stock: c.stock / t, code: c.code / t };
  }
  const f = p.skill?.formatDna;
  return estimateCost({ durationSec: dur, wpm: f?.wpm, sceneSec: scenes.length ? Math.max(3, dur / scenes.length) : p.sceneSec ?? f?.avgTakeSec, videosPerMonth: 1, months: 1, mix, engines: fromRoute.engines, rates });
}
