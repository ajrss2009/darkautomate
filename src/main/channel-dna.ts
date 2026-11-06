import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Skill } from '../shared/types';
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
  words?: number; wpm?: number; wordsPerSentence?: number; questions?: number; secondPerson?: number; hook?: string;
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
export function speechMetrics(transcript: string | undefined, durationSec: number): Pick<VideoMetrics, 'words' | 'wpm' | 'wordsPerSentence' | 'questions' | 'secondPerson' | 'hook'> {
  const t = (transcript ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return {};
  const words = t.split(' ').filter(Boolean);
  const sentences = t.split(/(?<=[.!?…])\s+/).filter((x) => x.trim().length > 1);
  const second = words.filter((w) => /^(você|vocês|voce|te|seu|sua|seus|suas|you|your|yours|tú|tu|usted|ustedes)$/i.test(w.replace(/[^\p{L}]/gu, ''))).length;
  return {
    words: words.length,
    wpm: durationSec > 0 ? Math.round(words.length / (durationSec / 60)) : undefined,
    wordsPerSentence: Math.round((words.length / Math.max(1, sentences.length)) * 10) / 10,
    questions: (t.match(/[?¿]/g) ?? []).length,
    secondPerson: Math.round((second / Math.max(1, words.length)) * 1000) / 10,
    hook: words.slice(0, 40).join(' '),
  };
}

/** Ritmo de edição (cortes) a partir dos instantes de corte (função pura). */
export function cutMetrics(cuts: number[], durationSec: number): Pick<VideoMetrics, 'shots' | 'avgShotSec' | 'cutsPerMin'> {
  const inside = cuts.filter((c) => c > 0.2 && c < durationSec - 0.2);
  const shots = inside.length + 1;
  return { shots, avgShotSec: Math.round((durationSec / shots) * 10) / 10, cutsPerMin: durationSec > 0 ? Math.round((inside.length / (durationSec / 60)) * 10) / 10 : 0 };
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
  return { durationSec: avg('durationSec'), avgShotSec: avg('avgShotSec'), cutsPerMin: avg('cutsPerMin'), wpm: avg('wpm'), wordsPerSentence: avg('wordsPerSentence'), secondPerson: avg('secondPerson') };
}

/* ───────── DNA descrito pela IA (formato estável) ───────── */

export interface LanguagePick { code: string; score: number; why?: string; audience?: string; competition?: string; cpm?: string }
export interface ChannelDna {
  visual?: { style?: string; palette?: string[]; lighting?: string; texture?: string; composition?: string; colorGrade?: string };
  artDirection?: { world?: string; characters?: string; props?: string; typography?: string; graphics?: string; motifs?: string; dos?: string[]; donts?: string[] };
  camera?: { shots?: string; movement?: string; angles?: string; lenses?: string; transitions?: string };
  editing?: { pace?: string; patternInterrupts?: string; broll?: string; sfx?: string };
  script?: { hook?: string; structure?: string[]; voice?: string; sentences?: string; retention?: string; cta?: string; ending?: string; sampleHook?: string };
  titles?: { formula?: string; patterns?: string[]; do?: string[]; avoid?: string[] };
  thumbnail?: { focal?: string; text?: string; palette?: string[]; composition?: string; emotion?: string; mobile?: string; avoid?: string[] };
  narration?: { voice?: string; pace?: string; energy?: string };
  music?: string;
  /** estilo do TEXTO na tela (tipografia, legendas, palavras de destaque) */
  text?: { onScreen?: string; typography?: string; captions?: string; emphasis?: string; pacing?: string };
  /** áudio medido/descrito (voz, loudness, mix, SFX) */
  audio?: { narration?: string; loudness?: string; mix?: string; sfx?: string };
  /** trilha sonora (gênero, clima, andamento, instrumentos, entrada/saída) */
  soundtrack?: { genre?: string; mood?: string; tempo?: string; instruments?: string; entry?: string };
}

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined) || undefined;
const strs = (v: unknown, n = 8) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : undefined);
const hexes = (v: unknown) => strs(v, 8)?.filter((x) => /^#[0-9a-f]{3,8}$/i.test(x));

/** Normaliza o DNA vindo da IA (só os campos conhecidos, textos com limite). */
export function normalizeDna(raw: unknown): ChannelDna {
  const d = (raw ?? {}) as Record<string, Record<string, unknown>>;
  const o = (k: string) => (d[k] && typeof d[k] === 'object' ? d[k] : {}) as Record<string, unknown>;
  const v = o('visual'), a = o('artDirection'), c = o('camera'), e = o('editing'), s = o('script'), t = o('titles'), th = o('thumbnail'), n = o('narration');
  const tx = o('text'), au = o('audio'), so = o('soundtrack');
  return {
    visual: { style: str(v['style']), palette: hexes(v['palette']), lighting: str(v['lighting']), texture: str(v['texture']), composition: str(v['composition']), colorGrade: str(v['colorGrade']) },
    artDirection: { world: str(a['world']), characters: str(a['characters']), props: str(a['props']), typography: str(a['typography']), graphics: str(a['graphics']), motifs: str(a['motifs']), dos: strs(a['dos']), donts: strs(a['donts']) },
    camera: { shots: str(c['shots']), movement: str(c['movement']), angles: str(c['angles']), lenses: str(c['lenses']), transitions: str(c['transitions']) },
    editing: { pace: str(e['pace']), patternInterrupts: str(e['patternInterrupts']), broll: str(e['broll']), sfx: str(e['sfx']) },
    script: { hook: str(s['hook']), structure: strs(s['structure'], 10), voice: str(s['voice']), sentences: str(s['sentences']), retention: str(s['retention']), cta: str(s['cta']), ending: str(s['ending']), sampleHook: str(s['sampleHook']) },
    titles: { formula: str(t['formula']), patterns: strs(t['patterns']), do: strs(t['do']), avoid: strs(t['avoid']) },
    thumbnail: { focal: str(th['focal']), text: str(th['text']), palette: hexes(th['palette']), composition: str(th['composition']), emotion: str(th['emotion']), mobile: str(th['mobile']), avoid: strs(th['avoid']) },
    narration: { voice: str(n['voice']), pace: str(n['pace']), energy: str(n['energy']) },
    music: str((d as unknown as Record<string, unknown>)['music']),
    text: { onScreen: str(tx['onScreen']), typography: str(tx['typography']), captions: str(tx['captions']), emphasis: str(tx['emphasis']), pacing: str(tx['pacing']) },
    audio: { narration: str(au['narration']), loudness: str(au['loudness']), mix: str(au['mix']), sfx: str(au['sfx']) },
    soundtrack: { genre: str(so['genre']), mood: str(so['mood']), tempo: str(so['tempo']), instruments: str(so['instruments']), entry: str(so['entry']) },
  };
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
export function applyDnaToSkill(k: Skill, dna: ChannelDna, m: Partial<VideoMetrics>, titles?: TitleStructure, sourceName = 'canal de origem'): Skill {
  const sk: Skill = { ...k, steps: { ...(k.steps ?? {}) } };
  const metr = lines(m.avgShotSec ? `- plano médio de ${m.avgShotSec} s (${m.cutsPerMin ?? '?'} cortes/min)` : '', m.wpm ? `- narração a ${m.wpm} palavras/min, ${m.wordsPerSentence ?? '?'} palavras por frase` : '', m.secondPerson ? `- ${m.secondPerson}% das palavras falam com o espectador (você)` : '');
  sk.global = put(sk.global, lines(`DNA DO FORMATO (medido nos vídeos de ${sourceName} que mais performaram; replique o estilo, nunca o conteúdo):`, metr,
    dna.visual?.style && `- visual: ${dna.visual.style}`, dna.visual?.palette?.length && `- paleta: ${dna.visual.palette.join(', ')}`,
    dna.artDirection?.world && `- direção de arte: ${dna.artDirection.world}`, dna.narration?.voice && `- narração: ${dna.narration.voice}${dna.narration.energy ? `, ${dna.narration.energy}` : ''}`));
  const s = dna.script;
  sk.steps['script'] = put(sk.steps['script'], lines('ESTILO DE ROTEIRO DO FORMATO:', s?.hook && `- gancho: ${s.hook}`, s?.structure?.length && `- estrutura: ${s.structure.join(' → ')}`,
    s?.voice && `- voz: ${s.voice}`, (s?.sentences || m.wordsPerSentence) && `- frases: ${s?.sentences ?? ''}${m.wordsPerSentence ? ` (≈ ${m.wordsPerSentence} palavras por frase)` : ''}`,
    m.wpm && `- ritmo de fala: ≈ ${m.wpm} palavras/min (escreva a quantidade de texto para a duração alvo)`, s?.retention && `- retenção: ${s.retention}`, s?.cta && `- CTA: ${s.cta}`, s?.ending && `- final: ${s.ending}`,
    s?.sampleHook && `- exemplo de gancho no estilo (NÃO reutilize, é só referência de forma): "${s.sampleHook}"`));
  const cam = dna.camera, ed = dna.editing;
  const camera = lines(cam?.shots && `- planos: ${cam.shots}`, cam?.movement && `- movimento: ${cam.movement}`, cam?.angles && `- ângulos: ${cam.angles}`, cam?.lenses && `- lentes/profundidade: ${cam.lenses}`, cam?.transitions && `- transições: ${cam.transitions}`);
  /* plano ≠ cena: no original os cortes acontecem DENTRO de cenas maiores. Uma cena por corte multiplicava as
     chamadas à IA (um vídeo de 5 min virava 90 cenas de 3 s). Cena = 2–4 planos, no mínimo 8 s. */
  const sceneSec = m.avgShotSec ? Math.round(Math.max(8, Math.min(16, m.avgShotSec * 3))) : undefined;
  sk.steps['scene_plan'] = put(sk.steps['scene_plan'], lines('RITMO E CÂMERA DO FORMATO:',
    m.avgShotSec && `- o formato corta a cada ≈ ${m.avgShotSec} s, mas esses cortes acontecem DENTRO das cenas: cada cena tem ≈ ${sceneSec} s (2 a 4 planos internos — punch-in, troca de ângulo, contraplano) e NÃO uma cena por corte`,
    sceneSec && `- quantidade de cenas ≈ duração alvo ÷ ${sceneSec} s (ex.: 5 min ≈ ${Math.round(300 / sceneSec)} cenas)`, camera, ed?.pace && `- edição: ${ed.pace}`, ed?.patternInterrupts && `- quebras de padrão: ${ed.patternInterrupts}`, ed?.broll && `- B-roll: ${ed.broll}`));
  const art = dna.artDirection, vis = dna.visual;
  /* texto na tela: o que a IA viu quadro a quadro a 1 fps (tipografia, legendas, palavras de destaque) */
  const tx = dna.text;
  const textBlock = lines('TEXTO NA TELA NO FORMATO (observado quadro a quadro):',
    tx?.onScreen && `- o que aparece escrito: ${tx.onScreen}`, tx?.typography && `- tipografia: ${tx.typography}`, tx?.captions && `- legendas: ${tx.captions}`,
    tx?.emphasis && `- destaque: ${tx.emphasis}`, tx?.pacing && `- ritmo do texto: ${tx.pacing}`);
  const look = lines('DIREÇÃO DE ARTE DO FORMATO:', vis?.style && `- estilo: ${vis.style}`, vis?.lighting && `- luz: ${vis.lighting}`, vis?.colorGrade && `- cor: ${vis.colorGrade}`, vis?.palette?.length && `- paleta: ${vis.palette.join(', ')}`,
    vis?.composition && `- composição: ${vis.composition}`, vis?.texture && `- textura: ${vis.texture}`, art?.characters && `- personagens: ${art.characters}`, art?.props && `- objetos: ${art.props}`, art?.motifs && `- motivos recorrentes: ${art.motifs}`,
    art?.typography && `- tipografia: ${art.typography}`, art?.graphics && `- grafismos: ${art.graphics}`, camera,
    m.avgShotSec && `- ritmo: dentro da cena, mude o enquadramento a cada ≈ ${m.avgShotSec} s (punch-in, troca de ângulo ou de plano), como o formato original`,
    art?.dos?.length && `- faça: ${art.dos.join('; ')}`, art?.donts?.length && `- evite: ${art.donts.join('; ')}`);
  /* um único bloco por etapa: o `put` substitui o bloco anterior, então texto e arte vão juntos */
  const lookAll = [look, textBlock].filter(Boolean).join('\n\n');
  for (const st of ['image', 'video', 'code_scene', 'motion_graphics', 'asset_design']) sk.steps[st] = put(sk.steps[st], lookAll);
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
  const audioBlock = lines('ÁUDIO DO FORMATO:', au?.narration && `- voz: ${au.narration}`, au?.loudness && `- loudness: ${au.loudness}`, au?.mix && `- mixagem: ${au.mix}`);
  const narAll = [narBlock, audioBlock].filter(Boolean).join('\n\n');
  if (narAll) sk.steps['narration'] = put(sk.steps['narration'], narAll);
  if (au?.sfx) sk.steps['sfx'] = put(sk.steps['sfx'], `SFX DO FORMATO: ${au.sfx}`);
  /* trilha sonora */
  const so = dna.soundtrack;
  const track = lines(dna.music ? `TRILHA DO FORMATO: ${dna.music}` : '',
    so?.genre && `- gênero: ${so.genre}`, so?.mood && `- clima: ${so.mood}`, so?.tempo && `- andamento: ${so.tempo}`, so?.instruments && `- instrumentos: ${so.instruments}`, so?.entry && `- entrada/saída: ${so.entry}`);
  if (track) sk.steps['music'] = put(sk.steps['music'], track);
  for (const [key, val] of Object.entries(sk.steps)) if (!val.trim()) delete sk.steps[key];
  return sk;
}

/** Estrutura dos títulos do canal (reexporta a função pura das regras de YouTube). */
export const channelTitleStructure = (titles: RefTitle[]): TitleStructure => titleStructure(titles);
