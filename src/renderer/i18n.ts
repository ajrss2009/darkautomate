import type { AppLanguage } from '../shared/types';
import UI1 from './i18n-ui1';
import UI2 from './i18n-ui2';
import UI3 from './i18n-ui3';
import CAT from './i18n-catalog';
import UI4 from './i18n-ui4';

/**
 * Interface multilíngue (pt-BR, en, es).
 *
 * A maior parte da interface é traduzida por um dicionário aplicado ao DOM
 * (texto exato, preservando o restante). Textos montados em código usam `t()`.
 * O que não estiver no dicionário permanece em português — dá para ampliar sem
 * tocar no resto do app.
 */

export type Lang = AppLanguage;

let current: Lang = 'pt-BR';

/** idioma atual */
export const lang = (): Lang => current;
export const setLang = (l: Lang | undefined): void => { current = l === 'en' || l === 'es' ? l : 'pt-BR'; };
export const langName = (l: Lang): string => (l === 'en' ? 'English' : l === 'es' ? 'Español' : 'Português (Brasil)');

const EN: Record<string, string> = {
  'Projetos': 'Projects', 'Novo projeto': 'New project', 'Lote': 'Batch', 'Editor': 'Editor', 'Execução': 'Run',
  'Rotas': 'Routes', 'Skills': 'Skills', 'Agentes': 'Agents', 'Configurações': 'Settings',
  'Tema claro': 'Light theme', 'Tema escuro': 'Dark theme', 'Estúdio de vídeo por IA orientado a cenas': 'Scene-driven AI video studio',
  'Salvos em:': 'Saved in:', 'Abrir pasta': 'Open folder', 'Alterar local…': 'Change location…', '+ Novo projeto': '+ New project',
  'Buscar por nome…': 'Search by name…', 'Todos os status': 'All statuses', '+ Selecionados ao lote': '+ Selected to batch',
  'Excluir selecionados': 'Delete selected', 'Frame': 'Frame', 'Projeto': 'Project', 'Status': 'Status', 'Datas': 'Dates',
  'Tempo de geração': 'Render time', 'Formato': 'Format', 'Ações': 'Actions', 'Editar': 'Edit', 'Executar': 'Run', '+ Lote': '+ Batch',
  'Duplicar': 'Duplicate', 'Renomear': 'Rename', 'Pasta': 'Folder', 'Excluir': 'Delete', 'Atualizar': 'Refresh',
  'novo': 'new', 'executando': 'running', 'concluído': 'done', 'falhou': 'failed', 'incompleto': 'partial',
  'Executar rota': 'Run route', 'Renderizar final': 'Render final', 'Cancelar': 'Cancel', 'Parar': 'Stop', 'Continuar': 'Resume',
  'Ver vídeo final': 'Watch final video', 'Reproduzir': 'Play', 'Pausar': 'Pause', 'Limpar log': 'Clear log',
  'Timeline': 'Timeline', 'Zoom': 'Zoom', 'Produção': 'Production', 'Tempo máximo (min)': 'Max time (min)',
  'Cenas simultâneas': 'Parallel scenes', 'Título': 'Title', 'Tipo': 'Type', 'Duração (s)': 'Duration (s)',
  'Narração': 'Narration', 'Legenda': 'Subtitle', 'Visual': 'Visual', 'Câmera': 'Camera', 'Notas': 'Notes',
  'Salvar': 'Save', 'Salvar e regenerar': 'Save and regenerate', 'Efeitos': 'Effects', 'Legendas': 'Subtitles',
  'Nenhum projeto aberto.': 'No project open.', 'Projeto atual:': 'Current project:',
  'Nome do vídeo': 'Video name', 'Ideia, roteiro ou tema': 'Idea, script or topic', 'Skill': 'Skill', 'Rota': 'Route',
  'Duração': 'Duration', 'Idioma': 'Language', 'Criar projeto': 'Create project', 'Escolher uma skill': 'Choose a skill',
  'Pastas': 'Folders', 'Providers (provedores)': 'Providers', 'ComfyUI / Wan2GP': 'ComfyUI / Wan2GP',
  'APIs de voz': 'Voice APIs', 'APIs de imagens': 'Image APIs', 'APIs de vídeos': 'Video APIs', 'APIs de músicas': 'Music APIs',
  'Bancos de mídia': 'Stock media', 'Whisper e thumbnails': 'Whisper & thumbnails', 'Aplicação': 'Application', 'Plugins': 'Plugins',
  'Salvar configurações': 'Save settings', 'Descartar alterações': 'Discard changes',
  'Idioma da interface': 'Interface language', 'Idioma do app': 'App language', 'Pasta dos projetos': 'Projects folder',
  'Pasta atual': 'Current folder', 'Escolher…': 'Choose…', 'Aplicar': 'Apply', 'mover os projetos existentes para a nova pasta': 'move existing projects to the new folder',
  'Nova rota': 'New route', 'Nova skill': 'New skill', 'Importar': 'Import', 'Exportar': 'Export', 'Nome': 'Name', 'Descrição': 'Description',
  'Global': 'Global', 'Etapas': 'Steps', 'Tarefas': 'Tasks', 'Adicionar': 'Add', 'Remover': 'Remove', 'Fechar': 'Close',
  'Instalar plugin': 'Install plugin', 'Instalar da pasta…': 'Install from folder…', 'Instalar do GitHub…': 'Install from GitHub…',
  'Plugins ativos': 'Active plugins', 'Nenhum plugin instalado.': 'No plugins installed.',
  'Parâmetros da última execução': 'Last run parameters', 'Progresso': 'Progress',
  'restantes': 'left', 'finalizando…': 'finishing…', 'calculando…': 'estimating…', 'cenas': 'scenes', 'entregáveis': 'deliverables', 'decorridos': 'elapsed',
  '↻ Atualizar': '↻ Refresh', '▶ Executar': '▶ Run', '✎ Editar': '✎ Edit', '＋ Lote': '+ Batch', '✓ No lote': '✓ In batch',
  '▶ Executar rota': '▶ Run route', '🎬 Renderizar final': '🎬 Render final', '⏹ Parar': '⏹ Stop', '⏵ Continuar': '⏵ Resume',
  '⬆ Importar': '⬆ Import', '⬇ Exportar': '⬇ Export', '⬇ Exportar todas': '⬇ Export all', '+ Nova rota': '+ New route', '+ Nova skill': '+ New skill',
  '▶ Reproduzir': '▶ Play', '▶ Criar e executar': '▶ Create and run', '＋ Criar e pôr no lote': '+ Create and queue',
  'criado': 'created', 'última exec.': 'last run', 'sem cenas': 'no scenes', 'nunca executado': 'never run',
};

const ES: Record<string, string> = {
  'Projetos': 'Proyectos', 'Novo projeto': 'Nuevo proyecto', 'Lote': 'Lote', 'Editor': 'Editor', 'Execução': 'Ejecución',
  'Rotas': 'Rutas', 'Skills': 'Skills', 'Agentes': 'Agentes', 'Configurações': 'Configuración',
  'Tema claro': 'Tema claro', 'Tema escuro': 'Tema oscuro', 'Estúdio de vídeo por IA orientado a cenas': 'Estudio de vídeo con IA orientado a escenas',
  'Salvos em:': 'Guardados en:', 'Abrir pasta': 'Abrir carpeta', 'Alterar local…': 'Cambiar ubicación…', '+ Novo projeto': '+ Nuevo proyecto',
  'Buscar por nome…': 'Buscar por nombre…', 'Todos os status': 'Todos los estados', '+ Selecionados ao lote': '+ Seleccionados al lote',
  'Excluir selecionados': 'Eliminar seleccionados', 'Frame': 'Fotograma', 'Projeto': 'Proyecto', 'Status': 'Estado', 'Datas': 'Fechas',
  'Tempo de geração': 'Tiempo de generación', 'Formato': 'Formato', 'Ações': 'Acciones', 'Editar': 'Editar', 'Executar': 'Ejecutar', '+ Lote': '+ Lote',
  'Duplicar': 'Duplicar', 'Renomear': 'Renombrar', 'Pasta': 'Carpeta', 'Excluir': 'Eliminar', 'Atualizar': 'Actualizar',
  'novo': 'nuevo', 'executando': 'ejecutando', 'concluído': 'terminado', 'falhou': 'falló', 'incompleto': 'incompleto',
  'Executar rota': 'Ejecutar ruta', 'Renderizar final': 'Renderizar final', 'Cancelar': 'Cancelar', 'Parar': 'Detener', 'Continuar': 'Continuar',
  'Ver vídeo final': 'Ver vídeo final', 'Reproduzir': 'Reproducir', 'Pausar': 'Pausar', 'Limpar log': 'Limpiar registro',
  'Timeline': 'Línea de tiempo', 'Zoom': 'Zoom', 'Produção': 'Producción', 'Tempo máximo (min)': 'Tiempo máximo (min)',
  'Cenas simultâneas': 'Escenas simultáneas', 'Título': 'Título', 'Tipo': 'Tipo', 'Duração (s)': 'Duración (s)',
  'Narração': 'Narración', 'Legenda': 'Subtítulo', 'Visual': 'Visual', 'Câmera': 'Cámara', 'Notas': 'Notas',
  'Salvar': 'Guardar', 'Salvar e regenerar': 'Guardar y regenerar', 'Efeitos': 'Efectos', 'Legendas': 'Subtítulos',
  'Nenhum projeto aberto.': 'Ningún proyecto abierto.', 'Projeto atual:': 'Proyecto actual:',
  'Nome do vídeo': 'Nombre del vídeo', 'Ideia, roteiro ou tema': 'Idea, guion o tema', 'Skill': 'Skill', 'Rota': 'Ruta',
  'Duração': 'Duración', 'Idioma': 'Idioma', 'Criar projeto': 'Crear proyecto', 'Escolher uma skill': 'Elegir una skill',
  'Pastas': 'Carpetas', 'Providers (provedores)': 'Proveedores', 'ComfyUI / Wan2GP': 'ComfyUI / Wan2GP',
  'APIs de voz': 'APIs de voz', 'APIs de imagens': 'APIs de imagen', 'APIs de vídeos': 'APIs de vídeo', 'APIs de músicas': 'APIs de música',
  'Bancos de mídia': 'Bancos de medios', 'Whisper e thumbnails': 'Whisper y miniaturas', 'Aplicação': 'Aplicación', 'Plugins': 'Plugins',
  'Salvar configurações': 'Guardar configuración', 'Descartar alterações': 'Descartar cambios',
  'Idioma da interface': 'Idioma de la interfaz', 'Idioma do app': 'Idioma de la app', 'Pasta dos projetos': 'Carpeta de proyectos',
  'Pasta atual': 'Carpeta actual', 'Escolher…': 'Elegir…', 'Aplicar': 'Aplicar', 'mover os projetos existentes para a nova pasta': 'mover los proyectos existentes a la nueva carpeta',
  'Nova rota': 'Nueva ruta', 'Nova skill': 'Nueva skill', 'Importar': 'Importar', 'Exportar': 'Exportar', 'Nome': 'Nombre', 'Descrição': 'Descripción',
  'Global': 'Global', 'Etapas': 'Etapas', 'Tarefas': 'Tareas', 'Adicionar': 'Añadir', 'Remover': 'Quitar', 'Fechar': 'Cerrar',
  'Instalar plugin': 'Instalar plugin', 'Instalar da pasta…': 'Instalar desde carpeta…', 'Instalar do GitHub…': 'Instalar desde GitHub…',
  'Plugins ativos': 'Plugins activos', 'Nenhum plugin instalado.': 'Ningún plugin instalado.',
  'Parâmetros da última execução': 'Parámetros de la última ejecución', 'Progresso': 'Progreso',
  'restantes': 'restantes', 'finalizando…': 'finalizando…', 'calculando…': 'calculando…', 'cenas': 'escenas', 'entregáveis': 'entregables', 'decorridos': 'transcurridos',
  '↻ Atualizar': '↻ Actualizar', '▶ Executar': '▶ Ejecutar', '✎ Editar': '✎ Editar', '＋ Lote': '+ Lote', '✓ No lote': '✓ En lote',
  '▶ Executar rota': '▶ Ejecutar ruta', '🎬 Renderizar final': '🎬 Renderizar final', '⏹ Parar': '⏹ Detener', '⏵ Continuar': '⏵ Continuar',
  '⬆ Importar': '⬆ Importar', '⬇ Exportar': '⬇ Exportar', '⬇ Exportar todas': '⬇ Exportar todas', '+ Nova rota': '+ Nueva ruta', '+ Nova skill': '+ Nueva skill',
  '▶ Reproduzir': '▶ Reproducir', '▶ Criar e executar': '▶ Crear y ejecutar', '＋ Criar e pôr no lote': '+ Crear y poner en lote',
  'criado': 'creado', 'última exec.': 'últ. ejecución', 'sem cenas': 'sin escenas', 'nunca executado': 'nunca ejecutado',
};

for (const [pt, en, es] of [...UI1, ...UI2, ...UI3, ...UI4, ...CAT]) { EN[pt] ??= en; ES[pt] ??= es; }

const DICTS: Record<'en' | 'es', Record<string, string>> = { en: EN, es: ES };

/** Textos com números montados em código. */
const PATTERNS: Record<'en' | 'es', Array<[RegExp, string]>> = {
  en: [[/^(\d+) por cena$/, '$1 per scene'], [/^(\d+)\/(\d+) cenas com mídia$/, '$1/$2 scenes with media'], [/^(\d+) cena\(s\)$/, '$1 scene(s)'],
    [/^≈ (\d+) faixas de (\d+) s \(alvo (\d+) min\)$/, '≈ $1 tracks of $2 s (target $3 min)'], [/^(\d+) vídeos?$/, '$1 video(s)'], [/^(\d+) canais$/, '$1 channels'], [/^Favoritos \((\d+)\)$/, 'Favorites ($1)']],
  es: [[/^(\d+) por cena$/, '$1 por escena'], [/^(\d+)\/(\d+) cenas com mídia$/, '$1/$2 escenas con medios'], [/^(\d+) cena\(s\)$/, '$1 escena(s)'],
    [/^≈ (\d+) faixas de (\d+) s \(alvo (\d+) min\)$/, '≈ $1 pistas de $2 s (objetivo $3 min)'], [/^(\d+) vídeos?$/, '$1 video(s)'], [/^(\d+) canais$/, '$1 canales']],
};

/** Procura o texto exato; senão, o miolo sem ícones/pontuação nas pontas ("🔑 Obter chave:" → "Obter chave"). */
function lookup(dict: Record<string, string>, raw: string, split = true): string | undefined {
  const key = raw.trim();
  if (!key) return undefined;
  if (dict[key]) return raw.replace(key, dict[key]!);
  const core = /^[^\p{L}\p{N}]*(.*?)[\s:…]*$/su.exec(key)?.[1] ?? '';
  if (core && core !== key && dict[core]) return raw.replace(core, dict[core]!);
  for (const [re, by] of PATTERNS[current === 'es' ? 'es' : 'en']) if (re.test(core)) return raw.replace(core, core.replace(re, by));
  /* textos montados ("Obreiro · Roteiro, Plano de cenas"): traduz cada pedaço conhecido */
  if (split && / · |, | — /.test(key)) {
    let hit = false;
    const out = raw.split(/( · |, | — )/).map((part, i) => {
      if (i % 2) return part;
      const tr = lookup(dict, part, false);
      if (tr === undefined) return part;
      hit = true; return tr;
    }).join('');
    if (hit) return out;
  }
  return undefined;
}

/** Traduz um texto exato (fora do dicionário volta igual). */
export function t(text: string): string {
  if (current === 'pt-BR') return text;
  const d = DICTS[current];
  return (d && lookup(d, text)) ?? text;
}

const SKIP = new Set(['PRE', 'CODE', 'TEXTAREA', 'SCRIPT', 'STYLE', 'INPUT']);
const ATTRS = ['placeholder', 'title', 'aria-label', 'label'];

let busy = false;
let pending: number | undefined;
let observer: MutationObserver | undefined;

/** Traduz os textos (e atributos) exatos do DOM. Idempotente. */
export function translateDom(root: ParentNode = document.body): void {
  if (busy || (current === 'pt-BR' && !touched)) return;
  const dict = current === 'pt-BR' ? undefined : DICTS[current];
  /* o texto original (pt-BR) fica guardado: trocar en → es → pt-BR re-traduz a partir dele em vez de
     ficar preso no idioma anterior. Texto que o app trocou depois (≠ o que mostramos) vira o novo original. */
  const swap = (rec: Shown | undefined, cur: string, set: (v: string) => void, keep: (r: Shown | undefined) => void) => {
    const base = rec && cur === rec.shown ? rec.orig : cur;
    const target = dict ? (lookup(dict, base) ?? base) : base;
    if (target !== cur) set(target);
    keep(target !== base ? { orig: base, shown: target } : undefined);
    if (target !== base) touched = true;
  };
  busy = true;
  try {
    const start = root instanceof Document ? root.body : root;
    if (!start) return;
    const walker = document.createTreeWalker(start as Node, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      if (!el || SKIP.has(el.tagName) || el.closest('[data-no-i18n]')) continue;
      const n = node;
      swap(textOrig.get(n), n.nodeValue ?? '', (v) => { n.nodeValue = v; }, (r) => { if (r) textOrig.set(n, r); else textOrig.delete(n); });
    }
    const els = (start as ParentNode).querySelectorAll?.('[placeholder],[title],[aria-label],optgroup[label]') ?? [];
    for (const el of Array.from(els)) {
      const recs = attrOrig.get(el) ?? {};
      for (const attr of ATTRS) {
        const v = el.getAttribute(attr);
        if (!v) continue;
        swap(recs[attr], v, (x) => el.setAttribute(attr, x), (r) => { if (r) recs[attr] = r; else delete recs[attr]; });
      }
      attrOrig.set(el, recs);
    }
  } finally {
    busy = false;
  }
}

interface Shown { orig: string; shown: string }
const textOrig = new WeakMap<Node, Shown>();
const attrOrig = new WeakMap<Element, Record<string, Shown>>();
let touched = false;

/** Aplica agora e mantém a interface traduzida conforme ela é redesenhada. */
export function startI18n(l: Lang | undefined): void {
  setLang(l);
  translateDom(document);
  if (typeof MutationObserver === 'undefined' || observer) return;
  observer = new MutationObserver(() => {
    if (pending) return;
    pending = window.setTimeout(() => { pending = undefined; translateDom(document); }, 30);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
