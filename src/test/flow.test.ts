import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as auto from '../main/automations';
import { createExecutors } from '../main/executors';
import { runRoute } from '../main/engine';
import { createProject, defaultSettings } from '../main/settings';
import { flowAspect, flowPrompt } from '../main/flow';
import type { Route } from '../shared/types';

/**
 * Executor Google Flow contra uma página local que imita o Flow ATUAL (agente):
 * campo ProseMirror "O que você quer criar?", painel "Configurações · tune" com proporção,
 * quantidade e "Confirmar antes de gerar", botão "Iniciar geração" desabilitado sem texto.
 * Usa o Chromium real com a porta de automação.
 */
async function main() {
  assert.equal(flowAspect('image', '4:5'), '3:4'); assert.equal(flowAspect('video', '1:1'), '16:9'); assert.equal(flowAspect('video', '4:5'), '9:16');
  assert.match(flowPrompt({ prompt: 'gato', media: 'video', aspect: '9:16', seconds: 30 }), /^Gere 1 vídeo de 10 segundos na proporção 9:16/);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-flow-'));
  const s = defaultSettings(ws);
  const b = auto.detectBrowser(s);
  if (!b.path) { console.log('(sem Chromium: teste do Flow pulado)'); return; }
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.log('(sem ffmpeg: teste do Flow pulado)'); return; }
  const png = path.join(ws, 'gen.png'), mp4 = path.join(ws, 'gen.mp4');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360', '-frames:v', '1', png], { stdio: 'ignore' });
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:d=2:r=24', '-pix_fmt', 'yuv420p', mp4], { stdio: 'ignore' });
  const posts: Array<{ text: string; state: Record<string, string> }> = [];
  const toggles = (label: string, opts: string[], on: string) => `<div aria-label="${label}">${opts.map((o) => `<button role="radio" aria-checked="${o === on}"><span>${o}</span></button>`).join('')}</div>`;
  const page = `<!doctype html><html><body style="background:#111;color:#eee;font-family:sans-serif">
    <input aria-label="Texto editável" value="Projeto" style="width:900px">
    <input aria-label="Pesquisar" style="width:800px">
    <div id="out"></div>
    <div id="panel" hidden>
      <p>Configurações do agente neste projeto.</p>
      <mat-radio-button style="display:block"><input type="radio" name="c" id="always" checked><span>Sempre O agente vai pedir confirmação antes de gerar mídia.</span></mat-radio-button>
      <mat-radio-button style="display:block"><input type="radio" name="c" id="never"><span>Nunca O agente vai gerar mídia e gastar créditos automaticamente.</span></mat-radio-button>
      ${toggles('Proporção padrão da geração de imagens', ['16:9', '4:3', '1:1', '3:4', '9:16'], '9:16')}
      ${toggles('Quantidade padrão de imagens geradas', ['x1', 'x2', 'x3', 'x4'], 'x2')}
      ${toggles('Proporção padrão para geração de vídeo', ['16:9', '9:16'], '9:16')}
      ${toggles('Quantidade padrão de vídeos gerados', ['x1', 'x2', 'x3', 'x4'], 'x3')}
      <button id="save">Salvar</button>
    </div>
    <div class="ProseMirror" contenteditable="true" role="textbox" aria-label="O que você quer criar?" style="width:500px;min-height:20px;border:1px solid #888"></div>
    <button aria-label="Configurações"><span>tune</span></button>
    <button aria-label="Iniciar geração" disabled><span>arrow_forward</span></button>
    <script>
      const ed = document.querySelector('.ProseMirror'), go = document.querySelector('[aria-label="Iniciar geração"]'), panel = document.getElementById('panel');
      // como no Flow real: a seta só habilita um instante DEPOIS de digitar (o app precisa esperar)
      ed.addEventListener('input', () => { setTimeout(() => { go.disabled = !ed.innerText.trim(); }, 900); });
      /* como no Flow: com a gaveta aberta o campo do agente some; só "Salvar" fecha */
      document.querySelector('[aria-label="Configurações"]').onclick = () => { panel.hidden = false; ed.style.display = 'none'; };
      document.getElementById('save').onclick = () => { panel.hidden = true; ed.style.display = ''; };
      document.querySelectorAll('[role=radio]').forEach((r) => r.onclick = () => { r.parentElement.querySelectorAll('[role=radio]').forEach((x) => x.setAttribute('aria-checked', String(x === r))); });
      const sel = (l) => [...document.querySelector('[aria-label="' + l + '"]').querySelectorAll('[role=radio]')].find((x) => x.getAttribute('aria-checked') === 'true').innerText;
      go.onclick = async () => {
        const text = ed.innerText.trim();
        const state = { confirm: document.getElementById('never').checked ? 'Nunca' : 'Sempre', imgAspect: sel('Proporção padrão da geração de imagens'), imgCount: sel('Quantidade padrão de imagens geradas'),
          vidAspect: sel('Proporção padrão para geração de vídeo'), vidCount: sel('Quantidade padrão de vídeos gerados') };
        await fetch('/prompt', { method: 'POST', body: JSON.stringify({ text, state }) });
        ed.innerText = ''; go.disabled = true;
        if (state.confirm === 'Sempre') return;                      // o agente pararia para perguntar
        setTimeout(() => {
          const isImg = /imagem/i.test(text);
          const el = document.createElement(isImg ? 'img' : 'video');
          el.src = isImg ? '/gen.png' : '/gen.mp4'; el.style.width = '320px'; el.style.height = '180px';
          document.getElementById('out').append(el);
        }, 2500);
      };
    </script></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/prompt') { let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => { posts.push(JSON.parse(body)); res.end('ok'); }); return; }
    if (req.url === '/gen.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return void res.end(fs.readFileSync(png)); }
    if (req.url === '/gen.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return void res.end(fs.readFileSync(mp4)); }
    if (req.url === '/') { res.writeHead(302, { Location: '/project/abc123' }); return void res.end(); }   // home → projeto
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  auto.addAccount(s, 'Teste'); auto.config(s).flowUrl = base + '/';
  const port = auto.portFor('g1');
  try {
    const p = createProject(s, { name: 'Flow', idea: 'x', videoType: 'custom', skillId: 'realistic', routeId: 'realistic-cinematic', aspect: '16:9' });
    p.scenes = [{ id: 's01', index: 1, title: 'A', narration: 'x', visualIntent: 'um gato astronauta', kind: 'video', durationSec: 5, status: {}, artifacts: {} }];
    const route: Route = { id: 'f', name: 'f', description: '', videoTypes: [], steps: [
      { id: 'image', kind: 'image', label: 'img', scope: 'scene', dependsOn: [], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 120, bindings: [{ type: 'flow' }] },
      { id: 'video', kind: 'video', label: 'vid', scope: 'scene', dependsOn: ['image'], enabled: true, params: {}, retry: { max: 1, backoffMs: 0 }, timeoutSec: 120, bindings: [{ type: 'flow', account: 'g1' }] },
    ] };
    const logs: string[] = [];
    const r = await runRoute({ project: p, route, projectDir: path.join(ws, 'projects', p.id), signal: new AbortController().signal,
      deps: { settings: s, emit: (e) => { if (e.t === 'log' || e.t === 'step.failed') logs.push(JSON.stringify(e)); }, sleep: async () => {}, executors: createExecutors({ workflowsDir: path.resolve(__dirname, '../../workflows') }) } });
    assert.equal(r.ok, true, `${r.error}\n${logs.slice(-10).join('\n')}`);
    const sd = path.join(ws, 'projects', p.id, 'scenes', 's01');
    assert.ok(fs.statSync(path.join(sd, 'frames', 'frame.png')).size > 1000, 'imagem do Flow salva como frame.png');
    assert.ok(fs.statSync(path.join(sd, 'clips', 'clip.mp4')).size > 1000, 'vídeo do Flow salvo como clip.mp4');
    assert.equal(posts.length, 2, 'dois pedidos ao agente');
    assert.match(posts[0]!.text, /^Gere 1 imagem na proporção 16:9, sem texto escrito na imagem: um gato astronauta/, 'pedido de imagem digitado no campo do agente (não no título)');
    assert.deepEqual([posts[0]!.state.confirm, posts[0]!.state.imgAspect, posts[0]!.state.imgCount], ['Nunca', '16:9', 'x1'], 'configurou proporção, x1 e sem confirmação');
    assert.match(posts[1]!.text, /^Gere 1 vídeo de 5 segundos na proporção 16:9/);
    assert.deepEqual([posts[1]!.state.vidAspect, posts[1]!.state.vidCount], ['16:9', 'x1']);
    assert.equal(auto.flowProjectOf(s, 'g1'), base + '/project/abc123', 'projeto do Flow lembrado para a próxima vez');
  } finally {
    server.close();
    try { const res = await fetch(`http://127.0.0.1:${port}/json/version`); const { webSocketDebuggerUrl } = await res.json() as { webSocketDebuggerUrl: string };
      const { default: WebSocket } = await import('ws'); const sock = new WebSocket(webSocketDebuggerUrl);
      await new Promise((r) => sock.once('open', r)); sock.send(JSON.stringify({ id: 1, method: 'Browser.close' })); await new Promise((r) => setTimeout(r, 800)); sock.close();
    } catch { /* já fechado */ }
  }
  console.log('flow executor tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
