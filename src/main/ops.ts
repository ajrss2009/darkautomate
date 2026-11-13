import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ExecutorBypass, FinalEffects, Project, Watermark, Wan2gpPost, Route, Scene, SceneEffects, SceneKind, Settings, StepKind } from '../shared/types';
import { WAN2GP_SMOOTH, WAN2GP_UPSCALE } from '../shared/types';
import { compilationFields, projectDirOf, projectsDir } from './settings';
import { cleanSegments, migrateSceneFx } from '../shared/fx';
import { sfxDef } from './sfx';

const SCENE_KINDS: SceneKind[] = ['image', 'video', 'code', 'motion', 'mixed', 'stock'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function atomicWrite(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, file); }
  catch { fs.copyFileSync(tmp, file); fs.rmSync(tmp, { force: true }); }
}

/**
 * Grava o projeto. `scenes: false` não toca no scenes.json — use DURANTE uma execução: o motor é quem carrega as
 * cenas depois do plano, e espelhar a lista da memória (ainda vazia) apagava o plano recém-escrito pela IA.
 */
export function saveProjectFile(s: Settings, p: Project, o: { scenes?: boolean } = {}) {
  const dir = projectDirOf(s, p.id);
  reindex(p);
  atomicWrite(path.join(dir, 'project.json'), JSON.stringify(p, null, 2));
  if (o.scenes === false) return;
  // scenes.json espelha a lista de cenas (fonte lida pelo harness e pela etapa scene_plan)
  atomicWrite(path.join(dir, 'scenes.json'), JSON.stringify(p.scenes.map((x) => ({
    id: x.id, title: x.title, narration: x.narration, visualIntent: x.visualIntent,
    kind: x.kind, durationSec: x.durationSec, camera: x.camera, notes: x.notes, sfx: x.sfx, sfxCues: x.sfxCues,
    searchTerms: x.searchTerms, manualDuration: x.manualDuration, effects: x.effects, variation: x.variation,
    videoPrompt: x.videoPrompt, speaker: x.speaker, emotion: x.emotion, delivery: x.delivery, userMedia: x.userMedia, clipStart: x.clipStart, clipCrop: x.clipCrop, trimStart: x.trimStart,
  })), null, 2));
}

/** Resolve e valida que o diretório pertence ao workspace (anti path-traversal). */
export function safeProjectDir(s: Settings, id: string): string {
  if (!ID_RE.test(id)) throw new Error('id de projeto inválido');
  const dir = path.resolve(projectDirOf(s, id));
  const root = path.resolve(projectsDir(s)) + path.sep;
  if (!dir.startsWith(root)) throw new Error('caminho fora do workspace');
  return dir;
}

function deepReplace<T>(v: T, from: string, to: string): T {
  if (typeof v === 'string') return (v.split(from).join(to) as unknown) as T;
  if (Array.isArray(v)) return v.map((x) => deepReplace(x, from, to)) as unknown as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => [k, deepReplace(x, from, to)])) as T;
  }
  return v;
}

// ───────────── projetos ─────────────

/** Valida o bypass de executor vindo da interface (harness obrigatório; escopo text|code|ai). */
export function cleanBypass(v: unknown): ExecutorBypass | undefined {
  const b = v as Partial<ExecutorBypass> | null | undefined;
  if (!b || !b.binding || b.binding.type !== 'harness' || typeof b.binding.harness !== 'string' || !b.binding.harness.trim()) return undefined;
  return { binding: { type: 'harness', harness: b.binding.harness, model: b.binding.model?.trim() || undefined, effort: b.binding.effort },
    scope: b.scope === 'text' || b.scope === 'code' ? b.scope : 'ai', exclusive: !!b.exclusive, enabled: b.enabled !== false };
}

export function updateProject(s: Settings, id: string, patch: Partial<Pick<Project,
  'name' | 'idea' | 'aspect' | 'targetDurationSec' | 'language' | 'memories' | 'quality' | 'videoType' | 'maxProductionMin' | 'sceneConcurrency' | 'subtitleStyle' | 'scriptStyle' | 'videoStyle' | 'musicStyle' | 'musicMode' | 'waveform' | 'plugins' | 'finalEffects' | 'fxSegments' | 'musicVolume' | 'sfxVolume' | 'narrationVolume' | 'musicMinMin' | 'musicMaxMin' | 'musicTrackSec' | 'pluginStyles' | 'narrationVoice' | 'agyAccount' | 'flowAccount' | 'channelId' | 'audioFirst' | 'subtitles' | 'sceneSec' | 'executorBypass' | 'freeEngine' | 'codeMusic' | 'watermark' | 'wan2gpPost' | 'tracks'>>): Project {
  const p = readProject(s, id);
  const allowed = ['name', 'idea', 'aspect', 'targetDurationSec', 'language', 'memories', 'quality', 'videoType', 'maxProductionMin', 'sceneConcurrency', 'subtitleStyle', 'scriptStyle', 'videoStyle', 'musicStyle', 'musicMode', 'waveform', 'plugins'];
  Object.assign(p, Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && allowed.includes(k))));
  if ('tracks' in patch) {
    const t = (patch.tracks ?? {}) as NonNullable<Project['tracks']>;
    const clean: NonNullable<Project['tracks']> = {};
    for (const k of ['video', 'narration', 'music', 'sfx', 'subs', 'fx'] as const) {
      const v = t[k]; if (!v) continue;
      const s: { muted?: boolean; hidden?: boolean; locked?: boolean } = {};
      if (v.muted !== undefined) s.muted = !!v.muted;
      if (v.hidden !== undefined) s.hidden = !!v.hidden;
      if (v.locked !== undefined) s.locked = !!v.locked;
      if (Object.keys(s).length) clean[k] = s;
    }
    if (Object.keys(clean).length) p.tracks = clean; else delete p.tracks;
  }
  if ('freeEngine' in patch) { if (patch.freeEngine === '2d' || patch.freeEngine === '3d') p.freeEngine = patch.freeEngine; else delete p.freeEngine; }
  if ('flowAccount' in patch) { if (patch.flowAccount) p.flowAccount = patch.flowAccount; else delete p.flowAccount; }
  if ('agyAccount' in patch) { if (patch.agyAccount) p.agyAccount = patch.agyAccount; else delete p.agyAccount; }
  if ('channelId' in patch) { if (patch.channelId) p.channelId = patch.channelId; else delete p.channelId; }
  if ('watermark' in patch) { const w = cleanWatermark(patch.watermark); if (w) p.watermark = w; else delete p.watermark; }
  if ('wan2gpPost' in patch) { const w = cleanWan2gpPost(patch.wan2gpPost); if (w) p.wan2gpPost = w; else delete p.wan2gpPost; }
  if ('finalEffects' in patch) { const fe = cleanFinalEffects(patch.finalEffects); if (fe) p.finalEffects = fe; else delete p.finalEffects; }
  /* volumes da montagem (null = voltar ao padrão da rota) */
  for (const [k, max] of [['musicVolume', 1], ['sfxVolume', 1.5], ['narrationVolume', 2]] as const) if (k in patch) {
    const v = Number((patch as Record<string, unknown>)[k]);
    if ((patch as Record<string, unknown>)[k] === null || !Number.isFinite(v)) delete p[k]; else p[k] = Math.round(Math.min(max, Math.max(0, v)) * 100) / 100;
  }
  if ('musicMinMin' in patch || 'musicMaxMin' in patch || 'musicTrackSec' in patch) {
    const cf = compilationFields({ musicMinMin: patch.musicMinMin ?? p.musicMinMin, musicMaxMin: patch.musicMaxMin ?? p.musicMaxMin, musicTrackSec: patch.musicTrackSec ?? p.musicTrackSec });
    for (const k of ['musicMinMin', 'musicMaxMin', 'musicTrackSec'] as const) { if (cf[k] === undefined) delete p[k]; else p[k] = cf[k]; }
    if (p.musicMinMin && p.musicMaxMin) p.targetDurationSec = Math.round(((p.musicMinMin + p.musicMaxMin) / 2) * 60);
  }
  if ('narrationVoice' in patch) {
    const nv = patch.narrationVoice ?? {};
    const clean = { refAudio: typeof nv.refAudio === 'string' && nv.refAudio.trim() ? nv.refAudio.trim() : undefined, apiVoice: typeof nv.apiVoice === 'string' && nv.apiVoice.trim() ? nv.apiVoice.trim().slice(0, 64) : undefined };
    if (clean.refAudio || clean.apiVoice) p.narrationVoice = clean; else delete p.narrationVoice;
    /* voz nova: a narração das cenas precisa ser refeita */
    for (const sc of p.scenes) for (const st of p.route?.steps ?? []) if ((st.kind === 'narration' || st.kind === 'transcribe') && sc.status[st.id] === 'done') sc.status[st.id] = 'stale';
  }
  if ('pluginStyles' in patch) {
    const ps = Object.fromEntries(Object.entries(patch.pluginStyles ?? {}).filter(([k, v]) => /^[\w-]{1,64}$/.test(k) && typeof v === 'string' && /^[\w-]{1,64}$/.test(v)));
    if (Object.keys(ps).length) p.pluginStyles = ps; else delete p.pluginStyles;
  }
  if ('fxSegments' in patch) { const sg = cleanSegments(patch.fxSegments); if (sg) p.fxSegments = sg; else delete p.fxSegments; }
  if ('codeMusic' in patch) { if (patch.codeMusic === true) p.codeMusic = true; else delete p.codeMusic; }
  if ('audioFirst' in patch) { if (typeof patch.audioFirst === 'boolean') p.audioFirst = patch.audioFirst; else delete p.audioFirst; }
  if ('sceneSec' in patch) { const v = Number(patch.sceneSec); if (v > 0) p.sceneSec = Math.round(Math.max(3, Math.min(30, v)) * 10) / 10; else delete p.sceneSec; }
  if ('executorBypass' in patch) { const b = cleanBypass(patch.executorBypass); if (b) p.executorBypass = b; else delete p.executorBypass; }
  /* legendas: o modo manda; "gravar no vídeo" mantém subtitleStyle.burn coerente (o editor usa os dois) */
  if ('subtitles' in patch) {
    const m = patch.subtitles;
    if (m === 'off' || m === 'srt' || m === 'burn') { p.subtitles = m; p.subtitleStyle = { ...(p.subtitleStyle ?? { burn: false, position: 'bottom', size: 46, color: '#ffffff', box: true }), burn: m === 'burn' }; }
    else delete p.subtitles;
  }
  // 0 ou vazio = sem limite / modo sequencial
  if (!(Number(p.maxProductionMin) > 0)) delete p.maxProductionMin; else p.maxProductionMin = Math.round(Number(p.maxProductionMin));
  if (!(Number(p.sceneConcurrency) > 0)) delete p.sceneConcurrency; else p.sceneConcurrency = Math.min(8, Math.round(Number(p.sceneConcurrency)));
  if (!p.name.trim()) throw new Error('nome obrigatório');
  saveProjectFile(s, p);
  return p;
}

export function readProject(s: Settings, id: string): Project {
  const p = JSON.parse(fs.readFileSync(path.join(safeProjectDir(s, id), 'project.json'), 'utf8')) as Project;
  migrateSceneFx(p);   // filtro/vinheta antigos (por cena/vídeo final) → trechos da timeline
  return p;
}

export function deleteProject(s: Settings, id: string) {
  const dir = safeProjectDir(s, id);
  if (!fs.existsSync(path.join(dir, 'project.json'))) throw new Error('projeto não encontrado');
  fs.rmSync(dir, { recursive: true, force: true });
}

export function duplicateProject(s: Settings, id: string, name?: string): Project {
  const src = safeProjectDir(s, id);
  const p = readProject(s, id);
  const newId = `${id.replace(/-[0-9a-f]{6}$/, '')}-${crypto.randomBytes(3).toString('hex')}`.slice(0, 64);
  const dst = safeProjectDir(s, newId);
  fs.cpSync(src, dst, { recursive: true });
  const copy = deepReplace(p, src, dst);
  copy.id = newId;
  copy.name = name ?? `${p.name} (cópia)`;
  copy.createdAt = new Date().toISOString();
  saveProjectFile(s, copy);
  const idx = path.join(dst, 'cache', 'index.json');
  if (fs.existsSync(idx)) fs.writeFileSync(idx, JSON.stringify(deepReplace(JSON.parse(fs.readFileSync(idx, 'utf8')), src, dst), null, 2));
  return copy;
}

// ───────────── cenas ─────────────

export function reindex(p: Project) { p.scenes.forEach((x, i) => { x.index = i + 1; }); }

const sceneDir = (s: Settings, p: Project, sc: Scene) => path.join(projectDirOf(s, p.id), 'scenes', sc.id);
const findScene = (p: Project, id: string): Scene => {
  const sc = p.scenes.find((x) => x.id === id);
  if (!sc) throw new Error(`cena "${id}" não existe`);
  return sc;
};

function nextSceneId(p: Project): string {
  const nums = p.scenes.map((x) => parseInt(/^s(\d+)$/.exec(x.id)?.[1] ?? '0', 10));
  return `s${String(Math.max(0, ...nums) + 1).padStart(2, '0')}`;
}

export interface ScenePatch {
  title?: string; narration?: string; visualIntent?: string; kind?: SceneKind;
  durationSec?: number; camera?: string; notes?: string;
  subtitle?: string; effects?: SceneEffects;
  /** efeitos sonoros: "nome", "nome@segundos" ou "nome:palavra" */
  sfx?: string[];
  /** arquivo do usuário (assets/user) como visual da cena; "" = gerar normalmente */
  userMedia?: string;
  transform?: { reverse?: boolean; mirror?: boolean };
  audio?: { muted?: boolean };
}
export const FILTERS = ['none', 'bw', 'sepia', 'vivid', 'warm', 'cool', 'blur', 'cinematic', 'teal_orange', 'vintage', 'noir', 'matte', 'dramatic'];
const ZOOMS = ['none', 'in', 'out', 'pan_left', 'pan_right', 'pan_up', 'pan_down', 'in_left', 'in_right', 'shake', 'pulse', 'drift'];
export const TEXTURES = ['none', 'static', 'vhs', 'dust', 'old_film', 'crt', 'glitch', 'paper'];
const VIGNETTES = ['none', 'soft', 'strong'];
export const TRANSITIONS = ['none', 'fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideup', 'circleopen', 'circleclose', 'radial', 'pixelize', 'zoomin', 'hblur'];
const pick = <T extends string>(list: string[], v: unknown, def: T): T => (typeof v === 'string' && list.includes(v) ? v : def) as T;
/** Acabamento do vídeo final (validado). */
export function cleanFinalEffects(e: unknown): FinalEffects | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const x = e as Record<string, unknown>;
  const out: FinalEffects = { filter: pick(FILTERS, x['filter'], 'none'), vignette: pick(VIGNETTES, x['vignette'], 'none'), grain: !!x['grain'], letterbox: !!x['letterbox'] };
  return out.filter === 'none' && out.vignette === 'none' && !out.grain && !out.letterbox ? undefined : out;
}
/** Marca d'água (validada): precisa de texto ou imagem; posição, opacidade 5–100% e tamanho 1–60%. */
export function cleanWatermark(v: unknown): Watermark | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const x = v as Record<string, unknown>;
  const text = typeof x['text'] === 'string' ? x['text'].trim().slice(0, 120) : '', image = typeof x['image'] === 'string' ? x['image'].trim().slice(0, 600) : '';
  if (!text && !image) return undefined;
  return { enabled: x['enabled'] !== false, ...(text ? { text } : {}), ...(image ? { image } : {}), position: pick(['tl', 'tr', 'bl', 'br', 'center'], x['position'], 'br'),
    opacity: Math.round(Math.min(1, Math.max(0.05, Number(x['opacity']) || 0.6)) * 100) / 100, size: Math.round(Math.min(60, Math.max(1, Number(x['size']) || 6)) * 10) / 10 };
}
/** Pós-processamento do Wan2GP: só valores da lista; nada escolhido = desligado. */
export function cleanWan2gpPost(v: unknown): Wan2gpPost | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const x = v as Record<string, unknown>;
  const spatial = WAN2GP_UPSCALE.some(([k]) => k && k === x['spatial']) ? String(x['spatial']) : '';
  const temporal = WAN2GP_SMOOTH.some(([k]) => k && k === x['temporal']) ? String(x['temporal']) : '';
  return spatial || temporal ? { ...(spatial ? { spatial } : {}), ...(temporal ? { temporal } : {}) } : undefined;
}
export interface ChangeFlags { visual: boolean; audio: boolean }

function cleanPatch(patch: ScenePatch): ScenePatch {
  const out: ScenePatch = {};
  if (typeof patch.title === 'string') out.title = patch.title.slice(0, 200);
  if (typeof patch.narration === 'string') out.narration = patch.narration;
  if (typeof patch.visualIntent === 'string') out.visualIntent = patch.visualIntent;
  if (typeof patch.camera === 'string') out.camera = patch.camera;
  if (typeof patch.notes === 'string') out.notes = patch.notes;
  if (typeof patch.userMedia === 'string') out.userMedia = patch.userMedia.trim().slice(0, 400);
  if (typeof patch.subtitle === 'string') out.subtitle = patch.subtitle.slice(0, 2000);
  if (patch.effects && typeof patch.effects === 'object') {
    const e = patch.effects;
    out.effects = { filter: pick(FILTERS, e.filter, 'none'), zoom: pick(ZOOMS, e.zoom, 'none'), fadeIn: !!e.fadeIn, fadeOut: !!e.fadeOut,
      vignette: pick(VIGNETTES, e.vignette, 'none'), transition: pick(TRANSITIONS, e.transition, 'none'),
      transitionSec: Math.min(2, Math.max(0.2, Number(e.transitionSec) || 0.6)), texture: pick(TEXTURES, e.texture, 'none') };
    if (out.effects.texture === 'none') delete out.effects.texture;
  }
  if (Array.isArray(patch.sfx)) out.sfx = patch.sfx.map((x) => String(x).trim()).filter((x) => sfxDef(x.split(/[@:]/)[0]!)).slice(0, 8);
  if (patch.kind && SCENE_KINDS.includes(patch.kind)) out.kind = patch.kind;
  if (typeof patch.durationSec === 'number' && Number.isFinite(patch.durationSec) && patch.durationSec > 0 && patch.durationSec < 3600) out.durationSec = patch.durationSec;
  if (patch.transform && typeof patch.transform === 'object') out.transform = { reverse: !!patch.transform.reverse, mirror: !!patch.transform.mirror };
  if (patch.audio && typeof patch.audio === 'object') out.audio = { muted: !!patch.audio.muted };
  return out;
}

/** Atualiza campos e marca etapas afetadas como 'stale'. */
export function updateScene(p: Project, id: string, patch: ScenePatch): ChangeFlags {
  const sc = findScene(p, id);
  const c = cleanPatch(patch);
  const flags: ChangeFlags = { visual: false, audio: false };
  if (c.narration !== undefined && c.narration !== sc.narration) flags.audio = true;
  if ((c.visualIntent !== undefined && c.visualIntent !== sc.visualIntent) ||
      (c.kind !== undefined && c.kind !== sc.kind) ||
      (c.camera !== undefined && c.camera !== sc.camera) ||
      (c.notes !== undefined && c.notes !== sc.notes) ||
      (c.userMedia !== undefined && c.userMedia !== (sc.userMedia ?? ''))) flags.visual = true;
  if (c.userMedia === '') { delete c.userMedia; delete sc.userMedia; }
  if (c.durationSec !== undefined && c.durationSec !== sc.durationSec) sc.manualDuration = true;
  const sfxChanged = c.sfx !== undefined && JSON.stringify(c.sfx) !== JSON.stringify(sc.sfx ?? []);
  if (c.sfx && !c.sfx.length) { delete c.sfx; delete sc.sfx; }
  if (sfxChanged) delete sc.sfxCues;
  Object.assign(sc, c);
  markStale(p, sc, flags);
  if (sfxChanged) for (const st of p.route?.steps ?? []) if (st.kind === 'sfx' && sc.status[st.id] === 'done') sc.status[st.id] = 'stale';
  return flags;
}

const VISUAL_KINDS: StepKind[] = ['image', 'video', 'code_scene', 'motion_graphics', 'review', 'stock_media'];
const AUDIO_KINDS: StepKind[] = ['narration', 'transcribe'];
/** Com etapa de transcrição, cenas por código/motion dependem da sincronia com a narração. */
const SYNC_KINDS: StepKind[] = ['code_scene', 'motion_graphics'];

export function stepsFor(route: Route | undefined, flags: ChangeFlags): string[] {
  if (!route) return [];
  const synced = route.steps.some((x) => x.kind === 'transcribe' && x.enabled);
  return route.steps.filter((s) => s.scope === 'scene' && s.enabled &&
    ((flags.visual && VISUAL_KINDS.includes(s.kind)) || (flags.audio && (AUDIO_KINDS.includes(s.kind) || (synced && SYNC_KINDS.includes(s.kind)))))).map((s) => s.id);
}

function markStale(p: Project, sc: Scene, flags: ChangeFlags) {
  for (const st of stepsFor(p.route, flags)) if (sc.status[st] === 'done') sc.status[st] = 'stale';
}

export function addScene(s: Settings, p: Project, afterId: string | null, partial: ScenePatch = {}): Scene {
  const id = nextSceneId(p);
  const c = cleanPatch(partial);
  const sc: Scene = {
    id, index: 0, title: c.title ?? 'Nova cena', narration: c.narration ?? '', visualIntent: c.visualIntent ?? '',
    kind: c.kind ?? 'image', durationSec: c.durationSec ?? 4, camera: c.camera, notes: c.notes,
    manualDuration: c.durationSec !== undefined, status: {}, artifacts: {},
  };
  const at = afterId ? p.scenes.findIndex((x) => x.id === afterId) + 1 : p.scenes.length;
  p.scenes.splice(Math.max(0, at), 0, sc);
  fs.mkdirSync(sceneDir(s, p, sc), { recursive: true });
  reindex(p);
  return sc;
}

export function deleteScene(s: Settings, p: Project, id: string) {
  const sc = findScene(p, id);
  p.scenes = p.scenes.filter((x) => x.id !== id);
  fs.rmSync(sceneDir(s, p, sc), { recursive: true, force: true });
  reindex(p);
}

export function moveScene(p: Project, id: string, toIndex: number) {
  const from = p.scenes.findIndex((x) => x.id === id);
  if (from < 0) throw new Error(`cena "${id}" não existe`);
  const [sc] = p.scenes.splice(from, 1);
  p.scenes.splice(Math.min(Math.max(0, toIndex), p.scenes.length), 0, sc!);
  reindex(p);
}

export function duplicateScene(s: Settings, p: Project, id: string): Scene {
  const src = findScene(p, id);
  const newId = nextSceneId(p);
  const from = sceneDir(s, p, src);
  const copy: Scene = deepReplace(JSON.parse(JSON.stringify(src)) as Scene, from, path.join(path.dirname(from), newId));
  copy.id = newId;
  copy.title = `${src.title} (cópia)`;
  if (fs.existsSync(from)) fs.cpSync(from, path.join(path.dirname(from), newId), { recursive: true });
  p.scenes.splice(p.scenes.findIndex((x) => x.id === id) + 1, 0, copy);
  reindex(p);
  return copy;
}

/** Soma de durações previstas (para a timeline). */
export const totalDuration = (p: Project) => p.scenes.reduce((a, x) => a + (x.durationSec ?? 4), 0);
