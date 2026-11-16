import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ForgeDb } from '../main/db';
import { channelFavId, insightsToHtml, insightsToText, readFavoriteChannels, removeFavoriteChannels, reportBaseName, toggleFavoriteChannel } from '../main/research-report';
import { flowOriginalUrl, flowRefsText } from '../main/flow';
import { thumbSize } from '../main/thumb-render';
import { headlineFirst, ogImage, preferStyleBindings, styleImagePrompt, thumbCandidates, thumbRefPrompt, thumbStyleImage } from '../main/thumb-ref';
import { GTTS_VOICES, gttsChunks, gttsVoice, providerNeedsKey } from '../main/providers';
import { buildArgs, codexArgs, DEFAULT_HARNESSES } from '../main/harness';
import { addChannel, createdFromClone, CREATED_FILE, defaultThumbTemplateId, registerCreatedChannel, updateChannel } from '../main/channels';
import { favoritesFirst, listRoutes, setFavoriteRoute } from '../main/library';
import { defaultSettings, DEFAULT_GTTS_PROVIDER } from '../main/settings';
import { unusableReason } from '../main/usability';
import type { Settings } from '../shared/types';
import { adoptPlugins, removePlugin, setAppPluginsDir } from '../main/plugins';
import { nativeCodexExe, winExecutable } from '../main/harness';

/** Codex, pesquisa (TXT/PDF, canais favoritos), banco (registros), thumbnail por canal/referência, voz Google sem chave, rotas favoritas. */
async function main() {
  /* ── Codex 0.16x: --full-auto saiu → -s workspace-write ── */
  assert.ok(!DEFAULT_HARNESSES.codex.args.includes('--full-auto'));
  const legacy = { ...DEFAULT_HARNESSES.codex, args: ['exec', '--model', '{model}', '--full-auto', '--skip-git-repo-check', '{prompt}'] };
  assert.deepEqual(codexArgs(legacy), ['exec', '--model', '{model}', '-s', 'workspace-write', '--skip-git-repo-check', '{prompt}']);
  assert.deepEqual(buildArgs(legacy, 'OK', 'gpt-x'), ['exec', '--model', 'gpt-x', '-s', 'workspace-write', '--skip-git-repo-check', 'OK']);
  assert.deepEqual(codexArgs({ ...legacy, args: ['exec', '--full-auto', '--sandbox', 'read-only', '{prompt}'] }), ['exec', '--sandbox', 'read-only', '{prompt}']);
  assert.deepEqual(codexArgs({ ...DEFAULT_HARNESSES.claude }), DEFAULT_HARNESSES.claude.args, 'só mexe no codex');

  /* ── análise da IA → TXT / HTML (PDF) ── */
  const ins = { summary: 'Vídeos curtos <com> números vencem.', trends: ['abelhas'], titlePatterns: ['Número + segredo'], ideas: ['A abelha que faz mel azul', 'Por que as abelhas dançam'], binding: 'harness:claude' };
  const txt = insightsToText(ins, { query: 'abelhas', platform: 'YouTube', videos: 30, at: '2026-11-15T10:00:00Z' });
  assert.match(txt, /ANÁLISE DA IA — "abelhas" · YouTube/);
  assert.match(txt, /RESUMO\r\nVídeos curtos/);
  assert.match(txt, /IDEIAS DE VÍDEO\r\n1\. A abelha que faz mel azul\r\n2\. Por que/);
  assert.match(txt, /30 vídeos analisados/);
  const html = insightsToHtml(ins, { query: 'abelhas' });
  assert.match(html, /&lt;com&gt;/, 'escapa HTML');
  assert.match(html, /<ol><li>A abelha que faz mel azul<\/li>/);
  assert.match(reportBaseName({ query: 'Finanças Pessoais!', at: '2026-11-15T10:05:00' }), /^analise-financas-pessoais-2026-11-15-1005$/);

  /* ── ⭐ canais favoritos ── */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-tt-ws-'));
  const ch = { platform: 'youtube', channel: 'Canal X', channelUrl: 'https://www.youtube.com/@CanalX/', subs: 1200, best: 80 };
  assert.equal(channelFavId(ch), 'https://www.youtube.com/@canalx');
  let favs = toggleFavoriteChannel(ws, { ...ch, query: 'abelhas' });
  assert.equal(favs.length, 1); assert.equal(favs[0]!.query, 'abelhas'); assert.ok(favs[0]!.savedAt);
  assert.equal(readFavoriteChannels(ws).length, 1);
  favs = toggleFavoriteChannel(ws, { platform: 'tiktok', channel: 'Perfil Y' });
  assert.equal(favs.length, 2); assert.equal(favs[0]!.id, 'tiktok:perfil y');
  assert.equal(toggleFavoriteChannel(ws, ch).length, 1, 'clicar de novo tira');
  assert.equal(removeFavoriteChannels(ws, ['tiktok:perfil y']).length, 0);

  /* ── banco: registros (kind + id), sync e soft delete; projeto com título/thumbnail/equipe ── */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-tt-db-'));
  const db = await ForgeDb.open({ root, workspace: ws });
  db.upsertRecord('research_report', 'r1', { title: 'abelhas', data: { a: 1 }, file: path.join(ws, 'finder', 'analyses', 'r1.pdf') });
  assert.equal(db.listRecords('research_report')[0]!.file, 'finder/analyses/r1.pdf');
  db.syncRecords('favorite_channel', [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
  db.syncRecords('favorite_channel', [{ id: 'b', title: 'B2' }]);
  const fc = db.listRecords('favorite_channel');
  assert.deepEqual(fc.map((x) => [x.id, x.title]), [['b', 'B2']]);
  db.deleteRecord('research_report', 'r1');
  assert.equal(db.listRecords('research_report').length, 0);
  assert.ok(db.changesSince(0).some((c) => c['entity'] === 'favorite_channel' && c['op'] === 'delete'));
  const pdir = path.join(ws, 'projects', 'p1'); fs.mkdirSync(pdir, { recursive: true });
  db.indexProject({ id: 'p1', name: 'Projeto', idea: 'x', videoType: 'custom', aspect: '16:9', targetDurationSec: 60, language: 'pt-BR', quality: 'standard', memories: [], scenes: [], createdAt: new Date().toISOString(),
    routeId: 'r', titleModel: { source: 'Novo projeto', pattern: '', chosen: 'O segredo das abelhas', thumbText: 'MEL AZUL' }, thumbnailTemplate: 'v-impacto',
    agents: { workers: [{ id: 'roteirista', name: 'Roteirista', persona: 'Marina', role: 'worker', description: '', instructions: 'x' }] } } as never, pdir);
  const row = (db as unknown as { all: (sql: string) => Array<Record<string, unknown>> }).all(`SELECT title, thumb_text, thumbnail_template, agents_json FROM project WHERE id = 'p1'`)[0]!;
  assert.equal(row['title'], 'O segredo das abelhas'); assert.equal(row['thumb_text'], 'MEL AZUL'); assert.equal(row['thumbnail_template'], 'v-impacto');
  assert.match(String(row['agents_json']), /"persona":"Marina"/);
  db.close();

  /* ── thumbnail: referência (link de vídeo/imagem/página) ── */
  assert.deepEqual(thumbCandidates('https://youtu.be/dQw4w9WgXcQ')[0], 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
  assert.equal(thumbCandidates('https://www.youtube.com/shorts/dQw4w9WgXcQ').length, 3);
  assert.deepEqual(thumbCandidates('https://site.com/a.png?x=1'), ['https://site.com/a.png?x=1']);
  assert.deepEqual(thumbCandidates('https://site.com/pagina'), []);
  assert.equal(ogImage('<meta property="og:image" content="https://x.com/i.jpg?a=1&amp;b=2">'), 'https://x.com/i.jpg?a=1&b=2');
  assert.equal(ogImage('<meta content="https://x.com/t.jpg" name="twitter:image">'), 'https://x.com/t.jpg');
  const rp = thumbRefPrompt({ thumbRef: { file: 'C:/p/assets/user/thumb-reference.jpg', palette: ['#ff0000', '#000000'], note: 'rosto à direita' } });
  assert.match(rp, /FOLLOW THE REFERENCE THUMBNAIL \(thumb-reference\.jpg\)/); assert.match(rp, /#ff0000 #000000/); assert.match(rp, /do NOT copy/);
  assert.equal(thumbRefPrompt({}), '');

  /* ── canal: modelo de thumbnail padrão, do clone e escolhido ── */
  const s = defaultSettings(ws) as Settings;
  s.channels = [];
  const c1 = addChannel(s, { name: 'Doc', platform: 'youtube', type: 'documentario' });
  assert.equal(c1.thumbnailTemplate, 'v-documentario');
  assert.equal(defaultThumbTemplateId({ type: 'tutorial' }), 'v-split');
  updateChannel(s, c1.id, { identity: { thumbStyle: 'minimal' } });
  assert.equal(c1.thumbnailTemplate, 'v-minimal', 'padrão acompanha o estilo');
  updateChannel(s, c1.id, { thumbnailTemplate: 'meu-modelo' });
  updateChannel(s, c1.id, { identity: { thumbStyle: 'impacto' } });
  assert.equal(c1.thumbnailTemplate, 'meu-modelo', 'escolhido não é trocado');
  const cloneDir = path.join(ws, 'channels', 'clone-1'); fs.mkdirSync(cloneDir, { recursive: true });
  const c2 = registerCreatedChannel(s, { name: 'Hadal', handle: '@hadal', channelId: 'UC123', cloneId: 'clone-1', cloneDir, thumbnailTemplate: 'clone-thumb' });
  assert.equal(c2.thumbnailTemplate, 'clone-thumb');
  fs.writeFileSync(path.join(cloneDir, CREATED_FILE), JSON.stringify({ channelId: 'UC123', handle: '@hadal', name: 'Hadal', registeredAs: c2.id }));
  const cr = createdFromClone(s, { id: 'clone-1', dir: cloneDir });
  assert.equal(cr?.handle, '@hadal'); assert.equal(cr?.mine?.id, c2.id); assert.equal(cr?.mine?.thumbnailTemplate, 'clone-thumb');
  assert.equal(createdFromClone(s, { id: 'outro' }), undefined);

  /* ── voz do Google sem chave ── */
  const parts = gttsChunks('Primeira frase curta. ' + 'palavra '.repeat(60) + 'fim.');
  assert.ok(parts.length >= 3 && parts.every((x) => x.length <= 190), 'pedaços de até 190');
  assert.equal(parts[0], 'Primeira frase curta.');
  assert.equal(gttsVoice('en-GB').host, 'translate.google.co.uk');
  assert.equal(gttsVoice('', 'pt-BR').tl, 'pt-BR');
  assert.equal(gttsVoice('', 'es-AR').tl, 'es', 'cai no idioma base');
  assert.ok(Object.keys(GTTS_VOICES).includes('pt-PT'));
  assert.equal(providerNeedsKey({ kind: 'gtts', baseUrl: '' }), false);
  assert.equal(providerNeedsKey({ kind: 'openai', baseUrl: 'http://localhost:1234/v1' }), false);
  assert.equal(providerNeedsKey({ kind: 'openai', baseUrl: 'https://api.openai.com/v1' }), true);
  assert.equal(providerNeedsKey({ kind: 'fish', baseUrl: '' }), true);
  assert.ok(s.providers.some((p) => p.kind === 'gtts'), 'vem nas configurações padrão');
  assert.equal(await unusableReason({ ...s, providers: [DEFAULT_GTTS_PROVIDER] }, { type: 'api', provider: 'google-gratis', model: 'google-tradutor', voice: 'pt-BR' }), undefined, 'sem chave e utilizável');

  /* ── rotas favoritas ── */
  const all = listRoutes(s);
  const last = all[all.length - 1]!.id;
  setFavoriteRoute(s, last, true);
  const fr = listRoutes(s);
  assert.equal(fr[0]!.id, last); assert.equal(fr[0]!.favorite, true);
  assert.equal(fr.filter((r) => r.favorite).length, 1);
  setFavoriteRoute(s, last, false);
  assert.equal(s.favoriteRoutes, undefined);
  assert.notEqual(listRoutes(s)[0]!.id, last);
  assert.deepEqual(favoritesFirst([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c']).map((x) => x.id), ['c', 'a', 'b']);

  /* ── Codex no Windows: o where lista o script sem extensão antes do .cmd; o codex.exe nativo do pacote npm ── */
  assert.equal(winExecutable(['C:/n/codex', 'C:/n/codex.cmd']), 'C:/n/codex.cmd');
  const npm = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-npm-'));
  const exe = path.join(npm, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, '');
  assert.equal(nativeCodexExe([npm]), exe);
  assert.equal(nativeCodexExe([ws]), undefined);

  /* ── plugins: pasta de cada pacote → os de versões anteriores vêm junto; removidos não voltam ── */
  const oldDir = path.join(ws, 'old-plugins'), newDir = path.join(ws, 'new-plugins');
  for (const n of ['meu-plugin', 'tirado', '_deps', 'Pasta Estranha']) fs.mkdirSync(path.join(oldDir, n, '.claude-plugin'), { recursive: true });
  assert.deepEqual(adoptPlugins(oldDir, newDir, ['tirado']).sort(), ['_deps', 'meu-plugin']);
  setAppPluginsDir(newDir);
  const sp = { ...s } as Settings;
  removePlugin(sp, 'meu-plugin');
  assert.deepEqual(sp.removedPlugins, ['meu-plugin']);
  assert.deepEqual(adoptPlugins(oldDir, newDir, [...sp.removedPlugins!, 'tirado']), [], 'removido não volta');
  setAppPluginsDir(undefined);
  fs.rmSync(npm, { recursive: true, force: true });

  /* ── modelo de thumbnail: imagem do estilo, pedido e rota Flow → Z-Image ── */
  {
    const tw = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-style-'));
    const clone = path.join(tw, 'channels', 'clone-x'); fs.mkdirSync(clone, { recursive: true });
    fs.writeFileSync(path.join(clone, 'thumb.png'), 'x');
    fs.writeFileSync(path.join(clone, 'result.json'), JSON.stringify({ thumbnailTemplate: { id: 'm1' } }));
    const st = { workspace: tw, thumbnails: [{ id: 'm1', name: 'M', preview: './thumb.png' }], channels: [{ id: 'c1', thumbnailTemplate: 'm1' }] } as unknown as Settings;
    assert.equal(thumbStyleImage(st, { channelId: 'c1' } as never), path.join(clone, 'thumb.png'), 'modelo do canal → imagem do clone');
    assert.equal(thumbStyleImage(st, { thumbnailTemplate: 'm1' } as never), path.join(clone, 'thumb.png'));
    assert.equal(thumbStyleImage(st, {} as never), undefined, 'sem modelo → nada');
    const own = path.join(tw, 'ref.jpg'); fs.writeFileSync(own, 'x');
    assert.equal(thumbStyleImage(st, { thumbRef: { file: own }, thumbnailTemplate: 'm1' } as never), own, 'referência do projeto vence');
    const pud = path.join(tw, 'projects', 'p1', 'assets', 'user'); fs.mkdirSync(pud, { recursive: true });
    fs.writeFileSync(path.join(pud, 'thumb-reference.jpg'), 'x');
    assert.equal(thumbStyleImage(st, { id: 'p1', thumbRef: { file: 'Z:/sumiu/thumb-reference.jpg' }, thumbnailTemplate: 'm1' } as never), path.join(pud, 'thumb-reference.jpg'), 'projeto movido: acha a cópia na pasta do projeto');
    assert.match(styleImagePrompt('ELE SABIA', false), /write ONLY the headline "ELE SABIA"/);
    assert.match(headlineFirst('ELE SABIA'), /^YouTube thumbnail with the headline text "ELE SABIA" written in the image/, 'o gerador escreve o texto (ordem no início)');
    assert.match(headlineFirst('ELE SABIA', 1), /previous image had no text[\s\S]*MUST be clearly readable/, 'nova tentativa reforça o texto');
    assert.match(flowRefsText([{ name: 'MODELO DA THUMBNAIL (copie o estilo)' }, { name: 'Ana' }]), /imagem 1 anexada é o MODELO DE ESTILO[\s\S]*imagem 2 = Ana/);
    assert.doesNotMatch(styleImagePrompt('ELE SABIA', true), /ELE SABIA/, 'texto por código → a IA não escreve');
    const r = preferStyleBindings({ id: 'r', name: 'r', steps: [{ id: 't', kind: 'thumbnail', bindings: [{ type: 'comfyui', server: 'local', workflow: 'krea2-turbo-t2i.json' }, { type: 'flow' }] }] } as never);
    assert.deepEqual(r.steps[0]!.bindings.map((b: { type: string; workflow?: string }) => b.workflow ?? b.type), ['flow', 'z-image-turbo-t2i.json', 'krea2-turbo-t2i.json']);
    fs.rmSync(tw, { recursive: true, force: true });
    assert.equal(flowOriginalUrl('https://flow.google.com/asb/ABC_d-e=s1600-rw'), 'https://flow.google.com/asb/ABC_d-e=s0', 'Flow: original, não a prévia');
    assert.equal(flowOriginalUrl('https://flow-content.google/image/x?Expires=1'), 'https://flow-content.google/image/x?Expires=1');
    assert.deepEqual(thumbSize('9:16'), { w: 1280, h: 720 }, 'thumbnail sempre 16:9, mesmo em vídeo vertical');
  }

  fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  console.log('title-thumb tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
