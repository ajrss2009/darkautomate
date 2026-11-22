import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChannelPlatform, PublishRecord, Settings } from '../shared/types';
import { ensureFlowBrowser, flowAccount } from './automations';
import { youtubeUpload, uploadMeta } from './youtube-upload';
import { getChannel, listChannels, markPublished, appendPublish, PLATFORM_INFO } from './channels';
import { socialCaption, socialUpload, type SocialPlatform } from './social-upload';

/**
 * PUBLICAÇÃO POR CANAL: um adaptador por plataforma, todos dirigindo o navegador da conta
 * (CDP) — o mesmo motor do upload do YouTube. O login é sempre feito pelo usuário; o app
 * nunca digita senha. Nesta versão só o YouTube tem adaptador; as demais entram como
 * entradas novas em PLATFORM_ADAPTERS, sem mexer no chamador.
 */

export interface PublishJob {
  /** conta de Automações com a sessão já logada */
  account: string;
  port: number;
  file: string;
  title: string;
  description?: string;
  thumbnail?: string;
  tags?: string[];
  visibility?: 'UNLISTED' | 'PRIVATE' | 'PUBLIC';
  log: (l: string) => void;
  signal?: AbortSignal;
  debugDir?: string;
  /** override de URL, só para teste offline */
  uploadUrl?: string;
}

export interface PublishResult { url?: string | null; studioUrl?: string }

interface PlatformAdapter {
  id: ChannelPlatform;
  /** false = ainda não implementado: a UI mostra "em breve" em vez de um botão que falha */
  ready: boolean;
  upload: (job: PublishJob) => Promise<PublishResult>;
}

const youtubeAdapter: PlatformAdapter = {
  id: 'youtube', ready: true,
  upload: async (job) => {
    const r = await youtubeUpload({
      port: job.port, file: job.file, title: job.title, description: job.description,
      thumbnail: job.thumbnail, tags: job.tags, visibility: job.visibility ?? 'UNLISTED',
      log: job.log, signal: job.signal, debugDir: job.debugDir, uploadUrl: job.uploadUrl,
    });
    return { url: r.url ?? null, studioUrl: r.studioUrl };
  },
};

/* TikTok, Instagram, Facebook e Kwai: mesmo motor (navegador da conta via CDP), uma especificação por plataforma */
const socialAdapter = (id: SocialPlatform): PlatformAdapter => ({
  id, ready: true,
  upload: async (job) => {
    const r = await socialUpload({ platform: id, port: job.port, file: job.file, visibility: job.visibility,
      caption: socialCaption(id, { title: job.title, description: job.description, tags: job.tags }),
      log: job.log, signal: job.signal, debugDir: job.debugDir, uploadUrl: job.uploadUrl });
    return { url: r.url ?? null };
  },
});

/** UUID estável por plataforma; um adaptador novo entra aqui e passa a aparecer pronto na UI. */
export const PLATFORM_ADAPTERS: Record<ChannelPlatform, PlatformAdapter> = {
  youtube: youtubeAdapter,
  tiktok: socialAdapter('tiktok'),
  instagram: socialAdapter('instagram'),
  facebook: socialAdapter('facebook'),
  kwai: socialAdapter('kwai'),
};

export interface PublishOptions {
  channelId: string;
  projectId: string;
  projectDir: string;
  projectName: string;
  visibility?: 'UNLISTED' | 'PRIVATE' | 'PUBLIC';
  log: (l: string) => void;
  signal?: AbortSignal;
  /** override de URL por plataforma, para teste offline */
  uploadUrls?: Partial<Record<ChannelPlatform, string>>;
}

/**
 * Publica o `out/final.mp4` de um projeto no canal escolhido. A conta vem do canal;
 * se ele não tiver conta, cai na conta de YouTube das Automações e então na primeira com login.
 */
export async function publishToChannel(s: Settings, o: PublishOptions): Promise<PublishRecord> {
  const channel = getChannel(s, o.channelId);
  const adapter = PLATFORM_ADAPTERS[channel.platform];
  if (!adapter) throw new Error(`plataforma desconhecida: ${channel.platform}`);
  if (!adapter.ready) throw new Error(`${PLATFORM_INFO[channel.platform]?.label ?? channel.platform}: publicação ainda não implementada`);

  const video = path.join(o.projectDir, 'out', 'final.mp4');
  if (!fs.existsSync(video)) throw new Error('o projeto ainda não tem o vídeo final (renderize antes de enviar)');

  const acc = flowAccount(s, channel.accountId || s.automations?.youtubeAccount || undefined);
  o.log(`${PLATFORM_INFO[channel.platform]?.label ?? channel.platform} → canal "${channel.name}" com a conta ${acc.label}${acc.email ? ` (${acc.email})` : ''}`);

  if (o.signal?.aborted) throw new Error('cancelado');
  const port = await ensureFlowBrowser(s, acc.id, o.log);

  /* metadados: o mesmo extrator que o upload avulso usa (título/descrição/tags/thumbnail da saída) */
  const meta = uploadMeta(path.join(o.projectDir, 'out'), o.projectName);
  const result = await adapter.upload({
    account: acc.id, port, file: video, title: meta.title,
    description: meta.description, thumbnail: meta.thumbnail, tags: meta.tags,
    visibility: o.visibility ?? 'UNLISTED', log: o.log, signal: o.signal,
    debugDir: path.join(o.projectDir, 'out', `${channel.platform}-debug`),
    uploadUrl: o.uploadUrls?.[channel.platform],
  });

  const rec: PublishRecord = {
    platform: channel.platform, channelId: channel.id, account: acc.id,
    visibility: o.visibility ?? 'UNLISTED', title: meta.title,
    url: result.url ?? null, studioUrl: result.studioUrl, at: new Date().toISOString(),
  };
  appendPublish(o.projectDir, rec);
  markPublished(s, channel.id);
  o.log(`enviado${result.url ? `: ${result.url}` : ''}`);
  return rec;
}

/**
 * Destinos de publicação de um projeto: os canais escolhidos + os PERFIS LIGADOS a eles (um canal do YouTube com
 * TikTok/Instagram/Facebook/Kwai da mesma marca publica em todos). Sem repetição, na ordem escolhida. Função pura.
 */
export function expandTargets(channels: Array<{ id: string; linked?: string[] }>, targets: string[]): string[] {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const out: string[] = [];
  for (const id of targets) {
    if (!byId.has(id) || out.includes(id)) continue;
    out.push(id);
    for (const l of byId.get(id)!.linked ?? []) if (byId.has(l) && !out.includes(l)) out.push(l);
  }
  return out;
}

/**
 * Publica o projeto em VÁRIAS redes: um destino por vez (o navegador da conta é um só), e a falha de uma rede não
 * impede as outras — o resultado diz o que entrou e o que falhou.
 */
export async function publishEverywhere(s: Settings, o: Omit<PublishOptions, 'channelId'> & { targets: string[] }): Promise<Array<{ channelId: string; ok: boolean; record?: PublishRecord; error?: string }>> {
  const ids = expandTargets(listChannels(s), o.targets);
  if (!ids.length) throw new Error('nenhum canal/perfil de destino (escolha em "Publicar em" no projeto)');
  const out: Array<{ channelId: string; ok: boolean; record?: PublishRecord; error?: string }> = [];
  for (const channelId of ids) {
    if (o.signal?.aborted) break;
    try { out.push({ channelId, ok: true, record: await publishToChannel(s, { ...o, channelId }) }); }
    catch (e) { const error = (e as Error).message; o.log(`✗ ${channelId}: ${error}`); out.push({ channelId, ok: false, error }); }
  }
  return out;
}

/** Plataformas que já podem publicar (a UI usa para esconder as que ainda não têm adaptador). */
export const readyPlatforms = () => (Object.values(PLATFORM_ADAPTERS) as PlatformAdapter[]).filter((a) => a.ready).map((a) => a.id);
