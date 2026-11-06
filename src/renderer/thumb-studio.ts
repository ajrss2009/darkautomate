import type { Project, ThumbnailTemplate } from '../shared/types';
import { THUMB_DESIGN_TEMPLATES, THUMB_LAYOUTS, thumbTree, type TNode, type ThumbDesign, type ThumbFont } from '../shared/thumbdesign';

/*
 * ESTÚDIO DE THUMBNAIL (editor): escolhe o layout visual, o texto, as cores, a fonte, o quadro do vídeo e o ponto de
 * foco, com prévia ao vivo idêntica ao PNG final (mesma árvore de shared/thumbdesign.ts). "Aplicar" grava
 * out/thumbnail.png; "Salvar como template" deixa o desenho disponível para os próximos projetos.
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
export interface ThumbCtx { forge: Api; toast: (m: string, bad?: boolean) => void; guard: <T>(fn: () => Promise<T>) => Promise<T | undefined> }

/** DOM da árvore do layout (estilos via CSSOM: a política de segurança da janela bloqueia CSS inline em texto). */
export function buildThumbDom(n: TNode): HTMLElement {
  const el = document.createElement(n.tag);
  for (const [k, v] of Object.entries(n.style)) el.style.setProperty(k, v);
  if (n.tag === 'img') { (el as HTMLImageElement).src = n.src ?? ''; (el as HTMLImageElement).alt = ''; el.draggable = false; }
  if (n.text !== undefined) el.textContent = n.text;
  for (const c of n.children ?? []) el.append(buildThumbDom(c));
  return el;
}

/** Prévia escalada (largura `width` px) de um desenho no tamanho real w×h. */
export function thumbPreview(d: ThumbDesign, o: { w: number; h: number; text: string; bg?: string; bg2?: string }, width: number): HTMLElement {
  const k = width / o.w;
  const inner = buildThumbDom(thumbTree(d, o));
  inner.style.transform = `scale(${k})`; inner.style.transformOrigin = '0 0';
  const outer = h('div', { class: 'thumb-pv' }, inner);
  outer.style.width = `${Math.round(width)}px`; outer.style.height = `${Math.round(o.h * k)}px`;
  return outer;
}

/** Cartões dos templates VISUAIS (para o seletor de template do novo projeto). */
export function designTemplateCards(current: string, onPick: (id: string) => void, sample = 'TEXTO DA THUMB'): HTMLElement {
  return h('div', { class: 'tgrid', id: 'thumb-designs' }, ...THUMB_DESIGN_TEMPLATES.map((t) => h('button', { class: `tcard${t.id === current ? ' sel' : ''}`, 'data-thumb': t.id, onclick: () => onPick(t.id) },
    thumbPreview(t.design, { w: 1280, h: 720, text: sample }, 200), h('strong', {}, t.name), h('span', { class: 'muted' }, THUMB_LAYOUTS.find((l) => l.id === t.design.layout)?.hint ?? ''))));
}

const FONTS: Array<[ThumbFont, string]> = [['impact', 'Impact (grossa)'], ['sans', 'Black (sem serifa)'], ['serif', 'Serifada (elegante)'], ['rounded', 'Arredondada']];

/** Abre o estúdio de thumbnail do projeto. */
export async function openThumbStudio(c: ThumbCtx, p: Project, onApplied: () => void): Promise<void> {
  const info = await c.guard(() => c.forge['thumbInfo']!(p.id)) as { duration: number; autoTime: number; text: string; design?: ThumbDesign; size: { w: number; h: number }; current?: string } | undefined;
  if (!info) return;
  const { w, h: H } = info.size;
  let d: ThumbDesign = { ...(info.design ?? THUMB_DESIGN_TEMPLATES[0]!.design) };
  if (!d.text) d.text = info.text;
  let bg = '', bg2 = '';
  const frameAt = async (t: number) => c.forge.mediaUrl(await c.forge['thumbFrame']!(p.id, t) as string);
  const dur = Math.max(0.1, info.duration);
  const t1 = () => d.frame ?? info.autoTime;
  const t2 = () => d.frame2 ?? Math.min(dur - 0.5, t1() < dur / 2 ? dur * 0.85 : dur * 0.15);

  const stage = h('div', { class: 'ts-stage', id: 'ts-stage' });
  const tiles = h('div', { class: 'ts-tiles', id: 'ts-tiles' });
  const paint = () => {
    const o = { w, h: H, text: d.text ?? info.text, bg: bg || undefined, bg2: bg2 || undefined };
    stage.replaceChildren(thumbPreview(d, o, Math.min(640, window.innerWidth * 0.48)));
    tiles.replaceChildren(...THUMB_LAYOUTS.map((l) => h('button', { class: `ts-tile${l.id === d.layout ? ' sel' : ''}`, 'data-layout': l.id, title: l.hint, onclick: () => {
      const tpl = THUMB_DESIGN_TEMPLATES.find((t) => t.design.layout === l.id)?.design;
      /* o layout novo traz as cores, a fonte e o selo dele; o texto, os quadros, o foco e o zoom continuam os seus */
      if (l.id !== d.layout) d = { ...(tpl ?? { layout: l.id }), layout: l.id, text: d.text, sub: d.sub, frame: d.frame, frame2: d.frame2, focus: d.focus ?? tpl?.focus, zoom: d.zoom };
      if (l.id === 'split' && !bg2) void loadBg2();
      paint(); syncInputs();
    } }, thumbPreview({ ...d, layout: l.id, badge: THUMB_DESIGN_TEMPLATES.find((t) => t.design.layout === l.id)?.design.badge ?? d.badge }, { ...o }, 150), h('span', {}, l.name))));
  };
  const loadBg = async () => { bg = await frameAt(t1()); paint(); };
  const loadBg2 = async () => { bg2 = await frameAt(t2()); paint(); };

  /* controles */
  const text = h('input', { id: 'ts-text', class: 'grow', placeholder: 'Texto principal (até 4 palavras funciona melhor)' }) as HTMLInputElement;
  const sub = h('input', { id: 'ts-sub', placeholder: 'Linha menor (opcional)' }) as HTMLInputElement;
  const badge = h('input', { id: 'ts-badge', placeholder: 'Selo (ex.: URGENTE, TOP 5)' }) as HTMLInputElement;
  const accent = h('input', { id: 'ts-accent', type: 'color' }) as HTMLInputElement;
  const color = h('input', { id: 'ts-color', type: 'color' }) as HTMLInputElement;
  const font = h('select', { id: 'ts-font' }, ...FONTS.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  const align = h('select', { id: 'ts-align' }, h('option', { value: 'left' }, 'Texto à esquerda'), h('option', { value: 'right' }, 'Texto à direita'), h('option', { value: 'center' }, 'Centralizado')) as HTMLSelectElement;
  const frame = h('input', { id: 'ts-frame', type: 'range', min: '0', max: String(dur), step: '0.1', class: 'grow' }) as HTMLInputElement;
  const frame2 = h('input', { id: 'ts-frame2', type: 'range', min: '0', max: String(dur), step: '0.1', class: 'grow' }) as HTMLInputElement;
  const fx = h('input', { id: 'ts-fx', type: 'range', min: '0', max: '1', step: '0.01', class: 'grow' }) as HTMLInputElement;
  const fy = h('input', { id: 'ts-fy', type: 'range', min: '0', max: '1', step: '0.01', class: 'grow' }) as HTMLInputElement;
  const zoom = h('input', { id: 'ts-zoom', type: 'range', min: '1', max: '1.8', step: '0.01', class: 'grow' }) as HTMLInputElement;
  const shade = h('input', { id: 'ts-shade', type: 'range', min: '0', max: '1', step: '0.05', class: 'grow' }) as HTMLInputElement;
  const fLbl = h('span', { class: 'muted small' }), f2Lbl = h('span', { class: 'muted small' });
  const row2 = h('label', { class: 'ts-ctl', id: 'ts-frame2-row' }, '2º quadro (direita)', frame2, f2Lbl);
  const syncInputs = () => {
    text.value = d.text ?? ''; sub.value = d.sub ?? ''; badge.value = d.badge ?? '';
    accent.value = d.accent ?? '#ffd400'; color.value = d.color ?? '#ffffff'; font.value = d.font ?? 'impact'; align.value = d.align ?? 'left';
    frame.value = String(t1()); frame2.value = String(t2()); fLbl.textContent = `${t1().toFixed(1)} s`; f2Lbl.textContent = `${t2().toFixed(1)} s`;
    fx.value = String(d.focus?.x ?? 0.5); fy.value = String(d.focus?.y ?? 0.5); zoom.value = String(d.zoom ?? 1.06); shade.value = String(d.shade ?? 0.55);
    row2.style.display = d.layout === 'split' ? '' : 'none';
  };
  let frameT = 0;
  const onFrame = (which: 1 | 2) => () => {
    const v = Number((which === 1 ? frame : frame2).value);
    if (which === 1) { d.frame = v; fLbl.textContent = `${v.toFixed(1)} s`; } else { d.frame2 = v; f2Lbl.textContent = `${v.toFixed(1)} s`; }
    window.clearTimeout(frameT); frameT = window.setTimeout(() => void c.guard(which === 1 ? loadBg : loadBg2), 220);
  };
  frame.addEventListener('input', onFrame(1)); frame2.addEventListener('input', onFrame(2));
  const live = (fn: () => void) => () => { fn(); paint(); };
  text.addEventListener('input', live(() => { d.text = text.value; }));
  sub.addEventListener('input', live(() => { d.sub = sub.value || undefined; }));
  badge.addEventListener('input', live(() => { d.badge = badge.value || undefined; }));
  accent.addEventListener('input', live(() => { d.accent = accent.value; }));
  color.addEventListener('input', live(() => { d.color = color.value; }));
  font.addEventListener('change', live(() => { d.font = font.value as ThumbFont; }));
  align.addEventListener('change', live(() => { d.align = align.value as ThumbDesign['align']; }));
  for (const [el, fn] of [[fx, () => { d.focus = { x: Number(fx.value), y: d.focus?.y ?? 0.5 }; }], [fy, () => { d.focus = { x: d.focus?.x ?? 0.5, y: Number(fy.value) }; }],
    [zoom, () => { d.zoom = Number(zoom.value); }], [shade, () => { d.shade = Number(shade.value); }]] as Array<[HTMLInputElement, () => void]>) el.addEventListener('input', live(fn));

  const close = () => bg0.remove();
  const status = h('span', { class: 'muted small', id: 'ts-status' });
  const apply = h('button', { class: 'primary', id: 'ts-apply', onclick: () => void c.guard(async () => {
    apply.setAttribute('disabled', ''); status.textContent = '⏳ desenhando a thumbnail…';
    try {
      await c.forge['thumbRender']!(p.id, d);
      c.toast('Thumbnail aplicada (out/thumbnail.png) — também vai para a pasta "publicar".'); close(); onApplied();
    } finally { apply.removeAttribute('disabled'); status.textContent = ''; }
  }) }, '✓ Aplicar no vídeo');
  const tplName = h('input', { id: 'ts-tpl-name', placeholder: 'Nome do template (opcional)' }) as HTMLInputElement;
  const saveTpl = h('button', { id: 'ts-save-tpl', title: 'Guarda este desenho (layout, cores, fonte, selo) como template para os próximos projetos', onclick: () => void c.guard(async () => {
    const name = tplName.value.trim() || `🎨 ${THUMB_LAYOUTS.find((l) => l.id === d.layout)?.name ?? 'Visual'} — ${p.name.slice(0, 24)}`;
    const s = await c.forge['getSettings']!() as { thumbnails?: ThumbnailTemplate[] };
    let id = 'v-' + (name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tpl'), n = 2;
    while ((s.thumbnails ?? []).some((x) => x.id === id) || THUMB_DESIGN_TEMPLATES.some((x) => x.id === id)) id = `${id}-${n++}`;
    const { text: _t, frame: _f, frame2: _f2, ...look } = d;
    const base = THUMB_DESIGN_TEMPLATES.find((t) => t.design.layout === d.layout);
    s.thumbnails = [...(s.thumbnails ?? []), { id, name, prompt: base?.prompt ?? 'thumbnail background about {{title}}, NO TEXT', design: look }];
    await c.forge['setSettings']!(s); c.toast(`Template "${name}" salvo`);
  }) }, '💾 Salvar como template');

  const bg0 = h('div', { class: 'modal-bg', id: 'thumb-studio', onclick: (e) => { if (e.target === bg0) close(); } },
    h('div', { class: 'modal ts-modal' },
      h('div', { class: 'row' }, h('h3', {}, '🎨 Estúdio de thumbnail'), h('span', { class: 'muted small' }, `${w}×${H} · prévia igual ao arquivo final`), h('span', { class: 'sp' }), h('button', { onclick: close }, '✕')),
      h('div', { class: 'ts-body' },
        h('div', { class: 'ts-left' }, stage, h('div', { class: 'muted small' }, 'Layouts'), tiles),
        h('div', { class: 'ts-right' },
          h('label', { class: 'ts-ctl' }, 'Texto', text), h('div', { class: 'row' }, sub, badge),
          h('div', { class: 'row' }, h('label', { class: 'inline' }, 'Destaque', accent), h('label', { class: 'inline' }, 'Texto', color), font, align),
          h('label', { class: 'ts-ctl' }, 'Quadro do vídeo', frame, fLbl), row2,
          h('label', { class: 'ts-ctl' }, 'Foco horizontal (círculo/zoom)', fx), h('label', { class: 'ts-ctl' }, 'Foco vertical', fy),
          h('label', { class: 'ts-ctl' }, 'Zoom do fundo', zoom), h('label', { class: 'ts-ctl' }, 'Escurecer atrás do texto', shade),
          h('div', { class: 'row actions' }, status, h('span', { class: 'sp' }), tplName, saveTpl, apply)))));
  document.body.append(bg0);
  syncInputs(); paint();
  await c.guard(async () => { await loadBg(); if (d.layout === 'split') await loadBg2(); });
}
