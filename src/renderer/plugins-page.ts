import type { PluginInfo, PluginStyle } from '../shared/types';
import { askConfirm, showMessage } from './dialogs';

/* Aba PLUGINS: instalar (GitHub/pasta), entender o que cada plugin traz e usar num projeto.
   Plugins de estilos (ex.: mg-styles-15) mostram uma galeria com capa, vídeo de exemplo e trilha. */

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
export interface PluginsCtx {
  forge: Api; toast: (m: string, bad?: boolean) => void; main: HTMLElement;
  guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  /** abre o Novo projeto com o plugin (e o estilo) já marcados */
  useInProject: (pluginId: string, styleId?: string) => void;
}

const MUSIC_LABEL: Record<string, string> = {
  pop: 'pop animado', ambient: 'ambiente', explainer: 'explicativo (marimba)', lofi: 'lo-fi', future_bass: 'future bass', techno: 'techno', synthwave: 'synthwave',
  darksynth: 'darksynth (tenso)', chiptune: '8-bit', variety: 'variedades', trap: 'trap', guofeng: 'guofeng', vaporwave: 'vaporwave', acid: 'acid', glitch_hop: 'glitch hop',
};

let player: HTMLAudioElement | undefined;

/** Etapas do Dark Automate com nome legível (adaptação dos plugins). */
const STEP_PT: Record<string, string> = {
  brief: '🧭 brief', ideation: '💡 ideias', script: '📝 roteiro', scene_plan: '🎬 cenas', asset_design: '🎭 elenco', image: '🖼 imagem', video: '🎥 vídeo',
  code_scene: '💻 cena por código', motion_graphics: '📊 motion', narration: '🎙 narração', music: '🎵 trilha', thumbnail: '🖼 thumbnail', metadata: '🔎 SEO/metadados', review: '✅ revisão',
};

/** Seletor "quem adapta": sem IA (heurística) ou um harness/modelo. */
async function adaptPicker(c: PluginsCtx, prefix: string): Promise<{ el: HTMLElement; value: () => { harness: string; model?: string } }> {
  const cat = ((await c.guard(() => c.forge['catalog']())) ?? { harnesses: [] }) as { harnesses: Array<{ id: string; models?: string[] }> };
  const hs = ['auto', ...cat.harnesses.map((x) => x.id)];
  const sel = h('select', { id: `${prefix}-harness` }, h('option', { value: '' }, 'sem IA (pelos nomes dos arquivos)'), ...hs.map((x) => h('option', { value: x }, x === 'auto' ? 'IA: auto (primeiro disponível)' : `IA: ${x}`))) as HTMLSelectElement;
  sel.value = 'auto';
  const model = h('select', { id: `${prefix}-model` }) as HTMLSelectElement;
  const paint = () => { model.style.display = sel.value && sel.value !== 'auto' ? '' : 'none'; model.replaceChildren(h('option', { value: '' }, 'modelo padrão'), ...(cat.harnesses.find((x) => x.id === sel.value)?.models ?? []).map((m) => h('option', { value: m }, m))); };
  sel.addEventListener('change', paint); paint();
  return { el: h('span', { class: 'row' }, sel, model), value: () => ({ harness: sel.value, model: model.value || undefined }) };
}

export async function renderPluginsPage(c: PluginsCtx): Promise<void> {
  const { forge, toast, main, guard } = c;
  const plugins = ((await guard(() => forge['listPlugins']())) ?? []) as PluginInfo[];
  const audio = ((await guard(() => forge['pluginAudioStatus']())) ?? { lib: null, python: null }) as { lib: string | null; python: string | null };
  const url = h('input', { id: 'pl-url', class: 'wide', placeholder: 'https://github.com/dono/repositorio  (ou dono/repositorio)' }) as HTMLInputElement;
  const busy = h('span', { class: 'muted', id: 'pl-busy' });
  /* instalar com IA: depois de instalar, a IA adapta o plugin ao Dark Automate (o que entra em cada etapa) */
  const adaptAfter = h('input', { type: 'checkbox', id: 'pl-adapt-after' }) as HTMLInputElement; adaptAfter.checked = true;
  const who = await adaptPicker(c, 'pl-install');
  const install = (fn: () => Promise<(PluginInfo & { also?: string[] }) | null>) => void guard(async () => {
    busy.textContent = '⏳ baixando e convertendo… repositórios grandes podem levar alguns minutos';
    try {
      const p = await fn();
      if (p) {
        toast(`Plugin "${p.name}" instalado${p.styles?.length ? ` com ${p.styles.length} estilos` : p.items?.length ? ` (${p.items.length} skills/comandos/agentes)` : ''}${p.also?.length ? ` + ${p.also.length} outro(s) do mesmo repositório: ${p.also.join(', ')}` : ''}. Já pode marcar no Novo projeto.`);
        if (adaptAfter.checked && !p.kit && !p.styles?.length) {
          busy.textContent = `⏳ adaptando "${p.name}" ao Dark Automate…`;
          try { const a = (await forge['adaptPlugin'](p.id, who.value())) as { summary: string }; toast(`Adaptado: ${a.summary}`); }
          catch (e) { toast(`Instalado, mas a adaptação falhou: ${(e as Error).message} — o plugin entra inteiro em todas as etapas até você adaptar.`, true); }
        }
      }
    }
    finally { busy.textContent = ''; }
    await renderPluginsPage(c);
  });

  const steps = h('div', { class: 'pl-steps' },
    ...[
      ['📦', '1. Instale', 'Cole a URL de um repositório do GitHub ou escolha uma pasta. Plugins do Claude (skills, comandos, agentes) entram como estão; coleções de prompts de estilo são convertidas: cada estilo vira uma skill.'],
      ['🎨', '2. Escolha no projeto', 'Em Novo projeto → Plugins, marque o plugin e (se ele tiver estilos) escolha o estilo na galeria. Ou clique em "Usar este estilo" aqui.'],
      ['🎬', '3. Produza', 'As instruções do plugin entram no prompt das etapas (roteiro, cenas por código, motion). Recursos como o mgaudio geram a trilha e os efeitos sonoros por código.'],
    ].map(([ic, t, d]) => h('div', { class: 'pl-step' }, h('div', { class: 'pl-ic' }, ic!), h('strong', {}, t!), h('p', { class: 'muted' }, d!))));

  const audioCard = h('div', { class: 'card pl-audio', id: 'pl-audio' },
    h('div', { class: 'row' }, h('strong', {}, '🎵 Som por código (mgaudio)'), h('span', { class: 'sp' }),
      h('span', { class: `tag ${audio.lib ? 'done' : 'pending'}` }, audio.lib ? 'biblioteca instalada' : 'sem plugin com mgaudio'),
      h('span', { class: `tag ${audio.python ? 'done' : 'pending'}` }, audio.python ? 'Python pronto' : 'Python não preparado')),
    h('p', { class: 'muted' }, audio.lib
      ? 'Trilhas e efeitos são sintetizados por código (receitas por gênero e samples CC0). A etapa "Trilha programática" das rotas usa o mgaudio; sem ele, o app usa o sintetizador interno.'
      : 'Sem o mgaudio, a "Trilha programática" usa o sintetizador interno do app (acordes, baixo e bateria em ffmpeg). Instale o plugin mg-styles-15 para trilhas profissionais por código.'),
    audio.lib ? h('div', { class: 'row' },
      h('button', { id: 'pl-audio-install', onclick: (e) => void guard(async () => {
        const b = e.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = '⏳ instalando (alguns minutos na primeira vez)…';
        try { await forge['pluginAudioInstall'](); toast('Python do áudio pronto.'); } finally { await renderPluginsPage(c); }
      }) }, audio.python ? '↻ Verificar / reinstalar dependências' : '⬇ Preparar Python do áudio (numpy, numba, pedalboard…)')) : null);

  const cards = plugins.map((p) => pluginCard(c, p));
  main.replaceChildren(
    h('div', { class: 'row' }, h('h2', {}, '🧩 Plugins'), h('span', { class: 'sp' }), h('button', { onclick: () => void forge['openPluginsFolder']() }, 'Abrir pasta dos plugins')),
    steps,
    h('div', { class: 'card' },
      h('div', { class: 'muted small' }, 'Aceita: repositório inteiro (instala todos os plugins que ele tiver), uma subpasta (…/tree/main/plugins/nome) ou dono/repositorio. Instalar de novo = atualizar.'),
      h('div', { class: 'row' }, url,
        h('button', { class: 'primary', id: 'pl-install-url', onclick: () => { if (!url.value.trim()) return toast('Cole a URL do repositório.', true); install(() => forge['installPluginUrl'](url.value.trim())); } }, '⬇ Instalar do GitHub'),
        h('button', { id: 'pl-install-dir', onclick: () => install(async () => { const d = await forge['openDir']({ title: 'Pasta do plugin' }); return d ? forge['installPluginFolder'](d) : null; }) }, '📁 De uma pasta'),
        h('button', { id: 'pl-install-file', title: 'Arquivo .plugin do Claude (zip com .claude-plugin/plugin.json)', onclick: () => install(() => forge['installPluginFile']()) }, '📦 Arquivo .plugin')),
      h('div', { class: 'row' }, h('label', { class: 'inline chk', title: 'Sem adaptar, o plugin inteiro entra em todas as etapas. Adaptado, cada skill/comando entra só nas etapas em que serve, com o formato de saída traduzido e a lista do que não roda aqui.' }, adaptAfter, '🧠 Adaptar ao Dark Automate depois de instalar'), who.el),
      busy),
    audioCard,
    ...(cards.length ? cards : [h('p', { class: 'muted' }, 'Nenhum plugin instalado ainda. Experimente: https://github.com/Vincentwei1021/mg-styles-15')]));
}

const KIT_LABEL: Record<string, [string, string]> = {
  player: ['🎬 Motor de animação próprio (player + engine)', 'Cada cena do Dark Automate vira um "shot" do motor do plugin (registerShot): personagens, luz, câmera, gradação e barras saem do código testado do plugin, não reinventados pela IA.'],
  pages: ['🎬 Biblioteca de estilos (páginas renderizadas pelo plugin)', 'Cada estilo tem STYLE.md, demo e o kit /core/lib.js. Escolha o estilo no projeto: cada cena vira uma página nesse estilo (READY/render(t)), renderizada com a biblioteca do plugin, com correção de erros e revisão visual.'],
  'node-film': ['🧩 Biblioteca de desenho (lib/*.mjs)', 'Filmes escritos para Node (film.mjs) rodam aqui no navegador. Nas cenas por código, a IA importa a biblioteca do plugin (personagens, texturas, pincel).'],
  piece: ['🎬 Motor de animação próprio (peças montadas)', 'O plugin monta peças (piece.json + src/) num HTML único; por enquanto o Dark Automate usa o motor dele para a prévia.'],
};

function pluginCard(c: PluginsCtx, p: PluginInfo): HTMLElement {
  const { forge, guard, toast } = c;
  const chips = [
    p.styles?.length ? `🎨 ${p.styles.length} estilos` : '', p.skills?.length ? `🧠 ${p.skills.length} skills` : '', p.commands?.length ? `⌨️ ${p.commands.length} comandos` : '',
    p.agents?.length ? `🤖 ${p.agents.length} agentes` : '', p.mcp?.length ? `🔌 MCP: ${p.mcp.join(', ')}` : '', p.adapted ? '🔄 convertido para o formato Claude' : '',
  ].filter(Boolean);
  const head = h('div', { class: 'row' },
    h('div', { class: 'grow' }, h('h3', {}, `${p.displayName ?? p.name}${p.version ? ` · v${p.version}` : ''}`),
      p.author || p.license ? h('div', { class: 'muted small' }, [p.author ? `por ${p.author}` : '', p.license ? `licença ${p.license}` : ''].filter(Boolean).join(' · ')) : null,
      p.description ? h('div', { class: 'muted' }, p.description) : null,
      h('div', { class: 'pl-chips' }, ...chips.map((x) => h('span', { class: 'tag' }, x)), ...(p.keywords ?? []).slice(0, 10).map((k) => h('span', { class: 'tag kw' }, `#${k}`)))),
    h('div', { class: 'col' },
      h('button', { class: 'primary', onclick: () => c.useInProject(p.id) }, '＋ Usar em novo projeto'),
      h('button', { onclick: () => void guard(async () => promptModal(p.name, (await forge['pluginPrompt']([p.id])) as string)) }, '👁 Ver o que entra no prompt'),
      h('button', { title: 'Grava um arquivo .plugin (zip no formato do Claude) para instalar no Claude ou em outro Dark Automate', onclick: () => void guard(async () => { const f = await forge['exportPluginFile'](p.id) as string | null; if (f) toast(`Plugin exportado: ${f}`); }) }, '📦 Exportar .plugin'),
      h('button', { class: 'danger', onclick: () => void guard(async () => { if (!await askConfirm(`Remover o plugin "${p.name}"?`)) return; await forge['removePlugin'](p.id); toast('Plugin removido.'); await renderPluginsPage(c); }) }, 'Remover')));
  const gallery = p.styles?.length ? h('div', { class: 'pl-gallery' }, ...p.styles.map((st) => styleCard(c, p, st))) : null;
  const res = p.resources?.length ? h('div', { class: 'pl-res' }, h('strong', {}, 'Recursos usados pelo Dark Automate'),
    ...p.resources.map((r) => h('div', { class: 'muted' }, `${r.ready ? '✓' : '✗'} ${r.label}`))) : null;
  /* plugin Claude comum: um cartão por skill/comando/agente, com a descrição do próprio plugin */
  const ICON = { skill: '🧠', command: '⌨️', agent: '🤖' } as const;
  const LABEL = { skill: 'skill', command: 'comando', agent: 'agente' } as const;
  const plain = !p.styles?.length && p.items?.length
    ? h('div', { class: 'pl-items' }, ...p.items.map((it) => h('div', { class: 'pl-item' }, it.image ? h('img', { class: 'pl-item-img', src: c.forge.mediaUrl(it.image), alt: '' }) : null, h('div', { class: 'row' }, h('span', { class: 'pl-ic-s' }, ICON[it.kind]), h('strong', {}, it.name), h('span', { class: 'sp' }), h('span', { class: 'tag' }, LABEL[it.kind])), it.description ? h('div', { class: 'muted small' }, it.description) : null)))
    : null;
  const how = !p.styles?.length ? usageFlow(p) : null;
  /* imagens do repositório: o que o plugin produz */
  const pics = !p.gallery?.length && !p.styles?.length && p.cover ? h('div', { class: 'pl-pics' }, h('img', { class: 'pl-cover-only', src: c.forge.mediaUrl(p.cover), alt: '' })) : p.gallery?.length ? h('div', { class: 'pl-pics' }, ...p.gallery.map((g) => h('button', { class: 'pl-pic', title: 'ampliar', onclick: () => zoomImage(c, g, p.gallery!) }, h('img', { src: c.forge.mediaUrl(g), alt: '', loading: 'lazy' })))) : null;
  const readme = p.readme ? h('details', { class: 'pl-readme' }, h('summary', {}, '📖 Sobre (README do repositório)'), ...p.readme.split(/\n\n/).map((x) => h('p', { class: 'muted' }, x))) : null;
  const files = p.items?.filter((it) => it.files?.length).map((it) => skillFiles(it.name, it.files!)) ?? [];
  const ex = p.examples?.length ? h('div', { class: 'pl-ex' }, h('strong', {}, '🎬 Exemplos que vêm no repositório: '), ...p.examples.map((x) => h('span', { class: 'tag' }, x))) : null;
  const req = p.requires?.length ? h('div', { class: 'muted small' }, `⚙️ O plugin declara ${p.requires.join(', ')} para o renderizador próprio dele. No Dark Automate não é preciso instalar: as cenas usam o canvas do navegador (o app fornece o adaptador) e o app faz a renderização, os efeitos e a trilha.`) : null;
  const kitBox = p.kit ? h('div', { class: 'pl-kit' },
    p.preview ? h('video', { class: 'pl-preview', src: c.forge.mediaUrl(p.preview), autoplay: true, loop: true, muted: true, playsinline: true, controls: true })
      : h('div', { class: 'pl-preview-empty muted' }, '🎬 Prévia ainda não gerada'),
    h('div', { class: 'pl-kit-info' }, h('strong', {}, (KIT_LABEL[p.kit.kind] ?? KIT_LABEL['player']!)[0]),
      h('div', { class: 'muted small' }, (KIT_LABEL[p.kit.kind] ?? KIT_LABEL['player']!)[1]),
      p.kit.kind === 'pages' ? h('div', { class: 'muted small' }, p.kit.needsLibrary ? `📦 A biblioteca ainda não está no app (o plugin a clona de ${p.kit.repo ?? 'um repositório'}).` : `📚 ${p.kit.styles.length} estilos na biblioteca — veja a galeria abaixo.`) : null,
      p.kit.needsLibrary ? h('button', { class: 'small primary', 'data-library': p.id, onclick: (e) => void c.guard(async () => { const b = e.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = '⏳ baixando a biblioteca (~90 MB)…'; await c.forge['pluginLibrary'](p.id); b.textContent = '⏳ gerando a prévia…'; await c.forge['pluginPreview'](p.id, true).catch(() => null); await renderPluginsPage(c); }) }, '⬇ Baixar a biblioteca de estilos') : null,
      p.kit.kind !== 'pages' && p.kit.styles.length ? h('div', { class: 'pl-chips' }, ...p.kit.styles.map((st) => h('span', { class: 'tag' }, `🎨 ${st}`))) : null,
      h('button', { class: 'small', 'data-regen': p.id, onclick: (e) => void c.guard(async () => { const b = e.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = '⏳ renderizando 3 s…'; await c.forge['pluginPreview'](p.id, true); await renderPluginsPage(c); }) }, p.preview ? '↻ Refazer prévia (3 s)' : '🎬 Gerar prévia (3 s)'))) : null;
  return h('div', { class: 'card pl-card', 'data-plugin': p.id }, head, adaptBox(c, p), kitBox, pics, gallery, readme, plain, ...files, how, ex, req, res,
    p.source ? h('div', { class: 'muted small' }, `origem: ${p.source}`) : null);
}

/** Adaptação ao Dark Automate: o que entra em cada etapa, o que não roda, e os botões adaptar/desfazer/ver por etapa. */
function adaptBox(c: PluginsCtx, p: PluginInfo): HTMLElement | null {
  if (p.kit || p.styles?.length || !p.items?.length) return null;
  const { forge, guard, toast } = c;
  const box = h('div', { class: `pl-adapt${p.adaptation ? ' on' : ''}`, 'data-adapt': p.id });
  const run = (btn: HTMLButtonElement, pick: () => { harness: string; model?: string }) => void guard(async () => {
    btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ adaptando…';
    try { const a = (await forge['adaptPlugin'](p.id, pick())) as { summary: string }; toast(`Adaptado: ${a.summary}`); }
    finally { btn.disabled = false; btn.textContent = old; await renderPluginsPage(c); }
  });
  void (async () => {
    const who = await adaptPicker(c, `pl-ad-${p.id}`);
    const go = h('button', { class: 'small primary', 'data-act': 'adapt', onclick: (e) => run(e.currentTarget as HTMLButtonElement, who.value) }, p.adaptation ? '↻ Adaptar de novo' : '🧠 Adaptar ao Dark Automate');
    if (!p.adaptation) {
      box.replaceChildren(h('div', { class: 'row' }, h('span', { class: 'tag running' }, '⚠ não adaptado'), h('span', { class: 'muted small grow' }, 'O plugin inteiro entra em TODAS as etapas (prompts maiores, instruções fora de lugar).'), who.el, go));
      return;
    }
    const a = p.adaptation;
    const stepSel = h('select', { class: 'small' }, ...Object.keys(a.steps).map((k) => h('option', { value: k }, STEP_PT[k] ?? k))) as HTMLSelectElement;
    box.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'tag done' }, '✓ adaptado ao Dark Automate'), h('span', { class: 'muted small grow' }, `${a.summary} · por ${a.by} · ${new Date(a.createdAt).toLocaleDateString()}`)),
      h('div', { class: 'pl-chips' }, ...Object.entries(a.steps).map(([k, ids]) => h('span', { class: 'tag', title: ids.join('\n') }, `${STEP_PT[k] ?? k}: ${ids.length}`))),
      a.ignore.length ? h('div', { class: 'muted small' }, `🚫 não roda aqui (a IA é avisada para ignorar): ${a.ignore.join(' · ')}`) : '',
      h('div', { class: 'row' },
        stepSel, h('button', { class: 'small', onclick: () => void guard(async () => promptModal(`${p.name} — etapa ${STEP_PT[stepSel.value] ?? stepSel.value}`, (await forge['pluginPromptStep'](p.id, stepSel.value)) as string)) }, '👁 Ver o que entra nesta etapa'),
        h('span', { class: 'sp' }), who.el, go,
        h('button', { class: 'small', 'data-act': 'adapt-remove', title: 'Volta a mandar o plugin inteiro para todas as etapas', onclick: () => void guard(async () => { await forge['removePluginAdaptation'](p.id); toast('Adaptação desfeita'); await renderPluginsPage(c); }) }, '↺ Desfazer')));
  })();
  return box;
}

/** Fluxo ilustrado: como o plugin entra na produção do Dark Automate. */
function usageFlow(p: PluginInfo): HTMLElement {
  const lib = p.items?.some((it) => it.files?.some((f) => /^lib\/.+\.m?js$/i.test(f)));
  const steps: Array<[string, string, string]> = [
    ['☑️', 'Marque no projeto', 'Novo projeto → Plugins (ou no editor, card Plugins).'],
    ['🧠', 'As IAs recebem a skill', 'O SKILL.md vai inteiro no pedido de cada etapa; referências e templates ficam em plugins/ dentro do projeto e são abertos sob demanda, como no Claude.'],
    lib ? ['🧩', 'Cenas usam a biblioteca', 'Cada cena por código é uma página HTML que importa a biblioteca do plugin (lib/…) — o app fornece o adaptador do canvas.'] : ['✍️', 'Roteiro e cenas no estilo', 'Roteiro, planejamento, código e SEO seguem as regras do plugin.'],
    ['🎬', 'O app finaliza', 'Renderiza quadro a quadro, mixa narração, efeitos (window.__forge.sfx) e trilha.'],
  ];
  return h('div', { class: 'pl-flow' }, h('strong', {}, 'Como este plugin é usado no Dark Automate'),
    h('div', { class: 'pl-flow-row' }, ...steps.flatMap(([ic, t, d], i) => [h('div', { class: 'pl-flow-step' }, h('div', { class: 'pl-ic' }, ic), h('strong', {}, t), h('div', { class: 'muted small' }, d)), i < steps.length - 1 ? h('div', { class: 'pl-arrow' }, '➜') : null])),
    lib ? h('div', { class: 'muted small' }, 'Rota indicada: uma com cenas por código (ex.: "Explicativo por código" ou "Stickman por código + efeitos e trilha programáticos").') : null);
}

/** Arquivos de apoio de uma skill, agrupados por pasta (referências, templates, biblioteca, scripts). */
function skillFiles(name: string, files: string[]): HTMLElement {
  const groups = new Map<string, string[]>();
  for (const f of files) { const g = f.includes('/') ? f.split('/')[0]! : '(raiz)'; groups.set(g, [...(groups.get(g) ?? []), f]); }
  const ICON: Record<string, string> = { references: '📚', templates: '📝', lib: '🧩', scripts: '🔧', assets: '🖼️', examples: '🎬' };
  return h('details', { class: 'pl-files' }, h('summary', {}, `📂 Arquivos de apoio da skill "${name}" (${files.length}) — lidos pela IA só quando a skill manda`),
    h('div', { class: 'pl-fgroups' }, ...[...groups].map(([g, list]) => h('div', { class: 'pl-fgroup' }, h('strong', {}, `${ICON[g] ?? '📄'} ${g} (${list.length})`),
      h('div', { class: 'muted small' }, list.map((x) => x.replace(/^[^/]+\//, '')).slice(0, 14).join(' · ') + (list.length > 14 ? ' …' : ''))))));
}

function zoomImage(c: PluginsCtx, file: string, all: string[]) {
  let i = Math.max(0, all.indexOf(file));
  const img = h('img', { src: c.forge.mediaUrl(all[i]!), alt: '' });
  const go = (d: number) => { i = (i + d + all.length) % all.length; img.setAttribute('src', c.forge.mediaUrl(all[i]!)); };
  const close = () => bg.remove();
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal pl-modal' }, h('div', { class: 'row' }, h('button', { onclick: () => go(-1) }, '◀'), h('span', { class: 'sp' }), h('button', { onclick: () => go(1) }, '▶'), h('button', { onclick: close }, '✕')),
      h('div', { class: 'pl-video' }, img)));
  document.body.append(bg);
}

function styleCard(c: PluginsCtx, p: PluginInfo, st: PluginStyle): HTMLElement {
  const { forge, guard } = c;
  const cover = st.cover ? h('img', { src: forge.mediaUrl(st.cover), alt: st.name, loading: 'lazy' }) : h('div', { class: 'pl-nocover' }, '🎨');
  return h('div', { class: 'pl-style', 'data-style': st.id },
    h('button', { class: 'pl-cover', title: 'Ver o vídeo de exemplo', onclick: () => void openStyle(c, p, st) }, cover, h('span', { class: 'pl-play' }, '▶')),
    h('div', { class: 'pl-sname' }, st.name),
    st.film ? h('div', { class: 'muted small' }, st.film) : null,
    h('div', { class: 'row' },
      st.music ? h('button', { class: 'small', title: 'Ouvir 15 s da trilha sugerida, gerada por código', onclick: (e) => void guard(async () => {
        const b = e.currentTarget as HTMLButtonElement; const old = b.textContent; b.textContent = '⏳'; b.disabled = true;
        try { const r = (await forge['pluginAudioDemo'](st.music!, 15)) as { file: string }; player?.pause(); player = new Audio(forge.mediaUrl(r.file)); await player.play(); }
        finally { b.textContent = old; b.disabled = false; }
      }) }, `🎵 ${MUSIC_LABEL[st.music] ?? st.music}`) : null,
      h('span', { class: 'sp' }),
      h('button', { class: 'small primary', onclick: () => c.useInProject(p.id, st.id) }, 'Usar')));
}

async function openStyle(c: PluginsCtx, p: PluginInfo, st: PluginStyle) {
  const { forge, guard } = c;
  const box = h('div', { class: 'pl-video' }, h('div', { class: 'muted' }, '⏳ carregando o vídeo de exemplo…'));
  const close = () => { bg.remove(); };
  const bg = h('div', { class: 'modal-bg', id: 'pl-style-modal', onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal pl-modal' },
      h('div', { class: 'row' }, h('h3', {}, `🎨 ${st.name}`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
      box,
      st.summary ? h('p', {}, st.summary) : null,
      st.sfx ? h('p', { class: 'muted' }, `🔊 Efeitos típicos: ${st.sfx}`) : null,
      h('details', {}, h('summary', {}, 'Prompt que o Dark Automate envia às etapas com este estilo'), h('pre', { class: 'pl-prompt', id: 'pl-style-prompt' }, '…')),
      h('div', { class: 'row actions' }, h('span', { class: 'sp' }), h('button', { onclick: close }, 'Fechar'), h('button', { class: 'primary', onclick: () => { close(); c.useInProject(p.id, st.id); } }, '＋ Usar este estilo num novo projeto'))));
  document.body.append(bg);
  void guard(async () => {
    const txt = (await forge['pluginPrompt']([p.id], { [p.id]: st.id })) as string;
    const pre = document.getElementById('pl-style-prompt'); if (pre) pre.textContent = txt.slice(0, 12000);
  });
  try {
    const f = (await forge['pluginStyleVideo'](p.id, st.id)) as string;
    box.replaceChildren(h('video', { src: forge.mediaUrl(f), controls: true, autoplay: true, playsinline: true }));
  } catch (e) {
    box.replaceChildren(st.cover ? h('img', { src: forge.mediaUrl(st.cover), alt: st.name }) : '', h('div', { class: 'muted' }, `Vídeo indisponível: ${(e as Error).message}`));
  }
}

function promptModal(title: string, text: string) {
  const close = () => bg.remove();
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal pl-modal' }, h('div', { class: 'row' }, h('h3', {}, `👁 Prompt injetado — ${title}`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
      h('p', { class: 'muted' }, 'É isto que vai junto do pedido de cada etapa quando o plugin está marcado no projeto (sem estilo escolhido aparece só a lista de estilos).'),
      h('pre', { class: 'pl-prompt' }, text || '(este plugin não tem instruções para injetar)')));
  document.body.append(bg);
}
