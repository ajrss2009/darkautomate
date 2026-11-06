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

interface ChannelBrand { names?: string[]; handle?: string; tagline?: string; description?: string; keywords?: string[];
  colors?: string[]; fonts?: string; logoIdea?: string; bannerPrompt?: string; avatarPrompt?: string; tone?: string }
interface ChannelView {
  id: string; name: string; platform: string; accountId?: string; handle?: string; url?: string;
  brand?: ChannelBrand; assets?: { banner?: string; avatar?: string; thumb?: string };
  createdAt: string; lastPublishAt?: string;
  dir: string; hasBrand: boolean; hasAssets: { banner: boolean; avatar: boolean; thumb: boolean }; projects: number;
}
interface AccountRow { id: string; label: string; email?: string; hasProfile: boolean }
interface State {
  list: ChannelView[];
  platforms: Record<string, { label: string; icon: string; loginUrl: string }>;
  ready: string[];
  max: number;
  accounts: AccountRow[];
}
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
      ch.hasBrand ? h('span', { class: 'ch-badge ok' }, 'marca ✓') : h('span', { class: 'ch-badge' }, 'sem marca'),
      ch.accountId ? h('span', { class: 'ch-badge' }, 'conta ✓') : h('span', { class: 'ch-badge warn' }, 'sem conta'),
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

  const saveMeta = async () => {
    const r = await guard(() => forge['channelsUpdate'](ch.id, { name: nameIn.value, handle: handleIn.value, url: urlIn.value }));
    if (r) { toast('Canal atualizado'); again(); }
  };

  /* ── marca ── */
  const brandBox = h('div', { class: 'ch-brand' });
  if (ch.brand) brandBox.append(brandView(ch, c, again)); else brandBox.append(h('p', { class: 'muted' }, 'Ainda sem marca. A IA pode sugerir nome, handle, tagline, descrição, cores, fontes e os prompts de banner e avatar.'));

  const ideaIn = h('textarea', { rows: '3', placeholder: 'Descreva a ideia do canal: nicho, público, o que ele entrega e o tom (ex.: "canal de história da ciência para curiosos, tom direto, sem sensacionalismo")' }) as HTMLTextAreaElement;
  const noteIn = h('input', { placeholder: 'Observações (opcional): referências, restrições, nome preferido…' }) as HTMLInputElement;
  const prog = h('div', { class: 'ch-prog' });
  const logPre = h('pre', { class: 'ch-log' }) as HTMLPreElement;

  const genBtn = h('button', { class: 'primary' }, '✨ Gerar marca com IA') as HTMLButtonElement;
  genBtn.addEventListener('click', async () => {
    if (!ideaIn.value.trim()) { toast('Descreva a ideia do canal primeiro', true); return; }
    genBtn.disabled = true; prog.textContent = 'iniciando…'; logPre.textContent = '';
    (genBtn as HTMLElement).textContent = 'Gerando…';
    const off = (forge as unknown as { onEvent?: (cb: (e: { t: string; pct?: number; label?: string; line?: string; id?: string }) => void) => () => void }).onEvent?.((e) => {
      if (e.t === 'channel.brand-progress' && e.id === ch.id) { prog.textContent = `${e.label ?? ''} ${e.pct ?? 0}%`; }
      if (e.t === 'log' && e.line) { logPre.textContent += e.line + '\n'; logPre.scrollTop = logPre.scrollHeight; }
    });
    try {
      const r = await guard(() => forge['channelsBrand'](ch.id, { idea: ideaIn.value, name: nameIn.value || undefined, note: noteIn.value || undefined, platform: ch.platform }));
      if (r) {
        const warns = (r as { warnings?: string[] }).warnings ?? [];
        toast(warns.length ? `Marca criada com ${warns.length} aviso(s)` : 'Marca criada', warns.length > 0);
        off?.(); again();
      }
    } finally { off?.(); genBtn.disabled = false; (genBtn as HTMLElement).textContent = '✨ Gerar marca com IA'; }
  });

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
    h('div', { class: 'ch-sec' }, h('h4', {}, `${info.icon} Dados do ${noun(ch.platform)}`),
      h('div', { class: 'ch-grid' },
        h('label', {}, 'Nome', nameIn),
        h('label', {}, 'Handle', handleIn),
        h('label', {}, `URL do ${noun(ch.platform)}`, urlIn),
        h('label', {}, 'Conta (sessão)', accSel),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'small', onclick: saveMeta }, 'Salvar'),
        h('button', { class: 'small', onclick: async () => {
          const r = await guard(() => forge['channelsOpenLogin'](ch.id));
          if (r) toast('Abrindo o navegador da conta — faça o login e feche quando terminar');
        } }, '🔐 Abrir login'),
        h('button', { class: 'small', onclick: async () => {
          const ok = await askConfirm(`Remover o canal "${ch.name}" da lista? A pasta com a marca e as imagens fica no disco.`);
          if (!ok) return;
          const r = await guard(() => forge['channelsRemove'](ch.id));
          if (r) { toast('Canal removido'); again(); }
        } }, '🗑 Remover'),
      ),
    ),
    h('div', { class: 'ch-sec' }, h('h4', {}, '🎨 Marca'),
      brandBox,
      h('div', { class: 'ch-grid' }, h('label', { class: 'ch-wide' }, 'Ideia do canal', ideaIn), h('label', { class: 'ch-wide' }, 'Observações', noteIn)),
      h('div', { class: 'row' }, genBtn, prog),
      logPre.childNodes.length ? logPre : null,
    ),
    h('div', { class: 'ch-sec' }, h('h4', {}, '📤 Publicar'),
      ready ? null : h('p', { class: 'muted' }, `${info.label}: a publicação ainda não está implementada nesta versão. O cadastro, a marca e o vínculo com projetos já funcionam.`),
      projBox,
    ),
  );
  return h('div', { class: 'ch-detail' }, body);
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
  if (!assets.childNodes.length) assets.append(h('p', { class: 'muted' }, 'Banner e avatar são desenhados por código a partir das cores e do nome.'));

  return h('div', { class: 'ch-brand-body' },
    b.names?.length ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Nomes: '), h('b', {}, b.names.slice(0, 5).join(' · '))) : null,
    b.handle ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Handle: '), h('b', {}, b.handle)) : null,
    b.tagline ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Tagline: '), b.tagline) : null,
    b.tone ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Tom: '), b.tone) : null,
    colors.length ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Cores: '), swatches) : null,
    b.fonts ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Fontes: '), b.fonts) : null,
    b.keywords?.length ? h('div', { class: 'ch-line' }, h('span', { class: 'muted' }, 'Palavras-chave: '), b.keywords.join(', ')) : null,
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

function openAdd(c: ChannelsCtx, st: State, again: () => void, initial?: string): void {
  const { forge, toast, guard } = c;
  let platform = initial && st.platforms[initial] ? initial : (filter || Object.keys(st.platforms)[0] || 'youtube');
  const nameIn = h('input', { placeholder: 'Nome' }) as HTMLInputElement;
  const handleIn = h('input', { placeholder: '@seuhandle' }) as HTMLInputElement;
  const preview = h('span', { class: 'muted ch-url-prev' });
  const accSel = h('select', {}, h('option', { value: '' }, '— escolher depois —'), ...st.accounts.map((a) => h('option', { value: a.id }, `${a.label}${a.email ? ` (${a.email})` : ''}${a.hasProfile ? ' · com login' : ''}`))) as HTMLSelectElement;

  /* seletor visual de plataforma: um bloco colorido por rede */
  const title = h('h3', {});
  const picker = h('div', { class: 'ch-pick' });
  const paint = () => {
    title.textContent = platform === 'youtube' ? 'Novo canal do YouTube' : `Novo perfil do ${st.platforms[platform]?.label ?? platform}`;
    nameIn.placeholder = `Nome do ${noun(platform)}`;
    preview.textContent = profileUrl(platform, handleIn.value) ?? '';
    picker.replaceChildren(...Object.entries(st.platforms).map(([id, info]) => h('button', {
      class: `ch-pick-btn pl-${id}${id === platform ? ' on' : ''}`,
      onclick: () => { platform = id; paint(); },
    }, h('span', { class: 'ch-pick-ic' }, info.icon), h('span', {}, info.label),
      st.ready.includes(id) ? null : h('small', {}, 'publicação em breve'))));
  };
  handleIn.addEventListener('input', paint);
  paint();

  const bg = h('div', { class: 'ch-modal-bg' });
  const close = () => bg.remove();
  const box = h('div', { class: 'ch-modal' },
    title,
    h('p', { class: 'muted' }, `Até ${st.max} canais/perfis. A conta escolhida guarda a sessão do navegador — o login continua sendo feito por você.`),
    picker,
    h('div', { class: 'ch-grid' },
      h('label', {}, 'Nome', nameIn),
      h('label', {}, 'Handle (opcional)', handleIn),
      h('div', { class: 'ch-wide' }, preview),
      h('label', { class: 'ch-wide' }, 'Conta (Automações)', accSel),
    ),
    h('div', { class: 'row' }, h('span', { class: 'sp' }),
      h('button', { class: 'small', onclick: close }, 'Cancelar'),
      h('button', { class: 'small primary', onclick: async () => {
        if (!nameIn.value.trim()) { toast(`Dê um nome ao ${noun(platform)}`, true); return; }
        const r = await guard(() => forge['channelsAdd']({ name: nameIn.value, platform, accountId: accSel.value || undefined }));
        const id = (r as { channel?: { id: string } } | undefined)?.channel?.id;
        if (id && handleIn.value.trim()) {
          const hnd = handleIn.value.trim();
          await guard(() => forge['channelsUpdate'](id, { handle: hnd.startsWith('@') ? hnd : `@${hnd}` }));
        }
        if (r) { close(); selected = id; filter = ''; toast(platform === 'youtube' ? 'Canal criado' : 'Perfil criado'); again(); }
      } }, 'Criar'),
    ),
  );
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  bg.append(box);
  document.body.append(bg);
  nameIn.focus();
}
