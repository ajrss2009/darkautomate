/* Empacota em uma pasta própria porque a pasta `release` original ficou com
   arquivos travados por cópia/sincronização do drive ("Acesso negado" no
   chrome_100_percent.pak). `dist-build/win-unpacked` é limpo antes de empacotar. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const out = process.argv[2] || 'dist-build';
const unpacked = path.join(out, 'win-unpacked');

fs.rmSync(unpacked, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });

/* Usa a CLI empacotada (node_modules/.bin) em vez da API programática,
   cujo formato de `targets` mudou entre versões. */
const cli = path.join('node_modules', 'electron-builder', 'cli.js');
const r = spawnSync(process.execPath, [cli, '--win', '--x64', `-c.directories.output=${out}`], {
  stdio: 'inherit',
  env: { ...process.env },
});
process.exit(r.status ?? 1);
