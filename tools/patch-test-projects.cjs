/* 1) reproduz o bug "skill pede cenas + rota de vídeo livre" e confirma que a rota é corrigida;
   2) ajusta as skills dos testes para kinds determinísticos. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
child.stderr.on('data', () => {});
let nextId = 1;
const call = (method, params) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

function patchScenePlan(id, extra) {
  const file = path.join(PROJECTS, id, 'project.json');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  p.skill = p.skill || {};
  p.skill.steps = p.skill.steps || {};
  p.skill.steps.scene_plan = `${p.skill.steps.scene_plan || ''} ${extra}`.trim();
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
  console.log('skill ajustada:', id, '| cenas:', p.skill.steps.scene_plan.slice(-160));
}

(async () => {
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'forge-tests', version: '1.0' } });

  // bug: skill de cenas + rota "vídeo livre" (sem scene_plan) => deve trocar a rota
  const r = await call('tools/call', {
    name: 'filmforge_create_project',
    arguments: {
      name: 'Teste Bug Rota Livre (corrigido)',
      idea: 'Teste: a skill pede cenas e a rota escolhida era de vídeo livre.',
      skillId: 'explicativo-codigo',
      routeId: 'video-livre-antigravity-prompt-harness-copia',
      aspect: '16:9', durationSec: 12, language: 'pt-BR',
    },
  });
  console.log('BUG-REPRO:', r.result?.content?.[0]?.text ?? JSON.stringify(r));
  child.kill();

  patchScenePlan('teste-codigo-antigravity-a5d2e5',
    'Para este teste, use EXATAMENTE 3 cenas do tipo "code", com 6 a 8 segundos cada; cada cena deve ser um diagrama animado diferente (folha, cloroplasto, ciclo da fotossíntese).');
  patchScenePlan('teste-midia-comfyui-antigravity-51de7b',
    'Para este teste, use EXATAMENTE 3 cenas: s01 tipo "code" (diagrama animado), s02 tipo "mixed" (com searchTerms em inglês) e s03 tipo "video" (vídeo gerado por IA). Duração de 5 a 6 s cada.');
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
