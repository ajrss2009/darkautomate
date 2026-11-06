/* Diagnóstico: resolve o harness/modelo da rota com o Antigravity CLI de verdade. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProject, defaultSettings, projectsDir } from '../main/settings';
import { runRoute } from '../main/engine';
import { createExecutors } from '../main/executors';
import { detectHarnessAsync, listHarnessModels, resolveHarnessCommand } from '../main/harness';
import type { EngineEvent, Route } from '../shared/types';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-agy-'));
  const s = defaultSettings(ws);
  const cfg = s.harnesses.antigravity;
  console.log('1) comando resolvido:', JSON.stringify(resolveHarnessCommand(cfg)));
  console.log('2) detecção:', JSON.stringify(await detectHarnessAsync(cfg)));
  const models = await listHarnessModels(cfg);
  console.log('3) modelos resolvidos:', models.length, '->', models.slice(0, 4).join(', '), '…');
  const model = models.find((m) => m.includes('flash-low')) ?? models[0]!;
  console.log('4) modelo escolhido para o teste:', model);

  const route: Route = {
    id: 'teste-agy', name: 'Teste agy', description: '', videoTypes: [],
    steps: [{
      id: 'script', kind: 'script', label: 'Roteiro', scope: 'project', dependsOn: [], enabled: true, params: {},
      retry: { max: 0, backoffMs: 100 }, timeoutSec: 300,
      bindings: [{ type: 'harness', harness: 'antigravity', model }],
    }],
  };
  const p = createProject(s, { name: 'Teste agy', idea: 'Explique em duas frases como um satélite funciona', videoType: 'custom', skillId: 'vector', routeId: 'explainer-mixed' });
  p.route = route; p.routeId = route.id;
  const dir = path.join(projectsDir(s), p.id);
  fs.mkdirSync(dir, { recursive: true });

  const ev: EngineEvent[] = [];
  const r = await runRoute({
    project: p, route, projectDir: dir, signal: new AbortController().signal, noCache: true,
    deps: { settings: s, emit: (e) => { ev.push(e); if (e.t === 'log') console.log('   log:', e.line); }, executors: createExecutors({ workflowsDir: ws }) },
  });
  console.log('5) resultado da execução:', JSON.stringify(r));
  const pre = ev.find((e) => e.t === 'run.preflight') as Extract<EngineEvent, { t: 'run.preflight' }> | undefined;
  console.log('6) pré-checagem publicada:', JSON.stringify(pre?.steps));
  const stepStart = ev.find((e) => e.t === 'step.start') as Extract<EngineEvent, { t: 'step.start' }> | undefined;
  console.log('7) binding do step.start:', stepStart?.binding);
  const f = path.join(dir, 'script.md');
  console.log('8) script.md gerado?', fs.existsSync(f));
  if (fs.existsSync(f)) console.log('   conteúdo:', fs.readFileSync(f, 'utf8').slice(0, 220).replace(/\n/g, ' '));
}
void main();
