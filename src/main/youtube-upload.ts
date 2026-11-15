import * as fs from 'node:fs';
import * as path from 'node:path';
import { Cdp } from './flow';

/**
 * Upload no YouTube pelo navegador da conta Google (Automações), via CDP — o mesmo navegador do Flow.
 * O login é sempre do usuário (o app nunca digita senha). Envia o vídeo, preenche título e descrição,
 * envia a thumbnail, marca "não é para crianças", escolhe a visibilidade (padrão: NÃO LISTADO),
 * espera o upload terminar e devolve o link. Se a interface do Studio mudar, grava um diagnóstico.
 *
 * Cada passo é CONFERIDO (lendo a página de volta): o Studio troca o título pelo nome do arquivo alguns segundos
 * depois do envio começar, e um "Salvar" clicado cedo demais deixa o vídeo como RASCUNHO — antes o app dizia
 * "vídeo salvo" e o vídeo ficava rascunho com o título "final". Agora, se algo não pegou, o envio falha com o motivo.
 * `youtubeFinishDraft` termina um rascunho que já está no canal (mesmos passos, sem reenviar o arquivo).
 */

export interface UploadJob {
  port: number; file: string; title: string; description?: string; thumbnail?: string; tags?: string[];
  visibility?: 'UNLISTED' | 'PRIVATE' | 'PUBLIC'; uploadUrl?: string; timeoutSec?: number;
  /** marca "conteúdo alterado ou sintético" (IA) — padrão: sim (vídeo gerado com IA) */
  aiContent?: boolean;
  /** preenchido no fim: a thumbnail entrou? ('phone' = o canal precisa confirmar telefone) */
  thumbStatus?: string;
  log: (l: string) => void; signal?: AbortSignal; debugDir?: string;
}
export type DetailsJob = Omit<UploadJob, 'file' | 'uploadUrl'>;

type Json = Record<string, unknown>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* busca que atravessa shadow DOM (o Studio usa web components) */
const DEEP = String.raw`
  const deepAll = (sel, root = document) => { const out = [...root.querySelectorAll(sel)]; for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepAll(sel, el.shadowRoot)); return out; };
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  /* com o diálogo de envio aberto, a página do fundo (detalhes do vídeo) tem OUTRO título/descrição/IA/capa visíveis:
     prefere sempre o elemento de dentro do diálogo (senão o título ia para o campo do fundo e o vídeo ficava 'final') */
  const inDlg = (els) => { const d = document.querySelector('ytcp-uploads-dialog'); if (!d) return els; const f = els.filter((e) => d.contains(e)); return f.some(vis) ? f : els; };
  const deep = (sel) => { const a = inDlg(deepAll(sel)); return a.find(vis) || a[0]; };
  const checked = (el) => !!el && (el.hasAttribute('checked') || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true');
`;
const TITLE = '#title-textarea #textbox, ytcp-social-suggestions-textbox#title-textarea #textbox';
const DESC = '#description-textarea #textbox';
const THUMB_INPUT = 'input#file-loader, ytcp-thumbnails-compact-editor-uploader input[type=file]';
/** compara texto do campo com o pedido (espaços e quebras de linha normalizados) */
export const sameText = (a: string, b: string) => {
  const n = (x: string) => x.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
};

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

/** Página do Studio aberta numa aba nova do navegador da conta, com os passos conferidos. */
class Studio {
  session = '';
  targetId = '';
  constructor(readonly cdp: Cdp, readonly job: { log: (l: string) => void; debugDir?: string; signal?: AbortSignal }) {}
  ev<T>(expr: string, ms?: number) { return evaluate<T>(this.cdp, this.session, expr, ms); }
  async open(url: string) {
    const t = await this.cdp.send('Target.createTarget', { url }) as { targetId: string };
    this.targetId = t.targetId;
    this.session = (await this.cdp.send('Target.attachToTarget', { targetId: this.targetId, flatten: true }) as { sessionId: string }).sessionId;
    await this.cdp.send('Page.enable', {}, this.session);
    await this.cdp.send('Page.bringToFront', {}, this.session);
  }
  async close() {
    await wait(500);
    void this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
    setTimeout(() => this.cdp.close(), 800);
  }
  async dbg(why: string) {
    if (!this.job.debugDir || !this.session) return;
    try {
      fs.mkdirSync(this.job.debugDir, { recursive: true });
      const shot = await this.cdp.send('Page.captureScreenshot', { format: 'png' }, this.session, 20_000) as { data?: string };
      if (shot.data) fs.writeFileSync(path.join(this.job.debugDir, 'youtube-debug.png'), Buffer.from(shot.data, 'base64'));
      const url = await this.ev<string>('location.href', 5000).catch(() => '');
      fs.writeFileSync(path.join(this.job.debugDir, 'youtube-debug.json'), JSON.stringify({ why, url, at: new Date().toISOString() }, null, 2));
      this.job.log(`diagnóstico do YouTube gravado em ${this.job.debugDir}`);
    } catch { /* sem diagnóstico */ }
  }
  async fail(why: string, msg: string): Promise<never> { await this.dbg(why); throw new Error(`${msg} (diagnóstico gravado)`); }
  click(sel: string) { return this.ev<boolean>(`(() => { ${DEEP} const el = deep(${JSON.stringify(sel)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`); }
  isChecked(sel: string) { return this.ev<boolean>(`(() => { ${DEEP} return checked(deep(${JSON.stringify(sel)})); })()`); }
  text(sel: string) { return this.ev<string>(`(() => { ${DEEP} const el = deep(${JSON.stringify(sel)}); return el ? (el.innerText || el.textContent || '') : ''; })()`); }
  /** clique de mouse de verdade no centro do elemento (foco e seleção iguais aos de uma pessoa) */
  async mouseClick(sel: string) {
    const box = await this.ev<number[] | null>(`(() => { ${DEEP} const el = deep(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return [r.x + Math.min(r.width / 2, 40), r.y + Math.min(r.height / 2, 12)]; })()`);
    if (!box) return false;
    for (const type of ['mousePressed', 'mouseReleased']) await this.cdp.send('Input.dispatchMouseEvent', { type, x: box[0], y: box[1], button: 'left', clickCount: 1 }, this.session);
    return true;
  }
  /**
   * Envia a thumbnail como uma pessoa: clica em "Enviar arquivo" com o seletor de arquivos interceptado e entrega o
   * arquivo no seletor que o Studio abriu (ele cria um input fora da página — preencher o #file-loader direto não
   * fazia nada e o vídeo ficava sem capa). Sem o botão, cai no input da página.
   */
  async chooseThumbnail(file: string): Promise<string | undefined> {
    await this.cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }, this.session).catch(() => {});
    await this.cdp.send('DOM.enable', {}, this.session).catch(() => {});
    try {
      const ev = this.cdp.waitEvent('Page.fileChooserOpened', this.session, 8000);
      /* o seletor de arquivos só abre com gesto de verdade: clique de mouse no centro do botão */
      /* a página muda de altura enquanto carrega (extensões, sugestões): rola, espera assentar e só clica quando o
         ponto do clique cai DENTRO do botão (senão o clique ia parar na descrição) */
      const FIND = `inDlg(deepAll('#custom-still-editor-wrapper, ytcp-thumbnail-uploader #select-button, ytcp-thumbnails-compact-editor-uploader button, ytcp-thumbnail-uploader'))
          .filter(vis).find((x) => /enviar arquivo|upload file|upload thumbnail|enviar miniatura/i.test(x.innerText || x.getAttribute('aria-label') || ''))`;
      let box: number[] | null = null;
      for (let i = 0; i < 6 && !box; i++) {
        await this.ev(`(() => { ${DEEP} const b = ${FIND}; if (b) b.scrollIntoView({ block: 'center' }); return !!b; })()`);
        await wait(900);
        box = await this.ev<number[] | null>(`(() => { ${DEEP} const b = ${FIND}; if (!b) return null;
          const r = b.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) return null;
          let el = document.elementFromPoint(x, y); while (el && el.shadowRoot && el.shadowRoot.elementFromPoint(x, y) && el.shadowRoot.elementFromPoint(x, y) !== el) el = el.shadowRoot.elementFromPoint(x, y);
          for (let n = el; n; n = n.parentNode || n.host) if (n === b) return [x, y];
          return null; })()`);
      }
      if (box) for (const type of ['mousePressed', 'mouseReleased']) await this.cdp.send('Input.dispatchMouseEvent', { type, x: box[0], y: box[1], button: 'left', clickCount: 1 }, this.session);
      const opened = box ? await ev as { backendNodeId?: number } | undefined : undefined;
      /* canal sem verificação por telefone: o Studio abre "Para adicionar miniaturas personalizadas, confirme seu
         número de telefone" em vez do seletor — fecha o aviso e diz o motivo (o app nunca digita telefone) */
      if (!opened?.backendNodeId && await this.phoneGate()) return 'phone';
      if (opened?.backendNodeId) {
        await this.cdp.send('DOM.setFileInputFiles', { files: [path.resolve(file)], backendNodeId: opened.backendNodeId }, this.session);
        await wait(3000);
        return 'seletor do Studio';
      }
      const obj = await objectOf(this.cdp, this.session, THUMB_INPUT);
      if (!obj) return undefined;
      await this.cdp.send('DOM.setFileInputFiles', { files: [path.resolve(file)], objectId: obj }, this.session);
      await wait(3000);
      return 'campo da página';
    } finally {
      await this.cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }, this.session).catch(() => {});
    }
  }
  /** aviso "confirme seu número de telefone" aberto? fecha (Cancelar) e responde true */
  async phoneGate(): Promise<boolean> {
    return this.ev<boolean>(`(() => { ${DEEP}
      const d = deepAll('ytcp-dialog, tp-yt-paper-dialog, ytcp-confirmation-dialog, [role=dialog]').filter(vis)
        .find((x) => /número de telefone|phone number|verify|verificar/i.test(x.innerText || ''));
      if (!d) return false;
      const c = deepAll('ytcp-button, button', d).find((x) => /cancelar|cancel|agora não|not now/i.test(x.innerText || ''));
      if (c) c.click();
      return true; })()`).catch(() => false);
  }
  /**
   * "Conteúdo alterado ou sintético" (IA): Sim/Não, em "Mostrar mais" dos detalhes. Abre a seção se precisar e
   * confere a marcação. Obrigatório quando o vídeo usa IA de forma realista (pessoas, lugares, vozes geradas).
   */
  async markAltered(yes: boolean): Promise<boolean> {
    const sel = `tp-yt-paper-radio-button[name="VIDEO_HAS_ALTERED_CONTENT_${yes ? 'YES' : 'NO'}"]`;
    const visible = () => this.ev<boolean>(`(() => { ${DEEP} const el = deep(${JSON.stringify(sel)}); return !!(el && el.getBoundingClientRect().width > 2); })()`);
    if (!(await visible())) {
      await this.ev<boolean>(`(() => { ${DEEP} const bs = deepAll('ytcp-button, button, #toggle-button').filter(vis).filter((x) => /^\\s*(mostrar mais|show more)\\s*$/i.test(x.innerText || '')); const b = bs[bs.length - 1]; if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
      await until(visible, 8000, 500);
    }
    await this.click(sel);
    if (await until(() => this.isChecked(sel), 5000, 500)) return true;
    await this.mouseClick(sel);
    return !!(await until(() => this.isChecked(sel), 5000, 500));
  }
  /** substitui o texto de um campo contenteditable e confere lendo de volta (até 3 tentativas) */
  async setText(sel: string, text: string): Promise<boolean> {
    for (let i = 0; i < 3; i++) {
      await this.mouseClick(sel);
      await this.ev<boolean>(`(() => { ${DEEP} const el = deep(${JSON.stringify(sel)}); if (!el) return false; el.focus(); document.execCommand('selectAll', false); return true; })()`);
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, this.session);
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, this.session);
      await this.cdp.send('Input.insertText', { text }, this.session);
      await wait(700);
      if (sameText(await this.text(sel), text)) return true;
    }
    return false;
  }
}

/**
 * Detalhes → visibilidade → Salvar, com o diálogo de envio do Studio aberto (envio novo ou "Editar rascunho").
 * `uploading`: espera o envio do arquivo terminar antes de salvar.
 */
async function fillAndSave(st: Studio, job: DetailsJob, total: number): Promise<{ url?: string }> {
  /* 1) formulário aberto e título já preenchido pelo Studio (ele põe o nome do arquivo e às vezes repõe depois):
        espera o campo parar de mudar antes de escrever */
  if (!(await until(() => st.ev<boolean>(`(() => { ${DEEP} return !!deep(${JSON.stringify(TITLE)}); })()`), 90_000))) await st.fail('formulário de detalhes', 'o formulário de detalhes do vídeo não abriu');
  let last = '', stable = 0;
  await until(async () => { const v = await st.text(TITLE); stable = v && v === last ? stable + 1 : 0; last = v; return stable >= 3; }, 20_000, 1000);
  const title = job.title.slice(0, 100), desc = job.description?.slice(0, 4900) ?? '';
  const fill = async () => {
    if (!(await st.setText(TITLE, title))) return 'título';
    if (desc && !(await st.setText(DESC, desc))) return 'descrição';
    return '';
  };
  let bad = await fill();
  if (bad) await st.fail(`campo ${bad}`, `não consegui preencher o ${bad} no YouTube Studio`);
  job.log('YouTube: título e descrição preenchidos');

  /* 2) thumbnail (canal verificado; se não houver o campo, segue sem) */
  if (job.thumbnail && fs.existsSync(job.thumbnail)) {
    const how = await st.chooseThumbnail(job.thumbnail);
    job.thumbStatus = how ?? 'sem campo';
    if (how === 'phone') job.log('⚠ YouTube: thumbnail NÃO enviada — o canal precisa confirmar o número de telefone (youtube.com/verify) para usar miniatura personalizada');
    else if (how) job.log(`YouTube: thumbnail enviada (${how})`);
    else job.log('YouTube: campo de thumbnail indisponível — seguindo sem');
  }

  /* 3) público: não é para crianças (conferido) */
  const kids = 'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], [name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]';
  await st.click(kids);
  await until(() => st.isChecked(kids), 5000, 500);

  /* conteúdo alterado/sintético: vídeo feito com IA é marcado como IA (padrão: sim) */
  if (job.aiContent !== false) {
    if (await st.markAltered(true)) job.log('YouTube: marcado como conteúdo alterado/sintético (IA)');
    else await st.fail('conteúdo alterado', 'não consegui marcar o vídeo como conteúdo feito com IA');
  }

  /* o Studio às vezes repõe o título depois do upload/thumbnail: confere de novo antes de avançar */
  if (!sameText(await st.text(TITLE), title) || (desc && !sameText(await st.text(DESC), desc))) {
    job.log('YouTube: o Studio trocou o título/descrição — preenchendo de novo');
    bad = await fill();
    if (bad) await st.fail(`campo ${bad} (2ª vez)`, `o YouTube Studio não manteve o ${bad}`);
  }

  /* 4) avança até a visibilidade e escolhe (padrão: não listado), conferindo que ficou marcada */
  const vis = job.visibility ?? 'UNLISTED';
  const visSel = `tp-yt-paper-radio-button[name="${vis}"], [name="${vis}"]`;
  for (let i = 0; i < 5; i++) {
    if (await st.ev<boolean>(`(() => { ${DEEP} const el = deep(${JSON.stringify(visSel)}); return !!(el && el.getBoundingClientRect().width > 2); })()`)) break;
    await st.click('#next-button'); await wait(1500);
  }
  if (!(await st.click(visSel))) await st.fail('visibilidade', 'não encontrei a opção de visibilidade');
  if (!(await until(() => st.isChecked(visSel), 6000, 500))) {
    await st.mouseClick(visSel);
    if (!(await until(() => st.isChecked(visSel), 6000, 500))) await st.fail('visibilidade não marcada', 'a opção de visibilidade não ficou marcada');
  }
  const visName = vis === 'UNLISTED' ? 'não listado' : vis === 'PRIVATE' ? 'privado' : 'público';
  job.log(`YouTube: visibilidade ${visName}`);

  /* 5) espera o envio terminar e o botão Salvar ficar habilitado (salvar antes deixa rascunho) */
  const done = await until(() => st.ev<boolean | string>(`(() => { ${DEEP}
    if (deepAll('*').some((e) => e.children.length === 0 && vis(e) && /limite di[aá]rio de envios|daily upload limit/i.test(e.textContent || ''))) return 'limit';
    const p = deep('ytcp-video-upload-progress'); const txt = (p && (p.innerText || p.textContent) || '').toLowerCase();
    const uploading = p && p.hasAttribute('uploading');
    const b = deep('#done-button');
    const off = !b || b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true';
    return !uploading && !/uploading|enviando|carregando|\\d+ ?%/.test(txt) && !off;
  })()`), total, 3000);
  if (done === 'limit') await st.fail('limite diário', 'o YouTube atingiu o LIMITE DIÁRIO DE ENVIOS deste canal — faça a verificação do canal (youtube.com/verify) ou espere 24 h; o vídeo ficou como rascunho');
  if (!done) await st.fail('upload não terminou', 'o upload não terminou (ou o botão Salvar não habilitou) no tempo limite');
  const url = await st.ev<string>(`(() => { ${DEEP} const a = deep('span.video-url-fadeable a, a.ytcp-video-info, ytcp-video-info a'); return a ? a.href : ''; })()`).catch(() => '');
  if (!(await st.click('#done-button'))) await st.fail('botão salvar', 'não encontrei o botão Salvar/Concluir');

  /* 6) confirmação: o diálogo de envio fecha (ou aparece o de compartilhar/publicado). Aviso de verificação
        ainda em andamento → "publicar/salvar mesmo assim". Sem isso o vídeo continua rascunho. */
  const closed = await until(async () => {
    /* clique de mouse de verdade (o .click() no ytcp-button às vezes não fecha o aviso e o vídeo ficava "Saved as private") */
    const box = await st.ev<number[] | null>(`(() => { ${DEEP} const b = deepAll('ytcp-button, button').filter(vis).find((x) => /^\\s*(publicar mesmo assim|publish anyway|salvar mesmo assim|save anyway)\\s*$/i.test(x.innerText || '')); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`).catch(() => null);
    if (box) for (const type of ['mousePressed', 'mouseReleased']) await st.cdp.send('Input.dispatchMouseEvent', { type, x: box[0], y: box[1], button: 'left', clickCount: 1 }, st.session);
    return st.ev<boolean>(`(() => { ${DEEP} const b = deepAll('#done-button').find(vis); const share = deepAll('ytcp-video-share-dialog, ytcp-uploads-still-processing-dialog, #share-url').find(vis); const dl = deepAll('tp-yt-paper-dialog, ytcp-dialog, [role=dialog]').filter(vis); const after = dl.some((d) => /v[ií]deo publicado|video published|v[ií]deo salvo|video saved|^\\s*video processing|^\\s*v[ií]deo em processamento/i.test(d.innerText || '')) || dl.filter((d) => !deepAll('#done-button', d).some(vis)).some((d) => /processando v[ií]deo|processing video/i.test(d.innerText || '')); return !b || !!share || after; })()`);
  }, 60_000, 1500);
  if (!closed) await st.fail('não salvou', `cliquei em Salvar mas o YouTube Studio não confirmou — o vídeo pode ter ficado como rascunho`);
  const shareUrl = await st.ev<string>(`(() => { ${DEEP} const a = deepAll('#share-url, ytcp-video-share-dialog a[href*="youtu"]').find(vis); return a ? (a.href || a.innerText || '') : ''; })()`).catch(() => '');
  await wait(1500);
  await st.click('#close-button, ytcp-button#close-button');
  return { url: (url || shareUrl || '').trim() || undefined };
}

export async function youtubeUpload(job: UploadJob): Promise<{ url?: string; studioUrl: string }> {
  if (!fs.existsSync(job.file)) throw new Error(`vídeo não encontrado: ${job.file}`);
  const cdp = await Cdp.connect(job.port);
  const st = new Studio(cdp, job);
  const abort = () => { void cdp.send('Target.closeTarget', { targetId: st.targetId }).catch(() => {}); cdp.close(); };
  job.signal?.addEventListener('abort', abort, { once: true });
  try {
    await st.open(job.uploadUrl ?? 'https://www.youtube.com/upload');
    const total = (job.timeoutSec ?? 1800) * 1000;

    // 1) logado e com o seletor de arquivo do Studio
    const state = await until(async () => {
      const href = await st.ev<string>('location.href', 5000);
      if (/accounts\.google\.com|ServiceLogin|signin/i.test(href)) return 'login';
      if (/create_channel|channel_switcher/i.test(href)) return 'nochannel';
      return (await objectOf(cdp, st.session, 'input[type=file]')) ? 'ok' : undefined;
    }, 60_000, 1000);
    if (state === 'login') throw new Error('a conta não está logada no YouTube: em Automações abra o navegador da conta e entre no Google/YouTube uma vez');
    if (state === 'nochannel') throw new Error('esta conta Google ainda não tem canal no YouTube: crie o canal no navegador da conta');
    if (state !== 'ok') await st.fail('seletor de arquivo não apareceu', 'não encontrei o envio de arquivo do YouTube Studio');
    const fileObj = (await objectOf(cdp, st.session, 'input[type=file]'))!;
    await cdp.send('DOM.enable', {}, st.session);
    await cdp.send('DOM.setFileInputFiles', { files: [path.resolve(job.file)], objectId: fileObj }, st.session);
    job.log(`YouTube: enviando ${path.basename(job.file)}…`);

    const r = await fillAndSave(st, job, total);
    const studioUrl = await st.ev<string>('location.href', 5000).catch(() => '');
    job.log(`YouTube: vídeo salvo${r.url ? ` — ${r.url}` : ''}`);
    return { url: r.url, studioUrl };
  } finally {
    job.signal?.removeEventListener('abort', abort);
    await st.close();
  }
}

/**
 * Termina um RASCUNHO que já está no canal (envio interrompido ou salvo cedo): abre o Studio na lista de conteúdo
 * (vídeos ou Shorts), acha a linha em rascunho com a duração do vídeo ("0:51"), clica "Editar rascunho" e faz
 * os mesmos passos do envio (título, descrição, thumbnail, visibilidade, Salvar), conferidos.
 */
export async function youtubeFinishDraft(job: DetailsJob & { duration: string; shorts?: boolean; studioUrl?: string; videoId?: string }): Promise<{ url?: string }> {
  const cdp = await Cdp.connect(job.port);
  const st = new Studio(cdp, job);
  try {
    /* com o id do vídeo: abre a página de detalhes do rascunho e clica "Editar rascunho" (não depende da lista nem da duração) */
    if (job.videoId) {
      await st.open(`https://studio.youtube.com/video/${job.videoId}/edit`);
      const ok = await until(() => st.ev<boolean>(`(() => { ${DEEP} const b = deepAll('ytcp-button, button, a').filter(vis).find((x) => /^\\s*(editar rascunho|edit draft)\\s*$/i.test(x.innerText || '')); if (!b) return false; b.click(); return true; })()`), 40_000, 1500);
      if (!ok) await st.fail('rascunho não achado', `o vídeo ${job.videoId} não está como rascunho (ou o botão Editar rascunho não apareceu)`);
      await wait(3000);
      const r = await fillAndSave(st, job, (job.timeoutSec ?? 600) * 1000);
      job.log(`YouTube: rascunho ${job.videoId} salvo`);
      return { url: r.url ?? `https://youtu.be/${job.videoId}` };
    }
    await st.open(job.studioUrl ?? 'https://studio.youtube.com/');
    const base = await until(async () => { const h = await st.ev<string>('location.href', 5000); const m = /^(https:\/\/studio\.youtube\.com\/channel\/[^/?#]+)/.exec(h); return m?.[1]; }, 60_000, 1000);
    if (!base && !job.studioUrl) await st.fail('canal do Studio', 'não consegui abrir o YouTube Studio da conta');
    if (base) { await cdp.send('Page.navigate', { url: `${base}/videos/${job.shorts ? 'short' : 'upload'}` }, st.session); await wait(4000); }
    const row = JSON.stringify(job.duration);
    const opened = await until(() => st.ev<boolean>(`(() => { ${DEEP}
      const rows = deepAll('ytcp-video-row').filter((r) => (r.innerText || '').includes(${row}) && /rascunho|draft/i.test(r.innerText || ''));
      const b = rows.length ? deepAll('a, button, ytcp-button', rows[0]).find((x) => /editar rascunho|edit draft/i.test(x.innerText || '')) : null;
      if (!b) return false; b.click(); return true; })()`), 40_000, 1500);
    if (!opened) await st.fail('rascunho não achado', `não achei rascunho com duração ${job.duration} no Studio`);
    const r = await fillAndSave(st, job, (job.timeoutSec ?? 600) * 1000);
    job.log(`YouTube: rascunho ${job.duration} salvo${r.url ? ` — ${r.url}` : ''}`);
    return r;
  } finally { await st.close(); }
}

/** Título, descrição e thumbnail do projeto: da pasta out/publicar quando existe; senão metadata.json e thumbnail.png. */
export function uploadMeta(outDir: string, fallbackTitle: string): { title: string; description: string; tags: string[]; thumbnail?: string; video?: string } {
  let meta: { title?: string; description?: string; tags?: string[]; chapters?: Array<{ time: string; title: string }> } = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(outDir, 'metadata.json'), 'utf8')); } catch { /* sem SEO: usa o nome do projeto */ }
  const chapters = meta.chapters?.length && !/\d+:\d{2}/.test(meta.description ?? '') ? '\n\n' + meta.chapters.map((c) => `${c.time} ${c.title}`).join('\n') : '';
  const tags = (meta.tags ?? []).filter(Boolean);
  const description = `${meta.description ?? ''}${chapters}${tags.length ? `\n\n${tags.slice(0, 15).map((t) => `#${t.replace(/\s+/g, '')}`).join(' ')}` : ''}`.trim();
  const thumbnail = ['thumbnail.png', 'thumbnail.jpg'].map((f) => path.join(outDir, f)).find((f) => fs.existsSync(f));
  const base = { title: (meta.title || fallbackTitle).slice(0, 100), description, tags, thumbnail };
  /* pasta "publicar" (o que o usuário revisa/edita antes de postar) manda: título = 1ª linha de titulo.txt,
     descrição = descricao.txt inteira (já tem capítulos e hashtags), tags.txt, a capa "- thumbnail" e o .mp4 dela */
  const pub = path.join(outDir, 'publicar');
  const read = (n: string) => { try { return fs.readFileSync(path.join(pub, n), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'); } catch { return undefined; } };
  if (!fs.existsSync(pub)) return base;
  const files = fs.readdirSync(pub);
  const pTitle = read('titulo.txt')?.split('\n').map((l) => l.trim()).find(Boolean);
  const pDesc = read('descricao.txt')?.trim();
  const pTags = read('tags.txt')?.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const pThumb = files.find((n) => /thumbnail\.(png|jpe?g|webp)$/i.test(n));
  const pVideo = files.find((n) => /\.mp4$/i.test(n));
  return {
    title: (pTitle || base.title).slice(0, 100), description: pDesc || base.description, tags: pTags?.length ? pTags : base.tags,
    thumbnail: pThumb ? path.join(pub, pThumb) : base.thumbnail, ...(pVideo ? { video: path.join(pub, pVideo) } : {}),
  };
}

/**
 * Ajusta um vídeo que já está no canal (página de detalhes do Studio): marca "conteúdo alterado/sintético" (IA)
 * e troca a thumbnail, e salva conferindo (o botão Salvar volta a ficar desabilitado = nada pendente).
 * Thumbnail recusada por falta de verificação do canal (telefone) não impede salvar o resto: vem em `thumb`.
 */
export async function youtubeEditVideo(job: { port: number; videoId: string; title?: string; description?: string; thumbnail?: string; aiContent?: boolean; log: (l: string) => void; debugDir?: string }): Promise<{ thumb?: string; ai?: boolean }> {
  const cdp = await Cdp.connect(job.port);
  const st = new Studio(cdp, job);
  const res: { thumb?: string; ai?: boolean } = {};
  try {
    await st.open(`https://studio.youtube.com/video/${job.videoId}/edit`);
    if (!(await until(() => st.ev<boolean>(`(() => { ${DEEP} return !!deep(${JSON.stringify(TITLE)}); })()`), 60_000, 1500))) await st.fail('detalhes do vídeo', 'a página de detalhes do vídeo não abriu');
    await wait(3000);
    /* título/descrição (ex.: vídeo que ficou com o nome do arquivo) */
    if (job.title && !sameText(await st.text(TITLE), job.title.slice(0, 100)) && !(await st.setText(TITLE, job.title.slice(0, 100)))) await st.fail('campo título', 'não consegui trocar o título');
    if (job.description && !sameText(await st.text(DESC), job.description.slice(0, 4900)) && !(await st.setText(DESC, job.description.slice(0, 4900)))) await st.fail('campo descrição', 'não consegui trocar a descrição');
    if (job.thumbnail && fs.existsSync(job.thumbnail)) {
      res.thumb = (await st.chooseThumbnail(job.thumbnail)) ?? 'sem campo';
      if (res.thumb === 'phone') job.log('⚠ YouTube: thumbnail NÃO enviada — o canal precisa confirmar o número de telefone (youtube.com/verify)');
    }
    if (job.aiContent !== undefined) {
      res.ai = await st.markAltered(job.aiContent);
      if (!res.ai) await st.fail('conteúdo alterado', 'não consegui marcar o conteúdo alterado/sintético');
    }
    const save = 'ytcp-button#save, #save';
    const pending = await until(() => st.ev<boolean>(`(() => { ${DEEP} const b = deep(${JSON.stringify(save)}); return !!b && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true'; })()`), 15_000, 1000);
    if (!pending) { job.log(`YouTube: ${job.videoId} — nada para salvar (já estava assim)`); return res; }
    await st.click(save);
    const saved = await until(() => st.ev<boolean>(`(() => { ${DEEP} const b = deep(${JSON.stringify(save)}); return !b || b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true'; })()`), 60_000, 1500);
    if (!saved) await st.fail('salvar detalhes', 'cliquei em Salvar mas o Studio não confirmou');
    job.log(`YouTube: ${job.videoId} salvo${res.ai ? ' · marcado como IA' : ''}${res.thumb && res.thumb !== 'phone' && res.thumb !== 'sem campo' ? ' · thumbnail nova' : ''}`);
    return res;
  } finally { await st.close(); }
}

/* ───────── canal novo (conta de marca) e identidade visual ───────── */

/** escreve num <input> de verdade (foco, seleciona tudo, apaga e digita) e confere pelo value */
async function typeInto(st: Studio, js: string, text: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const box = await st.ev<number[] | null>(`(() => { ${DEEP} const el = ${js}; if (!el) return null; el.scrollIntoView({ block: 'center' }); el.focus(); const r = el.getBoundingClientRect(); return [r.x + Math.min(20, r.width / 2), r.y + r.height / 2]; })()`);
    if (!box) return false;
    for (const type of ['mousePressed', 'mouseReleased']) await st.cdp.send('Input.dispatchMouseEvent', { type, x: box[0], y: box[1], button: 'left', clickCount: 1 }, st.session);
    await st.ev(`(() => { ${DEEP} const el = ${js}; if (el && el.select) el.select(); return true; })()`);
    await st.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, st.session);
    await st.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, st.session);
    await st.cdp.send('Input.insertText', { text }, st.session);
    await wait(900);
    const v = await st.ev<string>(`(() => { ${DEEP} const el = ${js}; return el ? String(el.value ?? el.innerText ?? '') : ''; })()`);
    if (sameText(v, text)) return true;
  }
  return false;
}

/**
 * Cria um CANAL NOVO (conta de marca gerida pela conta Google logada) pela tela "Criar um canal" do YouTube:
 * nome e identificador (@handle; ocupado → tenta variações). Devolve o id UC… e o handle aceito.
 * A foto, o banner e a descrição entram depois, no Studio (youtubeBrandChannel).
 */
export async function youtubeCreateChannel(job: { port: number; name: string; handle: string; log: (l: string) => void; debugDir?: string; signal?: AbortSignal }): Promise<{ channelId: string; handle: string; studioUrl: string }> {
  const cdp = await Cdp.connect(job.port);
  const st = new Studio(cdp, job);
  try {
    await st.open('https://www.youtube.com/channel_switcher');
    const opened = await until(() => st.ev<boolean>(`(() => { ${DEEP} const a = deepAll('a').filter(vis).find((e) => /create_channel/.test(e.getAttribute('href') || '')); if (!a) return false; a.click(); return true; })()`), 30_000, 1500);
    if (!opened) await st.fail('criar canal', 'não achei "Criar um canal" na lista de canais da conta');
    const DLG = `deepAll('ytd-channel-creation-dialog-renderer').filter(vis)[0]`;
    if (!(await until(() => st.ev<boolean>(`(() => { ${DEEP} return !!${DLG}; })()`), 30_000, 1000))) await st.fail('diálogo criar canal', 'o diálogo "Como você vai aparecer" não abriu');
    const nameJs = `(deepAll('input', ${DLG}).filter(vis)[0])`, handleJs = `(deepAll('input', ${DLG}).filter(vis)[1])`;
    if (!(await typeInto(st, nameJs, job.name))) await st.fail('nome do canal', 'não consegui escrever o nome do canal');
    job.log(`YouTube: nome do canal "${job.name}"`);
    const base = job.handle.replace(/^@/, '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 26) || 'canal';
    let handle = '';
    for (const cand of [base, `${base}tv`, `${base}br`, `${base}-${Math.floor(Math.random() * 900 + 100)}`]) {
      if (!(await typeInto(st, handleJs, cand))) continue;
      await wait(3000);    // o YouTube confere a disponibilidade enquanto digita
      const bad = await st.ev<boolean>(`(() => { ${DEEP} const d = ${DLG}; return /indispon|unavailable|not available|em uso|already taken|inválid|invalid/i.test(d ? d.innerText : ''); })()`);
      if (!bad) { handle = cand; break; }
      job.log(`YouTube: @${cand} indisponível — tentando outro`);
    }
    if (!handle) await st.fail('identificador', `nenhum identificador disponível a partir de @${base}`);
    job.log(`YouTube: identificador @${handle}`);
    const created = await st.ev<boolean>(`(() => { ${DEEP} const b = deepAll('button', ${DLG}).filter(vis).find((x) => /^\\s*(create channel|criar canal)\\s*$/i.test(x.innerText || '')); if (!b) return false; b.click(); return true; })()`);
    if (!created) await st.fail('botão criar', 'não achei o botão "Criar canal"');
    const url = await until(async () => { const h = await st.ev<string>('location.href', 5000); return /\/channel\/UC[\w-]{20,}/.test(h) ? h : undefined; }, 120_000, 2000);
    if (!url) await st.fail('canal criado', 'cliquei em "Criar canal" mas a página do canal novo não abriu (pode pedir verificação: faça no navegador da conta)');
    const channelId = /\/channel\/(UC[\w-]{20,})/.exec(url!)![1]!;
    job.log(`YouTube: canal criado — ${channelId} (@${handle})`);
    return { channelId, handle, studioUrl: `https://studio.youtube.com/channel/${channelId}` };
  } finally { await st.close(); }
}

/**
 * Identidade do canal no Studio (Personalização, aba Perfil): banner, foto e descrição; publica e confere.
 * O canal precisa ser o ATIVO da conta (o Studio abre no canal ativo).
 */
export async function youtubeBrandChannel(job: { port: number; channelId: string; name?: string; banner?: string; avatar?: string; description?: string; log: (l: string) => void; debugDir?: string; signal?: AbortSignal }): Promise<{ banner?: boolean; avatar?: boolean; description?: boolean }> {
  const cdp = await Cdp.connect(job.port);
  const st = new Studio(cdp, job);
  const res: { banner?: boolean; avatar?: boolean; description?: boolean } = {};
  try {
    /* o Studio só abre no canal ATIVO: troca para o canal na lista de canais da conta (ou responde "Selecione um canal") */
    if (job.name) await youtubeSwitchChannel(st, job.name, job.log);
    await st.open(`https://studio.youtube.com/channel/${job.channelId}/editing/profile`);
    if (job.name) await st.ev<boolean>(`(() => { ${DEEP} const it = deepAll('ytd-account-item-renderer, tp-yt-paper-item, ytcp-ve, [role=option], a').filter(vis).find((e) => (e.innerText || '').split('\\n').map((x) => x.trim()).includes(${JSON.stringify(job.name)})); if (!it) return false; it.click(); return true; })()`).catch(() => false);
    if (!(await until(() => st.ev<boolean>(`(() => { ${DEEP} return deepAll('input#file-selector').length >= 2 && !!deep('#publish-button'); })()`), 60_000, 1500))) await st.fail('personalização', 'a página de personalização do canal não abriu');
    await wait(2500);
    /* canal novo: aviso de boas-vindas por cima ("Continuar") */
    await st.ev<boolean>(`(() => { ${DEEP} const b = deepAll('#dismiss-button, ytcp-button, button').filter(vis).find((x) => /^\\s*(continuar|continue|entendi|got it)\\s*$/i.test(x.innerText || '')); if (b) b.click(); return !!b; })()`).catch(() => false);
    await wait(1500);
    await cdp.send('DOM.enable', {}, st.session);
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }, st.session).catch(() => {});
    /* botões "Enviar/Alterar" na ordem da página: banner, foto, marca da imagem. O seletor de arquivos só abre com
       clique de mouse de verdade: intercepta o seletor e entrega o arquivo; sem seletor, usa o input da página.
       Cada imagem abre um recorte (botão Concluído). */
    const setImage = async (idx: number, file: string, what: string) => {
      const FIND = `deepAll('#upload-button, #replace-button').filter(vis)[${idx}]`;
      const box = await st.ev<number[] | null>(`(() => { ${DEEP} const b = ${FIND}; if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      let sent = false;
      if (box) {
        await wait(600);
        const box2 = await st.ev<number[] | null>(`(() => { ${DEEP} const b = ${FIND}; if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`) ?? box;
        const ev = cdp.waitEvent('Page.fileChooserOpened', st.session, 8000);
        for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: box2[0], y: box2[1], button: 'left', clickCount: 1 }, st.session);
        const opened = await ev.catch(() => undefined) as { backendNodeId?: number } | undefined;
        if (opened?.backendNodeId) { await cdp.send('DOM.setFileInputFiles', { files: [path.resolve(file)], backendNodeId: opened.backendNodeId }, st.session); sent = true; }
      }
      if (!sent) {
        const r = await cdp.send('Runtime.evaluate', { expression: `(() => { ${DEEP} return deepAll('input#file-selector')[${idx}] || null; })()`, returnByValue: false }, st.session) as { result?: { objectId?: string } };
        if (!r.result?.objectId) return false;
        await cdp.send('DOM.setFileInputFiles', { files: [path.resolve(file)], objectId: r.result.objectId }, st.session);
      }
      const done = await until(() => st.ev<boolean>(`(() => { ${DEEP} const b = deepAll('ytcp-button, button').filter(vis).find((x) => /^\\s*(done|concluído|concluir|pronto)\\s*$/i.test(x.innerText || '')); if (!b) return false; b.click(); return true; })()`), 30_000, 1000);
      if (!done) await st.dbg(`imagem ${what} (seletor ${sent ? 'interceptado' : 'não abriu'})`);
      job.log(`YouTube: ${what} ${done ? 'enviado' : 'NÃO enviado (o recorte não abriu)'}`);
      await wait(2500);
      return !!done;
    };
    if (job.banner && fs.existsSync(job.banner)) res.banner = await setImage(0, job.banner, 'banner');
    if (job.avatar && fs.existsSync(job.avatar)) res.avatar = await setImage(1, job.avatar, 'foto do canal');
    if (job.description) {
      const ok = await st.setText('ytcp-social-suggestions-textbox#description-textbox #textbox, #description-textbox #textbox, #description-container #textbox', job.description.slice(0, 1000));
      res.description = ok; job.log(`YouTube: descrição ${ok ? 'escrita' : 'NÃO escrita (campo não encontrado)'}`);
    }
    const PUB_OFF = `(() => { ${DEEP} const b = deep('#publish-button'); return !b || b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true'; })()`;
    /* o Publicar só libera depois que as imagens terminam de subir; desabilitado ANTES do clique = nada pendente */
    const enabled = await until(async () => !(await st.ev<boolean>(PUB_OFF)), 90_000, 1500);
    if (!enabled) {
      if (res.banner || res.avatar || res.description) await st.fail('publicar personalização', 'as mudanças não liberaram o botão Publicar (as imagens não subiram)');
      job.log('YouTube: nada para publicar'); return res;
    }
    await st.mouseClick('#publish-button');
    await wait(5000);
    if (process.env.FF_DEBUG_BRAND) await st.dbg('depois de publicar');
    const saved = await until(() => st.ev<boolean>(PUB_OFF), 60_000, 1500);
    if (!saved) await st.fail('publicar personalização', 'cliquei em Publicar mas o Studio não confirmou');
    /* confere de verdade: recarrega e vê se a foto/banner deixaram de ser os padrões (letra / ilustração) */
    await wait(4000);
    await cdp.send('Page.reload', {}, st.session);
    await wait(8000);
    const after = await st.ev<{ avatarDefault: boolean; bannerEmpty: boolean }>(`(() => { ${DEEP}
      const imgs = deepAll('img').filter(vis).map((i) => ({ src: i.src || '', w: i.getBoundingClientRect().width }));
      const big = imgs.filter((i) => i.w >= 100 && /ggpht|googleusercontent/.test(i.src));
      return { avatarDefault: !big.some((i) => !/\\/ytc\\//.test(i.src)), bannerEmpty: !deepAll('#banner-image, img').filter(vis).some((i) => /ggpht|googleusercontent/.test(i.src || '') && i.getBoundingClientRect().width >= 250) };
    })()`).catch(() => ({ avatarDefault: true, bannerEmpty: true }));
    if (res.avatar && after.avatarDefault) { res.avatar = false; job.log('⚠ YouTube: a foto do canal ainda é a padrão depois de publicar (pode levar alguns minutos para processar)'); }
    if (res.banner && after.bannerEmpty) { res.banner = false; job.log('⚠ YouTube: o banner ainda não aparece depois de publicar (pode levar alguns minutos para processar)'); }
    job.log('YouTube: personalização publicada');
    return res;
  } finally { await st.close(); }
}

/** Torna `name` o canal ativo da conta (página "Todos os canais" → clica no canal). */
async function youtubeSwitchChannel(st: Studio, name: string, log: (l: string) => void): Promise<boolean> {
  await st.open('https://www.youtube.com/channel_switcher');
  const ok = await until(() => st.ev<boolean>(`(() => { ${DEEP} const it = deepAll('ytd-account-item-renderer').filter(vis).find((e) => (e.innerText || '').split('\\n').map((x) => x.trim()).includes(${JSON.stringify(name)})); if (!it) return false; (it.querySelector('tp-yt-paper-icon-item, a, #contents') || it).click(); return true; })()`), 30_000, 1500);
  await wait(4000);
  log(ok ? `YouTube: canal ativo → ${name}` : `YouTube: não achei "${name}" na lista de canais`);
  return !!ok;
}
