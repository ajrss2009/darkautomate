/* Roda os 5 testes restantes de frames/voz, sequencialmente, com timeout e log. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const ids = [
  'rel-02-misto-ag-b2a9d2',
  'rel-03-codigo-youtube-ag-fd160d',
  'rel-08-stickman-ol-f5c732',
  'rel-ol-misto-ce1aff',
  'rel-ol-codigo-youtube-14e66e',
];
const results = [];
const log = (l) => fs.appendFileSync(path.join(APP, 'docs', 'fix-batch.log'), `[${new Date().toISOString()}] ${l}\n`);

(async () => {
  for (const id of ids) {
    const file = path.join(os.tmpdir(), `fix-${id}.log`);
    const out = fs.openSync(file, 'w');
    log(`rodando ${id}`);
    const t0 = Date.now();
    const child = spawn(ELECTRON, ['.', '--run-project', id, '--no-cache'], { cwd: APP, stdio: ['ignore', out, out] });
    const timer = setTimeout(() => { try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch { /* ignore */ } }, 45 * 60_000);
    const code = await new Promise((res) => child.on('close', res));
    clearTimeout(timer);
    try { fs.closeSync(out); } catch { /* ignore */ }
    const final = path.join(PROJECTS, id, 'out', 'final.mp4');
    const ok = fs.existsSync(final);
    const row = { id, status: ok ? 'done' : 'failed', exit: code, seconds: Math.round((Date.now() - t0) / 1000), size: ok ? fs.statSync(final).size : 0, log: file };
    results.push(row);
    fs.writeFileSync(path.join(APP, 'docs', 'fix-results.json'), JSON.stringify(results, null, 2));
    log(`${id}: ${row.status} (${row.seconds}s)`);
  }
  log('fim');
})().catch((e) => { log(`ERRO ${e.message}`); process.exit(1); });
