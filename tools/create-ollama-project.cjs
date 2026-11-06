const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');

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
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'forge-ollama', version: '1' } });
  const r = await call('tools/call', {
    name: 'filmforge_create_project',
    arguments: {
      name: 'Teste Ollama Video Simples',
      idea: 'Explique em 2 cenas, com imagens reais, por que o céu é azul durante o dia e avermelhado no pôr do sol.',
      skillId: 'explicativo-codigo',
      routeId: 'forge-ollama-pexels',
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
  p.skill.steps.scene_plan = `${p.skill.steps.scene_plan || ''} Para este teste, use EXATAMENTE 2 cenas do tipo "stock", com 4 a 5 segundos cada; preencha searchTerms em inglês descrevendo a imagem que combina com a narração.`.trim();
  p.skill.steps.script = `${p.skill.steps.script || ''} Escreva um roteiro curto (até 90 palavras), em português do Brasil.`.trim();
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
  console.log('patched:', pid);
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
