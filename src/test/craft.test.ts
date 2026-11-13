import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProject, defaultSettings } from '../main/settings';
import { updateProject } from '../main/ops';
import * as lib from '../main/library';
import { importClaudeSkill, mapSkillSteps } from '../main/skill-import';
import { titleStructure, youtubeVideoId } from '../main/youtube-craft';
import { importedScript } from '../main/executors';
import { buildPrompt } from '../main/prompts';
import type { ExecContext } from '../main/engine';
import type { Settings } from '../shared/types';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-craft-'));
  const s: Settings = defaultSettings(ws);
  const bundled = path.join(__dirname, '..', '..', 'plugins-bundled');

  // ───────── SKILL.md do Claude (com sub-skills) → plugin + skill + rota
  const r = await importClaudeSkill(s, { source: path.join(bundled, 'youtube'), name: 'YouTube Creator', routeId: 'explainer-mixed' }, () => {});
  assert.equal(r.plugin.id, 'youtube');
  assert.equal(r.skills.length, 1);
  const k = r.skills[0]!;
  assert.equal(k.name, 'YouTube Creator');
  assert.deepEqual(k.plugins, ['youtube'], 'skill ligada ao plugin');
  for (const step of ['script', 'thumbnail', 'metadata', 'ideation']) assert.ok(k.steps[step], `etapa ${step} aponta para uma sub-skill`);
  assert.match(k.steps['thumbnail']!, /sub-skills\/thumbnail\.md/);
  assert.match(k.global, /nunca faça perguntas/, 'execução sem usuário');
  const route = lib.getAnyRoute(s, r.routes[0]!.id)!;
  assert.ok(route && !('builtin' in route && route.builtin), 'rota própria criada');
  assert.equal(k.routeId, route.id);
  /* o campo plugins sobrevive ao Markdown da skill */
  assert.deepEqual(lib.getSkill(s, k.id)!.plugins, ['youtube']);
  /* projeto com a skill recebe o plugin sem escolher nada */
  const p = createProject(s, { name: 'Teste', idea: 'como economizar energia', videoType: 'custom', skillId: k.id, routeId: route.id });
  assert.ok(p.plugins?.includes('youtube'), 'plugin da skill aplicado ao projeto');

  // ───────── SKILL.md solto (um arquivo só) vira plugin embrulhado
  const loose = path.join(ws, 'minha-skill');
  fs.mkdirSync(loose, { recursive: true });
  fs.writeFileSync(path.join(loose, 'SKILL.md'), '---\nname: canal-curiosidades\ndescription: Vídeos curtos de curiosidades com gancho forte.\n---\n# Curiosidades\n\n## Roteiro\nAbra com uma pergunta absurda e responda em 3 fatos.\n\n## Thumbnail\nUm objeto gigante e no máximo 2 palavras.\n');
  const r2 = await importClaudeSkill(s, { source: path.join(loose, 'SKILL.md') }, () => {});
  assert.equal(r2.plugin.id, 'canal-curiosidades');
  assert.match(r2.skills[0]!.steps['script'] ?? '', /pergunta absurda/, 'seção do SKILL.md vira a etapa');
  assert.match(r2.skills[0]!.steps['thumbnail'] ?? '', /objeto gigante/);
  assert.deepEqual(Object.keys(mapSkillSteps(loose, 'x')).sort(), ['script', 'thumbnail']);

  // ───────── estrutura dos títulos (sem IA)
  const st = titleStructure([
    { title: '7 Hábitos Que Destroem Seu Dinheiro (e como evitar)', views: 900_000 },
    { title: 'Por que RICOS nunca pagam à vista?', views: 2_000_000 },
    { title: '5 Erros Que Me Fizeram Perder R$10 mil | Finanças', views: 300_000 },
  ]);
  assert.equal(st.count, 3);
  assert.equal(st.numbers, 67);
  assert.equal(st.questions, 33);
  assert.equal(st.examples[0], 'Por que RICOS nunca pagam à vista?', 'mais visto primeiro');
  assert.ok(st.allCapsWord > 0 && st.brackets > 0 && st.separators > 0);
  assert.equal(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=3'), 'dQw4w9WgXcQ');
  assert.equal(youtubeVideoId('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');

  // ───────── roteiro importado "como está": a etapa de roteiro não usa IA
  const dir = path.join(ws, 'proj');
  const refTxt = path.join(dir, 'reference', 'script-ref.txt');
  fs.mkdirSync(path.dirname(refTxt), { recursive: true });
  fs.writeFileSync(refTxt, 'Este é o meu roteiro.\nCada palavra fica.');
  const proj = { ...p, refScript: { file: refTxt, textFile: refTxt, useAsScript: true } };
  const ctx = { project: proj, step: { id: 'script', kind: 'script', label: '', scope: 'project', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 60, bindings: [] },
    projectDir: dir, outDir: path.join(dir, 'out'), settings: s, log: () => {}, signal: new AbortController().signal } as unknown as ExecContext;
  const res = importedScript(ctx)!;
  assert.ok(res, 'roteiro importado usado');
  assert.equal(fs.readFileSync(path.join(dir, 'script.md'), 'utf8').trim(), 'Este é o meu roteiro.\nCada palavra fica.');
  assert.equal(importedScript({ ...ctx, project: { ...proj, refScript: { ...proj.refScript, useAsScript: false } } } as ExecContext), undefined, 'só modelo de estilo: segue para a IA');
  const planPrompt = buildPrompt({ ...ctx, step: { ...ctx.step, id: 'scene_plan', kind: 'scene_plan' } } as ExecContext);
  assert.match(planPrompt, /EXATAMENTE como está/, 'plano de cenas mantém a fala literal');

  // ───────── título escolhido guia o SEO e a thumbnail
  const titled = { ...p, titleModel: { source: 'canal X', pattern: '[número] + [erro] | [tema]', chosen: '5 Erros Que Custam Caro', thumbText: 'NÃO FAÇA' } };
  const meta = buildPrompt({ ...ctx, project: titled, step: { ...ctx.step, id: 'metadata', kind: 'metadata' } } as ExecContext);
  assert.match(meta, /TÍTULO ESCOLHIDO PELO USUÁRIO: "5 Erros Que Custam Caro"/);
  assert.match(meta, /primeiros ~45 caracteres/, 'regras de CTR no SEO');

  // ───────── legendas: projeto novo não gera; a cena não escreve a fala; a revisão não cobra
  const fresh = createProject(s, { name: 'Leg', idea: 'x', videoType: 'custom', routeId: 'explainer-mixed' });
  assert.equal(fresh.subtitles, 'off', 'padrão: sem legendas');
  assert.equal(fresh.subtitleStyle?.burn, false);
  assert.equal(createProject(s, { name: 'Leg2', idea: 'x', videoType: 'custom', routeId: 'explainer-mixed', subtitles: 'burn' }).subtitleStyle?.burn, true, 'gravar no vídeo liga o burn');
  /* fonte e estilo escolhidos já na criação; o editor troca depois e o nome é sanitizado (vai para o ASS) */
  const styled = createProject(s, { name: 'Leg3', idea: 'x', videoType: 'custom', routeId: 'explainer-mixed', subtitles: 'burn', subtitleFont: 'Impact', subtitleKind: 'karaoke' });
  assert.equal(styled.subtitleStyle?.font, 'Impact');
  assert.equal(styled.subtitleStyle?.kind, 'karaoke');
  assert.equal(styled.subtitleStyle?.box, false, 'estilo escolhido manda no box');
  assert.equal(createProject(s, { name: 'Leg4', idea: 'x', videoType: 'custom', routeId: 'explainer-mixed', subtitles: 'srt' }).subtitleStyle?.font, undefined, 'sem escolha: fonte padrão do tipo');
  assert.equal(updateProject(s, styled.id, { subtitleStyle: { ...styled.subtitleStyle!, font: 'Arial,Black{1}' } }).subtitleStyle?.font, 'ArialBlack1', 'nome da fonte sem vírgulas/chaves');
  const scene = { id: 's01', index: 1, title: 't', narration: 'olá mundo', visualIntent: 'v', kind: 'code' as const, durationSec: 4, status: {}, artifacts: {} };
  const codeCtx = { ...ctx, project: { ...fresh, scenes: [scene] }, scene, sceneDir: path.join(dir, 'scenes', 's01'), step: { ...ctx.step, id: 'code_scene', kind: 'code_scene', scope: 'scene' } } as unknown as ExecContext;
  assert.match(buildPrompt(codeCtx), /NÃO escreva na tela o texto que está sendo narrado/);
  const legacy = { ...codeCtx, project: { ...codeCtx.project, subtitles: undefined } } as unknown as ExecContext;
  assert.doesNotMatch(buildPrompt(legacy), /NÃO escreva na tela o texto/, 'projetos antigos: sem mudança');
  const { createExecutors } = await import('../main/executors');
  const srtDir = path.join(dir, 'out'); fs.mkdirSync(srtDir, { recursive: true }); fs.writeFileSync(path.join(srtDir, 'subtitles.srt'), 'velho');
  const subRes = await createExecutors({ workflowsDir: '' }).builtin({ ...ctx, project: fresh, binding: { type: 'builtin', tool: 'subtitles' }, step: { ...ctx.step, id: 'subtitles', kind: 'subtitles' } } as unknown as ExecContext);
  assert.deepEqual(subRes.files, [], 'legendas desligadas: nenhum .srt');
  assert.ok(!fs.existsSync(path.join(srtDir, 'subtitles.srt')), '.srt antigo removido (o vídeo final sai sem legenda)');
  /* no motor: a etapa de legendas é pulada e a produção segue (não vira "nenhum artefato produzido") */
  const { runRoute } = await import('../main/engine');
  const subStep = { id: 'subtitles', kind: 'subtitles', label: 'Legendas', scope: 'project', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 30, bindings: [{ type: 'builtin', tool: 'subtitles' }] } as never;
  const evs: Array<{ t: string; reason?: string }> = [];
  const rr = await runRoute({ project: { ...fresh, scenes: [] }, route: { id: 'r', name: 'r', description: '', videoTypes: [], steps: [subStep] }, projectDir: path.join(ws, 'pr-off'), signal: new AbortController().signal, noCache: true,
    deps: { settings: s, emit: (e) => evs.push(e as never), executors: createExecutors({ workflowsDir: '' }) } });
  assert.ok(rr.ok, rr.error);
  assert.ok(evs.some((e) => e.t === 'step.skipped' && /legendas desligadas/.test(e.reason ?? '')), 'etapa pulada com motivo');

  fs.rmSync(ws, { recursive: true, force: true });
  console.log('craft (SKILL.md import, títulos, roteiro importado) tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
