/*
 * Ícones das listas de SKILL e ROTA (Novo projeto). <option> nativo só aceita texto, então o ícone é um emoji
 * escolhido pelo tipo de vídeo (nome/id/aparência) — e, na rota, também por quem executa (GPU local, nuvem, Flow).
 * Puro: a interface e os testes usam a mesma regra.
 */

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** [regex no texto normalizado, ícone] — a primeira que casa vence (do mais específico ao mais geral). */
const KIND_ICONS: Array<[RegExp, string]> = [
  [/(?:^|\s)canal-|clonad|\bclone\b/, '🧬'],
  [/cartoon ?3d|cartoon3d|cartoon_3d|3d cartoon|2d em mundo 3d/, '🧸'],
  [/reconstrucao 3d|recon_3d|\b3d\b/, '🏛️'],
  [/ms paint|ms_paint|rabisco/, '🖍️'],
  [/collage|colagem/, '✂️'],
  [/paper ?cut|paper_cut|recorte de papel/, '📄'],
  [/vector|vetorial/, '📐'],
  [/microdrama|micro_drama|serie|novela/, '🎭'],
  [/anuncio|produto|\bad_|propaganda|comercial/, '🛍️'],
  [/personalizado|custom/, '⚙️'],
  [/de link|link|navegador|webcapture/, '🔗'],
  [/dorama/, '🎎'],
  [/historia|personage|story|conto|narrador/, '📖'],
  [/video livre|livre|freeform|\bfree\b/, '✨'],
  [/misto|mixed|mescla/, '🧩'],
  [/lyric|letra/, '🎤'],
  [/clipe musical|musical|music|musica|lo-?fi|coletanea/, '🎵'],
  [/tutorial|passo a passo|tela/, '🧑‍🏫'],
  [/shorts|vertical|reels|viral/, '📱'],
  [/documentario|doc[_ -]?netflix|\bdoc\b|ensaio/, '🎞️'],
  [/stickman|palito/, '🕴️'],
  [/realista|cinematografico|realistic|cinema/, '🎥'],
  [/anime|manga/, '🌸'],
  [/whiteboard|quadro branco/, '🖊️'],
  [/pixel/, '👾'],
  [/low ?poly/, '🔷'],
  [/motion|grafico|infografico/, '📊'],
  [/slideshow|fotos|imagens/, '🖼️'],
  [/podcast|entrevista/, '🎙️'],
  [/noticia|news/, '📰'],
  [/infantil|kids|crianca/, '🧒'],
  [/terror|horror|misterio/, '👻'],
  [/explicativo|explainer|educativo|aula/, '💡'],
  [/codigo|code|canvas|webgl|three/, '💻'],
];

/** Ícone do tipo de vídeo a partir de nome, id e aparência; "em código" ganha 💻 junto. */
export function kindIcon(...parts: Array<string | undefined>): string {
  const t = norm(parts.filter(Boolean).join(' '));
  const hit = KIND_ICONS.find(([re]) => re.test(t))?.[1];
  if (!hit) return '';
  return hit !== '💻' && /codigo|\bcode\b|canvas|webgl/.test(t) ? `${hit}💻` : hit;
}

export function skillIcon(k: { id: string; name: string; appearance?: string; builtin?: boolean }): string {
  return kindIcon(k.name, k.id, k.appearance) || (k.builtin ? '🎬' : '🧠');
}

interface StepLike { enabled?: boolean; bindings?: Array<{ type: string }> }
/** Quem executa a rota: GPU local (ComfyUI/Wan2GP), nuvem (API) ou Google Flow — o que existir. */
export function routeEngines(steps: StepLike[] | undefined): string {
  const types = new Set((steps ?? []).filter((s) => s.enabled !== false).flatMap((s) => (s.bindings ?? []).slice(0, 1).map((b) => b.type)));
  return [types.has('comfyui') || types.has('wan2gp') ? '🖥️' : '', types.has('api') ? '☁️' : '', types.has('flow') ? '🌊' : ''].join('');
}

export function routeIcon(r: { id: string; name: string; steps?: StepLike[] }): string {
  return `${kindIcon(r.name, r.id) || '🛣️'}${routeEngines(r.steps)}`;
}

/** Texto da opção: "ícone  nome". */
export const withIcon = (icon: string, name: string) => (icon ? `${icon}  ${name}` : name);
