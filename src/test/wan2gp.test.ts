/** Testa a ponte Wan2GP com um "Wan2GP" falso (shared/api.py) — sem GPU, sem rede. Requer python3 e ffmpeg. */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runRoute } from '../main/engine';
import { createExecutors } from '../main/executors';
import { createProject, defaultSettings } from '../main/settings';
import { Wan2gpClient } from '../main/wan2gp';
import * as ops from '../main/ops';
import type { EngineEvent, Route, RouteStep } from '../shared/types';

async function main() {
  /* o teste da ponte precisa de um python real; sem nenhum no PATH, pula como os de ffmpeg */
  const py = ['python3', 'python', 'py'].find((c) => { try { execFileSync(c, ['-V'], { stdio: 'ignore' }); return true; } catch { return false; } });
  if (!py) { console.log('(sem python: teste do Wan2GP pulado)'); return; }
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-wan-'));
  const root = path.join(ws, 'Wan2GP');
  fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shared', '__init__.py'), '');
  fs.writeFileSync(path.join(root, 'shared', 'api.py'), `
import json, os, shutil
class _R: pass
class _E:
    def __init__(self, m): self.message = m
class Job:
    def __init__(self, st): self.st = st
    def cancel(self): pass
    def result(self, timeout=None):
        with open(os.environ['FAKE_LOG'], 'a') as f: f.write(json.dumps(self.st) + '\\n')
        r = _R(); r.cancelled = False
        if 'FAILME' in str(self.st.get('prompt')):
            r.success = False; r.generated_files = []; r.errors = [_E('boom do modelo')]; return r
        out = os.path.join(os.getcwd(), 'outputs'); os.makedirs(out, exist_ok=True)
        kind = self.st['model_type']
        src, name = (os.environ['FAKE_PNG'], 'o.png') if kind == 'z_image' else (os.environ['FAKE_MP3'], 'o.mp3')
        dst = os.path.join(out, name); shutil.copy(src, dst)
        r.success = True; r.generated_files = [dst]; r.errors = []; return r
class Session:
    def get_default_settings(self, mt): return {'prompt': '', 'seed': 0, 'resolution': '', 'video_length': 1, 'model_type': mt}
    def list_model_defs(self): return [{'model_type': 'z_image'}, {'model_type': 'yue2'}]
    def submit_task(self, settings): return Job(settings)
def init(root=None, output_dir=None, cli_args=None, console_output=True, **kw): return Session()
`);
  const png = path.join(ws, 'x.png'), mp3 = path.join(ws, 'x.mp3');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=64x64:d=1', '-frames:v', '1', png], { stdio: 'pipe' });
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-q:a', '5', mp3], { stdio: 'pipe' });
  const log = path.join(ws, 'calls.jsonl');
  Object.assign(process.env, { FAKE_PNG: png, FAKE_MP3: mp3, FAKE_LOG: log });

  const s = defaultSettings(ws);
  s.wan2gp = { root, python: py, cliArgs: ['--attention', 'sdpa'] };
  const executors = createExecutors({ workflowsDir: path.resolve(__dirname, '../../workflows'), toolsDir: path.resolve(__dirname, '../../tools') });
  const p = createProject(s, { name: 'W', idea: 'ideia', videoType: 'custom', routeId: 'shorts-autopilot', aspect: '9:16' });
  ops.addScene(s, p, null, { title: 'A', narration: 'Olá mundo', visualIntent: 'um gato astronauta', durationSec: 4 });
  ops.addScene(s, p, null, { title: 'B', narration: 'Falha', visualIntent: 'FAILME robô', durationSec: 4 });
  ops.saveProjectFile(s, p);
  const dir = path.join(ws, 'projects', p.id);
  const mk = (id: string, kind: RouteStep['kind'], template: string, scope: RouteStep['scope'] = 'scene'): Route => ({
    id: 'r', name: 'r', steps: [{ id, kind, label: id, scope, dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 60, bindings: [{ type: 'wan2gp', template }] }],
  } as unknown as Route);
  const ev: EngineEvent[] = [];
  const run = (route: Route, only?: { sceneIds?: string[] }) => runRoute({ project: p, route, projectDir: dir, signal: new AbortController().signal,
    deps: { settings: s, emit: (e: EngineEvent) => ev.push(e), sleep: async () => {}, executors }, only: only as never, noCache: true });

  // imagem da cena A
  const r1 = await run(mk('image', 'image', 'wan2gp-image.json'), { sceneIds: [p.scenes[0]!.id] });
  assert.equal(r1.ok, true, r1.error ?? '');
  assert.ok(fs.existsSync(path.join(dir, 'scenes', p.scenes[0]!.id, 'frames', 'frame.png')), 'frame.png copiado da saída do Wan2GP');
  const call = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]!);
  assert.equal(call.model_type, 'z_image');
  assert.ok(String(call.prompt).includes('gato astronauta'), 'prompt injetado');
  assert.match(String(call.resolution), /^\d+x\d+$/);
  assert.equal(call.video_length, 1);

  // música (projeto): usa wan2gp-music, grava out/music.mp3
  const r2 = await run(mk('music', 'music', 'wan2gp-music.json', 'project'));
  assert.equal(r2.ok, true, r2.error ?? '');
  assert.ok(fs.existsSync(path.join(dir, 'out', 'music.mp3')));
  const mcall = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop()!);
  assert.equal(mcall.model_type, 'yue2');
  assert.equal(mcall.duration_seconds, 10, 'duração da música limitada ao mínimo de 10 s para 8 s de cenas');

  // narração: a voz adicionada ao projeto vira clonagem (audio_guide + audio_prompt_type A)
  p.narrationVoice = { refAudio: mp3 };
  ops.saveProjectFile(s, p);
  const rn = await run(mk('narration', 'narration', 'wan2gp-tts.json'), { sceneIds: [p.scenes[0]!.id] });
  assert.equal(rn.ok, true, rn.error ?? '');
  const ncall = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop()!);
  assert.equal(ncall.model_type, 'omnivoice');
  assert.equal(ncall.audio_prompt_type, 'A', 'clonagem ativada');
  assert.equal(ncall.audio_guide, mp3, 'arquivo de voz do projeto enviado como referência');
  assert.equal(ncall.alt_prompt, '', 'voice design não briga com o timbre clonado');
  assert.ok(String(ncall.prompt).includes('Olá mundo'), 'texto da cena narrado');

  // erro do modelo vira falha legível
  const r3 = await run(mk('image', 'image', 'wan2gp-image.json'), { sceneIds: [p.scenes[1]!.id] });
  assert.equal(r3.ok, false);
  const failed = ev.filter((e) => e.t === 'step.failed') as Array<Extract<EngineEvent, { t: 'step.failed' }>>;
  assert.ok(failed.some((f) => f.reason.includes('boom do modelo')), 'mensagem do Wan2GP propagada');

  // wan2gp não configurado
  const s2 = { ...s, wan2gp: { root: '', python: py, cliArgs: [] } };
  const r4 = await runRoute({ project: p, route: mk('image', 'image', 'wan2gp-image.json'), projectDir: dir, signal: new AbortController().signal,
    deps: { settings: s2, emit: () => {}, sleep: async () => {}, executors }, only: { sceneIds: [p.scenes[0]!.id] }, noCache: true });
  assert.equal(r4.ok, false);

  // listar modelos / padrões
  const client = Wan2gpClient.get(s.wan2gp, path.resolve(__dirname, '../../tools/wan2gp_bridge.py'));
  assert.deepEqual(await client.models(), [{ model_type: 'z_image' }, { model_type: 'yue2' }]);
  assert.equal(((await client.defaults('yue2')) as { model_type: string }).model_type, 'yue2');
  Wan2gpClient.shutdownAll();
  console.log('wan2gp tests: OK');
}
main().catch((e) => { console.error(e); Wan2gpClient.shutdownAll(); process.exit(1); });
