import { helpButton } from './carousel';
import { askConfirm, showMessage } from './dialogs';

/*
 * Aba CANAIS: os canais que VOCÊ gerencia (YouTube, TikTok, Instagram, Facebook).
 * Diferente da aba "Pesquisar", que analisa canais alheios: aqui você cadastra o seu,
 * gera a marca com IA (nome, descrição, cores, banner, avatar), vincula projetos e publica.
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
type Api = Record<string, (...a: any[]) => Promise<any>> & { mediaUrl: (p: string) => string };
export interface ChannelsCtx {
  forge: Api; toast: (m: string, bad?: boolean) => void; main: HTMLElement;
  guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

interface Palette { background?: string; text?: string; accent?: string; secondary?: string; extra?: string[]; mode?: 'dark' | 'light'; contrast?: number }
interface Identity { palettes?: { channel?: Palette; video?: Palette; thumbnail?: Palette }; thumbStyle?: string; thumbRules?: string;
  typography?: { family?: string; weight?: string; case?: 'upper' | 'title' | 'sentence'; outline?: string; shadow?: string; animation?: string } }
interface ChannelBrand { names?: string[]; handle?: string; tagline?: string; description?: string; keywords?: string[]; tags?: string[];
  colors?: string[]; fonts?: string; logoIdea?: string; bannerPrompt?: string; avatarPrompt?: string; tone?: string; identity?: Identity; createdAt?: string }
interface Analytics {
  platform: string; source: string; at: string; title?: string; handle?: string; followers?: number; totalViews?: number; mediaCount?: number; sample: number;
  avgViews?: number; medianViews?: number; maxViews?: number; engagementRate?: number; uploadsPerWeek?: number; avgDurationSec?: number; shortsShare?: number;
  bestWeekday?: number; bestHourUtc?: number; top?: Array<{ id: string; title: string; views?: number; url?: string }>; insights?: string[]; warnings?: string[];
}
type SetupStep = 'link' | 'auth' | 'type' | 'brand' | 'banner' | 'identity' | 'analytics';
interface ChannelView {
  id: string; name: string; platform: string; accountId?: string; handle?: string; url?: string;
  brand?: ChannelBrand; brandHistory?: ChannelBrand[]; assets?: { banner?: string; avatar?: string; thumb?: string };
  type?: string; language?: string; auth?: { status: 'pending' | 'opened' | 'confirmed'; at?: string }; identity?: Identity; analytics?: Analytics; cloneIds?: string[];
  createdAt: string; lastPublishAt?: string;
  dir: string; hasBrand: boolean; hasAssets: { banner: boolean; avatar: boolean; thumb: boolean }; projects: number;
  setup?: { done: SetupStep[]; next?: SetupStep };
}
interface AccountRow { id: string; label: string; email?: string; hasProfile: boolean }
interface State {
  list: ChannelView[];
  platforms: Record<string, { label: string; icon: string; loginUrl: string }>;
  ready: string[];
  max: number;
  accounts: AccountRow[];
  types?: Array<{ id: string; label: string; hint: string; thumbStyle: string; mode: 'dark' | 'light' }>;
  thumbStyles?: Array<{ id: string; label: string; hint: string }>;
  apis?: Record<string, boolean>;
}

const SETUP_LABEL: Record<SetupStep, string> = { link: '🔗 Link', auth: '🔐 Autenticação', type: '🏷 Tipo', brand: '🎨 Marca', banner: '🖼 Banner', identity: '🎯 Identidade', analytics: '📊 Análise' };
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const fmtN = (n?: number) => (n === undefined ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} mil` : String(n));

/* contraste WCAG (mesma conta do processo principal) — mostrado ao editar a paleta */
const lum = (hex: string) => {
  let x = hex.replace('#', ''); if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => { const c = parseInt(x.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastOf = (a: string, b: string) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]; return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 10) / 10; };
interface ProjectRow { id: string; name: string; createdAt: string; hasVideo: boolean; published: Array<{ platform: string; url?: string | null; at: string }> }

let selected: string | undefined;
/** filtro por plataforma (tiles do topo); vazio = todas */
let filter = '';

/** YouTube chama de "canal"; TikTok, Instagram e Facebook, de "perfil". */
const noun = (platform: string) => (platform === 'youtube' ? 'canal' : 'perfil');

/** Link do perfil a partir do @handle (quando o usuário não colou a URL). */
export function profileUrl(platform: string, handle?: string, url?: string): string | undefined {
  if (url?.trim()) return url.trim();
  const hnd = (handle ?? '').trim().replace(/^@/, '');
  if (!hnd) return undefined;
  if (platform === 'youtube') return `https://www.youtube.com/@${hnd}`;
  if (platform === 'tiktok') return `https://www.tiktok.com/@${hnd}`;
  if (platform === 'instagram') return `https://www.instagram.com/${hnd}/`;
  if (platform === 'facebook') return `https://www.facebook.com/${hnd}`;
  if (platform === 'kwai') return `https://www.kwai.com/@${hnd}`;
  return undefined;
}

/** Selo redondo: avatar gerado (se houver) ou a inicial sobre a cor da plataforma. */
function avatarOf(ch: ChannelView, forge: Api, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  const box = h('div', { class: `ch-av ch-av-${size} pl-${ch.platform}` });
  if (ch.hasAssets.avatar && ch.assets?.avatar) box.append(h('img', { src: forge.mediaUrl(`${ch.dir}/${ch.assets.avatar}`), alt: '' }));
  else box.append(h('span', {}, (ch.name.trim()[0] ?? '?').toUpperCase()));
  return box;
}

export async function renderChannelsPage(c: ChannelsCtx): Promise<void> {
  const { forge, toast, main, guard } = c;
  const again = () => void renderChannelsPage(c);
  const st = (await guard(() => forge['channelsGet']())) as State | undefined;
  if (!st) { main.replaceChildren(h('div', { class: 'row pagehead' }, h('h2', {}, '📺 Canais'))); return; }

  /* mantém a seleção válida quando o canal é removido */
  if (selected && !st.list.some((x) => x.id === selected)) selected = undefined;
  if (!selected && st.list.length) selected = st.list[0]!.id;

  const head = h('div', { class: 'row pagehead' },
    h('h2', {}, '📺 Canais e perfis'), helpButton('automations'), h('span', { class: 'sp' }),
    h('span', { class: 'muted ch-count' }, `${st.list.length}/${st.max}`),
    h('button', { class: 'primary', onclick: () => openAdd(c, st, again) }, '＋ Adicionar'),
  );

  /* tiles por plataforma: contagem, filtro (clique) e atalho para adicionar (＋) */
  if (filter && !st.platforms[filter]) filter = '';
  const tiles = h('div', { class: 'ch-plats' }, ...Object.entries(st.platforms).map(([id, info]) => {
    const n = st.list.filter((x) => x.platform === id).length;
    return h('div', { class: `ch-plat pl-${id}${filter === id ? ' on' : ''}`, title: filter === id ? 'Mostrar todas as plataformas' : `Mostrar só ${info.label}`,
      onclick: () => { filter = filter === id ? '' : id; again(); } },
      h('span', { class: 'ch-plat-ic' }, info.icon),
      h('div', { class: 'ch-plat-txt' }, h('b', {}, info.label), h('span', {}, `${n} ${noun(id)}${n === 1 ? '' : 's'}`)),
      h('button', { class: 'ch-plat-add', title: `Adicionar ${noun(id)} de ${info.label}`, onclick: (e: Event) => { e.stopPropagation(); openAdd(c, st, again, id); } }, '＋'),
    );
  }));

  if (!st.list.length) {
    main.replaceChildren(head, tiles, h('div', { class: 'card ch-empty' },
      h('div', { class: 'ch-big' }, '📺'),
      h('h3', {}, 'Nenhum canal ou perfil ainda'),
      h('p', { class: 'muted' }, 'Cadastre seus canais do YouTube e seus perfis de TikTok, Instagram e Facebook. Cada um guarda a conta (sessão do navegador), a marca (nome, descrição, cores) e as imagens prontas.'),
      h('p', { class: 'muted' }, `Você tem ${st.accounts.length} conta(s) em Automações. O login é feito por você no navegador uma única vez — o app nunca digita senha.`),
      h('button', { class: 'primary', onclick: () => openAdd(c, st, again) }, '＋ Adicionar o primeiro'),
    ));
    return;
  }

  const shown = filter ? st.list.filter((x) => x.platform === filter) : st.list;
  const cur = st.list.find((x) => x.id === selected)!;
  const cols = h('div', { class: 'ch-cols' },
    h('div', { class: 'ch-list' }, ...(shown.length ? shown.map((ch) => channelCard(c, ch, st, () => { selected = ch.id; again(); }))
      : [h('p', { class: 'muted' }, `Nenhum ${noun(filter)} de ${st.platforms[filter]?.label ?? filter}.`)])),
    channelDetail(c, cur, st, again),
  );
  main.replaceChildren(head, tiles, cols);
}

function channelCard(c: ChannelsCtx, ch: ChannelView, st: State, onPick: () => void): HTMLElement {
  const info = st.platforms[ch.platform] ?? { icon: '📺', label: ch.platform };
  const ready = st.ready.includes(ch.platform);
  return h('div', { class: `ch-item pl-${ch.platform}${ch.id === selected ? ' on' : ''}`, onclick: onPick },
    h('div', { class: 'ch-item-top' },
      avatarOf(ch, c.forge),
      h('div', { class: 'ch-item-name' },
        h('b', {}, ch.name),
        h('span', { class: 'muted' }, `${info.icon} ${info.label}${ch.handle ? ` · ${ch.handle}` : ''}`),
      ),
    ),
    h('div', { class: 'ch-badges' },
      ch.setup ? h('span', { class: `ch-badge${ch.setup.next ? '' : ' ok'}`, title: ch.setup.next ? `Próximo passo: ${SETUP_LABEL[ch.setup.next]}` : 'Cadastro completo' }, `cadastro ${ch.setup.done.length}/7`) : null,
      ch.hasBrand ? h('span', { class: 'ch-badge ok' }, 'marca ✓') : h('span', { class: 'ch-badge' }, 'sem marca'),
      ch.auth?.status === 'confirmed' ? h('span', { class: 'ch-badge ok' }, 'login ✓') : ch.accountId ? h('span', { class: 'ch-badge' }, 'conta ✓') : h('span', { class: 'ch-badge warn' }, 'sem conta'),
      ready ? null : h('span', { class: 'ch-badge' }, 'em breve'),
      ch.projects ? h('span', { class: 'ch-badge' }, `${ch.projects} projeto${ch.projects > 1 ? 's' : ''}`) : null,
    ),
  );
}

function channelDetail(c: ChannelsCtx, ch: ChannelView, st: State, again: () => void): HTMLElement {
  const { forge, toast, guard } = c;
  const info = st.platforms[ch.platform] ?? { icon: '📺', label: ch.platform, loginUrl: '' };
  const ready = st.ready.includes(ch.platform);
  const body = h('div', { class: 'ch-body' });

  const nameIn = h('input', { value: ch.name, placeholder: 'Nome do canal' }) as HTMLInputElement;
  const handleIn = h('input', { value: ch.handle ?? '', placeholder: '@handle' }) as HTMLInputElement;
  const urlIn = h('input', { value: ch.url ?? '', placeholder: profileUrl(ch.platform, ch.handle || 'seuhandle') ?? 'https://… (opcional)' }) as HTMLInputElement;
  const link = profileUrl(ch.platform, ch.handle, ch.url);

  /* topo: banner da marca (ou degradê da plataforma/cores da marca), avatar, nome e atalhos */
  const brandCols = (ch.brand?.colors ?? []).filter((x) => /^#[0-9a-f]{3,6}$/i.test(x));
  const hero = h('div', { class: `ch-hero pl-${ch.platform}` });
  /* CSP style-src 'self' bloqueia o atributo style; pelo CSSOM é permitido */
  if (brandCols.length >= 2) hero.style.background = `linear-gradient(120deg, ${brandCols[0]}, ${brandCols[1]})`;
  if (ch.hasAssets.banner && ch.assets?.banner) hero.append(h('img', { class: 'ch-hero-bg', src: forge.mediaUrl(`${ch.dir}/${ch.assets.banner}`), alt: '' }));
  hero.append(h('div', { class: 'ch-hero-row' },
    avatarOf(ch, forge, 'lg'),
    h('div', { class: 'ch-hero-name' },
      h('b', {}, ch.name),
      h('span', {}, `${info.icon} ${info.label}${ch.handle ? ` · ${ch.handle}` : ''}${ch.projects ? ` · ${ch.projects} projeto${ch.projects > 1 ? 's' : ''}` : ''}`),
    ),
    h('span', { class: 'sp' }),
    link ? h('button', { class: 'small ch-hero-btn', title: link, onclick: () => void forge['openUrl']?.(link) }, `↗ Abrir ${noun(ch.platform)}`) : null,
    h('button', { class: 'small ch-hero-btn', title: info.loginUrl, onclick: () => void forge['openUrl']?.(info.loginUrl) }, '🌐 Painel'),
  ));
  const accSel = h('select', {},
    h('option', { value: '' }, '— nenhuma conta —'),
    ...st.accounts.map((a) => h('option', { value: a.id, ...(a.id === ch.accountId ? { selected: true } : {}) },
      `${a.label}${a.email ? ` (${a.email})` : ''}${a.hasProfile ? ' · com login' : ' · sem login'}`)),
  ) as HTMLSelectElement;

  const typeSel = h('select', {}, h('option', { value: '' }, '— tipo do canal —'),
    ...(st.types ?? []).map((t) => h('option', { value: t.id, title: t.hint, ...(t.id === ch.type ? { selected: true } : {}) }, t.label))) as HTMLSelectElement;
  const saveMeta = async () => {
    const r = await guard(() => forge['channelsUpdate'](ch.id, { name: nameIn.value, handle: handleIn.value, url: urlIn.value, type: typeSel.value, accountId: accSel.value }));
    if (r) { toast('Canal atualizado'); again(); }
  };

  /* ── checklist do cadastro guiado ── */
  const setup = ch.setup ?? { done: [] as SetupStep[] };
  const setupBar = h('div', { class: 'ch-setup' }, ...(Object.keys(SETUP_LABEL) as SetupStep[]).map((k) =>
    h('span', { class: `ch-step${setup.done.includes(k) ? ' ok' : setup.next === k ? ' now' : ''}`, title: setup.done.includes(k) ? 'feito' : setup.next === k ? 'próximo passo' : 'pendente' },
      `${setup.done.includes(k) ? '✓' : setup.next === k ? '▸' : '○'} ${SETUP_LABEL[k]}`)),
    setup.next ? h('span', { class: 'muted small' }, `Próximo: ${SETUP_LABEL[setup.next]}`) : h('span', { class: 'ch-badge ok' }, 'cadastro completo'));

  /* ── autenticação: login feito pelo usuário no navegador da conta, depois confirmado aqui ── */
  const authLbl = ch.auth?.status === 'confirmed' ? `✓ login confirmado${ch.auth.at ? ` em ${new Date(ch.auth.at).toLocaleDateString()}` : ''}`
    : ch.auth?.status === 'opened' ? '… navegador aberto — faça o login e confirme' : 'login ainda não feito';
  const authSec = h('div', { class: 'ch-sec' }, h('h4', {}, '🔐 Autenticação'),
    h('p', { class: 'muted' }, `O login é feito por você no navegador da conta escolhida (o app nunca digita senha). Depois de entrar no ${info.label}${ch.url ? ' e conferir que é o seu ' + noun(ch.platform) : ''}, confirme aqui.`),
    h('div', { class: 'row' },
      h('span', { class: `ch-badge${ch.auth?.status === 'confirmed' ? ' ok' : ch.auth?.status === 'opened' ? '' : ' warn'}` }, authLbl), h('span', { class: 'sp' }),
      h('button', { class: 'small', onclick: async () => {
        if (accSel.value && accSel.value !== ch.accountId) await guard(() => forge['channelsUpdate'](ch.id, { accountId: accSel.value }));
        const r = await guard(() => forge['channelsOpenLogin'](ch.id));
        if (r) { toast('Navegador da conta aberto — faça o login e depois clique em "Já fiz o login"'); again(); }
      } }, '🔐 Abrir login'),
      ch.auth?.status === 'confirmed'
        ? h('button', { class: 'small', onclick: async () => { if (await guard(() => forge['channelsUpdate'](ch.id, { authConfirmed: false }))) again(); } }, 'Desfazer')
        : h('button', { class: 'small primary', onclick: async () => { if (await guard(() => forge['channelsUpdate'](ch.id, { authConfirmed: true }))) { toast('Login confirmado'); again(); } } }, '✓ Já fiz o login')));

  /* ── marca ── */
  const brandBox = h('div', { class: 'ch-brand' });
  if (ch.brand) brandBox.append(brandView(ch, c, again)); else brandBox.append(h('p', { class: 'muted' }, 'Ainda sem marca. A IA pode sugerir nome, handle, tagline, descrição, cores, fontes e os prompts de banner e avatar.'));

  const ideaIn = h('textarea', { rows: '3', placeholder: 'Descreva a ideia do canal: nicho, público, o que ele entrega e o tom (ex.: "canal de história da ciência para curiosos, tom direto, sem sensacionalismo")' }) as HTMLTextAreaElement;
  const noteIn = h('input', { placeholder: 'Observações (opcional): referências, restrições, nome preferido…' }) as HTMLInputElement;
  const prog = h('div', { class: 'ch-prog' });
  const logPre = h('pre', { class: 'ch-log' }) as HTMLPreElement;

  /* a ideia fica lembrada por canal (para "recriar" sem redigitar) */
  try { ideaIn.value = localStorage.getItem(`ch-idea-${ch.id}`) ?? ''; } catch { /* sem armazenamento */ }
  const genBtn = h('button', { class: 'primary' }, ch.brand ? '✨ Gerar marca de novo' : '✨ Criar marca e configurar') as HTMLButtonElement;
  const recBtn = h('button', { title: 'Pede à IA um conceito DIFERENTE (outros nomes, paleta e logo). A marca atual vai para o histórico.' }, '♻ Recriar marca') as HTMLButtonElement;
  const runBrand = async (recreate: boolean) => {
    const idea = ideaIn.value.trim() || (st.types ?? []).find((t) => t.id === typeSel.value)?.hint || '';
    if (!idea) { toast('Descreva a ideia do canal (ou escolha o tipo)', true); return; }
    try { localStorage.setItem(`ch-idea-${ch.id}`, ideaIn.value); } catch { /* sem armazenamento */ }
    genBtn.disabled = recBtn.disabled = true; prog.textContent = 'iniciando…'; logPre.textContent = '';
    const off = (forge as unknown as { onEvent?: (cb: (e: { t: string; pct?: number; label?: string; line?: string; id?: string }) => void) => () => void }).onEvent?.((e) => {
      if (e.t === 'channel.brand-progress' && e.id === ch.id) { prog.textContent = `${e.label ?? ''} ${e.pct ?? 0}%`; }
      if (e.t === 'log' && e.line) { logPre.textContent += e.line + '\n'; logPre.scrollTop = logPre.scrollHeight; }
    });
    try {
      const r = await guard(() => forge['channelsBrand'](ch.id, { idea, name: recreate ? undefined : nameIn.value || undefined, note: noteIn.value || undefined, platform: ch.platform, type: typeSel.value || undefined, recreate }));
      if (r) {
        const warns = (r as { warnings?: string[] }).warnings ?? [];
        toast(warns.length ? `Marca criada com ${warns.length} aviso(s)` : recreate ? 'Marca recriada (a anterior ficou no histórico)' : 'Marca criada', warns.length > 0);
        off?.(); again();
      }
    } finally { off?.(); genBtn.disabled = recBtn.disabled = false; }
  };
  genBtn.addEventListener('click', () => void runBrand(false));
  recBtn.addEventListener('click', () => void runBrand(true));
  const history = (ch.brandHistory ?? []).length ? h('details', { class: 'ch-hist' }, h('summary', { class: 'muted small' }, `🕘 ${ch.brandHistory!.length} versão(ões) anterior(es) da marca`),
    ...ch.brandHistory!.map((b, i) => h('div', { class: 'row' },
      h('b', {}, b.names?.[0] ?? '—'), h('span', { class: 'muted small' }, `${b.tagline ?? ''}${b.createdAt ? ` · ${new Date(b.createdAt).toLocaleDateString()}` : ''}`), h('span', { class: 'sp' }),
      h('button', { class: 'small', onclick: async () => { if (await guard(() => forge['channelsBrandRestore'](ch.id, i))) { toast('Marca restaurada'); again(); } } }, '↩ Restaurar')))) : null;

  /* ── publicar ── */
  const projBox = h('div', { class: 'ch-projects' }, h('p', { class: 'muted' }, 'Carregando projetos…'));
  void (async () => {
    const rows = ((await guard(() => forge['channelsProjects'](ch.id))) ?? []) as ProjectRow[];
    projBox.replaceChildren(...(rows.length ? [
      h('p', { class: 'muted' }, `${rows.length} projeto(s) vinculado(s) a este canal.`),
      ...rows.map((p) => projectRow(c, ch, p, st, again)),
    ] : [
      h('p', { class: 'muted' }, 'Nenhum projeto vinculado. Escolha este canal ao criar um projeto em "Novo projeto" — ele aparece aqui para publicar.'),
    ]));
  })();

  body.append(
    hero,
    setupBar,
    h('div', { class: 'ch-sec' }, h('h4', {}, `${info.icon} Dados do ${noun(ch.platform)}`),
      h('div', { class: 'ch-grid' },
        h('label', {}, `Link do ${noun(ch.platform)} *`, urlIn),
        h('label', {}, 'Tipo do canal', typeSel),
        h('label', {}, 'Nome', nameIn),
        h('label', {}, 'Handle', handleIn),
        h('label', {}, 'Conta (sessão)', accSel),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'small', onclick: saveMeta }, 'Salvar'),
        h('span', { class: 'sp' }),
        h('button', { class: 'small', onclick: async () => {
          const ok = await askConfirm(`Remover o canal "${ch.name}" da lista? A pasta com a marca e as imagens fica no disco.`);
          if (!ok) return;
          const r = await guard(() => forge['channelsRemove'](ch.id));
          if (r) { toast('Canal removido'); again(); }
        } }, '🗑 Remover'),
      ),
    ),
    authSec,
    h('div', { class: 'ch-sec' }, h('h4', {}, '🎨 Marca e configuração'),
      h('p', { class: 'muted small' }, 'A IA sugere nome, descrição, tags, cores, fontes e a identidade (paletas e thumbnail) a partir do tipo e da ideia; depois desenha banner, avatar e uma thumbnail modelo por código.'),
      brandBox,
      h('div', { class: 'ch-grid' }, h('label', { class: 'ch-wide' }, 'Ideia do canal', ideaIn), h('label', { class: 'ch-wide' }, 'Observações', noteIn)),
      h('div', { class: 'row' }, genBtn, ch.brand ? recBtn : null, prog),
      history,
      h('details', {}, h('summary', { class: 'muted small' }, 'registro detalhado'), logPre),
    ),
    identitySection(c, ch, st, again),
    analyticsSection(c, ch, st, again),
    productsSection(c, ch, again),
    h('div', { class: 'ch-sec' }, h('h4', {}, '📤 Publicar'),
      ready ? null : h('p', { class: 'muted' }, `${info.label}: a publicação ainda não está implementada nesta versão. O cadastro, a marca e o vínculo com projetos já funcionam.`),
      projBox,
    ),
  );
  return h('div', { class: 'ch-detail' }, body);
}

/** Identidade: estilo de thumbnail, paletas (canal, vídeos, thumbnail) com contraste e tipografia do texto na tela. */
function identitySection(c: ChannelsCtx, ch: ChannelView, st: State, again: () => void): HTMLElement {
  const { forge, guard, toast } = c;
  const id = ch.identity ?? {};
  const ROLES: Array<[keyof Palette, string]> = [['background', 'Fundo'], ['text', 'Texto'], ['accent', 'Destaque'], ['secondary', 'Apoio']];
  const editors: Record<string, Record<string, HTMLInputElement>> = {};
  const palBox = (key: 'channel' | 'video' | 'thumbnail', title: string) => {
    const p = id.palettes?.[key] ?? {};
    const ins: Record<string, HTMLInputElement> = {};
    const ratio = h('span', { class: 'ch-ratio' });
    const paint = () => {
      const bg = ins['background']!.value, tx = ins['text']!.value;
      const r = contrastOf(tx, bg);
      ratio.textContent = `contraste ${r}:1 ${r >= 7 ? '✓✓' : r >= 4.5 ? '✓' : '⚠ baixo'}`;
      ratio.className = `ch-ratio${r < 4.5 ? ' warn' : ''}`;
      prev.style.background = bg; prev.style.color = tx; acc.style.color = ins['accent']!.value;
    };
    const prev = h('div', { class: 'ch-palprev' }); const acc = h('b', {}, 'DESTAQUE');
    prev.append(h('span', {}, 'Texto '), acc);
    const row = h('div', { class: 'ch-palrow' }, ...ROLES.map(([k, lbl]) => {
      const def = k === 'background' ? '#0b0b10' : k === 'text' ? '#ffffff' : k === 'accent' ? '#ffcc00' : '#7c5cff';
      const v = typeof p[k] === 'string' && /^#[0-9a-f]{6}$/i.test(p[k] as string) ? p[k] as string : def;
      const inp = h('input', { type: 'color', value: v, title: lbl }) as HTMLInputElement;
      inp.addEventListener('input', paint);
      ins[k] = inp;
      return h('label', { class: 'ch-color' }, lbl, inp);
    }));
    editors[key] = ins;
    paint();
    return h('div', { class: 'ch-pal' }, h('b', {}, title), row, prev, ratio);
  };
  const styleSel = h('select', {}, ...(st.thumbStyles ?? []).map((t) => h('option', { value: t.id, title: t.hint, ...(t.id === id.thumbStyle ? { selected: true } : {}) }, `${t.label} — ${t.hint}`))) as HTMLSelectElement;
  const rules = h('input', { value: id.thumbRules ?? '', placeholder: 'Regras da thumbnail: 2–3 palavras, contorno preto, rosto à direita…' }) as HTMLInputElement;
  const ty = id.typography ?? {};
  const fam = h('input', { value: ty.family ?? '', placeholder: 'Família (ex.: Montserrat)' }) as HTMLInputElement;
  const caseSel = h('select', {}, ...[['', '— caixa —'], ['upper', 'CAIXA ALTA'], ['title', 'Título'], ['sentence', 'Frase']].map(([v, l]) => h('option', { value: v!, ...(v === (ty.case ?? '') ? { selected: true } : {}) }, l!))) as HTMLSelectElement;
  const outline = h('input', { value: ty.outline ?? '', placeholder: 'Contorno (ex.: 6 px preto)' }) as HTMLInputElement;
  const shadow = h('input', { value: ty.shadow ?? '', placeholder: 'Sombra (ex.: dura 4 px)' }) as HTMLInputElement;
  const anim = h('select', {}, ...[['', '— animação do texto —'], ['pop', 'Pop / spring'], ['fade', 'Fade'], ['typewriter', 'Máquina de escrever'], ['slide', 'Slide'], ['karaoke', 'Karaokê'], ['word', 'Palavra por palavra']]
    .map(([v, l]) => h('option', { value: v!, ...(v === (ty.animation ?? '') ? { selected: true } : {}) }, l!))) as HTMLSelectElement;
  const collect = (): Identity => {
    const pal = (k: string): Palette => Object.fromEntries(ROLES.map(([r]) => [r, editors[k]![r]!.value])) as Palette;
    return { palettes: { channel: pal('channel'), video: pal('video'), thumbnail: pal('thumbnail') }, thumbStyle: styleSel.value, thumbRules: rules.value,
      typography: { family: fam.value, case: (caseSel.value || undefined) as 'upper' | 'title' | 'sentence' | undefined, outline: outline.value, shadow: shadow.value, animation: anim.value } };
  };
  const save = async (render: boolean) => {
    const r = await guard(() => forge['channelsUpdate'](ch.id, { identity: collect() }));
    if (!r) return;
    if (render && ch.brand) { toast('Identidade salva — redesenhando banner, avatar e thumbnail…'); await guard(() => forge['channelsRenderAssets'](ch.id)); }
    toast('Identidade do canal salva'); again();
  };
  return h('div', { class: 'ch-sec' }, h('h4', {}, '🎯 Identidade visual (thumbnail e paletas)'),
    h('p', { class: 'muted small' }, 'Vale em todos os projetos deste canal: a paleta dos vídeos e a tipografia entram nas cenas e nas legendas, a da thumbnail na thumbnail. Num projeto com skill de canal clonado, ESTA identidade vence a do canal de referência (do clone só vem a estrutura).'),
    h('div', { class: 'ch-grid' }, h('label', { class: 'ch-wide' }, 'Tipo de thumbnail', styleSel), h('label', { class: 'ch-wide' }, 'Regras da thumbnail', rules)),
    h('div', { class: 'ch-pals' }, palBox('channel', '📺 Canal (banner, avatar)'), palBox('video', '🎬 Vídeos'), palBox('thumbnail', '🖼 Thumbnail')),
    h('div', { class: 'ch-grid' }, h('label', {}, 'Fonte do texto na tela', fam), h('label', {}, 'Caixa', caseSel), h('label', {}, 'Contorno', outline), h('label', {}, 'Sombra', shadow), h('label', {}, 'Animação', anim)),
    h('div', { class: 'row' }, h('button', { class: 'small primary', onclick: () => void save(false) }, 'Salvar identidade'),
      ch.brand ? h('button', { class: 'small', onclick: () => void save(true) }, '🖼 Salvar e redesenhar banner/thumb') : null));
}

/** Análise do canal: API oficial (com chave/token) ou yt-dlp; métricas, mais vistos e recomendações. */
function analyticsSection(c: ChannelsCtx, ch: ChannelView, st: State, again: () => void): HTMLElement {
  const { forge, guard, toast } = c;
  const a = ch.analytics;
  const apiOk = st.apis?.[ch.platform];
  const aiCb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const btn = h('button', { class: 'small primary' }, a ? '↻ Analisar de novo' : '📊 Analisar canal') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    if (!ch.url) { toast('Informe o link do canal primeiro', true); return; }
    btn.disabled = true; btn.textContent = 'Analisando…';
    try { const r = await guard(() => forge['channelsAnalyze'](ch.id, { ai: aiCb.checked })); if (r) { toast('Análise concluída'); again(); } }
    finally { btn.disabled = false; btn.textContent = a ? '↻ Analisar de novo' : '📊 Analisar canal'; }
  });
  const tile = (icon: string, label: string, value: string) => h('div', { class: 'cl-tile' }, h('span', { class: 'cl-ti' }, icon), h('strong', {}, value), h('span', { class: 'muted small' }, label));
  const report = a ? h('div', {},
    h('div', { class: 'muted small' }, `${a.source === 'api' ? 'API oficial' : 'lista pública (yt-dlp)'} · ${a.sample} itens · ${new Date(a.at).toLocaleString()}`),
    h('div', { class: 'cl-tiles' },
      tile('👥', 'seguidores', fmtN(a.followers)), tile('👁', 'média de views', fmtN(a.avgViews)), tile('📈', 'mediana', fmtN(a.medianViews)), tile('🏆', 'recorde', fmtN(a.maxViews)),
      a.engagementRate !== undefined ? tile('💬', 'engajamento', `${a.engagementRate}%`) : null, a.uploadsPerWeek !== undefined ? tile('📅', 'posts/semana', String(a.uploadsPerWeek)) : null,
      a.avgDurationSec !== undefined ? tile('⏱', 'duração média', `${a.avgDurationSec} s`) : null, a.bestWeekday !== undefined ? tile('🗓', 'melhor dia', WEEKDAYS[a.bestWeekday] ?? '?') : null),
    a.top?.length ? h('ol', { class: 'ch-top' }, ...a.top.map((t) => h('li', {}, t.url ? h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); void forge['openUrl']?.(t.url!); } }, t.title || t.id) : t.title, h('span', { class: 'muted small' }, ` · ${fmtN(t.views)} views`)))) : null,
    a.insights?.length ? h('ul', { class: 'cl-success' }, ...a.insights.map((x) => h('li', {}, x))) : null,
    ...(a.warnings ?? []).map((w) => h('div', { class: 'tag running' }, '⚠ ' + w))) : h('p', { class: 'muted' }, 'Ainda sem análise.');
  /* credenciais das APIs (só leitura de métricas) */
  const keyIn = h('input', { type: 'password', placeholder: ch.platform === 'youtube' ? 'chave da YouTube Data API v3' : 'token de acesso', autocomplete: 'off' }) as HTMLInputElement;
  const igUser = h('input', { placeholder: 'id da conta profissional (Instagram)' }) as HTMLInputElement;
  const HELP: Record<string, string> = {
    youtube: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', tiktok: 'https://developers.tiktok.com/doc/display-api-overview',
    facebook: 'https://developers.facebook.com/tools/explorer/', instagram: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery', kwai: 'https://www.kwai.com/',
  };
  const saveKey = async () => {
    if (!keyIn.value.trim() && !(ch.platform === 'instagram' && igUser.value.trim())) { toast('Cole a chave ou o token', true); return; }
    const patch = ch.platform === 'youtube' ? { youtube: { apiKey: keyIn.value } } : { [ch.platform]: { ...(keyIn.value.trim() ? { token: keyIn.value } : {}), ...(ch.platform === 'instagram' && igUser.value.trim() ? { userId: igUser.value } : {}) } };
    if (await guard(() => forge['channelsApisSet'](patch))) { toast('Credencial salva (cifrada)'); again(); }
  };
  const creds = h('details', { class: 'ch-creds' }, h('summary', { class: 'muted small' }, `🔑 API do ${st.platforms[ch.platform]?.label ?? ch.platform}: ${apiOk ? 'configurada ✓' : 'não configurada (usa o yt-dlp)'}`),
    ch.platform === 'kwai' ? h('p', { class: 'muted small' }, 'O Kwai não tem API pública de métricas: a análise usa a lista pública do perfil (melhor esforço). O token fica guardado para a API de parceiros.') : null,
    h('div', { class: 'row' }, keyIn, ch.platform === 'instagram' ? igUser : null, h('button', { class: 'small', onclick: () => void saveKey() }, 'Salvar'),
      h('button', { class: 'small', onclick: () => void forge['openUrl']?.(HELP[ch.platform] ?? HELP['youtube']!) }, '❔ Como obter')));
  return h('div', { class: 'ch-sec' }, h('h4', {}, '📊 Análise do canal'),
    h('div', { class: 'row' }, btn, h('label', { class: 'inline chk', title: 'Depois das métricas, a IA de texto escreve recomendações para este canal' }, aiCb, '🤖 com recomendações por IA')),
    report, creds,
    ch.cloneIds?.length ? h('div', { class: 'muted small' }, `🧬 ${ch.cloneIds.length} clone(s) de Pesquisar associado(s) a este canal`) : null);
}

function brandView(ch: ChannelView, c: ChannelsCtx, again: () => void): HTMLElement {
  const b = ch.brand ?? {};
  const { forge } = c;
  const colors = b.colors?.length ? b.colors : [];
  const swatches = h('div', { class: 'ch-colors' }, ...colors.map((col) => {
    const sw = h('span', { class: 'ch-swatch', title: col });
    sw.style.background = /^#[0-9a-f]{3,6}$/i.test(col) ? col : '#333';   // CSSOM: o atributo style é barrado pela CSP
    return sw;
  }));
  const copy = (txt?: string) => h('button', { class: 'small', title: 'Copiar', onclick: async () => { if (txt) { await forge['copyText']?.(txt); c.toast('Copiado'); } } }, '⧉');

  const assets = h('div', { class: 'ch-assets' });
  if (ch.hasAssets.banner && ch.assets?.banner) assets.append(h('figure', {}, h('img', { src: forge.mediaUrl(`${ch.dir}/${ch.assets.banner}`), alt: 'banner' }), h('figcaption', {}, 'Banner 2560×1440')));
  if (ch.hasAssets.avatar && ch.assets?.avatar) assets.append(h('figure', {}, h('img', { src: forge.mediaUrl(`${ch.dir}/${ch.assets.avatar}`), alt: 'avatar' }), h('figcaption', {}, 'Avatar')));
  if (ch.hasAssets.thumb && ch.assets?.thumb) assets.append(h('figure', {}, h('img', { src: forge.mediaUrl(`${ch.dir}/${ch.assets.thumb}`), alt: 'thumbnail modelo' }), h('figcaption', {}, 'Thumbnail modelo')));
  if (!assets.childNodes.length) assets.append(h('p', { class: 'muted' }, 'Banner e avatar são desenhados por código a partir das cores e do nome.'));

  return h('div', { class: 'ch-brand-body' },
    b.names?.length ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Nomes: '), h('b', {}, b.names.slice(0, 5).join(' · '))) : null,
    b.handle ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Handle: '), h('b', {}, b.handle)) : null,
    b.tagline ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Tagline: '), b.tagline) : null,
    b.tone ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Tom: '), b.tone) : null,
    colors.length ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Cores: '), swatches) : null,
    b.fonts ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Fontes: '), b.fonts) : null,
    b.keywords?.length ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Palavras-chave: '), b.keywords.join(', ')) : null,
    b.tags?.length ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Tags do canal: '), b.tags.join(', '), copy(b.tags.join(', '))) : null,
    b.description ? h('div', { class: 'ch-desc' }, h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Descrição'), copy(b.description)), h('p', { 'data-no-i18n': '' }, b.description)) : null,
    assets,
  );
}

function projectRow(c: ChannelsCtx, ch: ChannelView, p: ProjectRow, st: State, again: () => void): HTMLElement {
  const { forge, guard, toast } = c;
  const ready = st.ready.includes(ch.platform);
  const last = p.published.find((x) => x.platform === ch.platform);
  const vis = h('select', {}, ...[['UNLISTED', 'Não listado'], ['PRIVATE', 'Privado'], ['PUBLIC', 'Público']].map(([v, l]) => h('option', { value: v! }, l))) as HTMLSelectElement;
  const btn = h('button', { class: 'small primary' }, last ? '↻ Publicar de novo' : '📤 Publicar') as HTMLButtonElement;
  btn.disabled = !ready || !p.hasVideo;
  btn.addEventListener('click', async () => {
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Enviando…';
    try {
      const r = await guard(() => forge['channelsPublish'](ch.id, p.id, vis.value));
      if (r) { toast('Enviado'); again(); }
    } finally { btn.disabled = false; btn.textContent = old; }
  });
  return h('div', { class: 'ch-proj' },
    h('div', { class: 'ch-proj-name' }, h('b', {}, p.name), h('span', { class: 'muted' }, p.hasVideo ? 'vídeo pronto' : 'sem vídeo final')),
    last ? h('span', { class: 'ch-badge ok' }, `enviado ${new Date(last.at).toLocaleDateString()}`) : null,
    h('span', { class: 'sp' }), vis, btn,
    last?.url ? h('button', { class: 'small', onclick: () => void forge['openUrl']?.(last.url!) }, '↗') : null,
  );
}

/**
 * Cadastro guiado: 1) link do canal (obrigatório — a plataforma e o @ saem dele), 2) conta do navegador para a
 * autenticação, 3) tipo do canal. Depois de criar, o painel do canal segue com login → marca → identidade → análise.
 */
function openAdd(c: ChannelsCtx, st: State, again: () => void, initial?: string): void {
  const { forge, toast, guard } = c;
  const hint = initial && st.platforms[initial] ? initial : filter;
  const linkIn = h('input', { placeholder: hint === 'tiktok' ? 'https://www.tiktok.com/@perfil' : hint === 'instagram' ? 'https://www.instagram.com/perfil' : hint === 'facebook' ? 'https://www.facebook.com/suapagina' : hint === 'kwai' ? 'https://www.kwai.com/@perfil' : 'https://www.youtube.com/@seucanal' }) as HTMLInputElement;
  const detected = h('div', { class: 'ch-detect muted' }, 'Cole o link do canal ou perfil (YouTube, TikTok, Instagram, Facebook ou Kwai).');
  const nameIn = h('input', { placeholder: 'Nome (vazio = o @ do link; a marca sugere o definitivo)' }) as HTMLInputElement;
  const accSel = h('select', {}, h('option', { value: '' }, '— escolher depois —'), ...st.accounts.map((a) => h('option', { value: a.id }, `${a.label}${a.email ? ` (${a.email})` : ''}${a.hasProfile ? ' · com login' : ''}`))) as HTMLSelectElement;
  const typeSel = h('select', {}, h('option', { value: '' }, '— tipo do canal —'), ...(st.types ?? []).map((t) => h('option', { value: t.id, title: t.hint }, t.label))) as HTMLSelectElement;
  const typeHint = h('div', { class: 'muted small' });
  typeSel.addEventListener('change', () => { typeHint.textContent = (st.types ?? []).find((t) => t.id === typeSel.value)?.hint ?? ''; });
  let parsed: { platform: string; handle?: string; url: string } | undefined;
  let seq = 0;
  const check = async () => {
    const my = ++seq;
    const v = linkIn.value.trim();
    if (!v) { parsed = undefined; detected.textContent = 'Cole o link do canal ou perfil.'; detected.className = 'ch-detect muted'; return; }
    try {
      const r = await (forge['channelsParseLink'](v) as Promise<{ platform: string; handle?: string; url: string }>);
      if (my !== seq) return;
      parsed = r;
      const info = st.platforms[r.platform];
      detected.textContent = `${info?.icon ?? ''} ${info?.label ?? r.platform}${r.handle ? ` · ${r.handle}` : ''} — ${r.url}${st.ready.includes(r.platform) ? '' : ' (publicação em breve)'}`;
      detected.className = 'ch-detect ok';
    } catch (e) {
      if (my !== seq) return;
      parsed = undefined; detected.textContent = `⚠ ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`; detected.className = 'ch-detect warn';
    }
  };
  linkIn.addEventListener('input', () => void check());

  const bg = h('div', { class: 'ch-modal-bg' });
  const close = () => bg.remove();
  const box = h('div', { class: 'ch-modal' },
    h('h3', {}, 'Novo canal ou perfil'),
    h('ol', { class: 'ch-wizard muted small' }, h('li', {}, 'Link do canal (obrigatório)'), h('li', {}, 'Autenticação: você faz o login no navegador da conta'), h('li', {}, 'Tipo do canal → a IA sugere nome, descrição e tags'), h('li', {}, 'Marca e banner (pode recriar)'), h('li', {}, 'Thumbnail e paletas; análise de métricas')),
    h('div', { class: 'ch-grid' },
      h('label', { class: 'ch-wide' }, '1. Link do canal *', linkIn),
      h('div', { class: 'ch-wide' }, detected),
      h('label', { class: 'ch-wide' }, '2. Conta do navegador (autenticação)', accSel),
      h('label', { class: 'ch-wide' }, '3. Tipo do canal', typeSel),
      h('div', { class: 'ch-wide' }, typeHint),
      h('label', { class: 'ch-wide' }, 'Nome (opcional)', nameIn),
    ),
    h('p', { class: 'muted small' }, `Até ${st.max} canais/perfis. O login é sempre feito por você — o app nunca digita senha.`),
    h('div', { class: 'row' }, h('span', { class: 'sp' }),
      h('button', { class: 'small', onclick: close }, 'Cancelar'),
      h('button', { class: 'small primary', onclick: async () => {
        await check();
        if (!parsed) { toast('Cole um link válido de canal ou perfil', true); linkIn.focus(); return; }
        const r = await guard(() => forge['channelsAdd']({ link: linkIn.value, name: nameIn.value || undefined, accountId: accSel.value || undefined, type: typeSel.value || undefined }));
        const id = (r as { channel?: { id: string } } | undefined)?.channel?.id;
        if (!r || !id) return;
        close(); selected = id; filter = '';
        toast('Cadastrado — agora faça o login (Autenticação) e crie a marca');
        /* já abre o navegador da conta para a autenticação */
        if (accSel.value) await guard(() => forge['channelsOpenLogin'](id));
        again();
      } }, 'Cadastrar e autenticar'),
    ),
  );
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  bg.append(box);
  document.body.append(bg);
  linkIn.focus();
}

interface ChProduct { kind: 'info' | 'physical'; name: string; category?: string; platform?: string; priceRange?: string; commission?: string; why?: string; placement?: string; fit: number; links?: Array<{ label: string; url: string }>; chosen?: boolean; url?: string }
interface ChProducts { items: ChProduct[]; notes?: string; at: string; by?: string; source: 'ai' | 'clone'; cta?: { enabled: boolean; placement: 'middle' | 'end' | 'both'; max: number } }

/** Produtos para vender no canal: pesquisa por IA (tipo, marca, análise) ou importados do clone; os marcados viram CTA no roteiro. */
function productsSection(c: ChannelsCtx, ch: ChannelView & { products?: ChProducts }, again: () => void): HTMLElement {
  const { forge, guard, toast } = c;
  const cp = ch.products;
  const btn = h('button', { class: 'small primary' }, cp ? '↻ Pesquisar de novo' : '🛒 Sugerir produtos para vender') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = '⏳ a IA está pesquisando produtos do nicho…';
    try { if (await guard(() => forge['channelsProducts'](ch.id))) { toast('Produtos sugeridos'); again(); } }
    finally { btn.disabled = false; btn.textContent = cp ? '↻ Pesquisar de novo' : '🛒 Sugerir produtos para vender'; }
  });
  const imp = ch.cloneIds?.length ? h('button', { class: 'small', onclick: async () => { if (await guard(() => forge['channelsProductsImport'](ch.id))) { toast('Produtos do clone importados'); again(); } } }, '🧬 Importar do clone') : null;
  const set = async (patch: unknown, msg?: string) => { if (await guard(() => forge['channelsProductsSet'](ch.id, patch))) { if (msg) toast(msg); again(); } };
  const card = (p: ChProduct) => {
    const cb = h('input', { type: 'checkbox', title: 'usar no CTA dos roteiros deste canal' }) as HTMLInputElement; cb.checked = !!p.chosen;
    cb.addEventListener('change', () => void set({ chosen: { [p.name]: cb.checked } }, cb.checked ? `"${p.name}" entra no CTA` : undefined));
    const url = h('input', { value: p.url ?? '', placeholder: 'seu link (afiliado ou loja) — vai na descrição' }) as HTMLInputElement;
    url.addEventListener('change', () => void set({ urls: { [p.name]: url.value } }, url.value ? 'Link salvo' : 'Link removido'));
    return h('div', { class: `cl-prod${p.chosen ? ' chosen' : ''}` },
      h('div', { class: 'row' }, h('label', { class: 'inline chk' }, cb, h('strong', {}, p.name)), h('span', { class: 'sp' }), h('span', { class: 'fit', title: 'aderência ao canal' }, `${p.fit}/10`)),
      h('div', { class: 'muted small' }, [p.kind === 'info' ? '📚 infoproduto' : '📦 físico', p.category, p.platform, p.priceRange, p.commission && `comissão ${p.commission}`].filter(Boolean).join(' · ')),
      p.why ? h('div', { class: 'small' }, p.why) : null, p.placement ? h('div', { class: 'muted small' }, `🎬 ${p.placement}`) : null,
      url,
      h('div', { class: 'row' }, ...(p.links ?? []).map((l) => h('button', { class: 'small', onclick: () => void forge['openUrl']?.(l.url) }, `🔎 ${l.label}`)),
        h('span', { class: 'sp' }), h('button', { class: 'small', title: 'tirar da lista', onclick: () => void set({ remove: [p.name] }) }, '✕')));
  };
  const cta = cp?.cta ?? { enabled: true, placement: 'middle' as const, max: 1 };
  const on = h('input', { type: 'checkbox' }) as HTMLInputElement; on.checked = cta.enabled;
  const where = h('select', {}, ...[['middle', 'no meio (depois de uma recompensa)'], ['end', 'no fim'], ['both', 'meio + fim']].map(([v, l]) => h('option', { value: v!, ...(v === cta.placement ? { selected: true } : {}) }, l!))) as HTMLSelectElement;
  const max = h('select', {}, ...['1', '2', '3'].map((v) => h('option', { value: v, ...(Number(v) === cta.max ? { selected: true } : {}) }, `${v} por vídeo`))) as HTMLSelectElement;
  const saveCta = () => void set({ cta: { enabled: on.checked, placement: where.value, max: Number(max.value) } }, 'CTA salvo');
  on.addEventListener('change', saveCta); where.addEventListener('change', saveCta); max.addEventListener('change', saveCta);
  const chosen = cp?.items.filter((x) => x.chosen).length ?? 0;
  const info = cp?.items.filter((x) => x.kind === 'info') ?? [], phys = cp?.items.filter((x) => x.kind === 'physical') ?? [];
  return h('div', { class: 'ch-sec' }, h('h4', {}, '🛒 Produtos para vender'),
    h('p', { class: 'muted small' }, 'A IA sugere infoprodutos e produtos físicos a partir do tipo, da marca e da análise do canal (ou importe os do clone associado). Marque os que quer vender: eles entram como CTA no roteiro e na descrição de todo projeto deste canal. Os links 🔎 abrem a busca na loja — cole o SEU link de afiliado no campo.'),
    h('div', { class: 'row' }, btn, imp, cp ? h('span', { class: 'muted small' }, `${cp.source === 'clone' ? 'do clone' : 'pela IA'} · ${new Date(cp.at).toLocaleString()}${cp.by ? ` · ${cp.by}` : ''}`) : null),
    cp?.notes ? h('div', { class: 'small' }, `💡 ${cp.notes}`) : null,
    cp ? h('div', { class: 'row ch-cta' }, h('label', { class: 'inline chk' }, on, `📣 CTA no roteiro (${chosen} marcado${chosen === 1 ? '' : 's'})`), where, max) : null,
    cp && on.checked && !chosen ? h('div', { class: 'muted small' }, 'Marque ao menos um produto para o CTA entrar nos roteiros.') : null,
    info.length ? h('div', {}, h('h5', {}, '📚 Infoprodutos'), h('div', { class: 'cl-biz' }, ...info.map(card))) : null,
    phys.length ? h('div', {}, h('h5', {}, '📦 Produtos físicos'), h('div', { class: 'cl-biz' }, ...phys.map(card))) : null,
    !cp ? h('p', { class: 'muted' }, 'Ainda sem produtos.') : null);
}
