import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeBeats, cutMusicSegment, cutsOnBeat, parseClock, snapToBeats } from '../main/beat-grid';
import { withPromptPrefix } from '../main/prompts';

/** Beat grid: BPM de um metrônomo sintético, cortes encaixados na batida, trecho da música e prefixo de prompt da skill. */
function main() {
  assert.equal(parseClock('0:32'), 32);
  assert.equal(parseClock('1:02:05'), 3725);
  assert.equal(parseClock('12,5'), 12.5);
  assert.equal(parseClock(''), undefined);
  assert.equal(withPromptPrefix('PRE.', 'cena'), 'PRE.\ncena');
  assert.equal(withPromptPrefix('PRE.', 'PRE.\ncena'), 'PRE.\ncena', 'não duplica');
  assert.equal(withPromptPrefix(undefined, 'cena'), 'cena');

  /* grade pura: 120 BPM, cortes de 3,1 s vão para as batidas de 0,5 s */
  const beats = Array.from({ length: 41 }, (_, i) => i * 0.5);
  const grid = { bpm: 120, beats, downbeats: beats.filter((_, i) => i % 4 === 0) };
  const r = snapToBeats([3.1, 3.3, 2.9, 3.0], grid, { total: 12.3 });
  assert.equal(r.snapped, 3);
  assert.equal(cutsOnBeat(r.durations, beats).onBeat, 3);
  assert.ok(Math.abs(r.durations.reduce((a, b) => a + b, 0) - 12.3) < 0.01, 'soma = total');
  /* tempo forte preferido: 4,1 s → 4,0 (tempo forte), não 4,5 */
  assert.equal(snapToBeats([4.1, 4], grid, { total: 8.1 }).durations[0], 4);
  /* limite máximo (clipe de 10 s) respeitado */
  assert.ok(snapToBeats([9.9, 5], grid, { maxSec: 10 }).durations[0]! <= 10);

  const bundled = path.resolve('tools/ffmpeg/win/ffmpeg.exe');
  const FF = fs.existsSync(bundled) ? bundled : 'ffmpeg';
  try { execFileSync(FF, ['-version'], { stdio: 'ignore' }); } catch { console.log('… ffmpeg ausente: teste real pulado'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-beat-'));
  for (const bpm of [96, 128]) {
    const f = path.join(dir, `click-${bpm}.wav`);
    const p = 60 / bpm;
    /* metrônomo: estalo de 30 ms a cada batida, mais forte no 1 do compasso, sobre um zumbido grave contínuo */
    const expr = `if(lt(mod(t,${p}),0.03),(if(lt(mod(t,${4 * p}),0.03),0.9,0.5))*sin(2*PI*1800*t)*exp(-mod(t,${p})*90),0)+0.08*sin(2*PI*110*t)`;
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=20`, f]);
    const g = analyzeBeats(FF, f);
    assert.ok(Math.abs(g.bpm - bpm) < 2 || Math.abs(g.bpm - bpm * 2) < 3 || Math.abs(g.bpm - bpm / 2) < 2, `BPM ${bpm}: medido ${g.bpm}`);
    const per = 60 / g.bpm;
    const off = g.beats.slice(2, -2).map((b) => { const m = b % p; return Math.min(m, p - m); });
    assert.ok(off.every((o) => o < 0.05 || Math.abs(per - p) > 0.01), `batidas na grade (${bpm}): desvio máx ${Math.max(...off).toFixed(3)}`);
    assert.ok(fs.existsSync(`${f}.beats.json`), 'cache ao lado da música');
    console.log(`  ✓ ${bpm} BPM → medido ${g.bpm} (${g.beats.length} batidas, ${g.downbeats.length} tempos fortes, confiança ${g.confidence})`);
  }
  const seg = cutMusicSegment(FF, path.join(dir, 'click-128.wav'), path.join(dir, 'out'), 4, 12.5);
  assert.equal(seg.seconds, 8.5);
  const d = Number(execFileSync(FF.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', seg.file]).toString());
  assert.ok(Math.abs(d - 8.5) < 0.1, `trecho de 8,5 s: ${d}`);
  assert.throws(() => cutMusicSegment(FF, seg.file, dir, 5, 3), /inválido/);
  fs.rmSync(dir, { recursive: true, force: true });
}

main();
console.log('beat-grid tests: OK');
