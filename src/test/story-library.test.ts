import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Project, Scene, Settings } from '../shared/types';
import { chunkText, emptyExtraction, episodeProject, importStory, mergeExtraction, normalizeExtraction, normalizeSeries, seriesBlock } from '../main/story-import';
import { applyCharacters, charactersPrompt, inScene, listCharacters, mergeBible, normalizeVariants, saveCharacter, sheetPrompt, toProjectCharacter } from '../main/characters';
import { addH3Speech, deliveryEnglish, emotionInstruction, emotionKey, h3SpeechLine, isH3Video, normalizeEmotion, sceneSpeech } from '../main/speech-emotion';
import { normalizeStyleRef, paletteFromPixels, styleBlock, styleVisual, userStyleRef } from '../main/style-ref';
import { applyPicks, candidatePlan, readPicks, sketchIntent, writePick } from '../main/project-storyboard';
import { sfxAiPrompt } from '../main/sfx';
import { narrationInstructions } from '../main/prompts';
import { castRefPrompt } from '../main/cast';

let fails = 0;
const t = async (name: string, fn: () => void | Promise<void>) => { try { await fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, (e as Error).stack?.split('\n').slice(0, 3).join(' | ')); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forge-story-'));
const settingsAt = (ws: string) => ({ workspace: ws } as unknown as Settings);

(async () => {
  await t('chunkText não corta parágrafos e respeita o máximo', () => {
    const p = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i} ` + 'x'.repeat(90)).join('\n\n');
    const ch = chunkText(p, 500);
    assert.ok(ch.length > 3);
    assert.ok(ch.every((c) => c.length <= 500));
    assert.equal(ch.join('\n\n'), p);
    assert.equal(chunkText('a'.repeat(1200), 500).length, 3);
  });

  await t('extração: normaliza, junta por nome/apelido, renumera a linha do tempo', () => {
    const a = normalizeExtraction({ title: 'Jade', characters: [{ name: 'Ji-woo', aliases: ['Woo'], gender: 'female', age: '25', look: 'cabelo preto' }, { name: '' }],
      relations: [{ a: 'Ji-woo', b: 'Min', type: 'casal' }, { a: 'X', b: 'x', type: 'eu' }], timeline: [{ order: 2, event: 'beijo' }, { order: 1, event: 'encontro' }],
      locations: [{ name: 'Café', look: 'tijolos' }], props: [{ name: 'Colar' }] });
    assert.equal(a.characters.length, 1); assert.equal(a.characters[0]!.gender, 'f'); assert.equal(a.relations.length, 1);
    const b = normalizeExtraction({ characters: [{ name: 'Woo', voice: 'doce' }, { name: 'Min', look: 'alto' }], relations: [{ a: 'Min', b: 'Woo', type: 'casal' }], timeline: [{ order: 1, event: 'briga', characters: ['Woo'] }],
      locations: [{ name: 'café', note: 'onde se conhecem' }] });
    const m = mergeExtraction(mergeExtraction(emptyExtraction(), a), b);
    assert.deepEqual(m.characters.map((c) => c.name), ['Ji-woo', 'Min']);
    assert.equal(m.characters[0]!.voice, 'doce');
    assert.equal(m.relations.length, 1, 'mesma relação nos dois sentidos não duplica');
    assert.deepEqual(m.timeline.map((e) => [e.order, e.event]), [[1, 'encontro'], [2, 'beijo'], [3, 'briga']]);
    assert.deepEqual(m.timeline[2]!.characters, ['Ji-woo'], 'apelido vira o nome principal');
    assert.equal(m.locations.length, 1); assert.equal(m.locations[0]!.note, 'onde se conhecem');
  });

  await t('série: nomes ligados à extração, variações por episódio, numeração', () => {
    const ex = mergeExtraction(emptyExtraction(), normalizeExtraction({ characters: [{ name: 'Ji-woo', aliases: ['Woo'] }, { name: 'Min' }], locations: [{ name: 'Café' }] }));
    const plan = normalizeSeries({ title: 'Jade', episodes: [
      { n: 9, title: 'Começo', summary: 'Eles se conhecem.', beats: ['a', 'b'], characters: ['woo', 'Fantasma'], locations: ['café'], variants: { Woo: 'noiva' } },
      { title: 'Fim', summary: 'Casam.', characters: ['Min'] }, { title: 'extra', summary: 'x' }],
    variants: [{ character: 'Ji-woo', label: 'noiva', look: 'vestido branco', episodes: [2] }] }, ex, 2);
    assert.equal(plan.episodes.length, 2);
    assert.deepEqual(plan.episodes.map((e) => e.n), [1, 2]);
    assert.deepEqual(plan.episodes[0]!.characters, ['Ji-woo']);
    assert.deepEqual(plan.episodes[0]!.locations, ['Café']);
    assert.deepEqual(plan.episodes[0]!.variants, { 'Ji-woo': 'noiva' });
    assert.deepEqual(plan.episodes[1]!.variants, { 'Ji-woo': 'noiva' }, 'variação listada pelos episódios');
  });

  await t('importar história preenche a Biblioteca e cria os episódios (IA simulada)', async () => {
    const ws = tmp(); const s = settingsAt(ws);
    saveCharacter(s, { name: 'Min', look: 'aparência do usuário' });
    const text = Array.from({ length: 12 }, (_, i) => `Capítulo ${i}. Ji-woo encontra Min no café e mostra o colar de jade. ` + 'texto '.repeat(40)).join('\n\n');
    let calls = 0;
    const r = await importStory(s, text, { episodes: 2, episodeSec: 60, maxChunks: 3 }, { llm: async (prompt) => {
      calls++;
      if (prompt.includes('SÉRIE')) return { title: 'Jade', arc: 'amor', episodes: [{ title: 'A', summary: 'S1', beats: ['b1'], cliffhanger: 'g1', characters: ['Ji-woo', 'Min'], locations: ['Café'], props: ['Colar de jade'] }, { title: 'B', summary: 'S2', characters: ['Ji-woo'] }],
        variants: [{ character: 'Ji-woo', label: 'noiva', look: 'vestido de noiva', episodes: [2] }] };
      return { characters: [{ name: 'Ji-woo', look: 'mulher de 25 anos, cabelo preto', voice: 'doce' }, { name: 'Min', look: 'IA trocaria' }], locations: [{ name: 'Café', look: 'tijolos' }], props: [{ name: 'Colar de jade', look: 'pingente verde' }],
        timeline: [{ order: 1, event: 'encontro' }] };
    } });
    assert.ok(calls >= 2);
    assert.equal(r.story.episodes.length, 2);
    assert.ok(r.created.includes('Ji-woo') && r.created.includes('Café') && r.created.includes('Colar de jade'));
    assert.ok(r.updated.includes('Min'));
    const lib = listCharacters(s);
    assert.equal(lib.find((c) => c.name === 'Min')!.look, 'aparência do usuário', 'não troca a aparência do usuário');
    assert.equal(lib.find((c) => c.name === 'Café')!.entity, 'location');
    assert.equal(lib.find((c) => c.name === 'Ji-woo')!.variants?.[0]?.label, 'noiva');
    const ep = episodeProject(r.story, 2, lib);
    const jiwoo = lib.find((c) => c.name === 'Ji-woo')!;
    assert.ok(ep.characterIds.includes(jiwoo.id));
    assert.equal(ep.variants[jiwoo.id], 'noiva');
    assert.match(ep.series.previously ?? '', /Ep\. 1 — A: S1 Gancho: g1/);
    assert.match(ep.idea, /Episódio 2 de 2 da série "Jade"/);
    assert.match(seriesBlock({ series: ep.series }, 'script'), /EPISÓDIO 2 DE 2[\s\S]*ANTERIORMENTE/);
    assert.match(seriesBlock({ series: ep.series }, 'metadata'), /Ep\. 2/);
    assert.equal(seriesBlock({ series: ep.series }, 'image'), '');
    await assert.rejects(() => importStory(s, 'curto', {}, { llm: async () => ({}) }), /curto/);
  });

  await t('biblioteca: folhas por tipo, variações e prompt por cena', () => {
    assert.match(sheetPrompt({ name: 'Colar', look: 'jade', kind: 'outro', entity: 'prop' }), /orthographic views[\s\S]*FRONT[\s\S]*SIDE[\s\S]*TOP/);
    assert.match(sheetPrompt({ name: 'Café', look: 'tijolos', kind: 'outro', entity: 'location' }), /WIDE establishing[\s\S]*REVERSE angle[\s\S]*no people/);
    assert.match(sheetPrompt({ name: 'Ji', look: 'base', kind: 'pessoa' }, '', { label: 'noiva', look: 'vestido' }), /variation "noiva"[\s\S]*celebrity/);
    assert.deepEqual(normalizeVariants([{ label: 'Noiva', look: 'vestido', episodes: [2, 'x', -1] }, { label: 'noiva', look: 'dup' }, { label: '', look: 'x' }])?.map((v) => [v.id, v.episodes]), [['noiva', [2]]]);
    const ch = { id: 'ji', name: 'Ji', look: 'base', kind: 'pessoa' as const, variants: [{ id: 'noiva', label: 'Noiva', look: 'vestido' }], createdAt: '' };
    assert.match(toProjectCharacter(ch, 'noiva').look, /^vestido \(variação "Noiva"/);
    assert.equal(toProjectCharacter(ch, 'x').variant, undefined);
    const p = { characters: [{ id: 'ji', name: 'Ji-woo', look: 'base', kind: 'pessoa' as const }, { id: 'cafe', name: 'Café da Esquina', look: 'tijolos', kind: 'outro' as const, entity: 'location' as const },
      { id: 'colar', name: 'Colar de jade', look: 'verde', kind: 'outro' as const, entity: 'prop' as const, models: ['assets/user/models/colar/model-colar.glb'] }] };
    const plan = charactersPrompt(p, 'scene_plan');
    assert.match(plan, /CENÁRIOS FIXOS[\s\S]*Café da Esquina/); assert.match(plan, /OBJETOS FIXOS[\s\S]*Colar de jade/);
    const sc = { title: 'Encontro', visualIntent: 'Ji-woo entra no café da esquina', narration: '', speaker: undefined };
    const vis = charactersPrompt(p, 'image', sc);
    assert.match(vis, /SAME LOCATION[\s\S]*Café da Esquina/); assert.doesNotMatch(vis, /SAME PROPS/);
    assert.match(charactersPrompt(p, 'code_scene', { ...sc, visualIntent: 'o colar brilha' }), /modelo 3D: assets\/user\/models\/colar\/model-colar\.glb/);
    assert.equal(inScene('Colar de jade', { title: '', visualIntent: 'close no JADE', narration: '' }), true);
    const md = mergeBible('', p.characters);
    assert.match(md, /## Personagens fixos\n- \*\*Ji-woo\*\*/); assert.match(md, /## Cenários fixos\n- \*\*Café da Esquina\*\*/); assert.match(md, /## Objetos fixos/);
  });

  await t('aplicar no projeto: variação, cenário como referência e modelo 3D copiado', () => {
    const ws = tmp(); const s = settingsAt(ws);
    const ji = saveCharacter(s, { name: 'Ji', look: 'base', variants: [{ id: 'noiva', label: 'Noiva', look: 'vestido' }] });
    const cafe = saveCharacter(s, { name: 'Café', look: 'tijolos', entity: 'location' });
    const png = path.join(ws, 'f.png'); fs.writeFileSync(png, 'x');
    const glb = path.join(ws, 'Colar.glb'); fs.writeFileSync(glb, 'glb');
    const { addCharacterImage, addCharacterModel } = require('../main/characters') as typeof import('../main/characters');
    addCharacterImage(s, cafe.id, png, 'sheet');
    addCharacterImage(s, ji.id, png, 'variant:noiva');
    addCharacterModel(s, ji.id, glb);
    const dir = path.join(ws, 'proj'); fs.mkdirSync(dir);
    const p = { id: 'p', scenes: [] } as unknown as Project;
    const r = applyCharacters(s, p, dir, [ji.id, cafe.id], { [ji.id]: 'noiva' });
    assert.deepEqual(r.warnings, []);
    assert.equal(p.characters![0]!.variant, 'Noiva');
    assert.ok(p.attachments!.some((a) => a.use === 'character' && a.file === `characters/${ji.id}.png`), 'folha da variação vira a foto do personagem');
    assert.ok(p.attachments!.some((a) => a.use === 'reference' && a.file === `locations/${cafe.id}.png`));
    assert.ok(fs.existsSync(path.join(dir, 'assets', 'user', 'models', ji.id, 'model-colar.glb')));
    assert.deepEqual(p.characters![0]!.models, [`assets/user/models/${ji.id}/model-colar.glb`]);
    assert.equal(p.cast!.length, 1, 'cenário não entra no elenco');
  });

  await t('emoção da fala: rótulos, inglês para a voz e instrução do TTS', () => {
    assert.equal(emotionKey('Sad'), 'triste'); assert.equal(emotionKey('chorando'), 'choro'); assert.equal(emotionKey('xyz'), undefined);
    assert.equal(normalizeEmotion('feliz'), 'alegre'); assert.equal(normalizeEmotion('melancólico profundo'), 'melancólico profundo'); assert.equal(normalizeEmotion(3), undefined);
    assert.equal(deliveryEnglish({ emotion: 'triste', delivery: 'devagar' }), 'sad, low and slightly trembling, devagar');
    assert.equal(deliveryEnglish({}), 'natural and clear narration');
    assert.match(emotionInstruction({ emotion: 'raiva' }), /Emoção desta fala: com raiva/);
    assert.equal(emotionInstruction({}), '');
    assert.match(narrationInstructions({ skill: { steps: { narration: 'tom calmo' } } } as unknown as Project, { emotion: 'sussurro' }), /^Emoção desta fala: sussurrando[\s\S]*tom calmo/);
  });

  await t('MiniMax H3: formato oficial da fala (S1, <d>[Idioma]>, voiceover com lábios fechados, <Audio 1>)', () => {
    assert.equal(isH3Video({ type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v.json' } as never), true);
    assert.equal(isH3Video({ type: 'wan2gp', template: 'wan2gp-h3-elenco.json' } as never), true);
    assert.equal(isH3Video({ type: 'wan2gp', template: 'wan2gp-tts-h3.json' } as never), false);
    assert.equal(isH3Video({ type: 'wan2gp', template: 'wan2gp-image-h3.json' } as never), false);
    const line = h3SpeechLine({ text: 'Eu volto amanhã', language: 'pt-BR', speaker: 'Ji-woo', subjectIndex: 1, emotion: 'triste' });
    assert.match(line, /^<Subject 1> \(S1\) speaks in a sad, low and slightly trembling tone[\s\S]*<d>\[Portuguese\] Eu volto amanhã\.<\/d> This is the only line; before and after it there is no speech at all/);
    const vo = h3SpeechLine({ text: 'Era uma vez', language: 'en-US' });
    assert.match(vo, /The narrator \(S1\) says in an off-screen voiceover[\s\S]*<d>\[English\] Era uma vez\.<\/d> while every on-screen character's lips remain completely closed\./);
    const base = castRefPrompt('a girl in a cafe', [{ name: 'Ji', look: 'x' }]);
    const out = addH3Speech(base, line, '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).');
    assert.doesNotMatch(out, /No speech/);
    assert.match(out, /subject_definitions:\n\n<Audio 1> is the voice-timbre reference/);
    assert.match(out, /detailed_description:\n\n[\s\S]*<d>\[Portuguese\] Eu volto amanhã\.<\/d> This is the only line[^\n]*\n\noverall_soundscape:/);
    assert.match(addH3Speech('plain prompt', 'X says'), /^plain prompt X says The ONLY spoken words[\s\S]*never be spoken\.$/);
    assert.match(out, /overall_soundscape:\n\nThe ONLY spoken words/, 'regra "só o <d> é falado" na trilha do H3');
    const sp = sceneSpeech({ language: 'pt-BR', cast: [{ speaker: 'Min', description: 'alto — voz: grave e calma' }] }, { narration: 'Oi', speaker: 'Min', emotion: 'carinho' });
    assert.match(sp, /Min, with a grave e calma voice \(S1\) speaks in a tender/);
  });

  await t('janela da fala: acha a fala esperada no meio da fala inventada pelo H3', () => {
    const { speechWindow } = require('../main/speech-emotion') as typeof import('../main/speech-emotion');
    const W = (s: string, t0 = 0, step = 0.4) => s.split(' ').map((w, i) => ({ w, start: t0 + i * step, end: t0 + i * step + 0.35 }));
    const after = W('O que você disse? Espeviu a milhãocei andrei. Isso era sua mostra');
    const a = speechWindow(after, 'O que você disse?')!;
    assert.equal(a.start, 0); assert.ok(Math.abs(a.end - 1.55) < 1e-6, String(a.end)); assert.equal(a.matched, 4);
    const before = W('sussurro tremo paralisado quase sem ar. O que você disse?', 0, 0.5);
    const b = speechWindow(before, 'O que você disse?')!;
    assert.equal(b.start, 3); assert.equal(b.matched, 4);
    const misheard = W('Seu Ian, essa carta nunca foi escrita para você.', 0.6);
    assert.ok(speechWindow(misheard, 'Seo-yeon... Essa carta nunca foi escrita para você.'), 'nome mal transcrito ainda casa');
    assert.equal(speechWindow(W('nada a ver com isso aqui'), 'O que você disse?'), undefined);
  });

  await t('dublagem (padrão) e clonagem: modo, áudio copiado 1:1 e duração pela fala', () => {
    const { estimateSpeechSec, h3DubRef, h3Mode } = require('../main/speech-emotion') as typeof import('../main/speech-emotion');
    assert.equal(h3Mode({}), 'dub'); assert.equal(h3Mode({ h3SpeechMode: 'clone' }), 'clone'); assert.equal(h3Mode({ h3SpeechMode: 'internal' }), 'internal');
    const { refPadSec } = require('../main/speech-emotion') as typeof import('../main/speech-emotion');
    assert.equal(refPadSec(1.59), 0.61, 'fala de 1,59 s (o caso do Wan2GP) ganha silêncio até 2,2 s');
    assert.equal(refPadSec(2.5), 0); assert.equal(refPadSec(0), 0);
    assert.match(h3DubRef(2, 'Ji'), /^<Audio 1> is the complete spoken line of <Subject 2> \(S1\); <Audio 1>: fully_copy - it is reused 1:1 as the target video's complete final audio track/);
    assert.equal(estimateSpeechSec('O que você disse?'), 2.6, 'fala curta: cena curta (não sobra clipe para voz inventada)');
    assert.ok(estimateSpeechSec('Seo-yeon... Essa carta nunca foi escrita para você.') > 3.5);
    assert.equal(estimateSpeechSec(Array(80).fill('palavra').join(' ')), 15, 'limite do H3');
  });

  await t('ref2video com voz clonada: workflow ComfyUI, template Wan2GP e queda sem voz', () => {
    const { dropRefAudio, h3SpeechScene, isH3Voice } = require('../main/speech-emotion') as typeof import('../main/speech-emotion');
    const wfDir = path.join(__dirname, '..', '..', 'workflows');
    const wf = JSON.parse(fs.readFileSync(path.join(wfDir, 'minimax-h3-ref2v-voice.json'), 'utf8')) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    assert.equal(wf['60']!.class_type, 'LoadAudio'); assert.equal(wf['60']!.inputs['audio'], '{{ref_audio}}');
    assert.deepEqual(wf['36']!.inputs['ref_audios.ref_audio_0'], ['60', 0], 'voz ligada ao ref_audios do MiniMaxH3ReferenceToVideo');
    assert.deepEqual(wf['36']!.inputs['audio_vae'], ['4', 0], 'o VAE de áudio codifica a voz de referência');
    const side = JSON.parse(fs.readFileSync(path.join(wfDir, 'minimax-h3-ref2v-voice.map.json'), 'utf8')) as { castRefs: number; capability: string };
    assert.equal(side.capability, 'video'); assert.ok(side.castRefs > 0);
    const tpl = JSON.parse(fs.readFileSync(path.join(wfDir, 'wan2gp-h3-elenco-voz.json'), 'utf8')) as { model_type: string; needsRefs: boolean; capability: string };
    assert.match(tpl.model_type, /ref2va/); assert.ok(tpl.needsRefs);
    assert.equal(isH3Voice({ type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v-voice.json' } as never), true);
    assert.equal(isH3Voice({ type: 'wan2gp', template: 'wan2gp-h3-elenco-voz.json' } as never), true);
    assert.equal(isH3Voice({ type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v-cast.json' } as never), false);
    assert.equal(h3SpeechScene({}, { narration: 'oi' }, { type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v-voice.json' } as never), true, 'workflow com voz liga a fala no vídeo');
    assert.equal(h3SpeechScene({}, { narration: 'oi' }, { type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v-cast.json' } as never), false);
    assert.equal(h3SpeechScene({ h3Speech: true }, { narration: ' ' }), false);
    const g = JSON.parse(JSON.stringify(wf));
    assert.equal(dropRefAudio(g), true);
    assert.equal(g['60'], undefined); assert.equal(g['36'].inputs['ref_audios.ref_audio_0'], undefined, 'sem voz: o nó de áudio e a ligação saem');
    assert.ok(g['36'].inputs['ref_images.ref_image_0'], 'as imagens continuam');
    const { ROUTES } = require('../main/presets') as typeof import('../main/presets');
    const r = ROUTES.find((x) => x.id === 'dorama-voz-clonada')!;
    const vid = r.steps.find((s) => s.kind === 'video')!;
    assert.deepEqual(vid.bindings.slice(0, 2).map((b) => ((b as { workflow?: string }).workflow ?? (b as { template?: string }).template)), ['minimax-h3-ref2v-voice.json', 'wan2gp-h3-elenco-voz.json']);
  });

  await t('estilo de uma imagem: paleta medida, normalização e blocos do prompt', () => {
    const px = new Uint8Array([...Array(60).fill([250, 20, 20]).flat(), ...Array(30).fill([10, 10, 240]).flat(), ...Array(10).fill([252, 22, 18]).flat()]);
    const pal = paletteFromPixels(px, 3);
    assert.ok(pal[0]!.startsWith('#f'), `vermelho primeiro (${pal.join(',')})`); assert.ok(pal.length >= 2 && pal.length <= 3);
    assert.ok(pal.some((h) => h.startsWith('#0')), 'azul aparece');
    assert.throws(() => normalizeStyleRef({}, []), /não descreveu/);
    const st = normalizeStyleRef({ stylePrompt: 'grainy 35mm film photo, warm', avoid: 'cartoon', tags: ['analógico'], palette: ['#112233', 'bad', '#445566'] }, ['#aaaaaa', '#bbbbbb', '#cccccc'], '/x.png', 'claude');
    assert.deepEqual(st.palette, ['#aaaaaa', '#bbbbbb', '#cccccc'], 'paleta da IA inválida (< 3) → a medida');
    assert.match(styleBlock({ styleRef: st }, 'scene_plan'), /ESTILO VISUAL DO PROJETO[\s\S]*grainy 35mm[\s\S]*evite: cartoon/);
    assert.match(styleBlock({ styleRef: st }, 'code_scene'), /No código/);
    assert.equal(styleBlock({ styleRef: st }, 'narration'), '');
    assert.match(styleVisual({ styleRef: st }), /^Visual style \(follow exactly\): grainy/);
    assert.equal(userStyleRef({ stylePrompt: '  ' }), undefined);
  });

  await t('storyboard: opções só com aprovação; escolha validada e aplicada', () => {
    assert.deepEqual(candidatePlan({ enabled: true, approval: false, sketches: { mode: 'both', count: 2 } }), { sketch: 0, frame: 0 });
    assert.deepEqual(candidatePlan({ enabled: true, approval: true, sketches: { mode: 'frame', count: 9 } }), { sketch: 0, frame: 4 });
    assert.match(sketchIntent({ visualIntent: 'two people', camera: 'close' }), /pencil line art[\s\S]*two people\. Camera: close/);
    const dir = tmp();
    const sc = { id: 's1', candidates: { frame: ['scenes/s1/candidates/frame-1.png', 'scenes/s1/candidates/frame-2.png'], sketch: ['scenes/s1/candidates/sketch-1.png'] } } as unknown as Scene;
    assert.throws(() => writePick(dir, sc, 'frame', 'outro.png'), /inválida/);
    writePick(dir, sc, 'frame', 'scenes/s1/candidates/frame-2.png');
    writePick(dir, sc, 'sketch', 'scenes/s1/candidates/sketch-1.png');
    assert.equal(applyPicks([sc], readPicks(dir)), 2);
    assert.equal(sc.firstFrame, 'scenes/s1/candidates/frame-2.png');
    writePick(dir, sc, 'frame', null);
    applyPicks([sc], readPicks(dir));
    assert.equal(sc.firstFrame, undefined); assert.equal(sc.sketch, 'scenes/s1/candidates/sketch-1.png');
  });

  await t('efeitos por IA: pedido sem música/voz com efeitos do plano e o lugar', () => {
    const p = sfxAiPrompt({ sfx: ['whoosh@1.2', 'porta rangendo'], sfxCues: [], visualIntent: 'corredor escuro de hospital', title: '' });
    assert.match(p, /^Sound effects and ambience only, no music, no speech/);
    assert.match(p, /Whoosh, porta rangendo/); assert.match(p, /corredor escuro de hospital/);
  });

  console.log(`falhas=${fails}`);
  if (fails) process.exit(1);
})();
