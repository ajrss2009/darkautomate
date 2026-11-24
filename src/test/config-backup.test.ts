import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Project, Settings } from '../shared/types';
import { configProjectFields, exportAppSettings, exportProjectConfig, importAppSettings, listProjectConfigs, mergeConfigProviders, openSecret, readProjectConfig, saveProjectConfig, sealSecret } from '../main/config-backup';

/** Salvar/restaurar configurações do app (chaves com senha) e a configuração completa do projeto com os provedores. */
function main() {
  const v = sealSecret('sk-123', 'senha');
  assert.ok(v.startsWith('pw1:') && !v.includes('sk-123'));
  assert.equal(openSecret(v, 'senha'), 'sk-123');
  assert.throws(() => openSecret(v, 'errada'), /senha errada/);

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cfg-'));
  const s = {
    workspace: ws, projectsDir: 'D:/projetos', pluginsDir: '',
    providers: [{ id: 'openai', kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-AAA', models: ['gpt'] }, { id: 'outra', kind: 'openai', baseUrl: 'x', apiKey: 'sk-BBB', models: [] }],
    comfyServers: [{ id: 'local', url: 'http://127.0.0.1:8188', token: 'tok' }],
    harnesses: { antigravity: { command: 'agy' }, claude: { command: 'claude' } },
    telegram: { enabled: true, token: 'tg-1', allowChats: [], notify: true, approveStoryboards: true },
    mediaBanks: [{ id: 'natal', name: 'Natal', dir: ws }], wan2gp: { root: ws, python: 'python', cliArgs: [] },
    automations: { accounts: [{ id: 'g2', label: 'Pro' }] }, stock: { pexels: { apiKey: 'px' } },
  } as unknown as Settings;

  /* app: sem senha as chaves ficam de fora; com senha vão cifradas */
  const plain = exportAppSettings(s);
  assert.equal(plain.secrets, 'omitted');
  assert.ok(!JSON.stringify(plain).includes('sk-AAA') && !JSON.stringify(plain).includes('tg-1'));
  const sealed = exportAppSettings(s, { password: 'p' });
  assert.ok(!JSON.stringify(sealed).includes('sk-AAA'));
  const here = { ...s, workspace: 'C:/aqui', projectsDir: 'C:/aqui/proj', providers: [{ ...s.providers[0]!, apiKey: 'sk-LOCAL' }], telegram: { ...s.telegram!, token: 'tg-local' } } as Settings;
  const r1 = importAppSettings(here, sealed, { password: 'p' });
  assert.equal(r1.providers.find((p) => p.id === 'openai')!.apiKey, 'sk-AAA', 'chave do arquivo');
  assert.equal(r1.workspace, 'C:/aqui', 'pastas desta máquina ficam');
  assert.equal(r1.projectsDir, 'C:/aqui/proj');
  assert.equal(r1.comfyServers![0]!.token, 'tok');
  const r2 = importAppSettings(here, plain);
  assert.equal(r2.providers.find((p) => p.id === 'openai')!.apiKey, 'sk-LOCAL', 'sem chave no arquivo: mantém a daqui');
  assert.equal(r2.telegram!.token, 'tg-local');
  assert.throws(() => importAppSettings(here, sealed), /senha/);
  assert.throws(() => importAppSettings(here, { format: 'x' } as never), /não é um arquivo/);

  /* projeto: configuração completa + só os provedores que a rota usa */
  const p = {
    id: 'p1', name: 'Natal', idea: 'ideia', scenes: [{ id: 's1' }], attachments: [{ file: 'a.mp3' }], aspect: '16:9', targetDurationSec: 60, language: 'en',
    subtitles: 'burn', narrationVoice: { refAudio: 'v.wav' }, finalEffects: { filter: 'technicolor' }, musicVolume: 0.8, flowAccount: 'g2',
    route: { id: 'r', name: 'Rota Natal', description: '', videoTypes: [], steps: [
      { id: 'script', kind: 'script', bindings: [{ type: 'harness', harness: 'antigravity', model: 'gemini-3.8-flash-low' }] },
      { id: 'image', kind: 'image', bindings: [{ type: 'builtin', tool: 'media-folder', bank: 'natal' }, { type: 'comfyui', server: 'local', workflow: 'x.json' }, { type: 'flow', account: 'g2' }] },
      { id: 'video', kind: 'video', bindings: [{ type: 'wan2gp', template: 'wan2gp-h3.json' }, { type: 'api', provider: 'openai', model: 'sora' }] },
    ] },
  } as unknown as Project;
  const cfg = exportProjectConfig(s, p, { password: 'p' });
  assert.equal(cfg.project.route!.steps[0]!.bindings[0]!.type, 'harness', 'rota com o provedor de cada etapa');
  assert.equal((cfg.project.finalEffects as { filter: string }).filter, 'technicolor');
  assert.ok(!('idea' in cfg.project) && !('scenes' in cfg.project) && !('attachments' in cfg.project) && !('id' in cfg.project), 'sem conteúdo');
  assert.deepEqual(cfg.providers.api.map((x) => x.id), ['openai'], 'só a API usada');
  assert.ok(cfg.providers.api[0]!.apiKey.startsWith('pw1:'));
  assert.deepEqual(cfg.providers.comfyServers.map((x) => x.id), ['local']);
  assert.deepEqual(Object.keys(cfg.providers.harnesses), ['antigravity']);
  assert.ok(cfg.providers.wan2gp && cfg.providers.mediaBanks[0]!.id === 'natal' && cfg.providers.flowAccounts[0]!.id === 'g2');

  const saved = saveProjectConfig(s, cfg);
  const again = saveProjectConfig(s, { ...cfg, id: '' });
  assert.notEqual(saved.id, again.id, 'nunca sobrescreve');
  assert.equal(listProjectConfigs(s).length, 2);
  assert.equal(listProjectConfigs(s)[0]!.route, 'Rota Natal');
  const back = readProjectConfig(s, saved.id);

  /* em outra máquina, sem nada: cria o que falta, com as chaves (senha) */
  const blank = { workspace: ws, providers: [], harnesses: {}, comfyServers: [], mediaBanks: [] } as unknown as Settings;
  const m = mergeConfigProviders(blank, back, 'p');
  assert.equal(m.settings.providers[0]!.apiKey, 'sk-AAA');
  assert.ok(m.added.includes('API openai') && m.added.includes('ComfyUI local') && m.added.includes('Wan2GP') && m.added.some((x) => /harness antigravity/.test(x)));
  assert.ok(m.missing.some((x) => /conta do Flow Pro/.test(x)), 'conta do Flow precisa de login');
  /* nunca sobrescreve um provedor que já existe */
  const m2 = mergeConfigProviders({ ...blank, providers: [{ ...s.providers[0]!, apiKey: 'sk-MINHA', baseUrl: 'minha' }] } as Settings, back, 'p');
  assert.equal(m2.settings.providers[0]!.apiKey, 'sk-MINHA');
  assert.equal(m2.settings.providers[0]!.baseUrl, 'minha');
  const fields = configProjectFields(back);
  assert.equal(fields.subtitles, 'burn'); assert.equal(fields.route!.name, 'Rota Natal'); assert.ok(!('name' in fields));
  fs.rmSync(ws, { recursive: true, force: true });
}

main();
console.log('config-backup tests: OK');
