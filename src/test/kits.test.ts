import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeKit, licenseRestrictedPaths, blockyLook, copyKitIntoProject, isBlockyKit, kitSkillContent, parseBlockyPresets, sectionSteps, unwrap } from '../main/kit-import';
import { importClaudeSkill } from '../main/skill-import';
import { createProject, defaultSettings, projectDirOf } from '../main/settings';
import { sfxDef } from '../main/sfx';
import { parseRange, mimeOf } from '../main/media-range';
import { DRAMA_SKILLS } from '../main/microdrama';
import { blockyPageProblem } from '../main/executors';
import { schemaVocab, storyboardProblem } from '../main/python-film';
import { is3dScene, parseReview, reviewFixPrompt, reviewPrompt } from '../main/scene-review';
import { musicKey, musicStale, writeMusicSource } from '../main/soundtrack';
import { ROUTES } from '../main/presets';
import { listSkills } from '../main/library';
import { listCharacters } from '../main/characters';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c20000000049454e44ae426082', 'hex');
function wav(sec = 0.3): Buffer {
  const n = Math.round(44100 * sec), h = Buffer.alloc(44), d = Buffer.alloc(n * 2);
  h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(d.length, 40);
  return Buffer.concat([h, d]);
}

/** Kit (zip/pasta/plugin) → skill com regras (literais por etapa + obrigatórias) e bibliotecas; Range do forge-file; skills de drama. */
async function main() {
  /* ── funções puras ── */
  assert.equal(unwrap('Uma frase que\ncontinua aqui.\n\n- item\n- outro'), 'Uma frase que continua aqui.\n\n- item\n- outro');
  assert.deepEqual(sectionSteps('2. Script formula'), ['script']);
  assert.deepEqual(sectionSteps('Before anything (every time)'), ['tooling']);
  assert.ok(sectionSteps('5. Camera (never still)').includes('code_scene'));
  assert.ok(sectionSteps('8. Sound').includes('sfx'));

  /* ── kit sintético: SKILL.md com assinatura, regras, instalação, voz restrita, rostos, sons, exemplo ── */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-kit-'));
  const kit = path.join(root, 'meu-kit');
  for (const d of ['assets/faces', 'assets/tex', 'sfx', 'voice', 'videos/ep1']) fs.mkdirSync(path.join(kit, d), { recursive: true });
  fs.writeFileSync(path.join(kit, 'SKILL.md'), `---
name: meu-kit
description: Make original 3D animated story shorts with blocky characters.
---

# Meu kit (Flashloop edition)

The kit works only for users with a Flashloop subscription. Call flashloop_whoami first.
The narrator voice is cloned from voice/narrator.mp3, provided by the kit's author for kit users.

## Before anything

Run \`$PY tools/setup.py\` and install Blender 5.x.

## 1. Script formula

The hook line must show the result first, ending on the most
visual word. Never start with a title.
- Sentences of 3-10 words.

## 2. Camera (never still)

Every shot has camera motion. Hold a perfectly still frame never.

## 3. Sound

- SFX on every onomatopoeia and every impact.
`);
  fs.writeFileSync(path.join(kit, 'PLAYBOOK.md'), '# Playbook\n\n## Hook checklist\n\n- [ ] Word 1 at 0.00s.\n- [ ] A reaction close-up within the first 4s.\n');
  fs.writeFileSync(path.join(kit, 'voice', 'narrator.mp3'), Buffer.alloc(4000));
  for (const f of ['hero_eyes.png', 'hero_mouth.png']) fs.writeFileSync(path.join(kit, 'assets', 'faces', f), PNG);
  fs.writeFileSync(path.join(kit, 'assets', 'tex', 'poster.png'), PNG);
  fs.writeFileSync(path.join(kit, 'sfx', 'poof.wav'), wav());
  fs.writeFileSync(path.join(kit, 'sfx', 'whoosh.wav'), wav());
  fs.writeFileSync(path.join(kit, 'sfx', 'pack.json'), JSON.stringify({ poof: { gain: -2, lead: 0.1 } }));
  fs.writeFileSync(path.join(kit, 'videos', 'ep1', 'script.txt'), 'I sneezed and the whole class teleported.');

  const a = analyzeKit(kit);
  assert.equal(a.name, 'meu-kit');
  assert.ok(a.rules.some((r) => /must show the result first, ending on the most visual word/.test(r)), 'regra inteira (linhas juntadas)');
  assert.ok(a.rules.some((r) => /☐ Word 1 at 0\.00s/.test(r)), 'checklist vira regra');
  assert.ok(!a.rules.some((r) => /Flashloop|subscription|\$PY/.test(r)), 'requisito/comando não é regra criativa');
  assert.ok(a.requirements.some((r) => /Flashloop subscription/.test(r)));
  assert.ok(a.tools.includes('blender') && a.tools.includes('flashloop'));
  assert.deepEqual(a.restricted.map((r) => r.file), ['voice/narrator.mp3']);
  assert.equal(a.images.length, 3);
  assert.deepEqual(a.sounds.map((x) => x.id).sort(), ['poof', 'whoosh']);
  assert.equal(a.sounds.find((x) => x.id === 'poof')!.gain, -2);
  assert.deepEqual(a.characters.map((c) => c.name), ['hero']);
  assert.equal(a.examples.length, 1);
  assert.ok(!a.sections.some((x) => /Before anything/.test(x.title)), 'instalação fica fora dos prompts');
  const sc = kitSkillContent(a, { soundIds: { poof: 'poof', whoosh: 'whoosh-kit' }, characterIds: [] });
  assert.match(sc.steps['script']!, /must show the result first/);
  assert.match(sc.steps['code_scene']!, /Hold a perfectly still frame never/);
  assert.match(sc.steps['code_scene']!, /\.\.\/\.\.\/\.\.\/kit\//);
  assert.match(sc.global, /REGRAS DO KIT/);
  assert.match(sc.global, /NÃO rodam aqui/);
  assert.match(sc.global, /voice\/narrator\.mp3/);

  /* ── importar a PASTA (o mesmo vale para .zip/.plugin) ── */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-kit-ws-'));
  const s = defaultSettings(ws);
  const r = await importClaudeSkill(s, { source: kit, language: 'pt-BR' }, () => {});
  const k = r.skills[0]!;
  assert.ok(r.kit && r.kit.rules.length >= 4);
  assert.equal(k.kitId, r.plugin.id);
  assert.equal(k.plugins, undefined, 'o SKILL.md bruto (com contas e comandos) não vai para os prompts');
  assert.equal(k.appearance, 'code_3d', 'kit de animação → cenas por código');
  assert.ok(listSkills(s).find((x) => x.id === k.id)?.kitId, 'kitId sobrevive à gravação em Markdown');
  assert.equal(sfxDef('poof')?.file?.endsWith('poof.wav'), true, 'som do kit na biblioteca de efeitos');
  assert.ok(sfxDef('whoosh-kit')?.file, 'colisão com efeito do app: id próprio');
  const lib = listCharacters(s);
  assert.ok(lib.some((c) => /^Hero \(/.test(c.name) && c.kind === 'codigo' && c.blocky?.face === 'hero'), 'avatar de blocos do kit na Biblioteca');
  assert.ok(lib.some((c) => /^Poster \(/.test(c.name) && c.entity === 'prop' && !!c.sheet), 'textura do kit vira OBJETO com miniatura');
  assert.ok(fs.existsSync(path.join(ws, 'library', 'kits', r.plugin.id, 'faces', 'hero_eyes.png')), 'rostos do kit em faces/');
  assert.ok(fs.existsSync(path.join(ws, 'library', 'kits', r.plugin.id, 'characters.json')), 'presets dos avatares');
  assert.match(k.steps['code_scene']!, /blocky3d\.js/);
  /* reimportar atualiza a mesma skill */
  const r2 = await importClaudeSkill(s, { source: kit, language: 'pt-BR' }, () => {});
  assert.equal(r2.skills[0]!.id, k.id);
  assert.ok(!fs.existsSync(path.join(ws, 'library', 'kits', r.plugin.id, 'voice', 'narrator.mp3')), 'restrito fica fora');
  /* projeto com a skill do kit: biblioteca copiada para <projeto>/kit/ (sem os sons) */
  const p = createProject(s, { name: 'Teste kit', idea: 'espirro teletransporta', videoType: 'custom', skillId: k.id, routeId: k.routeId } as never);
  const pk = path.join(projectDirOf(s, p.id), 'kit');
  assert.ok(fs.existsSync(path.join(pk, 'assets', 'faces', 'hero_eyes.png')) || fs.readdirSync(pk, { recursive: true } as never).some((f: unknown) => String(f).endsWith('hero_eyes.png')));
  assert.ok(!fs.readdirSync(pk, { recursive: true } as never).some((f: unknown) => String(f).endsWith('.wav')));
  assert.equal(copyKitIntoProject(s, 'nao-existe', pk), false);

  /* ── bonecos de blocos: presets do rig em Python e detecção do kit ── */
  const pre = parseBlockyPresets(`def eddie(name="Eddie", **kw):\n    a = dict(skin="#f1dfc6", shirt="#8db8ee", pants="#3c5cbc", hair="spiky", hair_color="#7c4426",\n             face="hero", bolt="#f2c14e", vneck="#a8cdf6")\n    a.update(kw)\n\ndef dad(name="Dad", **kw):\n    a = dict(skin="#efd9c0", shirt="#f4f4f2", face="mustache", extras=("glasses", "beard"), sleeves="long")\n    a.update(kw)\n`);
  assert.deepEqual(pre.map((p) => p.name), ['Eddie', 'Dad']);
  assert.equal(pre[0]!.hairColor, '#7c4426'); assert.equal(pre[0]!.bolt, '#f2c14e');
  assert.deepEqual(pre[1]!.extras, ['glasses', 'beard']);
  assert.equal(isBlockyKit({ ...a, description: 'blocky R6 toy avatars' }), true);
  assert.equal(isBlockyKit({ ...a, description: 'paper cut', name: 'x', sections: [] }), false);
  assert.match(blockyLook(pre[0]!), /blocky toy avatar "Eddie".*#8db8ee shirt/);

  /* cena de kit de blocos: o validador exige a blocky3d, avatar() e loadFaces() */
  assert.match(blockyPageProblem('<canvas></canvas><script>ctx.fillRect(0,0,1,1)</script>')!, /não importa a biblioteca do kit/);
  assert.match(blockyPageProblem("import { avatar } from '../../../kit/blocky3d.js'; avatar(p, f);")!, /não carrega os rostos/);
  assert.equal(blockyPageProblem("import { loadFaces, avatar } from '../../../kit/blocky3d.js'; const f = await loadFaces('x', ['hero']); avatar(p, f);"), undefined);

  /* ── kit com motor Python: vocabulário do schema e validação do storyboard ── */
  const vocab = schemaVocab('| `set` | string | `bedroom` `couch` `desk` `black` |\n| `palette` | string | `night` `cold` `dawn` |\n`pose` (`stand` `walk` `sit`),\n`mood` (`neutral` `happy` `sad`),');
  assert.deepEqual(vocab['set'], ['bedroom', 'couch', 'desk', 'black']);
  assert.deepEqual(vocab['pose'], ['stand', 'walk', 'sit']);
  assert.equal(storyboardProblem({ scenes: [{ set: 'couch', palette: 'night', duration: 2.5, hero: { pose: 'sit', mood: 'sad' } }, { set: 'black', duration: 2.5 }] }, vocab, 5), undefined);
  assert.match(storyboardProblem({ scenes: [{ set: 'praia', duration: 5 }] }, vocab, 5)!, /set "praia" não existe/);
  assert.match(storyboardProblem({ scenes: [{ set: 'couch', duration: 9 }] }, vocab, 5)!, /soma das durações é 9\.0 s/);
  assert.match(storyboardProblem({ scenes: [{ set: 'couch', duration: 5, hero: { pose: 'fly' } }] }, vocab, 5)!, /hero\.pose "fly"/);
  assert.match(storyboardProblem({}, vocab)!, /scenes/);
  /* LICENSE: material de terceiros fica fora; fonte com licença livre entra */
  const lic = licenseRestrictedPaths('THIRD-PARTY MATERIAL\n\nreference_screenshots/\n  Frames from films. Copyright belongs to their creators.\n  Do not redistribute.\n\nassets/fonts/Poppins-*.ttf\n  Poppins, SIL Open Font License 1.1. Free to use.\n');
  assert.deepEqual(lic.map((x) => x.prefix), ['reference_screenshots/']);
  /* revisor visual de cenas 3D */
  assert.deepEqual(parseReview('ok {"ok":false,"issues":[{"t":1.6,"problem":"câmera dentro do quadro-negro","fix":"afastar a câmera"}]}'), ['t≈1.6s: câmera dentro do quadro-negro → afastar a câmera']);
  assert.deepEqual(parseReview('{"ok":true,"issues":[]}'), []);
  assert.equal(is3dScene("import * as THREE from 'three';"), true);
  assert.equal(is3dScene("import { avatar } from '../../../kit/blocky3d.js';"), true);
  assert.equal(is3dScene('<canvas></canvas><script>ctx.fillRect(0,0,9,9)</script>'), false);
  /* revisor da VERTICAL: o prompt avisa da faixa segura e pede as checagens de 9:16 (corte lateral, 3+ lado a lado) */
  const pv = reviewPrompt('review-sheet.jpg', 'Eddie na sala', { aspect: '9:16', width: 1080, height: 1920 });
  assert.match(pv, /É VERTICAL/);
  assert.match(pv, /linhas AMARELAS/);
  assert.match(pv, /MAIS DE 2 PERSONAGENS LADO A LADO/);
  assert.match(pv, /1080×1920/);
  const ph = reviewPrompt('review-sheet.jpg', 'Eddie na sala', { aspect: '16:9', width: 1920, height: 1080 });
  assert.ok(!/É VERTICAL/.test(ph) && !/MAIS DE 2 PERSONAGENS/.test(ph), 'na horizontal as checagens da vertical não entram');
  assert.match(reviewFixPrompt('scenes/s01/code/scene.html', ['t≈2s: Eddie cortado'], { aspect: '9:16' }), /afastar a câmera/);
  /* trilha: escolhida à mão nunca é refeita; a da rota é refeita quando a configuração muda */
  const od = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-music-'));
  const pm = { musicStyle: 'lofi', codeMusic: true, route: { steps: [{ kind: 'music', enabled: true, bindings: [{ type: 'builtin', tool: 'music-code' }] }] } };
  assert.equal(musicStale(od, pm), true, 'sem trilha: refaz');
  fs.writeFileSync(path.join(od, 'music.wav'), 'x');
  assert.equal(musicStale(od, pm), false, 'sem marcador (versão anterior): preserva');
  writeMusicSource(od, { by: 'route', key: musicKey(pm) });
  assert.equal(musicStale(od, pm), false);
  assert.equal(musicStale(od, { ...pm, musicStyle: 'darksynth' }), true, 'mudou o estilo: refaz');
  writeMusicSource(od, { by: 'user' });
  assert.equal(musicStale(od, { ...pm, musicStyle: 'darksynth' }), false, 'escolhida à mão: nunca');
  /* o marcador não pode parecer trilha (music.<ext>): nome antigo music.source.json é migrado */
  assert.ok(fs.existsSync(path.join(od, 'music-source.json')) && !fs.readdirSync(od).some((f) => /^music\.(json|source)/i.test(f)));
  fs.renameSync(path.join(od, 'music-source.json'), path.join(od, 'music.source.json'));
  assert.equal(musicStale(od, pm), false); assert.ok(!fs.existsSync(path.join(od, 'music.source.json')) && fs.existsSync(path.join(od, 'music-source.json')), 'migrado');
  fs.rmSync(od, { recursive: true, force: true });

  /* ── Range do forge-file (seek do "Ver final") ── */
  assert.deepEqual(parseRange('bytes=1000-1999', 307173), { start: 1000, end: 1999 });
  assert.deepEqual(parseRange('bytes=1000-', 5000), { start: 1000, end: 4999 });
  assert.deepEqual(parseRange('bytes=-500', 5000), { start: 4500, end: 4999 });
  assert.deepEqual(parseRange('bytes=0-99999', 100), { start: 0, end: 99 });
  assert.equal(parseRange('bytes=6000-', 5000), undefined);
  assert.equal(parseRange('items=0-1', 5000), undefined);
  assert.equal(mimeOf('a/final.MP4'), 'video/mp4');

  /* ── microdrama / drama ── */
  const md = DRAMA_SKILLS.find((x) => x.id === 'microdrama-muse')!;
  assert.equal(md.routeId, 'microdrama-muse'); assert.equal(md.durationSec, 60); assert.equal(md.scriptEnding, 'next');
  assert.match(md.steps['script']!, /CLIFFHANGER PRIMEIRO/);
  assert.match(md.steps['scene_plan']!, /ATÉ 10 s/);
  assert.match(md.steps['image']!, /room below for subtitles/);
  const route = ROUTES.find((x) => x.id === 'microdrama-muse')!;
  assert.ok(route.steps.find((st) => st.id === 'video')!.bindings.some((b) => b.type === 'api' && b.model === 'muse-ai-video'));
  assert.ok(!route.steps.some((st) => st.kind === 'narration'), 'a voz vem do clipe (sem TTS)');
  assert.ok(listSkills(s).some((x) => x.id === 'drama-episodios'));

  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(ws, { recursive: true, force: true });
  console.log('kits tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
