import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Channel, ChannelBrand, ChannelPlatform, PublishRecord, Project, Settings } from '../shared/types';

/**
 * CANAIS: a identidade de publicação que o usuário gerencia (YouTube, TikTok, Instagram, Facebook).
 * Diferente do "clonar canal" (que analisa um canal ALHEIO para copiar o formato), aqui o canal é SEU:
 * ele aponta para uma conta de Automações (que dá a sessão de navegador), guarda a marca gerada por IA
 * e os arquivos visuais, e serve de destino para os projetos.
 */

export const MAX_CHANNELS = 20;

/** Canais que o app sabe publicar hoje. As demais plataformas entram como adaptador novo. */
export const READY_PLATFORMS: ChannelPlatform[] = ['youtube'];

export const PLATFORM_INFO: Record<ChannelPlatform, { label: string; icon: string; loginUrl: string }> = {
  youtube: { label: 'YouTube', icon: '▶️', loginUrl: 'https://studio.youtube.com/' },
  tiktok: { label: 'TikTok', icon: '🎵', loginUrl: 'https://www.tiktok.com/upload' },
  instagram: { label: 'Instagram', icon: '📸', loginUrl: 'https://www.instagram.com/' },
  facebook: { label: 'Facebook', icon: '📘', loginUrl: 'https://www.facebook.com/' },
};

export const config = (s: Settings): Channel[] => (s.channels ??= []);

/** Onde ficam marca e imagens dos canais PRÓPRIOS (separado de workspace/channels/, que é dos clones). */
export const channelsRoot = (s: Settings) => path.join(s.workspace, 'channels', 'mine');

export function channelDir(s: Settings, id: string): string {
  if (!/^ch\d{1,2}$/.test(id)) throw new Error(`canal inválido: ${id}`);   // ch1…ch20
  return path.join(channelsRoot(s), id);
}

/** Canal + estado derivado que a interface mostra. */
export interface ChannelView extends Channel {
  dir: string;
  hasBrand: boolean;
  hasAssets: { banner: boolean; avatar: boolean; thumb: boolean };
  /** quantos projetos declaram este canal como destino */
  projects: number;
}

export function listChannels(s: Settings): ChannelView[] {
  const projects = listProjectsOfChannels(s);
  return config(s).map((c) => {
    const dir = channelDir(s, c.id);
    const asset = (rel?: string) => !!rel && fs.existsSync(path.join(dir, rel));
    return {
      ...c, dir,
      hasBrand: !!c.brand,
      hasAssets: { banner: asset(c.assets?.banner), avatar: asset(c.assets?.avatar), thumb: asset(c.assets?.thumb) },
      projects: projects.filter((p) => p.channelId === c.id).length,
    };
  });
}

export function getChannel(s: Settings, id: string): Channel {
  const c = config(s).find((x) => x.id === id);
  if (!c) throw new Error(`canal não encontrado: ${id}`);
  return c;
}

export function addChannel(s: Settings, input: { name: string; platform: ChannelPlatform; accountId?: string }): Channel {
  const cfg = config(s);
  if (cfg.length >= MAX_CHANNELS) throw new Error(`limite de ${MAX_CHANNELS} canais`);
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('o canal precisa de um nome');
  if (!PLATFORM_INFO[input.platform]) throw new Error(`plataforma desconhecida: ${input.platform}`);
  let n = 1; while (cfg.some((c) => c.id === `ch${n}`)) n++;
  const ch: Channel = {
    id: `ch${n}`, name: name.slice(0, 80), platform: input.platform,
    accountId: input.accountId?.trim() || undefined, createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(channelDir(s, ch.id), { recursive: true });
  cfg.push(ch);
  return ch;
}

export function updateChannel(s: Settings, id: string, patch: Partial<Pick<Channel, 'name' | 'platform' | 'accountId' | 'handle' | 'url'>>): Channel {
  const c = getChannel(s, id);
  if (typeof patch.name === 'string' && patch.name.trim()) c.name = patch.name.trim().slice(0, 80);
  if (patch.platform && PLATFORM_INFO[patch.platform]) c.platform = patch.platform;
  if (typeof patch.accountId === 'string') c.accountId = patch.accountId.trim() || undefined;
  if (typeof patch.handle === 'string') c.handle = patch.handle.trim() || undefined;
  if (typeof patch.url === 'string') c.url = patch.url.trim() || undefined;
  return c;
}

/** Tira o canal da lista. A pasta (marca, imagens) fica no disco — apague manualmente se quiser. */
export function removeChannel(s: Settings, id: string): string {
  const cfg = config(s);
  const dir = channelDir(s, id);
  cfg.splice(0, cfg.length, ...cfg.filter((c) => c.id !== id));
  return dir;
}

/** Grava a marca no canal e em brand.json (o arquivo é a fonte se o settings.json se perder). */
export function saveBrand(s: Settings, id: string, brand: ChannelBrand): Channel {
  const c = getChannel(s, id);
  c.brand = brand;
  if (brand.handle && !c.handle) c.handle = brand.handle;
  const dir = channelDir(s, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify(brand, null, 2));
  return c;
}

/** Caminhos gerados a partir da marca; guarda o relativo para o canal continuar válido se a pasta mudar. */
export function setAsset(s: Settings, id: string, kind: 'banner' | 'avatar' | 'thumb', file: string): void {
  const c = getChannel(s, id);
  const dir = channelDir(s, id);
  c.assets = { ...c.assets, [kind]: path.relative(dir, file).split(path.sep).join('/') };
}

export function markPublished(s: Settings, id: string): void {
  try { getChannel(s, id).lastPublishAt = new Date().toISOString(); } catch { /* canal removido */ }
}

/**
 * Projetos que declaram um canal como destino. Lê só o cabeçalho de cada projeto.json
 * (a lista de projetos já é pequena; evita carregar cenas e mídia só para contar).
 */
export function listProjectsOfChannels(s: Settings): Array<{ channelId: string }> {
  const dir = s.projectsDir?.trim() ? path.resolve(s.projectsDir.trim()) : path.join(s.workspace, 'projects');
  let ids: string[] = [];
  try { ids = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  const out: Array<{ channelId: string }> = [];
  for (const id of ids) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, id, 'project.json'), 'utf8')) as Partial<Project>;
      if (p?.channelId) out.push({ channelId: p.channelId });
    } catch { /* projeto ilegível: ignora */ }
  }
  return out;
}

/** Projetos de um canal, com o mínimo que a lista de publicáveis precisa. */
export function listChannelProjects(s: Settings, id: string): Array<Pick<Project, 'id' | 'name' | 'createdAt'> & { hasVideo: boolean; published: PublishRecord[] }> {
  const dir = s.projectsDir?.trim() ? path.resolve(s.projectsDir.trim()) : path.join(s.workspace, 'projects');
  let ids: string[] = [];
  try { ids = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  const out: Array<Pick<Project, 'id' | 'name' | 'createdAt'> & { hasVideo: boolean; published: PublishRecord[] }> = [];
  for (const pid of ids) {
    const dirOf = path.join(dir, pid);
    let p: Partial<Project>;
    try { p = JSON.parse(fs.readFileSync(path.join(dirOf, 'project.json'), 'utf8')) as Partial<Project>; } catch { continue; }
    if (p.channelId !== id) continue;
    out.push({
      id: pid, name: p.name ?? pid, createdAt: p.createdAt ?? '',
      hasVideo: fs.existsSync(path.join(dirOf, 'out', 'final.mp4')),
      published: readPublish(dirOf),
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Lê out/publish.json aceitando os dois formatos: o objeto único das versões antigas
 * e o array multi-plataforma atual.
 */
export function readPublish(projectDir: string): PublishRecord[] {
  const file = path.join(projectDir, 'out', 'publish.json');
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  if (Array.isArray(raw)) return raw as PublishRecord[];
  if (raw && typeof raw === 'object') return [raw as PublishRecord];
  return [];
}

/**
 * Acrescenta (ou substitui, para o mesmo canal+plataforma) um registro de publicação.
 * Um registro antigo da mesma plataforma SEM channelId é o publicado antes dos canais
 * existirem: ele é substituído em vez de duplicar a entrada.
 */
export function appendPublish(projectDir: string, rec: PublishRecord): PublishRecord[] {
  const out = path.join(projectDir, 'out');
  fs.mkdirSync(out, { recursive: true });
  const list = readPublish(projectDir).filter((r) => !(r.platform === rec.platform && (!r.channelId || r.channelId === rec.channelId)));
  const next = [...list, rec];
  fs.writeFileSync(path.join(out, 'publish.json'), JSON.stringify(next, null, 2));
  return next;
}
