import type { Route, SceneKind, Skill } from './types';

/**
 * Compatibilidade entre skill e rota. A skill descreve o vídeo (tipos de cena,
 * fontes que mescla, vozes); a rota precisa ter etapas que produzam isso.
 */

const on = (r: Route | undefined) => (r?.steps ?? []).filter((s) => s.enabled);
export const routeHasKind = (r: Route | undefined, kind: string) => on(r).some((s) => s.kind === kind);
export const routeHasTool = (r: Route | undefined, tool: string) => on(r).some((s) => s.bindings.some((b) => b.type === 'builtin' && b.tool === tool));

/** Tipos de cena que a rota consegue produzir (mesma regra do motor). */
export function producibleKinds(r: Route | undefined): Set<SceneKind> {
  const k = new Set<SceneKind>();
  for (const s of on(r)) {
    if (s.kind === 'code_scene') k.add('code');
    if (s.kind === 'motion_graphics') k.add('motion');
    if (s.kind === 'stock_media') k.add('stock');
    if (s.kind === 'image') k.add('image');
    if (s.kind === 'video') k.add('video');
  }
  if (k.has('stock') && (k.has('code') || k.has('motion'))) k.add('mixed');
  // code_scene que aceita "motion" também desenha motion graphics
  if (on(r).some((s) => s.kind === 'code_scene' && (s.onlySceneKinds ?? []).includes('motion'))) k.add('motion');
  return k;
}

export const KIND_PT: Record<SceneKind, string> = { image: 'imagem', video: 'vídeo IA', code: 'código', motion: 'motion graphics', mixed: 'misto (código + banco)', stock: 'banco de mídia' };
const MIX_NEEDS: Record<string, { label: string; kinds: string[] }> = {
  motion: { label: 'motion graphics/código', kinds: ['code_scene', 'motion_graphics'] },
  stock: { label: 'banco de imagens/vídeos', kinds: ['stock_media'] },
  ai: { label: 'vídeo IA', kinds: ['video'] },
};

export interface CompatReport { errors: string[]; warnings: string[]; ok: string[] }

/**
 * @param sceneKind  estratégia visual padrão da aparência da skill (VIDEO_TYPES[].sceneKind)
 * @param suggested  rota sugerida pela skill (para detectar skills que exigem uma rota especial)
 */
export function checkSkillRoute(skill: Skill | undefined, route: Route | undefined, sceneKind?: SceneKind, suggested?: Route): CompatReport {
  const rep: CompatReport = { errors: [], warnings: [], ok: [] };
  if (!skill || !route) return rep;
  const kinds = producibleKinds(route);
  if (skill.freeform) {
    if (!routeHasKind(route, 'free')) rep.errors.push('Skill de vídeo livre precisa de uma rota com a etapa "Vídeo livre" — o app troca para a rota "Vídeo livre".');
    else rep.ok.push('Vídeo livre: o prompt vai direto ao harness.');
    return rep;
  }
  if (routeHasKind(route, 'free') && !routeHasKind(route, 'scene_plan')) {
    rep.errors.push('A rota é de vídeo livre (sem cenas), mas a skill planeja cenas — o app troca para a rota sugerida da skill.');
    return rep;
  }
  if (routeHasTool(suggested, 'clip-musical') && !routeHasTool(route, 'clip-musical')) rep.errors.push('Esta skill é de clipe musical: escolha uma rota com a montagem "clip-musical".');
  if (routeHasTool(suggested, 'lyric-song') && !routeHasTool(route, 'lyric-song')) rep.errors.push('Esta skill é de lyric video: escolha uma rota que gere a canção e os tempos da letra ("lyric-song").');
  for (const m of skill.presentation === 'mixed' ? (skill.mixSources ?? ['motion', 'stock']) : (skill.mixSources ?? [])) {
    const need = MIX_NEEDS[m];
    if (need && !need.kinds.some((k) => routeHasKind(route, k))) rep.warnings.push(`A skill mescla ${need.label}, mas a rota não tem etapa para isso.`);
  }
  if (sceneKind && !kinds.has(sceneKind) && !routeHasTool(route, 'clip-musical')) {
    rep.warnings.push(`A aparência pede cenas de ${KIND_PT[sceneKind]}; nesta rota elas viram ${[...kinds].map((k) => KIND_PT[k]).join(' / ') || '—'}.`);
  }
  if (skill.multiVoice && !routeHasKind(route, 'narration')) rep.warnings.push('A skill tem diálogo com várias vozes, mas a rota não tem narração.');
  if (skill.multiVoice && routeHasKind(route, 'narration')) rep.ok.push('Diálogo: cada cena usa a voz do personagem (defina o elenco abaixo).');
  if (!rep.errors.length && !rep.warnings.length) rep.ok.push(`A rota produz: ${[...kinds].map((k) => KIND_PT[k]).join(', ') || 'apenas montagem'}.`);
  return rep;
}
