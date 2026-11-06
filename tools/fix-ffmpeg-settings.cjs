const fs = require('fs');
const path = require('path');

const FFMPEG = 'E:/DOWNLOAD/ffmpeg/bin/ffmpeg.exe';
const FFPROBE = 'E:/DOWNLOAD/ffmpeg/bin/ffprobe.exe';

for (const dir of [path.join(process.env.APPDATA || '', 'filmforge'), path.join(process.env.APPDATA || '', 'FilmForge')]) {
  const file = path.join(dir, 'settings.json');
  if (!fs.existsSync(file)) continue;
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  s.ffmpeg = FFMPEG;
  s.ffprobe = FFPROBE;
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  console.log('ok', file, '| ffmpeg =', s.ffmpeg);
}
