/* Diagnóstico: por que o harness "auto" escolheu X? Mostra a detecção de cada um. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AUTO_ORDER, detectHarnessAsync, resolveHarness, resolveHarnessCommand } from '../main/harness';
import { defaultSettings } from '../main/settings';

async function main() {
  const file = path.join(process.env.APPDATA ?? '', 'filmforge', 'settings.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = { ...defaultSettings(raw.workspace), ...raw, harnesses: { ...defaultSettings(raw.workspace).harnesses, ...raw.harnesses } };
  for (const id of AUTO_ORDER) {
    const cfg = s.harnesses[id];
    if (!cfg) { console.log(id, '-> (não configurado)'); continue; }
    const d = await detectHarnessAsync(cfg);
    console.log(`${id.padEnd(12)} installed=${String(d.installed).padEnd(5)} ${d.version ?? d.error ?? ''} | promptVia=${cfg.promptVia} | cmd=${resolveHarnessCommand(cfg).command}`);
  }
  try {
    const r = await resolveHarness(s, { type: 'harness', harness: 'auto' });
    console.log('auto →', r.id, '| modelo:', r.model ?? '(padrão)');
  } catch (e) { console.log('auto falhou:', (e as Error).message); }
}
void main();
