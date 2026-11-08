/* Editor visual de paleta (fundo, texto, destaque, apoio) com prévia e contraste WCAG — Novo projeto e thumbnail. */

export interface Pal { background?: string; text?: string; accent?: string; secondary?: string }
const lum = (hex: string) => {
  let x = hex.replace('#', ''); if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => { const c = parseInt(x.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]; return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 10) / 10; };

/** Paletas prontas (um clique). */
export const PRESETS: Array<[string, Required<Pal>]> = [
  ['Noite neon', { background: '#0b0b10', text: '#ffffff', accent: '#ffcc00', secondary: '#7c5cff' }],
  ['Cinema quente', { background: '#1a1410', text: '#f6efe6', accent: '#ff7a2f', secondary: '#c9a227' }],
  ['Documentário', { background: '#101418', text: '#e8edf2', accent: '#4fc3f7', secondary: '#90a4ae' }],
  ['Clean claro', { background: '#f7f7f5', text: '#16181d', accent: '#e63946', secondary: '#457b9d' }],
  ['Pastel infantil', { background: '#fff6e9', text: '#3d2c5e', accent: '#ff8fab', secondary: '#7bdff2' }],
  ['Dorama', { background: '#f4ece6', text: '#2b2523', accent: '#d97a8a', secondary: '#8fb9a8' }],
];

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

/** Bloco de uma paleta: 4 cores, prévia (texto sobre o fundo + destaque) e contraste. */
export function paletteBox(title: string, initial: Pal, onChange?: () => void): { el: HTMLElement; value: () => Required<Pal>; set: (p: Pal) => void } {
  const ROLES: Array<[keyof Pal, string, string]> = [['background', 'Fundo', '#0b0b10'], ['text', 'Texto', '#ffffff'], ['accent', 'Destaque', '#ffcc00'], ['secondary', 'Apoio', '#7c5cff']];
  const ins: Record<string, HTMLInputElement> = {};
  const prev = h('div', { class: 'ch-palprev' }); const acc = h('b', {}, 'DESTAQUE'); prev.append(h('span', {}, 'Texto '), acc);
  const ratio = h('span', { class: 'ch-ratio' });
  const paint = () => {
    const bg = ins['background']!.value, tx = ins['text']!.value, r = contrast(tx, bg);
    ratio.textContent = `contraste ${r}:1 ${r >= 7 ? '✓✓' : r >= 4.5 ? '✓' : '⚠ baixo'}`; ratio.className = `ch-ratio${r < 4.5 ? ' warn' : ''}`;
    prev.style.background = bg; prev.style.color = tx; acc.style.color = ins['accent']!.value;
  };
  const row = h('div', { class: 'ch-palrow' }, ...ROLES.map(([k, l, def]) => {
    const v = initial[k] && /^#[0-9a-f]{6}$/i.test(initial[k]!) ? initial[k]! : def;
    const inp = h('input', { type: 'color', value: v, title: l }) as HTMLInputElement;
    inp.addEventListener('input', () => { paint(); onChange?.(); });
    ins[k] = inp;
    return h('label', { class: 'ch-color' }, l, inp);
  }));
  paint();
  return {
    el: h('div', { class: 'ch-pal' }, h('b', {}, title), row, prev, ratio),
    value: () => ({ background: ins['background']!.value, text: ins['text']!.value, accent: ins['accent']!.value, secondary: ins['secondary']!.value }),
    set: (p: Pal) => { for (const [k] of ROLES) if (p[k] && /^#[0-9a-f]{6}$/i.test(p[k]!)) ins[k]!.value = p[k]!; paint(); },
  };
}
