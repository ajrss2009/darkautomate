import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  analyzeGaps, cachedCollection, classifyTrend, collectFrontier, durationBand, formatSignature, gapConfidence, gapMemory, gapToProjectInput, hhi,
  listFrontiers, loadGaps, makeFrontier, median, motivationFor, opportunityScore, percentile, saveCachedCollection, saveResearch,
  scarcityScore, suggestionFor, trendVerdict, weeklySeries, type Frontier, type SampleVideo,
} from '../main/research';

/** Pesquisa por lacuna: agrupamento de formato, escassez, confiança, curva, sugestão e persistência (sem rede). */
async function main() {
  /* ── agrupamento: o título revela o formato e a duração separa curto/médio/longo ── */
  assert.deepEqual(formatSignature({ title: 'Linha do tempo da internet em 60 s', durationSec: 60 }), { key: 'linha do tempo|medio', tags: ['linha do tempo'], band: 'medio' });
  assert.equal(durationBand(30), 'curto'); assert.equal(durationBand(60), 'medio'); assert.equal(durationBand(120), 'longo');
  assert.deepEqual(formatSignature({ title: 'Mapa animado do império romano', durationSec: 90 }).tags, ['mapa animado']);
  assert.equal(formatSignature({ title: 'Vídeo qualquer', durationSec: 20 }).key, 'sem-estrutura|curto');
  const suggestShort = suggestionFor(['react'], 'curto', 40);
  assert.equal(suggestShort.skillId, 'shorts-viral');
  assert.equal(suggestShort.routeId, 'shorts-autopilot');
  assert.equal(suggestShort.aspect, '9:16');
  assert.equal(suggestionFor(['mapa animado'], 'medio', 90).skillId, 'explicativo-codigo');
  assert.equal(suggestionFor(['restauro', '3 planos'], 'longo', 120).routeId, 'documentario-3d');

  /* ── números: mediana, percentil, HHI, escassez e oportunidade ── */
  assert.equal(median([1, 3, 5]), 3); assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(percentile([1, 2, 3, 4, 5], 75), 4);
  assert.equal(hhi([1]), 1);
  assert.ok(Math.abs(hhi([1, 1]) - 0.5) < 1e-9);
  assert.ok(hhi([5, 5, 5, 5]) < hhi([1, 1, 1, 9]), 'menos concentrado = HHI menor');
  assert.ok(scarcityScore(4, 0.25) < scarcityScore(80, 0.25), 'mais oferta = mais escassez no índice');
  assert.ok(opportunityScore(0.4, scarcityScore(4, 0.2)) > opportunityScore(0.4, scarcityScore(80, 0.2)));
  const c4 = gapConfidence(4, 400), c60 = gapConfidence(60, 400);
  assert.ok(c4 > 0.9 && c4 <= 0.99, `4 vídeos com amostra grande: ${c4}`);
  assert.ok(c60 < 0.75 && c60 > 0.45, `60 vídeos: ${c60}`);
  assert.ok(gapConfidence(10, 40) < gapConfidence(10, 400), 'amostra maior dá mais confiança');

  /* ── motivo do vazio (oferta) ── */
  assert.equal(motivationFor(4), 'curto'); assert.equal(motivationFor(22), 'medio'); assert.equal(motivationFor(47), '—'); assert.equal(motivationFor(88), 'longo');

  /* ── forma da curva: estável, subindo, serrilhado e caindo ── */
  assert.equal(classifyTrend([0.5, 0.5, 0.5, 0.5]), 'estavel');
  assert.equal(classifyTrend([0.1, 0.25, 0.45, 0.7, 0.9]), 'subindo');
  assert.equal(classifyTrend([0.9, 0.2, 0.85, 0.15, 0.8, 0.2]), 'serrilhado');
  assert.equal(classifyTrend([0.95, 0.7, 0.45, 0.2, 0.05]), 'caindo');
  assert.deepEqual(trendVerdict('caindo'), { label: 'moda morta', action: 'vetar', tone: 'bad' });
  assert.equal(trendVerdict('subindo').action, 'vale');
  assert.equal(weeklySeries([{ views: 100, ageDays: 2 }, { views: 300, ageDays: 60 }], 90).length, 13);

  /* ── amostra de fixture: agrupa, ranqueia e monta a sugestão/memória ── */
  const now = new Date('2026-11-13T12:00:00Z');
  const f: Frontier = makeFrontier({ market: 'pt-BR', category: 'Educação', windowDays: 90, maxSubs: 100_000 }, now);
  assert.equal(f.id, 'educacao-' + f.id.split('-').pop());
  const v = (id: string, title: string, dur: number, views: number, subs: number, channel: string, ageDays = 10): SampleVideo => ({ id, title, channel, views, subs, ageDays, durationSec: dur, language: 'pt' });
  const sample: SampleVideo[] = [
    v('1', 'Linha do tempo da computação em 60 s', 60, 900_000, 40_000, 'Canal A'),
    v('2', 'Linha do tempo da internet explicada', 58, 500_000, 30_000, 'Canal B'),
    v('3', 'Mapa animado do império romano', 95, 400_000, 20_000, 'Canal C'),
    v('4', 'React com corte seco: ciência', 30, 2_000_000, 80_000, 'Canal A'),
    v('5', 'React com corte seco: história', 32, 1_500_000, 70_000, 'Canal A'),
    v('6', 'Restauro de foto antiga em 3 atos', 180, 300_000, 10_000, 'Canal D'),
    v('7', 'Antes e depois: restauro de quadro', 150, 250_000, 15_000, 'Canal D'),
  ];
  const gaps = analyzeGaps(f, sample);
  assert.ok(gaps.length >= 3, `formatos agrupados: ${gaps.length}`);
  const timeline = gaps.find((g) => g.format.includes('linha do tempo'))!;
  assert.equal(timeline.n90, 2);
  assert.equal(timeline.motivation, 'curto');
  assert.ok(timeline.confidence >= 0.75, `confiança da linha do tempo (amostra pequena): ${timeline.confidence}`);
  assert.ok(gapConfidence(timeline.n90, 400) > timeline.confidence, 'amostra maior aumenta a confiança');
  assert.ok(timeline.p75 >= 3, 'p75 como múltiplo do canal');
  assert.equal(timeline.suggestion.skillId, 'explicativo-codigo');
  assert.match(gapMemory(f, timeline), /Lacuna pt-BR · Educação: "linha do tempo[\s\S]*2 vídeo\(s\) em 90 dias/);
  const projectSeed = gapToProjectInput(f, timeline);
  assert.equal(projectSeed.skillId, timeline.suggestion.skillId);
  assert.equal(projectSeed.routeId, timeline.suggestion.routeId);
  assert.equal(projectSeed.targetDurationSec, timeline.suggestion.seconds);
  assert.match(projectSeed.idea, /p75 [\d.]+x, confiança \d+%/);
  assert.deepEqual(projectSeed.memories, [gapMemory(f, timeline)]);
  assert.deepEqual(timeline.suggestion.memories, [gapMemory(f, timeline)]);
  const react = gaps.find((g) => g.format.includes('react'))!;
  assert.equal(react.motivation, 'curto');
  assert.ok(react.hhi > timeline.hhi, 'dois vídeos no mesmo canal concentram mais');
  assert.equal(gaps[0]!.confidence >= gaps[gaps.length - 1]!.confidence, true, 'ordenado pela confiança');
  for (const g of gaps) {
    assert.ok(g.confidence >= 0 && g.confidence <= 1);
    assert.ok(g.series.every((x) => x >= 0 && x <= 1));
    assert.ok(g.p75 >= 0 && g.density >= 0);
  }

  /* ── coleta com busca injetada: sem rede, dedupe e janela ── */
  let calls = 0;
  const collection = await collectFrontier(f, async (q) => {
    calls++;
    assert.ok(q.languages.includes('pt'));
    return { videos: [
      { id: 'x1', title: `Linha do tempo de ${q.query}`, channel: 'C', views: 1000, subs: 5000, durationSec: 60, ageDays: 5 },
      { id: 'x2', title: 'Vídeo fora da janela', channel: 'D', views: 9000, subs: 5000, durationSec: 30, ageDays: 200 },
      { id: 'x1', title: 'Linha do tempo de novo', channel: 'C', views: 1000, subs: 5000, durationSec: 60, ageDays: 5 },
    ], warnings: ['aviso da busca'] };
  }, { maxSeeds: 3, perLanguage: 5 });
  assert.equal(calls, 3, 'uma busca por semente');
  assert.ok(collection.videos.some((x) => x.id === 'x1'));
  assert.ok(!collection.videos.some((x) => x.id === 'x2'), 'fora da janela sai da amostra');
  assert.equal(collection.videos.filter((x) => x.id === 'x1').length, 1, 'sem repetidos');
  assert.ok(collection.warnings.length >= 1);

  /* semente que falha não derruba a coleta */
  const partial = await collectFrontier(f, async (q) => { if (q.query.includes('como')) throw new Error('429'); return { videos: [{ id: 'ok', title: 'Mapa animado', channel: 'E', views: 10, subs: 100, durationSec: 30 }] }; }, { maxSeeds: 2 });
  assert.ok(partial.videos.length >= 1);
  assert.ok(partial.warnings.some((w) => /429/.test(w)));

  /* ── persistência: frontier.json, gaps.json, latest, listagem e cache com TTL ── */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-research-'));
  const dir = saveResearch(ws, f, collection, gaps);
  assert.ok(fs.existsSync(path.join(dir, 'frontier.json')) && fs.existsSync(path.join(dir, 'gaps.json')) && fs.existsSync(path.join(dir, 'sample.json')));
  const loaded = loadGaps(ws, f.id)!;
  assert.equal(loaded.gaps.length, gaps.length);
  assert.deepEqual(listFrontiers(ws).map((x) => x.id), [f.id]);
  assert.equal(cachedCollection(ws, f), undefined, 'sem cache ainda');
  saveCachedCollection(ws, f, collection);
  assert.ok(cachedCollection(ws, f), 'cache dentro do TTL');
  assert.equal(cachedCollection(ws, f, 'padrao', Date.now() + 25 * 3600_000), undefined, 'cache vencido depois de 24 h');
  fs.rmSync(ws, { recursive: true, force: true });

  console.log('research tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
