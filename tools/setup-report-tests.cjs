/* Rotas e projetos do relatório de testes (6 Antigravity + 4 Ollama).
   - YouTube com no máximo 4 s por clipe (params.maxSeconds).
   - Bindings explícitos: nada de "auto" (claude/opencode). */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const ROUTES = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge/library/routes';
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');

const AG = [{ type: 'harness', harness: 'antigravity', model: 'gemini-3.8-flash-low' }];
const OL = [{ type: 'harness', harness: 'ollama', model: 'tobestyledintro/qwen3.8-9b-distill:latest' }];
const TTS = [{ type: 'comfyui', server: 'local', workflow: 'omnivoice-clone-tts.json' }];
const IMG = [
  { type: 'comfyui', server: 'local', workflow: 'krea2-turbo-t2i.json' },
  { type: 'comfyui', server: 'local', workflow: 'z-image-turbo-t2i.json' },
];
const VID = [
  { type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v.json' },
  { type: 'comfyui', server: 'local', workflow: 'minimax-h3-t2v.json' },
];
const TR = [{ type: 'builtin', tool: 'whisper' }, { type: 'builtin', tool: 'estimate-words' }];
const SUB = [{ type: 'builtin', tool: 'subtitles' }];
const EDIT = [{ type: 'builtin', tool: 'assemble' }];
const PEXELS = [{ type: 'stock', sources: ['pexels', 'pixabay', 'wikipedia'], media: 'both' }];
const YT = [{ type: 'stock', sources: ['youtube'], media: 'video' }];

const st = (id, kind, scope, deps, bindings, extra = {}) => ({
  id, kind, label: id, scope, dependsOn: deps, enabled: true, params: {}, retry: { max: 1, backoffMs: 1500 },
  timeoutSec: 1200, bindings, ...extra,
});
const base = (H) => [
  st('script', 'script', 'project', [], H),
  st('scene_plan', 'scene_plan', 'project', ['script'], H),
  st('narration', 'narration', 'scene', ['scene_plan'], TTS, { concurrency: 2, timeoutSec: 1800 }),
  st('transcribe', 'transcribe', 'scene', ['narration'], TR, { concurrency: 1, timeoutSec: 900 }),
];
const tail = (visuals) => [
  st('subtitles', 'subtitles', 'project', ['narration', ...visuals], SUB, { timeoutSec: 900 }),
  st('edit', 'edit', 'project', ['narration', ...visuals, 'subtitles'], EDIT, { timeoutSec: 900 }),
];

function routes() {
  const R = (id, name, description, steps) => ({ id, name, description, videoTypes: [], steps });
  return [
    R('forge-ag-stickman', 'Explicativo por código (stickman/flat/low poly) — AG',
      'Cenas desenhadas por código pelo Antigravity.', [
        ...base(AG),
        st('code_scene', 'code_scene', 'scene', ['scene_plan', 'transcribe'], AG, { onlySceneKinds: ['code'], onFail: 'skip' }),
        st('motion', 'motion_graphics', 'scene', ['scene_plan', 'transcribe'], AG, { onlySceneKinds: ['motion'], onFail: 'skip' }),
        ...tail(['code_scene', 'motion']),
      ]),
    R('forge-ag-misto', 'Misto: motion graphics + bancos de mídia + vídeo IA (MiniMax) — AG',
      'Código + Pexels/Pixabay/Wikipedia + imagem Krea + vídeo MiniMax.', [
        ...base(AG),
        st('stock', 'stock_media', 'scene', ['scene_plan'], PEXELS, { onlySceneKinds: ['stock', 'mixed'], optional: true, onFail: 'skip', timeoutSec: 600 }),
        st('image', 'image', 'scene', ['scene_plan'], IMG, { onlySceneKinds: ['video', 'image'], timeoutSec: 1800 }),
        st('video', 'video', 'scene', ['image'], VID, { onlySceneKinds: ['video'], onFail: 'skip', timeoutSec: 2400 }),
        st('code_scene', 'code_scene', 'scene', ['scene_plan', 'transcribe', 'stock'], AG, { onlySceneKinds: ['code', 'mixed', 'motion'], onFail: 'skip' }),
        st('motion', 'motion_graphics', 'scene', ['scene_plan', 'transcribe'], AG, { onlySceneKinds: ['motion'], onFail: 'skip' }),
        ...tail(['stock', 'image', 'video', 'code_scene', 'motion']),
      ]),
    R('forge-ag-codigo-youtube', 'Misto de código e imagens do YouTube (clipes de 4 s) — AG',
      'Motion graphics por código + b-roll do YouTube (máx. 4 s por clipe) com checagem visual.', [
        ...base(AG),
        st('stock', 'stock_media', 'scene', ['scene_plan'], YT, { onlySceneKinds: ['stock', 'mixed'], optional: true, onFail: 'skip', params: { maxSeconds: 4 }, timeoutSec: 1800 }),
        st('code_scene', 'code_scene', 'scene', ['scene_plan', 'transcribe', 'stock'], AG, { onlySceneKinds: ['code', 'mixed', 'motion'], onFail: 'skip' }),
        st('motion', 'motion_graphics', 'scene', ['scene_plan', 'transcribe'], AG, { onlySceneKinds: ['motion'], onFail: 'skip' }),
        ...tail(['stock', 'code_scene', 'motion']),
      ]),
    R('forge-ag-shorts', 'Shorts vertical: código + MiniMax H3 — AG',
      '9:16 com cenas por código e clipes de vídeo MiniMax H3.', [
        ...base(AG),
        st('image', 'image', 'scene', ['scene_plan'], IMG, { onlySceneKinds: ['video', 'image'], timeoutSec: 1800 }),
        st('video', 'video', 'scene', ['image'], VID, { onlySceneKinds: ['video'], onFail: 'skip', timeoutSec: 2400 }),
        st('code_scene', 'code_scene', 'scene', ['scene_plan', 'transcribe'], AG, { onlySceneKinds: ['code', 'mixed', 'motion'], onFail: 'skip' }),
        st('motion', 'motion_graphics', 'scene', ['scene_plan', 'transcribe'], AG, { onlySceneKinds: ['motion'], onFail: 'skip' }),
        ...tail(['image', 'video', 'code_scene', 'motion']),
      ]),
    R('forge-ag-doc-youtube', 'Documentário: YouTube 4 s + motion + MiniMax — AG',
      'B-roll do YouTube (máx. 4 s, com visão), imagens Krea, vídeo MiniMax e código.', [
        ...base(AG),
        st('stock', 'stock_media', 'scene', ['scene_plan'], YT, { onlySceneKinds: ['stock', 'mixed'], optional: true, onFail: 'skip', params: { maxSeconds: 4 }, timeoutSec: 1800 }),
        st('image', 'image', 'scene', ['scene_plan'], IMG, { onlySceneKinds: ['video', 'image'], timeoutSec: 1800 }),
        st('video', 'video', 'scene', ['image'], VID, { onlySceneKinds: ['video'], onFail: 'skip', timeoutSec: 2400 }),
        st('code_scene', 'code_scene', 'scene', ['scene_plan', 'transcribe', 'stock'], AG, { onlySceneKinds: ['code', 'mixed', 'motion'], onFail: 'skip' }),
        st('motion', 'motion_graphics', 'scene', ['scene_plan', 'transcribe'], AG, { onlySceneKinds: ['motion'], onFail: 'skip' }),
        ...tail(['stock', 'image', 'video', 'code_scene', 'motion']),
      ]),
    R('forge-ag-livre', 'Vídeo livre (prompt → harness) — AG',
      'O harness executa o prompt e entrega out/final.mp4.', [
        st('free', 'free', 'project', [], AG, { timeoutSec: 3600 }),
      ]),
    R('forge-ol-realista', 'Realista: Krea + MiniMax — Ollama',
      'Roteiro/cenas pelo Ollama; imagem Krea e vídeo MiniMax.', [
        ...base(OL),
        st('image', 'image', 'scene', ['scene_plan'], IMG, { onlySceneKinds: ['video', 'image'], timeoutSec: 1800 }),
        st('video', 'video', 'scene', ['image'], VID, { onlySceneKinds: ['video'], onFail: 'skip', timeoutSec: 2400 }),
        ...tail(['image', 'video']),
      ]),
    R('forge-ol-stickman', 'Explicativo por código — Ollama',
      'Cenas por código escritas pelo modelo local.', [
        ...base(OL),
        st('code_scene', 'code_scene', 'scene', ['scene_plan', 'transcribe'], OL, { onlySceneKinds: ['code'], onFail: 'skip' }),
        st('motion', 'motion_graphics', 'scene', ['scene_plan', 'transcribe'], OL, { onlySceneKinds: ['motion'], onFail: 'skip' }),
        ...tail(['code_scene', 'motion']),
      ]),
    R('forge-ol-cartoon', '3D Cartoon: Krea + MiniMax + código — Ollama',
      'Imagem Krea, vídeo MiniMax e cenas de código pelo Ollama.', [
        ...base(OL),
        st('image', 'image', 'scene', ['scene_plan'], IMG, { onlySceneKinds: ['video', 'image'], timeoutSec: 1800 }),
        st('video', 'video', 'scene', ['image'], VID, { onlySceneKinds: ['video'], onFail: 'skip', timeoutSec: 2400 }),
        st('code_scene', 'code_scene', 'scene', ['scene_plan', 'transcribe'], OL, { onlySceneKinds: ['code', 'mixed', 'motion'], onFail: 'skip' }),
        ...tail(['image', 'video', 'code_scene']),
      ]),
    R('forge-ol-doc', 'Documentário: Pexels + código — Ollama',
      'Bancos de mídia + motion graphics pelo Ollama.', [
        ...base(OL),
        st('stock', 'stock_media', 'scene', ['scene_plan'], [{ type: 'stock', sources: ['pexels', 'wikipedia'], media: 'both' }], { onlySceneKinds: ['stock', 'mixed'], optional: true, onFail: 'skip', timeoutSec: 600 }),
        st('code_scene', 'code_scene', 'scene', ['scene_plan', 'transcribe', 'stock'], OL, { onlySceneKinds: ['code', 'mixed', 'motion'], onFail: 'skip' }),
        ...tail(['stock', 'code_scene']),
      ]),
  ];
}

const FREE_IDEA = `Crie um curta de anime 2D de 8 segundos, 1280x720, 24 fps, sobre uma guerreira anime que descobre um poder nas montanhas ao amanhecer.
Faça TUDO localmente, sem rede:
1) Use o Python do ComfyUI em "F:\\Comfy-Desktop\\ComfyUI-Installs\\COMFYUILAB\\ComfyUI\\.venv\\Scripts\\python.exe" com Pillow para desenhar 192 quadros (frames/f_0001.png ... f_0192.png): céu em gradiente do azul ao laranja, sol nascendo, montanhas em camadas com parallax, silhueta da guerreira com cabelo/vento, partículas/energia brilhando; estilo anime, cores limpas, sem texto.
2) Codifique com "E:\\DOWNLOAD\\ffmpeg\\bin\\ffmpeg.exe" -framerate 24 -i frames/f_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart out/final.mp4.
3) Confira que out/final.mp4 tem ~8 s e 1280x720.`;

const projects = [
  { name: 'Rel 01 Stickman AG', skillId: 'stickman', routeId: 'forge-ag-stickman', aspect: '16:9', duration: 12, max: 30, conc: 2,
    idea: 'Explique em 2 cenas, com bonecos de palito, por que o céu é azul.',
    patch: 'Para este teste, use EXATAMENTE 2 cenas do tipo "code", com 5 a 6 s cada, em português do Brasil.' },
  { name: 'Rel 02 Misto AG', skillId: 'misto-motion-banco-ia', routeId: 'forge-ag-misto', aspect: '16:9', duration: 15, max: 40, conc: 1,
    idea: 'Três invenções que mudaram o mundo: a lâmpada, o avião e a internet.',
    patch: 'Para este teste, use EXATAMENTE 3 cenas: s01 "code", s02 "mixed" (searchTerms em INGLÊS) e s03 "video". 5 s cada.' },
  { name: 'Rel 03 Codigo YouTube AG', skillId: 'explicativo-codigo', routeId: 'forge-ag-codigo-youtube', aspect: '16:9', duration: 15, max: 40, conc: 1,
    idea: 'Como funciona a fotossíntese? Explique com diagramas e imagens reais.',
    patch: 'Para este teste, use EXATAMENTE 3 cenas: s01 "code", s02 "mixed" (searchTerms em INGLÊS) e s03 "code". 5 a 6 s cada.' },
  { name: 'Rel 04 Shorts Viral AG', skillId: 'shorts-viral', routeId: 'forge-ag-shorts', aspect: '9:16', duration: 12, max: 40, conc: 1,
    idea: 'Três fatos surpreendentes sobre o oceano.',
    patch: 'Para este teste, use EXATAMENTE 2 cenas: s01 "code" e s02 "video". 5 a 6 s cada.' },
  { name: 'Rel 05 Doc YouTube AG', skillId: 'documentario', routeId: 'forge-ag-doc-youtube', aspect: '16:9', duration: 15, max: 45, conc: 1,
    idea: 'A história da imprensa de Gutenberg em 2 cenas.',
    patch: 'Para este teste, use EXATAMENTE 3 cenas: s01 "mixed" (searchTerms em INGLÊS), s02 "video" e s03 "code". 5 s cada.' },
  { name: 'Rel 06 Anime Livre AG', skillId: 'anime_2d', routeId: 'forge-ag-livre', aspect: '16:9', duration: 8, max: 30, conc: 1,
    idea: FREE_IDEA, free: true },
  { name: 'Rel 07 Realista OL', skillId: 'realistic', routeId: 'forge-ol-realista', aspect: '16:9', duration: 12, max: 35, conc: 1,
    idea: 'Um farol solitário numa tempestade ao anoitecer.',
    patch: 'Para este teste, use EXATAMENTE 2 cenas do tipo "video", com 5 a 6 s cada.' },
  { name: 'Rel 08 Stickman OL', skillId: 'stickman', routeId: 'forge-ol-stickman', aspect: '16:9', duration: 10, max: 35, conc: 1,
    idea: 'Como os foguetes vencem a gravidade?',
    patch: 'Para este teste, use EXATAMENTE 2 cenas do tipo "code", com 4 a 5 s cada.' },
  { name: 'Rel 09 Cartoon OL', skillId: 'cartoon_3d', routeId: 'forge-ol-cartoon', aspect: '16:9', duration: 12, max: 35, conc: 1,
    idea: 'Um robô simpático explica reciclagem.',
    patch: 'Para este teste, use EXATAMENTE 2 cenas do tipo "video", com 5 a 6 s cada.' },
  { name: 'Rel 10 Doc OL', skillId: 'documentario', routeId: 'forge-ol-doc', aspect: '16:9', duration: 12, max: 35, conc: 1,
    idea: 'A corrida espacial em 2 cenas.',
    patch: 'Para este teste, use EXATAMENTE 2 cenas do tipo "mixed", com 5 s cada, searchTerms em INGLÊS.' },
];

(async () => {
  fs.mkdirSync(ROUTES, { recursive: true });
  const allRoutes = routes();
  for (const r of allRoutes) fs.writeFileSync(path.join(ROUTES, `${r.id}.json`), JSON.stringify(r, null, 2));
  console.log('rotas criadas:', allRoutes.length);

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
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'forge-report', version: '1' } });

  const manifest = [];
  for (const p of projects) {
    const r = await call('tools/call', {
      name: 'filmforge_create_project',
      arguments: { name: p.name, idea: p.idea, skillId: p.skillId, routeId: p.routeId, aspect: p.aspect, durationSec: p.duration, language: 'pt-BR', maxProductionMin: p.max, sceneConcurrency: p.conc },
    });
    const text = r.result?.content?.[0]?.text ?? JSON.stringify(r);
    const m = text.match(/"id":\s*"([^"]+)"/);
    if (!m) { console.log('FALHOU criar', p.name, text); continue; }
    const pid = m[1];
    const file = path.join(PROJECTS, pid, 'project.json');
    const proj = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (p.patch && proj.skill) {
      proj.skill.steps = proj.skill.steps || {};
      proj.skill.steps.scene_plan = `${proj.skill.steps.scene_plan || ''} ${p.patch}`.trim();
    }
    if (p.free) {
      const freeRoute = allRoutes.find((x) => x.id === 'forge-ag-livre');
      proj.routeId = 'forge-ag-livre';
      proj.route = JSON.parse(JSON.stringify(freeRoute));
      proj.scenes = [];
      proj.idea = FREE_IDEA;
      proj.presentation = 'generated';
    }
    fs.writeFileSync(file, JSON.stringify(proj, null, 2));
    manifest.push({ id: pid, name: p.name, skillId: p.skillId, routeId: proj.routeId, aspect: p.aspect, duration: p.duration, free: !!p.free });
    console.log('criado:', pid, '|', p.name, '|', proj.routeId);
  }
  child.kill();
  const out = path.join(APP, 'docs', 'report-manifest.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log('manifest:', out);
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
