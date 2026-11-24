import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Beat grid da música (catálogo, Parte XX/LVII): BPM, batidas e tempos fortes (1 de cada compasso 4/4).
 * Análise em JS puro sobre o PCM do ffmpeg — envelope de ataques (fluxo de energia), autocorrelação para o
 * andamento e fase que mais casa com os ataques. O resultado fica ao lado da música (<arquivo>.beats.json),
 * reaproveitado enquanto o arquivo não mudar.
 */
export interface BeatGrid { bpm: number; beats: number[]; downbeats: number[]; duration: number; confidence: number; source?: string }

const RATE = 11025;
const HOP = 256;                       // ~23 ms por quadro do envelope
const FPS = RATE / HOP;

/** Áudio mono float32 a 11 025 Hz (só leitura, síncrono: até ~10 min cabem com folga). */
export function decodeMono(ffmpeg: string, file: string, start?: number, dur?: number): Float32Array {
  const args = ['-v', 'error', ...(start ? ['-ss', String(start)] : []), '-i', file, ...(dur ? ['-t', String(dur)] : []), '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'];
  const buf = execFileSync(ffmpeg, args, { maxBuffer: 1024 * 1024 * 400, windowsHide: true });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/** Envelope de ataques: aumento positivo do log da energia por quadro, normalizado e sem a média local. */
export function onsetEnvelope(x: Float32Array): Float32Array {
  const n = Math.floor(x.length / HOP);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, prev = 0;
    /* energia com leve ênfase nos agudos (diferença de 1ª ordem): bumbo E caixa/pratos contam */
    for (let j = i * HOP; j < (i + 1) * HOP; j++) { const v = x[j]!; const d = v - prev; prev = v; s += v * v * 0.5 + d * d; }
    e[i] = Math.log(1e-6 + s);
  }
  const o = new Float32Array(n);
  for (let i = 1; i < n; i++) o[i] = Math.max(0, e[i]! - e[i - 1]!);
  /* tira a média móvel (~0,5 s) para o envelope não seguir o volume */
  const w = Math.round(FPS * 0.25);
  const out = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += o[i]!; if (i - 2 * w - 1 >= 0) acc -= o[i - 2 * w - 1]!;
    const lo = Math.max(0, i - 2 * w), mean = acc / (i - lo + 1);
    out[i] = Math.max(0, o[i]! - mean);
  }
  let max = 0; for (const v of out) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < n; i++) out[i] = out[i]! / max;
  return out;
}

/** BPM por autocorrelação do envelope (70–180), com leve preferência por ~120 e checagem do dobro/metade. */
export function estimateBpm(env: Float32Array, fps = FPS, min = 70, max = 180): { bpm: number; confidence: number } {
  const lagMin = Math.floor((60 * fps) / max), lagMax = Math.ceil((60 * fps) / min);
  const ac = (lag: number) => { let s = 0; for (let i = lag; i < env.length; i++) s += env[i]! * env[i - lag]!; return s / Math.max(1, env.length - lag); };
  let best = 0, bestLag = lagMin, total = 0, count = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = (60 * fps) / lag;
    const pref = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));   // prior log-normal em 120 BPM
    /* reforço dos múltiplos (2× e 3× o período) — andamento real tem picos nos compassos também */
    const v = (ac(lag) + 0.5 * ac(lag * 2) + 0.25 * ac(lag * 3)) * (0.6 + 0.4 * pref);
    total += v; count++;
    if (v > best) { best = v; bestLag = lag; }
  }
  /* refino sub-quadro: parábola nos vizinhos */
  const a = ac(bestLag - 1), b = ac(bestLag), c = ac(bestLag + 1);
  const den = a - 2 * b + c;
  const lag = den !== 0 ? bestLag + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : bestLag;
  const confidence = count ? Math.min(1, best / (total / count) / 4) : 0;
  return { bpm: Math.round(((60 * fps) / lag) * 10) / 10, confidence: Math.round(confidence * 100) / 100 };
}

/** Batidas: fase que maximiza o envelope sobre a grade do BPM; depois cada batida "puxa" para o ataque mais forte perto dela. */
export function beatTimes(env: Float32Array, bpm: number, duration: number, fps = FPS): { beats: number[]; downbeats: number[] } {
  const period = (60 * fps) / bpm;
  const at = (f: number) => { const i = Math.round(f); return i >= 0 && i < env.length ? env[i]! : 0; };
  let bestPhase = 0, best = -1;
  for (let ph = 0; ph < period; ph += 0.5) {
    let s = 0; for (let f = ph; f < env.length; f += period) s += at(f);
    if (s > best) { best = s; bestPhase = ph; }
  }
  const tol = Math.max(1, Math.round(period * 0.2));
  const frames: number[] = [];
  /* segue a música: a próxima batida é prevista a partir da anterior já ajustada (sem acumular erro do BPM) */
  for (let f = bestPhase; f < env.length; ) {
    let bi = Math.round(f), bv = at(f);
    for (let d = -tol; d <= tol; d++) if (at(f + d) > bv * 1.15) { bv = at(f + d); bi = Math.round(f + d); }
    frames.push(bi);
    f = (bv > 0.05 ? bi : f) + period;
  }
  const beats = frames.map((f) => Math.round((f / fps) * 1000) / 1000).filter((t) => t >= 0 && t <= duration + 0.01);
  /* tempo forte: das 4 fases do compasso, a que tem mais energia */
  let bestBar = 0, bestE = -1;
  for (let k = 0; k < 4; k++) { let s = 0; for (let i = k; i < frames.length; i += 4) s += at(frames[i]!); if (s > bestE) { bestE = s; bestBar = k; } }
  return { beats, downbeats: beats.filter((_, i) => i % 4 === bestBar) };
}

/** Analisa a música (ou um trecho); usa o cache <arquivo>.beats.json quando o arquivo não mudou. */
export function analyzeBeats(ffmpeg: string, file: string, opts: { cache?: boolean } = {}): BeatGrid {
  const cache = `${file}.beats.json`;
  const st = fs.statSync(file);
  const key = `${st.size}:${Math.round(st.mtimeMs)}`;
  if (opts.cache !== false) {
    try { const c = JSON.parse(fs.readFileSync(cache, 'utf8')) as BeatGrid & { key?: string }; if (c.key === key && c.beats?.length) return c; } catch { /* sem cache */ }
  }
  const x = decodeMono(ffmpeg, file);
  const duration = x.length / RATE;
  const env = onsetEnvelope(x);
  const { bpm, confidence } = estimateBpm(env);
  const { beats, downbeats } = beatTimes(env, bpm, duration);
  /* BPM final pela média dos intervalos entre as batidas seguidas pela música (mais fiel que a autocorrelação) */
  const span = beats.length > 8 ? (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1) : 0;
  const grid: BeatGrid = { bpm: span > 0 && Math.abs(60 / span - bpm) < bpm * 0.06 ? Math.round((60 / span) * 10) / 10 : bpm, beats, downbeats, duration: Math.round(duration * 1000) / 1000, confidence, source: path.basename(file) };
  if (opts.cache !== false) { try { fs.writeFileSync(cache, JSON.stringify({ ...grid, key }, null, 1)); } catch { /* pasta só leitura */ } }
  return grid;
}

/**
 * Encaixa os cortes no beat: cada fronteira entre cenas vai para a batida mais próxima (tempo forte preferido),
 * respeitando a duração mínima e máxima de cada cena. A última termina no fim do total.
 * Devolve as durações novas e quantos cortes ficaram no beat.
 */
export function snapToBeats(durations: number[], grid: Pick<BeatGrid, 'beats' | 'downbeats' | 'bpm'>, opts: { total?: number; minSec?: number; maxSec?: number; locked?: boolean[] } = {}): { durations: number[]; snapped: number } {
  const n = durations.length;
  if (n < 2 || !grid.beats.length) return { durations: [...durations], snapped: 0 };
  const period = 60 / grid.bpm;
  const minSec = opts.minSec ?? Math.max(0.8, period);
  const maxSec = opts.maxSec ?? Infinity;
  const total = opts.total ?? durations.reduce((a, b) => a + b, 0);
  const down = new Set(grid.downbeats.map((t) => Math.round(t * 1000)));
  const bounds: number[] = [];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) { acc += durations[i]!; bounds.push(acc); }
  const out: number[] = [];
  let prev = 0, snapped = 0;
  for (let i = 0; i < bounds.length; i++) {
    const target = bounds[i]!;
    if (opts.locked?.[i]) { out.push(round(target - prev)); prev = target; continue; }
    const remaining = n - 1 - i;                    // cenas depois desta fronteira
    const lo = prev + minSec, hi = Math.min(prev + maxSec, total - remaining * minSec);
    let best: number | undefined, bestCost = Infinity;
    for (const b of grid.beats) {
      if (b < lo - 1e-6 || b > hi + 1e-6) continue;
      const dist = Math.abs(b - target);
      if (dist > period * 1.01) continue;          // no máximo 1 batida de deslocamento
      const cost = dist - (down.has(Math.round(b * 1000)) ? period * 0.35 : 0);
      if (cost < bestCost) { bestCost = cost; best = b; }
    }
    const cut = best ?? Math.min(Math.max(target, lo), hi);
    if (best !== undefined) snapped++;
    out.push(round(cut - prev)); prev = cut;
  }
  out.push(round(Math.max(minSec * 0.5, total - prev)));
  return { durations: out, snapped };
}
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Cortes que caem no beat (± tolerância, padrão 1 quadro a 24 fps) — QA do catálogo. */
export function cutsOnBeat(durations: number[], beats: number[], tol = 1 / 24): { onBeat: number; cuts: number } {
  let acc = 0, on = 0;
  for (let i = 0; i < durations.length - 1; i++) { acc += durations[i]!; if (beats.some((b) => Math.abs(b - acc) <= tol + 1e-6)) on++; }
  return { onBeat: on, cuts: Math.max(0, durations.length - 1) };
}

/** "mm:ss", "1:02:05", "32", "32.5" → segundos (undefined se vazio/ inválido). */
export function parseClock(s: string | number | undefined): number | undefined {
  if (typeof s === 'number') return Number.isFinite(s) && s >= 0 ? s : undefined;
  const t = String(s ?? '').trim().replace(',', '.');
  if (!t) return undefined;
  const parts = t.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return undefined;
  return parts.reduce((a, p) => a * 60 + p, 0);
}

/** Trecho da música (início → fim) num arquivo próprio, com fade curto nas pontas; devolve o caminho e a duração. */
export function cutMusicSegment(ffmpeg: string, file: string, outDir: string, start: number, end: number): { file: string; seconds: number } {
  if (!(end > start)) throw new Error(`trecho da música inválido: fim (${end}s) deve ser depois do início (${start}s)`);
  const seconds = round(end - start);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `trecho-${Math.round(start * 10)}-${Math.round(end * 10)}.mp3`);
  const fade = Math.min(0.3, seconds / 10);
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-ss', String(start), '-t', String(seconds), '-i', file,
    '-af', `afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, seconds - fade)}:d=${fade}`, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '2', out], { windowsHide: true });
  return { file: out, seconds };
}
