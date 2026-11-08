import { askConfirm } from './dialogs';

/*
 * Aba PERSONAGENS: biblioteca reutilizável (doramas, histórias e vídeos por código).
 * Cada personagem: aparência fixa, folha de personagem (frente/perfil/costas + expressões), voz (clonagem ou API),
 * como desenhar por código e etiquetas. No Novo projeto, os escolhidos viram o elenco do vídeo.
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
export interface CharactersCtx { forge: Api; toast: (m: string, bad?: boolean) => void; main: HTMLElement; guard: <T>(fn: () => Promise<T>) => Promise<T | undefined> }
export interface CharRow {
  id: string; name: string; kind: 'pessoa' | 'cartoon' | 'codigo' | 'animal' | 'outro'; description?: string; look: string; gender?: string; age?: string;
  voice?: { refAudio?: string; apiVoice?: string; description?: string }; code?: string; sheet?: string; portrait?: string; images?: string[]; tags?: string[]; dir: string;
}
export const KIND_LABEL: Record<CharRow['kind'], string> = { pessoa: '🧑 Pessoa (realista)', cartoon: '🎨 Cartoon / animação', codigo: '💻 Desenho por código', animal: '🐾 Animal / criatura', outro: '✨ Outro' };
export const charImage = (forge: Api, c: CharRow) => (c.sheet || c.portrait ? forge.mediaUrl(`${c.dir}/${c.sheet ?? c.portrait}`) : undefined);

let selected: string | undefined;

export async function renderCharactersPage(c: CharactersCtx): Promise<void> {
  const { forge, main, guard, toast } = c;
  const again = () => void renderCharactersPage(c);
  const list = ((await guard(() => forge['charactersList']())) ?? []) as CharRow[];
  if (selected && selected !== 'new' && !list.some((x) => x.id === selected)) selected = undefined;
  const cur = selected === 'new' ? undefined : list.find((x) => x.id === selected) ?? list[0];
  if (!selected && cur) selected = cur.id;
  const head = h('div', { class: 'row pagehead' }, h('h2', {}, '👥 Personagens'), h('span', { class: 'sp' }),
    h('span', { class: 'muted' }, `${list.length} personagem(ns)`), h('button', { class: 'primary', onclick: () => { selected = 'new'; again(); } }, '＋ Novo personagem'));
  const intro = h('p', { class: 'muted' }, 'Biblioteca reutilizável: cada personagem tem a aparência fixa, a FOLHA DE PERSONAGEM (frente, perfil, costas e expressões — a referência de imagem que mantém o mesmo rosto e a mesma roupa em todas as cenas) e a voz. Em Novo projeto, escolha os personagens: eles viram o elenco, a folha vai como referência (MiniMax H3, Wan2GP e Google Flow) e a voz fica fixa em todas as cenas.');
  const cards = h('div', { class: 'chr-list' }, ...list.map((x) => {
    const img = charImage(forge, x);
    return h('div', { class: `chr-card${x.id === selected ? ' on' : ''}`, 'data-char': x.id, onclick: () => { selected = x.id; again(); } },
      img ? h('img', { src: img, alt: '' }) : h('div', { class: 'chr-ph' }, x.name.slice(0, 1).toUpperCase()),
      h('b', {}, x.name), h('span', { class: 'muted small' }, KIND_LABEL[x.kind] ?? x.kind),
      h('span', { class: 'chr-badges' }, x.sheet ? h('span', { class: 'ch-badge ok' }, 'folha ✓') : h('span', { class: 'ch-badge warn' }, 'sem folha'),
        x.voice?.refAudio || x.voice?.apiVoice ? h('span', { class: 'ch-badge ok' }, 'voz ✓') : null));
  }));
  main.replaceChildren(head, intro, h('div', { class: 'chr-cols' }, list.length || selected === 'new' ? cards : h('div', { class: 'card muted' }, 'Nenhum personagem ainda. Clique em "＋ Novo personagem".'),
    selected === 'new' || cur ? await editor(c, cur, again) : h('div', {})));
  void toast;
}

async function editor(c: CharactersCtx, ch: CharRow | undefined, again: () => void): Promise<HTMLElement> {
  const { forge, guard, toast } = c;
  const voices = (((await guard(() => forge['meta']())) as { voices?: Array<{ name: string; path: string }> } | undefined)?.voices ?? []);
  const name = h('input', { value: ch?.name ?? '', placeholder: 'Nome (ex.: Ji-woo)' }) as HTMLInputElement;
  const kind = h('select', {}, ...Object.entries(KIND_LABEL).map(([v, l]) => h('option', { value: v, ...(v === (ch?.kind ?? 'pessoa') ? { selected: true } : {}) }, l))) as HTMLSelectElement;
  const gender = h('select', {}, ...[['', '—'], ['f', 'feminino'], ['m', 'masculino']].map(([v, l]) => h('option', { value: v!, ...(v === (ch?.gender ?? '') ? { selected: true } : {}) }, l!))) as HTMLSelectElement;
  const age = h('input', { value: ch?.age ?? '', placeholder: 'ex.: 25 anos' }) as HTMLInputElement;
  const look = h('textarea', { rows: '3', placeholder: 'Aparência FIXA, objetiva (vai em todos os prompts): mulher coreana de 25 anos, cabelo preto liso na altura dos ombros, franja, olhos castanhos, casaco bege, blusa branca, beleza natural' }) as HTMLTextAreaElement;
  look.value = ch?.look ?? '';
  const desc = h('textarea', { rows: '2', placeholder: 'Personalidade, papel na história, jeito de falar (opcional)' }) as HTMLTextAreaElement;
  desc.value = ch?.description ?? '';
  const refAudio = h('select', {}, h('option', { value: '' }, '— sem voz clonada —'), ...voices.map((v) => h('option', { value: v.path, ...(v.path === ch?.voice?.refAudio ? { selected: true } : {}) }, v.name))) as HTMLSelectElement;
  const apiVoice = h('input', { value: ch?.voice?.apiVoice ?? '', placeholder: 'voz de API (ex.: nova, onyx, Kore)' }) as HTMLInputElement;
  const voiceDesc = h('input', { value: ch?.voice?.description ?? '', placeholder: 'como soa: feminina, 25 anos, doce e hesitante' }) as HTMLInputElement;
  const code = h('textarea', { rows: '2', placeholder: 'Desenho por código (vídeos em código): cabeça redonda #f2c6a0, cabelo preto em franja, olhos de ponto, casaco bege #d8c3a5, traço 4 px preto' }) as HTMLTextAreaElement;
  code.value = ch?.code ?? '';
  const tags = h('input', { value: (ch?.tags ?? []).join(', '), placeholder: 'etiquetas: dorama, protagonista, romance' }) as HTMLInputElement;
  const collect = () => ({ id: ch?.id, name: name.value, kind: kind.value, gender: gender.value || undefined, age: age.value, look: look.value, description: desc.value,
    voice: { refAudio: refAudio.value || undefined, apiVoice: apiVoice.value, description: voiceDesc.value }, code: code.value, tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) });
  const save = async () => {
    const r = (await guard(() => forge['charactersSave'](collect()))) as CharRow | undefined;
    if (r) { selected = r.id; toast(ch ? 'Personagem salvo' : 'Personagem criado'); again(); }
    return r;
  };
  /* folha de personagem: gerar (executor de imagem) ou enviar a sua */
  const img = ch ? charImage(forge, ch) : undefined;
  const cat = ((await guard(() => forge['catalog']())) ?? { workflows: [], wan2gpTemplates: [], apis: [], flowAccounts: [] }) as { workflows: Array<{ file: string; label: string; capability: string }>; wan2gpTemplates: Array<{ file: string; label: string; capability: string }>; apis: Array<{ provider: string; categories: string[]; models: string[] }>; flowAccounts?: Array<{ id: string; label: string }> };
  const opts: Array<[string, unknown]> = [
    ...cat.workflows.filter((w) => w.capability === 'image').map((w): [string, unknown] => [`🖥️ ComfyUI · ${w.label}`, { type: 'comfyui', server: 'local', workflow: w.file }]),
    ...cat.wan2gpTemplates.filter((w) => w.capability === 'image').map((w): [string, unknown] => [`🌀 Wan2GP · ${w.label}`, { type: 'wan2gp', template: w.file }]),
    ['🌊 Google Flow (Nano Banana)', { type: 'flow' }],
    ...cat.apis.filter((a) => a.categories.includes('image')).map((a): [string, unknown] => [`☁️ API ${a.provider}`, { type: 'api', provider: a.provider, model: a.models.find((m) => /image|imagen|banana|dall/i.test(m)) ?? a.models[0] }]),
  ];
  const gen = h('select', {}, ...opts.map(([l], i) => h('option', { value: String(i) }, l))) as HTMLSelectElement;
  const genBtn = h('button', { class: 'small primary', title: 'Gera a folha (frente, perfil, costas e 3 expressões, fundo neutro) com o executor escolhido' }, '✨ Gerar folha de personagem') as HTMLButtonElement;
  genBtn.addEventListener('click', () => void guard(async () => {
    const saved = await save(); if (!saved) return;
    genBtn.disabled = true; genBtn.textContent = '⏳ gerando (pode levar minutos)…';
    try { await forge['charactersGenerateSheet'](saved.id, opts[Number(gen.value)]?.[1]); toast('Folha de personagem gerada'); again(); }
    finally { genBtn.disabled = false; genBtn.textContent = '✨ Gerar folha de personagem'; }
  }));
  const sheetBox = ch ? h('div', { class: 'chr-sheet' },
    img ? h('img', { src: img, alt: 'folha de personagem' }) : h('div', { class: 'muted' }, 'Sem folha ainda. Gere com um executor de imagem ou envie a sua (feita no ChatGPT, Gemini, Flow…).'),
    h('div', { class: 'row' }, gen, genBtn,
      h('button', { class: 'small', onclick: () => void guard(async () => { const r = await forge['charactersAddImage'](ch.id, 'sheet'); if (r) { toast('Folha atualizada'); again(); } }) }, '⬆ Enviar folha'),
      h('button', { class: 'small', onclick: () => void guard(async () => { const r = await forge['charactersAddImage'](ch.id, 'portrait'); if (r) { toast('Retrato atualizado'); again(); } }) }, '⬆ Retrato'),
      h('button', { class: 'small', title: 'Copia o pedido da folha para usar no ChatGPT/Gemini/Flow', onclick: () => void guard(async () => { const p = (await forge['charactersSheetPrompt'](ch.id)) as string; await forge['copyText']?.(p); toast('Pedido da folha copiado'); }) }, '⧉ Copiar pedido da folha')),
    h('div', { class: 'muted small' }, 'Dica do método: aparência "beleza natural" e sem lembrar ninguém famoso — o Google Flow recusa rostos parecidos com celebridades.')) : h('div', { class: 'muted small' }, 'Salve o personagem para gerar ou enviar a folha.');
  return h('div', { class: 'card chr-edit' },
    h('h3', {}, ch ? `✏️ ${ch.name}` : '＋ Novo personagem'),
    h('div', { class: 'ch-grid' },
      h('label', {}, 'Nome *', name), h('label', {}, 'Tipo', kind), h('label', {}, 'Gênero', gender), h('label', {}, 'Idade', age),
      h('label', { class: 'ch-wide' }, 'Aparência fixa *', look), h('label', { class: 'ch-wide' }, 'Descrição', desc)),
    h('h4', {}, '🖼 Folha de personagem'), sheetBox,
    h('h4', {}, '🎙 Voz'),
    h('div', { class: 'ch-grid' }, h('label', {}, 'Voz clonada (pasta voices)', refAudio), h('label', {}, 'Voz de API', apiVoice), h('label', { class: 'ch-wide' }, 'Como soa', voiceDesc)),
    h('h4', {}, '💻 Em vídeos por código'), code,
    h('label', {}, 'Etiquetas', tags),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => void save() }, ch ? 'Salvar' : 'Criar personagem'), h('span', { class: 'sp' }),
      ch ? h('button', { class: 'small danger', onclick: () => void guard(async () => { if (!await askConfirm(`Excluir o personagem "${ch.name}" e as imagens dele? Projetos já criados continuam com a cópia.`)) return; await forge['charactersDelete'](ch.id); selected = undefined; toast('Personagem excluído'); again(); }) }, '🗑 Excluir') : null));
}
