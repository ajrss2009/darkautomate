import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Settings } from '../shared/types';

const isWin = process.platform === 'win32';
const venvDir = (s: Settings) => path.join(s.workspace, 'tools', 'whisper-venv');
const venvPython = (s: Settings) => path.join(venvDir(s), isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

function run(exe: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    let out = '', err = '';
    let child;
    try { child = spawn(exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); }
    catch (e) { resolve({ ok: false, out: '', err: (e as Error).message }); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, timeoutMs);
    const abort = () => { try { child.kill('SIGKILL'); } catch { /* ignore */ } };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({ ok: false, out, err: `${err}\n${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolve({ ok: code === 0, out, err });
    });
  });
}

/** Python utilizáveis: o configurado, o venv do Whisper, o do PATH, o do ComfyUI e instalações comuns. */
export function pythonCandidates(s: Settings): string[] {
  const list: string[] = [];
  const add = (p?: string) => { const v = (p ?? '').trim(); if (v && !list.includes(v)) list.push(v); };
  add(s.whisper?.python);
  add(venvPython(s));
  add('python');
  add('python3');

  // ComfyUI (Desktop): .../ComfyUI-Installs/<inst>/ComfyUI/.venv/Scripts/python.exe
  for (const root of ['F:\\Comfy-Desktop\\ComfyUI-Installs', 'C:\\Comfy-Desktop\\ComfyUI-Installs', 'C:\\ComfyUI', 'D:\\ComfyUI', 'E:\\ComfyUI']) {
    try {
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        for (const p of [
          path.join(root, d.name, 'ComfyUI', '.venv', 'Scripts', 'python.exe'),
          path.join(root, d.name, '.venv', 'Scripts', 'python.exe'),
          path.join(root, d.name, 'python_embeded', 'python.exe'),
        ]) if (fs.existsSync(p)) add(p);
      }
      const direct = path.join(root, '.venv', 'Scripts', 'python.exe');
      if (fs.existsSync(direct)) add(direct);
    } catch { /* pasta não existe */ }
  }

  // instalações normais do Python (usuário e máquina)
  const programRoots = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python'),
    'C:\\Program Files',
    'C:\\',
  ];
  for (const root of programRoots) {
    try {
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory() || !/^Python3\d+$/i.test(d.name)) continue;
        const p = path.join(root, d.name, 'python.exe');
        if (fs.existsSync(p)) add(p);
      }
    } catch { /* pasta não existe */ }
  }
  return list;
}

async function hasFasterWhisper(python: string, signal?: AbortSignal): Promise<boolean> {
  const r = await run(python, ['-c', 'import faster_whisper,sys;print(faster_whisper.__version__)'], 45_000, signal);
  return r.ok;
}

async function worksAsPython(python: string, signal?: AbortSignal): Promise<boolean> {
  const r = await run(python, ['-c', 'import sys;print(sys.version)'], 25_000, signal);
  return r.ok;
}

export interface WhisperInstallResult { python: string; version?: string; created: boolean; log: string[] }

/**
 * Garante o faster-whisper instalado. Se não houver, cria um venv isolado
 * (<workspace>/tools/whisper-venv) com um Python encontrado e instala via pip.
 * Não mexe no Python do ComfyUI.
 */
export async function ensureWhisper(s: Settings, opts: { log?: (l: string) => void; signal?: AbortSignal } = {}): Promise<WhisperInstallResult> {
  const logs: string[] = [];
  const log = (l: string) => { logs.push(l); opts.log?.(l); };
  const candidates = pythonCandidates(s);

  for (const py of candidates) {
    if (/[\\/]/.test(py) && !fs.existsSync(py)) continue;
    if (await hasFasterWhisper(py, opts.signal)) {
      if (s.whisper) s.whisper.python = py;
      return { python: py, created: false, log: logs };
    }
  }

  let base: string | undefined;
  for (const py of candidates) {
    if (/[\\/]/.test(py) && !fs.existsSync(py)) continue;
    if (await worksAsPython(py, opts.signal)) { base = py; break; }
  }
  if (!base) {
    throw new Error('Python não encontrado. Instale o Python 3.10+ (python.org) e tente de novo, ou aponte o campo "Python" para o python.exe.');
  }

  const dir = venvDir(s);
  const vp = venvPython(s);
  let created = false;
  if (!fs.existsSync(vp)) {
    log(`criando venv isolado em ${dir} com ${base}…`);
    const r = await run(base, ['-m', 'venv', dir], 180_000, opts.signal);
    if (!r.ok || !fs.existsSync(vp)) throw new Error(`falha ao criar o venv: ${(r.err || r.out).slice(-500)}`);
    created = true;
  }
  log('instalando faster-whisper (pip)… pode levar alguns minutos');
  const pip = await run(vp, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'faster-whisper'], 1_800_000, opts.signal);
  if (!pip.ok) throw new Error(`pip install faster-whisper falhou: ${(pip.err || pip.out).slice(-700)}`);

  const check = await run(vp, ['-c', 'import faster_whisper,sys;print(faster_whisper.__version__)'], 60_000, opts.signal);
  if (!check.ok) throw new Error(`faster-whisper não importou após instalar: ${(check.err || check.out).slice(-500)}`);
  s.whisper = { ...(s.whisper ?? { model: 'small', device: 'cpu' }), python: vp };
  log(`faster-whisper ${check.out.trim()} pronto`);
  return { python: vp, version: check.out.trim(), created, log: logs };
}

/** Caminho do venv (para o loadSettings detectar automaticamente). */
export const whisperVenvPython = venvPython;
