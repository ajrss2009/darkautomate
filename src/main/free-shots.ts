/*
 * VÍDEO LIVRE EM PLANOS CURTOS (modelos locais): um 9B não segura 32 s numa página só (cenário listrado, personagem
 * empilhado, metade da história faltando), mas acerta uma ação simples em 3–4 s. Então o vídeo é planejado em planos
 * de 3 a 4 s (JSON guiado), cada plano vira uma página própria (o mesmo pipeline: modo estrito, validadores,
 * correções) e o FilmForge junta os vídeos e desloca os sons de cada plano para o tempo dele. Funções puras.
 */

import type { SfxCue } from '../shared/types';

/** Harnesses de modelo local (servidor no próprio PC). */
export const LOCAL_FREE = /^(?:ollama|llamacpp|lmstudio)$/i;

/** Vídeo livre que vale dividir em planos: modelo local e mais de 4,5 s. */
export const shotsWanted = (harness: string, durSec: number) => LOCAL_FREE.test(harness) && durSec > 4.5;

/** Durações dos planos: entre 3 e 4 s, somando exatamente a duração (o último absorve o resto). */
export function shotDurations(total: number): number[] {
  const t = Math.max(1, total);
  if (t <= 4.5) return [Math.round(t * 100) / 100];
  const n = Math.max(2, Math.round(t / 3.5));
  const each = Math.round((t / n) * 100) / 100;
  const out = Array.from({ length: n }, () => each);
  out[n - 1] = Math.round((t - each * (n - 1)) * 100) / 100;
  return out;
}

export interface ShotPlan { look: string; shots: Array<{ action: string; seconds: number }> }

/** Esquema do plano (decodificação guiada): visual fixo + N ações. */
export function planSchema(n: number): object {
  return {
    type: 'object', required: ['look', 'shots'],
    properties: {
      look: { type: 'string', description: 'personagem e cenário fixos do vídeo inteiro: cores, formas, onde fica o chão, o céu' },
      shots: { type: 'array', minItems: n, maxItems: n, items: { type: 'object', required: ['action'], properties: { action: { type: 'string' } } } },
    },
  };
}

/** Pedido do plano de planos (o modelo só escolhe as ações; as durações são do app). */
export function planPrompt(idea: string, durs: number[], aspect: string | undefined): string {
  return `Ideia do vídeo (${durs.reduce((a, b) => a + b, 0)} s, ${aspect ?? '16:9'}):\n${idea.trim()}\n\n` +
    `Divida em EXATAMENTE ${durs.length} planos de animação seguidos (${durs.map((d) => `${d} s`).join(', ')}). ` +
    'Cada plano = UMA ação simples e visível, que dá para desenhar em poucos segundos com a biblioteca do plugin (ex.: "a formiga entra pela esquerda e para no centro"; ' +
    '"close: a formiga corta a borda da folha"). Mantenha o mesmo personagem e o mesmo cenário entre planos (continuidade: onde um termina, o outro começa). ' +
    'Em "look" descreva o visual FIXO do vídeo inteiro (personagem, cores, cenário, céu e chão) em até 40 palavras. ' +
    'Responda SOMENTE com o JSON {"look": "...", "shots": [{"action": "..."}, ...]}.';
}

/** Lê o plano devolvido; inválido → undefined. */
export function parsePlan(text: string, durs: number[]): ShotPlan | undefined {
  try {
    const raw = text.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1');
    const j = JSON.parse(raw) as { look?: unknown; shots?: Array<{ action?: unknown }> };
    const acts = (j.shots ?? []).map((s) => String(s?.action ?? '').trim()).filter(Boolean);
    if (acts.length < durs.length) return undefined;
    return { look: String(j.look ?? '').trim().slice(0, 400), shots: durs.map((seconds, i) => ({ action: acts[i]!.slice(0, 400), seconds })) };
  } catch { return undefined; }
}

/** Plano sem IA (o modelo não devolveu JSON): divide a ideia pelas setas "→" ou pelas frases. */
export function fallbackPlan(idea: string, durs: number[]): ShotPlan {
  let parts = idea.split(/\s*(?:→|->|=>)\s*/).map((x) => x.trim()).filter((x) => x.length > 3);
  if (parts.length < 2) parts = idea.split(/(?<=[.!?;])\s+/).map((x) => x.trim()).filter((x) => x.length > 3);
  if (!parts.length) parts = [idea.trim()];
  /* N planos: distribui as partes em ordem (parte repetida = a ação continua; partes juntadas = plano mais cheio) */
  const shots = durs.map((seconds, i) => {
    const a = Math.floor((i * parts.length) / durs.length), b = Math.max(a + 1, Math.floor(((i + 1) * parts.length) / durs.length));
    return { action: parts.slice(a, b).join(' — ').slice(0, 400), seconds };
  });
  return { look: '', shots };
}

/** Ideia de UM plano (vira o prompt da página dele). */
export function shotIdea(idea: string, plan: ShotPlan, i: number, aspect: string | undefined, ref?: string): string {
  const s = plan.shots[i]!, n = plan.shots.length;
  const prev = plan.shots[i - 1]?.action, next = plan.shots[i + 1]?.action;
  return `${aspect ?? '16:9'}, ${s.seconds} segundos — PLANO ${i + 1} de ${n} de um vídeo maior. Anime SÓ esta ação, simples e clara:\n${s.action}\n\n` +
    (plan.look ? `VISUAL FIXO (igual em todos os planos — mesmas cores, mesmo personagem, mesmo cenário): ${plan.look}\n` : '') +
    (ref ? `CENÁRIO DO PLANO 1 (reuse estas mesmas chamadas e cores para o fundo, salvo se a ação pede outro lugar, ex.: dentro do ninho):\n${ref}\n` : '') +
    (prev ? `O plano anterior terminou assim: ${prev}\n` : 'É o primeiro plano: abra o vídeo.\n') +
    (next ? `O próximo plano começa com: ${next}\n` : 'É o último plano: feche o vídeo.\n') +
    `Contexto do vídeo inteiro (não anime tudo isto, só o plano acima): ${idea.trim().slice(0, 500)}`;
}

/**
 * Fundo do plano 1 como referência de continuidade: as linhas da página que desenham céu, chão, sol, grama e cores
 * de fundo (sem o personagem nem a ação). Até 700 caracteres; nada achado → undefined.
 */
export function backdropRef(page: string): string | undefined {
  const lines = page.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => /\bL\.(?:sky\w*|grass\w*|ground\w*|sun\w*|moon\w*|hill\w*|cloud\w*|soil\w*|dirt\w*)\s*\(|fillRect\s*\(\s*0\s*,\s*0|createLinearGradient/.test(l) && l.length < 220);
  const out: string[] = [];
  let len = 0;
  for (const l of lines) { if (len + l.length > 700) break; if (!out.includes(l)) { out.push(l); len += l.length + 1; } }
  return out.length ? out.join('\n') : undefined;
}

/** Sons dos planos no tempo do vídeo final (cada plano começa no fim do anterior). */
export function mergeShotSfx(lists: Array<Array<{ t?: number; at?: number; name: string; gain?: number }>>, durs: number[]): SfxCue[] {
  const out: SfxCue[] = [];
  let off = 0;
  lists.forEach((cues, i) => {
    const d = durs[i] ?? 0;
    for (const c of cues ?? []) {
      const t = Number(c.t ?? c.at);
      if (!c.name || !Number.isFinite(t) || t < 0 || t >= d) continue;   // som fora do plano (ex.: o modelo planejou 18 s num plano de 4)
      out.push({ name: c.name, at: Math.round((off + t) * 100) / 100, ...(c.gain !== undefined ? { gain: c.gain } : {}) });
    }
    off += d;
  });
  return out;
}
