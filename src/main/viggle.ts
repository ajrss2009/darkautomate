import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Attachment, Project, Settings } from '../shared/types';
import * as ff from './ffmpeg';

/*
 * REMAKE DE VÍDEO CURTO COM O VIGGLE (Wan2GP): troca personagens (Viggle Remake Swap) ou objetos/cenário/luz
 * (Viggle Remake Edit) mantendo movimento, câmera, tempo e som do vídeo original.
 * Entradas: o vídeo curto anexado, UM quadro desse vídeo já editado (anexado, ou feito no Flow a partir do quadro
 * original + fotos de referência) e o prompt nas 6 seções do Viggle (escrito pela etapa de roteiro).
 * Funções puras aqui; a execução (Flow, Wan2GP) fica no executor.
 */

export type ViggleMode = 'swap' | 'edit';
export const VIGGLE_MODEL: Record<ViggleMode, string> = { swap: 'viggle_remake', edit: 'viggle_remake_edit' };
export const VIGGLE_SECTIONS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'] as const;

/** Vídeo de origem (1º anexo de vídeo para cena) e quadro já editado (imagem anexada com nota "quadro editado"). */
export function viggleInputs(p: Pick<Project, 'attachments'>): { video?: Attachment; editedFrame?: Attachment; refs: Attachment[] } {
  const att = p.attachments ?? [];
  const video = att.find((a) => a.kind === 'video');
  const isEdited = (a: Attachment) => /quadro editado|frame editado|edited frame|keyframe/i.test(`${a.note ?? ''} ${a.file}`);
  const editedFrame = att.find((a) => a.kind === 'image' && isEdited(a));
  const refs = att.filter((a) => a.kind === 'image' && !isEdited(a));
  return { video, editedFrame, refs };
}

/** Modo pelo texto do pedido: troca de pessoa/personagem = swap; objeto, cenário, clima, luz, estilo = edit. */
export function viggleMode(idea: string, forced?: string): ViggleMode {
  if (forced === 'swap' || forced === 'edit') return forced;
  return /personagem|pessoa|ator|atriz|rosto|criador|apresentador|character|person|actor|substitu[ia] (o|a) (homem|mulher|menino|menina|garoto|garota)/i.test(idea) ? 'swap' : 'edit';
}

/** O prompt do script.md tem as 6 seções? Senão monta um básico a partir do pedido (o Viggle exige as seções). */
export function viggleprompt(script: string | undefined, idea: string, mode: ViggleMode, seconds: number): string {
  const txt = (script ?? '').replace(/\r\n/g, '\n');
  const start = txt.indexOf('subject_definitions:');
  if (start >= 0 && VIGGLE_SECTIONS.every((s) => txt.includes(s + ':'))) return txt.slice(start).replace(/```/g, '').trim();
  const what = mode === 'swap' ? '[video editing + character replacement]' : '[video editing + object and scene change]';
  return [
    'subject_definitions:', '<Video 1> is the source video.', '<Picture 1> is a frame of the target video, exactly as the target video shows it at that moment.',
    mode === 'swap' ? `<Subject 1> is the new character shown in <Picture 1>. ${idea}` : `The change shown in <Picture 1>: ${idea}`, '',
    'summary:', `${what} ${idea}. The shot, camera, motion, timing and soundtrack of <Video 1> are kept.`, '',
    'retention_analysis:', '<Video 1> (source video editing): fully_preserved - the camera, the motion, the timing and the soundtrack.',
    '<Picture 1> (target keyframe): fully_preserved - the target video passes through this exact frame.', '',
    'detailed_description:', `[Shot 1] From 00:00.000 to ${fmt(seconds)} the video plays as <Video 1>, with the look of <Picture 1>. ${idea}`, '',
    'overall_soundscape:', 'The same sound as <Video 1>.', '', 'non_diegetic_music:', 'N/A',
  ].join('\n');
}
const fmt = (s: number) => { const m = Math.floor(s / 60), r = s - m * 60; return `${String(m).padStart(2, '0')}:${r.toFixed(3).padStart(6, '0')}`; };

/** Pedido ao Flow para editar o quadro original (imagem 1) com as referências (imagens 2…). */
export function frameEditPrompt(idea: string, mode: ViggleMode, refNames: string[]): string {
  const refs = refNames.length ? ` using the reference image${refNames.length > 1 ? 's' : ''} (${refNames.join(', ')})` : '';
  return mode === 'swap'
    ? `Edit image 1: replace the main person/character with the new character${refs}. ${idea}. Keep EVERYTHING else exactly as in image 1: pose, expression, framing, camera angle, background, lighting and proportions.`
    : `Edit image 1: ${idea}${refs}. Keep the people, their poses, the framing, the camera angle and the composition exactly as in image 1.`;
}

/** Corta o vídeo de origem (até `maxSec`, 24 fps, com som) e tira o quadro em `atSec`. */
export async function prepareViggleSource(ffmpeg: string, ffprobe: string, src: string, outDir: string, maxSec: number, atSec: number, signal?: AbortSignal): Promise<{ video: string; frame: string; seconds: number }> {
  fs.mkdirSync(outDir, { recursive: true });
  const video = path.join(outDir, 'viggle-source.mp4'), frame = path.join(outDir, 'viggle-frame.png');
  await ff.run(ffmpeg, ['-y', '-v', 'error', '-i', src, '-t', String(maxSec), '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', video], signal);
  const seconds = (await ff.duration(ffprobe, video)) || maxSec;
  await ff.run(ffmpeg, ['-y', '-v', 'error', '-ss', String(Math.min(atSec, Math.max(0, seconds - 0.2))), '-i', video, '-frames:v', '1', frame], signal);
  return { video, frame, seconds };
}

export const hasViggle = (s: Pick<Settings, 'wan2gp'>) => !!s.wan2gp?.root;
