import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyFoldToSkill, chooseFold, deleteFold, ensureFolds, foldsWithMetrics, getFold, listFolds, saveSkill } from '../main/library';
import { createProject, defaultSettings, listProjects } from '../main/settings';

/** Dobras de nicho: persistência em library/folds, escolha explícita, bloco na skill e vínculo com o projeto. */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-folds-'));
  const s = defaultSettings(ws);
  const skill = saveSkill(s, { id: 'canal-teste', name: 'Canal Teste', description: 'demo', global: 'Diretrizes originais.', steps: {} });

  const bends = Array.from({ length: 10 }, (_, i) => ({ title: `Dobra ${i + 1}`, angle: `ângulo ${i + 1}`, why: `motivo ${i + 1}`, audience: 'público', exampleTitles: [`Título ${i + 1}`] }));
  const base = { channel: 'canal-teste', channelName: 'Canal Teste', sourceChannel: 'Origem', sourceUrl: 'https://youtube.com/@origem', skillId: skill.id, routeId: 'shorts-autopilot', bends, chosen: 2 };

  /* 1. as 10 dobras viram arquivos persistentes */
  const model = { format: 'formato X', text: 'texto grande amarelo, caixa alta', visual: '2D chapado, paleta quente', audio: 'voz + trilha lo-fi', soundtrack: 'lo-fi 90 BPM' };
  const folds = ensureFolds(s, { ...base, model });
  assert.equal(folds.length, 10, '10 dobras salvas');
  assert.ok(fs.existsSync(path.join(ws, 'library', 'folds', 'dobra-canal-teste-01.json')), 'arquivo da dobra no workspace');
  assert.equal(listFolds(s).length, 10, 'releitura do disco devolve as 10');
  assert.equal(folds.filter((f) => f.chosen).length, 1, 'só uma dobra ativa por canal');
  assert.equal(folds[2]!.chosen, true, 'a dobra escolhida pelo clone é a ativa');
  assert.equal(folds[0]!.status, 'idea');
  /* modelagem (texto/visual/áudio/trilha) e os outros subnichos ficam gravados em cada dobra */
  assert.equal(folds[0]!.model?.text, 'texto grande amarelo, caixa alta');
  assert.equal(getFold(s, folds[0]!.id)?.model?.soundtrack, 'lo-fi 90 BPM', 'modelagem persistida no disco');
  assert.equal(folds[0]!.subniches?.length, 9, 'os outros 9 subnichos ficam como alternativas');
  assert.ok(!folds[0]!.subniches!.includes('Dobra 1'), 'não lista a própria dobra');

  /* 2. escolher outra dobra move a marcação (sem duplicar) */
  chooseFold(s, folds[5]!.id);
  assert.equal(listFolds(s).filter((f) => f.chosen).length, 1);
  assert.equal(getFold(s, folds[5]!.id)?.chosen, true);
  assert.equal(getFold(s, folds[2]!.id)?.chosen, false);

  /* 3. re-rodar o clone (ensureFolds) não duplica nem desfaz a escolha do usuário */
  ensureFolds(s, { ...base, chosen: 0 });
  assert.equal(listFolds(s).length, 10, 'idempotente: continua 10');
  assert.equal(getFold(s, folds[5]!.id)?.chosen, true, 'escolha do usuário preservada');

  /* 4. aplicar na skill: bloco nas diretrizes + nota no estilo de saída (idempotente) */
  const applied = applyFoldToSkill(s, folds[5]!.id);
  assert.match(applied.skill.global, /<!-- dobra:start -->/);
  assert.match(applied.skill.global, /Dobra 6/);
  assert.match(applied.skill.global, /Diretrizes originais/, 'não perde o conteúdo anterior da skill');
  assert.equal(applied.fold.status, 'testing', 'sai de "ideia" ao ser usada');
  const twice = applyFoldToSkill(s, folds[5]!.id).skill;
  assert.equal((twice.global.match(/<!-- dobra:start -->/g) ?? []).length, 1, 'um bloco só');
  assert.equal((twice.outputStyle ?? '').split('\n').filter((l) => l.startsWith('🔗')).length, 1, 'uma nota só');

  /* 5. projeto ligado à dobra (id + cópia congelada) e métrica agregada */
  const p = createProject(s, { name: 'Ep 1', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot', skillId: skill.id, foldId: folds[5]!.id });
  assert.equal(p.foldId, folds[5]!.id);
  assert.equal(p.fold?.name, 'Dobra 6');
  assert.equal(p.fold?.channel, 'canal-teste');
  const withMetrics = foldsWithMetrics(listFolds(s), listProjects(s));
  assert.equal(withMetrics.find((f) => f.id === folds[5]!.id)?.metrics?.projects, 1, 'conta o projeto na dobra');

  /* 6. excluir uma dobra não mexe nos projetos */
  deleteFold(s, folds[0]!.id);
  assert.equal(listFolds(s).length, 9);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ws, 'projects', p.id, 'project.json'), 'utf8')).foldId, folds[5]!.id);

  console.log('folds tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
