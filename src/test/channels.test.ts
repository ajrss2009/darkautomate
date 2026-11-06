import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MAX_CHANNELS, PLATFORM_INFO, addChannel, appendPublish, channelDir, config,
  getChannel, listChannels, listChannelProjects, readPublish, removeChannel, saveBrand, setAsset, updateChannel,
} from '../main/channels';
import { PLATFORM_ADAPTERS, readyPlatforms } from '../main/channel-publish';
import type { Settings } from '../shared/types';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-channels-'));
  const projectsDir = path.join(ws, 'projects');
  const s = { workspace: ws, projectsDir } as Settings;

  /* ───────── criação e ids ───────── */
  assert.equal(config(s).length, 0, 'começa vazio');
  const a = addChannel(s, { name: ' Meu Canal ', platform: 'youtube' });
  assert.equal(a.id, 'ch1');
  assert.equal(a.name, 'Meu Canal', 'nome aparado');
  assert.ok(fs.existsSync(channelDir(s, a.id)), 'pasta do canal criada');
  const b = addChannel(s, { name: 'Outro', platform: 'tiktok' });
  assert.equal(b.id, 'ch2', 'ids incrementais');

  assert.throws(() => addChannel(s, { name: '', platform: 'youtube' }), /nome/, 'nome é obrigatório');
  assert.throws(() => addChannel(s, { name: 'x', platform: 'orkut' as never }), /plataforma/, 'plataforma validada');
  assert.throws(() => channelDir(s, '../etc'), /inválido/, 'id validado contra path traversal');
  assert.throws(() => channelDir(s, 'ch1x'), /inválido/);

  /* ───────── atualização ───────── */
  const up = updateChannel(s, a.id, { name: 'Renomeado', handle: '@renomeado', accountId: 'g1' });
  assert.equal(up.name, 'Renomeado');
  assert.equal(up.handle, '@renomeado');
  assert.equal(up.accountId, 'g1');
  updateChannel(s, a.id, { accountId: '' });
  assert.equal(getChannel(s, a.id).accountId, undefined, 'conta vazia limpa o vínculo');
  assert.throws(() => updateChannel(s, 'ch99', { name: 'x' }), /não encontrado/);

  /* ───────── marca ───────── */
  saveBrand(s, a.id, { names: ['Marcado'], handle: '@marca', colors: ['#7c5cff'], tagline: 'tag' });
  const brandFile = path.join(channelDir(s, a.id), 'brand.json');
  assert.ok(fs.existsSync(brandFile), 'brand.json gravado na pasta do canal');
  const onDisk = JSON.parse(fs.readFileSync(brandFile, 'utf8')) as { names?: string[] };
  assert.deepEqual(onDisk.names, ['Marcado']);
  assert.equal(getChannel(s, a.id).handle, '@renomeado', 'handle já definido não é sobrescrito pela marca');
  /* sem handle ainda, a marca preenche */
  updateChannel(s, a.id, { handle: '' });
  saveBrand(s, a.id, { names: ['Marcado'], handle: '@marca' });
  assert.equal(getChannel(s, a.id).handle, '@marca', 'handle preenchido a partir da marca quando vazio');

  /* ───────── assets ───────── */
  const bannerAbs = path.join(channelDir(s, a.id), 'banner.png');
  fs.writeFileSync(bannerAbs, 'x');
  setAsset(s, a.id, 'banner', bannerAbs);
  assert.equal(getChannel(s, a.id).assets?.banner, 'banner.png', 'asset guardado relativo à pasta do canal');
  const view = listChannels(s).find((x) => x.id === a.id)!;
  assert.equal(view.hasAssets.banner, true, 'listagem detecta o arquivo existente');
  assert.equal(view.hasAssets.avatar, false);

  /* ───────── publicações: array e retrocompat do objeto único ───────── */
  const pd = path.join(projectsDir, 'p1');
  fs.mkdirSync(path.join(pd, 'out'), { recursive: true });

  /* formato antigo (objeto único) */
  fs.writeFileSync(path.join(pd, 'out', 'publish.json'), JSON.stringify({ platform: 'youtube', url: 'https://y/1', at: '2026-01-01' }));
  const old = readPublish(pd);
  assert.equal(old.length, 1, 'objeto único antigo vira lista de um');
  assert.equal(old[0]!.url, 'https://y/1');

  /* gravação nova acumula */
  appendPublish(pd, { platform: 'youtube', channelId: 'ch1', url: 'https://y/2', at: '2026-02-01' });
  appendPublish(pd, { platform: 'tiktok', channelId: 'ch2', url: 'https://t/1', at: '2026-03-01' });
  const list = readPublish(pd);
  assert.equal(list.length, 2, 'substitui o mesmo canal+plataforma e acumula os outros');
  assert.ok(list.some((r) => r.platform === 'tiktok'));

  /* republicar o mesmo canal substitui, não duplica */
  appendPublish(pd, { platform: 'youtube', channelId: 'ch1', url: 'https://y/3', at: '2026-04-01' });
  const yt = readPublish(pd).filter((r) => r.platform === 'youtube');
  assert.equal(yt.length, 1, 'um registro por canal+plataforma');
  assert.equal(yt[0]!.url, 'https://y/3', 'o mais recente vence');

  /* arquivo ausente ou corrompido não explode */
  assert.deepEqual(readPublish(path.join(ws, 'nao-existe')), []);
  fs.writeFileSync(path.join(pd, 'out', 'publish.json'), 'nao é json');
  assert.deepEqual(readPublish(pd), [], 'json inválido devolve vazio');

  /* ───────── projetos do canal ───────── */
  fs.writeFileSync(path.join(pd, 'project.json'), JSON.stringify({ id: 'p1', name: 'Projeto Um', createdAt: '2026-01-01', channelId: a.id }));
  fs.writeFileSync(path.join(pd, 'out', 'final.mp4'), 'x');
  const other = path.join(projectsDir, 'p2');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'project.json'), JSON.stringify({ id: 'p2', name: 'Projeto Dois', createdAt: '2026-02-01', channelId: b.id }));
  /* projeto de outro programa: sem id/nome não deve quebrar a leitura */
  const foreign = path.join(projectsDir, 'p3');
  fs.mkdirSync(foreign, { recursive: true });
  fs.writeFileSync(path.join(foreign, 'project.json'), JSON.stringify({ project: { name: 'x' }, scenes: [] }));

  const mine = listChannelProjects(s, a.id);
  assert.equal(mine.length, 1, 'só os projetos do canal');
  assert.equal(mine[0]!.name, 'Projeto Um');
  assert.equal(mine[0]!.hasVideo, true, 'detecta o vídeo final');
  assert.equal(listChannels(s).find((x) => x.id === a.id)!.projects, 1, 'contagem por canal');

  /* ───────── limite ───────── */
  while (config(s).length < MAX_CHANNELS) addChannel(s, { name: `c${config(s).length}`, platform: 'youtube' });
  assert.throws(() => addChannel(s, { name: 'excedente', platform: 'youtube' }), new RegExp(String(MAX_CHANNELS)), 'limite de canais');

  /* ───────── remoção ───────── */
  const removedDir = removeChannel(s, a.id);
  assert.ok(removedDir.includes(a.id), 'devolve a pasta (mantida no disco)');
  assert.ok(!config(s).some((x) => x.id === a.id), 'saiu da lista');
  assert.ok(fs.existsSync(removedDir), 'a pasta não é apagada junto');
  assert.throws(() => getChannel(s, a.id), /não encontrado/);

  /* ───────── adaptadores ───────── */
  assert.deepEqual(readyPlatforms(), ['youtube'], 'só o YouTube está pronto nesta versão');
  assert.equal(PLATFORM_ADAPTERS.tiktok.ready, false);
  assert.ok(PLATFORM_INFO.youtube.loginUrl.startsWith('https://'), 'cada plataforma tem URL de login');
  for (const p of ['youtube', 'tiktok', 'instagram', 'facebook'] as const) assert.ok(PLATFORM_INFO[p], `info de ${p}`);
  await assert.rejects(PLATFORM_ADAPTERS.instagram.upload({} as never), /não implementada/, 'adaptador pendente falha com mensagem clara');

  fs.rmSync(ws, { recursive: true, force: true });
  console.log('channels (cadastro, marca, publicações, projetos, adaptadores) tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
