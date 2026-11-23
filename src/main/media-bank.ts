import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MediaBank } from '../shared/types';

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
export function takeMedia(o: { banks: MediaBank[]; kind: 'image' | 'video'; terms: string[]; outDir: string; sceneKey: string; scan?: (dir: string) => MediaItem[] }): { item: MediaItem; bank: MediaBank } | undefined {
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
    const used = new Set([...Object.values(mine), ...(bank.noRepeatAcross ? readUsed(bankUsedFile(bank)) : [])]);
    const it = pickMedia(items, { kind: o.kind, terms: o.terms, used, seed: o.sceneKey });
    if (!it) continue;
    mine[`${o.sceneKey}|${o.kind}`] = it.rel;
    fs.mkdirSync(path.dirname(pf), { recursive: true });
    fs.writeFileSync(pf, JSON.stringify(mine, null, 1));
    if (bank.noRepeatAcross) { try { fs.writeFileSync(bankUsedFile(bank), JSON.stringify([...new Set([...readUsed(bankUsedFile(bank)), it.rel])], null, 1)); } catch { /* pasta só leitura: repete entre vídeos */ } }
    return { item: it, bank };
  }
  return undefined;
}
function readUsedMap(f: string): Record<string, string> { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } }
