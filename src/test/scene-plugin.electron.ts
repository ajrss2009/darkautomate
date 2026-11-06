import { app, protocol } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SCENE_SCHEME, registerSceneProtocol, renderHtml } from '../main/render';
import { installPluginFolder, pluginPrompt, stagePluginSkills } from '../main/plugins';
import { defaultSettings } from '../main/settings';

/**
 * Teste no Electron (não roda no npm test): uma CENA do FilmForge importa a biblioteca de um plugin do Claude
 * (claude-animation: formiga, papel, sol, grama) pelo protocolo forge-scene:// e é renderizada pelo renderizador real.
 * Uso: electron dist/test/scene-plugin.electron.js <pasta do plugin instalado> <saída.png>
 */
protocol.registerSchemesAsPrivileged([SCENE_SCHEME]);
const [pluginDir, pngOut] = process.argv.slice(-2) as [string, string];

app.whenReady().then(async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-scene-plugin-'));
  const s = defaultSettings(ws); s.ffmpeg = 'ffmpeg';
  registerSceneProtocol(() => [ws, os.tmpdir()]);
  installPluginFolder(s, pluginDir);
  const projectDir = path.join(ws, 'projects', 'teste');
  const staged = stagePluginSkills(s, ['claude-animation'], projectDir);
  const sceneDir = path.join(projectDir, 'scenes', 's01');
  const prompt = pluginPrompt(s, ['claude-animation'], {}, { projectDir, stepKind: 'code_scene', sceneDir });
  const html = path.join(sceneDir, 'code', 'scene.html');
  fs.mkdirSync(path.dirname(html), { recursive: true });
  /* exatamente o que o prompt manda a IA escrever: import map + módulo com a biblioteca do plugin */
  const lib = `../../../${staged[0]!.rel}/lib`;
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="1280" height="720"></canvas>
<script type="importmap">{"imports":{"@napi-rs/canvas":"../../../plugins/_shim/napi-canvas.mjs"}}</script>
<script type="module">
import { clamp, lerp, eOut, line } from "${lib}/core.mjs";
import { paper, sun, grass, soil } from "${lib}/textures.mjs";
import { ant } from "${lib}/rigs/ant.mjs";
const W = 1280, H = 720, G = 560;
const ctx = document.getElementById("c").getContext("2d");
const S = { paper: paper(W, H), soil: soil(W, H - G, "day") };
function frame(ctx, t) {
  ctx.drawImage(S.paper, 0, 0); sun(ctx, 1080, 90, 70);
  ctx.drawImage(S.soil, 0, G); line(ctx, [[0, G], [W, G]], 2.5); grass(ctx, G, 0, W, 18, 12);
  const walk = eOut(clamp(t / 1.8));
  ant(ctx, lerp(1400, 640, walk), G, 1.0, { flip: true, gait: walk < 0.99 ? t * 9 : undefined });
}
window.__forge = { duration: 2, fps: 30, seek(t) { ctx.clearRect(0, 0, W, H); frame(ctx, t); }, pause() {}, sfx: [{ t: 1.75, name: "thud" }, { t: 0.2, name: "swoosh" }] };
</script></body></html>`);
  const out = path.join(sceneDir, 'clips', 'code.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try {
    await renderHtml(html, out, { w: 1280, h: 720, ffmpeg: 'ffmpeg', duration: 2, fps: 30 });
    execFileSync('ffmpeg', ['-y', '-ss', '1.9', '-i', out, '-frames:v', '1', pngOut], { stdio: 'ignore' });
    const sfx = JSON.parse(fs.readFileSync(out.replace(/\.mp4$/, '.sfx.json'), 'utf8')) as unknown[];
    const stat = execFileSync('ffmpeg', ['-i', pngOut, '-vf', 'signalstats,metadata=print', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(JSON.stringify({ ok: true, staged: staged.map((x) => x.rel), shim: fs.existsSync(path.join(projectDir, 'plugins', '_shim', 'napi-canvas.mjs')), mp4: fs.statSync(out).size, sfx, frame: pngOut,
      promptHasImportMap: /importmap/.test(prompt), promptChars: prompt.length, stat: stat.length }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: (e as Error).message }));
  }
  app.exit(0);
});
