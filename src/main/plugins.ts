import { httpFetch } from './http';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Binding, PluginAdaptation, PluginInfo, Settings } from '../shared/types';
import { adoptLibrary, detectKit, previewFile, type KitInfo } from './kit';
import { adaptPromptsRepo, isPromptsRepo, readManifest, skipOnInstall } from './plugin-adapter';

/**
 * Plugins no formato do Claude Code: uma pasta com `.claude-plugin/plugin.json`
 * e, opcionalmente, skills/, commands/, agents/, hooks/hooks.json e .mcp.json.
 *
 * O FilmForge não executa o plugin: ele lê o conteúdo (instruções das skills,
 * comandos e agentes) e injeta no prompt enviado ao harness — funciona com
 * qualquer harness, mesmo os que não conhecem plugins.
 */

let appPlugins: string | undefined;
/** Pasta `plugins` ao lado do FilmForge.exe (portabilidade: copiar a pasta do app leva os plugins). Definida pelo main. */
export function setAppPluginsDir(dir: string | undefined): void { appPlugins = dir; }

export const pluginsRoot = (s: Settings): string =>
  s.pluginsDir?.trim() ? path.resolve(s.pluginsDir.trim()) : appPlugins ?? path.join(s.workspace, 'plugins');

/**
 * Plugins instalados na pasta antiga (Documentos/FilmForge/plugins) que ainda não estão na pasta do app:
 * copia (a antiga fica como cópia de segurança). Devolve os ids copiados.
 */
export function adoptPlugins(from: string, to: string): string[] {
  if (path.resolve(from) === path.resolve(to) || !fs.existsSync(from)) return [];
  fs.mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (!e.isDirectory() || fs.existsSync(path.join(to, e.name))) continue;
    fs.cpSync(path.join(from, e.name), path.join(to, e.name), { recursive: true });
    copied.push(e.name);
  }
  return copied;
}

const slugify = (name: string): string =>
  name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'plugin';

const SAFE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

function readJson(file: string): any | undefined {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

function manifestOf(dir: string): { file: string; data: any } | undefined {
  for (const rel of [path.join('.claude-plugin', 'plugin.json'), 'plugin.json', path.join('.claude-plugin', 'marketplace.json')]) {
    const f = path.join(dir, rel);
    const data = readJson(f);
    if (data) return { file: f, data };
  }
  return undefined;
}

const mdFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.(md|markdown)$/i.test(e.name)) out.push(full);
    }
  };
  walk(dir, 0);
  return out;
};


/** Um item do plugin na estrutura do Claude, com o arquivo principal e (skills) a pasta e os arquivos de apoio. */
export interface ClaudeItem { kind: 'skill' | 'command' | 'agent'; name: string; file: string; dir?: string; description?: string; files?: string[] }

/** Arquivos de apoio de uma skill (referências, templates, scripts, biblioteca), relativos à pasta dela. */
function supportFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4 || out.length > 200) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (/^(node_modules|\.git)$/.test(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name !== 'SKILL.md') out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir, 0);
  return out.sort();
}

/**
 * Skills, comandos e agentes como o Claude Code os enxerga:
 *  - skill  = skills/<nome>/SKILL.md (o resto da pasta são arquivos de apoio, lidos sob demanda);
 *  - comando = commands/**.md (subpastas viram namespace "pasta:comando");
 *  - agente = agents/*.md.
 */
export function claudeItems(root: string): ClaudeItem[] {
  const items: ClaudeItem[] = [];
  const sk = path.join(root, 'skills');
  if (fs.existsSync(sk)) for (const e of fs.readdirSync(sk, { withFileTypes: true })) {
    const full = path.join(sk, e.name);
    const file = e.isDirectory() ? path.join(full, 'SKILL.md') : /\.md$/i.test(e.name) ? full : '';
    if (!file || !fs.existsSync(file)) continue;
    const fm = frontMatter(file);
    items.push({ kind: 'skill', name: fm.name || e.name.replace(/\.md$/i, ''), file, dir: e.isDirectory() ? full : undefined, description: frontDescription(file), files: e.isDirectory() ? supportFiles(full) : [] });
  }
  const cmd = path.join(root, 'commands');
  for (const f of mdFiles(cmd)) items.push({ kind: 'command', name: path.relative(cmd, f).replace(/\.(md|markdown)$/i, '').split(path.sep).join(':'), file: f, description: frontDescription(f) });
  const ag = path.join(root, 'agents');
  if (fs.existsSync(ag)) for (const f of fs.readdirSync(ag).filter((x) => /\.md$/i.test(x))) items.push({ kind: 'agent', name: frontMatter(path.join(ag, f)).name || f.replace(/\.md$/i, ''), file: path.join(ag, f), description: frontDescription(path.join(ag, f)) });
  return items;
}

function frontMatter(file: string): Record<string, string> {
  try {
    const fm = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? '';
    return Object.fromEntries([...fm.matchAll(/^([\w-]+):\s*(.+)$/gm)].map((m) => [m[1]!, m[2]!.trim().replace(/^["']|["']$/g, '')]));
  } catch { return {}; }
}

/** Raiz do plugin (onde estão skills/, commands/, agents/). */
export function pluginRoot(dir: string): string {
  const man = manifestOf(dir);
  const base = man ? path.dirname(path.dirname(man.file)) : dir;
  return fs.existsSync(path.join(base, 'skills')) || fs.existsSync(path.join(base, 'commands')) || fs.existsSync(path.join(base, 'agents')) ? base : dir;
}

const IMG = /\.(png|jpe?g|gif|webp)$/i;

function describe(dir: string): PluginInfo {
  const man = manifestOf(dir);
  const data = man?.data ?? {};
  const root = pluginRoot(dir);
  let mcp: string[] = [];
  const mcpFile = readJson(path.join(root, '.mcp.json')) ?? readJson(path.join(dir, '.mcp.json'));
  if (mcpFile?.mcpServers && typeof mcpFile.mcpServers === 'object') mcp = Object.keys(mcpFile.mcpServers);
  const id = slugify(String(data.name ?? path.basename(dir)));
  const items = claudeItems(root);
  /* galeria e leia-me trazidos do repositório na instalação (pasta _gallery) */
  const gdir = path.join(dir, '_gallery');
  const gallery = fs.existsSync(gdir) ? fs.readdirSync(gdir).filter((f) => IMG.test(f)).sort().map((f) => path.join(gdir, f)) : [];
  const readme = [path.join(gdir, 'README.md'), path.join(dir, 'README.md')].find((f) => fs.existsSync(f));
  const examples = fs.existsSync(path.join(gdir, 'examples')) ? fs.readdirSync(path.join(gdir, 'examples'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  /* dependências de runtime declaradas pelas skills (package.json / requirements.txt) */
  const requires = items.flatMap((it) => {
    if (!it.dir) return [];
    const pkg = readJson(path.join(it.dir, 'package.json'));
    const deps = pkg?.dependencies ? Object.keys(pkg.dependencies).map((d) => `npm ${d}`) : [];
    const req = fs.existsSync(path.join(it.dir, 'requirements.txt')) ? ['python (requirements.txt)'] : [];
    return [...deps, ...req];
  });
  const extra = withManifest(dir, data.homepage ? String(data.homepage) : undefined);
  return {
    id,
    name: String(data.name ?? path.basename(dir)),
    displayName: data.displayName ? String(data.displayName) : undefined,
    description: data.description ? String(data.description) : undefined,
    version: data.version ? String(data.version) : undefined,
    author: data.author ? String(typeof data.author === 'object' ? data.author.name ?? '' : data.author) || undefined : undefined,
    license: data.license ? String(data.license) : undefined,
    keywords: Array.isArray(data.keywords) ? data.keywords.map(String).slice(0, 16) : undefined,
    dir,
    skills: items.filter((x) => x.kind === 'skill').map((x) => x.name),
    commands: items.filter((x) => x.kind === 'command').map((x) => x.name),
    agents: items.filter((x) => x.kind === 'agent').map((x) => x.name),
    mcp,
    hasHooks: fs.existsSync(path.join(root, 'hooks', 'hooks.json')),
    items: items.map((x, i) => ({ kind: x.kind, name: x.name, description: x.description, ...(x.files?.length ? { files: x.files } : {}), ...(x.kind === 'skill' && skillImage(x, gallery, i) ? { image: skillImage(x, gallery, i) } : {}) })),
    gallery: gallery.length ? gallery.slice(0, 24) : undefined,
    cover: extra.styles?.find((x) => x.cover)?.cover ?? gallery[0] ?? items.map((x, i) => (x.kind === 'skill' ? skillImage(x, gallery, i) : undefined)).find(Boolean) ?? generatedCover(dir, String(data.displayName ?? data.name ?? path.basename(dir))),
    readme: readme ? readmeExcerpt(readme) : undefined,
    examples: examples.length ? examples : undefined,
    requires: requires.length ? [...new Set(requires)] : undefined,
    ...extra,
    ...kitFields(dir),
    /* LLM indicada: a do manifesto vence; senão, a sugerida pela adaptação */
    ...(recommendedOf(data).recommended ? recommendedOf(data) : readAdaptation(dir)?.recommended?.bindings?.length ? { recommended: readAdaptation(dir)!.recommended } : {}),
    ...adaptationInfo(dir),
  };
}

/* ───────── adaptação ao FilmForge (filmforge-adapt.json) ───────── */

export const ADAPT_FILE = 'filmforge-adapt.json';

export function readAdaptation(dir: string): PluginAdaptation | undefined {
  const j = readJson(path.join(dir, ADAPT_FILE)) as PluginAdaptation | undefined;
  return j && Array.isArray(j.items) ? j : undefined;
}

/** Arquivo de um item da adaptação ("skill:x", "command:x", "agent:x", "file:caminho"), sempre dentro do plugin. */
export function adaptItemFile(dir: string, id: string): { file: string; label: string } | undefined {
  const root = pluginRoot(dir);
  const [kind, ...rest] = id.split(':');
  const name = rest.join(':');
  if (kind === 'file') {
    const f = path.resolve(root, name);
    return f.startsWith(path.resolve(root) + path.sep) && fs.existsSync(f) ? { file: f, label: `arquivo ${name}` } : undefined;
  }
  const it = claudeItems(root).find((x) => x.kind === kind && x.name === name);
  return it ? { file: it.file, label: `${kind === 'skill' ? 'skill' : kind === 'command' ? 'comando' : 'agente'} ${it.name}` } : undefined;
}

/** Resumo da adaptação para a interface: etapa → itens. */
function adaptationInfo(dir: string): Pick<PluginInfo, 'adaptation'> {
  const a = readAdaptation(dir);
  if (!a) return {};
  const steps: Record<string, string[]> = {};
  for (const it of a.items) for (const st of it.steps) (steps[st] ??= []).push(it.id.replace(/^file:/, ''));
  return { adaptation: { summary: a.summary, by: a.by, createdAt: a.createdAt, steps, ignore: a.ignore ?? [] } };
}

/** plugin.json → "filmforge": { "recommendedExecutor": { kinds: [...], bindings: [...] } } */
function recommendedOf(data: any): Pick<PluginInfo, 'recommended'> {
  const r = data?.filmforge?.recommendedExecutor;
  if (!r || !Array.isArray(r.kinds) || !Array.isArray(r.bindings)) return {};
  const bindings = (r.bindings as Binding[]).filter((b) => b && typeof b === 'object' && typeof b.type === 'string');
  return bindings.length ? { recommended: { label: typeof r.label === 'string' ? r.label : undefined, kinds: r.kinds.map(String), bindings } } : {};
}

/**
 * plugin.json → "filmforge": { "contract": { enforce, forbidCanvas, allow[], maxPromptChars, requireLib } }.
 * O CONTRATO DE ESTILO declarado pelo próprio plugin: o FilmForge aplica nas páginas que gera
 * (lint antes do render) e no orçamento de prompt (maxPromptChars vence sobre os caps automáticos).
 */
export interface PluginContractCfg {
  /** false = este plugin fica fora do contrato (nenhum lint de canvas e cap auto) */
  enforce?: boolean;
  /** a página gerada NÃO desenha à mão com primitivas cruas (beginPath/arc/lineTo…): usa os rigs do plugin */
  forbidCanvas?: boolean;
  /** exceções declaradas pelo plugin: linhas que contêm estes substrings ficam liberadas */
  allow?: string[];
  /** cap do bloco do plugin no prompt em caracteres (vence sobre os caps automáticos e o do modelo) */
  maxPromptChars?: number;
  /** a página PRECISA referenciar a biblioteca do plugin (chamadas L.*) */
  requireLib?: boolean;
}

function contractCfgOf(dir: string): PluginContractCfg | undefined {
  const c = manifestOf(dir)?.data?.filmforge?.contract;
  if (!c || typeof c !== 'object') return undefined;
  return {
    enforce: c.enforce !== false,
    forbidCanvas: !!c.forbidCanvas,
    allow: Array.isArray(c.allow) ? c.allow.map(String) : [],
    maxPromptChars: Number.isFinite(c.maxPromptChars) ? Math.max(3000, Number(c.maxPromptChars)) : undefined,
    requireLib: !!c.requireLib,
  };
}

/** Contrato efetivo do plugin: o que a config declara + o que a biblioteca dele revela (rigs → forbidCanvas). Todo disco. */
export interface PluginContract {
  lib: boolean;
  rigs: string[];
  /** nomes exportados pela biblioteca do plugin: só estes podem ser chamados como L.<nome> */
  names: string[];
  /** caminho absoluto do _all.mjs da lib (para o prompt de correção dar o import certo) */
  libFile?: string;
  forbidCanvas: boolean;
  allow: string[];
  maxPromptChars?: number;
  enforce: boolean;
  plugin?: string;
}

export function pluginContract(s: Settings, ids: string[] | undefined, projectDir?: string): PluginContract {
  for (const id of ids ?? []) {
    const p = getPlugin(s, id);
    if (!p) continue;
    const cfg = contractCfgOf(p.dir);
    if (cfg?.enforce === false) continue;
    let lib = false;
    const rigs: string[] = [];
    const names: string[] = [];
    let libFile: string | undefined;
    for (const it of claudeItems(pluginRoot(p.dir))) {
      if (it.kind !== 'skill' || !it.dir) continue;
      const libs = (it.files ?? []).filter((f) => /^lib\/.+\.(?:m|)js$/i.test(f) && !/film\.m?js$|_all\.m?js$/i.test(f));
      if (!libs.length) continue;
      lib = true;
      const all = (it.files ?? []).find((f) => /^lib\/_all\.m?js$/i.test(f));
      if (all && !libFile) libFile = path.join(it.dir, ...all.split('/'));
      /* o _all.mjs normalmente só existe no STAGING do projeto (plugins/<id>/<skill>/lib/_all.mjs):
         é dele que a cena deve importar, então é esse caminho que o prompt de correção mostra */
      if (!libFile && projectDir) {
        const staged = path.join(projectDir, 'plugins', id, slugify(it.name), 'lib', '_all.mjs');
        if (fs.existsSync(staged)) libFile = staged;
      }
      for (const r of libs) {
        const src = readText(path.join(it.dir!, ...r.split('/')));
        /* todos os nomes exportados pela lib: a página só pode chamar L.<nome> que exista de verdade */
        for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) if (!names.includes(m[1]!)) names.push(m[1]!);
        for (const m of src.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g)) if (!names.includes(m[1]!)) names.push(m[1]!);
        for (const m of src.matchAll(/export\s*\{([^}]+)\}/g))
          for (const part of m[1]!.split(',')) {
            const n = part.trim().split(/\s+as\s+/).pop()?.trim();
            if (n && !names.includes(n)) names.push(n);
          }
        if (!/\/rigs\//.test(r)) continue;
        const fns = [...src.matchAll(/^export\s+function\s+(\w+)\s*\(\s*(?:ctx|g|c)\s*,\s*x\b/gm)].map((f) => f[1]!);
        const main = path.basename(r, path.extname(r));               // ant.mjs → ant (antGuides é auxiliar)
        for (const n of (fns.includes(main) ? [main] : fns)) if (!rigs.includes(n)) rigs.push(n);
      }
    }
    if (lib) return {
      lib, rigs, names, libFile,
      /* heurística: rig pronto → a página não redesenha o personagem à mão (a config do plugin vence) */
      forbidCanvas: cfg?.forbidCanvas ?? rigs.length > 0,
      allow: cfg?.allow ?? [],
      maxPromptChars: cfg?.maxPromptChars,
      enforce: true,                                       // enforce === false já saiu no filtro acima
      plugin: id,
    };
  }
  return { lib: false, rigs: [], names: [], forbidCanvas: false, allow: [], enforce: true };
}

/** LLMs indicadas pelos plugins do projeto, por tipo de etapa (o primeiro plugin que indicar vence). */
export function pluginRecommendations(s: Settings, ids: string[] | undefined): Map<string, Binding[]> {
  const out = new Map<string, Binding[]>();
  for (const id of ids ?? []) {
    const rec = getPlugin(s, id)?.recommended;
    if (!rec) continue;
    for (const k of rec.kinds) if (!out.has(k)) out.set(k, rec.bindings);
  }
  return out;
}

/**
 * Plugins que vêm com o app (resources/plugins-bundled): instalados na pasta de plugins do
 * usuário uma única vez. Se o usuário remover, não voltam; edições dele nunca são sobrescritas.
 */
export function seedBundledPlugins(s: Settings, bundledDir: string): string[] {
  if (!fs.existsSync(bundledDir)) return [];
  const done = new Set(s.seededPlugins ?? []);
  const root = pluginsRoot(s);
  /* Perfil PORTÁTIL adotado em outro workspace: o marcador seededPlugins viaja junto, mas a pasta de
     plugins não — nesse caso (pasta ausente ou sem nenhum plugin) os embutidos voltam. Se a pasta já tem
     plugins, um plugin apagado pelo usuário NÃO volta. */
  let fresh = false;
  try {
    fresh = !fs.existsSync(root) || fs.readdirSync(root, { withFileTypes: true }).every((e) => !e.isDirectory() || !SAFE.test(e.name));
  } catch { fresh = false; }
  const added: string[] = [];
  for (const e of fs.readdirSync(bundledDir, { withFileTypes: true })) {
    if (!e.isDirectory() || !SAFE.test(e.name)) continue;
    if (done.has(e.name) && !fresh) continue;
    const dest = path.join(root, e.name);
    try {
      if (!fs.existsSync(dest)) { fs.mkdirSync(root, { recursive: true }); fs.cpSync(path.join(bundledDir, e.name), dest, { recursive: true }); }
      done.add(e.name); added.push(e.name);
    } catch { /* tenta de novo na próxima abertura */ }
  }
  s.seededPlugins = [...done];
  return added;
}

/** Kit com motor próprio (aiTrends 2D, Animate…) e a prévia renderizada por ele. */
function kitFields(dir: string): Pick<PluginInfo, 'kit' | 'preview' | 'styles'> {
  const k = detectKit(dir);
  if (!k) return {};
  const pv = previewFile(dir);
  /* biblioteca de estilos (pages): cada estilo vira um cartão com o quadro-chave na galeria do Novo projeto */
  const styles = k.kind === 'pages' && k.styleInfo?.length
    ? k.styleInfo.map((st) => ({ id: st.id, name: st.name, film: st.film, summary: [st.category, st.summary].filter(Boolean).join(' — ') || undefined, skill: path.basename(k.skillDir), cover: st.cover,
      video: fs.existsSync(path.join(dir, '_gallery', `preview-${st.id}.mp4`)) ? path.join(dir, '_gallery', `preview-${st.id}.mp4`) : undefined }))
    : undefined;
  return { kit: { kind: k.kind, styles: k.styles, examples: k.examples.length, needsLibrary: k.kind === 'pages' && !k.library ? true : undefined, repo: k.repo },
    preview: fs.existsSync(pv) ? pv : undefined, ...(styles ? { styles } : {}) };
}

/**
 * Imagem de uma skill: uma imagem da própria pasta (assets/, docs/, examples/, raiz), senão a imagem da galeria
 * cujo nome lembra a skill, senão uma imagem da galeria por ordem (cada skill fica com uma diferente).
 */
function skillImage(it: ClaudeItem, gallery: string[], index: number): string | undefined {
  if (it.dir) {
    const own = (it.files ?? []).filter((f) => IMG.test(f) && !/badge|icon/i.test(f)).sort((a, b) => a.split('/').length - b.split('/').length)[0];
    if (own) return path.join(it.dir, ...own.split('/'));
  }
  const key = it.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const byName = gallery.find((g) => { const b = path.basename(g).toLowerCase().replace(/[^a-z0-9]+/g, ''); return key.length > 2 && (b.includes(key) || key.includes(b.replace(/(png|jpe?g|gif|webp)$/, ''))); });
  return byName ?? (gallery.length ? gallery[index % gallery.length] : undefined);
}

/** Plugin sem nenhuma imagem: capa SVG gerada (iniciais + cor estável), gravada em _gallery/cover.svg. */
function generatedCover(dir: string, name: string): string | undefined {
  try {
    const file = path.join(dir, '_gallery', 'cover.svg');
    if (!fs.existsSync(file)) {
      let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const hue = h % 360, ini = name.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'P';
      const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},70%,25%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="520" cy="80" r="120" fill="rgba(255,255,255,.08)"/><text x="40" y="200" font-family="Segoe UI,Arial" font-size="120" font-weight="700" fill="#fff">${esc(ini)}</text><text x="44" y="290" font-family="Segoe UI,Arial" font-size="34" fill="rgba(255,255,255,.85)">${esc(name.slice(0, 32))}</text></svg>`);
    }
    return file;
  } catch { return undefined; }
}

/** Primeiros parágrafos do README (sem imagens, badges e blocos de código), para a interface. */
function readmeExcerpt(file: string): string {
  const md = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  return md.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter((p) => p && !/^#/.test(p) && p.length > 40).slice(0, 3).join('\n\n').slice(0, 1200);
}

/** description: do front-matter YAML (ou a primeira linha de texto). */
function frontDescription(file: string): string | undefined {
  try {
    const md = fs.readFileSync(file, 'utf8');
    const fm = /^---\s*\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
    const d = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim().replace(/^["']|["']$/g, '');
    return (d || md.replace(/^---[\s\S]*?\n---/, '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l.length > 10))?.slice(0, 220);
  } catch { return undefined; }
}

/** Estilos e recursos declarados no filmforge.json (capas e vídeos com caminho absoluto). */
function withManifest(dir: string, homepage?: string): Partial<PluginInfo> {
  const m = readManifest(dir);
  if (!m) return homepage ? { homepage } : {};
  const abs = (r?: string) => (r && fs.existsSync(path.join(dir, r)) ? path.join(dir, r) : undefined);
  return {
    adapted: true, homepage: m.homepage ?? homepage,
    styles: m.styles.map((st) => ({ ...st, cover: abs(st.cover), video: abs(st.video) })),
    resources: m.resources.map((r) => ({ ...r, path: path.join(dir, r.path), ready: fs.existsSync(path.join(dir, r.path)) })),
  };
}

export function listPlugins(s: Settings): PluginInfo[] {
  const dir = pluginsRoot(s);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => {
    try {
      const info = describe(path.join(dir, e.name));
      info.id = e.name;                          // id = nome da pasta (estável)
      info.installedAt = fs.statSync(path.join(dir, e.name)).mtime.toISOString();
      return [info];
    } catch { return []; }
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function getPlugin(s: Settings, id: string): PluginInfo | undefined {
  if (!SAFE.test(id)) return undefined;
  const dir = path.join(pluginsRoot(s), id);
  return fs.existsSync(dir) ? describe(dir) : undefined;
}

/** Valida que a pasta é um plugin (manifesto do Claude ou ao menos skills/comandos/agentes). */
function isPluginDir(dir: string): boolean {
  if (manifestOf(dir) || isPromptsRepo(dir)) return true;
  return ['.claude-plugin', 'skills', 'commands', 'agents', 'hooks'].some((d) => fs.existsSync(path.join(dir, d)));
}

function copyInto(s: Settings, src: string, id: string): PluginInfo {
  const dest = path.join(pluginsRoot(s), id);
  /* já instalado: atualiza por cima (arquivos novos/alterados; nada é apagado) */
  fs.mkdirSync(pluginsRoot(s), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true, filter: (f) => !skipOnInstall(path.relative(src, f)) });
  const info = describe(dest);
  info.id = id;
  info.installedAt = new Date().toISOString();
  return info;
}

/** Instala a partir de uma pasta local (o usuário escolhe a pasta do plugin). */
export function installPluginFolder(s: Settings, src: string, source?: string): PluginInfo {
  const dir = path.resolve(src);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('pasta não encontrada');
  // se o usuário escolheu a pasta que contém o plugin, desce um nível
  const target = isPluginDir(dir) ? dir : fs.readdirSync(dir, { withFileTypes: true }).map((e) => path.join(dir, e.name)).find((d) => fs.statSync(d).isDirectory() && isPluginDir(d));
  if (!target) throw new Error('não parece um plugin do Claude (esperado .claude-plugin/plugin.json, skills/, commands/ ou agents/)');
  if (!manifestOf(target) && isPromptsRepo(target)) adaptPromptsRepo(target, { name: path.basename(target) });
  const info = describe(target);
  const id = slugify(info.name);
  const saved = copyInto(s, target, id);
  saved.source = source ?? dir;
  return saved;
}

function run(cmd: string, args: string[]): { ok: boolean; error?: string } {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120_000, windowsHide: true });
    return r.status === 0 ? { ok: true } : { ok: false, error: `${cmd}: ${(r.stderr || r.stdout || '').slice(0, 300)}` };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Aceita https://github.com/dono/repo, git@…, dono/repo e links com /tree/branch. */
export function parseGithubUrl(raw: string): { owner: string; repo: string; branch?: string; subpath?: string } | undefined {
  const s = raw.trim().replace(/\.git$/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  const m = s.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i) ?? s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return undefined;
  const t = s.match(/\/(?:tree|blob)\/([^/\s#?]+)(?:\/(.+))?$/);
  const subpath = t?.[2]?.split('/').filter((x) => x && x !== '..' && x !== '.').join('/');
  return { owner: m[1]!, repo: m[2]!, branch: t?.[1], subpath: subpath || undefined };
}

const sysTar = () => { const t = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'; return fs.existsSync(t) ? t : 'tar'; };

/** Extrai um zip/.plugin para uma pasta (tar do sistema; no Windows, Expand-Archive como reserva). */
export function extractZip(zip: string, out: string) {
  fs.mkdirSync(out, { recursive: true });
  let r = run(sysTar(), ['-xf', zip, '-C', out]);
  if (!r.ok && process.platform === 'win32') {
    const asZip = zip.toLowerCase().endsWith('.zip') ? zip : path.join(path.dirname(out), 'pkg.zip');
    if (asZip !== zip) fs.copyFileSync(zip, asZip);
    r = run('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${asZip.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`]);
  }
  if (!r.ok) throw new Error(r.error ?? 'não foi possível extrair o arquivo');
}

/**
 * Arquivo .plugin no formato do Claude: um zip com a pasta do plugin na raiz (.claude-plugin/plugin.json,
 * skills/, commands/, agents/, hooks/, .mcp.json…). A galeria que o FilmForge monta (_gallery) fica de fora.
 */
export function exportPluginFile(s: Settings, id: string, outFile: string): string {
  const dir = path.join(pluginsRoot(s), id);
  if (!fs.existsSync(dir)) throw new Error(`plugin "${id}" não instalado`);
  const entries = fs.readdirSync(dir).filter((e) => e !== '_gallery' && e !== 'node_modules' && e !== '.git');
  if (!entries.includes('.claude-plugin')) throw new Error('o plugin não tem .claude-plugin/plugin.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.rmSync(outFile, { force: true });
  let r = run(sysTar(), ['--format', 'zip', '-cf', outFile, '-C', dir, ...entries]);
  if (!r.ok && process.platform === 'win32') {
    const tmpZip = outFile.replace(/\.plugin$/i, '') + '.tmp.zip';
    r = run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path ${entries.map((e) => `'${path.join(dir, e).replace(/'/g, "''")}'`).join(',')} -DestinationPath '${tmpZip.replace(/'/g, "''")}' -Force`]);
    if (r.ok) fs.renameSync(tmpZip, outFile);
  }
  if (!r.ok || !fs.existsSync(outFile)) throw new Error(r.error ?? 'não foi possível gravar o .plugin');
  return outFile;
}

/**
 * Pacote PORTÁTIL de plugins (.ffplugins = zip): todos os plugins instalados + as dependências deles (_deps), com as
 * adaptações e estilos. Importado em outro computador, os plugins funcionam sem baixar nada (mesmo Windows x64).
 */
export function exportPluginsPack(s: Settings, outFile: string): { file: string; plugins: string[] } {
  const root = pluginsRoot(s);
  if (!fs.existsSync(root)) throw new Error('nenhum plugin instalado');
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && (SAFE.test(e.name) || e.name === '_deps')).map((e) => e.name);
  const plugins = entries.filter((e) => e !== '_deps');
  if (!plugins.length) throw new Error('nenhum plugin instalado');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.rmSync(outFile, { force: true });
  let r = run(sysTar(), ['--format', 'zip', '--exclude', '.git', '-cf', outFile, '-C', root, ...entries]);
  if (!r.ok && process.platform === 'win32') {
    const tmpZip = outFile.replace(/\.ffplugins$/i, '') + '.tmp.zip';
    r = run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path ${entries.map((e) => `'${path.join(root, e).replace(/'/g, "''")}'`).join(',')} -DestinationPath '${tmpZip.replace(/'/g, "''")}' -Force`]);
    if (r.ok) fs.renameSync(tmpZip, outFile);
  }
  if (!r.ok || !fs.existsSync(outFile)) throw new Error(r.error ?? 'não foi possível gravar o pacote de plugins');
  return { file: outFile, plugins };
}

/** Importa um pacote .ffplugins: cada plugin (e as dependências) entra na pasta de plugins, substituindo o de mesmo nome. */
export function importPluginsPack(s: Settings, file: string): string[] {
  if (!fs.existsSync(file)) throw new Error('arquivo não encontrado');
  const root = pluginsRoot(s);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-plugins-pack-'));
  try {
    extractZip(file, tmp);
    const dirs = fs.readdirSync(tmp, { withFileTypes: true }).filter((e) => e.isDirectory() && (SAFE.test(e.name) || e.name === '_deps')).map((e) => e.name);
    const plugins = dirs.filter((d) => d !== '_deps' && manifestOf(path.join(tmp, d)));
    if (!plugins.length) throw new Error('o arquivo não tem plugins (esperado: um .ffplugins exportado pelo app)');
    fs.mkdirSync(root, { recursive: true });
    for (const d of [...plugins, ...(dirs.includes('_deps') ? ['_deps'] : [])]) {
      const dst = path.join(root, d);
      if (d !== '_deps') fs.rmSync(dst, { recursive: true, force: true });
      fs.cpSync(path.join(tmp, d), dst, { recursive: true, force: true });
    }
    return plugins;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** Instala um arquivo .plugin (ou .zip) do Claude. */
export function installPluginFile(s: Settings, file: string): PluginInfo {
  if (!fs.existsSync(file)) throw new Error('arquivo não encontrado');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-plugin-file-'));
  try {
    const out = path.join(tmp, 'src');
    extractZip(file, out);
    return installPluginFolder(s, out, file);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** Baixa e extrai um zip (usa o tar do sistema, que no Windows 10+ abre zip). */
async function downloadZip(url: string, destDir: string, signal?: AbortSignal): Promise<string> {
  /* repositórios de recursos podem ter centenas de MB: grava em disco por streaming */
  const r = await fetch(url, { signal: signal ?? AbortSignal.timeout(1_800_000), redirect: 'follow', headers: { 'User-Agent': 'FilmForge/0.1' } });
  if (!r.ok || !r.body) throw new Error(`download falhou (HTTP ${r.status}) — o repositório existe?`);
  fs.mkdirSync(destDir, { recursive: true });
  const zip = path.join(destDir, 'plugin.zip');
  await pipeline(Readable.fromWeb(r.body as import('node:stream/web').ReadableStream), fs.createWriteStream(zip));
  if (fs.statSync(zip).size < 100) throw new Error('zip vazio');
  const out = path.join(destDir, 'src');
  fs.mkdirSync(out, { recursive: true });
  /* no Windows, o tar do sistema (bsdtar) abre zip; o do Git Bash não */
  const sysTar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  let r2 = run(fs.existsSync(sysTar) ? sysTar : 'tar', ['-xf', zip, '-C', out]);
  if (!r2.ok && process.platform === 'win32') r2 = run('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`]);
  if (!r2.ok) throw new Error(r2.error ?? 'não foi possível extrair o zip');
  return out;
}

/**
 * Galeria do plugin (_gallery/): imagens de docs/ (ou da raiz/ do próprio plugin), o README do repositório
 * e a pasta examples/ (código pequeno) — mostrados na aba Plugins para o usuário entender o que o plugin faz.
 */
function collectGallery(repoRoot: string, pluginDir: string) {
  const g = path.join(pluginDir, '_gallery');
  const imgs: string[] = [];
  for (const d of [path.join(repoRoot, 'docs'), path.join(repoRoot, 'assets'), path.join(repoRoot, 'images'), path.join(pluginDir, 'docs'), repoRoot]) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (IMG.test(f) && !/badge|logo-small|icon/i.test(f) && fs.statSync(path.join(d, f)).size < 6_000_000) imgs.push(path.join(d, f));
  }
  const readme = [path.join(pluginDir, 'README.md'), path.join(repoRoot, 'README.md')].find((f) => fs.existsSync(f));
  const examples = path.join(repoRoot, 'examples');
  if (!imgs.length && !readme && !fs.existsSync(examples)) return;
  fs.mkdirSync(g, { recursive: true });
  for (const f of [...new Set(imgs)].slice(0, 24)) fs.copyFileSync(f, path.join(g, path.basename(f)));
  if (readme) fs.copyFileSync(readme, path.join(g, 'README.md'));
  if (fs.existsSync(examples) && pluginDir !== repoRoot) fs.cpSync(examples, path.join(g, 'examples'), { recursive: true, filter: (f) => !/[\\/](node_modules|out|\.git)([\\/]|$)/.test(f) && (fs.statSync(f).isDirectory() || fs.statSync(f).size < 2_000_000) });
}

/** Site publicado do repositório (README ou GitHub Pages padrão), usado para baixar os vídeos de exemplo sob demanda. */
function githubPages(dir: string, gh: { owner: string; repo: string }): string {
  const readme = (() => { try { return fs.readFileSync(path.join(dir, 'README.md'), 'utf8'); } catch { return ''; } })();
  const m = new RegExp(`https://${gh.owner}\\.github\\.io/${gh.repo}/?`, 'i').exec(readme);
  return (m?.[0] ?? `https://${gh.owner.toLowerCase()}.github.io/${gh.repo}/`).replace(/\/?$/, '/');
}

/** Instala a partir de uma URL do GitHub (zip do branch main/master, ou o informado). */
export async function installPluginUrl(s: Settings, url: string): Promise<PluginInfo & { also?: string[] }> {
  const gh = parseGithubUrl(url);
  if (!gh) throw new Error('informe uma URL do GitHub (https://github.com/dono/repo) ou dono/repo');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-plugin-'));
  try {
    const branches = gh.branch ? [gh.branch] : ['main', 'master'];
    let src: string | undefined; let lastErr: string | undefined;
    for (const br of branches) {
      try { src = await downloadZip(`https://codeload.github.com/${gh.owner}/${gh.repo}/zip/refs/heads/${br}`, path.join(tmp, br)); break; }
      catch (e) { lastErr = (e as Error).message; }
    }
    if (!src) throw new Error(lastErr ?? 'download falhou');
    /* raiz extraída (repo-branch/); com /tree/<branch>/<pasta>, só aquela pasta */
    const top = fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(src, e.name));
    const base = gh.subpath && top[0] ? path.join(top[0], ...gh.subpath.split('/')) : undefined;
    if (base && !fs.existsSync(base)) throw new Error(`a pasta "${gh.subpath}" não existe no repositório`);
    /* procura plugins até 3 níveis (repositórios "marketplace" têm plugins/<nome>/.claude-plugin) */
    const dirs: string[] = [];
    const walk = (d: string, depth: number) => {
      dirs.push(d);
      if (depth >= 3) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !/^(node_modules|\.git)$/.test(e.name) && e.name !== '.claude-plugin') walk(path.join(d, e.name), depth + 1);
    };
    for (const d of base ? [base] : top) walk(d, 0);
    /* marketplace do Claude (.claude-plugin/marketplace.json): a lista OFICIAL de plugins do repositório */
    const repoRoot = top[0];
    const market = !base && repoRoot ? readJson(path.join(repoRoot, '.claude-plugin', 'marketplace.json')) : undefined;
    const fromMarket = Array.isArray(market?.plugins)
      ? (market.plugins as Array<{ source?: unknown }>).map((x) => (typeof x.source === 'string' ? path.resolve(repoRoot!, x.source) : '')).filter((d) => d && d.startsWith(repoRoot!) && fs.existsSync(d) && isPluginDir(d))
      : [];
    const withManifest = dirs.filter((d) => manifestOf(d) && !fs.existsSync(path.join(d, '.claude-plugin', 'marketplace.json')) || fs.existsSync(path.join(d, '.claude-plugin', 'plugin.json')));
    const plugins = fromMarket.length ? fromMarket : [...new Set(withManifest)].filter((d, _i, all) => !all.some((o) => o !== d && d.startsWith(o + path.sep)));
    /* imagens de exemplo, README e exemplos do repositório vão junto (galeria visual do plugin) */
    if (repoRoot) for (const d of plugins) collectGallery(repoRoot, d);
    if (plugins.length > 1) {
      /* vários plugins no mesmo repositório: instala todos */
      const saved = plugins.map((d) => { const info = describe(d); const p = copyInto(s, d, slugify(info.name)); p.source = url; return p; });
      return { ...saved[0]!, also: saved.slice(1).map((p) => p.name) };
    }
    const found = plugins[0] ?? (base && isPluginDir(base) ? base : undefined) ?? dirs.find((d) => isPluginDir(d));
    if (!found) throw new Error('o repositório não contém um plugin do Claude (.claude-plugin/plugin.json) nem uma coleção de prompts de estilo (prompts/*.md)');
    /* coleção de prompts: converte para o formato Claude (uma skill por estilo) */
    if (!manifestOf(found) && isPromptsRepo(found)) adaptPromptsRepo(found, { name: gh.repo, homepage: githubPages(found, gh) });
    const info = describe(found);
    const id = slugify(info.name);
    const saved = copyInto(s, found, id);
    saved.source = url;
    /* biblioteca que o SKILL.md clonaria (ex.: Lemo-Opuscar): já está no zip — guarda em _library sem novo download */
    const k = detectKit(saved.dir);
    if (repoRoot && k?.kind === 'pages' && !k.library && adoptLibrary(repoRoot, saved.dir)) { const fresh = describe(saved.dir); fresh.id = id; fresh.source = url; fresh.installedAt = saved.installedAt; return fresh; }
    return saved;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignora */ }
  }
}

export function removePlugin(s: Settings, id: string): void {
  if (!SAFE.test(id)) throw new Error('id inválido');
  const dir = path.join(pluginsRoot(s), id);
  if (!fs.existsSync(dir)) throw new Error('plugin não encontrado');
  fs.rmSync(dir, { recursive: true, force: true });
}

const readText = (f: string): string => {
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
};

/** Remove o front-matter YAML (name/description) e devolve o corpo. */
const bodyOf = (md: string): string => md.replace(/^---\s*[\s\S]*?\n---\s*\n/, '').trim();

const CAP_FILE = 3500;
const CAP_TOTAL = 14000;

/**
 * Bloco de prompt dos plugins escolhidos. Além do "use [plugin]" (como no Claude),
 * injeta as instruções do próprio plugin — o harness não tem o plugin instalado,
 * então o texto é o que realmente muda a saída.
 */
/** Adaptador do @napi-rs/canvas para o navegador: bibliotecas de desenho feitas para Node rodam na cena HTML. */
const CANVAS_SHIM = [
  '// Gerado pelo FilmForge: @napi-rs/canvas → canvas do navegador (cenas HTML).',
  'export function createCanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }',
  'export const Path2D = globalThis.Path2D;',
  'export const DOMMatrix = globalThis.DOMMatrix;',
  'export const ImageData = globalThis.ImageData;',
  'export const Image = globalThis.Image;',
  'export async function loadImage(src) { const i = new Image(); i.src = typeof src === "string" ? src : URL.createObjectURL(new Blob([src])); await i.decode(); return i; }',
  'export const GlobalFonts = { registerFromPath() { return true; }, register() { return true; }, families: [] };',
  'export default { createCanvas, Path2D, DOMMatrix, ImageData, Image, loadImage, GlobalFonts };',
].join('\n');

/**
 * Fim do lib/_all.mjs (depois de `const all = {...}` com todos os módulos): o default é a biblioteca protegida.
 * Modelos locais erram muito a API (vistos: L.pencil e L.pen, que são de Pen; L.sin; L.soil(W, H, "day");
 * new L.Pen() sem o canvas, que derrubava a página na carga). Cada erro vira aviso e só aquela chamada some:
 * - função que lança: devolve o canvas ao estado anterior e retorna um "nada" que aceita qualquer uso;
 * - classe: construtor sem o canvas recebe o canvas da página; métodos da instância também protegidos;
 * - nome que não existe: Math.<nome> se houver (L.sin), senão o "nada".
 */
const SAFE_LIB = `const warned = new Set();
const warn = (k, m) => { if (!warned.has(k)) { warned.add(k); console.warn("L." + k + ": " + m); } };
let nop;
nop = new Proxy(function () {}, {
  get(o, k) { if (k === Symbol.toPrimitive) return () => 0; if (k === Symbol.iterator) return function* () {}; if (k === "then") return undefined; if (k === "length") return 0; return nop; },
  set() { return true; }, apply() { return nop; }, construct() { return nop; },
});
const isCtx = (c) => c && typeof c.save === "function" && typeof c.restore === "function";
const guard = (k, f, self, proxied) => function (...a) {
  const c = isCtx(a[0]) ? a[0] : isCtx(self && self.ctx) ? self.ctx : null; if (c) c.save();
  try { const r = f.apply(self ?? this, a); if (c) c.restore(); return self && r === self ? proxied : r; }
  catch (e) { if (c) c.restore(); warn(k, "chamada ignorada (" + e + ")"); return nop; }
};
const pageCtx = () => { const cv = document.querySelector("canvas"); return cv ? cv.getContext("2d") : undefined; };
const wrapObj = (k, o) => { const px = new Proxy(o, { get(t, p) {
  const v = t[p];
  if (typeof v === "function" && p !== "constructor") return guard(k + "." + String(p), v, t, px);
  /* método inventado na instância (visto: pen.fill): vira "nada" em vez de "is not a function" */
  if (v === undefined && typeof p === "string" && p !== "then" && !(p in t)) { warn(k + "." + p, "não existe — ignorado"); return nop; }
  return v;
} }); return px; };
const safe = {};
for (const [k, f] of Object.entries(all)) {
  if (typeof f !== "function") { safe[k] = f; continue; }
  if (/^class\\b/.test(Function.prototype.toString.call(f))) {
    const wantsCtx = /constructor\\s*\\(\\s*ctx\\b/.test(Function.prototype.toString.call(f));
    safe[k] = new Proxy(f, { construct(t, a) {
      if (wantsCtx && !isCtx(a[0])) a = [pageCtx(), ...a];
      try { return wrapObj(k, Reflect.construct(t, a)); } catch (e) { warn(k, "new ignorado (" + e + ")"); return nop; }
    } });
    continue;
  }
  safe[k] = guard(k, f);
}
export default new Proxy(safe, { get(o, k) {
  if (k in o || typeof k !== "string" || k === "then") return o[k];
  if (typeof Math[k] === "function") return Math[k];
  const near = Object.keys(o).find((n) => n.toLowerCase() === k.toLowerCase());
  warn(k, near ? "não existe — use L." + near : "não existe na biblioteca do plugin — ignorado"); return nop;
} });
`;

/**
 * Coloca as skills dos plugins DENTRO do projeto (plugins/<plugin>/<skill>/), como o Claude faz com
 * ~/.claude/skills: a IA lê SKILL.md e abre as referências/templates/biblioteca sob demanda, e as cenas
 * HTML podem importar a biblioteca (com o adaptador do @napi-rs/canvas). Só copia o que mudou.
 */
export function stagePluginSkills(s: Settings, ids: string[] | undefined, projectDir: string): Array<{ plugin: string; skill: string; rel: string; files: string[]; jsLib: boolean }> {
  const out: Array<{ plugin: string; skill: string; rel: string; files: string[]; jsLib: boolean }> = [];
  for (const id of ids ?? []) {
    const p = getPlugin(s, id);
    if (!p || p.styles?.length) continue;                     // coleções de estilo entram só pelo texto
    for (const it of claudeItems(pluginRoot(p.dir))) {
      if (it.kind !== 'skill' || !it.dir) continue;
      const rel = ['plugins', id, slugify(it.name)].join('/');
      const dest = path.join(projectDir, ...rel.split('/'));
      const stamp = path.join(dest, '.filmforge-stage');
      const srcTime = String(fs.statSync(it.file).mtimeMs);
      if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== srcTime) {
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(it.dir, dest, { recursive: true, force: true, filter: (f) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(f) });
        fs.writeFileSync(stamp, srcTime);
      }
      const files = it.files ?? [];
      const jsLib = files.some((f) => /\.m?js$/i.test(f) && /^(lib|src)\//.test(f));
      /* módulo único com a biblioteca inteira: modelo sem ferramentas inventava "lib/index.mjs" e nomes que não existem */
      const libMods = files.filter((f) => /^lib\/.+\.mjs$/i.test(f) && !/film\.mjs$|_all\.mjs$/i.test(f));
      if (libMods.length) {
        const all = libMods.map((f) => `export * from "./${f.slice(4)}";`).join('\n') + '\n' +
          libMods.map((f, i) => `import * as m${i} from "./${f.slice(4)}";`).join('\n') + '\n' +
          `const all = Object.assign({}, ${libMods.map((_f, i) => `m${i}`).join(', ')});\n` + SAFE_LIB;
        const allFile = path.join(dest, 'lib', '_all.mjs');
        if (readText(allFile) !== all) fs.writeFileSync(allFile, all);
      }
      if (files.some((f) => /\.m?js$/.test(f) && /@napi-rs\/canvas|["']canvas["']/.test(readText(path.join(it.dir!, f))))) {
        const shim = path.join(projectDir, 'plugins', '_shim', 'napi-canvas.mjs');
        if (!fs.existsSync(shim)) { fs.mkdirSync(path.dirname(shim), { recursive: true }); fs.writeFileSync(shim, CANVAS_SHIM); }
      }
      out.push({ plugin: id, skill: it.name, rel, files, jsLib });
    }
  }
  return out;
}

/** htmlDir: pasta da página que importa a biblioteca quando o modelo não tem ferramentas (vídeo livre no Ollama).
 *  budget: orçamento de caracteres do bloco (modelo pequeno ou cap declarado pelo plugin — ver prompt). */
export interface PluginPromptCtx { projectDir?: string; stepKind?: string; sceneDir?: string; htmlDir?: string; idea?: string; budget?: number }

const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/**
 * Vídeo livre (modelo local) sem estilo escolhido: o modelo só recebia a LISTA de nomes e desenhava no próprio
 * estilo. Escolhe o estilo cujo nome/resumo mais combina com a ideia (sem combinação, o primeiro). Função pura.
 */
export function autoStyle<T extends { id: string; name: string; summary?: string; category?: string }>(list: T[], idea = ''): T | undefined {
  const words = fold(idea).split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  let best = list[0], score = 0;
  for (const x of list) {
    const text = fold(`${x.name} ${x.summary ?? ''} ${x.category ?? ''}`);
    const n = words.filter((w) => text.includes(w)).length;
    if (n > score) { best = x; score = n; }
  }
  return best;
}

/** Template escolhido num plugin que é uma coleção de skills (sem estilos nem motor próprio): o nome da skill, se existir. */
export function templateOf(p: Pick<PluginInfo, 'styles' | 'skills'>, kit: unknown, chosen: string | undefined): string | undefined {
  if (!chosen || p.styles?.length || kit || (p.skills?.length ?? 0) < 2) return undefined;
  return p.skills!.includes(chosen) ? chosen : undefined;
}

export function pluginPrompt(s: Settings, ids: string[] | undefined, styles: Record<string, string> = {}, ctx: PluginPromptCtx = {}): string {
  const list = (ids ?? []).map((id) => { const p = getPlugin(s, id); if (p) p.id = id; return p; }).filter((p): p is PluginInfo => !!p);
  if (!list.length) return '';
  const staged = ctx.projectDir ? stagePluginSkills(s, ids, ctx.projectDir) : [];
  const totalSkills = list.reduce((a, p) => a + (p.styles?.length ? 1 : p.skills?.length ?? 0), 0);
  /* orçamento do bloco: cap declarado pelo plugin vence, depois o do modelo pequeno, depois o clássico 26k */
  let cfgMax: number | undefined;
  for (const p of list) { const c = contractCfgOf(p.dir); if (c?.maxPromptChars) cfgMax = Math.min(cfgMax ?? Infinity, c.maxPromptChars); }
  const totalCap = Math.max(6000, Math.min(26000, ctx.budget ?? 26000, cfgMax ?? 26000));
  const capFile = Math.min(totalSkills <= 2 ? 12000 : CAP_FILE, Math.ceil(totalCap * 0.4));
  const styleCap = Math.min(9000, Math.ceil(totalCap * 0.45));
  const parts: string[] = [];
  let used = 0;
  let adapted = 0;
  /* vídeo livre num modelo local: a página é o vídeo inteiro (sem etapas de elenco/plano) */
  const freeHtml = ctx.stepKind === 'free' && !!ctx.htmlDir;
  for (const p of list) {
    const lines: string[] = [`### Plugin "${p.displayName ?? p.name}" — use [${p.name}]`];
    if (p.description) lines.push(p.description);
    if (p.mcp?.length) lines.push(`Servidores MCP declarados: ${p.mcp.join(', ')}.`);
    /* plugin de estilos: só o estilo escolhido no projeto entra (inteiro); sem escolha, só a lista */
    const chosen = p.styles?.find((x) => x.id === styles[p.id]);
    const style = chosen ?? (freeHtml && p.styles?.length ? autoStyle(p.styles, ctx.idea) : undefined);
    if (p.styles?.length && !style) lines.push(`Estilos disponíveis (nenhum escolhido): ${p.styles.map((x) => x.name).join(', ')}.`);
    if (style) lines.push(`${chosen ? 'ESTILO ESCOLHIDO NO PROJETO' : 'ESTILO DESTE VÍDEO (o FilmForge escolheu pelo tema; troque no projeto)'}: ${style.name}${style.film ? ` (filme de referência: ${style.film})` : ''}. Siga a skill abaixo à risca.`);
    /* motor próprio (kit "player"): o FilmForge usa o motor do plugin nas etapas de elenco e planos;
       aqui entra só a adaptação + as regras de história/ritmo (o SKILL.md manda instalar e renderizar sozinho) */
    const kit = detectKit(p.dir);
    /* coleção de skills (ex.: animation-skills): o template escolhido no projeto é a única skill que entra */
    const template = templateOf(p, kit, styles[p.id]);
    if (template) lines.push(`TEMPLATE ESCOLHIDO NO PROJETO: ${template} — use SÓ este template em TODAS as cenas (as outras skills do plugin não fazem parte deste vídeo).`);
    if (kit?.kind === 'player' || kit?.kind === 'pages') {
      lines.push(freeHtml ? kitFreeAdaptation(kit, styles[p.id], ctx.idea) : kit.kind === 'pages' ? pagesAdaptation(kit, styles[p.id], ctx.stepKind) : kitAdaptation(kit, ctx.stepKind));
      const chunk = parts.join('\n').length + lines.join('\n').length;
      if (used + chunk <= totalCap) { used += chunk; parts.push(lines.join('\n')); }
      continue;
    }
    /* plugin ADAPTADO ao FilmForge: nesta etapa entra só o que foi mapeado para ela (ou nada) */
    const adapt = !p.styles?.length ? readAdaptation(p.dir) : undefined;
    if (adapt && ctx.stepKind) {
      const mapped = adapt.items.filter((it) => it.steps.includes(ctx.stepKind!) && (!template || !/^skill:/.test(it.id) || it.id === `skill:${template}`));
      const out = adapt.outputs?.[ctx.stepKind];
      if (!mapped.length && !out) continue;               // o plugin não tem nada para esta etapa
      adapted++;
      lines.push(`(adaptado ao FilmForge: ${adapt.summary})`);
      if (adapt.global) lines.push(adapt.global);
      if (out) lines.push(`SAÍDA NESTA ETAPA: ${out}`);
      if (adapt.ignore?.length) lines.push(`NÃO disponível no FilmForge (ignore se o plugin pedir): ${adapt.ignore.join('; ')}.`);
      const cap = Math.min(mapped.length <= 2 ? 9000 : CAP_FILE, Math.ceil(totalCap * 0.45));
      for (const it of mapped) {
        const f = adaptItemFile(p.dir, it.id);
        const body = f ? bodyOf(readText(f.file)).slice(0, cap) : '';
        if (!body) continue;
        const chunk = `\n[${f!.label}]${it.note ? ` — ${it.note}` : ''}\n${body}`;
        if (used + chunk.length > totalCap) break;
        used += chunk.length; lines.push(chunk);
      }
      parts.push(lines.join('\n'));
      continue;
    }
    const items =claudeItems(pluginRoot(p.dir)).filter((it) => it.kind !== 'skill' || (p.styles?.length ? !!style && it.name === style.skill : !template || it.name === template));
    for (const it of items) {
      const body = bodyOf(readText(it.file)).slice(0, it.kind === 'skill' ? (style ? styleCap : capFile) : CAP_FILE);
      if (!body) continue;
      const st = staged.find((x) => x.plugin === p.id && x.skill === it.name);
      const where = st ? `\n(Pasta desta skill no projeto: ${st.rel}/ — os caminhos citados abaixo, como references/… ou lib/…, são relativos a ela. Abra os arquivos de apoio SOMENTE quando a skill mandar: ${st.files.filter((f) => /\.(md|mjs|js|json)$/i.test(f)).slice(0, 40).join(', ')}.)` : '';
      const chunk = `\n[${it.kind === 'skill' ? 'skill' : it.kind === 'command' ? 'comando' : 'agente'} ${it.name}]${where}\n${body}`;
      if (used + chunk.length > 26000) break;
      used += chunk.length; lines.push(chunk);
      /* skill que desenha com uma biblioteca JS: como usá-la DENTRO de uma cena do FilmForge */
      /* vídeo livre num agente (Claude/Codex…): ele segue a skill como ela é, renderizando sozinho */
      if (st?.jsLib && (ctx.stepKind !== 'free' || ctx.htmlDir)) lines.push(adaptCodeSkill(st, ctx));
    }
    parts.push(lines.join('\n'));
  }
  if (!parts.length) return '';
  return adapted === parts.length
    ? `PLUGINS ATIVOS (formato Claude, adaptados ao FilmForge — siga as diretrizes abaixo NESTA etapa e cite o nome do plugin quando explicar decisões):\n${parts.join('\n\n')}`
    : `PLUGINS ATIVOS (formato Claude — siga estas diretrizes em TODAS as etapas e cite o nome do plugin quando explicar decisões):\n${parts.join('\n\n')}`;
}

/**
 * Motor próprio no vídeo livre com modelo local: não há etapas de elenco/plano nem o motor do plugin — a página
 * desenha tudo em Canvas 2D. Entra a style bible (player) ou o STYLE.md do estilo (pages), para o visual seguir o plugin.
 */
function kitFreeAdaptation(kit: KitInfo, styleId: string | undefined, idea?: string): string {
  const head = ['ESTILO DO PLUGIN — adaptação FilmForge para o vídeo livre:',
    '- NÃO rode nem importe o motor do plugin (render.mjs, /core/lib.js, npm, node, python): desenhe TUDO nesta página, em Canvas 2D, imitando o visual descrito abaixo (paleta, traço, personagens, enquadramento, tipografia).'];
  if (kit.kind === 'pages') {
    const st = kit.styleInfo?.find((x) => x.id === styleId) ?? (kit.library ? autoStyle(kit.styleInfo ?? [], idea) : undefined);
    const md = st && kit.library ? readText(path.join(kit.library, 'styles', st.id, 'STYLE.md')).slice(0, 5000) : '';
    return [...head, st ? `ESTILO: ${st.name}${st.summary ? ` — ${st.summary}` : ''}` : '', md].filter(Boolean).join('\n');
  }
  const bible = kit.refs.find((x) => /style-bible\.md$/i.test(x));
  const text = bible ? readText(bible).slice(0, 5000) : '';
  return [...head, text ? `STYLE BIBLE DO PLUGIN (style-bible.md):\n${text}` : ''].filter(Boolean).join('\n');
}

/** Plugin com motor próprio: o que vale em cada etapa do FilmForge (sem instalar/renderizar pelo plugin). */
function kitAdaptation(kit: KitInfo, stepKind?: string): string {
  const ref = (name: string) => { const f = kit.refs.find((x) => path.basename(x) === name); return f ? readText(f).slice(0, 6000) : ''; };
  const story = stepKind === 'script' || stepKind === 'scene_plan' || stepKind === 'ideation' ? ref('story-breakdown.md') : '';
  return [
    'MOTOR PRÓPRIO DO PLUGIN — adaptação FilmForge:',
    '- NÃO instale nem rode o kit (render.mjs, tools/*.py, npm, node, ffmpeg): o FilmForge já usa o motor do plugin, faz os tempos (Whisper), a narração, a trilha e a montagem.',
    '- Roteiro: mantenha a narração como texto falado contínuo; o plano de cenas corta em planos curtos (2–4 s) nas pausas da fala.',
    '- O visual (elenco, cenários e cada plano registerShot) é feito nas etapas "Elenco e cenários" e "Plano da cena", com a style bible e a API do plugin.',
    story ? `\nREGRAS DE HISTÓRIA E RITMO DO PLUGIN (story-breakdown.md):\n${story}` : '',
  ].filter(Boolean).join('\n');
}

/** Biblioteca de estilos (pages): o estilo escolhido (STYLE.md) + adaptação; sem clonar nem rodar as ferramentas do plugin. */
function pagesAdaptation(kit: KitInfo, styleId: string | undefined, stepKind?: string): string {
  if (!kit.library) return 'BIBLIOTECA DE ESTILOS DO PLUGIN ainda não baixada: na aba Plugins, use "Baixar a biblioteca" (ou gere a prévia). Até lá o plugin entra só como referência.';
  const st = kit.styleInfo?.find((x) => x.id === styleId);
  const styleMd = st ? readText(path.join(kit.library, 'styles', st.id, 'STYLE.md')).slice(0, stepKind === 'script' || stepKind === 'scene_plan' ? 7000 : 4000) : '';
  return [
    'BIBLIOTECA DE ESTILOS DO PLUGIN — adaptação FilmForge:',
    '- NÃO rode setup.sh, git, npm, node, python nem as ferramentas do plugin: o FilmForge já tem a biblioteca, renderiza as páginas, faz a narração, a trilha e a montagem.',
    '- Cada cena do vídeo é UMA página no estilo (window.READY, window.render(t), window.DUR), escrita na etapa "Plano da cena" com o kit /core/lib.js.',
    st ? `ESTILO ESCOLHIDO NO PROJETO: ${st.name}${st.film ? ` (demo: ${st.film})` : ''}.\n${styleMd}` : `Estilos disponíveis (nenhum escolhido): ${(kit.styleInfo ?? []).slice(0, 61).map((x) => x.name).join(', ')}.`,
  ].join('\n');
}

/** A skill renderiza filmes inteiros (node/ffmpeg); no FilmForge cada CENA é uma página HTML que importa a biblioteca. */
/**
 * "Fábricas" da biblioteca: a função monta e DEVOLVE quem desenha (filmFinish(W, H) → (ctx, frame) => …) ou uma
 * camada pronta (paper(W, H), soil(W, H - G) → canvas, que a página tem de desenhar com drawImage). O modelo as
 * chamava como se desenhassem e jogava o retorno fora: fundo preto, sem acabamento.
 */
export function libFactories(libDir: string): Record<string, 'frame' | 't' | 'canvas'> {
  const out: Record<string, 'frame' | 't' | 'canvas'> = {};
  for (const m of [...readText(path.join(libDir, '_all.mjs')).matchAll(/^export \* from "\.\/([^"]+)"/gm)]) {
    for (const part of readText(path.join(libDir, ...m[1]!.split('/'))).split(/^(?=export\s)/m)) {
      const name = /^export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/.exec(part);
      if (!name) continue;
      const ret = /\breturn\s+(?:function\s*)?\(\s*(?:ctx|g|c)\s*,\s*(\w+)\s*\)\s*(?:=>|\{)/.exec(part);
      const cv = /\b(?:const|let)\s+(\w+)\s*=\s*createCanvas\(/.exec(part);
      if (ret) out[(name[1] ?? name[2])!] = /^t(ime)?$/i.test(ret[1]!) ? 't' : 'frame';
      else if (cv && new RegExp(String.raw`\breturn\s+${cv[1]}\s*;`).test(part)) out[(name[1] ?? name[2])!] = 'canvas';
    }
  }
  return out;
}

/** Nomes exportados pela biblioteca inteira da skill (os mesmos de L no _all.mjs). */
function libExportNames(skillDir: string): string[] {
  const libDir = path.join(skillDir, 'lib');
  return [...readText(path.join(libDir, '_all.mjs')).matchAll(/^export \* from "\.\/([^"]+)"/gm)]
    .flatMap((m) => [...readText(path.join(libDir, ...m[1]!.split('/'))).matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm)].map((x) => x[1]!));
}

/**
 * Cena-exemplo do PRÓPRIO plugin no formato da página do vídeo livre: o template da skill (Node, run({ setup, frame }))
 * vira render(t) com os mesmos nomes e argumentos do autor. Modelo pequeno copia um exemplo que funciona muito melhor do
 * que monta a cena a partir de ~100 assinaturas (inventava L.fill, L.ring…). undefined se a skill não tem template nesse formato.
 */
export function pluginExample(skillDir: string, names: string[]): string | undefined {
  const tdir = path.join(skillDir, 'templates');
  let files: string[] = [];
  try { files = fs.readdirSync(tdir).filter((f) => /\.m?js$/i.test(f)).sort(); } catch { return undefined; }
  const block = (src: string, open: number): string | undefined => {   // conteúdo entre a { em open e a } que fecha
    let depth = 0, quote = '';
    for (let i = open; i < src.length; i++) {
      const ch = src[i]!;
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return src.slice(open + 1, i);
    }
    return undefined;
  };
  for (const f of files) {
    const src = readText(path.join(tdir, f));
    const fm = /\bframe\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)\s*\{/.exec(src);
    if (!fm) continue;
    let body = block(src, fm.index + fm[0].length - 1);
    if (!body) continue;
    const [, cx, tt, ii, ss] = fm as unknown as [string, string, string, string, string];
    const sm = /\bsetup\s*\(\s*\)\s*\{\s*return\s*\{/.exec(src);
    const setup = sm ? block(src, sm.index + sm[0].length - 1) : undefined;
    /* exposure() (film.mjs, renderizador Node) não está em L: o tempo desenhado é o próprio t */
    body = body.replace(/\bexposure\s*\([^;]*\)/g, tt);
    const code = body + (setup ?? '');
    const used = names.filter((n) => new RegExp(`(^|[^.\\w$])${n}\\s*\\(`).test(code) || new RegExp(`(^|[^.\\w$])${n}\\b`).test(code) && /^[A-Z_]+$/.test(n));
    /* constantes de cena do template (chão, margens…), menos as do formato, que vêm do esqueleto */
    const consts = [...src.matchAll(/^const\s+([A-Z]\w*)\s*=\s*[-\d.]+\s*;.*$/gm)].filter((m) => !['W', 'H', 'FPS', 'DUR'].includes(m[1]!)).map((m) => m[0].trim());
    const indent = (s: string) => s.split('\n').map((l) => l.replace(/^\s{0,4}/, '  ')).join('\n').trim();
    return [
      `// EXEMPLO do próprio plugin (${path.basename(tdir)}/${f}) já no formato desta página — copie este padrão de chamadas`,
      `// (nomes, ordem dos argumentos, camadas montadas UMA vez fora do render, acabamento por último).`,
      `const { ${used.join(', ')} } = L;`,
      ...consts,
      setup ? `const SETUP = {${indent(setup)}};   // camadas pesadas: UMA vez, fora do render` : '',
      `function render(${tt}) {`,
      `  const ${cx} = g, ${ii} = Math.round(${tt} * 30)${setup ? `, ${ss} = SETUP` : ''};`,
      `  ${indent(body)}`,
      '}',
    ].filter(Boolean).join('\n');
  }
  return undefined;
}

function adaptCodeSkill(st: { rel: string; files: string[] }, ctx: PluginPromptCtx): string {
  const fromScene = ctx.htmlDir && ctx.projectDir ? path.relative(ctx.htmlDir, ctx.projectDir).split(path.sep).join('/') || '.'
    : ctx.sceneDir && ctx.projectDir ? path.relative(path.join(ctx.sceneDir, 'code'), ctx.projectDir).split(path.sep).join('/') || '.' : '../../..';
  /* 12 cortava lib/textures.mjs (paper, soil, filmFinish) quando os rigs vinham antes; o limite fica no tamanho do texto */
  const libs = st.files.filter((f) => /^lib\/.+\.m?js$/i.test(f) && !/film\.m?js$|_all\.m?js$/i.test(f)).slice(0, 30);
  const shim = fs.existsSync(path.join(ctx.projectDir ?? '', 'plugins', '_shim', 'napi-canvas.mjs'));
  /* vídeo livre sem ferramentas: o esqueleto do prompt já importa a biblioteca inteira como L */
  if (ctx.htmlDir) return [
    '',
    'ADAPTAÇÃO FILMFORGE desta skill:',
    '- NÃO rode node, npm, ffmpeg, film.mjs, sound.mjs nem music.mjs: o FilmForge renderiza a página. O vídeo é mudo: sem sons, sfx nem trilha.',
    '- O "frame(ctx, t)" da skill é a função render(t) do esqueleto; siga o fluxo da skill (beat sheet, bíblia de estilo) DENTRO dela: cada beat é uma janela de tempo (L.ss / L.eIO).',
    '- A biblioteca inteira já vem importada no esqueleto como L. Chame L.nome(...) só com os nomes da lista abaixo; não importe outros arquivos e não reescreva a biblioteca.',
    '- Nomes com inicial maiúscula são classes/constantes; métodos de uma classe (citados na skill) NÃO existem soltos em L — chame-os na instância (const p = new L.Classe(g); p.metodo(...)). Classes que desenham recebem o canvas g no construtor.',
    '- Matemática: use Math.sin, Math.cos etc. (não L.sin).',
    ctx.projectDir ? libSignatures(path.join(ctx.projectDir, ...st.rel.split('/')), libs, Math.min(6000, Math.ceil((ctx.budget ?? 26000) * 0.35))) : '',
    ...(() => {
      if (!ctx.projectDir) return [];
      const dir = path.join(ctx.projectDir, ...st.rel.split('/'));
      const ex = pluginExample(dir, libExportNames(dir));
      return ex ? ['- Comece a partir deste exemplo que FUNCIONA (troque cenário, personagens e beats pela ideia do vídeo, mantendo a forma das chamadas):', ex] : [];
    })(),
  ].filter(Boolean).join('\n');
  const page = 'Cena por código = UMA página HTML (code/scene.html) que';
  return [
    '',
    'ADAPTAÇÃO FILMFORGE desta skill:',
    '- NÃO rode node, npm, ffmpeg, film.mjs render, sound.mjs nem music.mjs: o FilmForge renderiza, mixa a narração e cria efeitos/trilha. Use o "frame(ctx, t)" da skill dentro do contrato da cena.',
    '- Roteiro e planejamento: siga o fluxo da skill (beat sheet, bíblia de estilo) para decidir as cenas; cada beat vira uma cena "code".',
    `- ${page} importa a biblioteca da skill como módulo ES, com caminho relativo à cena: "${fromScene}/${st.rel}/lib/…".`,
    shim ? `- A biblioteca importa "@napi-rs/canvas": declare ANTES do módulo o import map <script type="importmap">{"imports":{"@napi-rs/canvas":"${fromScene}/plugins/_shim/napi-canvas.mjs"}}</script> (o FilmForge fornece o adaptador para o canvas do navegador).` : '',
    `- Exemplo: <canvas id="c" width="1920" height="1080"></canvas><script type="module">import { ${libs.length ? '…' : ''} } from "${fromScene}/${st.rel}/${libs[0] ?? 'lib/core.mjs'}"; const ctx = document.getElementById("c").getContext("2d"); function frame(ctx, t) { /* desenho da skill */ } window.__forge = { duration: D, fps: 30, seek(t) { ctx.clearRect(0, 0, 1920, 1080); frame(ctx, t); }, pause() {}, sfx: [/* {t, name} dos contatos da animação */] };</script>`,
    libs.length ? `- Módulos disponíveis: ${libs.join(', ')} (não use lib/film.mjs: é o renderizador Node da skill).` : '',
    '- Sons: em vez de sound.mjs, declare window.__forge.sfx = [{ t, name }] ~0,03 s antes de cada contato (regra da skill); a trilha vem da etapa de música.',
  ].filter(Boolean).join('\n');
}

/**
 * Cabeçalho do esqueleto do vídeo livre quando um plugin do projeto traz biblioteca JS: import map do adaptador
 * de canvas + import da biblioteca inteira (lib/_all.mjs, criado no staging) como L. Chamar depois do pluginPrompt.
 */
export function freeLibImport(s: Settings, ids: string[] | undefined, projectDir: string, htmlDir: string): { importmap: string; line: string; names: string[]; firstParam: Record<string, string>; factories: Record<string, 'frame' | 't' | 'canvas'>; rigs: Array<{ name: string; what: string }>; contract: { forbidCanvas: boolean; allow: string[]; maxPromptChars?: number; requireLib: boolean; plugin: string } } | undefined {
  for (const id of ids ?? []) {
    const p = getPlugin(s, id);
    if (!p || p.styles?.length) continue;
    for (const it of claudeItems(pluginRoot(p.dir))) {
      if (it.kind !== 'skill' || !it.dir) continue;
      const rel = ['plugins', id, slugify(it.name), 'lib', '_all.mjs'];
      if (!fs.existsSync(path.join(projectDir, ...rel))) continue;
      const up = path.relative(htmlDir, projectDir).split(path.sep).join('/') || '.';
      const shim = fs.existsSync(path.join(projectDir, 'plugins', '_shim', 'napi-canvas.mjs'));
      const libDir = path.join(projectDir, ...rel.slice(0, -1));
      const decls = [...readText(path.join(libDir, '_all.mjs')).matchAll(/^export \* from "\.\/([^"]+)"/gm)]
        .flatMap((m) => [...readText(path.join(libDir, ...m[1].split('/'))).matchAll(/^export\s+((?:async\s+)?(?:function|const|class)\s+(\w+).*)$/gm)]);
      const names = decls.map((x) => x[2]!);
      /* primeiro parâmetro de cada função (ctx? W? t?): o FilmForge acerta chamadas L.x(...) com o g a mais/a menos */
      const firstParam: Record<string, string> = {};
      for (const d of decls) {
        if (/^(?:async\s+)?class\s/.test(d[1]!)) continue;
        const sig = signatureOf(d[1]!);
        const open = sig.indexOf('(');
        if (open < 0) continue;
        firstParam[d[2]!] = sig.slice(open + 1).split(/[,)=]/)[0]!.trim();
      }
      const factories = libFactories(libDir);
      /* personagens prontos (rigs/*.mjs, função (ctx, x, y, …)): o prompt manda usá-los em vez de desenhar à mão */
      const rigs: Array<{ name: string; what: string }> = [];
      for (const m of readText(path.join(libDir, '_all.mjs')).matchAll(/^export \* from "\.\/(rigs\/[^"]+)"/gm)) {
        const src = readText(path.join(libDir, ...m[1]!.split('/')));
        const what = /^\/\/\s*[\w.-]+\.mjs\s*[—-]+\s*([^:.(\n]{3,90})/.exec(src)?.[1]?.trim() ?? '';
        const fns = [...src.matchAll(/^export\s+function\s+(\w+)\s*\(\s*(?:ctx|g|c)\s*,\s*x\b/gm)].map((f) => f[1]!);
        const main = path.basename(m[1]!, '.mjs');        // ant.mjs → ant (antGuides é auxiliar)
        for (const n of fns.includes(main) ? [main] : fns) rigs.push({ name: n, what });
      }
      const cfg = contractCfgOf(p.dir);
      return {
        names, firstParam, factories, rigs,
        /* contrato do plugin: proibição de canvas cru + cap declarados nele (rigs prontos proíbem por padrão) */
        contract: { plugin: id, forbidCanvas: cfg?.forbidCanvas ?? rigs.length > 0, allow: cfg?.allow ?? [], maxPromptChars: cfg?.maxPromptChars, requireLib: !!cfg?.requireLib },
        importmap: shim ? `<script type="importmap">{"imports":{"@napi-rs/canvas":"${up}/plugins/_shim/napi-canvas.mjs"}}</script>` : '',
        line: `import L from "${up}/${rel.join('/')}";`,
      };
    }
  }
  return undefined;
}

/**
 * Three.js 0.160.0 (MIT) que vem com o app (resources/vendor/three): copiado para plugins/_three do projeto, servido
 * pelo forge-scene:// — sem rede. A versão é a do prompt de sistema do qwen3.5-3d-coder (cdnjs 0.160.0).
 */
export const THREE_VERSION = '0.160.0';
export function vendorThreeFile(): string | undefined {
  const rp = (process as { resourcesPath?: string }).resourcesPath;
  const tries = [rp && path.join(rp, 'vendor', 'three'), path.join(__dirname, '..', '..', 'vendor', 'three'), path.join(process.cwd(), 'vendor', 'three')];
  for (const d of tries) if (d && fs.existsSync(path.join(d, 'three.module.min.js'))) return path.join(d, 'three.module.min.js');
  return undefined;
}

/** Copia o Three.js para o projeto (uma vez) e devolve o import map relativo à pasta da página (htmlDir). */
export function stageThree(projectDir: string, htmlDir: string): { importmap: Record<string, string> } | undefined {
  const src = vendorThreeFile();
  if (!src) return undefined;
  const dest = path.join(projectDir, 'plugins', '_three', 'three.module.min.js');
  try {
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }
  } catch { return undefined; }
  const up = path.relative(htmlDir, projectDir).split(path.sep).join('/') || '.';
  return { importmap: { three: `${up}/plugins/_three/three.module.min.js` } };
}

/**
 * Biblioteca "cartoon3d" (vendor/cartoon3d/cartoon3d.js, MIT — visual do claude-animated-shorts) + Three.js copiados para o
 * projeto; devolve o import map relativo à pasta da página com "three" e "cartoon3d".
 */
/** Bundle da biblioteca cartoon3d que vem com o app (vendor/cartoon3d/cartoon3d.js). */
export function cartoon3dBundle(): string | undefined {
  const f = vendorThreeFile() && path.join(path.dirname(path.dirname(vendorThreeFile()!)), 'cartoon3d', 'cartoon3d.js');
  return f && fs.existsSync(f) ? f : undefined;
}

export function stageCartoon3d(projectDir: string, htmlDir: string): { importmap: Record<string, string> } | undefined {
  const three = stageThree(projectDir, htmlDir);
  const src = vendorThreeFile() && path.join(path.dirname(path.dirname(vendorThreeFile()!)), 'cartoon3d', 'cartoon3d.js');
  if (!three || !src || !fs.existsSync(src)) return undefined;
  const dest = path.join(projectDir, 'plugins', '_cartoon3d', 'cartoon3d.js');
  try {
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }
  } catch { return undefined; }
  const up = path.relative(htmlDir, projectDir).split(path.sep).join('/') || '.';
  return { importmap: { ...three.importmap, cartoon3d: `${up}/plugins/_cartoon3d/cartoon3d.js` } };
}

/** "function nome(args)" / "const nome = (args)" até o parêntese que fecha os parâmetros (defaults com { } incluídos). */
function signatureOf(decl: string): string {
  const open = decl.indexOf('(');
  const eq = decl.indexOf('=');
  if (open < 0 || (eq >= 0 && eq < open && !/^\s*(?:async\s*)?\(/.test(decl.slice(eq + 1)))) return decl.replace(/;?\s*(?:\/\/.*)?$/, '').slice(0, 80);
  let depth = 0;
  for (let i = open; i < decl.length; i++) {
    if (decl[i] === '(') depth++;
    else if (decl[i] === ')' && --depth === 0) return decl.slice(0, i + 1).slice(0, 160);
  }
  return decl.slice(0, 160);
}

/** "arquivo: export function nome(args)" de cada módulo, sem os corpos (até ~5 mil caracteres). Função pura sobre o disco. */
export function libSignatures(skillDir: string, libs: string[], cap = 6000): string {
  const out: string[] = [];
  let used = 0;
  /* personagens (rigs/) primeiro: sem eles o modelo inventava nomes (L.ants) e a cena ficava sem os personagens do plugin */
  const ordered = [...libs.filter((f) => /\/rigs\//.test(f)), ...libs.filter((f) => !/\/rigs\//.test(f))];
  for (const f of ordered) {
    /* "fábrica" (devolve quem desenha, ex.: filmFinish(W, H) → (ctx, frame) => …): o modelo chamava e jogava o retorno fora */
    const sigs = readText(path.join(skillDir, ...f.split('/'))).split(/^(?=export\s)/m)
      .filter((part) => /^export\s+(?:async\s+)?(?:function|const|class)\s/.test(part))
      .map((part) => {
        const sig = signatureOf(part.split('\n')[0]!.replace(/^export\s+/, ''));
        const ret = /\breturn\s+(?:function\s*)?\(\s*(?:ctx|g|c)\s*,\s*(\w+)\s*\)\s*(?:=>|\{)/.exec(part);
        return ret ? `${sig} → devolve (ctx, ${ret[1]}) => desenha: crie UMA vez fora do render e chame a cada quadro` : sig;
      });
    if (!sigs.length) continue;
    /* rig: a 1ª linha do cabeçalho diz O QUE ele desenha ("a cockroach…") — só a assinatura, o modelo usava ant para barata */
    const what = /\/rigs\//.test(f) ? /^\/\/\s*[\w.-]+\.mjs\s*[—-]+\s*([^:.(\n]{3,90})/.exec(readText(path.join(skillDir, ...f.split('/'))))?.[1]?.trim() : undefined;
    const line = `${f}${what ? ` (${what})` : ''}: ${sigs.join('; ')}`;
    if (used + line.length > cap) continue;   // pula o arquivo grande e segue: os menores depois dele ainda cabem
    used += line.length; out.push(line);
  }
  return out.length ? `- API da biblioteca (chame como L.nome; só existem estes nomes):\n${out.join('\n')}` : '';
}

/** Resumo curto para a interface/log. */
export function pluginSummary(s: Settings, ids: string[] | undefined): string[] {
  return (ids ?? []).map((id) => getPlugin(s, id)?.name ?? id);
}
