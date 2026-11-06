import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as sfx from '../main/sfx';
import * as ff from '../main/ffmpeg';
import { autoMotion } from '../main/executors';
import { characterLock, characterSheet } from '../main/prompts';
import { translateProject } from '../main/editor';
import * as ops from '../main/ops';
import { createProject, defaultSettings } from '../main/settings';
import { ROUTES } from '../main/presets';
import { BUILTIN_SKILLS } from '../main/skills-builtin';
import type { Scene } from '../shared/types';
import { termsText } from '../shared/types';

/** Efeitos sonoros por código, mixagem com a narração, slideshow, personagens fixos e migração de idioma. */
async function main() {
  /* parsing e tempos */
  const cues = sfx.parseCues({ sfx: ['whoosh', 'impact@2.5', 'crunch:mastigar', 'inexistente'], sfxCues: [{ name: 'DING', at: 1 }] });
  assert.deepEqual(cues.map((c) => c.name), ['ding', 'whoosh', 'impact', 'crunch'], 'nomes válidos; desconhecido descartado');
  const words = [{ w: 'Antes', start: 0, end: 0.4 }, { w: 'de', start: 0.4, end: 0.5 }, { w: 'mastigar,', start: 2, end: 2.6 }];
  const times = sfx.cueTimes(cues, 6, words);
  assert.equal(times[0], 1); assert.equal(times[2], 2.5); assert.ok(Math.abs(times[3]! - 1.92) < 0.01, 'toca quando a palavra é dita');
  assert.ok(sfx.autoCues({ index: 3, title: 'Dentes', narration: 'eles mastigavam raízes duras', visualIntent: 'close of teeth' }).some((c) => c.name === 'crunch' || c.name === 'chew'), 'auto escolhe pelo texto');

  /* slideshow: movimento e transição automáticos sem sobrescrever o que o usuário definiu */
  const sc = (i: number, e?: Scene['effects']): Scene => ({ id: `s${i}`, index: i, title: '', narration: '', visualIntent: '', kind: 'image', status: {}, artifacts: {}, effects: e });
  assert.equal(autoMotion(sc(1), { autoMotion: true })?.zoom, 'in');
  assert.equal(autoMotion(sc(2), { autoMotion: true })?.zoom, 'pan_right');
  assert.equal(autoMotion(sc(2, { zoom: 'none' }), { autoMotion: true })?.zoom, 'none', 'escolha do usuário mantida');
  assert.equal(autoMotion(sc(1), { defaultTransition: 'fade' })?.transition, 'fade');
  assert.equal(autoMotion(sc(1), {}), undefined);

  /* rota e skill do slideshow */
  const r = ROUTES.find((x) => x.id === 'slideshow-sfx');
  assert.ok(r && r.steps.some((s) => s.kind === 'sfx') && !r.steps.some((s) => s.kind === 'music'), 'rota slideshow com sfx e sem música');
  assert.equal(r!.steps.find((s) => s.kind === 'image')!.bindings[0]!.type, 'flow');
  assert.ok(BUILTIN_SKILLS.some((k) => k.id === 'slideshow' && k.routeId === 'slideshow-sfx'));

  /* personagens fixos */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sfx-'));
  const pd = path.join(ws, 'p'); fs.mkdirSync(path.join(pd, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(pd, 'assets', 'assets.md'), '# Bíblia\n\n## Personagens fixos\n- **Kael**: 30-year-old hunter-gatherer, lean, tanned skin, long dark braided hair, fur cloak\n- **Dra. Lia**: 40-year-old dentist, short gray hair, round glasses, white coat\n\n## Cenários\n- caverna\n');
  assert.deepEqual(characterSheet(pd).map((c) => c.name), ['Kael', 'Dra. Lia']);
  assert.match(characterLock(pd, 'Kael chewing a root by the fire'), /Kael = 30-year-old hunter-gatherer/);
  assert.equal(characterLock(pd, 'a skull on a table'), '');

  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.log('(sem ffmpeg: parte de áudio pulada)'); return; }
  /* todos os efeitos da biblioteca geram áudio válido */
  const dir = path.join(ws, 'lib');
  for (const d of sfx.SFX_LIBRARY) {
    const f = path.join(dir, `${d.id}.wav`);
    await sfx.renderSfx('ffmpeg', d.id, f);
    const dd = await ff.duration('ffprobe', f);
    assert.ok(Math.abs(dd - d.dur) < 0.1, `${d.id}: ${dd}s`);
  }
  /* faixa da cena + mixagem com a narração no segmento */
  const narr = path.join(ws, 'narr.wav');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=f=220:d=3', narr], { stdio: 'ignore' });
  const track = path.join(ws, 'sfx.wav');
  /* saída vazia de uma execução interrompida (0 bytes) não é WAV e é refeita; partes vazias também */
  fs.writeFileSync(track, '');
  fs.mkdirSync(path.join(ws, 'parts'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'parts', `${cues[0]!.name}.wav`), '');
  assert.equal(sfx.validWav(track), false);
  await sfx.buildSceneSfx('ffmpeg', cues, times, 4, track, path.join(ws, 'parts'));
  assert.ok(sfx.validWav(track) && sfx.validWav(path.join(ws, 'parts', `${cues[0]!.name}.wav`)), 'faixa e partes refeitas');
  /* ffmpeg que falha não deixa arquivo parcial nem estraga a faixa anterior */
  const before = fs.statSync(track).size;
  await assert.rejects(sfx.buildSceneSfx('ffmpeg', [{ name: 'nao-existe', at: 0 }], [0], 4, track, path.join(ws, 'parts')));
  assert.equal(fs.statSync(track).size, before);
  assert.ok(!fs.readdirSync(ws).some((f) => f.startsWith('.part-')), 'sem temporário');
  assert.ok(Math.abs(await ff.duration('ffprobe', track) - 4) < 0.1, 'faixa do tamanho da cena');
  const png = path.join(ws, 'f.png');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180', '-frames:v', '1', png], { stdio: 'ignore' });
  const seg = path.join(ws, 'seg.mp4'), plain = path.join(ws, 'plain.mp4');
  await ff.makeSegment('ffmpeg', { visual: png, audio: narr, seconds: 4, effects: { zoom: 'pan_left', fadeIn: true }, sfx: track, sfxVolume: 1 }, seg, '16:9');
  await ff.makeSegment('ffmpeg', { visual: png, audio: narr, seconds: 4 }, plain, '16:9');
  assert.ok(Math.abs(await ff.duration('ffprobe', seg) - 4) < 0.15, 'segmento com sfx mantém a duração');
  /* no começo (0–0,4 s) o "ding" soma à narração: o pico fica mais alto que sem efeitos */
  const peak = (f: string, from: number) => {
    const r2 = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(from), '-t', '0.4', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /max_volume: (-?[\d.]+|-inf)/.exec(r2.stderr)?.[1];
    return !m || m === '-inf' ? -200 : Number(m);
  };
  assert.ok(peak(seg, 1.0) > peak(plain, 1.0) + 1, `sfx mixado (${peak(seg, 1.0)} dB vs ${peak(plain, 1.0)} dB)`);

  /* migração de idioma com uma API de chat local (formato OpenAI) */
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
      const prompt = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages[0]!.content;
      const answer = /"script"/.test(prompt) && !/Cenas:/.test(prompt)
        ? { name: 'Teeth before agriculture', script: '# Script\nHello.' }
        : { scenes: [{ id: 's01', title: 'Teeth', narration: 'Before agriculture, people chewed hard roots.' }, { id: 's02', title: 'Today', narration: 'Today our jaws are smaller.' }] };
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const s = defaultSettings(ws);
    s.providers = [{ id: 'fake', kind: 'openai', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, apiKey: 'x', models: ['m'] } as (typeof s.providers)[number]];
    const p = createProject(s, { name: 'Dentes', idea: 'arcada', videoType: 'slideshow', skillId: 'slideshow', routeId: 'slideshow-sfx', aspect: '16:9' });
    p.route = { ...p.route!, steps: p.route!.steps.map((st) => (st.kind === 'script' ? { ...st, bindings: [{ type: 'api' as const, provider: 'fake', model: 'm' }] } : st)) };
    p.scenes = [
      { ...sc(1), id: 's01', title: 'Dentes', narration: 'Antes da agricultura, mastigavam raízes.', sfx: ['crunch:mastigavam'], status: { narration: 'done', image: 'done' } },
      { ...sc(2), id: 's02', title: 'Hoje', narration: 'Hoje a mandíbula é menor.', status: { narration: 'done', image: 'done' } },
    ];
    const dir2 = path.join(ws, 'projects', p.id); fs.mkdirSync(dir2, { recursive: true }); fs.writeFileSync(path.join(dir2, 'script.md'), '# Roteiro\nOlá.');
    const out = await translateProject({ settings: s, project: p, projectDir: dir2, route: p.route!, language: 'en-US', languageName: 'inglês', signal: new AbortController().signal, log: () => {} });
    assert.equal(out.translated, 2);
    assert.equal(p.language, 'en-US'); assert.equal(p.name, 'Teeth before agriculture');
    assert.equal(p.scenes[0]!.narration, 'Before agriculture, people chewed hard roots.');
    assert.deepEqual(p.scenes[0]!.sfx, ['crunch'], 'palavra do idioma antigo removida do efeito');
    assert.equal(p.scenes[0]!.status['narration'], 'stale'); assert.equal(p.scenes[0]!.status['image'], 'done', 'imagens mantidas');
    assert.match(fs.readFileSync(path.join(dir2, 'script.md'), 'utf8'), /Hello/);
    /* volume da música e efeitos por cena no projeto */
    ops.saveProjectFile(s, p);
    const up = ops.updateProject(s, p.id, { musicVolume: 0 });
    assert.equal(up.musicVolume, 0, 'mudo');
    assert.equal(ops.updateProject(s, p.id, { musicVolume: 3 }).musicVolume, 1);
    assert.equal(ops.updateProject(s, p.id, { musicVolume: null as unknown as number }).musicVolume, undefined, 'volta ao padrão da rota');
    const q = ops.readProject(s, p.id);
    ops.updateScene(q, 's02', { sfx: ['ding', 'xyz', 'tick@1'] });
    assert.deepEqual(q.scenes[1]!.sfx, ['ding', 'tick@1']);
  } finally { server.close(); }
  assert.equal(termsText(['honey bee', 'flower']), 'honey bee flower', 'searchTerms em lista vira texto'); assert.equal(termsText('  a  b '), 'a b'); assert.equal(termsText(undefined), '');
  console.log('sfx tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
