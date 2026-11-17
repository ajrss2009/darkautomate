import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultSettings } from '../main/settings';
import { getPlugin, installPluginFolder, pluginsRoot } from '../main/plugins';
import { installPluginAny, pluginDocs, pluginSkillPrompt, pluginRootOf } from '../main/plugin-skill';

/*
 * Skill de ESTILO a partir de um plugin (o plugin como harness): a origem pode ser .plugin/.zip/pasta de
 * plugin ou uma SKILL.md solta; o texto do plugin (SKILL.md e referências) é o que a IA lê.
 */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-pluginskill-'));
  const s = defaultSettings(ws);
  installPluginFolder(s, path.join(__dirname, '..', '..', 'plugins-bundled', 'youtube'));
  const p = getPlugin(s, 'youtube')!;

  /* o que a IA lê: SKILL.md primeiro, referências depois, com teto por arquivo */
  const docs = pluginDocs(s, 'youtube');
  assert.ok(docs.docs.length >= 3, `esperava vários arquivos, veio ${docs.docs.length}`);
  assert.match(docs.docs[0]!, /skill\.md$/i, 'o SKILL.md vem primeiro');
  assert.match(docs.text, /===== .*skill\.md =====/i);
  assert.ok(docs.text.length > 500);
  assert.ok(!/licen[cs]e|third-party/i.test(docs.docs.join(' ')), 'licença não entra na análise');

  /* prompt do "skill de estilo": plugin inteiro + etapas do app + formato exato da skill */
  const prompt = pluginSkillPrompt(s, p, { corpus: docs.text, docs: docs.docs, scripts: ['tools/mix.py'], language: 'pt-BR', aspect: '9:16', durationSec: 60 });
  assert.match(prompt, /HARNESS DE ESTILO/);
  assert.match(prompt, /## Etapas do FilmForge/);
  assert.match(prompt, /aspect: 9:16/);
  assert.match(prompt, /durationSec: 60/);
  assert.match(prompt, /Formato EXATO de skill\.md/);
  assert.match(prompt, /tools\/mix\.py/, 'as ferramentas do plugin aparecem para a IA');
  assert.ok(prompt.includes(docs.docs[0]!), 'o conteúdo do plugin vai no pedido');

  /* pasta root: zip com uma pasta dentro desce para ela */
  const outer = path.join(ws, 'outer');
  fs.mkdirSync(path.join(outer, 'plugin-x'), { recursive: true });
  assert.equal(pluginRootOf(outer), path.join(outer, 'plugin-x'));
  assert.equal(pluginRootOf(path.join(ws, 'nao-existe')), path.join(ws, 'nao-existe'));

  /* skill SOLTA (só SKILL.md): vira plugin do Claude (manifesto + skills/) e instala */
  const bare = path.join(ws, 'minha-skill');
  fs.mkdirSync(bare, { recursive: true });
  fs.writeFileSync(path.join(bare, 'SKILL.md'), '---\nname: Papel Recortado\ndescription: animação de papel recortado\n---\n\n# Papel\n\nUse recortes de papel com sombra curta e grão de filme.\n');
  const a = installPluginAny(s, bare);
  assert.equal(a.name, 'papel-recortado');
  const dir = path.join(pluginsRoot(s), a.id);
  assert.ok(fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json')), 'a skill solta ganhou manifesto');
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'papel-recortado', 'SKILL.md')), 'a skill foi para skills/<nome>/SKILL.md');

  /* o mesmo por .zip (o formato do .plugin) */
  const zip = path.join(ws, 'papel.zip');
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const r = spawnSync(tar, ['--format', 'zip', '-cf', zip, '-C', path.dirname(bare), path.basename(bare)], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  const b = installPluginAny(s, zip);
  assert.equal(b.id, a.id, 'instalar de novo = atualizar o mesmo plugin');
  assert.match(pluginDocs(s, b.id).text, /recortes de papel/);

  /* origem inválida: erro claro */
  assert.throws(() => installPluginAny(s, path.join(ws, 'nao-existe')), /não encontrei/);
  const empty = path.join(ws, 'vazio'); fs.mkdirSync(empty);
  assert.throws(() => installPluginAny(s, empty), /não parece um plugin/);

  console.log('plugin-skill tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
