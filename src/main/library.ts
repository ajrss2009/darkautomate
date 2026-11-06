import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Agent, Aspect, CustomVideoType, NicheFold, Project, Route, RouteStep, Settings, Skill, StepKind } from '../shared/types';
import { BUILTIN_AGENTS } from './agents-builtin';
import { orderSteps } from './engine';
import { BUILTIN_TYPES, ROUTES } from './presets';
import { BUILTIN_SKILLS } from './skills-builtin';

export type LibKind = 'routes' | 'skills' | 'types' | 'agents' | 'folds';
const dirOf = (s: Settings, k: LibKind) => path.join(s.workspace, 'library', k);

export const slugify = (name: string): string =>
  name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

const SAFE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const fileOf = (s: Settings, k: LibKind, id: string) => {
  if (!SAFE.test(id)) throw new Error(`id inválido: "${id}"`);
  return path.join(dirOf(s, k), id + '.json');
};

function readAll<T extends { id: string }>(s: Settings, k: LibKind): T[] {
  const dir = dirOf(s, k);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try { return [JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T]; } catch { return []; }
  });
}
/**
 * Grava o item do usuário. Um id de item PADRÃO grava uma personalização: o arquivo do usuário
 * passa a valer no lugar do padrão (e sobrevive a atualizações do app); excluir restaura o padrão.
 */
function write<T extends { id: string; name: string }>(s: Settings, k: LibKind, item: T, _builtinIds: string[]): T {
  const id = item.id || slugify(item.name);
  if (!id) throw new Error('dê um nome');
  const clean = { ...item, id } as T;
  delete (clean as { builtin?: boolean }).builtin;
  delete (clean as { customized?: boolean }).customized;
  fs.mkdirSync(dirOf(s, k), { recursive: true });
  atomicWrite(fileOf(s, k, id), JSON.stringify(clean, null, 2));
  return clean;
}
function remove(s: Settings, k: LibKind, id: string, builtinIds: string[]) {
  const f = fileOf(s, k, id);
  if (!fs.existsSync(f)) throw new Error(builtinIds.includes(id) ? 'item padrão não pode ser excluído' : 'não encontrado');
  fs.rmSync(f);
}
/** Grava por arquivo temporário + troca: uma queda no meio não deixa a skill/rota corrompida. */
function atomicWrite(file: string, text: string) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); } catch { fs.copyFileSync(tmp, file); fs.rmSync(tmp, { force: true }); }
}
/** Padrões (com a personalização do usuário por cima, quando houver) + itens do usuário. */
function merged<T extends { id: string }>(builtins: T[], user: T[]): Array<T & { builtin?: boolean; customized?: boolean }> {
  const ids = new Set(builtins.map((b) => b.id));
  return [
    ...builtins.map((b) => { const o = user.find((u) => u.id === b.id); return o ? { ...o, builtin: true, customized: true } : { ...b, builtin: true }; }),
    ...user.filter((u) => !ids.has(u.id)),
  ];
}

const STEP_KINDS: StepKind[] = ['ideation', 'script', 'scene_plan', 'asset_design', 'image', 'video', 'code_scene', 'motion_graphics',
  'narration', 'music', 'sfx', 'subtitles', 'edit', 'review', 'thumbnail', 'metadata', 'publish', 'stock_media', 'transcribe', 'brief', 'free'];
export const ALL_STEP_KINDS = STEP_KINDS;

/** Valida estrutura da rota; devolve lista de erros legíveis (vazia = válida). */
export function validateRoute(r: Route): string[] {
  const errs: string[] = [];
  if (!r.name?.trim()) errs.push('a rota precisa de um nome');
  if (!Array.isArray(r.steps) || r.steps.length === 0) errs.push('a rota precisa de ao menos uma tarefa');
  const ids = new Set<string>();
  for (const st of r.steps ?? []) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(st.id ?? '')) errs.push(`id de tarefa inválido: "${st.id}"`);
    if (ids.has(st.id)) errs.push(`id de tarefa duplicado: "${st.id}"`);
    ids.add(st.id);
    if (!STEP_KINDS.includes(st.kind)) errs.push(`tarefa "${st.id}": tipo desconhecido "${st.kind}"`);
    if (st.scope !== 'project' && st.scope !== 'scene') errs.push(`tarefa "${st.id}": escopo inválido`);
    if (st.enabled && (!st.bindings || st.bindings.length === 0) && st.kind !== 'publish') errs.push(`tarefa "${st.id}": sem executor (adicione ao menos um)`);
    for (const b of st.bindings ?? []) {
      if (b.type === 'comfyui' && !b.workflow) errs.push(`tarefa "${st.id}": ComfyUI sem workflow`);
      if (b.type === 'wan2gp' && !b.template) errs.push(`tarefa "${st.id}": Wan2GP sem template`);
      if (b.type === 'api' && (!b.provider || !b.model)) errs.push(`tarefa "${st.id}": API sem provedor/modelo`);
      if (b.type === 'stock' && (!b.sources || b.sources.length === 0)) errs.push(`tarefa "${st.id}": banco de mídia sem fontes`);
    }
  }
  if (errs.length === 0) { try { orderSteps(r.steps as RouteStep[]); } catch (e) { errs.push((e as Error).message); } }
  return errs;
}

const builtinRouteIds = ROUTES.map((r) => r.id);
export const listRoutes = (s: Settings): Array<Route & { builtin?: boolean }> =>
  merged<Route>(ROUTES, readAll<Route>(s, 'routes'));
export const getAnyRoute = (s: Settings, id: string): Route | undefined => listRoutes(s).find((r) => r.id === id);
export function saveRoute(s: Settings, r: Route): Route {
  const errs = validateRoute(r);
  if (errs.length) throw new Error(errs.join('; '));
  return write(s, 'routes', { ...r, videoTypes: r.videoTypes ?? [], description: r.description ?? '' }, builtinRouteIds);
}
export const deleteRoute = (s: Settings, id: string) => remove(s, 'routes', id, builtinRouteIds);

const builtinSkillIds = BUILTIN_SKILLS.map((x) => x.id);
const skillDirOf = (s: Settings) => path.join(s.workspace, 'library', 'skills');
const skillFileOf = (s: Settings, id: string) => {
  if (!SAFE.test(id)) throw new Error(`id inválido: "${id}"`);
  return path.join(skillDirOf(s), id + '.md');
};

/* ───────── skills em Markdown (front-matter + seções) ───────── */

const yamlScalar = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.length ? `[${v.map(String).join(', ')}]` : undefined;
  const s = String(v);
  if (!s.includes('\n')) return /[:#\[\]{}",']/.test(s) ? JSON.stringify(s) : s;
  return undefined;
};

/** Serializa a skill como Markdown legível (front-matter YAML + seções). */
export function skillMarkdown(k: Skill): string {
  const lines: string[] = ['---'];
  const scalar: Array<[string, unknown]> = [
    ['name', k.name], ['description', k.description], ['appearance', k.appearance], ['routeId', k.routeId],
    ['aspect', k.aspect], ['durationSec', k.durationSec], ['language', k.language], ['presentation', k.presentation],
    ['mediaSources', k.mediaSources], ['mixSources', k.mixSources], ['previewMedia', k.previewMedia], ['thumbnailTemplate', k.thumbnailTemplate],
    ['freeform', k.freeform ? true : undefined],
    ['scriptEnding', k.scriptEnding], ['multiVoice', k.multiVoice ? true : undefined], ['reviewCriteria', k.reviewCriteria],
    ['plugins', k.plugins],
  ];
  for (const [key, value] of scalar) { const v = yamlScalar(value); if (v !== undefined) lines.push(`${key}: ${v}`); }
  if (k.outputStyle?.trim()) {
    lines.push('outputStyle: |-');
    for (const l of k.outputStyle.trim().split(/\r?\n/)) lines.push('  ' + l);
  }
  lines.push('---', '');
  lines.push('## Global', '', (k.global || '').trim() || '_(sem instruções gerais)_', '');
  for (const [id, text] of Object.entries(k.steps ?? {})) {
    if (!text?.trim()) continue;
    lines.push(`## Etapa: ${id}`, '', text.trim(), '');
  }
  return lines.join('\n');
}

export function parseFrontMatter(md: string): { meta: Record<string, unknown>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: md };
  const lines = m[1]!.split(/\r?\n/);
  const meta: Record<string, unknown> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!mm) continue;
    const key = mm[1]!; const raw = mm[2]!.trim();
    if (/^[|>][-+]?$/.test(raw)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s{2,}/.test(lines[i + 1]!) || lines[i + 1]!.trim() === '')) {
        block.push(lines[i + 1]!.replace(/^ {2}/, '')); i++;
      }
      meta[key] = (raw.startsWith('>') ? block.join(' ') : block.join('\n')).trim();
      continue;
    }
    if (raw.startsWith('[') && raw.endsWith(']')) {
      meta[key] = raw.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean);
      continue;
    }
    if (raw === 'true' || raw === 'false') { meta[key] = raw === 'true'; continue; }
    if (/^-?\d+(\.\d+)?$/.test(raw)) { meta[key] = Number(raw); continue; }
    if (raw.startsWith('"')) { try { meta[key] = JSON.parse(raw); continue; } catch { /* texto */ } }
    meta[key] = raw.replace(/^['"]|['"]$/g, '');
  }
  return { meta, body: md.slice(m[0].length) };
}

function parseSkillBody(body: string): { global: string; steps: Record<string, string> } {
  const steps: Record<string, string> = {};
  let global = '';
  for (const chunk of body.split(/^## +/m)) {
    const nl = chunk.indexOf('\n');
    const title = (nl >= 0 ? chunk.slice(0, nl) : chunk).trim();
    const text = (nl >= 0 ? chunk.slice(nl + 1) : '').replace(/^_\(sem instruções gerais\)_$/m, '').trim();
    if (!title) { if (text && !global) global = text; continue; }
    if (/^global$/i.test(title)) { global = text; continue; }
    const m = title.match(/^(?:etapa|step)\s*[:：]\s*(.+)$/i);
    if (m) steps[m[1]!.trim()] = text;
    else if (!global) global = text;
  }
  return { global, steps };
}

/** Lê uma skill em Markdown (ou JSON, formato antigo). */
export function parseSkillMarkdown(text: string, fallbackId?: string): Skill | undefined {
  const { meta, body } = parseFrontMatter(text);
  const name = String(meta.name ?? '').trim() || fallbackId?.trim();
  if (!name) return undefined;
  const parts = parseSkillBody(body);
  const k: Skill = {
    id: slugify(fallbackId || name) || 'skill', name,
    description: String(meta.description ?? ''), global: parts.global, steps: parts.steps,
  };
  if (meta.appearance) k.appearance = String(meta.appearance) as Skill['appearance'];
  if (meta.routeId) k.routeId = String(meta.routeId);
  if (meta.aspect) k.aspect = String(meta.aspect) as Skill['aspect'];
  if (meta.durationSec) k.durationSec = Number(meta.durationSec);
  if (meta.language) k.language = String(meta.language);
  if (meta.presentation === 'mixed' || meta.presentation === 'generated') k.presentation = meta.presentation;
  if (Array.isArray(meta.mediaSources) && meta.mediaSources.length) k.mediaSources = meta.mediaSources as Skill['mediaSources'];
  if (Array.isArray(meta.mixSources) && meta.mixSources.length) k.mixSources = meta.mixSources as Skill['mixSources'];
  if (meta.previewMedia) k.previewMedia = String(meta.previewMedia);
  if (meta.thumbnailTemplate) k.thumbnailTemplate = String(meta.thumbnailTemplate);
  if (meta.outputStyle) k.outputStyle = String(meta.outputStyle);
  if (meta.freeform === true) k.freeform = true;
  if (meta.scriptEnding === 'loop' || meta.scriptEnding === 'next' || meta.scriptEnding === 'conclusion') k.scriptEnding = meta.scriptEnding;
  if (meta.multiVoice === true) k.multiVoice = true;
  if (meta.reviewCriteria) k.reviewCriteria = String(meta.reviewCriteria);
  if (Array.isArray(meta.plugins) && meta.plugins.length) k.plugins = meta.plugins.map(String);
  else if (typeof meta.plugins === 'string' && meta.plugins.trim()) k.plugins = [meta.plugins.trim()];
  return k;
}

function readSkills(s: Settings): Skill[] {
  const dir = skillDirOf(s);
  if (!fs.existsSync(dir)) return [];
  const out: Skill[] = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    try {
      if (f.endsWith('.md')) {
        const k = parseSkillMarkdown(fs.readFileSync(full, 'utf8'), f.replace(/\.md$/i, ''));
        if (k) out.push(k);
      } else if (f.endsWith('.json')) {
        // migração: skills antigas em JSON passam a viver em Markdown
        const k = JSON.parse(fs.readFileSync(full, 'utf8')) as Skill;
        if (k?.name) {
          const id = (k.id || slugify(k.name)) as string;
          if (!builtinSkillIds.includes(id)) {
            const md = skillFileOf(s, id);
            if (!fs.existsSync(md)) fs.writeFileSync(md, skillMarkdown({ ...k, id }));
            fs.rmSync(full, { force: true });
          }
          out.push({ ...k, id });
        }
      }
    } catch { /* arquivo inválido: ignora */ }
  }
  return out;
}

export const listSkills = (s: Settings): Skill[] => merged<Skill>(BUILTIN_SKILLS, readSkills(s));
export const getSkill = (s: Settings, id: string) => listSkills(s).find((x) => x.id === id);
export function saveSkill(s: Settings, k: Skill): Skill {
  if (!k.name?.trim()) throw new Error('dê um nome à skill');
  const id = k.id || slugify(k.name);
  if (!id) throw new Error('dê um nome à skill');
  /* id de skill padrão = personalização do usuário (vale no lugar da padrão; excluir restaura) */
  const clean: Skill = { ...k, id, description: k.description ?? '', global: k.global ?? '', steps: k.steps ?? {} };
  delete (clean as { builtin?: boolean }).builtin;
  delete (clean as { customized?: boolean }).customized;
  fs.mkdirSync(skillDirOf(s), { recursive: true });
  atomicWrite(skillFileOf(s, id), skillMarkdown(clean));
  fs.rmSync(path.join(skillDirOf(s), id + '.json'), { force: true });   // remove o formato antigo
  return clean;
}
export const deleteSkill = (s: Settings, id: string) => {
  let removed = false;
  for (const f of [skillFileOf(s, id), path.join(skillDirOf(s), id + '.json')]) {
    if (fs.existsSync(f)) { fs.rmSync(f, { force: true }); removed = true; }
  }
  if (!removed) throw new Error(builtinSkillIds.includes(id) ? 'item padrão não pode ser excluído' : 'não encontrado');
};

const builtinAgentIds = BUILTIN_AGENTS.map((x) => x.id);
export const listAgents = (s: Settings): Agent[] => merged<Agent>(BUILTIN_AGENTS, readAll<Agent>(s, 'agents'));
export const getAgent = (s: Settings, id: string) => listAgents(s).find((x) => x.id === id);
export function saveAgent(s: Settings, a: Agent): Agent {
  if (!a.name?.trim()) throw new Error('dê um nome ao agente');
  if (a.role !== 'orchestrator' && a.role !== 'worker') throw new Error('papel inválido (orquestrador ou obreiro)');
  if (!a.instructions?.trim()) throw new Error('escreva as instruções do agente');
  const handles = (a.handles ?? []).filter((h) => typeof h === 'string' && h.trim());
  return write(s, 'agents', { ...a, description: a.description ?? '', handles: a.role === 'worker' ? handles : undefined, skills: a.skills ?? [] }, builtinAgentIds);
}
export const deleteAgent = (s: Settings, id: string) => remove(s, 'agents', id, builtinAgentIds);

const builtinTypeIds = BUILTIN_TYPES.map((x) => x.id);
export const listTypes = (s: Settings): CustomVideoType[] => merged<CustomVideoType>(BUILTIN_TYPES, readAll<CustomVideoType>(s, 'types'));
export const getType = (s: Settings, id: string) => listTypes(s).find((x) => x.id === id);
export function saveType(s: Settings, t: CustomVideoType): CustomVideoType {
  if (!t.name?.trim()) throw new Error('dê um nome ao tipo de vídeo');
  if (!getAnyRoute(s, t.routeId)) throw new Error(`rota "${t.routeId}" não existe`);
  if (!getSkill(s, t.skillId)) throw new Error(`skill "${t.skillId}" não existe`);
  return write(s, 'types', { ...t, mediaSources: t.mediaSources ?? [], presentation: t.presentation ?? 'generated' }, builtinTypeIds);
}
export const deleteType = (s: Settings, id: string) => remove(s, 'types', id, builtinTypeIds);

/* ───────── dobras de nicho (persistentes, uma pasta por dobra) ───────── */

/** Marcadores do bloco da dobra dentro de skill.global (idempotente). */
const FOLD_START = '<!-- dobra:start -->';
const FOLD_END = '<!-- dobra:end -->';

export const listFolds = (s: Settings): NicheFold[] =>
  readAll<NicheFold>(s, 'folds').sort((a, b) => Number(!!b.chosen) - Number(!!a.chosen) || (a.channel ?? '').localeCompare(b.channel ?? '') || a.name.localeCompare(b.name));
export const getFold = (s: Settings, id: string) => listFolds(s).find((f) => f.id === id);

export function saveFold(s: Settings, f: NicheFold): NicheFold {
  if (!f.name?.trim()) throw new Error('a dobra precisa de um título');
  if (!f.channel?.trim()) throw new Error('a dobra precisa de um canal');
  const prev = f.id ? getFold(s, f.id) : undefined;
  const item: NicheFold = {
    ...f,
    name: f.name.trim(),
    angle: f.angle?.trim() ?? '',
    status: f.status ?? prev?.status ?? 'idea',
    createdAt: prev?.createdAt ?? f.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return write(s, 'folds', item, []);
}

export const deleteFold = (s: Settings, id: string) => remove(s, 'folds', id, []);

/** Dobra ativa do canal: marca esta e desmarca as outras do mesmo canal. */
export function chooseFold(s: Settings, id: string): NicheFold[] {
  const target = getFold(s, id);
  if (!target) throw new Error(`dobra "${id}" não existe`);
  for (const f of listFolds(s)) {
    if (f.channel !== target.channel) continue;
    const chosen = f.id === id;
    if (!!f.chosen === chosen) continue;
    write(s, 'folds', { ...f, chosen, updatedAt: new Date().toISOString() }, []);
  }
  return listFolds(s);
}

/** Bloco de texto da dobra que entra em skill.global (o prompt de toda etapa lê isso). */
export function foldBlock(f: NicheFold): string {
  return [
    FOLD_START,
    `DOBRA DE NICHO ATIVA: ${f.name}`,
    `- Ângulo: ${f.angle || '—'}`,
    f.why ? `- Por que funciona: ${f.why}` : '',
    f.audience ? `- Público: ${f.audience}` : '',
    f.exampleTitles?.length ? `- Títulos de exemplo:\n${f.exampleTitles.slice(0, 5).map((t) => `  - ${t}`).join('\n')}` : '',
    FOLD_END,
  ].filter(Boolean).join('\n');
}

/** Aplica a dobra na skill: bloco em `global` (efeito real no prompt) + nota em `outputStyle`. */
export function applyFoldToSkill(s: Settings, foldId: string): { fold: NicheFold; skill: Skill } {
  const fold = getFold(s, foldId);
  if (!fold) throw new Error(`dobra "${foldId}" não existe`);
  if (!fold.skillId) throw new Error('esta dobra não está ligada a uma skill');
  const skill = getSkill(s, fold.skillId);
  if (!skill) throw new Error(`skill "${fold.skillId}" não existe`);
  const global = (skill.global ?? '').replace(new RegExp(`\\n?${FOLD_START}[\\s\\S]*?${FOLD_END}\\n?`, 'g'), '\n').trim();
  const nextGlobal = `${global}\n\n${foldBlock(fold)}`.trim();
  const note = `🔗 Dobra de nicho: ${fold.name} — ${fold.angle}`.slice(0, 400);
  const outputStyle = (skill.outputStyle ?? '').split(/\r?\n/).filter((l) => !l.startsWith('🔗')).concat(note).join('\n');
  const saved = saveSkill(s, { ...skill, global: nextGlobal, outputStyle });
  const updated = saveFold(s, { ...fold, skillId: saved.id, status: fold.status === 'idea' ? 'testing' : fold.status });
  return { fold: updated, skill: saved };
}

/** Contagem de projetos por dobra (métricas agregadas na leitura). */
export function foldsWithMetrics(folds: NicheFold[], projects: Array<{ id: string; createdAt: string; foldId?: string; production?: { runs?: unknown[] } }>): NicheFold[] {
  const byFold = new Map<string, Array<{ id: string; createdAt: string; production?: { runs?: unknown[] } }>>();
  for (const p of projects) if (p.foldId) byFold.set(p.foldId, [...(byFold.get(p.foldId) ?? []), p]);
  return folds.map((f) => {
    const list = byFold.get(f.id) ?? [];
    const last = list.map((p) => p.createdAt).sort().pop();
    return { ...f, metrics: { projects: list.length, lastUsedAt: last, renders: list.filter((p) => (p.production?.runs?.length ?? 0) > 0).length } };
  });
}

export interface FoldInput {
  channel: string; channelName?: string; sourceChannel?: string; sourceUrl?: string;
  skillId?: string; routeId?: string; language?: string; aspect?: Aspect;
  bends: Array<{ title: string; angle?: string; why?: string; audience?: string; exampleTitles?: string[] }>;
  chosen?: number;
  /** modelagem do formato (texto/visual/áudio/trilha) aplicada a todas as dobras do canal */
  model?: NicheFold['model'];
}

/**
 * Garante que as dobras de um canal existam como registros persistentes (idempotente).
 * Usado pelo clone e por clones antigos (result.json sem foldIds) — não sobrescreve
 * status/escolha já feitos pelo usuário.
 */
export function ensureFolds(s: Settings, o: FoldInput): NicheFold[] {
  const channel = o.channel?.trim() || 'canal';
  const existing = listFolds(s).filter((f) => f.channel === channel);
  const otherSubniches = (o.bends ?? []).map((b) => b?.title).filter((t): t is string => !!t);
  const out: NicheFold[] = [];
  for (const [i, b] of (o.bends ?? []).entries()) {
    if (!b?.title) continue;
    const wanted = `dobra-${channel}-${String(i + 1).padStart(2, '0')}`;
    const prev = existing.find((f) => f.name === b.title) ?? existing.find((f) => f.id === wanted);
    try {
      out.push(saveFold(s, {
        id: prev?.id ?? wanted, name: b.title, channel, channelName: o.channelName,
        sourceChannel: o.sourceChannel, sourceUrl: o.sourceUrl,
        angle: b.angle ?? '', why: b.why, audience: b.audience, exampleTitles: b.exampleTitles ?? [],
        language: o.language, aspect: o.aspect as NicheFold['aspect'], skillId: o.skillId ?? prev?.skillId, routeId: o.routeId ?? prev?.routeId,
        chosen: prev ? !!prev.chosen : i === (o.chosen ?? 0), status: prev?.status ?? 'idea',
        model: o.model ?? prev?.model, subniches: otherSubniches.filter((t) => t !== b.title),
        createdAt: prev?.createdAt ?? new Date().toISOString(), notes: prev?.notes,
      }));
    } catch { /* id inválido: ignora esta dobra */ }
  }
  return out;
}


/* ───────── importar / exportar (rotas em JSON, skills em Markdown) ───────── */

/** Id livre: se já existe (ou é padrão), acrescenta -2, -3… */
function freeId(exists: (id: string) => boolean, wanted: string): string {
  const base = slugify(wanted) || 'item';
  if (!exists(base)) return base;
  for (let n = 2; n < 200; n++) if (!exists(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}

export function exportRouteFile(s: Settings, id: string, dest: string): string {
  const r = getAnyRoute(s, id);
  if (!r) throw new Error(`rota "${id}" não existe`);
  const clean: Route & { builtin?: boolean } = JSON.parse(JSON.stringify(r));
  delete clean.builtin;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(clean, null, 2));
  return dest;
}

export function importRouteFile(s: Settings, file: string): Route {
  let j: Route;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')) as Route; } catch { throw new Error('arquivo não é um JSON válido'); }
  if (!j || !j.name || !Array.isArray(j.steps)) throw new Error('o JSON não parece uma rota do FilmForge (campos name/steps)');
  const id = freeId((x) => !!getAnyRoute(s, x), j.id || j.name);
  return saveRoute(s, { ...j, id, description: j.description ?? '', videoTypes: j.videoTypes ?? [] });
}

export function exportSkillFile(s: Settings, id: string, dest: string): string {
  const k = getSkill(s, id);
  if (!k) throw new Error(`skill "${id}" não existe`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, skillMarkdown(k));
  return dest;
}

export function importSkillFile(s: Settings, file: string): Skill {
  const text = fs.readFileSync(file, 'utf8');
  const base = path.basename(file).replace(/\.(md|markdown|json)$/i, '');
  const parsed = /\.json$/i.test(file)
    ? (JSON.parse(text) as Skill)
    : parseSkillMarkdown(text, base);
  if (!parsed?.name) throw new Error('a skill precisa de um nome (front-matter `name:` ou campo "name" no JSON)');
  const id = freeId((x) => !!getSkill(s, x), parsed.id || parsed.name);
  return saveSkill(s, { ...parsed, id });
}

/** Exporta todas as rotas/skills do usuário para uma pasta (backup). */
export function exportLibrary(s: Settings, kind: 'routes' | 'skills', dir: string): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  if (kind === 'routes') {
    for (const r of listRoutes(s).filter((x) => !x.builtin || (x as { customized?: boolean }).customized)) out.push(exportRouteFile(s, r.id, path.join(dir, `${r.id}.json`)));
  } else {
    for (const k of listSkills(s).filter((x) => !x.builtin || (x as { customized?: boolean }).customized)) out.push(exportSkillFile(s, k.id, path.join(dir, `${k.id}.md`)));
  }
  return out;
}
