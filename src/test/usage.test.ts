import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runRoute, type Executor } from '../main/engine';
import { sceneFileFresh } from '../main/executors';
import { agyJsonArgs, agyStreamLine, AUTO_ORDER, autoOrder, DEFAULT_HARNESSES, parseAgyJson, resolveHarness } from '../main/harness';
import { agyWindows, codexLimitsFrom } from '../main/usage';
import { createProject, defaultSettings } from '../main/settings';
import type { EngineEvent, Route } from '../shared/types';

/** Uso dos harnesses (agy em JSON, Codex, registro por conta) e reservas de harness da rota no motor. */
async function main() {
  /* agy: pede JSON só em modo print e devolve a resposta + o uso real */
  const agy = { ...DEFAULT_HARNESSES.antigravity, command: 'C:\\x\\agy.exe' };
  assert.deepEqual(agyJsonArgs(agy, ['--model', 'm', '--print', 'oi']), { args: ['--model', 'm', '--output-format', 'stream-json', '--print', 'oi'], json: true });
  assert.equal(agyJsonArgs(agy, ['--output-format', 'text', '--print', 'oi']).json, false, 'formato escolhido pelo usuário é respeitado');
  assert.equal(agyJsonArgs(DEFAULT_HARNESSES.claude, ['-p', 'oi']).json, false, 'só o agy');
  const j = parseAgyJson('aviso qualquer\n{"conversation_id":"x","status":"SUCCESS","response":"ok\\n","usage":{"input_tokens":6913,"output_tokens":1,"thinking_tokens":2,"total_tokens":6916}}');
  assert.deepEqual(j, { response: 'ok\n', ok: true, status: 'SUCCESS', usage: { input: 6913, output: 1, thinking: 2, total: 6916 } });
  const bad = parseAgyJson('{"conversation_id":"x","status":"ERROR","response":"falhou"}');
  assert.equal(bad?.ok, false);
  assert.equal(bad?.status, 'ERROR', 'o status real é preservado para o log (o agy pode gravar a cena e ainda assim não concluir)');
  assert.equal(parseAgyJson('texto puro'), undefined);
  /* cena por código: o arquivo gravado NESTA execução vale mesmo com status != success */
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-fresh-'));
  const sceneFile = path.join(freshDir, 'scene.html');
  assert.equal(sceneFileFresh(sceneFile, Date.now()), false, 'arquivo inexistente não vale');
  fs.writeFileSync(sceneFile, '<!doctype html><html></html>');
  assert.equal(sceneFileFresh(sceneFile, Date.now() - 60_000), true, 'gravado nesta execução vale');
  const longAgo = new Date(Date.now() - 600_000);
  fs.utimesSync(sceneFile, longAgo, longAgo);
  assert.equal(sceneFileFresh(sceneFile, Date.now() - 60_000), false, 'arquivo de outra execução não vale');
  /* stream-json: progresso ao vivo e a resposta na linha "result" */
  const stream = [
    '{"event":"init","conversation_id":"c"}',
    '{"event":"step_update","step_update":{"state":"ACTIVE","step_type":"tool","tool_name":"write_file","tool_info":{"parameters":{"Path":"C:\\\\p\\\\kit\\\\scenes\\\\cast.js"}}}}',
    '{"event":"step_update","step_update":{"state":"ACTIVE","step_type":"agent_response","text_delta":"feito"}}',
    '{"event":"result","result":{"status":"SUCCESS","response":"feito\\n","usage":{"input_tokens":10,"output_tokens":2,"thinking_tokens":0,"total_tokens":12}}}',
  ];
  assert.deepEqual(agyStreamLine(stream[1]!), { log: '🔧 write_file …/scenes\\cast.js' });
  assert.deepEqual(agyStreamLine(stream[2]!), { text: 'feito' });
  assert.deepEqual(agyStreamLine(stream[0]!), {});
  assert.deepEqual(parseAgyJson(stream.join('\n')), { response: 'feito\n', ok: true, status: 'SUCCESS', usage: { input: 10, output: 2, thinking: 0, total: 12 } });
  assert.deepEqual(agyJsonArgs(agy, ['--print', 'x']).args, ['--output-format', 'stream-json', '--print', 'x']);

  /* registro do Antigravity por conta: 5 h e 7 dias */
  const now = Date.parse('2026-10-25T20:00:00Z');
  const e = (h: number, account: string | undefined, total: number) => ({ at: new Date(now - h * 3600e3).toISOString(), account, input: total, output: 0, thinking: 0, total, ok: true });
  const w = agyWindows([e(1, 'g1', 100), e(4, 'g1', 50), e(30, 'g1', 1000), e(200, 'g1', 9), e(1, undefined, 7)], 'g1', now);
  assert.deepEqual(w.map((x) => [x.id, x.tokens, x.calls]), [['session', 150, 2], ['week', 1150, 3]]);
  assert.equal(agyWindows([e(1, undefined, 7)], undefined, now)[0]!.tokens, 7, 'sessão do Windows separada');

  /* Codex: último registro de limites (primary = 5 h, secondary = semana) */
  const cx = codexLimitsFrom([
    JSON.stringify({ timestamp: '2026-10-25T10:00:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 5 }, secondary: { used_percent: 1 } } } }),
    JSON.stringify({ timestamp: '2026-10-25T12:00:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 42.5, window_minutes: 300, resets_in_seconds: 3600 }, secondary: { used_percent: 18, resets_at: 1792900000 } } } }),
  ].join('\n'));
  assert.deepEqual(cx.map((x) => [x.id, x.percent]), [['session', 42.5], ['week', 18]]);
  assert.equal(cx[0]!.resetsAt, '2026-10-25T13:00:00.000Z');
  assert.equal(cx[1]!.resetsAt, new Date(1792900000 * 1000).toISOString());

  /* motor: esgotado o harness da etapa (sem outro na cadeia), usa a reserva indicada pela rota */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-usage-'));
  const s = defaultSettings(ws);
  s.harnesses.claude = { ...s.harnesses.claude, command: process.execPath };
  s.harnesses.codex = { ...s.harnesses.codex, command: process.execPath };
  const route: Route = { id: 't', name: 't', description: '', videoTypes: [], harnessFallback: ['codex'],
    steps: [{ id: 'scene_plan', kind: 'scene_plan', label: 'plan', scope: 'project', dependsOn: [], enabled: true, params: {}, retry: { max: 2, backoffMs: 0 }, timeoutSec: 5, bindings: [{ type: 'harness', harness: 'claude' }] }] };
  const project = createProject(s, { name: 'Reserva', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot' });
  const used: string[] = [];
  const executors: Partial<Record<string, Executor>> = {
    harness: async (c) => {
      const b = c.binding as { harness: string };
      used.push(b.harness);
      if (b.harness === 'claude') throw new Error('claude: limite de uso atingido');
      const f = path.join(c.projectDir, 'scenes.json');
      fs.writeFileSync(f, JSON.stringify([{ title: 'A', narration: 'a', visualIntent: 'a' }]));
      return { files: [f] };
    },
  };
  const events: EngineEvent[] = [];
  const res = await runRoute({ project, route, projectDir: path.join(ws, 'projects', project.id), deps: { settings: s, emit: (ev) => events.push(ev), sleep: async () => {}, executors: executors as never }, signal: new AbortController().signal });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(used, ['claude', 'claude', 'codex'], 'esgota as tentativas e cai na reserva');
  assert.ok(events.some((ev) => ev.t === 'log' && /reservas de harness da rota: harness:codex/.test((ev as { line: string }).line)));
  assert.ok(events.some((ev) => ev.t === 'step.fallback'));

  /* sem reserva na rota: os outros harnesses usados na rota (aqui: nenhum além do claude) + instalados; todos falham → etapa falha */
  const r2: Route = { ...route, id: 't2', harnessFallback: undefined };
  s.harnesses.codex = { ...s.harnesses.codex, command: 'nao-existe-xyz' };
  for (const id of ['antigravity', 'opencode', 'openclaw', 'deepseek'] as const) s.harnesses[id] = { ...s.harnesses[id]!, command: 'nao-existe-xyz' };
  used.length = 0;
  const p2 = createProject(s, { name: 'Reserva2', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot' });
  const res2 = await runRoute({ project: p2, route: r2, projectDir: path.join(ws, 'projects', p2.id), deps: { settings: s, emit: () => {}, sleep: async () => {}, executors: executors as never }, signal: new AbortController().signal });
  assert.equal(res2.ok, false);
  assert.deepEqual(used, ['claude', 'claude'], 'nenhuma reserva instalada: não inventa harness');

  /* reservas padrão das Configurações: sem reserva na rota, a das Configurações assume (ex.: Ollama → OpenCode) */
  s.harnesses.opencode = { ...s.harnesses.opencode, command: process.execPath };
  s.harnessFallback = ['opencode'];
  used.length = 0;
  const p3 = createProject(s, { name: 'Reserva3', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot' });
  const res3 = await runRoute({ project: p3, route: r2, projectDir: path.join(ws, 'projects', p3.id), deps: { settings: s, emit: () => {}, sleep: async () => {}, executors: executors as never }, signal: new AbortController().signal });
  assert.equal(res3.ok, true, JSON.stringify(res3));
  assert.deepEqual(used, ['claude', 'claude', 'opencode'], 'reserva das Configurações');
  /* "auto" segue a ordem das reservas: rota/projeto, depois Configurações, depois a fixa */
  assert.deepEqual(autoOrder(s, ['deepseek']).slice(0, 3), ['deepseek', 'opencode', 'claude']);
  assert.deepEqual(autoOrder({}), AUTO_ORDER);
  assert.equal((await resolveHarness(s, { type: 'harness', harness: 'auto' })).id, 'opencode', '"auto" pega a primeira reserva instalada');
  /* Novo projeto com reservas próprias: vão para a rota do projeto (vencem as das Configurações) */
  const p4 = createProject(s, { name: 'Reserva4', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot', harnessFallback: ['codex', 'opencode', 'codex'] });
  assert.deepEqual(p4.route?.harnessFallback, ['codex', 'opencode']);
  assert.equal(createProject(s, { name: 'Reserva5', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot' }).route?.harnessFallback, undefined, 'sem escolha: segue as Configurações');
  /* sem reserva: só o primeiro executor; a etapa falha com o erro dele (nem a cadeia nem as reservas entram) */
  const r3: Route = { ...route, id: 't3', steps: route.steps.map((st) => ({ ...st, bindings: [{ type: 'harness', harness: 'claude' }, { type: 'harness', harness: 'codex' }] })) };
  s.harnesses.codex = { ...s.harnesses.codex, command: process.execPath };
  for (const [nf, proj, expect] of [[true, undefined, ['claude', 'claude']], [undefined, true, ['claude', 'claude']], [true, false, ['claude', 'claude', 'codex']]] as const) {
    s.noFallback = nf;
    used.length = 0;
    const p6 = createProject(s, { name: 'SemReserva', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot', noFallback: proj });
    const res6 = await runRoute({ project: p6, route: { ...r3, noFallback: p6.route?.noFallback }, projectDir: path.join(ws, 'projects', p6.id), deps: { settings: s, emit: () => {}, sleep: async () => {}, executors: executors as never }, signal: new AbortController().signal });
    assert.deepEqual(used, [...expect], `sem reserva (Configurações=${nf}, projeto=${proj})`);
    assert.equal(res6.ok, expect.length === 3);
  }
  delete s.noFallback;
  console.log('usage tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
