import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HarnessConfig, ReasoningEffort } from '../shared/types';
import type { ExecContext, ExecResult } from './engine';
import { runHarness, isHttpHarness } from './harness';
import * as ff from './ffmpeg';
import { renderedClip } from './prompts';
import { readWords, wordsPath } from './whisper';
import { ensureKitDeps, ensureStyleFonts, libraryFallbackFont, projectKitDir, shotFileOf, syncKitProject, type KitInfo, type KitRenderer } from './kit';

/*
 * Execução com o MOTOR do plugin (kit "player"): a IA não escreve mais uma página inteira por cena — escreve
 * o elenco/cenários do projeto (Design de assets) e um plano registerShot por cena (Cena por código), usando a API
 * testada do plugin. O FilmForge renderiza cada plano com o player do plugin (gradação, barras, rim light, 3D),
 * mostra os erros reais à IA para corrigir e faz uma revisão VISUAL (3 quadros) antes de aceitar a cena.
 */

interface Harness { id: string; cfg: HarnessConfig; model?: string; effort?: ReasoningEffort; env?: Record<string, string> }

/** Copia as referências e o exemplo do kit para dentro do projeto (a IA lê tudo a partir da pasta kit/). */
function stageRefs(kit: KitInfo, dir: string): string {
  const ref = path.join(dir, '_ref');
  if (fs.existsSync(path.join(ref, '.ok'))) return ref;
  fs.mkdirSync(ref, { recursive: true });
  for (const f of kit.refs) fs.copyFileSync(f, path.join(ref, path.basename(f)));
  const ex = kit.examples[0];
  if (ex) fs.cpSync(ex, path.join(ref, 'example'), { recursive: true, filter: (f) => !/[\\/](build|out|input)([\\/]|$)/.test(f) });
  fs.writeFileSync(path.join(ref, '.ok'), new Date().toISOString());
  return ref;
}

const list = (dir: string, re: RegExp) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort() : []);
const excerpt = (f: string, n: number) => { try { return fs.readFileSync(f, 'utf8').slice(0, n); } catch { return ''; } };

/** O que já existe no projeto do kit (elenco e cenários), para o plano usar os mesmos nomes. */
function castAndSets(dir: string): string {
  const cast = excerpt(path.join(dir, 'scenes', 'cast.js'), 3000);
  const sets = list(path.join(dir, 'scenes', 'sets'), /\.js$/).map((f) => {
    const src = excerpt(path.join(dir, 'scenes', 'sets', f), 4000);
    const ex = [...src.matchAll(/export\s+(?:function|const)\s+(\w+)/g)].map((m) => m[1]).join(', ');
    const doc = src.split('\n').find((l) => l.trim().startsWith('//'))?.trim() ?? '';
    return `- scenes/sets/${f}: exporta ${ex || '?'} ${doc}`;
  });
  return `ELENCO (scenes/cast.js):\n${cast || '(ainda não existe)'}\n\nCENÁRIOS:\n${sets.join('\n') || '(nenhum)'}`;
}

const skillText = (c: ExecContext, kind: string) => [c.project.skill?.global ? `DIRETRIZES DA SKILL: ${c.project.skill.global}` : '', c.project.skill?.steps?.[kind] ? `INSTRUÇÕES DA SKILL PARA ESTA ETAPA: ${c.project.skill.steps[kind]}` : ''].filter(Boolean).join('\n');
const langName = (l?: string) => (l?.startsWith('en') ? 'inglês' : l?.startsWith('es') ? 'espanhol' : l?.startsWith('fr') ? 'francês' : 'português do Brasil');

/** Modelos que o agy diz ter ("Gemini 3.8 Flash (Medium)" → "gemini-3.8-flash-medium"). */
export function agyAvailableModels(out: string): string[] {
  const i = out.indexOf('Available models:');
  if (i < 0) return [];
  return out.slice(i + 17).split(/\r?\n/).map((l) => l.replace(/^\s*(\[stderr\])?\s*/, '').trim()).filter((l) => /^[A-Za-z]/.test(l) && !/^error/i.test(l))
    .map((l) => l.toLowerCase().replace(/[()]/g, ' ').trim().replace(/\s+/g, '-'));
}

async function ask(c: ExecContext, h: Harness, cwd: string, prompt: string, images?: string[]) {
  let model = h.model;
  const once = () => runHarness(h.cfg, { cwd, prompt, model, effort: h.effort, signal: c.signal, onLine: c.log, timeoutSec: c.step.timeoutSec, env: h.env,
    tools: { roots: [c.projectDir], allowShell: false }, images: isHttpHarness(h.cfg) ? images : undefined });
  let r = await once();
  for (let k = 0; !r.ok && k < 2 && /invalid model selection|not recognized as a known model/i.test(r.stderr + r.stdout) && !c.signal.aborted; k++) {
    const avail = agyAvailableModels(r.stderr + '\n' + r.stdout);
    const asked = (model ?? h.cfg.defaultModel ?? '').toLowerCase();
    if (avail.length && asked && !avail.includes(asked)) {
      /* o modelo NÃO existe nesta conta (repetir não adianta): usa o padrão do harness, se ele existir */
      const def = h.cfg.defaultModel?.toLowerCase();
      if (def && def !== asked && avail.includes(def)) { c.log(`${h.id}: o modelo "${asked}" não existe nesta conta — usando o padrão "${def}"`); model = def; r = await once(); continue; }
      throw new Error(`${h.id}: o modelo "${asked}" não existe nesta conta. Disponíveis: ${avail.join(', ')} (ajuste em Configurações → Provedores)`);
    }
    /* o agy às vezes não reconhece um modelo válido quando dois processos carregam a lista ao mesmo tempo: tenta de novo */
    c.log(`${h.id}: modelo não reconhecido nesta chamada — tentando de novo (${k + 1}/2)`);
    await new Promise((res) => setTimeout(res, 4000 + k * 4000));
    r = await once();
  }
  if (!r.ok) throw new Error(`${h.id}: ${(r.stderr || r.stdout).slice(-400)}`);
  return r;
}

/** Design de assets no formato do kit: story/bible.md, scenes/cast.js e scenes/sets/*.js. */
export async function kitAssets(c: ExecContext, kit: KitInfo, h: Harness, r: KitRenderer): Promise<ExecResult> {
  const dir = projectKitDir(c.projectDir);
  syncKitProject(c.project, c.projectDir, { style: c.project.pluginStyles?.[path.basename(kit.pluginDir)], readWords: (d) => readWords(wordsPath(d))?.words, sceneDir: (id) => path.join(c.projectDir, 'scenes', id) });
  const ref = stageRefs(kit, dir);
  const scenes = [...c.project.scenes].sort((a, b) => a.index - b.index).map((s) => `${s.id} (${(s.durationSec ?? 0).toFixed(1)} s): "${s.narration ?? ''}" → ${s.visualIntent ?? ''}`).join('\n');
  const prompt = `Você é o DIRETOR DE ARTE de um vídeo animado feito com o motor de animação do plugin (código testado: personagens, luz, câmera e gradação).
Pasta de trabalho: ${dir}
LEIA ANTES (arquivos desta pasta): _ref/style-bible.md (o visual — siga à risca), _ref/story-breakdown.md, _ref/engine-api.md (a API), e o exemplo completo em _ref/example/ (story/bible.md, scenes/cast.js, scenes/sets/*.js).

Ideia: ${c.project.idea}
CENAS DO VÍDEO (id, duração, fala → o que se vê):
${scenes}
${skillText(c, 'asset_design')}

GRAVE (só estes arquivos, nesta pasta):
1. story/bible.md — logline, elenco (cada personagem com UMA cor de assinatura), locais com mood e luz principal, motivos visuais.
2. scenes/cast.js — um objeto de figurino por personagem recorrente (export const NOME = { top, color, head, … } como no exemplo) e export const CAST = [...].
3. scenes/sets/<local>.js — UMA função reutilizável por local (export function <local>(g, t, cam) { … return { GY, M } }), ancorada em GY = E.H * V(0.8, 0.68) e CX = E.W/2, com paredes/chão/céu passando da borda, luz principal visível (janela, poste, tela), atmosfera e camadas com layer(g, cam, profundidade, fn).
Importe o motor por caminho absoluto ('/engine/core.js', '/engine/fx2d.js'…) e use cores de mood()/S(). Nada de Math.random/Date.now (use rng/noise do core). Textos na tela em ${langName(c.project.language)}.
NÃO renderize, NÃO teste, NÃO instale nada e NÃO procure playwright/node_modules/render.mjs nem outras pastas de projeto: o FilmForge carrega e valida os arquivos sozinho depois. Leia só _ref/ e grave os 3 itens acima.${fs.existsSync(path.join(dir, 'scenes', 'cast.js')) || fs.existsSync(path.join(dir, 'story', 'bible.md')) ? `
CONTINUAÇÃO: uma rodada anterior já gravou parte dos arquivos — leia o que existe em story/ e scenes/, complete o que falta e não recomece do zero.` : ''}`;
  await ask(c, h, dir, prompt);
  const cast = path.join(dir, 'scenes', 'cast.js');
  if (!fs.existsSync(cast)) throw new Error(`${h.id} não gravou scenes/cast.js`);
  /* valida: o player carrega elenco e cenários sem erro de import */
  const errs = await bootErrors(c, kit, r, dir);
  if (errs.length) {
    c.log(`elenco/cenários com erro — pedindo correção: ${errs.slice(0, 3).join(' | ')}`);
    await ask(c, h, dir, `Os arquivos scenes/cast.js e scenes/sets/*.js (pasta ${dir}) falharam ao carregar no motor do plugin:\n${errs.slice(0, 8).join('\n')}\nCorrija os arquivos no lugar (veja _ref/engine-api.md). Grave só os arquivos corrigidos.`);
  }
  const md = path.join(c.projectDir, 'assets', 'assets.md');
  fs.mkdirSync(path.dirname(md), { recursive: true });
  fs.writeFileSync(md, `# Elenco e cenários (motor do plugin)\n\n${excerpt(path.join(dir, 'story', 'bible.md'), 8000)}\n\n## Personagens fixos\n\n\`\`\`js\n${excerpt(cast, 3000)}\n\`\`\`\n`);
  return { files: [md, cast] };
}

async function bootErrors(c: ExecContext, kit: KitInfo, r: KitRenderer, dir: string): Promise<string[]> {
  const modules = await ensureKitDeps(c.settings, kit.kitDir, c.log, c.signal);
  const host = r.host({ root: kit.kitDir, project: dir, modules });
  const res = await r.frames({ url: `forge-scene://${host}/player.html?scale=0.25`, w: 480, h: 270, ffmpeg: c.settings.ffmpeg || 'ffmpeg', fps: 30, mode: 'player', from: 0, to: 0, stills: [0.1], stillDir: path.join(dir, 'build'), log: c.log });
  return res.errors.filter((e) => /import|SyntaxError|ReferenceError|TypeError|not defined|Unexpected/i.test(e) && !/shots\//.test(e));
}

/** Uma cena = um plano (registerShot) renderizado pelo player do plugin. */
export async function kitShot(c: ExecContext, kit: KitInfo, h: Harness, r: KitRenderer): Promise<ExecResult> {
  const sc = c.scene!;
  const dir = projectKitDir(c.projectDir);
  const style = c.project.pluginStyles?.[path.basename(kit.pluginDir)];
  const timing = syncKitProject(c.project, c.projectDir, { style, readWords: (d) => readWords(wordsPath(d))?.words, sceneDir: (id) => path.join(c.projectDir, 'scenes', id) });
  const ref = stageRefs(kit, dir);
  const tm = timing[sc.id]!;
  const dur = tm.end - tm.start;
  const file = shotFileOf(c.projectDir, sc.id);
  const words = (readWords(wordsPath(c.sceneDir!))?.words ?? []).map((w) => `${w.w}@${(tm.start + w.start).toFixed(2)}`).join(' ');
  const exShots = list(path.join(ref, 'example', 'scenes', 'shots'), /\.js$/).map((f) => `_ref/example/scenes/shots/${f}`).join(', ');
  const prompt = `Você é o ANIMADOR do vídeo, usando o motor de animação do plugin (não reinvente desenhos: use a API).
Pasta de trabalho: ${dir}
LEIA: _ref/engine-api.md (API completa), _ref/style-bible.md (o visual — siga à risca), _ref/render-qc.md (checklist) e os planos de exemplo: ${exShots || '_ref/example/scenes/shots/'}.

ESCREVA o arquivo scenes/shots/${sc.id}.js com:  registerShot('${sc.id}', { draw(g, t, info) { … } })   (ou kind:'3d' com init/draw/overlay, como no exemplo)
- Este plano dura ${dur.toFixed(2)} s e começa no tempo global ${tm.start.toFixed(2)} s (t vai de 0 a ${dur.toFixed(2)}; info.globalT = ${tm.start.toFixed(2)} + t).
- Fala neste plano: "${sc.narration ?? ''}"
- O que se vê: ${sc.visualIntent ?? ''}
- Palavras com tempo GLOBAL (use wordTime('palavra', ${tm.start.toFixed(2)}) para sincronizar gráficos, expressões e números): ${words || '(sem tempos)'}
${castAndSets(dir)}
${skillText(c, 'code_scene')}

REGRAS (inegociáveis do estilo): rim light em toda figura iluminada; cores de mood()/S()/elenco; movimento de câmera em todo plano; atmosfera (FX.dust, chuva, glows); estrutura de valores escura com 1–3 pontos claros; gráficos sincronizados com wordTime(); V() em todo valor que depende do formato (${c.project.aspect}); nada de Math.random/Date.now; textos na tela curtos em ${langName(c.project.language)}.
Importe o motor por caminho absoluto ('/engine/core.js', '/engine/rig2d.js', '/engine/fx2d.js', '/engine/ui2d.js') e o elenco/cenários por caminho relativo ('../cast.js', '../sets/<local>.js'). Reaproveite os cenários existentes; se precisar de um local novo, crie scenes/sets/<local>.js.
Grave só scenes/shots/${sc.id}.js (e um cenário novo, se for o caso).`;
  await ask(c, h, dir, prompt);
  if (!fs.existsSync(file)) throw new Error(`${h.id} não gravou scenes/shots/${sc.id}.js`);

  const clip = renderedClip('code_scene', c)!;
  fs.mkdirSync(path.dirname(clip), { recursive: true });
  const { w, h: hh } = ff.resolution(c.project.aspect);
  const modules = await ensureKitDeps(c.settings, kit.kitDir, c.log, c.signal);
  const host = r.host({ root: kit.kitDir, project: dir, modules });
  const scale = (c.project.aspect === '9:16' ? w / 1080 : w / 1920).toFixed(4);
  const url = `forge-scene://${host}/player.html?scale=${scale}${style ? `&style=${encodeURIComponent(style)}` : ''}`;
  const mine = (errs: string[]) => errs.filter((e) => e.includes(sc.id) || e.includes(`shots/${sc.id}.js`));
  const render = async () => {
    c.log(`render pelo motor do plugin: ${sc.id} ${tm.start.toFixed(2)}–${tm.end.toFixed(2)} s`);
    return mine((await r.frames({ url, w, h: hh, ffmpeg: c.settings.ffmpeg || 'ffmpeg', fps: 30, mode: 'player', from: tm.start, to: tm.end, out: clip, log: c.log })).errors);
  };
  /* erros reais do motor → a mesma IA corrige (até 2 vezes) */
  let errs = await render();
  for (let k = 0; errs.length && k < 2; k++) {
    c.log(`o plano ${sc.id} lançou erro — pedindo correção (${k + 1}/2): ${errs.slice(0, 2).join(' | ')}`);
    await ask(c, h, dir, `O arquivo scenes/shots/${sc.id}.js (pasta ${dir}) deu erro no motor do plugin:\n${errs.slice(0, 6).join('\n')}\nCorrija no lugar, mantendo o mesmo plano (veja _ref/engine-api.md). Grave só esse arquivo.`);
    errs = await render();
  }
  if (errs.length) throw new Error(`o plano ${sc.id} continua com erro: ${errs.slice(0, 2).join(' | ')}`);

  /* revisão visual: 3 quadros do plano → a IA olha com o checklist e corrige a composição se precisar */
  if ((c.step.params as Record<string, unknown>)?.['kitQc'] !== false) {
    const qc = path.join(c.sceneDir!, 'kit-qc');
    fs.rmSync(qc, { recursive: true, force: true });
    const stills = [0.15, 0.5, 0.85].map((p) => tm.start + dur * p);
    await r.frames({ url, w: Math.round(w / 2), h: Math.round(hh / 2), ffmpeg: c.settings.ffmpeg || 'ffmpeg', fps: 30, mode: 'player', from: tm.start, to: tm.start, stills, stillDir: qc, log: c.log });
    const sheet = path.join(qc, 'sheet.png');
    try { await ff.run(c.settings.ffmpeg || 'ffmpeg', ['-y', '-i', path.join(qc, 'still_1.png'), '-i', path.join(qc, 'still_2.png'), '-i', path.join(qc, 'still_3.png'), '-filter_complex', 'hstack=inputs=3', sheet]); } catch { /* sem folha: segue com os quadros */ }
    const before = fs.statSync(file).mtimeMs;
    const imgs = fs.existsSync(sheet) ? [sheet] : list(qc, /\.png$/).map((f) => path.join(qc, f));
    await ask(c, h, dir, `REVISÃO VISUAL do plano ${sc.id}. Abra e OLHE a imagem ${imgs.join(', ')} (3 quadros do plano: início, meio e fim). Compare com o checklist de _ref/render-qc.md e com a style bible:
silhuetas legíveis com rim light, ponto de luz principal visível, nada cortado na borda, texto legível e curto, câmera em movimento, o quadro mostra o que é dito ("${sc.narration ?? ''}").
Se houver um problema real, corrija scenes/shots/${sc.id}.js. Se estiver bom, NÃO altere nada e responda só "OK".`, imgs).catch((e) => c.log(`revisão visual pulada: ${(e as Error).message.slice(0, 160)}`));
    if (fs.statSync(file).mtimeMs > before) {
      c.log(`plano ${sc.id} ajustado na revisão visual — renderizando de novo`);
      errs = await render();
      if (errs.length) throw new Error(`o ajuste da revisão quebrou o plano ${sc.id}: ${errs[0]}`);
    }
  }
  return { files: [clip, file] };
}

/** Renderiza de novo todos os planos já escritos (sem chamar a IA): para trocar o estilo do motor ou o formato. */
export async function kitRerender(s: import('../shared/types').Settings, p: import('../shared/types').Project, projectDir: string, kit: KitInfo, r: KitRenderer, log: (l: string) => void, signal?: AbortSignal): Promise<number> {
  const dir = projectKitDir(projectDir);
  const style = p.pluginStyles?.[path.basename(kit.pluginDir)];
  const timing = syncKitProject(p, projectDir, { style, readWords: (d) => readWords(wordsPath(d))?.words, sceneDir: (id) => path.join(projectDir, 'scenes', id) });
  const { w, h } = ff.resolution(p.aspect);
  const modules = await ensureKitDeps(s, kit.kitDir, log, signal);
  const host = r.host({ root: kit.kitDir, project: dir, modules });
  const url = `forge-scene://${host}/player.html?scale=${(p.aspect === '9:16' ? w / 1080 : w / 1920).toFixed(4)}${style ? `&style=${encodeURIComponent(style)}` : ''}`;
  let n = 0;
  for (const sc of [...p.scenes].sort((a, b) => a.index - b.index)) {
    if (signal?.aborted) break;
    const tm = timing[sc.id];
    if (!tm || !fs.existsSync(shotFileOf(projectDir, sc.id))) continue;
    const clip = path.join(projectDir, 'scenes', sc.id, 'clips', 'code.mp4');
    fs.mkdirSync(path.dirname(clip), { recursive: true });
    log(`estilo "${style ?? 'padrão'}": renderizando ${sc.id}`);
    await r.frames({ url, w, h, ffmpeg: s.ffmpeg || 'ffmpeg', fps: 30, mode: 'player', from: tm.start, to: tm.end, out: clip, log });
    n++;
  }
  return n;
}

/* ═══════════ biblioteca de estilos ("pages": Lemo-Opuscar) ═══════════ */

/** Estilo escolhido no projeto (ou o primeiro com demo). */
function pagesStyle(c: ExecContext, kit: KitInfo) {
  const id = c.project.pluginStyles?.[path.basename(kit.pluginDir)];
  return kit.styleInfo?.find((x) => x.id === id) ?? kit.styleInfo?.find((x) => x.demo) ?? kit.styleInfo?.[0];
}

/** Copia para o projeto o STYLE.md e a demo do estilo + guias da biblioteca (a IA lê tudo a partir de kit/_ref). */
function stagePagesRefs(kit: KitInfo, dir: string, styleId: string): string {
  const ref = path.join(dir, '_ref');
  const stamp = path.join(ref, '.style');
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === styleId) return ref;
  fs.rmSync(ref, { recursive: true, force: true });
  fs.mkdirSync(ref, { recursive: true });
  for (const f of kit.refs) fs.copyFileSync(f, path.join(ref, path.basename(f) === 'README.md' ? 'core-README.md' : path.basename(f)));
  const sd = path.join(kit.library!, 'styles', styleId);
  for (const f of ['STYLE.md', 'style.json']) if (fs.existsSync(path.join(sd, f))) fs.copyFileSync(path.join(sd, f), path.join(ref, f));
  if (fs.existsSync(path.join(sd, 'demo'))) fs.cpSync(path.join(sd, 'demo'), path.join(ref, 'demo'), { recursive: true, filter: (f) => !/[\\/](out|stills|music|fonts|voices)([\\/]|$)|\.(jpg|jpeg|png|webp|mp3|wav|woff2?|ttf|otf)$/i.test(f.slice(sd.length)) });
  fs.writeFileSync(stamp, styleId);
  return ref;
}

const pageFileOf = (projectDir: string, sceneId: string) => path.join(projectKitDir(projectDir), 'scenes', sceneId, 'index.html');

/** Elenco/cenários no estilo: kit/bible.md + kit/shared.js (paleta, fontes e personagens desenhados no estilo). */
export async function pagesAssets(c: ExecContext, kit: KitInfo, h: Harness): Promise<ExecResult> {
  const st = pagesStyle(c, kit);
  if (!st) throw new Error('a biblioteca não tem estilos');
  const dir = projectKitDir(c.projectDir);
  fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
  stagePagesRefs(kit, dir, st.id);
  const scenes = [...c.project.scenes].sort((a, b) => a.index - b.index).map((s) => `${s.id} (${(s.durationSec ?? 0).toFixed(1)} s): "${s.narration ?? ''}" → ${s.visualIntent ?? ''}`).join('\n');
  const prompt = `Você é o DIRETOR DE ARTE de um vídeo no estilo "${st.name}" da biblioteca de estilos do plugin (filmes feitos inteiramente em código).
Pasta de trabalho: ${dir}
LEIA ANTES: _ref/STYLE.md (o estilo — siga à risca), _ref/core-README.md (contrato das páginas e o kit /core/lib.js), _ref/TECHNIQUE.md se existir, e o código da demo do estilo em _ref/demo/ (como o estilo desenha, anima, ilumina e escreve).

Ideia: ${c.project.idea}
CENAS (id, duração, fala → o que se vê):
${scenes}
${skillText(c, 'asset_design')}

GRAVE (só estes arquivos):
1. bible.md — o filme neste estilo: paleta (hex), tipografia, personagens/objetos recorrentes e como são desenhados, locais e luz, movimentos de câmera e transições do estilo.
2. shared.js — módulo ES reutilizado por TODAS as cenas: export da paleta, das fontes e de funções de desenho dos personagens/objetos/cenários recorrentes (draw…(ctx, t, opts)), no estilo da demo. Pode importar '/core/lib.js' (caminho absoluto) e copiar/adaptar técnicas da demo. Determinístico (sem Math.random/Date.now; use sementes).
Textos na tela em ${langName(c.project.language)}.
NÃO renderize, NÃO teste, NÃO instale nada e NÃO procure playwright/node_modules nem outras pastas de projeto: o FilmForge valida os arquivos sozinho depois.`;
  await ask(c, h, dir, prompt);
  if (!fs.existsSync(path.join(dir, 'shared.js'))) throw new Error(`${h.id} não gravou shared.js`);
  const md = path.join(c.projectDir, 'assets', 'assets.md');
  fs.mkdirSync(path.dirname(md), { recursive: true });
  fs.writeFileSync(md, `# ${st.name} — bíblia do filme (biblioteca do plugin)\n\n${excerpt(path.join(dir, 'bible.md'), 8000)}\n`);
  return { files: [md, path.join(dir, 'shared.js')] };
}

/** Uma cena = uma página no estilo (READY/render(t)/DUR), renderizada com a biblioteca na raiz e o projeto em /@film/. */
export async function pagesScene(c: ExecContext, kit: KitInfo, h: Harness, r: KitRenderer): Promise<ExecResult> {
  const sc = c.scene!;
  const st = pagesStyle(c, kit);
  if (!st) throw new Error('a biblioteca não tem estilos');
  const dir = projectKitDir(c.projectDir);
  stagePagesRefs(kit, dir, st.id);
  const dur = Math.round(Math.max(0.5, sc.durationSec ?? 4) * 100) / 100;
  const file = pageFileOf(c.projectDir, sc.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { w, h: hh } = ff.resolution(c.project.aspect);
  const words = (readWords(wordsPath(c.sceneDir!))?.words ?? []).map((x) => `${x.w}@${x.start.toFixed(2)}`).join(' ');
  const prompt = `Você é o ANIMADOR deste vídeo no estilo "${st.name}" (biblioteca de estilos do plugin).
Pasta de trabalho: ${dir}
LEIA: _ref/STYLE.md, _ref/core-README.md (contrato da página), bible.md e shared.js (o que já existe deste filme) e, para técnicas, o código da demo em _ref/demo/.

ESCREVA scenes/${sc.id}/index.html (pode dividir em scenes/${sc.id}/main.js): UMA página com <canvas> ${w}×${hh} e o CONTRATO:
  window.DUR = ${dur};  window.render = (t) => { /* desenha o quadro em t (0..${dur}), determinístico */ };  window.READY = true;  (READY só depois de fontes/imagens carregadas)
- Fala desta cena: "${sc.narration ?? ''}"
- O que se vê: ${sc.visualIntent ?? ''}
- Palavras com tempo (segundos desde o início da cena): ${words || '(sem tempos)'} — sincronize textos, números e ações com elas.
- Fontes do estilo: <link rel="stylesheet" href="/styles/${st.id}/demo/fonts/fonts.css"> (e espere document.fonts.load antes do READY).
- Importe o kit por caminho absoluto ('/core/lib.js') e o que é deste filme de '/@film/shared.js'; three.js como '/node_modules/three/build/three.module.js' (declare o import map se usar 'three').
- Siga o estilo à risca (paleta, traço, textura, câmera, ritmo). Nada de Math.random/Date.now/rede; nenhum quadro pode lançar exceção. Textos na tela curtos em ${langName(c.project.language)}.
${skillText(c, 'code_scene')}
Grave só os arquivos desta cena.`;
  await ask(c, h, dir, prompt);
  if (!fs.existsSync(file)) throw new Error(`${h.id} não gravou scenes/${sc.id}/index.html`);

  const clip = renderedClip('code_scene', c)!;
  fs.mkdirSync(path.dirname(clip), { recursive: true });
  const modules = await ensureKitDeps(c.settings, kit.library!, c.log, c.signal);
  if (st.demo) await ensureStyleFonts(st.demo, c.log).catch(() => {});
  const host = r.host({ root: kit.library!, project: dir, modules, fallbackFont: libraryFallbackFont(kit.library!) });
  const url = `forge-scene://${host}/@film/scenes/${sc.id}/index.html`;
  const render = async () => {
    c.log(`render pela biblioteca do plugin (${st.name}): ${sc.id} 0–${dur} s`);
    return (await r.frames({ url, w, h: hh, ffmpeg: c.settings.ffmpeg || 'ffmpeg', fps: 30, mode: 'page', from: 0, to: dur, out: clip, log: c.log })).errors;
  };
  let errs = await render().catch((e: Error) => [e.message]);
  for (let k = 0; errs.length && k < 2; k++) {
    c.log(`a cena ${sc.id} deu erro — pedindo correção (${k + 1}/2): ${errs.slice(0, 2).join(' | ')}`);
    await ask(c, h, dir, `A página scenes/${sc.id}/index.html (pasta ${dir}) falhou no render:\n${errs.slice(0, 6).join('\n')}\nCorrija no lugar, mantendo a cena e o contrato (window.READY, window.render(t), window.DUR). Grave só os arquivos desta cena.`);
    errs = await render().catch((e: Error) => [e.message]);
  }
  if (errs.length) throw new Error(`a cena ${sc.id} continua com erro: ${errs.slice(0, 2).join(' | ')}`);
  if ((c.step.params as Record<string, unknown>)?.['kitQc'] !== false) {
    const qc = path.join(c.sceneDir!, 'kit-qc');
    fs.rmSync(qc, { recursive: true, force: true });
    await r.frames({ url, w, h: hh, ffmpeg: c.settings.ffmpeg || 'ffmpeg', fps: 30, mode: 'page', from: 0, to: 0, stills: [0.15, 0.5, 0.85].map((p) => dur * p), stillDir: qc, log: c.log });
    const sheet = path.join(qc, 'sheet.png');
    try { await ff.run(c.settings.ffmpeg || 'ffmpeg', ['-y', '-i', path.join(qc, 'still_1.png'), '-i', path.join(qc, 'still_2.png'), '-i', path.join(qc, 'still_3.png'), '-filter_complex', 'hstack=inputs=3,scale=1920:-2', sheet]); } catch { /* sem folha */ }
    const before = newest(path.dirname(file));
    const imgs = fs.existsSync(sheet) ? [sheet] : list(qc, /\.png$/).map((f) => path.join(qc, f));
    await ask(c, h, dir, `REVISÃO VISUAL da cena ${sc.id} no estilo "${st.name}". Abra e OLHE ${imgs.join(', ')} (3 quadros: início, meio e fim). Compare com _ref/STYLE.md: o estilo está fiel? leitura clara, nada cortado na borda, texto legível, movimento, o quadro mostra o que é dito ("${sc.narration ?? ''}").
Se houver um problema real, corrija scenes/${sc.id}/. Se estiver bom, NÃO altere nada e responda só "OK".`, imgs).catch((e) => c.log(`revisão visual pulada: ${(e as Error).message.slice(0, 160)}`));
    if (newest(path.dirname(file)) > before) {
      c.log(`cena ${sc.id} ajustada na revisão visual — renderizando de novo`);
      errs = await render().catch((e: Error) => [e.message]);
      if (errs.length) throw new Error(`o ajuste da revisão quebrou a cena ${sc.id}: ${errs[0]}`);
    }
  }
  return { files: [clip, file] };
}

const newest = (d: string) => list(d, /./).reduce((m, f) => Math.max(m, fs.statSync(path.join(d, f)).mtimeMs), 0);
