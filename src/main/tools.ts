import { httpFetch } from './http';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectBins } from './ffmpeg';

/* Sem saber o sistema, o modelo local gastava rodadas procurando ffmpeg/python com `where`/`dir`. */
const SHELL_HINT = process.platform === 'win32'
  ? 'Sistema: Windows; o comando roda no cmd.exe (use dir, where, type; caminhos com espaço entre aspas: "C:\\Program Files"). ffmpeg e ffprobe do FilmForge já estão no PATH. Não procure programas pelo disco: se um comando falhar, mude de abordagem.'
  : 'Sistema: Unix; o comando roda no /bin/sh. ffmpeg e ffprobe do FilmForge já estão no PATH. Não procure programas pelo disco: se um comando falhar, mude de abordagem.';

/** Ambiente do comando: PATH com a pasta do ffmpeg embutido na frente (no Windows a chave costuma ser "Path"). */
export function toolEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, FORGE_TOOL: '1' };
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const ff = detectBins().ffmpeg;
  if (ff) env[key] = `${path.dirname(ff)}${path.delimiter}${env[key] ?? ''}`;
  return env;
}

/**
 * Ferramentas locais oferecidas aos harnesses HTTP (Ollama, llama.cpp, LM Studio).
 * O modelo "agêntico" passa a poder ler/gravar arquivos, acessar a internet,
 * pesquisar, chamar APIs REST e (opcionalmente) rodar comandos no projeto.
 *
 * Segurança: todo caminho é confinado às pastas liberadas (projeto + pasta da cena).
 */

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCtx {
  /** pastas onde leitura/escrita são permitidas */
  roots: string[];
  /** pasta de trabalho padrão (comandos e caminhos relativos) */
  workdir: string;
  log?: (line: string) => void;
  signal?: AbortSignal;
  allowShell?: boolean;
}

const spec = (name: string, description: string, parameters: Record<string, unknown>): ToolSpec => ({
  type: 'function', function: { name, description, parameters },
});

export const TOOL_SPECS: ToolSpec[] = [
  spec('list_files', 'Lista arquivos de uma pasta do projeto (recursivo opcional).', {
    type: 'object',
    properties: { path: { type: 'string', description: 'pasta relativa (vazio = raiz do projeto)' }, recursive: { type: 'boolean' } },
  }),
  spec('read_file', 'Lê um arquivo de texto do projeto (UTF-8).', {
    type: 'object', properties: { path: { type: 'string' } }, required: ['path'],
  }),
  spec('write_file', 'Cria ou sobrescreve um arquivo do projeto. Use para roteiro, scenes.json, HTML, código, legendas.', {
    type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } }, required: ['path', 'content'],
  }),
  spec('http_request', 'Faz uma requisição HTTP (GET/POST/PUT/DELETE) e devolve status + corpo. Serve para APIs REST.', {
    type: 'object',
    properties: { url: { type: 'string' }, method: { type: 'string' }, headers: { type: 'object' }, body: { type: 'string' } },
    required: ['url'],
  }),
  spec('web_search', 'Pesquisa na web (DuckDuckGo) e devolve título, link e resumo dos resultados.', {
    type: 'object', properties: { query: { type: 'string' }, count: { type: 'number' } }, required: ['query'],
  }),
  spec('run_command', `Executa um comando no sistema dentro da pasta do projeto. Saída limitada. ${SHELL_HINT}`, {
    type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeoutSec: { type: 'number' } }, required: ['command'],
  }),
];

const CAP_TEXT = 120_000;

function within(roots: string[], p: string): string {
  const abs = path.resolve(p);
  const ok = roots.some((r) => {
    const root = path.resolve(r);
    return abs === root || abs.startsWith(root + path.sep);
  });
  if (!ok) throw new Error(`caminho fora do projeto: ${p}`);
  return abs;
}

function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

async function httpRequest(args: { url?: string; method?: string; headers?: Record<string, string>; body?: string }, signal?: AbortSignal): Promise<string> {
  const url = String(args.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('url inválida (use http/https)');
  const method = (args.method ?? 'GET').toUpperCase();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);
  const onAbort = () => ac.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await fetch(url, { method, headers: { 'User-Agent': 'FilmForge/0.1 (+tools)', ...(args.headers ?? {}) }, body: method === 'GET' || method === 'HEAD' ? undefined : (args.body ?? ''), signal: ac.signal, redirect: 'follow' });
    const text = (await r.text()).slice(0, CAP_TEXT);
    return `${r.status} ${r.statusText}\n${text}`;
  } finally { clearTimeout(t); signal?.removeEventListener('abort', onAbort); }
}

async function webSearch(args: { query?: string; count?: number }, signal?: AbortSignal): Promise<string> {
  const q = String(args.query ?? '').trim();
  if (!q) throw new Error('query vazia');
  const n = Math.max(1, Math.min(10, Number(args.count) || 6));
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 45_000);
  const onAbort = () => ac.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // endpoint HTML do DuckDuckGo não exige chave
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FilmForge/0.1' }, signal: ac.signal,
    });
    if (!r.ok) throw new Error(`busca HTTP ${r.status}`);
    const html = await r.text();
    const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const out: string[] = [];
    const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < n) {
      let link = m[1] ?? '';
      try {
        const u = new URL(link);
        const target = u.searchParams.get('uddg'); if (target) link = target;
      } catch { /* mantém */ }
      out.push(`${out.length + 1}. ${strip(m[2] ?? '')}\n   ${link}${m[3] ? `\n   ${strip(m[3])}` : ''}`);
    }
    return out.length ? out.join('\n') : 'nenhum resultado encontrado';
  } finally { clearTimeout(t); signal?.removeEventListener('abort', onAbort); }
}

function shell(command: string, cwd: string, timeoutSec: number, signal?: AbortSignal, roots: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/d', '/s', '/c', command] : ['-lc', command], {
      cwd, windowsHide: true, env: toolEnv(),
    });
    let out = '';
    const cap = 40_000;
    const push = (d: Buffer) => { if (out.length < cap) out += d.toString(); };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    const timer = setTimeout(() => { try { child.kill(); } catch { /* já saiu */ } }, Math.max(5, Math.min(600, timeoutSec)) * 1000);
    const onAbort = () => { try { child.kill(); } catch { /* já saiu */ } };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(`${code === 0 ? 'ok' : `saiu com código ${code}`}\n${out.slice(0, cap)}`);
    });
  });
}

/** Executa uma ferramenta chamada pelo modelo e devolve o resultado em texto. */
export async function runTool(name: string, rawArgs: unknown, ctx: ToolCtx): Promise<string> {
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === 'string') { try { args = JSON.parse(rawArgs); } catch { args = {}; } }
  else if (rawArgs && typeof rawArgs === 'object') args = rawArgs as Record<string, unknown>;
  const roots = ctx.roots.length ? ctx.roots : [ctx.workdir];
  const log = (l: string) => ctx.log?.(l);
  try {
    switch (name) {
      case 'list_files': {
        const dir = within(roots, args.path ? path.resolve(ctx.workdir, String(args.path)) : ctx.workdir);
        const rec = !!args.recursive;
        const rows: string[] = [];
        const walk = (d: string, depth: number) => {
          if (depth > 4 || rows.length > 400) return;
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            const rel = path.relative(ctx.workdir, full) || '.';
            if (e.isDirectory()) { rows.push(`${rel}/`); if (rec) walk(full, depth + 1); }
            else rows.push(`${rel} (${fs.statSync(full).size} bytes)`);
          }
        };
        walk(dir, 0);
        log(`tool list_files ${path.relative(ctx.workdir, dir) || '.'}`);
        return rows.join('\n') || '(pasta vazia)';
      }
      case 'read_file': {
        const abs = within(roots, path.resolve(ctx.workdir, String(args.path ?? '')));
        const txt = fs.readFileSync(abs, 'utf8');
        log(`tool read_file ${path.relative(ctx.workdir, abs)}`);
        return txt.slice(0, CAP_TEXT);
      }
      case 'write_file': {
        const abs = within(roots, path.resolve(ctx.workdir, String(args.path ?? '')));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const content = asText(args.content);
        if (args.append) fs.appendFileSync(abs, content); else fs.writeFileSync(abs, content);
        log(`tool write_file ${path.relative(ctx.workdir, abs)} (${content.length} bytes)`);
        return `gravado: ${path.relative(ctx.workdir, abs)} (${content.length} bytes)`;
      }
      case 'http_request': {
        const out = await httpRequest(args as { url?: string }, ctx.signal);
        log(`tool http_request ${String(args.method ?? 'GET')} ${String(args.url ?? '')}`);
        return out;
      }
      case 'web_search': {
        const out = await webSearch(args as { query?: string }, ctx.signal);
        log(`tool web_search "${String(args.query ?? '')}"`);
        return out;
      }
      case 'run_command': {
        if (ctx.allowShell === false) return 'ferramenta desabilitada nas configurações';
        const cwd = args.cwd ? within(roots, path.resolve(ctx.workdir, String(args.cwd))) : ctx.workdir;
        log(`tool run_command (${path.relative(ctx.workdir, cwd) || '.'}): ${String(args.command ?? '')}`);
        return await shell(String(args.command ?? ''), cwd, Number(args.timeoutSec) || 120, ctx.signal, roots);
      }
      default:
        return `ferramenta desconhecida: ${name}`;
    }
  } catch (e) {
    return `erro: ${(e as Error).message}`;
  }
}

/** Lista legível das ferramentas (para a interface/log). */
export const toolNames = () => TOOL_SPECS.map((t) => t.function.name);
