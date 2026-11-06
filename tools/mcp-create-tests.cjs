/* Cria os dois projetos de verificação via MCP (o mesmo caminho da UI). */
const { spawn } = require('child_process');
const path = require('path');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');

const child = spawn(ELECTRON, ['.', '--mcp'], { cwd: APP, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
child.stderr.on('data', () => {});

let nextId = 1;
function call(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

(async () => {
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'forge-tests', version: '1.0' } });
  console.log('MCP:', init.result?.serverInfo?.name, init.result?.serverInfo?.version);

  const projects = [
    {
      name: 'Teste Codigo Antigravity',
      idea: 'Como funciona a fotossíntese? Explique em 3 cenas de código (diagramas animados vetoriais), em português do Brasil, com narração clara.',
      skillId: 'explicativo-codigo',
      routeId: 'explicativo-por-codigo-antigravity-stickman-flat',
      aspect: '16:9', durationSec: 24, language: 'pt-BR', maxProductionMin: 20, sceneConcurrency: 2,
    },
    {
      name: 'Teste Midia ComfyUI Antigravity',
      idea: 'Três invenções que mudaram o mundo: a lâmpada, o avião e a internet. Vídeo curto, visual e informativo, em português do Brasil.',
      skillId: 'misto-motion-banco-ia',
      routeId: 'forge-midia-comfyui-antigravity',
      aspect: '16:9', durationSec: 18, language: 'pt-BR', maxProductionMin: 45, sceneConcurrency: 2,
    },
  ];

  for (const args of projects) {
    const r = await call('tools/call', { name: 'filmforge_create_project', arguments: args });
    const text = r.result?.content?.[0]?.text ?? JSON.stringify(r);
    console.log('---', args.name, '\n', text);
  }
  child.kill();
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
