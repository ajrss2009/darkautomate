import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SubWord } from './ffmpeg';
import { layoutCues, run } from './ffmpeg';
import type { Timeline } from './timeline';

/**
 * QA DE SINCRONIA: mede, não sente.
 *
 * Mede a energia do áudio no início de cada cue (no stem de narração, o mesmo que
 * vai ao ar) e compara com o onset de fala mais próximo. Reprova acima de 0,2 s e
 * relata o pior caso por cena.
 */
export const SYNC_TOLERANCE = 0.2;

export interface SyncCue { index: number; scene?: string; start: number; end: number; text: string; delta: number; insideSpeech: boolean }
export interface SyncScene { scene: string; worst: number; cue: number }
export interface SyncQa {
  ok: boolean;
  limit: number;
  audio: string;
  onsets: number;
  worst: { delta: number; scene?: string; cue: number; start: number } | null;
  perScene: SyncScene[];
  cues: SyncCue[];
  display: { cues: number; tooShort: number; cpsOver: number; gapUnder: number; tooManyLines: number; overlaps: number };
  checkedAt: string;
}

export interface Segment { start: number; end: number }

/** Segmentos de fala do áudio (energia acima do ruído), em segundos. */
export async function speechSegments(ffmpeg: string, audio: string, signal?: AbortSignal): Promise<Segment[]> {
  const raw = path.join(os.tmpdir(), `forge-sync-${process.pid}-${Date.now()}.raw`);
  try {
    await run(ffmpeg, ['-y', '-v', 'error', '-i', audio, '-ac', '1', '-ar', '8000', '-f', 's16le', raw], signal);
    const buf = fs.readFileSync(raw);
    const rate = 8000, win = Math.round(rate * 0.02); // janelas de 20 ms
    const frames = Math.floor(buf.length / 2 / win);
    if (!frames) return [];
    const db: number[] = new Array(frames);
    let peak = -120;
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let i = f * win; i < (f + 1) * win; i++) { const v = buf.readInt16LE(i * 2) / 32768; sum += v * v; }
      const rms = Math.sqrt(sum / win);
      const d = rms > 0 ? 20 * Math.log10(rms) : -120;
      db[f] = d;
      if (d > peak) peak = d;
    }
    const sorted = [...db].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.2)] ?? -120;
    /* limiar adaptativo: acima do ruído e abaixo do pico (nunca acima da fala) */
    const gate = Math.min(Math.max(floor + 6, peak - 45), peak - 6);
    const segs: Segment[] = [];
    let start = -1;
    for (let f = 0; f < frames; f++) {
      const on = db[f]! >= gate;
      if (on && start < 0) start = f;
      else if (!on && start >= 0) { segs.push({ start: (start * win) / rate, end: (f * win) / rate }); start = -1; }
    }
    if (start >= 0) segs.push({ start: (start * win) / rate, end: (frames * win) / rate });
    /* junta falas separadas por menos de 80 ms: são a mesma palavra */
    const merged: Segment[] = [];
    for (const s of segs) {
      const last = merged[merged.length - 1];
      if (last && s.start - last.end < 0.08) last.end = s.end;
      else if (s.end - s.start >= 0.04) merged.push({ ...s });
    }
    return merged;
  } catch { return []; }
  finally { try { fs.rmSync(raw, { force: true }); } catch { /* sem permissão: fica no temp */ } }
}

const sceneAt = (t: number, timeline?: Timeline): string | undefined => {
  if (!timeline) return undefined;
  let name: string | undefined;
  for (const s of timeline.scenes) if (t + 1e-6 >= s.start) name = s.id;
  return name;
};

/** Delta do cue até a fala: 0 quando o cue começa dentro da fala; senão a distância à fala mais próxima. */
function deltaToSpeech(t: number, segs: Segment[]): { delta: number; inside: boolean } {
  let best = Infinity;
  for (const s of segs) {
    if (t >= s.start - 0.001 && t <= s.end) return { delta: 0, inside: true };
    best = Math.min(best, t < s.start ? s.start - t : t - s.end);
  }
  return { delta: Number.isFinite(best) ? best : 0, inside: false };
}

/**
 * Ancora a primeira e a última palavra da cena na fala real do stem.
 *
 * O faster-whisper sem VAD tende a começar a primeira palavra até ~0,5 s antes
 * do som (o modelo inclui o silêncio no começo do segmento). O QA mede exatamente
 * isso: aqui o texto continua vindo do roteiro, só o início/fim da cena são
 * presos ao primeiro/último trecho com energia.
 */
export function snapSceneWords(words: SubWord[], segs: Segment[], sceneStart: number, sceneSeconds: number): SubWord[] {
  if (!words.length || !segs.length) return words;
  const a = sceneStart, b = sceneStart + sceneSeconds;
  const inside = segs.filter((s) => s.end > a + 0.02 && s.start < b - 0.02);
  if (!inside.length) return words;
  const out = words.map((w) => ({ ...w }));
  const first = out[0]!;
  const absStart = a + first.start;
  const onset = inside.find((s) => s.start >= absStart - 0.15);
  if (onset && onset.start > absStart + 0.08 && onset.start - absStart <= 1 && onset.start < a + first.end) {
    first.start = +(onset.start - a).toFixed(3);
  }
  const last = out[out.length - 1]!;
  const absEnd = a + last.end;
  const offset = [...inside].reverse().find((s) => s.end <= absEnd + 0.15);
  if (offset && offset.end < absEnd - 0.08 && absEnd - offset.end <= 1 && offset.end > a + last.start) {
    last.end = +(offset.end - a).toFixed(3);
  }
  return out;
}

/**
 * Mede a sincronia das cues contra o áudio (stem de narração) e grava
 * `<outDir>/subtitles-qa.json`. Devolve o relatório; `ok=false` quando o pior caso
 * passa de 0,2 s.
 */
export async function checkSync(ffmpeg: string, audio: string, words: SubWord[], timeline: Timeline | undefined, outDir: string, signal?: AbortSignal, segs?: Segment[]): Promise<SyncQa> {
  const boxes = layoutCues(words);
  const segments = segs ?? await speechSegments(ffmpeg, audio, signal);
  const cues: SyncCue[] = boxes.map((b, i) => {
    const { delta, inside } = deltaToSpeech(b.start, segments);
    return { index: i + 1, scene: sceneAt(b.start, timeline), start: +b.start.toFixed(3), end: +b.end.toFixed(3), text: b.text, delta: +delta.toFixed(3), insideSpeech: inside };
  });
  const perSceneMap = new Map<string, SyncScene>();
  let worst: SyncQa['worst'] = null;
  for (const c of cues) {
    if (!worst || c.delta > worst.delta) worst = { delta: c.delta, scene: c.scene, cue: c.index, start: c.start };
    if (!c.scene) continue;
    const cur = perSceneMap.get(c.scene);
    if (!cur || c.delta > cur.worst) perSceneMap.set(c.scene, { scene: c.scene, worst: c.delta, cue: c.index });
  }
  /* regras de exibição (por construção devem passar; mede o que o arquivo realmente tem) */
  let tooShort = 0, cpsOver = 0, gapUnder = 0, tooManyLines = 0, overlaps = 0;
  boxes.forEach((b, i) => {
    const dur = b.end - b.start;
    if (dur < 0.8 - 0.001) tooShort++;
    if (b.text.length / Math.max(0.01, dur) > 20.001) cpsOver++;
    if (i > 0 && b.start - boxes[i - 1]!.end < 0.08 - 0.001) gapUnder++;
    if (b.lines.length > 2) tooManyLines++;
    if (i > 0 && b.start < boxes[i - 1]!.end - 0.001) overlaps++;
  });
  const report: SyncQa = {
    ok: cues.every((c) => c.delta <= SYNC_TOLERANCE),
    limit: SYNC_TOLERANCE,
    audio,
    onsets: segments.length,
    worst,
    perScene: [...perSceneMap.values()].sort((a, b) => b.worst - a.worst),
    cues,
    display: { cues: boxes.length, tooShort, cpsOver, gapUnder, tooManyLines, overlaps },
    checkedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'subtitles-qa.json'), JSON.stringify(report, null, 1));
  } catch { /* se não deu para gravar, o log ainda leva o resultado */ }
  return report;
}

/** Linha curta para o log: pior caso e cenas reprovadas. */
export function syncQaLine(q: SyncQa): string {
  const w = q.worst;
  const worst = w ? `${w.delta.toFixed(2)} s (cue ${w.cue}${w.scene ? `, cena ${w.scene}` : ''}, em ${w.start.toFixed(2)} s)` : 'sem cues';
  const bad = q.perScene.filter((s) => s.worst > q.limit);
  const d = q.display;
  const rules = d.tooShort || d.cpsOver || d.gapUnder || d.tooManyLines || d.overlaps
    ? ` · regras: ${[d.tooShort && `${d.tooShort} cue(s) < 0,8 s`, d.cpsOver && `${d.cpsOver} acima de 20 CPS`, d.gapUnder && `${d.gapUnder} sem 0,08 s`, d.overlaps && `${d.overlaps} sobreposta(s)`, d.tooManyLines && `${d.tooManyLines} com >2 linhas`].filter(Boolean).join(', ')}`
    : ' · regras de exibição ok';
  return q.ok
    ? `QA de sincronia: pior caso ${worst} — aprovado (limite ${q.limit.toFixed(2)} s)${rules}`
    : `QA de sincronia REPROVADO: pior caso ${worst} (limite ${q.limit.toFixed(2)} s)${bad.length ? ` · cenas: ${bad.map((s) => `${s.scene} ${s.worst.toFixed(2)} s`).join(', ')}` : ''}${rules}`;
}
