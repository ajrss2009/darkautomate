import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { clipInsertAt, descriptionWithProduct, insertProductClip, readProductClipInfo, shiftSrt, withProductLink } from '../main/product-clip';
import { copyProductClip } from '../main/settings';
import { uploadMeta } from '../main/youtube-upload';
import { referenceText } from '../main/prompts';

/** CLIP DE VENDA DE PRODUTO no vídeo: posição na fronteira de cena, montagem real com ffmpeg, legendas e link na descrição. */
async function main() {
  /* posição: início/fim exatos; meio e segundo vão para a fronteira de cena mais próxima */
  const b = [4, 9, 15, 20];
  assert.equal(clipInsertAt(b, 20, 'start'), 0);
  assert.equal(clipInsertAt(b, 20, 'end'), 20);
  assert.equal(clipInsertAt(b, 20, 'middle'), 9);
  assert.equal(clipInsertAt(b, 20, 13), 15);
  assert.equal(clipInsertAt(b, 20, 99), 15, 'segundo depois do fim → última troca de cena');
  assert.equal(clipInsertAt([], 10, 'middle'), 5);

  /* legendas: só as depois do ponto andam */
  const srt = '1\n00:00:01,000 --> 00:00:02,500\nantes\n\n2\n00:00:05,000 --> 00:00:06,000\ndepois\n';
  const sh = shiftSrt(srt, 4, 3.25);
  assert.match(sh, /00:00:01,000 --> 00:00:02,500/);
  assert.match(sh, /00:00:08,250 --> 00:00:09,250/);

  /* link no topo da descrição, sem repetir */
  assert.equal(withProductLink('Descrição.', { link: 'https://loja.x/p', cta: '🛍 Compre:' }), '🛍 Compre: https://loja.x/p\n\nDescrição.');
  assert.equal(withProductLink('já tem https://loja.x/p', { link: 'https://loja.x/p' }), 'já tem https://loja.x/p');
  assert.equal(withProductLink('d', { link: 'https://a.b', name: 'Tênis' }), '🛍 Tênis: https://a.b\n\nd');
  assert.equal(withProductLink('d', undefined), 'd');
  console.log('✓ posição na troca de cena, legendas deslocadas, link no topo da descrição');

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-prod-'));
  /* copia para o projeto e normaliza o link */
  const src = path.join(ws, 'meu clip.mp4');
  fs.writeFileSync(src, 'x');
  const pdir = path.join(ws, 'proj');
  const c = copyProductClip(pdir, { file: src, position: 'middle', link: 'loja.x/p', name: ' Tênis ' });
  assert.equal(c.file, path.join(pdir, 'assets', 'product', 'product-clip.mp4'));
  assert.ok(fs.existsSync(c.file));
  assert.equal(c.link, 'https://loja.x/p');
  assert.equal(c.name, 'Tênis');
  assert.throws(() => copyProductClip(pdir, { file: path.join(ws, 'nao.mp4'), position: 'end' }), /não encontrado/);
  fs.writeFileSync(path.join(ws, 'img.png'), 'x');
  assert.throws(() => copyProductClip(pdir, { file: path.join(ws, 'img.png'), position: 'end' }), /use um vídeo/);
  /* o roteiro e o SEO sabem do clip */
  assert.match(referenceText({ productClip: c } as never, 'metadata'), /CLIP DE VENDA[\s\S]*"Tênis" no meio/);
  assert.equal(referenceText({ productClip: c } as never, 'image'), '');

  /* montagem real: final 6 s (3 cenas de 2 s, 1280x720 com áudio) + clip mudo vertical de 2 s no meio */
  const bundled = path.resolve('tools/ffmpeg/win/ffmpeg.exe');
  const FF = fs.existsSync(bundled) ? bundled : 'ffmpeg';
  const FP = FF.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe'));
  let ok = true;
  try { execFileSync(FF, ['-version'], { stdio: 'ignore' }); execFileSync(FP, ['-version'], { stdio: 'ignore' }); } catch { ok = false; }
  if (ok) {
    const out = path.join(ws, 'out'); fs.mkdirSync(out);
    const final = path.join(out, 'final.mp4');
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=1280x720:d=6:r=30', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', final], { stdio: 'ignore' });
    const clip = path.join(ws, 'clip.mp4');
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=540x960:d=2:r=25', '-pix_fmt', 'yuv420p', clip], { stdio: 'ignore' });
    fs.writeFileSync(path.join(out, 'subtitles.srt'), '1\n00:00:04,500 --> 00:00:05,500\nfim\n');
    const logs: string[] = [];
    const r = await insertProductClip({ ffmpeg: FF, ffprobe: FP, final, clip: { file: clip, position: 'middle', name: 'Tênis', link: 'https://loja.x/p', cta: '🛍 Compre:' },
      at: clipInsertAt([2, 4, 6], 6, 'middle'), total: 6, w: 1280, h: 720, fps: 30, outDir: out, log: (l) => logs.push(l) });
    assert.equal(r.at, 2, 'meio de 6 s com cenas em 2/4 → troca de cena em 2 s (a mais próxima de 3 s)');
    const dur = Number(execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', final]).toString());
    assert.ok(Math.abs(dur - 8) < 0.2, `duração final ${dur}`);
    const streams = execFileSync(FP, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', final]).toString();
    assert.match(streams, /video,1280,720/);
    assert.match(streams, /audio/);
    /* clip vertical num vídeo 16:9: a borda esquerda durante o clip (t = 3 s) é o fundo desfocado azul, não barra preta */
    const px = execFileSync(FF, ['-v', 'error', '-ss', '3', '-i', final, '-frames:v', '1', '-vf', 'crop=8:8:20:356', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const avg = (k: number) => { let t = 0; for (let i = k; i < px.length; i += 3) t += px[i]!; return t / (px.length / 3); };
    assert.ok(avg(2) > 60 && avg(2) > avg(0), `borda do clip com fundo desfocado (rgb médio ${avg(0).toFixed(0)},${avg(1).toFixed(0)},${avg(2).toFixed(0)})`);
    assert.match(fs.readFileSync(path.join(out, 'subtitles.srt'), 'utf8'), /00:00:06,500 --> 00:00:07,500/);
    assert.equal(readProductClipInfo(out)?.seconds !== undefined, true);
    assert.match(descriptionWithProduct(out, 'texto'), /^🛍 Compre: https:\/\/loja\.x\/p/);
    fs.writeFileSync(path.join(out, 'metadata.json'), JSON.stringify({ title: 'T', description: 'Desc.' }));
    assert.match(uploadMeta(out, 'x').description, /^🛍 Compre: https:\/\/loja\.x\/p\n\nDesc\./);
    assert.ok(logs.some((l) => /clip de venda "Tênis"/.test(l)));
    console.log(`✓ montagem real: 6 s + clip mudo 9:16 de 2 s → ${dur.toFixed(2)} s em 1280x720 com áudio; legenda deslocada; link na descrição do upload`);
  } else console.log('… ffmpeg ausente: montagem real pulada');
  fs.rmSync(ws, { recursive: true, force: true });
}

main().then(() => console.log('product-clip tests: OK')).catch((e) => { console.error(e); process.exit(1); });
