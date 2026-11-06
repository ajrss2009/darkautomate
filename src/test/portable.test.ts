import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProject, defaultSettings } from '../main/settings';
import * as lib from '../main/library';
import { copyProfile, expand, openPortable, relocate, sealPortable, tokenize } from '../main/portable';
import { listPlugins, seedBundledPlugins } from '../main/plugins';
import { voiceAccepted, voicesForModel } from '../shared/voices';
import type { Settings } from '../shared/types';

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-portable-'));
  const ws = path.join(root, 'workspace');
  const s: Settings = defaultSettings(ws);

  // ───────── caminhos {DATA} e chaves que viajam com a pasta
  const t = tokenize({ workspace: ws, nested: [path.join(ws, 'voices', 'a.wav')], other: 'C:\\fora' }, root);
  assert.equal(t.workspace, '{DATA}/workspace');
  assert.equal(t.nested[0], '{DATA}/workspace/voices/a.wav');
  assert.equal(t.other, 'C:\\fora', 'fora da pasta de dados fica como está');
  const moved = path.join(os.tmpdir(), 'outro-drive');
  assert.equal(expand(t, moved).nested[0], path.join(moved, 'workspace', 'voices', 'a.wav'), 'expande para a nova pasta');
  const appData = path.join(root, 'appdata');
  const sealed = sealPortable(appData, 'sk-segredo');
  assert.ok(sealed.startsWith('pk1:') && !sealed.includes('segredo'));
  assert.equal(openPortable(appData, sealed), 'sk-segredo', 'abre com a chave da própria pasta');
  /* "outro PC": settings + .keyring copiados para outra pasta continuam abrindo as chaves */
  const otherPc = path.join(root, 'outro-pc');
  fs.cpSync(appData, otherPc, { recursive: true });
  assert.equal(openPortable(otherPc, sealed), 'sk-segredo', 'chave viaja com o .keyring');
  assert.equal(openPortable(path.join(root, 'sem-keyring'), sealed), '', 'sem o .keyring não abre');

  // ───────── skill/rota PADRÃO editada: fica permanente e restaura ao excluir
  const base = lib.listSkills(s).find((k) => k.builtin)!;
  lib.saveSkill(s, { ...base, global: 'MINHA VERSÃO' });
  const custom = lib.listSkills(s).filter((k) => k.id === base.id);
  assert.equal(custom.length, 1, 'não duplica a skill padrão');
  assert.equal(custom[0]!.global, 'MINHA VERSÃO');
  assert.ok(custom[0]!.builtin && (custom[0] as { customized?: boolean }).customized, 'marcada como padrão personalizada');
  const r0 = lib.listRoutes(s).find((r) => r.builtin)!;
  lib.saveRoute(s, { ...r0, description: 'rota minha' });
  assert.equal(lib.getAnyRoute(s, r0.id)!.description, 'rota minha', 'rota padrão personalizada vale no lugar da original');
  lib.deleteRoute(s, r0.id);
  assert.notEqual(lib.getAnyRoute(s, r0.id)!.description, 'rota minha', 'excluir restaura a padrão');
  assert.throws(() => lib.deleteRoute(s, r0.id), /padrão/, 'padrão sem personalização não é excluída');

  // ───────── pasta movida: caminhos dentro da biblioteca são corrigidos
  const skFile = path.join(ws, 'library', 'skills', `${base.id}.md`);
  fs.appendFileSync(skFile, `\n<!-- ${path.join(ws, 'media', 'x.mp4')} -->\n`);
  const ws2 = path.join(root, 'workspace2');
  assert.deepEqual(copyProfile(ws, ws2).sort(), ['library'], 'perfil copiado sem projetos');
  relocate([path.join(ws2, 'library')], ws, ws2);
  assert.ok(fs.readFileSync(path.join(ws2, 'library', 'skills', `${base.id}.md`), 'utf8').includes(path.join(ws2, 'media', 'x.mp4')), 'caminho reescrito');

  // ───────── plugin embutido com LLM indicada
  const bundled = path.join(__dirname, '..', '..', 'plugins-bundled');
  assert.deepEqual(seedBundledPlugins(s, bundled).sort(), ['interface-cinematica', 'youtube']);
  assert.deepEqual(seedBundledPlugins(s, bundled), [], 'instala uma vez só');
  const pl = listPlugins(s).find((p) => p.id === 'interface-cinematica')!;
  assert.ok(pl.recommended?.kinds.includes('code_scene'), 'declara a LLM indicada');
  fs.rmSync(path.join(ws, 'plugins', 'interface-cinematica'), { recursive: true });
  assert.deepEqual(seedBundledPlugins(s, bundled), [], 'removido pelo usuário não volta');
  fs.cpSync(path.join(bundled, 'interface-cinematica'), path.join(ws, 'plugins', 'interface-cinematica'), { recursive: true });
  /* perfil PORTÁTIL (outro PC/workspace): a pasta de plugins não veio, mas o marcador seededPlugins sim → volta */
  fs.rmSync(path.join(ws, 'plugins'), { recursive: true, force: true });
  assert.deepEqual(seedBundledPlugins(s, bundled).sort(), ['interface-cinematica', 'youtube'], 'pasta de plugins ausente recopia os embutidos');
  const route = lib.listRoutes(s).find((r) => r.steps.some((st) => st.kind === 'code_scene' && st.enabled && st.bindings[0]?.type === 'harness'))!;
  const p = createProject(s, { name: 'ui', idea: 'x', videoType: 'custom', routeId: route.id, plugins: ['interface-cinematica'] });
  const code = p.route!.steps.find((st) => st.kind === 'code_scene')!;
  assert.deepEqual(code.bindings[0], { type: 'harness', harness: 'claude', model: 'opus' }, 'Claude Opus à frente na cena por código');
  const p2 = createProject(s, { name: 'ui2', idea: 'x', videoType: 'custom', routeId: route.id, plugins: ['interface-cinematica'], executorSteps: { [code.id]: { type: 'harness', harness: 'codex' } } });
  assert.equal((p2.route!.steps.find((st) => st.id === code.id)!.bindings[0] as { harness?: string }).harness, 'codex', 'escolha por etapa vence a recomendação');

  // ───────── vozes por modelo
  assert.ok(voicesForModel('openai', 'gpt-4o-mini-tts').includes('ballad'));
  assert.ok(!voicesForModel('openai', 'tts-1').includes('ballad'), 'tts-1 não tem ballad');
  assert.ok(voiceAccepted('openai', 'gpt-4o-mini-tts', ['alloy'], 'coral'), 'voz conhecida do modelo é aceita');
  assert.ok(!voiceAccepted('openai', 'gpt-4o-mini-tts', ['alloy'], 'Kore'), 'voz do Gemini não vai para a OpenAI');
  assert.deepEqual(voicesForModel('gemini', 'gemini-2.5-flash-preview-tts', ['Kore', 'Puck']), ['Kore', 'Puck']);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('portable/overrides/plugin/voices tests: OK');
}
main();
