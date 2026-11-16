/*
 * 🔊 TOCANDO AGORA: toda amostra de voz tocada pelo ▶ (Fish, Google, Gemini, OpenAI, ComfyUI/Wan2GP) aparece
 * numa barra fixa no rodapé, com o player e os botões de salvar:
 *  - 🎙 Usar como voz: copia para a biblioteca de vozes (pasta voices) — vira voz de referência (OmniVoice/Wan2GP);
 *  - 💾 Salvar: cópia em voices/testes;  💾 Salvar em…: escolhe a pasta.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = Record<string, (...a: any[]) => Promise<any>>;

let bar: HTMLElement | undefined;
let current: HTMLAudioElement | undefined;

const el = (tag: string, attrs: Record<string, unknown> = {}, ...kids: Array<Node | string | null>) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'onclick') e.addEventListener('click', v as EventListener);
    else if (k === 'class') e.className = String(v);
    else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids) if (k !== null) e.append(k);
  return e;
};

/** Toca a amostra na barra "tocando agora" e devolve o elemento de áudio (para o ▶ voltar ao fim). */
export function playVoiceSample(forge: Api & { mediaUrl?: (p: string) => string }, file: string, label: string, toast?: (m: string, bad?: boolean) => void): HTMLAudioElement {
  current?.pause();
  const media = (forge.mediaUrl ?? ((p: string) => p)) as (p: string) => string;
  const player = el('audio', { controls: true, src: media(file) + '?t=' + Date.now() }) as HTMLAudioElement;
  const msg = el('span', { class: 'muted small vnp-msg' });
  const done = (out: unknown, what: string) => { if (out) { const p = typeof out === 'string' ? out : (out as { path?: string; name?: string }).path ?? (out as { name?: string }).name ?? ''; msg.textContent = `✓ ${what}: ${p}`; toast?.(`${what}: ${p}`); } };
  const act = (fn: () => Promise<unknown>, what: string) => () => { void fn().then((r) => done(r, what)).catch((e) => { msg.textContent = '⛔ ' + (e as Error).message; toast?.((e as Error).message, true); }); };
  bar?.remove();
  bar = el('div', { class: 'voice-nowplaying', id: 'voice-nowplaying' },
    el('b', { class: 'vnp-title', title: label }, `🔊 ${label}`), player,
    el('button', { class: 'small primary', id: 'vnp-use', title: 'Copia para a biblioteca de vozes (pasta voices): vira voz de referência para clonar o timbre (OmniVoice/Wan2GP) e aparece nos seletores de voz', onclick: act(() => forge['importVoice']!(file, label), 'Voz salva na biblioteca') }, '🎙 Usar como voz'),
    el('button', { class: 'small', id: 'vnp-save', title: 'Salva uma cópia em voices/testes (na pasta de trabalho)', onclick: act(() => forge['voiceSaveTest']!(file, label, false), 'Amostra salva') }, '💾 Salvar'),
    el('button', { class: 'small', id: 'vnp-save-as', title: 'Escolher a pasta onde salvar', onclick: act(() => forge['voiceSaveTest']!(file, label, true), 'Amostra salva') }, '💾 Salvar em…'),
    msg,
    el('button', { class: 'small', title: 'Fechar', onclick: () => { player.pause(); bar?.remove(); bar = undefined; } }, '✕'));
  document.body.append(bar);
  current = player;
  void player.play().catch(() => toast?.('Não foi possível tocar a amostra.', true));
  return player;
}
