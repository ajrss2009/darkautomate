import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { refPrompt, speechSeconds, wan2gpKind, wan2gpLanguage } from '../main/wan2gp';
import { cleanWan2gpPost } from '../main/ops';
import { placeholders } from '../main/comfyui';
import { pickShowrunnerTemplates, setWanDirector, showrunnerBrief, showrunnerKind, showrunnerShots } from '../main/showrunner';

/** Wan2GP: modelos instalados viram templates; idioma, elenco, voz clonada e pós-processamento. */
function main() {
  /* idioma do projeto nos formatos de cada TTS */
  assert.deepEqual(wan2gpLanguage('pt-BR'), { name: 'portuguese', code: 'pt', label: 'Brazilian Portuguese' });
  assert.deepEqual(wan2gpLanguage('pt-PT'), { name: 'portuguese', code: 'pt', label: 'Portuguese' });
  assert.equal(wan2gpLanguage('en-US').name, 'english');
  assert.equal(wan2gpLanguage('sv-SE').name, 'auto', 'idioma fora da lista do OmniVoice = auto');
  assert.equal(wan2gpLanguage(undefined).code, 'pt');
  /* tempo de fala para os TTS que pedem segundos */
  assert.equal(speechSeconds(''), 3);
  assert.equal(speechSeconds(Array(26).fill('palavra').join(' ')), 12, '26 palavras ≈ 10 s + respiro');
  assert.equal(speechSeconds(Array(1000).fill('x').join(' ')), 120);
  /* MiniMax H3 com elenco: definição de cada pessoa antes da cena */
  assert.equal(refPrompt([], 'cena'), 'cena');
  assert.equal(refPrompt(['Ana', 'Rui'], 'Os dois caminham.'), 'subject_definitions:\n<Subject 1> is Ana, the person in <Picture 1>, preserving their face, hair and outfit.\n<Subject 2> is Rui, the person in <Picture 2>, preserving their face, hair and outfit.\n\nOs dois caminham.');
  /* modalidade do app pelas saídas do Wan2GP */
  assert.equal(wan2gpKind({ model_type: 'z_image', name: 'Z-Image', main_output: ['image'] }), 'image');
  assert.equal(wan2gpKind({ model_type: 'minimax_h3_fl2va_pruned_pdd', name: 'H3', main_output: ['video'] }), 'video');
  assert.equal(wan2gpKind({ model_type: 'ace_step_v1_5_xl', name: 'Music ACE-Step', main_output: ['audio'] }), 'music');
  assert.equal(wan2gpKind({ model_type: 'stable_audio3_medium', name: 'Music Stable Audio 3', main_output: ['audio'] }), 'music');
  assert.equal(wan2gpKind({ model_type: 'minimax_h3_tts_ref2va_pruned', name: 'TTS MiniMax H3 Voice Clone', main_output: ['audio'] }), 'voice');
  assert.equal(wan2gpKind({ model_type: 'chatterbox', name: 'Chatterbox', main_output: ['audio'] }), 'voice');
  assert.equal(wan2gpKind({ model_type: 'da3_points', name: 'Depth Anything 3', main_output: ['3d'] }), undefined, '3D não entra');
  /* pós-processamento: só valores conhecidos */
  assert.deepEqual(cleanWan2gpPost({ spatial: 'flashvsr*2', temporal: 'rife*2' }), { spatial: 'flashvsr*2', temporal: 'rife*2' });
  assert.deepEqual(cleanWan2gpPost({ spatial: 'rm -rf', temporal: '' }), undefined);
  assert.deepEqual(cleanWan2gpPost({ spatial: '', temporal: 'rife*2' }), { temporal: 'rife*2' });
  assert.equal(cleanWan2gpPost(null), undefined);
  /* todos os templates: JSON válido, capability conhecida e só variáveis que o executor preenche */
  const dir = path.resolve(__dirname, '../../workflows');
  const known = new Set(['delivery', 'sfx_prompt', 'sfx_seconds', 'prompt', 'negative', 'text', 'seed', 'width', 'height', 'resolution', 'frames', 'fps', 'seconds', 'seconds_int', 'music_seconds', 'style', 'lyrics',
    'init_image', 'ref_audio', 'ref_images', 'ref_prompt', 'language_name', 'language_code', 'language_label', 'speech_seconds', 'seconds_ceil', 'song_slice']);
  const files = fs.readdirSync(dir).filter((f) => /^wan2gp-.*\.json$/.test(f));
  assert.ok(files.length >= 17, `templates Wan2GP: ${files.length}`);
  for (const f of files) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { model_type: string; capability: string; settings: Record<string, unknown>; label: string; needsRefs?: boolean; needsRefAudio?: boolean };
    assert.ok(t.model_type && t.label, f);
    assert.ok(['image', 'video', 'voice', 'music', 'sfx'].includes(t.capability), `${f}: capability`);
    for (const v of placeholders(t.settings)) assert.ok(known.has(v), `${f}: variável desconhecida {{${v}}}`);
    if (placeholders(t.settings).includes('ref_images')) assert.ok(t.needsRefs, `${f}: usa o elenco → needsRefs`);
    if (t.settings['audio_guide'] === '{{ref_audio}}') assert.ok(t.needsRefAudio, `${f}: clona voz → needsRefAudio`);
  }
  /* LTX: usa o modelo 2.5 que está no disco (o 2.3 não foi baixado) */
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'wan2gp-ltx2-i2v.json'), 'utf8')).model_type, 'ltx2_25_22B_distilled_nvfp4');
  /* Showrunner: formato, brief a partir do projeto e modelos instalados no lugar dos padrões do Deepy */
  const proj = { name: 'O Farol', idea: 'Um curta sobre um faroleiro solitário', aspect: '16:9' as const, targetDurationSec: 2000, language: 'pt-BR', videoType: 'custom',
    scenes: [{ narration: 'Toda noite ele subia a escada.' }, { narration: ' ' }, { narration: 'E acendia a luz.' }] } as never;
  assert.equal(showrunnerKind(proj), 'short_film');
  assert.equal(showrunnerKind(proj, 'ad'), 'ad', 'parâmetro da etapa vence');
  assert.equal(showrunnerKind({ name: 'x', idea: 'videoclipe da minha música', videoType: 'custom' } as never, 'auto'), 'music_video');
  assert.equal(showrunnerKind({ name: 'x', idea: 'explicar juros compostos', videoType: 'custom' } as never), 'free');
  const sb = showrunnerBrief(proj, 'short_film');
  assert.deepEqual(sb.brief, { text: 'Um curta sobre um faroleiro solitário', script: 'Toda noite ele subia a escada.\n\nE acendia a luz.', duration_s: 600, aspect: '16:9', resolution: '720p', language: 'pt', plan_first: false, review_before_edit: false });
  assert.equal(showrunnerBrief({ ...(proj as object), scenes: [], aspect: '4:5', targetDurationSec: 2 } as never, 'free').brief['aspect'], '16:9');
  const roles = [
    { id: 'images', value: null, auto: 'gen_image/Flux', choices: [{ value: 'gen_image/Flux', label: 'Flux' }, { value: 'gen_image/Z Image Turbo', label: 'Z Image Turbo' }] },
    { id: 'shots_without_cast', value: null, auto: 'gen_video/LTX-2 2.3', choices: [{ value: 'gen_video/LTX-2 2.3', label: 'LTX-2 2.3 Distilled' }, { value: 'gen_video/MiniMax H3 FastH3 Omni', label: 'MiniMax H3 FastH3 Omni 8 Steps' }, { value: 'gen_video/MiniMax H3 FL2VA', label: 'MiniMax H3 FL2VA Pruned PDD 8 Steps' }] },
    { id: 'music', value: 'gen_song/ACE-Step', auto: null, choices: [{ value: 'gen_song/ACE-Step', label: 'ACE-Step 1.5' }] },
    { id: 'voices', value: null, auto: 'x', choices: [{ value: 'gen_speech/Qwen3', label: 'Qwen3 1.7B' }] },
  ];
  assert.deepEqual(pickShowrunnerTemplates(roles), [{ role: 'images', template: 'gen_image/Z Image Turbo' }, { role: 'shots_without_cast', template: 'gen_video/MiniMax H3 FL2VA' }],
    'troca pelos instalados; não repete a escolha atual; sem opção instalada = automático');
  assert.deepEqual(pickShowrunnerTemplates([{ id: 'cast_shots_lip_synced', value: null, auto: 'gen_video_with_speech/Infinitalk', choices: ['Infinitalk', 'MiniMax H3 FL2VA Pruned Turbo Lightx2v 8 Steps With Sound',
    'MiniMax H3 FL2VA Pruned PDD 8 Steps With Sound', 'Pika H3 Flex Ref2VA Pruned 6 Steps With Audio References'].map((l) => ({ value: `gen_video_with_speech/${l}`, label: l })) }]),
  [{ role: 'cast_shots_lip_synced', template: 'gen_video_with_speech/MiniMax H3 FL2VA Pruned PDD 8 Steps With Sound' }], 'fala: H3 PDD com som, não o InfiniTalk (LoRA do Wan 2.1 não baixado)');
  /* modo "o app planeja": cenas → tomadas, com a fala do narrador */
  const shotsOf = showrunnerShots({ scenes: [{ index: 1, title: 'Farol', narration: 'A luz acende.', visualIntent: 'farol', videoPrompt: 'the lamp turns on', camera: 'push-in', durationSec: 22 },
    { index: 2, title: '', narration: '', visualIntent: 'ondas', durationSec: 1 }] } as never, 'Narrator');
  assert.deepEqual(shotsOf, [
    { title: 'Farol', section: '', intent: 'the lamp turns on', camera: 'push-in', duration_s: 15, dialogue: [{ speaker: 'Narrator', line: 'A luz acende.', note: '' }] },
    { title: 'Cena 2', section: '', intent: 'ondas', camera: '', duration_s: 2 }]);
  assert.equal(showrunnerShots({ scenes: [{ index: 1, title: 'x', narration: 'fala', visualIntent: 'v' }] } as never)[0]!['dialogue'], undefined, 'sem narrador: sem fala');
  /* diretor: grava llm_engines.deepy com backup; valor desconhecido não mexe */
  const wroot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wanroot-'));
  fs.writeFileSync(path.join(wroot, 'wgp_config.json'), JSON.stringify({ llm_engines: { deepy: 'qwen38_27b', prompt_enhancer: 'same_as_deepy' }, other: 1 }));
  assert.equal(setWanDirector(wroot, 'rm -rf'), false);
  assert.equal(setWanDirector(wroot, 'qwen38_9b'), true);
  assert.equal(setWanDirector(wroot, 'qwen38_9b'), false, 'já é esse');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(wroot, 'wgp_config.json'), 'utf8')), { llm_engines: { deepy: 'qwen38_9b', prompt_enhancer: 'same_as_deepy' }, other: 1 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(wroot, 'wgp_config.json.filmforge-bak'), 'utf8')).llm_engines.deepy, 'qwen38_27b', 'backup do original');
  fs.rmSync(wroot, { recursive: true, force: true });
  console.log('wan2gp models tests: OK');
}
main();
