import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as prov from '../main/providers';
import { voicePreview } from '../main/voice-preview';
import { createExecutors } from '../main/executors';
import { codeCues, sceneCues, sfxDef } from '../main/sfx';
import { moodFor, renderCodeMusic, synthExpr } from '../main/codemusic';
import { deriveProject } from '../main/derive';
import { cacheKey } from '../main/engine';
import { exportPluginFile, installPluginFile, installPluginFolder, listPlugins, parseGithubUrl, pluginPrompt, removePlugin } from '../main/plugins';
import { auditRoute, auditSkill } from '../main/audit';
import { createProject, defaultSettings, projectDirOf } from '../main/settings';
import * as ff from '../main/ffmpeg';
import type { Project, Route, Settings, Skill } from '../shared/types';

/** Gemini TTS, prévia de voz, sons declarados pelas cenas, trilha programática, variação de projeto e plugins de estilos. */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-res-'));
  const s = defaultSettings(ws);
  s.ffmpeg = 'ffmpeg'; s.ffprobe = 'ffprobe';
  let hasFfmpeg = true;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

  /* ── Gemini TTS e OpenAI TTS (servidor falso) + prévia de voz no idioma ── */
  const seen: Array<{ url: string; body: string }> = [];
  const pcm = Buffer.alloc(24000 * 2);                       // 1 s de silêncio L16 24 kHz
  for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), i * 2);
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
      seen.push({ url: req.url ?? '', body });
      if ((req.url ?? '').includes(':generateContent')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return void res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }));
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.from('ID3fake-mp3'));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    s.providers = [
      { id: 'gemini', kind: 'gemini', baseUrl: base, apiKey: 'k', models: prov.GEMINI_TTS_MODELS, categories: ['voice'], voices: prov.GEMINI_TTS_VOICES },
      { id: 'openai', kind: 'openai', baseUrl: base, apiKey: 'k', models: ['gpt-4o-mini-tts'], categories: ['voice'], voices: ['alloy'] },
    ] as typeof s.providers;
    const wav = await prov.geminiTts(s.providers[0]!, 'gemini-2.5-flash-preview-tts', 'Charon', 'Olá', path.join(ws, 'g', 'narration.mp3'), new AbortController().signal, 'Narre com calma');
    assert.ok(wav.endsWith('narration.wav'), 'Gemini grava WAV');
    const head = fs.readFileSync(wav);
    assert.equal(head.toString('ascii', 0, 4), 'RIFF'); assert.equal(head.readUInt32LE(24), 24000, 'taxa do PCM');
    const sent = JSON.parse(seen.at(-1)!.body);
    assert.equal(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Charon');
    assert.match(sent.contents[0].parts[0].text, /^Narre com calma\n\nOlá/);
    assert.ok(prov.GEMINI_TTS_VOICES.length >= 30);

    const ex = createExecutors({ workflowsDir: path.resolve(__dirname, '../../workflows') });
    const f1 = await voicePreview(s, ex, { binding: { type: 'api', provider: 'gemini', model: 'gemini-2.5-flash-preview-tts', voice: 'Kore' }, language: 'en-US' });
    assert.ok(fs.existsSync(f1) && /\.wav$/.test(f1), 'prévia Gemini');
    assert.match(JSON.parse(seen.at(-1)!.body).contents[0].parts.map((x: { text: string }) => x.text).join(''), /This is the voice/, 'frase no idioma pedido (en-US)');
    const n = seen.length;
    assert.equal(await voicePreview(s, ex, { binding: { type: 'api', provider: 'gemini', model: 'gemini-2.5-flash-preview-tts', voice: 'Kore' }, language: 'en-US' }), f1, 'prévia em cache');
    assert.equal(seen.length, n, 'cache não chama a API de novo');
    const f2 = await voicePreview(s, ex, { binding: { type: 'api', provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'alloy' }, language: 'pt-BR' });
    assert.ok(fs.existsSync(f2)); assert.match(JSON.parse(seen.at(-1)!.body).input, /^Olá! Esta é a voz/);
  } finally { server.close(); }

  /* ── Fish Audio: /v1/tts (header `model`, reference_id) e vozes da conta ── */
  const fishSeen: Array<{ url: string; method: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  const VOICE_ID = '9a9cf47702da476aa4629e2506d4a857';
  const fish = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
      fishSeen.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers, body });
      if ((req.url ?? '').startsWith('/model')) {
        const q = new URL(req.url ?? '/model', 'http://x').searchParams;
        /* conta (self=true), biblioteca no idioma pedido e biblioteca popular: ids diferentes */
        const items = q.get('self') === 'true'
          ? [{ _id: VOICE_ID, title: 'Narrador PT-BR', type: 'tts', state: 'trained', visibility: 'private' }]
          : q.get('language')
            ? [{ _id: 'b7e1c0d2f3a4456789abcdef01234567', title: 'Voz calma', type: 'tts', state: 'trained', visibility: 'public' }]
            : [{ _id: 'c8f2d1e3a4b5467890abcdef01234567', title: 'Popular EN', type: 'tts', state: 'trained', visibility: 'public' }];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return void res.end(JSON.stringify({ total: items.length, items }));
      }
      if ((req.url ?? '') === '/v1/tts') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return void res.end(Buffer.from('ID3fish-mp3')); }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"not found"}');
    });
  });
  await new Promise<void>((r) => fish.listen(0, '127.0.0.1', r));
  const fishBase = `http://127.0.0.1:${(fish.address() as { port: number }).port}`;
  try {
    const fp: Settings['providers'][number] = {
      id: 'fish', kind: 'fish', baseUrl: fishBase, apiKey: 'fk',
      models: [...prov.FISH_MODELS], modelCategories: Object.fromEntries(prov.FISH_MODELS.map((m) => [m, 'voice' as const])), categories: ['voice'], voices: [],
    };
    const outFish = path.join(ws, 'fish', 'narration.mp3');
    assert.equal(await prov.tts(fp, 's2.1-pro-free', `https://fish.audio/m/${VOICE_ID}`, 'Olá, mundo', outFish, new AbortController().signal), outFish);
    assert.equal(fs.readFileSync(outFish).toString(), 'ID3fish-mp3');
    const call = fishSeen.at(-1)!;
    assert.equal(call.headers.model, 's2.1-pro-free', 'modelo do Fish vai no header');
    assert.equal(call.headers.authorization, 'Bearer fk');
    const sent = JSON.parse(call.body);
    assert.equal(sent.reference_id, VOICE_ID, 'link fish.audio/m/<id> vira reference_id');
    assert.equal(sent.format, 'mp3'); assert.equal(sent.text, 'Olá, mundo');
    assert.equal(prov.fishVoiceId('sem-id'), 'sem-id');

    await prov.tts({ ...fp, baseUrl: `${fishBase}/v1` }, 'drama-3', '', 'Fala baixo', outFish, new AbortController().signal, 'voz sussurrada');
    const drama = fishSeen.at(-1)!;
    assert.equal(drama.url, '/v1/tts', 'baseUrl com /v1 não duplica');
    assert.match(JSON.parse(drama.body).text, /^\[voz sussurrada\] Fala baixo/, 'drama-3 aceita direção no texto');
    assert.equal(JSON.parse(drama.body).reference_id, undefined, 'sem voz → sem reference_id (voz padrão da conta)');

    const t = await prov.testProvider(fp, { language: 'pt-BR' });
    assert.equal(t.ok, true);
    assert.equal(t.voices?.length, 3, 'conta + biblioteca no idioma + populares');
    assert.equal(t.voiceLabels?.[VOICE_ID], 'Narrador PT-BR', 'título da voz vem junto');
    assert.equal(t.voiceLabels?.['b7e1c0d2f3a4456789abcdef01234567'], 'Voz calma', 'título da biblioteca');
    assert.equal(t.modelCategories?.['s2.1-pro-free'], 'voice', 'modelos do Fish são de voz');
    assert.match(t.message, /1 da sua conta \+ 2 da biblioteca/, 'mensagem separa conta e biblioteca');
    assert.ok(fishSeen.some((c) => /self=true/.test(c.url)), 'lista as vozes da conta');
    assert.ok(fishSeen.some((c) => /language=pt/i.test(c.url)), 'biblioteca filtrada pelo idioma');
    assert.ok(fishSeen.some((c) => /licensed=true/.test(c.url)), 'biblioteca só com vozes licenciadas');
    assert.equal((await prov.testProvider({ ...fp, apiKey: '' })).ok, false, 'sem chave não passa');
  } finally { fish.close(); }

  /* ── sons declarados pela cena por código (window.__forge.sfx → clips/code.sfx.json) ── */
  assert.equal(sfxDef('swish')?.id, 'swoosh'); assert.equal(sfxDef('shimmer_hit')?.id, 'sparkle'); assert.equal(sfxDef('IMPACT')?.id, 'impact');
  const sd = path.join(ws, 'scene'); fs.mkdirSync(path.join(sd, 'clips'), { recursive: true });
  fs.writeFileSync(path.join(sd, 'clips', 'code.sfx.json'), JSON.stringify([{ t: 0.4, name: 'pop' }, { t: 2.1, name: 'hit' }, { t: 3, name: 'nao-existe' }]));
  assert.deepEqual(codeCues(sd).map((c) => `${c.name}@${c.at}`), ['pop@0.4', 'impact@2.1']);
  assert.deepEqual(sceneCues({ sfx: ['pop@0.45', 'ding:dente'] }, sd).map((c) => c.name), ['pop', 'impact', 'ding'], 'sem duplicar o pop do código');

  /* ── trilha programática ── */
  const p0 = { videoType: 'stickman', skill: undefined, musicStyle: undefined } as unknown as Project;
  assert.equal(moodFor(p0), 'explainer');
  assert.equal(moodFor({ ...p0, musicStyle: 'tenso, mistério' } as Project), 'darksynth');
  assert.equal(moodFor(p0, { mood: 'lofi' }), 'lofi');
  assert.match(synthExpr({ bpm: 120, chords: [[1, 2, 3], [4, 5, 6]], kick: true, hat: false, arp: false }), /if\(eq\(ld\(0\),0\),1\.00,4\.00\)/, 'acordes por compasso');
  if (hasFfmpeg) {
    const r = await renderCodeMusic(s, { mood: 'darksynth', duration: 12, out: path.join(ws, 'out', 'music.mp3'), engine: 'interno', log: () => {} });
    assert.equal(r.engine, 'interno');
    assert.ok(Math.abs(await ff.duration('ffprobe', r.file) - 12) < 0.2, 'duração exata do vídeo');
  }

  /* ── variação de projeto: troca skill/rota/formato; reaproveita o roteiro ── */
  const src = createProject(s, { name: 'Origem', idea: 'dentes', videoType: 'slideshow', skillId: 'slideshow', routeId: 'slideshow-sfx', aspect: '16:9', targetDurationSec: 240, plugins: ['x'] });
  fs.writeFileSync(path.join(projectDirOf(s, src.id), 'script.md'), '# Roteiro pronto');
  const v = deriveProject(s, src.id, { skillId: 'stickman', routeId: 'stickman-explainer', aspect: '9:16', keep: 'script' });
  assert.equal(v.videoType, 'stickman'); assert.equal(v.route?.id, 'stickman-explainer'); assert.equal(v.aspect, '9:16');
  assert.equal(v.idea, 'dentes'); assert.deepEqual(v.plugins, ['x']); assert.equal(v.derivedFrom?.id, src.id);
  const vd = projectDirOf(s, v.id);
  assert.equal(fs.readFileSync(path.join(vd, 'script.md'), 'utf8'), '# Roteiro pronto');
  const cache = JSON.parse(fs.readFileSync(path.join(vd, 'cache', 'index.json'), 'utf8')) as Record<string, string[]>;
  const st = v.route!.steps.find((x) => x.kind === 'script')!;
  assert.deepEqual(cache[cacheKey(v, st, st.bindings[0]!)], [path.join(vd, 'script.md')], 'roteiro marcado como pronto (não é reescrito)');
  assert.ok(v.route!.steps.some((x) => x.kind === 'sfx') && v.route!.steps.find((x) => x.kind === 'music')!.bindings[0]!.type === 'builtin', 'stickman: efeitos e trilha programáticos');

  /* ── coleção de prompts de estilo vira plugin Claude com galeria ── */
  const repo = path.join(ws, 'mg-styles-demo');
  fs.mkdirSync(path.join(repo, 'prompts'), { recursive: true }); fs.mkdirSync(path.join(repo, 'videos'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'lib', 'audio', 'mgaudio', 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'lib', 'audio', 'mgaudio', '__init__.py'), '');
  fs.writeFileSync(path.join(repo, 'lib', 'audio', 'mgaudio', 'recipes', '__init__.py'), "STYLES = {\n    '01-flat': ('pop', {}, 'future_bass', 'pop swish'),\n    '22-hud': ('darksynth', {}, 'techno', 'hud_beep lock_on'),\n}\n");
  for (const [id, title, film] of [['01-flat', '扁平矢量动画 Flat / Vector 2D', 'popwise「One Dot」'], ['22-hud', '赛博朋克 HUD / FUI Cyberpunk HUD', '隼眼-9 · 目标锁定 KESTREL-9 TARGET']]) {
    fs.writeFileSync(path.join(repo, 'prompts', `${id}.md`), `# ${title}\n\n**原片**：${film} · 1920×1080 · 30 fps\n\n## 提示词\n\n\`\`\`text\nYou are the director of ONE film.\n# Style\n${title}\n# Signature features\nbold shapes\n\`\`\`\n`);
    fs.writeFileSync(path.join(repo, 'videos', `${id}.jpg`), 'jpg'); fs.writeFileSync(path.join(repo, 'videos', `${id}.mp4`), 'heavy video');
  }
  installPluginFolder(s, repo, 'https://github.com/dono/mg-styles-demo');
  const pl = listPlugins(s).find((x) => x.id === 'mg-styles-demo')!;
  assert.ok(pl && pl.adapted, 'convertido para o formato Claude');
  assert.ok(fs.existsSync(path.join(pl.dir, '.claude-plugin', 'plugin.json')));
  assert.deepEqual(pl.skills?.sort(), ['01-flat', '22-hud']);
  assert.deepEqual(pl.styles?.map((x) => [x.name, x.film, x.music]), [['Flat / Vector 2D', 'popwise One Dot', 'pop'], ['HUD / FUI Cyberpunk HUD', 'KESTREL-9 TARGET', 'darksynth']]);
  assert.ok(pl.styles?.[0]?.cover && fs.existsSync(pl.styles[0].cover), 'capa');
  assert.ok(!fs.existsSync(path.join(pl.dir, 'videos', '01-flat.mp4')), 'vídeos pesados ficam fora da instalação');
  assert.ok(pl.resources?.some((r) => r.id === 'mgaudio' && r.ready));
  const none = pluginPrompt(s, [pl.id]);
  assert.match(none, /Estilos disponíveis \(nenhum escolhido\)/); assert.doesNotMatch(none, /You are the director/, 'sem estilo: não injeta os 15 prompts');
  const one = pluginPrompt(s, [pl.id], { [pl.id]: '22-hud' });
  assert.match(one, /ESTILO ESCOLHIDO NO PROJETO: HUD/); assert.match(one, /ADAPTAÇÃO FILMFORGE/); assert.match(one, /You are the director/);
  assert.doesNotMatch(one, /Flat \/ Vector 2D\n/, 'só o estilo escolhido');
  /* reinstalar = atualizar (não falha nem apaga), URL com subpasta, descrições para a interface */
  installPluginFolder(s, repo, 'https://github.com/dono/mg-styles-demo');
  assert.deepEqual(parseGithubUrl('https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design'), { owner: 'anthropics', repo: 'claude-code', branch: 'main', subpath: 'plugins/frontend-design' });
  assert.deepEqual(parseGithubUrl('dono/repo'), { owner: 'dono', repo: 'repo', branch: undefined, subpath: undefined });
  assert.equal(parseGithubUrl('https://github.com/a/b/tree/main/../../x')?.subpath, 'x', 'sem sair do repositório');
  const cp = path.join(ws, 'claude-plugin'); fs.mkdirSync(path.join(cp, '.claude-plugin'), { recursive: true }); fs.mkdirSync(path.join(cp, 'skills', 'design'), { recursive: true });
  fs.writeFileSync(path.join(cp, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'design-kit', version: '1.2.0' }));
  fs.writeFileSync(path.join(cp, 'skills', 'design', 'SKILL.md'), '---\nname: design\ndescription: "Direção de arte marcante"\n---\nUse cores fortes.');
  const dk = installPluginFolder(s, cp);
  assert.deepEqual(dk.items, [{ kind: 'skill', name: 'design', description: 'Direção de arte marcante' }]);
  /* arquivo .plugin (zip no formato do Claude): exporta, remove e reinstala */
  const pf = exportPluginFile(s, dk.id, path.join(ws, 'out', 'design-kit.plugin'));
  assert.ok(fs.statSync(pf).size > 100 && fs.readFileSync(pf).subarray(0, 2).toString() === 'PK', 'zip');
  removePlugin(s, dk.id);
  const back = installPluginFile(s, pf);
  assert.equal(back.id, dk.id); assert.deepEqual(back.items, dk.items);

  /* estrutura Claude: skill = pasta com SKILL.md; references/templates/lib são apoio (não viram skills) */
  const an = path.join(ws, 'anim-plugin'); const sk2 = path.join(an, 'skills', 'anim');
  for (const d of ['.claude-plugin', 'references', 'templates', 'lib/rigs']) fs.mkdirSync(path.join(d === '.claude-plugin' ? an : sk2, d), { recursive: true });
  fs.writeFileSync(path.join(an, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'anim', displayName: 'Anim', author: { name: 'Hanif' }, keywords: ['animation'], license: 'MIT' }));
  fs.writeFileSync(path.join(sk2, 'SKILL.md'), '---\nname: anim\ndescription: Hand-drawn animation in JS\n---\n# anim\nRead references/motion.md. ' + 'x'.repeat(6000));
  fs.writeFileSync(path.join(sk2, 'references', 'motion.md'), '# Motion\ntiming');
  fs.writeFileSync(path.join(sk2, 'templates', 'beat-sheet.md'), '# Beats');
  fs.writeFileSync(path.join(sk2, 'lib', 'core.mjs'), 'import { createCanvas } from "@napi-rs/canvas";\nexport const k = 1;');
  fs.writeFileSync(path.join(sk2, 'lib', 'rigs', 'ant.mjs'), 'export function ant() {}');
  fs.writeFileSync(path.join(sk2, 'package.json'), JSON.stringify({ dependencies: { '@napi-rs/canvas': '^0.1' } }));
  const ai = installPluginFolder(s, an);
  assert.deepEqual(ai.skills, ['anim'], 'só a pasta com SKILL.md é skill');
  assert.equal(ai.displayName, 'Anim'); assert.equal(ai.author, 'Hanif'); assert.deepEqual(ai.requires, ['npm @napi-rs/canvas']);
  assert.ok(ai.items?.[0]?.files?.includes('references/motion.md') && ai.items[0].files.includes('lib/rigs/ant.mjs'), 'arquivos de apoio listados');
  const pd2 = path.join(ws, 'projects', 'p-anim'); const sd2 = path.join(pd2, 'scenes', 's01');
  const pp = pluginPrompt(s, [ai.id], {}, { projectDir: pd2, stepKind: 'code_scene', sceneDir: sd2 });
  assert.ok(fs.existsSync(path.join(pd2, 'plugins', ai.id, 'anim', 'references', 'motion.md')), 'skill copiada para dentro do projeto');
  assert.ok(fs.existsSync(path.join(pd2, 'plugins', '_shim', 'napi-canvas.mjs')), 'adaptador do @napi-rs/canvas');
  assert.match(pp, /importmap/); assert.ok(pp.includes(`../../../plugins/${ai.id}/anim/lib/`), 'caminho da biblioteca relativo à cena');
  assert.ok(pp.includes('x'.repeat(5000)), 'SKILL.md inteiro (sem cortar em 3500)');

  /* imagens: capa do plugin e uma imagem por skill */
  assert.ok(dk.cover && /cover\.svg$/.test(dk.cover) && fs.readFileSync(dk.cover, 'utf8').includes('<svg'), 'sem imagens: capa gerada');
  const mp = path.join(ws, 'multi-plugin');
  fs.mkdirSync(path.join(mp, '.claude-plugin'), { recursive: true }); fs.writeFileSync(path.join(mp, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'multi' }));
  for (const n of ['alpha', 'beta', 'gamma']) { fs.mkdirSync(path.join(mp, 'skills', n), { recursive: true }); fs.writeFileSync(path.join(mp, 'skills', n, 'SKILL.md'), `---\nname: ${n}\ndescription: skill ${n}\n---\nx`); }
  fs.mkdirSync(path.join(mp, 'skills', 'gamma', 'assets')); fs.writeFileSync(path.join(mp, 'skills', 'gamma', 'assets', 'preview.png'), 'png');
  fs.mkdirSync(path.join(mp, '_gallery')); for (const g of ['1-overview.png', '2-beta-demo.png']) fs.writeFileSync(path.join(mp, '_gallery', g), 'png');
  const mi = installPluginFolder(s, mp);
  const img = (n: string) => path.basename(mi.items!.find((x) => x.name === n)!.image ?? '');
  assert.equal(img('beta'), '2-beta-demo.png', 'imagem da galeria com o nome da skill');
  assert.equal(img('gamma'), 'preview.png', 'imagem da própria pasta da skill');
  assert.equal(img('alpha'), '1-overview.png'); assert.equal(path.basename(mi.cover!), '1-overview.png', 'capa = primeira imagem da galeria');

  /* auditoria: montagem que não espera mídia e skill que pede o que a rota não faz */
  const bad = { id: 'x', name: 'x', description: '', videoTypes: [], steps: [
    { id: 'narration', kind: 'narration', label: '', scope: 'scene', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 60, bindings: [{ type: 'comfyui', server: 'local', workflow: 'nao-existe.json' }] },
    { id: 'image', kind: 'image', label: '', scope: 'scene', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 60, bindings: [{ type: 'flow', account: 'g9' }] },
    { id: 'music', kind: 'music', label: '', scope: 'project', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 60, bindings: [{ type: 'builtin', tool: 'library-music' }] },
    { id: 'edit', kind: 'edit', label: '', scope: 'project', dependsOn: ['narration'], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 60, bindings: [{ type: 'builtin', tool: 'assemble' }] },
  ] } as Route;
  const msgs = auditRoute(s, bad, path.resolve(__dirname, '../../workflows')).map((x) => x.msg).join(' | ');
  assert.match(msgs, /nao-existe\.json não existe/); assert.match(msgs, /conta Google "g9"/); assert.match(msgs, /não espera image, music/);
  const sk = { id: 'k', name: 'k', builtin: false, global: 'Slideshow sem música com imagens do Google Flow.', steps: { code_scene: 'x' }, routeId: 'x', appearance: 'slideshow' } as unknown as Skill;
  const sm = auditSkill(sk, bad).map((x) => x.msg).join(' | ');
  assert.match(sm, /SEM música/); assert.match(sm, /etapa "code_scene", que a rota/);
  console.log('resources tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
