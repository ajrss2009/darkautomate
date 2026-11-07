import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, Settings } from '../shared/types';
import * as ff from './ffmpeg';
import { SFX_DEFAULT_VOLUME } from './ffmpeg';
import { projectDirOf } from './settings';
import { sceneAudio, sceneVisual } from './executors';
import { readWords, wordsPath } from './whisper';

/*
 * Exportar para editores de vídeo:
 *  - DaVinci Resolve: timeline em XML (Final Cut Pro 7 / xmeml, lido em "Arquivo → Importar → Timeline") com uma faixa
 *    de vídeo (um clipe por cena) e três de áudio (narração, efeitos sonoros e música, já no volume do editor) + legendas .srt;
 *  - CapCut: pasta pronta para arrastar — clipes numerados na ordem da timeline, narração, efeitos e música do tamanho
 *    exato do vídeo (começam no 0) e legendas .srt (CapCut: Legendas → Importar). O CapCut não abre projetos de outros
 *    editores; a pasta tem o passo a passo.
 * Os clipes saem sem os efeitos de cor/movimento e sem as transições do FilmForge (para editar à vontade no outro editor).
 */

export interface TimelineItem { name: string; file: string; seconds: number }
export interface TimelineTracks { video: TimelineItem[]; audio: Array<{ name: string; file: string; seconds: number; level: number }> }

const FPS = 30;
const fr = (s: number) => Math.round(s * FPS);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** file://localhost/G:/pasta%20com%20espaço/x.mp4 (formato que o Resolve e o Premiere aceitam no xmeml) */
export const pathUrl = (f: string) => 'file://localhost/' + path.resolve(f).replace(/\\/g, '/').replace(/^\//, '').split('/').map((p, i) => (i === 0 && /^[A-Za-z]:$/.test(p) ? p : encodeURIComponent(p))).join('/');

/** XML da timeline (xmeml v5). Função pura. */
export function fcpXml(name: string, size: { w: number; h: number }, t: TimelineTracks): string {
  const rate = `<rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>`;
  const total = t.video.reduce((a, v) => a + fr(v.seconds), 0);
  let fid = 0;
  const file = (f: string, frames: number, kind: 'video' | 'audio') => `<file id="file-${++fid}"><name>${esc(path.basename(f))}</name><pathurl>${pathUrl(f)}</pathurl>${rate}<duration>${frames}</duration>` +
    `<media>${kind === 'video' ? `<video><samplecharacteristics><width>${size.w}</width><height>${size.h}</height></samplecharacteristics></video>` : '<audio><channelcount>2</channelcount></audio>'}</media></file>`;
  let at = 0;
  const vClips = t.video.map((v, i) => {
    const d = fr(v.seconds), x = `<clipitem id="v${i + 1}"><name>${esc(v.name)}</name><enabled>TRUE</enabled><duration>${d}</duration>${rate}<start>${at}</start><end>${at + d}</end><in>0</in><out>${d}</out>${file(v.file, d, 'video')}</clipitem>`;
    at += d; return x;
  }).join('\n');
  const aTracks = t.audio.map((a, i) => {
    const d = Math.min(fr(a.seconds), total);
    return `<track><clipitem id="a${i + 1}"><name>${esc(a.name)}</name><enabled>TRUE</enabled><duration>${d}</duration>${rate}<start>0</start><end>${d}</end><in>0</in><out>${d}</out>${file(a.file, d, 'audio')}` +
      `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>` +
      `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>` +
      `<parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${a.level.toFixed(3)}</value></parameter></effect></filter></clipitem></track>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5">\n<sequence id="seq-1"><name>${esc(name)}</name><duration>${total}</duration>${rate}` +
    `<media><video><format><samplecharacteristics>${rate}<width>${size.w}</width><height>${size.h}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>\n<track>\n${vClips}\n</track></video>` +
    `<audio>\n${aTracks}\n</audio></media></sequence>\n</xmeml>\n`;
}

/** Duração de cada cena na montagem (mesma regra do "assemble", sem transições). */
async function lenOf(s: Settings, p: Project, i: number): Promise<number> {
  const sc = p.scenes[i]!;
  if (sc.manualDuration && sc.durationSec) return sc.durationSec;
  const a = sceneAudio(path.join(projectDirOf(s, p.id), 'scenes', sc.id));
  const d = a ? await ff.duration(s.ffprobe, a).catch(() => 0) : 0;
  return d > 0.2 ? d + 0.15 : sc.durationSec ?? 4;
}

/** Áudio de cada cena colado no tempo da timeline (silêncio onde não há), um arquivo só do tamanho do vídeo. */
async function joinedTrack(s: Settings, parts: Array<{ file?: string; seconds: number; trim: number }>, out: string, volume = 1) {
  const args = ['-y'], chains: string[] = [];
  parts.forEach((x, i) => {
    if (x.file) args.push('-ss', x.trim.toFixed(3), '-i', x.file); else args.push('-f', 'lavfi', '-t', x.seconds.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
    chains.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${x.seconds.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const vol = Math.abs(volume - 1) > 0.005 ? `,volume=${volume.toFixed(3)}` : '';
  args.push('-filter_complex', `${chains.join(';')};${parts.map((_, i) => `[a${i}]`).join('')}concat=n=${parts.length}:v=0:a=1${vol}[o]`, '-map', '[o]', '-c:a', 'pcm_s16le', out);
  await ff.run(s.ffmpeg, args);
}

/** Exporta o projeto para o DaVinci Resolve (XML) ou para o CapCut (pasta). Devolve a pasta e o arquivo principal. */
export async function exportForEditor(s: Settings, p: Project, target: 'davinci' | 'capcut' | 'premiere', log: (m: string) => void = () => {}): Promise<{ dir: string; main: string; notes: string[] }> {
  if (!p.scenes.length) throw new Error('o projeto não tem cenas para exportar');
  const root = projectDirOf(s, p.id), out = path.join(root, 'export', target);
  fs.rmSync(out, { recursive: true, force: true });
  const media = target !== 'capcut' ? path.join(out, 'midia') : out;
  fs.mkdirSync(media, { recursive: true });
  const size = ff.resolution(p.aspect ?? '16:9'), notes: string[] = [];
  const vf = `scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;
  const video: TimelineItem[] = [], narr: Array<{ file?: string; seconds: number; trim: number }> = [], fx: typeof narr = [];
  const subItems: Array<{ scene: (typeof p.scenes)[number]; seconds: number; words?: ff.SubWord[] }> = [];
  for (let i = 0; i < p.scenes.length; i++) {
    const sc = p.scenes[i]!, dir = path.join(root, 'scenes', sc.id), seconds = Math.round((await lenOf(s, p, i)) * 1000) / 1000;
    const trim = sc.trimStart ?? 0, vis = sceneVisual(dir, sc.kind);
    const clip = path.join(media, `${String(i + 1).padStart(3, '0')} - ${sc.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 50).trim() || sc.id}.mp4`);
    const isVid = !!vis && /\.(mp4|webm|mov|mkv|gif)$/i.test(vis);
    let vd = 0;
    if (isVid) vd = await ff.duration(s.ffprobe, vis!).catch(() => 0);
    const input = !vis ? ['-f', 'lavfi', '-i', `color=c=black:s=${size.w}x${size.h}:r=${FPS}`]
      : isVid ? [...(vd > 0 && vd - trim + 0.05 < seconds ? ['-stream_loop', '-1'] : []), '-ss', trim.toFixed(3), '-i', vis!]
        : ['-loop', '1', '-framerate', String(FPS), '-i', vis!];
    if (!vis) notes.push(`cena ${i + 1} sem visual — exportada em preto`);
    await ff.run(s.ffmpeg, ['-y', ...input, '-t', seconds.toFixed(3), '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', clip]);
    video.push({ name: `${i + 1}. ${sc.title}`, file: clip, seconds });
    narr.push({ file: sceneAudio(dir), seconds, trim });
    const sfxFile = path.join(dir, 'audio', 'sfx.wav');
    fx.push({ file: fs.existsSync(sfxFile) && fs.statSync(sfxFile).size > 1000 ? sfxFile : undefined, seconds, trim });
    subItems.push({ scene: sc, seconds, words: readWords(wordsPath(dir))?.words });
    log(`clipe ${i + 1}/${p.scenes.length}`);
  }
  const total = video.reduce((a, v) => a + v.seconds, 0);
  const audio: TimelineTracks['audio'] = [];
  if (narr.some((x) => x.file)) {
    const f = path.join(media, 'narracao.wav'); await joinedTrack(s, narr, f, target === 'capcut' ? p.narrationVolume ?? 1 : 1);
    audio.push({ name: 'Narração', file: f, seconds: total, level: p.narrationVolume ?? 1 });
  }
  if (fx.some((x) => x.file) && (p.sfxVolume ?? SFX_DEFAULT_VOLUME) > 0) {
    const f = path.join(media, 'efeitos-sonoros.wav'); await joinedTrack(s, fx, f, target === 'capcut' ? p.sfxVolume ?? SFX_DEFAULT_VOLUME : 1);
    audio.push({ name: 'Efeitos sonoros', file: f, seconds: total, level: p.sfxVolume ?? SFX_DEFAULT_VOLUME });
  }
  const outDir = path.join(root, 'out'), music = fs.existsSync(outDir) ? fs.readdirSync(outDir).find((f) => /^music\.(mp3|wav|m4a|ogg)$/i.test(f)) : undefined;
  const mvol = p.musicVolume ?? 0.15;
  if (music && mvol > 0) {
    const f = path.join(media, 'musica.wav');
    await ff.run(s.ffmpeg, ['-y', '-stream_loop', '-1', '-i', path.join(outDir, music), '-t', total.toFixed(3), '-af', target === 'capcut' ? `volume=${mvol.toFixed(3)}` : 'anull', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', f]);
    audio.push({ name: 'Música', file: f, seconds: total, level: mvol });
  }
  const words = ff.subtitleWords(subItems);
  const srt = path.join(out, 'legendas.srt');
  if (words.length) ff.writeSrtFromWords(srt, words, size.h > size.w ? 4 : 6);
  const name = p.name || p.id;
  let main: string;
  if (target === 'premiere') {
    main = path.join(out, `${name.replace(/[\\/:*?"<>|]/g, '').trim() || 'timeline'}.xml`);
    fs.writeFileSync(main, fcpXml(name, size, { video, audio }));
    fs.writeFileSync(path.join(out, 'COMO-IMPORTAR.txt'), [
      'Adobe Premiere Pro — importar a sequência do FilmForge',
      '',
      `1. Arquivo → Importar… (Ctrl+I) e escolha "${path.basename(main)}" (XML do Final Cut Pro 7, que o Premiere lê).`,
      '2. O Premiere cria uma pasta com a sequência e os clipes; se pedir para localizar mídia, aponte para a pasta "midia".',
      `3. Abra a sequência: vídeo com ${video.length} clipes (um por cena, ${FPS} fps, ${size.w}x${size.h}).`,
      `4. Áudio: ${audio.map((a) => `${a.name} (${Math.round(a.level * 100)}%)`).join(', ') || 'nenhuma faixa'}.`,
      words.length ? '5. Legendas: Arquivo → Importar "legendas.srt" e arraste para a sequência (vira faixa de legendas).' : '5. Sem legendas (a narração não tem texto).',
      '',
      'Os clipes saem sem os filtros, movimentos e transições do FilmForge, para você editar no Premiere.',
    ].join('\r\n'));
  } else if (target === 'davinci') {
    main = path.join(out, `${name.replace(/[\\/:*?"<>|]/g, '').trim() || 'timeline'}.xml`);
    fs.writeFileSync(main, fcpXml(name, size, { video, audio }));
    fs.writeFileSync(path.join(out, 'COMO-IMPORTAR.txt'), [
      'DaVinci Resolve — importar a timeline do FilmForge',
      '',
      `1. Arquivo → Importar → Timeline… (File → Import → Timeline) e escolha "${path.basename(main)}".`,
      '2. Deixe marcado "Importar automaticamente os clipes no Media Pool"; se pedir, aponte para a pasta "midia".',
      `3. Faixa de vídeo: ${video.length} clipes (um por cena, ${FPS} fps, ${size.w}x${size.h}).`,
      `4. Faixas de áudio: ${audio.map((a) => `${a.name} (${Math.round(a.level * 100)}%)`).join(', ') || 'nenhuma'}.`,
      words.length ? '5. Legendas: arraste "legendas.srt" para o Media Pool e depois para a timeline (vira faixa de legenda).' : '5. Sem legendas (a narração não tem texto).',
      '',
      'Os clipes saem sem os filtros, movimentos e transições do FilmForge, para você editar no Resolve.',
    ].join('\r\n'));
  } else {
    main = video[0]!.file;
    fs.writeFileSync(path.join(out, 'COMO-IMPORTAR.txt'), [
      'CapCut — montar o projeto do FilmForge',
      '',
      `1. No CapCut, crie um projeto novo (proporção ${p.aspect ?? '16:9'}).`,
      `2. Importe todos os arquivos desta pasta. Selecione os ${video.length} clipes numerados (001, 002…) e arraste juntos para a timeline: eles entram em ordem, colados.`,
      '3. Arraste "narracao.wav", "efeitos-sonoros.wav" e "musica.wav" para faixas de áudio começando no 0:00 — já estão no tamanho exato do vídeo e no volume do FilmForge.',
      words.length ? '4. Legendas: Texto → Legendas → Importar legendas (ou arraste "legendas.srt" para a timeline).' : '4. Sem legendas (a narração não tem texto).',
      '',
      'O CapCut não abre projetos de outros editores; esta pasta tem as mesmas peças da timeline do FilmForge, separadas para editar.',
    ].join('\r\n'));
  }
  log(`exportado para ${target === 'davinci' ? 'DaVinci Resolve' : target === 'premiere' ? 'Premiere Pro' : 'CapCut'}: ${out}`);
  return { dir: out, main, notes };
}
