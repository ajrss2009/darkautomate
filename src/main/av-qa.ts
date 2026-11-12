import * as fs from 'node:fs';
import * as path from 'node:path';
import { run } from './ffmpeg';

/**
 * QA DE A/V: mede a duração dos dois streams do arquivo FINAL.
 *
 * É o teste que faltava no fim do render. A soma do erro por cena não aparece no
 * meio do vídeo — aparece no fim, comparando o que o arquivo tem com o que o
 * relógio (a timeline, em quadros) prometeu.
 */
export const AV_TOLERANCE = 0.05;

export interface AvQa {
  ok: boolean;
  limit: number;
  file: string;
  video: number;
  audio: number;
  /** audio − video, em segundos (positivo = som depois da imagem) */
  delta: number;
  frames?: number;
  fps?: number;
  checkedAt: string;
}

interface ProbeStream { codec_type?: string; duration?: string; nb_frames?: string; avg_frame_rate?: string }

/** Duração de cada stream do arquivo (lê o container, não estima). */
export async function probeStreams(ffprobe: string, file: string, signal?: AbortSignal): Promise<{ video: number; audio: number; frames?: number; fps?: number }> {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,duration,nb_frames,avg_frame_rate', '-of', 'json', file], signal);
  const j = JSON.parse(stdout) as { streams?: ProbeStream[] };
  const v = (j.streams ?? []).find((x) => x.codec_type === 'video');
  const a = (j.streams ?? []).find((x) => x.codec_type === 'audio');
  const [num, den] = (v?.avg_frame_rate ?? '').split('/').map(Number);
  const fps = num && den ? num / den : undefined;
  const frames = Number(v?.nb_frames) > 0 ? Number(v?.nb_frames) : undefined;
  return { video: Number(v?.duration) || 0, audio: Number(a?.duration) || 0, frames, fps };
}

/** Mede o A/V e grava `<outDir>/av-qa.json`. `ok=false` quando |áudio − vídeo| > 0,05 s. */
export async function checkAv(ffprobe: string, file: string, outDir?: string, signal?: AbortSignal): Promise<AvQa> {
  const s = await probeStreams(ffprobe, file, signal);
  const delta = +(s.audio - s.video).toFixed(6);
  const report: AvQa = {
    ok: !s.audio || !s.video || Math.abs(delta) <= AV_TOLERANCE + 1e-6,
    limit: AV_TOLERANCE,
    file,
    video: +s.video.toFixed(6),
    audio: +s.audio.toFixed(6),
    delta,
    frames: s.frames,
    fps: s.fps,
    checkedAt: new Date().toISOString(),
  };
  if (outDir) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'av-qa.json'), JSON.stringify(report, null, 1));
    } catch { /* se não deu para gravar, o log ainda leva o resultado */ }
  }
  return report;
}

/**
 * Conserta o que o QA reprovou: reescreve SÓ o áudio para a duração exata do vídeo
 * (preenche com silêncio se faltar, corta o resto se sobrar). Vídeo é copiado.
 */
export async function conformAv(ffmpeg: string, file: string, videoSeconds: number, signal?: AbortSignal): Promise<boolean> {
  if (!(videoSeconds > 0)) return false;
  const tmp = file.replace(/\.(\w+)$/, '.avfix.$1');
  try {
    await run(ffmpeg, ['-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy',
      '-af', `apad,atrim=duration=${videoSeconds.toFixed(6)}`, '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', tmp], signal);
    try { fs.renameSync(tmp, file); }
    catch { fs.copyFileSync(tmp, file); fs.rmSync(tmp, { force: true }); }
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* sem permissão: fica no temp */ }
    return false;
  }
}

/** Linha curta para o log. */
export function avQaLine(q: AvQa): string {
  const d = q.delta >= 0 ? '+' : '';
  const streams = `vídeo ${q.video.toFixed(3)} s · áudio ${q.audio.toFixed(3)} s (${d}${q.delta.toFixed(3)} s)`;
  return q.ok
    ? `QA de A/V: ${streams} — aprovado (limite ${q.limit.toFixed(2)} s)`
    : `QA de A/V REPROVADO: ${streams} — acima de ${q.limit.toFixed(2)} s`;
}
