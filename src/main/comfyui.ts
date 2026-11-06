import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import WebSocket from 'ws';
import type { ComfyServer } from '../shared/types';

type Json = Record<string, any>;

export class ComfyClient {
  readonly clientId = crypto.randomUUID();
  constructor(private server: ComfyServer) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.server.token ? { Authorization: `Bearer ${this.server.token}`, ...extra } : extra;
  }
  private url(p: string) { return this.server.url.replace(/\/+$/, '') + p; }

  async ping(): Promise<{ ok: boolean; info?: Json; error?: string }> {
    try {
      const r = await fetch(this.url('/system_stats'), { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return { ok: true, info: (await r.json()) as Json };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }

  async objectInfo(): Promise<Json> {
    const r = await fetch(this.url('/object_info'), { headers: this.headers() });
    if (!r.ok) throw new Error(`object_info HTTP ${r.status}`);
    return (await r.json()) as Json;
  }

  async upload(file: string): Promise<string> {
    const fd = new FormData();
    fd.append('image', new Blob([fs.readFileSync(file)]), path.basename(file));
    fd.append('overwrite', 'true');
    const r = await fetch(this.url('/upload/image'), { method: 'POST', body: fd, headers: this.headers() });
    if (!r.ok) throw new Error(`upload HTTP ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as Json;
    return j.subfolder ? `${j.subfolder}/${j.name}` : String(j.name);
  }

  async interrupt() {
    try { await fetch(this.url('/interrupt'), { method: 'POST', headers: this.headers() }); } catch { /* ignore */ }
  }
  async freeMemory() {
    try {
      await fetch(this.url('/free'), { method: 'POST', body: JSON.stringify({ unload_models: true, free_memory: true }),
        headers: this.headers({ 'Content-Type': 'application/json' }) });
    } catch { /* ignore */ }
  }

  async submit(workflow: Json): Promise<string> {
    const r = await fetch(this.url('/prompt'), {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });
    const j = (await r.json().catch(() => ({}))) as Json;
    if (!r.ok) {
      /* inclui os erros por nó (seed acima do máximo, modelo inexistente, input faltando…):
         sem isso o 400 vira só "Prompt outputs failed validation". */
      const details = j.node_errors && Object.keys(j.node_errors).length ? j.node_errors : (j.error ?? j);
      throw new Error(`ComfyUI /prompt HTTP ${r.status}: ${JSON.stringify(details).slice(0, 1200)}`);
    }
    return String(j.prompt_id);
  }

  /** Aguarda via polling de /history (+ WebSocket opcional só para progresso). */
  async waitFor(promptId: string, signal: AbortSignal, onProgress?: (pct: number) => void): Promise<Json> {
    let ws: WebSocket | undefined;
    try {
      ws = new WebSocket(this.url('/ws').replace(/^http/, 'ws') + `?clientId=${this.clientId}`,
        { headers: this.headers() });
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        try {
          const m = JSON.parse(data.toString()) as Json;
          if (m.type === 'progress' && m.data?.max) onProgress?.(Math.round((m.data.value / m.data.max) * 100));
        } catch { /* ignore */ }
      });
      ws.on('error', () => { /* progresso é opcional */ });
    } catch { /* sem ws */ }
    const onAbort = () => { void this.interrupt(); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      for (;;) {
        if (signal.aborted) throw new Error('abortado');
        const r = await fetch(this.url(`/history/${promptId}`), { headers: this.headers(), signal });
        if (r.ok) {
          const h = (await r.json()) as Json;
          const entry = h[promptId];
          if (entry) {
            const st = entry.status;
            if (st?.status_str === 'error') {
              const msg = (st.messages as any[] | undefined)?.find((m) => m[0] === 'execution_error')?.[1];
              throw new Error(`ComfyUI execution_error: ${msg?.exception_message ?? 'desconhecido'}`);
            }
            if (st?.completed || entry.outputs) return entry;
          }
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      try { ws?.close(); } catch { /* ignore */ }
    }
  }

  async download(f: { filename: string; subfolder?: string; type?: string }, dest: string) {
    const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' });
    const r = await fetch(this.url('/view?' + q.toString()), { headers: this.headers() });
    if (!r.ok) throw new Error(`view HTTP ${r.status}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  }
}

/** Substitui {{var}} em strings e aplica mapping "nodeId.inputs.campo" -> variável. */
export function applyVariables(workflow: Json, vars: Record<string, string | number>, mapping?: Record<string, string>): Json {
  const wf = JSON.parse(JSON.stringify(workflow)) as Json;
  const sub = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const whole = /^\{\{(\w+)\}\}$/.exec(v);
      if (whole && whole[1]! in vars) return vars[whole[1]!];
      return v.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : _m));
    }
    if (Array.isArray(v)) return v.map(sub);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]));
    return v;
  };
  const out = sub(wf) as Json;
  for (const [pathStr, varName] of Object.entries(mapping ?? {})) {
    if (!(varName in vars)) continue;
    const parts = pathStr.split('.');
    let cur: any = out;
    for (let i = 0; i < parts.length - 1; i++) { cur = cur?.[parts[i]!]; if (!cur) break; }
    if (cur) cur[parts[parts.length - 1]!] = vars[varName];
  }
  return out;
}

export interface ComfyOutputFile { filename: string; subfolder?: string; type?: string; kind: string }

export function collectOutputs(entry: Json, outputNode?: string): ComfyOutputFile[] {
  const files: ComfyOutputFile[] = [];
  const outputs = (entry.outputs ?? {}) as Json;
  for (const [nodeId, o] of Object.entries(outputs)) {
    if (outputNode && nodeId !== outputNode) continue;
    for (const kind of ['images', 'gifs', 'videos', 'audio']) {
      for (const f of ((o as Json)[kind] ?? []) as Json[]) {
        if (f.type === 'temp') continue;
        files.push({ filename: f.filename, subfolder: f.subfolder, type: f.type, kind });
      }
    }
  }
  return files;
}

/** Nomes de {{variáveis}} usadas no workflow. */
export function placeholders(workflow: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') for (const m of v.matchAll(/\{\{(\w+)\}\}/g)) found.add(m[1]!);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(workflow);
  return [...found];
}

/** Workflows exportados no formato de interface (com "nodes") não podem ser enviados à API /prompt. */
export function isUiFormat(workflow: unknown): boolean {
  return !!workflow && typeof workflow === 'object' && Array.isArray((workflow as Json).nodes);
}
