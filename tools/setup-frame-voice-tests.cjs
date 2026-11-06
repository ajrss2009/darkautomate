/* Aplica a voz escolhida, cria as rotas Ollama (misto/código+YouTube) e os projetos do teste de frames. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const ROUTES = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge/library/routes';
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const VOICE = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge/voices/ref_antonio_24k_mono.wav';
const OL = [{ type: 'harness', harness: 'ollama', model: 'tobestyledintro/qwen3.8-9b-distill:latest' }];
const CODER = [{ type: 'harness', harness: 'ollama', model: 'LisyNeko/qwen3.8-9b-coder:latest' }];

const readRoute = (id) => JSON.parse(fs.readFileSync(path.join(ROUTES, `${id}.json`), 'utf8'));
const saveRoute = (r) => fs.writeFileSync(path.join(ROUTES, `${r.id}.json`), JSON.stringify(r, null, 2));
function applyVoice(route) {
  for (const st of route.steps || []) {
    if (st.kind !== 'narration') continue;
    for (const b of st.bindings || []) if (b.type === 'comfyui') b.refAudio = VOICE;
  }
  return route;
}

// rotas existentes: voz
for (const id of ['forge-ag-stickman', 'forge-ag-misto', 'forge-ag-codigo-youtube', 'forge-ol-stickman']) {
  const r = readRoute(id);
  applyVoice(r);
  if (id.startsWith('forge-ol')) {
    for (const st of r.steps) {
      if (st.id === 'script' || st.id === 'scene_plan') st.bindings = OL;
      if (st.id === 'code_scene' || st.id === 'motion') st.bindings = CODER;
    }
  }
  saveRoute(r);
  console.log('rota atualizada:', id);
}

// rotas Ollama novas (misto e código+YouTube)
function olFrom(srcId, id, name) {
  const r = JSON.parse(JSON.stringify(readRoute(srcId)));
  r.id = id; r.name = name;
  for (const st of r.steps) {
    if (st.id === 'script' || st.id === 'scene_plan') st.bindings = OL;
    if (st.id === 'code_scene' || st.id === 'motion') st.bindings = CODER;
  }
  applyVoice(r);
  saveRoute(r);
  console.log('rota criada:', id);
}
olFrom('forge-ag-misto', 'forge-ol-misto', 'Misto: motion + bancos + vídeo IA (MiniMax) — Ollama');
olFrom('forge-ag-codigo-youtube', 'forge-ol-codigo-youtube', 'Misto de código e imagens do YouTube (4 s) — Ollama');

// projetos existentes: voz (+ coder no 08)
for (const id of ['rel-01-stickman-ag-9bb91c', 'rel-02-misto-ag-b2a9d2', 'rel-03-codigo-youtube-ag-fd160d', 'rel-08-stickman-ol-f5c732']) {
  const f = path.join(PROJECTS, id, 'project.json');
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  applyVoice(p.route);
  if (id.includes('rel-08')) for (const st of p.route.steps) if (st.id === 'code_scene') st.bindings = CODER;
  fs.writeFileSync(f, JSON.stringify(p, null, 2));
  console.log('projeto atualizado:', id, '| voz', VOICE.split('/').pop());
}

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
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'forge-fix', version: '1' } });
  const defs = [
    { name: 'Rel OL Misto', skillId: 'misto-motion-banco-ia', routeId: 'forge-ol-misto', aspect: '16:9', durationSec: 15, maxProductionMin: 45,
      idea: 'Três invenções que mudaram o mundo: a lâmpada, o avião e a internet.',
      patch: 'Para este teste, use EXATAMENTE 3 cenas: s01 "code", s02 "mixed" (searchTerms em INGLÊS) e s03 "video". 5 s cada.' },
    { name: 'Rel OL Codigo YouTube', skillId: 'explicativo-codigo', routeId: 'forge-ol-codigo-youtube', aspect: '16:9', durationSec: 15, maxProductionMin: 45,
      idea: 'Como funciona a fotossíntese? Explique com diagramas e imagens reais.',
      patch: 'Para este teste, use EXATAMENTE 3 cenas: s01 "code", s02 "mixed" (searchTerms em INGLÊS) e s03 "code". 5 a 6 s cada.' },
  ];
  const manifest = [];
  for (const d of defs) {
    const r = await call('tools/call', { name: 'filmforge_create_project', arguments: {
      name: d.name, idea: d.idea, skillId: d.skillId, routeId: d.routeId, aspect: d.aspect, durationSec: d.durationSec,
      language: 'pt-BR', maxProductionMin: d.maxProductionMin, sceneConcurrency: 1 } });
    const text = r.result?.content?.[0]?.text ?? JSON.stringify(r);
    const m = text.match(/"id":\s*"([^"]+)"/);
    if (!m) { console.log('FALHOU', d.name, text); continue; }
    const pid = m[1];
    const f = path.join(PROJECTS, pid, 'project.json');
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (p.skill) {
      p.skill.steps = p.skill.steps || {};
      p.skill.steps.scene_plan = `${p.skill.steps.scene_plan || ''} ${d.patch}`.trim();
    }
    applyVoice(p.route);
    fs.writeFileSync(f, JSON.stringify(p, null, 2));
    manifest.push({ id: pid, name: d.name, routeId: p.routeId, skillId: p.skillId });
    console.log('criado:', pid, '|', d.name);
  }
  child.kill();
  fs.writeFileSync(path.join(APP, 'docs', 'fix-manifest.json'), JSON.stringify(manifest, null, 2));
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
