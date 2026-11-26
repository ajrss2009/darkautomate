import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ff from './ffmpeg';

/*
 * MÚSICA DO PROJETO por ARQUIVO ou PASTA. Pasta = COLETÂNEA: as faixas de áudio da pasta (subpastas incluídas), em ordem
 * natural do nome ("2 - …" antes de "10 - …"), viram UMA trilha com transições suaves (acrossfade) e áudio uniforme; a
 * lista de faixas com o início de cada uma vira os capítulos da descrição. A trilha entra no projeto como o anexo
 * "trilha sonora" (o mesmo das músicas únicas): clipe musical, lyric video e montagem usam sem mudar nada.
 */

export const AUDIO_EXT = /\.(mp3|wav|m4a|flac|ogg|aac|opus|wma)$/i;
export const MAX_TRACKS = 60;
export interface CompilationTrack { title: string; file: string; start: number; seconds: number }

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
/** Faixas de áudio da pasta (subpastas incluídas), em ordem natural pelo caminho. */
export function listTracks(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4 || out.length >= MAX_TRACKS * 4) return;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, depth + 1);
      else if (AUDIO_EXT.test(e.name)) out.push(f);
    }
  };
  walk(dir, 0);
  return out.sort((a, b) => collator.compare(path.relative(dir, a), path.relative(dir, b))).slice(0, MAX_TRACKS);
}

/** "03 - Artista - Nome_da_faixa.mp3" → "Artista - Nome da faixa". Função pura. */
export function trackTitle(file: string): string {
  return path.basename(file).replace(/\.[^.]+$/, '').replace(/^\s*\d{1,3}\s*[-._)]\s*/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || path.basename(file);
}

const mmss = (s: number) => { const t = Math.max(0, Math.round(s)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
/** Capítulos ("0:00 Faixa") — o YouTube cria os capítulos a partir deles. Função pura. */
export function chapterLines(tracks: Array<Pick<CompilationTrack, 'title' | 'start'>>): string[] {
  return tracks.map((t, i) => `${mmss(i === 0 ? 0 : t.start)} ${t.title}`);
}

/** Inícios de cada faixa com transição de `cf` segundos entre elas. Função pura. */
export function trackStarts(durations: number[], cf: number): number[] {
  const out: number[] = [];
  let at = 0;
  for (let i = 0; i < durations.length; i++) { out.push(Math.round(at * 100) / 100); at += durations[i]! - (i < durations.length - 1 ? Math.min(cf, durations[i]! / 3, (durations[i + 1] ?? 0) / 3) : 0); }
  return out;
}

/**
 * Monta a coletânea em <outDir>/coletanea.mp3 (+ coletanea.json com as faixas). Uma faixa só = cópia convertida.
 * Transição: acrossfade de `crossfade` s (no máximo 1/3 da faixa mais curta do par).
 */
export async function buildCompilation(o: { ffmpeg: string; ffprobe: string; dir: string; outDir: string; crossfade?: number; signal?: AbortSignal; log?: (l: string) => void }): Promise<{ file: string; tracks: CompilationTrack[]; total: number }> {
  const files = listTracks(o.dir);
  if (!files.length) throw new Error(`a pasta não tem faixas de áudio (mp3, wav, m4a, flac, ogg, aac, opus): ${o.dir}`);
  fs.mkdirSync(o.outDir, { recursive: true });
  const durations: number[] = [];
  for (const f of files) durations.push((await ff.duration(o.ffprobe, f).catch(() => 0)) || 0);
  const ok = files.map((f, i) => ({ f, d: durations[i]! })).filter((x) => x.d > 1);
  if (!ok.length) throw new Error('nenhuma faixa de áudio legível na pasta');
  const cf = Math.max(0, o.crossfade ?? 2);
  const out = path.join(o.outDir, 'coletanea.mp3');
  const inputs = ok.flatMap((x) => ['-i', x.f]);
  const norm = ok.map((_, i) => `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[n${i}]`);
  let chain = '', last = 'n0';
  for (let i = 1; i < ok.length; i++) {
    const d = Math.max(0.1, Math.min(cf, ok[i - 1]!.d / 3, ok[i]!.d / 3));
    const lbl = i === ok.length - 1 ? 'mix' : `x${i}`;
    chain += `;[${last}][n${i}]acrossfade=d=${d.toFixed(2)}:c1=qsin:c2=qsin[${lbl}]`;
    last = lbl;
  }
  const graph = ok.length === 1 ? `${norm[0]!.replace('[n0]', '[mix]')}` : norm.join(';') + chain;
  await ff.run(o.ffmpeg, ['-y', '-v', 'error', ...inputs, '-filter_complex', graph, '-map', '[mix]', '-c:a', 'libmp3lame', '-b:a', '192k', out], o.signal);
  const starts = trackStarts(ok.map((x) => x.d), cf);
  const tracks: CompilationTrack[] = ok.map((x, i) => ({ title: trackTitle(x.f), file: path.basename(x.f), start: starts[i]!, seconds: Math.round(x.d * 100) / 100 }));
  const total = (await ff.duration(o.ffprobe, out).catch(() => 0)) || tracks.reduce((a, t) => a + t.seconds, 0);
  fs.writeFileSync(path.join(o.outDir, 'coletanea.json'), JSON.stringify({ dir: o.dir, total, tracks }, null, 2));
  o.log?.(`🎵 coletânea: ${tracks.length} faixa(s), ${Math.round(total)} s`);
  return { file: out, tracks, total };
}
