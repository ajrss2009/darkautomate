import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';

/* A pasta dist pode conter arquivos "imutÃ¡veis" (drive sincronizado/cÃ³pia somente-leitura
   para delete/rename). Por isso o build NUNCA apaga dist: compila para *.tmp.* e
   sobrescreve o arquivo existente por cÃ³pia (write in place), que funciona nesses drives. */
try { rmSync('dist', { recursive: true, force: true }); } catch { /* mantÃ©m os existentes */ }
for (const d of ['dist/main', 'dist/preload', 'dist/renderer', 'dist/test']) mkdirSync(d, { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022' };

async function emit(entry, outfile, extra = {}) {
  const tmp = outfile.replace(/(\.[^.]+)$/, '.tmp$1');
  await build({ ...common, ...extra, entryPoints: [entry], outfile: tmp });
  copyFileSync(tmp, outfile);                       // sobrescreve no lugar (nÃ£o renomeia)
  const map = `${tmp}.map`;
  if (existsSync(map)) { copyFileSync(map, `${outfile}.map`); rmSync(map, { force: true }); }
  rmSync(tmp, { force: true });
}

await import('./build-cartoon3d.mjs');
await emit('src/main/main.ts', 'dist/main/main.js', { platform: 'node', format: 'cjs', external: ['electron', 'ws'] });
await emit('src/preload/preload.ts', 'dist/preload/preload.js', { platform: 'node', format: 'cjs', external: ['electron'] });
await emit('src/renderer/renderer.ts', 'dist/renderer/renderer.js', { platform: 'browser', format: 'iife' });
for (const t of ['engine', 'ops', 'library', 'skills', 'features', 'workflows', 'wan2gp', 'routes', 'automations', 'flow', 'skillgen', 'sfx', 'soundtrack', 'cast', 'attachments', 'compilation', 'resources', 'youtube', 'usage', 'kit', 'e2e', 'folds', 'portable', 'craft', 'adapt', 'clone', 'replan', 'channels', 'contract', 'channel-dna', 'tutorial', 'cartoon3d', 'linksubs', 'timeline', 'studio', 'strict', 'shots', 'editorfx', 'wan2gpmodels']) {
  await emit(`src/test/${t}.test.ts`, `dist/test/${t}.test.js`, { platform: 'node', format: 'cjs', external: ['electron', 'ws'] });
}

copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
copyFileSync('src/renderer/styles.css', 'dist/renderer/styles.css');
copyFileSync('src/renderer/logo.svg', 'dist/renderer/logo.svg');
console.log('build ok');

