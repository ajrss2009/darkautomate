import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Route, RouteStep, Settings, Skill } from '../shared/types';
import { checkSkillRoute } from '../shared/compat';
import { resolveApiModel } from '../shared/api-models';
import { listRoutes, listSkills, validateRoute } from './library';
import { getVideoType } from './presets';

/**
 * Auditoria da biblioteca: incoerências entre skills, rotas, workflows, provedores, vozes e contas.
 * Usada pela tela de Skills/Rotas ("Verificar biblioteca") e pelo diagnóstico de linha de comando.
 */
export interface AuditIssue { level: 'erro' | 'aviso'; kind: 'rota' | 'skill'; id: string; name: string; msg: string; builtin?: boolean }

const MEDIA = new Set(['image', 'video', 'code_scene', 'motion_graphics', 'stock_media', 'narration', 'music', 'sfx']);
const toolOf = (st: RouteStep) => st.bindings.map((b) => (b.type === 'builtin' ? b.tool : '')).find(Boolean);

export function auditRoute(s: Settings, r: Route, workflowsDir: string): Array<Omit<AuditIssue, 'kind' | 'id' | 'name'>> {
  const out: Array<Omit<AuditIssue, 'kind' | 'id' | 'name'>> = [];
  const err = (msg: string) => out.push({ level: 'erro', msg }), warn = (msg: string) => out.push({ level: 'aviso', msg });
  for (const e of validateRoute(r)) err(e);
  const on = r.steps.filter((st) => st.enabled);
  const ids = new Set(on.map((st) => st.id));
  const byKind = (k: string) => on.filter((st) => st.kind === k);
  for (const st of on) {
    for (const b of st.bindings) {
      if (b.type === 'comfyui' && b.workflow && !fs.existsSync(path.join(workflowsDir, b.workflow))) err(`etapa "${st.id}": workflow ${b.workflow} não existe`);
      if (b.type === 'comfyui' && !s.comfyServers.some((x) => x.id === b.server)) err(`etapa "${st.id}": servidor ComfyUI "${b.server}" não configurado`);
      if (b.type === 'wan2gp' && b.template && !fs.existsSync(path.join(workflowsDir, b.template))) err(`etapa "${st.id}": template ${b.template} não existe`);
      if ((b.type === 'comfyui' || b.type === 'wan2gp') && b.refAudio && !fs.existsSync(b.refAudio)) err(`etapa "${st.id}": voz de referência não encontrada (${path.basename(b.refAudio)})`);
      if (b.type === 'api') {
        const p = s.providers.find((x) => x.id === b.provider);
        if (!p) err(`etapa "${st.id}": provedor de API "${b.provider}" não configurado`);
        else {
          if (!p.apiKey && p.kind !== 'openai') warn(`etapa "${st.id}": provedor "${b.provider}" sem chave de API (vai cair na reserva)`);
          const cat = st.kind === 'image' || st.kind === 'thumbnail' ? 'image' : st.kind === 'video' ? 'video' : st.kind === 'narration' ? 'voice' : st.kind === 'music' ? 'music' : 'text';
          const model = resolveApiModel(p, cat, b.model);
          if (!model) err(`etapa "${st.id}": provedor "${b.provider}" sem modelo para ${cat} — carregue um modelo ou defina o "Modelo padrão"`);
          else if (p.models.length && !p.models.includes(model)) warn(`etapa "${st.id}": modelo ${model} não está na lista do provedor "${b.provider}"`);
          if (st.kind === 'narration' && b.voice && p.voices?.length && !p.voices.includes(b.voice)) warn(`etapa "${st.id}": voz "${b.voice}" não está na lista do provedor "${b.provider}"`);
        }
      }
      if (b.type === 'flow' && b.account && !(s.automations?.accounts ?? []).some((a) => a.id === b.account)) err(`etapa "${st.id}": conta Google "${b.account}" não existe em Automações`);
    }
    const tool = toolOf(st);
    if (tool === 'sfx-code' && st.kind !== 'sfx') err(`etapa "${st.id}": a ferramenta de efeitos está numa etapa do tipo ${st.kind}`);
    if (tool === 'music-code' && st.kind !== 'music') err(`etapa "${st.id}": a trilha programática está numa etapa do tipo ${st.kind}`);
    if ((tool === 'whisper' || tool === 'estimate-words') && st.kind !== 'transcribe') err(`etapa "${st.id}": transcrição numa etapa do tipo ${st.kind}`);
    const ref = (st.params as Record<string, unknown> | undefined)?.['voiceRef'];
    if (typeof ref === 'string' && !fs.existsSync(ref)) err(`etapa "${st.id}": voz escolhida não encontrada (${path.basename(ref)})`);
  }
  /* a montagem precisa esperar tudo o que vai para o vídeo */
  for (const ed of byKind('edit').filter((st) => toolOf(st) === 'assemble')) {
    const miss = on.filter((st) => MEDIA.has(st.kind) && st.id !== ed.id && !ed.dependsOn.includes(st.id)).map((st) => st.id);
    if (miss.length) err(`montagem "${ed.id}" não espera ${miss.join(', ')} (o vídeo pode sair sem essas mídias)`);
    if (byKind('subtitles').length && !byKind('subtitles').every((st) => ed.dependsOn.includes(st.id))) warn(`montagem "${ed.id}" não espera as legendas`);
  }
  for (const st of byKind('sfx')) {
    if (ids.has('transcribe') && !st.dependsOn.includes('transcribe')) warn(`efeitos "${st.id}" não esperam a transcrição (sons presos a palavras ficam fora de hora)`);
    for (const k of ['code_scene', 'motion_graphics']) for (const c of byKind(k)) if (!st.dependsOn.includes(c.id)) warn(`efeitos "${st.id}" não esperam "${c.id}" (sons declarados pela animação são ignorados)`);
  }
  for (const st of [...byKind('code_scene'), ...byKind('motion_graphics')]) if (ids.has('transcribe') && !st.dependsOn.includes('transcribe')) warn(`"${st.id}" não espera a transcrição (animação fora do tempo da fala)`);
  for (const st of byKind('subtitles')) if (byKind('narration').some((n) => !st.dependsOn.includes(n.id))) warn(`legendas "${st.id}" não esperam a narração`);
  for (const st of byKind('thumbnail')) if (byKind('metadata').some((m) => !st.dependsOn.includes(m.id))) warn(`thumbnail "${st.id}" não espera o SEO (usa o nome do projeto em vez do título)`);
  for (const st of byKind('scene_plan')) for (const a of byKind('asset_design')) if (!st.dependsOn.includes(a.id)) warn(`planejamento "${st.id}" não espera os personagens fixos "${a.id}"`);
  for (const st of byKind('image')) for (const a of byKind('asset_design')) if (!st.dependsOn.includes(a.id)) warn(`imagem "${st.id}" não espera os personagens fixos "${a.id}" (aparência pode variar)`);
  return out;
}

/** Seções "## Etapa: X" da skill que a rota não executa e contradições de música. */
export function auditSkill(k: Skill, r: Route): Array<Omit<AuditIssue, 'kind' | 'id' | 'name'>> {
  const out: Array<Omit<AuditIssue, 'kind' | 'id' | 'name'>> = [];
  const on = r.steps.filter((st) => st.enabled);
  const hasStep = (key: string) => on.some((st) => st.id === key || st.kind === key);
  const rep = checkSkillRoute(k, r, getVideoType(k.appearance ?? 'custom')?.sceneKind, r);
  for (const e of rep.errors) out.push({ level: 'erro', msg: e });
  for (const w of rep.warnings) out.push({ level: 'aviso', msg: w });
  /* skills padrão por TIPO trazem instruções para todas as etapas (servem a qualquer rota): não é incoerência */
  const generic = !!k.builtin && !!getVideoType(k.id);
  for (const key of Object.keys(k.steps ?? {})) if (!generic && !hasStep(key)) out.push({ level: 'aviso', msg: `instrução para a etapa "${key}", que a rota "${r.id}" não tem (nunca será usada)` });
  if (r.videoTypes?.length && k.appearance && !r.videoTypes.includes(k.appearance)) out.push({ level: 'aviso', msg: `a rota "${r.id}" é indicada para ${r.videoTypes.join(', ')}, e a skill tem a aparência "${k.appearance}"` });
  const text = `${k.global ?? ''} ${k.outputStyle ?? ''}`.toLowerCase();
  const music = on.some((st) => st.kind === 'music');
  if (/sem m[uú]sica|no music|without music/.test(text) && music) out.push({ level: 'erro', msg: `a skill pede SEM música, mas a rota "${r.id}" tem etapa de trilha` });
  if (/trilha (program|por c[oó]digo)|m[uú]sica program/.test(text) && !on.some((st) => toolOf(st) === 'music-code')) out.push({ level: 'erro', msg: `a skill pede trilha programática, mas a rota "${r.id}" não tem a ferramenta music-code` });
  if (/efeitos sonoros|sound effects|\bsfx\b/.test(text) && !on.some((st) => st.kind === 'sfx')) out.push({ level: 'aviso', msg: `a skill fala de efeitos sonoros, mas a rota "${r.id}" não tem a etapa de efeitos` });
  if (/google flow|flow ai/.test(text) && !on.some((st) => st.bindings.some((b) => b.type === 'flow'))) out.push({ level: 'erro', msg: `a skill pede imagens do Google Flow, mas a rota "${r.id}" não usa o Flow` });
  if (/gemini tts/.test(text) && !on.some((st) => st.kind === 'narration' && st.bindings.some((b) => b.type === 'api' && b.provider === 'gemini'))) out.push({ level: 'erro', msg: `a skill pede narração no Gemini TTS, mas a rota "${r.id}" não usa` });
  if (/(animad|desenhad)[ao]s? por c[oó]digo|canvas|webgl/.test(text) && !on.some((st) => st.kind === 'code_scene' || st.kind === 'motion_graphics')) out.push({ level: 'erro', msg: `a skill pede cenas por código, mas a rota "${r.id}" não tem etapa de código` });
  return out;
}

export function auditLibrary(s: Settings, workflowsDir: string, opts: { includeBuiltin?: boolean } = {}): AuditIssue[] {
  const routes = listRoutes(s);
  const issues: AuditIssue[] = [];
  for (const r of routes) {
    if (r.builtin && !opts.includeBuiltin) continue;
    for (const i of auditRoute(s, r, workflowsDir)) issues.push({ ...i, kind: 'rota', id: r.id, name: r.name, builtin: r.builtin });
  }
  for (const k of listSkills(s)) {
    if (k.builtin && !opts.includeBuiltin) continue;
    const r = routes.find((x) => x.id === k.routeId);
    if (!r) { issues.push({ level: 'erro', kind: 'skill', id: k.id, name: k.name, msg: `rota "${k.routeId}" não existe`, builtin: k.builtin }); continue; }
    for (const i of auditSkill(k, r)) issues.push({ ...i, kind: 'skill', id: k.id, name: k.name, builtin: k.builtin });
  }
  return issues;
}
