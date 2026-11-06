import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Binding, Project, Route } from '../shared/types';
import { ROUTES, VIDEO_TYPES, applyQuality } from '../main/presets';
import { listSkills, validateRoute } from '../main/library';
import { createProject, defaultSettings } from '../main/settings';
import { buildPrompt, isMusicClip, scriptEnding, thumbnailPrompt } from '../main/prompts';
import { createExecutors, parseLyricScript, timeLyrics } from '../main/executors';
import { runRoute, type ExecContext } from '../main/engine';
import { BUILTIN_PROFILES, applyExecutorProfile, balanceRoles, downstreamSteps, setStepHead, stepTargets } from '../shared/profiles';
import { checkSkillRoute, producibleKinds } from '../shared/compat';

/** Coerência entre skills, rotas, perfis de executores e os prompts que o app monta. */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-routes-'));
  const s = defaultSettings(ws);
  const skills = listSkills(s);
  const ctx = (p: Project, stepId: string): ExecContext => {
    const step = p.route!.steps.find((x) => x.id === stepId)!;
    return { project: p, projectDir: path.join(ws, 'p'), outDir: path.join(ws, 'p', 'out'), step, binding: step.bindings[0]!, settings: s, signal: new AbortController().signal, log: () => {} };
  };

  // 1. todas as rotas padrão são válidas e as skills apontam para rotas que produzem o que pedem
  for (const r of ROUTES) assert.deepEqual(validateRoute(r), [], `rota ${r.id} válida`);
  for (const v of VIDEO_TYPES) {
    const k = skills.find((x) => x.id === v.id)!;
    const r = ROUTES.find((x) => x.id === k.routeId)!;
    const rep = checkSkillRoute(k, r, v.sceneKind, r);
    assert.deepEqual(rep.errors, [], `skill ${v.id} × rota ${r.id}: sem erros`);
    assert.deepEqual(rep.warnings, [], `skill ${v.id} × rota ${r.id}: sem avisos (${rep.warnings.join(' | ')})`);
    if (r.videoTypes.length) assert.ok(r.videoTypes.includes(v.id), `rota ${r.id} lista o tipo ${v.id}`);
  }
  for (const k of skills.filter((x) => x.routeId)) {
    const r = ROUTES.find((x) => x.id === k.routeId)!;
    assert.deepEqual(checkSkillRoute(k, r, undefined, r).errors, [], `skill ${k.id}: rota sugerida compatível`);
  }
  // incoerências antigas não voltam
  assert.ok(producibleKinds(ROUTES.find((r) => r.id === 'documentario-3d')).has('stock'), 'documentário 3D tem banco de mídia');
  const shorts = ROUTES.find((r) => r.id === 'shorts-autopilot')!;
  assert.deepEqual(shorts.steps.find((x) => x.id === 'image')!.onlySceneKinds, ['image', 'video'], 'imagem só para cenas de imagem/vídeo');
  const code3d = skills.find((x) => x.id === 'code_3d')!;
  assert.ok(!/three\.js/i.test(code3d.steps['scene_plan'] ?? ''), 'code_3d não pede Three.js');
  assert.equal(skills.find((x) => x.id === 'micro_drama')!.multiVoice, true);

  // 2. detecção da skill × rota errada
  const vox = skills.find((x) => x.id === 'vox_collage')!;
  assert.ok(checkSkillRoute(vox, shorts, 'mixed').warnings.length > 0, 'vox (misto) numa rota sem banco gera aviso');
  const clip = skills.find((x) => x.id === 'clipe-musical-loop')!;
  assert.ok(checkSkillRoute(clip, shorts, undefined, ROUTES.find((r) => r.id === 'clipe-musical-loop')).errors.length > 0, 'clipe musical exige rota de clipe');

  // 3. musicMode não transforma mais qualquer projeto em clipe musical
  const p = createProject(s, { name: 'Explica', idea: 'GPS', videoType: 'custom', skillId: 'whiteboard', routeId: 'stickman-explainer', musicMode: 'instrumental', musicStyle: 'lo-fi', waveform: 'line' });
  assert.equal(p.musicMode, undefined, 'campos de música descartados fora de rotas de música');
  assert.equal(isMusicClip(p), false);
  p.scenes = [{ id: 's01', index: 1, title: 'A', narration: 'O satélite envia o sinal', visualIntent: 'satélite', kind: 'code', durationSec: 5, status: {}, artifacts: {} }];
  const codePrompt = buildPrompt({ ...ctx(p, 'code_scene'), sceneDir: path.join(ws, 'p', 'scenes', 's01') });
  assert.match(codePrompt, /CENA LINEAR/, 'explicativo: cena por código linear (sem loop forçado)');
  assert.doesNotMatch(codePrompt, /LOOP PERFEITO/);
  assert.doesNotMatch(buildPrompt(ctx(p, 'script')), /loop com o início/, 'whiteboard 16:9 termina com conclusão');
  assert.equal(scriptEnding(p), 'conclusion');
  const mc = createProject(s, { name: 'Loop', idea: 'chuva', videoType: 'custom', skillId: 'clipe-musical-loop-codigo', routeId: 'clipe-musical-loop-codigo', musicMode: 'instrumental' });
  assert.equal(isMusicClip(mc), true);
  mc.scenes = [{ id: 's01', index: 1, title: 'L', narration: '', visualIntent: 'chuva', kind: 'code', durationSec: 12, status: {}, artifacts: {} }];
  assert.match(buildPrompt({ ...ctx(mc, 'code_scene'), sceneDir: path.join(ws, 'p', 'scenes', 's01') }), /LOOP PERFEITO/, 'clipe musical mantém o loop');
  assert.match(buildPrompt(ctx(mc, 'scene_plan')), /EXATAMENTE 1 cena de 12 s/, 'duração do loop vem da montagem (12 s), não do total');
  const sh = createProject(s, { name: 'Short', idea: 'x', videoType: 'custom', skillId: 'shorts-viral', routeId: 'shorts-autopilot' });
  assert.match(buildPrompt(ctx(sh, 'script')), /emende com o início/, 'shorts terminam em loop');

  // 4. revisão genérica (sem critérios de GTA) e critérios da skill
  const q = createProject(s, { name: 'Rev', idea: 'x', videoType: 'custom', skillId: 'shorts-viral', routeId: 'shorts-autopilot', quality: 'verified' });
  const rv = q.route!.steps.find((x) => x.kind === 'review');
  assert.ok(rv, 'verified adiciona revisão');
  const rp = buildPrompt(ctx(q, 'review'));
  assert.doesNotMatch(rp, /GTA/);
  assert.match(rp, /1080x1920/);
  assert.match(rp, /CRITÉRIOS DA SKILL/);
  const u = applyQuality(ROUTES.find((r) => r.id === 'stickman-explainer')!, 'ultra');
  assert.equal((u.steps.find((x) => x.kind === 'review')!.params as Record<string, unknown>)['autoFix'], true, 'ultra corrige sozinho');
  assert.ok(!applyQuality(ROUTES.find((r) => r.id === 'clipe-musical-loop')!, 'verified').steps.some((x) => x.kind === 'review'), 'clipe musical sem revisão de narração');

  // 5. perfis de executores: trocam o principal, mantêm a rota como reserva e respeitam loops/ferramentas
  const ag = BUILTIN_PROFILES.find((x) => x.id === 'antigravity-comfy')!;
  const r1 = applyExecutorProfile(ROUTES.find((r) => r.id === 'clipe-musical-loop')!, ag);
  assert.equal((r1.steps.find((x) => x.id === 'script')!.bindings[0] as Extract<Binding, { type: 'harness' }>).harness, 'antigravity');
  assert.match((r1.steps.find((x) => x.id === 'video')!.bindings[0] as Extract<Binding, { type: 'comfyui' }>).workflow, /perfect-loop/, 'loop perfeito não é trocado');
  assert.equal(r1.steps.find((x) => x.id === 'edit')!.bindings[0]!.type, 'builtin', 'ferramenta interna não é trocada');
  const r2 = applyExecutorProfile(ROUTES.find((r) => r.id === 'stickman-explainer')!, BUILTIN_PROFILES.find((x) => x.id === 'local-ollama')!);
  const cs = r2.steps.find((x) => x.id === 'code_scene')!.bindings;
  assert.equal((cs[0] as Extract<Binding, { type: 'harness' }>).harness, 'ollama');
  assert.ok(cs.some((b) => b.type === 'api'), 'executores da rota ficam como reserva');
  const withProf = createProject(s, { name: 'Prof', idea: 'x', videoType: 'custom', skillId: 'stickman', routeId: 'stickman-explainer', executorProfile: 'claude-comfy' });
  assert.equal((withProf.route!.steps.find((x) => x.id === 'script')!.bindings[0] as Extract<Binding, { type: 'harness' }>).harness, 'claude');
  assert.throws(() => createProject(s, { name: 'X', idea: 'x', videoType: 'custom', skillId: 'stickman', routeId: 'stickman-explainer', executorProfile: 'nao-existe' }), /Perfil/);

  // 6. microdrama: elenco e "speaker" no plano de cenas
  const md = createProject(s, { name: 'Drama', idea: 'traição', videoType: 'custom', skillId: 'micro_drama', routeId: 'microdrama-vozes', cast: [{ speaker: 'Ana', voice: 'nova', description: 'mulher, casaco vermelho' }, { speaker: ' ' }] });
  assert.equal(md.cast?.length, 1, 'personagem sem nome descartado');
  assert.match(buildPrompt(ctx(md, 'scene_plan')), /"speaker"/);
  assert.match(buildPrompt(ctx(md, 'script')), /NOME: fala/);

  // 7. lyric video: letra → tempos dos versos → tempos por cena
  const parsed = parseLyricScript('TITLE: Noite\nSTYLE: synthpop\nLYRICS:\n[verse]\nluz na cidade\nchuva no chão\n\n[chorus]\nnoite sem fim\nnoite sem fim\nVISUAL: neon');
  assert.equal(parsed.title, 'Noite');
  assert.deepEqual(parsed.blocks.map((b) => b.label), ['verse', 'chorus']);
  const tl = timeLyrics(parsed.blocks, 40);
  assert.equal(tl.length, 2);
  assert.ok(tl[0]!.start < tl[1]!.start && tl[1]!.end <= 40);
  const ly = createProject(s, { name: 'Lyric', idea: 'neon', videoType: 'custom', skillId: 'music_lyric', routeId: 'lyric-video', targetDurationSec: 40, musicStyle: 'synthpop' });
  assert.equal(ly.musicStyle, 'synthpop', 'lyric video guarda o estilo musical');
  const ldir = path.join(ws, 'projects', ly.id);
  fs.mkdirSync(path.join(ldir, 'out'), { recursive: true });
  fs.writeFileSync(path.join(ldir, 'out', 'lyrics-timing.json'), JSON.stringify({ title: 'Noite', duration: 40, source: 'estimate', blocks: tl }));
  ly.scenes = tl.map((b, i) => ({ id: `s0${i + 1}`, index: i + 1, title: b.label, narration: b.lines.map((l) => l.text).join(' / '), visualIntent: 'tipografia', kind: 'code' as const, durationSec: 5, status: {}, artifacts: {} }));
  const lr: Route = { id: 'l', name: 'l', description: '', videoTypes: [], steps: [{ ...ly.route!.steps.find((x) => x.id === 'lyrics')!, dependsOn: [] }] };
  const execs = createExecutors({ workflowsDir: path.resolve(__dirname, '../../workflows') });
  const run1 = await runRoute({ project: ly, route: lr, projectDir: ldir, signal: new AbortController().signal, deps: { settings: s, emit: () => {}, sleep: async () => {}, executors: execs } });
  assert.equal(run1.ok, true, run1.error ?? '');
  const total = ly.scenes.reduce((a, x) => a + (x.durationSec ?? 0), 0);
  assert.ok(Math.abs(total - 40) < 0.05, `cenas somam a duração da canção (${total})`);
  const w2 = JSON.parse(fs.readFileSync(path.join(ldir, 'scenes', 's02', 'audio', 'words.json'), 'utf8')) as { words: Array<{ start: number }> };
  assert.ok(w2.words.length >= 6 && w2.words[0]!.start >= 0 && w2.words[0]!.start < 1, 'tempos relativos ao início da cena');

  // 8. thumbnail a partir de um quadro real do vídeo (reserva sem modelo de imagem) e prompt de capa vertical
  try {
    const fdir = path.join(ws, 'projects', sh.id);
    fs.mkdirSync(path.join(fdir, 'out'), { recursive: true });
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=540x960:d=2:r=30', '-pix_fmt', 'yuv420p', path.join(fdir, 'out', 'final.mp4')], { stdio: 'ignore' });
    sh.scenes = [{ id: 's01', index: 1, title: 'A', narration: 'x', visualIntent: 'x', kind: 'video', durationSec: 2, status: {}, artifacts: {} }];
    const tr: Route = { id: 't', name: 't', description: '', videoTypes: [], steps: [{ ...sh.route!.steps.find((x) => x.kind === 'thumbnail')!, dependsOn: [], bindings: [{ type: 'builtin', tool: 'frame-thumbnail' }] }] };
    const run2 = await runRoute({ project: sh, route: tr, projectDir: fdir, signal: new AbortController().signal, deps: { settings: s, emit: () => {}, sleep: async () => {}, executors: execs } });
    assert.equal(run2.ok, true, run2.error ?? '');
    const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(fdir, 'out', 'thumbnail.png')]).toString().trim();
    assert.equal(dims, '1080,1920', 'capa vertical no formato do projeto');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') console.log('(ffmpeg ausente: teste de thumbnail por quadro pulado)'); else throw e;
  }
  assert.match(thumbnailPrompt({ ...ctx(sh, 'thumbnail') }), /vertical Shorts\/Reels cover/);

  /* executor por etapa: roteiro no Claude, cenas no Ollama, revisão no Antigravity — vencem o perfil; a rota fica de reserva */
  {
    const base = createProject(s, { name: 'Base', idea: 'x', videoType: 'custom', skillId: 'whiteboard', routeId: 'stickman-explainer' });
    const tg = stepTargets(base.route!);
    const pick = (k: string) => tg.find((st) => st.kind === k);
    const script = pick('script'), code = pick('code_scene') ?? pick('motion_graphics'), review = pick('review') ?? pick('metadata');
    assert.ok(script && code && review, `etapas de texto/código: ${tg.map((x) => x.kind).join(',')}`);
    const steps = { [script!.id]: { type: 'harness', harness: 'claude', model: 'opus' }, [code!.id]: { type: 'harness', harness: 'ollama' }, [review!.id]: { type: 'harness', harness: 'antigravity' } } as const;
    const bp = createProject(s, { name: 'Balanceado', idea: 'x', videoType: 'custom', skillId: 'whiteboard', routeId: 'stickman-explainer', executorProfile: 'local-ollama', executorSteps: steps as never });
    const head = (id: string) => bp.route!.steps.find((x) => x.id === id)!.bindings;
    assert.deepEqual(head(script!.id)[0], { type: 'harness', harness: 'claude', model: 'opus' });
    assert.deepEqual(head(code!.id)[0], { type: 'harness', harness: 'ollama' });
    assert.deepEqual(head(review!.id)[0], { type: 'harness', harness: 'antigravity' });
    assert.ok(head(review!.id).length > 1, 'executores anteriores ficam como reserva');
    assert.equal(head(review!.id).filter((b) => b.type === 'harness' && b.harness === 'antigravity').length, 1, 'sem duplicar');
    const other = tg.find((st) => st.kind === 'scene_plan');
    if (other) assert.equal((head(other.id)[0] as { harness?: string }).harness, 'ollama', 'etapa sem escolha segue o perfil');
  }
  assert.deepEqual(balanceRoles(['claude', 'antigravity', 'ollama']), { plan: { type: 'harness', harness: 'claude' }, exec: { type: 'harness', harness: 'ollama' }, review: { type: 'harness', harness: 'antigravity' } });
  assert.deepEqual(balanceRoles(['antigravity', 'opencode']), { plan: { type: 'harness', harness: 'antigravity' }, exec: { type: 'harness', harness: 'opencode' }, review: { type: 'harness', harness: 'opencode' } });
  assert.deepEqual(balanceRoles([]), {});
  /* editor → Executores: trocar Ollama por Antigravity numa etapa e refazer só ela e as dependentes */
  {
    const pr = createProject(s, { name: 'Troca', idea: 'x', videoType: 'custom', skillId: 'whiteboard', routeId: 'stickman-explainer', executorProfile: 'local-ollama' });
    const r = pr.route!;
    const code = r.steps.find((x) => x.kind === 'code_scene')!;
    assert.equal((code.bindings[0] as { harness?: string }).harness, 'ollama');
    setStepHead(code, { type: 'harness', harness: 'antigravity', model: 'gemini-3.8-flash-high' });
    assert.deepEqual(code.bindings[0], { type: 'harness', harness: 'antigravity', model: 'gemini-3.8-flash-high' });
    assert.equal((code.bindings[1] as { harness?: string }).harness, 'ollama', 'Ollama vira reserva');
    setStepHead(code, { type: 'harness', harness: 'antigravity' });
    assert.equal(code.bindings.filter((b) => b.type === 'harness' && b.harness === 'antigravity').length, 1, 'sem repetir o harness');
    const redo = downstreamSteps(r, [code.id]);
    assert.equal(redo[0], code.id);
    assert.ok(!redo.includes(r.steps.find((x) => x.kind === 'script')!.id), 'o que vem antes não é refeito');
    const edit = r.steps.find((x) => x.kind === 'edit' && x.enabled);
    if (edit) assert.ok(redo.includes(edit.id), 'a montagem depende das cenas');
    assert.deepEqual(downstreamSteps(r, []), []);
  }
  console.log('routes/skills/profiles tests: OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
