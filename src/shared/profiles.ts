import type { Binding, ExecutorCategory, ExecutorProfile, Route, RouteStep, StepKind } from './types';

/**
 * Perfis de executores: a ROTA diz o que fazer; o PERFIL diz quem faz.
 * Assim uma rota só serve para Antigravity, Ollama, Claude ou APIs — sem
 * precisar de uma cópia da rota para cada provedor.
 */

export const CATEGORY_OF: Partial<Record<StepKind, ExecutorCategory>> = {
  ideation: 'text', script: 'text', scene_plan: 'text', asset_design: 'text', metadata: 'text', review: 'text', brief: 'text', free: 'text',
  code_scene: 'code', motion_graphics: 'code',
  image: 'image', thumbnail: 'image',
  video: 'video',
  narration: 'voice',
  music: 'music',
};

export const CATEGORY_INFO: Record<ExecutorCategory, { label: string; icon: string; hint: string }> = {
  text: { label: 'Texto', icon: '✍️', hint: 'Roteiro, plano de cenas, SEO, revisão e brief' },
  code: { label: 'Código', icon: '🧑‍💻', hint: 'Cenas desenhadas por código e motion graphics (HTML/Canvas/WebGL)' },
  image: { label: 'Imagem', icon: '🖼️', hint: 'Frames das cenas e thumbnail' },
  video: { label: 'Vídeo IA', icon: '🎬', hint: 'Imagem → vídeo ou texto → vídeo' },
  voice: { label: 'Voz', icon: '🎙️', hint: 'Narração (TTS / clonagem de voz)' },
  music: { label: 'Música', icon: '🎵', hint: 'Trilha sonora' },
};
export const CATEGORIES = Object.keys(CATEGORY_INFO) as ExecutorCategory[];

const H = (harness: 'claude' | 'opencode' | 'codex' | 'antigravity' | 'openclaw' | 'ollama' | 'lmstudio' | 'llamacpp' | 'auto', model?: string): Binding => ({ type: 'harness', harness, ...(model ? { model } : {}) });
const C = (workflow: string): Binding => ({ type: 'comfyui', server: 'local', workflow });
const W = (template: string): Binding => ({ type: 'wan2gp', template });

const COMFY_IMAGE = [C('krea2-turbo-t2i.json'), C('z-image-turbo-t2i.json'), W('wan2gp-image.json')];
const COMFY_VIDEO = [C('minimax-h3-ref2v.json'), C('minimax-h3-t2v.json'), W('wan2gp-ltx2-i2v.json')];
const COMFY_VOICE = [C('omnivoice-clone-tts.json'), W('wan2gp-tts.json')];
const COMFY_MUSIC: Binding[] = [C('yue2-text2music.json'), W('wan2gp-music.json'), { type: 'builtin', tool: 'library-music' }];

export const BUILTIN_PROFILES: ExecutorProfile[] = [
  { id: 'local-ollama', name: '100 % local — Ollama + ComfyUI', builtin: true,
    description: 'Nada sai do seu computador: Ollama escreve e programa; ComfyUI/Wan2GP geram imagem, vídeo, voz e música.',
    chains: { text: [H('ollama')], code: [H('ollama')], image: COMFY_IMAGE, video: COMFY_VIDEO, voice: COMFY_VOICE, music: COMFY_MUSIC } },
  { id: 'antigravity-comfy', name: 'Antigravity + ComfyUI', builtin: true,
    description: 'Antigravity (Gemini) para texto e código; mídia no ComfyUI local.',
    chains: { text: [H('antigravity')], code: [H('antigravity')], image: COMFY_IMAGE, video: COMFY_VIDEO, voice: COMFY_VOICE, music: COMFY_MUSIC } },
  { id: 'claude-comfy', name: 'Claude Code + ComfyUI', builtin: true,
    description: 'Claude Code para texto e código (melhor em cenas por código complexas); mídia no ComfyUI local.',
    chains: { text: [H('claude')], code: [H('claude')], image: COMFY_IMAGE, video: COMFY_VIDEO, voice: COMFY_VOICE, music: COMFY_MUSIC } },
  { id: 'flow-google', name: 'Google Flow (sua conta) + Antigravity', builtin: true,
    description: 'Imagens (Nano Banana) e vídeos (Veo) no Google Flow com a sua conta de Automações; ComfyUI fica como reserva. Texto e código no Antigravity.',
    chains: { text: [H('antigravity')], code: [H('antigravity')], image: [{ type: 'flow' }, ...COMFY_IMAGE], video: [{ type: 'flow' }, ...COMFY_VIDEO], voice: COMFY_VOICE, music: COMFY_MUSIC } },
  { id: 'commercial', name: 'Comercial (APIs na nuvem)', builtin: true,
    description: 'APIs pagas primeiro (OpenAI/Gemini); ComfyUI como reserva. Mais rápido sem GPU local.',
    chains: {
      text: [{ type: 'api', provider: 'openai', model: 'gpt-4.1' }, H('auto')],
      code: [H('auto'), { type: 'api', provider: 'openai', model: 'gpt-4.1' }],
      image: [{ type: 'api', provider: 'openai', model: 'gpt-image-1' }, { type: 'api', provider: 'gemini', model: 'gemini-2.5-flash-image' }, ...COMFY_IMAGE],
      voice: [{ type: 'api', provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'alloy' }, ...COMFY_VOICE],
    } },
];

export const allProfiles = (user?: ExecutorProfile[]): ExecutorProfile[] => [...BUILTIN_PROFILES, ...(user ?? []).filter((p) => !BUILTIN_PROFILES.some((b) => b.id === p.id))];

const same = (a: Binding, b: Binding) => {
  const strip = (x: Binding) => { const y = { ...x } as Record<string, unknown>; delete y['refAudio']; delete y['effort']; return JSON.stringify(y); };
  return strip(a) === strip(b);
};

/**
 * Etapas que o perfil NÃO deve trocar: ferramentas internas/bancos (são a própria
 * função da etapa), loops perfeitos (workflow first = last frame) e etapas marcadas
 * com params.lockExecutors.
 */
export function profileSkips(st: RouteStep): boolean {
  const first = st.bindings[0];
  if (!first || first.type === 'builtin' || first.type === 'stock' || first.type === 'manual') return true;
  if ((st.params as Record<string, unknown> | undefined)?.['lockExecutors'] === true) return true;
  if (st.kind === 'video' && st.bindings.some((b) => b.type === 'comfyui' && /perfect-loop/.test(b.workflow))) return true;
  /* elenco (MiniMax H3 com retratos dos personagens): o workflow da rota é a própria função da etapa */
  if (st.kind === 'video' && st.bindings[0]?.type === 'comfyui' && /-cast\.json$/.test(st.bindings[0].workflow)) return true;
  return false;
}

/** Aplica o perfil: o executor do perfil vira o principal e os da rota ficam como fallback. */
export function applyExecutorProfile(route: Route, profile: ExecutorProfile | undefined): Route {
  const copy: Route = JSON.parse(JSON.stringify(route));
  if (!profile) return copy;
  for (const st of copy.steps) {
    const cat = CATEGORY_OF[st.kind];
    const chain = cat ? profile.chains[cat] : undefined;
    if (!chain?.length || profileSkips(st)) continue;
    const head: Binding[] = chain.map((b) => {
      const nb = JSON.parse(JSON.stringify(b)) as Binding;
      // voz clonada: mantém o áudio de referência que a rota já usava no mesmo workflow
      if (nb.type === 'comfyui' && !nb.refAudio) {
        const old = st.bindings.find((o) => o.type === 'comfyui' && o.workflow === nb.workflow && o.refAudio);
        if (old && old.type === 'comfyui') nb.refAudio = old.refAudio;
      }
      return nb;
    });
    st.bindings = [...head, ...st.bindings.filter((b) => !head.some((x) => same(x, b)))];
  }
  return copy;
}

/* ───────── executor por ETAPA (balanceamento da rota) ───────── */

/** Função de cada etapa de texto/código: quem planeja, quem executa e quem revisa. */
export type StepRole = 'plan' | 'exec' | 'review';
export const ROLE_OF: Partial<Record<StepKind, StepRole>> = {
  ideation: 'plan', brief: 'plan', script: 'plan', scene_plan: 'plan', asset_design: 'plan',
  code_scene: 'exec', free: 'exec', motion_graphics: 'exec',
  review: 'review', metadata: 'review',
};
export const ROLE_INFO: Record<StepRole, { label: string; icon: string; hint: string }> = {
  plan: { label: 'Planejamento', icon: '📝', hint: 'Ideia, brief, roteiro, plano de cenas, elenco e cenários' },
  exec: { label: 'Execução', icon: '⚙️', hint: 'Cenas por código, motion graphics, cenas do motor do plugin' },
  review: { label: 'Revisão', icon: '🔎', hint: 'Revisão final e SEO (título, descrição, tags)' },
};
export const ROLES = Object.keys(ROLE_INFO) as StepRole[];

/** Etapas da rota que aceitam executor por etapa (texto/código, ligadas, não travadas pela rota). */
export function stepTargets(route: Route): RouteStep[] {
  return route.steps.filter((st) => st.enabled && ROLE_OF[st.kind] && (CATEGORY_OF[st.kind] === 'text' || CATEGORY_OF[st.kind] === 'code') && !profileSkips(st));
}

/** Aplica os executores escolhidos por etapa: viram o principal e os da etapa ficam como reserva (função pura). */
export function applyStepBindings(route: Route, steps?: Record<string, Binding>): Route {
  const copy: Route = JSON.parse(JSON.stringify(route));
  if (!steps) return copy;
  for (const st of copy.steps) {
    const b = steps[st.id];
    if (!b || profileSkips(st)) continue;
    const head = JSON.parse(JSON.stringify(b)) as Binding;
    st.bindings = [head, ...st.bindings.filter((x) => !same(x, head))];
  }
  return copy;
}

/**
 * Balanceamento automático: espalha as funções pelos harnesses instalados para não concentrar
 * a cota num só. Planejamento e revisão ficam com os mais fortes; execução (muitas chamadas,
 * uma por cena) vai para um local (Ollama) quando houver, senão para o próximo da lista (função pura).
 */
export function balanceRoles(installed: string[]): Partial<Record<StepRole, Binding>> {
  const strong = ['claude', 'antigravity', 'codex', 'opencode', 'openclaw'].filter((x) => installed.includes(x));
  const local = ['ollama', 'lmstudio', 'llamacpp'].find((x) => installed.includes(x));
  const pool = [...strong, ...(local ? [local] : [])];
  if (!pool.length) return {};
  const pick = (i: number) => H(pool[i % pool.length] as never);
  return {
    plan: pick(0),
    exec: local ? H(local as never) : pick(1),
    review: strong.length > 1 ? H(strong[1] as never) : pick(0),
  };
}

/** Etapas que dependem (direta ou indiretamente) das indicadas, mais elas mesmas, na ordem da rota (função pura). */
export function downstreamSteps(route: Route, ids: string[]): string[] {
  const set = new Set(ids);
  for (let grew = true; grew;) {
    grew = false;
    for (const st of route.steps) if (st.enabled && !set.has(st.id) && st.dependsOn.some((d) => set.has(d))) { set.add(st.id); grew = true; }
  }
  return route.steps.filter((st) => set.has(st.id)).map((st) => st.id);
}

/** Troca o executor principal da etapa; o anterior (e os demais) ficam como reserva, sem repetir o mesmo harness (função pura sobre a etapa). */
export function setStepHead(st: RouteStep, b: Binding): void {
  const k = (x: Binding) => (x.type === 'harness' ? `h:${x.harness}` : JSON.stringify(x));
  st.bindings = [b, ...st.bindings.filter((x) => k(x) !== k(b))];
}
