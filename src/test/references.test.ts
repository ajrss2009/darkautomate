import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProject, defaultSettings, projectDirOf } from '../main/settings';
import { prepareReferences } from '../main/references';

/**
 * VÍDEO DE REFERÊNCIA: além de citar o arquivo no prompt, ele precisa virar ESTILO
 * do projeto (paleta medida + descrição) — é isso que faz o vídeo final nascer com
 * a aparência da referência, e não só com o nome dela no texto.
 */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-ref-'));
  const s = defaultSettings(ws);
  const video = path.join(ws, 'ref.mp4');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=#cc3322:s=320x180:d=2:r=30', '-pix_fmt', 'yuv420p', video], { stdio: 'ignore' });
  const p = createProject(s, { name: 'Ref', idea: 'x', videoType: 'custom', routeId: 'shorts-autopilot' });
  const dir = projectDirOf(s, p.id);
  await prepareReferences(s, p, dir, { videoFile: video }, path.resolve(__dirname, '../../tools'), new AbortController().signal);

  assert.ok(p.refVideo, 'o vídeo de referência foi preparado');
  assert.ok((p.refVideo!.frames?.length ?? 0) >= 4, `quadros-chave extraídos (${p.refVideo!.frames?.length})`);
  assert.ok(p.styleRef?.stylePrompt, 'o estilo do vídeo virou prompt de estilo');
  assert.match(p.styleRef!.stylePrompt, /palette|reference/i, 'o estilo cita paleta/referência');
  assert.ok((p.styleRef!.palette?.length ?? 0) >= 1, 'a paleta foi medida nos quadros');
  assert.ok(p.styleRef!.file && fs.existsSync(p.styleRef!.file), 'o quadro de referência está no projeto');
  assert.ok(p.attachments?.some((a) => a.use === 'reference' && /ESTILO/.test(a.note ?? '')), 'a referência entra como imagem de estilo');
  assert.ok(p.palette?.video, 'a paleta do vídeo veio da referência');

  const refText = p.styleRef!.stylePrompt;
  console.log(`referência: ${p.refVideo!.frames!.length} quadros · paleta ${p.styleRef!.palette!.join(' ')} · estilo "${refText.slice(0, 80)}…"`);
  console.log('references tests: OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
