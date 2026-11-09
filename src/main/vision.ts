import * as fs from 'node:fs';

/** Padrão; quem chama passa a Base URL configurada em Provedores → Ollama (porta/host diferentes). */
const OLLAMA_DEFAULT = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

async function visionModel(OLLAMA: string): Promise<string | undefined> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return undefined;
    const j = (await r.json()) as { models?: Array<{ name?: string }> };
    const names = (j.models ?? []).map((m) => m.name ?? '').filter(Boolean);
    return names.find((n) => /qwen3-vl|qwen2\.5-vl|qwen2-vl|llava|minicpm-v|moondream|vision/i.test(n));
  } catch { return undefined; }
}

/** Pergunta livre a um modelo de visão local (Ollama) sobre uma imagem; devolve o texto (ou undefined sem modelo). */
export async function describeImage(file: string, prompt: string, baseUrl?: string, log?: (l: string) => void): Promise<string | undefined> {
  const OLLAMA = (baseUrl || OLLAMA_DEFAULT).replace(/\/+$/, '');
  if (!fs.existsSync(file)) return undefined;
  const model = await visionModel(OLLAMA);
  if (!model) { log?.('visão: nenhum modelo de visão no Ollama (ex.: qwen3-vl:4b)'); return undefined; }
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, keep_alive: '2m', options: { temperature: 0.2, num_predict: 1500 },
        messages: [{ role: 'user', content: prompt, images: [fs.readFileSync(file).toString('base64')] }] }),
      signal: AbortSignal.timeout(240_000),
    });
    if (!r.ok) { log?.(`visão: HTTP ${r.status}`); return undefined; }
    const j = (await r.json()) as { message?: { content?: string; thinking?: string } };
    return (j.message?.content || j.message?.thinking || '').trim() || undefined;
  } catch (e) { log?.(`visão: ${(e as Error).message}`); return undefined; }
}

export interface VisionVerdict { model: string; match: number; hasText: boolean; raw: string }

/**
 * "Vê" um frame com um modelo de visão local (Ollama) e avalia:
 *  - match: 0-10, o quanto a imagem ilustra a narração (relação com o áudio);
 *  - hasText: legendas queimadas, marca d'água, logo ou texto grande.
 * Sem modelo de visão disponível, devolve undefined (o chamador segue sem checagem).
 */
export async function judgeFrame(frame: string, narration: string, log?: (l: string) => void, baseUrl?: string): Promise<VisionVerdict | undefined> {
  const OLLAMA = (baseUrl || OLLAMA_DEFAULT).replace(/\/+$/, '');
  if (!fs.existsSync(frame)) return undefined;
  const model = await visionModel(OLLAMA);
  if (!model) { log?.('visão: nenhum modelo de visão no Ollama (ex.: qwen3-vl:4b) — checagem ignorada'); return undefined; }
  const b64 = fs.readFileSync(frame).toString('base64');
  const prompt = `You are checking stock footage for a narrated video. Narration (audio): "${narration.slice(0, 500)}". ` +
    `Look at the image and answer ONLY JSON: {"match":0-10,"hasText":true/false}. ` +
    `match = how well this image illustrates the narration. ` +
    `hasText = true if there are burned-in subtitles, captions, a watermark, a logo or large overlaid text.`;
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, keep_alive: '2m', options: { temperature: 0, num_predict: 1200 },
        messages: [{ role: 'user', content: prompt, images: [b64] }] }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok) { log?.(`visão: HTTP ${r.status}`); return undefined; }
    const j = (await r.json()) as { message?: { content?: string; thinking?: string } };
    const content = (j.message?.content ?? '').trim();
    const thinking = (j.message?.thinking ?? '').trim();
    /* qwen3-vl "pensa" antes: o JSON pode vir no content (preferido) ou no fim do thinking */
    const source = /"match"\s*:/.test(content) ? content : thinking;
    const matches = [...source.matchAll(/"match"\s*:\s*(\d{1,2})/g)];
    const ht = /"hasText"\s*:\s*(true|false)/i.exec(source);
    if (!matches.length) { log?.(`visão: resposta inesperada (${(content || thinking).slice(0, 90)})`); return undefined; }
    const match = Number(matches[matches.length - 1]![1]);
    return { model, match: Math.max(0, Math.min(10, match)), hasText: ht ? ht[1]!.toLowerCase() === 'true' : /\b(watermark|subtitle|caption|logo)\b/i.test(source), raw: content || thinking };
  } catch (e) {
    log?.(`visão: ${(e as Error).message}`);
    return undefined;
  }
}
