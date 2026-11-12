import { watchOutputs } from './watch';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ApiBinding, ApiCategory, Aspect, Binding, ComfyBinding, FlowBinding, HarnessBinding, HarnessConfig, ReasoningEffort, Scene, SceneEffects, StockBinding, Wan2gpBinding } from '../shared/types';
import { termsText } from '../shared/types';
import { resolveApiModel } from '../shared/api-models';
import type { ExecContext, ExecResult, Executor } from './engine';
import { isHttpHarness, resolveHarness, runHarness } from './harness';
import { ComfyClient, applyVariables, collectOutputs, isUiFormat, placeholders } from './comfyui';
import { refPrompt, speechSeconds, Wan2gpClient, wan2gpLanguage } from './wan2gp';
import { runShowrunner, showrunnerKind } from './showrunner';
import * as prov from './providers';
import * as ff from './ffmpeg';
import { SFX_DEFAULT_VOLUME } from './ffmpeg';
import { buildFreeBase, applyFreeSoundtrack } from './soundtrack';
import { TEXT_KINDS, isLyricVideo, buildPrompt, buildPromptMarked, dedupeDestructuring, importBareLibNames, preferLibRigs, ensureForgeContract, ensureSfxExport, ensureCanvasShim, ensureThreeImport, extractHtmlPage, fixArrowBodies, fixLibCalls, freeThreePrompt, freeHtmlPrompt, freeHtmlProblem, freeLibProblem, freeLibMisuse, rawCanvasToLib, freeLibMissing, ensureImportMap, castFor, compilationPlan, narrationInstructions, primaryFile, renderedClip, thumbnailPrompt, visualPrompt, workersFor } from './prompts';
import { fetchForScene } from './stock';
import { orderStockSources } from '../shared/stock-sources';
import { cutWords, estimateWords, readWords, stampWords, transcribe, wordsFresh, wordsPath, type WordTime } from './whisper';
import { PROJECT_FPS, buildNarrationStem, ensureTimeline, narrationAudio, sceneSeconds as sceneSecondsOf } from './timeline';
import { checkSync, snapSceneWords, speechSegments, syncQaLine, type Segment } from './subtitle-qa';
import { avQaLine, checkAv, conformAv } from './av-qa';
import { checkThumb, thumbQaLine } from './thumb-qa';
import { getVideoType } from './presets';
import { ensureWhisper } from './whisper-install';
import { agyEnvForProject, DEFAULT_FLOW_URL, ensureFlowBrowser, flowAccount, flowProjectOf, setFlowProject } from './automations';
import { flowGenerate } from './flow';
import * as sfx from './sfx';
import { moodFor, renderCodeMusic } from './codemusic';
import { youtubeUpload, uploadMeta } from './youtube-upload';
import { appendPublish } from './channels';
import { projectKit, type KitRenderer } from './kit';
import { kitAssets, kitShot, pagesAssets, pagesScene } from './kit-exec';
import { forceCartoon3dImports, framingFixPrompt, framingIssues, storyboardFor, storyboardShots, type FramingReport } from './cartoon3d';
import { freeLibImport, pluginContract, pluginPrompt, pluginsRoot, stageCartoon3d, stageThree, THREE_VERSION } from './plugins';
import { contractProblem, smallModelBudget } from './contract';
import { voiceAccepted } from '../shared/voices';
import { characterPhoto, musicAttachment, sceneUserMedia } from './attachments';
import { castApiVoice, charactersInScene, injectCastRefs, portraitFile, portraitPrompt } from './cast';
import { addH3Speech, deliveryEnglish, dropRefAudio, h3AudioRef, h3DubRef, h3Language, h3Mode, h3SpokenText, refPadSec, h3SpeechScene, isH3Video, sceneSpeech, speechWindow } from './speech-emotion';
import { styleNegative } from './style-ref';
import { inScene } from './characters';
import { projectThumbDesign, renderThumb, type SnapHtml } from './thumb-render';
import { THUMB_DESIGN_TEMPLATES } from '../shared/thumbdesign';
import { mark, stepSchema } from '../shared/strict';
import { backdropRef, fallbackPlan, mergeShotSfx, parsePlan, planPrompt, planSchema, shotDurations, shotIdea, shotsWanted, type ShotPlan } from './free-shots';
import { cartoon3dApiFrom, cartoon3dApiProblem, type Cartoon3dApi } from './cartoon3d';
import { cartoon3dBundle } from './plugins';

/** Prefixo do erro do validador da API cartoon3d (o pedido de correção é outro). */
const C3D_LINT = 'API cartoon3d: ';
let c3dApiCache: { file: string; mtime: number; api: Cartoon3dApi } | undefined;
/** API real da biblioteca (lida do bundle; recarrega se o arquivo mudar). */
function loadCartoon3dApi(): Cartoon3dApi | undefined {
  const f = cartoon3dBundle(); if (!f) return undefined;
  const mtime = fs.statSync(f).mtimeMs;
  if (!c3dApiCache || c3dApiCache.file !== f || c3dApiCache.mtime !== mtime) c3dApiCache = { file: f, mtime, api: cartoon3dApiFrom(fs.readFileSync(f, 'utf8')) };
  return c3dApiCache.api;
}

export type RenderHtml = (html: string, out: string, o: { w: number; h: number; ffmpeg: string; duration?: number; fps?: number; log?: (l: string) => void }) => Promise<void>;

export interface ExecutorOptions { workflowsDir: string; toolsDir?: string; renderHtml?: RenderHtml; kitRender?: KitRenderer; /** foto de página parada (thumbnails visuais) */ snapHtml?: SnapHtml }

const ensureDir = (f: string) => fs.mkdirSync(path.dirname(f), { recursive: true });

function validateText(kind: string, file: string) {
  if (kind === 'scene_plan') {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(j) || j.length === 0) throw new Error('scenes.json deve ser um array não vazio');
  } else if (kind === 'ideation' || kind === 'metadata' || kind === 'review') {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}

/** Storyboard visual (cartoon 3D): um quadro real do meio de cada plano do storyboard, lado a lado, em code/storyboard.jpg. */
async function storyboardSheet(c: ExecContext, clip: string, codeDir: string): Promise<void> {
  try {
    const sc = c.scene; if (!sc) return;
    let md = ''; try { md = fs.readFileSync(path.join(c.projectDir, 'assets', 'assets.md'), 'utf8'); } catch { /* sem storyboard */ }
    const dur = await ff.duration(c.settings.ffprobe, clip); if (!(dur > 0)) return;
    let shots = storyboardShots(storyboardFor(md, sc.id, sc.index)).filter((s) => s.b > s.a && s.a < dur);
    if (!shots.length) shots = [0, 1, 2, 3].map((i) => ({ a: (dur * i) / 4, b: (dur * (i + 1)) / 4, text: '' }));
    const fps = 30, picks = shots.slice(0, 6).map((s) => Math.min(Math.floor(dur * fps) - 1, Math.round(((s.a + Math.min(s.b, dur)) / 2) * fps)));
    const cols = picks.length, tall = (c.project.aspect ?? '9:16') === '9:16';
    await ff.run(c.settings.ffmpeg, ['-y', '-i', clip, '-vf', `select='${picks.map((n) => `eq(n\\,${n})`).join('+')}',scale=${tall ? 270 : 480}:-2,tile=${cols}x1:padding=8:margin=8:color=white`,
      '-frames:v', '1', '-fps_mode', 'passthrough', path.join(codeDir, 'storyboard.jpg')], c.signal);
    c.log(`storyboard visual: ${cols} plano(s) em ${path.relative(c.projectDir, path.join(codeDir, 'storyboard.jpg'))}`);
  } catch (e) { c.log(`storyboard visual não gerado: ${(e as Error).message.slice(0, 160)}`); }
}

async function finishRendered(c: ExecContext, o: ExecutorOptions, html: string): Promise<ExecResult> {
  const clip = renderedClip(c.step.kind, c);
  if (!clip) return { files: [html] };
  if (!o.renderHtml) throw new Error('renderizador de cenas por código indisponível neste ambiente');
  const { w, h } = ff.resolution(c.project.aspect);
  ensureDir(clip);
  /* a cena de código tem EXATAMENTE a duração da cena no vídeo final (narração + 0,15 s)
     e 30 fps; antes o renderizador usava a duração/fps declarados pela página. */
  const duration = Math.round(Math.max(0.2, c.scene?.durationSec ?? 4) * 100) / 100;
  const fps = 30;
  c.log(`render determinístico: ${duration}s a ${fps} fps (${Math.round(duration * fps)} quadros)`);
  await o.renderHtml(html, clip, { w, h, ffmpeg: c.settings.ffmpeg, duration, fps, log: c.log });
  return { files: [clip, html] };
}

/** Pós-processa narração: remove silêncios longos (padrão ligado). */
async function trimNarration(c: ExecContext, file: string): Promise<string> {
  if (c.step.params.trimSilence === false) return file;
  const tmp = file.replace(/(\.\w+)$/, '.trim$1');
  try {
    await ff.silenceTrim(c.settings.ffmpeg, file, tmp, c.signal);
    if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
      try { fs.renameSync(tmp, file); }
      catch { fs.copyFileSync(tmp, file); fs.rmSync(tmp, { force: true }); }
      /* o áudio mudou: os tempos das palavras e a timeline medidos no arquivo antigo não valem mais */
      fs.rmSync(path.join(path.dirname(file), 'words.json'), { force: true });
      fs.rmSync(path.join(c.projectDir, 'out', 'timeline.json'), { force: true });
    }
  } catch (e) { c.log(`silence-trim ignorado: ${(e as Error).message}`); fs.rmSync(tmp, { force: true }); }
  return file;
}


/**
 * Vídeo livre com modelo local: o modelo escreve out/free.html (contrato __forge) e o FilmForge
 * renderiza em final.mp4. Sem shell — o caminho antigo (o modelo gerar o MP4) falhava sempre
 * que a máquina não tinha Python/ImageMagick, e a etapa caía no "auto" (Claude).
 */
async function freeViaHtml(c: ExecContext, o: ExecutorOptions, hh: { id: string; cfg: HarnessConfig; model?: string; effort?: ReasoningEffort }, video: string): Promise<ExecResult> {
  /* modelo pequeno às vezes acerta: esgotadas as correções de uma página, começa outra do zero (até 3 rodadas
     completas) em vez de encerrar a etapa — com "sem reserva" é a única chance de o vídeo sair */
  const FRESH = 3;
  for (let fresh = 1; ; fresh++) {
    try { return await freeViaHtmlOnce(c, o, hh, video, fresh >= FRESH); }
    catch (e) {
      /* servidor fora do ar, modelo inexistente, timeout: repetir não muda nada */
      const infra = /ECONNREFUSED|ENOENT|fetch failed|HTTP \d{3}|not found|nenhum modelo|timeout|abortado|ffmpeg/i.test((e as Error).message);
      if (c.signal.aborted || infra || fresh >= FRESH) throw e;
      c.log(`✗ rodada completa ${fresh}/${FRESH} falhou: ${(e as Error).message.slice(0, 220)} — começando uma página nova do zero`);
      fs.rmSync(path.join(c.outDir, 'free.html'), { force: true });   // sem ela o pedido é de página nova, não de ajuste
    }
  }
}

async function freeViaHtmlOnce(c: ExecContext, o: ExecutorOptions, hh: { id: string; cfg: HarnessConfig; model?: string; effort?: ReasoningEffort }, video: string, lastRound = true): Promise<ExecResult> {
  const html = path.join(c.outDir, 'free.html');
  const { w, h } = ff.resolution(c.project.aspect);
  const dur = Math.round(Math.min(180, Math.max(2, c.project.targetDurationSec || 15)) * 100) / 100;
  c.log(`vídeo livre por API HTTP (${hh.id}): a IA escreve ${path.relative(c.projectDir, html)} (animação HTML) e o FilmForge renderiza o MP4`);
  /* Three.js (vem com o app): sempre disponível no import map; modo 3D quando o projeto escolhe (freeEngine)
     ou a ideia pede "3D"/"Three.js". Padrão 2D: o qwen3.5-3d-coder também faz 2D (formigas vs baratas) */
  const three = stageThree(c.projectDir, c.outDir);
  const threeMode = !!three && (c.project.freeEngine === '3d' || (c.project.freeEngine !== '2d' && /\bthree\.?js\b|\b3d\b/i.test(c.project.idea)));
  /* plugins ligados no projeto (ex.: claude-animation): a página importa a biblioteca copiada para plugins/ */
  const budget = smallModelBudget(hh.id, hh.model);
  const plugins = threeMode ? '' : pluginPrompt(c.settings, c.project.plugins, c.project.pluginStyles, { projectDir: c.projectDir, stepKind: 'free', htmlDir: c.outDir, idea: c.project.idea, budget });
  const lib = plugins ? freeLibImport(c.settings, c.project.plugins, c.projectDir, c.outDir) : undefined;
  if (threeMode) c.log(`modo 3D: cena em Three.js ${THREE_VERSION} (local, sem rede)${c.project.plugins?.length ? ` — os plugins ${c.project.plugins.join(', ')} são de Canvas 2D e ficam de fora nesta página` : ''}`);
  else if (plugins) c.log(`plugins no vídeo livre: ${(c.project.plugins ?? []).join(', ')}${lib ? ' (página importa a biblioteca do plugin)' : ''}`);
  const base = threeMode ? freeThreePrompt(c.project, html, dur, w, h, fs.existsSync(html), three!.importmap)
    : freeHtmlPrompt(c.project, html, dur, w, h, fs.existsSync(html), plugins, lib);
  /* pede a página (texto puro) e valida; uma correção se vier sem contrato, cortada ou com seek vazio */
  const ask = async (first: string): Promise<string> => {
    let prompt = first, page = '', problem: string | undefined;
    /* resposta cortada ou em laço: nova tentativa do zero (sem reenviar a página quebrada, que o modelo
       só continuava repetindo) — modelo pequeno acerta em parte das vezes, então vale tentar de novo */
    /* laço/corte custa pouco (o laço é interrompido cedo): até 5 rodadas; outros problemas, 3 */
    let rounds = 3, loops = 0;
    const retryShort = (why: string) => `${first}\n\n---\nIMPORTANTE: a tentativa anterior ${why}. Escreva uma página CURTA (no máximo ~300 linhas): ` +
      'use arrays e laços for em vez de declarar dezenas de variáveis ou objetos parecidos, não enumere quadro a quadro, e termine com o window.__forge e </html>.';
    /* anti-repetição crescente a cada laço (o Ollama respeita repeat_penalty e frequency_penalty; presence_penalty não).
       Moderada: código repete "ctx." e ";" por natureza — frequency 1.5 fazia o modelo trocar de idioma no meio. */
    const antiLoop = (): Record<string, number> | undefined => !loops ? undefined
      : loops === 1 ? { repeat_penalty: 1.1, repeat_last_n: 512 }
      : { repeat_penalty: 1.15, repeat_last_n: 1024, frequency_penalty: 0.15 };
    for (let round = 0; round < rounds; round++) {
      const last = () => round >= rounds - 1;
      const raw = round === 0 ? 'free.raw.txt' : `free.raw.${round + 1}.txt`;   // cada rodada no seu arquivo
      const sampling = antiLoop();
      if (sampling) c.log(`rodada ${round + 1}/${rounds} com anti-repetição: ${Object.entries(sampling).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      const res = await runHarness(hh.cfg, {
        cwd: c.projectDir, prompt, model: hh.model, effort: hh.effort, sampling,
        /* sem ferramentas: o HTML dentro do JSON de um write_file quase dobra os tokens e, cortado, o
           Ollama rejeita a chamada ("invalid tool call arguments… unexpected end of JSON input") */
        signal: c.signal, onLine: c.log, timeoutSec: c.step.timeoutSec,
      });
      if (!res.ok) {
        if (res.stdout.trim()) fs.writeFileSync(path.join(c.outDir, raw), res.stdout);   // ex.: laço interrompido — o que veio até ali
        const looped = /entrou em laço|token repeat limit/.test(res.stderr);
        if (looped) { loops++; rounds = 5; }
        if (!looped || last() || c.signal.aborted) throw new Error(`${hh.id}: ${res.stderr.slice(-400)}`);
        problem = res.stderr.slice(0, 300);
        c.log(`⚠ ${problem} — nova tentativa do zero pedindo uma página curta (resposta em out/${raw})`);
        prompt = retryShort('entrou em repetição (o mesmo trecho muitas vezes, só mudando nomes e números) e foi interrompida');
        continue;
      }
      const dup = dedupeDestructuring(extractHtmlPage(res.stdout));
      if (dup.removed.length) c.log(`nomes repetidos na desestruturação (${[...new Set(dup.removed)].slice(0, 6).join(', ')}; ${dup.removed.length}×) — removidos pelo FilmForge`);
      const arrows = fixArrowBodies(dup.page);
      if (arrows.fixes) c.log(`${arrows.fixes} arrow(s) com várias instruções sem chaves (ex.: forEach((p) => a(); b())) — corrigidas pelo FilmForge`);
      const fixed = ensureForgeContract(arrows.page, dur);
      page = ensureSfxExport(ensureCanvasShim(lib ? ensureImportMap(fixed.page, lib.importmap) : fixed.page));
      /* Three.js de CDN (o 3d-coder escreve a URL do cdnjs) → cópia local do import map */
      if (three) page = ensureThreeImport(page, three.importmap);
      if (fixed.added) c.log('o modelo apagou a linha window.__forge, mas a página tem render(t) — contrato recolocado pelo FilmForge');
      /* chamadas à biblioteca do plugin com nome/contexto errados viravam chamada vazia: o estilo do plugin sumia */
      if (lib?.names?.length) {
        const calls = fixLibCalls(page, lib.names, lib.firstParam ?? {}, lib.factories ?? {});
        page = calls.page;
        if (calls.fixes.length) c.log(`chamadas à biblioteca do plugin corrigidas pelo FilmForge: ${calls.fixes.slice(0, 8).join(' · ')}`);
        /* círculos/ovais/preenchimentos crus → as mesmas formas pela biblioteca (contrato: só funções do plugin) */
        const shapes = rawCanvasToLib(page, lib.names);
        page = shapes.page;
        if (shapes.fixes) c.log(`${shapes.fixes} primitiva(s) crua(s) de Canvas trocada(s) pelas formas da biblioteca do plugin (L.ellipse/L.fill/L.stroke) pelo FilmForge`);
        const own = preferLibRigs(page, (lib.rigs ?? []).map((r) => r.name));
        page = own.page;
        if (own.replaced.length) c.log(`a página desenhava à mão personagens que a biblioteca tem (${own.replaced.join(', ')}) — trocados pelos rigs do plugin`);
        const bare = importBareLibNames(page, lib.names, lib.line);
        page = bare.page;
        if (bare.added.length) c.log(`funções da biblioteca usadas sem import (${bare.added.slice(0, 8).join(', ')}) — trazidas de L pelo FilmForge`);
      }
      /* funções próprias com nome da biblioteca (leaf, egg…) não quebram a página (L.leaf continua em L): só aviso —
         pedir a correção gastava uma rodada e, ao reescrever, o modelo pequeno introduzia bugs novos */
      problem = freeHtmlProblem(page) ?? (lib ? freeLibProblem(page, lib.line) ?? freeLibMisuse(page, lib) : undefined);
      const own = lib && !problem ? freeLibProblem(page, lib.line, lib.names) : undefined;
      if (own) c.log(`⚠ ${own.split(' — ')[0]} — aceita assim mesmo (o visual é do modelo, não do plugin)`);
      const missing = lib ? freeLibMissing(page, lib.names ?? []) : [];
      /* CONTRATO DO PLUGIN (executado, não só pedido): sintaxe + proibição de canvas cru custam uma rodada de
         texto (barata) em vez de um render completo que ia falhar */
      if (!problem) problem = contractProblem(page, { forbidCanvas: lib?.contract?.forbidCanvas, allow: lib?.contract?.allow, pluginName: lib?.contract?.plugin, rigs: (lib?.rigs ?? []).map((r) => r.name), requireLib: lib?.contract?.requireLib, known: lib?.names });
      /* nome que não existe e não tem um parecido: essa parte do visual não aparece — uma correção, com a lista certa */
      if (!problem && missing.length && round === 0 && !last())
        problem = `a página chama ${missing.slice(0, 6).map((n) => 'L.' + n).join(', ')}, que NÃO existe(m) na biblioteca do plugin (não desenha nada). Use só estes nomes: ${(lib?.names ?? []).join(', ')}`;
      else if (!problem && missing.length) c.log(`⚠ a página chama ${missing.slice(0, 6).map((n) => 'L.' + n).join(', ')}, que não existe(m) na biblioteca do plugin — essas chamadas não desenham nada`);
      if (!problem) return page;
      /* resposta crua de cada rodada (a correção não apaga a primeira), para conferir o que o modelo mandou */
      fs.writeFileSync(path.join(c.outDir, raw), res.stdout);
      /* cortada no limite de tokens: a página nem chegou ao fim */
      const cut = !/<\/html>/i.test(res.stdout);
      /* cortada quase sempre = laço que o detector não pegou: mesmo tratamento (mais rodadas, anti-repetição) */
      if (cut) { loops++; rounds = 5; }
      c.log(`⚠ página do modelo com problema: ${problem}${cut ? ' (resposta cortada antes do </html>)' : ''}${last() ? '' : cut ? ' — nova tentativa do zero pedindo uma página curta' : ' — pedindo a correção'} (resposta em out/${raw})`);
      const thinking = cut && /^\s*<think>/i.test(res.stdout) && !/<\/think>/i.test(res.stdout);
      if (thinking) c.log('o modelo gastou a resposta inteira raciocinando (<think>) — a próxima tentativa pede a página direto');
      prompt = cut ? retryShort(thinking ? 'gastou a resposta inteira raciocinando (<think>) e não chegou a escrever a página. NÃO raciocine: comece a resposta direto por <!doctype html>' : 'ficou longa demais e foi cortada antes do fim')
        : `${first}\n\n---\nSua resposta anterior tinha um problema: ${problem}. Corrija e devolva a página INTEIRA.\nResposta anterior:\n${page.slice(0, 20_000)}`;
    }
    throw new Error(`${hh.id}: ${problem} — use um modelo menos comprimido (ex.: Q4 de 9B) ou peça uma animação mais simples`);
  };
  fs.writeFileSync(html, await ask(base));
  const render = (file: string) => o.renderHtml!(file, video, { w, h, ffmpeg: c.settings.ffmpeg, duration: dur, fps: 30, log: c.log });
  for (let fix = 0; ; fix++) {
    c.log(`render determinístico: ${dur}s a 30 fps (${Math.round(dur * 30)} quadros)`);
    let still = '';
    try {
      await render(html);
      /* modelo pequeno escreve render(t) que ignora t (estado num update() que o seek nunca chama): vídeo parado */
      const frames = Math.round(dur * 30);
      const moving = await ff.distinctFrames(c.settings.ffmpeg, video, c.signal).catch(() => frames);
      if (moving >= Math.max(8, frames * 0.04)) return { files: [video, html] };
      if (fix >= 2) {
        /* parado (ou preto: página que quebrou sem desenhar) — sobrando rodada completa, começa outra página em vez de aceitar */
        if (!lastRound) throw new Error(`o vídeo saiu parado (${moving} de ${frames} quadros mudam) e ${hh.id} não corrigiu em 2 tentativas`);
        c.log(`⚠ o vídeo quase não se move (${moving} de ${frames} quadros mudam) — ${hh.id} não corrigiu em 2 tentativas`); return { files: [video, html] };
      }
      still = `a animação está PARADA: só ${moving} de ${frames} quadros mudam. render(t) desenha quase o mesmo quadro para todo t. ` +
        'Tudo que se move (personagem, câmera, inimigos, efeitos) tem de ser CALCULADO a partir de t dentro de render(t) — ex.: x = 100 + t * 180; ' +
        'y = chão - Math.abs(Math.sin(t * 3)) * 120; câmera = t * 150. Não guarde posição num estado que só um loop/update atualiza.';
    } catch (e) {
      /* erro de JS da página (exceção no seek/carregamento): devolve o erro do console ao modelo, até 2 vezes */
      /* pilha com "free.html:315:13" em vez da URL forge-scene:// inteira: o modelo acha a linha */
      const msg = (e as Error).message.replace(/forge-scene:\/\/scene\/[^\s)]*\/([^/\s)]+)/g, '$1');
      if (c.signal.aborted || !/a cena lançou erro|window\.__forge|console:/.test(msg)) throw e;
      if (fix >= 2) {
        /* último recurso: o seek só falha em alguns quadros (ex.: o áudio que o modelo insiste em manter) —
           renderiza ignorando a exceção do quadro em vez de mandar a etapa para outro provedor */
        if (!/a cena lançou erro em seek/.test(msg)) throw e;
        c.log(`⚠ ${hh.id} não corrigiu a página em 2 tentativas — renderizando assim mesmo, ignorando os erros do seek (${msg.slice(0, 160)})`);
        const tolerant = path.join(c.outDir, 'free.tolerant.html');
        fs.writeFileSync(tolerant, tolerantSeek(fs.readFileSync(html, 'utf8')));
        await render(tolerant);
        /* se o erro está em TODO quadro, o resultado é tela preta/parada: falha honesta (vai para o próximo provedor) */
        const frames = Math.round(dur * 30);
        const moving = await ff.distinctFrames(c.settings.ffmpeg, video, c.signal).catch(() => frames);
        if (moving < Math.max(8, frames * 0.04)) {
          fs.rmSync(video, { force: true });
          throw new Error(`${hh.id}: a página quebra em todos os quadros (${msg.slice(0, 200)}) e o vídeo sairia vazio — use um modelo maior/de código (ex.: qwen3.8-9b-coder)`);
        }
        return { files: [video, html] };
      }
      c.log(`a página falhou ao renderizar — pedindo ao ${hh.id} para corrigir (${fix + 1}/2): ${msg.slice(0, 300)}`);
      const audio = /oscillator|audiocontext|createGain|\.destination|currentTime/i.test(msg) ? ' O erro vem do código de ÁUDIO: REMOVA todo o código de áudio (AudioContext, osciladores, <audio>) — som só pela lista SFX ({ t, name }), que o FilmForge sintetiza.' : '';
      /* função inventada na biblioteca do plugin (visto: L.pencil, que é método da classe Pen) */
      const bad = /\bL\.(\w+) is not a (?:function|constructor)/.exec(msg)?.[1];
      const libHint = bad && lib?.names?.length ? ` L.${bad} NÃO existe na biblioteca. Use só estes nomes: ${lib.names.join(', ')}.`
        /* erro DENTRO da biblioteca = argumentos errados na chamada (visto: L.fungus(g, x, y, …) com assinatura (ctx, w, h, grow, seed)) */
        : lib && /\.mjs:\d+/.test(msg) ? ' O erro aconteceu DENTRO da biblioteca: a chamada L.… na linha do free.html indicada na pilha passa argumentos errados. Confira a ordem e o tipo dos argumentos com a API do plugin acima (posicione com g.save(); g.translate(x, y); … g.restore() quando a função não recebe x, y).' : '';
      fs.writeFileSync(html, await ask(`${base}\n\n---\nA página abaixo FALHOU ao renderizar quadro a quadro com este erro:\n${msg}\n` +
        `Corrija o erro e devolva a página INTEIRA, com o mesmo visual.${audio}${libHint} seek(t) não pode lançar exceção para nenhum t entre 0 e a duração: ` +
        `verifique arrays/índices, variáveis não definidas e chamadas antes de inicializar.\nPágina:\n${fs.readFileSync(html, 'utf8').slice(0, 30_000)}`));
    }
    if (still) {
      c.log(`⚠ vídeo parado — pedindo ao ${hh.id} para animar em função de t (${fix + 1}/2)`);
      fs.writeFileSync(html, await ask(`${base}\n\n---\nA página abaixo renderizou, mas ${still}\nDevolva a página INTEIRA corrigida, com o mesmo visual.\n` +
        `Página:\n${fs.readFileSync(html, 'utf8').slice(0, 30_000)}`));
    }
  }
}

/**
 * Vídeo livre em planos de 3–4 s (modelos locais): o modelo planeja as ações (JSON guiado, visual fixo), cada plano
 * vira uma página curta pelo mesmo pipeline (modo estrito, validadores, correções) em out/shots/sNN, e o app junta os
 * vídeos e desloca os sons de cada plano para o tempo dele. Planos prontos são reaproveitados (falha no 6º não refaz 1–5).
 */
async function freeInShots(c: ExecContext, o: ExecutorOptions, hh: { id: string; cfg: HarnessConfig; model?: string; effort?: ReasoningEffort }, video: string, dur: number): Promise<ExecResult> {
  const dir = path.join(c.outDir, 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const durs = shotDurations(dur);
  const key = crypto.createHash('sha1').update(JSON.stringify([c.project.idea, durs, c.project.aspect, c.project.plugins ?? []])).digest('hex').slice(0, 16);
  const planFile = path.join(dir, 'plan.json');
  let plan: ShotPlan | undefined;
  try { const j = JSON.parse(fs.readFileSync(planFile, 'utf8')) as { key?: string; plan?: ShotPlan }; if (j.key === key) plan = j.plan; } catch { /* plano novo */ }
  if (!plan) {
    c.log(`vídeo livre em ${durs.length} planos de 3–4 s (modelo local: uma ação simples por plano) — planejando as ações…`);
    const res = await runHarness(hh.cfg, {
      cwd: c.projectDir, model: hh.model, effort: hh.effort, signal: c.signal, onLine: c.log, timeoutSec: 600, schema: planSchema(durs.length),
      prompt: mark('skill', 'Você é o diretor de um curta de animação feito por código, em planos curtos. Cada plano tem UMA ação simples, desenhável em poucos segundos com a biblioteca do plugin; personagem e cenário iguais em todos os planos.') +
        '\n' + planPrompt(c.project.idea, durs, c.project.aspect),
    });
    plan = res.ok ? parsePlan(res.stdout, durs) : undefined;
    if (!plan) { c.log('⚠ o modelo não devolveu um plano válido — dividindo a ideia pelas setas/frases'); plan = fallbackPlan(c.project.idea, durs); }
    fs.writeFileSync(planFile, JSON.stringify({ key, plan }, null, 1));
  }
  c.log(`planos: ${plan.shots.map((s, i) => `${i + 1}) ${s.seconds}s ${s.action.slice(0, 60)}`).join(' · ')}`);
  const vids: string[] = [], sfxLists: Array<Array<{ t?: number; at?: number; name: string }>> = [];
  let ref: string | undefined;
  for (const [i, s] of plan.shots.entries()) {
    if (i === 1) { try { ref = backdropRef(fs.readFileSync(path.join(dir, 's01', 'free.html'), 'utf8')); } catch { /* sem referência */ } }
    const sd = path.join(dir, `s${String(i + 1).padStart(2, '0')}`), sv = path.join(sd, 'final.mp4'), mark0 = path.join(sd, 'done.json');
    const sig = `${key}|${i}|${s.action}|${s.seconds}`;
    let done = false;
    try { done = fs.existsSync(sv) && fs.statSync(sv).size > 1000 && (JSON.parse(fs.readFileSync(mark0, 'utf8')) as { sig?: string }).sig === sig; } catch { /* refaz */ }
    if (done) c.log(`plano ${i + 1}/${plan.shots.length}: já pronto (reaproveitado)`);
    else {
      fs.mkdirSync(sd, { recursive: true });
      c.log(`▶ plano ${i + 1}/${plan.shots.length} (${s.seconds} s): ${s.action}`);
      const c2: ExecContext = { ...c, outDir: sd, project: { ...c.project, idea: shotIdea(c.project.idea, plan, i, c.project.aspect, ref), targetDurationSec: s.seconds } };
      const tol = path.join(sd, 'free.tolerant.html');
      fs.rmSync(tol, { force: true });
      await freeViaHtml(c2, o, hh, sv);
      /* plano renderizado "ignorando erros" costuma sair vazio (só o fundo): tenta mais UMA vez do zero e fica com
         a versão sem erros — ou, se as duas tiveram erro, com a de vídeo maior (mais coisa desenhada) */
      if (fs.existsSync(tol)) {
        c.log(`⚠ plano ${i + 1} saiu com erros na página — gerando de novo uma vez`);
        const keep = `${sd}_try1`;
        fs.rmSync(keep, { recursive: true, force: true });
        fs.renameSync(sd, keep);
        fs.mkdirSync(sd, { recursive: true });
        let ok2 = false;
        try { await freeViaHtml(c2, o, hh, sv); ok2 = fs.existsSync(sv); } catch (e) { if (c.signal.aborted) throw e; c.log(`2ª tentativa do plano ${i + 1} falhou: ${(e as Error).message.slice(0, 160)}`); }
        const better = ok2 && (!fs.existsSync(tol) || fs.statSync(sv).size >= fs.statSync(path.join(keep, 'final.mp4')).size);
        if (better) fs.rmSync(keep, { recursive: true, force: true });
        else { fs.rmSync(sd, { recursive: true, force: true }); fs.renameSync(keep, sd); }
        c.log(`plano ${i + 1}: fica a ${better ? '2ª' : '1ª'} versão`);
      }
      fs.writeFileSync(mark0, JSON.stringify({ sig }));
    }
    vids.push(sv);
    try { sfxLists.push(JSON.parse(fs.readFileSync(path.join(sd, 'final.sfx.json'), 'utf8'))); } catch { sfxLists.push([]); }
  }
  /* junta os planos (mesmo renderizador → mesmo codec) e põe os sons no tempo de cada plano */
  await ff.concat(c.settings.ffmpeg, vids, video, c.signal);
  fs.writeFileSync(path.join(c.outDir, 'final.sfx.json'), JSON.stringify(mergeShotSfx(sfxLists, durs), null, 1));
  c.log(`${vids.length} planos juntados em ${path.basename(video)} (${dur} s)`);
  return { files: [video, planFile] };
}

/** Som do vídeo livre: efeitos que a página declarou (window.__forge.sfx) + trilha do projeto. Falha aqui não perde o vídeo. */
async function freeAudio(c: ExecContext): Promise<void> {
  const dur = Math.round(Math.min(180, Math.max(2, c.project.targetDurationSec || 15)) * 100) / 100;
  try {
    const fx = await buildFreeBase(c.settings, c.outDir, dur, c.project.sfxVolume, c.signal);
    c.log(`efeitos sonoros da página: ${fx}`);
    c.log(`trilha: ${await applyFreeSoundtrack(c.settings, c.project, c.outDir, c.signal)}`);
  } catch (e) {
    if (c.signal.aborted) throw e;
    c.log(`⚠ áudio do vídeo livre ignorado (o vídeo fica mudo): ${(e as Error).message.slice(0, 300)}`);
  }
}

/** Página com o seek protegido: a exceção de um quadro não derruba o render (o quadro sai como ficou). Função pura. */
export function tolerantSeek(page: string): string {
  /* <script type="module"> roda DEPOIS dos scripts comuns: o window.__forge ainda não existe aqui, então
     a proteção entra também pelo setter (vale para página em módulo, com a biblioteca de um plugin) */
  const guard = '<script>(()=>{const wrap=(f)=>{if(f&&typeof f.seek==="function"&&!f.__tolerant){const s=f.seek.bind(f);' +
    'f.seek=(t)=>{try{return s(t);}catch(e){console.warn("seek ignorado em t="+t+": "+e);}};f.__tolerant=1;}return f;};' +
    'if(window.__forge){wrap(window.__forge);return;}let v;Object.defineProperty(window,"__forge",{configurable:true,get(){return v;},set(x){v=wrap(x);}});})();</script>';
  const at = page.toLowerCase().lastIndexOf('</body>');
  return at >= 0 ? page.slice(0, at) + guard + page.slice(at) : page + guard;
}

const harnessExec = (o: ExecutorOptions): Executor => async (c) => {
  const stepT0 = Date.now();   // orçamento de tempo das rodadas de revisão (não podem estourar o prazo da etapa)
  const b = c.binding as HarnessBinding;
  // obreiro com harness/modelo próprios assume o executor principal da etapa
  const w = workersFor(c.project, c.step).find((x) => x.harness && x.harness !== 'auto');
  const isPrimary = JSON.stringify(c.step.bindings[0]) === JSON.stringify(b);
  const eff: HarnessBinding = w && isPrimary ? { ...b, harness: w.harness!, model: w.model || b.model, effort: w.effort ?? b.effort } : b;
  if (eff !== b) c.log(`obreiro "${w!.name}" → ${eff.harness}${eff.model ? '/' + eff.model : ''}${eff.effort ? '@' + eff.effort : ''}`);
  const { id, cfg, model } = await resolveHarness(c.settings, eff, c.project.route?.harnessFallback);
  const effort = eff.effort ?? cfg.effort;
  // deixa explícito no log qual harness/modelo da rota está sendo usado (essencial para auditar)
  c.log(`provedor da rota: ${b.harness}${b.model ? '/' + b.model : ''}${effort ? '@' + effort : ''} → ${id}${model ? '/' + model : (cfg.defaultModel ? `/${cfg.defaultModel} (padrão)` : '/(padrão do harness)')}`);
  const file = primaryFile(c.step.kind, c);
  ensureDir(file);
  if (c.step.kind === 'free' && isHttpHarness(cfg) && o.renderHtml) {
    const fdur = Math.round(Math.min(180, Math.max(2, c.project.targetDurationSec || 15)) * 100) / 100;
    /* modelo local: vídeo em planos de 3–4 s (uma ação simples por página), juntados pelo app */
    const r = shotsWanted(id, fdur) ? await freeInShots(c, o, { id, cfg, model, effort }, file, fdur) : await freeViaHtml(c, o, { id, cfg, model, effort }, file);
    await freeAudio(c);
    return r;
  }
  const cwd = c.sceneDir ?? c.projectDir;
  const stopWatch = watchOutputs(cwd, c.log);
  let res: Awaited<ReturnType<typeof runHarness>>;
  /* Antigravity: sessão da conta escolhida em Automações (home isolada do agy) */
  const env = id === 'antigravity' ? agyEnvForProject(c.settings, c.project) : undefined;
  /* plugin com motor próprio (kit): elenco/cenários e planos no formato do plugin, renderizados pelo player dele */
  if (o.kitRender && (c.step.kind === 'code_scene' || c.step.kind === 'asset_design')) {
    const kit = projectKit(pluginsRoot(c.settings), c.project);
    if (kit) {
      stopWatch();
      c.log(`motor do plugin ${path.basename(kit.pluginDir)} (${c.step.kind === 'asset_design' ? 'elenco e cenários' : 'plano da cena'})`);
      const hh = { id, cfg, model, effort, env };
      if (kit.kind === 'pages') return c.step.kind === 'asset_design' ? pagesAssets(c, kit, hh) : pagesScene(c, kit, hh, o.kitRender);
      return c.step.kind === 'asset_design' ? kitAssets(c, kit, hh, o.kitRender) : kitShot(c, kit, hh, o.kitRender);
    }
  }
  if (env?.['USERPROFILE']) c.log(`Antigravity com a conta "${c.project.agyAccount || c.settings.automations?.agyAccount}"${c.project.agyAccount ? ' (escolhida no projeto)' : ' (padrão de Automações)'}`);
  /* modelos locais em modo estrito: etapas que gravam JSON (plano de cenas, metadados) usam decodificação guiada —
     a resposta só pode ser JSON no esquema da etapa (sem ferramentas: o app grava o arquivo) */
  const schema = isHttpHarness(cfg) && cfg.strict !== false ? stepSchema(c.step.kind) : undefined;
  try { res = await runHarness(cfg, { cwd, prompt: buildPromptMarked(c) + (schema ? `\nResponda SOMENTE com o JSON de ${path.basename(file)} (o app grava o arquivo).` : ''), model, effort, signal: c.signal, onLine: c.log, timeoutSec: c.step.timeoutSec, env, schema,
    tools: schema ? undefined : { roots: [c.projectDir, ...(c.sceneDir && c.sceneDir !== c.projectDir ? [c.sceneDir] : [])], allowShell: true } }); }
  finally { stopWatch(); }
  if (!res.ok) throw new Error(res.code === null ? `${id}: ${res.stderr.slice(-400)}` : `${id} saiu com código ${res.code}: ${res.stderr.slice(-400)}`);
  if (schema && res.stdout.trim()) {
    const raw = prov.stripFences(res.stdout).trim();
    try { JSON.parse(raw); ensureDir(file); fs.writeFileSync(file, raw); c.log(`JSON guiado gravado em ${path.basename(file)}`); }
    catch { /* não veio JSON (servidor sem suporte ao esquema): segue o caminho normal abaixo */ }
  }
  if (!fs.existsSync(file) && res.stdout.trim()) {
    if (TEXT_KINDS.includes(c.step.kind)) fs.writeFileSync(file, prov.stripFences(res.stdout)); // fallback: usa stdout
    else if ((c.step.kind === 'code_scene' || c.step.kind === 'motion_graphics') && res.stdout.includes('__forge')) {
      fs.writeFileSync(file, prov.stripFences(res.stdout));                                      // harness HTTP (Ollama) não grava arquivos
    }
  }
  if (!fs.existsSync(file) && (c.step.kind === 'code_scene' || c.step.kind === 'motion_graphics')) {
    /* Alguns harnesses (Ollama) gravam "scenes/s01/code/scene.html" em vez de
       "code/scene.html" dentro do diretório da cena. Recupera o HTML mais recente. */
    const stack = [cwd];
    let found: string | undefined;
    while (stack.length) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/^scene\.html?$/i.test(e.name) && p !== file) found = p;
      }
    }
    if (found) {
      ensureDir(file);
      fs.copyFileSync(found, file);
      c.log(`harness gravou ${path.relative(cwd, found)}; usando esse HTML`);
    }
  }
  if (!fs.existsSync(file)) throw new Error(`o harness não gravou ${path.relative(cwd, file)}`);
  validateText(c.step.kind, file);
  const repairArrows = () => {
    if (!/\.html?$/i.test(file)) return;
    const a = fixArrowBodies(fs.readFileSync(file, 'utf8'));
    if (a.fixes) { fs.writeFileSync(file, a.page); c.log(`${a.fixes} arrow(s) com várias instruções sem chaves — corrigidas pelo FilmForge`); }
  };
  repairArrows();
  /* contrato do plugin com biblioteca JS (pré-parse de sintaxe + forbidCanvas): pré-checa a página ANTES de
     gastar um render — erro que o modelo vai cometer vira uma rodada de texto em vez de render quebrado */
  const contract = (c.step.kind === 'code_scene' || c.step.kind === 'motion_graphics') ? pluginContract(c.settings, c.project.plugins, c.projectDir) : undefined;
  const libCheck = /\.html?$/i.test(file) && (contract?.lib || (contract != null && contract.allow.length > 0)) ?
    (page: string) => contractProblem(page, { forbidCanvas: contract!.forbidCanvas, allow: contract!.allow, pluginName: contract!.plugin, rigs: contract!.rigs, requireLib: contract!.lib, known: contract!.names }) : undefined;
  /* cartoon 3D: a cena só pode chamar o que EXISTE na biblioteca (lido do bundle real) — função inventada volta ao
     modelo como "Erro: … não está definida em <library_api>" antes de gastar um render */
  const c3dApi = c.step.kind === 'code_scene' && c.project.skill?.codeKit === 'cartoon3d' && /\.html?$/i.test(file) ? loadCartoon3dApi() : undefined;
  const c3dCheck = c3dApi ? (page: string) => { const e = cartoon3dApiProblem(page, c3dApi); return e ? `${C3D_LINT}${e}` : undefined; } : undefined;
  const preCheck = libCheck || c3dCheck ? (page: string) => libCheck?.(page) ?? c3dCheck?.(page) : undefined;
  let framingRounds = 0;
  for (let fix = 0; ; fix++) {
    if (fix > 0) repairArrows();
    const lint = preCheck ? preCheck(fs.readFileSync(file, 'utf8')) : undefined;
    if (lint) {
      if (fix >= 2 || c.signal.aborted) {
        c.log(`⚠ ${lint.slice(0, 160)} — aceita assim mesmo (o render decide o resto)`);
      } else {
        c.log(`pré-checagem do contrato: ${lint.slice(0, 240)} — pedindo correção (${fix + 1}/2) sem render`);
        const rel2 = path.relative(cwd, file).split(path.sep).join('/');
        const rigs = (contract?.rigs ?? []).filter(Boolean).slice(0, 12);
        const names = (contract?.names ?? []).filter(Boolean).slice(0, 24);
        const libRel = contract?.libFile ? path.relative(path.dirname(file), contract.libFile).split(path.sep).join('/') : '';
        const impLine = libRel ? `import L from '${/^\.\.?\//.test(libRel) ? libRel : './' + libRel}';` : `import L from "../plugins/…/lib/_all.mjs";`;
        /* cartoon 3D: correção pela API real da biblioteca (sem o texto de plugins L.*) */
        const prompt = lint.startsWith(C3D_LINT) ? [
          `O arquivo ${rel2} é uma cena cartoon 3D (Three.js + biblioteca local cartoon3d, window.__forge = { duration, fps, seek(t), pause(), sfx }).`,
          'O VALIDADOR do app, antes da renderização, recusou o código:', lint.slice(C3D_LINT.length),
          'CORRIJA AGORA: edite o arquivo trocando SÓ essas chamadas por funções que existem (mantenha a duração, os textos, os tempos, o elenco e os efeitos sonoros).',
          'REGRAS: NÃO invente funções, métodos nem propriedades; NÃO rode comandos nem crie arquivos de teste; NÃO pergunte nada — grave o arquivo e termine.',
        ].join('\n\n') : [
          `O arquivo ${rel2} é uma cena HTML determinística (window.__forge = { duration, fps, seek(t), pause(), sfx }).`,
          'A PRÉ-CHECAGEM antes da renderização FALHOU com este problema:', lint,
          'CORRIJA AGORA: reescreva o arquivo inteiro com a ferramenta de escrita, mantendo a duração, os textos, os tempos e os efeitos sonoros.',
          `Importe a biblioteca do plugin com exatamente esta linha (dentro do <script type="module">): ${impLine}`,
          rigs.length
            ? `Desenhe os personagens e cenários chamando os rigs prontos: ${rigs.join(', ')} — por exemplo L.${rigs[0]}(ctx, 540, 900, { t }).`
            : 'Desenhe os personagens e cenários com as funções da biblioteca do plugin, não com formas criadas à mão.',
          names.length ? `Nomes que EXISTEM na lib (use só estes como L.<nome>): ${names.join(', ')}.` : '',
          'REGRAS: (1) NÃO desenhe personagens com beginPath/arc/lineTo/moveTo/bezierCurveTo nem new Path2D; (2) NÃO invente funções L.* — só as da lista acima; (3) NÃO rode comandos nem buscas (grep, findstr, dir, Get-ChildItem, node, python), NÃO leia arquivos fora de ./; (4) NÃO pergunte nada — grave o arquivo e termine.',
        ].filter(Boolean).join('\n\n');
        const stop = watchOutputs(cwd, c.log);
        let r: Awaited<ReturnType<typeof runHarness>>;
        try { r = await runHarness(cfg, { cwd, prompt, model, effort, signal: c.signal, onLine: c.log, timeoutSec: c.step.timeoutSec, env,
          tools: { roots: [c.projectDir, ...(c.sceneDir && c.sceneDir !== c.projectDir ? [c.sceneDir] : [])], allowShell: true } }); }
        finally { stop(); }
        if (!r.ok) throw new Error(`${id}: ${lint.slice(0, 160)}`);
        continue;
      }
    }
    /* curta cartoon 3D: Three.js + cartoon3d copiados para o projeto; import map (local) garantido na página */
    if (c.step.kind === 'code_scene' && c.project.skill?.codeKit === 'cartoon3d' && /\.html?$/i.test(file)) {
      const kit = stageCartoon3d(c.projectDir, path.dirname(file));
      if (kit) {
        const page = fs.readFileSync(file, 'utf8'), fixed = forceCartoon3dImports(page, kit.importmap);
        if (fixed !== page) fs.writeFileSync(file, fixed);
      } else c.log('⚠ biblioteca cartoon3d não encontrada no app (vendor/cartoon3d) — a cena pode falhar ao importar');
    }
    try {
      const done = await finishRendered(c, o, file);
      /* agente de revisão de cena (cartoon 3D): a biblioteca mede em todo quadro onde cada personagem cai na tela e se algo
         o cobre, se os letreiros dão para ler e se alguma cor de material muda de repente; os problemas voltam ao
         harness (até 2 rodadas) e ficam registrados em code/review.json */
      if (done.files[0] && c.project.skill?.codeKit === 'cartoon3d') await storyboardSheet(c, done.files[0], path.dirname(file));
      const framingFile = done.files[0] && c.project.skill?.codeKit === 'cartoon3d' ? done.files[0].replace(/\.mp4$/i, '') + '.framing.json' : '';
      if (!framingFile || !fs.existsSync(framingFile)) return done;
      let issues: string[] = [];
      try { issues = framingIssues(JSON.parse(fs.readFileSync(framingFile, 'utf8')) as FramingReport); } catch { return done; }
      try {
        const rf = path.join(path.dirname(file), 'review.json');
        const prev = (() => { try { return JSON.parse(fs.readFileSync(rf, 'utf8')) as { rounds?: unknown[] }; } catch { return {}; } })();
        fs.writeFileSync(rf, JSON.stringify({ ok: !issues.length, issues, rounds: [...(framingRounds ? prev.rounds ?? [] : []), { at: new Date().toISOString(), issues }] }, null, 1));
      } catch { /* só registro */ }
      if (!issues.length) { c.log('agente de revisão de cena: enquadramento, bloqueios, letreiros e cores ok ✓'); return done; }
      c.log(`agente de revisão de cena: ${issues.length} problema(s) — ${issues.join('; ').slice(0, 500)}`);
      if (framingRounds >= 2 || c.signal.aborted) { c.log('⚠ revisão de cena ainda com problemas depois de 2 correções — cena mantida assim'); return done; }
      /* orçamento: a correção + o render novo têm que caber no prazo da etapa; sem tempo, fica o render que já passou */
      const budget = (c.step.timeoutSec ?? 900) * 1000, left = budget - (Date.now() - stepT0), renderMs = Math.max(120_000, budget * 0.2);
      if (left < renderMs + 180_000) { c.log(`⚠ revisão de cena: sem tempo para outra correção (${Math.round(left / 60000)} min restantes) — cena mantida com o último render`); return done; }
      framingRounds++;
      c.log(`agente de revisão de cena: pedindo ao ${id} para corrigir (${framingRounds}/2)`);
      const stop = watchOutputs(cwd, c.log);
      let r: Awaited<ReturnType<typeof runHarness>>;
      try { r = await runHarness(cfg, { cwd, prompt: framingFixPrompt(path.relative(cwd, file).split(path.sep).join('/'), issues), model, effort, signal: c.signal, onLine: c.log, timeoutSec: Math.max(120, Math.floor((left - renderMs) / 1000)), env,
        tools: { roots: [c.projectDir, ...(c.sceneDir && c.sceneDir !== c.projectDir ? [c.sceneDir] : [])], allowShell: true } }); }
      finally { stop(); }
      if (!r.ok) { c.log(`⚠ ${id} não conseguiu corrigir a cena — mantida como estava`); return done; }
      if (r.stdout.includes('__forge') && /<html|<!doctype/i.test(r.stdout) && fs.statSync(file).mtimeMs < Date.now() - 60_000) fs.writeFileSync(file, prov.stripFences(r.stdout));
      fix = Math.max(0, fix - 1);   // rodada de enquadramento não gasta as correções de erro
      continue;
    }
    catch (e) {
      const msg = (e as Error).message;
      /* só erros da própria página (exceção no seek/carregamento) valem um conserto; até 2 por tentativa */
      if (fix >= 2 || c.signal.aborted || !/a cena lançou erro|window\.__forge|console:/.test(msg)) throw e;
      c.log(`a cena falhou ao renderizar — pedindo ao ${id} para corrigir (${fix + 1}/2): ${msg.slice(0, 300)}`);
      const rel = path.relative(cwd, file).split(path.sep).join('/');
      const prompt = [
        `O arquivo ${rel} é uma cena HTML determinística (window.__forge = { duration, fps, seek(t), pause(), sfx }).`,
        'Ao renderizar quadro a quadro ela FALHOU com este erro:', msg,
        `Corrija o ${rel} no lugar (grave o arquivo inteiro). Mantenha o mesmo visual, textos, tempos e efeitos sonoros; mude só o necessário.`,
        'Regras: seek(t) não pode lançar exceção para nenhum t entre 0 e duration; nada de Date.now(), Math.random() sem semente, fetch ou recursos externos; verifique arrays/índices, variáveis não definidas e chamadas antes de inicializar.',
      ].join('\n\n');
      const stop = watchOutputs(cwd, c.log);
      let r: Awaited<ReturnType<typeof runHarness>>;
      try { r = await runHarness(cfg, { cwd, prompt, model, effort, signal: c.signal, onLine: c.log, timeoutSec: c.step.timeoutSec, env,
        tools: { roots: [c.projectDir, ...(c.sceneDir && c.sceneDir !== c.projectDir ? [c.sceneDir] : [])], allowShell: true } }); }
      finally { stop(); }
      if (!r.ok) throw e;
      if (r.stdout.includes('__forge') && /<html|<!doctype/i.test(r.stdout) && fs.statSync(file).mtimeMs < Date.now() - 60_000) fs.writeFileSync(file, prov.stripFences(r.stdout));
    }
  }
};

const apiExec = (o: ExecutorOptions): Executor => async (c) => {
  const b = c.binding as ApiBinding;
  const p = c.settings.providers.find((x) => x.id === b.provider);
  if (!p) throw new Error(`provider "${b.provider}" não configurado (Configurações → providers)`);
  if (!p.apiKey && (/openai\.com/.test(p.baseUrl) || p.kind !== 'openai')) throw new Error(`provider "${p.id}" sem chave de API`);
  const file = primaryFile(c.step.kind, c);
  const k = c.step.kind;
  /* modelo padrão do provedor (Configurações → APIs): usado quando a etapa não escolhe um modelo */
  const cat: ApiCategory = k === 'image' || k === 'thumbnail' ? 'image'
    : k === 'video' ? 'video'
      : k === 'narration' ? 'voice'
        : k === 'music' ? 'music' : 'text';
  const model = resolveApiModel(p, cat, b.model);
  if (!model) throw new Error(`provider "${p.id}" sem modelo para ${cat} — carregue um modelo ou defina o "Modelo padrão" em Configurações → APIs`);
  if (!b.model && model) c.log(`modelo da API: ${model} (padrão do provedor para ${cat})`);
  if (TEXT_KINDS.includes(k)) {
    const text = await prov.chat(p, model, buildPrompt(c), c.signal);
    ensureDir(file);
    fs.writeFileSync(file, k === 'script' || k === 'asset_design' ? text : prov.stripFences(text));
    validateText(k, file);
    return { files: [file] };
  }
  if (k === 'image' || k === 'thumbnail') {
    const aspect = c.project.aspect;      // thumbnail no formato do projeto (capa 9:16 nos shorts)
    const prompt = k === 'thumbnail' ? thumbnailPrompt(c) : visualPrompt(c);
    if (p.kind === 'snapgen') {
      await prov.snapgenImage(p, model, prompt, { aspect, resolution: '1K', dest: file, signal: c.signal, log: c.log });
      return { files: [file] };
    }
    const { w, h } = ff.resolution(aspect);
    const size = w === h ? '1024x1024' : h > w ? '1024x1536' : '1536x1024';
    await prov.image(p, model, prompt, size, file, c.signal);
    return { files: [file] };
  }
  if (k === 'video' && p.kind === 'snapgen') {
    const img = c.scene?.artifacts['image']?.find((f) => /\.(png|jpe?g|webp)$/i.test(f));
    /* Muse/Meta AI fala: a linha entra no prompt e a voz sai no próprio clipe (sem TTS) */
    const museTalk = /^(meta-ai|muse)/i.test(model) && !!c.scene?.narration?.trim();
    const prompt = museTalk ? museSpeechPrompt(c) : visualPrompt(c);
    await prov.snapgenVideo(p, model, prompt, { imagePath: img, seconds: clamp(c.scene?.durationSec ?? 8, 2, 12), ratio: c.project.aspect, dest: file, signal: c.signal, log: c.log });
    if (museTalk) await keepVideoAudio(c, file, o.toolsDir, 'Muse AI');
    return { files: [file] };
  }
  if (k === 'video' && p.kind === 'seedance') {
    const img = c.scene?.artifacts['image']?.find((f) => /\.(png|jpe?g|webp)$/i.test(f));
    await prov.seedanceVideo(p, model, visualPrompt(c), { imagePath: img, seconds: clamp(c.scene?.durationSec ?? 5, 2, 12), ratio: c.project.aspect, dest: file, signal: c.signal, log: c.log });
    return { files: [file] };
  }
  if (k === 'narration' && c.scene) {
    const member = castFor(c.project, c.scene.speaker);
    /* voz do projeto só se o provedor a oferece (nomes de voz mudam entre OpenAI e Gemini) */
    const projVoice = c.project.narrationVoice?.apiVoice && voiceAccepted(p.kind, model, p.voices, c.project.narrationVoice.apiVoice) ? c.project.narrationVoice.apiVoice : undefined;
    const castVoice = member ? castApiVoice(p.kind, c.project.cast ?? [], member) : undefined;
    const memberVoice = castVoice && voiceAccepted(p.kind, model, p.voices, castVoice) ? castVoice : undefined;
    const voice = memberVoice || projVoice || b.voice || (p.kind === 'gemini' ? 'Kore' : p.kind === 'fish' ? '' : 'alloy');
    if (memberVoice) c.log(`voz de ${member!.speaker}: ${voice}`);
    if (p.kind === 'fish' && !voice) c.log('Fish Audio: nenhuma voz escolhida — usando a voz padrão da conta (escolha a voz na etapa de narração)');
    const written = await prov.tts(p, model, voice, c.scene.narration, file, c.signal, narrationInstructions(c.project, c.scene));
    /* Gemini grava .wav: remove narrações antigas com outra extensão para a cena não ter duas */
    if (written !== file) try { fs.rmSync(file, { force: true }); } catch { /* ok */ }
    await trimNarration(c, written);
    return { files: [written] };
  }
  throw new Error(`etapa "${k}" ainda não suportada por provider API neste esqueleto (use ComfyUI/harness como binding)`);
};

/** Mantém a proporção, limita o maior lado e arredonda para múltiplos exigidos pelo modelo. */
export function fitSize(w: number, h: number, maxSide: number, multiple: number): { width: number; height: number } {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const r = (v: number) => Math.max(multiple, Math.round((v * k) / multiple) * multiple);
  return { width: r(w), height: r(h) };
}

/** Resolução por área (megapixels) mantendo a proporção. */
export function fitArea(w: number, h: number, megapixels: number, multiple: number): { width: number; height: number } {
  const k = Math.sqrt((megapixels * 1_000_000) / (w * h));
  const r = (v: number) => Math.max(multiple, Math.round((v * k) / multiple) * multiple);
  return { width: r(w), height: r(h) };
}

/**
 * Resolução com a proporção exata do formato e ambos os lados múltiplos de `multiple`.
 * MiniMax H3 exige múltiplos de 32; 832×480 (16:9 arredondado) esticava o primeiro
 * frame em ~2,5%. Aqui 16:9 vira 1024×576, 9:16 vira 576×1024 etc.
 */
export function fitExactAspect(aspect: Aspect, megapixels = 0.6, multiple = 32): { width: number; height: number } {
  const [rw, rh] = ({ '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] } as const)[aspect];
  const k = Math.sqrt((megapixels * 1_000_000) / (rw * rh));
  const unit = Math.max(1, Math.round(k / multiple));
  return { width: rw * unit * multiple, height: rh * unit * multiple };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Variáveis comuns a ComfyUI e Wan2GP. */
function commonVars(c: ExecContext, side: { maxSide?: number; multiple?: number; megapixels?: number; exactAspect?: boolean }): Record<string, string | number> {
  const isThumb = c.step.kind === 'thumbnail';
  const aspect = c.project.aspect;
  const { w, h } = ff.resolution(aspect);
  const vt = getVideoType(c.project.videoType);
  const seedBase = parseInt(crypto.createHash('md5').update(c.project.id).digest('hex').slice(0, 8), 16) % 2147483647;
  const size = side.exactAspect
    ? fitExactAspect(aspect, side.megapixels ?? 0.6, side.multiple ?? 32)
    : side.megapixels ? fitArea(w, h, side.megapixels, side.multiple ?? 8) : fitSize(w, h, side.maxSide ?? 1024, side.multiple ?? 8);
  const sceneSec = c.scene?.durationSec ?? 4;
  const total = c.project.scenes.reduce((a, x) => a + (x.durationSec ?? 4), 0) || c.project.targetDurationSec;
  return {
    prompt: isThumb ? thumbnailPrompt(c) : visualPrompt(c), negative: [vt?.negativePrompt, styleNegative(c.project)].filter(Boolean).join(', '), text: c.scene?.narration ?? c.project.idea,
    /* como dizer a fala (emoção do plano): templates de voz usam {{delivery}} */
    delivery: c.scene ? deliveryEnglish(c.scene) : 'natural and clear narration',
    /* efeitos sonoros por IA (Stable Audio 3): o que soa na cena e por quanto tempo */
    sfx_prompt: c.scene ? sfx.sfxAiPrompt(c.scene) : 'Sound effects and ambience only, no music, no speech.',
    sfx_seconds: clamp(Math.round(sceneSec * 10) / 10, 1, 120),
    /* seed em 32 bits: vários nós (OmniVoice, etc.) validam max=2147483647 e recusam o prompt inteiro */
    seed: (seedBase + (c.scene?.index ?? 0) + (c.scene?.variation ?? 0) * 1000) % 2147483647, ...size,
    resolution: `${size.width}x${size.height}`,
    frames: Math.round(sceneSec * 24) + 1, fps: 24,
    seconds: clamp(Math.round(sceneSec * 2) / 2, 2, 15), seconds_int: clamp(Math.round(sceneSec), 2, 15),
    music_seconds: clamp(Math.round(total), 10, 360),
    style: `Instrumental background music for a ${vt?.label ?? 'video'} video, no vocals. ${c.project.idea}`.slice(0, 600),
    lyrics: '[Instrumental]',
  };
}

/** Retrato de referência de um personagem (assets/characters/<nome>.png), gerado uma vez com o workflow de imagem padrão. */
async function ensurePortrait(c: ExecContext, o: ExecutorOptions, client: ComfyClient, ch: { name: string; look: string }): Promise<string> {
  const file = portraitFile(c.projectDir, ch.name);
  /* foto do personagem anexada pelo usuário: é o retrato (sempre a mais recente) */
  const photo = characterPhoto(c.project, c.projectDir, ch.name);
  if (photo) {
    if (!fs.existsSync(file) || fs.statSync(file).mtimeMs < fs.statSync(photo).mtimeMs) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await ff.run(c.settings.ffmpeg, ['-y', '-i', photo, '-frames:v', '1', file], c.signal);
      c.log(`retrato do personagem ${ch.name}: foto do usuário (${path.basename(photo)})`);
    }
    return file;
  }
  if (fs.existsSync(file)) return file;
  const wfName = c.settings.defaults?.imageWorkflow || 'krea2-turbo-t2i.json';
  const wfPath = path.join(o.workflowsDir, wfName);
  if (!fs.existsSync(wfPath)) throw new Error(`workflow de imagem não encontrado: ${wfName}`);
  const side = fs.existsSync(wfPath.replace(/\.json$/, '.map.json')) ? JSON.parse(fs.readFileSync(wfPath.replace(/\.json$/, '.map.json'), 'utf8')) : {};
  const vt = getVideoType(c.project.videoType);
  const vars: Record<string, string | number> = { ...commonVars(c, side), ...(side.vars ?? {}), prompt: portraitPrompt(ch, [vt?.stylePrompt, c.project.videoStyle].filter(Boolean).join('. ')) };
  const missing = placeholders(JSON.parse(fs.readFileSync(wfPath, 'utf8'))).filter((k) => !(k in vars));
  if (missing.length) throw new Error(`${wfName}: variável(is) sem valor: ${missing.join(', ')}`);
  c.log(`retrato do personagem ${ch.name} (${wfName})`);
  const pid = await client.submit(applyVariables(JSON.parse(fs.readFileSync(wfPath, 'utf8')), vars, side.mapping));
  const outs = collectOutputs(await client.waitFor(pid, c.signal, () => {}), side.outputNode).filter((f) => f.kind === 'images');
  if (!outs.length) throw new Error('ComfyUI não devolveu imagem');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await client.download(outs[0]!, file);
  return file;
}

const comfyExec = (o: ExecutorOptions): Executor => async (c) => {
  const b = c.binding as ComfyBinding;
  const server = c.settings.comfyServers.find((s) => s.id === b.server);
  if (!server) throw new Error(`servidor ComfyUI "${b.server}" não configurado`);
  /* música instrumental + geração local: YuE 2 com LoRA instrumental (sem voz) no lugar do texto→música */
  const instrumentalWf = c.step.kind === 'music' && b.workflow === 'yue2-text2music.json' && c.project.musicMode !== 'song' && fs.existsSync(path.join(o.workflowsDir, 'yue2-instrumental.json'));
  const wfFile = instrumentalWf ? 'yue2-instrumental.json' : b.workflow;
  if (instrumentalWf) c.log('música instrumental: usando yue2-instrumental.json (sem voz)');
  const wfPath = path.join(o.workflowsDir, wfFile);
  if (!fs.existsSync(wfPath)) throw new Error(`workflow não encontrado: ${wfFile}`);
  const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
  if (isUiFormat(wf)) throw new Error(`${b.workflow} está no formato de interface; no ComfyUI use "Exportar (API)" / Save (API Format)`);
  const sidecar = wfPath.replace(/\.json$/, '.map.json');
  const side = fs.existsSync(sidecar) ? JSON.parse(fs.readFileSync(sidecar, 'utf8')) : {};
  const mapping = b.mapping ?? side.mapping;
  const outputNode = b.outputNode ?? side.outputNode;
  const client = new ComfyClient(server);
  const ping = await client.ping();
  if (!ping.ok) throw new Error(`ComfyUI "${server.id}" offline: ${ping.error}`);

  const vars: Record<string, string | number> = { ...commonVars(c, side), ...(side.vars ?? {}) };
  // áudio de referência (clonagem de voz): enviado ao ComfyUI e usado em {{ref_audio}}
  // diálogo: a voz do personagem da cena (elenco) vence a voz da rota
  const member = c.step.kind === 'narration' ? castFor(c.project, c.scene?.speaker) : undefined;
  if (member && !member.refAudio && c.scene?.speaker) c.log(`personagem "${member.speaker}" sem voz de referência no elenco — usando a voz da rota`);
  /* vídeo H3 com voz clonada (minimax-h3-ref2v-voice): a voz de quem fala na cena vira o <Audio 1> (ref_audios do nó);
     sem voz clonada para ela, o nó de áudio sai e a cena segue só com as imagens */
  let videoVoice: string | undefined;
  /* dublagem (padrão): a narração TTS da cena (voz clonada) é o <Audio 1> copiado na trilha; clonagem: a voz de referência */
  const dubAudio = c.step.kind === 'video' && h3Mode(c.project) === 'dub' && c.sceneDir ? sceneAudio(c.sceneDir) : undefined;
  if (c.step.kind === 'video' && placeholders(wf).includes('ref_audio')) {
    /* áudio interno: o H3 gera a voz sem referência */
    const v0 = h3Mode(c.project) === 'internal' ? undefined : dubAudio ?? (c.scene?.speaker ? castFor(c.project, c.scene.speaker)?.refAudio : c.project.narrationVoice?.refAudio);
    const v = v0 && fs.existsSync(v0) ? await h3RefAudio(c, v0) : undefined;
    if (v && h3SpeechScene(c.project, c.scene, b)) {
      videoVoice = v;
      vars['ref_audio'] = await client.upload(v);
      c.log(dubAudio ? `MiniMax H3: dublagem — a narração da cena (${path.basename(v)}) é o <Audio 1>; o H3 sincroniza os lábios` : `MiniMax H3: voz clonada ${path.basename(v)} como <Audio 1>${c.scene?.speaker ? ` (${c.scene.speaker})` : ' (narrador)'}`);
    } else {
      dropRefAudio(wf);
      c.log(`MiniMax H3: ${c.scene?.narration?.trim() ? `${c.scene?.speaker ?? 'o narrador'} sem voz clonada (elenco/voz do projeto)` : 'cena sem fala'} — vídeo só com as imagens de referência`);
    }
  }
  const refAudio: string | undefined = member?.refAudio || (c.step.kind === 'narration' ? c.project.narrationVoice?.refAudio : undefined) || (c.step.kind === 'video' ? undefined : b.refAudio || side.refAudio);
  if (refAudio) {
    if (!fs.existsSync(refAudio)) throw new Error(`áudio de referência não encontrado: ${refAudio}`);
    c.log(`voz de referência: ${path.basename(refAudio)}`);
    vars['ref_audio'] = await client.upload(refAudio);
  }
  // imagem de entrada (I2V): artefato da etapa 'image' da cena
  const prevImg = c.scene?.artifacts['image']?.find((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const need = new Set(placeholders(wf));
  if (prevImg && (need.has('init_image') || need.has('first_frame') || need.has('last_frame'))) {
    /* um único upload serve para imagem de referência e para o par
       primeiro/último frame do loop perfeito (a mesma imagem nos dois). */
    const uploaded = await client.upload(prevImg);
    vars['init_image'] = uploaded;
    vars['first_frame'] = uploaded;
    vars['last_frame'] = uploaded;
    if (need.has('first_frame') && need.has('last_frame')) c.log(`loop: mesmo frame enviado como primeiro e último (${path.basename(prevImg)})`);
  }

  const missing = placeholders(wf).filter((k) => !(k in vars));
  if (missing.length) throw new Error(`${b.workflow}: variável(is) sem valor: ${missing.join(', ')}` +
    (missing.some((k) => k === 'init_image' || k === 'first_frame' || k === 'last_frame') ? ' (este workflow precisa da imagem da cena: etapa "image" antes)' : '') +
    (missing.includes('ref_audio') ? ' (defina refAudio no .map.json)' : ''));
  const graph = applyVariables(wf, vars, mapping);
  const castNames: string[] = [];
  /* dorama/história: retratos do elenco entram como referências extras do MiniMax H3 ref2video */
  if (c.step.kind === 'video' && c.scene && Number(side.castRefs) > 0) {
    const chars = charactersInScene(c.projectDir, c.scene, Number(side.castRefs));
    const uploads: string[] = [];
    for (const ch of chars) {
      try { uploads.push(await client.upload(await ensurePortrait(c, o, client, ch))); }
      catch (e) { c.log(`retrato de ${ch.name} indisponível (${(e as Error).message}) — segue sem ele`); }
    }
    if (injectCastRefs(graph as never, uploads, chars, String(vars['prompt'] ?? ''))) { castNames.push(...chars.slice(0, uploads.length).map((x) => x.name)); c.log(`elenco como referência: ${castNames.join(', ')}`); }
  }
  /* fala do MiniMax H3: a fala (com emoção) entra no próprio vídeo — "(S1) says: <d>[Idioma] …</d>" */
  /* na dublagem sem áudio para o nó (workflow sem LoadAudio ou cena sem narração), o vídeo sai sem fala e a narração TTS fica */
  const h3Talk = c.step.kind === 'video' && !!c.scene && isH3Video(b) && h3SpeechScene(c.project, c.scene, b) && (h3Mode(c.project) !== 'dub' || !!(dubAudio && videoVoice));
  if (h3Talk) {
    const node = Object.values(graph as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>).find((n) => /^MiniMaxH3/i.test(n?.class_type ?? '') && typeof n?.inputs?.['prompt'] === 'string');
    const idx = c.scene!.speaker ? castNames.findIndex((n) => n.toLowerCase() === c.scene!.speaker!.toLowerCase()) + 1 : 0;
    if (node) { node.inputs!['prompt'] = addH3Speech(String(node.inputs!['prompt']), sceneSpeech(c.project, c.scene!, idx || undefined), videoVoice ? (dubAudio ? h3DubRef(idx || undefined, c.scene!.speaker) : h3AudioRef(idx || undefined, c.scene!.speaker ?? 'the narrator')) : undefined); c.log(`MiniMax H3: fala no vídeo${c.scene!.emotion ? ` (emoção: ${c.scene!.emotion})` : ''}`); }
  }
  const pid = await client.submit(graph);
  c.log(`ComfyUI prompt_id=${pid}`);
  const entry = await client.waitFor(pid, c.signal, (pct) => c.log(`ComfyUI ${pct}%`));
  const outs = collectOutputs(entry, outputNode);
  if (outs.length === 0) throw new Error('ComfyUI não retornou arquivos de saída');
  const dest = primaryFile(c.step.kind, c);
  const audioKind = c.step.kind === 'narration' || c.step.kind === 'music' || c.step.kind === 'sfx';
  const pick = outs.find((f) => (c.step.kind === 'image' || c.step.kind === 'thumbnail' ? f.kind === 'images'
    : audioKind ? f.kind === 'audio' : f.kind !== 'audio')) ?? outs[0]!;
  const finalDest = audioKind || c.step.kind === 'video'
    ? dest.replace(/\.\w+$/, path.extname(pick.filename) || path.extname(dest)) : dest;
  await client.download(pick, finalDest);
  if (c.step.kind === 'narration') await trimNarration(c, finalDest);
  if (h3Talk && !dubAudio) await keepVideoSpeech(c, finalDest, o.toolsDir ?? path.resolve(__dirname, '../../tools'));
  if (c.step.kind === 'sfx') return { files: [await sceneSfxWav(c, finalDest)] };
  /* marca que este clipe veio de um workflow com primeiro E último frame:
     o clip-musical usa a marca para remover o frame duplicado e fechar o loop. */
  if (c.step.kind === 'video' && c.sceneDir && need.has('first_frame') && need.has('last_frame')) {
    fs.mkdirSync(path.join(c.sceneDir, 'clips'), { recursive: true });
    fs.writeFileSync(path.join(c.sceneDir, 'clips', 'loop.json'), JSON.stringify({
      workflow: b.workflow, firstFrame: 'scene image', lastFrame: 'scene image', at: new Date().toISOString(),
    }, null, 2));
  }
  if (server.freeAfter) await client.freeMemory();
  return { files: [finalDest] };
};

/** Ativa a clonagem de voz no Wan2GP quando a etapa tem um áudio de referência
 *  (voz do projeto, do elenco ou da rota). Sem referência, o template continua em
 *  voice design. O Wan2GP usa `audio_guide` + `audio_prompt_type` com A; deixar
 *  `alt_prompt` vazio faz o Whisper transcrever a referência. */
export function applyWan2gpReferenceVoice(settings: Record<string, unknown>, refAudio: string, templateAltPrompt?: string): void {
  const flags = String(settings.audio_prompt_type ?? '').toUpperCase();
  if (!flags.includes('A')) settings.audio_prompt_type = `A${flags}`;
  settings.audio_guide = refAudio;
  const alt = String(settings.alt_prompt ?? '').trim();
  /* o padrão do template é uma instrução de voice design (ex.: "male, middle-aged");
     em clonagem ele brigaria com o timbre do arquivo — limpamos só esse caso. */
  if (!alt || (templateAltPrompt !== undefined && alt === templateAltPrompt.trim())) settings.alt_prompt = '';
}

const wan2gpExec = (o: ExecutorOptions): Executor => async (c) => {
  const b = c.binding as Wan2gpBinding;
  const cfg = c.settings.wan2gp;
  if (!cfg?.root) throw new Error('Wan2GP não configurado (Provedores → wan2gp.root e wan2gp.python)');
  const tplPath = path.join(o.workflowsDir, b.template);
  if (!fs.existsSync(tplPath)) throw new Error(`template Wan2GP não encontrado: ${b.template}`);
  const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8')) as { model_type: string; settings: Record<string, unknown>; maxSide?: number; multiple?: number; megapixels?: number; refAudio?: string; vars?: Record<string, string | number>; needsRefs?: boolean; needsRefAudio?: boolean };
  const lang = wan2gpLanguage(c.project.language);
  const vars: Record<string, string | number> = { ...commonVars(c, tpl), language_name: lang.name, language_code: lang.code, language_label: lang.label, ...(tpl.vars ?? {}) };
  vars['speech_seconds'] = speechSeconds(String(vars['text'] ?? ''));
  const prevImg = c.scene?.artifacts['image']?.find((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (prevImg) vars['init_image'] = prevImg;                       // caminho absoluto local
  /* elenco como referência (image_refs): foto do usuário ou retrato já gerado de cada personagem da cena */
  if (c.scene && (tpl.needsRefs || placeholders(tpl.settings).includes('ref_images'))) {
    const refs = charactersInScene(c.projectDir, c.scene, 3).map((ch) => ({ name: ch.name, file: characterPhoto(c.project, c.projectDir, ch.name) ?? portraitFile(c.projectDir, ch.name) })).filter((r) => fs.existsSync(r.file));
    if (!refs.length) throw new Error(`${b.template}: nenhum retrato do elenco nesta cena (adicione fotos dos personagens ou gere os retratos antes) — usando o próximo provedor`);
    (vars as Record<string, unknown>)['ref_images'] = refs.map((r) => r.file);
    vars['ref_prompt'] = refPrompt(refs.map((r) => r.name), String(vars['prompt'] ?? ''));
    c.log(`Wan2GP: elenco como referência — ${refs.map((r) => r.name).join(', ')}`);
  }
  const member = c.step.kind === 'narration' ? castFor(c.project, c.scene?.speaker) : undefined;
  const refAudio = member?.refAudio || (c.step.kind === 'narration' ? c.project.narrationVoice?.refAudio : undefined) || b.refAudio || tpl.refAudio;
  if (refAudio) { if (!fs.existsSync(refAudio)) throw new Error(`áudio de referência não encontrado: ${refAudio}`); vars['ref_audio'] = refAudio; }
  else if (tpl.needsRefAudio) throw new Error(`${b.template}: este modelo clona uma voz — adicione a voz do projeto ou do personagem — usando o próximo provedor`);
  const missing = placeholders(tpl.settings).filter((k) => !(k in vars));
  if (missing.length) throw new Error(`${b.template}: variável(is) sem valor: ${missing.join(', ')}`);
  const settings = applyVariables(tpl.settings, vars) as Record<string, unknown>;
  /* Narração com voz adicionada no projeto/elenco: usa clonagem no Wan2GP em vez de voice design. */
  if (refAudio && c.step.kind === 'narration') {
    applyWan2gpReferenceVoice(settings, refAudio, typeof tpl.settings.alt_prompt === 'string' ? tpl.settings.alt_prompt : undefined);
    c.log(`Wan2GP: clonando a voz de referência ${path.basename(refAudio)}`);
  }
  /* voice design (sem voz clonada): a emoção da fala entra na descrição da voz */
  if (!refAudio && c.step.kind === 'narration' && c.scene?.emotion && typeof settings['alt_prompt'] === 'string' && settings['alt_prompt'].trim()) {
    settings['alt_prompt'] = `${settings['alt_prompt']}, ${deliveryEnglish(c.scene)}`;
  }
  /* fala do MiniMax H3 no vídeo: fala com emoção no prompt e, se o personagem tem voz clonada, ela vira o <Audio 1> (Ref2VA) */
  /* dublagem (padrão): a narração TTS da cena vira o <Audio 1> copiado 1:1 e o H3 só sincroniza os lábios (modelo Ref2VA);
     sem como passar o áudio, o vídeo sai sem fala e a narração TTS fica. Clonagem: o H3 gera a voz a partir da referência. */
  const dubAudio = c.step.kind === 'video' && h3Mode(c.project) === 'dub' && c.sceneDir && /ref2va/i.test(tpl.model_type) ? sceneAudio(c.sceneDir) : undefined;
  const h3Talk = c.step.kind === 'video' && !!c.scene && isH3Video(b) && h3SpeechScene(c.project, c.scene, b) && (h3Mode(c.project) !== 'dub' || !!dubAudio);
  if (h3Talk && typeof settings['prompt'] === 'string') {
    const names = String(vars['ref_prompt'] ?? '') ? charactersInScene(c.projectDir, c.scene!, 3).map((ch) => ch.name) : [];
    const idx = c.scene!.speaker ? names.findIndex((n) => n.toLowerCase() === c.scene!.speaker!.toLowerCase()) + 1 : 0;
    const voice0 = h3Mode(c.project) === 'internal' ? undefined : dubAudio ?? castFor(c.project, c.scene!.speaker)?.refAudio ?? (c.scene!.speaker ? undefined : c.project.narrationVoice?.refAudio);
    const useAudio = !!voice0 && fs.existsSync(voice0) && /ref2va/i.test(tpl.model_type);
    /* o H3 recusa referência com menos de 2 s: completa com silêncio */
    const voice = useAudio ? await h3RefAudio(c, voice0!) : voice0;
    settings['prompt'] = addH3Speech(settings['prompt'], sceneSpeech(c.project, c.scene!, idx || undefined), useAudio ? (dubAudio ? h3DubRef(idx || undefined, c.scene!.speaker) : h3AudioRef(idx || undefined, c.scene!.speaker)) : undefined);
    /* prompt exato enviado ao H3 (diagnóstico: o que o modelo pode ter falado) */
    if (c.sceneDir) try { fs.mkdirSync(path.join(c.sceneDir, 'clips'), { recursive: true }); fs.writeFileSync(path.join(c.sceneDir, 'clips', 'h3-prompt.txt'), String(settings['prompt'])); } catch { /* só diagnóstico */ }
    if (useAudio) {
      const flags = String(settings['audio_prompt_type'] ?? '').toUpperCase();
      if (!flags.includes('A')) settings['audio_prompt_type'] = `A${flags}`;
      settings['audio_guide'] = voice;
    }
    c.log(dubAudio ? `MiniMax H3: dublagem — lábios sincronizados com a narração da cena (${path.basename(dubAudio)})` : `MiniMax H3: fala no vídeo${c.scene!.emotion ? ` (emoção: ${c.scene!.emotion})` : ''}${useAudio ? ` com a voz clonada ${path.basename(voice!)}` : h3Mode(c.project) === 'internal' ? ' (áudio interno do H3, sem referência)' : ''}`);
  }
  const dest0 = primaryFile(c.step.kind, c);
  const client = Wan2gpClient.get(cfg, path.join(o.toolsDir ?? path.resolve(__dirname, '../../tools'), 'wan2gp_bridge.py'));
  const res = await client.generate(tpl.model_type, settings, c.signal, c.log);
  if (res.unknownKeys.length) c.log(`Wan2GP: chaves desconhecidas para ${tpl.model_type} (confira com "Listar modelos"): ${res.unknownKeys.join(', ')}`);
  const wantExt = c.step.kind === 'image' || c.step.kind === 'thumbnail' ? /\.(png|jpe?g|webp)$/i : c.step.kind === 'video' ? /\.(mp4|mov|webm|mkv)$/i : /\.(mp3|wav|flac|ogg|m4a)$/i;
  const pick = res.files.find((f) => wantExt.test(f) && fs.existsSync(f));
  if (!pick) throw new Error(`Wan2GP não gerou arquivo do tipo esperado (${c.step.kind}): ${res.files.join(', ')}`);
  const dest = c.step.kind === 'image' || c.step.kind === 'thumbnail' ? dest0 : dest0.replace(/\.\w+$/, path.extname(pick));
  ensureDir(dest); fs.copyFileSync(pick, dest);
  if (c.step.kind === 'narration') await trimNarration(c, dest);
  if (h3Talk && !dubAudio) await keepVideoSpeech(c, dest, o.toolsDir ?? path.resolve(__dirname, '../../tools'));
  if (c.step.kind === 'sfx') return { files: [await sceneSfxWav(c, dest)] };
  return { files: [dest] };
};

/**
 * Referência de áudio para o MiniMax H3: o modelo recusa áudio com menos de 2 s ("Audio Reference must be at least 2 seconds").
 * Fala curta (ex.: "O que você disse?") ganha silêncio no fim — na dublagem o áudio é copiado 1:1, então a fala fica igual.
 */
async function h3RefAudio(c: ExecContext, file: string): Promise<string> {
  let dur = 0;
  try { dur = await ff.duration(c.settings.ffprobe, file); } catch { return file; }
  const pad = refPadSec(dur);
  if (!pad) return file;
  const out = path.join(c.sceneDir ?? path.dirname(file), 'audio', `h3-ref-${path.basename(file).replace(/\.[^.]+$/, '')}.wav`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await ff.run(c.settings.ffmpeg, ['-y', '-v', 'error', '-i', file, '-af', `apad=pad_dur=${pad.toFixed(2)}`, '-ac', '2', '-ar', '44100', out], c.signal);
  c.log(`MiniMax H3: áudio de referência com ${dur.toFixed(2)} s — completado com ${pad.toFixed(2)} s de silêncio (mínimo de 2 s do H3)`);
  return out;
}

/**
 * Fala gerada pelo MiniMax H3 no vídeo: o áudio do clipe vira a narração da cena (scenes/<id>/audio/narration.wav),
 * assim a montagem, as legendas e a duração usam a voz do próprio vídeo. Clipe sem áudio: o motor narra por TTS.
 */
async function keepVideoSpeech(c: ExecContext, video: string, toolsDir?: string): Promise<void> {
  if (!c.sceneDir) return;
  const dir = path.join(c.sceneDir, 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'narration.wav');
  try {
    await ff.run(c.settings.ffmpeg, ['-y', '-v', 'error', '-i', video, '-vn', '-ac', '2', '-ar', '44100', out], c.signal);
    if (!fs.existsSync(out) || fs.statSync(out).size < 2000) throw new Error('clipe sem áudio');
    for (const f of fs.readdirSync(dir)) if (f.startsWith('narration.') && f !== 'narration.wav') fs.rmSync(path.join(dir, f), { force: true });
    /* marca que o áudio veio do clipe: a cena usa a duração exata do vídeo (sem a folga de 0,15 s,
       que fazia o clipe repetir o começo no fim) */
    fs.writeFileSync(path.join(dir, '.from-video'), '1');
    c.log('MiniMax H3: a fala do vídeo virou a narração da cena');
  } catch (e) { fs.rmSync(out, { force: true }); fs.rmSync(path.join(dir, '.from-video'), { force: true }); c.log(`MiniMax H3: não deu para usar o áudio do vídeo (${(e as Error).message.slice(0, 120)}) — a cena será narrada por TTS`); return; }
  /* fala curta num clipe de 5 s: o H3 inventa fala antes/depois — o Whisper acha a fala esperada
     e o resto do áudio é silenciado. A duração do clipe NÃO muda (antes o corte encolhia a cena). */
  if (!c.scene?.narration?.trim() || !toolsDir) return;
  try {
    const cfg = c.settings.whisper ?? { python: 'python', model: 'small', device: 'cpu' };
    const w = await transcribe(cfg, path.join(toolsDir, 'whisper_words.py'), out, wordsPath(c.sceneDir), c.project.language, c.signal);
    const total = await ff.duration(c.settings.ffprobe, out);
    const win = speechWindow(w.words, c.scene.narration);
    if (!win || total <= 0) { c.log(`MiniMax H3: a fala esperada não foi reconhecida no áudio ("${w.text.slice(0, 80)}") — cena mantida inteira`); return; }
    const from = Math.max(0, win.start - 0.35), to = Math.min(total, win.end + 0.5);
    if (from < 0.25 && total - to < 0.4) { c.log('MiniMax H3: a fala já ocupa o clipe — áudio mantido'); return; }
    /* mantém a janela da fala esperada e preenche o resto com silêncio, sem mexer na duração do vídeo */
    const ms = Math.round(from * 1000);
    const pad = Math.max(0, total - to);
    const af = [
      `atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)}`, 'asetpts=PTS-STARTPTS',
      ...(ms > 0 ? [`adelay=${ms}|${ms}`] : []),
      ...(pad > 0.001 ? [`apad=pad_dur=${pad.toFixed(3)}`] : []),
    ].join(',');
    const clean = `${out}.clean.wav`;
    await ff.run(c.settings.ffmpeg, ['-y', '-v', 'error', '-i', out, '-af', af, '-ac', '2', '-ar', '44100', clean], c.signal);
    fs.copyFileSync(clean, out); fs.rmSync(clean, { force: true });
    /* o áudio embutido no clipe também perde a fala inventada (o vídeo continua com a mesma duração) */
    const tmp = `${video}.audio.mp4`;
    await ff.run(c.settings.ffmpeg, ['-y', '-v', 'error', '-i', video, '-i', out, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest', tmp], c.signal);
    fs.copyFileSync(tmp, video); fs.rmSync(tmp, { force: true });
    /* tempos das palavras (as legendas usam) — a fala ficou na posição original do clipe, então os tempos não mudam */
    const kept = w.words.filter((x) => x.start >= from - 0.01 && x.end <= to + 0.01);
    fs.writeFileSync(wordsPath(c.sceneDir), JSON.stringify({ ...w, words: kept, text: kept.map((x) => x.w).join(' ') }, null, 1));
    c.log(`MiniMax H3: fala "${c.scene.narration.slice(0, 60)}" de ${win.start.toFixed(2)} a ${win.end.toFixed(2)} s — clipe mantido em ${total.toFixed(2)} s (resto do áudio em silêncio)`);
  } catch (e) { c.log(`MiniMax H3: limpeza do áudio pela transcrição indisponível (${(e as Error).message.slice(0, 120)}) — cena mantida inteira`); }
}

/** Prompt do Muse/Meta AI com a fala: o modelo gera a voz no clipe (10 s), sem TTS. */
function museSpeechPrompt(c: ExecContext): string {
  const s = c.scene!;
  const lang = h3Language(c.project.language);
  const how = deliveryEnglish(s);
  return `${visualPrompt(c)}\n\nDialogue — the only spoken words in this video: ${s.speaker ?? 'the narrator'} speaks in ${lang}, in a ${how} tone, and says: "${h3SpokenText(s.narration)}" Lips move naturally with the words; there is no other speech before or after this line.`;
}

/**
 * Voz gerada pelo próprio vídeo (Muse/Meta AI): o áudio do clipe vira a narração da cena,
 * como no MiniMax H3, mas sem silenciar nada (o clipe já traz a ambiência).
 */
async function keepVideoAudio(c: ExecContext, video: string, toolsDir?: string, label = 'Muse AI'): Promise<void> {
  if (!c.sceneDir) return;
  const dir = path.join(c.sceneDir, 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'narration.wav');
  try {
    await ff.run(c.settings.ffmpeg, ['-y', '-v', 'error', '-i', video, '-vn', '-ac', '2', '-ar', '44100', out], c.signal);
    if (!fs.existsSync(out) || fs.statSync(out).size < 2000) throw new Error('clipe sem áudio');
    for (const f of fs.readdirSync(dir)) if (f.startsWith('narration.') && f !== 'narration.wav') fs.rmSync(path.join(dir, f), { force: true });
    fs.writeFileSync(path.join(dir, '.from-video'), '1');
    c.log(`${label}: a voz do vídeo virou a narração da cena`);
  } catch (e) {
    fs.rmSync(out, { force: true });
    fs.rmSync(path.join(dir, '.from-video'), { force: true });
    c.log(`${label}: o vídeo veio sem áudio (${(e as Error).message.slice(0, 120)}) — a cena fica sem fala`);
    return;
  }
  /* tempos das palavras para as legendas (o áudio não é cortado) */
  if (!c.scene?.narration?.trim() || !toolsDir) return;
  try {
    const cfg = c.settings.whisper ?? { python: 'python', model: 'small', device: 'cpu' };
    const w = await transcribe(cfg, path.join(toolsDir, 'whisper_words.py'), out, wordsPath(c.sceneDir), c.project.language, c.signal);
    fs.writeFileSync(wordsPath(c.sceneDir), JSON.stringify(w, null, 1));
    c.log(`${label}: palavras do áudio para as legendas (${w.words.length})`);
  } catch (e) { c.log(`${label}: tempos das palavras indisponíveis (${(e as Error).message.slice(0, 100)})`); }
}

/** Efeitos gerados por IA viram scenes/<id>/audio/sfx.wav (estéreo 44,1 kHz, no tamanho da cena) — o formato que a montagem mistura. */
async function sceneSfxWav(c: ExecContext, file: string): Promise<string> {
  if (!c.sceneDir) throw new Error('efeitos sonoros são por cena');
  const out = path.join(c.sceneDir, 'audio', 'sfx.wav');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const sec = Math.max(0.5, c.scene?.durationSec ?? 4).toFixed(3);
  const tmp = `${out}.tmp.wav`;
  await ff.run(c.settings.ffmpeg, ['-y', '-v', 'error', '-i', file, '-af', `aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_dur=${sec},atrim=end=${sec}`, '-ac', '2', '-ar', '44100', tmp], c.signal);
  fs.copyFileSync(tmp, out); fs.rmSync(tmp, { force: true });
  if (path.resolve(file) !== path.resolve(out)) try { fs.rmSync(file, { force: true }); } catch { /* ok */ }
  if (!sfx.validWav(out)) throw new Error('efeito sonoro gerado ficou vazio');
  c.log(`efeitos sonoros por IA: ${path.basename(out)} (${sec} s)`);
  return out;
}

/** Uma geração por vez em cada conta do Flow (a página é uma só). */
const flowLocks = new Map<string, Promise<unknown>>();
const flowExec = (_o: ExecutorOptions): Executor => async (c) => {
  const b = c.binding as FlowBinding;
  const k = c.step.kind;
  if (k !== 'image' && k !== 'thumbnail' && k !== 'video') throw new Error(`o Flow gera imagem ou vídeo (etapa "${k}" não suportada)`);
  /* conta escolhida no projeto vence a da etapa (Novo projeto / editor → Conta do Flow) */
  const acc = flowAccount(c.settings, c.project.flowAccount || b.account);
  if (c.project.flowAccount) c.log(`Flow com a conta do projeto: ${acc.label}`);
  const prev = flowLocks.get(acc.id) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  flowLocks.set(acc.id, prev.then(() => mine));
  await prev.catch(() => {});
  try {
    const port = await ensureFlowBrowser(c.settings, acc.id, c.log);
    const media = k === 'video' ? 'video' : 'image';
    const prompt = k === 'thumbnail' ? thumbnailPrompt(c) : visualPrompt(c);   // proporção, duração e "1 mídia" entram no pedido ao agente (flowPrompt)
    c.log(`Flow (conta "${acc.label}"): gerando ${media === 'image' ? 'imagem' : 'vídeo'}…`);
    const dest = primaryFile(k, c);
    /* personagens da cena (biblioteca/elenco): folha ou retrato como referência, na ordem em que aparecem */
    const refs = c.scene && k !== 'thumbnail' ? charactersInScene(c.projectDir, c.scene, 3).map((ch) => ({ name: ch.name, file: characterPhoto(c.project, c.projectDir, ch.name) ?? portraitFile(c.projectDir, ch.name) })).filter((r) => fs.existsSync(r.file)) : [];
    /* cenários e objetos da biblioteca citados na cena + o esboço escolhido no storyboard (composição) */
    if (c.scene && k !== 'thumbnail') {
      for (const it of (c.project.characters ?? []).filter((x) => x.entity && inScene(x.name, c.scene))) {
        const f = ['.png', '.jpg', '.jpeg', '.webp'].map((e) => path.join(c.projectDir, 'assets', 'user', it.entity === 'location' ? 'locations' : 'props', `${it.id}${e}`)).find((x) => fs.existsSync(x));
        if (f && refs.length < 5) refs.push({ name: it.entity === 'location' ? `cenário ${it.name}` : `objeto ${it.name}`, file: f });
      }
      const sk = c.scene.sketch ? path.join(c.projectDir, c.scene.sketch) : '';
      if (sk && fs.existsSync(sk) && refs.length < 6) refs.push({ name: 'esboço do storyboard (siga a composição)', file: sk });
    }
    const got = await flowGenerate({ port, flowUrl: c.settings.automations?.flowUrl?.trim() || DEFAULT_FLOW_URL, prompt, media, dest, timeoutSec: Math.max(60, c.step.timeoutSec - 30), refs: refs.length ? refs : undefined,
      aspect: c.project.aspect, seconds: c.scene?.durationSec, projectUrl: flowProjectOf(c.settings, acc.id), onProject: (u) => setFlowProject(c.settings, acc.id, u),
      signal: c.signal, log: c.log, debugDir: path.join(c.sceneDir ?? c.outDir, 'flow-debug') });
    // formato que a montagem espera: frame.png / thumbnail.png / clip.mp4
    if (got !== dest) {
      if (media === 'image') await ff.run(c.settings.ffmpeg, ['-y', '-i', got, '-frames:v', '1', dest], c.signal);
      else await ff.run(c.settings.ffmpeg, ['-y', '-i', got, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', dest], c.signal);
      fs.rmSync(got, { force: true });
    }
    return { files: [dest] };
  } finally { release(); }
};

const stockExec = (_o: ExecutorOptions): Executor => async (c) => {
  const b = c.binding as StockBinding;
  if (!c.scene || !c.sceneDir) throw new Error('banco de mídia é por cena');
  const allowed = c.project.mediaSources?.length ? b.sources.filter((x) => c.project.mediaSources!.includes(x)) : b.sources;
  /* a rota é explícita: se o projeto (herdado da skill) não lista nenhuma das
     fontes da rota, usa as da rota em vez de falhar (ex.: rota só com YouTube). */
  let sources = allowed.length ? allowed : b.sources;
  if (!allowed.length && c.project.mediaSources?.length) c.log(`rota usa ${b.sources.join(', ')}; o projeto não lista essas fontes — usando as da rota`);
  /* ordem pelo tema: cena com imagens antigas busca primeiro no Internet Archive, espaço na NASA… (params.autoOrder=false desliga) */
  if ((c.step.params as Record<string, unknown> | undefined)?.autoOrder !== false) {
    const sc = c.scene;
    const ord = orderStockSources(sources, [sc.title, sc.narration, sc.visualIntent, termsText(sc.searchTerms)].filter(Boolean).join(' \n '), `${c.project.name ?? ''}\n${c.project.idea ?? ''}`);
    if (ord.theme && ord.sources.join() !== sources.join()) c.log(`bancos de mídia em ordem para ${ord.theme}: ${ord.sources.join(' → ')}`);
    sources = ord.sources;
  }
  if (sources.length === 0) throw new Error('nenhuma fonte de mídia habilitada neste projeto');
  const query = (termsText(c.scene.searchTerms) || termsText(c.scene.visualIntent) || termsText(c.scene.title)).slice(0, 120);
  const { w, h } = ff.resolution(c.project.aspect);
  const dir = path.join(c.sceneDir, 'stock');
  /* duração real da cena (inclui a narração quando já existe), não só o alvo do plano */
  const sceneSec = await sceneSeconds(c, c.scene, c.sceneDir);
  const assets = await fetchForScene(c.settings, sources, b.media, query, dir, {
    width: w, height: h, count: c.scene.kind === 'stock' ? 1 : 3,
    /* maxSeconds (ex.: 4) define o tamanho de cada trecho; se a cena for maior, o
       YouTube é completado com trechos seguintes do mesmo vídeo (sem repetir). */
    seconds: Math.min(sceneSec, Math.max(2, Number((c.step.params as Record<string, unknown> | undefined)?.maxSeconds ?? sceneSec ?? 4))),
    sceneSeconds: sceneSec,
    context: c.scene.narration, signal: c.signal, log: c.log,
    seed: `${c.project.id}:${c.scene.id}:${Date.now()}`,
  });
  c.log(`${assets.length} mídia(s) para "${query}"`);
  const files = [path.join(dir, 'stock.json'), ...assets.map((a) => a.file)];
  if (c.scene.kind === 'stock') {            // cena só de mídia: vira o visual principal
    const vid = assets.find((a) => a.hit.kind === 'video'), img = assets.find((a) => a.hit.kind === 'image');
    if (vid) { const d = path.join(c.sceneDir, 'clips', 'clip.mp4'); ensureDir(d); fs.copyFileSync(vid.file, d); files.push(d); }
    else if (img) {
      const d = path.join(c.sceneDir, 'frames', 'frame.png'); ensureDir(d);
      await ff.run(c.settings.ffmpeg, ['-y', '-i', img.file, '-frames:v', '1', d], c.signal);   // converte jpg/webp → png
      files.push(d);
    }
  }
  return { files };
};

export function sceneVisual(sceneDir: string, kind: Scene['kind']): string | undefined {
  const order: Record<Scene['kind'], string[]> = {
    image: ['frames/frame.png', 'clips/clip.mp4', 'clips/code.mp4', 'clips/motion.mp4'],
    video: ['clips/clip.mp4', 'frames/frame.png', 'clips/code.mp4', 'clips/motion.mp4'],
    code: ['clips/code.mp4', 'clips/clip.mp4', 'frames/frame.png', 'clips/motion.mp4'],
    motion: ['clips/motion.mp4', 'clips/code.mp4', 'clips/clip.mp4', 'frames/frame.png'],
    mixed: ['clips/code.mp4', 'clips/clip.mp4', 'clips/motion.mp4', 'frames/frame.png'],
    stock: ['clips/clip.mp4', 'frames/frame.png', 'clips/code.mp4', 'clips/motion.mp4'],
  };
  return [...order[kind].map((r) => path.join(sceneDir, r)),
    // fallback: mídia de banco já baixada (ex.: cena "mixed" sem a etapa de código)
    ...['stock-1.mp4', 'stock-1.webm', 'stock-1.jpg', 'stock-1.png', 'stock-1.webp'].map((r) => path.join(sceneDir, 'stock', r))]
    .find((f) => fs.existsSync(f));
}
/** Cartão de fallback (título da cena) quando a rota não produziu nenhum visual. */
async function fallbackCard(ffmpeg: string, scene: Scene, aspect: Aspect, signal?: AbortSignal): Promise<string> {
  const { w, h } = ff.resolution(aspect);
  const dir = path.join(os.tmpdir(), 'forge-cards');
  fs.mkdirSync(dir, { recursive: true });
  const txt = path.join(dir, `${scene.id}.txt`);
  const png = path.join(dir, `${scene.id}.png`);
  fs.writeFileSync(txt, scene.title || `Cena ${scene.index}`, 'utf8');
  const textFile = txt.replace(/\\/g, '/').replace(/:/g, '\\:');
  const vf = `drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':textfile='${textFile}':fontcolor=white:fontsize=${Math.round(h / 14)}:x=(w-text_w)/2:y=(h-text_h)/2`;
  try {
    await ff.run(ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=0x14213d:s=${w}x${h}:r=30`, '-vf', vf, '-frames:v', '1', png], signal);
  } catch {
    await ff.run(ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=0x14213d:s=${w}x${h}:r=30`, '-frames:v', '1', png], signal);
  }
  return png;
}

const MOVES: NonNullable<SceneEffects['zoom']>[] = ['in', 'pan_right', 'out', 'pan_left', 'in_right', 'pan_up', 'in_left', 'pan_down'];
/** Slideshow: imagens paradas ganham movimento e transição padrão quando a cena não define. */
export function autoMotion(s: Scene, params: Record<string, unknown>): SceneEffects | undefined {
  const e = { ...(s.effects ?? {}) };
  if (params.autoMotion && (!e.zoom) && (s.kind === 'image' || s.kind === 'stock')) e.zoom = MOVES[(s.index - 1) % MOVES.length]!;
  const tr = typeof params.defaultTransition === 'string' ? params.defaultTransition as SceneEffects['transition'] : undefined;
  if (tr && !e.transition) { e.transition = tr; e.transitionSec ??= Number(params.transitionSec ?? 0.6); }
  return Object.keys(e).length ? e : undefined;
}

/** Narração da cena (definida em `timeline.ts`: um só lugar para o relógio e o áudio). */
export const sceneAudio = narrationAudio;
/** Duração da cena: sempre a regra da timeline (montagem, legenda, capítulos e thumb leem o mesmo número). */
async function sceneSeconds(c: ExecContext, s: Scene, dir: string): Promise<number> {
  return sceneSecondsOf(c.settings.ffprobe, s, dir);
}

const FALLBACK_16BIT_HTML = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style></head>
<body><canvas id="c" width="1920" height="1080"></canvas>
<script>
(function(){
  var W=320,H=180;
  var view=document.createElement('canvas'); view.width=W; view.height=H;
  var v=view.getContext('2d');
  var c=document.getElementById('c'); var ctx=c.getContext('2d');
  c.width=1920; c.height=1080;
  function px(x,y,w,h,col){v.fillStyle=col;v.fillRect(x|0,y|0,w|0,h|0);}
  function tower(cx,base,height){
    for (var i=0;i<height;i++){ var w=Math.max(1,Math.round((height-i)/height*18)); px(cx-w/2, base-i, w, 1, '#171021'); }
    px(cx-11, base-Math.round(height*0.30), 22, 2, '#171021');
    px(cx-7, base-Math.round(height*0.58), 14, 2, '#171021');
    px(cx-1, base-height-6, 2, 6, '#171021');
  }
  function draw(t){
    var u=(t%12)/12;
    var bands=['#20182e','#2b1b3b','#4a2b48','#7a4252','#b96560','#e08a68','#f2b07a','#ffd29a'];
    for (var i=0;i<bands.length;i++) px(0, i*23, W, 24, bands[i]);
    v.fillStyle='#ffe3a3'; v.beginPath(); v.arc(252,52,13,0,6.29); v.fill();
    v.fillStyle='rgba(255,214,140,0.25)'; v.beginPath(); v.arc(252,52,22,0,6.29); v.fill();
    for (var k=0;k<4;k++){ var cx=((k*88 + u*40)%(W+60))-30; px(cx, 34+k*11, 30, 4, 'rgba(255,225,190,0.35)'); px(cx+6,30+k*11,18,4,'rgba(255,225,190,0.35)'); }
    px(0,78,78,62,'#2a203b'); px(78,92,34,48,'#332541'); px(288,72,32,68,'#26304a'); px(262,88,26,52,'#2b243d');
    for (var b=0;b<22;b++){ px(5+(b%5)*14, 84+Math.floor(b/5)*12, 3,4, b%3?'#f3c57a':'#8ad0c0'); }
    for (var b2=0;b2<10;b2++){ px(292+(b2%4)*7, 80+Math.floor(b2/4)*12, 3,4, b2%2?'#f3c57a':'#8ad0c0'); }
    tower(238,132,74);
    px(0,128,W,52,'#221a2d'); px(0,128,W,4,'#3b2b44');
    for (var r=0;r<9;r++) px(6+r*34, 136+((r*7)%16), 18, 2, 'rgba(255,194,125,0.18)');
    for (var ci=0; ci<3; ci++){
      var dir = ci%2? -1: 1;
      var x = dir>0 ? ((u*90 + ci*110)%(W+80))-50 : W+50-((u*70+ci*90)%(W+80));
      var y = ci%2? 142: 134;
      px(x,y,26,9, ci===1?'#b34b4b':'#d8a34f');
      px(x+4,y-4,14,5, ci===1?'#b34b4b':'#d8a34f');
      px(x+5,y-3,5,3,'#7ec8d8'); px(x+14,y-3,4,3,'#7ec8d8');
      px(dir>0?x+24:x-2, y+3, 3, 3, '#ffe6a0');
      px(x+4,y+9,4,3,'#171021'); px(x+18,y+9,4,3,'#171021');
    }
    v.fillStyle='rgba(190,220,255,0.5)';
    for (var ri=0;ri<46;ri++){ var rx=(ri*37)%W, ry=(ri*23 + u*180)%128; v.fillRect(rx,ry,1,3); }
    px(0,0,W,5,'#0d0a13'); px(0,0,5,H,'#0d0a13'); px(W-5,0,5,H,'#0d0a13');
    px(0,124,W,3,'#0d0a13');
    px(0,146,W,34,'#3a241f'); px(0,146,W,3,'#5a372b');
    px(52,154,36,18,'#efdcb8'); px(52,154,36,3,'#fff0d2'); px(56,155,28,4,'#5a3421');
    px(88,158,6,8,'#efdcb8'); px(90,160,3,4,'#3a241f');
    px(46,171,48,3,'#caa98d');
    v.fillStyle='rgba(255,255,255,0.35)';
    for (var s=0;s<4;s++){ var sy=151-((u*60+s*13)%46); var sx=64+Math.sin((u*6.28)+s)*6; v.fillRect(sx,sy,3,7); }
    px(280,142,24,24,'#3b2b44'); px(284,128,4,16,'#4d7a56'); px(290,124,4,20,'#5d8a5f'); px(296,130,4,14,'#4d7a56');
    px(284,124,10,3,'#6f9c6d');
    for (var li=0;li<7;li++){ var lx=18+li*44, ly=14+Math.round(Math.sin(li*1.7)*3); px(lx,ly,2,2,'#ffd28a'); v.fillStyle='rgba(255,210,138,0.18)'; v.beginPath(); v.arc(lx+1,ly+1,4,0,6.29); v.fill(); }
    px(210,145,12,6,'#5a3a35'); px(219,141,5,5,'#5a3a35'); px(220,140,2,2,'#5a3a35'); px(222,140,2,2,'#5a3a35');
    px(209,146,3,4,'#5a3a35'); px(206,149,4,1,'#5a3a35');
    var g=v.createRadialGradient(W/2,H/2,60,W/2,H/2,200); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,0.35)'); v.fillStyle=g; v.fillRect(0,0,W,H);
    ctx.imageSmoothingEnabled=false; ctx.drawImage(view,0,0,W,H,0,0,c.width,c.height);
  }
  var paused=false, raf=0, t0=0;
  function seek(t){ draw(Number(t)||0); }
  function loop(now){ if(!t0)t0=now; if(!paused) seek(((now-t0)/1000)%12); raf=requestAnimationFrame(loop); }
  window.__forge={ duration:12, fps:30, seek:seek, pause:function(){ paused=true; cancelAnimationFrame(raf); } };
  loop(0);
})();
</script></body></html>`;

const FALLBACK_8BIT_HTML = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style></head>
<body><canvas id="c" width="1920" height="1080"></canvas>
<script>
(function(){
  var W=256,H=144;
  var view=document.createElement('canvas'); view.width=W; view.height=H;
  var v=view.getContext('2d');
  var c=document.getElementById('c'); var ctx=c.getContext('2d');
  c.width=1920; c.height=1080;
  var P={ink:'#0b0b16',night:'#1b2438',blue:'#2e4a5e',green:'#4f7a6a',red:'#a85b4f',orange:'#d18a4f',gold:'#f2c46b',cream:'#fff1c0',wood:'#3a2a24'};
  function px(x,y,w,h,col){v.fillStyle=col;v.fillRect(x|0,y|0,w|0,h|0);}
  function tower(cx,base,height){
    for (var i=0;i<height;i++){ var w=Math.max(1,Math.round((height-i)/height*14)); px(cx-w/2, base-i, w, 1, P.ink); }
    px(cx-8, base-Math.round(height*0.30), 16, 2, P.ink);
    px(cx-5, base-Math.round(height*0.58), 10, 2, P.ink);
    px(cx-1, base-height-5, 2, 5, P.ink);
  }
  function draw(t){
    var u=(t%12)/12, tau=u*6.28318;
    /* ---------- exterior (through the window) ---------- */
    px(0,0,W,H,P.night);
    px(0,0,W,26,'#141a2c'); px(0,26,W,20,P.night); px(0,46,W,18,P.blue); px(0,64,W,24,'#3f5a6a');
    for (var st=0; st<26; st++){ px((st*53+11)%W, (st*29+7)%58, 1, 1, st%4?P.cream:P.gold); }
    /* moon */
    px(174,10,16,14,P.gold); px(178,8,8,18,P.gold); px(182,8,8,10,P.night);
    /* skyline */
    px(0,58,34,30,P.night); px(38,64,28,24,P.night); px(70,60,16,28,P.night);
    px(196,56,26,32,P.night); px(226,62,24,26,P.night);
    for (var bw=0; bw<14; bw++){ var bx=[6,16,48,56,74,200,210,232,242,250][bw%10]; var by=64+(bw%3)*6; px(bx,by,3,3, bw%2?P.gold:P.orange); }
    /* Eiffel */
    tower(150,88,50);
    /* avenue */
    px(0,86,W,9,'#232a3c'); px(0,87,W,1,P.blue);
    for (var lp=0; lp<4; lp++){ var lx2=18+lp*68; px(lx2,64,1,22,P.ink); px(lx2-2,62,5,3,P.gold); }
    /* cars (periodic) */
    for (var ci=0; ci<3; ci++){
      var span=W+36;
      var cx2=((u*72 + ci*88 + 20) % span) - 18;
      var cy2=88 + (ci%2)*3;
      var col=ci===1?P.red:(ci===2?P.green:P.orange);
      px(cx2,cy2,18,6,col); px(cx2+3,cy2-3,11,3,col);
      px(cx2+4,cy2-2,3,2,P.blue); px(cx2+10,cy2-2,3,2,P.blue);
      px(cx2+2,cy2+6,3,2,P.ink); px(cx2+13,cy2+6,3,2,P.ink);
      px(cx2+16,cy2+2,2,2,P.cream);
    }
    /* rain (periodic) */
    v.fillStyle='#6f93a0';
    for (var r=0; r<46; r++){ v.fillRect((r*61+7)%W, ((r*19 + u*88) % 88), 1, 3); }
    /* ---------- window frame ---------- */
    px(0,0,W,6,P.ink); px(0,0,6,H,P.ink); px(W-6,0,6,H,P.ink);
    px(0,88,W,5,P.ink); px(124,0,5,88,P.ink);
    v.fillStyle='rgba(255,255,255,0.045)'; v.fillRect(8,8,46,76); v.fillRect(132,8,30,76);
    /* curtains */
    px(6,6,10,82,P.red); px(10,6,4,82,'#7a3a3a'); px(16,6,5,82,P.red);
    px(W-16,6,10,82,P.red); px(W-20,6,4,82,'#7a3a3a'); px(W-26,6,5,82,P.red);
    /* ---------- interior ---------- */
    px(0,93,W,51,P.wood); px(0,93,W,2,'#241a16'); px(0,96,W,1,P.orange);
    /* saucer + cup */
    px(34,110,36,3,'#d9c9a8');
    px(36,107,32,4,P.cream); px(38,104,28,4,P.cream); px(40,103,24,2,P.gold);
    px(66,106,5,4,P.cream); px(44,105,16,1,'#c9a36b'); px(34,113,36,1,'#2a1b17');
    /* steam (periodic) */
    for (var s=0; s<3; s++){
      var sy2=100 - ((u*36 + s*7) % 22);
      v.fillStyle='rgba(255,241,192,0.30)';
      v.fillRect(48 + Math.round(Math.sin(tau*2 + s*1.7)*3), sy2, 2, 5);
    }
    /* cat (periodic tail) */
    px(206,104,14,11,P.ink); px(208,98,10,8,P.ink);
    px(208,96,2,4,P.ink); px(216,96,2,4,P.ink);
    px(209,100,2,2,P.gold); px(214,100,2,2,P.gold);
    var tw=Math.round(Math.sin(tau)*2);
    px(220,112,2+tw,2,P.ink); px(218,114,4,2,P.ink);
    /* plant */
    px(24,126,10,10,'#5a3a2e'); px(25,124,8,3,P.green);
    px(28,116,1,8,P.green); px(25,118,3,1,P.green); px(31,120,3,1,P.green);
    /* string lights */
    for (var li2=0; li2<7; li2++){
      var lx3=20+li2*32, ly3=10+(li2%2)*3;
      v.fillStyle='rgba(242,196,107,0.12)'; v.beginPath(); v.arc(lx3,ly3+1,4,0,6.29); v.fill();
      px(lx3-1,ly3,3,3,li2%2?P.gold:P.cream); px(lx3,ly3+3,1,1,P.ink);
    }
    v.fillStyle='rgba(11,11,22,0.25)'; v.fillRect(0,0,4,H); v.fillRect(W-4,0,4,H);
    ctx.imageSmoothingEnabled=false; ctx.drawImage(view,0,0,W,H,0,0,c.width,c.height);
  }
  var paused=false, raf=0, t0=0;
  function seek(t){ draw(Number(t)||0); }
  function loop(now){ if(!t0)t0=now; if(!paused) seek(((now-t0)/1000)%12); raf=requestAnimationFrame(loop); }
  window.__forge={ duration:12, fps:30, seek:seek, pause:function(){ paused=true; cancelAnimationFrame(raf); } };
  loop(0);
})();
</script></body></html>`;

const FALLBACK_ANIME_HTML = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style></head>
<body><canvas id="c" width="1920" height="1080"></canvas>
<script>
(function(){
  var c=document.getElementById('c'), ctx=c.getContext('2d');
  var W=1920,H=1080,TAU=Math.PI*2;
  c.width=W;c.height=H;
  function rr(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  function petal(x,y,s,rot,col,alpha){ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.globalAlpha=alpha;ctx.fillStyle=col;ctx.beginPath();ctx.ellipse(0,0,s,s*0.55,0,0,TAU);ctx.fill();ctx.restore();}
  var petals=[]; for(var i=0;i<34;i++){petals.push({x:(i*137+80)%W,y:(i*83+60)%H,s:8+(i%5)*3,ph:i*1.7,rot:i*0.9});}
  function draw(t){
    var u=(t%12)/12, tau=u*TAU;
    var sky=ctx.createLinearGradient(0,0,0,H*0.82);
    sky.addColorStop(0,'#2c2450'); sky.addColorStop(0.38,'#7b4a7a'); sky.addColorStop(0.62,'#e07a5f'); sky.addColorStop(0.82,'#f2b36b'); sky.addColorStop(1,'#f6d7a8');
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    var sx=W*0.70, sy=H*0.57;
    var glow=ctx.createRadialGradient(sx,sy,20,sx,sy,260);
    glow.addColorStop(0,'rgba(255,244,200,0.95)');glow.addColorStop(0.25,'rgba(255,190,120,0.55)');glow.addColorStop(1,'rgba(255,150,90,0)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(sx,sy,260,0,TAU);ctx.fill();
    ctx.fillStyle='#fff1c9';ctx.beginPath();ctx.arc(sx,sy,78,0,TAU);ctx.fill();
    ctx.fillStyle='rgba(255,205,190,0.55)';
    for(var ci=0;ci<7;ci++){var cx=((ci*330+u*120)%(W+420))-210, cy=120+(ci%3)*95;ctx.beginPath();ctx.ellipse(cx,cy,180,42,0,0,TAU);ctx.ellipse(cx+120,cy+10,120,30,0,0,TAU);ctx.ellipse(cx-110,cy+14,90,24,0,0,TAU);ctx.fill();}
    ctx.fillStyle='#4d3a5e';ctx.beginPath();ctx.moveTo(0,H*0.78);ctx.lineTo(180,H*0.63);ctx.lineTo(360,H*0.74);ctx.lineTo(560,H*0.58);ctx.lineTo(760,H*0.73);ctx.lineTo(980,H*0.62);ctx.lineTo(1200,H*0.75);ctx.lineTo(1440,H*0.60);ctx.lineTo(1680,H*0.74);ctx.lineTo(1920,H*0.66);ctx.lineTo(1920,H*0.82);ctx.lineTo(0,H*0.82);ctx.closePath();ctx.fill();
    ctx.fillStyle='#2a2438';
    var bld=[[0,760,120,180],[130,720,90,220],[230,780,150,160],[390,700,110,240],[510,760,140,180],[660,730,100,210],[770,780,170,160],[950,710,90,230],[1050,760,130,180],[1190,730,160,210],[1360,780,120,160],[1490,720,100,220],[1600,760,150,180],[1760,730,160,210]];
    for(var b=0;b<bld.length;b++){var B=bld[b];ctx.fillRect(B[0],B[1],B[2],B[3]);}
    for(var wi=0;wi<160;wi++){var wx=(wi*97+31)%W, wy=740+((wi*53)%150);if(wy<900){ctx.fillStyle=(wi%7===0)?'#ffd58a':'#f0a36b';ctx.fillRect(wx,wy,5,7);}}
    ctx.fillStyle='#1b1626';ctx.fillRect(0,H*0.82,W,H*0.18);
    ctx.strokeStyle='rgba(255,180,120,0.55)';ctx.lineWidth=3;
    for(var l=0;l<14;l++){var lx=((l*170+u*260)%(W+200))-100;ctx.beginPath();ctx.moveTo(lx,H*0.86);ctx.lineTo(lx+80,H*0.86);ctx.stroke();}
    ctx.strokeStyle='#2b2335';ctx.lineWidth=4;
    for(var p=0;p<5;p++){var px=80+p*420;ctx.beginPath();ctx.moveTo(px,H*0.90);ctx.lineTo(px,H*0.34);ctx.stroke();ctx.beginPath();ctx.moveTo(px-45,H*0.38);ctx.lineTo(px+45,H*0.38);ctx.stroke();}
    ctx.lineWidth=3;ctx.strokeStyle='rgba(40,30,50,0.8)';
    for(var w=0;w<4;w++){ctx.beginPath();ctx.moveTo(0,H*(0.36+w*0.025));ctx.bezierCurveTo(W*0.3,H*(0.33+w*0.02),W*0.7,H*(0.39+w*0.02),W,H*(0.35+w*0.025));ctx.stroke();}
    for(var pi=0;pi<petals.length;pi++){var P=petals[pi];var py=(P.y+u*H*1.2+P.ph*20)%(H+60)-30;var px2=(P.x+Math.sin(tau+P.ph)*40+u*120)%W;petal(px2,py,P.s,P.rot+tau*0.6,pi%4===0?'#ffd1dc':'#f7a8b8',0.85);}
    ctx.fillStyle='#171420';ctx.fillRect(0,0,W,54);ctx.fillRect(0,H-54,W,54);ctx.fillRect(0,0,54,H);ctx.fillRect(W-54,0,54,H);
    ctx.strokeStyle='#3a3040';ctx.lineWidth=10;rr(54,54,W-108,H-108,26);ctx.stroke();
    ctx.save();ctx.globalAlpha=0.08;ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(120,80);ctx.lineTo(420,80);ctx.lineTo(180,H-100);ctx.lineTo(80,H-100);ctx.closePath();ctx.fill();ctx.restore();
    var seat=ctx.createLinearGradient(0,H-260,0,H);
    seat.addColorStop(0,'#3b2e3f');seat.addColorStop(1,'#201a28');
    ctx.fillStyle=seat;ctx.beginPath();ctx.moveTo(0,H-120);ctx.quadraticCurveTo(W*0.5,H-260,W,H-120);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fill();
    var bob=Math.sin(tau*2)*3;
    ctx.save();ctx.translate(0,bob);
    ctx.fillStyle='#2f4a5a';ctx.beginPath();ctx.moveTo(230,H-40);ctx.bezierCurveTo(240,H-330,360,H-420,520,H-430);ctx.bezierCurveTo(700,H-440,760,H-300,780,H-40);ctx.closePath();ctx.fill();
    ctx.fillStyle='#d85d5d';ctx.beginPath();ctx.moveTo(320,H-380);ctx.bezierCurveTo(380,H-330,470,H-330,540,H-370);ctx.bezierCurveTo(600,H-400,660,H-360,700,H-300);ctx.bezierCurveTo(620,H-300,560,H-320,500,H-300);ctx.bezierCurveTo(430,H-280,360,H-300,320,H-380);ctx.fill();
    ctx.fillStyle='#1c1a28';ctx.beginPath();ctx.ellipse(500,H-540,190,220,0,0,TAU);ctx.fill();
    ctx.beginPath();ctx.moveTo(320,H-560);ctx.bezierCurveTo(300,H-360,360,H-300,390,H-280);ctx.lineTo(420,H-400);ctx.closePath();ctx.fill();
    ctx.fillStyle='#f2c9a8';ctx.beginPath();ctx.ellipse(560,H-570,120,145,-0.12,0,TAU);ctx.fill();
    ctx.fillStyle='#252033';ctx.beginPath();ctx.moveTo(430,H-620);ctx.bezierCurveTo(480,H-760,650,H-760,700,H-600);ctx.bezierCurveTo(650,H-660,560,H-650,520,H-610);ctx.bezierCurveTo(490,H-580,460,H-560,430,H-620);ctx.fill();
    ctx.strokeStyle='#c98f78';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(660,H-560);ctx.lineTo(676,H-540);ctx.lineTo(660,H-530);ctx.stroke();
    ctx.strokeStyle='#3a2a2a';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(600,H-590);ctx.quadraticCurveTo(625,H-600,650,H-588);ctx.stroke();
    ctx.strokeStyle='#3a2a2a';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(605,H-576);ctx.quadraticCurveTo(628,H-584,648,H-574);ctx.stroke();
    ctx.fillStyle='rgba(230,120,120,0.35)';ctx.beginPath();ctx.ellipse(605,H-550,28,12,0,0,TAU);ctx.fill();
    ctx.strokeStyle='#25202c';ctx.lineWidth=16;ctx.beginPath();ctx.arc(540,H-610,180,Math.PI*1.05,Math.PI*1.95);ctx.stroke();
    ctx.fillStyle='#25202c';ctx.beginPath();ctx.ellipse(690,H-560,34,48,-0.2,0,TAU);ctx.fill();
    ctx.fillStyle='#4a3a52';ctx.beginPath();ctx.ellipse(690,H-560,20,30,-0.2,0,TAU);ctx.fill();
    var hp=0.55+0.15*Math.sin(tau*3);
    ctx.fillStyle='rgba(130,220,255,'+hp+')';ctx.beginPath();ctx.arc(690,H-560,8,0,TAU);ctx.fill();
    ctx.restore();
    for(var fp=0;fp<9;fp++){var fpx=(fp*230+u*180)%W, fpy=(H-100+Math.sin(tau+fp)*40+fp*30)%H;petal(fpx,fpy,14+(fp%3)*4,tau*0.5+fp,'#ffd1dc',0.7);}
    var vg=ctx.createRadialGradient(W*0.5,H*0.5,H*0.35,W*0.5,H*0.5,H*0.9);
    vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(10,8,18,0.35)');
    ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
  }
  var paused=false,raf=0,t0=0;
  function seek(t){draw(Number(t)||0);}
  function loop(now){if(!t0)t0=now;if(!paused)seek(((now-t0)/1000)%12);raf=requestAnimationFrame(loop);}
  window.__forge={duration:12,fps:30,seek:seek,pause:function(){paused=true;cancelAnimationFrame(raf);}};
  loop(0);
})();
</script></body></html>`;

interface MusicPlanTrack { name: string; style?: string; lyrics?: string; seconds?: number }

function readMusicPlan(c: ExecContext): MusicPlanTrack[] {
  const fallback: MusicPlanTrack[] = [
    { name: 'Café da Janela', style: 'mellow lo-fi, coffee shop, vinyl' },
    { name: 'Carros na Rua', style: 'chill lo-fi hip hop, night city' },
    { name: 'Pixel Latte', style: 'warm lo-fi, soft piano' },
  ];
  let list: MusicPlanTrack[] = [];
  try {
    const md = fs.readFileSync(path.join(c.projectDir, 'script.md'), 'utf8');
    const at = md.search(/MUSIC_PLAN/i);
    if (at >= 0) {
      const start = md.indexOf('[', at);
      let end = -1;
      if (start >= 0) {
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < md.length; i++) {
          const ch = md[i]!;
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
          }
          if (ch === '"') inStr = true;
          else if (ch === '[') depth++;
          else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
        }
      }
      if (start >= 0 && end > start) {
        const arr = JSON.parse(md.slice(start, end + 1));
        if (Array.isArray(arr)) {
          list = arr.map((x: Record<string, unknown>) => {
            const rawSeconds = Number(x.seconds ?? x.duration);
            return {
              name: String(x.name ?? x.title ?? '').trim(),
              style: String(x.style ?? '').trim(),
              lyrics: String(x.lyrics ?? x.lyric ?? '').trim() || undefined,
              seconds: Number.isFinite(rawSeconds) && rawSeconds > 0 ? rawSeconds : undefined,
            };
          }).filter((x) => x.name);
        }
      }
    }
  } catch { /* usa fallback */ }
  /* Compilado: o plano pode ter 10, 12 ou mais faixas. O limite real é o
     tempo total (padrão 6 min), aplicado depois em clipMusical(). */
  list = list.slice(0, 200);
  while (list.length < 2) list.push(fallback[list.length]!);
  return list;
}

/** Metadados do vídeo (fps e número de frames) para fechar o loop sem depender do container. */
async function probeVideoMeta(c: ExecContext, file: string): Promise<{ fps: number; frames: number }> {
  try {
    const { stdout } = await ff.run(c.settings.ffprobe, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate,nb_frames,duration', '-of', 'json', file], c.signal);
    const j = JSON.parse(stdout) as { streams?: Array<{ avg_frame_rate?: string; nb_frames?: string; duration?: string }> };
    const st = j.streams?.[0] ?? {};
    let fps = 24;
    const [num, den] = (st.avg_frame_rate ?? '').split('/').map(Number);
    if (num && den) fps = num / den;
    let frames = Number(st.nb_frames);
    if (!Number.isFinite(frames) || frames <= 0) {
      const d = Number(st.duration) || await ff.duration(c.settings.ffprobe, file);
      frames = Math.round(d * fps);
    }
    return { fps: fps > 0 ? fps : 24, frames: frames > 0 ? frames : 0 };
  } catch { return { fps: 24, frames: 0 }; }
}

/**
 * Clipe musical: imagem (Krea 2 / Z-Image) → vídeo MiniMax H3 com o MESMO frame
 * como primeiro e último (loop perfeito) → músicas no Yue 2 → loop exato +
 * nome da faixa + waveform.
 */
async function clipMusical(c: ExecContext, o: ExecutorOptions): Promise<ExecResult> {
  const outDir = c.outDir;
  const ffmpeg = c.settings.ffmpeg;
  const tracks = readMusicPlan(c);
  const clipParams = (c.step.params ?? {}) as Record<string, unknown>;
  const requestedLoop = clamp(Number(clipParams.loopSeconds ?? 12), 2, 15);
  /* Coletânea de N a M minutos (estimados pelo usuário no projeto). Cada faixa tem 60–300 s:
     nunca músicas de poucos segundos. Faixas do plano são repetidas como variações (outro seed)
     até alcançar o mínimo; o máximo nunca é ultrapassado. */
  const plan = compilationPlan(c.project);
  const minTotalSeconds = plan.minSec, maxTotalSeconds = plan.maxSec, targetTotal = plan.targetSec;
  const perTrack = clipParams.perTrackLoop === true || String(clipParams.loopMode ?? '') === 'per-track';
  const instrumental = c.project.musicMode !== 'song';
  const trackLen = (t: MusicPlanTrack) => { const s = Number(t.seconds); return Math.round(clamp(Number.isFinite(s) && s >= 60 ? s : plan.trackSec, 60, 300)); };
  c.log(`coletânea: ${Math.round(minTotalSeconds / 60)}–${Math.round(maxTotalSeconds / 60)} min (alvo ${Math.round(targetTotal / 60)} min), ~${plan.trackSec}s por faixa, ${tracks.length} faixa(s) no plano`);

  const server = c.settings.comfyServers.find((x) => x.id === 'local');
  if (!server) throw new Error('ComfyUI local nao configurado');
  const wfName = instrumental ? 'yue2-instrumental.json' : 'yue2-text2music.json';
  const wfPath = path.join(o.workflowsDir, wfName);
  if (!fs.existsSync(wfPath)) throw new Error(`workflow ${wfName} nao encontrado`);
  const sidePath = wfPath.replace(/\.json$/, '.map.json');
  const side = fs.existsSync(sidePath) ? JSON.parse(fs.readFileSync(sidePath, 'utf8')) as { outputNode?: string; mapping?: Record<string, string>; vars?: Record<string, string | number> } : {};
  const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
  const client = new ComfyClient(server);
  const ping = await client.ping();
  if (!ping.ok) throw new Error(`ComfyUI offline: ${ping.error}`);
  const seedBase = parseInt(crypto.createHash('md5').update(c.project.id).digest('hex').slice(0, 8), 16) % 2147483647;

  const scenes = c.project.scenes;
  const first = scenes[0];
  if (!first) throw new Error('clipe musical sem cena visual');
  const { w, h } = ff.resolution(c.project.aspect);
  const forceTemplate = clipParams.forceTemplate === true;
  const fallbackCache = new Map<string, string>();

  async function fallbackVisual(scene: Scene, template: string): Promise<string> {
    const key = `${template}:${scene.id}`;
    const cached = fallbackCache.get(key);
    if (cached) return cached;
    if (o.renderHtml) {
      const htmlTemplate = template === 'anime' ? FALLBACK_ANIME_HTML : template === '8bit' ? FALLBACK_8BIT_HTML : FALLBACK_16BIT_HTML;
      const html = path.join(outDir, `fallback-${template}-${scene.id}.html`);
      const clip = path.join(outDir, `fallback-${template}-${scene.id}.mp4`);
      fs.writeFileSync(html, htmlTemplate, 'utf8');
      await o.renderHtml(html, clip, { w, h, ffmpeg, duration: 12, fps: 30 });
      fallbackCache.set(key, clip);
      return clip;
    }
    const card = await fallbackCard(ffmpeg, scene, c.project.aspect, c.signal);
    fallbackCache.set(key, card);
    return card;
  }

  interface PreparedVisual { visual: string; isImage: boolean; loopPeriod: number; exactLoop: boolean }
  const visualCache = new Map<string, Promise<PreparedVisual>>();
  async function prepareVisual(scene: Scene): Promise<PreparedVisual> {
    const cached = visualCache.get(scene.id);
    if (cached) return cached;
    const run = (async () => {
      const sceneDir = path.join(c.projectDir, 'scenes', scene.id);
      let visual = forceTemplate ? undefined : sceneVisual(sceneDir, scene.kind);
      if (!visual) {
        const template = String(clipParams.template ?? '16bit');
        visual = await fallbackVisual(scene, template);
        c.log(forceTemplate
          ? `template ${template} forcado (cena de codigo reprovada/ignorada)`
          : `visual ausente na cena ${scene.id} - template ${template} renderizado`);
      }
      const isVideo = /\.(mp4|webm|mov|mkv|gif)$/i.test(visual);
      let loopPeriod = requestedLoop;
      let exactLoop = false;
      if (isVideo) {
        const loopMarker = path.join(sceneDir, 'clips', 'loop.json');
        const perfectLoop = clipParams.perfectLoop !== false && fs.existsSync(loopMarker);
        if (perfectLoop) {
          const meta = await probeVideoMeta(c, visual);
          if (meta.frames > 2) {
            const trimmed = path.join(outDir, `visual-perfect-${scene.id}.mp4`);
            await ff.run(ffmpeg, ['-y', '-i', visual, '-frames:v', String(meta.frames - 1), '-an',
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(meta.fps), trimmed], c.signal);
            visual = trimmed;
            const d = await ff.duration(c.settings.ffprobe, trimmed);
            loopPeriod = d > 0 ? d : (meta.frames - 1) / meta.fps;
            exactLoop = true;
            c.log(`loop perfeito: ${meta.frames - 1} quadros a ${meta.fps} fps = ${loopPeriod.toFixed(3)}s`);
          }
        }
        if (!exactLoop) {
          const loopFile = path.join(outDir, `visual-loop-${scene.id}.mp4`);
          await ff.run(ffmpeg, ['-y', '-stream_loop', '-1', '-i', visual, '-t', String(loopPeriod), '-an',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', loopFile], c.signal);
          visual = loopFile;
        }
      }
      return { visual, isImage: !isVideo, loopPeriod, exactLoop };
    })();
    visualCache.set(scene.id, run);
    return run;
  }

  const files: string[] = [];
  const trackNames: string[] = [];
  const visuals: Array<PreparedVisual & { seconds: number }> = [];
  let usedSeconds = 0;

  /* Gera uma faixa no YuE 2 (instrumental = workflow com LoRA instrumental, sem voz).
     Reaproveita a faixa já gerada com os mesmos parâmetros (retomar coletâneas longas). */
  async function generateTrack(i: number, t: MusicPlanTrack, seconds: number, seed: number): Promise<{ file: string; dur: number }> {
    const style = [c.project.musicStyle, t.style, instrumental ? 'instrumental, no vocals' : '', c.project.idea].filter(Boolean).join('; ').slice(0, 600);
    const lyrics = instrumental ? '[instrumental]' : (t.lyrics || '[instrumental]');
    const vars: Record<string, string | number> = { ...(side.vars ?? {}), style, lyrics, music_seconds: seconds, seed };
    const key = crypto.createHash('md5').update(JSON.stringify([wfName, vars])).digest('hex');
    const raw = path.join(outDir, `music-${i + 1}.mp3`), marker = raw + '.json';
    try {
      if (fs.existsSync(raw) && JSON.parse(fs.readFileSync(marker, 'utf8')).key === key) {
        const d = await ff.duration(c.settings.ffprobe, raw);
        if (d > 0) { c.log(`faixa ${i + 1} "${t.name}" já gerada (${d.toFixed(0)}s) — reaproveitada`); return { file: raw, dur: d }; }
      }
    } catch { /* gera de novo */ }
    c.log(`faixa ${i + 1}: "${t.name}" (${seconds}s; ${wfName}) - ${style.slice(0, 80)}`);
    const pid = await client.submit(applyVariables(wf, vars, side.mapping));
    const entry = await client.waitFor(pid, c.signal, (pct) => { if (pct % 20 === 0) c.log(`YuE 2 ${pct}%`); });
    const outs = collectOutputs(entry, side.outputNode);
    const audio = outs.find((f) => f.kind === 'audio') ?? outs[0];
    if (!audio) throw new Error(`YuE 2 não retornou áudio para "${t.name}"`);
    await client.download(audio, raw);
    fs.writeFileSync(marker, JSON.stringify({ key, name: t.name, seconds }));
    return { file: raw, dur: await ff.duration(c.settings.ffprobe, raw) };
  }

  const maxAttempts = Math.max(tracks.length, Math.ceil(maxTotalSeconds / 60)) * 2;
  for (let i = 0; i < maxAttempts && usedSeconds < targetTotal; i++) {
    const remaining = maxTotalSeconds - usedSeconds;
    if (remaining < 30) break;
    /* plano esgotado e ainda abaixo do alvo: repete as faixas como variações */
    const base = tracks[i % tracks.length]!;
    const round = Math.floor(i / tracks.length);
    const t: MusicPlanTrack = round ? { ...base, name: `${base.name} ${['', 'II', 'III', 'IV', 'V', 'VI'][round] ?? round + 1}`.trim() } : base;
    let want = Math.min(trackLen(t), remaining);
    /* última faixa: não deixa um resto curto demais no fim */
    if (remaining - want < 60 && remaining - want > 0 && usedSeconds + want >= minTotalSeconds) want = Math.min(300, remaining);
    let got = await generateTrack(i, t, want, (seedBase + i) % 2147483647);
    if (got.dur < Math.min(want * 0.6, 45)) {
      c.log(`faixa ${i + 1} saiu curta (${got.dur.toFixed(0)}s de ${want}s) — gerando de novo com outro seed`);
      got = await generateTrack(i, t, want, (seedBase + i + 7919) % 2147483647);
    }
    /* sem silêncio no fim: a faixa dura o que o YuE gerou (no máximo o pedido), com fade */
    const trackSeconds = Math.round(Math.min(got.dur, want) * 1000) / 1000;
    if (trackSeconds < 20) { c.log(`faixa ${i + 1} descartada (${trackSeconds.toFixed(0)}s)`); continue; }
    const scene = perTrack ? (scenes[i % scenes.length] ?? first) : first;
    const prep = await prepareVisual(scene);
    const exact = path.join(outDir, `music-${i + 1}.loop.mp3`);
    await ff.run(ffmpeg, ['-y', '-i', got.file, '-t', trackSeconds.toFixed(3), '-af', `afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, trackSeconds - 2.5).toFixed(2)}:d=2.5`,
      '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', exact], c.signal);
    files.push(exact);
    trackNames.push(t.name);
    visuals.push({ ...prep, seconds: trackSeconds });
    usedSeconds += trackSeconds;
    c.log(`coletânea: ${(usedSeconds / 60).toFixed(1)} de ${(targetTotal / 60).toFixed(1)} min`);
  }
  if (usedSeconds < minTotalSeconds) c.log(`aviso: a coletânea ficou com ${(usedSeconds / 60).toFixed(1)} min (mínimo pedido ${(minTotalSeconds / 60).toFixed(1)} min)`);
  if (server.freeAfter) await client.freeMemory();
  if (files.length === 0) throw new Error('nenhuma faixa gerada');

  const playlist = path.join(outDir, 'playlist.mp3');
  if (files.length === 1) fs.copyFileSync(files[0]!, playlist);
  else {
    const list = path.join(outDir, 'music-list.txt');
    fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    await ff.run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '192k', playlist], c.signal);
  }
  const total = visuals.reduce((sum, v) => sum + v.seconds, 0);
  /* lista de faixas com o início de cada uma (capítulos do YouTube na etapa de SEO) */
  { let at = 0; const mmss = (s: number) => `${s >= 3600 ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(s >= 3600 ? 2 : 1, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    fs.writeFileSync(path.join(outDir, 'tracklist.txt'), trackNames.map((n, i) => { const line = `${mmss(at)} ${n}`; at += visuals[i]!.seconds; return line; }).join('\n') + '\n', 'utf8'); }
  c.log(`playlist: ${files.length} faixas = ${total.toFixed(3)}s (${perTrack ? 'um loop por faixa' : 'mesmo loop para todas'})`);

  /* Cada faixa tem o seu segmento visual; o mesmo loop pode ser repetido. */
  const segments: string[] = [];
  for (let i = 0; i < visuals.length; i++) {
    const v = visuals[i]!;
    const seg = path.join(outDir, `visual-${i + 1}.mp4`);
    const input = v.isImage ? ['-loop', '1', '-framerate', '30', '-i', v.visual] : ['-stream_loop', '-1', '-i', v.visual];
    await ff.run(ffmpeg, ['-y', ...input, '-t', v.seconds.toFixed(3), '-an',
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,setsar=1',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', seg], c.signal);
    segments.push(seg);
  }
  const visualFull = path.join(outDir, 'visual-full.mp4');
  if (segments.length === 1) fs.copyFileSync(segments[0]!, visualFull);
  else await ff.concat(ffmpeg, segments, visualFull, c.signal);

  const ass = path.join(outDir, 'songs.ass');
  const assTime = (sec: number) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  };
  let start = 0;
  const events = trackNames.map((name, i) => {
    const end = start + visuals[i]!.seconds;
    const text = `♪ ${name}`.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N');
    const line = `Dialogue: 0,${assTime(start)},${assTime(end)},Song,,0,0,0,,{\\pos(70,70)}${text}`;
    start = end;
    return line;
  }).join('\n');
  fs.writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Song,Arial,54,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,2,0,7,70,70,70,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`, 'utf8');

  const final = primaryFile('edit', c);
  const waveform = c.project.waveform ?? 'line';
  const wfMode = waveform === 'bar' || waveform === 'p2p' ? 'p2p' : waveform === 'dot' ? 'point' : waveform === 'line' ? 'line' : 'cline';
  const wfHeight = waveform === 'bar' || waveform === 'p2p' ? 260 : waveform === 'dot' ? 180 : 220;
  const filter = `[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setpts=PTS-STARTPTS[base];` +
    `[1:a]showwaves=s=1800x${wfHeight}:mode=${wfMode}:scale=sqrt:rate=30:colors=0x00FFFF,format=rgb24,` +
    `colorlevels=rimax=0.45:gimax=0.45:bimax=0.45,colorkey=black:0.10:0.04[w];` +
    `[base][w]overlay=60:H-h-40,subtitles='${ff.filterPath(ass)}'[v]`;
  try {
    await ff.run(ffmpeg, ['-y', '-i', visualFull, '-i', playlist, '-filter_complex', filter, '-map', '[v]', '-map', '1:a',
      '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final], c.signal);
  } catch (e) {
    c.log(`waveform falhou (${(e as Error).message.slice(0, 120)}) - gerando sem waveform`);
    const base = `[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,subtitles='${ff.filterPath(ass)}'[v]`;
    await ff.run(ffmpeg, ['-y', '-i', visualFull, '-i', playlist, '-filter_complex', base, '-map', '[v]', '-map', '1:a',
      '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final], c.signal);
  }
  c.log(`clipe musical pronto: ${total.toFixed(2)}s em ${files.length} faixas (${perTrack ? 'um loop por faixa' : 'loop unico'}, ${wfName}), waveform ${waveform}, ${c.project.aspect}`);
  return { files: [final] };
}

/** Envia o vídeo final de um projeto ao YouTube pela conta Google das Automações e grava out/publish.json. */
export async function uploadProjectToYouTube(s: import('../shared/types').Settings, p: import('../shared/types').Project, projectDir: string, o: { account?: string; visibility?: 'UNLISTED' | 'PRIVATE' | 'PUBLIC'; log: (l: string) => void; signal?: AbortSignal }): Promise<{ file: string; url?: string }> {
  const outDir = path.join(projectDir, 'out');
  const video = path.join(outDir, 'final.mp4');
  if (!fs.existsSync(video)) throw new Error('o projeto ainda não tem o vídeo final (renderize antes de enviar)');
  const acc = flowAccount(s, o.account || s.automations?.youtubeAccount || undefined);
  const port = await ensureFlowBrowser(s, acc.id, o.log);
  const meta = uploadMeta(outDir, p.name);
  o.log(`YouTube: conta ${acc.label}${acc.email ? ` (${acc.email})` : ''} · ${o.visibility ?? 'UNLISTED'}`);
  const r = await youtubeUpload({ port, file: video, title: meta.title, description: meta.description, thumbnail: meta.thumbnail, tags: meta.tags, visibility: o.visibility ?? 'UNLISTED', log: o.log, signal: o.signal, debugDir: path.join(outDir, 'youtube-debug'), uploadUrl: s.automations && (s.automations as { youtubeUploadUrl?: string }).youtubeUploadUrl });
  /* publish.json guarda um registro por canal/plataforma (array); leitores antigos veem o último item */
  appendPublish(projectDir, { platform: 'youtube', channelId: p.channelId, account: acc.id, visibility: o.visibility ?? 'UNLISTED', title: meta.title, url: r.url ?? null, studioUrl: r.studioUrl, at: new Date().toISOString() });
  return { file: path.join(outDir, 'publish.json'), url: r.url };
}

const builtinExec = (o: ExecutorOptions): Executor => async (c) => {
  const tool = (c.binding as Extract<Binding, { type: 'builtin' }>).tool;
  if (tool === 'clip-musical') return clipMusical(c, o);
  const scenes = c.project.scenes;
  const dirOf = (s: Scene) => path.join(c.projectDir, 'scenes', s.id);
  if (tool === 'whisper' || tool === 'estimate-words') {
    if (!c.scene || !c.sceneDir) throw new Error('transcrição é por cena');
    const audio = sceneAudio(c.sceneDir);
    if (!audio) throw new Error('cena sem áudio de narração');
    const out = wordsPath(c.sceneDir);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (tool === 'whisper') {
      const script = path.join(o.toolsDir ?? path.resolve(__dirname, '../../tools'), 'whisper_words.py');
      let cfg = c.settings.whisper ?? { python: 'python', model: 'small', device: 'cpu' };
      const prompt = (c.scene.subtitle?.trim() || c.scene.narration || '').trim();
      let w;
      try {
        /* sem VAD e com o roteiro como prompt: o tempo é o do áudio e a grafia vem do texto */
        w = await transcribe(cfg, script, audio, out, c.project.language, c.signal, { prompt, noVad: true });
      } catch (e) {
        const msg = (e as Error).message;
        /* primeira execução sem faster-whisper: instala num venv isolado e tenta de novo */
        if (cfg.autoInstall === false || !/faster-whisper|No module|ModuleNotFound|não foi possível executar|ENOENT|python/i.test(msg)) throw e;
        c.log(`Whisper indisponível (${msg.slice(0, 140)}) → instalando faster-whisper…`);
        const inst = await ensureWhisper(c.settings, { log: c.log, signal: c.signal });
        cfg = { ...cfg, python: inst.python, device: 'cpu' };
        w = await transcribe(cfg, script, audio, out, c.project.language, c.signal, { prompt, noVad: true });
      }
      /* grava com a marca do áudio: se a narração mudar, o arquivo é inválido */
      const stamped = stampWords(w, audio, await ff.duration(c.settings.ffprobe, audio));
      fs.writeFileSync(out, JSON.stringify(stamped, null, 1));
      c.log(`whisper: ${w.words.length} palavras (sem VAD, roteiro como prompt)`);
    } else {
      const dur = await ff.duration(c.settings.ffprobe, audio);
      fs.writeFileSync(out, JSON.stringify(estimateWords(c.scene.narration, dur > 0 ? dur : c.scene.durationSec ?? 4), null, 1));
      c.log('tempos das palavras estimados (sem Whisper)');
    }
    return { files: [out] };
  }
  if (tool === 'subtitles') {
    /* legendas desligadas no projeto (padrão dos projetos novos): não gera .srt; o lyric video sempre tem a letra */
    if (c.project.subtitles === 'off' && !isLyricVideo(c.project)) {
      fs.rmSync(primaryFile('subtitles', c), { force: true });
      c.log('legendas desligadas neste projeto (ligue no editor, cartão "Legendas", e use "Renderizar final")');
      return { files: [] };
    }
    /* UM RELÓGIO SÓ: a duração de cada cena vem da timeline (a mesma que a montagem usa) */
    const timeline = await ensureTimeline(c.settings, c.projectDir, c.project);
    const pairs = timeline.scenes
      .map((ts) => ({ ts, scene: scenes.find((s) => s.id === ts.id) }))
      .filter((x): x is { ts: typeof timeline.scenes[number]; scene: Scene } => !!x.scene);
    const items: Array<{ scene: Scene; seconds: number; words?: ff.SubWord[] }> = [];
    if (isLyricVideo(c.project)) {
      for (const { ts, scene } of pairs) items.push({ scene, seconds: ts.seconds });
      const file = primaryFile('subtitles', c);
      ff.writeSrt(file, items);
      return { files: [file] };
    }
    /* WHISPER NO STEM FINAL: transcreve a narração concatenada (a mesma que entra no vídeo)
       uma vez, sem VAD e com o roteiro como prompt, e recorta as palavras por cena pela timeline.
       O stem também é o áudio do QA de sincronia. */
    const byScene = new Map<string, ff.SubWord[]>();
    let stem: string | undefined;
    let segs: Segment[] = [];
    if (pairs.some(({ ts }) => ts.audio)) {
      try {
        stem = await buildNarrationStem(c.settings, c.projectDir, c.project, timeline, c.signal);
        segs = await speechSegments(c.settings.ffmpeg, stem, c.signal);
      } catch (e) {
        if (c.signal.aborted) throw e;
        c.log(`aviso: stem de narração indisponível (${(e as Error).message.slice(0, 140)})`);
      }
    }
    const cfg = c.settings.whisper;
    const fresh = pairs.length > 0 && pairs.every(({ ts, scene }) => {
      const dir = dirOf(scene);
      return wordsFresh(readWords(wordsPath(dir)), sceneAudio(dir), ts.seconds);
    });
    if (cfg && stem && pairs.length && !fresh) {
      try {
        const script = path.join(o.toolsDir ?? path.resolve(__dirname, '../../tools'), 'whisper_words.py');
        const prompt = pairs.map(({ scene }) => (scene.subtitle?.trim() || scene.narration || '').trim()).filter(Boolean).join('\n');
        const outFile = path.join(c.outDir, 'narration.stem.words.json');
        let useCfg = cfg;
        let w;
        try {
          w = await transcribe(useCfg, script, stem, outFile, c.project.language, c.signal, { prompt, noVad: true });
        } catch (e) {
          const msg = (e as Error).message;
          if (useCfg.autoInstall === false || !/faster-whisper|No module|ModuleNotFound|não foi possível executar|ENOENT|python/i.test(msg)) throw e;
          c.log(`Whisper indisponível (${msg.slice(0, 140)}) → instalando faster-whisper…`);
          const inst = await ensureWhisper(c.settings, { log: c.log, signal: c.signal });
          useCfg = { ...useCfg, python: inst.python, device: 'cpu' };
          w = await transcribe(useCfg, script, stem, outFile, c.project.language, c.signal, { prompt, noVad: true });
        }
        for (const { ts, scene } of pairs) {
          const dir = dirOf(scene);
          /* recorta pela timeline e ancora o início/fim da cena na fala real do stem */
          const cut = snapSceneWords(cutWords(w.words, ts.start, ts.start + ts.seconds), segs, ts.start, ts.seconds);
          byScene.set(ts.id, cut);
          const target = wordsPath(dir);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const data = stampWords({
            language: w.language, text: (scene.subtitle?.trim() || scene.narration || '').trim(),
            words: cut, source: 'align', sceneStart: ts.start,
          }, sceneAudio(dir), ts.seconds);
          fs.writeFileSync(target, JSON.stringify(data, null, 1));
        }
        c.log(`whisper no stem final: ${w.words.length} palavras (sem VAD, roteiro como prompt) · recortadas em ${pairs.length} cena(s) pela timeline`);
      } catch (e) {
        if (c.signal.aborted) throw e;
        c.log(`aviso: whisper no stem falhou (${(e as Error).message.slice(0, 160)}) — usando as palavras por cena`);
      }
    }
    for (const { ts, scene } of pairs) items.push({ scene, seconds: ts.seconds, words: byScene.get(ts.id) ?? readWords(wordsPath(dirOf(scene)))?.words });
    const file = primaryFile('subtitles', c);
    /* tempos reais das palavras (Whisper) quando houver; .ass com o tipo e a posição escolhidos no editor */
    const words = ff.subtitleWords(items);
    const st = c.project.subtitleStyle ?? { burn: false, position: 'bottom' as const, size: 46, color: '#ffffff', box: true };
    const size = ff.resolution(c.project.aspect ?? '16:9');
    ff.writeSrtFromWords(file, words, size.h > size.w ? 4 : 6);
    const ass = file.replace(/\.srt$/i, '.ass');
    fs.writeFileSync(ass, ff.buildAss(words, st, size));
    c.log(`legendas: ${words.length} palavras · tipo ${ff.subtitleKind(st)} · ${st.position === 'top' ? 'em cima' : st.position === 'middle' ? 'no meio' : 'embaixo'}`);
    /* QA DE SINCRONIA: mede o início de cada cue no stem de narração (o áudio que vai ao ar) */
    if (stem && words.length) {
      try {
        const qa = await checkSync(c.settings.ffmpeg, stem, words, timeline, c.outDir, c.signal, segs);
        c.log(syncQaLine(qa));
        if (!qa.ok && c.step.params.qaStrict === true) throw new Error(`QA de sincronia reprovado (limite ${qa.limit} s): ${syncQaLine(qa)}`);
      } catch (e) {
        if (c.signal.aborted || (e as Error).message.startsWith('QA de sincronia')) throw e;
        c.log(`aviso: QA de sincronia não medido (${(e as Error).message.slice(0, 140)})`);
      }
    }
    return { files: [file, ass] };
  }
  if (tool === 'library-music') {
    const dir = path.join(c.settings.workspace, 'library', 'music');
    const list = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f)).sort() : [];
    if (list.length === 0) { c.log('biblioteca de músicas vazia (coloque arquivos em library/music)'); return { files: [] }; }
    const wanted = String((c.step.params as Record<string, unknown> | undefined)?.file ?? '').trim();
    const byName = wanted ? (list.find((f) => f === wanted) ?? list.find((f) => f.toLowerCase().includes(wanted.toLowerCase()))) : undefined;
    const pick = byName ?? list[parseInt(crypto.createHash('md5').update(c.project.id).digest('hex').slice(0, 6), 16) % list.length]!;
    const dest = path.join(c.outDir, 'music' + path.extname(pick));
    fs.copyFileSync(path.join(dir, pick), dest);
    return { files: [dest] };
  }
  if (tool === 'silence-trim') {
    const files: string[] = [];
    for (const s of scenes) { const a = sceneAudio(dirOf(s)); if (a) files.push(await trimNarration(c, a)); }
    return { files };
  }
  if (tool === 'assemble') {
    const params = (c.step.params ?? {}) as Record<string, unknown>;
    /* a montagem lê a MESMA timeline que as legendas, os capítulos e a thumb */
    const timeline = await ensureTimeline(c.settings, c.projectDir, c.project);
    const segDir = path.join(c.outDir, 'segments');
    try { fs.rmSync(segDir, { recursive: true, force: true }); } catch { /* arquivos imutáveis: sobrescreve com -y */ }
    fs.mkdirSync(segDir, { recursive: true });
    const segs: Array<{ file: string; seconds: number; transition?: SceneEffects['transition']; transitionSec?: number }> = [];
    for (const s of scenes) {
      const dir = dirOf(s);
      /* a montagem usa os QUADROS da timeline: o arquivo fecha na mesma duração que a legenda lê */
      const ts = timeline.scenes.find((x) => x.id === s.id);
      const seconds = ts?.seconds ?? await sceneSeconds(c, s, dir);
      const frames = ts?.frames ?? Math.max(1, Math.round(seconds * PROJECT_FPS));
      let visual = sceneVisual(dir, s.kind);
      if (!visual) {
        visual = await fallbackCard(c.settings.ffmpeg, s, c.project.aspect, c.signal);
        c.log(`cena ${s.index} (${s.kind}) sem visual — usando cartão com o título`);
      }
      let loop: boolean | undefined;
      if (visual && /\.(mp4|webm|mov|mkv|gif)$/i.test(visual)) {
        const vd = await ff.duration(c.settings.ffprobe, visual);
        /* só repete se o clipe for realmente mais curto que a cena (evita loop de 1 frame) */
        loop = !(vd > 0 && vd - (s.trimStart ?? 0) + 0.05 >= seconds);
      }
      const out = path.join(segDir, `${String(s.index).padStart(3, '0')}.mp4`);
      const sfxFile = path.join(dir, 'audio', 'sfx.wav');
      const sfxOk = sfx.validWav(sfxFile);
      if (!sfxOk && fs.existsSync(sfxFile)) c.log(`aviso: ${s.id}/audio/sfx.wav inválido (vazio ou corrompido) — cena montada sem efeitos sonoros; refaça "Efeitos sonoros" nesta cena para recuperá-los`);
      const effects = autoMotion(s, params);
      await ff.makeSegment(c.settings.ffmpeg, { visual, audio: sceneAudio(dir), seconds, frames, fps: PROJECT_FPS, effects, loop, sfx: sfxOk ? sfxFile : undefined, sfxVolume: c.project.sfxVolume ?? SFX_DEFAULT_VOLUME, trimStart: s.trimStart, narrationVolume: c.project.narrationVolume }, out, c.project.aspect, c.signal);
      segs.push({ file: out, seconds, transition: effects?.transition, transitionSec: effects?.transitionSec });
      c.log(`segmento ${s.index}/${scenes.length} ok`);
    }
    if (segs.length === 0) throw new Error('nenhuma cena para montar');
    const final = primaryFile('edit', c);
    const raw = path.join(c.outDir, 'raw.mp4');
    const nTr = segs.slice(0, -1).filter((x) => x.transition && x.transition !== 'none').length;
    await ff.concatWithTransitions(c.settings.ffmpeg, segs, raw, c.signal);
    if (nTr) c.log(`${nTr} transição(ões) aplicada(s) entre cenas`);
    /* acabamento do vídeo inteiro (filtro, vinheta, grão, letterbox) */
    const fin = [...ff.segmentFilters(c.project.fxSegments, segs.reduce((a, x) => a + x.seconds, 0)), ...ff.finalFilters(c.project.finalEffects)];
    if (fin.length) {
      const graded = path.join(c.outDir, 'raw.graded.mp4');
      await ff.run(c.settings.ffmpeg, ['-y', '-i', raw, '-vf', [...fin, 'format=yuv420p'].join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', graded], c.signal);
      try { fs.renameSync(graded, raw); } catch { fs.copyFileSync(graded, raw); fs.rmSync(graded, { force: true }); }
      c.log(`acabamento do vídeo final: ${fin.length} filtro(s)`);
    }
    const music = fs.readdirSync(c.outDir).find((f) => f.startsWith('music.'));
    /* volume da trilha: o do editor (projeto) vence o da rota; 0 = mudo */
    const musicVol = c.project.musicVolume ?? Number(params.musicVolume ?? 0.15);
    if (music && musicVol > 0) await ff.mixMusic(c.settings.ffmpeg, raw, path.join(c.outDir, music), final, c.signal, musicVol);
    else { if (music) c.log('trilha sonora no mudo'); fs.copyFileSync(raw, final); }
    const srt = primaryFile('subtitles', c);
    if (c.project.subtitleStyle?.burn && c.project.subtitles !== 'off' && c.project.subtitles !== 'srt' && fs.existsSync(srt)) {
      const tmp = path.join(c.outDir, 'final.subs.mp4'), ass = srt.replace(/\.srt$/i, '.ass');
      if (fs.existsSync(ass)) await ff.burnAss(c.settings.ffmpeg, final, ass, tmp, c.signal);
      else await ff.burnSubtitles(c.settings.ffmpeg, final, srt, c.project.subtitleStyle, tmp, c.signal);
      try { fs.renameSync(tmp, final); }
      catch { fs.copyFileSync(tmp, final); fs.rmSync(tmp, { force: true }); }
      c.log('legendas gravadas no vídeo');
    }
    /* marca d'água opcional (por cima de tudo, inclusive das legendas) */
    if (c.project.watermark?.enabled) {
      const tmp = path.join(c.outDir, 'final.wm.mp4');
      try {
        if (await ff.applyWatermark(c.settings.ffmpeg, final, c.project.watermark, tmp, ff.resolution(c.project.aspect).w, c.signal)) {
          try { fs.renameSync(tmp, final); } catch { fs.copyFileSync(tmp, final); fs.rmSync(tmp, { force: true }); }
          c.log(`marca d'água aplicada (${c.project.watermark.text ? `"${c.project.watermark.text}"` : 'imagem'}, ${c.project.watermark.position})`);
        }
      } catch (e) { if (c.signal.aborted) throw e; c.log(`⚠ marca d'água ignorada: ${(e as Error).message.slice(0, 200)}`); }
    }
    /* Masterização YouTube: -14 LUFS, true peak -1 dB. */
    try {
      const norm = path.join(c.outDir, 'final.norm.mp4');
      await ff.run(c.settings.ffmpeg, ['-y', '-i', final, '-c:v', 'copy', '-af', `loudnorm=I=-14:TP=-1:LRA=11,aresample=48000,atrim=duration=${timeline.total.toFixed(6)}`, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', norm], c.signal);
      try { fs.renameSync(norm, final); }
      catch { fs.copyFileSync(norm, final); fs.rmSync(norm, { force: true }); }
      c.log('áudio masterizado para -14 LUFS (YouTube)');
    } catch (e) {
      c.log(`masterização de áudio ignorada: ${(e as Error).message.slice(0, 120)}`);
    }
    /* pós-processamento do Wan2GP (opcional): upscale (FlashVSR/SeedVR2/Lanczos) e fluidez (RIFE, dobra o fps) */
    const post = { spatial: c.project.wan2gpPost?.spatial ?? (typeof params.wan2gpUpscale === 'string' ? params.wan2gpUpscale : ''), temporal: c.project.wan2gpPost?.temporal ?? (typeof params.wan2gpSmooth === 'string' ? params.wan2gpSmooth : '') };
    if (post.spatial || post.temporal) {
      if (!c.settings.wan2gp?.root) c.log('⚠ pós-processamento do Wan2GP ignorado: configure a pasta do Wan2GP em Configurações');
      else {
        try {
          c.log(`Wan2GP: pós-processando o vídeo final (${[post.spatial && `upscale ${post.spatial}`, post.temporal && `fluidez ${post.temporal}`].filter(Boolean).join(' + ')}) — pode demorar`);
          const client = Wan2gpClient.get(c.settings.wan2gp, path.join(o.toolsDir ?? path.resolve(__dirname, '../../tools'), 'wan2gp_bridge.py'));
          const pp = await client.postprocess(final, post, c.signal, c.log);
          /* o áudio masterizado vem do final.mp4 (o pós-processamento cuida só da imagem) */
          const tmp = path.join(c.outDir, 'final.post.mp4');
          await ff.run(c.settings.ffmpeg, ['-y', '-i', pp, '-i', final, '-map', '0:v:0', '-map', '1:a:0?', '-c', 'copy', '-movflags', '+faststart', tmp], c.signal);
          try { fs.renameSync(tmp, final); } catch { fs.copyFileSync(tmp, final); fs.rmSync(tmp, { force: true }); }
          c.log(`Wan2GP: vídeo final pós-processado (${path.basename(pp)})`);
        } catch (e) { if (c.signal.aborted) throw e; c.log(`⚠ pós-processamento do Wan2GP ignorado: ${(e as Error).message.slice(0, 200)}`); }
      }
    }
    /* QA DE A/V: o teste que fecha o loop — mede o arquivo que vai ao ar, não a conta */
    try {
      let qa = await checkAv(c.settings.ffprobe, final, c.outDir, c.signal);
      if (!qa.ok) {
        c.log(avQaLine(qa));
        /* áudio fora da duração do vídeo: conserta só o áudio (preenche ou corta) e mede de novo */
        if (await conformAv(c.settings.ffmpeg, final, qa.video, c.signal)) {
          qa = await checkAv(c.settings.ffprobe, final, c.outDir, c.signal);
          c.log('A/V corrigido: áudio reescrito para a duração do vídeo');
        }
      }
      c.log(avQaLine(qa));
      if (!qa.ok && c.step.params.qaStrict === true) throw new Error(`QA de A/V reprovado: ${avQaLine(qa)}`);
    } catch (e) {
      if (c.signal.aborted || (e as Error).message.startsWith('QA de A/V')) throw e;
      c.log(`aviso: QA de A/V não medido (${(e as Error).message.slice(0, 140)})`);
    }
    return { files: [final] };
  }
  if (tool === 'lyric-song') return lyricSong(c, o);
  if (tool === 'lyric-words') return lyricWords(c);
  if (tool === 'frame-thumbnail') return frameThumbnail(c);
  if (tool === 'wan2gp-showrunner') {
    /* o Showrunner do Wan2GP produz o vídeo inteiro (plano, elenco, tomadas, revisão e montagem) e o FilmForge traz o final */
    if (!c.settings.wan2gp?.root) throw new Error('Showrunner: configure a pasta do Wan2GP em Configurações → Wan2GP');
    const params = (c.step.params ?? {}) as Record<string, unknown>;
    Wan2gpClient.shutdownAll();   // a ponte local solta a GPU: o servidor do Wan2GP vai usá-la
    const r = await runShowrunner({ cfg: c.settings.wan2gp, project: c.project, kind: showrunnerKind(c.project, params.kind), dest: primaryFile('edit', c),
      stateFile: path.join(c.outDir, 'showrunner.json'), log: c.log, signal: c.signal, maxHours: Number(params.maxHours) || 8,
      mode: params.mode === 'app' ? 'app' : 'director', director: typeof params.director === 'string' && params.director ? params.director : c.settings.wan2gp.director,
      narratorVoice: typeof params.narratorVoice === 'string' ? params.narratorVoice : undefined });
    const final = primaryFile('edit', c);
    /* mp4 com faststart (o export do Showrunner pode vir em outro contêiner) */
    await ff.run(c.settings.ffmpeg, ['-y', '-i', r.file, '-map', '0:v:0', '-map', '0:a?', '-c:v', /\.mp4$/i.test(r.file) ? 'copy' : 'libx264', '-c:a', 'aac', '-movflags', '+faststart', final], c.signal);
    fs.rmSync(r.file, { force: true });
    c.log(`Showrunner: vídeo final em out/final.mp4 (produção ${r.production})`);
    return { files: [final] };
  }
  if (tool === 'youtube-upload') {
    /* publicação automática: envia out/final.mp4 com título/descrição/thumbnail do SEO (padrão: não listado) */
    const params = (c.step.params ?? {}) as Record<string, unknown>;
    const r = await uploadProjectToYouTube(c.settings, c.project, c.projectDir, { account: typeof params.account === 'string' ? params.account : undefined, visibility: (params.visibility as 'UNLISTED' | 'PRIVATE' | 'PUBLIC' | undefined) ?? 'UNLISTED', log: c.log, signal: c.signal });
    return { files: [r.file] };
  }
  if (tool === 'music-code') {
    /* trilha programática com a duração exata do vídeo (soma das cenas) */
    const params = (c.step.params ?? {}) as Record<string, unknown>;
    let total = 0;
    for (const s of scenes) total += await sceneSeconds(c, s, dirOf(s));
    if (total <= 0) total = c.project.targetDurationSec || 60;
    for (const f of fs.existsSync(c.outDir) ? fs.readdirSync(c.outDir).filter((x) => /^music\.(mp3|wav|m4a|ogg)$/i.test(x)) : []) fs.rmSync(path.join(c.outDir, f), { force: true });
    const engine = (['auto', 'mgaudio', 'interno'] as const).find((x) => x === params.engine) ?? 'auto';
    const r = await renderCodeMusic(c.settings, { mood: moodFor(c.project, params), duration: Math.round((total + 0.5) * 100) / 100, out: primaryFile('music', c), engine, signal: c.signal, log: c.log });
    c.log(`trilha programática pronta (${r.engine}, ${r.mood})`);
    return { files: [r.file] };
  }
  if (tool === 'sfx-code') {
    if (!c.scene || !c.sceneDir) throw new Error('efeitos sonoros são por cena');
    const params = (c.step.params ?? {}) as Record<string, unknown>;
    let cues = sfx.sceneCues(c.scene, c.sceneDir);
    if (!cues.length && params.auto !== false) cues = sfx.autoCues(c.scene);
    const out = primaryFile('sfx', c);
    if (!cues.length) { try { fs.rmSync(out, { force: true }); } catch { /* ok */ } c.log('cena sem efeitos sonoros'); return { files: [] }; }
    const seconds = await sceneSeconds(c, c.scene, c.sceneDir);
    let words: WordTime[] = [];
    try { words = (JSON.parse(fs.readFileSync(wordsPath(c.sceneDir), 'utf8')) as { words?: WordTime[] }).words ?? []; } catch { /* sem transcrição: usa os instantes/espalha */ }
    const times = sfx.cueTimes(cues, seconds, words);
    await sfx.buildSceneSfx(c.settings.ffmpeg, cues, times, seconds, out, path.join(c.sceneDir, 'audio', 'sfx-parts'), c.signal);
    c.log(`efeitos sonoros: ${cues.map((x, i) => `${x.name}@${times[i]!.toFixed(1)}s`).join(', ')}`);
    return { files: [out] };
  }
  throw new Error(`ferramenta builtin desconhecida: ${tool}`);
};

/* ───────── lyric video ───────── */

interface LyricLine { text: string; start: number; end: number }
interface LyricBlock { label: string; start: number; end: number; lines: LyricLine[] }
interface LyricTiming { title: string; duration: number; source: string; blocks: LyricBlock[] }

/** Lê TITLE / STYLE / LYRICS do script.md do lyric video (formato pedido pela skill). */
export function parseLyricScript(md: string): { title: string; style: string; blocks: Array<{ label: string; lines: string[] }>; raw: string } {
  const title = /^\s*TITLE\s*:\s*(.+)$/im.exec(md)?.[1]?.trim() ?? '';
  const style = /^\s*STYLE\s*:\s*(.+)$/im.exec(md)?.[1]?.trim() ?? '';
  const at = md.search(/^\s*LYRICS\s*:/im);
  let body = at >= 0 ? md.slice(at).replace(/^\s*LYRICS\s*:\s*/i, '') : md;
  const stop = body.search(/^\s*(VISUAL|STYLE|TITLE)\s*:/im);
  if (stop >= 0) body = body.slice(0, stop);
  const blocks: Array<{ label: string; lines: string[] }> = [];
  let cur: { label: string; lines: string[] } | undefined;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').trim();
    const tag = /^\[([^\]]+)\]$/.exec(line);
    if (!line) { if (cur?.lines.length) cur = undefined; continue; }
    if (tag) { cur = { label: tag[1]!.trim(), lines: [] }; blocks.push(cur); continue; }
    if (!cur) { cur = { label: blocks.length ? 'verse' : 'intro', lines: [] }; blocks.push(cur); }
    cur.lines.push(line);
  }
  const clean = blocks.filter((b) => b.lines.length);
  const raw = clean.map((b) => `[${b.label}]\n${b.lines.join('\n')}`).join('\n\n');
  return { title, style, blocks: clean, raw };
}

/** Distribui os versos pelo tempo da canção: tempos do Whisper (proporcionais às palavras) ou estimativa. */
export function timeLyrics(blocks: Array<{ label: string; lines: string[] }>, duration: number, words?: WordTime[]): LyricBlock[] {
  const lines = blocks.flatMap((b, bi) => b.lines.map((text) => ({ bi, text, n: Math.max(1, text.split(/\s+/).filter(Boolean).length) })));
  const total = lines.reduce((a, l) => a + l.n, 0) || 1;
  const intro = Math.min(8, duration * 0.08), outro = duration * 0.96;
  let acc = 0;
  const starts = lines.map((l) => {
    const frac = acc / total; acc += l.n;
    if (words && words.length > lines.length) return words[Math.min(words.length - 1, Math.floor(frac * words.length))]!.start;
    return intro + frac * (outro - intro);
  });
  const timed: Array<LyricLine & { bi: number }> = lines.map((l, i) => ({ bi: l.bi, text: l.text, start: +starts[i]!.toFixed(2), end: +(i + 1 < lines.length ? starts[i + 1]! : Math.min(duration, outro + 2)).toFixed(2) }));
  return blocks.map((b, bi) => {
    const ls = timed.filter((t) => t.bi === bi).map(({ text, start, end }) => ({ text, start, end }));
    return { label: b.label, start: ls[0]?.start ?? 0, end: ls[ls.length - 1]?.end ?? 0, lines: ls };
  }).filter((b) => b.lines.length);
}

async function lyricSong(c: ExecContext, o: ExecutorOptions): Promise<ExecResult> {
  const md = fs.readFileSync(path.join(c.projectDir, 'script.md'), 'utf8');
  const parsed = parseLyricScript(md);
  if (!parsed.blocks.length) throw new Error('script.md sem letra (seção LYRICS:)');
  const seconds = clamp(Math.round(c.project.targetDurationSec || 120), 30, 360);
  const server = c.settings.comfyServers.find((x) => x.id === 'local') ?? c.settings.comfyServers[0];
  if (!server) throw new Error('ComfyUI não configurado (a canção é gerada no Yue 2)');
  const wfName = String((c.step.params as Record<string, unknown>)['workflow'] ?? 'yue2-text2music.json');
  const wfPath = path.join(o.workflowsDir, wfName);
  if (!fs.existsSync(wfPath)) throw new Error(`workflow ${wfName} não encontrado`);
  const sidePath = wfPath.replace(/\.json$/, '.map.json');
  const side = fs.existsSync(sidePath) ? JSON.parse(fs.readFileSync(sidePath, 'utf8')) as { outputNode?: string; mapping?: Record<string, string>; vars?: Record<string, string | number> } : {};
  const client = new ComfyClient(server);
  const ping = await client.ping();
  if (!ping.ok) throw new Error(`ComfyUI offline: ${ping.error}`);
  const style = [parsed.style, c.project.musicStyle, 'clear lead vocals, catchy chorus'].filter(Boolean).join('; ').slice(0, 600);
  const seed = parseInt(crypto.createHash('md5').update(c.project.id).digest('hex').slice(0, 8), 16) % 2147483647;
  c.log(`canção "${parsed.title || c.project.name}": ${parsed.blocks.length} bloco(s), ${seconds}s, ${wfName} — ${style.slice(0, 80)}`);
  const graph = applyVariables(JSON.parse(fs.readFileSync(wfPath, 'utf8')), { ...(side.vars ?? {}), style, lyrics: parsed.raw, music_seconds: seconds, seed: (seed + (c.scene?.variation ?? 0)) % 2147483647 }, side.mapping);
  const pid = await client.submit(graph);
  const entry = await client.waitFor(pid, c.signal, (pct) => { if (pct % 10 === 0) c.log(`Yue 2 ${pct}%`); });
  const audio = collectOutputs(entry, side.outputNode).find((f) => f.kind === 'audio');
  if (!audio) throw new Error('Yue 2 não retornou áudio');
  const raw = path.join(c.outDir, 'song.raw' + (path.extname(audio.filename) || '.mp3'));
  await client.download(audio, raw);
  const song = primaryFile('music', c);          // out/music.mp3 → a montagem usa como trilha (volume cheio)
  await ff.run(c.settings.ffmpeg, ['-y', '-i', raw, '-af', 'apad', '-t', String(seconds), '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', song], c.signal);
  if (server.freeAfter) await client.freeMemory();
  const duration = (await ff.duration(c.settings.ffprobe, song)) || seconds;

  // tempos dos versos: Whisper na canção (com voz) ou estimativa proporcional
  let words: WordTime[] | undefined, source = 'estimate';
  try {
    const script = path.join(o.toolsDir ?? path.resolve(__dirname, '../../tools'), 'whisper_words.py');
    const w = await transcribe(c.settings.whisper ?? { python: 'python', model: 'small', device: 'cpu' }, script, song, path.join(c.outDir, 'song-words.json'), c.project.language, c.signal);
    if (w.words.length) { words = w.words; source = 'whisper'; }
  } catch (e) { c.log(`whisper na canção indisponível (${(e as Error).message.slice(0, 100)}) — tempos estimados`); }
  const timing: LyricTiming = { title: parsed.title || c.project.name, duration: +duration.toFixed(2), source, blocks: timeLyrics(parsed.blocks, duration, words) };
  const tf = path.join(c.outDir, 'lyrics-timing.json');
  fs.writeFileSync(tf, JSON.stringify(timing, null, 1));
  c.log(`tempos da letra (${source}): ${timing.blocks.map((b) => `${b.label} ${b.start}–${b.end}s`).join(' · ')}`);
  return { files: [song, tf] };
}

/** Tempos da letra de cada cena (audio/words.json relativo ao início da cena) e duração exata da cena. */
async function lyricWords(c: ExecContext): Promise<ExecResult> {
  if (!c.scene || !c.sceneDir) throw new Error('tempos da letra são por cena');
  const timing = JSON.parse(fs.readFileSync(path.join(c.outDir, 'lyrics-timing.json'), 'utf8')) as LyricTiming;
  const lines = timing.blocks.flatMap((b) => b.lines);
  const scenes = c.project.scenes;
  // quantos versos cada cena cobre: 1 cena por bloco quando os números batem; senão pelos versos da narração
  const counts = scenes.length === timing.blocks.length
    ? timing.blocks.map((b) => b.lines.length)
    : scenes.map((s) => Math.max(1, s.narration.split(/\s*\/\s*|\r?\n/).filter((x) => x.trim()).length));
  let li = 0;
  const spans = scenes.map((s, i) => {
    const take = i === scenes.length - 1 ? Math.max(0, lines.length - li) : Math.min(counts[i]!, Math.max(0, lines.length - li - (scenes.length - 1 - i)));
    const mine = lines.slice(li, li + take); li += take;
    return { s, mine };
  });
  const startOf = (i: number) => (i === 0 ? 0 : spans[i]!.mine[0]?.start ?? spans[i - 1]!.mine[spans[i - 1]!.mine.length - 1]?.end ?? 0);
  const idx = scenes.findIndex((x) => x.id === c.scene!.id);
  const start = startOf(idx);
  const end = idx + 1 < scenes.length ? startOf(idx + 1) : timing.duration;
  const dur = Math.max(0.5, +(end - start).toFixed(2));
  c.scene.durationSec = dur; c.scene.manualDuration = true;
  const ws: WordTime[] = [];
  for (const l of spans[idx]!.mine) {
    const est = estimateWords(l.text, Math.max(0.2, l.end - l.start));
    for (const w of est.words) ws.push({ w: w.w, start: +(l.start - start + w.start).toFixed(3), end: +(l.start - start + w.end).toFixed(3) });
  }
  const out = wordsPath(c.sceneDir);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ text: spans[idx]!.mine.map((l) => l.text).join(' / '), words: ws, source: `lyrics:${timing.source}` }, null, 1));
  c.log(`cena ${c.scene.id}: ${spans[idx]!.mine.length} verso(s), ${start.toFixed(2)}–${end.toFixed(2)}s (${dur}s)`);
  return { files: [out] };
}

/** Thumbnail a partir de um quadro real do vídeo final + texto curto do SEO (reserva sem modelo de imagem). */
async function frameThumbnail(c: ExecContext): Promise<ExecResult> {
  const final = primaryFile('edit', c);
  if (!fs.existsSync(final)) throw new Error('final.mp4 ainda não existe');
  const total = await ff.duration(c.settings.ffprobe, final);
  // quadro do meio da cena visual mais longa (vídeo/imagem) — nos tempos da timeline, senão 35% do vídeo
  const timeline = await ensureTimeline(c.settings, c.projectDir, c.project);
  let t = total * 0.35, best = -1;
  for (const ts of timeline.scenes) {
    const s = c.project.scenes.find((x) => x.id === ts.id);
    if (!s) continue;
    if ((s.kind === 'video' || s.kind === 'image' || s.kind === 'stock') && ts.seconds > best) { best = ts.seconds; t = ts.start + ts.seconds / 2; }
  }
  t = clamp(t, 0, Math.max(0, total - 0.1));
  let text = c.project.name.split(/\s+/).slice(0, 3).join(' ').toUpperCase();
  try { const m = JSON.parse(fs.readFileSync(path.join(c.outDir, 'metadata.json'), 'utf8')) as { thumbnailText?: string }; if (m.thumbnailText) text = m.thumbnailText; } catch { /* sem SEO */ }
  const { w, h } = ff.resolution(c.project.aspect);
  const dest = primaryFile('thumbnail', c);
  ensureDir(dest);
  const txt = path.join(c.outDir, 'thumb-text.txt');
  fs.writeFileSync(txt, text, 'utf8');
  const tf = txt.replace(/\\/g, '/').replace(/:/g, '\\:');
  const font = process.platform === 'win32' ? `fontfile='C\\:/Windows/Fonts/arialbd.ttf':` : '';
  const size = Math.round(Math.min(w, h) / 8);
  const scale = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},eq=contrast=1.12:saturation=1.25`;
  const draw = `drawtext=${font}textfile='${tf}':fontcolor=white:fontsize=${size}:borderw=${Math.round(size / 10)}:bordercolor=black:x=(w-text_w)/2:y=h-text_h-h*0.12`;
  try { await ff.run(c.settings.ffmpeg, ['-y', '-ss', t.toFixed(2), '-i', final, '-frames:v', '1', '-vf', `${scale},${draw}`, dest], c.signal); }
  catch { await ff.run(c.settings.ffmpeg, ['-y', '-ss', t.toFixed(2), '-i', final, '-frames:v', '1', '-vf', scale, dest], c.signal); }
  fs.rmSync(txt, { force: true });
  c.log(`thumbnail do quadro ${t.toFixed(1)}s do vídeo final ("${text}")`);
  /* QA DA THUMBNAIL: o teste do feed (168×94) + o brief (3 palavras, contraste, foco).
     Mede e grava; não derruba a execução por padrão. */
  try {
    const qa = await checkThumb(c.settings.ffmpeg, { thumb: dest, outDir: c.outDir, title: c.project.titleModel?.chosen || c.project.name, brief: { textOverlay: text }, signal: c.signal });
    c.log(thumbQaLine(qa));
  } catch (e) {
    if (c.signal.aborted) throw e;
    c.log(`aviso: QA da thumbnail não medido (${(e as Error).message.slice(0, 140)})`);
  }
  return { files: [dest] };
}

const manualExec = (o: ExecutorOptions): Executor => async (c) => {
  const f = primaryFile(c.step.kind, c);
  if (!fs.existsSync(f)) throw new Error(`etapa manual: coloque o arquivo em ${f} e execute novamente`);
  if ((c.step.kind === 'code_scene' || c.step.kind === 'motion_graphics') && /\.html?$/i.test(f)) {
    return finishRendered(c, o, f);
  }
  return { files: [f] };
};

/**
 * Roteiro importado "usar como está": a etapa de roteiro grava o texto do usuário (ou a transcrição do
 * áudio/vídeo dele) em script.md, sem passar por IA. As outras etapas seguem normalmente.
 */
export function importedScript(c: ExecContext): ExecResult | undefined {
  const ref = c.project.refScript;
  if (c.step.kind !== 'script' || !ref?.useAsScript || !ref.textFile || !fs.existsSync(ref.textFile)) return undefined;
  const text = fs.readFileSync(ref.textFile, 'utf8').trim();
  if (!text) return undefined;
  const file = primaryFile('script', c);
  ensureDir(file);
  fs.writeFileSync(file, text + '\n');
  c.log(`roteiro importado usado como está (${text.split(/\s+/).length} palavras${ref.transcribed ? ', transcrito do áudio/vídeo' : ''})`);
  return { files: [file] };
}

export function createExecutors(o: ExecutorOptions): Record<Binding['type'], Executor> {
  /* thumbnail em qualquer formato: 16:9 no YouTube, capa 9:16 em shorts/reels (antes era ignorada fora do 16:9) */
  const all: Record<Binding['type'], Executor> = { harness: harnessExec(o), api: apiExec(o), comfyui: comfyExec(o), wan2gp: wan2gpExec(o), stock: stockExec(o), builtin: builtinExec(o), manual: manualExec(o), flow: flowExec(o) };
  return Object.fromEntries(Object.entries(all).map(([k, ex]) => [k, async (c: ExecContext) => userFiles(c) ?? importedScript(c) ?? (c.step.kind === 'thumbnail' ? visualThumb(c, o, ex) : ex(c))])) as Record<Binding['type'], Executor>;
}

/**
 * Thumbnail visual: com um layout (template visual, estúdio do editor ou o padrão do quadro do vídeo), o texto e o
 * desenho são feitos por código. Gerador de imagem (ComfyUI/OpenAI/Gemini/Flow) → a imagem dele vira o fundo;
 * "quadro do vídeo" → o fundo é um quadro do final.mp4.
 */
async function visualThumb(c: ExecContext, o: ExecutorOptions, ex: Executor): Promise<ExecResult> {
  const fromFrame = c.binding.type === 'builtin' && c.binding.tool === 'frame-thumbnail';
  const design = projectThumbDesign(c.settings, c.project) ?? (fromFrame ? THUMB_DESIGN_TEMPLATES[0]!.design : undefined);
  if (!design || !o.snapHtml) return ex(c);
  let bgFile: string | undefined;
  if (!fromFrame) {
    const r = await ex(c);
    bgFile = r.files.find((f) => /.(png|jpe?g|webp)$/i.test(f));
    if (!bgFile) return r;
  } else if (!fs.existsSync(primaryFile('edit', c))) throw new Error('final.mp4 ainda não existe');
  const out = primaryFile('thumbnail', c);
  const tmp = out.replace(/(.w+)$/, '.design$1');
  const r = await renderThumb({ settings: c.settings, snap: o.snapHtml, projectDir: c.projectDir, project: c.project, design, out: tmp, bgFile, signal: c.signal });
  fs.renameSync(tmp, out);
  c.log(`thumbnail visual "${design.layout}" (${bgFile ? 'fundo da IA' : `quadro ${r.frames.map((t) => t.toFixed(1) + 's').join(' e ')} do vídeo`}) com o texto "${r.text}"`);
  return { files: [out] };
}

/**
 * Arquivos anexados pelo usuário vencem a geração: imagem/vídeo marcado na cena (userMedia) vira o quadro/clipe,
 * e o áudio marcado como trilha vira a trilha. Imagem do usuário + etapa de vídeo: o vídeo IA anima a imagem dele.
 */
function userFiles(c: ExecContext): Promise<ExecResult> | undefined {
  const k = c.step.kind;
  if (k === 'music' && !(c.step.bindings ?? []).some((b) => b.type === 'builtin' && (b.tool === 'lyric-song' || b.tool === 'clip-musical'))) {
    const src = musicAttachment(c.project, c.projectDir);
    if (!src) return undefined;
    return (async () => {
      const out = primaryFile('music', c);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      for (const f of fs.readdirSync(c.outDir).filter((x) => /^music\.(mp3|wav|m4a|ogg)$/i.test(x))) fs.rmSync(path.join(c.outDir, f), { force: true });
      await ff.run(c.settings.ffmpeg, ['-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', out], c.signal);
      c.log(`trilha do usuário: ${path.basename(src)}`);
      return { files: [out] };
    })();
  }
  const um = c.scene && (k === 'image' || k === 'video' || k === 'stock_media') ? sceneUserMedia(c.project, c.projectDir, c.scene) : undefined;
  if (!um || (k === 'video' && um.kind === 'image')) return undefined;
  return (async () => {
    if (k === 'stock_media') { c.log(`cena usa o arquivo do usuário (${path.basename(um.file)}): sem busca nos bancos`); return { files: [] }; }
    const out = primaryFile(k, c);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (k === 'image') await ff.run(c.settings.ffmpeg, ['-y', '-i', um.file, '-frames:v', '1', out], c.signal);
    else {
      /* trecho pedido pelo plano (clipStart/durationSec): corta só o pedaço que aparece, sem áudio (a cena é silenciosa) */
      const start = Math.max(0, Number(c.scene?.clipStart) || 0);
      const dur = c.scene?.manualDuration && c.scene?.durationSec ? Number(c.scene.durationSec) : 0;
      const crop = c.scene?.clipCrop;
      const { w: outW, h: outH } = ff.resolution(c.project.aspect);
      const isMp4 = /\.mp4$/i.test(um.file);
      if (isMp4 && !start && !dur && !crop) fs.copyFileSync(um.file, out);
      else if (!start && !dur && !crop) await ff.run(c.settings.ffmpeg, ['-y', '-i', um.file, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out], c.signal);
      else {
        const args = ['-y'];
        if (start > 0) args.push('-ss', start.toFixed(3));
        args.push('-i', um.file);
        if (dur > 0) args.push('-t', (dur + 0.5).toFixed(3));
        if (crop) args.push('-vf', `crop=${crop.w}:${crop.h}:${crop.x ?? 0}:${crop.y ?? 0},scale=${outW}:${outH}`);
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', out);
        await ff.run(c.settings.ffmpeg, args, c.signal);
        c.log(`trecho do vídeo do usuário: ${start.toFixed(1)}s${dur ? ` + ${dur.toFixed(1)}s` : ''}${crop ? ` · recorte ${crop.w}×${crop.h} em ${crop.x ?? 0},${crop.y ?? 0}` : ''} (${path.basename(um.file)})`);
      }
    }
    c.log(`${k === 'image' ? 'quadro' : 'clipe'} da cena = arquivo do usuário (${path.basename(um.file)})`);
    return { files: [out] };
  })();
}
