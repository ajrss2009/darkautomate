import * as assert from 'node:assert/strict';
import { SOCIAL_SITES, cardsToVideos, extractScript, groupAuthors, isSocialPlatform, looksLikeLoginWall, parseCount, parseSocialUrl, scoreSocial, searchSocial, ytdlpEnrich } from '../main/social-search';
import { kindIcon, routeEngines, routeIcon, skillIcon, withIcon } from '../shared/list-icons';
import { ROUTES } from '../main/presets';
import { BUILTIN_SKILLS } from '../main/skills-builtin';

async function main() {
  /* ───────── contagens como as redes mostram ───────── */
  assert.equal(parseCount('1,2 mi visualizações'), 1_200_000);
  assert.equal(parseCount('3.4M'), 3_400_000);
  assert.equal(parseCount('12 mil curtidas'), 12_000);
  assert.equal(parseCount('12K'), 12_000);
  assert.equal(parseCount('1.234'), 1234);
  assert.equal(parseCount('1.234.567 views'), 1_234_567);
  assert.equal(parseCount('1 234 visualizações'), 1234);
  assert.equal(parseCount('2,5 milhões'), 2_500_000);
  assert.equal(parseCount('987'), 987);
  assert.equal(parseCount('sem número'), undefined);
  assert.equal(parseCount('3 meses'), 3, 'o "m" de "meses" não vira milhão');

  /* ───────── links dos vídeos por rede ───────── */
  assert.deepEqual(parseSocialUrl('tiktok', 'https://www.tiktok.com/@ana.b/video/7300000000000000001?is_from_webapp=1'),
    { id: '7300000000000000001', url: 'https://www.tiktok.com/@ana.b/video/7300000000000000001', author: '@ana.b', authorUrl: 'https://www.tiktok.com/@ana.b' });
  assert.equal(parseSocialUrl('tiktok', 'https://www.tiktok.com/@ana.b'), undefined, 'perfil não é vídeo');
  assert.equal(parseSocialUrl('instagram', '/reel/Cx1_ab/')?.url, 'https://www.instagram.com/reel/Cx1_ab/', 'link relativo');
  assert.equal(parseSocialUrl('instagram', 'https://www.instagram.com/marca/p/AbC/')?.author, '@marca');
  assert.equal(parseSocialUrl('facebook', 'https://www.facebook.com/watch/?v=123')?.id, '123');
  assert.equal(parseSocialUrl('facebook', 'https://www.facebook.com/pagina/videos/titulo-x/456/')?.author, 'pagina');
  assert.equal(parseSocialUrl('facebook', 'https://www.facebook.com/reel/789')?.url, 'https://www.facebook.com/reel/789');
  assert.equal(parseSocialUrl('kwai', 'https://www.kwai.com/@kw/video/5xyz')?.author, '@kw');
  assert.equal(parseSocialUrl('kwai', 'https://www.kwai.com/discover/receitas'), undefined);
  assert.ok(isSocialPlatform('kwai') && !isSocialPlatform('youtube'));
  assert.match(SOCIAL_SITES.tiktok.search('gatos fofos'), /search\/video\?q=gatos%20fofos/);
  assert.equal(SOCIAL_SITES.instagram.tag!('Receitas Fáceis'), 'https://www.instagram.com/explore/tags/receitasfaceis/');
  assert.ok(extractScript('facebook').includes('/videos/|/reel/'), 'o script procura os links de vídeo da rede');
  assert.ok(extractScript('tiktok', 10, 2).includes('seen.size >= 10'));

  /* ───────── cartões → vídeos ───────── */
  const cards = [
    { href: 'https://www.tiktok.com/@a/video/1', text: '1.2M\nreceita de bolo em 1 minuto', img: 'https://p16.tiktokcdn.com/1.jpg' },
    { href: 'https://www.tiktok.com/@a/video/1', text: 'repetido' },
    { href: 'https://www.tiktok.com/@b/video/2', text: '35K\nbolo de cenoura' },
    { href: 'https://www.tiktok.com/@a', text: 'perfil' },
  ];
  const vids = cardsToVideos('tiktok', cards);
  assert.equal(vids.length, 2, 'sem repetidos e sem links que não são vídeo');
  assert.equal(vids[0]!.views, 1_200_000, 'no TikTok o número solto do cartão = views');
  assert.match(vids[0]!.title, /receita de bolo/); assert.doesNotMatch(vids[0]!.title, /1\.2M/);
  const fb = cardsToVideos('facebook', [{ href: 'https://www.facebook.com/watch/?v=9', text: 'Como fazer pão · 2,3 mi visualizações · 15 mil reações · 300 comentários' }]);
  assert.equal(fb[0]!.views, 2_300_000); assert.equal(fb[0]!.likes, 15_000); assert.equal(fb[0]!.comments, 300);

  /* ───────── nota relativa à busca ───────── */
  const now = Date.parse('2026-11-08T00:00:00Z');
  const scored = scoreSocial([
    { platform: 'tiktok', id: 'x', url: 'u1', title: 'velho', views: 5_000_000, likes: 100_000, publishedAt: '2025-11-08T00:00:00Z' },
    { platform: 'tiktok', id: 'y', url: 'u2', title: 'novo e viral', views: 2_000_000, likes: 300_000, comments: 20_000, publishedAt: '2026-11-05T00:00:00Z' },
    { platform: 'tiktok', id: 'z', url: 'u3', title: 'fraco', views: 1_000, publishedAt: '2026-10-01T00:00:00Z' },
  ], now);
  assert.equal(scored[0]!.id, 'y', 'novo, rápido e engajado vence o mais visto antigo');
  assert.ok(scored[0]!.reasons.some((r) => /dia/.test(r)) && scored[0]!.reasons.some((r) => /engajamento/.test(r)));
  assert.equal(scored[scored.length - 1]!.id, 'z');
  assert.ok(scored.every((v) => v.score >= 0 && v.score <= 100));
  assert.deepEqual(groupAuthors([{ ...scored[0]!, author: '@a' }, { ...scored[1]!, author: '@a' }, { ...scored[2]!, author: '@b' }]).map((a) => [a.author, a.hits]), [['@a', 2], ['@b', 1]]);
  const en = ytdlpEnrich(vids[1]!, { id: '2', view_count: 40000, like_count: 4000, comment_count: 10, duration: 21, timestamp: 1762560000, title: 'Bolo de cenoura fofinho' });
  assert.equal(en.views, 40000); assert.equal(en.durationSec, 21); assert.equal(en.title, 'Bolo de cenoura fofinho'); assert.ok(en.publishedAt?.startsWith('2025-11-'));
  assert.ok(looksLikeLoginWall('https://www.instagram.com/accounts/login/?next=x', ''));
  assert.ok(!looksLikeLoginWall('https://www.tiktok.com/search/video?q=x', 'resultados'));

  /* ───────── fluxo: busca, reserva pela hashtag, yt-dlp e parede de login ───────── */
  const visited: string[] = [];
  const r = await searchSocial('tiktok', 'bolo', {
    browse: async (_p, url) => { visited.push(url); return url.includes('/search/') ? { url, text: '', cards: [] } : { url, text: '', cards }; },
    ytdlp: async (urls) => { assert.equal(urls.length, 2); return [{ id: '2', view_count: 40000, like_count: 4000 }]; },
  });
  assert.equal(visited.length, 2, 'busca vazia → tenta a hashtag'); assert.match(visited[1]!, /\/tag\/bolo$/);
  assert.equal(r.videos.length, 2); assert.equal(r.videos.find((v) => v.id === '2')!.views, 40000, 'yt-dlp completou');
  assert.equal(r.authors.length, 2); assert.equal(r.loginWall, undefined);
  const ig = await searchSocial('instagram', 'pão', { browse: async (_p, url) => ({ url: 'https://www.instagram.com/accounts/login/', text: 'Entre para ver fotos', cards: [] }) });
  assert.equal(ig.loginWall, true); assert.ok(ig.warnings.some((w) => /Entrar no Instagram/.test(w)));
  const kw = await searchSocial('kwai', 'piadas', { browse: async (_p, url) => ({ url, text: '', cards: [{ href: 'https://www.kwai.com/@k/video/1', text: 'piada boa' }] }) });
  assert.ok(kw.warnings.some((w) => /não mostra views/.test(w)), 'sem números visíveis: avisa');
  await assert.rejects(searchSocial('facebook', '  ', { browse: async () => ({ url: '', text: '', cards: [] }) }), /termo/);

  /* ───────── ícones das listas do Novo projeto ───────── */
  assert.equal(kindIcon('Curta cartoon 3D (2D em mundo 3D)'), '🧸');
  assert.equal(kindIcon('Vídeo explicativo de link (navegador + motion graphics)'), '🔗');
  assert.equal(kindIcon('Dorama em código (elenco + vozes)'), '🎎💻', 'variante em código ganha 💻');
  assert.equal(kindIcon('Clipe musical em loop com código (Canvas/WebGL)'), '🎵💻');
  assert.equal(kindIcon('Shorts viral (vertical)'), '📱'); assert.equal(kindIcon('Documentário narrado'), '🎞️'); assert.equal(kindIcon('Anime 2D'), '🌸');
  assert.equal(kindIcon('Stickman'), '🕴️'); assert.equal(kindIcon('Realista / cinematográfico'), '🎥'); assert.equal(kindIcon('Vídeo livre (só o seu prompt)'), '✨');
  assert.equal(kindIcon('Vídeo explicativo com código'), '💡💻'); assert.equal(kindIcon('qualquer coisa'), '');
  assert.equal(skillIcon({ id: 'x', name: 'qualquer', builtin: true }), '🎬'); assert.equal(skillIcon({ id: 'canal-abc', name: 'Minha' }), '🧬');
  assert.equal(skillIcon({ id: 'y', name: 'outra' }), '🧠');
  assert.equal(routeEngines([{ bindings: [{ type: 'comfyui' }] }, { bindings: [{ type: 'api' }] }, { enabled: false, bindings: [{ type: 'flow' }] }]), '🖥️☁️', 'etapa desligada não conta');
  assert.equal(withIcon('🎬', 'Nome'), '🎬  Nome'); assert.equal(withIcon('', 'Nome'), 'Nome');
  /* toda skill e toda rota padrão ganham ícone */
  for (const k of BUILTIN_SKILLS) assert.ok(skillIcon({ ...k, builtin: true }).length > 0, k.name);
  for (const rt of ROUTES) assert.ok(routeIcon(rt).length > 0, rt.name);
  const covered = BUILTIN_SKILLS.filter((k) => kindIcon(k.name, k.id, k.appearance)).length;
  assert.ok(covered / BUILTIN_SKILLS.length >= 0.9, `${covered}/${BUILTIN_SKILLS.length} skills padrão com ícone do tipo; sem: ${BUILTIN_SKILLS.filter((k) => !kindIcon(k.name, k.id, k.appearance)).map((k) => `${k.id} "${k.name}"`).join(', ')}`);

  console.log('social-search: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
