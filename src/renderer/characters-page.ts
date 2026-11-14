import { askConfirm } from './dialogs';
import { currentTestText, voiceTestBar, voiceTestText } from './voice-picker';
import { renderStoriesTab } from './stories-page';

/*
 * Aba BIBLIOTECA: personagens, cenários e objetos reutilizáveis (doramas, histórias e vídeos por código) + Histórias.
 * Cada item: aparência fixa, FOLHA de referência (personagem: frente/perfil/costas + expressões; objeto: três vistas;
 * cenário: plano geral/contraplano/detalhe), voz (personagem), variações por episódio, modelos 3D (cenas por código)
 * e etiquetas. No Novo projeto, os escolhidos viram o elenco, os cenários e os objetos fixos do vídeo.
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
export interface CharactersCtx { forge: Api; toast: (m: string, bad?: boolean) => void; main: HTMLElement; guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  openEpisode?: (ep: unknown) => void }
export type Entity = 'character' | 'location' | 'prop';
export interface Variant { id: string; label: string; look: string; episodes?: number[]; sheet?: string }
export interface CharRow {
  id: string; name: string; kind: 'pessoa' | 'cartoon' | 'codigo' | 'animal' | 'outro'; description?: string; look: string; gender?: string; age?: string;
  voice?: { refAudio?: string; apiVoice?: string; description?: string }; code?: string; sheet?: string; portrait?: string; images?: string[]; tags?: string[]; dir: string;
  entity?: Entity; variants?: Variant[]; models?: string[]; aliases?: string[]; storyId?: string;
}
export const KIND_LABEL: Record<CharRow['kind'], string> = { pessoa: '🧑 Pessoa (realista)', cartoon: '🎨 Cartoon / animação', codigo: '💻 Desenho por código', animal: '🐾 Animal / criatura', outro: '✨ Outro' };
const STYLE_LABEL: Record<CharRow['kind'], string> = { pessoa: '📷 Realista', cartoon: '🎨 Cartoon / animação', codigo: '💻 Desenho por código', animal: '🐾 Criatura', outro: '✨ Outro' };
export const charImage = (forge: Api, c: CharRow) => (c.sheet || c.portrait
  ? forge.mediaUrl(`${c.dir}/${c.sheet ?? c.portrait}`)
  : c.images?.[0] ? forge.mediaUrl(`${c.dir}/${c.images[0]}`) : undefined);

const TABS: Array<[Entity | 'stories', string, string]> = [['character', '👥 Personagens', 'personagem'], ['location', '🏞 Cenários', 'cenário'], ['prop', '📦 Objetos', 'objeto'], ['stories', '📖 Histórias', 'história']];
let tab: Entity | 'stories' = 'character';
/** Aba interna: por imagem, por código ou tudo (vale para personagens, cenários e objetos). */
let originFilter: 'all' | 'image' | 'code' = 'all';
const isCodeItem = (x: CharRow) => x.kind === 'codigo' || !!x.code || !!x.models?.length;
let selected: string | undefined;

export async function renderCharactersPage(c: CharactersCtx): Promise<void> {
  const { forge, main, guard } = c;
  const again = () => void renderCharactersPage(c);
  const tabsEl = h('div', { class: 'lib-tabs' }, ...TABS.map(([k, l]) => h('button', { class: `lib-tab${tab === k ? ' on' : ''}`, 'data-lib-tab': k, onclick: () => { tab = k; selected = undefined; again(); } }, l)));
  if (tab === 'stories') {
    const body = h('div', {});
    main.replaceChildren(h('div', { class: 'row pagehead' }, h('h2', {}, '📚 Biblioteca')), tabsEl, body);
    await renderStoriesTab({ ...c, main: body, refresh: again });
    return;
  }
  const noun = TABS.find((t) => t[0] === tab)![2];
  const list = ((await guard(() => forge['charactersList'](tab))) ?? []) as CharRow[];
  const codeN = list.filter(isCodeItem).length;
  const filtered = originFilter === 'all' ? list : list.filter((x) => (originFilter === 'code' ? isCodeItem(x) : !isCodeItem(x)));
  if (selected && selected !== 'new' && !filtered.some((x) => x.id === selected)) selected = filtered[0]?.id;
  const cur = selected === 'new' ? undefined : filtered.find((x) => x.id === selected) ?? filtered[0];
  if (!selected && cur) selected = cur.id;
  const subTabs = h('div', { class: 'lib-subtabs' },
    ...([['all', 'Tudo', list.length], ['image', 'Por imagem', list.length - codeN], ['code', 'Por código', codeN]] as const).map(([k, l, n]) =>
      h('button', { class: `lib-subtab${originFilter === k ? ' on' : ''}`, 'data-origin': k, onclick: () => { originFilter = k; selected = undefined; again(); } }, `${l} (${n})`)));
  const head = h('div', { class: 'row pagehead' }, h('h2', {}, '📚 Biblioteca'), h('span', { class: 'sp' }),
    h('span', { class: 'muted' }, `${filtered.length} ${noun}(s)`), h('button', { class: 'primary', onclick: () => { selected = 'new'; again(); } }, `＋ Novo ${noun}`));
  const intro = h('p', { class: 'muted' }, tab === 'character'
    ? 'Cada personagem tem a aparência fixa, a FOLHA DE PERSONAGEM (frente, perfil, costas e expressões — mantém o mesmo rosto e roupa em todas as cenas), a voz, variações por episódio (roupa, idade) e, para vídeos por código, o desenho em código e modelos 3D.'
    : tab === 'location' ? 'Cenários fixos: o mesmo lugar sempre igual (planta, móveis, luz). A folha mostra plano geral, contraplano e detalhe; ela vai como referência nas cenas que se passam ali. Modelos 3D servem às cenas por código.'
      : 'Objetos importantes da história: a folha mostra três vistas (frente, lado, cima/trás) e um detalhe; o objeto fica com a mesma forma, cor e material em todas as cenas. Modelos 3D (GLB/GLTF/OBJ/FBX) entram nas cenas por código.');
  const cards = h('div', { class: 'chr-list' }, ...filtered.map((x) => {
    const img = charImage(forge, x);
    return h('div', { class: `chr-card${x.id === selected ? ' on' : ''}`, 'data-char': x.id, onclick: () => { selected = x.id; again(); } },
      img ? h('img', { src: img, alt: '' }) : h('div', { class: 'chr-ph' }, x.name.slice(0, 1).toUpperCase()),
      h('b', {}, x.name), h('span', { class: 'muted small' }, tab === 'character' ? KIND_LABEL[x.kind] ?? x.kind : STYLE_LABEL[x.kind] ?? ''),
      h('span', { class: 'chr-badges' }, x.sheet ? h('span', { class: 'ch-badge ok' }, 'folha ✓') : h('span', { class: 'ch-badge warn' }, 'sem folha'),
        x.voice?.refAudio || x.voice?.apiVoice ? h('span', { class: 'ch-badge ok' }, 'voz ✓') : null,
        x.variants?.length ? h('span', { class: 'ch-badge' }, `${x.variants.length} variação(ões)`) : null,
        x.models?.length ? h('span', { class: 'ch-badge ok' }, '3D ✓') : null,
        x.storyId ? h('span', { class: 'ch-badge' }, '📖') : null));
  }));
  main.replaceChildren(head, tabsEl, subTabs, intro, h('div', { class: 'chr-cols' }, filtered.length || selected === 'new' ? cards : h('div', { class: 'card muted' }, `Nada ainda. Clique em "＋ Novo ${noun}" ou importe uma história na aba 📖 Histórias.`),
    selected === 'new' || cur ? await editor(c, cur, again, tab) : h('div', {})));
}

async function editor(c: CharactersCtx, ch: CharRow | undefined, again: () => void, entity: Entity): Promise<HTMLElement> {
  const { forge, guard, toast } = c;
  const isChar = entity === 'character';
  const noun = entity === 'location' ? 'cenário' : entity === 'prop' ? 'objeto' : 'personagem';
  const meta = ((await guard(() => forge['meta']())) as { voices?: Array<{ name: string; path: string }> } | undefined);
  const voices = meta?.voices ?? [];
  const name = h('input', { value: ch?.name ?? '', placeholder: isChar ? 'Nome (ex.: Ji-woo)' : entity === 'location' ? 'Nome do lugar (ex.: Café da esquina)' : 'Nome do objeto (ex.: Colar de jade)' }) as HTMLInputElement;
  const labels = isChar ? KIND_LABEL : STYLE_LABEL;
  const kind = h('select', {}, ...Object.entries(labels).map(([v, l]) => h('option', { value: v, ...(v === (ch?.kind ?? (isChar ? 'pessoa' : 'outro')) ? { selected: true } : {}) }, l))) as HTMLSelectElement;
  const gender = h('select', {}, ...[['', '—'], ['f', 'feminino'], ['m', 'masculino']].map(([v, l]) => h('option', { value: v!, ...(v === (ch?.gender ?? '') ? { selected: true } : {}) }, l!))) as HTMLSelectElement;
  const age = h('input', { value: ch?.age ?? '', placeholder: 'ex.: 25 anos' }) as HTMLInputElement;
  const look = h('textarea', { rows: '3', placeholder: isChar ? 'Aparência FIXA, objetiva (vai em todos os prompts): mulher coreana de 25 anos, cabelo preto liso na altura dos ombros, franja, olhos castanhos, casaco bege, blusa branca, beleza natural'
    : entity === 'location' ? 'Aparência FIXA do lugar: café pequeno de esquina, paredes de tijolo, balcão de madeira escura à esquerda, janela grande à direita, luz quente de fim de tarde, plantas penduradas'
      : 'Aparência FIXA do objeto: colar com pingente de jade verde-claro oval, corrente fina de prata, fecho em forma de folha' }) as HTMLTextAreaElement;
  look.value = ch?.look ?? '';
  const desc = h('textarea', { rows: '2', placeholder: isChar ? 'Personalidade, papel na história, jeito de falar (opcional)' : 'Função na história (opcional)' }) as HTMLTextAreaElement;
  desc.value = ch?.description ?? '';
  const refAudio = h('select', {}, h('option', { value: '' }, '— sem voz clonada —'), ...voices.map((v) => h('option', { value: v.path, ...(v.path === ch?.voice?.refAudio ? { selected: true } : {}) }, v.name))) as HTMLSelectElement;
  const apiVoice = h('input', { value: ch?.voice?.apiVoice ?? '', placeholder: 'voz de API (ex.: nova, onyx, Kore)' }) as HTMLInputElement;
  const voiceDesc = h('input', { value: ch?.voice?.description ?? '', placeholder: 'como soa: feminina, 25 anos, doce e hesitante' }) as HTMLInputElement;
  const code = h('textarea', { rows: '2', placeholder: 'Desenho por código (vídeos em código): formas, cores hex, traço, proporções' }) as HTMLTextAreaElement;
  code.value = ch?.code ?? '';
  const drawBtn = h('button', { class: 'small', id: 'chr-draw-code', title: 'Desenha este código sem pedir outro desenho à IA (mostra a prévia para aceitar)' }, '🖼 Desenhar este código') as HTMLButtonElement;
  const genCodeBtn = h('button', { class: 'small', title: 'A IA escreve o desenho em código, desenha e mostra a prévia para você aceitar ou gerar outra' }, '✨ Gerar código com IA') as HTMLButtonElement;
  const previewBox = h('div', { class: 'chr-code-preview' });
  /* imagem de referência OPCIONAL: o modelo olha a imagem e cria algo SEMELHANTE (silhueta, roupa, paleta) */
  let refImage = '';
  const refThumb = h('img', { class: 'chr-ref-thumb', alt: 'imagem de referência' }) as HTMLImageElement;
  const refName = h('span', { class: 'muted small' }, 'nenhuma');
  const refRow = h('div', { class: 'row chr-ref-row' });
  const paintRef = () => {
    refThumb.style.display = refImage ? '' : 'none';
    if (refImage) refThumb.src = forge.mediaUrl(refImage);
    refRow.replaceChildren(...(refImage
      ? [refThumb, refName, h('button', { class: 'small', onclick: () => { refImage = ''; paintRef(); } }, '✕ remover')]
      : [refName]));
  };
  const pickRef = () => void guard(async () => {
    const f = (await forge['pickImage']({ title: 'Imagem de referência (opcional)' })) as string | null;
    if (!f) return;
    refImage = f; refName.textContent = f.split(/[\\/]/).pop() ?? 'imagem'; paintRef();
  });
  const useItemRef = () => {
    const f = ch?.portrait ?? ch?.sheet ?? ch?.images?.[0];
    if (!ch || !f) return;
    refImage = `${ch.dir}/${f}`; refName.textContent = 'retrato/folha deste item'; paintRef();
  };
  paintRef();
  let lastPreview: { code?: string; png?: string; error?: string } | undefined;
  let previewTries = 0;
  let lastMode: 'generate' | 'draw' = 'generate';
  const acceptPreview = () => void guard(async () => {
    if (!lastPreview?.png) return;
    if (lastMode !== 'draw') code.value = lastPreview.code ?? code.value;
    const saved = (await guard(() => forge['charactersSave'](collect()))) as CharRow | undefined;
    if (!saved) return;
    await forge['charactersAddGeneratedImage'](saved.id, lastPreview.png, isChar ? 'portrait' : 'sheet');
    /* guarda também a imagem de referência usada (se veio de fora do item), para reaproveitar depois */
    if (refImage && !refImage.startsWith(saved.dir)) {
      try { await forge['charactersAddGeneratedImage'](saved.id, refImage, 'extra'); } catch { /* referência opcional: se falhar, o item já está salvo */ }
    }
    selected = saved.id;
    toast(`${noun[0]!.toUpperCase()}${noun.slice(1)} salvo com a prévia na Biblioteca`);
    again();
  });
  const genPreview = (mode: 'generate' | 'draw' = 'generate') => void guard(async () => {
    lastMode = mode;
    const fromCode = mode === 'draw' ? code.value.trim() : '';
    if (mode === 'draw' && !fromCode) { toast('Escreva (ou gere) o código antes de desenhar.', true); return; }
    if (!fromCode && (!name.value.trim() || !look.value.trim())) { toast('Preencha o nome e a aparência antes de gerar o código.', true); return; }
    genCodeBtn.disabled = true;
    genCodeBtn.textContent = mode === 'draw' ? '⏳ desenhando…' : '⏳ gerando e desenhando…';
    previewBox.replaceChildren(h('div', { class: 'muted small' }, mode === 'draw' ? '⏳ desenhando o código que está no campo…' : '⏳ a IA está escrevendo o código e desenhando a prévia…'));
    try {
      const r = (await forge['charactersPreviewCode']({ name: name.value, look: look.value, entity, kind: kind.value, previous: lastPreview?.code, refImage: refImage || undefined, fromCode: fromCode || undefined })) as { code?: string; png?: string; error?: string; binding?: string } | undefined;
      if (!r || r.error) {
        lastPreview = r;
        previewBox.replaceChildren(h('div', { class: 'muted' }, `⚠ ${r?.error ?? 'não consegui gerar a prévia'}`),
          h('div', { class: 'row' }, h('button', { class: 'small', onclick: () => genPreview(lastMode) }, triesLabel()), h('button', { class: 'small', onclick: () => previewBox.replaceChildren() }, 'Fechar')));
        return;
      }
      lastPreview = r; previewTries++;
      previewBox.replaceChildren(
        h('div', { class: 'row' }, h('strong', { class: 'grow' }, '🖼 Prévia do desenho'), h('span', { class: 'muted small' }, `${r.binding ? `gerado com ${r.binding} · ` : ''}versão ${previewTries}`)),
        ...(r.png ? [h('img', { class: 'chr-preview-img', src: forge.mediaUrl(r.png), alt: 'prévia do desenho por código' })] : []),
        h('div', { class: 'muted small' }, r.code ?? code.value),
        h('div', { class: 'row' }, h('button', { class: 'primary small', id: 'chr-preview-accept', onclick: acceptPreview }, '✓ Aceitar e salvar'), h('button', { class: 'small', onclick: () => genPreview(lastMode) }, '↻ Desenhar outro'),
          h('span', { class: 'sp' }), h('button', { class: 'small', onclick: () => previewBox.replaceChildren() }, 'Fechar')));
    } finally { genCodeBtn.disabled = false; genCodeBtn.textContent = '✨ Gerar código com IA'; }
  });
  const triesLabel = () => '↻ Tentar de novo';
  genCodeBtn.addEventListener('click', () => genPreview('generate'));
  drawBtn.addEventListener('click', () => genPreview('draw'));
  /* importar imagens/modelos de uma vez (arquivos ou pasta inteira) — salva o item antes, se for novo */
  const importInto = (method: 'charactersAddFiles' | 'charactersAddFolder', what: string) => void guard(async () => {
    const saved = ch ?? await save();
    if (!saved) return;
    const r = (await forge[method](saved.id)) as { files?: number } | null;
    if (r) { toast(typeof r.files === 'number' ? `${r.files} arquivo(s) importado(s)` : `${what} importado(s)`); again(); }
  });
  const importBar = h('div', { class: 'row' },
    h('button', { class: 'small', title: 'Imagens (folha/retrato/referência) ou modelos 3D, vários de uma vez', onclick: () => importInto('charactersAddFiles', 'Arquivos') }, '🖼 Importar imagens/modelos…'),
    h('button', { class: 'small', title: 'Importa uma pasta inteira (imagens e modelos 3D, recursivo)', onclick: () => importInto('charactersAddFolder', 'Pasta') }, '📁 Importar pasta…'),
    h('span', { class: 'muted small' }, 'vai para referências/modelos do item; use “Enviar folha” para escolher a folha principal'));
  const aliases = h('input', { value: (ch?.aliases ?? []).join(', '), placeholder: 'outros nomes/apelidos no texto' }) as HTMLInputElement;
  const tags = h('input', { value: (ch?.tags ?? []).join(', '), placeholder: 'etiquetas: dorama, protagonista, romance' }) as HTMLInputElement;
  /* variações (roupa, idade, ferimento) — por episódio */
  const vrows: Array<{ label: HTMLInputElement; look: HTMLInputElement; eps: HTMLInputElement; id?: string; sheet?: string }> = [];
  const vlist = h('div', { class: 'chr-variants' });
  const addVariant = (v?: Variant) => {
    const row = { label: h('input', { value: v?.label ?? '', placeholder: 'rótulo (ex.: vestido de noiva)' }) as HTMLInputElement,
      look: h('input', { value: v?.look ?? '', placeholder: 'aparência nesta variação (o rosto é o mesmo)' }) as HTMLInputElement,
      eps: h('input', { value: (v?.episodes ?? []).join(', '), placeholder: 'episódios: 3, 4', class: 'num' }) as HTMLInputElement, id: v?.id, sheet: v?.sheet };
    vrows.push(row);
    const img = v?.sheet && ch ? h('img', { class: 'chr-vimg', src: forge.mediaUrl(`${ch.dir}/${v.sheet}`), alt: '' }) : null;
    const el = h('div', { class: 'row chr-variant' }, img, row.label, row.look, row.eps,
      v?.id && ch ? h('button', { class: 'small', title: 'Gerar a folha desta variação', onclick: () => void genSheet(v.id) }, '✨ Folha') : null,
      v?.id && ch ? h('button', { class: 'small', title: 'Enviar a folha desta variação', onclick: () => void guard(async () => { if (await forge['charactersAddImage'](ch.id, `variant:${v.id}`)) { toast('Folha da variação salva'); again(); } }) }, '⬆') : null,
      h('button', { class: 'small', onclick: () => { vrows.splice(vrows.indexOf(row), 1); el.remove(); } }, '✕'));
    vlist.append(el);
  };
  for (const v of ch?.variants ?? []) addVariant(v);
  const collect = () => ({ id: ch?.id, entity, name: name.value, kind: kind.value, gender: isChar ? gender.value || undefined : undefined, age: isChar ? age.value : undefined, look: look.value, description: desc.value,
    voice: isChar ? { refAudio: refAudio.value || undefined, apiVoice: apiVoice.value, description: voiceDesc.value } : undefined, code: code.value,
    aliases: aliases.value.split(',').map((t) => t.trim()).filter(Boolean), tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    variants: isChar ? vrows.map((r) => ({ label: r.label.value, look: r.look.value, episodes: r.eps.value.split(/[,\s]+/).map(Number).filter((n) => n > 0) })).filter((v) => v.label.trim() && v.look.trim()) : undefined });
  const save = async () => {
    const r = (await guard(() => forge['charactersSave'](collect()))) as CharRow | undefined;
    if (r) { selected = r.id; toast(ch ? `${noun[0]!.toUpperCase()}${noun.slice(1)} salvo` : `${noun[0]!.toUpperCase()}${noun.slice(1)} criado`); again(); }
    return r;
  };
  /* folha: gerar (executor de imagem) ou enviar a sua */
  const img = ch ? charImage(forge, ch) : undefined;
  const cat = ((await guard(() => forge['catalog']())) ?? { workflows: [], wan2gpTemplates: [], apis: [], flowAccounts: [] }) as { workflows: Array<{ file: string; label: string; capability: string }>; wan2gpTemplates: Array<{ file: string; label: string; capability: string }>; apis: Array<{ provider: string; categories: string[]; models: string[]; voices?: string[] }>; flowAccounts?: Array<{ id: string; label: string }> };
  const opts: Array<[string, unknown]> = [
    ...cat.workflows.filter((w) => w.capability === 'image').map((w): [string, unknown] => [`🖥️ ComfyUI · ${w.label}`, { type: 'comfyui', server: 'local', workflow: w.file }]),
    ...cat.wan2gpTemplates.filter((w) => w.capability === 'image').map((w): [string, unknown] => [`🌀 Wan2GP · ${w.label}`, { type: 'wan2gp', template: w.file }]),
    ['🌊 Google Flow (Nano Banana)', { type: 'flow' }],
    ...cat.apis.filter((a) => a.categories.includes('image')).map((a): [string, unknown] => [`☁️ API ${a.provider}`, { type: 'api', provider: a.provider, model: a.models.find((m) => /image|imagen|banana|dall/i.test(m)) ?? a.models[0] }]),
  ];
  const gen = h('select', {}, ...opts.map(([l], i) => h('option', { value: String(i) }, l))) as HTMLSelectElement;
  const genBtn = h('button', { class: 'small primary', title: 'Gera a folha de referência com o executor escolhido' }, '✨ Gerar folha') as HTMLButtonElement;
  const genSheet = async (variantId?: string) => guard(async () => {
    const saved = await save(); if (!saved) return;
    genBtn.disabled = true; genBtn.textContent = '⏳ gerando (pode levar minutos)…';
    try { await forge['charactersGenerateSheet'](saved.id, opts[Number(gen.value)]?.[1], variantId); toast('Folha gerada'); again(); }
    finally { genBtn.disabled = false; genBtn.textContent = '✨ Gerar folha'; }
  });
  genBtn.addEventListener('click', () => void genSheet());
  const sheetBox = ch ? h('div', { class: 'chr-sheet' },
    img ? h('img', { src: img, alt: 'folha de referência' }) : h('div', { class: 'muted' }, 'Sem folha ainda. Gere com um executor de imagem ou envie a sua (feita no ChatGPT, Gemini, Flow…).'),
    h('div', { class: 'row' }, gen, genBtn,
      h('button', { class: 'small', onclick: () => void guard(async () => { const r = await forge['charactersAddImage'](ch.id, 'sheet'); if (r) { toast('Folha atualizada'); again(); } }) }, '⬆ Enviar folha'),
      isChar ? h('button', { class: 'small', onclick: () => void guard(async () => { const r = await forge['charactersAddImage'](ch.id, 'portrait'); if (r) { toast('Retrato atualizado'); again(); } }) }, '⬆ Retrato') : null,
      h('button', { class: 'small', title: 'Copia o pedido da folha para usar no ChatGPT/Gemini/Flow', onclick: () => void guard(async () => { const p = (await forge['charactersSheetPrompt'](ch.id)) as string; await forge['copyText']?.(p); toast('Pedido da folha copiado'); }) }, '⧉ Copiar pedido')),
    isChar ? h('div', { class: 'muted small' }, 'Dica do método: aparência "beleza natural" e sem lembrar ninguém famoso — o Google Flow recusa rostos parecidos com celebridades.') : null) : h('div', { class: 'muted small' }, `Salve o ${noun} para gerar ou enviar a folha.`);
  /* modelos 3D (cenas por código) */
  const modelsBox = ch ? h('div', { class: 'chr-models' },
    ...(ch.models ?? []).map((m) => h('span', { class: 'ch-badge ok' }, `🧊 ${m}`, h('button', { class: 'small', title: 'Remover', onclick: () => void guard(async () => { await forge['charactersRemoveModel'](ch.id, m); again(); }) }, '✕'))),
    h('button', { class: 'small', onclick: () => void guard(async () => { if (await forge['charactersAddModel'](ch.id)) { toast('Modelo 3D adicionado'); again(); } }) }, '⬆ Adicionar modelo 3D (GLB/GLTF/OBJ/FBX)'),
    h('div', { class: 'muted small' }, 'Nas cenas por código (Three.js) o modelo é copiado para o projeto e o prompt manda carregar ESTE arquivo em vez de modelar à mão.')) : h('div', { class: 'muted small' }, `Salve o ${noun} para adicionar modelos 3D.`);
  /* teste da voz do personagem (ouvir falando + salvar o teste) */
  const testBar = voiceTestBar(forge, guard);
  const ttsOpts: Array<[string, unknown]> = [
    ...cat.workflows.filter((w) => w.capability === 'voice').map((w): [string, unknown] => [`🖥️ ComfyUI · ${w.label}`, { type: 'comfyui', server: 'local', workflow: w.file }]),
    ...cat.wan2gpTemplates.filter((w) => w.capability === 'voice').map((w): [string, unknown] => [`🌀 Wan2GP · ${w.label}`, { type: 'wan2gp', template: w.file }]),
    ...cat.apis.filter((a) => a.categories.includes('voice')).map((a): [string, unknown] => [`☁️ API ${a.provider}`, { type: 'api', provider: a.provider, model: a.models.find((m) => /tts|speech|voice/i.test(m)) ?? a.models[0] }]),
  ];
  const ttsSel = h('select', {}, ...ttsOpts.map(([l], i) => h('option', { value: String(i) }, l))) as HTMLSelectElement;
  const speakBtn = h('button', { class: 'small', title: 'Gera uma frase com esta voz (a do campo "Frase do teste" ou a padrão)' }, '🗣 Ouvir falando') as HTMLButtonElement;
  speakBtn.addEventListener('click', () => void guard(async () => {
    const base = ttsOpts[Number(ttsSel.value)]?.[1] as Record<string, unknown> | undefined;
    if (!base) { toast('Nenhum motor de voz configurado (Provedores)', true); return; }
    const b = { ...base, ...(base['type'] === 'api' ? (apiVoice.value.trim() ? { voice: apiVoice.value.trim() } : {}) : refAudio.value ? { refAudio: refAudio.value } : {}) };
    speakBtn.disabled = true; speakBtn.textContent = '⏳ gerando…';
    try { const f = (await forge['voicePreview']({ binding: b, language: 'pt-BR', text: currentTestText() })) as string; testBar.show(f, `${name.value || 'voz'}`); }
    finally { speakBtn.disabled = false; speakBtn.textContent = '🗣 Ouvir falando'; }
  }));
  const voiceSec = isChar ? [
    h('h4', {}, '🎙 Voz'),
    h('div', { class: 'ch-grid' }, h('label', {}, 'Voz clonada (pasta voices)', refAudio), h('label', {}, 'Voz de API', apiVoice), h('label', { class: 'ch-wide' }, 'Como soa', voiceDesc)),
    h('div', { class: 'row' }, h('button', { class: 'small', title: 'Ouvir o arquivo de referência', onclick: () => { if (refAudio.value) testBar.show(refAudio.value, `arquivo ${refAudio.selectedOptions[0]?.textContent ?? ''}`); else toast('Escolha uma voz clonada', true); } }, '▶ Ouvir o arquivo'),
      ttsSel, speakBtn),
    h('label', {}, '🧪 Frase do teste', voiceTestText()),
    testBar,
  ] : [];
  return h('div', { class: 'card chr-edit' },
    h('h3', {}, ch ? `✏️ ${ch.name}` : `＋ Novo ${noun}`),
    h('div', { class: 'ch-grid' },
      h('label', {}, 'Nome *', name), h('label', {}, isChar ? 'Tipo' : 'Estilo', kind),
      isChar ? h('label', {}, 'Gênero', gender) : null, isChar ? h('label', {}, 'Idade', age) : null,
      h('label', { class: 'ch-wide' }, 'Aparência fixa *', look), h('label', { class: 'ch-wide' }, 'Descrição', desc)),
    h('h4', {}, isChar ? '🖼 Folha de personagem' : entity === 'location' ? '🖼 Folha do cenário' : '🖼 Folha do objeto (três vistas)'), sheetBox, importBar,
    ...voiceSec,
    isChar ? h('h4', {}, '👗 Variações (por episódio)') : null,
    isChar ? h('div', { class: 'muted small' }, 'Mesma pessoa com outra roupa, idade ou estado. No episódio da série, a variação escolhida troca a aparência (e a folha, se tiver).') : null,
    isChar ? vlist : null,
    isChar ? h('button', { class: 'small', onclick: () => addVariant() }, '＋ Variação') : null,
    h('h4', {}, '💻 Em vídeos por código'), code,
    h('div', { class: 'row' },
      h('button', { class: 'small', title: 'Opcional: escolha uma imagem e a IA desenha em código algo semelhante (silhueta, roupa, paleta)', onclick: pickRef }, '🖼 Referência (opcional)'),
      ch && (ch.portrait || ch.sheet || ch.images?.length) ? h('button', { class: 'small', title: 'Usar o retrato/folha já salvo neste item como referência', onclick: useItemRef }, '↩ Usar o retrato do item') : null,
      refRow),
    h('div', { class: 'muted small' }, 'Com referência, a IA olha a imagem e cria um desenho SEMELHANTE (mesma silhueta, roupa e paleta) — não copia pixels.'),
    h('div', { class: 'row' }, genCodeBtn, drawBtn), previewBox,
    h('h4', {}, '🧊 Modelos 3D'), modelsBox,
    h('div', { class: 'ch-grid' }, h('label', {}, 'Apelidos', aliases), h('label', {}, 'Etiquetas', tags)),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => void save() }, ch ? 'Salvar' : `Criar ${noun}`), h('span', { class: 'sp' }),
      ch ? h('button', { class: 'small danger', onclick: () => void guard(async () => { if (!await askConfirm(`Excluir "${ch.name}" e as imagens/modelos dele? Projetos já criados continuam com a cópia.`)) return; await forge['charactersDelete'](ch.id); selected = undefined; toast('Excluído'); again(); }) }, '🗑 Excluir') : null));
}
