import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * MiniMax H3 no Wan2GP com LoRAs de ACELERAÇÃO (2, 3, 4 ou 8 passos):
 *  - lê as LoRAs da pasta loras/minimax_h3 e classifica cada uma por passos e família
 *    (fl2va = imagem → vídeo / loop com primeiro e último quadro; ref2va = elenco/referências/UGC; any = as duas);
 *  - cruza com os modelos H3 instalados (availability da ponte) e monta as combinações escolhíveis;
 *  - aplica a escolha (modelo + LoRA + passos) nos settings de qualquer template H3 do app.
 * Funções puras (testáveis), exceto a leitura da pasta.
 */

/** famílias de vídeo do Wan2GP com escolha de modelo/aceleração: H3 (FL2VA, Ref2VA), LTX 2.3, LTX 2.5 e Viggle */
export type H3Family = 'fl2va' | 'ref2va' | 'ltx23' | 'ltx25' | 'viggle_swap' | 'viggle_edit';
export const FAMILY_LABEL: Record<H3Family, string> = { fl2va: 'MiniMax H3 — imagem → vídeo e loop (FL2VA)', ref2va: 'MiniMax H3 — elenco / UGC / lipsync (Ref2VA)', ltx23: 'LTX 2.3', ltx25: 'LTX 2.5', viggle_swap: 'Viggle — troca de personagens', viggle_edit: 'Viggle — troca de objetos / cenário' };
/** pasta das LoRAs de cada família (loras/<pasta>) */
const LORA_DIRS: Record<string, H3Family[]> = { minimax_h3: ['fl2va', 'ref2va', 'viggle_swap', 'viggle_edit'], ltx2: ['ltx23', 'ltx25'] };
export interface H3Lora { file: string; steps: number; family: H3Family | 'any'; label: string; /** pasta (minimax_h3 | ltx2): a LoRA só vale para as famílias dessa pasta */ dir?: string }
export interface H3Choice { model?: string; lora?: string; steps?: number }
export interface H3Option { id: string; family: H3Family; model: string; lora?: string; steps?: number; label: string; distilled: boolean }

/** família do modelo H3 pelo model_type (TTS, controle e imagem ficam de fora) */
export function h3Family(modelType: string): H3Family | undefined {
  const m = modelType.toLowerCase();
  if (m.startsWith('viggle_remake')) return /edit/.test(m) ? 'viggle_edit' : 'viggle_swap';
  if (m.startsWith('viggle_animate')) return 'viggle_swap';
  if (m.startsWith('ltx2_25')) return /alpha|layout|msr/.test(m) ? undefined : 'ltx25';
  if (/^ltx2_(22b|19b|distilled)/.test(m)) return /edit_anything|msr/.test(m) ? undefined : 'ltx23';
  if (!m.startsWith('minimax_h3') || /tts|image|control|vdn|music/.test(m)) return undefined;
  if (m.includes('fl2va')) return 'fl2va';
  if (m.includes('ref2va')) return 'ref2va';
  return undefined;
}
/** modelo que já vem destilado/acelerado (PDD, Veda, Hyperflow, PTD, FastH3): não precisa de LoRA de aceleração */
export const h3Distilled = (modelType: string) => /_pdd|_veda|hyperflow|_ptd|fasth3|singularity|distilled|viggle_animate/i.test(modelType);

/** Classifica um arquivo de LoRA: só as de ACELERAÇÃO (com passos no nome) entram. */
export function classifyH3Lora(file: string): H3Lora | undefined {
  const n = path.basename(file);
  if (!/\.safetensors$/i.test(n)) return undefined;
  const low = n.toLowerCase();
  const m = /(\d+)\s*[-_ ]?step/i.exec(n);
  const steps = m ? Number(m[1]) : /(\d+)\s*nfe/i.exec(n) ? Number(/(\d+)\s*nfe/i.exec(n)![1]) : 0;
  if (!steps || steps > 16) return undefined;
  const family: H3Lora['family'] = /fl2v/.test(low) ? 'fl2va' : /ref2v/.test(low) ? 'ref2va' : 'any';
  const ver = /v(\d+(?:\.\d+)?)/i.exec(n)?.[1];
  const src = /lightx2v/i.test(n) ? 'Lightx2v' : /taomate/i.test(n) ? 'Taomate' : /pdmd/i.test(n) ? 'PDMD' : /pdd/i.test(n) ? 'PDD' : /acc/i.test(n) ? 'Acc' : /turbo/i.test(n) ? 'Turbo' : 'LoRA';
  const res = /(\d{3,4})p/i.exec(n)?.[1];
  return { file: n, steps, family, label: `${src} ${steps} passos${ver ? ` v${ver}` : ''}${res ? ` ${res}p` : ''}` };
}

export function scanH3Loras(wan2gpRoot: string): H3Lora[] {
  const out: H3Lora[] = [];
  for (const d of Object.keys(LORA_DIRS)) {
    let files: string[] = [];
    try { files = fs.readdirSync(path.join(wan2gpRoot, 'loras', d)); } catch { continue; }
    out.push(...files.map(classifyH3Lora).filter((x): x is H3Lora => !!x).map((x) => ({ ...x, dir: d })));
  }
  return out.sort((a, b) => a.steps - b.steps || a.label.localeCompare(b.label));
}
/** a LoRA serve para a família? (mesma pasta; FL2V/Ref2V só na família certa do H3) */
export function loraFits(l: H3Lora, fam: H3Family): boolean {
  if (l.dir && !(LORA_DIRS[l.dir] ?? []).includes(fam)) return false;
  if (fam === 'viggle_swap' || fam === 'viggle_edit') return false;      // o Viggle já traz a própria LoRA
  return l.family === 'any' || l.family === fam;
}

/**
 * Combinações escolhíveis: cada modelo H3 de vídeo instalado, sozinho (passos do próprio modelo) e com cada
 * LoRA de aceleração compatível (modelos já destilados aparecem só sozinhos).
 */
export function h3Options(models: Array<{ model_type: string; name?: string; status?: string }>, loras: H3Lora[]): H3Option[] {
  const out: H3Option[] = [];
  for (const m of models) {
    const fam = h3Family(m.model_type);
    if (!fam || (m.status && m.status !== 'available' && m.status !== 'partial')) continue;
    const base = m.name || m.model_type, distilled = h3Distilled(m.model_type);
    out.push({ id: m.model_type, family: fam, model: m.model_type, label: `${base}${distilled ? ' (já acelerado)' : ' (passos do modelo)'}${m.status === 'partial' ? ' — baixa o resto no 1º uso' : ''}`, distilled });
    if (distilled) continue;
    for (const l of loras.filter((x) => loraFits(x, fam))) {
      out.push({ id: `${m.model_type}|${l.file}`, family: fam, model: m.model_type, lora: l.file, steps: l.steps, label: `${base} + ${l.label}`, distilled: false });
    }
  }
  return out.sort((a, b) => a.family.localeCompare(b.family) || (a.steps ?? 99) - (b.steps ?? 99) || a.label.localeCompare(b.label));
}

/** LoRAs de aceleração conhecidas (qualquer nome com passos) — para tirar a do template antes de pôr a escolhida */
const isAccel = (f: string) => !!classifyH3Lora(f);

/**
 * Aplica a escolha nos settings de um template H3: troca o modelo (mesma família), troca a LoRA de aceleração
 * (mantém as de estilo), ajusta passos e desliga o CFG (modelos destilados usam guidance 1). Sem escolha: nada muda.
 */
export function applyH3Choice(modelType: string, settings: Record<string, unknown>, choice: H3Choice | undefined): { modelType: string; settings: Record<string, unknown>; note?: string } {
  const fam = h3Family(modelType);
  if (!fam || !choice || (!choice.model && !choice.lora)) return { modelType, settings };
  const model = choice.model && h3Family(choice.model) === fam ? choice.model : modelType;
  const s: Record<string, unknown> = { ...settings };
  const loras = (Array.isArray(s['activated_loras']) ? (s['activated_loras'] as string[]) : []);
  const mults = String(s['loras_multipliers'] ?? '').split(/\s+/).filter(Boolean);
  const keep = loras.map((f, i) => [f, mults[i] ?? '1.0'] as const).filter(([f]) => !isAccel(f));
  if (choice.lora && !h3Distilled(model)) {
    keep.push([choice.lora, '1.0']);
    s['num_inference_steps'] = choice.steps ?? classifyH3Lora(choice.lora)?.steps ?? s['num_inference_steps'];
    s['guidance_scale'] = 1;
    s['sample_solver'] = s['sample_solver'] ?? 'euler';
  }
  if (keep.length) { s['activated_loras'] = keep.map(([f]) => f); s['loras_multipliers'] = keep.map(([, m]) => m).join(' '); }
  else { delete s['activated_loras']; delete s['loras_multipliers']; }
  const note = `MiniMax H3: ${model}${choice.lora && !h3Distilled(model) ? ` + ${choice.lora} (${s['num_inference_steps']} passos)` : ''}`;
  return { modelType: model, settings: s, note };
}

/**
 * PADRÃO DO APP para o MiniMax H3 de vídeo: HyperFlow Flash 14B (destilado, 6 passos, sem CFG, sem LoRA de aceleração).
 *  - com REFERÊNCIA (image_refs do elenco/produto, ou áudio de referência: voz clonada, dublagem, trecho da canção)
 *    → minimax_h3_ref2va_hyperflow;
 *  - sem referência (texto, ou só o 1º/último quadro da cena) → minimax_h3_fl2va_hyperflow.
 * Troca a família quando preciso (template Ref2VA sem referência vira FL2VA e vice-versa) e mantém as LoRAs de estilo.
 */
export function applyHyperflowDefault(modelType: string, settings: Record<string, unknown>): { modelType: string; settings: Record<string, unknown>; note?: string } {
  const fam = h3Family(modelType);
  if (fam !== 'fl2va' && fam !== 'ref2va') return { modelType, settings };
  const s: Record<string, unknown> = { ...settings };
  const imgRefs = Array.isArray(s['image_refs']) ? (s['image_refs'] as unknown[]).filter(Boolean) : s['image_refs'] ? [s['image_refs']] : [];
  const audioRef = String(s['audio_prompt_type'] ?? '').toUpperCase().includes('A') && !!s['audio_guide'];
  const hasRefs = imgRefs.length > 0 || audioRef;
  const target = hasRefs ? 'minimax_h3_ref2va_hyperflow' : 'minimax_h3_fl2va_hyperflow';
  if (hasRefs && fam === 'fl2va') {
    /* FL2VA com áudio de referência: o quadro de partida vira a 1ª referência do Ref2VA */
    if (s['image_start'] && !imgRefs.length) s['image_refs'] = [s['image_start']];
    delete s['image_start']; delete s['image_end'];
    s['image_prompt_type'] = ''; s['video_prompt_type'] = 'I';
  }
  if (!hasRefs && fam === 'ref2va') { delete s['image_refs']; delete s['video_prompt_type']; if (!s['image_start']) s['image_prompt_type'] = ''; }
  const loras = Array.isArray(s['activated_loras']) ? (s['activated_loras'] as string[]) : [];
  const mults = String(s['loras_multipliers'] ?? '').split(/\s+/).filter(Boolean);
  const keep = loras.map((f, i) => [f, mults[i] ?? '1.0'] as const).filter(([f]) => !isAccel(f));
  if (keep.length) { s['activated_loras'] = keep.map(([f]) => f); s['loras_multipliers'] = keep.map(([, m]) => m).join(' '); }
  else { delete s['activated_loras']; delete s['loras_multipliers']; }
  Object.assign(s, { num_inference_steps: 6, guidance_scale: 1, guidance_phases: 1, sample_solver: 'euler', flow_shift: 12 });
  return { modelType: target, settings: s, note: `MiniMax H3 ${hasRefs ? 'Ref2VA' : 'FL2VA'} HyperFlow Flash 14B (${hasRefs ? 'com referência' : 'sem referência'}, 6 passos)` };
}
