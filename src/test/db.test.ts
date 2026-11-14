import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ForgeDb, listProjectsIndexed } from '../main/db';
import { defaultSettings } from '../main/settings';
import type { Project, Scene } from '../shared/types';

/** Banco portátil: índice (projetos/cenas/arquivos), mudanças, backup, integridade e recuperação. */
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-db-root-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-db-ws-'));
  const s = defaultSettings(ws);
  const dir = path.join(ws, 'projects');
  fs.mkdirSync(dir, { recursive: true });

  const scene = (id: string, narration: string, kind: Scene['kind'] = 'code') => ({ id, index: 1, title: id, narration, visualIntent: 'x', kind, durationSec: 4, status: {}, artifacts: {} });
  const project = (id: string, name: string, createdAt: string, scenes = 2): Project => ({
    id, name, idea: `${name} — ideia`, videoType: 'custom', aspect: '16:9', targetDurationSec: 60, language: 'pt-BR', routeId: 'explainer-mixed',
    quality: 'standard', memories: [], createdAt, scenes: Array.from({ length: scenes }, (_, i) => scene(`s${i + 1}`, `fala ${i + 1}`)),
    skill: { id: 'explicativo-codigo', name: 'Explicativo' }, route: { name: 'Explicativo misto' }, production: { totalMs: 1234, runs: [] },
  } as unknown as Project);
  const writeProject = (p: Project) => {
    const d = path.join(dir, p.id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'project.json'), JSON.stringify(p));
    return d;
  };
  const a = project('a', 'Alfa', '2026-11-10T10:00:00.000Z', 3);
  const b = project('b', 'Beta', '2026-11-11T10:00:00.000Z', 2);
  const c = project('c', 'Gama', '2026-11-12T10:00:00.000Z', 1);
  writeProject(a); writeProject(b); const cDir = writeProject(c);
  fs.mkdirSync(path.join(cDir, 'out'), { recursive: true });
  fs.writeFileSync(path.join(cDir, 'out', 'final.mp4'), 'fake');

  const db = await ForgeDb.open({ root, workspace: ws });
  assert.ok(fs.existsSync(path.join(root, 'filmforge.db')), 'um arquivo, não uma árvore');
  assert.ok(fs.existsSync(path.join(root, 'device.id')), 'device id do aparelho');

  const idx = db.syncIndex(s);
  assert.deepEqual([idx.added, idx.updated, idx.removed], [3, 0, 0], 'primeira indexação');

  /* lista: campos da tela saem do índice (sem abrir project.json) */
  let rows = db.listRows();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.name), ['Gama', 'Beta', 'Alfa'], 'ordenado por criação (desc)');
  const gama = rows[0]!, alfa = rows[2]!;
  assert.equal(alfa.scenes, 3); assert.equal(alfa.scenesWithMedia, 0);
  assert.equal(gama.hasFinal, true); assert.equal(gama.status, 'done');
  assert.equal(alfa.status, 'partial', 'cenas planejadas ainda sem mídia');
  assert.equal(alfa.totalMs, 1234);
  assert.equal(alfa.routeName, 'Explicativo misto');
  assert.equal(alfa.skillId, 'explicativo-codigo');
  assert.ok(alfa.dir && path.isAbsolute(alfa.dir), 'dir absoluto para a UI');

  /* segunda varredura sem mudanças não grava nada */
  const changes0 = db.status().changes;
  assert.deepEqual(db.syncIndex(s), { added: 0, updated: 0, removed: 0, total: 3 });
  assert.equal(db.status().changes, changes0, 'sem mudança = sem linha no change_log');

  /* mudou o projeto: atualiza a linha e registra UMA mudança */
  a.name = 'Alfa v2'; a.scenes.push(scene('s4', 'nova fala'));
  writeProject(a);
  const idx2 = db.syncIndex(s);
  assert.equal(idx2.updated, 1);
  rows = db.listRows();
  assert.equal(rows.find((r) => r.id === 'a')!.name, 'Alfa v2');
  assert.equal(rows.find((r) => r.id === 'a')!.scenes, 4);
  assert.equal(db.status().changes, changes0 + 1);
  const logRows = db.changesSince(0);
  assert.ok(logRows.length >= 4);
  assert.ok(logRows.every((r) => typeof r['device_id'] === 'string' && r['device_id']));
  assert.equal(logRows[logRows.length - 1]!['entity'], 'project');

  /* fim da execução: só o cronômetro muda (recordRun) — o tempo de geração TEM de chegar ao índice */
  (a as { production: { totalMs: number; runs: unknown[] } }).production = { totalMs: 98765, runs: [{ startedAt: '2026-11-14T01:00:00.000Z', endedAt: '2026-11-14T01:01:38.000Z', ms: 98765, ok: true }] };
  db.indexProject(a, path.join(dir, 'a'));
  const timed = db.listRows().find((r) => r.id === 'a')!;
  assert.equal(timed.totalMs, 98765, 'tempo de geração no índice depois da execução');
  assert.equal(timed.runs, 1);

  /* apagar a pasta = marcar deleted_at (nada é apagado de verdade) */
  fs.rmSync(path.join(dir, 'b'), { recursive: true, force: true });
  assert.equal(db.syncIndex(s).removed, 1);
  assert.equal(db.listRows().length, 2);
  assert.equal(db.status().projects, 3, 'a linha do projeto apagado continua no banco');
  assert.ok(db.changesSince(0).some((r) => r['entity_id'] === 'b' && r['op'] === 'delete'));

  /* mídia por hash: o mesmo arquivo em dois caminhos tem o mesmo sha256 */
  const f1 = path.join(ws, 'logo.png'), f2 = path.join(ws, 'projects', 'a', 'logo.png');
  fs.writeFileSync(f1, 'PNG-DE-MENTIRA'); fs.mkdirSync(path.dirname(f2), { recursive: true }); fs.copyFileSync(f1, f2);
  const h1 = db.ensureAsset(f1, { projectId: 'a', role: 'image' });
  const h2 = db.ensureAsset(f2, { projectId: 'a', role: 'image' });
  assert.equal(h1, h2, 'mesmo conteúdo = mesmo hash');
  assert.ok(h1 && /^[a-f0-9]{64}$/.test(h1));

  /* backups: arquivo válido, contagem e integridade */
  const backup = db.backup('teste');
  assert.ok(fs.existsSync(backup));
  assert.ok(fs.statSync(backup).size > 0);
  assert.ok(db.status().backups >= 1);
  assert.equal(db.integrityCheck(), 'ok');

  /* reabrir lê o mesmo banco (índice persiste) */
  db.close();
  const db2 = await ForgeDb.open({ root, workspace: ws });
  assert.equal(db2.listRows().length, 2);
  assert.equal(db2.status().schema >= 2, true);
  db2.close();

  /* arquivo corrompido: volta do backup mais recente em vez de recomeçar do zero */
  fs.writeFileSync(path.join(root, 'filmforge.db'), Buffer.from('ISTO NÃO É UM BANCO SQLITE'));
  const db3 = await ForgeDb.open({ root, workspace: ws });
  assert.ok(db3.restoredBackup, 'restaurou do backup');
  assert.equal(db3.integrityCheck(), 'ok');
  assert.ok(db3.listRows().length >= 2);
  assert.ok(fs.readdirSync(root).some((f) => f.startsWith('filmforge.db.corrupt-')), 'guarda o arquivo corrompido');
  db3.close();

  /* sem banco aberto (CLI/testes), a lista cai na varredura de sempre */
  const fallback = [{ id: 'x', name: 'X', createdAt: '' }] as never;
  assert.deepEqual(listProjectsIndexed(s, () => fallback), fallback);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(ws, { recursive: true, force: true });
  console.log('db tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
