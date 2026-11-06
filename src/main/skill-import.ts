import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HarnessId, PluginInfo, Route, Settings, Skill } from '../shared/types';
import { deleteSkill, getAnyRoute, getSkill, listRoutes, parseFrontMatter, saveRoute, saveSkill, slugify } from './library';
import { extractZip, installPluginFolder, installPluginUrl, parseGithubUrl, pluginsRoot } from './plugins';
import { VIDEO_TYPES } from './presets';
import { generateSkillFromDoc } from './skilldoc';

/*
 * Importa uma skill no formato do Claude (SKILL.md com front-matter name/description, opcionalmente com
 * sub-skills/, references/, templates/…) e cria no FilmForge:
 *  1) um PLUGIN com a pasta inteira (nada se perde: o prompt de cada etapa recebe o SKILL.md e a pasta
 *     da skill fica disponível no projeto para a IA abrir as sub-skills/referências quando precisar);
 *  2) uma SKILL do FilmForge ligada ao plugin, com cada etapa apontando para a sub-skill correspondente
 *     (roteiro → script.md/hook.md, thumbnail → thumbnail.md, SEO → metadata.md/seo.md…);
 *  3) uma ROTA própria (cópia da rota-base escolhida), para o usuário ajustar sem mexer na padrão.
 * Aceita: arquivo SKILL.md, pasta da skill, pasta de plugin, .zip/.skill/.plugin ou link do GitHub.
 */

export interface SkillImportInput {
  source: string;
  routeId?: string;
  language?: string;
  name?: string;
  /** refinar as instruções por etapa com uma IA (opcional) */
  harness?: HarnessId | 'auto';
  model?: string;
}
export interface SkillImportResult { plugin: PluginInfo; skills: Skill[]; routes: Route[]; warnings: string[] }

/** Etapa do FilmForge ← palavras do nome do arquivo/seção da skill do Claude. */
export const STEP_HINTS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'ideation', re: /ideat|idea|ideia|brainstorm|calendar|calend|strateg|estrat/i },
  { kind: 'script', re: /script|roteiro|hook|gancho|retention|reten|story|narrat/i },
  { kind: 'scene_plan', re: /scene|cena|storyboard|shot|plano|broll|b-roll|edit/i },
  { kind: 'asset_design', re: /character|personag|asset|cenari/i },
  { kind: 'narration', re: /voice|voz|locu|tts/i },
  { kind: 'thumbnail', re: /thumb|capa|miniatura/i },
  { kind: 'metadata', re: /metadata|seo|title|t[ií]tulo|descri|tags|chapter|cap[ií]tulo/i },
  { kind: 'review', re: /audit|review|revis|analy|anális|checklist|quality/i },
];

const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const firstParagraph = (md: string, max = 420) => md.replace(/^---[\s\S]*?\n---\s*/, '').split(/\r?\n\s*\r?\n/).map((p) => p.replace(/^#+\s*/gm, '').trim())
  .find((p) => p.length > 40 && !/^[|`>-]/.test(p))?.replace(/\s+/g, ' ').slice(0, max) ?? '';
const titleOf = (md: string, fallback: string) => /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? fallback;

/** Todas as pastas com SKILL.md (até 4 níveis). */
function findSkillDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4 || out.length >= 10) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && /^skill\.md$/i.test(e.name))) out.push(d);
    for (const e of entries) if (e.isDirectory() && !/^(node_modules|\.git|_gallery)$/.test(e.name)) walk(path.join(d, e.name), depth + 1);
  };
  walk(root, 0);
  return out;
}

/** Monta uma pasta de plugin do Claude em volta de uma (ou mais) skills soltas. */
function wrapAsPlugin(skillDirs: string[], tmp: string): string {
  const first = parseFrontMatter(read(path.join(skillDirs[0]!, fs.readdirSync(skillDirs[0]!).find((f) => /^skill\.md$/i.test(f))!))).meta;
  const name = slugify(String(first['name'] ?? path.basename(skillDirs[0]!))) || 'skill-importada';
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  for (const d of skillDirs) {
    const meta = parseFrontMatter(read(path.join(d, fs.readdirSync(d).find((f) => /^skill\.md$/i.test(f))!))).meta;
    const dest = path.join(root, 'skills', slugify(String(meta['name'] ?? path.basename(d))) || path.basename(d));
    fs.cpSync(d, dest, { recursive: true, filter: (f) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(f) });
    if (!fs.existsSync(path.join(dest, 'SKILL.md'))) {
      const actual = fs.readdirSync(dest).find((f) => /^skill\.md$/i.test(f));
      if (actual) fs.renameSync(path.join(dest, actual), path.join(dest, 'SKILL.md'));
    }
  }
  /* licença da origem (pasta da skill ou acima) acompanha o plugin */
  for (let d = skillDirs[0]!, i = 0; i < 3; d = path.dirname(d), i++) {
    const lic = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map((f) => path.join(d, f)).find((f) => fs.existsSync(f));
    if (lic) { fs.copyFileSync(lic, path.join(root, 'LICENSE')); break; }
  }
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name, description: String(first['description'] ?? '').replace(/\s+/g, ' ').slice(0, 400), version: '1.0.0',
  }, null, 2));
  return root;
}

/** Instala a origem como plugin e devolve o plugin + as pastas das skills dentro dele. */
async function installSource(s: Settings, source: string): Promise<{ plugin: PluginInfo; skillDirs: string[] }> {
  const src = source.trim().replace(/^"|"$/g, '');
  if (!src) throw new Error('escolha um SKILL.md, uma pasta, um .zip ou cole um link do GitHub');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-skill-import-'));
  try {
    let plugin: PluginInfo;
    if (!fs.existsSync(src) && parseGithubUrl(src)) plugin = await installPluginUrl(s, src);
    else {
      if (!fs.existsSync(src)) throw new Error(`não encontrei ${src}`);
      let dir = fs.statSync(src).isDirectory() ? src : path.dirname(src);
      if (fs.statSync(src).isFile() && /\.(zip|skill|plugin)$/i.test(src)) { dir = path.join(tmp, 'zip'); extractZip(src, dir); }
      else if (fs.statSync(src).isFile() && !/\.md$/i.test(src)) throw new Error('use um SKILL.md, uma pasta, um .zip/.skill/.plugin ou um link do GitHub');
      const isPlugin = ['.claude-plugin', 'plugin.json'].some((f) => fs.existsSync(path.join(dir, f)));
      const skills = findSkillDirs(dir);
      if (!isPlugin && !skills.length) throw new Error('não encontrei nenhum SKILL.md nessa origem');
      plugin = installPluginFolder(s, isPlugin ? dir : wrapAsPlugin(skills, tmp), src);
    }
    const installed = path.join(pluginsRoot(s), plugin.id);
    const skillDirs = findSkillDirs(installed);
    if (!skillDirs.length) throw new Error(`o plugin "${plugin.name}" não tem SKILL.md`);
    return { plugin, skillDirs };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** Instruções por etapa: cada sub-skill/referência (ou seção do SKILL.md) vira um ponteiro na etapa certa. */
export function mapSkillSteps(skillDir: string, pluginName: string): Record<string, string> {
  const steps: Record<string, string[]> = {};
  const add = (kind: string, text: string) => { (steps[kind] ??= []).push(text); };
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 2) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && !/^(node_modules|\.git|_gallery|execution|scripts?)$/i.test(e.name)) walk(full, depth + 1);
      else if (/\.md$/i.test(e.name) && !/^(skill|readme|license|changelog)\.md$/i.test(e.name)) files.push(full);
    }
  };
  walk(skillDir, 0);
  /* sub-skills primeiro (são instruções de tarefa); referências depois (apoio) */
  files.sort((a, b) => Number(/reference|refer|template/i.test(a)) - Number(/reference|refer|template/i.test(b)) || a.localeCompare(b));
  for (const f of files) {
    const rel = path.relative(skillDir, f).split(path.sep).join('/');
    const hit = STEP_HINTS.find((h) => h.re.test(path.basename(f, '.md')));
    if (!hit) continue;
    const md = read(f);
    const isRef = /reference|refer|template/i.test(rel);
    add(hit.kind, `${isRef ? 'Consulte' : 'Siga'} "${rel}" da skill do plugin [${pluginName}] — ${titleOf(md, rel)}${firstParagraph(md) ? `: ${firstParagraph(md)}` : ''}`);
  }
  /* skill de um arquivo só: as seções do SKILL.md com cara de etapa */
  if (!Object.keys(steps).length) {
    const body = read(path.join(skillDir, 'SKILL.md')).replace(/^---[\s\S]*?\n---\s*/, '');
    for (const chunk of body.split(/^##\s+/m).slice(1)) {
      const title = chunk.split(/\r?\n/)[0]!.trim();
      const hit = STEP_HINTS.find((h) => h.re.test(title));
      if (hit) add(hit.kind, `Seção "${title}" do SKILL.md:\n${chunk.slice(title.length).trim().slice(0, 1500)}`);
    }
  }
  return Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, v.slice(0, 4).join('\n')]));
}

const freeId = (exists: (id: string) => boolean, wanted: string) => { const base = slugify(wanted) || 'skill'; let id = base, k = 2; while (exists(id)) id = `${base}-${k++}`; return id; };

export async function importClaudeSkill(s: Settings, input: SkillImportInput, log: (l: string) => void, signal?: AbortSignal): Promise<SkillImportResult> {
  const { plugin, skillDirs } = await installSource(s, input.source);
  log(`plugin "${plugin.displayName ?? plugin.name}" instalado com ${skillDirs.length} skill(s)`);
  const routes = listRoutes(s);
  const base = (input.routeId && getAnyRoute(s, input.routeId)) || routes.find((r) => r.id === 'explainer-mixed') || routes.find((r) => r.steps.some((st) => st.kind === 'scene_plan')) || routes[0]!;
  const vt = VIDEO_TYPES.find((v) => v.defaultRoute === base.id);
  const warnings: string[] = [];
  const out: SkillImportResult = { plugin, skills: [], routes: [], warnings };

  for (const dir of skillDirs.slice(0, 5)) {
    const md = read(path.join(dir, 'SKILL.md'));
    const { meta, body } = parseFrontMatter(md);
    const rawName = (skillDirs.length === 1 && input.name?.trim()) || String(meta['name'] ?? path.basename(dir));
    const name = rawName.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    const description = String(meta['description'] ?? firstParagraph(body)).replace(/\s+/g, ' ').replace(/Triggers on:.*$/i, '').trim().slice(0, 400);
    const id = freeId((x) => !!getSkill(s, x), name);

    /* rota própria: cópia da base, para ajustar sem mexer na padrão */
    const rid = freeId((x) => !!getAnyRoute(s, x), `${id}-rota`);
    const route = saveRoute(s, { ...JSON.parse(JSON.stringify(base)) as Route, id: rid, name: `${name} — ${base.name}`,
      description: `Rota da skill importada "${name}" (${plugin.name}). Base: ${base.name}.` });
    out.routes.push(route);

    const steps = mapSkillSteps(dir, plugin.name);
    let skill: Skill = {
      id, name, description,
      global: [
        `Skill importada do formato Claude (SKILL.md) e instalada como o plugin [${plugin.name}]: o SKILL.md entra no prompt de cada etapa e a pasta da skill (sub-skills, referências, modelos) fica no projeto para você abrir quando a etapa indicar.`,
        'Execução SEM usuário: nunca faça perguntas nem peça dados — use a ideia, o idioma, o formato e a duração do projeto e siga em frente. Comandos de barra, scripts Python, servidores MCP, agentes paralelos ou buscas que não estiverem disponíveis: ignore e use o próprio conhecimento.',
        'Cada etapa grava SÓ o arquivo que o FilmForge pede (roteiro narrado, cenas, metadata.json…); relatórios, tabelas e "templates de saída" da skill servem de guia de conteúdo, não de formato do arquivo.',
      ].join('\n'),
      steps,
      appearance: (vt?.id ?? 'custom') as Skill['appearance'], routeId: route.id,
      aspect: (vt?.defaultAspect as Skill['aspect']) ?? '16:9', durationSec: vt?.defaultDurationSec ?? 60,
      language: input.language || 'pt-BR', presentation: base.steps.some((st) => st.kind === 'stock_media') ? 'mixed' : 'generated',
      outputStyle: `🔗 Importada de ${input.source.trim()} (plugin ${plugin.name}${plugin.license ? `, licença ${plugin.license}` : ''}).\n${description}`,
      plugins: [plugin.id],
    };
    skill = saveSkill(s, skill);

    /* refino opcional: a IA reescreve global/etapas a partir do SKILL.md (os ponteiros para as sub-skills ficam) */
    if (input.harness) {
      try {
        log(`refinando "${name}" com ${input.harness}${input.model ? '/' + input.model : ''}…`);
        const tmpMd = path.join(os.tmpdir(), `ff-skill-${id}.md`);
        const subs = Object.entries(steps).map(([k, v]) => `## ${k}\n${v}`).join('\n\n');
        fs.writeFileSync(tmpMd, `${md}\n\n# Sub-skills e referências disponíveis\n${subs}`);
        const r = await generateSkillFromDoc(s, { file: tmpMd, harness: input.harness, model: input.model, language: skill.language, routeId: route.id, name: `${name} (refino)` }, log, signal);
        fs.rmSync(tmpMd, { force: true });
        const merged: Record<string, string> = { ...r.skill.steps };
        for (const [k, v] of Object.entries(steps)) merged[k] = [merged[k], v].filter(Boolean).join('\n');
        skill = saveSkill(s, { ...skill, global: [skill.global, r.skill.global].filter(Boolean).join('\n\n'), steps: merged, reviewCriteria: r.skill.reviewCriteria ?? skill.reviewCriteria });
        deleteSkill(s, r.skill.id);
        warnings.push(...r.warnings);
      } catch (e) { warnings.push(`refino com IA falhou (a skill ficou com a conversão direta): ${(e as Error).message.slice(0, 200)}`); }
    }
    if (!Object.keys(skill.steps).length) warnings.push(`"${name}": nenhuma sub-skill reconhecida por etapa — o SKILL.md inteiro vale como diretriz geral (via plugin)`);
    out.skills.push(skill);
    log(`skill "${skill.name}" e rota "${route.name}" criadas (etapas: ${Object.keys(skill.steps).join(', ') || '—'})`);
  }
  if (skillDirs.length > 5) warnings.push(`o plugin tem ${skillDirs.length} skills; foram criadas as 5 primeiras`);
  return out;
}
