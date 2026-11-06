# FilmForge — Especificação Técnica e Funcional

> Estúdio desktop (Electron + TypeScript) de produção de vídeo por IA, orientado a **cenas** e a **rotas configuráveis**.
> Cada etapa da produção pode ser executada por um **harness de agente** (Claude Code, OpenCode, Codex, Antigravity, OpenClaw), por uma **API comercial**, por um **modelo local via ComfyUI API** ou via **Wan2GP (API Python)**, com **fallback em cadeia**.

Versão do documento: 1.6 · Data: 2026-10-26

> **Changelog 1.6:** **executor por etapa** na criação do projeto (funções planejamento/execução/revisão e *Balancear*) e no **Editor → 🎛 Executores** (harness, modelo e esforço por etapa; *Salvar e refazer* as alteradas e dependentes; executor por cena no *Regerar*); reservas de harness da rota e pulo de API sem chave; prompt longo por arquivo (fim do `ENAMETOOLONG`); janela de contexto do Ollama; **plugins com motor próprio** (`player`, `pages`, `node-film`, `piece`); aba **Pesquisar**; uso e contas por projeto; WAV de efeitos atômico (§18).

> **Changelog 1.5:** **esforço de raciocínio** implementado de ponta a ponta — seletor *Default/Low/High/Max* por harness (padrão do provedor) e por tarefa (§4.7), mapeado para `--effort` (Claude Code, Antigravity), `-c model_reasoning_effort=` (Codex) e `reasoning_effort` (harnesses HTTP OpenAI-compatíveis); **ícones nas sub-abas de Configurações** (§17.7); **Snapgen.AI** como provedor de imagem e vídeo (`x-api-key`, saldo de créditos, catálogo `/api/service-prices` com modelos separados por aba; §5.5).
>
> **Changelog 1.1:** auditoria de paridade com o Creatorize (página Skool, transcrição e prints de updates da comunidade). Novidades: tipo `doc_netflix`, parâmetro `effort` nos harnesses, §7.6 (adições), §14 (matriz de paridade) e marcos M1–M4 atualizados.

> **Changelog 1.4:** biblioteca de rotas editável (CRUD de rotas e tarefas, harness/modelo `auto`, provedor + tipo de modelo por tarefa), **Skills**, **tipos de vídeo = rota + skill**, aparências (`vector`, `paper_cut`, `code_3d`), apresentação mista com bancos de mídia (Pexels, Pixabay, Wikipedia), idioma do vídeo, sincronização por Whisper, thumbnail por template, SEO, tempo de produção, primeiro frame, harness Ollama, APIs Gemini e Seedance e nova aba **Configurações** (§17).
> **Changelog 1.3:** binding `wan2gp` (imagem, vídeo, narração, música) como alternativa ao ComfyUI; workflows MiniMax H3 (vídeo) e YuE2 (música); etapa `music` geradora; validação de variáveis e de formato de workflow (§5.1–5.1b, §16).
> **Changelog 1.2:** editor de cenas estilo CapCut, edição por prompt, CRUD de projetos/cenas, lote, `notes`/`variation`/`manualDuration`/`stale`, workflows Krea 2, Z-Image e OmniVoice (§3.2, §9, §15).

---

## 0. Origem das ideias e nota de licença

FilmForge é um projeto **original**, que mescla conceitos de duas fontes:

| Fonte | O que foi aproveitado (conceito, não código) |
|---|---|
| **Creatorize** (transcrição do vídeo, página Skool *Creatorize: AI Video Mastery* e prints de updates/wins da comunidade) | Fluxo guiado ideação → roteiro → voz → cenas → música/SFX → render → upload; estilos de vídeo (pixel art, vox collage, flat explainer, MS Paint, reconstrução 3D, low poly, 3D cartoon shorts); biblioteca de assets reutilizáveis; memórias (erros a não repetir); níveis de build (standard / mais profundidade / polido / verificado / ultra); remoção de silêncios; ducking de música; biblioteca de SFX local; análise de canal para sugerir ideias; **Routines** (nós encadeados + agendamento, execução 100 % autônoma); painel de analytics/retenção; thumbnails com API de imagem; aprovação antes de publicar; custo por vídeo via assinatura de harness em vez de API. |
| **DramaClaw** (github.com/dramaclaw/dramaclaw) | Pipeline em 4 fases **Ingest → Plan → Produce → Deliver**; tarefas assíncronas independentes com *resume-from-checkpoint*; **Task Center** (status, logs, cancelar/repetir, validação de pré-requisitos); biblioteca de assets com identidade consistente (personagens, cenas, props, vozes) e variantes; *style wall* e extração de estilo a partir de imagem de referência; storyboard + primeiro frame por beat; canvas de nós infinito em paralelo ao pipeline linear ("dual-track"); agente que conhece o projeto (Director) e expõe servidor MCP loopback; skills/receitas de workflow instaláveis; gateway neutro de modelos; modos Oficial / Custom / Híbrido (local + comercial); exportação com legendas SRT e *asset pack*; estado em SQLite/arquivos sem Postgres/Redis. |

**Licença:** o DramaClaw usa Elastic License 2.0. FilmForge **não copia código nem assets** dele; apenas reimplementa conceitos públicos de produto. Se no futuro for reutilizado código do DramaClaw, é preciso respeitar a ELv2 (aviso "Powered by DramaClaw", proibição de oferecer como serviço hospedado).

---

## 1. Visão geral

### 1.1 Objetivos
1. Transformar uma **ideia, roteiro ou manuscrito** em vídeo finalizado (curto vertical, longo horizontal, anúncio, série dramática, explicativo, etc.).
2. Permitir que o usuário **desenhe a própria linha de produção** (rotas) e escolha, **por etapa**, qual harness/modelo executa e qual o fallback.
3. Rodar **100 % local** (ComfyUI + TTS local + ffmpeg), **100 % comercial** ou **híbrido**.
4. Ser **orientado a cenas**: a cena é a unidade de planejamento, geração, cache, revisão, re-execução e custo.
5. Operar em **piloto automático** (rotinas agendadas) com aprovação opcional antes de publicar.

### 1.2 Não-objetivos (v1)
- Não é um editor não-linear completo (timeline fina manual é v2).
- Não hospeda como SaaS.
- Não treina modelos.

### 1.3 Personas
- **Criador faceless** de Shorts/TikTok que quer volume diário.
- **Estúdio indie** de microdramas/animes.
- **Agência** de anúncios/product videos.
- **Tinkerer** com GPU local e ComfyUI.

---

## 2. Arquitetura

```
┌────────────────────────── Electron ───────────────────────────┐
│ Renderer (UI, TS)  ◄── contextBridge/IPC ──►  Main (Node, TS) │
│  Projetos · Rotas · Cenas · Fila · Biblioteca · Config        │
└───────────────────────────────┬───────────────────────────────┘
                                │
        ┌───────────────────────┼─────────────────────────┐
        ▼                       ▼                         ▼
  Route Engine            Executors                 Persistência
  (DAG por cena,   ┌──────────┴──────────┐     (JSON/SQLite + pastas
   fallback, retry,│ HarnessExecutor     │      por projeto, cache
   checkpoint)     │ ComfyUIExecutor     │      content-addressed)
                   │ ApiExecutor (HTTP)  │
                   │ CodeSceneExecutor   │
                   │ FfmpegExecutor      │
                   └─────────────────────┘
```

### 2.1 Processos
- **Main**: ciclo de vida, filesystem, spawn de CLIs, HTTP/WebSocket com ComfyUI e APIs, ffmpeg, agendador, cofre de segredos (`safeStorage`).
- **Preload**: expõe API tipada mínima (`window.forge`) via `contextBridge`; `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` no renderer.
- **Renderer**: UI em TypeScript. v1 usa DOM puro + CSS; migração para React é opcional.

### 2.2 Stack
Electron ≥ 33 · TypeScript ≥ 5.6 · esbuild (bundle) · electron-builder (executável) · ffmpeg/ffprobe (embutido via `ffmpeg-static` ou do sistema) · `ws` (WebSocket ComfyUI) · Zod (validação opcional) · SQLite (`better-sqlite3`, v1.1; v1 usa JSON + arquivos).

### 2.3 Layout de dados (por projeto)
```
<workspace>/projects/<id>/
  project.json            # metadados, tipo de vídeo, rota escolhida
  route.json              # rota efetiva (cópia congelada)
  script.md               # roteiro
  scenes.json             # lista de cenas (fonte da verdade)
  scenes/<sceneId>/
      scene.json  prompt.md
      frames/ clips/ audio/ code/ motion/
      manifest.json       # hashes de entrada → artefatos (cache)
  assets/                 # personagens, cenários, props, vozes do projeto
  cache/                  # artefatos content-addressed
  out/                    # video final, SRT, thumbnails, asset pack
  runs/<runId>/log.ndjson # eventos da execução
```
Biblioteca global em `<workspace>/library/` (assets reutilizáveis entre projetos).

---

## 3. Modelo de domínio

### 3.1 Projeto
`Project { id, name, videoType, aspect, targetDurationSec, language, routeId, channelId?, styleRef?, memories[] }`

### 3.2 Cena (unidade central)
```
Scene {
  id, index, title,
  narration: string,           // texto falado
  visualIntent: string,        // o que se vê
  durationSec?: number,        // ajustado após TTS
  kind: 'image'|'video'|'code'|'motion'|'mixed',
  characters: AssetRef[], location?: AssetRef, props: AssetRef[],
  camera?: {shot, movement, lens},
  notes?: string,              // ajustes do usuário injetados nos prompts (v1.2)
  variation?: number,          // re-sorteio de seed por cena (v1.2)
  manualDuration?: boolean,    // duração definida na timeline: não é sobrescrita pelo áudio (v1.2)
  sfx?: string[], musicCue?: string,
  overrides?: Partial<Record<StepKind, StepBinding>>,  // rota por cena
  status: Record<StepKind, 'pending'|'running'|'done'|'failed'|'skipped'|'stale'>,  // 'stale' = editada após gerar
  artifacts: Record<string, ArtifactRef>
}
```
Cada cena tem **estado por etapa**, permitindo re-executar só "vídeo da cena 7" sem tocar no resto.

### 3.3 Etapas (StepKind)
| kind | Entrada | Saída |
|---|---|---|
| `ideation` | canal/tema/URL | lista de ideias |
| `script` | ideia/manuscrito | roteiro estruturado |
| `scene_plan` | roteiro | `scenes.json` (cenas, beats, câmera) |
| `asset_design` | cenas | personagens/cenários/props de referência |
| `image` | prompt de cena + refs | frame(s) PNG |
| `video` | frame(s)/prompt | clipe MP4 |
| `code_scene` | cena | clipe renderizado de **cena por código** (HTML/Canvas/Three/p5/SVG/Remotion-like) |
| `motion_graphics` | texto/dados | clipe de motion graphics (templates, lower-thirds, gráficos animados) |
| `narration` | texto da cena | WAV/MP3 + timestamps de palavras |
| `music` | mood/duração | trilha |
| `sfx` | marcações | efeitos (biblioteca local + geração) |
| `subtitles` | narração + timestamps | SRT/ASS |
| `edit` | tudo acima | timeline + render final |
| `review` | cena/vídeo | nota + correções (visão) |
| `thumbnail` | vídeo/título | imagem |
| `metadata` | roteiro | título, descrição, tags |
| `publish` | vídeo final | upload (com aprovação) |

### 3.4 Rota (Route)
Uma **rota** é um grafo dirigido acíclico de **etapas**, cada uma com **binding** (quem executa), **fallback**, parâmetros e política de escopo.

```ts
Route {
  id, name, description, videoTypes: VideoTypeId[],
  scope: 'project' | 'scene',   // etapas por cena rodam em fan-out
  steps: RouteStep[]
}
RouteStep {
  id, kind: StepKind, label,
  dependsOn: string[],
  scope: 'project'|'scene',
  enabled: boolean,
  bindings: Binding[],          // [primário, fallback1, fallback2, ...]
  params: Record<string, unknown>,
  retry: { max: number, backoffMs: number },
  timeoutSec: number,
  condition?: string            // ex.: "scene.kind in ['video','mixed']"
  gate?: 'none'|'approve'       // pausa para aprovação humana
}
Binding =
  | { type:'harness',  harness: HarnessId, model?: string, effort?: 'low'|'medium'|'high'|'max', skill?: string }
  | { type:'comfyui',  server: string, workflow: string, mapping?: ParamMap, outputNode?: string, refAudio?: string }
  | { type:'wan2gp',   template: string, refAudio?: string }   // v1.3: arquivo em workflows/ com {model_type, settings}
  | { type:'api',      provider: string, model: string }
  | { type:'builtin',  tool: 'ffmpeg'|'silence-trim'|'subtitle-burn'|... }
  | { type:'manual' }           // pausa e pede upload/edição do usuário
```

### 3.5 Tipos de vídeo (VideoType)
Cada tipo traz: *prompt de estilo*, **rota padrão**, aspect/duração padrão, estratégia de consistência, preset de voz/música e checklist de qualidade.

| id | Descrição | Estratégia principal |
|---|---|---|
| `stickman` | Bonecos de palito, explicativos/humor | `code_scene` (SVG/Canvas) + imagem simples; baixo custo |
| `realistic` | Realista fotográfico/cinemático | imagem → vídeo (I2V), consistência por referência |
| `anime_2d` | Anime 2D / otome / manhwa-motion | imagem com LoRA/IPAdapter + Ken Burns/I2V leve |
| `cartoon_3d` | 3D cartoon (estilo Shorts viral) | imagem estilizada + I2V |
| `pixel_art` | Pixel art | imagem + animação por código/sprite |
| `flat_explainer` | Vetorial flat, explicativo | `code_scene` + motion graphics |
| `ms_paint` | Estilo MS Paint/rabisco viral | imagem + animação por código |
| `vox_collage` | Colagem documental | recortes + motion graphics |
| `low_poly` | Low poly 3D | `code_scene` (Three.js) |
| `recon_3d` | Reconstrução 3D/cenário consistente | imagem→3D (ComfyUI) + câmera virtual |
| `doc_netflix` | Documentário/“3D investigation” estilo Netflix | cenário 3D consistente (recon_3d) + motion graphics + narração grave; combina bem com rotinas e ultra long form |
| `whiteboard` | Quadro branco desenhado | `code_scene` (stroke animation) |
| `motion_graphics` | Infográfico/dados/typography | `motion_graphics` |
| `micro_drama` | Série dramática multi-episódio | pipeline completo c/ biblioteca de personagens |
| `ad_product` | Anúncio/e-commerce | foto do produto → I2V + motion graphics + CTA |
| `interactive_story` | História ramificada (v2) | grafo de escolhas → player HTML |
| `music_lyric` | Lyric video / visualizer | áudio-reativo (code_scene) |
| `custom` | Definido pelo usuário | — |

Formatos: 9:16 (Shorts/Reels/TikTok), 16:9, 1:1, 4:5. Duração: 15 s … 2 h (modo *ultra long form* com capítulos).

---

## 4. Harness de agentes

### 4.1 Conceito
Um **harness** é uma CLI/agente de código instalada no computador que recebe uma tarefa em linguagem natural, pode ler/escrever arquivos no diretório da cena e devolve resultado. FilmForge usa harnesses para etapas **cognitivas e de código**: roteiro, planejamento de cenas, design de assets, **cenas por código**, motion graphics, revisão, metadados, ideação.

### 4.2 Harnesses suportados
| id | Produto | Invocação padrão (editável) | Esforço |
|---|---|---|---|
| `claude` | Claude Code | `claude -p {prompt} --model {model} --output-format text` | `--effort low/high/xhigh/max` |
| `opencode` | OpenCode | `opencode run {prompt} --model {model}` | via variante do modelo (`provider/model#variant`) |
| `codex` | OpenAI Codex CLI | `codex exec {prompt} --model {model}` | `-c model_reasoning_effort=` |
| `antigravity` | Google Antigravity | template configurável pelo usuário (CLI/ACP do Antigravity) | `--effort low/medium/high/xhigh/max` |
| `openclaw` | OpenClaw | template configurável pelo usuário | — |
| `ollama`/`llamacpp`/`lmstudio` | servidores HTTP locais | Base URL (protocolo Ollama ou OpenAI) | `reasoning_effort` no protocolo OpenAI |

> **Importante:** flags de CLI mudam entre versões. Por isso cada harness tem **template de comando editável** em Configurações, botão **"Testar"** (executa `--version` e um prompt de eco) e detecção automática do binário no PATH. Os padrões acima são ponto de partida e podem precisar de ajuste para a sua versão instalada.

### 4.3 Contrato do adaptador (`HarnessAdapter`)
```ts
interface HarnessAdapter {
  id: HarnessId;
  detect(): Promise<{installed:boolean; version?:string; path?:string}>;
  listModels(): Promise<string[]>;                 // estático/configurável
  run(task: HarnessTask, ctx: RunContext): Promise<HarnessResult>;
  cancel(runId: string): void;
}
HarnessTask {
  cwd: string,              // pasta da cena (sandbox lógico)
  prompt: string,           // montado a partir de template + contexto
  model?: string,
  expectFiles?: string[],   // artefatos que DEVEM existir ao final
  schema?: JSONSchema,      // se saída estruturada (JSON) for esperada
  timeoutSec: number,
  env?: Record<string,string>
}
HarnessResult { ok, stdout, stderr, files: string[], json?: unknown, usage?: {...} }
```
Validações pós-execução: arquivos esperados existem, JSON valida no schema, vídeo tem duração > 0 (ffprobe). Falha de validação = falha da tentativa → próximo binding.

### 4.4 Protocolo de escrita de artefatos
O prompt instrui o harness a escrever **somente** dentro de `cwd` e a produzir arquivos nomeados (`scene.html`, `plan.json`, …). FilmForge nunca executa código gerado fora do **sandbox de renderização** (ver §6.3).

### 4.5 Servidor MCP (v1.1)
FilmForge expõe MCP padrão em **stdio** (`--mcp`) e **Streamable HTTP/SSE** (`--mcp-http`, padrão `127.0.0.1:3333/mcp`, health `/health`, SSE legado `/sse`, Bearer opcional `--mcp-token`). Ferramentas: projetos, criação, run, status, log, cenas, rotas, skills, provedores, modelos, plugins e recursos. Compatível com Claude Desktop/Code, Cursor, VS Code, OpenCode, LM Studio e ChatGPT (via túnel HTTPS). O padrão loopback continua; para ChatGPT na nuvem use túnel.

### 4.6 Segurança dos harnesses
- Rodam com `cwd` na pasta da cena; variável `FORGE_SCENE_DIR`.
- Política configurável: `--permission-mode`/aprovações do próprio harness quando existirem; padrão = modo mais restrito que ainda permita escrever na pasta da cena.
- Timeouts, limite de saída, kill de árvore de processos.
- Segredos nunca vão no prompt; só por env quando estritamente necessário.

### 4.7 Esforço de raciocínio (`effort`)
Controla quanto "raciocínio" o modelo gasta por execução. A UI expõe exatamente quatro opções — **Default, Low, High, Max** — e a escolha é **por tarefa** (`HarnessBinding.effort`) com **padrão por provedor** (`HarnessConfig.effort`) como fallback; agentes obreiros também podem fixar o próprio esforço.

- **Default** = campo vazio: nenhuma flag é enviada e o modelo usa seu próprio padrão.
- O seletor **só aparece quando o harness/modelo reconhecidamente aceita o parâmetro** (`modelSupportsEffort`): Claude Code (exceto Haiku), Codex, Antigravity e modelos de raciocínio nos harnesses HTTP OpenAI-compatíveis. Nos demais (OpenCode, OpenClaw, Ollama) o seletor é omitido para não quebrar a execução.
- **Mapeamento:** Claude/Antigravity recebem `--effort <valor>`; Codex recebe `-c model_reasoning_effort=<valor>` (`Max` → `xhigh`); harnesses HTTP recebem `reasoning_effort` no corpo (`Max` → `xhigh`). Quando o servidor rejeita o parâmetro, a etapa repete automaticamente sem ele.
- Nos argumentos do harness há o token `{effort}` (além de `{prompt}`/`{model}`); a flag é injetada automaticamente quando ausente, portanto **configurações antigas continuam funcionando**.
- O rótulo da etapa mostra o sufixo (`harness:claude/opus@high`) e o log registra o esforço efetivo.

---

## 5. Provedores de modelo

### 5.1 ComfyUI API (modelos locais)
Suporte de primeira classe a um ou mais servidores ComfyUI (local ou remoto).

**Conexão:** `http://127.0.0.1:8188` (configurável), token opcional, teste de saúde via `GET /system_stats`.

**Fluxo de execução:**
1. Carregar **workflow em formato API** (JSON exportado via "Save (API Format)").
2. **Mapeamento de parâmetros** (`ParamMap`): aponta `nodeId.inputName` para variáveis do FilmForge (`{prompt}`, `{negative}`, `{seed}`, `{width}`, `{height}`, `{frames}`, `{fps}`, `{init_image}`, `{ref_image}`, `{audio}`, `{lora}`, `{checkpoint}`). Substituição também por marcadores `{{var}}` dentro de strings.
3. **Upload** de imagens/áudios de entrada: `POST /upload/image` (e `/upload/mask`).
4. **Submissão:** `POST /prompt` com `{ prompt, client_id }` → `prompt_id`.
5. **Progresso:** WebSocket `ws://host/ws?clientId=…` (eventos `progress`, `executing`, `executed`, `execution_error`) com fallback a polling de `GET /history/{prompt_id}`.
6. **Coleta:** `GET /view?filename=&subfolder=&type=` para imagens/vídeos/áudios de saída; cópia para a pasta da cena.
7. **Cancelamento:** `POST /interrupt`, `POST /queue` (delete).
8. **VRAM:** opção "liberar modelos após a etapa" (`POST /free`).

**Biblioteca de workflows:** pasta `workflows/` com presets (T2I, I2I c/ IPAdapter, I2V, FLF2V primeiro/último frame, T2V, TTS local, música, upscale, interpolação, remoção de fundo, imagem→3D). O usuário **importa** os próprios JSONs e declara o mapeamento num editor visual (lista de nós + campos clicáveis). Cada workflow declara `capabilities` (`image`, `video`, `audio`, `upscale`…) e **requisitos** (nós customizados/modelos) para validação prévia (`GET /object_info`).

**Variáveis (v1.2/1.3):** `{{prompt}}`, `{{negative}}`, `{{seed}}`, `{{width}}`, `{{height}}`, `{{resolution}}` (`LxA`), `{{text}}` (narração), `{{seconds}}`/`{{seconds_int}}` (2–12 s), `{{frames}}`, `{{fps}}`, `{{style}}`, `{{lyrics}}`, `{{music_seconds}}` (10–360 s), `{{init_image}}` (frame da cena, enviado ao servidor), `{{ref_audio}}` (`refAudio` local, enviado ao servidor). Arquivo `X.map.json` ao lado do workflow: `outputNode`, `vars`, `mapping`, `maxSide` **ou** `megapixels` + `multiple`, `refAudio`. Variável sem valor, workflow em formato de interface (`nodes`) e referência ausente falham com mensagem clara e acionam o fallback.

**Workflows incluídos:** imagem `krea2-turbo-t2i`, `z-image-turbo-t2i`, `t2i-basic`; vídeo `minimax-h3-ref2v` (frame da cena como referência), `minimax-h3-t2v`; narração `omnivoice-clone-tts` (clonagem de voz); música `yue2-text2music`, `yue2-music-cover`. Moss Image: aguardando reexportação em formato API.

**Consistência:** a mesma `seed` + refs de personagem (IPAdapter/PuLID/LoRA) são injetadas automaticamente a partir da biblioteca de assets.

### 5.1b Wan2GP (API Python)
Alternativa local ao ComfyUI, selecionável por etapa e combinável na mesma cadeia de fallback.
- **Ponte** `tools/wan2gp_bridge.py`, executada com o Python do ambiente do Wan2GP: usa `shared.api` (`init`, `submit_task`, `job.result/cancel`); protocolo JSON por linha; **processo persistente** (modelo carregado entre cenas); fila serializada; cancelamento; operações `models`, `defaults`, `generate`.
- **Templates** `workflows/wan2gp-*.json`: `{model_type, settings, maxSide|megapixels, multiple, refAudio?, vars?}` com as mesmas `{{variáveis}}`. Chaves desconhecidas do modelo geram aviso no log.
- **Configuração** (*Configurações*): `wan2gp.root`, `wan2gp.python`, `wan2gp.cliArgs`; botões *Listar modelos* e *Ver padrões*. Não abrir o Wan2GP ao mesmo tempo.
- **Saída:** primeiro arquivo do tipo esperado (imagem/vídeo/áudio) copiado para a pasta da cena (ou `out/music.*`).
- **Verificado vs. suposto:** `ltx2_22B_distilled` e as chaves de vídeo seguem a documentação; `z_image`, `qwen3_tts_base`, `yue2` e chaves de imagem inicial/áudio/música são suposições a confirmar com *Listar modelos*.

### 5.2 APIs comerciais
Interface única `ModelProvider` por **capacidade**:
```ts
interface ModelProvider {
  id: string;
  capabilities: ('text'|'vision'|'image'|'video'|'tts'|'music'|'stt')[];
  invoke(cap, request, ctx): Promise<ProviderResult>;
}
```
Adaptadores v1: **OpenAI-compatível genérico** (texto, visão, imagem, TTS — qualquer gateway/base URL), **ElevenLabs** e **Fish Audio** (TTS), **fal.ai** (imagem/vídeo), **Replicate** (genérico), **Google (Gemini/Veo/Imagen)**, **Kling/Hailuo/Seedance** via endpoints configuráveis e **Snapgen.AI** (imagem/vídeo, §5.5). Cada provider é um arquivo pequeno com `baseUrl`, auth, mapeamento request/response e polling assíncrono. Novos providers = JSON declarativo + (opcional) classe TS.

### 5.3 Modos (inspirado em Oficial/Custom/Híbrido)
- **Local**: ComfyUI + TTS local + harness local.
- **Comercial**: só APIs.
- **Híbrido**: por etapa.
Um **perfil de execução** ("Barato", "Qualidade máxima", "100 % local", "Rápido") reescreve as bindings da rota em lote.

### 5.4 Cofre de segredos
Chaves em `safeStorage` (Keychain/DPAPI/libsecret); nunca em `project.json`. Exportar projeto remove segredos.

### 5.5 Snapgen.AI (imagem e vídeo)
Provedor comercial de imagem/vídeo. Auth por header **`x-api-key`**; base `https://api.snapgen.ai`, caminhos `.../uapi/v1/...`.

| Operação | Endpoint | Notas |
|---|---|---|
| Saldo da conta | `GET /uapi/v1/account` | `user_credit.available_credit` / `locked_credit`; usado pelo botão *Testar* (não consome créditos) |
| Catálogo de modelos | `GET /api/service-prices` | público (sem chave); `model_name` + `price_unit` (`image`, `video`, `second`); o *Testar* usa para carregar os modelos por aba |
| Imagem | `POST /uapi/v1/generate_image` | multipart: `prompt`, `model`, `aspect_ratio`, `resolution`, `style?`, `files?` (img2img). Modelos: `nano-banana-pro`, `nano-banana-2`, `nano-banana-2-lite` e os demais `price_unit=image` do catálogo |
| Vídeo (Veo/Omni) | `POST /uapi/v1/video-gen/veo` | multipart: `prompt`, `model`, `resolution`, `duration`, `aspect_ratio`, `ref_images?` + `mode_image=frame`. Modelos: `veo-3.1-fast`, `veo-3.1`, `veo-2`, `omni-flash` |
| Vídeo (outras famílias) | `POST /uapi/v1/video-gen/{sora,seedance,kling,minimax,flux,vela,meta}` | multipart; `aspect_ratio` (Sora/Seedance/Kling/Minimax/Flux) ou `orientation` (Vela/Meta); imagem em `files`/`image`; duração 5/10 s (Sora 4/8/12) |
| Histórico | `GET /uapi/v1/history/{uuid}` | `status` (`1` processando, `2` sucesso, `3` erro), `generated_image`/`generated_video`, `used_credit`/`estimated_credit` |

- **Fluxo:** criação multipart → se a resposta vier `status:2` usa direto, senão faz *polling* de `/history/{uuid}` até sucesso/erro; baixa a mídia (`image_url`/`video_url`) para o arquivo da cena. Vídeo é assíncrono; o `veo-3.1` tem duração fixa de 8 s e as outras famílias usam 5/10 s (Sora 4/8/12).
- **Modelos por aba:** o *Testar* consulta `/api/service-prices` e grava `modelCategories` (modelo → imagem/vídeo). A aba de imagens mostra só modelos de imagem, a de vídeos só os de vídeo, e a edição de rotas filtra pelo tipo da tarefa. Grok (SSE/Bearer) e `sd-2`/vids não entram no catálogo do adaptador porque usam fluxos diferentes.
- **Consumo de créditos:** cada criação reporta `estimated_credit`; o histórico reporta `used_credit`. Ambos vão para o log da etapa; o saldo pode ser conferido em *Testar*, que também carrega o catálogo de modelos.
- **Fallback automático:** o provedor entra como mais um binding `api` (imagem/vídeo) na cadeia da tarefa, como Seedance/ComfyUI/Wan2GP.

---

## 6. Motor de rotas (Route Engine)

### 6.1 Execução
1. **Validação prévia (preflight):** harnesses instalados, servidores ComfyUI online, workflows com nós/modelos presentes, chaves configuradas, ffmpeg disponível. Falha bloqueia a fila com lista acionável.
2. **Expansão:** etapas `scope: scene` são expandidas em N tarefas (uma por cena) respeitando `dependsOn`.
3. **Agendamento:** fila com **concorrência por recurso** (ex.: 1 job de GPU ComfyUI por vez; N chamadas de API; 1–2 harnesses). Prioridade configurável.
4. **Cache content-addressed:** chave = hash(kind + binding + params + entradas). Hit → reutiliza artefato (economia de crédito/tempo). Biblioteca de assets participa do cache.
5. **Checkpoint:** estado por (cena, etapa) persistido a cada transição → *resume* após crash/fechamento.
6. **Gates:** etapas `gate: approve` pausam e mostram preview; usuário aprova, edita ou pede nova geração (com anotação que vira **memória**).

### 6.2 Fallback
Para cada tarefa: percorrer `bindings[]` em ordem.
```
para cada binding b em step.bindings:
    para tentativa em 1..retry.max:
        resultado = executar(b)
        se valida(resultado): return sucesso(b)
        esperar backoff
    registrar falha(b) e emitir evento "fallback"
falha final → status failed (cena) + política:
    'stop'  | 'skip-scene' | 'use-placeholder' | 'ask-user'
```
Gatilhos de fallback: erro de processo, timeout, saída inválida, **cota/limite de taxa**, servidor ComfyUI offline/OOM, reprovação no `review` automático (opcional), custo acima do teto.
Eventos de fallback ficam no log e na UI ("Cena 7 · vídeo: ComfyUI/LTX → falhou (OOM) → fal.ai/Kling ✓").

### 6.3 Cenas por código (`code_scene`) e motion graphics
- O harness escreve uma **cena renderizável**: pasta com `scene.html` (+ JS/CSS/assets) que expõe `window.__forge = { duration, fps, seek(t) }` — renderização **determinística por seek**.
- O renderer headless (BrowserWindow offscreen/`webContents.capturePage` ou Puppeteer-core com o Chromium do Electron) avança `seek(t)` quadro a quadro, captura PNG e envia ao ffmpeg → MP4 (com canal alpha opcional em WebM/ProRes 4444).
- Bibliotecas permitidas via vendor local (sem rede): Canvas 2D, SVG/GSAP, Three.js, p5.js, Lottie, D3. CSP restritiva, sem `fetch` externo, janela de render **sem Node** e com `sandbox`.
- `motion_graphics`: **templates paramétricos** (lower-third, contador, gráfico de barras/linha, mapa, título cinético, CTA, legenda animada) preenchidos por JSON; harness gera JSON ou cria novos templates.
- Ideal para `stickman`, `flat_explainer`, `whiteboard`, `low_poly`, `pixel_art`, anúncios.

### 6.4 Rotas por cena (overrides)
Qualquer cena pode sobrescrever o binding de uma etapa (ex.: cena 3 usa `realistic` via ComfyUI, restantes usam `code_scene`). A UI mostra uma **matriz cena × etapa** com o executor efetivo e estado. Implementado: *Regerar cena → Executor desta vez* grava o override; a troca para a etapa inteira fica em *Editor → 🎛 Executores* (§18.2).

### 6.5 Níveis de qualidade (inspirado no Creatorize)
`standard` · `depth` (mais props/set design) · `polished` (animação mais suave) · `verified` (etapa `review` visual por cena com correção automática) · `ultra` (múltiplas passadas e seleção do melhor). Cada nível = **transformação da rota** (liga etapas `review`/`refine`, aumenta tentativas, troca modelos).

---

## 7. Funcionalidades (checklist)

### 7.1 Núcleo (MVP)
- [x/ver esqueleto] Projetos, tipos de vídeo, presets de rota.
- [ ] Editor de rotas (lista + JSON), clonar/exportar/importar rotas.
- [ ] Bindings por etapa + fallback + retry + timeout.
- [ ] Adaptadores: Claude Code, OpenCode, Codex, Antigravity, OpenClaw (template editável).
- [x] ComfyUI client completo (upload, prompt, WS, history, view, interrupt).
- [x] Wan2GP via API Python (imagem, vídeo, narração, música).
- [x] Editor de cenas com timeline, edição por prompt, CRUD de projetos/cenas e lote (§15).
- [ ] Provider OpenAI-compatível (texto/imagem/TTS) + ElevenLabs/Fish (TTS).
- [ ] Cena como unidade: `scenes.json`, matriz cena × etapa, re-executar etapa/cena.
- [ ] Fila/Task Center: status, progresso, logs, cancelar, repetir, retomar.
- [ ] Cache e checkpoints.
- [ ] Narração: TTS, normalização, **remoção de silêncios** (ffmpeg `silenceremove`), timestamps de palavras (STT local opcional).
- [ ] Trilha + SFX: biblioteca local (pasta indexada), *ducking* (sidechain), mix automático.
- [ ] Legendas SRT/ASS (queimadas ou separadas).
- [ ] Render final ffmpeg (H.264/H.265, 1080p/4K, 9:16/16:9).
- [ ] Exportar: MP4, SRT, thumbnail, *asset pack* ZIP.

### 7.2 Produção
- [ ] **Biblioteca de assets** global/por projeto (personagens, cenários, props, vozes, estilos, músicas, SFX) com variantes e referências para consistência.
- [ ] **Estilo por imagem de referência** (extrai parâmetros → prompt/negative/LoRA).
- [ ] **Memórias**: regras "nunca fazer X" injetadas nos prompts de todas as etapas e projetos.
- [ ] **Style wall**: galeria de looks por tipo de vídeo.
- [ ] **Storyboard**: grade de primeiros frames por beat, seleção do melhor (pool de imagens).
- [ ] **Revisão visual** (modelo com visão) por cena + auto-correção.
- [ ] Ingest de manuscrito/roteiro (Markdown, TXT, Fountain, DOCX→texto) → episódios/personagens/cenas.
- [ ] Multi-episódio com arcos e consistência de personagens.
- [ ] Timeline simples (reordenar, trocar clipe, ajustar duração, trocar música).

### 7.3 Automação (Routines)
- [ ] **Rotinas**: gatilho (cron/intervalo/manual) → *topic finder* → cria projeto → executa rota → gate de aprovação opcional → publica.
- [ ] **Topic finder**: lê títulos de qualquer canal público (URL), classifica clusters e propõe ideias; usa harness com pesquisa web quando disponível.
- [ ] Pesquisa e **checagem de fatos** (harness com web) antes do roteiro.
- [ ] Execução em segundo plano com ícone de bandeja; prevenção de suspensão; retomar fila após reinício.
- [ ] Limites: teto de custo/dia, nº máx. de vídeos/dia, janelas horárias.
- [ ] Notificações (desktop/e-mail/webhook).

### 7.4 Publicação e analytics
- [ ] Upload YouTube (OAuth, Data API) com **aprovação**, agendamento, título/descrição/tags/capítulos, thumbnail.
- [ ] Exportadores manuais para TikTok/Reels (pasta + metadados).
- [ ] Painel de analytics (YouTube Analytics API): views, CTR, retenção → alimenta **memórias** e o *topic finder*.
- [ ] Estimativa de custo por vídeo (tokens/créditos/GPU-minutos) e por cena.

### 7.5 Plataforma
- [ ] Skills/receitas instaláveis (pacotes `.forgepack`: rota + prompts + workflows ComfyUI + templates de motion).
- [x] Servidor MCP stdio + HTTP/SSE (ChatGPT/Claude/Cursor/VS Code).
- [ ] i18n (pt-BR, en, es, zh).
- [ ] Telemetria **desligada por padrão**; logs locais.
- [ ] Atualização automática (electron-updater).

---

## 7.6 Adições da v1.1 (paridade Creatorize)

**A. Style Studio e personagens custom.** Editor para criar um *estilo*: prompt de estilo/negativo, rota padrão, voz/música padrão, paleta, referências de imagem (extração de parâmetros), LoRA/IPAdapter opcionais, checklist de qualidade; salvo como `VideoType` do usuário e exportável em `.forgepack`. Personagens custom ficam na biblioteca com refs, voz e variantes.

**B. Tudo editável (“click anything to change it”).** Todo prompt de etapa vira **template editável** (`prompts/<kind>.md` com variáveis `{{scene.narration}}`, `{{project.language}}` etc.), com *skills* por etapa (pasta `skills/`), agentes/rotas/rotinas visíveis como arquivos do projeto. O usuário pode enviar **sua própria skill de roteiro** e atribuí-la a uma etapa; botão “restaurar padrão” por arquivo.

**C. Dashboard de uso.** Registra por run/cena: tokens (entrada, saída, leitura de cache), tempo, GPU-minutos, créditos de API. Mostra *custo equivalente em API* versus *consumo da assinatura do harness* (quando o harness expõe o uso), % do limite semanal e alerta antes de estourar; teto diário configurável.

**D. Roteiro.** Presets (*deep research + fact-check*, rápido, humor técnico), notas livres para o modelo, edição manual no app ou “devolver ao modelo” com instrução; gancho sem clichê, final que fecha em loop com o início; verificação de fatos com fontes salvas em `sources.md`.

**E. Voz.** Seletor de vozes por provider (ElevenLabs, Fish Audio, local) com pré-escuta e *auto-select*; importar **gravação própria**, limpar (denoise/normalização) e **alinhar palavras** (STT/forced alignment) para legendas e cortes; `silence-trim` com parâmetro `amount` (0–100 %) e relatório de segundos economizados.

**F. Música e SFX.** Música do usuário (ou playlists sem copyright indicadas manualmente) com *ducking* padrão **−4 dB** de volume base e **−6 dB** extra sob a voz; biblioteca de SFX indexada por pasta (centenas de arquivos), **auto sound** (marca onde entram os efeitos) ou sound design embutido do estilo.

**G. Preview ao vivo.** Timeline que já exibe cenas concluídas enquanto as demais ainda geram; reprodução em tempo real do que existe; marcação de cenas para refazer.

**H. Imagens e thumbnails.** Providers adicionais: **Google Flow** (cota gratuita), **Higgsfield**, GPT Image, Nano Banana; thumbnails aprendem o padrão das thumbnails públicas do canal; opcional por rota (desligado em shorts).

**I. Canais.** Entidade `Channel { id, nome, nicho, URL, idioma, conta OAuth, rota padrão, rotinas, memórias }`; um projeto pertence a um canal; visão de portfólio com custo e resultado por canal.

**J. Rotinas e analytics.** Template **full channel autopilot** (agenda → topic finder → projeto → roteiro → voz → build → checagem de qualidade → render → thumbnail opcional → título/descrição → aprovação → upload); gatilho diário/por dias/por hora, com **próxima execução** visível; *topic finder* aceita URL de qualquer canal público com filtros (todos / só longos / só shorts / últimos N) e usa a API do canal, quando conectada, para categorizar; analytics lê **retenção e comentários** para gerar memórias; no upload: aprovação humana opcional, anúncios ligados e vídeos relacionados.

**K. Pacotes de estilo.** Canal de atualização de `.forgepack` (estilos novos periodicamente) com changelog e versão mínima do app.

**L. Plataforma.** Assistente de primeira execução (detecta harnesses, ComfyUI, ffmpeg, pergunta pelas chaves); **busca em Configurações**; instaladores Windows, macOS e Linux; idiomas da **interface** ampliáveis por arquivo de tradução, independentes dos 30+ idiomas de **conteúdo**.

**M. Blender.** Executor `blender` (`blender -b -P script.py`) que recebe a cena (câmera, props, texto), renderiza frames/MP4 e devolve à pasta da cena; o harness pode escrever o script Python. Caminho do Blender configurável; entra como binding `{ type:'builtin', tool:'blender' }`.

**N. MCP cliente.** O app conecta a servidores MCP (ex.: **VidIQ** para palavras-chave, outliers e transcrições) e os expõe às etapas `ideation`, `script`, `metadata` e ao topic finder; permissões por servidor e por etapa.

**O. Consultor de duração.** Ao criar o vídeo, sugere duração conforme formato: shorts de **60–90 s** priorizando tempo assistido absoluto e retenção plana; vídeos **ultra long form** (1 h+) com várias pausas para anúncios quando o objetivo for RPM; exibe a lógica e deixa o usuário decidir.

---

## 8. Rotas padrão incluídas

### 8.1 `shorts-autopilot` (vertical, 60–90 s)
```
ideation(harness) → script(harness) → scene_plan(harness)
 → narration(api|comfyui omnivoice|wan2gp tts) → [silence-trim(builtin)]
 → por cena: image(comfyui krea2→z-image|wan2gp|api) → video(comfyui h3 ref2v→t2v|wan2gp ltx2)  ‖  code_scene(harness)
 → music(comfyui yue2|wan2gp|library) → sfx(library) → subtitles(builtin)
 → edit(ffmpeg) → review(harness vision) → metadata(harness) → publish(gate:approve)
```
### 8.2 `stickman-explainer`
`script → scene_plan → narration → por cena: code_scene(harness: SVG stickman) → motion_graphics → music → edit`
(zero custo de imagem/vídeo; ideal para volume).
### 8.3 `realistic-cinematic`
`script → scene_plan → asset_design(refs) → por cena: image(ref) → video(I2V) → review → narration → music → sfx → edit`.
### 8.4 `anime-2d-series`
`ingest → episode_plan → asset_design(LoRA/IP) → storyboard → por cena: image → video(leve) → narration(emoção) → edit → subtitles`.
### 8.5 `ad-product`
`brief → script → scene_plan → foto do produto → I2V → motion_graphics(CTA/preço) → narration → music → edit (variações A/B 9:16/1:1/16:9)`.
### 8.6 `local-only`
Todas as etapas com binding `comfyui`/`wan2gp`/`builtin` + harness local (OpenCode apontando para modelo local, ex.: via Ollama).
### 8.7 `clipe-musical-loop-codigo`
```
script → scene_plan (1 cena "code" de 12 s)
 → code_scene(harness: HTML/Canvas/SVG/WebGL com window.__forge.seek)
 → edit(clip-musical: Yue 2 + loop exato + nome da faixa + waveform)
```
Sem etapas de imagem ou vídeo por IA. A cena é renderizada a 30 fps e repetida pelo período exato; se a geração por código falhar, o `clip-musical` usa o template Paris embutido (anime/16-bit/8-bit). O plano musical aceita 2–15 faixas, cada uma com `seconds` próprio, e o compilado é limitado a 360 s por `maxTotalSeconds` (padrão). Para coletâneas, use 10 faixas de 36 s = 360 s. A skill **Clipe musical em loop com código (Canvas/WebGL)** aponta para esta rota.

Cada rota vem com **bindings de exemplo** (primário + 2 fallbacks) editáveis.

---

## 9. Interface do usuário

| Tela | Função |
|---|---|
| **Início** | Projetos recentes, rotinas ativas, custo do dia, estado dos provedores. |
| **Novo vídeo** | Ideia/roteiro/manuscrito, tipo de vídeo, formato, duração, rota, perfil (Local/Comercial/Híbrido/Barato/Ultra). |
| **Editor de Rotas** | Lista/grafo de etapas; para cada uma: executor primário + fallbacks (drag para reordenar), modelo, parâmetros, retry/timeout, condição, gate. Importar/exportar. Validador. |
| **Cenas** | Matriz cena × etapa, preview de frame/clipe/áudio, editar texto/prompt, trocar binding da cena, regenerar, aprovar. |
| **Fila / Task Center** | Jobs, progresso, logs ao vivo, eventos de fallback, cancelar/repetir/retomar, custos. |
| **Biblioteca** | Assets reutilizáveis, variantes, vozes, estilos, músicas, SFX. |
| **Memórias** | Regras globais/por tipo/por projeto. |
| **Rotinas** | Agendamentos, histórico, limites, aprovações pendentes. |
| **Projetos** (v1.2) | CRUD, duplicar, criação em massa, execução em lote com concorrência. |
| **Editor** (v1.2) | Timeline estilo CapCut + inspetor + edição por prompt (§15). |
| **Configurações** (antes *Provedores*) | Harnesses (detecção/teste/template), ComfyUI (servidores/workflows/mapeamento), **Wan2GP** (pasta, python, listar modelos/padrões), APIs (chaves/modelos), perfis. |
| **Analytics** | Retenção/CTR por vídeo → insights. |
| **Configurações** | Workspace, ffmpeg, idioma, tema, atualização, privacidade. |

Acessibilidade: navegação por teclado, contraste AA, tema claro/escuro.

---

## 10. Requisitos não funcionais
- **Desempenho:** UI nunca bloqueia (tudo pesado no main/worker/processos filhos); streaming de logs; listas virtualizadas.
- **Confiabilidade:** checkpoints atômicos (write-temp + rename); recuperação após crash; idempotência por chave de cache.
- **Segurança:** isolamento de contexto, CSP, validação de IPC, segredos criptografados, sandbox de render de código gerado, caminhos normalizados (anti path-traversal), **allowlist de domínios** opcional para rede.
- **Privacidade:** tudo local por padrão; nada enviado a terceiros além das APIs escolhidas.
- **Portabilidade:** Windows 10+/macOS 12+/Linux (AppImage/deb). Apple Silicon e x64.
- **Observabilidade:** logs NDJSON, exportar relatório de run.
- **Testabilidade:** adaptadores com *fakes*; testes de engine (fallback/cache/resume) sem rede.
- **Conformidade de conteúdo:** respeitar termos dos provedores e plataformas; checklist de divulgação de conteúdo sintético; filtro opcional de música/SFX sem copyright; sem imitar pessoas reais sem consentimento.

---

## 11. Roteiro de entregas
| Marco | Conteúdo |
|---|---|
| **M0 (este esqueleto)** | App Electron executável, tipos, rotas padrão, motor com fallback/retry/cache, adaptadores dos 5 harnesses, client ComfyUI, provider OpenAI-compatível, ffmpeg para montagem, UI básica (projetos, rotas, execução, configurações). |
| **M0.5 (v1.2–1.3)** | Editor de cenas (timeline), edição por prompt, CRUD e lote; workflows Krea 2, Z-Image, OmniVoice, MiniMax H3, YuE2; Wan2GP; testes (motor, ops/lote, workflows, Wan2GP, ponta a ponta). |
| **M1** | Dashboard de uso/custo, assistente de primeira execução, busca em Configurações, editor de prompts/skills por etapa, Editor visual de rotas, matriz de cenas, preview, TTS ElevenLabs/Fish, silence-trim, mix com ducking, legendas, render 9:16/16:9. |
| **M2** | Style Studio (estilos e personagens custom), integração Blender, provider de imagens gratuitas (Google Flow), preview ao vivo da timeline durante o build, `code_scene` com renderer determinístico, templates de motion graphics, biblioteca de assets, memórias, revisão visual. |
| **M3** | Multi-canais, aprendizado com retenção **e comentários**, cliente MCP (VidIQ), Rotinas/agendador com template “full channel autopilot”, topic finder, upload YouTube + analytics, MCP loopback. |
| **M4** | Pacotes `.forgepack`, i18n, auto-update, multi-episódio/ingest de manuscrito, timeline simples. |
| **M5** | Interactive stories, previz 3D, colaboração/compartilhamento de rotas. |

---

## 12. Riscos e mitigação
| Risco | Mitigação |
|---|---|
| CLIs de harness mudam flags | Template editável + teste + detecção de versão |
| Saída de harness não confiável | Schemas, `expectFiles`, validação ffprobe, retry/fallback |
| VRAM insuficiente no ComfyUI | Fila de GPU unitária, `/free`, fallback para API, presets por VRAM |
| Wan2GP/ComfyUI mudam ids ou chaves | Templates editáveis, *Listar modelos/Ver padrões*, aviso de chaves desconhecidas, fallback entre backends |
| Workflow exportado no formato errado | Detecção de formato UI e mensagem acionável |
| Custo descontrolado | Teto por run/dia, estimativa prévia, cache |
| Código gerado malicioso | Sandbox de render sem Node/rede, CSP, revisão de dependências vendorizadas |
| Demonetização/política de plataforma (conteúdo repetitivo/sintético) | Gate de aprovação, variação de roteiro, checklist de originalidade e divulgação |
| Licenças de modelos/assets | Metadados de licença por asset/workflow; aviso na exportação |

---

## 13. Anexos

### 13.1 Exemplo de rota (JSON)
Ver `src/main/presets.ts` (implementação) — trecho:
```json
{
  "id": "shorts-autopilot",
  "scope": "scene",
  "steps": [
    { "id":"script", "kind":"script", "scope":"project",
      "bindings":[
        {"type":"harness","harness":"claude","model":"opus"},
        {"type":"harness","harness":"codex"},
        {"type":"harness","harness":"opencode"}]},
    { "id":"image", "kind":"image", "scope":"scene", "dependsOn":["scene_plan"],
      "bindings":[
        {"type":"comfyui","server":"local","workflow":"t2i-flux.json"},
        {"type":"api","provider":"openai","model":"gpt-image-1"}]},
    { "id":"video", "kind":"video", "scope":"scene", "dependsOn":["image"],
      "bindings":[
        {"type":"comfyui","server":"local","workflow":"i2v-ltx.json"},
        {"type":"api","provider":"fal","model":"kling"}]}
  ]
}
```

### 13.2 Mapeamento ComfyUI (exemplo; alternativa: marcadores `{{var}}` direto no JSON do workflow, como nos workflows incluídos)
```json
{
  "workflow": "t2i-flux.json",
  "mapping": {
    "prompt":   "6.inputs.text",
    "negative": "7.inputs.text",
    "seed":     "3.inputs.seed",
    "width":    "5.inputs.width",
    "height":   "5.inputs.height"
  },
  "outputNode": "9"
}
```

### 13.3 Eventos do motor (NDJSON)
`run.start` · `step.queued` · `step.start` · `step.cache_hit` · `step.attempt` · `step.fallback` · `step.done` · `step.failed` · `gate.waiting` · `gate.approved` · `run.done`.


---

## 14. Auditoria de paridade com o Creatorize (v1.1)

Fontes: página Skool *Creatorize: AI Video Mastery* (planos e promessas do produto), a transcrição do vídeo-demonstração e os prints de updates/wins da comunidade (versões 0.7.4, 0.9.0, 0.12, 0.16; Ultraedit+, Style Studio, Library, Google Flow, Blender, VidIQ MCP, usage dashboard, low poly shorts, MS Paint stick figures, 3D cartoon shorts).
Legenda — **v1.0**: já previsto na spec anterior · **Adicionado**: incluído nesta versão · **Código M0**: estado do esqueleto entregue (✅ implementado · ◐ parcial · ❌ não).

| # | Característica do Creatorize | Spec v1.0 | Ação v1.1 | Código M0 |
|---|---|---|---|---|
| 1 | Fluxo guiado: ideação → roteiro → voz → cenas → música/SFX → render → upload | Coberto (§3.3, §8) | — | ◐ (sem ideação/publicação nas rotas padrão) |
| 2 | Estilos nativos: pixel art, vox collage, flat explainer, MS Paint/stick figures, reconstrução 3D, low poly, 3D cartoon shorts | Coberto (§3.5) | — | ◐ (tipos e prompts de estilo; sem Style Studio) |
| 3 | Estilo documentário Netflix / “3D investigation” | Ausente | **Adicionado** `doc_netflix` (§3.5) | ✅ (tipo `doc_netflix` presente) |
| 4 | Estilos e personagens **custom** (Premium) / **Style Studio** | Parcial (`custom`, biblioteca) | **Adicionado** §7.6-A | ❌ |
| 5 | Pacotes de estilo novos toda semana | Parcial (`.forgepack`) | **Adicionado**: canal de atualização de packs (§7.6-K) | ❌ |
| 6 | Biblioteca de assets reutilizáveis entre vídeos | Coberto (§7.2) | — | ❌ |
| 7 | Memórias (“não repetir este erro”) | Coberto (§7.2) | — | ◐ (memórias injetadas nos prompts; sem UI) |
| 8 | Níveis standard / depth / polished / verified / ultra e **Ultraedit(+)** | Coberto (§6.5) | **Detalhe**: ultra = passada plano a plano com refinamento; “ultra+” = passes extras e seleção do melhor | ◐ (só aumenta retries) |
| 9 | Controle de **esforço/raciocínio** do modelo (ex.: Opus *medium*, Sonnet *low*) por etapa | Ausente | **Implementado**: seletor *Default/Low/High/Max* por tarefa e padrão por harness (§3.4, §4.7); mapeado para `--effort`, `model_reasoning_effort` e `reasoning_effort` | ✅ |
| 10 | Roteiro com pesquisa na web e checagem de fatos (preset “deep research fact-checked”) | Parcial | **Adicionado** preset de roteiro (§7.6-D) | ◐ (instrução no prompt, sem preset) |
| 11 | Editar o roteiro à mão **ou** devolvê-lo ao modelo para reescrever; gancho em loop | Ausente | **Adicionado** (§7.6-D) | ❌ |
| 12 | Skill própria de roteiro enviada pelo usuário | Parcial (`.forgepack`) | **Adicionado**: skills por etapa (§7.6-B) | ❌ |
| 13 | TTS: ElevenLabs, Fish Audio, modelo local; seletor/auto-select de voz dentro do app | Parcial | **Adicionado** seletor de vozes no app (§7.6-E) | ◐ (TTS OpenAI-compat + ComfyUI) |
| 14 | Importar gravação própria, limpar áudio e alinhar palavras | Ausente | **Adicionado** (§7.6-E) | ❌ |
| 15 | Remoção de silêncios com intensidade ajustável e segundos economizados | Parcial | **Adicionado** parâmetro `amount` e relatório (§7.6-E) | ◐ (fixo, sem relatório) |
| 16 | Trilha do usuário + ducking (padrão −4 dB, −6 dB sob a voz) | Parcial | **Adicionado** valores padrão e ganho configurável (§7.6-F) | ◐ (ducking fixo) |
| 17 | Biblioteca local de SFX (centenas de arquivos), “auto sound” e sound design do estilo | Parcial | **Adicionado** (§7.6-F) | ❌ |
| 18 | Preview em tempo real; rolar a timeline enquanto as cenas são geradas | Ausente | **Adicionado** (§7.6-G) | ❌ |
| 19 | Render local rápido (várias vezes o tempo real), 1080p e 4K, 9:16 | Coberto | — | ◐ (resolução 1080 fixa) |
| 20 | Thumbnails por API de imagem (GPT Image, Nano Banana, Higgsfield) e imagens grátis via Google Flow | Parcial | **Adicionado** providers `google-flow`, `higgsfield` (§7.6-H) | ❌ |
| 20b | Geração de **imagem e vídeo** por API comercial, com saldo de créditos | — | **Implementado** provider **Snapgen.AI** (catálogo `/api/service-prices`; imagem/vídeo por aba; `x-api-key`; §5.5) | ◐ Parcial: vídeo `veo-3.1-fast` validado ao vivo (4 créditos); imagem pendente |
| 21 | Multi-canais (portfólio faceless) por projeto | Ausente | **Adicionado** entidade `Channel` (§7.6-I) | ❌ |
| 22 | Topic finder para qualquer canal por URL, com filtros (todos / longos / shorts / últimos N) e clusterização | Parcial | **Adicionado** filtros (§7.6-J) | ❌ |
| 23 | Routines: template “full channel autopilot”, agendamento (diário/dias/horas), próxima execução visível | Parcial | **Adicionado** template e visor de próxima execução (§7.6-J) | ❌ |
| 24 | Aprender com retenção **e comentários** do YouTube | Parcial (só retenção) | **Adicionado** análise de comentários (§7.6-J) | ❌ |
| 25 | Publicação com aprovação prévia; opções de anúncios e vídeos relacionados | Parcial | **Adicionado** (§7.6-J) | ❌ |
| 26 | Dashboard de uso: custo equivalente em API vs. consumo da assinatura, tokens por tipo (inclui leitura de cache), % do limite semanal | Ausente | **Adicionado** (§7.6-C) | ❌ |
| 27 | “Click anything to change it”: todos os arquivos do projeto (skills, prompts, agentes, automações) visíveis e editáveis | Ausente | **Adicionado** (§7.6-B) | ◐ (rota editável em JSON; prompts fixos no código) |
| 28 | Busca nas configurações | Ausente | **Adicionado** (§7.6-L) | ❌ |
| 29 | Instalação guiada (“Suite Install”) em Windows e Mac | Parcial | **Adicionado** assistente de primeira execução (§7.6-L); Linux também | ❌ |
| 30 | Integração com Blender (cenas 3D) | Ausente | **Adicionado** executor `blender` (§7.6-M) | ❌ |
| 31 | VidIQ via MCP (palavras-chave, outliers) | Ausente | **Adicionado** cliente MCP (§7.6-N) | ❌ |
| 32 | 30+ idiomas de conteúdo; novos idiomas de interface a cada update | Parcial (i18n) | **Esclarecido**: idioma de **conteúdo** (roteiro/TTS) ≠ idioma da **UI** (§7.6-L) | ◐ (campo `language`) |
| 33 | Graphics panel / motion graphics | Coberto (§6.3) | — | ◐ (prompt para o harness; sem templates) |
| 34 | Orientação de duração para retenção (shorts de 60–90 s, absolute watch time) e ultra long form para RPM | Ausente | **Adicionado** consultor de duração (§7.6-O) | ❌ |
| 35 | Custo por vídeo muito baixo usando a assinatura do harness em vez de API | Coberto (§4, §5.3) | **Detalhe**: o painel #26 mostra a economia | ❌ |
| 36 | Planos Standard (5 estilos, 12 exports/mês) e Premium (ilimitado), preço travado, reembolso, comunidade Skool | — | **Fora de escopo**: modelo comercial do Creatorize. FilmForge não impõe limites de exportação nem paywall | n/a |

**Resumo:** das 36 linhas, 8 já estavam totalmente previstas na v1.0, 15 estavam parciais, 12 ausentes e 1 é modelo de negócio (fora de escopo). A v1.1 completa ou detalha todas as parciais e ausentes. Estado do código M0: 1 implementada, 12 parciais, 22 não implementadas; o restante entra nos marcos M1–M4 (§11).

---

## 15. Editor de cenas, projetos e lote (v1.2)

### 15.1 Editor estilo CapCut (aba *Editor*)
- **Preview** (9:16/16:9/1:1) com *Reproduzir tudo*, *Ver vídeo final* e preview da cena selecionada.
- **Timeline** com trilhas Vídeo, Narração, Legendas e Música; régua em segundos e zoom. Largura do clipe = duração da cena.
- **Operações**: arrastar para reordenar; puxar a borda direita para mudar a duração (vira `manualDuration`); multisseleção (Ctrl/Shift);
  atalhos (setas, espaço, Delete); duplicar, excluir e adicionar cena.
- **Inspetor**: título, tipo (`image|video|code|motion|mixed`), duração, narração, visual, câmera, **notas** (entram no prompt de geração).
- Indicadores por clipe do estado de cada etapa (`pending|running|done|failed|stale`).

### 15.2 Edição por prompt
- **Reescrever texto/estrutura (IA)**: instrução livre sobre as cenas selecionadas (ou todas). O modelo da etapa `scene_plan`
  (cadeia com fallback) devolve JSON de *patches*, `insertAfter` e `delete`; o app aplica **somente** às cenas selecionadas.
- **Refazer visual com esta instrução**: grava a instrução em `notes` e regenera só a mídia daquela cena.
- **Regenerar por etapa** (imagem, vídeo, cena por código, narração…) com opção *nova seed* (`variation`).
- Mudar texto/visual/tipo marca as etapas afetadas como `stale`; mudar duração manualmente não regenera mídia.
- Reexecutar a rota usa o cache por conteúdo: edições manuais são preservadas e só o que mudou é refeito.

### 15.3 CRUD
| Entidade | Operações (IPC) |
|---|---|
| Projeto | `project:list/create/get/update/delete/duplicate/batch-create`; duplicar reescreve caminhos absolutos (artefatos e cache). Ids validados contra path traversal. |
| Cena | `scene:add/update/delete/move/duplicate`; `scene:rewrite`, `scene:visual-prompt`, `scene:regenerate`. |
| Execução | `run:start/cancel` (com `only:{stepIds,sceneIds}` e `noCache`), `render:final`. |

### 15.4 Lote
- Criar vários projetos de uma lista (uma ideia por linha) com o mesmo tipo/rota.
- Executar a rota em lote com concorrência configurável; falha de um projeto não interrompe os demais; cancelamento; barra de progresso (`batch.update`).
- Excluir em lote.

### 15.5 Render de cenas por código
Renderizado pelo próprio Electron (BrowserWindow oculta, `capturePage` por frame, `window.__forge.seek(t)`) e montado com ffmpeg.
**Playwright não é dependência do app.**

### 15.6 Limitações conhecidas
- Execução real em Electron, workflows ComfyUI reais (nenhum foi executado contra um ComfyUI de verdade) e argumentos reais de Antigravity/OpenClaw **não foram verificados**.
- Arquivos antigos permanecem ao trocar o tipo da cena até a regeneração.
- Caminhos absolutos ficam no `project.json`.

### 15.7 Workflows ComfyUI incluídos (v1.2.1)
`krea2-turbo-t2i`, `z-image-turbo-t2i` (imagem, nessa ordem de fallback antes da API) e `omnivoice-clone-tts` (narração com voz clonada;
`refAudio` local é enviado ao ComfyUI e injetado em `{{ref_audio}}`). A resolução gerada respeita o formato do projeto, com `maxSide`/`multiple`
por workflow (`fitSize`). `workflows.test.ts` valida variáveis, links entre nós e nó de saída de cada workflow. Vídeo e música: ver §16.

## 16. Wan2GP e novos workflows (v1.3)
- **Novo tipo de binding `wan2gp`** (`{type:'wan2gp', template}`) ao lado de `comfyui`, `api`, `harness`: cada etapa (imagem, vídeo, narração, música) pode usar ComfyUI **ou** Wan2GP, com fallback entre eles na cadeia da rota.
- **Integração:** processo Python persistente (`tools/wan2gp_bridge.py`) que usa a API Python oficial `shared.api` (`init`, `submit_task`, `job.result`, `job.cancel`); protocolo JSON por linha; fila serializada (1 GPU); cancelamento; modelo permanece carregado entre cenas. Operações auxiliares: listar modelos e padrões (UI em *Configurações*).
- **Templates** `workflows/wan2gp-*.json` (`model_type` + `settings` com `{{variáveis}}`, mesmo mecanismo do ComfyUI). Chaves desconhecidas para o modelo geram aviso no log.
- **Workflows ComfyUI adicionados:** `minimax-h3-ref2v`, `minimax-h3-t2v` (vídeo), `yue2-text2music`, `yue2-music-cover` (trilha). Etapa `music` agora é geradora (YuE2 → Wan2GP → biblioteca local como último fallback).
- **Validações:** variável sem valor, workflow em formato de interface (não API) e arquivo de referência ausente falham com mensagem clara e acionam o fallback.
- **Limitações:** a ponte foi testada com um Wan2GP simulado; ids de modelo e chaves não documentados (imagem, TTS, música, imagem inicial) são suposições a confirmar. O workflow Moss Image enviado está no formato UI e precisa ser reexportado como API.



## 17. Rotas, Skills, tipos de vídeo e Configurações (v1.4)

### 17.1 Biblioteca de rotas (aba *Rotas*)
- CRUD completo: criar, duplicar, salvar, excluir rotas; **adicionar, remover, reordenar e editar tarefas** (tipo, escopo, dependências, tentativas, timeout, "se falhar", ativa/inativa).
- Cada tarefa tem uma **cadeia de executores** (1º principal, demais fallback): *harness* (qualquer harness ou `auto` = primeiro disponível; modelo `auto` = padrão do harness), *ComfyUI* (servidor + workflow), *Wan2GP* (modelo/template), *API* (provedor + modelo + voz), *banco de mídia*, *ferramenta interna* ou *manual*.
- Tarefas de mídia (imagem, thumbnail, vídeo, narração, música) listam só os modelos da capacidade correspondente (ex.: imagem → Krea 2, Z-Image…), via `catalog:get` (rótulo/capacidade vêm dos `.map.json` dos workflows).
- Persistência em `workspace/library/routes/*.json`. Rotas padrão são somente leitura (salvar cria cópia). `validateRoute`: ids únicos e válidos, tipos conhecidos, dependências existentes, **ciclos**, tarefa sem executor, bindings válidos. A rota pode ser aplicada ao projeto aberto.

### 17.2 Skills (aba *Skills*)
`Skill{id,name,description,global,steps}`: diretrizes gerais + instrução **por atividade** (por tipo, ex. `code_scene`, ou por id da tarefa). O texto entra no prompt da etapa. Cada projeto guarda um **snapshot congelado** da skill. Persistência em `library/skills`.

### 17.3 Tipos de vídeo (aba *Tipos de vídeo*) = **Rota + Skill**
`CustomVideoType{routeId,skillId,appearance,presentation,mediaSources,aspect,durationSec,language}`. Aparece em *Projetos* (★). Padrões: explicativo vetorial, explicativo paper cut, shorts viral 3D, documentário misto.

### 17.4 Projetos
Formulário: tipo, **aparência** (stickman, vetorial, paper cut, 3D por código, …), **idioma do vídeo**, **apresentação** (gerada | **mista**: motion graphics + imagens/vídeos de bancos), bancos habilitados, template de thumbnail. Tudo isso é **acrescentado ao prompt simples** do usuário (idioma, aparência, apresentação, skill global e da etapa, tempos das palavras e mídias disponíveis da cena). A tabela mostra o **primeiro frame** (`out/first-frame.jpg`, do `final.mp4` ou do 1º visual) e o **tempo total de produção** (`production.totalMs/runs`, somando execuções).

### 17.5 Mídia de bancos e sincronização
- Etapa `stock_media` (por cena `stock`/`mixed`): busca por `searchTerms` no Pexels, Pixabay e Wikimedia Commons, baixa em `scenes/<id>/stock/` e grava `stock.json` com **autor e licença**. Falha numa fonte não derruba as demais; SVG é descartado. Cena `stock` usa a mídia como visual principal; cena `mixed`/`code` recebe os caminhos no prompt para inserir no HTML.
- Etapa `transcribe`: **faster-whisper** (`tools/whisper_words.py`, timestamps por palavra) → `audio/words.json`; sem faster-whisper, `estimate-words` estima proporcionalmente ao texto. Os tempos vão ao prompt das cenas por código/motion para sincronizar gráficos e clipes. Trocar a narração invalida as cenas sincronizadas.

### 17.6 Thumbnail e SEO
Etapa `thumbnail` (opcional, `onFail: skip`): cadeia Krea 2 → Z-Image → Wan2GP → OpenAI `gpt-image-1` → Gemini `gemini-2.5-flash-image`, a partir de **templates** (`{{title}} {{thumb_text}} {{style}} {{idea}}`) editáveis em *Configurações*. Gerada só em 16:9 (YouTube). Etapa `metadata` gera título (≤60), descrição SEO (gancho, capítulos com tempo, créditos, hashtags), tags e texto da thumb.

### 17.7 Aba *Configurações*
Sub-abas (com **ícone** em cada uma): **Harnesses** (comando/Base URL, argumentos, modelo padrão, **esforço padrão** *Default/Low/High/Max* quando o modelo aceita; *Testar/detectar*, *Consultar modelos*, *Testar prompt*; inclui **Ollama** por Base URL via `/api/tags` e `/api/chat`), **ComfyUI / Wan2GP** (servidores com *Testar*, workflows padrão, pasta/python do Wan2GP, lista manual `modalidade|modelo`), **APIs de voz / imagens / vídeos / músicas** (OpenAI-compatível, Gemini, Seedance, **Snapgen.AI**; chave criptografada; categorias; *Testar* - no Snapgen o teste mostra o **saldo de créditos** e carrega os **modelos de imagem/vídeo por aba**), **Bancos de mídia** (chaves + *Testar*), **Whisper e thumbnails** (python/modelo/dispositivo, templates, workspace, ffmpeg). A sub-aba de APIs de imagem/vídeo também oferece o **esforço** por tarefa na edição das rotas (§4.7).

### 17.8 Fora do escopo desta versão (planejado)
- **Módulo de upload** com Playwright (YouTube, TikTok, Facebook, Kwai…), separado do app.
- **Módulo web em VPS** que conversa com o app no PC (.exe) via **Tailscale**.

### 17.9 Limitações conhecidas (honestidade)
- **Seedance** (BytePlus ModelArk): fluxo criar tarefa + consultar implementado a partir da documentação pública; **não verificado** contra o serviço real.
- **Snapgen.AI**: endpoints, parâmetros e créditos seguem a documentação oficial e o catálogo público (§5.5). O vídeo `veo-3.1-fast` foi validado ao vivo (8 s, 4 créditos); a imagem ainda depende de validação com a chave `x-api-key`. O código trata resposta síncrona (`status:2`), *polling* do histórico, erro (`status:3`), download por URL/base64 e exibe `used_credit`/`estimated_credit` no log. Grok (SSE/Bearer) e `sd-2`/vids ficam fora do adaptador.
- **APIs de música**: não há cliente de API além de ComfyUI/Wan2GP (a aba existe para configurar e já aceita provedores, mas nenhum executor de música por API foi escrito).
- Chaves de Pexels/Pixabay e formatos exatos de resposta foram testados contra um servidor simulado, não contra os serviços reais.
- *Testar prompt* e *Consultar modelos* de CLIs dependem do que cada CLI instalada suporta (modelos só são listados no OpenCode e no Ollama).
- Os campos de pastas input/output do ComfyUI (vistos no seu print) **não** foram implementados, para não simular algo que o motor não usa (os arquivos trafegam pela API HTTP).
- A interface foi testada com Playwright sobre o HTML real e uma API simulada; o app Electron empacotado não foi executado aqui.

## GTA VI YouTube quality (v1.4)

- Rota `gta6-quality`: script/scene_plan (Antigravity), narração OmniVoice com voz de referência, transcrição, stock YouTube curado de gameplay GTA VI, imagem (Krea 2/Z-Image), vídeo generativo (MiniMax H3), cena de código, legendas, trilha da biblioteca, montagem com `musicVolume: 0.15` (15%) e masterização `loudnorm` em -14 LUFS/48 kHz.
- A lista curada de YouTube evita mods de GTA V/concept trailers e usa semente por projeto/cena para variar os clipes.
- A etapa `review` usa o agente `revisor-youtube` e grava `out/review.json` com nota 0–10, critérios, problemas e correções.
- O `clip-musical` aceita compilações de 2 a 6 min, 2–15 faixas, workflow instrumental `yue2-instrumental.json` com `[instrumental]`, e `perTrackLoop` (um loop por faixa ou loop único).

---

## 18. Executores por etapa, plugins com motor próprio, pesquisa e robustez (v1.6)

### 18.1 Executor por etapa (balanceamento da rota)
A rota diz **o que** fazer; o perfil de provedores diz **quem** faz por categoria (texto, código, imagem, vídeo, voz, música). A v1.6 acrescenta o nível mais fino: **quem faz cada etapa**.
- **Funções** (`ROLE_OF`, `src/shared/profiles.ts`): 📝 *Planejamento* (`ideation`, `brief`, `script`, `scene_plan`, `asset_design`) · ⚙️ *Execução* (`code_scene`, `motion_graphics`, `free`) · 🔎 *Revisão* (`review`, `metadata`). Só etapas de texto/código, ativas e não travadas pela rota (`profileSkips`) entram (`stepTargets`).
- **Ordem de precedência** na criação do projeto: rota → perfil (`executorProfile`) → categorias só deste projeto (`executorChains`) → **etapas** (`executorSteps: Record<stepId, Binding>`, `applyStepBindings`). A escolha vira o executor principal; os anteriores ficam como **reserva** (fallback), sem repetir o mesmo harness.
- **⚖ Balancear** (`balanceRoles`): distribui as funções entre os harnesses instalados para dividir a cota — planejamento no mais forte, execução (uma chamada por cena) num harness local (Ollama/LM Studio/llama.cpp) quando houver, revisão no segundo mais forte.
- **Novo projeto → 🎛 Provedores → Escolher provedores…**: seção *Por etapa*, com um seletor por função, ajuste etapa a etapa (harness + modelo) e resumo no formulário ("Roteiro → Claude Code · Cena por código → Ollama · SEO → Antigravity"). Trocar a rota limpa as escolhas por etapa.

### 18.2 Trocar executores de um projeto existente (Editor)
- **Editor → 🎛 Executores** (`openProjectExecutorsModal`): todas as etapas da rota **do projeto** (a da biblioteca não muda), com harness, **modelo** e **esforço** por etapa, os seletores por função, *Balancear*, *Desfazer* e *Trocar…* (qualquer executor em cartões: API, ComfyUI, Wan2GP, Flow). Etapas alteradas ficam destacadas ("era Ollama"), com as reservas visíveis.
- **💾 Salvar**: grava a rota do projeto (`project:save-route`); vale para as etapas pendentes e próximas execuções (*Continuar*). Etapas já concluídas **não** mudam sozinhas, porque o cache aceita qualquer executor da cadeia.
- **💾 Salvar e refazer**: `project:redo-steps` refaz **sem cache** as etapas alteradas **e todas as que dependem delas** (`downstreamSteps`, fecho transitivo de `dependsOn`), mais legendas e montagem. A janela mostra antes a lista exata do que será refeito.
- **↻ Regerar cena → 🎛 Executor desta vez**: refaz só as cenas escolhidas com outro harness/modelo (ex.: a cena 4 saiu fraca no Ollama → Antigravity). Grava `scene.overrides[stepId]` (o motor já usava overrides por cena, §6.4), com o executor da rota como reserva; *voltar ao da rota* remove o override. Vale para etapas de texto/código.

### 18.3 Fallback e harnesses
- **Reservas da rota** (`route.harnessFallback`): esgotada a cadeia de uma etapa, entram os harnesses indicados pela rota (ou a ordem `AUTO_ORDER`, só os instalados). A cadeia cresce uma vez.
- **Pulo sem gastar tentativas**: harness não instalado e **API sem chave ou não configurada** vão direto para o próximo da cadeia, com aviso no log.
- **Prompt longo em CLI** (`promptVia: 'arg'`, ex.: Antigravity, OpenCode, Codex): acima do limite da linha de comando do Windows (≈28 mil caracteres; 7 mil via `.cmd`) o prompt vai num arquivo temporário `.forge-prompt-*.md` na pasta de trabalho e o argumento manda o agente lê-lo. Evita `spawn ENAMETOOLONG`. O arquivo é removido ao fim.
- **Ollama — janela de contexto**: `num_ctx` acompanha o tamanho do pedido (`ollamaCtx`: 24k–48k tokens; fixo via `HarnessConfig.numCtx`). Antes de cada rodada, `fitContext` resume os resultados de ferramentas mais antigos (nunca o pedido nem o resultado mais recente). Cada resultado de ferramenta tem teto proporcional à janela. Se ainda assim vier `no user query found in messages` (o Ollama descartou o pedido), o histórico é resumido e a chamada repetida.
- **Antigravity**: `--output-format stream-json` (ferramentas e texto ao vivo no log; uso real de tokens registrado por conta), nova tentativa em `invalid model selection`.
- **Uso/créditos** (Automações → Uso): leitura de Claude, Codex, OpenCode, Antigravity (por conta, sessão e semana) e créditos do Google Flow.
- **Contas por projeto**: `agyAccount` (Antigravity) e `flowAccount` (Flow). O login é sempre feito pelo usuário no navegador da conta; o app não guarda senhas e **não** troca de conta sozinho ao esgotar créditos.

### 18.4 Plugins com motor próprio (`.claude-plugin`)
Instalação por URL, `.zip` ou `.plugin` (exportar/importar). `detectKit` reconhece quatro tipos (`src/main/kit.ts`):

| Tipo | Exemplo | Como o FilmForge usa |
|---|---|---|
| `player` | aiTrends 2D Studio | cada cena vira um *shot* do motor (`registerShot`); `kit_assets` cria elenco e cenários; correção de erros e revisão visual por 3 quadros |
| `pages` | lemo-opuscar | biblioteca de estilos (`_library`: `core/lib.js` + `styles/*/STYLE.md`); cada cena é uma página `READY`/`render(t)`/`DUR` no estilo escolhido; fontes ausentes vêm do Google Fonts ou da fonte de reserva |
| `node-film` | claude-animation | `lib/film.mjs` com `run()` roda no navegador por *shims* (`path`, `fs`, `@napi-rs/canvas`…); prévia e biblioteca de desenho nas cenas por código |
| `piece` | animate | peças montadas num HTML; por enquanto só a prévia |

- Render pelo protocolo `forge-scene://` (montagens `/project/`, `/@film/`, `/node_modules/`) numa sessão separada (`forge-render`) com rede bloqueada; dependências npm baixadas como tarball (sem Playwright/Puppeteer).
- **Prévia de 2–3 s** na escolha do plugin e por estilo; **estilo do motor por projeto** (`pluginStyles`), editável no editor com re-render sem IA (`kit:rerender`).
- Rota `kit-2d-cinematic`: roteiro → plano → narração → transcrição → `kit_assets` → cenas (`kitQc`) → efeitos → trilha por código.
- **Skill a partir de documento** (`.docx`/`.md`/`.txt`) gerada por um harness à escolha (testado só com Antigravity).

### 18.5 Pesquisar (antes "Obter vídeos")
Busca no YouTube por termo, **tipo de vídeo** (lista `yt-video-types`) ou os dois; favoritos (marcar, selecionar, remover); *criar skill deste vídeo*; **clonar canal** (vertentes do nicho, marca, banner, thumbnail, demo de 10 s, skill + rota + template de thumbnail, retomável); *Analisar resultados com IA* com harness/modelo à escolha, inclusive Ollama local, e dica de modelo. Envio ao YouTube como **não listado** (`youtube-upload`).

### 18.6 Robustez de áudio
- `sfx.wav` e as partes de efeito são gravados num temporário e só substituem o arquivo final se forem **WAV válidos** (`validWav`: RIFF/WAVE e maior que o cabeçalho). Falha ou interrupção não deixa arquivo de 0 byte.
- A montagem (`assemble`) e o editor ignoram um `sfx.wav` inválido com aviso no log em vez de derrubar a etapa `edit`. Basta refazer "Efeitos sonoros" na cena.

### 18.7 Interface
Indicador animado de execução na barra lateral; troca de idioma pt-BR/EN/ES sem reiniciar; opções de clipes do YouTube localizadas.

### 18.8 Limitações conhecidas (v1.6)
- Modelos locais pequenos (≈9B) ficam abaixo dos harnesses em nuvem em `kit_assets` e cenas por código complexas. Use *Executores* para trocar a etapa e refazer.
- A troca de executor por cena (*Regerar*) vale só para etapas de texto/código. Para mídia, troque a etapa inteira em *Executores → Trocar…*.
- O tipo `piece` ainda não tem adaptador de produção.
- O *Balancear* usa a ordem fixa de força dos harnesses; não mede cota restante.

**Manual de uso:** Manual.MD (app + MCP).
