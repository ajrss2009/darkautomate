import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WhisperConfig } from '../shared/types';

export interface WordTime { w: string; start: number; end: number }
/**
 * `source`: 'align' = alinhado ao roteiro sobre o stem de narração final (o que vale);
 * 'faster-whisper' = transcrição por cena (antiga); 'estimate' = sem Whisper.
 * `audio*` identificam o áudio em que os tempos foram medidos: se ele mudar, o arquivo
 * é inválido e o passo sabe disso.
 */
export interface WordsFile {
  language?: string; text: string; words: WordTime[]; source: string;
  audio?: string; audioDuration?: number; audioMtimeMs?: number; audioBytes?: number;
  sceneStart?: number;
}

/** Distribui o tempo do áudio pelas palavras proporcionalmente ao tamanho (fallback sem Whisper). */
export function estimateWords(text: string, durationSec: number): WordsFile {
  const toks = text.split(/\s+/).filter(Boolean);
  const total = toks.reduce((a, t) => a + t.length + 1, 0) || 1;
  let acc = 0;
  const words = toks.map((w) => {
    const start = (acc / total) * durationSec; acc += w.length + 1;
    return { w, start: +start.toFixed(3), end: +((acc / total) * durationSec).toFixed(3) };
  });
  return { text, words, source: 'estimate' };
}

export function transcribe(cfg: WhisperConfig, script: string, audio: string, out: string, language: string | undefined, signal: AbortSignal, opts: { prompt?: string; noVad?: boolean } = {}): Promise<WordsFile> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(script)) return reject(new Error(`script do Whisper não encontrado: ${script}`));
    const args = [script, audio, out, '--model', cfg.model || 'small', '--device', cfg.device || 'auto', ...(language ? ['--language', language] : [])];
    /* sem VAD: o filtro de silêncio do faster-whisper desloca os tempos do arquivo;
       com o roteiro como prompt, a grafia e a pontuação vêm do texto (alinhamento forçado) */
    args.push('--no-vad');
    const prompt = (opts.prompt ?? '').replace(/\s+/g, ' ').trim();
    if (prompt && opts.noVad !== false) args.push('--prompt', prompt.slice(0, 4000));
    const child = spawn(cfg.python || 'python', args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let err = '';
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    const abort = () => { child.kill('SIGKILL'); reject(new Error('cancelado')); };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', (e) => reject(new Error(`não foi possível executar "${cfg.python}": ${e.message}`)));
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (code !== 0) return reject(new Error(`whisper saiu com código ${code}: ${err.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`));
      try { resolve(JSON.parse(fs.readFileSync(out, 'utf8')) as WordsFile); } catch (e) { reject(new Error(`saída do whisper inválida: ${(e as Error).message}`)); }
    });
  });
}

/** Resumo compacto para prompts: agrupa palavras em trechos com tempo. */
export function wordsDigest(f: WordsFile, maxChunks = 40): string {
  const chunks: string[] = [];
  const per = Math.max(1, Math.ceil(f.words.length / maxChunks));
  for (let i = 0; i < f.words.length; i += per) {
    const part = f.words.slice(i, i + per);
    chunks.push(`${part[0]!.start.toFixed(2)}s–${part[part.length - 1]!.end.toFixed(2)}s: ${part.map((x) => x.w).join(' ')}`);
  }
  return chunks.join('\n');
}
export const readWords = (file: string): WordsFile | undefined => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as WordsFile; } catch { return undefined; }
};
export const wordsPath = (sceneDir: string) => path.join(sceneDir, 'audio', 'words.json');

/** Marca a transcrição com o áudio em que os tempos foram medidos (invalidação). */
export function stampWords(w: WordsFile, audioPath: string | undefined, seconds?: number): WordsFile {
  let mtimeMs: number | undefined, bytes: number | undefined;
  try { if (audioPath) { const st = fs.statSync(audioPath); mtimeMs = st.mtimeMs; bytes = st.size; } } catch { /* arquivo sumiu */ }
  return { ...w, audio: audioPath ? path.basename(audioPath) : undefined, audioDuration: seconds, audioMtimeMs: mtimeMs, audioBytes: bytes };
}

/** Palavras de uma janela do stem (tempo absoluto → tempo da cena), sem cruzar a fronteira. */
export function cutWords(words: WordTime[], from: number, to: number): WordTime[] {
  const out: WordTime[] = [];
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    if (mid < from || mid >= to) continue;
    const start = Math.max(0, w.start - from), end = Math.min(to - from, w.end - from);
    if (end <= start) continue;
    out.push({ w: w.w, start: +start.toFixed(3), end: +end.toFixed(3) });
  }
  return out;
}

/**
 * O words.json ainda descreve este áudio? Compara o nome do arquivo, o tamanho/modificação
 * e a duração em que os tempos foram medidos — se a narração mudou (silence-trim, nova voz,
 * velocidade), o arquivo é inválido e a transcrição é refeita.
 */
export function wordsFresh(w: WordsFile | undefined, audioPath: string | undefined, seconds?: number): boolean {
  if (!w || !Array.isArray(w.words) || w.source !== 'align') return false;
  const name = audioPath ? path.basename(audioPath) : '';
  if ((w.audio ?? '') !== name) return false;
  if (seconds !== undefined && w.audioDuration !== undefined && Math.abs(w.audioDuration - seconds) > 0.05) return false;
  if (audioPath) {
    try {
      const st = fs.statSync(audioPath);
      if (w.audioMtimeMs !== undefined && st.mtimeMs !== w.audioMtimeMs) return false;
      if (w.audioBytes !== undefined && st.size !== w.audioBytes) return false;
    } catch { return false; }
  }
  return true;
}

