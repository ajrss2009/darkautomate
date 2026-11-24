import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { avatarPrompt, importAvatarPoses, poseOf, stripAvatarTags } from '../main/avatar-poses';
import { spokenText } from '../main/cast';
import { ROUTES } from '../main/presets';
import { BUILTIN_SKILLS as ALL_SKILLS } from '../main/skills-builtin';


/** Entradas do catálogo: poses do avatar, rota natalina texto→vídeo com prefixo, lote de cortes. */
function main() {
  assert.equal(poseOf('C:/x/avatar_Surpreso.png'), 'surpreso');
  assert.equal(poseOf('Avatar-Laugh-2.png'), 'riso');
  assert.equal(poseOf('avatar_cético.png'), 'cetico');
  assert.equal(stripAvatarTags('Eles se movem sozinhos. [AVATAR:medo] E ninguém viu.'), 'Eles se movem sozinhos. E ninguém viu.');
  assert.equal(spokenText({ narration: 'Os bonecos andam. [AVATAR:medo]' }), 'Os bonecos andam.', 'a narração não fala a marcação');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-av-'));
  const src = path.join(dir, 'poses'); fs.mkdirSync(src);
  for (const n of ['avatar_neutro.png', 'avatar_surprised.png', 'avatar_medo.png', 'leia-me.txt']) fs.writeFileSync(path.join(src, n), 'x');
  const user = path.join(dir, 'proj', 'assets', 'user');
  const poses = importAvatarPoses(user, src);
  assert.deepEqual(Object.keys(poses).sort(), ['medo', 'neutro', 'surpreso']);
  assert.ok(fs.existsSync(path.join(user, 'avatar', 'avatar_surpreso.png')));
  const pr = avatarPrompt(poses, user, 'script');
  assert.match(pr, /surpreso: .*avatar_surpreso\.png/);
  assert.match(pr, /Não há: cetico, riso, pensativo, apontando, perfil/);
  assert.equal(avatarPrompt(poses, user, 'narration'), '');
  assert.throws(() => importAvatarPoses(user, path.join(dir, 'nada')), /não encontradas/);
  fs.rmSync(dir, { recursive: true, force: true });

  /* Natal retrofuturista 50: rota texto → vídeo, sem quadro-chave, prefixo fixo em todo prompt */
  const sk = ALL_SKILLS.find((k) => k.id === 'natal-retrofuturista-50')!;
  assert.equal(sk.routeId, 'musica-natalina-retro-t2v');
  assert.ok(sk.promptPrefix?.startsWith('1950s retro-futuristic Atompunk aesthetic, shot on 3-strip Technicolor 35mm film') && /strictly no music\.$/.test(sk.promptPrefix));
  const r = ROUTES.find((x) => x.id === 'musica-natalina-retro-t2v')!;
  assert.ok(r && !r.steps.some((s) => s.kind === 'image'), 'sem etapa de imagem');
  const v = r.steps.find((s) => s.kind === 'video')!;
  assert.deepEqual(v.dependsOn, ['scene_plan']);
  assert.equal((v.bindings[0] as { template?: string }).template, 'wan2gp-h3-fl2va-hyperflow-t2v.json');
  /* as outras duas skills de Natal continuam com quadro-chave */
  assert.equal(ALL_SKILLS.find((k) => k.id === 'natal-anos-60')!.routeId, 'musica-natalina-retro');
}

main();
console.log('catalog-inputs tests: OK');

/* Referências para o SnapGen (Muse/Meta/Nano Banana): até 10, sem repetir, de todas as fontes */
import { sceneReferenceImages } from '../main/executors';
(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-refs-'));
  const user = path.join(dir, 'assets', 'user'); fs.mkdirSync(user, { recursive: true });
  const atts: Array<{ file: string; kind: 'image' | 'audio'; use: 'reference' | 'character' | 'scene' | 'music'; character?: string }> = [];
  for (let i = 1; i <= 8; i++) { fs.writeFileSync(path.join(user, `ref${i}.png`), 'x'); atts.push({ file: `ref${i}.png`, kind: 'image', use: 'reference' }); }
  fs.writeFileSync(path.join(user, 'ana.jpg'), 'x'); atts.push({ file: 'ana.jpg', kind: 'image', use: 'character', character: 'Ana' });
  fs.writeFileSync(path.join(user, 'cena.png'), 'x'); atts.push({ file: 'cena.png', kind: 'image', use: 'scene' });
  fs.writeFileSync(path.join(user, 'trilha.mp3'), 'x'); atts.push({ file: 'trilha.mp3', kind: 'audio', use: 'music' });
  const style = path.join(dir, 'estilo.webp'); fs.writeFileSync(style, 'x');
  const skillRef = path.join(dir, 'skillref.png'); fs.writeFileSync(skillRef, 'x');
  const project = { attachments: atts, styleRef: { file: style, stylePrompt: '', at: '' }, skill: { refImages: [skillRef] }, characters: [] } as never;
  const all = sceneReferenceImages({ project, projectDir: dir, scene: undefined }, [], 20);
  assert.equal(all[0], path.join(user, 'ana.jpg'), 'personagem primeiro');
  assert.ok(all.includes(style) && all.includes(skillRef), 'estilo e referências da skill entram');
  assert.ok(!all.some((f) => /cena\.png|trilha/.test(f)), 'mídia de cena e áudio não são referência');
  assert.equal(sceneReferenceImages({ project, projectDir: dir, scene: undefined }).length, 10, 'no máximo 10');
  const ex = sceneReferenceImages({ project, projectDir: dir, scene: undefined }, [path.join(user, 'ana.jpg')], 9);
  assert.ok(!ex.includes(path.join(user, 'ana.jpg')) && ex.length === 9, 'quadro já enviado não repete; 9 + o quadro = 10');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✓ referências SnapGen: personagem → anexos → estilo → skill, até 10');
})();
