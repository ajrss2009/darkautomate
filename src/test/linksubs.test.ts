import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildAss, subtitleCues, subtitleWords, subtitleKind, writeSrtFromWords } from '../main/ffmpeg';
import { findLink, pageDoc, scrollPlan } from '../main/weblink';
import { attachmentsText } from '../main/attachments';
import { BUILTIN_SKILLS } from '../main/skills-builtin';
import { getRoute } from '../main/presets';
import { isLongCodeVideo, routeSceneKinds } from '../main/prompts';
import { createProject, defaultSettings } from '../main/settings';
import type { Scene, SubtitleStyle } from '../shared/types';

/** Legendas (posição + tipo, tempos reais das palavras) e a skill de link (captura da página). */
async function main() {
  /* ── legendas ── */
  const sc = (id: string, narration: string, subtitle?: string) => ({ id, index: 1, title: id, narration, subtitle, visualIntent: '', kind: 'code', status: {}, artifacts: {} }) as unknown as Scene;
  const words = subtitleWords([
    { scene: sc('s01', 'A lei seca começou em 1920.'), seconds: 3, words: [{ w: 'A', start: 0.1, end: 0.2 }, { w: 'lei', start: 0.25, end: 0.5 }, { w: 'seca', start: 0.55, end: 0.9 }, { w: 'começou', start: 1.0, end: 1.5 }, { w: 'em', start: 1.55, end: 1.6 }, { w: '1920.', start: 1.7, end: 2.4 }] },
    { scene: sc('s02', 'texto da narração', 'Legenda própria aqui'), seconds: 2, words: [{ w: 'x', start: 0, end: 2 }] },
  ]);
  assert.equal(words.length, 9);
  assert.deepEqual(words.slice(0, 2).map((w) => [w.w, w.start]), [['A', 0.1], ['lei', 0.25]], 'tempos do Whisper com a grafia do texto');
  assert.equal(words[6]!.w, 'Legenda', 'legenda editada vence a narração');
  assert.ok(words[6]!.start >= 3 && words[8]!.end <= 5.001, 'cena 2 começa depois da cena 1 e cabe na duração');
  const cues = subtitleCues(words, 3);
  assert.ok(cues.every((c) => c.length <= 3));
  assert.equal(cues[1]!.map((w) => w.w).join(' '), 'começou em 1920.', 'quebra no limite e na pontuação');
  const st: SubtitleStyle = { burn: true, position: 'top', size: 46, color: '#ffffff', box: false, kind: 'bold', accent: '#ffe14d' };
  const ass = buildAss(words, st, { w: 1080, h: 1920 });
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  assert.match(ass, /Style: Main,Arial Black,\d+,/);
  assert.match(ass, /,8,\d+,\d+,\d+,1\n/, 'em cima = alinhamento 8');
  assert.match(ass, /\{\\c&H004DE1FF\\fscx110\\fscy110\}LEI/, 'palavra falada em destaque, caixa alta');
  for (const [kind, re] of [['karaoke', /\{\\kf\d+\}lei/], ['word', /\\t\(0,90/], ['neon', /\\blur\d/], ['box', /,3,\d+,0,2,/], ['minimal', /\\fad\(150,150\)/]] as const) {
    assert.match(buildAss(words, { ...st, kind, position: 'bottom' }, { w: 1920, h: 1080 }), re, `tipo ${kind}`);
  }
  assert.match(buildAss(words, { ...st, kind: 'classic', position: 'middle' }, { w: 1920, h: 1080 }), /,5,\d+,\d+,0,1\n/, 'meio = alinhamento 5, sem margem');
  assert.equal(subtitleKind({ burn: false, position: 'bottom', size: 46, color: '#fff', box: true }), 'box', 'projetos antigos: fundo = tarja');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-subs-'));
  writeSrtFromWords(path.join(dir, 's.srt'), words, 6);
  assert.match(fs.readFileSync(path.join(dir, 's.srt'), 'utf8'), /^1\n00:00:00,100 --> /);

  /* ── skill de link ── */
  assert.equal(findLink('explique https://exemplo.com/produto?id=3, por favor.'), 'https://exemplo.com/produto?id=3');
  assert.equal(findLink('sem link'), undefined);
  const plan = scrollPlan({ maxY: 6000, viewH: 720, sections: [{ title: 'Recursos', y: 900 }, { title: 'Preços', y: 2600 }, { title: 'Perto', y: 2700 }, { title: 'FAQ', y: 5200 }], fps: 30, maxSec: 30 });
  assert.ok(plan.seconds <= 31 && plan.seconds >= 6, `duração ${plan.seconds}`);
  assert.deepEqual(plan.marks.map((m) => m.title), ['Recursos', 'Preços', 'FAQ'], 'seções muito próximas viram uma parada só');
  assert.ok(plan.ys[0] === 0 && plan.ys[plan.ys.length - 1] === 6000, 'começa no topo e termina no fim');
  assert.ok(plan.ys.every((y, i) => i === 0 || y >= plan.ys[i - 1]!), 'só desce');
  const long = scrollPlan({ maxY: 40000, viewH: 720, sections: [{ title: 'Início', y: 3000 }, { title: 'Longe', y: 30000 }], fps: 30, maxSec: 20 });
  assert.ok(Math.max(...long.ys) <= 13000 && long.marks.every((m) => m.title !== 'Longe'), 'página longa: só o trecho legível');
  assert.ok(long.ys.every((y, i) => i === 0 || y - long.ys[i - 1]! <= 1400 / 30 * 1.6), 'rolagem legível (sem saltos)');
  const md = pageDoc({ url: 'https://exemplo.com', title: 'Exemplo', description: 'desc', text: 'Texto da página', sections: [], maxY: 6000, viewH: 720 }, plan, { video: 'web/pagina.mp4', shots: [{ file: 'web/pagina-topo.png', title: 'topo' }] });
  assert.match(md, /LINK: https:\/\/exemplo\.com[\s\S]*Recursos[\s\S]*web\/pagina-topo\.png[\s\S]*Texto da página/);

  const skill = BUILTIN_SKILLS.find((k) => k.id === 'explicativo-link');
  assert.ok(skill?.linkCapture && skill.routeId === 'explicativo-link', 'skill padrão de link');
  assert.ok(getRoute('explicativo-link')?.steps.some((s) => s.kind === 'motion_graphics'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-link-'));
  const s = defaultSettings(ws);
  const p = createProject(s, { name: 'Link', idea: 'explique https://exemplo.com', videoType: 'custom', skillId: 'explicativo-link' } as never);
  assert.equal(p.skill?.linkCapture, true);
  assert.equal(isLongCodeVideo(p, routeSceneKinds(p), path.join(ws, 'plugins')), false, 'trechos curtos da captura (não junta em cenas de 10–19 s)');
  const pdir = path.join(ws, 'projects', p.id), web = path.join(pdir, 'assets', 'user', 'web');
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(web, 'pagina.mp4'), 'x'); fs.writeFileSync(path.join(web, 'pagina.md'), '# Exemplo\nLINK: https://exemplo.com');
  p.attachments = [{ file: 'web/pagina.mp4', kind: 'video', use: 'scene' }, { file: 'web/pagina.md', kind: 'text', use: 'reference' }];
  const plan2 = attachmentsText(p, pdir, 'scene_plan');
  assert.match(plan2, /CAPTURA DO LINK/);
  assert.doesNotMatch(plan2, /USO COMPLETO/, 'a captura não precisa ser usada inteira');
  assert.match(attachmentsText(p, pdir, 'script'), /LINK: https:\/\/exemplo\.com/, 'o roteiro lê o conteúdo da página');
  console.log('linksubs tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
