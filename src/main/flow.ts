import * as fs from 'node:fs';
import * as path from 'node:path';
import WebSocket from 'ws';

/*
 * Google Flow como executor de imagem/vídeo, no navegador da conta (Automações).
 * O navegador é aberto normalmente (o login é feito pelo usuário) com a porta de
 * depuração local; o app se conecta por CDP, abre o Flow numa aba, digita o prompt
 * com eventos de teclado reais, envia e baixa a primeira mídia nova que aparecer.
 * Se algo na interface do Flow mudar, o executor grava um diagnóstico
 * (flow-debug.json + flow-debug.png) para ajustar os seletores.
 */

type Json = Record<string, unknown>;

/** Cliente CDP mínimo (WebSocket): comandos com sessão "flatten". */
export class Cdp {
  private id = 0;
  private pending = new Map<number, { res: (v: Json) => void; rej: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.on('message', (data) => {
      const m = JSON.parse(String(data)) as { id?: number; result?: Json; error?: { message: string } };
      if (m.id === undefined) return;
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result ?? {});
    });
    ws.on('close', () => { for (const p of this.pending.values()) p.rej(new Error('conexão com o navegador fechada')); this.pending.clear(); });
  }
  static async connect(port: number): Promise<Cdp> {
    let info: { webSocketDebuggerUrl?: string };
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as typeof info; }
    catch { throw new Error(`o navegador da conta não está aberto com a porta de automação (${port}). Feche o navegador da conta e use "Abrir Flow" de novo.`); }
    if (!info.webSocketDebuggerUrl) throw new Error('navegador sem endpoint de automação');
    const ws = new WebSocket(info.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return new Cdp(ws);
  }
  send(method: string, params: Json = {}, sessionId?: string, timeoutMs = 60_000): Promise<Json> {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`tempo esgotado em ${method}`)); }, timeoutMs);
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { try { this.ws.close(); } catch { /* já fechado */ } }
}

/** Avalia JS na página e devolve o valor (promessas são aguardadas). */
async function evaluate<T>(cdp: Cdp, session: string, expression: string, timeoutMs = 60_000): Promise<T> {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session, timeoutMs) as { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } };
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text ?? 'erro na página');
  return r.result?.value as T;
}

/* ── funções que rodam DENTRO da página do Flow (texto puro, sem dependências) ── */
const PAGE_HELPERS = String.raw`
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const txt = (el) => ((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || el.textContent || '') + ' ' + (el.getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
  const clickables = () => [...document.querySelectorAll('button, [role=button], [role=option], [role=menuitem], [role=tab], [role=combobox], a, li')].filter(vis);
  const findBtn = (re) => clickables().find((el) => re.test(txt(el)));
  const editor = () => [...document.querySelectorAll('[contenteditable][role=textbox], .ProseMirror, textarea')].filter(vis)[0];
  const inputs = () => [...document.querySelectorAll('textarea, [contenteditable=true], [contenteditable=""], input[type=text]')].filter(vis);
  const medias = () => [...document.querySelectorAll('video, img')].filter((m) => { const r = m.getBoundingClientRect(); const src = m.currentSrc || m.src || (m.querySelector && m.querySelector('source') && m.querySelector('source').src) || ''; return r.width >= 120 && r.height >= 80 && src && !/^data:image\/svg|\.svg(\?|$)|googleusercontent\.com\/a\/|avatar|logo/i.test(src); }).map((m) => ({ tag: m.tagName.toLowerCase(), src: m.currentSrc || m.src || (m.querySelector('source') || {}).src }));
`;

/** Estado da página: login, campo de prompt, mídias atuais (para detectar as novas). */
const PROBE = `(() => { ${PAGE_HELPERS}
  const url = location.href;
  const loggedOut = /accounts\\.google\\.com|\\/about(\\b|$)|signin/i.test(url) || !!findBtn(/^(fazer login|sign in|entrar)$/i);
  return { url, loggedOut, hasInput: !!editor(), medias: medias().map((m) => m.src) };
})()`;

/** Abre/cria um projeto se ainda não houver o campo do agente. */
const ENSURE_PROJECT = `(async () => { ${PAGE_HELPERS}
  if (editor()) return 'ok';
  const b = findBtn(/novo projeto|new project|criar projeto|create project|começar|get started|start creating|criar com o flow|create with flow/i);
  if (b) b.click();
  for (let i = 0; i < 20 && !editor(); i++) await new Promise((r) => setTimeout(r, 500));
  return editor() ? 'ok' : 'sem-campo';
})()`;

/**
 * Configurações do projeto (botão "Configurações · tune"): proporção e quantidade x1 da mídia pedida
 * e "Confirmar antes de gerar: Nunca" — a automação já decidiu gerar; com "Sempre" o agente para e pergunta.
 */
const configure = (media: 'image' | 'video', aspect: string) => `(async () => { ${PAGE_HELPERS}
  const b = [...document.querySelectorAll('button')].filter(vis).find((x) => /^Configura|^Settings/i.test(x.getAttribute('aria-label') || '') && /tune/.test(x.innerText || ''));
  if (!b) return 'sem-configurações';
  b.click(); await new Promise((r) => setTimeout(r, 1200));
  const out = [];
  const pick = (re, val) => { const g = [...document.querySelectorAll('[aria-label]')].find((x) => re.test(x.getAttribute('aria-label'))); if (!g) return;
    const r = [...g.querySelectorAll('[role=radio]')].find((x) => (x.innerText || '').replace(/\\s+/g, ' ').includes(val)); if (!r) return;
    if (r.getAttribute('aria-checked') !== 'true') r.click(); out.push(val); };
  ${media === 'image'
    ? `pick(/Propor.*imagens|aspect.*image/i, ${JSON.stringify(aspect)}); pick(/Quantidade.*imagens|number.*images/i, 'x1');`
    : `pick(/Propor.*v[ií]deo|aspect.*video/i, ${JSON.stringify(aspect)}); pick(/Quantidade.*v[ií]deos|number.*videos/i, 'x1');`}
  const never = [...document.querySelectorAll('mat-radio-button, [role=radio], label')].filter(vis).find((x) => /^(Nunca|Never)\\b/.test((x.innerText || '').trim()));
  if (never) { const inp = never.querySelector('input') || never; if (!(inp.checked || never.getAttribute('aria-checked') === 'true')) inp.click(); out.push('sem confirmação'); }
  /* o painel é uma gaveta com "Salvar": só ao salvar ele fecha e o campo do agente volta */
  const save = [...document.querySelectorAll('button')].filter(vis).find((x) => /^(Salvar|Save)$/i.test((x.innerText || '').trim()));
  if (save) { save.click(); out.push('salvo'); }
  else { const close = [...document.querySelectorAll('button')].filter(vis).find((x) => /^(close|Fechar|Close)$/i.test((x.innerText || x.getAttribute('aria-label') || '').trim())); if (close) close.click(); }
  for (let i = 0; i < 12 && !editor(); i++) await new Promise((r) => setTimeout(r, 250));
  return out.join(', ') || 'nada mudou';
})()`;

/** Centro do campo do agente (o ProseMirror só aceita texto depois de um clique real). */
const EDITOR_POINT = `(() => { ${PAGE_HELPERS}
  const e = editor(); if (!e) return null;
  e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect();
  return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
})()`;

/** Clica em enviar/gerar (ou devolve false para tentar Enter). */
/** Centro da seta de envio ("Iniciar geração") visível, a mais próxima do campo do agente. */
const SEND_POINT = `(() => { ${PAGE_HELPERS}
  const e = editor(); const er = e ? e.getBoundingClientRect() : null;
  const cands = [...document.querySelectorAll('button')].filter(vis).filter((x) => /Iniciar gera|Start generat|^Enviar|^Send/i.test(x.getAttribute('aria-label') || '') || /^arrow_(forward|upward)$/.test((x.innerText || '').trim()));
  if (!cands.length) return null;
  const dist = (b) => { if (!er) return 0; const r = b.getBoundingClientRect(); return Math.hypot(r.x - er.right, r.y - er.bottom); };
  const b = cands.sort((a, c) => dist(a) - dist(c))[0];
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!b.disabled || b.getAttribute('aria-disabled') === 'true' };
})()`;

const SUBMIT = `(() => { ${PAGE_HELPERS}
  const go = [...document.querySelectorAll('button')].find((x) => /Iniciar gera|Start generat/i.test(x.getAttribute('aria-label') || ''));
  if (go) { if (go.disabled) return false; go.click(); return true; }
  const b = clickables().filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true')
    .find((el) => /^(arrow_forward|send)$|gerar|generate|criar$|create$|enviar|submit|send/i.test(txt(el)) && txt(el).length < 40);
  if (b) { b.click(); return true; }
  return false;
})()`;

/** Baixa a mídia (http ou blob) pela própria página e devolve base64. */
const fetchMedia = (src: string) => `(async () => {
  const r = await fetch(${JSON.stringify(src)}, { credentials: 'include' });
  if (!r.ok) throw new Error('download HTTP ' + r.status);
  const b = await r.blob();
  const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(b); });
  return { type: b.type, data: data.slice(data.indexOf(',') + 1) };
})()`;

/** Diagnóstico da interface (para ajustar seletores quando o Flow muda). */
const DIAG = `(() => { ${PAGE_HELPERS}
  return { url: location.href, title: document.title,
    editor: !!editor(), inputs: inputs().map((e) => ({ tag: e.tagName, ph: e.getAttribute('placeholder') || e.getAttribute('aria-label') || '' })),
    buttons: clickables().slice(0, 160).map((e) => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || '', text: txt(e).slice(0, 80), state: e.getAttribute('aria-selected') || e.getAttribute('data-state') || '' })).filter((b) => b.text),
    medias: medias().slice(0, 20) };
})()`;

export interface FlowJob {
  port: number; flowUrl: string; prompt: string; media: 'image' | 'video'; dest: string; timeoutSec: number; signal?: AbortSignal; log: (l: string) => void; debugDir?: string;
  /** proporção do projeto (16:9, 9:16, 1:1, 4:5) e duração do vídeo */
  aspect?: string; seconds?: number;
  /** projeto do Flow já usado por esta conta (abre direto nele) e aviso do projeto atual para lembrar */
  projectUrl?: string; onProject?: (url: string) => void;
}
/** Proporções que o Flow oferece: imagem 16:9/4:3/1:1/3:4/9:16; vídeo 16:9/9:16. */
export function flowAspect(media: 'image' | 'video', aspect = '16:9'): string {
  if (media === 'video') return aspect === '9:16' || aspect === '4:5' ? '9:16' : '16:9';
  return aspect === '4:5' ? '3:4' : ['16:9', '9:16', '1:1'].includes(aspect) ? aspect : '16:9';
}
/** O Flow agora é um agente: o pedido diz o que gerar (1 mídia, proporção, duração). */
export function flowPrompt(job: Pick<FlowJob, 'prompt' | 'media' | 'aspect' | 'seconds'>): string {
  const a = flowAspect(job.media, job.aspect);
  return job.media === 'image'
    ? `Gere 1 imagem na proporção ${a}, sem texto escrito na imagem: ${job.prompt}`
    : `Gere 1 vídeo de ${Math.max(4, Math.min(10, Math.round(job.seconds ?? 8)))} segundos na proporção ${a}, sem texto na tela: ${job.prompt}`;
}

/** Gera UMA mídia no Flow e grava em `dest` (extensão ajustada ao tipo baixado). */
export async function flowGenerate(job: FlowJob): Promise<string> {
  const cdp = await Cdp.connect(job.port);
  let session = '';
  let targetId = '';
  const dbg = async (why: string) => {
    if (!job.debugDir || !session) return;
    try {
      fs.mkdirSync(job.debugDir, { recursive: true });
      const d = await evaluate<Json>(cdp, session, DIAG, 15_000);
      fs.writeFileSync(path.join(job.debugDir, 'flow-debug.json'), JSON.stringify({ why, at: new Date().toISOString(), ...d }, null, 2));
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session, 20_000) as { data?: string };
      if (shot.data) fs.writeFileSync(path.join(job.debugDir, 'flow-debug.png'), Buffer.from(shot.data, 'base64'));
      job.log(`diagnóstico do Flow gravado em ${job.debugDir} (flow-debug.json/.png)`);
    } catch { /* sem diagnóstico */ }
  };
  const abort = () => { void cdp.send('Target.closeTarget', { targetId }).catch(() => {}); cdp.close(); };
  job.signal?.addEventListener('abort', abort, { once: true });
  try {
    const t = await cdp.send('Target.createTarget', { url: job.projectUrl || job.flowUrl }) as { targetId: string };
    targetId = t.targetId;
    session = (await cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string }).sessionId;
    await cdp.send('Page.enable', {}, session);
    await cdp.send('Page.bringToFront', {}, session);
    const deadline = Date.now() + job.timeoutSec * 1000;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // 1) página carregada e logada
    let probe = { url: '', loggedOut: false, hasInput: false, medias: [] as string[] };
    for (let i = 0; i < 40; i++) {
      await wait(1000);
      try { probe = await evaluate<typeof probe>(cdp, session, PROBE, 10_000); } catch { continue; }
      if (probe.loggedOut || probe.hasInput || i > 12) break;
    }
    if (probe.loggedOut) { await dbg('sem login'); throw new Error('a conta não está logada no Flow: em Automações use "Entrar no Google" e depois abra o Flow uma vez'); }
    if ((await evaluate<string>(cdp, session, ENSURE_PROJECT, 25_000)) !== 'ok') { await dbg('campo de prompt não encontrado'); throw new Error('não encontrei o campo do agente do Flow (diagnóstico gravado)'); }
    const here = await evaluate<string>(cdp, session, 'location.href', 5000);
    if (/\/project\//.test(here)) job.onProject?.(here);
    // 2) configurações: proporção, quantidade x1, sem pedido de confirmação
    const cfgDone = await evaluate<string>(cdp, session, configure(job.media, flowAspect(job.media, job.aspect)), 15_000).catch((e) => `falhou (${(e as Error).message})`);
    job.log(`Flow: configurações → ${cfgDone}`);
    await wait(500);
    const before = new Set((await evaluate<typeof probe>(cdp, session, PROBE, 10_000)).medias);
    // 3) prompt com teclado real e envio
    const pt = await evaluate<{ x: number; y: number } | null>(cdp, session, EDITOR_POINT, 10_000);
    if (!pt) { await dbg('foco no campo'); throw new Error('não consegui focar o campo do agente'); }
    for (const type of ['mousePressed', 'mouseReleased'] as const) await cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 }, session);
    await wait(250);
    // limpa o que houver no campo (Ctrl+A, Backspace) e digita o pedido
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 }, session);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 }, session);
    for (const type of ['keyDown', 'keyUp'] as const) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, session);
    await cdp.send('Input.insertText', { text: flowPrompt(job).slice(0, 4000) }, session);
    await wait(600);
    /* envio: espera a seta "Iniciar geração" habilitar (o editor demora a avisar que há texto),
       clica com o mouse de verdade e confere que o campo esvaziou; senão, tenta de novo */
    const typed = await evaluate<string>(cdp, session, `(() => { ${PAGE_HELPERS} return (editor()?.innerText || '').trim(); })()`, 5000);
    if (!typed) { await dbg('texto não entrou no campo'); throw new Error('o texto não entrou no campo do agente'); }
    let sent = false;
    for (let attempt = 0; attempt < 3 && !sent; attempt++) {
      let btn: { x: number; y: number; disabled: boolean } | null = null;
      for (let i = 0; i < 24; i++) {
        btn = await evaluate<{ x: number; y: number; disabled: boolean } | null>(cdp, session, SEND_POINT, 5000);
        if (btn && !btn.disabled) break;
        await wait(250);
      }
      if (btn && !btn.disabled) {
        for (const type of ['mousePressed', 'mouseReleased'] as const) await cdp.send('Input.dispatchMouseEvent', { type, x: btn.x, y: btn.y, button: 'left', clickCount: 1 }, session);
      } else if (!(await evaluate<boolean>(cdp, session, SUBMIT, 10_000))) {
        for (const type of ['keyDown', 'keyUp'] as const) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, session);
      }
      await wait(1500);
      const left = await evaluate<string>(cdp, session, `(() => { ${PAGE_HELPERS} return (editor()?.innerText || '').trim(); })()`, 5000).catch(() => '');
      sent = !left || left !== typed;
      if (!sent) job.log(`Flow: o pedido ainda está no campo — tentando enviar de novo (${attempt + 2}/3)`);
    }
    if (!sent) { await dbg('pedido não enviado'); throw new Error('o Flow não aceitou o envio do pedido (a seta não respondeu)'); }
    job.log(`Flow: pedido enviado ao agente ("${flowPrompt(job).slice(0, 80)}…") — aguardando a geração…`);
    // 4) espera a primeira mídia nova (imagem ou vídeo, conforme o pedido)
    let src = '';
    while (Date.now() < deadline) {
      if (job.signal?.aborted) throw new Error('cancelado');
      await wait(4000);
      let ms: Array<{ tag: string; src: string }> = [];
      try { ms = (await evaluate<{ medias: string[] }>(cdp, session, `(() => { ${PAGE_HELPERS} return { medias: medias() }; })()`, 10_000)).medias as unknown as typeof ms; } catch { continue; }
      const fresh = ms.find((m) => !before.has(m.src) && (job.media === 'video' ? m.tag === 'video' : m.tag === 'img'));
      if (fresh) { src = fresh.src; break; }
    }
    if (!src) { await dbg('nenhuma mídia nova'); throw new Error(`o Flow não entregou ${job.media === 'image' ? 'imagem' : 'vídeo'} em ${job.timeoutSec}s`); }
    await wait(job.media === 'video' ? 3000 : 1500);   // deixa terminar de carregar
    const got = await evaluate<{ type: string; data: string }>(cdp, session, fetchMedia(src), 180_000);
    const ext = /png/.test(got.type) ? '.png' : /jpe?g/.test(got.type) ? '.jpg' : /webp/.test(got.type) ? '.webp' : /webm/.test(got.type) ? '.webm' : job.media === 'video' ? '.mp4' : '.png';
    const out = job.dest.replace(/\.\w+$/, ext);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(got.data, 'base64'));
    job.log(`Flow: ${(fs.statSync(out).size / 1048576).toFixed(1)} MB baixados (${got.type || ext})`);
    return out;
  } catch (e) {
    if (!/cancelado/.test((e as Error).message)) await dbg((e as Error).message);
    throw e;
  } finally {
    job.signal?.removeEventListener('abort', abort);
    if (targetId) await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    cdp.close();
  }
}

/**
 * Lê os créditos mostrados pelo Flow na página da conta (texto "N créditos"/"N credits").
 * Só leitura: não gera nada. Se o número não estiver visível, devolve o trecho encontrado.
 */
export async function flowCredits(port: number, flowUrl: string): Promise<{ value?: number; text: string; loggedOut: boolean }> {
  const cdp = await Cdp.connect(port);
  let targetId = '';
  try {
    targetId = (await cdp.send('Target.createTarget', { url: flowUrl }) as { targetId: string }).targetId;
    const session = (await cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string }).sessionId;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const r = await evaluate<{ loggedOut: boolean; hit: string | null }>(cdp, session, `(() => { ${PAGE_HELPERS}
        const loggedOut = /accounts\\.google\\.com|\\/about(\\b|$)|signin/i.test(location.href);
        const m = (document.body.innerText || '').match(/(\\d[\\d.,]*)\\s*(créditos|creditos|credits)(\\s+de\\s+IA)?/i);
        return { loggedOut, hit: m ? m[0] : null };
      })()`, 10_000).catch(() => ({ loggedOut: false, hit: null }));
      if (r.loggedOut) return { loggedOut: true, text: 'sem login' };
      if (r.hit) { const n = Number(r.hit.match(/\d[\d.,]*/)![0].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')); return { value: Number.isFinite(n) ? n : undefined, text: r.hit, loggedOut: false }; }
    }
    return { text: 'créditos não visíveis na página inicial do Flow', loggedOut: false };
  } finally {
    if (targetId) await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    cdp.close();
  }
}

/** Fecha o navegador da conta (usado depois de uma verificação que o abriu). */
export async function closeBrowser(port: number): Promise<void> {
  try { const cdp = await Cdp.connect(port); await cdp.send('Browser.close', {}, undefined, 5000).catch(() => {}); cdp.close(); } catch { /* já fechado */ }
}

/** Só o diagnóstico (botão "Testar Flow" sem gerar): abre o Flow e grava a estrutura da página. */
export async function flowDiagnose(port: number, flowUrl: string, debugDir: string): Promise<{ url: string; loggedOut: boolean; hasInput: boolean }> {
  const cdp = await Cdp.connect(port);
  let targetId = '';
  try {
    targetId = (await cdp.send('Target.createTarget', { url: flowUrl }) as { targetId: string }).targetId;
    const session = (await cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string }).sessionId;
    await new Promise((r) => setTimeout(r, 8000));
    const probe = await evaluate<{ url: string; loggedOut: boolean; hasInput: boolean }>(cdp, session, PROBE, 15_000);
    if (!probe.loggedOut) { const ok = await evaluate<string>(cdp, session, ENSURE_PROJECT, 25_000).catch(() => ''); probe.hasInput = ok === 'ok'; }
    fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(path.join(debugDir, 'flow-debug.json'), JSON.stringify({ why: 'diagnóstico', at: new Date().toISOString(), ...(await evaluate<Json>(cdp, session, DIAG, 15_000)) }, null, 2));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session, 20_000) as { data?: string };
    if (shot.data) fs.writeFileSync(path.join(debugDir, 'flow-debug.png'), Buffer.from(shot.data, 'base64'));
    return probe;
  } finally {
    if (targetId) await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    cdp.close();
  }
}
