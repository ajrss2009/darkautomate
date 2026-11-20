import * as assert from 'node:assert/strict';
import { validateGeneratorProfile, compileGeneratorPrompt, familyGuideText } from '../main/generator-profile';
import { validateDisclosure, disclosureFields, disclosureGate, DEFAULT_DISCLOSURE } from '../main/disclosure';
import { PROMPT_CONTRACTS, validatePromptContract, cleanNegatives, toFrames, fromFrames, CLEAN_NEGATIVES } from '../main/prompt-contract';
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

  console.log('catalogo 2026 tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
