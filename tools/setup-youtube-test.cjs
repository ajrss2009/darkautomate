/* Projeto de teste da fonte YouTube: 1 cena stock + narração + montagem. */
const fs = require('fs');
const path = require('path');

const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const step = (s) => ({ dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 1500 }, timeoutSec: 900, ...s });

const id = 'forge-youtube-teste';
const dir = path.join(PROJECTS, id);
fs.mkdirSync(dir, { recursive: true });
const p = {
  id, name: 'Forge YouTube (cena + narração)',
  idea: 'Teste da fonte YouTube: pôr do sol vermelho.',
  videoType: 'custom', aspect: '16:9', targetDurationSec: 6, language: 'pt-BR',
  routeId: 'forge-youtube-teste',
  route: {
    id: 'forge-youtube-teste', name: 'Smoke YouTube', description: 'Baixa um trecho do YouTube e monta com narração.', videoTypes: [],
    steps: [
      step({ id: 'narration', kind: 'narration', label: 'Narração (OmniVoice)', scope: 'scene', bindings: [{ type: 'comfyui', server: 'local', workflow: 'omnivoice-clone-tts.json' }], concurrency: 1 }),
      step({ id: 'stock', kind: 'stock_media', label: 'YouTube', scope: 'scene', bindings: [{ type: 'stock', sources: ['youtube'], media: 'video' }], timeoutSec: 600 }),
      step({ id: 'subtitles', kind: 'subtitles', label: 'Legendas', scope: 'project', dependsOn: ['narration', 'stock'], bindings: [{ type: 'builtin', tool: 'subtitles' }] }),
      step({ id: 'edit', kind: 'edit', label: 'Montagem', scope: 'project', dependsOn: ['narration', 'stock', 'subtitles'], bindings: [{ type: 'builtin', tool: 'assemble' }] }),
    ],
  },
  quality: 'standard', memories: [],
  scenes: [{
    id: 's01', index: 1, title: 'Pôr do sol vermelho',
    narration: 'Por que o céu fica vermelho no pôr do sol? A luz atravessa mais ar e o azul se espalha.',
    visualIntent: 'Céu vermelho alaranjado com nuvens no pôr do sol, time-lapse.',
    kind: 'stock', durationSec: 6, searchTerms: 'sunset red sky clouds timelapse', status: {}, artifacts: {},
  }],
  createdAt: new Date().toISOString(), presentation: 'generated', mediaSources: ['youtube'],
  subtitleStyle: { burn: false, position: 'bottom', size: 46, color: '#ffffff', box: true },
  production: { totalMs: 0, runs: [] },
};
fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(p, null, 2));
console.log('projeto YouTube:', path.join(dir, 'project.json'));
