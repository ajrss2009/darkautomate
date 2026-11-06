import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { adoptLibrary, detectKit, fontFromFile, writeFilmRunner } from '../main/kit';

/** Reconhecimento dos tipos de plugin com motor próprio: player, peça, biblioteca de estilos (pages) e filmes Node (node-film). */
function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-kit-'));
  const w = (f: string, s = '') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

  /* player (aiTrends) */
  const player = path.join(root, 'player');
  w(path.join(player, 'skills', 's', 'kit', 'player.html'), '<html></html>');
  w(path.join(player, 'skills', 's', 'kit', 'engine', 'core.js'), 'export const E = {};');
  w(path.join(player, 'skills', 's', 'kit', 'engine', 'styles.js'), 'export const MOODS = {\n  day: { a: 1 },\n};\nexport const STYLES = {\n  dusk: {\n  },\n  neon: {\n  },\n};');
  assert.deepEqual([detectKit(player)?.kind, detectKit(player)?.styles], ['player', ['dusk', 'neon']]);

  /* pages: o plugin só cita o repositório (setup.sh) → precisa baixar; com _library → estilos com quadro-chave */
  const lemo = path.join(root, 'lemo');
  w(path.join(lemo, '.claude-plugin', 'plugin.json'), '{"name":"lemo"}');
  w(path.join(lemo, 'skills', 'lemo', 'SKILL.md'), '---\nname: lemo\n---\nRun setup.sh');
  w(path.join(lemo, 'skills', 'lemo', 'scripts', 'setup.sh'), 'REPO=${LEMO_REPO:-https://github.com/lemomo-ai/lemo-opuscar.git}\n');
  const pending = detectKit(lemo);
  assert.deepEqual([pending?.kind, pending?.library, pending?.repo], ['pages', undefined, 'https://github.com/lemomo-ai/lemo-opuscar']);
  /* biblioteca vinda do zip do repositório: core/ + styles/ (sem vídeos/áudios pesados) */
  const repo = path.join(root, 'repo');
  w(path.join(repo, 'core', 'lib.js'), 'export {}');
  w(path.join(repo, 'core', 'fonts', 'f0.woff2'), 'woff');
  w(path.join(repo, 'AGENTS.md'), '# agents');
  w(path.join(repo, 'styles', 'art-deco', 'STYLE.md'), '# Art Deco');
  w(path.join(repo, 'styles', 'art-deco', 'style.json'), JSON.stringify({ en: 'Art Deco', film: 'Out of Order', line: 'A bellhop…', frame_sec: 17.5, dur: 40, category_en: 'Illustration' }));
  w(path.join(repo, 'styles', 'art-deco', 'demo', 'index.html'), '<html></html>');
  w(path.join(repo, 'styles', 'art-deco', 'demo', 'stills', 'styleframe.jpg'), 'jpg');
  w(path.join(repo, 'styles', 'art-deco', 'demo', 'mix.wav'), 'audio pesado');
  w(path.join(repo, 'styles', '_template', 'STYLE.md'), '# modelo');
  w(path.join(repo, 'styleboard', 'big.png'), 'x');
  assert.equal(adoptLibrary(repo, lemo), true);
  assert.ok(!fs.existsSync(path.join(lemo, '_library', 'styles', 'art-deco', 'demo', 'mix.wav')), 'sem áudio pesado');
  assert.ok(!fs.existsSync(path.join(lemo, '_library', 'styleboard')), 'sem a galeria do repositório');
  const pages = detectKit(lemo)!;
  assert.equal(pages.kind, 'pages'); assert.ok(pages.library);
  assert.deepEqual(pages.styles, ['art-deco'], 'o _template não é estilo');
  assert.deepEqual([pages.styleInfo?.[0]?.name, pages.styleInfo?.[0]?.frameSec, !!pages.styleInfo?.[0]?.cover, !!pages.styleInfo?.[0]?.demo], ['Art Deco', 17.5, true, true]);
  assert.equal(adoptLibrary(path.join(root, 'player'), path.join(root, 'x')), false, 'repositório sem biblioteca');

  /* node-film (claude-animation): lib/film.mjs com run() + filmes de exemplo → página que roda no navegador */
  const ca = path.join(root, 'ca');
  w(path.join(ca, 'skills', 'claude-animation', 'lib', 'film.mjs'), 'export async function run(F) {}');
  w(path.join(ca, 'skills', 'claude-animation', 'lib', 'core.mjs'), 'import { createCanvas } from "@napi-rs/canvas";');
  w(path.join(ca, '_gallery', 'examples', 'balloon', 'film.mjs'), 'import path from "node:path";');
  const nf = detectKit(ca)!;
  assert.deepEqual([nf.kind, nf.examples.length], ['node-film', 1]);
  const page = writeFilmRunner(nf, nf.examples[0]!);
  const html = fs.readFileSync(path.join(ca, page), 'utf8');
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]!).imports as Record<string, string>;
  assert.equal(map['node:path'], '/_gallery/runner/path.mjs');
  assert.equal(map['/skills/claude-animation/lib/film.mjs'], '/_gallery/runner/film.mjs', 'run() substituído pelo que só captura setup/frame');
  assert.equal(map['/skills/claude-animation/node_modules/@napi-rs/canvas/index.js'], '/_gallery/runner/napi-canvas.mjs');
  assert.match(fs.readFileSync(path.join(ca, '_gallery', 'runner', 'napi-canvas.mjs'), 'utf8'), /createCanvas/);

  /* nomes de fonte → família do Google Fonts */
  assert.deepEqual(fontFromFile('ArchitectsDaughter-Regular.ttf'), { family: 'Architects Daughter', weight: 400, italic: false });
  assert.deepEqual(fontFromFile('B612Mono-Bold.ttf'), { family: 'B612 Mono', weight: 700, italic: false });
  assert.deepEqual(fontFromFile('PlayfairDisplay-BlackItalic.woff2'), { family: 'Playfair Display', weight: 900, italic: true });

  /* plugin só de instruções: sem motor */
  const plain = path.join(root, 'plain');
  w(path.join(plain, 'skills', 'x', 'SKILL.md'), '---\nname: x\n---\nUse cores fortes.');
  assert.equal(detectKit(plain), undefined);
  console.log('kit tests: OK');
}
main();
