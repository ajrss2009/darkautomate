import * as assert from 'node:assert/strict';
import { buildAss, effectFilters, FX_TEXTURES, moveExpr, SUBTITLE_KINDS, textureFilters, watermarkGraph, watermarkXY, type SubWord } from '../main/ffmpeg';
import { cleanWatermark, TEXTURES, updateScene } from '../main/ops';
import { findLinks, linkBudget, linksDoc, pageDoc, youTubeId } from '../main/weblink';
import { thumbTree, treeToHtml } from '../shared/thumbdesign';
import { alignChapters, publishTexts } from '../main/publish-kit';
import { orderStockSources } from '../shared/stock-sources';
import type { Project, Scene, SubtitleKind, SubtitleStyle } from '../shared/types';

/** Editor: legendas novas, texturas, animações, marca d'água e skill de vários links. */
function main() {
  /* ── legendas: os 5 tipos novos geram .ass válido e com o efeito de cada um ── */
  const words: SubWord[] = 'Olá mundo este é um teste das legendas'.split(' ').map((w, i) => ({ w, start: i * 0.4, end: i * 0.4 + 0.35 }));
  const st = (kind: SubtitleKind, position: SubtitleStyle['position'] = 'bottom'): SubtitleStyle => ({ burn: true, position, size: 46, color: '#ffffff', box: false, kind, accent: '#ffe14d' });
  const dlg = (ass: string) => ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  for (const k of ['highlight', 'reveal', 'typewriter', 'comic', 'slide'] as const) {
    assert.ok(SUBTITLE_KINDS.some((x) => x.id === k), `${k} na lista`);
    const ass = buildAss(words, st(k), { w: 1920, h: 1080 });
    assert.ok(dlg(ass).length > 0, k);
    assert.doesNotMatch(ass, /\{[^}]*\f/, `${k}: sem caractere de controle (escape perdido)`);
  }
  const hl = dlg(buildAss(words, st('highlight'), { w: 1920, h: 1080 }));
  assert.equal(hl.length, words.length, 'marca-texto: uma linha por palavra falada');
  assert.match(hl[1]!, /\\3c&H004DE1FF\\bord\d+\\shad0\}MUNDO/, 'palavra da vez com contorno grosso na cor de destaque');
  const rv = dlg(buildAss(words, st('reveal'), { w: 1920, h: 1080 }));
  assert.match(rv[0]!, /,Olá \{\\alpha&HFF&\}mundo este é um teste/, 'revelação: o resto do bloco fica invisível');
  assert.doesNotMatch(rv[5]!, /alpha/, 'última palavra do bloco: tudo visível');
  const tw = dlg(buildAss(words, st('typewriter'), { w: 1920, h: 1080 }));
  assert.equal((tw[0]!.match(/\\alpha&HFF&\\t\(/g) ?? []).length, 'Olámundoesteéumteste'.length, 'máquina de escrever: cada letra aparece no seu tempo');
  assert.match(buildAss(words, st('typewriter'), { w: 1920, h: 1080 }), /Style: Main,Courier New,/);
  assert.match(dlg(buildAss(words, st('comic'), { w: 1920, h: 1080 }))[0]!, /\\frz-3.*OLÁ MUNDO ESTE/, 'cartoon: inclinado, caixa alta, 3 palavras');
  const sl = dlg(buildAss(words, st('slide', 'top'), { w: 1920, h: 1080 }))[0]!;
  const m = /\\move\((\d+),(\d+),(\d+),(\d+),0,220\)/.exec(sl)!;
  assert.ok(m && m[1] === '960' && Number(m[2]) > Number(m[4]), 'deslizando: sobe até o lugar, centralizado');

  /* ── texturas e animações ── */
  assert.deepEqual(FX_TEXTURES.map((t) => t.id), TEXTURES.filter((t) => t !== 'none'), 'mesma lista no motor e no validador');
  for (const t of FX_TEXTURES) assert.ok(textureFilters(t.id).length > 0, t.id);
  assert.deepEqual(textureFilters('none'), []);
  assert.ok(effectFilters({ texture: 'vhs' }, 3, 1920, 1080).some((f) => f.startsWith('rgbashift')), 'textura entra nos filtros da cena');
  for (const mv of ['shake', 'pulse', 'drift'] as const) assert.ok(moveExpr(mv, 90), mv);
  /* cena: textura e movimento novos passam pelo validador; inválidos viram "none" */
  const p = { scenes: [{ id: 's01', index: 1, title: 'a', narration: 'x', visualIntent: '', kind: 'image', status: {}, artifacts: {} }] } as unknown as Project;
  updateScene(p, 's01', { effects: { texture: 'old_film', zoom: 'shake' } });
  assert.equal((p.scenes[0] as Scene).effects?.texture, 'old_film'); assert.equal((p.scenes[0] as Scene).effects?.zoom, 'shake');
  updateScene(p, 's01', { effects: { texture: 'xx' as never, zoom: 'pulse' } });
  assert.equal((p.scenes[0] as Scene).effects?.texture, undefined, 'textura inválida é descartada');

  /* ── marca d'água ── */
  assert.equal(cleanWatermark({ position: 'tl' }), undefined, 'sem texto nem imagem = sem marca');
  assert.deepEqual(cleanWatermark({ text: '  @canal  ', position: 'zz', opacity: 5, size: 999 }), { enabled: true, text: '@canal', position: 'br', opacity: 1, size: 60 });
  assert.deepEqual(watermarkXY('br'), { x: 'W-w-H*0.03', y: 'H-h-H*0.03' });
  assert.deepEqual(watermarkXY('center', { W: 'w', H: 'h', w: 'tw', h: 'th' }), { x: '(w-tw)/2', y: '(h-th)/2' });
  const gt = watermarkGraph({ enabled: true, position: 'tl', opacity: 0.5, size: 5 }, 'C:/tmp/wm.txt', 1920)!;
  assert.match(gt, /drawtext=.*textfile='C\\:\/tmp\/wm\.txt':expansion=none:fontsize=h\*0\.050:fontcolor=white@0\.50.*x=h\*0\.03:y=h\*0\.03\[wtxt\];\[wtxt\]format=yuv420p\[wm\]/);
  const gi = watermarkGraph({ enabled: true, image: 'logo.png', position: 'br', opacity: 0.8, size: 15 }, undefined, 1920)!;
  assert.match(gi, /\[1:v\]format=rgba,colorchannelmixer=aa=0\.80\[wmi\];\[wmi\]scale=288:-2\[wms\];\[0:v\]\[wms\]overlay=x=main_w-overlay_w-main_h\*0\.03/, 'imagem: 15% de 1920 = 288 px, canto inferior direito');
  assert.equal(watermarkGraph({ enabled: true, position: 'br', opacity: 1, size: 5 }, undefined, 1920), undefined);

  /* ── skill de link: vários links ── */
  assert.deepEqual(findLinks('compare https://a.com/x, https://b.com e https://a.com/x de novo (https://c.org/p?q=1).'), ['https://a.com/x', 'https://b.com', 'https://c.org/p?q=1']);
  assert.equal(findLinks(Array.from({ length: 25 }, (_, i) => `https://s${i}.com`).join(' ')).length, 20, 'no máximo 20');
  /* orçamento por link: mais links = captura e texto menores, menos trechos de vídeo */
  const b1 = linkBudget(1), b12 = linkBudget(12), b20 = linkBudget(20);
  assert.ok(b1.maxSec > b12.maxSec && b1.textMax > b12.textMax && b12.textMax >= b20.textMax && b20.textMax >= 2000 && b20.clips === 1);
  assert.ok(b20.textMax * 20 <= 60000, 'texto total cabe num modelo local');
  /* resumo da página com trechos de vídeo e embutidos */
  const pd = pageDoc({ url: 'https://x.com', title: 'X', description: '', text: 'a'.repeat(9000), sections: [], maxY: 0, viewH: 800 }, { ys: [0], marks: [], seconds: 1 },
    { video: 'web/l2/pagina.mp4', shots: [], clips: [{ file: 'web/l2/video-1.mp4', seconds: 6, near: 'Resultados' }], embeds: ['https://www.youtube.com/embed/abc'] }, 3000);
  assert.match(pd, /## Vídeos da página[\s\S]*web\/l2\/video-1\.mp4 \(6 s\) — perto de "Resultados"[\s\S]*## Vídeos embutidos não gravados\n- https:\/\/www\.youtube\.com\/embed\/abc/);
  assert.equal((pd.match(/a+$/) ?? [''])[0].length, 3000, 'texto cortado no orçamento');
  assert.deepEqual(findLinks('sem link'), []);
  /* YouTube citado pela página (post do Reddit que aponta para ele, player embutido) */
  for (const u of ['https://youtu.be/QHa7-HG5cgE', 'https://www.youtube.com/watch?v=QHa7-HG5cgE&t=10', 'https://m.youtube.com/shorts/QHa7-HG5cgE',
    'https://www.youtube-nocookie.com/embed/QHa7-HG5cgE?autoplay=1', 'https://www.youtube.com/live/QHa7-HG5cgE']) assert.equal(youTubeId(u), 'QHa7-HG5cgE', u);
  for (const u of ['https://www.youtube.com/@canal', 'https://notyoutube.com/watch?v=QHa7-HG5cgE', 'https://youtu.be/curto', '', undefined]) assert.equal(youTubeId(u), undefined, String(u));
  const idx = linksDoc([{ url: 'https://a.com', title: 'Site A', dir: 'web/l1', seconds: 20 }, { url: 'https://b.com', dir: 'web/l2' }]);
  assert.match(idx, /# 2 links[\s\S]*1\. Site A\n {3}LINK: https:\/\/a\.com\n {3}conteúdo: web\/l1\/pagina\.md · vídeo: web\/l1\/pagina\.mp4 \(20 s\)[\s\S]*2\. https:\/\/b\.com/);
  /* thumbnail 'Título no topo': parte depois de | na cor de destaque */
  const th = treeToHtml(thumbTree({ layout: 'titulo', accent: '#22d3ff' }, { w: 1280, h: 720, text: 'Teste de Turbo Loras|MiniMax H3' }));
  assert.match(th, /color:#ffffff">Teste [\s\S]*color:#ffffff">Loras [\s\S]*color:#22d3ff">MiniMax [\s\S]*color:#22d3ff">H3 /);
  assert.match(treeToHtml(thumbTree({ layout: 'titulo', accent: '#22d3ff' }, { w: 1280, h: 720, text: 'Novidades da IA esta semana' })), /color:#22d3ff">esta [\s\S]*color:#22d3ff">semana /, 'sem |: as 2 últimas palavras em destaque');
  assert.match(treeToHtml(thumbTree({ layout: 'titulo', accent: '#22d3ff' }, { w: 1280, h: 720, text: 'REVOLUÇÃO DE VÍDEO' })), /color:#ffffff">DE [\s\S]*color:#22d3ff">VÍDEO /, '3 palavras: a última em destaque');
  /* capítulos nos tempos reais das cenas (o modelo erra a soma) */
  const scn = [{ title: 'Abertura: gancho', seconds: 40 }, { title: 'Abertura: boas-vindas', seconds: 20 }, { title: 'Link 1: Geiru', seconds: 70 }, { title: 'Link 1: detalhes', seconds: 30 },
    { title: 'Link 2: Temporal Spatial Node', seconds: 66 }, { title: 'Fechamento: resumo', seconds: 5 }, { title: 'Fechamento: CTA', seconds: 4 }];
  assert.deepEqual(alignChapters(['0:03 Abertura', '1:00 Link 1: Geiru Context Suite', '2:18 Link 2: Minimax H3 Node', '3:50 Fechamento: O Poder do Código Aberto'], scn),
    ['0:00 Abertura', '1:00 Link 1: Geiru Context Suite', '2:40 Link 2: Minimax H3 Node', '3:46 Fechamento: O Poder do Código Aberto']);
  assert.deepEqual(alignChapters(['00:00 Início', '00:05 Temporal Spatial Node explicado', 'texto'], scn), ['0:00 Início', '2:40 Temporal Spatial Node explicado', 'texto'], 'sem prefixo: casa pelas palavras');
  assert.deepEqual(alignChapters(['0:00 A', '0:04 B', '0:30 C'], []), ['0:00 A', '0:04 B', '0:30 C'], 'sem cenas: não mexe');
  const ptx = publishTexts({ name: 'x', idea: 'y', aspect: '16:9', language: 'pt-BR' }, { description: 'Gancho.\n\n0:00 Abertura\n2:18 Link 2: Node\n\nFim.', chapters: ['0:00 Abertura', '2:18 Link 2: Node'] }, 235, scn);
  assert.match(ptx['descricao.txt']!, /0:00 Abertura\r\n2:40 Link 2: Node\r\n\r\nFim\./); assert.match(ptx['capitulos.txt']!, /2:40 Link 2: Node/);
  /* bancos de mídia: ordem pelo tema da cena (senão do projeto); só reordena as fontes habilitadas */
  const MIX = ['youtube', 'pexels', 'pixabay', 'wikipedia', 'openverse', 'nasa', 'archive', 'smithsonian', 'unsplash'] as const;
  const ord = (scene: string, project = '', src: readonly string[] = MIX) => orderStockSources([...src] as never, scene, project);
  assert.deepEqual(ord('Cinejornal da Segunda Guerra, soldados em 1944').sources.slice(0, 4), ['archive', 'wikipedia', 'smithsonian', 'openverse']);
  assert.equal(ord('Fotos de época da cidade').theme, 'imagens antigas / históricas', 'acento no começo da palavra');
  assert.equal(ord('1920s street, black and white footage').sources[0], 'archive');
  assert.deepEqual(ord('Astronauta na estação espacial').sources.slice(0, 2), ['nasa', 'wikipedia']);
  assert.equal(ord('Fósseis de dinossauros no museu').sources[0], 'smithsonian');
  assert.equal(ord('Mapa do império romano').sources[0], 'archive', 'antigo vence (vem antes na lista)');
  assert.deepEqual(ord('Pessoas trabalhando num escritório moderno').sources, [...MIX], 'sem tema: ordem da rota');
  assert.deepEqual(ord('Pessoas trabalhando num escritório', 'Documentário: a história da Grande Depressão').sources[0], 'archive', 'cena sem tema usa o tema do projeto');
  assert.deepEqual(ord('Planeta Marte', '', ['youtube', 'pexels', 'archive']).sources, ['archive', 'youtube', 'pexels'], 'NASA não habilitada: não é adicionada');
  assert.equal(ord('Explicando a propaganda na TV e o velho celular').theme, undefined, 'propaganda (publicidade) não é tema antigo');
  console.log('editorfx tests: OK');
}
main();
