import type { Aspect, FxFilter, FxTexture, FxTransition, MixSource, RefEditRhythm, Route, RouteStep, Skill, VideoTypeId } from './types';

/*
 * ASSISTENTE DE SKILL + ROTA (catálogo, Parte LI): 13 telas, UM estado — o contrato da skill — e uma gravação no fim.
 * Este módulo é puro (renderer e main): estado → Skill + rota + avisos + custo + SKILL.md de prévia.
 */
export const GEN_SOURCES = ['mixed', 'code', 'motion', 'library', 'image', 'video', 'existing'] as const;
export type GenSource = typeof GEN_SOURCES[number];
export const GEN_LABEL: Record<GenSource, string> = {
  mixed: '🧩 Misto (banco de imagens/vídeos)', code: '💻 Cena por código', motion: '📊 Motion graphics', library: '📚 Biblioteca (personagens/cenários)',
  image: '🖼️ Imagens IA', video: '🎬 Vídeo IA', existing: '📁 Mídia existente (sua pasta)',
};
export interface TextProfile { person?: string; wordsPerSentence?: number; tone?: string; structure?: string; excerpt?: string }
export interface TitleSpec { length?: [number, number]; number?: boolean; caps?: 'normal' | 'upper' | 'title'; emoji?: boolean; hook?: string; variants?: string[] }
export interface ThumbSpec { composition?: string; palette?: string[]; text?: string; safeZone?: string }
export interface WizardRef { file: string; kind: 'code' | 'image' | 'video'; note?: string; sha?: string; palette?: string[]; rhythm?: RefEditRhythm; duration?: number }

export interface SkillWizardState {
  /* 1 */ name: string; description: string;
  /* 2 */ startFrom?: string; startRouteId?: string; aspect: Aspect; durationSec: number; language: string; appearance: VideoTypeId; gen: Partial<Record<GenSource, number>>;
  /* 3 */ voice: { mode: 'narration' | 'dialogue' | 'mixed' | 'none'; narrationPct: number; tone: string; voiceRef?: string; provider?: string };
  /* 4 */ music: { mode: 'generate' | 'lyric' | 'clip' | 'none'; style: string; maxTracks: number; lyricsSource: 'prompt' | 'txt' | 'audio'; lyrics?: string; volumePct: number };
  /* 5 */ lipsync: { on: boolean; faceRef?: string }; system: string;
  /* 6 */ textStyle: { prompt: string; txtFile?: string; profile?: TextProfile; freeze: boolean };
  /* 7 */ title: { example: string; prompt: string; spec?: TitleSpec };
  /* 8 */ thumb: { prompt: string; image?: string; spec?: ThumbSpec; production: 'generator' | 'html' | 'reuse' };
  /* 9 */ refs: WizardRef[]; promptPrefix: string;
  /* 10 */ cut: { granularity: '1s' | '0.5s' | 'frame'; video?: string; rhythm?: RefEditRhythm; cameras?: string };
  /* 11 */ media: { dir?: string; noRepeatAcross: boolean; kinds: Array<'image' | 'video'>; count?: { image: number; video: number; duplicates: number } };
  /* 12 */ edit: { transition: FxTransition; transitionSec: number; subtitles: 'off' | 'srt' | 'burn'; lufs: number; filter: FxFilter; texture: FxTexture; prompt: string };
  /* 13 */ routeId?: string;
}

export function emptyWizard(): SkillWizardState {
  return {
    name: '', description: '', aspect: '16:9', durationSec: 60, language: 'pt-BR', appearance: 'custom', gen: { image: 100 },
    voice: { mode: 'narration', narrationPct: 100, tone: '' },
    music: { mode: 'generate', style: '', maxTracks: 1, lyricsSource: 'prompt', volumePct: 10 },
    lipsync: { on: false }, system: '',
    textStyle: { prompt: '', freeze: false }, title: { example: '', prompt: '' }, thumb: { prompt: '', production: 'generator' },
    refs: [], promptPrefix: '', cut: { granularity: '1s' },
    media: { noRepeatAcross: false, kinds: ['image', 'video'] },
    edit: { transition: 'fade', transitionSec: 0.5, subtitles: 'burn', lufs: -14, filter: 'none', texture: 'none', prompt: '' },
  };
}

export const MIN_DESCRIPTION = 80;
export const TOTAL_STEPS = 13;
export const STEP_TITLES = ['Descrição', 'Geração e misto', 'Voz e diálogos', 'Trilha e letra', 'Lipsync e system prompt', 'Estilo do texto', 'Título', 'Thumbnail',
  'Referências', 'Decupagem do vídeo', 'Pasta de mídia', 'Edição', 'Revisão e custo'];

const sum = (o: Partial<Record<string, number>>) => Object.values(o).reduce<number>((a, b) => a + (Number(b) || 0), 0);
export const genSources = (s: SkillWizardState): GenSource[] => GEN_SOURCES.filter((k) => (s.gen[k] ?? 0) > 0);

/** Travas por tela (o "Avançar" fica desligado enquanto houver erro). */
export function stepErrors(s: SkillWizardState, step: number): string[] {
  const e: string[] = [];
  if (step === 1) {
    if (!s.name.trim()) e.push('Dê um nome à skill.');
    if (s.description.trim().length < MIN_DESCRIPTION) e.push(`A descrição é obrigatória e precisa de pelo menos ${MIN_DESCRIPTION} caracteres (tem ${s.description.trim().length}).`);
  }
  if (step === 2) {
    if (!genSources(s).length) e.push('Escolha pelo menos uma fonte de geração.');
    if (Math.round(sum(s.gen)) !== 100) e.push(`Os pesos da geração precisam somar 100% (somam ${Math.round(sum(s.gen))}%).`);
    if (!(s.durationSec >= 5)) e.push('Duração mínima de 5 s.');
  }
  if (step === 3 && s.voice.mode === 'mixed' && (s.voice.narrationPct <= 0 || s.voice.narrationPct >= 100)) e.push('No modo misto, narração e diálogos dividem 100% (ex.: 60/40).');
  if (step === 4 && s.music.mode !== 'none' && !(s.music.maxTracks >= 1 && s.music.maxTracks <= 20)) e.push('Limite de faixas entre 1 e 20.');
  if (step === 5 && s.lipsync.on && !s.lipsync.faceRef) e.push('Lipsync ligado exige uma imagem de rosto de referência.');
  if (step === 11 && s.gen.existing && !s.media.dir) e.push('A geração usa "mídia existente": escolha a pasta.');
  return e;
}
export function allErrors(s: SkillWizardState): string[] {
  return Array.from({ length: TOTAL_STEPS - 1 }, (_, i) => stepErrors(s, i + 1)).flat();
}

/** Etapas que a rota precisa ter para a skill funcionar. */
export function neededKinds(s: SkillWizardState): string[] {
  const k = new Set<string>(['script', 'scene_plan', 'edit']);
  for (const g of genSources(s)) {
    if (g === 'code') k.add('code_scene');
    if (g === 'motion') k.add('code_scene');
    if (g === 'image' || g === 'library') k.add('image');
    if (g === 'video') { k.add('image'); k.add('video'); }
    if (g === 'mixed') k.add('stock_media');
    if (g === 'existing') k.add(s.media.kinds.includes('video') ? 'video' : 'image');
  }
  if (s.voice.mode !== 'none') k.add('narration');
  if (s.music.mode !== 'none') k.add('music');
  if (s.edit.subtitles !== 'off') k.add('subtitles');
  if (s.title.example || s.title.prompt) k.add('metadata');
  if (s.thumb.prompt || s.thumb.image) k.add('thumbnail');
  return [...k];
}
const routeKinds = (r: Route) => new Set(r.steps.filter((x) => x.enabled !== false).map((x) => x.kind as string));
const usesTool = (r: Route, tool: string) => r.steps.some((x) => x.bindings.some((b) => b.type === 'builtin' && (b as { tool?: string }).tool === tool));

const SPECIAL_ROUTE = /podcast|cortes|ugc|natal|natalina|viggle|remake|avatar|jogos|lipsync|tutorial|microdrama|dorama|clone|shorts-autopilot|lista|react|pip/i;
/** Rota sugerida: a que cobre mais etapas pedidas e menos etapas sobrando; canção com letra pede lyric-song. */
export function suggestRoute(s: SkillWizardState, routes: Route[]): { route?: Route; missing: string[] } {
  const need = neededKinds(s);
  let best: Route | undefined, bs = -Infinity;
  for (const r of routes) {
    const ks = routeKinds(r);
    if (ks.has('free')) continue;
    let sc = need.filter((k) => ks.has(k)).length * 3 - [...ks].filter((k) => !need.includes(k) && !['review', 'metadata', 'thumbnail', 'transcribe', 'asset_design', 'sfx', 'stock_media'].includes(k)).length;
    if (s.music.mode === 'lyric' || s.music.mode === 'clip') sc += usesTool(r, 'lyric-song') ? 6 : -4; else if (usesTool(r, 'lyric-song')) sc -= 6;
    if (s.voice.mode === 'none' && ks.has('narration')) sc -= 2;
    /* rotas de formato específico (podcast, cortes, UGC, Natal…) só quando a skill de partida usa a mesma */
    if (SPECIAL_ROUTE.test(`${r.id} ${r.name}`)) sc -= 8;
    if (s.startFrom && s.startRouteId === r.id) sc += 12;
    if (sc > bs) { bs = sc; best = r; }
  }
  const ks = best ? routeKinds(best) : new Set<string>();
  return { route: best, missing: need.filter((k) => !ks.has(k)) };
}

/** Estimativa ANTES de gravar: cenas, chamadas e minutos — com 30% de retentativas (custo otimista é custo errado). */
export function estimateCost(s: SkillWizardState, route?: Route): { scenes: number; calls: number; minutes: number; note: string } {
  const shot = s.cut.rhythm?.shotSec && s.cut.rhythm.shotSec > 0 ? Math.max(2, s.cut.rhythm.shotSec) : genSources(s).includes('video') ? 6 : 5;
  const scenes = Math.max(1, Math.round(s.durationSec / shot));
  const kinds = route ? routeKinds(route) : new Set(neededKinds(s));
  const perScene = (['image', 'video', 'narration', 'code_scene'] as const).filter((k) => kinds.has(k)).length + (s.lipsync.on ? 1 : 0);
  const project = 3 + (kinds.has('music') ? 1 : 0) + (kinds.has('thumbnail') ? 1 : 0) + (kinds.has('metadata') ? 1 : 0);
  const raw = scenes * perScene + project;
  const calls = Math.ceil(raw * 1.3);
  const min = scenes * ((kinds.has('video') ? 2.5 : 0) + (kinds.has('image') ? 0.4 : 0) + (kinds.has('narration') ? 0.2 : 0) + (kinds.has('code_scene') ? 1 : 0) + (s.lipsync.on ? 2 : 0)) + project * 0.6;
  return { scenes, calls, minutes: Math.ceil(min * 1.3), note: `${scenes} cena(s) de ~${shot} s · ${raw} chamadas + 30% de retentativas` };
}

const pct = (n?: number) => `${Math.round(n ?? 0)}%`;
const line = (...xs: Array<string | false | undefined>) => xs.filter(Boolean).join(' ');

/** Estado → Skill (campos do contrato). Os caminhos de referência entram como vieram (o main troca por cópias com hash). */
export function buildSkill(s: SkillWizardState, routeId?: string): Skill {
  const src = genSources(s);
  const mixSources = [...new Set(src.flatMap((g): MixSource[] => g === 'motion' || g === 'code' ? ['motion'] : g === 'mixed' || g === 'existing' ? ['stock'] : g === 'video' ? ['ai'] : []))];
  const kindsText = src.map((g) => `${GEN_LABEL[g].replace(/^\S+\s/, '')} ${pct(s.gen[g])}`).join(' · ');
  const dialog = s.voice.mode === 'dialogue' || s.voice.mode === 'mixed';
  const tp = s.textStyle.profile;
  const ts = s.title.spec;
  const th = s.thumb.spec;
  const rh = s.cut.rhythm ?? s.refs.find((r) => r.rhythm)?.rhythm;
  const imgRefs = s.refs.filter((r) => r.kind === 'image'), vidRefs = s.refs.filter((r) => r.kind === 'video'), codeRefs = s.refs.filter((r) => r.kind === 'code');
  const palette = [...new Set(imgRefs.flatMap((r) => r.palette ?? []))].slice(0, 6);
  const global = [
    `DIRETRIZES BÁSICAS (escritas pelo autor da skill, valem para todas as etapas): ${s.description.trim()}`,
    `GERAÇÃO: ${kindsText}${src.length > 1 ? ' — distribua os tipos de cena nessas proporções' : ''}.`,
    s.voice.mode === 'none' ? 'SEM VOZ: nenhuma narração nem diálogo.' : s.voice.mode === 'narration' ? `NARRAÇÃO em off${s.voice.tone ? `, tom: ${s.voice.tone}` : ''}.` :
      s.voice.mode === 'dialogue' ? `DIÁLOGOS entre personagens (formato "NOME: fala")${s.voice.tone ? `, tom: ${s.voice.tone}` : ''}.` :
      `NARRAÇÃO ${s.voice.narrationPct}% e DIÁLOGOS ${100 - s.voice.narrationPct}% (diálogos no formato "NOME: fala")${s.voice.tone ? `, tom: ${s.voice.tone}` : ''}.`,
    s.music.mode === 'none' ? 'SEM MÚSICA.' : s.music.mode === 'generate' ? `TRILHA${s.music.style ? `: ${s.music.style}` : ''}, no máximo ${s.music.maxTracks} faixa(s), a ${s.music.volumePct}% sob a voz (nunca disputa com a fala).`
      : `CANÇÃO COM LETRA${s.music.style ? ` (${s.music.style})` : ''}: a música conduz a edição${s.music.mode === 'clip' ? ' — clipe musical, cortes na batida' : ''}.`,
    s.lipsync.on && 'LIPSYNC nas falas marcadas, sempre com o rosto de referência da bíblia. Conteúdo sintético: rótulo de IA obrigatório.',
    s.system.trim() && `SYSTEM PROMPT (regras que valem sempre): ${s.system.trim()}`,
    (s.textStyle.prompt || tp) && line('ESTILO DO TEXTO:', s.textStyle.prompt.trim(), tp && `Perfil medido: ${[tp.person, tp.wordsPerSentence && `${tp.wordsPerSentence} palavras por frase`, tp.tone, tp.structure].filter(Boolean).join(', ')}.`, s.textStyle.freeze && 'Bíblia de estilo CONGELADA: não mude a voz do texto entre episódios.'),
    palette.length > 0 && `PALETA das referências: ${palette.join(', ')}.`,
  ].filter(Boolean).join('\n');
  const steps: Record<string, string> = {};
  steps['script'] = line(
    s.voice.mode === 'none' ? 'Sem narração: escreva só a progressão visual.' : dialog ? 'Falas no formato "NOME: fala", uma por linha.' : 'Narração contínua, frases curtas e faladas.',
    tp?.excerpt && `Imite o estilo deste trecho de referência (não copie o conteúdo): """${tp.excerpt.slice(0, 900)}"""`,
    s.music.mode === 'lyric' || s.music.mode === 'clip' ? `Escreva TITLE / STYLE / LYRICS da canção${s.music.lyrics ? ` usando esta letra: """${s.music.lyrics.slice(0, 1500)}"""` : ''}.` : '');
  steps['scene_plan'] = line(
    src.length > 1 ? `Tipos de cena nas proporções: ${kindsText}.` : `Todas as cenas do tipo ${src[0] === 'video' ? '"video"' : src[0] === 'code' || src[0] === 'motion' ? '"code"' : src[0] === 'mixed' ? '"stock"' : '"image"'}.`,
    rh && `Ritmo da referência: plano médio ≈ ${rh.shotSec} s (${rh.cutsPerMin} cortes/min), ${rh.transition === 'none' ? 'cortes secos' : rh.transition === 'fadeblack' ? 'fades para o preto' : 'fusões suaves'}.`,
    s.cut.cameras && `Sequência de câmeras: ${s.cut.cameras}.`,
    s.music.mode === 'clip' && 'Cortes na batida da música (o app encaixa no beat).');
  if (src.includes('image') || src.includes('video') || src.includes('library')) steps['image'] = line('Quadro 16:9/9:16 conforme o projeto, sem texto na imagem.', imgRefs.length > 0 && `Mantenha identidade e paleta das imagens de referência: ${imgRefs.map((r) => r.file).join('; ')}.`);
  if (src.includes('video')) steps['video'] = line('Uma tomada contínua por cena, câmera estável.', vidRefs.length > 0 && `Movimento e câmera como nos vídeos de referência (o áudio deles não entra): ${vidRefs.map((r) => r.file).join('; ')}.`, s.lipsync.on && 'Falas com lipsync usam o rosto de referência.');
  if (src.includes('code') || src.includes('motion')) steps['code_scene'] = line('Cena por código com window.__forge.seek(t), 30 fps, cores da bíblia.', codeRefs.length > 0 && `Siga a estrutura destes arquivos de referência: ${codeRefs.map((r) => r.file).join('; ')}.`);
  if (s.voice.mode !== 'none') steps['narration'] = line(s.voice.tone && `Tom: ${s.voice.tone}.`, s.voice.voiceRef && `Voz de referência: ${s.voice.voiceRef}.`);
  if (s.music.mode !== 'none') steps['music'] = line(s.music.style || 'Trilha discreta no clima da skill.', `No máximo ${s.music.maxTracks} faixa(s); master -14 LUFS.`);
  steps['edit'] = line(`Transição ${s.edit.transition}${s.edit.transition !== 'none' ? ` de ${s.edit.transitionSec} s` : ''}; master ${s.edit.lufs} LUFS.`,
    s.edit.filter !== 'none' && `Filtro ${s.edit.filter} em todas as cenas.`, s.edit.texture !== 'none' && `Textura ${s.edit.texture}.`, s.edit.prompt.trim());
  if (s.title.example || s.title.prompt || ts) steps['metadata'] = line('TÍTULO:', s.title.prompt.trim(), s.title.example && `Siga o padrão deste título de exemplo (não copie): "${s.title.example}".`,
    ts && [ts.length && `${ts.length[0]}–${ts.length[1]} caracteres`, ts.number && 'com número', ts.caps === 'upper' ? 'em CAIXA ALTA' : ts.caps === 'title' ? 'Com Iniciais Maiúsculas' : '', ts.emoji === false ? 'sem emoji' : ts.emoji ? 'com 1 emoji' : '', ts.hook && `gancho: ${ts.hook}`].filter(Boolean).join(', '),
    'O título não promete o que o vídeo não mostra.');
  if (s.thumb.prompt || s.thumb.image || th) steps['thumbnail'] = line(s.thumb.prompt.trim(), th && [th.composition, th.palette?.length && `paleta ${th.palette.join(', ')}`, th.text, th.safeZone && `zona segura ${th.safeZone}`].filter(Boolean).join('; '),
    s.thumb.image && `Referência visual: ${s.thumb.image}.`, s.thumb.production === 'html' ? 'Produza por HTML/canvas determinístico.' : s.thumb.production === 'reuse' ? 'Reuse a imagem de referência como base.' : '', 'Título e thumbnail contam a mesma história. 1280×720.');
  const review = [`${s.aspect}, ${s.durationSec} s`, `respeita o público e o tom da descrição`, s.voice.mode === 'none' ? 'sem voz' : dialog ? 'diálogos com "NOME: fala"' : 'narração clara',
    s.music.mode !== 'none' && `música a ${s.music.volumePct}% sob a voz, ≤ ${s.music.maxTracks} faixa(s)`, s.edit.subtitles === 'burn' && 'legenda legível', `master ${s.edit.lufs} LUFS`, s.lipsync.on && 'lipsync só nas falas marcadas, mesmo rosto'].filter(Boolean).join('; ');
  return {
    id: '', name: s.name.trim(), description: s.description.trim().replace(/\s+/g, ' ').slice(0, 400), global, steps,
    appearance: s.appearance, routeId, aspect: s.aspect, durationSec: Math.round(s.durationSec), language: s.language,
    presentation: src.length > 1 || src.includes('mixed') ? 'mixed' : 'generated', mediaSources: src.includes('mixed') ? ['pexels', 'pixabay'] as never : [],
    mixSources: mixSources.length ? mixSources : undefined, multiVoice: dialog || undefined, musicVideo: s.music.mode === 'clip' || undefined,
    promptPrefix: s.promptPrefix.trim() || undefined,
    refImages: imgRefs.length ? imgRefs.map((r) => r.file).slice(0, 10) : undefined,
    reviewCriteria: review,
    outputStyle: [`📐 ${s.aspect} · ⏱ ${s.durationSec} s`, kindsText, s.voice.mode === 'none' ? '🔇 sem voz' : dialog ? '🎭 diálogos' : '🎙 narração', s.music.mode === 'none' ? '' : s.music.mode === 'generate' ? '🎵 trilha' : '🎤 canção com letra', s.edit.subtitles === 'burn' ? '💬 legenda' : ''].filter(Boolean).join(' · '),
  };
}

/** Rota da skill: a base com a pasta de mídia na frente das etapas de imagem/vídeo e os parâmetros da edição. Sem mudança = usa a base. */
export function buildRoute(s: SkillWizardState, base: Route, bankId?: string): Route | undefined {
  const changed = !!bankId || s.edit.transition !== 'fade' || s.edit.filter !== 'none' || s.edit.texture !== 'none' || s.edit.lufs !== -14 || !!s.cut.rhythm;
  if (!changed) return undefined;
  const steps: RouteStep[] = base.steps.map((st) => {
    const x: RouteStep = JSON.parse(JSON.stringify(st));
    if (bankId && (x.kind === 'image' || x.kind === 'video') && s.media.kinds.includes(x.kind)) x.bindings = [{ type: 'builtin', tool: 'media-folder', bank: bankId } as never, ...x.bindings];
    if (x.kind === 'edit') x.params = { ...(x.params ?? {}), defaultTransition: s.edit.transition, transitionSec: s.edit.transitionSec, lufs: s.edit.lufs,
      ...(s.edit.filter !== 'none' ? { defaultFilter: s.edit.filter } : {}), ...(s.edit.texture !== 'none' ? { defaultTexture: s.edit.texture } : {}) };
    return x;
  });
  return { ...base, id: '', name: `${s.name.trim()} (rota)`, description: `Rota da skill "${s.name.trim()}" — base: ${base.name}`, steps };
}

/** SKILL.md de prévia (o diff antes de gravar). */
export function skillMarkdown(k: Skill, routeName?: string): string {
  const fm = [`name: ${k.name}`, `description: "${k.description.replace(/"/g, "'")}"`, `appearance: ${k.appearance}`, `routeId: ${routeName ?? k.routeId ?? '—'}`,
    `aspect: "${k.aspect}" · durationSec: ${k.durationSec} · language: ${k.language}`, `presentation: ${k.presentation}${k.mixSources?.length ? ` · mixSources: [${k.mixSources.join(', ')}]` : ''}`,
    `multiVoice: ${!!k.multiVoice} · musicVideo: ${!!k.musicVideo}`, k.promptPrefix ? `promptPrefix: "${k.promptPrefix}"` : '', `outputStyle: ${k.outputStyle}`, `reviewCriteria: ${k.reviewCriteria}`].filter(Boolean);
  return `---\n${fm.join('\n')}\n---\n\n## Global\n${k.global}\n\n${Object.entries(k.steps).map(([id, t]) => `## Etapa: ${id}\n${t}`).join('\n\n')}\n`;
}

/** Roteiro/.txt de referência → perfil do texto (pessoa, tamanho de frase, tom, estrutura). Função pura. */
export function textProfile(text: string): TextProfile {
  const t = text.replace(/\r/g, '').trim();
  const sentences = t.split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 2);
  const words = t.split(/\s+/).filter(Boolean);
  const low = ` ${t.toLowerCase()} `;
  const count = (re: RegExp) => (low.match(re) ?? []).length;
  const first = count(/\s(eu|meu|minha|me|comigo|i|my|me)\s/g), second = count(/\s(você|vocês|seu|sua|te|you|your)\s/g), third = count(/\s(ele|ela|eles|elas|he|she|they)\s/g);
  const person = first >= second && first >= third && first > 0 ? '1ª pessoa' : second >= third && second > 0 ? 'fala direto com o público (você)' : '3ª pessoa';
  const q = (t.match(/\?/g) ?? []).length, ex = (t.match(/!/g) ?? []).length;
  const tone = q > sentences.length * 0.25 ? 'perguntas retóricas frequentes' : ex > sentences.length * 0.2 ? 'enérgico, exclamativo' : 'contido';
  const paras = t.split(/\n\s*\n/).filter((p) => p.trim()).length;
  return {
    person, wordsPerSentence: sentences.length ? Math.round(words.length / sentences.length) : undefined, tone,
    structure: paras > 1 ? `${paras} blocos` : sentences.length > 1 ? `${sentences.length} frases` : undefined,
    excerpt: t.slice(0, 1200),
  };
}

/** Título de exemplo → titleSpec (tamanho, número, caixa, emoji, gancho) + 3 variantes no mesmo padrão. Função pura. */
export function titleSpec(example: string): TitleSpec {
  const t = example.trim();
  if (!t) return {};
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const upper = letters.length > 3 && letters === letters.toUpperCase();
  const words = t.split(/\s+/);
  const titleCase = !upper && words.filter((w) => /^[A-Za-zÀ-ÿ]/.test(w) && w.length > 3).every((w) => w[0] === w[0]!.toUpperCase());
  const emoji = /\p{Extended_Pictographic}/u.test(t);
  const number = /\d/.test(t);
  const n = t.length;
  const hook = /\?$/.test(t) ? 'pergunta' : /^(como|por que|porque|o que|why|how|what)\b/i.test(t) ? 'promessa de explicação' : /!$/.test(t) ? 'exclamação' : number ? 'lista/número' : 'afirmação forte';
  const base = t.replace(/\p{Extended_Pictographic}/gu, '').trim();
  const variants = [
    number ? base.replace(/\d+/, (m) => String(Number(m) + 2)) : `${words.length > 3 ? words.slice(0, 3).join(' ') : base}: o que ninguém conta`,
    hook === 'pergunta' ? base.replace(/\?$/, '') + ' (a resposta surpreende)' : `Por que ${base.charAt(0).toLowerCase()}${base.slice(1)}?`,
    `${base} — a história completa`,
  ].map((v) => (upper ? v.toUpperCase() : v));
  return { length: [Math.max(20, n - 10), n + 10], number, caps: upper ? 'upper' : titleCase ? 'title' : 'normal', emoji, hook, variants };
}
