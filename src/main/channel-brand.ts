import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChannelBrand, ChannelIdentity, HarnessId, Settings } from '../shared/types';
import { channelType, normalizePalette, paletteList, paletteRoles, THUMB_STYLES } from './channel-setup';
import { isHttpHarness, resolveHarness, runHarness } from './harness';
import { activeAgyEnv } from './automations';
import { channelDir } from './channels';
import type { RenderHtml } from './executors';

/**
 * MARCA DO CANAL: o que o "clonar canal" já sabe pedir a uma IA (nome, handle, tagline,
 * descrição, palavras-chave, cores, fontes, prompt do banner e do avatar) — mas partindo de
 * uma ideia SUA, não da análise de um canal alheio. Depois renderiza banner e avatar por código.
 */

export interface BrandInput {
  /** a ideia/nicho do canal, em uma ou duas frases */
  idea: string;
  /** nome já decidido (vazio = a IA sugere 5) */
  name?: string;
  /** plataforma de destino, para o tom e o formato da descrição */
  platform?: string;
  /** idioma do canal (vazio = pt-BR) */
  language?: string;
  harness: HarnessId | 'auto';
  model?: string;
  /** observação extra: público, restrições, referências de estilo */
  note?: string;
  /** tipo do canal (id de CHANNEL_TYPES) */
  type?: string;
  /** link do canal (quando já existe na plataforma) */
  link?: string;
  /** recriar: proposta diferente das marcas anteriores (texto montado por recreateNote) */
  recreate?: string;
  /** resumo da análise de métricas do canal (quando já existe) */
  analytics?: string;
}

export interface BrandProgress { stage: 'brief' | 'render' | 'done'; pct: number; label: string }

export interface BrandResult {
  brand: ChannelBrand;
  files: { banner?: string; avatar?: string; thumb?: string };
  warnings: string[];
}

const PLATFORM_HINT: Record<string, string> = {
  youtube: 'YouTube (descrição de 600–1000 caracteres, com palavras-chave de busca, tom de quem fala direto com o inscrito)',
  tiktok: 'TikTok (descrição curta e direta, com hashtags; tom jovem e energético)',
  instagram: 'Instagram (bio curta + descrição; tom visual e pessoal)',
  facebook: 'Facebook (nome legível e descrição objetiva; tom acessível)',
  kwai: 'Kwai (descrição curta, popular e direta, com hashtags; público amplo e mobile)',
};

export function buildBrandPrompt(i: BrandInput, lang: string): string {
  const platform = PLATFORM_HINT[i.platform ?? 'youtube'] ?? PLATFORM_HINT['youtube']!;
  const t = channelType(i.type);
  const styles = THUMB_STYLES.map((x) => x.id).join('|');
  return `Você vai criar a MARCA de um canal na plataforma ${platform} e CONFIGURAR o canal (nome, descrição, tags, identidade visual).

IDEIA DO CANAL: ${i.idea}
${t ? `TIPO DO CANAL: ${t.label} — ${t.hint}. Paleta tende a ${t.mode === 'dark' ? 'fundo escuro' : 'fundo claro'}; thumbnail no estilo "${t.thumbStyle}" (mude se a ideia pedir).` : ''}
${i.link?.trim() ? `LINK DO CANAL (já existe): ${i.link.trim()}` : ''}
${i.analytics?.trim() ? `MÉTRICAS ATUAIS DO CANAL: ${i.analytics.trim()}` : ''}
${i.name?.trim() ? `NOME JÁ ESCOLHIDO (mantenha): ${i.name.trim()}` : 'O nome ainda não foi escolhido: sugira 5 opções curtas, memoráveis e fáceis de digitar.'}
${i.note?.trim() ? `OBSERVAÇÕES DO CRIADOR: ${i.note.trim()}` : ''}
${i.recreate?.trim() ? i.recreate.trim() : ''}

Responda SOMENTE com JSON, em ${lang}, neste formato exato:
{
  "names": ["5 nomes de canal, do melhor para o pior${i.name?.trim() ? ' (o primeiro é o escolhido)' : ''}"],
  "handle": "@...",
  "tagline": "uma frase curta (até 60 caracteres) que resume o canal",
  "description": "a descrição pronta para colar na plataforma",
  "keywords": ["12 palavras-chave de busca, sem #"],
  "tags": ["15 tags do canal (as palavras-chave que a plataforma pede nas configurações), sem #"],
  "colors": ["#hex cor primária", "#hex secundária", "#hex destaque", "#hex fundo"],
  "fonts": "duas famílias tipográficas do sistema (título, corpo) que combinem com o tom",
  "logoIdea": "como o logo/monograma deve ser desenhado (formas, símbolo, sem imagem externa)",
  "bannerPrompt": "prompt de imagem para um banner 2560×1440 da marca",
  "avatarPrompt": "prompt de imagem para um avatar quadrado 800×800",
  "tone": "o tom de voz em uma frase",
  "identity": {
    "palettes": {
      "channel": { "background": "#hex", "text": "#hex", "accent": "#hex", "secondary": "#hex" },
      "video": { "background": "#hex fundo das cenas", "text": "#hex texto na tela", "accent": "#hex palavra de destaque", "secondary": "#hex" },
      "thumbnail": { "background": "#hex", "text": "#hex texto grande", "accent": "#hex contorno/seta", "secondary": "#hex" }
    },
    "thumbStyle": "${styles}",
    "thumbRules": "regras da thumbnail: quantas palavras, tamanho, contorno, rosto/objeto, posição",
    "typography": { "family": "fonte do texto na tela", "weight": "800", "case": "upper|title|sentence", "outline": "ex.: 6 px preto", "shadow": "ex.: sombra dura 4 px", "animation": "pop|fade|typewriter|slide|karaoke" }
  }
}
O texto das paletas precisa ter contraste de pelo menos 4,5:1 com o fundo. Seja específico (hex, nomes reais de fonte). Nada de clichê genérico; cada proposta precisa caber na ideia acima.`;
}

/** Procura o primeiro objeto JSON plausível na resposta do modelo (CLIs costumam vir com texto em volta). */
function parseJsonLoose(text: string): Record<string, unknown> | undefined {
  const tries = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) tries.push(fenced[1].trim());
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first >= 0 && last > first) tries.push(text.slice(first, last + 1));
  for (const s of tries) {
    try { const v = JSON.parse(s) as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>; } catch { /* tenta o próximo */ }
  }
  return undefined;
}

export const sanitizeBrand = (b: Record<string, unknown>, type?: string): ChannelBrand => {
  const str = (k: string) => (typeof b[k] === 'string' ? String(b[k]).trim() : undefined);
  const list = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).map((x) => String(x).trim()).filter(Boolean) : undefined);
  const colors = list('colors')?.filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c));
  const mode = channelType(type)?.mode;
  const idRaw = (b['identity'] && typeof b['identity'] === 'object' ? b['identity'] : {}) as Record<string, unknown>;
  const pals = (idRaw['palettes'] && typeof idRaw['palettes'] === 'object' ? idRaw['palettes'] : {}) as Record<string, unknown>;
  const ty = (idRaw['typography'] && typeof idRaw['typography'] === 'object' ? idRaw['typography'] : undefined) as Record<string, unknown> | undefined;
  const s2 = (v: unknown, n = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
  const caseV = s2(ty?.['case'], 12)?.toLowerCase();
  const thumbStyle = s2(idRaw['thumbStyle'], 30);
  const identity: ChannelIdentity = {
    palettes: { channel: normalizePalette(pals['channel'], mode) ?? (colors?.length ? paletteRoles(colors, mode) : undefined),
      video: normalizePalette(pals['video'], mode), thumbnail: normalizePalette(pals['thumbnail'], mode) },
    thumbStyle: thumbStyle && THUMB_STYLES.some((x) => x.id === thumbStyle) ? thumbStyle : channelType(type)?.thumbStyle,
    thumbRules: s2(idRaw['thumbRules'], 600),
    typography: ty ? { family: s2(ty['family']), weight: s2(ty['weight'], 20), case: caseV === 'upper' || caseV === 'title' || caseV === 'sentence' ? caseV : undefined,
      outline: s2(ty['outline']), shadow: s2(ty['shadow']), animation: s2(ty['animation'], 40) } : undefined,
  };
  return {
    names: list('names'), handle: str('handle'), tagline: str('tagline'), description: str('description'),
    keywords: list('keywords'), tags: list('tags')?.map((t) => t.replace(/^#/, '')).slice(0, 30), colors: colors?.length ? colors : undefined,
    fonts: str('fonts'), logoIdea: str('logoIdea'), bannerPrompt: str('bannerPrompt'), avatarPrompt: str('avatarPrompt'), tone: str('tone'),
    identity, createdAt: new Date().toISOString(),
  };
};

export const channelBrandDir = (s: Settings, id: string) => channelDir(s, id);

/**
 * Pede a marca à IA e grava brand.json na pasta do canal.
 * Não toca em Settings — quem chama (canal IPC) decide quando persistir.
 */
export async function generateBrand(s: Settings, id: string, input: BrandInput, o: {
  log: (l: string) => void; progress?: (p: BrandProgress) => void; signal?: AbortSignal;
  renderHtml?: RenderHtml;
}): Promise<BrandResult> {
  const lang = input.language?.trim() || 'pt-BR';
  const warnings: string[] = [];
  const dir = channelDir(s, id);
  fs.mkdirSync(dir, { recursive: true });

  if (!input.idea?.trim()) throw new Error('descreva a ideia do canal para a IA criar a marca');

  o.progress?.({ stage: 'brief', pct: 5, label: 'lendo a ideia' });
  const { id: hid, cfg, model } = await resolveHarness(s, { type: 'harness', harness: input.harness, model: input.model });
  const http = isHttpHarness(cfg);
  const env = hid === 'antigravity' ? activeAgyEnv(s) : undefined;
  const ac = o.signal ?? new AbortController().signal;

  o.log(`criando a marca com ${hid}${model ? '/' + model : ''}…`);
  o.progress?.({ stage: 'brief', pct: 20, label: 'a IA está escrevendo a marca' });

  const prompt = buildBrandPrompt(input, lang);
  const res = await runHarness(cfg, {
    cwd: dir, prompt, model, signal: ac, onLine: (l) => o.log(l.slice(0, 300)), timeoutSec: 900, env,
    tools: http ? undefined : { roots: [dir], allowShell: false },
  });

  let raw = parseJsonLoose(res.stdout);
  /* CLIs que escrevem arquivo em vez de stdout: o modelo pode ter gravado brand.json por conta própria */
  if (!raw) {
    const file = path.join(dir, 'brand.json');
    if (fs.existsSync(file)) { try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { /* inválido */ } }
  }
  if (!raw) throw new Error(`a IA não devolveu a marca em JSON${res.stderr ? ` (${res.stderr.slice(-200)})` : ''}`);

  const brand = sanitizeBrand(raw, input.type);
  if (!brand.names?.length) warnings.push('a IA não sugeriu nomes');
  if (!brand.description) warnings.push('a IA não entregou a descrição do canal');
  if (!brand.colors?.length) warnings.push('a IA não entregou cores válidas em hex — o banner usa a paleta padrão');
  fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify(brand, null, 2));

  o.progress?.({ stage: 'render', pct: 60, label: 'desenhando banner e avatar' });
  const files = await renderBrandFiles(s, id, brand, { log: o.log, signal: ac, renderHtml: o.renderHtml });

  o.progress?.({ stage: 'done', pct: 100, label: 'marca pronta' });
  return { brand, files, warnings };
}

/** Renderiza banner (2560×1440, área segura 1546×423) e avatar (800×800) a partir da marca. */
export async function renderBrandFiles(s: Settings, id: string, brand: ChannelBrand, o: { log: (l: string) => void; signal?: AbortSignal; renderHtml?: RenderHtml }): Promise<BrandResult['files']> {
  const dir = channelDir(s, id);
  const out: BrandResult['files'] = {};
  const render = o.renderHtml;
  if (!render) { o.log('sem renderizador de HTML nesta chamada — banner e avatar não foram gerados'); return out; }

  const name = brand.names?.[0] ?? 'Canal';
  /* paleta do canal (com papéis: destaque, apoio, texto, fundo) vence a lista solta de cores */
  const roles = paletteList(brand.identity?.palettes?.channel);
  const colors = roles.length >= 4 ? roles : brand.colors?.length ? brand.colors : ['#7c5cff', '#101014', '#f5f8ff', '#04040a'];
  const [c1, c2, c3, c4] = [colors[0], colors[1] ?? colors[0], colors[2] ?? '#ffffff', colors[3] ?? '#000000'];

  fs.mkdirSync(dir, { recursive: true });
  const bannerHtml = path.join(dir, 'banner.html');
  const avatarHtml = path.join(dir, 'avatar.html');

  fs.writeFileSync(bannerHtml, `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:2560px;height:1440px;overflow:hidden;background:${c4};font-family:${cssFonts(brand.fonts)}}
.wrap{position:absolute;inset:0;display:grid;place-items:center;background:
radial-gradient(1200px 600px at 30% 40%, ${c1}55, transparent 70%),
radial-gradient(900px 500px at 75% 70%, ${c2}44, transparent 70%), ${c4}}
/* área segura do YouTube: 1546×423, centralizada em 2560×1440 */
.safe{position:absolute;left:50%;top:50%;width:1546px;height:423px;transform:translate(-50%,-50%);
display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center}
h1{margin:0;font-size:132px;line-height:1.05;letter-spacing:-3px;color:${c3};font-family:${cssFonts(brand.fonts)},sans-serif}
p{margin:0;font-size:42px;color:${c3};opacity:.82;max-width:1300px}
.dot{width:170px;height:10px;border-radius:999px;background:linear-gradient(90deg,${c1},${c2})}
</style></head><body><div class="wrap"><div class="safe"><h1>${esc(name)}</h1>${brand.tagline ? `<p>${esc(brand.tagline)}</p>` : ''}<div class="dot"></div></div></div></body></html>`);

  fs.writeFileSync(avatarHtml, `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:800px;height:800px;overflow:hidden;background:${c4}}
.box{width:800px;height:800px;display:grid;place-items:center;
background:radial-gradient(520px 520px at 35% 30%, ${c1}cc, transparent 72%),linear-gradient(140deg,${c2},${c4})}
span{font-size:360px;line-height:1;font-weight:800;color:${c3};font-family:${cssFonts(brand.fonts)},sans-serif;letter-spacing:-10px}
</style></head><body><div class="box"><span>${esc(initials(name))}</span></div></body></html>`);

  const dur = 0.1;
  const tryRender = async (html: string, outFile: string, w: number, h: number) => {
    if (o.signal?.aborted) throw new Error('cancelado');
    try {
      await render(html, outFile, { w, h, ffmpeg: s.ffmpeg || 'ffmpeg', duration: dur, fps: 30, log: o.log });
      return fs.existsSync(outFile) ? outFile : undefined;
    } catch (e) { o.log(`não consegui renderizar ${path.basename(outFile)}: ${(e as Error).message.slice(0, 200)}`); return undefined; }
  };

  out.banner = await tryRender(bannerHtml, path.join(dir, 'banner.png'), 2560, 1440);
  out.avatar = await tryRender(avatarHtml, path.join(dir, 'avatar.png'), 800, 800);
  /* thumbnail modelo no estilo e na paleta de thumbnail do canal */
  const thumbHtml = path.join(dir, 'thumb.html');
  fs.writeFileSync(thumbHtml, thumbModelHtml(brand, name));
  out.thumb = await tryRender(thumbHtml, path.join(dir, 'thumb.png'), 1280, 720);
  return out;
}

/** Thumbnail modelo 1280×720 (por código) no estilo escolhido do canal: mostra paleta, tipografia e composição. */
export function thumbModelHtml(brand: ChannelBrand, name: string): string {
  const id = brand.identity ?? {};
  const p = id.palettes?.thumbnail ?? id.palettes?.video ?? paletteRoles(brand.colors ?? []);
  const bg = p.background ?? '#0b0b10', tx = p.text ?? '#ffffff', ac = p.accent ?? '#ffcc00', se = p.secondary ?? ac;
  const ty = id.typography ?? {};
  const word = (brand.tagline ?? name).split(/\s+/).slice(0, 3).join(' ');
  const txt = ty.case === 'upper' || !ty.case ? word.toUpperCase() : word;
  const ow = Math.min(16, Math.max(0, Number(/(\d+)\s*px/.exec(ty.outline ?? '')?.[1] ?? 6)));
  const outline = `-webkit-text-stroke:${ow}px #000`;
  const style = id.thumbStyle ?? 'impacto';
  const layout: Record<string, string> = {
    impacto: `.t{left:60px;bottom:60px;font-size:150px;max-width:760px}.obj{right:70px;top:90px;width:420px;height:540px;border-radius:40px}`,
    explicativo: `.t{left:60px;top:80px;font-size:110px;max-width:620px}.obj{right:120px;top:140px;width:400px;height:400px;border-radius:50%}.arrow{display:block}`,
    documentario: `.t{left:80px;bottom:80px;font-size:84px;max-width:900px;letter-spacing:4px}.obj{inset:0;width:auto;height:auto;opacity:.35;border-radius:0}`,
    minimal: `.t{left:50%;top:50%;transform:translate(-50%,-50%);font-size:120px;text-align:center}.obj{display:none}`,
    split: `.t{left:50%;bottom:50px;transform:translateX(-50%);font-size:100px;text-align:center}.obj{left:0;top:0;width:640px;height:720px;border-radius:0}`,
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:${bg};font-family:${cssFonts(ty.family ?? brand.fonts)},sans-serif}
.obj{position:absolute;background:linear-gradient(140deg,${ac},${se});box-shadow:0 30px 80px #0008}
.t{position:absolute;margin:0;line-height:.95;font-weight:${(ty.weight ?? '900').replace(/[^\w]/g, '') || '900'};color:${tx};${outline};paint-order:stroke fill;text-shadow:${esc(ty.shadow ? '0 8px 0 #000' : '0 6px 18px #000a')}}
.t b{color:${ac}}
.arrow{display:none;position:absolute;left:640px;top:330px;width:200px;height:24px;background:${ac};transform:rotate(-15deg)}
${layout[style] ?? layout['impacto']}
</style></head><body><div class="obj"></div><div class="arrow"></div><h1 class="t">${esc(txt).replace(/^(\S+)/, '<b>$1</b>')}</h1></body></html>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
/** A IA devolve algo como "Inter / Source Sans" — o CSS só aceita a primeira família de cada papel. */
const cssFonts = (f?: string) => f?.replace(/[^a-zA-Z0-9 ,-]/g, '').split(/[,/]/).slice(0, 2).map((x) => x.trim()).filter(Boolean).join(',') || 'system-ui';
