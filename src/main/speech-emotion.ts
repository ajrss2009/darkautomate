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
  /* só o rótulo da emoção em inglês: o "delivery" livre (em português) o H3 chegou a FALAR junto com a fala */
  const how = deliveryEnglish({ emotion: emotionKey(o.emotion) ?? undefined }, 'natural');
  const who = o.subjectIndex ? `<Subject ${o.subjectIndex}> (S1)` : `${o.speaker ? `${o.speaker}, ` : 'The narrator, '}${o.voice ? `with a ${o.voice} voice ` : ''}(S1)`.replace(/,\s*\(/, ' (');
  if (o.onScreen === false || !o.speaker) return `${who} says in an off-screen voiceover, ${how}: ${said} while every on-screen character's lips remain completely closed.`;
  /* fala curta num clipe de 5 s: sem o "depois fica em silêncio" o H3 preenchia o resto com fala inventada */
  return `${who} speaks in a ${how} tone, mouth movements naturally synced, and says: ${said} This is the only line; before and after it there is no speech at all, only silence and ambient sound.`;
}

/** Definição da voz clonada (Ref2VA): <Audio 1> é o timbre de quem fala. */
export const h3AudioRef = (subjectIndex?: number, speaker?: string) =>
  `<Audio 1> is the voice-timbre reference for ${subjectIndex ? `<Subject ${subjectIndex}>` : speaker ?? 'the speaker'} (S1).`;

/**
 * Põe a fala num prompt estruturado do H3 (subject_definitions / summary / detailed_description / overall_soundscape):
 * tira o "No speech.", acrescenta a fala ao fim do detailed_description e, com voz clonada, a definição do <Audio 1>.
 * Prompt livre (sem seções) recebe a fala no fim.
 */
export const H3_ONLY_D = 'The ONLY spoken words in this video are the ones inside <d>...</d>; every other text in this prompt (including any non-English description) is silent visual direction and must never be spoken.';

export function addH3Speech(prompt: string, line: string, audioRef?: string): string {
  let p = prompt.replace(/\s*No speech\.?/gi, '').replace(/(overall_soundscape:\s*\n\s*\n)\s*(\S)/i, `$1${H3_ONLY_D} $2`);
  if (!/overall_soundscape:/i.test(p)) line = `${line} ${H3_ONLY_D}`;
  if (audioRef) p = /subject_definitions:\s*\n/i.test(p) ? p.replace(/(subject_definitions:\s*\n\s*\n)/i, `$1${audioRef}\n`) : `${audioRef}\n${p}`;
  const m = /(detailed_description:\s*\n\s*\n)([\s\S]*?)(\n\s*\n\s*overall_soundscape:)/i.exec(p);
  if (m) return p.slice(0, m.index) + m[1] + m[2]!.trim() + ' ' + line + m[3] + p.slice(m.index + m[0].length);
  return `${p.trim()} ${line}`;
}

/** Modo da fala do H3: dublagem (padrão) ou clonagem. */
export type H3SpeechMode = 'dub' | 'clone' | 'internal';
/** dub = TTS + lábios (padrão); clone = voz gerada pelo H3 a partir da voz de referência; internal = voz gerada pelo H3 sem referência (áudio interno). */
export const h3Mode = (p: Pick<Project, 'h3SpeechMode'>): H3SpeechMode => p.h3SpeechMode === 'clone' || p.h3SpeechMode === 'internal' ? p.h3SpeechMode : 'dub';
/** O MiniMax H3 (Wan2GP) recusa referência de áudio com menos de 2 s. */
export const H3_MIN_REF_SEC = 2;
/** Quanto silêncio somar no fim para a referência chegar ao mínimo (com folga). Função pura. */
export const refPadSec = (durationSec: number, min = H3_MIN_REF_SEC) => (durationSec > 0 && durationSec < min + 0.05 ? Math.round((min + 0.2 - durationSec) * 100) / 100 : 0);

/**
 * Dublagem: o áudio da fala (TTS com a voz clonada) entra como <Audio 1> COPIADO 1:1 na trilha final do vídeo
 * (relação "fully_copy" do guia do H3) e a boca segue o áudio — o H3 não gera voz própria.
 */
export const h3DubRef = (subjectIndex?: number, speaker?: string) =>
  `<Audio 1> is the complete spoken line of ${subjectIndex ? `<Subject ${subjectIndex}>` : speaker ?? 'the narrator'} (S1); <Audio 1>: fully_copy - it is reused 1:1 as the target video's complete final audio track, and the lips and jaw move in exact sync with it. No other voice is generated.`;

/** Duração estimada da fala (s) pelo número de palavras (≈ 2,6 palavras/s em português) + respiro; mínimo 2,2 s, máximo 15 s (limite do H3). */
export function estimateSpeechSec(text: string, wordsPerSec = 2.6): number {
  const n = text.split(/\s+/).filter(Boolean).length;
  const pauses = (text.match(/[.!?…,;]/g) ?? []).length * 0.15;
  return Math.round(Math.max(2.2, Math.min(15, n / Math.max(1, wordsPerSec) + pauses + 0.9)) * 10) / 10;
}

/** Executor H3 de vídeo COM VOZ CLONADA (workflow/template "…voice"/"…voz"): a fala sempre vai no vídeo. */
export function isH3Voice(b?: Binding): boolean {
  if (!isH3Video(b)) return false;
  const name = b!.type === 'comfyui' ? String((b as { workflow?: string }).workflow ?? '') : String((b as { template?: string }).template ?? '');
  return /(^|[-_])(voice|voz)([-_.]|$)/i.test(name);
}

/** Esta cena terá a fala gerada no vídeo do H3? (opção do projeto ligada ou executor com voz; cena com fala) */
export const h3SpeechScene = (p: Pick<Project, 'h3Speech'>, s?: Pick<Scene, 'narration'>, b?: Binding) => (!!p.h3Speech || isH3Voice(b)) && !!s?.narration?.trim();

/**
 * Onde está a fala ESPERADA na transcrição do clipe (Whisper): o H3 às vezes inventa fala antes/depois de uma fala curta.
 * Procura a janela de palavras que mais casa com o texto (palavras normalizadas) e devolve início/fim em segundos.
 * Sem casamento suficiente (< 60% das palavras), devolve undefined (não corta). Função pura.
 */
export function speechWindow(words: Array<{ w: string; start: number; end: number }>, expected: string): { start: number; end: number; matched: number } | undefined {
  const norm = (s: string) => fold(s).replace(/[^a-z0-9]+/g, '');
  const exp = expected.split(/\s+/).map(norm).filter(Boolean);
  const got = words.map((x) => ({ ...x, n: norm(x.w) })).filter((x) => x.n);
  if (!exp.length || !got.length) return undefined;
  const near = (a: string, b: string) => a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))));
  let best: { start: number; end: number; matched: number } | undefined;
  for (let i = 0; i < got.length; i++) {
    let j = i, k = 0, hit = 0, first = -1, last = -1;
    /* percorre o texto esperado em ordem, tolerando 1 palavra errada/extra do Whisper */
    while (k < exp.length && j < got.length && j - i <= exp.length + 2) {
      if (near(got[j]!.n, exp[k]!)) { hit++; if (first < 0) first = j; last = j; j++; k++; }
      else if (k + 1 < exp.length && near(got[j]!.n, exp[k + 1]!)) { k++; }
      else j++;
    }
    if (last < 0) continue;
    /* empate: a janela mais curta (começa na primeira palavra que casou) */
    if (!best || hit > best.matched || (hit === best.matched && got[last]!.end - got[first]!.start < best.end - best.start))
      best = { start: got[first]!.start, end: got[last]!.end, matched: hit };
  }
  return best && best.matched / exp.length >= 0.6 ? best : undefined;
}

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
