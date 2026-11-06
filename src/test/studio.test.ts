import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BUILTIN_SKILLS } from '../main/skills-builtin';
import { getRoute } from '../main/presets';
import { storyboardFor, storyboardPrompt } from '../main/cartoon3d';
import { publishTexts, safeFileName, writePublishKit } from '../main/publish-kit';
import { THUMB_DESIGN_TEMPLATES, THUMB_LAYOUTS, fitFont, luma, thumbPage, thumbTree, treeToHtml } from '../shared/thumbdesign';
import { allThumbTemplates, autoFrameTime, frameCandidates, frameScore, projectThumbDesign, thumbSize, thumbText } from '../main/thumb-render';
import { exportPluginsPack, importPluginsPack, pluginsRoot } from '../main/plugins';
import { kitModulesDir } from '../main/kit';
import { defaultSettings } from '../main/settings';
import type { Project } from '../shared/types';

/** Cartoon 3D longo, pasta de publicação, thumbnails visuais e plugins portáteis. */
async function main() {
  /* skill Cartoon 3D (episódio longo): mesma biblioteca do curta, rota própria com storyboard e revisão */
  const sk = BUILTIN_SKILLS.find((k) => k.id === 'cartoon-3d');
  assert.ok(sk && sk.codeKit === 'cartoon3d' && sk.routeId === 'cartoon-3d' && sk.aspect === '16:9' && (sk.durationSec ?? 0) >= 180, 'skill longa');
  assert.match(sk.steps['script']!, /Capítulo/); assert.match(sk.steps['scene_plan']!, /CENÁRIOS|cenários/i);
  const rt = getRoute('cartoon-3d')!;
  assert.ok(rt.steps.some((s) => s.id === 'storyboard') && rt.steps.find((s) => s.kind === 'code_scene')!.dependsOn.includes('storyboard'));
  assert.ok((rt.steps.find((s) => s.id === 'storyboard')!.timeoutSec ?? 0) >= 1800, 'storyboard do episódio tem mais tempo');
  const sp = storyboardPrompt('assets.md', [{ id: 's01', title: 'Cap. 1 — Abertura', durationSec: 12, narration: 'x', visualIntent: 'y' }], '16:9', { long: true });
  assert.match(sp, /EPISÓDIO[\s\S]*## Cenários recorrentes[\s\S]*## Storyboard[\s\S]*Cenário: Nome/);
  assert.doesNotMatch(storyboardPrompt('a', [], '9:16'), /Cenários recorrentes/, 'o curta continua igual');
  const md = '## Personagens fixos\n- **Ana**: C.OUTFITS.reporter\n## Paleta de materiais\n- muro: #aa5533\n## Cenários recorrentes\n- **A rua do bar**: st.street + st.house(sign "BAR")\n## Storyboard\n### s01 — Abertura\nCenário: A rua do bar\n- 0,0–4,0 s | GERAL\n';
  assert.match(storyboardFor(md, 's01', 1), /CENÁRIOS RECORRENTES[\s\S]*A rua do bar/);

  /* pasta "publicar" */
  assert.equal(safeFileName('Mamonas: A Curva "Fatal"? / 3D.'), 'Mamonas A Curva Fatal 3D');
  assert.equal(safeFileName('CON'), 'video');
  const p = { id: 'x', name: 'Projeto X', idea: 'ideia', aspect: '16:9', language: 'pt-BR', scenes: [] } as unknown as Project;
  const tx = publishTexts(p, { title: 'Título Bom', titleOptions: [{ title: 'Alt 1' }, 'Alt 2'], description: 'Resumo.', tags: ['a', '#b'], chapters: [{ time: '00:00', title: 'Abertura' }, '00:30 Meio'] }, 75);
  assert.match(tx['titulo.txt']!, /^Título Bom[\s\S]*- Alt 1[\s\S]*- Alt 2/);
  assert.match(tx['descricao.txt']!, /Resumo\.[\s\S]*Capítulos:[\s\S]*00:00 Abertura[\s\S]*00:30 Meio/);
  assert.equal(tx['tags.txt']!.trim(), 'a, b');
  assert.match(tx['LEIA-ME.txt']!, /01:15/);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-studio-'));
  const pdir = path.join(ws, 'proj'); fs.mkdirSync(path.join(pdir, 'out'), { recursive: true });
  assert.equal(writePublishKit(pdir, p), undefined, 'sem final.mp4 não gera');
  fs.writeFileSync(path.join(pdir, 'out', 'final.mp4'), 'video');
  fs.writeFileSync(path.join(pdir, 'out', 'thumbnail.png'), 'png');
  fs.writeFileSync(path.join(pdir, 'out', 'metadata.json'), JSON.stringify({ title: 'A Curva: Fatal', description: 'D', tags: ['x'] }));
  const kit = writePublishKit(pdir, p, 33)!;
  const names = fs.readdirSync(kit.dir).sort();
  assert.deepEqual(names, ['A Curva Fatal - thumbnail.png', 'A Curva Fatal.mp4', 'LEIA-ME.txt', 'descricao.txt', 'tags.txt', 'titulo.txt'].sort());
  assert.equal(fs.readFileSync(path.join(kit.dir, 'A Curva Fatal.mp4'), 'utf8'), 'video');
  /* título novo: o vídeo com o nome antigo não fica para trás */
  fs.writeFileSync(path.join(pdir, 'out', 'metadata.json'), JSON.stringify({ title: 'Outro Nome' }));
  writePublishKit(pdir, p);
  assert.ok(!fs.existsSync(path.join(kit.dir, 'A Curva Fatal.mp4')) && fs.existsSync(path.join(kit.dir, 'Outro Nome.mp4')));

  /* thumbnails visuais */
  assert.equal(THUMB_DESIGN_TEMPLATES.length, THUMB_LAYOUTS.length);
  for (const t of THUMB_DESIGN_TEMPLATES) {
    for (const [w, h] of [[1280, 720], [1080, 1920]] as const) {
      const html = treeToHtml(thumbTree(t.design, { w, h, text: 'Texto de teste', bg: 'bg1.jpg', bg2: 'bg2.jpg' }));
      assert.match(html, /bg1\.jpg/, `${t.id}: fundo`);
      assert.match(html, /TEXTO|Texto|DE TESTE|de teste/i, `${t.id}: texto`);
      assert.match(html, new RegExp(`width:${w}px;height:${h}px`), `${t.id}: tamanho`);
    }
    assert.match(t.prompt, /NO TEXT/, 'a imagem da IA vem sem texto');
  }
  assert.match(treeToHtml(thumbTree({ layout: 'impacto', accent: '#ff0000' }, { w: 1280, h: 720, text: 'A curva fatal' })), /color:#ff0000[^>]*>FATAL/, 'palavra final em destaque');
  assert.doesNotMatch(treeToHtml(thumbTree({ layout: 'impacto' }, { w: 1280, h: 720, text: '<script>' })), /<script>/, 'texto escapado');
  const ff = fitFont('UMA FRASE BEM COMPRIDA PARA A THUMB', 700, 500);
  assert.ok(ff.lines.length >= 2 && ff.lines.length <= 3 && ff.size > 40, 'quebra e tamanho');
  assert.ok(luma('#ffffff') > 0.99 && luma('#000000') < 0.01);
  assert.match(thumbPage(thumbTree({ layout: 'neon' }, { w: 10, h: 10, text: 'x' }), 10, 10), /window\.__forge/);
  const s0 = defaultSettings(ws);
  assert.ok(allThumbTemplates(s0).some((t) => t.id === 'v-impacto') && allThumbTemplates(s0).some((t) => t.id === 'impacto'), 'IA + visuais');
  const pr = { ...p, thumbnailTemplate: 'v-neon' } as Project;
  assert.equal(projectThumbDesign(s0, pr)?.layout, 'neon');
  assert.equal(projectThumbDesign(s0, { ...pr, thumbDesign: { layout: 'split' } })?.layout, 'split', 'o estúdio vence o template');
  assert.equal(projectThumbDesign(s0, { ...p, thumbnailTemplate: 'impacto' }), undefined, 'template só de prompt não tem desenho');
  assert.equal(thumbText(pdir, p), 'Projeto X');
  fs.writeFileSync(path.join(pdir, 'out', 'metadata.json'), JSON.stringify({ thumbnailText: 'POR QUE CAIU?' }));
  assert.equal(thumbText(pdir, p), 'POR QUE CAIU?');
  assert.deepEqual(thumbSize('16:9'), { w: 1280, h: 720 }); assert.deepEqual(thumbSize('9:16'), { w: 1080, h: 1920 });
  assert.equal(autoFrameTime({ ...p, scenes: [{ kind: 'code', durationSec: 4 }, { kind: 'code', durationSec: 10 }] } as unknown as Project, 14), 9);
  /* quadro mais "thumb": colorido e claro vence cartela preta e cinza lavado */
  const solid = (r: number, g: number, b: number) => new Uint8Array(Array.from({ length: 48 * 27 }, () => [r, g, b]).flat());
  const colorful = new Uint8Array(Array.from({ length: 48 * 27 }, (_, i) => (i % 3 === 0 ? [240, 60, 40] : i % 3 === 1 ? [30, 120, 230] : [250, 210, 40])).flat());
  assert.ok(frameScore(colorful) > frameScore(solid(128, 128, 128)) && frameScore(colorful) > frameScore(solid(5, 5, 8)), 'colorido vence');
  assert.ok(frameScore(solid(5, 5, 8)) < 1, 'cartela preta quase zero');
  const cands = frameCandidates({ ...p, scenes: Array.from({ length: 30 }, () => ({ durationSec: 3 })) } as unknown as Project, 90);
  assert.ok(cands.length <= 13 && cands.every((t) => t >= 0.5 && t <= 90), 'até 10 cenas + 3 pontos fixos');

  /* plugins portáveis: dependências dentro da pasta de plugins (com migração) e pacote .ffplugins */
  const s = { ...defaultSettings(path.join(ws, 'ws')), pluginsDir: path.join(ws, 'plugins') };
  fs.mkdirSync(path.join(s.workspace, 'plugin-deps', 'node_modules', 'three'), { recursive: true });
  fs.writeFileSync(path.join(s.workspace, 'plugin-deps', 'node_modules', 'three', 'package.json'), '{"name":"three"}');
  const mods = kitModulesDir(s);
  assert.equal(mods, path.join(pluginsRoot(s), '_deps', 'node_modules'));
  assert.ok(fs.existsSync(path.join(mods, 'three', 'package.json')), 'dependências antigas migradas para dentro dos plugins');
  const plug = path.join(pluginsRoot(s), 'meu-plugin');
  fs.mkdirSync(path.join(plug, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(plug, '.claude-plugin', 'plugin.json'), '{"name":"meu-plugin","description":"x"}');
  fs.writeFileSync(path.join(plug, 'filmforge-adapt.json'), '{"summary":"adaptado"}');
  const pack = exportPluginsPack(s, path.join(ws, 'todos.ffplugins'));
  assert.deepEqual(pack.plugins, ['meu-plugin']);
  assert.ok(fs.statSync(pack.file).size > 100);
  /* "outro computador": pasta de plugins vazia */
  const s2 = { ...defaultSettings(path.join(ws, 'ws2')), pluginsDir: path.join(ws, 'plugins2') };
  assert.deepEqual(importPluginsPack(s2, pack.file), ['meu-plugin']);
  assert.ok(fs.existsSync(path.join(pluginsRoot(s2), 'meu-plugin', 'filmforge-adapt.json')), 'adaptação junto');
  assert.ok(fs.existsSync(path.join(kitModulesDir(s2), 'three', 'package.json')), 'dependências junto');
  assert.throws(() => exportPluginsPack({ ...s2, pluginsDir: path.join(ws, 'vazio') }, path.join(ws, 'x.ffplugins')), /nenhum plugin/);
  console.log('studio tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
