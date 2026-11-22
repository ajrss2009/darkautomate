import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TelegramConfig } from '../shared/types';

/**
 * BOT DO TELEGRAM (menu lateral "Telegram"): o usuário conversa com o app pelo celular.
 *  - long polling (getUpdates) — não precisa de servidor, porta aberta nem webhook;
 *  - ALLOWLIST por chat: só chats aprovados na tela falam com o app; os demais ficam pendentes (com o nome) para aprovar;
 *  - comandos: /status, /projetos, /novo <ideia>, /lote (uma ideia por linha), /storyboard <id>, /aprovar <id>, /reprovar <id>;
 *  - texto livre vai ao ASSISTENTE com memória ("lembre que…", "esqueça…", perguntas sobre os projetos);
 *  - avisos: execução concluída/falha e storyboard para aprovar com botões ✅/❌ (a resposta destrava a execução).
 * O token do @BotFather é do usuário (cifrado no settings.json); o app nunca cria bot nem conta.
 */

export interface TgRow { id: string; name: string; status?: string; progress?: string }

export interface TelegramDeps {
  config: () => TelegramConfig | undefined;
  saveConfig: (c: TelegramConfig) => void;
  rows: () => Promise<TgRow[]>;
  createProject: (o: { name: string; idea: string; skillId?: string }) => { id: string; name: string };
  runProject: (id: string) => void;
  runBatch: (ids: string[]) => void;
  /** resposta a uma aprovação pendente; false = não havia execução esperando */
  approve: (id: string, ok: boolean) => boolean;
  storyboardPng: (id: string) => Promise<string | undefined>;
  assistant: (conv: string, text: string) => Promise<string>;
  log: (l: string) => void;
  /** só para teste */
  fetch?: typeof fetch;
}

type Update = { update_id: number; message?: { chat: { id: number; first_name?: string; title?: string; username?: string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } } };

/** "/novo@MeuBot ideia" → { cmd: 'novo', args: 'ideia' } (função pura). */
export function parseCommand(text: string): { cmd?: string; args: string } {
  const m = /^\/([a-zA-Z_]+)(?:@\w+)?\s*([\s\S]*)$/.exec(text.trim());
  return m ? { cmd: m[1]!.toLowerCase(), args: m[2]!.trim() } : { args: text.trim() };
}

/** Linhas do /lote → projetos: "ideia" ou "nome | ideia | skill" (função pura). */
export function batchLines(args: string): Array<{ name: string; idea: string; skillId?: string }> {
  return args.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter((l) => l.length > 3).slice(0, 30).map((l) => {
    const parts = l.split('|').map((x) => x.trim());
    if (parts.length >= 2) return { name: parts[0]!.slice(0, 80), idea: parts[1]!, skillId: parts[2] || undefined };
    return { name: l.slice(0, 60), idea: l };
  });
}

export class TelegramBot {
  private offset = 0;
  private stopped = true;
  private loop?: Promise<void>;
  constructor(private readonly d: TelegramDeps) {}

  get running() { return !this.stopped; }
  private get f() { return this.d.fetch ?? fetch; }
  private get cfg() { return this.d.config(); }

  private async api<T>(method: string, body?: Record<string, unknown> | FormData, timeoutMs = 40_000): Promise<T> {
    const tok = this.cfg?.token?.trim();
    if (!tok) throw new Error('Telegram sem token (cole o token do @BotFather no menu Telegram)');
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const r = await this.f(`https://api.telegram.org/bot${tok}/${method}`, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body as FormData : JSON.stringify(body ?? {}),
    });
    const j = await r.json() as { ok: boolean; result?: T; description?: string };
    if (!j.ok) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
    return j.result as T;
  }

  async send(chatId: number, text: string, buttons?: Array<Array<{ text: string; data: string }>>) {
    /* limite do Telegram: 4096 caracteres por mensagem */
    for (let i = 0; i < text.length || i === 0; i += 4000) {
      await this.api('sendMessage', { chat_id: chatId, text: text.slice(i, i + 4000) || '…', disable_web_page_preview: true,
        reply_markup: buttons && i + 4000 >= text.length ? { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } : undefined });
      if (text.length <= 4000) break;
    }
  }

  async sendPhoto(chatId: number, file: string, caption: string, buttons?: Array<Array<{ text: string; data: string }>>) {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    fd.append('caption', caption.slice(0, 1000));
    if (buttons) fd.append('reply_markup', JSON.stringify({ inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) }));
    fd.append(/\.(png|jpe?g|webp)$/i.test(file) && fs.statSync(file).size < 9_500_000 ? 'photo' : 'document', new Blob([fs.readFileSync(file)]), path.basename(file));
    await this.api(/\.(png|jpe?g|webp)$/i.test(file) && fs.statSync(file).size < 9_500_000 ? 'sendPhoto' : 'sendDocument', fd, 120_000);
  }

  /** Para todos os chats autorizados. */
  async broadcast(text: string, buttons?: Array<Array<{ text: string; data: string }>>) {
    for (const id of this.cfg?.allowChats ?? []) { try { await this.send(id, text, buttons); } catch (e) { this.d.log(`Telegram: aviso para ${id} falhou (${(e as Error).message})`); } }
  }

  start() {
    if (!this.stopped || !this.cfg?.enabled || !this.cfg.token) return;
    this.stopped = false;
    this.d.log('Telegram: bot ligado (long polling)');
    this.loop = (async () => {
      let backoff = 1000;
      while (!this.stopped) {
        try {
          const ups = await this.api<Update[]>('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35_000);
          backoff = 1000;
          for (const u of ups) { this.offset = u.update_id + 1; await this.handle(u).catch((e) => this.d.log(`Telegram: erro ao tratar mensagem (${(e as Error).message})`)); }
        } catch (e) {
          if (this.stopped) break;
          this.d.log(`Telegram: ${(e as Error).message} — tentando de novo em ${Math.round(backoff / 1000)} s`);
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(60_000, backoff * 2);
        }
      }
    })();
  }

  async stop() { this.stopped = true; try { await this.loop; } catch { /* encerrando */ } this.d.log('Telegram: bot desligado'); }

  /** Trata UMA atualização (exposto para teste). */
  async handle(u: Update) {
    const cfg = this.cfg;
    if (!cfg) return;
    if (u.callback_query) {
      const cq = u.callback_query, chatId = cq.message?.chat.id;
      if (!chatId || !cfg.allowChats.includes(chatId)) return;
      const m = /^(ok|no):(.+)$/.exec(cq.data ?? '');
      let answer = 'ok';
      if (m) {
        const live = this.d.approve(m[2]!, m[1] === 'ok');
        answer = live ? (m[1] === 'ok' ? '✅ aprovado — a execução continua' : '❌ reprovado') : 'nenhuma execução esperando esta aprovação';
      }
      try { await this.api('answerCallbackQuery', { callback_query_id: cq.id, text: answer }); } catch { /* opcional */ }
      try { await this.api('editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message!.message_id, reply_markup: { inline_keyboard: [] } }); } catch { /* opcional */ }
      await this.send(chatId, answer);
      return;
    }
    const msg = u.message;
    if (!msg?.text) return;
    const chatId = msg.chat.id;
    const who = msg.chat.title ?? msg.chat.first_name ?? msg.chat.username ?? String(chatId);
    /* ALLOWLIST: chat desconhecido não comanda nada — fica pendente para o usuário aprovar na tela */
    if (!cfg.allowChats.includes(chatId)) {
      const pending = (cfg.pending ?? []).filter((p) => p.chatId !== chatId);
      this.d.saveConfig({ ...cfg, pending: [...pending, { chatId, name: who, at: new Date().toISOString() }].slice(-20) });
      await this.send(chatId, `Olá! Este chat (${chatId}) ainda não está autorizado. Abra o Dark Automate → menu Telegram e aprove "${who}".`);
      this.d.log(`Telegram: pedido de acesso de "${who}" (${chatId})`);
      return;
    }
    const { cmd, args } = parseCommand(msg.text);
    switch (cmd) {
      case 'start': case 'ajuda': case 'help':
        return this.send(chatId, [
          'Dark Automate no Telegram 🎬', '',
          '/status — o que está rodando agora', '/projetos — últimos projetos',
          '/novo <ideia> — cria e roda um projeto', '/lote — uma ideia por linha (ou "nome | ideia | skill")',
          '/storyboard <id> — envia o storyboard', '/aprovar <id> · /reprovar <id> — responde a aprovação',
          '', 'Ou converse comigo: "lembre que…", "esqueça…", "como está o projeto X?"',
        ].join('\n'));
      case 'status': {
        const rows = (await this.d.rows()).filter((r) => r.status === 'running');
        return this.send(chatId, rows.length ? rows.map((r) => `▶ ${r.name} (${r.id})${r.progress ? ` — ${r.progress}` : ''}`).join('\n') : 'Nada rodando agora.');
      }
      case 'projetos': {
        const rows = (await this.d.rows()).slice(0, 12);
        return this.send(chatId, rows.length ? rows.map((r) => `• ${r.name} — ${r.status ?? 'novo'}${r.progress ? ` (${r.progress})` : ''}\n  ${r.id}`).join('\n') : 'Nenhum projeto ainda.');
      }
      case 'novo': {
        if (!args) return this.send(chatId, 'Use: /novo <ideia do vídeo>');
        const p = this.d.createProject({ name: args.slice(0, 60), idea: args, skillId: cfg.defaultSkill });
        this.d.runProject(p.id);
        return this.send(chatId, `🎬 Projeto criado e em produção: ${p.name}\n${p.id}\nAviso quando terminar.`);
      }
      case 'lote': {
        const items = batchLines(args);
        if (!items.length) return this.send(chatId, 'Use: /lote e, nas linhas seguintes, uma ideia por linha (ou "nome | ideia | skill").');
        const made = items.map((it) => this.d.createProject({ ...it, skillId: it.skillId ?? cfg.defaultSkill }));
        this.d.runBatch(made.map((p) => p.id));
        return this.send(chatId, `📦 Lote com ${made.length} projeto(s) na fila:\n${made.map((p) => `• ${p.name}`).join('\n')}`);
      }
      case 'storyboard': {
        const id = args.split(/\s+/)[0];
        if (!id) return this.send(chatId, 'Use: /storyboard <id do projeto>');
        const f = await this.d.storyboardPng(id).catch(() => undefined);
        return f ? this.sendPhoto(chatId, f, `Storyboard — ${id}`, [[{ text: '✅ Aprovar', data: `ok:${id}` }, { text: '❌ Reprovar', data: `no:${id}` }]])
          : this.send(chatId, `Sem storyboard para ${id} (o plano de cenas já foi feito?).`);
      }
      case 'aprovar': case 'reprovar': {
        const id = args.split(/\s+/)[0];
        if (!id) return this.send(chatId, `Use: /${cmd} <id do projeto>`);
        return this.send(chatId, this.d.approve(id, cmd === 'aprovar') ? (cmd === 'aprovar' ? '✅ aprovado — a execução continua' : '❌ reprovado') : 'Nenhuma execução esperando aprovação neste projeto.');
      }
      default: {
        if (cmd) return this.send(chatId, `Não conheço /${cmd}. Mande /ajuda.`);
        const reply = await this.d.assistant(`telegram-${chatId}`, args);
        return this.send(chatId, reply);
      }
    }
  }

  /** Aviso de execução concluída ou falha. */
  async notifyRun(o: { id: string; name: string; ok: boolean; error?: string; thumbnail?: string }) {
    if (!this.running || !this.cfg?.notify) return;
    const text = o.ok ? `✅ Pronto: ${o.name}\n${o.id}` : `⚠️ Falhou: ${o.name}\n${o.id}\n${(o.error ?? '').slice(0, 300)}`;
    if (o.ok && o.thumbnail && fs.existsSync(o.thumbnail)) {
      for (const id of this.cfg.allowChats) { try { await this.sendPhoto(id, o.thumbnail, text); } catch (e) { this.d.log(`Telegram: aviso falhou (${(e as Error).message})`); } }
    } else await this.broadcast(text);
  }

  /** Storyboard esperando aprovação: imagem com ✅/❌ (a resposta chama deps.approve). */
  async askApproval(o: { id: string; name: string; stepId: string; png?: string }) {
    if (!this.running || !this.cfg?.approveStoryboards) return;
    const buttons = [[{ text: '✅ Aprovar', data: `ok:${o.id}` }, { text: '❌ Reprovar', data: `no:${o.id}` }]];
    const caption = `⏸ ${o.name} espera sua aprovação (${o.stepId}).`;
    for (const id of this.cfg.allowChats) {
      try { if (o.png && fs.existsSync(o.png)) await this.sendPhoto(id, o.png, caption, buttons); else await this.send(id, caption, buttons); }
      catch (e) { this.d.log(`Telegram: pedido de aprovação falhou (${(e as Error).message})`); }
    }
  }
}
