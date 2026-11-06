import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Binding, ExecutorBypass, Project, Route, Settings } from '../shared/types';
import { CATEGORY_OF, profileSkips } from '../shared/profiles';
import { getSkill } from './library';
import { readProject, saveProjectFile } from './ops';
import { projectDirOf, projectsDir } from './settings';

/*
 * Ferramentas para projetos JÁ existentes:
 *  - replanScenes: troca o plano de cenas (backup completo fora da pasta do projeto, roteiro mantido, cenas e
 *    artefatos por cena limpos, cache só do que vem antes do plano) e grava a duração média desejada por cena;
 *  - applyBypass: força um harness/modelo nas etapas de IA na hora de executar, sem mexer na rota gravada.
 */

export interface ReplanOptions {
  /** duração média de cada cena (s), 3–30; ausente = mantém a do projeto (ou o padrão da skill) */
  sceneSec?: number;
  /** atualiza a cópia da skill do projeto com a versão atual da biblioteca */
  refreshSkill?: boolean;
}
export interface ReplanResult { project: Project; backup: string; oldScenes: number; keptCache: number; scenePlanStep?: string }

/** Arquivos que pertencem ao plano de cenas (e a tudo o que é feito por cena). */
const PLAN_FILE = (rel: string) => rel === 'scenes.json' || /^scenes[\\/]/.test(rel) || /^kit[\\/]scenes[\\/]shots[\\/]/.test(rel);

export function replanScenes(s: Settings, id: string, o: ReplanOptions = {}): ReplanResult {
  const p = readProject(s, id);
  const dir = projectDirOf(s, id);
  const planStep = p.route?.steps.find((st) => st.kind === 'scene_plan' && st.enabled);
  if (!planStep) throw new Error('a rota deste projeto não tem a etapa "Planejar cenas"');
  if (!fs.existsSync(path.join(dir, 'script.md'))) throw new Error('o projeto ainda não tem roteiro (script.md): execute a rota primeiro');

  /* 1) backup FORA da pasta do projeto (as IAs não leem o plano antigo) e fora da lista de projetos */
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backup = path.join(projectsDir(s), '_backups', `${id}-${stamp}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const f of ['project.json', 'scenes.json']) if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(backup, f));
  const cacheFile = path.join(dir, 'cache', 'index.json');
  if (fs.existsSync(cacheFile)) fs.copyFileSync(cacheFile, path.join(backup, 'cache-index.json'));
  for (const [src, dst] of [['scenes', 'scenes'], [path.join('kit', 'scenes', 'shots'), 'kit-shots']] as const) {
    if (fs.existsSync(path.join(dir, src))) fs.cpSync(path.join(dir, src), path.join(backup, dst), { recursive: true });
  }

  /* 2) plano antigo fora; o que vem ANTES do plano (roteiro, brief, ideias, elenco) continua no cache */
  const oldScenes = p.scenes.length;
  fs.rmSync(path.join(dir, 'scenes.json'), { force: true });
  fs.rmSync(path.join(dir, 'scenes'), { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'kit', 'scenes', 'shots'), { recursive: true, force: true });
  let keptCache = 0;
  if (fs.existsSync(cacheFile)) {
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as Record<string, string[]>;
    const keep = Object.fromEntries(Object.entries(cache).filter(([, files]) => files.every((f) => !PLAN_FILE(path.relative(dir, f)))));
    keptCache = Object.keys(keep).length;
    fs.writeFileSync(cacheFile, JSON.stringify(keep, null, 2));
  }

  /* 3) projeto: sem cenas, duração por cena e (opcional) skill atual */
  p.scenes = [];
  if (o.sceneSec !== undefined) { if (o.sceneSec > 0) p.sceneSec = Math.round(Math.max(3, Math.min(30, o.sceneSec)) * 10) / 10; else delete p.sceneSec; }
  if (o.refreshSkill && p.skillId) { const k = getSkill(s, p.skillId); if (k) p.skill = JSON.parse(JSON.stringify(k)); }
  p.log = [...(p.log ?? []).slice(-700), `── ${new Date().toLocaleString('pt-BR')}: plano de cenas refeito (${oldScenes} cenas antigas; ${p.sceneSec ? `≈ ${p.sceneSec} s por cena` : 'duração da skill'}${o.refreshSkill ? '; skill atualizada' : ''}). Backup: ${backup} ──`];
  saveProjectFile(s, p);
  /* saveProjectFile espelha as cenas em scenes.json ("[]"): sem plano, o arquivo não deve existir */
  fs.rmSync(path.join(dir, 'scenes.json'), { force: true });
  return { project: p, backup, oldScenes, keptCache, scenePlanStep: planStep.id };
}

/** Etapas atingidas pelo bypass (só IA de texto/código; ferramentas internas, bancos e GPU local não mudam). */
export function bypassTargets(route: Route, bp: ExecutorBypass): string[] {
  return route.steps.filter((st) => {
    if (!st.enabled || profileSkips(st)) return false;
    const cat = CATEGORY_OF[st.kind];
    return bp.scope === 'ai' ? cat === 'text' || cat === 'code' : cat === bp.scope;
  }).map((st) => st.id);
}

/** Rota efetiva com o bypass (cópia): o executor escolhido vai à frente — ou sozinho, se exclusivo. */
export function applyBypass(route: Route, bp: ExecutorBypass | undefined): Route {
  const r: Route = JSON.parse(JSON.stringify(route));
  if (!bp?.enabled || bp.binding?.type !== 'harness') return r;
  const ids = new Set(bypassTargets(r, bp));
  const same = (b: Binding) => b.type === 'harness' && b.harness === bp.binding.harness && (b.model ?? '') === (bp.binding.model ?? '');
  for (const st of r.steps) {
    if (!ids.has(st.id)) continue;
    const head = JSON.parse(JSON.stringify(bp.binding)) as Binding;
    st.bindings = bp.exclusive ? [head] : [head, ...st.bindings.filter((b) => !same(b))];
  }
  return r;
}
