import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, Scene, Settings } from '../shared/types';
import * as ff from './ffmpeg';

/**
 * O RELÓGIO ÚNICO do projeto.
 *
 * A legenda não descobre onde a cena começa: ela herda esse número de quem monta o
 * vídeo. Montagem, legendas, capítulos e thumbnail leem a mesma timeline (gravada em
 * out/timeline.json) — o +0,15 s existe aqui, uma vez só.
 */

export interface SceneTiming {
  seconds: number;
  audio?: string;
  audioSeconds: number;
  source: 'manual' | 'audio' | 'video-audio' | 'planned';
  fromVideo: boolean;
  mtimeMs?: number;
  bytes?: number;
}

export interface TimelineScene {
  id: string;
  index: number;
  title: string;
  /** início no vídeo final (s) */
  start: number;
  /** duração no vídeo final (s) — a mesma usada pela montagem */
  seconds: number;
  source: SceneTiming['source'];
  fromVideo: boolean;
  audio?: string;
  audioSeconds: number;
  audioMtimeMs?: number;
  audioBytes?: number;
}

export interface Timeline {
  version: 1;
  builtAt: string;
  total: number;
  scenes: TimelineScene[];
}

export const timelinePath = (projectDir: string): string => path.join(projectDir, 'out', 'timeline.json');

/** Narração da cena (o arquivo que a montagem usa como áudio). */
export function narrationAudio(sceneDir: string): string | undefined {
  const dir = path.join(sceneDir, 'audio');
  if (!fs.existsSync(dir)) return undefined;
  const f = fs.readdirSync(dir).find((x) => x.startsWith('narration.') && !x.includes('.trim'));
  return f ? path.join(dir, f) : undefined;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Duração de UMA cena — a regra que a montagem, as legendas e os capítulos usam. */
export async function sceneTiming(ffprobe: string, scene: Scene, sceneDir: string): Promise<SceneTiming> {
  const audio = narrationAudio(sceneDir);
  const audioSeconds = audio ? await ff.duration(ffprobe, audio) : 0;
  const fromVideo = fs.existsSync(path.join(sceneDir, 'audio', '.from-video'));
  let st: fs.Stats | undefined;
  try { if (audio) st = fs.statSync(audio); } catch { /* arquivo sumiu */ }
  const fp = { audio, audioSeconds, fromVideo, mtimeMs: st?.mtimeMs, bytes: st?.size };
  if (scene.manualDuration && scene.durationSec) return { seconds: scene.durationSec, source: 'manual', ...fp };
  /* áudio extraído do próprio clipe H3: a cena dura o clipe inteiro (sem a folga de 0,15 s) */
  if (audioSeconds > 0.2) return { seconds: fromVideo ? audioSeconds : audioSeconds + 0.15, source: fromVideo ? 'video-audio' : 'audio', ...fp };
  return { seconds: scene.durationSec ?? 4, source: 'planned', ...fp };
}

/** Atalho: só a duração (para sfx/exportação, que não precisam do resto). */
export async function sceneSeconds(ffprobe: string, scene: Scene, sceneDir: string): Promise<number> {
  return (await sceneTiming(ffprobe, scene, sceneDir)).seconds;
}

/** Calcula a timeline inteira (uma leitura de ffprobe por cena) e grava out/timeline.json. */
export async function projectTimeline(settings: Pick<Settings, 'ffprobe'>, projectDir: string, project: Project, opts: { write?: boolean } = {}): Promise<Timeline> {
  const scenes: TimelineScene[] = [];
  let t = 0;
  for (const s of project.scenes) {
    const timing = await sceneTiming(settings.ffprobe, s, path.join(projectDir, 'scenes', s.id));
    scenes.push({
      id: s.id, index: s.index, title: s.title ?? `Cena ${s.index}`,
      start: round(t), seconds: round(timing.seconds),
      source: timing.source, fromVideo: timing.fromVideo,
      audio: timing.audio ? path.basename(timing.audio) : undefined,
      audioSeconds: round(timing.audioSeconds),
      audioMtimeMs: timing.mtimeMs, audioBytes: timing.bytes,
    });
    t += timing.seconds;
  }
  const timeline: Timeline = { version: 1, builtAt: new Date().toISOString(), total: round(t), scenes };
  if (opts.write !== false) writeTimeline(projectDir, timeline);
  return timeline;
}

export function writeTimeline(projectDir: string, timeline: Timeline): string {
  const file = timelinePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(timeline, null, 1));
  return file;
}

export function readTimeline(projectDir: string): Timeline | undefined {
  try {
    const t = JSON.parse(fs.readFileSync(timelinePath(projectDir), 'utf8')) as Timeline;
    return t && t.version === 1 && Array.isArray(t.scenes) ? t : undefined;
  } catch { return undefined; }
}

/** Inícios de cada cena (o que a legenda, os capítulos e a thumb leem). */
export function sceneStarts(t: Timeline): number[] { return t.scenes.map((s) => s.start); }

/** A timeline gravada ainda descreve o projeto (mesmas cenas e mesmo áudio)? */
function timelineFresh(projectDir: string, project: Project, t: Timeline | undefined): t is Timeline {
  if (!t || t.scenes.length !== project.scenes.length) return false;
  for (let i = 0; i < t.scenes.length; i++) {
    const ts = t.scenes[i]!, s = project.scenes[i]!;
    if (ts.id !== s.id) return false;
    const dir = path.join(projectDir, 'scenes', s.id);
    const audio = narrationAudio(dir);
    const fromVideo = fs.existsSync(path.join(dir, 'audio', '.from-video'));
    if ((ts.audio ?? '') !== (audio ? path.basename(audio) : '')) return false;
    if (ts.fromVideo !== fromVideo) return false;
    if (s.manualDuration && s.durationSec && Math.abs(ts.seconds - s.durationSec) > 0.001) return false;
    if (audio) {
      try {
        const st = fs.statSync(audio);
        if (ts.audioMtimeMs !== undefined && st.mtimeMs !== ts.audioMtimeMs) return false;
        if (ts.audioBytes !== undefined && st.size !== ts.audioBytes) return false;
      } catch { return false; }
    } else if (ts.audio) return false;
  }
  return true;
}

/** Lê a timeline gravada se ela ainda vale; senão calcula de novo (e grava). */
export async function ensureTimeline(settings: Pick<Settings, 'ffprobe'>, projectDir: string, project: Project): Promise<Timeline> {
  const saved = readTimeline(projectDir);
  if (timelineFresh(projectDir, project, saved)) return saved;
  return projectTimeline(settings, projectDir, project);
}

/**
 * Monta o STEM de narração concatenado: a mesma narração que entra no vídeo, no tempo
 * do vídeo (silêncio onde a cena não fala). É sobre ele que o Whisper roda — o tempo
 * nasce no arquivo que vai ao ar, não no arquivo isolado de cada cena.
 */
export async function buildNarrationStem(settings: Pick<Settings, 'ffmpeg'>, projectDir: string, project: Project, timeline: Timeline, signal?: AbortSignal): Promise<string> {
  const out = path.join(projectDir, 'out', 'narration.stem.wav');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args: string[] = ['-y'];
  const chains: string[] = [];
  timeline.scenes.forEach((ts, i) => {
    const scene = project.scenes.find((s) => s.id === ts.id);
    const dir = path.join(projectDir, 'scenes', ts.id);
    const audio = narrationAudio(dir);
    const trim = scene?.trimStart && scene.trimStart > 0 ? scene.trimStart : 0;
    const dur = Math.max(0.05, ts.seconds).toFixed(3);
    if (audio) args.push(...(trim > 0 ? ['-ss', trim.toFixed(3)] : []), '-i', audio);
    else args.push('-f', 'lavfi', '-t', dur, '-i', 'anullsrc=r=48000:cl=stereo');
    chains.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${dur},asetpts=PTS-STARTPTS[a${i}]`);
  });
  if (!timeline.scenes.length) return out;
  args.push('-filter_complex', `${chains.join(';')};${timeline.scenes.map((_, i) => `[a${i}]`).join('')}concat=n=${timeline.scenes.length}:v=0:a=1[o]`,
    '-map', '[o]', '-c:a', 'pcm_s16le', out);
  await ff.run(settings.ffmpeg, args, signal);
  return out;
}
