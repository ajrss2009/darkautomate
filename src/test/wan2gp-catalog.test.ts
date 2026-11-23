import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateRoute } from '../main/library';
import { ROUTES } from '../main/presets';
import { BUILTIN_SKILLS } from '../main/skills-builtin';
import { hyperflowFor, mergeWan2gpModels, scanWan2gpCatalog, wan2gpCategory } from '../main/wan2gp-catalog';
import { applyHyperflowDefault, h3Distilled, h3Family } from '../main/h3accel';
import { fitSceneKinds, h3SpeechMinRule, lyricSceneRule, routeSceneKinds, splitLongScenes } from '../main/prompts';

/**
 * CATÁLOGO WAN2GP (todos os modelos de imagem, vídeo, música, voz, efeitos, 3D e mundos), regra do MiniMax H3
 * HyperFlow Flash 14B (Ref2VA com referência, FL2VA sem), skills de Natal 50s/60s e UGC no estilo da referência.
 */
function main() {
  /* ── classificação ── */
  const cat = (id: string, architecture = id, name = '', description = '') => wan2gpCategory(id, { architecture, name, description });
  assert.equal(cat('minimax_h3_fl2va_hyperflow', 'minimax_h3_fl2va_pruned'), 'video');
  assert.equal(cat('minimax_h3_ref2va_hyperflow', 'minimax_h3_ref2va_pruned'), 'video');
  assert.equal(cat('minimax_h3_image'), 'image');
  assert.equal(cat('minimax_p_h3_image'), 'image');
  assert.equal(cat('minimax_h3_tts_ref2va_pruned'), 'voice');
  assert.equal(cat('minimax_music3'), 'music');
  assert.equal(cat('ace_step_v1_5_xl_turbo_lm_0_6b', 'ace_step_v1_5_xl'), 'music');
  assert.equal(cat('stable_audio3_small_sfx', 'stable_audio3_small'), 'sfx');
  assert.equal(cat('omnivoice'), 'voice');
  assert.equal(cat('qwen3_tts_voicedesign'), 'voice');
  assert.equal(cat('z_image_twinflow_turbo', 'z_image'), 'image');
  assert.equal(cat('flux2_klein_9b'), 'image');
  assert.equal(cat('ltx2_25_22B_distilled', 'ltx2_25_22B'), 'video');
  assert.equal(cat('hunyuan3d_21_shape'), '3d');
  assert.equal(cat('trellis2_texture'), '3d');
  assert.equal(cat('triposplat_idol', 'triposplat'), '3d');
  assert.equal(cat('qwen35_glb_coder'), '3d');
  assert.equal(cat('evoke_turbo', 'evoke_turbo', 'EVOKE Turbo World 14B', 'makes an explorable world from a start image'), 'world');
  assert.equal(cat('hy_nomas'), 'world');
  assert.equal(cat('worldmirror_2'), 'world');
  assert.equal(cat('nemotron_transcribe'), undefined, 'transcrição não é modelo de geração');
  console.log('✓ classificação: imagem, vídeo, música, voz, efeitos, 3D e mundos');

  /* ── catálogo de uma pasta defaults ── */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-wcat-'));
  fs.mkdirSync(path.join(root, 'defaults'));
  const def = (id: string, model: Record<string, unknown>) => fs.writeFileSync(path.join(root, 'defaults', `${id}.json`), JSON.stringify({ model }));
  def('minimax_h3_fl2va_hyperflow', { name: 'MiniMax H3 FL2VA HyperFlow Flash 14B', architecture: 'minimax_h3_fl2va_pruned', hyperflow: true });
  def('minimax_h3_ref2va_hyperflow', { name: 'MiniMax H3 Ref2VA HyperFlow Flash 14B', architecture: 'minimax_h3_ref2va_pruned', hyperflow: true });
  def('hy_nomas', { name: 'Hy-Nomas World Model 8B', architecture: 'hy_nomas' });
  def('nemotron_transcribe', { name: 'Nemotron', architecture: 'nemotron_transcribe' });
  fs.writeFileSync(path.join(root, 'defaults', 'quebrado.json'), '{');
  const scanned = scanWan2gpCatalog(root);
  assert.deepEqual(scanned.map((m) => m.model_type).sort(), ['hy_nomas', 'minimax_h3_fl2va_hyperflow', 'minimax_h3_ref2va_hyperflow']);
  assert.ok(scanned.find((m) => m.model_type === 'minimax_h3_fl2va_hyperflow')!.hyperflow);
  const merged = mergeWan2gpModels([{ kind: 'video', model: 'minimax_h3_fl2va_hyperflow' }, { kind: 'image', model: 'meu_modelo' }], scanned);
  assert.equal(merged.length, 4, 'junta sem repetir e mantém o que o usuário pôs');
  assert.ok(merged.some((m) => m.kind === 'world' && m.model === 'hy_nomas'));
  fs.rmSync(root, { recursive: true, force: true });
  /* instalação real (se houver): todas as categorias presentes e os dois HyperFlow */
  const real = 'F:/pinokio/api/wan.git/app';
  if (fs.existsSync(path.join(real, 'defaults'))) {
    const all = scanWan2gpCatalog(real);
    for (const k of ['image', 'video', 'music', 'voice', 'sfx', '3d', 'world']) assert.ok(all.some((m) => m.category === k), `catálogo real tem ${k}`);
    assert.ok(all.some((m) => m.model_type === 'minimax_h3_fl2va_hyperflow') && all.some((m) => m.model_type === 'minimax_h3_ref2va_hyperflow'));
    const h3 = all.filter((m) => m.model_type.startsWith('minimax_h3') || m.model_type.startsWith('minimax_p_h3') || m.model_type === 'minimax_music3');
    console.log(`✓ catálogo real: ${all.length} modelos (${h3.length} MiniMax H3), HyperFlow FL2VA e Ref2VA presentes`);
  }

  /* ── regra HyperFlow ── */
  assert.equal(hyperflowFor(true), 'minimax_h3_ref2va_hyperflow');
  assert.equal(hyperflowFor(false), 'minimax_h3_fl2va_hyperflow');
  assert.ok(h3Distilled('minimax_h3_fl2va_hyperflow') && h3Family('minimax_h3_ref2va_hyperflow') === 'ref2va');
  const lora = 'minimax_h3_lightx2v_ref2v_turbo_4step_alpha8_v0.1_bf16.safetensors';
  /* template Ref2VA COM elenco → Ref2VA HyperFlow, sem LoRA de aceleração, 6 passos */
  const r1 = applyHyperflowDefault('minimax_h3_ref2va_pruned', { image_refs: ['a.png'], video_prompt_type: 'I', activated_loras: [lora, 'estilo.safetensors'], loras_multipliers: '1.0 0.7', num_inference_steps: 4 });
  assert.equal(r1.modelType, 'minimax_h3_ref2va_hyperflow');
  assert.deepEqual(r1.settings['activated_loras'], ['estilo.safetensors']);
  assert.equal(r1.settings['loras_multipliers'], '0.7');
  assert.equal(r1.settings['num_inference_steps'], 6);
  assert.equal(r1.settings['guidance_scale'], 1);
  /* template Ref2VA SEM referência (texto → vídeo) → FL2VA HyperFlow, sem image_refs */
  const r2 = applyHyperflowDefault('minimax_h3_ref2va_pruned_pdd', { video_prompt_type: '', image_prompt_type: '' });
  assert.equal(r2.modelType, 'minimax_h3_fl2va_hyperflow');
  assert.ok(!('image_refs' in r2.settings) && !('video_prompt_type' in r2.settings));
  /* FL2VA com quadro de partida, sem referência → FL2VA HyperFlow mantendo image_start */
  const r3 = applyHyperflowDefault('minimax_h3_fl2va_pruned_pdd', { image_prompt_type: 'S', image_start: 'k.png' });
  assert.equal(r3.modelType, 'minimax_h3_fl2va_hyperflow');
  assert.equal(r3.settings['image_start'], 'k.png');
  /* áudio de referência (dublagem/trecho da canção) também é referência → Ref2VA */
  const r4 = applyHyperflowDefault('minimax_h3_fl2va_pruned', { image_prompt_type: 'S', image_start: 'k.png', audio_prompt_type: 'A', audio_guide: 'v.wav' });
  assert.equal(r4.modelType, 'minimax_h3_ref2va_hyperflow');
  assert.deepEqual(r4.settings['image_refs'], ['k.png']);
  assert.equal(r4.settings['video_prompt_type'], 'I');
  /* fora do H3 de vídeo: nada muda */
  assert.equal(applyHyperflowDefault('ltx2_22B_distilled', { a: 1 }).modelType, 'ltx2_22B_distilled');
  assert.equal(applyHyperflowDefault('minimax_h3_tts_ref2va_pruned', {}).modelType, 'minimax_h3_tts_ref2va_pruned');
  console.log('✓ H3: Ref2VA HyperFlow Flash 14B com referência, FL2VA HyperFlow Flash 14B sem');

  /* ── templates HyperFlow ── */
  const wf = (f: string) => JSON.parse(fs.readFileSync(path.join('workflows', f), 'utf8')) as { model_type: string; needsRefs?: boolean; productRefs?: boolean; settings: Record<string, unknown> };
  assert.equal(wf('wan2gp-h3-fl2va-hyperflow.json').model_type, 'minimax_h3_fl2va_hyperflow');
  assert.equal(wf('wan2gp-h3-fl2va-hyperflow.json').settings['image_start'], '{{init_image}}');
  assert.equal(wf('wan2gp-h3-fl2va-hyperflow-t2v.json').settings['image_prompt_type'], '');
  assert.ok(wf('wan2gp-h3-ref2va-hyperflow.json').needsRefs);
  assert.ok(wf('wan2gp-h3-ugc-hyperflow.json').productRefs);
  for (const f of ['wan2gp-h3-fl2va-hyperflow.json', 'wan2gp-h3-ref2va-hyperflow.json']) assert.equal(wf(f).settings['num_inference_steps'], 6);

  /* ── rota e skills de Natal ── */
  const natal = ROUTES.find((r) => r.id === 'musica-natalina-retro')!;
  assert.deepEqual(validateRoute(natal), []);
  const song = natal.steps.find((s) => s.id === 'song')!;
  assert.deepEqual(song.bindings[0], { type: 'builtin', tool: 'lyric-song' });
  assert.equal((song.params as Record<string, unknown>)['template'], 'wan2gp-music-ace.json');
  assert.equal(wf('wan2gp-music-ace.json').model_type, 'ace_step_v1_5_xl', 'ACE-Step 1.5 XL');
  const vid = natal.steps.find((s) => s.id === 'video')!;
  assert.deepEqual(vid.bindings[0], { type: 'wan2gp', template: 'wan2gp-h3-fl2va-hyperflow.json' });
  assert.equal((vid.params as Record<string, unknown>)['maxClipSec'], 10);
  assert.ok(natal.steps.find((s) => s.id === 'edit')!.dependsOn.includes('song'));
  assert.ok(natal.steps.find((s) => s.id === 'scene_plan')!.dependsOn.includes('song'), 'cenas no tempo dos versos');
  for (const id of ['musica-natalina-retro', 'natal-retrofuturista-50', 'natal-anos-60']) {
    const k = BUILTIN_SKILLS.find((x) => x.id === id);
    assert.ok(k, `skill ${id}`);
    assert.equal(k!.routeId, 'musica-natalina-retro');
    assert.equal(k!.durationSec, 60);
    assert.match(k!.global, /6 cenas de 10 s/);
    assert.match(k!.global, /ORIGINAL/);
    assert.match(k!.steps['script']!, /LYRICS:/);
    assert.match(k!.steps['scene_plan']!, /EXATAMENTE 6 cenas de 10 s/);
    assert.ok(!k!.musicVideo, 'canção gerada, não banco de músicas');
  }
  assert.match(BUILTIN_SKILLS.find((x) => x.id === 'natal-retrofuturista-50')!.global, /FLUTUANDO sobre propulsores/);
  assert.match(BUILTIN_SKILLS.find((x) => x.id === 'musica-natalina-retro')!.global, /crooner barítono/);
  console.log('✓ Natal 50s/60s: canção com letra no ACE-Step XL, 6 × 10 s no H3 FL2VA HyperFlow, 3 skills');

  /* ── UGC no estilo da referência ── */
  const ugc = ROUTES.find((r) => r.id === 'ugc-produto')!;
  assert.deepEqual(validateRoute(ugc), []);
  const uv = ugc.steps.find((s) => s.id === 'video')!.bindings;
  assert.deepEqual(uv[0], { type: 'api', provider: 'snapgen', model: 'muse-ai-video' });
  assert.deepEqual(uv[1], { type: 'wan2gp', template: 'wan2gp-h3-ugc-hyperflow.json' });
  assert.equal((ugc.steps.find((s) => s.id === 'edit')!.params as Record<string, unknown>)['defaultTransition'], 'none', 'corte seco');
  const uk = BUILTIN_SKILLS.find((x) => x.id === 'ugc-produto')!;
  assert.match(uk.global, /4 PLANOS/);
  assert.match(uk.global, /SEM LEGENDAS/);
  assert.match(uk.steps['scene_plan']!, /EXATAMENTE 4 cenas/);
  assert.equal(uk.durationSec, 16);
  console.log('✓ UGC: 4 planos com corte seco, sem legenda, muse.ai → H3 Ref2VA HyperFlow');

  /* ── tipos de cena: o app só troca o que a rota não produz ── */
  const natalProj = { route: natal } as never;
  const kinds = routeSceneKinds(natalProj);
  assert.ok(kinds.has('video') && !kinds.has('code'));
  /* lyric video da rota de Natal: cenas "video" de no máximo 10 s (antes: sempre "code" → cartões no lugar dos clipes) */
  assert.match(lyricSceneRule(natalProj, kinds), /"kind":"video"[\s\S]*NO MÁXIMO 10 s/);
  const fit = fitSceneKinds([{ kind: 'code', durationSec: 10 }, { kind: 'video', durationSec: 10 }], kinds);
  assert.equal(fit.changed, 1);
  assert.deepEqual(fit.list.map((s) => s.kind), ['video', 'video']);
  const sp = splitLongScenes([{ id: 's01', title: 'A', narration: 'v1 / v2 / v3 / v4', durationSec: 18.6 }, { id: 's02', title: 'B', narration: 'x', durationSec: 9 }], 10);
  assert.ok(sp.changed);
  assert.deepEqual(sp.list.map((s) => [s.id, s.narration, s.durationSec]), [['s01', 'v1 / v2', 9.3], ['s02', 'v3 / v4', 9.3], ['s03', 'x', 9]]);
  assert.equal(splitLongScenes([{ durationSec: 30 }], 0).changed, false, 'sem limite de clipe: não divide');
  /* nenhuma skill embutida pede um tipo de cena que a rota dela não produz (senão o app trocaria o tipo) */
  for (const k of BUILTIN_SKILLS.filter((x) => x.routeId)) {
    const r = ROUTES.find((x) => x.id === k.routeId);
    if (!r) continue;
    const rk = routeSceneKinds({ route: r } as never);
    if (!rk.size) continue;
    const asked = [...new Set([...(k.steps['scene_plan'] ?? '').matchAll(/kind"?\s*[:=]?\s*"(code|video|image|stock|motion|mixed)"/g)].map((m) => m[1]!))];
    for (const a of asked) assert.ok(rk.has(a), `skill ${k.id} pede cenas "${a}" mas a rota ${r.id} só produz ${[...rk].join(', ')}`);
  }
  console.log('✓ tipos de cena: lyric video segue a rota (vídeo ≤ 10 s), cenas longas divididas, skills coerentes com as rotas');

  /* fala gerada no vídeo H3: cenas de no mínimo 4,5 s (o clipe mínimo do H3 esticava o microdrama de 15 s para 26 s) */
  assert.match(h3SpeechMinRule({ h3Speech: true, h3SpeechMode: 'internal', targetDurationSec: 15 }), /NO MÍNIMO 4\.5 s[\s\S]*no máximo 3 cena/);
  assert.equal(h3SpeechMinRule({ h3Speech: true, h3SpeechMode: 'dub', targetDurationSec: 15 }), '', 'dublagem: a cena segue a narração');
  assert.equal(h3SpeechMinRule({ targetDurationSec: 15 }), '');
}

main();
console.log('wan2gp-catalog tests: OK');
