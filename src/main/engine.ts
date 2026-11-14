import * as fs from 'node:fs';
import { shotDurations, shotsWanted } from './free-shots';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type {
  Binding, EngineEvent, Project, Route, RouteStep, Scene, Settings,
} from '../shared/types';
import { bindingLabel, termsText } from '../shared/types';
import { AUTO_ORDER, abortMessage, isHttpHarness, resolveHarness, resolveHarnessCommand } from './harness';
import { duration as probeDuration } from './ffmpeg';
import { autoCast, splitSpeakerTag } from './cast';
import { syncBibleToLibrary } from './characters';
import { CODE_SCENE_MIN_SEC, isCastStory, isLongCodeVideo, isLyricVideo, isMusicClip, mergeShortCodeScenes, routeSceneKinds } from './prompts';
import { pluginsRoot } from './plugins';
import { stepTimeoutSec } from './timeouts';
import { applyPicks, candidatePlan, needsApproval, readPicks, sketchIntent, writeStoryboard } from './project-storyboard';
import { estimateSpeechSec, h3Mode, isH3Video, isH3Voice, normalizeEmotion } from './speech-emotion';
import { applySkillMix } from './skill-mix';

export interface ExecContext {
  project: Project;
  projectDir: string;
  step: RouteStep;
  binding: Binding;
  scene?: Scene;
  sceneDir?: string;
  outDir: string;
  settings: Settings;
  signal: AbortSignal;
  log: (line: string) => void;
}
export interface ExecResult { files: string[]; data?: unknown }
export type Executor = (ctx: ExecContext) => Promise<ExecResult>;

export interface EngineDeps {
  executors: Partial<Record<Binding['type'], Executor>>;
  settings: Settings;
  emit: (e: EngineEvent) => void;
  sleep?: (ms: number) => Promise<void>;
  approve?: (stepId: string, sceneId?: string) => Promise<boolean>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Limita quantas execuções de uma mesma etapa rodam ao mesmo tempo. */
export function semaphore(n: number) {
  let active = 0; const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    while (active >= n) await new Promise<void>((r) => queue.push(r));
    active++;
    try { return await fn(); } finally { active--; queue.shift()?.(); }
  };
}
/**
 * Fila única por servidor de modelo local (Ollama, llama.cpp, LM Studio em localhost), compartilhada por todos os
 * projetos do lote: o servidor atende um pedido por vez na mesma GPU, e o tempo esperando na fila não conta no timeout.
 */
const localModelQueues = new Map<string, { busy: boolean; waiting: Array<() => void> }>();
export function localModelKey(command: string): string | undefined {
  try {
    const u = new URL(command.trim());
    return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(u.hostname) ? `${u.hostname}:${u.port}` : undefined;
  } catch { return undefined; }
}
export async function acquireLocalModel(key: string, signal: AbortSignal, onWait: () => void): Promise<() => void> {
  let q = localModelQueues.get(key);
  if (!q) localModelQueues.set(key, q = { busy: false, waiting: [] });
  const queue = q;
  if (queue.busy) {
    onWait();
    await new Promise<void>((resolve, reject) => {
      const go = () => { signal.removeEventListener('abort', stop); resolve(); };
      const stop = () => { const i = queue.waiting.indexOf(go); if (i >= 0) queue.waiting.splice(i, 1); reject(new Error('cancelado')); };
      queue.waiting.push(go);
      signal.addEventListener('abort', stop, { once: true });
    });
  }
  queue.busy = true;
  let released = false;
  return () => {
    if (released) return; released = true;
    const next = queue.waiting.shift();
    if (next) next(); else queue.busy = false;
  };
}

/** GPU local (ComfyUI/Wan2GP) processa uma cena por vez por padrão; APIs e harnesses acompanham as cenas simultâneas. */
/**
 * Etapas de áudio (narração e transcrição) de um bloco de etapas de cena que podem rodar antes das outras:
 * só as que dependem, dentro do bloco, de outras etapas de áudio (nunca de imagem/vídeo/código).
 */
export function splitAudio(block: RouteStep[]): { audio: RouteStep[]; rest: RouteStep[] } {
  const ids = new Set<string>();
  const audio: RouteStep[] = [];
  for (const st of block) {
    const inBlock = st.dependsOn.filter((d) => block.some((b) => b.id === d));
    if ((st.kind === 'narration' || st.kind === 'transcribe') && inBlock.every((d) => ids.has(d))) { audio.push(st); ids.add(st.id); }
  }
  return { audio, rest: block.filter((st) => !ids.has(st.id)) };
}

/**
 * Falha que não muda tentando de novo no MESMO executor: timeout de harness/API (o agente travou ou é lento demais),
 * modelo inexistente na conta e chave de API ausente. GPU local (ComfyUI/Wan2GP) continua com novas tentativas
 * (fila cheia e falta de VRAM costumam passar).
 */
export function isPersistentFailure(reason: string, b: Binding, agentTimeouts = 0, settings?: Settings): boolean {
  if (/invalid model selection|not recognized as a known model|não existe nesta conta|sem chave de API/i.test(reason)) return true;
  if (!/^timeout \(/.test(reason)) return false;
  if (b.type === 'api') return true;
  if (b.type !== 'harness') return false;
  /* agente de linha de comando (OpenCode, Claude, Codex…): o que ele gravou fica na pasta, então 1 nova rodada continua dali */
  const cfg = b.harness !== 'auto' ? settings?.harnesses?.[b.harness] : undefined;
  return (cfg ? isHttpHarness(cfg) : false) || agentTimeouts > 1;
}

const isLocalGpu = (st: RouteStep) => st.bindings[0]?.type === 'comfyui' || st.bindings[0]?.type === 'wan2gp';

export const sceneDirOf = (projectDir: string, scene: Scene) => path.join(projectDir, 'scenes', scene.id);

/** Ordem topológica estável respeitando dependsOn. */
export function orderSteps(steps: RouteStep[]): RouteStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const out: RouteStep[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (s: RouteStep) => {
    const st = state.get(s.id);
    if (st === 2) return;
    if (st === 1) throw new Error(`Ciclo de dependências na etapa "${s.id}"`);
    state.set(s.id, 1);
    for (const d of s.dependsOn) {
      const dep = byId.get(d);
      if (!dep) throw new Error(`Etapa "${s.id}" depende de "${d}", que não existe`);
      visit(dep);
    }
    state.set(s.id, 2);
    out.push(s);
  };
  steps.forEach(visit);
  return out;
}

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}
function writeJsonAtomic(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  /* drives sincronizados/cópias podem negar rename/delete de arquivos existentes:
     nesse caso, sobrescreve no lugar (copyFile) em vez de falhar. */
  try { fs.renameSync(tmp, file); }
  catch { fs.copyFileSync(tmp, file); fs.rmSync(tmp, { force: true }); }
}

/**
 * Projeto visto pelas etapas de UMA cena: skill e plugins trocados na regeneração ("regenerar com outra skill/plugin")
 * valem só para ela. Sem troca, o próprio projeto. Função pura.
 */
export function sceneProject(project: Project, scene?: Scene): Project {
  if (!scene || (!scene.skillOverride && !scene.pluginsOverride)) return project;
  return { ...project, ...(scene.skillOverride ? { skill: scene.skillOverride } : {}), ...(scene.pluginsOverride ? { plugins: scene.pluginsOverride } : {}) };
}

export function cacheKey(project: Project, step: RouteStep, binding: Binding, scene?: Scene): string {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify({
    kind: step.kind, binding, params: step.params, quality: project.quality,
    memories: project.memories, vt: project.videoType, aspect: project.aspect,
    idea: step.scope === 'project' ? project.idea : undefined,
    // campos novos só entram na chave quando existem (projetos antigos mantêm o cache)
    styles: project.scriptStyle || project.videoStyle ? { s: project.scriptStyle, v: project.videoStyle } : undefined,
    refs: project.refScript || project.refVideo ? { s: project.refScript?.file, v: project.refVideo?.file } : undefined,
    agents: project.agents ? { o: project.agents.orchestrator?.id, w: project.agents.workers.map((w) => w.id) } : undefined,
    scene: scene ? { n: scene.narration, v: scene.visualIntent, k: scene.kind, d: step.kind === 'narration' ? undefined : scene.durationSec, notes: scene.notes, var: scene.variation, c: scene.camera, sp: scene.speaker } : undefined,
    sfx: step.kind === 'sfx' && scene && (scene.sfx?.length || scene.sfxCues?.length) ? { a: scene.sfx, b: scene.sfxCues } : undefined,
    /* trilha e volumes (edit): mudar um slider muda a chave e a montagem é refeita na próxima execução */
    mix: step.kind === 'edit' ? (() => {
      const m = { n: project.narrationVolume, mu: project.musicVolume, x: project.sfxVolume,
        tn: project.tracks?.narration?.muted || undefined, tm: project.tracks?.music?.muted || undefined, tx: project.tracks?.sfx?.muted || undefined };
      return Object.values(m).some((v) => v !== undefined) ? m : undefined;
    })() : undefined,
    nv: step.kind === 'narration' && project.narrationVoice ? project.narrationVoice : undefined,
    cast: step.kind === 'narration' && scene?.speaker && project.cast?.length ? project.cast.find((m) => m.speaker === scene.speaker) : undefined,
    /* skill/plugins trocados só nesta cena: outra chave (a cena é refeita com eles) */
    so: scene?.skillOverride ? scene.skillOverride.id : undefined, po: scene?.pluginsOverride,
  }));
  return h.digest('hex').slice(0, 24) + (scene ? '-' + scene.id : '');
}

/** scenes.json em cache mas sem cenas não vale como "plano pronto" (refaz a etapa). */
function emptyPlan(step: RouteStep, files: string[]): boolean {
  if (step.kind !== 'scene_plan') return false;
  const f = files.find((x) => /scenes\.json$/i.test(x));
  if (!f) return false;
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return !Array.isArray(j) || j.length === 0; } catch { return true; }
}

export function saveProject(projectDir: string, project: Project) {
  writeJsonAtomic(path.join(projectDir, 'project.json'), project);
}

export interface RunOptions {
  project: Project;
  route: Route;
  projectDir: string;
  deps: EngineDeps;
  signal: AbortSignal;
  /** prazo esgotando: nenhuma cena/etapa nova começa, o que já roda termina (`signal` ainda corta tudo) */
  drain?: AbortSignal;
  /** executa só estas etapas (e, para cenas, só estas cenas) */
  only?: { stepIds?: string[]; sceneIds?: string[] };
  noCache?: boolean;
}

export async function runRoute(opts: RunOptions): Promise<{ ok: boolean; error?: string }> {
  const { project, route, projectDir, deps, signal } = opts;
  const emit = deps.emit;
  /** cancelada ou drenando: não começa trabalho novo */
  const stopping = () => signal.aborted || !!opts.drain?.aborted;
  const stopMessage = () => abortMessage(signal.aborted || !opts.drain ? signal : opts.drain, 'Execução cancelada');
  /** sem reserva: só o primeiro executor de cada etapa; a falha aparece como está */
  const noFallback = route.noFallback ?? project.route?.noFallback ?? deps.settings.noFallback ?? false;

  /* Tipos de cena que esta rota realmente consegue produzir. Se o planejador
     escolher um tipo sem etapa (ex.: "motion" numa rota só com imagem), a cena
     virava um segmento preto; aqui ela é convertida para um tipo disponível. */
  const producible = new Set<string>();
  const producers: Array<{ kind: Scene['kind']; only?: string[] }> = [];
  const addProducer = (kind: Scene['kind'], st: RouteStep) => {
    producible.add(kind);
    producers.push({ kind, only: st.onlySceneKinds });
  };
  for (const st of route.steps ?? []) {
    if (!st.enabled) continue;
    if (st.kind === 'code_scene') addProducer('code', st);
    if (st.kind === 'motion_graphics') addProducer('motion', st);
    if (st.kind === 'stock_media') addProducer('stock', st);
    if (st.kind === 'image') addProducer('image', st);
    if (st.kind === 'video') addProducer('video', st);
  }
  if (producible.has('stock') && (producible.has('code') || producible.has('motion'))) producible.add('mixed');
  const fallbackKind = (['stock', 'code', 'image', 'video', 'motion', 'mixed'] as const).find((k) => producible.has(k));
  const STOP = new Set('a o as os de da do das dos em no na nos nas por para que e é um uma uns umas com ao à aos às se como porque sobre the of and to in on at for a an is are'.split(' ').filter(Boolean));
  const keywords = (text: string) => {
    const words = text.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
    return [...new Set(words)].slice(0, 6).join(' ');
  };
  const fitKinds = () => {
    for (const sc of project.scenes) {
      if (!sc.searchTerms && (sc.kind === 'stock' || sc.kind === 'mixed' || sc.kind === 'image' || sc.kind === 'video')) {
        sc.searchTerms = keywords(`${sc.title} ${sc.visualIntent}`) || undefined;
      }
      if (!fallbackKind || producible.has(sc.kind)) continue;
      /* só converte para uma etapa que aceite a cena original; respeita o
         filtro onlySceneKinds (ex.: etapa stock limitada a stock/mixed não
         deve capturar uma cena de código). */
      const candidates = producers.filter((p) => !p.only || p.only.includes(sc.kind));
      const pick = candidates.find((p) => p.kind === fallbackKind) ?? candidates[0];
      if (!pick || pick.kind === sc.kind) continue;
      emit({ t: 'log', line: `cena ${sc.id}: tipo "${sc.kind}" não tem etapa nesta rota → usando "${pick.kind}"` });
      sc.kind = pick.kind;
    }
  };
  emit({ t: 'run.start', projectId: project.id });
  const cachePath = path.join(projectDir, 'cache', 'index.json');
  const cache = readJson<Record<string, string[]>>(cachePath, {});
  const outDir = path.join(projectDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fitKinds();

  /* ── progresso / ETA (por cenas ou por entregáveis) ──────────────── */
  const t0 = Date.now();
  let lastEmit = 0, labelNow = '';
  let mode: 'scenes' | 'deliverables' = 'deliverables';
  const finishedProject = new Set<string>();     // etapas de escopo projeto concluídas
  let planRef: { ordered: RouteStep[]; active: (st: RouteStep) => boolean } | null = null;
  /* fala do MiniMax H3: cenas cujo vídeo não trouxe fala voltam para a narração por TTS */
  const ttsFallback = new Set<string>();
  const h3VideoRoute = () => (planRef?.ordered ?? route.steps).some((st) => st.enabled && st.kind === 'video' && isH3Video(st.bindings[0]));
  /* fala no vídeo: opção do projeto com H3 na rota, ou o 1º executor de vídeo é um H3 com voz clonada */
  /* só no modo CLONAGEM a voz sai do vídeo (o TTS fica de reserva); na DUBLAGEM (padrão) o TTS roda e o H3 dubla os lábios */
  const speechInVideo = () => h3Mode(project) !== 'dub' &&
    ((!!project.h3Speech && h3VideoRoute()) || (planRef?.ordered ?? route.steps).some((st) => st.enabled && st.kind === 'video' && isH3Voice(st.bindings[0])));
  const sceneHasAudio = (sc: Scene) => { try { return fs.readdirSync(path.join(sceneDirOf(projectDir, sc), 'audio')).some((f) => f.startsWith('narration.') && !f.includes('.trim')); } catch { return false; } };
  const plannedScenes = () => project.scenes.filter((s) => !opts.only?.sceneIds || opts.only.sceneIds.includes(s.id));

  /** Etapas de cena que valem para esta cena. */
  const sceneStepsOf = (sc: Scene) => (planRef?.ordered ?? []).filter((st) =>
    planRef!.active(st) && st.scope === 'scene' && (!st.onlySceneKinds || st.onlySceneKinds.includes(sc.kind)));
  /** Cena "entregue": todas as etapas de cena terminaram (ok, pulada ou falha). */
  const sceneComplete = (sc: Scene) => {
    const sts = sceneStepsOf(sc);
    if (!sts.length) return false;
    return sts.every((st) => {
      const v = sc.status?.[st.id];
      return v === 'done' || v === 'skipped' || v === 'failed';
    });
  };
  /** Progresso atual: cenas (projeto com cenas) ou entregáveis (sem cenas). */
  function progressSnapshot(): { done: number; total: number } {
    const ordered = planRef?.ordered ?? [];
    const projectSteps = ordered.filter((st) => planRef!.active(st) && st.scope === 'project');
    const scs = plannedScenes();
    if (scs.length > 0) {
      mode = 'scenes';
      const doneScenes = scs.filter(sceneComplete).length;
      const doneProj = projectSteps.filter((st) => finishedProject.has(st.id)).length;
      return { done: doneScenes + doneProj, total: scs.length + projectSteps.length };
    }
    mode = 'deliverables';
    const doneProj = projectSteps.filter((st) => finishedProject.has(st.id)).length;
    return { done: doneProj, total: Math.max(projectSteps.length, 1) };
  }
  function emitProgress(force = false) {
    const now = Date.now();
    if (!force && now - lastEmit < 400) return;
    lastEmit = now;
    const { done, total } = progressSnapshot();
    const elapsedMs = now - t0;
    const etaMs = done > 0 && total > done ? Math.max(0, Math.round((elapsedMs / done) * (total - done))) : 0;
    emit({ t: 'run.progress', mode, done: Math.min(done, total), total, elapsedMs, etaMs, label: labelNow || undefined });
  }
  const markDone = (label?: string) => { if (label) labelNow = label; emitProgress(); };

  /* quantas cenas ao mesmo tempo: do projeto ou o padrão das configurações */
  const concScenes = Math.max(0, Math.min(8, Math.round(project.sceneConcurrency ?? deps.settings.defaults?.sceneConcurrency ?? 0)));
  /* narrar todas as cenas antes dos clipes: do projeto ou o padrão das configurações (ligado) */
  const audioFirst = project.audioFirst ?? deps.settings.defaults?.audioFirst ?? true;

  try {
    const ordered = orderSteps(route.steps);
    const active = (st: RouteStep) => st.enabled && (!opts.only?.stepIds || opts.only.stepIds.includes(st.id));
    planRef = { ordered, active };
    emitProgress(true);
    await preflight(ordered, active);
    for (let si = 0; si < ordered.length; si++) {
      const step = ordered[si]!;
      if (stopping()) throw new Error(stopMessage());
      if (!active(step)) continue;
      if (step.scope === 'scene' && concScenes > 0) {
        // cenas simultâneas: cada cena percorre as etapas de cena consecutivas sem esperar as outras
        const block: RouteStep[] = [step];
        while (si + 1 < ordered.length) {
          const nx = ordered[si + 1]!;
          if (active(nx) && nx.scope !== 'scene') break;
          si++; if (active(nx)) block.push(nx);
        }
        /* narrar primeiro: narração + transcrição de TODAS as cenas (em paralelo), depois os clipes.
           Áudio é rápido, a duração total aparece logo e a GPU local não alterna entre modelo de voz e de vídeo a cada cena. */
        const { audio, rest } = audioFirst ? splitAudio(block) : { audio: [], rest: block };
        if (audio.length && rest.length) {
          emit({ t: 'log', line: `narrar primeiro: ${audio.map((b) => b.id).join(' + ')} de todas as cenas, depois ${rest.map((b) => b.id).join(' → ')}` });
          await runScenePipeline(audio, concScenes);
          await runScenePipeline(rest, concScenes);
        } else await runScenePipeline(block, concScenes);
      } else if (step.scope === 'project') {
        emit({ t: 'step.queued', stepId: step.id });
        const r = await runUnit(step, undefined);
        finishedProject.add(step.id);
        markDone(step.id);
        if (!r.ok && (step.onFail ?? 'stop') === 'stop' && !step.optional) {
          throw new Error(`Etapa "${step.id}" falhou: ${r.reason}`);
        }
        // cache-hit não recarrega: preserva edições manuais e status das cenas
        if (r.ok && step.kind === 'scene_plan' && (!r.cached || project.scenes.length === 0)) {
          loadScenes();
          /* plano vazio com etapas por cena na rota: parar já (antes, seguia até a montagem e falhava minutos depois) */
          if (project.scenes.length === 0 && ordered.some((st) => active(st) && st.scope === 'scene')) {
            throw new Error('o plano de cenas ficou vazio (scenes.json sem cenas) — execute de novo para refazer o plano');
          }
          fitKinds();
          /* várias skills: cada cena recebe a dela pela cota de tempo (blocos ou intercaladas) */
          const shares = applySkillMix(project);
          if (shares) emit({ t: 'log', stepId: step.id, line: `skills por cena: ${(project.skillMix?.items ?? []).map((m) => `${m.name} ${shares[m.skillId] ?? 0}% (pedido ${m.pct}%)`).join(' · ')}` });
          emitProgress(true);      // as cenas apareceram: o progresso passa a ser por cenas
        }
        /* história com elenco: a bíblia e as falas definem o elenco (uma voz distinta por personagem) */
        /* bíblia (agente de elenco/cenografia): os itens criados vão para a BIBLIOTECA e ficam ligados ao projeto */
        if (r.ok && step.kind === 'asset_design') {
          try {
            const n = syncBibleToLibrary(deps.settings, project, projectDir, (line) => emit({ t: 'log', stepId: step.id, line }));
            if (n.created || n.linked) {
              saveProject(projectDir, project);
              emit({ t: 'log', stepId: step.id, line: `biblioteca: ${n.characters} personagem(ns), ${n.locations} cenário(s), ${n.props} objeto(s) — ${n.created} novo(s) para reutilizar` });
              if (n.warnings.length) emit({ t: 'log', stepId: step.id, line: `biblioteca: ${n.warnings.slice(0, 3).join('; ')}` });
            }
          } catch (e) { emit({ t: 'log', stepId: step.id, line: `biblioteca: não consegui salvar os itens (${(e as Error).message.slice(0, 160)})` }); }
        }
        if (r.ok && (step.kind === 'scene_plan' || step.kind === 'asset_design') && isCastStory(project)) fillCast();
        /* storyboard: depois do plano de cenas (também em cache), e aprovação do usuário se pedida */
        if (r.ok && step.kind === 'scene_plan' && project.storyboard?.enabled && project.scenes.length) await storyboardGate();
      } else {
        const scenes = project.scenes.filter((s) =>
          (!opts.only?.sceneIds || opts.only.sceneIds.includes(s.id)) &&
          (!step.onlySceneKinds || step.onlySceneKinds.includes(s.kind)));
        const conc = Math.max(1, step.concurrency ?? 1);
        let idx = 0;
        let failure: string | undefined;
        const worker = async () => {
          while (idx < scenes.length && !failure && !stopping()) {
            const scene = scenes[idx++]!;
            emit({ t: 'step.queued', stepId: step.id, sceneId: scene.id });
            const r = await runUnit(step, scene);
            markDone(`${step.id} · ${scene.id}`);
            /* vídeo que falhou também passa: com a fala no vídeo, a cena precisa da narração por TTS */
            if (r.ok || step.kind === 'video') await afterStep(step, scene);
            if (!r.ok && (step.onFail ?? 'stop') === 'stop' && !step.optional) {
              failure = `Cena ${scene.index} · etapa "${step.id}" falhou: ${r.reason}`;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, scenes.length)) }, worker));
        if (stopping()) throw new Error(stopMessage());
        if (failure) throw new Error(failure);
      }
      saveProject(projectDir, project);
    }
    emitProgress(true);
    emit({ t: 'run.done', ok: true });
    return { ok: true };
  } catch (e) {
    const error = (e as Error).message;
    emit({ t: 'run.done', ok: false, error });
    return { ok: false, error };
  } finally {
    /* cena interrompida (cancelamento/prazo) não fica "em execução" para sempre: volta a pendente */
    for (const sc of project.scenes) {
      for (const [k, v] of Object.entries(sc.status ?? {})) if (v === 'running') sc.status[k] = 'pending';
    }
    saveProject(projectDir, project);
  }

  /**
   * Storyboard do plano de cenas (out/storyboard.html). Com aprovação: pausa até o usuário responder na tela
   * (deps.approve) — sem quem aprove (lote/MCP), para com a mensagem e a aprovação feita depois vale na próxima execução.
   */
  async function storyboardGate() {
    applyPicks(project.scenes, readPicks(projectDir));
    const want = candidatePlan(project.storyboard);
    if ((want.sketch || want.frame) && needsApproval(project)) await makeCandidates(want);
    const { board, html } = writeStoryboard(project, projectDir);
    emit({ t: 'log', stepId: 'storyboard', line: `🎞 storyboard: ${board.panels.length} quadros (${Math.round(board.totalSec)} s) → ${path.relative(projectDir, html)}` });
    if (!needsApproval(project)) return;
    if (!deps.approve) throw new Error('storyboard aguardando aprovação: abra o projeto, aprove o storyboard e execute de novo');
    emit({ t: 'gate.waiting', stepId: 'storyboard', storyboard: html });
    const ok = await deps.approve('storyboard');
    if (!ok) throw new Error('storyboard reprovado pelo usuário: ajuste as cenas no editor (ou refaça o plano) e execute de novo');
    applyPicks(project.scenes, readPicks(projectDir));
    const chosen = project.scenes.filter((s) => s.firstFrame).length, sk = project.scenes.filter((s) => s.sketch).length;
    project.storyboard = { ...project.storyboard!, approvedHash: board.hash, approvedAt: new Date().toISOString() };
    emit({ t: 'log', stepId: 'storyboard', line: `✓ storyboard aprovado${chosen || sk ? ` (${chosen} quadro(s) inicial(is) e ${sk} esboço(s) escolhidos)` : ''} — seguindo para a produção das cenas` });
    saveProject(projectDir, project);
  }

  /** Gera as opções de cada cena (esboço em traço e/ou quadro inicial) com a etapa de imagem da rota. */
  async function makeCandidates(want: { sketch: number; frame: number }) {
    const imgStep = (planRef?.ordered ?? route.steps).find((st) => st.enabled && st.kind === 'image' && st.bindings.length);
    if (!imgStep) { emit({ t: 'log', stepId: 'storyboard', line: 'storyboard: a rota não tem etapa de imagem — sem opções de esboço/quadro para escolher' }); return; }
    emit({ t: 'log', stepId: 'storyboard', line: `🎨 storyboard: gerando ${[want.sketch && `${want.sketch} esboço(s)`, want.frame && `${want.frame} quadro(s) inicial(is)`].filter(Boolean).join(' e ')} por cena com ${bindingLabel(imgStep.bindings[0]!)}…` });
    for (const sc of [...project.scenes].sort((a, b) => a.index - b.index)) {
      if (stopping()) throw new Error(stopMessage());
      const codeOnly = sc.kind === 'code' || sc.kind === 'motion';
      for (const kind of ['sketch', 'frame'] as const) {
        const n = kind === 'frame' && codeOnly ? 0 : want[kind];
        const list = (sc.candidates?.[kind] ?? []).filter((f) => fs.existsSync(path.join(projectDir, f)));
        for (let i = list.length; i < n; i++) {
          const rel = await oneCandidate(imgStep, sc, kind, i);
          if (!rel) break;
          list.push(rel);
        }
        if (list.length) sc.candidates = { ...(sc.candidates ?? {}), [kind]: list };
      }
      saveProject(projectDir, project);
    }
  }
  async function oneCandidate(step: RouteStep, sc: Scene, kind: 'sketch' | 'frame', i: number): Promise<string | undefined> {
    const dir = path.join(sceneDirOf(projectDir, sc), 'candidates');
    const tmp = path.join(dir, `tmp-${kind}-${i}`);
    fs.mkdirSync(tmp, { recursive: true });
    const scene: Scene = { ...sc, visualIntent: kind === 'sketch' ? sketchIntent(sc) : sc.visualIntent, variation: (sc.variation ?? 0) + 101 + i + (kind === 'sketch' ? 50 : 0), firstFrame: undefined, status: {}, artifacts: {} };
    try {
      for (const b of step.bindings) {
        const exec = deps.executors[b.type];
        if (!exec || signal.aborted) continue;
        try {
          const r = await exec({ project: sceneProject(project, sc), projectDir, step, binding: b, scene, sceneDir: tmp, outDir: path.join(projectDir, 'out'), settings: deps.settings, signal,
            log: (line) => emit({ t: 'log', stepId: 'storyboard', sceneId: sc.id, line }) });
          const img = r.files.find((f) => /\.(png|jpe?g|webp)$/i.test(f) && fs.existsSync(f));
          if (!img) continue;
          const name = `${kind}-${i + 1}${path.extname(img).toLowerCase()}`;
          fs.copyFileSync(img, path.join(dir, name));
          emit({ t: 'log', stepId: 'storyboard', sceneId: sc.id, line: `cena ${sc.index}: ${kind === 'sketch' ? 'esboço' : 'quadro'} ${i + 1} pronto` });
          return path.relative(projectDir, path.join(dir, name)).split(path.sep).join('/');
        } catch (e) { emit({ t: 'log', stepId: 'storyboard', sceneId: sc.id, line: `cena ${sc.index}: ${bindingLabel(b)} falhou (${(e as Error).message.slice(0, 160)})` }); }
      }
      return undefined;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  /**
   * Pré-checagem: qual harness/modelo cada etapa vai usar (resolve "auto") e se
   * está tudo instalado. Não bloqueia a execução — só informa.
   */
  async function preflight(ordered: RouteStep[], active: (st: RouteStep) => boolean) {
    try {
      const steps: Array<{ id: string; kind: string; label: string; binding: string; harness?: string; model?: string; ok?: boolean; note?: string }> = [];
      for (const st of ordered) {
        if (!active(st)) continue;
        const b = st.bindings?.[0];
        const item: (typeof steps)[number] = { id: st.id, kind: st.kind, label: st.label, binding: b ? bindingLabel(b) : '(sem executor)', ok: true };
        if (b?.type === 'harness') {
          try {
            const r = await resolveHarness(deps.settings, { type: 'harness', harness: b.harness, model: b.model }, (route ?? project.route)?.harnessFallback);
            item.harness = r.id;
            item.model = r.model || r.cfg.defaultModel || '(padrão)';
            if (isHttpHarness(r.cfg)) item.note = `HTTP ${r.cfg.command.trim()}`;
            else {
              const cmd = resolveHarnessCommand(r.cfg);
              if (!cmd.found) { item.ok = false; item.note = `comando "${r.cfg.command.trim()}" não encontrado no PATH`; }
              else if (cmd.command !== r.cfg.command.trim()) item.note = `usando ${cmd.command}`;
            }
          } catch (e) { item.ok = false; item.note = (e as Error).message; }
        }
        steps.push(item);
      }
      emit({ t: 'run.preflight', steps, plugins: project.plugins });
      const hs = steps.filter((s) => s.harness).map((s) => `${s.id}: ${s.harness}${s.model && s.model !== '(padrão)' ? '/' + s.model : ''}`);
      if (hs.length) emit({ t: 'log', line: `rota "${route.name}" — provedor/modelo por etapa → ${hs.join(' · ')}` });
      for (const s of steps.filter((x) => x.ok === false)) emit({ t: 'log', line: `⚠ etapa ${s.id}: ${s.note}` });
      if (project.plugins?.length) emit({ t: 'log', line: `plugins ativos: ${project.plugins.join(', ')}` });
      if (noFallback) emit({ t: 'log', line: '🚫 sem reserva: cada etapa usa só o primeiro provedor; se falhar, a execução para com o erro' });
    } catch { /* pré-checagem nunca impede a execução */ }
  }

  function loadScenes() {    const file = path.join(projectDir, 'scenes.json');
    const raw = readJson<Array<Partial<Scene>>>(file, []);
    let list = Array.isArray(raw) ? raw : [];
    /* Clipe musical = UMA cena em loop. Modelos pequenos às vezes devolvem duas
       variações da mesma cena; manter só a primeira evita gerar dois vídeos. */
    const editStep = (project.route?.steps ?? []).find((st) => st.id === 'edit' && st.kind === 'edit');
    const perTrack = !!(editStep?.params as Record<string, unknown> | undefined)?.perTrackLoop
      || String((editStep?.params as Record<string, unknown> | undefined)?.loopMode ?? '') === 'per-track';
    if (isMusicClip(project) && list.length > 1 && !perTrack) {
      emit({ t: 'log', line: `clipe musical: ${list.length} cenas no scenes.json → usando só a primeira (loop único)` });
      list = list.slice(0, 1);
    }
    /* vídeo em código: menos cenas, de 10 a 19 s; se o modelo devolveu cenas curtas, junta as seguidas */
    if (!project.sceneSec && isLongCodeVideo(project, routeSceneKinds(project), pluginsRoot(deps.settings))) {
      const merged = mergeShortCodeScenes(list);
      if (merged.length !== list.length) {
        emit({ t: 'log', line: `vídeo em código: ${list.length} cenas curtas → ${merged.length} cenas de ≥ ${CODE_SCENE_MIN_SEC} s (trechos seguidos juntados)` });
        list = merged;
        try { fs.writeFileSync(file, JSON.stringify(list, null, 2)); } catch { /* só o projeto em memória */ }
      }
    }
    const prevScenes = new Map(project.scenes.map((x) => [x.id, x]));
    project.scenes = list.map((s, i) => {
      /* diálogo: "NOME: fala" numa linha só vira "speaker" + fala (o nome não é falado) */
      const raw = s.narration ?? '';
      const single = !/[\r\n]/.test(raw.trim()) ? splitSpeakerTag(raw) : undefined;
      const declared = typeof s.speaker === 'string' && s.speaker.trim() ? s.speaker.trim() : undefined;
      const speaker = declared ?? single?.speaker;
      const narration = single?.speaker && (!declared || declared.toLowerCase() === single.speaker.toLowerCase()) ? single.text : raw;
      return {
        id: s.id ?? `s${String(i + 1).padStart(2, '0')}`,
        index: i + 1,
        title: s.title ?? `Cena ${i + 1}`,
        narration,
        visualIntent: s.visualIntent ?? '',
        durationSec: s.durationSec,
        manualDuration: s.manualDuration,
        subtitle: s.subtitle,
        effects: s.effects,
        variation: s.variation,
        kind: s.kind ?? 'image',
        camera: s.camera,
        searchTerms: termsText(s.searchTerms) || [s.title, s.visualIntent].filter(Boolean).join(' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 6).join(' ') || undefined,
        videoPrompt: s.videoPrompt,
        speaker,
        emotion: normalizeEmotion(s.emotion),
        delivery: typeof s.delivery === 'string' && s.delivery.trim() ? s.delivery.trim().slice(0, 120) : undefined,
        userMedia: typeof s.userMedia === 'string' && s.userMedia.trim() ? s.userMedia.trim() : undefined,
        clipStart: Number(s.clipStart) > 0 ? Math.round(Number(s.clipStart) * 100) / 100 : undefined,
        trimStart: Number(s.trimStart) > 0 ? Math.round(Number(s.trimStart) * 1000) / 1000 : undefined,
        clipCrop: s.clipCrop && Number(s.clipCrop.w) > 0 && Number(s.clipCrop.h) > 0
          ? { w: Math.round(Number(s.clipCrop.w)), h: Math.round(Number(s.clipCrop.h)), x: Math.max(0, Math.round(Number(s.clipCrop.x) || 0)), y: Math.max(0, Math.round(Number(s.clipCrop.y) || 0)) }
          : undefined,
        notes: s.notes,
        sfx: Array.isArray(s.sfx) ? s.sfx.map(String) : undefined,
        sfxCues: Array.isArray(s.sfxCues) ? s.sfxCues : undefined,
        overrides: s.overrides,
        status: {},
        artifacts: {},
      };
    });
    /* opções/escolhas do storyboard sobrevivem ao recarregar o plano (mesma cena, mesmo visual) */
    for (const sc of project.scenes) {
      const pv = prevScenes.get(sc.id);
      if (!pv || pv.visualIntent !== sc.visualIntent) continue;
      if (pv.candidates) sc.candidates = pv.candidates;
      if (pv.firstFrame) sc.firstFrame = pv.firstFrame;
      if (pv.sketch) sc.sketch = pv.sketch;
      if (!sc.emotion && pv.emotion) sc.emotion = pv.emotion;
      if (!sc.delivery && pv.delivery) sc.delivery = pv.delivery;
    }
    emit({ t: 'log', line: `scenes.json carregado: ${project.scenes.length} cenas` });
  }

  /**
   * Reservas de harness para uma etapa cuja cadeia se esgotou: a lista da rota (harnessFallback) ou,
   * sem ela, os harnesses usados nas outras etapas da rota e, por último, os instalados (ordem do "auto").
   * Só para etapas executadas por harness; não repete os que já foram tentados.
   */
  function harnessFallbacks(chain: Binding[], tried: Set<string>): Binding[] {
    const tpl = [...chain].reverse().find((b) => b.type === 'harness') as Extract<Binding, { type: 'harness' }> | undefined;
    if (!tpl) return [];
    const rt = route ?? project.route;
    /* reservas explícitas: as da rota/projeto, senão as padrão das Configurações */
    const explicit = rt?.harnessFallback?.length ? rt.harnessFallback : deps.settings.harnessFallback?.length ? deps.settings.harnessFallback : undefined;
    const fromRoute = (explicit
      ?? (rt?.steps ?? []).flatMap((st) => st.bindings).filter((b): b is Extract<Binding, { type: 'harness' }> => b.type === 'harness' && b.harness !== 'auto').map((b) => b.harness)) as string[];
    const ids = [...new Set([...fromRoute, ...(explicit ? [] : AUTO_ORDER)])];
    const out: Binding[] = [];
    for (const id of ids) {
      if (tried.has(id) || id === 'auto') continue;
      const cfg = deps.settings.harnesses[id as keyof Settings['harnesses']];
      if (!cfg) continue;
      /* local (HTTP) só se a rota indicar; CLI só se estiver instalado */
      if (isHttpHarness(cfg) ? !fromRoute.includes(id) : !resolveHarnessCommand(cfg).found) continue;
      const sameModel = (rt?.steps ?? []).flatMap((st) => st.bindings).find((b) => b.type === 'harness' && b.harness === id) as Extract<Binding, { type: 'harness' }> | undefined;
      out.push({ ...tpl, harness: id as typeof tpl.harness, model: sameModel?.model, effort: sameModel?.effort ?? tpl.effort });
      if (out.length >= 3) break;
    }
    return out;
  }

  async function runUnit(step: RouteStep, scene?: Scene): Promise<{ ok: boolean; reason?: string; cached?: boolean }> {
    const sceneId = scene?.id;
    let bindings: Binding[] = (scene?.overrides?.[step.id] as Binding[] | undefined) ?? step.bindings;
    /* trilha por código escolhida no projeto: vai à frente em qualquer rota (as outras ficam de reserva) */
    if (step.kind === 'music' && project.codeMusic && bindings.length && !bindings.some((b) => b.type === 'builtin' && (b.tool === 'lyric-song' || b.tool === 'clip-musical'))) {
      const isCode = (b: Binding) => b.type === 'builtin' && b.tool === 'music-code';
      bindings = [{ type: 'builtin', tool: 'music-code' }, ...bindings.filter((b) => !isCode(b))];
    }
    const sceneDir = scene ? sceneDirOf(projectDir, scene) : undefined;
    if (sceneDir) fs.mkdirSync(sceneDir, { recursive: true });
    if (scene) scene.status[step.id] = 'running';

    if (bindings.length === 0) {
      if (scene) scene.status[step.id] = 'skipped';
      emit({ t: 'step.skipped', stepId: step.id, sceneId, reason: 'sem bindings' });
      return { ok: true };
    }
    /* legendas desligadas no projeto: a etapa é pulada (o lyric video sempre tem a letra) e um .srt antigo sai do vídeo */
    if (step.kind === 'subtitles' && project.subtitles === 'off' && !isLyricVideo(project)) {
      try { fs.rmSync(path.join(projectDir, 'out', 'subtitles.srt'), { force: true }); } catch { /* ignora */ }
      emit({ t: 'step.skipped', stepId: step.id, sceneId, reason: 'legendas desligadas neste projeto (ligue no editor, cartão "Legendas")' });
      return { ok: true };
    }

    /* cena sem fala (pausa dramática, só imagem): nada a narrar; a montagem põe silêncio na duração da cena */
    if ((step.kind === 'narration' || step.kind === 'transcribe') && scene && !scene.narration?.trim()) {
      scene.status[step.id] = 'skipped';
      scene.artifacts[step.id] = [];
      emit({ t: 'step.skipped', stepId: step.id, sceneId, reason: 'cena sem fala — fica em silêncio' });
      return { ok: true };
    }

    /* fala do MiniMax H3: a voz sai do próprio vídeo (emoção e lábios juntos); o TTS fica de reserva */
    if (step.kind === 'narration' && scene && speechInVideo() && !ttsFallback.has(scene.id)) {
      scene.status[step.id] = 'skipped';
      scene.artifacts[step.id] = [];
      emit({ t: 'step.skipped', stepId: step.id, sceneId, reason: 'fala gerada no vídeo pelo MiniMax H3 (a narração por TTS entra só se o vídeo vier sem fala)' });
      return { ok: true };
    }
    /* clonagem/áudio interno do H3: a cena mantém a duração do plano.
       O áudio fora da fala esperada é silenciado depois (keepVideoSpeech), sem encolher o clipe. */
    if (step.kind === 'video' && scene && speechInVideo() && scene.narration?.trim() && !scene.manualDuration) {
      const sec = estimateSpeechSec(scene.narration, (project.skill?.formatDna?.wpm ?? 156) / 60);
      if (Math.abs((scene.durationSec ?? 0) - sec) > 0.8) {
        emit({ t: 'log', stepId: step.id, sceneId, line: `🗣 fala estimada em ${sec} s para uma cena de ${scene.durationSec ?? '?'} s — a cena mantém a duração do plano (o áudio fora da fala é silenciado)` });
      }
    }
    /* quadro inicial escolhido no storyboard: vira a imagem da cena (não gera de novo) */
    if (step.kind === 'image' && scene?.firstFrame) {
      const f = path.isAbsolute(scene.firstFrame) ? scene.firstFrame : path.join(projectDir, scene.firstFrame);
      if (fs.existsSync(f)) {
        emit({ t: 'log', stepId: step.id, sceneId, line: `🎞 quadro inicial escolhido no storyboard: ${path.basename(f)}` });
        finish(step, scene, [f]);
        return { ok: true, cached: true };
      }
    }

    // cache: qualquer binding da cadeia com artefato válido evita reexecução
    if (!opts.noCache) {
      for (const b of bindings) {
        const hit = cache[cacheKey(project, step, b, scene)];
        if (hit && hit.length > 0 && hit.every((f) => fs.existsSync(f)) && !emptyPlan(step, hit)) {
          emit({ t: 'step.cache_hit', stepId: step.id, sceneId });
          finish(step, scene, hit);
          return { ok: true, cached: true };
        }
      }
    }

    let lastReason = 'sem tentativas';
    /* a cadeia cresce uma vez: esgotados os harnesses da etapa, entram as reservas indicadas pela rota */
    const chain: Binding[] = noFallback ? bindings.slice(0, 1) : [...bindings];
    const tried = new Set<string>();
    let extended = noFallback;
    for (let bi = 0; ; bi++) {
      if (bi >= chain.length) {
        if (extended || signal.aborted) break;
        extended = true;
        const extra = harnessFallbacks(chain, tried);
        if (!extra.length) break;
        emit({ t: 'log', stepId: step.id, sceneId, line: `tentativas esgotadas — reservas de harness da rota: ${extra.map((b) => bindingLabel(b)).join(' → ')}` });
        emit({ t: 'step.fallback', stepId: step.id, sceneId, from: bindingLabel(chain[chain.length - 1]!), to: bindingLabel(extra[0]!), reason: lastReason });
        chain.push(...extra);
      }
      const binding = chain[bi]!;
      const label = bindingLabel(binding);

      /* provedor que nem está instalado: não gasta tentativas nem tempo — vai
         direto para o próximo da cadeia (o aviso já saiu na pré-checagem). */
      let localKey: string | undefined;
      if (binding.type === 'harness') {
        try {
          const r = await resolveHarness(deps.settings, binding, (route ?? project.route)?.harnessFallback);
          tried.add(r.id);
          if (isHttpHarness(r.cfg)) localKey = localModelKey(r.cfg.command);
          if (!isHttpHarness(r.cfg) && !resolveHarnessCommand(r.cfg).found) {
            lastReason = `${r.id}: comando "${r.cfg.command.trim()}" não encontrado`;
            emit({ t: 'step.fallback', stepId: step.id, sceneId, from: label, to: chain[bi + 1] ? bindingLabel(chain[bi + 1]!) : '(fim da cadeia)', reason: `${r.id} não está instalado — sem novas tentativas` });
            emit({ t: 'log', stepId: step.id, sceneId, line: `pulando ${label}: ${r.id} não está instalado (configure em Providers (provedores) ou use "auto")` });
            continue;
          }
        } catch { /* deixa o executor reportar o motivo real */ }
      }
      /* API sem chave (ou provedor removido): também não gasta tentativas */
      if (binding.type === 'api') {
        const p = deps.settings.providers.find((x) => x.id === binding.provider);
        const noKey = !p ? 'não configurado' : !p.apiKey && (/openai\.com/.test(p.baseUrl) || p.kind !== 'openai') ? 'sem chave de API' : '';
        if (noKey) {
          lastReason = `provider "${binding.provider}" ${noKey}`;
          emit({ t: 'step.fallback', stepId: step.id, sceneId, from: label, to: chain[bi + 1] ? bindingLabel(chain[bi + 1]!) : '(fim da cadeia)', reason: `${lastReason} — sem novas tentativas` });
          emit({ t: 'log', stepId: step.id, sceneId, line: `pulando ${label}: ${lastReason} (Configurações → Providers)` });
          continue;
        }
      }

      const key = cacheKey(project, step, binding, scene);
      emit({ t: 'step.start', stepId: step.id, sceneId, binding: label });
      const exec = deps.executors[binding.type];
      if (!exec) {
        lastReason = `sem executor para "${binding.type}"`;
      } else {
        /* modelos (harness/API) erram de forma intermitente (laço, página quebrada, resposta cortada): pelo menos
           settings.stepAttempts tentativas (padrão 2) mesmo quando a rota pede 1 — essencial para deixar um lote rodando */
        const isModel = binding.type === 'harness' || binding.type === 'api';
        const maxTries = Math.max(1, step.retry.max, isModel ? Math.min(5, deps.settings.stepAttempts ?? 2) : 1);
        let agentTimeouts = 0;
        /* elenco e cenários do motor do plugin: o agente lê a API inteira e grava vários arquivos (rotas antigas tinham 900 s) */
        /* vídeo livre em planos de 3–4 s (modelo local): cada plano é uma página — até 15 min por plano */
        const shotsFree = step.kind === 'free' && binding.type === 'harness' && shotsWanted(binding.harness, project.targetDurationSec || 15);
        const timeoutSec = shotsFree ? Math.max(stepTimeoutSec(step), shotDurations(Math.min(180, project.targetDurationSec || 15)).length * 1500 + 600) : stepTimeoutSec(step);
        for (let attempt = 1; attempt <= maxTries; attempt++) {
          if (signal.aborted) return { ok: false, reason: 'cancelado' };
          emit({ t: 'step.attempt', stepId: step.id, sceneId, binding: label, attempt });
          let release: (() => void) | undefined;
          if (localKey) {
            try {
              release = await acquireLocalModel(localKey, signal, () => emit({ t: 'log', stepId: step.id, sceneId, line: `[${label}] na fila do modelo local (outro pedido em andamento) — a espera não conta no tempo máximo` }));
            } catch { return { ok: false, reason: 'cancelado' }; }
          }
          const ac = new AbortController();
          const onAbort = () => ac.abort(signal.reason);
          signal.addEventListener('abort', onAbort, { once: true });
          const timer = setTimeout(() => ac.abort(new Error(`timeout (${timeoutSec}s)`)), timeoutSec * 1000);
          try {
            const res = await exec({
              project: sceneProject(project, scene), projectDir, step, binding, scene, sceneDir, outDir,
              settings: deps.settings, signal: ac.signal,
              log: (line) => emit({ t: 'log', stepId: step.id, sceneId, line }),
            });
            release?.(); /* aprovação e gravação do cache não seguram a fila do modelo local */
            const bad = res.files.filter((f) => !fs.existsSync(f) || fs.statSync(f).size === 0);
            if (bad.length > 0) throw new Error(`arquivo(s) ausente(s)/vazio(s): ${bad.map((b) => path.basename(b)).join(', ')}`);
            if (res.files.length === 0 && !step.optional) throw new Error('nenhum artefato produzido');
            if (step.gate === 'approve' && deps.approve) {
              emit({ t: 'gate.waiting', stepId: step.id, sceneId });
              const ok = await deps.approve(step.id, sceneId);
              if (!ok) throw new Error('reprovado pelo usuário');
            }
            if (res.files.length > 0) {
              cache[key] = res.files;
              writeJsonAtomic(cachePath, cache);
            }
            finish(step, scene, res.files);
            emit({ t: 'step.done', stepId: step.id, sceneId, binding: label, files: res.files });
            return { ok: true };
          } catch (e) {
            release?.();
            lastReason = ac.signal.aborted && !signal.aborted ? `timeout (${timeoutSec}s)` : (e as Error).message;
            emit({ t: 'log', stepId: step.id, sceneId, line: `[${label}] tentativa ${attempt} falhou: ${lastReason}` });
            if (signal.aborted) return { ok: false, reason: 'cancelado' };
            /* falha que se repetiria igual (estourou o tempo, modelo inexistente, sem chave): vai direto ao próximo
               executor da cadeia — repetir um timeout de 15 min no mesmo harness só dobrava a espera */
            if (/^timeout \(/.test(lastReason)) agentTimeouts++;
            if (attempt < maxTries && isPersistentFailure(lastReason, binding, agentTimeouts, deps.settings)) {
              emit({ t: 'log', stepId: step.id, sceneId, line: `[${label}] sem nova tentativa neste executor (${/^timeout/.test(lastReason) ? 'estourou o tempo' : 'erro de configuração'})` });
              break;
            }
            if (attempt < maxTries && agentTimeouts === 1 && /^timeout \(/.test(lastReason)) emit({ t: 'log', stepId: step.id, sceneId, line: `[${label}] o agente estourou o tempo — nova rodada continua do que já gravou na pasta` });
            if (attempt < maxTries) await (deps.sleep ?? realSleep)(step.retry.backoffMs * attempt);
          } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            release?.();
          }
        }
      }
      const next = chain[bi + 1];
      if (next) emit({ t: 'step.fallback', stepId: step.id, sceneId, from: label, to: bindingLabel(next), reason: lastReason });
    }
    if (scene) scene.status[step.id] = 'failed';
    emit({ t: 'step.failed', stepId: step.id, sceneId, reason: lastReason });
    return { ok: false, reason: lastReason };
  }

  async function runScenePipeline(block: RouteStep[], conc: number) {
    const scenes = project.scenes.filter((s) => !opts.only?.sceneIds || opts.only.sceneIds.includes(s.id));
    const limit = new Map(block.map((st) => [st.id, semaphore(Math.max(1, st.concurrency ?? (isLocalGpu(st) ? 1 : conc)))]));
    emit({ t: 'log', line: `cenas simultâneas: ${scenes.length} cena(s), até ${conc} ao mesmo tempo · etapas: ${block.map((b) => b.id).join(' → ')}` });
    let idx = 0;
    let failure: string | undefined;
    const worker = async () => {
      while (idx < scenes.length && !failure && !stopping()) {
        const scene = scenes[idx++]!;
        const startedScene = Date.now();
        for (const st of block) {
          if (failure || stopping()) return;
          if (st.onlySceneKinds && !st.onlySceneKinds.includes(scene.kind)) continue;
          emit({ t: 'step.queued', stepId: st.id, sceneId: scene.id });
          const r = await limit.get(st.id)!(() => runUnit(st, scene));
          markDone(`${st.id} · ${scene.id}`);
          if (r.ok || st.kind === 'video') await afterStep(st, scene);
          if (r.ok) { /* segue */ }
          else if ((st.onFail ?? 'stop') === 'stop' && !st.optional) { failure = `Cena ${scene.index} · etapa "${st.id}" falhou: ${r.reason}`; return; }
        }
        emit({ t: 'log', line: `cena ${scene.id} concluída em ${((Date.now() - startedScene) / 1000).toFixed(1)}s (${conc} em paralelo)` });
        saveProject(projectDir, project);
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, scenes.length)) }, worker));
    if (stopping()) throw new Error(stopMessage());
    if (failure) throw new Error(failure);
  }

  /** Narração concluída => duração da cena passa a ser a do áudio (a menos que o usuário a tenha fixado). */
  async function afterStep(step: RouteStep, scene: Scene) {
    /* vídeo do H3 sem fala (outro provedor da rota, ou o H3 falhou na fala): narra por TTS agora */
    if (step.kind === 'video' && scene.narration?.trim() && speechInVideo() && !sceneHasAudio(scene)) {
      const nar = (planRef?.ordered ?? []).find((st) => st.kind === 'narration' && st.enabled);
      if (nar) {
        ttsFallback.add(scene.id);
        emit({ t: 'log', stepId: nar.id, sceneId: scene.id, line: 'o vídeo desta cena veio sem a fala do MiniMax H3 — narrando por TTS' });
        const r = await runUnit(nar, scene);
        if (r.ok) await afterStep(nar, scene);
      }
      return;
    }
    /* a narração por TTS substitui o áudio que veio do clipe: a folga de 0,15 s volta a valer */
    if (step.kind === 'narration') fs.rmSync(path.join(sceneDirOf(projectDir, scene), 'audio', '.from-video'), { force: true });
    if (step.kind !== 'narration' || scene.manualDuration) return;
    /* clonagem/áudio interno: a duração é a do plano (ou a do clipe H3); o TTS é só reserva
       e não pode encolher a cena planejada */
    if (speechInVideo()) return;
    const a = scene.artifacts[step.id]?.find((f) => /\.(mp3|wav|m4a|ogg|flac)$/i.test(f));
    if (!a) return;
    const d = await probeDuration(deps.settings.ffprobe, a);
    if (d > 0.2) scene.durationSec = Math.round((d + 0.15) * 100) / 100;
  }

  function fillCast() {
    const dir = path.join(deps.settings.workspace, 'voices');
    let files: string[] = [];
    try { files = fs.readdirSync(dir).filter((f) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(f)).sort().map((f) => path.join(dir, f)); } catch { /* sem pasta de vozes */ }
    const before = JSON.stringify(project.cast ?? []);
    const added = autoCast(project, projectDir, files);
    for (const m of (project.cast ?? []).filter((x) => added.includes(x.speaker))) {
      emit({ t: 'log', line: `elenco: ${m.speaker} → ${m.refAudio ? `voz ${path.basename(m.refAudio)}` : 'voz padrão da rota'}${m.voice ? ` · API ${m.voice}` : ''}` });
    }
    /* vozes que faltavam em membros já existentes também precisam ser gravadas */
    if (added.length || JSON.stringify(project.cast ?? []) !== before) saveProject(projectDir, project);
  }

  function finish(step: RouteStep, scene: Scene | undefined, files: string[]) {
    if (scene) {
      scene.status[step.id] = 'done';
      scene.artifacts[step.id] = files;
    }
  }
}
