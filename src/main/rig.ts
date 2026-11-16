/*
 * RIG ARTICULADO EM CAMADAS para personagens por código (Biblioteca → 💻 Em vídeos por código → 🦴 Rig).
 *
 * A IA só DESENHA as peças (SVG) e marca os pivôs (ombro, cotovelo, quadril, joelho, pescoço). O MOVIMENTO é deste
 * arquivo: um motor fixo e determinístico (ForgeRig) que monta a hierarquia (tronco → cabeça/braços/pernas), ordena as
 * camadas por z e anima poses prontas (parado, andar, correr, falar, acenar, apontar, pular, comemorar, sentar, pensar)
 * em função de t — o mesmo quadro sempre sai igual, como o contrato seek(t) das cenas exige.
 *
 * Coordenadas: as peças são desenhadas na POSE DE DESCANSO (em pé, braços para baixo), no espaço do rig (size = [w, h]);
 * o pivô de cada peça é absoluto nesse espaço. A âncora do personagem na cena é o centro dos pés (w/2, h).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RigPart { id: string; parent?: string; pivot: [number, number]; z: number; svg: string }
export interface Rig { version: 1; name: string; size: [number, number]; view: 'front' | 'side' | 'three-quarter'; parts: RigPart[]; style?: string; palette?: string[] }

/** Peças obrigatórias (o motor precisa delas para andar, gesticular e falar). */
export const RIG_REQUIRED = ['torso', 'head', 'armL_up', 'armL_low', 'armR_up', 'armR_low', 'legL_up', 'legL_low', 'legR_up', 'legR_low'] as const;
/** Peças opcionais reconhecidas pelo motor. */
export const RIG_OPTIONAL = ['hips', 'neck', 'handL', 'handR', 'footL', 'footR', 'eyes', 'eyesClosed', 'mouth', 'mouthOpen', 'brows', 'hair', 'hairBack', 'tail', 'accessory'] as const;
/** Pai padrão de cada peça conhecida (quando a IA não diz). */
const DEFAULT_PARENT: Record<string, string | undefined> = {
  torso: undefined, hips: 'torso', neck: 'torso', head: 'torso', hair: 'head', hairBack: 'head', eyes: 'head', eyesClosed: 'head', mouth: 'head', mouthOpen: 'head', brows: 'head',
  armL_up: 'torso', armL_low: 'armL_up', handL: 'armL_low', armR_up: 'torso', armR_low: 'armR_up', handR: 'armR_low',
  legL_up: 'torso', legL_low: 'legL_up', footL: 'legL_low', legR_up: 'torso', legR_low: 'legR_up', footR: 'legR_low', tail: 'torso', accessory: 'torso',
};
export const RIG_POSES = ['idle', 'walk', 'run', 'talk', 'wave', 'point', 'jump', 'cheer', 'sit', 'think'] as const;

/** Tira do SVG da IA tudo que não é desenho: scripts, eventos, links externos, foreignObject (função pura). */
export function sanitizeSvg(svg: string): string {
  return String(svg ?? '')
    .replace(/<\s*(script|foreignObject|iframe|object|embed|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|foreignObject|iframe|object|embed|style)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?svg\b[^>]*>/gi, '')
    .trim()
    .slice(0, 12_000);
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** Valida e normaliza o rig devolvido pela IA (função pura). Lança erro com o motivo quando não dá para animar. */
export function normalizeRig(raw: unknown, name = ''): Rig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sz = Array.isArray(r['size']) ? r['size'] as unknown[] : [];
  const w = Math.min(2000, Math.max(100, num(sz[0], 400))), h = Math.min(3000, Math.max(100, num(sz[1], 800)));
  const view = r['view'] === 'side' || r['view'] === 'three-quarter' ? r['view'] : 'front';
  const list = Array.isArray(r['parts']) ? r['parts'] as unknown[] : [];
  const parts: RigPart[] = [];
  const seen = new Set<string>();
  for (const x of list.slice(0, 40)) {
    const p = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = String(p['id'] ?? '').trim().replace(/[^\w-]/g, '').slice(0, 32);
    if (!id || seen.has(id)) continue;
    const svg = sanitizeSvg(String(p['svg'] ?? ''));
    if (!svg) continue;
    const pv = Array.isArray(p['pivot']) ? p['pivot'] as unknown[] : [];
    seen.add(id);
    parts.push({ id, parent: typeof p['parent'] === 'string' && p['parent'] ? String(p['parent']) : DEFAULT_PARENT[id], pivot: [num(pv[0], w / 2), num(pv[1], h / 2)], z: num(p['z'], parts.length), svg });
  }
  const missing = RIG_REQUIRED.filter((k) => !seen.has(k));
  if (missing.length) throw new Error(`o rig não tem as peças ${missing.join(', ')}`);
  /* pai inexistente ou ciclo → pendura no tronco */
  for (const p of parts) {
    if (p.id === 'torso') { delete p.parent; continue; }
    if (!p.parent || !seen.has(p.parent) || p.parent === p.id) p.parent = 'torso';
  }
  const byId = new Map(parts.map((p) => [p.id, p]));
  for (const p of parts) {
    const chain = new Set<string>([p.id]);
    let cur = p.parent;
    while (cur) {
      if (chain.has(cur)) { p.parent = 'torso'; break; }
      chain.add(cur); cur = byId.get(cur)?.parent;
    }
  }
  const pal = Array.isArray(r['palette']) ? (r['palette'] as unknown[]).map(String).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 12) : undefined;
  return { version: 1, name: String(r['name'] ?? name).slice(0, 60) || name, size: [w, h], view, parts, style: typeof r['style'] === 'string' ? r['style'].slice(0, 300) : undefined, palette: pal?.length ? pal : undefined };
}

/** Pedido à IA: desenhar o rig em peças (o motor faz o movimento). */
export function rigPrompt(o: { what: string; name: string; look: string; style?: string; code?: string; hasRef?: boolean; refKind?: 'image' | 'video' | 'model'; previous?: boolean }): string {
  return [
    `Você é ilustrador de personagens para ANIMAÇÃO POR CÓDIGO (cut-out / rig 2D em camadas, como em Moho/Spine). Desenhe o ${o.what} "${o.name}" separado em PEÇAS SVG articuladas.`,
    `Aparência fixa: ${o.look}`,
    o.code ? `Desenho em código já definido (siga cores e proporções): ${o.code}` : '',
    `Estilo: ${o.style || 'flat 2D vetorial, contorno limpo, cores sólidas, sombra simples'}`,
    o.hasRef ? `Há ${o.refKind === 'video' ? 'QUADROS DE UM VÍDEO' : o.refKind === 'model' ? 'VISTAS DE UM MODELO 3D' : 'uma IMAGEM'} de referência anexados. COPIE O ESTILO dela: traço (espessura e cor do contorno), forma de cabeça e olhos, proporções (cabeças de altura), paleta (extraia as cores em hex), tipo de sombra/brilho e textura. Recrie em vetor — não copie pixels nem texto.` : '',
    o.previous ? 'O usuário pediu OUTRA versão: mude o traço/pose de descanso/paleta mantendo a identidade.' : '',
    'REGRAS DO RIG:',
    '- Espaço do rig: "size": [400, 800] (largura, altura). Desenhe na POSE DE DESCANSO: em pé, de frente (ou 3/4), braços caídos ao lado do corpo, pés no chão em y≈790, centro em x=200.',
    `- Peças OBRIGATÓRIAS (ids exatos): ${RIG_REQUIRED.join(', ')}. Opcionais: ${RIG_OPTIONAL.join(', ')}. "L" é o lado ESQUERDO DA TELA, "R" o direito.`,
    '- Cada peça: {"id", "parent", "pivot":[x,y], "z", "svg"}. "svg" contém SÓ elementos <path>/<ellipse>/<circle>/<rect>/<polygon>/<g> em coordenadas ABSOLUTAS do espaço do rig (não use transform na peça inteira; sem <svg>, sem texto, sem imagens, sem gradientes por url externa).',
    '- Pivôs: torso = centro do quadril; head = base do pescoço; armX_up = ombro; armX_low = cotovelo; legX_up = quadril daquele lado; legX_low = joelho; handX = punho; footX = tornozelo.',
    '- Hierarquia: torso é a raiz; head/armX_up/legX_up filhos do torso; armX_low filho de armX_up; legX_low filho de legX_up; mãos/pés filhos do segmento de baixo; eyes/eyesClosed/mouth/mouthOpen/brows/hair filhos de head.',
    '- Para a articulação não abrir buracos, cada segmento SOBREPÕE o próximo: termine o braço/perna com uma ponta arredondada (círculo no cotovelo/joelho) que cobre a junta.',
    '- Camadas (z): braço e perna do lado de trás atrás do tronco (z menor), tronco, cabeça na frente; o braço da frente na frente do tronco. Ex.: legR 1-2, armR 3-4, torso 5, legL 6-7, head 8, olhos/boca 9-10, armL 11-12.',
    '- "eyesClosed" (olhos fechados, para piscar) e "mouthOpen" (boca aberta, para falar) ficam no MESMO lugar de "eyes" e "mouth".',
    '- Também: "view": "front" | "three-quarter" | "side", "palette": [cores hex usadas], "style": frase curta do estilo.',
    'Responda SOMENTE com JSON: {"name":"...","size":[400,800],"view":"front","palette":["#..."],"style":"...","parts":[{"id":"torso","pivot":[200,470],"z":5,"svg":"<path d=\\"...\\" fill=\\"#...\\" stroke=\\"#...\\" stroke-width=\\"4\\"/>"}, ...]}',
  ].filter(Boolean).join('\n');
}

/**
 * Motor do rig (script comum, sem módulos nem rede): window.ForgeRig.
 *   const boneco = ForgeRig.mount(container, FORGE_RIGS['Nome'])   // SVG articulado dentro de um elemento
 *   boneco.update({ x, y, scale, flip, pose: 'walk', t, talk: true, joints: { head: 5 } })
 *   await ForgeRig.ready(rig); ForgeRig.draw(ctx, rig, { x, y, scale, pose, t })   // canvas 2D
 * x/y = centro dos pés na cena; scale = altura em px / altura do rig (ou use height: px).
 */
export const RIG_RUNTIME = String.raw`/* ForgeRig — motor de personagens articulados em camadas (FilmForge). Determinístico: tudo depende de t. */
(function () {
  if (window.ForgeRig) return;
  var D2R = Math.PI / 180;
  function mul(a, b) { return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]; }
  function rotAt(deg, px, py) { var r = deg * D2R, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, px - c*px + s*py, py - s*px - c*py]; }
  function hash(n) { var x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }
  /* poses: graus por junta (positivo = horário na tela). Braço/perna "L" (lado esquerdo da tela) abre com +, "R" com - */
  var POSES = {
    idle: function (t) { var b = Math.sin(t * 2.2); return { dy: b * 2, torso: b * 0.6, head: Math.sin(t * 1.3) * 2, armL_up: 4 + b, armR_up: -4 - b, armL_low: -3, armR_low: 3 }; },
    /* de frente, a perna não gira para o lado (viraria tesoura): o passo é a perna SUBINDO (joelho) no lugar */
    walk: function (t, v) { var w = t * Math.PI * 2 * 1.0, s = Math.sin(w);
      if (v === 'front') return { dy: -Math.abs(Math.cos(w)) * 5, torso: s * 1.2, head: -s * 1.2, 'legL_up@dy': -Math.max(0, s) * 18, 'legR_up@dy': -Math.max(0, -s) * 18,
        legL_up: s * 2, legR_up: s * 2, armL_up: 5 - s * 7, armR_up: -5 - s * 7, armL_low: -6, armR_low: 6 };
      var k = 1;
      return { dy: -Math.abs(Math.cos(w)) * 7, torso: s * 1.5, head: -s * 1.5,
        legL_up: s * 26 * k, legR_up: -s * 26 * k, legL_low: Math.max(0, -Math.cos(w)) * -28 * k, legR_low: Math.max(0, Math.cos(w)) * -28 * k,
        armL_up: -s * 22 * k + 4, armR_up: s * 22 * k - 4, armL_low: -10, armR_low: 10 }; },
    run: function (t, v) { var w = t * Math.PI * 2 * 1.7, s = Math.sin(w);
      if (v === 'front') return { dy: -Math.abs(Math.cos(w)) * 12, torso: s * 2, head: -s * 2, 'legL_up@dy': -Math.max(0, s) * 34, 'legR_up@dy': -Math.max(0, -s) * 34,
        armL_up: 12 - s * 14, armR_up: -12 - s * 14, armL_low: -60, armR_low: 60 };
      var k = 1;
      return { dy: -Math.abs(Math.cos(w)) * 16, torso: 8 * k, head: -6 * k,
        legL_up: s * 42 * k, legR_up: -s * 42 * k, legL_low: Math.max(0, -Math.cos(w)) * -70 * k - 10, legR_low: Math.max(0, Math.cos(w)) * -70 * k - 10,
        armL_up: -s * 45 * k + 8, armR_up: s * 45 * k - 8, armL_low: -70, armR_low: 70 }; },
    talk: function (t) { var b = Math.sin(t * 2.2), g = Math.sin(t * 3.1);
      return { dy: b * 2, torso: b * 0.8, head: Math.sin(t * 4.3) * 3 + Math.sin(t * 1.7) * 2, armL_up: 18 + g * 8, armL_low: -55 - g * 15, armR_up: -6, armR_low: 4, talk: 1 }; },
    wave: function (t) { var g = Math.sin(t * Math.PI * 2 * 1.6); return { dy: Math.sin(t * 2.2) * 2, head: 4, armR_up: -150, armR_low: -20 + g * 28, armL_up: 4, armL_low: -3 }; },
    point: function (t) { return { dy: Math.sin(t * 2.2) * 2, torso: -3, head: -6, armR_up: -88 + Math.sin(t * 2) * 2, armR_low: -4, armL_up: 6, armL_low: -8 }; },
    jump: function (t) { var p = t % 1.2, up = p < 0.25 ? 0 : p < 0.85 ? Math.sin((p - 0.25) / 0.6 * Math.PI) : 0, crouch = p < 0.25 ? Math.sin(p / 0.25 * Math.PI) : p > 0.85 ? Math.sin((p - 0.85) / 0.35 * Math.PI) : 0;
      return { dy: -up * 90 + crouch * 22, legL_up: -crouch * 35 + up * 10, legR_up: crouch * 35 - up * 10, legL_low: crouch * 60 + up * 25, legR_low: -crouch * 60 - up * 25, armL_up: 40 + up * 120, armR_up: -40 - up * 120, armL_low: -10, armR_low: 10 }; },
    cheer: function (t) { var g = Math.sin(t * Math.PI * 2 * 1.4); return { dy: -Math.abs(g) * 14, armL_up: 150 + g * 15, armR_up: -150 - g * 15, armL_low: 15, armR_low: -15, head: g * 4, talk: 1 }; },
    sit: function (t, v) { if (v === 'front') return { dy: 120, 'legL_up@dy': -110, 'legR_up@dy': -110, legL_up: 6, legR_up: -6, armL_up: 8, armR_up: -8, armL_low: -35, armR_low: 35, head: Math.sin(t * 1.3) * 2 };
      return { dy: 150, torso: 0, legL_up: -80, legR_up: 80, legL_low: 80, legR_low: -80, armL_up: 10, armR_up: -10, armL_low: -40, armR_low: 40, head: Math.sin(t * 1.3) * 2 }; },
    think: function (t) { return { dy: Math.sin(t * 2) * 2, head: 8 + Math.sin(t * 0.9) * 2, armR_up: -25, armR_low: 140, armL_up: 15, armL_low: -60 }; }
  };
  function stateOf(rig, o) {
    o = o || {}; var t = +o.t || 0;
    var f = (POSES[o.pose] || POSES.idle)(t, rig.view) || {};
    var j = {}; for (var k in f) j[k] = f[k]; var add = o.joints || {}; for (var k2 in add) j[k2] = (j[k2] || 0) + add[k2];
    var talk = o.talk === undefined ? !!f.talk : !!o.talk;
    var mouthOpen = talk && (Math.sin(t * 15.7) + Math.sin(t * 9.3 + 1) * 0.6 + hash(Math.floor(t * 12)) * 0.8) > 0.35;
    var bp = (o.blinkSeed || 0) + t, cyc = bp % 3.4; var blink = o.blink === false ? false : cyc > 3.25;
    return { j: j, mouthOpen: mouthOpen, blink: blink };
  }
  /* matriz de cada peça no espaço do rig (pose aplicada) */
  function solve(rig, st) {
    var by = {}, out = {}, parts = rig.parts;
    for (var i = 0; i < parts.length; i++) by[parts[i].id] = parts[i];
    function m(id) {
      if (out[id]) return out[id];
      var p = by[id], a = st.j[id] || 0, base;
      if (!p.parent || !by[p.parent]) base = [1, 0, 0, 1, 0, st.j.dy || 0]; else base = m(p.parent);
      var ox = st.j[id + '@dx'] || 0, oy = st.j[id + '@dy'] || 0;
      if (ox || oy) base = mul(base, [1, 0, 0, 1, ox, oy]);
      out[id] = mul(base, rotAt(a, p.pivot[0], p.pivot[1]));
      return out[id];
    }
    for (var n = 0; n < parts.length; n++) m(parts[n].id);
    return out;
  }
  function visible(id, st, rig) {
    var has = function (k) { return rig.parts.some(function (p) { return p.id === k; }); };
    if (id === 'eyes' && st.blink && has('eyesClosed')) return false;
    if (id === 'eyesClosed') return st.blink;
    if (id === 'mouth' && st.mouthOpen && has('mouthOpen')) return false;
    if (id === 'mouthOpen') return st.mouthOpen;
    return true;
  }
  function sorted(rig) { return rig.parts.slice().sort(function (a, b) { return a.z - b.z; }); }
  var NS = 'http://www.w3.org/2000/svg';
  function mount(container, rig, opts) {
    opts = opts || {};
    var W = rig.size[0], H = rig.size[1];
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('overflow', 'visible');
    svg.style.position = 'absolute'; svg.style.overflow = 'visible'; svg.style.pointerEvents = 'none'; svg.style.transformOrigin = '50% 100%';
    var groups = {};
    sorted(rig).forEach(function (p) { var g = document.createElementNS(NS, 'g'); g.innerHTML = p.svg; g.setAttribute('data-part', p.id); svg.appendChild(g); groups[p.id] = g; });
    if (container) container.appendChild(svg);
    var inst = { el: svg, rig: rig, update: function (o) {
      o = o || {};
      var st = stateOf(rig, o), mats = solve(rig, st);
      for (var id in groups) { var mm = mats[id]; groups[id].setAttribute('transform', 'matrix(' + mm.join(' ') + ')'); groups[id].style.display = visible(id, st, rig) ? '' : 'none'; }
      var sc = o.height ? o.height / H : (o.scale || 1), x = o.x === undefined ? W / 2 : o.x, y = o.y === undefined ? H : o.y;
      svg.style.width = (W * sc) + 'px'; svg.style.height = (H * sc) + 'px';
      svg.style.left = (x - W * sc / 2) + 'px'; svg.style.top = (y - H * sc) + 'px';
      svg.style.transform = (o.flip ? 'scaleX(-1) ' : '') + (o.rotate ? 'rotate(' + o.rotate + 'deg)' : '');
      svg.style.opacity = o.opacity === undefined ? '' : String(o.opacity);
      return inst;
    } };
    inst.update(opts);
    return inst;
  }
  /* string SVG (<g>) para quem monta a cena inteira em SVG */
  function svgGroup(rig, o) {
    o = o || {}; var W = rig.size[0], H = rig.size[1], st = stateOf(rig, o), mats = solve(rig, st);
    var sc = o.height ? o.height / H : (o.scale || 1), x = o.x === undefined ? W / 2 : o.x, y = o.y === undefined ? H : o.y;
    var outer = 'translate(' + x + ' ' + y + ') scale(' + (o.flip ? -sc : sc) + ' ' + sc + ') translate(' + (-W / 2) + ' ' + (-H) + ')';
    return '<g transform="' + outer + '">' + sorted(rig).filter(function (p) { return visible(p.id, st, rig); }).map(function (p) { return '<g transform="matrix(' + mats[p.id].join(' ') + ')">' + p.svg + '</g>'; }).join('') + '</g>';
  }
  /* canvas 2D: cada peça vira uma imagem (carregue antes com ready) */
  var cache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function ready(rig) {
    if (cache && cache.get(rig)) return cache.get(rig).p;
    var W = rig.size[0], H = rig.size[1], imgs = {};
    var p = Promise.all(rig.parts.map(function (part) { return new Promise(function (res) {
      var im = new Image(); im.onload = function () { res(); }; im.onerror = function () { res(); };
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="' + NS + '" viewBox="0 0 ' + W + ' ' + H + '" width="' + W * 2 + '" height="' + H * 2 + '">' + part.svg + '</svg>');
      imgs[part.id] = im; }); }));
    var e = { p: p.then(function () { return true; }), imgs: imgs }; if (cache) cache.set(rig, e); return e.p;
  }
  function draw(ctx, rig, o) {
    o = o || {}; var e = cache && cache.get(rig); if (!e) { ready(rig); return false; }
    var W = rig.size[0], H = rig.size[1], st = stateOf(rig, o), mats = solve(rig, st);
    var sc = o.height ? o.height / H : (o.scale || 1), x = o.x === undefined ? W / 2 : o.x, y = o.y === undefined ? H : o.y;
    ctx.save(); ctx.translate(x, y); ctx.scale(o.flip ? -sc : sc, sc); ctx.translate(-W / 2, -H);
    if (o.opacity !== undefined) ctx.globalAlpha *= o.opacity;
    sorted(rig).forEach(function (p) { if (!visible(p.id, st, rig)) return; var mm = mats[p.id], im = e.imgs[p.id]; if (!im || !im.complete) return;
      ctx.save(); ctx.transform(mm[0], mm[1], mm[2], mm[3], mm[4], mm[5]); ctx.drawImage(im, 0, 0, W, H); ctx.restore(); });
    ctx.restore(); return true;
  }
  window.ForgeRig = { mount: mount, draw: draw, ready: ready, svgGroup: svgGroup, poses: Object.keys(POSES), state: stateOf, solve: solve };
})();
`;

/** Script do rig de um item: registra em window.FORGE_RIGS[nome] (carregável por <script src>, sem fetch). */
export function rigScript(rig: Rig, name: string): string {
  return `window.FORGE_RIGS = window.FORGE_RIGS || {};\nwindow.FORGE_RIGS[${JSON.stringify(name)}] = ${JSON.stringify(rig)};\n`;
}

/** Página de prévia: o rig em 4 poses lado a lado (para aceitar ou pedir outro). */
export function rigPreviewHtml(rig: Rig): string {
  const poses: Array<[string, number]> = [['idle', 0.4], ['walk', 0.25], ['wave', 0.3], ['talk', 0.55]];
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f4f6f8;font:14px sans-serif;color:#556}#s{position:relative;width:1200px;height:600px}.lb{position:absolute;bottom:8px;width:300px;text-align:center}</style></head>
<body><div id="s">${poses.map(([p], i) => `<div class="lb" style="left:${i * 300}px">${p}</div>`).join('')}</div><script>${RIG_RUNTIME}
var rig = ${JSON.stringify(rig)}; var s = document.getElementById('s');
var inst = ${JSON.stringify(poses)}.map(function (p, i) { return ForgeRig.mount(s, rig, { x: 150 + i * 300, y: 560, height: 520, pose: p[0], t: p[1] }); });
window.__forge = { duration: 2, fps: 30, seek: function (t) { inst.forEach(function (b, i) { var p = ${JSON.stringify(poses)}[i]; b.update({ x: 150 + i * 300, y: 560, height: 520, pose: p[0], t: p[1] + t }); }); }, pause: function () {} };
</script></body></html>`;
}

/** Página da miniatura: o rig parado, inteiro e centrado num quadro 480x480. */
export function rigThumbHtml(rig: Rig): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#eef1f5}#s{position:relative;width:480px;height:480px}</style></head>
<body><div id="s"></div><script>${RIG_RUNTIME}
var b = ForgeRig.mount(document.getElementById('s'), ${JSON.stringify(rig)}, { x: 240, y: 466, height: 450, pose: 'idle', t: 0.4, blink: false });
window.__forge = { duration: 1, fps: 30, seek: function () {}, pause: function () {} };
</script></body></html>`;
}

/** Grava o rig do item (rig.json) e devolve o nome do arquivo. */
export function saveRigFile(dir: string, rig: Rig): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'rig.json'), JSON.stringify(rig, null, 1));
  return 'rig.json';
}

/**
 * Copia o motor e o rig para o projeto (assets/user/rigs/) e devolve os caminhos relativos à pasta do projeto.
 */
export function stageRig(projectDir: string, id: string, rig: Rig, name: string): { runtime: string; script: string } {
  const dir = path.join(projectDir, 'assets', 'user', 'rigs');
  fs.mkdirSync(dir, { recursive: true });
  const rt = path.join(dir, 'forge-rig.js');
  if (!fs.existsSync(rt) || fs.readFileSync(rt, 'utf8') !== RIG_RUNTIME) fs.writeFileSync(rt, RIG_RUNTIME);
  fs.writeFileSync(path.join(dir, `${id}.rig.js`), rigScript(rig, name));
  return { runtime: 'assets/user/rigs/forge-rig.js', script: `assets/user/rigs/${id}.rig.js` };
}

/** Instrução da cena por código para os personagens com rig (caminhos relativos à página). Função pura. */
export function rigSceneText(rigs: Array<{ name: string; script: string }>, runtimeRel: string): string {
  if (!rigs.length) return '';
  return [
    `PERSONAGENS ARTICULADOS (rig em camadas da Biblioteca — use-os em vez de desenhar esses personagens à mão):`,
    `- Carregue ANTES do seu script: <script src="${runtimeRel}"></script> ${rigs.map((r) => `<script src="${r.script}"></script>`).join(' ')}`,
    `- Cada um está em window.FORGE_RIGS[nome]: ${rigs.map((r) => JSON.stringify(r.name)).join(', ')}.`,
    `- DOM/SVG: const b = ForgeRig.mount(palcoDiv, FORGE_RIGS["Nome"]); e em seek(t): b.update({ x, y, height, flip, pose, t, talk }) — x/y = centro dos pés em px no palco (position:relative), height = altura em px.`,
    `- Canvas 2D: await ForgeRig.ready(FORGE_RIGS["Nome"]) antes do 1º quadro; em seek(t): ForgeRig.draw(ctx, FORGE_RIGS["Nome"], { x, y, height, flip, pose, t, talk }).`,
    `- SVG inteiro da cena: svg.innerHTML += ForgeRig.svgGroup(FORGE_RIGS["Nome"], { x, y, height, pose, t }).`,
    `- Poses: ${RIG_POSES.join(', ')} (movimento pronto e contínuo em t); talk: true abre/fecha a boca enquanto ele fala (use nos trechos da fala dele); flip: true vira para o outro lado; joints: { head: 10, armR_up: -30, 'legL_up@dy': -12 } soma ângulos (graus) e deslocamentos (@dx/@dy em px do rig) para gestos próprios.`,
    `- Desloque x ao longo do tempo para andar/correr pela cena (a pose só mexe o corpo), troque de pose nos tempos da narração e mantenha a mesma altura do personagem entre as cenas.`,
  ].join('\n');
}

/**
 * Personagem da biblioteca cartoon3d descrito pela ESPECIFICAÇÃO (aparência como { jacket:"#…", pants:"#…", hat:"cap", build:"stout" }, seed N):
 * devolve o figurino e a semente para desenhar com C.createStage().actor(outfit, { seed }). Função pura.
 */
export function cartoonSpecOf(look: string | undefined): { outfit: Record<string, string>; seed: number } | undefined {
  const m = /\{[^{}]*\}/.exec(String(look ?? ''));
  if (!m) return undefined;
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(m[0].replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/, '}')) as Record<string, unknown>; } catch { return undefined; }
  if (typeof obj['jacket'] !== 'string' || typeof obj['pants'] !== 'string') return undefined;
  const outfit: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && /^[a-z]\w{0,20}$/i.test(k) && v.length < 40) outfit[k] = v;
  if (outfit['build'] && !['adult', 'stout', 'kid'].includes(outfit['build'])) delete outfit['build'];
  const seed = Number(/seed\s*(\d+)/i.exec(String(look))?.[1] ?? 1);
  return { outfit, seed: Number.isFinite(seed) ? seed : 1 };
}

/** O item é desenhado por CÓDIGO (tipo "desenho por código", desenho em código, rig ou especificação cartoon3d)? Função pura. */
export function isCodeCharacter(c: { kind?: string; code?: string; rig?: string; look?: string; blocky?: unknown }): boolean {
  return c.kind === 'codigo' || !!c.code?.trim() || !!c.rig || !!cartoonSpecOf(c.look) || !!c.blocky;
}

/** Página da miniatura de um personagem cartoon3d (o mesmo desenho das cenas por código), 480x480. */
export function cartoonThumbHtml(spec: { outfit: Record<string, string>; seed: number }, importmap: Record<string, string>): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}</style>
<script type="importmap">${JSON.stringify({ imports: importmap })}</script></head><body><script type="module">
import * as C from "cartoon3d";
const st = C.createStage({ width: 480, height: 480, light: "day" });
st.ground("grass");
const a = st.actor(${JSON.stringify(spec.outfit)}, { name: "item", x: 0, z: 0, seed: ${spec.seed} });
function seek() {
  st.cam([0, 0.95, 3.4], [0, 0.85, 0], 34);
  a.set({ mode: "stand", expr: "grin", blink: 0 });
  st.render({ dof: 0 });
}
window.__forge = { duration: 1, fps: 30, seek, pause() {} };
</script></body></html>`;
}
