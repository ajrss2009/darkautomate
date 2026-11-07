import * as assert from 'node:assert/strict';
import { backdropRef, fallbackPlan, mergeShotSfx, parsePlan, planPrompt, planSchema, shotDurations, shotIdea, shotsWanted } from '../main/free-shots';

/** Vídeo livre em planos de 3–4 s para modelos locais. */
function main() {
  /* quando dividir: só modelo local e mais de 4,5 s */
  assert.ok(shotsWanted('llamacpp', 32) && shotsWanted('ollama', 6) && shotsWanted('lmstudio', 8));
  assert.ok(!shotsWanted('llamacpp', 4) && !shotsWanted('antigravity', 32) && !shotsWanted('claude', 60));
  /* durações: 3–4 s, somando exatamente */
  for (const t of [6, 7, 8, 10, 15, 32, 60, 180]) {
    const d = shotDurations(t);
    assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - t) < 0.011, `soma ${t}`);
    assert.ok(d.every((x) => x >= 2.9 && x <= 4.6), `${t}: ${d.join(',')}`);
  }
  assert.deepEqual(shotDurations(4), [4]);
  assert.equal(shotDurations(32).length, 9);
  /* plano guiado: esquema com N planos; resposta lida; incompleta → inválida */
  const durs = shotDurations(8);
  assert.equal((planSchema(durs.length) as { properties: { shots: { minItems: number } } }).properties.shots.minItems, durs.length);
  assert.match(planPrompt('formigas', durs, '16:9'), /EXATAMENTE 2 planos[\s\S]*UMA ação simples[\s\S]*"look"/);
  const p = parsePlan('{"look":"formiga marrom, céu claro","shots":[{"action":"entra pela esquerda"},{"action":"corta a folha"}]}', durs)!;
  assert.equal(p.shots.length, 2); assert.equal(p.shots[1]!.action, 'corta a folha'); assert.equal(p.shots[0]!.seconds, durs[0]);
  assert.equal(parsePlan('{"look":"x","shots":[{"action":"só um"}]}', durs), undefined);
  assert.equal(parsePlan('não é json', durs), undefined);
  /* sem IA: divide pelas setas da ideia */
  const idea = '"This is code." → the ant built from sketch to polish → a leafcutter cuts a leaf → a dive into the mound → the nest in cross-section';
  const f = fallbackPlan(idea, shotDurations(32));
  assert.equal(f.shots.length, 9);
  assert.match(f.shots[0]!.action, /This is code/); assert.match(f.shots[8]!.action, /cross-section/);
  assert.equal(fallbackPlan('Uma frase só', [3, 3]).shots.length, 2);
  /* ideia do plano: só a ação dele + visual fixo + continuidade */
  const si = shotIdea(idea, { look: 'formiga marrom', shots: [{ action: 'A', seconds: 3.5 }, { action: 'B', seconds: 3.5 }, { action: 'C', seconds: 3.5 }] }, 1, '16:9');
  assert.match(si, /3\.5 segundos — PLANO 2 de 3[\s\S]*Anime SÓ esta ação[\s\S]*\nB\n[\s\S]*VISUAL FIXO[\s\S]*formiga marrom[\s\S]*anterior terminou assim: A[\s\S]*próximo plano começa com: C/);
  /* continuidade: fundo do plano 1 vira referência dos outros */
  const pg = 'function render(t){\n  L.skyGradient(ctx, W, H, "#bde", "#eef");\n  L.sun(ctx, 800, 80, 40);\n  L.grass(ctx, 0, 400, W);\n  L.ant(ctx, 100 + t * 50, 380, 1);\n  L.skyGradient(ctx, W, H, "#bde", "#eef");\n}';
  const br = backdropRef(pg)!;
  assert.match(br, /skyGradient[\s\S]*sun[\s\S]*grass/); assert.doesNotMatch(br, /L\.ant/); assert.equal(br.split('\n').length, 3);
  assert.equal(backdropRef('L.ant(ctx,1,2)'), undefined);
  assert.match(shotIdea(idea, { look: '', shots: [{ action: 'A', seconds: 3 }, { action: 'B', seconds: 3 }] }, 1, '16:9', br), /CENÁRIO DO PLANO 1[\s\S]*L\.sun/);
  assert.doesNotMatch(si, /CENÁRIO DO PLANO 1/);
  /* sons: deslocados para o tempo de cada plano; som fora do plano é descartado */
  const m = mergeShotSfx([[{ t: 0.5, name: 'pop' }, { t: 18, name: 'boom' }], [{ t: 1, name: 'whoosh' }], [{ at: 2.9, name: 'thud', gain: 0.5 }]], [3.5, 3.5, 3]);
  assert.deepEqual(m, [{ name: 'pop', at: 0.5 }, { name: 'whoosh', at: 4.5 }, { name: 'thud', at: 9.9, gain: 0.5 }]);
  console.log('shots tests: OK');
}
main();
