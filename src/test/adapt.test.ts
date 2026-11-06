import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultSettings } from '../main/settings';
import { getPlugin, installPluginFolder, pluginPrompt, pluginsRoot } from '../main/plugins';
import { adaptPlugin, normalizeAdaptation, pluginInventory, removeAdaptation } from '../main/plugin-adapt';
import type { Settings } from '../shared/types';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-adapt-'));
  const s: Settings = defaultSettings(ws);
  const bundled = path.join(__dirname, '..', '..', 'plugins-bundled');
  installPluginFolder(s, path.join(bundled, 'youtube'));
  const id = 'youtube';

  // ───────── sem adaptação: o plugin inteiro vai para todas as etapas (como antes)
  const raw = pluginPrompt(s, [id], {}, { stepKind: 'thumbnail' });
  assert.match(raw, /TODAS as etapas/);
  const rawNarr = pluginPrompt(s, [id], {}, { stepKind: 'narration' });
  assert.ok(rawNarr.length > 1000, 'sem adaptação, até a narração recebe o plugin');

  // ───────── inventário: skill, sub-skills e referências
  const inv = pluginInventory(s, id);
  assert.ok(inv.items.some((x) => x.id === 'skill:youtube'));
  assert.ok(inv.items.some((x) => x.id.endsWith('sub-skills/thumbnail.md')));
  assert.ok(inv.items.some((x) => x.id.endsWith('references/thumbnail-ctr-guide.md')));

  // ───────── adaptação sem IA (pelos nomes)
  const a = await adaptPlugin(s, id, { harness: '', log: () => {} });
  const stepsOf = (suffix: string) => a.items.find((x) => x.id.endsWith(suffix))?.steps ?? [];
  assert.deepEqual(stepsOf('sub-skills/thumbnail.md'), ['thumbnail']);
  assert.deepEqual(stepsOf('sub-skills/script.md'), ['script']);
  assert.deepEqual(stepsOf('sub-skills/hook.md'), ['script']);
  assert.ok(stepsOf('sub-skills/metadata.md').includes('metadata'));
  assert.ok(stepsOf('sub-skills/seo.md').includes('metadata'));
  assert.deepEqual(stepsOf('templates/review-channel.md'), [], 'modelos de canal não viram etapa');
  assert.ok(a.ignore.some((x) => /perguntas ao usuário/.test(x)));
  assert.ok(getPlugin(s, id)!.adaptation?.steps['thumbnail']?.length, 'a interface vê o mapa por etapa');

  // ───────── com adaptação: cada etapa recebe só o que é dela
  const thumb = pluginPrompt(s, [id], {}, { stepKind: 'thumbnail' });
  assert.match(thumb, /NESTA etapa/);
  assert.match(thumb, /Thumbnail Brief/, 'guia de thumbnail na etapa de thumbnail');
  assert.doesNotMatch(thumb, /Retention-Engineered Script/, 'roteiro fora da thumbnail');
  assert.match(thumb, /NÃO disponível no FilmForge/);
  const script = pluginPrompt(s, [id], {}, { stepKind: 'script' });
  assert.match(script, /Retention-Engineered Script/);
  assert.doesNotMatch(script, /Thumbnail Brief \+ A\/B/, 'thumbnail fora do roteiro');
  assert.equal(pluginPrompt(s, [id], {}, { stepKind: 'narration' }), '', 'narração não recebe nada do plugin');
  /* sem adaptação ia o roteador de comandos (SKILL.md) e a IA tinha de abrir as sub-skills; agora vai o conteúdo certo */
  assert.match(raw, /Command Router/);
  assert.doesNotMatch(thumb, /Command Router/, 'o roteador de comandos do Claude não entra na thumbnail');

  // ───────── resposta da IA é validada (ids e etapas inexistentes saem)
  const n = normalizeAdaptation(inv, {
    summary: 'ok', global: 'sem perguntas',
    items: [{ id: 'file:skills/claude-youtube/sub-skills/thumbnail.md', steps: ['thumbnail', 'voar'] }, { id: 'file:nao/existe.md', steps: ['script'] }, { id: 'skill:youtube', steps: [] }],
    outputs: { thumbnail: 'o brief vira o prompt da imagem', foo: 'x' }, ignore: ['DataForSEO'], recommended: null,
  }, 'claude/opus');
  assert.equal(n.items.length, 1);
  assert.deepEqual(n.items[0]!.steps, ['thumbnail']);
  assert.deepEqual(Object.keys(n.outputs ?? {}), ['thumbnail']);
  assert.ok(n.ignore.includes('DataForSEO'));
  assert.throws(() => normalizeAdaptation(inv, { items: [] }, 'x'), /nenhum item/);

  // ───────── desfazer: volta a entrar inteiro
  assert.equal(removeAdaptation(s, id), true);
  assert.match(pluginPrompt(s, [id], {}, { stepKind: 'thumbnail' }), /TODAS as etapas/);

  // ───────── plugin embutido Interface Cinemática já vem adaptado (só etapas que desenham a tela)
  fs.cpSync(path.join(bundled, 'interface-cinematica'), path.join(pluginsRoot(s), 'interface-cinematica'), { recursive: true });
  assert.match(pluginPrompt(s, ['interface-cinematica'], {}, { stepKind: 'code_scene' }), /Interface premium/);
  assert.equal(pluginPrompt(s, ['interface-cinematica'], {}, { stepKind: 'script' }), '', 'roteiro não recebe as regras de interface');
  assert.match(pluginPrompt(s, ['interface-cinematica'], {}, { stepKind: 'scene_plan' }), /elemento-herói/);

  fs.rmSync(ws, { recursive: true, force: true });
  // ───────── coleção de skills: o template escolhido é a única skill no prompt (adaptado ou não)
  const col = path.join(ws, 'src-colecao');
  for (const [n, d] of [['graph', 'Linha que se desenha'], ['map-route', 'Rota num mapa 3D']]) {
    fs.mkdirSync(path.join(col, 'skills', n), { recursive: true });
    fs.writeFileSync(path.join(col, 'skills', n, 'SKILL.md'), `---\nname: ${n}\ndescription: ${d}\n---\n# ${n}\nRECEITA-${n.toUpperCase()} com detalhes suficientes para entrar no prompt.\n`);
  }
  fs.mkdirSync(path.join(col, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(col, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'colecao' }));
  installPluginFolder(s, col);
  const cid = getPlugin(s, 'colecao') ? 'colecao' : 'src-colecao';
  const auto = pluginPrompt(s, [cid], {}, { stepKind: 'code_scene' });
  assert.match(auto, /RECEITA-GRAPH/); assert.match(auto, /RECEITA-MAP-ROUTE/);
  const one = pluginPrompt(s, [cid], { [cid]: 'map-route' }, { stepKind: 'code_scene' });
  assert.match(one, /TEMPLATE ESCOLHIDO NO PROJETO: map-route/);
  assert.match(one, /RECEITA-MAP-ROUTE/); assert.doesNotMatch(one, /RECEITA-GRAPH/, 'só o template escolhido');
  fs.writeFileSync(path.join(getPlugin(s, cid)!.dir, 'filmforge-adapt.json'), JSON.stringify({ version: 1, summary: 'x', items: [{ id: 'skill:graph', steps: ['code_scene'] }, { id: 'skill:map-route', steps: ['code_scene'] }] }));
  const oneAd = pluginPrompt(s, [cid], { [cid]: 'graph' }, { stepKind: 'code_scene' });
  assert.match(oneAd, /RECEITA-GRAPH/); assert.doesNotMatch(oneAd, /RECEITA-MAP-ROUTE/, 'adaptado: só o template escolhido');
  assert.match(pluginPrompt(s, [cid], { [cid]: 'nao-existe' }, { stepKind: 'code_scene' }), /RECEITA-MAP-ROUTE[\s\S]*|RECEITA-GRAPH/, 'template inválido = automático');

  console.log('plugin adaptation tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
