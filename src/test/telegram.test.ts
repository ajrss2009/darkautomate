import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TelegramConfig } from '../shared/types';
import { createProject, defaultSettings } from '../main/settings';
import { TelegramBot, batchLines, parseCommand, type TelegramDeps } from '../main/telegram';
import { assistantPrompt, assistantReply, forgetIntent, forgetMemory, listMemories, readHistory, rememberIntent, saveMemory } from '../main/assistant';
import { expandTargets } from '../main/channel-publish';
import { socialCaption } from '../main/social-upload';
import { editParamsFromRef, editRhythm, measureEditRhythm, parseCutTimes, rhythmText } from '../main/references';
import { referenceText } from '../main/prompts';
import { autoMotion } from '../main/executors';

/**
 * TELEGRAM + ASSISTENTE + PUBLICAÇÃO EM VÁRIAS REDES + RITMO DO VÍDEO DE REFERÊNCIA.
 * O bot roda contra um fetch falso (nenhuma chamada sai para a internet).
 */
async function main() {
  /* ── comandos ── */
  assert.deepEqual(parseCommand('/novo@MeuBot um vídeo sobre Marte'), { cmd: 'novo', args: 'um vídeo sobre Marte' });
  assert.deepEqual(parseCommand('como está?'), { args: 'como está?' });
  assert.equal(parseCommand('/lote\nideia A\nideia B').args, 'ideia A\nideia B');
  assert.deepEqual(batchLines('1. Buracos negros explicados\n- Nome | A ideia longa | doc-skill\nx'), [
    { name: 'Buracos negros explicados', idea: 'Buracos negros explicados' },
    { name: 'Nome', idea: 'A ideia longa', skillId: 'doc-skill' },
  ]);

  /* ── bot com fetch falso ── */
  let cfg: TelegramConfig = { enabled: true, token: '1:abc', allowChats: [10], notify: true, approveStoryboards: true, defaultSkill: 'sk' };
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fakeFetch = (async (url: string, init: { body?: unknown }) => {
    const method = String(url).split('/').pop()!;
    calls.push({ method, body: typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {} });
    return { status: 200, json: async () => ({ ok: true, result: method === 'getUpdates' ? [] : {} }) } as Response;
  }) as unknown as typeof fetch;
  const created: string[] = []; const ran: string[] = []; const batches: string[][] = []; const approved: Array<[string, boolean]> = [];
  const deps: TelegramDeps = {
    config: () => cfg, saveConfig: (c) => { cfg = c; },
    rows: async () => [{ id: 'p1', name: 'Marte', status: 'running', progress: '3/9' }, { id: 'p2', name: 'Lua', status: 'pronto' }],
    createProject: (o) => { const id = `id${created.length + 1}`; created.push(`${o.name}|${o.skillId}`); return { id, name: o.name }; },
    runProject: (id) => ran.push(id), runBatch: (ids) => batches.push(ids),
    approve: (id, ok) => { approved.push([id, ok]); return id === 'p1'; },
    storyboardPng: async () => undefined,
    assistant: async (conv, text) => `eco(${conv}): ${text}`,
    log: () => {}, fetch: fakeFetch,
  };
  const bot = new TelegramBot(deps);
  const msg = (chat: number, text: string, id = 1) => ({ update_id: id, message: { chat: { id: chat, first_name: 'Ana' }, text } });
  const last = () => String(calls[calls.length - 1]?.body.text ?? '');

  /* chat desconhecido: não comanda nada e fica pendente */
  await bot.handle(msg(99, '/novo hack'));
  assert.equal(created.length, 0);
  assert.equal(cfg.pending?.[0]?.chatId, 99);
  assert.match(last(), /não está autorizado/);

  await bot.handle(msg(10, '/status'));
  assert.match(last(), /Marte \(p1\) — 3\/9/);
  assert.doesNotMatch(last(), /Lua/);
  await bot.handle(msg(10, '/novo Vídeo sobre vulcões'));
  assert.deepEqual(created, ['Vídeo sobre vulcões|sk']);
  assert.deepEqual(ran, ['id1']);
  await bot.handle(msg(10, '/lote\nIdeia um\nNome dois | ideia dois | outra'));
  assert.deepEqual(batches, [['id2', 'id3']]);
  assert.deepEqual(created.slice(1), ['Ideia um|sk', 'Nome dois|outra']);
  await bot.handle(msg(10, 'oi, tudo certo?'));
  assert.equal(last(), 'eco(telegram-10): oi, tudo certo?');
  await bot.handle(msg(10, '/aprovar p1'));
  assert.match(last(), /aprovado/);
  /* botão ✅ do storyboard → approve(id, true) */
  await bot.handle({ update_id: 9, callback_query: { id: 'cq', data: 'no:p1', message: { chat: { id: 10 }, message_id: 5 } } });
  assert.deepEqual(approved, [['p1', true], ['p1', false]]);
  assert.ok(calls.some((c) => c.method === 'answerCallbackQuery'));
  /* callback de chat não autorizado é ignorado */
  await bot.handle({ update_id: 10, callback_query: { id: 'x', data: 'ok:p1', message: { chat: { id: 99 }, message_id: 1 } } });
  assert.equal(approved.length, 2);
  /* aviso de execução só com o bot ligado */
  const before = calls.length;
  await bot.notifyRun({ id: 'p1', name: 'Marte', ok: false, error: 'falhou X' });
  assert.equal(calls.length, before, 'bot parado não avisa');
  console.log('✓ telegram: comandos, allowlist, lote, aprovação por botão e assistente');

  /* ── assistente com memória (portátil, em workspace/assistant) ── */
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tg-'));
  const s = defaultSettings(ws);
  assert.equal(rememberIntent('Lembre que eu prefiro vídeos de 60 s'), 'eu prefiro vídeos de 60 s');
  assert.equal(rememberIntent('como está o projeto?'), undefined);
  assert.equal(forgetIntent('esqueça eu-prefiro'), 'eu-prefiro');
  const r1 = await assistantReply(s, 'app', 'lembre que o canal fala de astronomia', { projects: '' });
  assert.match(r1, /Anotado/);
  const mems = listMemories(s);
  assert.equal(mems.length, 1);
  assert.ok(fs.existsSync(path.join(ws, 'assistant', 'memory', `${mems[0]!.name}.json`)));
  saveMemory(s, { content: 'thumbnails amarelas', type: 'feedback', name: 'thumbs' });
  assert.match(await assistantReply(s, 'app', 'memórias', { projects: '' }), /thumbs: thumbnails amarelas/);
  assert.equal(readHistory(s, 'app').length, 4);
  const prompt = assistantPrompt(listMemories(s), { projects: '- Marte (p1): rodando' }, readHistory(s, 'app'), 'e agora?');
  assert.match(prompt, /\[feedback\] thumbs/);
  assert.match(prompt, /Marte \(p1\): rodando/);
  assert.ok(forgetMemory(s, 'thumbs'));
  assert.equal(listMemories(s).length, 1);
  console.log('✓ assistente: lembrar/esquecer/listar sem modelo, histórico e prompt com memórias + projetos');

  /* ── publicação em várias redes ── */
  const chans = [{ id: 'yt', linked: ['tt', 'ig', 'sumiu'] }, { id: 'tt' }, { id: 'ig' }, { id: 'fb' }];
  assert.deepEqual(expandTargets(chans, ['yt']), ['yt', 'tt', 'ig']);
  assert.deepEqual(expandTargets(chans, ['fb', 'yt', 'tt']), ['fb', 'yt', 'tt', 'ig']);
  assert.deepEqual(expandTargets(chans, ['nao-existe']), []);
  const cap = socialCaption('kwai', { title: 'Marte em 60 s', description: 'Primeiro parágrafo.\n\n00:00 capítulos\nhttps://link', tags: ['Marte', '#espaço', 'a b'] });
  assert.equal(cap, 'Marte em 60 s\n\nPrimeiro parágrafo.\n\n#Marte #espaço #ab');
  assert.ok(socialCaption('kwai', { title: 'x'.repeat(2000) }).length <= 1000);
  const pp = createProject(s, { name: 'Multi', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot', publishTargets: ['yt', 'tt'], publishVisibility: 'PUBLIC' });
  const pub = pp.route?.steps.find((st) => st.id === 'publish');
  assert.deepEqual(pp.publishTargets, ['yt', 'tt']);
  assert.equal((pub?.bindings[0] as { tool?: string }).tool, 'social-publish');
  assert.deepEqual(pub?.params, { targets: ['yt', 'tt'], visibility: 'PUBLIC' });
  assert.ok(!pp.route?.steps.some((st) => st.id === 'upload'), 'sem a etapa antiga de só YouTube');
  console.log('✓ publicar em: canal + perfis ligados, sem repetir; legenda por rede; etapa social-publish na rota');

  /* ── ritmo de edição do vídeo de referência ── */
  assert.deepEqual(parseCutTimes('frame:0 pts:60 pts_time:2.0\nlavfi.scene_score=0.9\nframe:1 pts:62 pts_time:2.05\nframe:2 pts:120 pts_time:4'), [2, 4]);
  const fast = editRhythm([1, 2, 3, 4, 5], 6, 0)!;
  assert.deepEqual(fast, { cuts: 5, shotSec: 1, cutsPerMin: 50, fades: 0, transition: 'none' });
  assert.equal(editRhythm([10, 20], 30, 0)!.transition, 'fade');
  assert.equal(editRhythm([2, 4, 6], 8, 3)!.transition, 'fadeblack');
  assert.equal(editRhythm([], 0, 0), undefined);
  /* a transição da referência vence o padrão da rota; a cena que define a sua continua valendo */
  const pr = { refVideo: { file: 'r.mp4', frames: [], edit: fast } };
  assert.equal(editParamsFromRef(pr, { defaultTransition: 'fade', autoMotion: true }).defaultTransition, 'none');
  assert.deepEqual(editParamsFromRef({}, { a: 1 }), { a: 1 });
  const scene = { id: 's1', index: 1, kind: 'image', effects: { transition: 'wipeleft' } } as never;
  assert.equal(autoMotion(scene, editParamsFromRef(pr, {}))?.transition, 'wipeleft');
  assert.equal(autoMotion({ id: 's2', index: 2, kind: 'image' } as never, editParamsFromRef({ refVideo: { file: 'r', frames: [], edit: editRhythm([10], 20, 0)! } }, {}))?.transition, 'fade');
  assert.match(rhythmText(fast), /plano médio de ≈ 1 s .*cortes secos/);
  assert.match(referenceText({ refVideo: pr.refVideo } as never, 'scene_plan'), /RITMO DE EDIÇÃO/);
  assert.doesNotMatch(referenceText({ refVideo: pr.refVideo } as never, 'thumbnail'), /RITMO DE EDIÇÃO/);
  /* medição real: 3 blocos de cor = 2 cortes */
  const bundled = path.resolve('tools/ffmpeg/win/ffmpeg.exe');
  const FF = fs.existsSync(bundled) ? bundled : 'ffmpeg';
  let ffOk = true;
  try { execFileSync(FF, ['-version'], { stdio: 'ignore' }); } catch { ffOk = false; }
  if (ffOk) {
    const v = path.join(ws, 'cuts.mp4');
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=2:r=30', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=2:r=30', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:d=2:r=30',
      '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0', '-pix_fmt', 'yuv420p', v], { stdio: 'ignore' });
    const m = await measureEditRhythm(FF, v, 6, ws, new AbortController().signal);
    assert.equal(m?.cuts, 2, JSON.stringify(m));
    assert.equal(m?.shotSec, 2);
    assert.equal(m?.transition, 'none');
    console.log('✓ ritmo medido com ffmpeg: 2 cortes, plano de 2 s');
  } else console.log('… ffmpeg ausente: medição real pulada');
  console.log('✓ ritmo da referência: entra no plano de cenas e nas transições da montagem');
  fs.rmSync(ws, { recursive: true, force: true });
}

main().then(() => console.log('telegram.test OK')).catch((e) => { console.error(e); process.exit(1); });
