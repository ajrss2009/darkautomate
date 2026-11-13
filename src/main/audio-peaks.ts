import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * PICOS DE ÁUDIO para a forma de onda da timeline — 40 por segundo, mínimo e máximo
 * por balde, decodificados por um passe de ffmpeg (mono, 8 kHz, s16le).
 *
 * O cache mora ao lado do arquivo (`narracao.wav.peaks.json`) com mtime e tamanho:
 * mudou o áudio, recalcula; deu zoom, redesenha do mesmo array. Uma decodificação
 * por arquivo, nunca por zoom.
 */
export interface Peaks { rate: number; peaks: Array<[number, number]> }

const RATE = 40;
const RATE_HZ = 8000;
const PER = RATE_HZ / RATE; // 200 amostras por balde

export async function audioPeaks(ffmpeg: string, file: string, signal?: AbortSignal): Promise<Peaks> {
  if (!fs.existsSync(file)) throw new Error(`áudio não encontrado: ${file}`);
  const st = fs.statSync(file);
  const cache = `${file}.peaks.json`;
  try {
    const j = JSON.parse(fs.readFileSync(cache, 'utf8')) as { mtimeMs: number; size: number; rate: number; peaks: Array<[number, number]> };
    if (j.mtimeMs === st.mtimeMs && j.size === st.size && j.rate === RATE && Array.isArray(j.peaks)) return { rate: RATE, peaks: j.peaks };
  } catch { /* sem cache válido: decodifica */ }

  const raw = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.peaks.raw`);
  try {
    await new Promise<void>((resolve, reject) => {
      const c = spawn(ffmpeg, ['-y', '-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE_HZ), '-f', 's16le', raw], { windowsHide: true });
      let err = '';
      c.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      const abort = () => c.kill();
      signal?.addEventListener('abort', abort, { once: true });
      c.on('error', (e) => reject(new Error(`peaks: ${e.message}`)));
      c.on('close', (code) => {
        signal?.removeEventListener('abort', abort);
        code === 0 ? resolve() : reject(new Error(`peaks: ffmpeg saiu com ${code} ${err.slice(-200)}`));
      });
    });
    const buf = fs.readFileSync(raw);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const samples = new Int16Array(ab);
    const peaks: Array<[number, number]> = [];
    for (let i = 0; i + PER <= samples.length; i += PER) {
      let lo = 0, hi = 0;
      for (let k = i; k < i + PER; k++) { const v = samples[k]!; if (v < lo) lo = v; if (v > hi) hi = v; }
      peaks.push([+(lo / 32768).toFixed(4), +(hi / 32768).toFixed(4)]);
    }
    try { fs.writeFileSync(cache, JSON.stringify({ mtimeMs: st.mtimeMs, size: st.size, rate: RATE, peaks })); } catch { /* sem cache */ }
    return { rate: RATE, peaks };
  } finally {
    try { fs.rmSync(raw, { force: true }); } catch { /* arquivo temporário */ }
  }
}
