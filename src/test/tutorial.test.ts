import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Project } from '../shared/types';
import { attachmentsText, ensureAttachmentTranscripts, transcriptsDir } from '../main/attachments';
import { BUILTIN_SKILLS } from '../main/skills-builtin';

/** Skill padrão de tutorial: vídeos anexados viram clipes sem narração, com transcrição e trecho (clipStart). */
async function main() {
  /* 1. a skill padrão existe e ensina o contrato: clipe + motion graphics + silêncio no clipe */
  const sk = BUILTIN_SKILLS.find((s) => s.id === 'tutorial-clipes');
  assert.ok(sk, 'skill tutorial-clipes registrada');
  assert.match(sk!.steps['script']!, /\[CLIPE:/, 'roteiro marca os trechos de clipe');
  assert.match(sk!.steps['script']!, /descrev|indica|relação|correspond/i, 'narração indica o que ocorre na tela');
  assert.match(sk!.steps['scene_plan']!, /clipStart/, 'plano escolhe o trecho do vídeo');
  assert.match(sk!.steps['scene_plan']!, /TODA cena de clipe tem narração/i, 'clipe é narrado (o áudio original não é usado)');
  assert.match(sk!.steps['scene_plan']!, /OBS/, 'regra: retirar o OBS da tela');
  assert.match(sk!.steps['scene_plan']!, /clipCrop/, 'recorte do rodapé/OBS');
  assert.match(sk!.steps['scene_plan']!, /100%|contíguos/i, 'clipes usados por completo');
  assert.match(sk!.steps['scene_plan']!, /motion.*2–4 s|2–4 s/i, 'motion graphics curto');
  assert.match(sk!.steps['motion_graphics']!, /motion graphics/i);
  assert.equal(sk!.routeId, 'shorts-autopilot');

  /* 2. o prompt do plano de cenas pede clipStart + silêncio quando há vídeo anexado, e traz a transcrição com tempos */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tutorial-'));
  const dir = path.join(ws, 'proj');
  fs.mkdirSync(path.join(dir, 'assets', 'user', 'transcripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'user', 'sheets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'user', 'demo.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'assets', 'user', 'transcripts', 'demo.txt'), '0.00s–2.00s: abra o painel\n2.00s–4.00s: clique em salvar');
  fs.writeFileSync(path.join(dir, 'assets', 'user', 'sheets', 'demo-01.jpg'), 'x');
  fs.writeFileSync(path.join(dir, 'assets', 'user', 'sheets', 'demo.json'), JSON.stringify([{ file: 'demo-01.jpg', from: 0, to: 360 }]));
  const p = { attachments: [{ file: 'demo.mp4', kind: 'video', use: 'scene' }] } as unknown as Project;
  const txt = attachmentsText(p, dir, 'scene_plan');
  assert.match(txt, /"userMedia"/);
  assert.match(txt, /"clipStart"/);
  assert.match(txt, /manualDuration/);
  assert.match(txt, /TODA cena de clipe tem narração/i);
  assert.match(txt, /transcrição de "demo\.mp4"/);
  assert.match(txt, /2\.00s–4\.00s: clique em salvar/);
  assert.match(txt, /FOLHAS DE QUADROS/, 'lista as folhas de quadros do vídeo');
  assert.match(txt, /demo-01\.jpg/);
  assert.match(txt, /clipCrop/, 'recorte do OBS/rodapé');
  assert.match(txt, /OBS/);

  /* 3. transcrição é idempotente: com o resumo já gravado, não chama o Whisper de novo */
  const done = await ensureAttachmentTranscripts({ settings: {} as never, project: p, projectDir: dir, toolsDir: dir, log: () => {} });
  assert.equal(done, 0, 'já transcrito: nada a fazer');
  assert.ok(fs.existsSync(path.join(transcriptsDir(dir), 'demo.txt')));

  fs.rmSync(ws, { recursive: true, force: true });
  console.log('tutorial (clipes + narração) tests: OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
