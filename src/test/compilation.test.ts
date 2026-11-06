import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createExecutors } from '../main/executors';
import { runRoute } from '../main/engine';
import { compilationFields, createProject, defaultSettings } from '../main/settings';
import { compilationPlan } from '../main/prompts';
import { fitSceneSfx } from '../main/editor';
import * as ff from '../main/ffmpeg';
import type { Route } from '../shared/types';

/** Coletâneas de N a M minutos (YuE 2 instrumental, sem silêncio) e efeitos sincronizados com o visual pela IA. */
async function main() {
  /* plano da coletânea a partir do mínimo/máximo do usuário */
  assert.deepEqual(compilationFields({ musicMinMin: 60, musicMaxMin: 30 }), { musicMinMin: 60, musicMaxMin: 60, musicTrackSec: undefined }, 'máximo nunca abaixo do mínimo');
  const base = { route: { id: 'r', name: 'r', description: '', videoTypes: [], steps: [] } } as never;
  const plan = compilationPlan({ ...(base as object), musicMinMin: 30, musicMaxMin: 60 } as never);
  assert.equal(plan.targetSec, 2700); assert.equal(plan.tracks, 18); assert.equal(plan.trackSec, 150, '45 min = 18 faixas de 2,5 min');
  assert.equal(compilationPlan({ ...(base as object), musicMinMin: 120, musicMaxMin: 180, musicTrackSec: 240 } as never).tracks, 38, 'coletâneas longas (2–3 h) sem limite de 6 min');
  assert.ok(compilationPlan({ ...(base as object) } as never).trackSec >= 60, 'sem dados do usuário: nunca faixas de poucos segundos');

  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.log('(sem ffmpeg: teste de coletânea pulado)'); return; }
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-comp-'));
  const media = path.join(ws, 'media'); fs.mkdirSync(media);
  /* ComfyUI falso: devolve áudio com a duração pedida (max_duration); a 1ª faixa sai curta (8 s) */
  const submitted: Array<{ seconds: number; lyrics: string; lora: boolean }> = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
      const json = (o: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const url = req.url ?? '';
      if (url === '/system_stats') return json({ system: {} });
      if (url === '/prompt') {
        const g = (JSON.parse(body) as { prompt: Record<string, { inputs: Record<string, unknown>; class_type: string }> }).prompt;
        const seconds = Number(g['43:25']!.inputs['max_duration']);
        submitted.push({ seconds, lyrics: String(g['43:37']!.inputs['value']), lora: Object.values(g).some((x) => x.class_type === 'Lora Loader') });
        n++;
        const dur = n === 1 ? 8 : seconds;
        execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=f=${200 + n * 40}:d=${dur}`, '-b:a', '64k', path.join(media, `a${n}.mp3`)], { stdio: 'ignore' });
        return json({ prompt_id: `p${n}` });
      }
      if (url.startsWith('/history/')) { const id = url.split('/').pop()!; return json({ [id]: { status: { completed: true }, outputs: { '42': { audio: [{ filename: `a${id.slice(1)}.mp3`, subfolder: '', type: 'output' }] } } } }); }
      if (url.startsWith('/view')) { const f = new URL('http://x' + url).searchParams.get('filename')!; res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return void res.end(fs.readFileSync(path.join(media, f))); }
      if (url === '/free') return json({});
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    const s = defaultSettings(ws);
    s.comfyServers = [{ id: 'local', url: `http://127.0.0.1:${port}` } as (typeof s.comfyServers)[number]];
    const p = createProject(s, { name: 'Lofi', idea: 'lo-fi para estudar', videoType: 'pixel_art', skillId: 'clipe-musical-loop-codigo', routeId: 'clipe-musical-loop-codigo', aspect: '16:9',
      musicMode: 'instrumental', musicMinMin: 2, musicMaxMin: 2.5, musicTrackSec: 60 });
    assert.equal(p.targetDurationSec, 135, 'duração alvo = meio do intervalo');
    const pd = path.join(ws, 'projects', p.id);
    p.scenes = [{ id: 's01', index: 1, title: 'Loop', narration: '', visualIntent: 'pixel city', kind: 'code', durationSec: 12, status: {}, artifacts: {} }];
    fs.mkdirSync(path.join(pd, 'scenes', 's01', 'frames'), { recursive: true });
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360', '-frames:v', '1', path.join(pd, 'scenes', 's01', 'frames', 'frame.png')], { stdio: 'ignore' });
    fs.writeFileSync(path.join(pd, 'script.md'), 'Conceito: cidade.\nMUSIC_PLAN: [{"name":"Rainy Rooftop","style":"lofi piano","seconds":12},{"name":"Midnight Coffee","style":"lofi rhodes","seconds":12}]');
    const edit = p.route!.steps.find((x) => x.kind === 'edit')!;
    const route: Route = { id: 'only', name: 'only', description: '', videoTypes: [], steps: [{ ...edit, dependsOn: [] }] };
    const logs: string[] = [];
    const r = await runRoute({ project: p, route, projectDir: pd, signal: new AbortController().signal,
      deps: { settings: s, emit: (e) => { if (e.t === 'log' || e.t === 'step.failed') logs.push(JSON.stringify(e)); }, sleep: async () => {}, executors: createExecutors({ workflowsDir: path.resolve(__dirname, '../../workflows') }) } });
    assert.equal(r.ok, true, `${r.error}\n${logs.slice(-12).join('\n')}`);
    assert.ok(submitted.every((x) => x.lora && x.lyrics === '[instrumental]'), 'instrumental local = workflow YuE 2 com LoRA instrumental');
    assert.ok(submitted.every((x) => x.seconds >= 60), `faixas longas, nunca os 12 s do plano (${submitted.map((x) => x.seconds).join(',')})`);
    assert.ok(logs.some((l) => /saiu curta/.test(l)), 'faixa curta do YuE é gerada de novo');
    const final = path.join(pd, 'out', 'final.mp4');
    const d = await ff.duration('ffprobe', final);
    assert.ok(d >= 120 - 1 && d <= 150 + 1, `coletânea dentro do intervalo pedido (${d.toFixed(1)} s)`);
    const tl = fs.readFileSync(path.join(pd, 'out', 'tracklist.txt'), 'utf8').trim().split('\n');
    assert.ok(tl.length >= 2 && tl[0]!.startsWith('0:00 Rainy Rooftop'), tl.join(' | '));

    /* efeitos sincronizados com o visual: a IA recebe o visual e a animação e só usa os sons pedidos */
    let asked = '';
    const api = http.createServer((req, res) => { let b = ''; req.on('data', (x) => { b += x; }); req.on('end', () => {
      asked = (JSON.parse(b) as { messages: Array<{ content: string }> }).messages[0]!.content;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ scenes: [{ id: 's01', sfx: ['impact@1.4', 'ding@0.2', 'whoosh@0'], why: 'o prédio cai em 1,4 s' }] }) } }] }));
    }); });
    await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok));
    try {
      s.providers = [{ id: 'fake', kind: 'openai', baseUrl: `http://127.0.0.1:${(api.address() as { port: number }).port}`, apiKey: 'x', models: ['m'] } as (typeof s.providers)[number]];
      fs.mkdirSync(path.join(pd, 'scenes', 's01', 'code'), { recursive: true });
      fs.writeFileSync(path.join(pd, 'scenes', 's01', 'code', 'scene.html'), '<script>window.__forge={seek(t){ if(t>1.4) drawFall(); }}</script>');
      const rt: Route = { ...route, steps: [{ ...edit, id: 'scene_plan', kind: 'scene_plan', bindings: [{ type: 'api', provider: 'fake', model: 'm' }] }] };
      const out = await fitSceneSfx({ settings: s, project: p, projectDir: pd, route: rt, sceneIds: ['s01'], names: ['impact', 'whoosh'], signal: new AbortController().signal, log: () => {} });
      assert.deepEqual(out['s01'], ['impact@1.4', 'whoosh@0'], 'só os sons pedidos, nos instantes do evento visual');
      assert.match(asked, /drawFall/, 'a IA recebe o código da animação'); assert.match(asked, /pixel city/, 'e o visual da cena');
      /* sem IA: cai na posição pela fala, sem falhar */
      const off = await fitSceneSfx({ settings: s, project: p, projectDir: pd, route: { ...rt, steps: [] }, sceneIds: ['s01'], names: ['stone'], signal: new AbortController().signal, log: () => {} });
      assert.deepEqual(off['s01'], ['stone']);
    } finally { api.close(); }
  } finally { server.close(); }
  console.log('compilation tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
