import type { TitleStructure } from './youtube-rules';

/*
 * O SCORER DE TÍTULOS — as seis checagens do catálogo, sem IA.
 *
 * Gerar é barato; o que falta é reprovar antes de o usuário olhar. Cada checagem
 * vale um peso (total 100) e reprova por um motivo declarado — não por gosto:
 *
 *   até 60 caracteres .................. 20
 *   palavra-chave nos 40 primeiros ..... 20
 *   número, contradição ou pergunta .... 20
 *   não repete a thumbnail ............. 15
 *   distância ao padrão do nicho ....... 15
 *   promessa × roteiro ................. 10
 *
 * Acima de 80 vai para a tela; abaixo de 50 nem aparece; no meio, revisão.
 * Tudo aqui é determinístico: a mesma entrada dá a mesma nota.
 */

export type TitleVerdict = 'aprovado' | 'revisar' | 'reprovado';
export type TitleCheckId = 'length' | 'keyword' | 'hook' | 'thumb' | 'niche' | 'promise';

export interface TitleCheck {
  id: TitleCheckId;
  label: string;
  /** peso máximo da checagem */
  weight: number;
  /** pontos obtidos (0..weight) */
  score: number;
  ok: boolean;
  /** false quando não há dado para medir (a nota é normalizada sem essa checagem) */
  applicable?: boolean;
  detail: string;
}

export interface TitleScoreInput {
  title: string;
  /** palavra-chave principal; sem ela a checagem não penaliza (não há o que medir) */
  keyword?: string;
  type?: 'busca' | 'navegação' | 'híbrido';
  /** texto que vai na thumbnail (para não repetir o título) */
  thumbText?: string;
  /** o que o vídeo entrega (roteiro/ideia) — a promessa do título tem que caber nele */
  promise?: string;
  niche?: Pick<TitleStructure, 'avgLen' | 'commonStarts' | 'commonWords' | 'examples'>;
}

export interface TitleScore {
  title: string;
  total: number;
  verdict: TitleVerdict;
  checks: TitleCheck[];
}

/** Palavras funcionais: não contam como conteúdo em nenhuma comparação. */
const STOP = new Set((
  'a o os as de da do das dos e em no na nos nas um uma uns umas para por com que se é the of to and in on for with is are you your how what why this that my i ' +
  'la el los las y en con un una mais mas muito sua seu suas seus como sobre entre ate até'
).split(' '));

/** minúsculas, sem acento — para comparar sem depender da grafia. */
export const normalizeText = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Palavras de conteúdo (sem palavras funcionais, sem números soltos curtos). */
export function contentWords(s: string): string[] {
  return normalizeText(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Palavras em comum entre dois textos (sem repetição). */
export function sharedWords(a: string, b: string): string[] {
  const set = new Set(contentWords(b));
  return [...new Set(contentWords(a))].filter((w) => set.has(w));
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function titleVerdict(total: number): TitleVerdict {
  return total >= 80 ? 'aprovado' : total >= 50 ? 'revisar' : 'reprovado';
}

/** 1) Até 60 caracteres ganha tudo; 61–70 perde parte; acima de 100 zera. */
function lengthCheck(title: string): TitleCheck {
  const len = [...title].length;
  const score = len <= 60 ? 20 : len <= 70 ? 14 : len <= 100 ? 7 : 0;
  return {
    id: 'length', label: 'até 60 caracteres', weight: 20, score, ok: score === 20,
    detail: `${len} caracteres${len <= 60 ? ' (o celular mostra tudo)' : ' — o gancho já foi cortado no feed'}`,
  };
}

/** 2) Palavra-chave nos 40 primeiros (tráfego de busca). Sem palavra-chave, não penaliza. */
function keywordCheck(title: string, keyword: string | undefined, type: TitleScoreInput['type']): TitleCheck {
  const weight = 20;
  const k = keyword?.trim();
  if (!k) return { id: 'keyword', label: 'palavra-chave nos 40 primeiros', weight, score: 0, ok: true, applicable: false, detail: 'sem palavra-chave definida (não há o que medir)' };
  const at = normalizeText(title).indexOf(normalizeText(k));
  const nav = type === 'navegação';
  if (at >= 0 && at < 40) return { id: 'keyword', label: 'palavra-chave nos 40 primeiros', weight, score: weight, ok: true, detail: `"${k}" no caractere ${at + 1}` };
  if (at >= 40) return { id: 'keyword', label: 'palavra-chave nos 40 primeiros', weight, score: nav ? 15 : 7, ok: false, detail: `"${k}" só aparece no caractere ${at + 1} (o corte do celular fica nos ~45)` };
  return { id: 'keyword', label: 'palavra-chave nos 40 primeiros', weight, score: nav ? 12 : 0, ok: false, detail: `"${k}" não aparece no título${nav ? ' (navegação tolera, busca não)' : ''}` };
}

/** 3) Número, contradição ou pergunta: o título tem que ter um gancho concreto. */
function hookCheck(title: string): TitleCheck {
  const n = normalizeText(title);
  const kinds = [
    /\d/.test(title) ? 'número' : '',
    /[?¿]/.test(title) ? 'pergunta' : '',
    /\b(mas|porem|contudo|entretanto|embora|mesmo|sem|contra|versus|vs|ninguem|nunca|so que|but|yet|although|without|nobody|never|instead|despite|apesar)\b/.test(n) ? 'contradição' : '',
  ].filter(Boolean);
  return {
    id: 'hook', label: 'número, contradição ou pergunta', weight: 20, score: kinds.length ? 20 : 0, ok: !!kinds.length,
    detail: kinds.length ? `gancho: ${kinds.join(' + ')}` : 'promessa vaga: sem número, contradição ou pergunta',
  };
}

/** 4) Título e thumbnail dizem coisas diferentes — não gastar os dois no mesmo texto. */
function thumbCheck(title: string, thumbText: string | undefined): TitleCheck {
  const weight = 15;
  if (!thumbText?.trim()) return { id: 'thumb', label: 'não repete a thumbnail', weight, score: 0, ok: true, applicable: false, detail: 'sem texto de thumbnail (nada a repetir)' };
  const overlap = sharedWords(title, thumbText);
  const score = overlap.length === 0 ? 15 : overlap.length === 1 ? 8 : 0;
  return {
    id: 'thumb', label: 'não repete a thumbnail', weight, score, ok: overlap.length <= 1,
    detail: overlap.length ? `repete ${overlap.length} palavra(s): ${overlap.join(', ')}` : 'título e thumbnail se complementam',
  };
}

/** 5) Perto o bastante para reconhecer o canal, longe o bastante para não ser a mesma frase. */
function nicheCheck(title: string, niche: TitleScoreInput['niche']): TitleCheck {
  const weight = 15;
  if (!niche || !niche.avgLen) return { id: 'niche', label: 'distância ao padrão do nicho', weight, score: 0, ok: true, applicable: false, detail: 'sem referência de nicho (não há o que comparar)' };
  const len = [...title].length;
  const near = Math.round(6 * clamp(1 - Math.abs(len - niche.avgLen) / Math.max(14, niche.avgLen * 0.45), 0, 1));
  const start = niche.commonStarts.some((s) => s && normalizeText(title).startsWith(normalizeText(s))) ? 4 : 2;
  const mine = new Set(contentWords(title));
  const shared = niche.commonWords.filter((w) => mine.has(normalizeText(w)));
  const same = niche.examples.some((e) => normalizeText(e) === normalizeText(title));
  const novelty = same ? 0 : shared.length >= 3 ? 1 : shared.length === 2 ? 3 : 5;
  const score = Math.min(weight, near + start + novelty);
  return {
    id: 'niche', label: 'distância ao padrão do nicho', weight, score, ok: score >= 10,
    detail: same ? 'é a mesma frase de um título do canal' : `${near + start}/10 de reconhecimento + ${novelty}/5 de novidade${shared.length ? ` (palavras do canal: ${shared.join(', ')})` : ''}`,
  };
}

/** 6) A promessa do título tem que estar no roteiro/ideia — clickbait que o vídeo não entrega reprova. */
function promiseCheck(title: string, promise: string | undefined): TitleCheck {
  const weight = 10;
  if (!promise?.trim()) return { id: 'promise', label: 'promessa × roteiro', weight, score: 0, ok: true, applicable: false, detail: 'sem roteiro/ideia para conferir' };
  const mine = contentWords(title);
  const common = sharedWords(title, promise);
  const ratio = mine.length ? common.length / mine.length : 0;
  /* título descritivo não promete nada: "um vídeo sobre X", "a história de X", "tudo sobre X" */
  const vague = /^(um\s+)?(v[ií]deo|document[áa]rio|filme|conte[úu]do|epis[óo]dio)?\s*(sobre|a\s+hist[óo]ria\s+d[eo]|tudo\s+sobre|falando\s+(de|sobre)|conversa\s+sobre)\b/.test(normalizeText(title));
  const hype = /\b(segredo|chocante|inacreditavel|ninguem esperava|voce nao vai acreditar|bombastico|insano|proibido)\b/.test(normalizeText(title));
  let score = ratio >= 0.5 ? 10 : ratio >= 0.3 ? 7 : ratio >= 0.15 ? 4 : 0;
  if (hype && ratio < 0.5) score = 0;
  if (vague) score = 0;
  return {
    id: 'promise', label: 'promessa × roteiro', weight, score, ok: score >= 7,
    detail: vague ? 'promessa vaga ("sobre X"), sem benefício, número ou contraponto' : `${Math.round(ratio * 100)}% das palavras do título estão no roteiro${hype && ratio < 0.5 ? ' — gancho de clickbait sem lastro' : ''}`,
  };
}

/** Nota de um título: seis checagens, 100 pontos, veredito. */
export function scoreTitle(input: TitleScoreInput): TitleScore {
  const title = input.title.trim();
  const checks: TitleCheck[] = [
    lengthCheck(title),
    keywordCheck(title, input.keyword, input.type),
    hookCheck(title),
    thumbCheck(title, input.thumbText),
    nicheCheck(title, input.niche),
    promiseCheck(title, input.promise),
  ];
  /* a nota é normalizada pelas checagens que dá para medir: sem thumb/nicho, não inflar */
  const applicable = checks.filter((c) => c.applicable !== false).reduce((a, c) => a + c.weight, 0);
  const earned = checks.filter((c) => c.applicable !== false).reduce((a, c) => a + c.score, 0);
  const total = applicable ? Math.round((earned / applicable) * 100) : 0;
  return { title, total, verdict: titleVerdict(total), checks };
}

/** Reprovações curtas para o log/UI ("sem gancho, repete a thumb"). */
export function failedChecks(s: TitleScore): string[] {
  return s.checks.filter((c) => !c.ok).map((c) => c.label);
}
