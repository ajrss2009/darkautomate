import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChannelCloneResult } from './channel-clone';

/*
 * Armazenamento dos canais clonados.
 *
 * Hoje: arquivos locais em <workspace>/channels/<id>/ (result.json + thumbnails, quadros, folhas de contato,
 * banner, thumb e demo). Amanhã: um banco na nuvem — por isso tudo passa por `CloneStore`, e cada registro
 * leva esquema versionado, revisão e estado de sincronização. Uma implementação remota só precisa cumprir a
 * mesma interface (list/get/save/remove + pacote) e usar `sync.remoteId/rev/dirty` para resolver conflitos.
 *
 * Portabilidade: caminhos dentro da pasta do clone são gravados RELATIVOS ("./thumbs/01.jpg"), então a pasta
 * pode mudar de disco/PC; e o pacote .ffclone leva o clone inteiro (sem os vídeos baixados) para outro FilmForge.
 */

export const CLONE_SCHEMA = 2;
export const CLONE_KIND = 'filmforge.channelClone';

export interface CloneRecordMeta {
  schemaVersion: number;
  kind: typeof CLONE_KIND;
  updatedAt: string;
  appVersion?: string;
  /** para a futura sincronização com a nuvem */
  sync: { rev: number; dirty: boolean; remoteId?: string; syncedAt?: string };
}
export type StoredClone = ChannelCloneResult & { meta?: CloneRecordMeta };

export interface CloneStore {
  list(): StoredClone[];
  get(id: string): StoredClone | undefined;
  save(r: ChannelCloneResult): StoredClone;
  remove(id: string): void;
  exportPackage(id: string, file: string): string;
  importPackage(file: string): StoredClone;
}

const SAFE = /^[\w.-]{1,120}$/;

/** Caminhos absolutos dentro de `dir` → "./relativo" (e o contrário). */
export function relativize<T>(v: T, dir: string): T {
  const base = path.resolve(dir), low = base.toLowerCase();
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') { const l = x.toLowerCase(); return l.startsWith(low + '\\') || l.startsWith(low + '/') ? './' + x.slice(base.length + 1).replace(/\\/g, '/') : x; }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v) as T;
}
export function absolutize<T>(v: T, dir: string): T {
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return x.startsWith('./') && !x.includes('..') ? path.join(dir, ...x.slice(2).split('/')) : x;
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v) as T;
}

const tarExe = () => { const t = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'; return fs.existsSync(t) ? t : 'tar'; };

export class LocalCloneStore implements CloneStore {
  constructor(private readonly root: string, private readonly appVersion?: string) {}

  private dirOf(id: string) { if (!SAFE.test(id)) throw new Error(`id de clone inválido: ${id}`); return path.join(this.root, id); }

  private read(dir: string): StoredClone | undefined {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')) as StoredClone;
      /* registros antigos (esquema 1) tinham caminhos absolutos; a pasta real manda */
      const r = absolutize(raw, dir);
      r.dir = dir; r.id = path.basename(dir);
      return r;
    } catch { return undefined; }
  }

  list(): StoredClone[] {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root).map((d) => this.read(path.join(this.root, d))).filter((x): x is StoredClone => !!x)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string) { return this.read(this.dirOf(id)); }

  save(r: ChannelCloneResult): StoredClone {
    const dir = this.dirOf(r.id);
    fs.mkdirSync(dir, { recursive: true });
    const prev = this.read(dir)?.meta;
    const meta: CloneRecordMeta = { schemaVersion: CLONE_SCHEMA, kind: CLONE_KIND, updatedAt: new Date().toISOString(), appVersion: this.appVersion,
      sync: { rev: (prev?.sync.rev ?? 0) + 1, dirty: true, remoteId: prev?.sync.remoteId, syncedAt: prev?.sync.syncedAt } };
    const out: StoredClone = { ...r, dir, meta };
    const tmp = path.join(dir, 'result.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(relativize({ ...out, dir: '.' }, dir), null, 2));
    try { fs.renameSync(tmp, path.join(dir, 'result.json')); } catch { fs.copyFileSync(tmp, path.join(dir, 'result.json')); fs.rmSync(tmp, { force: true }); }
    return out;
  }

  remove(id: string) { fs.rmSync(this.dirOf(id), { recursive: true, force: true }); }

  /** Pacote portátil (.ffclone = zip da pasta do clone, sem os vídeos baixados). */
  exportPackage(id: string, file: string): string {
    const dir = this.dirOf(id);
    if (!fs.existsSync(path.join(dir, 'result.json'))) throw new Error('clone não encontrado');
    const entries = fs.readdirSync(dir).filter((e) => e !== 'videos' && !e.endsWith('.tmp'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.rmSync(file, { force: true });
    const r = spawnSync(tarExe(), ['--format', 'zip', '-cf', file, '-C', dir, ...entries], { encoding: 'utf8', windowsHide: true, timeout: 300_000 });
    if (r.status !== 0 || !fs.existsSync(file)) throw new Error(`não consegui gravar o pacote: ${(r.stderr || r.error?.message || '').slice(0, 200)}`);
    return file;
  }

  /** Importa um .ffclone: vira um clone local (id novo se já existir um igual). */
  importPackage(file: string): StoredClone {
    if (!fs.existsSync(file)) throw new Error('arquivo não encontrado');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-clone-'));
    try {
      const x = spawnSync(tarExe(), ['-xf', file, '-C', tmp], { encoding: 'utf8', windowsHide: true, timeout: 300_000 });
      if (x.status !== 0) throw new Error(`pacote inválido: ${(x.stderr || '').slice(0, 200)}`);
      const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'result.json'), 'utf8')) as StoredClone;
      if (raw.meta && raw.meta.kind !== CLONE_KIND) throw new Error('o arquivo não é um clone de canal do FilmForge');
      let id = SAFE.test(raw.id) ? raw.id : `clone-${Date.now()}`, k = 2;
      while (fs.existsSync(path.join(this.root, id))) id = `${raw.id}-${k++}`;
      const dest = path.join(this.root, id);
      fs.mkdirSync(this.root, { recursive: true });
      fs.cpSync(tmp, dest, { recursive: true });
      const r = this.read(dest);
      if (!r) throw new Error('pacote sem result.json válido');
      /* importado = cópia local nova (a sincronização com a nuvem decide depois) */
      return this.save({ ...r, id, warnings: [...(r.warnings ?? []), `importado de ${path.basename(file)} em ${new Date().toLocaleString()}`] });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
}
