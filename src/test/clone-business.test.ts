import * as assert from 'node:assert/strict';
import { DEFAULT_RATES, enginesFromRoute, estimateCost, normalizeProducts, productLinks, productsPrompt } from '../main/clone-business';
import type { Route } from '../shared/types';

async function main() {
  /* ───────── produtos: listas separadas, nota, sem repetidos, links de BUSCA do app ───────── */
  const raw = {
    info: [
      { name: 'Curso de edição para iniciantes', platform: 'Hotmart', priceRange: 'R$ 97–297', commission: '40–60%', fit: 9, search: 'curso edição de vídeo', why: 'público quer aprender' },
      { name: 'curso de edição para iniciantes', fit: 3 },
      { name: 'E-book de roteiro', fit: 12, platform: 'Kiwify' },
      { name: '', fit: 10 },
    ],
    physical: [{ name: 'Microfone de lapela', platform: 'Amazon', fit: 7, url: 'https://golpe.example/compre' }, { name: 'Ring light', score: 6 }],
    notes: 'comece pelos afiliados',
  };
  const p = normalizeProducts(raw, 'claude');
  assert.equal(p.info.length, 2, 'sem nome some; nome repetido some');
  assert.equal(p.info[0]!.name, 'E-book de roteiro', 'ordenado pela nota'); assert.equal(p.info[0]!.fit, 10, 'nota limitada a 10');
  assert.equal(p.physical[1]!.fit, 6, 'aceita "score"');
  assert.equal(p.notes, 'comece pelos afiliados'); assert.equal(p.by, 'claude');
  const curso = p.info.find((x) => /Curso/.test(x.name))!;
  assert.match(curso.links![0]!.url, /^https:\/\/hotmart\.com\/.*q=curso%20edi/, 'plataforma sugerida primeiro, com os termos de busca');
  assert.ok(p.physical.every((x) => x.links!.every((l) => !l.url.includes('golpe.example'))), 'URL vinda da IA nunca é usada');
  assert.match(p.physical[0]!.links![0]!.url, /amazon\.com\.br\/s\?k=/);
  assert.equal(productLinks({ kind: 'physical', name: 'Tripé', platform: 'Mercado Livre' })[0]!.url, 'https://lista.mercadolivre.com.br/Trip%C3%A9');
  assert.deepEqual(normalizeProducts(null).info, []);
  const pr = productsPrompt({ niche: 'finanças', audience: 'jovens', titles: ['A', 'B'], linkedPlatform: 'TikTok' });
  assert.match(pr, /"info"/); assert.match(pr, /"physical"/); assert.match(pr, /TikTok/); assert.match(pr, /Não invente URLs/);

  /* ───────── custo por vídeo e total ───────── */
  const free = estimateCost({ durationSec: 600, videosPerMonth: 10, months: 3, engines: { text: 'free', voice: 'local', image: 'local', video: 'local', music: 'code' }, mix: { image: 1 } });
  assert.ok(free.perVideo > 0 && free.perVideo < 0.5, `local quase grátis (${free.perVideo})`);
  assert.ok(free.lines.some((l) => /GPU/.test(l.item)), 'GPU local entra como energia');
  const paid = estimateCost({ durationSec: 600, wpm: 150, sceneSec: 10, videosPerMonth: 10, months: 3, engines: { text: 'api', voice: 'api', image: 'api', video: 'api', music: 'api' }, mix: { image: 0.5, video: 0.5 },
    rates: { musicPerTrack: 1, fixedPerMonth: 20, currency: 'BRL' } });
  const words = 150 * 10, chars = words * 6;
  const tts = paid.lines.find((l) => /Narração/.test(l.item))!;
  assert.equal(tts.cost, Math.round((chars / 1000) * DEFAULT_RATES.ttsPer1kChars * 100) / 100, 'voz = caracteres × preço');
  const vid = paid.lines.find((l) => /Vídeo por IA/.test(l.item))!;
  assert.equal(vid.qty, '300 s'); assert.equal(vid.cost, 15, '300 s × 0,05');
  assert.equal(paid.lines.find((l) => /Imagens/.test(l.item))!.qty, '60 imagens', '60 cenas × 50% × 2');
  assert.equal(paid.currency, 'BRL');
  assert.equal(paid.perMonth, Math.round((paid.perVideo * 10 + 20) * 100) / 100, 'mês = 10 vídeos + fixo');
  assert.equal(paid.total, Math.round(paid.perMonth * 3 * 100) / 100); assert.equal(paid.videos, 30);
  assert.ok(paid.perVideo > free.perVideo * 10);
  assert.ok(paid.assumptions[0]!.includes('150 palavras/min'));
  const labor = estimateCost({ durationSec: 60, videosPerMonth: 1, months: 1, laborMinPerVideo: 30, rates: { laborPerHour: 40 } });
  assert.equal(labor.lines.find((l) => /Mão de obra/.test(l.item))!.cost, 20);
  assert.equal(estimateCost({ durationSec: 60, wpm: 9999, videosPerMonth: 1, months: 1 }).assumptions[0]!.includes('260 palavras/min'), true, 'WPM limitado');

  /* ───────── a rota diz quem gera o quê ───────── */
  const st = (id: string, kind: string, b: object) => ({ id, kind, label: id, scope: 'project', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 1, bindings: [b] });
  const route = { steps: [st('script', 'script', { type: 'harness', harness: 'antigravity' }), st('narration', 'narration', { type: 'api', provider: 'fish' }),
    st('image', 'image', { type: 'comfyui', server: 'local', workflow: 'x' }), st('stock', 'stock_media', { type: 'stock', source: 'pexels' }), st('music', 'music', { type: 'builtin', tool: 'code-music' })] } as unknown as Route;
  const e = enginesFromRoute(route);
  assert.deepEqual(e.engines, { text: 'free', voice: 'api', image: 'local', video: 'local', music: 'code' });
  assert.equal(e.mix.image, 0.5); assert.equal(e.mix.stock, 0.5); assert.equal(e.mix.video, 0);

  console.log('clone-business: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
