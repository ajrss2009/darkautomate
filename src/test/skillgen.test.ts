import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defaultSettings } from '../main/settings';
import { generateSkillFromVideos } from '../main/skillgen';
import { getSkill } from '../main/library';

/** Skill a partir de vídeos: quadros-chave, prompt com ângulos/rotas, validação e nome único (provedor falso). */
async function main() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('bash', ['--version'], { stdio: 'ignore' }); } catch { console.log('(sem ffmpeg/bash: teste pulado)'); return; }
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-skillgen-'));
  const s = defaultSettings(ws);
  s.whisper = { python: 'python-que-nao-existe', model: 'tiny', device: 'cpu', autoInstall: false };
  const video = path.join(ws, 'ref.mp4');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:d=6:r=24', '-pix_fmt', 'yuv420p', video], { stdio: 'ignore' });
  // provedor falso: guarda o prompt e grava uma skill com nome repetido e rota inexistente
  const fake = path.join(ws, 'fake.sh');
  fs.writeFileSync(fake, `#!/bin/sh
cat > ../../prompt.txt
ls frames > ../../frames.txt
cat > skill.md <<'EOT'
---
name: Stickman
description: "Explicativo com bonecos e ritmo rápido."
appearance: stickman
routeId: rota-que-nao-existe
routeReason: "cenas desenhadas por código"
aspect: "9:16"
durationSec: 60
scriptEnding: loop
reviewCriteria: "gancho em 2 s; texto grande"
outputStyle: |-
  🎨 Visual: bonecos
---

## Global

Tom bem-humorado, ângulo de mitos e verdades.

## Etapa: script

Abra com um mito.
EOT
echo ok
`, { mode: 0o755 });
  s.harnesses.claude = { command: 'bash', args: [fake.replace(/\\/g, '/')], promptVia: 'stdin', models: [] };
  const logs: string[] = [];
  const r = await generateSkillFromVideos(s, { links: [], files: [video], angles: ['mitos', 'humor'], angleNote: 'para leigos', harness: 'claude', language: 'pt-BR', framesPerVideo: 4 },
    path.resolve(__dirname, '../../tools'), (l) => logs.push(l));
  const prompt = fs.readFileSync(path.join(ws, 'prompt.txt'), 'utf8');
  assert.match(prompt, /Mitos e verdades/); assert.match(prompt, /Humor \/ sátira/); assert.match(prompt, /para leigos/);
  assert.match(prompt, /frames\/video1_01_/, 'quadros-chave listados no prompt');
  assert.match(prompt, /stickman-explainer/, 'rotas disponíveis no prompt');
  assert.equal(fs.readFileSync(path.join(ws, 'frames.txt'), 'utf8').trim().split(/\r?\n/).length, 4, 'o provedor viu 4 quadros');
  assert.match(prompt, /não baixe nada/);
  assert.ok(!fs.existsSync(r.workdir), 'arquivos baixados/extraídos apagados ao criar a skill');
  assert.equal(r.skill.name, 'Stickman (2)', 'nome único (já existe a skill padrão "Stickman")');
  assert.equal(r.routeId, 'stickman-explainer', 'rota inválida → rota padrão da aparência');
  assert.ok(r.warnings.some((w) => /não existe/.test(w)));
  assert.equal(r.routeReason, 'cenas desenhadas por código');
  const saved = getSkill(s, r.skill.id)!;
  assert.equal(saved.scriptEnding, 'loop'); assert.equal(saved.aspect, '9:16');
  assert.match(saved.outputStyle ?? '', /Criada a partir de: ref\.mp4 · ângulo: Mitos e verdades, Humor/);
  assert.ok(saved.previewMedia && fs.existsSync(saved.previewMedia), 'exemplo visual = quadro do vídeo');
  await assert.rejects(() => generateSkillFromVideos(s, { links: ['nao-e-link'], angles: [], harness: 'claude' }, '', () => {}), /ao menos um link/);

  console.log('skill-from-videos tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
