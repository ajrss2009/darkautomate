import type { BeatGrid } from './beat-grid';
import { colorDistance, nearDuplicate, type MediaMeta } from './media-index';

/*
 * MONTAGEM MUSICAL (sua música + sua pasta de clipes/fotos), sem IA no plano: a batida decide os cortes e o índice
 * decide os planos. Função pura — o executor mede os arquivos e grava scenes.json.
 *  - cortes nos tempos fortes, planos de 4 a 8 s (padrão que alterna 1 compasso / meio compasso conforme o BPM);
 *  - sem repetir um arquivo (nem uma cópia dele) até usar todos; continuidade de cor com o plano anterior;
 *  - plano curto pede clipe com movimento; clipe precisa ter duração para o plano (trecho escolhido dentro dele).
 */
export interface MontageClip { rel: string; kind: 'image' | 'video'; meta?: MediaMeta }
export interface MontageScene {
  id: string; title: string; kind: 'image' | 'video'; userMedia: string; clipStart?: number; durationSec: number; manualDuration: true;
  visualIntent: string; narration: string;
}

const hash = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Fronteiras dos planos (s): nas batidas, alternando comprimentos dentro de [min, max]. */
export function montageCuts(total: number, grid: Pick<BeatGrid, 'bpm' | 'beats' | 'downbeats'>, minSec = 4, maxSec = 8): number[] {
  const period = 60 / (grid.bpm > 0 ? grid.bpm : 120);
  const beats = grid.beats.filter((b) => b > 0.05 && b < total - 0.05);
  /* quantas batidas por plano cabem em [min, max]; prefere 1 compasso (4) e meio (2), depois 8/6/3 */
  const fits = [4, 8, 12, 6, 16, 2, 3, 24, 32, 1].filter((k) => k * period >= minSec - 1e-6 && k * period <= maxSec + 1e-6);
  const pattern = fits.length >= 2 ? [fits[0]!, fits[0]!, fits[1]!, fits[1]!] : fits.length ? [fits[0]!] : [];
  const cuts: number[] = [];
  if (!beats.length || !pattern.length) {
    /* sem batida útil: grade fixa de ~3,5 s */
    for (let t = 3.5; t < total - minSec; t += 3.5) cuts.push(r3(t));
    return cuts;
  }
  /* começa no 1º tempo forte depois do mínimo */
  const down = new Set(grid.downbeats.map((d) => Math.round(d * 1000)));
  let idx = beats.findIndex((b) => b >= minSec - 1e-6 && down.has(Math.round(b * 1000)));
  if (idx < 0) idx = beats.findIndex((b) => b >= minSec - 1e-6);
  let p = 0;
  while (idx >= 0 && idx < beats.length) {
    const t = beats[idx]!;
    if (total - t < minSec) break;
    const prev = cuts.length ? cuts[cuts.length - 1]! : 0;
    if (t - prev >= minSec - 1e-6) cuts.push(r3(t));
    idx += pattern[p++ % pattern.length]!;
  }
  /* último plano não passa do máximo: fatia o resto nas batidas */
  for (let guard = 0; guard < 200; guard++) {
    const last = cuts.length ? cuts[cuts.length - 1]! : 0;
    if (total - last <= maxSec) break;
    const mid = last + (minSec + maxSec) / 2;
    const cand = beats.filter((b) => b >= last + minSec - 1e-6 && b <= last + maxSec + 1e-6 && total - b >= minSec - 1e-6);
    const b = cand.length ? cand.reduce((a, x) => (Math.abs(x - mid) < Math.abs(a - mid) ? x : a)) : Math.min(last + maxSec, total - minSec);
    if (b <= last + 0.05) break;
    cuts.push(r3(b));
  }
  return cuts;
}

/** Plano completo: cortes + o arquivo de cada plano (e o trecho, nos vídeos). */
export function planMontage(o: { total: number; grid: Pick<BeatGrid, 'bpm' | 'beats' | 'downbeats'>; clips: MontageClip[]; minSec?: number; maxSec?: number; seed?: string; trackStarts?: number[] }): MontageScene[] {
  if (!o.clips.length) throw new Error('montagem musical: nenhuma foto ou vídeo do usuário (anexe a pasta de clipes)');
  /* coletânea: cada faixa é montada à parte (corte exato na troca de faixa), cada trecho com seus cortes na batida */
  const starts = [...new Set([0, ...(o.trackStarts ?? []).filter((s) => s > 0.5 && s < o.total - 0.5)].map(r3))].sort((a, b) => a - b);
  const cuts: number[] = [];
  starts.forEach((s, i) => {
    const end = starts[i + 1] ?? o.total;
    if (i > 0) cuts.push(s);
    const local = { ...o.grid, beats: o.grid.beats.filter((b) => b > s && b < end).map((b) => r3(b - s)), downbeats: o.grid.downbeats.filter((b) => b > s && b < end).map((b) => r3(b - s)) };
    for (const c of montageCuts(r3(end - s), local, o.minSec ?? 4, o.maxSec ?? 8)) cuts.push(r3(s + c));
  });
  const bounds = [0, ...cuts, r3(o.total)];
  const seed = o.seed ?? 'montagem';
  /* cópias (mesmo hash ou quase a mesma imagem) contam como UM arquivo */
  const groups: MontageClip[][] = [];
  for (const c of o.clips) {
    const g = groups.find((x) => nearDuplicate(x[0]!.meta, c.meta));
    if (g) g.push(c); else groups.push([c]);
  }
  const usedTimes = new Map<number, number>();   // grupo → vezes usado
  const trackOf = (t: number) => (o.trackStarts ?? [0]).filter((s) => s <= t + 1e-6).length - 1;
  const inTrack = new Map<number, Set<number>>();   // faixa → grupos já usados nela
  const out: MontageScene[] = [];
  let prevColor: string | undefined, prevGroup = -1;
  for (let i = 0; i < bounds.length - 1; i++) {
    const len = r3(bounds[i + 1]! - bounds[i]!);
    if (len <= 0.05) continue;
    const tr = trackOf(bounds[i]!);
    const here = inTrack.get(tr) ?? new Set<number>();
    /* não repete na mesma música; acabou o estoque nesta faixa: repete o menos usado (só então) */
    const fresh = groups.map((_, gi) => gi).filter((gi) => !here.has(gi));
    const pool = fresh.length ? fresh : groups.map((_, gi) => gi);
    const minUse = Math.min(...pool.map((gi) => usedTimes.get(gi) ?? 0));
    let best = -1, bs = -Infinity;
    groups.forEach((g, gi) => {
      const used = usedTimes.get(gi) ?? 0;
      if (!pool.includes(gi) || used > minUse || (gi === prevGroup && groups.length > 1)) return;   // não repete até usar todos; nunca o mesmo seguido
      const c = g[0]!, m = c.meta;
      let s = 0;
      if (c.kind === 'video') s += m?.duration ? Math.min(1, m.duration / (len + 0.4)) * 2 : 1;   // cabe o plano
      else s += 0.6;
      if (m?.motion !== undefined && c.kind === 'video') s += (len <= 3 ? 1.5 : 0.8) * Math.min(1, m.motion * 3);   // plano curto pede ação
      if (prevColor && m?.avg) s += (1 - colorDistance(prevColor, m.avg)) * 1.2;   // continuidade de cor
      s += (hash(`${seed}|${i}|${c.rel}`) % 1000) / 1000 * 0.9;                    // variedade estável
      if (s > bs) { bs = s; best = gi; }
    });
    if (best < 0) best = groups.findIndex((_, gi) => gi !== prevGroup);
    if (best < 0) best = 0;
    const g = groups[best]!;
    const use = usedTimes.get(best) ?? 0;
    const c = g[use % g.length]!;
    usedTimes.set(best, use + 1);
    here.add(best); inTrack.set(tr, here);
    prevGroup = best; prevColor = c.meta?.avg ?? prevColor;
    let clipStart: number | undefined;
    if (c.kind === 'video') {
      const d = c.meta?.duration ?? 0;
      const room = d - len - 0.3;
      /* trecho dentro do clipe: evita o 1º meio segundo; reuso do mesmo clipe pega outro trecho */
      clipStart = room > 0.5 ? r3(0.5 + ((hash(`${seed}|start|${c.rel}|${use}`) % 1000) / 1000) * (room - 0.5)) : 0;
    }
    out.push({
      id: `s${String(out.length + 1).padStart(3, '0')}`, title: `Plano ${out.length + 1}`, kind: c.kind, userMedia: c.rel,
      ...(clipStart !== undefined ? { clipStart } : {}), durationSec: len, manualDuration: true,
      visualIntent: `${c.kind === 'video' ? 'Trecho do vídeo' : 'Foto'} do usuário "${c.rel}" — ${len} s no ritmo da música`, narration: '',
    });
  }
  return out;
}
