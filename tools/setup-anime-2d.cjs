/* Dois projetos anime 2D com Ollama: um código (template anime) e um MiniMax H3. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const ROUTES = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge/library/routes';
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');

const readRoute = (id) => JSON.parse(fs.readFileSync(path.join(ROUTES, `${id}.json`), 'utf8'));
const saveRoute = (r) => fs.writeFileSync(path.join(ROUTES, `${r.id}.json`), JSON.stringify(r, null, 2));

// ── rota código anime (template anime; sem etapa de código, para não gastar 3 min) ──
const codeBase = readRoute('clipe-musical-code-ol-8bit');
const codeAnime = JSON.parse(JSON.stringify(codeBase));
codeAnime.id = 'clipe-musical-code-ol-anime';
codeAnime.name = 'Clipe musical anime 2D em loop — Ollama';
codeAnime.description = 'Duas faixas, visual anime 2D (template), loop forward, waveform sobreposta.';
codeAnime.steps = codeAnime.steps.filter((s) => s.id !== 'code_scene');
for (const s of codeAnime.steps) if (s.id === 'edit') {
  s.dependsOn = ['scene_plan'];
  s.params = { loopSeconds: 12, tracks: 2, template: 'anime', forceTemplate: true };
}
saveRoute(codeAnime);
console.log('rota criada:', codeAnime.id);

// garante a rota de vídeo com loop forward
const videoRoute = readRoute('clipe-musical-video-ol');
for (const s of videoRoute.steps) if (s.id === 'edit') s.params = { loopSeconds: 12, tracks: 2 };
saveRoute(videoRoute);
console.log('rota vídeo:', videoRoute.id);

const idea = 'Clipe musical anime 2D: uma estudante de fones olhando a cidade pela janela do trem ao pôr do sol; sakura, prédios, trens passando, chuva leve e luz quente. Visual em loop, 2 faixas.';
const musicStyle = 'lo-fi anime, city pop suave, piano, sakura, nostálgico, aconchegante';
const videoStyle = 'anime 2D, cel shading, linha limpa, cores saturadas, fundo pintado, estudante de fones na janela do trem, cidade japonesa ao pôr do sol, sakura, chuva leve, sem texto, cena em loop';
const patch = 'EXATAMENTE 1 cena de 12 s. Anime 2D (cel shading, linha limpa, cidade japonesa, sakura, janela de trem), loop-friendly (câmera fixa, movimento cíclico sutil), sem reverse. EXATAMENTE 2 faixas de 12 s no MUSIC_PLAN.';

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
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'forge-anime', version: '1' } });
  const defs = [
    {
      name: 'Anime 2D (Ollama + código)', routeId: 'clipe-musical-code-ol-anime', musicMode: 'instrumental', waveform: 'cline',
      extra: ' Se musicMode=song, inclua lyrics; aqui é instrumental.',
    },
    {
      name: 'Anime 2D (Ollama + MiniMax H3)', routeId: 'clipe-musical-video-ol', musicMode: 'song', waveform: 'p2p',
      extra: ' Se musicMode=song, inclua lyrics curtos e cantáveis (verso/refrão) em cada faixa.',
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
    p.skill.steps.script = `${p.skill.steps.script || ''} ${patch}${d.extra} Use o estilo musical do projeto; nomes temáticos de anime/cidade.`.trim();
    p.skill.steps.scene_plan = `${p.skill.steps.scene_plan || ''} ${patch} Narração vazia.`.trim();
    p.skill.steps.code_scene = `${p.skill.steps.code_scene || ''} Anime 2D (template), loop 12 s, sem reverse.`.trim();
    p.skill.steps.image = `${p.skill.steps.image || ''} Anime 2D key visual: estudante de fones na janela do trem, cidade japonesa ao pôr do sol, sakura, cel shading, sem texto.`.trim();
    p.skill.steps.video = `${p.skill.steps.video || ''} Anime 2D, câmera fixa, movimento cíclico sutil, começo e fim parecidos; sem corte seco, sem reverse.`.trim();
    p.musicStyle = musicStyle;
    p.musicMode = d.musicMode;
    p.waveform = d.waveform;
    p.videoStyle = videoStyle;
    for (const s of p.route.steps) if (s.id === 'edit') {
      s.params = { ...(s.params || {}), loopSeconds: 12, tracks: 2, ...(d.routeId.includes('code') ? { template: 'anime', forceTemplate: true } : {}) };
      if (d.routeId.includes('code')) s.dependsOn = ['scene_plan'];
    }
    fs.writeFileSync(f, JSON.stringify(p, null, 2));
    manifest.push({ id: pid, name: d.name, routeId: p.routeId, waveform: d.waveform, musicMode: d.musicMode });
    console.log('projeto:', pid, '|', d.name, '|', p.routeId);
  }
  child.kill();
  fs.writeFileSync(path.join(APP, 'docs', 'anime-manifest.json'), JSON.stringify(manifest, null, 2));
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
