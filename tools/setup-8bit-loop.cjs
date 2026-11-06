/* Paris 8-bit: rota código 8-bit + MiniMax, sem reverse, waveform sobreposta. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const ROUTES = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge/library/routes';
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');

const readRoute = (id) => JSON.parse(fs.readFileSync(path.join(ROUTES, `${id}.json`), 'utf8'));
const saveRoute = (r) => fs.writeFileSync(path.join(ROUTES, `${r.id}.json`), JSON.stringify(r, null, 2));

// rota código 8-bit (cópia da code-ol, template 8bit, forward 12s)
const codeBase = readRoute('clipe-musical-code-ol');
const code8 = JSON.parse(JSON.stringify(codeBase));
code8.id = 'clipe-musical-code-ol-8bit';
code8.name = 'Clipe musical 8-bit em loop — Ollama';
for (const s of code8.steps) if (s.id === 'edit') s.params = { loopSeconds: 12, tracks: 2, template: '8bit' };
saveRoute(code8);
console.log('rota criada:', code8.id);

// rotas antigas: sem reverse (forward 12)
const code16 = readRoute('clipe-musical-code-ol');
for (const s of code16.steps) if (s.id === 'edit') s.params = { loopSeconds: 12, tracks: 2, template: '16bit' };
saveRoute(code16);
const video = readRoute('clipe-musical-video-ol');
for (const s of video.steps) if (s.id === 'edit') s.params = { loopSeconds: 12, tracks: 2 };
saveRoute(video);
console.log('rotas atualizadas (sem reverse):', code16.id, video.id);

const idea = 'Clipe musical 8-bit de uma tarde aconchegante em Paris: café na calçada, janela, Torre Eiffel ao fundo, carros passando, chuva leve, folhas, gato e luzes quentes. Paleta 8-bit, pixels grandes, cena em loop. 2 faixas.';
const musicStyle = 'lo-fi, chanson française, acordeão suave, café, vinil, instrumental, aconchegante';

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
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'forge-8bit', version: '1' } });
  const defs = [
    {
      name: 'Paris 8-bit (Ollama + código)', routeId: 'clipe-musical-code-ol-8bit', musicMode: 'instrumental', waveform: 'bar',
      patch: 'EXATAMENTE 1 cena "code" de 12 s, 8-bit, LOOP PERFEITO (seek(0)=seek(12), sem reverse). EXATAMENTE 2 faixas de 12 s no MUSIC_PLAN; instrumental.',
      videoStyle: '8-bit pixel art, 256x144, chunky pixels, limited palette, cozy Paris cafe, loop',
    },
    {
      name: 'Paris 8-bit (Ollama + MiniMax H3)', routeId: 'clipe-musical-video-ol', musicMode: 'song', waveform: 'p2p',
      patch: 'EXATAMENTE 1 cena "video" de 12 s, 8-bit, cena desenhada para LOOP (câmera fixa, movimento cíclico sutil, começo e fim iguais, sem corte, sem reverse). EXATAMENTE 2 faixas de 12 s no MUSIC_PLAN; inclua "lyrics" curtos em cada faixa (canção).',
      videoStyle: '8-bit pixel art, 256x144, chunky pixels, limited palette, cozy Paris cafe window, Eiffel, cars, rain, cat, seamless loop',
    },
  ];
  const manifest = [];
  for (const d of defs) {
    const r = await call('tools/call', { name: 'filmforge_create_project', arguments: {
      name: d.name, idea, skillId: 'clipe-musical', routeId: d.routeId, aspect: '16:9', durationSec: 12,
      language: 'pt-BR', maxProductionMin: 40, sceneConcurrency: 1, musicStyle, musicMode: d.musicMode, waveform: d.waveform } });
    const text = r.result?.content?.[0]?.text ?? JSON.stringify(r);
    const m = text.match(/"id":\s*"([^"]+)"/);
    if (!m) { console.log('FALHOU', d.name, text); continue; }
    const pid = m[1];
    const f = path.join(PROJECTS, pid, 'project.json');
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    p.skill = p.skill || {}; p.skill.steps = p.skill.steps || {};
    p.skill.steps.script = `${p.skill.steps.script || ''} ${d.patch} Use o estilo musical do projeto; nomes temáticos de Paris.`.trim();
    p.skill.steps.scene_plan = `${p.skill.steps.scene_plan || ''} ${d.patch} Narração vazia.`.trim();
    p.skill.steps.code_scene = `${p.skill.steps.code_scene || ''} 8-bit (256x144), loop perfeito, sem reverse.`.trim();
    p.skill.steps.image = `${p.skill.steps.image || ''} 8-bit pixel art, 256x144, loop.`.trim();
    p.skill.steps.video = `${p.skill.steps.video || ''} 8-bit pixel art, loop visual contínuo, sem corte.`.trim();
    p.musicStyle = musicStyle;
    p.musicMode = d.musicMode;
    p.waveform = d.waveform;
    p.videoStyle = d.videoStyle;
    for (const s of p.route.steps) if (s.id === 'edit') s.params = { ...(s.params || {}), loopSeconds: 12, tracks: 2, ...(d.routeId.includes('code') ? { template: '8bit' } : {}) };
    fs.writeFileSync(f, JSON.stringify(p, null, 2));
    manifest.push({ id: pid, name: d.name, routeId: p.routeId, waveform: d.waveform, musicMode: d.musicMode });
    console.log('projeto:', pid, '|', d.name, '|', p.routeId);
  }
  child.kill();
  fs.writeFileSync(path.join(APP, 'docs', '8bit-manifest.json'), JSON.stringify(manifest, null, 2));
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
