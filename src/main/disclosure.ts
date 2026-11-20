import type { Disclosure } from '../shared/types';

/*
 * DISCLOSURE CONTÍNUO (catálogo, parte XXX — diretrizes 11/2026).
 * "Sem disclosure contínuo, o job NÃO agenda." A divulgação é ESTADO DO VÍDEO, não rodapé:
 * visível do início ao fim (position_sec 0.5 + visible_whole), com os três nomes de campo:
 *   is_aigc (TikTok Content Posting API), is_ai_generated (TikTok Business e Meta),
 *   metadata GenAI no YouTube Music. A portaria SENACON 3/2026 exige visibilidade durante TODO o post.
 */

export const DEFAULT_DISCLOSURE: Disclosure = {
  label: '#publi — parceria paga',
  position_sec: 0.5,
  visible_whole: true,
  platform_tool: true,
  ai_label: true,
  music_genai: true,
};

export interface DisclosureCheck { ok: boolean; errors: string[]; warnings: string[] }
export function validateDisclosure(d?: Disclosure): DisclosureCheck {
  const errors: string[] = [], warnings: string[] = [];
  if (!d) return { ok: false, errors: ['disclosure ausente: defina label, posição e visibilidade contínua'], warnings };
  if (!String(d.label ?? '').trim()) errors.push('disclosure.label vazio');
  if (!Number.isFinite(Number(d.position_sec)) || Number(d.position_sec) < 0 || Number(d.position_sec) > 2)
    errors.push(`disclosure.position_sec deve estar entre 0 e 2 s (recebido: ${d.position_sec}) — a plataforma exige desde o início`);
  if (!d.visible_whole) errors.push('disclosure.visible_whole=false: a portaria 23/10/2026 exige divulgação visível durante todo o vídeo, inclusive ao vivo');
  if (!d.platform_tool) warnings.push('selo da plataforma desligado: use também a ferramenta nativa de divulgação');
  if (!d.ai_label) warnings.push('rótulo de IA desligado: YouTube / is_aigc / is_ai_generated podem exigir');
  if (!d.music_genai) warnings.push('metadado GenAI da música desligado (YouTube Music, 11/2026)');
  return { ok: errors.length === 0, errors, warnings };
}

/** Campos exatos por plataforma — três nomes para a mesma ideia. */
export function disclosureFields(d: Disclosure, platform: 'youtube' | 'youtube_music' | 'tiktok_content' | 'tiktok_business' | 'meta' | 'instagram'): Record<string, unknown> {
  const base: Record<string, unknown> = {
    disclosure_label: d.label,
    disclosure_position_sec: Number(d.position_sec) || 0.5,
    disclosure_visible_whole: !!d.visible_whole,
    disclosure_uses_platform_tool: !!d.platform_tool,
  };
  switch (platform) {
    case 'tiktok_content': return { ...base, is_aigc: !!d.ai_label };
    case 'tiktok_business': return { ...base, is_ai_generated: !!d.ai_label };
    case 'meta':
    case 'instagram': return { ...base, is_ai_generated: !!d.ai_label };
    case 'youtube_music': return { ...base, genai_disclosure: !!d.music_genai, genai_label: d.ai_label ? d.label : undefined };
    case 'youtube': return { ...base, ai_generated: !!d.ai_label, genai_disclosure: !!d.music_genai };
  }
}

/** Pré-vôo do job: sem disclosure contínuo (quando o projeto publica), não agenda. */
export function disclosureGate(o: { disclosure?: Disclosure; publishes: boolean }): DisclosureCheck {
  if (!o.publishes) return { ok: true, errors: [], warnings: o.disclosure ? [] : ['sem disclosure declarado (projeto sem publicação automática)'] };
  const v = validateDisclosure(o.disclosure);
  if (!v.ok) v.errors.unshift('job não agendado: publique com disclosure contínuo (position_sec ≤ 2 e visible_whole=true)');
  return v;
}
