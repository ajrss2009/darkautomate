import { httpFetch } from './http';
import { detectBins, probeBins, run } from './ffmpeg';
import * as ff from './ffmpeg';
import * as soundtrack from './soundtrack';
import * as attachments from './attachments';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, safeStorage, session, shell } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Binding, ChannelPlatform, EngineEvent, HarnessId, Project, Route, Settings, HarnessBinding } from '../shared/types';
import * as myChannels from './channels';
import * as myChannelPub from './channel-publish';
import { generateBrand as generateChannelBrand, renderBrandFiles, type BrandInput } from './channel-brand';
import { CHANNEL_TYPES, THUMB_STYLES, channelType, parseChannelLink, recreateNote } from './channel-setup';
import { analyticsLine, analyzeChannel } from './channel-analytics';
import { enginesFromRoute, estimateCost, normalizeProducts, productsPrompt, type CostInput } from './clone-business';
import { dnaSceneSec } from './channel-dna';
import { planHash, readStoryboard, writeStoryboard } from './project-storyboard';
import { SOCIAL_SITES, findSocial, isSocialPlatform, listProfile, netscapeCookies, searchSocial, type SocialPlatform } from './social-search';
import { cookieArgs, ensureYtDlp, setCookieProvider } from './youtube';
import { bindingLabel } from '../shared/types';
import { runRoute } from './engine';
import { createExecutors, uploadProjectToYouTube } from './executors';
import { Wan2gpClient, wan2gpKind } from './wan2gp';
import { ensureWanServer, setWanDirector, showrunnerUp, wanServer } from './showrunner';
import { ensureFirstFrame, recordRun } from './production';
import * as lib from './library';
import { buildCatalog } from './catalog';
import { detectHarnessAsync, listHarnessModels, runHarness } from './harness';
import { spawn, spawnSync } from 'node:child_process';
import * as prov from './providers';
import { testSource } from './stock';
import { SCENE_SCHEME, registerSceneProtocol, renderHtml, snapHtml, kitHost, renderKitFrames } from './render';
import { ensureLinkCapture as captureLink } from './webcapture';
import { detectKit, ensureLibrary, kitPreview, previewFile, projectKit } from './kit';
import { kitRerender } from './kit-exec';
import { generateSkillFromDoc, type SkillDocInput } from './skilldoc';
import { TOOL_SPECS } from './tools';
import { exportPluginFile, exportPluginsPack, importPluginsPack, installPluginFile, installPluginFolder, installPluginUrl, listPlugins, pluginPrompt, pluginsRoot, removePlugin, seedBundledPlugins, setAppPluginsDir, adoptPlugins } from './plugins';
import { MCP_TOOLS, createMcpServer, mcpClientConfig, mcpSetupConfigs, runMcpHttp, runMcpStdio } from './mcp';
import { DEFAULT_HARNESSES } from './harness';
import { isHttpHarness, resolveHarnessCommand } from './harness';
import { ensureWhisper, whisperVenvPython } from './whisper-install';
import { transcribe } from './whisper';
import { ComfyClient } from './comfyui';
import { ROUTES, VIDEO_TYPES } from './presets';
import { CATEGORY_OF, allProfiles, downstreamSteps, profileSkips } from '../shared/profiles';
import * as auto from './automations';
import { generateSkillFromVideos, type SkillGenInput } from './skillgen';
import { closeBrowser, flowCredits, flowDiagnose, flowGenerate } from './flow';
import { DEFAULT_FISH_PROVIDER, DEFAULT_SNAPGEN_PROVIDER, assertSkillAndRoute, createProject, defaultSettings, listProjects, projectDirOf, projectsDir, type NewProjectInput } from './settings';
import * as ops from './ops';
import { APP_NAME } from '../shared/brand';
import * as tle from './timeline-edit';
import { exportForEditor } from './nle-export';
import { writePublishKit } from './publish-kit';
import { autoFrameTime, bestFrameTime, grabFrame, projectThumbDesign, renderThumb, thumbSize, thumbText } from './thumb-render';
import type { ThumbDesign } from '../shared/thumbdesign';
import { LANGUAGE_KINDS, fitSceneSfx, llmJson, rewriteScenes, translateProject } from './editor';
import * as sfx from './sfx';
import { STOCK_SOURCES } from '../shared/stock-sources';
import { auditLibrary } from './audit';
import { findOutliers, type FinderQuery } from './finder';
import { cloneChannel, clonePlatform, cloneStore, listChannelClones, listPendingClones, type ChannelCloneInput, type CloneProgress } from './channel-clone';
import { accountOfAgyHome, recordAgyUsage, usageReport } from './usage';
import { setHarnessUsageSink } from './harness';
import { ensureMgAudio, findMgAudio, mgVenvPython, renderCodeMusic, MOODS, MOOD_LABEL } from './codemusic';
import { deriveProject, type DeriveInput } from './derive';
import { voicePreview, type VoicePreviewInput } from './voice-preview';
import { languageName } from './prompts';
import { BatchRunner } from './batch';
import { prepareReferences } from './references';
import { importClaudeSkill, type SkillImportInput } from './skill-import';
import { adaptPlugin, removeAdaptation } from './plugin-adapt';
import { applyBypass, bypassTargets, replanScenes } from './replan';
import { modelThumbnail, suggestTitles, type ThumbModelInput, type TitleSuggestInput } from './youtube-craft';
import { DATA_DIR_NAME, copyProfile, expand, openPortable, relocate, resolveDataRoot, sealPortable, tokenize } from './portable';
import * as memory from './memory-integration';

/** Barra superior sem menu e sem ícone: só os botões da janela, na cor do tema. */
const overlayFor = (t?: string) => (t === 'light' ? { color: '#f4f5f7', symbolColor: '#111111', height: 34 } : { color: '#000000', symbolColor: '#ffffff', height: 34 });
const bgFor = (t?: string) => (t === 'light' ? '#f4f5f7' : '#000000');
/** ícone da janela: no app empacotado vem do próprio .exe; rodando do código-fonte, do build/icon.png */
const appIcon = () => { const f = path.join(__dirname, '..', '..', 'build', 'icon.png'); return fs.existsSync(f) ? f : undefined; };

/** Reescreve caminhos absolutos dentro de um JSON (projeto movido de pasta). */
function rewritePaths(file: string, from: string, to: string) {
  if (!fs.existsSync(file)) return;
  const walk = (v: unknown): unknown => typeof v === 'string' ? (v.startsWith(from) ? to + v.slice(from.length) : v)
    : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  try { fs.writeFileSync(file, JSON.stringify(walk(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2)); } catch { /* arquivo inválido: mantém */ }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'forge-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  /* cenas por código: origem própria para que <script type="module"> e import map funcionem (file:// bloqueia módulos) */
  SCENE_SCHEME,
]);

let win: BrowserWindow | null = null;
let settings: Settings;
const running = new Map<string, AbortController>();
let batch: BatchRunner | null = null;
/** `--run-project <id>`: roda sem janela e imprime os eventos no stdout (automação/CI). */
let headless = false;
let mcpHttp: Awaited<ReturnType<typeof runMcpHttp>> | null = null;

// diag temporário: registra qualquer erro do processo principal em arquivo
const dumpErr = (tag: string, e: unknown) => {
  try { fs.writeFileSync(path.join(process.env.APPDATA ?? '.', 'ff-error.log'), `[${new Date().toISOString()}] ${tag}: ${(e as Error)?.stack ?? String(e)}\n`); } catch { /* ignora */ }
};
process.on('uncaughtException', (e) => dumpErr('uncaught', e));
process.on('unhandledRejection', (e) => dumpErr('rejection', e));

/* nome exibido: Dark Automate. A pasta de dados continua a mesma de sempre (%APPDATA%\filmforge) — mudar o nome do
   produto não pode trocar a pasta, senão as configurações, chaves e projetos "somem". */
app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), 'filmforge'));
/* modo portátil: decidido ANTES do app ficar pronto (userData só pode mudar aqui) */
const normalUserData = app.getPath('userData');
const dataRoot = resolveDataRoot({ packaged: app.isPackaged, execPath: process.execPath });
if (dataRoot) {
  try { fs.mkdirSync(path.join(dataRoot.root, 'appdata'), { recursive: true }); app.setPath('userData', path.join(dataRoot.root, 'appdata')); }
  catch (e) { dumpErr('portable', e); }
}
/* pasta do settings.json: a chave das API keys (.keyring) fica ao lado dele e viaja junto */
const portableAppData = () => app.getPath('userData');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const toolsDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(app.getAppPath(), 'tools'));
const workflowsDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'workflows') : path.join(app.getAppPath(), 'workflows'));
const bundledPluginsDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'plugins-bundled') : path.join(app.getAppPath(), 'plugins-bundled'));
const voicesDir = () => path.join(settings.workspace, 'voices');
const listVoices = (): Array<{ name: string; path: string }> => {
  try {
    return fs.readdirSync(voicesDir()).filter((f) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(f)).sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, path: path.join(voicesDir(), name) }));
  } catch { return []; }
};

/* chaves de API: sempre cifradas com a chave guardada ao lado do settings.json (.keyring), em qualquer modo.
   Copiar settings.json + .keyring (ou exportar o perfil) leva as chaves para outro PC. O formato antigo
   ("enc:", preso ao Windows deste PC) ainda é lido e é convertido na próxima gravação. */
/* chave já cifrada não é cifrada de novo: settings antigos tinham "pk1:" dentro de "pk1:" (Fish/Gemini/SnapGen
   mandavam a chave cifrada para a API → HTTP 401 "Invalid token") */
const enc = (s: string) => (!s || s.startsWith('pk1:') ? s : sealPortable(portableAppData(), s));
const dec = (s: string): string => {
  let v = s;
  for (let layer = 0; layer < 4 && v; layer++) {     // desfaz camadas repetidas de cifra (gravações antigas)
    if (v.startsWith('pk1:')) { v = openPortable(portableAppData(), v) ?? ''; continue; }
    if (v.startsWith('enc:')) { try { v = safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); } catch { return ''; } continue; }
    break;
  }
  return v;
};

/**
 * Primeira execução portátil: traz as configurações e o perfil (skills, rotas, plugins, vozes…)
 * da instalação normal deste PC, para nada se perder ao passar a usar a versão portátil.
 */
function adoptInstalledProfile(def: Settings): void {
  if (!dataRoot || fs.existsSync(settingsFile())) return;
  const oldFile = path.join(normalUserData, 'settings.json');
  if (!fs.existsSync(oldFile)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(oldFile, 'utf8')) as Partial<Settings>;
    const oldWs = raw.workspace || path.join(app.getPath('documents'), 'FilmForge');
    const copied = copyProfile(oldWs, def.workspace);
    const oldPlugins = raw.pluginsDir?.trim();
    /* pasta de plugins válida continua sendo usada: copiar centenas de MB para o perfil portátil seria desperdício */
    const keepPlugins = !!oldPlugins && fs.existsSync(oldPlugins);
    relocate([path.join(def.workspace, 'library'), path.join(def.workspace, 'channels')], oldWs, def.workspace);
    /* projetos podem ser enormes: não são copiados; continuam visíveis na pasta antiga até o usuário mover */
    const oldProjects = raw.projectsDir?.trim() || path.join(oldWs, 'projects');
    const keepProjects = fs.existsSync(oldProjects) && fs.readdirSync(oldProjects).length > 0;
    const next = { ...raw, workspace: def.workspace, pluginsDir: keepPlugins ? oldPlugins : '', projectsDir: keepProjects ? oldProjects : '',
      providers: (raw.providers ?? []).map((p) => ({ ...p, apiKey: dec(p.apiKey) })),
      stock: Object.fromEntries(Object.entries(raw.stock ?? {}).map(([k, v]) => [k, { ...v, apiKey: dec(v?.apiKey ?? '') }])) } as Settings;
    saveSettings(next);
    console.log(`portátil: perfil copiado de ${oldWs} (${copied.join(', ') || 'nada'})`);
  } catch (e) { dumpErr('portable-adopt', e); }
}

/** Pasta de dados movida (outro PC, outra letra de drive): corrige os caminhos gravados em skills/rotas/projetos. */
function relocateIfMoved(s: Settings): void {
  const anchor = path.join(app.getPath('userData'), 'anchor.json');
  let prev: { workspace?: string; projectsDir?: string } = {};
  try { prev = JSON.parse(fs.readFileSync(anchor, 'utf8')); } catch { /* primeira vez */ }
  const now = { workspace: path.resolve(s.workspace), projectsDir: path.resolve(projectsDir(s)) };
  try {
    if (prev.workspace && prev.workspace !== now.workspace) relocate([path.join(now.workspace, 'library'), path.join(now.workspace, 'channels'), now.projectsDir], prev.workspace, now.workspace);
    if (prev.projectsDir && prev.projectsDir !== now.projectsDir) relocate([now.projectsDir], prev.projectsDir, now.projectsDir);
    if (prev.workspace !== now.workspace || prev.projectsDir !== now.projectsDir) fs.writeFileSync(anchor, JSON.stringify(now, null, 2));
  } catch (e) { dumpErr('relocate', e); }
}

/** Caminho em uma unidade que não existe neste PC (perfil copiado de outra máquina). */
const driveMissing = (p: string): boolean => {
  const m = /^([A-Za-z]):[\\/]/.exec(path.resolve(p));
  return !!m && !fs.existsSync(`${m[1]}:\\`);
};

/**
 * Perfil copiado de outro PC (ou pasta apagada): corrige caminhos impossíveis aqui, que
 * deixariam a lista de projetos vazia e os plugins invisíveis sem nenhum aviso.
 */
function repairStalePaths(s: Settings, def: Settings): boolean {
  let changed = false;
  if (driveMissing(s.workspace)) { s.workspace = def.workspace; changed = true; }
  if (driveMissing(projectsDir(s))) {
    let fixed = '';
    try {
      const old = JSON.parse(fs.readFileSync(path.join(normalUserData, 'settings.json'), 'utf8')) as Partial<Settings>;
      const p = old.projectsDir?.trim();
      if (p && !driveMissing(p) && fs.existsSync(p)) fixed = path.resolve(p);
    } catch { /* sem perfil anterior */ }
    if (!fixed) {
      const p = path.join(def.workspace, 'projects');
      if (!driveMissing(p) && fs.existsSync(p)) fixed = p;
    }
    if (!fixed) {
      const p = path.join(app.getPath('documents'), 'FilmForge', 'projects');
      if (fs.existsSync(p)) fixed = p;
    }
    if (fixed) { s.projectsDir = fixed; changed = true; }
  }
  if (s.pluginsDir?.trim() && driveMissing(s.pluginsDir.trim())) { s.pluginsDir = ''; changed = true; }
  return changed;
}

function loadSettings(): Settings {
  const def = defaultSettings(dataRoot ? path.join(dataRoot.root, 'workspace') : path.join(app.getPath('documents'), 'FilmForge'));
  adoptInstalledProfile(def);
  try {
    const rawFile = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<Settings>;
    const raw = dataRoot ? expand(rawFile, dataRoot.root) : rawFile;
    /* portátil: a pasta de trabalho é sempre a da pasta de dados (a menos que o usuário tenha escolhido outra que exista) */
    if (dataRoot && (!raw.workspace || !fs.existsSync(raw.workspace))) raw.workspace = def.workspace;
    const merged: Settings = {
      ...def, ...raw,
      harnesses: { ...def.harnesses, ...(raw.harnesses ?? {}) },
      wan2gp: { ...def.wan2gp!, ...(raw.wan2gp ?? {}) },
      whisper: { ...def.whisper!, ...(raw.whisper ?? {}) },
      defaults: { ...def.defaults, ...(raw.defaults ?? {}) },
      thumbnails: raw.thumbnails?.length ? raw.thumbnails : def.thumbnails,
      stock: Object.fromEntries(STOCK_SOURCES.map((x) => x.id).map((k) => [k, { ...(def.stock?.[k] ?? {}), ...(raw.stock?.[k] ?? {}), apiKey: dec(raw.stock?.[k]?.apiKey ?? '') }])),
      providers: (raw.providers ?? def.providers).map((p) => ({ ...p, apiKey: dec(p.apiKey) })),
      channelApis: mapChannelApis(raw.channelApis, dec),
    };
    /* chaves antigas (cifradas pelo Windows, presas a este PC) passam a usar a chave portátil */
    const legacyKeys = JSON.stringify(rawFile).includes('"enc:');
    const repaired = repairStalePaths(merged, def);
    if (migrateSettings(merged) || legacyKeys || repaired) saveSettings(merged);
    relocateIfMoved(merged);
    /* venv do Whisper criado pelo botão "Baixar/instalar": usa sozinho se o Python configurado não existe */
    try {
      const vp = whisperVenvPython(merged);
      if (fs.existsSync(vp) && (!merged.whisper?.python || !fs.existsSync(merged.whisper.python))) {
        merged.whisper = { ...merged.whisper!, python: vp };
        try { saveSettings(merged); } catch { /* ignora */ }
      }
    } catch { /* ignora */ }
    return merged;
  } catch { return def; }
}

/**
 * Atualiza configurações antigas que mudaram de significado, sem tocar no que o
 * usuário personalizou. Devolve true se algo mudou (para regravar).
 */
function migrateSettings(s: Settings): boolean {
  let changed = false;
  // Gemini: também é fonte de narração (Gemini TTS, vozes multilíngues)
  for (const g of s.providers?.filter((x) => x.kind === 'gemini') ?? []) {
    const cats = new Set(g.categories ?? ['text', 'image']);
    if (!cats.has('voice')) { cats.add('voice'); g.categories = [...cats] as typeof g.categories; changed = true; }
    for (const m of prov.GEMINI_TTS_MODELS) if (!g.models.includes(m)) { g.models = [...g.models, m]; g.modelCategories = { ...(g.modelCategories ?? {}), [m]: 'voice' }; changed = true; }
    if (!g.voices?.length) { g.voices = [...prov.GEMINI_TTS_VOICES]; changed = true; }
  }
  // opencode: o padrão antigo não tinha --auto (a execução não interativa travava
  // esperando aprovação de permissões).
  const legacyOpencode = JSON.stringify(['run', '--model', '{model}', '{prompt}']);
  const oc = s.harnesses?.opencode;
  if (oc && JSON.stringify(oc.args) === legacyOpencode) {
    oc.args = [...DEFAULT_HARNESSES.opencode.args];
    oc.note = DEFAULT_HARNESSES.opencode.note;
    changed = true;
  }
  /* opencode com prompt na linha de comando: com plugin ativo o pedido passa de 10k caracteres e
     antivírus corporativos (Apex One/Trend Micro, regra FLS.LDX) matam o processo do FilmForge.
     O CLI aceita o prompt por stdin — migra o padrão antigo (args com {prompt} + promptVia 'arg') */
  if (oc && /opencode/i.test(oc.command ?? '') && oc.promptVia === 'arg' && oc.args?.some((a) => a.includes('{prompt}'))) {
    oc.args = [...DEFAULT_HARNESSES.opencode.args];
    oc.promptVia = DEFAULT_HARNESSES.opencode.promptVia;
    oc.note = DEFAULT_HARNESSES.opencode.note;
    changed = true;
  }
  // harnesses HTTP novos (llama.cpp/LM Studio) e protocolo/ferramentas nos antigos
  for (const id of ['llamacpp', 'lmstudio'] as const) {
    const cfg = s.harnesses?.[id];
    if (cfg && !cfg.protocol) { cfg.protocol = 'openai'; changed = true; }
  }
  // Antigravity: o CLI é o `agy` (o antigo exigia --print/--model; o placeholder não funcionava)
  const ag = s.harnesses?.antigravity;
  const agCmd = ag?.command.trim().toLowerCase() ?? '';
  const agIsCli = /(^|[\\/])agy(\.exe|\.cmd|\.bat)?$/.test(agCmd) || /antigravity/i.test(agCmd);
  if (ag && agIsCli && JSON.stringify(ag.args) === JSON.stringify(['{prompt}'])) {
    ag.args = [...DEFAULT_HARNESSES.antigravity.args];
    ag.note = DEFAULT_HARNESSES.antigravity.note;
    changed = true;
  }
  // o `agy` lê o prompt de --print: precisa ir como argumento (stdin deixa o prompt vazio)
  if (ag && agIsCli && ag.promptVia !== 'arg' && ag.args.some((a) => a.includes('{prompt}'))) {
    ag.promptVia = 'arg';
    changed = true;
  }
  if (ag && agIsCli && !ag.models?.length) { ag.models = [...DEFAULT_HARNESSES.antigravity.models]; changed = true; }
  if (s.harnesses?.ollama && !s.harnesses.ollama.protocol) { s.harnesses.ollama.protocol = 'ollama'; changed = true; }
  /* o llama-server só fala /v1/chat/completions: com "ollama" (/api/chat) o provedor llama.cpp nunca funcionava */
  if (s.harnesses?.llamacpp?.protocol === 'ollama') { s.harnesses.llamacpp.protocol = 'openai'; changed = true; }
  for (const id of ['ollama', 'llamacpp', 'lmstudio'] as const) {
    const cfg = s.harnesses?.[id];
    if (cfg && cfg.tools === undefined) { cfg.tools = true; changed = true; }
  }
  // DeepSeek Harness (CLI `dsh`) adicionado nesta versão; um build de teste o tinha como API HTTP sem chave
  const dsk = s.harnesses?.deepseek;
  if (s.harnesses && (!dsk || (/api\.deepseek\.com/i.test(dsk.command) && !dsk.apiKey))) {
    s.harnesses.deepseek = JSON.parse(JSON.stringify(DEFAULT_HARNESSES.deepseek));
    changed = true;
  }
  // Snapgen.AI: fonte de imagem/vídeo adicionada nesta versão (chave vazia;
  // o usuário cola a chave em Configurações → APIs).
  if (!s.providers.some((p) => p.kind === 'snapgen')) {
    s.providers.push({ ...DEFAULT_SNAPGEN_PROVIDER, apiKey: '' });
    changed = true;
  }
  // Fish Audio: fonte de VOZ (TTS) adicionada nesta versão. A chave é colada em
  // Configurações → APIs → Voz; as vozes (reference_id) são carregadas no botão Testar.
  if (!s.providers.some((p) => p.kind === 'fish')) {
    s.providers.push({ ...DEFAULT_FISH_PROVIDER, apiKey: '' });
    changed = true;
  }
  // Fish: todos os modelos são de voz (o header `model` escolhe o modelo de TTS).
  for (const p of s.providers) {
    if (p.kind !== 'fish') continue;
    const cats = p.modelCategories ?? {};
    let touched = false;
    for (const m of p.models) if (!cats[m]) { cats[m] = 'voice'; touched = true; }
    if (touched) { p.modelCategories = cats; changed = true; }
    if (!p.categories?.includes('voice')) { p.categories = [...new Set([...(p.categories ?? []), 'voice'])] as typeof p.categories; changed = true; }
  }
  // Snapgen: separa os modelos por categoria (imagem/vídeo) para as abas e rotas.
  for (const p of s.providers) {
    if (p.kind !== 'snapgen') continue;
    const inferred: Record<string, 'image' | 'video'> = {};
    for (const m of p.models) {
      if (/^(nano-banana|imagen|gpt-image|grok-image|meta-ai-image|vela-ai-image)/i.test(m)) inferred[m] = 'image';
      else if (/^(veo|omni|sora|seedance|kling|minimax|flux|vela-ai-video|meta-ai|muse)/i.test(m)) inferred[m] = 'video';
    }
    if (!Object.keys(inferred).length) continue;
    p.modelCategories = p.modelCategories ?? {};
    let touched = false;
    for (const [m, cat] of Object.entries(inferred)) {
      if (!p.modelCategories[m]) { p.modelCategories[m] = cat; touched = true; }
    }
    if (touched) changed = true;
  }
  return changed;
}
/** Tokens das APIs das plataformas (Canais): passam pela mesma cifra das chaves de API. */
function mapChannelApis(c: Settings['channelApis'], f: (v: string) => string): Settings['channelApis'] {
  if (!c) return c;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ? { ...v, ...(typeof v.token === 'string' ? { token: f(v.token) } : {}) } : v])) as Settings['channelApis'];
}
function saveSettings(s: Settings) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  const out = { ...s, providers: s.providers.map((p) => ({ ...p, apiKey: enc(p.apiKey) })), stock: Object.fromEntries(Object.entries(s.stock ?? {}).map(([k, v]) => [k, { ...v, apiKey: enc(v?.apiKey ?? '') }])),
    channelApis: mapChannelApis(s.channelApis, enc) };
  /* gravação atômica (arquivo temporário + troca): uma queda no meio não apaga as configurações */
  const tmp = settingsFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dataRoot ? tokenize(out, dataRoot.root) : out, null, 2));
  try { if (fs.existsSync(settingsFile())) fs.copyFileSync(settingsFile(), settingsFile() + '.bak'); } catch { /* ignora */ }
  try { fs.renameSync(tmp, settingsFile()); } catch { fs.copyFileSync(tmp, settingsFile()); fs.rmSync(tmp, { force: true }); }
}

/**
 * Exporta o perfil inteiro (configurações + chaves + skills, rotas, plugins, vozes…) para
 * `<pasta>/FilmForgeData`. Coloque o FilmForge portátil ao lado dessa pasta e tudo abre igual.
 */
function exportPortableProfile(destParent: string): { root: string; copied: string[] } {
  const root = path.basename(destParent) === DATA_DIR_NAME ? destParent : path.join(destParent, DATA_DIR_NAME);
  const appData = path.join(root, 'appdata'), ws = path.join(root, 'workspace');
  fs.mkdirSync(appData, { recursive: true }); fs.mkdirSync(ws, { recursive: true });
  const copied = copyProfile(settings.workspace, ws);
  const pr = pluginsRoot(settings);
  if (path.resolve(pr) !== path.resolve(settings.workspace, 'plugins') && fs.existsSync(pr)) { fs.cpSync(pr, path.join(ws, 'plugins'), { recursive: true, force: true }); copied.push('plugins'); }
  relocate([path.join(ws, 'library'), path.join(ws, 'channels')], settings.workspace, ws);
  const out: Settings = { ...settings, workspace: ws, pluginsDir: '', projectsDir: '',
    providers: settings.providers.map((p) => ({ ...p, apiKey: sealPortable(appData, p.apiKey) })),
    stock: Object.fromEntries(Object.entries(settings.stock ?? {}).map(([k, v]) => [k, { ...v, apiKey: sealPortable(appData, v?.apiKey ?? '') }])),
    channelApis: mapChannelApis(settings.channelApis, (v) => sealPortable(appData, v)) };
  fs.writeFileSync(path.join(appData, 'settings.json'), JSON.stringify(tokenize(out, root), null, 2));
  fs.writeFileSync(path.join(appData, 'anchor.json'), JSON.stringify({ workspace: ws, projectsDir: path.join(ws, 'projects') }, null, 2));
  return { root, copied };
}

/** Importa um FilmForgeData (de outro PC ou de um backup) para a instalação atual. */
function importPortableProfile(src: string): { from: string; copied: string[] } {
  const root = fs.existsSync(path.join(src, 'appdata', 'settings.json')) ? src : path.join(src, DATA_DIR_NAME);
  const appData = path.join(root, 'appdata');
  const file = path.join(appData, 'settings.json');
  if (!fs.existsSync(file)) throw new Error(`não encontrei ${DATA_DIR_NAME}/appdata/settings.json nessa pasta`);
  const raw = expand(JSON.parse(fs.readFileSync(file, 'utf8')) as Settings, root);
  const theirWs = raw.workspace && fs.existsSync(raw.workspace) ? raw.workspace : path.join(root, 'workspace');
  const copied = copyProfile(theirWs, settings.workspace, true);
  relocate([path.join(settings.workspace, 'library'), path.join(settings.workspace, 'channels')], theirWs, settings.workspace);
  const open = (k: string) => {
    let v = k ?? '';
    for (let i = 0; i < 4 && v.startsWith('pk1:'); i++) v = openPortable(appData, v) ?? '';   // camadas repetidas (gravações antigas)
    return v.startsWith('enc:') ? dec(v) : v;
  };
  settings = { ...settings, ...raw, workspace: settings.workspace, projectsDir: settings.projectsDir, pluginsDir: settings.pluginsDir,
    providers: (raw.providers ?? settings.providers).map((p) => ({ ...p, apiKey: open(p.apiKey) })),
    stock: Object.fromEntries(Object.entries(raw.stock ?? {}).map(([k, v]) => [k, { ...v, apiKey: open(v?.apiKey ?? '') }])),
    channelApis: mapChannelApis(raw.channelApis, open) } as Settings;
  saveSettings(settings);
  return { from: root, copied };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 880, title: APP_NAME, icon: appIcon(), backgroundColor: bgFor(settings.theme),
    titleBarStyle: 'hidden', ...(process.platform !== 'darwin' ? { titleBarOverlay: overlayFor(settings.theme) } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  /* rede de segurança: ao voltar para a janela, o teclado volta para a página (no Windows, diálogos nativos
     deixavam inputs/textareas sem aceitar digitação até a janela perder e ganhar o foco) */
  win.on('focus', () => { if (win && !win.isDestroyed()) win.webContents.focus(); });
}

/* ───────── execuções ativas: indicador visual (faixa no topo, barra de tarefas, título) ─────────
 * Cada execução grava <projeto>/run-status.json (pid, etapa, progresso). A janela mostra as suas e também as de outros
 * processos do FilmForge (linha de comando --run-project, outra janela), lendo esses arquivos. */
interface LiveRun { id: string; name: string; pid: number; step?: string; done?: number; total?: number; etaMs?: number; elapsedMs?: number; startedAt: string; updatedAt: string; headless?: boolean; external?: boolean }
const liveRuns = new Map<string, LiveRun>();
const runStatusFile = (id: string) => { try { return path.join(projectDirOf(settings, id), 'run-status.json'); } catch { return ''; } };
function trackRun(e: EngineEvent & { projectId?: string }) {
  const id = e.projectId; if (!id) return;
  const ev = e as unknown as { t: string; stepId?: string; sceneId?: string; done?: number; total?: number; etaMs?: number; elapsedMs?: number; label?: string };
  if (ev.t === 'run.done') { liveRuns.delete(id); try { fs.rmSync(runStatusFile(id), { force: true }); } catch { /* ok */ } return; }
  if (!['run.start', 'step.start', 'run.progress', 'run.preflight'].includes(ev.t)) return;
  const now = new Date().toISOString();
  let r = liveRuns.get(id);
  if (!r) {
    let name = id; try { name = (JSON.parse(fs.readFileSync(path.join(projectDirOf(settings, id), 'project.json'), 'utf8')) as { name?: string }).name || id; } catch { /* sem nome */ }
    r = { id, name, pid: process.pid, startedAt: now, updatedAt: now, headless };
    liveRuns.set(id, r);
  }
  if (ev.t === 'step.start') r.step = `${ev.stepId ?? ''}${ev.sceneId ? ' · ' + ev.sceneId : ''}`;
  if (ev.t === 'run.progress') Object.assign(r, { done: ev.done, total: ev.total, etaMs: ev.etaMs, elapsedMs: ev.elapsedMs, ...(ev.label ? { step: ev.label } : {}) });
  r.updatedAt = now;
  try { const f = runStatusFile(id); if (f) fs.writeFileSync(f, JSON.stringify(r)); } catch { /* só indicador */ }
}
const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
/** execuções deste processo + de outros processos do FilmForge (arquivo run-status.json com pid vivo) */
function activeRuns(): LiveRun[] {
  const out = [...liveRuns.values()];
  try {
    const root = projectsDir(settings);
    for (const d of fs.readdirSync(root)) {
      if (liveRuns.has(d)) continue;
      const f = path.join(root, d, 'run-status.json');
      if (!fs.existsSync(f)) continue;
      try {
        const r = JSON.parse(fs.readFileSync(f, 'utf8')) as LiveRun;
        if (r.pid === process.pid || !pidAlive(r.pid)) { if (!pidAlive(r.pid)) fs.rmSync(f, { force: true }); continue; }
        out.push({ ...r, external: true });
      } catch { /* arquivo em escrita */ }
    }
  } catch { /* pasta de projetos indisponível */ }
  return out;
}
let lastRunsSig = '';
function pushActiveRuns() {
  if (!win || win.isDestroyed() || !settings) return;
  const runs = activeRuns();
  /* barra de tarefas do Windows: progresso real quando há total, senão "indeterminado"; título com o andamento */
  const withTotal = runs.filter((r) => r.total);
  const frac = withTotal.length ? withTotal.reduce((a, r) => a + Math.min(1, (r.done ?? 0) / (r.total || 1)), 0) / withTotal.length : -1;
  try { win.setProgressBar(runs.length ? (frac >= 0 ? Math.max(0.02, frac) : 2) : -1, { mode: runs.length ? (frac >= 0 ? 'normal' : 'indeterminate') : 'none' }); } catch { /* sem barra de tarefas */ }
  const title = runs.length ? `▶ ${frac >= 0 ? Math.round(frac * 100) + '% · ' : ''}${runs.length > 1 ? `${runs.length} vídeos` : runs[0]!.name} — ${APP_NAME}` : APP_NAME;
  if (win.getTitle() !== title) win.setTitle(title);
  const sig = JSON.stringify(runs.map((r) => [r.id, r.step, r.done, r.total, r.etaMs]));
  if (sig !== lastRunsSig) { lastRunsSig = sig; win.webContents.send('run:event', { t: 'runs.active', runs }); }
}
setInterval(pushActiveRuns, 2500).unref?.();

const send = (e: EngineEvent & { projectId?: string }) => {
  trackRun(e);
  if (win && !win.isDestroyed()) { win.webContents.send('run:event', e); if (e.t === 'run.start' || e.t === 'run.done' || e.t === 'step.start' || e.t === 'run.progress') pushActiveRuns(); }
  else if (headless) {
    /* sem console (exe de janela no Windows) o stdout quebra com EPIPE — o log não pode derrubar a etapa que está logando */
    const line = JSON.stringify(e);
    try { console.log(line); } catch { /* stdout fechado */ }
    if (headlessLog) try { fs.appendFileSync(headlessLog, line + '\n'); } catch { /* só registro */ }
  }
};
/** modo headless: os eventos também vão para <projeto>/headless.log */
let headlessLog = '';
process.stdout?.on?.('error', () => { /* EPIPE: sem console */ });
process.stderr?.on?.('error', () => { /* EPIPE: sem console */ });

type Only = { stepIds?: string[]; sceneIds?: string[] };

/** Dependências do servidor MCP (modo `--mcp` e autoteste). */
function mcpDeps() {
  return {
    getSettings: () => settings,
    version: app.getVersion(),
    listRows: () => Promise.all(listProjects(settings).map((p) => projectRow(p.id))),
    runProject: (id: string, only?: Only) => startRun(id, only, false),
    cancelProject: (id: string) => { const ac = running.get(id); if (!ac) return false; ac.abort(); return true; },
    renderFinal: (id: string) => { const p = ops.readProject(settings, id); return startRun(id, { stepIds: finalizeSteps(p, [], true) }, true); },
    running: () => [...running.keys()],
    progressOf: (id: string) => progressByProject.get(id) ?? null,
  };
}
const progressByProject = new Map<string, unknown>();

/** Uma linha da aba Projetos (usada pela lista, pelo botão "Atualizar" e pelo MCP). */
async function projectRow(id: string) {
  const dir = projectDirOf(settings, id);
  let pr: Project | undefined;
  try { pr = ops.readProject(settings, id); } catch { /* projeto ilegível: lista só o básico */ }
  const base = { id, name: pr?.name ?? id, videoType: pr?.videoType ?? 'custom', createdAt: pr?.createdAt ?? '' };
  const scenes = (pr?.scenes ?? []).length;
  const scenesWithMedia = (pr?.scenes ?? []).filter((sc) => Object.values(sc.artifacts ?? {}).some((a) => a.length > 0)).length;
  const lastRun = pr?.production?.runs?.[pr.production.runs.length - 1];
  const hasFinal = fs.existsSync(path.join(dir, 'out', 'final.mp4'));
  const isRunning = running.has(id);
  const status = isRunning ? 'running' : hasFinal ? 'done' : lastRun && !lastRun.ok ? 'failed' : scenes > 0 || lastRun ? 'partial' : 'new';
  const firstFrame = isRunning ? null : await ensureFirstFrame(settings, id);
  let updatedAt = base.createdAt; try { updatedAt = fs.statSync(path.join(dir, 'project.json')).mtime.toISOString(); } catch { /* ignore */ }
  return { ...base, scenes, scenesWithMedia, hasFinal, running: isRunning, totalMs: pr?.production?.totalMs ?? 0, firstFrame, frameFromFinal: hasFinal && !!firstFrame,
    typeId: pr?.typeId, language: pr?.language, status, runs: pr?.production?.runs?.length ?? 0, lastRunAt: lastRun?.endedAt, lastRunOk: lastRun?.ok, updatedAt,
    skillId: pr?.skillId ?? pr?.skill?.id, skillName: pr?.skill?.name, routeName: pr?.route?.name, aspect: pr?.aspect, targetDurationSec: pr?.targetDurationSec, dir,
    plugins: pr?.plugins ?? [] };
}

/** folga após o tempo máximo de produção: cenas em andamento terminam (e entram no cache) antes do corte */
const DEADLINE_GRACE_MIN = 10;

/** execuções pausadas esperando o usuário (storyboard): projeto → resposta */
const approvals = new Map<string, (ok: boolean) => void>();

async function startRun(id: string, only?: Only, noCache = false): Promise<{ ok: boolean; error?: string }> {
  if (running.has(id)) return { ok: false, error: 'projeto já em execução' };
  const project: Project = ops.readProject(settings, id);
  if (!project.route) return { ok: false, error: 'projeto sem rota' };
  /* bypass de executor do projeto: vale só nesta execução (a rota gravada não muda) */
  const runRouteEff = applyBypass(project.route, project.executorBypass);

  /* ── parâmetros efetivos + log ficam gravados no projeto ─────────── */
  const conc = Math.max(0, Math.min(8, Math.round(project.sceneConcurrency ?? settings.defaults?.sceneConcurrency ?? 0)));
  project.params = {
    routeId: project.route.id, routeName: project.route.name, skillId: project.skillId,
    quality: project.quality, aspect: project.aspect, targetDurationSec: project.targetDurationSec,
    language: project.language, sceneConcurrency: conc, maxProductionMin: project.maxProductionMin,
    plugins: project.plugins,
    executorBypass: project.executorBypass?.enabled ? project.executorBypass : undefined,
    steps: runRouteEff.steps.map((s) => ({ id: s.id, kind: s.kind, scope: s.scope, binding: s.bindings.map(bindingLabel).join(' | ') })),
  };
  project.log = [...(project.log ?? []).slice(-600), `── execução ${new Date().toLocaleString('pt-BR')} ──`];
  const bp = project.executorBypass;
  if (bp?.enabled) project.log.push(`⚡ bypass de executor: ${bp.binding.harness}${bp.binding.model ? '/' + bp.binding.model : ''} ${bp.exclusive ? 'SOZINHO' : 'à frente'} em ${bypassTargets(project.route, bp).join(', ') || 'nenhuma etapa'}`);
  const stamp = () => new Date().toISOString().slice(11, 19);
  const tag = (ev: { sceneId?: string; stepId?: string }) => `${ev.sceneId ? ev.sceneId + ' · ' : ''}${ev.stepId ?? ''}`.trim();
  const persistLog = () => {
    if (project.log && project.log.length > 900) project.log = project.log.slice(-800);
    /* sem tocar no scenes.json: durante a execução quem carrega as cenas é o motor (gravar a lista da memória,
       ainda vazia, no instante em que o plano termina apagava o plano recém-escrito) */
    try { ops.saveProjectFile(settings, project, { scenes: false }); } catch { /* o motor também grava */ }
  };
  const emitEvent = (ev: EngineEvent) => {
    switch (ev.t) {
      case 'run.start': project.log!.push(`${stamp()} ▶ execução iniciada`); break;
      case 'log': project.log!.push(`${stamp()} ${ev.line}`); break;
      case 'step.done': project.log!.push(`${stamp()} ✓ ${tag(ev)} → ${ev.binding}`); break;
      case 'step.cache_hit': project.log!.push(`${stamp()} ✓ cache ${tag(ev)}`); break;
      case 'step.failed': project.log!.push(`${stamp()} ✗ ${tag(ev)}: ${ev.reason}`); break;
      case 'step.skipped': project.log!.push(`${stamp()} pulado ${tag(ev)}: ${ev.reason}`); break;
      case 'step.fallback': project.log!.push(`${stamp()} ⤵ ${tag(ev)}: ${ev.from} → ${ev.to} (${ev.reason})`); break;
      case 'run.preflight':
        project.log!.push(`${stamp()} ▸ pré-checagem: ${ev.steps.map((s) => `${s.id}=${s.binding}${s.harness ? ` (${s.harness}${s.model ? '/' + s.model : ''})` : ''}${s.ok === false ? ' ⚠' : ''}`).join(' · ')}`);
        break;
      case 'run.done': project.log!.push(`${stamp()} ${ev.ok ? '■ concluído' : `■ falhou: ${ev.error}`}`); persistLog(); break;
      case 'run.progress':
        progressByProject.set(id, { done: ev.done, total: ev.total, mode: ev.mode, etaMs: ev.etaMs, elapsedMs: ev.elapsedMs, label: ev.label, at: new Date().toISOString() });
        if (ev.done >= ev.total) persistLog();
        break;
    }
    send({ ...ev, projectId: id } as EngineEvent & { projectId: string });
  };

  const ac = new AbortController();
  const drain = new AbortController();
  running.set(id, ac);
  const limitMin = project.maxProductionMin ?? 0;
  let timedOut = false;
  const limitMsg = `tempo máximo de produção (${limitMin} min) atingido. O que já foi gerado fica em cache: execute de novo para continuar ou aumente o limite.`;
  /* prazo: primeiro para de começar cenas novas; as que estão rodando têm uma folga para terminar e entrar no cache */
  let hardStop: ReturnType<typeof setTimeout> | undefined;
  const deadline = limitMin > 0 ? setTimeout(() => {
    timedOut = true;
    emitEvent({ t: 'log', line: `tempo máximo (${limitMin} min) atingido: nenhuma cena nova começa; as em andamento têm até ${DEADLINE_GRACE_MIN} min para terminar` });
    drain.abort(new Error(limitMsg));
    hardStop = setTimeout(() => ac.abort(new Error(limitMsg)), DEADLINE_GRACE_MIN * 60_000);
  }, limitMin * 60_000) : undefined;
  if (limitMin > 0) emitEvent({ t: 'log', line: `tempo máximo desta execução: ${limitMin} min` });
  const t0 = Date.now();
  let res: { ok: boolean; error?: string } = { ok: false };
  try {
    /* aprovação na tela (storyboard): a execução espera a resposta; cancelar a execução conta como "não" */
    const approve = (stepId: string) => new Promise<boolean>((resolve) => {
      approvals.get(id)?.(false);
      const done = (ok: boolean) => { ac.signal.removeEventListener('abort', onAbort); approvals.delete(id); resolve(ok); };
      const onAbort = () => done(false);
      ac.signal.addEventListener('abort', onAbort, { once: true });
      approvals.set(id, done);
      emitEvent({ t: 'log', line: `⏸ aguardando sua aprovação (${stepId}) — abra o storyboard e aprove para continuar` });
    });
    const deps = { settings, emit: emitEvent, approve, executors: createExecutors({ workflowsDir: workflowsDir(), toolsDir: toolsDir(), renderHtml, snapHtml, kitRender: { host: kitHost, frames: renderKitFrames } }) };
    /* skill de link: abre a página da ideia no navegador invisível, lê o conteúdo e grava a rolagem (anexos web/) */
    if (project.skill?.linkCapture) {
      try {
        if (await captureLink({ project, projectDir: projectDirOf(settings, id), ffmpeg: settings.ffmpeg, signal: ac.signal, log: (line) => emitEvent({ t: 'log', line }) }))
          ops.saveProjectFile(settings, project, { scenes: false });
      } catch (e) { emitEvent({ t: 'log', line: `⚠ não foi possível capturar o link (${(e as Error).message.slice(0, 200)}) — o vídeo segue só com a ideia` }); }
    }
    /* vídeos/áudios anexados: transcreve uma vez para a narração saber o que eles mostram e o plano escolher os trechos */
    if ((project.attachments ?? []).some((a) => (a.kind === 'video' || a.kind === 'audio') && !a.file.startsWith('web/'))) {
      try {
        await attachments.ensureAttachmentTranscripts({ settings, project, projectDir: projectDirOf(settings, id), toolsDir: toolsDir(), signal: ac.signal, log: (line) => emitEvent({ t: 'log', line }) });
      } catch (e) { emitEvent({ t: 'log', line: `aviso: não foi possível transcrever os anexos (${(e as Error).message.slice(0, 160)})` }); }
    }
    res = await runRoute({ project, route: runRouteEff, projectDir: projectDirOf(settings, id), signal: ac.signal, drain: drain.signal, only, noCache, deps });
    /* qualidade "ultra": a revisão aponta cenas com problema → refaz só essas cenas + montagem (rodadas limitadas) */
    for (let guardN = 0; res.ok && !ac.signal.aborted && !drain.signal.aborted && guardN < 3; guardN++) {
      const fix = autoFixPlan(project, projectDirOf(settings, id));
      if (!fix) break;
      project.autoFixRounds = (project.autoFixRounds ?? 0) + 1;
      emitEvent({ t: 'log', line: `correção automática (rodada ${project.autoFixRounds}): nota ${fix.score} < ${fix.minScore} → refazendo ${fix.sceneIds.join(', ')}` });
      res = await runRoute({ project, route: runRouteEff, projectDir: projectDirOf(settings, id), signal: ac.signal, drain: drain.signal, only: { stepIds: fix.stepIds, sceneIds: fix.sceneIds }, noCache: false, deps });
      if (res.ok) {   // depois de refazer as cenas, monta e revisa o vídeo inteiro de novo
        res = await runRoute({ project, route: runRouteEff, projectDir: projectDirOf(settings, id), signal: ac.signal, drain: drain.signal, only: { stepIds: fix.finalSteps }, noCache: false, deps });
      }
    }
    if (timedOut) res = { ok: false, error: limitMsg };
    return res;
  } finally {
    if (deadline) clearTimeout(deadline);
    if (hardStop) clearTimeout(hardStop);
    running.delete(id);
    persistLog();
    try { recordRun(settings, id, t0, Date.now(), res.ok); await ensureFirstFrame(settings, id); } catch { /* não bloqueia */ }
    /* pasta "publicar": vídeo com título sugestivo, thumbnail, título, descrição, tags e capítulos */
    if (res.ok) try { await publishKit(id); } catch (e) { emitEvent({ t: 'log', projectId: id, line: `aviso: pasta de publicação não gerada (${(e as Error).message.slice(0, 160)})` } as EngineEvent); }
  }
}

async function publishKit(id: string) {
  const dir = projectDirOf(settings, id), final = path.join(dir, 'out', 'final.mp4');
  const secs = fs.existsSync(final) ? await ff.duration(settings.ffprobe, final).catch(() => 0) : 0;
  const r = writePublishKit(dir, ops.readProject(settings, id), secs || undefined);
  if (r) send({ t: 'log', projectId: id, line: `📦 pronto para publicar: ${path.relative(dir, r.video)} + thumbnail, título, descrição e tags (out/publicar)` } as EngineEvent);
  return r;
}

/** Faixa de efeitos da cena como artefato (a prévia do editor toca junto com a narração). */
function setSfxArtifact(p: Project, sc: Project['scenes'][number], dir: string) {
  const f = path.join(dir, 'scenes', sc.id, 'audio', 'sfx.wav');
  const key = p.route?.steps.find((st) => st.kind === 'sfx')?.id ?? 'sfx';
  if (sfx.validWav(f)) { sc.artifacts[key] = [f]; sc.status[key] = 'done'; } else delete sc.artifacts[key];
}
const idle = (id: string) => { if (running.has(id)) throw new Error('o projeto está em execução; aguarde ou cancele'); };

/**
 * Plano da correção automática (qualidade "ultra"): lê review.json; se a nota ficou abaixo
 * do mínimo e ainda há rodadas, grava a correção em scene.notes, muda a variação (novo
 * seed/cache) e devolve as etapas a refazer.
 */
function autoFixPlan(p: Project, dir: string): { score: number; minScore: number; sceneIds: string[]; stepIds: string[]; finalSteps: string[] } | undefined {
  const rv = p.route?.steps.find((s) => s.kind === 'review' && s.scope === 'project' && s.enabled && (s.params as Record<string, unknown>)?.['autoFix'] === true);
  if (!rv) return undefined;
  const prm = rv.params as Record<string, unknown>;
  const minScore = Number(prm['minScore'] ?? 7), maxRounds = Number(prm['maxRounds'] ?? 1);
  if ((p.autoFixRounds ?? 0) >= maxRounds) return undefined;
  let j: { score?: number; scenes?: Array<{ id?: string; fix?: string; issue?: string }> };
  try { j = JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8')); } catch { return undefined; }
  const score = Number(j.score);
  if (!Number.isFinite(score) || score >= minScore) return undefined;
  const sceneIds: string[] = [];
  for (const it of (j.scenes ?? []).slice(0, 3)) {
    const sc = p.scenes.find((x) => x.id === it.id);
    if (!sc || !(it.fix || it.issue)) continue;
    sc.notes = [sc.notes, `Revisão: ${it.fix || it.issue}`].filter(Boolean).join(' | ').slice(0, 800);
    sc.variation = (sc.variation ?? 0) + 1;
    sceneIds.push(sc.id);
  }
  if (!sceneIds.length) return undefined;
  const steps = p.route!.steps.filter((s) => s.enabled);
  /* refaz o visual da cena (a narração só muda se o texto mudar; o cache cuida disso) */
  const stepIds = steps.filter((s) => s.scope === 'scene').map((s) => s.id);
  const finalSteps = steps.filter((s) => s.scope === 'project' && ['subtitles', 'edit', 'review', 'thumbnail'].includes(s.kind)).map((s) => s.id);
  return { score, minScore, sceneIds, stepIds, finalSteps };
}

/** Etapas de cena afetadas + montagem final. */
function finalizeSteps(p: Project, stepIds: string[], finalize: boolean): string[] {
  const out = new Set(stepIds);
  if (finalize) for (const s of p.route?.steps ?? []) if (s.kind === 'subtitles' || s.kind === 'edit') out.add(s.id);
  return [...out];
}

function registerIpc() {
  const h = (ch: string, fn: (...a: any[]) => unknown) =>
    ipcMain.handle(ch, async (_e: unknown, ...a: any[]) => {
      try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: (e as Error).message }; }
    });

  h('meta:get', () => ({ videoTypes: VIDEO_TYPES, routes: lib.listRoutes(settings), skills: lib.listSkills(settings), types: lib.listTypes(settings), agents: lib.listAgents(settings),
    harnessIds: Object.keys(DEFAULT_HARNESSES), stepKinds: lib.ALL_STEP_KINDS, thumbnails: settings.thumbnails ?? [], voices: listVoices(),
    sfxLibrary: sfx.SFX_LIBRARY.map(({ id, label, icon, tags, dur }) => ({ id, label, icon, tags, dur })),
    profiles: allProfiles(settings.executorProfiles) }));
  h('catalog:get', () => buildCatalog(settings, workflowsDir()));

  // biblioteca: rotas, skills, tipos de vídeo
  h('route:list', () => lib.listRoutes(settings));
  h('route:save', (r: Route) => lib.saveRoute(settings, r));
  h('route:delete', (id: string) => { lib.deleteRoute(settings, id); return true; });
  h('route:validate', (r: Route) => lib.validateRoute(r));
  h('skill:list', () => lib.listSkills(settings));
  h('skill:save', (k: Parameters<typeof lib.saveSkill>[1]) => lib.saveSkill(settings, k));
  h('skill:delete', (id: string) => { lib.deleteSkill(settings, id); return true; });
  h('vtype:list', () => lib.listTypes(settings));
  h('vtype:save', (t: Parameters<typeof lib.saveType>[1]) => lib.saveType(settings, t));
  h('vtype:delete', (id: string) => { lib.deleteType(settings, id); return true; });
  h('agent:list', () => lib.listAgents(settings));
  h('agent:save', (a: Parameters<typeof lib.saveAgent>[1]) => lib.saveAgent(settings, a));
  h('agent:delete', (id: string) => { lib.deleteAgent(settings, id); return true; });

  // dobras de nicho (persistentes): listar/salvar/escolher/aplicar na skill
  h('fold:list', () => {
    const projects = listProjects(settings);
    return lib.foldsWithMetrics(lib.listFolds(settings), projects);
  });
  h('fold:save', (f: Parameters<typeof lib.saveFold>[1]) => lib.saveFold(settings, f));
  h('fold:delete', (id: string) => { lib.deleteFold(settings, id); return true; });
  h('fold:choose', (id: string) => lib.chooseFold(settings, id));
  h('fold:apply', (id: string) => lib.applyFoldToSkill(settings, id));
  h('fold:ensure', (o: Parameters<typeof lib.ensureFolds>[1]) => lib.ensureFolds(settings, o));

  // importar / exportar rotas (JSON) e skills (Markdown)
  h('route:export', async (id: string) => {
    const r = await dialog.showSaveDialog(win!, { title: 'Exportar rota', defaultPath: path.join(app.getPath('documents'), `${id}.json`), filters: [{ name: 'Rota (JSON)', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    return lib.exportRouteFile(settings, id, r.filePath);
  });
  h('route:import', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Importar rota(s)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Rota (JSON)', extensions: ['json'] }] });
    if (r.canceled) return [];
    return r.filePaths.map((f) => lib.importRouteFile(settings, f));
  });
  h('skill:export', async (id: string) => {
    const r = await dialog.showSaveDialog(win!, { title: 'Exportar skill', defaultPath: path.join(app.getPath('documents'), `${id}.md`), filters: [{ name: 'Skill (Markdown)', extensions: ['md'] }] });
    if (r.canceled || !r.filePath) return null;
    return lib.exportSkillFile(settings, id, r.filePath);
  });
  h('skill:import', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Importar skill(s)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Skill (Markdown ou JSON)', extensions: ['md', 'markdown', 'json'] }] });
    if (r.canceled) return [];
    return r.filePaths.map((f) => lib.importSkillFile(settings, f));
  });
  h('library:export-all', async (kind: 'routes' | 'skills') => {
    const r = await dialog.showOpenDialog(win!, { title: kind === 'routes' ? 'Pasta para exportar as rotas' : 'Pasta para exportar as skills', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return lib.exportLibrary(settings, kind, r.filePaths[0]);
  });

  // plugins (formato Claude): pasta ou URL do GitHub
  h('plugins:list', () => listPlugins(settings));
  h('plugins:install-folder', async (src?: string) => {
    let dir = src?.trim();
    if (!dir) {
      const r = await dialog.showOpenDialog(win!, { title: 'Pasta do plugin (formato Claude)', properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      dir = r.filePaths[0];
    }
    return withPreview(installPluginFolder(settings, dir));
  });
  h('plugins:install-url', async (url: string) => withPreview(await installPluginUrl(settings, url)));
  /** prévia de 2–3 s do plugin, renderizada pelo motor dele (kit) — sem IA */
  const previewing = new Map<string, Promise<string>>();
  const makePreview = (id: string, force = false, styleId?: string): Promise<string> => {
    const dir = path.join(pluginsRoot(settings), id);
    const k = detectKit(dir);
    if (!k) return Promise.reject(new Error('este plugin não traz motor de animação próprio (kit)'));
    const file = styleId ? path.join(dir, '_gallery', `preview-${styleId}.mp4`) : previewFile(dir);
    if (!force && fs.existsSync(file)) return Promise.resolve(file);
    const key = `${id}::${styleId ?? ''}`;
    const running = previewing.get(key);
    if (running) return running;
    const job = kitPreview(settings, k, { host: kitHost, frames: renderKitFrames }, (line) => send({ t: 'log', line: `prévia do plugin: ${line}` } as EngineEvent), 3, styleId)
      .finally(() => previewing.delete(key));
    previewing.set(key, job);
    return job;
  };
  /** biblioteca de estilos do plugin (pages): baixa do repositório que o plugin indica */
  h('plugin:library', async (id: string) => {
    const k = detectKit(path.join(pluginsRoot(settings), id));
    if (!k || k.kind !== 'pages') throw new Error('este plugin não usa uma biblioteca de estilos');
    await ensureLibrary(k, (line) => send({ t: 'log', line: `biblioteca do plugin: ${line}` } as EngineEvent));
    return true;
  });
  /* depois de instalar, a prévia é gerada em segundo plano (o cartão mostra "gerando…") */
  const withPreview = <T extends { id: string }>(p: T): T => { void makePreview(p.id).then(() => send({ t: 'plugins.changed' } as unknown as EngineEvent)).catch(() => {}); return p; };
  h('plugin:preview', (id: string, force?: boolean, styleId?: string) => makePreview(id, !!force, styleId));
  h('plugin:previewing', () => [...previewing.keys()]);
  /** troca de estilo do motor do plugin: renderiza de novo os planos já escritos (sem IA); depois é só "Renderizar final" */
  h('kit:rerender', async (id: string) => {
    idle(id);
    const p = ops.readProject(settings, id);
    const kit = projectKit(pluginsRoot(settings), p);
    if (!kit) throw new Error('o projeto não usa um plugin com motor próprio');
    const ac = new AbortController(); running.set(id, ac);
    try { return await kitRerender(settings, p, projectDirOf(settings, id), kit, { host: kitHost, frames: renderKitFrames }, (line) => send({ t: 'log', line, projectId: id } as EngineEvent & { projectId: string }), ac.signal); }
    finally { running.delete(id); }
  });
  h('plugins:remove', (id: string) => { removePlugin(settings, id); return true; });
  /* adaptar o plugin ao FilmForge: o que entra em cada etapa (com IA ou sem IA) */
  h('plugins:adapt', async (id: string, o: { harness?: string; model?: string } = {}) => {
    const a = await adaptPlugin(settings, id, { harness: (o.harness ?? '') as HarnessBinding['harness'] | '', model: o.model, log: (line) => send({ t: 'log', stepId: 'craft', line } as EngineEvent) });
    send({ t: 'plugins.changed' } as unknown as EngineEvent);
    return a;
  });
  h('plugins:adapt-remove', (id: string) => { const r = removeAdaptation(settings, id); send({ t: 'plugins.changed' } as unknown as EngineEvent); return r; });
  /** o que o plugin injeta numa etapa específica (prévia da adaptação) */
  h('plugins:prompt-step', (id: string, stepKind: string) => pluginPrompt(settings, [id], {}, { stepKind }));
  /** Exporta o plugin como arquivo .plugin (zip no formato do Claude). */
  h('plugins:export-file', async (id: string) => {
    const r = await dialog.showSaveDialog(win!, { title: 'Exportar plugin', defaultPath: path.join(app.getPath('documents'), `${id}.plugin`), filters: [{ name: 'Plugin do Claude', extensions: ['plugin'] }] });
    if (r.canceled || !r.filePath) return null;
    return exportPluginFile(settings, id, r.filePath);
  });
  /** Instala de um arquivo .plugin/.zip escolhido pelo usuário. */
  h('plugins:install-file', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Instalar plugin (.plugin)', properties: ['openFile'], filters: [{ name: 'Plugin do Claude', extensions: ['plugin', 'zip'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return withPreview(installPluginFile(settings, r.filePaths[0]));
  });
  h('plugins:open-folder', () => { const d = pluginsRoot(settings); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });
  /* pacote portátil com TODOS os plugins + dependências (.ffplugins): leva os plugins para outro computador */
  h('plugins:export-pack', async () => {
    const r = await dialog.showSaveDialog(win!, { title: 'Exportar todos os plugins (portátil)', defaultPath: path.join(app.getPath('documents'), `plugins-${new Date().toISOString().slice(0, 10)}.ffplugins`), filters: [{ name: 'Pacote de plugins', extensions: ['ffplugins'] }] });
    if (r.canceled || !r.filePath) return null;
    const out = exportPluginsPack(settings, r.filePath); shell.showItemInFolder(out.file); return out;
  });
  h('plugins:import-pack', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Importar pacote de plugins', properties: ['openFile'], filters: [{ name: 'Pacote de plugins', extensions: ['ffplugins', 'zip'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return importPluginsPack(settings, r.filePaths[0]);
  });
  /** Auditoria: incoerências entre skills, rotas, workflows, provedores, vozes e contas. */
  h('library:audit', (includeBuiltin = true) => auditLibrary(settings, workflowsDir(), { includeBuiltin }));
  /** Botão "⬆ YouTube" do editor: envia out/final.mp4 (padrão: não listado) pela conta Google das Automações. */
  h('youtube:upload', async (id: string, o: { account?: string; visibility?: 'UNLISTED' | 'PRIVATE' | 'PUBLIC' } = {}) => {
    idle(id);
    const p = ops.readProject(settings, id);
    const ac = new AbortController(); running.set(id, ac);
    try {
      return await uploadProjectToYouTube(settings, p, projectDirOf(settings, id), { ...o, signal: ac.signal, log: (line) => send({ t: 'log', line, projectId: id } as EngineEvent & { projectId: string }) });
    } finally { running.delete(id); }
  });
  /* ── Obter vídeos → YouTube: vídeos que arrebentam ── */
  /* favoritos do Obter vídeos (workspace/finder/favorites.json) */
  const favFile = () => path.join(settings.workspace, 'finder', 'favorites.json');
  const readFavs = (): Array<{ id: string; savedAt?: string }> => { try { return JSON.parse(fs.readFileSync(favFile(), 'utf8')); } catch { return []; } };
  h('finder:favorites', () => readFavs());
  h('finder:favorites-remove', (ids: string[]) => {
    const next = readFavs().filter((x) => !ids.includes(x.id));
    fs.mkdirSync(path.dirname(favFile()), { recursive: true });
    fs.writeFileSync(favFile(), JSON.stringify(next, null, 1));
    return next;
  });
  /** IA da pesquisa: lê os resultados (títulos, números, motivos) e aponta tendências, padrões e oportunidades. */
  h('finder:insights', async (input: { query: string; videoType?: string; platform?: string; videos: Array<{ title: string; channel: string; views: number; subs?: number; ageDays?: number; durationSec?: number; score: number; searchLang: string }> }, ai?: { harness?: string; model?: string }) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 300_000);
    try {
      const list = input.videos.slice(0, 40).map((v, i) => `${i + 1}. [${v.score}] "${v.title}" — ${v.channel} · ${v.views} views · ${v.subs ?? '?'} inscritos · ${v.ageDays ?? '?'} dias · ${v.durationSec ?? '?'} s · ${v.searchLang}`).join('\n');
      const lang = settings.uiLanguage === 'en' ? 'English' : settings.uiLanguage === 'es' ? 'español' : 'português do Brasil';
      const { json, binding } = await llmJson([{ type: 'harness', harness: (ai?.harness || 'auto') as HarnessBinding['harness'], model: ai?.model || undefined }], settings, path.join(settings.workspace, 'tools', 'finder'),
        `Você é analista de ${input.platform || 'YouTube'}. Pesquisa: "${input.query || '(sem termo)'}"${input.videoType ? ` · tipo de vídeo: ${input.videoType}` : ''}. Resultados (nota 0–100 = quanto o vídeo superou o tamanho do canal):\n${list}\n\n` +
        `Analise o que os vídeos de nota alta têm em comum e responda em ${lang}, SOMENTE com JSON: {"summary":"2–3 frases","trends":["tema/assunto em alta", "..."],"titlePatterns":["fórmula de título que funciona", "..."],"formats":["duração/formato/estilo que funciona", "..."],"opportunities":["lacuna ou nicho pouco explorado", "..."],"ideas":["5 ideias de vídeo originais (título)"]}`, ac.signal, () => {});
      return { ...(json as Record<string, unknown>), binding };
    } finally { clearTimeout(t); }
  });
  h('finder:favorite', (v: { id: string }) => {
    const list = readFavs();
    const next = list.some((x) => x.id === v.id) ? list.filter((x) => x.id !== v.id) : [{ ...v, savedAt: new Date().toISOString() }, ...list];
    fs.mkdirSync(path.dirname(favFile()), { recursive: true });
    fs.writeFileSync(favFile(), JSON.stringify(next, null, 1));
    return next;
  });
  /* clonar canal: skill + rota + template de thumbnail + banner/thumb/vídeo de 10 s */
  let cloneAbort: AbortController | undefined;
  let brandAbort: AbortController | undefined;
  let cloneState: (CloneProgress & { running: boolean; startedAt: string; url: string; error?: string }) | undefined;
  h('channel:clone', async (input: ChannelCloneInput) => {
    cloneAbort?.abort(); cloneAbort = new AbortController();
    /* estado da clonagem visível em qualquer tela (indicador global) e recuperável se a janela recarregar */
    cloneState = { running: true, name: input.channelName ?? input.channelUrl, stage: 'list', pct: 0, label: 'iniciando', startedAt: new Date().toISOString(), url: input.channelUrl };
    send({ t: 'clone.progress', ...cloneState } as unknown as EngineEvent);
    try {
      const r = await cloneChannel(settings, input, { toolsDir: toolsDir(), renderHtml, appVersion: app.getVersion(), signal: cloneAbort.signal,
        /* perfis de TikTok/Instagram/Facebook/Kwai: grade do perfil no navegador da pesquisa + yt-dlp */
        listProfile: async (url) => { const p = clonePlatform(url).id; if (p === 'youtube') throw new Error('perfil inválido'); return listProfile(p, url, socialDeps(), Math.max(12, (input.deep ?? 4) * 6)); },
        log: (line) => send({ t: 'log', stepId: 'channel', line } as EngineEvent),
        progress: (p) => { cloneState = { ...cloneState!, ...p, name: p.name || cloneState!.name, running: p.stage !== 'done' }; send({ t: 'clone.progress', ...cloneState } as unknown as EngineEvent); } });
      if (r.thumbnailTemplate) { settings.thumbnails = [...(settings.thumbnails ?? []).filter((x) => x.id !== r.thumbnailTemplate!.id), r.thumbnailTemplate]; saveSettings(settings); }
      return r;
    } catch (e) {
      cloneState = { ...cloneState!, running: false, stage: 'done', error: (e as Error).message };
      send({ t: 'clone.progress', ...cloneState } as unknown as EngineEvent);
      throw e;
    } finally { if (cloneState) cloneState.running = false; }
  });
  h('channel:clone-cancel', () => { cloneAbort?.abort(); return true; });
  h('channel:status', () => cloneState);
  /* clones: pacote portátil (.ffclone), importação (recria skill, rota, dobras e template) e exclusão */
  h('channel:export', async (id: string) => {
    const r = await dialog.showSaveDialog(win!, { title: 'Exportar canal clonado', defaultPath: path.join(app.getPath('documents'), `${id}.ffclone`), filters: [{ name: `Canal clonado do ${APP_NAME}`, extensions: ['ffclone'] }] });
    if (r.canceled || !r.filePath) return null;
    return cloneStore(settings, app.getVersion()).exportPackage(id, r.filePath);
  });
  h('channel:import', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Importar canal clonado', properties: ['openFile'], filters: [{ name: `Canal clonado do ${APP_NAME}`, extensions: ['ffclone', 'zip'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const c = cloneStore(settings, app.getVersion()).importPackage(r.filePaths[0]);
    /* a skill e a rota viajam dentro do clone: recria na biblioteca deste PC se não existirem */
    if (c.skill && !lib.getSkill(settings, c.skill.id)) {
      /* a mídia de exemplo da skill fica na biblioteca do PC de origem: usa a demo de 10 s que viaja dentro do clone */
      const sk = { ...c.skill, builtin: undefined } as typeof c.skill;
      if (sk.previewMedia && !fs.existsSync(sk.previewMedia)) {
        const demo = c.files?.demo && fs.existsSync(c.files.demo) ? c.files.demo : undefined;
        if (demo) { const dest = path.join(settings.workspace, 'library', 'skill-media', `${sk.id}.mp4`); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(demo, dest); sk.previewMedia = dest; }
        else delete sk.previewMedia;
      }
      lib.saveSkill(settings, sk as never);
    }
    if (c.route && !lib.getAnyRoute(settings, c.route.id)) lib.saveRoute(settings, c.route);
    if (c.thumbnailTemplate && !(settings.thumbnails ?? []).some((t) => t.id === c.thumbnailTemplate!.id)) { settings.thumbnails = [...(settings.thumbnails ?? []), c.thumbnailTemplate]; saveSettings(settings); }
    if (c.bends?.length) lib.ensureFolds(settings, { channel: c.channelKey ?? c.id, channelName: c.brand?.names?.[0] ?? c.skill?.name, sourceChannel: c.source.name, sourceUrl: c.source.url,
      skillId: c.skill?.id, routeId: c.route?.id, language: c.language?.code, aspect: c.skill?.aspect, bends: c.bends, chosen: c.chosenBend });
    return c;
  });
  h('channel:delete', (id: string) => { cloneStore(settings).remove(id); return true; });
  h('channel:list', () => listChannelClones(settings));
  /** uso dos harnesses: Claude (sessão/semana), Codex, OpenCode e Antigravity por conta */
  h('usage:report', () => usageReport(settings));
  h('channel:pending', () => listPendingClones(settings));

  /* ── Canais (os SEUS: identidade de publicação) — namespace 'channels:' para não colidir com os clones ── */
  const channelsState = () => ({ list: myChannels.listChannels(settings), platforms: myChannels.PLATFORM_INFO, ready: myChannelPub.readyPlatforms(),
    max: myChannels.MAX_CHANNELS, accounts: auto.listAccounts(settings).map((a) => ({ id: a.id, label: a.label, email: a.email, hasProfile: a.hasProfile })) });
  h('channels:get', () => ({ ...channelsState(), types: CHANNEL_TYPES, thumbStyles: THUMB_STYLES,
    apis: { youtube: !!settings.stock?.youtube?.apiKey?.trim(), tiktok: !!settings.channelApis?.tiktok?.token, facebook: !!settings.channelApis?.facebook?.token,
      instagram: !!settings.channelApis?.instagram?.token, kwai: !!settings.channelApis?.kwai?.token } }));
  h('channels:add', (input: { name?: string; platform?: ChannelPlatform; accountId?: string; link?: string; type?: string; language?: string }) => {
    const c = myChannels.addChannel(settings, input); saveSettings(settings); return { channel: c, state: channelsState() };
  });
  /** confere o link antes de cadastrar (plataforma, @handle, URL normalizada) */
  h('channels:parse-link', (link: string) => parseChannelLink(link));
  /** tokens das APIs de análise (TikTok, Facebook, Instagram, Kwai); a chave do YouTube fica nos bancos de mídia */
  h('channels:apis-set', (patch: Settings['channelApis'] & { youtube?: { apiKey?: string } }) => {
    const cur = settings.channelApis ?? {};
    const next: NonNullable<Settings['channelApis']> = { ...cur };
    for (const k of ['tiktok', 'facebook', 'instagram', 'kwai'] as const) {
      const v = patch?.[k] as { token?: string; userId?: string } | undefined;
      if (!v) continue;
      next[k] = { ...(cur[k] ?? {}), ...(typeof v.token === 'string' ? { token: v.token.trim() } : {}), ...(k === 'instagram' && typeof v.userId === 'string' ? { userId: v.userId.trim() } : {}) } as never;
    }
    settings.channelApis = next;
    if (typeof patch?.youtube?.apiKey === 'string') settings.stock = { ...(settings.stock ?? {}), youtube: { ...(settings.stock?.youtube ?? {}), apiKey: patch.youtube.apiKey.trim() } } as Settings['stock'];
    saveSettings(settings);
    return { ok: true };
  });
  let analyzeAbort: AbortController | undefined;
  h('channels:analyze', async (id: string, o?: { ai?: boolean; harness?: string; model?: string }) => {
    analyzeAbort?.abort(); const ac = new AbortController(); analyzeAbort = ac;
    const ch = myChannels.getChannel(settings, id);
    const log = (line: string) => send({ t: 'log', stepId: 'channel', line } as EngineEvent);
    const a = await analyzeChannel(settings, ch, { log, signal: ac.signal });
    /* recomendações por IA (opcional): em cima das métricas, para o tipo e a marca do canal */
    if (o?.ai) {
      try {
        const t = setTimeout(() => ac.abort(), 180_000);
        const { json } = await llmJson([{ type: 'harness', harness: (o.harness || 'auto') as HarnessBinding['harness'], model: o.model || undefined }], settings, path.join(settings.workspace, 'tools', 'finder'),
          `Você é analista de canais. Canal "${ch.name}" (${myChannels.PLATFORM_INFO[ch.platform].label}${ch.type ? `, tipo ${channelType(ch.type)?.label ?? ch.type}` : ''}). Métricas: ${analyticsLine(a)}.\n` +
          `Mais vistos: ${(a.top ?? []).map((x) => `"${x.title}" (${x.views ?? '?'} views)`).join('; ')}.\nResponda SOMENTE com JSON: {"insights":["5 recomendações práticas e específicas, em português do Brasil"]}`, ac.signal, () => {});
        clearTimeout(t);
        const extra = Array.isArray((json as { insights?: unknown })?.insights) ? ((json as { insights: unknown[] }).insights).map(String).slice(0, 6) : [];
        if (extra.length) a.insights = [...extra.map((x) => `🤖 ${x}`), ...(a.insights ?? [])];
      } catch (e) { a.warnings = [...(a.warnings ?? []), `recomendações por IA indisponíveis (${(e as Error).message.slice(0, 120)})`]; }
    }
    myChannels.saveAnalytics(settings, id, a); saveSettings(settings);
    return { analytics: a, state: channelsState() };
  });
  h('channels:analyze-cancel', () => { analyzeAbort?.abort(); return true; });
  h('channels:brand-restore', (id: string, index: number) => {
    const c = myChannels.restoreChannelBrand(settings, id, index); saveSettings(settings); return { channel: c, state: channelsState() };
  });
  /** redesenha banner, avatar e thumbnail modelo com a marca e a identidade atuais (sem chamar a IA) */
  h('channels:render-assets', async (id: string) => {
    const c = myChannels.getChannel(settings, id);
    if (!c.brand) throw new Error('o canal ainda não tem marca');
    const files = await renderBrandFiles(settings, id, { ...c.brand, identity: c.identity ?? c.brand.identity }, { renderHtml, log: (line) => send({ t: 'log', stepId: 'channel', line } as EngineEvent) });
    if (files.banner) myChannels.setAsset(settings, id, 'banner', files.banner);
    if (files.avatar) myChannels.setAsset(settings, id, 'avatar', files.avatar);
    if (files.thumb) myChannels.setAsset(settings, id, 'thumb', files.thumb);
    saveSettings(settings);
    return { files, state: channelsState() };
  });
  h('channels:update', (id: string, patch: Parameters<typeof myChannels.updateChannel>[2]) => {
    const c = myChannels.updateChannel(settings, id, patch); saveSettings(settings); return { channel: c, state: channelsState() };
  });
  h('channels:remove', (id: string) => { const dir = myChannels.removeChannel(settings, id); saveSettings(settings); return { dir, state: channelsState() }; });
  h('channels:open-login', async (id: string) => {
    const c = myChannels.getChannel(settings, id);
    const acc = c.accountId || settings.automations?.youtubeAccount || auto.listAccounts(settings)[0]?.id;
    if (!acc) throw new Error('adicione uma conta em Automações primeiro (é ela que guarda o login)');
    const info = myChannels.PLATFORM_INFO[c.platform];
    /* abre o PRÓPRIO canal quando há link (o usuário confere que a conta logada é a dona do canal) */
    const target = c.url && c.platform !== 'youtube' ? c.url : info.loginUrl;
    if (!c.accountId) myChannels.updateChannel(settings, id, { accountId: acc });
    auto.openBrowser(settings, acc, 'url', target);
    myChannels.markAuthOpened(settings, id);
    saveSettings(settings);
    return { account: acc, url: target };
  });
  h('channels:approve-account', (id: string, accountId: string) => {
    myChannels.updateChannel(settings, id, { accountId }); saveSettings(settings);
    return { accountHasSession: auto.listAccounts(settings).find((a) => a.id === accountId)?.hasProfile ?? false };
  });
  h('channels:brand', async (id: string, input: Omit<BrandInput, 'harness' | 'recreate'> & { harness?: HarnessId; recreate?: boolean }) => {
    const ac = new AbortController(); brandAbort = ac;
    const ch = myChannels.getChannel(settings, id);
    const hadIdentity = !!ch.identity;
    /* tipo, link e métricas do canal entram no pedido; "recriar" evita repetir nomes/conceitos anteriores */
    const full: BrandInput = { ...input, harness: input.harness ?? 'auto', type: input.type ?? ch.type, link: ch.url, language: input.language ?? ch.language,
      analytics: ch.analytics ? analyticsLine(ch.analytics) : undefined, recreate: input.recreate ? recreateNote(ch) : undefined };
    if (input.type && input.type !== ch.type) myChannels.updateChannel(settings, id, { type: input.type });
    try {
      const r = await generateChannelBrand(settings, id, full, {
        renderHtml, signal: ac.signal,
        log: (line) => send({ t: 'log', stepId: 'channel', line } as EngineEvent),
        progress: (p) => send({ t: 'channel.brand-progress', id, ...p } as unknown as EngineEvent),
      });
      const saved = myChannels.saveBrand(settings, id, r.brand);
      /* o canal já tinha identidade (do usuário): banner e thumb seguem a paleta dele, não a sugerida agora */
      if (hadIdentity && saved.identity) {
        const again = await renderBrandFiles(settings, id, { ...r.brand, identity: saved.identity }, { renderHtml, log: (line) => send({ t: 'log', stepId: 'channel', line } as EngineEvent) });
        Object.assign(r.files, Object.fromEntries(Object.entries(again).filter(([, v]) => v)));
      }
      if (r.files.banner) myChannels.setAsset(settings, id, 'banner', r.files.banner);
      if (r.files.avatar) myChannels.setAsset(settings, id, 'avatar', r.files.avatar);
      if (r.files.thumb) myChannels.setAsset(settings, id, 'thumb', r.files.thumb);
      saveSettings(settings);
      return { ...r, state: channelsState() };
    } finally { brandAbort = undefined; }
  });
  h('channels:brand-cancel', () => { brandAbort?.abort(); return true; });
  h('channels:projects', (id: string) => myChannels.listChannelProjects(settings, id));
  h('channels:publish', async (id: string, projectId: string, visibility?: 'UNLISTED' | 'PRIVATE' | 'PUBLIC') => {
    const p = ops.readProject(settings, projectId);
    const ac = new AbortController(); running.set(projectId, ac);
    try {
      const rec = await myChannelPub.publishToChannel(settings, {
        channelId: id, projectId, projectDir: projectDirOf(settings, projectId), projectName: p.name, visibility, signal: ac.signal,
        log: (line) => send({ t: 'log', line, projectId } as EngineEvent & { projectId: string }),
      });
      saveSettings(settings);
      return { record: rec, state: channelsState() };
    } finally { running.delete(projectId); }
  });

  /* ── clone ↔ canal do usuário, produtos para vender e custo de produção ── */
  h('channel:link', (cloneId: string, channelId: string | null) => {
    const store = cloneStore(settings, app.getVersion());
    const c = store.get(cloneId);
    if (!c) throw new Error('clone não encontrado');
    if (c.linked?.channelId && c.linked.channelId !== channelId) { try { myChannels.linkClone(settings, c.linked.channelId, cloneId, false); } catch { /* canal removido */ } }
    if (channelId) {
      const ch = myChannels.linkClone(settings, channelId, cloneId, true);
      c.linked = { channelId, platform: ch.platform, name: ch.name, at: new Date().toISOString() };
      /* projetos novos com a skill do clone já saem para este canal: a identidade dele vence a do formato */
    } else delete c.linked;
    saveSettings(settings);
    return store.save(c);
  });
  h('channel:products', async (cloneId: string, ai?: { harness?: string; model?: string }) => {
    const store = cloneStore(settings, app.getVersion());
    const c = store.get(cloneId);
    if (!c) throw new Error('clone não encontrado');
    const bend = c.bends[c.chosenBend];
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 600_000);
    try {
      const { json, binding } = await llmJson([{ type: 'harness', harness: (ai?.harness || 'auto') as HarnessBinding['harness'], model: ai?.model || undefined }], settings, path.join(settings.workspace, 'tools', 'finder'),
        productsPrompt({ niche: `${c.brand.names?.[0] ?? c.skill.name} — ${bend ? `${bend.title}: ${bend.angle}` : String(c.analysis['format'] ?? '')}`, audience: bend?.audience ?? String(c.analysis['audience'] ?? ''),
          format: String(c.analysis['videoType'] ?? c.analysis['format'] ?? ''), language: c.language?.code, titles: bend?.exampleTitles,
          linkedPlatform: c.linked ? myChannels.PLATFORM_INFO[c.linked.platform]?.label : undefined }),
        ac.signal, (line) => send({ t: 'log', stepId: 'channel', line } as EngineEvent));
      const products = normalizeProducts(json, (binding as { harness?: string } | undefined)?.harness);
      if (!products.info.length && !products.physical.length) throw new Error('a IA não devolveu produtos');
      c.business = { ...(c.business ?? {}), products };
      return store.save(c);
    } finally { clearTimeout(t); }
  });
  h('channel:cost', (cloneId: string, input?: Partial<CostInput>) => {
    const store = cloneStore(settings, app.getVersion());
    const c = store.get(cloneId);
    if (!c) throw new Error('clone não encontrado');
    const route = lib.getAnyRoute(settings, c.route.id) ?? c.route;
    const fromRoute = enginesFromRoute(route);
    const f = c.skill.formatDna;
    const base: CostInput = {
      durationSec: c.metrics.avgDurationSec || c.skill.durationSec || 60,
      wpm: f?.wpm ?? c.measured?.wpm, sceneSec: dnaSceneSec(f),
      videosPerMonth: Math.max(1, Math.round((c.metrics.uploadsPerWeek ?? 2) * 4.3)), months: 3,
      mix: fromRoute.mix, engines: fromRoute.engines,
    };
    const costInput: CostInput = { ...base, ...(input ?? {}), rates: { ...(c.business?.costInput?.rates ?? {}), ...(input?.rates ?? {}) } };
    const cost = estimateCost(costInput);
    c.business = { ...(c.business ?? {}), cost, costInput };
    return store.save(c);
  });

  /* ── aprovação do storyboard (pausa da execução) ── */
  h('project:approve', (id: string, ok: boolean) => {
    const w = approvals.get(id);
    if (w) { approvals.delete(id); w(!!ok); return { live: true }; }
    /* sem execução esperando: grava a aprovação do plano atual (vale na próxima execução) */
    if (!ok) return { live: false };
    const p = ops.readProject(settings, id);
    if (!p.storyboard?.enabled) throw new Error('o projeto não usa storyboard');
    p.storyboard = { ...p.storyboard, approvedHash: planHash(p.scenes), approvedAt: new Date().toISOString() };
    ops.saveProjectFile(settings, p, { scenes: false });
    return { live: false, approvedHash: p.storyboard.approvedHash };
  });
  h('project:storyboard', (id: string, regenerate?: boolean) => {
    const dir = projectDirOf(settings, id);
    const p = ops.readProject(settings, id);
    const sb = regenerate || !readStoryboard(dir) ? writeStoryboard(p, dir).board : readStoryboard(dir)!;
    return { board: sb, html: path.join(dir, 'out', 'storyboard.html'), approved: !!p.storyboard?.approvedHash && p.storyboard.approvedHash === planHash(p.scenes), waiting: approvals.has(id), options: p.storyboard };
  });
  h('project:storyboard-set', (id: string, o: { enabled?: boolean; approval?: boolean }) => {
    const p = ops.readProject(settings, id);
    p.storyboard = o.enabled ? { ...(p.storyboard ?? {}), enabled: true, approval: !!o.approval } : undefined;
    ops.saveProjectFile(settings, p, { scenes: false });
    return p.storyboard ?? null;
  });
  h('shell:open-path', (file: string) => {
    const f = path.resolve(String(file));
    const ws = path.resolve(settings.workspace), pd = path.resolve(projectsDir(settings));
    if (!(f.startsWith(ws) || f.startsWith(pd)) || !fs.existsSync(f)) throw new Error('arquivo fora da pasta de trabalho');
    return shell.openPath(f);
  });

  /* ── Pesquisar em TikTok, Instagram, Facebook e Kwai sem API: página de busca num navegador invisível ── */
  const SOCIAL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const socialPartition = (p: SocialPlatform) => `persist:social-${p}`;
  const socialBrowse = async (p: SocialPlatform, url: string, script: string) => {
    const w = new BrowserWindow({ show: false, width: 1280, height: 1600, webPreferences: { partition: socialPartition(p), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    try {
      w.webContents.setUserAgent(SOCIAL_UA);
      w.webContents.setAudioMuted(true);
      await Promise.race([w.loadURL(url).catch(() => {}), new Promise((r) => setTimeout(r, 45_000))]);
      await new Promise((r) => setTimeout(r, 3500));   // a busca carrega depois do HTML (SPA)
      const res = await Promise.race([w.webContents.executeJavaScript(script, true), new Promise((_, rej) => setTimeout(() => rej(new Error('a página de busca não respondeu')), 90_000))]);
      return res as { url: string; text: string; cards: Array<{ href: string; text?: string; img?: string; label?: string }> };
    } finally { if (!w.isDestroyed()) w.destroy(); }
  };
  const socialYtdlp = async (urls: string[]): Promise<unknown[]> => {
    const exe = await ensureYtDlp(settings, (line) => send({ t: 'log', line: `pesquisa: ${line}` } as EngineEvent));
    const cookies = urls[0] ? await cookieArgs(urls[0]) : [];
    const out = await new Promise<string>((resolve) => {
      const c = spawn(exe, [...cookies, '--dump-json', '--skip-download', '--no-warnings', '--ignore-errors', '--', ...urls], { windowsHide: true });
      let s = ''; c.stdout.on('data', (d: Buffer) => { s += d.toString(); });
      const t = setTimeout(() => c.kill(), 180_000);
      c.on('error', () => { clearTimeout(t); resolve(s); }); c.on('close', () => { clearTimeout(t); resolve(s); });
    });
    return out.split(/\r?\n/).flatMap((l) => { try { return [JSON.parse(l) as unknown]; } catch { return []; } });
  };
  h('social:sites', () => Object.fromEntries(Object.entries(SOCIAL_SITES).map(([k, v]) => [k, { label: v.label, icon: v.icon, needsLogin: v.needsLogin, note: v.note }])));
  /* sessão de login da pesquisa → cookies.txt (formato Netscape) para o yt-dlp ler Instagram/Facebook/TikTok/Kwai */
  setCookieProvider(async (url) => {
    const p = (['tiktok', 'instagram', 'facebook', 'kwai'] as const).find((x) => url.toLowerCase().includes(`${x}.com`));
    if (!p) return undefined;
    const list = await session.fromPartition(socialPartition(p)).cookies.get({});
    if (!list.length) return undefined;
    const dir = path.join(app.getPath('userData'), 'social-cookies');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${p}.txt`);
    fs.writeFileSync(file, netscapeCookies(list), { mode: 0o600 });
    return file;
  });
  const socialDeps = () => ({ browse: socialBrowse, ytdlp: socialYtdlp, log: (line: string) => send({ t: 'log', line: `pesquisa: ${line}` } as EngineEvent) });
  /** mesma pesquisa da aba YouTube (idiomas, período, formato, até 100 por idioma, views mín., máx. de seguidores) */
  h('social:search', (platform: string, q: FinderQuery | string, o?: { max?: number }) => {
    if (!isSocialPlatform(platform)) throw new Error(`rede desconhecida: ${platform}`);
    if (platform === 'kwai') throw new Error('a pesquisa no Kwai foi retirada: as páginas públicas dele não devolvem vídeos');
    if (typeof q === 'string') return searchSocial(platform, q, socialDeps(), o);
    return findSocial(platform, q, socialDeps(), settings.uiLanguage === 'en' || settings.uiLanguage === 'es' ? settings.uiLanguage : 'pt-BR');
  });
  /** login na rede: janela VISÍVEL com a mesma sessão da pesquisa (o usuário digita; o app nunca vê a senha) */
  h('social:login', (platform: string) => {
    if (!isSocialPlatform(platform)) throw new Error(`rede desconhecida: ${platform}`);
    const site = SOCIAL_SITES[platform];
    const w = new BrowserWindow({ width: 1100, height: 820, title: `Entrar no ${site.label} (sessão da pesquisa)`, autoHideMenuBar: true, webPreferences: { partition: socialPartition(platform), sandbox: true, contextIsolation: true } });
    w.webContents.setUserAgent(SOCIAL_UA);
    void w.loadURL(site.login);
    return true;
  });
  h('social:watch', (url: string) => {
    if (!/^https:\/\/(www\.)?(tiktok|instagram|facebook|kwai)\.com\//i.test(String(url))) throw new Error('link inválido');
    const host = /tiktok/.test(url) ? 'tiktok' : /instagram/.test(url) ? 'instagram' : /facebook/.test(url) ? 'facebook' : 'kwai';
    const w = new BrowserWindow({ width: 1100, height: 820, title: '▶', autoHideMenuBar: true, webPreferences: { partition: socialPartition(host as SocialPlatform), sandbox: true, contextIsolation: true } });
    w.webContents.setUserAgent(SOCIAL_UA);
    void w.loadURL(url);
    return true;
  });

  h('finder:search', (q: FinderQuery) => findOutliers(settings, q, { log: (line) => send({ t: 'log', line: `vídeos: ${line}` } as EngineEvent) }));
  /** Traduz a pesquisa para cada idioma com a IA de texto (harness automático); sem IA, devolve a mesma. */
  h('finder:translate', async (query: string, langs: string[], ai?: { harness?: string; model?: string }) => {
    const out: Record<string, string> = Object.fromEntries(langs.map((l) => [l, query]));
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 120_000);
      const { json } = await llmJson([{ type: 'harness', harness: (ai?.harness || 'auto') as HarnessBinding['harness'], model: ai?.model || undefined }], settings, path.join(settings.workspace, 'tools', 'finder'),
        `Traduza a pesquisa de YouTube "${query}" para estes idiomas (códigos ISO): ${langs.join(', ')}. Use os termos que as pessoas realmente pesquisam em cada idioma (não tradução literal). Responda SOMENTE com JSON: {"pt":"...","en":"..."}.`, ac.signal, () => {});
      clearTimeout(t);
      for (const [k, v] of Object.entries((json ?? {}) as Record<string, unknown>)) if (langs.includes(k) && typeof v === 'string' && v.trim()) out[k] = v.trim();
    } catch { /* sem IA: mesma pesquisa em todos */ }
    return out;
  });
  /** Assistir um vídeo do YouTube numa janela do próprio app. */
  h('finder:watch', (id: string, title?: string) => {
    if (!/^[\w-]{11}$/.test(String(id))) throw new Error('vídeo inválido');
    const w = new BrowserWindow({ width: 1180, height: 720, title: title ? `▶ ${title}` : 'YouTube', autoHideMenuBar: true, webPreferences: { partition: 'persist:yt-watch', sandbox: true, contextIsolation: true } });
    void w.loadURL(`https://www.youtube.com/watch?v=${id}`);
    return true;
  });
  /** Abre um link externo no navegador (só http/https: páginas de chave de API, sites dos bancos). */
  h('shell:open-url', (url: string) => { if (!/^https?:\/\//i.test(String(url))) throw new Error('link inválido'); return shell.openExternal(String(url)); });
  h('plugins:prompt', (ids: string[], styles?: Record<string, string>) => pluginPrompt(settings, ids, styles));
  /** Vídeo de exemplo de um estilo: baixa sob demanda do site do próprio plugin para a pasta dele. */
  h('plugin:style-video', async (pluginId: string, styleId: string) => {
    const p = listPlugins(settings).find((x) => x.id === pluginId);
    const st = p?.styles?.find((x) => x.id === styleId);
    if (!p || !st) throw new Error('estilo não encontrado');
    if (st.video) return st.video;
    if (!st.videoUrl || !p.homepage || !st.videoUrl.startsWith(p.homepage)) throw new Error('este estilo não tem vídeo de exemplo');
    const dest = path.join(p.dir, 'videos', `${st.id.replace(/[^\w-]/g, '')}.mp4`);
    const r = await fetch(st.videoUrl, { signal: AbortSignal.timeout(300_000), headers: { 'User-Agent': 'FilmForge/0.1' } });
    if (!r.ok) throw new Error(`download do vídeo falhou (HTTP ${r.status})`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return dest;
  });
  /** Áudio por código (mgaudio): onde está, se o Python está pronto; instalar; ouvir a trilha de um estilo. */
  h('plugin:audio-status', async () => {
    const lib = findMgAudio(settings);
    const vp = mgVenvPython(settings);
    return { lib: lib ?? null, python: fs.existsSync(vp) ? vp : null };
  });
  h('plugin:audio-install', () => ensureMgAudio(settings, { log: (line) => send({ t: 'log', line: `áudio: ${line}` } as EngineEvent) }));
  h('plugin:audio-demo', async (recipe: string, seconds = 15) => {
    const out = path.join(settings.workspace, 'library', 'music-preview', `${String(recipe).replace(/[^\w-]/g, '')}-${Math.round(seconds)}.mp3`);
    const wav = out.replace(/\.mp3$/, '.wav');
    if (fs.existsSync(wav)) return { file: wav, engine: 'cache' };
    const r = await renderCodeMusic(settings, { mood: recipe, duration: seconds, out, log: (line) => send({ t: 'log', line: `trilha: ${line}` } as EngineEvent) });
    return { file: r.file, engine: r.engine };
  });
  h('tools:list', () => TOOL_SPECS.map((t) => ({ name: t.function.name, description: t.function.description })));

  // o app como servidor MCP (Model Context Protocol) para agentes externos
  const httpUrl = () => mcpHttp?.url ?? 'http://127.0.0.1:3333/mcp';
  h('mcp:info', () => ({
    command: process.execPath,
    args: ['--mcp'],
    version: app.getVersion(),
    config: mcpClientConfig(process.execPath),
    httpUrl: httpUrl(),
    httpRunning: !!mcpHttp,
    httpConfig: JSON.stringify(mcpSetupConfigs(process.execPath, httpUrl()).http, null, 2),
    configs: mcpSetupConfigs(process.execPath, httpUrl()),
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  }));
  h('mcp:http:start', async (opts?: { port?: number; host?: string; token?: string }) => {
    if (mcpHttp) return { ok: true, url: mcpHttp.url, already: true };
    try {
      mcpHttp = await runMcpHttp(mcpDeps(), {
        host: opts?.host || process.env.FILMFORGE_MCP_HOST || '127.0.0.1',
        port: Number(opts?.port ?? process.env.FILMFORGE_MCP_PORT ?? 3333),
        token: opts?.token || process.env.FILMFORGE_MCP_TOKEN,
        path: '/mcp',
      });
      return { ok: true, url: mcpHttp.url };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  h('mcp:http:stop', async () => {
    if (!mcpHttp) return { ok: true, stopped: false };
    try { await mcpHttp.close(); } catch { /* ignore */ }
    mcpHttp = null;
    return { ok: true, stopped: true };
  });
  h('mcp:http:status', () => ({ running: !!mcpHttp, url: httpUrl(), host: mcpHttp?.host, port: mcpHttp?.port }));
  h('clipboard:write', (text: string) => { clipboard.writeText(String(text ?? '')); return true; });

  /* ───────── Automações: contas Google, Flow, Antigravity por conta, SRT ───────── */
  const autoState = () => ({ config: auto.config(settings), accounts: auto.listAccounts(settings), browser: auto.detectBrowser(settings), max: auto.MAX_ACCOUNTS, flowUrl: auto.config(settings).flowUrl || auto.DEFAULT_FLOW_URL });
  const autoSave = () => { saveSettings(settings); return autoState(); };
  h('auto:get', () => autoState());
  h('auto:set-config', (patch: { browserPath?: string; extensionDir?: string; flowUrl?: string }) => {
    const cfg = auto.config(settings);
    for (const k of ['browserPath', 'extensionDir', 'flowUrl'] as const) if (k in patch) cfg[k] = String(patch[k] ?? '').trim() || undefined;
    return autoSave();
  });
  h('auto:account-add', (label: string, email?: string) => { auto.addAccount(settings, label, email); return autoSave(); });
  h('auto:account-update', (id: string, patch: { label?: string; email?: string }) => { auto.updateAccount(settings, id, patch); return autoSave(); });
  h('auto:account-remove', (id: string) => { const dir = auto.removeAccount(settings, id); return { ...autoSave(), keptDir: dir }; });
  h('auto:open', (id: string, target: 'login' | 'flow') => { const r = auto.openBrowser(settings, id, target); saveSettings(settings); return r; });
  h('auto:open-folder', (id: string) => shell.openPath(auto.accountDir(settings, id)));
  h('auto:agy-login', (id: string) => {
    const cmd = resolveHarnessCommand(settings.harnesses.antigravity);
    if (!cmd.found) throw new Error('Antigravity CLI (agy) não encontrado — confira em Configurações → Harnesses');
    auto.openAgyLogin(settings, id, cmd.command); return true;
  });
  h('auto:agy-use', (id: string) => { auto.config(settings).agyAccount = id || undefined; return autoSave(); });
  h('auto:youtube-use', (id: string) => { auto.config(settings).youtubeAccount = id || undefined; return autoSave(); });
  h('auto:prompts-get', (id: string) => auto.readPrompts(settings, id));
  h('auto:prompts-save', (id: string, text: string) => { const r = auto.savePrompts(settings, id, text); clipboard.writeText(text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join('\n')); return r; });
  h('auto:downloads', (id: string) => auto.listDownloads(settings, id));
  h('auto:import', async (accountId: string, file: string, projectId: string, sceneId: string) => {
    idle(projectId);
    const p = ops.readProject(settings, projectId);
    const dest = await auto.importToScene(settings, p, projectDirOf(settings, projectId), accountId, file, sceneId);
    ops.saveProjectFile(settings, p);
    return dest;
  });
  let srtAbort: AbortController | undefined;
  h('auto:srt', async (file: string, o: auto.SrtOptions) => {
    srtAbort?.abort(); srtAbort = new AbortController();
    return auto.srtFromAudio(settings, file, toolsDir(), o ?? {}, srtAbort.signal, (line) => send({ t: 'log', line } as EngineEvent));
  });
  h('auto:srt-cancel', () => { srtAbort?.abort(); return true; });
  h('auto:show-file', (file: string) => { shell.showItemInFolder(file); return true; });
  /* Testar Flow: "diagnose" só lê a página (não gasta créditos); "image"/"video" gera uma mídia de teste */
  /* créditos de cada conta: só leitura da página do Flow; o navegador aberto só para isso é fechado depois */
  h('auto:flow-credits', async (id?: string) => {
    const log = (line: string) => send({ t: 'log', line } as EngineEvent);
    const flowUrl = auto.config(settings).flowUrl?.trim() || auto.DEFAULT_FLOW_URL;
    const accs = id ? auto.config(settings).accounts.filter((a) => a.id === id) : auto.config(settings).accounts;
    const out: Array<{ id: string; label: string; value?: number; text: string; error?: string }> = [];
    for (const a of accs) {
      const wasUp = await auto.isBrowserUp(a.id);
      try {
        const port = await auto.ensureFlowBrowser(settings, a.id, log);
        const r = await flowCredits(port, flowUrl);
        a.credits = { value: r.value, text: r.text, at: new Date().toISOString() };
        out.push({ id: a.id, label: a.label, value: r.value, text: r.text });
        if (!wasUp) await closeBrowser(port);
      } catch (e) { out.push({ id: a.id, label: a.label, text: '', error: (e as Error).message }); }
    }
    saveSettings(settings);
    return out;
  });
  /* nova skill a partir de vídeos de referência (provedor com visão) */
  let skillGenAbort: AbortController | undefined;
  h('skill:from-videos', async (input: SkillGenInput) => {
    skillGenAbort?.abort(); skillGenAbort = new AbortController();
    return generateSkillFromVideos(settings, input, toolsDir(), (line) => send({ t: 'log', stepId: 'skillgen', line } as EngineEvent), skillGenAbort.signal);
  });
  h('skill:from-videos-cancel', () => { skillGenAbort?.abort(); return true; });
  /** Skill a partir de um documento de prompts/diretrizes (.docx/.md/.txt), com o harness escolhido. */
  h('skill:from-doc', async (input: SkillDocInput) => {
    skillGenAbort?.abort(); skillGenAbort = new AbortController();
    return generateSkillFromDoc(settings, input, (line) => send({ t: 'log', stepId: 'skillgen', line } as EngineEvent), skillGenAbort.signal);
  });
  /* títulos no padrão de um canal clonado, canal ou vídeo */
  h('titles:suggest', (input: TitleSuggestInput) => suggestTitles(settings, input, (line) => send({ t: 'log', stepId: 'craft', line } as EngineEvent)));
  /* thumbnail modelada de um canal clonado, canal, vídeo ou link → novo template em Configurações */
  h('thumb:model', async (input: ThumbModelInput) => {
    const r = await modelThumbnail(settings, input, (line) => send({ t: 'log', stepId: 'craft', line } as EngineEvent));
    settings.thumbnails = [...(settings.thumbnails ?? []).filter((t) => t.id !== r.template.id), r.template];
    saveSettings(settings);
    return r;
  });
  /* SKILL.md do Claude (arquivo, pasta, .zip ou GitHub) → plugin + skill + rota */
  h('skill:import-claude', async (input: SkillImportInput) => {
    skillGenAbort?.abort(); skillGenAbort = new AbortController();
    const log = (line: string) => send({ t: 'log', stepId: 'skillgen', line } as EngineEvent);
    const r = await importClaudeSkill(settings, input, log, skillGenAbort.signal);
    /* o plugin já sai adaptado: cada sub-skill entra só na etapa dela (com a IA escolhida para refinar, ou pelos nomes) */
    try { await adaptPlugin(settings, r.plugin.id, { harness: input.harness ?? '', model: input.model, log, signal: skillGenAbort.signal }); }
    catch (e) {
      try { await adaptPlugin(settings, r.plugin.id, { harness: '', log }); } catch { /* sem adaptação: entra inteiro, como antes */ }
      r.warnings.push(`adaptação com IA falhou; usada a adaptação pelos nomes dos arquivos (${(e as Error).message.slice(0, 160)})`);
    }
    send({ t: 'plugins.changed' } as unknown as EngineEvent);
    return r;
  });
  h('auto:flow-test', async (id: string, mode: 'diagnose' | 'image' | 'video', prompt?: string, target?: { projectId?: string; sceneId?: string }) => {
    const log = (line: string) => send({ t: 'log', line } as EngineEvent);
    const acc = auto.flowAccount(settings, id);
    const port = await auto.ensureFlowBrowser(settings, acc.id, log);
    const debugDir = auto.flowDebugDir(settings, acc.id);
    const flowUrl = auto.config(settings).flowUrl?.trim() || auto.DEFAULT_FLOW_URL;
    if (mode === 'diagnose') return { mode, debugDir, ...(await flowDiagnose(port, flowUrl, debugDir)) };
    /* com projeto + cena: gera no formato do projeto e MOVE o resultado para dentro da cena */
    const proj = target?.projectId ? ops.readProject(settings, target.projectId) : undefined;
    const scene = proj?.scenes.find((x) => x.id === target?.sceneId);
    if (target?.projectId && !scene) throw new Error('escolha a cena do projeto');
    if (proj) idle(proj.id);
    const dest = path.join(auto.accountDir(settings, acc.id), 'downloads', `flow-teste-${Date.now()}.${mode === 'video' ? 'mp4' : 'png'}`);
    const file = await flowGenerate({ port, flowUrl, prompt: prompt?.trim() || scene?.videoPrompt || scene?.visualIntent || (mode === 'video' ? 'A slow cinematic drone shot over a misty mountain lake at sunrise' : 'A cozy pixel art coffee shop on a rainy night, warm lights, detailed'),
      media: mode, dest, timeoutSec: mode === 'video' ? 600 : 240, log, debugDir, aspect: proj?.aspect ?? '16:9', seconds: scene?.durationSec ?? 8,
      projectUrl: auto.flowProjectOf(settings, acc.id), onProject: (u) => auto.setFlowProject(settings, acc.id, u) });
    if (proj && scene) {
      const p = ops.readProject(settings, proj.id);
      const moved = await auto.importToScene(settings, p, projectDirOf(settings, p.id), acc.id, file, scene.id, true);
      ops.saveProjectFile(settings, p);
      log(`Flow: resultado movido para o projeto "${p.name}", cena ${scene.index}`);
      return { mode, debugDir, file: moved, project: p.name, scene: scene.index };
    }
    return { mode, debugDir, file };
  });
  /** Testa o servidor MCP de verdade: sobe `FilmForge.exe --mcp` e faz o handshake. */
  h('mcp:selftest', async () => {
    /* Testa o protocolo e as ferramentas de verdade, no próprio processo: sem
       depender de subir um segundo Electron (que disputaria o perfil). */
    const server = createMcpServer(mcpDeps());
    const rpc = (id: number, method: string, params?: unknown) => server.handle({ jsonrpc: '2.0', id, method, params })
      .then((r) => r as { result?: { protocolVersion?: string; serverInfo?: { name?: string }; tools?: unknown[]; content?: Array<{ text?: string }>; isError?: boolean } | undefined; error?: { message?: string } } | null)
      .catch(() => null);
    const init = await rpc(1, 'initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'filmforge-selftest', version: app.getVersion() } });
    const list = await rpc(2, 'tools/list');
    const call = await rpc(3, 'tools/call', { name: 'filmforge_projects', arguments: {} });
    const resources = await rpc(4, 'resources/list');
    const tools = list?.result?.tools ?? [];
    let projects = -1;
    try { projects = (JSON.parse(call?.result?.content?.[0]?.text ?? '[]') as unknown[]).length; } catch { /* erro */ }
    const res = (resources?.result as { resources?: unknown[] } | undefined)?.resources ?? [];
    const ok = !!init?.result?.serverInfo && tools.length > 0 && projects >= 0 && res.length > 0;
    return { ok, protocolVersion: init?.result?.protocolVersion, server: init?.result?.serverInfo?.name, tools: tools.length, projects, resources: res.length, error: ok ? undefined : 'o servidor não respondeu ao handshake/ferramentas' };
  });

  // diálogos do sistema e mídia de exemplo (copiada para o workspace, onde a interface pode exibi-la)
  h('dialog:open-file', async (o?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
    const r = await dialog.showOpenDialog(win!, { title: o?.title, properties: ['openFile'], filters: o?.filters });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  h('dialog:open-dir', async (o?: { title?: string; defaultPath?: string }) => {
    const r = await dialog.showOpenDialog(win!, { title: o?.title, defaultPath: o?.defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  /** Importa um arquivo de áudio como VOZ (pasta voices): vira referência de timbre para OmniVoice/Wan2GP. */
  h('voices:import', async (src?: string) => {
    let file = src?.trim();
    if (!file) {
      const r = await dialog.showOpenDialog(win!, { title: 'Arquivo de áudio da voz (10–30 s de fala limpa funcionam melhor)', properties: ['openFile'], filters: [{ name: 'Áudio', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'opus', 'mp4', 'webm'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      file = r.filePaths[0];
    }
    if (!fs.existsSync(file)) throw new Error('arquivo não encontrado');
    fs.mkdirSync(voicesDir(), { recursive: true });
    const base = path.basename(file).replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'voz';
    let name = base, k = 2;
    const ext = /\.(mp3|wav|m4a|flac|ogg)$/i.test(file) ? path.extname(file).toLowerCase() : '.wav';
    while (fs.existsSync(path.join(voicesDir(), name + ext))) name = `${base} (${k++})`;
    const dest = path.join(voicesDir(), name + ext);
    /* formatos que o OmniVoice não lê (aac, opus, vídeo): converte para wav mono 24 kHz */
    if (ext === '.wav' && !/\.wav$/i.test(file)) await run(settings.ffmpeg, ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '24000', dest]);
    else fs.copyFileSync(file, dest);
    return { name: name + ext, path: dest };
  });
  h('media:import', (src: string, kind: 'skill' | 'thumb') => {
    if (!fs.existsSync(src)) throw new Error('arquivo não encontrado');
    if (!/\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i.test(src)) throw new Error('use imagem (png/jpg/webp/gif) ou vídeo (mp4/webm/mov)');
    const dir = path.join(settings.workspace, 'library', kind === 'skill' ? 'skill-media' : 'thumb-media');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${Date.now()}-${path.basename(src).replace(/[^\w.-]+/g, '_')}`);
    fs.copyFileSync(src, dest);
    return dest;
  });
  /** Prévia automática de cada skill: o vídeo final mais recente feito com ela. */
  h('skill:previews', () => {
    const out: Record<string, string> = {};
    for (const p of listProjects(settings)) {
      try {
        const pr = ops.readProject(settings, p.id); const k = pr.skillId ?? pr.skill?.id; if (!k || out[k]) continue;
        const f = path.join(projectDirOf(settings, p.id), 'out', 'final.mp4'); if (fs.existsSync(f)) out[k] = f;
      } catch { /* ignora */ }
    }
    return out;
  });
  h('theme:set', (t: 'dark' | 'light') => {
    settings.theme = t === 'light' ? 'light' : 'dark'; saveSettings(settings);
    try { win?.setTitleBarOverlay?.(overlayFor(settings.theme)); } catch { /* macOS */ }
    win?.setBackgroundColor(bgFor(settings.theme));
    return settings.theme;
  });
  h('projects:set-dir', (dir: string, move: boolean) => {
    if (running.size || batch) throw new Error('aguarde as execuções terminarem antes de mudar a pasta');
    if (!dir?.trim()) throw new Error('escolha uma pasta');
    const target = path.resolve(dir.trim()); const from = path.resolve(projectsDir(settings));
    if (target === from) return { dir: target, moved: 0 };
    if ((target + path.sep).startsWith(from + path.sep)) throw new Error('a nova pasta não pode ficar dentro da pasta atual');
    fs.mkdirSync(target, { recursive: true });
    let moved = 0;
    if (move && fs.existsSync(from)) {
      for (const id of fs.readdirSync(from)) {
        const src = path.join(from, id); const dst = path.join(target, id);
        if (!fs.existsSync(path.join(src, 'project.json')) || fs.existsSync(dst)) continue;
        try { fs.renameSync(src, dst); } catch { fs.cpSync(src, dst, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }); }
        rewritePaths(path.join(dst, 'project.json'), src, dst);
        rewritePaths(path.join(dst, 'cache', 'index.json'), src, dst);
        moved++;
      }
    }
    settings.projectsDir = target === path.resolve(path.join(settings.workspace, 'projects')) ? undefined : target;
    saveSettings(settings);
    return { dir: target, moved };
  });

  // testes de configuração
  h('harness:test', async (id: string, override?: Settings['harnesses'][string & keyof Settings['harnesses']]) => {
    const cfg = override ?? settings.harnesses[id as keyof Settings['harnesses']];
    if (!cfg) throw new Error('harness não configurado');
    return detectHarnessAsync(cfg);
  });
  h('harness:models', async (id: string, override?: Settings['harnesses'][keyof Settings['harnesses']]) => {
    const cfg = override ?? settings.harnesses[id as keyof Settings['harnesses']];
    if (!cfg) throw new Error('harness não configurado');
    return listHarnessModels(cfg);
  });
  h('harness:test-prompt', async (id: string, model?: string, override?: Settings['harnesses'][keyof Settings['harnesses']]) => {
    const cfg = override ?? settings.harnesses[id as keyof Settings['harnesses']];
    if (!cfg) throw new Error('harness não configurado');
    const cwd = path.join(app.getPath('temp'), 'filmforge-test'); fs.mkdirSync(cwd, { recursive: true });
    const t0 = Date.now();
    const r = await runHarness(cfg, { cwd, prompt: 'Responda somente com a palavra: OK', model: model || undefined, signal: AbortSignal.timeout(90000) });
    return { ok: r.ok, ms: Date.now() - t0, output: (r.stdout || r.stderr).trim().slice(0, 400) };
  });
  h('api:test', (p: Settings['providers'][number], opts?: { language?: string }) => prov.testProvider(p, opts ?? {}));
  /* procura ffmpeg/ffprobe no PATH e nas pastas comuns (Downloads, WinGet, pasta do app) */
  h('ffmpeg:detect', () => detectBins());
  /* executa -version de verdade: mostra erro de antivírus/DLL faltando antes de renderizar */
  h('ffmpeg:test', () => probeBins());
  h('stock:test', (src: 'pexels' | 'pixabay' | 'wikipedia', override?: Settings['stock']) => testSource({ ...settings, stock: override ?? settings.stock }, src));
  h('whisper:test', async (cfg: Settings['whisper']) => {
    const c = cfg ?? settings.whisper!;
    const r = spawnSync(c.python || 'python', ['-c', 'import faster_whisper,sys;print(faster_whisper.__version__)'], { encoding: 'utf8', timeout: 20000 });
    return r.status === 0 ? { ok: true, message: `faster-whisper ${r.stdout.trim()}` } : { ok: false, message: (r.stderr || r.error?.message || 'faster-whisper não encontrado').trim().split('\n').pop() };
  });
  h('whisper:install', async () => {
    const r = await ensureWhisper(settings, { log: (l) => send({ t: 'log', line: `whisper: ${l}` }) });
    saveSettings(settings);
    return { ok: true, python: r.python, version: r.version, created: r.created };
  });
  h('wan2gp:test', async () => { const m = await Wan2gpClient.get(settings.wan2gp!, path.join(toolsDir(), 'wan2gp_bridge.py')).models(); return { ok: true, models: m }; });
  h('settings:get', () => settings);
  h('settings:set', (s: Settings) => { settings = s; saveSettings(s); return true; });
  /* perfil portátil: onde ficam os dados e como levar tudo para outro PC */
  h('portable:info', () => ({ portable: !!dataRoot, root: dataRoot?.root, reason: dataRoot?.reason, settingsFile: settingsFile(), workspace: settings.workspace,
    plugins: pluginsRoot(settings), projects: projectsDir(settings) }));
  h('portable:export', async () => {
    const r = await dialog.showOpenDialog(win!, { title: `Pasta onde criar ${DATA_DIR_NAME} (perfil portátil)`, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return exportPortableProfile(r.filePaths[0]);
  });
  h('portable:import', async () => {
    const r = await dialog.showOpenDialog(win!, { title: `Pasta ${DATA_DIR_NAME} (ou a pasta que a contém)`, properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const out = importPortableProfile(r.filePaths[0]);
    send({ t: 'plugins.changed' } as unknown as EngineEvent);
    return out;
  });
  h('portable:open', () => shell.openPath(dataRoot?.root ?? app.getPath('userData')));
  h('harness:detect', async () => Object.fromEntries(await Promise.all(Object.entries(settings.harnesses).map(async ([id, cfg]) => [id, await detectHarnessAsync(cfg)]))));
  h('comfy:ping', async (id: string, url?: string) => {
    const srv = url ? { id: 'tmp', url } : settings.comfyServers.find((s) => s.id === id);
    return srv ? new ComfyClient(srv).ping() : { ok: false, error: 'servidor não encontrado' };
  });

  const wan = () => {
    if (!settings.wan2gp?.root) throw new Error('configure a pasta do Wan2GP em Provedores');
    return Wan2gpClient.get(settings.wan2gp, path.join(toolsDir(), 'wan2gp_bridge.py'));
  };
  h('wan2gp:models', () => wan().models());
  /* modelos com pesos no disco, já com a modalidade do app (imagem/vídeo/voz/música) */
  h('wan2gp:availability', async () => (await wan().availability()).map((m) => ({ ...m, kind: wan2gpKind(m) })));
  /* Showrunner: abre o servidor do Wan2GP se estiver fechado (soltando a ponte local da GPU) e mostra a página no navegador */
  h('wan2gp:showrunner-open', async () => {
    if (!settings.wan2gp?.root) throw new Error('configure a pasta do Wan2GP');
    const base = wanServer(settings.wan2gp);
    if (!(await showrunnerUp(base))) { Wan2gpClient.shutdownAll(); setWanDirector(settings.wan2gp.root, settings.wan2gp.director); await ensureWanServer(settings.wan2gp, () => undefined); }
    await shell.openExternal(`${base}/showrunner/`);
    return { ok: true, url: `${base}/showrunner/` };
  });
  h('wan2gp:showrunner-status', async () => { const base = wanServer(settings.wan2gp ?? { root: '', python: '', cliArgs: [] }); return { up: await showrunnerUp(base), url: `${base}/showrunner/` }; });
  h('wan2gp:defaults', (modelType: string) => wan().defaults(modelType));

  // sistema de memória do FilmForge
  h('memory:stats', () => memory.getMemoryStats());
  h('memory:list', () => memory.readMemories());
  h('memory:get', (name: string) => memory.getMemory(name));
  h('memory:search-tag', (tag: string) => memory.searchMemoriesByTag(tag));
  h('memory:search-type', (type: 'user' | 'feedback' | 'project' | 'reference') => memory.searchMemoriesByType(type));
  h('memory:save', (mem: Parameters<typeof memory.saveMemory>[0]) => memory.saveMemory(mem));
  h('memory:delete', (name: string) => memory.deleteMemory(name));
  h('memory:initialized', () => memory.isInitialized());

  // projetos (CRUD)
  /* uma linha problemática não pode derrubar a lista inteira: cada projeto falha sozinho */
  h('project:list', () => Promise.all(listProjects(settings).map((p) => projectRow(p.id).catch(() => ({
    id: p.id, name: p.name ?? p.id, videoType: p.videoType ?? 'custom', createdAt: p.createdAt ?? '', scenes: 0, scenesWithMedia: 0,
    hasFinal: false, running: false, totalMs: 0, firstFrame: null, frameFromFinal: false, status: 'new', runs: 0, updatedAt: p.createdAt ?? '',
    plugins: [], dir: projectDirOf(settings, p.id),
  })))));
  h('project:refresh', (id: string) => projectRow(id));
  h('project:create', async (input: NewProjectInput & { refScriptFile?: string; refVideoFile?: string; refScriptUse?: boolean; attachFiles?: string[] }) => {
    assertSkillAndRoute(input);
    for (const f of [input.refScriptFile, input.refVideoFile]) if (f && !fs.existsSync(f)) throw new Error(`arquivo de referência não encontrado: ${f}`);
    const p = createProject(settings, input);
    if (input.attachFiles?.length) { attachments.addAttachments(p, projectDirOf(settings, p.id), input.attachFiles); ops.saveProjectFile(settings, p); }
    if (input.refScriptFile || input.refVideoFile) {
      await prepareReferences(settings, p, projectDirOf(settings, p.id), { scriptFile: input.refScriptFile, videoFile: input.refVideoFile }, toolsDir(), AbortSignal.timeout(20 * 60_000));
      /* roteiro importado = O roteiro do vídeo (não só modelo de estilo) */
      if (p.refScript && input.refScriptUse) p.refScript.useAsScript = true;
      ops.saveProjectFile(settings, p);
    }
    return p;
  });
  h('projects:root', () => { fs.mkdirSync(projectsDir(settings), { recursive: true }); return projectsDir(settings); });
  h('projects:open-root', () => { fs.mkdirSync(projectsDir(settings), { recursive: true }); return shell.openPath(projectsDir(settings)); });
  h('project:get', (id: string) => ops.readProject(settings, id));
  h('project:update', (id: string, patch: Parameters<typeof ops.updateProject>[2]) => { idle(id); return ops.updateProject(settings, id, patch); });
  /**
   * Ajustar cenas de um projeto existente: backup, roteiro mantido, plano antigo fora e duração por cena nova.
   * run: 'plan' refaz só o plano agora · 'all' executa a rota inteira · 'none' só prepara.
   */
  h('project:replan', (id: string, o: { sceneSec?: number; refreshSkill?: boolean; run?: 'plan' | 'all' | 'none' } = {}) => {
    idle(id);
    const r = replanScenes(settings, id, { sceneSec: o.sceneSec, refreshSkill: o.refreshSkill });
    if (o.run === 'all') void startRun(id);
    else if (o.run !== 'none' && r.scenePlanStep) void startRun(id, { stepIds: [r.scenePlanStep] }, true);
    return { project: r.project, backup: r.backup, oldScenes: r.oldScenes, keptCache: r.keptCache, running: o.run !== 'none' };
  });
  /** etapas que o bypass atingiria (prévia na interface) */
  h('project:bypass-targets', (id: string, bp: Parameters<typeof applyBypass>[1]) => {
    const p = ops.readProject(settings, id);
    const b = ops.cleanBypass(bp);
    return p.route && b ? bypassTargets(p.route, b) : [];
  });
  h('project:delete', (ids: string[]) => { for (const id of ids) { idle(id); ops.deleteProject(settings, id); } return true; });
  h('project:duplicate', (id: string, name?: string) => ops.duplicateProject(settings, id, name));
  /** Novo projeto a partir de outro com atributos trocados (skill/estilo, rota, formato, idioma, duração). */
  h('project:derive', (id: string, i: DeriveInput) => deriveProject(settings, id, i));
  /**
   * Migrar para outro idioma: cria uma CÓPIA do projeto, traduz roteiro/cenas e refaz só o que
   * depende do idioma (narração, sincronia, efeitos, cenas de código/texto, legendas, montagem,
   * SEO e capa). Imagens e vídeos são mantidos, a menos que `visuals` peça para regerar também.
   */
  h('project:migrate-language', async (id: string, o: { language: string; visuals?: boolean; run?: boolean }) => {
    idle(id);
    const src = ops.readProject(settings, id);
    if (!src.route) throw new Error('projeto sem rota');
    if (!o.language || o.language === src.language) throw new Error('escolha um idioma diferente do atual');
    const copy = ops.duplicateProject(settings, id, `${src.name} [${o.language}]`);
    const ac = new AbortController(); running.set(copy.id, ac);
    const log = (line: string) => send({ t: 'log', line, projectId: copy.id } as EngineEvent & { projectId: string });
    try {
      const res = await translateProject({ settings, project: copy, projectDir: projectDirOf(settings, copy.id), route: copy.route!, language: o.language, languageName: languageName(o.language), signal: ac.signal, log });
      copy.name = `${copy.name} [${o.language}]`;
      if (o.visuals) for (const sc of copy.scenes) for (const st of copy.route!.steps) if (['image', 'video', 'stock_media'].includes(st.kind) && sc.status[st.id]) sc.status[st.id] = 'stale';
      ops.saveProjectFile(settings, copy);
      log(`projeto migrado para ${languageName(o.language)}: ${res.translated} cenas traduzidas (${res.usedBinding})`);
    } catch (e) { running.delete(copy.id); throw new Error(`tradução falhou (a cópia "${copy.name}" foi criada sem traduzir): ${(e as Error).message}`); }
    running.delete(copy.id);
    const kinds = new Set([...LANGUAGE_KINDS, ...(o.visuals ? ['image', 'video', 'stock_media'] : [])]);
    const stepIds = copy.route!.steps.filter((st) => st.enabled && kinds.has(st.kind)).map((st) => st.id);
    const run = o.run === false ? undefined : await startRun(copy.id, { stepIds }, true);
    return { project: ops.readProject(settings, copy.id), run };
  });
  /* efeitos sonoros gerados por código: prévia de um efeito e aplicação direta nas cenas (editor) */
  h('sfx:preview', async (name: string) => {
    const out = path.join(settings.workspace, 'library', 'sfx-preview', `${String(name).replace(/[^\w-]/g, '')}.wav`);
    if (!fs.existsSync(out)) await sfx.renderSfx(settings.ffmpeg, name, out);
    return out;
  });
  /** Ouvir a voz da narração no idioma do projeto (mesmo executor da etapa; resultado em cache). */
  h('voice:preview', (i: VoicePreviewInput) => voicePreview(settings, createExecutors({ workflowsDir: workflowsDir(), toolsDir: toolsDir(), renderHtml, snapHtml, kitRender: { host: kitHost, frames: renderKitFrames } }), i,
    (line) => send({ t: 'log', line: `prévia de voz: ${line}` } as EngineEvent)));
  /** Efeitos pedidos (ou escolhidos pela IA) sincronizados com o que acontece no visual; regera a faixa das cenas. */
  h('sfx:fit', async (id: string, sceneIds: string[], o: { names?: string[] } = {}) => {
    idle(id); const p = ops.readProject(settings, id); const dir = projectDirOf(settings, id);
    if (!p.route) throw new Error('projeto sem rota');
    const ac = new AbortController(); running.set(id, ac);
    const log = (line: string) => send({ t: 'log', line, projectId: id } as EngineEvent & { projectId: string });
    const result: Record<string, string> = {};
    try {
      const fit = await fitSceneSfx({ settings, project: p, projectDir: dir, route: p.route, sceneIds, names: o.names, signal: ac.signal, log });
      for (const sc of p.scenes.filter((x) => sceneIds.includes(x.id))) {
        ops.updateScene(p, sc.id, { sfx: fit[sc.id] ?? [] });
        result[sc.id] = await sfx.applySceneSfx(settings.ffmpeg, settings.ffprobe, path.join(dir, 'scenes', sc.id), sc);
        setSfxArtifact(p, sc, dir);
      }
      ops.saveProjectFile(settings, p);
    } finally { running.delete(id); }
    return { project: p, result };
  });
  h('sfx:apply', async (id: string, sceneIds: string[]) => {
    idle(id); const p = ops.readProject(settings, id); const dir = projectDirOf(settings, id);
    const out: Record<string, string> = {};
    for (const sc of p.scenes.filter((x) => sceneIds.includes(x.id))) {
      out[sc.id] = await sfx.applySceneSfx(settings.ffmpeg, settings.ffprobe, path.join(dir, 'scenes', sc.id), sc);
      setSfxArtifact(p, sc, dir);
    }
    ops.saveProjectFile(settings, p);
    return { project: p, result: out };
  });
  h('project:batch-create', (ideas: string[], base: Omit<NewProjectInput, 'name' | 'idea'>) =>
    ideas.map((x) => x.trim()).filter(Boolean).map((idea, i) =>
      createProject(settings, { ...base, name: idea.slice(0, 48) || `Vídeo ${i + 1}`, idea })));
  h('project:save-route', (id: string, route: Route) => {
    idle(id);
    const p = ops.readProject(settings, id);
    p.route = route;
    ops.saveProjectFile(settings, p);
    return p;
  });
  /** Refaz etapas (sem cache) e tudo o que depende delas — ex.: depois de trocar o harness de uma etapa no editor. */
  h('project:redo-steps', (id: string, stepIds: string[]) => {
    idle(id);
    const p = ops.readProject(settings, id);
    if (!p.route) throw new Error('projeto sem rota');
    return startRun(id, { stepIds: finalizeSteps(p, downstreamSteps(p.route, stepIds), true) }, true);
  });
  h('project:media', (id: string) => {
    const out = path.join(projectDirOf(settings, id), 'out');
    const f = (n: string) => { const x = path.join(out, n); return fs.existsSync(x) ? x : null; };
    return { final: f('final.mp4'), subtitles: f('subtitles.srt'), music: soundtrack.musicFile(out) ?? null };
  });
  /* trilha sonora no editor: escolher arquivo, gerar por código, remover e aplicar no vídeo final */
  h('project:music-pick', async (id: string) => {
    idle(id);
    const r = await dialog.showOpenDialog(win!, { title: 'Trilha sonora do vídeo', properties: ['openFile'], filters: [{ name: 'Áudio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return soundtrack.setMusic(path.join(projectDirOf(settings, id), 'out'), r.filePaths[0]);
  });
  /* arquivos do usuário (imagens, vídeos, áudios, textos ou pastas) para o prompt e a produção */
  const pickAttach = async (mode: 'files' | 'folder') => {
    const r = await dialog.showOpenDialog(win!, mode === 'folder' ? { title: 'Pasta com arquivos para o vídeo', properties: ['openDirectory'] }
      : { title: 'Arquivos para o vídeo (imagens, vídeos, áudios, textos)', properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  };
  h('attach:pick', (mode: 'files' | 'folder') => pickAttach(mode));
  const withProject = (id: string, fn: (p: Project) => void) => { idle(id); const p = ops.readProject(settings, id); fn(p); ops.saveProjectFile(settings, p, { scenes: p.scenes.length > 0 }); return p; };
  h('project:attach', async (id: string, o: { mode?: 'files' | 'folder'; paths?: string[] }) => {
    const paths = o.paths?.length ? o.paths : o.mode ? await pickAttach(o.mode) : [];
    return paths.length ? withProject(id, (p) => attachments.addAttachments(p, projectDirOf(settings, id), paths)) : ops.readProject(settings, id);
  });
  h('project:detach', (id: string, file: string) => withProject(id, (p) => attachments.removeAttachment(p, projectDirOf(settings, id), file)));
  h('project:attachment', (id: string, file: string, patch: Parameters<typeof attachments.updateAttachment>[2]) => withProject(id, (p) => { attachments.updateAttachment(p, file, patch); }));
  h('project:music-clear',(id: string) => { idle(id); soundtrack.setMusic(path.join(projectDirOf(settings, id), 'out'), null); return true; });
  h('project:music-moods', () => MOODS.map((m) => ({ id: m, label: MOOD_LABEL[m] })));
  h('project:music-code', async (id: string, mood: string) => {
    idle(id);
    const p = ops.readProject(settings, id), out = path.join(projectDirOf(settings, id), 'out');
    const final = path.join(out, 'final.mp4');
    const secs = fs.existsSync(final) ? await ff.duration(settings.ffprobe, final).catch(() => 0) : 0;
    return soundtrack.generateMusic(settings, out, mood, secs > 0 ? secs : p.targetDurationSec || 60, (l) => console.log(l));
  });
  /** Vídeo livre (sem cenas): remixa final.base.mp4 + trilha na hora. Com cenas: a montagem refaz o final. */
  h('project:apply-music', async (id: string) => {
    idle(id);
    const p = ops.readProject(settings, id);
    if (p.scenes.length) return startRun(id, { stepIds: finalizeSteps(p, [], true) }, true);
    const msg = await soundtrack.applyFreeSoundtrack(settings, p, path.join(projectDirOf(settings, id), 'out'));
    return { ok: true, message: msg };
  });
  h('project:open-folder', (id: string) => shell.openPath(projectDirOf(settings, id)));

  // cenas
  h('scene:add', (id: string, afterId: string | null, partial: ops.ScenePatch) => {
    idle(id); const p = ops.readProject(settings, id);
    const sc = ops.addScene(settings, p, afterId, partial); ops.saveProjectFile(settings, p); return { project: p, scene: sc };
  });
  h('scene:update', async (id: string, sceneId: string, patch: ops.ScenePatch, regenerate = false) => {
    idle(id); const p = ops.readProject(settings, id);
    const flags = ops.updateScene(p, sceneId, patch); ops.saveProjectFile(settings, p);
    if (regenerate && (flags.visual || flags.audio)) {
      const r = await startRun(id, { sceneIds: [sceneId], stepIds: finalizeSteps(p, ops.stepsFor(p.route, flags), true) });
      return { project: ops.readProject(settings, id), run: r };
    }
    return { project: p };
  });
  h('scene:delete', (id: string, sceneIds: string[]) => {
    idle(id); const p = ops.readProject(settings, id);
    tle.rippleDeleteSegments(p, sceneIds);              // trechos de efeito da timeline puxados junto
    for (const s of sceneIds) ops.deleteScene(settings, p, s);
    ops.saveProjectFile(settings, p); return p;
  });
  /* ferramentas da timeline: cortar, dividir e inserir clipe (com ripple) */
  const realLen = async (p: Project, sceneId: string) => {
    const sc = p.scenes.find((x) => x.id === sceneId);
    if (!sc || sc.manualDuration) return;
    const dir = path.join(projectDirOf(settings, p.id), 'scenes', sc.id, 'audio');
    const a = fs.existsSync(dir) ? fs.readdirSync(dir).find((x) => x.startsWith('narration.') && !x.includes('.trim')) : undefined;
    const d = a ? await ff.duration(settings.ffprobe, path.join(dir, a)).catch(() => 0) : 0;
    if (d > 0.2) sc.durationSec = Math.round((d + 0.15) * 1000) / 1000;
  };
  h('scene:trim', async (id: string, sceneId: string, o: { cutStart?: number; cutEnd?: number }) => {
    idle(id); const p = ops.readProject(settings, id);
    await realLen(p, sceneId); tle.trimScene(settings, p, sceneId, o); ops.saveProjectFile(settings, p); return p;
  });
  h('scene:split', async (id: string, sceneId: string, at: number) => {
    idle(id); const p = ops.readProject(settings, id);
    await realLen(p, sceneId); const b = tle.splitScene(settings, p, sceneId, at); ops.saveProjectFile(settings, p); return { project: p, scene: b };
  });
  h('scene:insert-clip', async (id: string, where: tle.InsertWhere, file?: string) => {
    idle(id);
    if (!file) {
      const r = await dialog.showOpenDialog(win!, { title: 'Inserir clipe na timeline', properties: ['openFile'], filters: [{ name: 'Vídeo ou imagem', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi', 'gif', 'png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      file = r.filePaths[0];
    }
    const p = ops.readProject(settings, id);
    if (where.at === 'time') for (const sc of p.scenes) await realLen(p, sc.id);
    const isVideo = /\.(mp4|mov|mkv|webm|m4v|avi|gif)$/i.test(file);
    const secs = isVideo ? await ff.duration(settings.ffprobe, file).catch(() => 0) : 4;
    const r = tle.insertClip(settings, p, { file, seconds: secs > 0 ? secs : 4, where });
    /* o som do próprio clipe entra como a "narração" da cena (vídeo sem áudio fica mudo) */
    if (isVideo) {
      const out = path.join(r.dir, 'audio', 'narration.wav'); fs.mkdirSync(path.dirname(out), { recursive: true });
      await ff.run(settings.ffmpeg, ['-y', '-i', file, '-vn', '-ac', '2', '-ar', '44100', out]).catch(() => fs.rmSync(out, { force: true }));
    }
    ops.saveProjectFile(settings, p); return { project: p, scene: r.scene };
  });
  /* área de prompt: voz gravada → texto (Whisper, no PC) e imagem colada → arquivo temporário para anexar */
  h('prompt:transcribe', async (bytes: Uint8Array, ext: string, language?: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-voice-'));
    try {
      const src = path.join(dir, `voz.${/^(webm|ogg|wav|mp3|m4a)$/.test(ext) ? ext : 'webm'}`), wav = path.join(dir, 'voz.wav'), out = path.join(dir, 'voz.words.json');
      fs.writeFileSync(src, Buffer.from(bytes));
      await ff.run(settings.ffmpeg, ['-y', '-i', src, '-ac', '1', '-ar', '16000', wav]);
      const script = path.join(toolsDir(), 'whisper_words.py'), lang = language?.trim().slice(0, 2).toLowerCase() || undefined;
      let cfg = settings.whisper ?? { python: 'python', model: 'small', device: 'auto' };
      let w;
      try { w = await transcribe(cfg, script, wav, out, lang, AbortSignal.timeout(600_000)); }
      catch (e) {
        if (cfg.autoInstall === false || !/faster-whisper|No module|ModuleNotFound|não foi possível executar|ENOENT|python/i.test((e as Error).message)) throw e;
        const inst = await ensureWhisper(settings, { log: (l) => send({ t: 'log', line: `whisper: ${l}` }) });
        cfg = { ...cfg, python: inst.python, device: 'cpu' };
        w = await transcribe(cfg, script, wav, out, lang, AbortSignal.timeout(600_000));
      }
      return { text: (w.text?.trim() || w.words.map((x) => x.w).join(' ')).replace(/\s+/g, ' ').trim() };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  h('prompt:save-blob', (bytes: Uint8Array, name: string) => {
    const dir = path.join(os.tmpdir(), 'forge-paste'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, path.basename(name).replace(/[^\w.\-]/g, '_') || `colado-${Date.now()}.png`);
    fs.writeFileSync(f, Buffer.from(bytes)); return f;
  });
  /* estúdio de thumbnail: quadros do vídeo, texto do SEO e o desenho atual; aplica o layout e grava out/thumbnail.png */
  h('thumb:info', async (id: string) => {
    const p = ops.readProject(settings, id), dir = projectDirOf(settings, id), final = path.join(dir, 'out', 'final.mp4');
    const duration = fs.existsSync(final) ? await ff.duration(settings.ffprobe, final).catch(() => 0) : 0;
    const design = projectThumbDesign(settings, p);
    const autoTime = duration ? await bestFrameTime(settings.ffmpeg, final, p, duration, path.join(dir, 'out', 'thumb-work')).catch(() => autoFrameTime(p, duration)) : 0;
    return { duration, autoTime, text: thumbText(dir, p, design?.text ? undefined : design), design, size: thumbSize(p.aspect),
      current: ['thumbnail.png', 'thumbnail.jpg'].map((f) => path.join(dir, 'out', f)).find((f) => fs.existsSync(f)) };
  });
  h('thumb:frame', async (id: string, t: number) => {
    const dir = projectDirOf(settings, id), final = path.join(dir, 'out', 'final.mp4');
    if (!fs.existsSync(final)) throw new Error('ainda não há vídeo final para tirar o quadro');
    return grabFrame(settings.ffmpeg, final, t, path.join(dir, 'out', 'thumb-work', `f-${Math.round(Math.max(0, t) * 10)}.jpg`));
  });
  h('thumb:render', async (id: string, design: ThumbDesign) => {
    idle(id);
    const p = ops.readProject(settings, id), dir = projectDirOf(settings, id);
    p.thumbDesign = design; ops.saveProjectFile(settings, p, { scenes: false });
    const out = path.join(dir, 'out', 'thumbnail.png');
    const r = await renderThumb({ settings, snap: snapHtml, projectDir: dir, project: p, design, out });
    if (fs.existsSync(path.join(dir, 'out', 'publicar'))) await publishKit(id).catch(() => undefined);   // a pasta de publicação leva a capa nova
    return r;
  });
  h('project:publish-kit', async (id: string) => {
    const r = await publishKit(id);
    if (!r) throw new Error('ainda não há vídeo final (out/final.mp4): renderize o final primeiro');
    shell.showItemInFolder(r.video); return r;
  });
  /** Imagem da marca d'água: escolhe e copia para a pasta do projeto (fica portátil e a prévia consegue mostrar). */
  h('project:watermark-pick', async (id: string) => {
    const r = await dialog.showOpenDialog(win!, { title: "Imagem da marca d'água (PNG com transparência fica melhor)", properties: ['openFile'], filters: [{ name: 'Imagem', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    const src = r.canceled ? undefined : r.filePaths[0];
    if (!src) return null;
    const dir = path.join(projectDirOf(settings, id), 'assets');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `watermark${path.extname(src).toLowerCase()}`);
    for (const f of fs.readdirSync(dir).filter((x) => /^watermark\./i.test(x))) fs.rmSync(path.join(dir, f), { force: true });
    fs.copyFileSync(src, dest);
    return dest;
  });
  h('project:export-editor', async (id: string, target: 'davinci' | 'capcut' | 'premiere') => {
    const p = ops.readProject(settings, id);
    const r = await exportForEditor(settings, p, target);
    shell.showItemInFolder(r.main); return r;
  });
  h('scene:move', (id: string, sceneId: string, toIndex: number) => {
    idle(id); const p = ops.readProject(settings, id);
    ops.moveScene(p, sceneId, toIndex); ops.saveProjectFile(settings, p); return p;
  });
  h('scene:duplicate', (id: string, sceneId: string) => {
    idle(id); const p = ops.readProject(settings, id);
    ops.duplicateScene(settings, p, sceneId); ops.saveProjectFile(settings, p); return p;
  });
  h('scene:rewrite', async (id: string, o: { sceneIds: string[]; instruction: string; allowStructure?: boolean; regenerate?: boolean }) => {
    idle(id);
    const p = ops.readProject(settings, id);
    if (!p.route) throw new Error('projeto sem rota');
    const ac = new AbortController(); running.set(id, ac);
    let result;
    try {
      result = await rewriteScenes({
        settings, project: p, projectDir: projectDirOf(settings, id), route: p.route, signal: ac.signal,
        sceneIds: o.sceneIds, instruction: o.instruction, allowStructure: o.allowStructure,
        log: (line) => send({ t: 'log', line, projectId: id } as EngineEvent & { projectId: string }),
      });
      ops.saveProjectFile(settings, p);
    } finally { running.delete(id); }
    let run;
    if (o.regenerate && result.changed.length) {
      run = await startRun(id, { sceneIds: result.changed, stepIds: finalizeSteps(p, ops.stepsFor(p.route, result.flags), true) });
    }
    return { project: ops.readProject(settings, id), result, run };
  });
  /** "Refazer visual com instrução": anexa a instrução às notas da cena e regenera as etapas visuais. */
  h('scene:visual-prompt', async (id: string, o: { sceneIds: string[]; instruction: string; regenerate?: boolean }) => {
    idle(id); const p = ops.readProject(settings, id);
    for (const sid of o.sceneIds) {
      const sc = p.scenes.find((x) => x.id === sid); if (!sc) continue;
      ops.updateScene(p, sid, { notes: [sc.notes, o.instruction].filter(Boolean).join(' | ') });
    }
    ops.saveProjectFile(settings, p);
    const steps = ops.stepsFor(p.route, { visual: true, audio: false });
    const run = o.regenerate === false ? undefined : await startRun(id, { sceneIds: o.sceneIds, stepIds: finalizeSteps(p, steps, true) });
    return { project: ops.readProject(settings, id), run };
  });
  h('scene:regenerate', async (id: string, o: { sceneIds: string[]; stepIds: string[]; reroll?: boolean; finalize?: boolean; executor?: Binding | 'reset'; skillId?: string; plugins?: string[] | 'reset' }) => {
    idle(id); const p = ops.readProject(settings, id);
    /* skill e/ou plugins só destas cenas (o resto do projeto continua com os dele); "" / 'reset' = voltar ao do projeto */
    if (o.skillId !== undefined || o.plugins !== undefined) {
      const sk = o.skillId ? lib.getSkill(settings, o.skillId) : undefined;
      if (o.skillId && !sk) throw new Error(`skill "${o.skillId}" não encontrada`);
      for (const sc of p.scenes) {
        if (!o.sceneIds.includes(sc.id)) continue;
        if (o.skillId !== undefined) { if (sk && sk.id !== p.skill?.id) sc.skillOverride = JSON.parse(JSON.stringify(sk)); else delete sc.skillOverride; }
        if (o.plugins !== undefined) { if (o.plugins === 'reset') delete sc.pluginsOverride; else sc.pluginsOverride = [...new Set(o.plugins)]; }
      }
      ops.saveProjectFile(settings, p);
    }
    /* executor só destas cenas (texto/código): grava overrides na cena; o da rota fica como reserva */
    if (o.executor) {
      for (const sc of p.scenes) {
        if (!o.sceneIds.includes(sc.id)) continue;
        for (const sid of o.stepIds) {
          const st = p.route?.steps.find((x) => x.id === sid);
          const cat = st ? CATEGORY_OF[st.kind] : undefined;
          if (!st || profileSkips(st) || (cat !== 'text' && cat !== 'code')) continue;
          if (o.executor === 'reset') { if (sc.overrides) delete sc.overrides[sid]; continue; }
          const ex = o.executor;
          sc.overrides = { ...(sc.overrides ?? {}), [sid]: [ex, ...st.bindings.filter((b) => !(b.type === 'harness' && ex.type === 'harness' && b.harness === ex.harness))] };
        }
        if (sc.overrides && !Object.keys(sc.overrides).length) delete sc.overrides;
      }
      ops.saveProjectFile(settings, p);
    }
    if (o.reroll) { for (const sc of p.scenes) if (o.sceneIds.includes(sc.id)) sc.variation = (sc.variation ?? 0) + 1; ops.saveProjectFile(settings, p); }
    const run = await startRun(id, { sceneIds: o.sceneIds, stepIds: finalizeSteps(p, o.stepIds, o.finalize !== false) }, true);
    return { project: ops.readProject(settings, id), run };
  });
  h('render:final', (id: string) => {
    const p = ops.readProject(settings, id);
    return startRun(id, { stepIds: finalizeSteps(p, [], true) }, true);
  });

  // execução e lote
  h('run:start', (id: string, only?: Only) => startRun(id, only));
  /** Continuar de onde parou: usa o cache das etapas já concluídas. */
  h('run:resume', (id: string, only?: Only) => startRun(id, only, false));
  h('run:cancel', (id: string) => { running.get(id)?.abort(); return true; });
  h('batch:run', async (ids: string[], concurrency = 1, only?: Only) => {
    if (batch) throw new Error('já existe um lote em andamento');
    batch = new BatchRunner((id) => startRun(id, only), (e) => send(e), (id) => running.get(id)?.abort());
    try { return await batch.run(ids, concurrency, Math.max(0, Math.min(3, settings.batchRetries ?? 1))); } finally { batch = null; }
  });
  h('batch:cancel', () => { batch?.cancel([...running.keys()]); return true; });
}

/**
 * Plugins na pasta do app (`plugins` ao lado do FilmForge.exe): copiar a pasta do app leva os plugins junto.
 * Portátil (FilmForgeData) já fica dentro da pasta do app; pasta escolhida em Configurações continua valendo.
 * Pasta sem permissão de escrita (ex.: Arquivos de Programas): segue na pasta de trabalho.
 */
function useAppPluginsDir(): void {
  if (!app.isPackaged || dataRoot || settings.pluginsDir?.trim()) return;
  const exeDir = path.dirname(process.execPath);
  /* instalado pelo Setup: atualizar/desinstalar apaga a pasta do app inteira — os plugins ficam na pasta de trabalho */
  if (fs.readdirSync(exeDir).some((n) => /^Uninstall .*\.exe$/i.test(n))) return;
  const dir = path.join(exeDir, 'plugins');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, ''); fs.rmSync(probe, { force: true });
  } catch { return; }
  const old = pluginsRoot(settings);
  setAppPluginsDir(dir);
  try {
    const copied = adoptPlugins(old, dir);
    if (copied.length) console.log(`plugins copiados para a pasta do app (${dir}): ${copied.join(', ')} — a pasta antiga ${old} ficou como cópia`);
  } catch (e) { dumpErr('plugins-adopt', e); }
}

app.whenReady().then(() => {
  settings = loadSettings();
  useAppPluginsDir();
  /* `FilmForge.exe --mcp`: roda como servidor MCP por stdio, sem janela.
     O protocolo usa stdout; qualquer diagnóstico vai para stderr. */
  /* `--validate`: valida TODAS as skills/rotas/tipos da biblioteca e as mídias que elas exigem. */
  if (process.argv.includes('--validate')) {
    const report: Array<{ kind: string; id: string; route?: string; ok: boolean; errors: string[] }> = [];
    const routes = lib.listRoutes(settings);
    const skills = lib.listSkills(settings);
    let workflowFiles: Set<string> | undefined;
    try { workflowFiles = new Set(fs.readdirSync(workflowsDir()).filter((f) => f.endsWith('.json'))); } catch { workflowFiles = undefined; }
    for (const r of routes) {
      const errs = lib.validateRoute(r);
      for (const st of r.steps ?? []) for (const b of st.bindings ?? []) {
        if (b.type === 'comfyui') {
          if (workflowFiles && !workflowFiles.has(b.workflow)) errs.push(`etapa ${st.id}: workflow "${b.workflow}" não existe`);
          if (!settings.comfyServers.some((srv) => srv.id === b.server)) errs.push(`etapa ${st.id}: servidor ComfyUI "${b.server}" não configurado`);
        }
        if (b.type === 'harness' && b.harness !== 'auto') {
          const cfg = settings.harnesses[b.harness];
          if (!cfg) errs.push(`etapa ${st.id}: harness "${b.harness}" não configurado`);
          else if (!isHttpHarness(cfg) && !resolveHarnessCommand(cfg).found) errs.push(`etapa ${st.id}: comando do harness "${b.harness}" não encontrado`);
        }
        if (b.type === 'api' && !settings.providers.some((p) => p.id === b.provider)) errs.push(`etapa ${st.id}: provedor de API "${b.provider}" não configurado`);
      }
      report.push({ kind: 'route', id: r.id, ok: errs.length === 0, errors: errs });
    }
    for (const k of skills) {
      const errs: string[] = [];
      const r = k.routeId ? lib.getAnyRoute(settings, k.routeId) : undefined;
      if (k.routeId && !r) errs.push(`rota "${k.routeId}" não existe`);
      if (r && !k.freeform && !r.steps.some((st) => st.kind === 'scene_plan')) errs.push('a skill pede cenas, mas a rota não tem a etapa scene_plan');
      if (r && k.freeform && !r.steps.some((st) => st.kind === 'free')) errs.push('skill de vídeo livre, mas a rota não tem a etapa free');
      if (r) {
        try {
          const p = createProject(settings, { name: 'Validação', idea: 'teste', videoType: (k.appearance ?? 'custom') as Project['videoType'], skillId: k.id, routeId: r.id });
          /* createProject persiste; a validação não deve deixar projeto para trás */
          try { fs.rmSync(projectDirOf(settings, p.id), { recursive: true, force: true }); } catch { /* ignora */ }
        } catch (e) { errs.push((e as Error).message); }
      }
      report.push({ kind: 'skill', id: k.id, route: k.routeId, ok: errs.length === 0, errors: errs });
    }
    console.log(JSON.stringify(report, null, 2));
    try { fs.writeFileSync(path.join(settings.workspace, 'validation.json'), JSON.stringify(report, null, 2)); } catch { /* ignora */ }
    const bad = report.filter((x) => !x.ok);
    console.log(`VALIDAÇÃO: ${report.length} itens, ${bad.length} com erro`);
    app.exit(bad.length ? 1 : 0);
    return;
  }
  /* `FilmForge.exe --mcp-http [porta]`: servidor MCP por HTTP/SSE para ChatGPT,
     Claude remoto, Cursor, VS Code e qualquer cliente que aceite URL. */
  const httpArg = process.argv.find((a) => a === '--mcp-http' || a.startsWith('--mcp-http='));
  if (httpArg) {
    headless = true;
    const eq = httpArg.includes('=') ? httpArg.split('=')[1] : '';
    const next = process.argv[process.argv.indexOf(httpArg) + 1];
    const port = Math.max(0, Math.min(65535, Math.round(Number(eq || (next && /^\d+$/.test(next) ? next : process.env.FILMFORGE_MCP_PORT || 3333)) || 3333)));
    const hostAt = process.argv.indexOf('--mcp-host');
    const tokenAt = process.argv.indexOf('--mcp-token');
    const host = hostAt >= 0 ? process.argv[hostAt + 1] : (process.env.FILMFORGE_MCP_HOST || '127.0.0.1');
    const token = tokenAt >= 0 ? process.argv[tokenAt + 1] : process.env.FILMFORGE_MCP_TOKEN;
    void runMcpHttp(mcpDeps(), { host, port, token, path: '/mcp' })
      .then((h) => { mcpHttp = h; console.log(`MCP HTTP pronto: ${h.url}`); })
      .catch((e) => { console.error(`MCP HTTP falhou: ${(e as Error).message}`); app.exit(1); });
    return;
  }
  if (process.argv.includes('--mcp') || process.argv.includes('--mcp-server')) {
    headless = true;
    runMcpStdio(mcpDeps());
    return;
  }
  /* `electron . --install-whisper`: baixa/instala o faster-whisper num venv isolado. */
  if (process.argv.includes('--install-whisper')) {
    void ensureWhisper(settings, { log: (l) => console.log(l) })
      .then((r) => { saveSettings(settings); console.log(`WHISPER OK ${r.python}${r.version ? ' (' + r.version + ')' : ''}`); app.exit(0); })
      .catch((e) => { console.error(`WHISPER FALHOU: ${(e as Error).message}`); app.exit(1); });
    return;
  }
  /* `electron . --run-project <id>`: executa a rota do projeto e sai (sem janela).
     Útil para testes de fumaça, lote no CI e para o usuário rodar pela linha de comando. */
  const runAt = process.argv.indexOf('--run-project');
  /* forge-file:// e forge-scene://: também no modo sem janela — sem eles o render das páginas falhava com ERR_FAILED (-2) */
  function registerProtocols() {
    // forge-file://media/<caminho codificado> — somente arquivos do workspace, dos projetos e dos plugins
    // (os plugins podem estar fora do workspace: pasta ao lado do .exe ou escolhida nas Configurações — capas e galerias)
    protocol.handle('forge-file', (req) => {
      try {
        const u = new URL(req.url);
        const file = path.resolve(decodeURIComponent(u.pathname.replace(/^\//, '')));
        const roots = [settings.workspace, projectsDir(settings), pluginsRoot(settings)].map((r) => path.resolve(r) + path.sep);
        if (!roots.some((root) => file.startsWith(root))) return new Response('forbidden', { status: 403 });
        return net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
      } catch { return new Response('bad request', { status: 400 }); }
    });
    /* forge-scene://: cenas por código e bibliotecas de plugins copiadas no projeto (módulos ES funcionam) */
    registerSceneProtocol(() => [settings.workspace, projectsDir(settings), pluginsRoot(settings), os.tmpdir()]);
  }
  if (runAt >= 0) {
    headless = true;
    registerProtocols();
    const id = process.argv[runAt + 1];
    if (!id) { console.error('uso: --run-project <id>'); app.exit(2); return; }
    fs.mkdirSync(settings.workspace, { recursive: true });
    try { headlessLog = path.join(projectDirOf(settings, id), 'headless.log'); fs.writeFileSync(headlessLog, `# ${new Date().toISOString()} --run-project ${id}\n`); } catch { headlessLog = ''; }
    const stepsAt = process.argv.indexOf('--steps');
    const stepIds = stepsAt >= 0 ? (process.argv[stepsAt + 1] ?? '').split(',').map((x) => x.trim()).filter(Boolean) : [];
    const only = stepIds.length ? { stepIds } : undefined;
    const done = (line: string, code: number) => { try { console.log(line); } catch { /* sem console */ } try { if (headlessLog) fs.appendFileSync(headlessLog, line + '\n'); } catch { /* só registro */ } app.exit(code); };
    void startRun(id, only, process.argv.includes('--no-cache')).then((res) => done(`RESULT ${JSON.stringify(res)}`, res.ok ? 0 : 1))
      .catch((e) => done(`RESULT ${JSON.stringify({ ok: false, error: (e as Error)?.stack ?? String(e) })}`, 1));
    return;
  }
  fs.mkdirSync(settings.workspace, { recursive: true });
  /* inicializa o sistema de memória do FilmForge */
  try {
    const memResult = memory.initializeMemorySystem(String(process.resourcesPath ?? ''));
    if (memResult.success) {
      console.log(`[FilmForge] Sistema de memória inicializado: ${memResult.path}`);
      const stats = memory.getMemoryStats();
      console.log(`[FilmForge] Memórias carregadas: ${stats.total} (${JSON.stringify(stats.byType)})`);
    } else {
      console.warn(`[FilmForge] Aviso: ${memResult.error}`);
    }
  } catch (e) { dumpErr('memory-system', e); }
  /* plugins que vêm com o app (ex.: Interface Cinemática): instalados uma vez na pasta de plugins do usuário */
  try {
    const seeded = seedBundledPlugins(settings, bundledPluginsDir());
    if (seeded.length) saveSettings(settings);
    /* claude-youtube (MIT): na primeira vez vira também uma skill + rota prontas (pelo importador de SKILL.md) */
    if (seeded.includes('youtube')) void importClaudeSkill(settings, { source: path.join(bundledPluginsDir(), 'youtube'), name: 'YouTube Creator', language: 'pt-BR' }, () => {})
      .then((r) => adaptPlugin(settings, r.plugin.id, { harness: '', log: () => {} }))
      .catch((e) => dumpErr('seed-youtube-skill', e));
  } catch (e) { dumpErr('seed-plugins', e); }
  registerProtocols();
  /* uso real do Antigravity em cada chamada, por conta (Automações → uso) */
  setHarnessUsageSink((u) => recordAgyUsage(settings, { at: new Date().toISOString(), account: accountOfAgyHome(settings, u.home), model: u.model, input: u.input, output: u.output, thinking: u.thinking, total: u.total, ok: u.ok }));
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => Wan2gpClient.shutdownAll());
/* No modo headless (--run-project) não há janela: fechar a janela temporária do
   renderizador de cenas NÃO pode encerrar o app no meio da execução. */
app.on('window-all-closed', () => { if (headless) return; if (process.platform !== 'darwin') app.quit(); });
