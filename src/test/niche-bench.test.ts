import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultSettings } from '../main/settings';
import { buildNiche, findNiche, mergeTitles, nicheId, nicheStructure, nicheVsChannel, readNiche } from '../main/niche-bench';
import { titleStructure } from '../main/youtube-rules';

/**
 * BENCHMARK DE NICHO: o corpus cresce por busca em vários ângulos + canais,
 * acumula entre execuções e vira a régua (em vez de 30 títulos de um canal).
 * A rede é injetada: o que se testa é a coleta, a dedupe, o acúmulo e a comparação.
 */
async function main() {
  /* dedupe por título normalizado, guardando as maiores views */
  const merged = mergeTitles(
    [{ title: 'O café que mudou 3 impérios', views: 100 }],
    [{ title: 'o cafe que mudou 3 imperios', views: 500 }, { title: 'Outro título', views: 20 }],
  );
  assert.equal(merged.length, 2, 'o mesmo título (com acento/caixa diferente) não entra duas vezes');
  assert.equal(merged[0]!.views, 500, 'fica a maior contagem de views');

  assert.equal(nicheId({ query: 'Café Especial' }), 'cafe-especial');

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-niche-'));
  const s = defaultSettings(ws);
  const log: string[] = [];
  const deps = {
    search: async (q: string, n: number) => Array.from({ length: n }, (_, i) => ({
      title: `${q} — assunto ${i}`, channelUrl: `https://youtube.com/@canal${i % 20}`, views: 100 + i,
    })),
    channel: async (url: string) => ({
      name: url.split('@')[1] ?? 'canal',
      titles: Array.from({ length: 30 }, (_, i) => ({ title: `${url} vídeo ${i}`, views: 1000 + i })),
    }),
  };

  const corpus = await buildNiche(s, { query: 'cafe especial', channelUrl: 'https://youtube.com/@ref', target: 1000, maxChannels: 6 }, (l) => log.push(l), undefined, deps);
  assert.ok(corpus.titles.length >= 1000, `o corpus chega à meta (${corpus.titles.length})`);
  assert.ok(corpus.channels.length > 5, `o nicho vem de vários canais (${corpus.channels.length})`);
  assert.equal(corpus.seedTitles?.length, 30, 'guarda os títulos do canal para a comparação');
  assert.ok(readNiche(s, corpus.id), 'o corpus fica salvo em workspace/craft/niche');
  assert.ok(log.some((l) => /nicho: 1\d{3} títulos/.test(l)), 'o log mostra a coleta');

  /* a segunda execução acumula sem duplicar */
  const again = await buildNiche(s, { query: 'cafe especial', channelUrl: 'https://youtube.com/@ref', target: 1000, maxChannels: 6 }, () => {}, undefined, deps);
  assert.equal(again.titles.length, corpus.titles.length, 'rodar de novo não inventa títulos repetidos');

  /* o corpus é encontrado pela referência (canal) e a estrutura é a do nicho */
  assert.equal(findNiche(s, { kind: 'channel', url: 'https://youtube.com/@ref' })?.id, corpus.id);
  const niche = nicheStructure(corpus);
  assert.equal(niche.count, corpus.titles.length);

  /* comparação canal × nicho, em pontos percentuais */
  const channel = titleStructure(corpus.seedTitles ?? []);
  const cmp = nicheVsChannel(channel, niche);
  assert.equal(cmp.length, 7);
  assert.ok(cmp.every((l) => /canal .* nicho/.test(l)), cmp.join('\n'));
  assert.ok(cmp.some((l) => /p\.p\./.test(l)));

  /* amostra pequena avisa (60 títulos não são mercado) */
  const smallLog: string[] = [];
  const small = await buildNiche(s, { query: 'nicho pequeno', target: 60, maxChannels: 0 }, (l) => smallLog.push(l), undefined, {
    search: async (q, n) => Array.from({ length: 60 }, (_, i) => ({ title: `${q} ${i}`, views: 10 })),
  });
  assert.ok(small.titles.length <= 120, `amostra pequena não infla (${small.titles.length})`);
  assert.ok(smallLog.some((l) => /amostra pequena/.test(l)), 'o log avisa que a amostra é pequena');

  console.log(`nicho: ${corpus.titles.length} títulos de ${corpus.channels.length} canais · ${cmp[2]}`);
  console.log('niche-bench tests: OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
