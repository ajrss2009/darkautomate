import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Binding, MediaBank, Project, ProviderConfig, Settings } from '../shared/types';

/*
 * SALVAR CONFIGURAÇÕES
 * 1) do app: um arquivo .ffsettings.json com tudo de Configurações (provedores, harnesses, servidores, bancos, canais,
 *    automações, Telegram…). Chaves de API e tokens vão CIFRADOS com a senha que você escolher — ou ficam de fora.
 * 2) do projeto: a configuração COMPLETA (rota com o provedor/modelo de cada etapa, vozes, elenco, legenda, efeitos,
 *    música, publicação…) + os provedores que a rota usa (APIs, servidores ComfyUI, Wan2GP, harnesses, contas do Flow,
 *    bancos de mídia). Restaurar cria o que faltar sem sobrescrever o que você já tem.
 */
export const SETTINGS_FORMAT = 'filmforge-settings';
export const PROJECT_CONFIG_FORMAT = 'filmforge-project-config';

/* ── segredos: AES-256-GCM com chave derivada da senha (scrypt); "pw1:" marca o valor cifrado ── */
export function sealSecret(plain: string, password: string): string {
  if (!plain) return '';
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'pw1:' + Buffer.concat([salt, iv, c.getAuthTag(), enc]).toString('base64');
}
export function openSecret(v: string, password: string): string {
  if (!v?.startsWith('pw1:')) return v ?? '';
  const b = Buffer.from(v.slice(4), 'base64');
  const key = crypto.scryptSync(password, b.subarray(0, 16), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(16, 28));
  d.setAuthTag(b.subarray(28, 44));
  try { return Buffer.concat([d.update(b.subarray(44)), d.final()]).toString('utf8'); } catch { throw new Error('senha errada: não consegui abrir as chaves do arquivo'); }
}

/** Aplica `f` em todo segredo das configurações (chaves de API, tokens). Função pura. */
export function mapSecrets(s: Partial<Settings>, f: (v: string) => string): Partial<Settings> {
  const out: Partial<Settings> = JSON.parse(JSON.stringify(s));
  if (out.providers) out.providers = out.providers.map((p) => ({ ...p, apiKey: f(p.apiKey ?? '') }));
  if (out.stock) out.stock = Object.fromEntries(Object.entries(out.stock).map(([k, v]) => [k, v ? { ...v, apiKey: f(v.apiKey ?? '') } : v])) as Settings['stock'];
  if (out.comfyServers) out.comfyServers = out.comfyServers.map((c) => (c.token ? { ...c, token: f(c.token) } : c));
  if (out.telegram?.token) out.telegram = { ...out.telegram, token: f(out.telegram.token) };
  if (out.channelApis) out.channelApis = Object.fromEntries(Object.entries(out.channelApis).map(([k, v]) => [k, v && typeof (v as { token?: unknown }).token === 'string' ? { ...v, token: f((v as { token: string }).token) } : v])) as Settings['channelApis'];
  return out;
}
const secretsOf = (pw?: string) => (v: string) => (!v ? '' : pw ? sealSecret(v, pw) : '');

/** Itens que só valem nesta máquina: ficam no arquivo como informação, mas a restauração mantém os daqui. */
const LOCAL_KEYS = ['workspace', 'projectsDir', 'pluginsDir'] as const;

export interface SettingsBackup { format: typeof SETTINGS_FORMAT; version: 1; createdAt: string; secrets: 'encrypted' | 'omitted'; settings: Partial<Settings> }
export function exportAppSettings(s: Settings, o: { password?: string } = {}): SettingsBackup {
  return { format: SETTINGS_FORMAT, version: 1, createdAt: new Date().toISOString(), secrets: o.password ? 'encrypted' : 'omitted', settings: mapSecrets(s, secretsOf(o.password)) };
}
/** Restaura: tudo do arquivo, menos as pastas desta máquina; segredos abertos com a senha (sem senha = mantém os daqui). */
export function importAppSettings(current: Settings, b: SettingsBackup, o: { password?: string } = {}): Settings {
  if (b?.format !== SETTINGS_FORMAT) throw new Error('não é um arquivo de configurações do FilmForge (.ffsettings.json)');
  if (b.secrets === 'encrypted' && !o.password) throw new Error('o arquivo tem chaves cifradas: informe a senha usada ao salvar');
  const curKeys = new Map<string, string>();
  mapSecrets(current, (v) => v);   // só para validar a forma
  for (const p of current.providers ?? []) curKeys.set(`p:${p.id}`, p.apiKey);
  const opened = mapSecrets(b.settings, (v) => (v.startsWith('pw1:') ? openSecret(v, o.password!) : v));
  const merged = { ...current, ...opened } as Settings;
  for (const k of LOCAL_KEYS) (merged as unknown as Record<string, unknown>)[k] = (current as unknown as Record<string, unknown>)[k];
  /* sem chave no arquivo: mantém a chave que já existe aqui para o mesmo provedor */
  merged.providers = (merged.providers ?? []).map((p) => (p.apiKey ? p : { ...p, apiKey: curKeys.get(`p:${p.id}`) ?? '' }));
  if (!opened.telegram?.token && current.telegram?.token && merged.telegram) merged.telegram = { ...merged.telegram, token: current.telegram.token };
  return merged;
}

/* ── configuração completa do projeto ── */
/** Campos que são CONTEÚDO de um projeto (não configuração): ficam de fora. */
const CONTENT_KEYS = new Set(['id', 'name', 'idea', 'scenes', 'createdAt', 'updatedAt', 'attachments', 'refScript', 'refVideo', 'musicCompilation', 'musicSegment', 'beatSync',
  'avatarPoses', 'productClip', 'thumbRef', 'derivedFrom', 'foldId', 'fold', 'log', 'firstFrame', 'series', 'memories', 'production', 'storyboard', 'waveform', 'tracks']);

export interface ProjectConfig {
  format: typeof PROJECT_CONFIG_FORMAT; version: 1; id: string; name: string; createdAt: string; fromProject?: string; secrets: 'encrypted' | 'omitted';
  project: Partial<Project>;
  providers: {
    api: ProviderConfig[]; comfyServers: NonNullable<Settings['comfyServers']>; wan2gp?: Settings['wan2gp']; harnesses: Partial<Settings['harnesses']>;
    flowAccounts: Array<{ id: string; label?: string; email?: string }>; mediaBanks: MediaBank[]; executorProfile?: unknown;
  };
}

const bindingsOf = (p: Partial<Project>): Binding[] => (p.route?.steps ?? []).flatMap((s) => s.bindings ?? []);

export function exportProjectConfig(s: Settings, p: Project, o: { name?: string; password?: string } = {}): ProjectConfig {
  const project = Object.fromEntries(Object.entries(p).filter(([k]) => !CONTENT_KEYS.has(k))) as Partial<Project>;
  const bs = bindingsOf(p);
  const apiIds = new Set(bs.filter((b) => b.type === 'api').map((b) => (b as { provider: string }).provider));
  const comfyIds = new Set(bs.filter((b) => b.type === 'comfyui').map((b) => (b as { server: string }).server));
  const harnessIds = new Set(bs.filter((b) => b.type === 'harness').map((b) => (b as { harness: string }).harness));
  const flowIds = new Set(bs.filter((b) => b.type === 'flow').map((b) => (b as { account?: string }).account).filter(Boolean) as string[]);
  if (p.flowAccount) flowIds.add(p.flowAccount);
  const bankIds = new Set(bs.filter((b) => b.type === 'builtin' && (b as { tool?: string }).tool === 'media-folder').map((b) => (b as { bank?: string }).bank ?? '*'));
  const seal = secretsOf(o.password);
  const exProfile = (s.executorProfiles ?? []).find((x) => (x as { id?: string }).id === (p as { executorProfile?: string }).executorProfile);
  return {
    format: PROJECT_CONFIG_FORMAT, version: 1, id: '', name: o.name?.trim() || `Configuração de ${p.name}`, createdAt: new Date().toISOString(), fromProject: p.name,
    secrets: o.password ? 'encrypted' : 'omitted', project,
    providers: {
      api: (s.providers ?? []).filter((x) => apiIds.has(x.id)).map((x) => ({ ...x, apiKey: seal(x.apiKey) })),
      comfyServers: (s.comfyServers ?? []).filter((x) => comfyIds.has(x.id)).map((x) => (x.token ? { ...x, token: seal(x.token) } : x)),
      wan2gp: bs.some((b) => b.type === 'wan2gp') ? s.wan2gp : undefined,
      harnesses: Object.fromEntries(Object.entries(s.harnesses ?? {}).filter(([k]) => harnessIds.has(k))) as Partial<Settings['harnesses']>,
      flowAccounts: (s.automations?.accounts ?? []).filter((a) => flowIds.has(a.id) || bs.some((b) => b.type === 'flow' && !(b as { account?: string }).account)).map((a) => ({ id: a.id, label: (a as { label?: string }).label, email: (a as { email?: string }).email })),
      mediaBanks: (s.mediaBanks ?? []).filter((b) => bankIds.has(b.id) || bankIds.has('*')),
      executorProfile: exProfile,
    },
  };
}

/** Restaura os provedores do arquivo que faltam aqui (nunca sobrescreve um que já existe, só completa chave vazia). */
export function mergeConfigProviders(s: Settings, cfg: ProjectConfig, password?: string): { settings: Settings; added: string[]; missing: string[] } {
  if (cfg?.format !== PROJECT_CONFIG_FORMAT) throw new Error('não é uma configuração de projeto do FilmForge');
  const open = (v: string) => (v?.startsWith('pw1:') ? (password ? openSecret(v, password) : '') : v ?? '');
  const out: Settings = JSON.parse(JSON.stringify(s));
  const added: string[] = [], missing: string[] = [];
  for (const p of cfg.providers.api ?? []) {
    const cur = out.providers.find((x) => x.id === p.id);
    const key = open(p.apiKey);
    if (!cur) { out.providers.push({ ...p, apiKey: key }); added.push(`API ${p.id}`); if (!key) missing.push(`chave da API ${p.id}`); }
    else if (!cur.apiKey && key) { cur.apiKey = key; added.push(`chave da API ${p.id}`); }
  }
  for (const c of cfg.providers.comfyServers ?? []) {
    if (!(out.comfyServers ?? []).some((x) => x.id === c.id)) { out.comfyServers = [...(out.comfyServers ?? []), { ...c, token: c.token ? open(c.token) : c.token }]; added.push(`ComfyUI ${c.id}`); }
  }
  if (cfg.providers.wan2gp && !out.wan2gp?.root) { out.wan2gp = cfg.providers.wan2gp; added.push('Wan2GP'); }
  else if (cfg.providers.wan2gp && out.wan2gp?.root && !fs.existsSync(out.wan2gp.root)) missing.push(`pasta do Wan2GP (${out.wan2gp.root})`);
  for (const [k, v] of Object.entries(cfg.providers.harnesses ?? {})) {
    const cur = (out.harnesses as Record<string, unknown>)[k];
    if (!cur && v) { (out.harnesses as Record<string, unknown>)[k] = v; added.push(`harness ${k}`); }
  }
  for (const b of cfg.providers.mediaBanks ?? []) {
    if (!(out.mediaBanks ?? []).some((x) => x.id === b.id)) { out.mediaBanks = [...(out.mediaBanks ?? []), b]; added.push(`banco ${b.name}`); }
    if (!fs.existsSync(b.dir)) missing.push(`pasta do banco ${b.name} (${b.dir})`);
  }
  for (const a of cfg.providers.flowAccounts ?? []) if (!(out.automations?.accounts ?? []).some((x) => x.id === a.id)) missing.push(`conta do Flow ${a.label ?? a.id} (faça login em Automações)`);
  if (cfg.providers.executorProfile && !(out.executorProfiles ?? []).some((x) => (x as { id?: string }).id === (cfg.providers.executorProfile as { id?: string }).id)) {
    out.executorProfiles = [...(out.executorProfiles ?? []), cfg.providers.executorProfile as never]; added.push('perfil de executores');
  }
  return { settings: out, added, missing };
}

/** Campos do projeto da configuração (para criar um projeto novo ou aplicar num existente). */
export function configProjectFields(cfg: ProjectConfig): Partial<Project> {
  return Object.fromEntries(Object.entries(cfg.project ?? {}).filter(([k]) => !CONTENT_KEYS.has(k))) as Partial<Project>;
}

/* ── biblioteca: workspace/library/project-configs ── */
const dirOf = (s: Settings) => path.join(s.workspace, 'library', 'project-configs');
const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'config';
export function saveProjectConfig(s: Settings, cfg: ProjectConfig): ProjectConfig {
  fs.mkdirSync(dirOf(s), { recursive: true });
  let id = cfg.id || slug(cfg.name), i = 2;
  if (!cfg.id) while (fs.existsSync(path.join(dirOf(s), `${id}.json`))) id = `${slug(cfg.name)}-${i++}`;
  const out = { ...cfg, id };
  fs.writeFileSync(path.join(dirOf(s), `${id}.json`), JSON.stringify(out, null, 2));
  return out;
}
export function listProjectConfigs(s: Settings): Array<Pick<ProjectConfig, 'id' | 'name' | 'createdAt' | 'fromProject' | 'secrets'> & { route?: string; skill?: string }> {
  if (!fs.existsSync(dirOf(s))) return [];
  return fs.readdirSync(dirOf(s)).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try { const c = JSON.parse(fs.readFileSync(path.join(dirOf(s), f), 'utf8')) as ProjectConfig; return [{ id: c.id, name: c.name, createdAt: c.createdAt, fromProject: c.fromProject, secrets: c.secrets, route: c.project.route?.name, skill: c.project.skill?.name }]; } catch { return []; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function readProjectConfig(s: Settings, idOrFile: string): ProjectConfig {
  const f = fs.existsSync(idOrFile) ? idOrFile : path.join(dirOf(s), `${idOrFile.replace(/[^\w-]/g, '')}.json`);
  const c = JSON.parse(fs.readFileSync(f, 'utf8')) as ProjectConfig;
  if (c?.format !== PROJECT_CONFIG_FORMAT) throw new Error('não é uma configuração de projeto do FilmForge');
  return c;
}
export function deleteProjectConfig(s: Settings, id: string): void { fs.rmSync(path.join(dirOf(s), `${id.replace(/[^\w-]/g, '')}.json`), { force: true }); }
