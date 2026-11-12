import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultSettings } from '../main/settings';
import { abLine, champions, createAb, listAb, measureAb, medianViews, patchAb } from '../main/title-ab';

/**
 * O LOOP DE CTR: views ÷ mediana do canal decide o vencedor e o título volta ao banco.
 * Aqui as views entram explícitas (sem rede): o que se testa é a régua, o empate e a volta.
 */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-ab-'));
  const s = defaultSettings(ws);
  const log: string[] = [];
  const logf = (l: string) => { log.push(l); };

  /* mediana: ímpar pega o meio, par tira a média, vazio é 0 */
  assert.equal(medianViews([300, 100, 200]), 200);
  assert.equal(medianViews([100, 200]), 150);
  assert.equal(medianViews([]), 0);
  assert.equal(medianViews([0, 0]), 0);

  /* um teste muda UMA variável; iguais não ensinam nada */
  assert.throws(() => createAb(s, { a: { title: 'O café que mudou 3 impérios' }, b: { title: 'o café que mudou 3 impérios' } }), /iguais/);
  const t = createAb(s, {
    a: { title: 'O café que mudou 3 impérios — e ninguém sabe', thumbText: 'xícara' },
    b: { title: 'O café que mudou 4 impérios — e ninguém sabe', thumbText: 'xícara' },
    channelId: 'g1', baseline: 1000,
  });
  assert.deepEqual(t.changes, ['título'], 'só o título mudou');
  assert.equal(listAb(s).length, 1, 'o teste ficou salvo');
  assert.ok(fs.existsSync(path.join(ws, 'craft', 'ab.json')), 'o banco do A/B é um arquivo no workspace');

  /* trocar duas coisas é permitido, mas o teste avisa que não isola a variável */
  const two = createAb(s, { a: { title: 'Um', thumbText: 'x' }, b: { title: 'Dois', thumbText: 'y' }, baseline: 1000 });
  assert.deepEqual(two.changes, ['título', 'thumbnail']);
  assert.match(abLine(two), /2 variáveis/);

  /* mede: 1500 × 1000 sobre mediana 1000 = 150% × 100% → vence A */
  patchAb(s, t.id, { variants: [{ views: 1500 }, { views: 1000 }] });
  const m = await measureAb(s, t.id, logf);
  assert.equal(m.winner, 'A', `venceu quem passou de 10%: ${abLine(m)}`);
  assert.equal(m.variants[0]!.ratio, 1.5);
  assert.equal(m.variants[1]!.ratio, 1);
  assert.equal(m.baseline, 1000);
  assert.ok(m.measuredAt, 'a medição ficou datada');
  assert.match(log.join('\n'), /venceu A/);

  /* o vencedor volta ao banco (é o que alimenta o prompt das próximas gerações) */
  const ch = champions(s);
  assert.equal(ch[0]!.title, t.variants[0]!.title);
  assert.equal(ch[0]!.ratio, 1.5);

  /* diferença pequena é empate: o ruído do YouTube explica */
  const near = createAb(s, { a: { title: 'A', views: 1050 }, b: { title: 'B', views: 1000 }, baseline: 1000 });
  assert.equal((await measureAb(s, near.id, logf)).winner, 'empate');

  /* sem link nem views não há o que medir */
  const empty = createAb(s, { a: { title: 'A' }, b: { title: 'B' }, baseline: 1000 });
  await assert.rejects(() => measureAb(s, empty.id, logf), /informe o link/);

  /* sem mediana do canal, a régua cai para a mediana do próprio teste (e o log avisa) */
  const noBase = createAb(s, { a: { title: 'A', views: 300 }, b: { title: 'B', views: 100 } });
  const nb = await measureAb(s, noBase.id, logf);
  assert.equal(nb.winner, 'A');
  assert.match(log.join('\n'), /mediana do teste/);

  console.log(`A/B: ${m.variants[0]!.ratio * 100}% × ${m.variants[1]!.ratio * 100}% · campeão "${ch[0]!.title}"`);
  console.log('title-ab tests: OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
