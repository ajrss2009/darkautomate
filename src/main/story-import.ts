import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LibraryCharacter, LibraryEntity, Project, Settings, Story, StoryEpisode, StoryEvent, StoryRelation } from '../shared/types';
import { findByName, listCharacters, saveCharacter, slugChar } from './characters';

/*
 * IMPORTAR ROMANCE / TEXTO LONGO (Biblioteca → Histórias):
 *  1) o texto é dividido em trechos (por parágrafos); a IA lê cada trecho e devolve personagens (aparência, idade,
 *     voz, apelidos), relações, eventos da linha do tempo, cenários e objetos — já sabendo quem apareceu antes;
 *  2) o app junta tudo por nome/apelido (sem duplicar) e a IA planeja a SÉRIE: arco, episódios com resumo, batidas,
 *     gancho, quem aparece e a VARIAÇÃO de cada personagem no episódio (roupa, idade, ferimento);
 *  3) a Biblioteca é preenchida sozinha (personagens, cenários, objetos e variações); itens que já existem ganham só
 *     apelidos/variações — a aparência escrita pelo usuário não é trocada;
 *  4) cada episódio vira um projeto com um clique (elenco, cenários, objetos, variações e "anteriormente" da série).
 * Tudo em workspace/library/stories/<id>/story.json (+ source.txt). O pedido à IA é injetado (testável sem rede).
 */

export const storiesRoot = (s: Settings) => path.join(s.workspace, 'library', 'stories');
const SAFE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const storyDir = (s: Settings, id: string) => { if (!SAFE.test(id)) throw new Error(`história inválida: ${id}`); return path.join(storiesRoot(s), id); };
const str = (v: unknown, n = 400) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, n) : undefined);
const strs = (v: unknown, n = 12, len = 80) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter((x): x is string => !!x).slice(0, n) : []);
const key = (n: string) => slugChar(n);

/** Divide o texto em trechos de até `max` caracteres, sem cortar parágrafos (função pura). */
export function chunkText(text: string, max = 14000): string[] {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p0 of paras) {
    let p = p0;
    while (p.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(p.slice(0, max)); p = p.slice(max); }
    if (cur && cur.length + p.length + 2 > max) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

export interface XChar { name: string; aliases: string[]; role?: string; gender?: 'f' | 'm'; age?: string; look?: string; personality?: string; voice?: string }
export interface XThing { name: string; look?: string; note?: string }
export interface Extraction { title?: string; genre?: string; characters: XChar[]; relations: StoryRelation[]; timeline: StoryEvent[]; locations: XThing[]; props: XThing[] }

/** Pedido de extração de um trecho (com os nomes já conhecidos para a IA não duplicar). */
export function extractPrompt(chunk: string, i: number, n: number, known: Pick<Extraction, 'characters' | 'locations' | 'props'>): string {
  const names = (l: Array<{ name: string }>) => l.map((x) => x.name).join(', ') || '—';
  return `Você é roteirista e diretor de arte. Leia o TRECHO ${i + 1} de ${n} de uma história e extraia o que é necessário para produzir uma série em vídeo.
Já conhecidos (use EXATAMENTE estes nomes quando forem os mesmos; não repita quem não aparece neste trecho):
- personagens: ${names(known.characters)}
- cenários: ${names(known.locations)}
- objetos: ${names(known.props)}

Responda SOMENTE com JSON:
{
  "title": "título da obra se aparecer",
  "genre": "gênero (romance, fantasia, suspense, dorama…)",
  "characters": [ { "name": "nome principal", "aliases": ["apelidos"], "role": "protagonista|antagonista|coadjuvante|figurante", "gender": "f|m", "age": "idade aproximada",
    "look": "APARÊNCIA FIXA e objetiva para gerar imagem: rosto, cabelo, corpo, roupa típica (se o texto não disser, deduza algo coerente com a época e o papel)", "personality": "personalidade em 1 frase", "voice": "como a voz soa (idade, timbre, ritmo)" } ],
  "relations": [ { "a": "nome", "b": "nome", "type": "irmãos|casal|rivais|mentor|pai/filha…", "note": "detalhe curto" } ],
  "timeline": [ { "order": 1, "event": "o que acontece (1 frase)", "chapter": "capítulo se houver", "characters": ["nomes"], "location": "cenário" } ],
  "locations": [ { "name": "nome do lugar", "look": "aparência fixa: arquitetura, móveis, luz, época", "note": "função na história" } ],
  "props": [ { "name": "objeto importante", "look": "forma, material, cor, detalhes", "note": "por que importa" } ]
}
Só objetos e lugares que voltam ou são importantes para a trama. Eventos em ordem cronológica DESTE trecho.

TRECHO:
"""
${chunk}
"""`;
}

/** Normaliza a resposta de um trecho (função pura). */
export function normalizeExtraction(raw: unknown): Extraction {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const arr = (k: string) => (Array.isArray(o[k]) ? o[k] as unknown[] : []).map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>);
  const characters = arr('characters').map((r): XChar | undefined => {
    const name = str(r['name'], 60); if (!name) return undefined;
    const g = String(r['gender'] ?? '').toLowerCase();
    return { name, aliases: strs(r['aliases'], 8, 60).filter((a) => key(a) !== key(name)), role: str(r['role'], 40), gender: g.startsWith('f') ? 'f' : g.startsWith('m') ? 'm' : undefined,
      age: str(r['age'], 30), look: str(r['look'], 600), personality: str(r['personality'], 300), voice: str(r['voice'], 200) };
  }).filter((x): x is XChar => !!x);
  const thing = (r: Record<string, unknown>): XThing | undefined => { const name = str(r['name'], 60); return name ? { name, look: str(r['look'], 600), note: str(r['note'], 200) } : undefined; };
  return {
    title: str(o['title'], 120), genre: str(o['genre'], 60), characters,
    relations: arr('relations').map((r) => ({ a: str(r['a'], 60) ?? '', b: str(r['b'], 60) ?? '', type: str(r['type'], 40) ?? 'relação', note: str(r['note'], 200) })).filter((r) => r.a && r.b && key(r.a) !== key(r.b)),
    timeline: arr('timeline').map((r, i) => ({ order: Number(r['order']) || i + 1, event: str(r['event'], 300) ?? '', chapter: str(r['chapter'], 40), characters: strs(r['characters'], 8, 60), location: str(r['location'], 60) })).filter((e) => e.event),
    locations: arr('locations').map(thing).filter((x): x is XThing => !!x),
    props: arr('props').map(thing).filter((x): x is XThing => !!x),
  };
}

const sameName = (a: { name: string; aliases?: string[] }, n: string) => key(a.name) === key(n) || (a.aliases ?? []).some((x) => key(x) === key(n));

/** Junta a extração de um trecho à acumulada: sem duplicar por nome/apelido; eventos seguem a ordem dos trechos. */
export function mergeExtraction(acc: Extraction, part: Extraction): Extraction {
  const out: Extraction = { title: acc.title ?? part.title, genre: acc.genre ?? part.genre, characters: acc.characters.map((c) => ({ ...c, aliases: [...c.aliases] })),
    relations: [...acc.relations], timeline: [...acc.timeline], locations: [...acc.locations], props: [...acc.props] };
  for (const c of part.characters) {
    const hit = out.characters.find((x) => sameName(x, c.name) || c.aliases.some((a) => sameName(x, a)));
    if (!hit) { out.characters.push({ ...c, aliases: [...c.aliases] }); continue; }
    for (const a of [c.name, ...c.aliases]) if (!sameName(hit, a)) hit.aliases.push(a);
    hit.look ??= c.look; hit.age ??= c.age; hit.gender ??= c.gender; hit.voice ??= c.voice; hit.personality ??= c.personality; hit.role ??= c.role;
  }
  const canon = (n: string) => out.characters.find((x) => sameName(x, n))?.name ?? n;
  for (const r of part.relations) {
    const a = canon(r.a), b = canon(r.b);
    if (!out.relations.some((x) => (key(x.a) === key(a) && key(x.b) === key(b) || key(x.a) === key(b) && key(x.b) === key(a)) && key(x.type) === key(r.type))) out.relations.push({ ...r, a, b });
  }
  const base = out.timeline.length;
  part.timeline.sort((x, y) => x.order - y.order).forEach((e, i) => out.timeline.push({ ...e, order: base + i + 1, characters: e.characters?.map(canon) }));
  for (const [list, items] of [[out.locations, part.locations], [out.props, part.props]] as const) {
    for (const t of items) { const hit = list.find((x) => key(x.name) === key(t.name)); if (!hit) list.push({ ...t }); else { hit.look ??= t.look; hit.note ??= t.note; } }
  }
  return out;
}

export const emptyExtraction = (): Extraction => ({ characters: [], relations: [], timeline: [], locations: [], props: [] });

export interface SeriesPlan {
  title?: string; logline?: string; synopsis?: string; genre?: string; arc?: string; episodes: StoryEpisode[];
  variants: Array<{ character: string; label: string; look: string; episodes: number[] }>;
}

/** Pedido do plano da série (episódios, arco e variações). */
export function seriesPrompt(ex: Extraction, o: { episodes: number; episodeSec: number; language?: string; title?: string }): string {
  const chars = ex.characters.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ''}: ${c.look ?? ''}`).join('\n');
  const tl = ex.timeline.map((e) => `${e.order}. ${e.event}${e.location ? ` [${e.location}]` : ''}`).join('\n').slice(0, 24000);
  return `Você é showrunner de séries curtas (doramas, novelas verticais, histórias animadas). Transforme esta história em uma SÉRIE de ${o.episodes} episódio(s) de ~${Math.round(o.episodeSec)} s cada, em ${o.language ?? 'pt-BR'}.
Cada episódio tem começo, virada e GANCHO no fim (o espectador quer o próximo); o arco da temporada avança em todo episódio; respeite a ordem da linha do tempo.

PERSONAGENS:
${chars || '—'}
CENÁRIOS: ${ex.locations.map((x) => x.name).join(', ') || '—'}
OBJETOS: ${ex.props.map((x) => x.name).join(', ') || '—'}
LINHA DO TEMPO:
${tl || '—'}

Responda SOMENTE com JSON:
{
  "title": "${o.title ?? ex.title ?? 'título da série'}",
  "logline": "1 frase que vende a série",
  "synopsis": "sinopse em 3–5 frases",
  "genre": "gênero",
  "arc": "arco da temporada em 2–3 frases",
  "episodes": [ { "n": 1, "title": "título do episódio", "summary": "o que acontece (3–4 frases)", "beats": ["4 a 8 batidas em ordem"], "cliffhanger": "gancho final",
    "characters": ["nomes EXATOS da lista"], "locations": ["nomes exatos"], "props": ["nomes exatos"], "variants": { "Nome do personagem": "rótulo da variação usada neste episódio" } } ],
  "variants": [ { "character": "nome exato", "label": "rótulo curto (ex.: vestido de noiva, 10 anos depois, ferido)", "look": "aparência COMPLETA nesta variação (rosto igual, muda roupa/idade/estado)", "episodes": [2, 3] } ]
}
Só crie variação quando a história pedir (troca de roupa marcante, salto de tempo, disfarce, ferimento). Exatamente ${o.episodes} episódios.`;
}

/** Normaliza o plano da série (nomes ligados à extração; numeração 1..N). */
export function normalizeSeries(raw: unknown, ex: Extraction, count: number): SeriesPlan {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const canon = (list: Array<{ name: string; aliases?: string[] }>) => (n: string) => list.find((x) => sameName(x, n))?.name;
  const cc = canon(ex.characters), cl = canon(ex.locations), cp = canon(ex.props);
  const names = (v: unknown, f: (n: string) => string | undefined) => [...new Set(strs(v, 12, 60).map(f).filter((x): x is string => !!x))];
  const variants = (Array.isArray(o['variants']) ? o['variants'] as unknown[] : []).map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>)
    .map((r) => ({ character: cc(String(r['character'] ?? '')) ?? '', label: str(r['label'], 60) ?? '', look: str(r['look'], 600) ?? '', episodes: (Array.isArray(r['episodes']) ? r['episodes'] as unknown[] : []).map(Number).filter((n) => Number.isInteger(n) && n > 0) }))
    .filter((v) => v.character && v.label && v.look);
  const eps = (Array.isArray(o['episodes']) ? o['episodes'] as unknown[] : []).map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>).slice(0, Math.max(1, count))
    .map((r, i): StoryEpisode => {
      const vr: Record<string, string> = {};
      const rv = r['variants'] && typeof r['variants'] === 'object' && !Array.isArray(r['variants']) ? r['variants'] as Record<string, unknown> : {};
      for (const [k, v] of Object.entries(rv)) { const n = cc(k); const l = str(v, 60); if (n && l && variants.some((x) => x.character === n && key(x.label) === key(l))) vr[n] = l; }
      for (const v of variants) if (v.episodes.includes(i + 1) && !vr[v.character]) vr[v.character] = v.label;
      return { n: i + 1, title: str(r['title'], 100) ?? `Episódio ${i + 1}`, summary: str(r['summary'], 900) ?? '', beats: strs(r['beats'], 10, 240), cliffhanger: str(r['cliffhanger'], 300),
        characters: names(r['characters'], cc), locations: names(r['locations'], cl), props: names(r['props'], cp), variants: Object.keys(vr).length ? vr : undefined };
    }).filter((e) => e.summary || e.beats.length);
  return { title: str(o['title'], 120), logline: str(o['logline'], 300), synopsis: str(o['synopsis'], 1200), genre: str(o['genre'], 60), arc: str(o['arc'], 800), episodes: eps, variants };
}

/* ───────── gravação ───────── */

export function listStories(s: Settings): Story[] {
  const root = storiesRoot(s);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((d) => SAFE.test(d)).map((d) => { try { return JSON.parse(fs.readFileSync(path.join(root, d, 'story.json'), 'utf8')) as Story; } catch { return undefined; } })
    .filter((x): x is Story => !!x).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function getStory(s: Settings, id: string): Story {
  try { return JSON.parse(fs.readFileSync(path.join(storyDir(s, id), 'story.json'), 'utf8')) as Story; } catch { throw new Error(`história não encontrada: ${id}`); }
}
export function saveStory(s: Settings, st: Story): Story {
  fs.mkdirSync(storyDir(s, st.id), { recursive: true });
  fs.writeFileSync(path.join(storyDir(s, st.id), 'story.json'), JSON.stringify(st, null, 2));
  return st;
}
export function deleteStory(s: Settings, id: string): void { fs.rmSync(storyDir(s, id), { recursive: true, force: true }); }

export interface ImportOptions { title?: string; episodes?: number; episodeSec?: number; language?: string; kind?: LibraryCharacter['kind']; maxChunks?: number }
export interface ImportDeps { llm: (prompt: string) => Promise<unknown>; log?: (l: string) => void; signal?: AbortSignal }

/** Cria/atualiza na Biblioteca os itens extraídos (não troca a aparência escrita pelo usuário). */
export function fillLibrary(s: Settings, storyId: string, ex: Extraction, plan: Pick<SeriesPlan, 'variants'>, kind: LibraryCharacter['kind'] = 'pessoa'): { created: string[]; updated: string[] } {
  const created: string[] = [], updated: string[] = [];
  const lib = listCharacters(s);
  const upsert = (entity: LibraryEntity, name: string, data: Partial<LibraryCharacter>) => {
    const hit = findByName(lib, name, entity);
    if (hit) {
      const aliases = [...new Set([...(hit.aliases ?? []), ...(data.aliases ?? [])])].filter((a) => key(a) !== key(hit.name));
      const variants = [...(hit.variants ?? []), ...(data.variants ?? []).filter((v) => !(hit.variants ?? []).some((x) => key(x.label) === key(v.label)))];
      saveCharacter(s, { ...hit, aliases, variants, storyId: hit.storyId ?? storyId });
      updated.push(hit.name);
    } else {
      const c = saveCharacter(s, { ...data, name, entity, storyId });
      lib.push(c); created.push(c.name);
    }
  };
  for (const c of ex.characters) {
    const vs = plan.variants.filter((v) => v.character === c.name).map((v) => ({ id: slugChar(v.label), label: v.label, look: v.look, episodes: v.episodes.length ? v.episodes : undefined }));
    upsert('character', c.name, { kind, look: c.look || `${c.name}, aparência a definir`, age: c.age, gender: c.gender, aliases: c.aliases,
      description: [c.role, c.personality].filter(Boolean).join(' — ') || undefined, voice: c.voice ? { description: c.voice } : undefined, variants: vs.length ? vs : undefined, tags: ['história'] });
  }
  for (const l of ex.locations) upsert('location', l.name, { kind: kind === 'pessoa' ? 'outro' : kind, look: l.look || l.name, description: l.note, tags: ['história'] });
  for (const p of ex.props) upsert('prop', p.name, { kind: kind === 'pessoa' ? 'outro' : kind, look: p.look || p.name, description: p.note, tags: ['história'] });
  return { created, updated };
}

/** Importa a história inteira: extrai trecho a trecho, planeja a série, grava e preenche a Biblioteca. */
export async function importStory(s: Settings, text: string, o: ImportOptions, deps: ImportDeps): Promise<{ story: Story; created: string[]; updated: string[]; warnings: string[] }> {
  const clean = text.replace(/\u0000/g, '').trim();
  if (clean.length < 200) throw new Error('texto curto demais para importar (cole o capítulo, conto ou romance)');
  const warnings: string[] = [];
  let chunks = chunkText(clean);
  const max = o.maxChunks ?? 40;
  if (chunks.length > max) { warnings.push(`texto longo: li os primeiros ${max} de ${chunks.length} trechos (≈ ${Math.round((max * 14000) / 1000)} mil caracteres)`); chunks = chunks.slice(0, max); }
  let ex = emptyExtraction();
  for (let i = 0; i < chunks.length; i++) {
    if (deps.signal?.aborted) throw new Error('cancelado');
    deps.log?.(`📖 lendo o trecho ${i + 1} de ${chunks.length}…`);
    try { ex = mergeExtraction(ex, normalizeExtraction(await deps.llm(extractPrompt(chunks[i]!, i, chunks.length, ex)))); }
    catch (e) { warnings.push(`trecho ${i + 1}: ${(e as Error).message.slice(0, 160)}`); }
  }
  if (!ex.characters.length) throw new Error(`a IA não encontrou personagens no texto${warnings.length ? ` (${warnings[0]})` : ''}`);
  const episodes = Math.max(1, Math.min(60, Math.round(o.episodes ?? Math.min(12, Math.max(1, Math.ceil(ex.timeline.length / 6))))));
  const episodeSec = Math.max(20, Math.min(600, o.episodeSec ?? 90));
  deps.log?.(`🎬 planejando a série: ${episodes} episódio(s)…`);
  let plan: SeriesPlan = { episodes: [], variants: [] };
  try { plan = normalizeSeries(await deps.llm(seriesPrompt(ex, { episodes, episodeSec, language: o.language, title: o.title })), ex, episodes); }
  catch (e) { warnings.push(`plano da série: ${(e as Error).message.slice(0, 160)}`); }
  const title = o.title?.trim() || plan.title || ex.title || 'História importada';
  let id = slugChar(title); for (let k = 2; fs.existsSync(path.join(storiesRoot(s), id)); k++) id = `${slugChar(title)}-${k}`;
  const story: Story = {
    id, title, logline: plan.logline, synopsis: plan.synopsis, genre: plan.genre ?? ex.genre, language: o.language, createdAt: new Date().toISOString(), sourceChars: clean.length,
    characters: ex.characters.map((c) => c.name), locations: ex.locations.map((l) => l.name), props: ex.props.map((p) => p.name),
    relations: ex.relations, timeline: ex.timeline, arc: plan.arc, episodeSec, episodes: plan.episodes,
  };
  saveStory(s, story);
  fs.writeFileSync(path.join(storyDir(s, id), 'source.txt'), clean);
  const lib = fillLibrary(s, id, ex, plan, o.kind);
  deps.log?.(`✓ ${lib.created.length} novo(s) na Biblioteca, ${lib.updated.length} atualizado(s), ${story.episodes.length} episódio(s)`);
  return { story, ...lib, warnings };
}

/* ───────── episódio → projeto ───────── */

/** Dados do Novo projeto para um episódio (ideia, elenco/cenários/objetos, variações e o bloco da série). */
export function episodeProject(st: Story, n: number, lib: LibraryCharacter[]): { name: string; idea: string; targetDurationSec: number; characterIds: string[]; variants: Record<string, string>; series: NonNullable<Project['series']>; missing: string[] } {
  const ep = st.episodes.find((e) => e.n === n);
  if (!ep) throw new Error(`episódio ${n} não existe`);
  const missing: string[] = [];
  const ids: string[] = [];
  const pick = (names: string[], entity: LibraryEntity) => { for (const nm of names) { const c = findByName(lib, nm, entity); if (c) ids.push(c.id); else missing.push(nm); } };
  pick(ep.characters.length ? ep.characters : st.characters.slice(0, 4), 'character');
  pick(ep.locations ?? [], 'location');
  pick(ep.props ?? [], 'prop');
  const variants: Record<string, string> = {};
  for (const [nm, label] of Object.entries(ep.variants ?? {})) { const c = findByName(lib, nm, 'character'); if (c) variants[c.id] = label; }
  const prev = st.episodes.filter((e) => e.n < n);
  const previously = prev.length ? [prev.length > 3 ? `(${prev.length - 3} episódio(s) antes destes) ` : '', ...prev.slice(-3).map((e) => `Ep. ${e.n} — ${e.title}: ${e.summary}${e.cliffhanger ? ` Gancho: ${e.cliffhanger}` : ''}`)].join(' ').slice(0, 1600) : undefined;
  const idea = [`Episódio ${n} de ${st.episodes.length} da série "${st.title}"${st.genre ? ` (${st.genre})` : ''}: ${ep.title}.`, ep.summary,
    ep.beats.length ? `Batidas, em ordem: ${ep.beats.map((b, i) => `${i + 1}) ${b}`).join(' ')}` : '', ep.cliffhanger ? `Termine com o gancho: ${ep.cliffhanger}` : ''].filter(Boolean).join('\n');
  return { name: `${st.title} — Ep. ${n}`, idea, targetDurationSec: st.episodeSec ?? 90, characterIds: [...new Set(ids)], variants, missing,
    series: { storyId: st.id, title: st.title, episode: n, total: st.episodes.length, previously, cliffhanger: ep.cliffhanger, arc: st.arc } };
}

/** Bloco da série para o prompt (roteiro, plano, metadados). Função pura. */
export function seriesBlock(p: Pick<Project, 'series'>, stepKind: string): string {
  const s = p.series;
  if (!s || !['brief', 'ideation', 'script', 'scene_plan', 'metadata'].includes(stepKind)) return '';
  if (stepKind === 'metadata') return `SÉRIE: este vídeo é o episódio ${s.episode} de ${s.total} de "${s.title}" — título com "Ep. ${s.episode}" e descrição que chama para o próximo episódio.`;
  return `SÉRIE "${s.title}" — EPISÓDIO ${s.episode} DE ${s.total}.${s.arc ? ` Arco da temporada: ${s.arc}` : ''}${s.previously ? `\nANTERIORMENTE: ${s.previously}` : ''}\n` +
    `Continue de onde a série parou (sem recontar tudo; no máximo 1 frase de "anteriormente" no início)${s.cliffhanger ? ` e TERMINE com o gancho: ${s.cliffhanger}` : ' e termine com um gancho para o próximo episódio'}.`;
}
