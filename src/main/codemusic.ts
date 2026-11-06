import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Project, Settings } from '../shared/types';
import * as ff from './ffmpeg';
import { pluginsRoot } from './plugins';
import { pythonCandidates } from './whisper-install';

/**
 * Trilha PROGRAMÁTICA: música escrita em código, sem modelo de IA nem banco de músicas.
 *  1. mgaudio (plugin mg-styles-15): sintetizador profissional em Python (receitas por gênero, samples CC0);
 *  2. sintetizador interno no ffmpeg (sempre disponível): acordes, baixo, bateria e arpejo por clima.
 */

export const MOODS = ['explainer', 'ambient', 'darksynth', 'lofi', 'pop', 'chiptune', 'synthwave', 'techno', 'future_bass'] as const;
export type Mood = (typeof MOODS)[number];
export const MOOD_LABEL: Record<Mood, string> = {
  explainer: 'Explicativo (marimba, leve)', ambient: 'Ambiente (pad, documental)', darksynth: 'Tenso / mistério (darksynth)', lofi: 'Lo-fi', pop: 'Pop animado',
  chiptune: '8-bit (chiptune)', synthwave: 'Synthwave anos 80', techno: 'Techno minimal', future_bass: 'Future bass',
};

/** Clima da trilha: o pedido da etapa > estilo musical do projeto > tipo de vídeo. */
export function moodFor(p: Project, params: Record<string, unknown> = {}): Mood {
  const want = String(params['mood'] ?? params['recipe'] ?? '').toLowerCase();
  if ((MOODS as readonly string[]).includes(want)) return want as Mood;
  const txt = `${p.musicStyle ?? ''} ${p.skill?.steps?.['music'] ?? ''} ${p.skill?.global ?? ''}`.toLowerCase();
  if (/tens|suspens|mist[eé]r|investiga|sombri|dark|thriller|dossi/.test(txt)) return 'darksynth';
  if (/lo-?fi|chill|estud/.test(txt)) return 'lofi';
  if (/8-?bit|chiptune|pixel/.test(txt)) return 'chiptune';
  if (/synthwave|80s|retr[oô]/.test(txt)) return 'synthwave';
  const byType: Partial<Record<string, Mood>> = {
    stickman: 'explainer', flat_explainer: 'explainer', whiteboard: 'explainer', vector: 'explainer', low_poly: 'ambient', code_3d: 'ambient',
    motion_graphics: 'pop', pixel_art: 'chiptune', doc_netflix: 'ambient', realistic: 'ambient', slideshow: 'ambient', ms_paint: 'pop', vox_collage: 'lofi',
  };
  return byType[p.videoType] ?? 'explainer';
}

/* ───────── mgaudio (plugin) ───────── */

/** Pasta lib/audio de um plugin que traga o mgaudio (ex.: mg-styles-15). */
export function findMgAudio(s: Settings): string | undefined {
  const root = pluginsRoot(s);
  if (!fs.existsSync(root)) return undefined;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const lib = path.join(root, d.name, 'lib', 'audio');
    if (fs.existsSync(path.join(lib, 'mgaudio', '__init__.py'))) return lib;
  }
  return undefined;
}

const isWin = process.platform === 'win32';
export const mgVenvDir = (s: Settings) => path.join(s.workspace, 'tools', 'mgaudio-venv');
export const mgVenvPython = (s: Settings) => path.join(mgVenvDir(s), isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
const MG_PACKAGES = ['numpy', 'scipy', 'soundfile', 'numba', 'pedalboard', 'pyloudnorm'];
const MG_CHECK = 'import numpy,scipy,soundfile,numba,pedalboard,pyloudnorm;print("ok")';

function run(exe: string, args: string[], o: { timeoutMs: number; signal?: AbortSignal; cwd?: string; onLine?: (l: string) => void }): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    let out = '', err = '';
    let child;
    try { child = spawn(exe, args, { cwd: o.cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); }
    catch (e) { resolve({ ok: false, out: '', err: (e as Error).message }); return; }
    const kill = () => { try { child.kill('SIGKILL'); } catch { /* ignora */ } };
    const timer = setTimeout(kill, o.timeoutMs);
    o.signal?.addEventListener('abort', kill, { once: true });
    const lines = (d: Buffer) => { for (const l of d.toString().split(/\r?\n/)) if (l.trim()) o.onLine?.(l.trim()); };
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); lines(d); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, out, err: `${err}\n${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); o.signal?.removeEventListener('abort', kill); resolve({ ok: code === 0, out, err }); });
  });
}

/** Python com as dependências do mgaudio: o venv do app ou, na falta, cria o venv e instala (uma vez). */
export async function ensureMgAudio(s: Settings, o: { log?: (l: string) => void; signal?: AbortSignal; install?: boolean } = {}): Promise<string> {
  const log = o.log ?? (() => {});
  const vp = mgVenvPython(s);
  if (fs.existsSync(vp) && (await run(vp, ['-c', MG_CHECK], { timeoutMs: 120_000, signal: o.signal })).ok) return vp;
  if (o.install === false) throw new Error('dependências do mgaudio não instaladas (Plugins → Instalar áudio)');
  let base: string | undefined;
  for (const py of pythonCandidates(s)) {
    if (py === vp) continue;
    const r = await run(py, ['-c', 'import sys;print(sys.version_info[0]*100+sys.version_info[1])'], { timeoutMs: 30_000, signal: o.signal });
    if (r.ok && Number(r.out.trim()) >= 310) { base = py; break; }
  }
  if (!base) throw new Error('nenhum Python 3.10+ encontrado para o mgaudio');
  if (!fs.existsSync(vp)) {
    log(`criando ambiente Python do áudio em ${mgVenvDir(s)}…`);
    const r = await run(base, ['-m', 'venv', mgVenvDir(s)], { timeoutMs: 300_000, signal: o.signal });
    if (!r.ok) throw new Error(`venv falhou: ${r.err.slice(-300)}`);
  }
  log(`instalando ${MG_PACKAGES.join(', ')} (só na primeira vez)…`);
  const pip = await run(vp, ['-m', 'pip', 'install', '--disable-pip-version-check', ...MG_PACKAGES], { timeoutMs: 1_200_000, signal: o.signal, onLine: (l) => { if (/Successfully|Installing|error/i.test(l)) log(l.slice(0, 160)); } });
  if (!pip.ok) throw new Error(`pip falhou: ${pip.err.slice(-400)}`);
  if (!(await run(vp, ['-c', MG_CHECK], { timeoutMs: 120_000, signal: o.signal })).ok) throw new Error('mgaudio: dependências instaladas mas não importam');
  return vp;
}

const MG_SCRIPT = [
  'import sys, json',
  'cfg = json.load(open(sys.argv[1], encoding="utf-8"))',
  'sys.path.insert(0, cfg["lib"])',
  'from mgaudio import recipes',
  'kw = dict(cfg.get("kw") or {})',
  'm = recipes.RECIPES[cfg["recipe"]](duration=float(cfg["duration"]), **kw)',
  'print("forma", m.form.summary())',
  'm.export(cfg["out"], lufs=float(cfg.get("lufs", -16)))',
  'print("ok")',
].join('\n');

async function renderMgAudio(s: Settings, lib: string, mood: string, duration: number, out: string, o: { signal?: AbortSignal; log: (l: string) => void }): Promise<void> {
  const py = await ensureMgAudio(s, { log: o.log, signal: o.signal });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-mg-'));
  try {
    fs.writeFileSync(path.join(tmp, 'render.py'), MG_SCRIPT, 'utf8');
    /* vídeos longos: o "drop" (parte cheia) começa cedo; senão a introdução duraria minutos */
    const kw: Record<string, unknown> = duration > 40 ? { drop: Math.min(16, duration * 0.25) } : {};
    fs.writeFileSync(path.join(tmp, 'cfg.json'), JSON.stringify({ lib, recipe: mood, duration, kw, out, lufs: -16 }), 'utf8');
    const r = await run(py, [path.join(tmp, 'render.py'), path.join(tmp, 'cfg.json')], { timeoutMs: Math.max(600_000, duration * 4000), signal: o.signal, cwd: lib, onLine: (l) => { if (/^forma|^ok|mgaudio/.test(l)) o.log(l.slice(0, 200)); } });
    if (!r.ok || !fs.existsSync(out)) throw new Error(`mgaudio falhou: ${(r.err || r.out).slice(-400)}`);
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ok */ } }
}

/* ───────── sintetizador interno (ffmpeg) ───────── */

interface Synth { bpm: number; chords: number[][]; kick: boolean; hat: boolean; arp: boolean; square?: boolean }
const SYNTHS: Record<Mood, Synth> = {
  explainer: { bpm: 112, chords: [[293.66, 369.99, 440], [220, 277.18, 329.63], [246.94, 293.66, 369.99], [196, 246.94, 293.66]], kick: true, hat: true, arp: true },
  ambient: { bpm: 72, chords: [[164.81, 207.65, 246.94], [138.59, 164.81, 207.65], [220, 277.18, 329.63], [246.94, 311.13, 369.99]], kick: false, hat: false, arp: false },
  darksynth: { bpm: 100, chords: [[146.83, 174.61, 220], [155.56, 196, 233.08], [146.83, 174.61, 220], [130.81, 164.81, 196]], kick: true, hat: true, arp: true },
  lofi: { bpm: 80, chords: [[196, 233.08, 293.66], [130.81, 164.81, 233.08], [174.61, 220, 261.63], [146.83, 174.61, 220]], kick: true, hat: true, arp: false },
  pop: { bpm: 120, chords: [[261.63, 329.63, 392], [196, 246.94, 293.66], [220, 261.63, 329.63], [174.61, 220, 261.63]], kick: true, hat: true, arp: true },
  chiptune: { bpm: 140, chords: [[261.63, 329.63, 392], [196, 246.94, 293.66], [220, 261.63, 329.63], [174.61, 220, 261.63]], kick: true, hat: true, arp: true, square: true },
  synthwave: { bpm: 100, chords: [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]], kick: true, hat: true, arp: true },
  techno: { bpm: 124, chords: [[220, 261.63, 329.63], [220, 261.63, 329.63], [146.83, 174.61, 220], [220, 261.63, 329.63]], kick: true, hat: true, arp: false },
  future_bass: { bpm: 140, chords: [[196, 246.94, 293.66], [220, 277.18, 329.63], [185, 220, 277.18], [246.94, 293.66, 369.99]], kick: true, hat: true, arp: true },
};

/** Expressão do aevalsrc: acordes (pad), baixo, bombo, chimbal e arpejo, trocando de acorde a cada compasso. */
export function synthExpr(m: Synth): string {
  const B = (60 / m.bpm).toFixed(5), BAR = ((60 / m.bpm) * 4).toFixed(5);
  const pick = (k: number) => m.chords.reduceRight((acc, ch, i) => (i === m.chords.length - 1 ? ch[k]!.toFixed(2) : `if(eq(ld(0),${i}),${ch[k]!.toFixed(2)},${acc})`), '');
  const osc = (f: string) => (m.square ? `0.6*sgn(sin(2*PI*${f}*t))` : `sin(2*PI*${f}*t)`);
  const parts = [
    `st(0,mod(floor(t/${BAR}),${m.chords.length}))`,
    `st(1,mod(t,${B}))`,
    `st(2,(${[0, 1, 2].map((k) => osc(pick(k))).join('+')})*0.07*(0.75+0.25*sin(2*PI*0.2*t)))`,
    `st(3,0.16*sin(2*PI*${pick(0)}/2*t)*(0.5+0.5*exp(-3*ld(1))))`,
    m.kick ? `st(4,0.45*sin(2*PI*(45+70*exp(-28*ld(1)))*ld(1))*exp(-8*ld(1)))` : 'st(4,0)',
    m.hat ? `st(5,0.035*(random(0)*2-1)*exp(-70*mod(t+${B}/2,${B})))` : 'st(5,0)',
    m.arp ? `st(6,0.06*${osc(`if(eq(mod(floor(t/(${B}/2)),3),0),${pick(0)},if(eq(mod(floor(t/(${B}/2)),3),1),${pick(1)},${pick(2)}))*2`)}*exp(-5*mod(t,${B}/2)))` : 'st(6,0)',
    'ld(2)+ld(3)+ld(4)+ld(5)+ld(6)',
  ];
  return parts.join(';');
}

async function renderSynth(ffmpeg: string, mood: Mood, duration: number, out: string, signal?: AbortSignal): Promise<void> {
  const d = duration.toFixed(2);
  const src = `aevalsrc='${synthExpr(SYNTHS[mood])}':s=22050:d=${d}`;
  const af = `aresample=44100,lowpass=f=7000,aecho=0.8:0.6:60|120:0.25|0.15,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, duration - 3).toFixed(2)}:d=3,loudnorm=I=-16:TP=-1.5`;
  await ff.run(ffmpeg, ['-y', '-f', 'lavfi', '-i', src, '-af', af, '-ac', '2', '-ar', '44100', out], signal);
}

export interface CodeMusicResult { engine: 'mgaudio' | 'interno'; mood: string; file: string }

/** Gera a trilha programática com a duração do vídeo. `engine`: auto (mgaudio se houver o plugin), mgaudio ou interno. */
export async function renderCodeMusic(s: Settings, o: { mood: Mood | string; duration: number; out: string; engine?: 'auto' | 'mgaudio' | 'interno'; signal?: AbortSignal; log: (l: string) => void }): Promise<CodeMusicResult> {
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  const wav = o.out.replace(/\.[a-z0-9]+$/i, '') + '.wav';
  const lib = o.engine === 'interno' ? undefined : findMgAudio(s);
  if (lib) {
    try {
      o.log(`trilha programática: mgaudio "${o.mood}" (${o.duration.toFixed(0)} s)`);
      await renderMgAudio(s, lib, o.mood, o.duration, wav, o);
      return { engine: 'mgaudio', mood: o.mood, file: wav };
    } catch (e) {
      if (o.engine === 'mgaudio') throw e;
      o.log(`mgaudio indisponível (${(e as Error).message.slice(0, 160)}) — usando o sintetizador interno`);
    }
  } else if (o.engine === 'mgaudio') throw new Error('instale o plugin mg-styles-15 (traz o mgaudio)');
  o.log(`trilha programática: sintetizador interno "${o.mood}" (${o.duration.toFixed(0)} s)`);
  const mood: Mood = (MOODS as readonly string[]).includes(o.mood) ? o.mood as Mood : 'explainer';
  await renderSynth(s.ffmpeg, mood, o.duration, wav, o.signal);
  return { engine: 'interno', mood: o.mood, file: wav };
}
