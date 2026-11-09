import { askConfirm } from './dialogs';

/*
 * Biblioteca → 📖 HISTÓRIAS: importar um romance/texto longo (colar ou abrir .txt/.md/.html). A IA extrai personagens,
 * relações, linha do tempo, cenários e objetos, preenche a Biblioteca e planeja a série em episódios (arco, batidas,
 * gancho, variações). Cada episódio abre o Novo projeto já preenchido.
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
interface Ctx { forge: Api; toast: (m: string, bad?: boolean) => void; main: HTMLElement; guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>; refresh: () => void; openEpisode?: (ep: unknown) => void }
interface Episode { n: number; title: string; summary: string; beats: string[]; cliffhanger?: string; characters: string[]; locations?: string[]; props?: string[]; variants?: Record<string, string>; projectId?: string }
interface Story {
  id: string; title: string; logline?: string; synopsis?: string; genre?: string; createdAt: string; sourceChars: number;
  characters: string[]; locations: string[]; props: string[]; relations: Array<{ a: string; b: string; type: string; note?: string }>;
  timeline: Array<{ order: number; event: string; chapter?: string; characters?: string[]; location?: string }>; arc?: string; episodeSec?: number; episodes: Episode[];
}

let openId: string | undefined;
let importing = false;

export async function renderStoriesTab(c: Ctx): Promise<void> {
  const { forge, guard, toast, main } = c;
  const list = ((await guard(() => forge['storyList']())) ?? []) as Story[];
  if (openId && !list.some((s) => s.id === openId)) openId = undefined;
  /* importar */
  const text = h('textarea', { rows: '6', placeholder: 'Cole aqui o romance, conto, capítulo ou roteiro longo (ou abra um arquivo .txt/.md/.html)…', id: 'story-text' }) as HTMLTextAreaElement;
  const title = h('input', { placeholder: 'Título (opcional — a IA sugere)' }) as HTMLInputElement;
  const eps = h('input', { type: 'number', min: '1', max: '60', value: '6', class: 'num' }) as HTMLInputElement;
  const sec = h('input', { type: 'number', min: '20', max: '600', step: '10', value: '90', class: 'num' }) as HTMLInputElement;
  const kind = h('select', {}, ...[['pessoa', '📷 Realista (dorama)'], ['cartoon', '🎨 Cartoon / anime'], ['codigo', '💻 Desenho por código'], ['animal', '🐾 Criaturas'], ['outro', '✨ Outro']].map(([v, l]) => h('option', { value: v! }, l!))) as HTMLSelectElement;
  const status = h('span', { class: 'muted small' });
  const run = (pickFile: boolean) => void guard(async () => {
    if (!pickFile && text.value.trim().length < 200) { toast('Cole um texto maior (pelo menos alguns parágrafos) ou abra um arquivo', true); return; }
    importing = true; status.textContent = '⏳ a IA está lendo a história trecho a trecho (pode levar vários minutos)…'; btn.disabled = true; fileBtn.disabled = true;
    try {
      const r = (await forge['storyImport']({ text: pickFile ? undefined : text.value, pickFile, title: title.value.trim() || undefined, episodes: Number(eps.value) || undefined, episodeSec: Number(sec.value) || undefined, kind: kind.value })) as
        { story: Story; created: string[]; updated: string[]; warnings: string[] } | null;
      if (!r) return;
      openId = r.story.id;
      toast(`"${r.story.title}": ${r.created.length} novo(s) na Biblioteca, ${r.story.episodes.length} episódio(s)`);
      for (const w of r.warnings.slice(0, 3)) toast(`⚠ ${w}`, true);
      c.refresh();
    } finally { importing = false; btn.disabled = false; fileBtn.disabled = false; status.textContent = ''; }
  });
  const btn = h('button', { class: 'primary', onclick: () => run(false) }, '📖 Importar texto colado') as HTMLButtonElement;
  const fileBtn = h('button', { onclick: () => run(true) }, '📄 Abrir arquivo e importar') as HTMLButtonElement;
  if (importing) { btn.disabled = true; fileBtn.disabled = true; status.textContent = '⏳ importando…'; }
  const importCard = h('details', { class: 'card', ...(list.length ? {} : { open: true }) },
    h('summary', {}, h('strong', {}, '＋ Importar romance ou texto longo')),
    h('div', { class: 'muted small' }, 'A IA lê o texto em trechos e extrai personagens (aparência, idade, voz, apelidos), relações, a linha do tempo, cenários e objetos; depois planeja a série: arco, episódios com batidas e gancho, e as variações dos personagens (roupa, idade). Tudo entra na Biblioteca — o que já existe só ganha apelidos e variações.'),
    text, h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Título', title), h('label', {}, 'Episódios', eps), h('label', {}, 'Duração de cada (s)', sec), h('label', {}, 'Estilo dos personagens', kind)),
    h('div', { class: 'row' }, btn, fileBtn, status, h('span', { class: 'sp' }), h('button', { class: 'small', onclick: () => void forge['storyCancel']() }, '⏹ Cancelar')));
  const cards = h('div', { class: 'story-list' }, ...list.map((s) => h('button', { class: `story-card${s.id === openId ? ' on' : ''}`, onclick: () => { openId = s.id; c.refresh(); } },
    h('b', {}, s.title), h('span', { class: 'muted small' }, `${s.genre ? `${s.genre} · ` : ''}${s.episodes.length} episódio(s) · ${s.characters.length} personagem(ns)`),
    h('span', { class: 'muted small' }, `${s.episodes.filter((e) => e.projectId).length} projeto(s) criado(s)`))));
  const cur = list.find((s) => s.id === openId);
  main.replaceChildren(importCard, list.length ? cards : h('p', { class: 'muted' }, 'Nenhuma história importada ainda.'), cur ? storyView(c, cur) : h('div', {}));
}

function storyView(c: Ctx, s: Story): HTMLElement {
  const { forge, guard, toast } = c;
  const chips = (names: string[], icon: string) => h('div', { class: 'row wrap' }, ...names.map((n) => h('span', { class: 'ch-badge' }, `${icon} ${n}`)));
  const episode = (e: Episode) => h('div', { class: 'card story-ep' },
    h('div', { class: 'row' }, h('strong', {}, `Ep. ${e.n} — ${e.title}`), h('span', { class: 'sp' }),
      e.projectId ? h('span', { class: 'tag done' }, '✓ projeto criado') : null,
      h('button', { class: 'small primary', onclick: () => void guard(async () => {
        const inp = await forge['storyEpisodeInput'](s.id, e.n) as Record<string, unknown>;
        if (!c.openEpisode) { toast('Abra pelo app', true); return; }
        c.openEpisode({ ...inp, storyId: s.id, n: e.n });
      }) }, e.projectId ? '🎬 Criar de novo' : '🎬 Criar projeto do episódio')),
    h('p', {}, e.summary),
    e.beats.length ? h('ol', { class: 'small' }, ...e.beats.map((b) => h('li', {}, b))) : null,
    e.cliffhanger ? h('div', { class: 'small' }, `🪝 Gancho: ${e.cliffhanger}`) : null,
    h('div', { class: 'muted small' }, [e.characters.length && `👥 ${e.characters.join(', ')}`, e.locations?.length && `🏞 ${e.locations.join(', ')}`, e.props?.length && `📦 ${e.props.join(', ')}`].filter(Boolean).join(' · ')),
    e.variants && Object.keys(e.variants).length ? h('div', { class: 'small' }, `👗 ${Object.entries(e.variants).map(([k, v]) => `${k}: ${v}`).join(' · ')}`) : null);
  return h('div', { class: 'story-view' },
    h('div', { class: 'row' }, h('h3', {}, `📖 ${s.title}`), h('span', { class: 'sp' }),
      h('button', { class: 'small danger', onclick: () => void guard(async () => {
        if (!await askConfirm(`Excluir a história "${s.title}"? Os personagens, cenários e objetos continuam na Biblioteca e os projetos ficam como estão.`)) return;
        await forge['storyDelete'](s.id); openId = undefined; toast('História excluída'); c.refresh();
      }) }, '🗑 Excluir história')),
    s.logline ? h('p', {}, h('b', {}, s.logline)) : null,
    s.synopsis ? h('p', { class: 'muted' }, s.synopsis) : null,
    s.arc ? h('p', { class: 'small' }, `🧭 Arco: ${s.arc}`) : null,
    h('div', { class: 'muted small' }, `${Math.round(s.sourceChars / 1000)} mil caracteres lidos · episódios de ~${s.episodeSec ?? 90} s`),
    h('h4', {}, '👥 Personagens'), chips(s.characters, '👤'),
    s.locations.length ? h('h4', {}, '🏞 Cenários') : null, s.locations.length ? chips(s.locations, '🏞') : null,
    s.props.length ? h('h4', {}, '📦 Objetos') : null, s.props.length ? chips(s.props, '📦') : null,
    s.relations.length ? h('details', {}, h('summary', {}, h('strong', {}, `🔗 Relações (${s.relations.length})`)),
      h('table', { class: 'story-rel' }, ...s.relations.map((r) => h('tr', {}, h('td', {}, r.a), h('td', { class: 'muted' }, r.type), h('td', {}, r.b), h('td', { class: 'muted small' }, r.note ?? ''))))) : null,
    s.timeline.length ? h('details', {}, h('summary', {}, h('strong', {}, `🕰 Linha do tempo (${s.timeline.length} eventos)`)),
      h('ol', { class: 'small story-tl' }, ...s.timeline.map((t) => h('li', {}, t.event, h('span', { class: 'muted' }, [t.chapter && ` · ${t.chapter}`, t.location && ` · 🏞 ${t.location}`, t.characters?.length && ` · ${t.characters.join(', ')}`].filter(Boolean).join(''))))) ) : null,
    h('h4', {}, `🎬 Episódios (${s.episodes.length})`),
    s.episodes.length ? h('div', {}, ...s.episodes.map(episode)) : h('p', { class: 'muted' }, 'A IA não planejou os episódios (veja os avisos). Importe de novo.'));
}
