import type { Binding, Route } from '../shared/types';
import { isVoiceModel, voicesForModel } from '../shared/voices';
import { modelName } from '../shared/exec-names';

/* Voz da narração DESTE projeto: arquivos da pasta voices (OmniVoice/Wan2GP, clonagem) e vozes de API.
   ▶ ouve o arquivo de referência; 🗣 gera uma frase no idioma do projeto com o executor real da rota.
   No Novo projeto também escolhe o MOTOR da narração (modelo local ou API/modelo): as vozes mostradas
   são as que esse modelo aceita. */

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (typeof v === 'boolean') { if (v) el.setAttribute(k, ''); }
    else el.setAttribute(k, v);
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = Record<string, (...a: any[]) => Promise<any>> & { mediaUrl: (p: string) => string };
export type NarrationVoice = { refAudio?: string; apiVoice?: string };
export interface VoicePickerOpts {
  forge: Api; guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  route?: Route; language: string; value: NarrationVoice; onChange: (v: NarrationVoice) => void;
  voices: Array<{ name: string; path: string }>;
  apis: Array<{ provider: string; kind: string; voices: string[]; voiceLabels?: Record<string, string>; models?: string[]; modelCategories?: Record<string, string>; categories?: string[] }>;
  /** motor escolhido para a narração (Novo projeto); sem ele, vale o primeiro executor da rota */
  engine?: Binding;
  /** presente = mostra a escolha de motor (modelo/API) */
  onEngine?: (b: Binding | undefined) => void;
}

let audio: HTMLAudioElement | undefined;

const keyOf = (b: Binding) => b.type === 'api' ? `api:${b.provider}:${b.model}` : b.type === 'comfyui' ? `comfyui:${b.workflow}` : b.type === 'wan2gp' ? `wan2gp:${b.template}` : b.type === 'harness' ? `harness:${b.harness}` : b.type;
const labelOf = (b: Binding) => b.type === 'api' ? `☁ ${b.provider} · ${b.model}` : b.type === 'comfyui' ? `🖥 OmniVoice/ComfyUI · ${b.workflow.replace(/\.json$/, '')}`
  : b.type === 'wan2gp' ? `🖥 Wan2GP · ${modelName(b.template) ? `${modelName(b.template)} (${b.template.replace(/\.json$/, '')})` : b.template.replace(/\.json$/, '')}` : b.type;
const isVoiceEngine = (b: Binding) => b.type === 'api' || b.type === 'comfyui' || b.type === 'wan2gp';

export function voicePicker(o: VoicePickerOpts): HTMLElement {
  const box = h('div', { class: 'card voice-panel', 'data-project-voice': '' });
  const paint = () => {
    const narr = o.route?.steps.find((st) => st.kind === 'narration' && st.enabled);
    /* motores possíveis: os da cadeia da rota + todo modelo de voz das APIs configuradas */
    const engines: Binding[] = [];
    for (const b of narr?.bindings ?? []) if (isVoiceEngine(b) && !engines.some((x) => keyOf(x) === keyOf(b))) engines.push(b);
    for (const a of o.apis) {
      if (a.categories && !a.categories.includes('voice')) continue;
      for (const m of (a.models ?? []).filter((m) => isVoiceModel(m, a.modelCategories))) {
        const b: Binding = { type: 'api', provider: a.provider, model: m };
        if (!engines.some((x) => keyOf(x) === keyOf(b))) engines.push(b);
      }
    }
    const chain = narr ? (o.engine ? [o.engine, ...narr.bindings.filter((b) => keyOf(b) !== keyOf(o.engine!))] : narr.bindings) : [];
    const local = chain.find((b) => b.type === 'comfyui' || b.type === 'wan2gp');
    const api = chain.find((b): b is Extract<Binding, { type: 'api' }> => b.type === 'api');
    const apiInfo = api ? o.apis.find((a) => a.provider === api.provider) : undefined;
    const apiList = apiInfo ? voicesForModel(apiInfo.kind, api!.model, apiInfo.voices) : [];
    /* título da voz (a API do Fish devolve um título; senão mostra o reference_id) */
    const vlabel = (v: string) => apiInfo?.voiceLabels?.[v] ?? v;
    const routeRef = local && 'refAudio' in local ? local.refAudio : undefined;
    /* qual vem primeiro na cadeia = narração principal; o outro é reserva */
    const apiFirst = !!api && (!local || chain.indexOf(api) < chain.indexOf(local));
    const play = (url: string) => { audio?.pause(); audio = new Audio(url); void audio.play().catch(() => {}); };
    const speak = (b: Binding, btn: HTMLElement) => void o.guard(async () => {
      const old = btn.textContent; btn.textContent = '…'; btn.setAttribute('disabled', '');
      try { const f = (await o.forge['voicePreview']({ binding: b, language: o.language })) as string; play(o.forge.mediaUrl(f) + '?t=' + Date.now()); }
      finally { btn.textContent = old; btn.removeAttribute('disabled'); }
    });
    const set = (v: NarrationVoice) => { o.value = v; o.onChange(v); paint(); };
    const cur = o.value.refAudio ?? '';
    const name = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.(mp3|wav|m4a|flac|ogg)$/i, '');

    /* escolha do motor (modelo/API) — as vozes abaixo seguem o que for escolhido aqui */
    let engineRow: HTMLElement | null = null;
    if (o.onEngine && narr && engines.length) {
      const selEl = h('select', { id: 'np-voice-engine' },
        h('option', { value: '' }, `Como a rota/provedores definem (${narr.bindings[0] ? labelOf(narr.bindings[0]) : '—'})`),
        ...engines.map((b) => h('option', { value: keyOf(b) }, labelOf(b)))) as HTMLSelectElement;
      selEl.value = o.engine ? keyOf(o.engine) : '';
      selEl.addEventListener('change', () => {
        const b = engines.find((x) => keyOf(x) === selEl.value);
        o.engine = b ? JSON.parse(JSON.stringify(b)) as Binding : undefined;
        /* a voz da API escolhida antes pode não existir no novo modelo */
        if (o.value.apiVoice && b?.type === 'api') {
          const info = o.apis.find((a) => a.provider === b.provider);
          if (info && !voicesForModel(info.kind, b.model, info.voices).includes(o.value.apiVoice)) o.value = { ...o.value, apiVoice: undefined };
        }
        o.onEngine!(o.engine); o.onChange(o.value); paint();
      });
      engineRow = h('div', { class: 'row', 'data-voice-engine': '' }, h('label', { class: 'grow' }, 'Motor da narração (modelo ou API)', selEl),
        h('span', { class: 'muted small' }, 'As vozes listadas abaixo são as que este modelo aceita.'));
    }

    /* importar um arquivo de áudio como voz: vai para a pasta voices e já fica escolhido */
    const importBtn = h('button', { class: 'small', 'data-act': 'voice-import', title: 'Use um áudio seu (10–30 s de fala limpa) como voz clonada pelo OmniVoice/Wan2GP', onclick: () => void o.guard(async () => {
      const v = (await o.forge['importVoice']()) as { name: string; path: string } | null;
      if (!v) return;
      o.voices = [...o.voices.filter((x) => x.path !== v.path), v].sort((a, b) => a.name.localeCompare(b.name));
      set({ ...o.value, refAudio: v.path });
    }) }, '＋ Importar voz (áudio)');
    box.replaceChildren(...([
      h('div', { class: 'row' }, h('strong', {}, '🎙️ Voz da narração deste projeto'), h('span', { class: 'sp' }), importBtn, h('span', { class: 'muted' }, `🗣 = ouvir falando em ${o.language}`)),
      !narr ? h('div', { class: 'muted' }, 'A rota escolhida não tem narração.') : null,
      engineRow,
      narr && !local && o.value.refAudio ? h('div', { class: 'tag running' }, `⚠ A voz "${name(o.value.refAudio)}" é clonada pelo OmniVoice (ComfyUI) ou Wan2GP — escolha um desses motores acima para usá-la.`) : null,
      local ? h('div', {},
        h('div', { class: 'muted' }, `${apiFirst ? 'Reserva — ' : 'Narração principal — '}${local.type === 'comfyui' ? 'OmniVoice (ComfyUI)' : 'Wan2GP'} clona a voz de um arquivo da pasta voices. Escolha a voz deste projeto:`),
        h('div', { class: 'voice-grid' },
          h('div', { class: `voice-card${cur ? '' : ' on'}`, 'data-voice': '' },
            h('button', { class: 'vpick', onclick: () => set({ ...o.value, refAudio: undefined }) }, h('span', { class: 'vname' }, `Voz da rota${routeRef ? ` (${name(routeRef)})` : ' (padrão do modelo)'}`)),
            h('button', { class: 'vspeak', title: 'Ouvir falando', onclick: (e: Event) => speak(local, e.currentTarget as HTMLElement) }, '🗣')),
          ...o.voices.map((v) => h('div', { class: `voice-card${cur === v.path ? ' on' : ''}`, 'data-voice': v.name },
            h('button', { class: 'vplay', title: 'Ouvir o arquivo de referência', onclick: () => play(o.forge.mediaUrl(v.path)) }, '▶'),
            h('button', { class: 'vpick', onclick: () => set({ ...o.value, refAudio: v.path }) }, h('span', { class: 'vname' }, name(v.name)), cur === v.path ? h('span', { class: 'tag done' }, 'escolhida') : null),
            h('button', { class: 'vspeak', title: `Ouvir esta voz falando em ${o.language}`, onclick: (e: Event) => speak({ ...local, refAudio: v.path } as Binding, e.currentTarget as HTMLElement) }, '🗣'))))) : null,
      api && apiList.length ? h('div', {},
        h('div', { class: 'muted' }, `${apiFirst ? 'Narração principal' : 'Reserva'} por API (${api.provider} · ${api.model}): voz deste projeto`),
        h('div', { class: 'voice-chips' },
          h('span', { class: `chipgrp${o.value.apiVoice ? '' : ' on'}` }, h('button', { class: `chip${o.value.apiVoice ? '' : ' on'}`, onclick: () => set({ ...o.value, apiVoice: undefined }) }, `da rota (${api.voice ?? 'padrão'})`)),
          ...apiList.map((v) => h('span', { class: `chipgrp${o.value.apiVoice === v ? ' on' : ''}` },
            h('button', { class: `chip${o.value.apiVoice === v ? ' on' : ''}`, 'data-api-voice': v, title: vlabel(v) === v ? v : `${vlabel(v)} · ${v}`, onclick: () => set({ ...o.value, apiVoice: v }) }, vlabel(v)),
            h('button', { class: 'chip vspeak', title: `Ouvir ${vlabel(v)} em ${o.language}`, onclick: (e: Event) => speak({ ...api, voice: v }, e.currentTarget as HTMLElement) }, '▶'))))) : null,
      api && !apiList.length ? h('div', { class: 'muted' }, `Nenhuma voz carregada para ${api.provider} — abra Configurações → APIs de voz, clique em Testar (carrega as vozes da conta + biblioteca) e salve.`) : null] as Child[]).filter((x): x is Node => !!x));
  };
  paint();
  return Object.assign(box, { repaint: (route?: Route, language?: string) => { if (route) o.route = route; if (language) o.language = language; paint(); } });
}
