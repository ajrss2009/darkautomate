import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Settings } from '../shared/types';
import { isUiFormat } from './comfyui';

/**
 * WORKFLOWS DO USUÁRIO (ComfyUI, formato API). O app instalado guarda os workflows de fábrica em resources/ (sem
 * permissão de escrita); os importados ficam em workspace/workflows e são procurados PRIMEIRO.
 */
export type WorkflowKind = 'image' | 'video' | 'voice' | 'music' | 'sfx';
export const WORKFLOW_KINDS: Array<{ id: WorkflowKind; label: string }> = [
  { id: 'image', label: 'Imagem' }, { id: 'video', label: 'Vídeo' }, { id: 'voice', label: 'Voz (TTS)' }, { id: 'music', label: 'Música' }, { id: 'sfx', label: 'Efeitos sonoros' },
];

export const userWorkflowsDir = (s: Settings) => path.join(s.workspace, 'workflows');

/** Caminho do workflow: o importado pelo usuário vence o de fábrica (mesmo nome). */
export function resolveWorkflowPath(builtinDir: string, s: Pick<Settings, 'workspace'> | undefined, name: string): string {
  if (s?.workspace) { const u = path.join(s.workspace, 'workflows', name); if (fs.existsSync(u)) return u; }
  return path.join(builtinDir, name);
}

type Node = { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } };
type Graph = Record<string, Node>;

export interface AutoMap {
  workflow: Graph;
  outputNode?: string;
  /** o que foi ligado às variáveis do app: "6.text ← prompt" */
  mapped: string[];
  /** avisos para o usuário (sem prompt, sem nó de saída…) */
  warnings: string[];
}

const SAVE: Record<WorkflowKind, RegExp> = {
  image: /^(SaveImage|PreviewImage|Image Save|SaveImageWebsocket)/i,
  video: /(SaveVideo|VHS_VideoCombine|SaveAnimatedWEBP|SaveAnimatedPNG|SaveWEBM|CreateVideo)/i,
  voice: /(SaveAudio|PreviewAudio)/i, music: /(SaveAudio|PreviewAudio)/i, sfx: /(SaveAudio|PreviewAudio)/i,
};
const PROMPT_VAR: Record<WorkflowKind, string> = { image: 'prompt', video: 'prompt', voice: 'text', music: 'style', sfx: 'sfx_prompt' };
const isLink = (v: unknown) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';
const hasVar = (v: unknown) => typeof v === 'string' && /\{\{\w+\}\}/.test(v);

/**
 * Liga um workflow do ComfyUI (formato API) às variáveis do app, escrevendo {{variável}} nos campos: texto positivo e
 * negativo (seguindo as ligações positive/negative do sampler), semente, largura/altura, quadros/fps, duração do áudio,
 * imagem de entrada (vídeo) e áudio de referência (voz). Campos que já têm {{…}} ficam como estão. Função pura.
 */
export function autoMapWorkflow(input: unknown, kind: WorkflowKind): AutoMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('o arquivo não é um workflow do ComfyUI');
  if (isUiFormat(input)) throw new Error('este é o formato de INTERFACE do ComfyUI — no ComfyUI use Workflow → Exportar (API) / "Save (API Format)" e importe esse arquivo');
  const wf = JSON.parse(JSON.stringify(input)) as Graph;
  const ids = Object.keys(wf).filter((k) => wf[k] && typeof wf[k] === 'object' && typeof wf[k]!.class_type === 'string');
  if (!ids.length) throw new Error('nenhum nó com class_type — não parece o formato API do ComfyUI');
  const mapped: string[] = [], warnings: string[] = [];
  const set = (id: string, key: string, v: string) => {
    const n = wf[id]!; const cur = n.inputs?.[key];
    if (cur === undefined || isLink(cur) || hasVar(cur)) return false;
    n.inputs![key] = `{{${v}}}`; mapped.push(`${id}.${key} ← ${v}`); return true;
  };
  const already = new Set<string>();
  for (const id of ids) for (const v of Object.values(wf[id]!.inputs ?? {})) if (typeof v === 'string') for (const m of v.matchAll(/\{\{(\w+)\}\}/g)) already.add(m[1]!);

  /* textos: positivo/negativo pelas ligações do sampler; senão, o 1º nó de texto é o positivo e o de título "neg…" o negativo */
  const textKey = (n: Node) => ['text', 'prompt', 'positive_prompt', 'text_g', 'tags', 'caption'].find((k) => typeof n.inputs?.[k] === 'string');
  const pos = new Set<string>(), neg = new Set<string>();
  for (const id of ids) {
    const inp = wf[id]!.inputs ?? {};
    if (isLink(inp['positive'])) pos.add((inp['positive'] as [string, number])[0]);
    if (isLink(inp['negative'])) neg.add((inp['negative'] as [string, number])[0]);
  }
  const textNodes = ids.filter((id) => { const n = wf[id]!; return !!textKey(n) && !SAVE[kind].test(n.class_type!) && !/^Load/i.test(n.class_type!); });
  const negIds = textNodes.filter((id) => neg.has(id) || (!pos.has(id) && /neg/i.test(wf[id]!._meta?.title ?? '')));
  const posIds = textNodes.filter((id) => !negIds.includes(id) && (pos.has(id) || !pos.size));
  const mainVar = PROMPT_VAR[kind];
  if (!already.has(mainVar)) {
    const first = posIds[0];
    if (first) set(first, textKey(wf[first]!)!, mainVar);
    else warnings.push(`não achei o campo de texto do pedido — escreva {{${mainVar}}} nele (ou importe de novo depois de ajustar)`);
  }
  if (!already.has('negative') && (kind === 'image' || kind === 'video')) for (const id of negIds.slice(0, 1)) set(id, textKey(wf[id]!)!, 'negative');
  /* música com letra: o campo "lyrics" recebe a letra (instrumental = [Instrumental]) */
  if (kind === 'music') for (const id of ids) if (typeof wf[id]!.inputs?.['lyrics'] === 'string') set(id, 'lyrics', 'lyrics');

  for (const id of ids) {
    const n = wf[id]!, inp = n.inputs ?? {};
    const num = (k: string) => typeof inp[k] === 'number';
    for (const k of ['seed', 'noise_seed']) if (num(k)) set(id, k, 'seed');
    if ((kind === 'image' || kind === 'video') && num('width') && num('height')) { set(id, 'width', 'width'); set(id, 'height', 'height'); }
    if (kind === 'video') {
      for (const k of ['length', 'frames', 'num_frames', 'video_frames', 'frame_count']) if (num(k)) set(id, k, 'frames');
      for (const k of ['fps', 'frame_rate']) if (num(k)) set(id, k, 'fps');
      if (/^LoadImage/i.test(n.class_type!) && typeof inp['image'] === 'string') set(id, 'image', 'init_image');
    }
    if (kind === 'sfx' || kind === 'music') for (const k of ['seconds', 'duration', 'audio_length', 'length_seconds']) if (num(k)) set(id, k, kind === 'sfx' ? 'sfx_seconds' : 'music_seconds');
    if (kind === 'voice' && /^LoadAudio/i.test(n.class_type!) && typeof inp['audio'] === 'string') set(id, 'audio', 'ref_audio');
  }
  const outs = ids.filter((id) => SAVE[kind].test(wf[id]!.class_type!));
  const outputNode = outs.find((id) => /^Save/i.test(wf[id]!.class_type!)) ?? outs[outs.length - 1];
  if (!outputNode) warnings.push('nenhum nó de saída (Save…) do tipo escolhido — o app usa o primeiro arquivo que o ComfyUI devolver');
  return { workflow: wf, outputNode, mapped, warnings };
}

/** Nome de arquivo seguro a partir do nome dado (ou do arquivo original). */
export function workflowFileName(name: string): string {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.json$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workflow';
  return `${base.startsWith('wan2gp-') ? `c-${base}` : base}.json`;
}

/** Importa: auto-mapeia, grava <nome>.json e <nome>.map.json (rótulo, tipo, nó de saída) em workspace/workflows. */
export function importComfyWorkflow(s: Settings, o: { json: unknown; label: string; kind: WorkflowKind; fileName?: string; overwrite?: boolean }): AutoMap & { file: string; path: string } {
  if (!WORKFLOW_KINDS.some((k) => k.id === o.kind)) throw new Error(`tipo inválido: ${o.kind}`);
  const label = o.label.trim() || (o.fileName ?? 'Workflow importado').replace(/\.json$/i, '');
  const m = autoMapWorkflow(o.json, o.kind);
  const dir = userWorkflowsDir(s);
  fs.mkdirSync(dir, { recursive: true });
  let file = workflowFileName(label);
  if (!o.overwrite) for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = workflowFileName(`${label}-${i}`);
  const p = path.join(dir, file);
  fs.writeFileSync(p, JSON.stringify(m.workflow, null, 1));
  fs.writeFileSync(p.replace(/\.json$/, '.map.json'), JSON.stringify({ label, capability: o.kind, outputNode: m.outputNode, imported: new Date().toISOString(), mapped: m.mapped }, null, 1));
  return { ...m, file, path: p };
}

/** Apaga um workflow importado (só da pasta do usuário). */
export function removeUserWorkflow(s: Settings, file: string): void {
  if (!/^[a-z0-9-]+\.json$/.test(file)) throw new Error('arquivo inválido');
  const p = path.join(userWorkflowsDir(s), file);
  if (!fs.existsSync(p)) throw new Error('workflow importado não encontrado');
  fs.rmSync(p, { force: true }); fs.rmSync(p.replace(/\.json$/, '.map.json'), { force: true });
}

/** Tipo provável pelos nós (o usuário confirma ou troca na importação). Função pura. */
export function guessWorkflowKind(input: unknown): WorkflowKind {
  const cls = Object.values((input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Graph).map((n) => String(n?.class_type ?? '')).join(' ');
  if (/SaveVideo|VHS_VideoCombine|CreateVideo|SaveAnimatedWEBP|ImageToVideo|TextToVideo|Wan.*Video|LTXV|Hunyuan.*Video/i.test(cls)) return 'video';
  if (/SaveAudio|PreviewAudio|VAEDecodeAudio|EmptyLatentAudio/i.test(cls)) {
    if (/TTS|VoiceClone|Speech|F5|Chatterbox|OmniVoice|Kokoro|Fish/i.test(cls)) return 'voice';
    if (/YuE|ACE|Song|Music|Lyrics/i.test(cls)) return 'music';
    return 'sfx';
  }
  return 'image';
}
