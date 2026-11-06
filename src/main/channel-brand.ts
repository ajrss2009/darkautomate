import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChannelBrand, HarnessId, Settings } from '../shared/types';
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
}

export interface BrandProgress { stage: 'brief' | 'render' | 'done'; pct: number; label: string }

export interface BrandResult {
  brand: ChannelBrand;
  files: { banner?: string; avatar?: string };
  warnings: string[];
}

const PLATFORM_HINT: Record<string, string> = {
  youtube: 'YouTube (descrição de 600–1000 caracteres, com palavras-chave de busca, tom de quem fala direto com o inscrito)',
  tiktok: 'TikTok (descrição curta e direta, com hashtags; tom jovem e energético)',
  instagram: 'Instagram (bio curta + descrição; tom visual e pessoal)',
  facebook: 'Facebook (nome legível e descrição objetiva; tom acessível)',
};

function buildPrompt(i: BrandInput, lang: string): string {
  const platform = PLATFORM_HINT[i.platform ?? 'youtube'] ?? PLATFORM_HINT['youtube']!;
  return `Você vai criar a MARCA de um canal novo na plataforma ${platform}.

IDEIA DO CANAL: ${i.idea}
${i.name?.trim() ? `NOME JÁ ESCOLHIDO (mantenha): ${i.name.trim()}` : 'O nome ainda não foi escolhido: sugira 5 opções curtas, memoráveis e fáceis de digitar.'}
${i.note?.trim() ? `OBSERVAÇÕES DO CRIADOR: ${i.note.trim()}` : ''}

Responda SOMENTE com JSON, em ${lang}, neste formato exato:
{
  "names": ["5 nomes de canal, do melhor para o pior${i.name?.trim() ? ' (o primeiro é o escolhido)' : ''}"],
  "handle": "@...",
  "tagline": "uma frase curta (até 60 caracteres) que resume o canal",
  "description": "a descrição pronta para colar na plataforma",
  "keywords": ["12 palavras-chave de busca, sem #"],
  "colors": ["#hex cor primária", "#hex secundária", "#hex destaque", "#hex fundo"],
  "fonts": "duas famílias tipográficas do sistema (título, corpo) que combinem com o tom",
  "logoIdea": "como o logo/monograma deve ser desenhado (formas, símbolo, sem imagem externa)",
  "bannerPrompt": "prompt de imagem para um banner 2560×1440 da marca",
  "avatarPrompt": "prompt de imagem para um avatar quadrado 800×800",
  "tone": "o tom de voz em uma frase"
}
Seja específico (hex, nomes reais de fonte). Nada de clichê genérico; cada proposta precisa caber na ideia acima.`;
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

const sanitize = (b: Record<string, unknown>): ChannelBrand => {
  const str = (k: string) => (typeof b[k] === 'string' ? String(b[k]).trim() : undefined);
  const list = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).map((x) => String(x).trim()).filter(Boolean) : undefined);
  const colors = list('colors')?.filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c));
  return {
    names: list('names'), handle: str('handle'), tagline: str('tagline'), description: str('description'),
    keywords: list('keywords'), colors: colors?.length ? colors : undefined,
    fonts: str('fonts'), logoIdea: str('logoIdea'), bannerPrompt: str('bannerPrompt'), avatarPrompt: str('avatarPrompt'), tone: str('tone'),
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

  const prompt = buildPrompt(input, lang);
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

  const brand = sanitize(raw);
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
  const colors = brand.colors?.length ? brand.colors : ['#7c5cff', '#101014', '#f5f8ff', '#04040a'];
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
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
/** A IA devolve algo como "Inter / Source Sans" — o CSS só aceita a primeira família de cada papel. */
const cssFonts = (f?: string) => f?.replace(/[^a-zA-Z0-9 ,-]/g, '').split(/[,/]/).slice(0, 2).map((x) => x.trim()).filter(Boolean).join(',') || 'system-ui';
