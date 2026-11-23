import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { colorFilter, FX_TEXTURES, textureFilters } from '../main/ffmpeg';
import { FILTERS } from '../main/ops';

/** Filtros Technicolor e textura de arranhões de filme antigo: na lista do editor e aceitos pelo ffmpeg de verdade. */
function main() {
  assert.ok(FILTERS.includes('technicolor') && FILTERS.includes('technicolor_faded'));
  assert.ok(FX_TEXTURES.some((t) => t.id === 'film_scratches'));
  assert.ok(colorFilter('technicolor').length >= 2);
  const scr = textureFilters('film_scratches');
  assert.ok(scr.filter((f) => f.startsWith('drawbox')).length >= 5, 'vários riscos');
  const bundled = path.resolve('tools/ffmpeg/win/ffmpeg.exe');
  const FF = fs.existsSync(bundled) ? bundled : 'ffmpeg';
  try { execFileSync(FF, ['-version'], { stdio: 'ignore' }); } catch { console.log('… ffmpeg ausente: teste real pulado'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-filmfx-'));
  const out = path.join(dir, 'o.mp4');
  /* cinza médio uniforme: qualquer coluna mais clara/escura que o resto é um risco */
  const vf = [...colorFilter('technicolor'), ...scr, 'format=yuv420p'].join(',');
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=640x360:d=3:r=30', '-vf', vf, out]);
  assert.ok(fs.statSync(out).size > 1000);
  let maxDev = 0;
  for (const t of ['0.1', '0.6', '1.2', '1.9', '2.5']) {
    const row = execFileSync(FF, ['-v', 'error', '-ss', t, '-i', out, '-frames:v', '1', '-vf', 'crop=iw:1:0:ih/2,format=gray', '-f', 'rawvideo', '-']);
    const mean = row.reduce((a, b) => a + b, 0) / row.length;
    for (const v of row) maxDev = Math.max(maxDev, Math.abs(v - mean));
  }
  assert.ok(maxDev > 25, `riscos visíveis (desvio máximo ${maxDev.toFixed(0)})`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`✓ Technicolor + arranhões no ffmpeg real (desvio dos riscos ${maxDev.toFixed(0)})`);
}

main();
console.log('film-fx tests: OK');
