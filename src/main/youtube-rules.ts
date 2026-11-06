/* Regras de título, thumbnail e retenção adaptadas de "claude-youtube" (Daniel Agrici, licença MIT —
   https://github.com/AgriciDaniel/claude-youtube). Sem dependências: usadas pelos prompts e pela modelagem. */

/** Regras de título (CTR) — usadas nas sugestões e na etapa de metadados. */
export const TITLE_RULES = [
  'O gancho do título fica nos primeiros ~45 caracteres (o celular corta o resto); ideal até 60 caracteres, nunca mais de 100.',
  'Palavra-chave principal nos primeiros 40 caracteres quando o tráfego for de busca; para navegação/sugeridos, curiosidade e emoção vêm antes.',
  'Fórmulas que funcionam: valor denso + tempo comprimido ("30 anos de X em 30 minutos"); sistema/método ("O método para…"); palavra-chave: benefício/curiosidade; contradição + promessa ("Por que trabalhar menos me fez…"); "Como eu + resultado específico + prazo"; contexto entre colchetes ("[Guia 2026]").',
  'O título promete; a thumbnail mostra o que o título NÃO diz — nunca repita no título as palavras do texto da thumbnail.',
  'Sem clickbait que o vídeo não entrega: a plataforma compara título/thumbnail com o conteúdo real.',
].join('\n');

/** Regras de thumbnail (brief) — usadas na modelagem e na etapa de thumbnail. */
export const THUMB_RULES = [
  'Divisão de informação: a thumbnail acrescenta o que o título não diz (emoção, resultado, contraste), sem duplicar.',
  'Um ponto focal só (rosto com emoção forte e autêntica, objeto ou resultado) ocupando ~40–60% do quadro, na regra dos terços.',
  'Texto na imagem: no máximo 3 palavras (ideal 1–2), fonte bold sem serifa, contorno/sombra, sem cobrir o ponto focal.',
  'Paleta de 3 cores com alto contraste (cor dominante, destaque, cor de "pop"), definidas em hex.',
  'Teste do celular: a 168×94 px o ponto focal e o texto continuam legíveis; detalhes pequenos viram ruído e saem.',
  'Variantes A/B mudam UMA variável por vez (cor, texto, expressão ou composição).',
].join('\n');

/** Regras de retenção do roteiro (vídeos ≥ 2 min). */
export const RETENTION_RULES = 'Estrutura de retenção: 0–5 s agarre (imagem ou frase que contradiz/surpreende), até 15 s prometa o que o espectador vai ganhar, até 30 s mostre o que está em jogo; ' +
  'entregue logo o primeiro valor (sem introdução longa); a cada 30–60 s uma quebra de padrão (pergunta, virada, dado, mudança de ritmo); CTA curto perto de 25% do vídeo; re-gancho perto de 60% ("e o mais importante ainda vem…"); final com recompensa e gancho para o próximo vídeo.';

/** Um título de referência e as views dele (os mais vistos pesam mais). */
export interface RefTitle { title: string; views?: number }

/* ───────── estrutura dos títulos (determinística) ───────── */

export interface TitleStructure {
  count: number; avgLen: number; within60: number; numbers: number; questions: number; brackets: number; separators: number;
  emoji: number; allCapsWord: number; firstPerson: number; howWhy: number; commonStarts: string[]; commonWords: string[]; examples: string[]; summary: string;
}
const STOP = new Set('a o os as de da do das dos e em no na nos nas um uma uns umas para por com que se é the of to and in on for with is are you your how what why this that my i la el los las y en por con un una'.split(' '));

export function titleStructure(list: RefTitle[]): TitleStructure {
  const titles = list.map((t) => t.title.trim()).filter(Boolean);
  const n = Math.max(1, titles.length);
  const pct = (f: (t: string) => boolean) => Math.round((titles.filter(f).length / n) * 100);
  const words = titles.flatMap((t) => t.toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)));
  const freq = (arr: string[]) => [...arr.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map<string, number>())].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const starts = freq(titles.map((t) => t.split(/\s+/).slice(0, 2).join(' ').toLowerCase()));
  /* os títulos com mais views primeiro: são o padrão que funcionou */
  const examples = [...list].filter((t) => t.title).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 8).map((t) => t.title);
  const st: TitleStructure = {
    count: titles.length, avgLen: Math.round(titles.reduce((a, t) => a + t.length, 0) / n), within60: pct((t) => t.length <= 60),
    numbers: pct((t) => /\d/.test(t)), questions: pct((t) => /[?¿]/.test(t)), brackets: pct((t) => /[[\](){}]/.test(t)), separators: pct((t) => /\s[|:–—-]\s|:\s/.test(t)),
    emoji: pct((t) => /\p{Extended_Pictographic}/u.test(t)), allCapsWord: pct((t) => /\b\p{Lu}{3,}\b/u.test(t)),
    firstPerson: pct((t) => /\b(eu|meu|minha|i|my|me|yo|mi)\b/i.test(t)), howWhy: pct((t) => /^(como|por que|porque|o que|how|why|what|cómo|por qué)/i.test(t)),
    commonStarts: starts.slice(0, 6), commonWords: freq(words).slice(0, 12), examples, summary: '',
  };
  st.summary = `${st.count} títulos · ${st.avgLen} caracteres em média (${st.within60}% até 60) · ${st.numbers}% com número · ${st.questions}% com pergunta · ${st.brackets}% com colchetes/parênteses · ` +
    `${st.separators}% com separador (: | –) · ${st.allCapsWord}% com PALAVRA EM CAIXA ALTA · ${st.emoji}% com emoji · ${st.firstPerson}% em 1ª pessoa · ${st.howWhy}% começam com como/por que/o que` +
    (st.commonStarts.length ? ` · inícios frequentes: ${st.commonStarts.map((x) => `"${x}"`).join(', ')}` : '') +
    (st.commonWords.length ? ` · palavras recorrentes: ${st.commonWords.join(', ')}` : '');
  return st;
}

