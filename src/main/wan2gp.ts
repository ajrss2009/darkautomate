import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Wan2gpConfig } from '../shared/types';

const TAG = '@@FORGE@@ ';
type Msg = { id: number | null; ok?: boolean; ready?: boolean; error?: string; errors?: string[]; files?: string[]; unknownKeys?: string[]; models?: unknown; defaults?: unknown; cancelled?: boolean };

export interface GenerateResult { files: string[]; unknownKeys: string[] }

/** Cliente da ponte Python (processo persistente: o modelo fica carregado entre cenas). */
export class Wan2gpClient {
  private static pool = new Map<string, Wan2gpClient>();
  private proc?: ChildProcessWithoutNullStreams;
  private buf = '';
  private nextId = 1;
  private waiting = new Map<number, (m: Msg) => void>();
  private chain: Promise<unknown> = Promise.resolve();   // serializa as requisições (1 GPU)
  private readyP?: Promise<void>;
  private log: (l: string) => void = () => {};
  private errTail: string[] = [];

  private constructor(private cfg: Wan2gpConfig, private bridge: string) {}

  static get(cfg: Wan2gpConfig, bridge: string): Wan2gpClient {
    const key = `${cfg.python}|${cfg.root}|${cfg.cliArgs.join(' ')}`;
    let c = Wan2gpClient.pool.get(key);
    if (!c) { c = new Wan2gpClient(cfg, bridge); Wan2gpClient.pool.set(key, c); }
    return c;
  }
  static shutdownAll() { for (const c of Wan2gpClient.pool.values()) c.stop(); Wan2gpClient.pool.clear(); }

  private start(): Promise<void> {
    if (this.readyP && this.proc && this.proc.exitCode === null) return this.readyP;
    if (!this.cfg.root || !fs.existsSync(this.cfg.root)) return Promise.reject(new Error('pasta do Wan2GP não configurada (Provedores → wan2gp.root)'));
    if (!fs.existsSync(this.bridge)) return Promise.reject(new Error(`ponte não encontrada: ${this.bridge}`));
    const args = [this.bridge, '--root', this.cfg.root, ...this.cfg.cliArgs.map((a) => `--cli-arg=${a}`)];
    const proc = spawn(this.cfg.python, args, { cwd: this.cfg.root, env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } });
    this.proc = proc; this.buf = '';
    this.readyP = new Promise<void>((resolve, reject) => {
      this.waiting.set(0, (m) => (m.ready ? resolve() : reject(new Error(m.error ?? 'Wan2GP não iniciou'))));
      proc.on('error', (e) => reject(new Error(`não foi possível executar "${this.cfg.python}": ${e.message}`)));
    });
    proc.stdout.on('data', (d: Buffer) => this.onData(d.toString('utf8')));
    proc.stderr.on('data', (d: Buffer) => { for (const l of d.toString('utf8').split('\n')) if (l.trim()) { this.log(l.trim().slice(0, 300)); this.errTail = [...this.errTail, l.trim().slice(0, 300)].slice(-5); } });
    proc.on('close', (code) => {
      for (const [, cb] of this.waiting) { const m = `Wan2GP encerrou (código ${code})${this.errTail.length ? ': ' + this.errTail.join(' | ') : ''}`; cb({ id: null, ok: false, errors: [m], error: m }); }
      this.waiting.clear(); this.proc = undefined; this.readyP = undefined;
    });
    return this.readyP;
  }

  private onData(chunk: string) {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1);
      if (!line.startsWith(TAG)) { if (line.trim()) this.log(line.trim().slice(0, 300)); continue; }
      try {
        const m = JSON.parse(line.slice(TAG.length)) as Msg;
        const key = m.id ?? 0;
        const cb = this.waiting.get(key);
        if (cb) { this.waiting.delete(key); cb(m); }
      } catch { /* linha inválida */ }
    }
  }

  private request(msg: Record<string, unknown>, signal?: AbortSignal): Promise<Msg> {
    const run = async (): Promise<Msg> => {
      await this.start();
      if (signal?.aborted) throw new Error('cancelado');
      const id = this.nextId++;
      return new Promise<Msg>((resolve, reject) => {
        const onAbort = () => { this.proc?.stdin.write(JSON.stringify({ op: 'cancel' }) + '\n'); };
        signal?.addEventListener('abort', onAbort, { once: true });
        this.waiting.set(id, (m) => { signal?.removeEventListener('abort', onAbort); resolve(m); });
        this.proc!.stdin.write(JSON.stringify({ ...msg, id }) + '\n', (e) => { if (e) reject(e); });
      });
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async generate(modelType: string, settings: Record<string, unknown>, signal: AbortSignal, log: (l: string) => void): Promise<GenerateResult> {
    this.log = log;
    const r = await this.request({ op: 'generate', model_type: modelType, settings }, signal);
    if (r.cancelled || signal.aborted) throw new Error('cancelado');
    if (!r.ok || !r.files?.length) throw new Error(`Wan2GP: ${(r.errors?.length ? r.errors : [r.error ?? 'sem arquivos gerados']).join('; ')}`);
    return { files: r.files, unknownKeys: r.unknownKeys ?? [] };
  }
  async models(): Promise<unknown> { const r = await this.request({ op: 'models' }); if (!r.ok) throw new Error((r.errors ?? [r.error]).join('; ')); return r.models; }
  async defaults(modelType: string): Promise<unknown> { const r = await this.request({ op: 'defaults', model_type: modelType }); if (!r.ok) throw new Error((r.errors ?? [r.error]).join('; ')); return r.defaults; }
  stop() { try { this.proc?.stdin.write(JSON.stringify({ op: 'quit' }) + '\n'); this.proc?.kill(); } catch { /* ignore */ } }
}

export const bridgePath = (toolsDir: string) => path.join(toolsDir, 'wan2gp_bridge.py');
