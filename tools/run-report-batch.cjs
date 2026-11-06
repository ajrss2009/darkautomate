/* Executa os projetos restantes do relatório, um por vez, com timeout e log individual. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const RESULTS = path.join(APP, 'docs', 'report-results.json');
const BATCH_LOG = path.join(APP, 'docs', 'report-batch.log');

const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'docs', 'report-manifest.json'), 'utf8'));
const done = new Set(['rel-01', 'rel-02', 'rel-03']);
const todo = manifest.filter((p) => !done.has(p.id.split('-').slice(0, 2).join('-')));
const results = [];
for (const p of manifest) {
  const final = path.join(PROJECTS, p.id, 'out', 'final.mp4');
  if (fs.existsSync(final)) results.push({ id: p.id, name: p.name, status: 'done', size: fs.statSync(final).size, completed: true });
}
const log = (l) => { fs.appendFileSync(BATCH_LOG, `[${new Date().toISOString()}] ${l}\n`); };

(async () => {
  log(`início: ${todo.length} projeto(s)`);
  for (const p of todo) {
    const file = path.join(os.tmpdir(), `rep-${p.id}.log`);
    const out = fs.openSync(file, 'w');
    log(`rodando ${p.id} (${p.name})`);
    const t0 = Date.now();
    const child = spawn(ELECTRON, ['.', '--run-project', p.id], { cwd: APP, stdio: ['ignore', out, out] });
    const timer = setTimeout(() => { try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch { /* ignore */ } }, 40 * 60_000);
    const code = await new Promise((res) => child.on('close', res));
    clearTimeout(timer);
    try { fs.closeSync(out); } catch { /* ignore */ }
    const final = path.join(PROJECTS, p.id, 'out', 'final.mp4');
    const ok = fs.existsSync(final);
    const row = { id: p.id, name: p.name, status: ok ? 'done' : 'failed', exit: code, seconds: Math.round((Date.now() - t0) / 1000), size: ok ? fs.statSync(final).size : 0, log: file };
    results.push(row);
    fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
    log(`${p.id}: ${row.status} (${row.seconds}s${ok ? `, ${(row.size / 1e6).toFixed(1)} MB` : ''})`);
  }
  log('fim');
})().catch((e) => { log(`ERRO: ${e.message}`); process.exit(1); });
