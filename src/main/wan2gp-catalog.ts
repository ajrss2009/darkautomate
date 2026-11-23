import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * CATÁLOGO COMPLETO do Wan2GP: todo modelo das definições (defaults/*.json) — baixado ou não — classificado em
 * imagem, vídeo, música, voz (TTS), efeitos sonoros, 3D e mundos interativos. Os que não são do app (transcrição)
 * ficam de fora. O app junta tudo em Settings.wan2gpModels: o Wan2GP baixa os pesos no 1º uso.
 * Funções puras para classificar; a leitura da pasta fica em scanWan2gpCatalog.
 */

export type Wan2gpCategory = 'image' | 'video' | 'music' | 'voice' | 'sfx' | '3d' | 'world';
export const CATEGORY_LABEL: Record<Wan2gpCategory, string> = {
  image: 'Imagens', video: 'Vídeos', music: 'Músicas', voice: 'Voz (TTS)', sfx: 'Efeitos sonoros', '3d': 'Objetos 3D', world: 'Mundos interativos e cenas 3D',
};
export interface Wan2gpCatalogModel { model_type: string; name: string; architecture: string; category: Wan2gpCategory; description: string; hyperflow?: boolean }

/** Categoria de um modelo pela definição (nome do arquivo + arquitetura + nome/descrição). */
export function wan2gpCategory(modelType: string, def: { name?: string; architecture?: string; description?: string }): Wan2gpCategory | undefined {
  const id = modelType.toLowerCase(), arch = (def.architecture ?? modelType).toLowerCase();
  const d = `${def.name ?? ''} ${def.description ?? ''}`.toLowerCase();
  if (/transcrib/.test(id + arch)) return undefined;
  /* mundos exploráveis e reconstrução de cena (point cloud / splats de uma cena inteira) */
  if (/^(evoke|hy_nomas|worldmirror|mapanything|da3_points|moge2)/.test(arch) || /explorable world|world model/.test(d)) return 'world';
  /* objetos 3D: malha GLB, splats de objeto, textura, partes, refino e animação de malha */
  if (/^(hunyuan3d|trellis2|pixal3d|triposg|triposplat|partcrafter|qwen35_glb|supratex|geosam|hi3d|animate_any_mesh)/.test(arch)) return '3d';
  if (/_sfx$/.test(id)) return 'sfx';
  if (/^(ace_step|heartmula|yue2|minimax_music|stable_audio)/.test(arch)) return 'music';
  if (/tts|^(chatterbox|auk|fish_drama|kugelaudio|omnivoice|zonos|dramabox_audio|scenema_audio)/.test(arch)) return 'voice';
  if (/^(flux|qwen_image|z_image|krea2|moss_image|minimax_h3_image|minimax_p_h3_image|hidream|ideogram|fibo2|ming_image|sensenova|pi_flux2|chrono_edit)/.test(arch)) return 'image';
  return 'video';
}

/** O modelo MiniMax H3 HyperFlow Flash 14B a usar: Ref2VA quando há referência (elenco/produto/voz), FL2VA senão. */
export const H3_HYPERFLOW = { ref2va: 'minimax_h3_ref2va_hyperflow', fl2va: 'minimax_h3_fl2va_hyperflow' } as const;
export const hyperflowFor = (hasRefs: boolean) => (hasRefs ? H3_HYPERFLOW.ref2va : H3_HYPERFLOW.fl2va);

export function scanWan2gpCatalog(wan2gpRoot: string): Wan2gpCatalogModel[] {
  const dir = path.join(wan2gpRoot, 'defaults');
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out: Wan2gpCatalogModel[] = [];
  for (const f of files) {
    const modelType = f.replace(/\.json$/, '');
    let def: { model?: { name?: string; architecture?: string; description?: string; hyperflow?: boolean } } = {};
    try { def = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const m = def.model ?? {};
    const category = wan2gpCategory(modelType, m);
    if (!category) continue;
    out.push({ model_type: modelType, name: m.name ?? modelType, architecture: m.architecture ?? modelType, category, description: (m.description ?? '').replace(/\s+/g, ' ').slice(0, 280), ...(m.hyperflow ? { hyperflow: true } : {}) });
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/** Junta o catálogo nos modelos carregados do app (sem repetir; mantém os que o usuário pôs à mão). */
export function mergeWan2gpModels(current: Array<{ kind: string; model: string }>, catalog: Array<Pick<Wan2gpCatalogModel, 'model_type' | 'category'>>): Array<{ kind: Wan2gpCategory; model: string }> {
  const out = current.map((m) => ({ kind: m.kind as Wan2gpCategory, model: m.model }));
  const seen = new Set(out.map((m) => m.model));
  for (const c of catalog) if (!seen.has(c.model_type)) { out.push({ kind: c.category, model: c.model_type }); seen.add(c.model_type); }
  return out;
}
