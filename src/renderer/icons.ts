/* Ícones de traço (24×24, currentColor): seguem a cor do tema. */
type Shape = [string, Record<string, string>];
const P = (d: string): Shape => ['path', { d }];
const ICONS: Record<string, Shape[]> = {
  projects: [['rect', { x: '3', y: '3', width: '7', height: '7', rx: '1.5' }], ['rect', { x: '14', y: '3', width: '7', height: '7', rx: '1.5' }], ['rect', { x: '3', y: '14', width: '7', height: '7', rx: '1.5' }], ['rect', { x: '14', y: '14', width: '7', height: '7', rx: '1.5' }]],
  new: [['circle', { cx: '12', cy: '12', r: '9' }], P('M12 8v8M8 12h8')],
  batch: [P('M12 3 21 8 12 13 3 8z'), P('M3 12.5 12 17.5 21 12.5'), P('M3 17 12 22 21 17')],
  editor: [['rect', { x: '2.5', y: '4', width: '19', height: '16', rx: '2' }], P('M7 4v16M17 4v16M2.5 9H7M2.5 15H7M17 9h4.5M17 15h4.5')],
  run: [['rect', { x: '2.5', y: '4', width: '19', height: '16', rx: '2' }], P('M7 9l3.5 3L7 15M12.5 15H17')],
  routes: [['circle', { cx: '6', cy: '5.5', r: '2.5' }], ['circle', { cx: '6', cy: '18.5', r: '2.5' }], ['circle', { cx: '18', cy: '8', r: '2.5' }], P('M6 8v8M18 10.5c0 4-5.5 3.5-10.5 6.5')],
  skills: [P('M12 3l2.1 5.4L19.5 10.5l-5.4 2.1L12 18l-2.1-5.4L4.5 10.5l5.4-2.1z'), P('M19 16l.8 2 2 .8-2 .8L19 21.6l-.8-2-2-.8 2-.8z')],
  agents: [['rect', { x: '4.5', y: '8', width: '15', height: '11', rx: '3' }], ['circle', { cx: '9.5', cy: '13.5', r: '1.2' }], ['circle', { cx: '14.5', cy: '13.5', r: '1.2' }], P('M12 4.5V8M9 21h6')],
  settings: [['circle', { cx: '12', cy: '12', r: '3' }], P('M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z')],
  providers: [P('M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0'), ['circle', { cx: '16', cy: '6', r: '2' }], ['circle', { cx: '10', cy: '12', r: '2' }], ['circle', { cx: '18', cy: '18', r: '2' }]],
  automations: [P('M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z')],
  videos: [P('M3 5h18v14H3zM10 9l5 3-5 3z')],
  /* canais próprios: TV com antena */
  channels: [['rect', { x: '3', y: '7', width: '18', height: '13', rx: '2' }], P('M8 3l4 4 4-4'), P('M10 11v5l4-2.5z')],
  plugins: [P('M9 3h6v4h2a2 2 0 0 1 2 2v2h-4v2h4v4a2 2 0 0 1-2 2h-4v-3h-2v3H7a2 2 0 0 1-2-2v-4h3v-2H5V9a2 2 0 0 1 2-2h2z')],
  sun: [['circle', { cx: '12', cy: '12', r: '4' }], P('M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8')],
  moon: [P('M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z')],
  play: [P('M7 4.5 19.5 12 7 19.5z')],
  pause: [['rect', { x: '6', y: '4.5', width: '4', height: '15', rx: '1' }], ['rect', { x: '14', y: '4.5', width: '4', height: '15', rx: '1' }]],
  stop: [['rect', { x: '5.5', y: '5.5', width: '13', height: '13', rx: '1.5' }]],
  prev: [P('M18.5 5 9 12l9.5 7z'), P('M5.5 5v14')],
  next: [P('M5.5 5 15 12l-9.5 7z'), P('M18.5 5v14')],
  plus: [P('M12 5v14M5 12h14')],
  trash: [P('M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13')],
  text: [P('M5 6V4.5h14V6M12 4.5V19.5M9 19.5h6')],
  fx: [P('M4 20 14 10M14 10l2-6 2 6 6 2-6 2-2 6-2-6-6-2z')],
  file: [P('M6 2.5h8l4.5 4.5v14.5H6z'), P('M14 2.5V7h4.5')],
  clock: [['circle', { cx: '12', cy: '12', r: '9' }], P('M12 7v5l3.5 2')],
  image: [['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }], ['circle', { cx: '9', cy: '10', r: '1.8' }], P('M3.5 18l5.5-5 4 3.5 3-2.5 4.5 4')],
  music: [P('M9 18V5l10-2v13'), ['circle', { cx: '6.5', cy: '18', r: '2.5' }], ['circle', { cx: '16.5', cy: '16', r: '2.5' }]],
  /* marca Snapgen.AI: faísca de quatro pontas + brilho menor */
  snapgen: [P('M12 2.5l2.3 7.2 7.2 2.3-7.2 2.3L12 21.5l-2.3-7.2-7.2-2.3 7.2-2.3z'), P('M19 2.8l.7 2.5 2.5.7-2.5.7-.7 2.5-.7-2.5-2.5-.7 2.5-.7z')],
};
export function icon(name: string, fill = false): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', fill ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name] ?? []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
