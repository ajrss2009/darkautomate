import * as assert from 'node:assert/strict';
import {
  analyticsLine, analyzeChannel, facebookItems, instagramItems, ruleInsights, summarizeItems, tiktokItems, youtubeItems, ytdlpItems, type MediaItem,
} from '../main/channel-analytics';
import type { Channel, ChannelAnalytics, Settings } from '../shared/types';

async function main() {
  /* ───────── resumo puro ───────── */
  const day = (d: number, h = 15) => new Date(Date.UTC(2026, 9, d, h)).toISOString();
  const items: MediaItem[] = [
    { id: 'a', title: 'A', views: 1000, likes: 50, comments: 10, durationSec: 40, publishedAt: day(1) },     // qui
    { id: 'b', title: 'B', views: 3000, likes: 90, comments: 30, durationSec: 600, publishedAt: day(8) },    // qui
    { id: 'c', title: 'C', views: 500, likes: 5, comments: 0, durationSec: 30, publishedAt: day(4) },        // dom
    { id: 'd', title: 'D', views: 400, likes: 4, comments: 1, durationSec: 50, publishedAt: day(11) },       // dom
    { id: 'e', title: 'Recorde', views: 50000, likes: 2000, comments: 300, durationSec: 45, publishedAt: day(15) },
  ];
  const a = summarizeItems(items, { platform: 'youtube', source: 'api', followers: 2000 });
  assert.equal(a.sample, 5); assert.equal(a.medianViews, 1000); assert.equal(a.maxViews, 50000);
  assert.equal(a.avgViews, Math.round((1000 + 3000 + 500 + 400 + 50000) / 5));
  assert.equal(a.engagementRate, Math.round(((50 + 10 + 90 + 30 + 5 + 0 + 4 + 1 + 2000 + 300) / 54900) * 1000) / 10);
  assert.equal(a.uploadsPerWeek, Math.round((4 / 14) * 7 * 10) / 10, '5 vídeos em 14 dias');
  assert.equal(a.shortsShare, 0.8);
  assert.equal(a.bestWeekday, 4, 'quinta (média 2000) vence domingo (450)');
  assert.equal(a.top?.[0]?.title, 'Recorde');
  assert.ok(a.insights?.some((x) => /outliers/.test(x)), 'detecta outlier');
  assert.ok(a.insights?.some((x) => /quinta/.test(x)), 'melhor dia');
  assert.ok(a.insights?.some((x) => /Shorts/.test(x)), 'quase só Shorts');
  const empty = summarizeItems([], { platform: 'kwai', source: 'yt-dlp' });
  assert.equal(empty.sample, 0); assert.equal(empty.avgViews, undefined); assert.deepEqual(empty.insights, []);
  assert.ok(ruleInsights({ platform: 'tiktok', source: 'api', at: '', sample: 1, followers: 100000, avgViews: 100, uploadsPerWeek: 0.5, engagementRate: 0.4 }).length >= 3);
  assert.match(analyticsLine(a), /2000 seguidores/);

  /* ───────── leitores das respostas das APIs ───────── */
  const yt = youtubeItems({ items: [{ id: 'v1', snippet: { title: 'T', publishedAt: day(2) }, statistics: { viewCount: '12', likeCount: '3', commentCount: '1' }, contentDetails: { duration: 'PT1M5S' } }] });
  assert.deepEqual(yt[0], { id: 'v1', title: 'T', url: 'https://www.youtube.com/watch?v=v1', views: 12, likes: 3, comments: 1, durationSec: 65, publishedAt: day(2) });
  const tt = tiktokItems({ data: { videos: [{ id: 7, title: '', video_description: 'desc', view_count: 9, like_count: 2, comment_count: 0, share_count: 1, duration: 15, create_time: 1700000000 }] } });
  assert.equal(tt[0]!.title, 'desc'); assert.equal(tt[0]!.shares, 1); assert.equal(tt[0]!.publishedAt, new Date(1700000000 * 1000).toISOString());
  const fb = facebookItems({ data: [{ id: 'p', message: 'olá mundo', created_time: day(3), likes: { summary: { total_count: 4 } }, comments: { summary: { total_count: 2 } }, views: 40, length: 33 }] });
  assert.equal(fb[0]!.likes, 4); assert.equal(fb[0]!.views, 40); assert.equal(fb[0]!.durationSec, 33);
  const ig = instagramItems({ data: [{ id: 'm', caption: 'x', like_count: 10, comments_count: 1, timestamp: day(5) }] });
  assert.equal(ig[0]!.views, undefined); assert.equal(ig[0]!.likes, 10);
  const yd = ytdlpItems({ entries: [{ id: 'k', title: 'K', view_count: 5, upload_date: '20261020' }, { title: 'sem id' }] });
  assert.equal(yd.length, 1); assert.equal(yd[0]!.publishedAt, '2026-10-20T00:00:00Z');

  /* ───────── analyzeChannel: API oficial quando há chave; senão yt-dlp ───────── */
  const calls: string[] = [];
  const fakeFetch = (async (url: string) => {
    calls.push(String(url));
    const body = /\/channels\?/.test(url) ? { items: [{ id: 'UC1', snippet: { title: 'Canal X', customUrl: '@canalx' }, statistics: { subscriberCount: '5000', viewCount: '90000', videoCount: '40' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }
      : /playlistItems/.test(url) ? { items: [{ contentDetails: { videoId: 'v1' } }, { contentDetails: { videoId: 'v2' } }] }
      : /\/videos\?/.test(url) ? { items: [{ id: 'v1', snippet: { title: 'um', publishedAt: day(1) }, statistics: { viewCount: '100' } }, { id: 'v2', snippet: { title: 'dois', publishedAt: day(3) }, statistics: { viewCount: '300' } }] }
      : {};
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  const ch: Channel = { id: 'ch1', name: 'X', platform: 'youtube', url: 'https://www.youtube.com/@canalx', createdAt: '' };
  const withKey = { stock: { youtube: { apiKey: 'K' } } } as unknown as Settings;
  const r1 = await analyzeChannel(withKey, ch, { fetch: fakeFetch, ytdlp: async () => { throw new Error('não devia usar o yt-dlp'); } });
  assert.equal(r1.source, 'api'); assert.equal(r1.followers, 5000); assert.equal(r1.sample, 2); assert.equal(r1.avgViews, 200);
  assert.ok(calls[0]!.includes('forHandle=%40canalx'), 'resolve o canal pelo @handle'); assert.ok(calls.every((u) => u.includes('key=K')));

  let fellBack = 0;
  const stub = async (_s: Settings, url: string, platform: Channel['platform']): Promise<ChannelAnalytics> => { fellBack++; return summarizeItems([{ id: 'z', views: 7 }], { platform, source: 'yt-dlp', title: url }); };
  const r2 = await analyzeChannel({} as Settings, ch, { fetch: fakeFetch, ytdlp: stub });
  assert.equal(r2.source, 'yt-dlp'); assert.ok(r2.warnings?.some((w) => /YouTube Data API/.test(w)), 'avisa que falta a chave');
  const failing = (async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'quota' } }) })) as unknown as typeof fetch;
  const r3 = await analyzeChannel(withKey, ch, { fetch: failing, ytdlp: stub });
  assert.equal(r3.source, 'yt-dlp'); assert.ok(r3.warnings?.some((w) => /quota/.test(w)), 'API falhou → yt-dlp com o motivo');
  const kwai = await analyzeChannel({} as Settings, { ...ch, platform: 'kwai', url: 'https://www.kwai.com/@k' }, { ytdlp: stub });
  assert.ok(kwai.warnings?.some((w) => /Kwai não tem API pública/.test(w)));
  const tik = await analyzeChannel({ channelApis: { tiktok: { token: 'T' } } } as Settings, { ...ch, platform: 'tiktok', url: 'https://www.tiktok.com/@t' }, {
    fetch: (async (url: string, init?: RequestInit) => {
      assert.equal((init?.headers as Record<string, string>)['Authorization'], 'Bearer T');
      const body = /user\/info/.test(url) ? { data: { user: { display_name: 'T', username: 't', follower_count: 10 } } } : { data: { videos: [{ id: 1, view_count: 50, like_count: 5, comment_count: 0 }] } };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }) as unknown as typeof fetch, ytdlp: stub });
  assert.equal(tik.source, 'api'); assert.equal(tik.followers, 10); assert.equal(tik.engagementRate, 10);
  await assert.rejects(analyzeChannel({} as Settings, { ...ch, url: undefined }), /link/);
  assert.equal(fellBack, 3);

  console.log('channel-analytics: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
