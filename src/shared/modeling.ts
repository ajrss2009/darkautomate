/*
 * CHECKLIST DA MODELAGEM DE CANAL (Pesquisar → Clonar canal): o que o DNA precisa cobrir para a produção
 * replicar a ESTRUTURA do formato. Cada item diz se veio MEDIDO (sem IA), DESCRITO pela IA ou se faltou,
 * e onde é usado na produção. Puro (sem Node): a interface e os testes usam a mesma lista.
 */

export type CoverageSource = 'medido' | 'IA' | 'faltou';
export interface CoverageItem { group: string; item: string; source: CoverageSource; value?: string; usedIn: string }

type Obj = Record<string, unknown>;
const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Obj)[k] : undefined), o);
const has = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as Obj).length);
const show = (v: unknown): string => Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? `${(x as Obj)['name'] ?? ''} ${(x as Obj)['pct'] ?? ''}%`.trim() : String(x))).join(', ')
  : v && typeof v === 'object' ? Object.entries(v as Obj).filter(([, x]) => typeof x !== 'object').map(([k, x]) => `${k} ${x}`).join(', ') : String(v);

/** [grupo, item, caminho medido, caminho(s) no DNA da IA, onde entra na produção] */
const ITEMS: Array<[string, string, string | undefined, string[], string]> = [
  ['Roteiro e ritmo', 'Palavras por minuto (WPM)', 'wpm', ['narration.pace'], 'tamanho do roteiro (palavras = WPM × duração)'],
  ['Roteiro e ritmo', 'Anatomia do gancho (0–15 s)', 'hook', ['script.hookAnatomy', 'script.hook'], 'roteiro: gancho'],
  ['Roteiro e ritmo', 'Tempo até a 1ª recompensa', undefined, ['script.timeToRewardSec'], 'roteiro: gancho'],
  ['Roteiro e ritmo', 'Estrutura de atos (com %)', undefined, ['script.acts'], 'roteiro e plano de cenas (cenas por ato)'],
  ['Roteiro e ritmo', 'Linguagem / PNL', undefined, ['script.nlp', 'script.voice'], 'roteiro'],
  ['Roteiro e ritmo', 'Bordões de transição', 'phrases', ['script.transitions'], 'roteiro (função, sem copiar)'],
  ['Roteiro e ritmo', 'Densidade (segundos por fato)', 'secPerFact', ['script.secPerFact'], 'roteiro'],
  ['Identidade visual', 'Paleta em HEX (fundo, texto, destaque, contraste)', undefined, ['visual.paletteRoles', 'visual.palette'], 'cenas, legendas e thumbnail (a do canal do usuário vence)'],
  ['Identidade visual', 'Tipografia (família, contorno, sombra, caixa)', undefined, ['text.family', 'text.outline', 'text.case', 'text.typography'], 'legendas e texto na tela'],
  ['Identidade visual', 'Animação do texto', undefined, ['text.animation'], 'tipo de legenda do projeto'],
  ['Identidade visual', 'Estilo gráfico e B-roll', undefined, ['visual.graphicStyle', 'editing.broll'], 'plano de cenas, imagem, vídeo, código'],
  ['Identidade visual', 'Prompt base de estilo (IA)', undefined, ['visual.aiStylePrompt'], 'imagem e vídeo por IA'],
  ['Cinematografia', 'Movimento de câmera', undefined, ['camera.moves', 'camera.movement'], 'plano de cenas e cenas'],
  ['Cinematografia', 'Lente simulada', undefined, ['camera.lens', 'camera.lenses'], 'imagem e vídeo'],
  ['Cinematografia', 'Profundidade de campo', undefined, ['camera.depthOfField'], 'imagem e vídeo'],
  ['Cinematografia', 'Duração média do take', 'avgShotSec', [], 'duração das cenas (3 takes por cena)'],
  ['Cinematografia', 'Jump cuts', 'jumpCutShare', ['camera.jumpCuts'], 'plano de cenas'],
  ['Áudio', 'SFX por minuto', undefined, ['audio.sfxPerMin'], 'efeitos por cena'],
  ['Áudio', 'Tipo de SFX (orgânico/digital)', undefined, ['audio.sfxKind', 'audio.sfx'], 'efeitos'],
  ['Áudio', 'Dinâmica da trilha (silêncio, BPM, gênero por ato)', undefined, ['soundtrack.bpm', 'soundtrack.silenceBeforeReveal', 'soundtrack.genreByAct', 'soundtrack.tempo'], 'trilha (clima pelo BPM) e cortes'],
  ['Áudio', 'Processamento de voz', undefined, ['audio.voiceProcessing', 'audio.narration'], 'narração'],
];

/** Cobertura do checklist a partir do DNA (IA) e das medições (sem IA). */
export function modelingCoverage(dna: unknown, measured: Obj | undefined, extra: { phrases?: string[] } = {}): CoverageItem[] {
  const m: Obj = { ...(measured ?? {}), phrases: extra.phrases };
  return ITEMS.map(([group, item, mk, paths, usedIn]) => {
    if (mk && has(m[mk])) return { group, item, source: 'medido', value: mk === 'jumpCutShare' ? `${Math.round(Number(m[mk]) * 100)}%` : show(m[mk]).slice(0, 120), usedIn };
    const hit = paths.map((p) => get(dna, p)).find(has);
    return hit !== undefined ? { group, item, source: 'IA', value: show(hit).slice(0, 120), usedIn } : { group, item, source: 'faltou', usedIn };
  });
}
