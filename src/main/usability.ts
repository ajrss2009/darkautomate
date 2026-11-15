import * as fs from 'node:fs';
import type { Binding, Settings } from '../shared/types';
import { bindingLabel } from '../shared/types';
import { isHttpHarness, resolveHarness, resolveHarnessCommand } from './harness';

/**
 * Por que um provedor NÃO pode ser usado agora (sem chave, não instalado, servidor/pasta não configurados)?
 * undefined = pode ser tentado. Mesmos critérios que o motor usa para pular sem gastar tentativas.
 */
export async function unusableReason(s: Settings, b: Binding): Promise<string | undefined> {
  switch (b.type) {
    case 'api': {
      const p = s.providers.find((x) => x.id === b.provider);
      if (!p) return `provedor "${b.provider}" não configurado`;
      if (!p.apiKey && (/openai\.com/.test(p.baseUrl) || p.kind !== 'openai')) return `"${b.provider}" sem chave de API`;
      return undefined;
    }
    case 'harness': {
      try {
        const r = await resolveHarness(s, b);
        if (!isHttpHarness(r.cfg) && !resolveHarnessCommand(r.cfg).found) return `${r.id} não está instalado`;
        return undefined;
      } catch (e) { return (e as Error).message; }
    }
    case 'comfyui': return s.comfyServers.some((x) => x.id === b.server) ? undefined : `servidor ComfyUI "${b.server}" não configurado`;
    case 'wan2gp': return s.wan2gp?.root && fs.existsSync(s.wan2gp.root) ? undefined : 'pasta do Wan2GP não configurada';
    case 'flow': {
      const accs = s.automations?.accounts ?? [];
      if (!accs.length) return 'nenhuma conta Google em Automações';
      if (b.account && !accs.some((a) => a.id === b.account)) return `conta "${b.account}" não existe em Automações`;
      return undefined;
    }
    default: return undefined;
  }
}

export interface StepUsability { id: string; label: string; use?: string; skipped: Array<{ label: string; reason: string }> }

/** Para cada etapa: o provedor que vai rodar de fato (o 1º utilizável) e os que serão pulados, com o motivo. */
export async function routeUsability(s: Settings, steps: Array<{ id: string; label: string; bindings: Binding[] }>): Promise<StepUsability[]> {
  const out: StepUsability[] = [];
  for (const st of steps) {
    const skipped: StepUsability['skipped'] = [];
    let use: string | undefined;
    for (const b of st.bindings) {
      const why = await unusableReason(s, b);
      if (!why) { use = bindingLabel(b); break; }
      skipped.push({ label: bindingLabel(b), reason: why });
    }
    out.push({ id: st.id, label: st.label, use, skipped });
  }
  return out;
}
