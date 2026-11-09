import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, Scene, Skill, StepKind } from '../shared/types';
import { dnaScriptRule, dnaSfxRule, wordsPerSecond } from './channel-dna';
import { identityPrompt, paletteEnglish, projectPalettePrompt } from './channel-setup';
import { charactersPrompt } from './characters';
import { mixPrompt } from './skill-mix';
import { productCtaPrompt } from './clone-business';
import { emotionInstruction } from './speech-emotion';
import { seriesBlock } from './story-import';
import { styleBlock, styleVisual } from './style-ref';
import type { ExecContext } from './engine';
import { pluginPrompt, pluginsRoot } from './plugins';
import { smallModelBudget } from './contract';
import { attachmentsText } from './attachments';
import { projectKit } from './kit';
import { getVideoType } from './presets';
import { readWords, wordsDigest, wordsPath } from './whisper';
import { SFX_LIBRARY, sfxCatalogText } from './sfx';
import { RETENTION_RULES, TITLE_RULES } from './youtube-rules';
import { cartoon3dScenePrompt, storyboardFor, storyboardPrompt } from './cartoon3d';
import { allThumbTemplates } from './thumb-render';
import { mark, stripMarks } from '../shared/strict';

/** Arquivo principal que cada etapa deve produzir. */
export function primaryFile(kind: StepKind, c: Pick<ExecContext, 'projectDir' | 'outDir' | 'sceneDir'>): string {
  const sd = c.sceneDir ?? c.projectDir;
  switch (kind) {
    case 'ideation': return path.join(c.projectDir, 'ideas.json');
    case 'script': return path.join(c.projectDir, 'script.md');
    case 'scene_plan': return path.join(c.projectDir, 'scenes.json');
    case 'asset_design': return path.join(c.projectDir, 'assets', 'assets.md');
    case 'image': return path.join(sd, 'frames', 'frame.png');
    case 'video': return path.join(sd, 'clips', 'clip.mp4');
    case 'code_scene': return path.join(sd, 'code', 'scene.html');
    case 'motion_graphics': return path.join(sd, 'motion', 'scene.html');
    case 'narration': return path.join(sd, 'audio', 'narration.mp3');
    case 'review': return path.join(sd, 'review.json');
    case 'music': return path.join(c.outDir, 'music.mp3');
    case 'sfx': return c.sceneDir ? path.join(c.sceneDir, 'audio', 'sfx.wav') : path.join(c.outDir, 'sfx.json');
    case 'subtitles': return path.join(c.outDir, 'subtitles.srt');
    case 'edit': return path.join(c.outDir, 'final.mp4');
    case 'thumbnail': return path.join(c.outDir, 'thumbnail.png');
    case 'metadata': return path.join(c.outDir, 'metadata.json');
    case 'publish': return path.join(c.outDir, 'publish.json');
    case 'stock_media': return path.join(sd, 'stock', 'stock.json');
    case 'transcribe': return path.join(sd, 'audio', 'words.json');
    case 'brief': return path.join(c.projectDir, 'brief.md');
    case 'free': return path.join(c.outDir, 'final.mp4');
  }
}

export const TEXT_KINDS: StepKind[] = ['ideation', 'script', 'scene_plan', 'asset_design', 'metadata', 'review', 'brief'];

const SCRIPT_KINDS = new Set<string>(['ideation', 'script', 'scene_plan', 'brief', 'free', 'narration']);
/** Vídeo feito só de cenas em código: menos cenas, mais longas (cada cena é uma página que o modelo escreve). */
export const CODE_SCENE_MIN_SEC = 10;
export const CODE_SCENE_MAX_SEC = 19;
export const codeSceneCount = (totalSec: number) => Math.max(1, Math.round(totalSec / ((CODE_SCENE_MIN_SEC + CODE_SCENE_MAX_SEC) / 2)));
export function isLongCodeVideo(p: Project, sceneKinds: Set<string>, pluginsDir: string): boolean {
  if (!sceneKinds.has('code') || ['image', 'video', 'stock'].some((k) => sceneKinds.has(k))) return false;
  if (isMusicClip(p) || isLyricVideo(p)) return false;
  if (p.skill?.linkCapture) return false;   // explicativo de link: trechos curtos (4–8 s) da captura da página
  const kit = projectKit(pluginsDir, p)?.kind;
  return kit !== 'pages' && kit !== 'player';
}

/** História com elenco (dorama, conto com diálogos): várias vozes e uma bíblia de personagens na rota. */
export function isCastStory(p: Project): boolean {
  const steps = (p.route?.steps ?? []).filter((st) => st.enabled);
  const multi = !!p.skill?.multiVoice || steps.some((st) => st.kind === 'narration' && (st.params as Record<string, unknown>)?.['multiVoice'] === true);
  return multi && steps.some((st) => st.kind === 'asset_design');
}

/** Bíblia para a cena em código: aparência e o bloco "## Desenho em código" de assets/assets.md. */
export function codeCastText(projectDir: string, speaker?: string): string {
  const sheet = characterSheet(projectDir);
  if (!sheet.length) return '';
  let draw = '';
  try {
    const md = fs.readFileSync(path.join(projectDir, 'assets', 'assets.md'), 'utf8');
    const at = md.search(/^#+\s*Desenho em código/im);
    if (at >= 0) { const rest = md.slice(at).split('\n').slice(1); const end = rest.findIndex((l) => /^#+\s/.test(l)); draw = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim().slice(0, 3000); }
  } catch { /* sem bíblia */ }
  return `\nELENCO (bíblia de personagens — desenhe cada um SEMPRE com as mesmas formas e cores em todas as cenas):\n${sheet.map((ch) => `- ${ch.name}: ${ch.look}`).join('\n')}` +
    (draw ? `\nDESENHO EM CÓDIGO (siga à risca):\n${draw}` : '') +
    (speaker ? `\nQuem fala nesta cena: ${speaker} — deixe-o em destaque (boca/gesto animados enquanto a fala acontece; os outros reagem).` : '') + '\n';
}

/** Tipos de cena que a rota consegue produzir (evita cena preta). */
export function routeSceneKinds(p: Project): Set<string> {
  const stepKinds = new Set((p.route?.steps ?? []).filter((st) => st.enabled).map((st) => st.kind));
  const sceneKinds = new Set<string>();
  if (stepKinds.has('code_scene')) sceneKinds.add('code');
  if (stepKinds.has('motion_graphics')) sceneKinds.add('motion');
  if (stepKinds.has('stock_media')) { sceneKinds.add('stock'); if (stepKinds.has('code_scene') || stepKinds.has('motion_graphics')) sceneKinds.add('mixed'); }
  if (stepKinds.has('image')) sceneKinds.add('image');
  if (stepKinds.has('video')) sceneKinds.add('video');
  return sceneKinds;
}

type PlanScene = { title?: string; narration?: string; visualIntent?: string; durationSec?: number; kind?: string; sfx?: unknown; manualDuration?: boolean };
const planSec = (s: PlanScene) => s.durationSec && s.durationSec > 0 ? s.durationSec : Math.max(2, (s.narration ?? '').split(/\s+/).filter(Boolean).length / 2.5);

/**
 * Rede de segurança do vídeo em código: modelos pequenos ignoram a duração pedida e devolvem dezenas de cenas de 3–5 s.
 * Junta cenas seguidas (só code/motion) até cada grupo ter ≥ min s sem passar de max s; as etapas viram "então:" no visualIntent.
 */
export function mergeShortCodeScenes<T extends PlanScene>(list: T[], min = CODE_SCENE_MIN_SEC, max = CODE_SCENE_MAX_SEC): T[] {
  if (list.length < 2 || list.some((s) => s.manualDuration || (s.kind && s.kind !== 'code' && s.kind !== 'motion'))) return list;
  const groups: T[][] = [];
  let cur: T[] = [], sec = 0;
  for (const s of list) {
    const d = planSec(s);
    if (cur.length && (sec >= min || sec + d > max)) { groups.push(cur); cur = []; sec = 0; }
    cur.push(s); sec += d;
  }
  if (cur.length) {
    const prev = groups[groups.length - 1];
    if (prev && sec < min && prev.reduce((a, x) => a + planSec(x), 0) + sec <= max) prev.push(...cur); else groups.push(cur);
  }
  if (groups.length === list.length) return list;
  return groups.map((g) => g.length === 1 ? g[0]! : {
    ...g[0]!,
    title: g[0]!.title,
    narration: g.map((x) => x.narration ?? '').filter(Boolean).join(' '),
    visualIntent: g.map((x, i) => (i ? 'então: ' : '') + (x.visualIntent ?? '')).filter((v) => v.trim()).join(' — '),
    durationSec: g.every((x) => x.durationSec) ? Math.round(g.reduce((a, x) => a + x.durationSec!, 0) * 100) / 100 : undefined,
    sfx: g.some((x) => Array.isArray(x.sfx)) ? g.flatMap((x) => Array.isArray(x.sfx) ? x.sfx : []).slice(0, 4) : g[0]!.sfx,
  });
}

const VISUAL_KINDS = new Set<string>(['brief', 'scene_plan', 'asset_design', 'image', 'video', 'code_scene', 'motion_graphics', 'thumbnail', 'free']);
function excerpt(file: string | undefined, max: number): string {
  if (!file) return '';
  try { const t = fs.readFileSync(file, 'utf8').trim(); return t.length > max ? t.slice(0, max) + '\n[…]' : t; } catch { return ''; }
}

/** Roteiro e vídeo de referência escolhidos pelo usuário (adaptar o estilo, nunca copiar). */
export function referenceText(p: Project, kind: string): string {
  const out: string[] = [];
  if (p.refScript?.useAsScript && p.refScript.textFile) {
    /* roteiro do usuário: já está em script.md; as etapas seguintes não reescrevem a fala */
    if (kind !== 'script') out.push(`ROTEIRO FORNECIDO PELO USUÁRIO (script.md${p.refScript.transcribed ? ', transcrito do áudio/vídeo dele' : ''}): mantenha o texto falado EXATAMENTE como está — ao dividir em cenas, a narração de cada cena é um trecho literal e contínuo do roteiro, sem resumir, traduzir nem reescrever.`);
  } else if (p.refScript && SCRIPT_KINDS.has(kind)) {
    const t = excerpt(p.refScript.textFile, 6000);
    out.push(`ROTEIRO DE REFERÊNCIA${p.refScript.transcribed ? ' (transcrição de vídeo)' : ''} — arquivo completo: ${p.refScript.textFile ?? p.refScript.file}. Use-o como MODELO DE ESTILO: estrutura, ritmo, tamanho das frases, ganchos, tom e vocabulário. Adapte esse estilo ao tema deste projeto; NÃO copie frases nem o conteúdo.${t ? '\n---\n' + t + '\n---' : ''}`);
  }
  if (p.refVideo && VISUAL_KINDS.has(kind)) {
    out.push(`VÍDEO DE REFERÊNCIA — ${p.refVideo.file}${p.refVideo.durationSec ? ` (≈ ${Math.round(p.refVideo.durationSec)} s)` : ''}. ` +
      (p.refVideo.frames.length ? `Quadros-chave para observar: ${p.refVideo.frames.join(' | ')}. ` : '') +
      'Inspire-se nele para paleta, composição, enquadramento, tipografia, ritmo de cortes e movimento de câmera do vídeo final, sem copiar marcas, logotipos ou personagens.');
  }
  return out.join('\n');
}

/** Brief escrito pelo orquestrador (brief.md), seguido por todas as etapas seguintes. */
export function briefText(projectDir: string, kind: string): string {
  if (kind === 'brief') return '';
  const t = excerpt(path.join(projectDir, 'brief.md'), 5000);
  return t ? `BRIEF DO ORQUESTRADOR (siga; procure a seção desta etapa em "Diretrizes por etapa"):\n${t}` : '';
}

/** Instruções dos agentes obreiros que assumem esta etapa (por id ou por tipo). */
export function workersFor(p: Project, step: { id: string; kind: string }) {
  return (p.agents?.workers ?? []).filter((w) => (w.handles ?? []).some((x) => x === step.id || x === step.kind));
}
export function workerText(p: Project, step: { id: string; kind: string }): string {
  return workersFor(p, step).map((w) => `AGENTE OBREIRO "${w.name}" (você é este agente nesta etapa): ${w.instructions}`).join('\n');
}

const MIX_LABEL: Record<string, string> = { motion: 'motion graphics por código (cenas "code"/"motion")', stock: 'imagens e vídeos de bancos de mídia (cenas "stock", ou "mixed" = código + mídia de banco)', ai: 'vídeos gerados por IA — MiniMax (cenas "video")' };
export function mixHint(p: Project): string {
  if (p.presentation !== 'mixed') return '';
  const mix = p.skill?.mixSources?.length ? p.skill.mixSources : ['motion', 'stock'];
  return ` Apresentação MISTA (definida pela skill): mescle ${mix.map((m) => MIX_LABEL[m] ?? m).join('; ')}.` +
    (mix.includes('stock') ? ` Bancos: ${(p.mediaSources ?? []).join(', ') || 'pexels, pixabay, wikipedia'}.` : '');
}
export function mixKinds(p: Project): string {
  const mix = p.skill?.mixSources?.length ? p.skill.mixSources : ['motion', 'stock'];
  const k = new Set<string>();
  if (mix.includes('motion')) { k.add('code'); k.add('motion'); }
  if (mix.includes('stock')) { k.add('stock'); k.add('mixed'); }
  if (mix.includes('ai')) k.add('video');
  return [...k].join(', ');
}

export function renderedClip(kind: StepKind, c: Pick<ExecContext, 'sceneDir'>): string | undefined {
  if (!c.sceneDir) return undefined;
  if (kind === 'code_scene') return path.join(c.sceneDir, 'clips', 'code.mp4');
  if (kind === 'motion_graphics') return path.join(c.sceneDir, 'clips', 'motion.mp4');
  return undefined;
}

/**
 * Clipe musical = a rota monta com a ferramenta "clip-musical". Antes bastava o projeto
 * ter musicMode/musicStyle — mas o formulário sempre envia musicMode, e qualquer vídeo
 * criado pela interface virava "clipe musical" (1 cena, prompt de loop no vídeo IA).
 * Projetos antigos sem rota congelada mantêm a regra antiga.
 */
export function isMusicClip(p: Project): boolean {
  if (p.route?.steps?.length) return p.route.steps.some((s) => s.enabled && s.bindings.some((b) => b.type === 'builtin' && b.tool === 'clip-musical'));
  return !!(p.musicStyle || p.musicMode);
}
/** Lyric video = a rota gera a canção com a letra (lyric-song). */
export function isLyricVideo(p: Project): boolean {
  return !!p.route?.steps?.some((s) => s.enabled && s.bindings.some((b) => b.type === 'builtin' && b.tool === 'lyric-song'));
}
/** Parâmetros da montagem do clipe musical (duração do loop, um loop por faixa). */
export function clipParams(p: Project): { loopSeconds: number; perTrack: boolean } {
  const ed = p.route?.steps?.find((s) => s.kind === 'edit' && s.bindings.some((b) => b.type === 'builtin' && b.tool === 'clip-musical'));
  const prm = (ed?.params ?? {}) as Record<string, unknown>;
  const loop = Number(prm['loopSeconds'] ?? 12);
  return { loopSeconds: Number.isFinite(loop) ? Math.max(2, Math.min(15, loop)) : 12, perTrack: prm['perTrackLoop'] === true || String(prm['loopMode'] ?? '') === 'per-track' };
}
/**
 * Coletânea musical: o usuário estima o mínimo e o máximo (minutos); cada faixa tem 60–300 s
 * (padrão 150 s). A duração alvo é o meio do intervalo e define quantas faixas gerar.
 */
export function compilationPlan(p: Project): { minSec: number; maxSec: number; targetSec: number; trackSec: number; tracks: number } {
  const ed = p.route?.steps?.find((s) => s.kind === 'edit' && s.bindings.some((b) => b.type === 'builtin' && b.tool === 'clip-musical'));
  const prm = (ed?.params ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
  const minSec = Math.round(Math.max(60, (num(p.musicMinMin) ?? 0) * 60 || num(prm['minTotalSeconds']) || 120));
  const maxSec = Math.round(Math.max(minSec, (num(p.musicMaxMin) ?? 0) * 60 || num(prm['maxTotalSeconds']) || Math.max(minSec, 360)));
  const targetSec = Math.round((minSec + maxSec) / 2);
  const wanted = num(p.musicTrackSec) ?? ((num(prm['trackSeconds']) ?? 0) >= 60 ? num(prm['trackSeconds'])! : 150);
  const tracks = Math.max(1, Math.round(targetSec / Math.min(300, Math.max(60, wanted))));
  const trackSec = Math.round(Math.min(300, Math.max(Math.min(60, targetSec), targetSec / tracks)));
  return { minSec, maxSec, targetSec, trackSec, tracks };
}

/** Cena por código em loop fechado: só nos clipes musicais ou quando a etapa pede (params.loop). */
export function codeLoops(c: Pick<ExecContext, 'project' | 'step'>): boolean {
  return isMusicClip(c.project) || (c.step.params as Record<string, unknown> | undefined)?.['loop'] === true;
}
/** Como o roteiro termina: o da skill; senão loop nos verticais curtos e conclusão nos demais. */
export function scriptEnding(p: Project): 'loop' | 'next' | 'conclusion' {
  return p.skill?.scriptEnding ?? (p.aspect === '9:16' && p.targetDurationSec <= 90 ? 'loop' : 'conclusion');
}
const ENDING_TEXT = {
  loop: 'fechamento que emende com o início (o vídeo pode repetir em loop sem corte perceptível)',
  next: 'fechamento com um resumo curto e um gancho para o próximo vídeo/episódio',
  conclusion: 'fechamento com uma conclusão clara e uma chamada para ação curta',
};
/** Instrução de voz da skill para TTS que aceita instruções (ex.: gpt-4o-mini-tts). */
export function narrationInstructions(p: Project, scene?: Pick<Scene, 'emotion' | 'delivery'>): string {
  /* a emoção da fala vem primeiro (o corte em 900 caracteres nunca a perde) */
  return [emotionInstruction(scene), p.skill?.steps?.['narration'], p.scriptStyle].filter(Boolean).join(' ').slice(0, 900);
}
/** Voz do personagem da cena (elenco do projeto). */
export function castFor(p: Project, speaker?: string) {
  if (!speaker) return undefined;
  const k = speaker.trim().toLowerCase();
  return (p.cast ?? []).find((m) => m.speaker.trim().toLowerCase() === k);
}

/**
 * Prompt do vídeo IA para clipes musicais: o MESMO frame da cena entra como
 * primeiro e último frame no MiniMax H3 (workflow de loop perfeito). O texto
 * descreve só o movimento cíclico; a composição vem da imagem.
 */
export function loopVideoPrompt(c: ExecContext): string {
  const p = c.project;
  const s = c.scene;
  const vt = getVideoType(p.videoType);
  const subject = s?.videoPrompt?.trim() || s?.visualIntent || p.idea;
  const style = [p.videoStyle, vt?.stylePrompt].filter(Boolean).join(', ');
  return [
    'subject_definitions:',
    '<Subject 1> is the scene shown in <Picture 1>, preserving its composition, characters, clothing, colors, line work, lighting and camera framing exactly.',
    'summary:',
    `[perfect seamless loop] ${subject}`,
    'detailed_description:',
    `${subject}. Locked-off camera, no cuts and no camera shake. The animation is a smooth cyclic motion that returns to the exact starting pose: the first and last frames are the same image, so the clip loops without a visible seam. ` +
      'Keep every element inside the frame; do not let objects, hair or effects cross the frame edge. Subtle environmental motion only (breathing, blinking, steam, rain, leaves, lights, gentle parallax). ' +
      'No text, no subtitles, no logos, no scene changes, no zoom punches and no reverse motion.',
    style ? `Style: ${style}.` : '',
    'overall_soundscape:',
    'Quiet ambient room tone only. No speech, no voices and no music.',
    'non_diegetic_music:',
    'None.',
  ].filter(Boolean).join('\n');
}

export function visualPrompt(c: ExecContext): string {
  const vt = getVideoType(c.project.videoType);
  const s = c.scene;
  if (c.step?.kind === 'video' && isMusicClip(c.project)) return loopVideoPrompt(c);
  const pal = paletteEnglish(c.project.palette?.video);
  /* cenários/objetos da biblioteca citados na cena: mesma aparência sempre */
  const lib = (c.project.characters ?? []).some((x) => x.entity) ? charactersPrompt({ characters: (c.project.characters ?? []).filter((x) => x.entity) }, 'image', s) : '';
  return [s?.visualIntent ?? c.project.idea, s?.notes, characterLock(c.projectDir, s?.visualIntent ?? ''), lib, styleVisual(c.project), c.project.videoStyle, pal && `color palette: ${pal}`,
    c.project.styleRef ? '' : vt?.stylePrompt, s?.camera ? `camera: ${s.camera}` : '']
    .filter(Boolean).join('. ');
}

/**
 * Personagens fixos: a etapa asset_design grava em assets/assets.md uma seção "## Personagens fixos"
 * com linhas "- **Nome**: aparência". Cada prompt de imagem recebe a descrição exata dos personagens
 * citados na cena — assim eles têm a mesma aparência em todas as imagens.
 */
export function characterSheet(projectDir: string): Array<{ name: string; look: string }> {
  try {
    const md = fs.readFileSync(path.join(projectDir, 'assets', 'assets.md'), 'utf8');
    const at = md.search(/^#+\s*Personagens fixos/im);
    if (at < 0) return [];
    const rest = md.slice(at).split('\n').slice(1);
    const end = rest.findIndex((l) => /^#+\s/.test(l));
    return (end < 0 ? rest : rest.slice(0, end)).map((l) => /^\s*[-*]\s*\*\*([^*]+)\*\*\s*[:—–-]\s*(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ name: m[1]!.trim().replace(/:$/, ''), look: m[2]!.trim() }));
  } catch { return []; }
}
export function characterLock(projectDir: string, visual: string): string {
  const low = visual.toLowerCase();
  const hit = characterSheet(projectDir).filter((ch) => ch.name.split(/\s+/).some((w) => w.length > 2 && low.includes(w.toLowerCase())));
  return hit.length ? `SAME CHARACTERS IN EVERY IMAGE, keep identical appearance: ${hit.map((ch) => `${ch.name} = ${ch.look}`).join('; ')}` : '';
}

/** Instrução da skill para esta etapa: por id da etapa, senão pelo tipo. */
export function skillText(p: Project, step: { id: string; kind: string }): string {
  const k = p.skill; if (!k) return '';
  const own = k.steps?.[step.id] ?? k.steps?.[step.kind];
  return [k.global ? `SKILL "${k.name}" — diretrizes gerais: ${k.global}` : '', own ? `SKILL — para esta etapa (${step.kind}): ${own}` : ''].filter(Boolean).join('\n');
}

const LANG_NAMES: Record<string, string> = { 'pt-BR': 'português do Brasil', 'pt-PT': 'português de Portugal', 'en-US': 'inglês (EUA)', 'en-GB': 'inglês (Reino Unido)', 'es-ES': 'espanhol', 'es-MX': 'espanhol (México)', 'fr-FR': 'francês', 'de-DE': 'alemão', 'it-IT': 'italiano', 'ja-JP': 'japonês', 'ko-KR': 'coreano', 'zh-CN': 'chinês' };
/** Estilos opcionais definidos pelo usuário no projeto: roteiro e vídeo (têm prioridade sobre a skill). */
export function userStyles(p: Project): string {
  return [
    p.scriptStyle ? `ESTILO DE ROTEIRO definido pelo usuário (seguir; prevalece sobre a skill): ${p.scriptStyle}` : '',
    p.videoStyle ? `ESTILO DE VÍDEO definido pelo usuário (seguir; prevalece sobre a skill): ${p.videoStyle}` : '',
  ].filter(Boolean).join('\n');
}

export const languageName = (code: string) => LANG_NAMES[code] ?? code;

/** Contexto extra por cena: tempos das palavras (Whisper) e mídias de bancos de imagem/vídeo. */
function sceneContext(c: ExecContext): string {
  if (!c.scene || !c.sceneDir) return '';
  const out: string[] = [];
  const words = readWords(wordsPath(c.sceneDir));
  if (words?.words.length) out.push(`TEMPOS DA NARRAÇÃO (${words.source}) — sincronize aparições/animações com estas palavras (arquivo completo: audio/words.json):\n${wordsDigest(words)}`);
  const stock = path.join(c.sceneDir, 'stock', 'stock.json');
  if (fs.existsSync(stock)) {
    try {
      const j = JSON.parse(fs.readFileSync(stock, 'utf8')) as { assets: Array<{ file: string; kind: string; width?: number; height?: number; author?: string; license?: string }> };
      if (j.assets.length) out.push(`MÍDIAS DE BANCOS (use no HTML com caminho relativo a partir de code/ ou motion/, ex.: "../stock/${j.assets[0]!.file}"; não estique, use object-fit):\n` +
        j.assets.map((a) => `- ../stock/${a.file} (${a.kind}${a.width ? ` ${a.width}x${a.height}` : ''}${a.license ? `, ${a.license}` : ''})`).join('\n'));
    } catch { /* ignora */ }
  }
  return out.length ? '\n' + out.join('\n') + '\n' : '';
}

export function thumbnailPrompt(c: ExecContext): string {
  const p = c.project;
  const list = allThumbTemplates(c.settings);
  const tpl = list.find((t) => t.id === p.thumbnailTemplate) ?? list[0];
  /* layout visual: a imagem é só o FUNDO — o título entra depois, desenhado por código */
  const visual = !!(p.thumbDesign ?? tpl?.design);
  const vt = getVideoType(p.videoType);
  let title = p.name;
  if (p.titleModel?.chosen) title = p.titleModel.chosen;
  let thumbText = p.titleModel?.thumbText || title.split(/\s+/).slice(0, 3).join(' ').toUpperCase();
  /* se o metadata.json já existe (re-execução/render final), usa o título e o texto
     de thumbnail escolhidos pelo SEO em vez do nome do projeto. */
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(c.projectDir, 'out', 'metadata.json'), 'utf8')) as { title?: string; thumbnailText?: string };
    if (meta.title) title = meta.title;
    if (meta.thumbnailText) thumbText = meta.thumbnailText;
  } catch { /* primeira execução: metadata ainda não existe */ }
  const base0 = tpl?.prompt ?? 'YouTube thumbnail, 16:9, {{title}}, bold text "{{thumb_text}}"';
  /* capa vertical/quadrada: os templates foram escritos para 16:9 */
  const base = p.aspect === '16:9' ? base0
    : base0.replace(/YouTube thumbnail/gi, p.aspect === '9:16' ? 'vertical Shorts/Reels cover' : 'social media cover').replace(/16:9/g, p.aspect)
      .replace(/on the left|on the right/gi, 'in the upper half') + ' Keep the title text inside the central safe area.';
  return base.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => ({ title, thumb_text: thumbText, style: vt?.label ?? '', idea: p.idea, aspect: p.aspect })[k] ?? '') +
    (p.skill?.steps?.['thumbnail'] ? `. ${p.skill.steps['thumbnail']}` : '') + (p.videoStyle ? `. ${p.videoStyle}` : '') +
    /* paleta da thumbnail escolhida no Novo projeto (vence o template e o canal) */
    (paletteEnglish(p.palette?.thumbnail ?? p.palette?.video) ? `. Color palette: ${paletteEnglish(p.palette?.thumbnail ?? p.palette?.video)}` : '') +
    (visual ? '. BACKGROUND ONLY: absolutely NO text, letters, numbers or logos in the image (the title is added later); one clear focal point, leave clean space for the title, 3-color high-contrast palette'
      : '. One clear focal point (40-60% of frame, rule of thirds), max 3 words of bold text with outline, 3-color high-contrast palette, legible at 168x94 px');
}

/** Etapas de texto que não precisam de ferramentas (a revisão usa ffprobe/ffmpeg e fica de fora). */
const FOCUSED_KINDS = new Set(['brief', 'ideation', 'script', 'scene_plan', 'asset_design', 'metadata', 'image', 'video', 'thumbnail', 'narration']);

/**
 * Vídeo livre em 3D com Three.js (que vem com o app, sem rede): para modelos treinados em cenas Three.js
 * (ex.: qwen3.5-3d-coder). Mesmo contrato do 2D — render(t) desenha o quadro inteiro a partir de t. Função pura.
 */
export function freeThreeSkeleton(dur: number, fps: number, w: number, h: number, imports: Record<string, string>): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style>
<script type="importmap">${JSON.stringify({ imports })}</script></head>
<body><canvas id="c" width="${w}" height="${h}"></canvas><script type="module">
import * as THREE from "three";
const W = ${w}, H = ${h}, DUR = ${dur};
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#87a9c9');
const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(5, 10, 7); scene.add(sun);
// monte AQUI, uma vez, os objetos da cena (meshes, grupos, materiais) e guarde em variáveis
function render(t) {
  // posicione AQUI câmera, objetos e animações em função de t (0..DUR) — nada de relógio nem estado acumulado
  camera.position.set(Math.sin(t * 0.3) * 12, 6, Math.cos(t * 0.3) * 12); camera.lookAt(0, 1, 0);
  renderer.render(scene, camera);
}
const SFX = [ /* sons nos instantes da animação: { t: 1.2, name: 'impact' }, ... */ ];
window.__forge = { duration: DUR, fps: ${fps}, seek(t) { render(t); }, pause() {}, sfx: SFX };
render(0);
</script></body></html>`;
}

/** Som do vídeo livre: a página só DECLARA os sons (nome + instante); o FilmForge sintetiza e mixa. Lista curta: modelo pequeno. */
export const FREE_SFX_RULE = 'SOM: não escreva código de áudio (nada de AudioContext, Web Audio, osciladores ou <audio>). ' +
  'Em vez disso, preencha a lista SFX do esqueleto com 3 a 8 efeitos nos instantes exatos dos eventos que você anima (entrada de personagem, golpe, explosão, queda, texto que aparece), ex.: ' +
  '[{ t: 0.5, name: "footsteps" }, { t: 3.2, name: "impact" }, { t: 8.8, name: "sparkle" }]. ' +
  `Nomes válidos: ${SFX_LIBRARY.map((d) => d.id).join(', ')}. O FilmForge gera os sons e põe no vídeo. `;

export function freeThreePrompt(p: Pick<Project, 'idea' | 'aspect'>, html: string, dur: number, w: number, h: number, existing: boolean, imports: Record<string, string>, style = ''): string {
  const fps = 30;
  return `${p.idea.trim()}\n\n${style ? style + '\n\n' : ''}---\n` +
    `Entrega: responda SOMENTE com UMA página HTML com uma cena 3D animada em Three.js (versão 0.160.0) que conta este vídeo — ` +
    `nada antes de <!doctype html> e nada depois de </html>. O FilmForge grava a resposta em ${html} e transforma a página no vídeo final. ` +
    `${existing ? `Versão anterior (melhore a partir dela):\n${fs.readFileSync(html, 'utf8').slice(0, 30_000)}\n` : ''}` +
    `Three.js já está disponível SEM rede: importe só com import * as THREE from "three" (o import map do esqueleto aponta para a cópia local). ` +
    'Use apenas o módulo principal (sem addons, OrbitControls ou examples/js); câmera e movimentos você mesmo calcula. ' +
    `Seja compacto: crie objetos com funções reutilizáveis e laços for, nunca dezenas de variáveis parecidas; não repita nomes de variáveis. ` +
    `Quadro: ${w}×${h} px (${p.aspect}). O renderizador chama window.__forge.seek(i/${fps}) para cada um dos ${Math.round(dur * fps)} quadros e fotografa: ` +
    'TODO movimento sai de render(t) a partir de t — sem requestAnimationFrame, setAnimationLoop, Clock, Date.now, performance.now ou Math.random sem seed. ' +
    FREE_SFX_RULE +
    `Use EXATAMENTE este esqueleto (mantenha o import map, o import de THREE, o renderer com preserveDrawingBuffer e a linha do window.__forge):\n` +
    freeThreeSkeleton(dur, fps, w, h, imports);
}

/**
 * Página Three.js: troca imports de CDN (cdnjs, jsdelivr, unpkg, skypack…) do módulo principal pelo nome "three" do
 * import map local, e põe no import map as entradas que faltam (junta com o que já existe). Função pura.
 */
export function ensureThreeImport(page: string, imports: Record<string, string>): string {
  /* addons (examples/jsm, addons/) não vêm com o app: esses ficam como estão e o erro aparece no render */
  let out = page.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(https?:\/\/(?![^"']*(?:examples|addons|jsm)\/)[^"']*three[^"']*)\2/gi, '$1$2three$2');
  if (!/["']three["']/.test(out)) return out;
  const m = /<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/i.exec(out);
  if (m) {
    let map: { imports?: Record<string, string> } = {};
    try { map = JSON.parse(m[1]!); } catch { /* import map inválido: recria */ }
    const merged = { ...map, imports: { ...(map.imports ?? {}), ...Object.fromEntries(Object.entries(imports).filter(([k]) => !map.imports?.[k] || /^https?:/.test(map.imports[k]!))) } };
    return out.slice(0, m.index) + `<script type="importmap">${JSON.stringify(merged)}</script>` + out.slice(m.index + m[0].length);
  }
  const tag = `<script type="importmap">${JSON.stringify({ imports })}</script>`;
  const at = out.search(/<script[^>]*type=["']module["']/i);
  return at >= 0 ? out.slice(0, at) + tag + out.slice(at) : out;
}

/**
 * VÍDEO LIVRE com modelo local (Ollama/LM Studio/llama.cpp): ele não tem como gerar MP4 sozinho
 * (sem Python/ImageMagick na máquina, escrevia scripts que nunca rodavam). Pede uma animação HTML
 * determinística, que o FilmForge renderiza em final.mp4 como faz com as cenas por código.
 */
export function freeHtmlPrompt(p: Pick<Project, 'idea' | 'aspect'>, html: string, dur: number, w: number, h: number, existing: boolean, plugins = '', lib?: FreeLib): string {
  const fps = 30;
  /* modo estrito (modelos locais): plugin, API real e esqueleto marcados → vão ao prompt de sistema em tags XML */
  return `${p.idea.trim()}\n\n${plugins ? mark('plugin', plugins) + '\n\n' : ''}${lib?.names?.length ? mark('api', libApiText(lib)) + '\n\n' : ''}---\n` +
    (lib ? `Entrega: responda SOMENTE com UMA página HTML (HTML+CSS+JS inline, sem rede; Canvas 2D) com a animação deste vídeo, desenhada com a biblioteca do plugin (L) — `
      : `Entrega: responda SOMENTE com UMA página HTML autocontida (HTML+CSS+JS inline, sem rede, sem bibliotecas externas; Canvas 2D ou SVG) com a animação deste vídeo — `) +
    `nada antes de <!doctype html> e nada depois de </html>. O FilmForge grava a resposta em ${html} e transforma a página no vídeo final: ` +
    `você NÃO precisa (e não deve) gerar MP4, rodar Python, ffmpeg ou qualquer comando. ${existing ? `Versão anterior (melhore a partir dela):\n${fs.readFileSync(html, 'utf8').slice(0, 30_000)}\n` : ''}` +
    `Seja compacto: desenhe com funções reutilizáveis e laços, sem repetir blocos de código. ` +
    `Quadro: ${w}×${h} px (${p.aspect}), fundo nunca transparente. ` +
    `O renderizador NÃO roda a página em tempo real: ele chama window.__forge.seek(i/${fps}) para cada um dos ${Math.round(dur * fps)} quadros e fotografa. ` +
    `Por isso TODO o desenho tem de sair de uma função render(t) que desenha o quadro inteiro a partir de t — sem requestAnimationFrame, setInterval, Date.now, performance.now ou Math.random sem seed. ` +
    FREE_SFX_RULE + rigRule(lib?.rigs) +
    `Use EXATAMENTE este esqueleto${lib ? ' (mantenha o import da biblioteca e a linha do window.__forge)' : ''} e escreva a animação dentro de render(t):\n` + mark('example', freeSkeleton(dur, fps, w, h, lib));
}

const CTX_PARAM = /^(?:ctx|g|c|context)$/;

/**
 * <library_api> do vídeo livre com plugin: cada função com a assinatura real e COMO se usa — as que desenham na hora
 * (1º parâmetro = contexto), as que devolvem canvas/função — e um exemplo correto montado com nomes reais da
 * biblioteca. Visto: o 9B guardava SETUP.sky = L.skyGradient(g, …) e chamava SETUP.sky.draw() (desenham e devolvem
 * undefined → a página quebrava em todo quadro). Função pura.
 */
export function libApiText(lib: FreeLib, maxChars = 4500): string {
  const names = lib.names ?? [], fp = lib.firstParam ?? {}, fac = lib.factories ?? {}, sig = (n: string) => `L.${lib.sigs?.[n] ?? `${n}(…)`}`;
  const draw = names.filter((n) => CTX_PARAM.test(fp[n] ?? '') && !fac[n]);
  const canvas = names.filter((n) => fac[n] === 'canvas'), fns = names.filter((n) => fac[n] === 'frame' || fac[n] === 't');
  const other = names.filter((n) => !draw.includes(n) && !canvas.includes(n) && !fns.includes(n) && fp[n] !== undefined);
  const rig = (lib.rigs ?? [])[0]?.name, d1 = draw.find((n) => n !== rig && /sky|grad|back/i.test(n)) ?? draw.find((n) => n !== rig), d2 = draw.find((n) => n !== rig && n !== d1);
  const example = `EXEMPLO CORRETO (estrutura):\n` +
    (canvas[0] ? `const camada = L.${canvas[0]}(W, H);              // canvas: UMA vez, fora do render\n` : '') +
    `function render(t) {\n` +
    (d1 ? `  L.${d1}(g, …);                          // desenha direto, sem guardar o retorno\n` : '') +
    (canvas[0] ? `  g.drawImage(camada, 0, 0);\n` : '') +
    (d2 ? `  L.${d2}(g, …);\n` : '') +
    (rig ? `  L.${rig}(g, x, chao, 1, { gait: t * 10 });  // personagem pronto\n` : '') +
    `}`;
  /* formas do cenário também pela biblioteca (o contrato do plugin recusa ctx.beginPath/arc/fill crus) */
  const shapes = ['ellipse', 'poly', 'fill', 'stroke'].every((n) => names.includes(n))
    ? 'FORMAS DO CENÁRIO (câmaras, sol, folhas, chão): use SEMPRE as da biblioteca, NUNCA ctx.beginPath/arc/ellipse/moveTo/lineTo/fill/stroke crus:\n' +
      'círculo/oval → L.ellipse(g, x, y, rx, ry) e depois L.fill(g, cor) ou L.stroke(g, largura, cor)\n' +
      'polígono/linha → L.poly(g, [[x, y], …]) ou L.smooth(g, pontos) e depois L.fill / L.stroke; traço solto → L.line(g, pontos, largura, cor)\n' +
      'mover/girar/escalar um grupo → L.at(g, x, y, escala, rotação, () => { … })'
    : '';
  const parts = [
    example,
    shapes,
    draw.length ? `DESENHAM NA HORA no canvas (1º parâmetro = o contexto g) e NÃO devolvem nada — chame dentro de render(t), a cada quadro; NUNCA guarde o retorno nem chame .draw():\n${draw.map(sig).join('\n')}` : '',
    canvas.length ? `DEVOLVEM UM CANVAS pronto (camada): crie UMA vez fora do render (const camada = L.nome(W, H)) e desenhe com g.drawImage(camada, x, y):\n${canvas.map(sig).join('\n')}` : '',
    fns.length ? `DEVOLVEM UMA FUNÇÃO que desenha: guarde fora do render (const f = L.nome(…)) e chame f(g, ${fns.some((n) => fac[n] === 't') ? 't ou frame' : 'frame'}) a cada quadro:\n${fns.map((n) => `${sig(n)} → (g, ${fac[n] === 't' ? 't' : 'frame'})`).join('\n')}` : '',
    other.length ? `CÁLCULO / UTILITÁRIOS (devolvem valor; não desenham):\n${other.map(sig).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  /* corta por LINHA (nunca no meio de uma assinatura); o exemplo vem primeiro e sempre fica */
  if (parts.length <= maxChars) return parts;
  const out: string[] = []; let n = 0;
  for (const line of parts.split('\n')) { if (n + line.length + 1 > maxChars) break; out.push(line); n += line.length + 1; }
  return out.join('\n') + '\n… (lista cortada: use só nomes que aparecem acima ou no esqueleto)';
}

/** Separa os argumentos de uma chamada respeitando parênteses/colchetes/chaves (função pura). */
function splitArgs(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Primitivas cruas de Canvas → as MESMAS formas pela biblioteca do plugin (claude-animation tem ellipse/fill/stroke):
 *   x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2)  → L.ellipse(x, cx, cy, r, r)
 *   x.beginPath(); x.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2) → L.ellipse(x, cx, cy, rx, ry, rot)
 *   x.fill() → L.fill(x, x.fillStyle) · x.stroke() → L.stroke(x, x.lineWidth, x.strokeStyle)
 * O desenho é idêntico; o contrato do plugin (só funções da biblioteca) passa a valer. Visto: o 9B desenhava as câmaras
 * do formigueiro com arc/fill e o contrato recusava a página 3 vezes. Função pura.
 */
export function rawCanvasToLib(page: string, names: string[]): { page: string; fixes: number } {
  const has = (n: string) => names.includes(n);
  let fixes = 0, out = page;
  const FULL = /^(?:Math\.PI\s*\*\s*2|2\s*\*\s*Math\.PI|Math\.PI\s*\*\s*2\.0|6\.28\d*|TAU)$/;
  if (has('ellipse')) {
    out = out.replace(/([A-Za-z_$][\w$]*)\.beginPath\(\)\s*;?\s*\1\.(arc|ellipse)\(([^;]*?)\)\s*;/g, (m, ctx: string, kind: string, argsTxt: string) => {
      const a = splitArgs(argsTxt);
      if (kind === 'arc' && a.length >= 5 && /^0(\.0+)?$/.test(a[3]!) && FULL.test(a[4]!.replace(/\s+/g, ' '))) { fixes++; return `L.ellipse(${ctx}, ${a[0]}, ${a[1]}, ${a[2]}, ${a[2]});`; }
      if (kind === 'ellipse' && a.length >= 7 && /^0(\.0+)?$/.test(a[5]!) && FULL.test(a[6]!.replace(/\s+/g, ' '))) { fixes++; return `L.ellipse(${ctx}, ${a[0]}, ${a[1]}, ${a[2]}, ${a[3]}, ${a[4]});`; }
      return m;
    });
  }
  if (has('fill')) out = out.replace(/(?<![\w$.])([A-Za-z_$][\w$]*)\.fill\(\s*\)/g, (_m, ctx: string) => { fixes++; return `L.fill(${ctx}, ${ctx}.fillStyle)`; });
  if (has('stroke')) out = out.replace(/(?<![\w$.])([A-Za-z_$][\w$]*)\.stroke\(\s*\)/g, (_m, ctx: string) => { fixes++; return `L.stroke(${ctx}, ${ctx}.lineWidth, ${ctx}.strokeStyle)`; });
  return { page: out, fixes };
}

/**
 * Uso errado de função que DESENHA (guardar o retorno e tratá-lo como objeto: x = L.grass(g, …); x.draw()) — sempre
 * quebra a página. Devolve o erro no formato do agente de correção, ou undefined. Função pura.
 */
export function freeLibMisuse(page: string, lib: FreeLib): string | undefined {
  const fp = lib.firstParam ?? {}, fac = lib.factories ?? {};
  const bad: string[] = [];
  for (const m of page.matchAll(/([A-Za-z_$][\w$]*)\s*[:=]\s*L\.([A-Za-z_$][\w$]*)\s*\(/g)) {
    const [, holder, fn] = m;
    if (!CTX_PARAM.test(fp[fn!] ?? '') || fac[fn!]) continue;
    /* o retorno guardado é usado como objeto (holder.algo / SETUP.holder.algo) */
    if (new RegExp(String.raw`\b` + holder + String.raw`\s*\.\s*[A-Za-z_$]`).test(page.replace(m[0], ''))) bad.push(fn!);
  }
  if (!bad.length) return undefined;
  const u = [...new Set(bad)];
  return `Erro: ${u.map((n) => `L.${n}`).join(', ')} desenha(m) NA HORA no canvas (o 1º parâmetro é o contexto g) e devolve(m) undefined — não existe(m) em <library_api> como objeto com .draw() ou outros métodos. ` +
    `Reescreva chamando ${u.map((n) => `L.${lib.sigs?.[n] ?? n + '(g, …)'}`).slice(0, 4).join('; ')} DENTRO de render(t), a cada quadro, sem guardar o retorno.`;
}

/**
 * Página que devia usar a biblioteca do plugin: 9B trocava o import do esqueleto por "lib/index.mjs" (não existe,
 * o módulo nem carrega) ou reescrevia a biblioteca à mão. Função pura.
 */
export function freeLibProblem(page: string, line: string, names: string[] = []): string | undefined {
  if (!page.includes(line)) return `a página não tem a linha de import do esqueleto (${line}) — use exatamente ela e chame a biblioteca como L.nome(...)`;
  const other = [...page.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]).filter((x) => !line.includes(x) && x !== 'three');
  if (other.length) return `a página importa arquivos que não existem (${other.slice(0, 3).join(', ')}) — remova esses import; toda a biblioteca já está em L`;
  /* reescrever o rig à mão (visto: function ant(...) { const s = s; ... }) perde o visual do plugin e quebra a página */
  /* só definições de FUNÇÃO: nomes como line, seed, sun e ring também são variáveis comuns */
  const own = names.filter((n) => new RegExp(`(?:function\\s+${n}\\s*\\(|(?:const|let|var)\\s+${n}\\s*=\\s*(?:function\\b|\\([^)]*\\)\\s*=>|\\w+\\s*=>))`).test(page));
  if (own.length) return `a página reescreve funções que a biblioteca já tem (${own.slice(0, 6).join(', ')}) — apague essas definições e chame L.${own[0]}(...) etc.`;
  return undefined;
}

/** Nomes L.x que a página chama e a biblioteca não tem (viram chamada vazia no proxy do _all.mjs; só aviso). Função pura. */
export function freeLibMissing(page: string, names: string[]): string[] {
  /* L.sin/L.cos caem em Math.sin/Math.cos no proxy: não são "faltando" */
  return names.length ? [...new Set([...page.matchAll(/\bL\.(\w+)/g)].map((m) => m[1]))].filter((n) => !names.includes(n) && typeof (Math as unknown as Record<string, unknown>)[n] !== 'function') : [];
}

/**
 * Chamadas à biblioteca do plugin que o modelo errou de um jeito que só tem uma leitura (visto no SenseNova-Loop:
 * L.ants(x, y) para ant(ctx, x, y…) e L.filmFinish(g, W, H) para filmFinish(W, H)) — sem isso a chamada vira vazia
 * no proxy e o visual do plugin some. Pela assinatura real (primeiro parâmetro):
 *  - nome quase certo (plural, maiúsculas, 1–2 letras) com UM candidato → nome certo;
 *  - função que recebe ctx e a chamada não passa o contexto → põe o contexto da página na frente;
 *  - função que NÃO recebe ctx e a chamada começa pelo contexto → tira.
 * Função pura; devolve a página e a lista do que mudou.
 */
export function fixLibCalls(page: string, names: string[], firstParam: Record<string, string>, factories: Record<string, 'frame' | 't' | 'canvas'> = {}): { page: string; fixes: string[] } {
  if (!names.length) return { page, fixes: [] };
  const fixes: string[] = [];
  const isMath = (n: string) => typeof (Math as unknown as Record<string, unknown>)[n] === 'function';
  const lev = (a: string, b: string): number => {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]!; d[0] = i;
      for (let j = 1; j <= b.length; j++) { const tmp = d[j]!; d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
    }
    return d[b.length]!;
  };
  /* 1) nomes */
  const called = [...new Set([...page.matchAll(/\bL\.(\w+)/g)].map((m) => m[1]!))].filter((n) => !names.includes(n) && !isMath(n));
  for (const bad of called) {
    const lower = bad.toLowerCase();
    const cands = [...new Set(names.filter((n) => n.toLowerCase() === lower || n === bad.replace(/e?s$/, '') || bad === `${n}s`
      || (Math.min(n.length, bad.length) >= 4 && lev(n.toLowerCase(), lower) <= (bad.length > 6 ? 2 : 1))))];
    if (cands.length !== 1) continue;
    page = page.replace(new RegExp(`\\bL\\.${bad}\\b`, 'g'), `L.${cands[0]}`);
    fixes.push(`L.${bad} → L.${cands[0]}`);
  }
  /* 2) contexto a mais/a menos, pelo primeiro parâmetro da assinatura */
  const ctxVar = /\b(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*getContext\(\s*['"]2d['"]/.exec(page)?.[1] ?? 'g';
  const ctxParam = (p: string) => /^(ctx|g|c|cx|context)$/i.test(p);
  const ctxArg = (a: string) => a === ctxVar || /^(ctx|g|c|cx|context)$/i.test(a) || /ctx$/i.test(a);
  const edits: Array<{ at: number; del: number; ins: string; what: string }> = [];
  for (const m of page.matchAll(/\bL\.(\w+)\s*\(/g)) {
    const name = m[1]!, fp = firstParam[name];
    if (fp === undefined) continue;
    const start = m.index! + m[0].length;
    let depth = 0, end = start, quote = '';
    for (; end < page.length; end++) {
      const ch = page[end]!;
      if (quote) { if (ch === '\\') end++; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
      else if (ch === ',' && depth === 0) break;
    }
    const first = page.slice(start, end).trim();
    if (ctxParam(fp) && !ctxArg(first)) {
      edits.push({ at: start, del: 0, ins: first ? `${ctxVar}, ` : ctxVar, what: `L.${name}: + ${ctxVar}` });
    } else if (!ctxParam(fp) && fp && first && ctxArg(first) && page[end] === ',') {
      let stop = end + 1;
      while (page[stop] === ' ') stop++;
      edits.push({ at: start, del: stop - start, ins: '', what: `L.${name}: − ${first}` });
    }
  }
  for (const e of edits.sort((a, b) => b.at - a.at)) page = page.slice(0, e.at) + e.ins + page.slice(e.at + e.del);
  for (const w of new Set(edits.map((e) => e.what))) fixes.push(w);
  /* 3) fábrica chamada como instrução solta (o retorno — quem desenha — era jogado fora: o acabamento nunca aparecia).
        Monta UMA vez (guardada em globalThis) e aplica no contexto a cada quadro, com o quadro/tempo de t. */
  const fab: Array<{ at: number; end: number; name: string }> = [];
  for (const m of page.matchAll(/(^|[;{}]\s*|\n\s*)L\.(\w+)\s*\(/g)) {
    const name = m[2]!;
    if (!factories[name]) continue;
    const callAt = m.index! + m[1]!.length;
    let depth = 0, i = callAt + m[0].length - m[1]!.length - 1, quote = '';
    for (; i < page.length; i++) {
      const ch = page[i]!;
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) break;
    }
    if (/^\s*(;|\n|$)/.test(page.slice(i + 1, i + 3))) fab.push({ at: callAt, end: i + 1, name });
  }
  fab.sort((a, b) => b.at - a.at).forEach((f, k) => {
    const call = page.slice(f.at, f.end);
    let repl: string;
    if (factories[f.name] === 'canvas') {
      /* camada pronta (paper, soil…): desenha a imagem; soil(W, H - G) vai no chão (y = G), como no template do plugin */
      const args = call.slice(call.indexOf('(') + 1, -1).split(',').map((a) => a.trim());
      const y = /^H\s*-\s*(.+)$/.exec(args[1] ?? '')?.[1] ?? '0';
      repl = `${ctxVar}.drawImage((globalThis.__forgeFab${k} ??= ${call}), 0, ${y})`;
    } else {
      const arg = factories[f.name] === 't' ? 't' : 'Math.round(t * ((window.__forge && window.__forge.fps) || 30))';
      repl = `(globalThis.__forgeFab${k} ??= ${call})(${ctxVar}, ${arg})`;
    }
    page = page.slice(0, f.at) + repl + page.slice(f.end);
  });
  for (const f of new Set(fab.map((x) => x.name))) fixes.push(factories[f] === 'canvas' ? `L.${f}(...) devolve uma imagem: desenhada com drawImage` : `L.${f}(...) monta o efeito: aplicado a cada quadro`);
  /* 4) variável que guarda o efeito montado chamada como objeto (visto: const S = L.filmFinish(...); … S.finish(ctx, i)) */
  for (const m of [...page.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*L\.(\w+)\s*\(/g)]) {
    if (factories[m[2]!] !== 'frame' && factories[m[2]!] !== 't') continue;
    const re = new RegExp(`\\b${m[1]}\\.\\w+\\s*\\(`, 'g');
    if (!re.test(page)) continue;
    page = page.replace(re, `${m[1]}(`);
    fixes.push(`${m[1]} = L.${m[2]}(...) é o próprio efeito: ${m[1]}.x(...) → ${m[1]}(...)`);
  }
  return { page, fixes };
}

/** Recoloca o import map do adaptador de canvas quando o modelo o apagou do <head> (o módulo da biblioteca não carrega sem ele). Função pura. */
export function ensureImportMap(page: string, importmap: string): string {
  if (!importmap || page.includes('type="importmap"') || page.includes("type='importmap'")) return page;
  const at = page.search(/<script[^>]*type=["']module["']/i);
  return at >= 0 ? page.slice(0, at) + importmap + page.slice(at) : page;
}

/** Biblioteca de um plugin no vídeo livre: import map do adaptador de canvas + import da biblioteca inteira como L. */
export interface FreeLib { importmap: string; line: string; names?: string[]; firstParam?: Record<string, string>; /** assinaturas "nome(a, b = 1)" (library_api) */ sigs?: Record<string, string>; factories?: Record<string, 'frame' | 't' | 'canvas'>; rigs?: Array<{ name: string; what: string }> }

/**
 * Personagens: modelo pequeno desenhava formiga/robô à mão (bonecos de palito) com o rig pronto na biblioteca.
 * Lista "o que cada rig desenha" e manda usar um rig para TODO personagem que tenha um parecido. Função pura.
 */
export function rigRule(rigs: Array<{ name: string; what: string }> | undefined): string {
  if (!rigs?.length) return '';
  return `PERSONAGENS — OBRIGATÓRIO usar os rigs prontos da biblioteca (desenhados no estilo do plugin, com poses e animação): ` +
    rigs.map((r) => `L.${r.name}${r.what ? ` = ${r.what}` : ''}`).join('; ') + '. ' +
    'Para cada personagem do vídeo escolha o rig mais parecido (ex.: barata → L.roach, robô → L.robot, formiga → L.ant, besouro → L.bug, pessoa → L.chibi) e chame L.nome(g, x, chão, escala, { gait: t * 10, ... }) dentro de render(t). ' +
    'NÃO escreva funções próprias para desenhar personagens que têm rig; cenário e objetos com as formas da biblioteca (L.ellipse, L.poly, L.fill, L.stroke…), não com ctx.beginPath/arc crus. ';
}

/**
 * A página definiu a PRÓPRIA função com o nome de um rig (function robot(ctx, …) com bonecos de palito): renomeia a
 * definição para que as chamadas usem o rig da biblioteca (importBareLibNames traz o nome de L). Função pura.
 */
export function preferLibRigs(page: string, rigs: string[]): { page: string; replaced: string[] } {
  const replaced: string[] = [];
  for (const n of rigs) {
    const def = new RegExp(`(\\bfunction\\s+)${n}(\\s*\\()|(\\b(?:const|let|var)\\s+)${n}(\\s*=\\s*(?:function\\b|\\([^)]*\\)\\s*=>))`, 'g');
    if (!def.test(page)) continue;
    page = page.replace(def, (_m, f1, f2, v1, v2) => f1 !== undefined ? `${f1}${n}_seuDesenho${f2}` : `${v1}${n}_seuDesenho${v2}`);
    replaced.push(n);
  }
  return { page, replaced };
}

/** Esqueleto da página do vídeo livre: modelos pequenos copiavam o contrato com seek(t){} vazio (função pura). */
export function freeSkeleton(dur: number, fps: number, w: number, h: number, lib?: FreeLib): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh;object-fit:contain}</style>${lib?.importmap ?? ''}</head>
<body><canvas id="c" width="${w}" height="${h}"></canvas><script${lib ? ' type="module"' : ''}>
${lib ? lib.line + '\n' : ''}const W = ${w}, H = ${h}, DUR = ${dur};
const g = document.getElementById('c').getContext('2d');
function render(t) {
  g.clearRect(0, 0, W, H);
  // desenhe AQUI o quadro inteiro em função de t (0..DUR): fundo, cenário, personagens, efeitos${lib ? ' — com as funções da biblioteca: L.nome(g, ...)' : ''}
}
const SFX = [ /* sons nos instantes da animação: { t: 1.2, name: 'impact' }, ... */ ];
window.__forge = { duration: DUR, fps: ${fps}, seek(t) { render(t); }, pause() {}, sfx: SFX };
render(0);
</script></body></html>`;
}

/**
 * Página HTML de uma resposta de modelo: do primeiro <!doctype/<html> ao último </html>, direto do texto
 * cru. Tirar só a primeira cerca ``` perdia o resto quando o modelo separava HTML, CSS e JS em blocos (função pura).
 */
export function extractHtmlPage(text: string): string {
  /* modelo que "pensa" em texto (<think>…</think>, visto no SenseNova Code2Video): o rascunho pode ter trechos de HTML */
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const start = text.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return text.replace(/^[\s\S]*?```(?:\w+)?\n/, '').replace(/```[\s\S]*$/, '').trim();
  const end = text.toLowerCase().lastIndexOf('</html>');
  return (end > start ? text.slice(start, end + 7) : text.slice(start).replace(/```[\s\S]*$/, '')).trim();
}

/**
 * Recoloca o contrato quando o modelo manteve o render(t) do esqueleto mas apagou a linha do window.__forge
 * (visto com qwen 9B: trocava pelo laço `while (frame < DUR*fps) render(frame/fps)`). Função pura.
 */
/**
 * Desestruturação com nomes repetidos — `const { stroke, fill, ellipse, stroke, fill, ellipse … } = L;` (SenseNova-Loop
 * entrou em repetição dentro da linha): "Identifier 'ellipse' has already been declared" e a página nem carrega; ao
 * corrigir, o modelo copiava a mesma linha. Mantém a primeira ocorrência de cada nome. Função pura.
 */
export function dedupeDestructuring(page: string): { page: string; removed: string[] } {
  const removed: string[] = [];
  const out = page.replace(/\b(const|let|var)(\s*\{)([^{}]*)(\}\s*=)/g, (all, kw: string, open: string, body: string, close: string) => {
    const seen = new Set<string>(), keep: string[] = [];
    for (const raw of body.split(',')) {
      const item = raw.trim();
      if (!item) continue;
      /* nome local: "a", "a: b" → b, "a = 1" → a */
      const local = /^(?:\.\.\.)?\s*(?:[\w$]+\s*:\s*)?([\w$]+)/.exec(item)?.[1];
      if (local && seen.has(local)) { removed.push(local); continue; }
      if (local) seen.add(local);
      keep.push(item);
    }
    return keep.length === body.split(',').filter((x) => x.trim()).length ? all : `${kw}${open} ${keep.join(', ')} ${close}`;
  });
  return { page: out, removed };
}

/**
 * Funções da biblioteca chamadas soltas, sem L. e sem declarar — `clamp((d - .3) / 1.6)` (SenseNova-Loop):
 * "clamp is not defined" no primeiro quadro. Traz da biblioteca logo depois do import: `const { clamp } = L;`.
 * Só nomes que a página não declara em lugar nenhum. Função pura.
 */
export function importBareLibNames(page: string, names: string[], line: string): { page: string; added: string[] } {
  const at = page.indexOf(line);
  if (at < 0 || !names.length) return { page, added: [] };
  const declared = (n: string) => new RegExp(`(?:function\\s*\\*?\\s*${n}\\s*\\(|\\b(?:const|let|var|class)\\s+${n}\\b|[{,]\\s*(?:\\w+\\s*:\\s*)?${n}\\s*(?:[,}]|=[^=>])|\\(\\s*${n}\\s*[,)]|,\\s*${n}\\s*\\)|\\b${n}\\s*=>)`).test(page);
  const added = names.filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && new RegExp(`(?<![\\w$.])${n}\\s*\\(`).test(page) && !declared(n));
  if (!added.length) return { page, added };
  const end = at + line.length;
  return { page: `${page.slice(0, end)}\nconst { ${added.join(', ')} } = L;   /* trazidas da biblioteca pelo FilmForge */${page.slice(end)}`, added };
}

/**
 * Arrow com várias instruções sem chaves, como argumento de chamada — erro clássico de modelo pequeno:
 * `arr.forEach((p) => ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.stroke());` ("missing ) after argument list").
 * Um ";" fora de parênteses num argumento nunca é JS válido, então pôr o corpo entre chaves é sempre seguro.
 * Linha a linha; devolve a página e quantas correções fez. Função pura.
 */
export function fixArrowBodies(page: string): { page: string; fixes: number } {
  let fixes = 0;
  const lines = page.split('\n').map((line) => {
    let from = 0;
    for (;;) {
      const at = line.indexOf('=>', from);
      if (at < 0) return line;
      let i = at + 2;
      while (line[i] === ' ' || line[i] === '\t') i++;
      from = i;
      if (line[i] === '{' || i >= line.length) continue;
      let depth = 0, quote = '', semi = false, close = -1;
      for (let j = i; j < line.length && close < 0; j++) {
        const ch = line[j]!;
        if (quote) { if (ch === '\\') j++; else if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'" || ch === '`') quote = ch;
        else if (ch === '/' && line[j + 1] === '/') break;
        else if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) { if (depth === 0) { if (ch === ')') close = j; break; } depth--; }
        else if (ch === ';' && depth === 0) semi = true;
      }
      if (close < 0 || !semi) continue;
      const body = line.slice(i, close).trim().replace(/;+$/, '');
      line = `${line.slice(0, i)}{ ${body}; }${line.slice(close)}`;
      fixes++;
    }
  });
  return { page: lines.join('\n'), fixes };
}

/**
 * A página preencheu a lista SFX do esqueleto mas reescreveu o window.__forge sem "sfx: SFX": liga a lista no
 * fim do mesmo script (lá o __forge já existe; em módulo, SFX não é global). Função pura.
 */
export function ensureSfxExport(page: string): string {
  const at = page.search(/\b(?:const|let|var)\s+SFX\s*=/);
  if (at < 0 || /\bsfx\s*:\s*SFX\b|__forge\.sfx\s*=/.test(page)) return page;
  const close = page.toLowerCase().indexOf('</script>', at);
  return close < 0 ? page : page.slice(0, close) + '\ntry { window.__forge.sfx = SFX; } catch (e) {}\n' + page.slice(close);
}

export function ensureForgeContract(page: string, dur: number, fps = 30): { page: string; added: boolean } {
  if (page.includes('__forge') || !/function\s+render\s*\(\s*\w+\s*\)/.test(page)) return { page, added: false };
  const contract = `/* contrato adicionado pelo FilmForge */window.__forge={duration:${dur},fps:${fps},seek(t){render(t);},pause(){},sfx:typeof SFX!=='undefined'?SFX:[]};`;
  /* página em módulo (biblioteca do plugin): render(t) não é global — o contrato entra no fim do próprio módulo */
  const mod = page.search(/<script[^>]*type=["']module["'][^>]*>/i);
  if (mod >= 0) {
    const close = page.toLowerCase().indexOf('</script>', mod);
    if (close >= 0) return { page: page.slice(0, close) + contract + '\n' + page.slice(close), added: true };
  }
  const hook = `<script>${contract}</script>`;
  const at = page.toLowerCase().lastIndexOf('</body>');
  return { page: at >= 0 ? page.slice(0, at) + hook + page.slice(at) : page + hook, added: true };
}

/**
 * Canvas tolerante, antes de qualquer script da página: modelo pequeno chama ctx.scale(s) / ctx.translate(x) com um
 * argumento só ("2 arguments required, but only 1 present" em todo quadro). scale(s) vira scale(s, s); translate(x),
 * translate(x, 0). Nada muda em chamadas certas. Idempotente. Função pura.
 */
export function ensureCanvasShim(page: string): string {
  if (page.includes('__forgeCanvasShim')) return page;
  /* também: drawImage com algo que não é imagem (função/objeto da biblioteca, canvas 0×0) é ignorado em vez de
     derrubar o quadro inteiro; fill/stroke com objeto que não é Path2D (ex.: L.fill(path) confundido) viram fill()/stroke() */
  const shim = '<script>/* __forgeCanvasShim (FilmForge) */(()=>{const P=CanvasRenderingContext2D.prototype,s=P.scale,t=P.translate,d=P.drawImage,f=P.fill,k=P.stroke;'
    + 'P.scale=function(x,y){return s.call(this,x,arguments.length<2?x:y)};P.translate=function(x,y){return t.call(this,x,arguments.length<2?0:y)};'
    + 'P.drawImage=function(){try{return d.apply(this,arguments)}catch(e){}};'
    + 'const np=(a)=>a!=null&&typeof a==="object"&&!(a instanceof Path2D);'
    + 'P.fill=function(a){return np(a)?f.call(this):f.apply(this,arguments)};P.stroke=function(a){return np(a)?k.call(this):k.apply(this,arguments)};})();</script>';
  const head = page.search(/<head[^>]*>/i);
  if (head >= 0) { const end = page.indexOf('>', head) + 1; return page.slice(0, end) + shim + page.slice(end); }
  const first = page.search(/<script/i);
  return first >= 0 ? page.slice(0, first) + shim + page.slice(first) : shim + page;
}

/**
 * Problema que impede a página do vídeo livre de virar vídeo (ou undefined se está ok). Função pura:
 * o executor devolve o texto ao modelo para UMA correção.
 */
export function freeHtmlProblem(page: string): string | undefined {
  if (!page.includes('__forge')) return 'a página não define window.__forge';
  if (!/<\/html>\s*$/i.test(page.trim()) && !/<\/script>/i.test(page.slice(-400))) return 'a página veio cortada (sem </script>/</html> no fim)';
  if (/seek\s*(?::\s*(?:function\s*)?)?\(\s*\w*\s*\)\s*(?:=>\s*)?\{\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)?\s*\}/.test(page))
    return 'seek(t) está vazio — ele precisa chamar render(t), que desenha o quadro inteiro em função de t';
  return undefined;
}

/** Pedido da etapa sem as marcas do modo estrito (CLIs, APIs, testes). */
export function buildPrompt(c: ExecContext): string { return stripMarks(buildPromptMarked(c)); }

/** Etapas sem visual nem texto na tela: a identidade do canal não entra no prompt. */
const NO_IDENTITY_KINDS = new Set(['narration', 'transcribe', 'music', 'sfx', 'publish', 'edit']);

/** Pedido com as partes de REGRA marcadas (skill, plugins, API, exemplos): os harnesses locais as levam ao prompt de sistema. */
export function buildPromptMarked(c: ExecContext): string {
  const p = c.project;
  /* modelos locais pequenos (9B em servidor local, nome com "…9b"…): bloco de plugins menor para caber no contexto */
  const bnd = c.binding as { harness?: string; provider?: string; model?: string };
  const budget = smallModelBudget(bnd?.harness ?? bnd?.provider, bnd?.model);
  /* VÍDEO LIVRE: vai SÓ o prompt do usuário para o harness escolhido.
     Nada de skill, estilo, idioma, formato, memórias ou referências — apenas o
     pedido, os plugins que o usuário ligou no projeto e a linha de entrega
     (necessária para o arquivo existir no fim). */
  if (c.step.kind === 'free') {
    const out = primaryFile(c.step.kind, c);
    const plugins = pluginPrompt(c.settings, p.plugins, p.pluginStyles, { projectDir: c.projectDir, stepKind: 'free', budget });
    return `${p.idea.trim()}\n\n${plugins ? plugins + '\n\n' : ''}---\nEntrega: grave o vídeo final em ${out} (crie a pasta, se precisar).`;
  }
  const vt = getVideoType(p.videoType);
  const file = primaryFile(c.step.kind, c);
  const mem = p.memories.length ? `\nREGRAS (memórias, nunca violar):\n${p.memories.map((m) => `- ${m}`).join('\n')}\n` : '';
  const mixed = p.presentation === 'mixed';
  /* tipos de cena que a rota realmente consegue produzir (evita cena preta) */
  const stepKinds = new Set((p.route?.steps ?? []).filter((st) => st.enabled).map((st) => st.kind));
  const sceneKinds = routeSceneKinds(p);
  const availableKinds = sceneKinds.size ? `Nesta rota, os únicos tipos com etapa de produção são: ${[...sceneKinds].join(', ')}. Use SOMENTE esses tipos.` : '';
  /* identidade do canal de destino (paleta, tipografia, thumbnail): vence a do formato clonado — do clone, só a estrutura */
  const channel = p.channelId && !NO_IDENTITY_KINDS.has(c.step.kind) ? (c.settings.channels ?? []).find((x) => x.id === p.channelId) : undefined;
  const skill = [skillText(p, c.step), userStyles(p), identityPrompt(channel, c.step.kind), projectPalettePrompt(p.palette, c.step.kind),
    charactersPrompt(p, c.step.kind, c.scene), mixPrompt(p, c.step.kind), productCtaPrompt(channel?.products, c.step.kind),
    seriesBlock(p, c.step.kind), styleBlock(p, c.step.kind)].filter(Boolean).join('\n');
  const extra = [workerText(p, c.step), briefText(c.projectDir, c.step.kind), referenceText(p, c.step.kind),
    attachmentsText(p, c.projectDir, c.step.kind, c.scene, (c.step.kind === 'code_scene' || c.step.kind === 'motion_graphics') && c.sceneDir ? path.dirname(primaryFile(c.step.kind, c)) : undefined)].filter(Boolean).join('\n');
  const plugins = pluginPrompt(c.settings, p.plugins, p.pluginStyles, { projectDir: c.projectDir, stepKind: c.step.kind, sceneDir: c.sceneDir, budget });
  const head = `Você é um módulo de produção do FilmForge. IDIOMA do vídeo (narração, textos na tela, título, descrição): ${languageName(p.language)} (${p.language}). Aparência: ${vt?.label ?? p.videoType}. ` +
    `Formato ${p.aspect}, duração alvo ${p.targetDurationSec}s. Nível de qualidade: ${p.quality}.` +
    (p.musicStyle ? ` Estilo musical do projeto: ${p.musicStyle}.` : '') +
    (p.musicMode ? ` Música: ${p.musicMode === 'song' ? 'canção (com letra)' : 'instrumental'}.` : '') +
    (p.waveform ? ` Waveform: ${p.waveform}.` : '') +
    mixHint(p) +
    `${mem}${skill ? '\n' + mark('skill', skill) + '\n' : ''}${plugins ? '\n' + mark('plugin', plugins) + '\n' : ''}${extra ? extra + '\n' : ''}\n` +
    `Trabalhe SOMENTE dentro do diretório atual e de ${path.dirname(file)}. Grave o resultado em: ${file}\n` +
    /* agentes (Antigravity, Claude Code, OpenCode) gastavam minutos explorando a pasta, relendo project.json, rodando git/
       powershell/python para contar palavras e abrindo backups antigos antes de escrever uma etapa de texto */
    (FOCUSED_KINDS.has(c.step.kind) ? `TRABALHE RÁPIDO: tudo o que você precisa está neste pedido e nos arquivos citados nele. NÃO explore pastas, NÃO rode comandos (git, powershell, python, node), NÃO abra project.json, backups, caches nem versões antigas; leia só os arquivos citados, grave ${path.basename(file)} numa única gravação e termine.\n` : '');
  const s = c.scene;
  const sceneInfo = s ? `\nCENA ${s.index} "${s.title}"\n${s.speaker ? `Personagem que fala: ${s.speaker}${castFor(p, s.speaker)?.description ? ` (${castFor(p, s.speaker)!.description})` : ''}\n` : ''}${isLyricVideo(p) ? 'Letra deste bloco' : 'Narração'}: ${s.narration}\nVisual: ${s.visualIntent}\nTipo: ${s.kind}\nDuração: ${s.durationSec ?? 'definir pela narração'}s\n${s.userMedia ? `Arquivo do usuário nesta cena: "${s.userMedia}"${s.clipStart ? ` a partir de ${s.clipStart} s (no <video>: currentTime = ${s.clipStart} + t)` : ''}\n` : ''}${s.notes ? `AJUSTES SOLICITADOS PELO USUÁRIO (prioridade máxima): ${s.notes}\n` : ''}` : '';
  switch (c.step.kind) {
    case 'brief': {
      const o = p.agents?.orchestrator;
      const steps = (p.route?.steps ?? []).filter((x) => x.enabled && x.kind !== 'brief').map((x) => `${x.id} (${x.kind}${x.scope === 'scene' ? ', por cena' : ''})`).join(', ');
      const workers = (p.agents?.workers ?? []).map((w) => `- ${w.name}: assume ${(w.handles ?? []).join(', ') || 'apoio geral'} — ${w.description}`).join('\n');
      return head + `\nVOCÊ É O ORQUESTRADOR "${o?.name ?? 'Diretor'}". ${o?.instructions ?? ''}\nIdeia do projeto: ${p.idea}\nEtapas da rota: ${steps}.\n` +
        (workers ? `Obreiros da equipe:\n${workers}\n` : '') +
        (p.maxProductionMin ? `Tempo máximo para produzir: ${p.maxProductionMin} min. Planeje para caber nesse prazo (menos cenas ou cenas mais simples, se preciso).\n` : '') +
        `Escreva em ${file} um BRIEF em Markdown com: 1) conceito e público; 2) estrutura e ritmo (quantas cenas, duração média); 3) bíblia visual (paleta em hex, tipografia, personagens/objetos recorrentes com descrição fixa, câmera); ` +
        `4) tom da narração; 5) "## Diretrizes por etapa", uma subseção por etapa (use o id da etapa) com o que o obreiro deve fazer e o critério de qualidade; 6) riscos e como evitá-los. Seja concreto e curto (até 900 palavras).`;
    }
    case 'ideation':
      return head + `\nTema/canal/ideia: ${p.idea}\nGere 10 ideias de vídeo com gancho forte em JSON: [{"title","hook","angle"}].`;
    case 'script':
      if (isMusicClip(p) || isLyricVideo(p)) {
        return head + `\nIdeia: ${p.idea}\nEscreva ${file} EXATAMENTE no formato pedido pela skill (conceito visual, plano de músicas/letra). Não escreva narração falada.` +
          (isMusicClip(p) ? (() => { const cp = compilationPlan(p); return `\nCOLETÂNEA DEFINIDA PELO USUÁRIO (prevalece sobre números da skill): duração total entre ${Math.round(cp.minSec / 60)} e ${Math.round(cp.maxSec / 60)} minutos. ` +
            `O MUSIC_PLAN deve ter EXATAMENTE ${cp.tracks} faixas com "seconds": ${cp.trackSec} cada (≈ ${Math.round(cp.tracks * cp.trackSec / 60)} min no total), nomes únicos e estilos variados dentro do mesmo clima` +
            `${p.musicMode === 'song' ? '' : '; instrumental: "lyrics": "[instrumental]" em todas'}.`; })() : '');
      }
      return head + `\nIdeia: ${p.idea}\nPesquise e verifique fatos quando possível. Escreva o roteiro narrado em Markdown, com gancho nos 3 primeiros segundos, ritmo para retenção e ${ENDING_TEXT[scriptEnding(p)]}. ` +
        (p.targetDurationSec >= 120 ? `${RETENTION_RULES} ` : 'Vídeo curto: a primeira frase já é o gancho; uma ideia por frase, sem introdução. ') +
        /* a narração define a duração do vídeo: sem limite, um "vídeo de 10 s" saía com 55 palavras (28 s de voz) */
        (p.targetDurationSec > 0 ? (p.targetDurationSec >= 60
          /* vídeo longo: só com o teto, o modelo escrevia bem menos (episódio de 3 min saiu com 2 min de voz) — pede a faixa */
          ? `TAMANHO: a narração define a duração (${p.targetDurationSec} s) — escreva ENTRE ${Math.round(wordBudget(p) * 0.9)} e ${wordBudget(p)} palavras faladas no total (≈ ${wpsText(p)} palavras/s); conte as palavras antes de gravar: se faltar, desenvolva as batidas com fatos, números e exemplos concretos (sem enrolação); se passar, corte (a linha de fontes e os títulos de capítulo não contam). `
          : `TAMANHO: a narração tem de caber em ${p.targetDurationSec} s — no máximo ${wordBudget(p)} palavras faladas no total (≈ ${wpsText(p)} palavras/s); conte as palavras antes de gravar e corte o que passar (a linha de fontes não conta). `) : '') +
        (p.titleModel?.chosen ? `O roteiro precisa cumprir a promessa do título "${p.titleModel.chosen}" logo no início. ` : '') +
        /* DNA estruturado do formato (canal clonado): gancho de 15 s, atos com %, densidade e função das transições */
        (p.skill?.formatDna ? `${dnaScriptRule(p.skill.formatDna, p.targetDurationSec)} ` : '') +
        `Apenas o texto a ser falado, organizado por blocos` +
        (p.skill?.multiVoice ? ' — como é um diálogo, escreva cada fala numa linha no formato "NOME: fala".' : '.');
    case 'scene_plan': {
      const codeMusic = isMusicClip(p) && sceneKinds.has('code') && !sceneKinds.has('video');
      const clip = clipParams(p);
      const timing = isLyricVideo(p) ? excerpt(path.join(c.outDir, 'lyrics-timing.json'), 6000) : '';
      const multi = !!p.skill?.multiVoice || (p.route?.steps ?? []).some((st) => st.kind === 'narration' && (st.params as Record<string, unknown>)?.['multiVoice'] === true);
      const longCode = isLongCodeVideo(p, sceneKinds, pluginsRoot(c.settings)) && !timing;
      const sceneVideos = (p.attachments ?? []).filter((a) => a.use === 'scene' && a.kind === 'video');
      return head + `\nLeia ${path.join(c.projectDir, 'script.md')}. Divida em cenas (${p.sceneSec
        ? `DURAÇÃO DEFINIDA NO PROJETO (vence a skill): cada cena com ≈ ${p.sceneSec} s, ou seja ≈ ${Math.max(1, Math.round(p.targetDurationSec / p.sceneSec))} cenas; cortes e mudanças de enquadramento ficam DENTRO da cena e são descritos no visualIntent`
        : longCode
          ? `VÍDEO EM CÓDIGO (vence a skill): POUCAS cenas longas, cada uma com ${CODE_SCENE_MIN_SEC} a ${CODE_SCENE_MAX_SEC} s (nunca menos de ${CODE_SCENE_MIN_SEC} s), ou seja ≈ ${codeSceneCount(p.targetDurationSec)} cenas; junte trechos seguidos da narração na mesma cena e descreva no visualIntent as 2 a 4 etapas que a animação percorre dentro dela (o que entra, o que muda, como termina)`
          : 'duração por cena conforme a skill; padrão 3–8 s'}; total ≈ ${p.targetDurationSec}s). ` +
        `SOMA OBRIGATÓRIA: a soma de "durationSec" DEVE ficar entre ${Math.round(p.targetDurationSec * 0.95)} e ${Math.round(p.targetDurationSec * 1.05)} s. NÃO resuma o roteiro: cada cena usa o trecho correspondente da narração, sem cortar frases; confira a soma antes de gravar o JSON. ` +
        `Grave um ARRAY JSON em scenes.json: [{"id":"s01","title","narration","visualIntent","videoPrompt","kind":"image|video|code|motion|mixed|stock","durationSec","camera","searchTerms"${multi ? ',"speaker"' : ''}${!isLyricVideo(p) && !isMusicClip(p) ? ',"emotion","delivery"' : ''}${stepKinds.has('sfx') ? ',"sfx"' : ''}${p.attachments?.some((a) => a.use === 'scene') ? `,"userMedia"${sceneVideos.length ? ',"clipStart","clipCrop","manualDuration"' : ''}` : ''}}]. ` +
        `Tipos de cena: image | video | code | motion | mixed (código + mídias de bancos) | stock (somente mídia de banco). ` +
        `OBRIGATÓRIO: TODA cena dos tipos stock, mixed, image e video deve ter "searchTerms" com 2–4 palavras em INGLÊS descrevendo exatamente a imagem que combina com o que está sendo narrado naquele trecho. ` +
        `Se o trecho é de ÉPOCA/histórico, ponha a década e "archival" nos termos (ex.: "1930s factory workers archival", "1960s TV studio vintage"); se é espaço, termos como "NASA astronaut spacewalk" — os bancos são consultados por tema (antigo → Internet Archive primeiro; espaço → NASA; museu/natureza → Smithsonian). ` +
        `${mixed ? `Use SOMENTE e de forma equilibrada os tipos ${mixKinds(p)}. ` : ''}${availableKinds}` +
        (!isLyricVideo(p) && !isMusicClip(p) ? ` EMOÇÃO DA FALA (a voz segue): em toda cena com narração/fala ponha "emotion" = UM destes rótulos: neutro, alegre, triste, raiva, medo, surpresa, carinho, tenso, sussurro, empolgado, ironico, cansado, choro, decidido — e "delivery" = como dizer em até 12 palavras (ritmo, intensidade, pausas; ex.: "devagar, quase sem voz, pausa antes do nome"). Varie conforme a cena pede; narração informativa costuma ser neutro/empolgado.${p.h3Speech ? ' A fala é gerada pelo MiniMax H3 junto com o vídeo: cada cena com fala até 15 s e a fala cabendo na duração.' : ''} ` : '') +
        (multi ? ` DIÁLOGO: cada cena tem UMA fala; "speaker" = nome do personagem que fala (o mesmo nome em todas as falas dele${p.cast?.length ? `; elenco: ${p.cast.map((m) => m.speaker).join(', ')}` : ''}); "narration" = só a fala, sem o nome. ` : '') +
        (timing ? ` LYRIC VIDEO: tempos dos versos da canção (out/lyrics-timing.json):\n${timing}\nCrie UMA cena "code" por bloco da letra, na ordem; "narration" = versos do bloco separados por " / "; "durationSec" = fim − início do bloco (a soma deve dar a duração da canção). ` : '') +
        (isMusicClip(p) ? (clip.perTrack
          ? ` CLIPE MUSICAL (um loop por faixa): crie EXATAMENTE 1 cena por faixa do MUSIC_PLAN (até 24 cenas; com mais faixas, as cenas se repetem em ordem), na mesma ordem, cada uma com ${clip.loopSeconds} s e kind "${codeMusic ? 'code' : 'video'}"; narração vazia. `
          : ` CLIPE MUSICAL: use EXATAMENTE 1 cena de ${clip.loopSeconds} s com kind "${codeMusic ? 'code' : 'video'}"; narração vazia. `) +
          (codeMusic
            ? `visualIntent descreve UMA cena desenhável por código (formas, camadas, paleta, personagem/objeto, enquadramento e movimento cíclico) que feche o loop; não preencha videoPrompt, pois o visual será desenhado em HTML/Canvas/WebGL e repetido. `
            : `visualIntent descreve UMA imagem estática (personagem, cenário, luz, enquadramento) que funcione como primeiro E último frame do loop. ` +
              `videoPrompt é OBRIGATÓRIO e deve ser um prompt em inglês, específico para o MiniMax H3 image-to-video: descreva o movimento cíclico sutil (respiração, piscar, vapor, chuva, folhas, luzes, parallax suave), câmera fixa, começo e fim iguais, ` +
              `sem cortes, sem texto, sem zoom brusco e sem elementos atravessando a borda do quadro.`) : '') +
        (stepKinds.has('sfx') ? ` EFEITOS SONOROS (gerados por código): em cada cena, "sfx" = lista de 0 a 3 efeitos no formato "nome" (início da cena), "nome@segundos" ou "nome:palavra da narração" (toca quando a palavra é dita). Use só nomes desta biblioteca: ${sfxCatalogText()}. Sincronize com o que é narrado e não exagere. ${dnaSfxRule(p.skill?.formatDna, p.sceneSec ?? (p.skill?.formatDna?.avgTakeSec ? Math.max(8, Math.min(16, p.skill.formatDna.avgTakeSec * 3)) : 10))} ` : '') +
        (characterSheet(c.projectDir).length ? ` PERSONAGENS FIXOS (assets/assets.md): ${characterSheet(c.projectDir).map((ch) => ch.name).join(', ')} — cite-os pelo NOME no visualIntent quando aparecerem, para manter a mesma aparência. ` : '') +
        ` Estilo visual padrão: ${codeMusic ? 'code' : vt?.sceneKind}. visualIntent deve ser descritivo e autossuficiente (sem "ele/ela" sem referente).` +
        (projectKit(pluginsRoot(c.settings), p)?.kind === 'pages' ? ` BIBLIOTECA DE ESTILOS DO PLUGIN: cada cena é UMA página animada no estilo escolhido, de 3 a 6 s (corte numa pausa da fala), kind "code"; visualIntent descreve o quadro no vocabulário do estilo (composição, o que aparece, movimento, texto curto na tela).` : '') +
        (projectKit(pluginsRoot(c.settings), p)?.kind === 'player' ? ` MOTOR DO PLUGIN (planos curtos, como um filme): cada cena é UM plano de 2 a 4 s (corte numa pausa da fala; ≈15–25 planos por minuto), kind "code"; visualIntent descreve o plano no vocabulário do plugin: plano geral de abertura, plano médio com 2 personagens, over-the-shoulder, close gigante no rosto (bigFace), insert/detalhe, vista de cima/diagrama, freeze-frame, 3D orbit, cartão de dados, blueprint, cartela de título, tela final — com o local, quem está em cena, a ação e a luz.` : '');
    }
    case 'narration':
      return head + sceneInfo +
        `\nGere a NARRAÇÃO em ${languageName(p.language)} (${p.language}) — este é o idioma obrigatório da locução; não traduza, não resuma e não mude o texto. ` +
        `Leia em voz alta a narração da cena (campo "Narração" acima) ou, se ela não tiver texto próprio, o trecho correspondente de ${path.join(c.projectDir, 'script.md')}. ` +
        `Grave o áudio em ${file} (MP3, voz natural e expressiva, ritmo de conversa, sem silêncios longos, sem ruído e sem música). ` +
        (fs.existsSync(file) ? `Já existe ${file}: substitua pela nova versão. ` : '') +
        (typeof (c.step.params as Record<string, unknown>)?.voiceRef === 'string' ? `VOZ ESCOLHIDA NA ROTA: use como referência de timbre (clonagem, se a ferramenta permitir) o arquivo ${(c.step.params as Record<string, unknown>).voiceRef}. ` : '') +
        `Se a skill indicar uma voz/referência, imite o timbre e a energia dela. Não escreva legendas nem o vídeo: apenas a locução.`;
    case 'asset_design':
      /* curta cartoon 3D: o "asset design" é o STORYBOARD (elenco fixo, paleta fixa e planos de cada cena com os tempos reais) */
      if (p.skill?.codeKit === 'cartoon3d') {
        const board = p.scenes.map((s) => {
          const w = readWords(wordsPath(path.join(c.projectDir, 'scenes', s.id)));
          return { id: s.id, title: s.title, durationSec: Math.round((s.durationSec ?? 10) * 10) / 10, narration: s.narration, visualIntent: s.visualIntent, words: w?.words.length ? wordsDigest(w, 16) : undefined };
        });
        return head + `\nIdeia: ${p.idea}\n${fs.existsSync(path.join(c.projectDir, 'script.md')) ? `Roteiro: ${path.join(c.projectDir, 'script.md')}. ` : ''}` + storyboardPrompt(file, board, p.aspect, { long: p.skill?.id === 'cartoon-3d' || (p.targetDurationSec ?? 0) >= 120 || p.scenes.length > 8 });
      }
      return head +`\nIdeia: ${p.idea}\n${fs.existsSync(path.join(c.projectDir, 'script.md')) ? `Leia ${path.join(c.projectDir, 'script.md')}. ` : ''}Defina personagens, cenários e props recorrentes com descrições visuais consistentes, em Markdown. ` +
        `OBRIGATÓRIO: uma seção "## Personagens fixos" com UMA linha por personagem no formato "- **Nome**: aparência" (em inglês, 25–45 palavras: idade, porte, pele, rosto, cabelo, roupa, acessórios, traço marcante). Essa descrição será repetida literalmente em todo prompt de imagem, então não use nada que mude entre cenas.` +
        (isCastStory(p)
          ? ` BÍBLIA DE PERSONAGENS (história com elenco): use EXATAMENTE os nomes que falam no roteiro (o mesmo "NOME" das linhas "NOME: fala"; inclua NARRADOR se houver narração). ` +
            `Depois de "## Personagens fixos", grave também: "## Vozes" com UMA linha por personagem "- **Nome**: feminina|masculina, idade, timbre e jeito de falar" (ex.: "feminina, 20 anos, voz doce e hesitante"); ` +
            `"## Relações e arcos" (quem é quem para quem, o que cada um quer e esconde, como muda até o fim); "## Cenários" (2 a 4 locais fixos, com luz e paleta).` +
            (routeSceneKinds(p).has('code') && !routeSceneKinds(p).has('video')
              ? ` Como o vídeo é ANIMADO POR CÓDIGO, acrescente "## Desenho em código": para cada personagem, as formas (cabeça, corpo, cabelo), as cores em hex e um traço inconfundível, para todas as cenas desenharem o personagem igual.`
              : '')
          : '');
    case 'code_scene':
    case 'motion_graphics': {
      const dur = Math.round(Math.max(0.2, c.scene?.durationSec ?? 6) * 100) / 100;
      const fps = 30;
      const frames = Math.round(dur * fps);
      const sfxRule = stepKinds.has('sfx') || stepKinds.has('music')
        ? `SOM PROGRAMÁTICO (sincronizado com a SUA animação): declare também window.__forge.sfx = [{ t: 1.25, name: "pop" }, ...] com 2 a 6 sons nos instantes exatos (segundos desde o início da cena) dos eventos que você anima — entrada de elementos, impactos, transições, números que travam. ` +
          `Nomes da biblioteca: ${sfxCatalogText()} (também aceita whoosh, swish, impact, pop, click, ding, riser, boom, sparkle, glitch, typing). O app sintetiza os sons e mixa com a narração. `
        : '';
      /* velocidade: harnesses com shell testavam a cena sozinhos (navegador, node, ffmpeg) — minutos por cena */
      const fastRule = `TRABALHE RÁPIDO: escreva o arquivo ${file} inteiro numa única gravação e termine. NÃO abra navegador, NÃO rode node/npm/python/ffmpeg/servidores, NÃO crie testes nem arquivos auxiliares e não abra arquivos além dos citados neste pedido: ` +
        `o FilmForge renderiza e valida cada quadro e, se seek(t) falhar, devolve o erro exato para você corrigir. ` +
        /* teste_vancker: um save() sem restore() acumulava o translate a cada quadro (a cena saía da tela) e o
           <video> era desenhado antes do quadro novo existir (a captura ficava presa no 1º quadro) */
        `CANVAS: cada quadro desenha tudo do zero; todo ctx.save() tem o seu ctx.restore() no MESMO quadro (sem return entre eles) e comece seek(t) com ctx.setTransform(1,0,0,1,0,0). ` +
        `VÍDEO DO USUÁRIO: em seek(t) defina video.currentTime e, se ele mudou, devolva uma Promise que resolve no evento "seeked" e SÓ ENTÃO desenhe o vídeo no canvas.`;
      /* curta cartoon 3D: Three.js + biblioteca local cartoon3d (o executor copia as duas para o projeto) */
      if (c.step.kind === 'code_scene' && p.skill?.codeKit === 'cartoon3d') {
        const up = path.relative(path.dirname(file), c.projectDir).split(path.sep).join('/') || '.';
        const imports = { three: `${up}/plugins/_three/three.module.min.js`, cartoon3d: `${up}/plugins/_cartoon3d/cartoon3d.js` };
        let board = '';
        try { board = s ? storyboardFor(fs.readFileSync(path.join(c.projectDir, 'assets', 'assets.md'), 'utf8'), s.id, s.index) : ''; } catch { /* sem storyboard */ }
        return head + sceneInfo + (isCastStory(p) ? codeCastText(c.projectDir, s?.speaker) : '') + board + sceneContext(c) +
          cartoon3dScenePrompt({ file, exists: fs.existsSync(file), dur, fps, aspect: p.aspect, imports, loops: codeLoops(c), sfx: sfxRule }) + '\n' + fastRule;
      }
      return head + sceneInfo + (isCastStory(p) ? codeCastText(c.projectDir, s?.speaker) : '') + (dur >= CODE_SCENE_MIN_SEC && !codeLoops(c) ? `\nCENA LONGA (${dur}s): não deixe a tela parada — organize a animação em 2 a 4 etapas encadeadas (entrada, desenvolvimento, virada, fechamento), cada uma com movimento próprio, acompanhando a fala.\n` : '') + sceneContext(c) + `\nCrie UMA página HTML autocontida (HTML+CSS+JS inline, sem rede, sem bibliotecas externas; Canvas 2D, SVG ou WebGL puro) ` +
        `${fs.existsSync(file) ? `Já existe uma versão em ${file}: PARTA DELA e aplique apenas os ajustes pedidos. ` : ''}com animação DETERMINÍSTICA. ` +
        `CONTRATO OBRIGATÓRIO: window.__forge = { duration: ${dur}, fps: ${fps}, seek(t){ /* desenha o quadro em t (0..${dur}), síncrono */ }, pause(){ /* cancela o loop de requestAnimationFrame */ } }. ` +
        `A cena tem ${dur}s a ${fps} fps = ${frames} quadros; o renderizador chama pause() e depois seek(i/${fps}) para exatamente ${frames} quadros. ` +
        (codeLoops(c)
          ? `LOOP PERFEITO: a cena será repetida em loop; seek(0) e seek(${dur}) devem ser visualmente idênticos (ciclo fechado), sem reverse, sem saltos e sem movimento que atravesse a borda. `
          : `CENA LINEAR: a animação acompanha a fala do começo ao fim — revele os elementos progressivamente (no instante em que a palavra correspondente é dita) e mantenha-os na tela; o último quadro mostra a composição completa (NÃO volte ao início). Nada atravessa a borda; texto sempre legível. `) +
        `Não use animação em tempo real, Date.now/performance.now nem Math.random sem seed: o único relógio é o t de seek(). ` +
        /* legendas são opção do projeto: a cena não transcreve a fala na tela por conta própria */
        (p.subtitles && !isLyricVideo(p)
          ? `NÃO escreva na tela o texto que está sendo narrado (nada de legenda, karaokê ou frases da narração palavra por palavra): textos na tela só como títulos curtos, números, rótulos e palavras-chave de até 4 palavras.${p.subtitles === 'burn' ? ' As legendas serão gravadas depois: deixe livre a faixa inferior (15% da altura).' : ''} `
          : '') +
        (stepKinds.has('sfx') || stepKinds.has('music')
          ? `SOM PROGRAMÁTICO (sincronizado com a SUA animação): declare também window.__forge.sfx = [{ t: 1.25, name: "pop" }, ...] com 2 a 6 sons nos instantes exatos (segundos desde o início da cena) dos eventos que você anima — entrada de elementos, impactos, transições, números que travam. ` +
            `Nomes da biblioteca: ${sfxCatalogText()} (também aceita whoosh, swish, impact, pop, click, ding, riser, boom, sparkle, glitch, typing). O app sintetiza os sons e mixa com a narração. `
          : '') +
        `Dimensão do viewport: ${p.aspect}. Estilo: ${vt?.stylePrompt}. Evite: ${vt?.negativePrompt}. Nada de fetch/XHR/imports externos. ` +
        /* velocidade: harnesses com shell testavam a cena sozinhos (navegador, node, ffmpeg) — minutos por cena */
        `TRABALHE RÁPIDO: escreva o arquivo ${file} inteiro numa única gravação e termine. NÃO abra navegador, NÃO rode node/npm/python/ffmpeg/servidores, NÃO crie testes nem arquivos auxiliares e não abra arquivos além dos citados neste pedido: ` +
        `o FilmForge renderiza e valida cada quadro e, se seek(t) falhar, devolve o erro exato para você corrigir. ` +
        /* teste_vancker: um save() sem restore() acumulava o translate a cada quadro (a cena saía da tela) e o
           <video> era desenhado antes do quadro novo existir (a captura ficava presa no 1º quadro) */
        `CANVAS: cada quadro desenha tudo do zero; todo ctx.save() tem o seu ctx.restore() no MESMO quadro (sem return entre eles) e comece seek(t) com ctx.setTransform(1,0,0,1,0,0). ` +
        `VÍDEO DO USUÁRIO: em seek(t) defina video.currentTime e, se ele mudou, devolva uma Promise que resolve no evento "seeked" e SÓ ENTÃO desenhe o vídeo no canvas.`;
    }
    case 'review': {
      if (c.step.scope === 'project') {
        const target = p.targetDurationSec || 60;
        const res = p.aspect === '9:16' ? '1080x1920' : p.aspect === '1:1' ? '1080x1080' : p.aspect === '4:5' ? '1080x1350' : '1920x1080';
        const variety = [...sceneKinds].join(', ') || 'os tipos de cena da rota';
        const criteria = String((c.step.params as Record<string, unknown>)?.['reviewCriteria'] ?? '').trim() || p.skill?.reviewCriteria || '';
        const scenes = p.scenes.map((x) => `${x.id} (${x.kind}, ${x.durationSec ?? '?'}s): ${x.title}`).join(' | ');
        return head + `\nAvalie o VÍDEO FINAL em ${path.join(c.projectDir, 'out', 'final.mp4')} e escreva ${file} como JSON válido: ` +
          `{"score":0-10,"criteria":{"duracao":0-10,"imagem":0-10,"audio":0-10,"narrativa":0-10,"edicao":0-10,"aderencia_skill":0-10},"issues":[...],"fixes":[...],"scenes":[{"id":"s03","issue":"...","fix":"instrução objetiva para refazer esta cena"}]}. ` +
          `Use ffprobe e ffmpeg para conferir duração, resolução, streams e extrair 3 quadros (início, meio, fim). Critérios: duração perto de ${target} s (±20%); resolução ${res}; ` +
          `${p.route?.steps.some((st) => st.kind === 'narration' && st.enabled) ? 'narração clara e sincronizada; música abaixo da voz; ' : 'áudio sem cortes; '}${p.subtitles === 'off' || p.subtitles === 'srt' ? 'sem legendas gravadas (escolha do projeto — não penalize a ausência); ' : 'legendas legíveis; '}variedade visual coerente com ${variety}; áudio sem clipping; gancho nos primeiros 5 s; aderência à skill "${p.skill?.name ?? p.videoType}".` +
          (criteria ? ` CRITÉRIOS DA SKILL/ROTA (obrigatórios): ${criteria}` : '') +
          `\nCenas: ${scenes}\nEm "scenes" liste SÓ as cenas que precisam ser refeitas (no máximo 3), com o id exato. Seja rigoroso e proponha correções objetivas. Não altere o vídeo.`;
      }
      return head + sceneInfo + `\nAvalie os artefatos da cena e escreva JSON {"score":0-10,"issues":[...]}.`;
    }
    case 'metadata':
      return head + (fs.existsSync(path.join(c.outDir, 'tracklist.txt')) ? `\nCOLETÂNEA: use EXATAMENTE estes inícios de faixa como capítulos (e cite a duração total real no título):\n${excerpt(path.join(c.outDir, 'tracklist.txt'), 4000)}\n` : '') + `\nCom base em ${path.join(c.projectDir, 'script.md')} e nas cenas (${p.scenes.map((x) => `${x.index}:${x.title}`).join(' | ')}), gere JSON SEO para YouTube no idioma ${p.language}: ` +
        `{"title" (até 60 caracteres, palavra-chave no início), "titleOptions":[3 variantes {"title","type":"busca|navegação|híbrido"}], "description" (2 primeiras linhas = gancho com palavra-chave nas primeiras 25 palavras; depois resumo, capítulos com tempo mm:ss calculados pelas durações das cenas, fontes/créditos de mídias de bancos se houver, 3–5 hashtags do mais específico ao mais amplo), "tags":[10–15 termos, começando pela palavra-chave exata], "chapters":[{"time","title"} a partir de 0:00, no mínimo 3], "thumbnailText" (até 3 palavras que NÃO repetem o título)}.\n` +
        `REGRAS DE TÍTULO:\n${TITLE_RULES}` +
        (p.titleModel ? `\nESTRUTURA DE TÍTULO DE REFERÊNCIA (${p.titleModel.source}): ${p.titleModel.pattern}${p.titleModel.chosen ? `\nTÍTULO ESCOLHIDO PELO USUÁRIO: "${p.titleModel.chosen}" — use-o como "title" (ajuste só se passar de 100 caracteres).` : ' Siga esse esqueleto no "title".'}${p.titleModel.thumbText ? `\nTexto da thumbnail escolhido: "${p.titleModel.thumbText}".` : ''}` : '');
    default:
      return head + sceneInfo + `\nExecute a etapa "${c.step.kind}".`;
  }
}

/** Palavras faladas que cabem na duração alvo (≈2,6/s em português, 2,8/s em inglês). Função pura. */
export function wordBudget(p: Pick<Project, 'targetDurationSec' | 'language'> & { skill?: Pick<Skill, 'formatDna'> }): number {
  /* skill de canal clonado: o ritmo de fala MEDIDO (WPM) do formato define o tamanho do texto */
  return Math.max(8, Math.round((p.targetDurationSec || 60) * wordsPerSecond(p.skill?.formatDna, p.language)));
}
/** palavras por segundo do projeto (texto do prompt) */
const wpsText = (p: Pick<Project, 'language'> & { skill?: Pick<Skill, 'formatDna'> }) => wordsPerSecond(p.skill?.formatDna, p.language).toFixed(1).replace('.', ',');
