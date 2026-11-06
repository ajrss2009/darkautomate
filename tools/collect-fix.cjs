const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/filmforge';
const P = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';
const FF = 'E:/DOWNLOAD/ffmpeg/bin/ffprobe.exe';
const ids = [
  'rel-01-stickman-ag-9bb91c', 'rel-02-misto-ag-b2a9d2', 'rel-03-codigo-youtube-ag-fd160d',
  'rel-08-stickman-ol-f5c732', 'rel-ol-misto-ce1aff', 'rel-ol-codigo-youtube-14e66e',
];
const probe = (f) => {
  const r = spawnSync(FF, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames,r_frame_rate,duration', '-show_entries', 'format=duration,size', '-of', 'json', f], { encoding: 'utf8' });
  if (r.status !== 0) return undefined;
  const j = JSON.parse(r.stdout); const s = (j.streams || [])[0] || {};
  return { frames: Number(s.nb_frames || 0), fps: s.r_frame_rate, dur: Number(s.duration || j.format?.duration || 0), size: Number(j.format?.size || 0) };
};

console.log('=== batch ===');
try { console.log(fs.readFileSync(path.join(APP, 'docs', 'fix-batch.log'), 'utf8').split(/\r?\n/).slice(-12).join('\n')); } catch { /* ignore */ }
try { const r = JSON.parse(fs.readFileSync(path.join(APP, 'docs', 'fix-results.json'), 'utf8')); for (const x of r) console.log(`${x.id} | ${x.status} | ${x.seconds}s | ${x.size ? (x.size / 1e6).toFixed(1) + 'MB' : '-'}`); } catch { /* ignore */ }

for (const id of ids) {
  const dir = path.join(P, id);
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  const fin = path.join(dir, 'out', 'final.mp4');
  const fp = fs.existsSync(fin) ? probe(fin) : undefined;
  const logFile = path.join(os.tmpdir(), `fix-${id}.log`);
  let log = ''; try { log = fs.readFileSync(logFile, 'utf8'); } catch { /* ignore */ }
  const voices = [...new Set([...log.matchAll(/voz de referência: (.+)/g)].map((m) => m[1].trim()))];
  const renders = [...log.matchAll(/render determinístico: ([\d.]+)s a (\d+) fps \((\d+) quadros\)/g)].map((m) => `${m[1]}s@${m[2]}fps/${m[3]}f`);
  const vision = { ok: (log.match(/visão \d+\/10[^\n]*aceito/g) || []).length, rej: (log.match(/visão \d+\/10[^\n]*rejeitado/g) || []).length };
  const cards = (log.match(/usando cartão com o título/g) || []).length;
  console.log(`\n=== ${id} ===`);
  console.log('final:', fp ? `${fp.dur.toFixed(2)}s ${fp.size ? (fp.size / 1e6).toFixed(1) + 'MB' : ''}` : 'AUSENTE');
  console.log('voz:', voices.join(', ') || '-', '| renders:', renders.join(' | ') || '-', '| visão:', `${vision.ok}/${vision.rej}`, '| cartões:', cards);
  for (const s of p.scenes || []) {
    const clips = ['code', 'motion'].map((k) => path.join(dir, 'scenes', s.id, 'clips', `${k}.mp4`)).filter((f) => fs.existsSync(f));
    const cp = clips[0] ? probe(clips[0]) : undefined;
    const expected = Math.round((s.durationSec || 0) * 30);
    console.log(` ${s.id} ${s.kind} dur=${s.durationSec} | ${cp ? `${path.basename(clips[0])} ${cp.frames} frames @ ${cp.fps} = ${cp.dur.toFixed(3)}s (esperado ~${expected})` : 'sem clip de código'}`);
  }
}
