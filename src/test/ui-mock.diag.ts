import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultSettings } from '../main/settings';
import { listAgents, listRoutes, listSkills } from '../main/library';
import { VIDEO_TYPES } from '../main/presets';
import { buildCatalog } from '../main/catalog';
import { allProfiles } from '../shared/profiles';

/**
 * Diagnóstico (não roda no npm test): grava os dados reais (meta + catálogo) de uma
 * biblioteca para abrir a interface no navegador com uma API simulada.
 * Uso: node ui-mock.js <workspace> <workflowsDir> <saída.json>
 */
const [ws, wf, out] = process.argv.slice(2) as [string, string, string];
const s = defaultSettings(ws);
s.harnesses.antigravity.models = ['gemini-3.8-flash-low', 'gemini-3.8-pro'];
s.harnesses.ollama.models = ['tobestyledintro/qwen3.8-9b-distill:latest', 'LisyNeko/qwen3.8-9b-coder:latest'];
const meta = { videoTypes: VIDEO_TYPES, routes: listRoutes(s), skills: listSkills(s), agents: listAgents(s), types: [], harnessIds: Object.keys(s.harnesses),
  stepKinds: [], thumbnails: s.thumbnails, voices: [{ name: 'Dave PT-BR', path: 'C:/voices/dave.mp3' }, { name: 'Ana', path: 'C:/voices/ana.mp3' }], profiles: allProfiles(s.executorProfiles) };
fs.writeFileSync(out, JSON.stringify({ meta, catalog: buildCatalog(s, wf), settings: s }));
console.log('ok', path.basename(out));
