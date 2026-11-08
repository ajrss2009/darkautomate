import type { Project, Scene, Skill, SkillMixItem } from '../shared/types';

/*
 * VÍDEO COM VÁRIAS SKILLS (percentual de tempo de cada uma):
 *  - a 1ª é a PRINCIPAL: roteiro, narração, trilha e legendas seguem ela (o vídeo tem uma linha só);
 *  - o plano de cenas recebe as faixas de tempo de cada skill (em blocos) ou a regra de alternância;
 *  - depois do plano, o app CONFERE e corrige as cotas pela duração das cenas e grava em cada cena a cópia da skill
 *    dela (scene.skillOverride — o mesmo mecanismo de "regerar cena com outra skill").
 * Funções puras: testáveis.
 */

export const MIX_MAX = 4;

/** Normaliza a mistura: a principal primeiro, sem repetidas, até 4, cada uma ≥ 5% e soma 100. */
export function normalizeMix(items: Array<{ skillId: string; pct: number }>, primary: string): Array<{ skillId: string; pct: number }> {
  const seen = new Set<string>();
  let list = items.filter((x) => x.skillId && !seen.has(x.skillId) && !!seen.add(x.skillId)).map((x) => ({ skillId: x.skillId, pct: Math.max(0, Number(x.pct) || 0) }));
  if (!list.some((x) => x.skillId === primary)) list.unshift({ skillId: primary, pct: 50 });
  list = [list.find((x) => x.skillId === primary)!, ...list.filter((x) => x.skillId !== primary)].slice(0, MIX_MAX);
  list = list.map((x) => ({ ...x, pct: Math.max(5, x.pct) }));
  const sum = list.reduce((a, b) => a + b.pct, 0);
  const scaled = list.map((x) => ({ ...x, pct: Math.round((x.pct / sum) * 100) }));
  scaled[0]!.pct += 100 - scaled.reduce((a, b) => a + b.pct, 0);
  return scaled;
}

const durOf = (s: Pick<Scene, 'durationSec' | 'narration'>) => (s.durationSec && s.durationSec > 0 ? s.durationSec : Math.max(2, (s.narration ?? '').split(/\s+/).filter(Boolean).length / 2.6));

/**
 * Skill de cada cena (na ordem das cenas) pela duração:
 *  - blocks: faixas contínuas na ordem da mistura (a cena vai para a faixa que contém o seu meio);
 *  - interleave: a cada cena, a skill mais "atrasada" em relação à cota (alterna sozinha, na proporção pedida).
 * Toda skill recebe ao menos uma cena quando há cenas suficientes.
 */
export function assignSkillMix(scenes: Array<Pick<Scene, 'durationSec' | 'narration'>>, mix: Array<{ skillId: string; pct: number }>, mode: 'blocks' | 'interleave'): string[] {
  if (!scenes.length || !mix.length) return [];
  const d = scenes.map(durOf);
  const total = d.reduce((a, b) => a + b, 0);
  const out: string[] = [];
  if (mode === 'blocks') {
    const bounds: number[] = []; let acc = 0;
    for (const m of mix) { acc += (m.pct / 100) * total; bounds.push(acc); }
    let t = 0;
    for (const x of d) { const mid = t + x / 2; t += x; out.push(mix[Math.min(mix.length - 1, bounds.findIndex((b) => mid <= b + 1e-9))]!.skillId); }
  } else {
    const got = new Map(mix.map((m) => [m.skillId, 0]));
    let elapsed = 0;
    d.forEach((x, i) => {
      elapsed += x;
      const deficit = (m: { skillId: string; pct: number }) => (m.pct / 100) * elapsed - got.get(m.skillId)!;
      /* a mais atrasada na cota (empate: a que não acabou de entrar) — alterna sozinha e respeita o percentual */
      const pick = [...mix].sort((a, b) => deficit(b) - deficit(a) || (a.skillId === out[i - 1] ? 1 : b.skillId === out[i - 1] ? -1 : 0))[0]!;
      out.push(pick.skillId); got.set(pick.skillId, got.get(pick.skillId)! + x);
    });
  }
  /* garante ao menos 1 cena por skill: a que ficou sem nenhuma toma a cena mais longa da skill com mais cenas */
  if (scenes.length >= mix.length) {
    for (const m of mix) {
      if (out.includes(m.skillId)) continue;
      const counts = new Map(mix.map((x) => [x.skillId, out.filter((o) => o === x.skillId).length]));
      const donor = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      const idx = out.map((o, i) => [o, i] as const).filter(([o]) => o === donor).sort((a, b) => d[b[1]]! - d[a[1]]!)[0]![1];
      out[idx] = m.skillId;
    }
  }
  return out;
}

/** Percentual real de tempo de cada skill depois da atribuição (para o log e o storyboard). */
export function mixShares(scenes: Array<Pick<Scene, 'durationSec' | 'narration'>>, assigned: string[]): Record<string, number> {
  const d = scenes.map(durOf); const total = d.reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  assigned.forEach((id, i) => { out[id] = (out[id] ?? 0) + d[i]!; });
  for (const k of Object.keys(out)) out[k] = Math.round((out[k]! / total) * 100);
  return out;
}

/** Texto para o roteiro e o plano de cenas: quais skills, quanto de cada e onde (função pura). */
export function mixPrompt(p: Pick<Project, 'skillMix' | 'skillMixSkills' | 'skill' | 'targetDurationSec'>, stepKind: string): string {
  const mix = p.skillMix;
  if (!mix || mix.items.length < 2 || !['script', 'scene_plan', 'brief'].includes(stepKind)) return '';
  const all = [p.skill, ...(p.skillMixSkills ?? [])].filter((k): k is Skill => !!k);
  const about = (id: string) => { const k = all.find((x) => x.id === id); return k ? (k.outputStyle || k.description || '').replace(/\s+/g, ' ').slice(0, 220) : ''; };
  const dur = p.targetDurationSec || 60;
  let t = 0;
  const parts = mix.items.map((m) => { const from = t; t += (m.pct / 100) * dur; return `- ${m.name} — ${m.pct}%${mix.mode === 'blocks' ? ` (≈ ${Math.round(from)}–${Math.round(t)} s)` : ''}: ${about(m.skillId)}`; });
  if (stepKind === 'script') return `VÍDEO COM ${mix.items.length} ESTILOS (uma história só, mesma voz e mesmo tom; o roteiro dá espaço para cada estilo):\n${parts.join('\n')}`;
  return `VÍDEO COM ${mix.items.length} SKILLS — ${mix.mode === 'blocks' ? 'em BLOCOS, nesta ordem' : 'INTERCALADAS ao longo do vídeo'} (a primeira manda no roteiro, na voz e na trilha; o app confere as cotas pela duração das cenas):\n${parts.join('\n')}\n` +
    'Planeje o "kind" e o "visualIntent" de cada cena no estilo da skill da faixa dela, mantendo personagens, paleta e cenário coerentes entre os estilos.';
}

/**
 * Depois do plano: grava a skill de cada cena (cópia em scene.skillOverride; a principal fica sem cópia).
 * Cenas que o usuário já trocou para uma skill FORA da mistura não são tocadas. Devolve o percentual real.
 */
export function applySkillMix(p: Project): Record<string, number> | undefined {
  const mix = p.skillMix;
  if (!mix || mix.items.length < 2 || !p.scenes.length) return undefined;
  const ids = new Set(mix.items.map((m) => m.skillId));
  const scenes = [...p.scenes].sort((a, b) => a.index - b.index);
  const assigned = assignSkillMix(scenes, mix.items, mix.mode);
  const primary = mix.items[0]!.skillId;
  scenes.forEach((sc, i) => {
    if (sc.skillOverride && !ids.has(sc.skillOverride.id)) return;
    const id = assigned[i]!;
    if (id === primary) { delete sc.skillOverride; return; }
    const k = p.skillMixSkills?.find((x) => x.id === id);
    if (k) sc.skillOverride = JSON.parse(JSON.stringify(k)) as Skill;
  });
  return mixShares(scenes, assigned);
}
