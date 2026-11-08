import type { Binding } from './types';

/*
 * Nomes dos executores na janela "Provedores": o MODELO de cada workflow/template (wan2gp-tts.json = OmniVoice)
 * e as reservas reais da etapa. Puro: a interface e os testes usam o mesmo código.
 */

/** Nome legível do modelo: o que está entre parênteses no rótulo; senão pelo model_type/arquivo. */
export function modelName(file: string, label?: string, modelType?: string): string {
  const inLabel = /\(([^)]+)\)\s*(?:—.*)?$/.exec(label ?? '')?.[1];
  if (inLabel) return inLabel.trim();
  const mt = `${modelType ?? ''} ${file}`.toLowerCase();
  const known: Array<[RegExp, string]> = [[/omnivoice/, 'OmniVoice'], [/chatterbox/, 'Chatterbox'], [/fish/, 'Fish Audio'], [/minimax_h3|minimax-h3|-h3\b/, 'MiniMax H3'], [/qwen3_tts/, 'Qwen3 TTS'],
    [/index_tts/, 'Index TTS'], [/kugel/, 'KugelAudio'], [/ltx/, 'LTX'], [/krea/, 'Krea'], [/z[-_]image/, 'Z-Image'], [/moss/, 'MOSS'], [/yue/, 'YuE'], [/ace_step|ace-step/, 'ACE-Step'],
    /* o template de voz padrão do app (sem o nome do modelo no arquivo) é a OmniVoice */
    [/(?:^|\s)wan2gp-tts\.json$/, 'OmniVoice']];
  return known.find(([re]) => re.test(mt))?.[1] ?? '';
}

/** Chave de identidade de um executor (o mesmo harness/workflow/template/provedor = o mesmo cartão). */
export const execKey = (b: Binding) => b.type === 'harness' ? `h:${b.harness}` : b.type === 'comfyui' ? `c:${b.workflow}` : b.type === 'wan2gp' ? `w:${b.template}` : b.type === 'api' ? `a:${b.provider}`
  : b.type === 'builtin' ? `b:${b.tool}` : b.type === 'flow' ? `f:${b.account ?? ''}` : b.type;

/**
 * Reservas que a etapa REALMENTE terá: a cadeia efetiva (escolhas na frente + executores da rota atrás, sem
 * repetir) menos o principal; sem cadeia efetiva (sem rota), as escolhas da janela.
 */
export function reserveChain(effective: Binding[] | undefined, chosen: Binding[] | undefined): Binding[] {
  const list = effective?.length ? effective : chosen ?? [];
  const seen = new Set<string>();
  return list.filter((b) => { const k = execKey(b); if (seen.has(k)) return false; seen.add(k); return true; }).slice(1);
}
