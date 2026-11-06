/* Skill/rotas/projetos do clipe musical em loop (3 faixas + waveform). */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const WORKSPACE = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge';
const ROUTES = path.join(WORKSPACE, 'library', 'routes');
const SKILLS = path.join(WORKSPACE, 'library', 'skills');
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const AG = [{ type: 'harness', harness: 'antigravity', model: 'gemini-3.8-flash-low' }];
const OL = [{ type: 'harness', harness: 'ollama', model: 'tobestyledintro/qwen3.8-9b-distill:latest' }];
const IMG = [{ type: 'comfyui', server: 'local', workflow: 'krea2-turbo-t2i.json' }];
const VID = [{ type: 'comfyui', server: 'local', workflow: 'minimax-h3-ref2v.json' }, { type: 'comfyui', server: 'local', workflow: 'minimax-h3-t2v.json' }];
const st = (id, kind, scope, deps, bindings, extra = {}) => ({ id, kind, label: id, scope, dependsOn: deps, enabled: true, params: {}, retry: { max: 2, backoffMs: 1500 }, timeoutSec: 1200, bindings, ...extra });

const skill = {
  id: 'clipe-musical',
  name: 'Clipe musical em loop',
  description: 'Clipe musical com 3 faixas geradas, visual em loop (pixel art ou vídeo IA), nome da faixa e waveform lateral.',
  appearance: 'pixel_art',
  routeId: 'clipe-musical-code-ag',
  aspect: '16:9',
  durationSec: 12,
  language: 'pt-BR',
  presentation: 'generated',
  outputStyle: 'Clipe musical verticalizado em loop: 3 faixas instrumentais, visual pixel art/vídeo em loop de 10–15 s, nome da faixa atual no topo e waveform lateral. Saída: final.mp4.',
  global: 'Você cria um CLIPE MUSICAL, não uma narração. O visual é um loop de 10–15 s (pixel art ou vídeo IA) e a trilha tem 3 faixas instrumentais no estilo musical do projeto. O app gera as músicas, coloca o visual em loop e sobrepõe o nome da faixa que está tocando + waveform lateral.',
  steps: {
    script: 'Você cria um CLIPE MUSICAL, não uma narração. Grave `script.md` com: 1) um conceito visual curto (pixel art, foco no café e na janela, carros passando, luz neon, paleta âmbar/azul); 2) a linha `MUSIC_PLAN:` seguida de um ARRAY JSON com EXATAMENTE 3 faixas, no formato [{"name":"...","style":"...","seconds":18},{"name":"...","style":"...","seconds":18},{"name":"...","style":"...","seconds":18}]. Use o estilo musical do projeto; nomes curtos e temáticos. Não escreva narração falada.',
    scene_plan: 'Crie EXATAMENTE 1 cena de 12 s. Se a rota tiver etapa de código, use kind "code"; se tiver vídeo, use kind "video". Deixe a narração vazia. visualIntent: descreva o loop pixel art (café fumegante, janela, carros, neon) com composição estável e movimento contínuo. Preencha searchTerms em inglês quando for vídeo.',
    code_scene: 'Crie uma página HTML autocontida de PIXEL ART (canvas) com loop visual de 12 s: lanchonete aconchegante, café fumegante na mesa, janela com carros passando e letreiro neon. Use window.__forge com duration 12, fps 30, seek(t) determinístico e pause() que cancela o requestAnimationFrame.',
    image: 'Imagem pixel art 16:9 de uma lanchonete aconchegante à noite: café fumegante na mesa junto à janela, carros passando com faróis, letreiro neon, paleta âmbar/azul. Sem texto.',
    video: 'Vídeo em loop pixel art da mesma lanchonete: café fumegante, janela, carros passando, luz neon; câmera fixa e movimento contínuo.',
  },
};
fs.mkdirSync(SKILLS, { recursive: true });
fs.writeFileSync(path.join(SKILLS, 'clipe-musical.json'), JSON.stringify(skill, null, 2));
console.log('skill criada: clipe-musical');

const route = (id, name, H, withVideo) => {
  const steps = [
    st('script', 'script', 'project', [], H, { timeoutSec: 900 }),
    st('scene_plan', 'scene_plan', 'project', ['script'], H, { timeoutSec: 900 }),
  ];
  if (withVideo) {
    steps.push(st('image', 'image', 'scene', ['scene_plan'], IMG, { onlySceneKinds: ['video', 'image'], timeoutSec: 1800 }));
    steps.push(st('video', 'video', 'scene', ['image'], VID, { onlySceneKinds: ['video'], onFail: 'skip', timeoutSec: 2400 }));
    steps.push(st('edit', 'edit', 'project', ['scene_plan', 'video'], [{ type: 'builtin', tool: 'clip-musical' }], { timeoutSec: 3000 }));
  } else {
    steps.push(st('code_scene', 'code_scene', 'scene', ['scene_plan'], H, { onlySceneKinds: ['code'], onFail: 'skip', timeoutSec: 1800 }));
    steps.push(st('edit', 'edit', 'project', ['scene_plan', 'code_scene'], [{ type: 'builtin', tool: 'clip-musical' }], { timeoutSec: 3000 }));
  }
  return { id, name, description: 'Clipe musical em loop com 3 faixas, waveform e nome da faixa.', videoTypes: [], steps };
};
const routes = [
  route('clipe-musical-code-ag', 'Clipe musical em loop (pixel por código) — Antigravity', AG, false),
  route('clipe-musical-video-ag', 'Clipe musical em loop (MiniMax H3) — Antigravity', AG, true),
  route('clipe-musical-video-ol', 'Clipe musical em loop (MiniMax H3) — Ollama', OL, true),
];
for (const r of routes) fs.writeFileSync(path.join(ROUTES, `${r.id}.json`), JSON.stringify(r, null, 2));
console.log('rotas criadas:', routes.map((r) => r.id).join(', '));

const idea = 'Clipe musical em pixel art de uma lanchonete aconchegante à noite: foco no café fumegante sobre a mesa junto à janela, carros passando na rua com faróis, letreiro neon e reflexos no vidro. Paleta âmbar/azul, atmosfera cozy. 3 faixas instrumentais low-fi.';
const musicStyle = 'lo-fi, chill, café, vinil, noturno, instrumental, sem vocais';
const projects = [
  { name: 'Clipe Pixel AG Código', routeId: 'clipe-musical-code-ag', patch: 'Para este clipe, use EXATAMENTE 1 cena do tipo "code", 12 s, com narração vazia.' },
  { name: 'Clipe Pixel AG MiniMax', routeId: 'clipe-musical-video-ag', patch: 'Para este clipe, use EXATAMENTE 1 cena do tipo "video", 12 s, com narração vazia; searchTerms em inglês.' },
  { name: 'Clipe Pixel OL MiniMax', routeId: 'clipe-musical-video-ol', patch: 'Para este clipe, use EXATAMENTE 1 cena do tipo "video", 12 s, com narração vazia; searchTerms em inglês.' },
];

const child = spawn(ELECTRON, ['.', '--mcp'], { cwd: APP, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString(); let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
child.stderr.on('data', () => {});
let n = 1;
const call = (method, params) => new Promise((res) => { const id = n++; pending.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });

(async () => {
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'forge-music', version: '1' } });
  const manifest = [];
  for (const d of projects) {
    const r = await call('tools/call', { name: 'filmforge_create_project', arguments: {
      name: d.name, idea, skillId: 'clipe-musical', routeId: d.routeId, aspect: '16:9', durationSec: 12,
      language: 'pt-BR', maxProductionMin: 40, sceneConcurrency: 1, musicStyle } });
    const text = r.result?.content?.[0]?.text ?? JSON.stringify(r);
    const m = text.match(/"id":\s*"([^"]+)"/);
    if (!m) { console.log('FALHOU', d.name, text); continue; }
    const pid = m[1];
    const f = path.join(PROJECTS, pid, 'project.json');
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    p.skill = p.skill || {}; p.skill.steps = p.skill.steps || {};
    p.skill.steps.scene_plan = `${p.skill.steps.scene_plan || ''} ${d.patch}`.trim();
    p.musicStyle = musicStyle;
    fs.writeFileSync(f, JSON.stringify(p, null, 2));
    manifest.push({ id: pid, name: d.name, routeId: d.routeId });
    console.log('projeto:', pid, '|', d.name, '|', p.routeId);
  }
  child.kill();
  fs.writeFileSync(path.join(APP, 'docs', 'music-manifest.json'), JSON.stringify(manifest, null, 2));
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
