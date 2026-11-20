import * as assert from 'node:assert/strict';
import { validateGeneratorProfile, compileGeneratorPrompt, familyGuideText } from '../main/generator-profile';
import { validateDisclosure, disclosureFields, disclosureGate, DEFAULT_DISCLOSURE } from '../main/disclosure';
import { PROMPT_CONTRACTS, validatePromptContract, cleanNegatives, toFrames, fromFrames, CLEAN_NEGATIVES } from '../main/prompt-contract';
import { BUILTIN_SKILLS } from '../main/skills-builtin';
import { ROUTES } from '../main/presets';
import { shoppingText } from '../main/publish-kit';
import type { GeneratorProfile } from '../shared/types';

const profile: GeneratorProfile = {
  provider: 'minimax', model_id: 'minimax-h3-2026-09-12', family_guide: '02', task_mode: 'i2v',
  duration_sec: 10, resolution: '1080p', aspect: '16:9',
  refs: [{ type: 'image', role: 'identity', slot: 1 }, { type: 'audio', role: 'rhythm', slot: 2 }],
  audio: 'native', negative_field: false, prompt_rewrite: true, evidence: 'host',
};

async function main() {
  /* filtro por gerador: perfil válido, ID exato, um guia só */
  const v = validateGeneratorProfile(profile);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.ok(v.warnings.some((x) => /projeto: mantenha a faixa master/.test(x)));
  assert.ok(v.warnings.some((x) => /frases curtas/.test(x)));
  assert.match(compileGeneratorPrompt(profile), /GUIA DA FAMILIA 02|GUIA DA FAMÍLIA 02/);
  assert.ok(!/GUIA DA FAMÍLIA 01/.test(compileGeneratorPrompt(profile)), 'os outros guias NAO entram');
  assert.match(familyGuideText('04'), /O3 4K e linha separada|O3 4K é linha separada/);

  const bad = validateGeneratorProfile({ ...profile, model_id: 'H3 Fast', family_guide: '03', duration_sec: 30, refs: [{ type: 'image', role: '', slot: 1 }] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((x) => /rotulo de tier|rótulo de tier/.test(x)));
  assert.ok(bad.errors.some((x) => /fora do envelope/.test(x)));
  assert.ok(bad.errors.some((x) => /papel declarado/.test(x)));

  /* frames, nao segundos */
  assert.equal(toFrames(12, 24), 288);
  assert.equal(fromFrames(288, 24), 12);
  assert.ok(CLEAN_NEGATIVES.includes('no warped hands'));
  assert.match(cleanNegatives(['EXTRA FINGERS']), /extra fingers/);

  /* disclosure continuo: job com publicacao nao agenda */
  assert.equal(validateDisclosure(DEFAULT_DISCLOSURE).ok, true);
  assert.equal(disclosureGate({ disclosure: undefined, publishes: true }).ok, false);
  assert.match(disclosureGate({ disclosure: undefined, publishes: true }).errors[0]!, /nao agendado|não agendado/);
  assert.equal(disclosureGate({ disclosure: undefined, publishes: false }).ok, true);
  const noWhole = validateDisclosure({ ...DEFAULT_DISCLOSURE, visible_whole: false });
  assert.ok(noWhole.errors.some((x) => /portaria/.test(x)));
  assert.equal(disclosureFields(DEFAULT_DISCLOSURE, 'tiktok_content').is_aigc, true);
  assert.equal(disclosureFields(DEFAULT_DISCLOSURE, 'tiktok_business').is_ai_generated, true);
  assert.equal(disclosureFields(DEFAULT_DISCLOSURE, 'meta').is_ai_generated, true);
  assert.equal(disclosureFields(DEFAULT_DISCLOSURE, 'youtube_music').genai_disclosure, true);

  /* contratos: sete formatos, campos obrigatorios antes de gastar credito */
  assert.equal(Object.keys(PROMPT_CONTRACTS).length, 7);
  const check = validatePromptContract('microdrama', { hook: 'x', narrator: 'y' });
  assert.equal(check.ok, false);
  assert.ok(check.missing.includes('cliffhanger'));
  assert.equal(validatePromptContract('microdrama', { hook: 'x', cliffhanger: 'y', dialogue: ['a'], narrator: 'y', character_id: 'c', continuity: 'ok', durationSec: 12 }).ok, true);
  assert.equal(validatePromptContract('microdrama', { hook: 'x', cliffhanger: 'y', dialogue: ['a'], narrator: 'y', character_id: 'c', continuity: 'ok', durationSec: 12 }).frames.durationSec, 360);

  /* as skills registradas do catalogo sao PADRAO do app (embutidas) e a rota free existe antes delas */
  for (const id of ['podcast-pip-slideshow', 'lista-jogos-afiliado', 'feed-noticias-midia-mista', 'cortes-virais-lives', 'avatar-reativo-video', 'cartoon-short-studio', 'cartoon-to-real-crossover']) {
    assert.ok(BUILTIN_SKILLS.some((s) => s.id === id), `skill padrao ausente: ${id}`);
  }
  const podcast = BUILTIN_SKILLS.find((s) => s.id === 'podcast-pip-slideshow')!;
  assert.equal(podcast.freeform, true, 'skill orfa precisa de freeform para segurar a rota free');
  const podRoute = ROUTES.find((r) => r.id === podcast.routeId)!;
  assert.ok(ROUTES.some((r) => r.id === podcast.routeId), 'a rota free do podcast precisa existir no app');
  assert.ok(podRoute.steps.some((s) => s.kind === 'image' && s.scope === 'project'), 'a rota do podcast precisa de etapa de IMAGEM para escolher o modelo');
  const imageStep = podRoute.steps.find((s) => s.kind === 'image')!;
  assert.ok(imageStep.bindings.some((b: any) => b.provider === 'snapgen' || b.type === 'wan2gp' || b.type === 'comfyui' || b.type === 'flow'), 'modelo de imagem configurável');
  assert.ok(imageStep.bindings.some((b: any) => b.type === 'flow'), 'Google Flow disponível para gerar a imagem do podcast');
  assert.ok(podRoute.steps.find((s) => s.kind === 'free')!.dependsOn.includes(imageStep.id), 'o ramo free usa a imagem gerada');

  /* shopping nativo: produtos viram metadata.shopping + produtos.txt no kit de publicação */
  const prod = shoppingText([{ name: 'PS5 Slim', platform: 'Amazon BR', url: 'https://amazon/br/x', chapter: 'Jogo 1' }]).join('\n');
  assert.match(prod, /PS5 Slim/);
  assert.match(prod, /link de afiliado/);
  assert.match(prod, /Jogo 1/);

  console.log('catalogo 2026 tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
