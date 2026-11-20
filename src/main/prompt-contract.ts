/*
 * CONTRATOS DE PROMPT POR FORMATO (catálogo, partes XXXI–XXXIII).
 * Cada formato tem campos obrigatórios; o app valida ANTES de gastar crédito. Um JSON genérico
 * para todos os formatos é o erro que o catálogo chama de "o popedi anime e saiu stickman".
 * Tempo em QUADROS (PROJECT_FPS): 12 s a 24 fps = 288 quadros — o corte cai no quadro, não no "meio".
 */

export type PromptFormat = 'microdrama' | 'dramatizado' | 'dossie' | 'trailer' | 'ugc' | 'musica' | 'inserto';

export interface PromptField { key: string; label: string; kind?: 'text' | 'number' | 'array' | 'boolean' }
export interface PromptContract { format: PromptFormat; duration: string; fields: PromptField[]; output: string; frames: boolean }

export const PROJECT_FPS = 30;
export const toFrames = (seconds: number, fps = PROJECT_FPS) => Math.max(1, Math.round(seconds * fps));
export const fromFrames = (frames: number, fps = PROJECT_FPS) => +(frames / fps).toFixed(3);

const f = (key: string, label: string, kind: PromptField['kind'] = 'text'): PromptField => ({ key, label, kind });

export const PROMPT_CONTRACTS: Record<PromptFormat, PromptContract> = {
  microdrama: { format: 'microdrama', duration: '12–90 s por cena', output: 'Sora 2 / H3 / Muse → 9:16', frames: true,
    fields: [f('hook', 'gancho'), f('cliffhanger', 'cliffhanger'), f('dialogue', 'dialogue[]', 'array'), f('narrator', 'narrador'), f('character_id', 'character_id + aparência'), f('continuity', 'continuidade')] },
  dramatizado: { format: 'dramatizado', duration: '30–120 s', output: 'code_scene (SVG/canvas) ou H3', frames: true,
    fields: [f('source', 'fonte creditada'), f('transform', 'transformação auditável'), f('narration', 'narração'), f('no_expert_ai', 'sem "expert" de IA em tema sensível', 'boolean')] },
  dossie: { format: 'dossie', duration: '60–180 s', output: 'animação por código', frames: true,
    fields: [f('source', 'fonte + link'), f('author', 'autor'), f('psych', 'lado psicológico'), f('publi', '#publi visível o tempo todo', 'boolean')] },
  trailer: { format: 'trailer', duration: '15–30 s', output: 'H3 / Muse → 16:9 e 9:16', frames: true,
    fields: [f('concept_label', 'rótulo de conceito'), f('no_studio_asset', 'nenhum asset de estúdio', 'boolean'), f('narration', 'narração autoral'), f('rights', 'direitos')] },
  ugc: { format: 'ugc', duration: '15–30 s', output: 'H3 / câmera real → 9:16', frames: true,
    fields: [f('product_first3', 'produto nos primeiros 3 s', 'boolean'), f('cta', 'CTA'), f('disclosure', 'disclosure', 'boolean'), f('no_other_brand', 'sem marca alheia', 'boolean')] },
  musica: { format: 'musica', duration: '15–30 s / loop', output: 'gerador de música → áudio+vídeo', frames: true,
    fields: [f('no_voice', 'sem voz', 'boolean'), f('no_samples', 'sem samples', 'boolean'), f('style', 'estilo original'), f('genai_meta', 'metadado GenAI', 'boolean')] },
  inserto: { format: 'inserto', duration: '1–2 s', output: 'Muse Image / H3 Image', frames: true,
    fields: [f('t_in', 't_in do trecho falado', 'number'), f('adds', 'o que a imagem acrescenta'), f('style', 'estilo fixo da bíblia')] },
};

export interface ContractCheck { ok: boolean; missing: string[]; frames: Record<string, number> }
export function validatePromptContract(format: PromptFormat, obj: Record<string, unknown>): ContractCheck {
  const c = PROMPT_CONTRACTS[format];
  if (!c) return { ok: false, missing: [`formato ${format} desconhecido`], frames: {} };
  const missing: string[] = [];
  for (const field of c.fields) {
    const v = obj?.[field.key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (field.kind === 'boolean' && v !== true && field.key !== 'no_other_brand');
    if (empty) missing.push(field.label);
  }
  const frames: Record<string, number> = {};
  for (const k of ['durationSec', 'clipStart', 't_in', 'seconds']) {
    const v = obj?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) frames[k] = toFrames(v);
  }
  return { ok: missing.length === 0, missing, frames };
}

/** Negativos limpos: uma linha por defeito, sem erro de digitação e sem adjetivos soltos. */
export const CLEAN_NEGATIVES = ['no extra fingers', 'no warped hands', 'no blurry faces'];
export const cleanNegatives = (extra: string[] = []) => [...CLEAN_NEGATIVES, ...extra.map((x) => x.trim().toLowerCase()).filter(Boolean)].join(', ');
