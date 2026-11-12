import type { ApiCategory, ProviderConfig } from './types';

type ProviderModels = Pick<ProviderConfig, 'models' | 'modelCategories' | 'categories' | 'defaultModels'>;

/** Modelos do provedor que servem a uma categoria (comportamento antigo quando não há categorias). */
export function providerModelsForCategory(p: ProviderModels, cat: ApiCategory): string[] {
  const cats = p.categories ?? ['text', 'image', 'voice'];
  const map = p.modelCategories;
  if (!map || cats.length <= 1 || !p.models.every((m) => !!map[m])) return p.models;
  return p.models.filter((m) => !map[m] || map[m] === cat);
}

/** Modelo efetivo: o escolhido na etapa → o padrão da categoria → o primeiro da categoria → o primeiro da lista. */
export function resolveApiModel(p: ProviderModels, cat: ApiCategory, explicit?: string): string {
  return explicit?.trim() || p.defaultModels?.[cat]?.trim() || providerModelsForCategory(p, cat)[0] || p.models[0] || '';
}
