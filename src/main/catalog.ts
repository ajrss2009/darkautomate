import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ApiCategory, Settings, StockSource } from '../shared/types';

export type Capability = 'image' | 'video' | 'voice' | 'music';
export interface CatalogItem { file: string; label: string; capability: Capability; backend: 'comfyui' | 'wan2gp'; modelType?: string }

/** Catálogo para o editor de rotas: o que cada tipo de tarefa pode usar. */
export interface Catalog {
  workflows: CatalogItem[];
  wan2gpTemplates: CatalogItem[];
  wan2gpModels: Array<{ kind: string; model: string }>;
  apis: Array<{ provider: string; kind: string; categories: ApiCategory[]; models: string[]; modelCategories?: Record<string, ApiCategory>; voices: string[]; voiceLabels?: Record<string, string> }>;
  harnesses: Array<{ id: string; models: string[]; defaultModel?: string }>;
  stock: StockSource[];
  builtinTools: string[];
  comfyServers: string[];
  /** contas Google de Automações (executor Flow) */
  flowAccounts: Array<{ id: string; label: string; email?: string }>;
}

const CAPS: Capability[] = ['image', 'video', 'voice', 'music'];

export function buildCatalog(s: Settings, workflowsDir: string): Catalog {
  const workflows: CatalogItem[] = [], wan: CatalogItem[] = [];
  if (fs.existsSync(workflowsDir)) {
    for (const f of fs.readdirSync(workflowsDir).filter((x) => x.endsWith('.json') && !x.endsWith('.map.json')).sort()) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(workflowsDir, f), 'utf8'));
        if (f.startsWith('wan2gp-')) {
          wan.push({ file: f, label: j.label ?? f, capability: CAPS.includes(j.capability) ? j.capability : 'image', backend: 'wan2gp', modelType: j.model_type });
          continue;
        }
        if (Array.isArray(j.nodes)) continue;                 // formato de interface: inutilizável
        const sidecar = path.join(workflowsDir, f.replace(/\.json$/, '.map.json'));
        const m = fs.existsSync(sidecar) ? JSON.parse(fs.readFileSync(sidecar, 'utf8')) : {};
        workflows.push({ file: f, label: m.label ?? f, capability: CAPS.includes(m.capability) ? m.capability : 'image', backend: 'comfyui' });
      } catch { /* ignora arquivo inválido */ }
    }
  }
  return {
    workflows, wan2gpTemplates: wan,
    wan2gpModels: s.wan2gpModels ?? [],
    apis: s.providers.map((p) => ({ provider: p.id, kind: p.kind, categories: p.categories ?? ['text', 'image', 'voice'], models: p.models, modelCategories: p.modelCategories, voices: p.voices ?? [], voiceLabels: p.voiceLabels })),
    harnesses: Object.entries(s.harnesses).map(([id, c]) => ({ id, models: c.models, defaultModel: c.defaultModel })),
    stock: ['pexels', 'pixabay', 'wikipedia'],
    builtinTools: ['silence-trim', 'subtitles', 'assemble', 'library-music', 'whisper', 'estimate-words', 'clip-musical', 'lyric-song', 'lyric-words', 'frame-thumbnail', 'sfx-code', 'music-code', 'youtube-upload'],
    comfyServers: s.comfyServers.map((x) => x.id),
    flowAccounts: (s.automations?.accounts ?? []).map((a) => ({ id: a.id, label: a.label, email: a.email })),
  };
}
