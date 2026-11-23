import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildCompilation, chapterLines, listTracks, trackStarts, trackTitle } from '../main/music-compilation';
import { referenceText } from '../main/prompts';

/** Música do projeto por PASTA = coletânea: ordem natural, transições, tempos de cada faixa e capítulos. */
async function main() {
  assert.equal(trackTitle('C:/m/03 - Frank Crooner - Snow_Waltz.mp3'), 'Frank Crooner - Snow Waltz');
  assert.equal(trackTitle('/x/Jingle.flac'), 'Jingle');
  assert.deepEqual(trackStarts([60, 60, 60], 2), [0, 58, 116]);
  assert.deepEqual(chapterLines([{ title: 'A', start: 0.4 }, { title: 'B', start: 58 }, { title: 'C', start: 3725 }]), ['0:00 A', '0:58 B', '1:02:05 C']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-col-'));
  const bundled = path.resolve('tools/ffmpeg/win/ffmpeg.exe');
  const FF = fs.existsSync(bundled) ? bundled : 'ffmpeg';
  const FP = FF.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe'));
  try { execFileSync(FF, ['-version'], { stdio: 'ignore' }); } catch { console.log('… ffmpeg ausente: teste real pulado'); return; }
  const src = path.join(dir, 'musicas'); fs.mkdirSync(path.join(src, 'extras'), { recursive: true });
  const tone = (f: string, hz: number, sec: number) => execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=f=${hz}:d=${sec}`, '-ac', '1', f]);
  tone(path.join(src, '10 - Terceira.wav'), 660, 6);
  tone(path.join(src, '2 - Segunda.wav'), 550, 5);
  tone(path.join(src, '1 - Primeira.mp3'), 440, 4);
  tone(path.join(src, 'extras', 'Bonus.ogg'), 330, 4);
  fs.writeFileSync(path.join(src, 'capa.jpg'), 'x');
  const list = listTracks(src).map((f) => path.relative(src, f).replace(/\\/g, '/'));
  assert.deepEqual(list, ['1 - Primeira.mp3', '2 - Segunda.wav', '10 - Terceira.wav', 'extras/Bonus.ogg'], 'ordem natural, subpastas incluídas, só áudio');

  const out = path.join(dir, 'proj', 'assets', 'user', 'music');
  const logs: string[] = [];
  const c = await buildCompilation({ ffmpeg: FF, ffprobe: FP, dir: src, outDir: out, crossfade: 1, log: (l) => logs.push(l) });
  assert.equal(c.tracks.length, 4);
  assert.deepEqual(c.tracks.map((t) => t.title), ['Primeira', 'Segunda', 'Terceira', 'Bonus']);
  assert.ok(Math.abs(c.total - (4 + 5 + 6 + 4 - 3 * 1)) < 0.3, `duração com 3 transições de 1 s: ${c.total}`);
  assert.deepEqual(c.tracks.map((t) => t.start), [0, 3, 7, 12]);
  const st = execFileSync(FP, ['-v', 'error', '-show_entries', 'stream=channels,sample_rate', '-of', 'csv=p=0', c.file]).toString().trim();
  assert.equal(st, '44100,2', 'áudio uniforme: 44,1 kHz estéreo');
  assert.ok(JSON.parse(fs.readFileSync(path.join(out, 'coletanea.json'), 'utf8')).tracks.length === 4);
  assert.ok(logs.some((l) => /coletânea: 4 faixa/.test(l)));
  /* o SEO recebe a lista de faixas com os tempos */
  assert.match(referenceText({ musicCompilation: { dir: src, total: c.total, tracks: c.tracks } } as never, 'metadata'), /COLETÂNEA[\s\S]*0:00 Primeira[\s\S]*0:03 Segunda[\s\S]*0:12 Bonus/);
  /* pasta sem áudio: erro claro */
  const vazia = path.join(dir, 'vazia'); fs.mkdirSync(vazia);
  await assert.rejects(buildCompilation({ ffmpeg: FF, ffprobe: FP, dir: vazia, outDir: out }), /não tem faixas de áudio/);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`✓ coletânea real: 4 faixas em ordem natural → ${c.total.toFixed(1)} s com transições, 44,1 kHz estéreo, capítulos 0:00/0:03/0:07/0:12`);
}

main().then(() => console.log('music-compilation tests: OK')).catch((e) => { console.error(e); process.exit(1); });
