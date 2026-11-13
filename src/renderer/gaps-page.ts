import type { VideosCtx } from './videos-page';

/* Aba LACUNAS: a fronteira ocupa o lugar do termo. Colhe a amostra (Finder por baixo), agrupa os formatos e
 * mostra a tabela do que o Finder não responde: quantos estão servindo isso, com que confiança e por quê. */

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

interface Frontier { id: string; market: string; category: string; windowDays: number; maxSubs: number; languages: string[]; createdAt: string }
interface Suggestion { skillId: string; routeId: string; seconds: number; aspect: '9:16' | '16:9'; memories: string[] }
interface Gap {
  id: string; format: string; key: string; confidence: number; n90: number; density: number; hhi: number; scarcity: number; opportunity: number;
  motivation: 'curto' | 'medio' | 'longo' | '—'; trend: 'estavel' | 'subindo' | 'serrilhado' | 'caindo'; series: number[];
  medianViews: number; p75: number; outliers: number; videos: Array<{ id: string; title: string; channel: string; views: number; subs?: number; ageDays?: number; durationSec?: number; url?: string }>;
  suggestion: Suggestion;
}
interface Collected { frontier: Frontier; gaps: Gap[]; sample: number; cached: boolean; warnings: string[] }

const MARKETS: Array<[string, string]> = [['pt-BR', '🇧🇷 pt-BR'], ['en-US', '🇺🇸 en-US'], ['es-ES', '🇪🇸 es-ES'], ['fr-FR', '🇫🇷 fr-FR'], ['de-DE', '🇩🇪 de-DE']];
const CATEGORIES = ['Educação', 'Finanças', 'Ciência', 'História', 'Tecnologia', 'Saúde', 'Curiosidades', 'Negócios'];
const WINDOWS: Array<[string, string]> = [['30', '30 dias'], ['90', '90 dias'], ['180', '180 dias'], ['365', '1 ano']];
const CAPS: Array<[string, string]> = [['100000', '100 mil'], ['1000000', '1 mi'], ['0', 'sem teto']];
const DEPTHS: Array<[string, string]> = [['rapida', 'rápida · 4 buscas'], ['padrao', 'padrão · 8 buscas'], ['profunda', 'profunda · 12 buscas']];

/** Rótulos da tabela e do painel. */
const MOTIVO: Record<Gap['motivation'], string> = { curto: 'curto', medio: 'médio', longo: 'longo', '—': '—' };
const TREND: Record<Gap['trend'], { label: string; action: string; tone: string }> = {
  estavel: { label: 'estrutural', action: 'vale', tone: 'good' },
  subindo: { label: 'janela aberta', action: 'vale', tone: 'good' },
  serrilhado: { label: 'sazonal', action: 'agendar', tone: 'warn' },
  caindo: { label: 'moda morta', action: 'vetar', tone: 'bad' },
};
const fmtNum = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} mil` : String(Math.round(n));

/** Memória local da última fronteira (a tela volta como você deixou). */
const saved = (() => { try { return JSON.parse(localStorage.getItem('ff.gaps.form') ?? '') as { market?: string; category?: string; windowDays?: number; maxSubs?: number; depth?: string }; } catch { return {}; } })();
const form = { market: saved.market ?? 'pt-BR', category: saved.category ?? 'Educação', windowDays: saved.windowDays ?? 90, maxSubs: saved.maxSubs ?? 100_000, depth: saved.depth ?? 'rapida' };
const saveForm = () => { try { localStorage.setItem('ff.gaps.form', JSON.stringify(form)); } catch { /* sem storage */ } };

export async function renderGapsPage(c: VideosCtx, tabs: HTMLElement): Promise<void> {
  let data: Collected | undefined;
  let sel = 0;
  const status = h('div', { class: 'muted small', id: 'gp-status' });
  const table = h('div', { id: 'gp-table' });
  const detail = h('aside', { class: 'gp-detail', id: 'gp-detail' });

  const catInput = h('input', { class: 'gp-cat', id: 'gp-category', list: 'gp-cats', value: form.category, placeholder: 'Educação, Finanças, História…' }) as HTMLInputElement;
  catInput.addEventListener('input', () => { form.category = catInput.value; saveForm(); });
  const marketSel = h('select', { id: 'gp-market' }, ...MARKETS.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  marketSel.value = form.market; marketSel.addEventListener('change', () => { form.market = marketSel.value; saveForm(); });
  const winSel = h('select', { id: 'gp-window' }, ...WINDOWS.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  winSel.value = String(form.windowDays); winSel.addEventListener('change', () => { form.windowDays = Number(winSel.value); saveForm(); });
  const capSel = h('select', { id: 'gp-cap' }, ...CAPS.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  capSel.value = String(form.maxSubs); capSel.addEventListener('change', () => { form.maxSubs = Number(capSel.value); saveForm(); });
  const depthSel = h('select', { id: 'gp-depth', title: 'Quanto colher: cada busca é uma chamada do Finder (yt-dlp sem chave). Mais buscas = amostra maior e mais demorada.' }, ...DEPTHS.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  depthSel.value = form.depth; depthSel.addEventListener('change', () => { form.depth = depthSel.value; saveForm(); });
  const collectBtn = h('button', { class: 'primary', id: 'gp-collect', title: 'Colhe a amostra desta fronteira (usa o Finder; sem a chave da API leva alguns minutos) e ranqueia os formatos' }, '🧩 Colher') as HTMLButtonElement;

  const collect = async (refresh: boolean) => {
    if (!form.category.trim()) { c.toast('Escolha a categoria da fronteira.', true); return; }
    collectBtn.disabled = true;
    status.textContent = '⏳ colhendo a amostra… (o log mostra cada busca; a mesma fronteira em 24 h vem do cache)';
    await c.guard(async () => {
      /* o mercado define o idioma das buscas (pt-BR → pt): 1 idioma = 1/3 do tempo da coleta */
      data = (await c.forge['researchCollect']({ ...form, languages: [form.market.slice(0, 2)], refresh })) as Collected;
      status.textContent = data.cached ? `♻ amostra de hoje reaproveitada (${data.sample} vídeos).` : `✓ ${data.sample} vídeo(s) na amostra (${(data as { depth?: string }).depth ?? form.depth}) · ${data.gaps.length} formato(s) medido(s).`;
      sel = 0;
      paint();
    });
    collectBtn.disabled = false;
    if (!data) status.textContent = '';
  };
  collectBtn.addEventListener('click', () => void collect(false));

  /** Sparkline da série semanal (sem eixo: é a FORMA da curva, não o volume). */
  const spark = (series: number[], tone: string) => {
    const W = 220, H = 54, n = Math.max(2, series.length);
    const pts = series.map((v, i) => `${(i / (n - 1)) * W},${H - 4 - v * (H - 8)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="gp-spark ${tone}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  };

  const paintDetail = () => {
    const g = data?.gaps[sel];
    if (!g) { detail.replaceChildren(h('div', { class: 'gp-empty-detail' }, h('div', { class: 'gp-big' }, '🧩'), h('p', { class: 'muted' }, 'Colha uma fronteira para ver o detalhe do formato.'))); return; }
    const t = TREND[g.trend];
    const chart = h('div', { class: 'gp-d-chart' });
    chart.innerHTML = spark(g.series, t.tone);
    const medianSubs = (() => {
      const subs = g.videos.map((v) => v.subs).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
      if (!subs.length) return undefined;
      return subs[Math.floor(subs.length / 2)];
    })();
    detail.replaceChildren(
      h('div', { class: 'gp-d-head' }, h('span', { class: 'gp-dot' }, '4'), h('strong', {}, 'Detalhe')),
      h('div', { class: 'gp-d-format' }, g.format),
      chart,
      h('div', { class: 'gp-d-trend' },
        h('span', { class: `gp-chip ${t.tone}` }, `tendência · ${t.label}`),
        h('span', { class: 'muted small' }, `90 dias · ${t.action}`)),
      h('div', { class: 'gp-d-stats' },
        h('div', {}, h('span', { class: 'muted small' }, 'n90'), h('strong', {}, `${g.n90}`), h('span', { class: 'muted small' }, 'vídeo(s)')),
        h('div', {}, h('span', { class: 'muted small' }, 'p75'), h('strong', {}, `${g.p75.toFixed(1)}x`), h('span', { class: 'muted small' }, 'do canal')),
        h('div', {}, h('span', { class: 'muted small' }, 'HHI'), h('strong', {}, g.hhi.toFixed(2)), h('span', { class: 'muted small' }, 'concentração'))),
      h('div', { class: 'gp-d-note' }, g.motivation === 'curto' ? '🔥 curto — é o seu território' : g.motivation === 'medio' ? '⚖️ médio — dá para entrar, com ângulo próprio' : g.motivation === 'longo' ? '🧱 longo — já está bem servido' : '👀 bem servido — o índice não aprova sozinho'),
      h('div', { class: 'gp-d-sug' },
        h('span', { class: 'muted small' }, 'sugestões'),
        h('div', { class: 'gp-sug-row' }, h('span', { class: 'tag' }, `📐 ${Math.round(g.medianViews / Math.max(1, medianSubs ?? 1000) * 10) / 10}x mediana`), h('span', { class: 'tag' }, `🧩 ${g.outliers} outlier(s)`), h('span', { class: 'tag' }, `📊 E ${g.opportunity}`)),
        h('div', { class: 'muted small' }, medianSubs ? `canal mediano: ${fmtNum(medianSubs)} inscritos` : 'inscritos do canal não informados nesta coleta')),
      h('div', { class: 'gp-d-out' }, h('span', { class: 'gp-dot' }, '5'), h('strong', {}, 'Saída')),
      h('button', { class: 'primary', id: 'gp-create-detail', onclick: () => void create() }, '＋ Criar projeto'));
  };

  const create = async () => {
    const g = data?.gaps[sel];
    if (!g || !data) return;
    await c.guard(async () => {
      const p = (await c.forge['researchCreateProject']({ frontier: data!.frontier, gap: g })) as { id: string; name: string };
      c.toast(`Projeto "${p.name}" criado com a memória da lacuna`);
      c.openProject?.(p.id);
    });
  };

  const paint = () => {
    const rows = (data?.gaps ?? []).map((g, i) => h('button', { class: `gp-row${i === sel ? ' on' : ''}`, 'data-gap': g.id, onclick: () => { sel = i; paint(); } },
      h('span', { class: 'gp-name' }, g.format),
      h('span', { class: 'gp-bar' }, h('span', { class: 'gp-bar-fill', style: `width:${Math.round(g.confidence * 100)}%` })),
      h('span', { class: 'gp-conf' }, g.confidence.toFixed(2)),
      h('span', { class: 'gp-n' }, String(g.n90)),
      h('span', { class: `gp-motivo m-${g.motivation === '—' ? 'none' : g.motivation}` }, MOTIVO[g.motivation])));
    const g = data?.gaps[sel];
    table.replaceChildren(
      h('div', { class: 'gp-thead' }, h('span', {}, 'formato'), h('span', {}, 'lacuna'), h('span', {}, 'conf.'), h('span', {}, 'n90'), h('span', {}, 'motivo')),
      rows.length ? h('div', { class: 'gp-rows' }, ...rows) : h('div', { class: 'gp-empty' }, h('p', { class: 'muted' }, 'Sem medida ainda. Escolha a fronteira e clique em 🧩 Colher.')),
      ...(g ? [h('div', { class: 'gp-prod' },
        h('span', { class: 'muted small' }, 'Sugestão de produção para o formato selecionado'),
        h('div', { class: 'row' }, h('span', { class: 'tag' }, `skill: ${g.suggestion.skillId}`), h('span', { class: 'tag' }, `rota: ${g.suggestion.routeId}`), h('span', { class: 'tag' }, `${g.suggestion.seconds} s · ${g.suggestion.aspect}`),
          h('span', { class: 'sp' }), h('button', { class: 'primary small', id: 'gp-create', onclick: () => void create() }, `＋ Criar projeto`)))] : []),
      ...(data?.warnings?.length ? [h('details', { class: 'gp-warn' }, h('summary', {}, '⚠ avisos da coleta'), h('ul', {}, ...data.warnings.map((w) => h('li', {}, w))))] : []));
    paintDetail();
  };

  const steps = h('div', { class: 'gp-steps' },
    h('span', { class: 'on' }, '1 fronteira'), h('span', {}, '2 colher'), h('span', {}, '3 formatos ranqueados'), h('span', {}, '4 detalhe do cluster'), h('span', {}, '5 criar projeto'));

  const intro = h('div', { class: 'card gp-intro' },
    h('div', { class: 'row' }, h('span', { class: 'gp-badge' }, '🧩'), h('div', { class: 'grow' },
      h('strong', {}, 'Você escolhe uma fronteira, não um termo'),
      h('div', { class: 'muted small' }, 'A tabela responde o que o Finder não responde: quantos vídeos estão servindo cada formato, quão concentrado é o canal e qual é a forma da curva. O tema aparece no fim — o formato é a saída.'))),
    h('div', { class: 'gp-routes' },
      h('div', {}, h('strong', {}, 'A · com palpite'), h('span', { class: 'muted small' }, 'seed → expandir → medir → ranquear')),
      h('div', {}, h('strong', {}, 'B · sem palpite'), h('span', { class: 'muted small' }, 'fronteira → colher → outlier → agrupar → nomear'))));

  const formCard = h('div', { class: 'card gp-form' },
    h('div', { class: 'gp-f-label' }, h('span', { class: 'gp-dot' }, '1'), h('strong', {}, 'Fronteira')),
    h('div', { class: 'row gp-fields' },
      h('label', {}, 'Mercado', marketSel), h('label', {}, 'Categoria', catInput), h('label', {}, 'Janela', winSel), h('label', {}, 'Teto de canal', capSel), h('label', {}, 'Profundidade', depthSel), collectBtn,
      h('button', { class: 'small', id: 'gp-refresh', title: 'Colher de novo, ignorando o cache de 24 h', onclick: () => void collect(true) }, '🔄')),
    h('datalist', { id: 'gp-cats' }, ...CATEGORIES.map((x) => h('option', { value: x }))),
    h('div', { class: 'muted small' }, 'Sem API: a coleta usa o yt-dlp (0 cota) e guarda a amostra por 24 h. Com a chave da YouTube API é mais rápida e traz a idade do canal.'),
    status);

  c.main.replaceChildren(h('h2', {}, '🔎 Pesquisar'), tabs, intro, formCard,
    h('div', { class: 'gp-grid' }, h('div', { class: 'card gp-main' }, table), detail), steps);
  paint();

  /* fronteira salva: mostra a última medida sem recolher de novo */
  await c.guard(async () => {
    const list = (await c.forge['researchFrontiers']().catch(() => [])) as Frontier[];
    if (!list.length || data) return;
    const last = list[0]!;
    const savedGaps = (await c.forge['researchGaps'](last.id).catch(() => undefined)) as { gaps: Gap[]; sample: number } | undefined;
    if (!savedGaps?.gaps?.length) return;
    data = { frontier: last, gaps: savedGaps.gaps, sample: savedGaps.sample, cached: true, warnings: [] };
    form.market = last.market; form.category = last.category; form.windowDays = last.windowDays; form.maxSubs = last.maxSubs;
    marketSel.value = last.market; catInput.value = last.category; winSel.value = String(last.windowDays); capSel.value = String(last.maxSubs);
    status.textContent = `♻ última fronteira medida (${last.category}, ${last.market}) · ${savedGaps.sample} vídeos.`;
    paint();
  });
}
