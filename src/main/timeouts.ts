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
export function stepTimeoutSec(step: Pick<RouteStep, 'id' | 'kind' | 'timeoutSec'>): number {
  return isSlowStep(step) ? Math.max(SLOW_STEP_TIMEOUT_SEC, step.timeoutSec ?? 0) : (step.timeoutSec ?? 900);
}
