import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { Project, Settings } from '../shared/types';
import { projectDirOf, projectsDir } from './settings';

/**
 * BANCO PORTÁTIL: um arquivo, não uma árvore.
 *
 * O banco é um SQLite de verdade (sql.js), guardado em `<dataRoot>/filmforge.db`, com:
 *  - uma linha por projeto/cena/arquivo (o que se CONSULTA), não mídia (o que se abre);
 *  - `org_id`, `device_id`, `updated_at` e `deleted_at` em todas as tabelas — o mesmo schema vale no PC,
 *    no pendrive e (no futuro) na nuvem;
 *  - `change_log` append-only, que é a fila de sincronização (pull/push por seq);
 *  - backup por exportação para `backups/AAAA-MM-DD-HHmm.db` (o equivalente ao VACUUM INTO), nunca em pasta
 *    sincronizada.
 *
 * Persistência: o arquivo é reescrito inteiro por transação confirmada (tmp + fsync + rename). É o equivalente
 * portátil do par WAL + synchronous=FULL: se o pendrive for removido no meio, o arquivo antigo continua inteiro
 * (o rename é atômico) e o journal temporário é descartado. O banco carrega na memória; como ele só tem metadados
 * (kilo, não giga), a reescrita é barata.
 */

export const SCHEMA_VERSION = 3;

/** Custo estimado do vídeo (calculado pelo main, que conhece canais/preços); o banco só guarda o JSON. */
let costProvider: ((p: Project) => unknown) | undefined;
export const setProjectCostProvider = (fn: (p: Project) => unknown) => { costProvider = fn; };

export interface DbStatus {
  path: string; size: number; projects: number; scenes: number; assets: number; changes: number;
  schema: number; deviceId: string; orgId: string; integrity: string; backups: number;
}

const nowIso = () => new Date().toISOString();
const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex');
const relOrAbs = (workspace: string, file: string) => {
  const rel = path.relative(path.resolve(workspace), path.resolve(file));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : path.resolve(file);
};

let sqljs: Promise<SqlJsStatic> | undefined;
/** Carrega o runtime do sql.js uma vez (wasm ao lado do módulo; dentro do asar o fs do Electron lê normalmente). */
function runtime() {
  sqljs ??= initSqlJs({ locateFile: (f: string) => path.join(path.dirname(require.resolve('sql.js')), f) });
  return sqljs;
}

export class ForgeDb {
  readonly file: string;
  readonly root: string;
  readonly workspace: string;
  readonly backupsDir: string;
  readonly mediaDir: string;
  readonly deviceId: string;
  readonly orgId = 'local';
  readonly userId = 'local';
  private db: Database;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | undefined;
  private closed = false;
  /** última integridade medida (o check é caro; roda no open e quando pedido) */
  private integrity = 'ok';
  private restoredFrom: string | undefined;

  private constructor(db: Database, root: string, workspace: string, deviceId: string, file: string) {
    this.db = db; this.root = root; this.workspace = workspace; this.deviceId = deviceId; this.file = file;
    this.backupsDir = path.join(root, 'backups');
    this.mediaDir = path.join(root, 'media');
  }

  /** Abre (ou cria) o banco do modo atual: portátil = `<exe>\data`, instalado = `%APPDATA%\filmforge`. */
  static async open(o: { root: string; workspace: string }): Promise<ForgeDb> {
    const root = path.resolve(o.root), file = path.join(root, 'filmforge.db');
    fs.mkdirSync(root, { recursive: true });
    const deviceId = readDeviceId(root);
    const SQL = await runtime();
    let db: Database | undefined;
    let restored: string | undefined;
    if (fs.existsSync(file)) {
      try {
        db = new SQL.Database(fs.readFileSync(file));
        const check = scalar(db, 'PRAGMA integrity_check');
        if (check !== 'ok') throw new Error(`integrity_check: ${check}`);
      } catch (e) {
        /* arquivo corrompido: guarda o original e volta o backup mais recente (se houver) */
        try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { try { fs.rmSync(file, { force: true }); } catch { /* */ } }
        const bak = latestBackup(root);
        if (bak) {
          try { fs.copyFileSync(bak, file); db = new SQL.Database(fs.readFileSync(file)); restored = bak; } catch { db = undefined; }
        }
        if (!db) logDb(`⚠ banco corrompido (${(e as Error).message}) e sem backup — recomeçando do índice`);
      }
    }
    db ??= new SQL.Database();
    const inst = new ForgeDb(db, root, o.workspace, deviceId, file);
    inst.restoredFrom = restored;
    inst.migrate();
    /* logo depois de abrir, uma cópia de segurança do dia (uma por dia) */
    inst.backupDaily();
    inst.flushNow();
    return inst;
  }

  private migrate() {
    this.db.run(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS org (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT, name TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, idea TEXT,
        video_type TEXT, aspect TEXT, created_at TEXT, updated_at TEXT NOT NULL, deleted_at TEXT,
        device_id TEXT NOT NULL, dir TEXT, skill_id TEXT, route_id TEXT, fold_id TEXT, channel_id TEXT,
        stage TEXT, scenes INTEGER, seconds REAL, indexed_mtime INTEGER, content_hash TEXT,
        type_id TEXT, language TEXT, target_seconds REAL, skill_name TEXT, route_name TEXT, plugins TEXT,
        scenes_with_media INTEGER, has_final INTEGER, runs INTEGER, last_run_at TEXT, last_run_ok INTEGER,
        total_ms REAL, cost_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_project_org_updated ON project (org_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_project_deleted ON project (deleted_at);
      CREATE TABLE IF NOT EXISTS scene (
        id TEXT NOT NULL, project_id TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT, narration TEXT,
        kind TEXT, seconds REAL, status TEXT, updated_at TEXT NOT NULL, deleted_at TEXT,
        PRIMARY KEY (project_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_scene_project ON scene (project_id, idx);
      CREATE TABLE IF NOT EXISTS asset (
        org_id TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT, project_id TEXT, bytes INTEGER,
        mime TEXT, role TEXT, created_at TEXT NOT NULL, deleted_at TEXT,
        PRIMARY KEY (org_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_asset_hash ON asset (org_id, sha256);
      CREATE INDEX IF NOT EXISTS idx_asset_project ON asset (project_id);
      CREATE TABLE IF NOT EXISTS run (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT, step TEXT, started_at TEXT, ended_at TEXT, error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_run_project ON run (project_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS change_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, entity_id TEXT NOT NULL, op TEXT NOT NULL,
        at TEXT NOT NULL, device_id TEXT NOT NULL, org_id TEXT NOT NULL, payload TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_change_entity ON change_log (entity, entity_id);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    const v = Number(scalar(this.db, 'PRAGMA user_version') ?? 0);
    if (v < SCHEMA_VERSION) {
      /* colunas novas entram por ALTER TABLE (bancos criados em versões anteriores continuam válidos) */
      this.ensureColumns('project', [
        ['type_id', 'TEXT'], ['language', 'TEXT'], ['target_seconds', 'REAL'], ['skill_name', 'TEXT'], ['route_name', 'TEXT'],
        ['plugins', 'TEXT'], ['scenes_with_media', 'INTEGER'], ['has_final', 'INTEGER'], ['runs', 'INTEGER'],
        ['last_run_at', 'TEXT'], ['last_run_ok', 'INTEGER'], ['total_ms', 'REAL'], ['cost_json', 'TEXT'],
      ]);
      /* v3: o hash passou a incluir cronômetro/vídeo final/mídias — reindexa tudo na próxima varredura
         (antes, o tempo de geração gravado no fim da execução não chegava ao índice: total_ms ficava 0) */
      if (v < 3) this.db.run('UPDATE project SET indexed_mtime = NULL, content_hash = NULL');
      this.db.run('PRAGMA user_version = ' + SCHEMA_VERSION);
      this.dirty = true;
    }
    const org = scalar(this.db, `SELECT id FROM org WHERE id = ?`, [this.orgId]);
    if (!org) {
      this.db.run(`INSERT INTO org (id, name, created_at) VALUES (?, ?, ?)`, [this.orgId, 'Local', nowIso()]);
      this.db.run(`INSERT INTO user (id, org_id, name, created_at) VALUES (?, ?, ?, ?)`, [this.userId, this.orgId, 'Local', nowIso()]);
      this.dirty = true;
    }
  }

  /** Caminho relativo ao workspace (portátil), quando dentro dele. */
  rel(file: string) { return relOrAbs(this.workspace, file); }

  /** Um projeto inteiro → linha do projeto + cenas + arquivos. Só grava/loga se o conteúdo mudou. */
  indexProject(p: Project, dir: string, o: { mtime?: number; silent?: boolean } = {}) {
    if (this.closed) return false;
    const projectDir = path.resolve(dir);
    const updated = String(p.updatedAt ?? p.createdAt ?? nowIso());
    const lastRun = p.production?.runs?.[(p.production?.runs?.length ?? 0) - 1];
    const scenesWithMedia = (p.scenes ?? []).filter((s) => Object.values(s.artifacts ?? {}).some((a) => (a?.length ?? 0) > 0)).length;
    const hasFinal = fs.existsSync(path.join(projectDir, 'out', 'final.mp4')) ? 1 : 0;
    /* o cronômetro de produção, o vídeo final e as mídias entram no hash: o fim da execução só muda esses campos
       (sem eles no hash, o tempo de geração nunca chegava ao índice e a lista mostrava "—") */
    const hash = sha1(JSON.stringify([
      p.name, p.idea ?? '', p.videoType, p.aspect ?? '', p.foldId ?? '', p.channelId ?? '', p.skill?.id ?? '', p.routeId ?? '',
      (p.scenes ?? []).map((s) => [s.id, s.title, s.narration, s.kind, s.durationSec, s.status]),
      p.production?.totalMs ?? 0, p.production?.runs?.length ?? 0, lastRun?.endedAt ?? '', hasFinal, scenesWithMedia,
    ]));
    const prev = scalar(this.db, `SELECT content_hash FROM project WHERE id = ?`, [p.id]) as string | undefined;
    if (prev === hash) {
      this.db.run(`UPDATE project SET indexed_mtime = ?, updated_at = ? WHERE id = ?`, [o.mtime ?? Date.now(), updated, p.id]);
      return false;
    }
    const seconds = Math.round((p.scenes ?? []).reduce((a, s) => a + (s.durationSec ?? 0), 0) * 100) / 100;
    const stage = (p.scenes ?? []).some((s) => Object.values(s.status).includes('running')) ? 'running'
      : (p.scenes ?? []).length && (p.scenes ?? []).every((s) => Object.values(s.status).every((x) => x === 'done' || x === 'skipped')) ? 'ready' : 'planning';
    const cost = (() => { try { return costProvider?.(p); } catch { return undefined; } })();
    this.transaction(() => {
      this.db.run(`
        INSERT INTO project (id, org_id, name, idea, video_type, aspect, created_at, updated_at, deleted_at, device_id, dir,
          skill_id, route_id, fold_id, channel_id, stage, scenes, seconds, indexed_mtime, content_hash,
          type_id, language, target_seconds, skill_name, route_name, plugins, scenes_with_media, has_final, runs,
          last_run_at, last_run_ok, total_ms, cost_json)
        VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, idea = excluded.idea, video_type = excluded.video_type, aspect = excluded.aspect,
          created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = NULL, device_id = excluded.device_id,
          dir = excluded.dir, skill_id = excluded.skill_id, route_id = excluded.route_id, fold_id = excluded.fold_id,
          channel_id = excluded.channel_id, stage = excluded.stage, scenes = excluded.scenes, seconds = excluded.seconds,
          indexed_mtime = excluded.indexed_mtime, content_hash = excluded.content_hash, type_id = excluded.type_id,
          language = excluded.language, target_seconds = excluded.target_seconds, skill_name = excluded.skill_name,
          route_name = excluded.route_name, plugins = excluded.plugins, scenes_with_media = excluded.scenes_with_media,
          has_final = excluded.has_final, runs = excluded.runs, last_run_at = excluded.last_run_at,
          last_run_ok = excluded.last_run_ok, total_ms = excluded.total_ms, cost_json = excluded.cost_json
      `, [p.id, this.orgId, p.name, p.idea ?? '', p.videoType ?? '', p.aspect ?? '', p.createdAt ?? nowIso(), updated,
        this.deviceId, relOrAbs(this.workspace, projectDir), p.skill?.id ?? p.skillId ?? '', p.routeId ?? '', p.foldId ?? '', p.channelId ?? '',
        stage, (p.scenes ?? []).length, seconds, o.mtime ?? Date.now(), hash,
        p.typeId ?? '', p.language ?? '', p.targetDurationSec ?? 0, p.skill?.name ?? '', p.route?.name ?? '',
        JSON.stringify(p.plugins ?? []), scenesWithMedia, hasFinal, p.production?.runs?.length ?? 0,
        lastRun?.endedAt ?? null, lastRun ? (lastRun.ok ? 1 : 0) : null, p.production?.totalMs ?? 0,
        cost ? JSON.stringify(cost) : null]);
      this.db.run(`DELETE FROM scene WHERE project_id = ?`, [p.id]);
      for (const [i, s] of (p.scenes ?? []).entries()) {
        const status = Object.entries(s.status ?? {}).map(([k, v]) => `${k}:${v}`).join(',');
        this.db.run(`INSERT INTO scene (id, project_id, idx, title, narration, kind, seconds, status, updated_at, deleted_at)
          VALUES (?,?,?,?,?,?,?,?,?,NULL)`, [s.id, p.id, i, s.title ?? '', s.narration ?? '', s.kind ?? '', s.durationSec ?? 0, status, updated]);
      }
      /* arquivos citados nos artefatos das cenas (sem hash por enquanto: o hash entra sob demanda) */
      for (const s of p.scenes ?? []) {
        for (const list of Object.values(s.artifacts ?? {})) {
          for (const f of list ?? []) this.upsertAsset(f, { projectId: p.id, role: 'scene' });
        }
      }
      this.log('project', p.id, prev ? 'update' : 'create', { name: p.name, scenes: (p.scenes ?? []).length, hash });
    });
    return true;
  }

  /** Arquivo por caminho; `sha256` fica nulo até alguém pedir (dedupe por hash em `ensureAsset`). */
  upsertAsset(file: string, o: { projectId?: string; role?: string } = {}) {
    if (this.closed) return;
    const abs = path.resolve(file);
    const rel = relOrAbs(this.workspace, abs);
    let bytes: number | null = null;
    try { bytes = fs.statSync(abs).size; } catch { /* arquivo ainda não existe */ }
    this.db.run(`INSERT INTO asset (org_id, path, sha256, project_id, bytes, mime, role, created_at, deleted_at)
      VALUES (?,?,NULL,?,?,?,?,?,NULL)
      ON CONFLICT(org_id, path) DO UPDATE SET project_id = excluded.project_id, bytes = excluded.bytes, role = excluded.role`,
      [this.orgId, rel, o.projectId ?? null, bytes, mimeOf(abs), o.role ?? null, nowIso()]);
    this.dirty = true;
  }

  /** Hash sob demanda: o mesmo logo em 40 projetos vira UM arquivo (e UM upload, na nuvem). */
  ensureAsset(file: string, o: { projectId?: string; role?: string } = {}): string | undefined {
    const abs = path.resolve(file);
    const rel = relOrAbs(this.workspace, abs);
    const known = scalar(this.db, `SELECT sha256 FROM asset WHERE org_id = ? AND path = ?`, [this.orgId, rel]) as string | null;
    if (known) return known;
    let sha: string;
    try { sha = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'); } catch { return undefined; }
    const bytes = (() => { try { return fs.statSync(abs).size; } catch { return null; } })();
    this.db.run(`INSERT INTO asset (org_id, path, sha256, project_id, bytes, mime, role, created_at, deleted_at)
      VALUES (?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(org_id, path) DO UPDATE SET sha256 = excluded.sha256, bytes = excluded.bytes, project_id = excluded.project_id`,
      [this.orgId, rel, sha, o.projectId ?? null, bytes, mimeOf(abs), o.role ?? null, nowIso()]);
    this.log('asset', sha, 'hash', { path: rel, bytes });
    this.dirty = true;
    this.scheduleFlush();
    return sha;
  }

  /** Lista os projetos sem abrir um JSON sequer (o índice responde). */
  listProjects(): Array<{ id: string; name: string; videoType?: string; createdAt: string; foldId?: string; channelId?: string }> {
    return this.all<{ id: string; name: string; video_type: string; created_at: string; fold_id: string; channel_id: string }>(
      `SELECT id, name, video_type, created_at, fold_id, channel_id FROM project WHERE deleted_at IS NULL ORDER BY created_at DESC`)
      .map((r) => ({ id: r.id, name: r.name, videoType: r.video_type, createdAt: r.created_at, foldId: r.fold_id || undefined, channelId: r.channel_id || undefined }));
  }

  /**
   * Linhas completas da aba Projetos: tudo o que a lista mostra sai daqui — sem `project.json` aberto.
   * O primeiro quadro (ffmpeg) e o "rodando" ficam com o main, que tem o cache e a fila.
   */
  listRows(running: Set<string> = new Set()) {
    return this.all<Record<string, unknown>>(`SELECT * FROM project WHERE deleted_at IS NULL ORDER BY created_at DESC`).map((r) => {
      const s = (k: string) => (r[k] === null || r[k] === undefined ? '' : String(r[k]));
      const n = (k: string) => (r[k] === null || r[k] === undefined ? 0 : Number(r[k]));
      const id = s('id'), hasFinal = !!r['has_final'], isRunning = running.has(id);
      const scenes = n('scenes'), runs = n('runs');
      const lastOk = r['last_run_ok'] === null || r['last_run_ok'] === undefined ? undefined : !!r['last_run_ok'];
      const dir = s('dir');
      return {
        id, name: s('name'), videoType: s('video_type') || 'custom', createdAt: s('created_at'), scenes,
        scenesWithMedia: n('scenes_with_media'), hasFinal, running: isRunning, totalMs: n('total_ms'),
        status: (isRunning ? 'running' : hasFinal ? 'done' : lastOk === false ? 'failed' : scenes > 0 || runs > 0 ? 'partial' : 'new') as 'running' | 'done' | 'failed' | 'partial' | 'new',
        runs, lastRunAt: s('last_run_at') || undefined, lastRunOk: lastOk, updatedAt: s('updated_at'),
        typeId: s('type_id') || undefined, language: s('language') || undefined,
        skillId: s('skill_id') || undefined, skillName: s('skill_name') || undefined, routeName: s('route_name') || undefined,
        aspect: s('aspect') || undefined, targetDurationSec: n('target_seconds') || undefined,
        dir: dir ? (path.isAbsolute(dir) ? dir : path.join(this.workspace, dir)) : undefined,
        plugins: (() => { try { const v = JSON.parse(s('plugins')); return Array.isArray(v) ? v : []; } catch { return []; } })(),
        cost: (() => { try { return s('cost_json') ? JSON.parse(s('cost_json')) : undefined; } catch { return undefined; } })(),
        firstFrame: null as string | null, frameFromFinal: false,
      };
    });
  }

  /**
   * Índice incremental: varre as PASTAS (leve) e só abre o project.json que mudou desde a última indexação.
   * Também marca como apagado o projeto cuja pasta sumiu (nada é apagado de verdade).
   */
  syncIndex(s: Settings, o: { log?: (l: string) => void } = {}): { added: number; updated: number; removed: number; total: number } {
    const dir = projectsDir(s);
    let added = 0, updated = 0, removed = 0;
    const seen = new Set<string>();
    let ids: string[] = [];
    try { ids = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name); } catch { /* sem projetos */ }
    for (const id of ids) {
      const file = path.join(dir, id, 'project.json');
      let mtime = 0;
      try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
      seen.add(id);
      const row = this.first<{ id: string; indexed_mtime: number | null }>(`SELECT id, indexed_mtime FROM project WHERE id = ?`, [id]);
      if (row?.indexed_mtime && mtime <= row.indexed_mtime + 1) continue;
      try {
        const p = JSON.parse(fs.readFileSync(file, 'utf8')) as Project;
        const pid = p.id || id;
        seen.add(pid);
        const isNew = !row;
        if (this.indexProject(p, path.join(dir, id), { mtime, silent: true })) {
          if (isNew) added++; else updated++;
        }
      } catch (e) { o.log?.(`banco: ${id} ignorado (${(e as Error).message.slice(0, 80)})`); }
    }
    /* projetos que existiam no índice e cuja pasta não está mais lá */
    for (const row of this.all<{ id: string }>(`SELECT id FROM project WHERE deleted_at IS NULL`)) {
      if (seen.has(row.id)) continue;
      if (!fs.existsSync(path.join(dir, row.id, 'project.json'))) { this.softDeleteProject(row.id); removed++; }
    }
    this.db.run(`INSERT INTO meta (key, value) VALUES ('indexed_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [nowIso()]);
    this.dirty = true;
    this.scheduleFlush();
    return { added, updated, removed, total: seen.size };
  }

  /** "Apagar" é marcar: a linha (e o change_log) sobrevive para a sincronia ressuscitar se preciso. */
  softDeleteProject(id: string) {
    this.transaction(() => {
      this.db.run(`UPDATE project SET deleted_at = ?, updated_at = ?, device_id = ? WHERE id = ?`, [nowIso(), nowIso(), this.deviceId, id]);
      this.log('project', id, 'delete', {});
    });
  }

  /** Arquivo de mudanças desde um seq (a fila do pull/push). */
  changesSince(seq = 0, limit = 5000): Array<Record<string, unknown>> {
    return this.all<Record<string, unknown>>(`SELECT seq, entity, entity_id, op, at, device_id, payload FROM change_log WHERE seq > ? ORDER BY seq LIMIT ?`, [seq, limit]);
  }

  recordRun(projectId: string, status: 'running' | 'done' | 'failed', o: { id?: string; step?: string; error?: string } = {}) {
    const id = o.id ?? `${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (status === 'running') {
      this.db.run(`INSERT INTO run (id, project_id, status, step, started_at) VALUES (?,?,?,?,?)`, [id, projectId, status, o.step ?? null, nowIso()]);
    } else {
      this.db.run(`UPDATE run SET status = ?, ended_at = ?, error = ? WHERE id = ?`, [status, nowIso(), o.error ?? null, id]);
    }
    this.dirty = true;
    this.scheduleFlush();
    return id;
  }

  /** Cópia de segurança: exporta o banco inteiro (VACUUM INTO) para backups/, mantém as 14 últimas. */
  backup(tag?: string) {
    fs.mkdirSync(this.backupsDir, { recursive: true });
    const d = new Date(), pad = (n: number) => String(n).padStart(2, '0');
    const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${tag ? `-${tag.replace(/[^\w-]/g, '')}` : ''}.db`;
    const file = path.join(this.backupsDir, name);
    writeDurable(file, Buffer.from(this.db.export()));
    const old = fs.readdirSync(this.backupsDir).filter((f) => f.endsWith('.db')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 14))) fs.rmSync(path.join(this.backupsDir, f), { force: true });
    return file;
  }

  /** Uma cópia por dia, feita ao abrir (não em pasta sincronizada). */
  private backupDaily() {
    try {
      const d = new Date(), pad = (n: number) => String(n).padStart(2, '0');
      const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      fs.mkdirSync(this.backupsDir, { recursive: true });
      if (fs.readdirSync(this.backupsDir).some((f) => f.startsWith(day))) return;
      this.backup('abertura');
    } catch { /* backup é opcional */ }
  }

  integrityCheck(): string {
    this.integrity = String(scalar(this.db, 'PRAGMA integrity_check') ?? 'ok');
    return this.integrity;
  }

  status(): DbStatus {
    const count = (t: string) => Number(scalar(this.db, `SELECT count(*) FROM ${t}`) ?? 0);
    return {
      path: this.file, size: (() => { try { return fs.statSync(this.file).size; } catch { return 0; } })(),
      projects: count('project'), scenes: count('scene'), assets: count('asset'), changes: count('change_log'),
      schema: Number(scalar(this.db, 'PRAGMA user_version') ?? 0), deviceId: this.deviceId, orgId: this.orgId,
      integrity: this.integrity, backups: (() => { try { return fs.readdirSync(this.backupsDir).filter((f) => f.endsWith('.db')).length; } catch { return 0; } })(),
    };
  }

  get restoredBackup() { return this.restoredFrom; }

  /** Grava agora (transação confirmada). */
  flushNow() {
    if (this.closed) return;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = undefined; }
    try { writeDurable(this.file, Buffer.from(this.db.export())); this.dirty = false; } catch (e) { logDb(`⚠ não consegui gravar o banco: ${(e as Error).message}`); }
  }

  private scheduleFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => { this.flushTimer = undefined; this.flushNow(); }, 350);
    this.flushTimer.unref?.();
  }

  close() {
    if (this.closed) return;
    this.flushNow();
    this.closed = true;
    try { this.db.close(); } catch { /* já fechou */ }
  }

  private transaction(fn: () => void) {
    this.db.run('BEGIN');
    try { fn(); this.db.run('COMMIT'); this.dirty = true; this.scheduleFlush(); }
    catch (e) { try { this.db.run('ROLLBACK'); } catch { /* */ } throw e; }
  }

  private log(entity: string, entityId: string, op: string, payload: Record<string, unknown>) {
    this.db.run(`INSERT INTO change_log (entity, entity_id, op, at, device_id, org_id, payload) VALUES (?,?,?,?,?,?,?)`,
      [entity, entityId, op, nowIso(), this.deviceId, this.orgId, JSON.stringify(payload)]);
    this.dirty = true;
  }

  private all<T>(sql: string, params: unknown[] = []): T[] {
    const st = this.db.prepare(sql);
    try {
      st.bind(params as never);
      const out: T[] = [];
      while (st.step()) out.push(st.getAsObject() as T);
      return out;
    } finally { st.free(); }
  }

  private first<T>(sql: string, params: unknown[] = []): T | undefined { return this.all<T>(sql, params)[0]; }

  /** Colunas que versões anteriores do banco não tinham (ALTER TABLE não falha duas vezes). */
  private ensureColumns(table: string, cols: Array<[string, string]>) {
    const have = new Set(this.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));
    for (const [name, type] of cols) if (!have.has(name)) this.db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

/* ───────── helpers ───────── */

function scalar(db: Database, sql: string, params: unknown[] = []): unknown {
  const st = db.prepare(sql);
  try {
    if (params.length) st.bind(params as never);
    return st.step() ? st.get()[0] : undefined;
  } finally { st.free(); }
}

function mimeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.srt': 'text/plain', '.ass': 'text/plain', '.json': 'application/json', '.html': 'text/html' };
  return map[ext] ?? 'application/octet-stream';
}

/** Escrita durável: tmp no mesmo volume + fsync + rename atômico. */
function writeDurable(file: string, data: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); }
  catch { fs.copyFileSync(tmp, file); try { fs.rmSync(tmp, { force: true }); } catch { /* */ } }
}

function readDeviceId(root: string): string {
  const file = path.join(root, 'device.id');
  try {
    const id = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9-]{8,64}$/i.test(id)) return id;
  } catch { /* cria agora */ }
  const id = crypto.randomUUID();
  try { fs.writeFileSync(file, id); } catch { /* */ }
  return id;
}

function latestBackup(root: string): string | undefined {
  try {
    const dir = path.join(root, 'backups');
    const list = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
    return list.length ? path.join(dir, list[list.length - 1]!) : undefined;
  } catch { return undefined; }
}

function logDb(line: string) { try { console.log(`[FilmForge] ${line}`); } catch { /* sem console */ } }

/* ───────── instância única (main abre; ops/testes chamam os helpers) ───────── */

let current: ForgeDb | undefined;

export const openDb = async (o: { root: string; workspace: string }) => {
  current?.close();
  current = await ForgeDb.open(o);
  return current;
};
export const getDb = (): ForgeDb | undefined => current;
export const closeDb = () => { current?.close(); current = undefined; };

/** Lista vinda do índice; sem banco aberto (testes/CLI), cai na varredura de sempre. */
export function listProjectsIndexed(s: Settings, fallback: () => Array<Pick<Project, 'id' | 'name' | 'videoType' | 'createdAt' | 'foldId' | 'channelId'>>) {
  const db = getDb();
  if (!db) return fallback();
  try { db.syncIndex(s); return db.listProjects() as ReturnType<typeof fallback>; }
  catch (e) { logDb(`banco indisponível para listar (${(e as Error).message.slice(0, 120)}) — usando as pastas`); return fallback(); }
}

/** Depois de salvar um projeto (ou uma cena), o índice e o change_log recebem a linha nova. */
export function indexProjectQuiet(s: Settings, p: Project) {
  const db = getDb();
  if (!db) return;
  try {
    const dir = projectDirOf(s, p.id);
    const mtime = (() => { try { return fs.statSync(path.join(dir, 'project.json')).mtimeMs; } catch { return Date.now(); } })();
    db.indexProject(p, dir, { mtime });
  } catch (e) { logDb(`índice do projeto ${p.id} falhou: ${(e as Error).message.slice(0, 120)}`); }
}
