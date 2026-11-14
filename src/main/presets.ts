import type { Binding, CustomVideoType, Route, RouteStep, SceneKind, Skill, StockSource, VideoTypeId } from '../shared/types';

export interface VideoTypeDef {
  id: VideoTypeId;
  label: string;
  defaultRoute: string;
  defaultAspect: '9:16' | '16:9' | '1:1' | '4:5';
  defaultDurationSec: number;
  sceneKind: SceneKind;               // estratégia visual padrão
  stylePrompt: string;
  negativePrompt: string;
}

/*
 * Cada aparência aponta para a rota que REALMENTE produz o tipo de cena dela:
 * - código/vetor/rabisco → rotas com code_scene;
 * - mistas (recortes, B-roll) → rotas com banco de mídia;
 * - documentário 3D → vídeo IA + banco + infográficos;
 * - lyric video → canção primeiro, letra sincronizada depois;
 * - microdrama → várias vozes (elenco).
 */
export const VIDEO_TYPES: VideoTypeDef[] = [
  { id: 'stickman', label: 'Stickman', defaultRoute: 'stickman-explainer', defaultAspect: '9:16', defaultDurationSec: 60, sceneKind: 'code',
    stylePrompt: 'simple stick figure characters, thick black lines on white background, expressive poses, minimal props', negativePrompt: 'photo, realistic, detailed shading' },
  { id: 'realistic', label: 'Realista / cinematográfico', defaultRoute: 'realistic-cinematic', defaultAspect: '16:9', defaultDurationSec: 90, sceneKind: 'video',
    stylePrompt: 'photorealistic, cinematic lighting, 35mm film, shallow depth of field, consistent characters', negativePrompt: 'cartoon, anime, deformed hands, text artifacts' },
  { id: 'anime_2d', label: 'Anime 2D', defaultRoute: 'shorts-autopilot', defaultAspect: '9:16', defaultDurationSec: 75, sceneKind: 'image',
    stylePrompt: '2D anime style, clean line art, cel shading, vibrant colors, consistent character design', negativePrompt: 'photo, 3d render, extra fingers' },
  { id: 'cartoon_3d', label: '3D Cartoon', defaultRoute: 'shorts-autopilot', defaultAspect: '9:16', defaultDurationSec: 90, sceneKind: 'video',
    stylePrompt: 'stylized 3D cartoon, soft lighting, funky characters, detailed environment, clean look', negativePrompt: 'photo, realistic skin, noise' },
  { id: 'pixel_art', label: 'Pixel art', defaultRoute: 'stickman-explainer', defaultAspect: '9:16', defaultDurationSec: 60, sceneKind: 'code',
    stylePrompt: 'pixel art, 16-bit palette, crisp pixels, side-scroller scenes', negativePrompt: 'blurry, antialiased, photo' },
  { id: 'flat_explainer', label: 'Flat explainer', defaultRoute: 'stickman-explainer', defaultAspect: '16:9', defaultDurationSec: 120, sceneKind: 'code',
    stylePrompt: 'flat vector illustration, solid colors, simple geometric shapes, explainer style', negativePrompt: 'gradients, photo' },
  { id: 'ms_paint', label: 'MS Paint / rabisco', defaultRoute: 'shorts-autopilot', defaultAspect: '9:16', defaultDurationSec: 60, sceneKind: 'code',
    stylePrompt: 'crude MS Paint doodle, wobbly lines, bright flat colors, humorous', negativePrompt: 'polished, photo' },
  { id: 'vox_collage', label: 'Vox collage', defaultRoute: 'explainer-mixed', defaultAspect: '16:9', defaultDurationSec: 180, sceneKind: 'mixed',
    stylePrompt: 'documentary paper collage, cutout photos, torn edges, highlighter marks, kinetic typography', negativePrompt: 'clean 3d' },
  { id: 'low_poly', label: 'Low poly 3D', defaultRoute: 'stickman-explainer', defaultAspect: '9:16', defaultDurationSec: 60, sceneKind: 'code',
    stylePrompt: 'low poly 3D scene, flat-shaded triangles, pastel palette, simple camera moves', negativePrompt: 'high poly, photo' },
  { id: 'recon_3d', label: 'Reconstrução 3D', defaultRoute: 'realistic-cinematic', defaultAspect: '9:16', defaultDurationSec: 75, sceneKind: 'video',
    stylePrompt: '3D reconstructed environment, consistent geometry, virtual camera fly-through', negativePrompt: 'flicker, inconsistent geometry' },
  { id: 'doc_netflix', label: 'Documentário Netflix / 3D investigation', defaultRoute: 'documentario-3d', defaultAspect: '16:9', defaultDurationSec: 600, sceneKind: 'video',
    stylePrompt: 'prestige streaming documentary, consistent 3D reconstructed environments, moody lighting, archival textures, kinetic infographics', negativePrompt: 'cartoon, flicker, inconsistent geometry' },
  { id: 'whiteboard', label: 'Quadro branco', defaultRoute: 'stickman-explainer', defaultAspect: '16:9', defaultDurationSec: 120, sceneKind: 'code',
    stylePrompt: 'whiteboard hand-drawn marker animation, black and blue ink', negativePrompt: 'photo, color fills' },
  { id: 'motion_graphics', label: 'Motion graphics', defaultRoute: 'stickman-explainer', defaultAspect: '16:9', defaultDurationSec: 90, sceneKind: 'motion',
    stylePrompt: 'clean motion graphics, kinetic typography, animated charts, brand palette', negativePrompt: 'photo' },
  { id: 'micro_drama', label: 'Microdrama / série', defaultRoute: 'microdrama-vozes', defaultAspect: '9:16', defaultDurationSec: 120, sceneKind: 'video',
    stylePrompt: 'short drama, cinematic close-ups, emotional performance, consistent cast', negativePrompt: 'cartoon, inconsistent faces' },
  { id: 'ad_product', label: 'Anúncio / produto', defaultRoute: 'shorts-autopilot', defaultAspect: '9:16', defaultDurationSec: 30, sceneKind: 'video',
    stylePrompt: 'premium product commercial, studio lighting, hero shots, bold call-to-action', negativePrompt: 'clutter, low quality' },
  { id: 'interactive_story', label: 'História interativa (v2)', defaultRoute: 'shorts-autopilot', defaultAspect: '16:9', defaultDurationSec: 180, sceneKind: 'image',
    stylePrompt: 'branching visual novel scenes', negativePrompt: '' },
  { id: 'music_lyric', label: 'Lyric video', defaultRoute: 'lyric-video', defaultAspect: '16:9', defaultDurationSec: 120, sceneKind: 'code',
    stylePrompt: 'audio-reactive lyric visualizer, kinetic type', negativePrompt: '' },
  { id: 'vector', label: 'Vector (ilustração vetorial)', defaultRoute: 'explainer-mixed', defaultAspect: '16:9', defaultDurationSec: 120, sceneKind: 'code',
    stylePrompt: 'clean vector illustration, crisp geometric shapes, limited harmonious palette, subtle flat shadows, smooth easing animations, readable large type', negativePrompt: 'photo, noise, messy lines, tiny text' },
  { id: 'paper_cut', label: 'Paper cut (recorte de papel)', defaultRoute: 'explainer-mixed', defaultAspect: '16:9', defaultDurationSec: 120, sceneKind: 'code',
    stylePrompt: 'layered paper cut-out craft, torn-paper edges, soft drop shadows between layers, textured paper background, handmade stop-motion feel at 12 fps', negativePrompt: 'glossy, photo, thin vector lines' },
  { id: 'code_3d', label: '3D por código (WebGL/Canvas)', defaultRoute: 'stickman-explainer', defaultAspect: '16:9', defaultDurationSec: 90, sceneKind: 'code',
    stylePrompt: '3D scene rendered in code (pure WebGL or Canvas-projected meshes), low-poly models, simple directional lighting, orbiting camera, deterministic seek(t) animation', negativePrompt: 'external 3D libraries, photo textures' },
  { id: 'slideshow', label: 'Slideshow narrado (imagens + movimento + efeitos sonoros)', defaultRoute: 'slideshow-sfx', defaultAspect: '16:9', defaultDurationSec: 240, sceneKind: 'image',
    stylePrompt: 'cohesive illustrated documentary still, consistent recurring characters with identical appearance, clear focal subject, soft cinematic light, rich detail, no text, no watermark', negativePrompt: 'text, letters, watermark, logo, deformed hands, inconsistent faces' },
  { id: 'custom', label: 'Personalizado', defaultRoute: 'shorts-autopilot', defaultAspect: '9:16', defaultDurationSec: 60, sceneKind: 'image',
    stylePrompt: '', negativePrompt: '' },
];

const H = (harness: 'claude' | 'opencode' | 'codex' | 'antigravity' | 'openclaw' | 'ollama' | 'auto', model?: string): Binding =>
  ({ type: 'harness', harness, model });
const textChain: Binding[] = [H('auto'), { type: 'api', provider: 'openai', model: 'gpt-4.1' }];

/** Fontes do explicativo misto: YouTube primeiro (trechos curtos que ilustram a fala),
 *  depois os bancos de vídeo/imagem. A ordem é a ordem de busca e de reserva. */
export const MIXED_STOCK_SOURCES: StockSource[] = [
  'youtube', 'pexels', 'pixabay', 'wikipedia', 'openverse', 'nasa', 'archive', 'smithsonian', 'unsplash',
];

const step = (s: Partial<RouteStep> & Pick<RouteStep, 'id' | 'kind' | 'label' | 'scope' | 'bindings'>): RouteStep => ({
  dependsOn: [], enabled: true, params: {}, retry: { max: 2, backoffMs: 1500 }, timeoutSec: 900, ...s,
});

const imageChain: Binding[] = [
  { type: 'comfyui', server: 'local', workflow: 'krea2-turbo-t2i.json' },
  { type: 'comfyui', server: 'local', workflow: 'z-image-turbo-t2i.json' },
  { type: 'wan2gp', template: 'wan2gp-image.json' },
  { type: 'api', provider: 'openai', model: 'gpt-image-1' },
];
const videoChain: Binding[] = [
  { type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v.json' },
  { type: 'comfyui', server: 'local', workflow: 'minimax-h3-t2v.json' },
  { type: 'wan2gp', template: 'wan2gp-h3-i2v.json' },
  { type: 'wan2gp', template: 'wan2gp-ltx2-i2v.json' },
];
/** Loop perfeito: a mesma imagem entra como primeiro e último frame no MiniMax H3. */
const loopVideoChain: Binding[] = [
  { type: 'comfyui', server: 'local', workflow: 'minimax-h3-perfect-loop-3step.json' },
  { type: 'comfyui', server: 'local', workflow: 'minimax-h3-perfect-loop.json' },
  { type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v.json' },
  { type: 'comfyui', server: 'local', workflow: 'minimax-h3-t2v.json' },
];
const ttsChain: Binding[] = [
  { type: 'api', provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'alloy' },
  { type: 'comfyui', server: 'local', workflow: 'omnivoice-clone-tts.json' },
  { type: 'wan2gp', template: 'wan2gp-tts.json' },
];
/** Diálogo: a voz clonada (por personagem) vem primeiro; a API usa a voz do elenco. */
const castTtsChain: Binding[] = [
  { type: 'comfyui', server: 'local', workflow: 'omnivoice-clone-tts.json' },
  { type: 'api', provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'alloy' },
  { type: 'wan2gp', template: 'wan2gp-tts.json' },
];
const musicChain: Binding[] = [
  { type: 'comfyui', server: 'local', workflow: 'yue2-text2music.json' },
  { type: 'wan2gp', template: 'wan2gp-music-ace.json' },
  { type: 'wan2gp', template: 'wan2gp-music.json' },
  { type: 'builtin', tool: 'library-music' },
  /* última reserva: sintetizada por código (sempre funciona, offline) */
  { type: 'builtin', tool: 'music-code' },
];
const stockStep = (): RouteStep => step({ id: 'stock', kind: 'stock_media', label: 'Bancos de mídia (YouTube + Pexels/Pixabay/Wikimedia…)', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['stock', 'mixed'], optional: true, onFail: 'skip',
  /* YouTube primeiro: trechos de 2–4 s que ilustram a frase; depois os bancos de vídeo/imagem (ordem de reserva). */
  params: { maxSeconds: 4 },
  bindings: [{ type: 'stock', sources: MIXED_STOCK_SOURCES, media: 'both' }], retry: { max: 1, backoffMs: 500 }, timeoutSec: 600 });

/** Efeitos sonoros gerados por código (biblioteca sintetizada no ffmpeg), sincronizados pelas palavras da narração. */
export const sfxStep = (auto = false, after: string[] = []): RouteStep => step({ id: 'sfx', kind: 'sfx', label: 'Efeitos sonoros (gerados por código)', scope: 'scene', dependsOn: ['narration', 'transcribe', ...after], optional: true, onFail: 'skip',
  bindings: [{ type: 'builtin', tool: 'sfx-code' }], params: { auto }, retry: { max: 1, backoffMs: 300 }, timeoutSec: 300, concurrency: 2 });

/** Efeitos sonoros por IA (Stable Audio 3 no ComfyUI ou no Wan2GP): efeitos + ambiência da cena; reserva = efeitos por código. */
export const sfxAiStep = (after: string[] = []): RouteStep => step({ id: 'sfx', kind: 'sfx', label: 'Efeitos sonoros por IA (Stable Audio 3)', scope: 'scene', dependsOn: ['narration', 'transcribe', ...after], optional: true, onFail: 'skip',
  bindings: [{ type: 'comfyui', server: 'local', workflow: 'stable-audio3-sfx.json' }, { type: 'wan2gp', template: 'wan2gp-sfx-stable.json' }, { type: 'builtin', tool: 'sfx-code' }], params: { auto: true }, retry: { max: 1, backoffMs: 500 }, timeoutSec: 900, concurrency: 1 });

const transcribeStep = (): RouteStep => step({ id: 'transcribe', kind: 'transcribe', label: 'Transcrever narração (Whisper) p/ sincronia', scope: 'scene', dependsOn: ['narration'],
  bindings: [{ type: 'builtin', tool: 'whisper' }, { type: 'builtin', tool: 'estimate-words' }], retry: { max: 1, backoffMs: 500 }, timeoutSec: 600, concurrency: 1 });

/** Thumbnail no formato do projeto, depois do SEO (usa o título/texto escolhidos); reserva final = quadro real do vídeo. */
const thumbChain: Binding[] = [
  { type: 'comfyui', server: 'local', workflow: 'krea2-turbo-t2i.json' },
  { type: 'comfyui', server: 'local', workflow: 'z-image-turbo-t2i.json' },
  { type: 'wan2gp', template: 'wan2gp-image.json' },
  { type: 'api', provider: 'openai', model: 'gpt-image-1' },
  { type: 'api', provider: 'gemini', model: 'gemini-2.5-flash-image' },
  { type: 'builtin', tool: 'frame-thumbnail' },
];

const base = (narration: Binding[] = ttsChain, narrationParams: Record<string, unknown> = {}): RouteStep[] => [
  step({ id: 'script', kind: 'script', label: 'Roteiro', scope: 'project', bindings: textChain }),
  step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas', scope: 'project', dependsOn: ['script'], bindings: textChain }),
  step({ id: 'narration', kind: 'narration', label: 'Narração (TTS)', scope: 'scene', dependsOn: ['scene_plan'], bindings: narration, concurrency: 2, params: narrationParams }),
];
/** Trilha PROGRAMÁTICA (sintetizada por código: mgaudio do plugin mg-styles, ou o sintetizador interno) — ideal para motion graphics. */
const codeMusicChain: Binding[] = [{ type: 'builtin', tool: 'music-code' }, ...musicChain.filter((b) => !(b.type === 'builtin' && b.tool === 'music-code'))];
const tail = (after: string[], editParams: Record<string, unknown> = {}, music: Binding[] = musicChain): RouteStep[] => [
  step({ id: 'music', kind: 'music', label: music[0]?.type === 'builtin' && music[0].tool === 'music-code' ? 'Trilha programática (por código)' : 'Trilha sonora', scope: 'project', dependsOn: after, optional: true, bindings: music }),
  step({ id: 'subtitles', kind: 'subtitles', label: 'Legendas SRT', scope: 'project', dependsOn: after, bindings: [{ type: 'builtin', tool: 'subtitles' }] }),
  step({ id: 'edit', kind: 'edit', label: 'Montagem final (ffmpeg)', scope: 'project', dependsOn: [...after, 'music', 'subtitles'], bindings: [{ type: 'builtin', tool: 'assemble' }], params: editParams }),
  step({ id: 'metadata', kind: 'metadata', label: 'Título, descrição SEO e tags', scope: 'project', dependsOn: ['edit'], optional: true, onFail: 'skip', bindings: textChain }),
  step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail (formato do projeto)', scope: 'project', dependsOn: ['edit', 'metadata'], optional: true, onFail: 'skip', bindings: thumbChain, timeoutSec: 900 }),
];

export const ROUTES: Route[] = [
  {
    id: 'shorts-autopilot', name: 'Imagem → vídeo IA (shorts e geral)',
    description: 'Roteiro → cenas → narração → imagem → vídeo IA (ComfyUI local, fallback API) → montagem. Cenas de código/motion para rabiscos e textos.',
    videoTypes: ['anime_2d', 'cartoon_3d', 'ms_paint', 'ad_product', 'interactive_story', 'custom'],
    steps: [
      ...base(), transcribeStep(),
      step({ id: 'image', kind: 'image', label: 'Imagem da cena', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['image', 'video'], bindings: imageChain }),
      step({ id: 'video', kind: 'video', label: 'Vídeo da cena (I2V)', scope: 'scene', dependsOn: ['image'], onlySceneKinds: ['video'], bindings: videoChain, timeoutSec: 1800, onFail: 'skip' }),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Cena por código', scope: 'scene', dependsOn: ['scene_plan', 'transcribe'], onlySceneKinds: ['code', 'mixed'], bindings: textChain, onFail: 'skip' }),
      step({ id: 'motion', kind: 'motion_graphics', label: 'Motion graphics', scope: 'scene', dependsOn: ['scene_plan', 'transcribe'], onlySceneKinds: ['motion'], bindings: textChain, onFail: 'skip' }),
      ...tail(['narration', 'image', 'video', 'code_scene', 'motion']),
    ],
  },
  {
    id: 'stickman-explainer', name: 'Explicativo por código (stickman/flat/low poly/3D)',
    description: 'Cenas desenhadas por código (SVG/Canvas/WebGL puro) pelo harness, reveladas junto com a fala; custo zero de imagem/vídeo.',
    videoTypes: ['stickman', 'flat_explainer', 'whiteboard', 'pixel_art', 'low_poly', 'motion_graphics', 'code_3d'],
    steps: [
      ...base(), transcribeStep(),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Cena por código', scope: 'scene', dependsOn: ['scene_plan', 'transcribe'], onlySceneKinds: ['code', 'mixed', 'image', 'video'], bindings: textChain }),
      step({ id: 'motion', kind: 'motion_graphics', label: 'Motion graphics', scope: 'scene', dependsOn: ['scene_plan', 'transcribe'], onlySceneKinds: ['motion'], bindings: textChain }),
      sfxStep(false, ['code_scene', 'motion']),
      ...tail(['narration', 'code_scene', 'motion', 'sfx'], {}, codeMusicChain),
    ],
  },
  {
    id: 'kit-2d-cinematic', name: 'Animação 2D cinematográfica (motor do plugin)',
    description: 'Para plugins com motor de animação próprio (ex.: aiTrends 2D Studio): roteiro → planos curtos de 2–4 s → narração → tempos (Whisper) → elenco e cenários no formato do plugin → um plano registerShot por cena, renderizado pelo player do plugin (rim light, gradação, 3D) com correção de erros e revisão visual → trilha e efeitos por código → montagem. Marque o plugin no projeto.',
    videoTypes: ['stickman', 'flat_explainer', 'motion_graphics', 'code_3d', 'custom'],
    steps: [
      ...base(), transcribeStep(),
      step({ id: 'kit_assets', kind: 'asset_design', label: 'Elenco e cenários (motor do plugin)', scope: 'project', dependsOn: ['scene_plan'], bindings: textChain, timeoutSec: 1800 }),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Plano da cena (motor do plugin)', scope: 'scene', dependsOn: ['scene_plan', 'transcribe', 'kit_assets'], bindings: textChain, timeoutSec: 1800, params: { kitQc: true } }),
      sfxStep(false, ['code_scene']),
      ...tail(['narration', 'code_scene', 'sfx'], {}, codeMusicChain),
    ],
  },
  {
    id: 'explainer-mixed', name: 'Explicativo misto (código + bancos de mídia)',
    description: 'Motion graphics por código com trechos curtos de YouTube e, na reserva, imagens/vídeos de Pexels, Pixabay, Wikimedia, Openverse, NASA, Internet Archive, Smithsonian e Unsplash; tudo sincronizado com a narração (Whisper).',
    videoTypes: ['vector', 'paper_cut', 'vox_collage', 'flat_explainer', 'motion_graphics'],
    steps: [
      ...base(), transcribeStep(), stockStep(),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Cena por código (com mídia inserida)', scope: 'scene', dependsOn: ['scene_plan', 'transcribe', 'stock'], onlySceneKinds: ['code', 'mixed', 'motion'], bindings: textChain }),
      sfxStep(false, ['code_scene']),
      ...tail(['narration', 'stock', 'code_scene', 'sfx']),
    ],
  },
  {
    id: 'realistic-cinematic', name: 'Realista cinematográfico',
    description: 'Imagem com referência → I2V → montagem. Priorize ComfyUI com GPU.',
    videoTypes: ['realistic', 'recon_3d'],
    steps: [
      ...base(),
      step({ id: 'image', kind: 'image', label: 'Frame inicial', scope: 'scene', dependsOn: ['scene_plan'], bindings: imageChain }),
      step({ id: 'video', kind: 'video', label: 'Vídeo da cena (I2V)', scope: 'scene', dependsOn: ['image'], bindings: videoChain, timeoutSec: 2400, retry: { max: 2, backoffMs: 3000 } }),
      ...tail(['narration', 'image', 'video']),
    ],
  },
  {
    id: 'documentario-3d', name: 'Documentário 3D (reconstituição IA + arquivo + infográficos)',
    description: 'Documentário de prestígio: reconstituições em vídeo IA com câmera em sobrevoo, imagens de arquivo de bancos de mídia e mapas/linhas do tempo por código, sincronizados com a narração.',
    videoTypes: ['doc_netflix'],
    steps: [
      ...base(), transcribeStep(), stockStep(),
      step({ id: 'image', kind: 'image', label: 'Quadro-chave da reconstituição', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['video', 'image'], bindings: imageChain }),
      step({ id: 'video', kind: 'video', label: 'Reconstituição 3D (vídeo IA)', scope: 'scene', dependsOn: ['image'], onlySceneKinds: ['video'], bindings: videoChain, timeoutSec: 2400, onFail: 'skip' }),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Mapas, linhas do tempo e números (código)', scope: 'scene', dependsOn: ['scene_plan', 'transcribe', 'stock'], onlySceneKinds: ['code', 'mixed', 'motion'], bindings: textChain }),
      sfxStep(false, ['code_scene']),
      ...tail(['narration', 'stock', 'image', 'video', 'code_scene', 'sfx'], { musicVolume: 0.05 }),
    ],
  },
  {
    id: 'microdrama-vozes', name: 'Microdrama com várias vozes (elenco)',
    description: 'Uma fala por cena; cada personagem fala com a própria voz (voz de referência no OmniVoice ou voz da API), com imagem → vídeo IA e elenco consistente.',
    videoTypes: ['micro_drama'],
    steps: [
      ...base(castTtsChain, { multiVoice: true }),
      step({ id: 'image', kind: 'image', label: 'Frame da cena (elenco consistente)', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['image', 'video'], bindings: imageChain }),
      step({ id: 'video', kind: 'video', label: 'Vídeo da cena (I2V)', scope: 'scene', dependsOn: ['image'], onlySceneKinds: ['video'], bindings: videoChain, timeoutSec: 2400, onFail: 'skip' }),
      ...tail(['narration', 'image', 'video']),
    ],
  },
  {
    id: 'dorama-elenco', name: 'Dorama / história com elenco (MiniMax H3 ref2video + vozes)',
    description: 'Roteiro em falas "NOME: fala" → bíblia de personagens (aparência + voz) → elenco montado sozinho (uma voz por personagem) → uma fala por cena → quadro da cena → vídeo no MiniMax H3 ref2video com o quadro E os retratos dos personagens como referência (mesmo rosto e figurino em todas as cenas) → montagem.',
    videoTypes: ['micro_drama', 'interactive_story', 'custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Roteiro (falas por personagem)', scope: 'project', bindings: textChain }),
      step({ id: 'bible', kind: 'asset_design', label: 'Bíblia de personagens (aparência + voz)', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'sets', kind: 'asset_design', label: 'Cenários e objetos (biblioteca)', scope: 'project', dependsOn: ['bible'], bindings: textChain, timeoutSec: 900, onFail: 'skip' }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas (uma fala por cena)', scope: 'project', dependsOn: ['script', 'bible', 'sets'], bindings: textChain }),
      step({ id: 'narration', kind: 'narration', label: 'Vozes do elenco (TTS)', scope: 'scene', dependsOn: ['scene_plan'], bindings: castTtsChain, concurrency: 2, params: { multiVoice: true } }),
      step({ id: 'image', kind: 'image', label: 'Quadro da cena (elenco consistente)', scope: 'scene', dependsOn: ['scene_plan', 'bible'], onlySceneKinds: ['image', 'video'], bindings: imageChain }),
      step({ id: 'video', kind: 'video', label: 'Vídeo da cena (MiniMax H3 ref2video + retratos)', scope: 'scene', dependsOn: ['image'], onlySceneKinds: ['video'],
        bindings: [{ type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v-cast.json' }, ...videoChain], timeoutSec: 2400, onFail: 'skip' }),
      ...tail(['narration', 'image', 'video']),
    ],
  },
  {
    id: 'dorama-voz-clonada', name: 'Dorama / história com fala no vídeo (MiniMax H3 ref2video + voz clonada)',
    description: 'Como o dorama com elenco, mas a FALA sai do próprio vídeo: o MiniMax H3 ref2video recebe o quadro da cena, as folhas/retratos dos personagens e a voz clonada de quem fala (<Audio 1>, pasta voices), e gera imagem + voz com a emoção do plano e os lábios sincronizados. ComfyUI primeiro, Wan2GP de reserva; cena sem voz clonada sai só com as imagens e a narração por TTS entra quando o vídeo vem sem fala.',
    videoTypes: ['micro_drama', 'interactive_story', 'custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Roteiro (falas por personagem)', scope: 'project', bindings: textChain }),
      step({ id: 'bible', kind: 'asset_design', label: 'Bíblia de personagens (aparência + voz)', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas (uma fala por cena, até 15 s, com emoção)', scope: 'project', dependsOn: ['script', 'bible'], bindings: textChain }),
      step({ id: 'narration', kind: 'narration', label: 'Vozes por TTS (só de reserva: a fala vem do vídeo)', scope: 'scene', dependsOn: ['scene_plan'], bindings: castTtsChain, concurrency: 2, params: { multiVoice: true } }),
      step({ id: 'image', kind: 'image', label: 'Quadro da cena (elenco consistente)', scope: 'scene', dependsOn: ['scene_plan', 'bible'], onlySceneKinds: ['image', 'video'], bindings: imageChain }),
      step({ id: 'video', kind: 'video', label: 'Vídeo + fala da cena (MiniMax H3 ref2video com voz clonada)', scope: 'scene', dependsOn: ['image'], onlySceneKinds: ['video'],
        bindings: [{ type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v-voice.json' }, { type: 'wan2gp', template: 'wan2gp-h3-elenco-voz.json' }, { type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v-cast.json' }, ...videoChain], timeoutSec: 2400, onFail: 'skip' }),
      ...tail(['narration', 'image', 'video']),
    ],
  },
  {
    id: 'dorama-codigo', name: 'Dorama / história com elenco em código (vozes por personagem)',
    description: 'Mesma bíblia de personagens e vozes do dorama, mas cada cena é animada por código (Canvas/SVG/WebGL): os personagens são desenhados sempre com as mesmas formas e cores da bíblia, sincronizados com a fala de quem está falando.',
    videoTypes: ['micro_drama', 'interactive_story', 'custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Roteiro (falas por personagem)', scope: 'project', bindings: textChain }),
      step({ id: 'bible', kind: 'asset_design', label: 'Bíblia de personagens (desenho + voz)', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'sets', kind: 'asset_design', label: 'Cenários e objetos (biblioteca)', scope: 'project', dependsOn: ['bible'], bindings: textChain, timeoutSec: 900, onFail: 'skip' }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas', scope: 'project', dependsOn: ['script', 'bible', 'sets'], bindings: textChain }),
      step({ id: 'narration', kind: 'narration', label: 'Vozes do elenco (TTS)', scope: 'scene', dependsOn: ['scene_plan'], bindings: castTtsChain, concurrency: 2, params: { multiVoice: true } }),
      transcribeStep(),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Cena animada por código (elenco da bíblia)', scope: 'scene', dependsOn: ['scene_plan', 'transcribe', 'bible'], bindings: textChain }),
      sfxStep(false, ['code_scene']),
      ...tail(['narration', 'code_scene', 'sfx'], {}, codeMusicChain),
    ],
  },
  {
    id: 'explicativo-link', name: 'Explicativo de link (navegador + motion graphics)',
    description: 'Se a ideia tem um link: o app abre a página num navegador invisível, lê o conteúdo, tira prints e grava a página rolando → roteiro a partir da página → narração → tempos das palavras → motion graphics por código mostrando trechos da captura numa moldura de navegador, com destaques sincronizados → efeitos e trilha por código → montagem. Sem link, é o explicativo por código normal.',
    videoTypes: ['motion_graphics', 'flat_explainer', 'vector', 'custom'],
    steps: [
      ...base(), transcribeStep(),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Cena por código (captura da página + motion graphics)', scope: 'scene', dependsOn: ['scene_plan', 'transcribe'], onlySceneKinds: ['code', 'mixed', 'image', 'video', 'stock'], bindings: textChain }),
      step({ id: 'motion', kind: 'motion_graphics', label: 'Motion graphics', scope: 'scene', dependsOn: ['scene_plan', 'transcribe'], onlySceneKinds: ['motion'], bindings: textChain }),
      sfxStep(false, ['code_scene', 'motion']),
      ...tail(['narration', 'code_scene', 'motion', 'sfx'], {}, codeMusicChain).map((st) => st.kind === 'thumbnail' ? ({ ...st, bindings: [{ type: 'builtin', tool: 'frame-thumbnail' }, ...st.bindings] } as RouteStep) : st),
    ],
  },
  {
    id: 'curta-cartoon-3d', name:'Curta cartoon 3D (personagens 2D em mundo 3D, Three.js local)',
    description: 'Roteiro com gancho e virada → cenas → narração → tempos das palavras → cada cena em Three.js com a biblioteca local cartoon3d (personagens 2D com contorno num mundo 3D pintado, contorno a tinta, desfoque de fundo, câmera deslizando) → efeitos e trilha por código → montagem. Sem IA de imagem ou vídeo.',
    videoTypes: ['cartoon_3d', 'custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Roteiro (gancho → virada)', scope: 'project', bindings: textChain }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'narration', kind: 'narration', label: 'Narração (TTS)', scope: 'scene', dependsOn: ['scene_plan'], bindings: ttsChain, concurrency: 2 }),
      transcribeStep(),
      /* storyboard: elenco e paleta fixos + planos de cada cena nos tempos reais da fala (antes de escrever o código) */
      step({ id: 'storyboard', kind: 'asset_design', label: 'Storyboard (planos, elenco e paleta)', scope: 'project', dependsOn: ['scene_plan', 'transcribe'], bindings: textChain, timeoutSec: 900 }),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Cena cartoon 3D (Three.js + cartoon3d) + revisão de cena', scope: 'scene', dependsOn: ['scene_plan', 'transcribe', 'storyboard'], bindings: textChain, timeoutSec: 3600 }),
      sfxStep(false, ['code_scene']),
      /* thumbnail = quadro real do curta (o estilo não usa IA de imagem) */
      ...tail(['narration', 'code_scene', 'sfx'], {}, codeMusicChain).map((st) => st.kind === 'thumbnail' ? ({ ...st, bindings: [{ type: 'builtin', tool: 'frame-thumbnail' }] } as RouteStep) : st),
    ],
  },
  {
    id: 'cartoon-3d', name: 'Cartoon 3D — episódio longo (personagens 2D em mundo 3D, Three.js local)',
    description: 'Episódio de 3 a 10 min: roteiro em capítulos → cenas (≈ 1 a cada 10–19 s) → narração → tempos das palavras → storyboard do episódio inteiro (elenco, paleta e cenários recorrentes) → cada cena em Three.js com a biblioteca cartoon3d + revisão de cena → efeitos e trilha por código → montagem. Sem IA de imagem ou vídeo.',
    videoTypes: ['cartoon_3d', 'custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Roteiro do episódio (capítulos)', scope: 'project', bindings: textChain, timeoutSec: 1200 }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas (por capítulo)', scope: 'project', dependsOn: ['script'], bindings: textChain, timeoutSec: 1200 }),
      step({ id: 'narration', kind: 'narration', label: 'Narração (TTS)', scope: 'scene', dependsOn: ['scene_plan'], bindings: ttsChain, concurrency: 2 }),
      transcribeStep(),
      step({ id: 'storyboard', kind: 'asset_design', label: 'Storyboard do episódio (planos, elenco, cenários)', scope: 'project', dependsOn: ['scene_plan', 'transcribe'], bindings: textChain, timeoutSec: 2400 }),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Cena cartoon 3D (Three.js + cartoon3d) + revisão de cena', scope: 'scene', dependsOn: ['scene_plan', 'transcribe', 'storyboard'], bindings: textChain, timeoutSec: 3600 }),
      sfxStep(false, ['code_scene']),
      ...tail(['narration', 'code_scene', 'sfx'], {}, codeMusicChain).map((st) => st.kind === 'thumbnail' ? ({ ...st, bindings: [{ type: 'builtin', tool: 'frame-thumbnail' }] } as RouteStep) : st),
    ],
  },
  {
    id: 'lyric-video', name: 'Lyric video (canção → letra sincronizada)',
    description: 'Roteiro com a letra → canção no Yue 2 com essa letra → tempos de cada verso (Whisper) → uma cena de tipografia por código por bloco da letra → montagem com a canção em volume cheio e legendas da letra.',
    videoTypes: ['music_lyric'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Letra da canção + conceito visual', scope: 'project', bindings: textChain }),
      step({ id: 'song', kind: 'music', label: 'Canção com a letra (Yue 2) + tempos dos versos', scope: 'project', dependsOn: ['script'], bindings: [{ type: 'builtin', tool: 'lyric-song' }], timeoutSec: 3000, retry: { max: 1, backoffMs: 2000 } }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Uma cena por bloco da letra', scope: 'project', dependsOn: ['script', 'song'], bindings: textChain }),
      step({ id: 'lyrics', kind: 'transcribe', label: 'Tempos da letra em cada cena', scope: 'scene', dependsOn: ['scene_plan'], bindings: [{ type: 'builtin', tool: 'lyric-words' }], retry: { max: 1, backoffMs: 500 }, timeoutSec: 120 }),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Tipografia cinética da letra (código)', scope: 'scene', dependsOn: ['scene_plan', 'lyrics'], bindings: textChain, timeoutSec: 1200 }),
      step({ id: 'subtitles', kind: 'subtitles', label: 'Legendas da letra', scope: 'project', dependsOn: ['code_scene'], bindings: [{ type: 'builtin', tool: 'subtitles' }] }),
      step({ id: 'edit', kind: 'edit', label: 'Montagem com a canção (volume cheio)', scope: 'project', dependsOn: ['song', 'code_scene', 'subtitles'], bindings: [{ type: 'builtin', tool: 'assemble' }], params: { musicVolume: 1 } }),
      step({ id: 'metadata', kind: 'metadata', label: 'Título, descrição SEO e tags', scope: 'project', dependsOn: ['edit'], optional: true, onFail: 'skip', bindings: textChain }),
      step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail (formato do projeto)', scope: 'project', dependsOn: ['edit', 'metadata'], optional: true, onFail: 'skip', bindings: thumbChain }),
    ],
  },
  {
    id: 'slideshow-sfx', name: 'Slideshow narrado com efeitos sonoros (Flow / IA de imagem)',
    description: 'Roteiro → personagens fixos → cenas → narração → imagens (Google Flow, com fallback local/API) → efeitos sonoros por código sincronizados com a fala → montagem com movimento (Ken Burns/pan) e transições. Sem música.',
    videoTypes: ['slideshow', 'realistic', 'anime_2d', 'cartoon_3d', 'doc_netflix'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Roteiro', scope: 'project', bindings: textChain }),
      step({ id: 'assets', kind: 'asset_design', label: 'Personagens fixos (mesma aparência)', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas + efeitos sonoros', scope: 'project', dependsOn: ['script', 'assets'], bindings: textChain }),
      step({ id: 'narration', kind: 'narration', label: 'Narração (TTS)', scope: 'scene', dependsOn: ['scene_plan'], bindings: ttsChain, concurrency: 2 }),
      transcribeStep(),
      step({ id: 'image', kind: 'image', label: 'Imagem da cena (slide)', scope: 'scene', dependsOn: ['scene_plan', 'assets'], bindings: [{ type: 'flow' }, ...imageChain], timeoutSec: 900 }),
      sfxStep(true),
      step({ id: 'subtitles', kind: 'subtitles', label: 'Legendas SRT', scope: 'project', dependsOn: ['narration', 'image'], bindings: [{ type: 'builtin', tool: 'subtitles' }] }),
      step({ id: 'edit', kind: 'edit', label: 'Montagem: movimento + transições + efeitos (sem música)', scope: 'project', dependsOn: ['narration', 'image', 'sfx', 'subtitles'], bindings: [{ type: 'builtin', tool: 'assemble' }], params: { autoMotion: true, defaultTransition: 'fade', transitionSec: 0.6 } }),
      step({ id: 'metadata', kind: 'metadata', label: 'Título, descrição SEO e tags', scope: 'project', dependsOn: ['edit'], optional: true, onFail: 'skip', bindings: textChain }),
      step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail (formato do projeto)', scope: 'project', dependsOn: ['edit', 'metadata'], optional: true, onFail: 'skip', bindings: [{ type: 'flow' }, ...thumbChain], timeoutSec: 900 }),
    ],
  },
  {
    id: 'slideshow-sfx-ai', name: 'Slideshow narrado com efeitos sonoros por IA (Stable Audio 3)',
    description: 'Roteiro → personagens fixos → cenas → narração → imagens (Google Flow, com fallback local/API) → efeitos sonoros e ambiência gerados pelo Stable Audio 3 (ComfyUI ou Wan2GP; reserva: efeitos por código) → montagem com movimento e transições. Sem música.',
    videoTypes: ['slideshow', 'realistic', 'anime_2d', 'cartoon_3d', 'doc_netflix', 'micro_drama'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Roteiro', scope: 'project', bindings: textChain }),
      step({ id: 'assets', kind: 'asset_design', label: 'Personagens fixos (mesma aparência)', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas + efeitos sonoros', scope: 'project', dependsOn: ['script', 'assets'], bindings: textChain }),
      step({ id: 'narration', kind: 'narration', label: 'Narração (TTS)', scope: 'scene', dependsOn: ['scene_plan'], bindings: ttsChain, concurrency: 2 }),
      transcribeStep(),
      step({ id: 'image', kind: 'image', label: 'Imagem da cena (slide)', scope: 'scene', dependsOn: ['scene_plan', 'assets'], bindings: [{ type: 'flow' }, ...imageChain], timeoutSec: 900 }),
      sfxAiStep(),
      step({ id: 'subtitles', kind: 'subtitles', label: 'Legendas SRT', scope: 'project', dependsOn: ['narration', 'image'], bindings: [{ type: 'builtin', tool: 'subtitles' }] }),
      step({ id: 'edit', kind: 'edit', label: 'Montagem: movimento + transições + efeitos (sem música)', scope: 'project', dependsOn: ['narration', 'image', 'sfx', 'subtitles'], bindings: [{ type: 'builtin', tool: 'assemble' }], params: { autoMotion: true, defaultTransition: 'fade', transitionSec: 0.6 } }),
      step({ id: 'metadata', kind: 'metadata', label: 'Título, descrição SEO e tags', scope: 'project', dependsOn: ['edit'], optional: true, onFail: 'skip', bindings: textChain }),
      step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail (formato do projeto)', scope: 'project', dependsOn: ['edit', 'metadata'], optional: true, onFail: 'skip', bindings: [{ type: 'flow' }, ...thumbChain], timeoutSec: 900 }),
    ],
  },
  {
    id: 'local-only', name: '100 % local (ComfyUI + Ollama + ffmpeg)',
    description: 'Sem APIs comerciais: Ollama (modelo local), ComfyUI e ffmpeg. Imagem → vídeo e cenas por código.',
    videoTypes: ['custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Roteiro', scope: 'project', bindings: [H('ollama')] }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas', scope: 'project', dependsOn: ['script'], bindings: [H('ollama')] }),
      step({ id: 'narration', kind: 'narration', label: 'Narração (TTS local)', scope: 'scene', dependsOn: ['scene_plan'], bindings: [{ type: 'comfyui', server: 'local', workflow: 'omnivoice-clone-tts.json' }, { type: 'wan2gp', template: 'wan2gp-tts.json' }] }),
      transcribeStep(),
      step({ id: 'image', kind: 'image', label: 'Imagem', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['image', 'video'], bindings: [{ type: 'comfyui', server: 'local', workflow: 'krea2-turbo-t2i.json' }, { type: 'comfyui', server: 'local', workflow: 'z-image-turbo-t2i.json' }, { type: 'wan2gp', template: 'wan2gp-image.json' }] }),
      step({ id: 'video', kind: 'video', label: 'Vídeo (I2V)', scope: 'scene', dependsOn: ['image'], onlySceneKinds: ['video'], bindings: [{ type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v.json' }, { type: 'comfyui', server: 'local', workflow: 'minimax-h3-t2v.json' }, { type: 'wan2gp', template: 'wan2gp-h3-i2v.json' }, { type: 'wan2gp', template: 'wan2gp-ltx2-i2v.json' }], onFail: 'skip', timeoutSec: 2400 }),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Cena por código (Ollama)', scope: 'scene', dependsOn: ['scene_plan', 'transcribe'], onlySceneKinds: ['code', 'mixed', 'motion'], bindings: [H('ollama')], onFail: 'skip' }),
      step({ id: 'music', kind: 'music', label: 'Trilha sonora', scope: 'project', dependsOn: ['narration', 'image', 'video', 'code_scene'], optional: true, bindings: musicChain.filter((b) => b.type !== 'api') }),
      step({ id: 'subtitles', kind: 'subtitles', label: 'Legendas SRT', scope: 'project', dependsOn: ['narration', 'image', 'video', 'code_scene'], bindings: [{ type: 'builtin', tool: 'subtitles' }] }),
      step({ id: 'edit', kind: 'edit', label: 'Montagem final (ffmpeg)', scope: 'project', dependsOn: ['narration', 'image', 'video', 'code_scene', 'music', 'subtitles'], bindings: [{ type: 'builtin', tool: 'assemble' }] }),
      step({ id: 'metadata', kind: 'metadata', label: 'Título, descrição SEO e tags', scope: 'project', dependsOn: ['edit'], optional: true, onFail: 'skip', bindings: [H('ollama')] }),
      step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail (formato do projeto)', scope: 'project', dependsOn: ['edit', 'metadata'], optional: true, onFail: 'skip', bindings: thumbChain.filter((b) => b.type !== 'api') }),
    ],
  },
  {
    id: 'video-livre', name: 'Vídeo livre (prompt → harness)',
    description: 'Sem roteiro, cenas ou narração: o harness executa exatamente o prompt do projeto e entrega out/final.mp4.',
    videoTypes: ['custom'],
    steps: [
      step({ id: 'free', kind: 'free', label: 'Vídeo livre (harness executa o prompt)', scope: 'project', bindings: [H('auto')], timeoutSec: 3600, retry: { max: 1, backoffMs: 1000 } }),
    ],
  },
  {
    id: 'wan2gp-showrunner', name: 'Showrunner do Wan2GP (o diretor do Wan2GP faz tudo)',
    description: 'O Showrunner do Wan2GP (diretor Deepy Prime, LLM local) planeja as tomadas, escala o elenco, filma com os modelos instalados, revisa as tomadas e monta; o FilmForge cria a produção a partir da ideia/roteiro do projeto e traz o vídeo final. Precisa do Wan2GP com o Deepy Prime configurado; acompanhe em http://127.0.0.1:7860/showrunner/.',
    videoTypes: ['custom'],
    steps: [
      step({ id: 'showrunner', kind: 'edit', label: 'Showrunner do Wan2GP (plano, elenco, tomadas, revisão e montagem)', scope: 'project', bindings: [{ type: 'builtin', tool: 'wan2gp-showrunner' }],
        params: { kind: 'auto', maxHours: 8, director: 'qwen38_9b' }, timeoutSec: 8 * 3600 + 600, retry: { max: 0, backoffMs: 1000 } }),
    ],
  },
  {
    id: 'wan2gp-showrunner-app', name: 'Showrunner do Wan2GP com plano do FilmForge (o app planeja, o Wan2GP filma)',
    description: 'O FilmForge escreve o roteiro e as cenas (com a IA de texto da rota); cada cena vira uma tomada do Showrunner, com a fala do narrador; o Showrunner filma com os modelos instalados e monta, sem precisar do diretor (LLM) do Wan2GP.',
    videoTypes: ['custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Roteiro', scope: 'project', bindings: textChain }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas (viram as tomadas)', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'showrunner', kind: 'edit', label: 'Showrunner do Wan2GP filma e monta as cenas', scope: 'project', dependsOn: ['scene_plan'], bindings: [{ type: 'builtin', tool: 'wan2gp-showrunner' }],
        params: { kind: 'auto', mode: 'app', maxHours: 8 }, timeoutSec: 8 * 3600 + 600, retry: { max: 0, backoffMs: 1000 } }),
    ],
  },
  {
    id: 'misto-motion-banco-ia', name: 'Misto: motion graphics + bancos de mídia + vídeo IA (MiniMax)',
    description: 'Motion graphics por código, cenas com imagens/vídeos de bancos de mídia e cenas de vídeo gerado por IA (MiniMax no ComfyUI), sincronizadas com a narração.',
    videoTypes: ['motion_graphics', 'vector', 'vox_collage'],
    steps: [
      ...base(), transcribeStep(), stockStep(),
      step({ id: 'image', kind: 'image', label: 'Imagem de referência do vídeo IA', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['video', 'image'], bindings: imageChain }),
      step({ id: 'video', kind: 'video', label: 'Vídeo IA (MiniMax)', scope: 'scene', dependsOn: ['image'], onlySceneKinds: ['video'], bindings: videoChain, timeoutSec: 2400, onFail: 'skip' }),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Motion graphics por código (com mídia inserida)', scope: 'scene', dependsOn: ['scene_plan', 'transcribe', 'stock'], onlySceneKinds: ['code', 'mixed', 'motion'], bindings: textChain }),
      ...tail(['narration', 'stock', 'image', 'video', 'code_scene']),
    ],
  },
  {
    id: 'clipe-musical-loop', name: 'Clipe musical em loop (MiniMax H3 — primeiro = último frame)',
    description: 'Imagem no Krea 2 / Z-Image → MiniMax H3 com a MESMA imagem como primeiro e último frame → músicas no Yue 2 → loop perfeito com nome da faixa e waveform.',
    videoTypes: [],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Conceito visual + plano de músicas', scope: 'project', bindings: textChain }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Cena única de loop + prompt do vídeo', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'image', kind: 'image', label: 'Imagem (Krea 2 → Z-Image)', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['video', 'image'], bindings: imageChain }),
      step({ id: 'video', kind: 'video', label: 'Loop perfeito (MiniMax H3: primeiro = último frame)', scope: 'scene', dependsOn: ['image'], onlySceneKinds: ['video'], bindings: loopVideoChain, timeoutSec: 2400, params: { lockExecutors: true } }),
      step({ id: 'edit', kind: 'edit', label: 'Músicas + loop exato + waveform', scope: 'project', dependsOn: ['scene_plan', 'video'], params: { loopSeconds: 12, tracks: 0, maxTotalSeconds: 360, perfectLoop: true }, bindings: [{ type: 'builtin', tool: 'clip-musical' }], timeoutSec: 21600 }),
      step({ id: 'metadata', kind: 'metadata', label: 'Título, descrição (capítulos das faixas) e tags', scope: 'project', dependsOn: ['edit'], optional: true, onFail: 'skip', bindings: textChain }),
      step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail', scope: 'project', dependsOn: ['edit', 'metadata'], optional: true, onFail: 'skip', bindings: thumbChain }),
    ],
  },
  {
    id: 'clipe-musical-loop-codigo', name: 'Clipe musical em loop com código (Canvas/WebGL)',
    description: 'Conceito + plano de músicas → UMA cena de 12 s desenhada por código (HTML/Canvas/WebGL) em loop perfeito → músicas no Yue 2 → loop exato com nome da faixa e waveform. Sem imagem ou vídeo por IA.',
    videoTypes: [],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Conceito visual + plano de músicas', scope: 'project', bindings: textChain }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Cena única de código em loop', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'code_scene', kind: 'code_scene', label: 'Loop desenhado por código (Canvas/WebGL)', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['code'], bindings: textChain, onFail: 'skip', timeoutSec: 1800, params: { loop: true } }),
      step({ id: 'edit', kind: 'edit', label: 'Músicas + loop exato + waveform', scope: 'project', dependsOn: ['scene_plan', 'code_scene'], params: { loopSeconds: 12, tracks: 0, maxTotalSeconds: 360, perfectLoop: false, template: 'anime' }, bindings: [{ type: 'builtin', tool: 'clip-musical' }], timeoutSec: 21600 }),
      step({ id: 'metadata', kind: 'metadata', label: 'Título, descrição (capítulos das faixas) e tags', scope: 'project', dependsOn: ['edit'], optional: true, onFail: 'skip', bindings: textChain }),
      step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail', scope: 'project', dependsOn: ['edit', 'metadata'], optional: true, onFail: 'skip', bindings: [{ type: 'builtin', tool: 'frame-thumbnail' }] }),
    ],
  },
  {
    id: 'clipe-musical-pasta', name: 'Clipe musical com a sua pasta (fotos e vídeos)',
    description: 'Conceito visual → plano de cortes de 3 a 5 s com os arquivos da pasta → fotos/vídeos do usuário (trechos) → música (anexada ou gerada) → montagem. Sem narração.',
    videoTypes: ['anime_2d', 'cartoon_3d', 'motion_graphics', 'custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Conceito visual (sem narração)', scope: 'project', bindings: textChain }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Plano de cortes (3–5 s)', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'image', kind: 'image', label: 'Fotos da pasta (cena)', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['image'], bindings: imageChain, onFail: 'skip' }),
      step({ id: 'video', kind: 'video', label: 'Vídeos da pasta (trecho de 3–5 s)', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['video'], bindings: videoChain, onFail: 'skip' }),
      step({ id: 'music', kind: 'music', label: 'Música (da pasta ou gerada)', scope: 'project', dependsOn: ['scene_plan'], optional: true, bindings: musicChain }),
      step({ id: 'edit', kind: 'edit', label: 'Montagem final (ffmpeg)', scope: 'project', dependsOn: ['scene_plan', 'image', 'video', 'music'], params: { autoMotion: true }, bindings: [{ type: 'builtin', tool: 'assemble' }] }),
      step({ id: 'metadata', kind: 'metadata', label: 'Título, descrição e tags', scope: 'project', dependsOn: ['edit'], optional: true, onFail: 'skip', bindings: textChain }),
      step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail', scope: 'project', dependsOn: ['edit', 'metadata'], optional: true, onFail: 'skip', bindings: thumbChain, timeoutSec: 900 }),
    ],
  },
  {
    id: 'clipe-musical-banco', name: 'Clipe musical com banco de mídia (cortes de 3–5 s)',
    description: 'Conceito visual → cortes de 3 a 5 s → imagens e vídeos de bancos por tema → música → montagem. Sem narração.',
    videoTypes: ['anime_2d', 'cartoon_3d', 'motion_graphics', 'custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Conceito visual (sem narração)', scope: 'project', bindings: textChain }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Plano de cortes (3–5 s)', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'stock', kind: 'stock_media', label: 'Bancos de mídia (cortes de 3–5 s)', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['stock'], optional: true, onFail: 'skip',
        params: { maxSeconds: 5 }, bindings: [{ type: 'stock', sources: MIXED_STOCK_SOURCES, media: 'both' }], retry: { max: 1, backoffMs: 500 }, timeoutSec: 900 }),
      step({ id: 'music', kind: 'music', label: 'Música', scope: 'project', dependsOn: ['scene_plan'], optional: true, bindings: musicChain }),
      step({ id: 'edit', kind: 'edit', label: 'Montagem final (ffmpeg)', scope: 'project', dependsOn: ['scene_plan', 'stock', 'music'], bindings: [{ type: 'builtin', tool: 'assemble' }] }),
      step({ id: 'metadata', kind: 'metadata', label: 'Título, descrição e tags', scope: 'project', dependsOn: ['edit'], optional: true, onFail: 'skip', bindings: textChain }),
      step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail', scope: 'project', dependsOn: ['edit', 'metadata'], optional: true, onFail: 'skip', bindings: thumbChain, timeoutSec: 900 }),
    ],
  },
  {
    id: 'ugc-produto', name: 'UGC de produto (criador da biblioteca + fotos do produto)',
    description: 'Vídeo UGC de 30–40 s pensado por um especialista de marketing: gancho nos 3 primeiros segundos → dor → demonstração do produto → prova/benefício → chamada para ação. O criador é um personagem da biblioteca (mesmo rosto e voz em todas as cenas) e o produto vem das FOTOS DE REFERÊNCIA do projeto: nas cenas de produto a foto vira o quadro (o produto sai idêntico); nas cenas do criador, o MiniMax H3 Ref2VA (Wan2GP, LoRA de 4 passos) recebe o retrato do criador e a foto do produto. Reserva: Snapgen Muse AI / MiniMax H3 e os demais vídeos IA. Narração com a voz do criador (OmniVoice).',
    videoTypes: ['ad_product', 'custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Roteiro UGC (gancho → dor → demo → prova → CTA)', scope: 'project', bindings: textChain }),
      step({ id: 'bible', kind: 'asset_design', label: 'Criador e produto (biblioteca + fotos de referência)', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Cenas UGC de 3–5 s (criador falando / produto em uso)', scope: 'project', dependsOn: ['script', 'bible'], bindings: textChain }),
      step({ id: 'narration', kind: 'narration', label: 'Voz do criador (TTS)', scope: 'scene', dependsOn: ['scene_plan'], bindings: castTtsChain, concurrency: 2, params: { multiVoice: true } }),
      transcribeStep(),
      step({ id: 'image', kind: 'image', label: 'Quadro da cena (foto do produto ou criador com o produto)', scope: 'scene', dependsOn: ['scene_plan', 'bible'], onlySceneKinds: ['image', 'video'],
        bindings: [{ type: 'wan2gp', template: 'wan2gp-image-krea2-elenco.json' }, ...imageChain] }),
      step({ id: 'video', kind: 'video', label: 'Vídeo UGC (MiniMax H3 com criador + produto, 4 passos)', scope: 'scene', dependsOn: ['image', 'narration'], onlySceneKinds: ['video'],
        bindings: [{ type: 'wan2gp', template: 'wan2gp-h3-ugc-4step.json' }, { type: 'api', provider: 'snapgen', model: 'muse-ai-video' }, { type: 'api', provider: 'snapgen', model: 'minimax-h3_standard' }, ...videoChain],
        params: { videoSpeech: false }, timeoutSec: 2400, onFail: 'skip' }),
      ...tail(['narration', 'transcribe', 'image', 'video'], { musicVolume: 0.08 }),
    ],
  },
  {
    id: 'musica-lipsync', name: 'Música com lipsync (ACE-Step XL + MiniMax H3 4 passos)',
    description: 'Letra e conceito → canção no Wan2GP (ACE-Step 1.5 XL) → tempos de cada verso → uma cena por verso (3–6 s) → quadro da cena com o cantor da biblioteca → MiniMax H3 Ref2VA no Wan2GP com a LoRA de aceleração de 4 passos: o trecho da canção daquela cena entra como trilha mantida e a boca do cantor segue a voz → montagem com a canção em volume cheio e a letra como legenda. Cenas sem voz (intro/solo) usam vídeo IA comum.',
    videoTypes: ['music_lyric', 'custom'],
    steps: [
      step({ id: 'script', kind: 'script', label: 'Letra da canção + cantor + conceito visual', scope: 'project', bindings: textChain }),
      step({ id: 'bible', kind: 'asset_design', label: 'Cantor e cenário (biblioteca)', scope: 'project', dependsOn: ['script'], bindings: textChain }),
      step({ id: 'song', kind: 'music', label: 'Canção com a letra (Wan2GP ACE-Step 1.5 XL) + tempos dos versos', scope: 'project', dependsOn: ['script'],
        bindings: [{ type: 'builtin', tool: 'lyric-song' }], params: { template: 'wan2gp-music-ace.json' }, timeoutSec: 3000, retry: { max: 1, backoffMs: 2000 } }),
      step({ id: 'scene_plan', kind: 'scene_plan', label: 'Uma cena por verso (3–6 s)', scope: 'project', dependsOn: ['script', 'bible', 'song'], bindings: textChain }),
      step({ id: 'lyrics', kind: 'transcribe', label: 'Tempos da letra em cada cena', scope: 'scene', dependsOn: ['scene_plan'], bindings: [{ type: 'builtin', tool: 'lyric-words' }], retry: { max: 1, backoffMs: 500 }, timeoutSec: 120 }),
      step({ id: 'image', kind: 'image', label: 'Quadro da cena (cantor da biblioteca)', scope: 'scene', dependsOn: ['scene_plan', 'bible'], onlySceneKinds: ['image', 'video'],
        bindings: [{ type: 'wan2gp', template: 'wan2gp-image-krea2-elenco.json' }, ...imageChain] }),
      step({ id: 'video', kind: 'video', label: 'Lipsync do cantor (MiniMax H3 Ref2VA + LoRA 4 passos)', scope: 'scene', dependsOn: ['image', 'lyrics'], onlySceneKinds: ['video'],
        bindings: [{ type: 'wan2gp', template: 'wan2gp-h3-lipsync-4step.json' }, { type: 'wan2gp', template: 'wan2gp-h3-i2v.json' }, { type: 'api', provider: 'snapgen', model: 'muse-ai-video' }, ...videoChain],
        params: { videoSpeech: false }, timeoutSec: 2400, onFail: 'skip', concurrency: 1 }),
      step({ id: 'subtitles', kind: 'subtitles', label: 'Legendas da letra', scope: 'project', dependsOn: ['video'], bindings: [{ type: 'builtin', tool: 'subtitles' }] }),
      step({ id: 'edit', kind: 'edit', label: 'Montagem com a canção (volume cheio)', scope: 'project', dependsOn: ['song', 'video', 'subtitles'], bindings: [{ type: 'builtin', tool: 'assemble' }], params: { musicVolume: 1 } }),
      step({ id: 'metadata', kind: 'metadata', label: 'Título, descrição SEO e tags', scope: 'project', dependsOn: ['edit'], optional: true, onFail: 'skip', bindings: textChain }),
      step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail (formato do projeto)', scope: 'project', dependsOn: ['edit', 'metadata'], optional: true, onFail: 'skip', bindings: thumbChain, timeoutSec: 900 }),
    ],
  },
];

export const BUILTIN_SKILLS: Skill[] = [
  { id: 'explicativo-codigo', name: 'Vídeo explicativo com código', builtin: true, scriptEnding: 'next',
    description: 'Explica um tema com cenas animadas desenhadas por código, sincronizadas com a narração.',
    global: 'Faça um vídeo explicativo didático. Cada ideia vira uma cena curta (4–8 s) com UM conceito visual claro. Texto na tela grande, no máximo 6 palavras, sempre legível. Revele os elementos exatamente quando a palavra correspondente é falada (use os tempos da narração). Termine com um resumo visual e um gancho para o próximo vídeo.',
    steps: {
      script: 'Tom conversacional, frases curtas, exemplos concretos, 1 analogia por conceito difícil. Gancho nos 3 primeiros segundos.',
      scene_plan: 'Alterne cenas de código (diagramas animados) com cenas "mixed" que inserem clipes curtos de YouTube e, na reserva, fotos/vídeos dos outros bancos. Em cada cena stock/mixed, preencha searchTerms em inglês (2–4 palavras) com o assunto EXATO da frase narrada — não use termos genéricos do tema. Distribua pelo menos 1 cena mixed a cada 20–30 s.',
      code_scene: 'Anime com easing suave, paleta limitada e consistente em todo o vídeo. Se existirem arquivos em stock/, insira-os (img/video) como elementos da composição — de preferência clipes de YouTube de 2–4 s em cards, molduras ou telas dentro do motion graphics, com object-fit: cover e sem esticar. Sincronize a entrada de cada clipe com a palavra da narração que ele ilustra. Nas cenas "motion": tipografia cinética para números, datas e termos-chave; gráficos que crescem junto com a fala.',
      stock_media: 'YouTube primeiro: trechos curtos (2–4 s) que ilustram a frase; só depois Pexels, Pixabay, Wikimedia, Openverse, NASA, Internet Archive, Smithsonian e Unsplash. Prefira vídeos horizontais, sem marcas d\'água, texto embutido ou reação. Se o YouTube falhar, os outros bancos entram como reserva.',
      narration: 'Voz calma e clara, ritmo médio, pausas curtas entre ideias.',
      thumbnail: 'Rosto/objeto central grande, 3 cores no máximo, texto de até 3 palavras em fonte grossa, forte contraste.',
      metadata: 'Título até 60 caracteres com a palavra-chave no início; descrição com 2 linhas de gancho, resumo, capítulos e hashtags; 10–15 tags. Inclua os créditos das fontes de mídia.',
    } },
  { id: 'shorts-viral', name: 'Shorts viral (vertical)', builtin: true, scriptEnding: 'loop',
    description: 'Ritmo acelerado, gancho imediato e final que faz loop.',
    reviewCriteria: 'Vertical 1080x1920; 30–60 s; gancho nos 2 primeiros segundos; corte a cada 2–4 s; legenda grande e legível no centro-inferior; o último segundo emenda com o primeiro.',
    global: 'Vídeo vertical de 30–60 s. Corte a cada 2–4 s. A primeira frase precisa prender em 3 segundos. O final deve emendar com o início.',
    steps: { script: 'Frases de até 12 palavras. Uma ideia por frase.', scene_plan: 'Cenas de 2–4 s; legenda grande no centro-inferior.', thumbnail: 'Capa vertical com o momento de maior impacto e até 3 palavras.', metadata: 'Título curto e curioso, até 5 hashtags.' } },
  { id: 'documentario', name: 'Documentário narrado', builtin: true, scriptEnding: 'conclusion',
    description: 'Tom sério com B-roll de bancos de mídia, infográficos e reconstituições em vídeo IA.',
    reviewCriteria: 'Narrativa em três atos com fatos e datas; B-roll coerente com cada frase; infográficos legíveis; música bem abaixo da voz; créditos/fontes na descrição.',
    global: 'Narrativa em três atos. Use imagens e vídeos de arquivo como B-roll sempre que possível, infográficos simples por código para dados e vídeo IA só para reconstituir o que não existe em arquivo. Cite fontes na descrição.',
    steps: { script: 'Verifique fatos e datas; inclua contexto histórico.', scene_plan: 'Maioria das cenas "stock" (arquivo real); use "code" para mapas, linhas do tempo e números; "video" só para reconstituições que não existem em banco.', metadata: 'Descrição com fontes e créditos das mídias.' } },
];

export const BUILTIN_TYPES: CustomVideoType[] = [
  { id: 'explicativo-vector', name: 'Explicativo vector (código + bancos de mídia)', builtin: true, routeId: 'explainer-mixed', skillId: 'explicativo-codigo',
    appearance: 'vector', presentation: 'mixed', mediaSources: MIXED_STOCK_SOURCES, aspect: '16:9', durationSec: 120 },
  { id: 'explicativo-papercut', name: 'Explicativo paper cut (código + bancos de mídia)', builtin: true, routeId: 'explainer-mixed', skillId: 'explicativo-codigo',
    appearance: 'paper_cut', presentation: 'mixed', mediaSources: MIXED_STOCK_SOURCES, aspect: '16:9', durationSec: 120 },
  { id: 'shorts-viral-3d', name: 'Shorts viral 3D cartoon', builtin: true, routeId: 'shorts-autopilot', skillId: 'shorts-viral',
    appearance: 'cartoon_3d', presentation: 'generated', mediaSources: [], aspect: '9:16', durationSec: 60 },
  { id: 'documentario-misto', name: 'Documentário (B-roll + infográficos)', builtin: true, routeId: 'explainer-mixed', skillId: 'documentario',
    appearance: 'motion_graphics', presentation: 'mixed', mediaSources: MIXED_STOCK_SOURCES, aspect: '16:9', durationSec: 300 },
];

export const getRoute = (id: string): Route | undefined => ROUTES.find((r) => r.id === id);
export const getVideoType = (id: string): VideoTypeDef | undefined => VIDEO_TYPES.find((v) => v.id === id);

export type Profile = 'local' | 'commercial' | 'cheap';
/** Reescreve bindings em lote: local = só comfyui/builtin/harness; commercial = api primeiro. */
export function applyProfile(route: Route, profile: Profile): Route {
  const copy: Route = JSON.parse(JSON.stringify(route));
  for (const s of copy.steps) {
    const rank = (b: Binding): number => {
      if (profile === 'local') return b.type === 'api' ? 9 : (b.type === 'comfyui' || b.type === 'wan2gp') ? 0 : 1;
      if (profile === 'commercial') return b.type === 'api' ? 0 : (b.type === 'comfyui' || b.type === 'wan2gp') ? 2 : 1;
      return (b.type === 'comfyui' || b.type === 'wan2gp') ? 0 : b.type === 'builtin' ? 0 : b.type === 'harness' ? 1 : 2; // cheap
    };
    const sorted = s.bindings.map((b, i) => ({ b, i })).sort((a, c) => rank(a.b) - rank(c.b) || a.i - c.i).map((x) => x.b);
    s.bindings = profile === 'local' ? sorted.filter((b) => b.type !== 'api') : sorted;
  }
  return copy;
}

/** Etapa de revisão adicionada pelos níveis "verified" e "ultra" (se a rota não tiver uma). */
export function reviewStep(after: string, autoFix: boolean): RouteStep {
  return step({ id: 'review', kind: 'review', label: autoFix ? 'Revisão + correção automática' : 'Revisão de qualidade', scope: 'project', dependsOn: [after],
    optional: true, onFail: 'skip', bindings: textChain, timeoutSec: 900, params: autoFix ? { autoFix: true, minScore: 7, maxRounds: 1 } : {} });
}

/**
 * Níveis de qualidade = transformações na rota:
 * - depth/polished: +1 tentativa por etapa;
 * - verified: +2 tentativas e etapa de revisão (out/review.json com nota e problemas);
 * - ultra: como verified, e cenas com problema são refeitas automaticamente (1 rodada).
 * Clipes musicais e vídeo livre não ganham revisão (não há cenas narradas para corrigir).
 */
export function applyQuality(route: Route, q: 'standard' | 'depth' | 'polished' | 'verified' | 'ultra'): Route {
  const copy: Route = JSON.parse(JSON.stringify(route));
  const boost = q === 'standard' ? 0 : q === 'depth' || q === 'polished' ? 1 : 2;
  for (const s of copy.steps) {
    s.params = { ...s.params, quality: q };
    s.retry.max += boost;
  }
  const special = copy.steps.some((s) => s.kind === 'free' || s.bindings.some((b) => b.type === 'builtin' && b.tool === 'clip-musical'));
  if ((q === 'verified' || q === 'ultra') && !special) {
    const edit = copy.steps.find((s) => s.kind === 'edit');
    const existing = copy.steps.find((s) => s.kind === 'review' && s.scope === 'project');
    if (existing) { if (q === 'ultra') existing.params = { minScore: 7, maxRounds: 1, ...existing.params, autoFix: true }; }
    else if (edit) copy.steps.push({ ...reviewStep(edit.id, q === 'ultra'), params: { ...reviewStep(edit.id, q === 'ultra').params, quality: q } });
  }
  return copy;
}
