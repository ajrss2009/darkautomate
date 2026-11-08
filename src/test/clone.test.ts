import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyDnaToSkill, contactSheet, cutMetrics, measureVideo, normalizeDna, normalizeLanguages, pickVideos, speechMetrics } from '../main/channel-dna';
import { CLONE_KIND, LocalCloneStore } from '../main/clone-store';
import type { ChannelCloneResult } from '../main/channel-clone';
import type { Skill } from '../shared/types';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-clone-'));

  // ───────── escolha dos vídeos: o que funcionou + o estilo atual, mínimo 3, formato dominante
  const entries = [
    { id: 'r1', title: 'recente 1', view_count: 1000, duration: 600 }, { id: 'r2', title: 'recente 2', view_count: 1200, duration: 620 },
    { id: 'hit', title: 'viral', view_count: 90000, duration: 640 }, { id: 'ok', title: 'bom', view_count: 20000, duration: 610 },
    { id: 'sh', title: 'short', view_count: 500000, duration: 40 }, { id: 'r3', title: 'recente 3', view_count: 900, duration: 590 },
  ];
  const p = pickVideos(entries, 1);
  assert.equal(p.length, 3, 'mínimo 3 vídeos');
  assert.equal(p[0]!.id, 'hit', 'o mais performático primeiro');
  assert.match(p[0]!.reason, /mediana/);
  assert.ok(!p.some((x) => x.id === 'sh'), 'canal de vídeos longos: o Short não entra');
  assert.ok(p.some((x) => x.reason.startsWith('recente')), 'inclui o estilo atual (recente)');
  assert.equal(pickVideos(entries, 99).length, 5, 'máximo limitado ao que existe no formato');

  // ───────── métricas puras
  assert.deepEqual(cutMetrics([2, 4, 6, 8], 10), { shots: 5, avgShotSec: 2, cutsPerMin: 24, jumpCutShare: 0, shotStdSec: 0 });
  const sp = speechMetrics('Você sabia disso? Eu também não sabia. Vamos ver agora como funciona tudo.', 6);
  assert.equal(sp.words, 13);
  assert.equal(sp.wpm, 130);
  assert.equal(sp.questions, 1);
  assert.ok((sp.secondPerson ?? 0) > 0, 'conta a 2ª pessoa');
  assert.ok(sp.hook?.startsWith('Você sabia'));

  // ───────── vídeo real (ffmpeg embutido): cortes detectados e folha de contato
  const ffmpeg = path.join(__dirname, '..', '..', 'tools', 'ffmpeg', 'win', 'ffmpeg.exe');
  const ffprobe = path.join(__dirname, '..', '..', 'tools', 'ffmpeg', 'win', 'ffprobe.exe');
  if (fs.existsSync(ffmpeg)) {
    const vid = path.join(ws, 'v.mp4');
    /* 4 planos de 2 s com cores bem diferentes = 3 cortes */
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=2', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:d=2', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=2',
      '-filter_complex', '[0][1][2][3]concat=n=4:v=1[v]', '-map', '[v]', '-r', '25', '-pix_fmt', 'yuv420p', vid]);
    const mm = await measureVideo(ffmpeg, ffprobe, vid, 'Uma frase. Outra frase aqui.');
    assert.equal(mm.durationSec, 8);
    assert.equal(mm.shots, 4, `4 planos detectados (veio ${mm.shots})`);
    assert.equal(mm.avgShotSec, 2);
    const sheet = await contactSheet(ffmpeg, vid, 8, path.join(ws, 'sheets', 'v.jpg'));
    assert.ok(sheet && fs.statSync(sheet).size > 1000, 'folha de contato gerada');
  } else console.log('(sem ffmpeg embutido: medição de vídeo pulada)');

  // ───────── DNA e idiomas normalizados
  const dna = normalizeDna({ visual: { style: '2D chapado', palette: ['#112233', 'vermelho', '#ffcc00'] }, camera: { shots: '60% close' }, script: { hook: 'pergunta absurda', structure: ['gancho', 'contexto', 'virada'] },
    titles: { formula: '[número] + [segredo]' }, thumbnail: { focal: 'rosto à direita', avoid: ['texto longo'] }, lixo: { x: 1 } });
  assert.deepEqual(dna.visual?.palette, ['#112233', '#ffcc00'], 'só cores em hex');
  assert.equal(dna.script?.structure?.length, 3);
  const langs = normalizeLanguages([{ code: 'en', score: 9 }, { code: 'pt-BR', score: 7.5, why: 'público grande' }, { code: 'EN', score: 3 }, { code: 'es', score: 15 }, { foo: 1 }]);
  assert.deepEqual(langs.map((l) => l.code), ['es', 'en', 'pt-BR'], 'ordenado, sem repetidos, nota limitada a 10');
  assert.equal(langs[0]!.score, 10);

  // ───────── DNA gravado na skill (blocos marcados, idempotente)
  const sk: Skill = { id: 'k', name: 'K', description: '', global: 'regra minha', steps: { script: 'texto meu' } };
  const once = applyDnaToSkill(sk, dna, { avgShotSec: 2.5, cutsPerMin: 24, wpm: 160, wordsPerSentence: 9 }, { summary: '10 títulos · 48 caracteres', examples: ['A', 'B'] } as never, 'Canal X');
  const twice = applyDnaToSkill(once, dna, { avgShotSec: 2.5, cutsPerMin: 24, wpm: 160, wordsPerSentence: 9 }, undefined, 'Canal X');
  assert.match(once.global, /regra minha[\s\S]*plano médio de 2.5 s/);
  assert.match(once.steps['script']!, /texto meu[\s\S]*pergunta absurda[\s\S]*160 palavras\/min/);
  assert.match(once.steps['scene_plan']!, /corta a cada ≈ 2.5 s[\s\S]*cada cena tem ≈ 8 s[\s\S]*NÃO uma cena por corte/, 'plano ≠ cena: cenas de 2–4 planos');
  assert.match(once.steps['code_scene']!, /mude o enquadramento a cada ≈ 2.5 s/, 'cortes dentro da cena');
  assert.match(once.steps['code_scene']!, /2D chapado/);
  assert.match(once.steps['thumbnail']!, /rosto à direita/);
  assert.match(once.steps['metadata']!, /\[número\] \+ \[segredo\][\s\S]*48 caracteres/);
  assert.equal((twice.steps['script']!.match(/dna:start/g) ?? []).length, 1, 'reaplicar não duplica o bloco');

  // ───────── falhas que não mudam tentando de novo vão direto ao próximo executor
  const { isPersistentFailure } = await import('../main/engine');
  assert.ok(!isPersistentFailure('timeout (900s)', { type: 'harness', harness: 'opencode' }, 1), 'timeout de agente: 1 nova rodada (continua do que gravou)');
  assert.ok(isPersistentFailure('timeout (900s)', { type: 'harness', harness: 'opencode' }, 2), '2º timeout do agente: vai para a reserva');
  assert.ok(isPersistentFailure('timeout (900s)', { type: 'harness', harness: 'ollama' }, 1, { harnesses: { ollama: { command: 'http://127.0.0.1:11434' } } } as never), 'harness HTTP: sem repetir');
  assert.ok(isPersistentFailure('timeout (900s)', { type: 'api', provider: 'x', model: 'm' } as never), 'API: sem repetir');
  assert.ok(!isPersistentFailure('timeout (900s)', { type: 'comfyui', server: 'local', workflow: 'x.json' }), 'GPU local: repete (fila/VRAM passam)');
  assert.ok(isPersistentFailure('antigravity: error: invalid model selection (--model "x")', { type: 'harness', harness: 'antigravity' }));
  assert.ok(!isPersistentFailure('a cena lançou erro em seek', { type: 'harness', harness: 'claude' }), 'erro de conteúdo: repete');
  const { agyAvailableModels } = await import('../main/kit-exec');
  assert.deepEqual(agyAvailableModels('error: invalid model\nAvailable models:\n  Gemini 3.8 Flash (High)\n  Gemini 3.8 Flash (Medium)\n  Claude Sonnet 4.6 (Thinking)\n'), ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'claude-sonnet-4.6-thinking']);

  // ───────── armazenamento: relativo, portátil, revisão e pacote
  const root = path.join(ws, 'channels');
  const store = new LocalCloneStore(root, '9.9');
  const dir = path.join(root, 'canal-x-1');
  fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'thumbs', '01.jpg'), 'img');
  const rec = { id: 'canal-x-1', dir, createdAt: new Date().toISOString(), source: { url: 'https://youtube.com/@x', name: 'X' }, metrics: {} as never,
    recent: [{ id: 'a', title: 't', thumb: path.join(dir, 'thumbs', '01.jpg') }], analysis: {}, bends: [], chosenBend: 0, brand: {}, skill: { id: 'k', name: 'K' } as never, route: { id: 'r' } as never,
    files: {}, warnings: [], dna } as unknown as ChannelCloneResult;
  const s1 = store.save(rec);
  assert.equal(s1.meta?.schemaVersion, 2);
  assert.equal(s1.meta?.kind, CLONE_KIND);
  assert.equal(s1.meta?.sync.rev, 1);
  const json = fs.readFileSync(path.join(dir, 'result.json'), 'utf8');
  assert.ok(json.includes('"./thumbs/01.jpg"') && !json.includes(ws.replace(/\\/g, '\\\\')), 'caminhos gravados relativos');
  assert.equal(store.get('canal-x-1')!.recent[0]!.thumb, path.join(dir, 'thumbs', '01.jpg'), 'lido como absoluto');
  assert.equal(store.save(store.get('canal-x-1')!).meta?.sync.rev, 2, 'revisão sobe a cada gravação');
  /* pasta movida para outro disco/PC: continua abrindo, com os caminhos novos */
  const moved = path.join(ws, 'outro-pc', 'channels');
  fs.cpSync(root, moved, { recursive: true });
  const m2 = new LocalCloneStore(moved).get('canal-x-1')!;
  assert.equal(m2.recent[0]!.thumb, path.join(moved, 'canal-x-1', 'thumbs', '01.jpg'));
  assert.ok(fs.existsSync(m2.recent[0]!.thumb!));
  /* pacote .ffclone: exporta (sem vídeos baixados) e importa com id novo se já existir */
  fs.mkdirSync(path.join(dir, 'videos'), { recursive: true }); fs.writeFileSync(path.join(dir, 'videos', 'grande.mp4'), 'x');
  const pkg = store.exportPackage('canal-x-1', path.join(ws, 'pacote.ffclone'));
  assert.ok(fs.statSync(pkg).size > 100);
  const imp = store.importPackage(pkg);
  assert.equal(imp.id, 'canal-x-1-2', 'id novo quando já existe');
  assert.ok(!fs.existsSync(path.join(root, 'canal-x-1-2', 'videos')), 'vídeos baixados não vão no pacote');
  assert.ok(fs.existsSync(imp.recent[0]!.thumb!), 'imagens vieram junto');
  assert.equal(imp.dna?.visual?.style, '2D chapado', 'DNA preservado');
  assert.equal(store.list().length, 2);
  store.remove('canal-x-1-2');
  assert.equal(store.list().length, 1);

  fs.rmSync(ws, { recursive: true, force: true });
  console.log('channel clone (DNA, métricas, armazenamento portátil) tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
