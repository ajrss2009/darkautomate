import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, Settings } from '../shared/types';
import * as ff from './ffmpeg';
import { transcribe } from './whisper';

const TEXT_EXT = /\.(txt|md|markdown|srt|vtt|json|csv|html?)$/i;
const MEDIA_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|m4a|ogg|flac|aac)$/i;
const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|gif)$/i;

/** Remove numeração e tempos de SRT/VTT, deixando só o texto falado. */
export function subtitleToText(raw: string): string {
  return raw.replace(/\r/g, '').split('\n')
    .filter((l) => !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^WEBVTT/i.test(l.trim()) && !/^(NOTE|STYLE|REGION)\b/.test(l.trim()))
    .map((l) => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export interface RefInput { scriptFile?: string; videoFile?: string }

/**
 * Copia os arquivos de referência para <projeto>/reference/, extrai o texto do roteiro
 * (ou transcreve com Whisper, se for áudio/vídeo) e tira quadros-chave do vídeo de referência.
 * Falhas não impedem a criação do projeto: ficam registradas em `note`.
 */
export async function prepareReferences(s: Settings, p: Project, projectDir: string, input: RefInput, toolsDir: string, signal: AbortSignal): Promise<Project> {
  const dir = path.join(projectDir, 'reference');
  if (input.scriptFile) {
    const src = input.scriptFile;
    if (!fs.existsSync(src)) throw new Error(`roteiro de referência não encontrado: ${src}`);
    fs.mkdirSync(dir, { recursive: true });
    const copy = path.join(dir, 'script-ref' + path.extname(src).toLowerCase());
    fs.copyFileSync(src, copy);
    const textFile = path.join(dir, 'script-ref.txt');
    p.refScript = { file: copy };
    try {
      if (TEXT_EXT.test(src)) {
        const raw = fs.readFileSync(src, 'utf8');
        fs.writeFileSync(textFile, /\.(srt|vtt)$/i.test(src) ? subtitleToText(raw) : raw);
        p.refScript.textFile = textFile;
      } else if (MEDIA_EXT.test(src)) {
        if (!s.whisper?.python) throw new Error('Whisper não configurado (Configurações → Whisper)');
        const wav = path.join(dir, 'script-ref.wav');
        await ff.run(s.ffmpeg, ['-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', wav], signal);
        const w = await transcribe(s.whisper, path.join(toolsDir, 'whisper_words.py'), wav, path.join(dir, 'script-ref.words.json'), p.language, signal);
        fs.writeFileSync(textFile, w.text || w.words.map((x) => x.w).join(' '));
        p.refScript.textFile = textFile; p.refScript.transcribed = true;
      } else {
        p.refScript.note = 'formato não lido automaticamente; use .txt, .md, .srt, .vtt ou um áudio/vídeo para transcrever';
      }
    } catch (e) { p.refScript.note = (e as Error).message; }
  }
  if (input.videoFile) {
    const src = input.videoFile;
    if (!fs.existsSync(src)) throw new Error(`vídeo de referência não encontrado: ${src}`);
    if (!VIDEO_EXT.test(src)) throw new Error('vídeo de referência: use mp4, mov, mkv, webm, avi, m4v ou gif');
    fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
    const copy = path.join(dir, 'video-ref' + path.extname(src).toLowerCase());
    fs.copyFileSync(src, copy);
    p.refVideo = { file: copy, frames: [] };
    try {
      const d = await ff.duration(s.ffprobe, copy);
      p.refVideo.durationSec = d || undefined;
      const n = 8;
      for (let i = 0; i < n; i++) {
        const t = d > 0 ? (d * (i + 0.5)) / n : i;
        const out = path.join(dir, 'frames', `f${String(i + 1).padStart(2, '0')}.jpg`);
        try { await ff.run(s.ffmpeg, ['-y', '-ss', t.toFixed(2), '-i', copy, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', out], signal); if (fs.existsSync(out)) p.refVideo.frames.push(out); }
        catch { if (d <= 0) break; }
      }
      if (!p.refVideo.frames.length) p.refVideo.note = 'não foi possível extrair quadros (ffmpeg)';
    } catch (e) { p.refVideo.note = (e as Error).message; }
  }
  return p;
}
