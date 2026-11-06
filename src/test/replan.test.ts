import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProject, defaultSettings, projectDirOf, projectsDir } from '../main/settings';
import * as ops from '../main/ops';
import { applyBypass, bypassTargets, replanScenes } from '../main/replan';
import { buildPrompt } from '../main/prompts';
import type { ExecContext } from '../main/engine';
import type { ExecutorBypass, Settings } from '../shared/types';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-replan-'));
  const s: Settings = defaultSettings(ws);
  const p = createProject(s, { name: 'Maldade', idea: 'x', videoType: 'custom', routeId: 'explainer-mixed', targetDurationSec: 300 });
  const dir = projectDirOf(s, p.id);

  // ───────── projeto "produzido" com o plano antigo (muitas cenas curtas)
  fs.writeFileSync(path.join(dir, 'script.md'), 'roteiro inteiro');
  fs.writeFileSync(path.join(dir, 'scenes.json'), '[]');
  fs.mkdirSync(path.join(dir, 'scenes', 's01', 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scenes', 's01', 'audio', 'narration.mp3'), 'mp3');
  fs.mkdirSync(path.join(dir, 'kit', 'scenes', 'shots'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'kit', 'scenes', 'shots', 's01.js'), '// plano antigo');
  fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cache', 'index.json'), JSON.stringify({
    a: [path.join(dir, 'script.md')], b: [path.join(dir, 'scenes.json')], c: [path.join(dir, 'scenes', 's01', 'audio', 'narration.mp3')], d: [path.join(dir, 'kit', 'scenes', 'shots', 's01.js')],
  }));
  const full = ops.readProject(s, p.id);
  full.scenes = Array.from({ length: 90 }, (_, i) => ({ id: `s${i + 1}`, index: i + 1, title: 't', narration: 'n', visualIntent: 'v', kind: 'code', durationSec: 3.2, status: {}, artifacts: {} }));
  ops.saveProjectFile(s, full);

  // ───────── ajustar cenas
  const r = replanScenes(s, p.id, { sceneSec: 12, refreshSkill: true });
  assert.equal(r.oldScenes, 90);
  assert.equal(r.project.scenes.length, 0);
  assert.equal(r.project.sceneSec, 12);
  assert.ok(fs.existsSync(path.join(dir, 'script.md')), 'roteiro mantido');
  for (const f of ['scenes.json', 'scenes', path.join('kit', 'scenes', 'shots')]) assert.ok(!fs.existsSync(path.join(dir, f)), `${f} removido`);
  const cache = JSON.parse(fs.readFileSync(path.join(dir, 'cache', 'index.json'), 'utf8')) as Record<string, string[]>;
  assert.deepEqual(Object.keys(cache), ['a'], 'cache só do que vem antes do plano (roteiro)');
  assert.ok(r.backup.startsWith(path.join(projectsDir(s), '_backups')), 'backup fora da pasta do projeto');
  assert.ok(fs.existsSync(path.join(r.backup, 'scenes', 's01', 'audio', 'narration.mp3')) && fs.existsSync(path.join(r.backup, 'kit-shots', 's01.js')) && fs.existsSync(path.join(r.backup, 'project.json')), 'backup completo');
  assert.ok(!fs.readdirSync(projectsDir(s)).filter((d) => d !== '_backups').some((d) => d.includes('_backup')), 'nada de backup dentro da lista de projetos');
  assert.equal(ops.readProject(s, p.id).sceneSec, 12, 'gravado no projeto');

  // ───────── a duração entra no pedido do plano de cenas (vence o padrão 3–8 s)
  const step = r.project.route!.steps.find((st) => st.kind === 'scene_plan')!;
  const prompt = buildPrompt({ project: r.project, step, projectDir: dir, outDir: path.join(dir, 'out'), settings: s, log: () => {}, signal: new AbortController().signal } as unknown as ExecContext);
  assert.match(prompt, /DURAÇÃO DEFINIDA NO PROJETO[^\n]*≈ 12 s[^\n]*≈ 25 cenas/);
  assert.doesNotMatch(prompt, /padrão 3–8 s/);

  // ───────── bypass de executor
  const route = r.project.route!;
  const gem: ExecutorBypass = { binding: { type: 'harness', harness: 'antigravity', model: 'gemini-3.8-flash-medium' }, scope: 'ai', exclusive: false, enabled: true };
  const ai = bypassTargets(route, gem);
  assert.ok(ai.includes('script') && ai.includes('scene_plan') && ai.some((x) => /code|motion/.test(x)), `texto e código atingidos (${ai.join(',')})`);
  assert.ok(!ai.some((id) => ['narration', 'subtitles', 'edit', 'music', 'transcribe'].includes(route.steps.find((st) => st.id === id)!.kind)), 'voz, legendas, montagem e trilha não mudam');
  const eff = applyBypass(route, gem);
  const sp = eff.steps.find((st) => st.kind === 'scene_plan')!;
  assert.deepEqual(sp.bindings[0], gem.binding, 'à frente');
  assert.ok(sp.bindings.length > 1, 'os da rota ficam de reserva');
  assert.equal(applyBypass(route, { ...gem, exclusive: true }).steps.find((st) => st.kind === 'scene_plan')!.bindings.length, 1, 'exclusivo: só ele');
  assert.deepEqual(applyBypass(route, { ...gem, enabled: false }), route, 'desligado: rota igual');
  assert.ok(bypassTargets(route, { ...gem, scope: 'code' }).every((id) => /code_scene|motion_graphics/.test(route.steps.find((st) => st.id === id)!.kind)), 'escopo código');
  assert.ok(!bypassTargets(route, { ...gem, scope: 'text' }).some((id) => /code_scene|motion_graphics/.test(route.steps.find((st) => st.id === id)!.kind)), 'escopo texto');
  assert.deepEqual(ops.readProject(s, p.id).route, route, 'a rota gravada não muda');

  // ───────── gravado no projeto pela interface (validação)
  let q = ops.updateProject(s, p.id, { executorBypass: gem } as never);
  assert.equal(q.executorBypass?.binding.model, 'gemini-3.8-flash-medium');
  q = ops.updateProject(s, p.id, { executorBypass: { binding: { type: 'api' }, scope: 'ai' } } as never);
  assert.equal(q.executorBypass, undefined, 'bypass inválido é descartado');
  q = ops.updateProject(s, p.id, { sceneSec: 99 } as never);
  assert.equal(q.sceneSec, 30, 'duração limitada a 30 s');

  await planRegression(s);
  fs.rmSync(ws, { recursive: true, force: true });
  console.log('replan + bypass tests: OK');
}

/**
 * Regressão: "refazer só o plano" — a IA gravava o plano e, no instante em que o progresso chegava a 1/1, o app
 * salvava o projeto espelhando a lista de cenas da memória (vazia) no scenes.json; o motor lia 0 cenas e o cache
 * ficava marcando o plano como pronto.
 */
async function planRegression(s: Settings) {
  const { runRoute } = await import('../main/engine');
  const p = createProject(s, { name: 'Regressao', idea: 'x', videoType: 'custom', routeId: 'explainer-mixed' });
  const dir = projectDirOf(s, p.id);
  fs.writeFileSync(path.join(dir, 'script.md'), 'roteiro');
  const route = { id: 'r', name: 'r', description: '', videoTypes: [], steps: [
    { id: 'scene_plan', kind: 'scene_plan', label: 'p', scope: 'project', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 30, bindings: [{ type: 'builtin', tool: 'subtitles' }] },
    { id: 'narration', kind: 'narration', label: 'n', scope: 'scene', dependsOn: ['scene_plan'], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 30, bindings: [{ type: 'builtin', tool: 'estimate-words' }] },
  ] } as never;
  let planWrites = 0;
  const exec = async (c: { step: { kind: string }; scene?: { id: string } }) => {
    if (c.step.kind === 'scene_plan') {
      planWrites++;
      /* a IA leva tempo: o progresso só é avisado a cada 400 ms — sem a espera o "1 de 1" nunca disparava no teste */
      await new Promise((res) => setTimeout(res, 500));
      const f = path.join(dir, 'scenes.json');
      fs.writeFileSync(f, JSON.stringify([{ id: 's01', title: 'a', narration: 'um', visualIntent: 'v', kind: 'code', durationSec: 12 }, { id: 's02', title: 'b', narration: 'dois', visualIntent: 'v', kind: 'code', durationSec: 12 }]));
      return { files: [f] };
    }
    const f = path.join(dir, 'scenes', c.scene!.id, 'x.txt'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); return { files: [f] };
  };
  const project = ops.readProject(s, p.id);
  /* como o app: a cada progresso "completo" salva o registro — agora SEM tocar no scenes.json */
  const emit = (e: { t: string; done?: number; total?: number }) => { if (e.t === 'run.progress' && (e.done ?? 0) >= (e.total ?? 1)) ops.saveProjectFile(s, project, { scenes: false }); };
  const r1 = await runRoute({ project, route, projectDir: dir, signal: new AbortController().signal, only: { stepIds: ['scene_plan'] }, deps: { settings: s, emit: emit as never, executors: { builtin: exec as never } } });
  assert.ok(r1.ok, r1.error);
  assert.equal(project.scenes.length, 2, 'o plano recém-escrito é carregado (antes: 0 cenas)');
  assert.equal((JSON.parse(fs.readFileSync(path.join(dir, 'scenes.json'), 'utf8')) as unknown[]).length, 2, 'scenes.json preservado');

  /* plano vazio em cache não vale como pronto: a etapa é refeita */
  fs.writeFileSync(path.join(dir, 'scenes.json'), '[]');
  const before = planWrites;
  const project2 = ops.readProject(s, p.id); project2.scenes = [];
  const r2 = await runRoute({ project: project2, route, projectDir: dir, signal: new AbortController().signal, deps: { settings: s, emit: () => {}, executors: { builtin: exec as never } } });
  assert.ok(r2.ok, r2.error);
  assert.equal(planWrites, before + 1, 'plano vazio no cache → refeito');
  assert.equal(project2.scenes.length, 2);

  /* plano que sai vazio: para na hora com mensagem clara (antes seguia até a montagem) */
  const empty = async (c: { step: { kind: string } }) => { const f = path.join(dir, 'scenes.json'); if (c.step.kind === 'scene_plan') fs.writeFileSync(f, '[]'); return { files: [f] }; };
  const project3 = ops.readProject(s, p.id); project3.scenes = [];
  const r3 = await runRoute({ project: project3, route, projectDir: dir, signal: new AbortController().signal, noCache: true, deps: { settings: s, emit: () => {}, executors: { builtin: empty as never } } });
  assert.ok(!r3.ok && /plano de cenas ficou vazio/.test(r3.error ?? ''), `para com mensagem clara (veio: ${r3.error})`);

  /* saveProjectFile padrão continua espelhando (fora de execução) */
  const q = ops.readProject(s, p.id); q.scenes = [];
  ops.saveProjectFile(s, q);
  assert.equal(fs.readFileSync(path.join(dir, 'scenes.json'), 'utf8').trim(), '[]');
}

main().catch((e) => { console.error(e); process.exit(1); });
