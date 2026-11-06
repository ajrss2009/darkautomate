import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WhisperConfig } from '../shared/types';

export interface WordTime { w: string; start: number; end: number }
export interface WordsFile { language?: string; text: string; words: WordTime[]; source: string }

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

export function transcribe(cfg: WhisperConfig, script: string, audio: string, out: string, language: string | undefined, signal: AbortSignal): Promise<WordsFile> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(script)) return reject(new Error(`script do Whisper não encontrado: ${script}`));
    const args = [script, audio, out, '--model', cfg.model || 'small', '--device', cfg.device || 'auto', ...(language ? ['--language', language] : [])];
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
