/* Paris lo-fi: rota código OL + loop forward (2 faixas de 12 s), e projetos. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const ROUTES = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge/library/routes';
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const OL = [{ type: 'harness', harness: 'ollama', model: 'tobestyledintro/qwen3.8-9b-distill:latest' }];
const CODER = [{ type: 'harness', harness: 'ollama', model: 'LisyNeko/qwen3.8-9b-coder:latest' }];
const st = (id, kind, scope, deps, bindings, extra = {}) => ({ id, kind, label: id, scope, dependsOn: deps, enabled: true, params: {}, retry: { max: 2, backoffMs: 1500 }, timeoutSec: 1200, bindings, ...extra });

const codeRoute = {
  id: 'clipe-musical-code-ol',
  name: 'Clipe musical 16-bit em loop — Ollama',
  description: 'Duas faixas, código 16-bit, loop forward perfeito, waveform sobreposta e nome da faixa.',
  videoTypes: [],
  steps: [
    st('script', 'script', 'project', [], OL, { timeoutSec: 900 }),
    st('scene_plan', 'scene_plan', 'project', ['script'], OL, { timeoutSec: 900 }),
    st('code_scene', 'code_scene', 'scene', ['scene_plan'], CODER, { onlySceneKinds: ['code'], onFail: 'skip', timeoutSec: 1800 }),
    st('edit', 'edit', 'project', ['scene_plan', 'code_scene'], [{ type: 'builtin', tool: 'clip-musical' }], { params: { loopSeconds: 12, tracks: 2 }, timeoutSec: 3000 }),
  ],
};
fs.writeFileSync(path.join(ROUTES, `${codeRoute.id}.json`), JSON.stringify(codeRoute, null, 2));
console.log('rota criada:', codeRoute.id);

const videoFile = path.join(ROUTES, 'clipe-musical-video-ol.json');
if (fs.existsSync(videoFile)) {
  const r = JSON.parse(fs.readFileSync(videoFile, 'utf8'));
  const edit = r.steps.find((s) => s.id === 'edit');
  if (edit) edit.params = { ...(edit.params || {}), loopSeconds: 12, tracks: 2 };
  fs.writeFileSync(videoFile, JSON.stringify(r, null, 2));
  console.log('rota atualizada:', r.id, '| edit params', JSON.stringify(edit && edit.params));
}

const idea = 'Clipe musical lo-fi/16-bit de uma tarde aconchegante em Paris: café na calçada, xícara fumegante na janela, Torre Eiffel ao fundo, chuva leve, folhas, carros passando, luz dourada e um gato. 2 faixas instrumentais de 12 s.';
const musicStyle = 'lo-fi, chanson française, acordeão suave, café, vinil, instrumental, sem vocais, aconchegante';

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
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'forge-paris', version: '1' } });
  const defs = [
    { name: 'Paris Lo-fi 16-bit (Ollama + código)', routeId: 'clipe-musical-code-ol', patch: 'EXATAMENTE 1 cena "code" de 12 s; EXATAMENTE 2 faixas no MUSIC_PLAN, 12 s cada.' },
    { name: 'Paris Lo-fi 16-bit (Ollama + MiniMax H3)', routeId: 'clipe-musical-video-ol', patch: 'EXATAMENTE 1 cena "video" de 12 s; EXATAMENTE 2 faixas no MUSIC_PLAN, 12 s cada.' },
  ];
  const manifest = [];
  for (const d of defs) {
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
    p.skill.steps.script = `${p.skill.steps.script || ''} ${d.patch} Use o estilo musical do projeto; grave MUSIC_PLAN com 2 faixas e nomes temáticos de Paris.`.trim();
    p.skill.steps.scene_plan = `${p.skill.steps.scene_plan || ''} ${d.patch} Narração vazia.`.trim();
    p.musicStyle = musicStyle;
    for (const s of p.route.steps) if (s.id === 'edit') s.params = { ...(s.params || {}), loopSeconds: 12, tracks: 2 };
    fs.writeFileSync(f, JSON.stringify(p, null, 2));
    manifest.push({ id: pid, name: d.name, routeId: p.routeId });
    console.log('projeto:', pid, '|', d.name, '|', p.routeId);
  }
  child.kill();
  fs.writeFileSync(path.join(APP, 'docs', 'paris-manifest.json'), JSON.stringify(manifest, null, 2));
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
