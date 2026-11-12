import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultSettings } from '../main/settings';
import * as ff from '../main/ffmpeg';
import { contentWords, scoreTitle, sharedWords, titleVerdict } from '../main/title-score';
import { checkThumb, contrastRatio, overlayWordCount, scoreThumbBrief } from '../main/thumb-qa';

/**
 * O scorer de títulos (seis checagens, 100 pontos) e o teste da thumbnail (168×94 + brief).
 * Tudo determinístico: as mesmas entradas dão sempre a mesma nota — é isso que permite reprovar
 * antes de o usuário olhar, em vez de "gerar dez e escolher no gosto".
 */
async function main() {
  /* ── o exemplo REPROVADO do catálogo: descritivo, sem gancho, promessa vaga ── */
  const vague = scoreTitle({ title: 'Um vídeo sobre a história do café', promise: 'a história do café e das plantações' });
  assert.ok(vague.total < 50, `título vago reprova (${vague.total})`);
  assert.equal(vague.verdict, 'reprovado');
  const vagueFails = vague.checks.filter((c) => !c.ok).map((c) => c.id);
  assert.ok(vagueFails.includes('hook') && vagueFails.includes('promise'), `reprova por gancho e promessa: ${vagueFails.join(', ')}`);

  /* ── o exemplo APROVADO: número + contradição + curiosidade não resolvida ── */
  const good = scoreTitle({
    title: 'O café que mudou 3 impérios — e ninguém sabe',
    promise: 'como o café mudou impérios e por que quase ninguém sabe',
    thumbText: 'café',
  });
  assert.ok(good.total >= 80, `título com número e contradição aprova (${good.total})`);
  assert.equal(good.verdict, 'aprovado');
  assert.ok(good.checks.find((c) => c.id === 'hook')!.ok, 'o gancho é reconhecido');

  /* ── comprimento: até 60 cheio; 61–70 parcial; >100 zera ── */
  const lenScore = (n: number) => scoreTitle({ title: 'a'.repeat(n) }).checks.find((c) => c.id === 'length')!.score;
  assert.equal(lenScore(60), 20, '60 caracteres ainda cabem');
  assert.equal(lenScore(65), 14, '61–70 caracteres perde parte');
  assert.equal(lenScore(90), 7, '71–100 caracteres perde mais');
  assert.equal(lenScore(120), 0, 'acima de 100 zera');

  /* ── a thumbnail não pode repetir o título ── */
  const repeat = scoreTitle({ title: 'O café que mudou 3 impérios', thumbText: 'café impérios' });
  assert.equal(repeat.checks.find((c) => c.id === 'thumb')!.score, 0, 'duas palavras repetidas reprovam');
  const complement = scoreTitle({ title: 'O café que mudou 3 impérios', thumbText: 'xícara fumegante' });
  assert.equal(complement.checks.find((c) => c.id === 'thumb')!.score, 15, 'thumb que acrescenta passa');
  assert.deepEqual(sharedWords('O café que mudou 3 impérios', 'xícara fumegante'), []);

  /* ── palavra-chave: busca pune, navegação tolera; sem palavra-chave não mede ── */
  const noKw = scoreTitle({ title: 'O café que mudou 3 impérios' });
  assert.equal(noKw.checks.find((c) => c.id === 'keyword')!.applicable, false, 'sem palavra-chave a checagem não entra na conta');
  const lateKw = scoreTitle({ title: 'Uma história muito longa de dez minutos sobre o café que mudou três impérios', keyword: 'café', type: 'busca' });
  const navKw = scoreTitle({ title: 'Uma história muito longa de dez minutos sobre o café que mudou três impérios', keyword: 'café', type: 'navegação' });
  assert.ok(navKw.checks.find((c) => c.id === 'keyword')!.score > lateKw.checks.find((c) => c.id === 'keyword')!.score, 'navegação tolera a palavra-chave fora dos 40');

  /* ── distância ao padrão: copiar a frase do canal reprova ── */
  const niche = {
    avgLen: 48, commonStarts: ['o café', 'por que'], commonWords: ['café', 'império', 'história'],
    examples: ['O café que mudou 3 impérios — e ninguém sabe'],
  };
  const copy = scoreTitle({ title: 'O café que mudou 3 impérios — e ninguém sabe', niche });
  assert.ok(copy.checks.find((c) => c.id === 'niche')!.score <= 10, 'a mesma frase do canal perde a novidade');
  const fresh = scoreTitle({ title: 'A xícara que derrubou 4 governos — e o mundo esqueceu', niche });
  assert.ok(fresh.checks.find((c) => c.id === 'niche')!.score > copy.checks.find((c) => c.id === 'niche')!.score, 'título novo no mesmo esqueleto pontua mais');

  /* ── clique que o roteiro não entrega zera a promessa ── */
  const clickbait = scoreTitle({ title: 'O segredo chocante do café', promise: 'a história do café' });
  assert.equal(clickbait.checks.find((c) => c.id === 'promise')!.score, 0, 'clickbait sem lastro reprova');

  /* ── vereditos: 80/50 são as linhas do catálogo ── */
  assert.equal(titleVerdict(80), 'aprovado'); assert.equal(titleVerdict(79), 'revisar');
  assert.equal(titleVerdict(50), 'revisar'); assert.equal(titleVerdict(49), 'reprovado');

  /* ── palavras de conteúdo: sem funcionais, sem acento ── */
  assert.deepEqual(contentWords('O café que mudou os impérios'), ['cafe', 'mudou', 'imperios']);

  /* ── thumbnail: quantas palavras o brief declara ── */
  assert.equal(overlayWordCount('2 palavras, Impact branco com contorno preto, rodapé'), 2);
  assert.equal(overlayWordCount('"café forte"'), 2);
  assert.equal(overlayWordCount('CAFÉ FORTE'), 2);
  assert.equal(overlayWordCount('texto longo com vírgulas, cores e posições'), undefined);

  /* ── thumbnail: contraste real (WCAG) ── */
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01, 'preto × branco = 21:1');
  assert.ok(contrastRatio('#777777', '#888888') < 2, 'cinzas parecidos não têm contraste');

  /* ── thumbnail: brief bom passa, brief ruim reprova ── */
  const goodBrief = scoreThumbBrief({
    focal: 'rosto à direita, 45% do quadro', textOverlay: '2 palavras, Impact branco', palette: ['#111111', '#ffd400', '#ffffff'],
    avoid: ['texto pequeno', 'fundo claro', 'repetir o título'], title: 'O café que mudou 3 impérios',
  });
  assert.ok(goodBrief.score >= 80, `brief bom aprova (${goodBrief.score})`);
  assert.equal(goodBrief.checks.filter((c) => !c.ok).length, 0);
  const badBrief = scoreThumbBrief({
    textOverlay: '5 palavras escritas por cima do rosto', palette: ['#777777', '#888888'], title: 'café impérios mudou',
  });
  assert.ok(badBrief.score < 50, `brief ruim reprova (${badBrief.score})`);
  assert.equal(badBrief.verdict, 'reprovado');

  /* ── 168×94: o arquivo do feed é gerado de verdade ── */
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
  catch { console.log('(sem ffmpeg: teste do feed pulado)'); console.log('titles/thumb tests: OK'); return; }
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-title-'));
  const s = defaultSettings(ws);
  const big = path.join(ws, 'thumb.png');
  await ff.run(s.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=#ffd400:s=1280x720', '-frames:v', '1', big]);
  const qa = await checkThumb(s.ffmpeg, { thumb: big, outDir: ws, title: 'O café que mudou 3 impérios', brief: { textOverlay: 'café', focal: 'xícara', palette: ['#111111', '#ffd400'] } });
  assert.ok(qa.mobile && fs.existsSync(qa.mobile), 'o arquivo 168×94 foi gravado');
  const { stdout } = await ff.run(s.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', qa.mobile!]);
  const st = (JSON.parse(stdout) as { streams?: Array<{ width: number; height: number }> }).streams?.[0];
  assert.deepEqual([st?.width, st?.height], [168, 94], 'o teste do feed tem exatamente 168×94');
  assert.ok(fs.existsSync(path.join(ws, 'thumb-qa.json')), 'o relatório ficou em thumb-qa.json');

  console.log(`títulos: vago ${vague.total}/100 (${vague.verdict}) · bom ${good.total}/100 (${good.verdict}) · thumb ${goodBrief.score}/100`);
  console.log('titles/thumb tests: OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
