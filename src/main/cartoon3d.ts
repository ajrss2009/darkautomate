import type { Aspect } from '../shared/types';

/**
 * "Curta cartoon 3D": cenas em Three.js com a biblioteca local cartoon3d (vendor/cartoon3d, MIT — visual do
 * github.com/mromidev/claude-animated-shorts). Pedido da cena, esqueleto e API resumida para o harness. Funções puras.
 */
export const CARTOON3D_SKILL_ID = 'curta-cartoon-3d';

export function cartoon3dSize(aspect: Aspect | undefined): { w: number; h: number } {
  return aspect === '16:9' ? { w: 1920, h: 1080 } : aspect === '1:1' ? { w: 1080, h: 1080 } : aspect === '4:5' ? { w: 1080, h: 1350 } : { w: 1080, h: 1920 };
}

/** Esqueleto mínimo que já funciona (o harness completa o mundo, o elenco e a câmera). */
export function cartoon3dSkeleton(dur: number, fps: number, w: number, h: number, imports: Record<string, string>): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh;object-fit:contain}</style>
<script type="importmap">${JSON.stringify({ imports })}</script></head>
<body><canvas id="c"></canvas>
<script type="module">
import * as C from "cartoon3d";
const DUR = ${dur}, FPS = ${fps};
const st = C.createStage({ width: ${w}, height: ${h}, light: "day" });   // "day" | "golden" | "night" | "interior"
st.street({ length: 70, width: 11, seed: 2 });                             // ou st.ground("grass") + st.house(...), ou st.room(...)
st.clouds(5);
const hero = st.actor(C.OUTFITS.townsfolk(0), { name: "herói", x: 0, z: -2, seed: 1 });
const CAM = [
  { t: 0, pos: [0.3, 1.5, 4.5], look: [0, 1.2, -2], fov: 38 },
  { t: DUR, pos: [0.6, 1.6, 3.2], look: [0, 1.3, -2], fov: 34, roll: 3 },
];
function seek(t) {
  st.camFrom(C.camAt(CAM, t));
  hero.set({ mode: "stand", expr: "neutral", blink: C.blink(t, 1) });
  st.render({ dof: 0 });
}
let raf = 0, t0 = performance.now();
const loop = () => { seek(((performance.now() - t0) / 1000) % DUR); raf = requestAnimationFrame(loop); };
window.__forge = { duration: DUR, fps: FPS, seek, pause() { cancelAnimationFrame(raf); }, sfx: [] };
loop();
</script></body></html>`;
}

/** API resumida da biblioteca (o que existe; nomes fora desta lista não existem). */
export const CARTOON3D_API = `API "cartoon3d" (import * as C from "cartoon3d"; THREE também disponível: import * as THREE from "three"):
- const st = C.createStage({ width, height, light }) — luz: "day" (céu azul, sol alto), "golden" (pôr do sol contra a luz), "night" (lua azul), "interior" (lâmpadas quentes). st.setLight(nome) troca no meio da cena.
- MUNDO (chame UMA vez, fora do seek): st.street({ length, width, seed, sides:"both"|"left"|"right", ground }) rua com casas pintadas dos dois lados (z de 12 até -length);
  st.ground(kind, size) kind "cobble"|"grass"|"stone"|"planks"|"dirt"|"#hex"; st.house({ x, z, yaw, w, d, h, style:0..5, wall, shutter, roof, brick, timber, door, sign:"TEXTO" }) fachada com porta virada para +z local (yaw em graus);
  st.room({ w, d, h, wall, floor, wainscot }) sala vista de dentro (aberta para +z); st.prop(kind, { x, y, z, yaw, scale, color }) kind = "barrel"|"crate"|"bottle"|"table"|"chair"|"lamppost"|"car"(sedã anos 20, comprimento no x)|"tree"|"bar"(balcão com garrafas)|"door"|"fence"|"box";
  st.sign("TEXTO", { x, y, z, yaw, w, h, bg, fg }) placa legível (até 3 palavras); st.clouds(n); st.mesh(geometry, "#hex", [x,y,z], yawGraus) para formas próprias (material de duas tonalidades já com contorno; já entra no mundo).
  Para agrupar peças: const g = st.add(new THREE.Group()); g.add(st.mesh(...), st.mesh(...)); g.position.set(x, 0, z) — nunca adicione a um grupo que não foi passado por st.add.
- PERSONAGENS 2D (cartões iluminados que sempre olham a câmera; 1 unidade = 1 m, adulto ≈ 1,75 m, pés no y=0):
  const a = st.actor(outfit, { name: "Al Capone", x, z, seed, scale, res }) — dê SEMPRE o name (o agente de enquadramento usa o nome no relatório); no seek: a.set({ x, z, mode:"stand"|"stroll"|"march"|"sit"|"fall", phase: t, expr, look:-1..1, blink: C.blink(t, seed), wave: 0..1 (acenar), tilt, headTilt, facing:-1|0|1, side:true (perfil andando, olha para a direita; mirror:true vira), visible });
  expr = "neutral"|"stern"|"grin"|"laugh"|"whistle"|"nervous"|"shock"|"relief"|"relief_open"|"dazed"|"pained"|"smile"|"smile_closed"|"lick".
  Roupas prontas: C.OUTFITS.police, .gangster, .barman, .flapper, .worker, .preacher, .reporter, .kid, .parent, .officer, .rifleman, C.OUTFITS.townsfolk(n), C.OUTFITS.soldier(n);
  ou um objeto { jacket:"#hex", pants:"#hex", boots:"#hex", hat:"tophat"|"cap"|"hair"|"bonnet"|"shako"|"shako_tall", cap:"#hex", hair:"#hex", dress:"#hex", moustache:"#hex", skin:"#hex", buttons:"#hex", belt:"#hex", build:"adult"|"stout"|"kid" }.
- EFEITOS 2D no ponto 3D (chame no seek, só enquanto aparecem; t = progresso 0..1): st.fx("burst"|"splash"|"puff"|"stars"|"note"|"note2"|"ring"|"creak"|"cloud", { x, y, z, size, t, color }).
- DESENHO PRÓPRIO FIXO (cartaz, jornal, garrafa grande, ícone): const cartaz = st.poster("chave-unica", { x, y, z, w, h, cw:512, ch:512, face:true }, (p, g) => { /* Canvas2D em g (cw x ch) */ }) — crie FORA do seek; devolve um THREE.Mesh: no seek use cartaz.visible, cartaz.position, cartaz.scale.set(s, s, 1).
  Desenho só deste quadro: st.draw("chave", { x, y, z, w, h }, (p, g) => {...}) chamado DENTRO do seek em todo quadro em que aparece (não guarde o retorno).
  Texto escrito com g.fillText/g.strokeText num st.poster ou st.draw (rótulo de barril, manchete, placa desenhada) também passa pela revisão de letreiros: o maior texto do desenho precisa ficar com a letra ≥ 3% da altura do quadro, de frente, inteiro na tela e com contraste forte com o fundo desenhado.
  st.fx(...) e st.draw(...) valem só para o quadro atual; st.actor(...), st.poster(...), st.prop(...), st.sign(...), st.house(...) e st.mesh(...) são objetos fixos.
- CÂMERA: st.camFrom(C.camAt(CHAVES, t), [dx,dy,dz]) com CHAVES = [{ t, pos:[x,y,z], look:[x,y,z], fov, roll, cut:true? }] — deslizes suaves entre chaves, corte seco com cut:true, e toda pausa já faz um push-in lento; C.kick(t, instante, amp) dá o tranco de impacto (use no dy). Ou st.cam(pos, look, fov, roll).
- QUADRO: st.render({ dof: 0..16, focus, flash: 0..1 }) — UMA vez no fim do seek. dof = desfoque do fundo (close 12–14, plano médio 10–12, geral 0); flash = clarão branco.
- Utilitários: C.ease(x) smootherstep, C.blink(t, seed), C.kick(t, at, amp).`;

/** Regras de estilo (SKILL.md / STYLE_BIBLE.md do claude-animated-shorts, resumidas). */
export const CARTOON3D_RULES = `ESTILO "curta cartoon 3D" (personagens 2D chapados com contorno ameixa num mundo 3D pintado com contorno preto):
- Cada frase é ilustrada LITERALMENTE: o objeto/ação de que a narração fala aparece em cena no instante da palavra (reação 0–3 quadros ANTES da palavra). Adereços carregam a piada.
- Câmera: quase nunca corte seco; deslizes suaves de 0,6–1,3 s entre enquadramentos, push-in lento nas pausas, roll de 4–5° no drama, tranco (C.kick) nos impactos, câmera baixa (1,3–1,8 m).
- Profundidade: desfoque de fundo (dof 10–14) em closes e planos médios; planos gerais nítidos (dof 0). Foco nos olhos do personagem da frente.
- Luz conta a história: "day" para o normal, "golden" para clímax/emoção, "night" para segredo/crime, "interior" para bares e casas.
- Personagens: 2–4 por cena, expressões fortes (shock, grin, nervous, stern), piscam (C.blink), andam com mode:"stroll" e phase:t.
- Legibilidade: nada a menos de ~2 m da lente (vira borrão gigante cortado na borda); cartazes e efeitos com no máximo ~1/3 da altura do quadro; o personagem principal sempre inteiro ou cortado na cintura, nunca escondido atrás de objetos.
- Nada de legendas ou texto narrado na tela; texto só em placas/cartazes curtos do cenário (até 3 palavras).
- Mundo coerente com a época/lugar do tema (ex.: anos 1920 = sedãs, barris, lampiões, chapéus).`;

/** Corpo do pedido de uma cena em código no estilo cartoon 3D. */
export function cartoon3dScenePrompt(o: { file: string; exists: boolean; dur: number; fps: number; aspect: Aspect | undefined; imports: Record<string, string>; loops: boolean; sfx: string }): string {
  const { w, h } = cartoon3dSize(o.aspect), frames = Math.round(o.dur * o.fps);
  return `\nCrie UMA página HTML em Three.js usando a biblioteca LOCAL "cartoon3d" (já vem com o FilmForge, sem rede) ` +
    `${o.exists ? `Já existe uma versão em ${o.file}: PARTA DELA e aplique apenas os ajustes pedidos. ` : ''}com animação DETERMINÍSTICA, ${w}x${h}.\n` +
    `CONTRATO OBRIGATÓRIO: window.__forge = { duration: ${o.dur}, fps: ${o.fps}, seek(t), pause(), sfx }. São ${frames} quadros; o renderizador chama pause() e depois seek(i/${o.fps}). ` +
    `seek(t) posiciona câmera/personagens/efeitos em função SÓ de t e termina com st.render(). Não use Date.now/performance.now dentro do seek nem Math.random: o único relógio é t. ` +
    (o.loops ? `LOOP PERFEITO: seek(0) e seek(${o.dur}) idênticos. ` : `CENA LINEAR: acompanhe a fala do começo ao fim; o último quadro fecha a ação (não volte ao início). `) +
    `Construa o mundo e o elenco UMA vez fora do seek; no seek só mude poses, posições, câmera e efeitos.\n\n${CARTOON3D_RULES}\n\n${CARTOON3D_API}\n\n` +
    `Mantenha EXATAMENTE este import map e o import (os caminhos apontam para a cópia local no projeto). Parta deste esqueleto:\n${cartoon3dSkeleton(o.dur, o.fps, w, h, o.imports)}\n` +
    (o.sfx ? `\n${o.sfx}` : '');
}

/**
 * Import map da página com "three" e "cartoon3d" SEMPRE nos caminhos locais (o modelo às vezes escreve CDN ou caminho
 * errado); imports de CDN do three viram "three". Mantém as outras entradas. Função pura.
 */
export function forceCartoon3dImports(page: string, imports: Record<string, string>): string {
  let out = page.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(https?:\/\/(?![^"']*(?:examples|addons|jsm)\/)[^"']*three[^"']*)\2/gi, '$1$2three$2');
  const m = /<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/i.exec(out);
  let map: { imports?: Record<string, string> } = {};
  if (m) try { map = JSON.parse(m[1]!); } catch { /* import map inválido: recria */ }
  const tag = `<script type="importmap">${JSON.stringify({ ...map, imports: { ...(map.imports ?? {}), ...imports } })}</script>`;
  if (m) return out.slice(0, m.index) + tag + out.slice(m.index + m[0].length);
  const at = out.search(/<script[^>]*type=["']module["']/i);
  return at >= 0 ? out.slice(0, at) + tag + out.slice(at) : out;
}

/**
 * Relatório da revisão de cena gravado pelo renderizador (<clipe>.framing.json), um registro por quadro:
 * frames = status por personagem; signs = status por letreiro; jumps = trocas bruscas de cor de material.
 */
export interface FramingReport {
  fps: number; names: string[]; frames: string[];
  signNames?: string[]; signs?: string[]; jumps?: Array<{ f: number; name: string; from: string; to: string }>;
}

const sec = (f: number, fps: number) => (f / fps).toFixed(1).replace('.', ',');
type Run = { v: number; a: number; b: number };
const runsOf = (st: number[]): Run[] => {
  const runs: Run[] = [];
  for (let f = 0; f < st.length; f++) {
    const last = runs[runs.length - 1];
    if (last && last.v === st[f] && last.b === f - 1) last.b = f; else runs.push({ v: st[f]!, a: f, b: f });
  }
  return runs;
};

/**
 * Agente de revisão de cena (cartoon 3D): problemas que o espectador nota, medidos quadro a quadro pela biblioteca.
 *  - personagem: rosto cortado, cortado pela lateral (pela metade), fora do quadro no meio da cena, nunca aparece,
 *    rosto BLOQUEADO por um objeto/personagem na frente, metade do corpo escondida atrás de algo;
 *  - letreiro na tela que nunca fica legível (letra pequena, muito de lado, coberto, sem contraste ou cortado) — placas
 *    st.sign e o maior texto desenhado (fillText) em st.poster/st.draw;
 *  - mudança brusca de cor de material (de um quadro para o outro) e troca seca de luz.
 * Entradas e saídas pela borda no começo/fim da cena são permitidas.
 * Status do personagem: 0 ok, 1 rosto cortado, 2 cortado de lado, 3 fora, 4 rosto bloqueado, 5 metade escondida, -1 escondido.
 * Status do letreiro: -1 fora da tela, 0 legível, 1 letra pequena, 2 muito de lado, 3 coberto, 4 pouco contraste, 5 cortado pela borda. Função pura.
 */
export function framingIssues(r: FramingReport): string[] {
  const fps = r.fps || 30, rows = r.frames.map((f) => f.split(',').map(Number)), n = rows.length, out: string[] = [];
  if (!n) return out;
  r.names.forEach((name, i) => {
    const st = rows.map((row) => row[i] ?? -1);
    const shown = st.filter((v) => v >= 0).length;
    if (!shown) return;
    const seen = st.some((v) => v === 0 || v === 1 || v === 2 || v === 4 || v === 5);
    if (!seen) { if (shown >= n * 0.5) out.push(`"${name}" está na cena mas NUNCA aparece no quadro (a câmera não o mostra)`); return; }
    const runs = runsOf(st);
    runs.forEach((run, k) => {
      const len = (run.b - run.a + 1) / fps, edge = run.a === 0 || run.b === n - 1;
      const nearOut = runs[k - 1]?.v === 3 || runs[k + 1]?.v === 3;
      const when = `de ${sec(run.a, fps)} s a ${sec(run.b + 1, fps)} s`;
      if (run.v === 3 && len >= 0.6 && !edge) out.push(`"${name}" sai do quadro ${when} (some da tela no meio da cena)`);
      else if (run.v === 1 && len >= 0.3) out.push(`"${name}" com o ROSTO cortado pela borda ${when}`);
      else if (run.v === 2 && len >= 0.5 && !(nearOut && len < 1)) out.push(`"${name}" PELA METADE: cortado pela lateral do quadro ${when} (menos de 60% do corpo visível)`);
      else if (run.v === 4 && len >= 0.4) out.push(`"${name}" BLOQUEADO ${when}: o rosto fica atrás de um objeto ou de outro personagem`);
      else if (run.v === 5 && len >= 0.6) out.push(`"${name}" PELA METADE ${when}: mais da metade do corpo escondida atrás de algo na frente`);
    });
  });
  /* letreiros: na tela por ≥ 1 s e legível por menos de 0,6 s (e menos de 30% do tempo em que aparece) */
  const signRows = (r.signs ?? []).map((f) => (f ? f.split(',').map(Number) : []));
  const WHY = ['', 'letras pequenas demais na tela', 'visto muito de lado', 'coberto por algo na frente', 'pouco contraste entre texto e fundo', 'CORTADO pela borda do quadro (parte do texto fica fora da tela)'];
  (r.signNames ?? []).forEach((text, i) => {
    const st = signRows.map((row) => row[i] ?? -1);
    const on = st.filter((v) => v >= 0).length, ok = st.filter((v) => v === 0).length;
    if (on / fps < 1 || ok / fps >= 0.6 || ok >= on * 0.3) return;
    const bad = [1, 2, 3, 4, 5].map((v) => ({ v, c: st.filter((x) => x === v).length })).sort((a, b) => b.c - a.c)[0]!;
    const first = st.findIndex((v) => v >= 0);
    out.push(`letreiro "${text}" ILEGÍVEL (na tela por ${sec(on, fps)} s a partir de ${sec(first, fps)} s, legível só ${sec(ok, fps)} s): ${WHY[bad.v]}` +
      (text.length > 18 ? ' — e o texto é longo demais (até 3 palavras)' : ''));
  });
  /* cores: saltos de um quadro para o outro (agrupados por objeto) */
  const byName = new Map<string, Array<{ f: number; from: string; to: string }>>();
  for (const j of r.jumps ?? []) { if (j.f <= 0 || j.f >= n) continue; const l = byName.get(j.name) ?? []; l.push(j); byName.set(j.name, l); }
  for (const [name, list] of byName) {
    const j = list[0]!;
    out.push(name === 'luz'
      ? `a LUZ troca de "${j.from}" para "${j.to}" de uma vez em ${sec(j.f, fps)} s (mudança brusca de cor da cena inteira)`
      : `mudança BRUSCA de cor em ${name}: ${j.from} → ${j.to} de um quadro para o outro em ${sec(j.f, fps)} s${list.length > 1 ? ` (${list.length}× na cena)` : ''}`);
  }
  return out.slice(0, 10);
}

/** Pedido ao harness para corrigir a cena (mesma página, só o necessário). */
export function framingFixPrompt(rel: string, issues: string[]): string {
  return [
    `AGENTE DE REVISÃO DE CENA (enquadramento, bloqueios, letreiros e cores) — o FilmForge mediu, quadro a quadro, ${rel} (cena cartoon 3D) e encontrou:`,
    issues.map((x) => `- ${x}`).join('\n'),
    `Corrija ${rel} no lugar (grave o arquivo inteiro), mudando só o necessário:\n` +
    '- ENQUADRAMENTO: ajuste as chaves de câmera (pos, look, fov) e/ou x/z dos personagens nesses instantes para cada personagem em cena ficar INTEIRO no quadro (ou cortado na cintura num close), com o rosto visível e longe das bordas laterais; se ele não deveria aparecer ali, use visible:false.\n' +
    '- BLOQUEADO / PELA METADE: tire da frente o objeto (prop, casa, cartaz, balcão) ou o outro personagem — mova-o para o lado ou para trás, ou mude o ângulo da câmera — para o rosto e o tronco ficarem livres.\n' +
    '- LETREIRO ILEGÍVEL (placa st.sign ou texto desenhado com fillText num st.poster/st.draw): aumente a placa/cartaz (w/h) ou, no desenho, a fonte (g.font) ocupando boa parte do canvas, ou aproxime a câmera enquanto ele aparece, vire-a para a câmera (yaw), encurte o texto (até 3 palavras), use fundo e texto contrastantes (no desenho: faixa clara com letra escura, ou contorno g.strokeText) e não deixe nada na frente; se ela está CORTADA pela borda, afaste a câmera, mude o look ou mova a placa para ela caber inteira no quadro; ou retire a placa se ela não importa.\n' +
    '- COR BRUSCA: não troque cor/material de um quadro para o outro; se a mudança é intencional, faça uma transição de 0,4 a 1 s (lerp da cor com C.ease). A luz (st.setLight) fica a mesma na cena inteira.\n' +
    'Mantenha o visual, os textos, os tempos, a narração e os efeitos sonoros. Dica: num close, olhe (look) para a altura do peito (y ≈ 1,2) e mantenha 1 a 2 personagens no quadro.',
  ].join('\n\n');
}

/* ── storyboard (curta cartoon 3D): planos por cena, elenco fixo e paleta fixa de materiais, antes do código ── */

/** Uma cena para o storyboard: o que o plano de cenas definiu + os tempos reais das palavras (quando houver). */
export interface BoardScene { id: string; title: string; durationSec: number; narration: string; visualIntent: string; words?: string }

/** Roupas prontas da biblioteca (iguais ao OUTFITS de vendor/cartoon3d/src/stage.ts). */
const OUTFIT_NAMES = 'C.OUTFITS.police, .gangster, .barman, .flapper, .worker, .preacher, .reporter, .kid, .parent, .officer, .rifleman, C.OUTFITS.townsfolk(n), C.OUTFITS.soldier(n)';

/** Pedido do storyboard: o harness grava assets/assets.md com elenco, paleta e os planos de cada cena. */
export function storyboardPrompt(file: string, scenes: BoardScene[], aspect: Aspect | undefined): string {
  const { w, h } = cartoon3dSize(aspect);
  return `\nSTORYBOARD do curta cartoon 3D (${w}x${h}). Leia as cenas abaixo e grave ${file} (Markdown) com EXATAMENTE estas seções:\n` +
    `## Personagens fixos\nUMA linha por personagem do vídeo inteiro: "- **Nome**: roupa, build, seed N, expressão típica" — nomes curtos e originais (nunca pessoas reais vivas); os MESMOS em todas as cenas. ` +
    `Roupa = SÓ uma destas prontas: ${OUTFIT_NAMES}; OU um objeto de cores { jacket:"#hex", pants:"#hex", boots:"#hex", hat:"tophat"|"cap"|"hair"|"bonnet"|"shako"|"shako_tall", cap:"#hex", hair:"#hex", dress:"#hex", moustache:"#hex", skin:"#hex", build:"adult"|"stout"|"kid" } (não invente outros nomes). ` +
    `Cada personagem tem que ser INCONFUNDÍVEL lado a lado: roupas e chapéus diferentes (ex.: um de cap, outro de cabelo, outro de cartola), cores de paletó diferentes.\n` +
    `## Paleta de materiais\nUMA linha por material que se repete (paredes, telhado, chão, balcão, barris, carro, placas): "- material: #hex". Essas cores NÃO mudam durante o vídeo (nada de trocar cor de material de um quadro para o outro).\n` +
    `## Storyboard\nPara cada cena, um bloco "### <id> — <título>" com 2 a 5 PLANOS, um por linha, cobrindo a cena INTEIRA de 0 até a duração, sem buracos, cada plano com pelo menos 1,2 s:\n` +
    `- 0,0–3,2 s | PLANO (geral, médio, close, detalhe, contra-plongée) | câmera: pos [x,y,z] → look [x,y,z], fov N (e o movimento até o próximo plano: deslize, push-in, roll, tranco) | luz: day|golden|night|interior | em quadro: Nome (onde na tela: esquerda/centro/direita, inteiro ou até a cintura, de frente/perfil, expressão) | letreiro: "TEXTO" ou — | adereço/efeito: o que aparece no instante da palavra | fala: as palavras ditas nesse trecho\n` +
    `REGRAS DO STORYBOARD (o agente de revisão vai medir cada quadro depois):\n` +
    `- Ninguém BLOQUEADO nem PELA METADE: nada entre a câmera e o rosto/tronco de quem está em quadro; no máximo 3 personagens por plano, separados ao menos 0,9 m no eixo lateral da câmera; quem fala fica na frente.\n` +
    `- Personagens INTEIROS no quadro (ou cortados na cintura num close), longe das bordas laterais; câmera a 2 m ou mais de qualquer objeto.\n` +
    `- LETREIROS LEGÍVEIS: até 3 palavras, de frente para a câmera (menos de 60° de lado), grandes na tela (a letra com pelo menos 3% da altura do quadro) e por pelo menos 1 s; letreiro que não dá para ler fica fora.\n` +
    `- Uma luz por cena (a mesma do primeiro ao último plano) e cores de material constantes; mudanças de cor só com transição de 0,4–1 s.\n` +
    `- Os tempos seguem as palavras: o plano muda numa pausa da fala; o adereço aparece no instante da palavra.\n\n` +
    `CENAS:\n` + scenes.map((s) => `### ${s.id} — ${s.title} (${s.durationSec} s)\nNarração: ${s.narration || '(sem fala)'}\nIntenção visual: ${s.visualIntent}` +
      (s.words ? `\nTempos das palavras:\n${s.words}` : '')).join('\n\n') +
    `\n\nGrave só ${file} e termine (não escreva código das cenas).`;
}

const section = (md: string, title: RegExp): string => {
  const at = md.search(title); if (at < 0) return '';
  const rest = md.slice(at).split('\n').slice(1), end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
};

/** Bloco do storyboard de UMA cena (por id ou número) + elenco e paleta fixos, para o pedido da cena. Função pura. */
export function storyboardFor(md: string, sceneId: string, index?: number): string {
  if (!md) return '';
  const board = section(md, /^##\s*Storyboard/im); if (!board) return '';
  const lines = board.split('\n');
  const id = sceneId.replace(/[^\w-]/g, ''), byId = new RegExp(`^###\\s*${id}\\b`, 'i');
  const byNum = index !== undefined ? new RegExp(`^###\\s*(?:s|cena\\s*)?0*${index}\\b`, 'i') : null;
  let head = lines.findIndex((l) => byId.test(l));
  if (head < 0 && byNum) head = lines.findIndex((l) => byNum.test(l));
  if (head < 0) return '';
  const tail = lines.slice(head + 1), stop = tail.findIndex((l) => /^###\s/.test(l));
  const shots = (stop < 0 ? tail : tail.slice(0, stop)).join('\n').trim();
  const cast = section(md, /^##\s*Personagens fixos/im), pal = section(md, /^##\s*Paleta de materiais/im);
  return `\nSTORYBOARD DESTA CENA (assets/assets.md — siga os planos, os tempos, quem está em quadro e onde; use os nomes no name dos atores):\n${shots}\n` +
    (cast ? `ELENCO FIXO (mesmas roupas e seeds em todas as cenas):\n${cast}\n` : '') +
    (pal ? `PALETA FIXA DE MATERIAIS (use exatamente estes hex; não mude durante a cena):\n${pal}\n` : '');
}

/** Planos (início, fim, texto) de um bloco do storyboard — "- 0,0–3,2 s | ...". Função pura. */
export function storyboardShots(block: string): Array<{ a: number; b: number; text: string }> {
  const out: Array<{ a: number; b: number; text: string }> = [];
  for (const l of block.split('\n')) {
    const m = /^\s*[-*]\s*(\d+(?:[.,]\d+)?)\s*[–—-]\s*(\d+(?:[.,]\d+)?)\s*s\b\s*\|?\s*(.*)$/.exec(l);
    if (m) out.push({ a: Number(m[1]!.replace(',', '.')), b: Number(m[2]!.replace(',', '.')), text: m[3]!.trim() });
  }
  return out;
}
