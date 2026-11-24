import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Settings } from '../shared/types';
import { allErrors, buildSkill, emptyWizard, estimateCost, neededKinds, skillMarkdown, stepErrors, suggestRoute, textProfile, titleSpec } from '../shared/skill-wizard';
import { ROUTES } from '../main/presets';
import { wizardSave } from '../main/skill-wizard-main';
import * as lib from '../main/library';

/** Assistente de skill (13 telas): travas, rota sugerida, custo, SKILL.md, gravação com referências por hash e banco. */
function main() {
  const st = emptyWizard();
  assert.ok(stepErrors(st, 1).some((e) => /80 caracteres/.test(e)), 'descrição obrigatória');
  st.name = 'Curiosidades de história';
  st.description = 'Vídeos curtos de curiosidades históricas para jovens de 16 a 30 anos, tom de conversa com humor leve, narrador em 1ª pessoa, sem violência gráfica.';
  assert.deepEqual(stepErrors(st, 1), []);
  st.gen = { image: 60, code: 30 };
  assert.ok(stepErrors(st, 2).some((e) => /somar 100%/.test(e)));
  st.gen = { image: 70, code: 30 };
  assert.deepEqual(stepErrors(st, 2), []);
  st.lipsync.on = true;
  assert.ok(stepErrors(st, 5).some((e) => /rosto/.test(e)));
  st.lipsync.on = false;
  assert.deepEqual(allErrors(st), []);
  assert.ok(neededKinds(st).includes('code_scene') && neededKinds(st).includes('image') && neededKinds(st).includes('narration'));

  const sug = suggestRoute(st, ROUTES);
  assert.ok(sug.route, 'sugere uma rota');
  st.music.mode = 'lyric';
  assert.ok(suggestRoute(st, ROUTES).route!.steps.some((s) => s.bindings.some((b) => (b as { tool?: string }).tool === 'lyric-song')), 'canção com letra → rota com lyric-song');
  st.music.mode = 'generate';
  const cost = estimateCost(st, sug.route);
  assert.ok(cost.scenes >= 10 && cost.calls > cost.scenes, JSON.stringify(cost));

  st.title.spec = titleSpec('7 Erros Que Destruíram o Império Romano');
  assert.equal(st.title.spec.caps, 'title'); assert.ok(st.title.spec.number); assert.equal(st.title.spec.variants?.length, 3);
  assert.equal(titleSpec('VOCÊ NÃO VAI ACREDITAR?').caps, 'upper');
  st.textStyle.profile = textProfile('Eu nunca entendi isso. Mas eu fui atrás! E você, sabia? Eu descobri tudo.');
  assert.equal(st.textStyle.profile.person, '1ª pessoa');
  st.promptPrefix = 'Vintage engraving style.';
  const k = buildSkill(st, sug.route!.id);
  assert.match(k.global, /DIRETRIZES BÁSICAS[\s\S]*Cena por código 30% · Imagens IA 70%/);
  assert.equal(k.presentation, 'mixed');
  assert.equal(k.promptPrefix, 'Vintage engraving style.');
  assert.match(k.steps['metadata']!, /com número/);
  assert.ok(k.reviewCriteria && k.outputStyle);
  assert.match(skillMarkdown(k), /^---\nname: Curiosidades de história[\s\S]*## Global[\s\S]*## Etapa: script/);

  /* gravação real numa área temporária */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-wiz-'));
  const s = { workspace: ws, mediaBanks: [] } as unknown as Settings;
  const ref = path.join(ws, 'ref.png'); fs.writeFileSync(ref, 'imagem');
  const media = path.join(ws, 'midia'); fs.mkdirSync(media);
  st.refs = [{ file: ref, kind: 'image' }];
  st.media.dir = media;
  st.routeId = sug.route!.id;
  let saved = 0;
  const r1 = wizardSave(s, st, () => { saved++; });
  assert.ok(r1.skill.id && r1.route && r1.bank, 'skill + rota própria + banco');
  assert.equal(saved, 1);
  assert.ok(r1.route!.steps.filter((x) => x.kind === 'image').every((x) => (x.bindings[0] as { tool?: string }).tool === 'media-folder'), 'pasta na frente da imagem');
  assert.match(r1.skill.steps['image']!, /skill-refs[\\/][0-9a-f]{16}\.png/, 'referência copiada por hash');
  assert.equal(r1.skill.routeId, r1.route!.id);
  const r2 = wizardSave(s, st, () => { saved++; });
  assert.notEqual(r2.skill.id, r1.skill.id, 'nunca sobrescreve: id novo');
  assert.equal(saved, 1, 'mesma pasta = mesmo banco');
  assert.ok(lib.listSkills(s).some((x) => x.id === r1.skill.id));
  const bad = { ...st, description: 'curta' };
  assert.throws(() => wizardSave(s, bad, () => {}), /80 caracteres/);
  fs.rmSync(ws, { recursive: true, force: true });
}

main();
console.log('skill-wizard tests: OK');
