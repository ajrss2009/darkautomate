import * as assert from 'node:assert/strict';
import {
  STRUCTURE_PRINCIPLE, actTimeline, applyDnaToSkill, catchphrases, cutMetrics, dnaSceneSec, dnaScriptRule, dnaSfxRule, dnaSubtitleStyle, normalizeActs, normalizeDna,
  sfxPerScene, speechMetrics, subtitleKindFor, toFormatDna, wordsPerSecond,
} from '../main/channel-dna';
import { wordBudget } from '../main/prompts';
import { moodFor } from '../main/codemusic';
import { modelingCoverage } from '../shared/modeling';
import type { Project, Skill, SubtitleStyle } from '../shared/types';

async function main() {
  /* ───────── medido sem IA: gancho de 15 s, densidade, jump cuts, bordões ───────── */
  const words = (n: number, w = 'palavra') => Array(n).fill(w).join(' ');
  const t = `${words(30)}. Em 1969 o homem pisou na Lua. A empresa Boeing gastou bilhões. ${words(20)}. Depois veio o ônibus espacial em 1981.`;
  const sm = speechMetrics(t, 30);
  assert.equal(sm.wpm, Math.round(t.split(' ').length / 0.5));
  assert.equal(sm.hook?.split(' ').length, Math.round((sm.wpm! * 15) / 60), 'gancho = o que é falado em 15 s');
  assert.equal(sm.secPerFact, 10, '3 frases com fato (ano, nome próprio) em 30 s');
  assert.equal(speechMetrics(words(60), 0).hook?.split(' ').length, 40, 'sem duração: 40 palavras');
  const cm = cutMetrics([1, 2, 2.8, 10, 20], 30);
  assert.equal(cm.shots, 6); assert.equal(cm.avgShotSec, 5);
  assert.equal(cm.jumpCutShare, 0.5, '3 de 6 takes têm < 1,5 s');
  assert.ok((cm.shotStdSec ?? 0) > 3, 'ritmo variado');
  assert.equal(cutMetrics([], 10).jumpCutShare, 0);
  const ph = catchphrases([
    'Só que tem um detalhe. Mas olha só o que aconteceu. Só que ninguém viu. E aqui vem a parte boa.',
    'Só que o plano falhou. Mas olha só isso. Só que piorou. Mas olha só a conta.',
  ]);
  assert.ok(ph.includes('só que'), `bordão medido: ${ph.join(', ')}`); assert.ok(ph.some((x) => x.startsWith('mas olha')));
  assert.ok(!ph.some((x) => x.startsWith('e aqui')), 'frase que aparece só em 1 vídeo não conta');

  /* ───────── DNA da IA: campos do checklist normalizados ───────── */
  const dna = normalizeDna({
    visual: { style: 'flat', palette: ['#0b0b10', '#ffcc00', '#ffffff'], paletteRoles: { background: '#0b0b10', text: '#ffffff', accent: '#ffcc00' }, graphicStyle: ['vetores flat', 'mockups de UI'], aiStylePrompt: 'flat vector, thick outlines' },
    camera: { moves: ['push-in-lento', 'snap-zoom'], snapZoomSfx: true, lens: 'grande-angular', depthOfField: 'rasa', jumpCuts: 'a cada frase' },
    script: { hookAnatomy: ['0–3 s: afirmação chocante', '3–15 s: promessa'], timeToRewardSec: '22', actModel: 'Retenção', acts: [{ name: 'Gancho', pct: 10 }, { name: 'Contexto', pct: 30 }, { name: 'Virada', pct: 40 }, { name: 'Payoff', pct: 20 }],
      nlp: 'loops abertos', transitions: ['virada: só que…'], secPerFact: 8 },
    text: { family: 'Montserrat', outline: '6 px preto', shadow: 'dura', case: 'ALTA', animation: 'pop/spring' },
    audio: { sfxPerMin: 12, sfxKind: 'Orgânico', voiceProcessing: 'podcast' },
    soundtrack: { bpm: 128, silenceBeforeReveal: true, cutsOnBeat: 'true', genreByAct: ['tenso', 'épico'] },
  });
  assert.equal(dna.script?.timeToRewardSec, 22, 'número vindo como texto');
  assert.equal(dna.script?.actModel, 'retencao', 'acento e caixa normalizados');
  assert.equal(dna.script?.acts?.reduce((a, b) => a + b.pct, 0), 100);
  assert.equal(normalizeActs([{ name: 'A', pct: 30 }, { name: 'B', pct: 60 }])!.reduce((a, b) => a + b.pct, 0), 100, 'atos reescalados para 100% (a IA somou 90)');
  assert.equal(dna.audio?.sfxKind, 'organico'); assert.equal(dna.soundtrack?.cutsOnBeat, true); assert.equal(dna.camera?.snapZoomSfx, true);
  assert.equal(dna.visual?.paletteRoles?.mode, 'dark'); assert.ok((dna.visual?.paletteRoles?.contrast ?? 0) > 15, 'contraste calculado pelo app');
  assert.deepEqual(normalizeActs([{ name: 'A', pct: 1 }, { name: 'B', pct: 1 }, { name: 'C', pct: 1 }])!.map((a) => a.pct), [33, 33, 34]);
  assert.equal(normalizeActs('x'), undefined);
  assert.equal(normalizeDna({ script: { acts: [{ name: 'A', pct: 30 }, { name: 'B', pct: 70 }] } }).script?.actModel, '3-atos', 'modelo deduzido pela quantidade de atos');
  assert.equal(normalizeDna({ soundtrack: { bpm: 9999 } }).soundtrack?.bpm, 220, 'BPM limitado');

  /* ───────── DNA estruturado (FormatDna) ───────── */
  const measured = { wpm: 170, avgShotSec: 2.5, jumpCutShare: 0.3, secPerFact: 9, wordsPerSentence: 11 };
  const f = toFormatDna(dna, measured, ['só que']);
  assert.equal(f.wpm, 170); assert.equal(f.avgTakeSec, 2.5); assert.equal(f.secPerFact, 8, 'a IA viu a densidade (vence a heurística)');
  assert.deepEqual(f.transitions, ['virada: só que…'], 'transições da IA vencem as medidas');
  assert.equal(f.sfxPerMin, 12); assert.equal(f.music?.bpm, 128); assert.equal(f.textAnimation, 'pop/spring'); assert.equal(f.palette?.accent, '#ffcc00');
  assert.equal(toFormatDna({}, { wpm: 100 }, ['mas olha']).transitions?.[0], 'mas olha', 'sem IA, o bordão medido entra');
  assert.deepEqual(Object.keys(toFormatDna({}, {})), [], 'nada medido = vazio');

  /* ───────── uso na produção: roteiro (WPM, gancho, atos, densidade, transições) ───────── */
  assert.equal(wordsPerSecond(f), 170 / 60); assert.equal(wordsPerSecond(undefined, 'en-US'), 2.8); assert.equal(wordsPerSecond({ wpm: 900 }), 4.2, 'limitado');
  const proj = { targetDurationSec: 60, language: 'pt-BR' } as Project;
  assert.equal(wordBudget(proj), 156, 'sem DNA: 2,6 palavras/s');
  assert.equal(wordBudget({ ...proj, skill: { formatDna: f } as Skill }), 170, 'com DNA: o WPM medido manda no tamanho do roteiro');
  const acts = actTimeline(f.acts, 100);
  assert.equal(acts[0]!.from, 0); assert.equal(acts[acts.length - 1]!.to, 100);
  const rule = dnaScriptRule(f, 100);
  assert.match(rule, /170 palavras\/min/); assert.match(rule, /GANCHO \(0–15 s\): 0–3 s: afirmação chocante/); assert.match(rule, /até 22 s/);
  assert.match(rule, /modelo de retenção/); assert.match(rule, /Gancho 0–10 s/); assert.match(rule, /a cada ≈ 8 s/); assert.match(rule, /bordões PRÓPRIOS/);

  /* cenas, SFX, legendas e trilha */
  assert.equal(dnaSceneSec(f), 8, '3 takes de 2,5 s, mínimo 8 s'); assert.equal(dnaSceneSec({ avgTakeSec: 9 }), 16); assert.equal(dnaSceneSec(undefined), undefined);
  assert.equal(sfxPerScene(f, 10), 2); assert.equal(sfxPerScene({ sfxPerMin: 200 }, 10), 6); assert.equal(sfxPerScene(undefined, 10), undefined);
  assert.match(dnaSfxRule(f, 10), /12 por minuto.*2 por cena.*orgânico.*snap zoom/);
  assert.equal(dnaSfxRule(undefined, 10), '');
  assert.equal(subtitleKindFor('pop/spring'), 'bold'); assert.equal(subtitleKindFor('Typewriter'), 'typewriter'); assert.equal(subtitleKindFor('karaokê'), 'karaoke');
  assert.equal(subtitleKindFor('palavra por palavra'), 'word'); assert.equal(subtitleKindFor('fade'), 'reveal'); assert.equal(subtitleKindFor(''), undefined);
  const base: SubtitleStyle = { burn: true, position: 'bottom', size: 48, color: '#ffffff', box: false };
  const sub = dnaSubtitleStyle(base, f);
  assert.equal(sub.kind, 'bold'); assert.equal(sub.accent, '#ffcc00'); assert.equal(sub.burn, true);
  const mine = dnaSubtitleStyle(base, f, { palettes: { video: { background: '#000000', text: '#eeeeee', accent: '#00ff88' } }, typography: { animation: 'typewriter' } });
  assert.equal(mine.kind, 'typewriter', 'a animação do canal do usuário vence'); assert.equal(mine.accent, '#00ff88', 'a paleta do canal do usuário vence a do formato');
  assert.equal(dnaSubtitleStyle({ ...base, kind: 'neon' }, f).kind, 'neon', 'escolha do usuário no projeto não muda');
  assert.equal(moodFor({ videoType: 'custom', skill: { formatDna: { music: { bpm: 126 } } } } as unknown as Project), 'techno', 'BPM do formato escolhe o clima da trilha por código');
  assert.equal(moodFor({ videoType: 'custom', musicStyle: 'lo-fi', skill: { formatDna: { music: { bpm: 126 } } } } as unknown as Project), 'lofi', 'estilo pedido pelo usuário vence');

  /* ───────── skill: blocos por etapa + princípio "estrutura, não identidade" ───────── */
  const k: Skill = { id: 'k', name: 'k', description: '', global: 'regra antiga', steps: { script: 'meu texto' } };
  const sk = applyDnaToSkill(k, dna, measured, undefined, 'Canal Ref', ['só que']);
  assert.deepEqual(sk.formatDna, f, 'DNA estruturado gravado na skill');
  assert.ok(sk.global.includes(STRUCTURE_PRINCIPLE) && sk.global.includes('regra antiga'));
  assert.match(sk.steps['script']!, /meu texto/); assert.match(sk.steps['script']!, /anatomia do gancho/); assert.match(sk.steps['script']!, /Gancho 10%/);
  assert.match(sk.steps['script']!, /linguagem\/PNL: loops abertos/); assert.match(sk.steps['script']!, /use a FUNÇÃO/); assert.match(sk.steps['script']!, /1ª recompensa/);
  assert.match(sk.steps['scene_plan']!, /30% dos takes/); assert.match(sk.steps['scene_plan']!, /snap zoom sempre com SFX/); assert.match(sk.steps['scene_plan']!, /lente simulada: grande-angular/);
  assert.match(sk.steps['scene_plan']!, /profundidade de campo: rasa/); assert.match(sk.steps['scene_plan']!, /128 BPM/); assert.match(sk.steps['scene_plan']!, /sem trilha \(silêncio\)/);
  assert.match(sk.steps['scene_plan']!, /vetores flat/); assert.match(sk.steps['scene_plan']!, /SFX DO FORMATO/);
  assert.match(sk.steps['image']!, /prompt base de estilo/); assert.match(sk.steps['image']!, /contraste/); assert.match(sk.steps['image']!, /o canal do usuário pode ter a dele/);
  assert.match(sk.steps['subtitles']!, /animação do texto: pop\/spring/); assert.match(sk.steps['subtitles']!, /contorno 6 px preto/);
  assert.match(sk.steps['code_scene']!, /SFX DO FORMATO/);
  assert.match(sk.steps['narration']!, /processamento da voz: podcast/);
  assert.match(sk.steps['music']!, /BPM: ≈ 128/); assert.match(sk.steps['music']!, /por ato: tenso → épico/); assert.match(sk.steps['music']!, /corta \(silêncio\)/);
  const again = applyDnaToSkill(sk, dna, measured, undefined, 'Canal Ref');
  assert.equal((again.global.match(/<!-- dna:start -->/g) ?? []).length, 1, 'reaplicar substitui o bloco');
  assert.equal(applyDnaToSkill(k, {}, {}).steps['music'], undefined, 'sem trilha descrita não grava bloco vazio');

  /* ───────── checklist: o que foi medido, o que a IA descreveu e o que faltou ───────── */
  const cov = modelingCoverage(dna, measured, { phrases: ['só que'] });
  assert.equal(cov.length, 21);
  const by = (item: string) => cov.find((x) => x.item.startsWith(item))!;
  assert.equal(by('Palavras por minuto').source, 'medido'); assert.equal(by('Duração média do take').source, 'medido'); assert.equal(by('Jump cuts').value, '30%');
  assert.equal(by('Estrutura de atos').source, 'IA'); assert.equal(by('SFX por minuto').value, '12'); assert.equal(by('Processamento de voz').source, 'IA');
  assert.ok(cov.every((x) => x.source !== 'faltou'), `faltou: ${cov.filter((x) => x.source === 'faltou').map((x) => x.item).join(', ')}`);
  const none = modelingCoverage({}, {});
  assert.equal(none.filter((x) => x.source === 'faltou').length, 21);
  assert.ok(new Set(cov.map((x) => x.group)).size === 4, '4 grupos: roteiro, identidade visual, cinematografia, áudio');

  console.log('dna-checklist: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
