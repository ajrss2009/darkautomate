import type { Aspect, GeneratorProfile } from '../shared/types';

/*
 * FILTRO POR GERADOR (catálogo, partes XXXI–XLIV — "um gerador, um guia, um prompt").
 * O compilador NUNCA carrega os quatro guias de família ao mesmo tempo: escolhe o da família do perfil
 * e aplica só as regras daquele destino. Tiers (Fast/Pro/Developer/Enhanced/4K) NÃO são identidade de modelo.
 */

export type { GeneratorProfile } from '../shared/types';
export type FamilyGuide = '01' | '02' | '03' | '04';
export type TaskMode = 't2v' | 'i2v' | 'r2v' | 'first_last' | 'edit';
export type AudioMode = 'native' | 'guided' | 'post';
export type Evidence = 'provider' | 'host' | 'marketplace' | 'unknown';

export const FAMILY_NAMES: Record<FamilyGuide, string> = {
  '01': 'Seedance (ByteDance/BytePlus)',
  '02': 'MiniMax H3 / Wan / HappyHorse',
  '03': 'Google Gemini Omni / Veo',
  '04': 'Kling / Grok / Vidu / BACH',
};

/** Envelope documentado por família — usado no pré-vôo (não é promessa de qualidade). */
export const FAMILY_ENVELOPE: Record<FamilyGuide, { min: number; max: number; res: Array<'720p' | '1080p' | '4K'>; audio: AudioMode[] }> = {
  '01': { min: 4, max: 30, res: ['720p', '1080p', '4K'], audio: ['native', 'guided', 'post'] },
  '02': { min: 3, max: 30, res: ['720p', '1080p', '4K'], audio: ['native', 'guided', 'post'] },
  '03': { min: 3, max: 15, res: ['720p', '1080p'], audio: ['native', 'guided', 'post'] },
  '04': { min: 1, max: 16, res: ['720p', '1080p', '4K'], audio: ['guided', 'post'] },
};

/** Rótulos que NÃO são identidade de modelo — exigem ID exato antes de gerar. */
const TIER_LABELS = /\b(fast|pro|mini|turbo|prime|developer|enhanced|std|lite|standard|max|flash|4k|1080p|720p)\b/i;

/** Regras da família escolhida (o guia que entra no prompt). */
export function familyGuideText(family: FamilyGuide): string {
  const guides: Record<FamilyGuide, string> = {
    '01': 'SEEDANCE: 2.5 para 16-30 s ou >9 referências; 2.0 para 1080p/4K em 4-15 s. Flash/Mini = rascunho. Manifesto ordenado: Image1=identidade, Image2=figurino, Image3=locação, Video1=movimento, Audio1=ritmo. Bloco: identidade → vínculo das refs → continuidade → mundo visual → cronologia → câmera → relação com a música → travas → exclusões. Enhanced sem ID confirmado: pedir screenshot/ID.',
    '02': 'MINIMAX / WAN / HAPPYHORSE: H3 4-15 s, até 2K, áudio estéreo nativo; teste 5-8 s de identidade, depois dança, depois lipsync, só então expanda. Áudio nativo NÃO é a música do projeto: monte a faixa master na pós. Wan 3.0/Prime 2-30 s, 30 fps, first/last; Wan 2.7 escolhe endpoint T2V/I2V/R2V(2-10 s)/edição; HappyHorse 1.1 3-15 s, 24 fps, R2V pede identidade distinta de estilo/cena. Max/Fast/Developer são rótulos de host.',
    '03': 'GOOGLE OMNI / VEO: Omni 1.1 3-10 s edição conversacional; 1.2 3-15 s melhor aderência a rosto/figurino (corrija 1 variável por vez). Veo Lite 4/6/8 s rascunho, Fast iteração, padrão master. "Developer" é rota de API, não checkpoint. Áudio gerado, lipsync e reprodução exata da música são capacidades distintas: nunca prometa a faixa original.',
    '04': 'KLING / GROK / VIDU / BACH: Kling 3.0 até 6 planos por geração, 3-15 s, escreva "Shot 1 — duração:"; Std 720p, Pro 1080p, 4K (resolução não muda coreografia). O3 4K é linha separada (@Element1/@Image1/@Video1). Grok v1.5 1-15 s 1080p até 14 imagens/3 vozes: componha bem o primeiro quadro. Vidu Q3 Turbo teste, Pro final, 1-16 s. BACH controle de câmera: verificar API antes de confiar.',
  };
  return `[GUIA DA FAMÍLIA ${family} — ${FAMILY_NAMES[family]}]\n${guides[family]}\nUse SOMENTE este guia (os outros três NÃO entram neste pedido).`;
}

/** Regras de compilação de clipe musical que valem para qualquer família (guia mestre). */
export const MASTER_MUSIC_RULES = [
  'Referência com papel definido vence lista longa de adjetivos.',
  'Tier é configuração; modelo é identidade — não misture.',
  'Música gerada não é a faixa do projeto: a faixa master é montada na pós, salvo se o endpoint provar condicionamento.',
  'Clip longo = arco temporal compacto: composição de abertura → progressão → uma transição → estado final.',
  'Lipsync: teste uma frase curta antes de confiar; áudio de referência não prova sincronia por palavra.',
  'Dança em grupo: contagem, posições na tela, troca de formação e quem lidera cada frase.',
  'Figurino instável: repita o figurino completo em todo prompt independente.',
].join('\n');

export interface ProfileCheck { ok: boolean; errors: string[]; warnings: string[] }
export function validateGeneratorProfile(p: GeneratorProfile): ProfileCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const id = String(p.model_id ?? '').trim();
  if (!id) errors.push('model_id vazio: o ID do modelo é obrigatório (ex.: dreamina-seedance-2-5-260628)');
  else if (TIER_LABELS.test(id) && !/\d{4,}/.test(id)) errors.push(`model_id "${id}" parece rótulo de tier/host, não ID exato — forneça o ID do modelo`);
  const env = FAMILY_ENVELOPE[p.family_guide];
  if (!env) errors.push(`family_guide ${p.family_guide} inválida (use 01, 02, 03 ou 04)`);
  else {
    const d = Number(p.duration_sec);
    if (!Number.isFinite(d) || d < env.min || d > env.max) errors.push(`duração ${d}s fora do envelope da família ${p.family_guide} (${env.min}-${env.max} s)`);
    if (!env.res.includes(p.resolution)) errors.push(`resolução ${p.resolution} não documentada para a família ${p.family_guide}`);
    if (!env.audio.includes(p.audio)) errors.push(`áudio "${p.audio}" não documentado para a família ${p.family_guide}`);
  }
  if (!['t2v', 'i2v', 'r2v', 'first_last', 'edit'].includes(p.task_mode)) errors.push(`task_mode "${p.task_mode}" inválido`);
  if (!Array.isArray(p.refs)) errors.push('refs ausente: declare cada referência com type/role/slot');
  else {
    const slots = new Set<number>();
    for (const r of p.refs) {
      if (!r?.role?.trim()) errors.push('referência sem papel declarado (identity/wardrobe/location/motion/rhythm)');
      if (!Number.isInteger(r?.slot) || r.slot < 1) errors.push(`slot inválido na referência "${r?.role ?? ''}"`);
      else if (slots.has(r.slot)) errors.push(`slot ${r.slot} repetido — cada referência tem um slot único`);
      else slots.add(r.slot);
    }
  }
  if (p.audio === 'native') warnings.push('áudio nativo do modelo ≠ música do projeto: mantenha a faixa master na pós (ou prove condicionamento)');
  if (!p.negative_field) warnings.push('sem campo de negativo: transforme exclusões em frases curtas no prompt');
  if (p.prompt_rewrite) warnings.push('a plataforma reescreve prompts: reforce a trava de identidade e o figurino em cada prompt');
  if (p.evidence === 'unknown' || p.evidence === 'marketplace') warnings.push(`evidência "${p.evidence}": confirme limits/specs no provedor antes de gastar crédito`);
  return { ok: errors.length === 0, errors, warnings };
}

/** Texto injetado no prompt do gerador: guia mestre + SÓ a família escolhida + perfil validado. */
export function compileGeneratorPrompt(p: GeneratorProfile): string {
  const refLines = (p.refs ?? []).map((r) => `ref slot ${r.slot}: ${r.type} — papel ${r.role}`).join('; ');
  return [
    '[PERFIL DO GERADOR — destino exato]',
    `provider=${p.provider} · model_id=${p.model_id} · family=${p.family_guide} · task=${p.task_mode}`,
    `duração=${p.duration_sec}s · resolução=${p.resolution} · aspecto=${p.aspect} · áudio=${p.audio}`,
    `referências: ${refLines || 'nenhuma (t2v)'}`,
    `campo negativo: ${p.negative_field ? 'sim' : 'não — use frases curtas de exclusão'} · reescrita pela plataforma: ${p.prompt_rewrite ? 'sim (reforçar identidade)' : 'não'} · evidência: ${p.evidence}`,
    MASTER_MUSIC_RULES,
    familyGuideText(p.family_guide),
    'Nunca carregue os outros guias de família. Nunca aplique spec de um host a outro.',
  ].join('\n');
}

/** Rótulos proibidos como "modelo" — usado no formulário e no pré-vôo. */
export const tierLabelWarning = (modelId: string) =>
  TIER_LABELS.test(String(modelId ?? '')) && !/\d{4,}/.test(String(modelId ?? ''))
    ? 'Isso é um rótulo de tier/host (Fast, Pro, Mini, Developer…), não um ID de modelo. Informe o ID exato.' : '';
