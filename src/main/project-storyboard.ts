import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, Scene } from '../shared/types';
import { actTimeline } from './channel-dna';

/*
 * STORYBOARD DO PROJETO ("Criar storyboard" em Novo projeto):
 * logo depois do plano de cenas, o app monta o storyboard (um quadro por cena: tempo, ato, narração, visual,
 * câmera, tipo e efeitos) em out/storyboard.json + out/storyboard.html. Com "pedir aprovação", a execução
 * pausa até o usuário aprovar; a aprovação vale para AQUELE plano (hash) — editar as cenas pede de novo.
 * Diferente do storyboard interno do cartoon 3D (assets.md), que é instrução para o harness.
 */

export interface StoryboardPanel {
  id: string; index: number; title: string;
  from: number; to: number; durationSec: number;
  act?: string;
  narration: string; visual: string; camera?: string; kind: string; sfx?: string[];
  /** imagem já gerada para a cena (reexecução), relativa ao projeto */
  image?: string;
}
export interface Storyboard { project: string; name: string; hash: string; createdAt: string; totalSec: number; panels: StoryboardPanel[] }

const IMG = /\.(png|jpe?g|webp)$/i;

/** Hash do plano: muda quando título, narração, visual, câmera, tipo ou duração de alguma cena mudam. */
export function planHash(scenes: Scene[]): string {
  const key = scenes.map((s) => [s.id, s.title, s.narration, s.visualIntent, s.camera ?? '', s.kind, s.durationSec ?? ''].join('␟')).join('␞');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/** Duração estimada da cena: a do plano, senão pela narração (≈ 2,6 palavras/s), mínimo 2 s. */
const sceneSec = (s: Scene) => s.durationSec && s.durationSec > 0 ? s.durationSec : Math.max(2, Math.round((s.narration.split(/\s+/).filter(Boolean).length / 2.6) * 10) / 10);

/** Monta o storyboard a partir das cenas (função pura). */
export function buildStoryboard(p: Pick<Project, 'id' | 'name' | 'scenes' | 'targetDurationSec'> & { skill?: Project['skill'] }): Storyboard {
  let t = 0;
  const total = p.scenes.reduce((a, s) => a + sceneSec(s), 0);
  const acts = actTimeline(p.skill?.formatDna?.acts, total || p.targetDurationSec);
  const panels = [...p.scenes].sort((a, b) => a.index - b.index).map((s) => {
    const d = sceneSec(s);
    const from = t; t += d;
    const mid = from + d / 2;
    const act = acts.find((a) => mid >= a.from && mid <= a.to)?.name;
    const image = Object.values(s.artifacts ?? {}).flat().find((f) => IMG.test(f));
    return { id: s.id, index: s.index, title: s.title, from: Math.round(from * 10) / 10, to: Math.round(t * 10) / 10, durationSec: d, act,
      narration: s.narration, visual: s.visualIntent, camera: s.camera, kind: s.kind, sfx: s.sfx?.length ? s.sfx : undefined, image };
  });
  return { project: p.id, name: p.name, hash: planHash(p.scenes), createdAt: new Date().toISOString(), totalSec: Math.round(t * 10) / 10, panels };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Página do storyboard (abre no navegador e imprime em PDF). */
export function storyboardHtml(b: Storyboard, projectDir: string): string {
  const cards = b.panels.map((x) => {
    const abs = x.image ? (path.isAbsolute(x.image) ? x.image : path.join(projectDir, x.image)) : '';
    const img = abs ? `<img src="${esc(encodeURI(`file:///${abs.replace(/\\/g, '/').replace(/^\/+/, '')}`))}" alt="">` : `<div class="ph">${esc(x.kind)}</div>`;
    return `<article><div class="frame">${img}<span class="n">${x.index}</span><span class="t">${mmss(x.from)}–${mmss(x.to)}</span></div>
<h3>${esc(x.title)}</h3>${x.act ? `<div class="act">${esc(x.act)}</div>` : ''}
<p class="v"><b>Visual:</b> ${esc(x.visual)}</p>${x.camera ? `<p class="c"><b>Câmera:</b> ${esc(x.camera)}</p>` : ''}
<p class="nar">“${esc(x.narration)}”</p>${x.sfx ? `<p class="sfx">🔊 ${x.sfx.map(esc).join(', ')}</p>` : ''}</article>`;
  }).join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Storyboard — ${esc(b.name)}</title><style>
:root{--bg:#f6f6f8;--card:#fff;--ink:#16161a;--mut:#666;--ac:#6d4aff}
@media (prefers-color-scheme:dark){:root{--bg:#111116;--card:#1b1b22;--ink:#ececf1;--mut:#9a9aa6;--ac:#9b84ff}}
body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}
h1{margin:0 0 4px;font-size:22px}.meta{color:var(--mut);margin-bottom:18px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
article{background:var(--card);border-radius:12px;padding:10px;box-shadow:0 1px 3px #0002;break-inside:avoid}
.frame{position:relative;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#0003;display:grid;place-items:center}
.frame img{width:100%;height:100%;object-fit:cover}.ph{color:var(--mut);text-transform:uppercase;letter-spacing:2px}
.n{position:absolute;left:6px;top:6px;background:var(--ac);color:#fff;border-radius:6px;padding:0 7px;font-weight:700}
.t{position:absolute;right:6px;bottom:6px;background:#000a;color:#fff;border-radius:6px;padding:0 6px;font-size:12px}
h3{margin:8px 0 2px;font-size:15px}.act{display:inline-block;font-size:11px;color:var(--ac);border:1px solid var(--ac);border-radius:99px;padding:0 8px;margin-bottom:4px}
p{margin:4px 0}.nar{color:var(--mut);font-style:italic}.sfx{font-size:12px;color:var(--mut)}
@media print{body{background:#fff}article{box-shadow:none;border:1px solid #ccc}}
</style></head><body><h1>Storyboard — ${esc(b.name)}</h1><div class="meta">${b.panels.length} cenas · ${mmss(b.totalSec)} · plano ${b.hash}</div><main>
${cards}
</main></body></html>`;
}

/** Grava out/storyboard.json e out/storyboard.html; devolve o storyboard e os caminhos. */
export function writeStoryboard(p: Project, projectDir: string): { board: Storyboard; json: string; html: string } {
  const board = buildStoryboard(p);
  const out = path.join(projectDir, 'out');
  fs.mkdirSync(out, { recursive: true });
  const json = path.join(out, 'storyboard.json'), html = path.join(out, 'storyboard.html');
  fs.writeFileSync(json, JSON.stringify(board, null, 1));
  fs.writeFileSync(html, storyboardHtml(board, projectDir));
  return { board, json, html };
}

/** Lê o storyboard gravado (ou undefined). */
export function readStoryboard(projectDir: string): Storyboard | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, 'out', 'storyboard.json'), 'utf8')) as Storyboard; } catch { return undefined; }
}

/** Precisa de aprovação? (opção ligada e o plano atual ainda não foi aprovado) */
export const needsApproval = (p: Pick<Project, 'storyboard' | 'scenes'>): boolean =>
  !!p.storyboard?.enabled && !!p.storyboard.approval && p.storyboard.approvedHash !== planHash(p.scenes);
