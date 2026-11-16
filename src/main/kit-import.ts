import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Settings, Skill } from '../shared/types';
import { addCharacterImage, deleteCharacter, listCharacters, saveCharacter } from './characters';
import { registerFileSfx, sfxDef } from './sfx';

/*
 * KIT → SKILL COM REGRAS E BIBLIOTECAS (zip, pasta ou plugin).
 *
 * Um kit (skill/plugin do Claude ou do Codex) traz três coisas, e as três viram parte do FilmForge:
 *  1) REGRAS: cada seção dos .md (SKILL.md, PLAYBOOK, README…) vai, LITERAL, para a etapa certa da skill
 *     (roteiro, cenas, câmera/atuação, legendas, som, capa) e as frases normativas (must/never/always/only,
 *     deve/nunca/sempre…) viram a lista de REGRAS DO KIT, obrigatórias em todas as etapas;
 *  2) BIBLIOTECAS: imagens (rostos, texturas, sprites), sons (sfx + pack.json com ganho), personagens
 *     (pares <nome>_eyes/_mouth/_face…), roteiros de exemplo — copiados para workspace/library/kits/<id>/,
 *     sons registrados na biblioteca de efeitos, personagens na Biblioteca, e o kit copiado para cada projeto;
 *  3) RESTRIÇÕES: requisitos (assinaturas, contas, softwares) e arquivos de uso restrito (amostras "fornecidas
 *     só para usuários do kit", licenças) são LISTADOS e os arquivos restritos ficam FORA da biblioteca.
 * As seções de instalação/ferramentas (setup, credenciais, comandos) não entram nos prompts: o FilmForge
 * reproduz o resultado com as etapas dele. Funções de análise são puras sobre a pasta (testáveis).
 */

export interface KitSection { file: string; title: string; steps: string[]; body: string }
export interface KitAnalysis {
  name: string; description: string;
  docs: string[];
  sections: KitSection[];
  rules: string[];
  requirements: string[];
  tools: string[];
  restricted: Array<{ file: string; reason: string }>;
  images: Array<{ rel: string; group: string }>;
  sounds: Array<{ id: string; rel: string; gain?: number; lead?: number }>;
  characters: Array<{ name: string; files: string[] }>;
  examples: Array<{ rel: string; title: string }>;
}
export interface KitManifest extends Omit<KitAnalysis, 'sections'> { id: string; source: string; installedAt: string; soundIds: Record<string, string>; characterIds: string[];
  /** kit de bonecos de blocos: presets (nome → spec) desenhados pela blocky3d nas cenas por código */
  blocky?: Array<{ name: string } & Omit<BlockySpec, 'kitId'>>;
  /** texturas/cartazes do kit que viraram OBJETOS na Biblioteca */
  propIds?: string[] }

const IMG = /\.(png|jpe?g|webp|gif|svg)$/i;
const AUD = /\.(wav|mp3|ogg|m4a|flac)$/i;
const SKIP_DIR = /^(node_modules|\.git|\.venv|venv|__pycache__|dist|build|frames|out|_gallery|\.claude-plugin)$/i;

/** Seção (título) → etapas do FilmForge. 'tooling' = instalação/ferramentas: fica fora dos prompts. */
export function sectionSteps(title: string): string[] {
  const t = title.toLowerCase();
  if (/before anything|setup|install|instala|workspace|credit|cr[eé]dito|subscription|assinatura|updat|atualiz|toolkit|traps|armadilha|report|relat[oó]rio|how a run|como (um|a) execu|^\d+\.?\s*production|^production|pipeline|what you need|settings|configura|^use$|^usage|^uso$|como usar|^updating|^files$|^arquivos$|^workflow$|^fluxo$/.test(t)) return ['tooling'];
  const out: string[] = [];
  if (/script|roteiro|beat|formula|f[oó]rmula|hook|gancho|story|hist[oó]ria|idea|ideia|numbers|n[uú]meros|narrat|dialog|di[aá]logo|cliffhanger|arco/.test(t)) out.push('script');
  if (/shot|plano|scene|cena|storyboard|grammar|gram[aá]tica|decupagem/.test(t)) out.push('scene_plan', 'code_scene');
  if (/camera|c[aâ]mera|acting|atua|anima|motion|movimento|visual|paleta|palette|light|luz|framing|enquadra/.test(t)) out.push('code_scene', 'image', 'video');
  if (/caption|legenda|subtitle/.test(t)) out.push('subtitles');
  if (/sound|som\b|sons|sfx|audio|[aá]udio|music|m[uú]sica|voice|voz/.test(t)) out.push('sfx', 'music');
  if (/cover|capa|thumb/.test(t)) out.push('thumbnail');
  if (/title|t[ií]tulo|seo|metadata/.test(t)) out.push('metadata');
  if (/character|personag|cast|elenco/.test(t)) out.push('asset_design', 'code_scene');
  return out.length ? [...new Set(out)] : ['global'];
}

const NORM_RE = /\b(must|never|always|only|don'?t|do not|avoid|required|requires|keep|no more than|at least|at most|every|each)\b|\b(deve|devem|nunca|sempre|n[aã]o|evite|obrigat|proibid|cada|todo|toda)\b/i;
/* requisito de ACESSO (assinatura paga, conta, licença, créditos) — não confundir com "subscribers" (inscritos do canal) */
const REQ_RE = /(\b(requires?|needs?|only (for|with)|works only|exclusiv\w*|must have|you need|exige|precisa|somente para|só para)\b[^.]{0,80}\b(subscription|subscribers? only|account|license|licen[cs]a|plan|credits?|api key|assinatura|assinante|conta)\b)|(\bsubscription\b[^.]{0,60}\b(required|check|paid|active|ended|expired|status|null)\b)|(\b(subscribe at|cancel(ed)? subscription)\b)|(\b(paid|pago)\b[^.]{0,40}\b(plan|step|credits?|api|subscription)\b)|(\bcredits?_?balance\b|\bcr[eé]ditos (do|da) (conta|assinatura))/i;
const RESTRICT_RE = /(provided by|licensed|exclusive|for (kit )?users only|for kit users|subscribers? only|only for|do not (share|redistribute)|n[aã]o redistribu|uso restrito|somente para)/i;
const TOOL_RE = /\b(flashloop|blender|ffmpeg|faster-whisper|whisper|python|numpy|pillow|yt-dlp|comfyui|after effects|premiere|davinci|elevenlabs|midjourney|runway|capcut)\b/gi;

/** Junta as linhas quebradas de um parágrafo (Markdown com quebra em ~100 colunas); itens, tabelas e títulos ficam por linha. */
export function unwrap(md: string): string {
  const out: string[] = [];
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim();
    const prev = out[out.length - 1]?.trim();
    const starts = /^([-*>]|\d+\.|\||#)/.test(t);
    if (t && prev && !starts && !/^\|/.test(prev) && !/^#/.test(prev)) out[out.length - 1] = `${out[out.length - 1]} ${t}`;
    else out.push(t);
  }
  return out.join('\n');
}
const sentences = (md: string) => unwrap(md.replace(/```[\s\S]*?```/g, ' ')).replace(/`/g, '').split(/\r?\n/)
  .flatMap((line) => /^\s*([-*]|\d+\.)\s|^\s*\|/.test(line) ? [line.trim()] : line.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú"“])/))
  .map((x) => x.replace(/\s+/g, ' ').replace(/^#+\s*/, '').trim()).filter((x) => x.length > 12);

function walk(root: string, max = 4000): string[] {
  const out: string[] = [];
  const go = (d: string, depth: number) => {
    if (depth > 6 || out.length >= max) return;
    let es: fs.Dirent[] = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) go(f, depth + 1); } else out.push(f);
    }
  };
  go(root, 0);
  return out;
}
const relOf = (root: string, f: string) => path.relative(root, f).split(path.sep).join('/');
const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const slug = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** Analisa a pasta do kit (já extraída). */
export function analyzeKit(root: string): KitAnalysis {
  const files = walk(root);
  const docs = files.filter((f) => /\.md$/i.test(f) && !/(^|[\\/])(license|changelog|contributing|code_of_conduct)\.md$/i.test(f));
  docs.sort((a, b) => Number(!/skill\.md$/i.test(a)) - Number(!/skill\.md$/i.test(b)) || Number(!/playbook|guide|rules|regras|style/i.test(a)) - Number(!/playbook|guide|rules|regras|style/i.test(b)));
  const skillMd = docs.find((f) => /skill\.md$/i.test(f));
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(read(skillMd ?? '').replace(/\r\n/g, '\n'))?.[1] ?? '';
  const name = (/^name:\s*(.+)$/m.exec(fm)?.[1] ?? path.basename(root)).trim().replace(/^["']|["']$/g, '');
  const description = (/^description:\s*(.+)$/m.exec(fm)?.[1] ?? '').trim().replace(/^["']|["']$/g, '').slice(0, 600);

  const sections: KitSection[] = [];
  const allText: Array<{ text: string; tooling: boolean; file: string }> = [];
  for (const f of docs.slice(0, 20)) {
    const md = read(f).replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
    const parts = md.split(/^(?=##?\s)/m);
    for (const part of parts) {
      const title = (/^##?\s+(.+)$/m.exec(part)?.[1] ?? path.basename(f, '.md')).trim();
      const body = part.replace(/^##?\s+.+\n?/, '').trim();
      if (!body) continue;
      let steps = sectionSteps(title);
      /* seção dominada por ferramentas/contas (apresentação do kit, instalação) também é ferramental */
      const toolHits = (body.match(TOOL_RE)?.length ?? 0) + (body.match(new RegExp(REQ_RE.source, 'gi'))?.length ?? 0);
      if (toolHits >= 4 && toolHits * 120 > body.length) steps = ['tooling'];
      allText.push({ text: body, tooling: steps.includes('tooling'), file: f });
      /* no texto literal da etapa ficam só as linhas criativas: comandos, contas e créditos saem */
      const clean = unwrap(body).split('\n').filter((l) => !REQ_RE.test(l) && !/flashloop|\$PY|\bsetup\.py|\btools\/|\.venv/i.test(l)).join('\n').trim();
      if (!steps.includes('tooling') && clean) sections.push({ file: relOf(root, f), title, steps, body: clean.slice(0, 4000) });
    }
  }
  const uniq = (xs: string[], n: number) => [...new Set(xs.map((x) => x.slice(0, 260)))].slice(0, n);
  const rules = uniq(allText.filter((x) => !x.tooling).flatMap((x) => sentences(x.text)).filter((s) => (NORM_RE.test(s) || /^- \[ \]/.test(s)) && !REQ_RE.test(s) && !/flashloop_|\$PY|\bsetup\.py|\btools\/|\.venv/i.test(s) && !s.match(TOOL_RE)).map((s) => s.replace(/^- \[ \]\s*/, '☐ ')), 80);
  const requirements = uniq(allText.flatMap((x) => sentences(x.text)).filter((s) => REQ_RE.test(s) && !/^\|/.test(s)), 14);
  const tools = [...new Set(allText.flatMap((x) => [...x.text.matchAll(TOOL_RE)].map((m) => m[1]!.toLowerCase())))];

  /* arquivos citados em frases de uso restrito ficam fora da biblioteca */
  const restricted: KitAnalysis['restricted'] = [];
  for (const x of allText) for (const s of sentences(x.text).filter((t) => RESTRICT_RE.test(t))) {
    for (const m of s.matchAll(/([\w<>./-]*[\w-]+\.(mp3|wav|ogg|m4a|png|jpe?g|webp|mp4|mov|glb|gltf|json|ttf|otf))/gi)) {
      const base = path.basename(m[1]!.replace(/<[^>]+>\/?/g, ''));
      for (const f of files.filter((ff) => path.basename(ff).toLowerCase() === base.toLowerCase())) {
        const rel = relOf(root, f);
        if (!restricted.some((r) => r.file === rel)) restricted.push({ file: rel, reason: s.slice(0, 200) });
      }
    }
  }
  /* LICENSE: blocos de material de terceiros ("reference_screenshots/ … Do not redistribute …") e pastas citadas como
     "study only" no SKILL.md — tudo dentro dessas pastas fica fora da biblioteca */
  const restrictedDirs = licenseRestrictedPaths(files.filter((f) => /(^|[\\/])(license|licence|copying|notice)(\.(md|txt))?$/i.test(f)).map(read).join('\n'));
  for (const x of allText) for (const s of sentences(x.text).filter((t) => /study only|for study|private study|do not redistribute|not covered/i.test(t))) {
    for (const m of s.matchAll(/\b([\w.-]+\/)/g)) if (!/^https?/.test(m[1]!)) restrictedDirs.push({ prefix: m[1]!, reason: s.slice(0, 200) });
  }
  for (const d of restrictedDirs) for (const f of files) {
    const rel = relOf(root, f);
    if ((rel === d.prefix.replace(/\/$/, '') || rel.startsWith(d.prefix) || rel.includes(`/${d.prefix}`) || (d.glob && d.glob.test(rel))) && !restricted.some((r) => r.file === rel)) restricted.push({ file: rel, reason: d.reason });
  }
  const isRestricted = (rel: string) => restricted.some((r) => r.file === rel);

  const images = files.filter((f) => IMG.test(f) && !isRestricted(relOf(root, f)) && fs.statSync(f).size < 8_000_000)
    .map((f) => ({ rel: relOf(root, f), group: path.basename(path.dirname(f)) })).slice(0, 400);
  const sounds: KitAnalysis['sounds'] = [];
  for (const f of files.filter((ff) => AUD.test(ff) && /(^|[\\/])(sfx|sounds?|efeitos|fx|audio)([\\/]|$)/i.test(relOf(root, path.dirname(ff))) && !isRestricted(relOf(root, ff)))) {
    let pack: Record<string, { gain?: number; lead?: number }> = {};
    try { pack = JSON.parse(read(path.join(path.dirname(f), 'pack.json'))) as typeof pack; } catch { /* sem pack */ }
    const id = slug(path.basename(f).replace(AUD, ''));
    if (!id || sounds.some((x) => x.id === id)) continue;
    sounds.push({ id, rel: relOf(root, f), gain: pack[id]?.gain, lead: pack[id]?.lead });
    if (sounds.length >= 200) break;
  }
  /* personagens: <nome>_(eyes|mouth|face|head|body|sheet|front|side|back) */
  const chars = new Map<string, string[]>();
  for (const im of images) {
    const m = /^(.+?)_(eyes|mouth|face|head|body|sheet|front|side|back|portrait)\.[a-z]+$/i.exec(path.basename(im.rel));
    if (m) chars.set(m[1]!.toLowerCase(), [...(chars.get(m[1]!.toLowerCase()) ?? []), im.rel]);
  }
  for (const f of files.filter((ff) => /(^|[\\/])characters?[\\/][^\\/]+\.json$/i.test(relOf(root, ff)))) {
    const n = path.basename(f, '.json').toLowerCase();
    chars.set(n, [...(chars.get(n) ?? []), relOf(root, f)]);
  }
  const characters = [...chars].map(([n, fs2]) => ({ name: n, files: fs2 })).slice(0, 40);
  const examples = files.filter((f) => /(^|[\\/])(script|roteiro)\.(txt|md)$/i.test(f) || /\.(script|roteiro)\.(txt|md)$/i.test(f))
    .map((f) => ({ rel: relOf(root, f), title: path.basename(path.dirname(f)) })).slice(0, 12);
  return { name, description, docs: docs.map((f) => relOf(root, f)), sections, rules, requirements, tools, restricted, images, sounds, characters, examples };
}

export const kitsRoot = (s: Settings) => path.join(s.workspace, 'library', 'kits');
export const kitDir = (s: Settings, id: string) => path.join(kitsRoot(s), id.replace(/[^\w-]/g, ''));

/** Copia as bibliotecas abertas do kit (imagens, sons, exemplos) e registra sons e personagens. */
export function installKitLibrary(s: Settings, root: string, a: KitAnalysis, o: { id: string; source: string }): KitManifest {
  const dest = kitDir(s, o.id);
  fs.mkdirSync(dest, { recursive: true });
  const copy = (rel: string) => { const to = path.join(dest, ...rel.split('/')); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(root, ...rel.split('/')), to); };
  for (const x of a.images) copy(x.rel);
  for (const x of a.sounds) copy(x.rel);
  for (const x of a.examples) copy(x.rel);
  /* sons: ids próprios (o nome do kit vence só quando não colide com um efeito do app) */
  const soundIds: Record<string, string> = {};
  for (const x of a.sounds) {
    const id = sfxDef(x.id) && !sfxDef(x.id)!.file ? `${x.id}-kit` : x.id;
    soundIds[x.id] = id;
    registerFileSfx(id, path.join(dest, ...x.rel.split('/')), { gain: x.gain, label: `${x.id} (${a.name})` });
  }
  /* personagens do kit → Biblioteca (código). Kit de bonecos de blocos: os PRESETS do rig viram personagens desenhados
     pela blocky3d (miniatura renderizada); senão, um personagem por conjunto de rosto, com as imagens como referência */
  const characterIds: string[] = [];
  const existing = listCharacters(s);
  const tag = slug(a.name);
  const blocky = isBlockyKit(a) ? installBlockyLibrary(s, root, a, o.id) : undefined;
  if (blocky?.length) {
    /* reimportação: os personagens "por rosto" de uma importação antiga deste kit saem */
    for (const old of existing.filter((x) => (x.tags ?? []).includes(tag) && (x.tags ?? []).includes('kit') && !x.blocky && x.entity !== 'prop')) { try { deleteCharacter(s, old.id); } catch { /* segue */ } }
    for (const p of blocky) {
      const label = `${p.name} (${a.name})`;
      const prev = existing.find((x) => x.name === label);
      try {
        const { name: _n, ...spec } = p;
        const c = saveCharacter(s, { id: prev?.id, name: label, kind: 'codigo', look: blockyLook(p), blocky: spec,
          code: `Avatar de blocos: avatar(${JSON.stringify({ ...spec, kitId: undefined })}, faces) da biblioteca ../../../kit/blocky3d.js (preset "${p.name}" em ../../../kit/characters.json).`,
          description: `Personagem do kit ${a.name} (${o.source}), desenhado pela biblioteca blocky3d com o rosto "${p.face ?? 'kid'}" do kit.`, tags: ['kit', tag, 'blocky'] });
        characterIds.push(c.id);
      } catch { /* preset inválido */ }
    }
  }
  for (const ch of blocky?.length ? [] : a.characters) {
    const label = `${ch.name.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())} (${a.name})`;
    const imgs = ch.files.filter((f) => IMG.test(f));
    try {
      const prev = existing.find((x) => x.name === label);
      const c = saveCharacter(s, { id: prev?.id, name: label, kind: 'codigo',
        look: `personagem do kit "${a.name}": ${ch.name} — use as camadas da biblioteca do kit (${imgs.map((f) => path.basename(f)).join(', ') || ch.files.map((f) => path.basename(f)).join(', ')}) sem mudar formas nem cores`,
        code: `Desenhe com as imagens do kit no projeto: ${imgs.map((f) => `kit/${f}`).join(', ')}. Mantenha proporções e cores idênticas em todas as cenas.`,
        description: `Importado do kit ${a.name} (${o.source}).`, tags: ['kit', slug(a.name)] });
      if (!prev) for (const f of imgs.slice(0, 6)) addCharacterImage(s, c.id, path.join(dest, ...f.split('/')), f === imgs[0] ? 'sheet' : 'extra');
      characterIds.push(c.id);
    } catch { /* personagem inválido: segue com os outros */ }
  }
  /* texturas, cartazes e telas do kit → OBJETOS da Biblioteca (com a própria imagem de miniatura) */
  const propIds: string[] = [];
  const faceFiles = new Set(a.characters.flatMap((c) => c.files));
  for (const im of a.images.filter((x) => !faceFiles.has(x.rel) && /\.(png|jpe?g|webp)$/i.test(x.rel)).slice(0, 60)) {
    const label = `${path.basename(im.rel).replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())} (${a.name})`;
    try {
      const prev = existing.find((x) => x.name === label);
      const c = saveCharacter(s, { id: prev?.id, name: label, entity: 'prop', kind: 'outro', look: `flat front-on texture/sign from the kit "${a.name}": ${path.basename(im.rel)} — use the image itself (kit/${im.rel}), never redraw it`,
        description: `Textura do kit ${a.name} (${im.group}). Nas cenas por código: ../../../kit/${im.rel}`, tags: ['kit', tag, im.group] });
      if (!prev?.sheet) addCharacterImage(s, c.id, path.join(dest, ...im.rel.split('/')), 'sheet');
      propIds.push(c.id);
    } catch { /* imagem inválida */ }
  }
  const { sections: _s, ...rest } = a;
  const manifest: KitManifest = { ...rest, id: o.id, source: o.source, installedAt: new Date().toISOString(), soundIds, characterIds, propIds,
    blocky: blocky?.map(({ kitId: _k, ...p }) => p) };
  fs.writeFileSync(path.join(dest, 'kit.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

/** Ao abrir o app: sons de todos os kits instalados voltam para a biblioteca de efeitos. */
export function loadKitSounds(s: Settings): number {
  let n = 0;
  try {
    for (const d of fs.readdirSync(kitsRoot(s), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      try {
        const m = JSON.parse(read(path.join(kitsRoot(s), d.name, 'kit.json'))) as KitManifest;
        for (const x of m.sounds ?? []) { const f = path.join(kitsRoot(s), d.name, ...x.rel.split('/')); if (fs.existsSync(f)) { registerFileSfx(m.soundIds?.[x.id] ?? x.id, f, { gain: x.gain, label: `${x.id} (${m.name})` }); n++; } }
      } catch { /* kit sem manifesto */ }
    }
  } catch { /* sem kits */ }
  return n;
}

export const readKit = (s: Settings, id: string): KitManifest | undefined => { try { return JSON.parse(read(path.join(kitDir(s, id), 'kit.json'))) as KitManifest; } catch { return undefined; } };

/** Projeto criado com skill de kit: a biblioteca (imagens, exemplos) vai para <projeto>/kit/. */
export function copyKitIntoProject(s: Settings, kitId: string, projectDir: string): boolean {
  const src = kitDir(s, kitId);
  if (!fs.existsSync(src)) return false;
  fs.cpSync(src, path.join(projectDir, 'kit'), { recursive: true, filter: (f) => !AUD.test(f) });
  return true;
}

/** Monta a skill a partir da análise: regras (literais) por etapa + regras obrigatórias + biblioteca. */
export function kitSkillContent(a: KitAnalysis, m: Pick<KitManifest, 'soundIds' | 'characterIds'> & Partial<Pick<KitManifest, 'blocky'>>): Pick<Skill, 'global' | 'steps'> {
  const steps: Record<string, string[]> = {};
  for (const sec of a.sections) for (const st of sec.steps) (steps[st] ??= []).push(`### ${sec.title} (${sec.file})\n${sec.body}`);
  const groups = [...new Set(a.images.map((x) => x.group))];
  const lib = [
    a.images.length ? `IMAGENS (${a.images.length}) em kit/ no projeto — a cena por código está em scenes/<cena>/code/, então use o caminho "../../../kit/<arquivo>": ${groups.map((g) => `${g}: ${a.images.filter((x) => x.group === g).slice(0, 30).map((x) => x.rel).join(', ')}`).join(' | ')}` : '',
    a.sounds.length ? `SONS do kit (ids da biblioteca de efeitos; na cena por código declare window.__forge.sfx = [{ t: segundos, name: "id" }] — um por onomatopeia, impacto, whoosh e revelação): ${a.sounds.map((x) => m.soundIds[x.id] ?? x.id).join(', ')}` : '',
    a.characters.length ? `PERSONAGENS do kit (Biblioteca): ${a.characters.map((c) => `${c.name} [${c.files.map((f) => path.basename(f)).join(', ')}]`).join('; ')}` : '',
    a.examples.length ? `ROTEIROS DE EXEMPLO (modelo de ritmo e estrutura; nunca copie o enredo): ${a.examples.map((x) => `kit/${x.rel}`).join(', ')}` : '',
  ].filter(Boolean).join('\n');
  const global = [
    `SKILL DERIVADA DO KIT "${a.name}". As REGRAS DO KIT abaixo são OBRIGATÓRIAS e valem em todas as etapas (vencem o estilo padrão do app; só o pedido do usuário no projeto vence o kit). Siga números, estrutura, ritmo e proibições literalmente.`,
    a.rules.length ? `REGRAS DO KIT:\n${a.rules.map((r) => `- ${r}`).join('\n')}` : '',
    a.tools.length ? `O kit original usa ${a.tools.join(', ')}: essas ferramentas NÃO rodam aqui — reproduza o mesmo resultado com as etapas do FilmForge (código, TTS, efeitos, montagem). Ignore instruções de instalação, contas e comandos.` : '',
    a.restricted.length ? `ITENS DE USO RESTRITO (fora da biblioteca, não use nem imite): ${a.restricted.map((r) => r.file).join(', ')}.` : '',
    lib ? `BIBLIOTECA DO KIT:\n${lib}` : '',
    'Execução SEM usuário: nunca faça perguntas nem pare para confirmar; decida o que o pedido não disser e siga.',
  ].filter(Boolean).join('\n\n');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(steps)) if (k !== 'global') out[k] = `REGRAS DO KIT para esta etapa (literais):\n${v.join('\n\n')}`.slice(0, 7000);
  if (steps['global']?.length) out['ideation'] = `REGRAS GERAIS DO KIT:\n${steps['global'].join('\n\n')}`.slice(0, 5000);
  if (lib) out['code_scene'] = [out['code_scene'], `USE A BIBLIOTECA DO KIT nesta cena:\n${lib}`].filter(Boolean).join('\n\n').slice(0, 9000);
  /* bonecos de blocos: a cena é Three.js com a blocky3d (o MESMO boneco do kit), nunca bonecos desenhados à mão */
  if (m.blocky?.length) {
    const blk = [
      'PERSONAGENS = AVATARES DE BLOCOS DO KIT (obrigatório): a cena é Three.js e TODO personagem vem da biblioteca blocky3d — nunca desenhe bonecos à mão em Canvas/SVG.',
      'Código-base da página (siga o contrato): <script type="importmap">{"imports":{"three":"…"}}</script> é posto pelo app; no módulo:',
      "  import * as THREE from 'three';",
      "  import { loadFaces, avatar, studio, baseplate, imageCard, camMove, EXPR, GESTURES } from '../../../kit/blocky3d.js';",
      "  const presets = await (await fetch('../../../kit/characters.json')).json();",
      "  const faces = await loadFaces('../../../kit/faces/', [...new Set(presets.map(p => p.face))]);",
      "  const eddie = avatar(presets.find(p => p.name === 'Eddie'), faces); scene.add(eddie.group);",
      "  window.__forge = { duration: DUR, fps: 30, sfx: [{ t: 0.4, name: 'poof' }], pause() {}, async seek(t) { await ready; eddie.update(t, { expr: 'shock', gesture: 'hands_head', gestureAt: 1.2, walk: 0, talk: [[0.3, 1.8]] }); camMove(camera, t, { push: .2, crashAt: 0.4 }); renderer.render(scene, camera); } };",
      '  (ready = a promessa do carregamento: loadFaces/imageCard/fetch dos presets; o seek espera por ela). O app VALIDA a página: sem import da blocky3d, avatar() e loadFaces() a cena é recusada.',
      `PRESETS do kit (../../../kit/characters.json): ${m.blocky.map((p) => `${p.name} (rosto ${p.face}, ${p.hair} ${p.hairColor ?? ''}, camisa ${p.shirt}, calça ${p.pants})`).join('; ')}.`,
      `EXPRESSÕES: ${Object.keys({ neutral: 1, happy: 1, joy: 1, shock: 1, gasp: 1, terror: 1, scream: 1, worried: 1, angry: 1, smug: 1, sus: 1, cry: 1, talk: 1, shout: 1, panic: 1, relief: 1, confused: 1 }).join(', ')}. GESTOS: idle, shock, hands_head, hands_face, cheer, point, point_l, shrug, recoil, lean, slump, think, cross, phone, reach, push, hold, wave, fists, facepalm, brace. walk: 0 parado, 1 andando, 2 correndo.`,
      'CENÁRIO COBRE 100% DO QUADRO EM 9:16 E EM 16:9 (obrigatório): a mesma cena é renderizada na vertical e na horizontal, então o fundo (studio(scene) — céu + luzes), o chão (baseplate(scene), size >= 120) e qualquer parede/cenário têm de passar das bordas em qualquer enquadramento: nada de fundo vazio, faixa preta ou chão/parede terminando dentro do quadro. Mantenha a ação e os personagens no centro (a faixa central 9:16 é o recorte do vertical). Cenário com blocos simples (BoxGeometry de cores sólidas, studio(scene) e baseplate(scene)) e as texturas do kit em imageCard(scene, "../../../kit/<arquivo>", w, h, [x,y,z]). Personagem com ~6 unidades de altura: câmera a 8–14 unidades, lente 26–35°.',
    ].join('\n');
    out['code_scene'] = [blk, out['code_scene']].filter(Boolean).join('\n\n').slice(0, 12000);
    out['scene_plan'] = [out['scene_plan'], `As cenas são "code" (Three.js com os avatares de blocos do kit). Use os presets pelo nome: ${m.blocky.map((p) => p.name).join(', ')}; escreva no visualIntent quem aparece (preset), a expressão, o gesto e o movimento de câmera.`].filter(Boolean).join('\n\n');
  }
  return { global: global.slice(0, 14000), steps: out };
}

/* ═════════ avatar de blocos (blocky3d) ═════════
 * Kits de bonecos de blocos (rig R6 + atlas de rosto <nome>_eyes/_mouth 4×4): o FilmForge traz a biblioteca blocky3d
 * (Three.js) que monta o MESMO boneco nas cenas por código; os presets do kit (cores, cabelo, rosto) viram personagens
 * da Biblioteca com miniatura desenhada pela própria biblioteca. */
export function vendorBlockyFile(): string | undefined {
  const rp = (process as { resourcesPath?: string }).resourcesPath;
  const tries = [rp && path.join(rp, 'vendor', 'blocky3d'), path.join(__dirname, '..', '..', 'vendor', 'blocky3d'), path.join(process.cwd(), 'vendor', 'blocky3d')];
  for (const d of tries) if (d && fs.existsSync(path.join(d, 'blocky3d.js'))) return path.join(d, 'blocky3d.js');
  return undefined;
}

export type BlockySpec = NonNullable<import('../shared/types').LibraryCharacter['blocky']>;

/** Kit de bonecos de blocos? (atlas de rosto em pares + docs falando de blocos/R6) — função pura sobre a análise. */
export const isBlockyKit = (a: Pick<KitAnalysis, 'characters' | 'description' | 'name' | 'sections'>) =>
  a.characters.some((c) => c.files.some((f) => /_eyes\.png$/i.test(f)) && c.files.some((f) => /_mouth\.png$/i.test(f)))
  && /\b(r6|blocky|block[- ]body|block arms|cube head|roblox|bloco)/i.test(`${a.name} ${a.description} ${a.sections.map((x) => x.body).join(' ')}`);

/** Presets dos personagens do kit a partir de rig em Python: def nome(...): a = dict(skin=..., shirt=..., …). */
export function parseBlockyPresets(py: string): Array<{ name: string } & Omit<BlockySpec, 'kitId'>> {
  const out: Array<{ name: string } & Omit<BlockySpec, 'kitId'>> = [];
  for (const m of py.matchAll(/def\s+\w+\(\s*name\s*=\s*"([^"]+)"[^)]*\):\s*\n\s*a\s*=\s*dict\(([\s\S]*?)\)\s*\n/g)) {
    const body = m[2]!;
    const str = (k: string) => new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`).exec(body)?.[1];
    const extras = /\bextras\s*=\s*\(([^)]*)\)/.exec(body)?.[1]?.match(/"([^"]+)"/g)?.map((x) => x.slice(1, -1));
    const p = { name: m[1]!, skin: str('skin'), shirt: str('shirt'), pants: str('pants'), hair: str('hair'), hairColor: str('hair_color'), face: str('face'),
      sleeves: str('sleeves'), bolt: str('bolt'), vneck: str('vneck'), shirtKind: str('shirt_kind'), shirtC2: str('shirt_c2'), extras };
    if (p.skin || p.shirt) out.push(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as typeof out[number]);
  }
  return out;
}

const COLOR_WORDS: Array<[RegExp, string]> = [[/^#f[0-9a-f]{5}$/i, 'light'], [/^#[0-3][0-9a-f]{5}$/i, 'dark']];
const shade = (hex?: string) => (hex ? COLOR_WORDS.find(([re]) => re.test(hex))?.[1] ?? '' : '');

/** Página da miniatura de um avatar de blocos (480×480): Three.js + blocky3d + rostos do kit copiados em `dir`. */
export function blockyThumbPage(s: Settings, spec: BlockySpec, dir: string): string | undefined {
  const lib = vendorBlockyFile();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { stageThree } = require('./plugins') as typeof import('./plugins');
  const t3 = stageThree(dir, dir);
  if (!lib || !t3) return undefined;
  fs.copyFileSync(lib, path.join(dir, 'blocky3d.js'));
  fs.mkdirSync(path.join(dir, 'faces'), { recursive: true });
  const face = spec.face ?? 'kid';
  for (const part of ['eyes', 'mouth']) { const f = path.join(kitDir(s, spec.kitId), 'faces', `${face}_${part}.png`); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, 'faces', `${face}_${part}.png`)); }
  const { kitId: _k, ...av } = spec;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#7ec8ff;overflow:hidden}canvas{display:block}</style>
<script type="importmap">${JSON.stringify({ imports: t3.importmap })}</script></head><body><canvas id="c" width="480" height="480"></canvas>
<script type="module">
import * as THREE from 'three';
import { loadFaces, avatar, studio } from './blocky3d.js';
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true }); r.setSize(480, 480, false);
const sc = new THREE.Scene(); studio(sc);
const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 100); cam.position.set(3.2, 4.4, 13); cam.lookAt(0, 3.0, 0);
const ready = (async () => { const faces = await loadFaces('./faces/', [${JSON.stringify(face)}]); const a = avatar(${JSON.stringify(av)}, faces); a.group.rotation.y = 0.32; sc.add(a.group); a.update(0.6, { expr: 'happy', gesture: 'wave', gestureAt: 0, blink: false }); })();
window.__forge = { duration: 1, fps: 1, pause() {}, async seek() { await ready; r.render(sc, cam); } };
</script></body></html>`;
  const file = path.join(dir, 'thumb.html');
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

/** Biblioteca de blocos do kit: blocky3d.js + rostos em faces/ + characters.json (presets), dentro da pasta do kit. */
export function installBlockyLibrary(s: Settings, root: string, a: KitAnalysis, kitId: string): Array<{ name: string } & BlockySpec> {
  const dest = kitDir(s, kitId);
  const lib = vendorBlockyFile();
  if (lib) fs.copyFileSync(lib, path.join(dest, 'blocky3d.js'));
  fs.mkdirSync(path.join(dest, 'faces'), { recursive: true });
  for (const c of a.characters) for (const f of c.files.filter((x) => /_(eyes|mouth)\.png$/i.test(x))) fs.copyFileSync(path.join(root, ...f.split('/')), path.join(dest, 'faces', path.basename(f)));
  /* presets: o rig em Python do kit (chars.py etc.); sem ele, um personagem por rosto com cores padrão */
  let presets: Array<{ name: string } & Omit<BlockySpec, 'kitId'>> = [];
  for (const f of walk(root).filter((x) => /\.py$/i.test(x) && /char|rig|avatar|cast/i.test(path.basename(x)))) presets.push(...parseBlockyPresets(read(f)));
  const faces = new Set(a.characters.map((c) => c.name));
  presets = presets.filter((p) => !p.face || faces.has(p.face));
  if (!presets.length) presets = [...faces].map((f, i) => ({ name: f.replace(/^\w/, (c) => c.toUpperCase()), face: f, shirt: ['#8db8ee', '#f09ac2', '#63c06a', '#f2c14e', '#9b6ad6'][i % 5], pants: '#3c5cbc', hair: 'short', hairColor: '#5a3a22' }));
  const full = presets.map((p) => ({ ...p, kitId }));
  fs.writeFileSync(path.join(dest, 'characters.json'), JSON.stringify(full.map(({ kitId: _k, ...x }) => x), null, 1));
  return full;
}

/** Descrição fixa (inglês) do avatar para prompts de imagem/vídeo. */
export const blockyLook = (p: { name: string } & Omit<BlockySpec, 'kitId'>) =>
  `blocky toy avatar "${p.name}": rounded cylinder head with a cartoon face, ${shade(p.skin)} skin ${p.skin ?? ''}, rectangular block torso with a ${p.shirt ?? ''} shirt${p.bolt ? ` and a ${p.bolt} lightning bolt` : ''}${p.vneck ? `, ${p.vneck} v-neck collar` : ''}, block arms (${p.sleeves ?? 'short'} sleeves), block legs with ${p.pants ?? ''} pants, ${p.hair ?? 'short'} ${p.hairColor ?? ''} hair${p.extras?.length ? `, ${p.extras.join(', ')}` : ''}; glossy plastic look`.replace(/\s+/g, ' ');

/**
 * Caminhos de USO RESTRITO declarados no LICENSE: blocos "caminho/" ou "caminho/*.ext" seguidos de texto que proíbe
 * redistribuir/usar (material de terceiros). Caminhos com licença livre no mesmo bloco (OFL, MIT, CC0…) não entram.
 * Função pura.
 */
export function licenseRestrictedPaths(license: string): Array<{ prefix: string; glob?: RegExp; reason: string }> {
  const out: Array<{ prefix: string; glob?: RegExp; reason: string }> = [];
  const lines = license.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!.trim();
    if (!/^[\w.-]+(\/[\w.*-]*)*\/?$/.test(head) || !/[/*]/.test(head)) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length && (/^\s{2,}\S/.test(lines[j]!) || !lines[j]!.trim()) && body.length < 12; j++) { if (lines[j]!.trim()) body.push(lines[j]!.trim()); else if (body.length) break; }
    const text = body.join(' ');
    if (!/do not (redistribute|re-upload|use|share)|not covered|copyright belongs|private study|study only|all rights reserved/i.test(text)) continue;
    if (/open font license|\bofl\b|free to use|mit license|cc0|public domain/i.test(text)) continue;
    const esc = head.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, (ch) => `\\${ch}`)).join('[^/]*');
    const glob = head.includes('*') ? new RegExp(`(^|/)${esc}$`, 'i') : undefined;
    out.push({ prefix: head.includes('*') ? head.replace(/\*.*$/, '') : head.endsWith('/') ? head : `${head}/`, glob, reason: text.slice(0, 200) });
  }
  return out;
}
