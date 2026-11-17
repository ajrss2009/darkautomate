import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Aspect, HarnessId, PluginInfo, Settings, Skill } from '../shared/types';
import { isHttpHarness, resolveHarness, runHarness } from './harness';
import { activeAgyEnv } from './automations';
import { getAnyRoute, saveSkill, slugify } from './library';
import { finalizeSkillMd, skillRules } from './skillgen';
import { pluginInventory, STEP_CATALOG } from './plugin-adapt';
import { extractZip, getPlugin, installPluginFolder, installPluginUrl, pluginRoot, pluginsRoot } from './plugins';
import { wrapAsPlugin } from './skill-import';

/*
 * SKILL A PARTIR DE UM PLUGIN (o plugin como HARNESS DE ESTILO):
 *   1) instala a origem (.plugin, .zip, .skill, pasta de plugin ou de skill solta, link do GitHub);
 *   2) lê TUDO o que o plugin entrega em texto — SKILL.md de cada estilo, referências, STANDARDS, PLAN,
 *      exemplos, manifest — e lista as ferramentas/bibliotecas que ele traz;
 *   3) uma IA (qualquer harness) extrai o estilo de vídeo, o visual e as minúcias (traço, paleta, tipografia,
 *      câmera, ritmo, som, regras numéricas, proibições) e escreve uma skill no formato do FilmForge;
 *   4) a skill é salva já com o plugin marcado (`plugins: [id]`): toda produção com ela usa as regras e as
 *      bibliotecas do plugin, como se fosse o harness dele.
 * O que se copia é o MÉTODO e o ESTILO, nunca o conteúdo (histórias, personagens, marcas).
 */

export interface PluginSkillInput {
  /** plugin já instalado */
  pluginId?: string;
  /** arquivo .plugin/.zip/.skill ou pasta — instala antes de analisar */
  file?: string;
  folder?: string;
  url?: string;
  harness: HarnessId | 'auto';
  model?: string;
  name?: string;
  language?: string;
  routeId?: string;
  aspect?: Aspect;
  durationSec?: number;
}
export interface PluginSkillResult {
  plugin: PluginInfo;
  skill: Skill;
  routeName: string;
  warnings: string[];
  workdir: string;
  /** arquivos do plugin que a IA leu */
  docs: string[];
}

const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** Pasta do plugin dentro de um zip extraído (zip com uma pasta só) ou no próprio diretório escolhido. */
export function pluginRootOf(dir: string): string {
  let inner: fs.Dirent[] = [];
  try { inner = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && e.name !== '__MACOSX'); } catch { return dir; }
  return inner.length === 1 && inner[0]!.isDirectory() ? path.join(dir, inner[0]!.name) : dir;
}

/**
 * Instala um plugin de QUALQUER origem: .plugin, .zip, .skill, pasta de plugin, pasta de skill solta
 * (só SKILL.md) ou link do GitHub. Skill solta vira um plugin do Claude antes de instalar.
 */
export function installPluginAny(s: Settings, src: string, source?: string): PluginInfo {
  const p = path.resolve(String(src ?? '').trim().replace(/^"|"$/g, ''));
  if (!p || !fs.existsSync(p)) throw new Error(`não encontrei ${src}`);
  const st = fs.statSync(p);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-plugin-any-'));
  try {
    let dir = p;
    if (st.isFile()) {
      if (!/\.(plugin|zip|skill)$/i.test(p)) throw new Error('use um arquivo .plugin, .zip ou .skill, uma pasta ou um link do GitHub');
      extractZip(p, path.join(tmp, 'x'));
      dir = pluginRootOf(path.join(tmp, 'x'));
    }
    try {
      return installPluginFolder(s, dir, source ?? p);
    } catch (e) {
      /* skill solta: um zip/pasta com SKILL.md e nada de plugin — vira plugin do Claude */
      const inner = pluginRootOf(dir);
      const skillMd = fs.existsSync(inner) ? fs.readdirSync(inner).find((f) => /^skill\.md$/i.test(f)) : undefined;
      if (!skillMd) throw e;
      const wrapped = wrapAsPlugin([inner], tmp);
      return installPluginFolder(s, wrapped, source ?? p);
    }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* pasta temporária */ } }
}

/**
 * O texto que o plugin entrega (SKILL.md, referências, STANDARDS/PLAN e README): é o "harness" que a IA vai ler.
 * Devolve os arquivos lidos e o texto já montado, com teto por arquivo e no total.
 */
export function pluginDocs(s: Settings, id: string, perDoc = 20000, total = 100000): { docs: string[]; text: string } {
  const inv = pluginInventory(s, id);
  const root = pluginRoot(path.join(pluginsRoot(s), id));
  const abs = new Set<string>();
  for (const it of inv.items) {
    const f = path.join(root, it.rel);
    if (/\.(md|markdown|txt|json)$/i.test(f) && !/licen[cs]e|third-party/i.test(it.rel)) abs.add(f);
  }
  /* arquivos de texto fora das skills (tools/STANDARDS.md, README, guias): a maioria das minúcias mora aqui */
  const walk = (d: string, depth: number) => {
    if (depth > 3 || abs.size > 60) return;
    let es: fs.Dirent[] = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name.startsWith('.') || /^(node_modules|_gallery|licenses|assets|images|dist|build|out)$/i.test(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      if (/\.(md|markdown|txt)$/i.test(e.name) && !/licen[cs]e|third-party|changelog/i.test(e.name)) abs.add(full);
    }
  };
  walk(root, 0);
  const rank = (abs: string) => {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    if (/skill\.md$/i.test(rel)) return 0;
    if (/standards|style|plan|guide|spec|rules/i.test(rel)) return 1;
    if (/readme/i.test(rel)) return 2;
    return 3;
  };
  const files = [...abs].filter((f) => fs.existsSync(f)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const docs: string[] = [];
  let text = '';
  for (const f of files) {
    const body = read(f).trim();
    if (body.length < 40) continue;
    const rel = path.relative(root, f).replace(/\\/g, '/');
    const piece = `\n\n===== ${rel} =====\n${body.slice(0, perDoc)}`;
    if (text.length + piece.length > total) break;
    text += piece; docs.push(rel);
  }
  return { docs, text: text.trim() };
}

/** Prompt do "skill de estilo": o plugin é o harness e a IA escreve a skill do FilmForge. */
export function pluginSkillPrompt(s: Settings, p: PluginInfo, o: { corpus: string; docs: string[]; scripts?: string[]; language?: string; routeId?: string; aspect?: Aspect; durationSec?: number }): string {
  const lang = o.language || 'pt-BR';
  return `Você é o CRIADOR DE SKILLS do FilmForge (estúdio de vídeo por IA orientado a cenas).
O PLUGIN abaixo é um HARNESS DE ESTILO: os arquivos dele dizem COMO o vídeo deve parecer e como cada etapa deve ser
conduzida (traço, paleta, tipografia, movimento, ritmo, som, regras numéricas e proibições). Leia TUDO e escreva UMA
skill do FilmForge (skill.md) que reproduza esse estilo em QUALQUER assunto.

## Plugin
- nome: ${p.displayName ?? p.name}${p.version ? ` · v${p.version}` : ''}
- descrição: ${(p.description ?? '—').slice(0, 600)}
- arquivos analisados (${o.docs.length}): ${o.docs.join(', ')}
- skills/comandos/agentes do plugin: ${(p.items ?? []).map((it) => `${it.kind}:${it.name}`).join(', ') || '—'}${o.scripts?.length ? `
- ferramentas/bibliotecas que o plugin traz (NÃO são executadas pelo app; o que puder virar regra ou cena por código, vire): ${o.scripts.slice(0, 40).join(', ')}` : ''}

## Conteúdo do plugin
${o.corpus}

## O que extrair — com precisão (é isto que faz o vídeo parecer do plugin)
1. VISUAL: tipo de imagem (animação 2D vetorial, papel/recorte, 3D voxel, pixel, colagem…), traço (espessura, cor, textura, contorno), paleta (hex quando o plugin citar), fundo, sombras, texturas, grão, vinheta, proporção de tela.
2. PERSONAGENS E CENÁRIOS: como são construídos (formas, olhos, boca, membros, cabelo), o que nunca aparece, como manter o mesmo personagem em cenas diferentes.
3. CÂMERA E MOVIMENTO: enquadramentos (plano geral, close, over-the-shoulder), deslocamentos, parallax, entrada/saída de elementos, easing, transições e a duração de cada uma.
4. RITMO: duração de plano/corte, planos por minuto, o gancho dos primeiros segundos, como o vídeo termina.
5. TEXTO NA TELA: fonte, tamanho relativo, posição, caixa alta, legendas (palavra a palavra?), cartelas, números.
6. SOM: narração (tom, velocidade, pessoa), música (gênero/intensidade) e efeitos — o que entra e o que nunca entra.
7. MINÚCIAS E REGRAS DURAS: números exatos, listas de obrigatório/proibido, checklists de qualidade, padrões do plugin (STANDARDS/PLAN).
8. ETAPA POR ETAPA: traduza o que o plugin manda para as etapas do FilmForge (catálogo abaixo): roteiro, plano de cenas, cena por código, thumbnail, SEO. Diga o que a IA deve consultar do plugin em cada etapa.

## Etapas do FilmForge e o arquivo que cada uma grava
${Object.entries(STEP_CATALOG).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Como escrever
- A skill roda SEM usuário: instruções no imperativo, objetivas e verificáveis (nada de "considere").
- Preserve os números e as regras do plugin; não invente regras que ele não tem.
- Se o plugin tiver mais de um estilo/variante, escreva a skill para o estilo PRINCIPAL e liste as variantes no "Global", dizendo quando usar cada uma.
- Copie o MÉTODO e o ESTILO, nunca o conteúdo: nada de histórias, personagens nomeados, logos ou marcas dos exemplos.
- Onde o plugin cita arquivos de referência, diga em que etapa a IA deve abri-los (eles ficam disponíveis no projeto).
${o.routeId ? `- routeId OBRIGATÓRIO: ${o.routeId}.` : ''}${o.aspect ? `\n- aspect: ${o.aspect}.` : ''}${o.durationSec ? `\n- durationSec: ${o.durationSec}.` : ''}

${skillRules(s, lang)}

Responda gravando APENAS skill.md nesta pasta.`;
}

/** Gera a skill do estilo do plugin com a IA e salva já vinculada ao plugin. */
export async function generateSkillFromPlugin(s: Settings, input: PluginSkillInput, log: (l: string) => void, signal?: AbortSignal): Promise<PluginSkillResult> {
  let plugin: PluginInfo | undefined;
  if (input.pluginId?.trim()) {
    plugin = getPlugin(s, input.pluginId.trim());
    if (!plugin) throw new Error(`plugin "${input.pluginId}" não instalado`);
  } else if (input.url?.trim()) {
    plugin = await installPluginUrl(s, input.url.trim());
    log(`plugin "${plugin.name}" instalado do GitHub`);
  } else {
    const src = input.file?.trim() || input.folder?.trim();
    if (!src) throw new Error('escolha o plugin (.plugin/.zip/.skill), uma pasta ou um plugin já instalado');
    plugin = installPluginAny(s, src);
    log(`plugin "${plugin.name}" instalado`);
  }
  const { docs, text } = pluginDocs(s, plugin.id);
  if (text.length < 200) throw new Error(plugin.styles?.length
    ? 'plugin de estilos (galeria): escolha o estilo na galeria e use "Usar em novo projeto" — a skill dele já vem pronta'
    : 'o plugin tem pouco texto para analisar (nenhum SKILL.md, guia ou referência)');
  const lang = input.language || 'pt-BR';
  const workdir = path.join(s.workspace, 'skillgen', `plugin-${plugin.id}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, 'plugin.md'), text, 'utf8');
  const route = input.routeId ? getAnyRoute(s, input.routeId) : undefined;
  const scripts = (pluginInventory(s, plugin.id).scripts ?? []).map((f) => f.replace(/\\/g, '/'));
  const prompt = pluginSkillPrompt(s, plugin, { corpus: text, docs, scripts, language: lang, routeId: route?.id, aspect: input.aspect, durationSec: input.durationSec });
  const { id, cfg, model } = await resolveHarness(s, { type: 'harness', harness: input.harness, model: input.model });
  log(`lendo o estilo de "${plugin.displayName ?? plugin.name}" com ${id}${model ? '/' + model : ''} (${docs.length} arquivo(s))…`);
  const res = await runHarness(cfg, {
    cwd: workdir, prompt, model, signal: signal ?? new AbortController().signal, onLine: (l) => log(l.slice(0, 300)), timeoutSec: 1800,
    env: id === 'antigravity' ? activeAgyEnv(s) : undefined, tools: isHttpHarness(cfg) ? undefined : { roots: [workdir], allowShell: false },
  });
  const mdFile = path.join(workdir, 'skill.md');
  if (!fs.existsSync(mdFile) && res.stdout.includes('---')) fs.writeFileSync(mdFile, res.stdout.slice(res.stdout.indexOf('---')).replace(/\n```\s*$/, ''));
  if (!fs.existsSync(mdFile)) throw new Error(`${id} não gravou skill.md${res.ok ? '' : `: ${res.stderr.slice(-300)}`}`);
  const fin = finalizeSkillMd(s, read(mdFile), {
    name: input.name?.trim() || undefined, language: lang, fallbackId: slugify(plugin.id) || 'estilo-de-plugin',
    sourceNote: `Estilo do plugin ${plugin.displayName ?? plugin.name} (${docs.length} arquivo(s) lidos: ${docs.slice(0, 6).join(', ')}${docs.length > 6 ? '…' : ''})`,
  });
  /* a skill nasce LIGADA ao plugin: toda produção com ela usa as regras e as bibliotecas dele */
  const patch: Partial<Skill> = { plugins: [plugin.id] };
  if (input.aspect) patch.aspect = input.aspect;
  if (input.durationSec) patch.durationSec = input.durationSec;
  if (route && fin.skill.routeId !== route.id) patch.routeId = route.id;
  const skill = saveSkill(s, { ...fin.skill, ...patch });
  log(`skill "${skill.name}" criada${route ? ` (rota ${route.name})` : ` (rota ${fin.route.name})`} com o plugin ${plugin.id} marcado`);
  return { plugin, skill, routeName: route?.name ?? fin.route.name, warnings: fin.warnings, workdir, docs };
}
