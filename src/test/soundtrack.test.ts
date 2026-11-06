import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as st from '../main/soundtrack';
import { defaultSettings } from '../main/settings';
import { dedupeDestructuring, importBareLibNames, preferLibRigs, rigRule, ensureForgeContract, ensureSfxExport, extractHtmlPage, freeSkeleton, FREE_SFX_RULE, mergeShortCodeScenes, codeSceneCount } from '../main/prompts';
import { adoptPlugins, autoStyle, pluginsRoot, setAppPluginsDir } from '../main/plugins';

const audioStreams = (f: string) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f]).toString().trim();
const volumeOf = (f: string) => Number(/mean_volume: (-?[\d.]+) dB/.exec(spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1] ?? NaN);

/** Som do vídeo livre (efeitos declarados pela página), trilha do editor e plugins na pasta do app. */
async function main() {
  /* cues de window.__forge.sfx: nomes/apelidos válidos, dentro da duração, em ordem */
  const cues = st.cuesFromList([{ t: 3, name: 'hit' }, { t: 0.5, name: 'footsteps', gain: 5 }, { t: 1, name: 'nao-existe' }, { t: 99, name: 'pop' }, { t: 'x', name: 'pop' }], 10);
  assert.deepEqual(cues.map((c) => `${c.name}@${c.at}`), ['footsteps@0.5', 'impact@3'], 'apelido hit → impact; desconhecido e fora do tempo descartados');
  assert.equal(cues[0]!.gain, 2, 'ganho limitado a 2');
  assert.deepEqual(st.cuesFromList('lixo', 10), []);

  /* esqueleto e prompt: a lista SFX entra no contrato; a regra de som substitui o "vídeo mudo" */
  const sk = freeSkeleton(10, 30, 320, 180);
  assert.ok(/const SFX = \[/.test(sk) && /sfx: SFX \}/.test(sk), 'esqueleto declara SFX e liga no __forge');
  assert.ok(/footsteps/.test(FREE_SFX_RULE) && /AudioContext/.test(FREE_SFX_RULE), 'regra lista nomes e proíbe código de áudio');
  /* página que reescreveu o __forge sem sfx: liga a lista no fim do script */
  const noSfx = '<html><body><script type="module">const SFX = [{ t: 1, name: "pop" }];\nwindow.__forge = { duration: 2, fps: 30, seek(t) {} };\n</script></body></html>';
  const fixedSfx = ensureSfxExport(noSfx);
  assert.ok(/window\.__forge\.sfx = SFX;[\s\S]*<\/script>/.test(fixedSfx), 'sfx ligado antes do </script>');
  assert.equal(ensureSfxExport(sk), sk, 'esqueleto intacto (já tem sfx: SFX)');
  assert.equal(ensureSfxExport('<script>window.__forge={}</script>'), '<script>window.__forge={}</script>', 'sem SFX: nada muda');
  assert.ok(ensureForgeContract('<html><body><script>function render(t){}</script></body></html>', 2).page.includes("sfx:typeof SFX!=='undefined'?SFX:[]"), 'contrato recolocado leva a lista');
  /* desestruturação em laço (SenseNova-Loop): nomes repetidos saem, renomeados e padrões ficam */
  const dd = dedupeDestructuring('const { a, b, ellipse, ellipse, stroke, b: bb, fill, stroke, ellipse } = L;\nconst { x = 1, y } = o; let {p} = q;');
  assert.equal(dd.page, 'const { a, b, ellipse, stroke, b: bb, fill } = L;\nconst { x = 1, y } = o; let {p} = q;');
  assert.deepEqual(dd.removed, ['ellipse', 'stroke', 'ellipse']);
  assert.equal(dedupeDestructuring('const {a,b}=L;').page, 'const {a,b}=L;', 'sem repetição: intacto');
  /* funções da biblioteca usadas soltas: entram num const { } = L logo depois do import */
  const imp = 'import L from "x/_all.mjs";';
  const bare = importBareLibNames(`${imp}\nconst { lerp } = L;\nfunction robot(ctx) {}\nconst a = clamp(1) + lerp(0, 1, .5) + eIO(2); robot(g); L.ant(g); const f = (ss) => ss(1);`, ['clamp', 'lerp', 'eIO', 'robot', 'ant', 'ss', 'sun'], imp);
  assert.deepEqual(bare.added, ['clamp', 'eIO'], 'só as chamadas soltas e não declaradas');
  assert.ok(bare.page.startsWith(`${imp}\nconst { clamp, eIO } = L;`));
  assert.deepEqual(importBareLibNames('sem import; clamp(1)', ['clamp'], imp).added, [], 'sem a linha do import: nada');
  /* rigs: o prompt lista o que cada um desenha; definição própria com nome de rig sai e a chamada vai para L */
  assert.match(rigRule([{ name: 'roach', what: 'a cockroach' }, { name: 'robot', what: 'a chunky walking robot' }]), /L\.roach = a cockroach; L\.robot = a chunky walking robot\. .*barata → L\.roach/);
  assert.equal(rigRule([]), '');
  const own = preferLibRigs(`${imp}\nfunction robot(ctx, x, y, s, o) { ctx.fillRect(x, y, 9, 9); }\nconst ant = (ctx, x) => 1;\nrobot(g, 1, 2, 1, {}); ant(g, 3);`, ['robot', 'ant', 'roach']);
  assert.deepEqual(own.replaced, ['robot', 'ant']);
  assert.ok(/function robot_seuDesenho\(/.test(own.page) && /const ant_seuDesenho = \(/.test(own.page));
  assert.deepEqual(importBareLibNames(own.page, ['robot', 'ant', 'roach'], imp).added, ['robot', 'ant'], 'chamadas passam a usar os rigs de L');
  /* rascunho <think> com HTML não vira a página */
  assert.equal(extractHtmlPage('<think>talvez <!doctype html><html>rascunho</html></think>\n<!doctype html><html><body>ok</body></html>'), '<!doctype html><html><body>ok</body></html>');

  /* trilha: trocar, gerar nome, remover */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-st-'));
  const out = path.join(dir, 'out'); fs.mkdirSync(out);
  const song = path.join(dir, 'song.mp3');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=f=330:d=4', song], { stdio: 'ignore' });
  fs.writeFileSync(path.join(out, 'music.wav'), 'velha');
  assert.equal(st.setMusic(out, song), path.join(out, 'music.mp3'));
  assert.deepEqual(fs.readdirSync(out).filter((n) => st.MUSIC_RE.test(n)), ['music.mp3'], 'a trilha anterior sai');
  assert.throws(() => st.setMusic(out, path.join(dir, 'x.txt')), /formato/);

  /* vídeo livre: final.mp4 mudo + final.sfx.json → base com efeitos → final com trilha; remover a trilha volta à base */
  const s = { ...defaultSettings(dir), ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180:r=30:d=3', '-pix_fmt', 'yuv420p', path.join(out, 'final.mp4')], { stdio: 'ignore' });
  fs.writeFileSync(path.join(out, 'final.sfx.json'), JSON.stringify([{ t: 0.2, name: 'impact' }, { t: 1.5, name: 'pop' }]));
  assert.equal(await st.buildFreeBase(s, out, 3, undefined), 'impact@0.2s, pop@1.5s');
  assert.ok(audioStreams(st.baseFile(out)), 'base com faixa de áudio');
  const fxVol = volumeOf(st.baseFile(out));
  assert.ok(fxVol > -60, `efeitos audíveis (${fxVol} dB)`);
  assert.match(await st.applyFreeSoundtrack(s, {}, out), /trilha music\.mp3 a 35%/);
  assert.ok(audioStreams(path.join(out, 'final.mp4')));
  assert.ok(volumeOf(path.join(out, 'final.mp4')) > fxVol, 'trilha soma ao som');
  assert.equal(await st.applyFreeSoundtrack(s, { musicVolume: 0 }, out), 'trilha no mudo');
  st.setMusic(out, null);
  assert.equal(await st.applyFreeSoundtrack(s, {}, out), 'sem trilha');
  /* efeitos no mudo: base com silêncio (o vídeo continua tendo faixa de áudio para a trilha) */
  assert.equal(await st.buildFreeBase(s, out, 3, 0), 'efeitos no mudo');
  assert.ok(audioStreams(st.baseFile(out)));
  /* projeto livre antigo, sem base: o final atual (mudo) vira a base */
  const old = path.join(dir, 'old'); fs.mkdirSync(old);
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180:r=30:d=2', '-pix_fmt', 'yuv420p', path.join(old, 'final.mp4')], { stdio: 'ignore' });
  st.setMusic(old, song);
  assert.match(await st.applyFreeSoundtrack(s, {}, old), /trilha/);
  assert.ok(fs.existsSync(st.baseFile(old)) && audioStreams(path.join(old, 'final.mp4')));
  await assert.rejects(st.applyFreeSoundtrack(s, {}, path.join(dir, 'vazio')), /ainda não tem vídeo final/);

  /* plugins na pasta do app: cópia do que falta, a pasta antiga fica */
  const oldP = path.join(dir, 'ws', 'plugins'), appP = path.join(dir, 'app', 'plugins');
  fs.mkdirSync(path.join(oldP, 'a', 'skills'), { recursive: true }); fs.writeFileSync(path.join(oldP, 'a', 'skills', 'x.md'), 'x');
  fs.mkdirSync(path.join(oldP, 'b'), { recursive: true }); fs.mkdirSync(path.join(appP, 'b'), { recursive: true }); fs.writeFileSync(path.join(appP, 'b', 'novo'), '1');
  assert.deepEqual(adoptPlugins(oldP, appP), ['a']);
  assert.ok(fs.existsSync(path.join(appP, 'a', 'skills', 'x.md')) && fs.existsSync(path.join(oldP, 'a')), 'copiado; original fica');
  assert.ok(fs.existsSync(path.join(appP, 'b', 'novo')), 'não sobrescreve o que já está no app');
  assert.deepEqual(adoptPlugins(appP, appP), []);
  const ss = defaultSettings(path.join(dir, 'ws'));
  assert.equal(pluginsRoot(ss), path.join(dir, 'ws', 'plugins'));
  setAppPluginsDir(appP);
  assert.equal(pluginsRoot(ss), appP, 'pasta do app vence a de trabalho');
  assert.equal(pluginsRoot({ ...ss, pluginsDir: path.join(dir, 'outra') }), path.join(dir, 'outra'), 'pasta escolhida pelo usuário vence');
  setAppPluginsDir(undefined);

  /* estilo automático no vídeo livre */
  const styles = [{ id: 'a', name: 'Flat Vector' }, { id: 'b', name: 'Pixel Art 8-bit', summary: 'retro games' }, { id: 'c', name: 'Ink Wash' }];
  assert.equal(autoStyle(styles, 'um jogo retro em pixel')!.id, 'b');
  assert.equal(autoStyle(styles, 'baratas vs robôs')!.id, 'a', 'sem combinação: o primeiro');
  assert.equal(autoStyle([], 'x'), undefined);
  /* vídeo em código: cenas curtas seguidas viram cenas de 10–19 s */
  const short = Array.from({ length: 9 }, (_, i) => ({ id: "s" + i, title: "T" + i, narration: "fala " + i, visualIntent: "v" + i, durationSec: 4, kind: "code", sfx: ["pop"] }));
  const m = mergeShortCodeScenes(short);
  assert.deepEqual(m.map((x) => x.durationSec), [12, 12, 12], "9 cenas de 4 s → 3 de 12 s");
  assert.equal(m[0]!.narration, "fala 0 fala 1 fala 2");
  assert.match(m[0]!.visualIntent!, /^v0 — então: v1 — então: v2$/);
  assert.equal(m[0]!.id, "s0");
  assert.deepEqual(mergeShortCodeScenes([...short.slice(0, 7)]).map((x) => x.durationSec), [12, 16], "sobra curta vai para o grupo anterior se couber em 19 s");
  assert.equal(mergeShortCodeScenes([{ durationSec: 4, kind: "code" }, { durationSec: 4, kind: "image" }]).length, 2, "rota mista não é mexida");
  const long = [{ durationSec: 14, kind: "code" }, { durationSec: 12, kind: "code" }];
  assert.equal(mergeShortCodeScenes(long), long, "cenas já longas ficam como estão");
  assert.equal(codeSceneCount(60), 4);
  console.log('soundtrack tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
