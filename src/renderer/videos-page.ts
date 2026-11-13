import { YT_VIDEO_TYPES, ytTypeKeyword, ytVideoType } from '../shared/yt-video-types';
import { askConfirm, showMessage } from './dialogs';
import { modelingCoverage } from '../shared/modeling';
import { renderGapsPage } from './gaps-page';

/* Aba PESQUISAR: YouTube (vídeos que arrebentam, com pontuação e motivos) e TikTok, Instagram, Facebook e Kwai (sem API, pela página de busca). */

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
export interface VideosCtx {
  forge: Api; toast: (m: string, bad?: boolean) => void; main: HTMLElement;
  guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  /** abre o Novo projeto com uma ideia inspirada no vídeo (e, opcionalmente, a skill e a dobra já escolhidas) */
  newProject: (idea: string, skillId?: string, foldId?: string) => void;
  /** abre "Skill a partir de vídeos" com o link preenchido */
  skillFromVideo: (url: string, ai?: { harness: string; model: string }) => void;
  openSkills: () => void;
  openRoutes: () => void;
  /** abre um projeto já criado (a lacuna cria o projeto e leva direto para o editor) */
  openProject?: (id: string) => void;
}
interface Parts { outlier: number; velocity: number; engagement: number; small: number; young: number; language: number }
interface Video {
  id: string; title: string; url: string; thumb: string; channel: string; channelUrl?: string; subs?: number; views: number; likes?: number; comments?: number;
  ageDays?: number; channelAgeDays?: number; durationSec?: number; language?: string; searchLang: string; score: number; parts: Parts; reasons: string[];
  platform?: Platform;
}
interface Channel { platform?: Platform; channel: string; channelUrl?: string; subs?: number; channelAgeDays?: number; best: number; hits: number; languages: string[]; avgRatio: number }
interface Result { videos: Video[]; channels: Channel[]; engine: 'api' | 'yt-dlp' | 'browser'; warnings: string[]; platform?: Platform; loginWall?: boolean }

const LANGS: Array<[string, string]> = [['pt', '🇧🇷 Português'], ['en', '🇺🇸 Inglês'], ['es', '🇪🇸 Espanhol'], ['fr', '🇫🇷 Francês'], ['de', '🇩🇪 Alemão'], ['it', '🇮🇹 Italiano'],
  ['hi', '🇮🇳 Hindi'], ['ja', '🇯🇵 Japonês'], ['ko', '🇰🇷 Coreano'], ['ar', '🇸🇦 Árabe'], ['ru', '🇷🇺 Russo'], ['id', '🇮🇩 Indonésio'], ['tr', '🇹🇷 Turco']];
const PART_INFO: Array<[keyof Parts, string, number, string]> = [
  ['outlier', '🚀 Outlier', 35, 'views ÷ inscritos'], ['velocity', '⚡ Velocidade', 25, 'views por dia'], ['engagement', '❤️ Engajamento', 15, 'curtidas e comentários'],
  ['small', '🌱 Canal pequeno', 10, 'menos inscritos = mais mérito do vídeo'], ['young', '🆕 Canal novo', 10, 'idade do canal (precisa da chave da API)'], ['language', '🌐 Idioma', 5, 'idioma pedido'],
];
const fmt = (n?: number) => n === undefined ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} mil` : String(Math.round(n));
const durTxt = (s?: number) => s === undefined ? '' : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const tone = (n: number) => (n >= 70 ? 'hot' : n >= 45 ? 'warm' : n >= 25 ? 'ok' : 'cold');

/* todas as redes usam a MESMA aba (critérios, nota, canais, favoritos, clonar, criar skill); só a fonte muda */
type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'kwai';
const SITES: Record<Platform, { label: string; icon: string; note: string }> = {
  youtube: { label: 'YouTube', icon: '▶️', note: '' },
  tiktok: { label: 'TikTok', icon: '🎵', note: 'sem API: a busca do TikTok num navegador invisível + yt-dlp para views, curtidas e data (funciona sem login; com login traz mais resultados)' },
  instagram: { label: 'Instagram', icon: '📸', note: 'sem API: a busca do Instagram num navegador invisível — precisa de login (botão ao lado), feito por você numa janela do app' },
  facebook: { label: 'Facebook', icon: '📘', note: 'sem API: a busca de vídeos do Facebook num navegador invisível — precisa de login (botão ao lado), feito por você numa janela do app' },
  kwai: { label: 'Kwai', icon: '🎬', note: 'sem API: as páginas públicas de tema do Kwai num navegador invisível (melhor esforço)' },
};
const SEARCHABLE: Platform[] = ['youtube', 'tiktok', 'instagram', 'facebook'];
let tab: Platform = 'youtube';
/** Aba Lacunas (a fronteira ocupa o lugar do termo). */
let gapsMode = false;
const lastBy: Partial<Record<Platform, Result>> = {};
let last: Result | undefined;
const platOf = (v: { platform?: Platform }) => v.platform ?? 'youtube';
let form = { query: '', videoType: '', languages: ['pt', 'en', 'es'], period: 'month' as 'week' | 'month' | 'year' | 'any', perLanguage: 12, minViews: 0, maxSubs: 0, format: 'any' as 'any' | 'shorts' | 'long', translate: true };
let view: 'videos' | 'channels' | 'favorites' | 'clones' = 'videos';
let favs: Video[] = [];
const favSel = new Set<string>();
/* IA da pesquisa (traduzir, analisar resultados) — também é o padrão de "Clonar canal" e "Criar skill deste vídeo" */
const LOCAL_H = ['ollama', 'lmstudio', 'llamacpp'];
const VISION = /vl|vision|llava|gemma3|minicpm-v|flash|gemini|sonnet|opus|gpt-4o|gpt-5/i;
let ai: { harness: string; model: string } = (() => { try { return JSON.parse(localStorage.getItem('ff.finder.ai') ?? '') as { harness: string; model: string }; } catch { return { harness: '', model: '' }; } })();
const saveAi = () => { try { localStorage.setItem('ff.finder.ai', JSON.stringify(ai)); } catch { /* sem storage */ } };
let insights: Record<string, unknown> | undefined;
const MODEL_TIP = 'Qual modelo usar? Para INTERPRETAR VÍDEOS (Clonar canal, Criar skill deste vídeo) o modelo precisa enxergar imagens:\n' +
  '• Antigravity → gemini-3.8-flash-medium: recomendado — rápido, barato e lê bem quadros e thumbnails.\n' +
  '• Claude Code → sonnet (ou opus): análise mais detalhada e criativa (marca, dobras de nicho), mais lento.\n' +
  '• Ollama (local, grátis) → qwen3-vl:4b: funciona sem internet, mas a análise é mais simples.\n' +
  'Para traduzir a pesquisa e analisar os resultados qualquer modelo de texto serve (flash/haiku/sonnet ou um local).';
const isFav = (id: string) => favs.some((f) => f.id === id);

export async function renderVideosPage(c: VideosCtx): Promise<void> {
  const { main } = c;
  /* Kwai fora da pesquisa: as páginas públicas dele nunca devolvem vídeos (continua como plataforma de canal) */
  const tabs = h('div', { class: 'vf-tabs' }, ...(Object.keys(SITES) as Platform[]).filter((id) => SEARCHABLE.includes(id)).map((id) =>
    h('button', { class: `vf-tab${!gapsMode && tab === id ? ' on' : ''}`, 'data-tab-v': id, onclick: () => {
      if (id === tab && !gapsMode) return;
      if (last) lastBy[tab] = last;
      gapsMode = false;
      tab = id; last = lastBy[id]; insights = undefined;
      void renderVideosPage(c);
    } }, `${SITES[id].icon} ${SITES[id].label}`)),
    h('button', { class: `vf-tab${gapsMode ? ' on' : ''}`, 'data-tab-v': 'gaps', title: 'Pesquisa por fronteira: quantos estão servindo cada formato, com que confiança e por quê', onclick: () => {
      if (last) lastBy[tab] = last;
      gapsMode = true;
      void renderVideosPage(c);
    } }, '🧩 Lacunas'));
  if (gapsMode) { await renderGapsPage(c, tabs); return; }
  const site = SITES[tab];
  const yt = tab === 'youtube';
  favs = ((await c.guard(() => c.forge['finderFavorites']())) as Video[] | undefined) ?? [];
  const s = (await c.guard(() => c.forge['getSettings']())) as { stock?: { youtube?: { apiKey?: string } } } | undefined;
  const hasKey = !!s?.stock?.youtube?.apiKey;
  const q = h('input', { class: 'vf-q', id: 'vf-query', value: form.query, placeholder: 'Termo da pesquisa (opcional se escolher o tipo): abelhas, finanças pessoais, espaço…' }) as HTMLInputElement;
  q.addEventListener('input', () => { form.query = q.value; });
  const typeSel = h('select', { id: 'vf-type', class: 'vf-type', title: `Tipo de vídeo (opcional) — vira palavra-chave da busca no ${site.label}` }, h('option', { value: '' }, '🎬 Qualquer tipo de vídeo'),
    ...YT_VIDEO_TYPES.map((g) => h('optgroup', { label: g.label }, ...g.types.map((t) => h('option', { value: t.id }, `${t.icon} ${t.label}`))))) as HTMLSelectElement;
  typeSel.value = form.videoType;
  typeSel.addEventListener('change', () => { form.videoType = typeSel.value; });
  q.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void search(); });
  const langs = h('div', { class: 'vf-langs' }, ...LANGS.map(([id, label]) => h('button', { class: `chip${form.languages.includes(id) ? ' on' : ''}`, 'data-lang': id, onclick: () => {
    form.languages = form.languages.includes(id) ? form.languages.filter((x) => x !== id) : [...form.languages, id]; void renderVideosPage(c);
  } }, label)));
  const sel = (id: string, opts: Array<[string, string]>, v: string, on: (x: string) => void) => { const el = h('select', { id }, ...opts.map(([k, l]) => h('option', { value: k }, l))) as HTMLSelectElement; el.value = v; el.addEventListener('change', () => on(el.value)); return el; };
  const num = (id: string, v: number, on: (x: number) => void, ph: string) => { const el = h('input', { id, type: 'number', min: '0', class: 'num', value: v ? String(v) : '', placeholder: ph }) as HTMLInputElement; el.addEventListener('input', () => on(Number(el.value) || 0)); return el; };
  const tr = h('input', { type: 'checkbox', id: 'vf-translate' }) as HTMLInputElement; tr.checked = form.translate; tr.addEventListener('change', () => { form.translate = tr.checked; });
  const status = h('div', { class: 'muted', id: 'vf-status' });
  const results = h('div', { id: 'vf-results' });

  /* 🔥 Outliers: vídeos bombando em canais PEQUENOS, sem nicho (ignora termo e tipo; usa idiomas, período, formato e quantidade) */
  const outliers = async () => {
    if (!form.languages.length) return c.toast('Escolha ao menos um idioma.', true);
    status.textContent = `🔥 procurando vídeos que explodiram em canais pequenos (${yt ? 'YouTube' : site.label}, sem nicho)…`;
    await c.guard(async () => {
      const fq = { query: '', languages: form.languages, period: form.period, perLanguage: form.perLanguage, minViews: form.minViews || undefined, maxSubs: form.maxSubs || undefined, format: form.format, outliers: true };
      last = (yt ? await c.forge['finderSearch'](fq) : await c.forge['socialSearch'](tab, fq)) as Result;
      lastBy[tab] = last;
      if (last.loginWall) c.toast(`${site.label} pediu login — clique em "Entrar no ${site.label}" e tente de novo`, true);
      status.textContent = '';
      insights = undefined;
      if (view === 'favorites' || view === 'clones') view = 'videos';
      paint();
    });
    if (!last) status.textContent = '';
  };

  const search = async () => {
    const term = form.query.trim();
    if (!term && !form.videoType) return c.toast('Escreva o termo da pesquisa ou escolha um tipo de vídeo (ou use 🔥 Outliers, que não precisa de nicho).', true);
    if (!form.languages.length) return c.toast('Escolha ao menos um idioma.', true);
    status.textContent = yt ? '⏳ procurando e analisando os vídeos… (sem a chave da API leva 20–60 s por idioma)' : `⏳ abrindo a busca do ${site.label} e lendo os vídeos… (30–120 s por idioma)`;
    await c.guard(async () => {
      let queries: Record<string, string> | undefined;
      if (term && form.translate && form.languages.length > 1) { status.textContent = '🌐 traduzindo a pesquisa para cada idioma…'; queries = (await c.forge['finderTranslate'](term, form.languages, ai)) as Record<string, string>; }
      /* termo (traduzido) + o tipo de vídeo no idioma de cada busca; só o tipo também vale */
      if (form.videoType) queries = Object.fromEntries(form.languages.map((l) => [l, [queries?.[l] ?? term, ytTypeKeyword(form.videoType, l)].filter(Boolean).join(' ')]));
      status.textContent = '⏳ procurando e analisando os vídeos…';
      const fq = { query: [term, ytTypeKeyword(form.videoType, 'en')].filter(Boolean).join(' '), languages: form.languages, period: form.period, perLanguage: form.perLanguage, minViews: form.minViews || undefined, maxSubs: form.maxSubs || undefined, format: form.format, queries };
      last = (yt ? await c.forge['finderSearch'](fq) : await c.forge['socialSearch'](tab, fq)) as Result;
      lastBy[tab] = last;
      if (last.loginWall) c.toast(`${site.label} pediu login — clique em "Entrar no ${site.label}" e pesquise de novo`, true);
      status.textContent = '';
      insights = undefined;
      if (view === 'favorites' || view === 'clones') view = 'videos';
      paint();
    });
    if (!last) status.textContent = '';
  };

  const paint = () => {
    const switcher = h('div', { class: 'vf-switch' },
      h('button', { class: view === 'videos' ? 'on' : '', onclick: () => { view = 'videos'; paint(); } }, '🎬 Vídeos'),
      h('button', { class: view === 'channels' ? 'on' : '', onclick: () => { view = 'channels'; paint(); } }, '📺 Canais'),
      h('button', { class: view === 'favorites' ? 'on' : '', id: 'vf-view-fav', onclick: () => { view = 'favorites'; paint(); } }, `⭐ Favoritos (${favs.length})`),
      h('button', { class: view === 'clones' ? 'on' : '', id: 'vf-view-clones', onclick: () => { view = 'clones'; paint(); } }, '🧬 Canais clonados'));
    if (view === 'favorites') {
      for (const id of [...favSel]) if (!isFav(id)) favSel.delete(id);
      const removeSel = h('button', { class: 'small danger', id: 'vf-fav-remove', disabled: !favSel.size, onclick: () => void c.guard(async () => {
        if (!await askConfirm(`Remover ${favSel.size} vídeo(s) dos favoritos?`)) return;
        favs = (await c.forge['finderFavoritesRemove']([...favSel])) as Video[]; favSel.clear(); c.toast('Removido(s) dos favoritos'); paint(); }) }, `🗑 Remover selecionados${favSel.size ? ` (${favSel.size})` : ''}`);
      const all = h('button', { class: 'small', onclick: () => { if (favSel.size === favs.length) favSel.clear(); else favs.forEach((v) => favSel.add(v.id)); paint(); } }, favSel.size === favs.length && favs.length ? '☐ Desmarcar todos' : '☑ Selecionar todos');
      results.replaceChildren(h('div', { class: 'vf-summary' }, h('span', { class: 'tag' }, `⭐ ${favs.length} favorito(s)`), favs.length ? all : null, favs.length ? removeSel : null, h('span', { class: 'sp' }), switcher),
        favs.length ? h('div', { class: 'vf-grid' }, ...favs.map((v) => videoCard(c, v, paint, true))) : h('div', { class: 'card vf-empty' }, h('div', { class: 'vf-big' }, '⭐'), h('p', { class: 'muted' }, 'Marque ☆ nos vídeos para guardar aqui.')));
      return;
    }
    if (view === 'clones') {
      results.replaceChildren(h('div', { class: 'vf-summary' }, h('span', { class: 'sp' }), switcher), h('div', { id: 'vf-clones' }, h('div', { class: 'muted' }, '⏳')));
      void c.guard(async () => {
        const list = (await c.forge['channelList']()) as CloneResult[];
        const pending = ((await c.forge['channelPending']().catch(() => [])) ?? []) as Array<{ dir: string; url: string; name: string; startedAt?: string; ready: string[] }>;
        const folds = ((await c.forge['listFolds']().catch(() => [])) ?? []) as FoldRow[];
        const box = document.getElementById('vf-clones'); if (!box) return;
        const foldCard = folds.length ? h('div', { class: 'card', id: 'vf-folds' },
          h('div', { class: 'row' }, h('strong', { class: 'grow' }, `🧬 Dobras de nicho salvas (${folds.length})`), h('span', { class: 'muted small' }, 'persistentes · library/folds')),
          h('div', { class: 'muted small' }, 'A dobra é uma entidade do canal: escolher a ativa grava o bloco dela nas diretrizes da skill, e cada projeto criado com ela entra na contagem.'),
          h('div', { class: 'cl-bends' }, ...folds.map((f) => h('div', { class: `card cl-bend${f.chosen ? ' chosen' : ''}`, 'data-fold': f.id },
            h('div', { class: 'row' }, h('strong', { class: 'grow' }, f.name),
              h('span', { class: 'tag' }, f.channelName ?? f.channel), h('span', { class: `tag ${f.status === 'scaling' ? 'done' : f.status === 'retired' ? 'failed' : 'running'}` }, FOLD_STATUS[f.status]),
              f.chosen ? h('span', { class: 'tag done' }, '⭐ ativa') : null),
            f.angle ? h('div', { class: 'muted small' }, f.angle) : null,
            h('div', { class: 'muted small' }, `🎬 ${f.metrics?.projects ?? 0} projeto(s)${f.metrics?.lastUsedAt ? ` · último ${new Date(f.metrics.lastUsedAt).toLocaleDateString()}` : ''}${f.why ? ` · 💡 ${f.why}` : ''}`),
            h('div', { class: 'row' },
              h('button', { class: 'small', disabled: !!f.chosen, onclick: () => void c.guard(async () => { await c.forge['chooseFold'](f.id); await c.forge['applyFold'](f.id); c.toast(`Dobra ativa: ${f.name}`); paint(); }) }, '⭐ Ativar'),
              h('button', { class: 'small', title: 'Grava o bloco da dobra nas diretrizes da skill ligada a ela', onclick: () => void c.guard(async () => { await c.forge['applyFold'](f.id); c.toast(`Dobra "${f.name}" aplicada na skill`); }) }, '🧩 Aplicar na skill'),
              h('button', { class: 'small primary', onclick: () => void c.guard(async () => { await c.forge['chooseFold'](f.id); await c.forge['applyFold'](f.id); c.newProject(`Canal "${f.channelName ?? f.channel}" — ${f.name}: ${f.angle ?? ''}`, f.skillId, f.id); }) }, '＋ Novo projeto'),
              h('button', { class: 'small danger', onclick: () => void c.guard(async () => { if (!await askConfirm(`Excluir a dobra "${f.name}"? Ela sai da biblioteca (os projetos continuam existindo).`)) return; await c.forge['deleteFold'](f.id); c.toast('Dobra excluída'); paint(); }) }, '🗑')))))) : null;
        const pend = pending.length ? h('div', { class: 'card' }, h('strong', {}, '⏸ Clones interrompidos'), h('div', { class: 'muted small' }, 'Os vídeos já foram analisados: retomar não baixa nada de novo e só pede à IA o que faltou.'),
          ...pending.map((p) => h('div', { class: 'row' }, h('span', { class: 'grow' }, `🧬 ${p.name}`), h('span', { class: 'muted small' }, p.ready.length ? `pronto: ${p.ready.join(', ')}` : 'análise feita'),
            h('button', { class: 'small primary', 'data-resume': p.dir, onclick: () => void openCloneDialog(c, p.url, p.name, p.dir) }, '↻ Retomar')))) : null;
        const importBtn = h('div', { class: 'row' }, h('span', { class: 'muted small grow' }, `🧬 ${list.length} canal(is) clonado(s) · salvos no workspace (portáteis)`),
          h('button', { class: 'small', id: 'vf-clone-import', title: 'Importa um .ffclone exportado de outro Dark Automate (recria skill, rota, dobras e template)', onclick: () => void c.guard(async () => { const r = (await c.forge['channelImport']()) as CloneResult | null; if (r) { c.toast(`Clone importado: ${r.brand.names?.[0] ?? r.skill.name}`); paint(); } }) }, '⬆ Importar canal (.ffclone)'));
        box.replaceChildren(foldCard ?? '', pend ?? '', importBtn, list.length ? h('div', { class: 'vf-chgrid' }, ...list.map((r) => h('div', { class: 'card vf-ch' },
          r.files.banner ? h('img', { class: 'vf-clone-banner', src: c.forge.mediaUrl(r.files.banner), alt: '' }) : null,
          h('div', { class: 'row' }, h('strong', { class: 'grow' }, `🧬 ${r.brand.names?.[0] ?? r.skill.name}`), r.dna ? h('span', { class: 'tag done', title: 'Clone com DNA completo (visual, câmeras, roteiro, títulos, thumbnail, idiomas)' }, 'DNA v2') : h('span', { class: 'tag' }, 'v1')),
          h('div', { class: 'muted small' }, `formato de ${r.source.name} · dobra: ${r.bends[r.chosenBend]?.title ?? '—'}`),
          r.languages?.length ? h('div', { class: 'muted small' }, `🌐 ${r.languages.slice(0, 3).map((l) => `${langName(l.code)} ${l.score}/10`).join(' · ')}`) : null,
          h('div', { class: 'muted small' }, `${new Date(r.createdAt).toLocaleString()}${r.videos?.length ? ` · ${r.videos.length} vídeos analisados` : ''}`),
          h('div', { class: 'row' },
            h('button', { class: 'small primary', onclick: () => void openCloneReport(c, r) }, '📊 Ver relatório'),
            h('button', { class: 'small', title: 'Exportar .ffclone', onclick: () => void c.guard(async () => { const f = (await c.forge['channelExport'](r.id)) as string | null; if (f) c.toast(`Clone exportado: ${f}`); }) }, '📦'),
            h('span', { class: 'sp' }),
            h('button', { class: 'small danger', title: 'Excluir o clone (a skill, a rota e as dobras continuam na biblioteca)', onclick: () => void c.guard(async () => { if (!await askConfirm(`Excluir o clone "${r.brand.names?.[0] ?? r.skill.name}"? A skill, a rota e as dobras continuam na biblioteca.`)) return; await c.forge['channelDelete'](r.id); c.toast('Clone excluído'); paint(); }) }, '🗑')))))
          : h('div', { class: 'card vf-empty' }, h('div', { class: 'vf-big' }, '🧬'), h('p', { class: 'muted' }, 'Nenhum canal clonado ainda. Em 📺 Canais, use "🧬 Clonar canal".')));
      });
      return;
    }
    if (!last) { results.replaceChildren(h('div', { class: 'vf-summary' }, h('span', { class: 'sp' }), switcher), h('div', { class: 'card vf-empty' }, h('div', { class: 'vf-big' }, '🔥'), h('strong', {}, 'Encontre vídeos que estão arrebentando'),
      h('p', { class: 'muted' }, 'Digite um tema, escolha os idiomas e clique em Procurar. Cada vídeo ganha uma nota de 0 a 100 e a lista dos motivos do sucesso. Os melhores são os "outliers": muito mais views do que o tamanho do canal.'))); return; }
    const top = last.videos.filter((v) => v.score >= 45).length;
    const summary = h('div', { class: 'vf-summary' },
      h('span', { class: 'tag' }, `${last.videos.length} vídeos`), h('span', { class: 'tag hot' }, `🔥 ${top} com nota ≥ 45`), h('span', { class: 'tag' }, `📺 ${last.channels.length} canais`),
      h('span', { class: 'tag' }, last.engine === 'api' ? '🔑 YouTube Data API' : last.engine === 'browser' ? `🧭 ${site.label} pelo navegador (sem API)` : '🧰 yt-dlp (sem chave)'),
      h('button', { class: 'small primary', id: 'vf-insights', title: 'A IA escolhida lê os resultados e aponta tendências, fórmulas de título, formatos, oportunidades e ideias', onclick: (e) => void c.guard(async () => {
        const b = e.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = '⏳ analisando…';
        try { insights = (await c.forge['finderInsights']({ query: form.query, videoType: ytVideoType(form.videoType)?.label, platform: site.label, videos: last!.videos }, ai)) as Record<string, unknown>; paint(); }
        finally { b.disabled = false; b.textContent = '🧠 Analisar resultados com IA'; }
      }) }, '🧠 Analisar resultados com IA'), h('span', { class: 'sp' }),
      switcher);
    const listOf = (k: string) => (Array.isArray(insights?.[k]) ? (insights![k] as unknown[]).map(String) : []);
    const insightCard = insights ? h('div', { class: 'card vf-insights', id: 'vf-insights-card' },
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, '🧠 Análise da IA'), h('span', { class: 'muted small' }, String(insights['binding'] ?? '')), h('button', { class: 'small', onclick: () => { insights = undefined; paint(); } }, '✕')),
      insights['summary'] ? h('p', {}, String(insights['summary'])) : null,
      h('div', { class: 'cl-analysis' }, ...([['trends', '📈 Em alta'], ['titlePatterns', '🏷 Títulos que funcionam'], ['formats', '🎞 Formatos'], ['opportunities', '🎯 Oportunidades']] as Array<[string, string]>)
        .filter(([k]) => listOf(k).length).map(([k, l]) => h('div', { class: 'cl-an' }, h('strong', {}, l), h('ul', { class: 'cl-titles' }, ...listOf(k).map((x) => h('li', {}, x)))))),
      listOf('ideas').length ? h('div', {}, h('strong', {}, '💡 Ideias de vídeo'), h('div', { class: 'vf-ideas' }, ...listOf('ideas').map((x) => h('button', { class: 'small', title: 'Novo projeto com esta ideia', onclick: () => c.newProject(x) }, `＋ ${x}`)))) : null) : null;
    const warn = last.warnings.length ? h('div', { class: 'muted small' }, ...last.warnings.map((w) => h('div', {}, `ℹ️ ${w}`))) : null;
    const grid = view === 'videos'
      ? h('div', { class: 'vf-grid' }, ...last.videos.map((v) => videoCard(c, v, paint)))
      : h('div', { class: 'vf-chgrid' }, ...last.channels.map((ch) => h('div', { class: `card vf-ch ${tone(ch.best)}` },
        h('div', { class: 'row' }, h('strong', { class: 'grow' }, ch.channel), h('span', { class: `vf-score ${tone(ch.best)}` }, String(ch.best))),
        h('div', { class: 'muted small' }, `${SITES[ch.platform ?? 'youtube'].icon} ${fmt(ch.subs)} ${ch.platform && ch.platform !== 'youtube' ? 'seguidores' : 'inscritos'}${ch.channelAgeDays !== undefined ? ` · canal com ${ch.channelAgeDays < 365 ? `${Math.round(ch.channelAgeDays / 30)} meses` : `${(ch.channelAgeDays / 365).toFixed(1)} anos`}` : ''}`),
        h('div', { class: 'muted small' }, `${ch.hits} vídeo(s) na busca · views ≈ ${ch.avgRatio >= 10 ? Math.round(ch.avgRatio) : ch.avgRatio.toFixed(1)}× os inscritos · ${ch.languages.join(', ')}`),
        h('div', { class: 'row' }, ch.channelUrl ? h('button', { class: 'small', onclick: () => void c.forge['openUrl'](ch.channelUrl!) }, ch.platform && ch.platform !== 'youtube' ? '🔗 Abrir perfil' : '🔗 Abrir canal') : null, h('span', { class: 'sp' }),
          ch.channelUrl ? h('button', { class: 'small primary', 'data-clone': ch.channel, title: 'Analisa os últimos vídeos e cria um canal novo com o mesmo estilo e tipo de vídeo, com dobra de nicho', onclick: () => void openCloneDialog(c, ch.channelUrl!, ch.channel) }, '🧬 Clonar canal') : null))));
    results.replaceChildren(summary, insightCard ?? '', warn ?? '', grid);
  };

  const cat = ((await c.guard(() => c.forge['catalog']())) ?? { harnesses: [] }) as { harnesses: Array<{ id: string; models: string[]; defaultModel?: string }> };
  if (!ai.harness) { ai = { harness: cat.harnesses.some((x) => x.id === 'antigravity') ? 'antigravity' : 'auto', model: '' }; }
  const aiH = h('select', { id: 'vf-ai-harness' }, h('option', { value: 'auto' }, 'auto (primeiro disponível)'), ...cat.harnesses.map((x) => h('option', { value: x.id }, LOCAL_H.includes(x.id) ? `${x.id} (local)` : x.id))) as HTMLSelectElement;
  aiH.value = ai.harness;
  const aiM = h('select', { id: 'vf-ai-model' }) as HTMLSelectElement;
  const live: Record<string, string[]> = {};
  const paintAi = () => {
    const hid = aiH.value;
    if (LOCAL_H.includes(hid) && !live[hid]) { live[hid] = []; void c.forge['harnessModels'](hid).then((r: unknown) => { live[hid] = Array.isArray(r) ? (r as string[]) : []; if (aiH.value === hid) paintAi(); }).catch(() => {}); }
    const ms = [...new Set([...(cat.harnesses.find((x) => x.id === hid)?.models ?? []), ...(live[hid] ?? [])])];
    aiM.replaceChildren(h('option', { value: '' }, 'modelo padrão do provedor'), ...ms.map((m) => h('option', { value: m }, `${m}${VISION.test(m) ? ' 👁' : ''}`)));
    /* sem escolha: o recomendado (com visão) do provedor */
    if (!ai.model || !ms.includes(ai.model)) ai.model = (hid === 'antigravity' ? ms.find((m) => /flash-medium/.test(m)) ?? ms.find((m) => /flash/.test(m)) : undefined) ?? (hid === 'claude' ? ms.find((m) => m === 'sonnet') : undefined) ?? (LOCAL_H.includes(hid) ? ms.find((m) => /vl|vision|llava|gemma3/i.test(m)) : undefined) ?? '';
    aiM.value = ai.model; saveAi();
  };
  aiH.addEventListener('change', () => { ai = { harness: aiH.value, model: '' }; paintAi(); });
  aiM.addEventListener('change', () => { ai.model = aiM.value; saveAi(); });
  paintAi();
  const tipBox = h('pre', { class: 'muted small vf-tip', hidden: true }, MODEL_TIP);
  const aiRow = h('div', { class: 'row vf-ai' },
    h('label', { title: 'Usado para traduzir a pesquisa, analisar os resultados e como padrão em Clonar canal e Criar skill deste vídeo' }, '🧠 IA da pesquisa', aiH), h('label', {}, 'Modelo (👁 = enxerga imagens)', aiM),
    h('button', { class: 'small', id: 'vf-ai-tip', onclick: () => { tipBox.hidden = !tipBox.hidden; } }, '❔ Qual modelo usar?'));
  const keyRow = !yt
    ? h('div', { class: 'muted small vf-key' }, `${site.icon} ${site.note}. `,
      h('button', { class: 'small', id: 'vf-social-login', title: 'Abre uma janela do app com a sessão só da pesquisa; o login é feito por você (o app nunca vê a senha). Vale também para clonar perfis e criar skill de vídeos desta rede.',
        onclick: () => void c.guard(async () => { await c.forge['socialLogin'](tab); c.toast(`Faça o login no ${site.label} na janela que abriu e depois pesquise de novo`); }) }, `🔐 Entrar no ${site.label}`))
    : h('div', { class: 'muted small vf-key' }, hasKey ? '🔑 Usando a YouTube Data API (rápido, com idade do canal).' : '🧰 Sem chave: usa o yt-dlp (mais lento, sem idade do canal). ',
      hasKey ? null : h('button', { class: 'small', onclick: () => void c.forge['openUrl']('https://console.cloud.google.com/apis/library/youtube.googleapis.com') }, '🔑 Obter chave da API'),
      hasKey ? null : h('span', {}, ' e cole em Configurações → Bancos de mídia → YouTube.'));

  main.replaceChildren(
    h('h2', {}, '🔎 Pesquisar'), tabs,
    h('div', { class: 'card vf-form' },
      h('div', { class: 'row' }, q, typeSel, h('button', { class: 'primary', id: 'vf-search', onclick: () => void search() }, '🔍 Pesquisar'),
        h('button', { id: 'vf-outliers', title: `Vídeos que estão bombando em canais PEQUENOS, sem depender do nicho: buscas amplas nos idiomas marcados, só canais com até ${form.maxSubs || 100000} ${yt ? 'inscritos' : 'seguidores'} (campo "Máx.") e views ≥ 3× o tamanho do canal. Usa período, formato e quantidade.`,
          onclick: () => void outliers() }, '🔥 Outliers')),
      h('div', { class: 'muted small' }, 'Pesquise pelo termo, pelo tipo de vídeo ou pelos dois (ex.: "abelhas" + Documentário, ou só "Histórias de terror").'),
      h('div', { class: 'muted small' }, 'Idiomas (busca em cada um e compara):'), langs,
      h('div', { class: 'row' },
        h('label', {}, 'Publicados', sel('vf-period', [['week', 'na última semana'], ['month', 'no último mês'], ['year', 'no último ano'], ['any', 'em qualquer data']], form.period, (v) => { form.period = v as typeof form.period; })),
        h('label', {}, 'Formato', sel('vf-format', [['any', 'todos'], ['shorts', 'só Shorts (≤ 60 s)'], ['long', 'só vídeos longos']], form.format, (v) => { form.format = v as typeof form.format; })),
        h('label', {}, 'Vídeos por idioma', sel('vf-per', [['8', '8'], ['12', '12'], ['20', '20'], ['30', '30'], ['50', '50'], ['100', '100']], String(form.perLanguage), (v) => { form.perLanguage = Number(v); })),
        h('label', {}, 'Views mínimas', num('vf-minviews', form.minViews, (v) => { form.minViews = v; }, 'ex.: 10000')),
        h('label', {}, yt ? 'Máx. de inscritos' : 'Máx. de seguidores', num('vf-maxsubs', form.maxSubs, (v) => { form.maxSubs = v; }, 'ex.: 50000')),
        h('label', { class: 'inline chk', title: 'A IA de texto traduz a pesquisa com os termos que cada público usa' }, tr, '🌐 Traduzir a pesquisa para cada idioma (IA)')),
      aiRow, tipBox, keyRow, status),
    results);
  paint();
}

function videoCard(c: VideosCtx, v: Video, repaint: () => void, inFavs = false): HTMLElement {
  const pick = inFavs ? h('input', { type: 'checkbox', class: 'vf-pick', 'data-pick': v.id, title: 'Selecionar', checked: favSel.has(v.id) }) as HTMLInputElement : null;
  pick?.addEventListener('change', () => { if (pick.checked) favSel.add(v.id); else favSel.delete(v.id); repaint(); });
  const del = inFavs ? h('button', { class: 'small danger', 'data-unfav': v.id, title: 'Remover dos favoritos', onclick: () => void c.guard(async () => {
    favs = (await c.forge['finderFavoritesRemove']([v.id])) as Video[]; favSel.delete(v.id); c.toast('Removido dos favoritos'); repaint(); }) }, '🗑') : null;
  const star = h('button', { class: `vf-fav${isFav(v.id) ? ' on' : ''}`, 'data-fav': v.id, title: isFav(v.id) ? 'Tirar dos favoritos' : 'Guardar nos favoritos', onclick: (e) => { e.stopPropagation(); void c.guard(async () => {
    favs = (await c.forge['finderFavorite'](v)) as Video[]; c.toast(isFav(v.id) ? 'Guardado nos favoritos ⭐' : 'Removido dos favoritos'); repaint(); }); } }, isFav(v.id) ? '★' : '☆');
  const t = tone(v.score);
  const bars = h('div', { class: 'vf-bars', title: 'De onde vem a nota' }, ...PART_INFO.map(([k, label, max, tip]) => h('div', { class: 'vf-bar', title: `${label}: ${Math.round(v.parts[k])}/${max} — ${tip}` },
    h('span', { class: 'vf-bl' }, label), h('span', { class: 'vf-track' }, h('span', { class: `vf-fill ${k}`, style: `width:${Math.round((v.parts[k] / max) * 100)}%` })), h('span', { class: 'vf-bn' }, `${Math.round(v.parts[k])}`))));
  const perDay = v.ageDays ? v.views / Math.max(1, v.ageDays) : undefined;
  const p = platOf(v), site = SITES[p];
  const watch = () => void (p === 'youtube' ? c.forge['finderWatch'](v.id, v.title) : c.forge['socialWatch'](v.url));
  return h('div', { class: `card vf-card ${t}`, 'data-video': v.id },
    h('button', { class: 'vf-thumb', title: 'Assistir', onclick: watch },
      v.thumb ? h('img', { src: v.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'vf-big' }, site.icon), h('span', { class: `vf-score ${t}` }, String(v.score)), v.durationSec ? h('span', { class: 'vf-dur' }, durTxt(v.durationSec)) : null, h('span', { class: 'vf-play' }, '▶')),
    h('div', { class: 'row' }, pick, h('div', { class: 'vf-title grow' }, v.title), del ?? star),
    h('div', { class: 'muted small' }, `${p === 'youtube' ? '' : `${site.icon} `}${v.channel} · ${fmt(v.subs)} ${p === 'youtube' ? 'inscritos' : 'seguidores'}`),
    h('div', { class: 'vf-stats' },
      h('span', { class: 'tag' }, `👁 ${fmt(v.views)}`), v.ageDays !== undefined ? h('span', { class: 'tag' }, `📅 ${v.ageDays} d`) : null, perDay ? h('span', { class: 'tag' }, `⚡ ${fmt(perDay)}/dia`) : null,
      v.likes !== undefined ? h('span', { class: 'tag' }, `👍 ${fmt(v.likes)}`) : null, v.comments !== undefined ? h('span', { class: 'tag' }, `💬 ${fmt(v.comments)}`) : null,
      h('span', { class: 'tag' }, `🌐 ${(v.language ?? v.searchLang).slice(0, 2)}`)),
    bars,
    v.reasons.length ? h('details', { class: 'vf-why', open: v.score >= 45 }, h('summary', {}, '💡 Por que deu certo'), h('ul', {}, ...v.reasons.map((r) => h('li', {}, r)))) : null,
    h('div', { class: 'row' },
      h('button', { class: 'small', onclick: watch }, '▶ Assistir'),
      h('button', { class: 'small', onclick: () => void c.forge['openUrl'](v.url) }, `🔗 ${site.label}`),
      h('button', { class: 'small', 'data-skillvid': v.id, title: 'Abre "Skill a partir de vídeos" com este vídeo: a IA copia o estilo (nunca o conteúdo) e cria uma skill', onclick: () => c.skillFromVideo(v.url, ai) }, '🧠 Criar skill deste vídeo'),
      v.channelUrl ? h('button', { class: 'small', title: 'Clonar o formato deste canal com dobra de nicho', onclick: () => void openCloneDialog(c, v.channelUrl!, v.channel) }, '🧬 Clonar canal') : null,
      h('span', { class: 'sp' }),
      h('button', { class: 'small primary', title: 'Novo projeto com um tema inspirado neste vídeo (sem copiar)', onclick: () => c.newProject(`Vídeo inspirado no sucesso de "${v.title}" (${v.channel}). Motivos do sucesso: ${v.reasons.map((r) => r.replace(/^\S+\s/, '')).join(' ')} Crie uma abordagem original, sem copiar título, roteiro ou imagens.`) }, '💡 Criar vídeo inspirado')));
}

/* ───────── 🧬 Clonar canal (dobra de nicho) ───────── */
interface LangPick { code: string; score: number; why?: string; audience?: string; competition?: string; cpm?: string }
interface Bend { title: string; angle: string; why: string; audience?: string; exampleTitles?: string[]; languages?: LangPick[]; demand?: string; competition?: string; cpm?: string }
interface VMetrics { durationSec?: number; shots?: number; avgShotSec?: number; cutsPerMin?: number; words?: number; wpm?: number; wordsPerSentence?: number; questions?: number; secondPerson?: number; hook?: string;
  secPerFact?: number; jumpCutShare?: number; shotStdSec?: number;
  audio?: { lufs?: number; peakDb?: number; meanDb?: number; silenceRatio?: number; pauses?: number; avgPauseSec?: number; bassRatio?: number; musicLikely?: boolean } }
interface AnalyzedVideo { id: string; url?: string; title: string; views?: number; durationSec?: number; reason: string; ratio?: number; metrics?: VMetrics; sheet?: string; sheets?: string[]; audio?: VMetrics['audio']; frames?: string[] }
type DnaSection = Record<string, unknown>;
interface ProductIdea { kind: 'info' | 'physical'; name: string; category?: string; platform?: string; priceRange?: string; commission?: string; why?: string; placement?: string; fit: number; links?: Array<{ label: string; url: string }> }
interface CostEstimate { currency: string; perVideo: number; perMonth: number; total: number; videos: number; lines: Array<{ item: string; qty: string; cost: number }>; fixedPerMonth: number; assumptions: string[] }
interface CostInput { durationSec: number; wpm?: number; sceneSec?: number; videosPerMonth: number; months: number; engines?: Record<string, string>; laborMinPerVideo?: number; rates?: Record<string, number | string> }
interface Dna { visual?: DnaSection; artDirection?: DnaSection; camera?: DnaSection; editing?: DnaSection; script?: DnaSection; titles?: DnaSection; thumbnail?: DnaSection; narration?: DnaSection; music?: string;
  text?: DnaSection; audio?: DnaSection; soundtrack?: DnaSection }
interface CloneResult {
  id: string; dir: string; createdAt: string;
  source: { url: string; name: string; subs?: number; description?: string; avatar?: string; banner?: string };
  metrics: { subs?: number; listed: number; avgViews: number; medianViews: number; maxViews: number; topTitle?: string; avgDurationSec: number; shortsShare: number; viewsPerSub?: number; uploadsPerWeek?: number; avgTitleLen: number; titlesWithNumbers: number; titlesWithQuestion: number };
  recent: Array<{ id: string; title: string; views?: number; durationSec?: number; thumb?: string }>;
  analysis: Record<string, unknown>; bends: Bend[]; chosenBend: number;
  foldIds?: string[]; channelKey?: string;
  language?: { code: string; why?: string };
  brand: { names?: string[]; handle?: string; tagline?: string; description?: string; keywords?: string[]; colors?: string[]; fonts?: string; logoIdea?: string; bannerPrompt?: string; avatarPrompt?: string; tone?: string };
  thumbnail?: { name?: string; prompt?: string; layout?: string; rules?: string };
  demoIdea?: string;
  skill: { id: string; name: string; description: string; appearance?: string; aspect?: string; durationSec?: number; language?: string; formatDna?: Record<string, unknown> };
  route: { id: string; name: string };
  thumbnailTemplate?: { id: string; name: string };
  files: { banner?: string; thumb?: string; demo?: string };
  warnings: string[];
  linked?: { channelId: string; platform: string; name: string; at: string };
  business?: { products?: { info: ProductIdea[]; physical: ProductIdea[]; notes?: string; at: string; by?: string }; cost?: CostEstimate; costInput?: CostInput };
  videos?: AnalyzedVideo[]; measured?: VMetrics; titleStructure?: { summary: string; examples: string[] }; dna?: Dna; languages?: LangPick[];
  meta?: { schemaVersion: number; updatedAt: string; sync?: { rev: number; dirty: boolean; remoteId?: string } };
}
const ANALYSIS_LABEL: Record<string, string> = {
  format: '📦 Formato', videoType: '🎞 Tipo de vídeo', duration: '⏱ Duração', cadence: '📅 Cadência', hook: '🪝 Gancho', structure: '🧱 Estrutura', visualStyle: '🎨 Visual',
  typography: '🔤 Tipografia', camera: '🎥 Câmera', editing: '✂️ Edição', narration: '🎙 Narração', music: '🎵 Música', titlePatterns: '🏷 Títulos', thumbnailStyle: '🖼 Thumbnails', audience: '👥 Público',
};

/** Dobra persistida (library/folds) — o que a interface usa. */
interface FoldRow {
  id: string; name: string; channel: string; channelName?: string; angle?: string; why?: string; audience?: string; exampleTitles?: string[];
  skillId?: string; routeId?: string; chosen?: boolean; status: 'idea' | 'testing' | 'scaling' | 'retired';
  metrics?: { projects: number; lastUsedAt?: string; renders?: number };
  model?: { format?: string; text?: string; visual?: string; audio?: string; soundtrack?: string };
  subniches?: string[];
}
const FOLD_STATUS: Record<FoldRow['status'], string> = { idea: '💤 ideia', testing: '🧪 testando', scaling: '🚀 escalando', retired: '⚰️ aposentada' };
const foldSlug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

async function openCloneDialog(c: VideosCtx, url: string, name: string, resumeDir?: string): Promise<void> {
  const cat = ((await c.guard(() => c.forge['catalog']())) ?? { harnesses: [] }) as { harnesses: Array<{ id: string; models: string[] }> };
  const LOCAL = ['ollama', 'lmstudio', 'llamacpp'];
  const hs = ['auto', ...cat.harnesses.map((x) => x.id)];
  const harness = h('select', { id: 'cl-harness' }, ...hs.map((x) => h('option', { value: x }, x === 'auto' ? 'auto (primeiro disponível)' : LOCAL.includes(x) ? `${x} (local)` : x))) as HTMLSelectElement;
  harness.value = hs.includes(ai.harness) ? ai.harness : hs.includes('antigravity') ? 'antigravity' : 'auto';
  const model = h('select', { id: 'cl-model' }) as HTMLSelectElement;
  const localTip = h('div', { class: 'muted small', id: 'cl-local-tip' });
  /* modelos locais: a lista ao vivo do servidor (Ollama/LM Studio/llama.cpp), não só os carregados em Configurações */
  const live: Record<string, string[]> = {};
  const paintModels = () => {
    const hid = harness.value;
    if (LOCAL.includes(hid) && !live[hid]) { live[hid] = []; void c.forge['harnessModels'](hid).then((r: unknown) => { live[hid] = Array.isArray(r) ? (r as string[]) : ((r as { models?: string[] })?.models ?? []); if (harness.value === hid) paintModels(); }).catch(() => {}); }
    const ms = [...new Set([...(cat.harnesses.find((x) => x.id === hid)?.models ?? []), ...(live[hid] ?? [])])];
    model.replaceChildren(h('option', { value: '' }, 'modelo padrão do provedor'), ...ms.map((m) => h('option', { value: m }, m)));
    const vis = ms.find((m) => /vl|vision|llava|gemma3|minicpm-v|qwen2\.5vl|llama3\.2-vision/i.test(m));
    if (LOCAL.includes(harness.value) && vis) model.value = vis;
    if (harness.value === ai.harness && ai.model && ms.includes(ai.model)) model.value = ai.model;
    localTip.textContent = LOCAL.includes(harness.value) ? '🖥️ Modelo local: os quadros e as thumbnails vão como imagens (escolha um modelo com visão: gemma3, qwen2.5vl, llava…) e cada arquivo é pedido separadamente.' : '';
  };
  harness.addEventListener('change', paintModels); paintModels();
  const deep = h('select', { id: 'cl-deep', title: 'Mínimo 3: ~60% os vídeos que mais performaram (views ÷ mediana do canal) e o resto os mais recentes (estilo atual)' }, ...[3, 4, 5, 6, 8].map((n) => h('option', { value: String(n) }, `${n} vídeos`))) as HTMLSelectElement; deep.value = '4';
  /* progresso por etapa dentro da janela (o indicador global continua em qualquer tela) */
  const STAGES: Array<[string, string]> = [['list', '📋 Listar vídeos'], ['thumbs', '🖼 Thumbnails'], ['videos', '🎬 Vídeos: quadros, cortes, fala, folha de contato'], ['ai', '🧠 DNA pela IA'], ['save', '🧩 Skill, rota, dobras'], ['render', '🎨 Banner, thumb e demo']];
  const bar = h('div', { class: 'clone-ind-bar', id: 'cl-bar' }, h('span', { style: 'width:0%' }));
  const stageLbl = h('div', { class: 'muted small', id: 'cl-stage' });
  const stageList = h('div', { class: 'clone-ind-steps', id: 'cl-steps' });
  const prog = h('div', { class: 'card', id: 'cl-progress', style: 'display:none' }, bar, stageLbl, stageList);
  const paintProg = (st: { stage: string; pct: number; label: string }) => {
    prog.style.display = '';
    (bar.firstChild as HTMLElement).style.width = `${st.pct}%`;
    stageLbl.textContent = `${st.pct}% · ${st.label}`;
    const idx = STAGES.findIndex(([k]) => k === st.stage);
    stageList.replaceChildren(...STAGES.map(([, l], i) => h('span', { class: `clone-st${i < idx || st.stage === 'done' ? ' ok' : i === idx ? ' now' : ''}` }, l)));
  };
  const lang = h('select', { id: 'cl-lang' }, h('option', { value: '' }, '🤖 a IA sugere'), ...[['pt-BR', '🇧🇷 Português'], ['en', '🇺🇸 Inglês'], ['es', '🇪🇸 Espanhol'], ['fr', '🇫🇷 Francês'], ['de', '🇩🇪 Alemão'], ['it', '🇮🇹 Italiano'], ['hi', '🇮🇳 Hindi'], ['ja', '🇯🇵 Japonês']].map(([v, l]) => h('option', { value: v! }, l!))) as HTMLSelectElement;
  const note = h('input', { id: 'cl-note', class: 'grow', placeholder: 'Opcional: nicho que te interessa, público, restrições (ex.: "quero falar de finanças para jovens")' }) as HTMLInputElement;
  const log = h('pre', { class: 'pvtext svlog', id: 'cl-log' });
  const out = h('div', { id: 'cl-out' });
  let off: (() => void) | undefined;
  const close = () => { off?.(); bg.remove(); };
  const go = h('button', { class: 'primary', id: 'cl-go', onclick: () => void (async () => {
    go.setAttribute('disabled', ''); log.textContent = '';
    out.replaceChildren(h('div', { class: 'muted' }, '⏳ Listando os vídeos, baixando os mais recentes, extraindo quadros e transcrição e analisando o canal… leva alguns minutos. Os vídeos baixados são apagados no fim.'));
    off = (c.forge as unknown as { onEvent: (cb: (e: { t: string; stepId?: string; line?: string; stage?: string; pct?: number; label?: string }) => void) => () => void }).onEvent((e) => {
      if (e.t === 'log' && e.stepId === 'channel' && e.line) { log.textContent += e.line + '\n'; log.scrollTop = log.scrollHeight; }
      if (e.t === 'clone.progress' && e.stage) paintProg({ stage: e.stage, pct: e.pct ?? 0, label: e.label ?? '' });
    });
    try {
      const r = (await c.forge['channelClone']({ channelUrl: url, channelName: name, harness: harness.value, model: model.value || undefined, deep: Number(deep.value), language: lang.value || undefined, note: note.value, resumeDir })) as CloneResult;
      close(); c.toast(`Canal clonado: skill "${r.skill.name}"`); void openCloneReport(c, r);
    } catch (e) { out.replaceChildren(h('div', { class: 'tag failed' }, '⛔ ' + (e as Error).message)); }
    finally { go.removeAttribute('disabled'); off?.(); off = undefined; }
  })() }, '🧬 Clonar canal');
  const bg = h('div', { class: 'modal-bg', id: 'clone-modal' }, h('div', { class: 'modal pmodal' },
    h('div', { class: 'row' }, h('h3', {}, `🧬 Clonar o canal "${name}"`), h('span', { class: 'sp' }), h('button', { onclick: () => { void c.forge['channelCloneCancel']().catch(() => {}); close(); } }, '✕')),
    h('p', { class: 'muted' }, 'Extrai o DNA do canal: escolhe os vídeos que MAIS performaram (views ÷ mediana) e os mais recentes (mínimo 3), mede cortes por minuto, plano médio, ritmo da fala e gancho real, monta folhas de contato e a IA com visão descreve visual, direção de arte, câmeras, edição, roteiro, títulos e thumbnails. Cria um canal NOVO com o mesmo formato e DOBRA DE NICHO (10 ângulos, cada um com os melhores idiomas), ranking de idiomas, marca, banner, skill e rota com o DNA em cada etapa, template de thumbnail e um vídeo de 10 s. Copia o formato — nunca o conteúdo, a marca ou os personagens. O clone fica salvo no workspace (portátil) e pode ser exportado.'),
    h('div', { class: 'row' }, h('label', {}, 'Quem analisa (com visão)', harness), h('label', {}, 'Modelo', model), h('label', {}, 'Analisar a fundo', deep), h('label', {}, 'Idioma do canal novo', lang)),
    localTip,
    h('div', { class: 'row' }, note),
    h('div', { class: 'row actions pfoot' }, h('span', { class: 'muted small' }, url), h('span', { class: 'sp' }), go), prog,
    h('details', {}, h('summary', { class: 'muted small' }, 'registro detalhado'), log), out));
  document.body.append(bg);
}

const LANG_NAME: Record<string, string> = { 'pt-BR': '🇧🇷 Português', pt: '🇧🇷 Português', en: '🇺🇸 Inglês', es: '🇪🇸 Espanhol', fr: '🇫🇷 Francês', de: '🇩🇪 Alemão', it: '🇮🇹 Italiano', hi: '🇮🇳 Hindi', ja: '🇯🇵 Japonês', ko: '🇰🇷 Coreano', ar: '🇸🇦 Árabe', ru: '🇷🇺 Russo', id: '🇮🇩 Indonésio', tr: '🇹🇷 Turco', zh: '🇨🇳 Chinês', vi: '🇻🇳 Vietnamita', th: '🇹🇭 Tailandês', pl: '🇵🇱 Polonês', nl: '🇳🇱 Holandês' };
const langName = (code: string) => LANG_NAME[code] ?? LANG_NAME[code.split('-')[0]!] ?? code;

/** Seções do DNA do canal (esquema 2): vídeos analisados, medições, visual, câmera, roteiro, títulos, thumbnail e idiomas. */
function dnaSections(c: VideosCtx, r: CloneResult, sw: (cols: string[]) => HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const m = r.measured;
  const tile = (icon: string, label: string, value: string) => h('div', { class: 'cl-tile' }, h('span', { class: 'cl-ti' }, icon), h('strong', {}, value), h('span', { class: 'muted small' }, label));
  if (m && (m.avgShotSec || m.wpm)) out.push(h('h4', {}, '📏 Medido nos vídeos (sem IA)'), h('div', { class: 'cl-tiles' },
    m.avgShotSec ? tile('🎞', 'plano médio', `${m.avgShotSec} s`) : null, m.cutsPerMin !== undefined ? tile('✂️', 'cortes por minuto', String(m.cutsPerMin)) : null,
    m.wpm ? tile('🗣', 'palavras por minuto', String(m.wpm)) : null, m.wordsPerSentence ? tile('📝', 'palavras por frase', String(m.wordsPerSentence)) : null,
    m.secondPerson !== undefined ? tile('👉', 'fala com "você"', `${m.secondPerson}%`) : null, m.durationSec ? tile('⏱', 'duração analisada', durTxt(m.durationSec)) : null,
    m.secPerFact ? tile('🧠', 'segundos por fato novo', `${m.secPerFact} s`) : null, m.jumpCutShare !== undefined ? tile('⚡', 'takes < 1,5 s (jump cuts)', `${Math.round(m.jumpCutShare * 100)}%`) : null));
  if (r.videos?.length) out.push(h('h4', {}, `🎯 ${r.videos.length} vídeos analisados a fundo`), h('div', { class: 'dna-videos' }, ...r.videos.map((v) => {
    const au = v.audio ?? v.metrics?.audio;
    return h('div', { class: 'card dna-video' },
      v.sheet ? h('img', { src: c.forge.mediaUrl(v.sheet), alt: 'folhas a 1 quadro por segundo', title: `Folhas a 1 quadro/s${v.sheets?.length ? `: ${v.sheets.length} folhas de 12 s` : ''}` }) : null,
      h('strong', {}, v.title), h('div', { class: 'muted small' }, `${fmt(v.views)} views · ${v.reason}`),
      v.sheets?.length ? h('div', { class: 'muted small' }, `🖼 ${v.sheets.length} folhas a 1 quadro/s (12 s cada — ${v.sheets.length * 12} s cobertos)`) : null,
      v.metrics ? h('div', { class: 'pl-chips' }, h('span', { class: 'tag' }, `🎞 ${v.metrics.shots ?? '?'} planos`), h('span', { class: 'tag' }, `${v.metrics.avgShotSec ?? '?'} s/plano`),
        v.metrics.wpm ? h('span', { class: 'tag' }, `🗣 ${v.metrics.wpm} ppm`) : null, v.metrics.questions ? h('span', { class: 'tag' }, `❓ ${v.metrics.questions}`) : null) : null,
      au ? h('div', { class: 'pl-chips' },
        au.lufs !== undefined ? h('span', { class: 'tag' }, `🔊 ${au.lufs} LUFS`) : null,
        au.silenceRatio !== undefined ? h('span', { class: 'tag' }, `⏸ ${Math.round(au.silenceRatio * 100)}% silêncio`) : null,
        au.bassRatio !== undefined ? h('span', { class: 'tag' }, `🎵 grave ${Math.round(au.bassRatio * 100)}%`) : null,
        au.musicLikely ? h('span', { class: 'tag done' }, '🎧 trilha provável') : h('span', { class: 'tag' }, '🎙 voz seca')) : null,
      v.metrics?.hook ? h('div', { class: 'muted small' }, `🪝 "${v.metrics.hook}…"`) : null,
      h('button', { class: 'small', onclick: () => void c.forge['openUrl'](v.url ?? `https://www.youtube.com/watch?v=${v.id}`) }, v.url && !/youtube\.com/.test(v.url) ? '🔗 Abrir vídeo' : '🔗 YouTube'));
  })));
  const d = r.dna;
  if (d) {
    const one = (x: unknown): string => {
      if (x && typeof x === 'object' && !Array.isArray(x)) {
        const o = x as Record<string, unknown>;
        if (typeof o['name'] === 'string' && typeof o['pct'] === 'number') return `${o['name']} ${o['pct']}%${o['goal'] ? ` (${o['goal']})` : ''}`;
        return Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !Array.isArray(v)).map(([k, v]) => `${k}: ${String(v)}`).join(', ');
      }
      return typeof x === 'boolean' ? (x ? 'sim' : 'não') : x === undefined || x === null ? '' : String(x);
    };
    const txt = (x: unknown) => (Array.isArray(x) ? x.map(one).filter(Boolean).join(' · ') : one(x));
    const card = (title: string, rows: Array<[string, unknown]>, extra?: HTMLElement | null) => {
      const ok = rows.filter(([, v]) => txt(v));
      return ok.length || extra ? h('div', { class: 'dna-card' }, h('h5', {}, title), extra ?? null, ...ok.map(([k, v]) => h('div', { class: 'small' }, h('strong', {}, `${k}: `), h('span', { class: 'muted' }, txt(v))))) : null;
    };
    const pal = (x: unknown) => (Array.isArray(x) && x.length ? sw(x as string[]) : null);
    out.push(h('h4', {}, '🧬 DNA do formato'), h('div', { class: 'dna-grid' }, ...[
      card('🎨 Visual', [['Estilo', d.visual?.style], ['Papéis da paleta', d.visual?.['paletteRoles']], ['Estilo gráfico / B-roll', d.visual?.['graphicStyle']], ['Prompt base (IA)', d.visual?.['aiStylePrompt']],
        ['Luz', d.visual?.lighting], ['Cor', d.visual?.colorGrade], ['Composição', d.visual?.composition], ['Textura', d.visual?.texture]], pal(d.visual?.palette)),
      card('🖌 Direção de arte', [['Universo', d.artDirection?.world], ['Personagens', d.artDirection?.characters], ['Objetos', d.artDirection?.props], ['Tipografia', d.artDirection?.typography], ['Grafismos', d.artDirection?.graphics], ['Motivos', d.artDirection?.motifs], ['Faça', d.artDirection?.dos], ['Evite', d.artDirection?.donts]]),
      card('🎥 Câmeras', [['Planos', d.camera?.shots], ['Movimento', d.camera?.movement], ['Movimentos usados', d.camera?.['moves']], ['Snap zoom com SFX', d.camera?.['snapZoomSfx']], ['Lente simulada', d.camera?.['lens']], ['Profundidade de campo', d.camera?.['depthOfField']],
        ['Jump cuts', d.camera?.['jumpCuts']], ['Ângulos', d.camera?.angles], ['Lentes', d.camera?.lenses], ['Transições', d.camera?.transitions]]),
      card('✂️ Edição', [['Ritmo', d.editing?.pace], ['Quebras de padrão', d.editing?.patternInterrupts], ['B-roll', d.editing?.broll], ['Efeitos', d.editing?.sfx]]),
      card('📝 Roteiro', [['Gancho', d.script?.hook], ['Anatomia do gancho (15 s)', d.script?.['hookAnatomy']], ['1ª recompensa (s)', d.script?.['timeToRewardSec']], ['Modelo de atos', d.script?.['actModel']], ['Atos', d.script?.['acts']],
        ['Estrutura', d.script?.structure], ['Voz', d.script?.voice], ['Frases', d.script?.sentences], ['Linguagem / PNL', d.script?.['nlp']], ['Transições (função)', d.script?.['transitions']], ['Segundos por fato', d.script?.['secPerFact']],
        ['Retenção', d.script?.retention], ['CTA', d.script?.cta], ['Final', d.script?.ending], ['Exemplo de gancho', d.script?.sampleHook]]),
      card('🏷 Títulos', [['Fórmula', d.titles?.formula], ['Padrões', d.titles?.patterns], ['Medido', r.titleStructure?.summary], ['Faça', d.titles?.do], ['Evite', d.titles?.avoid]]),
      card('🖼 Thumbnail', [['Ponto focal', d.thumbnail?.focal], ['Texto', d.thumbnail?.text], ['Composição', d.thumbnail?.composition], ['Emoção', d.thumbnail?.emotion], ['Celular', d.thumbnail?.mobile], ['Evite', d.thumbnail?.avoid]], pal(d.thumbnail?.palette)),
      card('🔤 Texto na tela (1 quadro/s)', [['O que aparece', d.text?.onScreen], ['Tipografia', d.text?.typography], ['Família', d.text?.['family']], ['Contorno', d.text?.['outline']], ['Sombra', d.text?.['shadow']], ['Caixa', d.text?.['case']], ['Animação', d.text?.['animation']],
        ['Legendas', d.text?.captions], ['Destaque', d.text?.emphasis], ['Ritmo do texto', d.text?.pacing]]),
      card('🎧 Áudio', [['Voz', d.audio?.narration ?? d.narration?.voice], ['Processamento da voz', d.audio?.['voiceProcessing']], ['Loudness', d.audio?.loudness], ['Mix', d.audio?.mix], ['SFX', d.audio?.sfx], ['SFX por minuto', d.audio?.['sfxPerMin']], ['Tipo de SFX', d.audio?.['sfxKind']], ['Ritmo da fala', d.narration?.pace]]),
      card('🎵 Trilha sonora', [['Gênero', d.soundtrack?.genre], ['Clima', d.soundtrack?.mood], ['Andamento', d.soundtrack?.tempo], ['BPM', d.soundtrack?.['bpm']], ['Silêncio antes de revelações', d.soundtrack?.['silenceBeforeReveal']], ['Cortes no tempo', d.soundtrack?.['cutsOnBeat']],
        ['Por ato', d.soundtrack?.['genreByAct']], ['Instrumentos', d.soundtrack?.instruments], ['Entrada/saída', d.soundtrack?.entry], ['Resumo', d.music]]),
    ].filter((x): x is HTMLDivElement => !!x)));
    out.push(...modelingChecklist(r));
  }
  if (r.languages?.length) out.push(h('h4', {}, '🌐 Melhores idiomas para o canal novo'), h('div', { class: 'card' }, ...r.languages.map((l) => h('div', {},
    h('div', { class: 'dna-lang' }, h('strong', {}, langName(l.code)), h('div', { class: 'bar' }, h('span', { style: `width:${l.score * 10}%` })), h('span', {}, `${l.score}/10`)),
    h('div', { class: 'muted small' }, [l.why, l.audience && `público: ${l.audience}`, l.competition && `concorrência: ${l.competition}`, l.cpm && `CPM: ${l.cpm}`].filter(Boolean).join(' · '))))));
  return out;
}

/** Checklist da modelagem: o que foi medido, o que a IA descreveu, o que faltou — e onde entra na produção. */
function modelingChecklist(r: CloneResult): HTMLElement[] {
  const f = r.skill.formatDna as { transitions?: string[] } | undefined;
  const items = modelingCoverage(r.dna, r.measured as Record<string, unknown> | undefined, { phrases: f?.transitions });
  const missing = items.filter((x) => x.source === 'faltou').length;
  const groups = [...new Set(items.map((x) => x.group))];
  return [h('details', { class: 'card', open: missing > 0 },
    h('summary', {}, h('strong', {}, `✅ Checklist da modelagem: ${items.length - missing}/${items.length} itens`), missing ? h('span', { class: 'muted small' }, ` · ${missing} faltaram (clone de novo com um modelo com visão para completar)`) : null),
    h('div', { class: 'muted small' }, 'Só a ESTRUTURA do canal de referência vai para a produção; a identidade (marca, paleta, fontes, bordões) vem do seu canal.'),
    ...groups.map((g) => h('div', {}, h('h5', {}, g), ...items.filter((x) => x.group === g).map((x) => h('div', { class: 'small' },
      h('span', { class: `tag${x.source === 'faltou' ? ' running' : ' done'}` }, x.source === 'medido' ? '📏 medido' : x.source === 'IA' ? '🧠 IA' : '— faltou'), ' ',
      h('strong', {}, x.item), x.value ? h('span', { class: 'muted' }, `: ${x.value}`) : null, h('span', { class: 'muted small' }, ` → ${x.usedIn}`))))))];
}

/** Canal associado, produtos para vender e custo de criação dos vídeos. */
function businessSection(c: VideosCtx, r: CloneResult, reopen: (next: CloneResult) => void): HTMLElement {
  const box = h('div', { class: 'card' });
  /* canal do usuário (aba Canais): YouTube, TikTok, Facebook, Kwai ou Instagram */
  const linkSel = h('select', {}, h('option', { value: '' }, '— nenhum canal associado —')) as HTMLSelectElement;
  void (c.forge['channelsGet']() as Promise<{ list: Array<{ id: string; name: string; platform: string }>; platforms: Record<string, { icon: string; label: string }> }>).then((st) => {
    for (const ch of st.list) linkSel.append(h('option', { value: ch.id, ...(ch.id === r.linked?.channelId ? { selected: true } : {}) }, `${st.platforms[ch.platform]?.icon ?? ''} ${ch.name} (${st.platforms[ch.platform]?.label ?? ch.platform})`));
    if (!st.list.length) linkSel.append(h('option', { value: '', disabled: true }, 'cadastre um canal na aba Canais'));
  }).catch(() => {});
  linkSel.addEventListener('change', () => void c.guard(async () => {
    const next = (await c.forge['channelLink'](r.id, linkSel.value || null)) as CloneResult;
    c.toast(linkSel.value ? `Clone associado a "${next.linked?.name}" — a identidade desse canal vence a do formato` : 'Associação removida');
    reopen(next);
  }));
  /* produtos */
  const prods = r.business?.products;
  const prodCard = (p: ProductIdea) => h('div', { class: 'cl-prod' },
    h('span', { class: 'fit', title: 'aderência ao canal' }, `${p.fit}/10`), h('strong', {}, p.name),
    h('div', { class: 'muted small' }, [p.category, p.platform, p.priceRange, p.commission && `comissão ${p.commission}`].filter(Boolean).join(' · ')),
    p.why ? h('div', { class: 'small' }, p.why) : null, p.placement ? h('div', { class: 'muted small' }, `🎬 ${p.placement}`) : null,
    h('div', { class: 'row' }, ...(p.links ?? []).map((l) => h('button', { class: 'small', onclick: () => void c.forge['openUrl'](l.url) }, `🔎 ${l.label}`))));
  const prodBtn = h('button', { class: 'small primary' }, prods ? '↻ Pesquisar produtos de novo' : '🛒 Pesquisar produtos para vender') as HTMLButtonElement;
  prodBtn.addEventListener('click', () => void c.guard(async () => {
    prodBtn.disabled = true; prodBtn.textContent = '⏳ pesquisando (a IA busca produtos do nicho)…';
    try { reopen((await c.forge['channelProducts'](r.id, { harness: ai.harness, model: ai.model })) as CloneResult); }
    finally { prodBtn.disabled = false; prodBtn.textContent = '🛒 Pesquisar produtos para vender'; }
  }));
  /* custo */
  const ci = r.business?.costInput;
  const num = (v: number | undefined, step = '1') => h('input', { type: 'number', min: '0', step, value: v !== undefined ? String(v) : '' }) as HTMLInputElement;
  const dur = num(ci?.durationSec ?? (r.metrics.avgDurationSec || r.skill.durationSec || 60));
  const vpm = num(ci?.videosPerMonth ?? Math.max(1, Math.round((r.metrics.uploadsPerWeek ?? 2) * 4.3)));
  const months = num(ci?.months ?? 3);
  const labor = num(ci?.laborMinPerVideo ?? 0);
  const rates = ci?.rates ?? {};
  const cur = h('input', { value: String(rates['currency'] ?? 'USD'), class: 'num' }) as HTMLInputElement;
  const rate = (k: string, def: number) => num(typeof rates[k] === 'number' ? rates[k] as number : def, '0.001');
  const rText = rate('textPer1kTokens', 0.005), rTts = rate('ttsPer1kChars', 0.15), rImg = rate('imagePerUnit', 0.02), rVid = rate('videoPerSec', 0.05), rGpu = rate('gpuPerHour', 0.12), rLabor = rate('laborPerHour', 0), rFixed = rate('fixedPerMonth', 0);
  const engSel = (k: string, def: string) => { const s = h('select', {}, ...[['api', 'API paga'], ['local', 'GPU local'], ['free', 'assinatura/grátis'], ...(k === 'music' ? [['code', 'por código']] : [])].map(([v, l]) => h('option', { value: v!, ...(v === (ci?.engines?.[k] ?? def) ? { selected: true } : {}) }, l!))) as HTMLSelectElement; return s; };
  const eText = engSel('text', 'free'), eVoice = engSel('voice', 'local'), eImg = engSel('image', 'local'), eVid = engSel('video', 'local'), eMus = engSel('music', 'code');
  const est = r.business?.cost;
  const money = (n: number, cy: string) => `${cy} ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const calc = h('button', { class: 'small primary' }, '🧮 Calcular custo') as HTMLButtonElement;
  calc.addEventListener('click', () => void c.guard(async () => {
    const input: CostInput = { durationSec: Number(dur.value) || 60, videosPerMonth: Number(vpm.value) || 0, months: Number(months.value) || 1, laborMinPerVideo: Number(labor.value) || 0,
      engines: { text: eText.value, voice: eVoice.value, image: eImg.value, video: eVid.value, music: eMus.value },
      rates: { currency: cur.value.trim() || 'USD', textPer1kTokens: Number(rText.value), ttsPer1kChars: Number(rTts.value), imagePerUnit: Number(rImg.value), videoPerSec: Number(rVid.value), gpuPerHour: Number(rGpu.value), laborPerHour: Number(rLabor.value), fixedPerMonth: Number(rFixed.value) } };
    reopen((await c.forge['channelCost'](r.id, input)) as CloneResult);
  }));
  const lbl = (t: string, el: HTMLElement) => h('label', {}, t, el);
  box.append(...([
    h('h4', {}, '📺 Canal associado'),
    h('div', { class: 'muted small' }, 'Associe este clone a um canal seu (YouTube, TikTok, Facebook, Kwai ou Instagram). A marca, a paleta e a tipografia desse canal entram nos projetos; do clone vem só a estrutura.'),
    h('div', { class: 'row' }, linkSel, r.linked ? h('span', { class: 'tag done' }, `🔗 ${r.linked.name}`) : null),
    h('h4', {}, '🛒 Produtos para vender no canal'),
    h('div', { class: 'row' }, prodBtn, prods ? h('span', { class: 'muted small' }, `pesquisado em ${new Date(prods.at).toLocaleString()}${prods.by ? ` por ${prods.by}` : ''}`) : null),
    prods?.notes ? h('div', { class: 'small' }, `💡 ${prods.notes}`) : null,
    prods?.info.length ? h('div', {}, h('h5', {}, '📚 Infoprodutos'), h('div', { class: 'cl-biz' }, ...prods.info.map(prodCard))) : null,
    prods?.physical.length ? h('div', {}, h('h5', {}, '📦 Produtos físicos'), h('div', { class: 'cl-biz' }, ...prods.physical.map(prodCard))) : null,
    prods ? h('div', { class: 'muted small' }, 'Os links abrem a BUSCA na loja (o app não inventa URL de produto). Confira as regras de afiliado de cada plataforma.') : null,
    h('h4', {}, '💰 Custo de criação dos vídeos'),
    h('div', { class: 'cl-cost' },
      h('div', { class: 'row' }, lbl('Duração (s)', dur), lbl('Vídeos/mês', vpm), lbl('Meses', months), lbl('Trabalho/vídeo (min)', labor), lbl('Moeda', cur)),
      h('div', { class: 'row' }, lbl('Texto', eText), lbl('Voz', eVoice), lbl('Imagem', eImg), lbl('Vídeo', eVid), lbl('Trilha', eMus)),
      h('details', {}, h('summary', { class: 'muted small' }, 'preços (por unidade)'),
        h('div', { class: 'row' }, lbl('Texto /1k tokens', rText), lbl('Voz /1k caracteres', rTts), lbl('Imagem', rImg), lbl('Vídeo IA /s', rVid), lbl('GPU /hora', rGpu), lbl('Trabalho /hora', rLabor), lbl('Fixo /mês', rFixed))),
      h('div', { class: 'row' }, calc),
      est ? h('div', {},
        h('div', { class: 'cl-tiles' },
          h('div', { class: 'cl-tile' }, h('span', { class: 'cl-ti' }, '🎬'), h('strong', {}, money(est.perVideo, est.currency)), h('span', { class: 'muted small' }, 'por vídeo')),
          h('div', { class: 'cl-tile' }, h('span', { class: 'cl-ti' }, '📅'), h('strong', {}, money(est.perMonth, est.currency)), h('span', { class: 'muted small' }, 'por mês')),
          h('div', { class: 'cl-tile' }, h('span', { class: 'cl-ti' }, '💰'), h('strong', {}, money(est.total, est.currency)), h('span', { class: 'muted small' }, `total (${est.videos} vídeos)`))),
        h('table', {}, ...est.lines.map((l) => h('tr', {}, h('td', {}, l.item), h('td', { class: 'muted' }, l.qty), h('td', {}, money(l.cost, est.currency))))),
        ...est.assumptions.map((a) => h('div', { class: 'muted small' }, `• ${a}`))) : h('div', { class: 'muted small' }, 'Os padrões saem da rota do clone (quem gera texto, voz, imagem e vídeo) e do DNA (duração, palavras por minuto, take médio). Ajuste e calcule.')),
  ] as Array<HTMLElement | null>).filter((x): x is HTMLElement => !!x));
  return box;
}

async function openCloneReport(c: VideosCtx, r: CloneResult): Promise<void> {
  const close = () => bg.remove();
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); c.toast('Copiado'); };
  const m = r.metrics;
  const tile = (icon: string, label: string, value: string) => h('div', { class: 'cl-tile' }, h('span', { class: 'cl-ti' }, icon), h('strong', {}, value), h('span', { class: 'muted small' }, label));
  const brandName = r.brand.names?.[0] ?? r.skill.name;
  /* garante as dobras persistidas (clones antigos não têm foldIds no result.json) */
  const folds = ((await c.forge['ensureFolds']({
    channel: r.channelKey ?? foldSlug(brandName) ?? 'canal', channelName: brandName, sourceChannel: r.source.name, sourceUrl: r.source.url,
    skillId: r.skill.id, routeId: r.route.id, language: r.language?.code, aspect: r.skill.aspect, bends: r.bends, chosen: r.chosenBend,
  }).catch(() => [])) ?? []) as FoldRow[];
  const foldAt = (i: number) => folds[i] ?? folds.find((f) => f.name === r.bends[i]?.title);
  const useFold = async (f: FoldRow, then?: () => void) => {
    await c.forge['chooseFold'](f.id);
    await c.forge['applyFold'](f.id);
    c.toast(`Dobra ativa: ${f.name}`);
    then?.();
  };
  const bendIdea = (b: Bend) => `Canal "${brandName}" — ${b.title}: ${b.angle}${b.exampleTitles?.[0] ? ` Ex.: "${b.exampleTitles[0]}".` : ''}`;
  const analysis = Object.entries(r.analysis).filter(([, v]) => typeof v === 'string' && v.trim());
  const palette = Array.isArray(r.analysis['palette']) ? (r.analysis['palette'] as string[]) : [];
  const success = Array.isArray(r.analysis['successFactors']) ? (r.analysis['successFactors'] as string[]) : [];
  const sw = (cols: string[]) => h('div', { class: 'cl-swatches' }, ...cols.map((x) => h('span', { class: 'cl-sw', style: `background:${/^#[0-9a-f]{3,8}$/i.test(x) ? x : '#888'}`, title: x }, x)));
  const produce = h('button', { class: 'primary', id: 'cl-produce', title: 'Cria um projeto de 10 s com a skill e a rota do canal e executa a rota', onclick: () => void c.guard(async () => {
    const p = (await c.forge['createProject']({ name: `${brandName} — demo 10 s`, idea: r.demoIdea || bendIdea(r.bends[r.chosenBend] ?? { title: brandName, angle: '', why: '' }), videoType: r.skill.appearance ?? 'custom',
      skillId: r.skill.id, routeId: r.route.id, aspect: r.skill.aspect, targetDurationSec: 10, language: r.language?.code || r.skill.language,
      foldId: foldAt(r.chosenBend)?.id })) as { id: string };
    await c.forge['run'](p.id); c.toast('Projeto de 10 s criado e em produção (veja em Projetos/Execução).');
  }) }, '🎬 Produzir 10 s com a rota');
  const bg = h('div', { class: 'modal-bg', id: 'clone-report' }, h('div', { class: 'modal cl-report' },
    h('div', { class: 'row' }, h('h3', {}, `🧬 ${brandName}`), h('span', { class: 'muted' }, ` formato de ${r.source.name}`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
    r.files.banner ? h('img', { class: 'cl-banner', src: c.forge.mediaUrl(r.files.banner), alt: 'banner' }) : null,
    h('div', { class: 'cl-tiles' },
      tile('👥', 'inscritos (origem)', fmt(m.subs)), tile('👁', 'média de views', fmt(m.avgViews)), tile('📈', 'mediana', fmt(m.medianViews)), tile('🏆', 'recorde', fmt(m.maxViews)),
      tile('⏱', 'duração média', durTxt(m.avgDurationSec)), tile('📱', 'Shorts', `${Math.round(m.shortsShare * 100)}%`),
      m.viewsPerSub !== undefined ? tile('🔁', 'views por inscrito', `${m.viewsPerSub}×`) : null, m.uploadsPerWeek !== undefined ? tile('📅', 'vídeos/semana', String(m.uploadsPerWeek)) : null,
      tile('🔤', 'caracteres no título', String(m.avgTitleLen)), tile('🔢', 'títulos com número', `${Math.round(m.titlesWithNumbers * 100)}%`)),
    h('h4', {}, '🔬 O que faz o canal funcionar'),
    h('div', { class: 'cl-analysis' }, ...analysis.map(([k, v]) => h('div', { class: 'cl-an' }, h('strong', {}, ANALYSIS_LABEL[k] ?? k), h('div', { class: 'muted' }, String(v))))),
    palette.length ? h('div', {}, h('strong', {}, '🎨 Paleta observada '), sw(palette)) : null,
    success.length ? h('ul', { class: 'cl-success' }, ...success.map((x) => h('li', {}, `✅ ${x}`))) : null,
    r.recent.some((x) => x.thumb) ? h('div', { class: 'cl-thumbs' }, ...r.recent.filter((x) => x.thumb).slice(0, 8).map((x) => h('img', { src: c.forge.mediaUrl(x.thumb!), title: `${x.title} · ${fmt(x.views)} views`, alt: '' }))) : null,
    ...dnaSections(c, r, sw),
    h('h4', {}, `🔀 ${r.bends.length} dobras de nicho · salvas no workspace`),
    h('div', { class: 'muted small' }, 'Cada dobra é um SUBNICHO vizinho (não uma cópia do canal): a escolhida vira o canal novo; as outras ficam como alternativas para explorar. A modelagem (texto na tela, visual, áudio e trilha) fica gravada em cada dobra.'),
    (() => { const f = foldAt(r.chosenBend); return f?.model ? h('div', { class: 'card cl-model' },
      h('strong', {}, `🧬 Modelagem da dobra escolhida — ${f.name}`),
      f.model.format ? h('div', { class: 'small' }, h('strong', {}, '📦 Formato: '), h('span', { class: 'muted' }, f.model.format)) : null,
      f.model.text ? h('div', { class: 'small' }, h('strong', {}, '🔤 Texto: '), h('span', { class: 'muted' }, f.model.text)) : null,
      f.model.visual ? h('div', { class: 'small' }, h('strong', {}, '🎨 Visual: '), h('span', { class: 'muted' }, f.model.visual)) : null,
      f.model.audio ? h('div', { class: 'small' }, h('strong', {}, '🎧 Áudio: '), h('span', { class: 'muted' }, f.model.audio)) : null,
      f.model.soundtrack ? h('div', { class: 'small' }, h('strong', {}, '🎵 Trilha: '), h('span', { class: 'muted' }, f.model.soundtrack)) : null,
      f.subniches?.length ? h('div', { class: 'small' }, h('strong', {}, '🔁 Outros subnichos: '), h('span', { class: 'muted' }, f.subniches.join(' · '))) : null) : null; })(),
    h('div', { class: 'cl-bends' }, ...r.bends.map((b, i) => {
      const f = foldAt(i) ?? folds.find((x) => x.name === b.title);
      return h('div', { class: `card cl-bend${i === r.chosenBend ? ' chosen' : ''}`, 'data-bend': String(i) },
        h('div', { class: 'row' }, h('span', { class: 'cl-n' }, String(i + 1)), h('strong', { class: 'grow' }, b.title),
          i === r.chosenBend ? h('span', { class: 'tag done' }, '⭐ dobra da skill') : null,
          f?.metrics?.projects ? h('span', { class: 'tag' }, `🎬 ${f.metrics.projects} projeto(s)`) : null),
        h('div', {}, b.angle), h('div', { class: 'muted small' }, `💡 ${b.why}`), b.audience ? h('div', { class: 'muted small' }, `👥 ${b.audience}`) : null,
        b.demand || b.competition || b.cpm || b.languages?.length ? h('div', { class: 'pl-chips' },
          b.demand ? h('span', { class: 'tag' }, `📈 demanda ${b.demand}`) : null, b.competition ? h('span', { class: 'tag' }, `⚔️ concorrência ${b.competition}`) : null, b.cpm ? h('span', { class: 'tag' }, `💰 CPM ${b.cpm}`) : null,
          ...(b.languages ?? []).map((l) => h('span', { class: 'tag done', title: l.why ?? '' }, `${langName(l.code)} ${l.score}/10`))) : null,
        b.exampleTitles?.length ? h('ul', { class: 'cl-titles' }, ...b.exampleTitles.map((t) => h('li', {}, t))) : null,
        h('div', { class: 'row' },
          f ? h('button', { class: 'small', title: 'Marca esta dobra como a ativa do canal e grava o bloco dela nas diretrizes da skill', onclick: () => void c.guard(async () => { await useFold(f); close(); void openCloneReport(c, r); }) }, '⭐ Usar esta dobra') : null,
          h('button', { class: 'small primary', title: 'Ativa a dobra, aplica na skill e abre o Novo projeto já ligado a ela', onclick: () => void c.guard(async () => { if (f) await useFold(f); close(); c.newProject(bendIdea(b), r.skill.id, f?.id); }) }, '＋ Novo projeto com esta dobra')));
    })),
    h('h4', {}, '💼 Canal, produtos e custo'),
    businessSection(c, r, (next) => { close(); void openCloneReport(c, next); }),
    h('h4', {}, '🏷 Marca do canal novo'),
    h('div', { class: 'cl-brand' },
      h('div', {}, h('strong', {}, 'Nomes: '), ...(r.brand.names ?? []).map((n) => h('span', { class: 'tag' }, n)), r.brand.handle ? h('span', { class: 'tag' }, r.brand.handle) : null),
      r.brand.tagline ? h('div', {}, h('strong', {}, 'Slogan: '), r.brand.tagline) : null,
      r.language ? h('div', {}, h('strong', {}, '🌐 Idioma sugerido: '), r.language.code, r.language.why ? h('span', { class: 'muted' }, ` — ${r.language.why}`) : null) : null,
      r.brand.colors?.length ? h('div', {}, h('strong', {}, 'Cores: '), sw(r.brand.colors)) : null,
      r.brand.fonts ? h('div', {}, h('strong', {}, 'Fontes: '), r.brand.fonts) : null,
      r.brand.logoIdea ? h('div', {}, h('strong', {}, 'Logo: '), r.brand.logoIdea) : null,
      r.brand.tone ? h('div', {}, h('strong', {}, 'Tom: '), r.brand.tone) : null,
      r.brand.keywords?.length ? h('div', { class: 'pl-chips' }, ...r.brand.keywords.map((k) => h('span', { class: 'tag kw' }, `#${k}`))) : null,
      r.brand.description ? h('div', { class: 'cl-desc' }, h('div', { class: 'row' }, h('strong', { class: 'grow' }, '📝 Descrição do canal'), h('button', { class: 'small', onclick: () => copy(r.brand.description!) }, '📋 Copiar')), h('div', { class: 'muted', 'data-no-i18n': '' }, r.brand.description)) : null,
      r.brand.bannerPrompt ? h('div', { class: 'cl-desc' }, h('div', { class: 'row' }, h('strong', { class: 'grow' }, '🖼 Prompt do banner (IA de imagem)'), h('button', { class: 'small', onclick: () => copy(r.brand.bannerPrompt!) }, '📋 Copiar')), h('div', { class: 'muted', 'data-no-i18n': '' }, r.brand.bannerPrompt)) : null),
    h('h4', {}, '🎬 Estilo do canal'),
    h('div', { class: 'cl-media' },
      r.files.demo ? h('div', {}, h('strong', {}, 'Vídeo de 10 s'), h('video', { src: c.forge.mediaUrl(r.files.demo), controls: true, loop: true })) : null,
      r.files.thumb ? h('div', {}, h('strong', {}, `Thumbnail modelo${r.thumbnailTemplate ? ` · template "${r.thumbnailTemplate.name}"` : ''}`), h('img', { src: c.forge.mediaUrl(r.files.thumb), alt: '' })) : null),
    r.thumbnail?.rules ? h('div', { class: 'muted small' }, `🖼 ${r.thumbnail.rules}`) : null,
    ...r.warnings.map((w) => h('div', { class: 'tag running' }, '⚠ ' + w)),
    h('div', { class: 'row actions' },
      h('span', { class: 'muted small' }, `🧠 skill "${r.skill.name}" · 🛣️ rota "${r.route.name}"`), h('span', { class: 'sp' }),
      h('button', { title: 'Pacote .ffclone com o clone inteiro (DNA, skill, rota, dobras, imagens) para outro Dark Automate', onclick: () => void c.guard(async () => { const f = (await c.forge['channelExport'](r.id)) as string | null; if (f) c.toast(`Clone exportado: ${f}`); }) }, '📦 Exportar'),
      h('button', { onclick: () => { close(); c.openSkills(); } }, '🧠 Abrir skills'), h('button', { onclick: () => { close(); c.openRoutes(); } }, '🛣️ Abrir rotas'),
      h('button', { onclick: () => { close(); c.newProject(bendIdea(r.bends[r.chosenBend] ?? { title: brandName, angle: '', why: '' }), r.skill.id, foldAt(r.chosenBend)?.id); } }, '＋ Novo projeto'), produce)));
  document.body.append(bg);
}
