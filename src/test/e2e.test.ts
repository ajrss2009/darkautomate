/**
 * Teste ponta a ponta SEM Electron e SEM rede externa:
 *  - harness falso (script shell) para roteiro / planejamento / cena por código
 *  - servidor ComfyUI falso (imagem) com falha forçada -> fallback para API
 *  - servidor OpenAI-compatível falso (TTS + imagem)
 *  - ffmpeg real para montar o vídeo
 *  - renderizador de cenas por código substituído por um stub baseado em ffmpeg
 * Requer ffmpeg/ffprobe no PATH.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runRoute } from '../main/engine';
import { createExecutors, type RenderHtml } from '../main/executors';
import { createProject, defaultSettings } from '../main/settings';
import * as ops from '../main/ops';
import * as ff from '../main/ffmpeg';
import type { EngineEvent } from '../shared/types';

const sh = (...a: string[]) => execFileSync(a[0]!, a.slice(1), { stdio: 'pipe' });

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-e2e-'));
  const png = path.join(ws, 'x.png'), mp3 = path.join(ws, 'x.mp3');
  sh('ffmpeg', '-y', '-f', 'lavfi', '-i', 'testsrc=s=512x512:d=1', '-frames:v', '1', png);
  sh('ffmpeg', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-q:a', '5', mp3);
  const pngB = fs.readFileSync(png), mp3B = fs.readFileSync(mp3);

  // ── servidor falso (ComfyUI + OpenAI-compatível na mesma porta)
  const calls = { comfySubmit: 0, comfyFail: 0, apiImage: 0, apiTts: 0 };
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const json = (o: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (url === '/system_stats') return json({ system: {} });
      if (url === '/upload/image') return json({ name: 'up.png', subfolder: '' });
      if (url === '/prompt') {
        calls.comfySubmit++;
        if (body.includes('FAILME')) { calls.comfyFail++; return json({ error: { message: 'forced failure' } }, 400); }
        return json({ prompt_id: 'pid-' + calls.comfySubmit });
      }
      if (url.startsWith('/history/')) {
        const id = url.split('/').pop()!;
        return json({ [id]: { status: { completed: true, status_str: 'success' }, outputs: { '9': { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] }, '29': { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] }, '10': { audio: [{ filename: 'm.mp3', subfolder: '', type: 'output' }] }, '42': { audio: [{ filename: 'm.mp3', subfolder: '', type: 'output' }] } } } });
      }
      if (url.startsWith('/view')) { const aud = url.includes('m.mp3'); res.writeHead(200, { 'Content-Type': aud ? 'audio/mpeg' : 'image/png' }); return void res.end(aud ? mp3B : pngB); }
      if (url === '/v1/images/generations') { calls.apiImage++; return json({ data: [{ b64_json: pngB.toString('base64') }] }); }
      if (url === '/v1/audio/speech') { calls.apiTts++; res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return void res.end(mp3B); }
      json({ error: 'not found ' + url }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  // ── harness falso
  const fake = path.join(ws, 'fake-claude.js');
  fs.writeFileSync(fake, String.raw`
const fs = require('fs'), path = require('path');
let prompt = '';
process.stdin.on('data', (d) => { prompt += d; });
process.stdin.on('end', () => {
  const m = /Grave o resultado em:\s*(.+)/.exec(prompt);
  const out = m ? m[1].trim().replace(/\r$/, '') : '';
  if (!out) { process.stdout.write('{}'); process.exit(0); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const scenes = [
    { id: 's01', title: 'Abertura', narration: 'Olá, esta é a primeira cena do vídeo', visualIntent: 'um robô acenando', kind: 'image' },
    { id: 's02', title: 'Código', narration: 'Agora uma cena desenhada por código', visualIntent: 'quadrado animado', kind: 'code' },
    { id: 's03', title: 'Fallback', narration: 'Esta cena força o fallback do ComfyUI', visualIntent: 'FAILME robô triste', kind: 'image' },
  ];
  const html = '<!doctype html><html><body><canvas id="c" width="540" height="960"></canvas><script>' +
    "window.__forge={duration:1.5,fps:10,seek(t){const x=document.getElementById('c').getContext('2d');x.fillStyle='#123';x.fillRect(0,0,540,960);x.fillStyle='#fff';x.fillRect(40+t*200,400,90,90);}};" +
    '</script></body></html>';
  const body =
    /script\.md$/.test(out) ? 'Gancho forte. Meio do roteiro. Final em loop.\n' :
    /scenes\.json$/.test(out) ? JSON.stringify(scenes) :
    /scene\.html$/.test(out) ? html :
    /metadata\.json$/.test(out) ? JSON.stringify({ title: 'T', description: 'D', tags: ['a'] }) :
    '{}';
  fs.writeFileSync(out, body);
  process.stdout.write('done');
});
`, 'utf8');

  const s = defaultSettings(ws);
  /* o harness falso roda no próprio node do sistema — nada de bash, rede ou CLI pago */
  s.harnesses.claude = { command: process.execPath, args: [fake], promptVia: 'stdin', models: [] };
  s.comfyServers = [{ id: 'local', url: `http://127.0.0.1:${port}` }];
  s.providers = [{ id: 'openai', kind: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'test', models: [] }];

  const renderHtml: RenderHtml = async (_html, out, { w, h, ffmpeg }) => {
    assert.ok(fs.readFileSync(_html, 'utf8').includes('__forge'));
    await ff.run(ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=green:s=${w}x${h}:d=1.5:r=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  };
  const executors = createExecutors({ workflowsDir: path.resolve(__dirname, '../../workflows'), renderHtml });

  /* legendas são opção do projeto (padrão: não gerar); aqui o teste confere o .srt */
  const p = createProject(s, { name: 'E2E', idea: 'Teste ponta a ponta', videoType: 'cartoon_3d', routeId: 'shorts-autopilot', aspect: '9:16', subtitles: 'srt' });
  /* hermético: TODA etapa de IA roda no harness falso. Sem isso, um CLI real instalado
     (ex.: deepseek/dsh) entra na cadeia e o teste passa a depender de saldo externo. */
  for (const st of p.route!.steps) st.bindings = st.bindings.map((b) => b.type === 'harness' ? { type: 'harness', harness: 'claude' as const } : b);
  const dir = path.join(ws, 'projects', p.id);
  const events: EngineEvent[] = [];
  const deps = () => ({ settings: s, emit: (e: EngineEvent) => events.push(e), sleep: async () => {}, executors });

  // reduz tentativas para o teste ser rápido
  for (const st of p.route!.steps) st.retry = { max: 1, backoffMs: 0 };

  // ───────── 1) rota completa
  const r1 = await runRoute({ project: p, route: p.route!, projectDir: dir, deps: deps(), signal: new AbortController().signal });
  assert.equal(r1.ok, true, r1.error ?? '');
  assert.equal(p.scenes.length, 3);
  const final = path.join(dir, 'out', 'final.mp4');
  assert.ok(fs.existsSync(final), 'final.mp4 deve existir');
  const d1 = await ff.duration('ffprobe', final);
  assert.ok(d1 > 4 && d1 < 12, `duração inesperada: ${d1}`);
  const info = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'csv=p=0', final]).toString().trim();
  assert.equal(info, 'h264,1080,1920');
  assert.ok(fs.readFileSync(path.join(dir, 'out', 'subtitles.srt'), 'utf8').includes('-->'));
  assert.ok(fs.existsSync(path.join(dir, 'scenes', 's02', 'clips', 'code.mp4')), 'cena por código renderizada');
  assert.equal(calls.apiTts, 3, 'TTS via API nas 3 cenas');
  assert.equal(calls.comfyFail, 2, 'Krea2 e Z-Image falharam na cena 3 antes do fallback para API');
  assert.equal(calls.apiImage, 1, 'fallback para API de imagem apenas na cena 3');
  const fb = events.filter((e) => e.t === 'step.fallback') as Array<Extract<EngineEvent, { t: 'step.fallback' }>>;
  assert.ok(fb.some((e) => e.sceneId === 's03' && e.stepId === 'image' && e.to.startsWith('api:')), 'evento de fallback registrado');
  assert.ok(p.scenes.every((sc) => sc.status['narration'] === 'done'));
  assert.ok(p.scenes[0]!.durationSec! > 1.5 && p.scenes[0]!.durationSec! < 2.5, 'duração da cena = duração do áudio');

  // ───────── 2) segunda execução: tudo em cache (nenhuma chamada nova)
  const before = { ...calls };
  const r2 = await runRoute({ project: p, route: p.route!, projectDir: dir, deps: deps(), signal: new AbortController().signal });
  assert.equal(r2.ok, true, r2.error ?? '');
  assert.deepEqual(calls, before, 'segunda execução não deve chamar serviços');

  // ───────── 3) edição estilo timeline: reordenar + duração manual + regenerar só uma cena
  const q = ops.readProject(s, p.id);
  ops.moveScene(q, 's03', 0);
  ops.updateScene(q, 's01', { durationSec: 5 });
  const flags = ops.updateScene(q, 's02', { narration: 'Narração nova da cena de código' });
  ops.saveProjectFile(s, q);
  const r3 = await runRoute({
    project: ops.readProject(s, p.id), route: q.route!, projectDir: dir, deps: deps(), signal: new AbortController().signal,
    only: { sceneIds: ['s02'], stepIds: [...ops.stepsFor(q.route, flags), 'subtitles', 'edit'] }, noCache: true,
  });
  assert.equal(r3.ok, true, r3.error ?? '');
  assert.equal(calls.apiTts, before.apiTts + 1, 'só a narração da cena 2 foi regenerada');
  const d3 = await ff.duration('ffprobe', final);
  assert.ok(d3 > d1 + 1, `a duração manual (5 s) deveria aumentar o vídeo: ${d1} -> ${d3}`);
  const order = fs.readFileSync(path.join(dir, 'out', 'subtitles.srt'), 'utf8').split('\n').filter((l) => l && !l.includes('-->') && !/^\d+$/.test(l))[0]!;
  assert.ok(order.includes('Esta'), 'a cena 3 (movida para o início) vem primeiro nas legendas');

  server.close();
  console.log('e2e tests: OK', { duracaoInicial: +d1.toFixed(2), duracaoAposEdicao: +d3.toFixed(2), calls });
}
main().catch((e) => { console.error(e); process.exit(1); });
