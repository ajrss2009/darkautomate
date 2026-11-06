import type { Binding, ExecutorCategory, ExecutorProfile, Project, ReasoningEffort, Route, RouteStep, Settings } from '../shared/types';
import { EFFORT_OPTIONS, harnessOffersEffort } from '../shared/effort';
import { CATEGORIES, CATEGORY_INFO, CATEGORY_OF, ROLES, ROLE_INFO, ROLE_OF, applyExecutorProfile, applyStepBindings, balanceRoles, downstreamSteps, profileSkips, setStepHead, stepTargets, type StepRole } from '../shared/profiles';
import { askConfirm, showMessage } from './dialogs';

/*
 * Janelas modais ilustradas para escolher QUEM executa cada parte do vídeo:
 * - openProvidersModal: perfil de executores do projeto (texto, código, imagem, vídeo, voz, música);
 * - openBindingPicker: escolher o executor de UMA tarefa no editor de rotas.
 * Tudo é visual: cartões com ícone, status (instalado / offline), local × nuvem e modelo.
 */

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (typeof v === 'boolean') { if (v) el.setAttribute(k, ''); }
    else el.setAttribute(k, v);
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = Record<string, (...a: any[]) => Promise<any>>;
interface Catalog {
  workflows: Array<{ file: string; label: string; capability: string }>;
  wan2gpTemplates: Array<{ file: string; label: string; capability: string; modelType?: string }>;
  apis: Array<{ provider: string; kind: string; categories: string[]; models: string[]; modelCategories?: Record<string, string>; voices: string[]; voiceLabels?: Record<string, string> }>;
  harnesses: Array<{ id: string; models: string[]; defaultModel?: string }>;
  comfyServers: string[];
  flowAccounts?: Array<{ id: string; label: string; email?: string }>;
}
export interface PickerCtx { forge: Api; toast: (m: string, bad?: boolean) => void; language?: string }

/* ───────── logotipos (SVG) dos provedores ───────── */
const LOGOS: Record<string, string> = {
  // Antigravity: chevron branco sobre quadrado cinza-escuro
  antigravity: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#2b2d31"/><path d="M8.5 22.5 15 10.2a1.2 1.2 0 0 1 2 0l6.5 12.3" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // Claude: estrela de raios brancos sobre laranja
  claude: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#d97757"/><g stroke="#fff" stroke-width="2.3" stroke-linecap="round">' +
    Array.from({ length: 12 }, (_, i) => { const a = (i * 30 + 8) * Math.PI / 180, r1 = 1.6, r2 = i % 2 ? 8.2 : 9.6; return `<line x1="${(16 + r1 * Math.cos(a)).toFixed(2)}" y1="${(16 + r1 * Math.sin(a)).toFixed(2)}" x2="${(16 + r2 * Math.cos(a)).toFixed(2)}" y2="${(16 + r2 * Math.sin(a)).toFixed(2)}"/>`; }).join('') +
    '</g></svg>',
  // OpenCode: moldura branca com o "bloco" interno em cinza, sobre preto
  opencode: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#141414"/><rect x="9.5" y="7.5" width="13" height="17" rx="1" fill="#2a2a2a" stroke="#ececec" stroke-width="2.4"/><rect x="12" y="15" width="8" height="7" fill="#7a7a7a"/></svg>',
};
/** Ícone de um executor: logotipo SVG ("logo:nome") ou emoji. */
export function artIcon(icon: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'aicon';
  const logo = icon.startsWith('logo:') ? LOGOS[icon.slice(5)] : undefined;
  if (logo) { span.classList.add('logo'); span.innerHTML = logo; } else span.textContent = icon;
  return span;
}
/** Vários ícones lado a lado (sem repetir), para os cartões de perfil. */
/** Harnesses que podem ser reserva (ordem do seletor). */
export const FALLBACK_HARNESSES = ['opencode', 'claude', 'antigravity', 'codex', 'deepseek', 'openclaw', 'ollama', 'lmstudio', 'llamacpp'];

/**
 * Seletor de reservas de harness: clicar inclui/tira, e a ordem dos cliques é a ordem de uso
 * (Configurações → Provedores e Novo projeto). onChange recebe a lista nova (vazia = padrão).
 */
export function fallbackChips(id: string, initial: string[] | undefined, onChange: (next: string[]) => void, available?: string[],
  off?: { value: boolean; onChange: (v: boolean) => void }): HTMLElement {
  let cur = [...(initial ?? [])];
  let none = !!off?.value;
  const box = document.createElement('div');
  box.className = 'pchips'; box.id = id;
  /* "Sem reserva": a etapa falha com o erro do provedor (para ver o que deu errado, ex.: no Ollama) */
  const offChip = () => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `chip${none ? ' on' : ''}`; b.dataset['fb'] = 'none';
    b.title = 'Sem reserva: cada etapa usa só o primeiro provedor; se falhar, a execução para e mostra o erro';
    b.textContent = '🚫 Sem reserva';
    b.addEventListener('click', () => { none = !none; off!.onChange(none); paint(); });
    return b;
  };
  const paint = () => box.replaceChildren(...(off ? [offChip()] : []), ...FALLBACK_HARNESSES.filter((x) => !available || available.includes(x)).map((x) => {
    const b = document.createElement('button');
    const i = cur.indexOf(x);
    b.type = 'button'; b.className = `chip${i >= 0 && !none ? ' on' : ''}`; b.dataset['fb'] = x;
    b.disabled = none;
    b.title = none ? 'Desligado: "Sem reserva" está ativo' : 'Clique para incluir/tirar — a ordem dos cliques é a ordem de uso';
    b.append(artIcon((HARNESS_ART[x] ?? { icon: '🤖' }).icon), document.createTextNode(` ${i >= 0 && !none ? `${i + 1}. ` : ''}${HARNESS_ART[x]?.name ?? x}`));
    b.addEventListener('click', () => { cur = cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x]; onChange([...cur]); paint(); });
    return b;
  }));
  paint();
  return box;
}

export function artIcons(icons: string[], max = 3): HTMLElement {
  const box = document.createElement('span');
  box.className = 'aicons';
  for (const i of icons.filter((x, k, a) => x && a.indexOf(x) === k).slice(0, max)) box.append(artIcon(i));
  return box;
}

/* ───────── identidade visual de cada executor ───────── */
const HARNESS_ART: Record<string, { icon: string; name: string; where: 'local' | 'nuvem' | 'local/nuvem'; blurb: string }> = {
  auto: { icon: '✨', name: 'Automático', where: 'local/nuvem', blurb: 'O primeiro provedor instalado/alcançável' },
  claude: { icon: 'logo:claude', name: 'Claude Code', where: 'nuvem', blurb: 'Excelente em código e roteiros longos' },
  antigravity: { icon: 'logo:antigravity', name: 'Antigravity', where: 'nuvem', blurb: 'Gemini via CLI; rápido e barato' },
  codex: { icon: '🧩', name: 'Codex', where: 'nuvem', blurb: 'CLI da OpenAI para código' },
  opencode: { icon: 'logo:opencode', name: 'OpenCode', where: 'local/nuvem', blurb: 'CLI agêntica com vários modelos' },
  openclaw: { icon: '🦀', name: 'OpenClaw', where: 'local/nuvem', blurb: 'CLI agêntica aberta' },
  ollama: { icon: '🦙', name: 'Ollama', where: 'local', blurb: 'Modelos no seu PC, sem custo' },
  llamacpp: { icon: '🦙', name: 'llama.cpp', where: 'local', blurb: 'Servidor local compatível com OpenAI' },
  lmstudio: { icon: '🧪', name: 'LM Studio', where: 'local', blurb: 'Modelos locais com interface' },
  deepseek: { icon: '🐋', name: 'DeepSeek Harness', where: 'nuvem', blurb: 'Agente da DeepSeek (dsh); bom e barato em código' },
};
const CAP_OF_CAT: Record<ExecutorCategory, string | undefined> = { text: undefined, code: undefined, image: 'image', video: 'video', voice: 'voice', music: 'music' };
const API_CAT: Record<ExecutorCategory, string> = { text: 'text', code: 'text', image: 'image', video: 'video', voice: 'voice', music: 'music' };
const WF_ICON: Record<string, string> = { image: '🖼️', video: '🎞️', voice: '🗣️', music: '🎼' };

export function bindingArt(b: Binding): { icon: string; title: string; sub: string; where: string } {
  switch (b.type) {
    case 'harness': { const a = HARNESS_ART[b.harness] ?? { icon: '🤖', name: b.harness, where: 'local/nuvem' }; return { icon: a.icon, title: a.name, sub: b.model && b.model !== 'auto' ? b.model : 'modelo padrão', where: a.where }; }
    case 'comfyui': return { icon: '🖥️', title: 'ComfyUI', sub: b.workflow.replace(/\.json$/, ''), where: 'GPU local' };
    case 'wan2gp': return { icon: '🌀', title: 'Wan2GP', sub: b.template.replace(/\.json$/, ''), where: 'GPU local' };
    case 'api': return { icon: '☁️', title: `API ${b.provider}`, sub: b.model + (b.voice ? ` · voz ${b.voice}` : ''), where: 'nuvem (paga)' };
    case 'stock': return { icon: '🗂️', title: 'Bancos de mídia', sub: b.sources.join(' + '), where: 'internet' };
    case 'builtin': return { icon: '🧰', title: 'Ferramenta do app', sub: b.tool, where: 'local' };
    case 'flow': return { icon: '🌊', title: 'Google Flow', sub: b.account ? `conta ${b.account}` : 'primeira conta com login', where: 'sua conta Google' };
    default: return { icon: '✋', title: 'Manual', sub: 'você fornece o arquivo', where: '—' };
  }
}

let harnessStatus: Record<string, { installed: boolean; version?: string }> | undefined;
async function loadStatus(c: PickerCtx) {
  if (!harnessStatus) { try { harnessStatus = await c.forge['detectHarnesses']() as typeof harnessStatus; } catch { harnessStatus = {}; } }
  return harnessStatus!;
}

/** Modelos da API para a categoria: usa as categorias declaradas; sem elas, deduz pelo nome (gpt-image/tts/veo…). */
const NAME_CAT: Array<[RegExp, string]> = [[/tts|speech|voice/i, 'voice'], [/image|imagen|banana|dall-?e|flux/i, 'image'], [/veo|video|seedance|kling|sora|omni|minimax/i, 'video'], [/music|suno|lyria/i, 'music']];
function apiModels(a: Catalog['apis'][number], cat: ExecutorCategory): string[] {
  const want = API_CAT[cat];
  if (a.modelCategories) return a.models.filter((m) => !a.modelCategories![m] || a.modelCategories![m] === want);
  return a.models.filter((m) => (NAME_CAT.find(([re]) => re.test(m))?.[1] ?? 'text') === want);
}

/** Todas as opções (cartões) para uma categoria. */
function optionsFor(cat: ExecutorCategory, catalog: Catalog): Binding[] {
  const out: Binding[] = [];
  if (cat === 'text' || cat === 'code') {
    out.push({ type: 'harness', harness: 'auto' });
    for (const hv of catalog.harnesses) out.push({ type: 'harness', harness: hv.id as never, ...(hv.defaultModel ? { model: hv.defaultModel } : {}) });
  }
  const cap = CAP_OF_CAT[cat];
  if (cap) {
    for (const w of catalog.workflows.filter((x) => x.capability === cap)) out.push({ type: 'comfyui', server: catalog.comfyServers[0] ?? 'local', workflow: w.file });
    for (const w of catalog.wan2gpTemplates.filter((x) => x.capability === cap)) out.push({ type: 'wan2gp', template: w.file });
  }
  if (cat === 'image' || cat === 'video') {   // Google Flow pela conta de Automações (Nano Banana / Veo)
    out.push({ type: 'flow' });
    for (const a of catalog.flowAccounts ?? []) out.push({ type: 'flow', account: a.id });
  }
  for (const a of catalog.apis.filter((x) => x.categories.includes(API_CAT[cat]))) {
    const models = apiModels(a, cat);
    if (models[0]) out.push({ type: 'api', provider: a.provider, model: models[0], ...(cat === 'voice' && a.voices[0] ? { voice: a.voices[0] } : {}) });
  }
  if (cat === 'music') out.push({ type: 'builtin', tool: 'library-music' });
  return out;
}
const key = (b: Binding) => b.type === 'harness' ? `h:${b.harness}` : b.type === 'comfyui' ? `c:${b.workflow}` : b.type === 'wan2gp' ? `w:${b.template}` : b.type === 'api' ? `a:${b.provider}` : b.type === 'builtin' ? `b:${b.tool}` : b.type === 'flow' ? `f:${b.account ?? ''}` : b.type;

/** Cartão ilustrado de um executor. */
function tile(b: Binding, o: { selected?: boolean; status?: Record<string, { installed: boolean }>; onClick?: () => void; small?: boolean; label?: string }): HTMLElement {
  const art = bindingArt(b);
  const st = b.type === 'harness' && b.harness !== 'auto' && o.status ? o.status[b.harness] : undefined;
  const dot = st ? h('span', { class: `pdot ${st.installed ? 'ok' : 'bad'}`, title: st.installed ? 'instalado' : 'não encontrado' }) : null;
  return h('button', { class: `ptile${o.selected ? ' sel' : ''}${o.small ? ' small' : ''}`, 'data-exec': key(b), onclick: () => o.onClick?.(), title: `${art.title} — ${art.sub}` },
    h('span', { class: 'picon' }, artIcon(art.icon)),
    h('span', { class: 'ptxt' }, h('strong', {}, art.title, dot), h('span', { class: 'muted' }, o.label ?? art.sub)),
    o.small ? null : h('span', { class: 'pwhere' }, art.where));
}

/** ▶ ouve a voz escolhida: gera uma amostra com o executor real da API (cacheada por voz + idioma). */
let previewAudio: HTMLAudioElement | undefined;
async function previewApiVoice(ctx: PickerCtx | undefined, b: Binding, btn: HTMLElement): Promise<void> {
  if (!ctx) return;
  const before = btn.textContent;
  btn.textContent = '…'; btn.setAttribute('disabled', '');
  try {
    const f = (await ctx.forge['voicePreview']({ binding: b, language: ctx.language ?? 'pt-BR' })) as string;
    previewAudio?.pause();
    previewAudio = new Audio((ctx.forge['mediaUrl'] as unknown as (x: string) => string)(f) + '?t=' + Date.now());
    btn.textContent = '⏸';
    previewAudio.onended = () => { btn.textContent = '▶'; };
    await previewAudio.play();
  } catch (e) { btn.textContent = before ?? '▶'; ctx.toast((e as Error).message, true); }
  finally { btn.removeAttribute('disabled'); }
}

/** Seletor de modelo/voz do executor escolhido (harness e API). */
function detailFields(b: Binding, cat: ExecutorCategory, catalog: Catalog, onChange: () => void, ctx?: PickerCtx): HTMLElement | null {
  if (b.type === 'harness' && b.harness !== 'auto') {
    const hv = catalog.harnesses.find((x) => x.id === b.harness);
    const models = hv?.models ?? [];
    const sel = h('select', { 'data-field': 'pm-model' }, h('option', { value: '' }, 'modelo padrão do provedor'), ...models.map((m) => h('option', { value: m }, m))) as HTMLSelectElement;
    if (b.model && !models.includes(b.model)) sel.append(h('option', { value: b.model }, b.model + ' (não listado)'));
    sel.value = b.model && b.model !== 'auto' ? b.model : '';
    sel.addEventListener('change', () => { if (sel.value) b.model = sel.value; else delete b.model; onChange(); });
    return h('label', { class: 'pdetail' }, 'Modelo', sel, models.length ? null : h('span', { class: 'muted' }, 'Carregue modelos em Configurações → Provedores.'));
  }
  if (b.type === 'api') {
    const a = catalog.apis.find((x) => x.provider === b.provider);
    const models = a ? apiModels(a, cat) : [];
    if (b.model && !models.includes(b.model)) models.push(b.model);
    const ms = h('select', { 'data-field': 'pm-api-model' }, ...models.map((m) => h('option', { value: m }, m))) as HTMLSelectElement;
    ms.value = b.model; ms.addEventListener('change', () => { b.model = ms.value; onChange(); });
    const parts: Child[] = [h('label', { class: 'pdetail' }, 'Modelo', ms)];
    if (cat === 'voice' && a?.voices.length) {
      const vs = h('select', { 'data-field': 'pm-voice' }, ...a.voices.map((v) => h('option', { value: v }, a.voiceLabels?.[v] ? `${a.voiceLabels[v]} · ${v}` : v))) as HTMLSelectElement;
      vs.value = b.voice ?? a.voices[0]!; vs.addEventListener('change', () => { b.voice = vs.value; onChange(); });
      const play = h('button', { class: 'chip vspeak', title: 'Ouvir esta voz', onclick: (e: Event) => { e.preventDefault(); void previewApiVoice(ctx, { ...b, voice: vs.value } as Binding, e.currentTarget as HTMLElement); } }, '▶');
      parts.push(h('label', { class: 'pdetail' }, 'Voz', vs, play));
    }
    return h('div', { class: 'row' }, ...parts);
  }
  return null;
}

/** Fecha com Esc e clique fora. */
function modalShell(id: string, title: string, subtitle: string, body: HTMLElement[], footer: HTMLElement[]): { bg: HTMLElement; close: () => void } {
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const bg = h('div', { class: 'modal-bg', id, onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal pmodal' },
      h('div', { class: 'row' }, h('h3', {}, title), h('span', { class: 'sp' }), h('button', { onclick: close, title: 'Fechar (Esc)' }, '✕')),
      h('p', { class: 'muted' }, subtitle),
      ...body,
      h('div', { class: 'row actions pfoot' }, ...footer)));
  document.addEventListener('keydown', onKey);
  document.body.append(bg);
  return { bg, close };
}

/** Executor principal que cada categoria terá nesta rota (depois do perfil). */
export function effectiveByCategory(route: Route | undefined, chains?: ExecutorProfile['chains']): Record<ExecutorCategory, { binding?: Binding; steps: RouteStep[]; locked: RouteStep[] }> {
  const r = route ? applyExecutorProfile(route, chains ? { id: 'x', name: 'x', chains } : undefined) : undefined;
  const out = Object.fromEntries(CATEGORIES.map((k) => [k, { binding: undefined, steps: [], locked: [] }])) as unknown as Record<ExecutorCategory, { binding?: Binding; steps: RouteStep[]; locked: RouteStep[] }>;
  for (const st of r?.steps ?? []) {
    if (!st.enabled) continue;
    const cat = CATEGORY_OF[st.kind]; if (!cat) continue;
    if (profileSkips(route!.steps.find((x) => x.id === st.id) ?? st)) { out[cat].locked.push(st); continue; }
    out[cat].steps.push(st);
    if (!out[cat].binding) out[cat].binding = st.bindings[0];
  }
  return out;
}

export interface ProvidersChoice { profileId?: string; chains?: ExecutorProfile['chains']; /** executor por etapa (balanceamento) */ steps?: Record<string, Binding>; label: string }

/**
 * Janela "Provedores do projeto": escolha um perfil pronto ou monte o seu,
 * categoria por categoria, vendo em quais tarefas da rota cada escolha entra.
 */
export async function openProvidersModal(c: PickerCtx, o: { route?: Route; current?: ProvidersChoice; onPick: (ch: ProvidersChoice | undefined) => void; mode?: 'project' | 'profile'; editProfile?: ExecutorProfile }) {
  const [catalog, settings] = await Promise.all([c.forge['catalog']() as Promise<Catalog>, c.forge['getSettings']() as Promise<Settings>]);
  const meta = (await c.forge['meta']()) as { profiles?: ExecutorProfile[] };
  let profiles = meta.profiles ?? [];
  const status = await loadStatus(c);
  let profileId = o.current?.profileId;
  let chains: ExecutorProfile['chains'] = JSON.parse(JSON.stringify(o.current?.chains ?? profiles.find((p) => p.id === profileId)?.chains ?? {}));
  let open: ExecutorCategory | undefined;
  let steps: Record<string, Binding> = JSON.parse(JSON.stringify(o.current?.steps ?? {}));
  const stepBox = h('div', { class: 'psteps', id: 'pm-steps' });
  /* ── executor por etapa: roteiro num harness, execução noutro, revisão noutro ── */
  const hOpts = [{ id: 'auto', models: [] as string[] }, ...catalog.harnesses];
  const hName = (id: string) => (id === 'auto' ? 'auto (o melhor instalado)' : HARNESS_ART[id]?.name ?? id) + (id !== 'auto' && status[id] && !status[id]!.installed ? ' — não encontrado' : '');
  const harnessSelect = (cur: string | undefined, empty: string, onPick: (id: string | undefined) => void) => {
    const s = h('select', {}, h('option', { value: '' }, empty), ...hOpts.map((x) => h('option', { value: x.id }, hName(x.id)))) as HTMLSelectElement;
    s.value = cur ?? '';
    s.addEventListener('change', () => onPick(s.value || undefined));
    return s;
  };
  const modelSelect = (b: Binding & { type: 'harness' }, onPick: (m: string | undefined) => void) => {
    const models = hOpts.find((x) => x.id === b.harness)?.models ?? [];
    if (!models.length) return null;
    const s = h('select', { class: 'num', title: 'Modelo' }, h('option', { value: '' }, '(modelo padrão)'), ...models.map((m) => h('option', { value: m }, m))) as HTMLSelectElement;
    s.value = b.model ?? '';
    s.addEventListener('change', () => onPick(s.value || undefined));
    return s;
  };
  const targets = o.route && o.mode !== 'profile' ? stepTargets(o.route) : [];
  const roleOfStep = (st: RouteStep) => ROLE_OF[st.kind]!;
  const roleValue = (r: StepRole) => {
    const ids = targets.filter((st) => roleOfStep(st) === r).map((st) => steps[st.id]);
    const first = ids[0];
    return first?.type === 'harness' && ids.every((b) => b?.type === 'harness' && b.harness === first.harness) ? first.harness : undefined;
  };
  const setRole = (r: StepRole, b: Binding | undefined) => {
    for (const st of targets.filter((x) => roleOfStep(x) === r)) { if (b) steps[st.id] = JSON.parse(JSON.stringify(b)); else delete steps[st.id]; }
  };
  const paintSteps = () => {
    if (!targets.length) { stepBox.replaceChildren(); return; }
    const eff = applyStepBindings(applyExecutorProfile(o.route!, Object.keys(chains).length ? { id: 'x', name: 'x', chains } : undefined), steps);
    const roles = ROLES.filter((r) => targets.some((st) => roleOfStep(st) === r));
    stepBox.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'muted grow' }, 'Escolha um harness por função (ou etapa por etapa) para dividir o trabalho e a cota entre eles. O que não for escolhido segue a categoria acima ou a rota; os executores da rota ficam como reserva.'),
        h('button', { class: 'small', id: 'pm-balance', title: 'Distribui planejamento, execução e revisão entre os harnesses instalados', onclick: () => {
          const inst = Object.entries(status).filter(([, v]) => v.installed).map(([k]) => k);
          const plan = balanceRoles(inst);
          if (!Object.keys(plan).length) { c.toast('Nenhum harness instalado para balancear.', true); return; }
          for (const r of roles) setRole(r, plan[r]);
          profileId = undefined; paint();
        } }, '⚖ Balancear'),
        Object.keys(steps).length ? h('button', { class: 'small', 'data-act': 'pm-steps-clear', onclick: () => { steps = {}; paint(); } }, '↺ Limpar') : null),
      h('div', { class: 'proles' }, ...roles.map((r) => h('label', { class: 'prole', 'data-role': r },
        h('span', {}, `${ROLE_INFO[r].icon} ${ROLE_INFO[r].label}`), h('span', { class: 'muted small' }, ROLE_INFO[r].hint),
        harnessSelect(roleValue(r), Object.keys(steps).some((id) => targets.find((t) => t.id === id && roleOfStep(t) === r)) ? '(misto: veja abaixo)' : '(como acima)', (id) => { setRole(r, id ? { type: 'harness', harness: id as never } : undefined); profileId = undefined; paint(); })))),
      h('details', { class: 'pstep-list', open: Object.keys(steps).length > 0 },
        h('summary', {}, `Etapa por etapa (${targets.length})`),
        ...targets.map((st) => {
          const mine = steps[st.id];
          const now = eff.steps.find((x) => x.id === st.id)?.bindings[0];
          const sel = harnessSelect(mine?.type === 'harness' ? mine.harness : undefined, `(como acima: ${now ? bindingArt(now).title : '—'})`, (id) => {
            if (id) steps[st.id] = { type: 'harness', harness: id as never }; else delete steps[st.id];
            profileId = undefined; paint();
          });
          const ms = mine?.type === 'harness' ? modelSelect(mine, (m) => { const b = steps[st.id] as Binding & { type: 'harness' }; if (m) b.model = m; else delete b.model; paintProfiles(); }) : null;
          return h('div', { class: 'row pstep', 'data-step': st.id }, h('span', { class: 'grow' }, `${ROLE_INFO[roleOfStep(st)].icon} ${st.label}`), sel, ms);
        })));
  };

  const profRow = h('div', { class: 'pprofiles', id: 'pm-profiles' });
  const catGrid = h('div', { class: 'pcats', id: 'pm-cats' });
  const paintProfiles = () => profRow.replaceChildren(
    h('button', { class: `pprof${!profileId && !Object.keys(chains).length ? ' sel' : ''}`, 'data-profile': '', onclick: () => { profileId = undefined; chains = {}; paint(); } },
      h('span', { class: 'picon big' }, '🧭'), h('strong', {}, 'Como a rota define'), h('span', { class: 'muted' }, 'Usa os executores gravados em cada tarefa da rota.')),
    ...profiles.map((p) => h('button', { class: `pprof${profileId === p.id ? ' sel' : ''}`, 'data-profile': p.id, onclick: () => { profileId = p.id; chains = JSON.parse(JSON.stringify(p.chains)); paint(); } },
      h('span', { class: 'picon big' }, artIcons(CATEGORIES.map((k) => p.chains[k]?.[0] ? bindingArt(p.chains[k]![0]!).icon : ''))),
      h('strong', {}, p.name, p.builtin ? '' : ' ★'), h('span', { class: 'muted' }, p.description ?? ''),
      h('span', { class: 'pchips' }, ...CATEGORIES.filter((k) => p.chains[k]?.length).map((k) => h('span', { class: 'chip', title: CATEGORY_INFO[k].label }, `${CATEGORY_INFO[k].icon} ${bindingArt(p.chains[k]![0]!).title}`))),
      p.builtin ? null : h('span', { class: 'pdel', title: 'Excluir este perfil', onclick: (e) => { e.stopPropagation(); void delProfile(p.id); } }, '🗑'))));
  const delProfile = async (id: string) => {
    if (!await askConfirm('Excluir este perfil de executores? Projetos já criados não mudam.')) return;
    const s = (await c.forge['getSettings']()) as Settings;
    s.executorProfiles = (s.executorProfiles ?? []).filter((p) => p.id !== id);
    await c.forge['setSettings'](s);
    profiles = profiles.filter((p) => p.id !== id); if (profileId === id) profileId = undefined; paint();
  };

  const paintCats = () => {
    const eff = effectiveByCategory(o.route, chains);
    catGrid.replaceChildren(...CATEGORIES.map((cat) => {
      const info = CATEGORY_INFO[cat];
      const e = eff[cat];
      const mine = chains[cat]?.[0];
      const used = o.route ? e.steps.length : 1;   // sem rota (editando um perfil): todas as categorias valem
      const shown = mine ?? e.binding;
      const card = h('div', { class: `pcat${open === cat ? ' open' : ''}${!used && !e.locked.length ? ' unused' : ''}`, 'data-cat': cat },
        h('div', { class: 'pcathead' }, h('span', { class: 'picon big' }, info.icon), h('div', { class: 'grow' }, h('strong', {}, info.label), h('div', { class: 'muted' }, info.hint)),
          h('button', { class: 'small', 'data-act': 'pm-change', onclick: () => { open = open === cat ? undefined : cat; paintCats(); } }, open === cat ? 'Fechar' : 'Trocar')),
        shown ? tile(shown, { status, small: true, selected: !!mine, label: mine ? bindingArt(shown).sub + ' · escolhido' : bindingArt(shown).sub + ' · da rota' }) : h('div', { class: 'muted' }, !o.route ? 'Como a rota define (clique em Trocar)' : used ? '—' : 'Esta rota não usa esta categoria.'),
        h('div', { class: 'muted pused' }, o.route && used ? `Entra em: ${e.steps.map((s) => s.label).join(', ')}` : '',
          e.locked.length ? h('div', {}, `🔒 Mantido pela rota: ${e.locked.map((s) => s.label).join(', ')}`) : null),
        (chains[cat]?.length ?? 0) > 1 ? h('div', { class: 'pchips' }, h('span', { class: 'muted' }, 'Reservas: '), ...chains[cat]!.slice(1).map((b) => h('span', { class: 'chip' }, artIcon(bindingArt(b).icon), ` ${bindingArt(b).sub}`))) : null);
      if (open === cat) {
        const opts = optionsFor(cat, catalog);
        const sel = chains[cat]?.[0];
        card.append(h('div', { class: 'ptiles' }, ...opts.map((b) => tile(b, { status, selected: !!sel && key(sel) === key(b), onClick: () => {
          const prevRest = (chains[cat] ?? []).filter((x) => key(x) !== key(b));
          chains[cat] = [JSON.parse(JSON.stringify(b)), ...prevRest.slice(0, 3)];
          profileId = undefined; paint();
        } }))));
        if (sel) {
          const d = detailFields(sel, cat, catalog, () => { profileId = undefined; paintProfiles(); }, c);
          card.append(h('div', { class: 'row' }, d, h('button', { class: 'small', 'data-act': 'pm-clear', onclick: () => { delete chains[cat]; profileId = undefined; paint(); } }, '↺ Voltar ao da rota')));
        }
      }
      return card;
    }));
  };
  const paint = () => { paintProfiles(); paintCats(); paintSteps(); };
  paint();

  const label = () => {
    const base = profileId ? (profiles.find((p) => p.id === profileId)?.name ?? profileId) : Object.keys(chains).length ? 'Personalizado (só neste projeto)' : 'Como a rota define';
    return Object.keys(steps).length ? `${base} + ${Object.keys(steps).length} etapa(s) com harness próprio` : base;
  };
  /* (Electron não implementa window.prompt: o nome do perfil é digitado no rodapé) */
  const editing = o.editProfile && !o.editProfile.builtin ? o.editProfile : undefined;
  const nameIn = h('input', { id: 'pm-profile-name', placeholder: o.mode === 'profile' ? 'Nome do perfil' : 'Nome do novo perfil (opcional)', value: editing?.name ?? '' }) as HTMLInputElement;
  const saveProfile = async () => {
    if (!Object.keys(chains).length) { c.toast('Escolha ao menos uma categoria.', true); return; }
    const name = nameIn.value.trim();
    if (!name) { c.toast('Digite o nome do perfil.', true); nameIn.focus(); return; }
    const s = (await c.forge['getSettings']()) as Settings;
    const description = CATEGORIES.filter((k) => chains[k]?.length).map((k) => `${CATEGORY_INFO[k].label}: ${bindingArt(chains[k]![0]!).title}`).join(' · ');
    let id = editing?.id ?? (name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'perfil');
    if (!editing) { let n = 2; const base = id; while ([...profiles, ...(s.executorProfiles ?? [])].some((p) => p.id === id)) id = `${base}-${n++}`; }
    const prof: ExecutorProfile = { id, name, description, chains };
    s.executorProfiles = editing ? (s.executorProfiles ?? []).map((p) => (p.id === id ? prof : p)) : [...(s.executorProfiles ?? []), prof];
    await c.forge['setSettings'](s);
    c.toast(`Perfil "${prof.name}" salvo`);
    o.onPick({ profileId: id, label: prof.name }); close();
  };
  const project = o.mode !== 'profile';
  const { close } = modalShell('providers-modal', project ? 'Provedores do projeto' : editing ? `Editar perfil "${editing.name}"` : 'Novo perfil de provedores',
    project ? 'Escolha quem executa cada parte do vídeo. A rota continua definindo O QUE fazer; aqui você define QUEM faz. Os executores da rota ficam como reserva automática.'
      : 'Monte o perfil categoria por categoria (ou comece por um perfil pronto). Ele aparece em Novo projeto → Provedores.',
    [h('h4', {}, project ? 'Perfis prontos' : 'Começar de'), profRow, h('h4', {}, 'Por categoria'), catGrid, ...(targets.length ? [h('h4', {}, '⚖ Por etapa (balanceamento)'), stepBox] : [])],
    project ? [
      nameIn,
      h('button', { id: 'pm-save-profile', title: 'Guardar estas escolhas como um perfil reutilizável', onclick: () => void saveProfile().catch((e) => c.toast((e as Error).message, true)) }, '★ Salvar como perfil…'),
      h('span', { class: 'sp' }),
      h('button', { onclick: () => close() }, 'Cancelar'),
      h('button', { class: 'primary', id: 'pm-apply', onclick: () => {
        const st = Object.keys(steps).length ? steps : undefined;
        if (!profileId && !Object.keys(chains).length && !st) o.onPick(undefined);
        else o.onPick(profileId ? { profileId, steps: st, label: label() } : { chains: Object.keys(chains).length ? chains : undefined, steps: st, label: label() });
        close();
      } }, 'Usar neste projeto'),
    ] : [nameIn, h('span', { class: 'sp' }), h('button', { onclick: () => close() }, 'Cancelar'),
      h('button', { class: 'primary', id: 'pm-save-profile', onclick: () => void saveProfile().catch((e) => c.toast((e as Error).message, true)) }, '💾 Salvar perfil')]);
  void settings;
}

/** Página "Provedores": galeria dos perfis (padrão e seus), criar, editar, duplicar e excluir. */
export async function renderProvidersPage(main: HTMLElement, c: PickerCtx, help: HTMLElement) {
  const meta = (await c.forge['meta']()) as { profiles?: ExecutorProfile[] };
  const profiles = meta.profiles ?? [];
  const status = await loadStatus(c);
  const again = () => void renderProvidersPage(main, c, help);
  const open = (edit?: ExecutorProfile, base?: ExecutorProfile) => void openProvidersModal(c, {
    mode: 'profile', editProfile: edit, current: base ? { chains: JSON.parse(JSON.stringify(base.chains)), label: base.name } : edit ? { chains: edit.chains, label: edit.name } : undefined, onPick: () => again(),
  });
  const del = async (p: ExecutorProfile) => {
    if (!await askConfirm(`Excluir o perfil "${p.name}"? Projetos já criados não mudam.`)) return;
    const s = (await c.forge['getSettings']()) as Settings;
    s.executorProfiles = (s.executorProfiles ?? []).filter((x) => x.id !== p.id);
    await c.forge['setSettings'](s); c.toast('Perfil excluído'); again();
  };
  const card = (p: ExecutorProfile) => h('div', { class: 'pprof card', 'data-profile': p.id },
    h('div', { class: 'row' }, h('span', { class: 'picon big' }, artIcons(CATEGORIES.map((k) => p.chains[k]?.[0] ? bindingArt(p.chains[k]![0]!).icon : ''))),
      h('strong', { class: 'grow' }, p.name), p.builtin ? h('span', { class: 'tag' }, '🔒 padrão') : h('span', { class: 'tag done' }, '★ meu')),
    h('span', { class: 'muted' }, p.description ?? ''),
    h('div', { class: 'pcatlist' }, ...CATEGORIES.map((k) => {
      const b = p.chains[k]?.[0];
      return h('div', { class: 'pcatrow' }, h('span', {}, `${CATEGORY_INFO[k].icon} ${CATEGORY_INFO[k].label}`),
        b ? tile(b, { status, small: true }) : h('span', { class: 'muted' }, 'como a rota define'));
    })),
    h('div', { class: 'row' },
      p.builtin ? null : h('button', { class: 'small primary', onclick: () => open(p) }, '✎ Editar'),
      h('button', { class: 'small', onclick: () => open(undefined, p) }, '⧉ Duplicar e editar'),
      p.builtin ? null : h('button', { class: 'small danger', onclick: () => void del(p) }, '🗑 Excluir')));
  main.replaceChildren(
    h('div', { class: 'row pagehead' }, h('h2', {}, '🎛️ Provedores'), h('span', { class: 'tag' }, 'perfis de executores'), help, h('span', { class: 'sp' }),
      h('button', { class: 'primary', id: 'prov-new', onclick: () => open() }, '＋ Novo perfil')),
    h('p', { class: 'muted' }, 'Um perfil diz QUEM executa cada parte do vídeo (texto, código, imagem, vídeo, voz, música). A skill (template) diz COMO o vídeo fica e a rota diz QUAIS etapas existem. Escolha o perfil em Novo projeto → 🎛 Provedores.'),
    h('div', { class: 'pgrid3' }, ...profiles.map(card)));
}

/** Janela para escolher o executor de UMA tarefa (editor de rotas). */
export async function openBindingPicker(c: PickerCtx, o: { step: RouteStep; current?: Binding; onPick: (b: Binding) => void }) {
  const catalog = (await c.forge['catalog']()) as Catalog;
  const status = await loadStatus(c);
  const cat = CATEGORY_OF[o.step.kind];
  let choice: Binding | undefined = o.current ? JSON.parse(JSON.stringify(o.current)) : undefined;
  const grid = h('div', { class: 'ptiles' });
  const detail = h('div', { class: 'row' });
  const opts: Binding[] = cat ? optionsFor(cat, catalog) : [];
  if (o.step.kind === 'stock_media') opts.push({ type: 'stock', sources: ['pexels', 'pixabay', 'wikipedia', 'openverse', 'nasa'], media: 'both' }, { type: 'stock', sources: ['wikipedia', 'nasa', 'archive', 'openverse', 'smithsonian'], media: 'both' }, { type: 'stock', sources: ['youtube'], media: 'video' });
  if (['transcribe', 'subtitles', 'edit', 'music'].includes(o.step.kind) || !cat) {
    for (const t of ['whisper', 'estimate-words', 'subtitles', 'assemble', 'clip-musical', 'lyric-song', 'lyric-words', 'library-music', 'frame-thumbnail'] as const) opts.push({ type: 'builtin', tool: t });
  }
  if (o.step.kind === 'thumbnail') opts.push({ type: 'builtin', tool: 'frame-thumbnail' });
  if (o.step.kind === 'sfx') opts.push({ type: 'builtin', tool: 'sfx-code' });
  const paint = () => {
    grid.replaceChildren(...opts.map((b) => tile(b, { status, selected: !!choice && key(choice) === key(b), onClick: () => { choice = JSON.parse(JSON.stringify(b)); paint(); } })));
    detail.replaceChildren(...(choice && cat ? [detailFields(choice, cat, catalog, () => {}, c)] : []).filter((x): x is HTMLElement => !!x));
  };
  paint();
  const info = cat ? CATEGORY_INFO[cat] : { icon: '🧰', label: 'Ferramenta', hint: 'Ferramentas internas do app' };
  const { close } = modalShell('binding-modal', `${info.icon} Executor da tarefa "${o.step.label}"`,
    `${info.hint}. Clique num cartão para escolher; para harness e API escolha também o modelo.`,
    [grid, detail],
    [h('span', { class: 'sp' }), h('button', { onclick: () => close() }, 'Cancelar'),
      h('button', { class: 'primary', id: 'bp-apply', onclick: () => { if (!choice) { c.toast('Escolha um executor.', true); return; } o.onPick(choice); close(); } }, 'Usar este executor')]);
}

/**
 * Editor → "Executores": troca harness, modelo e esforço das etapas da rota DESTE projeto.
 * Ex.: o Ollama local não deu um bom resultado nas cenas → passa "Cena por código" para o Antigravity
 * (o Ollama fica de reserva) e refaz só essa etapa e o que depende dela.
 */
export async function openProjectExecutorsModal(c: PickerCtx, o: { project: Project; onSave: (route: Route, redo: string[] | null) => Promise<void> }) {
  if (!o.project.route) { c.toast('Este projeto não tem rota.', true); return; }
  const catalog = (await c.forge['catalog']()) as Catalog;
  const status = await loadStatus(c);
  const orig = o.project.route;
  const route: Route = JSON.parse(JSON.stringify(orig));
  const hOpts = [{ id: 'auto', models: [] as string[] }, ...catalog.harnesses];
  const hName = (id: string) => (id === 'auto' ? 'auto (o melhor instalado)' : HARNESS_ART[id]?.name ?? id) + (id !== 'auto' && status[id] && !status[id]!.installed ? ' — não encontrado' : '');
  const steps = route.steps.filter((st) => st.enabled && st.bindings.length && !profileSkips(st));
  const origOf = (id: string) => orig.steps.find((x) => x.id === id)!;
  const changed = () => steps.filter((st) => JSON.stringify(st.bindings) !== JSON.stringify(origOf(st.id).bindings)).map((st) => st.id);
  const isText = (st: RouteStep) => { const cat = CATEGORY_OF[st.kind]; return cat === 'text' || cat === 'code'; };
  /* cenas com executor próprio (Regerar cena → executor desta vez) */
  const sceneOv = (id: string) => o.project.scenes.filter((sc) => sc.overrides?.[id]?.length).map((sc) => sc.index);
  const body = h('div', { class: 'psteps', id: 'px-steps' });
  const foot = h('div', { class: 'muted', id: 'px-summary' });
  const redoBtn = h('button', { class: 'primary', id: 'px-redo' }, '') as HTMLButtonElement;
  const saveBtn = h('button', { id: 'px-save' }, '💾 Salvar') as HTMLButtonElement;

  const row = (st: RouteStep): HTMLElement => {
    const head = st.bindings[0]!;
    const kids: Array<HTMLElement | null> = [];
    if (isText(st)) {
      const sel = h('select', { 'data-field': 'harness' }, ...(head.type !== 'harness' ? [h('option', { value: '' }, `${bindingArt(head).title} · ${bindingArt(head).sub}`)] : []),
        ...hOpts.map((x) => h('option', { value: x.id }, hName(x.id)))) as HTMLSelectElement;
      sel.value = head.type === 'harness' ? head.harness : '';
      sel.addEventListener('change', () => { if (sel.value) { setStepHead(st, { type: 'harness', harness: sel.value as never }); paint(); } });
      kids.push(sel);
      if (head.type === 'harness') {
        const models = [...new Set([...(hOpts.find((x) => x.id === head.harness)?.models ?? []), ...(head.model ? [head.model] : [])])];
        if (models.length) {
          const ms = h('select', { class: 'num', 'data-field': 'model', title: 'Modelo' }, h('option', { value: '' }, '(modelo padrão)'), ...models.map((m) => h('option', { value: m }, m))) as HTMLSelectElement;
          ms.value = head.model ?? '';
          ms.addEventListener('change', () => { if (ms.value) head.model = ms.value; else delete head.model; paint(); });
          kids.push(ms);
        }
        if (harnessOffersEffort(head.harness, head.model)) {
          const es = h('select', { class: 'num', 'data-field': 'effort', title: 'Esforço de raciocínio' }, ...EFFORT_OPTIONS.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
          es.value = head.effort ?? '';
          es.addEventListener('change', () => { if (es.value) head.effort = es.value as ReasoningEffort; else delete head.effort; paint(); });
          kids.push(es);
        }
      }
    } else {
      kids.push(tile(head, { status, small: true }));
    }
    kids.push(h('button', { class: 'small', title: 'Escolher qualquer executor (harness, API, ComfyUI…) em cartões', onclick: () => void openBindingPicker(c, { step: st, current: head, onPick: (b) => { setStepHead(st, b); paint(); } }) }, 'Trocar…'));
    const was = origOf(st.id).bindings[0]!;
    const dirty = JSON.stringify(st.bindings) !== JSON.stringify(origOf(st.id).bindings);
    const ov = sceneOv(st.id);
    return h('div', { class: `row pstep${dirty ? ' dirty' : ''}`, 'data-step': st.id },
      h('span', { class: 'grow' }, `${CATEGORY_OF[st.kind] ? CATEGORY_INFO[CATEGORY_OF[st.kind]!].icon : '🧰'} ${st.label}`,
        dirty ? h('span', { class: 'muted small' }, ` (era ${bindingArt(was).title}${was.type === 'harness' && was.model ? ` · ${was.model}` : ''})`) : null,
        st.bindings.length > 1 ? h('span', { class: 'muted small' }, ` · reservas: ${st.bindings.slice(1, 4).map((b) => bindingArt(b).title).join(', ')}`) : null,
        ov.length ? h('span', { class: 'muted small' }, ` · cenas ${ov.join(', ')} com executor próprio`) : null),
      ...kids);
  };

  const textSteps = steps.filter((st) => isText(st) && ROLE_OF[st.kind]);
  const roles = ROLES.filter((r) => textSteps.some((st) => ROLE_OF[st.kind] === r));
  const paint = () => {
    const ch = changed();
    const redo = ch.length ? downstreamSteps(route, ch) : [];
    const lbl = (id: string) => route.steps.find((x) => x.id === id)?.label ?? id;
    body.replaceChildren(
      roles.length ? h('div', { class: 'row' }, h('span', { class: 'muted grow' }, 'Por função (preenche as etapas do grupo) ou etapa por etapa abaixo. O executor anterior fica como reserva.'),
        h('button', { class: 'small', id: 'px-balance', title: 'Distribui planejamento, execução e revisão entre os harnesses instalados', onclick: () => {
          const plan = balanceRoles(Object.entries(status).filter(([, v]) => v.installed).map(([k]) => k));
          if (!Object.keys(plan).length) { c.toast('Nenhum harness instalado para balancear.', true); return; }
          for (const st of textSteps) { const b = plan[ROLE_OF[st.kind]!]; if (b && !(st.bindings[0]?.type === 'harness' && (st.bindings[0] as { harness: string }).harness === (b as { harness: string }).harness)) setStepHead(st, JSON.parse(JSON.stringify(b))); }
          paint();
        } }, '⚖ Balancear'),
        h('button', { class: 'small', id: 'px-reset', disabled: !ch.length, onclick: () => { for (const st of steps) st.bindings = JSON.parse(JSON.stringify(origOf(st.id).bindings)); paint(); } }, '↺ Desfazer')) : '',
      roles.length ? h('div', { class: 'proles' }, ...roles.map((r) => {
        const group = textSteps.filter((st) => ROLE_OF[st.kind] === r);
        const heads = group.map((st) => st.bindings[0]);
        const same = heads.every((b) => b?.type === 'harness' && heads[0]?.type === 'harness' && b.harness === heads[0].harness);
        const s = h('select', {}, h('option', { value: '' }, same ? '' : '(misto)'), ...hOpts.map((x) => h('option', { value: x.id }, hName(x.id)))) as HTMLSelectElement;
        s.value = same && heads[0]?.type === 'harness' ? heads[0].harness : '';
        s.addEventListener('change', () => { if (!s.value) return; for (const st of group) if (!(st.bindings[0]?.type === 'harness' && (st.bindings[0] as { harness: string }).harness === s.value)) setStepHead(st, { type: 'harness', harness: s.value as never }); paint(); });
        return h('label', { class: 'prole', 'data-role': r }, h('span', {}, `${ROLE_INFO[r].icon} ${ROLE_INFO[r].label}`), h('span', { class: 'muted small' }, group.map((st) => st.label).join(', ')), s);
      })) : '',
      ...steps.map(row));
    foot.replaceChildren(ch.length
      ? h('span', {}, `Alteradas: ${ch.map(lbl).join(', ')}. `, h('span', {}, `"Salvar e refazer" executa de novo (sem cache): ${redo.map(lbl).join(' → ')}.`))
      : h('span', {}, 'Nada alterado ainda. Etapas já concluídas só mudam se você refizer; as pendentes já usam a nova escolha ao Continuar.'));
    redoBtn.textContent = ch.length ? `💾 Salvar e refazer (${redo.length} etapa${redo.length > 1 ? 's' : ''})` : '💾 Salvar e refazer';
    redoBtn.disabled = !ch.length; saveBtn.disabled = !ch.length;
  };
  paint();
  const finish = async (redo: boolean) => {
    saveBtn.disabled = true; redoBtn.disabled = true;
    try { const ch = changed(); close(); await o.onSave(route, redo ? ch : null); }
    catch (e) { c.toast((e as Error).message, true); }
  };
  saveBtn.addEventListener('click', () => void finish(false));
  redoBtn.addEventListener('click', () => void finish(true));
  const { close } = modalShell('project-exec-modal', `🎛 Executores — ${o.project.name}`,
    'Troque o harness, o modelo e o esforço de cada etapa deste projeto (a rota da biblioteca não muda). Ex.: Ollama não deu bom resultado → passe a etapa para o Antigravity e refaça.',
    [body], [foot, h('span', { class: 'sp' }), h('button', { onclick: () => close() }, 'Cancelar'), saveBtn, redoBtn]);
}
