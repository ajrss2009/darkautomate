/*
 * Thumbnails VISUAIS por código: layouts desenhados em HTML/CSS por cima de um quadro do vídeo (ou da imagem gerada
 * pela IA). O mesmo desenho serve para a prévia ao vivo do editor (DOM montado pelo renderer) e para o PNG final
 * (HTML renderizado pelo app) — por isso o layout é uma árvore de nós com estilos, sem CSS solto. Funções puras.
 */

export type ThumbLayout = 'impacto' | 'titulo' | 'manchete' | 'circulo' | 'split' | 'documentario' | 'neon' | 'contagem' | 'minimal';
export type ThumbFont = 'impact' | 'sans' | 'serif' | 'rounded';

export interface ThumbDesign {
  layout: ThumbLayout;
  /** texto principal (vazio = o "texto da thumbnail" do SEO ou as 3 primeiras palavras do título) */
  text?: string;
  /** linha menor (data, lugar, "PARTE 2"…) */
  sub?: string;
  /** selo no canto (ex.: "URGENTE", "EXCLUSIVO", "TOP 5") */
  badge?: string;
  /** cor de destaque (selo, palavra em destaque, círculo, faixa) */
  accent?: string;
  /** cor do texto principal */
  color?: string;
  font?: ThumbFont;
  align?: 'left' | 'right' | 'center';
  /** segundo do vídeo usado no fundo (vazio = escolha automática) e o 2º quadro do layout "split" */
  frame?: number;
  frame2?: number;
  /** ponto de foco (0..1) — onde o círculo/seta aponta e para onde o zoom do fundo puxa */
  focus?: { x: number; y: number };
  /** zoom do fundo (1 = sem zoom) */
  zoom?: number;
  /** escurecimento do fundo atrás do texto (0..1) */
  shade?: number;
}

export interface TNode { tag: 'div' | 'span' | 'img'; style: Record<string, string>; text?: string; src?: string; children?: TNode[] }

export const THUMB_LAYOUTS: Array<{ id: ThumbLayout; name: string; hint: string }> = [
  { id: 'impacto', name: 'Impacto', hint: 'texto gigante com contorno, palavra em destaque e selo' },
  { id: 'titulo', name: 'Título no topo', hint: 'título em uma linha no topo, contorno escuro e brilho; fim do título na cor de destaque (use | para escolher onde; sem |, a última palavra — ou as 2 últimas em títulos de 5+ palavras)' },
  { id: 'manchete', name: 'Manchete', hint: 'faixa de notícia embaixo, selo "URGENTE"' },
  { id: 'circulo', name: 'Círculo + seta', hint: 'círculo vermelho e seta no ponto que importa' },
  { id: 'split', name: 'Antes × depois', hint: 'dois quadros lado a lado com "VS"' },
  { id: 'documentario', name: 'Documentário', hint: 'cinemascope, título elegante e data' },
  { id: 'neon', name: 'Neon', hint: 'fundo escuro, texto com brilho neon e moldura' },
  { id: 'contagem', name: 'Contagem / Top', hint: 'número enorme (TOP 5, 3 MOTIVOS…)' },
  { id: 'minimal', name: 'Minimal', hint: 'cor sólida, texto enorme e o quadro num cartão' },
];

/** Templates prontos (aparecem com os da IA). O prompt é usado quando a thumbnail vem de um gerador de imagem. */
export const THUMB_DESIGN_TEMPLATES: Array<{ id: string; name: string; prompt: string; design: ThumbDesign }> = [
  { id: 'v-impacto', name: '🎨 Impacto (texto gigante)', design: { layout: 'impacto', accent: '#ffd400', color: '#ffffff', font: 'impact', align: 'left', shade: 0.55 },
    prompt: 'YouTube thumbnail background, one large clear subject on the right, dramatic rim light, saturated colors, empty dark space on the left, NO TEXT, topic: {{title}}' },
  { id: 'v-titulo', name: '🎨 Título no topo (canal de IA)', design: { layout: 'titulo', accent: '#22d3ff', color: '#ffffff', font: 'impact', shade: 0.5 },
    prompt: 'YouTube thumbnail background, epic digital illustration, one heroic character centered in the lower two thirds, dynamic pose, intense blue glow and rim light, gritty industrial background with blue haze filling the WHOLE frame edge to edge, the scene continues seamlessly to the top edge (no bands, no borders, no split panels, no frames), the top quarter is just darker and less busy, hyper detailed, NO TEXT, topic: {{title}}' },
  { id: 'v-manchete', name: '🎨 Manchete (notícia)', design: { layout: 'manchete', accent: '#e11d2e', color: '#ffffff', font: 'sans', badge: 'URGENTE' },
    prompt: 'news photo style thumbnail background about {{title}}, dramatic, realistic, NO TEXT' },
  { id: 'v-circulo', name: '🎨 Círculo + seta', design: { layout: 'circulo', accent: '#ff2a2a', color: '#ffe14d', font: 'impact', focus: { x: 0.68, y: 0.5 } },
    prompt: 'thumbnail background about {{title}} with one intriguing detail in the right half, NO TEXT' },
  { id: 'v-split', name: '🎨 Antes × depois', design: { layout: 'split', accent: '#ffd400', color: '#ffffff', font: 'impact' },
    prompt: 'split comparison thumbnail background about {{title}}, two contrasting halves, NO TEXT' },
  { id: 'v-documentario', name: '🎨 Documentário', design: { layout: 'documentario', accent: '#e8c45a', color: '#f4efe6', font: 'serif', shade: 0.5 },
    prompt: 'cinematic documentary still about {{title}}, moody lighting, shallow depth of field, NO TEXT' },
  { id: 'v-neon', name: '🎨 Neon', design: { layout: 'neon', accent: '#00e5ff', color: '#ffffff', font: 'rounded', shade: 0.65 },
    prompt: 'dark moody thumbnail background about {{title}}, neon rim light, NO TEXT' },
  { id: 'v-contagem', name: '🎨 Contagem / Top', design: { layout: 'contagem', accent: '#ffd400', color: '#ffffff', font: 'impact', badge: 'TOP 5', shade: 0.5 },
    prompt: 'thumbnail background about {{title}}, bold and colorful, subject on the right, NO TEXT' },
  { id: 'v-minimal', name: '🎨 Minimal', design: { layout: 'minimal', accent: '#7c5cff', color: '#ffffff', font: 'sans' },
    prompt: 'clean illustration about {{title}}, simple background, NO TEXT' },
];

const FONTS: Record<ThumbFont, string> = {
  impact: 'Impact, "Anton", "Arial Black", "Segoe UI Black", sans-serif',
  sans: '"Segoe UI Black", "Arial Black", "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: '"Segoe UI", "Arial Rounded MT Bold", Arial, sans-serif',
};

const px = (n: number) => `${Math.round(n)}px`;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Tamanho da fonte que cabe: textos curtos ficam enormes; quebra em até 3 linhas. */
export function fitFont(text: string, boxW: number, boxH: number, maxLines = 3, k = 0.58): { size: number; lines: string[] } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { size: boxH * 0.3, lines: [] };
  let best = { size: 8, lines: [text] };
  for (let n = 1; n <= Math.min(maxLines, words.length); n++) {
    /* quebra em n linhas equilibradas pelo número de letras */
    const total = words.join(' ').length, target = total / n, lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (cur && (cur + ' ' + w).length > target * 1.15 && lines.length < n - 1) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    const longest = Math.max(...lines.map((l) => l.length));
    const size = Math.min(boxW / (longest * k), boxH / (lines.length * 1.05));
    if (size > best.size) best = { size, lines };
  }
  return best;
}

/** Texto com contorno grosso e sombra (legível no celular), última palavra opcionalmente na cor de destaque. */
function bigText(lines: string[], size: number, o: { color: string; accent?: string; font: string; stroke?: string; strokeW?: number; align: string; glow?: string; upper?: boolean; italic?: boolean }): TNode[] {
  const last = lines.length - 1;
  return lines.map((l, i): TNode => {
    const text = o.upper ? l.toUpperCase() : l;
    const words = text.split(' ');
    /* destaque na última palavra do texto (se ela estiver sozinha na última linha, a linha inteira) */
    const accentLast = !!o.accent && i === last && (words.length > 1 || lines.length > 1);
    const base: Record<string, string> = {
      display: 'block', 'font-family': o.font, 'font-size': px(size), 'line-height': '1.0', 'font-weight': '900', color: o.color, 'text-align': o.align,
      'white-space': 'nowrap', 'letter-spacing': o.font.startsWith('Impact') ? '0.5px' : '-0.5px',
      ...(o.italic ? { 'font-style': 'italic' } : {}),
      ...(o.stroke ? { '-webkit-text-stroke': `${px(o.strokeW ?? size * 0.08)} ${o.stroke}`, 'paint-order': 'stroke fill' } : {}),
      'text-shadow': o.glow ?? `0 ${px(size * 0.06)} ${px(size * 0.12)} rgba(0,0,0,0.55)`,
    };
    if (!accentLast) return { tag: 'span', style: base, text };
    if (words.length === 1) return { tag: 'span', style: { ...base, color: o.accent! }, text };
    return { tag: 'span', style: base, children: [
      { tag: 'span', style: {}, text: words.slice(0, -1).join(' ') + ' ' },
      { tag: 'span', style: { color: o.accent! }, text: words[words.length - 1]! },
    ] };
  });
}

const box = (style: Record<string, string>, children: TNode[] = [], text?: string): TNode => ({ tag: 'div', style: { position: 'absolute', ...style }, children, text });
const bgImg = (src: string | undefined, d: ThumbDesign, extra: Record<string, string> = {}): TNode => src
  ? { tag: 'img', src, style: { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', 'object-fit': 'cover',
    'object-position': `${Math.round((d.focus?.x ?? 0.5) * 100)}% ${Math.round((d.focus?.y ?? 0.5) * 100)}%`,
    transform: `scale(${clamp(d.zoom ?? 1.06, 1, 2)})`, 'transform-origin': `${Math.round((d.focus?.x ?? 0.5) * 100)}% ${Math.round((d.focus?.y ?? 0.5) * 100)}%`,
    filter: 'saturate(1.3) contrast(1.12)', ...extra } }
  : box({ inset: '0', background: 'linear-gradient(135deg,#3b2a8a,#0b0918 70%)' });
const badge = (text: string, size: number, accent: string, pos: Record<string, string>, font: string): TNode =>
  box({ ...pos, background: accent, color: luma(accent) > 0.6 ? '#111' : '#fff', 'font-family': font, 'font-weight': '900', 'font-size': px(size), padding: `${px(size * 0.22)} ${px(size * 0.5)}`,
    'border-radius': px(size * 0.18), 'letter-spacing': '1px', 'box-shadow': `0 ${px(size * 0.15)} ${px(size * 0.4)} rgba(0,0,0,0.45)`, transform: 'rotate(-3deg)', 'white-space': 'nowrap' }, [], text.toUpperCase());

/** Luminância aproximada de "#rrggbb" (0..1). */
export function luma(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return 0.5;
  const n = parseInt(m[1]!, 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/**
 * Árvore do layout no tamanho w×h. `bg`/`bg2` = endereços das imagens de fundo (quadro do vídeo ou imagem da IA);
 * `text` = texto principal já decidido.
 */
export function thumbTree(d: ThumbDesign, o: { w: number; h: number; text: string; bg?: string; bg2?: string }): TNode {
  const { w, h } = o, S = Math.min(w, h), tall = h > w * 1.1;
  const accent = d.accent || '#ffd400', color = d.color || '#ffffff', font = FONTS[d.font ?? 'impact'];
  const text = (d.text?.trim() || o.text).trim();
  const kids: TNode[] = [];
  const shade = clamp(d.shade ?? 0.55, 0, 1);
  switch (d.layout) {
    case 'manchete': {
      kids.push(bgImg(o.bg, d));
      kids.push(box({ left: '0', right: '0', bottom: '0', height: '46%', background: `linear-gradient(to top, rgba(0,0,0,${0.75 * shade + 0.2}), transparent)` }));
      const bandH = h * (tall ? 0.2 : 0.26), f = fitFont(text, w * 0.9, bandH * 0.78, 2, 0.6);
      kids.push(box({ left: '0', right: '0', bottom: px(h * 0.06), height: px(bandH), background: accent, display: 'flex', 'flex-direction': 'column', 'justify-content': 'center',
        padding: `0 ${px(w * 0.04)}`, 'box-shadow': `0 ${px(S * 0.01)} ${px(S * 0.04)} rgba(0,0,0,0.5)` },
        bigText(f.lines, f.size, { color, font, align: 'left', upper: true, glow: 'none' })));
      kids.push(box({ left: '0', right: '0', bottom: '0', height: px(h * 0.06), background: '#0d0d10', color: '#fff', 'font-family': FONTS.sans, 'font-size': px(h * 0.034), display: 'flex', 'align-items': 'center',
        padding: `0 ${px(w * 0.04)}`, 'letter-spacing': '1px', 'white-space': 'nowrap', overflow: 'hidden' }, [], (d.sub || 'AO VIVO  ·  ENTENDA O CASO').toUpperCase()));
      kids.push(badge(d.badge || 'URGENTE', h * 0.055, '#ffffff', { left: px(w * 0.04), bottom: px(h * 0.06 + bandH - h * 0.03) }, FONTS.sans));
      break;
    }
    case 'circulo': {
      kids.push(bgImg(o.bg, d));
      const fx = (d.focus?.x ?? 0.68) * w, fy = (d.focus?.y ?? 0.5) * h, r = S * 0.2;
      kids.push(box({ left: '0', top: '0', bottom: '0', width: '55%', background: `linear-gradient(to right, rgba(0,0,0,${shade}), transparent)` }));
      kids.push(box({ left: px(fx - r), top: px(fy - r), width: px(r * 2), height: px(r * 2), border: `${px(S * 0.018)} solid ${accent}`, 'border-radius': '50%', 'box-shadow': `0 0 ${px(S * 0.03)} rgba(0,0,0,0.6), inset 0 0 ${px(S * 0.02)} rgba(0,0,0,0.4)` }));
      /* seta: haste + ponta, do texto até a borda do círculo */
      const ax = fx - r * 1.05, ay = fy + r * 0.2, len = S * 0.22;
      kids.push(box({ left: px(ax - len), top: px(ay - S * 0.012), width: px(len), height: px(S * 0.024), background: accent, 'border-radius': px(S * 0.012), transform: 'rotate(-18deg)', 'transform-origin': '100% 50%', 'box-shadow': '0 2px 8px rgba(0,0,0,0.5)' }));
      kids.push(box({ left: px(ax - S * 0.055), top: px(ay - S * 0.05), width: '0', height: '0', 'border-top': `${px(S * 0.05)} solid transparent`, 'border-bottom': `${px(S * 0.05)} solid transparent`, 'border-left': `${px(S * 0.07)} solid ${accent}`, transform: 'rotate(-18deg)' }));
      const f = fitFont(text, w * (tall ? 0.86 : 0.48), h * (tall ? 0.3 : 0.62), 3);
      kids.push(box({ left: px(w * 0.04), top: tall ? px(h * 0.05) : '0', bottom: tall ? 'auto' : '0', width: tall ? '92%' : '50%', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center' },
        bigText(f.lines, f.size, { color, font, align: 'left', upper: true, stroke: '#000', strokeW: f.size * 0.09 })));
      break;
    }
    case 'split': {
      kids.push(box({ left: '0', top: '0', bottom: '0', width: '50%', overflow: 'hidden' }, [bgImg(o.bg, d, { filter: 'saturate(0.6) contrast(1.05) brightness(0.85)' })]));
      kids.push(box({ right: '0', top: '0', bottom: '0', width: '50%', overflow: 'hidden' }, [bgImg(o.bg2 ?? o.bg, d)]));
      kids.push(box({ left: 'calc(50% - 4px)', top: '-5%', height: '110%', width: '8px', background: accent, transform: 'rotate(6deg)', 'box-shadow': '0 0 18px rgba(0,0,0,0.6)' }));
      const vs = S * 0.2;
      kids.push(box({ left: px(w / 2 - vs / 2), top: px(h / 2 - vs / 2), width: px(vs), height: px(vs), 'border-radius': '50%', background: accent, color: luma(accent) > 0.6 ? '#111' : '#fff',
        display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-family': FONTS.impact, 'font-size': px(vs * 0.42), 'box-shadow': '0 6px 22px rgba(0,0,0,0.55)', border: `${px(S * 0.012)} solid #fff` }, [], 'VS'));
      kids.push(box({ left: '0', right: '0', top: '0', height: '34%', background: `linear-gradient(to bottom, rgba(0,0,0,${shade}), transparent)` }));
      const f = fitFont(text, w * 0.9, h * 0.24, 2);
      kids.push(box({ left: '5%', right: '5%', top: px(h * 0.04) }, bigText(f.lines, f.size, { color, font, align: 'center', upper: true, stroke: '#000', strokeW: f.size * 0.09 })));
      kids.push(box({ left: px(w * 0.03), bottom: px(h * 0.04), color: '#fff', 'font-family': FONTS.sans, 'font-size': px(S * 0.06), 'text-shadow': '0 2px 8px #000', 'font-weight': '900' }, [], 'ANTES'));
      kids.push(box({ right: px(w * 0.03), bottom: px(h * 0.04), color: accent, 'font-family': FONTS.sans, 'font-size': px(S * 0.06), 'text-shadow': '0 2px 8px #000', 'font-weight': '900' }, [], 'DEPOIS'));
      break;
    }
    case 'documentario': {
      kids.push(bgImg(o.bg, d, { filter: 'saturate(0.85) contrast(1.15) sepia(0.12)' }));
      kids.push(box({ inset: '0', background: `radial-gradient(ellipse at 60% 45%, transparent 35%, rgba(0,0,0,${0.55 + shade * 0.35}) 100%)` }));
      const bar = h * (tall ? 0.06 : 0.1);
      kids.push(box({ left: '0', right: '0', top: '0', height: px(bar), background: '#000' }), box({ left: '0', right: '0', bottom: '0', height: px(bar), background: '#000' }));
      const f = fitFont(text, w * 0.8, h * 0.26, 2, 0.5);
      kids.push(box({ left: px(w * 0.06), bottom: px(bar + h * 0.07), right: px(w * 0.06) }, [
        box({ position: 'relative', width: px(w * 0.08), height: px(S * 0.008), background: accent, 'margin-bottom': px(h * 0.025) }),
        ...bigText(f.lines, f.size, { color, font: FONTS.serif, align: 'left', glow: '0 2px 18px rgba(0,0,0,0.85)' }),
        ...(d.sub ? [box({ position: 'relative', color: accent, 'font-family': FONTS.sans, 'font-size': px(S * 0.045), 'letter-spacing': '3px', 'margin-top': px(h * 0.02), 'font-weight': '700' }, [], d.sub.toUpperCase())] : []),
      ]));
      break;
    }
    case 'neon': {
      kids.push(bgImg(o.bg, d, { filter: 'saturate(1.2) brightness(0.7) contrast(1.2)' }));
      kids.push(box({ inset: '0', background: `rgba(5,3,18,${shade * 0.8})` }));
      kids.push(box({ inset: px(S * 0.03), border: `${px(S * 0.008)} solid ${accent}`, 'border-radius': px(S * 0.03), 'box-shadow': `0 0 ${px(S * 0.03)} ${accent}, inset 0 0 ${px(S * 0.03)} ${accent}` }));
      const f = fitFont(text, w * 0.84, h * 0.6, 3);
      const glow = `0 0 ${px(f.size * 0.08)} #fff, 0 0 ${px(f.size * 0.2)} ${accent}, 0 0 ${px(f.size * 0.45)} ${accent}, 0 0 ${px(f.size * 0.8)} ${accent}`;
      kids.push(box({ inset: '0', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', 'align-items': 'center' }, bigText(f.lines, f.size, { color, font, align: 'center', upper: true, glow })));
      if (d.badge) kids.push(badge(d.badge, S * 0.06, accent, { right: px(w * 0.06), top: px(h * 0.08) }, FONTS.sans));
      break;
    }
    case 'contagem': {
      kids.push(bgImg(o.bg, d));
      kids.push(box({ left: '0', top: '0', bottom: '0', width: '62%', background: `linear-gradient(to right, rgba(0,0,0,${shade + 0.15}), transparent)` }));
      const num = (d.badge || 'TOP 5').toUpperCase(), m = /(\d+)/.exec(num);
      const big = m ? m[1]! : num, pre = m ? num.replace(m[1]!, '').trim() : '';
      kids.push(box({ left: px(w * 0.03), top: px(h * 0.04), color: accent, 'font-family': FONTS.impact, 'font-size': px(h * (tall ? 0.3 : 0.62)), 'line-height': '0.9',
        '-webkit-text-stroke': `${px(S * 0.012)} #000`, 'paint-order': 'stroke fill', 'text-shadow': `0 ${px(S * 0.02)} ${px(S * 0.05)} rgba(0,0,0,0.6)` }, [], big));
      if (pre) kids.push(box({ left: px(w * 0.04), top: px(h * 0.03), color: '#fff', 'font-family': FONTS.sans, 'font-size': px(S * 0.07), 'font-weight': '900', 'text-shadow': '0 2px 8px #000' }, [], pre));
      const f = fitFont(text, w * (tall ? 0.9 : 0.5), h * (tall ? 0.3 : 0.5), 3);
      kids.push(box({ left: tall ? px(w * 0.05) : px(w * 0.04), bottom: px(h * 0.07), width: tall ? '90%' : '54%' }, bigText(f.lines, f.size, { color, font, align: 'left', upper: true, stroke: '#000', strokeW: f.size * 0.08 })));
      break;
    }
    case 'minimal': {
      kids.push(box({ inset: '0', background: `linear-gradient(135deg, ${accent}, #0b0918 85%)` }));
      const cw = tall ? w * 0.8 : w * 0.42, ch = cw * (tall ? 0.62 : 0.68);
      kids.push(box({ left: tall ? px((w - cw) / 2) : px(w * 0.54), top: tall ? px(h * 0.52) : px((h - ch) / 2), width: px(cw), height: px(ch), 'border-radius': px(S * 0.04), overflow: 'hidden',
        transform: 'rotate(3deg)', 'box-shadow': `0 ${px(S * 0.03)} ${px(S * 0.08)} rgba(0,0,0,0.55)`, border: `${px(S * 0.01)} solid #fff` }, [bgImg(o.bg, d)]));
      const f = fitFont(text, w * (tall ? 0.86 : 0.48), h * (tall ? 0.38 : 0.7), 3);
      kids.push(box({ left: px(w * 0.05), top: tall ? px(h * 0.08) : '0', bottom: tall ? 'auto' : '0', width: tall ? '90%' : '48%', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center' },
        bigText(f.lines, f.size, { color, font, align: 'left', glow: '0 4px 20px rgba(0,0,0,0.35)' })));
      break;
    }
    case 'titulo': {
      /* título no topo (estilo canal de IA): uma ou duas linhas centralizadas, branco com contorno escuro grosso e brilho
         na cor de destaque; a parte depois de "|" (ou as 2 últimas palavras) sai na cor de destaque. Fundo com brilho. */
      kids.push(bgImg(o.bg, d, { filter: 'saturate(1.35) contrast(1.15)' }));
      kids.push(box({ inset: '0', background: `radial-gradient(ellipse at 50% 60%, transparent 30%, rgba(0,8,30,${0.35 + shade * 0.4}) 100%)` }));
      kids.push(box({ left: '0', right: '0', top: '0', height: '34%', background: `linear-gradient(to bottom, rgba(0,6,24,${0.35 + shade * 0.35}), transparent)` }));
      const raw = text.includes('|') ? text : (() => { const ws = text.split(/\s+/); return ws.length >= 5 ? `${ws.slice(0, -2).join(' ')}|${ws.slice(-2).join(' ')}` : ws.length >= 2 ? `${ws.slice(0, -1).join(' ')}|${ws[ws.length - 1]}` : text; })();
      const [main, hi = ''] = raw.split('|').map((x) => x.trim());
      const full = `${main} ${hi}`.trim();
      const f = fitFont(full, w * 0.94, h * (tall ? 0.3 : 0.22), tall ? 3 : 2, 0.56);
      const stroke = '#0a1f4d', glow = `0 0 ${px(f.size * 0.12)} ${accent}, 0 0 ${px(f.size * 0.3)} ${accent}, 0 ${px(f.size * 0.05)} ${px(f.size * 0.1)} rgba(0,0,0,0.6)`;
      /* reparte as linhas do fitFont entre a parte branca e a de destaque, palavra a palavra */
      const hiWords = new Set<number>(); const all = full.split(/\s+/); const nMain = main ? main.split(/\s+/).length : 0;
      all.forEach((_, i) => { if (i >= nMain) hiWords.add(i); });
      let wi = 0;
      const lineNodes = f.lines.map((l): TNode => ({ tag: 'span', style: { display: 'block', 'font-family': font, 'font-size': px(f.size), 'line-height': '1.02', 'font-weight': '900', 'text-align': 'center',
        'white-space': 'nowrap', '-webkit-text-stroke': `${px(f.size * 0.11)} ${stroke}`, 'paint-order': 'stroke fill', 'text-shadow': glow, 'letter-spacing': '0.5px' },
        children: l.split(' ').map((word): TNode => { const isHi = hiWords.has(wi++); return { tag: 'span', style: { color: isHi ? accent : color }, text: word + ' ' }; }) }));
      kids.push(box({ left: '2%', right: '2%', top: px(h * 0.03) }, lineNodes));
      if (d.sub) kids.push(box({ left: '0', right: '0', bottom: px(h * 0.05), 'text-align': 'center', color: '#fff', 'font-family': FONTS.sans, 'font-size': px(S * 0.05), 'font-weight': '900',
        'text-shadow': `0 0 ${px(S * 0.02)} ${accent}, 0 2px 8px #000` }, [], d.sub.toUpperCase()));
      break;
    }
    default: { // impacto
      kids.push(bgImg(o.bg, d));
      const right = d.align === 'right';
      kids.push(box({ top: '0', bottom: '0', width: '62%', [right ? 'right' : 'left']: '0', background: `linear-gradient(to ${right ? 'left' : 'right'}, rgba(0,0,0,${shade}), rgba(0,0,0,${shade * 0.5}) 55%, transparent)` }));
      kids.push(box({ left: '0', right: '0', bottom: '0', height: '28%', background: 'linear-gradient(to top, rgba(0,0,0,0.45), transparent)' }));
      const f = fitFont(text, w * (tall ? 0.9 : 0.56), h * (tall ? 0.36 : 0.72), 3);
      const al = d.align === 'center' ? 'center' : right ? 'right' : 'left';
      kids.push(box({ [right ? 'right' : 'left']: px(w * 0.045), width: tall ? '91%' : '58%', top: tall ? 'auto' : '0', bottom: tall ? px(h * 0.12) : '0', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center' },
        bigText(f.lines, f.size, { color, accent, font, align: al, upper: true, stroke: '#000', strokeW: f.size * 0.085 })));
      if (d.badge) kids.push(badge(d.badge, S * 0.065, accent, { [right ? 'left' : 'right']: px(w * 0.05), top: px(h * 0.07) }, FONTS.sans));
      if (d.sub) kids.push(box({ [right ? 'right' : 'left']: px(w * 0.05), top: px(h * 0.06), color: '#fff', background: 'rgba(0,0,0,0.55)', padding: `${px(S * 0.012)} ${px(S * 0.03)}`, 'border-radius': px(S * 0.012),
        'font-family': FONTS.sans, 'font-size': px(S * 0.045), 'font-weight': '800', 'letter-spacing': '1px' }, [], d.sub.toUpperCase()));
    }
  }
  return { tag: 'div', style: { position: 'relative', width: px(w), height: px(h), overflow: 'hidden', background: '#000' }, children: kids };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const css = (st: Record<string, string>) => Object.entries(st).map(([k, v]) => `${k}:${v}`).join(';');

/** HTML da árvore (estilos inline). */
export function treeToHtml(n: TNode): string {
  if (n.tag === 'img') return `<img src="${esc(n.src ?? '')}" style="${esc(css(n.style))}" alt="">`;
  return `<${n.tag} style="${esc(css(n.style))}">${n.text !== undefined ? esc(n.text) : ''}${(n.children ?? []).map(treeToHtml).join('')}</${n.tag}>`;
}

/** Página completa para o renderizador do app (window.__forge parado: espera as imagens e as fontes). */
export function thumbPage(tree: TNode, w: number, h: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#000}</style></head><body>${treeToHtml(tree)}` +
    `<script>window.__forge={duration:0.2,fps:5,pause(){},seek(){return Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>document.fonts&&document.fonts.ready)}};</script></body></html>`;
}
