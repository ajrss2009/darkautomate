/*
 * UGC DE PRODUTO e MÚSICA COM LIPSYNC — funções puras usadas pelo executor do Wan2GP:
 *  - onde cada cena começa na canção (o trecho da música que vira a trilha mantida do H3 naquela cena);
 *  - o pedido de lipsync do H3 (sem escrever a letra: com a letra escrita o H3 canta outra coisa);
 *  - as fotos do PRODUTO anexadas ao projeto (referência) que entram em image_refs junto do criador.
 */

import * as path from 'node:path';
import type { Attachment, Scene } from '../shared/types';

/** Início da cena na linha do tempo do vídeo (soma das durações anteriores), em segundos. */
export function sceneStartSec(scenes: Array<Pick<Scene, 'id' | 'durationSec'>>, id: string): number {
  let t = 0;
  for (const s of scenes) {
    if (s.id === id) return Math.round(t * 1000) / 1000;
    t += Number(s.durationSec) || 0;
  }
  return Math.round(t * 1000) / 1000;
}

/** Duração inteira do clipe que cobre a cena inteira (o H3 recebe segundos inteiros; a montagem corta o excesso). */
export const ceilSeconds = (sec: number, min = 2, max = 15) => Math.min(max, Math.max(min, Math.ceil((Number(sec) || 0) - 0.05)));

/**
 * Prompt de lipsync do MiniMax H3 com trilha mantida (audio_prompt_type AS): identifica quem canta e pede a boca
 * sincronizada, sem a letra e sem citar o áudio enviado (guia do próprio H3). Mantém a ação só em cantar.
 */
export function lipsyncPrompt(singer: string, visual: string): string {
  const who = singer.trim() || 'The singer';
  return `${visual.trim()}\n${who} is singing with natural lip movements synchronized, facing the camera in a medium close-up, ` +
    'mouth clearly visible, expressive but restrained performance, body gently moving to the rhythm; the camera moves slowly. ' +
    'Keep the action to singing: no talking, no extra gestures in front of the face.';
}

/**
 * Fotos de produto do projeto: imagens anexadas como "referência" ou "usar numa cena" (o plano UGC usa a foto como quadro),
 * sem as folhas de personagem/cenário da biblioteca; as que citam produto/product vêm primeiro.
 */
export function productRefFiles(atts: Attachment[] | undefined, max = 2): Attachment[] {
  return (atts ?? [])
    .filter((a) => a.kind === 'image' && (a.use === 'reference' || a.use === 'scene') && !/^(characters|locations|models)\//.test(a.file.replace(/\\/g, '/')))
    .sort((a, b) => Number(/produto|product/i.test(`${b.note ?? ''} ${b.file}`)) - Number(/produto|product/i.test(`${a.note ?? ''} ${a.file}`)))
    .slice(0, max);
}

/** Nome do produto para o prompt do H3 (nota do anexo ou nome do arquivo). */
export const productLabel = (a: Pick<Attachment, 'file' | 'note'>) =>
  (a.note?.replace(/\s*\(.*\)\s*$/, '').trim() || path.basename(a.file).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')).slice(0, 60);

/** Linhas de definição do H3: o produto como <Subject N>, igual à foto. */
export function productSubjectLines(labels: string[], firstIndex: number): string[] {
  return labels.map((l, i) => `<Subject ${firstIndex + i}> is the product "${l}" exactly as in <Picture ${firstIndex + i}>: same shape, colors, label and packaging.`);
}

/**
 * Inícios das cenas de uma canção com duração mínima: o tempo dos versos (Whisper/estimativa) às vezes junta versos
 * no fim (cena de 0,5 s) — o H3 precisa de ≥ 2 s e o corte fica ilegível. Empurra os inícios para frente e depois
 * para trás, sem passar do fim da canção; se não couber, divide por igual. starts[0] é sempre 0.
 */
export function minSpanStarts(starts: number[], total: number, min = 2.5): number[] {
  const n = starts.length;
  if (!n) return [];
  const m = Math.min(min, total / n);
  const s = starts.map((x) => Math.max(0, Number(x) || 0));
  s[0] = 0;
  for (let i = 1; i < n; i++) s[i] = Math.max(s[i]!, s[i - 1]! + m);
  for (let i = n - 1; i >= 1; i--) s[i] = Math.min(s[i]!, (i + 1 < n ? s[i + 1]! : total) - m);
  return s.map((x) => Math.round(x * 100) / 100);
}

/**
 * Inícios conhecidos (cenas com letra) + desconhecidos (cenas instrumentais, undefined): os desconhecidos repartem por
 * igual o intervalo entre o início conhecido anterior e o próximo (ou o fim da canção). starts[0] vira 0 se faltar.
 */
export function fillStarts(raw: Array<number | undefined>, total: number): number[] {
  const out = raw.slice();
  if (out[0] === undefined) out[0] = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i] !== undefined) continue;
    let j = i;
    while (j < out.length && out[j] === undefined) j++;
    const a = out[i - 1]!, b = j < out.length ? out[j]! : total, parts = j - i + 1;
    for (let k = i; k < j; k++) out[k] = Math.round((a + ((b - a) * (k - i + 1)) / parts) * 100) / 100;
    i = j - 1;
  }
  return out as number[];
}
