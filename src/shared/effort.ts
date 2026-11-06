import type { ReasoningEffort } from './types';

/** Opções mostradas na interface: Default = não envia esforço (usa o padrão do modelo). */
export const EFFORT_OPTIONS: Array<[string, string]> = [
  ['', 'Default'],
  ['low', 'Low'],
  ['high', 'High'],
  ['max', 'Max'],
];

export const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
};

/**
 * O modelo aceita o parâmetro de esforço?
 *
 * A detecção é conservadora de propósito: é melhor esconder o seletor do que
 * mandar uma flag que o CLI/API não conhece e quebrar a execução. `model` vazio
 * significa "modelo padrão do provedor".
 */
export function modelSupportsEffort(harness: string | undefined, model?: string): boolean {
  const m = (model ?? '').toLowerCase().trim();
  switch (harness) {
    case 'claude':
      // Claude Code aceita --effort em Opus/Sonnet; Haiku não expõe o controle.
      return !m || !/haiku/.test(m);
    case 'codex':
      // Codex usa model_reasoning_effort.
      return true;
    case 'antigravity':
      // O CLI `agy` aceita --effort (low|medium|high|xhigh|max).
      return true;
    case 'llamacpp':
    case 'lmstudio':
      // Servidores OpenAI-compatíveis só recebem reasoning_effort em modelos
      // de raciocínio conhecidos. Modelo vazio/auto fica sem seletor.
      return /(^|[/:_-])(gpt-5|o[134]|gpt-oss|qwq|deepseek[-_.]?r1|reason|thinking)/i.test(m);
    default:
      // opencode usa variantes embutidas no nome do modelo; Ollama/OpenClaw não
      // têm um parâmetro de esforço padronizado no nosso adaptador.
      return false;
  }
}

/** O provedor tem suporte a esforço em pelo menos um modelo (para o padrão do harness). */
export function harnessOffersEffort(harness: string | undefined, model?: string): boolean {
  if (!harness || harness === 'auto') return false;
  if (harness === 'claude' || harness === 'codex' || harness === 'antigravity') return true;
  return modelSupportsEffort(harness, model);
}

/** Valor enviado ao CLI/API (Max vira xhigh onde o serviço usa esse nome). */
export function effortWireValue(harness: string | undefined, effort: ReasoningEffort): string {
  if (effort === 'max' && (harness === 'codex' || harness === 'llamacpp' || harness === 'lmstudio')) return 'xhigh';
  return effort;
}
