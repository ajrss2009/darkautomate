import type { Agent, Skill } from '../shared/types';
import { EFFORT_OPTIONS, modelSupportsEffort } from '../shared/effort';
import { KIND_ICON, KIND_LABEL, type Ctx } from './library-ui';
import { askConfirm, showMessage } from './dialogs';

/* Aba Agentes: orquestradores (escrevem o brief e coordenam), obreiros (assumem etapas da rota)
   e revisores (obreiros que conferem e corrigem uma etapa). Visual: diagrama da equipe + cartões. */
interface Cat { harnesses: Array<{ id: string; models: string[]; defaultModel?: string }> }
interface Meta { stepKinds: string[]; harnessIds: string[]; routes?: Array<{ id: string; name: string; favorite?: boolean; steps: Array<{ id: string; label: string; kind: string; enabled: boolean }> }> }
let draft: Agent | undefined;
let origin: Agent | undefined;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Tipo exibido: orquestrador, revisor (obreiro que revisa) ou obreiro. */
export type AgentType = 'orchestrator' | 'reviewer' | 'worker';
export const agentType = (a: Agent): AgentType => a.role === 'orchestrator' ? 'orchestrator' : /revis|review|qualidade/i.test(`${a.name} ${a.id}`) || (a.handles ?? []).includes('review') ? 'reviewer' : 'worker';
export const AGENT_TYPES: Record<AgentType, { icon: string; label: string; what: string; color: string }> = {
  orchestrator: { icon: '🧭', label: 'Orquestrador', what: 'Roda ANTES de tudo: escreve o brief (conceito, bíblia visual, plano por etapa e critérios de aceite) que todas as etapas seguem. Um por projeto.', color: '#7c5cff' },
  worker: { icon: '🛠️', label: 'Obreiro', what: 'Assume etapas da rota (roteiro, imagens, código, SEO…): as instruções dele entram no pedido daquela etapa, com provedor/modelo próprios se quiser.', color: '#0ea5e9' },
  reviewer: { icon: '🔎', label: 'Revisor', what: 'Obreiro que confere e CORRIGE o resultado de uma etapa (ex.: o roteiro) antes de a produção seguir, com um checklist de qualidade.', color: '#f59e0b' },
};
const PLURAL: Record<AgentType, string> = { orchestrator: 'Orquestradores', worker: 'Obreiros', reviewer: 'Revisores' };
const ICONS = ['🧭', '🎬', '⏱️', '✍️', '🔎', '🔬', '🎨', '🧑‍💻', '📈', '🎥', '🎙️', '🎵', '🖼️', '🧠', '📚', '🛡️', '⚖️', '🌍', '🧪', '🤖'];

export async function renderAgents(c: Ctx) {
  const { h, main, forge, toast, guard } = c;
  const [agents, cat, meta, skills] = await Promise.all([
    forge['listAgents']() as Promise<Agent[]>, forge['catalog']() as Promise<Cat>, forge['meta']() as Promise<Meta>, forge['listSkills']() as Promise<Skill[]>]);
  const again = () => void renderAgents(c);
  const blank = (t: AgentType): Agent => ({ id: '', name: t === 'orchestrator' ? 'Novo orquestrador' : t === 'reviewer' ? 'Novo revisor' : 'Novo obreiro', role: t === 'orchestrator' ? 'orchestrator' : 'worker',
    description: '', instructions: '', harness: 'auto', handles: t === 'orchestrator' ? undefined : t === 'reviewer' ? ['script'] : [], skills: [], icon: AGENT_TYPES[t].icon });
  const iconOf = (a: Agent) => a.icon ?? AGENT_TYPES[agentType(a)].icon;
  const title = (a: Agent) => (a.persona ? `${a.persona} · ${a.name}` : a.name);
  /* onde o agente entra: etapas de cada rota que ele assume e skills que o pré-escolhem no Novo projeto */
  const impactOf = (a: Agent) => {
    const routes = (meta.routes ?? []).map((r) => ({ r, steps: r.steps.filter((st) => st.enabled && (a.handles ?? []).some((x) => x === st.id || x === st.kind)) })).filter((x) => x.steps.length);
    const sk = skills.filter((k) => (a.skills ?? []).includes(k.id));
    return { routes, skills: sk };
  };

  /* diagrama: orquestrador → brief → etapas (obreiros) → revisor confere */
  const diagram = h('div', { class: 'ag-flow' },
    ...(['orchestrator', 'worker', 'reviewer'] as AgentType[]).flatMap((t, i) => [
      h('div', { class: 'ag-flow-step', style: `--c:${AGENT_TYPES[t].color}` }, h('div', { class: 'ag-flow-ic' }, AGENT_TYPES[t].icon), h('strong', {}, AGENT_TYPES[t].label), h('div', { class: 'muted small' }, AGENT_TYPES[t].what)),
      i < 2 ? h('div', { class: 'pl-arrow' }, i === 0 ? '➜ brief ➜' : '➜') : null]));

  const card = (a: Agent) => {
    const t = agentType(a);
    return h('button', { class: `ag-card${origin?.id === a.id ? ' sel' : ''}`, style: `--c:${AGENT_TYPES[t].color}`, 'data-agent': a.id, onclick: () => { origin = a; draft = clone(a); again(); } },
      h('div', { class: 'row' }, h('span', { class: 'ag-ic' }, iconOf(a)), h('div', { class: 'grow ag-names' }, a.persona ? h('strong', { class: 'ag-persona' }, a.persona) : null, h(a.persona ? 'span' : 'strong', { class: a.persona ? 'muted small' : '' }, a.name)),
        a.builtin ? h('span', { class: 'tag' }, '🔒 padrão') : h('span', { class: 'tag done' }, 'meu')),
      h('span', { class: 'ag-type' }, `${AGENT_TYPES[t].icon} ${AGENT_TYPES[t].label}`),
      h('div', { class: 'muted small ag-desc' }, a.description),
      a.role === 'worker' && a.handles?.length ? h('div', { class: 'ag-chips' }, ...a.handles.map((k) => h('span', { class: 'tag' }, `${KIND_ICON[k] ?? '•'} ${KIND_LABEL[k] ?? k}`))) : null,
      a.harness && a.harness !== 'auto' ? h('div', { class: 'muted small' }, `⚙️ ${a.harness}${a.model ? ` · ${a.model}` : ''}`) : null,
      (() => { const im = impactOf(a); return h('div', { class: 'muted small ag-impact-line' }, a.role === 'orchestrator' ? `🧭 brief antes de tudo${im.skills.length ? ` · auto em ${im.skills.length} skill(s)` : ''}` : `🛣️ entra em ${im.routes.length} rota(s)${im.skills.length ? ` · auto em ${im.skills.length} skill(s)` : ''}`); })());
  };
  const group = (t: AgentType, list: Agent[]) => h('div', { class: 'ag-group' },
    h('div', { class: 'row' }, h('h4', {}, `${AGENT_TYPES[t].icon} ${PLURAL[t]}`), h('span', { class: 'sp' }),
      h('button', { class: 'small', 'data-act': `agent-new-${t}`, onclick: () => { origin = undefined; draft = blank(t); again(); } }, `＋ ${AGENT_TYPES[t].label}`)),
    h('div', { class: 'ag-grid' }, ...(list.length ? list.map(card) : [h('div', { class: 'muted small' }, 'Nenhum ainda.')])));
  const byType = (t: AgentType) => agents.filter((a) => agentType(a) === t);
  const board = h('div', { id: 'agent-list' }, group('orchestrator', byType('orchestrator')), group('reviewer', byType('reviewer')), group('worker', byType('worker')));
  const head = h('div', {}, h('h2', {}, '🤝 Agentes'),
    h('p', { class: 'muted' }, 'Monte a equipe de cada vídeo em Novo projeto → Equipe de agentes: um orquestrador (opcional) + os obreiros e revisores que quiser. Dê um nome a cada agente (persona) para reconhecê-lo na equipe. Os agentes padrão (🔒) servem de modelo: abra um e use "Salvar como meu agente" para criar uma versão sua.'),
    diagram);
  if (!draft) { main.replaceChildren(head, board); return; }

  const d = draft; const isB = !!origin?.builtin; const t = agentType(d);
  const inp = (v: string, on: (x: string) => void, attrs: Record<string, string> = {}) => { const el = h('input', { value: v, ...attrs }) as HTMLInputElement; el.addEventListener('input', () => on(el.value)); return el; };
  const select = (opts: Array<[string, string]>, v: string, on: (x: string) => void, attrs: Record<string, string> = {}) => {
    const el = h('select', attrs, ...opts.map(([k, l]) => h('option', { value: k }, l))) as HTMLSelectElement;
    if (!opts.some(([k]) => k === v)) el.append(h('option', { value: v }, v ? `${v} (não carregado)` : '(vazio)'));
    el.value = v; el.addEventListener('change', () => on(el.value)); return el;
  };
  const instr = h('textarea', { id: 'agent-instr', rows: '7', placeholder: t === 'reviewer' ? 'Checklist do que conferir e como corrigir…' : 'Como este agente trabalha: prioridades, regras, critérios de qualidade…' }) as HTMLTextAreaElement;
  instr.value = d.instructions; instr.addEventListener('input', () => { d.instructions = instr.value; });
  const hv = cat.harnesses.find((x) => x.id === d.harness);
  const models: Array<[string, string]> = [['', 'auto (padrão do provedor)'], ...((d.harness && d.harness !== 'auto' ? hv?.models : []) ?? []).map((m) => [m, m] as [string, string])];
  /* tipo do agente: três cartões explicativos */
  const typePick = h('div', { class: 'ag-types', id: 'agent-role' }, ...(['orchestrator', 'worker', 'reviewer'] as AgentType[]).map((k) => h('button', {
    class: `ag-typecard${t === k ? ' on' : ''}`, style: `--c:${AGENT_TYPES[k].color}`, 'data-role': k,
    onclick: () => { d.role = k === 'orchestrator' ? 'orchestrator' : 'worker'; if (k !== 'orchestrator') d.handles = d.handles?.length ? d.handles : k === 'reviewer' ? ['script'] : []; if (k === 'reviewer' && !/revis/i.test(d.name)) d.name = `Revisor — ${d.name}`; if (k !== 'reviewer') d.name = d.name.replace(/^Revisor — /, ''); again(); },
  }, h('div', { class: 'ag-flow-ic' }, AGENT_TYPES[k].icon), h('strong', {}, AGENT_TYPES[k].label), h('div', { class: 'muted small' }, AGENT_TYPES[k].what))));
  const handles = d.role === 'worker' ? h('div', { class: 'card', id: 'agent-handles' }, h('strong', {}, t === 'reviewer' ? 'Etapas que este revisor confere e corrige' : 'Etapas que este obreiro assume'),
    h('div', { class: 'ag-kinds' }, ...meta.stepKinds.map((k) => {
      const on = (d.handles ?? []).includes(k);
      return h('button', { class: `ag-kind${on ? ' on' : ''}`, 'data-kind': k, onclick: () => { const s = new Set(d.handles ?? []); on ? s.delete(k) : s.add(k); d.handles = [...s]; again(); } }, `${KIND_ICON[k] ?? '•'} ${KIND_LABEL[k] ?? k}`);
    }))) : null;
  const iconPick = h('div', { class: 'ag-icons' }, ...ICONS.map((ic) => h('button', { class: `ag-iconbtn${iconOf(d) === ic ? ' on' : ''}`, onclick: () => { d.icon = ic; again(); } }, ic)));
  const sk = h('select', { id: 'agent-skills', multiple: true, size: '6' }, ...skills.map((k) => h('option', { value: k.id }, k.name))) as HTMLSelectElement;
  for (const o of Array.from(sk.options)) o.selected = (d.skills ?? []).includes(o.value);
  sk.addEventListener('change', () => { d.skills = Array.from(sk.selectedOptions).map((o) => o.value); });

  main.replaceChildren(head, h('div', { class: 'split' }, board, h('div', {},
    h('div', { class: 'card ag-editor', style: `--c:${AGENT_TYPES[t].color}` },
      h('div', { class: 'row' }, h('span', { class: 'ag-ic big' }, iconOf(d)), h('h3', { class: 'grow' }, d.name || 'Agente'), h('button', { onclick: () => { draft = undefined; origin = undefined; again(); } }, '✕')),
      isB ? h('p', { class: 'muted' }, '🔒 Agente padrão (somente leitura). Use "Salvar como meu agente" para criar uma cópia editável.') : null,
      h('strong', {}, 'Tipo'), typePick,
      h('div', { class: 'row' },
        h('label', { class: 'grow', title: 'O nome próprio do agente (persona), ex.: Marina. Aparece nos cartões, no Novo projeto e no pedido às IAs ("você é Marina, Roteirista").' }, 'Nome do agente (persona)', inp(d.persona ?? '', (v) => { d.persona = v || undefined; }, { id: 'agent-persona', placeholder: 'Ex.: Marina, Leo, Dra. Ana…', maxlength: '40' })),
        h('label', { class: 'grow', title: 'A função dele na equipe' }, 'Função', inp(d.name, (v) => { d.name = v; }, { id: 'agent-name' }))),
      h('div', {}, h('div', { class: 'muted small' }, 'Ícone'), iconPick),
      h('label', {}, 'Descrição (aparece ao montar a equipe)', inp(d.description, (v) => { d.description = v; }, { id: 'agent-desc' })),
      h('label', {}, t === 'orchestrator' ? 'Como coordenar (vai no pedido do brief)' : 'Instruções (vão no pedido das etapas que ele assume)', instr),
      h('div', { class: 'row' },
        h('label', {}, 'Provedor', select([['auto', 'auto (o da etapa)'], ...meta.harnessIds.map((x) => [x, x] as [string, string])], d.harness ?? 'auto', (v) => { d.harness = v as Agent['harness']; d.model = undefined; d.effort = undefined; again(); }, { id: 'agent-harness' })),
        h('label', {}, 'Modelo (carregados em Configurações)', select(models, d.model ?? '', (v) => {
          d.model = v || undefined;
          if (!modelSupportsEffort(d.harness, d.model)) d.effort = undefined;
          again();
        }, { id: 'agent-model' })),
        d.harness && d.harness !== 'auto' && modelSupportsEffort(d.harness, d.model)
          ? h('label', {}, 'Esforço', select(EFFORT_OPTIONS, d.effort ?? '', (v) => { d.effort = (v || undefined) as Agent['effort']; }, { id: 'agent-effort' }))
          : null,
        h('label', { class: 'grow' }, 'Sugerido para as skills (Ctrl+clique para várias)', sk)),
      h('div', { class: 'row' },
        h('button', { class: 'primary', id: 'agent-save', onclick: () => void guard(async () => {
          const a = clone(d); a.id = isB ? '' : origin?.id ?? '';
          const saved = (await forge['saveAgent'](a)) as Agent; origin = saved; draft = clone(saved); toast(`Agente "${saved.name}" salvo`); again();
        }) }, isB ? 'Salvar como meu agente' : 'Salvar agente'),
        origin && !origin.builtin ? h('button', { class: 'danger', id: 'agent-del', onclick: () => void guard(async () => {
          if (!await askConfirm(`Excluir o agente "${origin!.name}"?`)) return; await forge['deleteAgent'](origin!.id); draft = undefined; origin = undefined; toast('Agente excluído'); again();
        }) }, 'Excluir') : null)),
    handles, impactCard(d))));

  /* como o agente impacta o projeto e como ele é escolhido no Novo projeto */
  function impactCard(a: Agent): HTMLElement {
    const im = impactOf(a);
    const tt = agentType(a);
    return h('div', { class: 'card ag-impact', id: 'agent-impact' }, h('strong', {}, '🎯 Como este agente entra num projeto'),
      h('ol', { class: 'ag-how' },
        h('li', {}, tt === 'orchestrator' ? 'Novo projeto → Equipe de agentes → escolha-o em "Orquestrador" (um por projeto).' : 'Novo projeto → Equipe de agentes → marque o cartão dele em "Obreiros e revisores".'),
        im.skills.length ? h('li', {}, `Já vem marcado ao escolher a skill: ${im.skills.map((k) => k.name).join(', ')}.`) : h('li', { class: 'muted' }, 'Nenhuma skill o pré-escolhe (use "Sugerido para as skills" acima).'),
        h('li', {}, tt === 'orchestrator' ? 'Efeito: roda antes de tudo e escreve o brief (conceito, bíblia visual, plano por etapa, critérios de aceite) que todas as etapas seguem.'
          : `Efeito: as instruções dele entram no pedido das etapas que assume${a.harness && a.harness !== 'auto' ? `, e essas etapas rodam com ${a.harness}${a.model ? `/${a.model}` : ''} no lugar do provedor da rota` : ' (o provedor continua o da rota)'}.`),
        a.persona ? h('li', {}, `A IA recebe: "você é ${a.persona}, ${a.name}".`) : null),
      tt !== 'orchestrator' ? (im.routes.length
        ? h('div', { class: 'ag-routes' }, h('div', { class: 'muted small' }, `Etapas que ele assume em cada rota (${im.routes.length}):`),
          ...im.routes.slice(0, 12).map((x) => h('div', { class: 'ag-route' }, h('span', { class: 'grow' }, `${x.r.favorite ? '⭐ ' : ''}🛣️ ${x.r.name}`), ...x.steps.map((st) => h('span', { class: 'tag' }, `${KIND_ICON[st.kind] ?? '•'} ${st.label}`)))),
          im.routes.length > 12 ? h('div', { class: 'muted small' }, `…e mais ${im.routes.length - 12} rota(s).`) : null)
        : h('div', { class: 'tag running' }, '⚠ Nenhuma rota tem as etapas que ele assume: marque etapas acima ou ele não terá efeito.')) : null);
  }
}
