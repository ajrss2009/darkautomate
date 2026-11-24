import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { bankCoverage, scanBank, takeMedia } from '../main/media-bank';
import { catalogScore, colorDistance, dHash, hamming, indexFile, loadIndex, nearDuplicate, palette } from '../main/media-index';

/** Índice do banco: hash/dHash contra cópias renomeadas, paleta, movimento, nota do catálogo e cobertura. */
function main() {
  /* funções puras */
  const grad = Buffer.from(Array.from({ length: 72 }, (_, i) => (i % 9) * 20));
  assert.equal(dHash(grad), '0000000000000000');
  assert.equal(hamming('ff', '00'), 8);
  assert.ok(colorDistance('#ff0000', '#ff0000') === 0 && colorDistance('#000000', '#ffffff') > 0.9);
  const pal = palette(Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 255]));
  assert.equal(pal.colors[0], '#ff0000', 'dominante = vermelho (2 de 3 pixels)');
  assert.ok(nearDuplicate({ size: 1, mtime: 1, qsha: 'a' }, { size: 2, mtime: 2, qsha: 'a' }));
  assert.ok(nearDuplicate({ size: 1, mtime: 1, dhash: 'ffff000000000000' }, { size: 1, mtime: 1, dhash: 'ffff000000000001' }));
  assert.ok(!nearDuplicate({ size: 1, mtime: 1, dhash: 'ffff000000000000' }, { size: 1, mtime: 1, dhash: '0000ffffffff0000' }));
  /* fórmula: texto igual, o vídeo com movimento e na cor do plano anterior vence */
  const still = catalogScore({ text: 1, kind: 'video', meta: { size: 1, mtime: 1, motion: 0, avg: '#0000ff', duration: 5 }, sceneSec: 5, targetColor: '#ff0000' });
  const lively = catalogScore({ text: 1, kind: 'video', meta: { size: 1, mtime: 1, motion: 0.3, avg: '#ee1100', duration: 5 }, sceneSec: 5, targetColor: '#ff0000' });
  assert.ok(lively > still, `${lively} > ${still}`);
  assert.ok(catalogScore({ text: 1, kind: 'image', usedElsewhere: true }) < catalogScore({ text: 1, kind: 'image' }), 'ineditismo');

  const bundled = path.resolve('tools/ffmpeg/win/ffmpeg.exe');
  const FF = fs.existsSync(bundled) ? bundled : 'ffmpeg';
  const FP = FF.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe'));
  try { execFileSync(FF, ['-version'], { stdio: 'ignore' }); } catch { console.log('… ffmpeg ausente: teste real pulado'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-idx-'));
  const bank = path.join(dir, 'banco'); fs.mkdirSync(bank);
  const mk = (name: string, src: string, extra: string[] = []) => execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, ...extra, '-pix_fmt', 'yuv420p', path.join(bank, name)]);
  mk('snow street a.mp4', 'testsrc2=s=320x180:d=4:r=24');
  fs.copyFileSync(path.join(bank, 'snow street a.mp4'), path.join(bank, 'snow street copia renomeada.mp4'));   // cópia com outro nome
  mk('snow street parado.mp4', 'color=c=blue:s=320x180:d=4:r=24');
  mk('snow street curto.mp4', 'testsrc=s=320x180:d=1.5:r=24');
  const outDir = path.join(dir, 'proj', 'out');
  const banks = [{ id: 'b', name: 'Banco', dir: bank }];
  const tools = { ffmpeg: FF, ffprobe: FP };
  const cov = bankCoverage(banks, { image: 0, video: 6 }, outDir);
  assert.equal(cov.video, 4); assert.ok(cov.short && /2 cena/.test(cov.lines[0]!), cov.lines[0]);

  const picks: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const got = takeMedia({ banks, kind: 'video', terms: ['snow', 'street'], outDir, sceneKey: `p/s${i}`, tools, sceneSec: 4 });
    if (got) picks.push(got.item.rel);
  }
  assert.ok(picks.length === 3, `a cópia renomeada não entra como plano novo: ${picks.join(' | ')}`);
  assert.ok(!(picks.includes('snow street a.mp4') && picks.includes('snow street copia renomeada.mp4')));
  assert.ok(picks[0] !== 'snow street parado.mp4' && picks[0] !== 'snow street curto.mp4', `1º = com movimento e duração certa: ${picks[0]}`);
  const idx = loadIndex(bank);
  assert.ok(fs.existsSync(indexFile(bank)));
  const a = idx['snow street a.mp4']!;
  assert.ok(a.duration! > 3.9 && a.width === 320 && a.fps === 24 && a.motion! > 0 && a.qsha && a.dhash && a.avg, JSON.stringify(a));
  assert.equal(idx['snow street parado.mp4']!.motion, 0);
  assert.equal(scanBank(bank).length, 4, 'o índice oculto não entra como mídia');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`  ✓ escolhas: ${picks.join(' → ')}`);
}

main();
console.log('media-index tests: OK');
