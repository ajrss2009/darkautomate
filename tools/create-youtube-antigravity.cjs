/* Rota + projeto de teste: Antigravity (gemini-3.8-flash-low) → cenas → YouTube (visão) → montagem. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const ROUTES = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge/library/routes';
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const AG = [{ type: 'harness', harness: 'antigravity', model: 'gemini-3.8-flash-low' }];
const step = (s) => ({ dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 1500 }, timeoutSec: 1200, ...s });

const route = {
  id: 'forge-youtube-antigravity',
  name: 'TESTE — Antigravity + YouTube (cenas + visão)',
  description: 'Roteiro/cenas por Antigravity (gemini-3.8-flash-low), b-roll do YouTube com checagem visual, narração OmniVoice, Whisper e montagem.',
  videoTypes: [],
  steps: [
    step({ id: 'script', kind: 'script', label: 'Roteiro (Antigravity)', scope: 'project', bindings: AG }),
    step({ id: 'scene_plan', kind: 'scene_plan', label: 'Planejar cenas (Antigravity)', scope: 'project', dependsOn: ['script'], bindings: AG }),
    step({ id: 'narration', kind: 'narration', label: 'Narração (OmniVoice)', scope: 'scene', dependsOn: ['scene_plan'], bindings: [{ type: 'comfyui', server: 'local', workflow: 'omnivoice-clone-tts.json' }], concurrency: 2, timeoutSec: 1800 }),
    step({ id: 'transcribe', kind: 'transcribe', label: 'Transcrever (Whisper → estimativa)', scope: 'scene', dependsOn: ['narration'], bindings: [{ type: 'builtin', tool: 'whisper' }, { type: 'builtin', tool: 'estimate-words' }], concurrency: 1, timeoutSec: 900 }),
    step({ id: 'stock', kind: 'stock_media', label: 'YouTube (com visão)', scope: 'scene', dependsOn: ['scene_plan'], onlySceneKinds: ['stock'], bindings: [{ type: 'stock', sources: ['youtube'], media: 'video' }], timeoutSec: 1800 }),
    step({ id: 'subtitles', kind: 'subtitles', label: 'Legendas', scope: 'project', dependsOn: ['narration', 'stock'], bindings: [{ type: 'builtin', tool: 'subtitles' }] }),
    step({ id: 'edit', kind: 'edit', label: 'Montagem', scope: 'project', dependsOn: ['narration', 'stock', 'subtitles'], bindings: [{ type: 'builtin', tool: 'assemble' }] }),
  ],
};
fs.mkdirSync(ROUTES, { recursive: true });
fs.writeFileSync(path.join(ROUTES, `${route.id}.json`), JSON.stringify(route, null, 2));
console.log('rota:', path.join(ROUTES, `${route.id}.json`));

const child = spawn(ELECTRON, ['.', '--mcp'], { cwd: APP, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
child.stderr.on('data', () => {});
let id = 1;
const call = (method, params) => new Promise((res) => { const n = id++; pending.set(n, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });

(async () => {
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'forge-yt-ag', version: '1' } });
  const r = await call('tools/call', {
    name: 'filmforge_create_project',
    arguments: {
      name: 'Teste YouTube Antigravity',
      idea: 'Como se formam as ondas do mar? Explique em 2 cenas com imagens reais do oceano.',
      skillId: 'explicativo-codigo',
      routeId: 'forge-youtube-antigravity',
      aspect: '16:9', durationSec: 10, language: 'pt-BR', maxProductionMin: 20, sceneConcurrency: 2,
    },
  });
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r);
  console.log(text);
  const m = text.match(/"id":\s*"([^"]+)"/);
  child.kill();
  if (!m) return;
  const pid = m[1];
  const file = path.join(PROJECTS, pid, 'project.json');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  p.skill = p.skill || {}; p.skill.steps = p.skill.steps || {};
  p.skill.steps.scene_plan = `${p.skill.steps.scene_plan || ''} Para este teste, use EXATAMENTE 2 cenas do tipo "stock", com 4 a 5 segundos cada. searchTerms OBRIGATÓRIO em INGLÊS (ex.: "ocean waves aerial", "underwater ocean sunlight"), descrevendo a imagem que combina com a narração em português.`.trim();
  p.skill.steps.script = `${p.skill.steps.script || ''} Roteiro curto (até 80 palavras), em português do Brasil.`.trim();
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
  console.log('projeto:', pid);
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
