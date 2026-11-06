import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as auto from '../main/automations';
import { uploadProjectToYouTube } from '../main/executors';
import { uploadMeta } from '../main/youtube-upload';
import { scoreVideo } from '../main/finder';
import { cleanWindow } from '../main/youtube';
import { channelMetrics, channelTabUrl, extractFile } from '../main/channel-clone';
import { createProject, defaultSettings, projectDirOf } from '../main/settings';

/**
 * Upload no YouTube contra uma página que imita o YouTube Studio (campo de arquivo, #title-textarea/#textbox,
 * #description-textarea, #file-loader, rádio "não é para crianças", #next-button, rádio UNLISTED, progresso,
 * #done-button). Usa o Chromium real das Automações. Também: pontuação do "Obter vídeos" e janela sem cortes.
 */
async function main() {
  /* pontuação: canal pequeno com muitas views > canal grande com as mesmas views */
  const base = { id: 'x', title: 'Por que as abelhas fazem isso? 7 segredos', url: '', thumb: '', channel: 'c', views: 200_000, likes: 12_000, comments: 900, ageDays: 10, durationSec: 600, searchLang: 'pt' };
  const small = scoreVideo({ ...base, subs: 2_000, channelAgeDays: 120 }, ['pt']);
  const big = scoreVideo({ ...base, subs: 3_000_000, channelAgeDays: 4000 }, ['pt']);
  assert.ok(small.score > big.score + 30, `outlier pequeno (${small.score}) bem acima do canal grande (${big.score})`);
  assert.ok(small.reasons.some((r) => /Explodiu|Furou/.test(r)) && small.reasons.some((r) => /Canal novo/.test(r)) && small.reasons.some((r) => /pergunta/.test(r)) && small.reasons.some((r) => /número/.test(r)));
  assert.ok(small.score <= 100 && big.score >= 0);
  assert.equal(cleanWindow([3], 2, 6), 0); assert.equal(cleanWindow([1, 5], 3, 6), 1.2); assert.equal(cleanWindow([1, 2, 3, 4, 5], 3, 6), undefined);

  /* clonar canal: URL da aba de vídeos e métricas */
  assert.equal(channelTabUrl('https://www.youtube.com/@abelhas/featured'), 'https://www.youtube.com/@abelhas/videos');
  assert.equal(channelTabUrl('@abelhas', 'shorts'), 'https://www.youtube.com/@abelhas/shorts');
  assert.throws(() => channelTabUrl('abelhas'));
  const met = channelMetrics([{ id: 'a', title: '7 segredos das abelhas?', duration: 600, view_count: 1000 }, { id: 'b', title: 'Mel', duration: 40, view_count: 3000 }, { id: 'c', title: 'Colmeia 2', duration: 500, view_count: 2000 }], 1000, ['20261001', '20261015']);
  assert.deepEqual([met.avgViews, met.medianViews, met.maxViews, met.topTitle, met.avgDurationSec, met.shortsShare, met.viewsPerSub, met.uploadsPerWeek], [2000, 2000, 3000, 'Mel', 380, 0.33, 2, 0.5]);
  assert.equal(met.titlesWithNumbers, 0.67); assert.equal(met.titlesWithQuestion, 0.33);

  /* modelo local: arquivo extraído da resposta (cercas de código e texto em volta) */
  const fence = '```';
  assert.deepEqual(JSON.parse(extractFile('channel.json', `Aqui está:\n${fence}json\n{"bends":[1]}\n${fence}`)!), { bends: [1] });
  assert.match(extractFile('demo.html', `ok\n${fence}html\n<!doctype html><html><body>x</body></html>\n${fence}\nfim`)!, /^<!doctype html>.*<\/html>$/s);
  assert.equal(extractFile('skill.md', `${fence}markdown\n---\nname: X\n---\n## Global\n${fence}js\na\n${fence}\n${fence}`), `---\nname: X\n---\n## Global\n${fence}js\na\n${fence}\n`);
  assert.equal(extractFile('banner.html', 'sem html'), undefined);

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-yt-'));
  const s = defaultSettings(ws);
  const b = auto.detectBrowser(s);
  if (!b.path) { console.log('(sem Chromium: teste do upload pulado)'); return; }
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.log('(sem ffmpeg: pulado)'); return; }
  const posts: Array<Record<string, unknown>> = [];
  const page = `<!doctype html><html><body style="font-family:sans-serif;background:#222;color:#eee">
    <div id="picker"><input type="file" id="vid" accept="video/*"></div>
    <div id="dlg" hidden>
      <ytcp-social-suggestions-textbox id="title-textarea"><div id="textbox" contenteditable="true" style="border:1px solid #888;min-height:20px;width:600px">nome-do-arquivo</div></ytcp-social-suggestions-textbox>
      <ytcp-social-suggestions-textbox id="description-textarea"><div id="textbox" contenteditable="true" style="border:1px solid #888;min-height:40px;width:600px"></div></ytcp-social-suggestions-textbox>
      <ytcp-thumbnails-compact-editor-uploader><input type="file" id="file-loader" accept="image/*"></ytcp-thumbnails-compact-editor-uploader>
      <tp-yt-paper-radio-button name="VIDEO_MADE_FOR_KIDS_MFK" style="display:block">para crianças</tp-yt-paper-radio-button>
      <tp-yt-paper-radio-button name="VIDEO_MADE_FOR_KIDS_NOT_MFK" style="display:block">não é para crianças</tp-yt-paper-radio-button>
      <div id="step-vis" hidden>
        <tp-yt-paper-radio-button name="PRIVATE" style="display:block">Privado</tp-yt-paper-radio-button>
        <tp-yt-paper-radio-button name="UNLISTED" style="display:block">Não listado</tp-yt-paper-radio-button>
        <tp-yt-paper-radio-button name="PUBLIC" style="display:block">Público</tp-yt-paper-radio-button>
      </div>
      <ytcp-video-upload-progress uploading="">Enviando 37%</ytcp-video-upload-progress>
      <span class="video-url-fadeable"><a href="https://youtu.be/TESTE123abc">https://youtu.be/TESTE123abc</a></span>
      <button id="next-button" style="display:block">Próximo</button>
      <button id="done-button" style="display:block">Salvar</button>
    </div>
    <script>
      const st = { kids: '', vis: '', next: 0, thumb: '' , video: '' };
      document.getElementById('vid').addEventListener('change', (e) => { st.video = e.target.files[0].name; document.getElementById('dlg').hidden = false;
        setTimeout(() => { const p = document.querySelector('ytcp-video-upload-progress'); p.removeAttribute('uploading'); p.textContent = 'Upload concluído'; }, 2500); });
      document.getElementById('file-loader').addEventListener('change', (e) => { st.thumb = e.target.files[0].name; });
      document.querySelectorAll('tp-yt-paper-radio-button').forEach((r) => r.addEventListener('click', () => { const n = r.getAttribute('name'); if (/KIDS/.test(n)) st.kids = n; else st.vis = n; }));
      document.getElementById('next-button').addEventListener('click', () => { st.next++; if (st.next >= 3) document.getElementById('step-vis').hidden = false; });
      document.getElementById('done-button').addEventListener('click', async () => {
        const boxes = document.querySelectorAll('#textbox');
        await fetch('/done', { method: 'POST', body: JSON.stringify({ ...st, title: boxes[0].innerText, desc: boxes[1].innerText, uploadingWhenSaved: document.querySelector('ytcp-video-upload-progress').hasAttribute('uploading') }) });
      });
    </script></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/done') { let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => { posts.push(JSON.parse(body)); res.end('ok'); }); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const acc = auto.addAccount(s, 'Teste YouTube');
  (auto.config(s) as { youtubeUploadUrl?: string }).youtubeUploadUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/upload`;
  const port = auto.portFor(acc.id);
  try {
    const p = createProject(s, { name: 'Abelhas', idea: 'x', videoType: 'custom', skillId: 'realistic', routeId: 'realistic-cinematic', aspect: '16:9' });
    const out = path.join(projectDirOf(s, p.id), 'out'); fs.mkdirSync(out, { recursive: true });
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=1', '-pix_fmt', 'yuv420p', path.join(out, 'final.mp4')], { stdio: 'ignore' });
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=1280x720', '-frames:v', '1', path.join(out, 'thumbnail.png')], { stdio: 'ignore' });
    fs.writeFileSync(path.join(out, 'metadata.json'), JSON.stringify({ title: 'O segredo das abelhas', description: 'Tudo sobre abelhas.', tags: ['abelhas', 'natureza'], chapters: [{ time: '0:00', title: 'Início' }] }));
    const m = uploadMeta(out, 'x');
    assert.equal(m.title, 'O segredo das abelhas'); assert.match(m.description, /0:00 Início/); assert.match(m.description, /#abelhas/);
    const logs: string[] = [];
    const r = await uploadProjectToYouTube(s, p, projectDirOf(s, p.id), { account: acc.id, log: (l) => logs.push(l) });
    assert.equal(posts.length, 1, `salvou uma vez\n${logs.join('\n')}`);
    const d = posts[0]!;
    assert.equal(d['video'], 'final.mp4'); assert.equal(d['thumb'], 'thumbnail.png');
    assert.equal(d['title'], 'O segredo das abelhas', 'título do SEO (substitui o nome do arquivo)');
    assert.match(String(d['desc']), /Tudo sobre abelhas/);
    assert.equal(d['kids'], 'VIDEO_MADE_FOR_KIDS_NOT_MFK'); assert.equal(d['vis'], 'UNLISTED', 'NÃO LISTADO');
    assert.equal(d['uploadingWhenSaved'], false, 'só salva depois do envio terminar');
    assert.equal(r.url, 'https://youtu.be/TESTE123abc');
    /* publish.json é uma lista (um registro por plataforma/canal) desde a aba Canais */
    const pubs = JSON.parse(fs.readFileSync(path.join(out, 'publish.json'), 'utf8')) as Array<{ platform?: string; visibility?: string; url?: string }>;
    const pub = (Array.isArray(pubs) ? pubs : [pubs]).find((x) => !x.platform || x.platform === 'youtube')!;
    assert.equal(pub.visibility, 'UNLISTED'); assert.equal(pub.url, 'https://youtu.be/TESTE123abc');
  } finally {
    server.close();
    try { const res = await fetch(`http://127.0.0.1:${port}/json/version`); const { webSocketDebuggerUrl } = await res.json() as { webSocketDebuggerUrl: string };
      const { default: WebSocket } = await import('ws'); const sock = new WebSocket(webSocketDebuggerUrl);
      await new Promise((rr) => sock.once('open', rr)); sock.send(JSON.stringify({ id: 1, method: 'Browser.close' })); await new Promise((rr) => setTimeout(rr, 800)); sock.close();
    } catch { /* já fechado */ }
  }
  console.log('youtube tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
