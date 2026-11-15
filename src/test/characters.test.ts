import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { addCharacterImage, applyCharacters, castFromCharacter, charactersPrompt, deleteCharacter, getCharacter, listCharacters, mergeBible, normalizeCharacter, saveCharacter, sheetPrompt, syncBibleToLibrary } from '../main/characters';
import { applySkillMix, assignSkillMix, mixPrompt, mixShares, normalizeMix } from '../main/skill-mix';
import { paletteEnglish, projectPalettePrompt } from '../main/channel-setup';
import { flowRefsText } from '../main/flow';
import { createProject, defaultSettings } from '../main/settings';
import { thumbnailPrompt, visualPrompt } from '../main/prompts';
import { characterPhoto } from '../main/attachments';
import { buildStoryboard } from '../main/project-storyboard';
import type { Project, Scene } from '../shared/types';
import { RIG_RUNTIME, normalizeRig, rigSceneText, sanitizeSvg, stageRig } from '../main/rig';
import { setCharacterRig, readCharacterRig, toProjectCharacter } from '../main/characters';
import { sceneRigText, ensureThreeImport } from '../main/prompts';
import * as vm from 'node:vm';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-chars-'));
  const s = defaultSettings(ws);
  const img = path.join(ws, 'folha.png'); fs.writeFileSync(img, PNG);

  /* ───────── biblioteca ───────── */
  assert.throws(() => normalizeCharacter({ look: 'x' }), /nome/);
  assert.throws(() => normalizeCharacter({ name: 'A' }), /aparência/);
  assert.equal(normalizeCharacter({ name: 'A', look: 'b', kind: 'robo' as never }).kind, 'pessoa', 'tipo inválido vira pessoa');
  const ji = saveCharacter(s, { name: 'Ji-woo Park', look: 'mulher coreana de 25 anos, cabelo preto liso nos ombros, casaco bege', kind: 'pessoa', gender: 'f',
    voice: { apiVoice: 'nova', description: 'feminina, 25 anos, doce' }, code: 'cabeça redonda #f2c6a0, franja preta', sheet: '../../etc/passwd' });
  assert.equal(ji.id, 'ji-woo-park'); assert.equal(ji.sheet, undefined, 'caminho de arquivo não vem da interface');
  const ji2 = saveCharacter(s, { name: 'Ji-woo Park', look: 'outra' });
  assert.equal(ji2.id, 'ji-woo-park-2', 'nome repetido ganha id novo');
  deleteCharacter(s, ji2.id);
  const min = saveCharacter(s, { name: 'Min-ho', look: 'homem coreano de 27 anos, terno azul-marinho, cabelo preto médio', gender: 'm', voice: { refAudio: path.join(ws, 'voz-minho.wav') } });
  assert.deepEqual(listCharacters(s).map((c) => c.id), ['ji-woo-park', 'min-ho']);
  addCharacterImage(s, ji.id, img, 'sheet');
  assert.equal(getCharacter(s, ji.id).sheet, 'sheet.png');
  assert.throws(() => addCharacterImage(s, ji.id, path.join(ws, 'x.txt'), 'sheet'), /imagem/);
  const upd = saveCharacter(s, { ...getCharacter(s, ji.id), look: 'mulher coreana de 25 anos, cabelo preto liso nos ombros, casaco bege, blusa branca' });
  assert.equal(upd.sheet, 'sheet.png', 'salvar mantém a folha'); assert.ok(upd.updatedAt);
  const sp = sheetPrompt(upd);
  assert.match(sp, /FRONT view/); assert.match(sp, /SIDE view/); assert.match(sp, /BACK view/); assert.match(sp, /expressions/); assert.match(sp, /NOT resemble any real celebrity/);
  assert.match(sheetPrompt({ ...upd, kind: 'cartoon' }), /2D cartoon/);
  assert.deepEqual(castFromCharacter(upd), { speaker: 'Ji-woo Park', refAudio: undefined, voice: 'nova', description: `${upd.look} — voz: feminina, 25 anos, doce` });

  /* bíblia: acrescenta só quem falta, nas seções certas */
  const md = mergeBible('# Bíblia\n\n## Personagens fixos\n- **Min-ho**: já descrito\n\n## Cenários\n- praça\n', [{ name: 'Min-ho', look: 'x' }, { name: 'Ji-woo Park', look: 'y', voice: { description: 'doce' } }]);
  assert.match(md, /- \*\*Min-ho\*\*: já descrito\n- \*\*Ji-woo Park\*\*: y\n/); assert.equal((md.match(/Min-ho/g) ?? []).length, 1);
  assert.match(md, /## Cenários\n- praça/); assert.match(md, /## Vozes\n- \*\*Ji-woo Park\*\*: doce/);

  /* ───────── projeto com personagens: elenco, foto de personagem, bíblia, prompts ───────── */
  const p = createProject(s, { name: 'Dorama teste', idea: 'encontro na chuva', videoType: 'custom', routeId: 'shorts-autopilot', characterIds: [ji.id, min.id, 'nao-existe'] });
  const dir = path.join(ws, 'projects', p.id);
  assert.deepEqual(p.characters?.map((c) => c.name), ['Ji-woo Park', 'Min-ho']);
  assert.deepEqual(p.cast?.map((m) => [m.speaker, m.voice, m.refAudio]), [['Ji-woo Park', 'nova', undefined], ['Min-ho', undefined, path.join(ws, 'voz-minho.wav')]]);
  assert.ok(characterPhoto(p, dir, 'Ji-woo Park')?.endsWith(path.join('characters', 'ji-woo-park.png')), 'a folha virou foto de personagem (MiniMax H3, Wan2GP, retrato e Flow usam)');
  assert.equal(characterPhoto(p, dir, 'Min-ho'), undefined, 'sem folha: o app gera o retrato depois');
  const bible = fs.readFileSync(path.join(dir, 'assets', 'assets.md'), 'utf8');
  assert.match(bible, /\*\*Ji-woo Park\*\*: mulher coreana/); assert.match(bible, /## Vozes/);
  assert.ok((JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')) as Project).characters?.length === 2, 'gravado no projeto');
  assert.match(charactersPrompt(p, 'scene_plan'), /speaker/); assert.match(charactersPrompt(p, 'asset_design'), /Personagens fixos/);
  assert.match(charactersPrompt(p, 'code_scene'), /Ji-woo Park: cabeça redonda #f2c6a0/, 'por código usa o desenho do personagem');
  assert.match(charactersPrompt(p, 'code_scene'), /Min-ho: homem coreano/, 'sem desenho: a aparência');
  assert.match(charactersPrompt(p, 'image'), /SAME CHARACTERS/); assert.equal(charactersPrompt(p, 'narration'), '');
  assert.equal(charactersPrompt({}, 'script'), '');
  const sc: Scene = { id: 's01', index: 1, title: 't', narration: 'n', visualIntent: 'Ji-woo Park sob a chuva', kind: 'image', status: {}, artifacts: {} };
  const vp = visualPrompt({ project: { ...p, scenes: [sc] }, projectDir: dir, scene: sc, step: { kind: 'image' } } as never);
  assert.match(vp, /Ji-woo Park = mulher coreana/, 'a aparência fixa entra no prompt da imagem pela bíblia');
  assert.equal(flowRefsText([{ name: 'Ji-woo Park' }, { name: 'Min-ho' }]), ' Use as imagens anexadas como referência de personagem (mesmo rosto, cabelo, corpo e roupa): imagem 1 = Ji-woo Park; imagem 2 = Min-ho.');
  assert.equal(flowRefsText(undefined), '');

  /* ───────── várias skills com percentual ───────── */
  assert.deepEqual(normalizeMix([{ skillId: 'b', pct: 40 }, { skillId: 'a', pct: 60 }, { skillId: 'b', pct: 9 }], 'a'), [{ skillId: 'a', pct: 60 }, { skillId: 'b', pct: 40 }], 'principal primeiro, sem repetidas');
  assert.deepEqual(normalizeMix([{ skillId: 'a', pct: 1 }, { skillId: 'b', pct: 1 }], 'a').map((x) => x.pct), [50, 50]);
  assert.equal(normalizeMix([{ skillId: 'x', pct: 50 }], 'a')[0]!.skillId, 'a', 'principal entra mesmo se não veio');
  assert.equal(normalizeMix([1, 2, 3, 4, 5, 6].map((i) => ({ skillId: `s${i}`, pct: 10 })), 's1').length, 4, 'até 4 skills');
  const ten = Array.from({ length: 10 }, () => ({ durationSec: 6, narration: '' }));
  const mix = [{ skillId: 'A', pct: 60 }, { skillId: 'B', pct: 40 }];
  const blocks = assignSkillMix(ten, mix, 'blocks');
  assert.deepEqual(blocks, ['A', 'A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B'], 'blocos na ordem, pela duração');
  assert.deepEqual(mixShares(ten, blocks), { A: 60, B: 40 });
  const inter = assignSkillMix(ten, mix, 'interleave');
  assert.deepEqual(mixShares(ten, inter), { A: 60, B: 40 }, 'intercaladas na mesma cota');
  assert.ok(inter.some((x, i) => i > 0 && x !== inter[i - 1]) && inter.slice(0, 4).includes('B'), 'alterna desde o começo');
  /* mesclada: segue a skill sugerida pelo plano (nome ou id) enquanto cabe na cota; depois vai para a mais atrasada */
  const hinted = ten.map((x, i) => ({ ...x, mixSkill: i < 8 ? 'Skill B' : 'a' }));
  const best = assignSkillMix(hinted, [{ skillId: 'A', pct: 60, name: 'Skill A' }, { skillId: 'B', pct: 40, name: 'Skill B' }], 'best');
  assert.deepEqual(best.slice(0, 5), ['B', 'B', 'B', 'B', 'A'], 'mesclada: B até a cota (40%), depois A mesmo com B sugerida');
  assert.deepEqual(mixShares(ten, best), { A: 60, B: 40 }, 'mesclada respeita os percentuais');
  assert.deepEqual(assignSkillMix(ten.slice(0, 2).map((x, i) => ({ ...x, mixSkill: ['B', 'A'][i] })), mix, 'best'), ['B', 'A'], 'mesclada usa a sugestão quando cabe');
  assert.deepEqual(assignSkillMix([{ durationSec: 30 }, { durationSec: 2 }] as never, [{ skillId: 'A', pct: 95 }, { skillId: 'B', pct: 5 }], 'blocks'), ['A', 'B'], 'toda skill ganha ao menos uma cena');
  const mp = createProject(s, { name: 'Misto', idea: 'ideia', videoType: 'custom', skillId: 'explicativo-link', routeId: 'explicativo-link', skillMix: [{ skillId: 'explicativo-link', pct: 70 }, { skillId: 'tutorial-clipes', pct: 30 }], skillMixMode: 'blocks' });
  assert.deepEqual(mp.skillMix?.items.map((m) => [m.skillId, m.pct]), [['explicativo-link', 70], ['tutorial-clipes', 30]]);
  assert.equal(mp.skillMixSkills?.[0]?.id, 'tutorial-clipes', 'a skill secundária fica congelada no projeto');
  assert.match(mixPrompt(mp, 'scene_plan'), /2 SKILLS — em SEQUÊNCIA/); assert.match(mixPrompt(mp, 'scene_plan'), new RegExp(`70% \\(≈ 0–${Math.round(mp.targetDurationSec * 0.7)} s\\)`), 'faixa de tempo pela duração do projeto');
  assert.match(mixPrompt(mp, 'script'), /uma história só/); assert.equal(mixPrompt(mp, 'image'), '');
  mp.scenes = Array.from({ length: 5 }, (_, i): Scene => ({ id: `s${i + 1}`, index: i + 1, title: `c${i + 1}`, narration: '', visualIntent: '', kind: 'code', durationSec: 10, status: {}, artifacts: {} }));
  const shares = applySkillMix(mp);
  assert.deepEqual(shares, { 'explicativo-link': 80, 'tutorial-clipes': 20 }, '5 cenas iguais, 70/30: a cena cujo meio cai no limite fica com a principal');
  assert.deepEqual(mp.scenes.map((x) => x.skillOverride?.id ?? '—'), ['—', '—', '—', '—', 'tutorial-clipes'], 'a principal fica sem cópia; as outras cenas recebem a skill delas');
  mp.scenes[0]!.skillOverride = { id: 'manual', name: 'Escolhida à mão', description: '', global: '', steps: {} };
  applySkillMix(mp);
  assert.equal(mp.scenes[0]!.skillOverride?.id, 'manual', 'troca manual para skill fora da mistura não é desfeita');
  const sb = buildStoryboard(mp);
  assert.equal(sb.panels[4]!.skill, mp.skillMixSkills![0]!.name, 'o storyboard mostra a skill de cada cena');
  assert.equal(buildStoryboard({ ...p, scenes: [sc] }).panels[0]!.skill, undefined);

  /* ───────── paleta do Novo projeto (vídeo e thumbnail) ───────── */
  const pal = { background: '#0b0b10', text: '#ffffff', accent: '#ffcc00', secondary: '#7c5cff' };
  const pp = createProject(s, { name: 'Paleta', idea: 'ideia', videoType: 'custom', routeId: 'shorts-autopilot', palette: { video: pal, thumbnail: { ...pal, background: '#ff0000' } } });
  assert.equal(pp.palette?.video?.mode, 'dark'); assert.ok((pp.palette?.video?.contrast ?? 0) > 15, 'contraste calculado');
  assert.equal(pp.subtitleStyle?.color, '#ffffff'); assert.equal(pp.subtitleStyle?.accent, '#ffcc00', 'a legenda usa a paleta do vídeo');
  assert.match(projectPalettePrompt(pp.palette, 'image'), /fundo #0b0b10/); assert.match(projectPalettePrompt(pp.palette, 'thumbnail'), /fundo #ff0000/);
  assert.match(projectPalettePrompt(pp.palette, 'code_scene'), /VENCE a do canal/); assert.equal(projectPalettePrompt(pp.palette, 'narration'), '');
  assert.equal(paletteEnglish(pp.palette?.video), 'background #0b0b10, text #ffffff, accent #ffcc00, secondary #7c5cff, dark mode');
  const ctx = (step: string) => ({ project: { ...pp, scenes: [sc] }, projectDir: path.join(ws, 'projects', pp.id), scene: sc, step: { kind: step }, settings: s, outDir: '' }) as never;
  assert.match(visualPrompt(ctx('image')), /color palette: background #0b0b10/, 'a imagem das cenas recebe a paleta');
  assert.match(thumbnailPrompt(ctx('thumbnail')), /Color palette: background #ff0000/, 'a thumbnail recebe a paleta da thumbnail');
  assert.equal(createProject(s, { name: 'Sem', idea: 'i', videoType: 'custom', routeId: 'shorts-autopilot' }).palette, undefined);

  /* bíblia + cenários dos agentes → BIBLIOTECA (reutilizáveis em imagem e código) */
  {
    const p = createProject(s, { name: 'Bíblia', idea: 'cidade e detetive', videoType: 'custom', skillId: 'historia-codigo' });
    const dir = path.join(ws, 'projects', p.id);
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', 'assets.md'), [
      '# Bíblia',
      '## Personagens fixos',
      '- **Ana**: young woman, 28, short black hair, red coat, determined',
      '- **Beto**: man, 45, grey beard, worn brown jacket, tired eyes',
      '## Vozes',
      '- **Ana**: feminina, 28 anos, voz firme e um pouco rouca',
      '- **Beto**: masculina, 45 anos, voz grave e cansada',
      '## Desenho em código',
      '- **Ana**: head circle #F2C9A0, coat #C0392B, hair #1B1B1B',
      '- **Beto**: head square #D9B08C, jacket #6E4B2A, beard #9E9E9E',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'assets', 'sets.md'), [
      '# Cenários',
      '## Cenários',
      '- **Delegacia**: 1970s police station, wooden desks, green lamps, rainy windows',
      '## Objetos fixos',
      '- **Processo**: worn manila folder, coffee stain, red stamp',
      '## Desenho em código',
      '- **Delegacia**: back wall #4E5D6C, desks #8B5E3C, lamps #F4D35E',
    ].join('\n'));
    const r = syncBibleToLibrary(s, p, dir);
    assert.equal(r.created, 4);
    assert.equal(r.characters, 2); assert.equal(r.locations, 1); assert.equal(r.props, 1);
    const libChars = listCharacters(s, 'character');
    const ana = libChars.find((c) => c.name === 'Ana')!;
    assert.equal(ana.voice?.description, 'feminina, 28 anos, voz firme e um pouco rouca');
    assert.match(ana.code ?? '', /coat #C0392B/);
    assert.equal(ana.kind, 'codigo', 'personagem com desenho em código');
    const delegacia = listCharacters(s, 'location').find((c) => c.name === 'Delegacia')!;
    assert.match(delegacia.code ?? '', /desks #8B5E3C/);
    assert.equal(delegacia.kind, 'outro');
    assert.ok(p.characters && p.characters.length === 4, 'projeto congela os itens da biblioteca');
    assert.ok((p.cast ?? []).some((m) => m.speaker === 'Ana'), 'elenco do projeto recebe os personagens');
    const bible = fs.readFileSync(path.join(dir, 'assets', 'assets.md'), 'utf8');
    assert.match(bible, /## Cenários fixos[\s\S]*Delegacia/, 'cenários entram na bíblia do projeto');
    const again = syncBibleToLibrary(s, p, dir);
    assert.equal(again.created, 0, 'idempotente: não duplica na biblioteca');
    assert.equal(listCharacters(s, 'character').filter((c) => ['Ana', 'Beto'].includes(c.name)).length, 2);
  }


  // ───────── rig articulado em camadas (ForgeRig)
  {
    const seg = (id: string, x: number, y: number, z: number, parent?: string) => ({ id, parent, pivot: [x, y], z, svg: `<rect x="${x - 10}" y="${y}" width="20" height="120" fill="#335"/>` });
    const raw = { name: 'Beto', size: [400, 800], view: 'front', palette: ['#335', 'nada'], parts: [
      { id: 'torso', pivot: [200, 470], z: 5, svg: '<rect x="150" y="250" width="100" height="230" fill="#B91C1C" onclick="alert(1)"/><script>alert(1)</script>' },
      { id: 'head', pivot: [200, 250], z: 8, svg: '<circle cx="200" cy="190" r="60" fill="#E2A782"/><image href="http://x/y.png"/>' },
      seg('armL_up', 150, 260, 11), seg('armL_low', 150, 380, 12), seg('armR_up', 250, 260, 3), seg('armR_low', 250, 380, 4),
      seg('legL_up', 175, 470, 6), seg('legL_low', 175, 620, 7), seg('legR_up', 225, 470, 1), seg('legR_low', 225, 620, 2),
      { id: 'mouth', pivot: [200, 215], z: 10, svg: '<path d="M185 215 h30" stroke="#000"/>' },
      { id: 'mouthOpen', pivot: [200, 215], z: 10, svg: '<ellipse cx="200" cy="218" rx="12" ry="8" fill="#400"/>' },
      { id: 'hair', parent: 'nao-existe', pivot: [200, 150], z: 9, svg: '<path d="M140 170 Q200 100 260 170" fill="#1E293B"/>' },
    ] };
    const rig = normalizeRig(raw);
    assert.equal(rig.parts.length, 13);
    assert.equal(rig.parts.find((x) => x.id === 'armL_low')!.parent, 'armL_up', 'pai padrão: antebraço pendurado no braço');
    assert.equal(rig.parts.find((x) => x.id === 'mouthOpen')!.parent, 'head');
    assert.equal(rig.parts.find((x) => x.id === 'hair')!.parent, 'torso', 'pai inexistente vira o tronco');
    assert.ok(!/script|onclick|http:/.test(JSON.stringify(rig)), 'SVG sem script, eventos nem links externos');
    assert.deepEqual(rig.palette, ['#335']);
    assert.throws(() => normalizeRig({ parts: [raw.parts[0]] }), /não tem as peças/);
    assert.equal(sanitizeSvg('<svg><foreignObject><div/></foreignObject><path d="M0 0"/></svg>'), '<path d="M0 0"/>');
    // motor: roda num contexto isolado e é determinístico
    const ctx: Record<string, unknown> = { Math, Promise, Image: class {}, encodeURIComponent };
    ctx['window'] = ctx;
    vm.runInNewContext(RIG_RUNTIME, ctx);
    const R = ctx['ForgeRig'] as { state: (r: unknown, o: unknown) => { j: Record<string, number>; mouthOpen: boolean }; solve: (r: unknown, st: unknown) => Record<string, number[]>; svgGroup: (r: unknown, o: unknown) => string; poses: string[] };
    assert.ok(R.poses.includes('walk') && R.poses.includes('talk') && R.poses.includes('wave'));
    const st = R.state(rig, { pose: 'wave', t: 0.3 });
    const m = R.solve(rig, st);
    const hand = (mm: number[], x: number, y: number) => [mm[0]! * x + mm[2]! * y + mm[4]!, mm[1]! * x + mm[3]! * y + mm[5]!];
    const [hx, hy] = hand(m['armR_low']!, 250, 500);
    assert.ok(hy < 260 && hx > 250, `acenar levanta o braço direito acima do ombro (mão em ${Math.round(hx)},${Math.round(hy)})`);
    const w1 = R.solve(rig, R.state(rig, { pose: 'walk', t: 0.25 })), w2 = R.solve(rig, R.state(rig, { pose: 'walk', t: 0.25 }));
    assert.deepEqual(w1, w2, 'mesmo t, mesma pose');
    const [fx] = hand(w1['legL_low']!, 175, 780), [gx] = hand(w1['legR_low']!, 225, 780);
    assert.ok(Math.abs(fx - 175) > 3 || Math.abs(gx - 225) > 3, 'andar mexe as pernas');
    const talks = Array.from({ length: 30 }, (_, i) => R.state(rig, { pose: 'talk', t: i / 30 }).mouthOpen);
    assert.ok(talks.some(Boolean) && talks.some((x) => !x), 'falar abre e fecha a boca');
    const g = R.svgGroup(rig, { x: 540, y: 1000, height: 600, pose: 'walk', t: 1 });
    assert.ok(g.startsWith('<g transform="translate(540 1000) scale(0.75 0.75)') && !g.includes('<ellipse'), 'svgGroup: boca fechada fora da fala');
    // biblioteca → projeto → prompt da cena por código
    const beto = saveCharacter(s, { name: 'Beto Rig', look: 'jaqueta vermelha, boné', kind: 'codigo' });
    setCharacterRig(s, beto.id, rig);
    const back = readCharacterRig(s, getCharacter(s, beto.id));
    assert.equal(back?.parts.length, 13, 'rig salvo e lido da biblioteca');
    const pdir = path.join(ws, 'projects', 'rigp'); fs.mkdirSync(pdir, { recursive: true });
    const pr = createProject(s, { name: 'Rig', idea: 'x', videoType: 'custom', routeId: 'stickman-explainer' });
    applyCharacters(s, pr, pdir, [beto.id]);
    const pc = pr.characters!.find((c) => c.id === beto.id)!;
    assert.equal(pc.rig, `assets/user/rigs/${beto.id}.rig.js`);
    assert.ok(fs.existsSync(path.join(pdir, 'assets', 'user', 'rigs', 'forge-rig.js')) && fs.existsSync(path.join(pdir, pc.rig!)), 'motor e rig copiados para o projeto');
    assert.match(charactersPrompt(pr, 'code_scene'), /RIG ARTICULADO pronto/);
    const sc = { id: 's01', title: 'A', narration: 'n', visualIntent: 'v', kind: 'code' } as unknown as Scene;
    const txt = sceneRigText({ step: { kind: 'code_scene' } as never, scene: sc, sceneDir: path.join(pdir, 'scenes', 's01'), project: pr, projectDir: pdir, outDir: path.join(pdir, 'out') });
    assert.match(txt, /<script src="\.\.\/\.\.\/\.\.\/assets\/user\/rigs\/forge-rig\.js"><\/script>/, 'caminho relativo da página da cena até o motor');
    assert.match(txt, /FORGE_RIGS\["Beto Rig"\]|"Beto Rig"/);
    assert.equal(rigSceneText([], 'x'), '');
    // 3D como o personagem
    assert.equal(toProjectCharacter({ ...getCharacter(s, beto.id), prefer3d: true }).prefer3d, undefined, 'sem modelo 3D, prefer3d não vale');
    const st3 = stageRig(pdir, 'x', rig, 'X'); assert.equal(st3.runtime, 'assets/user/rigs/forge-rig.js');
    // addons do Three.js (GLTFLoader) de CDN viram o mapa local
    const page3 = '<script type="module">import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"; import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";</script>';
    const fixed3 = ensureThreeImport(page3, { three: '../p/three.module.min.js', 'three/addons/': '../p/addons/' });
    assert.ok(fixed3.includes('from "three"') && fixed3.includes('from "three/addons/loaders/GLTFLoader.js"') && fixed3.includes('"three/addons/":"../p/addons/"'), 'addons locais no import map');
  }

  console.log('characters: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
