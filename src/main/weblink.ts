/*
 * Vídeo explicativo de link: o app abre a página num navegador invisível, lê o conteúdo e grava um vídeo rolando a
 * página (com paradas em cada seção). Aqui ficam as partes puras: achar o link, planejar a rolagem e montar o resumo.
 */

/** Primeiro link http(s) do texto (ideia do projeto), sem pontuação final. */
export function findLink(text: string | undefined): string | undefined {
  const m = /\bhttps?:\/\/[^\s<>"'`]+/i.exec(text ?? '');
  if (!m) return undefined;
  return m[0].replace(/[).,;:!?\]}]+$/, '');
}

/** Todos os links http(s) do texto, na ordem, sem repetir (máx. `max`). Vários links = um vídeo que explica todos. */
export function findLinks(text: string | undefined, max = 20): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    const u = m[0].replace(/[).,;:!?\]}]+$/, '');
    if (!out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/** Índice dos links capturados (web/links.md): ordem, título e onde está a captura de cada um. Função pura. */
export function linksDoc(items: Array<{ url: string; title?: string; dir: string; seconds?: number }>): string {
  return [
    `# ${items.length} links para explicar (nesta ordem)`,
    'Cada link tem a sua captura: <pasta>/pagina.md (conteúdo + instantes das seções) e <pasta>/pagina.mp4 (a página rolando, sem som).',
    '',
    ...items.map((it, i) => `${i + 1}. ${it.title || it.url}\n   LINK: ${it.url}\n   conteúdo: ${it.dir}/pagina.md · vídeo: ${it.dir}/pagina.mp4${it.seconds ? ` (${it.seconds} s)` : ''} · print do topo: ${it.dir}/pagina-topo.png`),
  ].join('\n');
}

export interface PageSection { title: string; y: number }
export interface PageInfo { url: string; title: string; description: string; lang?: string; text: string; sections: PageSection[]; maxY: number; viewH: number }
export interface ScrollPlan { ys: number[]; marks: Array<{ title: string; t: number }>; seconds: number }

const smoother = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * t * (t * (t * 6 - 15) + 10); };

/**
 * Rolagem da captura: segura o topo, desce até cada seção (parando um pouco nela) e termina no fim da página, com
 * velocidade ajustada para caber em `maxSec`. Devolve a posição (px CSS) de cada quadro e o instante de cada seção.
 */
export function scrollPlan(o: { maxY: number; viewH: number; sections: PageSection[]; fps: number; maxSec: number; minSec?: number }): ScrollPlan {
  /* página longa: grava só o trecho que dá para ler rolando (~650 px CSS/s), com as seções dentro dele */
  const fps = o.fps, maxY = Math.max(0, Math.min(Math.round(o.maxY), Math.round(o.maxSec * 650))), hold0 = 1.6, holdS = 1.0, holdEnd = 1.2;
  let stops = o.sections.filter((s) => s.y - o.viewH * 0.12 <= maxY).map((s) => ({ title: s.title, y: Math.max(0, Math.round(s.y - o.viewH * 0.12)) }))
    .filter((s) => s.y > o.viewH * 0.3).sort((a, b) => a.y - b.y)
    .filter((s, i, a) => i === 0 || s.y - a[i - 1]!.y > o.viewH * 0.45);
  const fit = () => {
    const dist = (stops.length ? stops[stops.length - 1]!.y : 0) + Math.max(0, maxY - (stops[stops.length - 1]?.y ?? 0));
    const fixed = hold0 + stops.length * holdS + holdEnd;
    return { dist, fixed, speed: dist > 0 ? Math.max(260, dist / Math.max(3, o.maxSec - fixed)) : 1 };
  };
  let f = fit();
  while (stops.length > 2 && (f.speed > 1400 || f.fixed > o.maxSec * 0.55)) { stops = stops.filter((_, i) => i % 2 === 0); f = fit(); }
  const legs: Array<{ from: number; to: number; travel: number; hold: number; title?: string }> = [];
  let at = 0;
  for (const s of stops) { legs.push({ from: at, to: s.y, travel: Math.abs(s.y - at) / f.speed, hold: holdS, title: s.title }); at = s.y; }
  if (maxY > at) legs.push({ from: at, to: maxY, travel: (maxY - at) / f.speed, hold: holdEnd });
  const ys: number[] = [], marks: ScrollPlan['marks'] = [];
  const push = (y: number, sec: number) => { for (let i = 0, n = Math.round(sec * fps); i < n; i++) ys.push(y); };
  push(0, hold0);
  for (const l of legs) {
    const n = Math.max(1, Math.round(l.travel * fps));
    for (let i = 1; i <= n; i++) ys.push(Math.round(l.from + (l.to - l.from) * smoother(i / n)));
    if (l.title) marks.push({ title: l.title, t: Math.round((ys.length / fps) * 10) / 10 });
    push(l.to, l.hold);
  }
  const min = Math.round((o.minSec ?? 6) * fps);
  while (ys.length < min) ys.push(ys[ys.length - 1] ?? 0);
  return { ys, marks, seconds: Math.round((ys.length / fps) * 100) / 100 };
}

/** Resumo da página para o roteiro e o plano de cenas (web/pagina.md). */
export function pageDoc(info: PageInfo, plan: ScrollPlan, files: { video: string; shots: Array<{ file: string; title: string }>; clips?: PageClip[]; embeds?: string[] }, textMax = 14000): string {
  const text = info.text.replace(/\n{3,}/g, '\n\n').trim().slice(0, textMax);
  const clips = files.clips ?? [], embeds = files.embeds ?? [];
  return [
    `# ${info.title || info.url}`,
    `LINK: ${info.url}`,
    info.description ? `DESCRIÇÃO: ${info.description}` : '',
    '',
    `## Captura da página (${files.video}, ${plan.seconds} s, sem som)`,
    'Vídeo da página rolando de cima para baixo. Instante em que cada seção chega ao topo da tela (use como clipStart):',
    `- 0,0 s — topo da página (${info.title || 'cabeçalho'})`,
    ...plan.marks.map((m) => `- ${m.t.toFixed(1).replace('.', ',')} s — ${m.title}`),
    '',
    files.shots.length ? `## Prints\n${files.shots.map((s) => `- ${s.file}: ${s.title}`).join('\n')}` : '',
    clips.length ? `## Vídeos da página (trechos curtos gravados tocando, sem som)\nUse como "userMedia" de cenas curtas (3–6 s) quando a fala citar o vídeo; é conteúdo de terceiros: mostre só o trecho, numa moldura, comentando por cima.\n${clips.map((c) => `- ${c.file} (${c.seconds} s)${c.near ? ` — perto de "${c.near}"` : ''}${c.label ? ` — ${c.label}` : ''}`).join('\n')}` : '',
    embeds.length ? `## Vídeos embutidos não gravados\n${embeds.map((u) => `- ${u}`).join('\n')}` : '',
    '',
    '## Conteúdo da página (texto)',
    text,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

/** Id do vídeo do YouTube num link (watch, youtu.be, embed, shorts, live, nocookie); undefined se não for um. */
export function youTubeId(u: string | undefined): string | undefined {
  let url: URL;
  try { url = new URL(u ?? ''); } catch { return undefined; }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null | undefined;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)?.[2];
  }
  return id && /^[\w-]{11}$/.test(id) ? id : undefined;
}

/** Trecho gravado de um vídeo da página. */
export interface PageClip { file: string; seconds: number; near?: string; label?: string }

/**
 * Orçamento por link: com muitos links cada captura fica mais curta, o texto lido de cada página é menor (cabe até em
 * modelo local) e grava menos trechos de vídeo. Função pura.
 */
export function linkBudget(n: number): { maxSec: number; textMax: number; clips: number; clipSec: number } {
  if (n <= 1) return { maxSec: 40, textMax: 14000, clips: 2, clipSec: 10 };
  if (n <= 6) return { maxSec: 30, textMax: Math.max(5000, Math.floor(42000 / n)), clips: 2, clipSec: 8 };
  return { maxSec: 16, textMax: Math.max(2500, Math.floor(42000 / n)), clips: 1, clipSec: 6 };
}
