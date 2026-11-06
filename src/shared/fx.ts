import type { FxSegment, Project } from './types';

/* Trechos de filtro/vinheta na timeline: colocar, consultar, migrar e validar. */

export const FX_FILTER_IDS = ['none', 'bw', 'sepia', 'vivid', 'warm', 'cool', 'blur', 'cinematic', 'teal_orange', 'vintage', 'noir', 'matte', 'dramatic'];
export const FX_VIGNETTE_IDS = ['none', 'soft', 'strong'];
const round = (x: number) => Math.round(x * 100) / 100;
export const totalOf = (p: Pick<Project, 'scenes'>) => round(p.scenes.reduce((a, s) => a + Math.max(0.5, s.durationSec ?? 4), 0));
export const segEnd = (s: FxSegment, total: number) => (s.toEnd ? Math.max(total, s.start) : s.end);
let seq = 0;
export const newSegId = () => `fx${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Coloca `value` no intervalo [a,b] da faixa `kind`, recortando os trechos do mesmo
 * tipo que se sobrepõem (sem empilhar dois filtros no mesmo instante). value 'none' só recorta.
 */
export function placeSeg(segs: FxSegment[], kind: FxSegment['kind'], value: string, a: number, b: number, total: number, toEnd = false, layer = 0): FxSegment[] {
  const A = Math.max(0, round(a)), B = toEnd ? total : round(Math.min(b, total));
  const out: FxSegment[] = [];
  for (const s of segs) {
    if (s.kind !== kind || (s.layer ?? 0) !== layer) { out.push(s); continue; }
    const e = segEnd(s, total);
    if (e <= A || s.start >= B) { out.push(s); continue; }            // não sobrepõe
    if (s.start < A) out.push({ ...s, id: s.start < A && e > B ? newSegId() : s.id, end: A, toEnd: false });   // pedaço antes
    if (e > B) out.push({ ...s, id: newSegId(), start: B, end: e, toEnd: !!s.toEnd });                       // pedaço depois
  }
  if (value !== 'none' && B - A >= 0.1) out.push({ id: newSegId(), kind, value, start: A, end: B, toEnd: toEnd || B >= total - 0.01, ...(layer ? { layer } : {}) });
  return out.sort((x, y) => (x.layer ?? 0) - (y.layer ?? 0) || x.start - y.start);
}

/** Primeira camada livre em [a,b] para a faixa `kind` (estilo CapCut: efeitos sobrepostos vão para a linha de cima). */
export function freeLayer(segs: FxSegment[], kind: FxSegment['kind'], a: number, b: number, total: number): number {
  for (let l = 0; l < 10; l++) if (!segs.some((s) => s.kind === kind && (s.layer ?? 0) === l && s.start < b - 1e-6 && segEnd(s, total) > a + 1e-6)) return l;
  return 9;
}
/** Adiciona um efeito POR CIMA (nova camada se o intervalo estiver ocupado), sem apagar os outros. */
export function addSegLayer(segs: FxSegment[], kind: FxSegment['kind'], value: string, a: number, b: number, total: number, toEnd = false): FxSegment[] {
  return placeSeg(segs, kind, value, a, b, total, toEnd, freeLayer(segs, kind, a, toEnd ? total : b, total));
}
export const layersOf = (segs: FxSegment[] | undefined, kind: FxSegment['kind']) => Math.max(1, ...((segs ?? []).filter((s) => s.kind === kind).map((s) => (s.layer ?? 0) + 1)));
/** Todos os valores ativos no instante t (de baixo para cima). */
export function segsAt(segs: FxSegment[] | undefined, kind: FxSegment['kind'], t: number, total: number): string[] {
  return (segs ?? []).filter((s) => s.kind === kind && s.start <= t + 1e-6 && t < segEnd(s, total) - 1e-6).sort((x, y) => (x.layer ?? 0) - (y.layer ?? 0)).map((s) => s.value);
}

/** Valor da faixa no instante t (o último trecho que cobre t). */
export function segAt(segs: FxSegment[] | undefined, kind: FxSegment['kind'], t: number, total: number): string {
  const hit = (segs ?? []).filter((s) => s.kind === kind && s.start <= t + 1e-6 && t < segEnd(s, total) - 1e-6);
  return hit[hit.length - 1]?.value ?? 'none';
}

/** Valida/normaliza os trechos vindos da interface. */
export function cleanSegments(v: unknown): FxSegment[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: FxSegment[] = [];
  for (const x of v.slice(0, 200)) {
    if (!x || typeof x !== 'object') continue;
    const s = x as Record<string, unknown>;
    const kind = s['kind'] === 'vignette' ? 'vignette' : s['kind'] === 'filter' ? 'filter' : undefined;
    if (!kind) continue;
    const value = String(s['value'] ?? '');
    if (!(kind === 'filter' ? FX_FILTER_IDS : FX_VIGNETTE_IDS).includes(value) || value === 'none') continue;
    const start = Math.max(0, round(Number(s['start']) || 0)), end = round(Number(s['end']) || 0);
    if (!(end - start >= 0.1) && !s['toEnd']) continue;
    const layer = Math.max(0, Math.min(9, Math.round(Number(s['layer']) || 0)));
    out.push({ id: /^[a-z0-9]{1,40}$/i.test(String(s['id'])) ? String(s['id']) : newSegId(), kind, value, start, end: Math.max(end, start + 0.1), toEnd: !!s['toEnd'], ...(layer ? { layer } : {}) });
  }
  return out.length ? out.sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.start - b.start) : undefined;
}

/**
 * Projetos antigos: filtro/vinheta por cena e do "vídeo final" viram trechos da timeline
 * (cenas vizinhas iguais viram um trecho só). Retorna true se mudou algo.
 */
export function migrateSceneFx(p: Project): boolean {
  const legacy = p.scenes.some((s) => (s.effects?.filter ?? 'none') !== 'none' || (s.effects?.vignette ?? 'none') !== 'none')
    || (p.finalEffects?.filter ?? 'none') !== 'none' || (p.finalEffects?.vignette ?? 'none') !== 'none';
  if (!legacy) return false;
  const total = totalOf(p);
  let segs = [...(p.fxSegments ?? [])];
  for (const kind of ['filter', 'vignette'] as const) {
    const fin = p.finalEffects?.[kind];
    if (fin && fin !== 'none') segs = placeSeg(segs, kind, fin, 0, total, total, true);
    let t = 0;
    for (const s of p.scenes) {
      const d = Math.max(0.5, s.durationSec ?? 4);
      const v = s.effects?.[kind];
      if (v && v !== 'none') {
        // emenda com o trecho anterior igual
        const prev = segs.find((x) => x.kind === kind && x.value === v && Math.abs(x.end - t) < 0.02 && !x.toEnd);
        if (prev && !(fin && fin !== 'none')) prev.end = round(t + d);
        else if (!(fin && fin !== 'none')) segs = placeSeg(segs, kind, v, t, t + d, total);
      }
      t += d;
    }
  }
  for (const s of p.scenes) if (s.effects) { s.effects.filter = 'none'; s.effects.vignette = 'none'; }
  if (p.finalEffects) { delete p.finalEffects.filter; delete p.finalEffects.vignette; }
  p.fxSegments = segs.length ? segs : undefined;
  return true;
}
