import { httpFetch } from './http';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ApiCategory, ProviderConfig } from '../shared/types';

function headers(p: ProviderConfig): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) };
}
const base = (p: ProviderConfig) => p.baseUrl.replace(/\/+$/, '');

async function ok(r: Response, what: string): Promise<Response> {
  if (!r.ok) throw new Error(`${what} HTTP ${r.status}: ${(await r.text()).slice(0, 500)}`);
  return r;
}

const gkey = (p: ProviderConfig) => encodeURIComponent(p.apiKey);

const mimeOf = (f: string) => /\.jpe?g$/i.test(f) ? 'image/jpeg' : /\.webp$/i.test(f) ? 'image/webp' : /\.gif$/i.test(f) ? 'image/gif' : 'image/png';

/** Texto (chat completions, compatível com OpenAI/gateways; Gemini via generateContent).
 * `images`: caminhos locais enviados como referência visual (visão) junto do prompt. */
export async function chat(p: ProviderConfig, model: string, prompt: string, signal: AbortSignal, images: string[] = []): Promise<string> {
  if (p.kind === 'snapgen') throw new Error('Snapgen.AI não oferece chat de texto neste adaptador — use imagem/vídeo');
  const pics = images.filter((f) => f && fs.existsSync(f));
  if (p.kind === 'gemini') {
    const parts: any[] = [{ text: prompt }, ...pics.map((f) => ({ inline_data: { mime_type: mimeOf(f), data: fs.readFileSync(f).toString('base64') } }))];
    const r = await ok(await fetch(`${base(p)}/models/${model}:generateContent?key=${gkey(p)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ contents: [{ parts }] }),
    }), 'gemini');
    const j = (await r.json()) as any;
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? '').join('');
    if (!text) throw new Error('resposta do Gemini vazia');
    return text;
  }
  const content = pics.length
    ? [{ type: 'text', text: prompt }, ...pics.map((f) => ({ type: 'image_url', image_url: { url: `data:${mimeOf(f)};base64,${fs.readFileSync(f).toString('base64')}` } }))]
    : prompt;
  const r = await ok(await fetch(`${base(p)}/chat/completions`, {
    method: 'POST', headers: headers(p), signal,
    body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
  }), 'chat');
  const j = (await r.json()) as any;
  const text = j?.choices?.[0]?.message?.content;
  if (!text) throw new Error('resposta de chat vazia');
  return String(text);
}

/** Imagem (images/generations). Aceita b64_json ou url. */
export async function image(p: ProviderConfig, model: string, prompt: string, size: string, dest: string, signal: AbortSignal): Promise<string> {
  if (p.kind === 'snapgen') {
    const aspect = size === '1024x1024' ? '1:1' : size.includes('1536x1024') ? '16:9' : '9:16';
    return snapgenImage(p, model, prompt, { aspect, dest, signal });
  }
  if (p.kind === 'gemini') {
    const r = await ok(await fetch(`${base(p)}/models/${model}:generateContent?key=${gkey(p)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
    }), 'gemini-image');
    const j = (await r.json()) as any;
    const part = (j?.candidates?.[0]?.content?.parts ?? []).find((x: any) => x.inlineData?.data || x.inline_data?.data);
    const b64 = part?.inlineData?.data ?? part?.inline_data?.data;
    if (!b64) throw new Error('Gemini não devolveu imagem (modelo sem suporte a imagem?)');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
    return dest;
  }
  const r = await ok(await fetch(`${base(p)}/images/generations`, {
    method: 'POST', headers: headers(p), signal,
    body: JSON.stringify({ model, prompt, size, n: 1 }),
  }), 'image');
  const j = (await r.json()) as any;
  const item = j?.data?.[0];
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (item?.b64_json) fs.writeFileSync(dest, Buffer.from(item.b64_json, 'base64'));
  else if (item?.url) fs.writeFileSync(dest, Buffer.from(await (await ok(await fetch(item.url, { signal }), 'download')).arrayBuffer()));
  else throw new Error('resposta de imagem sem dados');
  return dest;
}

/** TTS (audio/speech). */
/** `instructions` (tom, ritmo, emoção) só é enviado a modelos que aceitam — gpt-4o-*-tts. */
/** Vozes prontas do Gemini TTS (multilíngues: falam o idioma do texto). */
export const GEMINI_TTS_VOICES = ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];
export const GEMINI_TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'];

/** WAV PCM 16-bit a partir de amostras cruas (o Gemini TTS devolve L16 24 kHz mono). */
export function pcmToWav(pcm: Buffer, rate = 24000, channels = 1): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * Gemini TTS (generateContent com responseModalities AUDIO). O tom vai como instrução no próprio texto.
 * Grava WAV ao lado de `dest` (troca a extensão) e devolve o caminho gravado.
 */
export async function geminiTts(p: ProviderConfig, model: string, voice: string, text: string, dest: string, signal: AbortSignal, instructions?: string): Promise<string> {
  const said = instructions?.trim() ? `${instructions.trim()}\n\n${text}` : text;
  const r = await ok(await fetch(`${base(p)}/models/${model}:generateContent?key=${gkey(p)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ contents: [{ parts: [{ text: said }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Kore' } } } } }),
  }), 'gemini-tts');
  const j = (await r.json()) as any;
  const part = (j?.candidates?.[0]?.content?.parts ?? []).find((x: any) => x?.inlineData?.data);
  if (!part) throw new Error('Gemini TTS não devolveu áudio');
  const rate = Number(/rate=(\d+)/.exec(String(part.inlineData.mimeType ?? ''))?.[1] ?? 24000);
  const out = dest.replace(/\.[a-z0-9]+$/i, '') + '.wav';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, pcmToWav(Buffer.from(String(part.inlineData.data), 'base64'), rate));
  return out;
}

export async function tts(p: ProviderConfig, model: string, voice: string, text: string, dest: string, signal: AbortSignal, instructions?: string): Promise<string> {
  if (p.kind === 'gemini') return geminiTts(p, model, voice, text, dest, signal, instructions);
  if (p.kind === 'fish') return fishTts(p, model, voice, text, dest, signal, instructions);
  const withInstr = !!instructions?.trim() && /gpt-4o.*tts/i.test(model);
  const r = await ok(await fetch(`${base(p)}/audio/speech`, {
    method: 'POST', headers: headers(p), signal,
    body: JSON.stringify({ model, voice, input: text, response_format: 'mp3', ...(withInstr ? { instructions: instructions!.trim() } : {}) }),
  }), 'tts');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}

/* ═════════════════ Fish Audio (voz) ═════════════════
 * API: https://api.fish.audio — POST /v1/tts (JSON), Bearer token e o modelo no
 * header `model` (não no corpo). A voz é um `reference_id`: o id de um modelo de
 * voz (biblioteca do Fish Audio ou clonado na conta).
 */
export const FISH_BASE = 'https://api.fish.audio';
/** Modelos de voz (header `model`). `s2.1-pro-free` = nível gratuito para desenvolvedores. */
export const FISH_MODELS = ['s2.1-pro-free', 's2.1-pro', 's2-pro', 's1', 'drama-3'];
export const FISH_DEFAULT_MODEL = 's2.1-pro-free';

/** Aceita o id puro ou um link do Fish Audio (fish.audio/m/<id>) e devolve o id. */
export function fishVoiceId(v: string | undefined): string {
  const s = (v ?? '').trim();
  const m = /([0-9a-f]{32})/i.exec(s);
  return m ? m[1]! : s;
}

const fishBase = (p: ProviderConfig) => base(p).replace(/\/v1$/i, '');

/**
 * Fish Audio TTS. O tom (`instructions`) só é aproveitado no `drama-3`, que aceita
 * direções em colchetes no início do texto; nos outros modelos ele é ignorado.
 */
export async function fishTts(p: ProviderConfig, model: string, voice: string, text: string, dest: string, signal: AbortSignal, instructions?: string): Promise<string> {
  if (!p.apiKey) throw new Error('Fish Audio: sem chave de API (Configurações → APIs → Voz)');
  const m = (model || FISH_DEFAULT_MODEL).trim();
  const ref = fishVoiceId(voice);
  const said = /^drama-3/i.test(m) && instructions?.trim() ? `[${instructions.trim()}] ${text}` : text;
  const r = await ok(await fetch(`${fishBase(p)}/v1/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}`, model: m },
    signal,
    body: JSON.stringify({
      text: said,
      format: 'mp3',
      mp3_bitrate: 128,
      normalize: true,
      chunk_length: 300,
      latency: 'normal',
      prosody: { speed: 1, volume: 0, normalize_loudness: true },
      ...(ref ? { reference_id: ref } : {}),
    }),
  }), 'fish-tts');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}

/**
 * Vozes para escolher: as da conta (`self=true`) primeiro e, em seguida, a biblioteca
 * pública (mais usadas, com licença do Fish) — filtradas pelo idioma quando possível.
 * Cada voz é um `reference_id`; o título vai em `voiceLabels` para a interface.
 */
async function fishVoices(p: ProviderConfig, signal: AbortSignal, language?: string): Promise<{ voices: string[]; voiceLabels: Record<string, string>; own: number }> {
  const found = new Map<string, string>();
  const add = (items: any[]): number => {
    let n = 0;
    for (const it of items) {
      const id = String(it?._id ?? '').trim();
      if (!id || found.has(id)) continue;
      const title = String(it?.title ?? '').trim();
      found.set(id, title || id);
      n++;
    }
    return n;
  };
  const list = async (qs: string): Promise<any[]> => {
    const r = await ok(await fetch(`${fishBase(p)}/model?${qs}`, {
      headers: { Authorization: `Bearer ${p.apiKey}` }, signal,
    }), 'fish-models');
    const j = (await r.json()) as any;
    return Array.isArray(j?.items) ? j.items : [];
  };

  const own = add(await list('page_size=100&self=true'));
  const code = (language ?? '').trim().slice(0, 2).toLowerCase();
  if (code) {
    try { add(await list(`page_size=50&sort_by=task_count&licensed=true&language=${encodeURIComponent(code)}`)); } catch { /* filtro opcional */ }
  }
  if (found.size < 20) {
    try { add(await list('page_size=50&sort_by=task_count&licensed=true')); } catch { /* biblioteca opcional */ }
  }
  const ids = [...found.keys()].slice(0, 100);
  const voiceLabels: Record<string, string> = {};
  for (const id of ids) { const t = found.get(id)!; if (t && t !== id) voiceLabels[id] = t; }
  return { voices: ids, voiceLabels, own };
}

export function stripFences(s: string): string {
  const m = /```(?:\w+)?\n([\s\S]*?)```/.exec(s);
  return (m ? m[1]! : s).trim();
}

/** Vídeo Seedance (BytePlus ModelArk): cria tarefa e aguarda. Formato conforme documentação pública; NÃO verificado contra o serviço real. */
export async function seedanceVideo(p: ProviderConfig, model: string, prompt: string, o: { imagePath?: string; seconds: number; ratio: string; dest: string; signal: AbortSignal; log?: (l: string) => void; pollMs?: number }): Promise<string> {
  const content: unknown[] = [{ type: 'text', text: `${prompt} --duration ${Math.round(o.seconds)} --ratio ${o.ratio}` }];
  if (o.imagePath && fs.existsSync(o.imagePath)) {
    const ext = path.extname(o.imagePath).slice(1).replace('jpg', 'jpeg') || 'png';
    content.push({ type: 'image_url', image_url: { url: `data:image/${ext};base64,${fs.readFileSync(o.imagePath).toString('base64')}` } });
  }
  const create = await ok(await fetch(`${base(p)}/contents/generations/tasks`, { method: 'POST', headers: headers(p), signal: o.signal, body: JSON.stringify({ model, content }) }), 'seedance');
  const id = ((await create.json()) as any)?.id;
  if (!id) throw new Error('Seedance não devolveu id de tarefa');
  for (;;) {
    if (o.signal.aborted) throw new Error('cancelado');
    await new Promise((r) => setTimeout(r, o.pollMs ?? 5000));
    const j = (await (await ok(await fetch(`${base(p)}/contents/generations/tasks/${id}`, { headers: headers(p), signal: o.signal }), 'seedance-poll')).json()) as any;
    o.log?.(`Seedance ${j?.status}`);
    if (j?.status === 'succeeded') {
      const url = j?.content?.video_url;
      if (!url) throw new Error('Seedance concluiu sem video_url');
      fs.mkdirSync(path.dirname(o.dest), { recursive: true });
      fs.writeFileSync(o.dest, Buffer.from(await (await ok(await fetch(url, { signal: o.signal }), 'download')).arrayBuffer()));
      return o.dest;
    }
    if (j?.status === 'failed' || j?.status === 'cancelled') throw new Error(`Seedance ${j.status}: ${JSON.stringify(j.error ?? '').slice(0, 200)}`);
  }
}

/* ═════════════════ Snapgen.AI (imagem/vídeo) ═════════════════
 * API: https://api.snapgen.ai/uapi/v1
 * Auth: header x-api-key. Criação multipart; resultado por /history/{uuid}.
 * Créditos: /account (available_credit/locked_credit) e used_credit no histórico.
 */
const snapHeaders = (p: ProviderConfig): Record<string, string> => ({
  Accept: 'application/json',
  ...(p.apiKey ? { 'x-api-key': p.apiKey } : {}),
});
const snapBase = (p: ProviderConfig) => {
  const b = base(p);
  return /\/uapi\/v1$/i.test(b) ? b : `${b}/uapi/v1`;
};
const snapUrl = (p: ProviderConfig, pathname: string) => `${snapBase(p)}${pathname}`;

function snapMime(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
}
function snapAppendFile(form: FormData, field: string, file: string) {
  if (!fs.existsSync(file)) return;
  form.append(field, new Blob([new Uint8Array(fs.readFileSync(file))], { type: snapMime(file) }), path.basename(file));
}
function snapSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('cancelado')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new Error('cancelado')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
function snapMediaUrl(value: unknown): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  try { return new URL(value, 'https://api.snapgen.ai').toString(); } catch { return undefined; }
}
async function snapDownload(url: string, dest: string, signal: AbortSignal) {
  const r = await ok(await fetch(url, { signal }), 'snapgen-download');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}
async function snapPoll(p: ProviderConfig, uuid: string, signal: AbortSignal, log?: (l: string) => void, pollMs = 5000, timeoutMs = 30 * 60 * 1000): Promise<any> {
  const started = Date.now();
  let lastError = '';
  for (;;) {
    if (signal.aborted) throw new Error('cancelado');
    await snapSleep(pollMs, signal);
    let j: any;
    try {
      j = (await (await ok(await fetch(snapUrl(p, `/history/${encodeURIComponent(uuid)}`), { headers: snapHeaders(p), signal }), 'snapgen-history')).json()) as any;
    } catch (e) {
      lastError = (e as Error).message;
      log?.(`Snapgen: consultando (${lastError.slice(0, 120)})`);
      if (Date.now() - started > timeoutMs) throw e;
      continue;
    }
    const status = Number(j?.status);
    const pct = j?.status_percentage != null ? ` ${j.status_percentage}%` : '';
    const credits = j?.used_credit ? ` · ${j.used_credit} crédito(s)` : '';
    log?.(`Snapgen ${j?.status_desc || `status ${status}`}${pct}${credits}`);
    if (status === 2) return j;
    if (status === 3) throw new Error(`Snapgen falhou: ${j?.error_message || j?.error_code || j?.status_desc || 'erro desconhecido'}`);
    if (Date.now() - started > timeoutMs) throw new Error(`Snapgen: tempo esgotado aguardando ${uuid}`);
  }
}

export interface SnapgenCredits { available: number; locked: number; planId?: string; email?: string }

/** Saldo da conta Snapgen (não gera nada e não consome créditos). */
export async function snapgenAccount(p: ProviderConfig, signal: AbortSignal = AbortSignal.timeout(15000)): Promise<SnapgenCredits> {
  if (!p.apiKey) throw new Error('Snapgen: sem chave de API');
  const j = (await (await ok(await fetch(snapUrl(p, '/account'), { headers: snapHeaders(p), signal }), 'snapgen-account')).json()) as any;
  const c = j?.user_credit ?? {};
  return {
    available: Number(c.available_credit ?? 0),
    locked: Number(c.locked_credit ?? 0),
    planId: j?.plan_id ? String(j.plan_id) : undefined,
    email: j?.email ? String(j.email) : undefined,
  };
}

/**
 * Catálogo público de modelos do Snapgen (`/api/service-prices`).
 * Separa imagem/vídeo; Grok (SSE + Bearer) e sd-2/vids ficam de fora porque
 * não usam o mesmo fluxo do adaptador UAPI.
 */
async function snapgenModels(p: ProviderConfig, signal: AbortSignal): Promise<{ models: string[]; modelCategories: Record<string, ApiCategory> }> {
  const origin = new URL(base(p)).origin;
  const r = await ok(await fetch(`${origin}/api/service-prices`, { signal }), 'snapgen-prices');
  const j = (await r.json()) as any;
  const arr: any[] = Array.isArray(j) ? j : Array.isArray(j?.result) ? j.result : [];
  const models: string[] = [];
  const modelCategories: Record<string, ApiCategory> = {};
  const add = (m: string, cat: ApiCategory) => {
    if (!m || models.includes(m)) return;
    models.push(m); modelCategories[m] = cat;
  };
  for (const it of arr) {
    const m = String(it?.model_name ?? '').trim();
    const unit = String(it?.price_unit ?? '').toLowerCase();
    if (!m) continue;
    if (unit === 'image') {
      if (/^(remove-logo|storyboard)/i.test(m)) continue;
      add(m, 'image');
    } else if (unit === 'video' || unit === 'second') {
      if (/^grok/i.test(m) || /^sd-2/i.test(m)) continue;
      add(m, 'video');
    }
  }
  return { models, modelCategories };
}

/** Imagem Snapgen: POST /generate_image (multipart) + polling do histórico. */
export async function snapgenImage(p: ProviderConfig, model: string, prompt: string, o: {
  aspect: string; resolution?: string; style?: string; imagePath?: string; dest: string; signal: AbortSignal;
  log?: (l: string) => void; pollMs?: number;
}): Promise<string> {
  if (!p.apiKey) throw new Error('Snapgen: sem chave de API');
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('model', model);
  form.append('aspect_ratio', o.aspect === '4:5' ? '3:4' : o.aspect);
  form.append('resolution', o.resolution ?? '1K');
  if (o.style) form.append('style', o.style);
  if (o.imagePath) snapAppendFile(form, 'files', o.imagePath);

  const created = (await (await ok(await fetch(snapUrl(p, '/generate_image'), {
    method: 'POST', headers: snapHeaders(p), body: form, signal: o.signal,
  }), 'snapgen-image')).json()) as any;
  const uuid = created?.uuid ?? created?.result?.uuid;
  const done = Number(created?.status) === 2 || !uuid ? created : await snapPoll(p, String(uuid), o.signal, o.log, o.pollMs);
  const item = (done?.generated_image ?? [])[0] ?? {};
  const url = snapMediaUrl(
    item.image_url ?? item.file_download_url ?? item.image_uri ?? item.url ?? item.file_url
    ?? item.download_url ?? item.generated_url ?? item.output_url ?? done?.generate_result ?? done?.result?.generate_result,
  );
  const b64 = item.base64_data ?? item.image_base64 ?? item.b64_json ?? done?.base64_data;
  if (url) await snapDownload(url, o.dest, o.signal);
  else if (b64) {
    fs.mkdirSync(path.dirname(o.dest), { recursive: true });
    fs.writeFileSync(o.dest, Buffer.from(String(b64), 'base64'));
  } else throw new Error('Snapgen: resposta de imagem sem URL/dados');

  const used = Number(done?.used_credit ?? done?.estimated_credit ?? created?.used_credit ?? created?.estimated_credit ?? 0);
  o.log?.(`Snapgen imagem: ${used} crédito(s) usados`);
  return o.dest;
}

/** Endpoint/campos de cada família de vídeo do Snapgen (o site usa endpoints separados). */
function snapgenVideoSpec(model: string): {
  path: string;
  aspectField: 'aspect_ratio' | 'orientation';
  imageField?: 'ref_images' | 'files' | 'image';
  duration: (seconds: number) => number;
} {
  const m = model.toLowerCase();
  const fiveOrTen = (s: number) => (s > 7 ? 10 : 5);
  if (/^sora/.test(m)) return { path: '/video-gen/sora', aspectField: 'aspect_ratio', imageField: 'files', duration: (s) => (s >= 10 ? 12 : s <= 4 ? 4 : 8) };
  if (/^seedance/.test(m)) return { path: '/video-gen/seedance', aspectField: 'aspect_ratio', imageField: 'ref_images', duration: fiveOrTen };
  if (/^kling/.test(m)) return { path: '/video-gen/kling', aspectField: 'aspect_ratio', imageField: 'ref_images', duration: fiveOrTen };
  if (/^minimax/.test(m)) return { path: '/video-gen/minimax', aspectField: 'aspect_ratio', imageField: 'ref_images', duration: fiveOrTen };
  if (/^flux/.test(m)) return { path: '/video-gen/flux', aspectField: 'aspect_ratio', imageField: 'ref_images', duration: fiveOrTen };
  if (/^vela/.test(m)) return { path: '/video-gen/vela', aspectField: 'orientation', imageField: 'files', duration: fiveOrTen };
  if (/^(meta-ai|muse)/.test(m)) return { path: '/video-gen/meta', aspectField: 'orientation', imageField: 'image', duration: () => 10 };
  return {
    path: '/video-gen/veo',
    aspectField: 'aspect_ratio',
    imageField: 'ref_images',
    duration: (s) => (/veo-3\.1/.test(m) ? 8 : /omni/.test(m) ? (s > 8 ? 10 : 8) : 8),
  };
}

/** Vídeo Snapgen (Veo/Omni, Sora, Seedance, Kling, Minimax, Flux, Vela, Meta): multipart + polling. */
export async function snapgenVideo(p: ProviderConfig, model: string, prompt: string, o: {
  imagePath?: string; seconds: number; ratio: string; resolution?: string; dest: string; signal: AbortSignal;
  log?: (l: string) => void; pollMs?: number;
}): Promise<string> {
  if (!p.apiKey) throw new Error('Snapgen: sem chave de API');
  const spec = snapgenVideoSpec(model);
  const duration = spec.duration(o.seconds);
  const aspect = spec.path === '/video-gen/veo' && /veo-3\.1/i.test(model) ? '16:9'
    : spec.aspectField === 'orientation'
      ? (o.ratio === '9:16' ? 'portrait' : o.ratio === '1:1' ? 'square' : o.ratio === '4:5' ? 'portrait' : 'landscape')
      : o.ratio === '9:16' ? '9:16' : '16:9';

  const form = new FormData();
  form.append('prompt', prompt);
  form.append('model', model);
  form.append('duration', String(duration));
  form.append(spec.aspectField, aspect);
  form.append('resolution', o.resolution ?? '720p');
  if (o.imagePath && spec.imageField) {
    snapAppendFile(form, spec.imageField, o.imagePath);
    if (spec.imageField === 'ref_images') form.append('mode_image', 'frame');
  }

  const created = (await (await ok(await fetch(snapUrl(p, spec.path), {
    method: 'POST', headers: snapHeaders(p), body: form, signal: o.signal,
  }), 'snapgen-video')).json()) as any;
  const uuid = created?.uuid ?? created?.result?.uuid;
  if (!uuid) throw new Error('Snapgen: resposta de vídeo sem uuid de tarefa');
  const est = Number(created?.estimated_credit ?? 0);
  o.log?.(`Snapgen vídeo ${model}: tarefa ${uuid}${est ? ` · ${est} crédito(s) estimados` : ''}`);
  const done = await snapPoll(p, String(uuid), o.signal, o.log, o.pollMs);
  const item = (done?.generated_video ?? [])[0] ?? {};
  const url = snapMediaUrl(
    item.video_url ?? item.file_url ?? item.url ?? item.video_uri ?? item.download_url
    ?? item.generated_url ?? item.output_url ?? done?.generate_result ?? done?.result?.generate_result,
  );
  if (!url) throw new Error('Snapgen: vídeo concluído sem video_url');
  await snapDownload(url, o.dest, o.signal);
  const used = Number(done?.used_credit ?? done?.estimated_credit ?? created?.estimated_credit ?? 0);
  o.log?.(`Snapgen vídeo: ${used} crédito(s) usados`);
  return o.dest;
}

/** Testa credenciais/endereço sem gerar nada. `language` orienta a biblioteca de vozes (Fish). */
export async function testProvider(p: ProviderConfig, opts: { language?: string } = {}): Promise<{ ok: boolean; message: string; models?: string[]; modelCategories?: Record<string, ApiCategory>; credits?: SnapgenCredits; voices?: string[]; voiceLabels?: Record<string, string> }> {
  try {
    const sig = AbortSignal.timeout(30000);
    if (p.kind === 'fish') {
      if (!p.apiKey) return { ok: false, message: 'sem chave de API' };
      const { voices, voiceLabels, own } = await fishVoices(p, sig, opts.language);
      const models = p.models.length ? p.models : [...FISH_MODELS];
      const modelCategories = Object.fromEntries(models.map((m) => [m, 'voice' as ApiCategory]));
      const lib = voices.length - own;
      return {
        ok: true,
        message: voices.length
          ? `ok — ${voices.length} voz(es): ${own} da sua conta${lib > 0 ? ` + ${lib} da biblioteca` : ''}`
          : 'ok — nenhuma voz encontrada (crie/clone uma em fish.audio ou cole o id em Vozes)',
        models, modelCategories, voices, voiceLabels,
      };
    }
    if (p.kind === 'gemini') {
      if (!p.apiKey) return { ok: false, message: 'sem chave de API' };
      const j = (await (await ok(await fetch(`${base(p)}/models?key=${gkey(p)}`, { signal: sig }), 'gemini')).json()) as any;
      const models = (j.models ?? []).map((m: any) => String(m.name).replace(/^models\//, ''));
      return { ok: true, message: `ok — ${models.length} modelos`, models };
    }
    if (p.kind === 'seedance') {
      if (!p.apiKey) return { ok: false, message: 'sem chave de API' };
      await ok(await fetch(`${base(p)}/contents/generations/tasks?page_size=1`, { headers: headers(p), signal: sig }), 'seedance');
      return { ok: true, message: 'ok — credenciais aceitas' };
    }
    if (p.kind === 'snapgen') {
      if (!p.apiKey) return { ok: false, message: 'sem chave de API' };
      const credits = await snapgenAccount(p, sig);
      let models = p.models;
      let modelCategories: Record<string, ApiCategory> | undefined;
      try {
        const cat = await snapgenModels(p, sig);
        if (cat.models.length) { models = cat.models; modelCategories = cat.modelCategories; }
      } catch { /* mantém a lista configurada se o catálogo público falhar */ }
      const nImg = models.filter((m) => modelCategories?.[m] === 'image').length;
      const nVid = models.filter((m) => modelCategories?.[m] === 'video').length;
      return {
        ok: true,
        message: `ok — ${credits.available.toLocaleString('pt-BR')} crédito(s) disponíveis${credits.locked ? ` · ${credits.locked.toLocaleString('pt-BR')} bloqueado(s)` : ''}${nImg || nVid ? ` · ${nImg} imagem(ns) · ${nVid} vídeo(s)` : ''}`,
        credits,
        models,
        modelCategories,
      };
    }
    const j = (await (await ok(await fetch(`${base(p)}/models`, { headers: headers(p), signal: sig }), 'models')).json()) as any;
    const models = (j.data ?? []).map((m: any) => String(m.id));
    return { ok: true, message: `ok — ${models.length} modelos`, models };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
