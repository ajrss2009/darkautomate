import { build } from 'esbuild';
import { copyFileSync, rmSync } from 'node:fs';

/* vendor/cartoon3d/src (TypeScript, MIT port of claude-animated-shorts + stage.ts) -> vendor/cartoon3d/cartoon3d.js,
   one ES module that imports "three" through the page's import map (FilmForge stages both into the project). */
const out = 'vendor/cartoon3d/cartoon3d.js', tmp = 'vendor/cartoon3d/cartoon3d.tmp.js';
await build({ entryPoints: ['vendor/cartoon3d/src/index.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
  external: ['three'], outfile: tmp, logLevel: 'warning', legalComments: 'inline', minifySyntax: true,
  banner: { js: '/* cartoon3d for FilmForge — look ported from github.com/mromidev/claude-animated-shorts (MIT, (c) 2026 Mr omi). */' } });
copyFileSync(tmp, out); rmSync(tmp, { force: true });
console.log('cartoon3d ok');
