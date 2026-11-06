import type { GoogleAccount, Project } from '../shared/types';
import { helpButton } from './carousel';
import { askConfirm, showMessage } from './dialogs';

/* Aba AUTOMAÇÕES: contas Google (até 10), Flow no navegador da conta, Antigravity por conta e SRT de um áudio. */

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
type Api = Record<string, (...a: any[]) => Promise<any>> & { mediaUrl: (p: string) => string };
export interface AutoCtx { forge: Api; toast: (m: string, bad?: boolean) => void; main: HTMLElement }

type Account = GoogleAccount & { dir: string; hasProfile: boolean; downloads: number; hasAgy: boolean; running: boolean };
interface State {
  config: { browserPath?: string; extensionDir?: string; flowUrl?: string; agyAccount?: string; youtubeAccount?: string };
  accounts: Account[]; browser: { path?: string; kind: string; extensions: boolean; note: string }; max: number; flowUrl: string;
}
interface Dl { file: string; name: string; size: number; at: string; kind: 'video' | 'image' | 'audio' | 'other' }

let flowAccount = '';
let autoTab: 'accounts' | 'flow' | 'srt' | 'usage' = 'accounts';
const COLORS = ['#7c5cff', '#3ecf8e', '#f5b84b', '#ff6b6b', '#4aa3ff', '#ff8fd1', '#9ad14b', '#ffa94d', '#5ce1e6', '#c084fc'];

export async function renderAutomations(c: AutoCtx) {
  const st = (await c.forge['autoGet']()) as State;
  const again = () => void renderAutomations(c);
  const guard = async <T>(fn: () => Promise<T>) => { try { return await fn(); } catch (e) { c.toast((e as Error).message, true); return undefined; } };
  if (!flowAccount || !st.accounts.some((a) => a.id === flowAccount)) flowAccount = st.accounts[0]?.id ?? '';
  const avatar = (a: Account, i: number) => { const s = h('span', { class: 'avatar' }, (a.label || a.id).slice(0, 1).toUpperCase()); s.style.background = COLORS[i % COLORS.length]!; return s; };

  const tabs = h('div', { class: 'seg big' }, ...([['accounts', '👤 Contas Google'], ['usage', '📊 Uso dos provedores'], ['flow', '🌊 Flow'], ['srt', '💬 SRT de um áudio']] as Array<[typeof autoTab, string]>).map(([v, l]) =>
    h('button', { class: autoTab === v ? 'on' : '', 'data-autotab': v, onclick: () => { autoTab = v; again(); } }, l)));

  /* ── navegador ── */
  const browserCard = () => {
    const ext = h('input', { value: st.config.extensionDir ?? '', placeholder: 'Pasta da extensão descompactada (opcional)', class: 'grow', id: 'auto-ext' }) as HTMLInputElement;
    return h('div', { class: 'card ssec' },
      h('div', { class: 'row' }, h('span', { class: 'sicon' }, st.browser.path ? '🧭' : '⚠️'), h('div', { class: 'grow' }, h('strong', {}, 'Navegador das contas'),
        h('div', { class: 'muted' }, st.browser.path ? `${st.browser.path} — ${st.browser.note}` : st.browser.note)),
        h('button', { onclick: () => void guard(async () => {
          const f = (await c.forge['openFile']({ title: 'Navegador Chromium (chrome.exe)', filters: [{ name: 'Executável', extensions: ['exe'] }] })) as string | null;
          if (f) { await c.forge['autoSetConfig']({ browserPath: f }); again(); }
        }) }, 'Escolher navegador…'),
        st.config.browserPath ? h('button', { onclick: () => void guard(async () => { await c.forge['autoSetConfig']({ browserPath: '' }); again(); }) }, 'Detectar automático') : null),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, '🧩 Extensão:'), ext,
        h('button', { onclick: () => void guard(async () => {
          const d = (await c.forge['openDir']({ title: 'Pasta da extensão (com manifest.json)' })) as string | null;
          if (d) { await c.forge['autoSetConfig']({ extensionDir: d }); again(); }
        }) }, 'Escolher pasta…'),
        h('button', { onclick: () => void guard(async () => { await c.forge['autoSetConfig']({ extensionDir: ext.value }); c.toast('Extensão salva'); again(); }) }, 'Salvar')),
      !st.browser.extensions && st.config.extensionDir ? h('div', { class: 'tag running' }, '⚠ Este navegador não carrega extensões por pasta: instale a extensão pela loja dentro do navegador da conta (fica salva no perfil).') : null);
  };

  /* ── contas ── */
  const accountsView = () => {
    const name = h('input', { placeholder: 'Nome (ex.: Canal principal)', id: 'auto-acc-name' }) as HTMLInputElement;
    const email = h('input', { placeholder: 'e-mail (opcional, só para identificar)', id: 'auto-acc-email' }) as HTMLInputElement;
    const card = (a: Account, i: number) => {
      const isAgy = st.config.agyAccount === a.id;
      const lbl = h('input', { value: a.label, class: 'grow', 'data-field': 'acc-label' }) as HTMLInputElement;
      const em = h('input', { value: a.email ?? '', placeholder: 'e-mail', 'data-field': 'acc-email' }) as HTMLInputElement;
      const saveInfo = () => void guard(async () => { await c.forge['autoAccountUpdate'](a.id, { label: lbl.value, email: em.value }); });
      lbl.addEventListener('change', saveInfo); em.addEventListener('change', saveInfo);
      return h('div', { class: `card acccard${isAgy ? ' agy' : ''}`, 'data-account': a.id },
        h('div', { class: 'row' }, avatar(a, i), h('div', { class: 'grow' }, lbl, em),
          h('div', { class: 'pchips' },
            h('span', { class: `chip${a.hasProfile ? ' ok' : ''}` }, a.hasProfile ? '🟢 perfil criado' : '⚪ sem login ainda'),
            a.running ? h('span', { class: 'chip ok' }, '🌐 aberto') : null,
            h('span', { class: 'chip' }, `📥 ${a.downloads}`),
            a.credits ? h('span', { class: 'chip', title: `${a.credits.text} — lido em ${new Date(a.credits.at).toLocaleString('pt-BR')}` }, `💳 ${a.credits.value ?? a.credits.text}`) : null,
            isAgy ? h('span', { class: 'chip ok' }, '🪐 usada no Antigravity') : null,
            st.config.youtubeAccount === a.id ? h('span', { class: 'chip ok' }, '▶️ envia ao YouTube') : null)),
        h('div', { class: 'acts' },
          h('button', { 'data-act': 'acc-login', title: 'Abre o navegador desta conta na página de login do Google — você digita a senha lá', onclick: () => void guard(async () => { await c.forge['autoOpen'](a.id, 'login'); c.toast(`Navegador de "${a.label}" aberto: faça o login na página do Google`); window.setTimeout(again, 1200); }) }, '🔐 Entrar no Google'),
          h('button', { class: 'primary', 'data-act': 'acc-flow', onclick: () => void guard(async () => { await c.forge['autoOpen'](a.id, 'flow'); flowAccount = a.id; c.toast(`Flow aberto com "${a.label}"`); window.setTimeout(again, 1200); }) }, '🌊 Abrir Flow'),
          h('button', { 'data-act': 'acc-agy', title: 'Abre um terminal com o Antigravity CLI na sessão desta conta; o agy conduz o login', onclick: () => void guard(async () => { await c.forge['autoAgyLogin'](a.id); c.toast('Terminal do Antigravity aberto: conclua o login com esta conta'); }) }, '🪐 Login no Antigravity'),
          h('button', { 'data-act': 'acc-agy-use', title: 'As rotas passam a usar a sessão do Antigravity desta conta', onclick: () => void guard(async () => { await c.forge['autoAgyUse'](isAgy ? '' : a.id); again(); }) }, isAgy ? '↩ Voltar à sessão do Windows' : '✔ Usar no Antigravity'),
          h('button', { 'data-act': 'acc-credits', title: 'Lê os créditos mostrados no Flow (não gera nada)', onclick: () => void guard(async () => { c.toast(`Lendo os créditos de "${a.label}"…`); const r = (await c.forge['autoFlowCredits'](a.id)) as Array<{ value?: number; text: string; error?: string }>; c.toast(r[0]?.error ? `Créditos: ${r[0].error}` : `Créditos de "${a.label}": ${r[0]?.value ?? r[0]?.text}`, !!r[0]?.error); again(); }) }, '💳 Créditos'),
          h('button', { 'data-act': 'acc-yt-use', title: 'Os envios ao YouTube (botão do editor e upload automático das rotas) usam esta conta', onclick: () => void guard(async () => { await c.forge['autoYoutubeUse'](st.config.youtubeAccount === a.id ? '' : a.id); again(); }) }, st.config.youtubeAccount === a.id ? '↩ Não usar no YouTube' : '▶️ Usar no YouTube'),
          h('button', { onclick: () => void c.forge['autoOpenFolder'](a.id) }, '📂 Pasta'),
          h('button', { class: 'danger', 'data-act': 'acc-remove', onclick: () => void guard(async () => {
            if (!await askConfirm(`Tirar "${a.label}" da lista? A pasta da conta (perfil do navegador e downloads) continua no disco.`)) return;
            const r = (await c.forge['autoAccountRemove'](a.id)) as { keptDir: string }; c.toast(`Conta removida da lista. Pasta mantida: ${r.keptDir}`); again();
          }) }, 'Remover')));
    };
    return [browserCard(),
      h('div', { class: 'card ssec' },
        h('div', { class: 'row' }, h('span', { class: 'sicon' }, '👤'), h('div', { class: 'grow' }, h('strong', {}, `Contas Google (${st.accounts.length}/${st.max})`),
          h('div', { class: 'muted' }, 'Cada conta tem um navegador próprio. O login é feito por você na página do Google — o app não vê nem guarda senhas.')),
          st.accounts.length ? h('button', { id: 'auto-credits-all', title: 'Abre o Flow de cada conta, lê os créditos e fecha', onclick: () => void guard(async () => {
            c.toast('Lendo os créditos de todas as contas…');
            const r = (await c.forge['autoFlowCredits']()) as Array<{ label: string; value?: number; text: string; error?: string }>;
            const total = r.reduce((s, x) => s + (x.value ?? 0), 0);
            c.toast(`Créditos: ${r.map((x) => `${x.label}: ${x.error ? '⚠' : x.value ?? x.text}`).join(' · ')}${total ? ` — total ${total}` : ''}`); again();
          }) }, '💳 Créditos de todas') : null),
        st.accounts.length < st.max ? h('div', { class: 'row' }, name, email, h('button', { class: 'primary', id: 'auto-acc-add', onclick: () => void guard(async () => {
          await c.forge['autoAccountAdd'](name.value || `Conta ${st.accounts.length + 1}`, email.value); c.toast('Conta adicionada: clique em "Entrar no Google"'); again();
        }) }, '＋ Adicionar conta')) : h('div', { class: 'tag running' }, `Limite de ${st.max} contas atingido.`),
        h('div', { class: 'accgrid' }, ...st.accounts.map(card))),
      h('div', { class: 'card ssec' },
        h('div', { class: 'row' }, h('span', { class: 'sicon' }, '🪐'), h('div', { class: 'grow' }, h('strong', {}, 'Antigravity nas rotas'),
          h('div', { class: 'muted' }, st.config.agyAccount ? `As etapas com Antigravity usam a sessão da conta "${st.accounts.find((a) => a.id === st.config.agyAccount)?.label ?? st.config.agyAccount}".` : 'As etapas com Antigravity usam a sessão normal do Windows. Escolha uma conta em "✔ Usar no Antigravity".'))),
        h('div', { class: 'muted' }, 'A troca de conta é manual. Use contas suas e respeite os termos e limites de uso do Google.'))];
  };

  /* ── Testar o Flow como executor (diagnóstico sem gastar créditos, ou uma geração de teste) ── */
  /** Seletores projeto → cena (o resultado do Flow vai para DENTRO da cena escolhida). */
  const sceneTarget = (projects: Array<{ id: string; name: string }>) => {
    const pj = h('select', { 'data-field': 'tgt-project' }, h('option', { value: '' }, '— só testar (pasta da conta) —'), ...projects.map((p) => h('option', { value: p.id }, `📁 ${p.name}`))) as HTMLSelectElement;
    const sc = h('select', { 'data-field': 'tgt-scene', disabled: true }, h('option', { value: '' }, '— cena —')) as HTMLSelectElement;
    pj.addEventListener('change', () => void guard(async () => {
      sc.replaceChildren(h('option', { value: '' }, '— cena —')); sc.disabled = !pj.value; if (!pj.value) return;
      const p = (await c.forge['getProject'](pj.value)) as Project;
      for (const s of p.scenes) sc.append(h('option', { value: s.id }, `${s.index}. ${s.title}`));
      if (p.scenes[0]) sc.value = p.scenes[0].id;
    }));
    return { pj, sc };
  };
  const flowTestCard = (projects: Array<{ id: string; name: string }>) => {
    const tgt = sceneTarget(projects);
    const out = h('div', { id: 'flow-test-out' });
    const prompt = h('input', { class: 'grow', id: 'flow-test-prompt', placeholder: 'Prompt de teste (opcional)' }) as HTMLInputElement;
    const run = (mode: 'diagnose' | 'image' | 'video') => void guard(async () => {
      out.replaceChildren(h('div', { class: 'muted' }, mode === 'diagnose' ? '⏳ Abrindo o Flow e lendo a página…' : `⏳ Gerando ${mode === 'image' ? 'imagem' : 'vídeo'} de teste no Flow… (veja o navegador da conta)`));
      try {
        if (mode !== 'diagnose' && tgt.pj.value && !tgt.sc.value) throw new Error('Escolha a cena do projeto.');
        const r = (await c.forge['autoFlowTest'](flowAccount, mode, prompt.value, tgt.pj.value ? { projectId: tgt.pj.value, sceneId: tgt.sc.value } : undefined)) as { mode: string; debugDir: string; file?: string; url?: string; loggedOut?: boolean; hasInput?: boolean; project?: string; scene?: number };
        out.replaceChildren(
          r.file ? h('div', {}, h('div', { class: 'tag done' }, r.project ? `✓ O Flow gerou e a mídia foi para o projeto "${r.project}", cena ${r.scene}` : '✓ O Flow gerou e o app baixou a mídia (pasta da conta)'), r.file.match(/\.(mp4|webm)$/i) ? h('video', { class: 'flowprev', src: c.forge.mediaUrl(r.file), controls: true }) : h('img', { class: 'flowprev', src: c.forge.mediaUrl(r.file) }))
            : h('div', { class: `tag ${r.loggedOut ? 'failed' : r.hasInput ? 'done' : 'running'}` }, r.loggedOut ? '⛔ Conta sem login no Flow' : r.hasInput ? '✓ Flow aberto e campo de prompt encontrado' : '⚠ Flow aberto, mas o campo de prompt não foi encontrado'),
          h('div', { class: 'muted' }, r.url ?? ''),
          h('div', { class: 'row' }, h('span', { class: 'muted' }, `Diagnóstico: ${r.debugDir}`), h('button', { class: 'small', onclick: () => void c.forge['autoShowFile'](`${r.debugDir}\\flow-debug.json`) }, 'Mostrar')));
      } catch (e) {
        out.replaceChildren(h('div', { class: 'tag failed' }, '⛔ ' + (e as Error).message), h('div', { class: 'muted' }, 'O diagnóstico (flow-debug.json e .png) fica na pasta da conta → flow-debug.'));
      }
    });
    return h('div', { class: 'card ssec' },
      h('div', { class: 'row' }, h('span', { class: 'sicon' }, '🧪'), h('div', { class: 'grow' }, h('strong', {}, 'Testar o Flow como executor'),
        h('div', { class: 'muted' }, 'Nas rotas, escolha "Google Flow (conta)" nas tarefas de imagem/vídeo ou use o perfil "Google Flow (sua conta) + Antigravity". Aqui você testa antes.'))),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Salvar em:'), tgt.pj, tgt.sc, h('span', { class: 'muted' }, 'sem prompt, usa o visual da cena')),
      h('div', { class: 'row' }, prompt,
        h('button', { id: 'flow-test-diag', title: 'Só abre o Flow e lê a página — não gera nada', onclick: () => run('diagnose') }, '🔍 Diagnosticar (sem gerar)'),
        h('button', { id: 'flow-test-img', title: 'Gera UMA imagem (usa créditos da conta)', onclick: () => run('image') }, '🖼️ Gerar imagem de teste'),
        h('button', { id: 'flow-test-vid', title: 'Gera UM vídeo (usa créditos da conta)', onclick: () => run('video') }, '🎬 Gerar vídeo de teste')),
      out);
  };

  /* ── Flow ── */
  const flowView = async () => {
    if (!st.accounts.length) return [h('div', { class: 'card muted' }, 'Adicione uma conta Google em "Contas Google" primeiro.')];
    const acc = st.accounts.find((a) => a.id === flowAccount)!;
    const pick = h('select', { id: 'flow-acc' }, ...st.accounts.map((a) => h('option', { value: a.id }, `${a.label}${a.email ? ` (${a.email})` : ''}`))) as HTMLSelectElement;
    pick.value = flowAccount; pick.addEventListener('change', () => { flowAccount = pick.value; again(); });
    const prompts = h('textarea', { id: 'flow-prompts', rows: '8', placeholder: 'Um prompt por linha. "Salvar e copiar" grava a fila na pasta da conta e copia para a área de transferência — cole na sua extensão do Flow.' }) as HTMLTextAreaElement;
    prompts.value = ((await c.forge['autoPromptsGet'](flowAccount)) as string) ?? '';
    const count = h('span', { class: 'muted' }, `${prompts.value.split(/\r?\n/).filter((x) => x.trim()).length} prompt(s)`);
    prompts.addEventListener('input', () => { count.textContent = `${prompts.value.split(/\r?\n/).filter((x) => x.trim()).length} prompt(s)`; });
    const dls = ((await c.forge['autoDownloads'](flowAccount)) as Dl[]) ?? [];
    const projects = ((await c.forge['listProjects']()) as Array<{ id: string; name: string }>) ?? [];
    const dlCard = (d: Dl) => {
      const url = c.forge.mediaUrl(d.file);
      const media = d.kind === 'video' ? h('video', { src: url + '#t=0.1', preload: 'metadata', muted: true, controls: true }) : d.kind === 'image' ? h('img', { src: url, alt: d.name }) : h('div', { class: 'dlicon' }, d.kind === 'audio' ? '🎵' : '📄');
      const pj = h('select', { 'data-field': 'dl-project' }, h('option', { value: '' }, '— projeto —'), ...projects.map((p) => h('option', { value: p.id }, p.name))) as HTMLSelectElement;
      const sc = h('select', { 'data-field': 'dl-scene', disabled: true }, h('option', { value: '' }, '— cena —')) as HTMLSelectElement;
      pj.addEventListener('change', () => void guard(async () => {
        sc.replaceChildren(h('option', { value: '' }, '— cena —')); sc.disabled = !pj.value; if (!pj.value) return;
        const p = (await c.forge['getProject'](pj.value)) as Project;
        for (const s of p.scenes) sc.append(h('option', { value: s.id }, `${s.index}. ${s.title}`));
      }));
      return h('div', { class: 'dlcard' }, media, h('strong', { title: d.name }, d.name), h('span', { class: 'muted' }, `${(d.size / 1048576).toFixed(1)} MB · ${new Date(d.at).toLocaleString('pt-BR')}`),
        d.kind === 'video' || d.kind === 'image' ? h('div', { class: 'row' }, pj, sc, h('button', { class: 'small primary', onclick: () => void guard(async () => {
          if (!pj.value || !sc.value) throw new Error('Escolha o projeto e a cena.');
          await c.forge['autoImport'](flowAccount, d.file, pj.value, sc.value); c.toast('Mídia movida para dentro do projeto (visual da cena). Renderize o final no Editor.'); again();
        }) }, '→ Mover para a cena')) : null,
        h('button', { class: 'small', onclick: () => void c.forge['autoShowFile'](d.file) }, 'Mostrar na pasta'));
    };
    return [browserCard(),
      h('div', { class: 'card ssec' },
        h('div', { class: 'row' }, h('span', { class: 'sicon' }, '🌊'), h('div', { class: 'grow' }, h('strong', {}, 'Google Flow'), h('div', { class: 'muted' }, `${st.flowUrl} — no navegador da conta, com a sua extensão. Os downloads vão para a pasta da conta.`)),
          h('label', {}, 'Conta', pick),
          h('button', { class: 'primary', id: 'flow-open', onclick: () => void guard(async () => { await c.forge['autoOpen'](flowAccount, 'flow'); c.toast(`Flow aberto com "${acc.label}"`); }) }, '🌊 Abrir Flow')),
        acc && !acc.hasProfile ? h('div', { class: 'tag running' }, '⚠ Esta conta ainda não fez login: use "🔐 Entrar no Google" em Contas Google.') : null),
      flowTestCard(projects),
      h('div', { class: 'card ssec' },
        h('div', { class: 'row' }, h('span', { class: 'sicon' }, '📝'), h('div', { class: 'grow' }, h('strong', {}, 'Fila de prompts'), count),
          h('button', { id: 'flow-prompts-save', onclick: () => void guard(async () => { const r = (await c.forge['autoPromptsSave'](flowAccount, prompts.value)) as { count: number }; c.toast(`${r.count} prompt(s) salvos e copiados`); }) }, '💾 Salvar e copiar')),
        prompts),
      h('div', { class: 'card ssec' },
        h('div', { class: 'row' }, h('span', { class: 'sicon' }, '📥'), h('div', { class: 'grow' }, h('strong', {}, `Downloads de "${acc?.label ?? ''}" (${dls.length})`), h('div', { class: 'muted' }, 'Envie um vídeo ou imagem para uma cena: ele vira o visual da cena na montagem.')),
          h('button', { onclick: again }, '↻ Atualizar'), h('button', { onclick: () => void c.forge['autoOpenFolder'](flowAccount) }, '📂 Pasta')),
        dls.length ? h('div', { class: 'dlgrid' }, ...dls.slice(0, 60).map(dlCard)) : h('div', { class: 'muted' }, 'Nada baixado ainda.'))];
  };

  /* ── SRT ── */
  const srtView = () => {
    let file = '';
    const fileLbl = h('span', { class: 'muted', id: 'srt-file' }, 'nenhum arquivo');
    const maxChars = h('input', { type: 'number', min: '16', max: '80', value: '42', class: 'num', id: 'srt-chars' }) as HTMLInputElement;
    const maxLines = h('select', { id: 'srt-lines' }, h('option', { value: '1' }, '1 linha'), h('option', { value: '2' }, '2 linhas'), h('option', { value: '3' }, '3 linhas')) as HTMLSelectElement; maxLines.value = '2';
    const maxSec = h('input', { type: 'number', min: '1.5', max: '10', step: '0.5', value: '6', class: 'num', id: 'srt-sec' }) as HTMLInputElement;
    const lang = h('select', { id: 'srt-lang' }, ...[['', 'Detectar'], ['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['fr', 'Francês'], ['de', 'Alemão'], ['it', 'Italiano'], ['ja', 'Japonês']].map(([v, l]) => h('option', { value: v! }, l!))) as HTMLSelectElement;
    const out = h('div', { id: 'srt-out' });
    const go = h('button', { class: 'primary', id: 'srt-go', onclick: () => void guard(async () => {
      if (!file) throw new Error('Escolha um áudio ou vídeo.');
      go.setAttribute('disabled', ''); out.replaceChildren(h('div', { class: 'muted' }, '⏳ Transcrevendo com o Whisper… (a primeira vez pode instalar o faster-whisper)'));
      try {
        const r = (await c.forge['autoSrt'](file, { maxChars: Number(maxChars.value), maxLines: Number(maxLines.value), maxSeconds: Number(maxSec.value), language: lang.value || undefined })) as { file: string; cues: number; preview: string; source: string };
        out.replaceChildren(h('div', { class: 'tag done' }, `✓ ${r.cues} legendas`), h('div', { class: 'row' }, h('code', {}, r.file), h('button', { class: 'small', onclick: () => void c.forge['autoShowFile'](r.file) }, 'Mostrar na pasta')),
          h('pre', { class: 'pvtext' }, r.preview + (r.cues > 6 ? '\n…' : '')));
      } finally { go.removeAttribute('disabled'); }
    }) }, '💬 Gerar SRT');
    return [h('div', { class: 'card ssec' },
      h('div', { class: 'row' }, h('span', { class: 'sicon' }, '💬'), h('div', { class: 'grow' }, h('strong', {}, 'SRT a partir de um áudio ou vídeo'), h('div', { class: 'muted' }, 'O Whisper transcreve com tempo por palavra; o .srt é gravado ao lado do arquivo (nunca sobrescreve).'))),
      h('div', { class: 'row' }, h('button', { id: 'srt-pick', onclick: () => void guard(async () => {
        const f = (await c.forge['openFile']({ title: 'Áudio ou vídeo', filters: [{ name: 'Áudio/vídeo', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'mp4', 'mov', 'mkv', 'webm'] }] })) as string | null;
        if (f) { file = f; fileLbl.textContent = '🎵 ' + f; }
      }) }, 'Escolher arquivo…'), fileLbl),
      h('div', { class: 'row' }, h('label', {}, 'Caracteres por linha', maxChars), h('label', {}, 'Linhas por legenda', maxLines), h('label', {}, 'Duração máx. (s)', maxSec), h('label', {}, 'Idioma', lang), go),
      out)];
  };

  const body = autoTab === 'accounts' ? accountsView() : autoTab === 'usage' ? usageView(c) : autoTab === 'flow' ? await flowView() : srtView();
  c.main.replaceChildren(
    h('div', { class: 'row pagehead' }, h('h2', {}, '⚙️ Automações'), helpButton('automations'), h('span', { class: 'sp' })),
    tabs, ...body);
}

/* ───────── 📊 Uso dos provedores (sessão e semana) ───────── */
interface UsageWindow { id: string; label: string; percent?: number; resetsAt?: string; tokens?: number; cost?: number; calls?: number }
interface HarnessUsage { harness: string; account?: string; accountLabel?: string; source: string; plan?: string; windows: UsageWindow[]; note?: string; error?: string }
const H_INFO: Record<string, [string, string]> = { claude: ['🟠', 'Claude Code'], codex: ['🟢', 'Codex'], opencode: ['⚫', 'OpenCode'], antigravity: ['🪐', 'Antigravity'], flow: ['🌊', 'Google Flow'] };
const fmtTok = (n?: number) => n === undefined ? '—' : n >= 1e9 ? `${(n / 1e9).toFixed(2)} bi` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} mil` : String(n);
const untilTxt = (iso?: string) => {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'renovado';
  const mins = Math.round(ms / 60e3), h = Math.floor(mins / 60), m = mins % 60;
  return h >= 24 ? `renova em ${Math.floor(h / 24)} d ${h % 24} h` : `renova em ${h} h ${m} min`;
};

function usageView(c: AutoCtx): HTMLElement[] {
  const box = h('div', { id: 'usage-box' }, h('div', { class: 'muted' }, '⏳ lendo o uso de cada provedor…'));
  const load = async () => {
    try {
      const list = (await c.forge['usageReport']()) as HarnessUsage[];
      box.replaceChildren(h('div', { class: 'us-grid' }, ...list.map((u) => {
        const [ic, name] = H_INFO[u.harness] ?? ['🧩', u.harness];
        const win = (w: UsageWindow) => h('div', { class: 'us-win' },
          h('div', { class: 'row' }, h('strong', { class: 'grow' }, w.label), w.percent !== undefined ? h('strong', { class: `us-pct ${w.percent >= 90 ? 'bad' : w.percent >= 70 ? 'warn' : 'ok'}` }, `${Math.round(w.percent)}%`) : null),
          w.percent !== undefined ? h('div', { class: 'us-track' }, h('span', { class: `us-fill ${w.percent >= 90 ? 'bad' : w.percent >= 70 ? 'warn' : 'ok'}`, style: `width:${Math.min(100, Math.max(0, w.percent))}%` })) : null,
          w.id === 'credits' ? h('div', { class: 'us-credits' }, `💳 ${w.tokens ?? '—'} créditos`) : w.tokens !== undefined ? h('div', { class: 'muted small' }, `${fmtTok(w.tokens)} tokens${w.calls !== undefined ? ` · ${w.calls} chamada(s)` : ''}${w.cost !== undefined ? ` · US$ ${w.cost.toFixed(2)}` : ''}`) : null,
          w.resetsAt ? h('div', { class: 'muted small' }, `⏱ ${untilTxt(w.resetsAt)} (${new Date(w.resetsAt).toLocaleString()})`) : null);
        return h('div', { class: `card us-card${u.error ? ' off' : ''}`, 'data-usage': `${u.harness}${u.account ? ':' + u.account : ''}` },
          h('div', { class: 'row' }, h('span', { class: 'us-ic' }, ic), h('div', { class: 'grow' }, h('strong', {}, name, u.accountLabel ? ` · ${u.accountLabel}` : ''), u.plan ? h('span', { class: 'tag' }, `plano ${u.plan}`) : null)),
          u.error ? h('div', { class: 'muted' }, `ℹ️ ${u.error}`) : h('div', { class: 'us-wins' }, ...u.windows.map(win)),
          u.note ? h('div', { class: 'muted small' }, u.note) : null,
          h('div', { class: 'muted small us-src' }, u.source));
      })), h('div', { class: 'muted small' }, 'Claude e Codex mostram o limite oficial do plano (sessão de 5 h e semana). O OpenCode não tem limite próprio (depende do provedor do modelo): mostra tokens e custo. O Google não publica a cota do Antigravity: o FilmForge soma os tokens reais de cada chamada que ele faz, por conta.'));
    } catch (e) { box.replaceChildren(h('div', { class: 'tag failed' }, '⛔ ' + (e as Error).message)); }
  };
  void load();
  return [h('div', { class: 'row' }, h('p', { class: 'muted grow' }, 'Quanto já foi usado na sessão e na semana em cada harness. Cada conta do Antigravity aparece separada.'), h('button', { id: 'usage-refresh', onclick: () => { box.replaceChildren(h('div', { class: 'muted' }, '⏳ atualizando…')); void load(); } }, '↻ Atualizar')), box];
}
