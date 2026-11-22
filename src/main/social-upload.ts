import * as fs from 'node:fs';
import * as path from 'node:path';
import { Cdp } from './flow';

/**
 * Publicação no TikTok, Instagram, Facebook e Kwai pelo navegador da conta (Automações), via CDP — o mesmo motor
 * do upload do YouTube. O login é sempre do usuário (o app nunca digita senha). Um fluxo só, guiado por uma
 * especificação por plataforma: abre a página de envio, (se preciso) clica "Criar → Publicação", entrega o arquivo
 * ao seletor, avança as telas, escreve a legenda, ajusta a privacidade quando dá e clica "Publicar". Cada passo é
 * conferido; se a página mudar e algo não for achado, grava print + diagnóstico em debugDir e falha com o motivo.
 */

export type SocialPlatform = 'tiktok' | 'instagram' | 'facebook' | 'kwai';

export interface SocialJob {
  platform: SocialPlatform;
  port: number; file: string; caption: string;
  /** PUBLIC publica aberto; PRIVATE/UNLISTED pede "somente eu" onde a plataforma tem a opção */
  visibility?: 'UNLISTED' | 'PRIVATE' | 'PUBLIC';
  uploadUrl?: string; timeoutSec?: number;
  log: (l: string) => void; signal?: AbortSignal; debugDir?: string;
}

interface Spec {
  label: string; url: string;
  /** botões a clicar antes do seletor de arquivo aparecer (Instagram: Criar → Publicação) */
  open: RegExp[];
  next: RegExp; post: RegExp;
  /** campo da legenda: aria-label/placeholder */
  caption: RegExp;
  /** opção de privacidade restrita (texto do botão/opção) */
  privateOpt?: RegExp;
  login: RegExp;
  done: RegExp;
  maxCaption: number;
}

export const SOCIAL_SPECS: Record<SocialPlatform, Spec> = {
  tiktok: {
    label: 'TikTok', url: 'https://www.tiktok.com/tiktokstudio/upload', open: [],
    next: /^(Avançar|Next)$/i, post: /^(Publicar|Postar|Post)$/i,
    caption: /legenda|descri|caption|description/i, privateOpt: /^(Somente (você|eu)|Only me|Privad[oa]|Private)$/i,
    login: /\/login|passport\.tiktok/i, done: /(foi publicado|publicado|seu vídeo foi|your video (has been|was) (posted|uploaded)|posted|enviado)/i, maxCaption: 2200,
  },
  instagram: {
    label: 'Instagram', url: 'https://www.instagram.com/', open: [/^(Criar|Create|Nova publicação|New post)$/i, /^(Publicação|Post)$/i],
    next: /^(Avançar|Next|OK)$/i, post: /^(Compartilhar|Share)$/i,
    caption: /legenda|caption|escreva/i,
    login: /accounts\/login|\/challenge/i, done: /(foi compartilhad|reel compartilhado|post shared|your (reel|post) has been shared|compartilhada)/i, maxCaption: 2200,
  },
  facebook: {
    label: 'Facebook', url: 'https://www.facebook.com/reels/create/', open: [],
    next: /^(Avançar|Next)$/i, post: /^(Publicar|Publish|Compartilhar|Share)$/i,
    caption: /descri|legenda|description|caption|o que você está pensando|what's on your mind/i, privateOpt: /^(Somente eu|Only me)$/i,
    login: /\/login|checkpoint/i, done: /(publicad|published|seu reel|your reel)/i, maxCaption: 5000,
  },
  kwai: {
    label: 'Kwai', url: 'https://www.kwai.com/upload', open: [],
    next: /^(Avançar|Next)$/i, post: /^(Publicar|Postar|Post|Upload)$/i,
    caption: /legenda|descri|caption|description/i, privateOpt: /^(Privad[oa]|Private|Somente eu|Only me)$/i,
    login: /\/login/i, done: /(publicad|posted|uploaded|enviado)/i, maxCaption: 1000,
  },
};

/** Legenda da rede: título + descrição + hashtags das tags, cortada no limite da plataforma. Função pura. */
export function socialCaption(platform: SocialPlatform, o: { title: string; description?: string; tags?: string[] }): string {
  const tags = (o.tags ?? []).map((t) => `#${t.replace(/^#/, '').replace(/[^\p{L}\p{N}_]+/gu, '')}`).filter((t) => t.length > 1).slice(0, 8).join(' ');
  /* a descrição do YouTube costuma ter capítulos e links longos: na rede social entra só o começo */
  const desc = (o.description ?? '').split(/\n{2,}/)[0]?.trim() ?? '';
  const text = [o.title.trim(), desc, tags].filter(Boolean).join('\n\n');
  const max = SOCIAL_SPECS[platform].maxCaption;
  return text.length <= max ? text : text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* busca que atravessa shadow DOM + texto/rótulo de um elemento */
const HELPERS = String.raw`
  const deepAll = (sel, root = document) => { const out = [...root.querySelectorAll(sel)]; for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepAll(sel, el.shadowRoot)); return out; };
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => ((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || el.textContent || '')).replace(/\s+/g, ' ').trim();
  const center = (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const enabled = (el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true';
`;

class Page {
  session = ''; targetId = '';
  constructor(readonly cdp: Cdp, readonly job: SocialJob) {}
  async open(url: string) {
    const t = await this.cdp.send('Target.createTarget', { url }) as { targetId: string };
    this.targetId = t.targetId;
    this.session = (await this.cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true }) as { sessionId: string }).sessionId;
    await this.cdp.send('Page.enable', {}, this.session);
    await this.cdp.send('Page.bringToFront', {}, this.session);
  }
  async ev<T>(expression: string, timeoutMs = 20_000): Promise<T> {
    const r = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, this.session, timeoutMs) as { result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text ?? 'erro na página');
    return r.result?.value as T;
  }
  /** clique de mouse de verdade (os sites ignoram el.click() em muitos botões) */
  async clickAt(p: { x: number; y: number }) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const) await this.cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }, this.session);
  }
  /** botão visível e habilitado cujo texto bate com o padrão (o último na ordem do DOM = o do diálogo da frente) */
  async button(re: RegExp): Promise<{ x: number; y: number } | null> {
    return this.ev(`(() => { ${HELPERS} const re = new RegExp(${JSON.stringify(re.source)}, ${JSON.stringify(re.flags)});
      const b = deepAll('button, [role=button], [role=menuitem], a, [role=option], [role=radio], label, div[tabindex]').filter((el) => vis(el) && enabled(el) && re.test(label(el)) && label(el).length < 60).pop();
      return b ? center(b) : null; })()`);
  }
  async fail(why: string, message: string): Promise<never> {
    try {
      if (this.job.debugDir) {
        fs.mkdirSync(this.job.debugDir, { recursive: true });
        const shot = await this.cdp.send('Page.captureScreenshot', { format: 'png' }, this.session, 15_000) as { data?: string };
        if (shot.data) fs.writeFileSync(path.join(this.job.debugDir, 'debug.png'), Buffer.from(shot.data, 'base64'));
        const info = await this.ev<unknown>(`(() => { ${HELPERS} return { url: location.href, buttons: deepAll('button,[role=button]').filter(vis).map(label).filter(Boolean).slice(0, 60) }; })()`).catch(() => ({}));
        fs.writeFileSync(path.join(this.job.debugDir, 'debug.json'), JSON.stringify({ why, at: new Date().toISOString(), ...(info as object) }, null, 2));
        this.job.log(`diagnóstico gravado em ${this.job.debugDir}`);
      }
    } catch { /* sem diagnóstico */ }
    throw new Error(message);
  }
  async close() { try { await this.cdp.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* já fechada */ } this.cdp.close(); }
}

async function until<T>(fn: () => Promise<T | undefined | null | false>, ms: number, step = 800, signal?: AbortSignal): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (signal?.aborted) throw new Error('cancelado');
    try { const v = await fn(); if (v) return v; } catch { /* página carregando */ }
    await wait(step);
  }
  return undefined;
}

export async function socialUpload(job: SocialJob): Promise<{ url?: string }> {
  const spec = SOCIAL_SPECS[job.platform];
  if (!spec) throw new Error(`plataforma sem uploader: ${job.platform}`);
  if (!fs.existsSync(job.file)) throw new Error(`vídeo não encontrado: ${job.file}`);
  const cdp = await Cdp.connect(job.port);
  const pg = new Page(cdp, job);
  const abort = () => { void pg.close(); };
  job.signal?.addEventListener('abort', abort, { once: true });
  const L = spec.label;
  try {
    await pg.open(job.uploadUrl ?? spec.url);
    const total = (job.timeoutSec ?? 1800) * 1000;

    /* 1) logado? (a página de login tem campo de senha ou URL de login) */
    await wait(1500);
    const loggedOut = await until(async () => {
      const r = await pg.ev<{ href: string; pass: boolean }>(`({ href: location.href, pass: !!document.querySelector('input[type=password]') })`);
      return { out: spec.login.test(r.href) || r.pass };
    }, 15_000, 1000, job.signal);
    if (loggedOut?.out) throw new Error(`a conta não está logada no ${L}: em Automações abra o navegador da conta e entre no ${L} uma vez`);

    /* 2) Instagram: Criar → Publicação abre o diálogo com o seletor de arquivo */
    for (const re of spec.open) {
      const b = await until(() => pg.button(re), 20_000, 800, job.signal);
      if (b) { await pg.clickAt(b); await wait(1200); }
    }

    /* 3) seletor de arquivo */
    const fileObj = await until(async () => {
      const r = await cdp.send('Runtime.evaluate', { expression: `(() => { ${HELPERS} return deepAll('input[type=file]').find((i) => /video|\\*|mp4/i.test(i.accept || '*')) || deepAll('input[type=file]')[0] || null; })()`, returnByValue: false }, pg.session) as { result?: { objectId?: string; subtype?: string } };
      return r.result?.subtype === 'null' ? undefined : r.result?.objectId;
    }, 60_000, 1000, job.signal);
    if (!fileObj) await pg.fail('sem seletor de arquivo', `não encontrei o envio de arquivo do ${L} (a página mudou?)`);
    await cdp.send('DOM.enable', {}, pg.session);
    await cdp.send('DOM.setFileInputFiles', { files: [path.resolve(job.file)], objectId: fileObj }, pg.session);
    job.log(`${L}: enviando ${path.basename(job.file)}…`);

    /* 4) telas: escreve a legenda quando o campo aparece, avança, ajusta a privacidade e publica */
    let captionDone = !job.caption.trim(), privacyDone = (job.visibility ?? 'PUBLIC') === 'PUBLIC' || !spec.privateOpt, posted = false;
    const end = Date.now() + total;
    let nexts = 0;
    while (Date.now() < end && !posted) {
      if (job.signal?.aborted) throw new Error('cancelado');
      if (!captionDone) {
        const field = await pg.ev<{ x: number; y: number } | null>(`(() => { ${HELPERS} const re = new RegExp(${JSON.stringify(spec.caption.source)}, 'i');
          const f = deepAll('[contenteditable=true], [contenteditable=""], textarea').filter(vis).find((el) => re.test((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-placeholder') || '') + ' ' + (el.dataset.placeholder || ''))) || null;
          return f ? center(f) : null; })()`);
        if (field) {
          await pg.clickAt(field); await wait(300);
          /* SEGURANÇA: só apaga (Ctrl+A) se o foco está mesmo num campo de texto — senão o atalho selecionaria a página */
          const focusOk = await pg.ev<boolean>(`(() => { const a = document.activeElement; return !!a && (a.isContentEditable || a.tagName === 'TEXTAREA'); })()`);
          if (focusOk) {
            await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 }, pg.session);
            await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 }, pg.session);
            for (const type of ['keyDown', 'keyUp'] as const) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, pg.session);
            await cdp.send('Input.insertText', { text: job.caption }, pg.session);
            captionDone = true;
            job.log(`${L}: legenda escrita (${job.caption.length} caracteres)`);
            await wait(600);
            continue;
          }
        }
      }
      if (!privacyDone && spec.privateOpt) {
        const opt = await pg.button(spec.privateOpt);
        if (opt) { await pg.clickAt(opt); privacyDone = true; job.log(`${L}: privacidade restrita ("somente eu")`); await wait(500); continue; }
      }
      const post = await pg.button(spec.post);
      /* publica quando a legenda já entrou (ou depois de 3 telas sem campo de legenda — algumas contas não têm) */
      if (post && (captionDone || nexts >= 3)) {
        if (!privacyDone) job.log(`${L}: não achei a opção "somente eu" — o vídeo sai com a privacidade padrão da conta`);
        await pg.clickAt(post); posted = true; break;
      }
      const nx = await pg.button(spec.next);
      if (nx) { await pg.clickAt(nx); nexts++; await wait(1500); continue; }
      await wait(1500);   // o envio ainda está processando (botões desabilitados)
    }
    if (!posted) await pg.fail('não publicou', `${L}: o botão de publicar não ficou disponível a tempo`);
    job.log(`${L}: publicando…`);

    /* 5) confirmação (mensagem de sucesso ou a página sai do envio) */
    const startUrl = await pg.ev<string>('location.href').catch(() => '');
    const ok = await until(async () => {
      const r = await pg.ev<{ text: string; href: string }>(`({ text: document.body.innerText.slice(0, 20000), href: location.href })`);
      return spec.done.test(r.text) || (r.href !== startUrl && !/upload|create/i.test(r.href)) ? r : undefined;
    }, 180_000, 1500, job.signal);
    if (!ok) await pg.fail('sem confirmação', `${L}: cliquei em publicar, mas não vi a confirmação (confira na conta)`);
    const link = /https?:\/\/[^\s"']+\/(video|reel|p|share)\/[^\s"']+/i.exec(ok!.text)?.[0];
    job.log(`${L}: publicado${link ? ` — ${link}` : ''}`);
    return { url: link ?? (ok!.href !== startUrl ? ok!.href : undefined) };
  } finally {
    job.signal?.removeEventListener('abort', abort);
    await pg.close();
  }
}
