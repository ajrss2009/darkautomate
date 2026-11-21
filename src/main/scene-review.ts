import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Binding, Settings } from '../shared/types';
import * as ff from './ffmpeg';
import { isHttpHarness, resolveHarness, runHarness } from './harness';

/*
 * AGENTE REVISOR VISUAL de cenas 3D (Three.js, avatares de blocos, personagens 2D em mundo 3D): depois do render,
 * uma folha com 8 quadros da cena vai para uma IA com visão, que procura o que a medição automática não pega:
 *  - partes de personagem tapadas (rosto, cabeça, mãos atrás de props/paredes/outros personagens);
 *  - interpenetração: personagens ou objetos atravessando outros, membros entrando no corpo, câmera dentro de objetos;
 *  - pés afundando no chão ou flutuando, personagem cortado nas bordas, rosto virado para longe da câmera na fala.
 * Os problemas voltam ao modelo da cena (até 2 rodadas) — mesma mecânica do revisor do cartoon 3D.
 */

export const REVIEW_CHECKS = [
  'OCLUSÃO: rosto, cabeça, mãos ou corpo de um personagem tapados por prop, parede, móvel, outro personagem ou texto',
  'INTERPENETRAÇÃO: personagens ou objetos atravessando outros (braço dentro do tronco, corpo dentro de mesa/parede, dois personagens sobrepostos)',
  'CÂMERA DENTRO DE OBJETO ou parede (quadro de uma cor só, superfície cobrindo a tela)',
  'APOIO: pés afundando no chão ou personagem flutuando sem motivo; objetos flutuando',
  'ENQUADRAMENTO: personagem que fala cortado pela borda, de costas ou fora do quadro; rosto pequeno demais',
  'TEXTO/ROSTO: letreiro ou legenda cobrindo um rosto; rosto do personagem sem expressão desenhada',
];

/** Defeitos que só existem no quadro VERTICAL (9:16): o público vê uma faixa estreita e o que sobra nas laterais do
 *  16:9 some — personagem na ponta vira meio corpo, três em fila viram um amontoado. Entram na revisão da vertical. */
export const REVIEW_CHECKS_VERTICAL = [
  'PERSONAGEM CORTADO PELA LATERAL: qualquer personagem cujo corpo, braço ou rosto encoste/passe da borda esquerda ou direita do quadro (no vertical isso é corte de verdade, não enquadramento)',
  'MAIS DE 2 PERSONAGENS LADO A LADO no mesmo quadro (no 9:16 só cabem dois; o terceiro tem de estar atrás/depois de um corte)',
  'CABEÇA OU PÉS FORA DO QUADRO: figure inteira (pés no chão e cabelo acima da cabeça) ou, em close, a cabeça inteira com folga',
  'LEGENDA/TEXTO sobre rosto, tronco ou mãos do personagem (a legenda mora na faixa de baixo)',
];

/** Lista de problemas devolvida pela IA (JSON {"issues":[{"t":segundos,"problem":"…","fix":"…"}]}). Função pura. */
export function parseReview(text: string): string[] {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return [];
  try {
    const j = JSON.parse(text.slice(a, b + 1)) as { ok?: boolean; issues?: Array<{ t?: number; time?: number; problem?: string; fix?: string } | string> };
    return (j.issues ?? []).map((x) => typeof x === 'string' ? x : `${x.t ?? x.time !== undefined ? `t≈${Number(x.t ?? x.time).toFixed(1)}s: ` : ''}${x.problem ?? ''}${x.fix ? ` → ${x.fix}` : ''}`)
      .map((x) => x.trim()).filter((x) => x.length > 6).slice(0, 8);
  } catch { return []; }
}

/** Folha 4×2 com 8 quadros espalhados pela cena (com o instante de cada um no nome do arquivo de saída).
 *  `aspect` vertical (9:16) desenha as duas linhas da faixa segura: quem estiver fora delas será cortado. */
export async function reviewSheet(ffmpeg: string, ffprobe: string, video: string, out: string, signal?: AbortSignal, aspect?: string): Promise<{ sheet: string; times: number[] }> {
  const dur = Math.max(0.5, await ff.duration(ffprobe, video).catch(() => 5));
  const times = Array.from({ length: 8 }, (_, i) => Math.min(dur - 0.05, (dur * (i + 0.5)) / 8));
  const vertical = aspect === '9:16' || aspect === '4:5';
  /* faixa central: 22% e 78% da largura (o recorte vertical de uma cena 16:9 fica na faixa central ~56%) */
  const guides = vertical ? `,drawbox=x=iw*0.22:y=0:w=2:h=ih:color=yellow@0.9:t=fill,drawbox=x=iw*0.78:y=0:w=2:h=ih:color=yellow@0.9:t=fill` : '';
  await ff.run(ffmpeg, ['-y', '-v', 'error', '-i', video, '-vf', `fps=${(8 / dur).toFixed(4)},scale=-2:480,drawtext=text='%{pts\\:hms}':x=8:y=8:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.6${guides},tile=4x2`, '-frames:v', '1', out], signal);
  return { sheet: out, times };
}

export function reviewPrompt(sheet: string, sceneDesc: string, o: { aspect?: string; width?: number; height?: number } = {}): string {
  const vertical = o.aspect === '9:16' || o.aspect === '4:5';
  const size = o.width && o.height ? ` (${o.width}×${o.height})` : '';
  return [
    `Você é o REVISOR VISUAL de uma cena 3D animada. Abra a imagem "${sheet}": são 8 quadros da cena em ordem (o tempo está no canto de cada quadro).`,
    o.aspect ? `FORMATO DO VÍDEO: ${o.aspect}${size}.` : '',
    vertical ? `ESTE VÍDEO É VERTICAL: as duas linhas AMARELAS em cada quadro marcam a faixa segura — o público vê só o que está entre elas; o que fica fora some. Trate como defeito GRAVE: personagem cortado pela lateral, mais de 2 personagens lado a lado, cabeça/pés fora do quadro, texto sobre rosto/tronco.` : '',
    sceneDesc ? `O que a cena deveria mostrar: ${sceneDesc.slice(0, 600)}` : '',
    'Procure SOMENTE estes defeitos, quadro a quadro:', [...REVIEW_CHECKS, ...(vertical ? REVIEW_CHECKS_VERTICAL : [])].map((x) => `- ${x}`).join('\n'),
    'Seja rigoroso e concreto: cite o tempo, quem/o quê e como corrigir (ex.: "mover a mesa 2 unidades para trás", "câmera mais alta", "Eddie 1 unidade à esquerda"). Ignore estilo, cores e roteiro.',
    vertical ? 'Para cada quadro, diga também quantos personagens você vê e se algum encosta nas linhas amarelas.' : '',
    'Responda SÓ com JSON: {"ok": true|false, "issues": [{"t": segundos, "problem": "…", "fix": "…"}]} — issues vazio se estiver tudo certo.',
  ].filter(Boolean).join('\n\n');
}

/** Roda o revisor com o primeiro harness da cadeia que funcionar (os CLIs abrem a imagem; HTTP recebe a imagem anexada). */
export async function reviewScene3d(s: Settings, chain: Binding[], video: string, dir: string, sceneDesc: string, signal: AbortSignal, log: (l: string) => void, o: { aspect?: string; width?: number; height?: number } = {}): Promise<string[] | undefined> {
  const { sheet } = await reviewSheet(s.ffmpeg, s.ffprobe ?? s.ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')), video, path.join(dir, 'review-sheet.jpg'), signal, o.aspect);
  if (!fs.existsSync(sheet)) return undefined;
  const prompt = reviewPrompt(sheet, sceneDesc, o);
  /* o revisor precisa ENXERGAR: harnesses com visão primeiro (Antigravity/Gemini, Claude, Codex), depois a cadeia da rota */
  const vision: Binding[] = [{ type: 'harness', harness: 'antigravity' }, { type: 'harness', harness: 'claude', model: 'sonnet' }, { type: 'harness', harness: 'codex' }];
  const ordered = [...vision, ...chain.filter((x) => x.type === 'harness' && !vision.some((v) => v.type === 'harness' && x.type === 'harness' && v.harness === x.harness))];
  for (const b of ordered) {
    try {
      const { id, cfg, model } = await resolveHarness(s, b as Extract<Binding, { type: 'harness' }>);
      log(`agente revisor visual (${id}${model ? '/' + model : ''}): oclusão, interpenetração, câmera, apoio, enquadramento${o.aspect === '9:16' || o.aspect === '4:5' ? ` e faixa segura do ${o.aspect}` : ''}…`);
      const http = isHttpHarness(cfg);
      const r = await runHarness(cfg, { cwd: dir, prompt, model, signal, timeoutSec: 600, images: http ? [sheet] : undefined, tools: http ? undefined : { roots: [dir], allowShell: false } } as Parameters<typeof runHarness>[1]);
      if (!r.ok && !r.stdout.includes('{')) continue;
      return parseReview(r.stdout);
    } catch (e) { log(`revisor visual: ${(e as Error).message.slice(0, 140)}`); }
  }
  return undefined;
}

/** A cena é 3D (Three.js, blocky3d, cartoon3d…)? Função pura sobre o HTML. */
export const is3dScene = (page: string) => /\bfrom\s*["'](?:three(?:\/[^"']*)?|[^"']*(?:blocky3d|cartoon3d)[^"']*)["']|THREE\.(?:Scene|WebGLRenderer|PerspectiveCamera)/.test(page);

/** Pedido de correção (cenas 3D que não são do cartoon3d). */
export function reviewFixPrompt(rel: string, issues: string[], o: { aspect?: string } = {}): string {
  const vertical = o.aspect === '9:16' || o.aspect === '4:5';
  return [
    `AGENTE REVISOR VISUAL — o FilmForge renderizou ${rel} e a revisão com visão encontrou:`,
    issues.map((x) => `- ${x}`).join('\n'),
    `Corrija ${rel} no lugar (grave o arquivo inteiro), mudando só o necessário: posições (x/z) de personagens e objetos para ninguém atravessar ninguém nem ficar atrás de prop; câmera (posição, alvo, lente) para os rostos ficarem livres e inteiros no quadro e a câmera nunca entrar em objetos; altura dos personagens para os pés tocarem o chão; textos longe dos rostos.`,
    vertical ? `ESTE VÍDEO É VERTICAL (${o.aspect}): a câmera mostra uma faixa estreita no centro. Para caber: aproximar os personagens do centro (|x| pequeno), afastar a câmera (aumentar z/distância em 20–40%) e, se houver mais de 2 personagens lado a lado no plano, separá-los em PROFUNDIDADE (um atrás do outro, deslocados em z) ou trocar o plano por um corte com menos gente. Figure inteira (pés e cabeça dentro do quadro) ou close com a cabeça inteira; texto na faixa de baixo.` : '',
    'Mantenha o visual, a história, os textos, os tempos, a fala e os efeitos sonoros. NÃO crie arquivos de teste nem rode comandos: o FilmForge renderiza de novo e revisa sozinho.',
  ].filter(Boolean).join('\n\n');
}

/**
 * A imagem tem o texto pedido, legível? (thumbnail com modelo: o gerador às vezes ignora o texto). Usa um harness com
 * visão; undefined = não deu para conferir.
 */
/**
 * A pessoa da imagem da cena é a MESMA da imagem de referência (1ª cena)? Sem pessoa na cena = ok.
 * undefined = nenhum harness com visão respondeu (quem chama segue sem conferir).
 */
export async function samePerson(s: Settings, image: string, reference: string, signal: AbortSignal, log: (l: string) => void): Promise<boolean | undefined> {
  const dir = path.dirname(image);
  const prompt = `Abra as duas imagens: A = "${reference}" (protagonista) e B = "${image}". Se B não mostra nenhuma pessoa, responda {"ok": true, "why": "sem pessoa"}. ` +
    'Se mostra, a pessoa principal de B é a MESMA de A (mesmo gênero, rosto, cor e corte de cabelo, roupa)? Responda SÓ com JSON: {"ok": true|false, "why": "motivo curto"}';
  for (const b of [{ type: 'harness', harness: 'antigravity' }, { type: 'harness', harness: 'claude', model: 'sonnet' }, { type: 'harness', harness: 'codex' }] as Array<Extract<Binding, { type: 'harness' }>>) {
    try {
      const { id, cfg, model } = await resolveHarness(s, b);
      const http = isHttpHarness(cfg);
      const roots = [...new Set([dir, path.dirname(reference)])];
      const r = await runHarness(cfg, { cwd: dir, prompt, model, signal, timeoutSec: 300, images: http ? [reference, image] : undefined, tools: http ? undefined : { roots, allowShell: false } } as Parameters<typeof runHarness>[1]);
      const m = /\{[\s\S]*\}/.exec(r.stdout);
      if (!m) continue;
      const j = JSON.parse(m[0]) as { ok?: boolean; why?: string };
      log(`conferência da protagonista (${id}): ${j.ok ? 'ok' : 'outra pessoa'} — ${(j.why ?? '').slice(0, 80)}`);
      return !!j.ok;
    } catch { /* próximo harness */ }
  }
  return undefined;
}

export async function imageHasText(s: Settings, image: string, text: string, signal: AbortSignal, log: (l: string) => void): Promise<boolean | undefined> {
  const dir = path.dirname(image);
  const prompt = `Abra a imagem "${image}". Ela contém o texto "${text}" escrito de forma legível (pode ter outra caixa de letra)? Responda SÓ com JSON: {"has": true|false, "seen": "texto que você lê na imagem"}`;
  for (const b of [{ type: 'harness', harness: 'antigravity' }, { type: 'harness', harness: 'claude', model: 'sonnet' }, { type: 'harness', harness: 'codex' }] as Array<Extract<Binding, { type: 'harness' }>>) {
    try {
      const { id, cfg, model } = await resolveHarness(s, b);
      const http = isHttpHarness(cfg);
      const r = await runHarness(cfg, { cwd: dir, prompt, model, signal, timeoutSec: 300, images: http ? [image] : undefined, tools: http ? undefined : { roots: [dir], allowShell: false } } as Parameters<typeof runHarness>[1]);
      const m = /\{[\s\S]*\}/.exec(r.stdout);
      if (!m) continue;
      const j = JSON.parse(m[0]) as { has?: boolean; seen?: string };
      log(`conferência do texto da thumbnail (${id}): ${j.has ? 'ok' : `faltou — a imagem mostra "${(j.seen ?? '').slice(0, 60)}"`}`);
      return !!j.has;
    } catch { /* próximo harness */ }
  }
  return undefined;
}
