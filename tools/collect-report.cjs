/* Coleta um resumo de cada projeto do relatório (final, cenas, whisper, stock, visão). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const FFPROBE = 'E:/DOWNLOAD/ffmpeg/bin/ffprobe.exe';
const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'docs', 'report-manifest.json'), 'utf8'));

function probe(file) {
  try {
    const r = spawnSync(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { encoding: 'utf8', timeout: 30000 });
    if (r.status !== 0) return undefined;
    const j = JSON.parse(r.stdout);
    const v = (j.streams || []).find((s) => s.codec_type === 'video');
    const a = (j.streams || []).find((s) => s.codec_type === 'audio');
    return { duration: Number(j.format?.duration || 0), size: Number(j.format?.size || 0), width: v?.width, height: v?.height, video: v?.codec_name, audio: a?.codec_name, channels: a?.channels };
  } catch { return undefined; }
}

const out = [];
for (const m of manifest) {
  const dir = path.join(PROJECTS, m.id);
  let p;
  try { p = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')); } catch { out.push({ ...m, status: 'missing' }); continue; }
  const finalFile = path.join(dir, 'out', 'final.mp4');
  const final = fs.existsSync(finalFile) ? probe(finalFile) : undefined;
  const logFile = fs.existsSync(path.join(os.tmpdir(), `rep-${m.id}.log`)) ? path.join(os.tmpdir(), `rep-${m.id}.log`) : path.join(os.tmpdir(), `forge-${m.id.split('-').slice(0, 2).join('')}.log`);
  let log = '';
  try { log = fs.readFileSync(logFile, 'utf8'); } catch { /* sem log */ }
  const lastRun = (p.production?.runs ?? []).slice(-1)[0];
  const runSec = lastRun?.startedAt && lastRun?.endedAt ? Math.round((Date.parse(lastRun.endedAt) - Date.parse(lastRun.startedAt)) / 1000) : undefined;
  const logElapsed = [...log.matchAll(/"elapsedMs":(\d+)/g)].map((x) => Number(x[1])).pop();
  const visionAccepted = (log.match(/visão \d+\/10[^\n]*aceito/g) || []).length;
  const visionRejected = (log.match(/visão \d+\/10[^\n]*rejeitado/g) || []).length;
  const words = [];
  const stock = [];
  for (const sc of p.scenes || []) {
    const wf = path.join(dir, 'scenes', sc.id, 'audio', 'words.json');
    try { const w = JSON.parse(fs.readFileSync(wf, 'utf8')); words.push({ scene: sc.id, source: w.source, words: w.words?.length }); } catch { /* sem whisper */ }
    const sf = path.join(dir, 'scenes', sc.id, 'stock', 'stock.json');
    try {
      const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
      for (const a of s.assets || []) stock.push({ scene: sc.id, file: a.file, source: a.source, author: a.author, license: a.license, title: a.title });
    } catch { /* sem stock */ }
  }
  const clips = [];
  for (const sc of p.scenes || []) {
    const d = path.join(dir, 'scenes', sc.id, 'stock');
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => /^stock-.*\.(mp4|webm|mov)$/i.test(x))) {
      const pr = probe(path.join(d, f));
      if (pr) clips.push({ scene: sc.id, file: f, seconds: +pr.duration.toFixed(2), width: pr.width, height: pr.height });
    }
  }
  out.push({
    ...m, status: final ? 'done' : 'pending', final, elapsedSec: runSec ?? (logElapsed ? Math.round(logElapsed / 1000) : undefined),
    scenes: (p.scenes || []).map((s) => ({ id: s.id, kind: s.kind, duration: s.durationSec, status: s.status })), words, stock, clips,
    vision: { accepted: visionAccepted, rejected: visionRejected }, log: logFile,
  });
}
fs.writeFileSync(path.join(APP, 'docs', 'report-summary.json'), JSON.stringify(out, null, 2));
for (const r of out) {
  console.log(`\n=== ${r.name} (${r.id}) ===`);
  console.log(`skill=${r.skillId} rota=${r.routeId} status=${r.status} tempo=${r.elapsedSec ?? '?'}s`);
  if (r.final) console.log(`final: ${r.final.duration.toFixed(2)}s ${r.final.width}x${r.final.height} ${r.final.video}/${r.final.audio}${r.final.channels ? ' ' + r.final.channels + 'ch' : ''} ${(r.final.size / 1e6).toFixed(1)}MB`);
  console.log('cenas:', (r.scenes || []).map((s) => `${s.id}:${s.kind} ${s.duration ?? '?'}s`).join(' | '));
  console.log('whisper:', (r.words || []).map((w) => `${w.scene}:${w.source}:${w.words}`).join(' | ') || '-');
  console.log('stock:', (r.stock || []).map((s) => `${s.scene}:${s.source}`).join(' | ') || '-');
  console.log('clips YT:', (r.clips || []).map((c) => `${c.scene}:${c.seconds}s`).join(' | ') || '-');
  console.log('visão:', r.vision);
}
console.log('\nresumo:', path.join(APP, 'docs', 'report-summary.json'));
