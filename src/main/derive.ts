import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Aspect, Project, Settings, VideoTypeId } from '../shared/types';
import { cacheKey } from './engine';
import { readProject, saveProjectFile } from './ops';
import { createProject, projectDirOf } from './settings';

/** O que muda na variação; o resto vem do projeto de origem. */
export interface DeriveInput {
  name?: string; skillId?: string; routeId?: string; videoType?: VideoTypeId; aspect?: Aspect; language?: string;
  targetDurationSec?: number; quality?: Project['quality']; videoStyle?: string; scriptStyle?: string; musicStyle?: string;
  /** 'idea' = recomeça do zero com a mesma ideia; 'script' = reaproveita o roteiro já escrito (só refaz cenas e mídias no novo estilo) */
  keep?: 'idea' | 'script';
}

/**
 * Cria um NOVO projeto a partir de outro, trocando atributos (skill/estilo, rota, formato, idioma, duração…).
 * O original não é tocado. Com keep='script', o roteiro é copiado e marcado como pronto (o motor não o reescreve).
 */
export function deriveProject(s: Settings, id: string, i: DeriveInput): Project {
  const src = readProject(s, id);
  const changedSkill = !!i.skillId && i.skillId !== src.skillId;
  const p = createProject(s, {
    name: i.name?.trim() || `${src.name} (variação)`,
    idea: src.idea,
    /* com outra skill, a aparência vem dela (a não ser que o usuário escolha um tipo) */
    videoType: i.videoType ?? (changedSkill ? 'custom' : src.videoType),
    skillId: i.skillId ?? src.skillId,
    routeId: i.routeId ?? (changedSkill ? undefined : src.routeId),
    aspect: i.aspect ?? src.aspect,
    language: i.language ?? src.language,
    targetDurationSec: i.targetDurationSec ?? src.targetDurationSec,
    quality: i.quality ?? src.quality,
    scriptStyle: i.scriptStyle ?? src.scriptStyle,
    videoStyle: i.videoStyle ?? (changedSkill ? undefined : src.videoStyle),
    musicStyle: i.musicStyle ?? src.musicStyle,
    musicMode: src.musicMode, waveform: src.waveform,
    musicMinMin: src.musicMinMin, musicMaxMin: src.musicMaxMin, musicTrackSec: src.musicTrackSec,
    cast: src.cast, plugins: src.plugins, pluginStyles: src.pluginStyles, narrationVoice: src.narrationVoice, thumbnailTemplate: src.thumbnailTemplate,
    maxProductionMin: src.maxProductionMin, sceneConcurrency: src.sceneConcurrency,
  });
  p.memories = [...new Set([...(p.memories ?? []), ...(src.memories ?? [])])];
  if (src.subtitleStyle) p.subtitleStyle = { ...src.subtitleStyle };
  p.derivedFrom = { id: src.id, name: src.name, keep: i.keep ?? 'idea', at: new Date().toISOString() };
  const srcScript = path.join(projectDirOf(s, src.id), 'script.md');
  if (i.keep === 'script' && fs.existsSync(srcScript)) {
    const dir = projectDirOf(s, p.id);
    const dst = path.join(dir, 'script.md');
    fs.copyFileSync(srcScript, dst);
    /* roteiro pronto: registra no cache da etapa (qualquer executor da cadeia) para não ser reescrito */
    const cacheFile = path.join(dir, 'cache', 'index.json');
    const cache: Record<string, string[]> = {};
    for (const st of p.route?.steps ?? []) if (st.kind === 'script') for (const b of st.bindings) cache[cacheKey(p, st, b)] = [dst];
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  }
  saveProjectFile(s, p);
  return p;
}
