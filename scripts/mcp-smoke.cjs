/* Teste de fumaça do servidor MCP: sobe `FilmForge.exe --mcp` e conversa por stdio. */
const { spawn } = require('node:child_process');
const path = require('node:path');

const exe = process.argv[2] || path.join('release', 'win-unpacked', 'FilmForge.exe');
const child = spawn(exe, ['--mcp'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

const got = new Map();
let buf = '';
let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl = buf.indexOf('\n');
  while (nl >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    nl = buf.indexOf('\n');
    if (!line) continue;
    try { const msg = JSON.parse(line); if (msg.id !== undefined) got.set(msg.id, msg); } catch { console.log('linha não-JSON no stdout:', line.slice(0, 120)); }
  }
});

const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
const wait = (id, ms = 30000) => new Promise((res) => {
  const t0 = Date.now();
  const tick = () => { if (got.has(id) || Date.now() - t0 > ms) return res(got.get(id)); setTimeout(tick, 100); };
  tick();
});

(async () => {
  const t0 = Date.now();
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'smoke', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const init = await wait(1);
  console.log('initialize:', JSON.stringify(init?.result?.serverInfo), '| protocolo', init?.result?.protocolVersion, `| ${Date.now() - t0}ms`);

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = await wait(2);
  const names = (tools?.result?.tools ?? []).map((t) => t.name);
  console.log('tools/list:', names.length, 'ferramentas:', names.join(', '));

  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'filmforge_projects', arguments: {} } });
  const list = await wait(3);
  const projText = list?.result?.content?.[0]?.text ?? list?.error?.message ?? '';
  let count = '?';
  try { count = JSON.parse(projText).length; } catch { /* texto de erro */ }
  console.log('tools/call filmforge_projects:', count, 'projeto(s)');

  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'filmforge_providers', arguments: { detect: false } } });
  const prov = await wait(4);
  const provText = prov?.result?.content?.[0]?.text ?? '';
  let ids = [];
  try { ids = Object.keys(JSON.parse(provText)); } catch { /* erro */ }
  console.log('tools/call filmforge_providers:', ids.join(', '));

  send({ jsonrpc: '2.0', id: 5, method: 'resources/list' });
  const res = await wait(5);
  console.log('resources/list:', (res?.result?.resources ?? []).length, 'recursos');

  send({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'filmforge://library/skills' } });
  const rres = await wait(6);
  const skillsText = rres?.result?.contents?.[0]?.text ?? '';
  let sk = 0; try { sk = JSON.parse(skillsText).length; } catch { /* erro */ }
  console.log('resources/read skills:', sk, 'skill(s)');

  send({ jsonrpc: '2.0', id: 7, method: 'metodo/inexistente' });
  const bad = await wait(7);
  console.log('método inexistente → erro', bad?.error?.code);

  console.log('stderr do servidor:', stderr.trim().split('\n').slice(0, 3).join(' | ') || '(vazio)');
  try { child.kill(); } catch { /* já saiu */ }
  process.exit(0);
})();
