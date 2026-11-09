import type { Binding, CastMember, Project, Scene } from '../shared/types';

/*
 * EMOÇÃO POR FALA + FALA NATIVA DO MINIMAX H3.
 *  - O plano de cenas marca "emotion" (rótulo) e "delivery" (como dizer) em cada fala; a voz segue:
 *    API (gpt-4o-*-tts / Gemini / Fish drama-3) recebe a instrução, o Wan2GP recebe {{delivery}} no template
 *    (MiniMax H3 TTS: "[Portuguese, sad and trembling, slow] fala") e o voice design ganha a emoção.
 *  - Com "fala do MiniMax H3" ligada, o vídeo do H3 gera a voz junto com a imagem (lábios sincronizados), no formato
 *    oficial de prompt do H3: quem fala ganha um ID estável "(S1)", a identidade/tom/emoção vão FORA do bloco e a fala
 *    vai DENTRO de <d>[Idioma] ...</d>, sem tradução; narrador fora de cena = "says in an off-screen voiceover" + lábios
 *    fechados; voz clonada = "<Audio 1> is the voice-timbre reference for <Subject N> (S1)" (Ref2VA). Depois o app
 *    extrai o áudio do vídeo como a narração da cena (a montagem usa a voz do próprio vídeo).
 * Funções puras: testáveis.
 */

export const EMOTIONS: Record<string, { en: string; pt: string }> = {
  neutro: { en: 'calm and neutral', pt: 'calma e neutra' },
  alegre: { en: 'happy and bright, smiling voice', pt: 'alegre, sorrindo na voz' },
  triste: { en: 'sad, low and slightly trembling', pt: 'triste, baixa e um pouco trêmula' },
  raiva: { en: 'angry, tense and forceful', pt: 'com raiva, tensa e forte' },
  medo: { en: 'scared, breathy and hesitant', pt: 'com medo, ofegante e hesitante' },
  surpresa: { en: 'surprised, rising pitch', pt: 'surpresa, tom subindo' },
  carinho: { en: 'tender, warm and soft', pt: 'carinhosa, quente e suave' },
  tenso: { en: 'tense, controlled and low', pt: 'tensa, contida e baixa' },
  sussurro: { en: 'whispering, very soft and close', pt: 'sussurrando, bem baixo e próximo' },
  empolgado: { en: 'excited, fast and energetic', pt: 'empolgada, rápida e enérgica' },
  ironico: { en: 'sarcastic, dry and ironic', pt: 'irônica e seca' },
  cansado: { en: 'tired, slow and heavy', pt: 'cansada, lenta e pesada' },
  choro: { en: 'crying, broken voice with sobs', pt: 'chorando, voz embargada' },
  decidido: { en: 'determined, firm and steady', pt: 'decidida, firme e estável' },
};
const ALIAS: Record<string, string> = {
  neutral: 'neutro', calm: 'neutro', calmo: 'neutro', happy: 'alegre', feliz: 'alegre', joy: 'alegre', sad: 'triste', tristeza: 'triste',
  angry: 'raiva', bravo: 'raiva', irritado: 'raiva', fear: 'medo', scared: 'medo', assustado: 'medo', surprised: 'surpresa', surprise: 'surpresa',
  tender: 'carinho', carinhoso: 'carinho', amor: 'carinho', tense: 'tenso', tensao: 'tenso', whisper: 'sussurro', sussurrando: 'sussurro',
  excited: 'empolgado', animado: 'empolgado', sarcastic: 'ironico', ironia: 'ironico', tired: 'cansado', crying: 'choro', chorando: 'choro',
  determined: 'decidido', firme: 'decidido',
};
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Rótulo canônico da emoção (ou undefined quando vazio/desconhecido e sem texto). */
export function emotionKey(e?: string): string | undefined {
  if (!e?.trim()) return undefined;
  const k = fold(e).replace(/[^a-z]+/g, ' ').trim().split(' ')[0] ?? '';
  return EMOTIONS[k] ? k : ALIAS[k] ? ALIAS[k] : undefined;
}

/** Normaliza a emoção vinda do plano (rótulo conhecido ou texto livre curto). */
export function normalizeEmotion(e: unknown): string | undefined {
  if (typeof e !== 'string' || !e.trim()) return undefined;
  return emotionKey(e) ?? e.trim().slice(0, 40);
}

/** Como dizer a fala em inglês (para o MiniMax H3 e o {{delivery}} do Wan2GP). */
export function deliveryEnglish(s: Pick<Scene, 'emotion' | 'delivery'>, fallback = 'natural and clear narration'): string {
  const k = emotionKey(s.emotion);
  const base = k ? EMOTIONS[k]!.en : s.emotion?.trim();
  return [base, s.delivery?.trim()].filter(Boolean).join(', ').slice(0, 160) || fallback;
}

/** Instrução de voz em português para TTS por API (tom, emoção, jeito de dizer). */
export function emotionInstruction(s?: Pick<Scene, 'emotion' | 'delivery'>): string {
  if (!s) return '';
  const k = emotionKey(s.emotion);
  const base = k ? EMOTIONS[k]!.pt : s.emotion?.trim();
  if (!base && !s.delivery?.trim()) return '';
  return `Emoção desta fala: ${[base, s.delivery?.trim()].filter(Boolean).join('; ')}. Interprete com essa emoção, sem exagero.`;
}

/* ───────── MiniMax H3: fala no próprio vídeo ───────── */

/** O executor é um MiniMax H3 de VÍDEO (ComfyUI ou Wan2GP)? */
export function isH3Video(b?: Binding): boolean {
  if (!b) return false;
  const name = b.type === 'comfyui' ? String((b as { workflow?: string }).workflow ?? '') : b.type === 'wan2gp' ? String((b as { template?: string }).template ?? '') : '';
  return /minimax-h3|(^|[-_])h3[-_.]/i.test(name) && !/tts|image/i.test(name);
}

const LANG: Record<string, string> = { pt: 'Portuguese', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ru: 'Russian', hi: 'Hindi', ar: 'Arabic', id: 'Indonesian', tr: 'Turkish' };
export const h3Language = (code?: string) => LANG[(code ?? 'pt').slice(0, 2).toLowerCase()] ?? 'Portuguese';

/** Texto da fala no formato do H3: só pontuação básica, termina com . ? ou ! */
export function h3SpokenText(t: string): string {
  let s = t.replace(/[~*_#>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s && !/[.?!]$/.test(s)) s += '.';
  return s;
}

/**
 * Bloco da fala para o "detailed_description" do H3.
 * `subjectIndex`: o personagem que fala é o <Subject N> das referências (quando há); `voice`: timbre/idade descritos.
 */
export function h3SpeechLine(o: { text: string; language?: string; speaker?: string; voice?: string; subjectIndex?: number; emotion?: string; delivery?: string; onScreen?: boolean }): string {
  const said = `<d>[${h3Language(o.language)}] ${h3SpokenText(o.text)}</d>`;
  const how = deliveryEnglish({ emotion: o.emotion, delivery: o.delivery }, 'natural');
  const who = o.subjectIndex ? `<Subject ${o.subjectIndex}> (S1)` : `${o.speaker ? `${o.speaker}, ` : 'The narrator, '}${o.voice ? `with a ${o.voice} voice ` : ''}(S1)`.replace(/,\s*\(/, ' (');
  if (o.onScreen === false || !o.speaker) return `${who} says in an off-screen voiceover, ${how}: ${said} while every on-screen character's lips remain completely closed.`;
  return `${who} speaks in a ${how} tone, mouth movements naturally synced, and says: ${said}`;
}

/** Definição da voz clonada (Ref2VA): <Audio 1> é o timbre de quem fala. */
export const h3AudioRef = (subjectIndex?: number, speaker?: string) =>
  `<Audio 1> is the voice-timbre reference for ${subjectIndex ? `<Subject ${subjectIndex}>` : speaker ?? 'the speaker'} (S1).`;

/**
 * Põe a fala num prompt estruturado do H3 (subject_definitions / summary / detailed_description / overall_soundscape):
 * tira o "No speech.", acrescenta a fala ao fim do detailed_description e, com voz clonada, a definição do <Audio 1>.
 * Prompt livre (sem seções) recebe a fala no fim.
 */
export function addH3Speech(prompt: string, line: string, audioRef?: string): string {
  let p = prompt.replace(/\s*No speech\.?/gi, '').replace(/(overall_soundscape:\s*\n\s*\n)\s*(\S)/i, '$1$2');
  if (audioRef) p = /subject_definitions:\s*\n/i.test(p) ? p.replace(/(subject_definitions:\s*\n\s*\n)/i, `$1${audioRef}\n`) : `${audioRef}\n${p}`;
  const m = /(detailed_description:\s*\n\s*\n)([\s\S]*?)(\n\s*\n\s*overall_soundscape:)/i.exec(p);
  if (m) return p.slice(0, m.index) + m[1] + m[2]!.trim() + ' ' + line + m[3] + p.slice(m.index + m[0].length);
  return `${p.trim()} ${line}`;
}

/** Executor H3 de vídeo COM VOZ CLONADA (workflow/template "…voice"/"…voz"): a fala sempre vai no vídeo. */
export function isH3Voice(b?: Binding): boolean {
  if (!isH3Video(b)) return false;
  const name = b!.type === 'comfyui' ? String((b as { workflow?: string }).workflow ?? '') : String((b as { template?: string }).template ?? '');
  return /(^|[-_])(voice|voz)([-_.]|$)/i.test(name);
}

/** Esta cena terá a fala gerada no vídeo do H3? (opção do projeto ligada ou executor com voz; cena com fala) */
export const h3SpeechScene = (p: Pick<Project, 'h3Speech'>, s?: Pick<Scene, 'narration'>, b?: Binding) => (!!p.h3Speech || isH3Voice(b)) && !!s?.narration?.trim();

type Graph = Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
/** Tira do workflow o LoadAudio da voz ({{ref_audio}}) e as ligações para ele (cena sem voz clonada). Devolve se tirou. */
export function dropRefAudio(graph: Graph): boolean {
  const ids = Object.keys(graph).filter((k) => graph[k]?.class_type === 'LoadAudio' && graph[k]?.inputs?.['audio'] === '{{ref_audio}}');
  for (const id of ids) delete graph[id];
  for (const n of Object.values(graph)) for (const [k, v] of Object.entries(n?.inputs ?? {})) if (Array.isArray(v) && ids.includes(String(v[0]))) delete n.inputs![k];
  return ids.length > 0;
}

/** Linha da fala da cena (com a voz do elenco descrita) — usada pelos executores do H3. */
export function sceneSpeech(p: Pick<Project, 'language' | 'cast'>, s: Pick<Scene, 'narration' | 'speaker' | 'emotion' | 'delivery'>, subjectIndex?: number): string {
  const m: CastMember | undefined = s.speaker ? (p.cast ?? []).find((x) => x.speaker.trim().toLowerCase() === s.speaker!.trim().toLowerCase()) : undefined;
  const voice = m?.description?.split(/voz:\s*/i)[1]?.split(/[—;]/)[0]?.trim();
  return h3SpeechLine({ text: s.narration, language: p.language, speaker: s.speaker, voice, subjectIndex, emotion: s.emotion, delivery: s.delivery, onScreen: !!s.speaker });
}
