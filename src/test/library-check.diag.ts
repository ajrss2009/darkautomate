import * as path from 'node:path';
import { defaultSettings } from '../main/settings';
import { listRoutes, listSkills, validateRoute } from '../main/library';
import { getVideoType } from '../main/presets';
import { checkSkillRoute } from '../shared/compat';

/** Diagnóstico (não roda no npm test): valida as rotas e skills de uma biblioteca real. Uso: node dist/test/library-check.diag.js <workspace> */
const ws = process.argv[2] ?? path.join(process.env['USERPROFILE'] ?? '', 'Documents', 'FilmForge');
const s = defaultSettings(ws);
const routes = listRoutes(s);
let bad = 0;
for (const r of routes.filter((x) => !x.builtin)) {
  const e = validateRoute(r);
  if (e.length) { bad++; console.log(`✗ rota ${r.id}: ${e.join('; ')}`); }
}
for (const k of listSkills(s).filter((x) => !x.builtin)) {
  const r = routes.find((x) => x.id === k.routeId);
  if (!r) { bad++; console.log(`✗ skill ${k.id}: rota "${k.routeId}" não existe`); continue; }
  const rep = checkSkillRoute(k, r, getVideoType(k.appearance ?? 'custom')?.sceneKind, r);
  console.log(`${rep.errors.length ? '✗' : rep.warnings.length ? '⚠' : '✓'} skill ${k.id} → ${r.id} ${[...rep.errors, ...rep.warnings].join(' | ')}`);
  if (rep.errors.length) bad++;
}
console.log(`${routes.filter((x) => !x.builtin).length} rotas do usuário verificadas; ${bad} problema(s)`);
process.exit(bad ? 1 : 0);
