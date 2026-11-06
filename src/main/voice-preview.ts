import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Binding, Project, RouteStep, Settings } from '../shared/types';
import type { Executor } from './engine';

/** Frase de amostra por idioma: a prévia fala no idioma do projeto. */
export const VOICE_SAMPLES: Record<string, string> = {
  'pt-BR': 'Olá! Esta é a voz que vai narrar o seu vídeo. Antes da agricultura, nossos ancestrais tinham mandíbulas largas e dentes alinhados.',
  'pt-PT': 'Olá! Esta é a voz que vai narrar o seu vídeo. Antes da agricultura, os nossos antepassados tinham maxilares largos e dentes alinhados.',
  'en-US': 'Hi! This is the voice that will narrate your video. Before farming, our ancestors had wide jaws and perfectly aligned teeth.',
  'en-GB': 'Hello! This is the voice that will narrate your video. Before farming, our ancestors had broad jaws and neatly aligned teeth.',
  'es-ES': '¡Hola! Esta es la voz que narrará tu vídeo. Antes de la agricultura, nuestros antepasados tenían mandíbulas anchas y dientes alineados.',
  'es-MX': '¡Hola! Esta es la voz que va a narrar tu video. Antes de la agricultura, nuestros antepasados tenían mandíbulas anchas y dientes alineados.',
  'fr-FR': 'Bonjour ! Voici la voix qui racontera votre vidéo. Avant l’agriculture, nos ancêtres avaient des mâchoires larges et des dents bien alignées.',
  'de-DE': 'Hallo! Das ist die Stimme, die dein Video erzählt. Vor der Landwirtschaft hatten unsere Vorfahren breite Kiefer und gerade Zähne.',
  'it-IT': 'Ciao! Questa è la voce che racconterà il tuo video. Prima dell’agricoltura, i nostri antenati avevano mascelle larghe e denti allineati.',
  'ja-JP': 'こんにちは！これはあなたの動画をナレーションする声です。農業が始まる前、私たちの祖先は広いあごと整った歯を持っていました。',
  'ko-KR': '안녕하세요! 이 목소리가 여러분의 영상을 내레이션합니다. 농업 이전에 우리 조상들은 넓은 턱과 고른 치아를 가졌습니다.',
  'zh-CN': '你好！这是为你的视频配音的声音。在农业出现之前，我们的祖先拥有宽大的下颌和整齐的牙齿。',
};

export interface VoicePreviewInput { binding: Binding; language: string; text?: string }

/**
 * Gera uma amostra curta da voz com o MESMO executor da etapa de narração (API OpenAI/Gemini,
 * ComfyUI/OmniVoice com voz de referência, Wan2GP), no idioma pedido. Cacheia por voz+idioma+texto.
 */
export async function voicePreview(s: Settings, executors: Partial<Record<Binding['type'], Executor>>, i: VoicePreviewInput, log: (l: string) => void = () => {}): Promise<string> {
  const text = (i.text?.trim() || VOICE_SAMPLES[i.language] || VOICE_SAMPLES['en-US']!).slice(0, 400);
  const key = crypto.createHash('md5').update(JSON.stringify([i.binding, i.language, text])).digest('hex').slice(0, 16);
  const dir = path.join(s.workspace, 'library', 'voice-preview', key);
  const done = fs.existsSync(path.join(dir, 'audio')) ? fs.readdirSync(path.join(dir, 'audio')).find((f) => /^narration\.(mp3|wav)$/i.test(f)) : undefined;
  if (done) return path.join(dir, 'audio', done);
  const exec = executors[i.binding.type];
  if (!exec || !['api', 'comfyui', 'wan2gp'].includes(i.binding.type)) throw new Error('a prévia funciona com API, ComfyUI ou Wan2GP');
  fs.mkdirSync(dir, { recursive: true });
  const project = { id: 'voice-preview', name: 'prévia', idea: text, videoType: 'custom', aspect: '16:9', targetDurationSec: 10, language: i.language, quality: 'draft', memories: [], scenes: [], createdAt: new Date().toISOString() } as unknown as Project;
  const scene = { id: 'p01', index: 1, title: 'prévia', narration: text, visualIntent: '', kind: 'image', status: {}, artifacts: {} } as Project['scenes'][number];
  project.scenes = [scene];
  const step: RouteStep = { id: 'narration', kind: 'narration', label: 'prévia', scope: 'scene', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 300, bindings: [i.binding] };
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 300_000);
  try {
    const r = await exec({ project, projectDir: dir, step, binding: i.binding, scene, sceneDir: dir, outDir: dir, settings: s, signal: ac.signal, log });
    const f = r.files.find((x) => /\.(mp3|wav|flac|ogg|m4a)$/i.test(x) && fs.existsSync(x));
    if (!f) throw new Error('o executor não devolveu áudio');
    return f;
  } finally { clearTimeout(timer); }
}
