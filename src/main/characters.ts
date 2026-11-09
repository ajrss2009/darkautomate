import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Attachment, Binding, CastMember, CharacterVariant, LibraryCharacter, LibraryEntity, Project, ProjectCharacter, RouteStep, Scene, Settings } from '../shared/types';
import type { Executor } from './engine';

/*
 * BIBLIOTECA (workspace/library/characters/<id>/character.json + imagens): PERSONAGENS, CENÁRIOS e OBJETOS.
 * Mesmo método dos doramas feitos com IA: cada item tem uma FOLHA de referência que vai em toda cena —
 *  - personagem: frente, perfil, costas e expressões (fundo neutro);
 *  - objeto: três vistas (frente, lado, cima/trás) + detalhe;
 *  - cenário: plano geral, contraplano e detalhe com a MESMA planta, luz e objetos (o local fica igual em todas as cenas).
 * Personagens podem ter VARIAÇÕES (roupa, idade, ferimento) por episódio, cada uma com a própria folha.
 * Ao criar um projeto com itens da biblioteca, o app:
 *  - copia as folhas para o projeto (personagem = "foto de personagem" do MiniMax H3/Wan2GP/Flow; cenário/objeto = referência);
 *  - preenche o ELENCO (voz de referência para clonagem, voz de API e descrição);
 *  - escreve a bíblia (assets/assets.md: "Personagens fixos", "Cenários fixos", "Objetos fixos" e "Vozes");
 *  - congela uma cópia no projeto (project.characters) para os prompts de roteiro, plano e cenas.
 */

export const charactersRoot = (s: Settings) => path.join(s.workspace, 'library', 'characters');
const SAFE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const charDir = (s: Settings, id: string) => { if (!SAFE.test(id)) throw new Error(`item inválido: ${id}`); return path.join(charactersRoot(s), id); };
export const slugChar = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
const KINDS: LibraryCharacter['kind'][] = ['pessoa', 'cartoon', 'codigo', 'animal', 'outro'];
const ENTITIES: LibraryEntity[] = ['character', 'location', 'prop'];
const IMG = /\.(png|jpe?g|webp)$/i;
const MODEL = /\.(glb|gltf|obj|fbx)$/i;
export const entityOf = (c: Pick<LibraryCharacter, 'entity'>): LibraryEntity => c.entity ?? 'character';

export function listCharacters(s: Settings, entity?: LibraryEntity): LibraryCharacter[] {
  const root = charactersRoot(s);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((d) => SAFE.test(d)).map((d) => readChar(s, d)).filter((x): x is LibraryCharacter => !!x)
    .filter((x) => !entity || entityOf(x) === entity)
    .sort((a, b) => a.name.localeCompare(b.name));
}
function readChar(s: Settings, id: string): LibraryCharacter | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(charDir(s, id), 'character.json'), 'utf8')) as LibraryCharacter; } catch { return undefined; }
}
export function getCharacter(s: Settings, id: string): LibraryCharacter {
  const c = readChar(s, id);
  if (!c) throw new Error(`item da biblioteca não encontrado: ${id}`);
  return c;
}
/** Item pelo nome (ou apelido), sem diferenciar maiúsculas e acentos. */
export function findByName(list: LibraryCharacter[], name: string, entity?: LibraryEntity): LibraryCharacter | undefined {
  const k = slugChar(name);
  return list.find((c) => (!entity || entityOf(c) === entity) && (slugChar(c.name) === k || (c.aliases ?? []).some((a) => slugChar(a) === k)));
}
/** Caminho absoluto de um arquivo do item (ou undefined se não existe). */
export const charFile = (s: Settings, c: Pick<LibraryCharacter, 'id'>, rel?: string) => {
  if (!rel) return undefined;
  const f = path.join(charDir(s, c.id), rel);
  return fs.existsSync(f) ? f : undefined;
};

const str = (v: unknown, n = 600) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);

/** Variações normalizadas (rótulo + aparência; episódios opcionais). Função pura. */
export function normalizeVariants(raw: unknown, prev?: CharacterVariant[]): CharacterVariant[] | undefined {
  if (!Array.isArray(raw)) return prev;
  const seen = new Set<string>();
  const out: CharacterVariant[] = [];
  for (const x of raw.slice(0, 12)) {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const label = str(r['label'], 60), look = str(r['look'], 500);
    if (!label || !look) continue;
    const id = slugChar(label);
    if (seen.has(id)) continue;
    seen.add(id);
    const eps = Array.isArray(r['episodes']) ? (r['episodes'] as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100) : undefined;
    out.push({ id, label, look, episodes: eps?.length ? eps : undefined, sheet: prev?.find((v) => v.id === id)?.sheet });
  }
  return out.length ? out : undefined;
}

/** Normaliza o que vem da interface (função pura). */
export function normalizeCharacter(raw: Partial<LibraryCharacter>): Omit<LibraryCharacter, 'id' | 'createdAt'> {
  const entity: LibraryEntity = ENTITIES.includes(raw.entity as LibraryEntity) ? raw.entity! : 'character';
  const noun = entity === 'location' ? 'o cenário' : entity === 'prop' ? 'o objeto' : 'o personagem';
  const name = str(raw.name, 60);
  if (!name) throw new Error(`${noun} precisa de um nome`);
  const look = str(raw.look, 700);
  if (!look) throw new Error(entity === 'character' ? 'descreva a aparência fixa do personagem (rosto, cabelo, corpo, roupa)' : `descreva a aparência fixa ${entity === 'location' ? 'do cenário' : 'do objeto'} (formas, materiais, cores, luz)`);
  const v = raw.voice ?? {};
  const voice = { refAudio: str(v.refAudio, 400), apiVoice: str(v.apiVoice, 60), description: str(v.description, 200) };
  return {
    name, look, entity: entity === 'character' ? undefined : entity, kind: KINDS.includes(raw.kind as LibraryCharacter['kind']) ? raw.kind! : entity === 'character' ? 'pessoa' : 'outro',
    description: str(raw.description, 1500), gender: entity === 'character' && (raw.gender === 'f' || raw.gender === 'm') ? raw.gender : undefined, age: entity === 'character' ? str(raw.age, 30) : undefined,
    voice: entity === 'character' && (voice.refAudio || voice.apiVoice || voice.description) ? voice : undefined, code: str(raw.code, 1500),
    sheet: str(raw.sheet, 200), portrait: str(raw.portrait, 200), images: Array.isArray(raw.images) ? raw.images.filter((x) => typeof x === 'string').slice(0, 12) : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : undefined,
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : undefined,
    variants: entity === 'character' ? normalizeVariants(raw.variants) : undefined,
    storyId: str(raw.storyId, 64),
  };
}

/** Cria (sem id) ou atualiza (com id) um item. */
export function saveCharacter(s: Settings, raw: Partial<LibraryCharacter>): LibraryCharacter {
  const n = normalizeCharacter(raw);
  let id = raw.id && SAFE.test(raw.id) && readChar(s, raw.id) ? raw.id : '';
  const prev = id ? readChar(s, id) : undefined;
  if (!id) { const base = slugChar(n.name); id = base; for (let k = 2; fs.existsSync(path.join(charactersRoot(s), id)); k++) id = `${base}-${k}`; }
  const c: LibraryCharacter = { ...prev, ...n, id, createdAt: prev?.createdAt ?? new Date().toISOString(), updatedAt: prev ? new Date().toISOString() : undefined,
    /* arquivos só mudam por addCharacterImage (a interface não manda caminhos arbitrários) */
    sheet: prev?.sheet, portrait: prev?.portrait, images: prev?.images, models: prev?.models,
    variants: raw.variants === undefined ? prev?.variants : normalizeVariants(raw.variants, prev?.variants),
    storyId: n.storyId ?? prev?.storyId };
  if (!c.variants) delete c.variants;
  fs.mkdirSync(charDir(s, id), { recursive: true });
  fs.writeFileSync(path.join(charDir(s, id), 'character.json'), JSON.stringify(c, null, 2));
  return c;
}

/** Copia um modelo 3D (GLB/GLTF/OBJ/FBX) para a pasta do item — usado pelas cenas feitas por código (Three.js). */
export function addCharacterModel(s: Settings, id: string, file: string): LibraryCharacter {
  const c = getCharacter(s, id);
  if (!MODEL.test(file) || !fs.existsSync(file)) throw new Error('use um modelo 3D GLB, GLTF, OBJ ou FBX');
  const name = `model-${slugChar(path.basename(file, path.extname(file)))}${path.extname(file).toLowerCase()}`;
  fs.copyFileSync(file, path.join(charDir(s, id), name));
  /* .gltf com .bin/texturas ao lado: copia os arquivos que ele cita */
  if (/\.gltf$/i.test(file)) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };
      for (const u of [...(j.buffers ?? []), ...(j.images ?? [])].map((x) => x.uri).filter((x): x is string => !!x && !x.startsWith('data:') && !x.includes('..'))) {
        const src = path.join(path.dirname(file), u);
        if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(path.join(charDir(s, id), u)), { recursive: true }); fs.copyFileSync(src, path.join(charDir(s, id), u)); }
      }
    } catch { /* gltf ilegível: copia só ele */ }
  }
  c.models = [...new Set([...(c.models ?? []), name])].slice(-6);
  c.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(charDir(s, id), 'character.json'), JSON.stringify(c, null, 2));
  return c;
}
export function removeCharacterModel(s: Settings, id: string, name: string): LibraryCharacter {
  const c = getCharacter(s, id);
  if (!(c.models ?? []).includes(name)) throw new Error('modelo não encontrado');
  fs.rmSync(path.join(charDir(s, id), name), { force: true });
  c.models = (c.models ?? []).filter((x) => x !== name);
  if (!c.models.length) delete c.models;
  fs.writeFileSync(path.join(charDir(s, id), 'character.json'), JSON.stringify(c, null, 2));
  return c;
}

export function deleteCharacter(s: Settings, id: string): void { fs.rmSync(charDir(s, id), { recursive: true, force: true }); }

/** Copia uma imagem para a pasta do item como folha, retrato, extra ou folha de uma variação (`variant:<id>`). */
export function addCharacterImage(s: Settings, id: string, file: string, role: 'sheet' | 'portrait' | 'extra' | `variant:${string}`): LibraryCharacter {
  const c = getCharacter(s, id);
  if (!IMG.test(file) || !fs.existsSync(file)) throw new Error('use uma imagem PNG, JPG ou WEBP');
  const ext = path.extname(file).toLowerCase();
  const variant = role.startsWith('variant:') ? c.variants?.find((v) => v.id === role.slice(8)) : undefined;
  if (role.startsWith('variant:') && !variant) throw new Error('variação não encontrada');
  const base = variant ? `variant-${variant.id}` : role;
  const name = role === 'extra' ? `extra-${Date.now()}${ext}` : `${base}${ext}`;
  if (role !== 'extra') for (const f of fs.readdirSync(charDir(s, id))) if (f.startsWith(`${base}.`)) fs.rmSync(path.join(charDir(s, id), f), { force: true });
  fs.copyFileSync(file, path.join(charDir(s, id), name));
  if (variant) variant.sheet = name;
  else if (role === 'sheet') c.sheet = name; else if (role === 'portrait') c.portrait = name; else c.images = [...(c.images ?? []), name].slice(-12);
  c.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(charDir(s, id), 'character.json'), JSON.stringify(c, null, 2));
  return c;
}

/**
 * Pedido da FOLHA de referência (função pura):
 *  - personagem: frente, perfil e costas em corpo inteiro + 3 expressões, sem lembrar ninguém famoso
 *    (o Google Flow recusa rostos parecidos com celebridades);
 *  - objeto: três vistas ortográficas + detalhe, escala clara;
 *  - cenário: plano geral, contraplano e detalhe do MESMO lugar (mesma planta, luz e objetos).
 */
export function sheetPrompt(c: Pick<LibraryCharacter, 'name' | 'look' | 'kind' | 'age' | 'gender' | 'entity'>, style = '', variant?: Pick<CharacterVariant, 'label' | 'look'>): string {
  const kindStyle = c.kind === 'cartoon' ? 'clean 2D cartoon style, consistent line art and flat colors' : c.kind === 'animal' ? 'consistent creature design' : c.kind === 'codigo' ? 'simple flat vector shapes, bold outlines, limited palette' : 'photorealistic';
  const tail = 'No text, no labels, no watermark.' + (style ? ` Style: ${style}` : '');
  const e = entityOf(c);
  if (e === 'prop') {
    return `Prop reference sheet of "${c.name}": ${c.look}. Three orthographic views of the SAME object — FRONT view, SIDE view and TOP (or back) view — plus one close-up of its most distinctive detail. ` +
      `Identical shape, materials, colors and wear in every view; a small human hand silhouette for scale. Plain light grey background, even studio light, sharp focus, ${kindStyle === 'photorealistic' ? 'photorealistic product render' : kindStyle}. ${tail}`;
  }
  if (e === 'location') {
    return `Location reference sheet of "${c.name}": ${c.look}. The SAME place shown in three panels: a WIDE establishing shot, the REVERSE angle from the opposite side, and a close DETAIL of a key element. ` +
      `Identical layout, architecture, furniture, props, colors and lighting (same time of day) in every panel, no people. ${kindStyle === 'photorealistic' ? 'cinematic photorealistic' : kindStyle}. ${tail}`;
  }
  const look = variant ? `${variant.look} (variation "${variant.label}" of the same person: same face and body as always — ${c.look})` : c.look;
  return `Character reference sheet of ${c.name}: ${look}${c.age && !variant ? `, age ${c.age}` : ''}. ` +
    'Same character shown as: full body FRONT view, full body SIDE view, full body BACK view, and three close-up headshots with neutral, happy and sad expressions. ' +
    `Identical face, hair, body proportions and outfit in every view. Plain light grey background, soft even studio light, sharp focus, ${kindStyle === 'photorealistic' ? 'photorealistic, natural beauty, ordinary real person' : kindStyle}. ` +
    `${tail} The character must NOT resemble any real celebrity or famous person.`;
}

/**
 * Gera a FOLHA com um executor de imagem real (ComfyUI, Wan2GP, API ou Google Flow), como a prévia de voz faz com a
 * narração: um projeto/cena descartáveis cujo visual é o pedido da folha. A imagem vira o `sheet` (ou a folha da variação).
 */
export async function generateCharacterSheet(s: Settings, executors: Partial<Record<Binding['type'], Executor>>, id: string, binding: Binding, log: (l: string) => void = () => {}, variantId?: string): Promise<LibraryCharacter> {
  const c = getCharacter(s, id);
  const variant = variantId ? c.variants?.find((v) => v.id === variantId) : undefined;
  if (variantId && !variant) throw new Error('variação não encontrada');
  const exec = executors[binding.type];
  if (!exec || !['comfyui', 'wan2gp', 'api', 'flow'].includes(binding.type)) throw new Error('a folha é gerada com ComfyUI, Wan2GP, API de imagem ou Google Flow');
  const dir = path.join(charDir(s, id), 'gen', String(Date.now()));
  fs.mkdirSync(dir, { recursive: true });
  const prompt = sheetPrompt(c, '', variant);
  const project = { id: `char-${id}`, name: c.name, idea: prompt, videoType: 'custom', aspect: '16:9', targetDurationSec: 8, language: 'pt-BR', quality: 'standard', memories: [], scenes: [], createdAt: new Date().toISOString() } as unknown as Project;
  const scene = { id: 'c01', index: 1, title: c.name, narration: '', visualIntent: prompt, kind: 'image', durationSec: 4, status: {}, artifacts: {} } as Project['scenes'][number];
  project.scenes = [scene];
  const step: RouteStep = { id: 'image', kind: 'image', label: 'folha de referência', scope: 'scene', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 900, bindings: [binding] };
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 900_000);
  try {
    log(`folha de ${c.name}${variant ? ` (${variant.label})` : ''}…`);
    const r = await exec({ project, projectDir: dir, step, binding, scene, sceneDir: dir, outDir: dir, settings: s, signal: ac.signal, log });
    const img = r.files.find((f) => IMG.test(f) && fs.existsSync(f));
    if (!img) throw new Error('o executor não devolveu imagem');
    return addCharacterImage(s, id, img, variant ? `variant:${variant.id}` : 'sheet');
  } finally { clearTimeout(timer); fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Cópia congelada para o projeto (função pura); com variação, a aparência dela vence a padrão. */
export const toProjectCharacter = (c: LibraryCharacter, variantId?: string): ProjectCharacter => {
  const v = variantId ? c.variants?.find((x) => x.id === variantId || slugChar(x.label) === slugChar(variantId)) : undefined;
  return { id: c.id, name: c.name, look: v ? `${v.look} (variação "${v.label}"; rosto e corpo de sempre: ${c.look})` : c.look, kind: c.kind, voice: c.voice, code: c.code, description: c.description,
    entity: c.entity, variant: v?.label };
};

/** Membro do elenco a partir do personagem (voz de referência, voz de API e descrição). */
export function castFromCharacter(c: Pick<LibraryCharacter, 'name' | 'look' | 'voice'>): CastMember {
  return { speaker: c.name, refAudio: c.voice?.refAudio, voice: c.voice?.apiVoice, description: [c.look, c.voice?.description && `voz: ${c.voice.description}`].filter(Boolean).join(' — ') || undefined };
}

/**
 * Bíblia do projeto (assets/assets.md) com os itens da biblioteca: "Personagens fixos", "Cenários fixos",
 * "Objetos fixos" e "Vozes". Mantém o que já existe e acrescenta só quem falta (função pura sobre o texto).
 */
export function mergeBible(md: string, chars: Array<Pick<ProjectCharacter, 'name' | 'look' | 'voice' | 'entity'>>): string {
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
  const of = (e: LibraryEntity) => chars.filter((c) => (c.entity ?? 'character') === e);
  section('Personagens fixos', of('character').map((c) => `- **${c.name}**: ${c.look}`));
  section('Cenários fixos', of('location').map((c) => `- **${c.name}**: ${c.look}`));
  section('Objetos fixos', of('prop').map((c) => `- **${c.name}**: ${c.look}`));
  section('Vozes', of('character').filter((c) => c.voice?.description).map((c) => `- **${c.name}**: ${c.voice!.description}`));
  return out;
}

/**
 * Aplica os itens da biblioteca a um projeto recém-criado (antes de gravar o project.json):
 * copia folhas como referência, completa elenco e bíblia e congela a lista.
 * `variants`: nome ou id do personagem → id/rótulo da variação usada neste projeto (episódio).
 */
export function applyCharacters(s: Settings, p: Project, projectDir: string, ids: string[], variants: Record<string, string> = {}): { warnings: string[] } {
  const warnings: string[] = [];
  const chars: LibraryCharacter[] = [];
  for (const id of [...new Set(ids)].slice(0, 24)) { try { chars.push(getCharacter(s, id)); } catch { warnings.push(`item da biblioteca não encontrado: ${id}`); } }
  if (!chars.length) return { warnings };
  const atts: Attachment[] = [...(p.attachments ?? [])];
  const cast: CastMember[] = [...(p.cast ?? [])];
  const frozen: ProjectCharacter[] = [];
  for (const c of chars) {
    const e = entityOf(c);
    const vKey = variants[c.id] ?? variants[c.name] ?? Object.entries(variants).find(([k]) => slugChar(k) === slugChar(c.name))?.[1];
    const pc = toProjectCharacter(c, vKey);
    if (vKey && !pc.variant) warnings.push(`${c.name}: variação "${vKey}" não existe na biblioteca — usando a aparência padrão`);
    frozen.push(pc);
    const v = pc.variant ? c.variants?.find((x) => x.label === pc.variant) : undefined;
    const img = (v ? charFile(s, c, v.sheet) : undefined) ?? charFile(s, c, c.sheet) ?? charFile(s, c, c.portrait);
    if (img) {
      const folder = e === 'character' ? 'characters' : e === 'location' ? 'locations' : 'props';
      fs.mkdirSync(path.join(projectDir, 'assets', 'user', folder), { recursive: true });
      const rel = `${folder}/${c.id}${path.extname(img).toLowerCase()}`;
      fs.copyFileSync(img, path.join(projectDir, 'assets', 'user', rel));
      const label = e === 'character' ? `${c.sheet || v?.sheet ? 'Folha de personagem' : 'Retrato'} de ${c.name}${pc.variant ? ` (${pc.variant})` : ''}` : e === 'location' ? `Folha do cenário "${c.name}" (mesmo lugar em todas as cenas)` : `Folha do objeto "${c.name}" (três vistas)`;
      if (!atts.some((a) => a.file === rel)) atts.push(e === 'character'
        ? { file: rel, kind: 'image', use: 'character', character: c.name, note: `${label} (biblioteca): ${pc.look}` }
        : { file: rel, kind: 'image', use: 'reference', note: `${label} (biblioteca): ${pc.look}` });
    } else if (e === 'character' && !c.models?.length) warnings.push(`${c.name} ainda não tem folha de personagem — o app gera um retrato na primeira cena`);
    /* modelos 3D: vão para assets/user/models/<id>/ e entram como referência das cenas por código */
    const models: string[] = [];
    for (const m of c.models ?? []) {
      const src = charFile(s, c, m); if (!src) continue;
      const dst = path.join(projectDir, 'assets', 'user', 'models', c.id);
      fs.mkdirSync(dst, { recursive: true });
      fs.copyFileSync(src, path.join(dst, m));
      if (/\.gltf$/i.test(m)) for (const f of fs.readdirSync(path.dirname(src))) if (/\.(bin|png|jpe?g|webp|ktx2)$/i.test(f) && !/^(sheet|portrait|variant-|extra-)/.test(f)) fs.copyFileSync(path.join(path.dirname(src), f), path.join(dst, f));
      const rel = `models/${c.id}/${m}`;
      models.push(`assets/user/${rel}`);
      if (!atts.some((a) => a.file === rel)) atts.push({ file: rel, kind: 'other', use: 'reference', note: `Modelo 3D de "${c.name}" (biblioteca) para cenas por código: carregue com Three.js (GLTFLoader para .glb/.gltf, OBJLoader ou FBXLoader) e use sempre este modelo para ${c.name}` });
    }
    if (models.length) pc.models = models;
    if (e === 'character' && !cast.some((m) => m.speaker.toLowerCase() === c.name.toLowerCase())) cast.push(castFromCharacter({ ...c, look: pc.look }));
  }
  p.attachments = atts.length ? atts : undefined;
  p.cast = cast.length ? cast : undefined;
  p.characters = frozen;
  const bibleFile = path.join(projectDir, 'assets', 'assets.md');
  fs.mkdirSync(path.dirname(bibleFile), { recursive: true });
  fs.writeFileSync(bibleFile, mergeBible(fs.existsSync(bibleFile) ? fs.readFileSync(bibleFile, 'utf8') : '', p.characters));
  return { warnings };
}

const PLAN = new Set(['brief', 'script', 'scene_plan', 'asset_design', 'ideation']);
const CODE = new Set(['code_scene', 'motion_graphics', 'free']);
const VISUAL = new Set(['image', 'video', 'thumbnail']);

/** O item é citado na cena? (nome ou palavra do nome com 3+ letras no título, visual, narração ou fala) */
export function inScene(name: string, scene?: Pick<Scene, 'title' | 'visualIntent' | 'narration' | 'speaker'>): boolean {
  if (!scene) return false;
  const text = slugChar([scene.title, scene.visualIntent, scene.narration, scene.speaker].filter(Boolean).join(' '));
  const full = slugChar(name);
  if (text.includes(full)) return true;
  return full.split('-').some((w) => w.length > 3 && text.split('-').includes(w));
}

/** Bloco da biblioteca para o prompt de cada etapa (função pura). Cenários/objetos só entram nas cenas que os citam. */
export function charactersPrompt(p: Pick<Project, 'characters'>, stepKind: string, scene?: Pick<Scene, 'title' | 'visualIntent' | 'narration' | 'speaker'>): string {
  const all = p.characters ?? [];
  if (!all.length) return '';
  const cs = all.filter((c) => (c.entity ?? 'character') === 'character');
  const locs = all.filter((c) => c.entity === 'location');
  const props = all.filter((c) => c.entity === 'prop');
  if (PLAN.has(stepKind)) {
    const parts: string[] = [];
    if (cs.length) {
      const lines = cs.map((c) => `- **${c.name}** (${c.kind}${c.variant ? `, variação "${c.variant}"` : ''}): ${c.look}${c.voice?.description ? ` · voz: ${c.voice.description}` : ''}${c.description ? ` · ${c.description.slice(0, 200)}` : ''}`);
      parts.push(`PERSONAGENS DA BIBLIOTECA (são o elenco deste vídeo: use EXATAMENTE estes nomes e aparências; não troque roupa, cabelo nem idade; não invente outros protagonistas)${stepKind === 'asset_design' ? ' — na bíblia (assets.md) mantenha estas linhas em "## Personagens fixos" e "## Vozes"' : ''}${stepKind === 'scene_plan' ? ' — cada cena com fala indica o "speaker" pelo nome exato' : ''}:\n${lines.join('\n')}`);
    }
    if (locs.length) parts.push(`CENÁRIOS FIXOS (o mesmo lugar sempre igual — planta, luz, móveis; cite o NOME do cenário no "visualIntent" da cena que se passa nele):\n${locs.map((c) => `- **${c.name}**: ${c.look}`).join('\n')}`);
    if (props.length) parts.push(`OBJETOS FIXOS (sempre com a mesma forma, cor e material; cite o NOME quando aparecer):\n${props.map((c) => `- **${c.name}**: ${c.look}`).join('\n')}`);
    return parts.join('\n');
  }
  const near = (list: ProjectCharacter[]) => scene ? list.filter((c) => inScene(c.name, scene)) : list;
  if (CODE.has(stepKind)) {
    const m3d = (c: ProjectCharacter) => c.models?.length ? ` [modelo 3D: ${c.models.join(', ')} — relativo à pasta do projeto; em cenas 3D carregue ESTE modelo em vez de modelar à mão]` : '';
    const parts = [cs.length && `PERSONAGENS (desenhe sempre do mesmo jeito em todas as cenas):\n${cs.map((c) => `- ${c.name}: ${c.code || c.look}${m3d(c)}`).join('\n')}`,
      near(locs).length && `CENÁRIO desta cena (sempre igual): ${near(locs).map((c) => `${c.name}: ${c.code || c.look}${m3d(c)}`).join('; ')}`,
      near(props).length && `OBJETOS (sempre iguais): ${near(props).map((c) => `${c.name}: ${c.code || c.look}${m3d(c)}`).join('; ')}`].filter(Boolean);
    return parts.join('\n');
  }
  if (VISUAL.has(stepKind)) {
    const parts = [cs.length && `SAME CHARACTERS, identical look in every shot: ${cs.map((c) => `${c.name} = ${c.look}`).join('; ')}`,
      near(locs).length && `SAME LOCATION as always (identical layout, furniture and lighting): ${near(locs).map((c) => `${c.name} = ${c.look}`).join('; ')}`,
      near(props).length && `SAME PROPS (identical shape, color, material): ${near(props).map((c) => `${c.name} = ${c.look}`).join('; ')}`].filter(Boolean);
    return parts.join('. ');
  }
  return '';
}
