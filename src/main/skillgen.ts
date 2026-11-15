import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HarnessId, ReasoningEffort, Settings, Skill } from '../shared/types';
import { cookieArgs, ensureYtDlp } from './youtube';
import * as ff from './ffmpeg';
import { transcribe } from './whisper';
import { ensureWhisper } from './whisper-install';
import { isHttpHarness, resolveHarness, runHarness } from './harness';
import { activeAgyEnv } from './automations';
import { listRoutes, listSkills, getSkill, parseSkillMarkdown, saveSkill, slugify } from './library';
import { VIDEO_TYPES } from './presets';
import { ALL_ANGLES } from '../shared/angles';
import { checkSkillRoute } from '../shared/compat';
import { getDb } from './db';
import { frameSheets, measureVideo, normalizeLanguages, type LanguagePick, type VideoMetrics } from './channel-dna';

/** ranking de idiomas pedido à IA (arquivo separado do skill.md) */
const LANG_RULE = 'Grave também languages.json: [5 itens, do melhor para o pior, idiomas com MAIS chance de sucesso para este formato] cada um { "code": "en|pt-BR|es|hi|…", "score": 0-10, "why": "tamanho do público, concorrência nesse idioma, CPM", "audience": "público estimado", "competition": "baixa|média|alta", "cpm": "baixo|médio|alto" }.';
import { normalizeSources, SOURCE_COUNT_RULE, sourcesText, type SourceMix } from './clone-metrics';
import { artQuant, audioQuant, descQuant, motionQuant, normalizePauta, PAUTA_RULE, pautaMarkdown, quantText, readWords, SHOT_COUNT_RULE, summarizeQuant, type PautaItem, type AudioQuant, type DescQuant, type MotionQuant } from './clone-metrics';

/*
 * Nova SKILL a partir de vídeos de referência:
 * 1) baixa cada link (yt-dlp, até 10 min, 480p) ou usa arquivos locais;
 * 2) extrai quadros-chave, a transcrição (Whisper) e os metadados (título, descrição, tags);
 * 3) um provedor com visão (Antigravity/Gemini, Claude Code, Codex…) analisa os arquivos e
 *    escreve skill.md no formato do FilmForge, já com o(s) ângulo(s) escolhido(s) e a rota sugerida;
 * 4) o app valida (aparência, rota, nome único) e salva a skill na biblioteca.
 * A análise copia o ESTILO (estrutura, ritmo, linguagem visual, tom), nunca o conteúdo.
 */

export interface SkillGenInput {
  links: string[]; files?: string[];
  angles: string[]; angleNote?: string;
  harness: HarnessId | 'auto'; model?: string; effort?: ReasoningEffort;
  name?: string; language?: string; framesPerVideo?: number;
}
export type VideoRef = { idx: number; frames: string[]; transcript?: string; info: Record<string, unknown>; url?: string };
export interface SkillGenResult { skill: Skill; routeId: string; routeName: string; routeReason: string; warnings: string[]; workdir: string; /** números medidos (mediana dos vídeos) */ quant?: import('./clone-metrics').CloneQuant; /** idiomas com mais chance de sucesso (nota 0–10) */ languages?: LanguagePick[]; /** 20 vídeos para produzir (título, sinopse, gancho) */ pauta?: PautaItem[]; /** origem das imagens em % do tempo */ sources?: SourceMix }

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    c.stdout.on('data', (d: Buffer) => { out += d.toString(); }); c.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    const abort = () => c.kill();
    signal?.addEventListener('abort', abort, { once: true });
    c.on('error', (e) => resolve({ code: -1, out, err: err + e.message }));
    c.on('close', (code) => { signal?.removeEventListener('abort', abort); resolve({ code, out, err }); });
  });
}

/** Baixa um link (até 10 min, 480p, com áudio) e devolve o arquivo + metadados do yt-dlp. */
export async function download(s: Settings, url: string, dir: string, idx: number, log: (l: string) => void, signal?: AbortSignal, maxSec = 600): Promise<{ file: string; info: Record<string, unknown> }> {
  const exe = await ensureYtDlp(s, log);
  const ffmpeg = ff.resolveBin(s.ffmpeg || 'ffmpeg');
  fs.mkdirSync(dir, { recursive: true });
  log(`baixando o vídeo ${idx}: ${url}`);
  const tpl = path.join(dir, `video${idx}.%(ext)s`);
  /* TikTok/Instagram/Facebook/Kwai: a sessão de login da pesquisa vai como cookies (o YouTube não precisa) */
  const r = await run(exe, [...await cookieArgs(url), '-f', 'b[height<=480]/bv*[height<=480]+ba/b', '--merge-output-format', 'mp4', '--no-playlist', '--write-info-json', '--no-warnings',
    '--ffmpeg-location', path.dirname(ffmpeg), '--download-sections', `*0-${maxSec}`, '-o', tpl, '--', url], signal);
  if (r.code !== 0) throw new Error(`não consegui baixar ${url}: ${(r.err || r.out).split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 200) ?? 'erro do yt-dlp'}`);
  const file = fs.readdirSync(dir).filter((f) => f.startsWith(`video${idx}.`) && /\.(mp4|webm|mkv|mov)$/i.test(f)).map((f) => path.join(dir, f))[0];
  if (!file) throw new Error(`o yt-dlp não gravou o vídeo de ${url}`);
  let info: Record<string, unknown> = {};
  try { info = JSON.parse(fs.readFileSync(path.join(dir, `video${idx}.info.json`), 'utf8')); } catch { /* sem metadados */ }
  return { file, info };
}

/** Baixa (ou usa o arquivo), extrai N quadros-chave e a transcrição de um vídeo de referência para a pasta de trabalho. */
export async function prepareReference(s: Settings, workdir: string, idx: number, src: { url?: string; file?: string }, n: number, toolsDir: string, log: (l: string) => void, signal?: AbortSignal, maxSec = 600): Promise<VideoRef> {
  const ffmpeg = s.ffmpeg || 'ffmpeg';
  fs.mkdirSync(path.join(workdir, 'transcripts'), { recursive: true });
  const got = src.url ? await download(s, src.url, path.join(workdir, 'videos'), idx, log, signal, maxSec) : { file: src.file!, info: { title: path.basename(src.file!) } };
  const dur = (await ff.duration(s.ffprobe, got.file)) || 60;
  const frames: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (dur * (i + 0.5)) / n;
    const rel = `frames/video${idx}_${String(i + 1).padStart(2, '0')}_${t.toFixed(0)}s.jpg`;
    fs.mkdirSync(path.join(workdir, 'frames'), { recursive: true });
    try { await ff.run(ffmpeg, ['-y', '-ss', t.toFixed(2), '-i', got.file, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', path.join(workdir, rel)], signal); frames.push(rel); } catch { /* quadro ilegível */ }
  }
  log(`vídeo ${idx}: ${frames.length} quadros-chave (${dur.toFixed(0)} s)`);
  let transcript: string | undefined;
  try {
    const out = path.join(workdir, 'transcripts', `video${idx}.json`);
    const script = path.join(toolsDir, 'whisper_words.py');
    let cfg = s.whisper ?? { python: 'python', model: 'small', device: 'auto' };
    let w;
    try { w = await transcribe(cfg, script, got.file, out, undefined, signal ?? new AbortController().signal); }
    catch (e) {
      if (cfg.autoInstall === false || !/faster-whisper|No module|ModuleNotFound|não foi possível executar|ENOENT|python/i.test((e as Error).message)) throw e;
      log('instalando o Whisper para transcrever…');
      const inst = await ensureWhisper(s, { log, signal });
      cfg = { ...cfg, python: inst.python, device: 'cpu' };
      w = await transcribe(cfg, script, got.file, out, undefined, signal ?? new AbortController().signal);
    }
    transcript = w.text.trim();
    fs.writeFileSync(path.join(workdir, 'transcripts', `video${idx}.txt`), transcript, 'utf8');
    log(`vídeo ${idx}: transcrição com ${transcript.split(/\s+/).length} palavras`);
  } catch (e) { log(`vídeo ${idx}: sem transcrição (${(e as Error).message.slice(0, 100)})`); }
  return { idx, frames, transcript, info: got.info, url: src.url };
}

/** Regras e formato EXATO do skill.md do FilmForge (aparências, rotas, nome único). */
export function skillRules(s: Settings, lang: string): string {
  const routes = listRoutes(s).filter((r) => r.steps.some((st) => st.kind === 'scene_plan' || st.kind === 'free'));
  const existing = listSkills(s).map((k) => k.name);
  return `## Diretrizes do app (obrigatórias)
- appearance: escolha UM id: ${VIDEO_TYPES.map((v) => `${v.id} (${v.label}; cena padrão ${v.sceneKind})`).join(' | ')}.
- routeId: escolha a rota que PRODUZ o que a skill pede (tipos de cena): ${routes.map((r) => `${r.id} = ${r.name}: ${r.description}`).join(' || ')}.
- Tipos de cena do app: image | video (vídeo IA) | code (desenhada por código) | motion | mixed (código + banco de mídia) | stock (banco de mídia). Peça só os tipos que a rota escolhida produz.
- presentation: generated ou mixed; se mixed, mixSources: [motion, stock, ai] (só os usados) e mediaSources: [pexels, pixabay, wikipedia, youtube].
- scriptEnding: loop (shorts que emendam), next (gancho para o próximo) ou conclusion.
- multiVoice: true só se houver diálogo entre personagens.
- name: curto e ÚNICO — não pode ser nenhum destes: ${existing.join(' · ')}.
- language: ${lang} (o idioma dos vídeos gerados com a skill).
- Instruções escritas em português, diretas, dizendo à IA O QUE fazer em cada etapa (não explique o app).

## Formato EXATO de skill.md
---
name: <nome único>
description: "<1 frase: que vídeo esta skill produz>"
appearance: <id>
routeId: <id da rota>
routeReason: "<1 frase: por que essa rota>"
aspect: "<16:9|9:16|1:1|4:5>"
durationSec: <segundos>
language: ${lang}
presentation: <generated|mixed>
scriptEnding: <loop|next|conclusion>
reviewCriteria: "<critérios objetivos para a revisão de qualidade>"
outputStyle: |-
  🎨 Visual: ...
  ⏱ Ritmo: ...
  🎙 Narração: ...
  🎬 Cenas: ...
  📦 Saída: ...
---

## Global

<diretrizes gerais: estilo, tom, ângulo, regras>

## Etapa: script

<como escrever o roteiro: gancho, estrutura, tamanho das frases, ângulo>

## Etapa: scene_plan

<tipos de cena, duração por cena, o que o visualIntent deve descrever>

## Etapa: image
## Etapa: video
## Etapa: code_scene
## Etapa: motion_graphics
## Etapa: narration
## Etapa: thumbnail
## Etapa: metadata
(escreva só as etapas que a rota usa; cada uma com instruções concretas)`;
}

/** Valida o skill.md escrito pela IA (aparência, rota, nome e id únicos), anexa a origem e o exemplo visual e salva. */
export function finalizeSkillMd(s: Settings, md: string, o: { name?: string; language?: string; sourceNote?: string; preview?: string; fallbackId?: string }): { skill: Skill; route: ReturnType<typeof listRoutes>[number]; warnings: string[]; routeReason: string } {
  const parsed = parseSkillMarkdown(md, o.fallbackId ?? 'skill-de-videos');
  if (!parsed) throw new Error('skill.md inválido (sem nome)');
  const warnings: string[] = [];
  if (o.name?.trim()) parsed.name = o.name.trim();
  if (!VIDEO_TYPES.some((v) => v.id === parsed.appearance)) { warnings.push(`aparência "${parsed.appearance}" desconhecida → personalizado`); parsed.appearance = 'custom'; }
  const routes = listRoutes(s);
  let route = routes.find((r) => r.id === parsed.routeId);
  if (!route) { route = routes.find((r) => r.id === VIDEO_TYPES.find((v) => v.id === parsed.appearance)?.defaultRoute) ?? routes[0]!; warnings.push(`rota "${parsed.routeId}" não existe → ${route.name}`); parsed.routeId = route.id; }
  const names = new Set(listSkills(s).map((k) => k.name.toLowerCase()));
  let nm = parsed.name, c = 2;
  while (names.has(nm.toLowerCase())) nm = `${parsed.name} (${c++})`;
  parsed.name = nm;
  let sid = slugify(nm) || 'skill-de-videos', k = 2;
  while (getSkill(s, sid)) sid = `${slugify(nm)}-${k++}`;
  parsed.id = sid;
  parsed.language = parsed.language || o.language || 'pt-BR';
  if (o.sourceNote) parsed.outputStyle = [parsed.outputStyle, `🔗 ${o.sourceNote}`].filter(Boolean).join('\n');
  if (o.preview && fs.existsSync(o.preview)) {
    const dest = path.join(s.workspace, 'library', 'skill-media', `${sid}${path.extname(o.preview) || '.jpg'}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(o.preview, dest);
    parsed.previewMedia = dest;
  }
  const rep = checkSkillRoute(parsed, route, VIDEO_TYPES.find((v) => v.id === parsed.appearance)?.sceneKind, route);
  warnings.push(...rep.errors, ...rep.warnings);
  const routeReason = /^routeReason:\s*"?(.+?)"?\s*$/m.exec(md)?.[1] ?? '';
  return { skill: saveSkill(s, parsed), route, warnings, routeReason };
}

/** Prompt do criador de skills: formato exato do FilmForge, aparências, rotas e ângulos. */
function buildPrompt(s: Settings, input: SkillGenInput, videos: VideoRef[]): string {
  const routes = listRoutes(s).filter((r) => r.steps.some((st) => st.kind === 'scene_plan' || st.kind === 'free'));
  const existing = listSkills(s).map((k) => k.name);
  const angles = input.angles.map((id) => ALL_ANGLES.find((a) => a.id === id)).filter(Boolean) as typeof ALL_ANGLES;
  const vids = videos.map((v) => {
    const i = v.info;
    return `### Vídeo ${v.idx}\n- título: ${String(i['title'] ?? '—')}\n- canal: ${String(i['uploader'] ?? i['channel'] ?? '—')}\n- duração: ${String(i['duration'] ?? '?')} s\n- tags: ${Array.isArray(i['tags']) ? (i['tags'] as string[]).slice(0, 15).join(', ') : '—'}\n` +
      `- descrição: ${String(i['description'] ?? '').slice(0, 600).replace(/\n+/g, ' ')}\n` +
      `- quadros-chave (em ordem, abra e OLHE as imagens): ${v.frames.join(', ')}\n- transcrição (${v.transcript ? `transcripts/video${v.idx}.txt` : 'indisponível'}): ${(v.transcript ?? '').slice(0, 2500)}`;
  }).join('\n\n');
  return `Você é o CRIADOR DE SKILLS do FilmForge (estúdio de vídeo por IA orientado a cenas).
Analise os vídeos de referência abaixo — olhe os quadros-chave (arquivos .jpg nesta pasta), leia as transcrições e os metadados — e escreva UMA nova skill no arquivo skill.md desta pasta, no formato EXATO descrito no fim.

${vids}

## O que extrair (o ESTILO, nunca o conteúdo)
- Estrutura: gancho (o que acontece nos primeiros 3–5 s), blocos, clímax, final; duração típica de cada cena e ritmo de cortes.
- Linguagem visual: tipo de imagem (animação 2D/3D, real, código/motion graphics, colagem, stock…), paleta em hex, tipografia e texto na tela, enquadramentos, movimentos de câmera, transições, filtros.
- Áudio: tom e velocidade da narração, uso de música e efeitos, presença de diálogos.
- Proibido: copiar frases, roteiro, personagens, logotipos, marcas ou o assunto específico; a skill deve servir para QUALQUER tema.

## Ângulo do assunto (aplique na skill)
${angles.length ? angles.map((a) => `- ${a.label} — ${a.hint}`).join('\n') : '- Mantenha a abordagem do original.'}
${input.angleNote?.trim() ? `Observação do usuário sobre o ângulo: ${input.angleNote.trim()}` : ''}
Inclua o ângulo nas diretrizes gerais e nas instruções de roteiro e de plano de cenas (como o assunto deve ser abordado).

${skillRules(s, input.language ?? 'pt-BR')}

Os vídeos já foram baixados e analisados pelo app: use SÓ os quadros e as transcrições desta pasta (não baixe nada).
Grave APENAS o arquivo skill.md. Não crie outros arquivos.`;
}

/** Apaga os arquivos baixados: tudo ao criar a skill; só os vídeos se falhar (o resto fica para diagnóstico). */
function cleanup(workdir: string, ok: boolean, log: (l: string) => void) {
  /* os vídeos baixados sempre saem; as métricas (quant.json) e as folhas de quadros ficam como registro da clonagem */
  const target = path.join(workdir, 'videos');
  try { if (fs.existsSync(target)) { fs.rmSync(target, { recursive: true, force: true }); log(ok ? 'arquivos baixados apagados' : 'vídeos baixados apagados'); } }
  catch (e) { log(`não consegui apagar ${target}: ${(e as Error).message}`); }
}

export async function generateSkillFromVideos(s: Settings, input: SkillGenInput, toolsDir: string, log: (l: string) => void, signal?: AbortSignal): Promise<SkillGenResult> {
  const links = input.links.map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x));
  const files = (input.files ?? []).filter((f) => fs.existsSync(f));
  if (!links.length && !files.length) throw new Error('informe ao menos um link (http/https) ou arquivo de vídeo');
  if (links.length + files.length > 5) throw new Error('use no máximo 5 vídeos por skill');
  const workdir = path.join(s.workspace, 'skillgen', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(path.join(workdir, 'transcripts'), { recursive: true });
  let ok = false;
  try {
  const n = Math.max(4, Math.min(16, input.framesPerVideo ?? 10));
  const { id, cfg, model } = await resolveHarness(s, { type: 'harness', harness: input.harness, model: input.model });
  const prepare = (idx: number, src: { url?: string; file?: string }) => prepareReference(s, workdir, idx, src, n, toolsDir, log, signal);
  const videos: VideoRef[] = [];
  const sources: Array<{ url?: string; file?: string }> = [...links.map((u) => ({ url: u })), ...files.map((f) => ({ file: f }))];
  /* números de cada vídeo (medidos no arquivo antes de apagar): fala, cortes, voz × música, efeitos, descrição
     e 1 QUADRO POR SEGUNDO até 5 min (folhas de 12 s) para a arte e para a IA */
  const per: Array<{ metrics?: VideoMetrics; aq?: AudioQuant; dq?: DescQuant; mq?: MotionQuant }> = [];
  const sheets: string[] = [];
  for (const [k, src] of sources.entries()) {
    const idx = k + 1;
    const ref = await prepare(idx, src);
    videos.push(ref);
    const file = src.file ?? (fs.existsSync(path.join(workdir, 'videos')) ? fs.readdirSync(path.join(workdir, 'videos')).filter((f) => f.startsWith(`video${idx}.`) && /\.(mp4|webm|mkv|mov)$/i.test(f)).map((f) => path.join(workdir, 'videos', f))[0] : undefined);
    const item: (typeof per)[number] = { dq: descQuant(String(ref.info['description'] ?? '')) };
    if (file) {
      try { item.metrics = await measureVideo(s.ffmpeg || 'ffmpeg', s.ffprobe || 'ffprobe', file, ref.transcript, signal); } catch (e) { log(`vídeo ${idx}: sem métricas de corte/fala (${(e as Error).message.slice(0, 80)})`); }
      try { item.mq = await motionQuant(s.ffmpeg || 'ffmpeg', file, 300, signal); } catch { /* sem movimento medido */ }
      try { item.aq = await audioQuant(s.ffmpeg || 'ffmpeg', file, readWords(path.join(workdir, 'transcripts', `video${idx}.json`)), signal); } catch { /* sem áudio */ }
      try { sheets.push(...(await frameSheets(s.ffmpeg || 'ffmpeg', file, path.join(workdir, 'sheets', `video${idx}`), 300, signal))); } catch { /* sem folhas */ }
      const m = item.metrics, a = item.aq;
      log(`vídeo ${idx}: ${m ? `${m.wpm ?? '?'} palavras/min, ${m.cutsPerMin} cortes/min` : 'sem métricas'}${a ? ` · voz ${a.speechDb} dBFS · música ${a.musicPresent ? `${a.musicRelDb} dB abaixo` : 'ausente'} · ${a.sfxPerMin} efeitos/min` : ''} · ${sheets.length} folhas a 1 quadro/s`);
    }
    per.push(item);
  }
  /* arte nos quadros-chave inteiros (as folhas têm bordas e etiquetas); duração real pelos metadados */
  const art = await artQuant(s.ffmpeg || 'ffmpeg', videos.flatMap((v) => v.frames.map((f) => path.join(workdir, f))), 32, signal).catch(() => undefined);
  const quant = summarizeQuant(per.map((p, i) => ({ ...p, metrics: p.metrics ? { ...p.metrics, durationSec: Number(videos[i]?.info['duration']) || p.metrics.durationSec } : p.metrics })), art);
  const qText = quantText(quant, 'vídeo(s) de referência');
  fs.writeFileSync(path.join(workdir, 'quant.json'), JSON.stringify(quant, null, 1));
  log(qText);
  const sheetRel = sheets.map((f) => path.relative(workdir, f).replace(/\\/g, '/'));

  // análise pelo provedor com visão
  const mdFile = path.join(workdir, 'skill.md');
  const analyze = async () => {
    log(`analisando com ${id}${model ? '/' + model : ''}…`);
    return runHarness(cfg, { cwd: workdir, prompt: `${buildPrompt(s, input, videos)}

${qText}
FOLHAS A 1 QUADRO POR SEGUNDO (12 s cada, em ordem; leia a arte, o texto na tela e o ritmo): ${sheetRel.slice(0, 25).join(', ')}
${SHOT_COUNT_RULE}
${SOURCE_COUNT_RULE}
${LANG_RULE}
Grave também pauta.json — ${PAUTA_RULE}
Use ESTES números na skill.md — não invente outros.`, model, effort: input.effort, signal: signal ?? new AbortController().signal, onLine: (l) => log(l.slice(0, 300)), timeoutSec: 1800,
      env: id === 'antigravity' ? activeAgyEnv(s) : undefined, tools: { roots: [workdir], allowShell: false },
      images: isHttpHarness(cfg) ? [...sheets.slice(0, 6), ...videos.flatMap((v) => v.frames.filter((_, i) => i % 2 === 0)).slice(0, 6).map((f) => path.join(workdir, f))] : undefined });
  };
  const res = await analyze();
  if (!fs.existsSync(mdFile) && res.stdout.includes('---')) fs.writeFileSync(mdFile, res.stdout.slice(res.stdout.indexOf('---')));
  if (!fs.existsSync(mdFile)) throw new Error(`${id} não gravou skill.md${res.ok ? '' : `: ${res.stderr.slice(-300)}`}`);
  const md = fs.readFileSync(mdFile, 'utf8');
  const sourceNote = `Criada a partir de: ${[...links, ...files.map((f) => path.basename(f))].join(', ')}${input.angles.length ? ` · ângulo: ${input.angles.map((a) => ALL_ANGLES.find((x) => x.id === a)?.label ?? a).join(', ')}` : ''}`;
  const firstFrame = videos[0]?.frames[Math.floor((videos[0]?.frames.length ?? 1) / 2)];
  const fin = finalizeSkillMd(s, md, { name: input.name, language: input.language, sourceNote, preview: firstFrame ? path.join(workdir, firstFrame) : undefined });
  const { route, warnings } = fin;
  /* os números medidos ficam GARANTIDOS nas diretrizes da skill */
  let srcMix: SourceMix | undefined;
  try { srcMix = normalizeSources(JSON.parse(fs.readFileSync(path.join(workdir, 'sources.json'), 'utf8'))); } catch { /* a IA não gravou */ }
  if (srcMix) { log(sourcesText(srcMix)); fs.writeFileSync(path.join(workdir, 'quant.json'), JSON.stringify({ ...quant, sources: srcMix }, null, 1)); } else warnings.push('a IA não gravou sources.json (origem das imagens)');
  const saved = saveSkill(s, { ...fin.skill, global: `${fin.skill.global ?? ''}${srcMix ? `\n- ${sourcesText(srcMix)}` : ''}

${qText}`.trim() });
  const routeReason = /^routeReason:\s*"?(.+?)"?\s*$/m.exec(md)?.[1] ?? '';
  log(`skill "${saved.name}" salva (rota sugerida: ${route.name})`);
  /* idiomas com mais chance de sucesso para o formato (do melhor para o pior) */
  let languages: LanguagePick[] = [];
  try { languages = normalizeLanguages(JSON.parse(fs.readFileSync(path.join(workdir, 'languages.json'), 'utf8')), 5); } catch { /* a IA não gravou */ }
  if (languages.length) log(`idiomas recomendados: ${languages.map((l) => `${l.code} ${l.score}/10`).join(' · ')}`);
  else warnings.push('a IA não gravou languages.json (ranking de idiomas)');
  let pauta: PautaItem[] = [];
  try { pauta = normalizePauta(JSON.parse(fs.readFileSync(path.join(workdir, 'pauta.json'), 'utf8')), 20); } catch { /* a IA não gravou */ }
  if (pauta.length) { fs.writeFileSync(path.join(workdir, 'pauta.md'), pautaMarkdown(pauta, `Pauta — ${saved.name}`), 'utf8'); log(`pauta: ${pauta.length} vídeos (título, sinopse e gancho) em pauta.md`); }
  if (pauta.length < 20) warnings.push(`a IA entregou ${pauta.length} vídeos na pauta (pedido: 20)`);
  if (pauta.length) { try { const n = getDb()?.upsertPauta({ kind: 'video', id: path.basename(workdir), skillId: saved.id, language: input.language }, pauta); if (n) log(`pauta: ${n} vídeos gravados no banco de dados`); } catch (e) { log(`pauta não gravada no banco: ${(e as Error).message}`); } }
  ok = true;
  return { skill: saved, routeId: route.id, routeName: route.name, routeReason, warnings, workdir, quant, languages, pauta, sources: srcMix };
  } finally { cleanup(workdir, ok, log); }
}
