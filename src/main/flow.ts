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
  /** ouvintes de eventos do CDP (ex.: Page.fileChooserOpened) */
  private listeners = new Set<(method: string, params: Json, sessionId?: string) => void>();
  private constructor(private ws: WebSocket) {
    ws.on('message', (data) => {
      const m = JSON.parse(String(data)) as { id?: number; result?: Json; error?: { message: string }; method?: string; params?: Json; sessionId?: string };
      if (m.id === undefined) { if (m.method) for (const l of this.listeners) { try { l(m.method, m.params ?? {}, m.sessionId); } catch { /* ouvinte com erro */ } } return; }
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
  /** espera um evento do CDP (opcionalmente de uma sessão) até `timeoutMs`; undefined se não vier */
  waitEvent(method: string, sessionId: string | undefined, timeoutMs: number): Promise<Json | undefined> {
    return new Promise((res) => {
      const l = (m: string, p: Json, s?: string) => { if (m === method && (!sessionId || s === sessionId)) { clearTimeout(t); this.listeners.delete(l); res(p); } };
      const t = setTimeout(() => { this.listeners.delete(l); res(undefined); }, timeoutMs);
      this.listeners.add(l);
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
  const medias = () => [...document.querySelectorAll('video, img')].filter((m) => { const r = m.getBoundingClientRect(); const src = m.currentSrc || m.src || (m.querySelector && m.querySelector('source') && m.querySelector('source').src) || ''; return Math.max(r.width, r.height) >= 120 && Math.min(r.width, r.height) >= 60 && src && !/^data:image\/svg|\.svg(\?|$)|googleusercontent\.com\/a\/|avatar|logo/i.test(src); }).map((m) => ({ tag: m.tagName.toLowerCase(), src: m.currentSrc || m.src || (m.querySelector('source') || {}).src }));
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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /* tela nova (nov/2026): chip "Gatilho de configurações" na barra do pedido ("Nano Banana 2.1 ▭ x2") abre um popover
     com Imagem/Vídeo, 16:9·4:3·1:1·3:4·9:16 e x1..x4. O click() simples não abre: precisa da sequência de ponteiro. */
  const press = (el) => { const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, o) : new MouseEvent(t, o)); };
  const trig = [...document.querySelectorAll('button')].filter(vis).find((x) => /Gatilho de configura|settings trigger/i.test(x.getAttribute('aria-label') || '') || /crop_\\d+_\\d+|crop_square|crop_portrait|crop_landscape/.test(x.innerText || ''));
  if (trig) {
    const out = [];
    press(trig); await wait(900);
    const opt = (re) => [...document.querySelectorAll('button, [role=tab], [role=radio], [role=option]')].filter(vis).find((x) => x !== trig && re.test((x.innerText || x.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim()));
    const tab = opt(${media === 'image' ? '/(^|\\s)(Imagem|Image)$/i' : '/(^|\\s)(V[ií]deo|Video)$/i'}); if (tab) { press(tab); await wait(400); out.push(${JSON.stringify(media)}); }
    const ar = opt(new RegExp('(^|\\\\s)' + ${JSON.stringify(aspect)}.replace(':', '\\\\:') + '$')); if (ar) { press(ar); await wait(300); out.push(${JSON.stringify(aspect)}); }
    const one = opt(/^x1$/i); if (one) { press(one); await wait(300); out.push('x1'); }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await wait(400);
    const now = (trig.innerText || '').replace(/\\s+/g, ' ');
    return (out.join(', ') || 'popover sem opções') + ' → ' + now;
  }
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
  /** folhas/retratos dos personagens da cena (na ordem em que aparecem): enviadas como referência antes do pedido */
  refs?: Array<{ name: string; file: string }>;
}

/** Com referências, o pedido diz quem é quem (a ordem dos anexos = a ordem dos personagens). Função pura. */
export function flowRefsText(refs: Array<{ name: string }> | undefined): string {
  if (!refs?.length) return '';
  const style = refs.filter((r) => /MODELO DA THUMBNAIL/i.test(r.name)), cast = refs.filter((r) => !/MODELO DA THUMBNAIL/i.test(r.name));
  const idx = (r: { name: string }) => refs.indexOf(r) + 1;
  return (style.length ? ` A imagem ${style.map(idx).join(', ')} anexada é o MODELO DE ESTILO da thumbnail: copie composição, tipografia, cores e acabamento, não o conteúdo nem os textos dela.` : '') +
    (cast.length ? ` Use as imagens anexadas como referência de personagem (mesmo rosto, cabelo, corpo e roupa): ${cast.map((r) => `imagem ${idx(r)} = ${r.name}`).join('; ')}.` : '');
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
    /* personagens: envia as folhas pelo campo de arquivo do Flow (melhor esforço — sem o campo, segue só com o texto) */
    let refsOk = 0;
    if (job.refs?.length) {
      try {
        await cdp.send('DOM.enable', {}, session);
        const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }, session) as { root: { nodeId: number } };
        const q = await cdp.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type=file]' }, session) as { nodeIds: number[] };
        const nodeId = q.nodeIds?.[0];
        const files = job.refs.map((r) => path.resolve(r.file));
        if (nodeId) {
          await cdp.send('DOM.setFileInputFiles', { nodeId, files }, session);
          refsOk = job.refs.length;
        } else {
          /* o campo de arquivo do Flow só existe depois de clicar em "adicionar/anexar": intercepta o seletor de arquivos
             do navegador, clica no botão e entrega as imagens ao seletor que abrir (sem janela do Windows) */
          await cdp.send('Page.enable', {}, session).catch(() => {});
          await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }, session).catch(() => {});
          for (let i = 0; i < files.length && i < 4; i++) {
            const opened = cdp.waitEvent('Page.fileChooserOpened', session, 9000);
            const at = await evaluate<string>(cdp, session, FLOW_ATTACH_CLICK, 10_000).catch(() => 'none');
            let clicked = 'none';
            if (at && at !== 'none') {
              await realClick(cdp, session, JSON.parse(at) as { x: number; y: number }); clicked = 'ok';
              await wait(800);
              const up = await evaluate<string>(cdp, session, FLOW_UPLOAD_ITEM, 5000).catch(() => '');
              if (up) await realClick(cdp, session, JSON.parse(up) as { x: number; y: number });
            }
            const ev = await opened as { backendNodeId?: number; mode?: string } | undefined;
            if (ev?.backendNodeId) {
              await cdp.send('DOM.setFileInputFiles', { backendNodeId: ev.backendNodeId, files: ev.mode === 'selectMultiple' ? files.slice(i) : [files[i]!] }, session);
              refsOk += ev.mode === 'selectMultiple' ? files.length - i : 1;
              await wait(2500);
              if (ev.mode === 'selectMultiple') break;
            } else {
              /* sem seletor: talvez o clique tenha criado o input — tenta de novo direto */
              const doc2 = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }, session) as { root: { nodeId: number } };
              const q2 = await cdp.send('DOM.querySelectorAll', { nodeId: doc2.root.nodeId, selector: 'input[type=file]' }, session) as { nodeIds: number[] };
              if (q2.nodeIds?.[0]) { await cdp.send('DOM.setFileInputFiles', { nodeId: q2.nodeIds[0], files }, session); refsOk = files.length; }
              else job.log(`Flow: botão de anexo ${clicked === 'ok' ? 'clicado, mas o seletor não abriu' : 'não encontrado'}`);
              break;
            }
          }
          await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }, session).catch(() => {});
        }
        if (refsOk) {
          job.log(`Flow: ${refsOk} referência(s) enviada(s) (${job.refs.map((r) => r.name).join(', ')})`);
          /* aviso "Direitos de uso desta imagem" (o usuário autorizou o app a aceitar nos envios de referência): "Concordo" */
          for (let i = 0; i < 10; i++) {
            const at = await evaluate<string>(cdp, session, FLOW_RIGHTS_AGREE, 5000).catch(() => '');
            if (at) { await realClick(cdp, session, JSON.parse(at) as { x: number; y: number }); job.log('Flow: aviso de direitos de uso da imagem aceito'); await wait(1500); break; }
            await wait(500);
          }
          await wait(3000);   // o Flow sobe as imagens antes do pedido
        }
        else job.log('Flow: campo de anexo não encontrado — o pedido segue só com a descrição');
      } catch (e) { job.log(`Flow: não consegui anexar os personagens (${(e as Error).message.slice(0, 120)}) — segue só com o texto`); }
    }
    if (refsOk) job.prompt = job.prompt + flowRefsText(job.refs);
    const before = new Set((await evaluate<typeof probe>(cdp, session, PROBE, 10_000)).medias);
    // 3) prompt com teclado real e envio
    const pt = await evaluate<{ x: number; y: number } | null>(cdp, session, EDITOR_POINT, 10_000);
    if (!pt) { await dbg('foco no campo'); throw new Error('não consegui focar o campo do agente'); }
    for (const type of ['mousePressed', 'mouseReleased'] as const) await cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 }, session);
    await wait(250);
    /* SEGURANÇA: Ctrl+A + Backspace fora do campo seleciona e APAGA as mídias do projeto do Flow (aconteceu com um aviso
       aberto por cima: 54 itens foram para a lixeira). Só digita se o foco está num campo de texto e não há diálogo aberto. */
    const focusOk = await evaluate<string>(cdp, session, FLOW_FOCUS_CHECK, 5000).catch(() => 'erro');
    if (focusOk !== 'ok') { await dbg(`foco fora do campo (${focusOk})`); throw new Error(`o campo do agente do Flow não está com o foco (${focusOk}) — nada foi digitado`); }
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
    /* o balão do pedido mostra as referências anexadas logo após o envio: o que aparece nos primeiros segundos não é o
       resultado (a geração demora mais) — entra na lista do que ignorar */
    if (refsOk) {
      await wait(6000);
      for (const m of await evaluate<typeof probe>(cdp, session, PROBE, 10_000).then((r) => r.medias).catch(() => [] as string[])) before.add(m);
    }
    // 4) espera a primeira mídia nova (imagem ou vídeo, conforme o pedido)
    let src = '';
    let got: { type: string; data: string } | undefined, small: typeof got;
    let lastErr = '';
    /* até 4 escolhas: se a mídia nova for a própria referência anexada (o Flow mostra o anexo na grade), ignora e espera */
    for (let pick = 0; pick < 4; pick++) {
    src = ''; got = undefined; small = undefined;
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
    /* baixa: fetch na página; se falhar (CORS/URL assinada) ou vier quase vazio (prévia ainda carregando), espera e tenta
       de novo e, por fim, baixa pelo Node com os cookies da página */
    const minBytes = job.media === 'video' ? 300_000 : 80_000;   // abaixo disso é a prévia, não o arquivo final
    for (let t = 0; t < 6 && !got; t++) {
      if (t) {
        await wait(4000);
        const ms = await evaluate<{ medias: Array<{ tag: string; src: string }> }>(cdp, session, `(() => { ${PAGE_HELPERS} return { medias: medias() }; })()`, 10_000).then((r) => r.medias).catch(() => [] as Array<{ tag: string; src: string }>);
        const fresh = ms.find((m) => !before.has(m.src) && (job.media === 'video' ? m.tag === 'video' : m.tag === 'img'));
        if (fresh) src = fresh.src;
      }
      try {
        /* a grade mostra versão reduzida (=s1600-rw, webp): pede o original (=s0) e, se falhar, a URL da grade */
        const full = flowOriginalUrl(src);
        const g = t < 4 ? await evaluate<{ type: string; data: string }>(cdp, session, fetchMedia(full), 180_000).catch(() => evaluate<{ type: string; data: string }>(cdp, session, fetchMedia(src), 180_000)) : await nodeFetchMedia(cdp, session, full).catch(() => nodeFetchMedia(cdp, session, src));
        if (g.data.length * 0.75 < minBytes) { if (!small || g.data.length > small.data.length) small = g; lastErr = `só a prévia (${Math.round(g.data.length * 0.75 / 1024)} KB)`; if (t < 5) await wait(5000); continue; }
        got = g;
      } catch (e) { lastErr = (e as Error).message; }
    }
    if (!got && small && job.debugDir) {
      await dbg('só a prévia');
      const imgs = await evaluate<Json>(cdp, session, `[...document.querySelectorAll('img, video')].filter((i) => i.getBoundingClientRect().width > 100).slice(0, 12).map((i) => ({ tag: i.tagName, src: (i.currentSrc || i.src || '').slice(0, 400), srcset: (i.srcset || '').slice(0, 600), nat: (i.naturalWidth || i.videoWidth) + 'x' + (i.naturalHeight || i.videoHeight), box: Math.round(i.getBoundingClientRect().width) + 'x' + Math.round(i.getBoundingClientRect().height), link: (i.closest('a') || {}).href || '' }))`, 10_000).catch(() => null);
      fs.writeFileSync(path.join(job.debugDir, 'flow-media.json'), JSON.stringify({ src, imgs }, null, 2));
    }
    if (!got && small) { got = small; job.log(`Flow: só veio a prévia (${Math.round(small.data.length * 0.75 / 1024)} KB) — usada assim mesmo`); }
    const gotBuf = got ? Buffer.from(got.data, 'base64') : undefined;
    if (gotBuf && job.media === 'image' && job.refs?.some((r) => sameImage(gotBuf, r.file))) {
      job.log('Flow: a imagem nova é a referência anexada, não o resultado — ignorada, aguardando a imagem gerada');
      before.add(src); got = undefined; continue;
    }
    break;
    }
    if (!got) throw new Error(`o Flow gerou, mas o download falhou: ${lastErr}`);
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

/** Clica no botão de anexar/adicionar imagem do Flow (perto do campo do agente). 'ok' se clicou. */
const FLOW_ATTACH_CLICK = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
  const label = (el) => ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.textContent || '')).toLowerCase();
  const btns = [...document.querySelectorAll('button, [role=button]')].filter(vis);
  /* Flow (nov/2026): "Menu para adicionar arquivos" (ícone add, no topo do projeto) → item de menu "Enviar" (upload) */
  const aria = (b) => (b.getAttribute('aria-label') || '').toLowerCase();
  const hit = btns.find((b) => /adicionar arquivos|add files|add media|adicionar mídia/.test(aria(b)))
    || btns.find((b) => /add_photo|attach|anexar|upload|ingredient|ingrediente/.test(label(b)) && !/imagens$|^image imagens/.test(label(b).trim()));
  if (!hit) return 'none';
  /* o seletor de arquivos só abre com gesto REAL do usuário: devolve o ponto e o app clica com o mouse (CDP) */
  const r = hit.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`;
/** Ponto do item "Enviar/Upload" do menu aberto (ou ''). */
const FLOW_UPLOAD_ITEM = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const label = (el) => ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).toLowerCase();
  const opt = [...document.querySelectorAll('[role=menuitem]')].filter(vis).find((e) => /upload|enviar|carregar|do computador|from computer|from device/.test(label(e)));
  if (!opt) return '';
  const r = opt.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`;
/** Clique de mouse real (gesto do usuário) num ponto da página. */
async function realClick(cdp: Cdp, session: string, pt: { x: number; y: number }): Promise<void> {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const) await cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 }, session);
}

/** O foco está num campo de texto (o editor do agente) e não há diálogo/modal aberto? 'ok' ou o motivo. */
const FLOW_FOCUS_CHECK = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
  const dlg = [...document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open], [aria-modal=true]')].filter(vis);
  if (dlg.length) return 'diálogo aberto: ' + (dlg[0].textContent || '').trim().slice(0, 60);
  const a = document.activeElement;
  if (!a || a === document.body) return 'sem foco';
  const editable = a.isContentEditable || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /text|search/.test(a.type || 'text'));
  return editable ? 'ok' : 'foco em ' + a.tagName.toLowerCase();
})()`;

/** Ponto do botão "Concordo" do aviso "Direitos de uso desta imagem" (ou ''). */
const FLOW_RIGHTS_AGREE = `(() => {
  const dlg = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [aria-modal=true]')].find((d) => /direitos de uso|usage rights|rights to use/i.test(d.textContent || ''));
  if (!dlg) return '';
  const b = [...dlg.querySelectorAll('button')].find((x) => /^(concordo|i agree|agree|aceito)$/i.test((x.textContent || '').trim()));
  if (!b) return '';
  const r = b.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`;

/** Baixa a mídia pelo Node (fora da página) com os cookies que o navegador tem para a URL — para quando o fetch da página falha. */
async function nodeFetchMedia(cdp: { send: (m: string, p?: Record<string, unknown>, s?: string) => Promise<unknown> }, session: string, src: string): Promise<{ type: string; data: string }> {
  if (src.startsWith('blob:') || src.startsWith('data:')) throw new Error('mídia só existe dentro da página');
  const ck = await cdp.send('Network.getCookies', { urls: [src] }, session).catch(() => ({ cookies: [] })) as { cookies?: Array<{ name: string; value: string }> };
  const cookie = (ck.cookies ?? []).map((c) => `${c.name}=${c.value}`).join('; ');
  const r = await fetch(src, { headers: cookie ? { cookie } : {} });
  if (!r.ok) throw new Error('download HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  return { type: r.headers.get('content-type') ?? '', data: buf.toString('base64') };
}

/** URL do arquivo original de uma mídia do Flow (a grade usa "=s1600-rw", reduzida em webp). Função pura. */
export const flowOriginalUrl = (src: string) => /\/asb\/[^?#]+=s\d+(-[a-z]+)*$/i.test(src) ? src.replace(/=s\d+(-[a-z]+)*$/i, '=s0') : src;

/** Assinatura 16×16 em tons de cinza (Electron nativeImage: PNG/JPEG); undefined fora do Electron ou formato não lido. */
function graySig(img: Buffer): number[] | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nativeImage } = require('electron') as typeof import('electron');
    if (!nativeImage?.createFromBuffer) return undefined;
    const ni = nativeImage.createFromBuffer(img);
    if (ni.isEmpty()) return undefined;
    const bmp = ni.resize({ width: 16, height: 16, quality: 'good' }).toBitmap();   // BGRA
    const out: number[] = [];
    for (let i = 0; i + 3 < bmp.length; i += 4) out.push(0.114 * bmp[i]! + 0.587 * bmp[i + 1]! + 0.299 * bmp[i + 2]!);
    return out.length === 256 ? out : undefined;
  } catch { return undefined; }
}

/** As duas imagens são a mesma (a baixada é a referência anexada)? Diferença média de cinza normalizada. Função pura sobre as assinaturas. */
export function sameSig(a: number[], b: number[], limit = 14): boolean {
  if (a.length !== b.length || !a.length) return false;
  const norm = (v: number[]) => { const m = v.reduce((s, x) => s + x, 0) / v.length; return v.map((x) => x - m); };
  const x = norm(a), y = norm(b);
  return x.reduce((s, v, i) => s + Math.abs(v - y[i]!), 0) / x.length < limit;
}

function sameImage(got: Buffer, refFile: string): boolean {
  try {
    const a = graySig(got), b = graySig(fs.readFileSync(refFile));
    return !!a && !!b && sameSig(a, b);
  } catch { return false; }
}
