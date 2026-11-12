import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AutomationsConfig, GoogleAccount, Project, Settings } from '../shared/types';
import { transcribe, type WordTime } from './whisper';
import { ensureWhisper } from './whisper-install';
import * as ff from './ffmpeg';

/*
 * Automações:
 * - contas Google (até 10), cada uma com um perfil de navegador próprio. O LOGIN é feito
 *   pelo usuário na página do Google — o app nunca digita nem guarda senha;
 * - Google Flow aberto no navegador da conta, com a extensão do usuário carregada;
 *   os downloads caem na pasta da conta e podem ir para uma cena de um projeto;
 * - Antigravity CLI por conta: cada conta tem uma "home" própria para a sessão do agy;
 *   a conta usada pelas rotas é escolhida manualmente (sem rodízio automático);
 * - SRT a partir de um áudio/vídeo (Whisper com tempo por palavra).
 */

export const MAX_ACCOUNTS = 20;
export const DEFAULT_FLOW_URL = 'https://flow.google.com/';
/** Porta de automação (CDP) do navegador de cada conta: g1 → 9311, g2 → 9312… (só em 127.0.0.1). */
export const portFor = (id: string) => 9310 + Number(id.slice(1));

/** Conta para o Flow: a pedida, senão a primeira com login feito. */
export function flowAccount(s: Settings, id?: string): GoogleAccount {
  const accs = config(s).accounts;
  const a = id ? accs.find((x) => x.id === id) : accs.find((x) => fs.existsSync(path.join(paths(s, x.id).browser, 'Default'))) ?? accs[0];
  if (!a) throw new Error('nenhuma conta Google em Automações: adicione uma e faça o login');
  return a;
}

export const isBrowserUp = async (id: string) => { try { return (await fetch(`http://127.0.0.1:${portFor(id)}/json/version`)).ok; } catch { return false; } };
/**
 * Fecha o navegador aberto por ESTE processo para a conta. Não toca em navegador externo
 * (o do usuário): só no que `ensureFlowBrowser` abriu — é a limpeza que evita órfãos em testes.
 */
export function closeFlowBrowser(id: string): boolean {
  const child = running.get(id);
  if (!child) return false;
  running.delete(id);
  try {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref();
    else child.kill();
  } catch { /* já fechou */ }
  return true;
}
/** Garante o navegador da conta aberto com a porta de automação; abre se preciso. */
export async function ensureFlowBrowser(s: Settings, id: string, log: (l: string) => void): Promise<number> {
  const port = portFor(id);
  const up = async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } };
  if (await up()) return port;
  if (running.has(id)) throw new Error('o navegador da conta está aberto sem a porta de automação — feche-o e tente de novo');
  log(`abrindo o navegador da conta ${id} para o Flow…`);
  openBrowser(s, id, 'url', 'about:blank');
  for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); if (await up()) return port; }
  throw new Error('o navegador da conta não respondeu na porta de automação (se ele já estava aberto, feche e tente de novo)');
}
export const flowDebugDir = (s: Settings, id: string) => path.join(paths(s, id).dir, 'flow-debug');
/** Projeto do Flow usado pela automação desta conta (reaproveitado nas próximas gerações). */
export const flowProjectOf = (s: Settings, id: string) => { try { const u = fs.readFileSync(path.join(paths(s, id).dir, 'flow-project.txt'), 'utf8').trim(); return /^https?:\/\/[\w.:-]+\/project\//.test(u) ? u : undefined; } catch { return undefined; } };
export const setFlowProject = (s: Settings, id: string, url: string) => { try { fs.writeFileSync(path.join(paths(s, id).dir, 'flow-project.txt'), url, 'utf8'); } catch { /* ignora */ } };

export const autoRoot = (s: Settings) => path.join(s.workspace, 'automations');
export const accountDir = (s: Settings, id: string) => {
  if (!/^g\d{1,2}$/.test(id)) throw new Error(`conta inválida: ${id}`);   // g1…g20
  return path.join(autoRoot(s), 'accounts', id);
};
const paths = (s: Settings, id: string) => {
  const dir = accountDir(s, id);
  return { dir, browser: path.join(dir, 'browser'), agyHome: path.join(dir, 'agy-home'), downloads: path.join(dir, 'downloads'), prompts: path.join(dir, 'prompts.txt') };
};
export const config = (s: Settings): AutomationsConfig => (s.automations ??= { accounts: [] });

/* ───────── navegador ───────── */

export interface BrowserInfo { path?: string; kind: 'chromium' | 'chrome' | 'edge' | 'custom' | 'none'; extensions: boolean; note: string }

/** Chromium do Playwright (aceita --load-extension) → Chrome → Edge. Chrome/Edge 137+ ignoram --load-extension. */
export function detectBrowser(s: Settings): BrowserInfo {
  const custom = config(s).browserPath?.trim();
  if (custom) return fs.existsSync(custom) ? { path: custom, kind: 'custom', extensions: true, note: 'navegador escolhido por você' } : { kind: 'none', extensions: false, note: `não encontrado: ${custom}` };
  const pw = path.join(process.env['LOCALAPPDATA'] ?? '', 'ms-playwright');
  try {
    const dirs = fs.readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of dirs) for (const sub of ['chrome-win64', 'chrome-win']) {
      const exe = path.join(pw, d, sub, 'chrome.exe');
      if (fs.existsSync(exe)) return { path: exe, kind: 'chromium', extensions: true, note: `Chromium do Playwright (${d}) — carrega extensões descompactadas` };
    }
  } catch { /* sem Playwright */ }
  const cands: Array<[string, BrowserInfo['kind']]> = [
    [path.join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'), 'chrome'],
    [path.join(process.env['LOCALAPPDATA'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'), 'chrome'],
    [path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'edge'],
  ];
  for (const [p, kind] of cands) if (fs.existsSync(p)) return { path: p, kind, extensions: false, note: `${kind === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'} — versões recentes não carregam extensões por linha de comando; instale a extensão pela loja dentro do navegador da conta` };
  return { kind: 'none', extensions: false, note: 'nenhum navegador Chromium encontrado — escolha um em "Navegador"' };
}

/* ───────── contas ───────── */

export function listAccounts(s: Settings): Array<GoogleAccount & { dir: string; hasProfile: boolean; downloads: number; hasAgy: boolean; running: boolean }> {
  return config(s).accounts.map((a) => {
    const p = paths(s, a.id);
    let downloads = 0; try { downloads = fs.readdirSync(p.downloads).filter((f) => !/\.(crdownload|tmp)$/i.test(f)).length; } catch { /* vazio */ }
    return { ...a, dir: p.dir, hasProfile: fs.existsSync(path.join(p.browser, 'Default')), downloads, hasAgy: fs.existsSync(path.join(p.agyHome, '.gemini')), running: running.has(a.id) };
  });
}

export function addAccount(s: Settings, label: string, email?: string): GoogleAccount {
  const cfg = config(s);
  if (cfg.accounts.length >= MAX_ACCOUNTS) throw new Error(`limite de ${MAX_ACCOUNTS} contas`);
  let n = 1; while (cfg.accounts.some((a) => a.id === `g${n}`)) n++;
  const acc: GoogleAccount = { id: `g${n}`, label: label.trim() || `Conta ${n}`, email: email?.trim() || undefined, createdAt: new Date().toISOString() };
  const p = paths(s, acc.id);
  for (const d of [p.browser, p.agyHome, p.downloads]) fs.mkdirSync(d, { recursive: true });
  cfg.accounts.push(acc);
  return acc;
}

export function updateAccount(s: Settings, id: string, patch: { label?: string; email?: string }): GoogleAccount {
  const a = config(s).accounts.find((x) => x.id === id);
  if (!a) throw new Error('conta não encontrada');
  if (typeof patch.label === 'string' && patch.label.trim()) a.label = patch.label.trim().slice(0, 60);
  if (typeof patch.email === 'string') a.email = patch.email.trim().slice(0, 120) || undefined;
  return a;
}

/** Tira a conta da lista. A pasta (perfil do navegador, downloads) fica no disco — apague manualmente se quiser. */
export function removeAccount(s: Settings, id: string): string {
  const cfg = config(s);
  const dir = accountDir(s, id);
  cfg.accounts = cfg.accounts.filter((a) => a.id !== id);
  if (cfg.agyAccount === id) cfg.agyAccount = undefined;
  return dir;
}

/* ───────── abrir o navegador da conta ───────── */

const running = new Map<string, ChildProcess>();

/** Faz os downloads do perfil irem para a pasta da conta, sem perguntar onde salvar. */
function setDownloadDir(profile: string, dir: string) {
  const prefFile = path.join(profile, 'Default', 'Preferences');
  fs.mkdirSync(path.dirname(prefFile), { recursive: true });
  let prefs: Record<string, unknown> = {};
  try { prefs = JSON.parse(fs.readFileSync(prefFile, 'utf8')); } catch { /* perfil novo */ }
  prefs['download'] = { ...(prefs['download'] as object ?? {}), default_directory: dir, prompt_for_download: false, directory_upgrade: true };
  prefs['savefile'] = { ...(prefs['savefile'] as object ?? {}), default_directory: dir };
  fs.writeFileSync(prefFile, JSON.stringify(prefs));
}

export function openBrowser(s: Settings, id: string, target: 'login' | 'flow' | 'url', url?: string): { browser: string; url: string } {
  const acc = config(s).accounts.find((x) => x.id === id);
  if (!acc) throw new Error('conta não encontrada');
  const b = detectBrowser(s);
  if (!b.path) throw new Error(b.note);
  const p = paths(s, id);
  for (const d of [p.browser, p.downloads]) fs.mkdirSync(d, { recursive: true });
  const dest = target === 'login' ? 'https://accounts.google.com/' : target === 'flow' ? (config(s).flowUrl?.trim() || DEFAULT_FLOW_URL) : (url ?? 'about:blank');
  const alreadyOpen = running.has(id);
  if (!alreadyOpen) { try { setDownloadDir(p.browser, p.downloads); } catch { /* segue com o padrão do navegador */ } }
  const ext = config(s).extensionDir?.trim();
  const args = [`--user-data-dir=${p.browser}`, '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${portFor(id)}`, '--remote-debugging-address=127.0.0.1',
    ...(ext && fs.existsSync(ext) ? [`--load-extension=${ext}`] : []), dest];
  const child = spawn(b.path, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  if (!alreadyOpen) {
    running.set(id, child);
    child.on('exit', () => { if (running.get(id) === child) running.delete(id); });
  }
  acc.lastOpened = new Date().toISOString();
  return { browser: b.path, url: dest };
}

/* ───────── Flow: fila de prompts e downloads ───────── */

export function savePrompts(s: Settings, id: string, text: string): { file: string; count: number } {
  const p = paths(s, id);
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.prompts, lines.join('\n'), 'utf8');
  return { file: p.prompts, count: lines.length };
}
export function readPrompts(s: Settings, id: string): string {
  try { return fs.readFileSync(paths(s, id).prompts, 'utf8'); } catch { return ''; }
}

export function listDownloads(s: Settings, id: string): Array<{ file: string; name: string; size: number; at: string; kind: 'video' | 'image' | 'audio' | 'other' }> {
  const dir = paths(s, id).downloads;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => !/\.(crdownload|tmp|part)$/i.test(f)).map((name) => {
    const file = path.join(dir, name); const st = fs.statSync(file);
    const kind = /\.(mp4|webm|mov|mkv)$/i.test(name) ? 'video' as const : /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' as const : /\.(mp3|wav|m4a|ogg|flac)$/i.test(name) ? 'audio' as const : 'other' as const;
    return { file, name, size: st.size, at: st.mtime.toISOString(), kind };
  }).filter((x) => fs.statSync(x.file).isFile()).sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Leva um arquivo baixado do Flow para DENTRO do projeto, como visual de uma cena:
 * vídeo → clips/clip.mp4, imagem → frames/frame.png. Por padrão MOVE (o arquivo sai da
 * pasta da conta); a cena vira do tipo correspondente e a montagem usa esse visual.
 */
export async function importToScene(s: Settings, p: Project, projectDir: string, accountId: string, file: string, sceneId: string, move = true): Promise<string> {
  const dl = paths(s, accountId).downloads;
  const src = path.resolve(file);
  if (!src.startsWith(path.resolve(dl) + path.sep) || !fs.existsSync(src)) throw new Error('arquivo fora da pasta de downloads da conta');
  const sc = p.scenes.find((x) => x.id === sceneId);
  if (!sc) throw new Error('cena não encontrada');
  const sceneDir = path.join(projectDir, 'scenes', sc.id);
  let dest: string;
  if (/\.(mp4|webm|mov|mkv)$/i.test(src)) {
    dest = path.join(sceneDir, 'clips', 'clip.mp4');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (/\.mp4$/i.test(src)) fs.copyFileSync(src, dest);
    else await ff.run(s.ffmpeg, ['-y', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', dest]);
    sc.kind = 'video';
  } else if (/\.(png|jpe?g|webp|gif)$/i.test(src)) {
    dest = path.join(sceneDir, 'frames', 'frame.png');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (/\.png$/i.test(src)) fs.copyFileSync(src, dest);
    else await ff.run(s.ffmpeg, ['-y', '-i', src, '-frames:v', '1', dest]);
    if (sc.kind !== 'video') sc.kind = 'image';
  } else throw new Error('use um vídeo ou uma imagem');
  sc.artifacts['flow'] = [dest];
  sc.status['flow'] = 'done';
  if (move) fs.rmSync(src, { force: true });   // fica só a cópia dentro do projeto
  return dest;
}

/* ───────── Antigravity por conta ───────── */

/** Variáveis de ambiente que isolam a sessão do agy na "home" da conta. */
export function agyEnvFor(s: Settings, id: string | undefined): Record<string, string> {
  if (!id) return {};
  if (!config(s).accounts.some((a) => a.id === id)) return {};
  const home = paths(s, id).agyHome;
  fs.mkdirSync(home, { recursive: true });
  return { USERPROFILE: home, HOME: home };
}
/** Sessão do agy usada pelas rotas (conta escolhida em Automações). */
export const activeAgyEnv = (s: Settings) => agyEnvFor(s, config(s).agyAccount);
/** Sessão do agy de um projeto: a conta escolhida no projeto vence a padrão de Automações. */
export const agyEnvForProject = (s: Settings, p?: { agyAccount?: string }) => agyEnvFor(s, p?.agyAccount || config(s).agyAccount);
/** Pastas de uma conta (navegador, home do agy, downloads). */
export const accountPaths = (s: Settings, id: string) => paths(s, id);

/** Abre um terminal com o agy na home da conta: o próprio agy conduz o login (navegador do Google). */
export function openAgyLogin(s: Settings, id: string, agyCommand: string): void {
  if (!config(s).accounts.some((a) => a.id === id)) throw new Error('conta não encontrada');
  const env = { ...process.env, ...agyEnvFor(s, id) };
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', `"Antigravity — ${id}"`, 'cmd', '/k', `"${agyCommand}"`], { env, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else {
    spawn(process.env['TERMINAL'] ?? 'x-terminal-emulator', ['-e', agyCommand], { env, detached: true, stdio: 'ignore' }).unref();
  }
}

/* ───────── SRT a partir de áudio ───────── */

export interface SrtOptions { maxChars?: number; maxLines?: number; maxSeconds?: number; language?: string }

/** Agrupa palavras em legendas: quebra por tamanho, duração, pausa e pontuação. */
export function wordsToSrt(words: WordTime[], o: SrtOptions = {}): Array<{ start: number; end: number; text: string }> {
  const maxChars = Math.max(16, Math.min(80, o.maxChars ?? 42));
  const maxLines = Math.max(1, Math.min(3, o.maxLines ?? 2));
  const maxSec = Math.max(1.5, Math.min(10, o.maxSeconds ?? 6));
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let cur: WordTime[] = [];
  const len = (ws: WordTime[]) => ws.map((w) => w.w.trim()).join(' ').length;
  const flush = () => {
    if (!cur.length) return;
    const lines: string[] = []; let line = '';
    for (const w of cur.map((x) => x.w.trim()).filter(Boolean)) {
      if (line && (line + ' ' + w).length > maxChars) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
    }
    if (line) lines.push(line);
    cues.push({ start: cur[0]!.start, end: Math.max(cur[cur.length - 1]!.end, cur[0]!.start + 0.4), text: lines.join('\n') });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (cur.length) {
      const gap = w.start - cur[cur.length - 1]!.end;
      const tooLong = len([...cur, w]) > maxChars * maxLines || w.end - cur[0]!.start > maxSec;
      if (tooLong || gap > 0.7) flush();
    }
    cur.push(w);
    if (/[.!?…]["”']?$/.test(w.w.trim()) && len(cur) > maxChars * 0.5) flush();
  }
  flush();
  for (let i = 0; i + 1 < cues.length; i++) cues[i]!.end = Math.min(cues[i]!.end, cues[i + 1]!.start - 0.02);
  return cues;
}
const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000)); const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
export const cuesToSrt = (cues: Array<{ start: number; end: number; text: string }>) =>
  cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');

/** Gera <arquivo>.srt ao lado do áudio (nunca sobrescreve: usa .1.srt, .2.srt…). */
export async function srtFromAudio(s: Settings, file: string, toolsDir: string, o: SrtOptions, signal: AbortSignal, log: (l: string) => void): Promise<{ file: string; cues: number; preview: string; source: string }> {
  if (!fs.existsSync(file)) throw new Error('arquivo não encontrado');
  const script = path.join(toolsDir, 'whisper_words.py');
  const tmp = path.join(autoRoot(s), 'srt-tmp.json');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  let cfg = s.whisper ?? { python: 'python', model: 'small', device: 'auto' };
  let w;
  try { w = await transcribe(cfg, script, file, tmp, o.language, signal); }
  catch (e) {
    const msg = (e as Error).message;
    if (cfg.autoInstall === false || !/faster-whisper|No module|ModuleNotFound|não foi possível executar|ENOENT|python/i.test(msg)) throw e;
    log(`Whisper indisponível (${msg.slice(0, 120)}) → instalando faster-whisper…`);
    const inst = await ensureWhisper(s, { log, signal });
    cfg = { ...cfg, python: inst.python, device: 'cpu' };
    w = await transcribe(cfg, script, file, tmp, o.language, signal);
  }
  fs.rmSync(tmp, { force: true });
  if (!w.words.length) throw new Error('nenhuma fala reconhecida no áudio');
  const cues = wordsToSrt(w.words, o);
  const base = file.replace(/\.[^.\\/]+$/, '');
  let out = `${base}.srt`; let n = 1;
  while (fs.existsSync(out)) out = `${base}.${n++}.srt`;
  fs.writeFileSync(out, cuesToSrt(cues), 'utf8');
  log(`SRT: ${cues.length} legendas → ${out}`);
  return { file: out, cues: cues.length, preview: cuesToSrt(cues.slice(0, 6)), source: w.source };
}
