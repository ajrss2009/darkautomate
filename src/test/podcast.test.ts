import * as assert from 'node:assert/strict';
import { alignPodcastScenes, blocksMarkdown, fullscreenScenes, fullscreenWindow, podcastBlocks, podcastOffsets, podcastPipScene, tensionScore } from '../main/podcast-pip-scene';
import { clockSeconds, sectionFromIdea } from '../main/youtube';

/* Podcast 16:9: voz original, PiP sincronizada com o trecho e tela cheia nos momentos de tensão */
function main() {
  const scenes = [
    { id: 's01', durationSec: 8, narration: 'Hoje eu vou contar como tudo começou na cidade.' },
    { id: 's02', durationSec: 7, narration: 'Ninguém sabia o que tinha naquele porão escondido.' },
    { id: 's03', durationSec: 9, narration: 'E de repente a porta abriu sozinha. Você acredita?' },
    { id: 's04', durationSec: 8, narration: 'Eu senti medo de verdade, um silêncio estranho!' },
    { id: 's05', durationSec: 10, narration: 'Depois disso a família se mudou e a casa ficou vazia.' },
  ];

  /* blocos contíguos: a cena começa onde a anterior terminou; clipStart do plano manda */
  const off = podcastOffsets(scenes);
  assert.deepEqual([...off.values()], [0, 8, 15, 24, 32]);
  assert.equal(podcastOffsets([{ id: 'a', durationSec: 5 }, { id: 'b', durationSec: 5, clipStart: 40 }, { id: 'c', durationSec: 3 }]).get('c'), 45);

  /* sem marca no plano: o app escolhe o trecho mais tenso, nunca a primeira cena, até ~25 s e ≤ 50% */
  assert.ok(tensionScore(scenes[2]!) > tensionScore(scenes[0]!));
  const auto = fullscreenScenes(scenes);
  assert.ok(!auto.has('s01'), 'o gancho não é tela cheia');
  assert.ok(auto.has('s03') || auto.has('s04'), 'tela cheia no momento de tensão');
  const secs = scenes.filter((s) => auto.has(s.id)).reduce((a, s) => a + s.durationSec, 0);
  assert.ok(secs >= 10 && secs <= 21, `tela cheia de 10-25 s e no máximo metade do vídeo (${secs} s)`);

  /* o que o plano marcou manda, inclusive "TELA_CHEIA 10-25s" (é duração, não instante na cena) */
  const marked = fullscreenScenes(scenes.map((s) => (s.id === 's02' ? { ...s, notes: 'TELA_CHEIA 10-25s sem zoom' } : s)));
  assert.deepEqual([...marked], ['s02']);

  /* janela: cena marcada inteira; vizinhas em tela cheia emendam sem voltar ao PiP */
  assert.deepEqual(fullscreenWindow(8, false, false), { start: 0.4, end: 7.6 });
  assert.deepEqual(fullscreenWindow(8, true, true), { start: 0, end: 9 });

  /* HTML: a PiP busca o vídeo no ponto da cena no trecho e a tela cheia aparece dentro da cena */
  const html = podcastPipScene({ duration: 8, videoStart: 15, fullscreen: fullscreenWindow(8, false, true) });
  assert.match(html, /VSTART=15/);
  /* regressão dark54: <video> não tem naturalWidth — a PiP saía preta */
  assert.match(html, /im\.naturalWidth\|\|im\.videoWidth/);
  assert.match(html, /var target=VSTART\+clamp\(t,0,DUR\)/);
  assert.match(html, /var FS=\{s:0\.4,e:9\}/);
  /* regressão dark53: "TELA_CHEIA 10-25s" numa cena de 8 s não pode gerar uma janela fora da cena */
  assert.match(podcastPipScene({ duration: 8, fullscreen: { start: 10, end: 25 } }), /var FS=null/);

  /* fala real em blocos de 6-12 s, fechando no fim da frase ou na pausa, contíguos desde o 0 */
  const words: Array<{ w: string; start: number; end: number }> = [];
  const say = (text: string, from: number, gapAfter = 0.2) => { let t = from; for (const w of text.split(' ')) { words.push({ w, start: t, end: t + 0.4 }); t += 0.5; } return t - 0.1 + gapAfter; };
  let t = 0.3;
  t = say('Eu entrei no grupo com dezessete anos e fiquei até os vinte e seis.', t);
  t = say('Num congresso eles revelaram o calendário inteiro pra gente.', t, 0.9);
  t = say('Um falso Anticristo em dois mil e dois e o verdadeiro depois.', t);
  t = say('Só que a data mudou e ninguém explicou por quê.', t);
  const blocks = podcastBlocks(words);
  assert.ok(blocks.length >= 3, `blocos: ${blocks.length}`);
  assert.equal(blocks[0]!.start, 0, 'começa no 0 do trecho');
  for (let k = 1; k < blocks.length; k++) assert.equal(blocks[k]!.start, blocks[k - 1]!.end, 'contíguos, sem buraco');
  for (const b of blocks.slice(0, -1)) assert.ok(b.end - b.start >= 6 && b.end - b.start <= 12.5, `6-12 s (${(b.end - b.start).toFixed(1)})`);
  assert.equal(blocks.map((b) => b.text).join(' '), words.map((w) => w.w).join(' '), 'nenhuma palavra perdida');
  assert.match(blocksMarkdown(blocks), /^1\. \[0\.00s–/m);

  /* plano com o mesmo número de cenas: 1 para 1; com menos cenas: junta blocos nas fronteiras */
  const plan: Array<{ id: string; durationSec: number; narration?: string; clipStart?: number }> = blocks.map((_, k) => ({ id: `s0${k + 1}`, durationSec: 9, narration: 'texto inventado' }));
  alignPodcastScenes(plan, blocks);
  assert.deepEqual(plan.map((s) => s.clipStart), blocks.map((b) => b.start));
  assert.equal(plan[0]!.narration, blocks[0]!.text, 'a fala da cena é a do trecho, não a inventada');
  const fewer = [{ id: 'a', durationSec: 10 }, { id: 'b', durationSec: 10 }] as Array<{ id: string; durationSec: number; clipStart?: number; narration?: string }>;
  alignPodcastScenes(fewer, blocks);
  assert.equal(fewer[0]!.clipStart, 0); assert.equal(fewer[1]!.clipStart! + fewer[1]!.durationSec, blocks[blocks.length - 1]!.end, 'cobre o trecho inteiro');
  assert.equal(`${fewer[0]!.narration} ${fewer[1]!.narration}`, blocks.map((b) => b.text).join(' '));

  /* link + minutos na ideia */
  assert.equal(clockSeconds('46:04'), 2764); assert.equal(clockSeconds('1:02:03'), 3723);
  assert.deepEqual(sectionFromIdea('Podcast https://www.youtube.com/watch?v=abc123 46:04 - 47:10, canto inferior esquerdo'), { url: 'https://www.youtube.com/watch?v=abc123', start: 2764, end: 2830 });
  assert.equal(sectionFromIdea('sem link'), undefined);
  assert.deepEqual(sectionFromIdea('https://youtu.be/x'), { url: 'https://youtu.be/x', start: 0, end: 120 });

  console.log('podcast: ok');
}
main();
