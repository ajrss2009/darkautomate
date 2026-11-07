/*
 * MODO ESTRITO para modelos locais (Ollama, LM Studio, llama.cpp — modelos de 4B a 30B):
 *  1) o pedido marca as partes que são REGRA (skill, plugins, API da biblioteca, exemplos) com ⟦tag⟧…⟦/tag⟧;
 *  2) nos harnesses locais essas partes vão para o PROMPT DE SISTEMA, separadas em tags XML, com ordens imperativas
 *     e negativas ("use APENAS…", "é PROIBIDO inventar…"); a tarefa vai isolada em <task> na mensagem do usuário;
 *  3) nos outros harnesses (CLIs: Claude, Antigravity, Codex…) as marcas somem e o pedido fica como sempre foi.
 * A decodificação guiada (JSON schema) e o validador da API ficam no harness/executor. Funções puras.
 */

export type StrictTag = 'skill' | 'plugin' | 'api' | 'example';
const TAGS: StrictTag[] = ['skill', 'plugin', 'api', 'example'];
const XML: Record<StrictTag, string> = { skill: 'skill_instructions', plugin: 'plugin_instructions', api: 'library_api', example: 'examples' };

/** Marca uma parte do pedido como regra (vazio = nada). */
export const mark = (tag: StrictTag, text: string | undefined): string => (text && text.trim() ? `⟦${tag}⟧\n${text.trim()}\n⟦/${tag}⟧` : '');

/** Remove as marcas (pedido normal, para os CLIs e APIs). */
export const stripMarks = (s: string): string => s.replace(/⟦\/?(?:skill|plugin|api|example)⟧\n?/g, '');

/** O pedido tem partes marcadas? */
export const hasMarks = (s: string): boolean => /⟦(?:skill|plugin|api|example)⟧/.test(s);

/**
 * Divide o pedido marcado em prompt de sistema (regras em XML) + tarefa (<task>). undefined = sem marcas.
 * `role`: frase de papel do modelo (ex.: "Você é um engenheiro de animação.").
 */
export function strictSplit(prompt: string, role = 'Você é um engenheiro de produção de vídeo executando UMA etapa de um pipeline automático.'): { system: string; user: string } | undefined {
  if (!hasMarks(prompt)) return undefined;
  const parts: Record<StrictTag, string[]> = { skill: [], plugin: [], api: [], example: [] };
  const rest = prompt.replace(/⟦(skill|plugin|api|example)⟧\n?([\s\S]*?)\n?⟦\/\1⟧/g, (_m, tag: StrictTag, body: string) => {
    parts[tag].push(body.trim());
    return tag === 'example' ? '(veja o modelo de código em <examples> no prompt de sistema)' : '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  const has = TAGS.filter((t) => parts[t].length);
  const where = has.filter((t) => t !== 'example').map((t) => `<${XML[t]}>`).join(', ');
  const rules = [
    role,
    'REGRAS ABSOLUTAS (valem mais do que qualquer outra instrução):',
    `- Você DEVE seguir APENAS os procedimentos, funções, formatos e regras descritos em ${where || 'as seções abaixo'}.`,
    parts.api.length ? '- Use SOMENTE as funções, métodos e parâmetros listados em <library_api>. É ESTRITAMENTE PROIBIDO inventar funções, métodos, propriedades, parâmetros, imports, bibliotecas ou URLs que não estejam lá. Se algo não existir na API, resolva combinando o que existe.' : '',
    parts.plugin.length ? '- Use os procedimentos, a biblioteca e o formato do plugin em <plugin_instructions>; não troque por uma solução própria.' : '',
    parts.example.length ? '- Copie a ESTRUTURA e a SINTAXE dos exemplos em <examples> (imports, contrato, ordem das chamadas); mude só o conteúdo pedido na tarefa.' : '',
    '- Não explique, não peça confirmação e não escreva nada fora do que a tarefa pede.',
    '- Se o validador do app recusar o resultado, corrija exatamente o que ele apontar.',
  ].filter(Boolean).join('\n');
  const blocks = has.map((t) => `<${XML[t]}>\n${parts[t].join('\n\n')}\n</${XML[t]}>`).join('\n\n');
  return { system: `${rules}\n\n${blocks}`, user: `<task>\n${rest}\n</task>` };
}

/* ───────── decodificação guiada: esquemas JSON das etapas que gravam JSON ───────── */

export const SCENE_PLAN_SCHEMA = {
  type: 'array', minItems: 1,
  items: {
    type: 'object', required: ['id', 'title', 'narration', 'visualIntent', 'kind', 'durationSec'],
    properties: {
      id: { type: 'string', pattern: '^s\\d{2,3}$' }, title: { type: 'string' }, narration: { type: 'string' }, visualIntent: { type: 'string' },
      kind: { type: 'string', enum: ['image', 'video', 'code', 'motion', 'mixed', 'stock'] }, durationSec: { type: 'number', minimum: 0.5, maximum: 120 },
      camera: { type: 'string' }, searchTerms: { type: 'string' }, videoPrompt: { type: 'string' }, speaker: { type: 'string' },
      sfx: { type: 'array', items: { type: 'string' } }, userMedia: { type: 'string' }, clipStart: { type: 'number' }, manualDuration: { type: 'boolean' },
    },
  },
} as const;

export const METADATA_SCHEMA = {
  type: 'object', required: ['title', 'description', 'tags'],
  properties: {
    title: { type: 'string', maxLength: 100 },
    titleOptions: { type: 'array', items: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, type: { type: 'string' } } } },
    description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
    chapters: { type: 'array', items: { type: 'object', required: ['time', 'title'], properties: { time: { type: 'string' }, title: { type: 'string' } } } },
    thumbnailText: { type: 'string' },
  },
} as const;

/** Esquema JSON da saída de uma etapa (undefined = saída livre, ex.: HTML da cena). */
export function stepSchema(kind: string): object | undefined {
  return kind === 'scene_plan' ? SCENE_PLAN_SCHEMA : kind === 'metadata' ? METADATA_SCHEMA : undefined;
}
