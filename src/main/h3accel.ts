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

export type H3Family = 'fl2va' | 'ref2va';
export interface H3Lora { file: string; steps: number; family: H3Family | 'any'; label: string }
export interface H3Choice { model?: string; lora?: string; steps?: number }
export interface H3Option { id: string; family: H3Family; model: string; lora?: string; steps?: number; label: string; distilled: boolean }

/** família do modelo H3 pelo model_type (TTS, controle e imagem ficam de fora) */
export function h3Family(modelType: string): H3Family | undefined {
  const m = modelType.toLowerCase();
  if (!m.startsWith('minimax_h3') || /tts|image|control|vdn|music/.test(m)) return undefined;
  if (m.includes('fl2va')) return 'fl2va';
  if (m.includes('ref2va')) return 'ref2va';
  return undefined;
}
/** modelo que já vem destilado/acelerado (PDD, Veda, Hyperflow, PTD, FastH3): não precisa de LoRA de aceleração */
export const h3Distilled = (modelType: string) => /_pdd|_veda|hyperflow|_ptd|fasth3|singularity/i.test(modelType);

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
  const dir = path.join(wan2gpRoot, 'loras', 'minimax_h3');
  let files: string[] = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  return files.map(classifyH3Lora).filter((x): x is H3Lora => !!x).sort((a, b) => a.steps - b.steps || a.label.localeCompare(b.label));
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
    out.push({ id: m.model_type, family: fam, model: m.model_type, label: `${base}${distilled ? ' (já acelerado)' : ' (passos do modelo)'}`, distilled });
    if (distilled) continue;
    for (const l of loras.filter((x) => x.family === 'any' || x.family === fam)) {
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
