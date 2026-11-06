import { httpFetch } from './http';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Settings } from '../shared/types';
import { resolveHarnessCommand } from './harness';
import * as auto from './automations';

/*
 * USO DOS HARNESSES (sessão e semana), da fonte mais confiável de cada um:
 *  - Claude Code: o mesmo dado do /usage (janela de 5 h e de 7 dias, % usado e quando renova), pela conta logada no PC;
 *  - Codex: os limites (5 h / semana) que o próprio Codex grava em ~/.codex/sessions;
 *  - OpenCode: `opencode stats --json` (tokens e custo de hoje e dos últimos 7 dias — o limite depende do provedor);
 *  - Antigravity: não publica a cota; o FilmForge soma o uso REAL que o agy devolve em cada chamada (tokens), por conta.
 * Nenhum token de acesso é exibido nem gravado.
 */

export interface UsageWindow { id: 'session' | 'week' | 'today' | 'credits'; label: string; percent?: number; resetsAt?: string; tokens?: number; cost?: number; calls?: number }
export interface HarnessUsage { harness: 'claude' | 'codex' | 'opencode' | 'antigravity' | 'flow'; account?: string; accountLabel?: string; source: string; plan?: string; windows: UsageWindow[]; note?: string; error?: string }
export interface AgyLedgerEntry { at: string; account?: string; model?: string; input: number; output: number; thinking: number; total: number; ok: boolean }

/* ───────── registro do Antigravity (uso real devolvido pelo agy) ───────── */

const ledgerFile = (s: Settings) => path.join(s.workspace, 'usage', 'antigravity.jsonl');

export function recordAgyUsage(s: Settings, e: AgyLedgerEntry): void {
  try { fs.mkdirSync(path.dirname(ledgerFile(s)), { recursive: true }); fs.appendFileSync(ledgerFile(s), JSON.stringify(e) + '\n'); } catch { /* sem disco: não quebra a execução */ }
}

/** Conta dona de uma home isolada do agy (USERPROFILE das Automações); vazio = sessão normal do Windows. */
export function accountOfAgyHome(s: Settings, home?: string): string | undefined {
  if (!home) return undefined;
  const norm = path.resolve(home).toLowerCase();
  return auto.config(s).accounts.find((a) => path.resolve(auto.accountPaths(s, a.id).agyHome).toLowerCase() === norm)?.id;
}

function readLedger(s: Settings): AgyLedgerEntry[] {
  try { return fs.readFileSync(ledgerFile(s), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AgyLedgerEntry); } catch { return []; }
}

/** Soma do uso do Antigravity por conta nas últimas 5 h e 7 dias (função pura sobre o registro). */
export function agyWindows(entries: AgyLedgerEntry[], account: string | undefined, now = Date.now()): UsageWindow[] {
  const mine = entries.filter((e) => (e.account ?? '') === (account ?? ''));
  const sum = (ms: number) => { const xs = mine.filter((e) => now - Date.parse(e.at) <= ms); return { tokens: xs.reduce((a, e) => a + (e.total || 0), 0), calls: xs.length }; };
  return [{ id: 'session', label: 'últimas 5 h', ...sum(5 * 3600e3) }, { id: 'week', label: 'últimos 7 dias', ...sum(7 * 864e5) }];
}

/* ───────── Claude Code ───────── */

async function claudeUsage(home = os.homedir()): Promise<HarnessUsage> {
  const base: HarnessUsage = { harness: 'claude', source: 'conta do Claude Code neste PC (mesmo dado do /usage)', windows: [] };
  let cred: { claudeAiOauth?: { accessToken?: string; subscriptionType?: string; expiresAt?: number } };
  try { cred = JSON.parse(fs.readFileSync(path.join(home, '.claude', '.credentials.json'), 'utf8')); }
  catch { return { ...base, error: 'Claude Code sem login neste PC (rode "claude" e entre na conta)' }; }
  const o = cred.claudeAiOauth;
  if (!o?.accessToken) return { ...base, error: 'login do Claude Code sem assinatura (uso por API: veja o console da Anthropic)' };
  try {
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${o.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(15_000) });
    if (r.status === 401) return { ...base, plan: o.subscriptionType, error: 'login do Claude Code expirado — abra o "claude" uma vez para renovar' };
    if (!r.ok) return { ...base, plan: o.subscriptionType, error: `HTTP ${r.status}` };
    const j = (await r.json()) as Record<string, { utilization?: number; resets_at?: string } | null>;
    const w = (id: UsageWindow['id'], label: string, x?: { utilization?: number; resets_at?: string } | null): UsageWindow[] => (x ? [{ id, label, percent: x.utilization ?? undefined, resetsAt: x.resets_at ?? undefined }] : []);
    return { ...base, plan: o.subscriptionType, windows: [...w('session', 'sessão (5 h)', j['five_hour']), ...w('week', 'semana (7 dias)', j['seven_day'])],
      note: j['seven_day_opus']?.utilization !== undefined ? `Opus na semana: ${j['seven_day_opus']!.utilization}%` : undefined };
  } catch (e) { return { ...base, plan: o.subscriptionType, error: (e as Error).message }; }
}

/* ───────── Codex ───────── */

function newestFile(dir: string, re: RegExp, depth = 4): string | undefined {
  let best: { f: string; t: number } | undefined;
  const walk = (d: string, n: number) => {
    let es: fs.Dirent[] = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && n > 0) walk(p, n - 1);
      else if (re.test(e.name)) { const t = fs.statSync(p).mtimeMs; if (!best || t > best.t) best = { f: p, t }; }
    }
  };
  walk(dir, depth);
  return best?.f;
}

/** Último registro de limites do Codex num arquivo de sessão (função pura sobre o texto). */
export function codexLimitsFrom(text: string, fileTime = Date.now()): UsageWindow[] {
  const lines = text.split('\n').filter((l) => l.includes('rate_limits')).reverse();
  for (const l of lines) {
    try {
      const j = JSON.parse(l) as { timestamp?: string; payload?: { rate_limits?: Record<string, { used_percent?: number; window_minutes?: number; resets_in_seconds?: number; resets_at?: number | string } | undefined> } };
      const rl = j.payload?.rate_limits;
      if (!rl) continue;
      const at = j.timestamp ? Date.parse(j.timestamp) : fileTime;
      const win = (id: UsageWindow['id'], label: string, x?: { used_percent?: number; window_minutes?: number; resets_in_seconds?: number; resets_at?: number | string }): UsageWindow[] => {
        if (!x) return [];
        const resetsAt = typeof x.resets_at === 'number' ? new Date(x.resets_at * 1000).toISOString() : typeof x.resets_at === 'string' ? x.resets_at
          : x.resets_in_seconds !== undefined ? new Date(at + x.resets_in_seconds * 1000).toISOString() : undefined;
        return [{ id, label, percent: x.used_percent, resetsAt }];
      };
      return [...win('session', 'sessão (5 h)', rl['primary']), ...win('week', 'semana (7 dias)', rl['secondary'])];
    } catch { /* linha inválida */ }
  }
  return [];
}

function codexUsage(home = os.homedir()): HarnessUsage {
  const base: HarnessUsage = { harness: 'codex', source: 'limites gravados pelo Codex na última sessão (~/.codex/sessions)', windows: [] };
  const dir = path.join(process.env['CODEX_HOME'] ?? path.join(home, '.codex'), 'sessions');
  const f = fs.existsSync(dir) ? newestFile(dir, /\.jsonl$/i) : undefined;
  if (!f) return { ...base, error: 'Codex sem sessões neste PC (use o Codex uma vez para aparecer o uso)' };
  const windows = codexLimitsFrom(fs.readFileSync(f, 'utf8'), fs.statSync(f).mtimeMs);
  return windows.length ? { ...base, windows, note: `atualizado em ${new Date(fs.statSync(f).mtimeMs).toLocaleString()}` } : { ...base, error: 'a última sessão do Codex não registrou limites' };
}

/* ───────── OpenCode ───────── */

function runJson(cmd: string, args: string[], timeoutMs = 60_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { c.kill(); reject(new Error('timeout')); }, timeoutMs);
    c.stdout.on('data', (d: Buffer) => { out += d.toString(); }); c.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    c.on('error', (e) => { clearTimeout(t); reject(e); });
    c.on('close', (code) => { clearTimeout(t); try { resolve(JSON.parse(out.slice(out.indexOf('{')))); } catch { reject(new Error(code ? err.slice(-200) || `código ${code}` : 'resposta inválida')); } });
  });
}

async function opencodeUsage(s: Settings): Promise<HarnessUsage> {
  const base: HarnessUsage = { harness: 'opencode', source: 'opencode stats (tokens e custo; o limite depende do provedor do modelo)', windows: [] };
  const cfg = s.harnesses.opencode;
  const cmd = cfg ? resolveHarnessCommand(cfg) : undefined;
  if (!cmd?.found) return { ...base, error: 'OpenCode não encontrado' };
  type St = { tokens?: { input?: number; output?: number; reasoning?: number }; cost?: number; prompts?: number };
  const tot = (j: St) => (j.tokens?.input ?? 0) + (j.tokens?.output ?? 0) + (j.tokens?.reasoning ?? 0);
  try {
    const [today, week] = await Promise.all([runJson(cmd.command, ['stats', '--days', '0', '--cost', '--json']), runJson(cmd.command, ['stats', '--days', '7', '--cost', '--json'])]) as [St, St];
    return { ...base, windows: [{ id: 'today', label: 'hoje', tokens: tot(today), cost: today.cost, calls: today.prompts }, { id: 'week', label: 'últimos 7 dias', tokens: tot(week), cost: week.cost, calls: week.prompts }] };
  } catch (e) { return { ...base, error: (e as Error).message }; }
}

/* ───────── relatório ───────── */

export async function usageReport(s: Settings): Promise<HarnessUsage[]> {
  const ledger = readLedger(s);
  const accs = auto.config(s).accounts;
  const agy: HarnessUsage[] = [{ id: undefined as string | undefined, label: 'sessão normal do Windows' }, ...accs.map((a) => ({ id: a.id as string | undefined, label: a.label }))]
    .filter((a) => a.id === undefined || ledger.some((e) => e.account === a.id) || accs.some((x) => x.id === a.id))
    .map((a) => ({ harness: 'antigravity' as const, account: a.id, accountLabel: a.label, source: 'uso real devolvido pelo agy nas chamadas do FilmForge (a cota do Google não é publicada)', windows: agyWindows(ledger, a.id) }));
  /* Flow: créditos da última leitura de cada conta ("💳 Créditos" em Automações) */
  const flow: HarnessUsage[] = accs.map((a) => ({ harness: 'flow' as const, account: a.id, accountLabel: a.label, source: 'créditos mostrados pelo Google Flow na última leitura (Automações → 💳 Créditos)',
    windows: a.credits?.value !== undefined ? [{ id: 'credits' as const, label: 'créditos restantes', tokens: a.credits.value, resetsAt: undefined }] : [],
    note: a.credits ? `lido em ${new Date(a.credits.at).toLocaleString()}${a.credits.value === undefined ? ` — ${a.credits.text}` : ''}` : undefined,
    error: a.credits ? undefined : 'créditos ainda não lidos — use "💳 Créditos" na conta' }));
  const [claude, opencode] = await Promise.all([claudeUsage(), opencodeUsage(s)]);
  return [claude, codexUsage(), opencode, ...agy, ...flow];
}
