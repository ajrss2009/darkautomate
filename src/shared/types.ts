/**
 * Harnesses: CLIs agênticas (claude, opencode, codex, antigravity, openclaw) e
 * deepseek = DeepSeek Harness (`dsh`) e "harnesses" HTTP locais (ollama, llama.cpp, LM Studio) — tratados como harness
 * para efeito de rota/modelo, embora tecnicamente sejam servidores de modelo.
 */
export type HarnessId = 'claude' | 'opencode' | 'codex' | 'antigravity' | 'openclaw' | 'ollama' | 'llamacpp' | 'lmstudio' | 'deepseek';

/**
 * Esforço de raciocínio do modelo. `undefined` = Default (não envia nada; o CLI/API
 * usa o próprio padrão). Nem todo modelo aceita todos os níveis — a UI só mostra o
 * seletor quando `modelSupportsEffort()` reconhece o harness/modelo.
 */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max';

/** Idioma da interface do app (as saídas dos vídeos continuam no idioma do projeto). */
export type AppLanguage = 'pt-BR' | 'en' | 'es';

export type StepKind =
  | 'ideation' | 'script' | 'scene_plan' | 'asset_design'
  | 'image' | 'video' | 'code_scene' | 'motion_graphics'
  | 'narration' | 'music' | 'sfx' | 'subtitles'
  | 'edit' | 'review' | 'thumbnail' | 'metadata' | 'publish'
  | 'stock_media' | 'transcribe'
  | 'brief'                              // orquestrador: plano criativo (brief.md) seguido por todas as etapas
  | 'free';                              // vídeo livre: o harness executa o prompt do usuário e entrega out/final.mp4

export type SceneKind = 'image' | 'video' | 'code' | 'motion' | 'mixed' | 'stock';

export type VideoTypeId =
  | 'stickman' | 'realistic' | 'anime_2d' | 'cartoon_3d' | 'pixel_art'
  | 'flat_explainer' | 'ms_paint' | 'vox_collage' | 'low_poly' | 'recon_3d'
  | 'doc_netflix' | 'whiteboard' | 'motion_graphics' | 'micro_drama' | 'ad_product'
  | 'interactive_story' | 'music_lyric' | 'vector' | 'paper_cut' | 'code_3d' | 'slideshow' | 'custom';

export type Aspect = '9:16' | '16:9' | '1:1' | '4:5';

/** harness 'auto' = primeiro instalado/alcançável; model 'auto' ou vazio = modelo padrão do harness. */
export interface HarnessBinding { type: 'harness'; harness: HarnessId | 'auto'; model?: string; effort?: ReasoningEffort }
/**
 * Bypass de executor de um projeto: o harness/modelo escolhido vai à frente (ou sozinho, se `exclusive`)
 * nas etapas do escopo, só na hora de executar — a rota gravada não muda.
 *  - text: roteiro, plano de cenas, ideias, metadados, brief, revisão…
 *  - code: cenas por código e motion graphics
 *  - ai: as duas
 */
export interface ExecutorBypass { binding: HarnessBinding; scope: 'text' | 'code' | 'ai'; exclusive: boolean; enabled: boolean }
export type StockSource = 'pexels' | 'pixabay' | 'wikipedia' | 'youtube' | 'nasa' | 'archive' | 'openverse' | 'smithsonian' | 'unsplash';
/** Banco de imagens/vídeos: busca por termos da cena e baixa os arquivos (com crédito/licença). */
export interface StockBinding { type: 'stock'; sources: StockSource[]; media: 'image' | 'video' | 'both' }
export interface ComfyBinding {
  type: 'comfyui';
  server: string;            // id do servidor em settings.comfyServers
  workflow: string;          // arquivo em workflows/ (formato API)
  refAudio?: string;         // áudio local de referência (clonagem de voz) -> {{ref_audio}}
  mapping?: Record<string, string>; // "nodeId.inputs.campo" -> variável
  outputNode?: string;
}
/** Wan2GP via API Python (shared.api). template = arquivo em workflows/ com {model_type, settings, output}. */
export interface Wan2gpBinding { type: 'wan2gp'; template: string; refAudio?: string }
export interface Wan2gpConfig { root: string; python: string; cliArgs: string[] }
export interface ApiBinding { type: 'api'; provider: string; model: string; voice?: string }
/**
 * Ferramentas internas. Novas:
 * - lyric-song: gera a canção (Yue 2) com a letra do roteiro e os tempos de cada verso (lyric video);
 * - lyric-words: grava os tempos da letra de cada cena (audio/words.json) para a cena por código;
 * - frame-thumbnail: thumbnail a partir de um quadro real do final.mp4 + texto do SEO.
 */
export type BuiltinTool = 'silence-trim' | 'subtitles' | 'assemble' | 'library-music' | 'whisper' | 'estimate-words' | 'clip-musical' | 'lyric-song' | 'lyric-words' | 'frame-thumbnail' | 'sfx-code' | 'music-code' | 'youtube-upload';
export interface BuiltinBinding { type: 'builtin'; tool: BuiltinTool }
export interface ManualBinding { type: 'manual' }
/** Google Flow no navegador de uma conta de Automações (imagem: Nano Banana; vídeo: Veo). account vazio = primeira conta com login. */
export interface FlowBinding { type: 'flow'; account?: string }
export type Binding = HarnessBinding | ComfyBinding | Wan2gpBinding | ApiBinding | StockBinding | BuiltinBinding | ManualBinding | FlowBinding;

export interface RouteStep {
  id: string;
  kind: StepKind;
  label: string;
  scope: 'project' | 'scene';
  dependsOn: string[];
  enabled: boolean;
  bindings: Binding[];                 // [primário, fallback1, fallback2...]
  params: Record<string, unknown>;
  retry: { max: number; backoffMs: number };
  timeoutSec: number;
  onlySceneKinds?: SceneKind[];        // filtro por tipo de cena
  onFail?: 'stop' | 'skip';            // padrão: stop
  optional?: boolean;                  // sem saída = ok
  gate?: 'none' | 'approve';
  concurrency?: number;
}

export interface Route {
  id: string;
  name: string;
  description: string;
  videoTypes: VideoTypeId[];
  steps: RouteStep[];
  /**
   * Reservas de harness: quando as tentativas de um harness acabam numa etapa e a cadeia dela não tem
   * outro harness, o motor tenta estes, em ordem; também vêm primeiro quando a etapa usa "auto".
   * Vazio = as reservas padrão das Configurações (Settings.harnessFallback) ou, sem elas, os harnesses
   * usados nas outras etapas da rota e, por último, os instalados (ordem do "auto").
   */
  harnessFallback?: HarnessId[];
  /**
   * Sem reserva: cada etapa usa só o primeiro executor da cadeia e, se falhar, a execução para com o erro
   * (não troca de provedor). Indefinido = segue Settings.noFallback.
   */
  noFallback?: boolean;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'stale';

export interface Scene {
  id: string;
  index: number;
  title: string;
  narration: string;
  visualIntent: string;
  durationSec?: number;
  kind: SceneKind;
  camera?: string;
  searchTerms?: string;                // termos para bancos de mídia (Pexels/Pixabay/Wikipedia)
  videoPrompt?: string;                // prompt escrito para o vídeo IA (MiniMax H3), quando a cena é um loop
  speaker?: string;                    // personagem que fala nesta cena (skills com várias vozes)
  userMedia?: string;                  // arquivo do usuário (assets/user) usado como visual desta cena
  /** trecho do vídeo do usuário a exibir: segundo inicial no arquivo (padrão 0) */
  clipStart?: number;
  /** corte do início feito no editor (cortar/dividir clip): segundos pulados no visual, na narração e nos efeitos da cena */
  trimStart?: number;
  /** recorte do vídeo do usuário (pixels da fonte) — ex.: cortar a barra de tarefas/OBS do rodapé */
  clipCrop?: { w: number; h: number; x?: number; y?: number };
  sfx?: string[];
  /** efeitos sonoros gerados por código: nome da biblioteca + instante (s) ou palavra da narração */
  sfxCues?: SfxCue[];
  overrides?: Record<string, Binding[]>; // stepId -> bindings
  notes?: string;                      // instruções de ajuste (edição por prompt)
  variation?: number;                  // incrementa ao 'regenerar' para mudar seed/cache
  manualDuration?: boolean;            // duração definida pelo usuário (ignora a do áudio)
  subtitle?: string;                   // texto da legenda (vazio = usa a narração)
  effects?: SceneEffects;              // efeitos aplicados na montagem e na prévia
  status: Record<string, StepStatus>;
  artifacts: Record<string, string[]>;
}

/**
 * Arquivo anexado pelo usuário. `use`: scene = a IA põe numa cena (imagem/vídeo); reference = só inspira roteiro e visual
 * (textos entram no prompt); music = trilha sonora; character = foto do personagem (retrato do elenco no MiniMax H3).
 */
export type AttachmentKind = 'image' | 'video' | 'audio' | 'text' | 'other';
export interface Attachment {
  file: string;                        // caminho relativo a assets/user (com subpastas de uma pasta anexada)
  kind: AttachmentKind;
  use: 'scene' | 'reference' | 'music' | 'character';
  character?: string;                  // use = character: nome do personagem
  note?: string;                       // o que é / como usar (vai no prompt)
}

export type FxFilter = 'none' | 'bw' | 'sepia' | 'vivid' | 'warm' | 'cool' | 'blur' | 'cinematic' | 'teal_orange' | 'vintage' | 'noir' | 'matte' | 'dramatic';
export type FxVignette = 'none' | 'soft' | 'strong';
/** Movimento de câmera na cena: zoom, panorâmicas e zoom com deslocamento. */
export type FxMove = 'none' | 'in' | 'out' | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down' | 'in_left' | 'in_right';
/** Transições do ffmpeg xfade (da cena para a próxima). */
export type FxTransition = 'none' | 'fade' | 'fadeblack' | 'fadewhite' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideleft' | 'slideup' | 'circleopen' | 'circleclose' | 'radial' | 'pixelize' | 'zoomin' | 'hblur';
export interface SceneEffects {
  filter?: FxFilter;
  zoom?: FxMove;                       // Ken Burns e panorâmicas
  fadeIn?: boolean; fadeOut?: boolean;
  vignette?: FxVignette;               // escurece as bordas da cena
  transition?: FxTransition;           // transição desta cena para a PRÓXIMA
  transitionSec?: number;              // duração da transição (0,2–2 s)
}
/** Efeito sonoro numa cena: `at` em segundos desde o início da cena, ou `word` = toca quando a palavra é falada. */
/** Termos de busca vindos da IA (texto ou lista) → texto. */
export const termsText = (v: unknown): string => (Array.isArray(v) ? v.map(String).join(' ') : typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();

export interface SfxCue { name: string; at?: number; word?: string; gain?: number }

/** Acabamento do vídeo final inteiro (aplicado depois da montagem). */
export interface FinalEffects { filter?: FxFilter; vignette?: FxVignette; grain?: boolean; letterbox?: boolean }
/**
 * Trecho de efeito na timeline (estilo CapCut): filtro ou vinheta de `start` a `end`
 * segundos do vídeo, independente das cenas. `toEnd` = vai até o fim do vídeo.
 */
export interface FxSegment { id: string; kind: 'filter' | 'vignette'; value: string; start: number; end: number; toEnd?: boolean; /** camada (0 = base); camadas de cima empilham por cima */ layer?: number }
/**
 * Tipo da legenda: classic (contorno), box (tarja escura), bold (caixa alta, palavra falada em destaque, estilo shorts),
 * karaoke (a cor preenche cada palavra no tempo da fala), word (uma palavra por vez, grande, com pop), neon (brilho
 * colorido), minimal (pequena, só sombra). Ausente = classic ou box conforme `box`.
 */
export type SubtitleKind = 'classic' | 'box' | 'bold' | 'karaoke' | 'word' | 'neon' | 'minimal';
export interface SubtitleStyle { burn: boolean; position: 'bottom' | 'middle' | 'top'; size: number; color: string; box: boolean; kind?: SubtitleKind; /** cor de destaque (bold/karaoke/neon) */ accent?: string }
/** Fontes que uma skill mista pode mesclar: motion graphics/código, bancos de mídia e vídeo/imagem por IA (MiniMax etc.). */
export type MixSource = 'motion' | 'stock' | 'ai';

/** Agente: orquestrador (escreve o brief e coordena) ou obreiro (executa as etapas que assume). */
export interface Agent {
  id: string; name: string; role: 'orchestrator' | 'worker'; description: string; instructions: string;
  harness?: HarnessId | 'auto'; model?: string; effort?: ReasoningEffort;
  handles?: string[];                  // obreiro: tipos (kind) ou ids de etapa que assume
  skills?: string[];                   // skills para as quais é sugerido
  /** ícone (emoji) mostrado nos cartões da equipe */
  icon?: string;
  builtin?: boolean;
}

/** Skill: instruções do usuário para cada atividade da rota. Chaves de `steps`: id da etapa ou tipo (kind). */
export interface Skill {
  id: string; name: string; description: string; global: string; steps: Record<string, string>; builtin?: boolean;
  /** Tipo de vídeo = skill: aparência, rota sugerida e padrões do projeto. */
  appearance?: VideoTypeId; routeId?: string; aspect?: Aspect; durationSec?: number; language?: string;
  presentation?: 'generated' | 'mixed'; mediaSources?: StockSource[];
  /** Texto mostrado ao escolher a skill: como será o vídeo de saída. */
  outputStyle?: string;
  /** Apresentação mista: o que a skill mescla. */
  mixSources?: MixSource[];
  /** Vídeo, GIF ou imagem de exemplo (dentro do workspace). */
  previewMedia?: string;
  /** template de thumbnail padrão dos projetos criados com a skill (id) */
  thumbnailTemplate?: string;
  /** Sem cenas nem narração: o prompt vai direto ao harness (rota vídeo livre). */
  freeform?: boolean;
  /** Cenas por código em Three.js com a biblioteca local "cartoon3d" (personagens 2D em mundo 3D, contorno a tinta). */
  codeKit?: 'cartoon3d';
  /** link na ideia: o app abre a página num navegador invisível, lê o conteúdo e grava a rolagem (anexos em web/) antes da rota */
  linkCapture?: boolean;
  /**
   * Como o roteiro termina: loop (emenda no início — shorts), next (resumo + gancho
   * para o próximo vídeo), conclusion (conclusão + chamada curta). Vazio = conclusion.
   */
  scriptEnding?: ScriptEnding;
  /** Diálogo com várias vozes: cada cena tem um `speaker` e o projeto define o elenco (voz por personagem). */
  multiVoice?: boolean;
  /** Critérios da etapa de revisão (review) para esta skill. */
  reviewCriteria?: string;
  /** plugins (formato Claude) que toda produção com esta skill usa — ex.: skill importada de um SKILL.md */
  plugins?: string[];
}
export type ScriptEnding = 'loop' | 'next' | 'conclusion';

/** Personagem do elenco e a voz que o representa (voz de referência do OmniVoice ou voz da API). */
export interface CastMember { speaker: string; refAudio?: string; voice?: string; description?: string }

/**
 * Perfil de executores: separa a ROTA (o que fazer) de QUEM executa. Cada categoria
 * troca o executor principal das etapas daquele tipo; os executores da rota ficam
 * como fallback. Categoria vazia = mantém o que a rota define.
 */
export type ExecutorCategory = 'text' | 'code' | 'image' | 'video' | 'voice' | 'music';
export interface ExecutorProfile {
  id: string; name: string; description?: string; builtin?: boolean;
  /** "chain" = cadeia completa; o 1º é o principal. */
  chains: Partial<Record<ExecutorCategory, Binding[]>>;
}
/** Tipo de vídeo personalizado = rota + skill (+ aparência, apresentação e fontes de mídia). */
export interface CustomVideoType {
  id: string; name: string; description?: string; routeId: string; skillId: string;
  appearance: VideoTypeId; presentation: 'generated' | 'mixed'; mediaSources: StockSource[];
  aspect?: Aspect; durationSec?: number; language?: string; builtin?: boolean;
}
export interface ProductionRun { startedAt: string; endedAt: string; ms: number; ok: boolean }

/**
 * Dobra de nicho: transplante de uma estrutura de vídeo comprovada para outro nicho.
 * Entidade persistente (workspace/library/folds), ligada a um canal (channelKey), a uma
 * skill/rota e aos projetos que a usaram — para permitir escolher, comparar e aposentar.
 */
export type FoldStatus = 'idea' | 'testing' | 'scaling' | 'retired';
export interface NicheFold {
  id: string;
  /** título da dobra (usado como `name` na biblioteca) */
  name: string;
  /** canal dono da dobra (slug do nome da marca) */
  channel: string;
  channelName?: string;
  /** canal de origem do formato clonado */
  sourceChannel?: string;
  sourceUrl?: string;
  /** o que muda no assunto mantendo o formato */
  angle: string;
  why?: string;
  audience?: string;
  exampleTitles?: string[];
  language?: string;
  aspect?: Aspect;
  skillId?: string;
  routeId?: string;
  /** dobra ativa do canal (uma por canal) */
  chosen?: boolean;
  status: FoldStatus;
  /** modelagem do formato clonado (o que replicar): estilo do texto, visual, áudio e trilha */
  model?: { format?: string; text?: string; visual?: string; audio?: string; soundtrack?: string };
  /** outros subnichos sugeridos para explorar (além desta dobra) — evita a cópia do canal de origem */
  subniches?: string[];
  createdAt: string;
  updatedAt?: string;
  notes?: string;
  /** agregado calculado na leitura (não é fonte de verdade) */
  metrics?: { projects: number; lastUsedAt?: string; renders?: number };
}


/**
 * Plugin no formato do Claude Code: pasta com `.claude-plugin/plugin.json` e,
 * opcionalmente, skills/, commands/, agents/, hooks/, .mcp.json.
 */
export interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  version?: string;
  dir: string;
  source?: string;                     // pasta de origem ou URL do GitHub
  /** LLM indicada pelo plugin (plugin.json → filmforge.recommendedExecutor) para certas etapas */
  recommended?: { label?: string; kinds: string[]; bindings: Binding[] };
  /** adaptação ao FilmForge (filmforge-adapt.json): o que entra em cada etapa */
  adaptation?: { summary: string; by: string; createdAt: string; steps: Record<string, string[]>; ignore: string[] };
  installedAt?: string;
  skills?: string[];
  commands?: string[];
  agents?: string[];
  mcp?: string[];
  hasHooks?: boolean;
  /** skills, comandos e agentes com a descrição do front-matter (para a interface); skills trazem os arquivos de apoio */
  items?: Array<{ kind: 'skill' | 'command' | 'agent'; name: string; description?: string; files?: string[]; image?: string }>;
  /** imagem que representa o plugin (galeria, estilo ou skill; senão uma capa gerada pelo app) */
  cover?: string;
  displayName?: string; author?: string; license?: string; keywords?: string[];
  /** imagens de exemplo (pasta _gallery, vindas do repositório) e trecho do README */
  gallery?: string[]; readme?: string; examples?: string[];
  /** dependências de runtime declaradas pelas skills (só para o render próprio delas; o FilmForge não precisa) */
  requires?: string[];
  /** repositório de recursos convertido para o formato Claude (ex.: coleção de prompts de estilo) */
  adapted?: boolean;
  homepage?: string;
  /** estilos visuais que o plugin oferece (um por skill), com capa e trilha sugerida */
  styles?: PluginStyle[];
  /** recursos que o FilmForge usa diretamente (ex.: mgaudio = música e efeitos por código) */
  resources?: Array<{ id: string; label: string; path: string; ready?: boolean }>;
  /** motor de animação próprio do plugin (kit): o FilmForge renderiza as cenas com ele */
  kit?: { kind: 'player' | 'piece' | 'pages' | 'node-film'; styles: string[]; examples: number; needsLibrary?: boolean; repo?: string };
  /** prévia de 2–3 s renderizada pelo motor do plugin (_gallery/preview.mp4) */
  preview?: string;
}

/**
 * Adaptação de um plugin do Claude ao FilmForge (gravada em <plugin>/filmforge-adapt.json):
 * cada skill/comando/agente/arquivo entra SÓ nas etapas em que serve, com a tradução do formato
 * de saída para o arquivo que a etapa grava e a lista do que não roda aqui.
 */
export interface PluginAdaptation {
  version: 1;
  createdAt: string;
  /** quem adaptou: "heurística" ou "harness/modelo" */
  by: string;
  summary: string;
  /** regra curta que vale em todas as etapas em que o plugin entra */
  global?: string;
  /** id = "skill:<nome>", "command:<nome>", "agent:<nome>" ou "file:<caminho relativo à raiz do plugin>" */
  items: Array<{ id: string; steps: string[]; note?: string }>;
  /** etapa → como transformar a saída do plugin no arquivo que a etapa grava */
  outputs?: Record<string, string>;
  /** o que não roda no FilmForge (scripts, MCP, hooks, perguntas ao usuário…) */
  ignore: string[];
  recommended?: { label?: string; kinds: string[]; bindings: Binding[] };
}
export interface PluginStyle {
  id: string; name: string; film?: string; summary?: string; skill: string;
  cover?: string; video?: string; videoUrl?: string;
  /** receita do mgaudio sugerida para a trilha deste estilo e paleta de efeitos */
  music?: string; sfx?: string;
}

/** Parâmetros efetivos usados na execução (gravados no projeto). */
export interface RunParams {
  routeId?: string;
  routeName?: string;
  skillId?: string;
  quality?: string;
  aspect?: string;
  targetDurationSec?: number;
  language?: string;
  sceneConcurrency?: number;
  maxProductionMin?: number;
  /** executores por etapa, como estavam na hora */
  steps?: Array<{ id: string; kind: string; scope: string; binding: string }>;
  /** plugins ativos nesta execução */
  plugins?: string[];
  /** bypass de executor ativo nesta execução */
  executorBypass?: ExecutorBypass;
}

export interface Project {
  id: string;
  name: string;
  idea: string;
  videoType: VideoTypeId;
  aspect: Aspect;
  targetDurationSec: number;
  language: string;
  routeId: string;
  route?: Route;                       // cópia congelada
  quality: 'standard' | 'depth' | 'polished' | 'verified' | 'ultra';
  memories: string[];
  scenes: Scene[];
  createdAt: string;
  typeId?: string;                     // (legado) tipo de vídeo personalizado usado
  skillId?: string;                    // skill escolhida (= tipo de vídeo)
  scriptStyle?: string;                // estilo de roteiro (opcional, definido pelo usuário)
  videoStyle?: string;                 // estilo de vídeo (opcional, definido pelo usuário)
  musicStyle?: string;
  musicMode?: 'instrumental' | 'song';
  /** trilha sonora sintetizada por código (sem IA, offline, na duração exata do vídeo) em qualquer rota */
  codeMusic?: boolean;
  /** arquivos do usuário (imagens, vídeos, áudios, textos) copiados para assets/user e usados no prompt e na produção */
  attachments?: Attachment[];
  waveform?: 'line' | 'bar' | 'p2p' | 'cline' | 'dot'; // waveform sobreposta no clipe
  /** coletânea musical: duração total mínima e máxima (minutos) e duração de cada faixa (s) */
  musicMinMin?: number;
  musicMaxMin?: number;
  musicTrackSec?: number;
  refScript?: { file: string; textFile?: string; transcribed?: boolean; note?: string;  // roteiro de referência (texto ou transcrição)
    /** true = é O roteiro do vídeo (a etapa de roteiro usa o texto como está); false/ausente = só modelo de estilo */
    useAsScript?: boolean };
  refVideo?: { file: string; frames: string[]; durationSec?: number; note?: string }; // vídeo de referência + quadros-chave
  maxProductionMin?: number;           // tempo máximo de UMA execução (0/vazio = sem limite)
  sceneConcurrency?: number;           // cenas processadas ao mesmo tempo (pipeline por cena)
  /** narração + transcrição de todas as cenas antes dos clipes (ausente = padrão das Configurações, ligado) */
  audioFirst?: boolean;
  /** duração média desejada de cada cena no plano de cenas (s); vence o padrão da skill/rota */
  sceneSec?: number;
  /** bypass de executor: força um harness/modelo nas etapas de IA deste projeto, sem mexer na rota (liga/desliga) */
  executorBypass?: ExecutorBypass;
  /** legendas da fala: 'off' = não gera; 'srt' = só o arquivo .srt; 'burn' = gravadas no vídeo (ausente = projetos antigos: .srt + subtitleStyle.burn) */
  subtitles?: 'off' | 'srt' | 'burn';
  /** vídeo livre: '2d' = Canvas 2D (+ bibliotecas dos plugins); '3d' = cena Three.js (vem com o app). Ausente = 2D, ou 3D se a ideia pede "3D"/"Three.js" */
  freeEngine?: '2d' | '3d';
  agents?: { orchestrator?: Agent; workers: Agent[] };
  /** plugins (formato Claude) aplicados ao prompt das etapas */
  plugins?: string[];
  /** estilo escolhido em cada plugin que oferece estilos (pluginId → styleId) */
  pluginStyles?: Record<string, string>;
  /** conta (Automações) cuja sessão do Antigravity este projeto usa; vazio = a conta padrão de Automações */
  agyAccount?: string;
  /** conta (Automações) do Google Flow deste projeto; vazio = a da etapa da rota ou a primeira com login */
  flowAccount?: string;
  /** canal (aba Canais) de destino deste vídeo; vazio = pergunta na hora de publicar */
  channelId?: string;
  /** voz da narração escolhida NESTE projeto (vence a da rota): arquivo da pasta voices (OmniVoice/Wan2GP) e/ou voz de API */
  narrationVoice?: { refAudio?: string; apiVoice?: string };
  subtitleStyle?: SubtitleStyle;
  /** filtro/vinheta/grão/letterbox do vídeo final inteiro */
  finalEffects?: FinalEffects;
  /** trechos de filtro e vinheta na timeline (arrastáveis) */
  fxSegments?: FxSegment[];
  /** volume da trilha (0 = mudo, 1 = 100%); vazio = o da rota */
  musicVolume?: number;
  /** volume dos efeitos sonoros (0–1,5); vazio = 0,15 (15%) */
  sfxVolume?: number;
  /** volume da narração (0–2); vazio = 1 (100%) */
  narrationVolume?: number;
  /** elenco (skills com várias vozes): personagem → voz */
  cast?: CastMember[];
  /** perfil de executores aplicado na criação (id) */
  executorProfile?: string;
  /** rodadas de correção automática já feitas pela qualidade "ultra" */
  autoFixRounds?: number;
  skill?: Skill;                       // cópia congelada da skill
  presentation?: 'generated' | 'mixed';
  mediaSources?: StockSource[];
  thumbnailTemplate?: string;          // id do template de thumbnail
  production?: { totalMs: number; runs: ProductionRun[] };
  /** variação criada a partir de outro projeto (Derivar) */
  derivedFrom?: { id: string; name: string; keep: 'idea' | 'script'; at: string };
  /** dobra de nicho usada por este projeto (id em library/folds) + cópia congelada */
  foldId?: string;
  fold?: { id: string; name: string; channel: string; angle?: string };
  /** estrutura de título de um canal/vídeo de referência (sugestões de título) + o título escolhido */
  titleModel?: { source: string; pattern: string; chosen?: string; thumbText?: string };
  /** Parâmetros efetivos da última execução (rota, qualidade, concorrência, executores…). */
  params?: RunParams;
  /** Log das execuções (mais recente no fim), para consultar depois de reiniciar o app. */
  log?: string[];
  firstFrame?: string;                 // caminho do primeiro frame (jpg)
}

export interface HarnessConfig {
  command: string;                     // CLI ou Base URL (http://…)
  args: string[];                      // tokens: {prompt} {model} {effort}
  promptVia: 'arg' | 'stdin';
  defaultModel?: string;
  /** Esforço padrão do provedor; o binding da etapa pode sobrescrever. */
  effort?: ReasoningEffort;
  models: string[];
  /** API HTTP: `ollama` (/api/chat) ou `openai` (/v1/chat/completions — llama.cpp, LM Studio). */
  protocol?: 'ollama' | 'openai';
  /** API HTTP OpenAI-compatível na nuvem: enviada como "Authorization: Bearer". Vazia nos servidores locais. */
  apiKey?: string;
  /** CLIs: variáveis de ambiente do processo (ex.: DSH_PERMISSION_MODE do DeepSeek Harness). */
  env?: Record<string, string>;
  /** Ferramentas locais (arquivos, internet, busca, REST, shell) nos harnesses HTTP. */
  tools?: boolean;
  /** Ollama: janela de contexto (tokens). Vazio: ajustada ao tamanho do pedido (24k–48k). */
  numCtx?: number;
  /** Ollama: deixa o modelo "pensar" antes de responder (qwen3, gemma, deepseek-r1). Padrão: desligado. */
  think?: boolean;
  note?: string;
}
export interface ComfyServer { id: string; url: string; token?: string; freeAfter?: boolean }
export type ApiCategory = 'text' | 'voice' | 'image' | 'video' | 'music';
/**
 * kind: openai = compatível com OpenAI; gemini = Google (imagem/texto);
 * seedance = BytePlus ModelArk (vídeo, não verificado); snapgen = Snapgen.AI
 * (imagem/vídeo via x-api-key, com saldo em /uapi/v1/account);
 * fish = Fish Audio (voz: POST /v1/tts, header `model`, `reference_id` = id da voz).
 */
export interface ProviderConfig {
  id: string; kind: 'openai' | 'gemini' | 'seedance' | 'snapgen' | 'fish'; baseUrl: string; apiKey: string; models: string[];
  /** Categoria de cada modelo carregado (separa imagem/vídeo nas abas e nas rotas). */
  modelCategories?: Record<string, ApiCategory>;
  categories?: ApiCategory[]; voices?: string[];
  /** Nome amigável de cada voz (ex.: Fish Audio: reference_id → título do modelo de voz). */
  voiceLabels?: Record<string, string>;
}
export interface StockConfig {
  apiKey?: string; baseUrl?: string; /** contato (site ou e-mail) no User-Agent — o Wikimedia exige para baixar vídeos */ contact?: string;
  /** YouTube: duração do trecho capturado (2–4 s) e filtros de captura */
  clipSeconds?: number; ccOnly?: boolean; noSubtitles?: boolean; noWatermark?: boolean; noTransitions?: boolean;
}
export interface WhisperConfig { python: string; model: string; device: string; autoInstall?: boolean }
export interface ThumbnailTemplate { id: string; name: string; prompt: string; layout?: 'impacto' | 'explicativo' | 'documentario' | 'minimal' | 'split'; preview?: string }

export interface Settings {
  workspace: string;
  ffmpeg: string;
  ffprobe: string;
  harnesses: Record<HarnessId, HarnessConfig>;
  /**
   * Reservas padrão de harness (Configurações → Provedores): ordem de quem assume quando o harness da
   * etapa falha e de quem o "auto" escolhe. A rota/projeto pode ter a sua (Route.harnessFallback), que vem antes.
   */
  harnessFallback?: HarnessId[];
  /** Sem reserva por padrão: a etapa falha com o erro do provedor em vez de passar a outro (para depurar, ex.: Ollama). */
  noFallback?: boolean;
  /** Tentativas mínimas de cada modelo (harness/API) numa etapa, mesmo se a rota pede 1 (padrão 2). */
  stepAttempts?: number;
  /** Lote: quantas vezes refazer, no fim da fila, os projetos que falharam (retomando do cache; padrão 1). */
  batchRetries?: number;
  comfyServers: ComfyServer[];
  wan2gp?: Wan2gpConfig;
  wan2gpModels?: Array<{ kind: 'image' | 'video' | 'voice' | 'music'; model: string }>;
  defaults?: {
    imageWorkflow?: string; videoWorkflow?: string;
    /** quantas cenas processar ao mesmo tempo por padrão (1–8). Etapas de GPU local continuam uma por vez. */
    sceneConcurrency?: number;
    /** tempo máximo de produção sugerido no Novo projeto, em minutos (0 = sem limite; ausente = 60) */
    maxProductionMin?: number;
    /** narrar todas as cenas antes dos clipes (ausente = ligado) */
    audioFirst?: boolean;
    /** legendas no Novo projeto (ausente = 'off') */
    subtitles?: 'off' | 'srt' | 'burn';
  };
  stock?: Partial<Record<StockSource, StockConfig>>;
  whisper?: WhisperConfig;
  thumbnails?: ThumbnailTemplate[];
  providers: ProviderConfig[];
  memories: string[];
  projectsDir?: string;                // pasta dos projetos (vazio = <workspace>/projects)
  theme?: 'dark' | 'light';
  /** idioma da interface (pt-BR, en, es). O idioma dos vídeos é por projeto. */
  uiLanguage?: AppLanguage;
  /** pasta dos plugins (vazio = <workspace>/plugins) */
  pluginsDir?: string;
  /** plugins que vêm com o app e já foram instalados uma vez (se o usuário remover, não voltam) */
  seededPlugins?: string[];
  /** perfis de executores do usuário (os padrão vêm do app) */
  executorProfiles?: ExecutorProfile[];
  /** Automações: contas Google (navegador próprio por conta), Flow e Antigravity por conta */
  automations?: AutomationsConfig;
  /** Canais: identidade de publicação (YouTube/TikTok/Instagram/Facebook) que você gerencia */
  channels?: Channel[];
}

/** Onde o canal publica. O YouTube é o único com adaptador pronto; os demais usam o mesmo modelo. */
export type ChannelPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

/** Marca do canal (mesmo formato que a clonagem pede à IA). */
export interface ChannelBrand {
  names?: string[]; handle?: string; tagline?: string; description?: string; keywords?: string[];
  colors?: string[]; fonts?: string; logoIdea?: string; bannerPrompt?: string; avatarPrompt?: string; tone?: string;
}

/** Canal que VOCÊ gerencia: a sessão vem de uma conta de Automações; a marca é gerada por IA. */
export interface Channel {
  /** 'ch1', 'ch2'… (mesmo esquema de g1..g20 das contas) */
  id: string;
  name: string;
  platform: ChannelPlatform;
  /** conta de Automações que dá a sessão de navegador (GoogleAccount.id) */
  accountId?: string;
  handle?: string;
  /** endereço do canal, quando ele já existe na plataforma */
  url?: string;
  brand?: ChannelBrand;
  /** arquivos gerados, relativos a workspace/channels/mine/<id>/ */
  assets?: { banner?: string; avatar?: string; thumb?: string };
  createdAt: string;
  lastPublishAt?: string;
}

/** Publicação registrada em out/publish.json (um item por plataforma/canal). */
export interface PublishRecord {
  platform: ChannelPlatform;
  /** canal do app (ausente em publicações feitas antes dos canais existirem) */
  channelId?: string;
  account?: string;
  visibility?: 'UNLISTED' | 'PRIVATE' | 'PUBLIC';
  title?: string;
  url?: string | null;
  studioUrl?: string;
  at: string;
}

/** Conta Google usada nas automações. O login é feito pelo usuário na página do Google; o app não guarda senha. */
export interface GoogleAccount { id: string; label: string; email?: string; createdAt: string; lastOpened?: string;
  /** últimos créditos lidos na página do Flow (só leitura) */
  credits?: { value?: number; text: string; at: string } }
export interface AutomationsConfig {
  /** navegador Chromium (vazio = detecta: Chromium do Playwright → Chrome → Edge) */
  browserPath?: string;
  /** pasta da extensão (descompactada) carregada no navegador das contas */
  extensionDir?: string;
  /** endereço do Flow (padrão: https://labs.google/fx/tools/flow) */
  flowUrl?: string;
  accounts: GoogleAccount[];
  /** conta cuja sessão do Antigravity CLI as rotas usam (vazio = a sessão normal do Windows) */
  agyAccount?: string;
  /** conta Google usada para enviar ao YouTube (vazio = a primeira com login) */
  youtubeAccount?: string;
}

export type EngineEvent =
  | { t: 'run.start'; projectId: string }
  | { t: 'step.queued'; stepId: string; sceneId?: string }
  | { t: 'step.start'; stepId: string; sceneId?: string; binding: string }
  | { t: 'step.cache_hit'; stepId: string; sceneId?: string }
  | { t: 'step.attempt'; stepId: string; sceneId?: string; binding: string; attempt: number }
  | { t: 'step.fallback'; stepId: string; sceneId?: string; from: string; to: string; reason: string }
  | { t: 'step.done'; stepId: string; sceneId?: string; binding: string; files: string[] }
  | { t: 'step.failed'; stepId: string; sceneId?: string; reason: string }
  | { t: 'step.skipped'; stepId: string; sceneId?: string; reason: string }
  | { t: 'gate.waiting'; stepId: string; sceneId?: string }
  | { t: 'log'; stepId?: string; sceneId?: string; line: string }
  /** progresso: por cenas (projeto com cenas) ou por entregáveis (projeto sem cenas). */
  | { t: 'run.progress'; mode?: 'scenes' | 'deliverables'; done: number; total: number; etaMs: number; elapsedMs: number; label?: string }
  /** pré-checagem ao iniciar: harness/modelo que cada etapa vai usar. */
  | { t: 'run.preflight'; steps: Array<{ id: string; kind: string; label: string; binding: string; harness?: string; model?: string; ok?: boolean; note?: string }>; plugins?: string[] }
  | { t: 'run.done'; ok: boolean; error?: string }
  | { t: 'batch.update'; total: number; done: number; failed: number; running: string[]; finished: boolean };

export const bindingLabel = (b: Binding): string => {
  switch (b.type) {
    case 'harness': return `harness:${b.harness}${b.model ? '/' + b.model : ''}${b.effort ? '@' + b.effort : ''}`;
    case 'comfyui': return `comfyui:${b.server}/${b.workflow}`;
    case 'wan2gp': return `wan2gp:${b.template}`;
    case 'api': return `api:${b.provider}/${b.model}`;
    case 'stock': return `stock:${b.sources.join('+')}`;
    case 'builtin': return `builtin:${b.tool}`;
    case 'manual': return 'manual';
    case 'flow': return `flow:${b.account || 'padrão'}`;
  }
};
