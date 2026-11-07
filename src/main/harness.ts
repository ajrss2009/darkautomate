import { httpFetch } from './http';
import { stripMarks, strictSplit } from '../shared/strict';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import type { HarnessBinding, HarnessConfig, HarnessId, ReasoningEffort, Settings } from '../shared/types';
import { effortWireValue } from '../shared/effort';
import { runTool, TOOL_SPECS, toolNames } from './tools';

export const DEFAULT_HARNESSES: Record<HarnessId, HarnessConfig> = {
  claude: {
    command: 'claude',
    args: ['-p', '--model', '{model}', '--output-format', 'text', '--permission-mode', 'acceptEdits'],
    promptVia: 'stdin',
    defaultModel: 'sonnet',
    models: ['opus', 'sonnet', 'haiku'],
    note: 'Claude Code. Prompt via stdin; edite se sua versão usar flags diferentes.',
  },
  codex: {
    command: 'codex',
    args: ['exec', '--model', '{model}', '--full-auto', '--skip-git-repo-check', '{prompt}'],
    promptVia: 'arg',
    models: [],
    note: 'OpenAI Codex CLI (`codex exec`). Deixe o modelo vazio para usar o padrão.',
  },
  opencode: {
    command: 'opencode',
    args: ['run', '--model', '{model}', '--auto'],
    /* prompt por stdin: com plugin ativo o pedido passa de 10k caracteres e, na linha de comando,
       antivírus corporativos (Apex One/Trend Micro, regra FLS.LDX) matam o processo do FilmForge */
    promptVia: 'stdin',
    models: [],
    note: 'OpenCode (`opencode run --auto`). Prompt por stdin (evita linha de comando gigante com plugins). Modelo no formato provider/model, ex.: ollama/qwen3. Se o comando não estiver no PATH, o FilmForge usa o CLI embutido no OpenCode Desktop.',
  },
  antigravity: {
    command: 'agy',
    args: ['--model', '{model}', '--mode', 'accept-edits', '--dangerously-skip-permissions', '--print', '{prompt}'],
    promptVia: 'arg',
    models: ['gemini-4-argon-medium', 'gemini-4-argon-high', 'gemini-4-argon-low', 'gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low',
      'claude-opus-5-5-low', 'claude-opus-5-5-medium', 'claude-opus-5-5-high', 'claude-sonnet-5-5-low', 'claude-sonnet-5-5-medium', 'claude-sonnet-5-5-high', 'gpt-oss-120b-medium'],
    note: 'Antigravity CLI (`agy`). O prompt vai em --print (último argumento) com --mode accept-edits e sem pedir permissões, para rodar sozinho. Modelos: use "Consultar modelos" (executa `agy models`).',
  },
  ollama: {
    command: 'http://127.0.0.1:11434',
    args: [],
    promptVia: 'stdin',
    protocol: 'ollama',
    tools: true,
    models: [],
    note: 'Ollama (HTTP). Com "Ferramentas" ligadas o modelo pode ler/gravar arquivos, acessar a internet, pesquisar, chamar APIs REST e rodar comandos no projeto (útil para modelos agênticos como qwen3, llama3.3, mistral).',
  },
  llamacpp: {
    command: 'http://127.0.0.1:8080',
    args: [],
    promptVia: 'stdin',
    protocol: 'openai',
    tools: true,
    models: [],
    note: 'llama.cpp server (HTTP, compatível com OpenAI: /v1/chat/completions). Inicie com `llama-server -m modelo.gguf --port 8080`. Modelos com suporte a tools (ex.: Qwen3, Llama 3.3) usam as ferramentas.',
  },
  lmstudio: {
    command: 'http://127.0.0.1:1234',
    args: [],
    promptVia: 'stdin',
    protocol: 'openai',
    tools: true,
    models: [],
    note: 'LM Studio (HTTP, servidor local compatível com OpenAI: /v1/chat/completions). Ligue o servidor em Developer → Start Server. Modelos que suportam tools usam as ferramentas.',
  },
  deepseek: {
    command: 'dsh',
    args: ['--profile', 'headless', '-'],
    promptVia: 'stdin',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    /* headless não tem quem aprove: sem isto o agente para no primeiro comando (como o --dangerously-skip-permissions do agy) */
    env: { DSH_PERMISSION_MODE: 'danger-full-access' },
    note: 'DeepSeek Harness (`dsh --profile headless`, agente com arquivos, PowerShell, Python e Node). Usa a conta logada no app DeepSeek Harness. Se o comando não estiver no PATH, o FilmForge usa o CLI de dentro da instalação. O modelo da rota entra por --patch (padrão do perfil: deepseek-flash).',
  },
  openclaw: {
    command: 'openclaw',
    args: ['agent', '--message', '{prompt}'],
    promptVia: 'arg',
    models: [],
    note: 'CONFIGURE: valide o subcomando não interativo da sua versão do OpenClaw (use o botão Testar).',
  },
};

/** Nome lógico do harness a partir do comando (para mapear o valor de esforço). */
function harnessKindOf(cfg: HarnessConfig): string | undefined {
  const c = cfg.command.trim().toLowerCase();
  if (/(^|[\\/])claude(\.exe|\.cmd|\.bat)?$/.test(c) || /\bclaude\b/.test(c)) return 'claude';
  if (/(^|[\\/])codex(\.exe|\.cmd|\.bat)?$/.test(c) || /\bcodex\b/.test(c)) return 'codex';
  if (/(^|[\\/])agy(\.exe|\.cmd|\.bat)?$/.test(c) || /antigravity/.test(c)) return 'antigravity';
  return undefined;
}

/** Monta argv: remove o par "--flag {model}" quando não há modelo. */
export function buildArgs(cfg: HarnessConfig, prompt: string, model?: string, effort?: ReasoningEffort): string[] {
  const out: string[] = [];
  const m = model || cfg.defaultModel;
  const e = effort ?? cfg.effort;
  const ev = e ? effortWireValue(harnessKindOf(cfg), e) : '';
  for (let i = 0; i < cfg.args.length; i++) {
    const a = cfg.args[i]!;
    if (a === '{model}') {
      if (m) out.push(m);
      else if (out.length > 0 && out[out.length - 1]!.startsWith('-')) out.pop();
      continue;
    }
    if (a === '{effort}') {
      if (ev) out.push(ev);
      else if (out.length > 0 && out[out.length - 1]!.startsWith('-')) out.pop();
      continue;
    }
    out.push(a.replace('{prompt}', prompt).replace('{model}', m ?? '').replace('{effort}', ev));
  }
  return out;
}

/**
 * Adiciona a flag de esforço sem exigir que o usuário edite os argumentos.
 * Assim configurações antigas (sem `{effort}`) também funcionam.
 */
function injectEffort(cfg: HarnessConfig, args: string[], effort?: ReasoningEffort): string[] {
  if (!effort) return args;
  if (args.some((a) => a === '--effort' || a === 'model_reasoning_effort' || /^model_reasoning_effort=/.test(a))) return args;
  const cmd = path.basename(cfg.command.trim()).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
  const value = effortWireValue(harnessKindOf(cfg), effort);
  if (cmd === 'claude') return ['--effort', value, ...args];
  if (cmd === 'agy' || /antigravity/i.test(cmd)) {
    const at = args.findIndex((a) => a === '--print' || a === '-p');
    return at < 0 ? [...args, '--effort', value] : [...args.slice(0, at), '--effort', value, ...args.slice(at)];
  }
  if (cmd === 'codex') {
    const at = args.findIndex((a) => a === 'exec');
    const i = at < 0 ? 0 : at + 1;
    return [...args.slice(0, i), '-c', `model_reasoning_effort=${value}`, ...args.slice(i)];
  }
  return args;
}

const isWin = process.platform === 'win32';

/**
 * Precisa de shell? Só para atalhos .cmd/.bat (shims do npm). Executáveis .exe
 * rodam direto — e isso é essencial: o cmd.exe interpreta a linha de comando na
 * página de código do console e quebra prompts com acentos (pt-BR).
 */
/** Com shell (cmd.exe), caminho com espaço vai entre aspas (ex.: ...\Programs\DeepSeek Harness\...\dsh.cmd). */
const shellCommand = (command: string, viaShell: boolean) => (viaShell && /\s/.test(command) && !/^".*"$/.test(command) ? `"${command}"` : command);

/** DeepSeek Harness (`dsh`): o CLI não tem --model; o modelo da rota vai num patch YAML do perfil (--patch). */
export function dshModelArgs(cfg: HarnessConfig, model: string | undefined, dir = os.tmpdir()): string[] {
  const m = (model || cfg.defaultModel || '').trim();
  if (!isDsh(cfg) || !m || !/^[\w.:/-]+$/.test(m)) return [];
  const file = path.join(dir, `filmforge-dsh-model-${m.replace(/[^\w.-]/g, '_')}.yml`);
  fs.writeFileSync(file, `- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: ${m}\n`);
  return ['--patch', file];
}
const isDsh = (cfg: HarnessConfig) => /(^|[\\/])dsh(\.cmd|\.exe)?"?$/i.test(cfg.command.trim()) || /deepseek harness/i.test(cfg.command);

function shellFor(command: string): boolean {
  if (!isWin) return false;
  const c = command.trim();
  if (/\.(cmd|bat)$/i.test(c)) return true;
  if (/\.(exe|com)$/i.test(c)) return false;
  if (/[\\/]/.test(c)) return false;
  try {
    const r = spawnSync('where.exe', [c], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const first = (r.stdout ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] ?? '';
    return /\.(cmd|bat)$/i.test(first);
  } catch { return true; }
}

/**
 * Caminhos conhecidos de CLIs que vêm empacotadas dentro de apps desktop.
 * O comando "opencode" frequentemente não está no PATH (o OpenCode Desktop
 * traz o binário dentro da própria instalação).
 */
const KNOWN_COMMAND_PATHS: Record<string, string[]> = {
  antigravity: [
    ...(isWin ? [
      path.join(process.env.LOCALAPPDATA ?? 'C:\\', 'agy', 'bin', 'agy.exe'),
      path.join(process.env.LOCALAPPDATA ?? 'C:\\', 'Programs', 'agy', 'bin', 'agy.exe'),
      path.join(process.env.USERPROFILE ?? '', '.local', 'bin', 'agy.exe'),
      path.join(process.env.APPDATA ?? '', 'npm', 'agy.cmd'),
    ] : []),
    ...(process.platform === 'darwin' ? ['/usr/local/bin/agy', '/opt/homebrew/bin/agy', path.join(process.env.HOME ?? '', '.local', 'bin', 'agy')] : []),
    ...(process.platform === 'linux' ? [path.join(process.env.HOME ?? '', '.local', 'bin', 'agy'), '/usr/local/bin/agy', '/usr/bin/agy'] : []),
  ],
  dsh: [
    ...(isWin ? [path.join(process.env.LOCALAPPDATA ?? 'C:\\', 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')] : []),
    ...(process.platform === 'darwin' ? ['/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'] : []),
  ],
  opencode: [
    ...(isWin ? [
      path.join(process.env.LOCALAPPDATA ?? 'C:\\', 'Programs', '@opencodedesktop', 'resources', 'opencode-cli.exe'),
      path.join(process.env.APPDATA ?? '', 'npm', 'opencode.cmd'),
      path.join(process.env.USERPROFILE ?? '', '.bun', 'bin', 'opencode.exe'),
      path.join(process.env.USERPROFILE ?? '', 'scoop', 'shims', 'opencode.exe'),
    ] : []),
    ...(process.platform === 'darwin' ? [
      '/Applications/OpenCode.app/Contents/Resources/opencode-cli',
      '/opt/homebrew/bin/opencode',
      '/usr/local/bin/opencode',
    ] : []),
    ...(process.platform === 'linux' ? [
      path.join(process.env.HOME ?? '', '.opencode', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/usr/bin/opencode',
    ] : []),
  ],
};

/** Mensagens que o shell (cmd.exe) devolve quando o comando não existe. */
const NOT_FOUND_OUTPUT = /(n[ãa]o\s+[ée]\s+reconhecido|not\s+recognized|command\s+not\s+found|no\s+such\s+file|n[ãa]o\s+foi\s+encontrado)/i;

/** O comando existe de fato (arquivo ou PATH)? Evita confundir o erro do shell com "instalado". */
export function commandExists(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  if (/^https?:\/\//i.test(cmd)) return true;
  if (/[\\/]/.test(cmd)) {
    try { return fs.existsSync(cmd); } catch { return false; }
  }
  try {
    const probe = isWin ? 'where.exe' : 'which';
    const r = spawnSync(probe, [cmd], { encoding: 'utf8', timeout: 8000, shell: false, windowsHide: true });
    return r.status === 0;
  } catch { return false; }
}

/** Comando real a executar: o configurado ou, se ausente, um caminho conhecido do app desktop. */
export function resolveHarnessCommand(cfg: HarnessConfig): { command: string; found: boolean } {
  if (isHttpHarness(cfg)) return { command: cfg.command, found: true };
  if (commandExists(cfg.command)) return { command: cfg.command, found: true };
  const base = path.basename(cfg.command.trim()).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
  for (const candidate of KNOWN_COMMAND_PATHS[base] ?? []) {
    try { if (candidate && fs.existsSync(candidate)) return { command: candidate, found: true }; } catch { /* ignora */ }
  }
  return { command: cfg.command, found: false };
}

export function detectHarness(cfg: HarnessConfig): { installed: boolean; version?: string; error?: string } {
  // harness HTTP (Ollama) não tem "--version": quem responde é detectHarnessAsync
  if (isHttpHarness(cfg)) return { installed: false, error: 'harness HTTP: verificação assíncrona' };
  const cmd = resolveHarnessCommand(cfg);
  if (!cmd.found) return { installed: false, error: `"${cfg.command.trim()}" não encontrado no PATH` };
  try {
    const r = spawnSync(shellCommand(cmd.command, isWin), ['--version'], { encoding: 'utf8', timeout: 8000, shell: isWin, windowsHide: true });
    if (r.error) return { installed: false, error: r.error.message };
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim();
    const first = out.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
    // o shell imprime o erro de "comando não encontrado" em stderr e sai != 0:
    // isso NUNCA pode contar como harness instalado.
    if (NOT_FOUND_OUTPUT.test(out)) return { installed: false, error: first };
    const looksLikeVersion = /\bv?\d+\.\d+/.test(first);
    const ok = r.status === 0 || looksLikeVersion;
    const via = cmd.command !== cfg.command.trim() ? ` (${cmd.command})` : '';
    return { installed: ok, version: ok ? `${first}${via}` : undefined, error: ok ? undefined : (first || `saiu com código ${r.status}`) };
  } catch (e) { return { installed: false, error: (e as Error).message }; }
}

export const isHttpHarness = (cfg: HarnessConfig) => /^https?:\/\//i.test(cfg.command.trim());
const baseUrl = (cfg: HarnessConfig) => cfg.command.trim().replace(/\/+$/, '');
/** Chave de API (DeepSeek e outros OpenAI-compatíveis na nuvem); servidores locais não têm. */
const authHeaders = (cfg: HarnessConfig): Record<string, string> => (cfg.apiKey?.trim() ? { Authorization: `Bearer ${cfg.apiKey.trim()}` } : {});
/** API do harness HTTP: ollama (/api/chat) ou OpenAI-compatível (/v1/chat/completions). */
export const protocolOf = (cfg: HarnessConfig): 'ollama' | 'openai' => (cfg.protocol === 'openai' ? 'openai' : 'ollama');

/** Modelos do servidor HTTP (Ollama: /api/tags · llama.cpp/LM Studio: /v1/models). */
export async function httpModels(cfg: HarnessConfig, signal: AbortSignal = AbortSignal.timeout(5000)): Promise<string[]> {
  if (protocolOf(cfg) === 'ollama') {
    const r = await fetch(`${baseUrl(cfg)}/api/tags`, { signal });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    return (((await r.json()) as any).models ?? []).map((m: any) => String(m.name));
  }
  const r = await fetch(`${baseUrl(cfg)}/v1/models`, { signal, headers: authHeaders(cfg) });
  if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 401 ? ' — chave de API ausente ou inválida' : ''}`);
  return (((await r.json()) as any).data ?? []).map((m: any) => String(m.id));
}

/** Mantido para compatibilidade (Ollama). */
export const ollamaModels = (cfg: HarnessConfig, signal?: AbortSignal) => httpModels(cfg, signal);

/** Detecção que também serve para harnesses HTTP (Ollama, llama.cpp, LM Studio). */
export async function detectHarnessAsync(cfg: HarnessConfig): Promise<{ installed: boolean; version?: string; error?: string }> {
  if (isHttpHarness(cfg)) {
    try { const m = await httpModels(cfg); return { installed: true, version: `${m.length} modelo(s)` }; }
    catch (e) { return { installed: false, error: (e as Error).message }; }
  }
  return detectHarness(cfg);
}

/** `agy models` devolve "id<TAB>Rótulo" por linha (o aviso "Fetching…" vai para stderr). */
export function parseAgyModels(text: string): string[] {
  return text.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(fetching|usage|error|available|flag)/i.test(l))
    .map((l) => l.split(/[\t ]+/)[0]!.trim())
    .filter((l) => /^[a-z0-9][a-z0-9._:-]*$/i.test(l));
}

/** Lista modelos disponíveis ("Consultar modelos"). */
export async function listHarnessModels(cfg: HarnessConfig): Promise<string[]> {
  if (isHttpHarness(cfg)) return httpModels(cfg);
  if (/\bagy\b|antigravity/i.test(cfg.command)) {
    const cmd = resolveHarnessCommand(cfg);
    if (cmd.found) {
      const r = spawnSync(cmd.command, ['models'], { encoding: 'utf8', timeout: 60_000, shell: isWin, windowsHide: true });
      const list = parseAgyModels(`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
      if (list.length) return list;
    }
  }
  if (/opencode/i.test(cfg.command)) {
    const cmd = resolveHarnessCommand(cfg);
    if (!cmd.found) return cfg.models;
    const r = spawnSync(cmd.command, ['models'], { encoding: 'utf8', timeout: 20000, shell: isWin, windowsHide: true });
    if (r.status === 0) return (r.stdout ?? '').split('\n').map((x) => x.trim()).filter((x) => x.includes('/'));
  }
  return cfg.models;
}

export const AUTO_ORDER: HarnessId[] = ['claude', 'antigravity', 'codex', 'opencode', 'deepseek', 'openclaw', 'ollama', 'lmstudio', 'llamacpp'];
const autoCache = new Map<string, { at: number; id: HarnessId | null }>();

/** Resolve harness 'auto' (primeiro disponível) e modelo 'auto' (padrão do harness). */
/** Ordem do "auto": reservas da rota/projeto, depois as padrão das Configurações, depois AUTO_ORDER (sem repetir). */
export function autoOrder(settings: Pick<Settings, 'harnessFallback'>, routeFallback?: HarnessId[]): HarnessId[] {
  return [...new Set([...(routeFallback ?? []), ...(settings.harnessFallback ?? []), ...AUTO_ORDER])];
}

export async function resolveHarness(settings: Settings, b: HarnessBinding, routeFallback?: HarnessId[]): Promise<{ id: HarnessId; cfg: HarnessConfig; model?: string }> {
  let id: HarnessId | null = b.harness === 'auto' ? null : b.harness;
  if (!id) {
    const order = autoOrder(settings, routeFallback);
    const key = JSON.stringify([order, Object.entries(settings.harnesses).map(([k, v]) => [k, v.command])]);
    const c = autoCache.get(key);
    if (c && Date.now() - c.at < 30000 && c.id) id = c.id;
    else {
      const reasons: string[] = [];
      for (const cand of order) {
        const cfg = settings.harnesses[cand];
        if (!cfg) continue;
        const d = await detectHarnessAsync(cfg);
        if (d.installed) { id = cand; break; }
        reasons.push(`${cand}: ${d.error ?? 'indisponível'}`);
      }
      autoCache.set(key, { at: Date.now(), id });
      if (!id) throw new Error(`harness "auto": nenhum harness instalado/alcançável — ${reasons.join(' · ')} (Configurações → Harnesses)`);
    }
  }
  const cfg = settings.harnesses[id];
  if (!cfg) throw new Error(`harness "${id}" não configurado`);
  let model = !b.model || b.model === 'auto' ? undefined : b.model;
  if (!model && isHttpHarness(cfg) && !cfg.defaultModel) model = (await httpModels(cfg).catch(() => []))[0];
  return { id, cfg, model };
}

const ollamaParamsCache = new Map<string, Set<string>>();
/** Nomes dos parâmetros que o Modelfile do modelo já define (temperature, top_k…), via /api/show. */
export async function ollamaModelParams(cfg: HarnessConfig, model: string): Promise<Set<string>> {
  const key = `${baseUrl(cfg)}|${model}`;
  const hit = ollamaParamsCache.get(key);
  if (hit) return hit;
  let names = new Set<string>();
  try {
    const r = await fetch(`${baseUrl(cfg)}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(5000) });
    if (r.ok) names = new Set(String(((await r.json()) as { parameters?: string }).parameters ?? '').split('\n').map((l) => l.trim().split(/\s+/)[0]!).filter(Boolean));
  } catch { /* sem resposta: usa os padrões do FilmForge */ }
  ollamaParamsCache.set(key, names);
  return names;
}

/** Uma rodada de chat no harness HTTP. */
async function httpChat(
  cfg: HarnessConfig, model: string, messages: unknown[], tools: unknown[] | undefined, signal: AbortSignal,
  effort?: ReasoningEffort, numCtx = 24576, think?: boolean, sampling?: Record<string, number>,
  /** decodificação guiada: a resposta só pode ser um JSON neste esquema (Ollama "format"; llama.cpp/LM Studio "response_format") */
  schema?: object,
): Promise<{ ok: boolean; error?: string; warning?: string; text: string; message: any }> {
  const proto = protocolOf(cfg);
  const url = proto === 'ollama' ? `${baseUrl(cfg)}/api/chat` : `${baseUrl(cfg)}/v1/chat/completions`;
  const body: Record<string, unknown> = { model, stream: false, messages };
  if (tools?.length) body.tools = tools;
  // Só o protocolo OpenAI recebe reasoning_effort; Max vira xhigh nos modelos
  // que usam esse vocabulário (GPT-5.2/o-series/Codex).
  if (effort && proto === 'openai') body.reasoning_effort = effort === 'max' ? 'xhigh' : effort;
  /* Modelos locais no Ollama precisam de contexto/tokens suficientes: o prompt de
     cena por código + o HTML gerado passam fácil de 4k e a resposta vinha vazia. */
  if (proto === 'ollama') {
    /* 8192 cortava páginas HTML inteiras escritas dentro de um write_file: a chamada de ferramenta chegava
       truncada, o Ollama a rejeitava e a etapa perdia as ferramentas. Metade da janela vai para a resposta. */
    body.options = { num_ctx: numCtx, num_predict: ollamaPredict(numCtx) };
    /* temperatura do Modelfile (ex.: qwen3.5-3d-coder pede 0.7): forçar 0.2 num modelo pequeno o fazia
       repetir até o Ollama abortar ("token repeat limit reached"). Sem ela no modelo, 0.2. */
    if (!(await ollamaModelParams(cfg, model)).has('temperature')) (body.options as Record<string, unknown>).temperature = 0.2;
    /* opções da chamada (ex.: anti-repetição numa nova tentativa depois de um laço) vencem o Modelfile */
    if (sampling) Object.assign(body.options as Record<string, unknown>, sampling);
    /* modelos que "pensam" (qwen3, gemma, deepseek-r1) gastam o num_predict no raciocínio e a resposta
       vinha cortada (done_reason=length) ou vazia. Desligado por padrão; cfg.think=true religa. */
    if (think !== undefined) body.think = think;
    if (schema) body.format = schema;
    body.stream = true;
    return ollamaChatStream(url, body, signal);
  }
  /* servidor local (llama.cpp, LM Studio): páginas inteiras passam de 8k tokens, e a 40 t/s levam mais de 5 min —
     o fetch do Node desistia em 5 min sem cabeçalho (UND_ERR_HEADERS_TIMEOUT); node:http não tem esse limite */
  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i.test(url);
  body.max_tokens = local ? 16384 : 8192;
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'saida', strict: true, schema } };
  if (sampling && local) Object.assign(body, sampling);   // llama-server aceita repeat_penalty/frequency_penalty no corpo
  const fail = (status: number, text: string) => ({ ok: false, error: `HTTP ${status}${status === 401 ? ' (chave de API ausente ou inválida)' : status === 402 ? ' (saldo insuficiente na conta da API)' : ''}: ${text.slice(0, 400)}`, text: '', message: {} });
  const done = (j: any) => {
    const ch = j?.choices?.[0] ?? {};
    const msg = ch.message ?? {};
    return { ok: true, text: String(msg.content ?? ''), message: msg,
      warning: ch.finish_reason === 'length' ? `resposta cortada no limite de tokens (max_tokens ${body.max_tokens}) — o arquivo pode estar incompleto` : undefined };
  };
  if (local) {
    const r = await postJsonLocal(url, body, { ...authHeaders(cfg) }, signal);
    if (r.error) return { ok: false, error: r.error, text: '', message: {} };
    if (r.status >= 400) return fail(r.status, r.text);
    try { return done(JSON.parse(r.text)); } catch { return { ok: false, error: `resposta inválida do servidor: ${r.text.slice(0, 200)}`, text: '', message: {} }; }
  }
  try {
    const r = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) }, body: JSON.stringify(body) });
    if (!r.ok) return fail(r.status, await r.text());
    return done(await r.json());
  } catch (e) {
    return { ok: false, error: netError(e), text: '', message: {} };
  }
}

/** POST JSON por node:http, sem limite de tempo próprio (o fim fica com o timeout da etapa, pelo signal). */
function postJsonLocal(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal): Promise<{ status: number; text: string; error?: string }> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, signal }, (res) => {
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { t += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: t }));
      res.on('error', (e) => resolve({ status: 0, text: '', error: netError(e) }));
    });
    req.on('error', (e) => resolve({ status: 0, text: '', error: signal.aborted ? abortMessage(signal, 'abortado') : netError(e) }));
    req.end(JSON.stringify(body));
  });
}

/** "fetch failed" não diz nada: inclui o código da causa (ECONNREFUSED, UND_ERR_HEADERS_TIMEOUT…). */
function netError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string }; code?: string };
  const code = err.cause?.code ?? err.code;
  const hint = code === 'ECONNREFUSED' ? ' — o servidor local não está rodando (abra o Ollama)'
    : /HEADERS_TIMEOUT|BODY_TIMEOUT/.test(code ?? '') ? ' — o modelo demorou mais de 5 min para responder'
    : '';
  return `${err.message}${code ? ` (${code})` : ''}${hint}`;
}

/**
 * Modelo em laço: o fim do texto é o mesmo bloco de linhas repetido muitas vezes, mudando só os números
 * (visto: "const settle = smoothstep(12.84, 12.92, t); …" 135 vezes). Exige bloco com texto de verdade
 * (≥ 60 caracteres) e ≥ 12 voltas seguidas, para não pegar código legítimo como uma série de lineTo. Função pura.
 */
export function repetitionLoop(text: string, minReps = 12): { reps: number; sample: string } | undefined {
  const raw = text.split('\n').slice(-400, -1).map((l) => l.trim()).filter(Boolean);   // a última linha pode estar pela metade
  const find = (norm: string[], min: number, minChars: number, rawChars = 0, minIds = 0) => {
    for (let k = 1; k <= 20; k++) {
      if (norm.length < k * min) break;
      const block = norm.slice(-k).join('\n');
      if (block.replace(/[#\s]/g, '').length < minChars || raw.slice(-k).join('').length < rawChars) continue;
      /* lista de dados (visto: legendas palavra a palavra {"w":"…","start":…}) não é laço: o bloco tem de ter código */
      if ((block.match(/\bw\b/g)?.length ?? 0) < minIds) continue;
      let reps = 1;
      while ((reps + 1) * k <= norm.length && norm.slice(-(reps + 1) * k, -reps * k).join('\n') === block) reps++;
      if (reps >= min) return { reps, sample: raw.slice(-k).join(' ').slice(0, 160) };
    }
    return undefined;
  };
  /* 0) laço numa linha só (visto: "…globalCompositeOperation='source-over';ctx.globalAlpha=…;" sem quebra de linha):
     o fim do texto é periódico — o mesmo pedaço de 30–600 caracteres, minReps vezes seguidas */
  const tail = text.slice(-12_000).replace(/-?\d+(?:\.\d+)?/g, '#');
  for (let p = 30; p <= 600 && p * minReps <= tail.length; p++) {
    const seg = tail.slice(-p * minReps);
    if (seg.slice(p) !== seg.slice(0, -p) || seg.slice(-p).replace(/[#\s]/g, '').length < 20) continue;
    let reps = minReps;
    while ((reps + 1) * p <= tail.length && tail.slice(-(reps + 1) * p, -reps * p) === tail.slice(-p)) reps++;
    return { reps, sample: text.slice(-p).replace(/\s+/g, ' ').trim().slice(0, 160) };
  }
  /* 1) só os números mudam; 2) nomes também mudam (visto: "const jjj3={…r:4830…}; const kkk3={…r:4870…}") —
     a forma da linha é a mesma: exige mais voltas e linhas longas, para não pegar tabelas de dados normais */
  return find(raw.map((l) => l.replace(/-?\d+(?:\.\d+)?/g, '#')), minReps, 60)
    ?? find(raw.map((l) => l.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '§').replace(/[A-Za-z_$][\w$]*/g, 'w').replace(/\d+(?:\.\d+)?|\.\d+/g, '#')), minReps * 2, 20, 100, 3);
}

/**
 * /api/chat do Ollama em streaming, por node:http.
 * Com stream:false o Ollama só manda o cabeçalho quando termina de gerar, e o fetch do Node desiste
 * em 5 min (UND_ERR_HEADERS_TIMEOUT → "fetch failed") — comum em modelo grande, contexto de 48k ou
 * cenas em paralelo disputando a GPU. node:http não tem esse limite; o fim fica com o timeout da etapa.
 */
function ollamaChatStream(url: string, body: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; error?: string; warning?: string; text: string; message: any }> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    let content = '', thinking = '', buf = '', doneReason = '', streamErr = '', settled = false, checkedAt = 0;
    const toolCalls: any[] = [];
    const finish = (r: { ok: boolean; error?: string; warning?: string; text: string; message: any }) => { if (!settled) { settled = true; resolve(r); } };
    const onLine = (line: string) => {
      if (!line.trim()) return;
      let j: any;
      try { j = JSON.parse(line); } catch { return; }
      if (j.error) { streamErr = String(j.error); return; }
      const m = j.message ?? {};
      if (typeof m.content === 'string') content += m.content;
      if (typeof m.thinking === 'string') thinking += m.thinking;
      if (Array.isArray(m.tool_calls)) toolCalls.push(...m.tool_calls);
      if (j.done) doneReason = String(j.done_reason ?? '');
      /* laço com números diferentes a cada volta: a trava do Ollama não pega e o modelo iria até o num_predict */
      if (content.length + thinking.length - checkedAt >= 1500) {
        checkedAt = content.length + thinking.length;
        const loop = repetitionLoop(content) ?? repetitionLoop(thinking);
        if (loop) { req.destroy(); finish({ ok: false, error: `o modelo entrou em laço: repetiu ${loop.reps}× o mesmo trecho (só os números mudam) — geração interrompida. Trecho: ${loop.sample}`, text: content, message: {} }); }
      }
    };
    const req = lib.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal }, (res) => {
      res.setEncoding('utf8');
      if ((res.statusCode ?? 0) >= 400) {
        let t = '';
        res.on('data', (d: string) => { t += d; });
        res.on('end', () => finish({ ok: false, error: `HTTP ${res.statusCode}: ${t.slice(0, 400)}`, text: '', message: {} }));
        return;
      }
      res.on('data', (d: string) => { buf += d; const lines = buf.split('\n'); buf = lines.pop() ?? ''; lines.forEach(onLine); });
      res.on('end', () => {
        onLine(buf);
        if (streamErr) return finish({ ok: false, error: streamErr, text: '', message: {} });
        const message = { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
        /* o modelo pensou até o limite e não chegou a responder */
        if (!content.trim() && !toolCalls.length && thinking.trim())
          return finish({ ok: false, error: `o modelo gastou todo o limite de tokens raciocinando (thinking ${thinking.length} caracteres) e não respondeu — desligue "pensar" ou use um modelo sem raciocínio`, text: '', message });
        finish({ ok: true, text: content, message, warning: doneReason === 'length' ? `resposta cortada no limite de tokens (num_predict ${String((body.options as { num_predict?: number } | undefined)?.num_predict ?? '?')}) — o arquivo pode estar incompleto` : undefined });
      });
      res.on('error', (e) => finish({ ok: false, error: netError(e), text: '', message: {} }));
    });
    req.on('error', (e) => finish({ ok: false, error: signal.aborted ? abortMessage(signal, 'abortado') : netError(e), text: '', message: {} }));
    req.end(JSON.stringify(body));
  });
}

/** tool_calls do Ollama (arguments objeto) ou do OpenAI (arguments string) num formato só. */
function normalizeToolCalls(message: any): Array<{ id: string; name: string; args: unknown }> {
  const list = Array.isArray(message?.tool_calls) ? message.tool_calls : Array.isArray(message?.toolCalls) ? message.toolCalls : [];
  return list.map((c: any, i: number) => ({
    id: String(c?.id ?? `call_${i}`),
    name: String(c?.function?.name ?? c?.name ?? ''),
    args: c?.function?.arguments ?? c?.arguments ?? {},
  }));
}

/**
 * Harness HTTP com ferramentas: arquivos, internet, busca, REST e comandos.
 * O modelo pede a ferramenta, o FilmForge executa dentro do projeto e devolve
 * o resultado; o laço segue até o modelo responder sem pedir mais nada.
 */
async function runHttp(
  cfg: HarnessConfig,
  opts: { cwd: string; prompt: string; model?: string; effort?: ReasoningEffort; signal: AbortSignal; onLine?: (l: string) => void; tools?: { roots: string[]; allowShell?: boolean }; images?: string[]; sampling?: Record<string, number>; schema?: object },
): Promise<HarnessRun> {
  let model = opts.model || cfg.defaultModel || (await httpModels(cfg).catch(() => []))[0];
  if (!model) return { ok: false, stdout: '', stderr: 'harness HTTP: nenhum modelo disponível (baixe um modelo no Ollama/LM Studio ou carregue no llama.cpp)', code: 1 };
  const effort = opts.effort ?? cfg.effort;
  const proto = protocolOf(cfg);
  const wanted = cfg.tools !== false && !!opts.tools;
  let useTools = wanted;
  /* imagens (quadros, thumbnails) para modelos locais com visão: o CLI abre os arquivos sozinho, o HTTP precisa recebê-las */
  const imgs = (opts.images ?? []).filter((f) => { try { return fs.statSync(f).size < 4_000_000; } catch { return false; } }).slice(0, 16)
    .map((f) => ({ b64: fs.readFileSync(f).toString('base64'), mime: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg' }));
  if (imgs.length) opts.onLine?.(`${imgs.length} imagem(ns) enviada(s) ao modelo local (precisa de um modelo com visão: gemma3, qwen2.5vl, llava…)`);
  /* MODO ESTRITO (padrão nos locais): regras da skill/plugins/API e exemplos no PROMPT DE SISTEMA, em tags XML, com ordens
     imperativas; a tarefa isolada em <task>. Modelos pequenos priorizam o sistema e param de inventar API. */
  const split = cfg.strict !== false ? strictSplit(opts.prompt) : undefined;
  const userText = split ? split.user : stripMarks(opts.prompt);
  if (split) opts.onLine?.('modo estrito: regras da skill, dos plugins e da API no prompt de sistema (o modelo só pode usar o que está lá)');
  const first: any = !imgs.length ? { role: 'user', content: userText }
    : proto === 'ollama' ? { role: 'user', content: userText, images: imgs.map((i) => i.b64) }
    : { role: 'user', content: [{ type: 'text', text: userText }, ...imgs.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))] };
  const messages: any[] = split ? [{ role: 'system', content: split.system }, first] : [first];
  /* decodificação guiada: com esquema, a resposta é o próprio JSON (sem ferramentas) */
  let schema = opts.schema;
  if (schema) opts.onLine?.('decodificação guiada: a resposta só pode ser JSON no esquema da etapa');
  /* janela de contexto: o Ollama descarta as mensagens mais antigas quando a conversa passa do num_ctx —
     e a primeira é o pedido (o template do modelo falha com "no user query found"). Por isso a janela
     acompanha o tamanho do pedido e os resultados antigos de ferramentas são resumidos antes de estourar. */
  /* num_ctx diferente do da chamada anterior faz o Ollama RECARREGAR o modelo (segundos, e com cenas em
     paralelo um derruba o outro): a janela só cresce, por servidor+modelo. */
  const ctxKey = `${baseUrl(cfg)}|${model}`;
  const ctx = cfg.numCtx ?? Math.max(ollamaCtx(opts.prompt.length), stickyCtx.get(ctxKey) ?? 0);
  stickyCtx.set(ctxKey, ctx);
  let think: boolean | undefined = proto === 'ollama' ? (cfg.think ?? false) : undefined;
  const budget = Math.max(12_000, (ctx - 8192 - (wanted ? 1500 : 0)) * 3);
  const clipAt = Math.max(4_000, Math.min(24_000, Math.floor(budget / 4)));
  const transcript: string[] = [];
  let usedTools = false;
  /* modelos locais pequenos/muito comprimidos entram em laço repetindo a MESMA chamada
     (ex.: `cmd /c "dir /b C:\ProgramFiles"` dez vezes). Conta cada chamada normalizada. */
  const seen = new Map<string, number>();
  let blocked = 0, ctxWarned = false;
  if (wanted) opts.onLine?.(`ferramentas instaladas: ${toolNames().join(', ')}`);
  for (let round = 0; round < 30; round++) {
    if (opts.signal.aborted) return { ok: false, stdout: transcript.join('\n'), stderr: abortMessage(opts.signal, 'abortado'), code: null };
    if (fitContext(messages, budget) && round > 0 && !ctxWarned) { ctxWarned = true; opts.onLine?.('contexto do modelo local quase cheio — resultados antigos de ferramentas resumidos'); }
    let res = await httpChat(cfg, model, messages, useTools ? TOOL_SPECS : undefined, opts.signal, effort, ctx, think, opts.sampling, schema);
    /* laço: nenhuma das repetições abaixo (sem ferramentas, outro modelo…) resolve; o trecho parcial vai no stdout */
    if (!res.ok && /^o modelo entrou em laço/.test(res.error ?? '')) return { ok: false, stdout: [...transcript, res.text].join('\n'), stderr: res.error!, code: null };
    /* modelo padrão apagado do servidor (HTTP 404 "model ... not found"): usa um instalado em vez de
       derrubar a etapa para o próximo provedor da cadeia */
    if (!res.ok && round === 0 && /model .*not found|not found.*model/i.test(res.error ?? '')) {
      const installed = await httpModels(cfg).catch(() => [] as string[]);
      const alt = cfg.models.find((m) => m !== model && installed.includes(m)) ?? installed.find((m) => m !== model);
      if (alt) {
        opts.onLine?.(`⚠ o modelo "${model}" não existe mais neste servidor — usando "${alt}" (ajuste o modelo padrão em Provedores)`);
        model = alt;
        res = await httpChat(cfg, model, messages, useTools ? TOOL_SPECS : undefined, opts.signal, effort, ctx, think, opts.sampling, schema);
      }
    }
    // Ollama antigo ou servidor que não conhece "think": repete sem o campo
    if (!res.ok && think !== undefined && /think/i.test(res.error ?? '')) {
      think = undefined;
      res = await httpChat(cfg, model, messages, useTools ? TOOL_SPECS : undefined, opts.signal, effort, ctx, think, opts.sampling, schema);
    }
    /* servidor que não aceita esquema (versão antiga): segue sem ele — o executor ainda valida o JSON gravado */
    if (!res.ok && schema && /format|schema|response_format|grammar|400|422/i.test(res.error ?? '')) {
      schema = undefined;
      opts.onLine?.(`este servidor não aceitou a decodificação guiada — seguindo sem ela (${(res.error ?? '').slice(0, 160)})`);
      res = await httpChat(cfg, model, messages, useTools ? TOOL_SPECS : undefined, opts.signal, effort, ctx, think, opts.sampling, schema);
    }
    if (!res.ok && /no user query|user query/i.test(res.error ?? '')) {
      /* o pedido caiu da janela mesmo assim: resume tudo o que é antigo e tenta de novo */
      fitContext(messages, Math.floor(budget / 2));
      opts.onLine?.('o pedido não coube na janela do modelo local — resumindo o histórico e repetindo');
      res = await httpChat(cfg, model, messages, useTools ? TOOL_SPECS : undefined, opts.signal, effort, ctx, think, opts.sampling, schema);
    }
    // modelo/servidor sem suporte a tools: segue sem elas em vez de falhar
    if (!res.ok && useTools && /tool|function|400|422/i.test(res.error ?? '')) {
      useTools = false;
      opts.onLine?.(`este modelo não aceitou ferramentas — seguindo sem elas (${(res.error ?? '').slice(0, 200)})`);
      res = await httpChat(cfg, model, messages, undefined, opts.signal, effort, ctx, think, opts.sampling, schema);
    }
    // modelo/servidor que não conhece reasoning_effort: repete sem o parâmetro
    if (!res.ok && effort && /reason|effort|thinking|400|422/i.test(res.error ?? '')) {
      opts.onLine?.('este modelo não aceitou o esforço de raciocínio — seguindo com o padrão');
      res = await httpChat(cfg, model, messages, useTools ? TOOL_SPECS : undefined, opts.signal, undefined, ctx, think, opts.sampling, schema);
    }
    if (res.warning) opts.onLine?.(`⚠ ${res.warning}`);
    if (!res.ok) return { ok: false, stdout: transcript.join('\n'), stderr: res.error ?? 'falhou', code: null };
    if (res.text.trim()) transcript.push(res.text.trim());
    const calls = useTools ? normalizeToolCalls(res.message) : [];
    if (!calls.length) {
      const out = transcript.join('\n').trim();
      /* modelos locais frequentemente escrevem o arquivo pela ferramenta e terminam
         com conteúdo vazio. Ter usado ferramentas já é sucesso (o executor valida o
         arquivo esperado logo depois); antes isso virava "resposta vazia". */
      const ok = out.length > 0 || usedTools;
      return { ok, stdout: out, stderr: ok ? '' : 'resposta vazia', code: ok ? 0 : 1 };
    }
    usedTools = true;
    messages.push({ role: 'assistant', content: res.text, tool_calls: res.message.tool_calls ?? res.message.toolCalls });
    for (const call of calls) {
      const key = toolCallKey(call.name, call.args);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      let result: string;
      if (n > 2) {
        blocked++;
        opts.onLine?.(`⚠ chamada repetida bloqueada (${n}ª vez): ${call.name}`);
        result = `BLOQUEADO: você já chamou ${call.name} com estes mesmos argumentos ${n - 1} vezes e o resultado não muda. ` +
          'NÃO repita. Use o que já descobriu, tente outra abordagem ou termine com a resposta final.';
      } else {
        result = await runTool(call.name, call.args, {
          roots: opts.tools!.roots, workdir: opts.cwd, log: opts.onLine, signal: opts.signal, allowShell: opts.tools!.allowShell,
        });
      }
      const clipped = result.length > clipAt ? result.slice(0, clipAt) + '\n…(truncado para caber no contexto do modelo)' : result;
      if (proto === 'ollama') messages.push({ role: 'tool', tool_name: call.name, content: clipped });
      else messages.push({ role: 'tool', tool_call_id: call.id, content: clipped });
    }
    if (blocked >= REPEAT_ABORT)
      return { ok: false, stdout: transcript.join('\n'), code: 1,
        stderr: `o modelo ${model} entrou em laço repetindo a mesma ferramenta (${blocked} chamadas bloqueadas) — ` +
          'use um modelo maior ou menos comprimido (ex.: quantização Q4 em vez de IQ2) ou outro provedor nesta etapa' };
  }
  return { ok: false, stdout: transcript.join('\n'), stderr: 'limite de 30 rodadas de ferramentas', code: 1 };
}

/** Chamadas repetidas e bloqueadas antes de desistir da execução. */
const REPEAT_ABORT = 6;

/** Identidade de uma chamada de ferramenta, sem diferenças de aspas, espaços e maiúsculas (função pura). */
export function toolCallKey(name: string, args: unknown): string {
  let a = args;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { /* texto cru */ } }
  const raw = typeof a === 'string' ? a : JSON.stringify(a ?? {});
  return `${name}|${raw.toLowerCase().replace(/\\"|["']/g, '').replace(/\s+/g, ' ').trim()}`;
}

const stickyCtx = new Map<string, number>();

/** Limite de tokens da resposta no Ollama: metade da janela, entre 8k e 24k (função pura). */
export const ollamaPredict = (numCtx: number): number => Math.min(24_576, Math.max(8192, Math.floor(numCtx / 2)));

/** Janela do Ollama pelo tamanho do pedido (~3 caracteres/token + espaço para ferramentas e resposta), de 24k a 48k (função pura). */
export function ollamaCtx(promptChars: number): number {
  const need = Math.ceil(promptChars / 3) + 20_000;
  return Math.min(49_152, Math.max(24_576, Math.ceil(need / 4096) * 4096));
}

const msgChars = (m: any) => (typeof m?.content === 'string' ? m.content.length : JSON.stringify(m?.content ?? '').length) + 20;
/**
 * Mantém a conversa dentro do orçamento (caracteres): resume primeiro os resultados de ferramentas das rodadas
 * anteriores; se ainda não couber, os da última rodada, menos o mais recente. Nunca o pedido (1ª mensagem).
 * Devolve true se resumiu algo (função pura sobre a lista).
 */
export function fitContext(messages: any[], budget: number): boolean {
  let total = messages.reduce((n, m) => n + msgChars(m), 0);
  let changed = false;
  const lastAssistant = messages.map((m) => m?.role).lastIndexOf('assistant');
  const shrink = (upTo: number) => {
    for (let i = 1; i < upTo && total > budget; i++) {
      const m = messages[i];
      if (m?.role !== 'tool' || typeof m.content !== 'string' || m.content.length <= 600) continue;
      const short = `${m.content.slice(0, 400)}\n…(resultado antigo resumido para caber no contexto; leia de novo se precisar)`;
      total -= m.content.length - short.length;
      m.content = short;
      changed = true;
    }
  };
  shrink(lastAssistant);
  shrink(messages.length - 1);
  return changed;
}

/** Limite prático da linha de comando no Windows (cmd.exe: 8191; CreateProcess: 32767). */
const ARG_LIMIT = (viaShell: boolean) => (!isWin ? 120_000 : viaShell ? 7_000 : 28_000);

export interface HarnessRun { ok: boolean; stdout: string; stderr: string; code: number | null }

/** Uso devolvido pelo harness (hoje: o agy em --output-format json). O main registra por conta. */
export interface HarnessUsageEvent { harness: 'antigravity'; home?: string; model?: string; input: number; output: number; thinking: number; total: number; ok: boolean }
let usageSink: ((u: HarnessUsageEvent) => void) | undefined;
export const setHarnessUsageSink = (fn: (u: HarnessUsageEvent) => void) => { usageSink = fn; };
const isAgy = (cfg: HarnessConfig) => { const c = path.basename(cfg.command.trim()).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase(); return c === 'agy' || /antigravity/.test(c); };
/** agy em modo print sem formato escolhido: pede stream-json (progresso ao vivo — ferramentas e texto — e, no fim, a resposta com o uso real de tokens). */
export function agyJsonArgs(cfg: HarnessConfig, args: string[]): { args: string[]; json: boolean } {
  if (!isAgy(cfg) || args.some((a) => a === '--output-format') || !args.some((a) => a === '--print' || a === '-p' || a === '--prompt')) return { args, json: false };
  const at = args.findIndex((a) => a === '--print' || a === '-p' || a === '--prompt');
  return { args: [...args.slice(0, at), '--output-format', 'stream-json', ...args.slice(at)], json: true };
}
/** Uma linha do stream-json do agy → texto (pedaço da resposta) e/ou linha de progresso para o log (função pura). */
export function agyStreamLine(line: string): { text?: string; log?: string } {
  try {
    const j = JSON.parse(line) as { event?: string; step_update?: { state?: string; step_type?: string; tool_name?: string; text_delta?: string; tool_info?: { parameters?: Record<string, unknown> } } };
    const u = j.step_update;
    if (j.event !== 'step_update' || !u) return {};
    if (u.step_type === 'tool' && u.state === 'ACTIVE' && u.tool_name) {
      const p = u.tool_info?.parameters ?? {};
      const arg = String(p['Path'] ?? p['path'] ?? p['AbsolutePath'] ?? p['CommandLine'] ?? p['command'] ?? p['Query'] ?? p['query'] ?? '').replace(/^.*[\\/](?=[^\\/]+[\\/][^\\/]+$)/, '…/');
      return { log: `🔧 ${u.tool_name}${arg ? ` ${arg.slice(0, 140)}` : ''}` };
    }
    if (u.step_type === 'agent_response' && typeof u.text_delta === 'string') return { text: u.text_delta };
    return {};
  } catch { return {}; }
}
/** Desembrulha a saída JSON do agy: { response, status, usage } (função pura). */
export function parseAgyJson(stdout: string): { response: string; ok: boolean; usage?: { input: number; output: number; thinking: number; total: number } } | undefined {
  const t0 = stdout.trim();
  /* stream-json: a última linha {"event":"result","result":{…}} traz a resposta; json simples: um objeto só */
  const resLine = t0.split('\n').reverse().find((l) => l.includes('"event":"result"'));
  const t = resLine ? (() => { try { return JSON.stringify((JSON.parse(resLine) as { result?: unknown }).result ?? {}); } catch { return t0; } })() : t0;
  const i = t.lastIndexOf('\n{"conversation_id"'), start = i >= 0 ? i + 1 : t.indexOf('{');
  if (start < 0) return undefined;
  try {
    const j = JSON.parse(t.slice(start)) as { response?: string; status?: string; usage?: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number; total_tokens?: number } };
    if (typeof j.response !== 'string') return undefined;
    const u = j.usage;
    return { response: j.response, ok: !j.status || /success/i.test(j.status), usage: u ? { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, thinking: u.thinking_tokens ?? 0, total: u.total_tokens ?? 0 } : undefined };
  } catch { return undefined; }
}

/** Motivo de um cancelamento: o passado em abort(motivo) (ex.: tempo máximo de produção) ou o texto genérico. */
export function abortMessage(signal: AbortSignal, fallback: string): string {
  const r = signal.reason as unknown;
  if (r instanceof Error && r.name !== 'AbortError') return r.message;
  return typeof r === 'string' && r ? r : fallback;
}

export function runHarness(
  cfg: HarnessConfig, opts: { cwd: string; prompt: string; model?: string; effort?: ReasoningEffort; signal: AbortSignal;
    env?: Record<string, string>; onLine?: (l: string) => void;
    /** teto rígido (segundos): mata o processo mesmo se o timer externo não disparar */
    timeoutSec?: number;
    /** harnesses HTTP: pastas liberadas para as ferramentas (arquivos) */
    tools?: { roots: string[]; allowShell?: boolean };
    /** harnesses HTTP: imagens anexadas à mensagem (modelos com visão); os CLIs abrem os arquivos pela pasta */
    images?: string[];
    /** Ollama: opções de amostragem desta chamada (ex.: repeat_penalty numa nova tentativa depois de um laço) */
    sampling?: Record<string, number>;
    /** harnesses HTTP: decodificação guiada (resposta = JSON neste esquema) */
    schema?: object },
): Promise<HarnessRun> {
  if (isHttpHarness(cfg)) return runHttp(cfg, opts);
  /* CLIs (Claude, Antigravity, Codex…): o pedido normal, sem as marcas do modo estrito */
  opts = { ...opts, prompt: stripMarks(opts.prompt) };
  const cmd = resolveHarnessCommand(cfg);
  if (!cmd.found) {
    const hint = /opencode/i.test(cfg.command)
      ? ' — instale o OpenCode ou aponte "Comando" para o CLI (ex.: %LOCALAPPDATA%\\Programs\\@opencodedesktop\\resources\\opencode-cli.exe)'
      : ' — ajuste o campo "Comando" em Configurações → Providers (provedores)';
    return Promise.resolve({ ok: false, stdout: '', stderr: `comando "${cfg.command.trim()}" não encontrado no PATH${hint}`, code: null });
  }
  /* prompt grande demais para a linha de comando (spawn ENAMETOOLONG): vai num arquivo na pasta de trabalho
     e o argumento só manda o agente lê-lo — CLIs agênticos (agy, opencode, codex) leem arquivos sozinhos */
  const viaShell = shellFor(cmd.command);
  let argPrompt = opts.prompt, promptFile: string | undefined;
  if (cfg.promptVia === 'arg' && opts.prompt.length > ARG_LIMIT(viaShell)) {
    promptFile = path.join(opts.cwd, `.forge-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.md`);
    fs.writeFileSync(promptFile, opts.prompt);
    argPrompt = `O pedido completo desta tarefa está no arquivo "${path.basename(promptFile)}" nesta pasta (${opts.prompt.length} caracteres, longo demais para a linha de comando). Leia o arquivo inteiro primeiro e siga as instruções dele exatamente, como se fossem esta mensagem. Não edite nem apague esse arquivo.`;
    opts.onLine?.(`prompt longo (${opts.prompt.length} caracteres): enviado por arquivo (${path.basename(promptFile)})`);
  }
  const run = new Promise<HarnessRun>((resolve, reject) => {
    const { args, json: agyJson } = agyJsonArgs(cfg, injectEffort(cfg, buildArgs(cfg, cfg.promptVia === 'arg' ? argPrompt : '', opts.model, opts.effort), opts.effort));
    args.unshift(...dshModelArgs(cfg, opts.model).map((a) => shellCommand(a, viaShell)));
    const child = spawn(shellCommand(cmd.command, viaShell), args, {
      cwd: opts.cwd, shell: viaShell, detached: !isWin, windowsHide: true,
      env: { ...process.env, ...cfg.env, ...opts.env, FORGE_SCENE_DIR: opts.cwd },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => { /* harness encerrou antes de ler o prompt (EPIPE): o código de saída/erro explica */ });
    let stdout = '', stderr = '';
    let bufOut = '', bufErr = '';
    let agyText = '', agyStreamed = false;   // texto da resposta do agy chegando em pedaços (stream-json)
    const cap = 2_000_000;
    const flush = (which: 'out' | 'err') => {
      const buf = which === 'out' ? bufOut : bufErr;
      const rest = buf.trim();
      if (rest && !(agyJson && which === 'out')) opts.onLine?.(which === 'out' ? rest : '[stderr] ' + rest);
      if (which === 'out') bufOut = ''; else bufErr = '';
    };
    const feed = (which: 'out' | 'err', s: string) => {
      if (which === 'out') { if (stdout.length < cap) stdout += s; bufOut += s; }
      else { if (stderr.length < cap) stderr += s; bufErr += s; }
      // só emite linhas completas: harnesses que escrevem em pedaços não poluem o log
      const parts = (which === 'out' ? bufOut : bufErr).split('\n');
      const tail = parts.pop() ?? '';
      if (which === 'out') bufOut = tail; else bufErr = tail;
      for (const l of parts) {
        if (agyJson && which === 'out') {
          /* stream-json do agy: mostra as ferramentas usadas e o texto da resposta linha a linha */
          const ev = agyStreamLine(l);
          if (ev.log) opts.onLine?.(ev.log);
          if (ev.text) { agyText += ev.text; agyStreamed = true; const ls = agyText.split('\n'); agyText = ls.pop() ?? ''; for (const x of ls) if (x.trim()) opts.onLine?.(x); }
          continue;
        }
        if (!l.trim()) continue;
        opts.onLine?.(which === 'out' ? l : '[stderr] ' + l);
      }
    };
    child.stdout.on('data', (d: Buffer) => feed('out', d.toString()));
    child.stderr.on('data', (d: Buffer) => feed('err', d.toString()));
    const kill = () => {
      try {
        if (isWin && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        else if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch { /* já finalizado */ }
    };
    const onAbort = () => { clearTimeout(hard); kill(); reject(new Error(abortMessage(opts.signal, 'abortado (timeout/cancelamento)'))); };
    /* rede de segurança: o CLI pode ficar pendurado esperando rede/permissão e o timer
       da etapa (runUnit) nem sempre dispara no processo principal do Electron. */
    const hard = setTimeout(() => { kill(); reject(new Error(`timeout do harness (${opts.timeoutSec ?? 3600}s)`)); },
      Math.max(30, opts.timeoutSec ?? 3600) * 1000);
    if (opts.signal.aborted) return onAbort();
    opts.signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => { clearTimeout(hard); opts.signal.removeEventListener('abort', onAbort); reject(new Error(`falha ao iniciar "${cfg.command}": ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(hard);
      opts.signal.removeEventListener('abort', onAbort);
      flush('out'); flush('err');
      if (agyJson) {
        const j = parseAgyJson(stdout);
        if (j) {
          if (agyText.trim()) opts.onLine?.(agyText.trim());
          if (!agyStreamed) for (const l of j.response.split('\n')) if (l.trim()) opts.onLine?.(l);
          if (j.usage) try { usageSink?.({ harness: 'antigravity', home: opts.env?.['USERPROFILE'], model: opts.model, ...j.usage, ok: j.ok && code === 0 }); } catch { /* registro opcional */ }
          resolve({ ok: code === 0 && j.ok, stdout: j.response, stderr: j.ok ? stderr : (stderr || j.response).slice(-2000), code });
          return;
        }
      }
      resolve({ ok: code === 0, stdout, stderr, code });
    });
    if (cfg.promptVia === 'stdin') child.stdin.end(opts.prompt); else child.stdin.end();
  });
  /* o arquivo do prompt é só nosso (temporário): sai ao fim da execução */
  return promptFile ? run.finally(() => { try { fs.rmSync(promptFile!, { force: true }); } catch { /* ok */ } }) : run;
}
