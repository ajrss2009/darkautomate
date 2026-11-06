import * as fs from 'node:fs';
import * as path from 'node:path';

/** Prefixo das linhas de log que anunciam um arquivo gerado (a interface mostra a prévia). */
export const FILE_PREFIX = '@file:';
const PREVIEW_EXT = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|m4a|ogg|flac|html|md|json|srt)$/i;

/**
 * Observa a pasta de trabalho do harness e anuncia no log cada arquivo novo/alterado
 * (só depois que o tamanho estabiliza), para a interface exibir prévias em tempo real.
 * Também emite um sinal de vida a cada `heartbeatSec` segundos. Retorna a função que encerra a observação.
 */
export function watchOutputs(dir: string, log: (l: string) => void, o: { everyMs?: number; heartbeatSec?: number } = {}): () => void {
  const announced = new Map<string, string>();
  const candidate = new Map<string, string>();
  const t0 = Date.now();
  let lastLog = Date.now();
  const emit = (l: string) => { lastLog = Date.now(); log(l); };

  const scan = (d: string, depth: number, mode: 'baseline' | 'stable' | 'flush') => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) scan(p, depth + 1, mode); continue; }
      if (!PREVIEW_EXT.test(e.name)) continue;
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { continue; }
      if (!st.size) continue;
      const sig = `${st.mtimeMs}:${st.size}`;
      if (mode === 'baseline') { announced.set(p, sig); continue; }
      if (announced.get(p) === sig) continue;
      if (mode === 'stable' && candidate.get(p) !== sig) { candidate.set(p, sig); continue; }
      announced.set(p, sig); candidate.delete(p);
      emit(FILE_PREFIX + p);
    }
  };

  scan(dir, 0, 'baseline');
  const every = setInterval(() => {
    scan(dir, 0, 'stable');
    const hb = (o.heartbeatSec ?? 20) * 1000;
    if (hb > 0 && Date.now() - lastLog >= hb) emit(`⏳ harness em execução há ${Math.round((Date.now() - t0) / 1000)}s…`);
  }, o.everyMs ?? 1000);
  return () => { clearInterval(every); scan(dir, 0, 'flush'); };
}
