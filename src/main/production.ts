import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, Settings } from '../shared/types';
import * as ff from './ffmpeg';
import * as ops from './ops';
import { projectDirOf } from './settings';

/** Soma uma execução ao cronômetro de produção do projeto. */
export function recordRun(s: Settings, id: string, startedAt: number, endedAt: number, ok: boolean): Project {
  const p = ops.readProject(s, id);
  const ms = Math.max(0, endedAt - startedAt);
  const prod = p.production ?? { totalMs: 0, runs: [] };
  prod.runs = [...prod.runs, { startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(), ms, ok }].slice(-50);
  prod.totalMs += ms;
  p.production = prod;
  ops.saveProjectFile(s, p);
  return p;
}

export const fmtDuration = (ms: number): string => {
  const sec = Math.round(ms / 1000), h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
};

/** Primeiro frame do vídeo final (ou do primeiro visual de cena, se ainda não há vídeo). Cacheado por mtime. */
export async function ensureFirstFrame(s: Settings, id: string): Promise<string | null> {
  const dir = projectDirOf(s, id);
  const out = path.join(dir, 'out', 'first-frame.jpg');
  const final = path.join(dir, 'out', 'final.mp4');
  const fresh = (src: string) => fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs;
  try {
    if (fs.existsSync(final)) {
      if (fresh(final)) return out;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await ff.run(s.ffmpeg, ['-y', '-i', final, '-frames:v', '1', '-q:v', '3', out]);
      return out;
    }
    const p = ops.readProject(s, id);
    for (const sc of p.scenes) {
      const sd = path.join(dir, 'scenes', sc.id);
      const clip = ['clips/clip.mp4', 'clips/code.mp4', 'clips/motion.mp4'].map((x) => path.join(sd, x)).find((f) => fs.existsSync(f));
      const img = path.join(sd, 'frames', 'frame.png');
      const src = fs.existsSync(img) ? img : clip;
      if (src) {
        const o2 = path.join(dir, 'out', 'first-frame.jpg');
        if (fresh(src)) return o2;
        fs.mkdirSync(path.dirname(o2), { recursive: true });
        try { await ff.run(s.ffmpeg, ['-y', '-i', src, '-frames:v', '1', '-q:v', '3', o2]); return o2; }
        catch { /* arquivo corrompido: tenta a próxima cena */ }
      }
    }
  } catch { /* sem ffmpeg ou arquivo inválido: lista segue sem miniatura */ }
  return null;
}
