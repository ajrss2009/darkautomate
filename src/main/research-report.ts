import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * ANÁLISE DA IA DA PESQUISA (Pesquisar → 🧠 Analisar resultados com IA) → arquivo TXT ou PDF.
 * Funções puras (texto e HTML); o PDF é o HTML impresso pelo Electron (printToPDF) no main.
 */

export interface InsightMeta { query?: string; platform?: string; videoType?: string; videos?: number; at?: string; binding?: string }

const SECTIONS: Array<[string, string]> = [
  ['trends', 'Em alta'], ['titlePatterns', 'Títulos que funcionam'], ['formats', 'Formatos'], ['opportunities', 'Oportunidades'], ['ideas', 'Ideias de vídeo'],
];
const listOf = (ins: Record<string, unknown>, k: string) => (Array.isArray(ins[k]) ? (ins[k] as unknown[]).map((x) => String(x).trim()).filter(Boolean) : []);
const when = (m: InsightMeta) => (m.at ? new Date(m.at) : new Date()).toLocaleString('pt-BR');
const subject = (m: InsightMeta) => [m.query?.trim() ? `"${m.query.trim()}"` : '', m.videoType ? `tipo: ${m.videoType}` : '', m.platform ?? ''].filter(Boolean).join(' · ') || 'pesquisa';

export function insightsToText(ins: Record<string, unknown>, m: InsightMeta = {}): string {
  const out = [`ANÁLISE DA IA — ${subject(m)}`, `${when(m)}${m.videos ? ` · ${m.videos} vídeos analisados` : ''}${m.binding || ins['binding'] ? ` · ${m.binding ?? String(ins['binding'])}` : ''}`, ''];
  if (ins['summary']) out.push('RESUMO', String(ins['summary']).trim(), '');
  for (const [k, label] of SECTIONS) {
    const l = listOf(ins, k);
    if (!l.length) continue;
    out.push(label.toUpperCase(), ...l.map((x, i) => (k === 'ideas' ? `${i + 1}. ${x}` : `- ${x}`)), '');
  }
  return out.join('\r\n').trimEnd() + '\r\n';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function insightsToHtml(ins: Record<string, unknown>, m: InsightMeta = {}): string {
  const secs = SECTIONS.map(([k, label]) => {
    const l = listOf(ins, k);
    if (!l.length) return '';
    const tag = k === 'ideas' ? 'ol' : 'ul';
    return `<section><h2>${esc(label)}</h2><${tag}>${l.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}></section>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Análise da IA</title><style>
body{font-family:Segoe UI,Arial,sans-serif;color:#1b1d24;margin:36px 44px;font-size:12.5pt;line-height:1.45}
h1{font-size:20pt;margin:0 0 4px}.meta{color:#666;font-size:10pt;margin-bottom:18px}
.summary{background:#f3f1ff;border-left:4px solid #7c5cff;padding:10px 14px;border-radius:4px;margin-bottom:14px}
h2{font-size:13.5pt;margin:16px 0 6px;color:#3b2fb0}li{margin:3px 0}section{page-break-inside:avoid}
</style></head><body><h1>🧠 Análise da IA</h1><div class="meta">${esc(subject(m))} · ${esc(when(m))}${m.videos ? ` · ${m.videos} vídeos analisados` : ''}${ins['binding'] ? ` · ${esc(String(ins['binding']))}` : ''}</div>
${ins['summary'] ? `<div class="summary">${esc(String(ins['summary']))}</div>` : ''}${secs}</body></html>`;
}

/** Nome de arquivo seguro: analise-<termo>-AAAA-MM-DD-HHmm. */
export function reportBaseName(m: InsightMeta = {}): string {
  const d = m.at ? new Date(m.at) : new Date(), pad = (n: number) => String(n).padStart(2, '0');
  const slug = (m.query || m.videoType || m.platform || 'pesquisa').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'pesquisa';
  return `analise-${slug}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export const reportsDir = (workspace: string) => path.join(workspace, 'finder', 'analyses');

/* ── canais favoritos da pesquisa (workspace/finder/favorite-channels.json) ── */
export interface FavoriteChannel { id: string; platform: string; channel: string; channelUrl?: string; subs?: number; channelAgeDays?: number; best?: number; hits?: number; languages?: string[]; avgRatio?: number; query?: string; savedAt?: string; note?: string }
const favChFile = (workspace: string) => path.join(workspace, 'finder', 'favorite-channels.json');
/** id estável: URL do canal (sem barra final/minúsculas) ou plataforma + nome */
export const channelFavId = (c: { platform?: string; channel: string; channelUrl?: string }) =>
  (c.channelUrl?.trim().replace(/\/+$/, '').toLowerCase()) || `${c.platform ?? 'youtube'}:${c.channel.trim().toLowerCase()}`;
export function readFavoriteChannels(workspace: string): FavoriteChannel[] {
  try { const j = JSON.parse(fs.readFileSync(favChFile(workspace), 'utf8')) as unknown; return Array.isArray(j) ? (j as FavoriteChannel[]).filter((x) => x && x.id && x.channel) : []; } catch { return []; }
}
function writeFavoriteChannels(workspace: string, list: FavoriteChannel[]) {
  fs.mkdirSync(path.dirname(favChFile(workspace)), { recursive: true });
  fs.writeFileSync(favChFile(workspace), JSON.stringify(list, null, 1));
}
/** Liga/desliga o favorito do canal; devolve a lista nova. */
export function toggleFavoriteChannel(workspace: string, c: Omit<FavoriteChannel, 'id'> & { id?: string }): FavoriteChannel[] {
  const id = c.id || channelFavId(c);
  const list = readFavoriteChannels(workspace);
  const next = list.some((x) => x.id === id) ? list.filter((x) => x.id !== id)
    : [{ ...c, id, platform: c.platform || 'youtube', savedAt: new Date().toISOString() }, ...list];
  writeFavoriteChannels(workspace, next);
  return next;
}
export function removeFavoriteChannels(workspace: string, ids: string[]): FavoriteChannel[] {
  const next = readFavoriteChannels(workspace).filter((x) => !ids.includes(x.id));
  writeFavoriteChannels(workspace, next);
  return next;
}
