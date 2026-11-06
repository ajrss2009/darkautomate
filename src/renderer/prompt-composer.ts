/*
 * Área de prompt "como a do harness": o campo de texto ganha uma barra com 📎 anexar mídia (imagem, vídeo, áudio,
 * texto), 🎙 gravar a voz (a fala vira texto pelo Whisper, no idioma do projeto, e entra no prompt onde está o cursor),
 * arrastar e soltar arquivos e colar imagens (Ctrl+V). Os arquivos vão para quem usa o componente (onFiles).
 */

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (typeof v === 'boolean') { if (v) el.setAttribute(k, ''); }
    else el.setAttribute(k, v);
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = Record<string, (...a: any[]) => Promise<any>> & { pathForFile?: (f: File) => string };
export interface ComposerCtx { forge: Api; toast: (m: string, bad?: boolean) => void; guard: <T>(fn: () => Promise<T>) => Promise<T | undefined> }

/** Insere `text` no cursor do campo (com espaço antes, se precisar). */
export function insertAtCursor(ta: HTMLTextAreaElement, text: string) {
  const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
  const before = ta.value.slice(0, a), sep = before && !/\s$/.test(before) ? ' ' : '';
  ta.value = before + sep + text + ta.value.slice(b);
  const pos = (before + sep + text).length;
  ta.selectionStart = ta.selectionEnd = pos;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

export function promptComposer(c: ComposerCtx, ta: HTMLTextAreaElement, o: {
  /** arquivos anexados (caminhos no disco) */
  onFiles: (paths: string[]) => void | Promise<void>;
  /** idioma da fala (ex.: "pt-BR"); vazio = detecta */
  language?: () => string | undefined;
  /** o componente também cuida de arrastar e soltar no campo (padrão: sim) */
  drop?: boolean;
  /** escreve no prompt o nome do arquivo anexado (padrão: não) */
  mention?: boolean;
}): HTMLElement {
  const status = h('span', { class: 'pc-status muted small' });
  const meter = h('span', { class: 'pc-meter' }, h('i', {}));
  meter.style.display = 'none';
  const files = async (paths: string[]) => {
    const list = paths.filter(Boolean);
    if (!list.length) return;
    await o.onFiles(list);
    if (o.mention) insertAtCursor(ta, list.map((p) => `[arquivo: ${p.split(/[\\/]/).pop()}]`).join(' '));
  };
  const attach = h('button', { type: 'button', class: 'pc-btn', 'data-act': 'pc-attach', title: 'Anexar imagem, vídeo, áudio ou texto (também dá para arrastar para o campo ou colar uma imagem com Ctrl+V)', onclick: () => void c.guard(async () => {
    await files(await c.forge['attachPick']!('files') as string[]);
  }) }, '📎');

  /* gravação de voz → Whisper → texto no cursor */
  let rec: MediaRecorder | undefined, chunks: Blob[] = [], stream: MediaStream | undefined, t0 = 0, timer = 0, raf = 0, ac: AudioContext | undefined;
  const mic = h('button', { type: 'button', class: 'pc-btn', 'data-act': 'pc-mic', title: 'Gravar a voz: fale o prompt e clique de novo para parar — a fala vira texto aqui' }, '🎙');
  const stopMeter = () => { cancelAnimationFrame(raf); window.clearInterval(timer); meter.style.display = 'none'; void ac?.close().catch(() => {}); ac = undefined; };
  const start = async () => {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => void finish();
    rec.start(250);
    t0 = Date.now();
    mic.classList.add('rec'); mic.textContent = '⏹'; mic.title = 'Parar e transcrever';
    timer = window.setInterval(() => { status.textContent = `● gravando ${Math.floor((Date.now() - t0) / 1000)} s — clique ⏹ para parar`; }, 250);
    /* medidor de volume (mostra que o microfone está captando) */
    ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize), bar = meter.firstElementChild as HTMLElement; meter.style.display = '';
    const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); bar.style.width = `${Math.min(100, (m / 128) * 160)}%`; raf = requestAnimationFrame(tick); };
    tick();
  };
  const finish = async () => {
    stopMeter();
    stream?.getTracks().forEach((t) => t.stop());
    mic.classList.remove('rec'); mic.textContent = '🎙'; mic.title = 'Gravar a voz';
    const blob = new Blob(chunks, { type: rec?.mimeType || 'audio/webm' });
    if (blob.size < 2000 || Date.now() - t0 < 600) { status.textContent = 'gravação curta demais'; return; }
    status.textContent = '⏳ transcrevendo a fala…'; mic.setAttribute('disabled', '');
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const r = await c.forge['promptTranscribe']!(bytes, blob.type.includes('ogg') ? 'ogg' : 'webm', o.language?.()) as { text: string };
      const text = r.text.trim();
      if (!text) { status.textContent = 'não entendi a fala — tente de novo, mais perto do microfone'; return; }
      insertAtCursor(ta, text);
      status.textContent = `✓ ${text.split(/\s+/).length} palavras transcritas`;
    } catch (e) { status.textContent = ''; c.toast(`Transcrição falhou: ${(e as Error).message}`, true); }
    finally { mic.removeAttribute('disabled'); }
  };
  mic.addEventListener('click', () => void c.guard(async () => {
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    try { await start(); } catch (e) { stopMeter(); c.toast(`Microfone indisponível: ${(e as Error).message}`, true); }
  }));

  /* colar imagem (print) → arquivo → anexo */
  ta.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items ?? []).filter((i) => i.kind === 'file');
    if (!items.length) return;
    e.preventDefault();
    void c.guard(async () => {
      const paths: string[] = [];
      for (const it of items) {
        const f = it.getAsFile(); if (!f) continue;
        const p0 = c.forge.pathForFile?.(f);
        if (p0) { paths.push(p0); continue; }
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
        paths.push(await c.forge['promptSaveBlob']!(new Uint8Array(await f.arrayBuffer()), `colado-${Date.now()}.${ext}`) as string);
      }
      await files(paths);
      status.textContent = `📎 ${paths.length} arquivo(s) colado(s)`;
    });
  });
  if (o.drop !== false) {
    ta.addEventListener('dragover', (e) => { e.preventDefault(); ta.classList.add('drop'); });
    ta.addEventListener('dragleave', () => ta.classList.remove('drop'));
    ta.addEventListener('drop', (e) => {
      e.preventDefault(); ta.classList.remove('drop');
      const paths = Array.from(e.dataTransfer?.files ?? []).map((f) => c.forge.pathForFile?.(f) ?? '').filter(Boolean);
      void c.guard(async () => { await files(paths); status.textContent = `📎 ${paths.length} arquivo(s) anexado(s)`; });
    });
  }
  return h('div', { class: 'pc-box' }, ta, h('div', { class: 'pc-bar' }, attach, mic, meter, status));
}
