import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProject, defaultSettings, listProjects } from '../main/settings';
import * as ops from '../main/ops';
import { BatchRunner } from '../main/batch';
import { extractJson, rewriteScenes } from '../main/editor';
import { runRoute } from '../main/engine';
import { applyExecutorProfile, applyStepBindings, profileSkips } from '../shared/profiles';
import type { Binding, EngineEvent, Route, Scene } from '../shared/types';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-ops-'));
  const s = defaultSettings(ws);

  // ── CRUD de projetos
  const p = createProject(s, { name: 'Original', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot' });
  for (const t of ['A', 'B', 'C']) ops.addScene(s, p, null, { title: t, narration: `fala ${t}`, visualIntent: `visual ${t}`, durationSec: 3 });
  ops.saveProjectFile(s, p);
  assert.equal(p.scenes.length, 3);
  assert.deepEqual(p.scenes.map((x) => x.index), [1, 2, 3]);
  assert.ok(fs.existsSync(path.join(ws, 'projects', p.id, 'scenes.json')));

  // artefato fictício + duplicar projeto reescreve caminhos absolutos
  const sc0 = p.scenes[0]!;
  const art = path.join(ws, 'projects', p.id, 'scenes', sc0.id, 'frames', 'frame.png');
  fs.mkdirSync(path.dirname(art), { recursive: true }); fs.writeFileSync(art, 'png');
  sc0.artifacts['image'] = [art]; sc0.status['image'] = 'done'; ops.saveProjectFile(s, p);
  const dup = ops.duplicateProject(s, p.id);
  assert.notEqual(dup.id, p.id);
  assert.ok(dup.scenes[0]!.artifacts['image']![0]!.includes(dup.id), 'caminho do artefato deve apontar para a cópia');
  assert.ok(fs.existsSync(dup.scenes[0]!.artifacts['image']![0]!));
  assert.equal(listProjects(s).length, 2);

  ops.updateProject(s, dup.id, { name: 'Renomeado' });
  assert.equal(ops.readProject(s, dup.id).name, 'Renomeado');
  ops.deleteProject(s, dup.id);
  assert.equal(listProjects(s).length, 1);
  assert.throws(() => ops.deleteProject(s, '../etc'), /inválido/);
  assert.throws(() => ops.deleteProject(s, 'nao-existe'), /não encontrado/);

  // ── CRUD de cenas
  const q = ops.readProject(s, p.id);
  const [A, B, C] = q.scenes as [Scene, Scene, Scene];
  ops.moveScene(q, C.id, 0);
  assert.deepEqual(q.scenes.map((x) => x.title), ['C', 'A', 'B']);
  assert.deepEqual(q.scenes.map((x) => x.index), [1, 2, 3]);
  const flags = ops.updateScene(q, A.id, { narration: 'nova fala', durationSec: 7 });
  assert.deepEqual(flags, { visual: false, audio: true });
  assert.equal(q.scenes.find((x) => x.id === A.id)!.manualDuration, true);
  assert.equal(q.scenes.find((x) => x.id === A.id)!.status['narration'] ?? 'pending', 'pending');
  const f2 = ops.updateScene(q, A.id, { visualIntent: 'outro visual', kind: 'code' });
  assert.deepEqual(f2, { visual: true, audio: false });
  // status 'done' vira 'stale'
  q.scenes.find((x) => x.id === A.id)!.status['image'] = 'done';
  ops.updateScene(q, A.id, { visualIntent: 'mais um visual' });
  assert.equal(q.scenes.find((x) => x.id === A.id)!.status['image'], 'stale');
  // patch inválido é ignorado
  ops.updateScene(q, B.id, { kind: 'xyz' as never, durationSec: -5, title: 'B2' });
  const b = q.scenes.find((x) => x.id === B.id)!;
  assert.equal(b.kind, 'image'); assert.equal(b.durationSec, 3); assert.equal(b.title, 'B2');
  const copy = ops.duplicateScene(s, q, A.id);
  assert.equal(q.scenes.length, 4); assert.notEqual(copy.id, A.id);
  ops.deleteScene(s, q, copy.id);
  assert.equal(q.scenes.length, 3);
  assert.throws(() => ops.updateScene(q, 'zzz', {}), /não existe/);
  assert.deepEqual(ops.stepsFor(q.route, { visual: false, audio: true }), ['narration', 'transcribe', 'code_scene', 'motion']);

  // ── extractJson
  assert.deepEqual(extractJson('texto antes ```json\n{"a":1}\n``` depois'), { a: 1 });
  assert.deepEqual(extractJson('Claro! [{"id":"s1"}] pronto'), [{ id: 's1' }]);
  assert.throws(() => extractJson('sem json'), /JSON/);

  // ── edição por prompt com harness falso (script Node que devolve patches)
  const patchObj = {
    patches: [
      { id: A.id, narration: 'texto reescrito pela IA', visualIntent: 'cena reescrita' },
      { id: B.id, title: 'Intocável?' },
      { id: 'fora', title: 'x' },
    ],
    insertAfter: [{ afterId: A.id, scene: { title: 'Extra', narration: 'cena extra', visualIntent: 'v', durationSec: 2 } }],
    delete: [C.id],
  };
  const fakeJs = path.join(ws, 'fake-llm.cjs');
  fs.writeFileSync(fakeJs, `const fs=require('fs');fs.writeFileSync('patch.json',${JSON.stringify(JSON.stringify(patchObj))});console.log('ok');\n`);
  // .cmd evita problemas de quoting do cmd.exe com caminhos que têm espaço
  const fakeCmd = path.join(ws, 'fake-llm.cmd');
  fs.writeFileSync(fakeCmd, `@"${process.execPath}" "${fakeJs}" %*\r\n`);
  s.harnesses.claude = { command: fakeCmd, args: [], promptVia: 'stdin', models: [] };
  // 'auto' precisa ser determinístico: só o harness falso responde
  for (const id of ['codex', 'opencode', 'antigravity', 'openclaw', 'ollama', 'llamacpp', 'lmstudio'] as const) {
    s.harnesses[id] = { ...s.harnesses[id], command: 'comando-inexistente-xyz' };
  }
  const route = q.route!;
  const sel = [A.id, B.id];
  const res = await rewriteScenes({ settings: s, project: q, projectDir: path.join(ws, 'projects', p.id), route, sceneIds: sel, instruction: 'teste', signal: new AbortController().signal, log: () => {}, allowStructure: true });
  assert.ok(res.changed.includes(A.id));
  assert.ok(!res.changed.includes(B.id), 'mudança só de título não exige regenerar');
  assert.equal(q.scenes.find((x) => x.id === B.id)!.title, 'Intocável?');
  assert.equal(q.scenes.find((x) => x.id === A.id)!.narration, 'texto reescrito pela IA');
  assert.ok(q.scenes.some((x) => x.title === 'Extra'), 'cena inserida');
  assert.ok(q.scenes.some((x) => x.id === C.id), 'C não estava selecionada: não pode ser apagada');
  assert.ok(!q.scenes.some((x) => x.title === 'x'), 'id fora da seleção é ignorado');
  assert.equal(res.flags.audio, true);

  // ── re-execução: scene_plan em cache NÃO apaga edições manuais
  ops.saveProjectFile(s, q);
  const mini = { ...route, steps: route.steps.filter((x) => x.id === 'scene_plan' || x.id === 'script') };
  const noop = async (c: { step: { kind: string }; projectDir: string }) => {
    const f = path.join(c.projectDir, c.step.kind === 'script' ? 'script.md' : 'scenes.json');
    if (c.step.kind === 'script') fs.writeFileSync(f, 'roteiro');
    else if (!fs.existsSync(f)) fs.writeFileSync(f, '[{"title":"gerada"}]');
    return { files: [f] };
  };
  const dir = path.join(ws, 'projects', p.id);
  const ev: EngineEvent[] = [];
  const mk = () => ({ settings: s, emit: (e: EngineEvent) => ev.push(e), sleep: async () => {}, executors: { harness: noop as never, api: noop as never } });
  await runRoute({ project: q, route: mini, projectDir: dir, deps: mk(), signal: new AbortController().signal });
  const titlesBefore = q.scenes.map((x) => x.title);
  await runRoute({ project: q, route: mini, projectDir: dir, deps: mk(), signal: new AbortController().signal });
  assert.deepEqual(q.scenes.map((x) => x.title), titlesBefore, 'segunda execução (cache) preserva cenas editadas');

  // ── lote: concorrência e falhas isoladas
  const order: string[] = [];
  let active = 0, peak = 0;
  const bev: EngineEvent[] = [];
  const br = new BatchRunner(async (id) => {
    active++; peak = Math.max(peak, active); order.push(id);
    await new Promise((r) => setTimeout(r, 15)); active--;
    return id === 'p3' ? { ok: false, error: 'boom' } : { ok: true };
  }, (e) => bev.push(e));
  const jobs = await br.run(['p1', 'p2', 'p3', 'p4', 'p5'], 2);
  assert.equal(peak, 2); assert.equal(order.length, 5);
  assert.deepEqual(jobs.map((j) => j.ok), [true, true, false, true, true]);
  const last = bev[bev.length - 1] as Extract<EngineEvent, { t: 'batch.update' }>;
  assert.ok(last.finished && last.done === 5 && last.failed === 1);
  // refazer falhas no fim da fila: p3 falha na 1ª e passa na 2ª; p5 falha sempre
  const tries: Record<string, number> = {};
  const bev3: EngineEvent[] = [];
  const br3 = new BatchRunner(async (id) => {
    tries[id] = (tries[id] ?? 0) + 1;
    return (id === 'p3' && tries[id] === 1) || id === 'p5' ? { ok: false, error: 'laço' } : { ok: true };
  }, (e) => bev3.push(e));
  const j3 = await br3.run(['p1', 'p3', 'p5'], 1, 2);
  assert.deepEqual(j3.map((j) => [j.ok, j.tries]), [[true, 1], [true, 2], [false, 3]], 'refaz só os que falharam, até 2 rodadas');
  const last3 = bev3.filter((e) => e.t === 'batch.update').pop() as Extract<EngineEvent, { t: 'batch.update' }>;
  assert.ok(last3.finished && last3.done === 3 && last3.failed === 1, 'contagem final: só p5 falhou');
  assert.ok(bev3.some((e) => e.t === 'log' && /refazendo 2 projeto/.test(e.line)));
  // cancelamento
  const br2 =new BatchRunner(async () => { br2.cancel(); return { ok: true }; }, () => {});
  const j2 = await br2.run(['a', 'b', 'c'], 1);
  assert.equal(j2.filter((j) => j.ok !== undefined).length, 1);
  /* cancelar o lote aborta SÓ os projetos dele — um projeto iniciado à mão não cai junto */
  const aborted: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const br4 = new BatchRunner(async () => { await gate; return { ok: true }; }, () => {}, (id) => aborted.push(id));
  const p4 = br4.run(['a', 'b', 'c'], 2);
  await new Promise((r) => setTimeout(r, 20));
  br4.cancel();
  release();
  const j4 = await p4;
  assert.deepEqual([...aborted].sort(), ['a', 'b'], 'aborta só os ativos do lote (a e b), não o resto');
  assert.equal(j4.find((j) => j.id === 'c')!.ok, undefined, 'o que não começou não roda');

  /* escolha explícita de executor vence o workflow que é "a função da etapa" (elenco/loop) */
  const castRoute = {
    id: 'r', name: 'r', description: '', videoTypes: [], steps: [{
      id: 'video', kind: 'video', label: 'v', scope: 'scene', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 60,
      bindings: [{ type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v-cast.json' }], onFail: 'skip',
    }],
  } as unknown as Route;
  const snapgen = { type: 'api', provider: 'snapgen', model: 'veo-3' } as Binding;
  assert.equal(profileSkips(castRoute.steps[0]!), true, 'perfil automático não troca o workflow de elenco');
  assert.equal(profileSkips(castRoute.steps[0]!, true), false, 'escolha explícita pode trocar');
  const applied = applyExecutorProfile(castRoute, { id: 'p', name: 'p', chains: { video: [snapgen] } }, true);
  assert.deepEqual(applied.steps[0]!.bindings[0], snapgen, 'a API escolhida vira o executor principal');
  assert.equal(applied.steps[0]!.bindings[1]!.type, 'comfyui', 'o workflow de elenco fica como reserva');
  assert.equal(applyExecutorProfile(castRoute, { id: 'p', name: 'p', chains: { video: [snapgen] } }).steps[0]!.bindings[0]!.type, 'comfyui', 'sem escolha explícita, o workflow da rota fica intacto');
  assert.deepEqual(applyStepBindings(castRoute, { video: snapgen }).steps[0]!.bindings[0], snapgen, 'executor por etapa também vence');

  console.log('ops/editor/batch tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
