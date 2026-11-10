/**
 * Teste isolado da captura de link (navegador invisível) no Electron.
 * Uso: npx electron dist/dev/capture-link.js <url> [segundosDoTrecho]
 * Serve para provar que a captura termina em vez de travar a fila do lote.
 */
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureWebPage } from '../main/webcapture';

const URL_ARG = process.argv[2] ?? 'https://www.reddit.com/r/gpu/s/b8p6pmVrm2';
const CLIP_SEC = Number(process.argv[3] ?? 6);
const OUT = path.join('C:/Users/ajrss/AppData/Local/Temp/opencode', 'webcap-test');
const LOG = path.join('C:/Users/ajrss/AppData/Local/Temp/opencode', 'webcap-test.log');
const FFMPEG = path.resolve(__dirname, '..', '..', 'tools', 'ffmpeg', 'win', 'ffmpeg.exe');

/* o electron.exe do Windows não tem console: o resultado vai para um arquivo */
const log = (l: string) => { try { fs.appendFileSync(LOG, `${l}\n`); } catch { /* sem log */ } };

void app.whenReady().then(async () => {
  try { fs.rmSync(LOG, { force: true }); } catch { /* sem log antigo */ }
  const t0 = Date.now();
  const at = (l: string) => log(`[${Math.round((Date.now() - t0) / 1000)}s] ${l}`);
  at(`início: ${URL_ARG} · trecho de ${CLIP_SEC}s · ffmpeg ${FFMPEG}`);
  try {
    const cap = await captureWebPage({ url: URL_ARG, dir: OUT, ffmpeg: FFMPEG, aspect: '9:16', clips: 1, clipSec: CLIP_SEC, maxSec: 40, log: at });
    at(`FIM ok: "${cap.title}" · ${cap.clips.length} trecho(s) · rolagem ${cap.seconds}s · ${cap.shots.length} print(s)`);
  } catch (e) {
    at(`FIM com erro: ${(e as Error).message}`);
  }
  app.quit();
});
