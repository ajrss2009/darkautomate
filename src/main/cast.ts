import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CastMember, Project, Scene } from '../shared/types';
import { characterSheet } from './prompts';

/**
 * Elenco de histórias e doramas: a bíblia de personagens (assets/assets.md) define aparência e voz de cada um.
 * - "## Personagens fixos": "- **Nome**: aparência" (já usada nos prompts de imagem)
 * - "## Vozes": "- **Nome**: feminina, 20 anos, voz doce e hesitante"
 * O FilmForge monta o elenco do projeto a partir dela (uma voz distinta por personagem) e usa os
 * retratos dos personagens como referência no MiniMax H3 ref2video.
 */

export type Gender = 'f' | 'm' | '?';

export function voiceSheet(projectDir: string): Array<{ name: string; voice: string }> {
  try {
    const md = fs.readFileSync(path.join(projectDir, 'assets', 'assets.md'), 'utf8');
    const at = md.search(/^#+\s*Vozes/im);
    if (at < 0) return [];
    const rest = md.slice(at).split('\n').slice(1);
    const end = rest.findIndex((l) => /^#+\s/.test(l));
    return (end < 0 ? rest : rest.slice(0, end)).map((l) => /^\s*[-*]\s*\*\*([^*]+)\*\*\s*[:—–-]\s*(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ name: m[1]!.trim().replace(/:$/, ''), voice: m[2]!.trim() }));
  } catch { return []; }
}

/* \b do JS só entende ASCII: "moça", "avó" e "irmã" precisam de limites por letra Unicode */
const word = (alts: string) => new RegExp(`(?<!\\p{L})(${alts})(?!\\p{L})`, 'iu');
const FEM = word('feminin\\p{L}*|mulher|moça|menina|garota|senhora|idosa|avó|mãe|irmã|filha|female|woman|girl|lady|she|fem');
const MASC = word('masculin\\p{L}*|homem|rapaz|menino|garoto|senhor|idoso|avô|pai|irmão|filho|male|man|boy|guy|he|masc');
export function genderOf(text: string): Gender {
  const f = FEM.test(text), m = MASC.test(text);
  return f && !m ? 'f' : m && !f ? 'm' : '?';
}

/** Vozes de API distintas por gênero (OpenAI e Gemini); a narração só usa a que o provedor aceita. */
const API_VOICES: Record<Exclude<Gender, '?'>, string[]> = { f: ['nova', 'shimmer', 'coral', 'sage'], m: ['onyx', 'echo', 'ash', 'fable'] };

const GEMINI_VOICES: Record<Exclude<Gender, '?'>, string[]> = { f: ['Kore', 'Aoede', 'Leda', 'Zephyr'], m: ['Puck', 'Charon', 'Fenrir', 'Orus'] };

/**
 * Voz de API do personagem para ESTE provedor: as vozes do elenco são nomes da OpenAI; no Gemini viram
 * uma voz Gemini do mesmo gênero (distinta por posição no elenco). Fish usa a voz da conta.
 */
export function castApiVoice(kind: string, cast: CastMember[], member: CastMember): string | undefined {
  if (kind === 'fish') return undefined;
  if (kind !== 'gemini') return member.voice;
  const g = genderOf(`${member.description ?? ''} ${member.voice && API_VOICES.f.includes(member.voice) ? 'female' : member.voice && API_VOICES.m.includes(member.voice) ? 'male' : ''}`);
  const same = cast.filter((m) => g === '?' || genderOf(`${m.description ?? ''} ${m.voice && API_VOICES.f.includes(m.voice) ? 'female' : m.voice && API_VOICES.m.includes(m.voice) ? 'male' : ''}`) === g);
  const pool = g === '?' ? [...GEMINI_VOICES.f, ...GEMINI_VOICES.m] : GEMINI_VOICES[g];
  return pool[Math.max(0, same.indexOf(member)) % pool.length];
}

const norm = (s: string) => s.trim().toLowerCase();
const isNarrator = (s: string) => /^(narrador|narradora|narrator|narração)$/i.test(s.trim());

/** "NOME: fala" → { speaker, text }. Nome curto; usado no plano e na fala (sem falar o nome em voz alta). */
export function splitSpeakerTag(line: string): { speaker?: string; text: string } {
  const s = (line ?? '').trim();
  /* nomes de personagem: 1 a 3 palavras, cada uma começando com maiúscula (evita "Veja bem: ...") */
  const m = /^([\p{Lu}][\p{L}\d'’-]*(?:\s+[\p{Lu}][\p{L}\d'’-]*){0,2})\s*:\s+([\s\S]+)$/u.exec(s);
  if (!m) return { text: s };
  const name = m[1]!.trim();
  if (name.split(/\s+/).length > 4) return { text: s };
  return { speaker: name, text: m[2]!.trim() };
}

/** Texto que o TTS fala: tira o prefixo "NOME:" quando é o próprio falante (legado ou modelo teimoso). */
export function spokenText(scene: Pick<Scene, 'narration' | 'speaker'>): string {
  const raw = (scene.narration ?? '').trim();
  if (!raw) return raw;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  /* uma fala por cena: remove só o prefixo do falante desta cena */
  if (lines.length === 1 && scene.speaker) {
    const tag = splitSpeakerTag(lines[0]!);
    if (tag.speaker && norm(tag.speaker) === norm(scene.speaker)) return tag.text;
  }
  return raw;
}


/**
 * Completa o elenco do projeto: um membro por personagem da bíblia (e por "speaker" das cenas),
 * com aparência fixa, voz de referência (arquivo da pasta voices, preferindo o gênero certo, sem repetir)
 * e voz de API distinta. Membros já configurados pelo usuário nunca são alterados.
 * Devolve os nomes adicionados.
 */
export function autoCast(project: Project, projectDir: string, voiceFiles: string[]): string[] {
  const looks = characterSheet(projectDir);
  const voices = voiceSheet(projectDir);
  const names: string[] = [];
  const add = (n: string) => { if (n.trim() && !names.some((x) => norm(x) === norm(n))) names.push(n.trim()); };
  for (const s of project.scenes) {
    if (s.speaker) add(s.speaker);
    /* fala no formato "NOME: ..." (planos antigos ou modelo teimoso): o nome também é elenco */
    for (const line of (s.narration ?? '').split(/\r?\n/)) { const tag = splitSpeakerTag(line); if (tag.speaker) add(tag.speaker); }
  }
  for (const ch of looks) add(ch.name);
  for (const v of voices) add(v.name);
  const cast: CastMember[] = [...(project.cast ?? [])];
  const usedRef = new Set(cast.map((m) => m.refAudio).filter(Boolean));
  const usedApi = new Set(cast.map((m) => m.voice).filter(Boolean));
  const added: string[] = [];
  const fillVoice = (name: string): { refAudio?: string; voice?: string } => {
    const look = looks.find((x) => norm(x.name) === norm(name))?.look;
    const vdesc = voices.find((x) => norm(x.name) === norm(name))?.voice ?? '';
    const g = genderOf(`${vdesc} ${look ?? ''}`);
    const fileG = (f: string) => genderOf(path.basename(f).replace(/[_.-]+/g, ' '));
    const free = voiceFiles.filter((f) => !usedRef.has(f));
    const ref = (g !== '?' ? free.find((f) => fileG(f) === g) : undefined) ?? free.find((f) => fileG(f) === '?') ?? (isNarrator(name) ? undefined : free[0]);
    if (ref) usedRef.add(ref);
    const pool = g === '?' ? [...API_VOICES.f, ...API_VOICES.m] : API_VOICES[g];
    const api = pool.find((v) => !usedApi.has(v)) ?? pool[0];
    if (api) usedApi.add(api);
    return { refAudio: ref, voice: api };
  };
  /* membro já existente (o usuário escolheu nome/aparência): completa só o que falta */
  for (const m of cast) {
    if (m.refAudio || m.voice) continue;
    const v = fillVoice(m.speaker);
    m.refAudio = v.refAudio;
    m.voice = v.voice;
  }
  for (const name of names) {
    if (cast.some((m) => norm(m.speaker) === norm(name))) continue;
    const look = looks.find((x) => norm(x.name) === norm(name))?.look;
    const vdesc = voices.find((x) => norm(x.name) === norm(name))?.voice ?? '';
    const v = fillVoice(name);
    cast.push({ speaker: name, ...v, description: [look, vdesc && `voz: ${vdesc}`].filter(Boolean).join(' - ') || undefined });
    added.push(name);
  }
  if (cast.length) project.cast = cast;
  return added;
}

/** Personagens que aparecem na cena: quem fala primeiro, depois os citados no visual/narração (na ordem da bíblia). */
export function charactersInScene(projectDir: string, scene: Pick<Scene, 'speaker' | 'visualIntent' | 'narration'> & { videoPrompt?: string }, max = 2): Array<{ name: string; look: string }> {
  const sheet = characterSheet(projectDir);
  const text = `${scene.visualIntent ?? ''} ${scene.videoPrompt ?? ''} ${scene.narration ?? ''}`.toLowerCase();
  const out: Array<{ name: string; look: string }> = [];
  const sp = scene.speaker ? sheet.find((ch) => norm(ch.name) === norm(scene.speaker!)) : undefined;
  if (sp) out.push(sp);
  for (const ch of sheet) {
    if (out.includes(ch)) continue;
    if (ch.name.split(/\s+/).some((w) => w.length > 2 && word(w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(text))) out.push(ch);
  }
  return out.slice(0, max);
}

export const portraitFile = (projectDir: string, name: string) =>
  path.join(projectDir, 'assets', 'characters', `${name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'personagem'}.png`);

export const portraitPrompt = (ch: { name: string; look: string }, style = '') =>
  `Character reference sheet portrait of ${ch.name}: ${ch.look}. Single person, front view, head to knees, neutral expression, plain light grey studio background, soft even light, sharp focus, no text.${style ? ` Style: ${style}` : ''}`;

/** Texto do MiniMax H3 ref2video: <Picture 1> = quadro da cena; <Picture 2..> = retratos do elenco. */
export function castRefPrompt(prompt: string, chars: Array<{ name: string; look: string }>): string {
  const subjects = chars.map((ch, i) => `<Subject ${i + 1}> is ${ch.name}, the person in <Picture ${i + 2}> (${ch.look}); preserve face, hair, body and outfit exactly from <Picture ${i + 2}>.`).join('\n');
  return `subject_definitions:\n\n<Picture 1> is the scene composition (setting, framing, light and positions) to follow.\n${subjects}\n\nsummary:\n\n[reference generation] ${prompt}\n\n` +
    `detailed_description:\n\n${prompt} Keep every subject identical to its reference picture in every frame.\n\noverall_soundscape:\n\nSubtle ambient sound that fits the scene. No speech.\n\nnon_diegetic_music:\n\nNone.`;
}

type Graph = Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
/** Acrescenta as imagens do elenco ao nó MiniMaxH3ReferenceToVideo (ref_image_1, ref_image_2…) e troca o texto. */
export function injectCastRefs(graph: Graph, uploads: string[], chars: Array<{ name: string; look: string }>, prompt: string): boolean {
  const id = Object.keys(graph).find((k) => graph[k]?.class_type === 'MiniMaxH3ReferenceToVideo');
  if (!id || !uploads.length) return false;
  const node = graph[id]!; node.inputs ??= {};
  uploads.forEach((file, i) => {
    const nid = String(900 + i);
    graph[nid] = { class_type: 'LoadImage', inputs: { image: file } };
    node.inputs![`ref_images.ref_image_${i + 1}`] = [nid, 0];
  });
  node.inputs.prompt = castRefPrompt(prompt, chars.slice(0, uploads.length));
  return true;
}
