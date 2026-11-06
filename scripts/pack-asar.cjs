/* Reempacota dist/ + package.json no app.asar do build desempacotado (sem Node instalado:
   rodar com ELECTRON_RUN_AS_NODE=1 e o próprio FilmForge.exe). */
const path = require('node:path');
const fs = require('node:fs');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const res = path.join(root, 'release', 'win-unpacked', 'resources');
const src = path.join(res, 'app');
const out = path.join(res, 'app.asar.packed');

async function main() {
  if (!fs.existsSync(path.join(src, 'package.json'))) throw new Error('staging sem package.json: ' + src);
  if (fs.existsSync(out)) fs.rmSync(out, { force: true });
  await asar.createPackage(src, out);
  const size = fs.statSync(out).size;
  if (size < 100 * 1024) throw new Error('asar pequeno demais: ' + size);
  console.log('packed', out, size);
}
main().catch((e) => { console.error(e); process.exit(1); });
