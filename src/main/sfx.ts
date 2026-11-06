import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Scene, SfxCue } from '../shared/types';
import * as ff from './ffmpeg';
import type { WordTime } from './whisper';

/**
 * Efeitos sonoros GERADOS POR CÓDIGO: cada som é uma expressão matemática (aevalsrc do ffmpeg)
 * mais filtros. Nada é baixado nem precisa de API; o mesmo nome sempre gera o mesmo som.
 */
export interface SfxDef { id: string; label: string; icon: string; dur: number; expr: string; post?: string; tags: string }

const N = '(random(0)*2-1)';               // ruído branco
export const SFX_LIBRARY: SfxDef[] = [
  { id: 'whoosh', label: 'Whoosh', icon: '💨', dur: 0.9, expr: `0.8*${N}*pow(sin(PI*t/0.9),2)`, post: 'highpass=f=250,lowpass=f=2200', tags: 'transição passagem movimento' },
  { id: 'swoosh', label: 'Swoosh curto', icon: '🌬️', dur: 0.45, expr: `0.8*${N}*pow(sin(PI*t/0.45),2)`, post: 'highpass=f=600,lowpass=f=4000', tags: 'transição rápido' },
  { id: 'impact', label: 'Impacto', icon: '💥', dur: 1.4, expr: `(0.9*sin(2*PI*55*t)+0.5*${N}*exp(-30*t))*exp(-4*t)`, post: 'lowpass=f=3000', tags: 'revelação batida forte' },
  { id: 'thud', label: 'Baque', icon: '🥁', dur: 0.5, expr: `0.95*sin(2*PI*(40*t+11*(1-exp(-8*t))))*exp(-12*t)`, tags: 'queda batida grave' },
  { id: 'boom', label: 'Boom grave', icon: '🔊', dur: 2.2, expr: `(0.9*sin(2*PI*38*t)+0.4*sin(2*PI*76*t))*exp(-2*t)`, post: 'lowpass=f=400', tags: 'trailer revelação' },
  { id: 'riser', label: 'Subida (riser)', icon: '📈', dur: 2, expr: `(0.35*sin(2*PI*(150*t+150*t*t))+0.25*${N})*(t/2)`, post: 'highpass=f=200', tags: 'tensão antecipação' },
  { id: 'drop', label: 'Descida', icon: '📉', dur: 1.5, expr: `0.5*sin(2*PI*(900*t-250*t*t))*exp(-1.5*t)`, tags: 'queda fim' },
  { id: 'click', label: 'Clique', icon: '🖱️', dur: 0.08, expr: `0.9*${N}*exp(-400*t)`, post: 'highpass=f=1500', tags: 'interface' },
  { id: 'pop', label: 'Pop', icon: '🫧', dur: 0.25, expr: `0.8*sin(2*PI*(400*t+30*(1-exp(-30*t))))*exp(-25*t)`, tags: 'aparecer texto ícone' },
  { id: 'ding', label: 'Ding', icon: '🔔', dur: 1.5, expr: `0.5*sin(2*PI*1320*t)*exp(-3*t)+0.25*sin(2*PI*2640*t)*exp(-5*t)`, tags: 'acerto ideia' },
  { id: 'chime', label: 'Carrilhão', icon: '🎐', dur: 1.8, expr: `0.3*sin(2*PI*1046*t)*exp(-3*t)+0.3*gte(t,0.12)*sin(2*PI*1318*(t-0.12))*exp(-3*(t-0.12))+0.3*gte(t,0.24)*sin(2*PI*1568*(t-0.24))*exp(-3*(t-0.24))`, tags: 'descoberta mágico' },
  { id: 'notify', label: 'Notificação', icon: '📳', dur: 0.6, expr: `0.5*lt(t,0.12)*sin(2*PI*880*t)+0.5*gte(t,0.12)*sin(2*PI*1320*t)*exp(-8*(t-0.12))`, tags: 'alerta dado' },
  { id: 'sparkle', label: 'Brilho', icon: '✨', dur: 1.5, expr: `0.3*sin(2*PI*(2200*t+100*sin(2*PI*7*t)))*exp(-2*t)`, tags: 'mágico destaque' },
  { id: 'heartbeat', label: 'Batimento', icon: '❤️', dur: 1.6, expr: `0.9*sin(2*PI*50*t)*(exp(-25*mod(t,0.8))+0.7*gte(mod(t,0.8),0.22)*exp(-25*(mod(t,0.8)-0.22)))`, tags: 'tensão corpo vida' },
  { id: 'tick', label: 'Relógio', icon: '⏱️', dur: 2, expr: `0.7*${N}*exp(-600*mod(t,0.5))`, post: 'highpass=f=2000', tags: 'tempo passagem anos' },
  { id: 'typing', label: 'Digitação', icon: '⌨️', dur: 1.5, expr: `0.6*${N}*exp(-500*mod(t,0.13))`, post: 'highpass=f=1200', tags: 'texto computador' },
  { id: 'shutter', label: 'Câmera (foto)', icon: '📸', dur: 0.3, expr: `0.8*${N}*(exp(-200*t)+gte(t,0.09)*exp(-200*(t-0.09)))`, post: 'highpass=f=800', tags: 'foto registro' },
  { id: 'page', label: 'Virar página', icon: '📄', dur: 0.35, expr: `0.6*${N}*pow(sin(PI*t/0.35),2)`, post: 'bandpass=f=3000:w=2500', tags: 'livro capítulo' },
  { id: 'crunch', label: 'Mordida/crocante', icon: '🦷', dur: 0.4, expr: `0.8*${N}*(exp(-40*t)+0.7*gte(t,0.07)*exp(-50*(t-0.07))+0.5*gte(t,0.16)*exp(-60*(t-0.16)))`, post: 'bandpass=f=2500:w=3000', tags: 'mastigar dente comida' },
  { id: 'chew', label: 'Mastigação', icon: '😬', dur: 1.8, expr: `0.6*${N}*exp(-30*mod(t,0.45))`, post: 'bandpass=f=1500:w=2000', tags: 'mastigar dente comida' },
  { id: 'stone', label: 'Pedra batendo', icon: '🪨', dur: 0.35, expr: `0.8*(0.5*sin(2*PI*1800*t)+${N})*exp(-60*t)`, post: 'bandpass=f=1500:w=1500', tags: 'ferramenta pré-histórico' },
  { id: 'bones', label: 'Ossos/chocalho', icon: '🦴', dur: 0.8, expr: `0.7*${N}*gt(random(1),0.96)`, post: 'highpass=f=1500', tags: 'esqueleto fóssil' },
  { id: 'dig', label: 'Escavar/raspar', icon: '⛏️', dur: 0.7, expr: `0.5*${N}*pow(sin(PI*t/0.7),2)`, post: 'bandpass=f=800:w=1000', tags: 'arqueologia terra' },
  { id: 'footsteps', label: 'Passos', icon: '👣', dur: 2.2, expr: `0.8*${N}*exp(-60*mod(t,0.55))`, post: 'lowpass=f=900', tags: 'andar chegada' },
  { id: 'fire', label: 'Fogueira', icon: '🔥', dur: 3, expr: `0.12*${N}+0.8*(random(1)*2-1)*gt(random(2),0.995)`, post: 'lowpass=f=3500', tags: 'acampamento caverna' },
  { id: 'wind', label: 'Vento', icon: '🍃', dur: 4, expr: `0.5*${N}*(0.6+0.4*sin(2*PI*0.3*t))*sin(PI*t/4)`, post: 'lowpass=f=600', tags: 'natureza paisagem' },
  { id: 'rumble', label: 'Rumor/terremoto', icon: '🌋', dur: 3, expr: `0.8*${N}*sin(PI*t/3)`, post: 'lowpass=f=120', tags: 'tensão terra' },
  { id: 'bubble', label: 'Bolhas', icon: '🫧', dur: 1, expr: `0.5*sin(2*PI*(300+2400*mod(t,0.25))*t)*exp(-15*mod(t,0.25))`, tags: 'água química' },
  { id: 'glitch', label: 'Glitch digital', icon: '📺', dur: 0.6, expr: `0.5*sgn(sin(2*PI*(220+40*random(0))*t))*gt(sin(2*PI*13*t),0)`, tags: 'erro tecnologia' },
  { id: 'swell', label: 'Pad ambiente', icon: '🌅', dur: 4, expr: `0.22*(sin(2*PI*110*t)+sin(2*PI*165*t)+0.5*sin(2*PI*220*t))*sin(PI*t/4)`, tags: 'abertura emoção' },
  { id: 'gong', label: 'Gongo', icon: '🪘', dur: 4, expr: `0.45*(sin(2*PI*110*t)+0.6*sin(2*PI*247*t)+0.4*sin(2*PI*392*t))*exp(-1.2*t)`, tags: 'abertura capítulo solene' },
];

/** Nomes comuns usados por cenas de código / mgaudio → efeito equivalente da biblioteca. */
const ALIASES: Record<string, string> = {
  swish: 'swoosh', swipe: 'swoosh', transition: 'whoosh', hit: 'impact', punch: 'impact', slam: 'impact', text_hit: 'impact', sub_drop: 'boom', downlifter: 'drop',
  charge: 'riser', swell: 'riser', reverse_cymbal: 'riser', blip: 'click', tick_clock: 'tick', toggle: 'click', ui: 'notify', hud_beep: 'notify', hud_ping: 'ding',
  coin: 'ding', shimmer: 'sparkle', shimmer_hit: 'sparkle', magic: 'sparkle', bubble: 'pop', boing: 'pop', sproing: 'pop', cork_pop: 'pop', sticker_slap: 'thud',
  stamp: 'thud', paper: 'page', flip: 'page', typewriter: 'typing', camera: 'shutter', laser: 'glitch', data: 'glitch', static: 'glitch', crash: 'impact', gong_hit: 'gong',
};
export const sfxDef = (id: string) => { const k = id.trim().toLowerCase(); return SFX_LIBRARY.find((d) => d.id === k) ?? SFX_LIBRARY.find((d) => d.id === ALIASES[k]); };

/** Sons que a própria cena por código declarou (window.__forge.sfx → clips/*.sfx.json), no instante exato da animação. */
export function codeCues(sceneDir: string): SfxCue[] {
  const out: SfxCue[] = [];
  for (const f of ['clips/code.sfx.json', 'clips/motion.sfx.json']) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(sceneDir, f), 'utf8')) as Array<{ t?: number; at?: number; time?: number; name?: string; sfx?: string; gain?: number }>;
      for (const x of list) {
        const d = sfxDef(String(x.name ?? x.sfx ?? ''));
        const at = Number(x.t ?? x.at ?? x.time);
        if (d && Number.isFinite(at)) out.push({ name: d.id, at: Math.max(0, at), gain: Number.isFinite(Number(x.gain)) ? Math.min(2, Math.max(0, Number(x.gain))) : undefined });
      }
    } catch { /* cena sem sons declarados */ }
  }
  return out;
}

/** Todos os sons da cena: os declarados pelo código (programáticos) + os do plano/editor, sem duplicar. */
export function sceneCues(scene: Pick<Scene, 'sfx' | 'sfxCues'>, sceneDir: string): SfxCue[] {
  const code = codeCues(sceneDir);
  const rest = parseCues(scene).filter((c) => !code.some((k) => k.name === c.name && (c.at === undefined || Math.abs((k.at ?? 0) - c.at) < 0.3)));
  return [...code, ...rest].slice(0, 24);
}

/** Gera um efeito da biblioteca como WAV mono 44,1 kHz. */
export async function renderSfx(ffmpeg: string, id: string, out: string, signal?: AbortSignal): Promise<number> {
  const d = sfxDef(id);
  if (!d) throw new Error(`efeito sonoro desconhecido: ${id}`);
  const src = `aevalsrc='${d.expr}':s=44100:d=${d.dur}` + (d.post ? `,${d.post}` : '') + `,afade=t=out:st=${Math.max(0, d.dur - 0.05).toFixed(3)}:d=0.05`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await writeAtomic(out, (tmp) => runSfx(ffmpeg, ['-y', '-f', 'lavfi', '-i', src, '-ac', '1', '-ar', '44100', tmp], signal));
  return d.dur;
}

const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

/** Converte nomes soltos ("whoosh", "impact@2.5", "ding:dentes") e cues num formato único. */
export function parseCues(scene: Pick<Scene, 'sfx' | 'sfxCues'>): SfxCue[] {
  const out: SfxCue[] = [];
  for (const c of scene.sfxCues ?? []) if (c && sfxDef(String(c.name ?? ''))) out.push({ ...c, name: sfxDef(c.name)!.id });
  for (const raw of scene.sfx ?? []) {
    const m = /^\s*([\w-]+)\s*(?:@\s*([\d.]+)|:\s*(.+))?\s*$/.exec(String(raw));
    if (m && sfxDef(m[1]!)) out.push({ name: sfxDef(m[1]!)!.id, at: m[2] ? Number(m[2]) : undefined, word: m[3]?.trim() });
  }
  return out;
}

/** Instante de cada cue: `at` direto, `word` pela transcrição, senão espalhado pela cena. */
export function cueTimes(cues: SfxCue[], seconds: number, words: WordTime[] = []): number[] {
  return cues.map((c, i) => {
    if (typeof c.at === 'number' && Number.isFinite(c.at)) return Math.max(0, Math.min(seconds - 0.05, c.at));
    if (c.word) {
      const target = c.word.split(/\s+/).map(norm).filter(Boolean);
      const idx = words.findIndex((w, k) => target.every((t, j) => norm(words[k + j]?.w ?? '').startsWith(t)));
      if (idx >= 0) return Math.max(0, words[idx]!.start - 0.08);
    }
    return cues.length === 1 ? 0 : (seconds * i) / cues.length;
  });
}

/** Mixa os cues da cena numa faixa WAV do tamanho da cena (para somar à narração na montagem). */
export async function buildSceneSfx(ffmpeg: string, cues: SfxCue[], times: number[], seconds: number, out: string, tmpDir: string, signal?: AbortSignal): Promise<void> {
  if (!cues.length) throw new Error('cena sem efeitos sonoros');
  fs.mkdirSync(tmpDir, { recursive: true });
  const files: string[] = [];
  for (const c of cues) {
    const f = path.join(tmpDir, `${c.name}.wav`);
    if (!validWav(f)) await renderSfx(ffmpeg, c.name, f, signal);
    files.push(f);
  }
  /* cada efeito já sai do tamanho exato da cena (apad finito + atrim) e só então é misturado: o "amix → apad sem fim →
     atrim" antigo travava o ffmpeg para sempre em algumas combinações (parava em 256 KB, ~1,5 s, no fim do efeito longo) */
  const sec = Math.max(0.1, seconds).toFixed(3);
  const parts = cues.map((c, i) => { const ms = Math.round(times[i]! * 1000); return `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${(c.gain ?? 1).toFixed(2)},adelay=${ms}|${ms},apad=whole_dur=${sec},atrim=end=${sec}[a${i}]`; });
  const mix = `${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:duration=longest:normalize=0[o]`;
  await writeAtomic(out, (tmp) => runSfx(ffmpeg, ['-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', [...parts, mix].join(';'), '-map', '[o]', '-ac', '2', '-ar', '44100', tmp], signal));
}

/** WAV utilizável: existe, passa do cabeçalho e começa com RIFF/WAVE (um ffmpeg interrompido deixa 0 bytes). */
export function validWav(f: string): boolean {
  try {
    const st = fs.statSync(f);
    if (!st.isFile() || st.size <= 44) return false;
    const b = Buffer.alloc(12);
    const fd = fs.openSync(f, 'r');
    try { fs.readSync(fd, b, 0, 12, 0); } finally { fs.closeSync(fd); }
    return b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE';
  } catch { return false; }
}

/**
 * ffmpeg dos efeitos com prazo curto (45 s cada) e uma nova tentativa: um processo travado (disco ou antivírus
 * segurando o arquivo) não consome mais o prazo inteiro da etapa — a mixagem de uma cena leva menos de 1 s.
 */
async function runSfx(ffmpeg: string, args: string[], signal?: AbortSignal): Promise<unknown> {
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    if (signal?.aborted) throw new Error('abortado');
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000);
    try { return await ff.run(ffmpeg, args, sig); } catch (e) { last = e; if (signal?.aborted) throw e; }
  }
  throw last;
}

/** Grava num temporário e só troca o arquivo final se deu certo: falha ou aborto não deixam saída parcial. */
async function writeAtomic(out: string, write: (tmp: string) => Promise<unknown>): Promise<void> {
  const tmp = path.join(path.dirname(out), `.part-${path.basename(out)}`);
  try {
    await write(tmp);
    if (!validWav(tmp)) throw new Error(`ffmpeg não gerou um WAV válido: ${path.basename(out)}`);
    fs.renameSync(tmp, out);
  } finally { try { fs.rmSync(tmp, { force: true }); } catch { /* ok */ } }
}

/** Sem cues definidos: escolhe pelo texto da cena (até 2 efeitos) com um whoosh de entrada. */
export function autoCues(scene: Pick<Scene, 'narration' | 'visualIntent' | 'title' | 'index'>): SfxCue[] {
  const text = norm(`${scene.title} ${scene.narration} ${scene.visualIntent}`.replace(/\s+/g, '_'));
  const scored = SFX_LIBRARY.filter((d) => !['whoosh', 'swoosh'].includes(d.id))
    .map((d) => ({ d, n: d.tags.split(' ').filter((t) => t.length > 3 && text.includes(norm(t))).length }))
    .filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 1);
  return [{ name: scene.index === 1 ? 'swell' : 'whoosh', at: 0, gain: 0.7 }, ...scored.map((x) => ({ name: x.d.id, at: 1.2 }))];
}

/** Monta audio/sfx.wav de uma cena (fora da rota: editor). Sem cues, apaga a faixa. Devolve o resumo. */
export async function applySceneSfx(ffmpeg: string, ffprobe: string, sceneDir: string, scene: Scene): Promise<string> {
  const out = path.join(sceneDir, 'audio', 'sfx.wav');
  const cues = sceneCues(scene, sceneDir);
  if (!cues.length) { fs.rmSync(out, { force: true }); return 'sem efeitos'; }
  const adir = path.join(sceneDir, 'audio');
  const narr = fs.existsSync(adir) ? fs.readdirSync(adir).find((x) => x.startsWith('narration.') && !x.includes('.trim')) : undefined;
  const d = narr ? await ff.duration(ffprobe, path.join(adir, narr)) : 0;
  const seconds = scene.manualDuration && scene.durationSec ? scene.durationSec : d > 0.2 ? d + 0.15 : scene.durationSec ?? 4;
  let words: WordTime[] = [];
  try { words = (JSON.parse(fs.readFileSync(path.join(adir, 'words.json'), 'utf8')) as { words?: WordTime[] }).words ?? []; } catch { /* sem transcrição */ }
  const times = cueTimes(cues, seconds, words);
  await buildSceneSfx(ffmpeg, cues, times, seconds, out, path.join(adir, 'sfx-parts'));
  return cues.map((x, i) => `${x.name}@${times[i]!.toFixed(1)}s`).join(', ');
}

/** Lista para os prompts das IAs: "whoosh (transição passagem), impact (...)". */
export const sfxCatalogText = () => SFX_LIBRARY.map((d) => `${d.id} (${d.tags})`).join(', ');
