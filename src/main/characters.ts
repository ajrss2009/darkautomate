import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Attachment, Binding, CastMember, LibraryCharacter, Project, ProjectCharacter, RouteStep, Settings } from '../shared/types';
import type { Executor } from './engine';

/*
 * BIBLIOTECA DE PERSONAGENS (workspace/library/characters/<id>/character.json + imagens).
 * Mesmo método dos doramas feitos com IA: cada personagem tem uma FOLHA DE PERSONAGEM (frente, perfil, costas e
 * expressões, fundo neutro) que vai como referência de imagem em toda cena; a aparência fixa e a voz também.
 * Ao criar um projeto com personagens da biblioteca, o app:
 *  - copia a folha/retrato para o projeto como "foto de personagem" (o MiniMax H3, o Wan2GP e o retrato já usam);
 *  - preenche o ELENCO (voz de referência para clonagem, voz de API e descrição);
 *  - escreve a bíblia (assets/assets.md: "Personagens fixos" e "Vozes") que trava a aparência nos prompts;
 *  - congela uma cópia no projeto (project.characters) para os prompts de roteiro, plano e cenas por código.
 */

export const charactersRoot = (s: Settings) => path.join(s.workspace, 'library', 'characters');
const SAFE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const charDir = (s: Settings, id: string) => { if (!SAFE.test(id)) throw new Error(`personagem inválido: ${id}`); return path.join(charactersRoot(s), id); };
export const slugChar = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'personagem';
const KINDS: LibraryCharacter['kind'][] = ['pessoa', 'cartoon', 'codigo', 'animal', 'outro'];
const IMG = /\.(png|jpe?g|webp)$/i;

export function listCharacters(s: Settings): LibraryCharacter[] {
  const root = charactersRoot(s);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((d) => SAFE.test(d)).map((d) => readChar(s, d)).filter((x): x is LibraryCharacter => !!x)
    .sort((a, b) => a.name.localeCompare(b.name));
}
function readChar(s: Settings, id: string): LibraryCharacter | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(charDir(s, id), 'character.json'), 'utf8')) as LibraryCharacter; } catch { return undefined; }
}
export function getCharacter(s: Settings, id: string): LibraryCharacter {
  const c = readChar(s, id);
  if (!c) throw new Error(`personagem não encontrado: ${id}`);
  return c;
}
/** Caminho absoluto de um arquivo do personagem (ou undefined se não existe). */
export const charFile = (s: Settings, c: Pick<LibraryCharacter, 'id'>, rel?: string) => {
  if (!rel) return undefined;
  const f = path.join(charDir(s, c.id), rel);
  return fs.existsSync(f) ? f : undefined;
};

const str = (v: unknown, n = 600) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);

/** Normaliza o que vem da interface (função pura). */
export function normalizeCharacter(raw: Partial<LibraryCharacter>): Omit<LibraryCharacter, 'id' | 'createdAt'> {
  const name = str(raw.name, 60);
  if (!name) throw new Error('o personagem precisa de um nome');
  const look = str(raw.look, 500);
  if (!look) throw new Error('descreva a aparência fixa do personagem (rosto, cabelo, corpo, roupa)');
  const v = raw.voice ?? {};
  const voice = { refAudio: str(v.refAudio, 400), apiVoice: str(v.apiVoice, 60), description: str(v.description, 200) };
  return {
    name, look, kind: KINDS.includes(raw.kind as LibraryCharacter['kind']) ? raw.kind! : 'pessoa',
    description: str(raw.description, 1500), gender: raw.gender === 'f' || raw.gender === 'm' ? raw.gender : undefined, age: str(raw.age, 30),
    voice: voice.refAudio || voice.apiVoice || voice.description ? voice : undefined, code: str(raw.code, 1500),
    sheet: str(raw.sheet, 200), portrait: str(raw.portrait, 200), images: Array.isArray(raw.images) ? raw.images.filter((x) => typeof x === 'string').slice(0, 12) : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : undefined,
  };
}

/** Cria (sem id) ou atualiza (com id) um personagem. */
export function saveCharacter(s: Settings, raw: Partial<LibraryCharacter>): LibraryCharacter {
  const n = normalizeCharacter(raw);
  let id = raw.id && SAFE.test(raw.id) && readChar(s, raw.id) ? raw.id : '';
  const prev = id ? readChar(s, id) : undefined;
  if (!id) { const base = slugChar(n.name); id = base; for (let k = 2; fs.existsSync(path.join(charactersRoot(s), id)); k++) id = `${base}-${k}`; }
  const c: LibraryCharacter = { ...prev, ...n, id, createdAt: prev?.createdAt ?? new Date().toISOString(), updatedAt: prev ? new Date().toISOString() : undefined,
    /* arquivos só mudam por addCharacterImage (a interface não manda caminhos arbitrários) */
    sheet: prev?.sheet, portrait: prev?.portrait, images: prev?.images };
  fs.mkdirSync(charDir(s, id), { recursive: true });
  fs.writeFileSync(path.join(charDir(s, id), 'character.json'), JSON.stringify(c, null, 2));
  return c;
}

export function deleteCharacter(s: Settings, id: string): void { fs.rmSync(charDir(s, id), { recursive: true, force: true }); }

/** Copia uma imagem para a pasta do personagem como folha, retrato ou extra. */
export function addCharacterImage(s: Settings, id: string, file: string, role: 'sheet' | 'portrait' | 'extra'): LibraryCharacter {
  const c = getCharacter(s, id);
  if (!IMG.test(file) || !fs.existsSync(file)) throw new Error('use uma imagem PNG, JPG ou WEBP');
  const ext = path.extname(file).toLowerCase();
  const name = role === 'extra' ? `extra-${Date.now()}${ext}` : `${role}${ext}`;
  if (role !== 'extra') for (const f of fs.readdirSync(charDir(s, id))) if (f.startsWith(`${role}.`)) fs.rmSync(path.join(charDir(s, id), f), { force: true });
  fs.copyFileSync(file, path.join(charDir(s, id), name));
  if (role === 'sheet') c.sheet = name; else if (role === 'portrait') c.portrait = name; else c.images = [...(c.images ?? []), name].slice(-12);
  c.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(charDir(s, id), 'character.json'), JSON.stringify(c, null, 2));
  return c;
}

/**
 * Pedido da FOLHA DE PERSONAGEM (o método dos doramas com IA): mesmo personagem de frente, perfil e costas em corpo
 * inteiro + 3 rostos com expressões, fundo neutro, sem texto — e aparência natural, que não lembre ninguém famoso
 * (o Google Flow recusa rostos parecidos com celebridades).
 */
export function sheetPrompt(c: Pick<LibraryCharacter, 'name' | 'look' | 'kind' | 'age' | 'gender'>, style = ''): string {
  const kindStyle = c.kind === 'cartoon' ? 'clean 2D cartoon style, consistent line art and flat colors' : c.kind === 'animal' ? 'consistent creature design' : c.kind === 'codigo' ? 'simple flat vector shapes, bold outlines, limited palette' : 'photorealistic, natural beauty, ordinary real person';
  return `Character reference sheet of ${c.name}: ${c.look}${c.age ? `, age ${c.age}` : ''}. ` +
    'Same character shown as: full body FRONT view, full body SIDE view, full body BACK view, and three close-up headshots with neutral, happy and sad expressions. ' +
    `Identical face, hair, body proportions and outfit in every view. Plain light grey background, soft even studio light, sharp focus, ${kindStyle}. ` +
    'No text, no labels, no watermark. The character must NOT resemble any real celebrity or famous person.' + (style ? ` Style: ${style}` : '');
}

/**
 * Gera a FOLHA DE PERSONAGEM com um executor de imagem real (ComfyUI, Wan2GP, API ou Google Flow), como a prévia de
 * voz faz com a narração: um projeto/cena descartáveis cujo visual é o pedido da folha. A imagem vira o `sheet`.
 */
export async function generateCharacterSheet(s: Settings, executors: Partial<Record<Binding['type'], Executor>>, id: string, binding: Binding, log: (l: string) => void = () => {}): Promise<LibraryCharacter> {
  const c = getCharacter(s, id);
  const exec = executors[binding.type];
  if (!exec || !['comfyui', 'wan2gp', 'api', 'flow'].includes(binding.type)) throw new Error('a folha é gerada com ComfyUI, Wan2GP, API de imagem ou Google Flow');
  const dir = path.join(charDir(s, id), 'gen', String(Date.now()));
  fs.mkdirSync(dir, { recursive: true });
  const prompt = sheetPrompt(c);
  const project = { id: `char-${id}`, name: c.name, idea: prompt, videoType: 'custom', aspect: '16:9', targetDurationSec: 8, language: 'pt-BR', quality: 'standard', memories: [], scenes: [], createdAt: new Date().toISOString() } as unknown as Project;
  const scene = { id: 'c01', index: 1, title: c.name, narration: '', visualIntent: prompt, kind: 'image', durationSec: 4, status: {}, artifacts: {} } as Project['scenes'][number];
  project.scenes = [scene];
  const step: RouteStep = { id: 'image', kind: 'image', label: 'folha de personagem', scope: 'scene', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 900, bindings: [binding] };
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 900_000);
  try {
    log(`folha de personagem de ${c.name}…`);
    const r = await exec({ project, projectDir: dir, step, binding, scene, sceneDir: dir, outDir: dir, settings: s, signal: ac.signal, log });
    const img = r.files.find((f) => IMG.test(f) && fs.existsSync(f));
    if (!img) throw new Error('o executor não devolveu imagem');
    return addCharacterImage(s, id, img, 'sheet');
  } finally { clearTimeout(timer); fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Cópia congelada para o projeto (função pura). */
export const toProjectCharacter = (c: LibraryCharacter): ProjectCharacter => ({ id: c.id, name: c.name, look: c.look, kind: c.kind, voice: c.voice, code: c.code, description: c.description });

/** Membro do elenco a partir do personagem (voz de referência, voz de API e descrição). */
export function castFromCharacter(c: Pick<LibraryCharacter, 'name' | 'look' | 'voice'>): CastMember {
  return { speaker: c.name, refAudio: c.voice?.refAudio, voice: c.voice?.apiVoice, description: [c.look, c.voice?.description && `voz: ${c.voice.description}`].filter(Boolean).join(' — ') || undefined };
}

/**
 * Bíblia do projeto (assets/assets.md) com os personagens da biblioteca: "## Personagens fixos" e "## Vozes".
 * Mantém o que já existe e acrescenta só quem falta (função pura sobre o texto).
 */
export function mergeBible(md: string, chars: Array<Pick<ProjectCharacter, 'name' | 'look' | 'voice'>>): string {
  let out = md.trim() ? md.replace(/\s+$/, '') + '\n' : '# Bíblia do projeto\n';
  const section = (title: string, lines: string[]) => {
    if (!lines.length) return;
    const re = new RegExp(`^#+\\s*${title}[^\\n]*$`, 'im');
    const m = re.exec(out);
    if (!m) { out += `\n## ${title}\n${lines.join('\n')}\n`; return; }
    const start = m.index + m[0].length;
    const rest = out.slice(start);
    const end = rest.search(/\n#+\s/);
    const body = end < 0 ? rest : rest.slice(0, end);
    const add = lines.filter((l) => { const name = /\*\*([^*]+)\*\*/.exec(l)?.[1]?.toLowerCase(); return name && !body.toLowerCase().includes(`**${name}**`); });
    if (!add.length) return;
    const insertAt = start + (end < 0 ? rest.length : end);
    out = out.slice(0, insertAt).replace(/\s+$/, '') + '\n' + add.join('\n') + '\n' + out.slice(insertAt);
  };
  section('Personagens fixos', chars.map((c) => `- **${c.name}**: ${c.look}`));
  section('Vozes', chars.filter((c) => c.voice?.description).map((c) => `- **${c.name}**: ${c.voice!.description}`));
  return out;
}

/**
 * Aplica os personagens da biblioteca a um projeto recém-criado (antes de gravar o project.json):
 * copia folha/retrato como "foto de personagem", completa elenco e bíblia e congela a lista.
 */
export function applyCharacters(s: Settings, p: Project, projectDir: string, ids: string[]): { warnings: string[] } {
  const warnings: string[] = [];
  const chars: LibraryCharacter[] = [];
  for (const id of [...new Set(ids)].slice(0, 12)) { try { chars.push(getCharacter(s, id)); } catch { warnings.push(`personagem não encontrado: ${id}`); } }
  if (!chars.length) return { warnings };
  const userDir = path.join(projectDir, 'assets', 'user', 'characters');
  const atts: Attachment[] = [...(p.attachments ?? [])];
  const cast: CastMember[] = [...(p.cast ?? [])];
  for (const c of chars) {
    const img = charFile(s, c, c.sheet) ?? charFile(s, c, c.portrait);
    if (img) {
      fs.mkdirSync(userDir, { recursive: true });
      const rel = `characters/${c.id}${path.extname(img).toLowerCase()}`;
      fs.copyFileSync(img, path.join(projectDir, 'assets', 'user', rel));
      if (!atts.some((a) => a.file === rel)) atts.push({ file: rel, kind: 'image', use: 'character', character: c.name, note: `${c.sheet ? 'Folha de personagem' : 'Retrato'} de ${c.name} (biblioteca): ${c.look}` });
    } else warnings.push(`${c.name} ainda não tem folha de personagem — o app gera um retrato na primeira cena`);
    if (!cast.some((m) => m.speaker.toLowerCase() === c.name.toLowerCase())) cast.push(castFromCharacter(c));
  }
  p.attachments = atts.length ? atts : undefined;
  p.cast = cast.length ? cast : undefined;
  p.characters = chars.map(toProjectCharacter);
  const bibleFile = path.join(projectDir, 'assets', 'assets.md');
  fs.mkdirSync(path.dirname(bibleFile), { recursive: true });
  fs.writeFileSync(bibleFile, mergeBible(fs.existsSync(bibleFile) ? fs.readFileSync(bibleFile, 'utf8') : '', p.characters));
  return { warnings };
}

const PLAN = new Set(['brief', 'script', 'scene_plan', 'asset_design', 'ideation']);
const CODE = new Set(['code_scene', 'motion_graphics', 'free']);
const VISUAL = new Set(['image', 'video', 'thumbnail']);

/** Bloco de personagens para o prompt de cada etapa (função pura). */
export function charactersPrompt(p: Pick<Project, 'characters'>, stepKind: string): string {
  const cs = p.characters ?? [];
  if (!cs.length) return '';
  if (PLAN.has(stepKind)) {
    const lines = cs.map((c) => `- **${c.name}** (${c.kind}): ${c.look}${c.voice?.description ? ` · voz: ${c.voice.description}` : ''}${c.description ? ` · ${c.description.slice(0, 200)}` : ''}`);
    return `PERSONAGENS DA BIBLIOTECA (são o elenco deste vídeo: use EXATAMENTE estes nomes e aparências; não troque roupa, cabelo nem idade; não invente outros protagonistas)${stepKind === 'asset_design' ? ' — na bíblia (assets.md) mantenha estas linhas em "## Personagens fixos" e "## Vozes"' : ''}${stepKind === 'scene_plan' ? ' — cada cena com fala indica o "speaker" pelo nome exato' : ''}:\n${lines.join('\n')}`;
  }
  if (CODE.has(stepKind)) {
    return `PERSONAGENS (desenhe sempre do mesmo jeito em todas as cenas):\n${cs.map((c) => `- ${c.name}: ${c.code || c.look}`).join('\n')}`;
  }
  if (VISUAL.has(stepKind)) return `SAME CHARACTERS, identical look in every shot: ${cs.map((c) => `${c.name} = ${c.look}`).join('; ')}`;
  return '';
}
