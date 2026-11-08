import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CHANNEL_TYPES, THUMB_STYLES, contrastRatio, defaultIdentity, identityPrompt, mergeIdentity, normalizePalette, paletteList, paletteRoles,
  parseChannelLink, pushBrandHistory, recreateNote, restoreBrand, setupStatus, BRAND_HISTORY_MAX,
} from '../main/channel-setup';
import { addChannel, getChannel, linkClone, listChannels, markAuthOpened, restoreChannelBrand, saveAnalytics, saveBrand, updateChannel, PLATFORM_INFO } from '../main/channels';
import { PLATFORM_ADAPTERS } from '../main/channel-publish';
import { buildBrandPrompt, sanitizeBrand, thumbModelHtml } from '../main/channel-brand';
import type { Channel, Settings } from '../shared/types';

async function main() {
  /* ───────── 1) link do canal: plataforma e @ saem do link ───────── */
  assert.deepEqual(parseChannelLink('https://www.youtube.com/@MeuCanal/videos'), { platform: 'youtube', handle: '@MeuCanal', url: 'https://www.youtube.com/@MeuCanal' });
  assert.equal(parseChannelLink('youtube.com/channel/UC123abc').id, 'UC123abc', 'sem https e com /channel/');
  assert.equal(parseChannelLink('@canal').platform, 'youtube', '@handle solto = YouTube');
  assert.equal(parseChannelLink('https://m.youtube.com/c/antigo').handle, '@antigo');
  assert.deepEqual(parseChannelLink('https://www.tiktok.com/@perfil?lang=pt'), { platform: 'tiktok', handle: '@perfil', url: 'https://www.tiktok.com/@perfil' });
  assert.deepEqual(parseChannelLink('instagram.com/minha.marca/'), { platform: 'instagram', handle: '@minha.marca', url: 'https://www.instagram.com/minha.marca/' });
  assert.equal(parseChannelLink('https://web.facebook.com/minhapagina').platform, 'facebook');
  assert.equal(parseChannelLink('https://www.facebook.com/profile.php?id=1000').id, '1000');
  assert.deepEqual(parseChannelLink('https://www.kwai.com/@kwaier'), { platform: 'kwai', handle: '@kwaier', url: 'https://www.kwai.com/@kwaier' });
  assert.throws(() => parseChannelLink('https://www.youtube.com/watch?v=abc'), /vídeo/, 'link de vídeo é recusado');
  assert.throws(() => parseChannelLink('https://youtu.be/abc'), /vídeo/);
  assert.throws(() => parseChannelLink('https://www.instagram.com/p/xyz'), /publicação/);
  assert.throws(() => parseChannelLink('https://www.tiktok.com/foryou'), /perfil/);
  assert.throws(() => parseChannelLink('https://orkut.com/x'), /não reconhecida/);
  assert.throws(() => parseChannelLink(''), /link/);

  /* ───────── tipos e estilos ───────── */
  assert.ok(CHANNEL_TYPES.length >= 8 && CHANNEL_TYPES.every((t) => THUMB_STYLES.some((s) => s.id === t.thumbStyle)), 'todo tipo aponta para um estilo de thumbnail existente');
  assert.ok(PLATFORM_INFO.kwai && PLATFORM_ADAPTERS.kwai && !PLATFORM_ADAPTERS.kwai.ready, 'Kwai existe (publicação em breve)');

  /* ───────── paletas: contraste WCAG, papéis, modo ───────── */
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#fff', '#fff'), 1);
  const roles = paletteRoles(['#ffcc00', '#3355aa', '#ffffff', '#0b0b10']);
  assert.equal(roles.background, '#0b0b10'); assert.equal(roles.mode, 'dark');
  assert.equal(roles.text, '#ffffff', 'texto = maior contraste com o fundo');
  assert.equal(roles.accent, '#ffcc00', 'destaque = a mais saturada que sobrou');
  assert.ok((roles.contrast ?? 0) > 15);
  assert.equal(paletteRoles(['#111111', '#e63946', '#f7f7f7']).mode, 'light', 'a última cor (fundo da marca) define o modo');
  assert.equal(paletteRoles(['#0b0b10', '#3355aa', '#ffcc00']).mode, 'dark', 'sem fundo claro/escuro no fim: maioria escura');
  assert.equal(paletteRoles(['#f7f7f7', '#111111'], 'dark').background, '#111111', 'modo forçado pelo tipo');
  const np = normalizePalette({ background: '#FFFFFF', text: '#222222', accent: 'vermelho' });
  assert.equal(np?.background, '#ffffff'); assert.equal(np?.accent, undefined, 'hex inválido some'); assert.equal(np?.mode, 'light');
  assert.equal(normalizePalette('nada'), undefined);
  assert.deepEqual(paletteList({ background: '#000000', text: '#ffffff', accent: '#ff0000', secondary: '#00ff00' }), ['#ff0000', '#00ff00', '#ffffff', '#000000']);

  /* ───────── marca: histórico, restaurar, recriar ───────── */
  const ch: Channel = { id: 'ch1', name: 'X', platform: 'youtube', createdAt: '' };
  pushBrandHistory(ch, { names: ['Alfa'], tagline: 'a' });
  assert.equal(ch.brandHistory?.length ?? 0, 0, 'primeira marca não gera histórico');
  pushBrandHistory(ch, { names: ['Beta'], tagline: 'b' });
  assert.equal(ch.brand?.names?.[0], 'Beta'); assert.equal(ch.brandHistory?.[0]?.names?.[0], 'Alfa');
  for (let i = 0; i < 10; i++) pushBrandHistory(ch, { names: [`N${i}`] });
  assert.equal(ch.brandHistory?.length, BRAND_HISTORY_MAX, 'histórico limitado');
  const note = recreateNote(ch);
  assert.match(note, /DIFERENTE/); assert.match(note, /N9/); assert.match(note, /N8/);
  restoreBrand(ch, 0);
  assert.equal(ch.brand?.names?.[0], 'N8', 'restaurou a mais recente do histórico'); assert.equal(ch.brandHistory?.[0]?.names?.[0], 'N9', 'a atual foi para o histórico');
  assert.throws(() => restoreBrand(ch, 99), /não existe/);

  /* ───────── identidade ───────── */
  const di = defaultIdentity({ colors: ['#101014', '#7c5cff', '#f5f8ff'] }, 'educativo');
  assert.equal(di.thumbStyle, 'explicativo', 'estilo de thumbnail vem do tipo');
  assert.equal(di.palettes?.video?.mode, 'light', 'tipo educativo puxa fundo claro');
  const merged = mergeIdentity({ thumbStyle: 'minimal' }, { thumbStyle: 'impacto', palettes: { video: { background: '#000000' } } });
  assert.equal(merged.thumbStyle, 'minimal', 'o que o usuário definiu vence'); assert.equal(merged.palettes?.video?.background, '#000000', 'sugestão preenche o resto');
  const withId: Channel = { ...ch, name: 'Meu Canal', identity: { palettes: { video: { background: '#0b0b10', text: '#ffffff', accent: '#ffcc00', contrast: 18.9 }, thumbnail: { background: '#ff0000', text: '#ffffff' } },
    thumbStyle: 'impacto', typography: { family: 'Montserrat', case: 'upper', outline: '6 px preto', animation: 'pop' } } };
  const ip = identityPrompt(withId, 'image');
  assert.match(ip, /VENCE/); assert.match(ip, /fundo #0b0b10/); assert.match(ip, /Montserrat/); assert.doesNotMatch(ip, /estilo de thumbnail/);
  const it = identityPrompt(withId, 'thumbnail');
  assert.match(it, /fundo #ff0000/, 'thumbnail usa a paleta da thumbnail'); assert.match(it, /Impacto/);
  assert.equal(identityPrompt(undefined), '');

  /* ───────── setup: passos cumpridos e próximo ───────── */
  assert.deepEqual(setupStatus({ id: 'ch2', name: 'y', platform: 'tiktok', createdAt: '' }).next, 'link');
  const full = setupStatus({ ...withId, url: 'u', auth: { status: 'confirmed' }, type: 'dark-narrado', brand: { names: ['a'] }, assets: { banner: 'banner.png' }, analytics: { platform: 'youtube', source: 'api', at: '', sample: 0 } });
  assert.equal(full.next, undefined); assert.equal(full.done.length, 7);

  /* ───────── canais.ts: cadastro com link, autenticação, marca, análise, clone ───────── */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-chsetup-'));
  const s = { workspace: ws, projectsDir: path.join(ws, 'projects') } as Settings;
  const a = addChannel(s, { link: 'https://www.tiktok.com/@dark.curiosidades', type: 'shorts-curiosidades' });
  assert.equal(a.platform, 'tiktok'); assert.equal(a.name, 'dark.curiosidades', 'nome provisório = @ do link'); assert.equal(a.handle, '@dark.curiosidades');
  assert.equal(a.type, 'shorts-curiosidades'); assert.equal(a.auth?.status, 'pending');
  assert.throws(() => addChannel(s, { link: 'https://www.tiktok.com/@dark.curiosidades' }), /já está cadastrado/, 'mesmo link duas vezes');
  assert.throws(() => addChannel(s, { link: 'https://youtu.be/x' }), /vídeo/);
  const b = addChannel(s, { name: 'Sem link', platform: 'youtube' });
  assert.equal(b.url, undefined, 'cadastro antigo (sem link) continua aceito pela API');
  updateChannel(s, b.id, { url: 'https://www.instagram.com/outra/' });
  assert.equal(getChannel(s, b.id).platform, 'instagram', 'o link manda na plataforma');
  assert.throws(() => updateChannel(s, b.id, { url: 'https://www.youtube.com/watch?v=1' }), /vídeo/);
  markAuthOpened(s, a.id); assert.equal(getChannel(s, a.id).auth?.status, 'opened');
  updateChannel(s, a.id, { authConfirmed: true }); assert.equal(getChannel(s, a.id).auth?.status, 'confirmed');
  markAuthOpened(s, a.id); assert.equal(getChannel(s, a.id).auth?.status, 'confirmed', 'abrir de novo não desfaz a confirmação');
  updateChannel(s, a.id, { identity: { palettes: { video: { background: '#000000', text: '#777777' } }, thumbStyle: 'minimal', typography: { case: 'loud' as never, family: ' Inter ' } } });
  const idn = getChannel(s, a.id).identity!;
  assert.equal(idn.palettes?.video?.contrast, contrastRatio('#777777', '#000000'), 'contraste recalculado'); assert.equal(idn.typography?.case, undefined, 'caixa inválida some'); assert.equal(idn.typography?.family, 'Inter');
  saveBrand(s, a.id, { names: ['Primeira'], colors: ['#111111', '#eeeeee'] });
  saveBrand(s, a.id, { names: ['Segunda'], identity: { thumbStyle: 'impacto' } });
  const ca = getChannel(s, a.id);
  assert.equal(ca.brand?.names?.[0], 'Segunda'); assert.equal(ca.brandHistory?.[0]?.names?.[0], 'Primeira');
  assert.equal(ca.identity?.thumbStyle, 'minimal', 'identidade do usuário não é sobrescrita pela marca nova');
  assert.ok(fs.existsSync(path.join(ws, 'channels', 'mine', a.id, 'brand-history.json')));
  restoreChannelBrand(s, a.id, 0); assert.equal(getChannel(s, a.id).brand?.names?.[0], 'Primeira');
  saveAnalytics(s, a.id, { platform: 'tiktok', source: 'yt-dlp', at: 'x', sample: 3 });
  saveAnalytics(s, a.id, { platform: 'tiktok', source: 'yt-dlp', at: 'y', sample: 4 });
  assert.equal(getChannel(s, a.id).analytics?.at, 'y');
  assert.equal((JSON.parse(fs.readFileSync(path.join(ws, 'channels', 'mine', a.id, 'analytics.json'), 'utf8')) as unknown[]).length, 2, 'histórico das análises');
  linkClone(s, a.id, 'clone-1'); linkClone(s, a.id, 'clone-2'); linkClone(s, a.id, 'clone-1');
  assert.deepEqual(getChannel(s, a.id).cloneIds, ['clone-1', 'clone-2']);
  linkClone(s, a.id, 'clone-1', false); linkClone(s, a.id, 'clone-2', false);
  assert.equal(getChannel(s, a.id).cloneIds, undefined);
  const view = listChannels(s).find((x) => x.id === a.id)!;
  assert.ok(view.setup.done.includes('link') && view.setup.done.includes('auth') && view.setup.done.includes('type') && view.setup.done.includes('brand'));

  /* ───────── marca: prompt com tipo/recriar e saneamento da identidade ───────── */
  const prompt = buildBrandPrompt({ idea: 'mistérios da história', harness: 'auto', type: 'dark-narrado', link: 'https://www.youtube.com/@x', recreate: recreateNote(ch), analytics: '100 seguidores', platform: 'kwai' }, 'pt-BR');
  assert.match(prompt, /Dark narrado/); assert.match(prompt, /"tags"/); assert.match(prompt, /"identity"/); assert.match(prompt, /RECRIAR/); assert.match(prompt, /Kwai/); assert.match(prompt, /100 seguidores/);
  const sb = sanitizeBrand({ names: ['A'], tags: ['#um', 'dois'], colors: ['#000000', 'azul', '#ffcc00'],
    identity: { thumbStyle: 'inexistente', palettes: { video: { background: '#101010', text: '#fafafa', accent: '#ff3300' } }, typography: { family: 'Bebas Neue', case: 'UPPER', animation: 'pop' } } }, 'documentario');
  assert.deepEqual(sb.tags, ['um', 'dois']); assert.deepEqual(sb.colors, ['#000000', '#ffcc00']);
  assert.equal(sb.identity?.thumbStyle, 'documentario', 'estilo inválido cai no do tipo'); assert.equal(sb.identity?.typography?.case, 'upper');
  assert.equal(sb.identity?.palettes?.video?.accent, '#ff3300'); assert.ok(sb.identity?.palettes?.channel, 'paleta do canal sai das cores');
  const html = thumbModelHtml({ ...sb, tagline: 'segredo revelado agora' }, 'Canal');
  assert.match(html, /1280px/); assert.match(html, /SEGREDO/); assert.match(html, /#ff3300/); assert.match(html, /Bebas Neue/);
  assert.doesNotMatch(thumbModelHtml({ names: ['<b>x</b>'], tagline: '<script>alert(1)</script>' }, 'x'), /<script>/, 'texto escapado');

  console.log('channel-setup: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
