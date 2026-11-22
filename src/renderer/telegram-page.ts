/* Aba TELEGRAM: bot (token, chats autorizados, avisos, aprovação de storyboard), assistente com memória e a conversa
   com o app pela própria tela. O bot e esta tela usam a MESMA memória (workspace/assistant). */

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
type Api = Record<string, (...a: any[]) => Promise<any>>;
export interface TelegramCtx { forge: Api; toast: (m: string, bad?: boolean) => void; main: HTMLElement }

interface TgState {
  enabled: boolean; token: string; hasToken: boolean; running: boolean; allowChats: number[];
  pending?: Array<{ chatId: number; name: string; at: string }>; notify: boolean; approveStoryboards: boolean;
  defaultSkill?: string; assistant?: { harness?: string; model?: string };
}
interface Mem { name: string; content: string; metadata: { type: string }; timestamp: string }
interface Turn { role: 'user' | 'assistant'; text: string; at: string }

export async function renderTelegramPage(c: TelegramCtx): Promise<void> {
  const guard = async <T>(fn: () => Promise<T>) => { try { return await fn(); } catch (e) { c.toast((e as Error).message, true); return undefined; } };
  const [st, mems, hist, skills] = await Promise.all([
    c.forge['telegramGet']() as Promise<TgState>, c.forge['assistantMemories']() as Promise<Mem[]>,
    c.forge['assistantHistory']() as Promise<Turn[]>, (c.forge['listSkills']() as Promise<Array<{ id: string; name: string }>>).catch(() => []),
  ]);
  const again = () => void renderTelegramPage(c);

  /* ── bot ── */
  const token = h('input', { type: 'password', class: 'grow', id: 'tg-token', placeholder: 'Token do @BotFather (123456:ABC…)', value: st.token }) as HTMLInputElement;
  const chk = (id: string, on: boolean, label: string) => {
    const i = h('input', { type: 'checkbox', id }) as HTMLInputElement; i.checked = on;
    return { i, el: h('label', { class: 'row' }, i, label) };
  };
  const en = chk('tg-enabled', st.enabled, 'Ligado (o app conversa com o Telegram enquanto estiver aberto)');
  const nt = chk('tg-notify', st.notify, 'Avisar quando um projeto terminar ou falhar (com a thumbnail)');
  const ap = chk('tg-approve', st.approveStoryboards, 'Mandar o storyboard para aprovar quando a execução pedir aceitação');
  const skill = h('select', { id: 'tg-skill' }, h('option', { value: '' }, 'Vídeo livre (padrão)'),
    ...skills.map((k) => { const o = h('option', { value: k.id }, k.name); if (k.id === st.defaultSkill) o.selected = true; return o; })) as HTMLSelectElement;
  const harness = h('input', { id: 'tg-harness', placeholder: 'antigravity', value: st.assistant?.harness ?? '' }) as HTMLInputElement;
  const model = h('input', { id: 'tg-model', placeholder: 'modelo (opcional)', value: st.assistant?.model ?? '' }) as HTMLInputElement;
  const save = () => void guard(async () => {
    const r = await c.forge['telegramSet']({ enabled: en.i.checked, notify: nt.i.checked, approveStoryboards: ap.i.checked, token: token.value,
      defaultSkill: skill.value, assistant: { harness: harness.value.trim(), model: model.value.trim() } }) as { running: boolean };
    c.toast(r.running ? 'Bot ligado' : 'Salvo'); again();
  });

  const pending = (st.pending ?? []).map((p) => h('div', { class: 'row', 'data-chat': String(p.chatId) },
    h('span', { class: 'grow' }, `💬 ${p.name} (${p.chatId}) — pediu acesso em ${new Date(p.at).toLocaleString('pt-BR')}`),
    h('button', { class: 'primary', onclick: () => void guard(async () => { await c.forge['telegramAllow'](p.chatId, true); again(); }) }, 'Autorizar'),
    h('button', { onclick: () => void guard(async () => { await c.forge['telegramAllow'](p.chatId, false); again(); }) }, 'Recusar')));
  const allowed = st.allowChats.map((id) => h('span', { class: 'chip ok' }, `✓ ${id} `,
    h('button', { class: 'link', title: 'Remover', onclick: () => void guard(async () => { await c.forge['telegramAllow'](id, false); again(); }) }, '×')));

  const botCard = h('div', { class: 'card ssec' },
    h('div', { class: 'row' }, h('span', { class: 'sicon' }, st.running ? '🟢' : '⚪'), h('div', { class: 'grow' }, h('strong', {}, 'Bot do Telegram'),
      h('div', { class: 'muted' }, st.running ? 'Conectado: mande /ajuda para o bot.' : 'Crie um bot no @BotFather, cole o token, marque "Ligado" e salve. Depois mande /start para o bot: o seu chat aparece aqui para autorizar.'))),
    h('div', { class: 'row' }, token), en.el, nt.el, ap.el,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Skill do /novo e /lote:'), skill),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Assistente:'), harness, model),
    h('div', { class: 'row' }, h('button', { class: 'primary', id: 'tg-save', onclick: save }, 'Salvar'),
      h('button', { id: 'tg-test', onclick: () => void guard(async () => { const r = await c.forge['telegramTest']() as { sent: number }; c.toast(`Mensagem de teste enviada para ${r.sent} chat(s)`); }) }, 'Enviar teste')),
    pending.length ? h('div', {}, h('strong', {}, 'Pedidos de acesso'), ...pending) : null,
    h('div', { class: 'pchips' }, h('span', { class: 'muted' }, 'Chats autorizados: '), ...(allowed.length ? allowed : [h('span', { class: 'muted' }, 'nenhum')])),
    h('details', {}, h('summary', {}, 'Comandos do bot'),
      h('pre', {}, ['/status — o que está rodando', '/projetos — últimos projetos', '/novo <ideia> — cria e roda um projeto', '/lote — uma ideia por linha (cria e roda em lote)',
        '/storyboard <id> — manda o storyboard', '/aprovar <id> · /reprovar <id> — responde a aprovação pendente', 'lembre que … · esqueça … · memórias', 'qualquer outra mensagem — conversa com o assistente'].join('\n'))));

  /* ── conversa local ── */
  const log = h('div', { class: 'tg-chat', id: 'tg-chat' });
  const bubble = (t: Turn) => h('div', { class: `tg-msg ${t.role}` }, t.text);
  for (const t of hist) log.append(bubble(t));
  const input = h('textarea', { id: 'tg-input', rows: '2', class: 'grow', placeholder: 'Pergunte sobre os projetos ou diga "lembre que …"' }) as HTMLTextAreaElement;
  const sendBtn = h('button', { class: 'primary', id: 'tg-send' }, 'Enviar') as HTMLButtonElement;
  const sendMsg = () => void guard(async () => {
    const text = input.value.trim(); if (!text) return;
    input.value = ''; sendBtn.disabled = true;
    log.append(bubble({ role: 'user', text, at: '' }));
    const wait = bubble({ role: 'assistant', text: '…', at: '' }); log.append(wait); log.scrollTop = log.scrollHeight;
    try { wait.textContent = (await c.forge['assistantChat'](text)) as string; } finally { sendBtn.disabled = false; log.scrollTop = log.scrollHeight; }
    if (/^\s*(lembre|lembra|anote|memorize|guarde|grave|esque)/i.test(text)) again();
  });
  sendBtn.addEventListener('click', sendMsg);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
  const chatCard = h('div', { class: 'card ssec' }, h('strong', {}, '🤖 Assistente'), log, h('div', { class: 'row' }, input, sendBtn));

  /* ── memória ── */
  const memIn = h('input', { class: 'grow', id: 'tg-mem', placeholder: 'Algo para o assistente lembrar (ex.: prefiro vídeos de 60 s)' }) as HTMLInputElement;
  const memCard = h('div', { class: 'card ssec' }, h('strong', {}, `🧠 Memória (${mems.length})`),
    h('div', { class: 'row' }, memIn, h('button', { onclick: () => void guard(async () => { if (!memIn.value.trim()) return; await c.forge['assistantRemember'](memIn.value); again(); }) }, 'Lembrar')),
    ...mems.map((m) => h('div', { class: 'row', 'data-mem': m.name }, h('span', { class: 'chip' }, m.metadata.type), h('span', { class: 'grow' }, m.content),
      h('button', { title: 'Esquecer', onclick: () => void guard(async () => { await c.forge['assistantForget'](m.name); again(); }) }, '🗑'))));

  c.main.replaceChildren(h('h2', {}, 'Telegram e assistente'), botCard, chatCard, memCard);
  log.scrollTop = log.scrollHeight;
}
