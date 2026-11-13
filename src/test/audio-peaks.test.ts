import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultSettings } from '../main/settings';
import { audioPeaks } from '../main/audio-peaks';

/** Picos da forma de onda: 40/s, cache ao lado do arquivo, uma decodificação por arquivo. */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-peaks-'));
  const s = defaultSettings(ws);
  const wav = path.join(ws, 'narracao.wav');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '1', wav], { stdio: 'ignore' });

  const p = await audioPeaks(s.ffmpeg, wav);
  assert.equal(p.rate, 40, '40 picos por segundo');
  assert.ok(p.peaks.length >= 78 && p.peaks.length <= 82, `2 s → ~80 baldes (${p.peaks.length})`);
  assert.ok(p.peaks.every(([lo, hi]) => lo <= hi && lo >= -1 && hi <= 1), 'mínimo ≤ máximo dentro de [-1, 1]');
  assert.ok(fs.existsSync(`${wav}.peaks.json`), 'o cache fica ao lado do arquivo');

  const again = await audioPeaks(s.ffmpeg, wav);
  assert.deepEqual(again.peaks, p.peaks, 'o cache devolve os mesmos picos');
  console.log(`peaks: ${p.peaks.length} baldes · cache ${Math.round(fs.statSync(`${wav}.peaks.json`).size / 1024 * 10) / 10} KB`);
  console.log('audio-peaks tests: OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
