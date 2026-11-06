import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VIDEO_TYPES, ROUTES } from '../main/presets';
import { listSkills, getSkill } from '../main/library';
import { assertSkillAndRoute, createProject, defaultSettings, listProjects, projectsDir } from '../main/settings';
import { buildPrompt, userStyles, visualPrompt } from '../main/prompts';
import type { ExecContext } from '../main/engine';

function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-skills-'));
  const s = defaultSettings(ws);

  // 1. cada tipo de vídeo tem uma skill padrão completa
  const skills = listSkills(s);
  for (const v of VIDEO_TYPES) {
    const k = skills.find((x) => x.id === v.id);
    assert.ok(k, `skill para o tipo ${v.id}`);
    assert.equal(k!.builtin, true);
    assert.equal(k!.appearance, v.id);
    assert.ok(k!.outputStyle && k!.outputStyle.length > 40, `estilo de saída de ${v.id}`);
    assert.ok(k!.global.length > 20 && k!.description.length > 5);
    assert.ok(ROUTES.some((r) => r.id === k!.routeId), `rota sugerida de ${v.id} existe`);
    assert.ok(k!.steps['script'] && k!.steps['scene_plan'] && k!.steps['thumbnail']);
  }
  assert.ok(getSkill(s, 'explicativo-codigo')?.outputStyle, 'skills originais também têm estilo de saída');
  assert.equal(new Set(skills.map((x) => x.id)).size, skills.length, 'ids únicos');

  // 1b. clipe musical em loop com código: skill + rota dedicada
  const codeClip = getSkill(s, 'clipe-musical-loop-codigo');
  assert.ok(codeClip, 'skill do clipe musical em loop com código existe');
  assert.equal(codeClip!.routeId, 'clipe-musical-loop-codigo');
  const codeRoute = ROUTES.find((r) => r.id === 'clipe-musical-loop-codigo');
  assert.ok(codeRoute, 'rota do clipe musical em loop com código existe');
  assert.ok(codeRoute!.steps.some((x) => x.kind === 'code_scene'), 'rota usa cena por código');
  assert.ok(!codeRoute!.steps.some((x) => x.kind === 'image' || x.kind === 'video'), 'rota não usa imagem/vídeo por IA');
  assert.ok(codeRoute!.steps.some((x) => x.kind === 'edit' && x.bindings.some((b) => b.type === 'builtin' && b.tool === 'clip-musical')), 'rota monta o clipe musical');
  const codeProject = createProject(s, { name: 'Loop código', idea: 'cidade à noite', videoType: 'custom', skillId: 'clipe-musical-loop-codigo', routeId: 'clipe-musical-loop-codigo', musicStyle: 'lo-fi', musicMode: 'instrumental' });
  const planStep = codeProject.route!.steps.find((x) => x.kind === 'scene_plan')!;
  const planPrompt = buildPrompt({ project: codeProject, projectDir: path.join(ws, 'projects', codeProject.id), outDir: path.join(ws, 'projects', codeProject.id, 'out'), step: planStep, binding: planStep.bindings[0]!, settings: s, signal: new AbortController().signal, log: () => {} } as ExecContext);
  assert.match(planPrompt, /kind "code"/);
  assert.doesNotMatch(planPrompt, /MiniMax H3 image-to-video/);

  // 2. skill + rota são obrigatórias na interface
  assert.throws(() => assertSkillAndRoute({ routeId: 'shorts-autopilot' }), /skill/i);
  assert.throws(() => assertSkillAndRoute({ skillId: 'stickman' }), /rota/i);
  assert.doesNotThrow(() => assertSkillAndRoute({ skillId: 'stickman', routeId: 'shorts-autopilot' }));

  // 3. projeto criado com skill: padrões vêm da skill; estilos opcionais são guardados
  const p = createProject(s, { name: 'Boneco', idea: 'Como funciona a vacina', videoType: 'custom', skillId: 'stickman', routeId: 'stickman-explainer',
    scriptStyle: '  tom bem-humorado  ', videoStyle: 'traço grosso azul' });
  assert.equal(p.skillId, 'stickman');
  assert.equal(p.skill?.id, 'stickman');
  assert.equal(p.videoType, 'stickman');
  assert.equal(p.aspect, '9:16');
  assert.equal(p.routeId, 'stickman-explainer');
  assert.equal(p.scriptStyle, 'tom bem-humorado');
  assert.equal(p.videoStyle, 'traço grosso azul');
  const q = createProject(s, { name: 'Sem estilos', idea: 'x', videoType: 'custom', skillId: 'vector', routeId: 'explainer-mixed', scriptStyle: '  ', videoStyle: '' });
  assert.equal(q.scriptStyle, undefined);
  assert.equal(q.videoStyle, undefined);
  assert.equal(q.presentation, 'mixed');

  // 4. estilos entram nos prompts (com prioridade sobre a skill)
  assert.match(userStyles(p), /ESTILO DE ROTEIRO[^\n]*tom bem-humorado/);
  assert.match(userStyles(p), /ESTILO DE VÍDEO[^\n]*traço grosso azul/);
  assert.equal(userStyles(q), '');
  const ctx = { project: p, scene: { visualIntent: 'um boneco acena', index: 1 } } as unknown as ExecContext;
  assert.match(visualPrompt(ctx), /traço grosso azul/);

  // 5. projetos ficam sempre na subpasta "projects" do workspace
  assert.equal(projectsDir(s), path.join(ws, 'projects'));
  assert.ok(fs.existsSync(path.join(ws, 'projects', p.id, 'project.json')));
  assert.equal(listProjects(s).length, 3);

  console.log('skills tests: OK');
}
try { main(); } catch (e) { console.error(e); process.exit(1); }
