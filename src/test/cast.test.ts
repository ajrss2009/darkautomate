import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { autoCast, castApiVoice, castRefPrompt, charactersInScene, genderOf, injectCastRefs, portraitFile, voiceSheet } from '../main/cast';
import { buildPrompt, codeCastText, isCastStory, routeSceneKinds } from '../main/prompts';
import { ROUTES } from '../main/presets';
import { BUILTIN_SKILLS } from '../main/skills-builtin';
import { defaultSettings, createProject } from '../main/settings';
import type { ExecContext } from '../main/engine';
import type { Project } from '../shared/types';

/** Dorama e histórias com elenco: bíblia de personagens, vozes por personagem e retratos no MiniMax H3 ref2video. */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cast-'));
  const s = defaultSettings(ws);
  const dir = path.join(ws, 'proj');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'assets.md'), [
    '# Bíblia', '## Personagens fixos',
    '- **Ji-woo**: young Korean woman, 24, long black hair, cream trench coat, small silver necklace',
    '- **Min-ho**: Korean man, 28, short wavy hair, navy suit, tired eyes',
    '## Vozes',
    '- **Ji-woo**: feminina, 24 anos, voz doce e hesitante',
    '- **Min-ho**: masculina, 28 anos, grave e contida',
    '- **NARRADOR**: masculina, calma',
    '## Desenho em código',
    '- Ji-woo: cabeça redonda #F5D7C4, cabelo longo #1B1B1B, casaco #EDE3D1',
    '## Cenários', '- Café de Seul à noite',
  ].join('\n'));

  /* gênero com acentos (\b do JS não serve) */
  assert.equal(genderOf('voz da moça'), 'f'); assert.equal(genderOf('irmã mais velha'), 'f'); assert.equal(genderOf('masculina, grave'), 'm'); assert.equal(genderOf('neutra'), '?');
  assert.deepEqual(voiceSheet(dir).map((v) => v.name), ['Ji-woo', 'Min-ho', 'NARRADOR']);

  /* elenco automático: uma voz distinta por personagem, gênero respeitado, sem tocar no que o usuário definiu */
  const p = { scenes: [{ speaker: 'Min-ho' }, { speaker: 'Ji-woo' }, { speaker: 'NARRADOR' }], cast: [{ speaker: 'Min-ho', refAudio: 'C:/minha-voz.wav' }] } as unknown as Project;
  const voices = ['C:/v/Ana feminina.wav', 'C:/v/Bruno masculino.wav', 'C:/v/neutra.wav'];
  const added = autoCast(p, dir, voices);
  assert.deepEqual(added, ['Ji-woo', 'NARRADOR']);
  const by = (n: string) => p.cast!.find((m) => m.speaker === n)!;
  assert.equal(by('Min-ho').refAudio, 'C:/minha-voz.wav', 'membro do usuário intacto');
  assert.equal(by('Ji-woo').refAudio, 'C:/v/Ana feminina.wav', 'voz feminina para Ji-woo');
  assert.equal(by('NARRADOR').refAudio, 'C:/v/Bruno masculino.wav', 'narrador masculino');
  assert.ok(['nova', 'shimmer', 'coral', 'sage'].includes(by('Ji-woo').voice!));
  assert.match(by('Ji-woo').description!, /trench coat[\s\S]*voz: feminina/);
  assert.deepEqual(autoCast(p, dir, voices), [], 'segunda chamada não duplica');
  /* voz de API por provedor: Gemini recebe voz Gemini do mesmo gênero */
  assert.ok(['Kore', 'Aoede', 'Leda', 'Zephyr'].includes(castApiVoice('gemini', p.cast!, by('Ji-woo'))!));
  assert.equal(castApiVoice('openai', p.cast!, by('Ji-woo')), by('Ji-woo').voice);
  assert.equal(castApiVoice('fish', p.cast!, by('Ji-woo')), undefined);

  /* personagens da cena: quem fala primeiro, depois os citados */
  const chars = charactersInScene(dir, { speaker: 'Ji-woo', visualIntent: 'Min-ho watches Ji-woo across the café', narration: '' });
  assert.deepEqual(chars.map((c) => c.name), ['Ji-woo', 'Min-ho']);
  assert.deepEqual(charactersInScene(dir, { visualIntent: 'empty street at night', narration: '' }), []);
  assert.match(portraitFile(dir, 'Ji-woo'), /assets[\\/]characters[\\/]ji-woo\.png$/);

  /* MiniMax H3: retratos entram como ref_image_1.. e o texto define cada sujeito */
  const graph: Record<string, { class_type?: string; inputs?: Record<string, unknown> }> = { 35: { class_type: 'LoadImage', inputs: { image: 'scene.png' } }, 36: { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { prompt: 'x', 'ref_images.ref_image_0': ['35', 0] } } };
  assert.ok(injectCastRefs(graph, ['jiwoo.png', 'minho.png'], chars, 'They meet in the rain'));
  assert.deepEqual(graph['36']!.inputs!['ref_images.ref_image_1'], ['900', 0]);
  assert.deepEqual(graph['36']!.inputs!['ref_images.ref_image_2'], ['901', 0]);
  assert.equal(graph['900']!.inputs!['image'], 'jiwoo.png');
  assert.match(String(graph['36']!.inputs!['prompt']), /<Subject 1> is Ji-woo, the person in <Picture 2>[\s\S]*<Subject 2> is Min-ho, the person in <Picture 3>[\s\S]*They meet in the rain/);
  assert.ok(!injectCastRefs({ 1: { class_type: 'KSampler' } }, ['a.png'], chars, 'x'), 'sem nó ref2video: não mexe');
  assert.match(castRefPrompt('p', []), /<Picture 1> is the scene/);

  /* rotas e skills */
  const cast = ROUTES.find((r) => r.id === 'dorama-elenco')!;
  assert.equal(cast.steps.find((x) => x.id === 'video')!.bindings[0]!.type === 'comfyui' && (cast.steps.find((x) => x.id === 'video')!.bindings[0] as { workflow: string }).workflow, 'minimax-h3-ref2v-cast.json');
  assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'workflows', 'minimax-h3-ref2v-cast.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'workflows', 'minimax-h3-ref2v-cast.map.json'), 'utf8')).castRefs, 2);
  const skills = BUILTIN_SKILLS;
  for (const id of ['dorama', 'historia-elenco', 'dorama-codigo', 'historia-codigo']) {
    const k = skills.find((x) => x.id === id)!;
    assert.ok(k && k.multiVoice && k.steps?.['bible'], `skill ${id} com bíblia e várias vozes`);
    assert.ok(ROUTES.some((r) => r.id === k.routeId), `rota ${k.routeId} existe`);
  }

  /* prompts: bíblia pede vozes; cena em código recebe o elenco */
  const code = createProject(s, { name: 'Dorama', idea: 'Reencontro num café de Seul', videoType: 'custom', routeId: 'dorama-codigo' });
  code.skill = skills.find((x) => x.id === 'dorama-codigo');
  assert.ok(isCastStory(code)); assert.ok(routeSceneKinds(code).has('code'));
  const ctx = (step: string, kind: string, extra: Partial<ExecContext> = {}) => ({ settings: s, project: code, projectDir: dir, outDir: path.join(dir, 'out'), step: { id: step, kind, params: {} }, signal: new AbortController().signal, log: () => {}, ...extra }) as unknown as ExecContext;
  const bible = buildPrompt(ctx('bible', 'asset_design'));
  assert.match(bible, /## Vozes/); assert.match(bible, /Desenho em código/);
  assert.match(codeCastText(dir, 'Ji-woo'), /Ji-woo: young Korean woman[\s\S]*#F5D7C4[\s\S]*Quem fala nesta cena: Ji-woo/);
  const scene = { id: 's01', index: 1, title: 'Café', narration: 'Você voltou?', visualIntent: 'Ji-woo sees Min-ho', kind: 'code', speaker: 'Ji-woo', durationSec: 4, status: {}, artifacts: {} };
  code.scenes = [scene as never];
  assert.match(buildPrompt(ctx('code_scene', 'code_scene', { scene: scene as never, sceneDir: path.join(dir, 'scenes', 's01') })), /ELENCO \(bíblia de personagens/);
  const plain = createProject(s, { name: 'Normal', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot' });
  assert.ok(!isCastStory(plain), 'rota comum não vira história com elenco');

  /* trilha por código em qualquer rota: reserva em toda etapa de trilha e opção do projeto */
  for (const r of ROUTES) for (const st of r.steps.filter((x) => x.kind === 'music' && x.id === 'music'))
    assert.ok(st.bindings.some((b) => b.type === 'builtin' && b.tool === 'music-code'), `rota ${r.id}: trilha por código como reserva`);
  const withCode = createProject(s, { name: 'Com trilha', idea: 'x', videoType: 'custom', routeId: 'dorama-elenco', codeMusic: true });
  assert.equal(withCode.codeMusic, true);
  assert.equal((withCode.route!.steps.find((x) => x.id === 'video')!.bindings[0] as { workflow: string }).workflow, 'minimax-h3-ref2v-cast.json');
  const ollama = createProject(s, { name: 'Ollama', idea: 'x', videoType: 'custom', routeId: 'dorama-elenco', executorProfile: 'local-ollama' });
  assert.equal((ollama.route!.steps.find((x) => x.id === 'video')!.bindings[0] as { workflow: string }).workflow, 'minimax-h3-ref2v-cast.json', 'perfil não troca o workflow do elenco');

  console.log('cast (dorama/histórias) tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
