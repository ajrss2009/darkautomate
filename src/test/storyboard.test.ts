import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runRoute, type Executor } from '../main/engine';
import { createProject, defaultSettings } from '../main/settings';
import { buildStoryboard, needsApproval, planHash, readStoryboard, storyboardHtml, writeStoryboard } from '../main/project-storyboard';
import type { EngineEvent, Project, Route, Scene } from '../shared/types';

const sc = (i: number, o: Partial<Scene> = {}): Scene => ({ id: `s${i}`, index: i, title: `Cena ${i}`, narration: 'uma frase curta de narração aqui', visualIntent: `visual ${i}`, kind: 'image', status: {}, artifacts: {}, ...o });

async function main() {
  /* ───────── storyboard puro ───────── */
  const p = { id: 'p1', name: 'Teste <b>', targetDurationSec: 30, scenes: [sc(2, { durationSec: 10 }), sc(1, { durationSec: 5, camera: 'push-in lento', sfx: ['whoosh'] }), sc(3, { durationSec: 15 })],
    skill: { id: 'k', name: 'k', description: '', global: '', steps: {}, formatDna: { acts: [{ name: 'Gancho', pct: 20 }, { name: 'Miolo', pct: 50 }, { name: 'Final', pct: 30 }] } } } as unknown as Project;
  const b = buildStoryboard(p);
  assert.deepEqual(b.panels.map((x) => x.index), [1, 2, 3], 'em ordem de cena');
  assert.equal(b.panels[0]!.from, 0); assert.equal(b.panels[1]!.from, 5); assert.equal(b.panels[2]!.to, 30); assert.equal(b.totalSec, 30);
  assert.deepEqual(b.panels.map((x) => x.act), ['Gancho', 'Miolo', 'Final'], 'cada quadro no ato do DNA');
  assert.equal(b.panels[0]!.camera, 'push-in lento'); assert.deepEqual(b.panels[0]!.sfx, ['whoosh']);
  const est = buildStoryboard({ ...p, scenes: [sc(1, { narration: Array(26).fill('palavra').join(' ') })] });
  assert.equal(est.panels[0]!.durationSec, 10, 'sem duração: pela narração (2,6 palavras/s)');
  const html = storyboardHtml(b, 'C:\\proj');
  assert.match(html, /Storyboard — Teste &lt;b&gt;/, 'título escapado'); assert.equal((html.match(/<article>/g) ?? []).length, 3);
  assert.match(html, /prefers-color-scheme:dark/);

  /* hash: muda quando o plano muda; aprovação vale para o plano aprovado */
  const h1 = planHash(p.scenes);
  assert.equal(planHash([...p.scenes]), h1);
  assert.notEqual(planHash([{ ...p.scenes[0]!, narration: 'outra' }, ...p.scenes.slice(1)]), h1);
  const pp = { ...p, storyboard: { enabled: true, approval: true } } as Project;
  assert.equal(needsApproval(pp), true);
  pp.storyboard!.approvedHash = h1;
  assert.equal(needsApproval(pp), false);
  assert.equal(needsApproval({ ...pp, scenes: [sc(9)] }), true, 'editar as cenas pede aprovação de novo');
  assert.equal(needsApproval({ ...pp, storyboard: { enabled: true } }), false, 'sem a opção de aprovação não pausa');

  /* ───────── motor: storyboard depois do plano + pausa para aprovação ───────── */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-storyboard-'));
  const settings = defaultSettings(ws);
  settings.harnesses.claude = { ...settings.harnesses.claude, command: process.execPath };
  const project = createProject(settings, { name: 'SB', idea: 'ideia', videoType: 'custom', routeId: 'shorts-autopilot', storyboard: { enabled: true, approval: true } });
  assert.deepEqual(project.storyboard, { enabled: true, approval: true }, 'a opção do Novo projeto fica no projeto');
  assert.equal(createProject(settings, { name: 'Sem', idea: 'i', videoType: 'custom', routeId: 'shorts-autopilot' }).storyboard, undefined);
  const dir = path.join(ws, 'projects', project.id);
  const route: Route = { id: 't', name: 't', description: '', videoTypes: [], steps: [
    { id: 'scene_plan', kind: 'scene_plan', label: 'plan', scope: 'project', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 5, bindings: [{ type: 'harness', harness: 'claude' }] },
    { id: 'image', kind: 'image', label: 'img', scope: 'scene', dependsOn: ['scene_plan'], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 5, bindings: [{ type: 'manual' }] },
  ] };
  let images = 0;
  const executors: Partial<Record<string, Executor>> = {
    harness: async (c) => { const f = path.join(c.projectDir, 'scenes.json'); fs.writeFileSync(f, JSON.stringify([{ title: 'A', narration: 'a b c', visualIntent: 'va', durationSec: 4 }, { title: 'B', narration: 'd e', visualIntent: 'vb', durationSec: 3 }])); return { files: [f] }; },
    manual: async (c) => { images++; const f = path.join(c.sceneDir!, 'frame.png'); fs.mkdirSync(c.sceneDir!, { recursive: true }); fs.writeFileSync(f, 'x'); return { files: [f] }; },
  };
  const events: EngineEvent[] = [];
  let asked = 0;
  const deps = (answer?: boolean) => ({ settings, emit: (e: EngineEvent) => events.push(e), sleep: async () => {}, executors: executors as never,
    ...(answer === undefined ? {} : { approve: async (stepId: string) => { asked++; assert.equal(stepId, 'storyboard'); return answer; } }) });

  /* reprovado: para antes das cenas */
  const r1 = await runRoute({ project, route, projectDir: dir, deps: deps(false), signal: new AbortController().signal });
  assert.equal(r1.ok, false); assert.match(r1.error ?? '', /reprovado/); assert.equal(images, 0, 'nenhuma cena produzida');
  assert.ok(fs.existsSync(path.join(dir, 'out', 'storyboard.html')) && readStoryboard(dir)?.panels.length === 2);
  const wait = events.find((e) => e.t === 'gate.waiting') as Extract<EngineEvent, { t: 'gate.waiting' }> | undefined;
  assert.equal(wait?.stepId, 'storyboard'); assert.ok(wait?.storyboard?.endsWith('storyboard.html'));

  /* sem quem aprove (lote/MCP): para com a instrução */
  const r2 = await runRoute({ project, route, projectDir: dir, deps: deps(), signal: new AbortController().signal });
  assert.equal(r2.ok, false); assert.match(r2.error ?? '', /aguardando aprovação/);

  /* aprovado: segue e grava o hash; a próxima execução (cache) não pergunta de novo */
  const r3 = await runRoute({ project, route, projectDir: dir, deps: deps(true), signal: new AbortController().signal });
  assert.equal(r3.ok, true, r3.error); assert.equal(images, 2); assert.equal((project as Project).storyboard?.approvedHash, planHash(project.scenes));
  const before = asked;
  const r4 = await runRoute({ project, route, projectDir: dir, deps: deps(false), signal: new AbortController().signal });
  assert.equal(r4.ok, true, 'plano já aprovado: não pausa'); assert.equal(asked, before);
  assert.equal((JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')) as Project).storyboard?.approvedHash, planHash(project.scenes), 'aprovação gravada no projeto');

  /* só storyboard (sem aprovação): cria e segue */
  const p2 = createProject(settings, { name: 'SB2', idea: 'ideia', videoType: 'custom', routeId: 'shorts-autopilot', storyboard: { enabled: true, approval: false } });
  const r5 = await runRoute({ project: p2, route, projectDir: path.join(ws, 'projects', p2.id), deps: deps(), signal: new AbortController().signal });
  assert.equal(r5.ok, true, r5.error); assert.ok(readStoryboard(path.join(ws, 'projects', p2.id)));
  assert.equal(writeStoryboard(p2, path.join(ws, 'projects', p2.id)).board.panels.length, 2);

  console.log('storyboard: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
