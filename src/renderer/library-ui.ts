import type { HarnessBinding, ApiCategory, AppLanguage, Binding, CustomVideoType, PluginInfo, Project, ReasoningEffort, Route, RouteStep, Settings, Skill, StockSource } from '../shared/types';
import { EFFORT_OPTIONS, harnessOffersEffort, modelSupportsEffort } from '../shared/effort';
import { icon } from './icons';
import { artIcon, bindingArt, fallbackChips, openBindingPicker } from './providers-ui';
import { checkSkillRoute } from '../shared/compat';
import { helpButton } from './carousel';
import { ANGLE_GROUPS, angleLabel } from '../shared/angles';
import { STOCK_SOURCES, stockInfo } from '../shared/stock-sources';
import { askConfirm, showMessage } from './dialogs';

/* Abas: Rotas (biblioteca), Skills, Tipos de vídeo e Configurações. Recebe helpers do renderer principal. */
type Child = Node | string | null | undefined | false;
type H = (tag: keyof HTMLElementTagNameMap, attrs?: Record<string, string | boolean | ((e: Event) => void)>, ...kids: Child[]) => HTMLElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = Record<string, (...a: any[]) => Promise<any>>;
export interface Ctx {
  h: H;
  main: HTMLElement;
  forge: Api;
  toast: (m: string, bad?: boolean) => void;
  guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  current: () => Project | undefined;
  setCurrent: (p: Project) => void;
  go: (tab: string) => void;
}
interface Catalog {
  workflows: Array<{ file: string; label: string; capability: string }>;
  wan2gpTemplates: Array<{ file: string; label: string; capability: string; modelType?: string }>;
  apis: Array<{ provider: string; kind: string; categories: string[]; models: string[]; modelCategories?: Record<string, string>; voices: string[]; voiceLabels?: Record<string, string> }>;
  harnesses: Array<{ id: string; models: string[]; defaultModel?: string }>;
  wan2gpModels: Array<{ kind: string; model: string }>;
  stock: StockSource[]; builtinTools: string[]; comfyServers: string[];
  flowAccounts?: Array<{ id: string; label: string; email?: string }>;
}
interface Meta { videoTypes: Array<{ id: string; label: string; sceneKind?: string }>; stepKinds: string[]; harnessIds: string[]; voices?: Array<{ name: string; path: string }> }

export const KIND_LABEL: Record<string, string> = {
  ideation: 'Ideação', script: 'Roteiro', scene_plan: 'Plano de cenas', asset_design: 'Design de assets', image: 'Imagem', video: 'Vídeo', code_scene: 'Cena por código',
  motion_graphics: 'Motion graphics', narration: 'Narração', music: 'Trilha', sfx: 'Efeitos sonoros', subtitles: 'Legendas', edit: 'Edição/montagem', review: 'Revisão',
  thumbnail: 'Thumbnail', metadata: 'Descrição/SEO', publish: 'Publicação', stock_media: 'Bancos de mídia', transcribe: 'Transcrição (Whisper)',
  brief: 'Brief do orquestrador', free: 'Vídeo livre (prompt → harness)',
};
const CAP_OF: Record<string, string> = { image: 'image', thumbnail: 'image', video: 'video', narration: 'voice', music: 'music' };
const MEDIA_KINDS = new Set(['image', 'thumbnail', 'video', 'narration', 'music']);
const FLOW_KINDS = new Set(['image', 'thumbnail', 'video']);
const LANGS: Array<[string, string]> = [['pt-BR', 'Português (Brasil)'], ['pt-PT', 'Português (Portugal)'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Español'], ['es-MX', 'Español (México)'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['it-IT', 'Italiano'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['zh-CN', '中文']];
export const LANGUAGES = LANGS;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** "Verificar biblioteca": lista as incoerências entre skills, rotas, workflows, provedores, vozes e contas. */
function auditButton(c: Ctx): HTMLElement {
  const { h } = c;
  return h('button', { 'data-act': 'audit', title: 'Procura incoerências: skill sem rota, instrução para etapa que a rota não tem, montagem que não espera mídias, workflow/voz/conta inexistente, provedor sem chave…', onclick: () => void c.guard(async () => {
    const list = (await c.forge['auditLibrary'](true)) as Array<{ level: 'erro' | 'aviso'; kind: string; id: string; name: string; msg: string; builtin?: boolean }>;
    const errs = list.filter((x) => x.level === 'erro').length;
    const close = () => bg.remove();
    const bg = h('div', { class: 'modal-bg', id: 'audit-modal', onclick: (e: Event) => { if (e.target === bg) close(); } },
      h('div', { class: 'modal pl-modal' },
        h('div', { class: 'row' }, h('h3', {}, `🔍 Verificação da biblioteca — ${errs} erro(s), ${list.length - errs} aviso(s)`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
        list.length ? h('div', { class: 'audit-list' }, ...list.map((x) => h('div', { class: `audit-row ${x.level}` }, h('span', {}, x.level === 'erro' ? '✗' : '⚠'),
          h('strong', {}, `${x.kind} ${x.name}`), x.builtin ? h('span', { class: 'tag' }, 'padrão') : null, h('span', { class: 'muted' }, x.msg))))
          : h('p', {}, '✓ Nenhuma incoerência encontrada.'),
        h('p', { class: 'muted small' }, 'Erros fazem a produção falhar ou sair incompleta. Avisos indicam algo que não será usado ou que vai cair na reserva (ex.: provedor sem chave de API).')));
    document.body.append(bg);
  }) }, '🔍 Verificar biblioteca');
}

export function bindingSummary(b: Binding): string {
  switch (b.type) {
    case 'harness': return `harness:${b.harness}/${b.model || 'auto'}${b.effort ? '@' + b.effort : ''}`;
    case 'comfyui': return `comfyui:${b.workflow}`;
    case 'wan2gp': return `wan2gp:${b.template}`;
    case 'api': return `api:${b.provider}/${b.model}`;
    case 'stock': return `stock:${b.sources.join('+')}`;
    case 'builtin': return `builtin:${b.tool}`;
    default: return 'manual';
  }
}

/* ═════════════════ ROTAS ═════════════════ */
let routeDraft: Route | undefined;
let routeOrigin: Route | undefined;     // rota carregada (para saber se é padrão)
let routeErrors: string[] = [];

/* Ícones e fases das tarefas (visual das rotas). */
export const KIND_ICON: Record<string, string> = {
  ideation: '💡', brief: '📋', script: '✍️', scene_plan: '🗂️', asset_design: '🎨', narration: '🎙️', transcribe: '📝', image: '🖼️', video: '🎬',
  code_scene: '🧑‍💻', motion_graphics: '📊', stock_media: '🗃️', music: '🎵', sfx: '🔊', subtitles: '💬', edit: '🎞️', thumbnail: '🏞️',
  metadata: '🏷️', review: '⭐', publish: '🚀', free: '🪄',
};
const KIND_HINT: Record<string, string> = {
  ideation: 'Gera ideias de vídeo com gancho', brief: 'Plano criativo do orquestrador', script: 'Escreve o roteiro (script.md)', scene_plan: 'Divide o roteiro em cenas (scenes.json)',
  asset_design: 'Ficha de personagens e cenários', narration: 'Voz de cada cena (TTS/clonagem)', transcribe: 'Tempo de cada palavra (sincronia)', image: 'Imagem da cena',
  video: 'Vídeo IA da cena', code_scene: 'Cena desenhada por código (HTML)', motion_graphics: 'Gráficos e tipografia animados', stock_media: 'Fotos/vídeos de bancos de mídia',
  music: 'Trilha sonora', sfx: 'Efeitos sonoros', subtitles: 'Legendas .srt', edit: 'Montagem do final.mp4', thumbnail: 'Thumbnail/capa', metadata: 'Título, descrição e tags',
  review: 'Revisão com nota e correções', publish: 'Publicação', free: 'O provedor faz o vídeo inteiro a partir do prompt',
};
const PLAN_KINDS = ['ideation', 'brief', 'script', 'scene_plan', 'asset_design'];
const LANES: Array<{ icon: string; title: string; hint: string }> = [
  { icon: '✍️', title: '1 · Planejar', hint: 'roteiro e cenas' },
  { icon: '🎬', title: '2 · Produzir cada cena', hint: 'roda uma vez por cena' },
  { icon: '🎞️', title: '3 · Montar', hint: 'trilha, legendas e vídeo final' },
  { icon: '🚀', title: '4 · Publicar', hint: 'SEO, thumbnail e revisão' },
];
export function laneOf(st: RouteStep): number {
  if (PLAN_KINDS.includes(st.kind)) return 0;
  if (st.scope === 'scene' || st.kind === 'free') return 1;
  if (['music', 'sfx', 'subtitles', 'edit'].includes(st.kind)) return 2;
  return 3;
}
const SCENE_KINDS_PT: Record<string, string> = { image: 'imagem', video: 'vídeo', code: 'código', motion: 'motion', mixed: 'misto', stock: 'banco' };

/** Mini-pipeline (ícones das tarefas por fase) usado nos cartões. */
export function routeStrip(c: Ctx, r: Route): HTMLElement {
  const { h } = c;
  return h('div', { class: 'rstrip' }, ...LANES.map((_, li) => {
    const sts = r.steps.filter((s) => s.enabled && laneOf(s) === li);
    return sts.length ? h('span', { class: 'rlane' }, ...sts.map((s) => h('span', { title: s.label }, KIND_ICON[s.kind] ?? '•'))) : null;
  }).flatMap((x, i, a) => (x ? [x, i < a.length - 1 && a.slice(i + 1).some(Boolean) ? h('span', { class: 'rarrow' }, '›') : null] : [])));
}

/** Janela modal genérica (fecha com Esc/clique fora). */
function modal(c: Ctx, id: string, title: string, body: () => Child[], wide = false): { close: () => void; repaint: () => void } {
  const { h } = c;
  const box = h('div', { class: `modal${wide ? ' pmodal' : ''}` });
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const repaint = () => box.replaceChildren(h('div', { class: 'row' }, h('h3', {}, title), h('span', { class: 'sp' }), h('button', { onclick: close, title: 'Fechar (Esc)' }, '✕')), ...(body().filter(Boolean) as Array<Node | string>));
  const bg = h('div', { class: 'modal-bg', id, onclick: (e) => { if (e.target === bg) close(); } }, box);
  document.addEventListener('keydown', onKey);
  document.body.append(bg); repaint();
  return { close, repaint };
}

let routeFilter = { q: '', who: '' };
export async function renderRoutesLib(c: Ctx) {
  const { h, main, forge, toast, guard } = c;
  const [routes, cat, meta] = await Promise.all([forge['listRoutes']() as Promise<Route[]>, forge['catalog']() as Promise<Catalog>, forge['meta']() as Promise<Meta>]);
  const builtin = (r?: Route) => !!(r as (Route & { builtin?: boolean }) | undefined)?.builtin;
  const again = () => void renderRoutesLib(c);
  const redraw = () => { routeErrors = []; again(); };
  const head = (...extra: Child[]) => h('div', { class: 'row pagehead' }, h('h2', {}, '🛣️ Rotas'), helpButton('routes'), h('span', { class: 'sp' }), auditButton(c), ...extra);

  /* ── galeria ── */
  if (!routeDraft) {
    const q = h('input', { placeholder: 'Buscar rota…', value: routeFilter.q, id: 'route-q' }) as HTMLInputElement;
    q.addEventListener('input', () => { routeFilter.q = q.value; paintGrid(); });
    const grid = h('div', { class: 'sgrid', id: 'route-list' });
    const seg = h('div', { class: 'seg' }, ...([['', 'Todas'], ['b', '🔒 Padrão'], ['m', '★ Minhas']] as Array<[string, string]>).map(([v, l]) =>
      h('button', { class: routeFilter.who === v ? 'on' : '', onclick: () => { routeFilter.who = v; again(); } }, l)));
    const paintGrid = () => grid.replaceChildren(...routes.filter((r) => (!routeFilter.q || `${r.name} ${r.description}`.toLowerCase().includes(routeFilter.q.toLowerCase()))
      && (!routeFilter.who || (routeFilter.who === 'b') === builtin(r))).map((r) => {
      const scene = r.steps.filter((s) => s.enabled && s.scope === 'scene').length;
      return h('button', { class: 'scard', 'data-route': r.id, onclick: () => { routeOrigin = r; routeDraft = clone(r); redraw(); } },
        h('div', { class: 'row' }, h('span', { class: 'sicon' }, KIND_ICON[r.steps.find((s) => s.scope === 'scene')?.kind ?? r.steps[0]?.kind ?? 'edit'] ?? '🛣️'),
          h('strong', { class: 'grow' }, r.name), builtin(r) ? h('span', { class: 'tag', title: (r as { customized?: boolean }).customized ? 'Padrão personalizada por você' : 'Padrão' }, (r as { customized?: boolean }).customized ? '✎' : '🔒') : h('span', { class: 'tag done' }, '★ minha')),
        h('span', { class: 'muted sdesc' }, r.description || '—'),
        routeStrip(c, r),
        h('span', { class: 'pchips' }, h('span', { class: 'chip' }, `${r.steps.filter((s) => s.enabled).length} tarefas`), scene ? h('span', { class: 'chip' }, `🎬 ${scene} por cena`) : null));
    }));
    paintGrid();
    main.replaceChildren(
      head(h('button', { class: 'primary', id: 'route-new', onclick: () => {
        routeOrigin = undefined;
        routeDraft = { id: '', name: 'Nova rota', description: '', videoTypes: [], steps: [newStep('script', 'Roteiro', 'project', [], cat, meta)] };
        redraw();
      } }, '＋ Nova rota'),
      h('button', { id: 'route-import', title: 'Importar rotas de arquivos .json', onclick: () => void guard(async () => {
        const rs = (await forge['importRoutes']()) as Route[] | undefined;
        if (rs?.length) { toast(`${rs.length} rota(s) importada(s)`); again(); }
      }) }, '⬆ Importar'),
      h('button', { id: 'route-export-all', title: 'Exportar todas as suas rotas para uma pasta (JSON)', onclick: () => void guard(async () => {
        const files = (await forge['exportLibrary']('routes')) as string[] | null;
        if (files) toast(files.length ? `${files.length} rota(s) exportada(s)` : 'Nenhuma rota sua para exportar');
      }) }, '⬇ Exportar todas')),
      h('p', { class: 'muted' }, 'Uma rota é a linha de produção do vídeo: tarefas em ordem, cada uma com um executor principal e reservas. Clique numa rota para ver o pipeline.'),
      h('div', { class: 'row' }, q, seg), grid);
    return;
  }

  /* ── editor em pipeline ── */
  const d = routeDraft;
  const isBuiltin = builtin(routeOrigin);
  const name = h('input', { id: 'route-name', value: d.name, class: 'grow' }) as HTMLInputElement;
  name.addEventListener('input', () => { d.name = name.value; });
  const desc = h('input', { id: 'route-desc', value: d.description, placeholder: 'Descrição' }) as HTMLInputElement;
  desc.addEventListener('input', () => { d.description = desc.value; });
  const HS = ['claude', 'antigravity', 'codex', 'opencode', 'openclaw', 'ollama', 'lmstudio', 'llamacpp', 'deepseek'];
  const fbBox = h('div', { class: 'pchips', id: 'route-fallback' });
  const paintFb = () => fbBox.replaceChildren(...HS.map((x) => {
    const fb = () => ((d as { harnessFallback?: string[] }).harnessFallback ?? []);
    const i = fb().indexOf(x);
    return h('button', { class: `chip${i >= 0 ? ' on' : ''}`, 'data-fb': x, title: 'Clique para incluir/tirar — a ordem dos cliques é a ordem de uso', onclick: () => {
      const cur = fb();
      const next = cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x];
      const dd = d as { harnessFallback?: string[] };
      if (next.length) dd.harnessFallback = next; else delete dd.harnessFallback;
      paintFb();
    } }, i >= 0 ? `${i + 1}. ${x}` : x);
  }));
  paintFb();
  const customized = !!(routeOrigin as { customized?: boolean } | undefined)?.customized;
  /* rota padrão: "Salvar" grava a SUA versão dela (permanente, vale no lugar da padrão); "Restaurar" volta ao original */
  const save = (asNew: boolean) => void guard(async () => {
    const r = clone(d);
    delete (r as { builtin?: boolean }).builtin; delete (r as { customized?: boolean }).customized;
    r.id = asNew ? '' : routeOrigin?.id ?? '';
    routeErrors = (await forge['validateRoute'](r)) as string[];
    if (routeErrors.length) { toast(routeErrors[0]!, true); again(); return; }
    const saved = (await forge['saveLibRoute'](r)) as Route;
    const fresh = ((await forge['listRoutes']()) as Route[]).find((x) => x.id === saved.id) ?? saved;
    routeOrigin = fresh; routeDraft = clone(fresh); toast(`Rota "${saved.name}" salva`); again();
  });

  /* editor completo de uma tarefa numa janela */
  const editStep = (st: RouteStep) => {
    const m = modal(c, 'step-modal', `${KIND_ICON[st.kind] ?? '•'} ${st.label}`, () => {
      const si = d.steps.indexOf(st);
      if (si < 0) { window.setTimeout(() => m.close()); return []; }
      return [h('p', { class: 'muted' }, KIND_HINT[st.kind] ?? ''), stepEditor(c, d, st, si, cat, meta, () => { m.repaint(); again(); }),
        h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { class: 'primary', onclick: () => { m.close(); again(); } }, 'Concluir'))];
    }, true);
  };
  /* escolher o tipo da nova tarefa (cartões) */
  const addStep = (lane: number) => {
    const kinds = meta.stepKinds.filter((k) => lane === 0 ? PLAN_KINDS.includes(k) : lane === 1 ? ['narration', 'transcribe', 'image', 'video', 'code_scene', 'motion_graphics', 'stock_media', 'review', 'free'].includes(k)
      : lane === 2 ? ['music', 'sfx', 'subtitles', 'edit'].includes(k) : ['metadata', 'thumbnail', 'review', 'publish'].includes(k));
    const m = modal(c, 'kind-modal', `＋ Nova tarefa — ${LANES[lane]!.title}`, () => [
      h('div', { class: 'ptiles' }, ...kinds.map((k) => h('button', { class: 'ptile', 'data-kind': k, onclick: () => {
        const scope = lane === 1 && k !== 'free' ? 'scene' : 'project';
        const prev = [...d.steps].reverse().find((s) => laneOf(s) <= lane);
        const st = newStep(k, KIND_LABEL[k] ?? k, scope, prev ? [prev.id] : [], cat, meta);
        d.steps.push(st); m.close(); again(); editStep(st);
      } }, h('span', { class: 'picon' }, KIND_ICON[k] ?? '•'), h('span', { class: 'ptxt' }, h('strong', {}, KIND_LABEL[k] ?? k), h('span', { class: 'muted' }, KIND_HINT[k] ?? '')))))]);
  };
  const stepCard = (st: RouteStep) => {
    const b = st.bindings[0];
    const art = b ? bindingArt(b) : undefined;
    const si = d.steps.indexOf(st);
    const en = h('input', { type: 'checkbox', title: 'Tarefa ativa' }) as HTMLInputElement; en.checked = st.enabled;
    en.addEventListener('change', () => { st.enabled = en.checked; again(); });
    const move = (dx: number) => { const j = si + dx; if (j < 0 || j >= d.steps.length) return; [d.steps[si], d.steps[j]] = [d.steps[j]!, d.steps[si]!]; again(); };
    return h('div', { class: `stepcard${st.enabled ? '' : ' off'}`, 'data-step': st.id },
      h('div', { class: 'row' }, h('span', { class: 'sicon' }, KIND_ICON[st.kind] ?? '•'), h('div', { class: 'grow' }, h('strong', {}, st.label), h('div', { class: 'muted' }, `${KIND_LABEL[st.kind] ?? st.kind} · ${st.id}`)), en),
      art ? h('button', { class: 'ptile small', title: 'Trocar o executor principal', onclick: () => void openBindingPicker({ forge: c.forge, toast: c.toast }, { step: st, current: b, onPick: (nb) => { st.bindings[0] = nb; again(); } }) },
        h('span', { class: 'picon' }, artIcon(art.icon)), h('span', { class: 'ptxt' }, h('strong', {}, art.title), h('span', { class: 'muted' }, art.sub))) : h('span', { class: 'tag failed' }, 'sem executor'),
      h('div', { class: 'pchips' },
        st.scope === 'scene' ? h('span', { class: 'chip' }, '🔁 por cena') : null,
        st.bindings.length > 1 ? h('span', { class: 'chip', title: st.bindings.slice(1).map((x) => bindingArt(x).title + ' · ' + bindingArt(x).sub).join('\n') }, `↳ ${st.bindings.length - 1} reserva(s)`) : null,
        st.onlySceneKinds?.length ? h('span', { class: 'chip' }, `só ${st.onlySceneKinds.map((k) => SCENE_KINDS_PT[k] ?? k).join('/')}`) : null,
        st.optional || st.onFail === 'skip' ? h('span', { class: 'chip' }, 'opcional') : null,
        st.dependsOn.length ? h('span', { class: 'chip muted', title: 'Depende de' }, `após ${st.dependsOn.join(', ')}`) : null),
      h('div', { class: 'row stepacts' },
        h('button', { class: 'small primary', 'data-act': 'step-edit', onclick: () => editStep(st) }, '✎ Editar'),
        h('button', { class: 'small', title: 'Subir', onclick: () => move(-1) }, '↑'), h('button', { class: 'small', title: 'Descer', onclick: () => move(1) }, '↓'),
        h('button', { class: 'small danger', 'data-act': 'step-del', onclick: () => {
          if (d.steps.length <= 1) return toast('A rota precisa de ao menos uma tarefa.', true);
          d.steps = d.steps.filter((x) => x !== st); for (const o of d.steps) o.dependsOn = o.dependsOn.filter((x) => x !== st.id); again();
        } }, '✕')));
  };

  main.replaceChildren(
    head(h('button', { id: 'route-back', onclick: () => { routeDraft = undefined; routeOrigin = undefined; again(); } }, '← Todas as rotas')),
    h('div', { class: 'card' },
      isBuiltin ? h('p', { class: 'muted' }, customized ? '✎ Rota padrão personalizada por você: suas alterações ficam salvas (inclusive após atualizar o app). "Restaurar padrão" volta ao original.' : '🔒 Rota padrão. Altere o que quiser e "Salvar alterações" grava a sua versão dela, permanente; ou "Salvar como nova" para uma cópia separada.') : null,
      h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Nome da rota', name), h('label', { class: 'grow' }, 'Descrição', desc)),
      h('div', { class: 'routefb' }, h('strong', {}, '🛟 Reservas de harness'), h('span', { class: 'muted small' }, ' — se um harness esgotar as tentativas numa etapa (e a cadeia dela não tiver outro), o motor tenta estes, em ordem. Sem escolha: os outros harnesses usados nesta rota e, por último, os instalados.'), fbBox),
      h('div', { class: 'row' },
        h('button', { class: 'primary', id: 'route-save', onclick: () => save(false) }, isBuiltin ? '💾 Salvar alterações' : '💾 Salvar rota'),
        routeOrigin ? h('button', { id: 'route-saveas', onclick: () => { d.name = d.name + ' (cópia)'; save(true); } }, 'Salvar como nova') : null,
        isBuiltin && customized ? h('button', { id: 'route-restore', onclick: () => void guard(async () => {
          if (!await askConfirm(`Descartar suas alterações e restaurar a rota padrão "${routeOrigin!.name}"?`)) return;
          await forge['deleteLibRoute'](routeOrigin!.id); routeDraft = undefined; routeOrigin = undefined; toast('Rota padrão restaurada'); again();
        }) }, '↺ Restaurar padrão') : null,
        routeOrigin ? h('button', { id: 'route-dup', onclick: () => { routeOrigin = undefined; routeDraft = { ...clone(d), id: '', name: d.name + ' (cópia)' }; redraw(); } }, 'Duplicar') : null,
        routeOrigin ? h('button', { id: 'route-export', onclick: () => void guard(async () => { const f = (await forge['exportRoute'](routeOrigin!.id)) as string | null; if (f) toast(`Rota exportada: ${f}`); }) }, '⬇ Exportar') : null,
        routeOrigin && !isBuiltin ? h('button', { class: 'danger', id: 'route-del', onclick: () => void guard(async () => {
          if (!await askConfirm(`Excluir a rota "${routeOrigin!.name}"?`)) return;
          await forge['deleteLibRoute'](routeOrigin!.id); routeDraft = undefined; routeOrigin = undefined; toast('Rota excluída'); again();
        }) }, 'Excluir') : null,
        c.current() ? h('button', { id: 'route-apply', onclick: () => void guard(async () => {
          const cur = c.current()!; routeErrors = (await forge['validateRoute']({ ...d, id: d.id || 'tmp' })) as string[];
          if (routeErrors.length) { toast(routeErrors[0]!, true); return again(); }
          c.setCurrent((await forge['saveRoute'](cur.id, d)) as Project); toast(`Rota aplicada ao projeto "${cur.name}"`);
        }) }, '▶ Aplicar ao projeto aberto') : null),
      routeErrors.length ? h('div', { class: 'errs', id: 'route-errors' }, ...routeErrors.map((e) => h('div', {}, '⚠ ' + e))) : null),
    h('div', { class: 'lanes', id: 'steps' }, ...LANES.map((ln, li) => h('div', { class: 'lane', 'data-lane': String(li) },
      h('div', { class: 'lanehead' }, h('span', { class: 'sicon' }, ln.icon), h('div', {}, h('strong', {}, ln.title), h('div', { class: 'muted' }, ln.hint))),
      ...d.steps.filter((s) => laneOf(s) === li).map(stepCard),
      h('button', { class: 'laneadd', 'data-act': 'step-add', onclick: () => addStep(li) }, '＋ Tarefa')))));
}

function uniqueId(d: Route, base: string): string {
  let id = base, n = 2; while (d.steps.some((s) => s.id === id)) id = `${base}-${n++}`; return id;
}
function newStep(kind: string, label: string, scope: 'project' | 'scene', deps: string[], cat: Catalog, meta: Meta): RouteStep {
  void meta;
  const id = kind.replace(/_/g, '-') + '-' + Math.random().toString(36).slice(2, 5);
  return { id, kind: kind as RouteStep['kind'], label, scope, dependsOn: deps, enabled: true, params: {}, retry: { max: 2, backoffMs: 3000 }, timeoutSec: MEDIA_KINDS.has(kind) ? 900 : 600, bindings: [defaultBinding(kind === 'stock_media' ? 'stock' : MEDIA_KINDS.has(kind) ? 'comfyui' : kind === 'transcribe' || kind === 'sfx' ? 'builtin' : 'harness', kind, cat)], ...(kind === 'sfx' ? { scope: 'scene' as const, optional: true, onFail: 'skip' as const } : {}) };
}
function wfFor(kind: string, cat: Catalog) { const cap = CAP_OF[kind]; return cat.workflows.filter((w) => !cap || w.capability === cap); }
function tplFor(kind: string, cat: Catalog) { const cap = CAP_OF[kind]; return cat.wan2gpTemplates.filter((w) => !cap || w.capability === cap); }
function defaultBinding(type: string, kind: string, cat: Catalog): Binding {
  switch (type) {
    case 'harness': return { type: 'harness', harness: 'auto', model: 'auto' };
    case 'comfyui': return { type: 'comfyui', server: cat.comfyServers[0] ?? 'local', workflow: wfFor(kind, cat)[0]?.file ?? '' };
    case 'wan2gp': return { type: 'wan2gp', template: tplFor(kind, cat)[0]?.file ?? '' };
    case 'api': { const cap = CAP_OF[kind] ?? 'text'; const a = cat.apis.find((x) => x.categories.includes(cap)) ?? cat.apis[0]; return { type: 'api', provider: a?.provider ?? '', model: a?.models[0] ?? '', ...(cap === 'voice' && a?.voices[0] ? { voice: a.voices[0] } : {}) }; }
    case 'stock': return { type: 'stock', sources: ['pexels', 'pixabay', 'wikipedia', 'openverse', 'nasa'], media: 'both' };
    case 'builtin': return { type: 'builtin', tool: kind === 'transcribe' ? 'whisper' : kind === 'subtitles' ? 'subtitles' : kind === 'edit' ? 'assemble' : kind === 'sfx' ? 'sfx-code' : 'estimate-words' };
    case 'flow': return { type: 'flow' };
    default: return { type: 'manual' };
  }
}

function sel(c: Ctx, options: Array<[string, string]>, value: string, on: (v: string) => void, attrs: Record<string, string> = {}) {
  const el = c.h('select', attrs, ...options.map(([v, l]) => c.h('option', { value: v }, l))) as HTMLSelectElement;
  if (!options.some(([v]) => v === value)) el.append(c.h('option', { value }, value || '(vazio)'));
  el.value = value; el.addEventListener('change', () => on(el.value)); return el;
}
function txt(c: Ctx, value: string, on: (v: string) => void, attrs: Record<string, string> = {}, list?: string[]) {
  const el = c.h('input', { value, ...attrs }) as HTMLInputElement;
  if (list?.length) { const id = 'dl' + Math.random().toString(36).slice(2, 7); const dl = c.h('datalist', { id }, ...list.map((x) => c.h('option', { value: x }))); el.setAttribute('list', id); el.after(dl); const w = c.h('span', {}, el, dl); el.addEventListener('input', () => on(el.value)); return w; }
  el.addEventListener('input', () => on(el.value)); return el;
}

/** Seletor de modelo restrito aos modelos carregados em Configurações. Valor antigo fora da lista fica visível e marcado. */
function selModel(c: Ctx, models: string[], value: string, on: (v: string) => void, attrs: Record<string, string> = {}, first: Array<[string, string]> = []) {
  const opts: Array<[string, string]> = [...first, ...models.filter((m) => !first.some(([v]) => v === m)).map((m) => [m, m] as [string, string])];
  const unknown = !!value && !opts.some(([v]) => v === value);
  if (unknown) opts.push([value, value + ' (não carregado)']);
  if (!opts.length) opts.push(['', '(nenhum modelo carregado — veja Configurações)']);
  const el = c.h('select', attrs, ...opts.map(([v, l]) => c.h('option', { value: v }, l))) as HTMLSelectElement;
  el.value = value; if (unknown) el.classList.add('bad');
  el.addEventListener('change', () => { el.classList.remove('bad'); on(el.value); });
  return el;
}

/** Lista de modelos carregados (chips removíveis + adicionar + oferta de modelos descobertos). Alimenta os seletores das rotas. */
function modelList(c: Ctx, items: string[], onChange: (next: string[]) => void, opts: { placeholder?: string; field?: string; label?: (v: string) => string; onPlay?: (v: string, btn: HTMLElement) => void } = {}) {
  const { h } = c;
  let cur = [...items]; let offered: string[] = [];
  const chips = h('div', { class: 'chips' });
  const picker = h('div', { class: 'row picker' });
  const input = h('input', { placeholder: opts.placeholder ?? 'adicionar modelo e Enter', 'data-field': opts.field ?? 'model-add' }) as HTMLInputElement;
  const paint = () => {
    chips.replaceChildren(...(cur.length
      ? cur.map((m) => {
        const text = opts.label?.(m) ?? m;
        const chip = h('span', { class: 'chip', 'data-model': m, title: text === m ? m : `${text} · ${m}` }, text,
          h('button', { class: 'x', title: 'Remover da lista', onclick: () => commit(cur.filter((x) => x !== m)) }, '×'));
        /* voz: ▶ gera uma amostra com o executor real (cacheada por voz+idioma) */
        return opts.onPlay
          ? h('span', { class: 'chipgrp' }, chip, h('button', { class: 'chip vspeak', title: 'Ouvir esta voz', onclick: (e: Event) => { e.stopPropagation(); opts.onPlay!(m, e.currentTarget as HTMLElement); } }, '▶'))
          : chip;
      })
      : [h('span', { class: 'muted' }, 'nenhum modelo carregado')]));
    const rest = offered.filter((m) => !cur.includes(m));
    if (!rest.length) { picker.replaceChildren(); return; }
    const dd = h('select', { 'data-field': (opts.field ?? 'model') + '-avail' }, ...rest.map((m) => h('option', { value: m }, m))) as HTMLSelectElement;
    picker.replaceChildren(h('span', { class: 'muted' }, rest.length + ' disponível(is):'), dd,
      h('button', { 'data-act': 'model-load', onclick: () => commit([...cur, dd.value]) }, 'Carregar'),
      h('button', { 'data-act': 'model-load-all', onclick: () => commit([...cur, ...rest]) }, 'Carregar todos'));
  };
  const commit = (next: string[]) => { cur = [...new Set(next)]; onChange([...cur]); paint(); };
  const add = () => { const v = input.value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean); if (!v.length) return; commit([...cur, ...v]); input.value = ''; input.focus(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
  paint();
  const el = h('div', { class: 'modellist' }, chips,
    h('div', { class: 'row' }, input, h('button', { 'data-act': 'model-add', onclick: add }, '+ Adicionar'), h('button', { class: 'danger', 'data-act': 'model-clear', onclick: () => commit([]) }, 'Limpar lista')),
    picker);
  return {
    el,
    offer: (list: string[]) => { offered = [...new Set(list)]; paint(); return offered.filter((m) => !cur.includes(m)).length; },
    load: (list: string[]) => { commit([...cur, ...list]); offered = []; paint(); },
  };
}

type ProviderConfigUi = Settings['providers'][number];
/** Só separa por aba quando todos os modelos têm categoria; senão mantém o comportamento antigo. */
function providerModelsFor(p: ProviderConfigUi, tab: string): string[] {
  const cats = p.categories ?? ['text', 'image', 'voice'];
  const map = p.modelCategories;
  if (!map || cats.length <= 1 || !p.models.every((m) => !!map[m])) return p.models;
  return p.models.filter((m) => !map[m] || map[m] === tab);
}
function setProviderModelsFor(p: ProviderConfigUi, tab: string, next: string[]): void {
  const cats = p.categories ?? ['text', 'image', 'voice'];
  const map = p.modelCategories;
  if (!map || cats.length <= 1 || !p.models.every((m) => !!map[m])) { p.models = next; return; }
  const keep = p.models.filter((m) => map[m] && map[m] !== tab);
  for (const m of next) map[m] = tab as ApiCategory;
  p.models = [...new Set([...keep, ...next])];
}

function stepEditor(c: Ctx, d: Route, st: RouteStep, si: number, cat: Catalog, meta: Meta, redraw: () => void): HTMLElement {
  const { h } = c;
  const isMedia = MEDIA_KINDS.has(st.kind);
  const label = h('input', { value: st.label, class: 'wide' }) as HTMLInputElement; label.addEventListener('input', () => { st.label = label.value; });
  const idIn = h('input', { value: st.id, 'data-field': 'step-id' }) as HTMLInputElement;
  idIn.addEventListener('change', () => {
    const nv = idIn.value.trim().replace(/[^a-z0-9_-]/gi, '-'); if (!nv || nv === st.id || d.steps.some((x) => x.id === nv)) { idIn.value = st.id; return; }
    for (const o of d.steps) o.dependsOn = o.dependsOn.map((x) => (x === st.id ? nv : x)); st.id = nv; redraw();
  });
  const deps = h('div', { class: 'deps' }, ...d.steps.filter((o) => o.id !== st.id).map((o) => {
    const cb = h('input', { type: 'checkbox' }) as HTMLInputElement; cb.checked = st.dependsOn.includes(o.id);
    cb.addEventListener('change', () => { st.dependsOn = cb.checked ? [...st.dependsOn, o.id] : st.dependsOn.filter((x) => x !== o.id); });
    return h('label', { class: 'inline chk' }, cb, o.id);
  }));
  const move = (dx: number) => { const j = si + dx; if (j < 0 || j >= d.steps.length) return; [d.steps[si], d.steps[j]] = [d.steps[j]!, d.steps[si]!]; redraw(); };
  const enabled = h('input', { type: 'checkbox' }) as HTMLInputElement; enabled.checked = st.enabled; enabled.addEventListener('change', () => { st.enabled = enabled.checked; });
  const retry = h('input', { type: 'number', min: '1', value: String(st.retry.max), class: 'num' }) as HTMLInputElement; retry.addEventListener('input', () => { st.retry.max = Math.max(1, Number(retry.value) || 1); });
  const tmo = h('input', { type: 'number', min: '10', value: String(st.timeoutSec), class: 'num' }) as HTMLInputElement; tmo.addEventListener('input', () => { st.timeoutSec = Math.max(10, Number(tmo.value) || 600); });
  const onfail = sel(c, [['stop', 'parar a rota'], ['skip', 'pular e seguir']], st.onFail ?? 'stop', (v) => { st.onFail = v as 'stop' | 'skip'; });
  const scopeSel = sel(c, [['project', 'projeto'], ['scene', 'por cena']], st.scope, (v) => { st.scope = v as 'project' | 'scene'; });

  const rows = st.bindings.map((b, bi) => bindingEditor(c, st, b, bi, cat, meta, redraw));
  const addType = h('select', { 'data-field': 'bind-type' }, ...[['harness', 'Provedor (IA de texto/código)'], ['comfyui', 'ComfyUI'], ['wan2gp', 'Wan2GP'], ['api', 'API'], ['stock', 'Banco de mídia'], ['builtin', 'Ferramenta interna'], ['manual', 'Manual'], ['flow', 'Google Flow (conta)']].filter(([t]) => (t !== 'stock' || st.kind === 'stock_media') && (t !== 'flow' || FLOW_KINDS.has(st.kind))).map(([v, l]) => h('option', { value: v! }, l!))) as HTMLSelectElement;

  return h('div', { class: 'card step', 'data-step': st.id },
    h('div', { class: 'row' },
      h('span', { class: 'tag' }, `${si + 1}`), h('label', { class: 'inline' }, enabled, 'ativa'),
      h('label', { class: 'grow' }, 'Tarefa', label), h('label', {}, 'id', idIn),
      h('label', {}, 'Tipo', sel(c, meta.stepKinds.map((k) => [k, KIND_LABEL[k] ?? k] as [string, string]), st.kind, (v) => { st.kind = v as RouteStep['kind']; redraw(); }, { 'data-field': 'step-kind' })),
      h('label', {}, 'Escopo', scopeSel),
      h('button', { class: 'small', title: 'subir', onclick: () => move(-1) }, '↑'), h('button', { class: 'small', title: 'descer', onclick: () => move(1) }, '↓'),
      h('button', { class: 'small danger', 'data-act': 'step-del', onclick: () => {
        if (d.steps.length <= 1) return c.toast('A rota precisa de ao menos uma tarefa.', true);
        d.steps = d.steps.filter((x) => x !== st); for (const o of d.steps) o.dependsOn = o.dependsOn.filter((x) => x !== st.id); redraw();
      } }, '✕')),
    h('div', { class: 'row' }, h('label', {}, 'Depende de', deps), h('label', {}, 'Tentativas', retry), h('label', {}, 'Timeout (s)', tmo), h('label', {}, 'Se falhar', onfail)),
    h('div', { class: 'muted' }, isMedia ? 'Cadeia de executores — o 1º é o principal, os seguintes são fallback. Escolha o provedor (ComfyUI / Wan2GP / API) e o tipo de modelo.' : 'Cadeia de executores — o 1º é o principal, os seguintes são fallback. Provedor e modelo podem ser "auto".'),
    ...rows,
    st.kind === 'narration' ? voicePanel(c, st, cat, meta, redraw) : null,
    h('div', { class: 'row' }, addType, h('button', { class: 'small', 'data-act': 'bind-add', onclick: () => { st.bindings.push(defaultBinding(addType.value, st.kind, cat)); redraw(); } }, '+ fallback / executor')));
}

/** Vozes padrão quando o provedor OpenAI-compatível não listou as suas. */
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
/** Modelos de voz do Fish Audio (header `model`; `s2.1-pro-free` = nível gratuito). */
export const FISH_TTS_MODELS = ['s2.1-pro-free', 's2.1-pro', 's2-pro', 's1', 'drama-3'];
export const GEMINI_VOICES = ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];
const apiVoices = (a?: Catalog['apis'][number]) => a?.voices.length ? a.voices : a?.kind === 'openai' ? OPENAI_VOICES : a?.kind === 'gemini' ? GEMINI_VOICES : [];
/** Idioma das prévias de voz: o do projeto aberto (ou o último escolhido). */
let previewLang = '';

/**
 * Etapa de narração: escolha da voz. Local (ComfyUI / Wan2GP / IA de código) → arquivos da pasta
 * voices do app, com prévia. API → vozes do provedor. A escolha vale para toda a cadeia de executores.
 */
function voicePanel(c: Ctx, st: RouteStep, cat: Catalog, meta: Meta, redraw: () => void): HTMLElement {
  const { h } = c;
  const params = (st.params ??= {}) as Record<string, unknown>;
  const local = st.bindings.some((b) => b.type === 'comfyui' || b.type === 'wan2gp' || b.type === 'harness');
  const apis = st.bindings.filter((b): b is Extract<Binding, { type: 'api' }> => b.type === 'api');
  const curRef = (st.bindings.find((b) => (b.type === 'comfyui' || b.type === 'wan2gp') && b.refAudio) as { refAudio?: string } | undefined)?.refAudio ?? (params.voiceRef as string | undefined) ?? '';
  const url = (p: string) => (c.forge.mediaUrl as unknown as (x: string) => string)(p);
  let audio: HTMLAudioElement | undefined;
  const play = (p: string, btn: HTMLElement) => {
    if (audio && !audio.paused) { audio.pause(); document.querySelectorAll('.voice-card .vplay').forEach((x) => { x.textContent = '▶'; }); if (audio.dataset.p === p) return; }
    audio = new Audio(url(p)); audio.dataset.p = p; btn.textContent = '⏸'; audio.onended = () => { btn.textContent = '▶'; }; void audio.play().catch(() => c.toast('Não foi possível tocar a prévia.', true));
  };
  const setRef = (p: string) => {
    for (const b of st.bindings) if (b.type === 'comfyui' || b.type === 'wan2gp') { if (p) b.refAudio = p; else delete b.refAudio; }
    if (p) params.voiceRef = p; else delete params.voiceRef;
    redraw();
  };
  const voices = meta.voices ?? [];
  previewLang ||= c.current()?.language ?? 'pt-BR';
  const lang = sel(c, LANGS, previewLang, (v) => { previewLang = v; }, { 'data-field': 'voice-lang' });
  /* ouvir FALANDO no idioma: sintetiza uma frase com o executor real da etapa */
  const speak = (b: Binding, btn: HTMLElement) => void c.guard(async () => {
    const old = btn.textContent; btn.textContent = '…'; btn.setAttribute('disabled', '');
    try {
      const f = (await c.forge['voicePreview']({ binding: b, language: previewLang })) as string;
      audio?.pause(); audio = new Audio(url(f) + '?t=' + Date.now()); await audio.play();
    } finally { btn.textContent = old; btn.removeAttribute('disabled'); }
  });
  const localExec = st.bindings.find((b) => b.type === 'comfyui' || b.type === 'wan2gp');
  const localCards = h('div', { class: 'voice-grid' },
    h('button', { class: `voice-card${curRef ? '' : ' on'}`, 'data-voice': '', onclick: () => setRef('') }, h('span', { class: 'vic' }, '🎚️'), h('span', { class: 'vname' }, 'Padrão do modelo')),
    ...voices.map((v) => h('div', { class: `voice-card${curRef === v.path ? ' on' : ''}`, 'data-voice': v.name },
      h('button', { class: 'vplay', title: 'ouvir', onclick: (e: Event) => { e.stopPropagation(); play(v.path, e.currentTarget as HTMLElement); } }, '▶'),
      h('button', { class: 'vpick', onclick: () => setRef(v.path) }, h('span', { class: 'vname' }, v.name.replace(/\.(mp3|wav|m4a|flac|ogg)$/i, '')), curRef === v.path ? h('span', { class: 'tag done' }, 'escolhida') : null),
      localExec ? h('button', { class: 'vspeak', title: 'Ouvir esta voz falando no idioma escolhido (gera uma frase curta no ComfyUI/Wan2GP)', onclick: (e: Event) => speak({ ...localExec, refAudio: v.path } as Binding, e.currentTarget as HTMLElement) }, '🗣') : null)));
  const apiRows = apis.map((b) => {
    const a = cat.apis.find((x) => x.provider === b.provider);
    const list = apiVoices(a);
    const label = (v: string) => a?.voiceLabels?.[v] ?? v;
    return h('div', { class: 'row' }, h('strong', {}, `☁️ ${b.provider} · ${b.model}`),
      list.length ? h('div', { class: 'voice-chips' }, ...list.map((v) => h('span', { class: `chipgrp${(b.voice ?? '') === v ? ' on' : ''}` },
        h('button', { class: `chip${(b.voice ?? '') === v ? ' on' : ''}`, 'data-api-voice': v, title: label(v) === v ? v : `${label(v)} · ${v}`, onclick: () => { b.voice = v; redraw(); } }, label(v)),
        h('button', { class: 'chip vspeak', title: `Ouvir ${label(v)} falando no idioma escolhido`, onclick: (e: Event) => speak({ ...b, voice: v }, e.currentTarget as HTMLElement) }, '▶'))))
        : h('span', { class: 'muted' }, 'Este provedor não listou vozes — cadastre em Configurações → APIs → Voz.'));
  });
  return h('div', { class: 'card voice-panel', 'data-voice-panel': '' },
    h('div', { class: 'row' }, h('strong', {}, '🎙️ Voz da narração'), h('span', { class: 'sp' }), h('label', { class: 'inline', title: 'Idioma da frase de prévia — por padrão o do projeto' }, '🗣 ouvir em', lang)),
    h('div', { class: 'muted' }, '🗣 / ▶ ao lado de cada voz = ouvir a voz FALANDO no idioma escolhido (usa o executor real: API, OmniVoice/ComfyUI ou Wan2GP).'),
    local ? h('div', {}, h('div', { class: 'muted' }, voices.length ? 'Voz de referência (clonagem) para ComfyUI / Wan2GP — arquivos da pasta voices do app. ▶ ouve a prévia.' : 'Coloque arquivos de voz (.wav/.mp3) na pasta voices do workspace para escolhê-los aqui.'), localCards) : null,
    ...apiRows,
    !local && !apis.length ? h('span', { class: 'muted' }, 'Adicione um executor ComfyUI, Wan2GP ou API para escolher a voz.') : null);
}

function bindingEditor(c: Ctx, st: RouteStep, b: Binding, bi: number, cat: Catalog, meta: Meta, redraw: () => void): HTMLElement {
  const { h } = c;
  const typeSel = sel(c, [['harness', 'Provedor'], ['comfyui', 'ComfyUI'], ['wan2gp', 'Wan2GP'], ['api', 'API'], ['stock', 'Banco de mídia'], ['builtin', 'Ferramenta interna'], ['manual', 'Manual'], ...(FLOW_KINDS.has(st.kind) ? [['flow', 'Google Flow (conta)'] as [string, string]] : [])], b.type,
    (v) => { st.bindings[bi] = defaultBinding(v, st.kind, cat); redraw(); }, { 'data-field': 'bind-kind' });
  const fields: Child[] = [];
  const bb = b as unknown as Record<string, unknown>;
  const set = (k: string) => (v: string) => { bb[k] = v; };
  switch (b.type) {
    case 'harness': {
      const hv = cat.harnesses.find((x) => x.id === b.harness);
      const model = b.model ?? 'auto';
      const showEffort = modelSupportsEffort(b.harness, model === 'auto' ? undefined : model);
      fields.push(h('label', {}, 'Provedor', sel(c, [['auto', 'auto (primeiro disponível)'], ...meta.harnessIds.map((x) => [x, x] as [string, string])], b.harness, (v) => {
        b.harness = v as typeof b.harness; b.model = 'auto'; delete b.effort; redraw();
      }, { 'data-field': 'harness' })),
        h('label', {}, 'Modelo', selModel(c, b.harness === 'auto' ? [] : (hv?.models ?? []), model, (v) => {
          b.model = v;
          if (!modelSupportsEffort(b.harness, v === 'auto' ? undefined : v)) delete b.effort;
          redraw();
        }, { 'data-field': 'model' }, [['auto', 'auto (padrão do provedor)']])),
        showEffort ? h('label', { title: 'Esforço de raciocínio; Default não envia nada e usa o padrão do modelo.' }, 'Esforço',
          sel(c, EFFORT_OPTIONS, b.effort ?? '', (v) => {
            if (v) b.effort = v as ReasoningEffort; else delete b.effort;
          }, { 'data-field': 'effort' })) : null);
      break;
    }
    case 'comfyui': {
      const wfs = wfFor(st.kind, cat);
      fields.push(h('label', {}, 'Servidor', sel(c, cat.comfyServers.map((x) => [x, x] as [string, string]), b.server, set('server'))),
        h('label', {}, 'Modelo / workflow', sel(c, wfs.map((w) => [w.file, `${w.label} (${w.file})`] as [string, string]), b.workflow, set('workflow'), { 'data-field': 'workflow' })));
      if (st.kind === 'narration') {
        const voices = meta.voices ?? [];
        fields.push(h('label', {}, 'Voz (referência)', sel(c,
          [['', '(padrão do workflow)'], ...voices.map((v) => [v.path, v.name] as [string, string])],
          b.refAudio ?? '', (v) => { b.refAudio = v || undefined; }, { 'data-field': 'refAudio' })));
      }
      break;
    }
    case 'wan2gp': {
      const ts = tplFor(st.kind, cat);
      fields.push(h('label', {}, 'Modelo Wan2GP', sel(c, ts.map((w) => [w.file, `${w.label}${w.modelType ? ' · ' + w.modelType : ''}`] as [string, string]), b.template, set('template'), { 'data-field': 'template' })));
      { const mt = ts.find((w) => w.file === b.template)?.modelType; if (mt && cat.wan2gpModels.length && !cat.wan2gpModels.some((m) => m.model === mt)) fields.push(h('span', { class: 'tag failed', title: 'Carregue este model_type em Configurações → ComfyUI / Wan2GP' }, mt + ' não carregado')); }
      break;
    }
    case 'api': {
      const cap = CAP_OF[st.kind] ?? 'text';
      const modelsFor = (a?: Catalog['apis'][number]) => {
        const list = a?.models ?? [];
        if (!a?.modelCategories) return list;
        return list.filter((m) => !a.modelCategories![m] || a.modelCategories![m] === cap);
      };
      const prov = cat.apis.filter((a) => a.categories.includes(cap) || cap === 'text');
      const cur = cat.apis.find((a) => a.provider === b.provider);
      fields.push(h('label', {}, 'Provedor', sel(c, (prov.length ? prov : cat.apis).map((a) => [a.provider, `${a.provider} (${a.kind})`] as [string, string]), b.provider, (v) => { b.provider = v; const np = cat.apis.find((a) => a.provider === v); b.model = modelsFor(np)[0] ?? ''; if (cap === 'voice') b.voice = np?.voices[0]; redraw(); }, { 'data-field': 'provider' })),
        h('label', {}, 'Modelo', selModel(c, modelsFor(cur), b.model, (v) => { b.model = v; }, { 'data-field': 'model' })),
        cap === 'voice' ? h('label', {}, 'Voz', selModel(c, apiVoices(cur), b.voice ?? '', (v) => { b.voice = v; }, { 'data-field': 'voice' })) : null);
      break;
    }
    case 'stock': {
      fields.push(...STOCK_SOURCES.map((x) => x.id).map((s) => {
        const cb = h('input', { type: 'checkbox' }) as HTMLInputElement; cb.checked = b.sources.includes(s);
        cb.addEventListener('change', () => { b.sources = cb.checked ? [...b.sources, s] : b.sources.filter((x) => x !== s); });
        return h('label', { class: 'inline chk', title: stockInfo(s)?.about ?? '' }, cb, `${stockInfo(s)?.icon ?? ''} ${stockInfo(s)?.label ?? s}`);
      }), h('label', {}, 'Mídia', sel(c, [['both', 'imagens e vídeos'], ['image', 'só imagens'], ['video', 'só vídeos']], b.media, (v) => { b.media = v as typeof b.media; })));
      break;
    }
    case 'flow':
      fields.push(h('label', {}, 'Conta Google', sel(c, [['', 'primeira conta com login'], ...(cat.flowAccounts ?? []).map((a) => [a.id, `${a.label}${a.email ? ` (${a.email})` : ''}`] as [string, string])], b.account ?? '', (v) => { if (v) b.account = v; else delete b.account; }, { 'data-field': 'flow-account' })),
        h('span', { class: 'muted' }, (cat.flowAccounts ?? []).length ? 'Gera no Google Flow pelo navegador da conta (Automações).' : 'Adicione uma conta em Automações e faça o login.'));
      break;
    case 'builtin':
      fields.push(h('label', {}, 'Ferramenta', sel(c, cat.builtinTools.map((x) => [x, x] as [string, string]), b.tool, (v) => { b.tool = v as typeof b.tool; })));
      break;
    default: fields.push(h('span', { class: 'muted' }, 'Etapa manual: você fornece o arquivo.'));
  }
  const mv = (dx: number) => { const j = bi + dx; if (j < 0 || j >= st.bindings.length) return; [st.bindings[bi], st.bindings[j]] = [st.bindings[j]!, st.bindings[bi]!]; redraw(); };
  const art = bindingArt(b);
  return h('div', { class: 'bind', 'data-bind': String(bi) },
    h('span', { class: 'tag' }, bi === 0 ? '① principal' : `↳ fallback ${bi}`),
    h('button', { class: 'pick', 'data-act': 'bind-pick', title: 'Escolher o executor numa janela com cartões ilustrados', onclick: () => void openBindingPicker({ forge: c.forge, toast: c.toast }, {
      step: st, current: b, onPick: (nb) => { st.bindings[bi] = nb; redraw(); },
    }) }, h('span', { class: 'picon' }, artIcon(art.icon)), ' Escolher…'),
    h('label', {}, 'Executor', typeSel), ...fields,
    h('button', { class: 'small', onclick: () => mv(-1) }, '↑'), h('button', { class: 'small', onclick: () => mv(1) }, '↓'),
    h('button', { class: 'small danger', 'data-act': 'bind-del', onclick: () => { st.bindings.splice(bi, 1); redraw(); } }, '✕'));
}

/* ═════════════════ SKILL A PARTIR DE VÍDEOS ═════════════════ */
/**
 * Janela: links (ou arquivos) de vídeos de referência + ângulo(s) do assunto + provedor com visão.
 * O app baixa, extrai quadros/transcrição, o provedor escreve a skill e o app salva com nome único.
 */
export async function openSkillFromVideos(c: Ctx, onDone: (k: Skill) => void, prefill: string[] = [], pre?: { harness: string; model: string }) {
  const { h, forge, toast } = c;
  const cat = (await forge['catalog']()) as Catalog;
  const status = ((await forge['detectHarnesses']().catch(() => ({}))) ?? {}) as Record<string, { installed: boolean }>;
  const files: string[] = [];
  const liveModels: Record<string, string[]> = {};
  const angles = new Set<string>();
  let harness = pre?.harness && (pre.harness === 'auto' || cat.harnesses.some((x) => x.id === pre.harness)) ? pre.harness : cat.harnesses.some((x) => x.id === 'antigravity') ? 'antigravity' : 'auto';
  let model = pre?.harness === harness && pre.model ? pre.model : cat.harnesses.find((x) => x.id === harness)?.models.find((m) => /medium|flash/i.test(m)) ?? '';
  const links = h('textarea', { id: 'sv-links', rows: '3', placeholder: 'Um link por linha (YouTube, TikTok, Instagram, Vimeo…) — até 5 vídeos' }) as HTMLTextAreaElement;
  links.value = prefill.join('\n');
  const name = h('input', { id: 'sv-name', placeholder: 'Nome da skill (opcional — a IA sugere um nome único)', class: 'grow' }) as HTMLInputElement;
  const note = h('input', { id: 'sv-angle-note', placeholder: 'Opcional: detalhe o ângulo (ex.: "foco em quem nunca jogou", "tom irônico")', class: 'grow' }) as HTMLInputElement;
  const lang = sel(c, LANGS, 'pt-BR', () => {}, { id: 'sv-lang' });
  const fileBox = h('div', { class: 'pchips' });
  const harnessBox = h('div', { class: 'ptiles' });
  const modelBox = h('span', {});
  const log = h('pre', { class: 'pvtext svlog', id: 'sv-log' });
  const out = h('div', { id: 'sv-out' });
  const paintFiles = () => fileBox.replaceChildren(...files.map((f, i) => h('span', { class: 'chip' }, '🎞 ' + f.split(/[\\/]/).pop(), h('button', { class: 'x', onclick: () => { files.splice(i, 1); paintFiles(); } }, '×'))));
  const paintHarness = () => {
    /* inclui os modelos locais (Ollama/LM Studio/llama.cpp): recebem os quadros como imagens — use um modelo com visão */
    harnessBox.replaceChildren(...['auto', ...cat.harnesses.map((x) => x.id)].map((id) => {
      const art = bindingArt({ type: 'harness', harness: id as HarnessBinding['harness'] });
      const st = status[id];
      return h('button', { class: `ptile small${harness === id ? ' sel' : ''}`, 'data-sv-harness': id, onclick: () => { const ms = cat.harnesses.find((x) => x.id === id)?.models ?? []; harness = id; model = (['ollama', 'lmstudio', 'llamacpp'].includes(id) ? ms.find((m) => /vl|vision|llava|gemma3|minicpm-v/i.test(m)) : undefined) ?? ms.find((m) => /medium|flash/i.test(m)) ?? ''; paintHarness(); } },
        h('span', { class: 'picon' }, artIcon(art.icon)), h('span', { class: 'ptxt' }, h('strong', {}, art.title, st ? h('span', { class: `pdot ${st.installed ? 'ok' : 'bad'}` }) : ''), h('span', { class: 'muted' }, art.where)));
    }));
    const hid = harness;
    if (['ollama', 'lmstudio', 'llamacpp'].includes(hid) && !liveModels[hid]) {
      liveModels[hid] = [];
      void forge['harnessModels'](hid).then((r: unknown) => { liveModels[hid] = Array.isArray(r) ? (r as string[]) : ((r as { models?: string[] })?.models ?? []);
        if (!model) model = liveModels[hid]!.find((m) => /vl|vision|llava|gemma3|minicpm-v/i.test(m)) ?? ''; if (harness === hid) paintHarness(); }).catch(() => {});
    }
    const models = [...new Set([...(cat.harnesses.find((x) => x.id === harness)?.models ?? []), ...(liveModels[hid] ?? [])])];
    const ms = sel(c, [['', 'modelo padrão do provedor'], ...models.map((m) => [m, m] as [string, string])], model, (v) => { model = v; }, { id: 'sv-model' });
    modelBox.replaceChildren(harness === 'auto' ? '' : h('label', {}, 'Modelo (com visão)', ms));
  };
  paintHarness();
  const angleGrid = h('div', { class: 'anglegroups', id: 'sv-angles' }, ...ANGLE_GROUPS.map((g) => h('div', { class: 'anglegroup' },
    h('strong', {}, `${g.icon} ${g.label}`),
    h('div', { class: 'pchips' }, ...g.angles.map((a) => {
      const b = h('button', { class: 'chip anglechip', 'data-angle': a.id, title: a.hint, onclick: () => { angles.has(a.id) ? angles.delete(a.id) : angles.add(a.id); b.classList.toggle('on', angles.has(a.id)); count.textContent = angles.size ? `${angles.size} ângulo(s): ${[...angles].map(angleLabel).join(', ')}` : 'Nenhum ângulo: mantém a abordagem do original'; } }, a.label);
      return b;
    })))));
  const count = h('div', { class: 'muted', id: 'sv-angle-count' }, 'Nenhum ângulo: mantém a abordagem do original');
  let off: (() => void) | undefined;
  const close = () => { off?.(); bg.remove(); };
  const go = h('button', { class: 'primary', id: 'sv-go', onclick: () => void (async () => {
    const ls = links.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!ls.length && !files.length) { toast('Cole ao menos um link ou escolha um arquivo.', true); return; }
    go.setAttribute('disabled', ''); log.textContent = ''; out.replaceChildren(h('div', { class: 'muted' }, '⏳ Baixando, extraindo quadros e transcrição, e analisando… Os arquivos baixados são apagados quando a skill fica pronta.'));
    off = (forge as unknown as { onEvent: (cb: (e: { t: string; stepId?: string; line?: string }) => void) => () => void }).onEvent((e) => { if (e.t === 'log' && e.stepId === 'skillgen' && e.line) { log.textContent += e.line + '\n'; log.scrollTop = log.scrollHeight; } });
    try {
      const r = (await forge['skillFromVideos']({ links: ls, files, angles: [...angles], angleNote: note.value, harness, model: model || undefined, name: name.value, language: lang.value })) as { skill: Skill; routeName: string; routeReason: string; warnings: string[] };
      out.replaceChildren(h('div', { class: 'card svresult' },
        h('div', { class: 'row' }, h('span', { class: 'sicon big' }, APPEAR_ICON[r.skill.appearance ?? 'custom'] ?? '🧠'), h('div', { class: 'grow' }, h('strong', {}, `✓ Skill "${r.skill.name}" criada`), h('div', { class: 'muted' }, r.skill.description))),
        h('div', {}, h('strong', {}, '🛣️ Rota sugerida: '), r.routeName, r.routeReason ? h('span', { class: 'muted' }, ` — ${r.routeReason}`) : ''),
        ...r.warnings.map((w) => h('div', { class: 'tag running' }, '⚠ ' + w)),
        h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Fechar'), h('button', { class: 'primary', onclick: () => { close(); onDone(r.skill); } }, 'Abrir a skill'))));
      toast(`Skill "${r.skill.name}" criada`);
    } catch (e) { out.replaceChildren(h('div', { class: 'tag failed' }, '⛔ ' + (e as Error).message)); }
    finally { go.removeAttribute('disabled'); off?.(); off = undefined; }
  })() }, '🎬 Analisar vídeos e criar a skill');
  const bg = h('div', { class: 'modal-bg', id: 'skill-videos-modal' }, h('div', { class: 'modal pmodal' },
    h('div', { class: 'row' }, h('h3', {}, '🎬 Nova skill a partir de vídeos'), h('span', { class: 'sp' }), h('button', { onclick: () => { void forge['skillFromVideosCancel']().catch(() => {}); close(); } }, '✕')),
    h('p', { class: 'muted' }, 'O app baixa os vídeos (até 10 min cada), extrai quadros-chave e a transcrição (e apaga tudo isso no fim), e um provedor com visão escreve uma skill no padrão do Dark Automate — copiando o ESTILO (estrutura, ritmo, visual, tom), nunca o conteúdo. A skill é salva com um nome único e já vem com a rota sugerida.'),
    h('h4', {}, '1 · Vídeos de referência'), links,
    h('div', { class: 'row' }, h('button', { id: 'sv-file', onclick: () => void (async () => {
      const f = (await forge['openFile']({ title: 'Vídeo de referência', filters: [{ name: 'Vídeo', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] })) as string | null;
      if (f) { files.push(f); paintFiles(); }
    })() }, '＋ Arquivo local'), fileBox),
    h('h4', {}, '2 · Ângulo do assunto (escolha um ou mais)'), count, angleGrid, h('div', { class: 'row' }, note),
    h('h4', {}, '3 · Quem analisa (precisa enxergar imagens)'), harnessBox, h('div', { class: 'row' }, modelBox, h('label', {}, 'Idioma dos vídeos', lang), name),
    h('div', { class: 'row actions pfoot' }, h('span', { class: 'sp' }), go), log, out));
  document.body.append(bg);
}

/** Skill a partir de um documento de prompts (.docx/.md/.txt): harness/modelo escolhidos, rota sugerida. */
/** Importar SKILL.md (formato Claude): arquivo, pasta, .zip ou link do GitHub → plugin + skill + rota. */
async function openImportClaudeSkill(c: Ctx, onDone: (k: Skill) => void) {
  const { h, forge, toast } = c;
  const cat = (await forge['catalog']()) as Catalog;
  const routes = (await forge['listRoutes']()) as Route[];
  const src = h('input', { id: 'ci-src', class: 'grow', placeholder: 'Caminho do SKILL.md, da pasta ou do .zip — ou link do GitHub (ex.: https://github.com/dono/repo)' }) as HTMLInputElement;
  const pickFile = h('button', { id: 'ci-file', onclick: () => void (async () => { const f = (await forge['openFile']({ title: 'SKILL.md ou pacote', filters: [{ name: 'Skill do Claude', extensions: ['md', 'zip', 'skill', 'plugin'] }] })) as string | null; if (f) src.value = f; })() }, '📄 Arquivo…');
  const pickDir = h('button', { id: 'ci-dir', onclick: () => void (async () => { const d = (await forge['openDir']({ title: 'Pasta da skill (com SKILL.md) ou do plugin' })) as string | null; if (d) src.value = d; })() }, '📂 Pasta…');
  const route = sel(c, routes.map((r) => [r.id, r.name] as [string, string]), routes.some((r) => r.id === 'explainer-mixed') ? 'explainer-mixed' : routes[0]?.id ?? '', () => {}, { id: 'ci-route' });
  const lang = sel(c, LANGS, 'pt-BR', () => {}, { id: 'ci-lang' });
  const name = h('input', { id: 'ci-name', placeholder: 'Nome (opcional)' }) as HTMLInputElement;
  const hs = ['', 'auto', ...cat.harnesses.map((x) => x.id)];
  const harness = sel(c, hs.map((x) => [x, x === '' ? 'não (conversão direta, sem IA)' : x === 'auto' ? 'auto (primeiro disponível)' : x] as [string, string]), '', () => {}, { id: 'ci-harness' });
  const log = h('pre', { class: 'pvtext svlog', id: 'ci-log' });
  const out = h('div', { id: 'ci-out' });
  let off: (() => void) | undefined;
  const close = () => { off?.(); bg.remove(); };
  const go = h('button', { class: 'primary', id: 'ci-go', onclick: () => void (async () => {
    if (!src.value.trim()) { toast('Escolha o SKILL.md, a pasta ou cole o link.', true); return; }
    go.setAttribute('disabled', ''); log.textContent = ''; out.replaceChildren(h('div', { class: 'muted' }, '⏳ Instalando o plugin e criando a skill e a rota…'));
    off = (forge as unknown as { onEvent: (cb: (e: { t: string; stepId?: string; line?: string }) => void) => () => void }).onEvent((e) => { if (e.t === 'log' && e.stepId === 'skillgen' && e.line) { log.textContent += e.line + '\n'; log.scrollTop = log.scrollHeight; } });
    try {
      const r = (await forge['importClaudeSkill']({ source: src.value.trim(), routeId: route.value || undefined, language: lang.value, name: name.value.trim() || undefined, harness: harness.value || undefined })) as { plugin: { name: string; displayName?: string }; skills: Skill[]; routes: Route[]; warnings: string[] };
      out.replaceChildren(h('div', { class: 'card svresult' },
        h('strong', {}, `✓ ${r.skills.length} skill(s) importada(s) — plugin "${r.plugin.displayName ?? r.plugin.name}"`),
        ...r.skills.map((k, i) => h('div', {}, h('strong', {}, `🧠 ${k.name}`), h('span', { class: 'muted' }, ` · 🛣️ ${r.routes[i]?.name ?? ''} · etapas: ${Object.keys(k.steps).join(', ') || 'diretriz geral'}`))),
        ...r.warnings.map((w) => h('div', { class: 'tag running' }, '⚠ ' + w)),
        h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Fechar'), r.skills[0] ? h('button', { class: 'primary', onclick: () => { close(); onDone(r.skills[0]!); } }, 'Abrir a skill') : null)));
      toast(`Skill "${r.skills[0]?.name ?? ''}" importada`);
    } catch (e) { out.replaceChildren(h('div', { class: 'tag failed' }, '⛔ ' + (e as Error).message)); }
    finally { go.removeAttribute('disabled'); off?.(); off = undefined; }
  })() }, '📥 Importar');
  const bg = h('div', { class: 'modal-bg', id: 'skill-claude-modal' }, h('div', { class: 'modal pmodal' },
    h('div', { class: 'row' }, h('h3', {}, '📥 Importar skill (SKILL.md do Claude)'), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
    h('p', { class: 'muted' }, 'A pasta inteira da skill (SKILL.md + sub-skills, referências e modelos) vira um plugin; o Dark Automate cria uma skill ligada a ele — cada etapa aponta para a sub-skill certa (roteiro, gancho, thumbnail, SEO…) — e uma rota própria, cópia da rota-base escolhida, para você ajustar.'),
    h('div', { class: 'row' }, src, pickFile, pickDir),
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Rota-base (será copiada)', route), h('label', {}, 'Idioma dos vídeos', lang), name),
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Refinar as instruções por etapa com IA (opcional)', harness)),
    h('div', { class: 'row actions pfoot' }, h('span', { class: 'sp' }), go), log, out));
  document.body.append(bg);
}

async function openSkillFromDoc(c: Ctx, onDone: (k: Skill) => void) {
  const { h, forge, toast } = c;
  const cat = (await forge['catalog']()) as Catalog;
  const routes = (await forge['listRoutes']()) as Route[];
  let file = '';
  const fileLbl = h('span', { class: 'muted', id: 'sd-file' }, 'nenhum arquivo');
  const hs = ['auto', ...cat.harnesses.map((x) => x.id)];
  const harness = sel(c, hs.map((x) => [x, x === 'auto' ? 'auto (primeiro disponível)' : x] as [string, string]), hs.includes('antigravity') ? 'antigravity' : 'auto', () => paintModels(), { id: 'sd-harness' });
  const modelBox = h('span', {});
  let model = '';
  const paintModels = () => {
    const ms = cat.harnesses.find((x) => x.id === harness.value)?.models ?? [];
    if (!ms.includes(model)) model = ms.find((m) => /flash-medium|medium|sonnet/i.test(m)) ?? '';
    modelBox.replaceChildren(h('label', {}, 'Modelo', sel(c, [['', 'modelo padrão do provedor'], ...ms.map((m) => [m, m] as [string, string])], model, (v) => { model = v; }, { id: 'sd-model' })));
  };
  paintModels();
  const route = sel(c, [['', 'a IA escolhe'], ...routes.map((r) => [r.id, r.name] as [string, string])], routes.some((r) => r.id === 'kit-2d-cinematic') ? 'kit-2d-cinematic' : '', () => {}, { id: 'sd-route' });
  const lang = sel(c, LANGS, 'pt-BR', () => {}, { id: 'sd-lang' });
  const name = h('input', { id: 'sd-name', class: 'grow', placeholder: 'Nome da skill (opcional — a IA sugere um nome único)' }) as HTMLInputElement;
  const log = h('pre', { class: 'pvtext svlog', id: 'sd-log' });
  const out = h('div', { id: 'sd-out' });
  let off: (() => void) | undefined;
  const close = () => { off?.(); bg.remove(); };
  const go = h('button', { class: 'primary', id: 'sd-go', onclick: () => void (async () => {
    if (!file) { toast('Escolha o documento.', true); return; }
    go.setAttribute('disabled', ''); log.textContent = ''; out.replaceChildren(h('div', { class: 'muted' }, '⏳ Lendo o documento e escrevendo a skill…'));
    off = (forge as unknown as { onEvent: (cb: (e: { t: string; stepId?: string; line?: string }) => void) => () => void }).onEvent((e) => { if (e.t === 'log' && e.stepId === 'skillgen' && e.line) { log.textContent += e.line + '\n'; log.scrollTop = log.scrollHeight; } });
    try {
      const r = (await forge['skillFromDoc']({ file, harness: harness.value, model: model || undefined, name: name.value, language: lang.value, routeId: route.value || undefined })) as { skill: Skill; routeName: string; warnings: string[] };
      out.replaceChildren(h('div', { class: 'card svresult' }, h('strong', {}, `✓ Skill "${r.skill.name}" criada`), h('div', { class: 'muted' }, r.skill.description), h('div', {}, h('strong', {}, '🛣️ Rota: '), r.routeName),
        ...r.warnings.map((w) => h('div', { class: 'tag running' }, '⚠ ' + w)),
        h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Fechar'), h('button', { class: 'primary', onclick: () => { close(); onDone(r.skill); } }, 'Abrir a skill'))));
      toast(`Skill "${r.skill.name}" criada`);
    } catch (e) { out.replaceChildren(h('div', { class: 'tag failed' }, '⛔ ' + (e as Error).message)); }
    finally { go.removeAttribute('disabled'); off?.(); off = undefined; }
  })() }, '📄 Criar a skill');
  const bg = h('div', { class: 'modal-bg', id: 'skill-doc-modal' }, h('div', { class: 'modal pmodal' },
    h('div', { class: 'row' }, h('h3', {}, '📄 Skill a partir de documento'), h('span', { class: 'sp' }), h('button', { onclick: () => { void forge['skillFromVideosCancel']().catch(() => {}); close(); } }, '✕')),
    h('p', { class: 'muted' }, 'Converte um documento com os prompts e regras de um canal (temas, roteiro, ritmo, thumbnails, SEO) numa skill do Dark Automate, preservando as regras concretas. Use a rota "Animação 2D cinematográfica (motor do plugin)" para produzir com o motor de um plugin.'),
    h('div', { class: 'row' }, h('button', { id: 'sd-pick', onclick: () => void (async () => { const f = (await forge['openFile']({ title: 'Documento de prompts', filters: [{ name: 'Documento', extensions: ['docx', 'md', 'txt'] }] })) as string | null; if (f) { file = f; fileLbl.textContent = '📄 ' + f.split(/[\\/]/).pop(); } })() }, '📂 Escolher documento'), fileLbl),
    h('div', { class: 'row' }, h('label', {}, 'Quem escreve', harness), modelBox, h('label', {}, 'Idioma dos vídeos', lang)),
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Rota', route), name),
    h('div', { class: 'row actions pfoot' }, h('span', { class: 'sp' }), go), log, out));
  document.body.append(bg);
}

/* ═════════════════ SKILLS ═════════════════ */
let skillDraft: Skill | undefined;
let skillOrigin: Skill | undefined;
let skillFilter = { q: '', who: '' };

export const APPEAR_ICON: Record<string, string> = {
  stickman: '🧍', realistic: '🎥', anime_2d: '🌸', cartoon_3d: '🧸', pixel_art: '👾', flat_explainer: '📐', ms_paint: '🖍️', vox_collage: '📰', low_poly: '🔺',
  recon_3d: '🏛️', doc_netflix: '🎞️', whiteboard: '🧑‍🏫', motion_graphics: '📊', micro_drama: '🎭', ad_product: '🛍️', interactive_story: '📖', music_lyric: '🎤',
  vector: '✒️', paper_cut: '✂️', code_3d: '🧊', custom: '⚙️',
};
const skillIcon = (k: Skill) => /clipe|music|colet/i.test(k.id) ? '🎵' : k.freeform ? '🪄' : APPEAR_ICON[k.appearance ?? 'custom'] ?? '🧠';
const ASPECTS: Array<[string, string, number, number]> = [['16:9', 'YouTube', 32, 18], ['9:16', 'Shorts/Reels', 14, 25], ['1:1', 'Quadrado', 22, 22], ['4:5', 'Feed', 20, 25]];
const ENDINGS: Array<[string, string, string]> = [['', '🤖', 'Automático'], ['loop', '🔁', 'Emenda no início'], ['next', '⏭️', 'Gancho p/ o próximo'], ['conclusion', '🏁', 'Conclusão + chamada']];

export async function renderSkills(c: Ctx) {
  const { h, main, forge, toast, guard } = c;
  const [skills, routes, meta] = await Promise.all([forge['listSkills']() as Promise<Skill[]>, forge['listRoutes']() as Promise<Route[]>, forge['meta']() as Promise<Meta>]);
  const again = () => void renderSkills(c);
  const head = (...extra: Child[]) => h('div', { class: 'row pagehead' }, h('h2', {}, '🧠 Skills'), h('span', { class: 'tag' }, 'templates do vídeo'), helpButton('skills'), h('span', { class: 'sp' }), auditButton(c), ...extra);
  const routeName = (id?: string) => routes.find((r) => r.id === id)?.name ?? id ?? '—';

  /* ── galeria ── */
  if (!skillDraft) {
    const q = h('input', { placeholder: 'Buscar skill…', value: skillFilter.q, id: 'skill-q' }) as HTMLInputElement;
    const grid = h('div', { class: 'sgrid', id: 'skill-list' });
    q.addEventListener('input', () => { skillFilter.q = q.value; paint(); });
    const seg = h('div', { class: 'seg' }, ...([['', 'Todas'], ['b', '🔒 Padrão'], ['m', '★ Minhas']] as Array<[string, string]>).map(([v, l]) =>
      h('button', { class: skillFilter.who === v ? 'on' : '', onclick: () => { skillFilter.who = v; again(); } }, l)));
    const paint = () => grid.replaceChildren(...skills.filter((k) => (!skillFilter.q || `${k.name} ${k.description}`.toLowerCase().includes(skillFilter.q.toLowerCase()))
      && (!skillFilter.who || (skillFilter.who === 'b') === !!k.builtin)).map((k) => {
      const r = routes.find((x) => x.id === k.routeId);
      const rep = checkSkillRoute(k, r, meta.videoTypes.find((v) => v.id === k.appearance)?.sceneKind as never, r);
      return h('button', { class: 'scard', 'data-skill': k.id, onclick: () => { skillOrigin = k; skillDraft = clone(k); again(); } },
        h('div', { class: 'row' }, h('span', { class: 'sicon big' }, skillIcon(k)), h('strong', { class: 'grow' }, k.name), k.builtin ? h('span', { class: 'tag', title: (k as { customized?: boolean }).customized ? 'Padrão personalizada por você' : 'Padrão' }, (k as { customized?: boolean }).customized ? '✎' : '🔒') : h('span', { class: 'tag done' }, '★ minha')),
        h('span', { class: 'muted sdesc' }, k.description),
        r ? routeStrip(c, r) : null,
        h('span', { class: 'pchips' },
          h('span', { class: 'chip', title: 'Rota sugerida' }, `🛣️ ${routeName(k.routeId)}`),
          k.aspect ? h('span', { class: 'chip' }, `📐 ${k.aspect}`) : null, k.durationSec ? h('span', { class: 'chip' }, `⏱ ${k.durationSec}s`) : null,
          k.presentation === 'mixed' ? h('span', { class: 'chip' }, '🧩 misto') : null, k.multiVoice ? h('span', { class: 'chip' }, '🎭 vozes') : null,
          rep.errors.length ? h('span', { class: 'chip bad' }, '⛔ rota') : rep.warnings.length ? h('span', { class: 'chip warn' }, '⚠ rota') : null));
    }));
    paint();
    main.replaceChildren(
      head(h('button', { class: 'primary', id: 'skill-new', onclick: () => { skillOrigin = undefined; skillDraft = { id: '', name: 'Nova skill', description: '', global: '', steps: {}, appearance: 'custom', routeId: routes[0]?.id, aspect: '16:9', durationSec: 60, language: 'pt-BR', presentation: 'generated', mediaSources: [], outputStyle: '' }; again(); } }, '＋ Nova skill'),
        h('button', { class: 'primary', id: 'skill-from-videos', title: 'Analisa vídeos de referência e cria uma skill nova no padrão do app', onclick: () => void openSkillFromVideos(c, (k) => { skillOrigin = k; skillDraft = clone(k); again(); }) }, '🎬 Skill a partir de vídeos'),
        h('button', { class: 'primary', id: 'skill-from-doc', title: 'Converte um documento de prompts/diretrizes de canal (.docx, .md, .txt) numa skill — com o harness e o modelo que você escolher', onclick: () => void openSkillFromDoc(c, (k) => { skillOrigin = k; skillDraft = clone(k); again(); }) }, '📄 Skill a partir de documento'),
        h('button', { class: 'primary', id: 'skill-import-claude', title: 'SKILL.md do Claude (arquivo, pasta, .zip ou link do GitHub) → plugin + skill + rota', onclick: () => void openImportClaudeSkill(c, (k) => { skillOrigin = k; skillDraft = clone(k); again(); }) }, '📥 Importar SKILL.md'),
        h('button', { id: 'skill-import', title: 'Importar skills em Markdown (.md) ou JSON', onclick: () => void guard(async () => {
          const ks = (await forge['importSkills']()) as Skill[] | undefined;
          if (ks?.length) { toast(`${ks.length} skill(s) importada(s)`); again(); }
        }) }, '⬆ Importar'),
        h('button', { id: 'skill-export-all', title: 'Exportar todas as suas skills (Markdown)', onclick: () => void guard(async () => {
          const files = (await forge['exportLibrary']('skills')) as string[] | null;
          if (files) toast(files.length ? `${files.length} skill(s) exportada(s)` : 'Nenhuma skill sua para exportar');
        }) }, '⬇ Exportar todas')),
      h('p', { class: 'muted' }, 'Cada skill é o template de um tipo de vídeo: visual, tom, ritmo, estrutura e o que fazer em cada etapa. Defina uma vez, use em todo projeto.'),
      h('div', { class: 'row' }, q, seg), grid);
    return;
  }

  /* ── editor em seções ── */
  const d = skillDraft; const isB = !!skillOrigin?.builtin; const isC = !!(skillOrigin as { customized?: boolean } | undefined)?.customized;
  const sec = (icon: string, title: string, hint: string, ...kids: Child[]) => h('div', { class: 'card ssec' }, h('div', { class: 'row' }, h('span', { class: 'sicon' }, icon), h('div', { class: 'grow' }, h('strong', {}, title), h('div', { class: 'muted' }, hint))), ...kids);
  const tiles = (items: Array<{ v: string; icon: Child; label: string; sub?: string }>, value: string, on: (v: string) => void, id: string) =>
    h('div', { class: 'ttiles', id }, ...items.map((it) => h('button', { class: `ttile${it.v === value ? ' sel' : ''}`, 'data-v': it.v, onclick: () => { on(it.v); again(); } },
      h('span', { class: 'ticon' }, it.icon), h('strong', {}, it.label), it.sub ? h('span', { class: 'muted' }, it.sub) : null)));
  const name = h('input', { id: 'skill-name', value: d.name, class: 'grow' }) as HTMLInputElement; name.addEventListener('input', () => { d.name = name.value; });
  const desc = h('input', { id: 'skill-desc', value: d.description }) as HTMLInputElement; desc.addEventListener('input', () => { d.description = desc.value; });
  const dur = h('input', { type: 'number', min: '10', value: String(d.durationSec ?? 60), class: 'num', id: 'skill-dur' }) as HTMLInputElement; dur.addEventListener('input', () => { d.durationSec = Number(dur.value) || 60; });
  const lang = sel(c, LANGS, d.language ?? 'pt-BR', (v) => { d.language = v; }, { id: 'skill-lang' });
  const outStyle = h('textarea', { id: 'skill-output', rows: '4', placeholder: 'Como será o vídeo de saída: visual, ritmo, narração, formato e arquivos gerados. Aparece ao escolher a skill em Novo projeto.' }) as HTMLTextAreaElement; outStyle.value = d.outputStyle ?? ''; outStyle.addEventListener('input', () => { d.outputStyle = outStyle.value; });
  const glob = h('textarea', { id: 'skill-global', rows: '4', placeholder: 'Diretrizes gerais aplicadas a TODAS as etapas (tom, estilo, regras, público…)' }) as HTMLTextAreaElement; glob.value = d.global; glob.addEventListener('input', () => { d.global = glob.value; });
  const reviewTa = h('textarea', { id: 'skill-review', rows: '2', placeholder: 'Ex.: vertical 1080x1920; gancho em 2 s; legenda grande; final emenda com o início…' }) as HTMLTextAreaElement;
  reviewTa.value = d.reviewCriteria ?? ''; reviewTa.addEventListener('input', () => { d.reviewCriteria = reviewTa.value.trim() || undefined; });
  const toggle = (id: string, checked: boolean, label: string, on: (v: boolean) => void) => {
    const cb = h('input', { type: 'checkbox', id }) as HTMLInputElement; cb.checked = checked; cb.addEventListener('change', () => { on(cb.checked); again(); });
    return h('label', { class: 'inline chk tgl' }, cb, label);
  };
  const r = routes.find((x) => x.id === d.routeId);
  const rep = checkSkillRoute(d, r, meta.videoTypes.find((v) => v.id === d.appearance)?.sceneKind as never, r);
  const compat = h('div', { class: 'compat', id: 'skill-compat' }, ...rep.errors.map((e) => h('span', { class: 'tag failed' }, '⛔ ' + e)), ...rep.warnings.map((e) => h('span', { class: 'tag running' }, '⚠ ' + e)), ...rep.ok.map((e) => h('span', { class: 'tag done' }, '✓ ' + e)));
  // atividades: primeiro as tarefas da rota sugerida; as demais ficam recolhidas
  const used = new Set((r?.steps ?? []).filter((s) => s.enabled).map((s) => s.kind as string));
  const actBox = (id: string, lbl: string) => {
    const ta = h('textarea', { 'data-act-id': id, placeholder: `O que fazer em "${lbl}"…`, rows: '2' }) as HTMLTextAreaElement; ta.value = d.steps[id] ?? '';
    ta.addEventListener('input', () => { if (ta.value.trim()) d.steps[id] = ta.value; else delete d.steps[id]; });
    return h('label', { class: 'actbox' }, h('span', {}, `${KIND_ICON[id] ?? '•'} ${lbl}`), ta);
  };
  const mainActs = meta.stepKinds.filter((k) => used.has(k) || d.steps[k]);
  const otherActs = meta.stepKinds.filter((k) => !mainActs.includes(k));
  const customActs = Object.keys(d.steps).filter((k) => !meta.stepKinds.includes(k));
  const srcBoxes = STOCK_SOURCES.map((i) => i.id).map((x) => toggle(`src-${x}`, (d.mediaSources ?? []).includes(x), `${stockInfo(x)?.icon ?? ''} ${stockInfo(x)?.label ?? x}`, (v) => { d.mediaSources = v ? [...(d.mediaSources ?? []), x] : (d.mediaSources ?? []).filter((y) => y !== x); }));
  const mixBoxes = ([['motion', '📊 Motion graphics'], ['stock', '🗃️ Banco de imagens/vídeos'], ['ai', '🎬 Vídeo IA']] as Array<['motion' | 'stock' | 'ai', string]>).map(([k, l]) =>
    toggle(`mix-${k}`, (d.mixSources ?? ['motion', 'stock']).includes(k), l, (v) => { const s = new Set<'motion' | 'stock' | 'ai'>(d.mixSources ?? ['motion', 'stock']); v ? s.add(k) : s.delete(k); d.mixSources = [...s]; }));

  main.replaceChildren(
    head(h('button', { id: 'skill-back', onclick: () => { skillDraft = undefined; skillOrigin = undefined; again(); } }, '← Todas as skills'),
      h('button', { class: 'primary', id: 'skill-save', onclick: () => void guard(async () => {
        /* skill padrão: grava a SUA versão dela (permanente; vale no lugar da padrão) */
        const s = clone(d); s.id = skillOrigin?.id ?? '';
        delete (s as { builtin?: boolean }).builtin; delete (s as { customized?: boolean }).customized;
        const saved = (await forge['saveSkill'](s)) as Skill;
        const fresh = ((await forge['listSkills']()) as Skill[]).find((x) => x.id === saved.id) ?? saved;
        skillOrigin = fresh; skillDraft = clone(fresh); toast(`Skill "${saved.name}" salva`); again();
      }) }, isB ? '💾 Salvar alterações' : '💾 Salvar skill'),
      skillOrigin ? h('button', { id: 'skill-saveas', onclick: () => void guard(async () => {
        const s = clone(d); s.id = ''; s.name = d.name + (isB ? ' (minha)' : ' (cópia)');
        delete (s as { builtin?: boolean }).builtin; delete (s as { customized?: boolean }).customized;
        const saved = (await forge['saveSkill'](s)) as Skill; skillOrigin = saved; skillDraft = clone(saved); toast(`Skill "${saved.name}" criada`); again();
      }) }, 'Salvar como nova') : null,
      isB && isC ? h('button', { id: 'skill-restore', onclick: () => void guard(async () => {
        if (!await askConfirm(`Descartar suas alterações e restaurar a skill padrão "${skillOrigin!.name}"?`)) return;
        await forge['deleteSkill'](skillOrigin!.id); skillDraft = undefined; skillOrigin = undefined; toast('Skill padrão restaurada'); again();
      }) }, '↺ Restaurar padrão') : null,
      skillOrigin ? h('button', { id: 'skill-export', onclick: () => void guard(async () => { const f = (await forge['exportSkill'](skillOrigin!.id)) as string | null; if (f) toast(`Skill exportada: ${f}`); }) }, '⬇ Exportar') : null,
      skillOrigin && !skillOrigin.builtin ? h('button', { class: 'danger', id: 'skill-del', onclick: () => void guard(async () => {
        if (!await askConfirm(`Excluir a skill "${skillOrigin!.name}"?`)) return; await forge['deleteSkill'](skillOrigin!.id); skillDraft = undefined; skillOrigin = undefined; toast('Skill excluída'); again();
      }) }, 'Excluir') : null),
    isB ? h('p', { class: 'muted' }, isC ? '✎ Skill padrão personalizada por você: suas alterações ficam salvas (inclusive após atualizar o app). "Restaurar padrão" volta ao original.' : '🔒 Skill padrão. Altere o que quiser e "Salvar alterações" grava a sua versão dela, permanente; ou "Salvar como nova" para uma cópia separada.') : '',
    h('div', { class: 'sgrid2' },
      sec('🪪', 'Identidade', 'Nome, resumo e exemplo visual mostrados em Novo projeto',
        h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Nome', name)), h('label', {}, 'Resumo', desc),
        h('div', { class: 'row', id: 'skill-media' }, h('span', { class: 'muted' }, d.previewMedia ? '🖼 ' + d.previewMedia.split(/[\\/]/).pop()! : 'Sem exemplo visual (usa o vídeo final mais recente feito com a skill)'),
          h('button', { id: 'skill-media-pick', onclick: () => void guard(async () => {
            const f = (await forge['openFile']({ title: 'Exemplo visual da skill', filters: [{ name: 'Vídeo, GIF ou imagem', extensions: ['mp4', 'webm', 'mov', 'gif', 'png', 'jpg', 'jpeg', 'webp'] }] })) as string | null;
            if (f) { d.previewMedia = (await forge['importMedia'](f, 'skill')) as string; again(); }
          }) }, 'Escolher exemplo…'), d.previewMedia ? h('button', { onclick: () => { d.previewMedia = undefined; again(); } }, 'Remover') : null),
        h('label', {}, 'Como será o vídeo de saída', outStyle)),
      sec('📐', 'Formato e padrões', 'Valores iniciais de todo projeto criado com a skill',
        tiles(ASPECTS.map(([v, l, w, hh]) => { const box = h('span', { class: 'aspbox' }); box.style.width = `${w}px`; box.style.height = `${hh}px`; return { v, icon: box, label: v, sub: l }; }), d.aspect ?? '16:9', (v) => { d.aspect = v as Skill['aspect']; }, 'skill-aspect'),
        h('div', { class: 'row' }, h('label', {}, 'Duração (s)', dur), h('label', {}, 'Idioma', lang)),
        h('div', { class: 'muted' }, 'Final do roteiro'),
        tiles(ENDINGS.map(([v, i, l]) => ({ v, icon: i, label: l })), d.scriptEnding ?? '', (v) => { d.scriptEnding = (v || undefined) as Skill['scriptEnding']; }, 'skill-ending'),
        h('div', { class: 'row' }, toggle('skill-multivoice', !!d.multiVoice, '🎭 Diálogo com várias vozes (elenco)', (v) => { d.multiVoice = v || undefined; }),
          toggle('skill-free', !!d.freeform, '🪄 Vídeo livre (sem roteiro/cenas)', (v) => { d.freeform = v || undefined; if (v) d.routeId = 'video-livre'; })))),
    sec('🎨', 'Aparência', 'O estilo visual e o tipo de cena padrão do vídeo',
      tiles(meta.videoTypes.map((v) => ({ v: v.id, icon: APPEAR_ICON[v.id] ?? '•', label: v.label })), d.appearance ?? 'custom', (v) => { d.appearance = v as Skill['appearance']; }, 'skill-appearance')),
    sec('🛣️', 'Rota sugerida', 'A linha de produção que esta skill usa por padrão — o selo mostra se combina',
      h('div', { class: 'ttiles wide', id: 'skill-route' }, ...routes.map((rt) => h('button', { class: `ttile rtile${rt.id === d.routeId ? ' sel' : ''}`, 'data-v': rt.id, onclick: () => { d.routeId = rt.id; again(); } },
        h('strong', {}, rt.name), routeStrip(c, rt)))), compat),
    sec('🧩', 'Apresentação', 'Gerada (só o estilo) ou mista (mescla fontes de mídia)',
      tiles([{ v: 'generated', icon: '✨', label: 'Gerada', sub: 'tudo criado pela rota' }, { v: 'mixed', icon: '🧩', label: 'Mista', sub: 'mescla código, bancos e IA' }], d.presentation ?? 'generated', (v) => { d.presentation = v as Skill['presentation']; }, 'skill-pres'),
      d.presentation === 'mixed' ? h('div', { class: 'row', id: 'skill-mix' }, h('span', { class: 'muted' }, 'Mescla:'), ...mixBoxes) : null,
      d.presentation === 'mixed' && (d.mixSources ?? ['motion', 'stock']).includes('stock') ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Bancos:'), ...srcBoxes) : null),
    sec('✍️', 'Instruções', 'Diretrizes gerais + o que fazer em cada etapa (entra no prompt daquela etapa)',
      h('label', {}, 'Diretrizes gerais (todas as etapas)', glob),
      h('div', { class: 'grid2', id: 'skill-steps' }, ...mainActs.map((k) => actBox(k, KIND_LABEL[k] ?? k)), ...customActs.map((k) => actBox(k, `tarefa "${k}"`))),
      otherActs.length ? h('details', {}, h('summary', {}, `Outras atividades (${otherActs.length}) — não usadas pela rota sugerida`), h('div', { class: 'grid2' }, ...otherActs.map((k) => actBox(k, KIND_LABEL[k] ?? k)))) : null),
    sec('⭐', 'Revisão de qualidade', 'Critérios usados quando o projeto tem qualidade "verified" ou "ultra"', reviewTa));
}

/* ═════════════════ TIPOS DE VÍDEO (skill + rota) ═════════════════ */
let typeDraft: CustomVideoType | undefined;
let typeOrigin: CustomVideoType | undefined;

export async function renderTypes(c: Ctx) {
  const { h, main, forge, toast, guard } = c;
  const [types, routes, skills, meta] = await Promise.all([forge['listVTypes']() as Promise<CustomVideoType[]>, forge['listRoutes']() as Promise<Route[]>, forge['listSkills']() as Promise<Skill[]>, forge['meta']() as Promise<Meta>]);
  const again = () => void renderTypes(c);
  const list = h('div', { class: 'card', id: 'type-list' },
    h('div', { class: 'row' }, h('button', { class: 'primary', id: 'type-new', onclick: () => {
      typeOrigin = undefined; typeDraft = { id: '', name: 'Novo tipo de vídeo', routeId: routes[0]!.id, skillId: skills[0]!.id, appearance: 'vector', presentation: 'generated', mediaSources: ['pexels', 'pixabay', 'wikipedia', 'youtube'], aspect: '16:9', durationSec: 60, language: 'pt-BR' }; again();
    } }, '+ Novo tipo')),
    ...types.map((t) => h('div', { class: `item${typeOrigin?.id === t.id ? ' sel' : ''}`, 'data-type': t.id, onclick: () => { typeOrigin = t; typeDraft = clone(t); again(); } },
      h('strong', {}, t.name), t.builtin ? h('span', { class: 'tag' }, '🔒 padrão') : h('span', { class: 'tag done' }, 'meu'), h('div', { class: 'muted' }, `${t.routeId} + ${t.skillId}`))));
  if (!typeDraft) { main.replaceChildren(h('h2', {}, 'Tipos de vídeo'), h('p', { class: 'muted' }, 'Rota + Skill (+ aparência, apresentação e idioma) = um tipo de vídeo reutilizável nos Projetos.'), h('div', { class: 'split' }, list, h('div', { class: 'card muted' }, 'Selecione ou crie um tipo.'))); return; }
  const d = typeDraft; const isB = !!typeOrigin?.builtin;
  const name = h('input', { id: 'type-name', value: d.name }) as HTMLInputElement; name.addEventListener('input', () => { d.name = name.value; });
  const o2 = (arr: Array<[string, string]>, v: string, on: (v: string) => void, id: string) => sel(c, arr, v, on, { id });
  const srcBoxes = STOCK_SOURCES.map((i) => i.id).map((s) => {
    const cb = h('input', { type: 'checkbox' }) as HTMLInputElement; cb.checked = d.mediaSources.includes(s);
    cb.addEventListener('change', () => { d.mediaSources = cb.checked ? [...d.mediaSources, s] : d.mediaSources.filter((x) => x !== s); });
    return h('label', { class: 'inline chk', title: stockInfo(s)?.about ?? '' }, cb, `${stockInfo(s)?.icon ?? ''} ${stockInfo(s)?.label ?? s}`);
  });
  const dur = h('input', { type: 'number', min: '10', value: String(d.durationSec ?? 60), class: 'num' }) as HTMLInputElement; dur.addEventListener('input', () => { d.durationSec = Number(dur.value) || 60; });
  main.replaceChildren(h('h2', {}, 'Tipos de vídeo'), h('div', { class: 'split' }, list, h('div', { class: 'card' },
    isB ? h('p', { class: 'muted' }, '🔒 Tipo padrão (somente leitura). Use "Salvar como meu tipo" para criar uma cópia editável.') : null,
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Nome', name)),
    h('div', { class: 'row' },
      h('label', {}, 'Rota', o2(routes.map((r) => [r.id, r.name] as [string, string]), d.routeId, (v) => { d.routeId = v; }, 'type-route')),
      h('label', {}, 'Skill', o2(skills.map((k) => [k.id, k.name] as [string, string]), d.skillId, (v) => { d.skillId = v; }, 'type-skill'))),
    h('div', { class: 'row' },
      h('label', {}, 'Aparência', o2(meta.videoTypes.filter((v) => v.id !== 'custom').map((v) => [v.id, v.label] as [string, string]), d.appearance, (v) => { d.appearance = v as typeof d.appearance; }, 'type-appearance')),
      h('label', {}, 'Apresentação', o2([['generated', 'Gerada (só o estilo)'], ['mixed', 'Mista (motion graphics + mídias de bancos)']], d.presentation, (v) => { d.presentation = v as typeof d.presentation; again(); }, 'type-presentation')),
      h('label', {}, 'Idioma', o2(LANGS, d.language ?? 'pt-BR', (v) => { d.language = v; }, 'type-lang')),
      h('label', {}, 'Formato', o2(['16:9', '9:16', '1:1', '4:5'].map((x) => [x, x] as [string, string]), d.aspect ?? '16:9', (v) => { d.aspect = v as typeof d.aspect; }, 'type-aspect')),
      h('label', {}, 'Duração (s)', dur)),
    d.presentation === 'mixed' ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Fontes de mídia:'), ...srcBoxes) : null,
    h('div', { class: 'row' },
      h('button', { class: 'primary', id: 'type-save', onclick: () => void guard(async () => {
        const t = clone(d); if (isB) t.id = ''; else t.id = typeOrigin?.id ?? '';
        const saved = (await forge['saveVType'](t)) as CustomVideoType; typeOrigin = saved; typeDraft = clone(saved); toast(`Tipo "${saved.name}" salvo`); again();
      }) }, isB ? 'Salvar como meu tipo' : 'Salvar tipo'),
      typeOrigin && !typeOrigin.builtin ? h('button', { class: 'danger', id: 'type-del', onclick: () => void guard(async () => {
        if (!await askConfirm(`Excluir o tipo "${typeOrigin!.name}"?`)) return; await forge['deleteVType'](typeOrigin!.id); typeDraft = undefined; typeOrigin = undefined; toast('Tipo excluído'); again();
      }) }, 'Excluir') : null))));
}

/* ═════════════════ CONFIGURAÇÕES ═════════════════ */
let S: Settings | undefined;
let cfgTab = 'folders';
const CFG_TABS: Array<[string, string, string]> = [
  ['folders', 'Pastas', 'file'],
  ['app', 'Aplicação', 'sun'],
  ['production', 'Produção', 'run'],
  ['providers', 'Providers (provedores)', 'agents'],
  ['local', 'ComfyUI / Wan2GP', 'batch'],
  ['voice', 'APIs de voz', 'text'],
  ['image', 'APIs de imagens', 'image'],
  ['video', 'APIs de vídeos', 'play'],
  ['music', 'APIs de músicas', 'music'],
  ['stock', 'Bancos de mídia', 'projects'],
  ['plugins', 'Plugins', 'skills'],
  ['mcp', 'MCP', 'routes'],
  ['misc', 'Whisper e thumbnails', 'settings'],
];
const apiResults = new Map<string, { ok: boolean; message: string }>();
const res = (ok: boolean, msg: string, h: H) => h('span', { class: `tag ${ok ? 'done' : 'failed'}` }, msg);

export async function renderSettings(c: Ctx, reload = true) {
  const { h, main, forge, toast, guard } = c;
  if (reload || !S) S = (await forge['getSettings']()) as Settings;
  const s = S;
  const cat = (await forge['catalog']()) as Catalog;
  const meta = (await forge['meta']()) as Meta;
  const redraw = () => void renderSettings(c, false);
  const bind = (el: HTMLInputElement | HTMLTextAreaElement, set: (v: string) => void) => { el.addEventListener('input', () => set(el.value)); return el; };
  const field = (label: string, value: string, set: (v: string) => void, attrs: Record<string, string> = {}) =>
    h('label', { class: attrs['class'] ?? '' }, label, bind(h('input', { value, ...attrs }) as HTMLInputElement, set));
  const tabs = h('div', { class: 'tabs', id: 'cfg-tabs' }, ...CFG_TABS.map(([id, l, ic]) => h('button', { class: id === cfgTab ? 'active' : '', 'data-cfg': id, title: l, onclick: () => { cfgTab = id; redraw(); } }, icon(ic), h('span', {}, l))));
  const body = h('div', { id: 'cfg-body' });

  if (cfgTab === 'providers') {
    body.append(h('p', { class: 'muted' }, 'Provedores de IA das rotas: CLIs de agente (claude, opencode, codex…) ou servidores locais por HTTP (Ollama, llama.cpp, LM Studio). Tokens nos argumentos: {prompt}, {model} e {effort}. Em provedores HTTP o campo "Comando" é a Base URL. O esforço (Default/Low/High/Max) só aparece em modelos que o aceitam; Default não envia nada.'));
    /* reservas padrão: quem assume quando o provedor da etapa falha (ex.: Ollama → OpenCode) e a ordem do "auto" */
    body.append(h('div', { class: 'card', id: 'cfg-fallback' },
      h('div', { class: 'row' }, h('strong', {}, '🛟 Reservas padrão'),
        h('span', { class: 'muted' }, 'Se o provedor de uma etapa falhar (ex.: Ollama), estes assumem, na ordem dos cliques. Também definem quem o "auto" escolhe primeiro. Vazio = ordem automática (Claude, Antigravity, Codex, OpenCode…). "🚫 Sem reserva" = a etapa usa só o primeiro provedor e, se falhar, a execução para mostrando o erro. Um projeto pode ter as próprias reservas (Novo projeto).')),
      fallbackChips('cfg-fallback-chips', s.harnessFallback, (next) => {
        if (next.length) s.harnessFallback = next as NonNullable<Settings['harnessFallback']>; else delete s.harnessFallback;
      }, meta.harnessIds, { value: !!s.noFallback, onChange: (v) => { if (v) s.noFallback = true; else delete s.noFallback; } }),
      h('div', { class: 'row', id: 'cfg-retries' },
        h('label', { title: 'Cada modelo (Ollama, llama.cpp, Claude, Codex, APIs…) tenta a etapa pelo menos esta quantidade de vezes antes de passar à reserva ou falhar — mesmo se a rota pede 1. Erro de configuração e timeout não repetem.' }, '🔁 Tentativas por modelo',
          h('input', { id: 'cfg-step-attempts', type: 'number', min: '1', max: '5', step: '1', value: String(s.stepAttempts ?? 2), class: 'num', oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); if (v >= 1 && v <= 5) s.stepAttempts = v; } })),
        h('label', { title: 'Em "Rodar fila/lote": no fim, refaz os projetos que falharam, continuando de onde pararam (o que já saiu não é refeito). 0 = não refaz.' }, '📦 Lote: refazer falhas',
          h('input', { id: 'cfg-batch-retries', type: 'number', min: '0', max: '3', step: '1', value: String(s.batchRetries ?? 1), class: 'num', oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); if (v >= 0 && v <= 3) s.batchRetries = v; } }))),
      h('div', { class: 'muted small' }, 'Use "Salvar configurações" para manter.')));
    for (const id of meta.harnessIds) {
      const cfg = s.harnesses[id as keyof Settings['harnesses']]; if (!cfg) continue;
      const isHttp = /^https?:\/\//i.test(cfg.command);
      const toolsInfo = isHttp
        ? h('div', { class: 'muted' }, cfg.tools === false
          ? 'Ferramentas desligadas: o modelo só responde texto.'
          : 'Ferramentas instaladas: ler/gravar arquivos, listar, HTTP/REST, busca na web e comandos (ffmpeg, python) dentro do projeto. Aparecem no log da execução quando o modelo as usa.')
        : null;
      const out = h('div', { class: 'out' });
      const defBox = h('span', {});
      const effortBox = h('span', {});
      const effortField = h('label', { title: 'Esforço padrão deste provedor. A etapa pode sobrescrever; Default usa o padrão do modelo.' }, 'Esforço padrão', effortBox);
      const paintEffort = () => {
        const show = harnessOffersEffort(id, cfg.defaultModel);
        effortField.hidden = !show;
        effortBox.replaceChildren(...(show ? [sel(c, EFFORT_OPTIONS, cfg.effort ?? '', (v) => {
          cfg.effort = v ? v as ReasoningEffort : undefined;
        }, { 'data-field': 'effort' })] : []));
      };
      const paintDef = () => {
        defBox.replaceChildren(selModel(c, cfg.models, cfg.defaultModel ?? '', (v) => {
          cfg.defaultModel = v || undefined;
          paintEffort();
        }, { 'data-field': 'defaultModel' }, [['', '(padrão do provedor)']]));
        paintEffort();
      };
      const ml = modelList(c, cfg.models, (n) => { cfg.models = n; paintDef(); }, { field: 'models' }); paintDef();
      const args = h('input', { value: JSON.stringify(cfg.args), 'data-field': 'args' }) as HTMLInputElement; bind(args, (v) => { try { cfg.args = JSON.parse(v); args.classList.remove('bad'); } catch { args.classList.add('bad'); } });
      body.append(h('div', { class: 'card', 'data-harness': id },
        h('div', { class: 'row' }, h('span', { class: 'picon' }, artIcon(bindingArt({ type: 'harness', harness: id as HarnessBinding['harness'] }).icon)), h('strong', {}, id), cfg.note ? h('span', { class: 'muted' }, cfg.note) : null),
        h('div', { class: 'row' },
          field(isHttp || id === 'ollama' ? 'Base URL' : 'Comando', cfg.command, (v) => { cfg.command = v; }, { class: 'grow', 'data-field': 'command' }),
          h('label', {}, 'Prompt via', sel(c, [['arg', 'argumento'], ['stdin', 'stdin']], cfg.promptVia, (v) => { cfg.promptVia = v as 'arg' | 'stdin'; })),
          h('label', {}, 'Modelo padrão', defBox), effortField),
        h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Argumentos (JSON)', args)),
        isHttp ? h('div', { class: 'row' },
          h('label', { title: 'Só para APIs na nuvem (DeepSeek). Servidores locais (Ollama, LM Studio, llama.cpp) não precisam.' }, 'Chave de API',
            bind(h('input', { type: 'password', value: cfg.apiKey ?? '', placeholder: id === 'deepseek' ? 'sk-…' : '(não precisa no servidor local)', 'data-field': 'harness-key' }) as HTMLInputElement, (v) => { cfg.apiKey = v.trim() || undefined; })),
          h('label', {}, 'API', sel(c, [['ollama', 'Ollama (/api/chat)'], ['openai', 'OpenAI-compatível (/v1/chat/completions)']], cfg.protocol ?? 'ollama', (v) => { cfg.protocol = v as 'ollama' | 'openai'; })),
          h('label', { class: 'inline chk' }, (() => {
            const cb = h('input', { type: 'checkbox', 'data-field': 'tools' }) as HTMLInputElement; cb.checked = cfg.tools !== false;
            cb.addEventListener('change', () => { cfg.tools = cb.checked; redraw(); }); return cb;
          })(), 'Ferramentas (arquivos, internet, REST, comandos)'),
          h('label', { class: 'inline chk', title: 'Modo estrito para modelos locais: as regras da skill, dos plugins e a API da biblioteca vão no prompt de sistema em tags XML (<skill_instructions>, <plugin_instructions>, <library_api>, <examples>) com a ordem de usar SÓ o que está lá; plano de cenas e metadados saem por decodificação guiada (JSON schema); e o validador recusa funções inventadas antes do render.' }, (() => {
            const cb = h('input', { type: 'checkbox', 'data-field': 'strict' }) as HTMLInputElement; cb.checked = cfg.strict !== false;
            cb.addEventListener('change', () => { cfg.strict = cb.checked; }); return cb;
          })(), '🔒 Modo estrito (só procedimentos e funções das skills/plugins)')) : null,
        toolsInfo,
        h('div', {}, h('strong', {}, 'Modelos carregados'), h('span', { class: 'muted' }, ' — só estes aparecem ao montar as rotas'), ml.el),
        h('div', { class: 'row' },
          h('button', { 'data-act': 'detect', onclick: () => void guard(async () => { const r = await forge['testHarness'](id, cfg); out.replaceChildren(res(!!r.installed, r.installed ? `ok ${r.version ?? ''}` : (r.error ?? 'não encontrado'), h)); }) }, 'Testar / detectar'),
          h('button', { 'data-act': 'models', onclick: () => void guard(async () => {
            const m = (await forge['harnessModels'](id, cfg)) as string[]; const novos = ml.offer(m);
            out.replaceChildren(res(novos > 0, novos ? `${novos} modelo(s) disponíveis — escolha quais carregar` : (m.length ? 'todos já carregados' : 'nenhum modelo encontrado'), h));
          }) }, 'Consultar modelos'),
          h('button', { 'data-act': 'test-prompt', onclick: () => void guard(async () => {
            out.replaceChildren(h('span', { class: 'muted' }, 'executando…'));
            const r = await forge['testPrompt'](id, cfg.defaultModel, cfg); out.replaceChildren(res(r.ok, r.ok ? `ok em ${(r.ms / 1000).toFixed(1)}s` : 'falhou', h), h('pre', {}, r.output));
          }) }, 'Testar prompt'), out)));
    }
  }

  if (cfgTab === 'app') {
    const langs: Array<[AppLanguage, string]> = [['pt-BR', 'Português (Brasil)'], ['en', 'English'], ['es', 'Español']];
    body.append(h('h3', {}, 'Idioma da interface'),
      h('p', { class: 'muted' }, 'Muda os textos do app (menus, botões, avisos). O idioma dos vídeos é escolhido por projeto (Idioma do vídeo) e não muda com esta opção.'),
      h('div', { class: 'card' }, h('div', { class: 'row' },
        h('label', {}, 'Idioma do app', sel(c, langs, s.uiLanguage ?? 'pt-BR', (v) => void guard(async () => { s.uiLanguage = v as AppLanguage; /* grava já: o redesenho relê as configurações e voltava ao português */ const cur = await forge['getSettings'](); await forge['setSettings']({ ...cur, uiLanguage: v }); window.dispatchEvent(new CustomEvent('ff:lang', { detail: v })); }), { id: 'cfg-lang' })),
        h('span', { class: 'muted' }, 'Aplicado na hora; use "Salvar configurações" para manter.')),
      h('div', { class: 'muted' }, 'Dica: os textos que ainda não têm tradução continuam em português.')), 
      h('h3', {}, 'Tema'),
      h('div', { class: 'card' }, h('div', { class: 'row' },
        h('button', { onclick: () => { const b = document.getElementById('theme-toggle'); if (b && (s.theme ?? 'dark') === 'dark') b.click(); } }, 'Usar tema claro'),
        h('button', { onclick: () => { const b = document.getElementById('theme-toggle'); if (b && (s.theme ?? 'dark') !== 'dark') b.click(); } }, 'Usar tema escuro'))));
    /* pasta de trabalho + ffmpeg/ffprobe (antes ficava escondido em "Whisper e thumbnails") */
    const ws = h('input', { value: s.workspace }) as HTMLInputElement; bind(ws, (v) => { s.workspace = v; });
    const ffOut = h('span', { class: 'muted', 'data-field': 'ffmpeg-out' });
    body.append(h('h3', {}, 'Pasta de trabalho e ffmpeg'), h('label', {}, 'Pasta de trabalho (workspace)', ws),
      field('ffmpeg', s.ffmpeg, (v) => { s.ffmpeg = v; }), field('ffprobe', s.ffprobe, (v) => { s.ffprobe = v; }),
      h('div', { class: 'row' }, h('button', { 'data-act': 'ffmpeg-detect', onclick: () => void guard(async () => {
        /* procura no PATH e nas pastas comuns (Downloads, WinGet, pasta do app) — sem caminho fixo */
        const r = (await forge['detectFfmpeg']()) as { ffmpeg?: string; ffprobe?: string };
        if (r.ffmpeg) s.ffmpeg = r.ffmpeg;
        if (r.ffprobe) s.ffprobe = r.ffprobe;
        toast(r.ffmpeg || r.ffprobe ? `ffmpeg: ${r.ffmpeg ?? '—'} · ffprobe: ${r.ffprobe ?? '—'}` : 'ffmpeg não encontrado no PATH nem nas pastas comuns — informe o caminho do .exe', !r.ffmpeg && !r.ffprobe);
        redraw();
      }) }, '🔍 Detectar ffmpeg'),
      h('button', { 'data-act': 'ffmpeg-test', onclick: () => void guard(async () => {
        /* roda -version de verdade: pega bloqueio do antivírus / DLL faltando antes de renderizar */
        const r = (await forge['testFfmpeg']()) as { ok: boolean; message: string };
        ffOut.replaceChildren(res(r.ok, r.message, h));
        toast(r.ok ? 'ffmpeg e ffprobe executando' : 'ffmpeg/ffprobe não executaram — veja a mensagem', !r.ok);
      }) }, '▶ Testar'), ffOut,
      h('span', { class: 'muted' }, 'a cópia dentro do app (resources\\tools\\ffmpeg) tem prioridade; depois o PATH, Downloads, WinGet e a pasta do app')));
  }

  if (cfgTab === 'plugins') {
    const plugins = (await forge['listPlugins']()) as PluginInfo[];
    const urlIn = h('input', { placeholder: 'https://github.com/dono/repo (ou dono/repo)', class: 'grow' }) as HTMLInputElement;
    body.append(h('h3', {}, 'Plugins (formato Claude)'),
      h('p', { class: 'muted' }, 'Um plugin é uma pasta com .claude-plugin/plugin.json e, opcionalmente, skills/, commands/, agents/, hooks/ e .mcp.json. O Dark Automate não executa o plugin: ele injeta as instruções no prompt de todas as etapas (além do "use [plugin]"), então funciona com qualquer provedor. Nos projetos, os plugins são opcionais.'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', id: 'plugin-install-dir', onclick: () => void guard(async () => {
          const k = (await forge['installPluginFolder']()) as PluginInfo | null;
          if (k) { toast(`Plugin "${k.name}" instalado`); S = undefined; void renderSettings(c, true); }
        }) }, 'Instalar da pasta…'),
        h('button', { id: 'plugin-open-dir', onclick: () => void forge['openPluginsFolder']() }, 'Abrir pasta dos plugins')),
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Instalar do GitHub', urlIn),
        h('button', { id: 'plugin-install-url', onclick: () => void guard(async () => {
          const u = urlIn.value.trim(); if (!u) throw new Error('Informe a URL do repositório.');
          const k = (await forge['installPluginUrl'](u)) as PluginInfo;
          toast(`Plugin "${k.name}" instalado`); urlIn.value = ''; S = undefined; void renderSettings(c, true);
        }) }, 'Instalar do GitHub…')),
        h('div', { class: 'muted' }, 'Baixa o zip do repositório (main/master) e instala a primeira pasta que tenha .claude-plugin/plugin.json.')),
      ...(plugins.length ? plugins.map((p) => h('div', { class: 'card', 'data-plugin': p.id },
        h('div', { class: 'row' }, h('strong', {}, p.name), p.version ? h('span', { class: 'tag' }, `v${p.version}`) : null, h('span', { class: 'sp' }),
          h('button', { id: `plugin-prompt-${p.id}`, onclick: () => void guard(async () => {
            const text = (await forge['pluginPrompt']([p.id])) as string;
            await showMessage(text ? text.slice(0, 6000) : 'Este plugin não tem instruções (skills/comandos/agentes) para injetar.');
          }) }, 'Ver o que vai no prompt'),
          h('button', { class: 'danger', id: `plugin-del-${p.id}`, onclick: () => void guard(async () => {
            if (!await askConfirm(`Remover o plugin "${p.name}"?`)) return;
            await forge['removePlugin'](p.id); toast('Plugin removido'); S = undefined; void renderSettings(c, true);
          }) }, 'Remover')),
        p.description ? h('div', { class: 'muted' }, p.description) : null,
        h('div', { class: 'muted' }, [p.skills?.length ? `skills: ${p.skills.join(', ')}` : '', p.commands?.length ? `comandos: ${p.commands.join(', ')}` : '', p.agents?.length ? `agentes: ${p.agents.join(', ')}` : '', p.mcp?.length ? `MCP: ${p.mcp.join(', ')}` : '', p.hasHooks ? 'hooks' : ''].filter(Boolean).join(' · ') || 'sem skills/comandos/agentes'),
        p.source ? h('div', { class: 'muted' }, `origem: ${p.source}`) : null)) : [h('p', { class: 'muted' }, 'Nenhum plugin instalado.')]));
  }

  if (cfgTab === 'mcp') {
    const info = (await forge['mcpInfo']()) as {
      command: string; args: string[]; version: string; config: string;
      httpUrl: string; httpRunning: boolean; httpConfig: string;
      tools: Array<{ name: string; description: string }>;
    };
    const out = h('div', { class: 'out' });
    const httpState = h('span', { class: 'muted' }, info.httpRunning ? `ATIVO — ${info.httpUrl}` : 'parado');
    const httpConfig = h('pre', { class: 'outstyle' }, info.httpConfig);
    const startHttp = async () => {
      httpState.textContent = 'iniciando…';
      const r = (await forge['mcpHttpStart']({ port: 3333, host: '127.0.0.1' })) as { ok: boolean; url?: string; error?: string };
      httpState.textContent = r.ok ? `ATIVO — ${r.url}` : `falhou: ${r.error ?? 'erro'}`;
      if (r.ok && r.url) {
        const cfg = { mcpServers: { filmforge: { url: r.url, transport: 'streamable-http' } } };
        httpConfig.textContent = JSON.stringify(cfg, null, 2);
      }
    };
    const stopHttp = async () => {
      await forge['mcpHttpStop']();
      httpState.textContent = 'parado';
    };
    body.append(
      h('h3', {}, 'Dark Automate como servidor MCP'),
      h('p', { class: 'muted' }, 'O Dark Automate fala MCP padrão em dois transportes: stdio (Claude Desktop, Claude Code, Cursor, OpenCode, VS Code, LM Studio) e Streamable HTTP/SSE (ChatGPT, Claude remoto e qualquer cliente por URL). O servidor expõe projetos, criação, execução, status, cenas, logs, rotas, skills, provedores, plugins e recursos.'),
      h('div', { class: 'card' },
        h('h4', {}, 'stdio — Claude Desktop / Claude Code / Cursor / VS Code'),
        h('div', { class: 'row' }, h('strong', {}, 'Comando'), h('span', { class: 'muted' }, `${info.command} --mcp`),
          h('button', { onclick: () => void guard(async () => { await forge['copyText'](info.config); toast('Configuração stdio copiada'); }) }, 'Copiar configuração'),
          h('button', { class: 'primary', onclick: () => void guard(async () => {
            out.replaceChildren(h('span', { class: 'muted' }, 'subindo o servidor e fazendo o handshake…'));
            const r = (await forge['mcpSelftest']()) as { ok: boolean; protocolVersion?: string; server?: string; tools?: number; projects?: number; resources?: number; error?: string };
            out.replaceChildren(res(r.ok, r.ok ? `servidor "${r.server}" respondeu (protocolo ${r.protocolVersion}) com ${r.tools} ferramentas · ${r.projects} projeto(s) · ${r.resources} recurso(s)` : `falhou: ${r.error ?? 'sem resposta'}`, h));
          }) }, 'Testar protocolo')),
        h('div', { class: 'muted' }, 'Cole em claude_desktop_config.json, .mcp.json, ~/.config/opencode/opencode.json ou na configuração do Cursor/VS Code:'),
        h('pre', { class: 'outstyle' }, info.config),
        out),
      h('div', { class: 'card' },
        h('h4', {}, 'HTTP / SSE — ChatGPT e clientes remotos'),
        h('div', { class: 'row' }, h('strong', {}, 'Endpoint'), h('code', {}, info.httpUrl), httpState,
          h('button', { class: 'primary', onclick: () => void guard(startHttp) }, 'Iniciar HTTP'),
          h('button', { onclick: () => void guard(stopHttp) }, 'Parar'),
          h('button', { onclick: () => void guard(async () => { await forge['copyText'](JSON.stringify({ mcpServers: { filmforge: { url: info.httpUrl, transport: 'streamable-http' } } }, null, 2)); toast('Configuração HTTP copiada'); }) }, 'Copiar configuração')),
        h('div', { class: 'muted' }, 'Também escuta SSE legado em /sse. Para o ChatGPT na nuvem, exponha esta porta por um túnel HTTPS (Cloudflare Tunnel/ngrok) e use a URL pública terminando em /mcp. Para clientes locais, use http://127.0.0.1:3333/mcp.'),
        httpConfig,
        h('div', { class: 'muted' }, 'CLI: Dark Automate.exe --mcp-http 3333 --mcp-host 127.0.0.1 (opcional: --mcp-token SEU_TOKEN). Variáveis: FILMFORGE_MCP_PORT, FILMFORGE_MCP_HOST, FILMFORGE_MCP_TOKEN.')),
      h('h3', {}, `Ferramentas expostas (${info.tools.length})`),
      h('div', { class: 'card' }, ...info.tools.map((t) => h('div', { class: 'muted' }, h('strong', {}, t.name), ' — ', t.description))),
      h('h3', {}, 'Recursos (resources)'),
      h('div', { class: 'card' }, h('div', { class: 'muted' }, 'filmforge://projects · filmforge://project/{id} · filmforge://project/{id}/log · filmforge://library/skills · filmforge://library/routes · filmforge://providers')),
    );
  }
  if (cfgTab === 'production') {
    s.defaults = s.defaults ?? {};
    const concNum = h('input', { type: 'number', min: '1', max: '8', step: '1', value: String(Math.max(1, Math.min(8, Math.round(s.defaults.sceneConcurrency ?? 3)))), class: 'num', id: 'cfg-conc' }) as HTMLInputElement;
    concNum.addEventListener('change', () => { s.defaults!.sceneConcurrency = Math.max(1, Math.min(8, Math.round(Number(concNum.value) || 3))); concNum.value = String(s.defaults!.sceneConcurrency); });
    body.append(h('h3', {}, 'Cenas em paralelo'),
      h('p', { class: 'muted' }, 'Quantas cenas o app produz ao mesmo tempo por padrão. Vale para projetos sem valor próprio — cada projeto pode mudar no editor, no cartão "Produção". Etapas que usam a GPU local (ComfyUI/Wan2GP) continuam uma por vez para não estourar a VRAM; texto, APIs e provedores de IA rodam em paralelo.'),
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('label', {}, 'Máximo de cenas simultâneas', concNum),
        h('span', { class: 'muted' }, '1 = uma cena por vez · 8 = o máximo')),
      h('div', { class: 'muted' }, 'Use o botão "Salvar configurações" no fim da página para aplicar.')));
    /* tempo máximo de produção sugerido no Novo projeto (0 = sem limite) */
    const curMax = Math.max(0, Math.round(s.defaults.maxProductionMin ?? 60));
    const maxNum = h('input', { type: 'number', min: '5', step: '5', value: String(curMax || 60), class: 'num', id: 'cfg-maxmin' }) as HTMLInputElement;
    const unl = h('input', { type: 'checkbox', id: 'cfg-nolimit' }) as HTMLInputElement; unl.checked = curMax === 0; maxNum.disabled = unl.checked;
    const apply = () => { maxNum.disabled = unl.checked; s.defaults!.maxProductionMin = unl.checked ? 0 : Math.max(5, Math.round(Number(maxNum.value) || 60)); };
    unl.addEventListener('change', apply); maxNum.addEventListener('change', apply);
    /* ordem da produção e legendas (padrões do Novo projeto) */
    const af = h('input', { type: 'checkbox', id: 'cfg-audio-first' }) as HTMLInputElement; af.checked = s.defaults.audioFirst ?? true;
    af.addEventListener('change', () => { s.defaults!.audioFirst = af.checked; });
    const subs = h('select', { id: 'cfg-subs' }, h('option', { value: 'off' }, '🚫 Não gerar'), h('option', { value: 'srt' }, '📄 Só o arquivo .srt'), h('option', { value: 'burn' }, '🔤 Gravar no vídeo')) as HTMLSelectElement;
    subs.value = s.defaults.subtitles ?? 'off';
    subs.addEventListener('change', () => { s.defaults!.subtitles = subs.value as 'off' | 'srt' | 'burn'; });
    body.append(h('h3', {}, 'Ordem da produção e legendas'),
      h('p', { class: 'muted' }, 'Narrar primeiro: narração e transcrição de todas as cenas saem antes dos clipes — áudio é rápido, a duração total aparece logo e a GPU local não troca de modelo a cada cena. Legendas: o padrão é não gerar; cada projeto escolhe no Novo projeto ou no editor.'),
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('label', { class: 'inline chk' }, af, '🎙 Narrar todas as cenas primeiro'), h('label', {}, 'Legendas nos projetos novos', subs))));
    body.append(h('h3', {}, 'Tempo máximo de produção'),
      h('p', { class: 'muted' }, 'Valor que já vem preenchido no Novo projeto. Ao atingir o tempo, a execução para de começar cenas novas e o que já foi gerado fica em cache (execute de novo para continuar). "Sem limite" deixa a produção rodar até terminar.'),
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('label', {}, 'Minutos', maxNum), h('label', { class: 'inline chk' }, unl, '♾ Sem limite de tempo'))));
  }

  if (cfgTab === 'local') {
    body.append(h('h3', {}, 'ComfyUI'), h('p', { class: 'muted' }, 'Onde o ComfyUI está rodando. Os workflows (formato API) ficam na pasta workflows/ do Dark Automate.'));
    s.comfyServers.forEach((srv, i) => {
      const out = h('span', {});
      body.append(h('div', { class: 'card', 'data-comfy': srv.id },
        h('div', { class: 'row' }, field('Id', srv.id, (v) => { srv.id = v; }, { 'data-field': 'comfy-id' }), field('URL', srv.url, (v) => { srv.url = v; }, { class: 'grow', 'data-field': 'comfy-url' }), field('Token (opcional)', srv.token ?? '', (v) => { srv.token = v || undefined; }),
          h('button', { 'data-act': 'comfy-test', onclick: () => void guard(async () => { const r = await forge['pingComfy'](srv.id, srv.url); out.replaceChildren(res(r.ok, r.ok ? 'online' : (r.error ?? 'offline'), h)); }) }, 'Testar'),
          h('button', { class: 'danger', onclick: () => { s.comfyServers.splice(i, 1); redraw(); } }, 'Remover'), out)));
    });
    body.append(h('div', { class: 'row' }, h('button', { 'data-act': 'comfy-add', onclick: () => { s.comfyServers.push({ id: `comfy${s.comfyServers.length + 1}`, url: 'http://127.0.0.1:8188' }); redraw(); } }, '+ Adicionar servidor ComfyUI')));
    s.defaults = s.defaults ?? {};
    body.append(h('h3', {}, 'Workflows padrão'), h('div', { class: 'row' },
      h('label', {}, 'Imagem', sel(c, [['', '(da rota)'], ...cat.workflows.filter((w) => w.capability === 'image').map((w) => [w.file, w.label] as [string, string])], s.defaults.imageWorkflow ?? '', (v) => { s.defaults!.imageWorkflow = v || undefined; })),
      h('label', {}, 'Vídeo', sel(c, [['', '(da rota)'], ...cat.workflows.filter((w) => w.capability === 'video').map((w) => [w.file, w.label] as [string, string])], s.defaults.videoWorkflow ?? '', (v) => { s.defaults!.videoWorkflow = v || undefined; }))));

    const w = (s.wan2gp = s.wan2gp ?? { root: '', python: 'python', cliArgs: [] });
    const wout = h('pre', { class: 'out' });
    const cli = h('input', { value: JSON.stringify(w.cliArgs) }) as HTMLInputElement; bind(cli, (v) => { try { w.cliArgs = JSON.parse(v); } catch { /* ignora até ser JSON válido */ } });
    const mt = h('input', { placeholder: 'model_type, ex.: ltx2_22B_distilled' }) as HTMLInputElement;
    s.wan2gpModels = s.wan2gpModels ?? [];
    const wanLists = ([['image', 'Imagens'], ['video', 'Vídeos'], ['voice', 'Voz'], ['music', 'Músicas']] as const).map(([k, l]) => ({
      l, ml: modelList(c, s.wan2gpModels!.filter((m) => m.kind === k).map((m) => m.model), (n) => {
        s.wan2gpModels = [...s.wan2gpModels!.filter((m) => m.kind !== k), ...n.map((model) => ({ kind: k, model }))];
      }, { field: 'wan-models-' + k, placeholder: 'model_type e Enter' }),
    }));
    body.append(h('h3', {}, 'Wan2GP'), h('p', { class: 'muted' }, 'Pasta onde o Wan2GP está instalado e o Python do ambiente dele. Não abra o Wan2GP ao mesmo tempo.'),
      h('div', { class: 'card' },
        h('div', { class: 'row' }, field('Pasta do Wan2GP', w.root, (v) => { w.root = v; }, { class: 'grow', 'data-field': 'wan-root' }), field('Python', w.python, (v) => { w.python = v; }, { class: 'grow', 'data-field': 'wan-python' })),
        h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Argumentos CLI extras (JSON)', cli)),
        h('div', { class: 'row' },
          h('button', { 'data-act': 'wan-test', onclick: () => void guard(async () => { await forge['setSettings'](s); const r = await forge['testWan2gp'](); wout.textContent = `ok — ${JSON.stringify(r.models).slice(0, 1500)}`;
            const names = ((r.models ?? []) as Array<{ model_type?: string } | string>).map((m) => (typeof m === 'string' ? m : m.model_type ?? '')).filter(Boolean);
            wanLists.forEach((w) => w.ml.offer(names)); toast(names.length + ' modelo(s) do Wan2GP — carregue nas categorias desejadas');
          }) }, 'Testar / listar modelos'),
          mt, h('button', { onclick: () => void guard(async () => { wout.textContent = JSON.stringify(await forge['wan2gpDefaults'](mt.value.trim()), null, 1).slice(0, 4000); }) }, 'Ver padrões do modelo')),
        wout,
        h('div', {}, h('strong', {}, 'Modelos Wan2GP carregados'), h('span', { class: 'muted' }, ' — por modalidade; as rotas avisam quando um template usa um model_type fora desta lista'),
          ...wanLists.map((w) => h('div', { class: 'wanlist' }, h('span', { class: 'muted' }, w.l), w.ml.el)))));
  }

  if (['voice', 'image', 'video', 'music'].includes(cfgTab)) {
    const capLabel: Record<string, string> = { voice: 'narração / voz', image: 'imagens', video: 'vídeos (ex.: Seedance, Snapgen)', music: 'músicas' };
    body.append(h('p', { class: 'muted' }, `APIs de ${capLabel[cfgTab]}. Uma API pode atender várias categorias (marque abaixo). Chaves ficam criptografadas no disco.`));
    const idxs = s.providers.map((p, i) => ({ p, i })).filter(({ p }) => (p.categories ?? ['text', 'image', 'voice']).includes(cfgTab as 'voice'));
    if (!idxs.length) body.append(h('p', { class: 'muted' }, 'Nenhuma API configurada nesta categoria.'));
    for (const { p, i } of idxs) {
      const prev = apiResults.get(p.id);
      const out = h('span', {}, prev ? res(prev.ok, prev.message, h) : null);
      const tab = cfgTab as ApiCategory;
      const apiMl = modelList(c, providerModelsFor(p, tab), (n) => { setProviderModelsFor(p, tab, n); }, { field: 'api-models' });
      /* ▶ ouve a voz: gera uma amostra com o executor real da API (cacheada por voz + idioma) */
      const mediaUrl = (x: string) => (forge.mediaUrl as unknown as (y: string) => string)(x);
      let audio: HTMLAudioElement | undefined;
      const voiceModel = () => providerModelsFor(p, 'voice')[0] ?? p.models[0] ?? 's2.1-pro-free';
      const playVoice = (v: string, btn: HTMLElement) => void guard(async () => {
        const before = btn.textContent;
        btn.textContent = '…'; btn.setAttribute('disabled', '');
        try {
          const f = (await forge['voicePreview']({ binding: { type: 'api', provider: p.id, model: voiceModel(), voice: v } as Binding, language: previewLang || 'pt-BR' })) as string;
          audio?.pause();
          audio = new Audio(mediaUrl(f) + '?t=' + Date.now());
          btn.textContent = '⏸';
          audio.onended = () => { btn.textContent = '▶'; };
          await audio.play();
        } catch (e) { btn.textContent = before ?? '▶'; throw e; }
        finally { btn.removeAttribute('disabled'); }
      });
      const voiceMl = modelList(c, p.voices ?? [], (n) => { p.voices = n; }, {
        field: 'api-voices', placeholder: 'adicionar voz e Enter',
        label: (v) => p.voiceLabels?.[v] ?? v, onPlay: playVoice,
      });
      const cats = (['text', 'voice', 'image', 'video', 'music'] as const).map((k) => {
        const cb = h('input', { type: 'checkbox' }) as HTMLInputElement; cb.checked = (p.categories ?? ['text', 'image', 'voice']).includes(k);
        cb.addEventListener('change', () => { const cur = new Set<string>(p.categories ?? ['text', 'image', 'voice']); cb.checked ? cur.add(k) : cur.delete(k); p.categories = [...cur] as typeof p.categories; });
        return h('label', { class: 'inline chk' }, cb, k);
      });
      body.append(h('div', { class: 'card', 'data-api': p.id },
        h('div', { class: 'row' }, p.kind === 'snapgen' ? h('span', { class: 'ico', title: 'Snapgen.AI' }, icon('snapgen')) : null,
          field('Id', p.id, (v) => { p.id = v; }, { 'data-field': 'api-id' }),
          h('label', {}, 'Tipo', sel(c, [['openai', 'OpenAI-compatível'], ['gemini', 'Google Gemini'], ['seedance', 'Seedance (BytePlus)'], ['snapgen', 'Snapgen.AI (imagem/vídeo)'], ['fish', 'Fish Audio (voz)']], p.kind, (v) => { p.kind = v as typeof p.kind; })),
          field('Base URL', p.baseUrl, (v) => { p.baseUrl = v; }, { class: 'grow', 'data-field': 'api-url' }),
          h('label', {}, 'Chave de API', bind(h('input', { type: 'password', value: p.apiKey, 'data-field': 'api-key' }) as HTMLInputElement, (v) => { p.apiKey = v; }))),
        p.kind === 'snapgen' ? h('div', { class: 'muted' }, 'Snapgen.AI usa o header x-api-key. O botão Testar consulta o saldo (/uapi/v1/account) e carrega os modelos de imagem e vídeo de /api/service-prices, cada um na sua aba. Grok e sd-2 ainda não são suportados no adaptador.') : null,
        p.kind === 'fish' ? h('div', { class: 'muted' }, 'Fish Audio: a voz é um reference_id (id de um modelo de voz da sua conta ou da biblioteca). O botão Testar valida a chave e carrega as vozes da sua conta + as mais usadas da biblioteca pública (licenciadas pelo Fish) no idioma do app. O ▶ de cada voz gera uma amostra. Também dá para colar o id ou o link fish.audio/m/<id> em "Vozes carregadas". Modelos: s2.1-pro-free (grátis), s2.1-pro, s2-pro, s1, drama-3.') : null,
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('strong', {}, 'Modelos carregados'), apiMl.el),
          cfgTab === 'voice' ? h('div', { class: 'grow' }, h('strong', {}, 'Vozes carregadas'), voiceMl.el) : null),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Categorias:'), ...cats,
          h('button', { 'data-act': 'api-test', onclick: () => void guard(async () => {
            const r = await forge['testApi'](p, { language: previewLang || 'pt-BR' }); apiResults.set(p.id, { ok: r.ok, message: r.message }); out.replaceChildren(res(r.ok, r.message, h));
            if (r.ok) {
              if (r.modelCategories) p.modelCategories = { ...(p.modelCategories ?? {}), ...r.modelCategories };
              const offered = ((r.models ?? []) as string[]).filter((m) => !p.modelCategories?.[m] || p.modelCategories[m] === cfgTab);
              if (offered.length) { apiMl.load(offered); toast(`${offered.length} modelo(s) de ${cfgTab} carregados — salve as configurações`); }
              else { const novos = apiMl.offer((r.models ?? []) as string[]); toast(novos ? `${novos} modelo(s) disponíveis — escolha quais carregar` : 'Nenhum modelo novo na API'); }
              /* Fish Audio (e outros): as vozes vêm junto com o teste (reference_id + título) */
              const rv = (r.voices ?? []) as string[];
              if (rv.length) {
                p.voiceLabels = { ...(p.voiceLabels ?? {}), ...((r.voiceLabels ?? {}) as Record<string, string>) };
                voiceMl.load(rv);
                toast(`${rv.length} voz(es) carregadas — salve as configurações`);
              }
            }
          }) }, 'Testar'),
          h('button', { class: 'danger', onclick: () => { s.providers.splice(i, 1); redraw(); } }, 'Remover'), out)));
    }
    const kind = h('select', { 'data-field': 'api-newkind' }, h('option', { value: 'openai' }, 'OpenAI-compatível'), h('option', { value: 'gemini' }, 'Google Gemini'), h('option', { value: 'seedance' }, 'Seedance (BytePlus)'), h('option', { value: 'snapgen' }, 'Snapgen.AI (imagem/vídeo)'), h('option', { value: 'fish' }, 'Fish Audio (voz)')) as HTMLSelectElement;
    body.append(h('div', { class: 'row' }, kind, h('button', { 'data-act': 'api-add', onclick: () => {
      const k = kind.value as 'openai' | 'gemini' | 'seedance' | 'snapgen' | 'fish';
      const base = k === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta'
        : k === 'seedance' ? 'https://ark.ap-southeast.bytepluses.com/api/v3'
          : k === 'snapgen' ? 'https://api.snapgen.ai'
            : k === 'fish' ? 'https://api.fish.audio'
              : 'https://api.openai.com/v1';
      const snapImg = ['nano-banana-pro', 'nano-banana-2', 'nano-banana-2-lite'];
      const snapVid = ['veo-3.1-fast', 'veo-3.1', 'veo-2', 'omni-flash'];
      const models = k === 'snapgen' ? [...snapImg, ...snapVid] : k === 'fish' ? [...FISH_TTS_MODELS] : [];
      const modelCategories: Record<string, ApiCategory> = {};
      if (k === 'snapgen') for (const m of snapImg) modelCategories[m] = 'image';
      if (k === 'snapgen') for (const m of snapVid) modelCategories[m] = 'video';
      if (k === 'fish') for (const m of FISH_TTS_MODELS) modelCategories[m] = 'voice';
      const categories: ApiCategory[] = k === 'snapgen' ? ['image', 'video'] : k === 'fish' ? ['voice'] : [cfgTab as ApiCategory];
      let id: string = k; let n = 2; while (s.providers.some((x) => x.id === id)) id = `${k}${n++}`;
      s.providers.push({ id, kind: k, baseUrl: base, apiKey: '', models, ...(k === 'snapgen' || k === 'fish' ? { modelCategories } : {}), categories }); redraw();
    } }, '+ Adicionar API')));
  }

  if (cfgTab === 'stock') {
    s.stock = s.stock ?? {};
    body.append(h('p', { class: 'muted' }, 'Bancos de imagens e vídeos usados nas cenas "stock" e "mixed". Os acervos abertos (Wikimedia, NASA, Internet Archive, Openverse, Smithsonian) funcionam sem chave; Pexels, Pixabay e Unsplash pedem uma chave gratuita. Créditos e licença de cada arquivo ficam salvos na cena (stock.json). Marque as fontes por rota (etapa "Bancos de mídia") ou por skill.'));
    const grid = h('div', { class: 'stock-grid' });
    for (const info of STOCK_SOURCES) {
      const src = info.id;
      const cfg = (s.stock[src] = s.stock[src] ?? {}); const out = h('span', { class: 'stock-out' });
      const ready = info.key !== 'obrigatória' || !!cfg.apiKey;
      grid.append(h('div', { class: `card stock-card${ready ? ' ready' : ''}`, 'data-stock': src },
        h('div', { class: 'row' }, h('span', { class: 'stock-ic' }, info.icon), h('strong', {}, info.label), h('span', { class: 'sp' }),
          h('span', { class: `tag ${ready ? 'done' : 'pending'}` }, ready ? (info.key === 'obrigatória' ? 'chave ok' : 'pronto, sem chave') : 'falta a chave')),
        h('div', { class: 'muted small' }, info.about),
        h('div', { class: 'row stock-chips' }, ...info.media.map((m) => h('span', { class: 'tag' }, m === 'image' ? '🖼️ imagens' : '🎞️ vídeos')), h('span', { class: 'tag kw' }, `⚖️ ${info.license}`)),
        info.key !== 'não' ? h('div', { class: 'row' },
          h('label', { class: 'grow' }, info.key === 'opcional' ? 'Chave de API (opcional)' : 'Chave de API', bind(h('input', { type: 'password', value: cfg.apiKey ?? '', 'data-field': 'stock-key' }) as HTMLInputElement, (v) => { cfg.apiKey = v; })),
          info.keyUrl ? h('button', { class: 'small', title: info.keyUrl, onclick: () => void forge['openUrl'](info.keyUrl!) }, '🔑 Obter chave') : null) : null,
        src === 'youtube' ? (() => {
          const sec = h('input', { type: 'range', min: '2', max: '4', step: '0.5', value: String(cfg.clipSeconds ?? 3), 'data-field': 'yt-seconds' }) as HTMLInputElement;
          const lbl = h('strong', {}, `${cfg.clipSeconds ?? 3} s`);
          sec.addEventListener('input', () => { cfg.clipSeconds = Number(sec.value); lbl.textContent = `${sec.value} s`; });
          const opt = (k: 'ccOnly' | 'noSubtitles' | 'noWatermark' | 'noTransitions', label: string, tip: string, def: boolean) => {
            const cb = h('input', { type: 'checkbox', 'data-field': `yt-${k}` }) as HTMLInputElement; cb.checked = cfg[k] ?? def;
            cb.addEventListener('change', () => { cfg[k] = cb.checked; });
            return h('label', { class: 'inline chk', title: tip }, cb, label);
          };
          return h('div', { class: 'yt-opts' },
            h('div', { class: 'row' }, h('span', {}, '⏱️ Duração do trecho capturado'), sec, lbl),
            h('div', { class: 'yt-chk' },
              opt('ccOnly', '©️ Só Creative Commons', 'Busca com o filtro de licença Creative Commons do próprio YouTube', false),
              opt('noSubtitles', '💬 Sem legendas', 'Corta o rodapé (12%), evita vídeos legendados e rejeita trechos com texto (checagem visual)', true),
              opt('noWatermark', '🚫 Sem marcas d’água', 'Corta 7% das bordas (onde ficam os logos) e rejeita trechos com logo/marca', true),
              opt('noTransitions', '✂️ Sem transições', 'Detecta cortes de cena e usa só um trecho contínuo (descarta montagens/trailers)', true)));
        })() : null,
        src === 'wikipedia' ? h('label', {}, 'Contato (site ou e-mail) — o Wikimedia exige para baixar VÍDEOS; imagens funcionam sem', bind(h('input', { value: cfg.contact ?? '', placeholder: 'ex.: https://meucanal.com ou voce@email.com', 'data-field': 'stock-contact' }) as HTMLInputElement, (v) => { cfg.contact = v.trim() || undefined; })) : null,
        h('details', {}, h('summary', { class: 'muted small' }, 'avançado'), field('Base URL (opcional)', cfg.baseUrl ?? '', (v) => { cfg.baseUrl = v || undefined; }, { class: 'grow' })),
        h('div', { class: 'row' }, h('button', { class: 'small', 'data-act': 'stock-test', onclick: () => void guard(async () => { out.replaceChildren(h('span', { class: 'muted' }, '⏳ testando…')); const r = await forge['testStock'](src, s.stock); out.replaceChildren(res(r.ok, r.message, h)); }) }, 'Testar'),
          h('button', { class: 'small', onclick: () => void forge['openUrl'](info.site) }, '🌐 Site'), out)));
    }
    body.append(grid);
  }

  if (cfgTab === 'folders') {
    const root = (await forge['projectsRoot']()) as string;
    const dirIn = h('input', { value: root, id: 'cfg-projects-dir', class: 'grow' }) as HTMLInputElement;
    const move = h('input', { type: 'checkbox', id: 'cfg-projects-move' }) as HTMLInputElement; move.checked = true;
    body.append(h('h3', {}, 'Pasta dos projetos'),
      h('p', { class: 'muted' }, 'Todos os projetos são salvos nesta pasta (uma subpasta por projeto). Ao trocar, você pode mover os projetos existentes para o novo local; os caminhos internos são atualizados.'),
      h('div', { class: 'card' },
        h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Pasta atual', dirIn),
          h('button', { id: 'cfg-projects-pick', onclick: () => void guard(async () => { const d = (await forge['openDir']({ title: 'Pasta dos projetos', defaultPath: dirIn.value })) as string | null; if (d) dirIn.value = d; }) }, 'Escolher…')),
        h('div', { class: 'row' }, h('label', { class: 'inline chk' }, move, 'mover os projetos existentes para a nova pasta'),
          h('button', { class: 'primary', id: 'cfg-projects-apply', onclick: () => void guard(async () => {
            if (!dirIn.value.trim()) throw new Error('Escolha uma pasta.');
            if (dirIn.value.trim() === root) { toast('A pasta já é esta.'); return; }
            if (!await askConfirm(`Usar "${dirIn.value.trim()}" como pasta dos projetos?${move.checked ? '\nOs projetos existentes serão movidos para lá.' : '\nOs projetos existentes ficam na pasta antiga (não aparecerão na lista).'}`)) return;
            const r2 = (await forge['setProjectsDir'](dirIn.value.trim(), move.checked)) as { dir: string; moved: number };
            S = undefined; toast(`Pasta dos projetos: ${r2.dir}${move.checked ? ` (${r2.moved} movido/s)` : ''}`); void renderSettings(c, true);
          }) }, 'Aplicar'),
          h('button', { onclick: () => void forge['openProjectsRoot']() }, 'Abrir pasta'))));

    /* perfil portátil: skills, rotas, plugins, vozes, perfis e chaves viajam numa pasta só */
    const pi = (await forge['portableInfo']()) as { portable: boolean; root?: string; reason?: string; settingsFile: string; workspace: string; plugins: string; projects: string };
    const pout = h('div', { class: 'muted', id: 'cfg-portable-out' });
    body.append(h('h3', {}, '🎒 Perfil portátil'),
      h('p', { class: 'muted' }, 'Tudo o que você cria ou altera — skills (inclusive as padrão que você personalizou), rotas, tipos, agentes, plugins, vozes, perfis de provedores e chaves de API — é gravado em disco na hora e fica permanente. Para levar para outro PC, exporte o perfil: ele vira a pasta FilmForgeData. Coloque o Dark Automate portátil (.exe) ao lado dela e abre tudo igual; a letra do drive pode mudar.'),
      h('div', { class: 'card', id: 'cfg-portable' },
        h('div', { class: 'row' }, pi.portable ? h('span', { class: 'tag done' }, `✓ modo portátil (${pi.reason})`) : h('span', { class: 'tag' }, 'instalação normal')),
        h('div', { class: 'muted small' }, `Configurações e chaves de API: ${pi.settingsFile} (+ .keyring na mesma pasta — copie os dois juntos)`), h('div', { class: 'muted small' }, `Biblioteca e vozes: ${pi.workspace}`),
        h('div', { class: 'muted small' }, `Plugins: ${pi.plugins}`), h('div', { class: 'muted small' }, `Projetos: ${pi.projects}`),
        h('div', { class: 'row' },
          h('button', { class: 'primary', id: 'cfg-portable-export', onclick: () => void guard(async () => {
            const r = (await forge['portableExport']()) as { root: string; copied: string[] } | null;
            if (r) { pout.textContent = `Perfil exportado em ${r.root} (${r.copied.join(', ') || 'só configurações'}). Projetos não vão junto: copie a pasta deles se quiser.`; toast('Perfil portátil exportado'); }
          }) }, '⬇ Exportar perfil portátil'),
          h('button', { id: 'cfg-portable-import', onclick: () => void guard(async () => {
            if (!await askConfirm('Importar um FilmForgeData? Skills, rotas, plugins e vozes dele são copiados para cá (itens com o mesmo nome são substituídos) e as configurações passam a ser as dele.')) return;
            const r = (await forge['portableImport']()) as { from: string; copied: string[] } | null;
            if (r) { S = undefined; toast(`Perfil importado de ${r.from}`); void renderSettings(c, true); }
          }) }, '⬆ Importar perfil'),
          h('button', { onclick: () => void forge['portableOpen']() }, 'Abrir pasta de dados')),
        pout));
  }

  if (cfgTab === 'misc') {
    const wh = (s.whisper = s.whisper ?? { python: 'python', model: 'small', device: 'auto' }); const wout = h('span', {});
    body.append(h('h3', {}, 'Whisper (faster-whisper)'), h('p', { class: 'muted' }, 'Transcreve a narração com tempo por palavra para sincronizar gráficos e clipes. Sem faster-whisper, o sistema estima os tempos pelo tamanho do texto. Instale com o botão "Baixar/instalar Whisper" (venv isolado; não mexe no ComfyUI).'),
      h('div', { class: 'card' }, h('div', { class: 'row' },
        field('Python', wh.python, (v) => { wh.python = v; }, { class: 'grow', 'data-field': 'whisper-python' }),
        h('label', {}, 'Modelo', sel(c, ['tiny', 'base', 'small', 'medium', 'large-v3', 'distil-large-v3'].map((x) => [x, x] as [string, string]), wh.model, (v) => { wh.model = v; })),
        h('label', {}, 'Dispositivo', sel(c, [['auto', 'auto'], ['cpu', 'CPU'], ['cuda', 'GPU (CUDA)']], wh.device, (v) => { wh.device = v; })),
        h('button', { 'data-act': 'whisper-install', onclick: () => void guard(async () => {
          wout.replaceChildren(h('span', { class: 'muted' }, 'instalando faster-whisper (pip) — pode levar alguns minutos…'));
          const r = await forge['installWhisper']() as { ok: boolean; python: string; version?: string };
          wh.python = r.python;
          wout.replaceChildren(res(r.ok, `Whisper pronto: ${r.python}${r.version ? ' — ' + r.version : ''}`, h));
        }) }, 'Baixar/instalar Whisper'),
        h('button', { 'data-act': 'whisper-test', onclick: () => void guard(async () => { const r = await forge['testWhisper'](wh); wout.replaceChildren(res(r.ok, r.message, h)); }) }, 'Testar'), wout)));
    s.thumbnails = s.thumbnails ?? [];
    body.append(h('h3', {}, 'Templates de thumbnail'), h('p', { class: 'muted' }, 'Variáveis: {{title}} {{thumb_text}} {{style}} {{idea}}. O modelo (Krea2, Z-Image, OpenAI, Gemini) é escolhido na tarefa "Thumbnail" da rota. Só gera para vídeos 16:9 (YouTube).'));
    s.thumbnails.forEach((t, i) => {
      const ta = h('textarea', { rows: '3' }) as HTMLTextAreaElement; ta.value = t.prompt; bind(ta, (v) => { t.prompt = v; });
      body.append(h('div', { class: 'card', 'data-thumb': t.id }, h('div', { class: 'row' }, field('Id', t.id, (v) => { t.id = v; }), field('Nome', t.name, (v) => { t.name = v; }, { class: 'grow' }),
        h('button', { class: 'danger', onclick: () => { s.thumbnails!.splice(i, 1); redraw(); } }, 'Remover')), h('label', {}, 'Prompt', ta)));
    });
    body.append(h('div', { class: 'row' }, h('button', { 'data-act': 'thumb-add', onclick: () => { s.thumbnails!.push({ id: `tpl${s.thumbnails!.length + 1}`, name: 'Novo template', prompt: 'YouTube thumbnail, 16:9, {{title}}, bold text "{{thumb_text}}", {{style}}' }); redraw(); } }, '+ Novo template')));
  }

  main.replaceChildren(h('h2', {}, 'Configurações'), tabs, body,
    h('div', { class: 'row savebar' }, h('button', { class: 'primary', id: 'cfg-save', onclick: () => void guard(async () => { await forge['setSettings'](s); toast('Configurações salvas'); }) }, 'Salvar configurações'),
      h('button', { onclick: () => { S = undefined; void renderSettings(c, true); } }, 'Descartar alterações')));
}
