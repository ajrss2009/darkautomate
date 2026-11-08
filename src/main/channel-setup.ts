import type { Channel, ChannelBrand, ChannelIdentity, ChannelPlatform, PaletteSpec } from '../shared/types';

/*
 * CADASTRO GUIADO DO CANAL (aba Canais):
 *   1) link do canal/perfil (obrigatório) → plataforma e @handle saem do link;
 *   2) autenticação: o usuário faz o login no navegador da conta e confirma;
 *   3) tipo do canal → a IA sugere nome, descrição e tags;
 *   4) marca (com "recriar") e banner;
 *   5) identidade: estilo de thumbnail e paletas do canal, dos vídeos e da thumbnail.
 * Tudo fica no próprio canal (settings.channels + brand.json na pasta dele). Funções puras: testáveis.
 */

/* ───────── 1) link ───────── */

export interface ParsedLink { platform: ChannelPlatform; handle?: string; id?: string; url: string }

/** Reconhece o link de canal/perfil das 5 plataformas. Link de vídeo avulso é recusado (precisa ser do canal). */
export function parseChannelLink(raw: string): ParsedLink {
  let t = (raw ?? '').trim();
  if (!t) throw new Error('cole o link do canal ou perfil');
  if (/^@[\w.-]{2,}$/.test(t)) return { platform: 'youtube', handle: t, url: `https://www.youtube.com/${t}` };
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  let u: URL;
  try { u = new URL(t); } catch { throw new Error('link inválido'); }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const first = parts[0] ?? '';
  const clean = (p: string) => p.replace(/^@/, '');
  if (host === 'youtube.com' || host === 'youtu.be') {
    if (host === 'youtu.be' || first === 'watch' || first === 'shorts' && parts.length > 1) throw new Error('isso é o link de um vídeo — cole o link do CANAL (youtube.com/@seucanal)');
    if (first.startsWith('@')) return { platform: 'youtube', handle: first, url: `https://www.youtube.com/${first}` };
    if (first === 'channel' && parts[1]) return { platform: 'youtube', id: parts[1], url: `https://www.youtube.com/channel/${parts[1]}` };
    if ((first === 'c' || first === 'user') && parts[1]) return { platform: 'youtube', handle: `@${parts[1]}`, url: `https://www.youtube.com/${first}/${parts[1]}` };
    throw new Error('link do YouTube sem o canal (use youtube.com/@seucanal)');
  }
  if (host === 'tiktok.com') {
    if (!first.startsWith('@')) throw new Error('link do TikTok sem o perfil (use tiktok.com/@perfil)');
    return { platform: 'tiktok', handle: first, url: `https://www.tiktok.com/${first}` };
  }
  if (host === 'instagram.com') {
    if (!first || ['p', 'reel', 'reels', 'stories', 'explore'].includes(first)) throw new Error('isso é o link de uma publicação — cole o link do PERFIL (instagram.com/perfil)');
    return { platform: 'instagram', handle: `@${clean(first)}`, url: `https://www.instagram.com/${clean(first)}/` };
  }
  if (host === 'facebook.com' || host === 'fb.com') {
    if (first === 'profile.php') { const id = u.searchParams.get('id'); if (!id) throw new Error('link do Facebook sem o id'); return { platform: 'facebook', id, url: `https://www.facebook.com/profile.php?id=${id}` }; }
    if (!first || ['watch', 'reel', 'videos', 'share'].includes(first)) throw new Error('cole o link da PÁGINA do Facebook (facebook.com/suapagina)');
    return { platform: 'facebook', handle: `@${clean(first)}`, url: `https://www.facebook.com/${clean(first)}` };
  }
  if (host === 'kwai.com' || host.endsWith('.kwai.com') || host === 'kw.ai') {
    const at = parts.find((p) => p.startsWith('@'));
    if (!at) throw new Error('link do Kwai sem o perfil (use kwai.com/@perfil)');
    return { platform: 'kwai', handle: at, url: `https://www.kwai.com/${at}` };
  }
  throw new Error(`plataforma não reconhecida (${host}) — aceitos: YouTube, TikTok, Instagram, Facebook e Kwai`);
}

/* ───────── 3) tipo do canal ───────── */

export interface ChannelType { id: string; label: string; hint: string; thumbStyle: string; mode: 'dark' | 'light' }

/** Tipos de canal que o app sabe configurar (cada um puxa um estilo de thumbnail e um modo de paleta padrão). */
export const CHANNEL_TYPES: ChannelType[] = [
  { id: 'dark-narrado', label: 'Dark narrado (faceless)', hint: 'narração em off com imagens, B-roll e motion graphics; curiosidades, mistérios, história', thumbStyle: 'impacto', mode: 'dark' },
  { id: 'documentario', label: 'Documentário / ensaio', hint: 'vídeos longos com pesquisa, arquivo e narrativa em atos', thumbStyle: 'documentario', mode: 'dark' },
  { id: 'educativo', label: 'Educativo / explicativo', hint: 'explica um conceito com diagramas, animação 2D e exemplos', thumbStyle: 'explicativo', mode: 'light' },
  { id: 'tutorial', label: 'Tutorial / tela', hint: 'passo a passo com gravação de tela e mockups de interface', thumbStyle: 'split', mode: 'light' },
  { id: 'shorts-curiosidades', label: 'Shorts / Reels de curiosidades', hint: 'vertical, 15–60 s, gancho no 1º segundo, legenda palavra a palavra', thumbStyle: 'impacto', mode: 'dark' },
  { id: 'noticias', label: 'Notícias / comentário', hint: 'atualidades com manchete, dados e opinião', thumbStyle: 'impacto', mode: 'dark' },
  { id: 'financas', label: 'Finanças / negócios', hint: 'dinheiro, investimentos, empreendedorismo; números e gráficos', thumbStyle: 'explicativo', mode: 'dark' },
  { id: 'historias', label: 'Histórias / animação', hint: 'contos, histórias com personagens, animação cartoon', thumbStyle: 'impacto', mode: 'light' },
  { id: 'infantil', label: 'Infantil', hint: 'cores vivas, músicas, personagens fofos, ritmo suave', thumbStyle: 'minimal', mode: 'light' },
  { id: 'musica', label: 'Música / lo-fi / relax', hint: 'coletâneas e clipes, visual em loop', thumbStyle: 'minimal', mode: 'dark' },
  { id: 'review', label: 'Reviews / produtos', hint: 'análise de produtos, comparativos e unboxing', thumbStyle: 'split', mode: 'light' },
  { id: 'outro', label: 'Outro (descrevo)', hint: 'descreva o canal no campo de ideia', thumbStyle: 'impacto', mode: 'dark' },
];

export const channelType = (id?: string) => CHANNEL_TYPES.find((t) => t.id === id);

/** Estilos de thumbnail (mesmos layouts dos templates do app). */
export const THUMB_STYLES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'impacto', label: 'Impacto', hint: 'rosto/objeto grande, 2–3 palavras enormes com contorno, contraste alto' },
  { id: 'explicativo', label: 'Explicativo', hint: 'objeto + seta/círculo, texto curto que promete a resposta' },
  { id: 'documentario', label: 'Documentário', hint: 'foto cinematográfica, título sóbrio, granulação' },
  { id: 'minimal', label: 'Minimalista', hint: 'fundo liso, um elemento, tipografia limpa' },
  { id: 'split', label: 'Antes × depois', hint: 'tela dividida, comparação lado a lado' },
];

/* ───────── 5) paletas ───────── */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const isHex = (x: unknown): x is string => typeof x === 'string' && HEX.test(x.trim());

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Luminância relativa (WCAG 2.x). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre duas cores (1–21). ≥ 4,5 = texto legível; ≥ 7 = ótimo. */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

/**
 * Dá papéis a uma lista de hex: fundo = a mais escura ou a mais clara (conforme o modo), texto = a de maior
 * contraste com o fundo, destaque = a mais saturada que sobrou. A marca lista as cores como
 * [primária, secundária, destaque, FUNDO]: se a última for bem escura/clara, ela é o fundo e define o modo.
 * Sem isso, vence o lado com mais cores (empate = escuro).
 */
export function paletteRoles(colors: string[], mode?: 'dark' | 'light'): PaletteSpec {
  const list = [...new Set(colors.filter(isHex).map((c) => c.toLowerCase()))];
  if (!list.length) return {};
  const byLum = [...list].sort((a, b) => luminance(a) - luminance(b));
  const darkest = byLum[0]!, lightest = byLum[byLum.length - 1]!;
  const last = list[list.length - 1]!;
  const lastMode = list.length > 1 ? (luminance(last) < 0.15 ? 'dark' : luminance(last) > 0.75 ? 'light' : undefined) : undefined;
  const darkN = list.filter((c) => luminance(c) < 0.2).length, lightN = list.filter((c) => luminance(c) > 0.6).length;
  const m = mode ?? lastMode ?? (lightN > darkN ? 'light' : 'dark');
  const background = lastMode === m ? last : m === 'dark' ? darkest : lightest;
  const rest = list.filter((c) => c !== background);
  const text = rest.length ? [...rest].sort((a, b) => contrastRatio(b, background) - contrastRatio(a, background))[0]! : (m === 'dark' ? '#ffffff' : '#111111');
  const sat = (hex: string) => { const [r, g, b] = rgb(hex); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
  const others = rest.filter((c) => c !== text);
  const accent = others.length ? [...others].sort((a, b) => sat(b) - sat(a))[0] : undefined;
  const secondary = others.find((c) => c !== accent);
  return {
    background, text, accent, secondary,
    extra: others.filter((c) => c !== accent && c !== secondary).slice(0, 4),
    mode: m, contrast: contrastRatio(text, background),
  };
}

/** Normaliza uma paleta vinda da IA (objeto com papéis ou lista) e recalcula contraste e modo. */
export function normalizePalette(raw: unknown, fallbackMode?: 'dark' | 'light'): PaletteSpec | undefined {
  if (Array.isArray(raw)) { const p = paletteRoles(raw as string[], fallbackMode); return p.background ? p : undefined; }
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const pick = (k: string) => (isHex(o[k]) ? String(o[k]).trim().toLowerCase() : undefined);
  const background = pick('background') ?? pick('bg');
  const text = pick('text');
  const accent = pick('accent');
  if (!background && !text && !accent) {
    const colors = Object.values(o).flat().filter(isHex) as string[];
    return colors.length ? paletteRoles(colors, fallbackMode) : undefined;
  }
  const extra = Array.isArray(o['extra']) ? (o['extra'] as unknown[]).filter(isHex).map((x) => String(x).toLowerCase()).slice(0, 4) : undefined;
  const bg = background ?? (fallbackMode === 'light' ? '#ffffff' : '#0b0b10');
  const tx = text ?? (luminance(bg) < 0.4 ? '#ffffff' : '#111111');
  return { background: bg, text: tx, accent, secondary: pick('secondary'), extra, mode: luminance(bg) < 0.4 ? 'dark' : 'light', contrast: contrastRatio(tx, bg) };
}

/** Paleta → lista ordenada de hex (o formato que banner/thumb e as marcas antigas usam). */
export const paletteList = (p?: PaletteSpec): string[] =>
  p ? [p.accent, p.secondary, p.text, p.background, ...(p.extra ?? [])].filter((x): x is string => !!x) : [];

/** Identidade padrão a partir da marca e do tipo: as cores da marca viram as três paletas. */
export function defaultIdentity(brand: ChannelBrand | undefined, type?: string): ChannelIdentity {
  const t = channelType(type);
  const base = paletteRoles(brand?.colors ?? [], t?.mode);
  const thumbBase = base.accent ? { ...base, text: '#ffffff', contrast: contrastRatio('#ffffff', base.background ?? '#000000') } : base;
  return {
    palettes: { channel: base.background ? base : undefined, video: base.background ? base : undefined, thumbnail: thumbBase.background ? thumbBase : undefined },
    thumbStyle: t?.thumbStyle ?? 'impacto',
    typography: brand?.fonts ? { family: brand.fonts.split(/[,/]/)[0]?.trim() } : undefined,
  };
}

/** Junta a identidade sugerida pela IA (brand.identity) com a do usuário (o que o usuário já definiu vence). */
export function mergeIdentity(current: ChannelIdentity | undefined, suggested: ChannelIdentity | undefined): ChannelIdentity {
  const c = current ?? {}, s = suggested ?? {};
  return {
    palettes: { channel: c.palettes?.channel ?? s.palettes?.channel, video: c.palettes?.video ?? s.palettes?.video, thumbnail: c.palettes?.thumbnail ?? s.palettes?.thumbnail },
    thumbStyle: c.thumbStyle ?? s.thumbStyle, thumbRules: c.thumbRules ?? s.thumbRules,
    typography: c.typography ?? s.typography,
    updatedAt: new Date().toISOString(),
  };
}

/* ───────── marca: histórico e "recriar" ───────── */

export const BRAND_HISTORY_MAX = 6;

/** Guarda a marca atual no histórico (a mais recente primeiro) antes de trocar por outra. */
export function pushBrandHistory(ch: Channel, next: ChannelBrand): Channel {
  const prev = ch.brand;
  if (prev && JSON.stringify(prev) !== JSON.stringify(next)) ch.brandHistory = [prev, ...(ch.brandHistory ?? [])].slice(0, BRAND_HISTORY_MAX);
  ch.brand = { ...next, createdAt: next.createdAt ?? new Date().toISOString() };
  return ch;
}

/** Volta uma marca do histórico (a atual entra no histórico no lugar dela). */
export function restoreBrand(ch: Channel, index: number): Channel {
  const hist = ch.brandHistory ?? [];
  const pick = hist[index];
  if (!pick) throw new Error('essa versão da marca não existe');
  const rest = hist.filter((_, i) => i !== index);
  ch.brandHistory = (ch.brand ? [ch.brand, ...rest] : rest).slice(0, BRAND_HISTORY_MAX);
  ch.brand = pick;
  return ch;
}

/** Texto para o prompt de "recriar": a IA não repete nomes e conceitos já usados. */
export function recreateNote(ch: Channel): string {
  const used = [ch.brand, ...(ch.brandHistory ?? [])].filter((b): b is ChannelBrand => !!b);
  if (!used.length) return '';
  const names = [...new Set(used.flatMap((b) => b.names ?? []))].slice(0, 20);
  const tags = [...new Set(used.map((b) => b.tagline).filter(Boolean))].slice(0, 6);
  return `RECRIAR A MARCA: proponha um conceito DIFERENTE das versões anteriores. Não repita estes nomes: ${names.join(', ') || '—'}.` +
    (tags.length ? ` Taglines já usadas: ${tags.join(' | ')}.` : '') + ' Mude também a paleta e o ângulo do logo.';
}

/* ───────── progresso do cadastro ───────── */

export type SetupStep = 'link' | 'auth' | 'type' | 'brand' | 'banner' | 'identity' | 'analytics';
export const SETUP_ORDER: SetupStep[] = ['link', 'auth', 'type', 'brand', 'banner', 'identity', 'analytics'];

/** Quais passos do cadastro o canal já cumpriu (a UI marca ✓ e aponta o próximo). */
export function setupStatus(ch: Channel): { done: SetupStep[]; next?: SetupStep } {
  const ok: Record<SetupStep, boolean> = {
    link: !!ch.url,
    auth: ch.auth?.status === 'confirmed',
    type: !!ch.type,
    brand: !!ch.brand,
    banner: !!ch.assets?.banner,
    identity: !!(ch.identity?.palettes?.video || ch.identity?.thumbStyle),
    analytics: !!ch.analytics,
  };
  const done = SETUP_ORDER.filter((s) => ok[s]);
  return { done, next: SETUP_ORDER.find((s) => !ok[s]) };
}

/** Paleta em inglês para prompts de imagem ("background #0b0b10, text #ffffff, accent #ffcc00, dark mode"). */
export function paletteEnglish(p?: PaletteSpec): string {
  if (!p) return '';
  return [p.background && `background ${p.background}`, p.text && `text ${p.text}`, p.accent && `accent ${p.accent}`, p.secondary && `secondary ${p.secondary}`, p.mode && `${p.mode} mode`].filter(Boolean).join(', ');
}

/** Bloco da PALETA DO PROJETO (Novo projeto) — vence a do canal e a do formato. Função pura. */
export function projectPalettePrompt(pal: { video?: PaletteSpec; thumbnail?: PaletteSpec } | undefined, step?: string): string {
  if (!pal || !step || ['narration', 'transcribe', 'music', 'sfx', 'publish', 'edit'].includes(step)) return '';
  const p = step === 'thumbnail' ? pal.thumbnail ?? pal.video : pal.video;
  if (!p?.background && !p?.accent) return '';
  return `PALETA DESTE PROJETO (escolhida pelo usuário — VENCE a do canal, da skill e do formato de referência): fundo ${p.background ?? '—'}, texto ${p.text ?? '—'}, destaque ${p.accent ?? '—'}${p.secondary ? `, apoio ${p.secondary}` : ''}${p.mode ? ` (modo ${p.mode})` : ''}${p.contrast ? `, contraste ${p.contrast}:1` : ''}. Use essas cores em fundos, texto na tela, gráficos e destaques.`;
}

/**
 * Bloco de IDENTIDADE DO CANAL para os prompts da produção: paleta dos vídeos, tipografia e thumbnail do canal
 * do usuário. Vence a paleta/tipografia do formato clonado (o clone dá só a estrutura).
 */
export function identityPrompt(ch: Channel | undefined, step?: string): string {
  if (!ch) return '';
  const id = ch.identity ?? {};
  const fmt = (p?: PaletteSpec) => p ? [p.background && `fundo ${p.background}`, p.text && `texto ${p.text}`, p.accent && `destaque ${p.accent}`, p.secondary && `apoio ${p.secondary}`,
    p.mode && `modo ${p.mode}`, p.contrast && `contraste ${p.contrast}:1`].filter(Boolean).join(', ') : '';
  const thumb = step === 'thumbnail';
  const pal = thumb ? id.palettes?.thumbnail ?? id.palettes?.video : id.palettes?.video ?? id.palettes?.channel;
  const ty = id.typography;
  const typo = ty ? [ty.family, ty.weight, ty.case && `caixa ${ty.case === 'upper' ? 'ALTA' : ty.case === 'title' ? 'de título' : 'de frase'}`, ty.outline && `contorno ${ty.outline}`, ty.shadow && `sombra ${ty.shadow}`, ty.animation && `animação ${ty.animation}`].filter(Boolean).join(', ') : ch.brand?.fonts;
  const st = THUMB_STYLES.find((x) => x.id === id.thumbStyle);
  const parts = [
    pal && fmt(pal) && `- paleta ${thumb ? 'da thumbnail' : 'dos vídeos'}: ${fmt(pal)}`,
    typo && `- tipografia: ${typo}`,
    thumb && st && `- estilo de thumbnail do canal: ${st.label} (${st.hint})${id.thumbRules ? `; ${id.thumbRules}` : ''}`,
    ch.brand?.tone && `- tom da marca: ${ch.brand.tone}`,
  ].filter(Boolean);
  if (!parts.length) return '';
  return `IDENTIDADE DO CANAL "${ch.name}" (do usuário — VENCE a paleta, a tipografia e a marca do formato de referência; do formato use só a estrutura: ritmo, atos, câmera, densidade):\n${parts.join('\n')}`;
}
