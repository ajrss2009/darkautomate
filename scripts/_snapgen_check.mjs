/* Validação real do provedor Snapgen.AI (imagem/vídeo) usando o MESMO código de
   src/main/providers.ts. Requer SNAPGEN_API_KEY no ambiente.
   Uso: ELECTRON_RUN_AS_NODE=1 electron.exe scripts/_snapgen_check.mjs [modelo] [segundos]
   Gera: <TEMP>/opencode/snapgen-out/novelinha-de-frutas.mp4 e imprime créditos. */
import { build } from 'esbuild';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUTDIR = path.join(os.tmpdir(), 'opencode', 'snapgen-out');
mkdirSync(OUTDIR, { recursive: true });
const RUNLOG = path.join(OUTDIR, 'run.log');
const REPORT = path.join(OUTDIR, 'report.txt');
const say = (line = '') => {
  try { process.stderr.write(line + '\n'); } catch { /* noop */ }
  try { appendFileSync(RUNLOG, line + '\n'); } catch { /* noop */ }
};
appendFileSync(RUNLOG, `\n=== start ${new Date().toISOString()} ===\n`);

try {
  const model = process.argv[2] || 'veo-3.1-fast';
  const seconds = Number(process.argv[3] || 8);
  const prompt = process.argv[4] ||
    'Novelinha de frutas: uma historinha curta e divertida com frutas antropomórficas — uma laranja esperta, uma uva tímida e uma banana atrapalhada — discutindo quem é a fruta mais amada do café da manhã. Close-up cinematográfico, cores vibrantes, iluminação suave de estúdio, estilo stop-motion, sem texto.';

  const key = process.env.SNAPGEN_API_KEY;
  if (!key) { say('FALHA: defina SNAPGEN_API_KEY (x-api-key do Snapgen.AI).'); process.exit(2); }
  say(`cwd=${process.cwd()} root=${ROOT}`);

  // 1) compila providers.ts no lugar, para reusar exatamente a implementação
  const bundle = path.join(os.tmpdir(), 'opencode', 'snapgen-providers.mjs');
  const tmp = bundle + '.tmp';
  await build({ entryPoints: [path.join(ROOT, 'src', 'main', 'providers.ts')], outfile: tmp, bundle: true, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'warning' });
  copyFileSync(tmp, bundle);
  say('bundle ok');
  const prov = await import(pathToFileURL(bundle).href + `?t=${Date.now()}`);

  const p = { id: 'snapgen', kind: 'snapgen', baseUrl: 'https://api.snapgen.ai', apiKey: key, models: [] };
  const t0 = Date.now();
  const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
  const log = (l) => say(`${stamp()} ${l}`);

  say(`\n=== Snapgen.AI — teste real ===`);
  say(`modelo: ${model} · duração: ${seconds}s`);
  say(`prompt: ${prompt}\n`);

  const before = await prov.snapgenAccount(p);
  log(`saldo ANTES: ${before.available.toLocaleString('pt-BR')} disponíveis · ${before.locked.toLocaleString('pt-BR')} bloqueados${before.planId ? ` · plano ${before.planId}` : ''}`);

  const dest = path.join(OUTDIR, 'novelinha-de-frutas.mp4');
  if (existsSync(dest)) rmSync(dest, { force: true });

  const t1 = Date.now();
  const started = await prov.snapgenVideo(p, model, prompt, {
    seconds, ratio: '16:9', resolution: '720p', dest,
    signal: new AbortController().signal, log,
  });
  const elapsed = ((Date.now() - t1) / 1000).toFixed(1);

  const after = await prov.snapgenAccount(p);
  const used = before.available - after.available;
  const size = existsSync(dest) ? statSync(dest).size : 0;

  const out = [
    `arquivo: ${started} (${(size / 1048576).toFixed(2)} MB)`,
    `tempo de geração: ${elapsed}s`,
    `saldo DEPOIS: ${after.available.toLocaleString('pt-BR')} disponíveis · ${after.locked.toLocaleString('pt-BR')} bloqueados`,
    `CRÉDITOS CONSUMIDOS: ${used.toLocaleString('pt-BR')}`,
    `CRÉDITOS RESTANTES: ${after.available.toLocaleString('pt-BR')}`,
  ];
  say(`\n=== Resultado ===`);
  out.forEach(say);
  writeFileSync(REPORT, out.join('\n') + '\n', 'utf8');
  if (!size) { say('ERRO: arquivo vazio/ausente'); process.exit(1); }
} catch (e) {
  const msg = `FALHA: ${e && e.stack ? e.stack : e}`;
  say(msg);
  try { writeFileSync(REPORT, msg + '\n', 'utf8'); } catch { /* noop */ }
  process.exit(1);
}
