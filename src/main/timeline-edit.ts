import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FxSegment, Project, Scene, Settings } from '../shared/types';
import { projectDirOf } from './settings';
import { addScene, duplicateScene, reindex } from './ops';
import { readWords, wordsPath, type WordTime } from './whisper';

/*
 * Ferramentas de edição da timeline (estilo CapCut): cortar o início/fim de um clipe, dividir no cursor, inserir um
 * clipe no começo, no meio ou no fim e excluir com "ripple" — tudo o que vem depois anda junto (trechos de filtro e
 * vinheta da timeline são empurrados ou puxados pela mesma quantidade).
 * O corte do início vira `trimStart` (segundos pulados no visual, na narração e nos efeitos sonoros da cena) e a
 * duração vira manual; os tempos das palavras (legendas) e o texto da narração acompanham o corte.
 */

const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const sceneLen = (sc: Scene) => Math.max(0.5, sc.durationSec ?? 4);
export const sceneAt = (p: Project, idx: number) => p.scenes.slice(0, idx).reduce((a, s) => a + sceneLen(s), 0);
const dirOf = (s: Settings, p: Project, sc: Scene) => path.join(projectDirOf(s, p.id), 'scenes', sc.id);
const find = (p: Project, id: string) => { const i = p.scenes.findIndex((x) => x.id === id); if (i < 0) throw new Error(`cena "${id}" não existe`); return i; };

/**
 * Ripple dos trechos de efeito: a partir do instante `at`, tudo anda `delta` segundos (delta < 0 = puxa).
 * Trecho que atravessa `at` estica/encolhe; trecho que cai inteiro num pedaço removido some. Função pura.
 */
export function rippleSegments(segs: FxSegment[] | undefined, at: number, delta: number): FxSegment[] | undefined {
  if (!segs?.length || !delta) return segs;
  const cutEnd = delta < 0 ? at - delta : at;            // pedaço removido: [at, at - delta)
  const out: FxSegment[] = [];
  for (const g of segs) {
    let { start, end } = g;
    if (delta > 0) {
      if (start >= at) { start += delta; end += delta; } else if (end > at) end += delta;
    } else {
      const mv = (t: number) => (t >= cutEnd ? t + delta : t > at ? at : t);
      start = mv(start); end = mv(end);
      if (end - start < 0.05) continue;
    }
    out.push({ ...g, start: r3(start), end: r3(end) });
  }
  return out;
}

/** Palavras da cena: as que caem em [a, b) passam a contar de 0. */
const sliceWords = (words: WordTime[], a: number, b: number) =>
  words.filter((w) => w.start >= a - 0.02 && w.start < b).map((w) => ({ ...w, start: r3(Math.max(0, w.start - a)), end: r3(Math.min(b, w.end) - a) }));

function rewriteWords(dir: string, words: WordTime[] | undefined) {
  if (!words) return;
  const f = wordsPath(dir), old = readWords(f);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ ...(old ?? { source: 'editor' }), text: words.map((w) => w.w).join(' '), words }, null, 1));
}

/** Texto da narração de um pedaço: pelas palavras com tempo; sem elas, pela proporção do tempo. */
function narrationPart(sc: Scene, words: WordTime[] | undefined, a: number, b: number, len: number): string {
  if (words?.length) return words.filter((w) => w.start >= a - 0.02 && w.start < b).map((w) => w.w).join(' ');
  const t = sc.narration.trim().split(/\s+/).filter(Boolean);
  return t.slice(Math.round((a / len) * t.length), Math.round((Math.min(b, len) / len) * t.length)).join(' ');
}

const keepCues = (sc: Scene, a: number, b: number) => {
  if (!sc.sfxCues) return;
  sc.sfxCues = sc.sfxCues.filter((c) => c.at === undefined || (c.at >= a && c.at < b)).map((c) => (c.at === undefined ? c : { ...c, at: r3(c.at - a) }));
};

/**
 * Corta o clipe: `cutStart` = segundos tirados do começo, `cutEnd` = segundos tirados do fim.
 * O resto da timeline anda junto (ripple). Devolve a nova duração.
 */
export function trimScene(s: Settings, p: Project, id: string, o: { cutStart?: number; cutEnd?: number }): number {
  const i = find(p, id), sc = p.scenes[i]!, len = sceneLen(sc), at0 = sceneAt(p, i);
  const a = Math.max(0, o.cutStart ?? 0), b = Math.max(0, o.cutEnd ?? 0);
  if (len - a - b < 0.3) throw new Error('o clipe ficaria curto demais (mínimo 0,3 s)');
  const dir = dirOf(s, p, sc), words = readWords(wordsPath(dir))?.words;
  if (words || a || b) sc.narration = narrationPart(sc, words, a, len - b, len) || sc.narration;
  rewriteWords(dir, words && sliceWords(words, a, len - b));
  keepCues(sc, a, len - b);
  if (a) sc.trimStart = r3((sc.trimStart ?? 0) + a);
  sc.durationSec = r3(len - a - b); sc.manualDuration = true;
  if (a) p.fxSegments = rippleSegments(p.fxSegments, at0, -a);
  if (b) p.fxSegments = rippleSegments(p.fxSegments, at0 + len - a - b, -b);
  return sc.durationSec;
}

/** Divide o clipe no instante `at` (segundos desde o início dele): vira dois clipes seguidos, mesma mídia. */
export function splitScene(s: Settings, p: Project, id: string, at: number): Scene {
  const i = find(p, id), sc = p.scenes[i]!, len = sceneLen(sc);
  if (at < 0.2 || at > len - 0.2) throw new Error('posicione o cursor dentro do clipe (a pelo menos 0,2 s das bordas)');
  const dir = dirOf(s, p, sc), words = readWords(wordsPath(dir))?.words;
  const textA = narrationPart(sc, words, 0, at, len), textB = narrationPart(sc, words, at, len, len);
  const b = duplicateScene(s, p, id);
  const bDir = dirOf(s, p, b);
  b.title = `${sc.title.replace(/ \(parte \d+\)$/, '')} (parte 2)`;
  if (!/\(parte \d+\)$/.test(sc.title)) sc.title = `${sc.title} (parte 1)`;
  sc.narration = textA; b.narration = textB;
  if (sc.subtitle?.trim()) { const t = sc.subtitle.trim().split(/\s+/), k = Math.round((at / len) * t.length); sc.subtitle = t.slice(0, k).join(' '); b.subtitle = t.slice(k).join(' '); }
  rewriteWords(dir, words && sliceWords(words, 0, at));
  rewriteWords(bDir, words && sliceWords(words, at, len));
  keepCues(sc, 0, at); keepCues(b, at, len);
  b.trimStart = r3((sc.trimStart ?? 0) + at);
  sc.durationSec = r3(at); b.durationSec = r3(len - at); sc.manualDuration = b.manualDuration = true;
  /* a transição para a próxima cena fica no pedaço 2; o fade de entrada só no 1, o de saída só no 2 */
  if (sc.effects) { b.effects = { ...sc.effects, fadeIn: false }; sc.effects = { ...sc.effects, fadeOut: false, transition: 'none' }; }
  reindex(p);
  return b;
}

/** Onde inserir: no começo, antes/depois de um clipe, no fim ou num instante da timeline (divide o clipe se cair no meio). */
export type InsertWhere = { at: 'start' | 'end' } | { at: 'before' | 'after'; sceneId: string } | { at: 'time'; time: number };

/** Posição (índice) de inserção; com `time` no meio de um clipe, divide-o antes. */
export function insertIndex(s: Settings, p: Project, where: InsertWhere): number {
  if (where.at === 'start') return 0;
  if (where.at === 'end') return p.scenes.length;
  if (where.at === 'before') return find(p, where.sceneId);
  if (where.at === 'after') return find(p, where.sceneId) + 1;
  if (where.at !== 'time') return p.scenes.length;
  let acc = 0;
  for (let i = 0; i < p.scenes.length; i++) {
    const len = sceneLen(p.scenes[i]!);
    if (where.time <= acc + 0.2) return i;
    if (where.time < acc + len - 0.2) { splitScene(s, p, p.scenes[i]!.id, where.time - acc); return i + 1; }
    acc += len;
  }
  return p.scenes.length;
}

/**
 * Insere um clipe (vídeo ou imagem do usuário) na posição pedida; tudo depois dele é empurrado (ripple).
 * A mídia é copiada para a cena (clips/clip.<ext> ou frames/frame.png) e as etapas da cena ficam prontas,
 * para a execução não gerar outro visual por cima. Devolve a cena criada e o diretório dela.
 */
export function insertClip(s: Settings, p: Project, o: { file: string; seconds: number; where: InsertWhere }): { scene: Scene; dir: string } {
  const ext = path.extname(o.file).toLowerCase();
  const isVideo = /^\.(mp4|mov|mkv|webm|m4v|avi|gif)$/.test(ext), isImage = /^\.(png|jpe?g|webp|bmp)$/.test(ext);
  if (!isVideo && !isImage) throw new Error('formato não suportado (use vídeo mp4/mov/mkv/webm ou imagem png/jpg/webp)');
  const idx = insertIndex(s, p, o.where);
  const seconds = r3(Math.max(0.5, Math.min(3600, o.seconds || 4)));
  const at = sceneAt(p, idx);
  const afterId = idx > 0 ? p.scenes[idx - 1]!.id : null;
  const sc = addScene(s, p, afterId, { title: path.basename(o.file, ext).slice(0, 60) || 'Clipe inserido', kind: isVideo ? 'video' : 'image', durationSec: seconds });
  if (!afterId) { p.scenes = [sc, ...p.scenes.filter((x) => x !== sc)]; reindex(p); }
  const dir = dirOf(s, p, sc);
  /* nomes que a montagem procura; o ffmpeg reconhece o formato pelo conteúdo (mov/webm/jpg funcionam com esse nome) */
  const dest = path.join(dir, isVideo ? 'clips/clip.mp4' : 'frames/frame.png');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(o.file, dest);
  sc.manualDuration = true;
  sc.visualIntent = `Clipe inserido pelo usuário: ${path.basename(o.file)}`;
  for (const st of p.route?.steps ?? []) if (st.scope === 'scene') sc.status[st.id] = 'done';
  p.fxSegments = rippleSegments(p.fxSegments, at, seconds);
  return { scene: sc, dir };
}

/** Exclui clipes puxando o resto da timeline (ripple) — os trechos de efeito acompanham. */
export function rippleDeleteSegments(p: Project, ids: string[]) {
  /* do fim para o começo, para os instantes dos anteriores continuarem válidos */
  const idx = p.scenes.map((x, i) => (ids.includes(x.id) ? i : -1)).filter((i) => i >= 0).sort((a, b) => b - a);
  for (const i of idx) p.fxSegments = rippleSegments(p.fxSegments, sceneAt(p, i), -sceneLen(p.scenes[i]!));
}
