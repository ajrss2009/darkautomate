import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createProject, defaultSettings } from '../main/settings';
import * as lib from '../main/library';
import { buildCatalog } from '../main/catalog';
import { buildPrompt, ensureForgeContract, ensureThreeImport, extractHtmlPage, fixArrowBodies, fixLibCalls, freeThreeSkeleton, freeHtmlPrompt, freeHtmlProblem, freeLibMissing, freeLibProblem, ensureImportMap, freeSkeleton, thumbnailPrompt } from '../main/prompts';
import { freeLibImport, libSignatures, pluginExample, pluginPrompt, stageThree } from '../main/plugins';
import { estimateWords, wordsDigest, transcribe } from '../main/whisper';
import { fetchForScene, searchStock, testSource } from '../main/stock';
import * as prov from '../main/providers';
import { resolveHarness, runHarness, ollamaModels, detectHarnessAsync, detectHarness, commandExists, fitContext, ollamaCtx, ollamaPredict, toolCallKey, dshModelArgs, repetitionLoop } from '../main/harness';import { recordRun, ensureFirstFrame, fmtDuration } from '../main/production';
import * as ops from '../main/ops';
import { createExecutors, tolerantSeek } from '../main/executors';
import { runRoute } from '../main/engine';
import type { ExecContext } from '../main/engine';
import type { EngineEvent, Route, Settings } from '../shared/types';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-lib-'));
  const s: Settings = defaultSettings(ws);

  // ───────── rotas: CRUD + validação
  const builtin = lib.listRoutes(s);
  assert.ok(builtin.some((r) => r.id === 'explainer-mixed'), 'rota mista padrão existe');
  const base = JSON.parse(JSON.stringify(builtin.find((r) => r.id === 'stickman-explainer')!)) as Route;
  const mine: Route = { ...(JSON.parse(JSON.stringify(base)) as Route), id: '', name: 'Minha rota explicativa', description: 'teste' };
  delete (mine as { builtin?: boolean }).builtin;
  mine.steps = mine.steps.filter((st) => st.id !== 'motion');                 // remove tarefa
  for (const st of mine.steps) st.dependsOn = st.dependsOn.filter((d) => d !== 'motion');
  assert.throws(() => lib.saveRoute(s, { ...base, id: 'x', name: 'x', steps: base.steps.filter((st) => st.id !== 'motion') }), /depende/);
  mine.steps.push({ id: 'extra-img', kind: 'image', label: 'Imagem extra', scope: 'scene', dependsOn: ['scene_plan'], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 60,
    bindings: [{ type: 'comfyui', server: 'local', workflow: 'krea2-turbo-t2i.json' }, { type: 'wan2gp', template: 'wan2gp-image.json' }, { type: 'harness', harness: 'auto', model: 'auto' }] });
  const saved = lib.saveRoute(s, mine);
  assert.equal(saved.id, 'minha-rota-explicativa');
  assert.ok(lib.getAnyRoute(s, saved.id)!.steps.some((x) => x.id === 'extra-img'));
  /* salvar com id de rota padrão = personalização permanente (vale no lugar da padrão); excluir restaura */
  lib.saveRoute(s, { ...saved, id: 'stickman-explainer' });
  assert.ok(lib.getAnyRoute(s, 'stickman-explainer')!.steps.some((x) => x.id === 'extra-img'), 'padrão personalizada');
  lib.deleteRoute(s, 'stickman-explainer');
  assert.ok(!lib.getAnyRoute(s, 'stickman-explainer')!.steps.some((x) => x.id === 'extra-img'), 'restaurada');
  assert.throws(() => lib.deleteRoute(s, 'shorts-autopilot'), /padrão/);
  assert.match(lib.validateRoute({ ...saved, steps: [...saved.steps, { ...saved.steps[0]! }] }).join(';'), /duplicado/);
  const cyc = JSON.parse(JSON.stringify(saved)) as Route; cyc.steps[0]!.dependsOn = ['edit'];
  assert.match(lib.validateRoute(cyc).join(';'), /Ciclo/);
  const nob = JSON.parse(JSON.stringify(saved)) as Route; nob.steps[1]!.bindings = [];
  assert.match(lib.validateRoute(nob).join(';'), /sem executor/);
  assert.throws(() => lib.saveRoute(s, { ...saved, name: 'x', id: '../hack' }), /id inválido/);
  lib.deleteRoute(s, saved.id);
  assert.ok(!lib.getAnyRoute(s, saved.id));

  // ───────── skills + tipos + projeto com prompt composto
  const sk = lib.saveSkill(s, { id: '', name: 'Minha skill', description: 'd', global: 'Use paleta quente.', steps: { code_scene: 'Anime ícones sincronizados.', script: 'Frases curtas.' } });

  // skills vivem em Markdown (legível/editável) e podem ser exportadas/importadas
  const mdFile = path.join(ws, 'library', 'skills', `${sk.id}.md`);
  assert.ok(fs.existsSync(mdFile), 'skill salva em Markdown');
  const md = fs.readFileSync(mdFile, 'utf8');
  assert.match(md, /^---\nname: Minha skill/m);
  assert.match(md, /## Etapa: code_scene/);
  assert.ok(!fs.existsSync(path.join(ws, 'library', 'skills', `${sk.id}.json`)), 'sem JSON antigo');
  const expSkill = path.join(ws, 'exp', 'minha-skill.md');
  lib.exportSkillFile(s, sk.id, expSkill);
  const impSkill = lib.importSkillFile(s, expSkill);
  assert.notEqual(impSkill.id, sk.id, 'importar não sobrescreve a existente');
  assert.equal(impSkill.global, 'Use paleta quente.');
  assert.equal(impSkill.steps['code_scene'], 'Anime ícones sincronizados.');
  // rotas: exportar/importar em JSON
  const expRoute = path.join(ws, 'exp', 'rota.json');
  lib.exportRouteFile(s, 'shorts-autopilot', expRoute);
  const impRoute = lib.importRouteFile(s, expRoute);
  assert.notEqual(impRoute.id, 'shorts-autopilot', 'importar cria uma cópia sua');
  assert.ok(impRoute.steps.length > 0);
  assert.equal(lib.exportLibrary(s, 'skills', path.join(ws, 'exp', 'all')).length, 2);   // a original + a importada
  const ty = lib.saveType(s, { id: '', name: 'Explicativo paper cut quente', routeId: 'explainer-mixed', skillId: sk.id, appearance: 'paper_cut', presentation: 'mixed', mediaSources: ['wikipedia'], aspect: '16:9', durationSec: 90, language: 'en-US' });
  assert.throws(() => lib.saveType(s, { ...ty, id: 'novo', name: 'x', skillId: 'nao-existe' }), /skill/);
  assert.equal(lib.listTypes(s).length, 4 + 1);
  const p = createProject(s, { name: 'Como funciona o GPS', idea: 'Explique como o GPS funciona', videoType: 'custom', typeId: ty.id });
  assert.equal(p.videoType, 'paper_cut'); assert.equal(p.language, 'en-US'); assert.equal(p.presentation, 'mixed');
  assert.deepEqual(p.mediaSources, ['wikipedia']); assert.equal(p.skill!.global, 'Use paleta quente.'); assert.equal(p.routeId, 'explainer-mixed');
  assert.ok(p.route!.steps.some((x) => x.kind === 'stock_media') && p.route!.steps.some((x) => x.kind === 'transcribe'));
  const dir = path.join(ws, 'projects', p.id);
  const sc = ops.addScene(s, p, null, { title: 'Satélites', narration: 'Satélites enviam sinais de tempo', visualIntent: 'satélite em órbita', durationSec: 4, kind: 'mixed' });
  sc.searchTerms = 'satellite orbit';
  const sceneDir = path.join(dir, 'scenes', sc.id);
  fs.mkdirSync(path.join(sceneDir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(sceneDir, 'audio', 'words.json'), JSON.stringify(estimateWords('Satélites enviam sinais de tempo', 4)));
  fs.mkdirSync(path.join(sceneDir, 'stock'), { recursive: true });
  fs.writeFileSync(path.join(sceneDir, 'stock', 'stock.json'), JSON.stringify({ assets: [{ file: 'stock-1.jpg', kind: 'image', width: 1600, height: 900, license: 'CC BY' }] }));
  const step = p.route!.steps.find((x) => x.kind === 'code_scene')!;
  const ctx = { project: p, projectDir: dir, step, binding: step.bindings[0]!, scene: sc, sceneDir, outDir: path.join(dir, 'out'), settings: s, signal: new AbortController().signal, log: () => {} } as ExecContext;
  const prompt = buildPrompt(ctx);
  assert.match(prompt, /inglês \(EUA\)/, 'idioma no prompt');
  assert.match(prompt, /Use paleta quente/, 'skill global'); assert.match(prompt, /Anime ícones sincronizados/, 'skill por etapa');
  assert.match(prompt, /Apresentação MISTA/); assert.match(prompt, /TEMPOS DA NARRAÇÃO/); assert.match(prompt, /\.\.\/stock\/stock-1\.jpg/);
  assert.match(prompt, /paper cut/i, 'aparência');
  const spStep = p.route!.steps.find((x) => x.kind === 'scene_plan')!;
  assert.match(buildPrompt({ ...ctx, step: spStep, scene: undefined, sceneDir: undefined }), /searchTerms/);
  assert.ok(wordsDigest(estimateWords('a b c d e f', 6)).includes('s–'));

  // ───────── catálogo
  const cat = buildCatalog(s, path.resolve(__dirname, '../../workflows'));
  assert.ok(cat.workflows.some((w) => w.file === 'krea2-turbo-t2i.json' && w.capability === 'image' && w.label === 'Krea 2 Turbo'));
  assert.ok(cat.workflows.some((w) => w.capability === 'music') && cat.workflows.some((w) => w.capability === 'video') && cat.workflows.some((w) => w.capability === 'voice'));
  assert.ok(cat.wan2gpTemplates.some((w) => w.file === 'wan2gp-ltx2-i2v.json' && w.modelType === 'ltx2_25_22B_distilled_nvfp4'));
  assert.ok(cat.apis.some((a) => a.provider === 'seedance' && a.categories.includes('video')));

  // ───────── servidor falso: bancos de mídia, Gemini, Seedance, Ollama, OpenAI /models
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  let polls = 0;
  const seen: string[] = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const u = req.url ?? ''; seen.push(`${req.method} ${u.split('?')[0]}`);
      const j = (o: unknown, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const host = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
      if (u.startsWith('/v1/search')) return req.headers.authorization === 'PEXKEY' ? j({ photos: [{ src: { large2x: host + '/img/a.jpg', medium: host + '/img/a.jpg' }, width: 1600, height: 900, photographer: 'Ana', url: 'http://p/1', alt: 'sat' }] }) : j({ error: 'bad key' }, 401);
      if (u.startsWith('/videos/search')) return j({ videos: [{ image: host + '/img/a.jpg', url: 'http://p/v', user: { name: 'Vic' }, video_files: [{ file_type: 'video/mp4', link: host + '/vid/v.mp4', width: 1920, height: 1080 }] }] });
      if (u === '/api/tags') return j({ models: [{ name: 'qwen3:8b' }, { name: 'llama3.2' }] });
      if (u === '/api/chat') { const m = JSON.parse(body); return j({ message: { content: m.messages[0].content.includes('__forge') ? '```html\n<script>window.__forge={duration:1,fps:10,seek(t){}}</script>\n```' : `eco:${m.model}` } }); }
      if (u.startsWith('/api/videos/')) return j({ hits: [{ videos: { large: { url: host + '/vid/pv.mp4', width: 1920, height: 1080 } }, user: 'Pix', pageURL: 'http://px/v', tags: 'a' }] });
      if (u.startsWith('/api/')) return j({ hits: [{ largeImageURL: host + '/img/b.jpg', imageWidth: 1920, imageHeight: 1080, user: 'Pablo', pageURL: 'http://px/1', tags: 'tag' }] });
      if (u.startsWith('/w/api.php')) return j({ query: { pages: { 1: { title: 'File:Orbit.png', index: 1, imageinfo: [{ thumburl: host + '/img/c.png', thumbwidth: 1600, thumbheight: 900, mime: 'image/png', descriptionurl: 'http://wiki/orbit', extmetadata: { Artist: { value: '<a>NASA</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] }, 2: { title: 'File:x.svg', index: 2, imageinfo: [{ mime: 'image/svg+xml', url: host + '/x.svg' }] } } } });
      if (u.startsWith('/img/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); return void res.end(png); }
      if (u.startsWith('/vid/')) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return void res.end(Buffer.from('fakevideo')); }
      if (u.startsWith('/gemini/models/') && u.includes(':generateContent')) return j(body.includes('IMAGE') ? { candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] } : { candidates: [{ content: { parts: [{ text: 'resposta gemini' }] } }] });
      if (u.startsWith('/gemini/models')) return j({ models: [{ name: 'models/gemini-2.5-flash-image' }] });
      if (u === '/ark/contents/generations/tasks' && req.method === 'POST') return j({ id: 'task1' });
      if (u.startsWith('/ark/contents/generations/tasks/task1')) { polls++; return j(polls < 2 ? { status: 'running' } : { status: 'succeeded', content: { video_url: host + '/vid/seed.mp4' } }); }
      if (u.startsWith('/ark/contents/generations/tasks')) return j({ items: [] });
      if (u === '/oa/models') return j({ data: [{ id: 'gpt-x' }] });
      j({ error: 'nf ' + u }, 404);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const host = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  s.stock = { pexels: { apiKey: 'PEXKEY', baseUrl: host }, pixabay: { apiKey: 'k', baseUrl: host }, wikipedia: { baseUrl: host } };

  const hit = await searchStock(s, 'pexels', 'satellite', 'image', { width: 1920, height: 1080 });
  assert.equal(hit[0]!.author, 'Ana');
  await assert.rejects(searchStock({ ...s, stock: { pexels: { apiKey: 'errada', baseUrl: host } } }, 'pexels', 'x', 'image', { width: 1, height: 1 }), /401/);
  await assert.rejects(searchStock({ ...s, stock: {} }, 'pixabay', 'x', 'image', { width: 1, height: 1 }), /sem chave/);
  const wiki = await searchStock(s, 'wikipedia', 'orbit', 'image', { width: 1920, height: 1080 });
  assert.equal(wiki.length, 1, 'svg descartado'); assert.equal(wiki[0]!.author, 'NASA'); assert.equal(wiki[0]!.license, 'CC BY-SA 4.0');
  assert.deepEqual(await searchStock(s, 'wikipedia', 'orbit', 'video', { width: 1, height: 1 }), []);
  assert.equal((await testSource(s, 'pixabay')).ok, true);
  const assets = await fetchForScene(s, ['pexels', 'pixabay', 'wikipedia'], 'both', 'satellite orbit', path.join(ws, 'stk'), { width: 1920, height: 1080, count: 3 });
  assert.equal(assets.length, 3);
  assert.ok(assets.some((a) => a.hit.kind === 'video') && assets.some((a) => a.hit.kind === 'image'));
  const credits = JSON.parse(fs.readFileSync(path.join(ws, 'stk', 'stock.json'), 'utf8'));
  assert.equal(credits.assets.length, 3); assert.ok(credits.assets[0].license);
  // falha em uma fonte não derruba as outras
  const partial = await fetchForScene({ ...s, stock: { ...s.stock, pexels: { apiKey: 'errada', baseUrl: host } } }, ['pexels', 'wikipedia'], 'image', 'x', path.join(ws, 'stk2'), { width: 1, height: 1, count: 1 });
  assert.equal(partial[0]!.hit.source, 'wikipedia');
  await assert.rejects(fetchForScene({ ...s, stock: {} }, ['pixabay'], 'image', 'x', path.join(ws, 'stk3'), { width: 1, height: 1 }), /nenhuma mídia/);

  // Gemini (texto/imagem) + Seedance + teste de provedores
  const gem = { id: 'gemini', kind: 'gemini' as const, baseUrl: host + '/gemini', apiKey: 'k', models: [] };
  assert.equal(await prov.chat(gem, 'gemini-x', 'oi', new AbortController().signal), 'resposta gemini');
  const gimg = path.join(ws, 'g.png');
  await prov.image(gem, 'gemini-2.5-flash-image', 'p', '1024x1024', gimg, new AbortController().signal);
  assert.ok(fs.statSync(gimg).size > 10);
  assert.equal((await prov.testProvider(gem)).models![0], 'gemini-2.5-flash-image');
  assert.equal((await prov.testProvider({ ...gem, apiKey: '' })).ok, false);
  const seed = { id: 'seedance', kind: 'seedance' as const, baseUrl: host + '/ark', apiKey: 'k', models: [] };
  const sv = await prov.seedanceVideo(seed, 'seedance-x', 'robô', { imagePath: gimg, seconds: 5, ratio: '16:9', dest: path.join(ws, 'seed.mp4'), signal: new AbortController().signal, pollMs: 5 });
  assert.equal(fs.readFileSync(sv, 'utf8'), 'fakevideo');
  assert.equal((await prov.testProvider(seed)).ok, true);
  assert.deepEqual((await prov.testProvider({ id: 'oa', kind: 'openai', baseUrl: host + '/oa', apiKey: 'k', models: [] })).models, ['gpt-x']);

  // Ollama + harness auto
  const oll = { command: host, args: [], promptVia: 'stdin' as const, models: [] };
  // regressão: um comando que não existe NUNCA pode contar como instalado
  // (no Windows o cmd.exe imprime "não é reconhecido" em stderr e isso já foi lido como sucesso)
  assert.equal(detectHarness({ command: 'comando-inexistente-xyz', args: [], promptVia: 'stdin', models: [] }).installed, false);
  assert.equal(commandExists('comando-inexistente-xyz'), false);
  assert.equal(commandExists(process.execPath), true);
  assert.deepEqual(await ollamaModels(oll), ['qwen3:8b', 'llama3.2']);
  assert.equal((await detectHarnessAsync(oll)).installed, true);
  const run1 = await runHarness(oll, { cwd: ws, prompt: 'oi', signal: new AbortController().signal });
  assert.equal(run1.stdout, 'eco:qwen3:8b');
  const run2 = await runHarness(oll, { cwd: ws, prompt: 'oi', model: 'llama3.2', signal: new AbortController().signal });
  assert.equal(run2.stdout, 'eco:llama3.2');
  const s2: Settings = { ...s, harnesses: { ...s.harnesses, claude: { ...s.harnesses.claude, command: 'comando-inexistente-xyz' }, codex: { ...s.harnesses.codex, command: 'comando-inexistente-xyz' },
    opencode: { ...s.harnesses.opencode, command: 'comando-inexistente-xyz' }, antigravity: { ...s.harnesses.antigravity, command: 'comando-inexistente-xyz' }, openclaw: { ...s.harnesses.openclaw, command: 'comando-inexistente-xyz' }, deepseek: { ...s.harnesses.deepseek!, command: 'comando-inexistente-xyz' }, ollama: oll } };
  const rh = await resolveHarness(s2, { type: 'harness', harness: 'auto', model: 'auto' });
  assert.equal(rh.id, 'ollama'); assert.equal(rh.model, 'qwen3:8b');
  await assert.rejects(resolveHarness({ ...s2, harnesses: { ...s2.harnesses, ollama: { ...oll, command: 'http://127.0.0.1:1' } } }, { type: 'harness', harness: 'auto' }).then(() => { throw new Error('esperava falha'); }), /nenhum harness|esperava/);

  // DeepSeek Harness (CLI dsh): headless pelo stdin, sem pedir aprovação, modelo da rota via --patch
  {
    const dd = s.harnesses.deepseek!;
    assert.deepEqual([dd.command, dd.args, dd.promptVia, dd.env?.DSH_PERMISSION_MODE], ['dsh', ['--profile', 'headless', '-'], 'stdin', 'danger-full-access']);
    const pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-dsh-'));
    const pa = dshModelArgs(dd, 'deepseek-v4-pro', pdir);
    assert.equal(pa[0], '--patch');
    assert.match(fs.readFileSync(pa[1]!, 'utf8'), /id: agent-default-model\n {2}config:\n {4}provider: deepseek-official\n {4}model: deepseek-v4-pro\n/);
    assert.deepEqual(dshModelArgs(dd, undefined, pdir), [], 'sem modelo: o do perfil');
    assert.deepEqual(dshModelArgs(dd, 'x"; rm', pdir), [], 'nome de modelo estranho não vai para o YAML');
    assert.deepEqual(dshModelArgs(s.harnesses.codex, 'gpt-x', pdir), [], 'só o dsh');
  }
  /* laço do modelo local: mesmo bloco com números diferentes (qwen3.5-3d-coder:4b, visto 135×) */
  {
    const block = (i: number) => `  // ${i}.02-${i}.10 — a tiny particle burst and the leaf settles.\n  const settle = smoothstep(${i}.00, ${i}.08, t);\n  secondLeaf.position.y = 825 + settle * .1;\n\n`;
    const head = '<script type="module">\nconst W = 1920;\nfunction render(t) {\n';
    const loop = repetitionLoop(head + Array.from({ length: 14 }, (_, i) => block(i)).join('') + '  // parcial');
    assert.ok(loop && loop.reps >= 12 && /smoothstep/.test(loop.sample), JSON.stringify(loop));
    assert.equal(repetitionLoop(head + Array.from({ length: 8 }, (_, i) => block(i)).join('')), undefined, 'poucas voltas: ainda não é laço');
    assert.equal(repetitionLoop(head + Array.from({ length: 40 }, (_, i) => `  g.lineTo(${i * 10}, ${i * 7});\n`).join('') + 'x'), undefined, 'série de lineTo é código normal');
    /* nomes que mudam a cada linha (jjj3, kkk3…): mesma forma, exige o dobro de voltas */
    const named = (i: number) => ` const ${'abcdefghijklmnopqrstuvwxyz'[i % 26]!.repeat(3)}${i}={x:W*.5,y:H*.48,r:${4830 + i * 40},color:'#000000',intensity:smooth(1,1,t),heat:smooth(1,1,t),smoke:smooth(1,1,t)};\n`;
    assert.ok(repetitionLoop(head + Array.from({ length: 26 }, (_, i) => named(i)).join('') + 'x')?.reps! >= 24, 'laço com nomes diferentes');
    assert.equal(repetitionLoop(head + Array.from({ length: 14 }, (_, i) => named(i)).join('') + 'x'), undefined, 'poucas linhas parecidas: tabela normal');
    /* laço numa linha só, sem quebras (visto: …globalCompositeOperation='source-over';ctx.globalAlpha=…) */
    const oneLine = head + '  ctx.save();' + "ctx.globalCompositeOperation='source-over';ctx.globalAlpha=alpha*(1-i*.18);ctx.globalCompositeOperation='destination-out';".repeat(15) + 'ctx.glob';
    assert.ok(/globalCompositeOperation/.test(repetitionLoop(oneLine)?.sample ?? ''), 'laço numa linha');
    /* legendas palavra a palavra: dados, não laço */
    const words = ['formam', 'um', 'tribunal', 'tribal', 'implacável.', 'Errar', 'uma', 'vez', 'basta', 'para'];
    const subs = head + Array.from({ length: 40 }, (_, i) => `    {"w":"${words[i % 10]}","start":${i},"end":${i + 0.3}},{"w":"${words[(i + 3) % 10]}","start":${i + 0.3},"end":${i + 0.6}},{"w":"${words[(i + 7) % 10]}","start":${i + 0.6},"end":${i + 1}},\n`).join('') + 'x';
    assert.equal(repetitionLoop(subs), undefined, 'lista de dados não é laço');
  }
  // HTTP OpenAI-compatível na nuvem: "Authorization: Bearer" em /v1/models e /v1/chat/completions
  {
    const auths: string[] = [];
    const ds = http.createServer((req, res) => {
      auths.push(String(req.headers.authorization ?? ''));
      if (req.headers.authorization !== 'Bearer sk-teste') { res.writeHead(401); res.end('{"error":{"message":"Authentication Fails"}}'); return; }
      if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })); return; }
      let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
        const j = JSON.parse(b);
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `ds:${j.model}`, reasoning_content: 'pensando…' } }] }));
      });
    });
    await new Promise<void>((r) => ds.listen(0, '127.0.0.1', r));
    const dsUrl = `http://127.0.0.1:${(ds.address() as { port: number }).port}`;
    const dcfg = { command: dsUrl, args: [], promptVia: 'stdin' as const, protocol: 'openai' as const, models: [], apiKey: 'sk-teste', tools: false };
    assert.deepEqual(await ollamaModels(dcfg), ['deepseek-chat', 'deepseek-reasoner']);
    const dr = await runHarness(dcfg, { cwd: ws, prompt: 'oi', model: 'deepseek-chat', signal: new AbortController().signal });
    assert.equal(dr.stdout, 'ds:deepseek-chat');
    assert.ok(auths.every((a) => a === 'Bearer sk-teste'), auths.join());
    const semChave = await detectHarnessAsync({ ...dcfg, apiKey: '' });
    assert.ok(!semChave.installed && /401.*chave/.test(semChave.error ?? ''), JSON.stringify(semChave));
    ds.close();
  }

  // harness Ollama via executor: code_scene a partir do stdout
  const execs = createExecutors({ workflowsDir: path.resolve(__dirname, '../../workflows'), toolsDir: path.resolve(__dirname, '../../tools'), renderHtml: async (_h, out) => { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, 'clip'); } });
  const q = createProject(s2, { name: 'Oll', idea: 'x', videoType: 'custom', routeId: 'stickman-explainer' });
  ops.addScene(s2, q, null, { title: 'A', narration: 'n', visualIntent: 'v', kind: 'code' });
  const qdir = path.join(ws, 'projects', q.id);
  const route: Route = { id: 'r', name: 'r', description: '', videoTypes: [], steps: [{ id: 'cs', kind: 'code_scene', label: 'c', scope: 'scene', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 30, bindings: [{ type: 'harness', harness: 'auto', model: 'auto' }] }] };
  const evs: EngineEvent[] = [];
  const rr = await runRoute({ project: q, route, projectDir: qdir, signal: new AbortController().signal, deps: { settings: s2, emit: (e) => evs.push(e), sleep: async () => {}, executors: execs } });
  assert.equal(rr.ok, true, rr.error ?? '');
  assert.ok(fs.existsSync(path.join(qdir, 'scenes', q.scenes[0]!.id, 'code', 'scene.html')), 'HTML gravado a partir do Ollama');

  // ───────── stock + thumbnail + whisper(estimativa) pelo motor
  s2.providers = [{ id: 'gemini', kind: 'gemini', baseUrl: host + '/gemini', apiKey: 'k', models: [], categories: ['image'] }];
  const r3 = createProject(s2, { name: 'Mix', idea: 'GPS', videoType: 'vector', typeId: 'explicativo-vector' });
  r3.mediaSources = ['pexels', 'wikipedia'];
  ops.addScene(s2, r3, null, { title: 'S1', narration: 'Satélites enviam sinais', visualIntent: 'satélite', kind: 'stock', durationSec: 3 });
  ops.addScene(s2, r3, null, { title: 'S2', narration: 'Mapas mostram a posição', visualIntent: 'mapa', kind: 'code', durationSec: 3 });
  r3.scenes[0]!.searchTerms = 'satellite';
  ops.saveProjectFile(s2, r3);
  const rdir = path.join(ws, 'projects', r3.id);
  const mini: Route = { id: 'm', name: 'm', description: '', videoTypes: [], steps: [
    { id: 'stock', kind: 'stock_media', label: 's', scope: 'scene', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 30, onlySceneKinds: ['stock', 'mixed'], bindings: [{ type: 'stock', sources: ['pexels', 'pixabay', 'wikipedia'], media: 'both' }] },
    { id: 'thumb', kind: 'thumbnail', label: 't', scope: 'project', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 30, optional: true, bindings: [{ type: 'api', provider: 'gemini', model: 'gemini-2.5-flash-image' }] },
  ] };
  const r4 = await runRoute({ project: r3, route: mini, projectDir: rdir, signal: new AbortController().signal, deps: { settings: s2, emit: (e) => { if (process.env['DBG']) console.log(JSON.stringify(e)); }, sleep: async () => {}, executors: execs } });
  assert.equal(r4.ok, true, r4.error ?? '');
  const s1dir = path.join(rdir, 'scenes', r3.scenes[0]!.id);
  assert.ok(fs.existsSync(path.join(s1dir, 'stock', 'stock-1.mp4')) || fs.existsSync(path.join(s1dir, 'stock', 'stock-1.jpg')), 'mídias baixadas');
  assert.ok(fs.existsSync(path.join(s1dir, 'clips', 'clip.mp4')), 'cena stock usa o vídeo como visual');
  assert.ok(!fs.existsSync(path.join(rdir, 'scenes', r3.scenes[1]!.id, 'stock')), 'cena code não busca mídia (filtro por tipo)');
  assert.ok(fs.existsSync(path.join(rdir, 'out', 'thumbnail.png')), 'thumbnail 16:9 gerada via Gemini');
  assert.match(thumbnailPrompt({ ...ctx, project: r3 }), /Mix/);
  // projeto vertical: a thumbnail vira capa 9:16 (antes era ignorada)
  r3.aspect = '9:16';
  fs.rmSync(path.join(rdir, 'out', 'thumbnail.png'), { force: true });
  const r5 = await runRoute({ project: r3, route: { ...mini, steps: [mini.steps[1]!] }, projectDir: rdir, signal: new AbortController().signal, noCache: true, deps: { settings: s2, emit: () => {}, sleep: async () => {}, executors: execs } });
  assert.equal(r5.ok, true);
  assert.ok(fs.existsSync(path.join(rdir, 'out', 'thumbnail.png')), 'capa vertical gerada');
  assert.match(thumbnailPrompt({ ...ctx, project: r3 }), /vertical Shorts\/Reels cover|9:16/);

  // Whisper: estimativa + script python com módulo falso
  const fakeMod = path.join(ws, 'fakepy'); fs.mkdirSync(fakeMod);
  fs.writeFileSync(path.join(fakeMod, 'faster_whisper.py'), `
class _W: 
    def __init__(s,w,start,end): s.word=w; s.start=start; s.end=end
class _S:
    text=' ola mundo'
    words=[_W(' ola',0.0,0.4),_W(' mundo',0.5,1.0)]
class _I: language='pt'
class WhisperModel:
    def __init__(s,*a,**k): pass
    def transcribe(s,audio,**k): return [_S()], _I()
__version__='0.0-fake'
`);
  const wav = path.join(ws, 'a.wav');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', wav], { stdio: 'pipe' });
  process.env['PYTHONPATH'] = fakeMod;
  const wout = path.join(ws, 'w.json');
  const wf = await transcribe({ python: 'python3', model: 'small', device: 'cpu' }, path.resolve(__dirname, '../../tools/whisper_words.py'), wav, wout, 'pt-BR', new AbortController().signal);
  assert.deepEqual(wf.words.map((x) => x.w), ['ola', 'mundo']); assert.equal(wf.source, 'faster-whisper');
  delete process.env['PYTHONPATH'];
  await assert.rejects(transcribe({ python: 'python3', model: 'small', device: 'cpu' }, path.resolve(__dirname, '../../tools/whisper_words.py'), wav, wout, undefined, new AbortController().signal), /whisper saiu|faster-whisper/);

  // ───────── cronômetro e primeiro frame
  const pp = recordRun(s2, r3.id, 1000, 66000, true);
  assert.equal(pp.production!.totalMs, 65000);
  assert.equal(recordRun(s2, r3.id, 0, 5000, false).production!.totalMs, 70000);
  assert.equal(fmtDuration(65000), '1m 05s'); assert.equal(fmtDuration(3700000), '1h 01m');
  assert.equal(await ensureFirstFrame(s2, r3.id), null, 'sem visual válido: null (clipe corrompido ignorado)');
  fs.mkdirSync(path.join(rdir, 'scenes', r3.scenes[1]!.id, 'frames'), { recursive: true });
  fs.writeFileSync(path.join(rdir, 'scenes', r3.scenes[1]!.id, 'frames', 'frame.png'), png);
  const ff1 = await ensureFirstFrame(s2, r3.id);
  assert.ok(ff1 && fs.existsSync(ff1), 'primeiro frame a partir do visual da cena');
  fs.mkdirSync(path.join(rdir, 'out'), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1', '-pix_fmt', 'yuv420p', path.join(rdir, 'out', 'final.mp4')], { stdio: 'pipe' });
  const ff2 = await ensureFirstFrame(s2, r3.id);
  assert.ok(ff2 && fs.statSync(ff2).size > 100);

  srv.close();
  /* Ollama: janela acompanha o pedido; resultados antigos de ferramentas são resumidos, nunca o pedido nem a última rodada */
  assert.equal(ollamaCtx(1000), 24_576);
  assert.equal(ollamaCtx(60_000), 40_960);
  assert.equal(ollamaCtx(500_000), 49_152);
  const big = 'x'.repeat(20_000);
  const conv: any[] = [{ role: 'user', content: 'PEDIDO ' + big }, { role: 'assistant', content: '', tool_calls: [{}] }, { role: 'tool', content: big }, { role: 'tool', content: big },
    { role: 'assistant', content: '', tool_calls: [{}] }, { role: 'tool', content: big }];
  assert.equal(fitContext(conv, 1_000_000), false, 'cabe: nada muda');
  assert.equal(fitContext(conv, 65_000), true);
  assert.ok(conv[0].content.startsWith('PEDIDO') && conv[0].content.length > 20_000, 'pedido intacto');
  assert.ok(conv[2].content.length < 1000 && conv[3].content.length === 20_000, 'só o mais antigo, até caber');
  assert.equal(conv[5].content.length, 20_000, 'última rodada intacta');

  /* prompt maior que a linha de comando (ENAMETOOLONG no Windows): vai por arquivo, que some no fim */
  const longCli = { command: process.execPath, args: ['-e', 'const f=require("fs");const m=/"([^"]+\\.md)"/.exec(process.argv[1]);console.log(m?f.readFileSync(m[1],"utf8").length:"arg:"+process.argv[1].length)', '{prompt}'], promptVia: 'arg' as const, models: [] };
  const longPrompt = 'p'.repeat(40_000);
  const lr = await runHarness(longCli, { cwd: ws, prompt: longPrompt, signal: new AbortController().signal });
  assert.equal(lr.ok, true, lr.stderr);
  assert.equal(lr.stdout.trim(), '40000', 'o CLI leu o pedido inteiro do arquivo');
  assert.ok(!fs.readdirSync(ws).some((f) => f.startsWith('.forge-prompt-')), 'arquivo temporário removido');
  const sr = await runHarness(longCli, { cwd: ws, prompt: 'curto', signal: new AbortController().signal });
  assert.equal(sr.stdout.trim(), 'arg:5', 'prompt curto continua no argumento');

  /* modelo local em laço: pede o MESMO comando para sempre (Ollama em streaming NDJSON) */
  assert.equal(toolCallKey('run_command', { command: 'cmd /c "dir /b C:\\X"' }), toolCallKey('run_command', JSON.stringify({ command: 'CMD  /c dir /b C:\\X' })), 'aspas, espaços e maiúsculas não contam');
  const loopSrv = http.createServer((req, res) => {
    if (req.url === '/api/show') { res.writeHead(404); return res.end(); }
    let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
      const m = JSON.parse(body);
      assert.equal(m.stream, true, 'Ollama em streaming');
      assert.equal(m.think, false, 'raciocínio desligado por padrão');
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'run_command', arguments: { command: 'cmd /c "dir /b C:\\NaoExiste"' } } }] }, done: false }) + '\n');
      res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }) + '\n');
    });
  });
  await new Promise<void>((r) => loopSrv.listen(0, '127.0.0.1', () => r()));
  const lp = (loopSrv.address() as { port: number }).port;
  const lines: string[] = [];
  const loop = await runHarness({ command: `http://127.0.0.1:${lp}`, args: [], promptVia: 'arg', protocol: 'ollama', tools: true, models: [], defaultModel: 'mini' },
    { cwd: ws, prompt: 'faça', signal: new AbortController().signal, onLine: (l) => lines.push(l), tools: { roots: [ws], allowShell: true } });
  loopSrv.close();
  assert.equal(loop.ok, false);
  assert.match(loop.stderr, /entrou em laço/, loop.stderr);
  assert.equal(lines.filter((l) => l.startsWith('tool run_command')).length, 2, 'o comando repetido só roda 2 vezes');
  assert.equal(lines.filter((l) => /repetida bloqueada/.test(l)).length, 6, 'para na 6ª chamada bloqueada');

  /* modelo padrão apagado do Ollama (404): usa um instalado em vez de cair no próximo provedor */
  const asked: string[] = [];
  const goneSrv = http.createServer((req, res) => {
    if (req.url === '/api/show') { res.writeHead(404); return res.end(); }
    let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
      if (req.url === '/api/tags') { res.writeHead(200); return res.end(JSON.stringify({ models: [{ name: 'velho:9b' }, { name: 'novo:9b' }].slice(1) })); }
      const m = JSON.parse(body); asked.push(m.model);
      if (m.model === 'velho:9b') { res.writeHead(404); return res.end(JSON.stringify({ error: "model 'velho:9b' not found" })); }
      res.writeHead(200); res.end(JSON.stringify({ message: { role: 'assistant', content: 'oi' }, done: true, done_reason: 'stop' }) + '\n');
    });
  });
  await new Promise<void>((r) => goneSrv.listen(0, '127.0.0.1', () => r()));
  const gp = (goneSrv.address() as { port: number }).port;
  const gl: string[] = [];
  const gone = await runHarness({ command: `http://127.0.0.1:${gp}`, args: [], promptVia: 'arg', protocol: 'ollama', models: [], defaultModel: 'velho:9b' },
    { cwd: ws, prompt: 'oi', signal: new AbortController().signal, onLine: (l) => gl.push(l) });
  goneSrv.close();
  assert.equal(gone.ok, true, gone.stderr);
  assert.deepEqual(asked, ['velho:9b', 'novo:9b']);
  assert.ok(gl.some((l) => /não existe mais/.test(l)), 'avisa no log');
  assert.ok(ollamaPredict(24_576) >= 12_000 && ollamaPredict(200_000) === 24_576, 'saída do Ollama: metade da janela, até 24k');

  /* página do vídeo livre: o validador pega os erros típicos de modelo local */
  assert.equal(freeHtmlProblem(freeSkeleton(4, 30, 640, 360)), undefined, 'o esqueleto passa');
  assert.match(freeHtmlProblem('<html><script>window.__forge={duration:4,fps:30,seek(t){},pause(){}};</script></html>')!, /seek\(t\) está vazio/);
  assert.match(freeHtmlProblem('<html><script>window.__forge={seek(t){render(t)}')!, /cortada/);
  assert.match(freeHtmlProblem('<html><body>sem contrato</body></html>')!, /não define window.__forge/);
  /* modelo que separa a página em vários blocos ``` ou escreve texto antes: pega do <!doctype ao </html> */
  const multi = 'Aqui está:\n```html\n<!doctype html><html><head>\n```\n```js\n<script>window.__forge={seek(t){render(t)}}</script>\n```\n```html\n</html>\n```\nPronto!';
  const pg = extractHtmlPage(multi);
  assert.ok(pg.startsWith('<!doctype html>') && pg.endsWith('</html>') && pg.includes('__forge'), pg);
  assert.equal(extractHtmlPage('```html\n<html><body>x</body></html>\n```'), '<html><body>x</body></html>');
  /* modelo manteve render(t) do esqueleto e apagou o window.__forge: o FilmForge recoloca */
  const noHook = ensureForgeContract('<html><body><script>function render(t){}\nlet f=0;while(f<30){render(f/30);f++;}</script></body></html>', 14);
  assert.equal(noHook.added, true);
  assert.equal(freeHtmlProblem(noHook.page), undefined, noHook.page);
  assert.equal(ensureForgeContract('<html><body>nada</body></html>', 14).added, false, 'sem render(t) não inventa contrato');
  /* página em módulo (biblioteca do plugin): o contrato entra DENTRO do módulo, onde render(t) existe */
  const modPage = ensureForgeContract('<html><body><script type="module">import { ss } from "../plugins/x/lib/core.mjs";\nfunction render(t){}\n</script></body></html>', 10);
  assert.ok(modPage.added && modPage.page.indexOf('__forge') < modPage.page.indexOf('</script>'), modPage.page);
  /* plugin no vídeo livre: assinaturas da biblioteca (sem corpos) para o modelo sem ferramentas */
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-lib-'));
  fs.mkdirSync(path.join(skillDir, 'lib'));
  fs.writeFileSync(path.join(skillDir, 'lib', 'colony.mjs'), 'import { x } from "./core.mjs";\nexport function leaf(ctx, len = 600, { color = "#6DB352", cut = null } = {}) {\n  body();\n}\nexport const clamp = (x, a = 0, b = 1) => Math.max(a, x);\nexport const INK = "#1E1612";\nfunction hidden() {}\n');
  const sig = libSignatures(skillDir, ['lib/colony.mjs']);
  assert.ok(sig.includes('function leaf(ctx, len = 600, { color = "#6DB352", cut = null } = {})'), sig);
  assert.ok(sig.includes('const clamp = (x, a = 0, b = 1)') && sig.includes('const INK = "#1E1612"') && !sig.includes('hidden') && !sig.includes('body()'), sig);
  const L = { importmap: '<script type="importmap">{}</script>', line: 'import * as L from "../plugins/x/x/lib/_all.mjs";' };
  const withLib = freeHtmlPrompt({ idea: 'formigas', aspect: '16:9' }, path.join(skillDir, 'free.html'), 10, 1920, 1080, false, 'PLUGINS ATIVOS', L);
  assert.ok(withLib.includes('PLUGINS ATIVOS') && withLib.includes('<script type="module">\n' + L.line) && withLib.includes(L.importmap) && !withLib.includes('sem bibliotecas externas'), 'prompt com plugin: esqueleto já importa a biblioteca');
  /* Three.js local: a URL do cdnjs (prompt de sistema do 3d-coder) vira "three" do import map; addons ficam */
  {
    const im = { three: '../plugins/_three/three.module.min.js' };
    const cdn = '<html><head></head><body><script type="module">\nimport * as THREE from \'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js\';\nimport { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";\n</script></body></html>';
    const a = ensureThreeImport(cdn, im);
    assert.ok(a.includes('import * as THREE from \'three\'') && a.includes('examples/jsm/controls/OrbitControls.js'), a);
    assert.ok(a.indexOf('"three":"../plugins/_three/three.module.min.js"') < a.indexOf('type="module"'), 'import map antes do módulo');
    const own = '<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","x":"./x.js"}}</script><script type="module">import * as THREE from "three";</script>';
    assert.match(ensureThreeImport(own, im), /"three":"\.\.\/plugins\/_three\/three\.module\.min\.js","x":"\.\/x\.js"/, 'import map do modelo: CDN trocado, resto mantido');
    assert.equal(ensureThreeImport('<script>const a = 1;</script>', im), '<script>const a = 1;</script>', 'página sem three não muda');
    const sk = freeThreeSkeleton(6, 30, 1920, 1080, im);
    assert.ok(sk.includes('import * as THREE from "three"') && sk.includes('preserveDrawingBuffer: true') && sk.includes('window.__forge'));
    const pd = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-three-'));
    const st = stageThree(pd, path.join(pd, 'out'));
    assert.deepEqual(st?.importmap, { three: '../plugins/_three/three.module.min.js' });
    assert.ok(fs.statSync(path.join(pd, 'plugins', '_three', 'three.module.min.js')).size > 500_000, 'Three.js copiado para o projeto');
  }
  /* exemplo do próprio plugin: template Node (run({ setup, frame })) vira render(t) com as mesmas chamadas */
  {
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-tpl-'));
    fs.mkdirSync(path.join(sd, 'templates'));
    fs.writeFileSync(path.join(sd, 'templates', 'film-template.mjs'), [
      'const { lerp, ant } = await import("x");', 'const { run, exposure } = await import("y");', 'const W = 1080, H = 1080, FPS = 24, DUR = 5;', 'const G = 790;   // chão',
      'run({ name: "t", W, H, fps: FPS, dur: DUR,', '  setup() { return { finish: filmFinish(W, H, { grain: .1 }) }; },', '  frame(ctx, t, i, S) {',
      '    const d = exposure(t, [{ at: 0, on: 2 }], FPS);', '    ant(ctx, lerp(1250, 640, d / 5), G, 1.1, { flip: true });', '    S.finish(ctx, i);', '  },', '});'].join('\n'));
    const ex = pluginExample(sd, ['lerp', 'ant', 'filmFinish', 'paper'])!;
    assert.ok(ex, 'template reconhecido');
    assert.ok(ex.includes('const { lerp, ant, filmFinish } = L;'), ex);
    assert.ok(ex.includes('const G = 790;') && !/const W = 1080/.test(ex), 'constantes da cena sim, formato não');
    assert.ok(ex.includes('const SETUP = {') && ex.includes('finish: filmFinish(W, H, { grain: .1 })'), ex);
    assert.ok(ex.includes('function render(t) {') && ex.includes('const ctx = g, i = Math.round(t * 30), S = SETUP;') && ex.includes('const d = t;'), ex);
    assert.equal(pluginExample(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-tpl-')), ['ant']), undefined, 'sem template: nada');
  }
  /* chamadas à biblioteca do plugin (visto no SenseNova-Loop): nome no plural, contexto a mais/a menos, fábrica descartada */
  {
    const names = ['ant', 'filmFinish', 'grass', 'lerp', 'shake', 'bug'];
    const fp = { ant: 'ctx', filmFinish: 'W', grass: 'ctx', lerp: 'a', shake: 't', bug: 'ctx' };
    const page = 'const g = document.getElementById("c").getContext("2d");\nfunction render(t) {\n  L.ants(x, y, 1.5);\n  L.grass(g, 1040, 0, W);\n  const a = L.lerp(1, 2, .5);\n  L.filmFinish(g, W, H, { grain: .1 });\n  L.bug(ctx, 1, 2);\n  L.shake(t, [1]);\n}';
    const r = fixLibCalls(page, names, fp, { filmFinish: 'frame' });
    assert.ok(r.page.includes('L.ant(g, x, y, 1.5);'), r.page);
    assert.ok(r.page.includes('L.grass(g, 1040, 0, W);') && r.page.includes('L.lerp(1, 2, .5)') && r.page.includes('L.bug(ctx, 1, 2)') && r.page.includes('L.shake(t, [1])'), 'chamadas certas ficam');
    assert.ok(r.page.includes('(globalThis.__forgeFab0 ??= L.filmFinish(W, H, { grain: .1 }))(g, Math.round(t *'), r.page);
    assert.deepEqual(r.fixes.slice(0, 1), ['L.ants → L.ant']);
    assert.equal(fixLibCalls('const v = L.filmFinish(W, H);', names, fp, { filmFinish: 'frame' }).page, 'const v = L.filmFinish(W, H);', 'retorno usado: não mexe');
    assert.equal(fixLibCalls('L.xyzzy(g);', names, fp).fixes.length, 0, 'sem candidato: não inventa');
    /* camada pronta (paper/soil devolvem canvas) chamada solta e efeito guardado numa variável chamado como objeto */
    const cv = fixLibCalls('function render(t) {\n  L.paper(W, H, "#F4EDDC");\n  L.soil(W, H - G, "day");\n  S.finish(ctx, i);\n}\nconst S = L.filmFinish(W, H, {});',
      ['paper', 'soil', 'filmFinish'], { paper: 'W', soil: 'W', filmFinish: 'W' }, { paper: 'canvas', soil: 'canvas', filmFinish: 'frame' });
    assert.ok(cv.page.includes('g.drawImage((globalThis.__forgeFab1 ??= L.paper(W, H, "#F4EDDC")), 0, 0);'), cv.page);
    assert.ok(cv.page.includes('g.drawImage((globalThis.__forgeFab0 ??= L.soil(W, H - G, "day")), 0, G);'), cv.page);
    assert.ok(cv.page.includes('S(ctx, i);') && cv.page.includes('const S = L.filmFinish(W, H, {});'), cv.page);
  }
  /* arrow com várias instruções sem chaves (visto no qwen3.5-3d-coder:4b): o FilmForge põe as chaves */
  {
    const bad = '  legL.forEach((p, i) => ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], ";)"); ctx.stroke());\n  a.map(x => x * 2);\n  b.forEach((q) => { f(q); g(q); });';
    const r = fixArrowBodies(bad);
    assert.equal(r.fixes, 1);
    assert.equal(r.page.split('\n')[0], '  legL.forEach((p, i) => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], ";)"); ctx.stroke(); });');
    assert.deepEqual(r.page.split('\n').slice(1), bad.split('\n').slice(1), 'arrow de uma expressão e com chaves ficam iguais');
    assert.equal(fixArrowBodies('const f = (t) => t * 2; // comentário; com ponto e vírgula\nfor (let i = 0; i < 3; i++) g(() => h(i));').fixes, 0, 'arrow solta e for normal não mudam');
  }
  assert.match(freeLibProblem('<script type="module">import { ant } from "../lib/index.mjs";</script>', L.line)!, /linha de import/);
  assert.match(freeLibProblem(`<script type="module">${L.line}\nimport { x } from "../lib/index.mjs";</script>`, L.line)!, /index\.mjs/);
  assert.equal(freeLibProblem(`<script type="module">${L.line}\nL.ant(g, 1, 2);</script>`, L.line, ['ant']), undefined);
  assert.match(freeLibProblem(`<script type="module">${L.line}\nfunction ant(ctx, x) { const s = s; }</script>`, L.line, ['ant', 'leaf'])!, /reescreve.*ant.*L\.ant/);
  assert.equal(freeLibProblem(`<script type="module">${L.line}\nconst line = 3; let seed = 7;</script>`, L.line, ['line', 'seed']), undefined, 'variável com nome da biblioteca não é reescrita');
  assert.match(freeLibProblem(`<script type="module">${L.line}\nconst leaf = (ctx, n) => 1;</script>`, L.line, ['leaf'])!, /leaf/);
  const noMap ='<html><head></head><body><script type="module">' + L.line + '</script></body></html>';
  assert.ok(ensureImportMap(noMap, L.importmap).indexOf(L.importmap) < ensureImportMap(noMap, L.importmap).indexOf('type="module"'), 'import map antes do módulo');
  assert.equal(ensureImportMap(ensureImportMap(noMap, L.importmap), L.importmap), ensureImportMap(noMap, L.importmap), 'não duplica');
  assert.ok(freeHtmlPrompt({ idea: 'x', aspect: '16:9' }, path.join(skillDir, 'free.html'), 10, 1920, 1080, false).includes('sem bibliotecas externas'));
  assert.deepEqual(freeLibMissing(`<script type="module">${L.line}\nL.pencil(g); L.ant(g); new L.Pen(g);</script>`, ['ant', 'Pen']), ['pencil']);
  /* _all.mjs do staging: biblioteca inteira como default protegido (nome inventado não derruba o quadro) */
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-all-'));
    const pdir = path.join(root, 'plugins', 'anim');
    fs.mkdirSync(path.join(pdir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(pdir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'anim' }));
    fs.mkdirSync(path.join(pdir, 'skills', 'anim', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(pdir, 'skills', 'anim', 'SKILL.md'), '---\nname: anim\ndescription: d\n---\nUse lib.');
    fs.writeFileSync(path.join(pdir, 'skills', 'anim', 'lib', 'core.mjs'), 'export function ant(ctx, x) { return x * 2; }\nexport class Pen {}\n');
    fs.writeFileSync(path.join(pdir, 'skills', 'anim', 'lib', 'film.mjs'), 'import fs from "node:fs";\n');
    const st = { ...defaultSettings(root), pluginsDir: path.join(root, 'plugins') };
    const proj = path.join(root, 'proj');
    fs.mkdirSync(path.join(proj, 'out'), { recursive: true });
    const txt = pluginPrompt(st, ['anim'], {}, { projectDir: proj, stepKind: 'free', htmlDir: path.join(proj, 'out') });
    const fl = freeLibImport(st, ['anim'], proj, path.join(proj, 'out'))!;
    assert.ok(txt.includes('function ant(ctx, x)') && fl.line === 'import L from "../plugins/anim/anim/lib/_all.mjs";' && fl.names.join() === 'ant,Pen', `${fl.line} ${fl.names}`);
    const allSrc = fs.readFileSync(path.join(proj, 'plugins', 'anim', 'anim', 'lib', '_all.mjs'), 'utf8');
    assert.ok(!allSrc.includes('film.mjs') && allSrc.includes('export default new Proxy'), allSrc);
    const mod = await import('data:text/javascript,' + encodeURIComponent(allSrc.replace(/^(?:export \* |import \* as m0 )from "\.\/core\.mjs";$/gm, '').replace('Object.assign({}, m0)', `Object.assign({}, { ant: (c, x) => x * 2, boom: (c) => { c.save(); throw new TypeError('tunnels is not iterable'); }, ` +
      `Pen: class Pen { constructor(ctx) { this.ctx = ctx; this.g = ctx.createPattern(); } begin() { return this; } stroke(pts) { return pts.length; } } })`)));
    const Lp = mod.default as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const warn = console.warn; console.warn = () => { /* aviso esperado */ };
    assert.equal(Lp.ant(null, 4), 8);
    /* nome inventado (L.pen) vira um "nada" que aceita qualquer uso: chamar, ler propriedade, iterar, somar */
    const none = Lp.pen(null);
    assert.doesNotThrow(() => { none.stroke(1).fill(); for (const _x of none) { /* vazio */ } assert.equal(Number(none) + 1, 1); });
    assert.equal(Lp.sin, Math.sin, 'L.sin cai em Math.sin');
    let depth = 0;
    const ctx = { save() { depth++; }, restore() { depth--; }, createPattern() { return 'p'; } };
    assert.doesNotThrow(() => Lp.boom(ctx).x.y(), 'erro dentro da biblioteca pula só a chamada');
    assert.equal(depth, 1, 'canvas volta ao estado de antes da chamada (o save interno sem restore fica por conta da biblioteca)');
    /* new L.Pen() sem canvas derrubava a página na carga: recebe o canvas da página; métodos da instância protegidos */
    (globalThis as Record<string, unknown>).document = { querySelector: () => ({ getContext: () => ctx }) };
    const pen = new Lp.Pen();
    assert.equal(pen.g, 'p');
    assert.equal(pen.begin('a').stroke([1, 2]), 2, 'encadeia pela instância protegida');
    assert.doesNotThrow(() => pen.stroke(undefined), 'método com argumento errado vira aviso');
    assert.doesNotThrow(() => pen.fill(1, 2).x(), 'método inventado na instância vira "nada"');
    delete (globalThis as Record<string, unknown>).document;
    console.warn = warn;
  }
  /* página em módulo: o __forge nasce depois do script comum da proteção — ela entra pelo setter */
  const tolMod = tolerantSeek('<html><body><script type="module">window.__forge={seek(t){throw new Error("x")}};</script></body></html>');
  const fakeWin: Record<string, unknown> = {};
  new Function('window', 'console', /<script>([\s\S]*?)<\/script>/.exec(tolMod)![1])(fakeWin, { warn() { /* silencioso */ } });
  fakeWin.__forge = { seek() { throw new Error('x'); } };
  assert.doesNotThrow(() => (fakeWin.__forge as { seek: (t: number) => void }).seek(0), 'seek protegido mesmo definido depois');
  const tol = tolerantSeek('<html><body><script>window.__forge={seek(t){throw 1}}</script></body></html>');
  assert.ok(tol.indexOf('seek ignorado') < tol.indexOf('</body>') && tol.indexOf('seek ignorado') > tol.indexOf('throw 1'), 'proteção depois da página');
  console.log('library/stock/providers/harness tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
