import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { hasMarks, mark, stepSchema, stripMarks, strictSplit } from '../shared/strict';
import { DEFAULT_HARNESSES, runHarness } from '../main/harness';
import { buildPrompt, buildPromptMarked } from '../main/prompts';
import { cartoon3dApiFrom, cartoon3dApiProblem, CARTOON3D_SKILL_ID } from '../main/cartoon3d';
import { cacheKey, sceneProject } from '../main/engine';
import { createProject, defaultSettings } from '../main/settings';
import { BUILTIN_SKILLS } from '../main/skills-builtin';
import type { ExecContext } from '../main/engine';
import type { Scene } from '../shared/types';

/** Modo estrito dos modelos locais (sistema + XML + JSON schema + validador) e regenerar cena com outra skill/plugin. */
async function main() {
  /* 1) pedido marcado → sistema com as regras em XML + tarefa isolada */
  const prompt = `Cabeça do pedido.\n${mark('skill', 'Use cenas de 10 s.')}\n${mark('plugin', 'Plugin X: chame L.walk().')}\nTarefa: anime a cena 3.\n${mark('api', 'st.actor(outfit) · st.render()')}\nParta deste esqueleto:\n${mark('example', '<script>st.render()</script>')}`;
  assert.ok(hasMarks(prompt) && !hasMarks(stripMarks(prompt)));
  assert.match(stripMarks(prompt), /Use cenas de 10 s\.[\s\S]*Plugin X[\s\S]*st\.actor/, 'sem as marcas o conteúdo fica igual');
  const sp = strictSplit(prompt)!;
  assert.match(sp.system, /Você DEVE seguir APENAS[\s\S]*ESTRITAMENTE PROIBIDO inventar[\s\S]*<skill_instructions>\nUse cenas de 10 s\.\n<\/skill_instructions>[\s\S]*<plugin_instructions>[\s\S]*<library_api>\nst\.actor[\s\S]*<examples>\n<script>/);
  assert.match(sp.user, /^<task>\nCabeça do pedido\.[\s\S]*Tarefa: anime a cena 3\.[\s\S]*veja o modelo de código em <examples>[\s\S]*<\/task>$/);
  assert.doesNotMatch(sp.user, /Use cenas de 10 s|L\.walk|⟦/, 'regras fora da tarefa');
  assert.equal(strictSplit('pedido sem regras'), undefined);
  assert.ok(stepSchema('scene_plan') && stepSchema('metadata') && !stepSchema('code_scene'));

  /* 2) pedidos reais: marcados para os locais, limpos para os outros */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-strict-'));
  const s = defaultSettings(ws);
  const p = createProject(s, { name: 'Estrito', idea: 'lei seca', videoType: 'custom', skillId: CARTOON3D_SKILL_ID } as never);
  const dir = path.join(ws, 'projects', p.id), sceneDir = path.join(dir, 'scenes', 's01');
  const scene: Scene = { id: 's01', index: 1, title: 'Gancho', narration: 'Em 1920…', visualIntent: 'rua', kind: 'code', durationSec: 4, status: {}, artifacts: {} };
  p.scenes = [scene];
  const step = p.route!.steps.find((x) => x.kind === 'code_scene')!;
  const ctx = { settings: s, project: p, projectDir: dir, sceneDir, scene, outDir: path.join(dir, 'out'), step, binding: step.bindings[0], signal: new AbortController().signal, log: () => {} } as unknown as ExecContext;
  const marked = buildPromptMarked(ctx), clean = buildPrompt(ctx);
  assert.match(marked, /⟦skill⟧[\s\S]*⟦\/skill⟧[\s\S]*⟦api⟧[\s\S]*st\.actor\([\s\S]*⟦\/api⟧[\s\S]*⟦example⟧[\s\S]*import \* as C from "cartoon3d"[\s\S]*⟦\/example⟧/);
  assert.ok(!hasMarks(clean) && clean.includes('import * as C from "cartoon3d"'), 'CLIs recebem o pedido de sempre');
  const ss = strictSplit(marked)!;
  assert.match(ss.system, /<library_api>[\s\S]*st\.actor\(/); assert.doesNotMatch(ss.user, /<library_api>/);

  /* 3) servidor local (OpenAI-compatível): mensagem de sistema + response_format com o esquema; servidor antigo → sem esquema */
  const bodies: any[] = [];
  let refuseSchema = false;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
      const j = JSON.parse(b); bodies.push(j);
      if (refuseSchema && j.response_format) { res.writeHead(400); res.end('{"error":"response_format not supported"}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '[{"id":"s01","title":"A","narration":"x","visualIntent":"y","kind":"code","durationSec":5}]' }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  const cfg = { ...DEFAULT_HARNESSES.lmstudio, command: `http://127.0.0.1:${port}`, defaultModel: 'qwen-9b', models: ['qwen-9b'] };
  const logs: string[] = [];
  const r1 = await runHarness(cfg, { cwd: ws, prompt: marked, signal: new AbortController().signal, onLine: (l) => logs.push(l), schema: stepSchema('scene_plan') });
  assert.ok(r1.ok && /"durationSec":5/.test(r1.stdout));
  const b1 = bodies[0];
  assert.equal(b1.messages[0].role, 'system'); assert.match(b1.messages[0].content, /<library_api>/);
  assert.equal(b1.messages[1].role, 'user'); assert.match(b1.messages[1].content, /^<task>/);
  assert.equal(b1.response_format?.type, 'json_schema'); assert.equal(b1.response_format.json_schema.schema.type, 'array');
  assert.ok(!b1.tools, 'com esquema, sem ferramentas');
  assert.ok(logs.some((l) => /modo estrito/.test(l)) && logs.some((l) => /decodificação guiada/.test(l)));
  refuseSchema = true; bodies.length = 0;
  const r2 = await runHarness(cfg, { cwd: ws, prompt: marked, signal: new AbortController().signal, onLine: (l) => logs.push(l), schema: stepSchema('scene_plan') });
  assert.ok(r2.ok && bodies.length === 2 && !bodies[1].response_format, 'servidor sem suporte: repete sem o esquema');
  /* modo estrito desligado: mensagem única, sem marcas */
  bodies.length = 0; refuseSchema = false;
  await runHarness({ ...cfg, strict: false }, { cwd: ws, prompt: marked, signal: new AbortController().signal });
  assert.equal(bodies[0].messages.length, 1); assert.ok(!hasMarks(bodies[0].messages[0].content));
  srv.close();

  /* 4) validador da API cartoon3d (API lida do bundle real) */
  const api = cartoon3dApiFrom(fs.readFileSync(path.join('vendor', 'cartoon3d', 'cartoon3d.js'), 'utf8'));
  assert.ok(api.c.has('createStage') && api.c.has('OUTFITS') && api.stage.has('actor') && api.stage.has('render') && api.stage.has('scene') && api.actor.has('set'));
  const page = (body: string) => `<script type="module">import * as C from "cartoon3d"; const st = C.createStage({}); const a = st.actor(C.OUTFITS.police, {}); ${body}</script>`;
  assert.equal(cartoon3dApiProblem(page('a.set({ x: 1 }); st.cam([0,1,2],[0,1,0]); st.render(); st.scene.add(x); // st.inventada() no comentário'), api), undefined, 'API real: ok');
  const bad = cartoon3dApiProblem(page('st.voar(); a.pular(); C.Magica(); st.render();'), api)!;
  assert.match(bad, /^Erro: .* não estão definidas em <library_api>[\s\S]*Reescreva o código usando APENAS os métodos permitidos[\s\S]*actor/);
  for (const n of ['st.voar', 'a.pular (ator)', 'C.Magica']) assert.ok(bad.split(' não estão')[0]!.includes(n), n);
  assert.doesNotMatch(bad.split(' não estão')[0]!, /st\.render|C\.createStage/, 'o que existe não é apontado');
  assert.equal(cartoon3dApiProblem(page('if (a.root) a.root.visible = false; a.group?.add(x); st.render();'), api), undefined, 'acesso defensivo não conta');

  /* 5) regenerar com outra skill/plugin: só a cena vê a troca, e o cache muda */
  const other = BUILTIN_SKILLS.find((k) => k.id === 'cartoon-3d')!;
  const sc2: Scene = { ...scene, skillOverride: other, pluginsOverride: ['meu-plugin'] };
  const eff = sceneProject(p, sc2);
  assert.equal(eff.skill?.id, 'cartoon-3d'); assert.deepEqual(eff.plugins, ['meu-plugin']);
  assert.equal(sceneProject(p, scene), p, 'sem troca: o próprio projeto');
  assert.notEqual(cacheKey(p, step, step.bindings[0]!, sc2), cacheKey(p, step, step.bindings[0]!, scene), 'outra skill = outra chave de cache');
  assert.equal(cacheKey(p, step, step.bindings[0]!, scene), cacheKey(p, step, step.bindings[0]!, { ...scene }), 'cenas sem troca mantêm o cache');
  const effPrompt = buildPrompt({ ...ctx, project: eff, scene: sc2 } as ExecContext);
  assert.match(effPrompt, /EPISÓDIO ANIMADO/, 'a cena usa as instruções da outra skill');
  console.log('strict tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
