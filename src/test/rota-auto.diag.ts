/* Diagnóstico do cenário real: rota embutida (textChain auto) → qual provedor roda?
   Usa as configurações reais do app, mas num workspace temporário. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runRoute } from '../main/engine';
import { createExecutors } from '../main/executors';
import { defaultSettings, createProject, projectsDir } from '../main/settings';
import type { EngineEvent } from '../shared/types';

async function main() {
  const real = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA ?? '', 'filmforge', 'settings.json'), 'utf8'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-auto-'));
  const s = { ...defaultSettings(ws), harnesses: { ...defaultSettings(ws).harnesses, ...real.harnesses } };
  const p = createProject(s, { name: 'Teste auto', idea: 'Escreva duas frases sobre satélites.', videoType: 'custom', skillId: 'vector', routeId: 'shorts-autopilot' });
  const steps = (p.route?.steps ?? []).filter((x) => x.kind === 'script');
  console.log('cadeia do script:', JSON.stringify(steps[0]?.bindings.map((b) => b.type === 'harness' ? `harness:${b.harness}${b.model ? '/' + b.model : ''}` : b.type)));
  const ev: EngineEvent[] = [];
  const t0 = Date.now();
  const r = await runRoute({
    project: p, route: p.route!, projectDir: path.join(projectsDir(s), p.id), signal: new AbortController().signal, noCache: true,
    only: { stepIds: ['script'] },
    deps: { settings: s, emit: (e) => { ev.push(e); if (e.t === 'log') console.log('  log:', e.line.slice(0, 180)); }, executors: createExecutors({ workflowsDir: ws }) },
  });
  console.log('resultado:', JSON.stringify(r), `em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const starts = ev.filter((e) => e.t === 'step.start').map((e) => (e as { binding: string }).binding);
  const fbs = ev.filter((e) => e.t === 'step.fallback').map((e) => (e as { from: string; to: string }).from);
  console.log('bindings tentados:', JSON.stringify(starts));
  console.log('pulados por não instalar:', JSON.stringify(fbs));
  const f = path.join(projectsDir(s), p.id, 'script.md');
  console.log('script.md gerado?', fs.existsSync(f), fs.existsSync(f) ? `(${fs.statSync(f).size} bytes)` : '');
}
void main();
