import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Modelos ESPECIAIS do Wan2GP lidos das definições (defaults/*.json) — instalados ou para baixar no 1º uso:
 *  - troca de personagem em vídeo (Viggle Remake Swap, Viggle Animate, Wan Animate) e em imagem (Qwen Image Viggle Swap);
 *  - troca de objeto/cenário/luz em vídeo (Viggle Remake Edit);
 *  - 2D → 3D: sólidos (malha GLB) a partir de imagens (Hunyuan3D, TRELLIS.2, Pixal3D), textura de malha,
 *    refino, animação e partes de malha.
 * Funções puras para classificar; a leitura da pasta fica em scanSpecialModels.
 */

export type SpecialCategory = 'swap' | 'swapImage' | 'swapEdit' | 'shape3d' | 'texture3d' | 'refine3d' | 'animate3d' | 'parts3d';
export const SPECIAL_LABEL: Record<SpecialCategory, string> = {
  swap: 'Troca de personagem (vídeo)', swapImage: 'Troca de personagem (imagem / quadro)', swapEdit: 'Troca de objeto, cenário ou luz (vídeo)',
  shape3d: '2D → 3D: sólido (malha GLB) de uma imagem', texture3d: '3D: textura (PBR) na malha', refine3d: '3D: refinar malha', animate3d: '3D: animar malha por texto', parts3d: '3D: separar a malha em partes',
};
export interface SpecialModel { model_type: string; name: string; description: string; category: SpecialCategory; status: 'available' | 'partial' | 'download' }

/** Categoria pela definição do Wan2GP (nome do arquivo, arquitetura, nome e descrição). */
export function classifySpecial(modelType: string, def: { name?: string; architecture?: string; description?: string }): SpecialCategory | undefined {
  const id = modelType.toLowerCase(), arch = (def.architecture ?? '').toLowerCase(), d = `${def.name ?? ''} ${def.description ?? ''}`.toLowerCase();
  if (/viggle_remake_edit/.test(id)) return 'swapEdit';
  if (/image_swap/.test(id)) return 'swapImage';
  if (/^viggle_(remake|animate)/.test(id) || /^animate2?$/.test(arch) || /^animate2?(_distilled)?$/.test(id)) return 'swap';
  if (/animate_any_mesh/.test(id)) return 'animate3d';
  if (/geosam|part segmentation/.test(id + ' ' + d)) return 'parts3d';
  if (/hi3d|mesh refiner/.test(id + ' ' + d)) return 'refine3d';
  if (/(texture|paint)/.test(id) && /mesh/.test(d)) return 'texture3d';
  if (/(shape|pixal3d)/.test(id) && /(mesh|glb|3d)/.test(d)) return 'shape3d';
  return undefined;
}

export function scanSpecialModels(wan2gpRoot: string, availability: Array<{ model_type: string; status: string }> = []): SpecialModel[] {
  const dir = path.join(wan2gpRoot, 'defaults');
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const st = new Map(availability.map((a) => [a.model_type, a.status]));
  const out: SpecialModel[] = [];
  for (const f of files) {
    const modelType = f.replace(/\.json$/, '');
    let def: { model?: { name?: string; architecture?: string; description?: string } } = {};
    try { def = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const m = def.model ?? {};
    const cat = classifySpecial(modelType, m);
    if (!cat) continue;
    const s = st.get(modelType);
    out.push({ model_type: modelType, name: m.name ?? modelType, description: (m.description ?? '').replace(/\s+/g, ' ').slice(0, 280), category: cat, status: s === 'available' ? 'available' : s === 'partial' ? 'partial' : 'download' });
  }
  const rank = { available: 0, partial: 1, download: 2 };
  return out.sort((a, b) => a.category.localeCompare(b.category) || rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
}
