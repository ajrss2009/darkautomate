/**
 * Diagnóstico temporário: mostra o que o `harness: auto` enxerga em cada harness.
 * Rode com: ELECTRON_RUN_AS_NODE=1 FilmForge.exe dist/test/harness.diag.js
 */
import { DEFAULT_HARNESSES, detectHarness, commandExists, resolveHarness, AUTO_ORDER } from '../main/harness';
import type { HarnessConfig, Settings } from '../shared/types';

const cfg = (id: keyof typeof DEFAULT_HARNESSES, command?: string): HarnessConfig =>
  ({ ...DEFAULT_HARNESSES[id], ...(command ? { command } : {}) });

const harnesses = {
  claude: cfg('claude'),
  codex: cfg('codex'),
  opencode: cfg('opencode', process.env.FORGE_OPENCODE ?? 'opencode'),
  antigravity: cfg('antigravity'),
  openclaw: cfg('openclaw'),
  ollama: cfg('ollama'),
};

console.log('--- detectHarness ---');
for (const [id, c] of Object.entries(harnesses)) {
  const d = detectHarness(c);
  console.log(id.padEnd(12), d.installed ? 'INSTALADO' : 'ausente   ', (d.version ?? d.error ?? '').slice(0, 90));
}

console.log('\n--- casos de borda ---');
console.log('comando inexistente:', JSON.stringify(detectHarness({ command: 'comando-inexistente-xyz', args: [], promptVia: 'stdin', models: [] })));
console.log('commandExists(inexistente):', commandExists('comando-inexistente-xyz'));
console.log('commandExists(node):', commandExists(process.execPath));

console.log('\n--- resolveHarness(auto) ---');
const settings = { harnesses } as unknown as Settings;
resolveHarness(settings, { type: 'harness', harness: 'auto', model: 'auto' })
  .then((r) => console.log('escolhido:', r.id, '| modelo:', r.model ?? '(padrão)', '| ordem:', AUTO_ORDER.join(' > ')))
  .catch((e) => console.log('erro:', (e as Error).message));

console.log('\n--- configuração real do app (%APPDATA%\\filmforge\\settings.json) ---');
try {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const file = path.join(process.env.APPDATA ?? '', 'filmforge', 'settings.json');
  const real = JSON.parse(fs.readFileSync(file, 'utf8')) as Settings;
  const oc = real.harnesses.opencode;
  console.log('opencode.command:', oc.command);
  console.log('opencode.args   :', JSON.stringify(oc.args));
  resolveHarness(real, { type: 'harness', harness: 'auto', model: 'auto' })
    .then((r) => console.log('pick real:', r.id, '| modelo:', r.model ?? '(padrão)'))
    .catch((e) => console.log('pick real erro:', (e as Error).message));
} catch (e) { console.log('não li a configuração real:', (e as Error).message); }
