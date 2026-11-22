import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Settings } from '../shared/types';
import { resolveHarness, runHarness } from './harness';
import { recordQuiet } from './db';

/**
 * ASSISTENTE COM MEMÓRIA: conversa com o usuário (na aba Telegram do app e pelo bot do Telegram), lembra do que
 * ele pede para lembrar e conhece o estado dos projetos. A memória é PORTÁTIL: arquivos JSON em
 * workspace/assistant/memory (mesmo formato do sistema de memória: user | feedback | project | reference),
 * espelhados no banco (record kind "assistant_memory"). O histórico curto de cada conversa fica em
 * workspace/assistant/history/<conversa>.json para o assistente manter o contexto entre mensagens.
 */

export interface AssistantMemory {
  name: string; description: string; content: string;
  metadata: { type: 'user' | 'feedback' | 'project' | 'reference' };
  timestamp: string; tags?: string[];
}
export interface ChatTurn { role: 'user' | 'assistant'; text: string; at: string }

const dirOf = (s: Settings, sub: 'memory' | 'history') => path.join(s.workspace, 'assistant', sub);
const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'nota';

export function listMemories(s: Settings): AssistantMemory[] {
  const d = dirOf(s, 'memory');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try { return [JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) as AssistantMemory]; } catch { return []; }
  }).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function saveMemory(s: Settings, o: { content: string; type?: AssistantMemory['metadata']['type']; description?: string; name?: string }): AssistantMemory {
  const content = o.content.trim();
  if (!content) throw new Error('nada para lembrar');
  const m: AssistantMemory = {
    name: o.name ? slug(o.name) : slug(content.slice(0, 40)),
    description: (o.description ?? content).replace(/\s+/g, ' ').slice(0, 140),
    content, metadata: { type: o.type ?? 'user' }, timestamp: new Date().toISOString(),
  };
  const d = dirOf(s, 'memory');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${m.name}.json`), JSON.stringify(m, null, 2));
  recordQuiet('assistant_memory', m.name, { title: m.description, data: m });
  return m;
}

export function forgetMemory(s: Settings, name: string): boolean {
  const f = path.join(dirOf(s, 'memory'), `${slug(name)}.json`);
  if (!fs.existsSync(f)) return false;
  fs.rmSync(f, { force: true });
  recordQuiet('assistant_memory', slug(name), null);
  return true;
}

export function readHistory(s: Settings, conv: string, max = 12): ChatTurn[] {
  try { return (JSON.parse(fs.readFileSync(path.join(dirOf(s, 'history'), `${slug(conv)}.json`), 'utf8')) as ChatTurn[]).slice(-max); } catch { return []; }
}
function appendHistory(s: Settings, conv: string, turns: ChatTurn[]) {
  const d = dirOf(s, 'history');
  fs.mkdirSync(d, { recursive: true });
  const all = [...readHistory(s, conv, 200), ...turns].slice(-200);
  fs.writeFileSync(path.join(d, `${slug(conv)}.json`), JSON.stringify(all, null, 1));
}

/** "lembre que eu prefiro vídeos de 60 s" → memória; devolve o texto a guardar (função pura). */
export function rememberIntent(text: string): string | undefined {
  const m = /^\s*(?:por favor,?\s*)?(?:lembre(?:-se)?|lembra|anote|memorize|guarde|grave)\s*(?:que|de|:)?\s*(.+)$/is.exec(text);
  return m?.[1]?.trim() || undefined;
}
/** "esqueça X" → nome da memória a apagar (função pura). */
export function forgetIntent(text: string): string | undefined {
  return /^\s*(?:esque[cç]a|apague a mem[oó]ria|forget)\s+(.+)$/i.exec(text)?.[1]?.trim() || undefined;
}

export interface AssistantContext {
  /** resumo dos projetos (nome, status, progresso) para o assistente responder sobre eles */
  projects: string;
}

/** Pedido ao modelo: papel, memórias, estado dos projetos, histórico e a mensagem. Função pura. */
export function assistantPrompt(memories: AssistantMemory[], ctx: AssistantContext, history: ChatTurn[], text: string): string {
  return [
    'Você é o assistente do Dark Automate (estúdio de vídeo por IA). Responda em português do Brasil, curto e direto, como numa conversa de chat.',
    'Você conhece os projetos do usuário (lista abaixo) e o que ele pediu para você lembrar (memórias). Use as memórias como preferências dele.',
    'Você NÃO executa ações sozinho: quando o usuário quiser criar ou rodar projetos, diga o comando certo:',
    '/novo <ideia> (cria e roda 1 projeto) · /lote (uma ideia por linha) · /status · /projetos · /storyboard <id> · lembre que <algo> · esqueça <nome>.',
    'Nunca invente status, números ou arquivos: use só o que está abaixo.',
    '',
    `## Memórias (${memories.length})`,
    ...(memories.length ? memories.slice(0, 30).map((m) => `- [${m.metadata.type}] ${m.name}: ${m.content.slice(0, 300)}`) : ['(nenhuma ainda)']),
    '',
    '## Projetos',
    ctx.projects || '(nenhum)',
    '',
    '## Conversa recente',
    ...(history.length ? history.map((h) => `${h.role === 'user' ? 'Usuário' : 'Assistente'}: ${h.text.slice(0, 600)}`) : ['(início)']),
    '',
    `Usuário: ${text}`,
    'Assistente:',
  ].join('\n');
}

/**
 * Responde uma mensagem: "lembre…"/"esqueça…" mexem na memória sem gastar modelo; o resto vai ao harness do
 * assistente (padrão: antigravity) com memórias + projetos + histórico. O par pergunta/resposta entra no histórico.
 */
export async function assistantReply(s: Settings, conv: string, text: string, ctx: AssistantContext, signal?: AbortSignal): Promise<string> {
  const at = new Date().toISOString();
  let reply: string;
  const rem = rememberIntent(text), fgt = forgetIntent(text);
  if (rem) { const m = saveMemory(s, { content: rem }); reply = `Anotado (memória "${m.name}").`; }
  else if (fgt) reply = forgetMemory(s, fgt) ? `Esqueci "${fgt}".` : `Não achei a memória "${fgt}". Diga "memórias" para ver a lista.`;
  else if (/^\s*(mem[oó]rias|o que voc[eê] lembra)\??\s*$/i.test(text)) {
    const ms = listMemories(s);
    reply = ms.length ? ms.slice(0, 20).map((m) => `• ${m.name}: ${m.content.slice(0, 120)}`).join('\n') : 'Ainda não tenho memórias. Diga "lembre que …".';
  } else {
    const cfg = s.telegram?.assistant;
    const { cfg: hc, model } = await resolveHarness(s, { type: 'harness', harness: (cfg?.harness ?? 'antigravity') as never, model: cfg?.model });
    const dir = path.join(s.workspace, 'assistant');
    fs.mkdirSync(dir, { recursive: true });
    const r = await runHarness(hc, { cwd: dir, prompt: assistantPrompt(listMemories(s), ctx, readHistory(s, conv), text), model, signal: signal ?? new AbortController().signal, timeoutSec: 180 });
    reply = (r.stdout || '').replace(/\r/g, '').split('\n').filter((l) => !/^\s*\[stderr\]|^>\s*build|^\s*$/.test(l)).join('\n').trim().slice(0, 3500)
      || `Não consegui responder agora${r.stderr ? ` (${r.stderr.trim().split('\n').pop()?.slice(0, 120)})` : ''}.`;
  }
  appendHistory(s, conv, [{ role: 'user', text, at }, { role: 'assistant', text: reply, at: new Date().toISOString() }]);
  return reply;
}
