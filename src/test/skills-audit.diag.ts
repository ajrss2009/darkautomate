import { validateRoute } from '../main/library';
import { ROUTES } from '../main/presets';
import { BUILTIN_SKILLS } from '../main/skills-builtin';
import { routeSceneKinds } from '../main/prompts';

/* Auditoria estática de todas as skills embutidas (diagnóstico, não entra no npm test). */
const kindsOfStep = new Set(ROUTES.flatMap((r) => r.steps.map((s) => s.kind)));
const problems: string[] = [];
const rows: string[] = [];
for (const k of BUILTIN_SKILLS) {
  const p: string[] = [];
  const r = k.routeId ? ROUTES.find((x) => x.id === k.routeId) : undefined;
  if (k.routeId && !r) p.push(`rota "${k.routeId}" não existe`);
  if (r) {
    const errs = validateRoute(r);
    if (errs.length) p.push(`rota inválida: ${errs.join('; ')}`);
    const ids = new Set(r.steps.map((s) => s.id)), kinds = new Set(r.steps.map((s) => s.kind));
    for (const key of Object.keys(k.steps ?? {})) {
      if (!ids.has(key) && !kinds.has(key as never) && !['asset_design', 'bible'].includes(key) && kindsOfStep.has(key as never)) p.push(`instrução "${key}" sem etapa na rota`);
      if (key === 'asset_design' && !kinds.has('asset_design')) p.push('instrução asset_design sem etapa na rota');
    }
    const rk = routeSceneKinds({ route: r } as never);
    const asked = [...new Set([...(k.steps['scene_plan'] ?? '').matchAll(/kind"?\s*[:=]?\s*"(code|video|image|stock|motion|mixed)"/g)].map((m) => m[1]!))];
    for (const a of asked) if (rk.size && !rk.has(a)) p.push(`pede cenas "${a}" mas a rota só produz ${[...rk].join('/')}`);
    if (k.multiVoice && !r.steps.some((s) => s.kind === 'narration') && !r.steps.some((s) => s.kind === 'free')) p.push('multiVoice sem etapa de narração');
    if (!r.steps.some((s) => s.kind === 'edit') && !r.steps.some((s) => s.kind === 'free') && !r.steps.some((s) => s.bindings.some((b) => b.type === 'builtin' && (b.tool === 'wan2gp-showrunner' || b.tool === 'kit-film' || b.tool === 'viggle-remake')))) p.push('rota sem montagem');
  }
  if (!k.description?.trim()) p.push('sem descrição');
  if (!k.global?.trim() && !k.freeform) p.push('sem instrução global');
  if (k.durationSec !== undefined && (k.durationSec < 5 || k.durationSec > 3600)) p.push(`duração estranha ${k.durationSec}`);
  rows.push(`${p.length ? '✗' : '✓'} ${k.id} → ${k.routeId ?? '(sem rota)'} · ${k.aspect ?? '?'} · ${k.durationSec ?? '?'} s${p.length ? `\n    - ${p.join('\n    - ')}` : ''}`);
  if (p.length) problems.push(k.id);
}
console.log(rows.join('\n'));
console.log(`\n${BUILTIN_SKILLS.length} skills, ${problems.length} com problema: ${problems.join(', ')}`);
