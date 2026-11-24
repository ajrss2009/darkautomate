import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MediaBank } from '../shared/types';
import { catalogScore, loadIndex, metaOf, nearDuplicate, saveIndex, type MediaMeta } from './media-index';

/*
 * PASTA / BANCO DE MÍDIA como provedor de imagem e de vídeo: para cada cena, escolhe na pasta do usuário a imagem
 * (etapa de imagem) ou o clipe (etapa de vídeo) que mais combina com a cena — nome do arquivo, subpastas e uma
 * legenda opcional ao lado (<arquivo>.txt) — SEM REPETIR dentro do vídeo (e, se o banco pedir, entre vídeos).
 * Sem arquivo novo que sirva, a etapa passa para o próximo provedor. Funções puras + leitura da pasta.
 */

export const IMAGE_EXT = /\.(png|jpe?g|webp|bmp)$/i;
export const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|gif)$/i;
export interface MediaItem { file: string; rel: string; kind: 'image' | 'video'; words: string[] }

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['the', 'and', 'with', 'for', 'from', 'into', 'over', 'shot', 'scene', 'video', 'image', 'img', 'dsc', 'vid', 'copy', 'final', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'para', 'uma', 'um', 'no', 'na', 'of', 'a', 'in', 'on', 'at']);
/** palavras úteis de um texto (sem acento, minúsculas, ≥ 3 letras, sem números soltos nem palavras vazias). Função pura. */
export function words(t: string): string[] {
  return [...new Set(norm(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w)))];
}

/** Lê a pasta (com subpastas) — até `max` arquivos de imagem/vídeo; a legenda <arquivo>.txt entra nas palavras. */
export function scanBank(dir: string, max = 8000): MediaItem[] {
  const out: MediaItem[] = [];
  const walk = (d: string, depth: number) => {
    if (out.length >= max || depth > 8) return;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= max) return;
      if (e.name.startsWith('.')) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f, depth + 1); continue; }
      const kind = IMAGE_EXT.test(e.name) ? 'image' : VIDEO_EXT.test(e.name) ? 'video' : undefined;
      if (!kind) continue;
      const rel = path.relative(dir, f).replace(/\\/g, '/');
      let caption = '';
      for (const c of [`${f}.txt`, f.replace(/\.\w+$/, '.txt')]) { try { caption = fs.readFileSync(c, 'utf8').slice(0, 2000); break; } catch { /* sem legenda */ } }
      out.push({ file: f, rel, kind, words: words(`${rel.replace(/\.\w+$/, '')} ${caption}`) });
    }
  };
  walk(dir, 0);
  return out;
}

/** Pontuação: palavra igual vale 2, começo comum (≥ 4 letras: "snowy" ~ "snow") vale 1. Função pura. */
export function scoreItem(item: Pick<MediaItem, 'words'>, terms: string[]): number {
  let s = 0;
  for (const t of terms) {
    if (item.words.includes(t)) { s += 2; continue; }
    if (t.length >= 4 && item.words.some((w) => w.length >= 4 && (w.startsWith(t.slice(0, 4)) && t.startsWith(w.slice(0, 4))))) s += 1;
  }
  return s;
}

const hash = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** Melhor arquivo do tipo pedido que ainda não foi usado; empate = ordem estável pela semente (cena). Função pura. */
export function pickMedia(items: MediaItem[], o: { kind: 'image' | 'video'; terms: string[]; used: Set<string>; seed: string }): MediaItem | undefined {
  const pool = items.filter((x) => x.kind === o.kind && !o.used.has(x.rel));
  if (!pool.length) return undefined;
  let best: MediaItem | undefined, bs = -1, bh = 0;
  for (const it of pool) {
    const sc = scoreItem(it, o.terms), hv = hash(`${o.seed}|${it.rel}`);
    if (sc > bs || (sc === bs && hv < bh)) { best = it; bs = sc; bh = hv; }
  }
  return best;
}

const readUsed = (f: string): string[] => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(j) ? j.map(String) : []; } catch { return []; } };
export const projectUsedFile = (outDir: string, bankId: string) => path.join(outDir, `media-bank-used.${bankId.replace(/[^\w-]+/g, '_')}.json`);
export const bankUsedFile = (bank: Pick<MediaBank, 'dir'>) => path.join(bank.dir, '.filmforge-used.json');

/**
 * Escolhe e REGISTRA o arquivo da cena (tudo síncrono: cenas que rodam ao mesmo tempo não pegam o mesmo arquivo).
 * Uma cena refeita reaproveita o arquivo que já era dela (não "gasta" outro).
 */
/**
 * Escolha pelo ÍNDICE (com ffmpeg): os 24 melhores por texto são medidos e pontuados pela fórmula do catálogo
 * (encaixe, paleta, movimento, ineditismo); cópias e quase-cópias (hash/dHash) de algo já usado ficam de fora.
 */
export function pickIndexed(items: MediaItem[], o: { bankDir: string; kind: 'image' | 'video'; terms: string[]; used: Set<string>; usedElsewhere: Set<string>; seed: string; tools: { ffmpeg: string; ffprobe: string }; sceneSec?: number; targetColor?: string }): { item: MediaItem; meta?: MediaMeta; score: number } | undefined {
  const pool = items.filter((x) => x.kind === o.kind && !o.used.has(x.rel));
  if (!pool.length) return undefined;
  const ranked = pool.map((it) => ({ it, sc: scoreItem(it, o.terms), hv: hash(`${o.seed}|${it.rel}`) })).sort((a, b) => b.sc - a.sc || a.hv - b.hv).slice(0, 24);
  const top = Math.max(1, ranked[0]!.sc);
  const idx = loadIndex(o.bankDir);
  let dirty = false;
  const usedMeta = [...o.used].map((r) => idx[r]).filter((m): m is MediaMeta => !!m);
  let best: { item: MediaItem; meta?: MediaMeta; score: number } | undefined;
  for (const r of ranked) {
    let meta: MediaMeta | undefined;
    try { const got = metaOf(idx, o.bankDir, r.it.rel, o.kind, o.tools); meta = got.meta; dirty ||= got.dirty; } catch { /* arquivo sumiu */ continue; }
    if (usedMeta.some((u) => nearDuplicate(u, meta))) continue;      // mesmo arquivo com outro nome / reexportado
    const score = catalogScore({ text: r.sc / top, meta, kind: o.kind, sceneSec: o.sceneSec, targetColor: o.targetColor, usedElsewhere: o.usedElsewhere.has(r.it.rel) });
    if (!best || score > best.score) best = { item: r.it, meta, score };
  }
  if (dirty) saveIndex(o.bankDir, idx);
  return best;
}

/** Cobertura antes do render: quantos arquivos novos o banco ainda tem para o que o plano pede. */
export function bankCoverage(banks: MediaBank[], need: { image: number; video: number }, outDir: string, scan: (dir: string) => MediaItem[] = scanBank): { image: number; video: number; lines: string[]; short: boolean } {
  const avail = { image: 0, video: 0 };
  for (const bank of banks) {
    if (!bank.dir || !fs.existsSync(bank.dir)) continue;
    const mine = new Set(Object.values(readUsedMap(projectUsedFile(outDir, bank.id))));
    const across = bank.noRepeatAcross ? new Set(readUsed(bankUsedFile(bank))) : new Set<string>();
    for (const it of scan(bank.dir)) {
      if (bank.kinds?.length && !bank.kinds.includes(it.kind)) continue;
      if (!mine.has(it.rel) && !across.has(it.rel)) avail[it.kind]++;
    }
  }
  const lines: string[] = [];
  let short = false;
  for (const k of ['image', 'video'] as const) {
    if (!need[k]) continue;
    const ok = avail[k] >= need[k];
    short ||= !ok;
    lines.push(`${ok ? '✓' : '⚠'} ${k === 'video' ? 'clipes' : 'imagens'}: ${need[k]} cena(s) pedem, ${avail[k]} arquivo(s) novo(s) no banco${ok ? '' : ` — ${need[k] - avail[k]} cena(s) vão para o próximo provedor`}`);
  }
  return { ...avail, lines, short };
}

export function takeMedia(o: { banks: MediaBank[]; kind: 'image' | 'video'; terms: string[]; outDir: string; sceneKey: string; scan?: (dir: string) => MediaItem[]; tools?: { ffmpeg: string; ffprobe: string }; sceneSec?: number; targetColor?: string }): { item: MediaItem; bank: MediaBank; meta?: MediaMeta; score?: number } | undefined {
  const scan = o.scan ?? scanBank;
  for (const bank of o.banks) {
    if (!bank.dir || !fs.existsSync(bank.dir)) continue;
    if (bank.kinds?.length && !bank.kinds.includes(o.kind)) continue;
    const pf = projectUsedFile(o.outDir, bank.id);
    const mine = readUsedMap(pf);
    const items = scan(bank.dir);
    const prev = mine[`${o.sceneKey}|${o.kind}`];
    const again = prev ? items.find((x) => x.rel === prev) : undefined;
    if (again) return { item: again, bank };
    const across = readUsed(bankUsedFile(bank));
    const used = new Set([...Object.values(mine), ...(bank.noRepeatAcross ? across : [])]);
    /* continuidade de cor: o plano anterior deste projeto (último arquivo escolhido) */
    const lastRel = Object.values(mine).at(-1);
    const targetColor = o.targetColor ?? (lastRel ? loadIndex(bank.dir)[lastRel]?.avg : undefined);
    const ix = o.tools ? pickIndexed(items, { bankDir: bank.dir, kind: o.kind, terms: o.terms, used, usedElsewhere: new Set(across), seed: o.sceneKey, tools: o.tools, sceneSec: o.sceneSec, targetColor }) : undefined;
    const it = ix?.item ?? (o.tools ? undefined : pickMedia(items, { kind: o.kind, terms: o.terms, used, seed: o.sceneKey }));
    if (!it) continue;
    mine[`${o.sceneKey}|${o.kind}`] = it.rel;
    fs.mkdirSync(path.dirname(pf), { recursive: true });
    fs.writeFileSync(pf, JSON.stringify(mine, null, 1));
    if (bank.noRepeatAcross) { try { fs.writeFileSync(bankUsedFile(bank), JSON.stringify([...new Set([...readUsed(bankUsedFile(bank)), it.rel])], null, 1)); } catch { /* pasta só leitura: repete entre vídeos */ } }
    return { item: it, bank, meta: ix?.meta, score: ix?.score };
  }
  return undefined;
}
function readUsedMap(f: string): Record<string, string> { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } }
