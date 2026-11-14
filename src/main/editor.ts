import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Binding, Project, Route, Scene, Settings } from '../shared/types';
import { bindingLabel } from '../shared/types';
import { resolveApiModel } from '../shared/api-models';
import { resolveHarness, runHarness } from './harness';
import { activeAgyEnv } from './automations';
import * as prov from './providers';
import { addScene, deleteScene, updateScene, type ChangeFlags, type ScenePatch } from './ops';
import { SFX_LIBRARY, autoCues, sfxDef } from './sfx';
import { readWords, wordsDigest, wordsPath } from './whisper';

export interface RewriteResult {
  changed: string[];            // ids de cenas alteradas/criadas
  deleted: string[];
  flags: ChangeFlags;
  summary: string;
  usedBinding: string;
}

/** Extrai o primeiro JSON válido (objeto/array) de um texto livre. */
export function extractJson(text: string): unknown {
  const fenced = prov.stripFences(text);
  for (const cand of [fenced, text]) {
    const start = cand.search(/[[{]/);
    if (start < 0) continue;
    for (let end = cand.length; end > start; end--) {
      const ch = cand[end - 1];
      if (ch !== '}' && ch !== ']') continue;
      try { return JSON.parse(cand.slice(start, end)); } catch { /* tenta menor */ }
    }
  }
  throw new Error('resposta do modelo não contém JSON válido');
}

/** Cadeia de texto (harness/API) com fallback; devolve JSON da resposta. */
export async function llmJson(
  chain: Binding[], settings: Settings, cwd: string, prompt: string, signal: AbortSignal, log: (l: string) => void,
  images: string[] = [],
): Promise<{ json: unknown; binding: string }> {
  let last = 'nenhum executor de texto na rota';
  const refPaths = images.filter((f) => f && fs.existsSync(f));
  const refNote = refPaths.length
    ? `\nImagem(ns) de referência (abra com sua ferramenta de leitura de arquivos): ${refPaths.map((f) => `"${f}"`).join(', ')}.` +
      ` Use-a para criar ALGO SEMELHANTE — mesma silhueta/proporções/paleta/estilo — não uma cópia pixel a pixel.\n`
    : '';
  for (const b of chain) {
    if (signal.aborted) throw new Error('cancelado');
    try {
      if (b.type === 'harness') {
        const { id, cfg, model } = await resolveHarness(settings, b);
        fs.mkdirSync(cwd, { recursive: true });
        const out = path.join(cwd, 'patch.json');
        fs.rmSync(out, { force: true });
        const full = `${prompt}${refNote}\n\nGrave a resposta JSON em ${out} (e também a imprima).`;
        const res = await runHarness(cfg, { cwd, prompt: full, model, effort: b.effort, signal, onLine: log, env: id === 'antigravity' ? activeAgyEnv(settings) : undefined });
        if (!res.ok) throw new Error(`saiu com código ${res.code}: ${res.stderr.slice(-300)}`);
        const raw = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : res.stdout;
        return { json: extractJson(raw), binding: bindingLabel(b) };
      }
      if (b.type === 'api') {
        const p = settings.providers.find((x) => x.id === b.provider);
        if (!p) throw new Error(`provider "${b.provider}" não configurado`);
        return { json: extractJson(await prov.chat(p, resolveApiModel(p, 'text', b.model), `${prompt}${refNote}`, signal, refPaths)), binding: bindingLabel(b) };
      }
    } catch (e) {
      last = `${bindingLabel(b)}: ${(e as Error).message}`;
      log(`falha em ${last}`);
    }
  }
  throw new Error(`nenhum modelo respondeu — ${last}`);
}

const brief = (s: Scene) => ({
  id: s.id, title: s.title, narration: s.narration, visualIntent: s.visualIntent,
  kind: s.kind, durationSec: s.durationSec, camera: s.camera,
});

export interface RewriteOptions {
  settings: Settings; project: Project; projectDir: string; route: Route;
  sceneIds: string[];            // vazio = todas
  instruction: string;
  signal: AbortSignal;
  log: (l: string) => void;
  allowStructure?: boolean;      // permitir inserir/apagar cenas
}

/** Edição por prompt: o modelo devolve patches que são aplicados às cenas. */
export async function rewriteScenes(o: RewriteOptions): Promise<RewriteResult> {
  const p = o.project;
  const ids = o.sceneIds.length ? o.sceneIds : p.scenes.map((s) => s.id);
  const targets = p.scenes.filter((s) => ids.includes(s.id));
  if (targets.length === 0) throw new Error('nenhuma cena selecionada');
  const chain = (o.route.steps.find((s) => s.kind === 'scene_plan') ?? o.route.steps.find((s) => s.kind === 'script'))?.bindings
    .filter((b) => b.type === 'harness' || b.type === 'api') ?? [];

  const prompt = [
    'Você edita as cenas de um vídeo no FilmForge. Responda SOMENTE com JSON.',
    `Idioma do conteúdo: ${p.language}. Formato ${p.aspect}. Tipo: ${p.videoType}.`,
    p.memories.length ? `Regras permanentes:\n${p.memories.map((m) => `- ${m}`).join('\n')}` : '',
    `Todas as cenas (contexto, em ordem):\n${JSON.stringify(p.scenes.map((s) => ({ id: s.id, title: s.title })))}`,
    `Cenas EDITÁVEIS:\n${JSON.stringify(targets.map(brief), null, 1)}`,
    `INSTRUÇÃO DO USUÁRIO: ${o.instruction}`,
    'Formato da resposta:',
    '{"patches":[{"id":"s01","title?":"","narration?":"","visualIntent?":"","kind?":"image|video|code|motion|mixed","durationSec?":0,"camera?":""}]' +
      (o.allowStructure ? ',"insertAfter":[{"afterId":"s01","scene":{"title":"","narration":"","visualIntent":"","kind":"image","durationSec":4}}],"delete":["s05"]' : '') + '}',
    'Inclua em "patches" apenas as cenas que realmente mudam e apenas os campos alterados. Mantenha o idioma e o tom.',
  ].filter(Boolean).join('\n\n');

  const editDir = path.join(o.projectDir, 'edits', String(Date.now()));
  const { json, binding } = await llmJson(chain, o.settings, editDir, prompt, o.signal, o.log);
  const obj = (Array.isArray(json) ? { patches: json } : json) as {
    patches?: Array<ScenePatch & { id: string }>;
    insertAfter?: Array<{ afterId: string | null; scene: ScenePatch }>;
    delete?: string[];
  };

  const flags: ChangeFlags = { visual: false, audio: false };
  const changed = new Set<string>();   // precisam regenerar mídia
  const patched = new Set<string>();   // qualquer campo alterado
  const deleted: string[] = [];
  for (const patch of obj.patches ?? []) {
    if (!patch?.id || !ids.includes(patch.id)) continue;           // ignora ids fora da seleção
    const f = updateScene(p, patch.id, patch);
    patched.add(patch.id);
    flags.visual ||= f.visual; flags.audio ||= f.audio;
    if (f.visual || f.audio) changed.add(patch.id);
  }
  if (o.allowStructure) {
    for (const ins of obj.insertAfter ?? []) {
      const sc = addScene(o.settings, p, ins.afterId ?? null, ins.scene ?? {});
      changed.add(sc.id); patched.add(sc.id); flags.visual = true; flags.audio = true;
    }
    for (const id of obj.delete ?? []) {
      if (ids.includes(id) && p.scenes.some((s) => s.id === id)) { deleteScene(o.settings, p, id); deleted.push(id); }
    }
  }
  return {
    changed: [...changed], deleted, flags, usedBinding: binding,
    summary: `${patched.size} cena(s) alterada(s)${deleted.length ? `, ${deleted.length} removida(s)` : ''} via ${binding}`,
  };
}

/** Etapas que dependem do idioma (refeitas na migração); imagens/vídeos sem texto são mantidos. */
export const LANGUAGE_KINDS = new Set(['narration', 'transcribe', 'sfx', 'code_scene', 'motion_graphics', 'subtitles', 'edit', 'metadata', 'thumbnail', 'review']);

export interface TranslateOptions {
  settings: Settings; project: Project; projectDir: string; route: Route; language: string; languageName: string;
  signal: AbortSignal; log: (l: string) => void;
}

/**
 * Migração de idioma: traduz nome, roteiro (script.md), títulos, narração e legendas das cenas
 * (em lotes, para caber no modelo). Não mexe em visualIntent (os prompts de imagem seguem em inglês).
 */
export async function translateProject(o: TranslateOptions): Promise<{ usedBinding: string; translated: number }> {
  const p = o.project;
  const chain = (o.route.steps.find((s) => s.kind === 'script') ?? o.route.steps.find((s) => s.kind === 'scene_plan'))?.bindings
    .filter((b) => b.type === 'harness' || b.type === 'api') ?? [];
  if (!chain.length) throw new Error('a rota não tem executor de texto para traduzir');
  const dir = path.join(o.projectDir, 'edits', `translate-${Date.now()}`);
  const rules = `Traduza do ${p.language} para ${o.languageName} (${o.language}). Tradução natural e fluente para locução (não literal), mesmo tom e mesmo tamanho aproximado de cada fala, ` +
    'mantendo nomes próprios de personagens. Responda SOMENTE com JSON.';
  let usedBinding = '', translated = 0;
  const ensureScript = path.join(o.projectDir, 'script.md');
  /* nome + roteiro */
  {
    const script = fs.existsSync(ensureScript) ? fs.readFileSync(ensureScript, 'utf8').slice(0, 24000) : '';
    const { json, binding } = await llmJson(chain, o.settings, dir, `${rules}\n\n${JSON.stringify({ name: p.name, script })}\n\nFormato: {"name":"...","script":"... (Markdown, mesma estrutura)"}`, o.signal, o.log);
    usedBinding = binding;
    const j = json as { name?: string; script?: string };
    if (j.name?.trim()) p.name = j.name.trim().slice(0, 120);
    if (script && j.script?.trim()) fs.writeFileSync(ensureScript, j.script, 'utf8');
  }
  /* cenas em lotes de 20 */
  for (let i = 0; i < p.scenes.length; i += 20) {
    const part = p.scenes.slice(i, i + 20);
    const { json } = await llmJson(chain, o.settings, dir, `${rules}\n\nCenas:\n${JSON.stringify(part.map((s) => ({ id: s.id, title: s.title, narration: s.narration, subtitle: s.subtitle || undefined })), null, 1)}\n\n` +
      'Formato: {"scenes":[{"id":"s01","title":"...","narration":"...","subtitle?":"..."}]} — todas as cenas, mesmos ids.', o.signal, o.log);
    const list = (Array.isArray(json) ? json : (json as { scenes?: unknown[] }).scenes ?? []) as Array<{ id: string; title?: string; narration?: string; subtitle?: string }>;
    for (const t of list) {
      const sc = p.scenes.find((x) => x.id === t.id); if (!sc) continue;
      if (typeof t.title === 'string' && t.title.trim()) sc.title = t.title.trim();
      if (typeof t.narration === 'string' && (t.narration.trim() || !sc.narration)) sc.narration = t.narration.trim();
      if (typeof t.subtitle === 'string' && sc.subtitle) sc.subtitle = t.subtitle.trim();
      translated++;
    }
    o.log(`tradução: ${Math.min(p.scenes.length, i + 20)}/${p.scenes.length} cenas`);
  }
  /* efeitos sonoros presos a palavras do idioma antigo passam a tocar no início da cena */
  for (const sc of p.scenes) {
    if (sc.sfx) sc.sfx = sc.sfx.map((x) => x.replace(/:.*$/, ''));
    if (sc.sfxCues) sc.sfxCues = sc.sfxCues.map((c) => ({ name: c.name, at: c.at, gain: c.gain }));
  }
  p.language = o.language;
  for (const sc of p.scenes) for (const st of o.route.steps) if (LANGUAGE_KINDS.has(st.kind) && sc.status[st.id]) sc.status[st.id] = 'stale';
  return { usedBinding, translated };
}

export interface FitSfxOptions {
  settings: Settings; project: Project; projectDir: string; route: Route; sceneIds: string[];
  /** sons pedidos pelo usuário (vazio = a IA escolhe na biblioteca) */
  names?: string[];
  signal: AbortSignal; log: (l: string) => void;
}

/**
 * Efeitos sonoros ajustados ao que ACONTECE na cena: a IA de texto da rota lê o visual, o movimento
 * de câmera, a animação da cena por código (HTML) e os tempos das palavras, e devolve cada som com o
 * instante exato do evento visual. Sem IA disponível, cai na escolha por palavras-chave.
 */
export async function fitSceneSfx(o: FitSfxOptions): Promise<Record<string, string[]>> {
  const p = o.project;
  const scs = p.scenes.filter((s) => o.sceneIds.includes(s.id));
  const names = (o.names ?? []).map((n) => n.split(/[@:]/)[0]!.trim()).filter((n) => sfxDef(n));
  const ctx = scs.map((s) => {
    const dir = path.join(o.projectDir, 'scenes', s.id);
    const words = readWords(wordsPath(dir));
    const html = ['code/scene.html', 'motion/scene.html'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    let anim = '';
    if (html) { const t = fs.readFileSync(html, 'utf8'); anim = (t.match(/<script[\s\S]*?<\/script>/i)?.[0] ?? t).replace(/\s+/g, ' ').slice(0, 2500); }
    return { id: s.id, title: s.title, kind: s.kind, seconds: s.durationSec, narration: s.narration, visual: s.visualIntent, video: s.videoPrompt, camera: s.camera,
      move: s.effects?.zoom, words: words?.words.length ? wordsDigest(words, 30) : undefined, animationCode: anim || undefined, current: s.sfx };
  });
  const lib = SFX_LIBRARY.map((d) => `${d.id} (${d.label}; ${d.tags}; ${d.dur}s)`).join(', ');
  const prompt = [
    'Você é o sonoplasta de um vídeo no FilmForge. Responda SOMENTE com JSON.',
    `Biblioteca de efeitos gerados por código (use só estes nomes): ${lib}.`,
    names.length ? `O usuário pediu ESTES sons: ${names.join(', ')}. Use-os (pode repetir um som se o evento se repete) e só eles.` : 'Escolha de 1 a 3 sons por cena que reforcem o que acontece (sem exagero; cena calma pode ficar sem som).',
    'SINCRONIA COM O VISUAL: identifique os eventos visuais de cada cena (aparição de um objeto, impacto, corte, movimento de câmera, mudança de estado na animação do código, ação descrita no visual) e ponha cada som no instante desse evento, em segundos desde o início da cena. Use os tempos das palavras quando o evento acompanha a fala; no código da animação, leia em que t cada elemento aparece/move.',
    `Cenas:\n${JSON.stringify(ctx, null, 1)}`,
    'Formato: {"scenes":[{"id":"s01","sfx":["impact@1.2","whoosh@0"],"why":"curto"}]} — use "nome@segundos" (ou "nome:palavra" se o evento é exatamente a fala).',
  ].join('\n\n');
  const chain = (o.route.steps.find((s) => s.kind === 'scene_plan') ?? o.route.steps.find((s) => s.kind === 'script'))?.bindings.filter((b) => b.type === 'harness' || b.type === 'api') ?? [];
  const out: Record<string, string[]> = {};
  try {
    if (!chain.length) throw new Error('a rota não tem IA de texto');
    const { json, binding } = await llmJson(chain, o.settings, path.join(o.projectDir, 'edits', `sfx-${Date.now()}`), prompt, o.signal, o.log);
    const list = (Array.isArray(json) ? json : (json as { scenes?: unknown[] }).scenes ?? []) as Array<{ id: string; sfx?: unknown[]; why?: string }>;
    for (const r of list) {
      const sc = scs.find((s) => s.id === r.id); if (!sc || !Array.isArray(r.sfx)) continue;
      out[sc.id] = r.sfx.map(String).filter((x) => sfxDef(x.split(/[@:]/)[0]!) && (!names.length || names.includes(sfxDef(x.split(/[@:]/)[0]!)!.id))).slice(0, 6);
      o.log(`sfx ${sc.id}: ${out[sc.id]!.join(', ') || '(nenhum)'}${r.why ? ` — ${r.why}` : ''}`);
    }
    o.log(`efeitos sincronizados com o visual por ${binding}`);
  } catch (e) { o.log(`IA de sonoplastia indisponível (${(e as Error).message.slice(0, 120)}) — posicionando pelos tempos da fala`); }
  for (const s of scs) {
    if (out[s.id]) continue;
    out[s.id] = names.length ? names.map((n, i) => (i === 0 ? n : `${n}@${(((s.durationSec ?? 4) * i) / names.length).toFixed(1)}`)) : autoCues(s).map((c) => `${c.name}@${c.at ?? 0}`);
  }
  return out;
}
