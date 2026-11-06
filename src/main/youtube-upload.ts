import * as fs from 'node:fs';
import * as path from 'node:path';
import { Cdp } from './flow';

/**
 * Upload no YouTube pelo navegador da conta Google (Automações), via CDP — o mesmo navegador do Flow.
 * O login é sempre do usuário (o app nunca digita senha). Envia o vídeo, preenche título e descrição,
 * envia a thumbnail, marca "não é para crianças", escolhe a visibilidade (padrão: NÃO LISTADO),
 * espera o upload terminar e devolve o link. Se a interface do Studio mudar, grava um diagnóstico.
 */

export interface UploadJob {
  port: number; file: string; title: string; description?: string; thumbnail?: string; tags?: string[];
  visibility?: 'UNLISTED' | 'PRIVATE' | 'PUBLIC'; uploadUrl?: string; timeoutSec?: number;
  log: (l: string) => void; signal?: AbortSignal; debugDir?: string;
}

type Json = Record<string, unknown>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* busca que atravessa shadow DOM (o Studio usa web components) */
const DEEP = String.raw`
  const deepAll = (sel, root = document) => { const out = [...root.querySelectorAll(sel)]; for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepAll(sel, el.shadowRoot)); return out; };
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const deep = (sel) => deepAll(sel).find(vis) || deepAll(sel)[0];
`;

async function evaluate<T>(cdp: Cdp, session: string, expression: string, timeoutMs = 30_000): Promise<T> {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session, timeoutMs) as { result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text ?? 'erro na página');
  return r.result?.value as T;
}
/** objectId do elemento (para DOM.setFileInputFiles). */
async function objectOf(cdp: Cdp, session: string, sel: string): Promise<string | undefined> {
  const r = await cdp.send('Runtime.evaluate', { expression: `(() => { ${DEEP} return deepAll(${JSON.stringify(sel)})[0] || null; })()`, returnByValue: false }, session) as { result?: { objectId?: string; subtype?: string } };
  return r.result?.subtype === 'null' ? undefined : r.result?.objectId;
}
async function until<T>(fn: () => Promise<T | undefined | null | false>, ms: number, step = 700): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* página ainda carregando */ } await wait(step); }
  return undefined;
}

export async function youtubeUpload(job: UploadJob): Promise<{ url?: string; studioUrl: string }> {
  if (!fs.existsSync(job.file)) throw new Error(`vídeo não encontrado: ${job.file}`);
  const cdp = await Cdp.connect(job.port);
  let session = '', targetId = '';
  const dbg = async (why: string) => {
    if (!job.debugDir || !session) return;
    try {
      fs.mkdirSync(job.debugDir, { recursive: true });
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session, 20_000) as { data?: string };
      if (shot.data) fs.writeFileSync(path.join(job.debugDir, 'youtube-debug.png'), Buffer.from(shot.data, 'base64'));
      const url = await evaluate<string>(cdp, session, 'location.href', 5000).catch(() => '');
      fs.writeFileSync(path.join(job.debugDir, 'youtube-debug.json'), JSON.stringify({ why, url, at: new Date().toISOString() }, null, 2));
      job.log(`diagnóstico do YouTube gravado em ${job.debugDir}`);
    } catch { /* sem diagnóstico */ }
  };
  const abort = () => { void cdp.send('Target.closeTarget', { targetId }).catch(() => {}); cdp.close(); };
  job.signal?.addEventListener('abort', abort, { once: true });
  const click = (sel: string) => evaluate<boolean>(cdp, session, `(() => { ${DEEP} const el = deep(${JSON.stringify(sel)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
  const typeInto = async (sel: string, text: string) => {
    const ok = await evaluate<boolean>(cdp, session, `(() => { ${DEEP} const el = deep(${JSON.stringify(sel)}); if (!el) return false; el.focus(); document.execCommand('selectAll', false); return true; })()`);
    if (!ok) return false;
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, session);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, session);
    await cdp.send('Input.insertText', { text }, session);
    return true;
  };
  try {
    const t = await cdp.send('Target.createTarget', { url: job.uploadUrl ?? 'https://www.youtube.com/upload' }) as { targetId: string };
    targetId = t.targetId;
    session = (await cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string }).sessionId;
    await cdp.send('Page.enable', {}, session);
    await cdp.send('Page.bringToFront', {}, session);
    const total = (job.timeoutSec ?? 1800) * 1000;

    // 1) logado e com o seletor de arquivo do Studio
    const state = await until(async () => {
      const href = await evaluate<string>(cdp, session, 'location.href', 5000);
      if (/accounts\.google\.com|ServiceLogin|signin/i.test(href)) return 'login';
      if (/create_channel|channel_switcher/i.test(href)) return 'nochannel';
      return (await objectOf(cdp, session, 'input[type=file]')) ? 'ok' : undefined;
    }, 60_000, 1000);
    if (state === 'login') throw new Error('a conta não está logada no YouTube: em Automações abra o navegador da conta e entre no Google/YouTube uma vez');
    if (state === 'nochannel') throw new Error('esta conta Google ainda não tem canal no YouTube: crie o canal no navegador da conta');
    if (state !== 'ok') { await dbg('seletor de arquivo não apareceu'); throw new Error('não encontrei o envio de arquivo do YouTube Studio (diagnóstico gravado)'); }
    const fileObj = (await objectOf(cdp, session, 'input[type=file]'))!;
    await cdp.send('DOM.enable', {}, session);
    await cdp.send('DOM.setFileInputFiles', { files: [path.resolve(job.file)], objectId: fileObj }, session);
    job.log(`YouTube: enviando ${path.basename(job.file)}…`);

    // 2) detalhes: título e descrição (caixas contenteditable #textbox)
    const titleSel = '#title-textarea #textbox, ytcp-social-suggestions-textbox#title-textarea #textbox';
    if (!(await until(() => evaluate<boolean>(cdp, session, `(() => { ${DEEP} return !!deep(${JSON.stringify(titleSel)}); })()`), 90_000))) { await dbg('formulário de detalhes'); throw new Error('o formulário de detalhes do vídeo não abriu (diagnóstico gravado)'); }
    await wait(800);
    await typeInto(titleSel, job.title.slice(0, 100));
    if (job.description) await typeInto('#description-textarea #textbox', job.description.slice(0, 4900));
    job.log('YouTube: título e descrição preenchidos');

    // 3) thumbnail (canal verificado; se não houver o campo, segue sem)
    if (job.thumbnail && fs.existsSync(job.thumbnail)) {
      const th = await until(() => objectOf(cdp, session, 'input#file-loader, ytcp-thumbnails-compact-editor-uploader input[type=file]'), 10_000);
      if (th) { await cdp.send('DOM.setFileInputFiles', { files: [path.resolve(job.thumbnail)], objectId: th }, session); job.log('YouTube: thumbnail enviada'); await wait(1500); }
      else job.log('YouTube: campo de thumbnail indisponível (o canal precisa estar verificado) — seguindo sem');
    }

    // 4) público: não é para crianças
    await click('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], [name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');

    // 5) avança até a visibilidade e escolhe (padrão: não listado)
    const vis = job.visibility ?? 'UNLISTED';
    const visSel = `tp-yt-paper-radio-button[name="${vis}"], [name="${vis}"]`;
    for (let i = 0; i < 4; i++) {
      if (await evaluate<boolean>(cdp, session, `(() => { ${DEEP} const el = deep(${JSON.stringify(visSel)}); return !!(el && el.getBoundingClientRect().width > 2); })()`)) break;
      await click('#next-button'); await wait(1300);
    }
    if (!(await click(visSel))) { await dbg('visibilidade'); throw new Error('não encontrei a opção de visibilidade (diagnóstico gravado)'); }
    job.log(`YouTube: visibilidade ${vis === 'UNLISTED' ? 'não listado' : vis === 'PRIVATE' ? 'privado' : 'público'}`);

    // 6) espera o envio terminar (fechar antes cancela o upload)
    const done = await until(() => evaluate<boolean>(cdp, session, `(() => { ${DEEP}
      const p = deep('ytcp-video-upload-progress'); const txt = (p && (p.innerText || p.textContent) || '').toLowerCase();
      const uploading = p && p.hasAttribute('uploading');
      return !uploading && !/uploading|enviando|carregando|\\d+ ?%/.test(txt);
    })()`), total, 3000);
    if (!done) { await dbg('upload não terminou'); throw new Error('o upload não terminou no tempo limite'); }
    const url = await evaluate<string>(cdp, session, `(() => { ${DEEP} const a = deep('span.video-url-fadeable a, a.ytcp-video-info, ytcp-video-info a'); return a ? a.href : ''; })()`).catch(() => '');
    if (!(await click('#done-button'))) { await dbg('botão salvar'); throw new Error('não encontrei o botão Salvar/Concluir (diagnóstico gravado)'); }
    await wait(2500);
    await click('#close-button, ytcp-button#close-button');
    const studioUrl = await evaluate<string>(cdp, session, 'location.href', 5000).catch(() => '');
    job.log(`YouTube: vídeo salvo${url ? ` — ${url}` : ''}`);
    return { url: url || undefined, studioUrl };
  } finally {
    job.signal?.removeEventListener('abort', abort);
    await wait(500);
    void cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    setTimeout(() => cdp.close(), 800);
  }
}

/** Título, descrição e thumbnail do projeto (metadata.json e thumbnail.png gerados pela rota). */
export function uploadMeta(outDir: string, fallbackTitle: string): { title: string; description: string; tags: string[]; thumbnail?: string } {
  let meta: { title?: string; description?: string; tags?: string[]; chapters?: Array<{ time: string; title: string }> } = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(outDir, 'metadata.json'), 'utf8')); } catch { /* sem SEO: usa o nome do projeto */ }
  const chapters = meta.chapters?.length && !/\d+:\d{2}/.test(meta.description ?? '') ? '\n\n' + meta.chapters.map((c) => `${c.time} ${c.title}`).join('\n') : '';
  const tags = (meta.tags ?? []).filter(Boolean);
  const description = `${meta.description ?? ''}${chapters}${tags.length ? `\n\n${tags.slice(0, 15).map((t) => `#${t.replace(/\s+/g, '')}`).join(' ')}` : ''}`.trim();
  const thumbnail = ['thumbnail.png', 'thumbnail.jpg'].map((f) => path.join(outDir, f)).find((f) => fs.existsSync(f));
  return { title: (meta.title || fallbackTitle).slice(0, 100), description, tags, thumbnail };
}
