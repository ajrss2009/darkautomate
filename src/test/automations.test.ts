import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as ff from '../main/ffmpeg';
import * as ops from '../main/ops';
import * as auto from '../main/automations';
import * as fx from '../shared/fx';
import { createProject, defaultSettings } from '../main/settings';

/** Editor (transições, vinheta, filtros, acabamento final) e Automações (contas, downloads → cena, SRT). */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-auto-'));
  const s = defaultSettings(ws);

  // 1. filtros e acabamento
  assert.deepEqual(ff.colorFilter('none'), []);
  assert.ok(ff.colorFilter('cinematic').length > 0 && ff.colorFilter('noir').length > 0);
  assert.deepEqual(ff.vignetteFilter('soft'), ['vignette=angle=PI/5']);
  assert.equal(ff.finalFilters({ filter: 'vintage', vignette: 'strong', grain: true, letterbox: true }).length, 5);
  assert.equal(ops.cleanFinalEffects({ filter: 'xx', vignette: 'none' }), undefined, 'acabamento vazio/ inválido é descartado');
  assert.deepEqual(ops.cleanFinalEffects({ filter: 'noir', grain: 1 }), { filter: 'noir', vignette: 'none', grain: true, letterbox: false });

  // 2. efeitos da cena validados e transições sem mudar a duração total
  const p = createProject(s, { name: 'Fx', idea: 'x', videoType: 'custom', skillId: 'stickman', routeId: 'stickman-explainer', aspect: '16:9' });
  ops.addScene(s, p, null, { title: 'A', narration: 'a', visualIntent: 'a', kind: 'code', durationSec: 2 });
  ops.updateScene(p, p.scenes[0]!.id, { effects: { filter: 'teal_orange', vignette: 'soft', transition: 'circleopen', transitionSec: 9 } as never });
  const e = p.scenes[0]!.effects!;
  assert.equal(e.transition, 'circleopen'); assert.equal(e.transitionSec, 2, 'duração da transição limitada a 2 s'); assert.equal(e.vignette, 'soft');
  ops.updateScene(p, p.scenes[0]!.id, { effects: { transition: 'explode' } as never });
  assert.equal(p.scenes[0]!.effects!.transition, 'none', 'transição desconhecida vira corte seco');

  let ffmpegOk = true;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpegOk = false; console.log('(ffmpeg ausente: testes de vídeo pulados)'); }
  if (ffmpegOk) {
    const segs: Array<{ file: string; seconds: number; transition?: 'fade' | 'wipeleft' | 'none'; transitionSec?: number }> = [];
    for (const [i, color, tr] of [[0, 'red', 'fade'], [1, 'green', 'wipeleft'], [2, 'blue', 'none']] as const) {
      const out = path.join(ws, `seg${i}.mp4`);
      await ff.makeSegment('ffmpeg', { visual: undefined, seconds: 2, effects: { vignette: 'soft', filter: 'cinematic' } }, out, '16:9');
      execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:r=30:d=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest', out], { stdio: 'ignore' });
      segs.push({ file: out, seconds: 2, transition: tr, transitionSec: 0.5 });
    }
    const out = path.join(ws, 'tr.mp4');
    await ff.concatWithTransitions('ffmpeg', segs, out);
    const d = await ff.duration('ffprobe', out);
    assert.ok(Math.abs(d - 6) < 0.15, `transições não mudam a duração (${d})`);
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).toString();
    assert.match(streams, /video/); assert.match(streams, /audio/);
  }

  // 2b. trechos de filtro/vinheta na timeline (estilo CapCut)
  {
    let segs = fx.placeSeg([], 'filter', 'noir', 0, 10, 10, true);
    assert.equal(segs.length, 1); assert.equal(segs[0]!.toEnd, true);
    segs = fx.placeSeg(segs, 'filter', 'vintage', 3, 5, 10);              // recorta o noir no meio
    assert.deepEqual(segs.map((s) => [s.value, s.start, s.end]), [['noir', 0, 3], ['vintage', 3, 5], ['noir', 5, 10]]);
    assert.equal(fx.segAt(segs, 'filter', 4, 10), 'vintage'); assert.equal(fx.segAt(segs, 'filter', 9.9, 10), 'noir'); assert.equal(fx.segAt(segs, 'vignette', 4, 10), 'none');
    assert.equal(fx.segAt(segs, 'filter', 14, 15), 'noir', 'trecho "até o fim" acompanha o vídeo quando ele cresce');
    segs = fx.placeSeg(segs, 'filter', 'none', 0, 4, 10);                  // remove o começo
    assert.deepEqual(segs.map((s) => [s.value, s.start]), [['vintage', 4], ['noir', 5]]);
    assert.equal(fx.cleanSegments([{ kind: 'filter', value: 'hack', start: 0, end: 2 }, { kind: 'vignette', value: 'soft', start: 1, end: 3 }])!.length, 1);
    const old = createProject(s, { name: 'Old', idea: 'x', videoType: 'custom', skillId: 'stickman', routeId: 'stickman-explainer' });
    old.scenes = [1, 2, 3].map((i) => ({ id: `s0${i}`, index: i, title: '', narration: '', visualIntent: '', kind: 'code' as const, durationSec: 2, status: {}, artifacts: {}, effects: { filter: i < 3 ? 'cinematic' as const : 'none' as const, vignette: 'soft' as const } }));
    assert.equal(fx.migrateSceneFx(old), true);
    assert.deepEqual(old.fxSegments!.map((x) => [x.kind, x.value, x.start, x.end]), [['filter', 'cinematic', 0, 4], ['vignette', 'soft', 0, 6]]);
    assert.ok(old.scenes.every((x) => x.effects!.filter === 'none' && x.effects!.vignette === 'none'), 'efeito por cena virou trecho');
    const sf = ff.segmentFilters([{ id: 'a', kind: 'filter', value: 'vintage', start: 1, end: 2 }, { id: 'b', kind: 'vignette', value: 'soft', start: 0, end: 0, toEnd: true }], 3);
    assert.ok(sf.every((x) => /:enable='(between|gte)\(t\\,/.test(x)));
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=3:r=10', '-vf', sf.join(','), '-f', 'null', '-']);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('ffmpeg recusou os filtros com enable: ' + (e as Error).message); }
  }

  // 2c. vários filtros/vinhetas no mesmo vídeo (camadas) e panorâmicas
  {
    let segs = fx.placeSeg([], 'filter', 'noir', 0, 10, 10, true);
    segs = fx.addSegLayer(segs, 'filter', 'vintage', 2, 6, 10);           // sobreposto → camada 1
    segs = fx.addSegLayer(segs, 'filter', 'warm', 7, 9, 10);              // camada 1 livre em 7–9
    segs = fx.addSegLayer(segs, 'filter', 'cool', 3, 4, 10);              // 1 ocupada em 3–4 → camada 2
    assert.deepEqual(segs.map((x) => [x.value, x.layer ?? 0]).sort(), [['cool', 2], ['noir', 0], ['vintage', 1], ['warm', 1]]);
    assert.deepEqual(fx.segsAt(segs, 'filter', 3.5, 10), ['noir', 'vintage', 'cool'], 'empilhados de baixo para cima');
    assert.equal(fx.layersOf(segs, 'filter'), 3);
    segs = fx.placeSeg(segs, 'filter', 'none', 0, 10, 10, true, 1);       // limpar a camada 1 não mexe nas outras
    assert.deepEqual(segs.map((x) => x.value).sort(), ['cool', 'noir']);
    assert.equal(fx.cleanSegments([{ kind: 'filter', value: 'noir', start: 0, end: 2, layer: 4 }])![0]!.layer, 4);
    assert.match(ff.moveExpr('pan_left', 90)!.x, /\(iw-iw\/zoom\)\*\(1-on\/90\)/);
    assert.equal(ff.moveExpr('none', 90), undefined);
    try {
      const out = path.join(ws, 'pan.mp4');
      await ff.makeSegment('ffmpeg', { seconds: 1, effects: { zoom: 'pan_right' } }, out, '16:9');
      await ff.makeSegment('ffmpeg', { seconds: 1, effects: { zoom: 'in_left' } }, out, '9:16');
      assert.ok(fs.statSync(out).size > 0);
    } catch (e) { if (!/ENOENT/.test((e as Error).message)) throw e; }
  }

  // 3. contas Google: limite de 10, pasta própria, sessão do Antigravity isolada, remoção sem apagar a pasta
  for (let i = 0; i < auto.MAX_ACCOUNTS; i++) auto.addAccount(s, `Conta ${i + 1}`);
  assert.throws(() => auto.addAccount(s, 'Onze'), /limite/);
  const g1 = auto.listAccounts(s)[0]!;
  assert.equal(g1.id, 'g1'); assert.ok(fs.existsSync(path.join(g1.dir, 'downloads')));
  assert.deepEqual(auto.agyEnvFor(s, undefined), {});
  const env = auto.agyEnvFor(s, 'g1');
  assert.ok(env['USERPROFILE']!.endsWith(path.join('g1', 'agy-home')) && env['HOME'] === env['USERPROFILE']);
  auto.config(s).agyAccount = 'g2';
  assert.ok(auto.activeAgyEnv(s)['USERPROFILE']!.includes(path.join('g2', 'agy-home')));
  const kept = auto.removeAccount(s, 'g2');
  assert.ok(fs.existsSync(kept), 'remover da lista mantém a pasta');
  assert.equal(auto.config(s).agyAccount, undefined);
  assert.throws(() => auto.accountDir(s, '../x'), /inválida/);
  assert.equal(auto.savePrompts(s, 'g1', 'gato voando\n\n  cidade neon  \n').count, 2);

  // 4. download do Flow → visual da cena (e nada fora da pasta da conta)
  if (ffmpegOk) {
    const dl = path.join(g1.dir, 'downloads', 'flow-1.mp4');
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:d=1:r=24', '-pix_fmt', 'yuv420p', dl], { stdio: 'ignore' });
    assert.equal(auto.listDownloads(s, 'g1')[0]!.kind, 'video');
    const pdir = path.join(ws, 'projects', p.id);
    const dest = await auto.importToScene(s, p, pdir, 'g1', dl, p.scenes[0]!.id);
    assert.ok(fs.existsSync(dest) && dest.endsWith(path.join('clips', 'clip.mp4')));
    assert.equal(p.scenes[0]!.kind, 'video');
    assert.ok(!fs.existsSync(dl), 'mídia MOVIDA para dentro do projeto (saiu da pasta da conta)');
    assert.equal(auto.listDownloads(s, 'g1').length, 0);
    await assert.rejects(() => auto.importToScene(s, p, pdir, 'g1', path.join(ws, 'seg0.mp4'), p.scenes[0]!.id), /fora da pasta/);
  }

  // 5. SRT: agrupamento por tamanho/pausa/pontuação
  const words = 'Olá pessoal. Hoje vamos falar de satélites e de como o GPS descobre onde você está agora mesmo'.split(' ').map((w, i) => ({ w, start: i * 0.4 + (i > 10 ? 1 : 0), end: i * 0.4 + 0.35 + (i > 10 ? 1 : 0) }));
  const cues = auto.wordsToSrt(words, { maxChars: 24, maxLines: 2, maxSeconds: 5 });
  assert.ok(cues.length >= 3, `${cues.length} legendas`);
  for (const c of cues) { assert.ok(c.text.split('\n').every((l) => l.length <= 24 || !l.includes(' '))); assert.ok(c.end > c.start); }
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i]!.start >= cues[i - 1]!.end, 'sem sobreposição');
  assert.match(auto.cuesToSrt(cues), /^1\n00:00:00,000 --> 00:00:0/);

  console.log('editor/automations tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
