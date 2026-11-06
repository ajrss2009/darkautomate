import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Binding, HarnessId, PluginAdaptation, Settings } from '../shared/types';
import { llmJson } from './editor';
import { detectKit } from './kit';
import { ADAPT_FILE, adaptItemFile, claudeItems, getPlugin, pluginRoot, pluginsRoot, readAdaptation } from './plugins';
import { STEP_HINTS } from './skill-import';

/*
 * Adapta um plugin do Claude ao FilmForge: em vez de mandar o plugin inteiro para TODAS as etapas,
 * cada skill/comando/agente/arquivo é ligado só às etapas em que serve, com a tradução do formato de
 * saída do plugin para o arquivo que a etapa grava e a lista do que não roda aqui (scripts, MCP, hooks).
 * Com IA (qualquer harness) ou por heurística (nomes dos arquivos), sem IA.
 */

/** Etapas do FilmForge e o arquivo que cada uma grava (a IA precisa disso para traduzir o formato). */
export const STEP_CATALOG: Record<string, string> = {
  brief: 'brief.md — brief do orquestrador (conceito, estrutura, bíblia visual, tom, diretrizes por etapa)',
  ideation: 'ideas.json — 10 ideias [{title, hook, angle}]',
  script: 'script.md — SÓ o texto falado (roteiro narrado), em blocos',
  scene_plan: 'scenes.json — lista de cenas [{title, narration, visualIntent, kind, durationSec, …}]',
  asset_design: 'assets.md — personagens, cenários e objetos recorrentes com descrição visual fixa',
  image: 'frame.png — imagem da cena (a etapa escreve o PROMPT de imagem)',
  video: 'clip.mp4 — vídeo da cena (a etapa escreve o PROMPT de vídeo)',
  code_scene: 'scene.html — cena animada por código (HTML determinístico com window.__forge.seek(t))',
  motion_graphics: 'scene.html — motion graphics por código (mesmo contrato)',
  narration: 'narration.mp3 — locução da cena (instruções de voz/tom)',
  music: 'music.mp3 — trilha',
  thumbnail: 'thumbnail.png — capa (a etapa escreve o PROMPT de imagem)',
  metadata: 'metadata.json — {title, titleOptions, description, tags, chapters, thumbnailText}',
  review: 'review.json — nota e problemas do vídeo final',
};
const KNOWN = new Set(Object.keys(STEP_CATALOG));

interface InvItem { id: string; kind: string; name: string; rel: string; description?: string; excerpt: string }
export interface PluginInventory { id: string; name: string; description?: string; items: InvItem[]; scripts: string[]; mcp: string[]; hooks: boolean }

const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const body = (md: string) => md.replace(/^---\s*[\s\S]*?\n---\s*\n/, '').trim();

/** Tudo o que o plugin tem: skills, comandos, agentes, arquivos .md de apoio, scripts, MCP e hooks. */
export function pluginInventory(s: Settings, id: string): PluginInventory {
  const p = getPlugin(s, id);
  if (!p) throw new Error(`plugin "${id}" não instalado`);
  const dir = path.join(pluginsRoot(s), id);
  const root = pluginRoot(dir);
  const rel = (f: string) => path.relative(root, f).split(path.sep).join('/');
  const items: InvItem[] = claudeItems(root).map((it) => ({ id: `${it.kind}:${it.name}`, kind: it.kind, name: it.name, rel: rel(it.file), description: it.description, excerpt: body(read(it.file)).slice(0, 700) }));
  const scripts: string[] = [];
  for (const it of claudeItems(root).filter((x) => x.kind === 'skill' && x.dir)) {
    for (const f of it.files ?? []) {
      const full = path.join(it.dir!, ...f.split('/'));
      if (/\.(md|markdown)$/i.test(f)) items.push({ id: `file:${rel(full)}`, kind: 'file', name: f, rel: rel(full), excerpt: body(read(full)).slice(0, 500) });
      else if (/\.(py|sh|ps1|js|mjs|ts|bat)$/i.test(f) && !/^lib\//i.test(f)) scripts.push(rel(full));
    }
  }
  return { id, name: p.displayName ?? p.name, description: p.description, items, scripts, mcp: p.mcp ?? [], hooks: !!p.hasHooks };
}

/** O que não roda no FilmForge (vale para as duas formas de adaptar). */
function ignoreList(inv: PluginInventory): string[] {
  return [
    inv.scripts.length ? `${inv.scripts.length} script(s) (${[...new Set(inv.scripts.map((f) => f.split('/').slice(0, -1).join('/') || f))].slice(0, 3).join(', ')}) — o FilmForge não executa scripts do plugin` : '',
    inv.mcp.length ? `servidores MCP (${inv.mcp.join(', ')})` : '',
    inv.hooks ? 'hooks do Claude Code' : '',
    'comandos de barra, agentes paralelos e perguntas ao usuário (a produção roda sozinha)',
  ].filter(Boolean);
}

/** Adaptação sem IA: liga cada item às etapas pelos nomes (script/hook → roteiro, thumbnail → capa, seo → metadados…). */
export function heuristicAdaptation(inv: PluginInventory): PluginAdaptation {
  const items: PluginAdaptation['items'] = [];
  for (const it of inv.items) {
    /* modelos e exemplos não são instruções de etapa (ex.: "review-channel.md" é um tipo de canal, não a revisão) */
    if (it.kind === 'file' && /(^|\/)(templates?|examples?|assets)\//i.test(it.rel)) continue;
    const key = `${it.name} ${it.rel}`;
    const steps = STEP_HINTS.filter((h) => h.re.test(path.basename(it.name, '.md')) || (it.kind !== 'file' && h.re.test(key))).map((h) => h.kind);
    if (steps.length) items.push({ id: it.id, steps: [...new Set(steps)] });
  }
  /* skill principal sem etapa reconhecida: vale para as etapas de texto (sem ela o plugin não entraria em nada) */
  for (const it of inv.items.filter((x) => x.kind === 'skill' && !items.some((y) => y.id === x.id))) {
    const hasSubs = inv.items.some((f) => f.kind === 'file' && f.rel.startsWith(path.posix.dirname(it.rel) + '/') && items.some((y) => y.id === f.id));
    items.push({ id: it.id, steps: hasSubs ? ['brief'] : ['ideation', 'script', 'scene_plan', 'metadata'], note: hasSubs ? 'visão geral; as sub-skills entram nas etapas certas' : undefined });
  }
  const steps = [...new Set(items.flatMap((x) => x.steps))];
  return { version: 1, createdAt: new Date().toISOString(), by: 'heurística (nomes dos arquivos)', summary: `${inv.name}: ${items.length} item(ns) ligados a ${steps.join(', ') || 'nenhuma etapa'}`,
    global: 'Rodando sem usuário: não faça perguntas; use os dados do projeto e siga.', items, ignore: ignoreList(inv) };
}

/** Valida a resposta da IA: só ids do inventário, só etapas que existem, textos com limite de tamanho. */
export function normalizeAdaptation(inv: PluginInventory, json: unknown, by: string): PluginAdaptation {
  const j = (json ?? {}) as Partial<PluginAdaptation> & { recommended?: PluginAdaptation['recommended'] | null };
  const ids = new Set(inv.items.map((x) => x.id));
  const items = (Array.isArray(j.items) ? j.items : []).filter((it) => it && ids.has(it.id))
    .map((it) => ({ id: it.id, steps: [...new Set((Array.isArray(it.steps) ? it.steps : []).filter((st) => KNOWN.has(st)))], note: typeof it.note === 'string' ? it.note.slice(0, 300) : undefined }))
    .filter((it) => it.steps.length);
  if (!items.length) throw new Error('a IA não ligou nenhum item a uma etapa (tente outra IA ou a adaptação sem IA)');
  const outputs = Object.fromEntries(Object.entries(j.outputs ?? {}).filter(([k, v]) => KNOWN.has(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).slice(0, 600)]));
  const rec = j.recommended && Array.isArray(j.recommended.kinds) && Array.isArray(j.recommended.bindings)
    ? { label: j.recommended.label, kinds: j.recommended.kinds.filter((k) => KNOWN.has(k)), bindings: (j.recommended.bindings as Binding[]).filter((b) => b?.type === 'harness') } : undefined;
  return { version: 1, createdAt: new Date().toISOString(), by, summary: String(j.summary ?? '').slice(0, 300) || `${inv.name} adaptado`,
    global: typeof j.global === 'string' ? j.global.slice(0, 400) : undefined, items, outputs: Object.keys(outputs).length ? outputs : undefined,
    ignore: [...new Set([...ignoreList(inv), ...(Array.isArray(j.ignore) ? j.ignore.map(String).slice(0, 8) : [])])],
    recommended: rec?.kinds.length && rec.bindings.length ? rec : undefined };
}

/** Adaptação com IA: lê o inventário do plugin e decide o que entra em cada etapa e como. */
export async function adaptPlugin(s: Settings, id: string, o: { harness?: HarnessId | 'auto' | ''; model?: string; log: (l: string) => void; signal?: AbortSignal }): Promise<PluginAdaptation> {
  const dir = path.join(pluginsRoot(s), id);
  const kit = detectKit(dir);
  if (kit) throw new Error('este plugin tem motor próprio (kit): o FilmForge já o adapta automaticamente');
  const p = getPlugin(s, id);
  if (p?.styles?.length) throw new Error('plugin de estilos: só o estilo escolhido entra no prompt, não precisa de adaptação');
  const inv = pluginInventory(s, id);
  if (!inv.items.length) throw new Error('o plugin não tem skills, comandos, agentes nem arquivos .md para adaptar');
  let a: PluginAdaptation;
  if (!o.harness) {
    a = heuristicAdaptation(inv);
  } else {
    let budget = 38000;
    const listing = inv.items.map((it) => {
      const txt = `- id: ${it.id}\n  arquivo: ${it.rel}${it.description ? `\n  descrição: ${it.description.slice(0, 200)}` : ''}\n  início: ${it.excerpt.replace(/\s+/g, ' ').slice(0, Math.min(500, Math.max(120, budget / inv.items.length)))}`;
      budget -= txt.length; return txt;
    }).join('\n');
    const prompt = `Você é o INTEGRADOR DE PLUGINS do FilmForge (estúdio que produz vídeos por etapas, sem usuário durante a execução).
Adapte o plugin do Claude "${inv.name}"${inv.description ? ` (${inv.description.slice(0, 300)})` : ''} ao FilmForge: decida em QUAIS etapas cada item entra e como.

## Etapas do FilmForge e o arquivo que cada uma grava
${Object.entries(STEP_CATALOG).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Inventário do plugin
${listing}
${inv.scripts.length ? `\nScripts (não são executados pelo FilmForge): ${inv.scripts.slice(0, 20).join(', ')}` : ''}${inv.mcp.length ? `\nServidores MCP (indisponíveis): ${inv.mcp.join(', ')}` : ''}${inv.hooks ? '\nHooks do Claude Code (não rodam)' : ''}

## Regras
- Ligue cada item SÓ às etapas em que ele realmente ajuda (ex.: guia de thumbnail → thumbnail; roteiro/gancho/retenção → script; SEO/títulos → metadata; ideias/estratégia → ideation; storyboard/planos → scene_plan). Item que não serve para vídeo (monetização, auditoria, analytics…) fica de fora.
- Em "outputs", para cada etapa que recebe o plugin, explique em 1–2 frases como transformar o que o plugin produz no arquivo da etapa (ex.: "o 'Upload Metadata Package' vira metadata.json: TITLE OPTIONS → titleOptions…").
- "global": regra curta (até 300 caracteres) que vale sempre que o plugin entrar (ex.: não fazer perguntas; ignorar comandos de barra).
- "ignore": o que o plugin pede e não existe aqui (scripts, MCP, buscas, agentes paralelos, perguntas ao usuário).
- "recommended": só se o plugin exigir claramente um tipo de modelo numa etapa; senão null.

Responda JSON: {"summary": "1 frase", "global": "...", "items": [{"id": "<id exato do inventário>", "steps": ["<etapa>", …], "note": "como usar nesta etapa (opcional, curto)"}], "outputs": {"<etapa>": "..."}, "ignore": ["..."], "recommended": null}`;
    const work = path.join(s.workspace, 'craft', `adapt-${id}-${Date.now()}`);
    o.log(`adaptando "${inv.name}" com ${o.harness}${o.model ? '/' + o.model : ''}…`);
    const { json, binding } = await llmJson([{ type: 'harness', harness: o.harness as HarnessId | 'auto', model: o.model || undefined }], s, work, prompt, o.signal ?? new AbortController().signal, o.log);
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignora */ }
    a = normalizeAdaptation(inv, json, binding);
  }
  /* só itens que existem de fato no plugin */
  a.items = a.items.filter((it) => adaptItemFile(dir, it.id));
  fs.writeFileSync(path.join(dir, ADAPT_FILE), JSON.stringify(a, null, 2));
  o.log(`adaptação gravada: ${a.items.length} item(ns) → ${[...new Set(a.items.flatMap((x) => x.steps))].join(', ')}`);
  return a;
}

/** Desfaz: o plugin volta a entrar inteiro em todas as etapas. */
export function removeAdaptation(s: Settings, id: string): boolean {
  const f = path.join(pluginsRoot(s), id, ADAPT_FILE);
  const had = !!readAdaptation(path.dirname(f));
  fs.rmSync(f, { force: true });
  return had;
}
