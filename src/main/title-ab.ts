import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Settings } from '../shared/types';
import { listChannel, listChannelClones } from './channel-clone';
import { ensureYtDlp } from './youtube';

/*
 * O LOOP QUE FALTAVA — medir qual variante ganhou.
 *
 * O ciclo do catálogo é gerar → pontuar → julgar → medir → voltar ao banco.
 * Sem a última volta, cada vídeo começa do zero: ninguém sabe qual título venceu
 * e o benchmark nunca aprende. Aqui o teste A/B fica registrado, é medido por
 * views ÷ mediana do canal (a régua que o canal já usa) e o vencedor volta como
 * exemplo para as próximas gerações.
 *
 * Uma variável por teste: A e B trocam só o título, só o texto da thumb ou só a
 * imagem — trocar duas coisas ao mesmo tempo não ensina nada.
 */

export interface AbVariant {
  key: 'A' | 'B';
  title: string;
  thumbText?: string;
  /** link do vídeo publicado (YouTube) ou o id */
  url?: string;
  videoId?: string;
  views?: number;
  /** views ÷ mediana do canal */
  ratio?: number;
}

export interface AbTest {
  id: string;
  createdAt: string;
  /** canal clonado (id) ou URL do canal: é dele que sai a mediana */
  channelId?: string;
  channelUrl?: string;
  projectId?: string;
  variants: [AbVariant, AbVariant];
  /** o que mudou entre A e B (deve ser UMA coisa) */
  changes: string[];
  /** mediana de views do canal usada na conta */
  baseline?: number;
  winner?: 'A' | 'B' | 'empate';
  measuredAt?: string;
}

export interface AbChampion { title: string; ratio: number; channel?: string; at: string }

const store = (s: Settings) => path.join(s.workspace, 'craft', 'ab.json');
const KEY = (k: string) => k.toLowerCase().trim();

/** Um teste salvo por vez, sempre com as duas variantes. */
export function listAb(s: Settings): AbTest[] {
  try {
    const j = JSON.parse(fs.readFileSync(store(s), 'utf8')) as AbTest[];
    return Array.isArray(j) ? j.filter((t) => t && Array.isArray(t.variants) && t.variants.length === 2) : [];
  } catch { return []; }
}

function saveAb(s: Settings, tests: AbTest[]): void {
  fs.mkdirSync(path.dirname(store(s)), { recursive: true });
  fs.writeFileSync(store(s), JSON.stringify(tests.slice(0, 200), null, 1));
}

/** Mediana de uma lista (0 quando vazia). */
export function medianViews(list: number[]): number {
  const v = list.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** O que mudou entre as duas variantes — o teste só vale se for uma coisa. */
export function changedFields(a: Pick<AbVariant, 'title' | 'thumbText'>, b: Pick<AbVariant, 'title' | 'thumbText'>): string[] {
  const out: string[] = [];
  if (KEY(a.title) !== KEY(b.title)) out.push('título');
  if ((a.thumbText ?? '').trim() !== (b.thumbText ?? '').trim()) out.push('thumbnail');
  return out;
}

export interface CreateAbInput { a: Omit<AbVariant, 'key' | 'ratio'> & { key?: 'A' }; b: Omit<AbVariant, 'key' | 'ratio'> & { key?: 'B' }; channelId?: string; channelUrl?: string; projectId?: string; baseline?: number }

export function createAb(s: Settings, input: CreateAbInput): AbTest {
  const a: AbVariant = { ...input.a, key: 'A' };
  const b: AbVariant = { ...input.b, key: 'B' };
  if (!a.title?.trim() || !b.title?.trim()) throw new Error('as duas variantes precisam de um título');
  const changes = changedFields(a, b);
  if (!changes.length) throw new Error('A e B são iguais: mude uma coisa (título ou thumbnail) para o teste medir algo');
  const test: AbTest = {
    id: `ab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(), channelId: input.channelId, channelUrl: input.channelUrl, projectId: input.projectId,
    variants: [a, b], changes, baseline: input.baseline,
  };
  saveAb(s, [test, ...listAb(s)]);
  return test;
}

/** Atualiza um teste (links/views informados à mão, baseline). */
export function patchAb(s: Settings, id: string, patch: Partial<Pick<AbTest, 'baseline' | 'channelUrl' | 'channelId'>> & { variants?: Partial<AbVariant>[] }): AbTest {
  const tests = listAb(s);
  const i = tests.findIndex((t) => t.id === id);
  if (i < 0) throw new Error('teste A/B não encontrado');
  const t = tests[i]!;
  const variants = t.variants.map((v, k) => ({ ...v, ...(patch.variants?.[k] ?? {}), key: v.key })) as [AbVariant, AbVariant];
  const next: AbTest = { ...t, ...(patch.baseline !== undefined ? { baseline: patch.baseline } : {}), ...(patch.channelUrl ? { channelUrl: patch.channelUrl } : {}), ...(patch.channelId ? { channelId: patch.channelId } : {}), variants };
  tests[i] = next;
  saveAb(s, tests);
  return next;
}

/* ───────── medição ───────── */

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    c.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    c.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    const abort = () => c.kill();
    signal?.addEventListener('abort', abort, { once: true });
    c.on('error', (e) => resolve({ code: -1, out, err: err + e.message }));
    c.on('close', (code) => { signal?.removeEventListener('abort', abort); resolve({ code, out, err }); });
  });
}

/** Views de um vídeo publicado (yt-dlp, sem baixar). */
export async function videoViews(s: Settings, url: string, log: (l: string) => void, signal?: AbortSignal): Promise<number> {
  const exe = await ensureYtDlp(s, log);
  const r = await run(exe, ['-J', '--skip-download', '--no-warnings', '--', url], signal);
  if (r.code !== 0) throw new Error(`não consegui ler as views de ${url}: ${(r.err || r.out).split('\n').slice(-2).join(' ').slice(0, 200)}`);
  const j = JSON.parse(r.out) as { view_count?: number };
  return Number(j.view_count) || 0;
}

/** Mediana de views do canal do teste (canal clonado, URL do canal ou a última análise). */
async function baselineOf(s: Settings, t: AbTest, log: (l: string) => void, signal?: AbortSignal): Promise<number | undefined> {
  if (t.baseline && t.baseline > 0) return t.baseline;
  if (t.channelId) {
    const c = listChannelClones(s).find((x) => x.id === t.channelId);
    const views = (c?.recent ?? []).map((r) => r.views).filter((n) => Number.isFinite(n) && n! > 0) as number[];
    if (views.length) return medianViews(views);
  }
  if (t.channelUrl) {
    try {
      const l = await listChannel(s, t.channelUrl, log, signal);
      const views = (l.entries ?? []).map((e) => e.view_count).filter((n): n is number => Number.isFinite(n) && !!n && n > 0);
      if (views.length) return medianViews(views);
    } catch { /* sem mediana do canal: cai para a mediana do teste */ }
  }
  return undefined;
}

/**
 * Mede o teste: views de cada variante ÷ mediana do canal. Vence a maior razão,
 * desde que passe de 10% sobre a segunda (senão é empate — diferença que o ruído
 * do YouTube explica não ensina nada).
 */
export async function measureAb(s: Settings, id: string, log: (l: string) => void, signal?: AbortSignal): Promise<AbTest> {
  const tests = listAb(s);
  const i = tests.findIndex((t) => t.id === id);
  if (i < 0) throw new Error('teste A/B não encontrado');
  const t = tests[i]!;
  const views: number[] = [];
  for (const v of t.variants) {
    if (v.views !== undefined && Number.isFinite(v.views)) { views.push(v.views); continue; }
    if (!v.url && !v.videoId) throw new Error(`informe o link (ou as views) da variante ${v.key}`);
    const url = v.url ?? `https://www.youtube.com/watch?v=${v.videoId}`;
    views.push(await videoViews(s, url, log, signal));
  }
  let baseline = await baselineOf(s, t, log, signal);
  let source = 'canal';
  if (!baseline) { baseline = medianViews(views); source = 'mediana do teste (sem dados do canal)'; }
  if (!baseline) throw new Error('sem mediana: o canal não tem views para servir de régua');
  const ratios = views.map((v) => v / baseline);
  const [ra, rb] = [ratios[0]!, ratios[1]!];
  let winner: AbTest['winner'] = 'empate';
  const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
  if (hi > 0 && hi >= lo * 1.1 + 1e-9) winner = ra >= rb ? 'A' : 'B';
  const variants = t.variants.map((v, k) => ({ ...v, views: views[k]!, ratio: +ratios[k]!.toFixed(3) })) as [AbVariant, AbVariant];
  const next: AbTest = { ...t, variants, baseline: +baseline.toFixed(2), winner, measuredAt: new Date().toISOString() };
  tests[i] = next;
  saveAb(s, tests);
  log(`A/B: mediana ${Math.round(baseline)} views (${source}) · A ${Math.round(ra * 100)}% · B ${Math.round(rb * 100)}% → ${winner === 'empate' ? 'empate (diferença < 10%)' : `venceu ${winner}`}`);
  return next;
}

/** Títulos que já venceram (voltam ao banco e entram no prompt das próximas gerações). */
export function champions(s: Settings, limit = 5): AbChampion[] {
  const out: AbChampion[] = [];
  for (const t of listAb(s)) {
    if (t.winner !== 'A' && t.winner !== 'B') continue;
    const v = t.variants.find((x) => x.key === t.winner);
    if (!v?.title || !v.ratio) continue;
    out.push({ title: v.title, ratio: v.ratio, channel: t.channelUrl ?? t.channelId, at: t.measuredAt ?? t.createdAt });
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, limit);
}

/** Linha curta do teste para log/UI. */
export function abLine(t: AbTest): string {
  const fmt = (v: AbVariant) => `${v.key} "${v.title}"${v.views !== undefined ? ` · ${v.views} views (${Math.round((v.ratio ?? 0) * 100)}% da mediana)` : ''}`;
  const base = t.baseline ? ` · mediana ${Math.round(t.baseline)}` : '';
  const res = t.winner ? (t.winner === 'empate' ? ' · empate' : ` · venceu ${t.winner}`) : ' · não medido';
  return `${fmt(t.variants[0])} × ${fmt(t.variants[1])}${base}${res}${t.changes.length > 1 ? ` · ATENÇÃO: ${t.changes.length} variáveis mudaram (${t.changes.join(', ')})` : ''}`;
}
