/* Cria (1) um projeto isolado para testar a chave Pexels e (2) a rota do teste
   "vídeo simples" com Ollama + Pexels + OmniVoice. */
const fs = require('fs');
const path = require('path');

const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const WORKSPACE = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge';
const ROUTES = path.join(WORKSPACE, 'library', 'routes');

const step = (s) => ({
  dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 1500 },
  timeoutSec: 900, ...s,
});

// 1) Pexels isolado ---------------------------------------------------------
const stockId = 'forge-stock-pexels';
const stockDir = path.join(PROJECTS, stockId);
fs.mkdirSync(stockDir, { recursive: true });
const stock = {
  id: stockId,
  name: 'Forge Pexels (só banco de mídia)',
  idea: 'Teste da chave Pexels.',
  videoType: 'custom', aspect: '16:9', targetDurationSec: 4, language: 'pt-BR',
  routeId: 'forge-stock-pexels',
  route: {
    id: 'forge-stock-pexels', name: 'Smoke Pexels', description: 'Baixa uma mídia do Pexels por cena.', videoTypes: [],
    steps: [step({ id: 'stock', kind: 'stock_media', label: 'Pexels', scope: 'scene', bindings: [{ type: 'stock', sources: ['pexels'], media: 'both' }], timeoutSec: 300 })],
  },
  quality: 'standard', memories: [],
  scenes: [{
    id: 's01', index: 1, title: 'Oceano', narration: 'Ondas do mar ao pôr do sol.',
    visualIntent: 'Vista aérea de ondas do oceano ao pôr do sol, dourado.',
    kind: 'stock', durationSec: 4, searchTerms: 'sunset ocean waves aerial', status: {}, artifacts: {},
  }],
  createdAt: new Date().toISOString(), presentation: 'generated', mediaSources: ['pexels'],
  subtitleStyle: { burn: false, position: 'bottom', size: 46, color: '#ffffff', box: true },
  production: { totalMs: 0, runs: [] },
};
fs.writeFileSync(path.join(stockDir, 'project.json'), JSON.stringify(stock, null, 2));
console.log('projeto Pexels:', path.join(stockDir, 'project.json'));

// 2) rota Ollama + Pexels ---------------------------------------------------
const OLLAMA = [{ type: 'harness', harness: 'ollama', model: 'tobestyledintro/qwen3.8-9b-distill:latest' }];
const route = {
  id: 'forge-ollama-pexels',
  name: 'TESTE — Vídeo simples com Ollama + Pexels (voz OmniVoice)',
  description: 'Roteiro e cenas pelo modelo local no Ollama; mídia do Pexels; narração OmniVoice; trilha Yue 2; montagem.',
  videoTypes: [],
  steps: [
    step({ id: 'script', kind: 'script', label: 'Roteiro (Ollama)', scope: 'project', bindings: OLLAMA, timeoutSec: 1200 }),
    step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas (Ollama)', scope: 'project', dependsOn: ['script'], bindings: OLLAMA, timeoutSec: 1200 }),
    step({ id: 'narration', kind: 'narration', label: 'Narração (OmniVoice)', scope: 'scene', dependsOn: ['scene_plan'], bindings: [{ type: 'comfyui', server: 'local', workflow: 'omnivoice-clone-tts.json' }], concurrency: 2, timeoutSec: 1800 }),
    step({ id: 'transcribe', kind: 'transcribe', label: 'Transcrever (Whisper → estimativa)', scope: 'scene', dependsOn: ['narration'], bindings: [{ type: 'builtin', tool: 'whisper' }, { type: 'builtin', tool: 'estimate-words' }], concurrency: 1, timeoutSec: 900 }),
    step({ id: 'stock', kind: 'stock_media', label: 'Pexels', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['stock', 'mixed'], bindings: [{ type: 'stock', sources: ['pexels'], media: 'both' }], timeoutSec: 300 }),
    step({ id: 'music', kind: 'music', label: 'Trilha (Yue 2)', scope: 'project', dependsOn: ['narration', 'stock'], optional: true, bindings: [{ type: 'comfyui', server: 'local', workflow: 'yue2-text2music.json' }], timeoutSec: 1200 }),
    step({ id: 'subtitles', kind: 'subtitles', label: 'Legendas', scope: 'project', dependsOn: ['narration', 'stock'], bindings: [{ type: 'builtin', tool: 'subtitles' }] }),
    step({ id: 'edit', kind: 'edit', label: 'Montagem', scope: 'project', dependsOn: ['narration', 'stock', 'music', 'subtitles'], bindings: [{ type: 'builtin', tool: 'assemble' }] }),
  ],
};
fs.mkdirSync(ROUTES, { recursive: true });
fs.writeFileSync(path.join(ROUTES, `${route.id}.json`), JSON.stringify(route, null, 2));
console.log('rota criada:', path.join(ROUTES, `${route.id}.json`));
