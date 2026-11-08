import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChannelIdentity, FormatDna, PaletteSpec, Skill, SubtitleKind, SubtitleStyle } from '../shared/types';
import { normalizePalette, paletteRoles } from './channel-setup';
import * as ff from './ffmpeg';
import { sceneCuts } from './youtube';
import { titleStructure, type RefTitle, type TitleStructure } from './youtube-rules';

/*
 * DNA do canal: o que se MEDE (sem IA) + o que a IA com visão descreve, num formato estável.
 *  - escolha dos vídeos: os que funcionaram (views ÷ mediana) + os mais recentes (estilo atual), mínimo 3;
 *  - métricas por vídeo: cortes/min, duração média do plano, palavras por minuto, palavras por frase,
 *    perguntas, 2ª pessoa e o gancho real (primeiras palavras);
 *  - folha de contato (12 quadros num JPG) para a IA ver ritmo, câmera e direção de arte de uma vez;
 *  - o DNA vira texto garantido nas etapas da skill (não depende da IA ter escrito bem o skill.md).
 */

export interface ListedVideo { id?: string; title?: string; duration?: number | null; view_count?: number | null }
export interface PickedVideo { id: string; title: string; views?: number; durationSec?: number; reason: string; ratio?: number }

const median = (a: number[]) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m]! : (b[m - 1]! + b[m]!) / 2; };

/**
 * Vídeos para analisar a fundo: ~60% os que mais performaram em relação à mediana do canal (o que funciona)
 * e o resto os mais recentes (o estilo atual), no formato dominante (Shorts ou longos). Mínimo 3, máximo 8.
 */
export function pickVideos(entries: ListedVideo[], n: number): PickedVideo[] {
  const want = Math.max(3, Math.min(8, Math.round(n) || 4));
  const valid = entries.filter((e) => e.id && e.title);
  const shorts = valid.filter((e) => (e.duration ?? 0) > 0 && (e.duration ?? 0) <= 60).length;
  const shortsChannel = shorts > valid.length / 2;
  const pool = valid.filter((e) => !e.duration || (shortsChannel ? e.duration <= 60 : e.duration > 60));
  /* o outro formato só entra se o dominante não tiver nem os 3 mínimos (Shorts distorcem o DNA de um canal de vídeos longos) */
  const list = pool.length >= 3 ? pool : valid;
  const med = median(list.map((e) => e.view_count ?? 0).filter((v) => v > 0)) || 1;
  const out: PickedVideo[] = [];
  const add = (e: ListedVideo, reason: string) => {
    if (out.some((x) => x.id === e.id)) return;
    const ratio = e.view_count ? Math.round((e.view_count / med) * 10) / 10 : undefined;
    out.push({ id: e.id!, title: e.title!, views: e.view_count ?? undefined, durationSec: e.duration ?? undefined, reason, ratio });
  };
  const top = [...list].filter((e) => (e.view_count ?? 0) > 0).sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0));
  for (const e of top.slice(0, Math.ceil(want * 0.6))) add(e, `performou ${e.view_count && med ? (e.view_count / med).toFixed(1) : '?'}× a mediana do canal`);
  for (const e of list) { if (out.length >= want) break; add(e, 'recente (estilo atual do canal)'); }
  for (const e of top) { if (out.length >= want) break; add(e, 'complemento'); }
  return out.slice(0, want);
}

/** Métricas medidas de um vídeo (sem IA). */
export interface VideoMetrics {
  durationSec: number; shots: number; avgShotSec: number; cutsPerMin: number;
  words?: number; wpm?: number; wordsPerSentence?: number; questions?: number; secondPerson?: number;
  /** gancho real: o que é falado nos primeiros 15 s (palavras ≈ WPM × 15/60) */
  hook?: string;
  /** densidade de informação: segundos por fato novo (frase com número, nome próprio ou data) */
  secPerFact?: number;
  /** fração dos takes com menos de 1,5 s (jump cuts / cortes secos rápidos) */
  jumpCutShare?: number;
  /** desvio-padrão da duração dos takes (s): ritmo constante (baixo) ou variado (alto) */
  shotStdSec?: number;
  /** perfil de áudio medido (loudness, pausas, grave/trilha) */
  audio?: AudioProfile;
}

/**
 * Perfil de áudio medido com ffmpeg (sem IA):
 * loudness integrado (LUFS), pico, proporção de silêncio (pausas da fala),
 * energia de grave em relação ao total (indício de trilha/trilha em loop).
 */
export interface AudioProfile {
  lufs?: number; peakDb?: number; meanDb?: number;
  /** fração do vídeo em silêncio (< -32 dB por ≥ 0,35 s) */
  silenceRatio?: number;
  pauses?: number;
  /** duração média das pausas (s) */
  avgPauseSec?: number;
  /** energia do grave (≤ 220 Hz) / energia total, 0–1 (trilha costuma subir isto) */
  bassRatio?: number;
  /** heurística: presença provável de trilha/trilha de fundo */
  musicLikely?: boolean;
}

const num = (re: RegExp, text: string): number | undefined => {
  const m = re.exec(text);
  return m ? Number(m[1]) : undefined;
};

/**
 * Lê a saída do ffmpeg (volumedetect normal + grave, silencedetect e ebur128) e devolve o perfil.
 * Função pura (testável): recebe os textos crus.
 */
export function parseAudioStats(raw: { full?: string; bass?: string; silence?: string; loudness?: string }, durationSec: number): AudioProfile {
  const full = raw.full ?? '', bass = raw.bass ?? '', sil = raw.silence ?? '', loud = raw.loudness ?? '';
  const meanDb = num(/mean_volume:\s*(-?[\d.]+)\s*dB/, full);
  const peakDb = num(/max_volume:\s*(-?[\d.]+)\s*dB/, full);
  const bassDb = num(/mean_volume:\s*(-?[\d.]+)\s*dB/, bass);
  const lufs = num(/\bI:\s*(-?[\d.]+)\s*LUFS/, loud);
  const silences = [...sil.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
  const silenceTotal = silences.reduce((a, b) => a + b, 0);
  const dur = Math.max(1, durationSec);
  const p: AudioProfile = {};
  if (meanDb !== undefined) p.meanDb = Math.round(meanDb * 10) / 10;
  if (peakDb !== undefined) p.peakDb = Math.round(peakDb * 10) / 10;
  if (lufs !== undefined) p.lufs = Math.round(lufs * 10) / 10;
  if (silences.length) {
    p.pauses = silences.length;
    p.silenceRatio = Math.round(Math.min(1, silenceTotal / dur) * 1000) / 1000;
    p.avgPauseSec = Math.round((silenceTotal / silences.length) * 10) / 10;
  }
  if (bassDb !== undefined && meanDb !== undefined) {
    /* diferença em dB → razão de amplitude (grave ÷ total) */
    p.bassRatio = Math.round(Math.min(1, Math.pow(10, (bassDb - meanDb) / 20)) * 1000) / 1000;
  }
  /* voz humana tem pouca energia abaixo de 220 Hz; trilha/trilha de fundo sobe o grave.
     Sem pausas longas e com grave presente, é bem provável que haja música de fundo. */
  if (p.bassRatio !== undefined) p.musicLikely = p.bassRatio >= 0.2 && (p.silenceRatio ?? 0) < 0.45;
  return p;
}

/** Roda o ffmpeg (3 passadas rápidas, sem gerar arquivo) e devolve o perfil de áudio. */
export async function analyzeAudio(ffmpegBin: string, file: string, durationSec: number, signal?: AbortSignal): Promise<AudioProfile> {
  const read = async (filter: string): Promise<string> => {
    try { return (await ff.run(ffmpegBin, ['-hide_banner', '-i', file, '-af', filter, '-f', 'null', '-'], signal)).stderr; } catch { return ''; }
  };
  const [full, bass, silence, loudness] = await Promise.all([
    read('volumedetect'),
    read('lowpass=f=220,volumedetect'),
    read('silencedetect=noise=-32dB:d=0.35'),
    read('ebur128=peak=true'),
  ]);
  return parseAudioStats({ full, bass, silence, loudness }, durationSec);
}

/** Frase curta com o perfil de áudio (para o prompt da IA e para a skill). */
export function audioSummary(a: AudioProfile | undefined): string {
  if (!a) return '';
  const parts: string[] = [];
  if (a.lufs !== undefined) parts.push(`${a.lufs} LUFS`);
  if (a.peakDb !== undefined) parts.push(`pico ${a.peakDb} dB`);
  if (a.meanDb !== undefined) parts.push(`média ${a.meanDb} dB`);
  if (a.silenceRatio !== undefined) parts.push(`${Math.round(a.silenceRatio * 100)}% de silêncio${a.pauses ? ` (${a.pauses} pausas de ≈${a.avgPauseSec}s)` : ''}`);
  if (a.bassRatio !== undefined) parts.push(`grave ${Math.round(a.bassRatio * 100)}% da energia`);
  if (a.musicLikely) parts.push('trilha de fundo provável');
  return parts.join(' · ');
}

/** Métricas da fala a partir da transcrição (função pura). */
/** Frase "com fato novo": número, data, porcentagem ou nome próprio no meio da frase. */
const isFact = (sentence: string): boolean => {
  const s = sentence.trim();
  if (/\d/.test(s)) return true;
  const words = s.split(/\s+/).slice(1);
  return words.some((w) => /^\p{Lu}\p{Ll}{2,}/u.test(w.replace(/^[^\p{L}]+/u, '')));
};

export function speechMetrics(transcript: string | undefined, durationSec: number): Pick<VideoMetrics, 'words' | 'wpm' | 'wordsPerSentence' | 'questions' | 'secondPerson' | 'hook' | 'secPerFact'> {
  const t = (transcript ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return {};
  const words = t.split(' ').filter(Boolean);
  const sentences = t.split(/(?<=[.!?…])\s+/).filter((x) => x.trim().length > 1);
  const second = words.filter((w) => /^(você|vocês|voce|te|seu|sua|seus|suas|you|your|yours|tú|tu|usted|ustedes)$/i.test(w.replace(/[^\p{L}]/gu, ''))).length;
  const wpm = durationSec > 0 ? Math.round(words.length / (durationSec / 60)) : undefined;
  /* gancho = os primeiros 15 s de fala (pelo ritmo medido; sem duração, 40 palavras) */
  const hookWords = wpm ? Math.max(12, Math.round((wpm * 15) / 60)) : 40;
  const facts = sentences.filter(isFact).length;
  return {
    words: words.length,
    wpm,
    wordsPerSentence: Math.round((words.length / Math.max(1, sentences.length)) * 10) / 10,
    questions: (t.match(/[?¿]/g) ?? []).length,
    secondPerson: Math.round((second / Math.max(1, words.length)) * 1000) / 10,
    hook: words.slice(0, hookWords).join(' '),
    secPerFact: durationSec > 0 && facts ? Math.round((durationSec / facts) * 10) / 10 : undefined,
  };
}

/** Ritmo de edição (cortes) a partir dos instantes de corte (função pura). */
export function cutMetrics(cuts: number[], durationSec: number): Pick<VideoMetrics, 'shots' | 'avgShotSec' | 'cutsPerMin' | 'jumpCutShare' | 'shotStdSec'> {
  const inside = [...cuts].filter((c) => c > 0.2 && c < durationSec - 0.2).sort((a, b) => a - b);
  const shots = inside.length + 1;
  const bounds = [0, ...inside, durationSec];
  const lens = bounds.slice(1).map((b, i) => b - bounds[i]!).filter((x) => x > 0);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const std = lens.length > 1 ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length) : 0;
  return {
    shots, avgShotSec: Math.round((durationSec / shots) * 10) / 10, cutsPerMin: durationSec > 0 ? Math.round((inside.length / (durationSec / 60)) * 10) / 10 : 0,
    jumpCutShare: lens.length > 1 ? Math.round((lens.filter((x) => x < 1.5).length / lens.length) * 100) / 100 : 0,
    shotStdSec: Math.round(std * 10) / 10,
  };
}

const STOP_START = new Set('a o as os e é de do da que um uma em no na se mas eu ele ela isso the a an and of to in is it this that'.split(' '));

/**
 * Bordões e conectivos de transição: aberturas de frase (2–3 palavras) que se repetem nos vídeos
 * ("só que", "e aqui vem", "mas olha só"). Função pura; usada como FUNÇÃO de transição, nunca copiada literalmente.
 */
export function catchphrases(transcripts: string[], max = 8): string[] {
  const count = new Map<string, { n: number; videos: Set<number> }>();
  transcripts.forEach((t, vi) => {
    for (const s of (t ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+|,\s+/)) {
      const w = s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
      for (const n of [3, 2]) {
        if (w.length < n + 1) continue;
        const g = w.slice(0, n);
        if (g.every((x) => STOP_START.has(x))) continue;
        const k = g.join(' ');
        const c = count.get(k) ?? { n: 0, videos: new Set<number>() };
        c.n++; c.videos.add(vi); count.set(k, c);
      }
    }
  });
  const multi = transcripts.length > 1;
  const rows = [...count.entries()].filter(([, c]) => c.n >= 3 && (!multi || c.videos.size >= 2)).sort((a, b) => b[1].n - a[1].n || b[0].split(' ').length - a[0].split(' ').length);
  const out: string[] = [];
  for (const [k] of rows) { if (out.some((x) => x.startsWith(k) || k.startsWith(x))) continue; out.push(k); if (out.length >= max) break; }
  return out;
}

/** Mede o vídeo baixado: cortes (scdet) + fala (transcrição) + áudio (loudness, pausas, trilha). */
export async function measureVideo(ffmpegBin: string, ffprobe: string, file: string, transcript: string | undefined, signal?: AbortSignal): Promise<VideoMetrics> {
  const durationSec = (await ff.duration(ffprobe, file)) || 0;
  let cuts: number[] = [];
  try { cuts = await sceneCuts(ffmpegBin, file, signal); } catch { /* sem cortes medidos */ }
  let audio: AudioProfile | undefined;
  try { audio = await analyzeAudio(ffmpegBin, file, durationSec, signal); } catch { /* sem perfil de áudio */ }
  return { durationSec: Math.round(durationSec), ...cutMetrics(cuts, durationSec), ...speechMetrics(transcript, durationSec), audio };
}

/** Folha de contato clássica: 12 quadros espalhados pelo vídeo num JPG 4×3 (compatibilidade). */
export async function contactSheet(ffmpegBin: string, file: string, durationSec: number, out: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const every = Math.max(0.5, durationSec / 12);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await ff.run(ffmpegBin, ['-y', '-i', file, '-vf', `fps=1/${every.toFixed(2)},scale=320:-2,tile=4x3:padding=4:color=black`, '-frames:v', '1', '-q:v', '4', out], signal);
    return fs.existsSync(out) ? out : undefined;
  } catch { return undefined; }
}

/**
 * Quadros a 1 POR SEGUNDO: extrai `fps=1` e agrupa em folhas de contato 4×3 (12 s por folha).
 * Cada folha mostra 12 segundos reais em ordem, então a IA consegue ler texto na tela,
 * tipografia, legendas, cortes, câmera e direção de arte segundo a segundo — não só 12 quadros soltos.
 *
 * @param maxSeconds teto de duração analisada (padrão 300 s = 25 folhas); Shorts usam o vídeo inteiro.
 * @returns caminhos ABSOLUTOS das folhas, em ordem cronológica (vazio se o ffmpeg falhar).
 */
export async function frameSheets(ffmpegBin: string, file: string, dir: string, maxSeconds = 300, signal?: AbortSignal): Promise<string[]> {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, 'sheet-%02d.jpg');
    await ff.run(ffmpegBin, ['-y', '-i', file, '-t', String(Math.max(1, Math.round(maxSeconds))),
      '-vf', 'fps=1,scale=480:-2,tile=4x3:padding=4:color=black', '-q:v', '4', abs], signal);
    return fs.readdirSync(dir).filter((f) => /^sheet-\d+\.jpg$/i.test(f)).sort().map((f) => path.join(dir, f));
  } catch { return []; }
}

/** Média das métricas dos vídeos analisados (para o relatório e para a skill). */
export function averageMetrics(list: VideoMetrics[]): Partial<VideoMetrics> {
  const avg = (k: keyof VideoMetrics) => { const v = list.map((m) => m[k]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : undefined; };
  return { durationSec: avg('durationSec'), avgShotSec: avg('avgShotSec'), cutsPerMin: avg('cutsPerMin'), wpm: avg('wpm'), wordsPerSentence: avg('wordsPerSentence'), secondPerson: avg('secondPerson'),
    secPerFact: avg('secPerFact'), jumpCutShare: avg('jumpCutShare'), shotStdSec: avg('shotStdSec') };
}

/* ───────── DNA descrito pela IA (formato estável) ───────── */

export interface LanguagePick { code: string; score: number; why?: string; audience?: string; competition?: string; cpm?: string }
export interface ChannelDna {
  visual?: { style?: string; palette?: string[]; lighting?: string; texture?: string; composition?: string; colorGrade?: string;
    /** paleta com papéis (fundo, texto, destaque) — contraste e modo calculados pelo app */
    paletteRoles?: PaletteSpec;
    /** estilo gráfico e de B-roll: recortes 2D, mockups de UI, vetores flat, 3D isométrico, stock, foto real… */
    graphicStyle?: string[];
    /** prompt BASE de estilo para IA de imagem/vídeo (só o estilo, sem assunto) */
    aiStylePrompt?: string };
  artDirection?: { world?: string; characters?: string; props?: string; typography?: string; graphics?: string; motifs?: string; dos?: string[]; donts?: string[] };
  camera?: { shots?: string; movement?: string; angles?: string; lenses?: string; transitions?: string;
    /** movimentos usados: estatica, handheld, push-in, pull-out, pan, snap-zoom, drone, orbita */
    moves?: string[];
    /** snap zoom acompanhado de SFX (whoosh/impact) */
    snapZoomSfx?: boolean;
    /** lente simulada: grande-angular | normal | teleobjetiva */
    lens?: string;
    /** profundidade de campo: rasa (fundo desfocado) | profunda */
    depthOfField?: string;
    /** como e quando acontecem os jump cuts */
    jumpCuts?: string };
  editing?: { pace?: string; patternInterrupts?: string; broll?: string; sfx?: string };
  script?: { hook?: string; structure?: string[]; voice?: string; sentences?: string; retention?: string; cta?: string; ending?: string; sampleHook?: string;
    /** anatomia do gancho nos primeiros 15 s, em batidas (ex.: "0–3 s: afirmação chocante") */
    hookAnatomy?: string[];
    /** segundos até a 1ª recompensa (a 1ª promessa paga) */
    timeToRewardSec?: number;
    /** 3 atos clássicos ou 4–5 atos de retenção */
    actModel?: '3-atos' | 'retencao';
    /** atos com % da duração (somam 100) */
    acts?: Array<{ name: string; pct: number; goal?: string }>;
    /** linguagem / PNL: padrões (loops abertos, pressuposição, futuro, contraste…) */
    nlp?: string;
    /** função dos bordões/conectivos de transição (a IA cria os próprios) */
    transitions?: string[];
    /** densidade de informação: segundos por fato novo */
    secPerFact?: number };
  titles?: { formula?: string; patterns?: string[]; do?: string[]; avoid?: string[] };
  thumbnail?: { focal?: string; text?: string; palette?: string[]; composition?: string; emotion?: string; mobile?: string; avoid?: string[] };
  narration?: { voice?: string; pace?: string; energy?: string };
  music?: string;
  /** estilo do TEXTO na tela (tipografia, legendas, palavras de destaque) */
  text?: { onScreen?: string; typography?: string; captions?: string; emphasis?: string; pacing?: string;
    family?: string; outline?: string; shadow?: string; case?: string;
    /** animação do texto: pop/spring, fade, typewriter, slide, karaoke, word */
    animation?: string };
  /** áudio medido/descrito (voz, loudness, mix, SFX) */
  audio?: { narration?: string; loudness?: string; mix?: string; sfx?: string;
    sfxPerMin?: number;
    /** orgânico (foley, ambiente) | digital (whoosh, glitch, UI) | misto */
    sfxKind?: 'organico' | 'digital' | 'misto';
    /** processamento da voz: limpa, podcast (compressão + grave), rádio (banda estreita), fita/vintage, reverb */
    voiceProcessing?: string };
  /** trilha sonora (gênero, clima, andamento, instrumentos, entrada/saída) */
  soundtrack?: { genre?: string; mood?: string; tempo?: string; instruments?: string; entry?: string;
    bpm?: number;
    /** a trilha some (silêncio) antes das revelações */
    silenceBeforeReveal?: boolean;
    /** os cortes caem no tempo da música */
    cutsOnBeat?: boolean;
    /** gênero/clima por ato, na ordem dos atos */
    genreByAct?: string[] };
}

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined) || undefined;
const strs = (v: unknown, n = 8) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : undefined);
const hexes = (v: unknown) => strs(v, 8)?.filter((x) => /^#[0-9a-f]{3,8}$/i.test(x));
const nr = (v: unknown, min: number, max: number) => { const n = Number(v); return v !== undefined && v !== null && v !== '' && Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n)) * 10) / 10 : undefined; };
const bool = (v: unknown) => (typeof v === 'boolean' ? v : v === 'true' || v === 'sim' ? true : v === 'false' || v === 'não' ? false : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => { const s = String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, '-'); return list.find((x) => s.startsWith(x)); };

/** Atos com %: normaliza para somar 100 (a IA às vezes soma 90 ou 110). */
export function normalizeActs(raw: unknown): Array<{ name: string; pct: number; goal?: string }> | undefined {
  const list = (Array.isArray(raw) ? raw : []).map((x) => x as Record<string, unknown>)
    .map((x) => ({ name: str(x?.['name'], 60) ?? '', pct: Number(x?.['pct'] ?? x?.['percent']) || 0, goal: str(x?.['goal'], 200) }))
    .filter((x) => x.name && x.pct > 0).slice(0, 6);
  if (!list.length) return undefined;
  const sum = list.reduce((a, b) => a + b.pct, 0);
  const scaled = list.map((x) => ({ ...x, pct: Math.max(1, Math.round((x.pct / sum) * 100)) }));
  const diff = 100 - scaled.reduce((a, b) => a + b.pct, 0);
  scaled[scaled.length - 1]!.pct += diff;
  return scaled.map((x) => (x.goal ? x : { name: x.name, pct: x.pct }));
}

/** Normaliza o DNA vindo da IA (só os campos conhecidos, textos com limite). */
export function normalizeDna(raw: unknown): ChannelDna {
  const d = (raw ?? {}) as Record<string, Record<string, unknown>>;
  const o = (k: string) => (d[k] && typeof d[k] === 'object' ? d[k] : {}) as Record<string, unknown>;
  const v = o('visual'), a = o('artDirection'), c = o('camera'), e = o('editing'), s = o('script'), t = o('titles'), th = o('thumbnail'), n = o('narration');
  const tx = o('text'), au = o('audio'), so = o('soundtrack');
  const pal = hexes(v['palette']);
  const acts = normalizeActs(s['acts']);
  return {
    visual: { style: str(v['style']), palette: pal, lighting: str(v['lighting']), texture: str(v['texture']), composition: str(v['composition']), colorGrade: str(v['colorGrade']),
      paletteRoles: normalizePalette(v['paletteRoles']) ?? (pal?.length ? paletteRoles(pal) : undefined),
      graphicStyle: strs(v['graphicStyle'], 6), aiStylePrompt: str(v['aiStylePrompt'], 500) },
    artDirection: { world: str(a['world']), characters: str(a['characters']), props: str(a['props']), typography: str(a['typography']), graphics: str(a['graphics']), motifs: str(a['motifs']), dos: strs(a['dos']), donts: strs(a['donts']) },
    camera: { shots: str(c['shots']), movement: str(c['movement']), angles: str(c['angles']), lenses: str(c['lenses']), transitions: str(c['transitions']),
      moves: strs(c['moves'], 8), snapZoomSfx: bool(c['snapZoomSfx']), lens: str(c['lens'], 60), depthOfField: str(c['depthOfField'], 80), jumpCuts: str(c['jumpCuts'], 300) },
    editing: { pace: str(e['pace']), patternInterrupts: str(e['patternInterrupts']), broll: str(e['broll']), sfx: str(e['sfx']) },
    script: { hook: str(s['hook']), structure: strs(s['structure'], 10), voice: str(s['voice']), sentences: str(s['sentences']), retention: str(s['retention']), cta: str(s['cta']), ending: str(s['ending']), sampleHook: str(s['sampleHook']),
      hookAnatomy: strs(s['hookAnatomy'], 6), timeToRewardSec: nr(s['timeToRewardSec'], 1, 600),
      actModel: oneOf(s['actModel'], ['3-atos', 'retencao'] as const) ?? (acts ? (acts.length >= 4 ? 'retencao' : '3-atos') : undefined), acts,
      nlp: str(s['nlp'], 500), transitions: strs(s['transitions'], 10), secPerFact: nr(s['secPerFact'], 1, 120) },
    titles: { formula: str(t['formula']), patterns: strs(t['patterns']), do: strs(t['do']), avoid: strs(t['avoid']) },
    thumbnail: { focal: str(th['focal']), text: str(th['text']), palette: hexes(th['palette']), composition: str(th['composition']), emotion: str(th['emotion']), mobile: str(th['mobile']), avoid: strs(th['avoid']) },
    narration: { voice: str(n['voice']), pace: str(n['pace']), energy: str(n['energy']) },
    music: str((d as unknown as Record<string, unknown>)['music']),
    text: { onScreen: str(tx['onScreen']), typography: str(tx['typography']), captions: str(tx['captions']), emphasis: str(tx['emphasis']), pacing: str(tx['pacing']),
      family: str(tx['family'], 80), outline: str(tx['outline'], 80), shadow: str(tx['shadow'], 80), case: str(tx['case'], 30), animation: str(tx['animation'], 60) },
    audio: { narration: str(au['narration']), loudness: str(au['loudness']), mix: str(au['mix']), sfx: str(au['sfx']),
      sfxPerMin: nr(au['sfxPerMin'], 0, 120), sfxKind: oneOf(au['sfxKind'], ['organico', 'digital', 'misto'] as const), voiceProcessing: str(au['voiceProcessing'], 200) },
    soundtrack: { genre: str(so['genre']), mood: str(so['mood']), tempo: str(so['tempo']), instruments: str(so['instruments']), entry: str(so['entry']),
      bpm: nr(so['bpm'], 40, 220), silenceBeforeReveal: bool(so['silenceBeforeReveal']), cutsOnBeat: bool(so['cutsOnBeat']), genreByAct: strs(so['genreByAct'], 6) },
  };
}

/* ───────── DNA → números para a produção ───────── */

/** Mapeia a animação de texto do formato para o tipo de legenda do app. */
export function subtitleKindFor(animation?: string): SubtitleKind | undefined {
  const a = (animation ?? '').toLowerCase();
  if (!a) return undefined;
  if (/karaok/.test(a)) return 'karaoke';
  if (/typewriter|m[aá]quina de escrever|digita/.test(a)) return 'typewriter';
  if (/word|palavra por palavra|uma palavra/.test(a)) return 'word';
  if (/pop|spring|bounce|mola|escala/.test(a)) return 'bold';
  if (/slide|desliza/.test(a)) return 'slide';
  if (/fade|esmaec|dissolve/.test(a)) return 'reveal';
  if (/neon|brilho|glow/.test(a)) return 'neon';
  if (/highlight|marca|caixa/.test(a)) return 'highlight';
  return undefined;
}

/**
 * Estilo da legenda do projeto: tipo pela animação de texto (o canal do usuário vence o formato) e cores pela
 * paleta dos vídeos do canal (senão a do formato). Não mexe em gravar/posição/tamanho.
 */
export function dnaSubtitleStyle(base: SubtitleStyle, f: FormatDna | undefined, identity?: ChannelIdentity): SubtitleStyle {
  const kind = base.kind ?? subtitleKindFor(identity?.typography?.animation) ?? subtitleKindFor(f?.textAnimation);
  const pal = identity?.palettes?.video ?? f?.palette;
  return { ...base, ...(kind ? { kind } : {}), ...(pal?.text ? { color: pal.text } : {}), ...(pal?.accent ? { accent: pal.accent } : {}) };
}

/** Duração de cena a partir do take médio do formato: 3 takes por cena, entre 8 e 16 s. */
export const dnaSceneSec = (f?: FormatDna) => (f?.avgTakeSec ? Math.round(Math.max(8, Math.min(16, f.avgTakeSec * 3))) : undefined);

/** DNA medido + descrito → FormatDna (estrutura, nunca a identidade da referência). */
export function toFormatDna(dna: ChannelDna, m: Partial<VideoMetrics>, phrases: string[] = []): FormatDna {
  const s = dna.script, cam = dna.camera, tx = dna.text, au = dna.audio, so = dna.soundtrack, vis = dna.visual;
  const out: FormatDna = {
    wpm: m.wpm ? Math.round(m.wpm) : undefined,
    hook: s?.hookAnatomy?.length || s?.timeToRewardSec ? { firstSec: 15, timeToRewardSec: s?.timeToRewardSec, anatomy: s?.hookAnatomy } : undefined,
    acts: s?.acts, actModel: s?.actModel,
    transitions: s?.transitions?.length ? s.transitions : phrases.length ? phrases : undefined,
    secPerFact: s?.secPerFact ?? m.secPerFact,
    avgTakeSec: m.avgShotSec, jumpCutShare: m.jumpCutShare,
    cameraMoves: cam?.moves, lens: cam?.lens, depthOfField: cam?.depthOfField,
    textAnimation: tx?.animation,
    typography: tx?.family || tx?.case || tx?.outline || tx?.shadow ? { family: tx?.family, case: tx?.case, outline: tx?.outline, shadow: tx?.shadow } : undefined,
    graphicStyle: vis?.graphicStyle, aiStylePrompt: vis?.aiStylePrompt, palette: vis?.paletteRoles,
    sfxPerMin: au?.sfxPerMin, sfxKind: au?.sfxKind,
    music: so?.bpm || so?.silenceBeforeReveal !== undefined || so?.cutsOnBeat !== undefined || so?.genreByAct?.length
      ? { bpm: so?.bpm, silenceBeforeReveal: so?.silenceBeforeReveal, cutsOnBeat: so?.cutsOnBeat, genreByAct: so?.genreByAct } : undefined,
    voiceProcessing: au?.voiceProcessing,
  };
  for (const k of Object.keys(out) as Array<keyof FormatDna>) if (out[k] === undefined) delete out[k];
  return out;
}

/** Palavras por segundo da narração: DNA medido (limitado a 1,6–4,2) ou o padrão do idioma. */
export function wordsPerSecond(f: FormatDna | undefined, language?: string): number {
  if (f?.wpm && f.wpm > 0) return Math.max(1.6, Math.min(4.2, f.wpm / 60));
  return /^en/i.test(language ?? '') ? 2.8 : 2.6;
}

/** Atos com segundos para a duração alvo (o roteiro e o plano de cenas usam os mesmos limites). */
export function actTimeline(acts: FormatDna['acts'], durationSec: number): Array<{ name: string; from: number; to: number; goal?: string }> {
  if (!acts?.length || durationSec <= 0) return [];
  let t = 0;
  return acts.map((a) => { const from = t; t = Math.min(durationSec, t + (a.pct / 100) * durationSec); return { name: a.name, from: Math.round(from), to: Math.round(t), goal: a.goal }; });
}

/** SFX por cena a partir do SFX/min do formato (mínimo 0, máximo 6). */
export function sfxPerScene(f: FormatDna | undefined, sceneSec: number): number | undefined {
  if (f?.sfxPerMin === undefined) return undefined;
  return Math.max(0, Math.min(6, Math.round((f.sfxPerMin * Math.max(1, sceneSec)) / 60)));
}

/** Regra de roteiro com os números do DNA (para o prompt da etapa de roteiro). */
export function dnaScriptRule(f: FormatDna | undefined, durationSec: number): string {
  if (!f) return '';
  const acts = actTimeline(f.acts, durationSec);
  return [
    f.wpm && `RITMO DO FORMATO: ${f.wpm} palavras/min — o tamanho do texto já está calculado por esse ritmo.`,
    f.hook && `GANCHO (0–${f.hook.firstSec ?? 15} s)${f.hook.anatomy?.length ? `: ${f.hook.anatomy.join(' → ')}` : ''}${f.hook.timeToRewardSec ? `; a 1ª recompensa (promessa paga) chega até ${f.hook.timeToRewardSec} s` : ''}.`,
    acts.length && `ATOS (${f.actModel === 'retencao' ? 'modelo de retenção' : '3 atos'}): ${acts.map((a) => `${a.name} ${a.from}–${a.to} s${a.goal ? ` (${a.goal})` : ''}`).join(' · ')}.`,
    f.secPerFact && `DENSIDADE: um fato novo (número, nome, data, exemplo concreto) a cada ≈ ${f.secPerFact} s de fala.`,
    f.transitions?.length && `TRANSIÇÕES: o formato usa conectivos recorrentes com esta função ("${f.transitions.slice(0, 5).join('", "')}") — crie bordões PRÓPRIOS com a mesma função; não repita as frases do canal de referência.`,
  ].filter(Boolean).join(' ');
}

/** Regra de efeitos sonoros por cena (plano de cenas e cenas por código). */
export function dnaSfxRule(f: FormatDna | undefined, sceneSec: number): string {
  const n = sfxPerScene(f, sceneSec);
  if (n === undefined && !f?.sfxKind) return '';
  return `SFX DO FORMATO: ${f?.sfxPerMin !== undefined ? `≈ ${f.sfxPerMin} por minuto (≈ ${n} por cena de ${Math.round(sceneSec)} s)` : ''}${f?.sfxKind ? `, timbre ${f.sfxKind === 'organico' ? 'orgânico (foley, ambiente, objetos)' : f.sfxKind === 'digital' ? 'digital (whoosh, glitch, pop, UI)' : 'misto'}` : ''}${f?.cameraMoves?.some((x) => /snap/i.test(x)) ? '; todo snap zoom leva whoosh/impact' : ''}.`;
}

/** Ranking de idiomas (notas 0–10, sem repetidos, do melhor para o pior). */
export function normalizeLanguages(raw: unknown, max = 5): LanguagePick[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).map((x) => x as Record<string, unknown>).filter((x) => typeof x?.['code'] === 'string' && String(x['code']).trim())
    .map((x) => ({ code: String(x['code']).trim(), score: Math.max(0, Math.min(10, Number(x['score']) || 0)), why: str(x['why'], 300), audience: str(x['audience'], 80), competition: str(x['competition'], 40), cpm: str(x['cpm'], 40) }))
    .filter((x) => !seen.has(x.code.toLowerCase()) && seen.add(x.code.toLowerCase()))
    .sort((a, b) => b.score - a.score).slice(0, max);
}

/* ───────── DNA → skill (garantido, em blocos marcados para poder atualizar) ───────── */

const DNA_START = '<!-- dna:start -->';
const DNA_END = '<!-- dna:end -->';
const lines = (...xs: Array<string | number | false | undefined | null>) => xs.filter((x): x is string => typeof x === 'string' && !!x).join('\n');
const block = (text: string) => `${DNA_START}\n${text}\n${DNA_END}`;
const put = (cur: string | undefined, text: string) => {
  if (!text.trim()) return cur ?? '';
  const base = (cur ?? '').replace(new RegExp(`${DNA_START}[\\s\\S]*?${DNA_END}\\n?`, 'g'), '').trim();
  return [base, block(text)].filter(Boolean).join('\n\n');
};

/** Grava o DNA (medido + descrito) nas diretrizes e nas etapas da skill, substituindo o bloco anterior. */
/** O princípio do clone: só a ESTRUTURA do formato de referência, aplicada à identidade e ao tema do usuário. */
export const STRUCTURE_PRINCIPLE = 'PRINCÍPIO: deste formato de referência aplique SÓ as métricas de ESTRUTURA (ritmo de fala, gancho, atos e porcentagens, densidade de informação, duração dos takes, movimentos de câmera, densidade de SFX, dinâmica da trilha). ' +
  'A IDENTIDADE (nome, marca, paleta, tipografia, personagens, bordões, frases e assuntos) é a do canal e do tema do usuário — nunca copie o conteúdo, as frases ou a marca da referência.';

export function applyDnaToSkill(k: Skill, dna: ChannelDna, m: Partial<VideoMetrics>, titles?: TitleStructure, sourceName = 'canal de origem', phrases: string[] = []): Skill {
  const sk: Skill = { ...k, steps: { ...(k.steps ?? {}) } };
  const f = toFormatDna(dna, m, phrases);
  if (Object.keys(f).length) sk.formatDna = f;
  const metr = lines(m.avgShotSec ? `- plano médio de ${m.avgShotSec} s (${m.cutsPerMin ?? '?'} cortes/min${m.jumpCutShare ? `, ${Math.round(m.jumpCutShare * 100)}% de takes < 1,5 s` : ''})` : '', m.wpm ? `- narração a ${m.wpm} palavras/min, ${m.wordsPerSentence ?? '?'} palavras por frase` : '', m.secondPerson ? `- ${m.secondPerson}% das palavras falam com o espectador (você)` : '',
    f.secPerFact ? `- densidade: um fato novo a cada ≈ ${f.secPerFact} s` : '');
  sk.global = put(sk.global, lines(`DNA DO FORMATO (medido nos vídeos de ${sourceName} que mais performaram; replique o estilo, nunca o conteúdo):`, metr,
    dna.visual?.style && `- visual: ${dna.visual.style}`, dna.visual?.palette?.length && `- paleta (do formato; a do canal do usuário vence): ${dna.visual.palette.join(', ')}`,
    dna.artDirection?.world && `- direção de arte: ${dna.artDirection.world}`, dna.narration?.voice && `- narração: ${dna.narration.voice}${dna.narration.energy ? `, ${dna.narration.energy}` : ''}`,
    STRUCTURE_PRINCIPLE));
  const s = dna.script;
  const acts = s?.acts?.length ? `- atos (${s.actModel === 'retencao' ? '4–5 atos de retenção' : '3 atos'}): ${s.acts.map((a) => `${a.name} ${a.pct}%${a.goal ? ` — ${a.goal}` : ''}`).join(' → ')}` : '';
  sk.steps['script'] = put(sk.steps['script'], lines('ESTILO DE ROTEIRO DO FORMATO:', s?.hook && `- gancho: ${s.hook}`,
    s?.hookAnatomy?.length && `- anatomia do gancho (0–15 s): ${s.hookAnatomy.join(' → ')}`, s?.timeToRewardSec && `- 1ª recompensa (a promessa começa a ser paga) até ${s.timeToRewardSec} s`,
    s?.structure?.length && `- estrutura: ${s.structure.join(' → ')}`, acts,
    s?.voice && `- voz: ${s.voice}`, (s?.sentences || m.wordsPerSentence) && `- frases: ${s?.sentences ?? ''}${m.wordsPerSentence ? ` (≈ ${m.wordsPerSentence} palavras por frase)` : ''}`,
    m.wpm && `- ritmo de fala: ≈ ${m.wpm} palavras/min (escreva a quantidade de texto para a duração alvo)`,
    f.secPerFact && `- densidade de informação: um fato novo (número, nome, data, exemplo) a cada ≈ ${f.secPerFact} s`,
    s?.nlp && `- linguagem/PNL: ${s.nlp}`,
    f.transitions?.length && `- bordões de transição do formato (use a FUNÇÃO, crie os seus): ${f.transitions.map((x) => `"${x}"`).join(', ')}`,
    s?.retention && `- retenção: ${s.retention}`, s?.cta && `- CTA: ${s.cta}`, s?.ending && `- final: ${s.ending}`,
    s?.sampleHook && `- exemplo de gancho no estilo (NÃO reutilize, é só referência de forma): "${s.sampleHook}"`));
  const cam = dna.camera, ed = dna.editing;
  const camera = lines(cam?.shots && `- planos: ${cam.shots}`, cam?.movement && `- movimento: ${cam.movement}`, cam?.moves?.length && `- movimentos usados: ${cam.moves.join(', ')}${cam.snapZoomSfx ? ' (snap zoom sempre com SFX)' : ''}`,
    cam?.angles && `- ângulos: ${cam.angles}`, cam?.lenses && `- lentes/profundidade: ${cam.lenses}`, cam?.lens && `- lente simulada: ${cam.lens}`, cam?.depthOfField && `- profundidade de campo: ${cam.depthOfField}`,
    cam?.jumpCuts && `- jump cuts: ${cam.jumpCuts}`, cam?.transitions && `- transições: ${cam.transitions}`);
  /* plano ≠ cena: no original os cortes acontecem DENTRO de cenas maiores. Uma cena por corte multiplicava as
     chamadas à IA (um vídeo de 5 min virava 90 cenas de 3 s). Cena = 2–4 planos, no mínimo 8 s. */
  const sceneSec = m.avgShotSec ? Math.round(Math.max(8, Math.min(16, m.avgShotSec * 3))) : undefined;
  sk.steps['scene_plan'] = put(sk.steps['scene_plan'], lines('RITMO E CÂMERA DO FORMATO:',
    m.avgShotSec && `- o formato corta a cada ≈ ${m.avgShotSec} s, mas esses cortes acontecem DENTRO das cenas: cada cena tem ≈ ${sceneSec} s (2 a 4 planos internos — punch-in, troca de ângulo, contraplano) e NÃO uma cena por corte`,
    sceneSec && `- quantidade de cenas ≈ duração alvo ÷ ${sceneSec} s (ex.: 5 min ≈ ${Math.round(300 / sceneSec)} cenas)`,
    m.jumpCutShare && m.jumpCutShare >= 0.15 && `- ${Math.round(m.jumpCutShare * 100)}% dos takes têm menos de 1,5 s: use jump cuts/punch-ins rápidos na fala`,
    s?.acts?.length && `- distribua as cenas pelos atos nas mesmas porcentagens (${s.acts.map((a) => `${a.name} ${a.pct}%`).join(', ')})`,
    camera, ed?.pace && `- edição: ${ed.pace}`, ed?.patternInterrupts && `- quebras de padrão: ${ed.patternInterrupts}`, ed?.broll && `- B-roll: ${ed.broll}`,
    dna.visual?.graphicStyle?.length && `- estilo gráfico/B-roll: ${dna.visual.graphicStyle.join(', ')}`,
    dnaSfxRule(f, sceneSec ?? 10),
    dna.soundtrack?.cutsOnBeat && dna.soundtrack.bpm && `- cortes no tempo da trilha (${dna.soundtrack.bpm} BPM: 1 compasso = ${Math.round((240 / dna.soundtrack.bpm) * 10) / 10} s)`,
    dna.soundtrack?.silenceBeforeReveal && '- antes de cada revelação, deixe 0,5–1 s sem trilha (silêncio) e só a voz'));
  const art = dna.artDirection, vis = dna.visual;
  /* texto na tela: o que a IA viu quadro a quadro a 1 fps (tipografia, legendas, palavras de destaque) */
  const tx = dna.text;
  const textBlock = lines('TEXTO NA TELA NO FORMATO (observado quadro a quadro):',
    tx?.onScreen && `- o que aparece escrito: ${tx.onScreen}`, tx?.typography && `- tipografia: ${tx.typography}`,
    (tx?.family || tx?.case || tx?.outline || tx?.shadow) && `- texto: ${[tx?.family && `família ${tx.family}`, tx?.case && `caixa ${tx.case}`, tx?.outline && `contorno ${tx.outline}`, tx?.shadow && `sombra ${tx.shadow}`].filter(Boolean).join(', ')} (a fonte do canal do usuário vence a família)`,
    tx?.animation && `- animação do texto: ${tx.animation}`,
    tx?.captions && `- legendas: ${tx.captions}`,
    tx?.emphasis && `- destaque: ${tx.emphasis}`, tx?.pacing && `- ritmo do texto: ${tx.pacing}`);
  const pr = vis?.paletteRoles;
  const look = lines('DIREÇÃO DE ARTE DO FORMATO:', vis?.style && `- estilo: ${vis.style}`, vis?.lighting && `- luz: ${vis.lighting}`, vis?.colorGrade && `- cor: ${vis.colorGrade}`,
    vis?.palette?.length && `- paleta do formato (o canal do usuário pode ter a dele, que vence): ${vis.palette.join(', ')}`,
    pr?.background && `- papéis da paleta: fundo ${pr.background} (${pr.mode === 'light' ? 'claro' : 'escuro'}), texto ${pr.text ?? '?'}, destaque ${pr.accent ?? '?'}${pr.contrast ? ` — contraste ${pr.contrast}:1` : ''}`,
    vis?.graphicStyle?.length && `- estilo gráfico/B-roll: ${vis.graphicStyle.join(', ')}`,
    vis?.aiStylePrompt && `- prompt base de estilo (só o estilo; o assunto vem da cena): ${vis.aiStylePrompt}`,
    vis?.composition && `- composição: ${vis.composition}`, vis?.texture && `- textura: ${vis.texture}`, art?.characters && `- personagens: ${art.characters}`, art?.props && `- objetos: ${art.props}`, art?.motifs && `- motivos recorrentes: ${art.motifs}`,
    art?.typography && `- tipografia: ${art.typography}`, art?.graphics && `- grafismos: ${art.graphics}`, camera,
    m.avgShotSec && `- ritmo: dentro da cena, mude o enquadramento a cada ≈ ${m.avgShotSec} s (punch-in, troca de ângulo ou de plano), como o formato original`,
    art?.dos?.length && `- faça: ${art.dos.join('; ')}`, art?.donts?.length && `- evite: ${art.donts.join('; ')}`);
  /* um único bloco por etapa: o `put` substitui o bloco anterior, então texto e arte vão juntos */
  const lookAll = [look, textBlock].filter(Boolean).join('\n\n');
  const sfxCode = dnaSfxRule(f, sceneSec ?? 10);
  for (const st of ['image', 'video', 'code_scene', 'motion_graphics', 'asset_design']) sk.steps[st] = put(sk.steps[st], (st === 'code_scene' || st === 'motion_graphics') && sfxCode ? [lookAll, sfxCode].filter(Boolean).join('\n\n') : lookAll);
  if (textBlock) sk.steps['subtitles'] = put(sk.steps['subtitles'], textBlock);
  const th = dna.thumbnail;
  sk.steps['thumbnail'] = put(sk.steps['thumbnail'], lines('THUMBNAIL NO ESTILO DO FORMATO:', th?.focal && `- ponto focal: ${th.focal}`, th?.text && `- texto: ${th.text}`, th?.palette?.length && `- paleta: ${th.palette.join(', ')}`,
    th?.composition && `- composição: ${th.composition}`, th?.emotion && `- emoção: ${th.emotion}`, th?.mobile && `- celular: ${th.mobile}`, th?.avoid?.length && `- evite: ${th.avoid.join('; ')}`));
  const ti = dna.titles;
  sk.steps['metadata'] = put(sk.steps['metadata'], lines('TÍTULOS NO ESTILO DO FORMATO:', ti?.formula && `- fórmula: ${ti.formula}`, ti?.patterns?.length && `- padrões: ${ti.patterns.join(' | ')}`,
    titles && `- estrutura medida: ${titles.summary}`, titles?.examples.length && `- referência de forma (não copie): ${titles.examples.slice(0, 4).map((x) => `"${x}"`).join(', ')}`, ti?.do?.length && `- faça: ${ti.do.join('; ')}`, ti?.avoid?.length && `- evite: ${ti.avoid.join('; ')}`));
  const nar = dna.narration, au = dna.audio;
  /* narração e áudio vão no MESMO bloco (o `put` substitui o bloco anterior) */
  const narBlock = lines('NARRAÇÃO DO FORMATO:', nar?.voice && `- voz: ${nar.voice}`, (nar?.pace || m.wpm) && `- ritmo: ${nar?.pace ?? ''}${m.wpm ? ` (≈ ${m.wpm} palavras/min)` : ''}`, nar?.energy && `- energia: ${nar.energy}`);
  const audioBlock = lines('ÁUDIO DO FORMATO:', au?.narration && `- voz: ${au.narration}`, au?.voiceProcessing && `- processamento da voz: ${au.voiceProcessing}`, au?.loudness && `- loudness: ${au.loudness}`, au?.mix && `- mixagem: ${au.mix}`);
  const narAll = [narBlock, audioBlock].filter(Boolean).join('\n\n');
  if (narAll) sk.steps['narration'] = put(sk.steps['narration'], narAll);
  const sfxAll = lines(au?.sfx && `SFX DO FORMATO: ${au.sfx}`, dnaSfxRule(f, sceneSec ?? 10));
  if (sfxAll) sk.steps['sfx'] = put(sk.steps['sfx'], sfxAll);
  /* trilha sonora */
  const so = dna.soundtrack;
  const track = lines(dna.music ? `TRILHA DO FORMATO: ${dna.music}` : 'TRILHA DO FORMATO:',
    so?.genre && `- gênero: ${so.genre}`, so?.mood && `- clima: ${so.mood}`, so?.tempo && `- andamento: ${so.tempo}`, so?.bpm && `- BPM: ≈ ${so.bpm}`,
    so?.instruments && `- instrumentos: ${so.instruments}`, so?.entry && `- entrada/saída: ${so.entry}`,
    so?.genreByAct?.length && `- por ato: ${so.genreByAct.join(' → ')}`,
    so?.silenceBeforeReveal && '- dinâmica: a trilha corta (silêncio) antes das revelações e volta no impacto',
    so?.cutsOnBeat && '- os cortes da edição caem no tempo da música');
  /* só o título não é bloco: sem nenhum dado de trilha, nada é gravado */
  if (track && track !== 'TRILHA DO FORMATO:') sk.steps['music'] = put(sk.steps['music'], track);
  for (const [key, val] of Object.entries(sk.steps)) if (!val.trim()) delete sk.steps[key];
  return sk;
}

/** Estrutura dos títulos do canal (reexporta a função pura das regras de YouTube). */
export const channelTitleStructure = (titles: RefTitle[]): TitleStructure => titleStructure(titles);
