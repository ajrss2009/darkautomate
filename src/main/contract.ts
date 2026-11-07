import * as vm from 'node:vm';

/**
 * Contrato da cena com o plugin (modo "modelo pequeno", ex.: SenseNova/QWen 9B):
 *  1. PRÉ-PARSE de sintaxe ANTES de gastar um render — node:vm compila cada bloco <script> da página
 *     (imports/exports de módulo ES neutralizados). Erro de sintaxe volta para o modelo numa rodada de
 *     texto de leitura rápida, sem o app renderizar nem um quadro — erro do 9B é comum e sempre na sintaxe.
 *  2. CONTRATO DE ESTILO aplicado: quando a biblioteca do plugin tem rigs (personagens prontos, ex.:
 *     drawStickman/drawThoughtBubble), o plugin.json pode exigir (filmforge.contract.forbidCanvas) que a
 *     página gerada NÃO desenhe à mão com primitivas cruas de Canvas (beginPath/arc/lineTo…): o traço,
 *     a cor e a proporção ficam fixados na biblioteca — a página só coreografa chamadas L.*.
 *  3. CAPS: orçamento de caracteres do bloco de plugins para modelos locais pequenos (config do plugin
 *     em filmforge.contract.maxPromptChars vence; ver plugins.ts pluginPrompt e prompts.ts smallModelBudget).
 *
 * As funções são PURAS (nenhuma dependência de electron): fáceis de testar e reusar em prefetch.
 */

export interface SceneContract {
  /** proíbe primitivas cruas de desenho na página gerada (o estilo vem da biblioteca do plugin) */
  forbidCanvas?: boolean;
  /** substrings que AUTORIZAM a linha mesmo com forbidCanvas (config do plugin) */
  allow?: string[];
}

/* ───────────────────────── blocos <script> da página ───────────────────────── */

/** Cada bloco <script> inline com a linha 1-based onde o CÓDIGO começa (mesma linha da tag, ou a seguinte). */
export function scriptBlocks(page: string): Array<{ code: string; firstLine: number }> {
  const out: Array<{ code: string; firstLine: number }> = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(page))) {
    const attrs = m[1] ?? '';
    if (/\ssrc\s*=/i.test(attrs)) continue;                          // script externo (import map etc.)
    const type = /type\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase() ?? '';
    if (type && !/^module$|^text\/javascript$|^application\/javascript$|^javascript$/.test(type)) continue; // importmap/JSON — sem código
    const code = m[2] ?? '';
    if (!code.trim()) continue;
    /* o código começa na linha da tag, salvo quando o modelo quebrou linha logo depois de <script> */
    const firstLine = page.slice(0, m.index).split('\n').length + (/^\r?\n/.test(code) ? 1 : 0);
    out.push({ code, firstLine });
    if (re.lastIndex === m.index) re.lastIndex++;                    // segurança contra laço em <>
  }
  return out;
}

/* ───────────────────────── pré-parse de sintaxe ───────────────────────── */

/**
 * Neutraliza módulo (import/export) para compilar o bloco como script clássico. Preserva o número de
 * linhas sempre que dá (as posições do erro continuam valendo na página). await no nível do módulo é
 * coberto pelo embrulho em função async no pageSyntaxProblem.
 */
export function noModuleSyntax(code: string): string {
  return code
    /* import … from "x"  /  import "x"  /  import { a as b } from "x" — inclusive multilinha (não guloso) */
    .replace(/(?:^|\n)[ \t]*import\s+[^;'"]*?(?:from\s*(?:'|")[^'"]*(?:'|")|['"][^'"]*['"])[ \t]*;?/g, (s) => s.replace(/[^\n]/g, ' '))
    /* export { a, b }  /  export { a, b } from "x"  /  export * from "x" */
    .replace(/(?:^|\n)[ \t]*export\s*\*\s*from\s*(?:')[^']*(?:')|(?:^|\n)[ \t]*export\s*\{[^}]*\}[ \t]*(?:from\s*(?:')[^']*(?:'))?[ \t]*;?/g, (s) => s.replace(/[^\n]/g, ' '))
    /* export function/const/class … → tiran mesmo espaço: a declaração continua válida como script */
    .replace(/\bexport\s+(?=(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\b)/g, (s) => ' '.repeat(s.length))
    /* export default X → var re-declarável (var duplicado é legal) — mantém a linha e compila */
    .replace(/\bexport\s+default\s+/g, (s) => 'var __forgeDefault = '.slice(0, s.length).padEnd(s.length, ' '));
}

export function pageSyntaxProblem(page: string): string | undefined {
  const blocks = scriptBlocks(page);
  if (!blocks.length) return 'a página não tem nenhum <script> com código JavaScript';
  for (const b of blocks) {
    /* modelo devolveu texto ESCAPADO para HTML (&lt; no lugar de <): o parse quebra em todos os quadros */
    const hell = /&lt;|&gt;|&amp;/i.test(b.code) ? (page.slice(0, page.indexOf(b.code)).split('\n').length) : 0;
    if (hell) return `linha ~${hell}: o código contém entidade HTML (&lt;/&gt;/&amp;) — devolva o código como texto real, nunca escapado`;
    /* embrulho em async: await no nível do módulo compila em script clássico (linha 1 só tem o abre-chave;
       a quebra de linha do start da tag não vira linha de código) */
    const wrapped = `async function __forgeCheck() {\n${noModuleSyntax(b.code.replace(/^\r?\n/, ''))}\n}`;
    try {
      new vm.Script(wrapped, { filename: 'free.html' });
    } catch (e) {
      if (!(e instanceof SyntaxError)) continue;
      /* stack do vm: "free.html:12" + a linha de código que o V8 apontou (a linha pode ser a de um
         token vizinho — o trecho é o que não falha); linha 1 do embrulho não é da página */
      const st = e.stack ?? '';
      const at = /free\.html:(\d+)(?::(\d+))?/.exec(st);
      const n = at ? Number(at[1]) : 1;
      /* embrulho na linha 1; a linha k do código (k = n-1) fica na página em firstLine + k - 1 */
      const line = n > 1 ? b.firstLine + (n - 2) : b.firstLine;
      const shown = (st.split('\n')[1] ?? '').trim().slice(0, 140);
      const where = shown ? ` apontando "${shown}"` : '';
      return `a página não compila: ${e.message} (linha ~${line} do HTML)${where} — código JavaScript INVÁLIDO; corrigir e devolver a página inteira`;
    }
  }
  return undefined;
}

/* ───────────────────────── contrato de desenho (canvas cru ≠ plugin) ───────────────────────── */

/** O "cluster de path" é o que monta personagem à mão: traço, cor e anatomia saem do controle do plugin. */
const RAW_CANVAS: Array<[RegExp, string]> = [
  [/\.beginPath\s*\(/, '.beginPath()'],
  [/\.moveTo\s*\(/, '.moveTo()'],
  [/\.lineTo\s*\(/, '.lineTo()'],
  [/\.arc\s*\(/, '.arc()'],
  [/\.arcTo\s*\(/, '.arcTo()'],
  [/\.ellipse\s*\(/, '.ellipse()'],
  [/\.roundRect\s*\(/, '.roundRect()'],
  [/\.quadraticCurveTo\s*\(/, '.quadraticCurveTo()'],
  [/\.bezierCurveTo\s*\(/, '.bezierCurveTo()'],
  [/\.closePath\s*\(/, '.closePath()'],
  [/\.fill\s*\(\s*\)/, '.fill()'],
  [/\.stroke\s*\(\s*\)/, '.stroke()'],
  [/new\s+Path2D\b/, 'new Path2D'],
];

export function canvasViolations(page: string, allow: string[] = []): Array<{ line: number; what: string; snippet: string }> {
  const out: Array<{ line: number; what: string; snippet: string }> = [];
  for (const b of scriptBlocks(page)) {
    /* sem a quebra de linha do start da tag: normaliza para as linhas do código */
    const lines = b.code.replace(/^\r?\n/, '').split(/\r?\n/);
    for (const [i, raw] of lines.entries()) {
      const line = b.firstLine + i;
      if (allow.some((a) => a.trim() && raw.includes(a.trim()))) continue;
      /* chamar a BIBLIOTECA (L.ellipse, L.fill…) é o caminho certo: só as primitivas cruas do contexto contam
         (antes "L.ellipse(ctx, …)" era acusado como .ellipse() cru e o modelo "corrigia" código certo) */
      const code = raw.replace(/\bL\.[A-Za-z_$][\w$]*/g, 'LIB');
      const hit = RAW_CANVAS.find(([re]) => re.test(code));
      if (!hit) continue;
      out.push({ line, what: hit[1], snippet: raw.trim().slice(0, 120) });
      if (out.length >= 12) return out;
    }
  }
  return out;
}

/**
 * Todas as verificações numa só: sintaxe primeiro (barata e bloqueante), depois contrato de desenho.
 * undefined = liberado para render. O texto devolvido espera uma ÚNICA correção do modelo.
 */
export function contractProblem(
  page: string,
  opts: {
    forbidCanvas?: boolean;
    allow?: string[];
    pluginName?: string;
    rigs?: string[];
    requireLib?: boolean;
    /** nomes exportados pela lib do plugin: só estes existem como L.<nome> */
    known?: string[];
  } = {},
): string | undefined {
  const syntax = pageSyntaxProblem(page);
  if (syntax) return syntax;
  const rigs = (opts.rigs ?? []).filter(Boolean).slice(0, 12);
  const known = (opts.known ?? []).filter(Boolean);
  const rigHint = rigs.length ? ` Rigs prontos desta biblioteca: ${rigs.join(', ')} — chame-os como L.<rig>(ctx, x, y, opções).` : '';
  const used = [...new Set([...page.matchAll(/\bL\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!))];
  /* a página precisa IMPORTAR a lib do plugin (import L from "…/lib/_all.mjs") ou mapear no importmap —
     sem isso o modelo inventa uma API L.* que não existe e o lint antigo deixava passar */
  const libImport = /import\s+[^;\n]*?from\s*["'][^"']*lib[^"']*\.m?js["']/.test(page)
    || /["'][^"']*lib\/[^"']*\.m?js["']\s*:/.test(page);
  const usesLib = /\bL\.[A-Za-z_$]/.test(page)
    || (libImport && known.some((n) => new RegExp(`\\b${n.replace(/[$]/g, '\\$')}\\b`).test(page)));
  if (opts.requireLib && !libImport) {
    return `a página não importa a biblioteca do plugin${opts.pluginName ? ` ${opts.pluginName}` : ''}: inclua o import da lib (import L from "../plugins/…/lib/_all.mjs") e desenhe com as funções dela.${rigHint}`;
  }
  if (opts.requireLib && known.length && used.length) {
    const unknown = used.filter((u) => !known.includes(u));
    if (unknown.length) {
      const avail = known.slice(0, 16).join(', ');
      return `a página chama funções que NÃO existem na biblioteca do plugin: L.${unknown.join(', L.')} — inventar a API L.* não vale: use só os nomes exportados pela lib (${avail}).${rigHint}`;
    }
  }
  if (opts.forbidCanvas || opts.requireLib) {
    const bad = opts.forbidCanvas ? canvasViolations(page, opts.allow) : [];
    if (bad.length) {
      const at = [...new Set(bad.slice(0, 6).map((x) => `linha ${x.line}: ${x.what}`))].join(', ');
      const lines = bad.slice(0, 6).map((x) => `  linha ${x.line}: ${x.snippet}`).join('\n');
      return `a página desenha à mão com primitivas cruas de Canvas (${at}) — ${opts.pluginName ? `o plugin ${opts.pluginName}` : 'o plugin'} explora libs com personagens prontos: APAGUE essas chamadas e desenhe usando a biblioteca do plugin (L.*), que já tem o traço, a cor e a proporção certos.${rigHint} Trechos a substituir:\n${lines}`;
    }
    if (opts.requireLib && !usesLib) {
      return `a página não usa a biblioteca do plugin${opts.pluginName ? ` ${opts.pluginName}` : ''}: desenhe personagens e cenários chamando a lib (L.*) em vez de criar as formas por conta própria.${rigHint}`;
    }
  }
  return undefined;
}

/* ───────────────────────── orçamento de prompt para modelos pequenos ───────────────────────── */

/** Modelos locais pequenos recebem um bloco de plugins menor (9.000): 9B com 16k–32k de contexto não comporta 26k. */
export const SMALL_MODEL_BUDGET = 9000;

const LOCAL_HARNESSES = /^(?:ollama|llamacpp|lmstudio)$/i;

/** undefined = orçamento completo; modelo pequeno (no rapel até 15 B, ou harness de servidor local) → SMALL_MODEL_BUDGET. */
export function smallModelBudget(harness: string | undefined, model: string | undefined): number | undefined {
  if (model) {
    /* "qwen3.5-9b-coder" → 9 (a contagem é o parâmetro B; 40B+ já lida com o bloco completo) */
    const b = /(?:^|[^a-zA-Z0-9])(\d{1,3})\s*b\b/i.exec(model);
    const n = b ? parseInt(b[1]!, 10) : 0;
    if (n >= 40) return undefined;                                   // grande o suficiente (40B+): orçamento cheio
    if (n >= 1) return SMALL_MODEL_BUDGET;                           // 9B, 12B, 7B…: apertado
    /* nome sem sufixo "…b" (ex.: "mistral-large"): a decisão vem do harness */
  }
  return LOCAL_HARNESSES.test(harness ?? '') ? SMALL_MODEL_BUDGET : undefined;
}
