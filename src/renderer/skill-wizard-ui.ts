import type { Aspect, FxFilter, FxTexture, FxTransition, Route, Skill, VideoTypeId } from '../shared/types';
import { checkSkillRoute } from '../shared/compat';
import {
  GEN_LABEL, GEN_SOURCES, MIN_DESCRIPTION, STEP_TITLES, TOTAL_STEPS, buildRoute, buildSkill, emptyWizard, estimateCost, genSources, skillMarkdown, stepErrors, suggestRoute,
  type GenSource, type SkillWizardState, type WizardRef,
} from '../shared/skill-wizard';
import type { Ctx } from './library-ui';

/*
 * ASSISTENTE DE SKILL + ROTA (catálogo, Parte LI): 13 telas, um estado, uma gravação.
 * Voltar nunca perde resposta; "Avançar" só trava pelo obrigatório da tela; nada é escrito antes do botão final.
 */
const DRAFT_KEY = 'forge.skillWizard.draft';
const LANGS: Array<[string, string]> = [['pt-BR', 'Português (Brasil)'], ['pt-PT', 'Português (Portugal)'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Español'], ['es-MX', 'Español (México)'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['it-IT', 'Italiano'], ['ja-JP', '日本語']];
const ASPECTS: Array<[Aspect, string]> = [['16:9', '16:9 · YouTube'], ['9:16', '9:16 · Shorts/Reels'], ['1:1', '1:1 · Quadrado'], ['4:5', '4:5 · Feed']];
const TRANSITIONS: FxTransition[] = ['none', 'fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideup', 'circleopen', 'circleclose', 'radial', 'pixelize', 'zoomin', 'hblur'];
const FILTERS: FxFilter[] = ['none', 'cinematic', 'teal_orange', 'vivid', 'warm', 'cool', 'vintage', 'technicolor', 'technicolor_faded', 'noir', 'bw', 'sepia', 'matte', 'dramatic'];
const TEXTURES: FxTexture[] = ['none', 'film_scratches', 'old_film', 'dust', 'vhs', 'crt', 'static', 'glitch', 'paper'];

export async function openSkillWizard(c: Ctx, onDone: (k: Skill) => void): Promise<void> {
  const { h, forge, toast } = c;
  const meta = (await forge['meta']()) as { videoTypes: Array<{ id: string; label: string; sceneKind?: string }> };
  const routes = ((await forge['listRoutes']()) as Route[]).filter((r) => !r.steps.some((s) => s.kind === 'free'));
  const skills = (await forge['listSkills']()) as Skill[];
  let st: SkillWizardState = emptyWizard();
  try { const d = localStorage.getItem(DRAFT_KEY); if (d) st = { ...st, ...JSON.parse(d) }; } catch { /* sem rascunho */ }
  let step = 1, seen = 1;
  const save = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(st)); } catch { /* sem storage */ } };

  const body = h('div', { class: 'wiz-body', id: 'wiz-body' });
  const dots = h('div', { class: 'wiz-steps', id: 'wiz-steps' });
  const errs = h('div', { class: 'wiz-errs', id: 'wiz-errs' });
  const back = h('button', { id: 'wiz-back', onclick: () => { if (step > 1) { step--; paint(); } } }, '← Voltar') as HTMLButtonElement;
  const next = h('button', { class: 'primary', id: 'wiz-next', onclick: () => { if (!stepErrors(st, step).length && step < TOTAL_STEPS) { step++; seen = Math.max(seen, step); paint(); } } }, 'Avançar →') as HTMLButtonElement;
  const bg = h('div', { class: 'modal-bg', id: 'skill-wizard' }, h('div', { class: 'modal pmodal wiz' },
    h('div', { class: 'row' }, h('h3', {}, '🧭 Assistente de skill + rota'), h('span', { class: 'sp' }),
      h('button', { class: 'small', title: 'Apagar o rascunho e começar de novo', onclick: () => { st = emptyWizard(); step = 1; seen = 1; save(); paint(); } }, '↺ Recomeçar'),
      h('button', { title: 'Fechar (o rascunho fica guardado)', onclick: () => bg.remove() }, '✕')),
    dots, body, errs, h('div', { class: 'row actions pfoot' }, back, h('span', { class: 'sp' }), next)));
  document.body.append(bg);

  /* ── componentes ── */
  const field = (label: string, el: HTMLElement, hint?: string) => h('label', { class: 'wiz-field' }, h('span', {}, label), el, hint ? h('span', { class: 'muted small' }, hint) : null);
  const input = (id: string, value: string, on: (v: string) => void, attrs: Record<string, string> = {}) => {
    const el = h('input', { id, ...attrs }) as HTMLInputElement; el.value = value;
    el.addEventListener('input', () => { on(el.value); save(); check(); }); return el;
  };
  const num = (id: string, value: number, on: (v: number) => void, attrs: Record<string, string> = {}) => input(id, String(value), (v) => on(Number(v) || 0), { type: 'number', class: 'num', ...attrs });
  const area = (id: string, value: string, on: (v: string) => void, rows = 4, ph = '') => {
    const el = h('textarea', { id, rows: String(rows), placeholder: ph }) as HTMLTextAreaElement; el.value = value;
    el.addEventListener('input', () => { on(el.value); save(); check(); }); return el;
  };
  const select = (id: string, opts: Array<[string, string]>, value: string, on: (v: string) => void) => {
    const el = h('select', { id }, ...opts.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement; el.value = value;
    el.addEventListener('change', () => { on(el.value); save(); paint(); }); return el;
  };
  const check1 = (id: string, value: boolean, label: string, on: (v: boolean) => void) => {
    const el = h('input', { type: 'checkbox', id }) as HTMLInputElement; el.checked = value;
    el.addEventListener('change', () => { on(el.checked); save(); paint(); }); return h('label', { class: 'inline chk' }, el, label);
  };
  const pick = async (title: string, ext: string[], name = 'Arquivos') => (await forge['openFile']({ title, filters: [{ name, extensions: ext }] })) as string | null;
  const base = (f?: string) => (f ? f.split(/[\\/]/).pop() ?? f : '');
  const analyze = async (input: Record<string, unknown>) => { try { return (await forge['wizardAnalyze'](input)) as Record<string, unknown>; } catch (e) { toast(`análise: ${(e as Error).message}`, true); return undefined; } };
  const swatches = (cols?: string[]) => h('span', { class: 'wiz-swatches' }, ...(cols ?? []).map((x) => h('span', { class: 'wiz-sw', style: `background:${x}`, title: x })));
  const info = (...t: Array<string | HTMLElement>) => h('div', { class: 'muted wiz-info' }, ...t);

  function check() {
    const e = stepErrors(st, step);
    errs.replaceChildren(...e.map((x) => h('span', { class: 'tag failed' }, '⛔ ' + x)));
    next.disabled = e.length > 0 || step === TOTAL_STEPS;
    next.style.display = step === TOTAL_STEPS ? 'none' : '';
    back.disabled = step === 1;
  }

  /* ── telas ── */
  const screens: Record<number, () => Array<HTMLElement | null | false | undefined | 0>> = {
    1: () => [
      info('A descrição é a diretriz básica que TODAS as etapas consultam (roteiro, plano de cenas, revisão). Gênero, público, tom, idioma e restrições — mínimo de ', String(MIN_DESCRIPTION), ' caracteres.'),
      field('Nome da skill', input('wiz-name', st.name, (v) => { st.name = v; }, { placeholder: 'Ex.: Curiosidades de história em 60 s', class: 'grow' })),
      field('Descrição (obrigatória)', area('wiz-desc', st.description, (v) => { st.description = v; if (cnt) cnt.textContent = `${v.trim().length}/${MIN_DESCRIPTION}`; }, 6,
        'Ex.: Vídeos curtos de curiosidades históricas para jovens de 16 a 30 anos, tom de conversa com humor leve, narrador em 1ª pessoa, sem violência gráfica, sempre fecha com uma pergunta ao público.')),
      (() => { const el = h('span', { class: 'muted', id: 'wiz-desc-count' }, `${st.description.trim().length}/${MIN_DESCRIPTION}`); cnt = el; return el; })(),
    ],
    2: () => {
      const total = GEN_SOURCES.reduce((a, g) => a + (st.gen[g] ?? 0), 0);
      return [
        info('Sete fontes. No misto, a régua tem de somar 100% — cada fonte vira uma etapa da rota e o percentual vira proporção no plano de cenas.'),
        h('div', { class: 'row' },
          field('Começar de uma skill parecida', select('wiz-from', [['', '— do zero —'], ...skills.map((k) => [k.id, k.name] as [string, string])], st.startFrom ?? '', (v) => {
            st.startFrom = v || undefined; const k = skills.find((x) => x.id === v);
            if (k) { st.aspect = k.aspect ?? st.aspect; st.durationSec = k.durationSec ?? st.durationSec; st.language = k.language ?? st.language; st.appearance = (k.appearance ?? st.appearance) as VideoTypeId; st.promptPrefix = k.promptPrefix ?? st.promptPrefix; st.routeId = k.routeId; st.startRouteId = k.routeId; if (!st.description.trim()) st.description = k.description; }
          })),
          field('Formato', select('wiz-aspect', ASPECTS, st.aspect, (v) => { st.aspect = v as Aspect; })),
          field('Duração (s)', num('wiz-dur', st.durationSec, (v) => { st.durationSec = v; }, { min: '5' })),
          field('Idioma', select('wiz-lang', LANGS, st.language, (v) => { st.language = v; })),
          field('Aparência', select('wiz-appear', meta.videoTypes.map((v) => [v.id, v.label] as [string, string]), st.appearance, (v) => { st.appearance = v as VideoTypeId; }))),
        h('div', { class: 'wiz-gen' }, ...GEN_SOURCES.map((g) => h('div', { class: 'row wiz-genrow' }, h('span', { class: 'grow' }, GEN_LABEL[g]),
          (() => { const r = h('input', { type: 'range', min: '0', max: '100', step: '5', 'data-gen': g }) as HTMLInputElement; r.value = String(st.gen[g] ?? 0);
            r.addEventListener('input', () => { st.gen[g as GenSource] = Number(r.value); save(); paint(); }); return r; })(),
          h('strong', { class: 'num' }, `${st.gen[g] ?? 0}%`)))),
        h('div', { class: total === 100 ? 'tag done' : 'tag running', id: 'wiz-gen-total' }, `Soma: ${total}%`),
        h('button', { class: 'small', onclick: () => { const on = genSources(st); if (!on.length) return; const each = Math.floor(100 / on.length); on.forEach((g, i) => { st.gen[g] = i === 0 ? 100 - each * (on.length - 1) : each; }); save(); paint(); } }, '⚖ Dividir igual entre as escolhidas'),
      ];
    },
    3: () => [
      info('O estilo de voz é um ativo: provedor, arquivo de referência, tom e idioma. Diálogos ligam várias vozes e o formato "NOME: fala".'),
      h('div', { class: 'row' },
        field('Voz', select('wiz-voice', [['narration', '🎙 Narração'], ['dialogue', '🎭 Diálogos'], ['mixed', '🎙+🎭 Narração e diálogos'], ['none', '🔇 Sem voz']], st.voice.mode, (v) => { st.voice.mode = v as SkillWizardState['voice']['mode']; })),
        st.voice.mode === 'mixed' ? field('Narração % (o resto é diálogo)', num('wiz-narr-pct', st.voice.narrationPct, (v) => { st.voice.narrationPct = v; }, { min: '1', max: '99' })) : null,
        st.voice.mode !== 'none' ? field('Tom / estilo de narração', input('wiz-tone', st.voice.tone, (v) => { st.voice.tone = v; }, { placeholder: 'calmo, irônico, jornalístico…' })) : null),
      st.voice.mode !== 'none' ? h('div', { class: 'row' }, h('button', { id: 'wiz-voice-ref', onclick: () => void (async () => { const f = await pick('Voz de referência', ['wav', 'mp3', 'm4a', 'flac', 'ogg'], 'Áudio'); if (f) { st.voice.voiceRef = f; save(); paint(); } })() }, '🎤 Voz de referência…'),
        h('span', { class: 'muted' }, st.voice.voiceRef ? base(st.voice.voiceRef) : 'nenhuma — usa a voz da rota')) : null,
    ],
    4: () => [
      info('Trilha nunca disputa com a voz: teto sugerido de 10% sob a narração. Letra de áudio entra como rascunho revisável.'),
      h('div', { class: 'row' },
        field('Música', select('wiz-music', [['generate', '🎵 Trilha de fundo'], ['lyric', '🎤 Canção com letra'], ['clip', '🎬 Clipe musical (a música conduz os cortes)'], ['none', '🔇 Sem música']], st.music.mode, (v) => { st.music.mode = v as SkillWizardState['music']['mode']; })),
        st.music.mode !== 'none' ? field('Máx. de faixas', num('wiz-tracks', st.music.maxTracks, (v) => { st.music.maxTracks = v; }, { min: '1', max: '20' })) : null,
        st.music.mode === 'generate' ? field('Volume sob a voz (%)', num('wiz-vol', st.music.volumePct, (v) => { st.music.volumePct = v; }, { min: '0', max: '100' })) : null),
      st.music.mode !== 'none' ? field('Estilo da música', input('wiz-mstyle', st.music.style, (v) => { st.music.style = v; }, { placeholder: 'lo-fi calmo, 85 BPM / big band anos 50 com crooner…', class: 'grow' })) : null,
      st.music.mode === 'lyric' || st.music.mode === 'clip' ? h('div', {},
        field('Letra vem de', select('wiz-lyr-src', [['prompt', '✍ Eu escrevo / a IA compõe'], ['txt', '📄 Arquivo .txt'], ['audio', '🎧 Áudio (transcrito no projeto)']], st.music.lyricsSource, (v) => { st.music.lyricsSource = v as SkillWizardState['music']['lyricsSource']; })),
        st.music.lyricsSource === 'txt' ? h('button', { id: 'wiz-lyr-file', onclick: () => void (async () => { const f = await pick('Letra (.txt)', ['txt', 'md', 'lrc']); if (!f) return; const r = await analyze({ kind: 'txt', file: f }); const ex = (r?.['profile'] as { excerpt?: string } | undefined)?.excerpt; if (ex) { st.music.lyrics = ex; save(); paint(); } })() }, '📄 Carregar .txt…') : null,
        st.music.lyricsSource === 'audio' ? info('A letra é transcrita (Whisper) quando você anexar a música no projeto — e fica como rascunho para revisar.') : area('wiz-lyrics', st.music.lyrics ?? '', (v) => { st.music.lyrics = v; }, 6, 'Deixe vazio para a IA compor a letra.')) : null,
    ],
    5: () => [
      info('Lipsync ligado exige rosto de referência e aumenta o custo (≈ +1 geração por fala). Conteúdo sintético leva rótulo de IA.'),
      check1('wiz-lipsync', st.lipsync.on, '👄 Lipsync nas falas marcadas', (v) => { st.lipsync.on = v; }),
      st.lipsync.on ? h('div', { class: 'row' }, h('button', { id: 'wiz-face', onclick: () => void (async () => { const f = await pick('Rosto de referência', ['png', 'jpg', 'jpeg', 'webp'], 'Imagem'); if (f) { st.lipsync.faceRef = f; save(); paint(); } })() }, '🙂 Rosto de referência…'), h('span', { class: 'muted' }, st.lipsync.faceRef ? base(st.lipsync.faceRef) : 'obrigatório')) : null,
      field('System prompt (regras que valem em todas as etapas, versionadas com a skill)', area('wiz-system', st.system, (v) => { st.system = v; }, 5, 'Ex.: Nunca cite marcas. Nunca use palavrões. Sempre credite as fontes na descrição.')),
    ],
    6: () => [
      info('A skill carrega a forma de escrever, não só o tema. Descreva o estilo ou entregue um roteiro .txt: o app mede pessoa, tamanho de frase, tom e estrutura.'),
      field('Estilo do texto', area('wiz-tstyle', st.textStyle.prompt, (v) => { st.textStyle.prompt = v; }, 3, 'Ex.: 1ª pessoa, ironia seca, frases de 12–18 palavras, termina com pergunta.')),
      h('div', { class: 'row' }, h('button', { id: 'wiz-txt', onclick: () => void (async () => { const f = await pick('Roteiro de referência', ['txt', 'md', 'srt', 'vtt']); if (!f) return; const r = await analyze({ kind: 'txt', file: f }); if (r?.['profile']) { st.textStyle.txtFile = f; st.textStyle.profile = r['profile'] as SkillWizardState['textStyle']['profile']; save(); paint(); } })() }, '📄 Roteiro .txt de referência…'),
        h('span', { class: 'muted' }, st.textStyle.txtFile ? base(st.textStyle.txtFile) : '')),
      st.textStyle.profile ? h('div', { class: 'card wiz-card' }, h('strong', {}, 'Perfil medido (editável)'),
        h('div', { class: 'row' }, field('Pessoa', input('wiz-tp-person', st.textStyle.profile.person ?? '', (v) => { st.textStyle.profile!.person = v; })),
          field('Palavras/frase', num('wiz-tp-wps', st.textStyle.profile.wordsPerSentence ?? 0, (v) => { st.textStyle.profile!.wordsPerSentence = v; })),
          field('Tom', input('wiz-tp-tone', st.textStyle.profile.tone ?? '', (v) => { st.textStyle.profile!.tone = v; })))) : null,
      check1('wiz-freeze', st.textStyle.freeze, '🧊 Congelar como bíblia de estilo (a temporada inteira mantém a voz do texto)', (v) => { st.textStyle.freeze = v; }),
    ],
    7: () => [
      info('Título de exemplo vira titleSpec: tamanho, número, caixa, emoji e tipo de gancho — com 3 variantes no mesmo padrão. O título nunca promete o que o vídeo não mostra.'),
      field('Título de exemplo', input('wiz-title-ex', st.title.example, (v) => { st.title.example = v; }, { class: 'grow', placeholder: 'Ex.: 7 Erros Que Destruíram o Império Romano' })),
      h('button', { id: 'wiz-title-go', onclick: () => void (async () => { const r = await analyze({ kind: 'title', text: st.title.example }); if (r?.['spec']) { st.title.spec = r['spec'] as SkillWizardState['title']['spec']; save(); paint(); } })() }, '🔎 Extrair padrão'),
      st.title.spec?.length ? h('div', { class: 'card wiz-card' }, h('strong', {}, 'titleSpec'),
        h('div', {}, `${st.title.spec.length[0]}–${st.title.spec.length[1]} caracteres · ${st.title.spec.number ? 'com número' : 'sem número'} · caixa ${st.title.spec.caps} · ${st.title.spec.emoji ? 'com emoji' : 'sem emoji'} · gancho: ${st.title.spec.hook}`),
        h('div', { class: 'muted' }, 'Variantes: ', ...(st.title.spec.variants ?? []).map((v) => h('span', { class: 'chip' }, v)))) : null,
      field('Ou descreva o padrão', area('wiz-title-pr', st.title.prompt, (v) => { st.title.prompt = v; }, 2, 'Ex.: número no início, 40–55 caracteres, sem emoji, curiosidade.')),
    ],
    8: () => [
      info('A capa também é contrato: imagem de exemplo, prompt ou os dois. O app mede a paleta; você descreve composição, texto e zona segura. Saída 1280×720.'),
      h('div', { class: 'row' }, h('button', { id: 'wiz-thumb-img', onclick: () => void (async () => { const f = await pick('Thumbnail de exemplo', ['png', 'jpg', 'jpeg', 'webp'], 'Imagem'); if (!f) return; st.thumb.image = f; const r = await analyze({ kind: 'image', file: f }); st.thumb.spec = { ...(st.thumb.spec ?? {}), palette: (r?.['palette'] as string[]) ?? [] }; save(); paint(); })() }, '🖼 Imagem de exemplo…'),
        h('span', { class: 'muted' }, st.thumb.image ? base(st.thumb.image) : ''), swatches(st.thumb.spec?.palette)),
      field('Prompt da thumbnail', area('wiz-thumb-pr', st.thumb.prompt, (v) => { st.thumb.prompt = v; }, 2, 'Ex.: rosto à direita (40% do quadro), objeto do tema à esquerda, fundo escuro.')),
      h('div', { class: 'row' },
        field('Composição', input('wiz-thumb-comp', st.thumb.spec?.composition ?? '', (v) => { st.thumb.spec = { ...(st.thumb.spec ?? {}), composition: v }; })),
        field('Texto', input('wiz-thumb-text', st.thumb.spec?.text ?? '', (v) => { st.thumb.spec = { ...(st.thumb.spec ?? {}), text: v }; }, { placeholder: '3 palavras, bold, canto inferior' })),
        field('Zona segura', input('wiz-thumb-safe', st.thumb.spec?.safeZone ?? '10% das bordas', (v) => { st.thumb.spec = { ...(st.thumb.spec ?? {}), safeZone: v }; })),
        field('Produção', select('wiz-thumb-prod', [['generator', 'Gerador de imagens'], ['html', 'HTML/canvas determinístico'], ['reuse', 'Reusar a referência']], st.thumb.production, (v) => { st.thumb.production = v as SkillWizardState['thumb']['production']; }))),
    ],
    9: () => [
      info('Cada linguagem aceita sua referência — e pode haver várias: código (.html/.js), imagem (identidade e paleta) e vídeo (movimento e câmera; o áudio é descartado). Ao gravar, cada arquivo é copiado para a biblioteca por hash.'),
      h('div', { class: 'row' },
        ...(['code', 'image', 'video'] as const).map((k) => h('button', { 'data-ref': k, onclick: () => void (async () => {
          const f = await pick(k === 'code' ? 'Código de referência' : k === 'image' ? 'Imagem de referência' : 'Vídeo de referência', k === 'code' ? ['html', 'js', 'ts'] : k === 'image' ? ['png', 'jpg', 'jpeg', 'webp'] : ['mp4', 'mov', 'webm', 'mkv']);
          if (!f) return;
          const r = await analyze({ kind: k, file: f });
          if (st.refs.some((x) => r?.['sha'] && x.sha === r['sha'])) { toast('Esta referência já está na lista (mesmo conteúdo).', true); return; }
          st.refs.push({ file: f, kind: k, sha: r?.['sha'] as string | undefined, palette: r?.['palette'] as string[] | undefined, rhythm: r?.['rhythm'] as WizardRef['rhythm'], duration: r?.['duration'] as number | undefined });
          save(); paint();
        })() }, k === 'code' ? '＋ 💻 Código' : k === 'image' ? '＋ 🖼 Imagem' : '＋ 🎞 Vídeo'))),
      h('div', { class: 'wiz-refs' }, ...st.refs.map((r, i) => h('div', { class: 'row wiz-ref' }, h('span', {}, r.kind === 'code' ? '💻' : r.kind === 'image' ? '🖼' : '🎞'), h('span', { class: 'grow' }, base(r.file)),
        swatches(r.palette), r.rhythm ? h('span', { class: 'chip' }, `${r.rhythm.shotSec} s/plano`) : null,
        h('button', { class: 'small danger', onclick: () => { st.refs.splice(i, 1); save(); paint(); } }, '✕')))),
      field('Prefixo de TODO prompt visual (opcional, em inglês)', area('wiz-prefix', st.promptPrefix, (v) => { st.promptPrefix = v; }, 3, 'Ex.: 1950s retro-futuristic Atompunk aesthetic, shot on 3-strip Technicolor 35mm film…')),
    ],
    10: () => {
      const vids = st.refs.filter((r) => r.kind === 'video');
      return [
        info('O vídeo de referência é aberto plano a plano: ritmo (duração por plano), cortes por minuto e tipo de transição viram parâmetros do plano de cenas e da montagem.'),
        h('div', { class: 'row' },
          field('Vídeo', select('wiz-cut-video', [['', vids.length ? '— escolha —' : '— adicione na tela 9 ou escolha um arquivo —'], ...vids.map((r) => [r.file, base(r.file)] as [string, string])], st.cut.video ?? '', (v) => { st.cut.video = v || undefined; st.cut.rhythm = vids.find((r) => r.file === v)?.rhythm; })),
          h('button', { id: 'wiz-cut-file', onclick: () => void (async () => { const f = await pick('Vídeo para decupar', ['mp4', 'mov', 'webm', 'mkv']); if (!f) return; const r = await analyze({ kind: 'video', file: f }); st.cut.video = f; st.cut.rhythm = r?.['rhythm'] as WizardRef['rhythm']; save(); paint(); })() }, '🎞 Outro arquivo…'),
          field('Granularidade', select('wiz-gran', [['1s', 'segundo a segundo'], ['0.5s', 'meio segundo'], ['frame', 'quadro a quadro']], st.cut.granularity, (v) => { st.cut.granularity = v as SkillWizardState['cut']['granularity']; }))),
        st.cut.rhythm ? h('div', { class: 'card wiz-card', id: 'wiz-cutmap' }, h('strong', {}, 'cutMap medido'),
          h('div', {}, `${st.cut.rhythm.cuts} cortes · plano médio ${st.cut.rhythm.shotSec} s · ${st.cut.rhythm.cutsPerMin} cortes/min · transição: ${st.cut.rhythm.transition === 'none' ? 'corte seco' : st.cut.rhythm.transition}`)) : info('Sem decupagem: o plano de cenas usa o ritmo padrão da rota.'),
        field('Sequência de câmeras (opcional)', input('wiz-cams', st.cut.cameras ?? '', (v) => { st.cut.cameras = v; }, { placeholder: 'close → médio → detalhe → aberto', class: 'grow' })),
      ];
    },
    11: () => [
      info('A pasta vira inventário indexado (hash, duplicatas, paleta, movimento) e entra como banco de mídia na frente das etapas de imagem/vídeo da rota.'),
      h('div', { class: 'row' }, h('button', { id: 'wiz-media', onclick: () => void (async () => { const d = (await forge['openDir']({ title: 'Pasta de mídia' })) as string | null; if (!d) return; const r = await analyze({ kind: 'media', file: d }); st.media.dir = d; st.media.count = r?.['count'] as SkillWizardState['media']['count']; save(); paint(); })() }, '📁 Escolher pasta…'),
        h('span', { class: 'muted' }, st.media.dir ?? 'nenhuma (opcional)'),
        st.media.dir ? h('button', { class: 'small', onclick: () => { st.media.dir = undefined; st.media.count = undefined; save(); paint(); } }, '✕') : null),
      st.media.count ? h('div', { class: 'card wiz-card', id: 'wiz-media-count' }, `🖼 ${st.media.count.image} imagens · 🎞 ${st.media.count.video} vídeos · ${st.media.count.duplicates} duplicata(s) por hash (ignoradas na escolha)`) : null,
      st.media.dir ? h('div', { class: 'row' },
        check1('wiz-media-img', st.media.kinds.includes('image'), 'fornece imagens', (v) => { st.media.kinds = v ? [...new Set([...st.media.kinds, 'image' as const])] : st.media.kinds.filter((k) => k !== 'image'); }),
        check1('wiz-media-vid', st.media.kinds.includes('video'), 'fornece vídeos', (v) => { st.media.kinds = v ? [...new Set([...st.media.kinds, 'video' as const])] : st.media.kinds.filter((k) => k !== 'video'); }),
        check1('wiz-media-across', st.media.noRepeatAcross, 'não repetir entre vídeos', (v) => { st.media.noRepeatAcross = v; })) : null,
    ],
    12: () => [
      info('A skill termina onde o vídeo termina: transição, legenda, loudness, filtro e textura também são decisões registradas na rota.'),
      h('div', { class: 'row' },
        field('Transição', select('wiz-tr', TRANSITIONS.map((t) => [t, t === 'none' ? 'corte seco' : t] as [string, string]), st.edit.transition, (v) => { st.edit.transition = v as FxTransition; })),
        field('Duração (s)', num('wiz-tr-sec', st.edit.transitionSec, (v) => { st.edit.transitionSec = v; }, { step: '0.1', min: '0', max: '2' })),
        field('Legenda', select('wiz-subs', [['burn', 'queimada no vídeo'], ['srt', 'arquivo .srt'], ['off', 'sem legenda']], st.edit.subtitles, (v) => { st.edit.subtitles = v as SkillWizardState['edit']['subtitles']; })),
        field('Master (LUFS)', num('wiz-lufs', st.edit.lufs, (v) => { st.edit.lufs = v; }, { min: '-30', max: '-8' }))),
      h('div', { class: 'row' },
        field('Filtro', select('wiz-filter', FILTERS.map((f) => [f, f === 'none' ? 'nenhum' : f] as [string, string]), st.edit.filter, (v) => { st.edit.filter = v as FxFilter; })),
        field('Textura', select('wiz-texture', TEXTURES.map((f) => [f, f === 'none' ? 'nenhuma' : f] as [string, string]), st.edit.texture, (v) => { st.edit.texture = v as FxTexture; }))),
      field('Instruções de edição', area('wiz-edit-pr', st.edit.prompt, (v) => { st.edit.prompt = v; }, 3, 'Ex.: punch-in a cada frase forte; sem zoom nos 3 primeiros segundos.')),
    ],
    13: () => {
      const sug = suggestRoute(st, routes);
      if (!st.routeId || !routes.some((r) => r.id === st.routeId)) st.routeId = sug.route?.id;
      const r = routes.find((x) => x.id === st.routeId);
      const custom = r ? buildRoute(st, r, st.media.dir ? 'pasta-da-skill' : undefined) : undefined;
      const k = buildSkill(st, r?.id);
      const vt = meta.videoTypes.find((v) => v.id === st.appearance)?.sceneKind;
      const rep = checkSkillRoute(k, custom ?? r, vt as never, r);
      const cost = estimateCost(st, custom ?? r);
      const out = h('div', { id: 'wiz-result' });
      const gen = h('button', { class: 'primary', id: 'wiz-save', onclick: () => void (async () => {
        gen.setAttribute('disabled', '');
        try {
          const res = (await forge['wizardSave'](st)) as { skill: Skill; route?: Route; bank?: { name: string }; warnings: string[] };
          try { localStorage.removeItem(DRAFT_KEY); } catch { /* ok */ }
          out.replaceChildren(h('div', { class: 'card svresult' }, h('strong', {}, `✓ Skill "${res.skill.name}" criada`),
            res.route ? h('div', {}, `🛣️ Rota própria: ${res.route.name}`) : h('div', {}, `🛣️ Rota: ${r?.name ?? ''}`),
            res.bank ? h('div', {}, `📁 Banco de mídia: ${res.bank.name}`) : null,
            ...res.warnings.map((w) => h('div', { class: 'tag running' }, '⚠ ' + w)),
            h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: () => bg.remove() }, 'Fechar'), h('button', { class: 'primary', onclick: () => { bg.remove(); onDone(res.skill); } }, 'Abrir a skill'))));
          toast(`Skill "${res.skill.name}" criada`);
        } catch (e) { out.replaceChildren(h('div', { class: 'tag failed' }, '⛔ ' + (e as Error).message)); gen.removeAttribute('disabled'); }
      })() }, '✅ Gerar skill e rota');
      const blocked = rep.errors.length > 0 || Array.from({ length: 12 }, (_, i) => stepErrors(st, i + 1)).flat().length > 0;
      if (blocked) gen.setAttribute('disabled', '');
      return [
        info('O assistente propõe; você aprova. Nada é gravado antes do botão final.'),
        h('div', { class: 'row' }, field('Rota', select('wiz-route', routes.map((x) => [x.id, `${x.id === sug.route?.id ? '⭐ ' : ''}${x.name}`] as [string, string]), st.routeId ?? '', (v) => { st.routeId = v; }))),
        sug.missing.length && st.routeId === sug.route?.id ? h('div', { class: 'tag running' }, `⚠ A rota sugerida não tem: ${sug.missing.join(', ')}`) : null,
        custom ? info(`Vai gravar uma ROTA PRÓPRIA (cópia de "${r?.name}") com ${st.media.dir ? 'a pasta de mídia na frente de imagem/vídeo e ' : ''}os parâmetros de edição desta skill.`) : null,
        h('div', { class: 'compat', id: 'wiz-compat' }, ...rep.errors.map((e) => h('span', { class: 'tag failed' }, '⛔ ' + e)), ...rep.warnings.map((e) => h('span', { class: 'tag running' }, '⚠ ' + e)), ...rep.ok.map((e) => h('span', { class: 'tag done' }, '✓ ' + e))),
        h('div', { class: 'card wiz-card', id: 'wiz-cost' }, h('strong', {}, `💰 Estimativa: ~${cost.calls} chamadas · ~${cost.minutes} min`), h('div', { class: 'muted' }, cost.note)),
        h('details', { open: true }, h('summary', {}, 'SKILL.md que será gravada'), h('pre', { class: 'pvtext', id: 'wiz-md' }, skillMarkdown(k, custom?.name ?? r?.name))),
        h('div', { class: 'row actions' }, h('span', { class: 'sp' }), gen), out,
      ];
    },
  };
  let cnt: HTMLElement | undefined;

  function paint() {
    dots.replaceChildren(...STEP_TITLES.map((t, i) => {
      const n = i + 1, bad = n < step && stepErrors(st, n).length > 0;
      return h('button', { class: `wiz-dot${n === step ? ' on' : ''}${n <= seen ? ' seen' : ''}${bad ? ' bad' : ''}`, 'data-step': String(n), title: t, onclick: () => { if (n <= seen) { step = n; paint(); } } }, h('b', {}, String(n)), h('span', {}, t));
    }));
    body.replaceChildren(h('h4', {}, `Tela ${step} de ${TOTAL_STEPS} · ${STEP_TITLES[step - 1]}`), ...screens[step]!().filter((x): x is HTMLElement => !!x && typeof x === 'object'));
    check();
  }
  paint();
}
