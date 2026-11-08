import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bigPreview, clampEdLayout } from '../shared/ed-layout';
import { OUTLIER_MAX_SUBS, outlierFilter, outlierSeeds, rankVideos, type FinderVideo } from '../main/finder';
import { findSocial } from '../main/social-search';

async function main() {
  /* ───────── painéis ajustáveis do editor ───────── */
  const box = { width: 1400, height: 800 };
  assert.deepEqual(clampEdLayout(900, 500, box), { left: 900, top: 500 });
  assert.deepEqual(clampEdLayout(100, 50, box), { left: 260, top: 200 }, 'mínimos: prévia 260 px, área de cima 200 px');
  assert.deepEqual(clampEdLayout(1390, 790, box), { left: 1100, top: 660 }, 'máximos: o painel lateral (300 px) e a timeline (140 px) não somem');
  assert.deepEqual(clampEdLayout(0, 0, box), { left: undefined, top: undefined }, 'sem medida = padrão do CSS');
  assert.deepEqual(clampEdLayout(900, 500, { width: 500, height: 300 }), { left: undefined, top: undefined }, 'janela pequena demais: padrão');
  assert.deepEqual(bigPreview(box), { left: 980, top: 570 }, 'prévia grande ≈ 70% e timeline enxuta');

  /* ───────── Outliers: canais pequenos com views muito acima do tamanho ───────── */
  const v = (id: string, views: number, subs?: number, extra: Partial<FinderVideo> = {}) => ({ id, title: id, url: '', thumb: '', channel: `c-${id}`, views, subs, searchLang: 'pt', ...extra });
  const pool = [v('pequeno-explodiu', 900_000, 20_000), v('pequeno-normal', 30_000, 20_000), v('grande', 5_000_000, 3_000_000), v('sem-dado', 1_000_000), v('mini', 50_000, 50)];
  assert.deepEqual(outlierFilter(pool).kept.map((x) => x.id), ['pequeno-explodiu', 'mini'], '≤ 100 mil e views ≥ 3× (canal minúsculo conta como 100)');
  assert.equal(outlierFilter(pool, 10_000).kept.length, 1, 'o campo "Máx." vale como teto');
  const unknown = outlierFilter([v('a', 10), v('b', 20)]);
  assert.equal(unknown.unknownSubs, true); assert.equal(unknown.kept.length, 2, 'rede sem seguidores: mantém e avisa');
  const ranked = rankVideos(pool, { query: '', languages: ['pt'], period: 'any', outliers: true });
  assert.deepEqual(ranked.videos.map((x) => x.id).sort(), ['mini', 'pequeno-explodiu']);
  assert.ok(ranked.videos.every((x) => x.reasons.some((r) => /Explodiu|Furou a bolha/.test(r))), 'motivo: views ÷ tamanho do canal');
  assert.equal(rankVideos(pool, { query: 'x', languages: ['pt'], period: 'any' }).videos.length, 5, 'sem o modo Outliers nada muda');
  assert.equal(OUTLIER_MAX_SUBS, 100_000);
  assert.equal(outlierSeeds('pt-BR').length, 3); assert.deepEqual(outlierSeeds('zz'), outlierSeeds('en'), 'idioma sem lista: inglês');
  assert.ok(outlierSeeds('pt', 'tiktok').includes('viral'), 'redes curtas: hashtags genéricas');
  /* nas redes: buscas amplas por idioma, ignorando o termo */
  const urls: string[] = [];
  const r = await findSocial('tiktok', { query: 'ignorado', languages: ['pt'], period: 'any', outliers: true, perLanguage: 20 }, {
    browse: async (_p, url) => { urls.push(url); return { url, text: '', cards: [{ href: `https://www.tiktok.com/@p${urls.length}/video/${urls.length}1`, text: 'x' }] }; },
    ytdlp: async (list) => list.map((u) => ({ id: /video\/(\d+)/.exec(u)![1], view_count: 400_000, channel_follower_count: 5_000 })),
  });
  assert.equal(urls.length, 2, '2 buscas amplas por idioma'); assert.ok(urls.every((u) => !u.includes('ignorado')), 'o termo não entra');
  assert.equal(r.videos.length, 2); assert.ok(r.warnings.some((w) => /Outliers/.test(w)));

  /* ───────── render: vídeo navegável (Range) e proteções contra save() sem restore() ───────── */
  const { parseRange } = await import('../main/render-range');
  assert.deepEqual(parseRange('bytes=0-', 1000), [0, 999]);
  assert.deepEqual(parseRange('bytes=100-199', 1000), [100, 199]);
  assert.deepEqual(parseRange('bytes=-200', 1000), [800, 999]);
  assert.deepEqual(parseRange('bytes=900-5000', 1000), [900, 999]);
  assert.equal(parseRange('bytes=1200-', 1000), undefined); assert.equal(parseRange(null, 1000), undefined); assert.equal(parseRange('itens=0-1', 1000), undefined);
  const render = fs.readFileSync(path.resolve('src/main/render.ts'), 'utf8');
  assert.match(render, /status: 206/, 'protocolo responde pedido parcial');
  assert.match(render, /'Accept-Ranges': 'bytes'/);
  assert.match(render, /for \(let i = 0; i < 32; i\+\+\) c\.restore\(\)/, 'desfaz save() sem restore() antes de cada quadro');
  assert.match(render, /v\.seeking/, 'espera o vídeo terminar de pular antes de capturar');
  const prompts = fs.readFileSync(path.resolve('src/main/prompts.ts'), 'utf8');
  assert.match(prompts, /todo ctx\.save\(\) tem o seu ctx\.restore\(\)/); assert.match(prompts, /evento "seeked"/);
  /* Kwai fora da Pesquisar */
  const page = fs.readFileSync(path.resolve('src/renderer/videos-page.ts'), 'utf8');
  assert.match(page, /const SEARCHABLE: Platform\[\] = \['youtube', 'tiktok', 'instagram', 'facebook'\]/);

  console.log('editor-outliers: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
