import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { forceCartoon3dImports, cartoon3dScenePrompt, CARTOON3D_SKILL_ID, framingIssues, framingFixPrompt, storyboardFor, storyboardShots } from '../main/cartoon3d';
import { stageCartoon3d } from '../main/plugins';
import { buildPrompt } from '../main/prompts';
import { getRoute } from '../main/presets';
import { BUILTIN_SKILLS } from '../main/skills-builtin';
import { createProject, defaultSettings } from '../main/settings';
import type { ExecContext } from '../main/engine';

/** Curta cartoon 3D: skill + rota padrão, prompt da cena com a API local e import map sempre nos caminhos do projeto. */
async function main() {
  const skill = BUILTIN_SKILLS.find((k) => k.id === CARTOON3D_SKILL_ID);
  assert.ok(skill && skill.codeKit === 'cartoon3d' && skill.routeId === 'curta-cartoon-3d', 'skill padrão com o kit cartoon3d');
  const route = getRoute('curta-cartoon-3d');
  assert.ok(route && route.steps.some((s) => s.kind === 'code_scene') && route.steps.some((s) => s.kind === 'narration'), 'rota com cena por código e narração');
  assert.ok(fs.statSync(path.join('vendor', 'cartoon3d', 'cartoon3d.js')).size > 50_000, 'biblioteca compilada no vendor');

  /* import map: CDN do three vira "three"; caminhos locais sobrescrevem os errados; mantém outras entradas */
  const imports = { three: '../../plugins/_three/three.module.min.js', cartoon3d: '../../plugins/_cartoon3d/cartoon3d.js' };
  const page = '<html><head><script type="importmap">{"imports":{"three":"https://cdn.x/three.js","cartoon3d":"./errado.js","x":"./x.js"}}</script></head><body><script type="module">import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js"; import * as C from "cartoon3d";</script></body></html>';
  const fixed = forceCartoon3dImports(page, imports);
  const map = JSON.parse(/type="importmap">([\s\S]*?)<\/script>/.exec(fixed)![1]!);
  assert.deepEqual(map.imports, { ...imports, x: './x.js' });
  assert.match(fixed, /from "three"/);
  const bare = forceCartoon3dImports('<body><script type="module">import * as C from "cartoon3d";</script></body>', imports);
  assert.match(bare, /type="importmap"[\s\S]*cartoon3d[\s\S]*type="module"/, 'página sem import map ganha um antes do módulo');

  /* projeto com a skill: prompt da cena usa a API e o esqueleto; executor copia three + cartoon3d */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-c3d-'));
  const s = defaultSettings(ws);
  const p = createProject(s, { name: 'Lei seca', idea: 'a lei seca nos EUA', videoType: 'custom', skillId: CARTOON3D_SKILL_ID } as never);
  assert.equal(p.skill?.codeKit, 'cartoon3d');
  assert.equal(p.routeId, 'curta-cartoon-3d');
  const dir = path.join(ws, 'projects', p.id), sceneDir = path.join(dir, 'scenes', 's01');
  const scene = { id: 's01', index: 1, title: 'Gancho', narration: 'Em 1920 os EUA proibiram o álcool.', visualIntent: 'rua anos 20, barris', kind: 'code' as const, durationSec: 4, status: {}, artifacts: {} };
  p.scenes = [scene];
  const step = p.route!.steps.find((x) => x.kind === 'code_scene')!;
  const prompt = buildPrompt({ settings: s, project: p, projectDir: dir, sceneDir, scene, outDir: path.join(dir, 'out'), step, binding: step.bindings[0], signal: new AbortController().signal, log: () => {} } as unknown as ExecContext);
  assert.match(prompt, /import \* as C from "cartoon3d"/);
  assert.match(prompt, /st\.actor\(/);
  assert.match(prompt, /"cartoon3d":"\.\.\/\.\.\/\.\.\/plugins\/_cartoon3d\/cartoon3d\.js"/, 'caminho relativo à página da cena');
  assert.match(prompt, /1080x1920/);
  assert.doesNotMatch(prompt, /sem bibliotecas externas; Canvas 2D/, 'não manda o pedido 2D genérico');
  assert.match(cartoon3dScenePrompt({ file: 'x', exists: false, dur: 3, fps: 30, aspect: '16:9', imports, loops: true, sfx: '' }), /1920x1080[\s\S]*LOOP PERFEITO/);
  const staged = stageCartoon3d(dir, path.join(sceneDir, 'code'));
  assert.ok(staged && fs.existsSync(path.join(dir, 'plugins', '_cartoon3d', 'cartoon3d.js')) && fs.existsSync(path.join(dir, 'plugins', '_three', 'three.module.min.js')));
  assert.equal(staged.importmap.cartoon3d, '../../../plugins/_cartoon3d/cartoon3d.js');
  /* agente de enquadramento: entrada pela borda é permitida; rosto cortado, corte lateral e sumiço no meio não */
  const rep = (cols: number[][]) => ({ fps: 10, names: ['Frank', 'Capone'], frames: cols[0]!.map((_, f) => cols.map((c) => c[f]).join(',')) });
  const ok = Array(30).fill(0);
  assert.deepEqual(framingIssues(rep([[3, 3, 3, 3, 3, 3, 3, 2, 2, ...Array(21).fill(0)], ok])), [], 'entra pela borda no começo: ok');
  const iss = framingIssues(rep([[...Array(10).fill(0), ...Array(8).fill(3), ...Array(12).fill(0)], [...Array(5).fill(0), 1, 1, 1, 1, ...Array(21).fill(0)]]));
  assert.equal(iss.length, 2);
  assert.match(iss[0]!, /"Frank" sai do quadro de 1,0 s a 1,8 s/);
  assert.match(iss[1]!, /"Capone" com o ROSTO cortado/);
  assert.match(framingIssues(rep([ok, Array(30).fill(3)]))[0]!, /"Capone" .*NUNCA aparece/);
  assert.deepEqual(framingIssues(rep([ok, Array(30).fill(-1)])), [], 'escondido (visible:false) não conta');
  assert.match(framingFixPrompt('code/scene.html', iss), /AGENTE DE REVISÃO DE CENA[\s\S]*Frank[\s\S]*code\/scene\.html/);
  assert.match(framingFixPrompt('x', iss), /st\.poster\/st\.draw[\s\S]*g\.font/, 'correção cobre texto desenhado');
  assert.match(prompt, /g\.fillText[\s\S]*revisão de letreiros/, 'a cena sabe que o texto desenhado é revisado');
  assert.match(fs.readFileSync(path.join('vendor', 'cartoon3d', 'cartoon3d.js'), 'utf8'), /fillText[\s\S]*getImageData/, 'biblioteca mede o texto desenhado');
  /* revisão de cena: bloqueado (4), metade escondida (5), letreiro ilegível, cor brusca e troca de luz */
  const iss2 = framingIssues({ ...rep([[...Array(10).fill(0), ...Array(6).fill(4), ...Array(14).fill(0)], [...Array(12).fill(0), ...Array(8).fill(5), ...Array(10).fill(0)]]),
    signNames: ['SALOON', 'BAR'], signs: Array(30).fill(0).map((_, f) => `${f < 25 ? 1 : 0},${f < 5 ? -1 : 0}`),
    jumps: [{ f: 12, name: 'balcão', from: '#5a3a26', to: '#ff0000' }, { f: 14, name: 'balcão', from: '#ff0000', to: '#5a3a26' }, { f: 20, name: 'luz', from: 'day', to: 'night' }, { f: 0, name: 'x', from: '#000000', to: '#ffffff' }] });
  assert.match(iss2.join('\n'), /"Frank" BLOQUEADO de 1,0 s a 1,6 s/);
  assert.match(iss2.join('\n'), /"Capone" PELA METADE de 1,2 s a 2,0 s/);
  assert.match(iss2.join('\n'), /letreiro "SALOON" ILEGÍVEL .*letras pequenas/);
  assert.doesNotMatch(iss2.join('\n'), /"BAR"/, 'letreiro legível não é problema');
  assert.match(framingIssues({ ...rep([ok, ok]), signNames: ['SALOON'], signs: Array(30).fill('5') }).join('\n'), /"SALOON" ILEGÍVEL .*CORTADO pela borda/, 'letreiro cortado pela borda');  assert.match(iss2.join('\n'), /mudança BRUSCA de cor em balcão: #5a3a26 → #ff0000 .* \(2× na cena\)/);
  assert.match(iss2.join('\n'), /a LUZ troca de "day" para "night"/);
  assert.doesNotMatch(iss2.join('\n'), /em x:/, 'salto no 1º quadro (vindo da prévia) não conta');
  /* storyboard: etapa na rota antes do código, pedido com as cenas e o bloco certo de cada cena */
  const sbStep = route.steps.find((x) => x.id === 'storyboard');
  assert.ok(sbStep && sbStep.kind === 'asset_design' && route.steps.find((x) => x.kind === 'code_scene')!.dependsOn.includes('storyboard'), 'storyboard antes da cena');
  const sbPrompt = buildPrompt({ settings: s, project: p, projectDir: dir, outDir: path.join(dir, 'out'), step: sbStep, binding: sbStep.bindings[0], signal: new AbortController().signal, log: () => {} } as unknown as ExecContext);
  assert.match(sbPrompt, /STORYBOARD[\s\S]*## Personagens fixos[\s\S]*## Paleta de materiais[\s\S]*### s01 — Gancho/);
  assert.match(sbPrompt, /BLOQUEADO nem PELA METADE[\s\S]*LETREIROS LEGÍVEIS/);
  assert.match(sbPrompt, /C\.OUTFITS\.police[\s\S]*INCONFUNDÍVEL/, 'storyboard só com roupas que existem');
  const md = '# x\n## Personagens fixos\n- **Frank**: C.OUTFITS.police, seed 2\n## Paleta de materiais\n- balcão: #5a3a26\n## Storyboard\n### s01 — Gancho\n- 0,0–2,5 s | PLANO GERAL | câmera ...\n- 2,5–4,0 s | CLOSE | ...\n### s02 — Virada\n- 0–3 s | MÉDIO\n';
  const b1 = storyboardFor(md, 's01', 1);
  assert.match(b1, /PLANO GERAL[\s\S]*CLOSE[\s\S]*Frank[\s\S]*#5a3a26/);
  assert.doesNotMatch(b1, /MÉDIO/, 'só os planos desta cena');
  assert.deepEqual(storyboardShots(b1).map((x) => [x.a, x.b]), [[0, 2.5], [2.5, 4]]);
  assert.match(storyboardFor(md.replace('### s02', '### 2'), 'sX', 2), /MÉDIO/, 'acha a cena pelo número');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true }); fs.writeFileSync(path.join(dir, 'assets', 'assets.md'), md);
  assert.match(buildPrompt({ settings: s, project: p, projectDir: dir, sceneDir, scene, outDir: path.join(dir, 'out'), step, binding: step.bindings[0], signal: new AbortController().signal, log: () => {} } as unknown as ExecContext), /STORYBOARD DESTA CENA[\s\S]*PLANO GERAL/, 'a cena recebe o storyboard');
  console.log('cartoon3d tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
