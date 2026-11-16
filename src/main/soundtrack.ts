import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, Settings, SfxCue } from '../shared/types';
import * as ff from './ffmpeg';
import { buildSceneSfx, cueTimes, sfxDef } from './sfx';
import { renderCodeMusic, type Mood } from './codemusic';

/**
 * Áudio do vídeo livre e trilha sonora do editor.
 *
 * Vídeo livre: o renderizador grava final.mp4 (mudo) e final.sfx.json (os sons que a página declarou em
 * window.__forge.sfx). Aqui os sons viram uma faixa e o resultado vai para final.base.mp4 — o vídeo SEM
 * trilha. final.mp4 = base + trilha (out/music.*), então trocar/remover a trilha no editor não refaz a animação.
 */

export const MUSIC_RE = /^music\.(mp3|wav|m4a|ogg|flac|aac)$/i;
/** Sem narração a trilha é o som principal: volume padrão maior que o das rotas com cenas (0,15). */
export const FREE_MUSIC_VOLUME = 0.05;

export const musicFile = (outDir: string): string | undefined => {
  try { const f = fs.readdirSync(outDir).find((n) => MUSIC_RE.test(n)); return f ? path.join(outDir, f) : undefined; } catch { return undefined; }
};
export const baseFile = (outDir: string) => path.join(outDir, 'final.base.mp4');

/** Troca a trilha do projeto (cópia em out/music.<ext>) ou remove (src null). Devolve o arquivo novo. */
export function setMusic(outDir: string, src: string | null): string | null {
  if (src && !/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(src)) throw new Error('formato de áudio não suportado (use mp3, wav, m4a, ogg, flac ou aac)');
  if (src && !fs.existsSync(src)) throw new Error(`arquivo não encontrado: ${src}`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const n of fs.readdirSync(outDir).filter((x) => MUSIC_RE.test(x))) fs.rmSync(path.join(outDir, n), { force: true });
  if (!src) { try { fs.rmSync(path.join(outDir, SOURCE_FILE), { force: true }); } catch { /* ok */ } return null; }
  const dest = path.join(outDir, 'music' + path.extname(src).toLowerCase());
  fs.copyFileSync(src, dest);
  writeMusicSource(outDir, { by: 'user' });
  return dest;
}

/** Cues de window.__forge.sfx: nomes da biblioteca (ou apelidos), instante em segundos; o resto é ignorado. */
export function cuesFromList(list: unknown, seconds: number): SfxCue[] {
  if (!Array.isArray(list)) return [];
  const out: SfxCue[] = [];
  for (const x of list as Array<Record<string, unknown>>) {
    const d = sfxDef(String(x?.name ?? x?.sfx ?? ''));
    const at = Number(x?.t ?? x?.at ?? x?.time);
    if (!d || !Number.isFinite(at) || at < 0 || at > seconds) continue;
    const g = Number(x.gain);
    out.push({ name: d.id, at, gain: Number.isFinite(g) ? Math.min(2, Math.max(0, g)) : undefined });
  }
  return out.sort((a, b) => a.at! - b.at!).slice(0, 32);
}

async function hasAudio(ffprobe: string, file: string): Promise<boolean> {
  try {
    const r = await ff.run(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    return r.stdout.trim().length > 0;
  } catch { return false; }
}

const replace = (tmp: string, dest: string) => { try { fs.renameSync(tmp, dest); } catch { fs.copyFileSync(tmp, dest); fs.rmSync(tmp, { force: true }); } };

/**
 * Vídeo livre recém-renderizado (final.mp4 mudo + final.sfx.json): grava final.base.mp4 com os efeitos
 * (ou silêncio) e devolve o resumo dos sons. `volume` relativo ao padrão das cenas (0 = sem efeitos).
 */
export async function buildFreeBase(s: Settings, outDir: string, seconds: number, volume: number | undefined, signal?: AbortSignal): Promise<string> {
  const video = path.join(outDir, 'final.mp4');
  const base = baseFile(outDir), tmp = path.join(outDir, 'final.base.part.mp4');
  let cues: SfxCue[] = [];
  try { cues = cuesFromList(JSON.parse(fs.readFileSync(path.join(outDir, 'final.sfx.json'), 'utf8')), seconds); } catch { /* página sem sons */ }
  const gain = volume === undefined ? 1 : Math.max(0, volume) / ff.SFX_DEFAULT_VOLUME;
  const wav = path.join(outDir, 'free-sfx.wav');
  fs.rmSync(wav, { force: true });
  if (cues.length && gain > 0) {
    const scaled = cues.map((c) => ({ ...c, gain: Math.min(2, (c.gain ?? 1) * gain) }));
    await buildSceneSfx(s.ffmpeg, scaled, cueTimes(scaled, seconds), seconds, wav, path.join(outDir, 'sfx-parts'), signal);
    await ff.run(s.ffmpeg, ['-y', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', tmp], signal);
  } else {
    await ff.run(s.ffmpeg, ['-y', '-i', video, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', tmp], signal);
  }
  replace(tmp, base);
  return cues.length ? (gain > 0 ? cues.map((c) => `${c.name}@${c.at!.toFixed(1)}s`).join(', ') : 'efeitos no mudo') : 'nenhum';
}

/**
 * final.mp4 = final.base.mp4 + trilha (out/music.*) no volume do projeto. Sem trilha (ou no mudo), a base.
 * Projeto livre antigo, sem base: a base passa a ser o final.mp4 atual (com faixa de silêncio se for mudo).
 */
export async function applyFreeSoundtrack(s: Settings, p: Pick<Project, 'musicVolume'>, outDir: string, signal?: AbortSignal): Promise<string> {
  const final = path.join(outDir, 'final.mp4'), base = baseFile(outDir);
  if (!fs.existsSync(base)) {
    if (!fs.existsSync(final)) throw new Error('o projeto ainda não tem vídeo final — execute a rota primeiro');
    const tmp = path.join(outDir, 'final.base.part.mp4');
    if (await hasAudio(s.ffprobe, final)) fs.copyFileSync(final, tmp);
    else await ff.run(s.ffmpeg, ['-y', '-i', final, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', tmp], signal);
    replace(tmp, base);
  }
  const music = musicFile(outDir);
  const vol = p.musicVolume ?? FREE_MUSIC_VOLUME;
  const tmp = path.join(outDir, 'final.part.mp4');
  if (music && vol > 0) {
    await ff.mixMusic(s.ffmpeg, base, music, tmp, signal, vol);
    replace(tmp, final);
    return `trilha ${path.basename(music)} a ${Math.round(vol * 100)}%`;
  }
  fs.copyFileSync(base, final);
  return music ? 'trilha no mudo' : 'sem trilha';
}

/** Trilha gerada por código (mgaudio ou sintetizador interno) com a duração do vídeo; substitui a atual. */
export async function generateMusic(s: Settings, outDir: string, mood: Mood | string, seconds: number, log: (l: string) => void, signal?: AbortSignal): Promise<string> {
  const r = await renderCodeMusic(s, { mood, duration: Math.round((seconds + 0.5) * 100) / 100, out: path.join(outDir, 'music.next.wav'), signal, log });
  const f = setMusic(outDir, r.file)!;
  fs.rmSync(r.file, { force: true });
  return f;
}

/*
 * ORIGEM DA TRILHA (out/music.source.json): quem gerou o arquivo de música atual e com que configuração.
 * "user" = escolhida/gerada no editor (nunca é sobrescrita ao regerar o final); "route" = etapa de música da rota,
 * com a chave da configuração (estilo, modo, trilha por código, humor). Mudou a configuração → o regerar final refaz a música.
 */
/* fora do padrão music.* (a montagem escolhe a trilha por music.<ext>); o nome antigo music.source.json é migrado */
const SOURCE_FILE = 'music-source.json';
const migrateSource = (outDir: string) => { try { const old = path.join(outDir, 'music.source.json'); if (fs.existsSync(old)) { if (!fs.existsSync(path.join(outDir, SOURCE_FILE))) fs.renameSync(old, path.join(outDir, SOURCE_FILE)); else fs.rmSync(old, { force: true }); } } catch { /* ok */ } };
export interface MusicSource { by: 'user' | 'route'; key?: string; at: string }
export const musicKey = (p: { musicStyle?: string; musicMode?: string; codeMusic?: boolean; route?: { steps: Array<{ kind: string; enabled: boolean; bindings: unknown[]; params?: unknown }> } }) =>
  JSON.stringify([p.musicStyle ?? '', p.musicMode ?? '', !!p.codeMusic, (p.route?.steps ?? []).filter((s) => s.kind === 'music' && s.enabled).map((s) => [s.bindings, s.params ?? null])]);
export function readMusicSource(outDir: string): MusicSource | undefined {
  migrateSource(outDir);
  try { return JSON.parse(fs.readFileSync(path.join(outDir, SOURCE_FILE), 'utf8')) as MusicSource; } catch { return undefined; }
}
export function writeMusicSource(outDir: string, src: Omit<MusicSource, 'at'>): void {
  migrateSource(outDir);
  try { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, SOURCE_FILE), JSON.stringify({ ...src, at: new Date().toISOString() }, null, 1)); } catch { /* só marcador */ }
}
/** A trilha atual está desatualizada em relação à configuração do projeto? (escolhida pelo usuário: nunca) */
export function musicStale(outDir: string, p: Parameters<typeof musicKey>[0]): boolean {
  const src = readMusicSource(outDir);
  if (!musicFile(outDir)) return true;
  /* sem marcador (projeto de versão anterior): origem desconhecida — preserva a trilha */
  if (!src || src.by === 'user') return false;
  return src.key !== musicKey(p);
}
