import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runRoute, orderSteps, acquireLocalModel, localModelKey, type Executor } from '../main/engine';
import { ROUTES, applyProfile, getRoute } from '../main/presets';
import { abortMessage, buildArgs, DEFAULT_HARNESSES } from '../main/harness';
import { SLOW_STEP_TIMEOUT_SEC, stepTimeoutSec } from '../main/timeouts';
import { applyVariables } from '../main/comfyui';
import { createProject, defaultSettings } from '../main/settings';
import type { EngineEvent, Route } from '../shared/types';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  const settings = defaultSettings(ws);
  /* o motor pula API sem chave; aqui o executor é simulado */
  for (const p of settings.providers) if (p.id === 'openai') p.apiKey = 'teste';
  // o motor pula provedor cujo comando não existe: aponta o claude para um executável real
  settings.harnesses.claude = { ...settings.harnesses.claude, command: process.execPath };

  // 1. todas as rotas padrão têm ordem topológica válida
  for (const r of ROUTES) orderSteps(r.steps);
  /* prazo efetivo: o mesmo número no cronômetro do motor e no harness (antes: motor 30 min, harness 15) */
  assert.equal(stepTimeoutSec({ id: 'scene-code', kind: 'code_scene', timeoutSec: 900 }), 1800);
  assert.equal(stepTimeoutSec({ id: 'scene-code', kind: 'code_scene', timeoutSec: 2400 }), 2400, 'prazo da rota maior que o piso é respeitado');
  assert.equal(stepTimeoutSec({ id: 'kit_assets', kind: 'asset_design', timeoutSec: 900 }), 1800, 'elenco/cenários do kit');
  assert.equal(stepTimeoutSec({ id: 'motion', kind: 'motion_graphics', timeoutSec: 600 }), SLOW_STEP_TIMEOUT_SEC);
  assert.equal(stepTimeoutSec({ id: 'script', kind: 'script', timeoutSec: 600 }), 600, 'etapa normal mantém o prazo');
  assert.equal(stepTimeoutSec({ id: 'script', kind: 'script' } as never), 900, 'sem prazo na rota: 15 min');

  // 2. perfil local remove APIs
  const local = applyProfile(getRoute('shorts-autopilot')!, 'local');
  assert.ok(local.steps.every((s) => s.bindings.every((b) => b.type !== 'api')));

  // 3. argumentos de harness: sem modelo remove o par "--model {model}"
  const a = buildArgs(DEFAULT_HARNESSES.opencode, 'oi');
  assert.deepEqual(a, ['run', '--auto']);
  assert.deepEqual(buildArgs(DEFAULT_HARNESSES.opencode, 'oi', 'ollama/x'), ['run', '--model', 'ollama/x', '--auto']);
  // opencode: prompt por stdin (fora da linha de comando — antivírus corporativo mata o app com prompt grande)
  assert.equal(DEFAULT_HARNESSES.opencode.promptVia, 'stdin');

  // 4. variáveis ComfyUI
  const g = applyVariables({ '6': { inputs: { text: '{{prompt}}', seed: 1 } } }, { prompt: 'gato', seed: 42 }, { '6.inputs.seed': 'seed' });
  assert.equal(g['6'].inputs.text, 'gato'); assert.equal(g['6'].inputs.seed, 42);

  // 5. motor: fan-out por cena, fallback, retry e cache
  const route: Route = {
    id: 't', name: 't', description: '', videoTypes: [],
    steps: [
      { id: 'scene_plan', kind: 'scene_plan', label: 'plan', scope: 'project', dependsOn: [], enabled: true, params: {},
        retry: { max: 1, backoffMs: 0 }, timeoutSec: 5, bindings: [{ type: 'harness', harness: 'claude' }] },
      { id: 'image', kind: 'image', label: 'img', scope: 'scene', dependsOn: ['scene_plan'], enabled: true, params: {},
        retry: { max: 2, backoffMs: 0 }, timeoutSec: 5,
        bindings: [{ type: 'comfyui', server: 'local', workflow: 'x.json' }, { type: 'api', provider: 'openai', model: 'm' }] },
    ],
  };
  const project = createProject(settings, { name: 'Teste', idea: 'ideia', videoType: 'custom', routeId: 'shorts-autopilot' });
  const dir = path.join(ws, 'projects', project.id);
  let comfyCalls = 0, apiCalls = 0, harnessCalls = 0;
  const executors: Partial<Record<string, Executor>> = {
    harness: async (c) => {
      harnessCalls++;
      const f = path.join(c.projectDir, 'scenes.json');
      fs.writeFileSync(f, JSON.stringify([{ title: 'A', narration: 'a', visualIntent: 'a' }, { title: 'B', narration: 'b', visualIntent: 'b' }]));
      return { files: [f] };
    },
    comfyui: async () => { comfyCalls++; throw new Error('OOM'); },
    api: async (c) => { apiCalls++; const f = path.join(c.sceneDir!, 'frame.png'); fs.writeFileSync(f, 'x'); return { files: [f] }; },
  };
  const events: EngineEvent[] = [];
  const mk = () => ({ settings, emit: (e: EngineEvent) => events.push(e), sleep: async () => {}, executors: executors as never });
  const res = await runRoute({ project, route, projectDir: dir, deps: mk(), signal: new AbortController().signal });
  assert.equal(res.ok, true, res.error ?? '');
  assert.equal(project.scenes.length, 2);
  assert.equal(comfyCalls, 4);            // 2 cenas × 2 tentativas
  assert.equal(apiCalls, 2);              // fallback usado nas 2 cenas
  assert.equal(events.filter((e) => e.t === 'step.fallback').length, 2);
  assert.ok(project.scenes.every((s) => s.status['image'] === 'done'));

  // 6. segunda execução usa cache (nenhum executor chamado)
  const before = { comfyCalls, apiCalls, harnessCalls };
  const res2 = await runRoute({ project, route, projectDir: dir, deps: mk(), signal: new AbortController().signal });
  assert.equal(res2.ok, true);
  assert.deepEqual({ comfyCalls, apiCalls, harnessCalls }, before);
  assert.ok(events.some((e) => e.t === 'step.cache_hit'));

  // 7. falha de todos os bindings => run falha
  const bad: Route = JSON.parse(JSON.stringify(route));
  bad.steps[1]!.bindings = [{ type: 'comfyui', server: 'local', workflow: 'x.json' }];
  const res3 = await runRoute({ project, route: bad, projectDir: dir, deps: mk(), signal: new AbortController().signal, noCache: true });
  assert.equal(res3.ok, false);

  // 8. prazo (drain): a cena em andamento termina, nenhuma nova começa, e o motivo aparece no erro
  const onlyImg: Route = JSON.parse(JSON.stringify(route));
  onlyImg.steps[1]!.bindings = [{ type: 'api', provider: 'openai', model: 'm' }];
  onlyImg.steps[1]!.retry = { max: 1, backoffMs: 0 };
  const drain = new AbortController();
  let drainCalls = 0;
  executors.api = async (c) => {
    drainCalls++;
    drain.abort(new Error('tempo máximo de produção (1 min) atingido'));
    const f = path.join(c.sceneDir!, 'frame.png'); fs.writeFileSync(f, 'x'); return { files: [f] };
  };
  const res4 = await runRoute({ project, route: onlyImg, projectDir: dir, deps: mk(), signal: new AbortController().signal, drain: drain.signal, noCache: true, only: { stepIds: ['image'] } });
  assert.equal(res4.ok, false);
  assert.equal(drainCalls, 1);                                  // a 2ª cena não começou
  assert.match(res4.error ?? '', /tempo máximo de produção/);
  assert.equal(project.scenes[0]!.status['image'], 'done');     // a que estava rodando terminou

  // 9. corte com motivo: o harness interrompido mostra o motivo e a cena não fica "running"
  const hard = new AbortController();
  executors.api = (c) => new Promise((_, reject) => {
    c.signal.addEventListener('abort', () => reject(new Error(abortMessage(c.signal, 'abortado (timeout/cancelamento)'))), { once: true });
    setTimeout(() => hard.abort(new Error('tempo máximo de produção (1 min) atingido')), 0);
  });
  events.length = 0;
  const res5 = await runRoute({ project, route: onlyImg, projectDir: dir, deps: mk(), signal: hard.signal, noCache: true, only: { stepIds: ['image'] } });
  assert.equal(res5.ok, false);
  assert.match(res5.error ?? '', /tempo máximo de produção/);
  assert.ok(events.some((e) => e.t === 'log' && /tentativa 1 falhou: tempo máximo de produção/.test(e.line)));
  assert.ok(project.scenes.every((s) => s.status['image'] !== 'running'));
  assert.equal(project.scenes[0]!.status['image'], 'pending');

  // 10. cancelamento manual continua com a mensagem de sempre
  const manual = new AbortController(); manual.abort();
  const res6 = await runRoute({ project, route: onlyImg, projectDir: dir, deps: mk(), signal: manual.signal, noCache: true, only: { stepIds: ['image'] } });
  assert.equal(res6.error, 'Execução cancelada');

  // 11. cena sem fala (dorama: pausa só com imagem) não vai ao TTS e não derruba a execução
  const tts: Route = {
    id: 'tts', name: 'tts', description: '', videoTypes: [],
    steps: [{ id: 'narration', kind: 'narration', label: 'voz', scope: 'scene', dependsOn: [], enabled: true, params: {},
      retry: { max: 1, backoffMs: 0 }, timeoutSec: 5, bindings: [{ type: 'comfyui', server: 'local', workflow: 'tts.json' }] }],
  };
  project.scenes[0]!.narration = '  ';
  const spoken: string[] = [];
  executors.comfyui = async (c) => {
    if (!c.scene!.narration.trim()) throw new Error('Text cannot be empty.');
    spoken.push(c.scene!.id);
    const f = path.join(c.sceneDir!, 'audio', 'narration.mp3'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x');
    return { files: [f] };
  };
  const res7 = await runRoute({ project, route: tts, projectDir: dir, deps: mk(), signal: new AbortController().signal, noCache: true });
  assert.equal(res7.ok, true, res7.error ?? '');
  assert.deepEqual(spoken, [project.scenes[1]!.id]);
  assert.equal(project.scenes[0]!.status['narration'], 'skipped');


  // 12. modelo local (Ollama em localhost): fila única entre projetos; a espera não conta no tempo máximo
  assert.equal(localModelKey('http://127.0.0.1:11434'), '127.0.0.1:11434');
  assert.equal(localModelKey('https://openrouter.ai/api'), undefined);
  assert.equal(localModelKey('opencode'), undefined);
  const order: string[] = []; let waited = 0;
  const free = new AbortController().signal;
  const r1 = await acquireLocalModel('t:1', free, () => waited++);
  const p2 = acquireLocalModel('t:1', free, () => waited++).then((rel) => { order.push('b'); return rel; });
  const gone = new AbortController();
  const p3 = acquireLocalModel('t:1', gone.signal, () => waited++);
  gone.abort();
  await assert.rejects(p3, /cancelado/);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(order.length, 0, 'segundo pedido espera o primeiro');
  order.push('a'); r1(); r1();
  (await p2)();
  assert.deepEqual(order, ['a', 'b']); assert.equal(waited, 2);
  (await acquireLocalModel('t:1', free, () => waited++))();
  assert.equal(waited, 2, 'fila livre não espera');

  console.log('engine tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
