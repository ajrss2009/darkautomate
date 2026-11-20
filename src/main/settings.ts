import * as fs from 'node:fs';
import { FISH_MODELS, GEMINI_TTS_MODELS, GEMINI_TTS_VOICES, GTTS_MODELS, GTTS_VOICES } from './providers';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Agent, Aspect, CastMember, ExecutorProfile, Project, Route, RouteStep, Settings, Skill, StockSource, SubtitleStyle, VideoTypeId, Watermark, Binding, HarnessId } from '../shared/types';
import { getAgent, getAnyRoute, getFold, getSkill, getType } from './library';
import { DEFAULT_HARNESSES } from './harness';
import { applyProfile, applyQuality, getVideoType, type Profile } from './presets';
import { allProfiles, applyExecutorProfile, applyStepBindings, profileSkips } from '../shared/profiles';
import { pluginRecommendations } from './plugins';
import { dnaSceneSec, dnaSubtitleStyle } from './channel-dna';
import { subtitleFontName } from '../shared/subtitle-fonts';
import { normalizePalette } from './channel-setup';
import { applyCharacters } from './characters';
import { userStyleRef } from './style-ref';
import { copyKitIntoProject } from './kit-import';
import { normalizeMix } from './skill-mix';
import { routeSceneKinds } from './prompts';
import { DEFAULT_DISCLOSURE } from './disclosure';

export const DEFAULT_SNAPGEN_PROVIDER: Settings['providers'][number] = {
  id: 'snapgen', kind: 'snapgen', baseUrl: 'https://api.snapgen.ai', apiKey: '',
  models: ['nano-banana-pro', 'nano-banana-2', 'nano-banana-2-lite', 'veo-3.1-fast', 'veo-3.1', 'veo-2', 'omni-flash'],
  modelCategories: {
    'nano-banana-pro': 'image', 'nano-banana-2': 'image', 'nano-banana-2-lite': 'image',
    'veo-3.1-fast': 'video', 'veo-3.1': 'video', 'veo-2': 'video', 'omni-flash': 'video',
  },
  categories: ['image', 'video'],
};

/** Voz do Google sem chave (a do Google Tradutor): vem pronta, uma voz por idioma/sotaque. */
export const DEFAULT_GTTS_PROVIDER: Settings['providers'][number] = {
  id: 'google-gratis', kind: 'gtts', baseUrl: 'https://translate.google.com', apiKey: '',
  models: [...GTTS_MODELS],
  modelCategories: Object.fromEntries(GTTS_MODELS.map((m) => [m, 'voice' as const])),
  categories: ['voice'],
  voices: Object.keys(GTTS_VOICES),
  voiceLabels: Object.fromEntries(Object.entries(GTTS_VOICES).map(([k, v]) => [k, v.label])),
};

export const DEFAULT_FISH_PROVIDER: Settings['providers'][number] = {
  id: 'fish', kind: 'fish', baseUrl: 'https://api.fish.audio', apiKey: '',
  models: [...FISH_MODELS],
  modelCategories: Object.fromEntries(FISH_MODELS.map((m) => [m, 'voice' as const])),
  categories: ['voice'],
  voices: [],
};

export const DEFAULT_THUMBNAILS = [
  { id: 'impacto', name: 'Impacto (assunto grande + texto curto)', prompt: 'YouTube thumbnail, 16:9, one large clear subject on the left, dramatic rim light, saturated contrasting colors, bold 3-word title text "{{thumb_text}}" in thick sans-serif, high contrast, topic: {{title}}' },
  { id: 'explicativo', name: 'Explicativo (ilustraÃ§Ã£o limpa)', prompt: 'YouTube thumbnail, 16:9, clean {{style}} illustration explaining {{title}}, big readable text "{{thumb_text}}", simple background, three-color palette' },
  { id: 'documentario', name: 'DocumentÃ¡rio (cinematogrÃ¡fico)', prompt: 'YouTube thumbnail, 16:9, cinematic documentary still about {{title}}, moody lighting, shallow depth of field, small elegant title "{{thumb_text}}"' },
];

export function defaultSettings(workspace: string): Settings {
  return {
    workspace,
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    harnesses: JSON.parse(JSON.stringify(DEFAULT_HARNESSES)),
    comfyServers: [{ id: 'local', url: 'http://127.0.0.1:8188', freeAfter: false }],
    wan2gp: { root: '', python: 'python', cliArgs: [] },
    wan2gpModels: [],
    defaults: { imageWorkflow: 'krea2-turbo-t2i.json', videoWorkflow: 'minimax-h3-ref2v.json', sceneConcurrency: 3 },
    stock: { pexels: {}, pixabay: {}, wikipedia: {}, youtube: {} },
    whisper: { python: 'python', model: 'small', device: 'auto' },
    thumbnails: DEFAULT_THUMBNAILS,
    providers: [
      { id: 'openai', kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: ['gpt-4.1', 'gpt-image-1', 'gpt-4o-mini-tts'], categories: ['text', 'image', 'voice'], voices: ['alloy', 'nova', 'onyx'] },
      { id: 'gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: '', models: ['gemini-2.5-flash-image', ...GEMINI_TTS_MODELS], modelCategories: Object.fromEntries(GEMINI_TTS_MODELS.map((m) => [m, 'voice' as const])), categories: ['text', 'image', 'voice'], voices: [...GEMINI_TTS_VOICES] },
      { id: 'seedance', kind: 'seedance', baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3', apiKey: '', models: ['seedance-1-0-pro-250528'], categories: ['video'] },
      { ...DEFAULT_SNAPGEN_PROVIDER, apiKey: '' },
      { ...DEFAULT_FISH_PROVIDER, apiKey: '' },
      { ...DEFAULT_GTTS_PROVIDER },
    ],
    memories: [],
    uiLanguage: 'pt-BR',
  };
}

/** Pasta dos projetos: a escolhida pelo usuÃ¡rio ou <workspace>/projects. */
export const projectsDir = (s: Settings) => (s.projectsDir?.trim() ? path.resolve(s.projectsDir.trim()) : path.join(s.workspace, 'projects'));

export const DEFAULT_SUBTITLES: SubtitleStyle = { burn: false, position: 'bottom', size: 46, color: '#ffffff', box: true };

/** Etapa inicial em que o orquestrador escreve brief.md (todas as raÃ­zes da rota passam a depender dela). */
export function withOrchestrator(steps: RouteStep[], orch: Agent): RouteStep[] {
  if (steps.some((s) => s.id === 'brief')) return steps;
  const brief: RouteStep = { id: 'brief', kind: 'brief', label: `Brief do orquestrador (${orch.name})`, scope: 'project', dependsOn: [], enabled: true, params: {},
    retry: { max: 2, backoffMs: 1500 }, timeoutSec: 900, bindings: [{ type: 'harness', harness: orch.harness ?? 'auto', model: orch.model || undefined }] };
  return [brief, ...steps.map((s) => (s.dependsOn.length === 0 ? { ...s, dependsOn: ['brief'] } : s))];
}
export const projectDirOf = (s: Settings, id: string) => path.join(projectsDir(s), id);

export function listProjects(s: Settings): Array<Pick<Project, 'id' | 'name' | 'videoType' | 'createdAt' | 'foldId' | 'channelId'>> {
  const dir = projectsDir(s);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((id) => {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, id, 'project.json'), 'utf8')) as Partial<Project>;
      /* pastas de outro programa (ou project.json de outro esquema) nÃ£o sÃ£o projetos do FilmForge:
         sem id/nome, a linha nÃ£o serve para nada e sÃ³ polui a lista */
      if (!p?.id && !p?.name) return [];
      return [{ id: p.id || id, name: p.name || id, videoType: p.videoType as Project['videoType'], createdAt: p.createdAt ?? '', foldId: p.foldId, channelId: p.channelId }];
    } catch { return []; }
  }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function loadProject(s: Settings, id: string): Project {
  return JSON.parse(fs.readFileSync(path.join(projectDirOf(s, id), 'project.json'), 'utf8')) as Project;
}

export interface NewProjectInput {
  name: string; idea: string; videoType: VideoTypeId; aspect?: Aspect; targetDurationSec?: number;
  language?: string; routeId?: string; quality?: Project['quality']; profile?: Profile | 'default';
  typeId?: string; skillId?: string; presentation?: 'generated' | 'mixed'; mediaSources?: StockSource[]; thumbnailTemplate?: string;
  scriptStyle?: string; videoStyle?: string;
  musicStyle?: string;
  musicMode?: 'instrumental' | 'song';
  waveform?: import('../shared/types').WaveformStyle;
  waveformColor?: string;
  /** coletÃ¢nea: um loop diferente para cada mÃºsica (uma cena por faixa) em vez do mesmo loop para todas */
  perTrackLoop?: boolean;
  musicMinMin?: number; musicMaxMin?: number; musicTrackSec?: number;
  maxProductionMin?: number; sceneConcurrency?: number;
  orchestratorId?: string; workerIds?: string[];
  /** plugins (formato Claude) aplicados ao projeto */
  plugins?: string[];
  /** estilo escolhido nos plugins de estilos (pluginId â†’ styleId) */
  pluginStyles?: Record<string, string>;
  /** voz da narraÃ§Ã£o deste projeto (vence a da rota) */
  narrationVoice?: { refAudio?: string; apiVoice?: string };
  /** enviar ao YouTube ao terminar (etapa de publicaÃ§Ã£o acrescentada Ã  rota) */
  autoUpload?: { account?: string; visibility?: 'UNLISTED' | 'PRIVATE' | 'PUBLIC' };
  /** conta (AutomaÃ§Ãµes) do Antigravity para este projeto */
  agyAccount?: string;
  /** conta (AutomaÃ§Ãµes) do Google Flow para este projeto */
  flowAccount?: string;
  /** canal (aba Canais) de destino deste vÃ­deo; vazio = pergunta na hora de publicar */
  channelId?: string;
  /** perfil de executores (id de um perfil padrÃ£o ou do usuÃ¡rio) */
  executorProfile?: string;
  /** executores escolhidos sÃ³ para este projeto (janela "Provedores"); vencem o perfil */
  executorChains?: ExecutorProfile['chains'];
  /** executor por etapa (id da etapa â†’ harness/modelo): vence o perfil e as categorias */
  executorSteps?: Record<string, Binding>;
  /** reservas de harness deste projeto (vencem as da rota e as das ConfiguraÃ§Ãµes); vazio = padrÃ£o */
  harnessFallback?: HarnessId[];
  /** vÃ­deo livre em 2D (Canvas + plugins) ou 3D (Three.js); indefinido = 2D, ou 3D se a ideia pede */
  freeEngine?: '2d' | '3d';
  /** divulgação contínua (11/2026) + perfil exato do gerador (catálogo XLIV) + contrato de prompt */
  disclosure?: import('../shared/types').Disclosure;
  generator_profile?: import('../shared/types').GeneratorProfile;
  prompt_format?: import('../shared/types').PromptFormat;
  /** marca d'Ã¡gua / texto de marca jÃ¡ no projeto novo (o editor continua podendo mudar) */
  watermark?: Watermark;
  /** sem reserva neste projeto (true/false vence as ConfiguraÃ§Ãµes; indefinido = padrÃ£o) */
  noFallback?: boolean;
  /** elenco: personagem â†’ voz (skills com vÃ¡rias vozes) */
  cast?: CastMember[];
  /** dobra de nicho usada por este projeto (id em library/folds) */
  foldId?: string;
  /** estrutura de tÃ­tulo da referÃªncia + tÃ­tulo escolhido nas sugestÃµes */
  titleModel?: Project['titleModel'];
  /** legendas da fala (ausente = padrÃ£o das ConfiguraÃ§Ãµes, que Ã© 'off') */
  subtitles?: Project['subtitles'];
  /** fonte da legenda escolhida no Novo projeto (ausente = a padrÃ£o do tipo) */
  subtitleFont?: string;
  /** tipo/estilo da legenda escolhido no Novo projeto (ausente = o do canal/skill) */
  subtitleKind?: SubtitleStyle['kind'];
  /** narrar todas as cenas antes dos clipes (ausente = padrÃ£o das ConfiguraÃ§Ãµes) */
  audioFirst?: boolean;
  /** trilha sonora por cÃ³digo (vence a da rota) */
  codeMusic?: boolean;
  /** criar storyboard depois do plano de cenas; approval = pausar atÃ© o usuÃ¡rio aprovar */
  storyboard?: { enabled?: boolean; approval?: boolean; sketches?: { mode?: 'sketch' | 'frame' | 'both'; count?: number } };
  /** itens da biblioteca (personagens, cenÃ¡rios, objetos â€” ids) */
  characterIds?: string[];
  /** variaÃ§Ã£o de cada personagem neste projeto (id â†’ rÃ³tulo/id da variaÃ§Ã£o) */
  characterVariants?: Record<string, string>;
  /** episÃ³dio de uma sÃ©rie importada (Biblioteca â†’ HistÃ³rias) */
  series?: Project['series'];
  /** estilo extraÃ­do de uma imagem de referÃªncia */
  styleRef?: Project['styleRef'];
  /** fala gerada pelo MiniMax H3 no prÃ³prio vÃ­deo */
  h3Speech?: boolean;
  /** dublagem (TTS + lÃ¡bios no H3, padrÃ£o) ou clonagem (voz gerada pelo H3) */
  h3SpeechMode?: 'dub' | 'clone' | 'internal';
  /** vÃ¡rias skills com percentual (a 1Âª Ã© a principal e deve ser a skillId) */
  skillMix?: Array<{ skillId: string; pct: number }>;
  skillMixMode?: import('../shared/types').SkillMixMode;
  /** paleta do vÃ­deo e da thumbnail escolhida no Novo projeto */
  palette?: Project['palette'];
}

/** ColetÃ¢nea: mÃ­nimo/mÃ¡ximo em minutos (1â€“240) e faixa de 60â€“300 s; a duraÃ§Ã£o alvo fica no meio. */
export function compilationFields(i: { musicMinMin?: number; musicMaxMin?: number; musicTrackSec?: number }): { musicMinMin?: number; musicMaxMin?: number; musicTrackSec?: number } {
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
  let min = n(i.musicMinMin), max = n(i.musicMaxMin);
  if (min === undefined && max === undefined) return { musicTrackSec: n(i.musicTrackSec) ? Math.round(Math.min(300, Math.max(60, n(i.musicTrackSec)!))) : undefined };
  min = Math.min(240, Math.max(1, min ?? max!)); max = Math.min(240, Math.max(min, max ?? min));
  return { musicMinMin: Math.round(min * 10) / 10, musicMaxMin: Math.round(max * 10) / 10, musicTrackSec: n(i.musicTrackSec) ? Math.round(Math.min(300, Math.max(60, n(i.musicTrackSec)!))) : undefined };
}

/** Interface/IPC: skill e rota sÃ£o obrigatÃ³rias (o usuÃ¡rio sempre escolhe). */
export function assertSkillAndRoute(i: Pick<NewProjectInput, 'skillId' | 'routeId'>): void {
  if (!i.skillId) throw new Error('Escolha uma skill (tipo de vÃ­deo).');
  if (!i.routeId) throw new Error('Escolha uma rota.');
}

/** Uma rota "de cenas" tem a etapa scene_plan; a rota de vÃ­deo livre tem sÃ³ a etapa free. */
const routeHasKind = (r: Route | undefined, kind: string) => !!r?.steps?.some((st) => st.enabled && st.kind === kind);

/**
 * MantÃ©m skill e rota coerentes. Bug clÃ¡ssico: escolher uma skill que pede cenas
 * (ex.: "Explicativo por cÃ³digo") e uma rota de vÃ­deo livre (sÃ³ `free`) â†’ o projeto
 * nasce sem scene_plan, sem scenes.json e sem cenas no editor. Aqui a rota Ã© trocada
 * pela rota da prÃ³pria skill (ou pela rota padrÃ£o da aparÃªncia).
 */
function reconcileRoute(s: Settings, skill: Skill | undefined, route: Route, appearance: VideoTypeId): Route {
  if (!skill) return route;
  if (skill.freeform) return routeHasKind(route, 'free') ? route : (getAnyRoute(s, 'video-livre') ?? route);
  if (routeHasKind(route, 'scene_plan')) return route;
  /* rota de kit com motor prÃ³prio: o filme inteiro sai do motor do kit (nÃ£o hÃ¡ cenas para planejar) */
  if (route.steps.some((st) => st.enabled && st.bindings.some((b) => b.type === 'builtin' && b.tool === 'kit-film'))) return route;
  const candidates = [skill.routeId, getVideoType(appearance)?.defaultRoute].filter((x): x is string => !!x);
  for (const id of candidates) {
    const candidate = getAnyRoute(s, id);
    if (candidate && routeHasKind(candidate, 'scene_plan')) return candidate;
  }
  return route;
}

export function createProject(s: Settings, input: NewProjectInput): Project {
  const ctype = input.typeId ? getType(s, input.typeId) : undefined;
  if (input.typeId && !ctype) throw new Error(`Tipo de vÃ­deo "${input.typeId}" nÃ£o existe`);
  const skillId = input.skillId ?? ctype?.skillId;
  const skill = skillId ? getSkill(s, skillId) : undefined;
  if (skillId && !skill) throw new Error(`Skill "${skillId}" nÃ£o existe`);
  const appearance = (input.videoType && input.videoType !== 'custom' ? input.videoType : ctype?.appearance ?? skill?.appearance ?? input.videoType) as VideoTypeId;
  const vt = getVideoType(appearance) ?? getVideoType('custom')!;
  const routeId = input.routeId ?? ctype?.routeId ?? skill?.routeId ?? vt.defaultRoute;
  const routeBase = getAnyRoute(s, routeId);
  if (!routeBase) throw new Error(`Rota "${routeId}" nÃ£o existe`);
  let route = reconcileRoute(s, skill, routeBase, appearance);
  const orch = input.orchestratorId ? getAgent(s, input.orchestratorId) : undefined;
  if (input.orchestratorId && (!orch || orch.role !== 'orchestrator')) throw new Error(`Orquestrador "${input.orchestratorId}" nÃ£o existe`);
  const workers = (input.workerIds ?? []).map((id) => { const a = getAgent(s, id); if (!a || a.role !== 'worker') throw new Error(`Obreiro "${id}" nÃ£o existe`); return a; });
  if (orch) route = { ...route, steps: withOrchestrator(route.steps, orch) };
  if (input.profile && input.profile !== 'default') route = applyProfile(route, input.profile);
  /* perfil de executores: quem executa cada categoria (a rota continua dizendo o que fazer) */
  const prof = input.executorProfile ? allProfiles(s.executorProfiles).find((x) => x.id === input.executorProfile) : undefined;
  if (input.executorProfile && !prof) throw new Error(`Perfil de executores "${input.executorProfile}" nÃ£o existe`);
  if (prof) route = applyExecutorProfile(route, prof);
  if (input.executorChains && Object.values(input.executorChains).some((c) => c?.length)) route = applyExecutorProfile(route, { id: 'projeto', name: 'SÃ³ neste projeto', chains: input.executorChains }, true);
  /* LLM indicada pelos plugins do projeto (ex.: Claude Opus em cenas por cÃ³digo): vai Ã  frente da cadeia
     dessas etapas; os executores da rota ficam de reserva. Escolha explÃ­cita por etapa (abaixo) vence. */
  /* plugins da skill (ex.: skill importada de um SKILL.md) + os escolhidos no formulÃ¡rio */
  const allPlugins = [...new Set([...(skill?.plugins ?? []), ...(input.plugins ?? [])].filter((x) => typeof x === 'string' && x.trim()))];
  const recs = pluginRecommendations(s, allPlugins);
  if (recs.size) {
    route = { ...route, steps: route.steps.map((st) => {
      const rec = recs.get(st.kind)?.filter((b) => b.type !== 'harness' || b.harness === 'auto' || !!s.harnesses[b.harness]);
      if (!rec?.length || profileSkips(st) || input.executorSteps?.[st.id]) return st;
      const key = (b: Binding) => JSON.stringify(b);
      return { ...st, bindings: [...rec.map((b) => JSON.parse(JSON.stringify(b)) as Binding), ...st.bindings.filter((b) => !rec.some((r) => key(r) === key(b)))] };
    }) };
  }
  if (input.executorSteps && Object.keys(input.executorSteps).length) route = applyStepBindings(route, input.executorSteps);
  route = applyQuality(route, input.quality ?? 'standard');
  const fb = (input.harnessFallback ?? []).filter((x, i, a) => !!s.harnesses[x] && a.indexOf(x) === i);
  if (fb.length) route = { ...route, harnessFallback: fb };
  if (typeof input.noFallback === 'boolean') route = { ...route, noFallback: input.noFallback };
  if (input.autoUpload && !route.steps.some((st) => st.bindings.some((b) => b.type === 'builtin' && b.tool === 'youtube-upload'))) {
    const after = route.steps.filter((st) => st.enabled && ['edit', 'metadata', 'thumbnail', 'review'].includes(st.kind) && st.scope === 'project').map((st) => st.id);
    route = { ...route, steps: [...route.steps, { id: 'publish', kind: 'publish', label: 'Enviar ao YouTube (nÃ£o listado)', scope: 'project', dependsOn: after, enabled: true, optional: true, onFail: 'skip',
      params: { account: input.autoUpload.account, visibility: input.autoUpload.visibility ?? 'UNLISTED' }, retry: { max: 1, backoffMs: 5000 }, timeoutSec: 3600, bindings: [{ type: 'builtin', tool: 'youtube-upload' }] }] };
  }
  /* campos de mÃºsica sÃ³ valem em rotas de mÃºsica (o formulÃ¡rio sempre envia musicMode) */
  const musicRoute = route.steps.some((st) => st.enabled && st.bindings.some((b) => b.type === 'builtin' && (b.tool === 'clip-musical' || b.tool === 'lyric-song')));
  const clipRoute = route.steps.some((st) => st.enabled && st.bindings.some((b) => b.type === 'builtin' && b.tool === 'clip-musical'));
  if (clipRoute && input.perTrackLoop !== undefined) route = { ...route, steps: route.steps.map((st) => (st.bindings.some((b) => b.type === 'builtin' && b.tool === 'clip-musical') ? { ...st, params: { ...st.params, perTrackLoop: !!input.perTrackLoop } } : st)) };
  const cast = (input.cast ?? []).map((m) => ({ speaker: String(m.speaker ?? '').trim(), refAudio: m.refAudio?.trim() || undefined, voice: m.voice?.trim() || undefined, description: m.description?.trim() || undefined })).filter((m) => m.speaker);
  const fold = input.foldId ? getFold(s, input.foldId) : undefined;
  if (input.foldId && !fold) throw new Error(`Dobra de nicho "${input.foldId}" nÃ£o existe`);
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'video';
  const id = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
  const project: Project = {
    id, name: input.name, idea: input.idea, videoType: vt.id,
    aspect: input.aspect ?? ctype?.aspect ?? skill?.aspect ?? vt.defaultAspect, targetDurationSec: input.targetDurationSec ?? ctype?.durationSec ?? skill?.durationSec ?? vt.defaultDurationSec,
    language: input.language ?? ctype?.language ?? skill?.language ?? 'pt-BR', routeId: route.id, route, quality: input.quality ?? 'standard',
    memories: [...s.memories], scenes: [], createdAt: new Date().toISOString(),
    typeId: ctype?.id, skill: skill ? JSON.parse(JSON.stringify(skill)) : undefined,
    presentation: input.presentation ?? ctype?.presentation ?? skill?.presentation ?? 'generated',
    mediaSources: input.mediaSources ?? ctype?.mediaSources ?? skill?.mediaSources ?? [],
    skillId: skill?.id,
    scriptStyle: input.scriptStyle?.trim() || undefined, videoStyle: input.videoStyle?.trim() || undefined,
    musicStyle: musicRoute ? input.musicStyle?.trim() || undefined : undefined,
    musicMode: !musicRoute ? undefined : input.musicMode === 'song' ? 'song' : input.musicMode === 'instrumental' ? 'instrumental' : undefined,
    waveform: musicRoute ? input.waveform : undefined,
    waveformColor: musicRoute && /^#[0-9a-f]{6}$/i.test(input.waveformColor ?? '') ? input.waveformColor : undefined,
    codeMusic: input.codeMusic && !musicRoute ? true : undefined,
    ...(clipRoute ? compilationFields(input) : {}),
    cast: cast.length ? cast : undefined,
    executorProfile: prof?.id,
    channelId: input.channelId?.trim() || undefined,
    storyboard: input.storyboard?.enabled ? { enabled: true, approval: !!input.storyboard.approval,
      ...(input.storyboard.approval && input.storyboard.sketches?.mode ? { sketches: { mode: (['sketch', 'frame', 'both'] as const).includes(input.storyboard.sketches.mode) ? input.storyboard.sketches.mode : 'both', count: Math.max(1, Math.min(4, Math.round(Number(input.storyboard.sketches.count) || 2))) } } : {}) } : undefined,
    series: input.series?.storyId ? { ...input.series, title: String(input.series.title ?? '').slice(0, 120), episode: Math.max(1, Math.round(Number(input.series.episode) || 1)), total: Math.max(1, Math.round(Number(input.series.total) || 1)) } : undefined,
    styleRef: userStyleRef(input.styleRef),
    h3Speech: input.h3Speech ? true : undefined,
    h3SpeechMode: input.h3SpeechMode === 'clone' || input.h3SpeechMode === 'internal' ? input.h3SpeechMode : undefined,
    maxProductionMin: input.maxProductionMin && input.maxProductionMin > 0 ? Math.round(input.maxProductionMin) : undefined,
    sceneConcurrency: input.sceneConcurrency && input.sceneConcurrency > 0 ? Math.min(8, Math.round(input.sceneConcurrency)) : undefined,
    agents: orch || workers.length ? JSON.parse(JSON.stringify({ orchestrator: orch, workers })) : undefined,
    plugins: allPlugins.length ? allPlugins : undefined,
    /* legendas: opÃ§Ã£o do projeto (padrÃ£o: nÃ£o gerar) â€” "gravar no vÃ­deo" liga o burn do estilo */
    ...(input.freeEngine === '2d' || input.freeEngine === '3d' ? { freeEngine: input.freeEngine } : {}),
    ...(input.watermark?.enabled && (input.watermark.text?.trim() || input.watermark.image)
      ? { watermark: { enabled: true, text: input.watermark.text?.trim().slice(0, 120) || undefined, image: input.watermark.image || undefined,
        position: (['tl', 'tr', 'bl', 'br', 'center'] as const).includes(input.watermark.position) ? input.watermark.position : 'br',
        opacity: Math.max(0.05, Math.min(1, Number(input.watermark.opacity) || 0.6)), size: Math.max(4, Math.min(60, Number(input.watermark.size) || 12)) } }
      : {}),
    /* divulgação contínua: padrão do app quando o projeto publica (diretrizes 11/2026) */
    disclosure: input.disclosure ? {
      label: String(input.disclosure.label || DEFAULT_DISCLOSURE.label).slice(0, 160),
      position_sec: Math.max(0, Math.min(2, Number(input.disclosure.position_sec ?? DEFAULT_DISCLOSURE.position_sec))),
      visible_whole: input.disclosure.visible_whole !== false,
      platform_tool: input.disclosure.platform_tool !== false,
      ai_label: input.disclosure.ai_label !== false,
      music_genai: input.disclosure.music_genai !== false,
    } : { ...DEFAULT_DISCLOSURE },
    generator_profile: input.generator_profile ?? undefined,
    prompt_format: input.prompt_format ?? undefined,
    subtitles: ['off', 'srt', 'burn'].includes(String(input.subtitles)) ? input.subtitles : (s.defaults?.subtitles ?? 'off'),
    subtitleStyle: { ...DEFAULT_SUBTITLES, burn: (input.subtitles ?? s.defaults?.subtitles) === 'burn',
      ...(subtitleFontName(input.subtitleFont) ? { font: subtitleFontName(input.subtitleFont) } : {}),
      ...(input.subtitleKind ? { kind: input.subtitleKind, box: input.subtitleKind === 'box' } : {}) },
    audioFirst: typeof input.audioFirst === 'boolean' ? input.audioFirst : undefined,
    thumbnailTemplate: input.thumbnailTemplate ?? (input.channelId ? (s.channels ?? []).find((c) => c.id === input.channelId?.trim())?.thumbnailTemplate : undefined) ?? skill?.thumbnailTemplate,
    pluginStyles: input.pluginStyles && Object.keys(input.pluginStyles).length ? { ...input.pluginStyles } : undefined,
    agyAccount: input.agyAccount?.trim() || undefined,
    flowAccount: input.flowAccount?.trim() || undefined,
    narrationVoice: input.narrationVoice?.refAudio || input.narrationVoice?.apiVoice ? { refAudio: input.narrationVoice.refAudio || undefined, apiVoice: input.narrationVoice.apiVoice || undefined } : undefined,
    foldId: fold?.id,
    titleModel: input.titleModel?.pattern || input.titleModel?.chosen ? { source: String(input.titleModel.source ?? '').slice(0, 200), pattern: String(input.titleModel.pattern ?? '').slice(0, 1200),
      chosen: input.titleModel.chosen?.trim().slice(0, 140) || undefined, thumbText: input.titleModel.thumbText?.trim().slice(0, 40) || undefined } : undefined,
    fold: fold ? { id: fold.id, name: fold.name, channel: fold.channel, angle: fold.angle } : undefined,
    production: { totalMs: 0, runs: [] },
  };
  if (project.musicMinMin && project.musicMaxMin) project.targetDurationSec = Math.round(((project.musicMinMin + project.musicMaxMin) / 2) * 60);
  /* DNA do formato (skill de canal clonado) + identidade do canal de destino: legenda e duraÃ§Ã£o de cena saem dos nÃºmeros */
  const fdna = skill?.formatDna;
  const destCh = project.channelId ? (s.channels ?? []).find((c) => c.id === project.channelId) : undefined;
  /* paleta do Novo projeto (vence a do canal): cores recalculadas (papÃ©is, contraste) */
  const pv = normalizePalette(input.palette?.video), pt = normalizePalette(input.palette?.thumbnail);
  if (pv || pt) project.palette = { video: pv, thumbnail: pt };
  const ident = pv ? { palettes: { video: pv }, typography: destCh?.identity?.typography } : destCh?.identity;
  if (project.subtitleStyle && (fdna || ident)) project.subtitleStyle = dnaSubtitleStyle(project.subtitleStyle, fdna, ident);
  if (!project.sceneSec && dnaSceneSec(fdna)) project.sceneSec = dnaSceneSec(fdna);
  /* vÃ¡rias skills com percentual: a principal Ã© a skill do projeto; as outras ficam congeladas no projeto */
  if (skill && (input.skillMix?.length ?? 0) >= 2) {
    const items = normalizeMix(input.skillMix!, skill.id);
    const others = items.slice(1).map((m) => getSkill(s, m.skillId)).filter((k): k is Skill => !!k);
    if (others.length) {
      const all = [skill, ...others];
      const kinds = routeSceneKinds(project);
      const warnings = others.map((k) => { const want = getVideoType(k.appearance ?? 'custom')?.sceneKind; return want && kinds.size && !kinds.has(want) ? `a rota "${route.name}" nÃ£o produz cenas "${want}" (usadas por "${k.name}") â€” elas viram o tipo que a rota produz` : ''; }).filter(Boolean);
      project.skillMix = { items: items.filter((m) => all.some((k) => k.id === m.skillId)).map((m) => ({ ...m, name: all.find((k) => k.id === m.skillId)!.name })), mode: input.skillMixMode === 'interleave' || input.skillMixMode === 'best' ? input.skillMixMode : 'blocks', warnings: warnings.length ? warnings : undefined };
      project.skillMixSkills = others.map((k) => JSON.parse(JSON.stringify(k)) as Skill);
    }
  }
  const dir = projectDirOf(s, id);
  fs.mkdirSync(dir, { recursive: true });
  /* skill de KIT importado: a biblioteca do kit (imagens, exemplos) vai para <projeto>/kit/ (as cenas por cÃ³digo usam ../../../kit/...) */
  if (skill?.kitId) try { copyKitIntoProject(s, skill.kitId, dir); } catch { /* kit apagado: a skill segue sÃ³ com as regras */ }
  /* personagens da biblioteca: folha como foto de personagem, elenco, bÃ­blia e cÃ³pia congelada */
  if (input.characterIds?.length) applyCharacters(s, project, dir, input.characterIds, input.characterVariants ?? {});
  /* estilo de uma imagem: a imagem vai junto como referÃªncia e a paleta medida vira a do vÃ­deo (se o usuÃ¡rio nÃ£o escolheu outra) */
  if (project.styleRef?.file && fs.existsSync(project.styleRef.file)) {
    const ud = path.join(dir, 'assets', 'user');
    fs.mkdirSync(ud, { recursive: true });
    const rel = `style-reference${path.extname(project.styleRef.file).toLowerCase()}`;
    fs.copyFileSync(project.styleRef.file, path.join(ud, rel));
    project.styleRef = { ...project.styleRef, file: path.join(ud, rel) };
    project.attachments = [...(project.attachments ?? []), { file: rel, kind: 'image', use: 'reference', note: `Imagem de referÃªncia do ESTILO (copie sÃ³ o estilo: ${project.styleRef.stylePrompt.slice(0, 200)})` }];
  }
  if (project.styleRef?.palette?.length && !project.palette?.video) {
    const pv = normalizePalette({ extra: project.styleRef.palette } as never) ?? normalizePalette(project.styleRef.palette as never);
    if (pv) project.palette = { ...(project.palette ?? {}), video: pv };
  }
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
  return project;
}
