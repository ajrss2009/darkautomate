import type { RouteStep } from '../shared/types';

/** Piso de prazo por tentativa das etapas caras: render + correções + revisão não cabem em 15 min. */
export const SLOW_STEP_TIMEOUT_SEC = 1800;

/** Etapa que renderiza uma cena por código/kit (o prazo cobre harness, render e revisão). */
export const isSlowStep = (step: Pick<RouteStep, 'id' | 'kind'>) =>
  step.id === 'kit_assets' || step.kind === 'code_scene' || step.kind === 'motion_graphics';

/**
 * Prazo efetivo de UMA tentativa da etapa. O motor usa este número no cronômetro e o executor passa o
 * mesmo número ao harness — antes o motor esperava 30 min e o harness morria em 15 (timeout do harness).
 */
/** Roteiro/plano de cenas de vídeo longo: o modelo escreve tudo de uma vez (9 min de vídeo passava de 15 min). */
export const LONG_TEXT_KINDS = new Set(['script', 'scene_plan', 'storyboard']);
export function stepTimeoutSec(step: Pick<RouteStep, 'id' | 'kind' | 'timeoutSec'>, targetDurationSec = 0): number {
  const base = isSlowStep(step) ? Math.max(SLOW_STEP_TIMEOUT_SEC, step.timeoutSec ?? 0) : (step.timeoutSec ?? 900);
  return LONG_TEXT_KINDS.has(step.kind) && targetDurationSec > 240 ? Math.max(base, Math.round(900 + targetDurationSec * 2)) : base;
}
