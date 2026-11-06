import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cacheKey, runRoute, semaphore, type Executor } from '../main/engine';
import { getRoute, MIXED_STOCK_SOURCES } from '../main/presets';
import * as lib from '../main/library';
import * as ops from '../main/ops';
import { createProject, defaultSettings, projectsDir, withOrchestrator } from '../main/settings';
import { buildPrompt, mixKinds, referenceText, briefText, workerText } from '../main/prompts';
import { youtubeFillStarts } from '../main/stock';
import { runTool, TOOL_SPECS } from '../main/tools';
import { installPluginFolder, listPlugins, pluginPrompt, removePlugin } from '../main/plugins';
import { runHarness, parseAgyModels } from '../main/harness';
import { createExecutors } from '../main/executors';
import { createMcpServer, mcpClientConfig } from '../main/mcp';
import * as http from 'node:http';
import { effectFilters, filterPath, makeSegment, subtitleForceStyle, burnSubtitles } from '../main/ffmpeg';
import { prepareReferences, subtitleToText } from '../main/references';
import type { EngineEvent, Project, Route, RouteStep, Scene } from '../shared/types';
import type { ExecContext } from '../main/engine';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-feat-'));
  const s = defaultSettings(ws);

  // 1. skill "vídeo livre" + rota livre; skill mista com vídeo IA
  const free = lib.getSkill(s, 'video-livre')!;
  assert.ok(free.freeform && free.builtin && free.global === '' && Object.keys(free.steps).length === 0, 'skill vazia');
  const fr = getRoute('video-livre')!;
  assert.deepEqual(fr.steps.map((x) => x.kind), ['free'], 'rota livre só executa o prompt');
  assert.deepEqual(lib.validateRoute(fr), []);
  const mix = lib.getSkill(s, 'misto-motion-banco-ia')!;
  assert.deepEqual(mix.mixSources, ['motion', 'stock', 'ai']);
  const mr = getRoute(mix.routeId!)!;
  assert.deepEqual(lib.validateRoute(mr), []);
  for (const k of ['stock_media', 'video', 'code_scene']) assert.ok(mr.steps.some((x) => x.kind === k), `rota mista tem ${k}`);

  // Explicativo misto: YouTube primeiro e todos os bancos na skill e na rota; trechos de 4 s.
  const explainer = lib.getSkill(s, 'explicativo-codigo')!;
  assert.equal(explainer.mediaSources?.[0], 'youtube', 'skill começa pelo YouTube');
  for (const src of MIXED_STOCK_SOURCES) assert.ok(explainer.mediaSources?.includes(src), `skill inclui ${src}`);
  const er = getRoute('explainer-mixed')!;
  const stock = er.steps.find((st) => st.kind === 'stock_media')!;
  const stockBinding = stock.bindings[0] as { type: string; sources: string[] };
  assert.equal(stockBinding.sources[0], 'youtube', 'rota busca YouTube primeiro');
  assert.deepEqual(stockBinding.sources, MIXED_STOCK_SOURCES, 'rota usa a mesma lista de bancos da skill');
  assert.equal(stock.params.maxSeconds, 4, 'clipes limitados a 4 s');
  // 4 s não cobrem uma cena de 8 s: o download busca mais um trecho do mesmo vídeo.
  assert.deepEqual(youtubeFillStarts(4, 8), [7, 11], 'cena de 8 s continua com trecho seguinte');
  assert.deepEqual(youtubeFillStarts(4, 12), [7, 11, 15], 'cena de 12 s usa três trechos do mesmo vídeo');
  assert.deepEqual(youtubeFillStarts(4, 4), [], 'cena coberta pelo primeiro trecho não baixa extra');
  assert.match(explainer.steps?.scene_plan ?? '', /YouTube/i, 'prompt de cenas pede YouTube');
  assert.match(explainer.steps?.code_scene ?? '', /stock\/|YouTube/i, 'prompt de código insere os clipes');

  // 2. projeto vídeo livre: prompt do usuário vai direto ao harness
  const pf = createProject(s, { name: 'Livre', idea: 'Faça um timelapse de nuvens em 10 segundos', videoType: 'custom', skillId: 'video-livre', routeId: 'video-livre' });
  const dirF = path.join(projectsDir(s), pf.id);
  const ctxF = { project: pf, projectDir: dirF, outDir: path.join(dirF, 'out'), step: pf.route!.steps[0]!, settings: s, binding: pf.route!.steps[0]!.bindings[0]! } as unknown as ExecContext;
  const promptF = buildPrompt(ctxF);
  assert.match(promptF, /timelapse de nuvens/);
  assert.match(promptF, /final\.mp4/);
  assert.ok(promptF.startsWith(pf.idea.trim()), 'vídeo livre: o prompt é o pedido do usuário, sem preâmbulo');
  assert.ok(!/IDIOMA|Formato \d|Aparência|SKILL|Nível de qualidade|memória/i.test(promptF), 'vídeo livre: não injeta skill/estilo/idioma/formato');
  assert.equal(pf.scenes.length, 0);

  // 3. agentes: orquestrador insere o brief no início; obreiros entram no prompt das etapas que assumem
  assert.ok(lib.listAgents(s).some((a) => a.role === 'orchestrator') && lib.listAgents(s).some((a) => a.role === 'worker'));
  assert.throws(() => lib.saveAgent(s, { id: '', name: 'X', role: 'worker', description: '', instructions: '' }), /instruções/);
  const mine = lib.saveAgent(s, { id: '', name: 'Narrador épico', role: 'worker', description: 'voz épica', instructions: 'Use frases épicas.', handles: ['script'], harness: 'auto' });
  assert.equal(mine.id, 'narrador-epico');
  const pa = createProject(s, { name: 'Equipe', idea: 'GPS', videoType: 'custom', skillId: 'vector', routeId: 'explainer-mixed', orchestratorId: 'diretor-criativo', workerIds: ['roteirista', mine.id] });
  assert.equal(pa.route!.steps[0]!.id, 'brief');
  assert.ok(pa.route!.steps.filter((x) => x.id !== 'brief' && x.dependsOn.length === 0).length === 0, 'todas as raízes dependem do brief');
  assert.equal(pa.agents?.orchestrator?.id, 'diretor-criativo');
  assert.deepEqual(pa.agents?.workers.map((w) => w.id), ['roteirista', 'narrador-epico']);
  assert.match(workerText(pa, { id: 'script', kind: 'script' }), /Narrador épico.*frases épicas/s);
  assert.equal(workerText(pa, { id: 'edit', kind: 'edit' }), '');
  assert.throws(() => createProject(s, { name: 'x', idea: 'x', videoType: 'custom', skillId: 'vector', routeId: 'explainer-mixed', orchestratorId: 'roteirista' }), /Orquestrador/);
  const twice = withOrchestrator(pa.route!.steps, pa.agents!.orchestrator!);
  assert.equal(twice.filter((x) => x.id === 'brief').length, 1, 'brief não duplica');
  const dirA = path.join(projectsDir(s), pa.id);
  fs.writeFileSync(path.join(dirA, 'brief.md'), '# Brief\nPaleta #112233');
  assert.match(briefText(dirA, 'script'), /Paleta #112233/);
  assert.equal(briefText(dirA, 'brief'), '');
  const briefPrompt = buildPrompt({ project: pa, projectDir: dirA, outDir: path.join(dirA, 'out'), step: pa.route!.steps[0]!, settings: s } as unknown as ExecContext);
  assert.match(briefPrompt, /ORQUESTRADOR "Diretor criativo"/);
  assert.match(briefPrompt, /Diretrizes por etapa/);

  // 4. mescla definida pela skill
  assert.equal(mixKinds(pa), 'code, motion, stock, mixed');
  const pm = createProject(s, { name: 'Mix', idea: 'x', videoType: 'custom', skillId: 'misto-motion-banco-ia', routeId: 'misto-motion-banco-ia' });
  assert.equal(pm.presentation, 'mixed');
  assert.match(mixKinds(pm), /video/);

  // 5. referências: legenda vira texto; vídeo vira quadros-chave
  assert.equal(subtitleToText('1\n00:00:01,000 --> 00:00:02,000\nOlá <b>mundo</b>\n\n2\n00:00:02,000 --> 00:00:03,000\nsegunda linha\n'), 'Olá mundo segunda linha');
  const srt = path.join(ws, 'ref.srt'); fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:02,000\nComece com uma pergunta.\n');
  const pr = createProject(s, { name: 'Ref', idea: 'x', videoType: 'custom', skillId: 'stickman', routeId: 'stickman-explainer' });
  const dirR = path.join(projectsDir(s), pr.id);
  let vid: string | undefined;
  if (hasFfmpeg) { vid = path.join(ws, 'ref.mp4'); execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=15', '-pix_fmt', 'yuv420p', vid], { stdio: 'ignore' }); }
  await prepareReferences(s, pr, dirR, { scriptFile: srt, videoFile: vid }, path.join(ws, 'tools'), new AbortController().signal);
  assert.equal(fs.readFileSync(pr.refScript!.textFile!, 'utf8'), 'Comece com uma pergunta.');
  assert.match(referenceText(pr, 'script'), /MODELO DE ESTILO[\s\S]*Comece com uma pergunta/);
  assert.equal(referenceText(pr, 'edit'), '');
  if (vid) {
    assert.ok(pr.refVideo!.frames.length >= 4, 'quadros-chave extraídos');
    assert.ok(Math.abs((pr.refVideo!.durationSec ?? 0) - 2) < 0.3);
    assert.match(referenceText(pr, 'image'), /VÍDEO DE REFERÊNCIA[\s\S]*f01\.jpg/);
  }

  // 6. cache: projetos antigos mantêm a chave; estilos novos invalidam
  const st0: RouteStep = pr.route!.steps[0]!;
  const plain = { ...pr, refScript: undefined, refVideo: undefined } as Project;
  assert.equal(cacheKey(plain, st0, st0.bindings[0]!), cacheKey({ ...plain, agents: undefined, scriptStyle: undefined }, st0, st0.bindings[0]!));
  assert.notEqual(cacheKey(plain, st0, st0.bindings[0]!), cacheKey({ ...plain, scriptStyle: 'épico' }, st0, st0.bindings[0]!));

  // 7. semáforo
  { const lim = semaphore(2); let act = 0, peak = 0;
    await Promise.all(Array.from({ length: 6 }, () => lim(async () => { act++; peak = Math.max(peak, act); await sleep(10); act--; })));
    assert.equal(peak, 2); }

  // 8. cenas simultâneas: cada cena percorre as etapas sem esperar as outras; GPU local = 1 por vez
  const mkScenes = (n: number): Scene[] => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, index: i + 1, title: `c${i + 1}`, narration: 'n', visualIntent: 'v', kind: 'image', status: {}, artifacts: {} }));
  const st = (id: string, type: 'builtin' | 'comfyui', deps: string[] = []): RouteStep => ({ id, kind: id === 'gpu' ? 'image' : 'narration', label: id, scope: 'scene', dependsOn: deps, enabled: true, params: {}, retry: { max: 1, backoffMs: 1 }, timeoutSec: 30,
    bindings: [type === 'comfyui' ? { type: 'comfyui', server: 'local', workflow: 'x.json' } : { type: 'builtin', tool: 'subtitles' }] });
  const route: Route = { id: 'r', name: 'r', description: '', videoTypes: [], steps: [st('api', 'builtin'), st('gpu', 'comfyui', ['api'])] };
  const runWith = async (conc: number | undefined, defConc = 0, audioFirst = false) => {
    const sd = { ...s, defaults: { ...s.defaults, sceneConcurrency: defConc } };
    const p = createProject(s, { name: 'Pipe', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot' });
    p.scenes = mkScenes(4); p.sceneConcurrency = conc; p.audioFirst = audioFirst;
    const dir = path.join(projectsDir(s), p.id);
    const log: string[] = []; const active = new Map<string, number>(); const peak = new Map<string, number>();
    const exec: Executor = async (c) => {
      const k = c.step.id; active.set(k, (active.get(k) ?? 0) + 1); peak.set(k, Math.max(peak.get(k) ?? 0, active.get(k)!));
      log.push(`start ${k} ${c.scene!.id}`); await sleep(15); log.push(`end ${k} ${c.scene!.id}`);
      active.set(k, active.get(k)! - 1);
      const f = path.join(dir, 'tmp', `${k}-${c.scene!.id}.txt`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x');
      return { files: [f] };
    };
    const ev: EngineEvent[] = [];
    const r = await runRoute({ project: p, route, projectDir: dir, signal: new AbortController().signal, noCache: true, deps: { settings: sd, emit: (e) => ev.push(e), executors: { builtin: exec, comfyui: exec } } });
    return { r, log, peak, ev };
  };
  const seq = await runWith(undefined, 0);
  assert.ok(seq.r.ok);
  assert.ok(seq.log.indexOf('start gpu s1') > seq.log.indexOf('end api s4'), 'modo antigo: etapa por etapa');
  const par = await runWith(3);
  assert.ok(par.r.ok, par.r.error);
  assert.ok(par.log.indexOf('start gpu s1') < par.log.indexOf('end api s4'), 'pipeline: cena 1 segue para a GPU antes de todas terminarem a etapa 1');
  assert.equal(par.peak.get('gpu'), 1, 'GPU local: uma cena por vez');
  assert.ok((par.peak.get('api') ?? 0) >= 2, 'API/harness: várias cenas ao mesmo tempo');
  assert.equal(par.log.filter((l) => l.startsWith('end')).length, 8);

  // 8a. narrar primeiro: a narração de TODAS as cenas termina antes do primeiro clipe, ainda em paralelo
  const af = await runWith(3, 0, true);
  assert.ok(af.r.ok, af.r.error);
  const lastNarr = Math.max(...['s1', 's2', 's3', 's4'].map((x) => af.log.indexOf(`end api ${x}`)));
  assert.ok(lastNarr < af.log.indexOf('start gpu s1'), 'narrar primeiro: todos os áudios antes dos clipes');
  assert.ok((af.peak.get('api') ?? 0) >= 2, 'narrações em paralelo');
  assert.equal(af.peak.get('gpu'), 1, 'GPU local continua uma cena por vez');
  assert.equal(af.log.filter((l) => l.startsWith('end')).length, 8);

  // 8b. quando o projeto não define cenas simultâneas, vale o padrão das Configurações
  const dflt = await runWith(undefined, 4);
  assert.ok(dflt.r.ok, dflt.r.error);
  assert.ok((dflt.peak.get('api') ?? 0) >= 2, 'padrão das configurações: cenas em paralelo');

  // 8c. o motor publica progresso (barra por cenas, com estimativa de término)
  const prog = par.ev.filter((e) => e.t === 'run.progress') as Array<Extract<EngineEvent, { t: 'run.progress' }>>;
  assert.ok(prog.length >= 2, 'eventos de progresso');
  assert.equal(prog[0]!.done, 0);
  const last = prog[prog.length - 1]!;
  assert.equal(last.mode, 'scenes');
  assert.equal(last.total, 4, 'progresso por cenas: 4 cenas');
  assert.equal(last.done, 4);
  assert.equal(last.etaMs, 0);
  // projeto sem cenas: progresso por entregáveis (etapas de projeto)
  const projRoute: Route = { id: 'p', name: 'p', description: '', videoTypes: [], steps: [{ ...st('livre', 'builtin'), scope: 'project', kind: 'free' as RouteStep['kind'] }] };
  const pOnly = createProject(s, { name: 'Só entregável', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot' });
  const evP: EngineEvent[] = [];
  const rP = await runRoute({ project: pOnly, route: projRoute, projectDir: path.join(projectsDir(s), pOnly.id), signal: new AbortController().signal, noCache: true,
    deps: { settings: s, emit: (e) => evP.push(e), executors: { builtin: async (c) => { const f = path.join(c.projectDir, 'out', 'final.mp4'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); return { files: [f] }; } } } });
  assert.ok(rP.ok, rP.error);
  const prP = evP.filter((e) => e.t === 'run.progress') as Array<Extract<EngineEvent, { t: 'run.progress' }>>;
  const lastP = prP[prP.length - 1]!;
  assert.equal(lastP.mode, 'deliverables');
  assert.equal(lastP.total, 1); assert.equal(lastP.done, 1);

  // 8d. pré-checagem (harness/modelo por etapa) é publicada ao iniciar
  const pre = par.ev.filter((e) => e.t === 'run.preflight') as Array<Extract<EngineEvent, { t: 'run.preflight' }>>;
  assert.equal(pre.length, 1, 'evento de pré-checagem');
  assert.equal(pre[0]!.steps.length, 2);
  assert.equal(pre[0]!.steps[0]!.id, 'api');

  // 8e. plugins (formato Claude): instalar da pasta e injetar no prompt
  const pdir = path.join(ws, 'plugin-src', 'meu-plugin');
  fs.mkdirSync(path.join(pdir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pdir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'Meu Plugin', description: 'regras de estilo', version: '1.2.0' }));
  fs.mkdirSync(path.join(pdir, 'skills', 'estilo'), { recursive: true });
  fs.writeFileSync(path.join(pdir, 'skills', 'estilo', 'SKILL.md'), '---\nname: estilo\ndescription: d\n---\nUse sempre paleta neon e cortes secos.');
  fs.mkdirSync(path.join(pdir, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(pdir, 'commands', 'revisar.md'), 'Revise o roteiro antes de gerar cenas.');
  fs.writeFileSync(path.join(pdir, '.mcp.json'), JSON.stringify({ mcpServers: { busca: { command: 'x' } } }));
  const inst = installPluginFolder(s, pdir);
  assert.equal(inst.name, 'Meu Plugin');
  assert.deepEqual(inst.skills, ['estilo']);
  assert.deepEqual(inst.commands, ['revisar']);
  assert.deepEqual(inst.mcp, ['busca']);
  assert.equal(listPlugins(s).length, 1);
  const pp = pluginPrompt(s, [inst.id]);
  assert.match(pp, /use \[Meu Plugin\]/);
  assert.match(pp, /paleta neon/);
  assert.match(pp, /Revise o roteiro/);
  const pPlug = createProject(s, { name: 'Com plugin', idea: 'x', videoType: 'custom', skillId: 'vector', routeId: 'explainer-mixed', plugins: [inst.id] });
  assert.deepEqual(pPlug.plugins, [inst.id]);
  const ctxPlug = { project: pPlug, projectDir: path.join(projectsDir(s), pPlug.id), outDir: path.join(projectsDir(s), pPlug.id, 'out'), step: pPlug.route!.steps.find((x) => x.kind === 'script')!, settings: s } as unknown as ExecContext;
  assert.match(buildPrompt(ctxPlug), /PLUGINS ATIVOS[\s\S]*paleta neon/, 'plugin entra no prompt das etapas');
  removePlugin(s, inst.id);
  assert.equal(listPlugins(s).length, 0);

  // 8f. ferramentas locais (arquivos) confinadas ao projeto
  const twd = path.join(ws, 'tools'); fs.mkdirSync(twd, { recursive: true });
  assert.ok(TOOL_SPECS.some((x) => x.function.name === 'http_request') && TOOL_SPECS.some((x) => x.function.name === 'web_search'));
  assert.match(await runTool('write_file', { path: 'a/b.txt', content: 'oi' }, { roots: [twd], workdir: twd }), /gravado/);
  assert.equal(fs.readFileSync(path.join(twd, 'a', 'b.txt'), 'utf8'), 'oi');
  assert.equal(await runTool('read_file', { path: 'a/b.txt' }, { roots: [twd], workdir: twd }), 'oi');
  assert.match(await runTool('list_files', { path: '.', recursive: true }, { roots: [twd], workdir: twd }), /b\.txt/);
  assert.match(await runTool('read_file', { path: '../../segredo.txt' }, { roots: [twd], workdir: twd }), /fora do projeto/);
  assert.match(await runTool('http_request', { url: 'ftp://exemplo' }, { roots: [twd], workdir: twd }), /url inválida/);
  assert.match(await runTool('run_command', { command: 'echo oi' }, { roots: [twd], workdir: twd, allowShell: false }), /desabilitada/);

  // 8g. harness HTTP com ferramentas: o modelo pede write_file e o FilmForge executa
  const calls: Array<{ messages: unknown[] }> = [];
  const srv = http.createServer((req, res) => {
    const send = (o: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/tags') return send({ models: [{ name: 'qwen3:8b' }] });
    if (req.url === '/api/show') return send({});
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body || '{}') as { messages: Array<{ role: string }> };
      calls.push({ messages: j.messages });
      if (!j.messages.some((m) => m.role === 'tool')) {
        return send({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'write_file', arguments: { path: 'notas.txt', content: 'feito pelo modelo' } } }] } });
      }
      send({ message: { role: 'assistant', content: 'ok, gravei o arquivo' } });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  try {
    const hcfg = { command: `http://127.0.0.1:${port}`, args: [], promptVia: 'stdin' as const, models: [], protocol: 'ollama' as const, tools: true };
    const hr = await runHarness(hcfg, { cwd: twd, prompt: 'grave notas.txt', signal: new AbortController().signal, tools: { roots: [twd], allowShell: false } });
    assert.ok(hr.ok, hr.stderr);
    assert.equal(fs.readFileSync(path.join(twd, 'notas.txt'), 'utf8'), 'feito pelo modelo');
    assert.equal(calls.length, 2, 'duas rodadas: pedido da ferramenta + resposta final');
    assert.ok(JSON.stringify(calls[1]!.messages).includes('feito pelo modelo'), 'resultado da ferramenta volta ao modelo');
  } finally { srv.close(); }

  // 8h. modelos do Antigravity CLI (`agy models` devolve "id<TAB>rótulo")
  assert.deepEqual(
    parseAgyModels('Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n'),
    ['gemini-4-argon-medium', 'claude-opus-5-5-low', 'gpt-oss-120b-medium'],
  );
  assert.deepEqual(parseAgyModels(''), []);

  // 8i. o app OBSERVA o harness/modelo da rota: pré-checagem, log do executor e binding do step.start
  const hdir = path.join(ws, 'harness-fake'); fs.mkdirSync(hdir, { recursive: true });
  const hjs = path.join(hdir, 'fake.cjs');
  fs.writeFileSync(hjs, `const fs=require('fs');fs.writeFileSync('script.md','roteiro do fake');console.log('ok');\n`);
  const hcmd = path.join(hdir, 'fake.cmd');
  fs.writeFileSync(hcmd, `@"${process.execPath}" "${hjs}" %*\r\n`);
  const sObs = { ...s, harnesses: { ...s.harnesses, claude: { command: hcmd, args: [], promptVia: 'stdin' as const, models: ['sonnet'], defaultModel: 'sonnet' } } };
  const rObs: Route = { id: 'obs', name: 'obs', description: '', videoTypes: [], steps: [{
    id: 'script', kind: 'script', label: 'Roteiro', scope: 'project', dependsOn: [], enabled: true, params: {},
    retry: { max: 0, backoffMs: 1 }, timeoutSec: 60, bindings: [{ type: 'harness', harness: 'claude', model: 'sonnet' }],
  }] };
  const pObs = createProject(sObs, { name: 'Obs', idea: 'x', videoType: 'custom', skillId: 'vector', routeId: 'explainer-mixed' });
  const dirObs = path.join(projectsDir(sObs), pObs.id); fs.mkdirSync(dirObs, { recursive: true });
  const evObs: EngineEvent[] = [];
  const rO = await runRoute({
    project: pObs, route: rObs, projectDir: dirObs, signal: new AbortController().signal, noCache: true,
    deps: { settings: sObs, emit: (e) => evObs.push(e), executors: createExecutors({ workflowsDir: ws }) },
  });
  assert.ok(rO.ok, rO.error);
  const preO = evObs.find((e) => e.t === 'run.preflight') as Extract<EngineEvent, { t: 'run.preflight' }>;
  assert.equal(preO.steps[0]!.harness, 'claude');
  assert.equal(preO.steps[0]!.model, 'sonnet');
  assert.equal(preO.steps[0]!.ok, true, 'harness instalado é confirmado na pré-checagem');
  assert.equal(preO.steps[0]!.binding, 'harness:claude/sonnet');
  const stO = evObs.find((e) => e.t === 'step.start') as Extract<EngineEvent, { t: 'step.start' }>;
  assert.equal(stO.binding, 'harness:claude/sonnet', 'o passo usa o harness/modelo da rota');
  assert.ok(evObs.some((e) => e.t === 'log' && /provedor da rota: claude\/sonnet → claude\/sonnet/.test(e.line)), 'log explícito do harness/modelo');
  assert.equal(fs.readFileSync(path.join(dirObs, 'script.md'), 'utf8'), 'roteiro do fake');

  // 9. efeitos e legendas
  assert.deepEqual(effectFilters(undefined, 4, 1920, 1080), []);
  const fx = effectFilters({ filter: 'bw', zoom: 'in', fadeIn: true, fadeOut: true }, 4, 1920, 1080);
  assert.ok(fx[0]!.startsWith('zoompan=') && fx.includes('hue=s=0') && fx.includes('fade=t=in:st=0:d=0.4') && fx.includes('fade=t=out:st=3.60:d=0.4'));
  assert.equal(filterPath('C:\\Users\\a b\\x.srt'), 'C\\:/Users/a b/x.srt');
  assert.match(subtitleForceStyle({ burn: true, position: 'top', size: 54, color: '#ff8800', box: false }), /Fontsize=14,PrimaryColour=&H000088FF,Alignment=8/);
  const pe = createProject(s, { name: 'Fx', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot' });
  pe.scenes = mkScenes(1);
  ops.updateScene(pe, 's1', { effects: { filter: 'hack' as never, zoom: 'out', fadeIn: true }, subtitle: 'legenda própria' });
  assert.deepEqual(pe.scenes[0]!.effects, { filter: 'none', zoom: 'out', fadeIn: true, fadeOut: false, vignette: 'none', transition: 'none', transitionSec: 0.6 });
  assert.equal(pe.scenes[0]!.subtitle, 'legenda própria');
  ops.saveProjectFile(s, pe);
  const up = ops.updateProject(s, pe.id, { maxProductionMin: 45, sceneConcurrency: 20, workspace: '/x' } as never);
  assert.equal(up.maxProductionMin, 45); assert.equal(up.sceneConcurrency, 8);
  assert.equal((up as unknown as Record<string, unknown>)['workspace'], undefined, 'campos fora da lista são ignorados');
  assert.equal(ops.updateProject(s, pe.id, { maxProductionMin: 0 }).maxProductionMin, undefined);
  if (hasFfmpeg) {
    const out = path.join(ws, 'seg.mp4');
    await makeSegment('ffmpeg', { seconds: 1.5, effects: { filter: 'sepia', zoom: 'in', fadeIn: true, fadeOut: true } }, out, '16:9');
    assert.ok(fs.statSync(out).size > 1000, 'segmento com efeitos renderiza');
    const srt2 = path.join(ws, 's.srt'); fs.writeFileSync(srt2, '1\n00:00:00,000 --> 00:00:01,000\nOi\n');
    try { await burnSubtitles('ffmpeg', out, srt2, { burn: true, position: 'bottom', size: 46, color: '#ffffff', box: true }, path.join(ws, 'subs.mp4')); assert.ok(fs.statSync(path.join(ws, 'subs.mp4')).size > 1000); }
    catch (e) { if (/subtitles|No such filter|libass/i.test((e as Error).message)) console.log('  (ffmpeg sem libass: gravação de legenda não testada)'); else throw e; }
  }

  // 10. pasta de projetos configurável
  const other = path.join(ws, 'Outra', 'Projects');
  assert.equal(projectsDir({ ...s, projectsDir: other }), path.resolve(other));
  assert.equal(projectsDir({ ...s, projectsDir: '  ' }), path.join(ws, 'projects'));

  // 11. o app como servidor MCP (Model Context Protocol)
  const mcp = createMcpServer({
    getSettings: () => s, version: '0.1.0',
    listRows: async () => [{ id: 'x1', name: 'Projeto X', status: 'done', scenes: 2, hasFinal: true }],
    runProject: async () => ({ ok: true }), cancelProject: () => true, renderFinal: async () => ({ ok: true }),
    running: () => [], progressOf: () => null,
  });
  const rpc = (method: string, params?: unknown, id: number | null = 1) =>
    mcp.handle({ jsonrpc: '2.0', id, method, params }) as Promise<any>;
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'teste', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'filmforge');
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.ok(init.result.capabilities.tools && init.result.capabilities.resources);
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'notificação não gera resposta');
  const tools = await rpc('tools/list');
  assert.ok(tools.result.tools.length >= 14, `ferramentas MCP (${tools.result.tools.length})`);
  assert.ok(tools.result.tools.some((t: { name: string; inputSchema: { required?: string[] } }) => t.name === 'filmforge_run' && (t.inputSchema.required ?? []).includes('projectId')));
  assert.match((await rpc('tools/call', { name: 'filmforge_projects', arguments: {} })).result.content[0].text, /Projeto X/);
  assert.match((await rpc('tools/call', { name: 'filmforge_skills', arguments: {} })).result.content[0].text, /video-livre/);
  assert.match((await rpc('tools/call', { name: 'filmforge_providers', arguments: { detect: false } })).result.content[0].text, /antigravity/);
  const bad = await rpc('tools/call', { name: 'filmforge_run', arguments: {} });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /projectId/);
  assert.equal((await rpc('tools/call', { name: 'nao_existe', arguments: {} })).result.isError, true);
  const created = await rpc('tools/call', { name: 'filmforge_create_project', arguments: { name: 'Via MCP', idea: 'teste de integração', skillId: 'video-livre' } });
  const idMcp = /projeto criado: (\S+)/.exec(created.result.content[0].text)?.[1] ?? '';
  assert.ok(idMcp, 'projeto criado pelo MCP');
  assert.match((await rpc('tools/call', { name: 'filmforge_status', arguments: { projectId: idMcp } })).result.content[0].text, /"running": false/);
  assert.match((await rpc('resources/read', { uri: `filmforge://project/${idMcp}` })).result.contents[0].text, /Via MCP/);
  const res = await rpc('resources/list');
  assert.ok(res.result.resources.some((x: { uri: string }) => x.uri === 'filmforge://projects'));
  assert.ok(res.result.resources.some((x: { uri: string }) => x.uri === `filmforge://project/${idMcp}/log`));
  assert.equal((await rpc('metodo/qualquer')).error.code, -32601);
  assert.match(mcpClientConfig('C:\\x\\FilmForge.exe'), /"args": \[\s*"--mcp"\s*\]/);

  console.log('feature tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
