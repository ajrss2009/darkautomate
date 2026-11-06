/* Vozes que cada modelo de TTS aceita: o nome da voz depende do provedor E do modelo
   (ex.: "ballad"/"verse" só existem no gpt-4o-mini-tts; o tts-1 não as reconhece). */

const OPENAI_TTS1 = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
export const OPENAI_TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

/** Modelo de voz? (pela categoria declarada ou pelo nome) */
export function isVoiceModel(model: string, categories?: Record<string, string>): boolean {
  if (categories?.[model]) return categories[model] === 'voice';
  return /tts|speech|voice|audio-?gen|s1|s2|drama/i.test(model);
}

/**
 * Vozes oferecidas para `kind`/`model`. A lista configurada no provedor (Configurações → APIs)
 * vale sempre; para a OpenAI, sem lista, usa as vozes do modelo.
 */
export function voicesForModel(kind: string, model: string | undefined, configured: string[] = []): string[] {
  if (kind === 'openai') {
    const byModel = /^tts-1/i.test(model ?? '') ? OPENAI_TTS1 : OPENAI_TTS_VOICES;
    return configured.length ? [...new Set([...configured.filter((v) => byModel.includes(v) || !OPENAI_TTS_VOICES.includes(v)), ...byModel])] : byModel;
  }
  return configured;
}

/** A voz é válida para o provedor? (lista configurada, ou vozes conhecidas do modelo) */
export function voiceAccepted(kind: string, model: string | undefined, configured: string[] | undefined, voice: string): boolean {
  if (!configured?.length) return true;
  return configured.includes(voice) || voicesForModel(kind, model, configured).includes(voice);
}
