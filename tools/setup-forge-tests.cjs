/* Cria a rota de teste de mídia (ComfyUI) e um projeto de fumaça para validar
   imagem (Krea 2), voz (OmniVoice) e vídeo (MiniMax H3) sem gastar harness. */
const fs = require('fs');
const path = require('path');

const WORKSPACE = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const ROUTES = path.join(WORKSPACE, 'library', 'routes');
const AG = [{ type: 'harness', harness: 'antigravity', model: 'gemini-3.8-flash-low' }];
const COMFY_IMG = [
  { type: 'comfyui', server: 'local', workflow: 'krea2-turbo-t2i.json' },
  { type: 'comfyui', server: 'local', workflow: 'z-image-turbo-t2i.json' },
];
const COMFY_VIDEO = [
  { type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v.json' },
  { type: 'comfyui', server: 'local', workflow: 'minimax-h3-t2v.json' },
];
const COMFY_TTS = [{ type: 'comfyui', server: 'local', workflow: 'omnivoice-clone-tts.json' }];
const step = (s) => ({
  dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 1500 },
  timeoutSec: 1200, ...s,
});

const route = {
  id: 'forge-midia-comfyui-antigravity',
  name: 'TESTE — Mídia ComfyUI (imagem + vídeo + voz) · Antigravity',
  description: 'Verificação ponta a ponta: roteiro/cenas/código por Antigravity (gemini-3.8-flash-low), narração OmniVoice, imagem Krea 2 e vídeo MiniMax H3 no ComfyUI local.',
  videoTypes: [],
  steps: [
    step({ id: 'script', kind: 'script', label: 'Roteiro', scope: 'project', bindings: AG }),
    step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas', scope: 'project', dependsOn: ['script'], bindings: AG }),
    step({ id: 'narration', kind: 'narration', label: 'Narração (OmniVoice)', scope: 'scene', dependsOn: ['scene_plan'], bindings: COMFY_TTS, concurrency: 2, timeoutSec: 1800 }),
    step({ id: 'transcribe', kind: 'transcribe', label: 'Transcrever (Whisper → estimativa)', scope: 'scene', dependsOn: ['narration'], bindings: [{ type: 'builtin', tool: 'whisper' }, { type: 'builtin', tool: 'estimate-words' }], concurrency: 1, timeoutSec: 600 }),
    step({ id: 'stock', kind: 'stock_media', label: 'Bancos de mídia (Pexels/Pixabay/Wikipedia)', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['stock', 'mixed'], optional: true, onFail: 'skip',
      bindings: [{ type: 'stock', sources: ['pexels', 'pixabay', 'wikipedia'], media: 'both' }], timeoutSec: 300 }),
    step({ id: 'image', kind: 'image', label: 'Imagem da cena (Krea 2)', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['video', 'image'], bindings: COMFY_IMG, timeoutSec: 1800 }),
    step({ id: 'video', kind: 'video', label: 'Vídeo da cena (MiniMax H3)', scope: 'scene', dependsOn: ['image'], onlySceneKinds: ['video'], bindings: COMFY_VIDEO, onFail: 'skip', timeoutSec: 2400 }),
    step({ id: 'code_scene', kind: 'code_scene', label: 'Cena por código', scope: 'scene', dependsOn: ['scene_plan', 'transcribe', 'stock'], onlySceneKinds: ['code', 'mixed', 'motion'], bindings: AG, onFail: 'skip' }),
    step({ id: 'motion', kind: 'motion_graphics', label: 'Motion graphics', scope: 'scene', dependsOn: ['scene_plan', 'transcribe'], onlySceneKinds: ['motion'], bindings: AG, onFail: 'skip' }),
    step({ id: 'music', kind: 'music', label: 'Trilha sonora (Yue 2)', scope: 'project', dependsOn: ['narration', 'image', 'video', 'code_scene', 'motion'], optional: true,
      bindings: [{ type: 'comfyui', server: 'local', workflow: 'yue2-text2music.json' }, { type: 'builtin', tool: 'library-music' }], timeoutSec: 1200 }),
    step({ id: 'subtitles', kind: 'subtitles', label: 'Legendas SRT', scope: 'project', dependsOn: ['narration', 'image', 'video', 'code_scene', 'motion'], bindings: [{ type: 'builtin', tool: 'subtitles' }] }),
    step({ id: 'edit', kind: 'edit', label: 'Montagem final', scope: 'project', dependsOn: ['narration', 'image', 'video', 'code_scene', 'motion', 'music', 'subtitles'], bindings: [{ type: 'builtin', tool: 'assemble' }] }),
    step({ id: 'thumbnail', kind: 'thumbnail', label: 'Thumbnail', scope: 'project', dependsOn: ['scene_plan'], optional: true, onFail: 'skip', bindings: COMFY_IMG }),
    step({ id: 'metadata', kind: 'metadata', label: 'Título/descrição/tags', scope: 'project', dependsOn: ['edit'], optional: true, bindings: AG }),
  ],
};

fs.mkdirSync(ROUTES, { recursive: true });
const routeFile = path.join(ROUTES, `${route.id}.json`);
fs.writeFileSync(routeFile, JSON.stringify(route, null, 2));
console.log('rota criada:', routeFile);

// ── projeto de fumaça do ComfyUI (sem harness): 1 imagem + 1 narração ──
const smokeId = 'forge-comfy-smoke';
const smokeDir = path.join(PROJECTS, smokeId);
fs.mkdirSync(smokeDir, { recursive: true });
const smoke = {
  id: smokeId,
  name: 'Forge Comfy Smoke (imagem + voz)',
  idea: 'Teste de acesso ao ComfyUI: uma imagem e uma locução.',
  videoType: 'vector',
  aspect: '16:9',
  targetDurationSec: 4,
  language: 'pt-BR',
  routeId: 'forge-comfy-smoke',
  route: {
    id: 'forge-comfy-smoke',
    name: 'Smoke ComfyUI',
    description: 'Imagem (Krea 2) + narração (OmniVoice) por cena.',
    videoTypes: [],
    steps: [
      step({ id: 'image', kind: 'image', label: 'Imagem (Krea 2)', scope: 'scene', bindings: [{ type: 'comfyui', server: 'local', workflow: 'krea2-turbo-t2i.json' }], timeoutSec: 1200 }),
      step({ id: 'narration', kind: 'narration', label: 'Narração (OmniVoice)', scope: 'scene', bindings: COMFY_TTS, timeoutSec: 1800 }),
    ],
  },
  quality: 'standard',
  memories: [],
  scenes: [{
    id: 's01', index: 1, title: 'Teste', narration: 'Teste de voz em português do Brasil.',
    visualIntent: 'Um círculo azul grande sobre fundo branco, estilo flat minimalista, sem texto.',
    kind: 'image', durationSec: 4, status: {}, artifacts: {},
  }],
  createdAt: new Date().toISOString(),
  presentation: 'generated',
  mediaSources: [],
  subtitleStyle: { burn: false, position: 'bottom', size: 46, color: '#ffffff', box: true },
  production: { totalMs: 0, runs: [] },
};
fs.writeFileSync(path.join(smokeDir, 'project.json'), JSON.stringify(smoke, null, 2));
console.log('projeto de fumaça criado:', path.join(smokeDir, 'project.json'));
