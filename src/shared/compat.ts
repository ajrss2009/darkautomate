import type { Route, SceneKind, Skill } from './types';

/**
 * Compatibilidade entre skill e rota. A skill descreve o vídeo (tipos de cena,
 * fontes que mescla, vozes); a rota precisa ter etapas que produzam isso.
 */

const on = (r: Route | undefined) => (r?.steps ?? []).filter((s) => s.enabled);
export const routeHasKind = (r: Route | undefined, kind: string) => on(r).some((s) => s.kind === kind);
export const routeHasTool = (r: Route | undefined, tool: string) => on(r).some((s) => s.bindings.some((b) => b.type === 'builtin' && b.tool === tool));

/** Tipos de cena que a rota consegue produzir (mesma regra do motor). */
export function producibleKinds(r: Route | undefined): Set<SceneKind> {
  const k = new Set<SceneKind>();
  for (const s of on(r)) {
    if (s.kind === 'code_scene') k.add('code');
    if (s.kind === 'motion_graphics') k.add('motion');
    if (s.kind === 'stock_media') k.add('stock');
    if (s.kind === 'image') k.add('image');
    if (s.kind === 'video') k.add('video');
  }
  if (k.has('stock') && (k.has('code') || k.has('motion'))) k.add('mixed');
  // code_scene que aceita "motion" também desenha motion graphics
  if (on(r).some((s) => s.kind === 'code_scene' && (s.onlySceneKinds ?? []).includes('motion'))) k.add('motion');
  return k;
}

export const KIND_PT: Record<SceneKind, string> = { image: 'imagem', video: 'vídeo IA', code: 'código', motion: 'motion graphics', mixed: 'misto (código + banco)', stock: 'banco de mídia' };
const MIX_NEEDS: Record<string, { label: string; kinds: string[] }> = {
  motion: { label: 'motion graphics/código', kinds: ['code_scene', 'motion_graphics'] },
  stock: { label: 'banco de imagens/vídeos', kinds: ['stock_media'] },
  ai: { label: 'vídeo IA', kinds: ['video'] },
};

export interface CompatReport { errors: string[]; warnings: string[]; ok: string[] }

/**
 * @param sceneKind  estratégia visual padrão da aparência da skill (VIDEO_TYPES[].sceneKind)
 * @param suggested  rota sugerida pela skill (para detectar skills que exigem uma rota especial)
 */
export function checkSkillRoute(skill: Skill | undefined, route: Route | undefined, sceneKind?: SceneKind, suggested?: Route): CompatReport {
  const rep: CompatReport = { errors: [], warnings: [], ok: [] };
  if (!skill || !route) return rep;
  const kinds = producibleKinds(route);
  if (skill.freeform) {
    if (!routeHasKind(route, 'free')) rep.errors.push('Skill de vídeo livre precisa de uma rota com a etapa "Vídeo livre" — o app troca para a rota "Vídeo livre".');
    else rep.ok.push('Vídeo livre: o prompt vai direto ao harness.');
    return rep;
  }
  if (routeHasKind(route, 'free') && !routeHasKind(route, 'scene_plan')) {
    rep.errors.push('A rota é de vídeo livre (sem cenas), mas a skill planeja cenas — o app troca para a rota sugerida da skill.');
    return rep;
  }
  if (routeHasTool(suggested, 'clip-musical') && !routeHasTool(route, 'clip-musical')) rep.errors.push('Esta skill é de clipe musical: escolha uma rota com a montagem "clip-musical".');
  if (routeHasTool(suggested, 'lyric-song') && !routeHasTool(route, 'lyric-song')) rep.errors.push('Esta skill é de lyric video: escolha uma rota que gere a canção e os tempos da letra ("lyric-song").');
  for (const m of skill.presentation === 'mixed' ? (skill.mixSources ?? ['motion', 'stock']) : (skill.mixSources ?? [])) {
    const need = MIX_NEEDS[m];
    if (need && !need.kinds.some((k) => routeHasKind(route, k))) rep.warnings.push(`A skill mescla ${need.label}, mas a rota não tem etapa para isso.`);
  }
  if (sceneKind && !kinds.has(sceneKind) && !routeHasTool(route, 'clip-musical')) {
    rep.warnings.push(`A aparência pede cenas de ${KIND_PT[sceneKind]}; nesta rota elas viram ${[...kinds].map((k) => KIND_PT[k]).join(' / ') || '—'}.`);
  }
  if (skill.multiVoice && !routeHasKind(route, 'narration')) rep.warnings.push('A skill tem diálogo com várias vozes, mas a rota não tem narração.');
  if (skill.multiVoice && routeHasKind(route, 'narration')) rep.ok.push('Diálogo: cada cena usa a voz do personagem (defina o elenco abaixo).');
  if (!rep.errors.length && !rep.warnings.length) rep.ok.push(`A rota produz: ${[...kinds].map((k) => KIND_PT[k]).join(', ') || 'apenas montagem'}.`);
  return rep;
}

/* ────────────────────────────────────────────────────────────────────────────
 * MATRIZ DE COMPATIBILIDADE ENTRE SKILLS (catálogo, parte VI — pág. 37)
 * Seis famílias, três eixos de conflito: áudio, motor e continuidade.
 * 🟢 mesmo contrato de áudio e motor compatível · 🟡 só com audioOverride por cena
 * · 🔴 contratos incompatíveis — o vídeo troca de língua no meio.
 * ──────────────────────────────────────────────────────────────────────────── */

export type SkillFamily = 'explicativo' | 'documentario' | 'elenco' | 'clipe' | 'slideshow' | 'cartoon3d';
export type AudioContract = 'narracao' | 'elenco' | 'musica';
export type EngineContract = 'code' | 'image_video' | 'banco';

export interface FamilyProfile {
  family: SkillFamily; audio: AudioContract; engine: EngineContract;
  /** só uma skill pode ser dona do elenco/cenário/figurino */
  ownsContinuity: boolean;
}

/** Heurística pura: família + contratos a partir do skill (id/appearance/steps). */
export function familyOf(skill: Pick<Skill, 'id' | 'appearance' | 'musicVideo' | 'multiVoice' | 'steps'>): FamilyProfile {
  const id = String(skill.id ?? ''), ap = String(skill.appearance ?? '');
  const steps = Object.keys(skill.steps ?? {});
  if (skill.musicVideo || /clip|lyric|musica|musical/.test(id) || ap === 'music_lyric')
    return { family: 'clipe', audio: 'musica', engine: steps.includes('video') ? 'image_video' : 'code', ownsContinuity: false };
  if (skill.multiVoice || /dorama|elenco|historia|drama/.test(id))
    return { family: 'elenco', audio: 'elenco', engine: steps.includes('video') ? 'image_video' : 'code', ownsContinuity: true };
  if (/cartoon|cartoon_3d|code3d/.test(id + ap) || ap === 'cartoon_3d')
    return { family: 'cartoon3d', audio: 'narracao', engine: 'code', ownsContinuity: false };
  if (/slideshow|slide/.test(id) || ap === 'slideshow')
    return { family: 'slideshow', audio: 'narracao', engine: 'banco', ownsContinuity: false };
  if (/documentario|doc_netflix|realista|recon/.test(id + ap))
    return { family: 'documentario', audio: 'narracao', engine: 'image_video', ownsContinuity: true };
  return { family: 'explicativo', audio: 'narracao', engine: 'code', ownsContinuity: false };
}

const LED: Record<SkillFamily, Record<SkillFamily, 'green' | 'yellow' | 'red'>> = {
  explicativo:  { explicativo: 'green',  documentario: 'green',  elenco: 'red',     clipe: 'red',     slideshow: 'green',  cartoon3d: 'green' },
  documentario: { explicativo: 'green',  documentario: 'green',  elenco: 'yellow', clipe: 'red',     slideshow: 'green',  cartoon3d: 'yellow' },
  elenco:       { explicativo: 'red',    documentario: 'yellow', elenco: 'green',  clipe: 'red',     slideshow: 'red',    cartoon3d: 'yellow' },
  clipe:        { explicativo: 'red',    documentario: 'red',    elenco: 'red',    clipe: 'green',   slideshow: 'yellow', cartoon3d: 'green' },
  slideshow:    { explicativo: 'green',  documentario: 'green',  elenco: 'red',    clipe: 'yellow',  slideshow: 'green',  cartoon3d: 'green' },
  cartoon3d:    { explicativo: 'green',  documentario: 'yellow', elenco: 'yellow', clipe: 'green',   slideshow: 'green',  cartoon3d: 'green' },
};

export interface MixReport {
  level: 'green' | 'yellow' | 'red';
  families: SkillFamily[];
  issues: string[];
  /** etapas exigidas por todas as skills da mistura (para filtrar rotas) */
  requiredSteps: string[];
}

/** Semáforo da mistura: auditam-se todos os pares; o pior nível vence. */
export function checkSkillMix(skills: Array<Pick<Skill, 'id' | 'appearance' | 'musicVideo' | 'multiVoice' | 'steps'>>): MixReport {
  const profiles = skills.map(familyOf);
  const issues: string[] = [];
  let level: 'green' | 'yellow' | 'red' = 'green';
  for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) {
    const a = profiles[i]!, b = profiles[j]!;
    const led = LED[a.family][b.family];
    if (led === 'red' && level !== 'red') level = 'red';
    if (led === 'yellow' && level === 'green') level = 'yellow';
    if (a.audio !== b.audio) issues.push(`${a.family} (${a.audio}) + ${b.family} (${b.audio}): contratos de áudio diferentes — só com audioOverride por cena.`);
    if (a.ownsContinuity && b.ownsContinuity) issues.push(`${a.family} e ${b.family} querem ser donas do elenco/cenário — o personagem troca de rosto entre blocos.`);
    if (led === 'red') issues.push(`${a.family} + ${b.family}: o vídeo troca de língua no meio (use uma só ou uma rota com etapas separadas por bloco).`);
  }
  const required = new Set<string>();
  for (const s of skills) for (const k of Object.keys(s.steps ?? {})) required.add(k);
  return { level, families: profiles.map((p) => p.family), issues: [...new Set(issues)], requiredSteps: [...required] };
}

/** Rotas que contêm TODAS as etapas exigidas pela mistura. */
export function routesForMix(routes: Route[], required: string[]): Route[] {
  if (!required.length) return routes;
  return routes.filter((r) => required.every((k) => on(r).some((s) => s.kind === k)));
}

