import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateRoute } from '../main/library';
import { ROUTES } from '../main/presets';
import { BUILTIN_SKILLS } from '../main/skills-builtin';
import { ceilSeconds, fillStarts, lipsyncPrompt, minSpanStarts, productLabel, productRefFiles, productSubjectLines, sceneStartSec } from '../main/ugc-lipsync';
import type { Attachment } from '../shared/types';

/** Skills UGC de produto e Música com lipsync: rotas, skills, templates e funções puras. */
function main() {
  /* início de cada cena na canção: soma das durações anteriores */
  const scenes = [{ id: 's01', durationSec: 4.2 }, { id: 's02', durationSec: 3.8 }, { id: 's03', durationSec: 5 }];
  assert.equal(sceneStartSec(scenes, 's01'), 0);
  assert.equal(sceneStartSec(scenes, 's02'), 4.2);
  assert.equal(sceneStartSec(scenes, 's03'), 8);
  assert.deepEqual([ceilSeconds(3.8), ceilSeconds(4.02), ceilSeconds(1), ceilSeconds(40)], [4, 4, 2, 15]);

  /* versos amontoados no fim (caso real: cenas de 1,9 s, 2,1 s e 0,5 s numa canção de 50 s) → mínimo de 2,5 s */
  const real = [0, 4.4, 13.4, 19.04, 23.4, 31.64, 33.56, 36.26, 41.02, 43.58, 47.9, 49.98];
  const fixed = minSpanStarts(real, 50);
  const lens = fixed.map((x, i) => (i + 1 < fixed.length ? fixed[i + 1]! : 50) - x);
  assert.ok(lens.every((l) => l >= 2.49), lens.join(','));
  assert.equal(fixed[0], 0); assert.equal(fixed[2], 13.4, 'cenas longas no começo não mudam');
  assert.ok(Math.abs(lens.reduce((a, b) => a + b, 0) - 50) < 0.01, 'soma = duração da canção');
  assert.deepEqual(minSpanStarts([0, 0.1, 0.2], 3), [0, 1, 2], 'sem espaço: divide por igual');
  /* intro instrumental (duas cenas sem letra antes do 1º verso em 9,16 s) reparte o intervalo; outro sem letra vai até o fim */
  assert.deepEqual(fillStarts([0, undefined, 9.16, 13.4, undefined], 50), [0, 4.58, 9.16, 13.4, 31.7]);
  assert.deepEqual(fillStarts([undefined, undefined, 6], 10), [0, 3, 6]);

  /* lipsync: pede boca sincronizada, sem letra e sem citar o áudio enviado */
  const lp = lipsyncPrompt('Seo-yeon', 'Seo-yeon on a neon stage, medium close-up.');
  assert.match(lp, /Seo-yeon is singing with natural lip movements synchronized/);
  assert.doesNotMatch(lp, /audio|track|<d>/i);

  /* fotos de produto: referência/cena, sem folhas de personagem e cenário; "produto" primeiro */
  const atts: Attachment[] = [
    { file: 'characters/do-hyun.png', kind: 'image', use: 'character', character: 'Do-hyun' },
    { file: 'locations/cozinha.png', kind: 'image', use: 'reference' },
    { file: 'foto-lado.jpg', kind: 'image', use: 'reference', note: 'detalhe lateral' },
    { file: 'garrafa.png', kind: 'image', use: 'scene', note: 'Produto: garrafa térmica AquaTerm (foto oficial)' },
    { file: 'manual.pdf', kind: 'other', use: 'reference' },
  ];
  const pr = productRefFiles(atts);
  assert.deepEqual(pr.map((a) => a.file), ['garrafa.png', 'foto-lado.jpg']);
  assert.equal(productLabel(pr[0]!), 'Produto: garrafa térmica AquaTerm');
  assert.equal(productLabel({ file: 'tenis_corrida-azul.png' }), 'tenis corrida azul');
  assert.deepEqual(productSubjectLines(['AquaTerm'], 2), ['<Subject 2> is the product "AquaTerm" exactly as in <Picture 2>: same shape, colors, label and packaging.']);

  /* rotas válidas: canção no Wan2GP (ACE-Step XL) antes das cenas; lipsync H3 primeiro no vídeo */
  const ugc = ROUTES.find((r) => r.id === 'ugc-produto')!, mus = ROUTES.find((r) => r.id === 'musica-lipsync')!;
  assert.ok(ugc && mus);
  assert.deepEqual(validateRoute(ugc), []);
  assert.deepEqual(validateRoute(mus), []);
  const song = mus.steps.find((s) => s.id === 'song')!;
  assert.equal((song.params as Record<string, unknown>)['template'], 'wan2gp-music-ace.json');
  assert.deepEqual(mus.steps.find((s) => s.id === 'video')!.bindings[0], { type: 'wan2gp', template: 'wan2gp-h3-lipsync-4step.json' });
  assert.equal(mus.steps.find((s) => s.id === 'edit')!.params['musicVolume'], 1);
  const uv = ugc.steps.find((s) => s.id === 'video')!;
  assert.deepEqual(uv.bindings[0], { type: 'wan2gp', template: 'wan2gp-h3-ugc-4step.json' });
  assert.ok(uv.bindings.some((b) => b.type === 'api' && (b as { model?: string }).model === 'muse-ai-video'), 'reserva Snapgen Muse AI');
  assert.equal(uv.params['videoSpeech'], false, 'a voz fica com a narração do criador');
  assert.equal(uv.params['animateImages'], true, 'cena de foto do produto também é animada (o plano às vezes marca "image")');

  /* skills padrão ligadas às rotas */
  const sk = (id: string) => BUILTIN_SKILLS.find((s) => s.id === id)!;
  assert.equal(sk('ugc-produto').routeId, 'ugc-produto');
  assert.equal(sk('ugc-produto').aspect, '9:16');
  assert.ok(sk('ugc-produto').durationSec! >= 30 && sk('ugc-produto').durationSec! <= 40);
  assert.match(sk('ugc-produto').global, /GANCHO[\s\S]*CTA/);
  assert.equal(sk('musica-lipsync').routeId, 'musica-lipsync');
  assert.ok(!sk('musica-lipsync').musicVideo, 'é canção com letra (lyric-song), não videoclipe de banco');
  assert.match(sk('musica-lipsync').steps['script']!, /SINGER:[\s\S]*STYLE:[\s\S]*LYRICS:/);

  /* templates do Wan2GP: Ref2VA + LoRA de 4 passos; lipsync com a trilha mantida (AS) */
  const wf = (f: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../workflows', f), 'utf8')) as { model_type: string; songSlice?: boolean; productRefs?: boolean; settings: Record<string, unknown> };
  const lip = wf('wan2gp-h3-lipsync-4step.json');
  assert.equal(lip.model_type, 'minimax_h3_ref2va_pruned');
  assert.ok(lip.songSlice);
  assert.equal(lip.settings['audio_prompt_type'], 'AS');
  assert.equal(lip.settings['audio_guide'], '{{song_slice}}');
  assert.equal(lip.settings['num_inference_steps'], 4);
  assert.deepEqual(lip.settings['activated_loras'], ['minimax_h3_lightx2v_ref2v_turbo_4step_alpha8_v0.1_bf16.safetensors']);
  const u = wf('wan2gp-h3-ugc-4step.json');
  assert.ok(u.productRefs);
  assert.equal(u.settings['num_inference_steps'], 4);
  console.log('ugc/lipsync tests: OK');
}
main();
