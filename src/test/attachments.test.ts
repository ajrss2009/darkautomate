import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { addAttachments, attachKind, attachmentsText, characterPhoto, musicAttachment, removeAttachment, sceneUserMedia, updateAttachment, userDir } from '../main/attachments';
import { buildPrompt } from '../main/prompts';
import { createExecutors } from '../main/executors';
import * as ff from '../main/ffmpeg';
import * as ops from '../main/ops';
import { defaultSettings, createProject, projectDirOf } from '../main/settings';
import type { ExecContext } from '../main/engine';

/** Arquivos do usuário: copiados para o projeto, citados no prompt e usados na produção (cena, trilha, retrato). */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-attach-'));
  const s = defaultSettings(ws);
  const src = path.join(ws, 'meus');
  fs.mkdirSync(path.join(src, 'pasta', 'sub'), { recursive: true });
  await ff.run(s.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', path.join(src, 'foto.jpg')]);
  await ff.run(s.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path.join(src, 'tema.wav')]);
  await ff.run(s.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-pix_fmt', 'yuv420p', path.join(src, 'pasta', 'sub', 'praia.mov')]);
  fs.writeFileSync(path.join(src, 'pasta', 'roteiro.txt'), 'A avó conta a história do farol.');
  fs.writeFileSync(path.join(src, 'pasta', '.oculto'), 'x');

  assert.equal(attachKind('a.JPG'), 'image'); assert.equal(attachKind('b.mkv'), 'video'); assert.equal(attachKind('c.flac'), 'audio'); assert.equal(attachKind('d.md'), 'text'); assert.equal(attachKind('e.zip'), 'other');

  const p = createProject(s, { name: 'Anexos', idea: 'farol', videoType: 'custom', routeId: 'dorama-elenco' });
  const dir = projectDirOf(s, p.id);
  const added = addAttachments(p, dir, [path.join(src, 'foto.jpg'), path.join(src, 'tema.wav'), path.join(src, 'pasta')]);
  assert.deepEqual(added.map((a) => `${a.file}|${a.kind}|${a.use}`).sort(), ['foto.jpg|image|scene', 'pasta/roteiro.txt|text|reference', 'pasta/sub/praia.mov|video|scene', 'tema.wav|audio|music'], 'pasta copiada (sem ocultos) com usos padrão');
  assert.ok(fs.existsSync(path.join(userDir(dir), 'pasta', 'sub', 'praia.mov')));
  assert.equal(addAttachments(p, dir, [path.join(src, 'foto.jpg')])[0]!.file, 'foto-2.jpg', 'nome repetido não sobrescreve');
  removeAttachment(p, dir, 'foto-2.jpg');
  assert.ok(!fs.existsSync(path.join(userDir(dir), 'foto-2.jpg')));
  assert.throws(() => addAttachments(p, dir, [path.join(src, 'nao-existe.png')]));

  /* prompt: lista os arquivos, traz o texto e explica o "userMedia" no plano */
  const ctx = (kind: string, extra: Record<string, unknown> = {}) => ({ settings: s, project: p, projectDir: dir, outDir: path.join(dir, 'out'), step: { id: kind, kind, params: {}, bindings: [] }, signal: new AbortController().signal, log: () => {}, ...extra }) as unknown as ExecContext;
  const plan = buildPrompt(ctx('scene_plan'));
  assert.match(plan, /ARQUIVOS DO USUÁRIO[\s\S]*foto\.jpg[\s\S]*tema\.wav/);
  assert.match(plan, /A avó conta a história do farol/);
  assert.match(plan, /"userMedia"/);
  assert.equal(attachmentsText(p, dir, 'narration'), '', 'narração não recebe a lista');

  /* foto de personagem e nota */
  updateAttachment(p, 'foto.jpg', { use: 'character', character: 'Lia', note: 'menina de 10 anos, capa amarela' });
  assert.equal(characterPhoto(p, dir, 'lia'), path.join(userDir(dir), 'foto.jpg'));
  assert.match(attachmentsText(p, dir, 'asset_design'), /PERSONAGENS COM FOTO DO USUÁRIO: Lia[\s\S]*capa amarela/);
  updateAttachment(p, 'foto.jpg', { use: 'scene' });
  assert.equal(p.attachments!.find((a) => a.file === 'foto.jpg')!.character, undefined);
  assert.equal(musicAttachment(p, dir), path.join(userDir(dir), 'tema.wav'));

  /* cena em código: caminho relativo à página */
  const scene = { id: 's01', index: 1, title: 'Praia', narration: 'o mar', visualIntent: 'mar', kind: 'image' as const, durationSec: 3, userMedia: 'pasta/sub/praia.mov', status: {}, artifacts: {} };
  const sceneDir = path.join(dir, 'scenes', 's01');
  assert.match(attachmentsText(p, dir, 'code_scene', scene, path.join(sceneDir, 'code')), /"\.\.\/\.\.\/\.\.\/assets\/user\/pasta\/sub\/praia\.mov"[\s\S]*ESTA CENA deve mostrar "pasta\/sub\/praia\.mov"/);
  assert.equal(sceneUserMedia(p, dir, scene)!.kind, 'video');

  /* produção: o arquivo do usuário vira o quadro/clipe e a trilha */
  p.scenes = [scene];
  const ex = createExecutors({ workflowsDir: '' });
  const at = (kind: string, sc?: typeof scene) => ({ ...ctx(kind), scene: sc, sceneDir: sc ? sceneDir : undefined, binding: { type: 'comfyui', server: 'nenhum', workflow: 'x.json' } }) as unknown as ExecContext;
  const img = await ex.comfyui(at('image', scene));
  assert.ok(fs.existsSync(img.files[0]!) && img.files[0]!.endsWith(path.join('frames', 'frame.png')), 'quadro tirado do vídeo do usuário');
  const vid = await ex.comfyui(at('video', scene));
  assert.ok(fs.statSync(vid.files[0]!).size > 0 && vid.files[0]!.endsWith('clip.mp4'), 'vídeo do usuário convertido para o clipe');
  const photoScene = { ...scene, id: 's02', userMedia: 'foto.jpg' };
  await assert.rejects(ex.comfyui(at('video', photoScene)), /servidor ComfyUI/, 'imagem do usuário + vídeo: o vídeo IA anima (segue para o ComfyUI)');
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  const mus = await ex.comfyui(at('music'));
  assert.ok(mus.files[0]!.endsWith('music.mp3') && fs.statSync(mus.files[0]!).size > 0, 'trilha do usuário');

  /* cena: escolher/limpar o arquivo no editor marca o visual para refazer */
  const flags = ops.updateScene(p, 's01', { userMedia: '' });
  assert.ok(flags.visual); assert.equal(p.scenes[0]!.userMedia, undefined);

  console.log('attachments tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
