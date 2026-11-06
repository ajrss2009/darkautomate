import type { Agent, Attachment, Binding, CastMember, EngineEvent, ExecutorProfile, FxSegment, Project, Route, Scene, SceneKind, Settings, Skill, StockSource, ThumbnailTemplate } from '../shared/types';
import { KIND_LABEL as KIND_LABEL_NP } from './library-ui';
import { LANGUAGES, renderRoutesLib, renderSettings, renderSkills, openSkillFromVideos, type Ctx } from './library-ui';
import { artIcon, bindingArt, effectiveByCategory, fallbackChips, openProjectExecutorsModal, openProvidersModal, renderProvidersPage, type ProvidersChoice } from './providers-ui';
import { renderAutomations, type AutoCtx } from './automations-ui';
import { renderPluginsPage, type PluginsCtx } from './plugins-page';
import { renderVideosPage, type VideosCtx } from './videos-page';
import { renderChannelsPage, type ChannelsCtx } from './channels-page';
import { voicePicker, type NarrationVoice } from './voice-picker';
import { AGENT_TYPES, agentType } from './agents-ui';
import type { PluginStyle } from '../shared/types';
import { helpButton } from './carousel';
import { CATEGORIES, CATEGORY_INFO, applyExecutorProfile, applyStepBindings } from '../shared/profiles';
import { checkSkillRoute, routeHasTool } from '../shared/compat';
import { addSegLayer, layersOf, placeSeg, segAt, segEnd, segsAt, totalOf } from '../shared/fx';
import { renderAgents } from './agents-ui';
import { icon } from './icons';
import { startI18n, t } from './i18n';
import { askConfirm, showMessage } from './dialogs';

/* ───────── tipos da API exposta pelo preload ───────── */
interface ProjectRow {
  id: string; name: string; videoType: string; createdAt: string; scenes: number; hasFinal: boolean; running: boolean; totalMs?: number; firstFrame?: string | null; typeId?: string; language?: string;
  status?: 'running' | 'done' | 'failed' | 'partial' | 'new'; scenesWithMedia?: number; frameFromFinal?: boolean; runs?: number; lastRunAt?: string; lastRunOk?: boolean; updatedAt?: string;
  skillId?: string; skillName?: string; routeName?: string; aspect?: string; targetDurationSec?: number; dir?: string;
}
interface Forge {
  meta(): Promise<{ videoTypes: Array<{ id: string; label: string; defaultAspect: string; defaultDurationSec: number; sceneKind?: SceneKind }>; routes: Route[]; skills: Skill[]; agents: Agent[]; thumbnails: ThumbnailTemplate[]; voices: Array<{ name: string; path: string }>; profiles?: ExecutorProfile[]; sfxLibrary?: SfxItem[] }>;
  migrateLanguage(id: string, o: { language: string; visuals?: boolean; run?: boolean }): Promise<{ project: Project; run?: { ok: boolean; error?: string } }>;
  deriveProject(id: string, i: Record<string, unknown>): Promise<Project>;
  sfxPreview(name: string): Promise<string>;
  sfxApply(id: string, sceneIds: string[]): Promise<{ project: Project; result: Record<string, string> }>;
  sfxFit(id: string, sceneIds: string[], o: { names?: string[] }): Promise<{ project: Project; result: Record<string, string> }>;
  youtubeUpload(id: string, o?: { account?: string; visibility?: string }): Promise<{ url?: string }>;
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<boolean>;
  detectHarnesses(): Promise<Record<string, { installed: boolean; version?: string }>>;
  pingComfy(id: string, url?: string): Promise<{ ok: boolean; error?: string }>;
  wan2gpModels(): Promise<unknown>;
  wan2gpDefaults(m: string): Promise<unknown>;
  listProjects(): Promise<ProjectRow[]>;
  createProject(i: unknown): Promise<Project>;
  listFolds(): Promise<Array<{ id: string; name: string; angle?: string; skillId?: string }>>;
  getProject(id: string): Promise<Project>;
  updateProject(id: string, patch: unknown): Promise<Project>;
  deleteProjects(ids: string[]): Promise<boolean>;
  duplicateProject(id: string, name?: string): Promise<Project>;
  refreshProject(id: string): Promise<ProjectRow>;
  resume(id: string, only?: unknown): Promise<{ ok: boolean; error?: string }>;
  batchCreate(ideas: string[], base: unknown): Promise<Project[]>;
  saveRoute(id: string, r: Route): Promise<Project>;
  redoSteps(id: string, stepIds: string[]): Promise<{ ok: boolean; error?: string }>;
  projectMedia(id: string): Promise<{ final: string | null; subtitles: string | null; music: string | null }>;
  musicPick(id: string): Promise<string | null>;
  musicClear(id: string): Promise<boolean>;
  musicMoods(): Promise<Array<{ id: string; label: string }>>;
  musicCode(id: string, mood: string): Promise<string>;
  applyMusic(id: string): Promise<{ ok: boolean; error?: string; message?: string }>;
  attachPick(mode: 'files' | 'folder'): Promise<string[]>;
  attach(id: string, o: { mode?: 'files' | 'folder'; paths?: string[] }): Promise<Project>;
  detach(id: string, file: string): Promise<Project>;
  setAttachment(id: string, file: string, patch: { use?: Attachment['use']; note?: string; character?: string }): Promise<Project>;
  openFolder(id: string): Promise<string>;
  projectsRoot(): Promise<string>;
  openProjectsRoot(): Promise<string>;
  setProjectsDir(dir: string, move: boolean): Promise<{ dir: string; moved: number }>;
  listAgents(): Promise<Agent[]>;
  listPlugins(): Promise<Array<{ id: string; name: string; description?: string; skills?: string[]; commands?: string[]; agents?: string[] }>>;
  openFile(o?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  openDir(o?: { title?: string; defaultPath?: string }): Promise<string | null>;
  importMedia(src: string, kind: 'skill' | 'thumb'): Promise<string>;
  skillPreviews(): Promise<Record<string, string>>;
  setTheme(t: 'dark' | 'light'): Promise<string>;
  addScene(id: string, afterId: string | null, partial: unknown): Promise<{ project: Project; scene: Scene }>;
  updateScene(id: string, sceneId: string, patch: unknown, regenerate?: boolean): Promise<{ project: Project }>;
  deleteScenes(id: string, sceneIds: string[]): Promise<Project>;
  moveScene(id: string, sceneId: string, toIndex: number): Promise<Project>;
  duplicateScene(id: string, sceneId: string): Promise<Project>;
  trimScene(id: string, sceneId: string, o: { cutStart?: number; cutEnd?: number }): Promise<Project>;
  splitScene(id: string, sceneId: string, at: number): Promise<{ project: Project; scene: Scene }>;
  insertClip(id: string, where: { at: 'start' | 'end' } | { at: 'before' | 'after'; sceneId: string } | { at: 'time'; time: number }, file?: string): Promise<{ project: Project; scene: Scene } | null>;
  exportEditor(id: string, target: 'davinci' | 'capcut'): Promise<{ dir: string; main: string; notes: string[] }>;
  rewriteScenes(id: string, o: unknown): Promise<{ project: Project; result: { summary: string } }>;
  visualPrompt(id: string, o: unknown): Promise<{ project: Project }>;
  regenerate(id: string, o: unknown): Promise<{ project: Project }>;
  renderFinal(id: string): Promise<{ ok: boolean; error?: string }>;
  run(id: string, only?: unknown): Promise<{ ok: boolean; error?: string }>;
  cancel(id: string): Promise<boolean>;
  runBatch(ids: string[], concurrency?: number): Promise<Array<{ id: string; ok?: boolean; error?: string }>>;
  cancelBatch(): Promise<boolean>;
  mediaUrl(path: string): string;
  onEvent(cb: (e: EngineEvent & { projectId?: string }) => void): () => void;
}
const forge = (window as unknown as { forge: Forge }).forge;
interface SfxItem { id: string; label: string; icon: string; tags: string; dur: number }
let sfxLib: SfxItem[] = [];
const loadSfxLib = async () => { if (!sfxLib.length) sfxLib = (await forge.meta()).sfxLibrary ?? []; return sfxLib; };
void loadSfxLib().catch(() => { /* biblioteca de efeitos indisponível: a faixa mostra 🔊 */ });
/** Efeitos da cena como texto editável: "nome", "nome@2.5" ou "nome:palavra". */
const sceneSfx = (sc: Scene): string[] => [...(sc.sfx ?? []), ...(sc.sfxCues ?? []).map((c) => c.name + (c.word ? ':' + c.word : typeof c.at === 'number' ? '@' + c.at : ''))];

/* ───────── helpers de DOM ───────── */
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
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const main = document.getElementById('main')!;
const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

function toast(msg: string, bad = false) {
  const t = $('#toast') ?? document.body.appendChild(h('div', { id: 'toast' }));
  t.textContent = msg; t.className = bad ? 'bad show' : 'show';
  window.setTimeout(() => t.classList.remove('show'), bad ? 6000 : 2800);
}
async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch (e) { toast((e as Error).message, true); return undefined; }
}

/* ───────── estado ───────── */
let tab = 'projects';
let current: Project | undefined;
let selected: string[] = [];          // ids de cenas selecionadas (ordem de clique)
let anchor: string | undefined;
let pxPerSec = 48;
/** cursor da timeline (segundos do vídeo): onde "Dividir", "Cortar início/fim" e "Inserir no cursor" agem */
let cursorT = 0;
let projChecked = new Set<string>();
/* fila do lote: ids de projetos; persiste no localStorage */
const QKEY = 'filmforge.batchQueue';
let queue: string[] = (() => { try { const v = JSON.parse(localStorage.getItem(QKEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } })();
const queueStatus = new Map<string, { s: 'run' | 'ok' | 'fail'; err?: string }>();
let queueConc = 1;
let lastList: ProjectRow[] = [];
const saveQueue = () => { try { localStorage.setItem(QKEY, JSON.stringify(queue)); } catch { /* sem storage */ } };
function enqueue(ids: string[]) {
  let added = 0;
  for (const id of ids) if (!queue.includes(id)) { queue.push(id); queueStatus.delete(id); added++; }
  saveQueue(); toast(added ? `${added} projeto(s) no lote (${queue.length} na fila)` : 'Já estava no lote');
}
let busy = '';
let batchState: { total: number; done: number; failed: number; running: string[]; finished: boolean } | undefined;
let playToken = 0;
let media: { final: string | null; subtitles: string | null; music: string | null } = { final: null, subtitles: null, music: null };
let runProgress: { mode?: 'scenes' | 'deliverables'; done: number; total: number; etaMs: number; elapsedMs: number; label?: string } | null = null;
let progHide: number | undefined;
/** projetos executando agora (o evento run.start/run.done mantém isto) */
const runningIds = new Set<string>();
/** última pré-checagem (harness/modelo por etapa) */
let preflight: { projectId?: string; steps: Array<{ id: string; kind: string; label: string; binding: string; harness?: string; model?: string; ok?: boolean; note?: string }>; plugins?: string[] } | null = null;
/** plugin (e estilo) escolhido na aba Plugins para abrir o Novo projeto já marcado */
let pendingPlugin: { id: string; style?: string } | undefined;
/** ideia vinda de "Obter vídeos" (Criar vídeo inspirado) */
let pendingIdea: string | undefined;
/** skill a pré-selecionar no Novo projeto (ex.: canal clonado) */
let pendingSkill: string | undefined;
/** dobra de nicho escolhida (id em library/folds) para o próximo projeto */
let pendingFold: string | undefined;
/** dobra escolhida no formulário do Novo projeto (chip abaixo da skill) */
let formFold: { id: string; name: string; angle?: string } | undefined;
/** plugins instalados (carregados ao abrir o editor) */
let pluginCache: Array<{ id: string; name: string; description?: string; styles?: PluginStyle[] }> = [];
/** rotas da biblioteca (para avisar quando a rota congelada do projeto está desatualizada) */
let routeCache: Route[] = [];
const logLines: Array<{ cls: string; text: string; file?: string }> = [];
const MEDIA_RE = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|m4a|ogg|flac)$/i;
const TEXT_RE = /\.(md|json|srt|html|txt)$/i;
/** Prévia de um arquivo gerado: imagem, vídeo, áudio ou trecho de texto. `full=false` mostra só um chip (entradas antigas). */
function previewNode(file: string, full = true): HTMLElement {
  const url = forge.mediaUrl(file) + '?t=' + Date.now();
  const name = basename(file);
  const chip = h('span', { class: 'tag pvname', title: file }, '🗎 ' + name);
  if (!full) return h('div', { class: 'l-file' }, chip);
  let body: HTMLElement | null = null;
  if (/\.(png|jpe?g|webp|gif)$/i.test(file)) body = h('img', { class: 'pv', src: url, alt: name });
  else if (/\.(mp4|webm|mov)$/i.test(file)) body = h('video', { class: 'pv', src: url, controls: true, muted: true, preload: 'metadata' });
  else if (/\.(mp3|wav|m4a|ogg|flac)$/i.test(file)) body = h('audio', { controls: true, src: url, preload: 'metadata' });
  else if (TEXT_RE.test(file)) {
    const pre = h('pre', { class: 'pvtext' }, 'carregando…');
    void fetch(url).then((r) => r.text()).then((t) => { pre.textContent = t.slice(0, 1200) + (t.length > 1200 ? '\n…' : ''); }).catch(() => { pre.textContent = '(sem prévia)'; });
    body = h('details', {}, h('summary', {}, 'ver conteúdo'), pre);
  }
  return h('div', { class: 'l-file' }, chip, body);
}
const logNode = (l: { cls: string; text: string; file?: string }, full = true) => l.file ? previewNode(l.file, full) : h('div', { class: l.cls }, l.text);
const recentPreview = new Map<string, number>();
function pushPreview(file: string) {
  const now = Date.now();
  if (now - (recentPreview.get(file) ?? 0) < 2500) return;
  recentPreview.set(file, now);
  if (recentPreview.size > 400) recentPreview.clear();
  pushLog('l-file', file, file);
}

const go = (t: string) => document.querySelector<HTMLElement>(`#nav [data-tab="${t}"]`)?.click();
document.getElementById('nav')!.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset['tab'];
  if (!t) return;
  tab = t; playToken++;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === t));
  void render();
});

/* ───────── menu com ícones e tema claro/escuro ───────── */
document.querySelectorAll<HTMLButtonElement>('#nav button').forEach((b) => { const t = b.dataset['tab']; if (t) b.prepend(icon(t)); });
let theme: 'dark' | 'light' = 'dark';
try { const v = localStorage.getItem('filmforge.theme'); if (v === 'light' || v === 'dark') theme = v; } catch { /* sem storage */ }
function applyTheme(t: 'dark' | 'light') {
  theme = t; document.documentElement.dataset['theme'] = t;
  const b = document.getElementById('theme-toggle');
  if (b) { b.replaceChildren(icon(t === 'dark' ? 'sun' : 'moon'), t === 'dark' ? 'Tema claro' : 'Tema escuro'); b.title = t === 'dark' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'; }
  try { localStorage.setItem('filmforge.theme', t); } catch { /* sem storage */ }
}
applyTheme(theme);
void forge.getSettings().then((s) => { if (s.theme && s.theme !== theme) applyTheme(s.theme); startI18n(s.uiLanguage); }).catch(() => {});
document.getElementById('theme-toggle')?.addEventListener('click', () => { applyTheme(theme === 'dark' ? 'light' : 'dark'); void forge.setTheme(theme); });
/* idioma escolhido em Configurações → Aplicação */
window.addEventListener('ff:lang', (e) => { startI18n((e as CustomEvent).detail as 'pt-BR' | 'en' | 'es'); void render(); });

/* ───────── eventos do motor ───────── */
let logProject = '';
/** Ao abrir um projeto, traz o log salvo no project.json (da última execução). */
function hydrateLog(p?: Project) {
  if (!p || p.id === logProject) return;
  logProject = p.id;
  logLines.length = 0;
  for (const line of p.log ?? []) {
    const cls = /✗|falhou/.test(line) ? 'l-bad' : /✓|concluído/.test(line) ? 'l-ok' : 'muted';
    logLines.push({ cls, text: line });
  }
}
function pushLog(cls: string, text: string, file?: string) {
  logLines.push({ cls, text, file });
  if (logLines.length > 2000) logLines.shift();
  const box = $('#log');
  if (box) {
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60;   // só acompanha se o usuário está no fim
    box.append(logNode(logLines[logLines.length - 1]!));
    if (stick) box.scrollTop = box.scrollHeight;
  }
}
let refreshTimer: number | undefined;
function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(async () => {
    if (!current) return;
    const p = await guard(() => forge.getProject(current!.id)); if (!p) return;
    current = p; media = (await guard(() => forge.projectMedia(p.id))) ?? media;
    if (tab === 'editor') renderEditor(true);
  }, 350);
}
forge.onEvent((e) => {
  const multi = !!batchState && !batchState.finished && batchState.running.length > 1;
  const where = (x: { stepId?: string; sceneId?: string }) => `${multi && e.projectId ? e.projectId.slice(0, 16) + ' · ' : ''}${x.sceneId ? x.sceneId + ' · ' : ''}${x.stepId ?? ''}`;
  switch (e.t) {
    case 'run.start': runningIds.add(e.projectId ?? ''); logLines.length = 0; logProject = e.projectId ?? ''; pushLog('muted', `▶ ${e.projectId}`); break;
    case 'step.start': pushLog('', `${where(e)} → ${e.binding}`); break;
    case 'step.attempt': if (e.attempt > 1) pushLog('muted', `${where(e)} tentativa ${e.attempt}`); break;
    case 'step.cache_hit': pushLog('l-ok', `${where(e)} ✓ cache`); break;
    case 'step.fallback': pushLog('l-fb', `${where(e)} ⤵ fallback: ${e.from} → ${e.to} (${e.reason})`); break;
    case 'step.done': pushLog('l-ok', `${where(e)} ✓ ${e.binding}`); for (const f of e.files ?? []) if (MEDIA_RE.test(f)) pushPreview(f); break;
    case 'step.failed': pushLog('l-bad', `${where(e)} ✗ ${e.reason}`); break;
    case 'step.skipped': pushLog('muted', `${where(e)} pulado: ${e.reason}`); break;
    case 'gate.waiting': pushLog('l-fb', `${where(e)} aguardando aprovação`); break;
    case 'log': if (e.line.startsWith('@file:')) pushPreview(e.line.slice(6)); else pushLog(e.line.startsWith('[stderr]') ? 'l-fb' : 'muted', `${where(e)} ${e.line}`); break;
    case 'run.progress':
      runProgress = { mode: e.mode, done: e.done, total: e.total, etaMs: e.etaMs, elapsedMs: e.elapsedMs, label: e.label };
      window.clearTimeout(progHide);
      paintProgress();
      if (e.done >= e.total) progHide = window.setTimeout(() => { runProgress = null; paintProgress(); }, 8000);
      break;
    case 'run.preflight':
      preflight = { projectId: e.projectId, steps: e.steps, plugins: e.plugins };
      pushLog('muted', `pré-checagem: ${e.steps.length} etapa(s)${e.plugins?.length ? ` · plugins: ${e.plugins.join(', ')}` : ''}`);
      for (const st of e.steps) if (st.harness) pushLog('muted', `${st.id} → ${st.harness}${st.model ? '/' + st.model : ''}${st.ok === false ? ' ⚠' : ''}`);
      {
        const bad = e.steps.filter((s) => s.ok === false);
        if (bad.length) toast(`Provedor indisponível em ${bad.length} etapa(s): ${bad[0]!.id} — ${bad[0]!.note ?? 'não encontrado'}`, true);
      }
      // mostra na hora (o card/log não esperam a próxima troca de aba)
      if (tab === 'run') renderRun();
      else if (tab === 'editor') renderEditor(true);
      break;
    case 'run.done':
      runningIds.delete(e.projectId ?? '');
      pushLog(e.ok ? 'l-ok' : 'l-bad', e.ok ? '■ concluído' : `■ falhou: ${e.error}`);
      if (runProgress) { runProgress = { ...runProgress, done: runProgress.total, etaMs: 0 }; paintProgress(); progHide = window.setTimeout(() => { runProgress = null; paintProgress(); }, 8000); }
      break;
    case 'batch.update': batchState = e; for (const id of e.running) queueStatus.set(id, { s: 'run' }); if (tab === 'batch') { updateBatchBar(); refreshQueue(); } if (e.finished) { toast(`Lote concluído: ${e.done - e.failed} ok, ${e.failed} com erro`, e.failed > 0); if (tab === 'projects' || tab === 'batch') void render(); } break;
  }
  if (current && e.projectId === current.id && (e.t === 'step.done' || e.t === 'step.cache_hit' || e.t === 'run.done' || e.t === 'step.failed')) scheduleRefresh();
  if (e.t === 'step.start') runStep = `${(e as { stepId?: string }).stepId ?? ''}${(e as { sceneId?: string }).sceneId ? ' · ' + (e as { sceneId?: string }).sceneId : ''}`;
  if (e.t === 'run.start' || e.t === 'run.done' || e.t === 'step.start' || e.t === 'batch.update') paintRunIndicator();
  /* prévia de plugin pronta (gerada em segundo plano depois da instalação) */
  if ((e as { t: string }).t === 'plugins.changed') { pluginCache = []; if (tab === 'plugins') void render(); }
  /* clonagem de canal: indicador global (visível em qualquer tela) */
  if ((e as { t: string }).t === 'clone.progress') paintCloneIndicator(e as unknown as CloneState);
});

/* ───────── indicador global da clonagem de canal ───────── */
interface CloneState { running: boolean; name?: string; stage: string; pct: number; label: string; startedAt?: string; error?: string }
const CLONE_STAGES: Array<[string, string]> = [['list', 'Listar vídeos'], ['thumbs', 'Thumbnails'], ['videos', 'Vídeos: quadros, cortes, fala'], ['ai', 'DNA pela IA'], ['save', 'Skill, rota e dobras'], ['render', 'Banner, thumb e demo'], ['done', 'Pronto']];
let cloneHide: number | undefined;
function paintCloneIndicator(st: CloneState | null | undefined) {
  let el = document.getElementById('clone-indicator');
  if (!st) { el?.remove(); return; }
  if (!el) { el = h('div', { id: 'clone-indicator', class: 'clone-ind', title: 'Clonagem de canal — clique para ver os canais clonados', onclick: () => { go('videos'); } }); document.body.append(el); }
  window.clearTimeout(cloneHide);
  const idx = CLONE_STAGES.findIndex(([k]) => k === st.stage);
  const done = !st.running && !st.error && st.stage === 'done';
  const mins = st.startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(st.startedAt)) / 60000)) : 0;
  el.className = `clone-ind${st.error ? ' err' : done ? ' ok' : ' run'}`;
  el.replaceChildren(
    h('div', { class: 'row' }, h('span', { class: 'clone-ind-ic' }, st.error ? '⛔' : done ? '✅' : '🧬'),
      h('strong', { class: 'grow' }, st.error ? `Clonagem falhou: ${st.name ?? ''}` : done ? `Canal clonado: ${st.name ?? ''}` : `Clonando ${st.name ?? ''}`),
      h('span', { class: 'muted small' }, st.error ? '' : `${st.pct}%${mins ? ` · ${mins} min` : ''}`),
      h('button', { class: 'x', title: 'Esconder', onclick: (ev) => { ev.stopPropagation(); el!.remove(); } }, '×')),
    h('div', { class: 'clone-ind-bar' }, h('span', { style: `width:${st.error ? 100 : st.pct}%` })),
    h('div', { class: 'muted small' }, st.error ?? st.label),
    h('div', { class: 'clone-ind-steps' }, ...CLONE_STAGES.slice(0, -1).map(([k, label], i) => h('span', { class: `clone-st${i < idx || done ? ' ok' : i === idx && !st.error ? ' now' : ''}` }, label))));
  if (done || st.error) cloneHide = window.setTimeout(() => document.getElementById('clone-indicator')?.remove(), done ? 15000 : 30000);
}
/* janela recarregada no meio de uma clonagem: o indicador volta */
void (async () => { try { const st = (await (forge as unknown as { channelStatus: () => Promise<CloneState | null> }).channelStatus()); if (st?.running) paintCloneIndicator(st); } catch { /* ignora */ } })();

/* ───────── faixa de execução no topo (visível em qualquer tela) ─────────
 * Vem do processo principal (runs.active): execuções desta janela e de outros processos (linha de comando). */
interface ActiveRun { id: string; name: string; pid: number; step?: string; done?: number; total?: number; etaMs?: number; elapsedMs?: number; startedAt: string; headless?: boolean; external?: boolean }
let activeRuns: ActiveRun[] = [];
const runPct = (r: ActiveRun) => (r.total ? Math.round(Math.min(1, (r.done ?? 0) / r.total) * 100) : -1);
function paintRunBanner() {
  const bar = document.getElementById('titlebar'); if (!bar) return;
  document.body.classList.toggle('is-running', activeRuns.length > 0);
  let el = document.getElementById('run-banner');
  if (!activeRuns.length) { el?.remove(); return; }
  if (!el) { el = h('div', { id: 'run-banner' }); bar.append(el); }
  const r = activeRuns[0]!, pct = runPct(r);
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(r.startedAt)) / 60000));
  const info = [r.step ? `etapa ${r.step}` : 'preparando…', pct >= 0 ? `${pct}%` : '', r.etaMs && r.etaMs > 0 ? `~${fmtMs(r.etaMs)} restantes` : '', mins ? `${mins} min` : '', r.external ? 'fora desta janela' : '']
    .filter(Boolean).join(' · ');
  el.replaceChildren(
    h('span', { class: 'rb-dot' }), h('span', { class: 'rb-spin' }),
    h('strong', { class: 'rb-name', title: r.id }, `${t('Executando')}: ${r.name}`),
    ...(activeRuns.length > 1 ? [h('span', { class: 'rb-more', title: activeRuns.slice(1).map((x) => x.name).join('\n') }, `+${activeRuns.length - 1}`)] : []),
    h('span', { class: 'rb-info' }, info),
    h('span', { class: `rb-bar${pct < 0 ? ' ind' : ''}` }, h('span', { style: pct >= 0 ? `width:${Math.max(3, pct)}%` : '' })),
    h('button', { class: 'rb-btn', title: 'Abrir o projeto no editor', onclick: () => void guard(async () => { current = await forge.getProject(r.id); media = await forge.projectMedia(r.id); go('editor'); }) }, 'Abrir'),
    ...(!r.external ? [h('button', { class: 'rb-btn stop', title: 'Parar agora — o que já foi gerado fica salvo', onclick: () => void guard(async () => { await forge.cancel(r.id); toast('Parando… o que já foi gerado fica salvo'); }) }, '⏹ Parar')] : []));
  /* selo nos projetos em execução (lista de projetos) */
  document.querySelectorAll('tr[data-row]').forEach((tr) => tr.classList.toggle('row-running', activeRuns.some((x) => x.id === (tr as HTMLElement).dataset['row'])));
}
forge.onEvent((e) => { if ((e as { t: string }).t === 'runs.active') { activeRuns = (e as unknown as { runs: ActiveRun[] }).runs ?? []; paintRunBanner(); } });

/* ───────── indicador animado de execução no menu lateral ───────── */
let runStep = '';
function paintRunIndicator() {
  const n = runningIds.size + (batchState && !batchState.finished ? batchState.running.filter((id) => !runningIds.has(id)).length : 0);
  const on = n > 0;
  for (const t of ['run', 'projects', 'batch']) document.querySelector(`#nav button[data-tab="${t}"]`)?.classList.toggle('is-running', on && (t === 'run' || (t === 'batch' && !!batchState && !batchState.finished)));
  const box = document.getElementById('run-indicator');
  if (!box) return;
  box.classList.toggle('on', on);
  const txt = box.querySelector('.ri-txt');
  if (txt) txt.textContent = on ? `${t('Executando')} ${n > 1 ? `${n} ${t('projetos')}` : ''}${runStep ? ` · ${runStep}` : ''}` : '';
  if (!on) runStep = '';
}
document.getElementById('run-indicator')?.addEventListener('click', () => go('run'));

/* ───────── seleção de mídia por cena ───────── */
const files = (sc: Scene) => Object.values(sc.artifacts).flat();
const byName = (sc: Scene, n: string) => files(sc).find((f) => basename(f) === n);
function pickVisual(sc: Scene): { path: string; video: boolean } | undefined {
  const order: Record<SceneKind, string[]> = {
    image: ['frame.png', 'clip.mp4', 'code.mp4', 'motion.mp4'], video: ['clip.mp4', 'frame.png', 'code.mp4', 'motion.mp4'],
    code: ['code.mp4', 'clip.mp4', 'frame.png', 'motion.mp4'], motion: ['motion.mp4', 'code.mp4', 'clip.mp4', 'frame.png'],
    mixed: ['clip.mp4', 'code.mp4', 'motion.mp4', 'frame.png'], stock: ['clip.mp4', 'frame.png', 'code.mp4', 'motion.mp4'],
  };
  for (const n of order[sc.kind]) { const f = byName(sc, n); if (f) return { path: f, video: n.endsWith('.mp4') }; }
  // fallback: mídia com outro nome (workflows/APIs que não seguem o padrão da etapa)
  const all = files(sc);
  const v = all.find((f) => /\.(mp4|webm|mov)$/i.test(f) && !/thumb|sheet/i.test(f));
  if (v) return { path: v, video: true };
  const i = all.find((f) => /\.(png|jpe?g|webp|gif)$/i.test(f) && !/thumb|sheet|frame_\d/i.test(f));
  return i ? { path: i, video: false } : undefined;
}
const pickAudio = (sc: Scene) => files(sc).find((f) => /narration\.(mp3|wav|m4a|ogg|flac)$/i.test(f));
const dur = (sc: Scene) => Math.max(0.5, sc.durationSec ?? 4);
const sceneSteps = (p: Project) => (p.route?.steps ?? []).filter((s) => s.scope === 'scene' && s.enabled);

/* ───────── aba Projetos ───────── */
/* ───────── helpers das abas Projetos / Novo / Lote ───────── */
function fmtMs(ms: number): string {
  const sec = Math.round(ms / 1000), hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return hh ? `${hh}h ${String(mm).padStart(2, '0')}m` : mm ? `${mm}m ${String(ss).padStart(2, '0')}s` : `${ss}s`;
}
const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const STATUS: Record<string, [string, string]> = { running: ['executando', 'running'], done: ['concluído', 'done'], failed: ['falhou', 'failed'], partial: ['incompleto', 'running'], new: ['novo', ''] };
const statusTag = (p: ProjectRow) => { const [l, c] = STATUS[p.status ?? 'new'] ?? ['—', '']; return h('span', { class: `tag ${c}`, 'data-status': p.status ?? 'new' }, l); };
const frameCell = (p: ProjectRow) => p.firstFrame
  ? h('div', { class: 'ffwrap' }, h('img', { class: 'ff', src: forge.mediaUrl(p.firstFrame) + '?t=' + Date.now(), alt: 'frame' }),
    p.frameFromFinal ? null : h('span', { class: 'ffbadge', title: 'Vídeo ainda incompleto: frame de uma cena gerada' }, 'parcial'))
  : h('div', { class: 'ff empty' }, '—');

function updateBatchBar() {
  const bar = $('#batchbar'); if (!bar) return;
  if (!batchState) { bar.textContent = ''; return; }
  const b = batchState;
  bar.textContent = b.finished ? `Lote finalizado: ${b.done}/${b.total} (${b.failed} erro/s)`
    : `Lote: ${b.done}/${b.total} concluídos · em execução: ${b.running.join(', ') || '—'}${b.failed ? ` · ${b.failed} erro/s` : ''}`;
}
const batchRunning = () => !!batchState && !batchState.finished;

/** Exclui projetos da pasta de projetos, sempre pedindo confirmação. */
async function deleteWithConfirm(rows: ProjectRow[]): Promise<boolean> {
  if (!rows.length) return false;
  const names = rows.slice(0, 6).map((p) => `• ${p.name}`).join('\n') + (rows.length > 6 ? `\n… e mais ${rows.length - 6}` : '');
  if (!await askConfirm(`Excluir ${rows.length} projeto(s) da pasta de projetos?\n\n${names}\n\nTodos os arquivos gerados (roteiro, cenas, vídeo final) serão apagados do disco. Não há como desfazer.`)) return false;
  await forge.deleteProjects(rows.map((p) => p.id));
  const gone = new Set(rows.map((p) => p.id));
  gone.forEach((id) => { projChecked.delete(id); queueStatus.delete(id); });
  queue = queue.filter((id) => !gone.has(id)); saveQueue();
  if (current && gone.has(current.id)) current = undefined;
  return true;
}

function runProject(id: string, name: string) {
  void guard(async () => {
    current = await forge.getProject(id);
    toast(`Executando "${name}"…`); go('run');
    void forge.run(id).then((r) => { toast(r.ok ? `"${name}" concluído` : `"${name}" falhou: ${r.error ?? ''}`, !r.ok); if (tab === 'projects' || tab === 'batch') void render(); })
      .catch((e) => toast((e as Error).message, true));
  });
}

/** Continua uma execução parada/falha: o cache do motor pula o que já foi feito. */
function resumeProject(id: string, name: string) {
  void guard(async () => {
    current = await forge.getProject(id);
    toast(`Continuando "${name}"…`); go('run');
    void forge.resume(id).then((r) => { toast(r.ok ? `"${name}" concluído` : `"${name}" falhou: ${r.error ?? ''}`, !r.ok); if (tab === 'projects' || tab === 'batch') void render(); })
      .catch((e) => toast((e as Error).message, true));
  });
}

/* ───────── aba Projetos (lista) ───────── */
let projFilter = { q: '', st: '' };
async function renderProjects() {
  const list = (await guard(() => forge.listProjects())) ?? [];
  lastList = list;
  const root = (await guard(() => forge.projectsRoot())) ?? '';
  const rows = list.filter((p) => (!projFilter.q || p.name.toLowerCase().includes(projFilter.q.toLowerCase())) && (!projFilter.st || p.status === projFilter.st));
  const checked = () => list.filter((p) => projChecked.has(p.id));
  const q = h('input', { id: 'pf-q', placeholder: 'Buscar por nome…', value: projFilter.q }) as HTMLInputElement;
  q.addEventListener('change', () => { projFilter.q = q.value; void renderProjects(); });
  const st = h('select', { id: 'pf-st' }, ...[['', 'Todos os status'], ['done', 'Concluídos'], ['partial', 'Incompletos'], ['failed', 'Com falha'], ['running', 'Executando'], ['new', 'Novos']].map(([v, l]) => h('option', { value: v! }, l))) as HTMLSelectElement;
  st.value = projFilter.st; st.addEventListener('change', () => { projFilter.st = st.value; void renderProjects(); });

  const all = h('input', { type: 'checkbox', id: 'chk-all' });
  all.addEventListener('change', () => { rows.forEach((p) => (all.checked ? projChecked.add(p.id) : projChecked.delete(p.id))); void renderProjects(); });

  const trs = rows.map((p) => {
    const cb = h('input', { type: 'checkbox', 'data-id': p.id }); cb.checked = projChecked.has(p.id);
    cb.addEventListener('change', () => { cb.checked ? projChecked.add(p.id) : projChecked.delete(p.id); });
    const inQ = queue.includes(p.id);
    const live = activeRuns.find((x) => x.id === p.id);
    return h('tr', { 'data-row': p.id, class: live ? 'row-running' : '' },
      h('td', {}, cb),
      h('td', {}, frameCell(p)),
      h('td', {}, h('strong', {}, p.name), h('span', { class: 'run-badge', title: live?.step ? `etapa ${live.step}` : '' }, '● executando'), h('div', { class: 'muted' }, [p.skillName ?? p.videoType, p.routeName].filter(Boolean).join(' · ')),
        h('div', { class: 'muted pdir', title: p.dir ?? '' }, p.id)),
      h('td', {}, statusTag(p), h('div', { class: 'muted' }, p.scenes ? `${p.scenesWithMedia ?? 0}/${p.scenes} cenas com mídia` : 'sem cenas'),
        p.status === 'failed' ? h('div', { class: 'muted' }, 'última execução falhou') : null),
      h('td', { class: 'muted' }, h('div', {}, 'criado ' + fmtDate(p.createdAt)), h('div', {}, p.lastRunAt ? 'última exec. ' + fmtDate(p.lastRunAt) : 'nunca executado')),
      h('td', { class: 'prodtime' }, p.totalMs ? fmtMs(p.totalMs) : h('span', { class: 'muted' }, '—'), h('div', { class: 'muted' }, p.runs ? `${p.runs} execução(ões)` : '')),
      h('td', { class: 'muted' }, `${p.aspect ?? ''} ${p.targetDurationSec ? '· ' + p.targetDurationSec + 's' : ''}`),
      h('td', {}, h('div', { class: 'acts' },
        h('button', { class: 'open', title: 'Abrir no editor', onclick: () => void guard(async () => { current = await forge.getProject(p.id); selected = []; go('editor'); }) }, '✎ Editar'),
        p.running
          ? h('button', { class: 'run', title: 'Parar a execução (o que já foi gerado fica salvo)', onclick: () => void guard(async () => { await forge.cancel(p.id); toast(`Parando "${p.name}"…`); window.setTimeout(() => void renderProjects(), 1500); }) }, '⏹ Parar')
          : h('button', { class: 'run primary', title: 'Executar a rota deste projeto', onclick: () => runProject(p.id, p.name) }, '▶ Executar'),
        !p.running && (p.status === 'partial' || p.status === 'failed')
          ? h('button', { class: 'resume', title: 'Continuar de onde parou (o que já foi gerado está em cache)', onclick: () => resumeProject(p.id, p.name) }, '⏵ Continuar')
          : null,
        h('button', { class: 'ref', title: 'Atualizar este projeto (relê do disco e refaz a miniatura)', onclick: () => void guard(async () => { await forge.refreshProject(p.id); toast(`"${p.name}" atualizado`); await renderProjects(); }) }, '↻ Atualizar'),
        h('button', { class: 'q-add', onclick: () => { if (inQ) { queue = queue.filter((x) => x !== p.id); queueStatus.delete(p.id); saveQueue(); } else enqueue([p.id]); void renderProjects(); } }, inQ ? '✓ No lote' : '＋ Lote'),
        h('button', { class: 'dup', onclick: () => void guard(async () => { await forge.duplicateProject(p.id); void renderProjects(); }) }, 'Duplicar'),
        h('button', { class: 'derive', title: 'Criar um NOVO projeto a partir deste trocando estilo/skill, rota, formato, idioma ou duração (o original não muda)', disabled: !!p.running, onclick: () => void openDeriveDialog(p) }, '🔀 Variação'),
        h('button', { class: 'lang-mig', title: 'Criar uma cópia em outro idioma: traduz o roteiro e refaz narração, legendas e cenas com texto', disabled: !!p.running, onclick: () => openMigrateDialog(p) }, '🌐 Idioma'),
        h('button', { class: 'ren', onclick: () => void guard(async () => { const n = prompt('Novo nome:', p.name); if (n && n.trim()) { await forge.updateProject(p.id, { name: n.trim() }); void renderProjects(); } }) }, 'Renomear'),
        h('button', { class: 'fold', title: 'Abrir a pasta do projeto', onclick: () => void forge.openFolder(p.id) }, 'Pasta'),
        h('button', { class: 'danger del', disabled: p.running, onclick: () => void guard(async () => { if (await deleteWithConfirm([p])) void renderProjects(); }) }, 'Excluir'))));
  });

  main.replaceChildren(
    h('h2', {}, 'Projetos'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Salvos em:'), h('code', { id: 'proj-root' }, root),
      h('button', { id: 'open-root', onclick: () => void forge.openProjectsRoot() }, 'Abrir pasta'),
      h('button', { id: 'change-root', title: 'Configurações → Pastas', onclick: () => go('settings') }, 'Alterar local…'),
      h('button', { class: 'primary', id: 'go-new', onclick: () => go('new') }, '＋ Novo projeto')),
    h('div', { class: 'row' }, q, st,
      h('button', { id: 'b-addsel', onclick: () => { const ids = checked().map((p) => p.id); if (!ids.length) { toast('Selecione projetos na tabela.', true); return; } enqueue(ids); void renderProjects(); } }, '＋ Selecionados ao lote'),
      h('button', { class: 'danger', id: 'b-del', onclick: () => void guard(async () => { const sel = checked(); if (!sel.length) throw new Error('Selecione projetos.'); if (await deleteWithConfirm(sel)) void renderProjects(); }) }, 'Excluir selecionados')),
    list.length === 0 ? h('p', { class: 'muted' }, 'Nenhum projeto ainda. Use "＋ Novo projeto".') :
      rows.length === 0 ? h('p', { class: 'muted' }, 'Nenhum projeto com este filtro.') :
        h('table', { id: 'ptable' }, h('thead', {}, h('tr', {}, h('th', {}, all), h('th', {}, 'Frame'), h('th', {}, 'Projeto'), h('th', {}, 'Status'), h('th', {}, 'Datas'), h('th', {}, 'Tempo de geração'), h('th', {}, 'Formato'), h('th', {}, 'Ações'))), h('tbody', {}, ...trs)));
}

/* ───────── aba Novo projeto ───────── */
const MIX_INFO: Record<string, [string, string[]]> = {
  motion: ['Motion graphics', ['code_scene', 'motion_graphics']],
  stock: ['Banco de imagens/vídeos', ['stock_media']],
  ai: ['Vídeo IA (MiniMax)', ['video']],
};
const THUMB_LAYOUTS: Array<[NonNullable<ThumbnailTemplate['layout']>, string, string]> = [
  ['impacto', 'Impacto', 'YouTube thumbnail, 16:9, one large clear subject on the left, dramatic rim light, saturated contrasting colors, bold 3-word title text "{{thumb_text}}" in thick sans-serif, high contrast, topic: {{title}}'],
  ['explicativo', 'Explicativo', 'YouTube thumbnail, 16:9, clean {{style}} illustration explaining {{title}}, big readable text "{{thumb_text}}" at the top, simple background, three-color palette'],
  ['documentario', 'Documentário', 'YouTube thumbnail, 16:9, cinematic documentary still about {{title}}, moody lighting, shallow depth of field, small elegant title "{{thumb_text}}" bottom left'],
  ['minimal', 'Minimalista', 'YouTube thumbnail, 16:9, minimal flat background in one bold color, huge centered text "{{thumb_text}}", one small icon about {{title}}'],
  ['split', 'Antes × depois', 'YouTube thumbnail, 16:9, split screen comparison about {{title}}, left side vs right side, arrow in the middle, bold text "{{thumb_text}}"'],
];
const layoutOf = (t: ThumbnailTemplate): NonNullable<ThumbnailTemplate['layout']> =>
  t.layout ?? (['impacto', 'explicativo', 'documentario'].includes(t.id) ? (t.id as 'impacto') : 'minimal');

/** Esboço visual (16:9) da composição de um template de thumbnail. */
function thumbSketch(layout: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 160 90'); svg.setAttribute('class', 'tsketch');
  const add = (tag: string, a: Record<string, string>) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); svg.append(e); return e; };
  add('rect', { x: '0', y: '0', width: '160', height: '90', class: layout === 'documentario' ? 'ts-dark' : 'ts-bg' });
  const txt = (x: number, y: number, w: number, hh: number) => add('rect', { x: String(x), y: String(y), width: String(w), height: String(hh), rx: '2', class: 'ts-txt' });
  if (layout === 'impacto') { add('circle', { cx: '45', cy: '50', r: '30', class: 'ts-subj' }); txt(88, 24, 62, 14); txt(88, 44, 50, 14); }
  else if (layout === 'explicativo') { txt(30, 8, 100, 14); add('rect', { x: '50', y: '30', width: '60', height: '50', rx: '6', class: 'ts-subj' }); }
  else if (layout === 'documentario') { add('rect', { x: '0', y: '0', width: '160', height: '90', class: 'ts-vign' }); add('circle', { cx: '110', cy: '40', r: '22', class: 'ts-subj' }); txt(10, 70, 60, 8); }
  else if (layout === 'split') { add('rect', { x: '0', y: '0', width: '80', height: '90', class: 'ts-subj' }); add('path', { d: 'M72 45h16m-6-6 6 6-6 6', class: 'ts-line' }); txt(40, 70, 80, 12); }
  else { txt(25, 32, 110, 24); add('circle', { cx: '80', cy: '72', r: '7', class: 'ts-subj' }); }
  return svg;
}

/** Janela modal: mostra visualmente os templates de thumbnail, escolhe um ou cria um novo. */
/* ───────── referência para títulos/thumbnail: canal clonado, canal, vídeo, link ou arquivo ───────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const xapi = () => forge as unknown as Record<string, (...a: any[]) => Promise<any>>;
type CraftSource = { kind: 'clone'; id: string } | { kind: 'channel' | 'video' | 'link'; url: string } | { kind: 'file'; path: string };

async function craftSourcePicker(prefix: string, kinds: Array<CraftSource['kind']>): Promise<{ el: HTMLElement; value: () => CraftSource; label: () => string }> {
  const clones = ((await guard(() => xapi()['channelList']!())) ?? []) as Array<{ id: string; source: { name: string }; brand?: { names?: string[] } }>;
  const LABEL: Record<CraftSource['kind'], string> = { clone: '🧬 Canal clonado', channel: '📺 Canal (link)', video: '▶ Vídeo (link)', link: '🔗 Link (imagem, vídeo ou canal)', file: '🖼 Imagem do computador' };
  const kind = h('select', { id: `${prefix}-kind` }, ...kinds.map((k) => h('option', { value: k }, LABEL[k]))) as HTMLSelectElement;
  if (!clones.length && kinds.length > 1) kind.value = kinds.find((k) => k !== 'clone')!;
  const clone = h('select', { id: `${prefix}-clone`, class: 'grow' }, ...(clones.length ? clones.map((c) => h('option', { value: c.id }, `${c.source.name}${c.brand?.names?.[0] ? ` → ${c.brand.names[0]}` : ''}`)) : [h('option', { value: '' }, 'nenhum canal clonado (Obter vídeos → Clonar canal)')])) as HTMLSelectElement;
  const url = h('input', { id: `${prefix}-url`, class: 'grow', placeholder: 'https://www.youtube.com/@canal  ·  https://youtu.be/…  ·  link de imagem' }) as HTMLInputElement;
  let file = '';
  const fileLbl = h('span', { class: 'muted' }, 'nenhuma imagem');
  const pick = h('button', { onclick: () => void guard(async () => { const f = await forge.openFile({ title: 'Thumbnail de referência', filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (f) { file = f; fileLbl.textContent = basename(f); } }) }, 'Escolher…');
  const box = h('div', { class: 'row grow' });
  const paint = () => box.replaceChildren(...(kind.value === 'clone' ? [clone] : kind.value === 'file' ? [pick, fileLbl] : [url]));
  kind.addEventListener('change', paint); paint();
  const value = (): CraftSource => {
    const k = kind.value as CraftSource['kind'];
    if (k === 'clone') { if (!clone.value) throw new Error('Nenhum canal clonado: clone um canal em "Obter vídeos" ou use um link.'); return { kind: 'clone', id: clone.value }; }
    if (k === 'file') { if (!file) throw new Error('Escolha a imagem.'); return { kind: 'file', path: file }; }
    if (!url.value.trim()) throw new Error('Cole o link.');
    return { kind: k, url: url.value.trim() };
  };
  const label = () => kind.value === 'clone' ? `canal clonado "${clone.selectedOptions[0]?.textContent ?? ''}"` : kind.value === 'file' ? basename(file) : url.value.trim();
  return { el: h('div', { class: 'row' }, h('label', {}, 'Referência', kind), box), value, label };
}

async function harnessPicker(prefix: string): Promise<{ el: HTMLElement; harness: () => string; model: () => string | undefined }> {
  const cat = ((await guard(() => xapi()['catalog']!())) ?? { harnesses: [] }) as { harnesses: Array<{ id: string; models?: string[] }> };
  const hs = ['auto', ...cat.harnesses.map((x) => x.id)];
  const sel = h('select', { id: `${prefix}-harness` }, ...hs.map((x) => h('option', { value: x }, x === 'auto' ? 'auto (primeiro disponível)' : x))) as HTMLSelectElement;
  const model = h('select', { id: `${prefix}-model` }) as HTMLSelectElement;
  const paint = () => model.replaceChildren(h('option', { value: '' }, 'modelo padrão'), ...(cat.harnesses.find((x) => x.id === sel.value)?.models ?? []).map((m) => h('option', { value: m }, m)));
  sel.addEventListener('change', paint); paint();
  return { el: h('div', { class: 'row' }, h('label', {}, 'IA', sel), h('label', {}, 'Modelo', model)), harness: () => sel.value, model: () => model.value || undefined };
}

/** Log de um processo longo (eventos "craft") dentro de um modal. */
const craftLog = (pre: HTMLElement) => (forge as unknown as { onEvent: (cb: (e: { t: string; stepId?: string; line?: string }) => void) => () => void })
  .onEvent((e) => { if (e.t === 'log' && e.stepId === 'craft' && e.line) { pre.textContent += e.line + '\n'; pre.scrollTop = pre.scrollHeight; } });

interface TitlePick { title: string; thumbText?: string; pattern: string; source: string }
/** Sugestões de título no padrão de um canal clonado, canal ou vídeo. */
async function openTitleModal(idea: string, language: string, onPick: (p: TitlePick) => void) {
  const src = await craftSourcePicker('tt', ['clone', 'channel', 'video']);
  const ai = await harnessPicker('tt');
  const ideaIn = h('textarea', { id: 'tt-idea', rows: '2' }) as HTMLTextAreaElement; ideaIn.value = idea;
  const log = h('pre', { class: 'pvtext svlog', id: 'tt-log' });
  const out = h('div', { id: 'tt-out' });
  const close = () => bg.remove();
  const go = h('button', { class: 'primary', id: 'tt-go', onclick: () => void (async () => {
    let off: (() => void) | undefined;
    try {
      const source = src.value();
      go.setAttribute('disabled', ''); log.textContent = ''; out.replaceChildren(h('div', { class: 'muted' }, '⏳ Lendo os títulos da referência e escrevendo sugestões…'));
      off = craftLog(log);
      const r = (await xapi()['suggestTitles']!({ source, idea: ideaIn.value, language, harness: ai.harness(), model: ai.model() })) as { label: string; pattern: string; structure: { summary: string }; titles: Array<{ title: string; type: string; formula?: string; why?: string; thumbText?: string }> };
      out.replaceChildren(
        h('div', { class: 'card' }, h('strong', {}, `📐 Estrutura de ${r.label}`), h('div', { class: 'muted small' }, r.structure.summary), r.pattern ? h('div', {}, h('strong', {}, 'Esqueleto: '), r.pattern) : null),
        h('div', { class: 'tt-list' }, ...r.titles.map((t) => h('button', { class: 'tcard tt-item', 'data-title': t.title, title: [t.formula, t.why].filter(Boolean).join(' — '), onclick: () => { onPick({ title: t.title, thumbText: t.thumbText, pattern: r.pattern || r.structure.summary, source: r.label }); close(); } },
          h('strong', {}, t.title), h('span', { class: 'muted small' }, `${t.type} · ${t.title.length} car.${t.thumbText ? ` · thumb: "${t.thumbText}"` : ''}`), t.why ? h('span', { class: 'muted small' }, t.why) : null))));
    } catch (e) { out.replaceChildren(h('div', { class: 'tag failed' }, '⛔ ' + (e as Error).message)); }
    finally { go.removeAttribute('disabled'); off?.(); }
  })() }, '💡 Sugerir títulos');
  const bg = h('div', { class: 'modal-bg', id: 'title-modal', onclick: (e) => { if (e.target === bg) close(); } }, h('div', { class: 'modal pmodal' },
    h('div', { class: 'row' }, h('h3', {}, '💡 Títulos no padrão de um canal ou vídeo'), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
    h('p', { class: 'muted' }, 'Mede a estrutura dos títulos da referência (tamanho, números, perguntas, separadores, palavras recorrentes, os mais vistos) e escreve títulos novos para a sua ideia no mesmo esqueleto — variantes de busca, navegação e híbridas. Clique num título para usar: ele vira o título do vídeo e a estrutura guia o SEO.'),
    src.el, h('label', {}, 'Ideia do vídeo', ideaIn), ai.el,
    h('div', { class: 'row actions pfoot' }, h('span', { class: 'sp' }), go), log, out));
  document.body.append(bg);
}

/** Modela uma thumbnail (template + brief) a partir de canal clonado, canal, vídeo, link ou imagem. */
async function openThumbModelModal(onDone: (tpl: ThumbnailTemplate) => void) {
  const src = await craftSourcePicker('tm', ['clone', 'channel', 'video', 'link', 'file']);
  const ai = await harnessPicker('tm');
  const name = h('input', { id: 'tm-name', placeholder: 'Nome do template (opcional)' }) as HTMLInputElement;
  const note = h('input', { id: 'tm-note', class: 'grow', placeholder: 'Observação (opcional): ex. sem rosto, foco no objeto, cores do meu canal…' }) as HTMLInputElement;
  const log = h('pre', { class: 'pvtext svlog', id: 'tm-log' });
  const out = h('div', { id: 'tm-out' });
  const close = () => bg.remove();
  const go = h('button', { class: 'primary', id: 'tm-go', onclick: () => void (async () => {
    let off: (() => void) | undefined;
    try {
      const source = src.value();
      go.setAttribute('disabled', ''); log.textContent = ''; out.replaceChildren(h('div', { class: 'muted' }, '⏳ Baixando as thumbnails e modelando o estilo…'));
      off = craftLog(log);
      const r = (await xapi()['modelThumbnail']!({ source, name: name.value.trim() || undefined, note: note.value.trim() || undefined, harness: ai.harness(), model: ai.model() })) as {
        template: ThumbnailTemplate; refs: string[]; label: string; brief: { focal?: string; textOverlay?: string; palette?: string[]; composition?: string; mobile?: string; avoid?: string[] }; variants: Array<{ name: string; change: string; hypothesis?: string }> };
      const b = r.brief;
      out.replaceChildren(h('div', { class: 'card svresult' },
        h('strong', {}, `✓ Template "${r.template.name}" criado a partir de ${r.label}`),
        h('div', { class: 'tm-refs' }, ...r.refs.slice(0, 6).map((f) => h('img', { class: 'tsketch', src: forge.mediaUrl(f), alt: '' }))),
        b.focal ? h('div', {}, h('strong', {}, '🎯 Ponto focal: '), b.focal) : null,
        b.textOverlay ? h('div', {}, h('strong', {}, '🔤 Texto: '), b.textOverlay) : null,
        b.palette?.length ? h('div', { class: 'row' }, h('strong', {}, '🎨 Paleta: '), ...b.palette.map((c) => { const sw = h('span', { class: 'chip', title: c }, c); sw.style.borderLeft = `14px solid ${c}`; return sw; })) : null,
        b.composition ? h('div', {}, h('strong', {}, '📐 Composição: '), b.composition) : null,
        b.mobile ? h('div', {}, h('strong', {}, '📱 Celular (168×94): '), b.mobile) : null,
        b.avoid?.length ? h('div', {}, h('strong', {}, '🚫 Evitar: '), b.avoid.join(' · ')) : null,
        r.variants.length ? h('div', {}, h('strong', {}, '🧪 Variantes A/B: '), ...r.variants.map((v) => h('div', { class: 'muted small' }, `${v.name} — muda: ${v.change}${v.hypothesis ? ` (${v.hypothesis})` : ''}`))) : null,
        h('details', {}, h('summary', { class: 'muted small' }, 'prompt do template'), h('pre', { class: 'pvtext' }, r.template.prompt)),
        h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Fechar'), h('button', { class: 'primary', id: 'tm-use', onclick: () => { close(); onDone(r.template); } }, 'Usar este template'))));
      toast(`Template "${r.template.name}" criado`);
    } catch (e) { out.replaceChildren(h('div', { class: 'tag failed' }, '⛔ ' + (e as Error).message)); }
    finally { go.removeAttribute('disabled'); off?.(); }
  })() }, '🧬 Modelar');
  const bg = h('div', { class: 'modal-bg', id: 'thumb-model-modal', onclick: (e) => { if (e.target === bg) close(); } }, h('div', { class: 'modal pmodal' },
    h('div', { class: 'row' }, h('h3', {}, '🧬 Modelar thumbnail'), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
    h('p', { class: 'muted' }, 'Baixa as thumbnails da referência (as mais vistas do canal, a do vídeo ou a imagem do link) e uma IA com visão escreve um template no mesmo estilo + um brief: ponto focal, texto (até 3 palavras), paleta em hex, composição, legibilidade no celular, o que evitar e 3 variantes A/B. Use uma IA que enxerga imagens (Claude, Antigravity/Gemini, Codex ou um modelo local com visão).'),
    src.el, h('div', { class: 'row' }, name, note), ai.el,
    h('div', { class: 'row actions pfoot' }, h('span', { class: 'sp' }), go), log, out));
  document.body.append(bg);
}

async function openThumbModal(currentId: string, onPick: (id: string) => void) {
  const s = await forge.getSettings();
  const list = s.thumbnails ?? [];
  const close = () => bg.remove();
  const preview = (t: ThumbnailTemplate) => t.preview ? h('img', { class: 'tsketch', src: forge.mediaUrl(t.preview), alt: t.name }) : thumbSketch(layoutOf(t));
  const grid = h('div', { class: 'tgrid' }, ...list.map((t) => h('button', { class: `tcard${t.id === currentId ? ' sel' : ''}`, 'data-thumb': t.id, onclick: () => { onPick(t.id); close(); } },
    preview(t), h('strong', {}, t.name), h('span', { class: 'muted' }, t.prompt.slice(0, 90) + (t.prompt.length > 90 ? '…' : '')))));
  // formulário de novo template
  let layout: NonNullable<ThumbnailTemplate['layout']> = 'impacto'; let media: string | undefined;
  const nm = h('input', { placeholder: 'Nome do template', id: 'tn-name' }) as HTMLInputElement;
  const pr = h('textarea', { id: 'tn-prompt', rows: '4' }) as HTMLTextAreaElement; pr.value = THUMB_LAYOUTS[0]![2];
  const mediaLbl = h('span', { class: 'muted' }, 'sem imagem de exemplo');
  const lays = h('div', { class: 'tgrid small' });
  const paintLays = () => lays.replaceChildren(...THUMB_LAYOUTS.map(([id, label, prompt]) => h('button', { class: `tcard${id === layout ? ' sel' : ''}`, 'data-layout': id, onclick: () => { layout = id; pr.value = prompt; paintLays(); } }, thumbSketch(id), h('strong', {}, label))));
  paintLays();
  const form = h('div', { class: 'card tform', id: 'thumb-new' },
    h('strong', {}, 'Novo template'), h('label', {}, 'Nome', nm), h('label', {}, 'Composição', lays),
    h('label', {}, 'Prompt (variáveis: {{title}} {{thumb_text}} {{style}} {{idea}})', pr),
    h('div', { class: 'row' }, h('button', { onclick: () => void guard(async () => {
      const f = await forge.openFile({ title: 'Imagem de exemplo', filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
      if (f) { media = await forge.importMedia(f, 'thumb'); mediaLbl.textContent = basename(f); }
    }) }, 'Imagem de exemplo (opcional)…'), mediaLbl),
    h('div', { class: 'row' }, h('button', { class: 'primary', id: 'tn-save', onclick: () => void guard(async () => {
      if (!nm.value.trim() || !pr.value.trim()) throw new Error('Informe nome e prompt.');
      const fresh = await forge.getSettings();
      let id = nm.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tpl'; let n = 2;
      while ((fresh.thumbnails ?? []).some((x) => x.id === id)) id = `${id}-${n++}`;
      fresh.thumbnails = [...(fresh.thumbnails ?? []), { id, name: nm.value.trim(), prompt: pr.value.trim(), layout, preview: media }];
      await forge.setSettings(fresh); toast(`Template "${nm.value.trim()}" criado`); onPick(id); close();
    }) }, 'Salvar e usar')));
  form.style.display = 'none';
  const bg = h('div', { class: 'modal-bg', id: 'thumb-modal', onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal' },
      h('div', { class: 'row' }, h('h3', {}, 'Template de thumbnail'), h('span', { class: 'sp' }),
        h('button', { class: 'primary', id: 'tn-model', title: 'Modela o estilo das thumbnails de um canal clonado, canal, vídeo ou link (IA com visão)', onclick: () => void openThumbModelModal((tpl) => { onPick(tpl.id); close(); }) }, '🧬 Modelar de canal/vídeo/link'),
        h('button', { id: 'tn-open', onclick: () => { form.style.display = form.style.display === 'none' ? '' : 'none'; } }, '＋ Novo template'),
        h('button', { onclick: close, title: 'Fechar' }, '✕')),
      h('p', { class: 'muted' }, 'Escolha a composição da thumbnail (gerada só para vídeos 16:9). O modelo de imagem é o da tarefa "Thumbnail" da rota.'),
      grid, form));
  document.body.append(bg);
}

async function renderNew() {
  const meta = await forge.meta();
  const skills = meta.skills ?? [];
  const agents = meta.agents ?? [];
  const previews = (await guard(() => forge.skillPreviews())) ?? {};
  const name = h('input', { placeholder: 'Nome do vídeo', id: 'np-name' });
  const idea = h('textarea', { placeholder: 'Ideia, roteiro ou tema', id: 'np-idea' });
  const autoUp = h('input', { type: 'checkbox', id: 'np-autoupload' }) as HTMLInputElement;
  const agySel = agyAccountSelect('np-agy');
  const flowSel = agyAccountSelect('np-flow', '', undefined, 'flow');
  const chSel = channelSelect('np-channel');
  if (pendingIdea) { (idea as HTMLTextAreaElement).value = pendingIdea; pendingIdea = undefined; }
  const ideaLbl = h('span', {}, 'Ideia / prompt simples (o sistema acrescenta a skill, os estilos, o idioma e as referências)');
  const builtin = skills.filter((k) => k.builtin), mine = skills.filter((k) => !k.builtin);
  const skill = h('select', { id: 'np-skill' }, h('option', { value: '' }, '— escolha uma skill (tipo de vídeo) —'),
    h('optgroup', { label: 'Tipos de vídeo (padrão)' }, ...builtin.map((k) => h('option', { value: k.id }, k.name))),
    mine.length ? h('optgroup', { label: 'Minhas skills' }, ...mine.map((k) => h('option', { value: k.id }, k.name))) : null) as HTMLSelectElement;
  const route = h('select', { id: 'np-route' }, h('option', { value: '' }, '— escolha uma rota —'), ...meta.routes.map((r) => h('option', { value: r.id }, r.name))) as HTMLSelectElement;
  const scriptStyle = h('textarea', { id: 'np-script-style', rows: '3', placeholder: 'Opcional. Ex.: tom bem-humorado, frases curtas, começar com uma pergunta provocativa, falar em 2ª pessoa ("você")…' });
  const videoStyle = h('textarea', { id: 'np-video-style', rows: '3', placeholder: 'Opcional. Ex.: paleta azul e laranja, traço grosso, câmera sempre em movimento lento, sem texto na tela…' });
  const musicStyle = h('textarea', { id: 'np-music-style', rows: '2', placeholder: 'Opcional (clipes musicais). Ex.: lo-fi, chill, vinil, café, noturno, instrumental.' });
  const musicMode = h('select', { id: 'np-music-mode' }, ...[['instrumental', 'Instrumental'], ['song', 'Canção (com letra)']].map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  /* coletânea: o usuário estima a duração mínima e máxima (minutos) e o tamanho de cada faixa */
  const musMin = h('input', { id: 'np-music-min', type: 'number', min: '1', max: '240', step: '1', value: '30', class: 'num' }) as HTMLInputElement;
  const musMax = h('input', { id: 'np-music-max', type: 'number', min: '1', max: '240', step: '1', value: '60', class: 'num' }) as HTMLInputElement;
  const musTrack = h('input', { id: 'np-music-track', type: 'number', min: '60', max: '300', step: '10', value: '150', class: 'num' }) as HTMLInputElement;
  const musInfo = h('span', { class: 'muted', id: 'np-music-info' });
  const paintMusInfo = () => { const a = Number(musMin.value) || 1, b = Math.max(a, Number(musMax.value) || a), t = Math.min(300, Math.max(60, Number(musTrack.value) || 150)); const n = Math.max(1, Math.round(((a + b) / 2) * 60 / t)); musInfo.textContent = `≈ ${n} faixas de ${Math.round(((a + b) / 2) * 60 / n)} s (alvo ${Math.round((a + b) / 2)} min)`; };
  for (const x of [musMin, musMax, musTrack]) x.addEventListener('input', paintMusInfo);
  paintMusInfo();
  const waveform = h('select', { id: 'np-waveform' }, ...[['line', 'Linha'], ['p2p', 'Barras'], ['cline', 'Preenchida'], ['dot', 'Pontos']].map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  const aspect = h('select', { id: 'np-aspect' }, ...['9:16', '16:9', '1:1', '4:5'].map((a) => h('option', { value: a }, a))) as HTMLSelectElement;
  const dsec = h('input', { type: 'number', value: '60', min: '5', id: 'np-dur' }) as HTMLInputElement;
  const lang = h('select', { id: 'np-lang' }, ...LANGUAGES.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  const quality = h('select', {}, ...['standard', 'depth', 'polished', 'verified', 'ultra'].map((q) => h('option', { value: q }, q))) as HTMLSelectElement;
  const npFreeEngine = freeEngineSelect('np-free-engine', '');
  const profile = h('select', {}, ...[['default', 'Padrão da rota'], ['local', '100% local'], ['commercial', 'Comercial primeiro'], ['cheap', 'Barato']].map(([v, l]) => h('option', { value: v! }, l))) as HTMLSelectElement;
  const cfg = (await guard(() => forge.getSettings())) ?? undefined;
  /* tempo máximo: valor padrão das Configurações; "Sem limite" = 0 (a produção roda até terminar) */
  const defMax = Math.max(0, Math.round(cfg?.defaults?.maxProductionMin ?? 60));
  const maxMin = h('input', { type: 'number', value: String(defMax || 60), min: '5', step: '5', id: 'np-maxmin', class: 'num' }) as HTMLInputElement;
  const noLimit = timeLimitToggle('np-nolimit', maxMin, defMax === 0);
  /* legendas da fala e ordem da produção: padrões das Configurações */
  const subsSel = subtitlesSelect('np-subs', cfg?.defaults?.subtitles ?? 'off');
  const audioFirstCb = h('input', { type: 'checkbox', id: 'np-audio-first' }) as HTMLInputElement; audioFirstCb.checked = cfg?.defaults?.audioFirst ?? true;
  const codeMusicCb = h('input', { type: 'checkbox', id: 'np-code-music' }) as HTMLInputElement;
  const defConc = Math.max(1, Math.min(8, Math.round(cfg?.defaults?.sceneConcurrency ?? 3)));
  const conc = h('input', { type: 'number', value: String(defConc), min: '1', max: '8', id: 'np-conc', class: 'num' }) as HTMLInputElement;
  /* reservas de harness deste projeto: começa com as das Configurações; vazio = padrão */
  let npFallback: string[] = [...(cfg?.harnessFallback ?? [])];
  let npNoFallback = !!cfg?.noFallback;
  const npFallbackBox = fallbackChips('np-fallback', npFallback, (next) => { npFallback = next; }, cfg ? Object.keys(cfg.harnesses) : undefined,
    { value: npNoFallback, onChange: (v) => { npNoFallback = v; } });
  const info = h('div', { class: 'card skillinfo', id: 'np-skill-info' });
  /* dobra de nicho escolhida (vem de "Obter vídeos" → canal clonado) */
  const foldBox = h('div', { class: 'card', id: 'np-fold-box' });
  const paintFold = () => {
    foldBox.style.display = formFold ? '' : 'none';
    foldBox.replaceChildren(...(formFold ? [
      h('div', { class: 'row' }, h('span', { class: 'tag done' }, '🧬 Dobra de nicho'), h('strong', { class: 'grow' }, formFold.name),
        h('button', { class: 'small', title: 'Tirar a dobra deste projeto', id: 'np-fold-clear', onclick: () => { formFold = undefined; paintFold(); } }, '✕')),
      formFold.angle ? h('div', { class: 'muted small' }, `Ângulo: ${formFold.angle}`) : null,
      h('div', { class: 'muted small' }, 'O projeto fica ligado a esta dobra (aparece nas métricas da dobra) e a skill recebe o bloco da dobra nas diretrizes.'),
    ].filter((x) => !!x) as HTMLElement[] : []));
  };
  paintFold();

  // arquivos de referência (opcionais)
  let refScript: string | undefined, refVideo: string | undefined;
  const fileChip = (get: () => string | undefined, clear: () => void, repaint: () => void) => {
    const f = get(); return f ? h('span', { class: 'tag done', title: f }, '🗎 ' + basename(f), h('button', { class: 'x', title: 'Remover', onclick: () => { clear(); repaint(); } }, '×')) : h('span', { class: 'muted' }, 'nenhum arquivo');
  };
  /* título escolhido nas sugestões (estrutura do canal/vídeo de referência) */
  let titlePick: TitlePick | undefined;
  const titleBox = h('div', { id: 'np-title-model' });
  const paintTitle = () => titleBox.replaceChildren(...(titlePick ? [h('div', { class: 'row' }, h('span', { class: 'tag done' }, `💡 título no padrão de ${titlePick.source}`),
    titlePick.thumbText ? h('span', { class: 'chip' }, `thumb: "${titlePick.thumbText}"`) : null, h('span', { class: 'muted small grow' }, titlePick.pattern.slice(0, 160)),
    h('button', { class: 'small', title: 'Tirar o modelo de título', onclick: () => { titlePick = undefined; paintTitle(); } }, '✕'))] : []));
  const scriptBox = h('span', {}), videoBox = h('span', {});
  const scriptUse = h('input', { type: 'checkbox', id: 'np-ref-script-use' }) as HTMLInputElement;
  const paintRefs = () => {
    scriptBox.replaceChildren(fileChip(() => refScript, () => { refScript = undefined; }, paintRefs));
    videoBox.replaceChildren(fileChip(() => refVideo, () => { refVideo = undefined; }, paintRefs));
  };
  paintRefs();
  const pickScript = h('button', { id: 'np-ref-script', onclick: () => void guard(async () => {
    const f = await forge.openFile({ title: 'Roteiro de referência', filters: [{ name: 'Texto, legenda, áudio ou vídeo', extensions: ['txt', 'md', 'srt', 'vtt', 'json', 'mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'ogg'] }] });
    if (f) { refScript = f; paintRefs(); }
  }) }, 'Escolher arquivo…');
  const pickVideo = h('button', { id: 'np-ref-video', onclick: () => void guard(async () => {
    const f = await forge.openFile({ title: 'Vídeo de referência', filters: [{ name: 'Vídeo', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'gif'] }] });
    if (f) { refVideo = f; paintRefs(); }
  }) }, 'Escolher arquivo…');
  /* arquivos do usuário: copiados para o projeto ao criar */
  const attachFiles: string[] = [];
  const attachBox = h('span', { class: 'row wrap', id: 'np-attach-list' });
  const paintAttach = () => attachBox.replaceChildren(...(attachFiles.length ? attachFiles.map((f, i) => h('span', { class: 'tag done', title: f }, '📎 ' + basename(f),
    h('button', { class: 'x', title: 'Remover', onclick: () => { attachFiles.splice(i, 1); paintAttach(); } }, '×'))) : [h('span', { class: 'muted' }, 'nenhum arquivo')]));
  paintAttach();
  const addAttach = (mode: 'files' | 'folder') => void guard(async () => { for (const f of await forge.attachPick(mode)) if (!attachFiles.includes(f)) attachFiles.push(f); paintAttach(); });
  /* arrastar e soltar arquivos direto no prompt do novo projeto (vídeos do tutorial, imagens, áudios, textos) */
  idea.title = 'Você pode arrastar arquivos para cá (ou usar "Arquivos…" abaixo)';
  idea.addEventListener('dragover', (e) => { e.preventDefault(); idea.classList.add('drop'); });
  idea.addEventListener('dragleave', () => idea.classList.remove('drop'));
  idea.addEventListener('drop', (e) => {
    e.preventDefault(); idea.classList.remove('drop');
    const pick = (forge as unknown as { pathForFile?: (f: File) => string }).pathForFile;
    const paths = Array.from(e.dataTransfer?.files ?? []).map((f) => (pick ? pick(f) : '')).filter((p): p is string => !!p);
    for (const p of paths) if (!attachFiles.includes(p)) attachFiles.push(p);
    if (paths.length) { paintAttach(); toast(`${paths.length} arquivo(s) anexado(s) ao projeto`); }
  });
  const pickAttachFiles = h('button', { id: 'np-attach-files', onclick: () => addAttach('files') }, 'Arquivos…');
  const pickAttachFolder = h('button', { id: 'np-attach-folder', onclick: () => addAttach('folder') }, 'Pasta…');

  // template de thumbnail (modal visual)
  let thumbId = '';
  const thumbBox = h('div', { class: 'thumbpick', id: 'np-thumb' });
  const paintThumb = () => {
    const t = (meta.thumbnails ?? []).find((x) => x.id === thumbId) ?? (meta.thumbnails ?? [])[0];
    thumbBox.replaceChildren(t ? (t.preview ? h('img', { class: 'tsketch', src: forge.mediaUrl(t.preview), alt: t.name }) : thumbSketch(layoutOf(t))) : h('span', { class: 'muted' }, 'sem templates'),
      h('div', {}, h('strong', {}, t ? t.name : '—'), h('div', { class: 'muted' }, thumbId ? '' : '(padrão: primeiro template)')),
      h('button', { id: 'np-thumb-open', onclick: () => void openThumbModal(thumbId || t?.id || '', async (id) => { thumbId = id; meta.thumbnails = (await forge.meta()).thumbnails; paintThumb(); }) }, 'Escolher ou criar…'));
  };
  paintThumb();

  // equipe de agentes
  const orch = h('select', { id: 'np-orch' }, h('option', { value: '' }, 'Nenhum (sem brief)'), ...agents.filter((a) => a.role === 'orchestrator').map((a) => h('option', { value: a.id }, `${a.icon ?? '🧭'} ${a.name}`))) as HTMLSelectElement;
  const workerBoxes = agents.filter((a) => a.role === 'worker').map((a) => {
    const cb = h('input', { type: 'checkbox', 'data-worker': a.id }) as HTMLInputElement;
    const t = agentType(a);
    const el = h('label', { class: 'np-agent', title: a.description, style: `--c:${AGENT_TYPES[t].color}` }, cb, h('span', { class: 'np-agent-ic' }, a.icon ?? AGENT_TYPES[t].icon),
      h('span', { class: 'np-agent-txt' }, h('strong', {}, a.name), h('span', { class: 'muted small' }, `${AGENT_TYPES[t].label} · ${(a.handles ?? []).map((k) => KIND_LABEL_NP[k] ?? k).join(', ')}`)));
    cb.addEventListener('change', () => el.classList.toggle('on', cb.checked));
    return { a, cb, el };
  });
  const teamInfo = h('div', { class: 'muted', id: 'np-team-info' });
  const paintTeam = () => {
    const o = agents.find((a) => a.id === orch.value);
    const w = workerBoxes.filter((x) => x.cb.checked).map((x) => x.a.name);
    teamInfo.textContent = o ? `${o.name} escreve o brief antes de tudo${w.length ? ` · obreiros: ${w.join(', ')}` : ''}.` : w.length ? `Obreiros: ${w.join(', ')} (sem orquestrador, sem brief).` : 'Sem equipe: cada etapa usa o executor da rota.';
  };
  orch.addEventListener('change', paintTeam); workerBoxes.forEach((x) => x.cb.addEventListener('change', paintTeam));

  // plugins (formato Claude): opcional, muda o prompt de todas as etapas
  const pluginList = ((await guard(() => forge.listPlugins())) ?? []) as Array<{ recommended?: { label?: string; kinds: string[]; bindings: unknown[] }; id: string; name: string; displayName?: string; description?: string; skills?: string[]; commands?: string[]; agents?: string[]; styles?: PluginStyle[]; cover?: string; preview?: string; kit?: { kind: 'player' | 'piece' | 'pages' | 'node-film'; styles: string[]; examples: number; needsLibrary?: boolean; repo?: string }; items?: Array<{ kind: string; name: string; description?: string; image?: string }> }>;
  const pluginStyles: Record<string, string> = {};
  const pluginBoxes = pluginList.map((k) => {
    const cb = h('input', { type: 'checkbox', 'data-plugin': k.id }) as HTMLInputElement;
    const caps = [k.styles?.length ? `${k.styles.length} estilos` : '', !k.styles?.length && k.skills?.length ? `${k.skills.length} skill(s)` : '', k.commands?.length ? `${k.commands.length} comando(s)` : '', k.agents?.length ? `${k.agents.length} agente(s)` : ''].filter(Boolean).join(' · ');
    /* plugin de estilos: galeria compacta para escolher UM estilo (só ele entra no prompt) */
    const gallery = h('div', { class: 'np-pstyles', 'data-plugin-styles': k.id });
    const paintGallery = () => {
      gallery.style.display = cb.checked && k.styles?.length ? '' : 'none';
      const styles = k.styles ?? [];
      const missingVideos = styles.filter((st) => st.videoUrl && !st.video);
      gallery.replaceChildren(...styles.map((st) => h('button', { class: `np-pstyle${pluginStyles[k.id] === st.id ? ' on' : ''}`, 'data-style': st.id, title: st.summary ?? st.name,
        onclick: () => { pluginStyles[k.id] = st.id; paintGallery(); } },
        /* prévia em vídeo do estilo (biblioteca de estilos): gerada sob demanda pelo motor do plugin */
        st.video ? h('video', { src: forge.mediaUrl(st.video), autoplay: true, loop: true, muted: true, playsinline: true }) : st.cover ? h('img', { src: forge.mediaUrl(st.cover), alt: '' }) : h('span', {}, '🎨'),
        st.videoUrl && !st.video ? h('span', { class: 'np-pstyle-video', title: 'Baixar e mostrar o vídeo de exemplo deste estilo', onclick: (e) => { e.stopPropagation(); e.preventDefault(); const el = e.currentTarget as HTMLElement; el.textContent = '⏳ baixando…'; void guard(async () => { try { const f = await (forge as unknown as { pluginStyleVideo: (id: string, style: string) => Promise<string> }).pluginStyleVideo(k.id, st.id); st.video = f; paintGallery(); } catch (err) { el.textContent = '▶ vídeo'; throw err; } }); } }, '▶ vídeo') : null, h('span', {}, st.name),
        k.kit?.kind === 'pages' && pluginStyles[k.id] === st.id && !st.video ? h('span', { class: 'np-pstyle-gen', 'data-style-preview': st.id, title: 'Renderiza 3 s da demo deste estilo com a biblioteca do plugin (sem IA)', onclick: (e) => { e.stopPropagation(); const el = e.currentTarget as HTMLElement; el.textContent = '⏳';
          void guard(async () => { const f = await (forge as unknown as { pluginPreview: (id: string, force?: boolean, style?: string) => Promise<string> }).pluginPreview(k.id, false, st.id); st.video = f; paintGallery(); }); } }, '🎬 prévia 3 s') : null)),
        ...(missingVideos.length > 1 ? [h('button', { class: 'np-pstyle np-pstyle-dl', title: 'Baixar todos os vídeos de exemplo que ainda faltam', onclick: (e) => { e.stopPropagation(); e.preventDefault(); const el = e.currentTarget as HTMLButtonElement; const todo = missingVideos.slice(); el.disabled = true; el.replaceChildren(h('span', { class: 'np-pstyle-dl-ic' }, '⏳'), h('span', {}, `0/${todo.length}`)); void guard(async () => { let done = 0; for (const st of todo) { el.replaceChildren(h('span', { class: 'np-pstyle-dl-ic' }, '⏳'), h('span', {}, `${done + 1}/${todo.length}`)); try { st.video = await (forge as unknown as { pluginStyleVideo: (id: string, style: string) => Promise<string> }).pluginStyleVideo(k.id, st.id); done++; } catch { /* segue para o próximo */ } } paintGallery(); }); } }, h('span', { class: 'np-pstyle-dl-ic' }, '⬇'), h('span', {}, `baixar ${missingVideos.length} vídeos`))] : []));
    };
    /* plugin com várias skills: escolha UM template (só ele entra no prompt) ou "automático" (todas; o modelo escolhe por cena) */
    const skills = (k.items ?? []).filter((it) => it.kind === 'skill');
    const skillRow = h('div', { class: 'np-pskills', 'data-plugin-skills': k.id });
    const paintSkills = () => {
      skillRow.style.display = cb.checked && !k.styles?.length && !k.kit && skills.length > 1 ? '' : 'none';
      const pick = (name?: string) => (e: Event) => { e.preventDefault(); if (name) pluginStyles[k.id] = name; else delete pluginStyles[k.id]; paintSkills(); };
      skillRow.replaceChildren(
        h('span', { class: 'muted small np-pskills-hint' }, '🎞️ Template (clique para escolher):'),
        h('button', { class: `np-pskill${!pluginStyles[k.id] ? ' on' : ''}`, 'data-template': '', title: 'Todas as skills entram no prompt e o modelo escolhe o formato de cada cena', onclick: pick() },
          h('span', { class: 'np-pskill-ic' }, '✨'), h('strong', {}, 'Automático'), h('span', { class: 'muted' }, 'o modelo escolhe por cena')),
        ...skills.map((it) => h('button', { class: `np-pskill${pluginStyles[k.id] === it.name ? ' on' : ''}`, 'data-template': it.name, title: it.description ?? it.name, onclick: pick(it.name) },
          it.image ? h('img', { src: forge.mediaUrl(it.image), alt: '' }) : h('span', { class: 'np-pskill-ic' }, '🧠'), h('strong', {}, it.name),
          it.description ? h('span', { class: 'muted' }, it.description.slice(0, 90) + (it.description.length > 90 ? '…' : '')) : null)));
    };
    const cover = k.cover ?? k.styles?.find((st) => st.cover)?.cover ?? skills.find((it) => it.image)?.image;
    /* plugin com motor próprio: a prévia de 2–3 s renderizada por ele (ou o botão para gerar) */
    const previewEl = k.preview ? h('video', { class: 'np-pcover np-pvideo', src: forge.mediaUrl(k.preview), autoplay: true, loop: true, muted: true, playsinline: true }) as HTMLVideoElement : null;
    if (previewEl) previewEl.muted = true;
    const genBtn = k.kit && !k.preview ? h('button', { class: 'small np-pgen', 'data-preview': k.id, title: 'Renderiza 3 s do exemplo do plugin com o motor dele (sem IA)', onclick: (e) => { e.preventDefault(); e.stopPropagation(); const b = e.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = '⏳ gerando prévia…';
      void guard(async () => { await (forge as unknown as { pluginPreview: (id: string) => Promise<string> }).pluginPreview(k.id); pluginCache = []; void render(); }); } }, '🎬 Gerar prévia (3 s)') : null;
    const kitStyles = k.kit?.kind === 'player' && k.kit.styles.length ? h('div', { class: 'np-kitstyles', 'data-kit-styles': k.id }) : null;
    const kitDefault = k.kit?.styles.includes('dusk') ? 'dusk' : k.kit?.styles[0];
    const paintKit = () => { if (!kitStyles) return; kitStyles.style.display = cb.checked ? '' : 'none';
      if (cb.checked && kitDefault && !pluginStyles[k.id]) pluginStyles[k.id] = kitDefault;   // o estilo fica gravado no projeto
      kitStyles.replaceChildren(h('span', { class: 'muted small' }, '🎨 Estilo do motor:'), ...k.kit!.styles.map((st) => h('button', { class: `chip${pluginStyles[k.id] === st ? ' on' : ''}`, 'data-kit-style': st, onclick: (e) => { e.preventDefault(); pluginStyles[k.id] = st; paintKit(); } }, st))); };
    const card = h('label', { class: 'np-pcard', title: k.description ?? '' },
      previewEl ?? (cover ? h('img', { class: 'np-pcover', src: forge.mediaUrl(cover), alt: '' }) : h('span', { class: 'np-pcover np-pnocover' }, '🧩')),
      h('span', { class: 'np-pinfo' }, h('span', { class: 'row' }, cb, h('strong', {}, k.displayName ?? k.name)), caps ? h('span', { class: 'muted' }, caps) : null,
        k.description ? h('span', { class: 'muted np-pdesc' }, k.description) : null,
        skills.length === 1 && !k.styles?.length ? h('span', { class: 'tag' }, `🧠 ${skills[0]!.name}`) : null,
        k.recommended ? h('span', { class: 'tag running', title: `Com o plugin ativo, esta LLM vai à frente nas etapas: ${k.recommended.kinds.map((x) => KIND_LABEL_NP[x] ?? x).join(', ')} (os executores da rota ficam de reserva).` }, `🤖 LLM indicada: ${k.recommended.label ?? k.recommended.bindings.map((b) => (b as { harness?: string; model?: string }).harness + '/' + (b as { model?: string }).model).join(' → ')}`) : null,
        k.kit ? h('span', { class: 'tag done' }, k.kit.kind === 'player' ? '🎬 motor próprio: cenas renderizadas pelo plugin' : k.kit.kind === 'pages' ? (k.kit.needsLibrary ? '📦 biblioteca de estilos (baixe na aba Plugins)' : `🎬 biblioteca de ${k.kit.styles.length} estilos: cenas renderizadas pelo plugin`) : k.kit.kind === 'node-film' ? '🧩 biblioteca de desenho do plugin' : '🎬 motor próprio (peças: prévia)') : null, genBtn));
    const paint = () => { card.classList.toggle('on', cb.checked); paintGallery(); paintSkills(); paintKit(); };
    cb.addEventListener('change', paint);
    if (pendingPlugin?.id === k.id) { cb.checked = true; if (pendingPlugin.style) pluginStyles[k.id] = pendingPlugin.style; }
    paint();
    return { k, cb, el: h('div', { class: 'np-plugin' }, card, kitStyles, skillRow, gallery) };
  });
  pendingPlugin = undefined;

  /* ── provedores (perfil de executores): janela ilustrada ── */
  let providers: ProvidersChoice | undefined;
  const chainsNow = () => providers?.chains ?? (providers?.profileId ? (meta.profiles ?? []).find((p) => p.id === providers!.profileId)?.chains : undefined);
  const provBox = h('div', { class: 'card provbox', id: 'np-providers' });
  const routePlan = provBox;   // compatível com o nome antigo
  const paintRoutePlan = () => {
    const r = meta.routes.find((x) => x.id === route.value);
    const eff = effectiveByCategory(r, chainsNow());
    const tiles = CATEGORIES.filter((k) => eff[k].steps.length || eff[k].locked.length).map((k) => {
      const b = eff[k].binding ?? eff[k].locked[0]?.bindings[0];
      const art = b ? bindingArt(b) : undefined;
      return h('div', { class: 'pmini', 'data-cat': k, title: [...eff[k].steps, ...eff[k].locked].map((s) => s.label).join(', ') },
        h('span', { class: 'picon' }, CATEGORY_INFO[k].icon),
        h('span', { class: 'ptxt' }, h('strong', {}, CATEGORY_INFO[k].label), h('span', { class: 'muted' }, ...(art ? [artIcon(art.icon), ` ${art.title} · ${art.sub}`] : ['—']))));
    });
    provBox.replaceChildren(
      h('div', { class: 'row' }, h('strong', {}, '🎛 Provedores'), h('span', { class: `tag${providers ? ' done' : ''}`, id: 'np-prov-label' }, providers?.label ?? 'Como a rota define'), helpButton('providers', '❔'), h('span', { class: 'sp' }),
        h('button', { class: 'small', title: 'Criar e editar perfis de provedores', onclick: () => go('providers') }, 'Gerenciar perfis'),
        h('button', { id: 'np-prov-open', disabled: !r, onclick: () => void openProvidersModal({ forge: forge as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>, toast, language: lang.value }, {
          route: r, current: providers, onPick: async (ch) => { providers = ch; meta.profiles = (await forge.meta()).profiles; paintRoutePlan(); },
        }) }, 'Escolher provedores…')),
      r ? h('div', { class: 'pminis' }, ...tiles) : h('div', { class: 'muted' }, 'Escolha uma rota para ver quem executa cada parte.'),
      r && providers?.steps ? h('div', { class: 'pchips', id: 'np-steps' }, h('span', { class: 'muted' }, '⚖ Por etapa: '), ...r.steps.filter((st) => providers!.steps![st.id]).map((st) => h('span', { class: 'chip' }, `${st.label} → ${bindingArt(providers!.steps![st.id]!).title}${(providers!.steps![st.id] as { model?: string }).model ? ` (${(providers!.steps![st.id] as { model?: string }).model})` : ''}`))) : '');
    paintVoice();
  };

  /* ── elenco (skills com várias vozes) ── */
  let cast: CastMember[] = [];
  /* voz da narração deste projeto (OmniVoice/Wan2GP: arquivo da pasta voices; API: voz do provedor) */
  const npCatalog = ((await guard(() => (forge as unknown as Record<string, () => Promise<unknown>>)['catalog']!())) ?? { apis: [] }) as { apis: Parameters<typeof voicePicker>[0]['apis'] };
  let npVoice: NarrationVoice = {};
  /* motor da narração escolhido aqui (modelo local ou API/modelo): vira o executor da etapa de narração */
  let npEngine: Binding | undefined;
  const voiceBox = voicePicker({ forge: forge as unknown as Parameters<typeof voicePicker>[0]['forge'], guard, route: undefined, language: 'pt-BR', value: npVoice, onChange: (v) => { npVoice = v; },
    voices: meta.voices ?? [], apis: npCatalog.apis, onEngine: (b) => { npEngine = b; } }) as HTMLElement & { repaint: (r?: Route, l?: string) => void };
  /* a voz segue a rota JÁ com o perfil/provedores escolhidos (a narração pode ter mudado de motor) */
  const effectiveRoute = (): Route | undefined => {
    const r = meta.routes.find((x) => x.id === route.value);
    if (!r) return undefined;
    const prof = providers?.profileId ? (meta.profiles ?? []).find((p) => p.id === providers!.profileId) : undefined;
    let eff = applyExecutorProfile(r, prof);
    if (providers?.chains) eff = applyExecutorProfile(eff, { id: 'projeto', name: 'Só neste projeto', chains: providers.chains });
    return applyStepBindings(eff, providers?.steps);
  };
  const paintVoice = () => voiceBox.repaint(effectiveRoute(), lang.value);
  route.addEventListener('change', paintVoice); lang.addEventListener('change', paintVoice);
  const castBox = h('div', { class: 'card', id: 'np-cast' });
  const paintCast = () => {
    const k = skills.find((x) => x.id === skill.value);
    castBox.style.display = k?.multiVoice ? '' : 'none';
    if (!k?.multiVoice) return;
    const voices = meta.voices ?? [];
    castBox.replaceChildren(h('h3', {}, '🎭 Elenco (uma voz por personagem)'),
      h('div', { class: 'muted' }, 'Cada cena tem um "speaker". A voz de referência (OmniVoice) dá o timbre do personagem; a voz da API é usada quando a narração cai para a API. Personagens fora da lista usam a voz padrão da rota.'),
      ...cast.map((m, i) => {
        const nm = h('input', { value: m.speaker, placeholder: 'Nome do personagem', 'data-field': 'cast-name' }) as HTMLInputElement;
        nm.addEventListener('input', () => { m.speaker = nm.value; });
        const ref = h('select', { 'data-field': 'cast-ref' }, h('option', { value: '' }, '(voz padrão da rota)'), ...voices.map((v) => h('option', { value: v.path }, '🗣 ' + v.name))) as HTMLSelectElement;
        ref.value = m.refAudio ?? ''; ref.addEventListener('change', () => { m.refAudio = ref.value || undefined; });
        const api = h('input', { value: m.voice ?? '', placeholder: 'voz da API (ex.: nova)', class: 'num', 'data-field': 'cast-voice' }) as HTMLInputElement;
        api.addEventListener('input', () => { m.voice = api.value.trim() || undefined; });
        const ds = h('input', { value: m.description ?? '', placeholder: 'Aparência fixa (ex.: mulher, 30 anos, casaco vermelho)', class: 'grow', 'data-field': 'cast-desc' }) as HTMLInputElement;
        ds.addEventListener('input', () => { m.description = ds.value.trim() || undefined; });
        return h('div', { class: 'row castrow' }, h('span', { class: 'picon' }, '🎭'), nm, ref, api, ds, h('button', { class: 'small danger', onclick: () => { cast.splice(i, 1); paintCast(); } }, '✕'));
      }),
      h('button', { id: 'np-cast-add', onclick: () => { cast.push({ speaker: '' }); paintCast(); } }, '＋ Personagem'));
  };

  /* ── campos de música: só aparecem em rotas de música ── */
  const musicBox = h('div', { id: 'np-music' });
  const paintMusic = () => {
    const r = meta.routes.find((x) => x.id === route.value);
    const clip = routeHasTool(r, 'clip-musical'), lyric = routeHasTool(r, 'lyric-song');
    musicBox.style.display = clip || lyric ? '' : 'none';
    musicMode.parentElement && (musicMode.parentElement.style.display = clip ? '' : 'none');
    waveform.parentElement && (waveform.parentElement.style.display = clip ? '' : 'none');
    const row = document.getElementById('np-music-len'); if (row) row.style.display = clip ? '' : 'none';
  };

  const showSkill = () => {
    const k = skills.find((x) => x.id === skill.value);
    if (!k) { info.replaceChildren(h('span', { class: 'muted' }, 'Escolha uma skill para ver o resumo e como será o vídeo de saída.')); return; }
    const r = meta.routes.find((x) => x.id === route.value);
    const sug = k.routeId ? meta.routes.find((x) => x.id === k.routeId)?.name ?? k.routeId : '';
    const media = k.previewMedia ?? previews[k.id];
    let mediaEl: HTMLElement;
    if (!media) mediaEl = h('div', { class: `skillmedia anim a-${k.appearance ?? 'custom'}` }, h('span', {}, k.name));
    else if (/\.(mp4|webm|mov)$/i.test(media)) {
      // demonstração da skill toca SEM áudio (propriedade, não só atributo: o atributo não silencia em todos os casos)
      const v = h('video', { class: 'skillmedia', src: forge.mediaUrl(media), autoplay: true, loop: true, playsinline: true, title: 'Demonstração da skill (sem áudio)' });
      v.muted = true; v.volume = 0; v.defaultMuted = true; v.disablePictureInPicture = true;
      mediaEl = v;
    } else mediaEl = h('img', { class: 'skillmedia', src: forge.mediaUrl(media), alt: k.name });
    const vtDef = meta.videoTypes.find((v) => v.id === k.appearance);
    const rep = checkSkillRoute(k, r, vtDef?.sceneKind, k.routeId ? meta.routes.find((x) => x.id === k.routeId) : undefined);
    const compat = r ? h('div', { class: 'compat', id: 'np-compat' },
      ...rep.errors.map((e) => h('div', { class: 'tag failed' }, '⛔ ' + e)),
      ...rep.warnings.map((e) => h('div', { class: 'tag running' }, '⚠ ' + e)),
      ...rep.ok.map((e) => h('div', { class: 'tag done' }, '✓ ' + e)),
      (rep.errors.length || rep.warnings.length) && k.routeId && k.routeId !== r.id
        ? h('button', { class: 'small', id: 'np-use-suggested', onclick: () => { route.value = k.routeId!; route.dispatchEvent(new Event('change')); } }, `Usar a rota sugerida da skill`) : null) : null;
    info.replaceChildren(h('div', { class: 'skillrow' }, mediaEl, h('div', { class: 'grow' },
      h('div', { class: 'row' }, h('strong', {}, k.name), k.builtin ? h('span', { class: 'tag' }, '🔒 padrão') : h('span', { class: 'tag done' }, 'minha'),
        k.freeform ? h('span', { class: 'tag running' }, 'vídeo livre') : null,
        k.presentation === 'mixed' ? h('span', { class: 'tag' }, 'misto: ' + (k.mixSources ?? ['motion', 'stock']).map((m) => MIX_INFO[m]?.[0] ?? m).join(' + ')) : null),
      h('p', { class: 'summary' }, k.description),
      h('h4', {}, 'Como será o vídeo de saída'),
      h('pre', { class: 'outstyle', id: 'np-output-style' }, k.outputStyle || k.global || '(esta skill não descreve o estilo de saída)'),
      h('div', { class: 'muted' }, `Padrões: ${k.aspect ?? '—'} · ≈ ${k.durationSec ?? '—'}s${sug ? ' · rota sugerida: ' + sug : ''}`),
      ...(r ? [h('div', { class: 'muted' }, `Rota escolhida: ${r.name} — ${r.description}`)] : []),
      compat)));
  };
  skill.addEventListener('change', () => {
    const k = skills.find((x) => x.id === skill.value);
    if (k) {
      if (k.aspect) aspect.value = k.aspect;
      if (k.durationSec) dsec.value = String(k.durationSec);
      lang.value = k.language ?? 'pt-BR';
      if (k.routeId && meta.routes.some((r) => r.id === k.routeId)) route.value = k.routeId;
      ideaLbl.textContent = k.freeform ? 'Prompt (vai direto ao harness pela rota "Vídeo livre"; nada de roteiro, cenas ou narração)' : 'Ideia / prompt simples (o sistema acrescenta a skill, os estilos, o idioma e as referências)';
      for (const x of workerBoxes) if (x.a.skills?.includes(k.id)) x.cb.checked = true;
      const so = agents.find((a) => a.role === 'orchestrator' && a.skills?.includes(k.id)); if (so) orch.value = so.id;
    }
    showSkill(); paintTeam(); paintCast(); paintRoutePlan(); paintMusic(); paintVoice();
  });
  route.addEventListener('change', showSkill);
  /* a rota mudou: as escolhas por etapa eram da rota anterior */
  route.addEventListener('change', () => { if (providers?.steps) { providers = { ...providers, steps: undefined, label: providers.label.replace(/ \+ \d+ etapa.*$/, '') }; } });
  route.addEventListener('change', paintRoutePlan);
  route.addEventListener('change', paintMusic);
  showSkill(); paintTeam(); paintRoutePlan(); paintCast();

  /* motor de voz escolhido no painel de voz → executor da etapa de narração (vence perfil e categorias) */
  const withNarrationEngine = (): Record<string, Binding> | undefined => {
    const narrId = meta.routes.find((x) => x.id === route.value)?.steps.find((st) => st.kind === 'narration' && st.enabled)?.id;
    if (!npEngine || !narrId) return providers?.steps;
    const b = JSON.parse(JSON.stringify(npEngine)) as Binding;
    if (b.type === 'api' && npVoice.apiVoice) b.voice = npVoice.apiVoice;
    if ((b.type === 'comfyui' || b.type === 'wan2gp') && npVoice.refAudio) (b as { refAudio?: string }).refAudio = npVoice.refAudio;
    return { ...(providers?.steps ?? {}), [narrId]: b };
  };
  const build = () => {
    /* roteiro importado "como está": a ideia pode ficar vazia (o roteiro já diz do que trata o vídeo) */
    if (scriptUse.checked && refScript && !idea.value.trim()) idea.value = `Vídeo a partir do roteiro importado (${basename(refScript)})`;
    if (!name.value.trim() || !idea.value.trim()) throw new Error('Informe nome e ideia/prompt.');
    if (!skill.value) throw new Error('Escolha uma skill (tipo de vídeo).');
    if (!route.value) throw new Error('Escolha uma rota.');
    return {
      name: name.value.trim(), idea: idea.value.trim(), videoType: 'custom', skillId: skill.value, routeId: route.value,
      aspect: aspect.value, targetDurationSec: Number(dsec.value) || 60, quality: quality.value, profile: profile.value, language: lang.value,
      freeEngine: npFreeEngine.value === '2d' || npFreeEngine.value === '3d' ? npFreeEngine.value : undefined,
      thumbnailTemplate: thumbId || undefined, scriptStyle: scriptStyle.value.trim() || undefined, videoStyle: videoStyle.value.trim() || undefined,
      musicStyle: musicStyle.value.trim() || undefined, musicMode: musicMode.value as 'instrumental' | 'song', musicMinMin: Number(musMin.value) || undefined, musicMaxMin: Number(musMax.value) || undefined, musicTrackSec: Number(musTrack.value) || undefined, waveform: waveform.value as 'line' | 'bar' | 'p2p' | 'cline' | 'dot',
      refScriptFile: refScript, refVideoFile: refVideo, refScriptUse: !!refScript && scriptUse.checked, attachFiles: attachFiles.length ? [...attachFiles] : undefined,
      subtitles: subsSel.value as 'off' | 'srt' | 'burn', audioFirst: audioFirstCb.checked, codeMusic: codeMusicCb.checked || undefined,
      maxProductionMin: noLimit.checked ? 0 : Number(maxMin.value) || 0, sceneConcurrency: Math.max(1, Math.min(8, Number(conc.value) || 1)),
      orchestratorId: orch.value || undefined, workerIds: workerBoxes.filter((x) => x.cb.checked).map((x) => x.a.id),
      plugins: pluginBoxes.filter((x) => x.cb.checked).map((x) => x.k.id),
      pluginStyles: Object.fromEntries(Object.entries(pluginStyles).filter(([id]) => pluginBoxes.some((x) => x.k.id === id && x.cb.checked))),
      executorProfile: providers?.profileId, executorChains: providers?.chains, executorSteps: withNarrationEngine(),
      /* igual às Configurações = não grava no projeto (continua seguindo o padrão se ele mudar) */
      harnessFallback: npFallback.length && JSON.stringify(npFallback) !== JSON.stringify(cfg?.harnessFallback ?? []) ? npFallback as never : undefined,
      noFallback: npNoFallback !== !!cfg?.noFallback ? npNoFallback : undefined,
      cast: cast.filter((m) => m.speaker.trim()),
      narrationVoice: npVoice.refAudio || npVoice.apiVoice ? npVoice : undefined,
      autoUpload: autoUp.checked ? { visibility: 'UNLISTED' } : undefined,
      agyAccount: agySel.value || undefined,
      flowAccount: flowSel.value || undefined,
      channelId: chSel.value || undefined,
      foldId: formFold?.id,
      /* título escolhido nas sugestões: se o nome foi editado depois, vale só a estrutura */
      titleModel: titlePick ? { source: titlePick.source, pattern: titlePick.pattern, chosen: name.value.trim() === titlePick.title ? titlePick.title : undefined, thumbText: titlePick.thumbText } : undefined,
    };
  };
  const make = async () => {
    const input = build();
    void autoUp;
    if (input.refScriptFile || input.refVideoFile) toast('Preparando arquivos de referência (transcrição/quadros)…');
    const p = await forge.createProject(input);
    if (input.routeId && p.routeId !== input.routeId) {
      toast(`Rota ajustada para "${p.route?.name ?? p.routeId}": a skill escolhida gera cenas e a rota anterior não tinha a etapa "Planejar cenas".`, true);
    }
    for (const n of [p.refScript?.note, p.refVideo?.note]) if (n) toast('Referência: ' + n, true);
    return p;
  };
  const create = h('button', { class: 'primary', id: 'np-create', onclick: () => void guard(async () => { current = await make(); selected = []; go('editor'); }) }, 'Criar projeto');
  const createQ = h('button', { id: 'np-create-queue', onclick: () => void guard(async () => {
    const p = await make(); enqueue([p.id]); (name as HTMLInputElement).value = ''; (idea as HTMLTextAreaElement).value = ''; toast(`"${p.name}" criado e colocado no lote`);
  }) }, '＋ Criar e pôr no lote');
  const createRun = h('button', { id: 'np-create-run', onclick: () => void guard(async () => { const p = await make(); runProject(p.id, p.name); }) }, '▶ Criar e executar');

  main.replaceChildren(h('h2', {}, 'Novo projeto'),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Nome / título do vídeo', name),
        h('button', { id: 'np-titles', title: 'Títulos no padrão de um canal clonado, canal ou vídeo', onclick: () => void openTitleModal(idea.value || name.value, lang.value, (p) => { titlePick = p; (name as HTMLInputElement).value = p.title; paintTitle(); }) }, '💡 Sugerir títulos')),
      titleBox,
      h('label', {}, ideaLbl, idea),
      h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Skill (tipo de vídeo) *', skill), h('label', { class: 'grow' }, 'Rota *', route)),
      info,
      foldBox,
      routePlan,
      voiceBox,
      castBox,
      h('h3', {}, 'Estilo e referências (opcionais)'),
      h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Estilo de roteiro', scriptStyle), h('label', { class: 'grow' }, 'Estilo de vídeo', videoStyle)),
      (musicBox.replaceChildren(
        h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Estilo musical (clipe musical / lyric video)', musicStyle)),
        h('div', { class: 'row' }, h('label', {}, 'Música', musicMode), h('label', {}, 'Waveform', waveform)),
        h('div', { class: 'row', id: 'np-music-len', title: 'Instrumental + geração local usa o workflow YuE 2 instrumental (LoRA, sem voz).' }, h('label', {}, 'Coletânea: mínimo (min)', musMin), h('label', {}, 'máximo (min)', musMax), h('label', {}, 'cada faixa (s)', musTrack), musInfo)), musicBox),
      h('div', { class: 'row' },
        h('div', { class: 'grow refbox' }, h('strong', {}, 'Roteiro (importar)'), h('div', { class: 'muted' }, 'Texto, legenda ou um vídeo/áudio (transcrito pelo Whisper). Por padrão a IA só adapta o ESTILO dele; marque abaixo para usar o texto como o roteiro deste vídeo.'), h('div', { class: 'row' }, pickScript, scriptBox),
          h('label', { class: 'inline chk', title: 'A etapa de roteiro grava o seu texto sem IA; o plano de cenas divide a fala literalmente' }, scriptUse, '📜 Usar como o roteiro do vídeo (sem reescrever)')),
        h('div', { class: 'grow refbox' }, h('strong', {}, 'Vídeo de referência'), h('div', { class: 'muted' }, 'Inspira o vídeo final: paleta, composição, ritmo de cortes e movimento (os harnesses recebem quadros-chave).'), h('div', { class: 'row' }, pickVideo, videoBox))),
      h('div', { class: 'row' },
        h('div', { class: 'grow refbox' }, h('strong', {}, '📎 Arquivos para o vídeo'),
          h('div', { class: 'muted' }, 'Imagens, vídeos, áudios, textos ou uma pasta inteira. Entram no prompt e na produção: imagens e vídeos podem virar cenas, um áudio vira a trilha, textos guiam o roteiro. No editor dá para dizer como usar cada um (ex.: foto de um personagem).'),
          h('div', { class: 'row' }, pickAttachFiles, pickAttachFolder, attachBox))),
      h('h3', {}, 'Formato e thumbnail'),
      h('div', { class: 'row' }, h('label', {}, 'Formato', aspect), h('label', {}, 'Duração (s)', dsec), h('label', {}, 'Idioma do vídeo', lang)),
      thumbBox,
      h('label', { title: 'As etapas com Antigravity deste projeto rodam na sessão desta conta (faça o login dela em Automações → 🪐 Login no Antigravity)' }, '🪐 Conta do Antigravity', agySel),
      h('label', { title: 'Etapas do Google Flow deste projeto usam esta conta (vence a conta escolhida na etapa da rota)' }, '🌊 Conta do Flow', flowSel),
      h('label', { title: 'Canal de destino (aba Canais). Ao publicar, o vídeo vai para ele — a conta e a marca vêm do canal.' }, '📺 Canal de destino', chSel),
      h('label', { class: 'inline chk', title: 'Acrescenta à rota a etapa "Enviar ao YouTube": ao terminar, o vídeo vai como NÃO LISTADO com título, descrição e thumbnail do SEO (conta Google das Automações)' }, autoUp, '⬆ Enviar ao YouTube ao terminar (não listado)'),
      h('h3', {}, 'Produção'),
      h('div', { class: 'row' },
        h('label', { title: 'Uma execução é interrompida ao atingir este tempo (o que já foi gerado fica em cache).' }, 'Tempo máximo (min)', h('span', { class: 'row' }, maxMin, noLimit.parentElement!)),
        h('label', { title: 'Quantas cenas avançam ao mesmo tempo pelas etapas. GPU local continua uma cena por vez por etapa.' }, 'Cenas simultâneas', conc),
        h('label', { title: 'Legendas do que se fala. Dá para mudar depois no editor (cartão "Legendas") e renderizar de novo, sem refazer as cenas.' }, 'Legendas', subsSel),
        h('label', { class: 'inline chk', title: 'Gera a narração e a transcrição de TODAS as cenas primeiro (rápido, em paralelo) e depois os clipes. A duração total sai logo e a GPU local não alterna entre o modelo de voz e o de vídeo a cada cena.' }, audioFirstCb, '🎙 Narrar todas as cenas primeiro'),
        h('label', { class: 'inline chk', title: 'Trilha sintetizada por código, sem IA e offline, com a duração exata do vídeo e o clima da skill. Vale para qualquer rota; a trilha da rota fica de reserva.' }, codeMusicCb, '🎼 Trilha por código'),
        h('label', { title: 'standard: normal · depth/polished: +1 tentativa · verified: + revisão com nota · ultra: revisão + refaz cenas fracas automaticamente' }, 'Qualidade', quality),
        h('label', { title: FREE_ENGINE_TIP }, '🎞 Vídeo livre', npFreeEngine),
        h('div', { class: 'grow', title: 'Se o provedor de uma etapa falhar (ex.: Ollama), estes assumem, na ordem dos cliques. Começa com as reservas padrão das Configurações → Provedores.' },
          h('div', { class: 'muted small' }, '🛟 Reservas se o provedor falhar'), npFallbackBox),
        h('label', { title: 'Reordena as reservas de cada tarefa (os provedores principais são escolhidos em "Provedores")' }, 'Ordem das reservas', profile)),
      h('h3', {}, 'Equipe de agentes (opcional)'),
      h('div', { class: 'row' }, h('label', {}, 'Orquestrador', orch), h('div', { class: 'grow' }, h('div', { class: 'muted' }, '🛠️ Obreiros e 🔎 revisores (marque quantos quiser)'), h('div', { class: 'np-agents' }, ...workerBoxes.map((x) => x.el)))),
      teamInfo,
      pluginList.length
        ? h('div', {}, h('h3', {}, 'Plugins (opcional)'),
          h('div', { class: 'muted' }, 'Plugins no formato do Claude (instruções/skills/comandos/agentes). O conteúdo deles entra no prompt de todas as etapas — é isso que muda o resultado final. Instale e veja os estilos na aba Plugins.'),
          h('div', { class: 'row', id: 'np-plugins' }, ...pluginBoxes.map((x) => x.el)))
        : h('div', {}, h('h3', {}, 'Plugins (opcional)'),
          h('div', { class: 'muted' }, 'Nenhum plugin instalado. Na aba Plugins você instala de uma pasta ou de uma URL do GitHub (formato Claude ou coleção de prompts de estilo).')),
      h('div', { class: 'row actions' }, create, createQ, createRun)));
  paintMusic();
  if (pendingSkill && Array.from(skill.options).some((o) => o.value === pendingSkill)) { skill.value = pendingSkill; skill.dispatchEvent(new Event('change')); }
  pendingSkill = undefined;
  if (pendingFold) {
    const wanted = pendingFold;
    pendingFold = undefined;
    void guard(() => forge.listFolds()).then((list) => {
      const f = (list as Array<{ id: string; name: string; angle?: string; skillId?: string }>).find((x) => x.id === wanted);
      if (!f) return;
      formFold = { id: f.id, name: f.name, angle: f.angle };
      if (f.skillId && Array.from(skill.options).some((o) => o.value === f.skillId)) { skill.value = f.skillId!; skill.dispatchEvent(new Event('change')); }
      paintFold();
    }).catch(() => {});
  }
}

/* ───────── aba Lote ───────── */
function refreshQueue() { const el = $('#queue'); if (el) el.replaceWith(queueCard()); }
function queueCard(): HTMLElement {
  queue = queue.filter((id) => lastList.some((p) => p.id === id));
  saveQueue();
  const busyNow = batchRunning();
  const byId = (id: string) => lastList.find((p) => p.id === id)!;
  const move = (i: number, to: number) => { const j = Math.max(0, Math.min(queue.length - 1, to)); if (j === i) return; const [it] = queue.splice(i, 1); queue.splice(j, 0, it!); saveQueue(); refreshQueue(); };
  const conc = h('input', { type: 'number', value: String(queueConc), min: '1', max: '4', id: 'b-conc' });
  conc.addEventListener('input', () => { queueConc = Math.max(1, Math.min(4, Number(conc.value) || 1)); });
  const trs = queue.map((id, i) => {
    const p = byId(id); const st = queueStatus.get(id);
    return h('tr', { 'data-q': id },
      h('td', { class: 'muted' }, String(i + 1)),
      h('td', {}, frameCell(p)),
      h('td', {}, h('strong', {}, p.name), h('div', { class: 'muted' }, [p.skillName ?? p.videoType, p.routeName].filter(Boolean).join(' · '))),
      h('td', {}, st?.s === 'run' ? h('span', { class: 'tag running' }, 'executando') : st?.s === 'ok' ? h('span', { class: 'tag done' }, 'concluído')
        : st?.s === 'fail' ? h('span', { class: 'tag failed', title: st.err ?? '' }, 'erro' + (st.err ? ': ' + st.err.slice(0, 80) : '')) : h('span', { class: 'tag' }, 'na fila')),
      h('td', { class: 'muted' }, p.totalMs ? fmtMs(p.totalMs) : '—'),
      h('td', {}, h('div', { class: 'acts' },
        h('button', { class: 'q-top', title: 'Prioridade máxima (topo)', disabled: busyNow || i === 0, onclick: () => move(i, 0) }, '⤒'),
        h('button', { class: 'q-up', title: 'Aumentar prioridade', disabled: busyNow || i === 0, onclick: () => move(i, i - 1) }, '▲'),
        h('button', { class: 'q-down', title: 'Diminuir prioridade', disabled: busyNow || i === queue.length - 1, onclick: () => move(i, i + 1) }, '▼'),
        h('button', { class: 'q-bottom', title: 'Prioridade mínima (fim)', disabled: busyNow || i === queue.length - 1, onclick: () => move(i, queue.length - 1) }, '⤓'),
        h('button', { class: 'q-run', title: 'Executar só este agora', disabled: busyNow || p.running, onclick: () => runProject(id, p.name) }, '▶'),
        h('button', { class: 'danger q-del', title: 'Tirar do lote', disabled: busyNow && st?.s === 'run', onclick: () => { queue = queue.filter((x) => x !== id); queueStatus.delete(id); saveQueue(); refreshQueue(); } }, '✕'))));
  });
  const pending = () => queue.filter((id) => queueStatus.get(id)?.s !== 'ok');
  const addable = lastList.filter((p) => !queue.includes(p.id));
  const addSel = h('select', { id: 'b-add-sel' }, h('option', { value: '' }, addable.length ? '— projeto para adicionar —' : '(todos já estão no lote)'), ...addable.map((p) => h('option', { value: p.id }, p.name))) as HTMLSelectElement;
  return h('div', { id: 'queue' },
    h('div', { class: 'row' },
      h('button', { class: 'primary', id: 'b-run', disabled: busyNow, onclick: () => void guard(async () => {
        const ids = pending(); if (!ids.length) throw new Error('Nada pendente no lote.');
        ids.forEach((id) => queueStatus.delete(id));
        toast(`Lote iniciado (${ids.length})`);
        void forge.runBatch(ids, queueConc).then((jobs) => {
          for (const j of jobs) { if (j.ok === undefined) queueStatus.delete(j.id); else queueStatus.set(j.id, j.ok ? { s: 'ok' } : { s: 'fail', err: j.error }); }
          if (tab === 'batch') void render();
        }).catch((e) => toast((e as Error).message, true));
        refreshQueue();
      }) }, '▶ Executar lote'),
      h('label', {}, 'Simultâneos', conc),
      h('button', { class: 'danger', id: 'b-cancel', onclick: () => void forge.cancelBatch() }, 'Cancelar lote'),
      h('button', { id: 'b-retry', onclick: () => { [...queueStatus].forEach(([id, v]) => { if (v.s === 'fail') queueStatus.delete(id); }); refreshQueue(); } }, 'Reenfileirar com erro'),
      h('button', { id: 'b-clear-done', disabled: busyNow, onclick: () => { queue = queue.filter((id) => queueStatus.get(id)?.s !== 'ok'); [...queueStatus].forEach(([id, v]) => { if (v.s === 'ok') queueStatus.delete(id); }); saveQueue(); refreshQueue(); } }, 'Limpar concluídos'),
      h('button', { id: 'b-clear-all', disabled: busyNow, onclick: () => { queue = []; queueStatus.clear(); saveQueue(); refreshQueue(); } }, 'Esvaziar lote')),
    h('div', { class: 'row' }, addSel, h('button', { id: 'b-add', onclick: () => { if (addSel.value) { enqueue([addSel.value]); void render(); } } }, '＋ Adicionar ao lote'),
      busyNow ? h('span', { class: 'muted' }, 'Lote em execução: a ordem e a lista ficam travadas (use "Cancelar lote" para parar).') : h('span', { class: 'muted' }, 'A ordem da lista é a prioridade: o item 1 roda primeiro.')),
    queue.length ? h('table', { id: 'qtable' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Frame'), h('th', {}, 'Projeto'), h('th', {}, 'Status'), h('th', {}, 'Tempo de geração'), h('th', {}, 'Prioridade / ações'))), h('tbody', {}, ...trs))
      : h('p', { class: 'muted' }, 'Lote vazio — adicione projetos acima, pelo botão "＋ Lote" na aba Projetos ou por "Criar e pôr no lote" em Novo projeto.'));
}
async function renderBatch() {
  lastList = (await guard(() => forge.listProjects())) ?? [];
  main.replaceChildren(h('h2', {}, 'Lote'), h('p', { class: 'muted' }, 'Fila de projetos executados em sequência (ou em paralelo, conforme "Simultâneos"). Aumente ou diminua a prioridade, remova itens e execute tudo com um botão.'),
    queueCard(), h('div', { id: 'batchbar', class: 'muted' }));
  updateBatchBar();
}

/* ───────── aba Editor (estilo CapCut) ───────── */
let preview: { v?: HTMLVideoElement; i?: HTMLImageElement; a?: HTMLAudioElement; x?: HTMLAudioElement; label?: HTMLElement } = {};
let playing = false;
/** Legendas sobrepostas na prévia: desligadas por padrão (botão CC liga). */
let showSubs = false;
const FX_FILTERS: Array<[string, string]> = [['none', 'Nenhum'], ['cinematic', 'Cinematográfico'], ['teal_orange', 'Teal & orange'], ['vintage', 'Vintage'], ['matte', 'Matte'], ['dramatic', 'Dramático'],
  ['vivid', 'Vívido'], ['warm', 'Quente'], ['cool', 'Frio'], ['noir', 'Noir'], ['bw', 'Preto e branco'], ['sepia', 'Sépia'], ['blur', 'Desfoque']];
const FX_ZOOM: Array<[string, string]> = [['none', 'Sem movimento'], ['in', 'Zoom in (Ken Burns)'], ['out', 'Zoom out'], ['pan_left', 'Pan para a esquerda'], ['pan_right', 'Pan para a direita'],
  ['pan_up', 'Pan para cima'], ['pan_down', 'Pan para baixo'], ['in_left', 'Zoom in + esquerda'], ['in_right', 'Zoom in + direita']];
const sceneStart = (p: Project, idx: number) => p.scenes.slice(0, idx).reduce((a, s) => a + dur(s), 0);
const fmtTc = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const subStyle = (p: Project): NonNullable<Project['subtitleStyle']> => p.subtitleStyle ?? { burn: false, position: 'bottom' as const, size: 46, color: '#ffffff', box: true };
/** Tipos de legenda (iguais aos do .ass gerado na montagem). */
const SUB_KINDS: Array<[string, string]> = [['classic', 'Clássica (contorno)'], ['box', 'Tarja (fundo escuro)'], ['bold', 'Shorts (caixa alta, palavra em destaque)'],
  ['karaoke', 'Karaokê (preenche no tempo da fala)'], ['word', 'Palavra por palavra (pop)'], ['neon', 'Neon (brilho colorido)'], ['minimal', 'Minimalista (pequena, sombra)']];

/** Aplica efeitos e legenda da cena na prévia (CSS), espelhando o que a montagem faz no ffmpeg. */
function decorate(el: HTMLElement, sc: Scene) {
  const e = sc.effects;
  el.classList.add('fxm');
  if (e?.filter && e.filter !== 'none') el.classList.add(`fx-${e.filter}`);
  if (e?.zoom && e.zoom !== 'none') { el.classList.add(`kb-${e.zoom}`); el.style.animationDuration = `${dur(sc)}s`; }
  if (e?.fadeIn) el.classList.add('fade-in');
}

function showScene(sc: Scene | undefined, autoplay = false, enter?: { kind: string; sec: number }) {
  const box = $('#pv-stage'); if (!box || !current) return;
  box.replaceChildren();
  preview = {};
  if (!sc) { box.append(h('div', { class: 'muted pad' }, current.scenes.length ? 'Selecione uma cena na timeline.' : 'Projeto sem cenas.')); return; }
  const vis = pickVisual(sc);
  /* camada da cena: recebe a transição de entrada (prévia aproximada do xfade) */
  const layer = h('div', { class: `pv-layer${enter ? ' tr-' + enter.kind : ''}` });
  if (enter) layer.style.animationDuration = `${enter.sec}s`;
  box.append(layer);
  if (vis?.video) { const v = h('video', { src: forge.mediaUrl(vis.path), loop: true, playsinline: true }); v.muted = true; v.volume = 0; decorate(v, sc); preview.v = v; layer.append(v); if (autoplay) void v.play().catch(() => {}); }
  else if (vis) { const i = h('img', { src: forge.mediaUrl(vis.path), alt: sc.title }); decorate(i, sc); preview.i = i; layer.append(i); }
  else layer.append(h('div', { class: 'muted pad' }, 'Sem mídia gerada para esta cena ainda. Use ▶ Executar rota ou ↻ Regenerar etapa.'));
  const fe = current.finalEffects;
  /* filtro e vinheta = trechos da timeline ativos no início desta cena */
  const at = sceneStart(current, current.scenes.indexOf(sc)) + 0.01, tot = totalOf(current);
  for (const v of segsAt(current.fxSegments, 'vignette', at, tot)) layer.append(h('div', { class: `vig vig-${v}` }));
  const flts = segsAt(current.fxSegments, 'filter', at, tot).map((v) => FILTER_CSS[v]).filter(Boolean);
  if (flts.length) layer.style.filter = flts.join(' ');
  if (fe?.grain) layer.append(h('div', { class: 'grain' }));
  if (fe?.letterbox) layer.append(h('div', { class: 'lbox' }));
  const au = pickAudio(sc);
  if (au) { const a = h('audio', { src: forge.mediaUrl(au) }); preview.a = a; box.append(a); if (autoplay) void a.play().catch(() => {}); }
  /* efeitos sonoros da cena tocam junto com a narração */
  const fxa = byName(sc, 'sfx.wav');
  if (fxa) { const x = h('audio', { src: forge.mediaUrl(fxa) + '?v=' + Date.now() }); x.volume = Math.min(1, current.sfxVolume ?? 0.15); preview.x = x; box.append(x); if (autoplay) void x.play().catch(() => {}); }
  const st = subStyle(current);
  const text = sc.subtitle?.trim() || sc.narration;
  if (showSubs && text) {
    /* prévia do tipo: shorts/palavra = caixa alta e poucas palavras; karaokê/shorts = 1ª palavra na cor de destaque */
    const kind = st.kind ?? (st.box ? 'box' : 'classic'), words = text.split(/\s+/).filter(Boolean);
    const shown = kind === 'word' ? words.slice(0, 1) : kind === 'bold' ? words.slice(0, 3) : words;
    const cap = h('div', { class: `cap pos-${st.position} k-${kind}${kind === 'box' ? ' box' : ''}` },
      ...shown.map((w, i) => h('span', { class: i === 0 && (kind === 'bold' || kind === 'karaoke') ? 'hl' : '' }, (kind === 'bold' || kind === 'word' ? w.toUpperCase() : w) + ' ')));
    cap.style.color = st.color; cap.style.setProperty('--accent', st.accent ?? (kind === 'neon' ? '#00e5ff' : '#ffe14d'));
    cap.style.fontSize = `${Math.max(10, Math.round(st.size * 0.3 * (kind === 'word' ? 1.6 : kind === 'bold' ? 1.25 : kind === 'minimal' ? 0.8 : 1)))}px`;
    box.append(cap);
  }
  box.append(h('div', { class: 'scnum' }, `${sc.index}/${current.scenes.length}`));
}

function setPlayhead(t: number) {
  cursorT = Math.max(0, t);
  const ph = $('#playhead'); if (ph) ph.style.left = `${t * pxPerSec}px`;
  const tc = $('#tc'); if (tc && current) tc.textContent = `${fmtTc(t)} / ${fmtTc(current.scenes.reduce((a, s) => a + dur(s), 0))}`;
}

async function playAll(from: number) {
  if (!current) return;
  const token = ++playToken;
  playing = true; paintTransport();
  const p = current;
  for (let i = Math.max(0, from); i < p.scenes.length; i++) {
    if (token !== playToken) return;
    const sc = p.scenes[i]!;
    selected = [sc.id]; anchor = sc.id;
    document.querySelectorAll('.clip').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset['id'] === sc.id));
    // transição de entrada = a transição escolhida na cena anterior
    const prevFx = i > from ? p.scenes[i - 1]?.effects : undefined;
    showScene(sc, true, prevFx?.transition && prevFx.transition !== 'none' ? { kind: prevFx.transition, sec: prevFx.transitionSec ?? 0.6 } : undefined);
    const t0 = performance.now(), base = sceneStart(p, i);
    let raf = 0;
    const tick = () => { if (token !== playToken) return; const a = preview.a; setPlayhead(base + Math.min(dur(sc), a && !a.paused ? a.currentTime : (performance.now() - t0) / 1000)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    await new Promise<void>((res) => {
      const a = preview.a;
      const t = window.setTimeout(res, dur(sc) * 1000 + 100);
      if (a) a.addEventListener('ended', () => { window.clearTimeout(t); res(); }, { once: true });
    });
    cancelAnimationFrame(raf);
  }
  if (token === playToken) { playing = false; paintTransport(); setPlayhead(p.scenes.reduce((a, s) => a + dur(s), 0)); }
}
function stopPlay() { playToken++; playing = false; preview.a?.pause(); preview.x?.pause(); preview.v?.pause(); paintTransport(); }

/** Reproduz SOMENTE a cena indicada (vídeo + narração), parando no fim dela. */
async function playScene(idx: number) {
  if (!current || !current.scenes[idx]) return;
  const token = ++playToken;
  playing = true; paintTransport();
  const p = current;
  const sc = p.scenes[idx]!;
  selected = [sc.id]; anchor = sc.id;
  document.querySelectorAll('.clip').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset['id'] === sc.id));
  showScene(sc, true);
  const t0 = performance.now(), base = sceneStart(p, idx);
  let raf = 0;
  const tick = () => {
    if (token !== playToken) return;
    const a = preview.a;
    setPlayhead(base + Math.min(dur(sc), a && !a.paused ? a.currentTime : (performance.now() - t0) / 1000));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  await new Promise<void>((res) => {
    const a = preview.a;
    const t = window.setTimeout(res, dur(sc) * 1000 + 150);
    if (a) a.addEventListener('ended', () => { window.clearTimeout(t); res(); }, { once: true });
  });
  cancelAnimationFrame(raf);
  if (token === playToken) { playing = false; paintTransport(); }
}
const selIndex = () => current ? Math.max(0, current.scenes.findIndex((s) => s.id === selected[0])) : 0;
function jump(d: number) {
  if (!current || !current.scenes.length) return;
  const i = Math.max(0, Math.min(current.scenes.length - 1, selIndex() + d));
  if (playing) void playScene(i); else { selected = [current.scenes[i]!.id]; anchor = selected[0]; renderEditor(true); }
}
function paintTransport() {
  const b = $('#pv-play'); if (!b) return;
  b.replaceChildren(icon(playing ? 'pause' : 'play', true));
  b.classList.toggle('on', playing);
}

/** Seletor de efeitos sonoros da biblioteca (gerados por código): chips com prévia ▶ e campo avançado. */
function sfxPicker(initial: string[]): { el: HTMLElement; value: () => string[]; sync: () => boolean } {
  let list = [...initial];
  const sync = h('input', { type: 'checkbox', 'data-field': 'sfx-sync' }) as HTMLInputElement; sync.checked = true;
  const adv = h('input', { class: 'wide', 'data-field': 'sfx-adv', placeholder: 'Avançado: nome, nome@segundos ou nome:palavra — separados por vírgula' }) as HTMLInputElement;
  const grid = h('div', { class: 'sfxgrid' });
  let audio: HTMLAudioElement | undefined;
  const paint = () => {
    adv.value = list.join(', ');
    grid.replaceChildren(...sfxLib.map((d) => {
      const on = list.some((x) => x.split(/[@:]/)[0] === d.id);
      return h('div', { class: `sfxchip${on ? ' on' : ''}`, 'data-sfx': d.id, title: d.tags },
        h('button', { class: 'sfxplay', title: 'ouvir', onclick: () => void guard(async () => { audio?.pause(); audio = new Audio(forge.mediaUrl(await forge.sfxPreview(d.id))); await audio.play(); }) }, '▶'),
        h('button', { class: 'sfxtoggle', onclick: () => { list = on ? list.filter((x) => x.split(/[@:]/)[0] !== d.id) : [...list, d.id]; paint(); } }, `${d.icon} ${d.label}`));
    }));
  };
  adv.addEventListener('change', () => { list = adv.value.split(',').map((x) => x.trim()).filter(Boolean); paint(); });
  void loadSfxLib().then(paint);
  paint();
  return { el: h('div', { class: 'sfxpicker' },
    h('label', { class: 'inline chk tgl sfxsync' }, sync, '🎯 Sincronizar com o que acontece na cena (a IA lê o visual, o movimento, a animação e a fala e põe cada som no instante do evento). Sem sons marcados, a IA escolhe.'),
    h('p', { class: 'muted' }, 'Sons sintetizados pelo app (sem download nem API). Sem sincronizar: sem instante tocam no início da cena; "crunch:mastigar" toca quando a palavra é dita; "impact@2.5" aos 2,5 s.'), grid, adv),
    value: () => list, sync: () => sync.checked };
}

/** Aplica efeitos às cenas e regera a faixa de som delas: sincronizados pela IA com o visual, ou exatamente como escritos. */
async function applySceneSfx(p: Project, ids: string[], list: string[], sync: boolean) {
  if (sync) { const r = await forge.sfxFit(p.id, ids, { names: list }); current = r.project; return r.result; }
  for (const id of ids) current = (await forge.updateScene(p.id, id, { sfx: list }, false)).project;
  const r = await forge.sfxApply(p.id, ids); current = r.project; return r.result;
}

/** Editar os efeitos sonoros de uma ou várias cenas e gerar a faixa na hora. */
function openSfxDialog(p: Project, ids: string[]) {
  const scs = p.scenes.filter((s) => ids.includes(s.id)); if (!scs.length) return;
  const picker = sfxPicker(scs.length === 1 ? sceneSfx(scs[0]!) : []);
  const close = () => bg.remove();
  const bg = h('div', { class: 'modal-bg', id: 'sfx-modal', onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal regenbox' },
      h('div', { class: 'row' }, h('h3', {}, `🔊 Efeitos sonoros — ${scs.length > 1 ? `${scs.length} cenas` : `cena ${scs[0]!.index}`}`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
      picker.el,
      h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Cancelar'),
        h('button', { class: 'primary', id: 'sfx-save', onclick: () => void guard(async () => {
          close(); busy = picker.sync() ? 'Sincronizando efeitos com o visual e regerando a(s) cena(s)…' : 'Gerando efeitos sonoros…'; renderEditor(true);
          try { const r = await applySceneSfx(p, scs.map((s) => s.id), picker.value(), picker.sync()); toast(`Cena(s) regerada(s) com efeitos: ${Object.values(r).join(' · ')}. ▶ para ouvir; renderize o final para gravar no vídeo.`); }
          finally { busy = ''; renderEditor(true); }
        }) }, 'Salvar e gerar'))));
  document.body.append(bg);
}

/**
 * Slider de volume das faixas (narração, efeitos, música): trilho preenchido até o valor, % grande e dB, marca do
 * padrão, mudo, voltar ao padrão (↺ ou duplo clique), roda do mouse (±5%) e setas. A prévia muda na hora; o vídeo
 * muda na próxima renderização.
 */
function volSlider(o: { key: 'narr' | 'sfx' | 'music'; label: string; icon: string; value: number | undefined; def: number; max: number;
  onPreview?: (v: number) => void; onSave: (v: number | null) => Promise<void> | void; extra?: HTMLElement | null }): HTMLElement {
  const muted = o.value === 0, pct = Math.round((o.value ?? o.def) * 100), maxPct = Math.round(o.max * 100), defPct = Math.round(o.def * 100);
  const range = h('input', { type: 'range', min: '0', max: String(maxPct), step: '1', value: String(muted ? 0 : pct), 'data-field': `${o.key}-vol`, title: `${o.label}: arraste, use a roda do mouse ou as setas · duplo clique volta a ${defPct}%` }) as HTMLInputElement;
  const num = h('span', { class: 'vnum' }), db = h('span', { class: 'vdb' });
  const paint = () => {
    const v = Number(range.value);
    range.style.setProperty('--pct', `${(v / maxPct) * 100}%`);
    range.style.setProperty('--def', `${(defPct / maxPct) * 100}%`);
    range.classList.toggle('hot', v > 100);
    num.textContent = v === 0 ? 'mudo' : `${v}%`;
    db.textContent = v === 0 ? '−∞ dB' : `${(20 * Math.log10(v / 100)).toFixed(1).replace('.', ',')} dB`;
  };
  paint();
  let saveT = 0;
  const commit = () => { window.clearTimeout(saveT); saveT = window.setTimeout(() => void guard(async () => { await o.onSave(Number(range.value) / 100); }), 350); };
  range.addEventListener('input', () => { paint(); o.onPreview?.(Number(range.value) / 100); });
  range.addEventListener('change', commit);
  range.addEventListener('dblclick', () => { range.value = String(defPct); paint(); o.onPreview?.(o.def); void guard(async () => { await o.onSave(null); }); });
  range.addEventListener('wheel', (e) => { e.preventDefault(); range.value = String(Math.max(0, Math.min(maxPct, Number(range.value) + (e.deltaY < 0 ? 5 : -5)))); paint(); o.onPreview?.(Number(range.value) / 100); commit(); }, { passive: false });
  return h('div', { class: `tname mhead vol-${o.key}` },
    h('span', { class: 'vlabel' }, `${o.icon} ${o.label}`),
    h('button', { class: `small mute${muted ? ' on' : ''}`, 'data-act': `${o.key}-mute`, title: muted ? 'Tirar do mudo' : 'Mutar', onclick: () => void guard(async () => { await o.onSave(muted ? o.def : 0); }) }, muted ? '🔇' : '🔊'),
    h('span', { class: 'vwrap' }, range), num, db,
    o.value !== undefined && o.value !== o.def ? h('button', { class: 'small', title: `Voltar a ${defPct}%`, onclick: () => void guard(async () => { await o.onSave(null); }) }, '↺') : null,
    o.extra ?? null);
}
const volSave = (p: Project, field: 'narrationVolume' | 'sfxVolume' | 'musicVolume', what: string) => async (v: number | null) => {
  current = await forge.updateProject(p.id, { [field]: v });
  toast(v === 0 ? `${what} no mudo. Renderize o final para aplicar.` : `Volume ${what === 'Música' ? 'da música' : what === 'Narração' ? 'da narração' : 'dos efeitos'} salvo${v === null ? ' (padrão)' : `: ${Math.round(v * 100)}%`}. Renderize o final para aplicar.`);
  renderEditor(true);
};
/** Faixa da narração: volume 0–200% (padrão 100%). */
const narrHead = (p: Project) => volSlider({ key: 'narr', label: 'Narração', icon: '🎙️', value: p.narrationVolume, def: 1, max: 2,
  onPreview: (v) => { if (preview.a) preview.a.volume = Math.min(1, v); }, onSave: volSave(p, 'narrationVolume', 'Narração') });
/** Faixa de efeitos: volume 0–150% (padrão 15%). */
const sfxHead = (p: Project) => volSlider({ key: 'sfx', label: 'Efeitos sonoros', icon: '💥', value: p.sfxVolume, def: 0.15, max: 1.5,
  onPreview: (v) => { if (preview.x) preview.x.volume = Math.min(1, v); }, onSave: volSave(p, 'sfxVolume', 'Efeitos sonoros') });
/** Faixa de música: volume 0–100% (padrão 15%; vídeo livre 35%). */
const musicHead = (p: Project) => volSlider({ key: 'music', label: 'Música', icon: '🎵', value: p.musicVolume, def: p.scenes.length ? 0.15 : 0.35, max: 1,
  onSave: volSave(p, 'musicVolume', 'Música'),
  extra: h('button', { class: 'small', 'data-act': 'music-edit', title: 'Adicionar, trocar, gerar ou remover a trilha sonora', onclick: () => void openMusicDialog(p) }, 'trocar trilha') });

/** Ferramentas da timeline: dividir e cortar no cursor, inserir clipe (empurra o resto), duplicar e excluir. */
function tlTools(p: Project): HTMLElement {
  const i = selIndex(), sc = p.scenes[i], a = sc ? sceneStart(p, i) : 0, rel = cursorT - a, len = sc ? dur(sc) : 0;
  const inside = !!sc && rel > 0.2 && rel < len - 0.2 && selected.length === 1;
  const act = (msg: string, fn: () => Promise<Project>) => () => void guard(async () => { stopPlay(); current = await fn(); media = await forge.projectMedia(p.id); toast(msg); renderEditor(true); });
  const split = act('Clipe dividido no cursor.', async () => { const r = await forge.splitScene(p.id, sc!.id, rel); selected = [r.scene.id]; anchor = r.scene.id; return r.project; });
  const cutIn = act('Início do clipe cortado — o resto da timeline foi puxado.', () => forge.trimScene(p.id, sc!.id, { cutStart: rel }));
  const cutOut = act('Fim do clipe cortado — o resto da timeline foi puxado.', () => forge.trimScene(p.id, sc!.id, { cutEnd: len - rel }));
  const insert = (where: Parameters<typeof forge.insertClip>[1]) => void guard(async () => {
    menu.classList.remove('open'); stopPlay();
    const r = await forge.insertClip(p.id, where); if (!r) return;
    current = r.project; selected = [r.scene.id]; anchor = r.scene.id; cursorT = sceneStart(current, current.scenes.findIndex((x) => x.id === r.scene.id));
    media = await forge.projectMedia(p.id);
    toast(`Clipe "${r.scene.title}" inserido (${dur(r.scene).toFixed(1)} s) — o que vinha depois foi empurrado. Renderize o final para gravar.`); renderEditor(true);
  });
  const menu = h('div', { class: 'tl-menu' },
    h('button', { 'data-act': 'ins-start', onclick: () => insert({ at: 'start' }) }, '⏮ No início do vídeo'),
    h('button', { 'data-act': 'ins-cursor', onclick: () => insert({ at: 'time', time: cursorT }) }, `⌖ No cursor (${cursorT.toFixed(1).replace('.', ',')} s${inside ? ' — divide o clipe' : ''})`),
    sc ? h('button', { 'data-act': 'ins-before', onclick: () => insert({ at: 'before', sceneId: sc.id }) }, `↤ Antes da cena ${sc.index}`) : null,
    sc ? h('button', { 'data-act': 'ins-after', onclick: () => insert({ at: 'after', sceneId: sc.id }) }, `↦ Depois da cena ${sc.index}`) : null,
    h('button', { 'data-act': 'ins-end', onclick: () => insert({ at: 'end' }) }, '⏭ No fim do vídeo'));
  const insBtn = h('button', { class: 'tool', 'data-act': 'tl-insert', title: 'Inserir um vídeo ou imagem do computador: tudo o que vem depois é empurrado (ripple)', onclick: (e) => { e.stopPropagation(); menu.classList.toggle('open'); } }, '＋ Inserir clipe ▾');
  document.addEventListener('click', () => menu.classList.remove('open'), { once: true });
  const why = !sc ? 'Selecione um clipe' : selected.length > 1 ? 'Selecione um clipe só' : 'Clique dentro do clipe (longe das bordas) para pôr o cursor';
  return h('div', { class: 'tl-tools', id: 'tl-tools' },
    h('button', { class: 'tool', 'data-act': 'tl-split', disabled: !inside, title: inside ? `Dividir a cena ${sc!.index} em ${rel.toFixed(2).replace('.', ',')} s (S)` : why, onclick: split }, '✂ Dividir'),
    h('button', { class: 'tool', 'data-act': 'tl-cut-in', disabled: !inside, title: inside ? `Cortar o início até o cursor — tira ${rel.toFixed(2).replace('.', ',')} s (Q)` : why, onclick: cutIn }, '⇤ Cortar início'),
    h('button', { class: 'tool', 'data-act': 'tl-cut-out', disabled: !inside, title: inside ? `Cortar do cursor até o fim — tira ${(len - rel).toFixed(2).replace('.', ',')} s (W)` : why, onclick: cutOut }, 'Cortar fim ⇥'),
    h('span', { class: 'tl-ins' }, insBtn, menu),
    h('button', { class: 'tool', 'data-act': 'tl-dup', disabled: !sc || selected.length !== 1, title: 'Duplicar o clipe (a cópia entra logo depois e empurra o resto)', onclick: act('Clipe duplicado.', () => forge.duplicateScene(p.id, sc!.id)) }, '⧉ Duplicar'),
    h('button', { class: 'tool danger', 'data-act': 'tl-del', disabled: !selected.length, title: 'Excluir os clipes selecionados e puxar o resto da timeline (Delete)', onclick: () => $<HTMLButtonElement>('.del-scene')?.click() }, '🗑 Excluir'),
    h('span', { class: 'tl-cursor muted' }, `cursor ${fmtTc(cursorT)}.${String(Math.floor((cursorT % 1) * 10))}`),
    h('span', { class: 'sp' }),
    h('button', { class: 'tool', 'data-act': 'exp-davinci', title: 'Exporta a timeline (XML) com os clipes, a narração, os efeitos, a música e as legendas para o DaVinci Resolve', onclick: () => void exportTo(p, 'davinci') }, '⇪ DaVinci Resolve'),
    h('button', { class: 'tool', 'data-act': 'exp-capcut', title: 'Exporta uma pasta pronta para o CapCut: clipes numerados, faixas de áudio e legendas .srt', onclick: () => void exportTo(p, 'capcut') }, '⇪ CapCut'));
}
async function exportTo(p: Project, target: 'davinci' | 'capcut') {
  await guard(async () => {
    busy = `Exportando para ${target === 'davinci' ? 'o DaVinci Resolve' : 'o CapCut'}…`; renderEditor(true);
    try { const r = await forge.exportEditor(p.id, target); toast(`Exportado: ${r.dir}${r.notes.length ? ` (${r.notes.join('; ')})` : ''} — veja COMO-IMPORTAR.txt`); }
    finally { busy = ''; renderEditor(true); }
  });
}
/** Trilha sonora: escolher um arquivo, gerar por código ou remover — e aplicar no vídeo final. */
async function openMusicDialog(p: Project) {
  const moods = (await guard(() => forge.musicMoods())) ?? [];
  const mood = h('select', { id: 'mus-mood' }, ...moods.map((m) => h('option', { value: m.id }, m.label))) as HTMLSelectElement;
  const cur = h('p', { class: 'muted', id: 'mus-cur' }, media.music ? `Trilha atual: ♪ ${basename(media.music)}` : 'Sem trilha sonora.');
  const close = () => bg.remove();
  const refresh = async (msg: string) => { media = await forge.projectMedia(p.id); cur.textContent = media.music ? `Trilha atual: ♪ ${basename(media.music)}` : 'Sem trilha sonora.'; toast(msg); renderEditor(true); };
  const apply = () => void guard(async () => {
    close(); busy = 'Aplicando a trilha no vídeo final…'; renderEditor(true);
    try { const r = await forge.applyMusic(p.id); if (!r.ok) toast(r.error ?? 'falhou', true); else toast(r.message ? `Vídeo final atualizado: ${r.message}` : 'Vídeo final renderizado com a trilha'); }
    finally { busy = ''; current = await forge.getProject(p.id); media = await forge.projectMedia(p.id); renderEditor(true); }
  });
  const bg = h('div', { class: 'modal-bg', id: 'music-modal', onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal regenbox' },
      h('div', { class: 'row' }, h('h3', {}, '🎵 Trilha sonora'), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
      cur,
      h('div', { class: 'row' },
        h('button', { id: 'mus-pick', title: 'mp3, wav, m4a, ogg, flac ou aac — a cópia fica na pasta do projeto', onclick: () => void guard(async () => { const f = await forge.musicPick(p.id); if (f) await refresh(`Trilha trocada: ${basename(f)}`); }) }, '📁 Escolher arquivo…'),
        media.music ? h('button', { id: 'mus-clear', class: 'danger', onclick: () => void guard(async () => { await forge.musicClear(p.id); await refresh('Trilha removida'); }) }, '✕ Remover trilha') : null),
      h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Gerar por código (sem internet, duração do vídeo)', mood),
        h('button', { id: 'mus-gen', onclick: () => void guard(async () => {
          busy = 'Gerando trilha por código…'; renderEditor(true);
          try { const f = await forge.musicCode(p.id, mood.value); await refresh(`Trilha gerada: ${basename(f)}`); } finally { busy = ''; renderEditor(true); }
        }) }, '🎼 Gerar')),
      h('label', { class: 'inline chk', title: 'Ao produzir (ou refazer a etapa de trilha), a trilha sai por código em vez da IA/biblioteca da rota' },
        h('input', { type: 'checkbox', id: 'mus-code-auto', checked: !!p.codeMusic, onchange: (e: Event) => void guard(async () => {
          current = await forge.updateProject(p.id, { codeMusic: (e.target as HTMLInputElement).checked });
          toast((e.target as HTMLInputElement).checked ? 'A produção vai gerar a trilha por código' : 'A produção volta a usar a trilha da rota');
        }) }), '🎼 Sempre gerar a trilha por código neste projeto'),
      h('p', { class: 'muted' }, p.scenes.length ? 'Aplicar remonta o vídeo final com a trilha (as cenas não são refeitas).' : 'Aplicar remixa o vídeo final na hora: a animação e os efeitos sonoros ficam como estão.'),
      h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Fechar'),
        h('button', { class: 'primary', id: 'mus-apply', disabled: !media.final && !p.scenes.length, onclick: apply }, '✔ Aplicar no vídeo final'))));
  document.body.append(bg);
}

/** Variação: novo projeto a partir deste, trocando skill/estilo, rota, formato, idioma ou duração. */
async function openDeriveDialog(row: ProjectRow) {
  const [meta, src] = await Promise.all([forge.meta(), forge.getProject(row.id)]);
  const skill = h('select', { id: 'drv-skill' }, ...meta.skills.map((k) => h('option', { value: k.id }, `${k.builtin ? '' : '★ '}${k.name}`))) as HTMLSelectElement;
  skill.value = src.skillId ?? meta.skills[0]?.id ?? '';
  const route = h('select', { id: 'drv-route' }, ...meta.routes.map((r) => h('option', { value: r.id }, r.name))) as HTMLSelectElement;
  route.value = src.routeId;
  const name = h('input', { id: 'drv-name', class: 'wide', value: `${src.name} — variação` }) as HTMLInputElement;
  const aspect = h('select', { id: 'drv-aspect' }, ...['16:9', '9:16', '1:1', '4:5'].map((a) => h('option', { value: a }, a))) as HTMLSelectElement; aspect.value = src.aspect;
  const lang = h('select', { id: 'drv-lang' }, ...LANGUAGES.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement; lang.value = src.language;
  const dur = h('input', { id: 'drv-dur', type: 'number', min: '5', class: 'num', value: String(src.targetDurationSec) }) as HTMLInputElement;
  const style = h('textarea', { id: 'drv-style', rows: '2', placeholder: 'Opcional: estilo de vídeo extra (ex.: "traço preto grosso, fundo branco, sem cores")' }) as HTMLTextAreaElement;
  const keepScript = h('input', { type: 'radio', name: 'drv-keep', id: 'drv-keep-script' }) as HTMLInputElement;
  const keepIdea = h('input', { type: 'radio', name: 'drv-keep', id: 'drv-keep-idea' }) as HTMLInputElement; keepIdea.checked = true;
  const card = h('div', { class: 'drv-skill muted' });
  const paintSkill = () => {
    const k = meta.skills.find((x) => x.id === skill.value);
    if (k?.routeId && meta.routes.some((r) => r.id === k.routeId)) route.value = k.routeId;
    card.replaceChildren(k ? h('span', {}, `🧠 ${k.description ?? ''}`) : '');
    name.value = `${src.name} — ${k?.name ?? 'variação'}`;
  };
  skill.addEventListener('change', paintSkill);
  const close = () => bg.remove();
  const go2 = (mode: 'open' | 'run' | 'list') => void guard(async () => {
    const p = await forge.deriveProject(src.id, { name: name.value.trim(), skillId: skill.value, routeId: route.value, aspect: aspect.value, language: lang.value,
      targetDurationSec: Number(dur.value) || undefined, videoStyle: style.value.trim() || undefined, keep: keepScript.checked ? 'script' : 'idea' });
    close(); toast(`Criado "${p.name}" (${meta.skills.find((x) => x.id === p.skillId)?.name ?? ''}).`);
    if (mode === 'open') { current = p; selected = []; go('editor'); }
    else if (mode === 'run') { runProject(p.id, p.name); void renderProjects(); }
    else void renderProjects();
  });
  const bg = h('div', { class: 'modal-bg', id: 'derive-modal', onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal regenbox' },
      h('div', { class: 'row' }, h('h3', {}, `🔀 Nova variação de "${src.name}"`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
      h('p', { class: 'muted' }, 'Cria um NOVO projeto com a mesma ideia, trocando o que você escolher aqui. O original continua igual.'),
      h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Skill / estilo', skill), h('label', { class: 'grow' }, 'Rota', route)), card,
      h('div', { class: 'row' }, h('label', {}, 'Formato', aspect), h('label', {}, 'Idioma', lang), h('label', {}, 'Duração (s)', dur)),
      h('label', {}, 'Nome do novo projeto', name),
      h('label', {}, 'Estilo de vídeo (opcional)', style),
      h('div', { class: 'row' }, h('label', { class: 'inline chk' }, keepIdea, 'Recomeçar da ideia (roteiro, cenas e mídias novos no novo estilo)'),
        h('label', { class: 'inline chk' }, keepScript, 'Reaproveitar o roteiro já escrito (refaz só cenas, narração e mídias)')),
      h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Cancelar'),
        h('button', { id: 'drv-create', onclick: () => go2('list') }, 'Criar'),
        h('button', { id: 'drv-open', onclick: () => go2('open') }, 'Criar e abrir no editor'),
        h('button', { class: 'primary', id: 'drv-run', onclick: () => go2('run') }, '▶ Criar e produzir'))));
  card.replaceChildren(h('span', {}, `🧠 ${meta.skills.find((x) => x.id === skill.value)?.description ?? ''}`));
  document.body.append(bg);
}

/** Confirma e envia o vídeo final ao YouTube (não listado por padrão). */
async function openUploadDialog(p: Project) {
  const auto = (await forge.getSettings()).automations;
  const accs = auto?.accounts ?? [];
  if (!accs.length) { toast('Adicione uma conta Google em Automações e faça o login no navegador dela.', true); return; }
  const acc = h('select', { id: 'yt-acc' }, ...accs.map((a) => h('option', { value: a.id }, `${a.label}${a.email ? ` (${a.email})` : ''}`))) as HTMLSelectElement;
  acc.value = auto?.youtubeAccount && accs.some((a) => a.id === auto.youtubeAccount) ? auto.youtubeAccount : accs[0]!.id;
  const vis = h('select', { id: 'yt-vis' }, h('option', { value: 'UNLISTED' }, '🔗 Não listado (só quem tem o link)'), h('option', { value: 'PRIVATE' }, '🔒 Privado'), h('option', { value: 'PUBLIC' }, '🌍 Público')) as HTMLSelectElement;
  const close = () => bg.remove();
  const bg = h('div', { class: 'modal-bg', id: 'yt-modal', onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal regenbox' },
      h('div', { class: 'row' }, h('h3', {}, '⬆ Enviar ao YouTube'), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
      h('p', { class: 'muted' }, 'O app abre o YouTube Studio no navegador da conta (o mesmo do Flow), envia out/final.mp4, preenche título e descrição do SEO (metadata.json), envia a thumbnail, marca "não é para crianças" e salva com a visibilidade escolhida. O login é seu: se pedir, entre na conta pelo navegador das Automações e tente de novo.'),
      h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Conta Google', acc), h('label', {}, 'Visibilidade', vis)),
      h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Cancelar'),
        h('button', { class: 'primary', id: 'yt-send', onclick: () => void guard(async () => {
          close(); busy = 'Enviando ao YouTube…'; renderEditor(true);
          try { const r = (await forge.youtubeUpload(p.id, { account: acc.value, visibility: vis.value })) as { url?: string }; toast(r.url ? `Vídeo enviado: ${r.url}` : 'Vídeo enviado ao YouTube (veja no Studio).'); }
          finally { busy = ''; renderEditor(true); }
        }) }, 'Enviar'))));
  document.body.append(bg);
}

/** Migrar para outro idioma: cria uma cópia traduzida e refaz o que depende do idioma. */
function openMigrateDialog(p: ProjectRow) {
  const lang = h('select', { id: 'mig-lang' }, ...LANGUAGES.filter(([v]) => v !== p.language).map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  const vis = h('input', { type: 'checkbox', id: 'mig-visuals' }) as HTMLInputElement;
  const run = h('input', { type: 'checkbox', id: 'mig-run' }) as HTMLInputElement; run.checked = true;
  const close = () => bg.remove();
  const bg = h('div', { class: 'modal-bg', id: 'migrate-modal', onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal regenbox' },
      h('div', { class: 'row' }, h('h3', {}, `🌐 Migrar "${p.name}" para outro idioma`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
      h('p', { class: 'muted' }, 'O original fica intacto: é criada uma CÓPIA. O roteiro, os títulos, a narração e as legendas são traduzidos pela IA de texto da rota; depois são refeitas a narração (voz da rota), a transcrição, os efeitos sonoros, as cenas por código/texto, as legendas, a montagem, o SEO e a capa — no novo idioma.'),
      h('label', {}, 'Idioma de destino', lang),
      h('label', { class: 'inline chk' }, vis, 'Regerar também imagens e vídeos (gasta mais créditos/tempo)'),
      h('label', { class: 'inline chk' }, run, 'Executar a regeneração agora'),
      h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Cancelar'),
        h('button', { class: 'primary', id: 'mig-yes', onclick: () => void guard(async () => {
          close(); toast('Traduzindo… a cópia aparece na lista em instantes.');
          const r = await forge.migrateLanguage(p.id, { language: lang.value, visuals: vis.checked, run: run.checked });
          toast(`Criado "${r.project.name}".${run.checked ? ' A regeneração foi iniciada.' : ''}`); void renderProjects();
        }) }, 'Migrar'))));
  document.body.append(bg);
}

/** "Regerar cena": pergunta antes, mostrando o que será refeito (visual marcado; narração opcional). */
function openRegenDialog(p: Project, ids: string[]) {
  const scs = p.scenes.filter((s) => ids.includes(s.id));
  if (!scs.length) return;
  const VISUAL = ['image', 'video', 'code_scene', 'motion_graphics', 'stock_media'];
  const steps = sceneSteps(p);
  const boxes = steps.map((s) => { const cb = h('input', { type: 'checkbox', 'data-regen-step': s.id }) as HTMLInputElement; cb.checked = VISUAL.includes(s.kind); return { s, cb }; });
  const reroll = h('input', { type: 'checkbox', id: 'regen-reroll' }) as HTMLInputElement; reroll.checked = true;
  /* executor desta vez (etapas de texto/código): ex.: a cena saiu fraca no Ollama → refaz só ela no Antigravity */
  const ovNow = [...new Set(scs.flatMap((sc) => Object.entries(sc.overrides ?? {}).filter(([, b]) => b.length).map(([sid, b]) => `${steps.find((x) => x.id === sid)?.label ?? sid} → ${bindingArt(b[0]!).title}`)))];
  const exSel = h('select', { id: 'regen-executor' }, h('option', { value: '' }, '(o mesmo de agora)'), ovNow.length ? h('option', { value: 'reset' }, '(voltar ao da rota)') : null,
    ...['auto', 'claude', 'antigravity', 'codex', 'opencode', 'openclaw', 'ollama', 'lmstudio', 'llamacpp', 'deepseek'].map((x) => h('option', { value: x }, x === 'auto' ? 'auto (o melhor instalado)' : x))) as HTMLSelectElement;
  const exModel = h('input', { id: 'regen-model', class: 'num', placeholder: 'modelo (opcional)', list: 'regen-models' }) as HTMLInputElement;
  const exList = h('datalist', { id: 'regen-models' });
  exSel.addEventListener('change', () => void guard(async () => {
    exModel.value = '';
    const cat = await (forge as unknown as { catalog: () => Promise<{ harnesses: Array<{ id: string; models: string[] }> }> }).catalog();
    exList.replaceChildren(...(cat.harnesses.find((x) => x.id === exSel.value)?.models ?? []).map((m) => h('option', { value: m })));
  }));
  const note = h('textarea', { id: 'regen-note', rows: '2', placeholder: 'Opcional: o que mudar (ex.: "câmera mais aberta, céu ao entardecer"). Entra no prompt da cena.' }) as HTMLTextAreaElement;
  const before = scs.length === 1 ? sceneSfx(scs[0]!) : [];
  const picker = sfxPicker(before);
  const close = () => bg.remove();
  const bg = h('div', { class: 'modal-bg', id: 'regen-modal', onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal regenbox' },
      h('div', { class: 'row' }, h('h3', {}, `↻ Regerar ${scs.length > 1 ? `${scs.length} cenas` : `a cena ${scs[0]!.index}`}?`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
      h('p', {}, scs.length > 1 ? `Cenas: ${scs.map((s) => `${s.index}. ${s.title}`).join(' · ')}` : `"${scs[0]!.title}"`),
      h('p', { class: 'muted' }, 'É isso que você deseja? As etapas marcadas serão refeitas e o resultado atual será substituído. O vídeo final só muda quando você renderizar de novo.'),
      h('div', { class: 'regensteps' }, ...boxes.map(({ s, cb }) => h('label', { class: 'inline chk tgl' }, cb, `${s.label}`))),
      h('label', { class: 'inline chk' }, reroll, 'Nova variação (outro resultado, novo seed)'),
      h('div', { class: 'row', title: 'Vale para as etapas de texto/código marcadas (cena por código, motion graphics…). Fica gravado nesta(s) cena(s); o executor da rota vira reserva.' },
        h('span', {}, '🎛 Executor desta vez'), exSel, exModel, exList, ovNow.length ? h('span', { class: 'muted small' }, `agora: ${ovNow.join(' · ')}`) : null),
      h('label', {}, 'Ajuste para a nova versão', note),
      h('details', { class: 'sfxbox', open: before.length > 0 }, h('summary', {}, `🔊 Efeitos sonoros (gerados por código)${scs.length > 1 ? ' — vale para todas as cenas escolhidas' : ''}`), picker.el),
      h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Cancelar'),
        h('button', { class: 'primary', id: 'regen-yes', onclick: () => void guard(async () => {
          const stepIds = boxes.filter((x) => x.cb.checked).map((x) => x.s.id);
          const sfxChanged = JSON.stringify(picker.value()) !== JSON.stringify(before);
          if (!stepIds.length && !sfxChanged) throw new Error('Marque ao menos uma etapa para refazer (ou mude os efeitos sonoros).');
          close(); stopPlay();
          /* efeitos pedidos: sem outras etapas, só regera o som; com visual novo, sincroniza DEPOIS dele */
          const wantSfx = sfxChanged || (picker.sync() && picker.value().length > 0 && stepIds.length > 0);
          if (wantSfx && !stepIds.length) {
            busy = 'Sincronizando efeitos com o visual…'; renderEditor(true);
            try { await applySceneSfx(p, scs.map((s) => s.id), picker.value(), picker.sync()); toast('Cena(s) regerada(s) com os efeitos sonoros. Renderize o final para gravar no vídeo.'); }
            finally { busy = ''; renderEditor(true); }
            return;
          }
          if (note.value.trim()) for (const sc of scs) current = (await forge.updateScene(p.id, sc.id, { notes: [sc.notes, note.value.trim()].filter(Boolean).join(' | ') }, false)).project;
          busy = `Regerando ${scs.length > 1 ? `${scs.length} cenas` : `cena ${scs[0]!.index}`}…`; renderEditor(true);
          try {
            const executor = exSel.value === 'reset' ? 'reset' : exSel.value ? { type: 'harness', harness: exSel.value, ...(exModel.value.trim() ? { model: exModel.value.trim() } : {}) } : undefined;
            current = (await forge.regenerate(p.id, { sceneIds: scs.map((s) => s.id), stepIds, reroll: reroll.checked, finalize: false, executor })).project;
            if (wantSfx) { busy = 'Sincronizando efeitos com o novo visual…'; renderEditor(true); await applySceneSfx(current ?? p, scs.map((s) => s.id), picker.value(), picker.sync()); }
            toast(`Cena(s) regerada(s)${wantSfx ? ' com efeitos sonoros sincronizados' : ''}. Renderize o final para gravar no vídeo.`);
          }
          finally { busy = ''; current = await forge.getProject(p.id); media = await forge.projectMedia(p.id); renderEditor(true); }
        }) }, 'Sim, regerar'))));
  document.body.append(bg);
}

function selectScene(id: string, ev?: { ctrl?: boolean; shift?: boolean }) {
  if (!current) return;
  const ids = current.scenes.map((s) => s.id);
  if (ev?.shift && anchor) {
    const a = ids.indexOf(anchor), b = ids.indexOf(id);
    selected = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  } else if (ev?.ctrl) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]; anchor = id;
  } else { selected = [id]; anchor = id; }
  stopPlay();
  renderEditor(true);
}

function stepDots(p: Project, sc: Scene): HTMLElement {
  return h('span', { class: 'dots' }, ...sceneSteps(p).map((s) => {
    const st = sc.status[s.id] ?? 'pending';
    return h('i', { class: `dot ${st}`, title: `${s.label}: ${st}` });
  }));
}

function timeline(p: Project): HTMLElement {
  const total = p.scenes.reduce((a, s) => a + dur(s), 0);
  const width = Math.max(600, total * pxPerSec + 40);
  const ruler = h('div', { class: 'ruler', title: 'Clique para ir a este ponto' });
  const stepSec = pxPerSec >= 60 ? 1 : pxPerSec >= 30 ? 2 : pxPerSec >= 15 ? 5 : 10;
  for (let t = 0; t <= total + stepSec; t += stepSec) { const tk = h('span', { class: 'tick' }, `${t}s`); tk.style.left = `${t * pxPerSec}px`; ruler.append(tk); }
  ruler.addEventListener('click', (e) => {
    const t = (e as MouseEvent).offsetX / pxPerSec; let acc = 0;
    const i = p.scenes.findIndex((s) => { acc += dur(s); return t < acc; });
    const idx = i < 0 ? p.scenes.length - 1 : i; if (idx < 0) return;
    cursorT = Math.min(t, total);
    if (playing) void playScene(idx); else { selected = [p.scenes[idx]!.id]; anchor = selected[0]; renderEditor(true); }
  });

  const vTrack = h('div', { class: 'track', 'data-track': 'video' });
  const aTrack = h('div', { class: 'track', 'data-track': 'audio' });
  const sTrack = h('div', { class: 'track', 'data-track': 'subs' });
  const mTrack = h('div', { class: 'track', 'data-track': 'music' });
  const xTrack = h('div', { class: 'track', 'data-track': 'sfx' });
  let x = 0;
  if (!p.scenes.length && media.final) {
    // vídeo livre (ou projeto sem cenas): o vídeo final é o único clipe
    const c = h('div', { class: 'clip sel final', 'data-id': 'final' }, h('video', { src: forge.mediaUrl(media.final) + '#t=0.1', preload: 'metadata', muted: true }), h('div', { class: 'lbl' }, 'Vídeo final'));
    c.style.left = '0px'; c.style.width = '480px'; vTrack.append(c);
  }
  p.scenes.forEach((sc, idx) => {
    const w = dur(sc) * pxPerSec;
    const vis = pickVisual(sc);
    const hasFx = !!sc.effects && ((sc.effects.filter ?? 'none') !== 'none' || (sc.effects.zoom ?? 'none') !== 'none' || sc.effects.fadeIn || sc.effects.fadeOut || (sc.effects.vignette ?? 'none') !== 'none');
    const tr = sc.effects?.transition && sc.effects.transition !== 'none' && idx < p.scenes.length - 1 ? FX_TRANS.find((x) => x[0] === sc.effects!.transition) : undefined;
    if (tr) {   // marcador da transição na junção com a próxima cena
      const mk = h('div', { class: 'trmark', title: `Transição: ${tr[1]} (${sc.effects?.transitionSec ?? 0.6}s) — clique para abrir o exibidor de efeitos`, onclick: (e) => { e.stopPropagation(); openFxViewer(p, [sc.id], 'transition'); } }, tr[2]);
      mk.style.left = `${x + w - 13}px`; vTrack.append(mk);
    }
    const clip = h('div', { class: `clip${selected.includes(sc.id) ? ' sel' : ''}`, draggable: 'true', 'data-id': sc.id },
      vis ? (vis.video ? h('video', { src: forge.mediaUrl(vis.path) + '#t=0.1', preload: 'metadata', muted: true }) : h('img', { src: forge.mediaUrl(vis.path), alt: '' })) : null,
      h('div', { class: 'lbl' }, `${sc.index}. ${sc.title}`), stepDots(p, sc),
      hasFx ? h('span', { class: 'fxbadge', title: 'Esta cena tem efeitos — clique para abrir o exibidor', onclick: (e) => { e.stopPropagation(); openFxViewer(p, [sc.id], 'filter'); } }, icon('fx')) : null,
      h('div', { class: 'rz', title: 'Arraste para ajustar a duração' }));
    clip.style.left = `${x}px`; clip.style.width = `${w - 2}px`;
    clip.addEventListener('click', (e) => {
      /* o clique também posiciona o cursor no ponto exato do clipe (para dividir/cortar ali) */
      const r = clip.getBoundingClientRect(); cursorT = sceneStart(p, idx) + Math.max(0, Math.min(dur(sc), (e.clientX - r.left) / pxPerSec));
      selectScene(sc.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    });
    clip.addEventListener('dblclick', () => { void playScene(idx); });
    clip.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/plain', sc.id); });
    clip.addEventListener('dragover', (e) => { e.preventDefault(); clip.classList.add('over'); });
    clip.addEventListener('dragleave', () => clip.classList.remove('over'));
    clip.addEventListener('drop', (e) => {
      e.preventDefault(); clip.classList.remove('over');
      const from = e.dataTransfer?.getData('text/plain'); if (!from || from === sc.id) return;
      void guard(async () => { current = await forge.moveScene(p.id, from, idx); renderEditor(true); });
    });
    const rz = clip.querySelector<HTMLElement>('.rz')!;
    rz.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startW = w; clip.draggable = false;
      const move = (m: MouseEvent) => { clip.style.width = `${Math.max(24, startW + m.clientX - startX) - 2}px`; };
      const up = (m: MouseEvent) => {
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); clip.draggable = true;
        const nd = Math.max(0.5, Math.round(((startW + m.clientX - startX) / pxPerSec) * 10) / 10);
        void guard(async () => { current = (await forge.updateScene(p.id, sc.id, { durationSec: nd })).project; renderEditor(true); });
      };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });
    vTrack.append(clip);

    const a = h('div', { class: `bar a ${sc.status['narration'] ?? (pickAudio(sc) ? 'done' : 'pending')}`, title: sc.narration }, sc.narration.slice(0, 40) || '—');
    a.style.left = `${x}px`; a.style.width = `${w - 2}px`; aTrack.append(a);
    const subText = sc.subtitle?.trim() || sc.narration;
    const s = h('div', { class: `bar s${sc.subtitle?.trim() ? ' custom' : ''}`, title: subText }, subText.slice(0, 60));
    s.addEventListener('click', () => selectScene(sc.id));
    s.style.left = `${x}px`; s.style.width = `${w - 2}px`; sTrack.append(s);
    const fx = sceneSfx(sc);
    const xb = h('div', { class: `bar x${fx.length ? '' : ' empty'}`, 'data-sfx-scene': sc.id, title: fx.length ? `Efeitos sonoros: ${fx.join(', ')} — clique para editar` : 'Sem efeitos sonoros — clique para adicionar', onclick: () => openSfxDialog(p, selected.includes(sc.id) && selected.length > 1 ? selected : [sc.id]) },
      fx.length ? fx.map((n) => sfxLib.find((d) => d.id === n.split(/[@:]/)[0])?.icon ?? '🔊').join(' ') : '+');
    xb.style.left = `${x}px`; xb.style.width = `${w - 2}px`; xTrack.append(xb);
    x += w;
  });
  {
    const span = (p.scenes.length ? total : p.targetDurationSec || 10) * pxPerSec;
    const m = h('div', { class: `bar m${media.music ? '' : ' empty'}`, 'data-act': 'music-bar', title: 'Clique para adicionar, trocar ou gerar a trilha sonora', onclick: () => void openMusicDialog(p) }, media.music ? '♪ ' + basename(media.music) : '+ trilha sonora');
    m.style.left = '0px'; m.style.width = `${Math.max(160, span)}px`; mTrack.append(m);
  }
  const ph = h('div', { id: 'playhead', class: 'playhead' }, h('span', { class: 'ph-knob' }));
  /* cursor: fica onde foi clicado se estiver dentro da cena selecionada; senão vai para o início dela */
  { const a = sceneStart(p, selIndex()), b = a + (p.scenes[selIndex()] ? dur(p.scenes[selIndex()]!) : 0); if (!(cursorT >= a && cursorT <= b)) cursorT = a; }
  ph.style.left = `${cursorT * pxPerSec}px`;
  const inner = h('div', { class: 'tl-inner' }, ruler, ...fxTracks(p),
    h('div', { class: 'tname' }, 'Vídeo'), vTrack, narrHead(p), aTrack, h('div', { class: 'tname' }, 'Legendas'), sTrack, sfxHead(p), xTrack, musicHead(p), mTrack, ph);
  inner.style.width = `${width}px`;
  return h('div', { class: 'tl', id: 'tl' }, inner);
}

/* ── efeitos: filtros, vinhetas e transições (cartões visuais) ── */
const FX_VIGNETTE: Array<[string, string]> = [['none', 'Sem vinheta'], ['soft', 'Suave'], ['strong', 'Forte']];
const FX_TRANS: Array<[string, string, string]> = [
  ['none', 'Corte seco', '✂️'], ['fade', 'Fade cruzado', '🌫️'], ['fadeblack', 'Fade p/ preto', '⬛'], ['fadewhite', 'Fade p/ branco', '⬜'], ['dissolve', 'Dissolver', '✨'],
  ['wipeleft', 'Cortina ←', '⬅️'], ['wiperight', 'Cortina →', '➡️'], ['slideleft', 'Deslizar ←', '⏪'], ['slideup', 'Deslizar ↑', '⏫'],
  ['circleopen', 'Círculo abre', '⭕'], ['circleclose', 'Círculo fecha', '🔘'], ['radial', 'Radial', '🌀'], ['pixelize', 'Pixelizar', '👾'], ['zoomin', 'Zoom', '🔍'], ['hblur', 'Desfoque', '💨'],
];
/** Grade de cartões com amostra visual; `onPick` recebe o valor. */
function fxTiles(kind: 'filter' | 'vignette' | 'transition', value: string, onPick: (v: string) => void): HTMLElement {
  const list: Array<[string, string, string?]> = kind === 'filter' ? FX_FILTERS : kind === 'vignette' ? FX_VIGNETTE : FX_TRANS;
  return h('div', { class: `fxtiles fx-${kind}s`, 'data-fx': kind }, ...list.map(([v, l, ico]) => {
    const sample = kind === 'transition'
      ? h('span', { class: 'fxsample tr' }, ico ?? '')
      : h('span', { class: `fxsample${kind === 'filter' ? ` fx-${v}` : ''}` }, kind === 'vignette' && v !== 'none' ? h('span', { class: `vig vig-${v}` }) : null);
    return h('button', { class: `fxtile${v === value ? ' sel' : ''}`, 'data-v': v, title: l, onclick: () => onPick(v) }, sample, h('span', {}, l));
  }));
}

type Fx = NonNullable<Scene['effects']>;
const FX_DEFAULT: Fx = { filter: 'none', zoom: 'none', fadeIn: false, fadeOut: false, vignette: 'none', transition: 'none', transitionSec: 0.6 };
const fxLabel = (kind: 'filter' | 'vignette' | 'transition', v?: string) =>
  (kind === 'filter' ? FX_FILTERS : kind === 'vignette' ? FX_VIGNETTE : FX_TRANS).find((x) => x[0] === (v ?? 'none'))?.[1] ?? v ?? '';

/** Aplica um patch de efeitos a várias cenas (cada cena mantém o resto dos seus efeitos). */
async function applyFx(p: Project, ids: string[], patch: (sc: Scene, i: number) => Partial<Fx>, msg: string) {
  const list = p.scenes.filter((s) => ids.includes(s.id));
  for (const [i, sc] of list.entries()) current = (await forge.updateScene(p.id, sc.id, { effects: { ...FX_DEFAULT, ...(sc.effects ?? {}), ...patch(sc, i) } }, false)).project;
  toast(`${msg} Use "Renderizar final" para gravar no vídeo.`); renderEditor(true);
}
/** Mesma transição em todas as junções do vídeo (a última cena não tem próxima). */
const transitionAll = (p: Project, kind: string, sec: number) =>
  applyFx(p, p.scenes.map((s) => s.id), (sc) => ({ transition: (sc.index === p.scenes.length ? 'none' : kind) as Fx['transition'], transitionSec: sec }), `Transição "${fxLabel('transition', kind)}" em todo o vídeo.`);
/** Transições aleatórias em todo o vídeo: variadas, sem repetir a anterior, duração 0,4–0,9 s. */
function randomTransitions(p: Project) {
  const pool = FX_TRANS.map((x) => x[0]).filter((v) => v !== 'none');
  let prev = '';
  const picks = p.scenes.map((sc) => {
    if (sc.index === p.scenes.length) return { t: 'none', s: 0.6 };
    let t = pool[Math.floor(Math.random() * pool.length)]!;
    while (t === prev && pool.length > 1) t = pool[Math.floor(Math.random() * pool.length)]!;
    prev = t;
    return { t, s: Math.round((0.4 + Math.random() * 0.5) * 10) / 10 };
  });
  return applyFx(p, p.scenes.map((s) => s.id), (_sc, i) => ({ transition: picks[i]!.t as Fx['transition'], transitionSec: picks[i]!.s }), 'Transições aleatórias aplicadas em todo o vídeo.');
}

/* ── trechos de filtro/vinheta (timeline estilo CapCut) ── */
const segsOf = (p: Project) => p.fxSegments ?? [];
const rangeOf = (p: Project, ids: string[]) => {
  const idx = p.scenes.map((s, i) => (ids.includes(s.id) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return { a: 0, b: totalOf(p) };
  return { a: sceneStart(p, Math.min(...idx)), b: sceneStart(p, Math.max(...idx)) + dur(p.scenes[Math.max(...idx)]!) };
};
async function saveSegs(p: Project, segs: FxSegment[], msg?: string) {
  current = await forge.updateProject(p.id, { fxSegments: segs });
  if (msg) toast(`${msg} Use "Renderizar final" para gravar no vídeo.`);
  renderEditor(true);
}
/**
 * Aplica filtro/vinheta. mode 'replace' troca o efeito da camada de base no intervalo;
 * mode 'add' coloca POR CIMA, numa camada livre (vários efeitos no mesmo vídeo, como no CapCut).
 */
function applySeg(p: Project, kind: FxSegment['kind'], value: string, scope: { ids?: string[]; all?: boolean; seg?: FxSegment }, mode: 'replace' | 'add' = 'replace') {
  const total = totalOf(p);
  let segs = segsOf(p);
  const r = scope.all ? { a: 0, b: total } : rangeOf(p, scope.ids ?? []);
  if (scope.seg) segs = value === 'none' ? segs.filter((s) => s.id !== scope.seg!.id) : segs.map((s) => (s.id === scope.seg!.id ? { ...s, value } : s));
  else if (mode === 'add' && value !== 'none') segs = addSegLayer(segs, kind, value, r.a, r.b, total, !!scope.all);
  else segs = placeSeg(segs, kind, value, r.a, r.b, total, !!scope.all, 0);
  const what = `${kind === 'filter' ? 'Filtro' : 'Vinheta'} "${fxLabel(kind, value)}"`;
  return saveSegs(p, segs, value === 'none' ? `${kind === 'filter' ? 'Filtro' : 'Vinheta'} removido(a).` : `${what} ${mode === 'add' && !scope.seg ? 'adicionado(a) por cima' : 'aplicado(a)'}${scope.all ? ' em todo o vídeo' : scope.seg ? ' no trecho' : ' nas cenas escolhidas'}.`);
}

/** Valor CSS de cada filtro (prévia): vários filtros empilham na mesma cena. */
const FILTER_CSS: Record<string, string> = {
  bw: 'grayscale(1)', sepia: 'sepia(.9)', vivid: 'saturate(1.5) contrast(1.06)', warm: 'sepia(.25) saturate(1.25) hue-rotate(-8deg)', cool: 'saturate(1.1) hue-rotate(14deg)', blur: 'blur(3px)',
  cinematic: 'contrast(1.1) saturate(.9) hue-rotate(-4deg)', teal_orange: 'saturate(1.15) hue-rotate(-10deg) contrast(1.05)', vintage: 'sepia(.35) contrast(.92) saturate(.85) brightness(1.04)',
  noir: 'grayscale(1) contrast(1.35) brightness(.97)', matte: 'contrast(.86) saturate(.85) brightness(1.05)', dramatic: 'contrast(1.25) saturate(1.15) brightness(.95)',
};

/**
 * Faixas de efeitos acima dos clipes (estilo CapCut): uma LINHA por camada. Cada trecho
 * se arrasta (mover), estica pelas bordas e sobe/desce de camada arrastando na vertical.
 * Ímã nas divisas das cenas, no começo e no fim. Clique sem arrastar abre o exibidor.
 */
function fxTracks(p: Project): HTMLElement[] {
  const total = totalOf(p);
  const cuts = [0, ...p.scenes.map((_, i) => sceneStart(p, i + 1))];
  const snap = (t: number) => { const near = cuts.reduce((b, c) => (Math.abs(c - t) < Math.abs(b - t) ? c : b), cuts[0]!); return Math.abs(near - t) * pxPerSec < 8 ? near : Math.round(t * 10) / 10; };
  const ROW = 30;
  const rows = (kind: FxSegment['kind']) => {
    const n = layersOf(p.fxSegments, kind);
    const out: HTMLElement[] = [];
    for (let layer = n - 1; layer >= 0; layer--) {   // camadas de cima aparecem em cima
      const tr = h('div', { class: 'track fxtrack', 'data-track': kind, 'data-layer': String(layer) });
      for (const sg of segsOf(p).filter((s) => s.kind === kind && (s.layer ?? 0) === layer)) {
        const end = segEnd(sg, total);
        const bar = h('div', { class: `bar fx ${kind}${sg.toEnd ? ' toend' : ''}`, 'data-seg': sg.id, title: `${fxLabel(kind, sg.value)} · camada ${layer + 1} · ${sg.start.toFixed(1)}s → ${sg.toEnd ? 'fim' : end.toFixed(1) + 's'} — arraste (também para cima/baixo), puxe as bordas, clique para trocar` },
          h('span', { class: 'hd l', title: 'Puxe para mudar o início' }),
          kind === 'filter' ? h('span', { class: `fxdot fx-${sg.value}` }) : h('span', { class: 'fxdot vigdot' }),
          h('span', { class: 'lbl' }, fxLabel(kind, sg.value)),
          h('span', { class: 'x', title: 'Remover este trecho', onclick: (e) => { e.stopPropagation(); void saveSegs(p, segsOf(p).filter((s) => s.id !== sg.id), 'Trecho removido.'); } }, '×'),
          h('span', { class: 'hd r', title: 'Puxe para mudar o fim' }));
        bar.style.left = `${sg.start * pxPerSec}px`; bar.style.width = `${Math.max(6, (end - sg.start) * pxPerSec - 2)}px`;
        bar.addEventListener('mousedown', (e) => {
          if ((e.target as HTMLElement).classList.contains('x')) return;
          e.preventDefault(); e.stopPropagation();
          const mode = (e.target as HTMLElement).classList.contains('l') ? 'l' : (e.target as HTMLElement).classList.contains('r') ? 'r' : 'move';
          const x0 = e.clientX, y0 = e.clientY; let s = sg.start, en = end, moved = false, dl = 0;
          const move = (m: MouseEvent) => {
            const dt = (m.clientX - x0) / pxPerSec; if (Math.abs(m.clientX - x0) > 3 || Math.abs(m.clientY - y0) > 6) moved = true;
            if (mode === 'move') {
              const len = end - sg.start; s = Math.max(0, Math.min(total - len, snap(sg.start + dt))); en = s + len;
              dl = Math.max(-layer, Math.min(9 - layer, -Math.round((m.clientY - y0) / ROW)));   // para cima = camada maior
              bar.style.transform = `translateY(${-dl * ROW}px)`;
            } else if (mode === 'l') s = Math.max(0, Math.min(en - 0.2, snap(sg.start + dt)));
            else en = Math.min(total, Math.max(s + 0.2, snap(end + dt)));
            bar.style.left = `${s * pxPerSec}px`; bar.style.width = `${Math.max(6, (en - s) * pxPerSec - 2)}px`;
          };
          const up = () => {
            window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
            if (!moved) { openFxViewer(p, [], kind, sg); return; }
            const others = segsOf(p).filter((x) => x.id !== sg.id);
            void saveSegs(p, placeSeg(others, kind, sg.value, s, en, total, en >= total - 0.01, layer + dl));
          };
          window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
        });
        tr.append(bar);
      }
      out.push(h('div', { class: 'tname' }, `${kind === 'filter' ? '🎨 Filtros' : '🔲 Vinhetas'}${n > 1 ? ` · camada ${layer + 1}` : ''} `, layer === n - 1 ? add(kind) : null), tr);
    }
    return out;
  };
  const add = (kind: FxSegment['kind']) => h('button', { class: 'tadd', title: `Adicionar ${kind === 'filter' ? 'filtro' : 'vinheta'} por cima (nova camada nas cenas selecionadas)`, onclick: () => openFxViewer(p, selected.length ? selected : p.scenes.map((s) => s.id), kind, undefined, 'add') }, '＋');
  return [...rows('filter'), ...rows('vignette')];
}

/**
 * Exibidor de efeitos (janela): prévia com o efeito ao vivo, cartões de filtro/vinheta/transição
 * e o alcance (cenas escolhidas, todo o vídeo ou o trecho clicado na timeline).
 */
function openFxViewer(p: Project, ids: string[], focus: 'filter' | 'vignette' | 'transition' = 'filter', seg?: FxSegment, mode0: 'replace' | 'add' = 'replace') {
  let mode = mode0;
  let scope: 'sel' | 'all' | 'seg' = seg ? 'seg' : ids.length === p.scenes.length && p.scenes.length > 1 ? 'all' : 'sel';
  let tab: 'filter' | 'vignette' | 'transition' = seg ? seg.kind : focus;
  if (!ids.length) ids = selected.length ? [...selected] : p.scenes.slice(0, 1).map((s) => s.id);
  const box = h('div', { class: 'modal pmodal fxviewer', id: 'fx-viewer' });
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } }, box);
  const sceneForPreview = () => {
    if (scope === 'seg' && seg) { const t = seg.start + 0.01; return p.scenes.find((_, i) => sceneStart(p, i) <= t && t < sceneStart(p, i) + dur(p.scenes[i]!)) ?? p.scenes[0]; }
    return p.scenes.find((s) => s.id === ids[0]) ?? p.scenes[0];
  };
  const valueNow = (kind: FxSegment['kind']) => {
    if (scope === 'seg' && seg) { const sg = seg; return (segsOf(p).find((s) => s.id === sg.id)?.value) ?? (sg.kind === kind ? sg.value : 'none'); }
    const sc = sceneForPreview(); if (!sc) return 'none';
    const vals = segsAt(segsOf(p), kind, sceneStart(p, p.scenes.indexOf(sc)) + 0.01, totalOf(p));
    return vals[vals.length - 1] ?? 'none';
  };
  const stagePreview = (enter?: string) => {
    const sc = sceneForPreview();
    const st = h('div', { class: 'stage fxstage' });
    if (!sc) return st;
    const vis = pickVisual(sc);
    const filter = valueNow('filter'), vig = valueNow('vignette');
    const layer = h('div', { class: `pv-layer${filter !== 'none' ? ' fx-' + filter : ''}${enter ? ' tr-' + enter : ''}` });
    if (enter) layer.style.animationDuration = `${Math.max(0.5, sc.effects?.transitionSec ?? 0.6)}s`;
    layer.append(vis ? (vis.video ? (() => { const v = h('video', { src: forge.mediaUrl(vis.path), autoplay: true, loop: true, playsinline: true }); v.muted = true; return v; })() : h('img', { src: forge.mediaUrl(vis.path) }))
      : h('div', { class: 'fxsample big' }));
    if (vig !== 'none') layer.append(h('div', { class: `vig vig-${vig}` }));
    st.append(layer, h('div', { class: 'scnum' }, scope === 'seg' && seg ? `trecho ${seg.start.toFixed(1)}s → ${seg.toEnd ? 'fim' : seg.end.toFixed(1) + 's'}` : `cena ${sc.index}`));
    return st;
  };
  const after = (enter?: string) => { p = current!; if (seg) seg = segsOf(p).find((s) => s.id === seg!.id) ?? seg; paint(enter); };
  const paint = (enter?: string) => {
    const sc = sceneForPreview();
    const tabs = h('div', { class: 'seg' }, ...([['filter', '🎨 Filtros'], ['vignette', '🔲 Vinhetas'], ...(scope === 'seg' ? [] : [['transition', '🔀 Transições']])] as Array<[typeof tab, string]>).map(([v, l]) =>
      h('button', { class: tab === v ? 'on' : '', onclick: () => { tab = v; paint(); } }, l)));
    const scopes = h('div', { class: 'seg' }, ...([...(seg ? [['seg', `Este trecho (${fxLabel(seg.kind, seg.value)})`]] : []), ['sel', `Cena(s) escolhida(s) · ${ids.length}`], ['all', `Todo o vídeo · ${p.scenes.length} cenas`]] as Array<[typeof scope, string]>).map(([v, l]) =>
      h('button', { class: scope === v ? 'on' : '', 'data-scope': v, onclick: () => { scope = v; if (v === 'seg' && seg) tab = seg.kind; paint(); } }, l)));
    const sec = h('input', { type: 'number', min: '0.2', max: '2', step: '0.1', value: String(sc?.effects?.transitionSec ?? 0.6), class: 'num', id: 'fxv-sec' }) as HTMLInputElement;
    const trTarget = () => scope === 'all' ? p.scenes.map((s) => s.id) : ids;
    box.replaceChildren(
      h('div', { class: 'row' }, h('h3', {}, '✨ Exibidor de efeitos'), h('span', { class: 'sp' }), h('button', { onclick: close, title: 'Fechar (Esc)' }, '✕')),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Aplicar em:'), scopes,
        scope === 'seg' || tab === 'transition' ? '' : h('div', { class: 'seg', id: 'fxv-mode' }, ...([['replace', '↔ Substituir'], ['add', '➕ Adicionar por cima (nova camada)']] as Array<[typeof mode, string]>).map(([v, l]) =>
          h('button', { class: mode === v ? 'on' : '', 'data-mode': v, onclick: () => { mode = v; paint(); } }, l)))),
      h('div', { class: 'fxv-grid' },
        h('div', {}, stagePreview(enter), h('div', { class: 'muted' }, `Aqui: filtro ${fxLabel('filter', valueNow('filter')).toLowerCase()} · vinheta ${fxLabel('vignette', valueNow('vignette')).toLowerCase()}${sc ? ` · transição ${fxLabel('transition', sc.effects?.transition).toLowerCase()}` : ''}`),
          h('div', { class: 'muted' }, 'Filtros e vinhetas viram trechos na timeline: arraste para mover e puxe as bordas para ajustar.')),
        h('div', {}, tabs,
          tab === 'transition'
            ? h('div', {}, fxTiles('transition', sc?.effects?.transition ?? 'none', (v) => void applyFx(p, trTarget(), (s) => ({ transition: (s.index === p.scenes.length ? 'none' : v) as Fx['transition'], transitionSec: Number(sec.value) || 0.6 }), scope === 'all' ? 'Transição em todo o vídeo.' : 'Transição aplicada.').then(() => after(v))),
              h('div', { class: 'row' }, h('label', {}, 'Duração (s)', sec),
                h('button', { id: 'fxv-random', onclick: () => void randomTransitions(p).then(() => { scope = 'all'; after(); }) }, '🎲 Transições aleatórias em todo o vídeo'),
                h('button', { onclick: () => void transitionAll(p, 'none', 0.6).then(() => after()) }, '✂️ Remover todas')))
            : h('div', {}, fxTiles(tab, valueNow(tab), (v) => void applySeg(p, tab as FxSegment['kind'], v, scope === 'seg' ? { seg } : scope === 'all' ? { all: true } : { ids }, mode).then(() => after())),
              scope === 'seg' && seg ? h('div', { class: 'row' }, h('button', { class: 'danger', onclick: () => void saveSegs(p, segsOf(p).filter((s) => s.id !== seg!.id), 'Trecho removido.').then(close) }, '🗑 Remover este trecho')) : ''))));
  };
  document.addEventListener('keydown', onKey);
  document.body.append(bg); paint();
}

/** Efeitos das cenas selecionadas: filtro/vinheta viram trechos da timeline; transição e movimento são da cena. */
function effectsCard(p: Project, sel: Scene[]): HTMLElement {
  if (!sel.length) return h('div', { class: 'card muted' }, 'Selecione cenas para aplicar efeitos.');
  const base: Fx = { ...FX_DEFAULT, ...(sel[0]!.effects ?? {}) };
  const ids = sel.map((s) => s.id);
  const t0 = sceneStart(p, p.scenes.indexOf(sel[0]!)) + 0.01;
  const apply = (patch: Partial<Fx>) => void applyFx(p, ids, () => patch, `Efeito aplicado a ${sel.length} cena(s).`);
  const z = h('select', { id: 'fx-zoom' }, ...FX_ZOOM.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement; z.value = base.zoom ?? 'none';
  z.addEventListener('change', () => apply({ zoom: z.value as 'none' | 'in' | 'out' }));
  const fi = h('input', { type: 'checkbox', id: 'fx-fadein' }) as HTMLInputElement; fi.checked = !!base.fadeIn; fi.addEventListener('change', () => apply({ fadeIn: fi.checked }));
  const fo = h('input', { type: 'checkbox', id: 'fx-fadeout' }) as HTMLInputElement; fo.checked = !!base.fadeOut; fo.addEventListener('change', () => apply({ fadeOut: fo.checked }));
  const tsec = h('input', { type: 'number', min: '0.2', max: '2', step: '0.1', value: String(base.transitionSec ?? 0.6), class: 'num', id: 'fx-trsec' }) as HTMLInputElement;
  tsec.addEventListener('change', () => apply({ transitionSec: Math.min(2, Math.max(0.2, Number(tsec.value) || 0.6)) }));
  const isLast = sel.length === 1 && sel[0]!.index === p.scenes.length;
  return h('div', { class: 'card', id: 'fx-card' },
    h('div', { class: 'row' }, h('span', { class: 'ico' }, icon('fx')), h('strong', {}, `Efeitos ${sel.length > 1 ? `(${sel.length} cenas)` : `da cena ${sel[0]!.index}`}`), h('span', { class: 'sp' }),
      h('button', { class: 'small primary', id: 'fx-open-viewer', onclick: () => openFxViewer(p, ids) }, '✨ Abrir exibidor de efeitos')),
    h('h4', {}, '🎨 Filtro de cor ', h('span', { class: 'muted' }, '— vira um trecho na faixa "Filtros"')), fxTiles('filter', segAt(p.fxSegments, 'filter', t0, totalOf(p)), (v) => void applySeg(p, 'filter', v, { ids })),
    h('h4', {}, '🔲 Vinheta'), fxTiles('vignette', segAt(p.fxSegments, 'vignette', t0, totalOf(p)), (v) => void applySeg(p, 'vignette', v, { ids })),
    h('h4', {}, '🔀 Transição para a próxima cena', isLast ? h('span', { class: 'muted' }, ' — última cena: sem próxima') : null),
    fxTiles('transition', base.transition ?? 'none', (v) => apply({ transition: v as Fx['transition'] })),
    h('div', { class: 'row' },
      h('button', { class: 'small', id: 'fx-tr-all', title: 'Usa a transição desta cena em todas as junções do vídeo', onclick: () => void transitionAll(p, base.transition && base.transition !== 'none' ? base.transition : 'fade', base.transitionSec ?? 0.6) }, '🔁 Esta transição em todo o vídeo'),
      h('button', { class: 'small', id: 'fx-tr-random', onclick: () => void randomTransitions(p) }, '🎲 Transições aleatórias em todo o vídeo')),
    h('div', { class: 'row' }, h('label', {}, 'Duração da transição (s)', tsec), h('label', {}, 'Movimento', z),
      h('label', { class: 'inline chk' }, fi, 'Fade in'), h('label', { class: 'inline chk' }, fo, 'Fade out'),
      h('button', { class: 'small', onclick: () => apply({ zoom: 'none', fadeIn: false, fadeOut: false, transition: 'none' }) }, 'Limpar efeitos da cena')));
}

/** Vídeo final: filtro/vinheta em todo o vídeo (trecho até o fim) + grão de filme e faixas de cinema. */
function finalFxCard(p: Project): HTMLElement {
  const fe = { grain: false, letterbox: false, ...(p.finalEffects ?? {}) };
  const total = totalOf(p);
  const save = (patch: Partial<NonNullable<Project['finalEffects']>>) => void guard(async () => {
    current = await forge.updateProject(p.id, { finalEffects: { ...fe, ...patch } }); toast('Acabamento do vídeo final atualizado. Use "Renderizar final" para gravar.'); renderEditor(true);
  });
  const whole = (kind: FxSegment['kind']) => segsOf(p).find((s) => s.kind === kind && s.start <= 0.01 && segEnd(s, total) >= total - 0.01)?.value ?? 'none';
  const gr = h('input', { type: 'checkbox', id: 'ffx-grain' }) as HTMLInputElement; gr.checked = !!fe.grain; gr.addEventListener('change', () => save({ grain: gr.checked }));
  const lb = h('input', { type: 'checkbox', id: 'ffx-letterbox' }) as HTMLInputElement; lb.checked = !!fe.letterbox; lb.addEventListener('change', () => save({ letterbox: lb.checked }));
  return h('div', { class: 'card', id: 'final-fx-card' },
    h('div', { class: 'row' }, h('span', { class: 'ico' }, '🎞️'), h('strong', {}, 'Vídeo inteiro'), h('span', { class: 'muted' }, 'filtro e vinheta do começo ao fim (viram trechos na timeline)')),
    h('h4', {}, '🎨 Filtro de cor'), fxTiles('filter', whole('filter'), (v) => void applySeg(p, 'filter', v, { all: true })),
    h('h4', {}, '🔲 Vinheta'), fxTiles('vignette', whole('vignette'), (v) => void applySeg(p, 'vignette', v, { all: true })),
    h('div', { class: 'row' }, h('label', { class: 'inline chk' }, gr, '🎬 Grão de filme'), h('label', { class: 'inline chk' }, lb, '▬ Faixas de cinema (letterbox)')));
}

/** Estilo das legendas do projeto (prévia + opção de gravar no vídeo). */
function subtitlesCard(p: Project): HTMLElement {
  const st = { ...subStyle(p) };
  const burn = h('input', { type: 'checkbox', id: 'sub-burn' }) as HTMLInputElement; burn.checked = st.burn;
  /* posição: 3 botões (embaixo / meio / em cima) */
  let position: 'bottom' | 'middle' | 'top' = st.position;
  const posBtns = ([['top', '⬆ Em cima'], ['middle', '⏺ Meio'], ['bottom', '⬇ Embaixo']] as const).map(([v, label]) =>
    h('button', { class: `small${position === v ? ' on' : ''}`, 'data-sub-pos': v, onclick: () => { position = v; posBtns.forEach((b) => b.classList.toggle('on', b.dataset['subPos'] === v)); save(); } }, label) as HTMLButtonElement);
  const kind = h('select', { id: 'sub-kind' }, ...SUB_KINDS.map(([v, label]) => h('option', { value: v }, label))) as HTMLSelectElement;
  kind.value = st.kind ?? (st.box ? 'box' : 'classic');
  const size = h('input', { type: 'number', min: '16', max: '120', value: String(st.size), id: 'sub-size', class: 'num' }) as HTMLInputElement;
  const color = h('input', { type: 'color', value: st.color, id: 'sub-color' }) as HTMLInputElement;
  const accent = h('input', { type: 'color', value: st.accent ?? (kind.value === 'neon' ? '#00e5ff' : '#ffe14d'), id: 'sub-accent', title: 'Cor de destaque (palavra falada, preenchimento do karaokê, brilho do neon)' }) as HTMLInputElement;
  const show = h('input', { type: 'checkbox', id: 'sub-show' }) as HTMLInputElement; show.checked = showSubs;
  show.addEventListener('change', () => { showSubs = show.checked; showScene(p.scenes.find((s) => s.id === selected[0])); });
  /* modo das legendas (projetos antigos sem modo: .srt sempre + "gravar" pelo estilo) */
  const mode = subtitlesSelect('sub-mode', p.subtitles ?? (st.burn ? 'burn' : 'srt'));
  const paintMode = () => { burn.checked = mode.value === 'burn'; for (const el of [kind, size, color, accent, ...posBtns]) el.disabled = mode.value === 'off'; };
  paintMode();
  const style = () => ({ burn: mode.value === 'burn', position, size: Number(size.value) || 46, color: color.value, box: kind.value === 'box', kind: kind.value, accent: accent.value });
  const save = () => void guard(async () => {
    current = await forge.updateProject(p.id, { subtitles: mode.value, subtitleStyle: style() } as never);
    showScene(current.scenes.find((s) => s.id === selected[0]));
  });
  mode.addEventListener('change', () => { paintMode(); save(); toast(mode.value === 'off' ? 'Legendas desligadas — use "Renderizar final" para tirar do vídeo' : 'Legendas ligadas — use "Renderizar final" para aplicar (as cenas não são refeitas)'); });
  burn.addEventListener('change', () => { mode.value = burn.checked ? 'burn' : 'srt'; paintMode(); save(); });
  [kind, size, color, accent].forEach((el) => el.addEventListener('change', save));
  /* criar agora: liga "gravar no vídeo" se estiver desligado, salva o estilo e refaz só legendas + montagem */
  const create = h('button', { class: 'primary small', id: 'sub-create', title: 'Gera as legendas (tempos da fala) no tipo e posição escolhidos e grava no vídeo final — as cenas não são refeitas', onclick: () => void guard(async () => {
    if (mode.value !== 'burn') { mode.value = 'burn'; paintMode(); }
    showSubs = true; show.checked = true;
    current = await forge.updateProject(p.id, { subtitles: 'burn', subtitleStyle: style() } as never);
    (document.getElementById('btn-final') as HTMLButtonElement | null)?.click();
  }) }, '🔤 Criar legendas no vídeo');
  return h('div', { class: 'card', id: 'sub-card' },
    h('div', { class: 'row' }, h('span', { class: 'ico' }, icon('text')), h('strong', {}, 'Legendas'), h('label', {}, 'Gerar', mode), h('label', { class: 'inline chk' }, show, 'mostrar na prévia'), create),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Posição'), h('div', { class: 'seg', id: 'sub-pos' }, ...posBtns)),
    h('div', { class: 'row' }, h('label', {}, 'Tipo', kind), h('label', {}, 'Tamanho (px)', size), h('label', {}, 'Cor', color), h('label', {}, 'Destaque', accent),
      h('label', { class: 'inline chk' }, burn, 'gravar no vídeo final')),
    h('div', { class: 'muted' }, 'O texto de cada cena é editado no campo "Legenda" da cena (vazio = usa a narração, nos tempos reais das palavras). Depois de mudar, "Renderizar final" (ou "Criar legendas") refaz só legendas e montagem.'));
}

/** Conta do Antigravity (Automações): vazio = a conta padrão. Preenchido de forma assíncrona. */
function agyAccountSelect(id: string, value = '', onChange?: (v: string) => void, kind: 'agy' | 'flow' = 'agy'): HTMLSelectElement {
  const sel = h('select', { id }, h('option', { value: '' }, 'padrão de Automações')) as HTMLSelectElement;
  void (forge as unknown as { autoGet: () => Promise<unknown> }).autoGet().then((raw) => { const st = raw as { config?: { agyAccount?: string }; accounts?: Array<{ id: string; label: string; email?: string; hasAgy?: boolean; hasProfile?: boolean; credits?: { value?: number } }> };
    const def = st.accounts?.find((a) => a.id === st.config?.agyAccount);
    sel.replaceChildren(h('option', { value: '' }, kind === 'flow' ? 'a da etapa da rota (ou a primeira com login)' : def ? `padrão de Automações (${def.label})` : 'padrão (sessão normal do Windows)'),
      ...(st.accounts ?? []).map((a) => h('option', { value: a.id }, `${a.label}${a.email ? ` · ${a.email}` : ''}${kind === 'flow' ? (a.credits?.value !== undefined ? ` · 💳 ${a.credits.value}` : '') + (a.hasProfile ? '' : ' (sem login)') : a.hasAgy ? '' : ' (sem login no Antigravity)'}`)));
    sel.value = value;
  }).catch(() => {});
  if (onChange) sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/** Canal de destino (aba Canais): vazio = pergunta na hora de publicar. Preenchido de forma assíncrona. */
function channelSelect(id: string, value = '', onChange?: (v: string) => void): HTMLSelectElement {
  const sel = h('select', { id }, h('option', { value: '' }, '— nenhum (escolher ao publicar) —')) as HTMLSelectElement;
  void (forge as unknown as { channelsGet: () => Promise<unknown> }).channelsGet().then((raw) => {
    const st = raw as { list?: Array<{ id: string; name: string; platform: string; handle?: string }>; platforms?: Record<string, { label: string; icon: string }> };
    const list = st.list ?? [];
    sel.replaceChildren(
      h('option', { value: '' }, list.length ? '— nenhum (escolher ao publicar) —' : '— nenhum canal criado ainda —'),
      ...list.map((c) => h('option', { value: c.id }, `${st.platforms?.[c.platform]?.icon ?? '📺'} ${c.name}${c.handle ? ` · ${c.handle}` : ''}`)),
    );
    sel.value = value;
  }).catch(() => {});
  if (onChange) sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/** Legendas da fala: não gerar / só o arquivo .srt / gravadas no vídeo. */
function subtitlesSelect(id: string, value: string): HTMLSelectElement {
  const s = h('select', { id }, h('option', { value: 'off' }, '🚫 Não gerar'), h('option', { value: 'srt' }, '📄 Só o arquivo .srt'), h('option', { value: 'burn' }, '🔤 Gravar no vídeo')) as HTMLSelectElement;
  s.value = ['off', 'srt', 'burn'].includes(value) ? value : 'off';
  return s;
}

/** Caixa "Sem limite de tempo": marcada, desabilita o campo de minutos (o valor salvo vira 0 = sem limite). */
function timeLimitToggle(id: string, minutes: HTMLInputElement, on: boolean): HTMLInputElement {
  const cb = h('input', { type: 'checkbox', id }) as HTMLInputElement;
  cb.checked = on; minutes.disabled = on;
  cb.addEventListener('change', () => { minutes.disabled = cb.checked; });
  h('label', { class: 'inline chk', title: 'A produção roda até terminar, sem interrupção por tempo' }, cb, '♾ Sem limite');
  return cb;
}

const FREE_ENGINE_TIP = 'Vídeo livre (prompt → harness): 2D desenha em Canvas e usa as bibliotecas dos plugins; 3D monta uma cena em Three.js (vem com o app, sem internet — bom para modelos de cenas 3D como o qwen3.5-3d-coder). Automático = 2D, ou 3D se a ideia pedir "3D"/"Three.js".';
function freeEngineSelect(id: string, value: string): HTMLSelectElement {
  const sel = h('select', { id },
    h('option', { value: '' }, 'Automático'), h('option', { value: '2d' }, '2D (Canvas + plugins)'), h('option', { value: '3d' }, '3D (Three.js)')) as HTMLSelectElement;
  sel.value = value;
  return sel;
}

/** Produção do projeto: tempo máximo e cenas simultâneas. */function productionCard(p: Project): HTMLElement {
  const flowAcc = agyAccountSelect('pj-flow', p.flowAccount ?? '', (v) => void guard(async () => { current = await forge.updateProject(p.id, { flowAccount: v }); toast(v ? 'Este projeto usa outra conta do Flow' : 'Flow: conta da etapa da rota'); }), 'flow');
  const agy = agyAccountSelect('pj-agy', p.agyAccount ?? '', (v) => void guard(async () => { current = await forge.updateProject(p.id, { agyAccount: v }); toast(v ? 'Este projeto usa outra conta do Antigravity' : 'Antigravity: conta padrão de Automações'); }));
  const max = h('input', { type: 'number', min: '5', step: '5', value: String(p.maxProductionMin || 60), id: 'pj-max', class: 'num' }) as HTMLInputElement;
  const noLimit = timeLimitToggle('pj-nolimit', max, !p.maxProductionMin);
  const conc = h('input', { type: 'number', min: '0', max: '8', value: String(p.sceneConcurrency ?? 0), id: 'pj-conc', class: 'num' }) as HTMLInputElement;
  const audioFirst = h('input', { type: 'checkbox', id: 'pj-audio-first' }) as HTMLInputElement; audioFirst.checked = p.audioFirst ?? true;
  const save = () => void guard(async () => { current = await forge.updateProject(p.id, { maxProductionMin: noLimit.checked ? 0 : Number(max.value) || 0, sceneConcurrency: Number(conc.value) || 0, audioFirst: audioFirst.checked } as never); toast(noLimit.checked ? 'Produção atualizada: sem limite de tempo' : 'Produção atualizada'); });
  [max, conc, noLimit, audioFirst].forEach((el) => el.addEventListener('change', save));
  const team = p.agents ? [p.agents.orchestrator ? `orquestrador: ${p.agents.orchestrator.name}` : '', p.agents.workers.length ? `obreiros: ${p.agents.workers.map((w) => w.name).join(', ')}` : ''].filter(Boolean).join(' · ') : '';
  /* vídeo livre: 2D (Canvas + plugins) ou 3D (Three.js) — só nas rotas com a etapa "free" */
  const engine = (p.route?.steps ?? []).some((st) => st.kind === 'free') ? freeEngineSelect('pj-free-engine', p.freeEngine ?? '') : null;
  engine?.addEventListener('change', () => void guard(async () => { current = await forge.updateProject(p.id, { freeEngine: engine.value || null } as never); toast(engine.value === '3d' ? 'Vídeo livre em 3D (Three.js) — vale na próxima execução' : engine.value === '2d' ? 'Vídeo livre em 2D (Canvas + plugins)' : 'Vídeo livre: 2D, ou 3D se a ideia pedir'); }));
  return h('div', { class: 'card', id: 'pj-card' },
    h('div', { class: 'row' }, h('span', { class: 'ico' }, icon('clock')), h('strong', {}, 'Produção'),
      h('label', { title: 'Ao atingir o tempo, a execução para (o que já foi gerado fica em cache)' }, 'Tempo máximo (min)', h('span', { class: 'row' }, max, noLimit.parentElement!)), h('label', { title: '0 = usa o padrão das Configurações · etapas de GPU local rodam uma por vez' }, 'Cenas simultâneas', conc),
      h('label', { class: 'inline chk', title: 'Narração e transcrição de todas as cenas antes dos clipes' }, audioFirst, '🎙 Narrar todas primeiro'),
      h('label', { title: 'Sessão do Antigravity usada pelas etapas deste projeto' }, '🪐 Conta do Antigravity', agy),
      h('label', { title: 'Conta do Google Flow usada pelas etapas de imagem/vídeo deste projeto' }, '🌊 Conta do Flow', flowAcc),
      engine ? h('label', { title: FREE_ENGINE_TIP }, '🎞 Vídeo livre', engine) : null),
    h('div', { class: 'muted' }, [p.skill?.name, p.route?.name, p.fold ? `🧬 dobra: ${p.fold.name}` : '', team, p.refScript ? 'roteiro de referência' : '', p.refVideo ? 'vídeo de referência' : ''].filter(Boolean).join(' · ')),
    h('div', { class: 'row', id: 'pj-tools' },
      h('button', { id: 'pj-replan', title: 'Refaz o plano de cenas deste projeto (quantidade e duração das cenas), com backup e mantendo o roteiro', onclick: () => void openReplanModal(p) }, '🎬 Ajustar cenas…'),
      h('span', { class: 'muted small' }, `${p.scenes.length} cena(s)${p.scenes.length ? ` · ≈ ${(p.scenes.reduce((a, s) => a + (s.durationSec ?? 0), 0) / p.scenes.length).toFixed(1)} s cada` : ''}${p.sceneSec ? ` · alvo ${p.sceneSec} s` : ''}`)),
    bypassBox(p));
}

/* ───────── bypass de executor do projeto (força um harness/modelo, sem mexer na rota) ───────── */
const BYPASS_SCOPE: Array<[string, string]> = [['ai', 'texto + código (roteiro, cenas, metadados, cenas por código)'], ['code', 'só cenas por código e motion'], ['text', 'só texto (roteiro, plano, metadados…)']];
function bypassBox(p: Project): HTMLElement {
  const box = h('div', { class: `pj-bypass${p.executorBypass?.enabled ? ' on' : ''}`, id: 'pj-bypass' });
  void (async () => {
    const cat = ((await guard(() => xapi()['catalog']!())) ?? { harnesses: [] }) as { harnesses: Array<{ id: string; models?: string[] }> };
    const bp = p.executorBypass;
    const harness = h('select', { id: 'pj-bp-harness' }, h('option', { value: '' }, '— escolha o harness —'), h('option', { value: 'auto' }, 'auto (o melhor instalado)'), ...cat.harnesses.map((x) => h('option', { value: x.id }, x.id))) as HTMLSelectElement;
    harness.value = bp?.binding.harness ?? '';
    const model = h('select', { id: 'pj-bp-model' }) as HTMLSelectElement;
    const paintModels = () => { const ms = cat.harnesses.find((x) => x.id === harness.value)?.models ?? []; model.replaceChildren(h('option', { value: '' }, 'modelo padrão do harness'), ...ms.map((m) => h('option', { value: m }, m))); model.value = bp?.binding.harness === harness.value ? bp?.binding.model ?? '' : ''; };
    paintModels();
    const scope = h('select', { id: 'pj-bp-scope' }, ...BYPASS_SCOPE.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement; scope.value = bp?.scope ?? 'ai';
    const excl = h('input', { type: 'checkbox', id: 'pj-bp-excl' }) as HTMLInputElement; excl.checked = !!bp?.exclusive;
    const on = h('input', { type: 'checkbox', id: 'pj-bp-on' }) as HTMLInputElement; on.checked = !!bp?.enabled;
    const targets = h('span', { class: 'muted small', id: 'pj-bp-targets' });
    const value = () => ({ binding: { type: 'harness', harness: harness.value, model: model.value || undefined }, scope: scope.value, exclusive: excl.checked, enabled: on.checked });
    const paintTargets = () => void guard(async () => {
      if (!harness.value) { targets.textContent = 'escolha um harness para ver as etapas atingidas'; return; }
      const ids = (await xapi()['bypassTargets']!(p.id, value())) as string[];
      targets.textContent = ids.length ? `etapas: ${ids.join(', ')}${excl.checked ? ' · SÓ este executor (sem reservas)' : ' · os executores da rota ficam de reserva'}` : 'nenhuma etapa deste projeto é atingida por este escopo';
    });
    const save = () => void guard(async () => {
      if (on.checked && !harness.value) { on.checked = false; toast('Escolha o harness do bypass.', true); return; }
      current = await forge.updateProject(p.id, { executorBypass: harness.value ? value() : null } as never);
      box.classList.toggle('on', on.checked);
      toast(on.checked ? `⚡ Bypass ligado: ${harness.value}${model.value ? '/' + model.value : ''} vale na próxima execução` : 'Bypass desligado: a rota volta a decidir os executores');
    });
    harness.addEventListener('change', () => { paintModels(); paintTargets(); save(); });
    [model, scope, excl, on].forEach((el) => el.addEventListener('change', () => { paintTargets(); save(); }));
    box.replaceChildren(
      h('div', { class: 'row' }, h('label', { class: 'inline chk', title: 'Força o harness/modelo escolhido nas etapas de IA deste projeto, só na execução — a rota não muda e dá para desligar' }, on, h('strong', {}, '⚡ Bypass de executor')),
        h('label', {}, 'Harness', harness), h('label', {}, 'Modelo', model), h('label', {}, 'Onde', scope),
        h('label', { class: 'inline chk', title: 'Ligado: só este executor (se falhar, a etapa falha). Desligado: ele vai à frente e os da rota ficam de reserva.' }, excl, 'exclusivo')),
      targets);
    paintTargets();
  })();
  return box;
}

/** Bypass de executor numa janela (a partir da barra de cima do editor). */
function openBypassModal(p: Project) {
  const close = () => { bg.remove(); renderEditor(true); };
  const bg = h('div', { class: 'modal-bg', id: 'bypass-modal', onclick: (e) => { if (e.target === bg) close(); } }, h('div', { class: 'modal pmodal' },
    h('div', { class: 'row' }, h('h3', {}, `⚡ Bypass de executor — ${p.name}`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
    h('p', { class: 'muted' }, 'Força o harness/modelo escolhido nas etapas de IA deste projeto só na hora de executar — a rota não muda e dá para desligar a qualquer momento. Voz, legendas, montagem, trilha, bancos de mídia e GPU local não são afetados.'),
    bypassBox(current && current.id === p.id ? current : p),
    h('div', { class: 'row actions pfoot' }, h('span', { class: 'sp' }), h('button', { class: 'primary', onclick: close }, 'Concluir'))));
  document.body.append(bg);
}

/** Ajustar cenas de um projeto existente: duração por cena, skill atual e o que fazer depois. */
async function openReplanModal(p: Project) {
  const n = p.scenes.length;
  const avg = n ? p.scenes.reduce((a, s) => a + (s.durationSec ?? 0), 0) / n : 0;
  const target = p.targetDurationSec || 60;
  const sec = h('input', { type: 'number', min: '3', max: '30', step: '0.5', value: String(p.sceneSec ?? Math.max(6, Math.min(14, Math.round(avg >= 6 ? avg : 10)))), id: 'rp-sec', class: 'num' }) as HTMLInputElement;
  const preview = h('strong', { id: 'rp-count' });
  const paintPreview = () => { const v = Math.max(3, Math.min(30, Number(sec.value) || 10)); preview.textContent = `≈ ${Math.max(1, Math.round(target / v))} cenas de ${v} s`; };
  sec.addEventListener('input', paintPreview); paintPreview();
  const refresh = h('input', { type: 'checkbox', id: 'rp-skill' }) as HTMLInputElement; refresh.checked = true;
  const run = h('select', { id: 'rp-run' }, h('option', { value: 'plan' }, '🧠 refazer só o plano agora (depois eu produzo)'), h('option', { value: 'all' }, '▶ refazer o plano e produzir tudo'), h('option', { value: 'none' }, '⏸ só preparar (eu executo depois)')) as HTMLSelectElement;
  const close = () => bg.remove();
  const go = h('button', { class: 'primary', id: 'rp-go', onclick: () => void guard(async () => {
    if (!await askConfirm(`Refazer o plano de cenas de "${p.name}"?\n\nAs ${n} cena(s) atuais (narrações, clipes e cenas por código) vão para um backup em projects/_backups; o roteiro é mantido.`)) return;
    const r = (await xapi()['replanProject']!(p.id, { sceneSec: Number(sec.value) || undefined, refreshSkill: refresh.checked, run: run.value })) as { project: Project; backup: string; oldScenes: number; running: boolean };
    current = r.project; close();
    toast(`Plano refeito: ${r.oldScenes} cena(s) antigas no backup${r.running ? ' — gerando o novo plano…' : ''}`);
    void render();
  }) }, '🎬 Ajustar cenas');
  const bg = h('div', { class: 'modal-bg', id: 'replan-modal', onclick: (e) => { if (e.target === bg) close(); } }, h('div', { class: 'modal pmodal' },
    h('div', { class: 'row' }, h('h3', {}, `🎬 Ajustar cenas — ${p.name}`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
    h('p', { class: 'muted' }, `Hoje: ${n} cena(s)${n ? ` de ≈ ${avg.toFixed(1)} s` : ''} para ${target} s de vídeo. Menos cenas = menos chamadas à IA (cada cena por código é uma chamada) e produção mais rápida; os cortes e mudanças de enquadramento ficam DENTRO de cada cena. O roteiro é mantido; narrações e clipes por cena são refeitos.`),
    h('div', { class: 'row' }, h('label', {}, 'Duração média de cada cena (s)', sec), preview),
    h('label', { class: 'inline chk', title: 'Usa a skill como está agora na biblioteca (com as correções mais recentes) em vez da cópia guardada no projeto' }, refresh, `🧠 usar a versão atual da skill "${p.skill?.name ?? p.skillId ?? ''}"`),
    h('label', {}, 'Depois', run),
    h('div', { class: 'muted small' }, '🗂 Backup automático em projects/_backups (fora da pasta do projeto, para nenhuma IA reler o plano antigo).'),
    h('div', { class: 'row actions pfoot' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Cancelar'), go)));
  document.body.append(bg);
}

/** Plugins no formato Claude ativos neste projeto (opcional). */
/** Voz da narração do projeto no editor (troca a voz e marca a narração para refazer). */
let voiceCatalog: Array<{ provider: string; kind: string; voices: string[] }> | undefined;
let voiceList: Array<{ name: string; path: string }> = [];
function voiceCard(p: Project): HTMLElement {
  const holder = h('div', { id: 'pj-voice' });
  void (async () => {
    if (!voiceCatalog) { voiceCatalog = ((await guard(() => (forge as unknown as Record<string, () => Promise<unknown>>)['catalog']!())) as { apis: Array<{ provider: string; kind: string; voices: string[] }> } | undefined)?.apis ?? []; voiceList = (await forge.meta()).voices ?? []; }
    holder.replaceChildren(voicePicker({ forge: forge as unknown as Parameters<typeof voicePicker>[0]['forge'], guard, route: p.route, language: p.language, value: { ...(p.narrationVoice ?? {}) }, voices: voiceList, apis: voiceCatalog,
      onChange: (v) => void guard(async () => { current = await forge.updateProject(p.id, { narrationVoice: v }); toast('Voz do projeto salva. A narração das cenas foi marcada para refazer (▶ Executar rota ou ↻ Regenerar).'); }) }));
  })();
  return holder;
}

/** Arquivos do usuário: entram no prompt e na produção (cena, trilha, foto de personagem ou referência). */
function attachmentsCard(p: Project): HTMLElement {
  const list = p.attachments ?? [];
  const save = (pr: Promise<Project>, msg?: string) => void guard(async () => { current = await pr; if (msg) toast(msg); renderEditor(true); });
  const ICON: Record<Attachment['kind'], string> = { image: '🖼', video: '🎬', audio: '🎵', text: '📄', other: '📦' };
  const USES: Array<[Attachment['use'], string, Array<Attachment['kind']>]> = [
    ['scene', 'usar numa cena', ['image', 'video']], ['character', 'foto de personagem', ['image']], ['music', 'trilha sonora', ['audio']], ['reference', 'referência', ['image', 'video', 'audio', 'text', 'other']]];
  const rows = list.map((a) => {
    const use = h('select', { 'data-attach-use': a.file }, ...USES.filter(([, , k]) => k.includes(a.kind)).map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
    use.value = a.use;
    use.addEventListener('change', () => save(forge.setAttachment(p.id, a.file, { use: use.value as Attachment['use'] })));
    const who = h('input', { placeholder: 'nome do personagem', value: a.character ?? '', class: 'grow', title: 'O mesmo nome usado no roteiro/bíblia (ex.: Ji-woo)' }) as HTMLInputElement;
    who.addEventListener('change', () => save(forge.setAttachment(p.id, a.file, { character: who.value }), 'Personagem salvo'));
    const note = h('input', { placeholder: 'o que é / como usar (vai no prompt)', value: a.note ?? '', class: 'grow' }) as HTMLInputElement;
    note.addEventListener('change', () => save(forge.setAttachment(p.id, a.file, { note: note.value }), 'Nota salva'));
    return h('div', { class: 'attach-row' },
      h('div', { class: 'row' }, h('span', { title: a.file }, `${ICON[a.kind]} ${a.file}`), h('span', { class: 'sp' }), use,
        h('button', { class: 'small danger', title: 'Remover do projeto', onclick: () => { if (confirm(`Remover "${a.file}" do projeto?`)) save(forge.detach(p.id, a.file), 'Arquivo removido'); } }, '✕')),
      h('div', { class: 'row' }, a.use === 'character' ? who : null, note));
  });
  return h('div', { class: 'card', id: 'pj-attachments' },
    h('div', { class: 'row' }, h('strong', {}, '📎 Arquivos do projeto'), h('span', { class: 'sp' }),
      h('button', { class: 'small', onclick: () => save(forge.attach(p.id, { mode: 'files' }), 'Arquivos adicionados') }, '+ Arquivos'),
      h('button', { class: 'small', onclick: () => save(forge.attach(p.id, { mode: 'folder' }), 'Pasta adicionada') }, '+ Pasta')),
    list.length ? h('div', {}, ...rows) : h('div', { class: 'muted' }, 'Imagens, vídeos, áudios ou textos seus: entram no prompt do roteiro, do plano e das cenas, e podem virar cena, trilha ou foto de personagem.'),
    list.length ? h('div', { class: 'muted small' }, 'Mudanças valem nas próximas etapas. Para refazer o plano com os arquivos, use "Planejar cenas" de novo; para uma cena, escolha o arquivo no inspetor da cena.') : null);
}

function pluginsCard(p: Project): HTMLElement {
  if (!pluginCache.length) {
    return h('div', { class: 'card', id: 'pj-plugins' },
      h('div', { class: 'row' }, h('span', { class: 'ico' }, icon('skills')), h('strong', {}, 'Plugins')),
      h('div', { class: 'muted' }, 'Nenhum plugin instalado. Instale na aba Plugins (pasta ou URL do GitHub).'));
  }
  const boxes = pluginCache.map((k) => {
    const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.checked = (p.plugins ?? []).includes(k.id);
    cb.addEventListener('change', () => void guard(async () => {
      const set = new Set(current?.plugins ?? []);
      if (cb.checked) set.add(k.id); else set.delete(k.id);
      current = await forge.updateProject(p.id, { plugins: [...set] });
      toast(cb.checked ? `Plugin "${k.name}" ativado` : `Plugin "${k.name}" desativado`);
    }));
    /* motor próprio (kit): estilo do motor; ao trocar, os planos são renderizados de novo (sem IA) */
    const kitK = (k as { kit?: { kind: string; styles: string[] } }).kit;
    if (kitK?.kind === 'player' && kitK.styles.length) {
      const ks = h('select', { 'data-kit-style': k.id }, ...kitK.styles.map((st) => h('option', { value: st }, `🎨 ${st}`))) as HTMLSelectElement;
      ks.value = p.pluginStyles?.[k.id] ?? (kitK.styles.includes('dusk') ? 'dusk' : kitK.styles[0]!);
      const rr = h('button', { class: 'small', 'data-kit-rerender': k.id, title: 'Renderiza de novo os planos já escritos com o estilo escolhido (não chama a IA). Depois use "Renderizar final".', onclick: (e) => void guard(async () => {
        const b = e.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = '⏳ renderizando os planos…';
        try { const n = (await (forge as unknown as { kitRerender: (id: string) => Promise<number> }).kitRerender(p.id)); toast(`${n} plano(s) renderizado(s) com o estilo "${ks.value}". Use "Renderizar final".`); }
        finally { b.disabled = false; b.textContent = '🎬 Renderizar planos com este estilo'; }
      }) }, '🎬 Renderizar planos com este estilo');
      ks.addEventListener('change', () => void guard(async () => {
        current = await forge.updateProject(p.id, { pluginStyles: { ...(current?.pluginStyles ?? {}), [k.id]: ks.value } });
        toast(`Estilo do motor: ${ks.value} — clique em "Renderizar planos com este estilo" para aplicar`);
      }));
      return h('span', { class: 'inline' }, h('label', { class: 'inline chk', title: k.description ?? '' }, cb, k.name), ks, rr);
    }
    /* plugin de estilos: escolher o estilo deste projeto */
    const styleSel = k.styles?.length ? h('select', { 'data-plugin-style': k.id }, h('option', { value: '' }, '(escolha o estilo)'), ...k.styles.map((st) => h('option', { value: st.id }, st.name))) as HTMLSelectElement : null;
    if (styleSel) {
      styleSel.value = p.pluginStyles?.[k.id] ?? '';
      styleSel.addEventListener('change', () => void guard(async () => {
        const ps = { ...(current?.pluginStyles ?? {}) }; if (styleSel.value) ps[k.id] = styleSel.value; else delete ps[k.id];
        current = await forge.updateProject(p.id, { pluginStyles: ps }); toast(`Estilo do plugin: ${styleSel.selectedOptions[0]?.textContent ?? ''}`);
      }));
    }
    /* coleção de skills: template deste projeto (vazio = automático) */
    const tpls = !k.styles?.length && !(k as { kit?: unknown }).kit ? ((k as { skills?: string[] }).skills ?? []) : [];
    const tplSel = tpls.length > 1 ? h('select', { 'data-plugin-template': k.id, title: 'Template do plugin: só ele entra no prompt. Vale para as próximas cenas geradas.' },
      h('option', { value: '' }, '✨ template automático'), ...tpls.map((t) => h('option', { value: t }, `🎞️ ${t}`))) as HTMLSelectElement : null;
    if (tplSel) {
      tplSel.value = p.pluginStyles?.[k.id] ?? '';
      tplSel.addEventListener('change', () => void guard(async () => {
        const ps = { ...(current?.pluginStyles ?? {}) }; if (tplSel.value) ps[k.id] = tplSel.value; else delete ps[k.id];
        current = await forge.updateProject(p.id, { pluginStyles: ps }); toast(`Template do plugin: ${tplSel.value || 'automático'}`);
      }));
    }
    return h('span', { class: 'inline' }, h('label', { class: 'inline chk', title: k.description ?? '' }, cb, k.name), styleSel, tplSel);
  });
  return h('div', { class: 'card', id: 'pj-plugins' },
    h('div', { class: 'row' }, h('span', { class: 'ico' }, icon('skills')), h('strong', {}, 'Plugins'),
      h('span', { class: 'muted' }, 'as instruções deles entram no prompt de todas as etapas')),
    h('div', { class: 'row' }, ...boxes));
}

function inspector(p: Project): HTMLElement {
  const sel = p.scenes.filter((s) => selected.includes(s.id));
  const instr = h('textarea', { id: 'ed-instr', placeholder: 'Descreva a mudança. Ex.: “deixe a narração mais curta e engraçada” ou “o boneco deve ser maior e usar chapéu vermelho”' });
  const regen = h('input', { type: 'checkbox', id: 'ed-regen' }); regen.checked = true;
  const struct = h('input', { type: 'checkbox', id: 'ed-struct' });
  const ids = sel.map((s) => s.id);

  const aiRow = h('div', { class: 'card' },
    h('div', { class: 'muted' }, ids.length ? `Prompt aplicado a ${ids.length} cena(s) selecionada(s)` : 'Selecione cenas (ou será aplicado a todas)'),
    instr,
    h('div', { class: 'row' },
      h('label', { class: 'inline' }, regen, 'regenerar mídia depois'), h('label', { class: 'inline' }, struct, 'permitir criar/apagar cenas')),
    h('div', { class: 'row' },
      h('button', { class: 'primary', id: 'ed-rewrite', onclick: () => void guard(async () => {
        if (!instr.value.trim()) throw new Error('Escreva a instrução.');
        busy = 'Reescrevendo cenas com IA…'; renderEditor(true);
        try {
          const r = await forge.rewriteScenes(p.id, { sceneIds: ids, instruction: instr.value, allowStructure: struct.checked, regenerate: regen.checked });
          current = r.project; toast(r.result.summary); instr.value = '';
        } finally { busy = ''; renderEditor(true); }
      }) }, '✨ Reescrever texto/estrutura (IA)'),
      h('button', { id: 'ed-visual', onclick: () => void guard(async () => {
        if (!instr.value.trim()) throw new Error('Escreva a instrução.');
        if (!ids.length) throw new Error('Selecione ao menos uma cena.');
        busy = 'Refazendo visual…'; renderEditor(true);
        try { current = (await forge.visualPrompt(p.id, { sceneIds: ids, instruction: instr.value, regenerate: regen.checked })).project; toast('Visual atualizado'); instr.value = ''; }
        finally { busy = ''; renderEditor(true); }
      }) }, '🎨 Refazer visual com esta instrução')));

  const reroll = h('input', { type: 'checkbox' }); reroll.checked = true;
  const regenButtons = h('div', { class: 'row' }, ...sceneSteps(p).map((s) => h('button', { 'data-step': s.id, onclick: () => void guard(async () => {
    if (!ids.length) throw new Error('Selecione ao menos uma cena.');
    busy = `Regenerando ${s.label}…`; renderEditor(true);
    try { current = (await forge.regenerate(p.id, { sceneIds: ids, stepIds: [s.id], reroll: reroll.checked, finalize: false })).project; toast(`${s.label}: concluído`); }
    finally { busy = ''; renderEditor(true); }
  }) }, `↻ ${s.label}`)));

  const batchOps = h('div', { class: 'row' },
    h('button', { class: 'sel-all', title: 'Selecionar todas as cenas (Ctrl+clique / Shift+clique na timeline escolhe várias)', onclick: () => { selected = p.scenes.map((s) => s.id); anchor = selected[0]; renderEditor(true); } }, '☑ Selecionar todas'),
    ids.length > 1 ? h('button', { class: 'primary regen-many', onclick: () => openRegenDialog(p, ids) }, `↻ Regerar ${ids.length} cenas`) : null,
    h('button', { class: 'sfx-edit', onclick: () => ids.length ? openSfxDialog(p, ids) : toast('Selecione ao menos uma cena.', true) }, '🔊 Efeitos sonoros'),
    h('button', { class: 'dup-scene', onclick: () => void guard(async () => { for (const id of ids) current = await forge.duplicateScene(p.id, id); renderEditor(true); }) }, 'Duplicar'),
    h('button', { class: 'danger del-scene', onclick: () => void guard(async () => {
      if (!ids.length) return; if (!await askConfirm(`Excluir ${ids.length} cena(s)?`)) return;
      current = await forge.deleteScenes(p.id, ids); selected = []; renderEditor(true);
    }) }, 'Excluir cena(s)'),
    h('button', { class: 'add-scene', onclick: () => void guard(async () => {
      const r = await forge.addScene(p.id, ids[ids.length - 1] ?? null, { title: 'Nova cena', durationSec: 4 }); current = r.project; selected = [r.scene.id]; renderEditor(true);
    }) }, '+ Nova cena'));

  let fields: HTMLElement;
  if (sel.length === 1) {
    const sc = sel[0]!;
    const title = h('input', { value: sc.title, id: 'f-title' });
    const kind = h('select', { id: 'f-kind' }, ...(['image', 'video', 'code', 'motion', 'mixed', 'stock'] as SceneKind[]).map((k) => h('option', { value: k }, k))); kind.value = sc.kind;
    const d = h('input', { type: 'number', step: '0.1', min: '0.5', value: String(sc.durationSec ?? 4), id: 'f-dur' });
    const narr = h('textarea', { id: 'f-narr' }); narr.value = sc.narration;
    const sub = h('textarea', { id: 'f-sub', rows: '2', placeholder: 'Vazio = usa a narração' }); sub.value = sc.subtitle ?? '';
    const vis = h('textarea', { id: 'f-vis' }); vis.value = sc.visualIntent;
    const cam = h('input', { value: sc.camera ?? '', id: 'f-cam' });
    const notes = h('textarea', { id: 'f-notes' }); notes.value = sc.notes ?? '';
    const media = (p.attachments ?? []).filter((a) => a.kind === 'image' || a.kind === 'video');
    const um = h('select', { id: 'f-user-media', title: 'Usa um arquivo seu como visual desta cena (imagem: quadro da cena, que o vídeo IA ainda pode animar; vídeo: o clipe da cena)' },
      h('option', { value: '' }, '— gerar normalmente —'), ...media.map((a) => h('option', { value: a.file }, `${a.kind === 'video' ? '🎬' : '🖼'} ${a.file}`))) as HTMLSelectElement;
    um.value = sc.userMedia ?? '';
    const patch = () => ({ title: title.value, kind: kind.value, durationSec: Number(d.value), narration: narr.value, subtitle: sub.value, visualIntent: vis.value, camera: cam.value, notes: notes.value, ...(media.length || sc.userMedia ? { userMedia: um.value } : {}) });
    const elements = Object.entries(sc.artifacts).flatMap(([step, fs]) => fs.map((f) => h('span', { class: 'tag', title: f }, `${step}: ${basename(f)}`)));
    fields = h('div', { class: 'card' },
      h('div', { class: 'row' }, h('label', {}, 'Título', title), h('label', {}, 'Tipo', kind), h('label', {}, 'Duração (s)', d)),
      h('label', {}, 'Narração', narr), h('label', {}, 'Legenda', sub), h('label', {}, 'Visual', vis), h('div', { class: 'row' }, h('label', {}, 'Câmera', cam), media.length || sc.userMedia ? h('label', { class: 'grow' }, '📎 Arquivo seu nesta cena', um) : null),
      h('label', {}, 'Notas/ajustes (entram no prompt de geração)', notes),
      elements.length ? h('div', { class: 'elements' }, h('span', { class: 'muted' }, 'Elementos da cena: '), ...elements) : h('div', { class: 'muted' }, 'Nenhum elemento gerado ainda.'),
      h('div', { class: 'row' },
        h('button', { id: 'f-save', onclick: () => void guard(async () => { current = (await forge.updateScene(p.id, sc.id, patch(), false)).project; toast('Cena salva'); renderEditor(true); }) }, 'Salvar'),
        h('button', { class: 'primary', id: 'f-save-regen', onclick: () => void guard(async () => {
          busy = 'Salvando e regenerando…'; renderEditor(true);
          try { current = (await forge.updateScene(p.id, sc.id, patch(), true)).project; } finally { busy = ''; renderEditor(true); }
        }) }, 'Salvar e regenerar')));
  } else {
    fields = h('div', { class: 'card muted' }, sel.length === 0 ? 'Clique numa cena da timeline. Ctrl/⌘ ou Shift para selecionar várias.' : `${sel.length} cenas selecionadas — use o prompt, os efeitos, a regeneração ou as ações em lote.`);
  }
  return h('div', { class: 'inspector' }, fields, effectsCard(p, sel), finalFxCard(p), subtitlesCard(p), aiRow,
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('strong', {}, 'Regenerar etapa'), h('label', { class: 'inline' }, reroll, 'nova variação (seed)')), regenButtons, batchOps),
    productionCard(p), voiceCard(p), attachmentsCard(p), pluginsCard(p));
}

/** Sem projeto aberto: escolha um projeto para editar. */
function editorPicker() {
  const cards = lastList.map((p) => h('button', { class: 'pcard', 'data-open': p.id, onclick: () => void guard(async () => { current = await forge.getProject(p.id); selected = []; media = await forge.projectMedia(p.id); renderEditor(); }) },
    frameCell(p), h('strong', {}, p.name), h('span', { class: 'muted' }, `${p.scenes} cena(s) · ${STATUS[p.status ?? 'new']?.[0] ?? ''}`)));
  main.replaceChildren(h('h2', {}, 'Editor'), h('p', { class: 'muted' }, 'Escolha um projeto para editar.'),
    lastList.length ? h('div', { class: 'pgrid' }, ...cards) : h('p', { class: 'muted' }, 'Nenhum projeto ainda. Crie um em Novo projeto.'));
}

/* ───────── progresso da execução (barra + estimativa) ───────── */
const progPct = () => runProgress ? Math.min(100, Math.round((runProgress.done / Math.max(1, runProgress.total)) * 100)) : 0;
function progText(): string {
  const r = runProgress; if (!r) return '';
  const rest = r.etaMs > 0 ? `~${fmtMs(r.etaMs)} ${t('restantes')}` : r.done >= r.total ? t('finalizando…') : t('calculando…');
  const unit = r.mode === 'scenes' ? t('cenas') : t('entregáveis');
  return `${progPct()}% · ${Math.min(r.done, r.total)}/${r.total} ${unit} · ${rest} · ${fmtMs(r.elapsedMs)} ${t('decorridos')}${r.label ? ` · ${r.label}` : ''}`;
}
function progressNode(): HTMLElement {
  const fill = h('div', { class: 'prog-fill', id: 'prog-fill' }); fill.style.width = `${progPct()}%`;
  return h('div', { class: `prog${runProgress ? '' : ' hidden'}`, id: 'prog' },
    h('div', { class: 'prog-bar' }, fill), h('span', { class: 'prog-lbl', id: 'prog-lbl' }, progText()));
}
function paintProgress() {
  const box = $('#prog'); if (!box) return;
  box.classList.toggle('hidden', !runProgress);
  const fill = $('#prog-fill'); if (fill) fill.style.width = `${progPct()}%`;
  const lbl = $('#prog-lbl'); if (lbl) lbl.textContent = progText();
}

function renderEditor(keepScroll = false) {
  if (!current) { editorPicker(); return; }
  const p = current;
  if (p.scenes.length && !p.scenes.some((s) => selected.includes(s.id))) { selected = [p.scenes[0]!.id]; anchor = selected[0]; }
  const oldScroll = keepScroll ? $('#tl')?.scrollLeft ?? 0 : 0;
  const zoom = h('input', { type: 'range', min: '10', max: '160', value: String(pxPerSec), id: 'zoom' });
  zoom.addEventListener('input', () => { pxPerSec = Number(zoom.value); renderEditor(true); });
  const total = p.scenes.reduce((a, s) => a + dur(s), 0);
  const first = p.scenes.find((s) => s.id === selected[0]);
  const libRoute = routeCache.find((r) => r.id === p.routeId);
  const routeStale = libRoute && p.route && JSON.stringify(libRoute.steps) !== JSON.stringify(p.route.steps) ? libRoute : undefined;
  const stage = h('div', { id: 'pv-stage', class: `stage a${p.aspect.replace(':', 'x')}` });
  const switcher = h('select', { id: 'ed-project' }, ...lastList.map((x) => h('option', { value: x.id }, x.name))) as HTMLSelectElement;
  if (!lastList.some((x) => x.id === p.id)) switcher.append(h('option', { value: p.id }, p.name));
  switcher.value = p.id;
  switcher.addEventListener('change', () => void guard(async () => { stopPlay(); current = await forge.getProject(switcher.value); selected = []; media = await forge.projectMedia(switcher.value); renderEditor(); }));
  /* barra de reprodução: fica sempre visível embaixo da prévia, em qualquer proporção */
  const ib = (id: string, ic: string, title: string, fn: () => void, cls = '') => h('button', { id, title, class: `tbtn ${cls}`, onclick: fn }, icon(ic, true));
  const transport = h('div', { class: 'transport' },
    h('div', { class: 'tgroup' },
      ib('pv-prev', 'prev', 'Cena anterior (←)', () => jump(-1)),
      h('button', { id: 'pv-play', class: 'tbtn play', title: 'Reproduzir o vídeo a partir da cena atual / pausar', onclick: () => { if (playing) stopPlay(); else void playAll(selIndex()); } }, icon(playing ? 'pause' : 'play', true)),
      ib('pv-next', 'next', 'Próxima cena (→)', () => jump(1)),
      ib('pv-stop', 'stop', 'Parar e voltar ao início', () => { stopPlay(); if (p.scenes.length) { selected = [p.scenes[0]!.id]; renderEditor(true); } })),
    p.scenes.length ? h('button', { id: 'pv-scene', class: 'tbtn pill', title: 'Reproduzir só a cena selecionada', onclick: () => { if (playing) stopPlay(); else void playScene(selIndex()); } }, icon('play', true), ' Só a cena') : null,
    h('span', { id: 'tc', class: 'tc' }, `${fmtTc(sceneStart(p, selIndex()))} / ${fmtTc(total)}`),
    h('span', { class: 'sp' }),
    h('button', { id: 'pv-cc', class: `tbtn pill${showSubs ? ' on' : ''}`, title: showSubs ? 'Esconder legendas da prévia' : 'Mostrar legendas na prévia', onclick: () => { showSubs = !showSubs; renderEditor(true); } }, 'CC'),
    first && !runningIds.has(p.id) ? h('button', { id: 'pv-regen', class: 'tbtn pill regen', title: 'Refazer a(s) cena(s) selecionada(s)', onclick: () => openRegenDialog(p, selected) }, `↻ Regerar ${selected.length > 1 ? `${selected.length} cenas` : 'cena'}`) : null,
    media.final ? h('button', { id: 'pv-final', class: 'tbtn pill', onclick: () => { stopPlay(); const box = $('#pv-stage')!; box.replaceChildren(h('video', { src: forge.mediaUrl(media.final!), controls: true, autoplay: true })); } }, '🎬 Ver final') : null);
  main.replaceChildren(
    h('div', { class: 'ed-head' },
      h('span', { class: 'ico' }, icon('editor')), switcher, h('span', { class: 'muted' }, `${p.scenes.length} cenas · ${total.toFixed(1)}s · ${p.aspect}${p.route ? ` · rota: ${p.route.name}` : ''}`),
      busy ? h('span', { class: 'tag running', id: 'busy' }, busy) : null,
      h('span', { class: 'sp' }),
      h('button', { id: 'btn-run', disabled: runningIds.has(p.id), onclick: () => void guard(async () => {
        busy = 'Executando rota…'; renderEditor(true);
        try { const r = await forge.run(p.id); if (!r.ok) toast(r.error ?? 'falhou', true); else toast('Rota concluída'); }
        finally { busy = ''; current = await forge.getProject(p.id); media = await forge.projectMedia(p.id); renderEditor(true); }
      }) }, '▶ Executar rota'),
      p.scenes.length ? h('button', { class: 'primary', id: 'btn-final', onclick: () => void guard(async () => {
        busy = 'Renderizando vídeo final…'; renderEditor(true);
        try { const r = await forge.renderFinal(p.id); if (!r.ok) toast(r.error ?? 'falhou', true); else toast('Vídeo final renderizado'); }
        finally { busy = ''; current = await forge.getProject(p.id); media = await forge.projectMedia(p.id); renderEditor(true); }
      }) }, '🎬 Renderizar final') : null,
      media.final ? h('button', { id: 'btn-youtube', title: 'Enviar o vídeo final ao YouTube como NÃO LISTADO, com título, descrição e thumbnail do SEO (conta Google das Automações)', onclick: () => void openUploadDialog(p) }, '⬆ YouTube') : null,
      runningIds.has(p.id)
        ? h('button', { class: 'danger', id: 'btn-stop', title: 'Parar agora — o que já foi gerado fica salvo e pode ser retomado', onclick: () => void guard(async () => { await forge.cancel(p.id); toast('Parando… o que já foi gerado fica salvo'); }) }, '⏹ Parar')
        : p.production?.runs?.length
          ? h('button', { id: 'btn-resume', title: 'Continuar de onde parou (usa o cache das etapas concluídas)', onclick: () => void guard(async () => {
            busy = 'Continuando de onde parou…'; renderEditor(true);
            try { const r = await forge.resume(p.id); if (!r.ok) toast(r.error ?? 'falhou', true); else toast('Concluído'); }
            finally { busy = ''; current = await forge.getProject(p.id); media = await forge.projectMedia(p.id); renderEditor(true); }
          }) }, '⏵ Continuar')
          : null,
      p.route ? h('button', { id: 'btn-executors', disabled: runningIds.has(p.id), title: 'Trocar harness, modelo e esforço das etapas deste projeto (ex.: Ollama → Antigravity) e refazer as alteradas',
        onclick: () => void openProjectExecutorsModal({ forge: forge as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>, toast }, { project: p, onSave: async (r, redo) => {
          current = await forge.saveRoute(p.id, r);
          if (!redo) { toast('Executores salvos — valem para as etapas pendentes e para as próximas execuções'); renderEditor(true); return; }
          busy = 'Refazendo as etapas alteradas…'; renderEditor(true);
          try { const res = await forge.redoSteps(p.id, redo); if (!res.ok) toast(res.error ?? 'falhou', true); else toast('Etapas refeitas com os novos executores'); }
          finally { busy = ''; current = await forge.getProject(p.id); media = await forge.projectMedia(p.id); renderEditor(true); }
        } }) }, '🎛 Executores') : null,
      /* ajustar cenas e bypass na barra de cima (o cartão "Produção" fica no fim do editor) */
      p.route?.steps.some((st) => st.kind === 'scene_plan' && st.enabled) ? h('button', { id: 'btn-replan', disabled: runningIds.has(p.id),
        title: `Refaz o plano de cenas com menos (ou mais) cenas, com backup e mantendo o roteiro — hoje: ${p.scenes.length} cena(s)${p.scenes.length ? ` de ≈ ${(p.scenes.reduce((a, s) => a + (s.durationSec ?? 0), 0) / p.scenes.length).toFixed(1)} s` : ''}`,
        onclick: () => void openReplanModal(p) }, `🎬 Ajustar cenas (${p.scenes.length})`) : null,
      p.route ? h('button', { id: 'btn-bypass', class: p.executorBypass?.enabled ? 'primary' : '', disabled: runningIds.has(p.id),
        title: 'Força um harness/modelo nas etapas de IA deste projeto, sem mexer na rota (liga/desliga)',
        onclick: () => openBypassModal(p) }, p.executorBypass?.enabled ? `⚡ Bypass: ${p.executorBypass.binding.harness}${p.executorBypass.binding.model ? '/' + p.executorBypass.binding.model : ''}` : '⚡ Bypass') : null,
      h('button', { onclick: () => void forge.openFolder(p.id) }, 'Abrir pasta')),
    progressNode(),
    ...(preflight && preflight.projectId === p.id && preflight.steps.some((s) => s.harness)
      ? [h('div', { class: 'muted', id: 'ed-preflight' }, `provedor/modelo da rota: ${preflight.steps.filter((s) => s.harness).map((s) => `${s.id} → ${s.harness}${s.model ? '/' + s.model : ''}${s.ok === false ? ' ⚠' : ''}`).join(' · ')}`)]
      : []),
    ...(routeStale
      ? [h('div', { class: 'muted', id: 'ed-route-stale' }, `⚠ a rota deste projeto está diferente da rota "${routeStale.name}" da biblioteca — `,
        h('button', { class: 'small', onclick: () => void guard(async () => {
          current = await forge.saveRoute(p.id, routeStale);
          toast(`Rota "${routeStale.name}" aplicada a este projeto`);
          renderEditor(true);
        }) }, 'Aplicar rota atual'))]
      : []),
    h('div', { class: 'ed-top' },
      h('div', { class: 'preview' }, stage, transport),
      p.scenes.length ? inspector(p) : h('div', { class: 'inspector' },
        h('div', { class: 'card' }, h('strong', {}, p.skill?.freeform ? 'Vídeo livre' : 'Projeto sem cenas'),
          h('p', { class: 'muted' }, p.skill?.freeform ? 'Esta skill não gera cenas: o harness executa o prompt e entrega o vídeo final, que aparece aqui.' : 'As cenas aparecem depois da etapa "Planejar cenas". Use ▶ Executar rota.'),
          h('pre', { class: 'outstyle' }, p.idea)),
        productionCard(p), voiceCard(p), attachmentsCard(p), pluginsCard(p))),
    h('div', { class: 'tl-bar' }, h('strong', {}, 'Timeline'), h('span', { class: 'muted' }, 'clique no clipe ou na régua para pôr o cursor · duplo clique reproduz · arraste para reordenar · puxe a borda para mudar a duração'), h('span', { class: 'sp' }), h('label', { class: 'inline' }, 'Zoom', zoom)),
    ...(p.scenes.length ? [tlTools(p)] : []),
    timeline(p));
  main.classList.add('ed');
  if (p.scenes.length) showScene(first);
  else if (media.final) stage.replaceChildren(h('video', { src: forge.mediaUrl(media.final), controls: true }));
  else stage.replaceChildren(h('div', { class: 'muted pad' }, 'Ainda sem vídeo. Use ▶ Executar rota.'));
  const tl = $('#tl'); if (tl) tl.scrollLeft = oldScroll;
}

document.addEventListener('keydown', (e) => {
  if (tab !== 'editor' || !current) return;
  const t = e.target as HTMLElement; if (/INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
  if (e.key === 'ArrowRight') jump(1);
  else if (e.key === 'ArrowLeft') jump(-1);
  else if (e.key === ' ') { e.preventDefault(); if (playing) stopPlay(); else void playScene(selIndex()); }
  else if (e.key === 'Delete' && selected.length) $<HTMLButtonElement>('.del-scene')?.click();
  else if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[sqw]$/i.test(e.key)) {
    /* atalhos da timeline: S divide, Q corta o início, W corta o fim (no cursor) */
    const b = $<HTMLButtonElement>(`[data-act="${({ s: 'tl-split', q: 'tl-cut-in', w: 'tl-cut-out' } as Record<string, string>)[e.key.toLowerCase()]}"]`);
    if (b && !b.disabled) { e.preventDefault(); b.click(); }
  }
});

/* ───────── aba Execução ───────── */
function renderRun() {
  let fullLeft = 40;   // só as 40 prévias mais recentes carregam mídia; as antigas viram chip
  const nodes: HTMLElement[] = [];
  for (let i = logLines.length - 1; i >= 0; i--) { const l = logLines[i]!; nodes.unshift(logNode(l, l.file ? fullLeft-- > 0 : true)); }
  const log = h('div', { id: 'log' }, ...nodes);
  const pr = current?.params;
  const paramCard = pr ? h('div', { class: 'card', id: 'run-params' },
    h('strong', {}, 'Parâmetros da última execução'),
    h('div', { class: 'muted' }, [pr.routeName, pr.skillId, pr.quality ? `qualidade ${pr.quality}` : '', pr.aspect, pr.targetDurationSec ? `${pr.targetDurationSec}s` : '',
      pr.language, pr.sceneConcurrency ? `${pr.sceneConcurrency} cenas em paralelo` : 'uma cena por vez', pr.maxProductionMin ? `máx. ${pr.maxProductionMin} min` : ''].filter(Boolean).join(' · ')),
    pr.steps?.length ? h('div', { class: 'muted' }, pr.steps.map((s) => `${s.id}: ${s.binding}`).join(' · ')) : null) : null;
  const pf = preflight;
  const pfCard = pf && pf.steps.length ? h('div', { class: 'card', id: 'run-preflight' },
    h('div', { class: 'row' }, h('strong', {}, 'Pré-checagem da execução'), h('span', { class: 'muted' }, `harness/modelo por etapa${current?.route?.name ? ` · rota "${current.route.name}"` : ''}`)),
    ...pf.steps.map((st) => h('div', { class: 'muted' }, `${st.id} (${st.kind}) → ${st.binding}${st.harness ? ` → ${st.harness}${st.model ? '/' + st.model : ''}` : ''}${st.ok === false ? ` ⚠ ${st.note ?? 'indisponível'}` : ''}`)),
    pf.plugins?.length ? h('div', { class: 'muted' }, `plugins: ${pf.plugins.join(', ')}`) : null) : null;
  main.replaceChildren(h('h2', {}, 'Execução'), h('p', { class: 'muted' }, current ? `Projeto atual: ${current.name}` : 'Nenhum projeto aberto.'),
    progressNode(), ...(pfCard ? [pfCard] : []), ...(paramCard ? [paramCard] : []),
    h('div', { class: 'row' }, h('button', { id: 'log-clear', onclick: () => { logLines.length = 0; logProject = current?.id ?? ''; renderRun(); } }, 'Limpar log')), log);
  log.scrollTop = log.scrollHeight;
}

/* ───────── abas da biblioteca e configurações (library-ui.ts) ───────── */
const ctx: Ctx = {
  h: h as unknown as Ctx['h'], main, forge: forge as unknown as Ctx['forge'], toast, guard,
  current: () => current, setCurrent: (p) => { current = p; }, go,
};

async function render() {
  main.classList.remove('ed');
  if (tab === 'projects') await renderProjects();
  else if (tab === 'new') await renderNew();
  else if (tab === 'batch') await renderBatch();
  else if (tab === 'editor') {
    if (!lastList.length) lastList = (await guard(() => forge.listProjects())) ?? [];
    if (!pluginCache.length) pluginCache = (await guard(() => forge.listPlugins())) ?? [];
    if (!routeCache.length) routeCache = ((await guard(() => forge.meta()))?.routes) ?? [];
    if (current) { current = (await guard(() => forge.getProject(current!.id))) ?? current; media = (await guard(() => forge.projectMedia(current!.id))) ?? media; hydrateLog(current); }
    renderEditor();
  }
  else if (tab === 'run') { if (current) hydrateLog(current); renderRun(); }
  else if (tab === 'routes') await renderRoutesLib(ctx);
  else if (tab === 'skills') await renderSkills(ctx);
  else if (tab === 'providers') await renderProvidersPage(main, { forge: forge as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>, toast }, helpButton('providers'));
  else if (tab === 'channels') await renderChannelsPage({ forge: forge as unknown as ChannelsCtx['forge'], toast, main, guard });
  else if (tab === 'automations') await renderAutomations({ forge: forge as unknown as AutoCtx['forge'], toast, main });
  else if (tab === 'videos') await renderVideosPage({ forge: forge as unknown as VideosCtx['forge'], toast, main, guard, newProject: (idea, skillId, foldId) => { pendingIdea = idea; pendingSkill = skillId; pendingFold = foldId; go('new'); },
    skillFromVideo: (url, ai) => { go('skills'); setTimeout(() => void openSkillFromVideos(ctx, () => go('skills'), [url], ai), 300); },
    openSkills: () => go('skills'), openRoutes: () => go('routes') });
  else if (tab === 'plugins') await renderPluginsPage({ forge: forge as unknown as PluginsCtx['forge'], toast, main, guard, useInProject: (id, style) => { pendingPlugin = { id, style }; go('new'); } });
  else if (tab === 'agents') await renderAgents(ctx);
  else await renderSettings(ctx);
}
void render();
