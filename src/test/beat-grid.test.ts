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

/* Montagem musical sem IA: cortes de 4–8 s nos tempos fortes, sem repetir até usar todos, cópias ignoradas */
import { montageCuts, planMontage } from '../main/beat-montage';
(() => {
  const beats = Array.from({ length: 400 }, (_, i) => Math.round(i * 0.5 * 1000) / 1000);   // 120 BPM
  const grid = { bpm: 120, beats, downbeats: beats.filter((_, i) => i % 4 === 0) };
  const cuts = montageCuts(190, grid);
  const lens = [0, ...cuts, 190].slice(1).map((v, i, a) => v - [0, ...cuts][i]!);
  assert.ok(lens.every((l) => l >= 4 - 1e-6 && l <= 8 + 1e-6), `planos de 4–8 s: ${lens.join(',')}`);
  assert.ok(cuts.every((c) => beats.includes(c)), 'todo corte numa batida');
  const clips = Array.from({ length: 10 }, (_, i) => ({ rel: `c${i}.mp4`, kind: 'video' as const, meta: { size: 1, mtime: 1, duration: 10, motion: i / 10, avg: '#808080', qsha: `h${i}` } }));
  clips.push({ rel: 'copia-de-c0.mp4', kind: 'video', meta: { size: 1, mtime: 1, duration: 10, motion: 0, avg: '#808080', qsha: 'h0' } });
  clips.push({ rel: 'foto.jpg', kind: 'image' as never, meta: { size: 1, mtime: 1, motion: 0, avg: '#808080', qsha: 'f' } as never });
  const sc = planMontage({ total: 90, grid, clips, seed: 'x' });
  assert.ok(Math.abs(sc.reduce((a, s) => a + s.durationSec, 0) - 90) < 0.01, 'soma = música');
  const first = sc.slice(0, 11).map((s) => s.userMedia);
  assert.equal(new Set(first.map((f) => (f === 'copia-de-c0.mp4' ? 'c0.mp4' : f))).size, 11, `11 grupos sem repetir antes de usar todos: ${first.join(' ')}`);
  assert.ok(!(first.includes('c0.mp4') && first.includes('copia-de-c0.mp4')), 'cópia não conta como outro clipe');
  assert.ok(sc.every((s, i) => i === 0 || s.userMedia !== sc[i - 1]!.userMedia), 'nunca o mesmo clipe seguido');
  assert.ok(sc.filter((s) => s.kind === 'video').every((s) => (s.clipStart ?? 0) + s.durationSec <= 10), 'trecho cabe no clipe');
  assert.ok(sc.every((s) => s.manualDuration && s.narration === ''));
  assert.throws(() => planMontage({ total: 10, grid, clips: [] }), /anexe a pasta/);
  /* coletânea de 3 faixas de 30 s com 6 clipes: nenhum clipe repete dentro da mesma faixa */
  const few = clips.slice(0, 6);
  const col = planMontage({ total: 90, grid, clips: few, seed: 'y', trackStarts: [0, 30, 60] });
  const startOf = (i: number) => col.slice(0, i).reduce((a, s) => a + s.durationSec, 0);
  for (const tr of [0, 1, 2]) { const inT = col.filter((_, i) => Math.min(2, Math.floor((startOf(i) + 1e-6) / 30)) === tr).map((s) => s.userMedia); assert.equal(new Set(inT).size, inT.length, `faixa ${tr + 1} sem repetir: ${inT.join(' ')}`); }
  console.log(`  ✓ montagem: ${sc.length} planos de 4–8 s em 90 s, sem repetir até usar os 11 arquivos; coletânea sem repetir na mesma faixa`);
})();
