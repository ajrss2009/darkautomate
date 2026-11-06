import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProject, defaultSettings } from '../main/settings';
import * as ops from '../main/ops';
import * as ff from '../main/ffmpeg';
import { insertClip, rippleDeleteSegments, rippleSegments, sceneAt, splitScene, trimScene } from '../main/timeline-edit';
import { exportForEditor, fcpXml, pathUrl } from '../main/nle-export';
import type { Scene } from '../shared/types';

/** Ferramentas da timeline (cortar, dividir, inserir com ripple), volume da narração e exportação para Resolve/CapCut. */
async function main() {
  /* ripple dos trechos de efeito */
  const segs = [{ id: 'a', kind: 'filter' as const, value: 'bw', start: 0, end: 2 }, { id: 'b', kind: 'vignette' as const, value: 'soft', start: 3, end: 5 }, { id: 'c', kind: 'filter' as const, value: 'warm', start: 6, end: 6.5 }];
  assert.deepEqual(rippleSegments(segs, 2.5, 4)!.map((g) => [g.start, g.end]), [[0, 2], [7, 9], [10, 10.5]], 'inserir empurra o que vem depois');
  assert.deepEqual(rippleSegments(segs, 1, 4)!.map((g) => [g.start, g.end]), [[0, 6], [7, 9], [10, 10.5]], 'trecho que atravessa estica');
  assert.deepEqual(rippleSegments(segs, 5.5, -1.5)!.map((g) => [g.start, g.end]), [[0, 2], [3, 5]], 'trecho dentro do pedaço removido some');
  assert.deepEqual(rippleSegments(segs, 1, -1)!.map((g) => [g.start, g.end]), [[0, 1], [2, 4], [5, 5.5]], 'excluir puxa');

  /* projeto real com 3 cenas (imagem + narração), no ffmpeg */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tl-'));
  const s = defaultSettings(ws);
  const p = createProject(s, { name: 'Timeline', idea: 'teste da timeline', videoType: 'custom' } as never);
  const dir = path.join(ws, 'projects', p.id);
  const colors = ['red', 'green', 'blue'];
  for (let i = 0; i < 3; i++) {
    const sc = ops.addScene(s, p, p.scenes[p.scenes.length - 1]?.id ?? null, { title: `Cena ${i + 1}`, narration: 'um dois três quatro cinco seis', kind: 'image', durationSec: 3 });
    const sd = path.join(dir, 'scenes', sc.id);
    fs.mkdirSync(path.join(sd, 'frames'), { recursive: true }); fs.mkdirSync(path.join(sd, 'audio'), { recursive: true });
    await ff.run(s.ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=${colors[i]}:s=320x180`, '-frames:v', '1', path.join(sd, 'frames', 'frame.png')]);
    await ff.run(s.ffmpeg, ['-y', '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 200}:duration=2.85`, '-ac', '2', path.join(sd, 'audio', 'narration.wav')]);
    fs.writeFileSync(path.join(sd, 'audio', 'words.json'), JSON.stringify({ text: sc.narration, source: 't', words: ['um', 'dois', 'três', 'quatro', 'cinco', 'seis'].map((w, k) => ({ w, start: k * 0.5, end: k * 0.5 + 0.4 })) }));
  }
  p.fxSegments = [{ id: 'f', kind: 'filter', value: 'bw', start: 4, end: 8 }];
  const [s1, s2] = p.scenes as [Scene, Scene, Scene];

  /* dividir a cena 2 em 1,0 s: dois clipes seguidos, mesma mídia, narração e palavras repartidas */
  const b = splitScene(s, p, s2.id, 1.0);
  assert.equal(p.scenes.length, 4);
  assert.equal(p.scenes[2]!.id, b.id, 'a parte 2 entra logo depois');
  assert.equal(s2.durationSec, 1); assert.equal(b.durationSec, 2); assert.equal(b.trimStart, 1);
  assert.equal(s2.narration, 'um dois'); assert.equal(b.narration, 'três quatro cinco seis');
  const bw = JSON.parse(fs.readFileSync(path.join(dir, 'scenes', b.id, 'audio', 'words.json'), 'utf8')).words;
  assert.deepEqual(bw.map((w: { start: number }) => w.start), [0, 0.5, 1, 1.5], 'palavras da parte 2 contam do 0');
  assert.match(b.title, /parte 2/); assert.match(s2.title, /parte 1/);
  assert.equal(p.fxSegments![0]!.start, 4, 'dividir não muda o tamanho do vídeo');

  /* cortar 0,5 s do início da cena 1: o resto é puxado */
  trimScene(s, p, s1.id, { cutStart: 0.5 });
  assert.equal(s1.durationSec, 2.5); assert.equal(s1.trimStart, 0.5); assert.equal(s1.narration, 'dois três quatro cinco seis');
  assert.deepEqual([p.fxSegments![0]!.start, p.fxSegments![0]!.end], [3.5, 7.5], 'efeitos puxados junto');
  /* cortar o fim da parte 2 (fica 1,5 s) */
  trimScene(s, p, b.id, { cutEnd: 0.5 });
  assert.equal(b.durationSec, 1.5); assert.equal(b.trimStart, 1);
  assert.deepEqual([p.fxSegments![0]!.start, p.fxSegments![0]!.end], [3.5, 7], 'o fim do efeito é puxado pelo corte');
  assert.throws(() => trimScene(s, p, b.id, { cutStart: 1.4 }), /curto demais/);

  /* inserir um vídeo no cursor (meio da cena 1 → divide e insere; o resto é empurrado) */
  const clipFile = path.join(ws, 'inserido.mp4');
  await ff.run(s.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clipFile]);
  const before = sceneAt(p, p.scenes.length);
  const ins = insertClip(s, p, { file: clipFile, seconds: 2, where: { at: 'time', time: 1.0 } });
  assert.equal(p.scenes.length, 6, 'cena 1 dividida + clipe inserido');
  assert.equal(p.scenes[1]!.id, ins.scene.id, 'clipe entra no cursor');
  assert.equal(sceneAt(p, 1), 1, 'começa no instante do cursor');
  assert.ok(Math.abs(sceneAt(p, p.scenes.length) - (before + 2)) < 1e-6, 'vídeo cresce o tamanho do clipe');
  assert.deepEqual([p.fxSegments![0]!.start, p.fxSegments![0]!.end], [5.5, 9], 'efeitos empurrados');
  assert.ok(fs.existsSync(path.join(ins.dir, 'clips', 'clip.mp4')));
  /* inserir uma imagem no começo */
  const img = path.join(dir, 'scenes', s1.id, 'frames', 'frame.png');
  insertClip(s, p, { file: img, seconds: 4, where: { at: 'start' } });
  assert.equal(p.scenes[0]!.kind, 'image'); assert.equal(p.scenes[0]!.index, 1);
  /* excluir com ripple */
  const tot = sceneAt(p, p.scenes.length), segBefore = p.fxSegments![0]!.start;
  rippleDeleteSegments(p, [p.scenes[0]!.id]); ops.deleteScene(s, p, p.scenes[0]!.id);
  assert.equal(sceneAt(p, p.scenes.length), tot - 4); assert.equal(p.fxSegments![0]!.start, segBefore - 4);
  ops.saveProjectFile(s, p);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'scenes.json'), 'utf8')).find((x: { id: string }) => x.id === b.id).trimStart, 1, 'trimStart salvo');

  /* montagem com corte e volume da narração: o segmento tem a duração pedida e começa no ponto cortado */
  const seg = path.join(ws, 'seg.mp4');
  await ff.makeSegment(s.ffmpeg, { visual: clipFile, audio: path.join(dir, 'scenes', b.id, 'audio', 'narration.wav'), seconds: 1.2, trimStart: 0.5, narrationVolume: 0.5 }, seg, '16:9');
  assert.ok(Math.abs((await ff.duration(s.ffprobe, seg)) - 1.2) < 0.1, 'segmento cortado com a duração da cena');
  const vol = await ff.run(s.ffmpeg, ['-i', seg, '-af', 'volumedetect', '-f', 'null', '-']).catch((e) => ({ stderr: String(e) }));
  const full = path.join(ws, 'seg-full.mp4');
  await ff.makeSegment(s.ffmpeg, { visual: clipFile, audio: path.join(dir, 'scenes', b.id, 'audio', 'narration.wav'), seconds: 1.2 }, full, '16:9');
  const vol2 = await ff.run(s.ffmpeg, ['-i', full, '-af', 'volumedetect', '-f', 'null', '-']).catch((e) => ({ stderr: String(e) }));
  const mean = (x: { stderr: string }) => Number(/mean_volume:\s*(-?[\d.]+)/.exec(x.stderr)?.[1]);
  assert.ok(mean(vol2) - mean(vol) > 4, `narração a 50% fica ~6 dB mais baixa (${mean(vol)} vs ${mean(vol2)})`);

  /* XML do Resolve */
  assert.match(pathUrl('C:\\Pasta X\\a b.mp4'), /^file:\/\/localhost\/C:\/Pasta%20X\/a%20b\.mp4$/);
  const xml = fcpXml('Meu <vídeo>', { w: 1920, h: 1080 }, { video: [{ name: 'a', file: 'C:\\x\\1.mp4', seconds: 2 }, { name: 'b', file: 'C:\\x\\2.mp4', seconds: 1.5 }], audio: [{ name: 'Narração', file: 'C:\\x\\n.wav', seconds: 3.5, level: 0.8 }] });
  assert.match(xml, /<xmeml version="5">[\s\S]*<name>Meu &lt;vídeo&gt;<\/name><duration>105<\/duration>/);
  assert.match(xml, /<clipitem id="v2">[\s\S]*<start>60<\/start><end>105<\/end>/);
  assert.match(xml, /<clipitem id="a1">[\s\S]*<value>0\.800<\/value>/);

  /* exportar de verdade */
  const p2 = ops.readProject(s, p.id);
  p2.narrationVolume = 0.8;
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  await ff.run(s.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', path.join(dir, 'out', 'music.mp3')]);
  const total = p2.scenes.reduce((a, x) => a + (x.durationSec ?? 4), 0);
  const dv = await exportForEditor(s, p2, 'davinci');
  assert.ok(fs.existsSync(dv.main) && dv.main.endsWith('.xml'));
  const dx = fs.readFileSync(dv.main, 'utf8');
  assert.equal((dx.match(/<clipitem id="v\d+"/g) ?? []).length, p2.scenes.length, 'um clipe por cena');
  assert.match(dx, /Narração[\s\S]*Música/);
  const mp4s = fs.readdirSync(path.join(dv.dir, 'midia')).filter((f) => f.endsWith('.mp4'));
  assert.equal(mp4s.length, p2.scenes.length);
  const nd = await ff.duration(s.ffprobe, path.join(dv.dir, 'midia', 'narracao.wav'));
  assert.ok(Math.abs(nd - total) < 0.1, `narração do tamanho do vídeo (${nd} vs ${total})`);
  const md = await ff.duration(s.ffprobe, path.join(dv.dir, 'midia', 'musica.wav'));
  assert.ok(Math.abs(md - total) < 0.1, 'música em loop até o fim');
  assert.ok(fs.existsSync(path.join(dv.dir, 'legendas.srt')) && fs.existsSync(path.join(dv.dir, 'COMO-IMPORTAR.txt')));
  const cc = await exportForEditor(s, p2, 'capcut');
  const files = fs.readdirSync(cc.dir);
  assert.ok(files.some((f) => /^001 - /.test(f)) && files.includes('narracao.wav') && files.includes('legendas.srt') && files.includes('COMO-IMPORTAR.txt'), files.join(', '));
  console.log('timeline tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
