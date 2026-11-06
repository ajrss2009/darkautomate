# SPECS.md — FilmForge (especificação técnica do estado atual)

> Documento de referência do **que o app é hoje**, módulo por módulo. O `SPEC.md` continua sendo o
> documento de concepção original (produto, inspirações e roadmap); este arquivo descreve a
> implementação atual, incluindo as features mais recentes (provedores, plugins, ferramentas,
> servidor MCP, skills em Markdown, i18n).
>
> Versão do documento: 2.0 · Atualizado em: 2026-10-21 · App: FilmForge 0.1.0 (Electron 33 + TypeScript)

---

## 1. Visão geral

FilmForge é um **estúdio desktop de produção de vídeo por IA**, orientado a **cenas** e a **rotas**
configuráveis. Cada etapa da produção é executada por um **provedor** (CLI de agente ou servidor
local de modelo), por uma **API comercial**, por **ComfyUI**, por **Wan2GP** ou por uma
**ferramenta interna** — sempre com **fallback em cadeia**.

Conceitos centrais:

| Conceito | O que é |
|---|---|
| **Projeto** | Um vídeo: ideia, formato, idioma, cenas, rota congelada, skill, agentes, plugins, log e parâmetros da última execução. |
| **Cena** | Unidade de produção (título, narração, legenda, intenção visual, duração, tipo, status por etapa, artefatos). |
| **Rota** | Sequência ordenada de **etapas** (`RouteStep`) com escopo `project` ou `scene`, dependências, executores e fallbacks. |
| **Etapa** | Um passo (roteiro, plano de cenas, imagem, vídeo, narração, montagem, SEO…). |
| **Skill** | O "tipo de vídeo": aparência, rota sugerida, padrões, instruções globais e por etapa. Guardada em **Markdown**. |
| **Agente** | Orquestrador (escreve o brief) ou obreiro (assume etapas), com provedor/modelo próprios. |
| **Provedor** | Fonte de execução: `claude`, `opencode`, `codex`, `antigravity` (agy), `openclaw`, `ollama`, `llamacpp`, `lmstudio`, APIs, ComfyUI, Wan2GP, bancos de mídia, ferramentas internas. || **Plugin** | Pacote no **formato do Claude** (`.claude-plugin/plugin.json` + skills/commands/agents/hooks/MCP) cujas instruções entram no prompt. |
| **Servidor MCP** | O próprio app expõe ferramentas/recursos via **Model Context Protocol** (stdio). |

---

## 2. Arquitetura

```
src/
  main/            processo principal (Node/Electron)
    main.ts        janela, IPC, execução (startRun), migrações, modo MCP
    engine.ts      motor de rotas: ordem, cache, retries, fallback, gates, progresso, pré-checagem
    executors.ts   implementação de cada tipo de binding
    harness.ts     provedores CLI/HTTP, detecção, modelos, ferramentas, execução
    tools.ts       ferramentas locais (arquivos, HTTP/REST, busca, comandos) p/ provedores HTTP
    mcp.ts         servidor MCP (JSON-RPC por stdio) + catálogo de ferramentas
    plugins.ts     instalação/leitura de plugins e montagem do prompt
    prompts.ts     construção do prompt de cada etapa (skill, estilos, memórias, plugins, refs)
    library.ts     CRUD de rotas/skills(MD)/tipos/agentes + importar/exportar
    settings.ts    defaults, criação de projeto, pastas
    ops.ts         CRUD de projetos/cenas (arquivos em disco)
    presets.ts     rotas, tipos de vídeo e aparências embutidos
    comfyui.ts / wan2gp.ts / providers.ts / stock.ts / whisper.ts / ffmpeg.ts / render.ts
    production.ts  estatísticas de execução e primeiro frame
    batch.ts       execução em lote
    editor.ts      edição de cenas por prompt (JSON patches)
  preload/         ponte segura (contextBridge) — API `window.forge`
  renderer/        interface (sem framework)
    renderer.ts    abas Projetos/Novo/Lote/Editor/Execução + i18n + eventos do motor
    library-ui.ts  abas Rotas/Skills/Tipos/Configurações
    agents-ui.ts   aba Agentes
    i18n.ts        dicionário pt-BR → en/es aplicado ao DOM
    icons.ts       ícones SVG de traço
  shared/types.ts  tipos e rótulos compartilhados
  test/            testes (rodam com Node, sem Electron)
```

Comunicação: `renderer → preload (ipcRenderer.invoke) → main (ipcMain.handle)` devolvendo
`{ ok, data | error }`; eventos do motor fluem por `run:event` (`win.webContents.send`).

---

## 3. Motor de execução

- **Ordenação** por `dependsOn` (topológica, estável) — `orderSteps`.
- **Cache por etapa/cena** em `<projeto>/cache/index.json` (chave = hash de etapa+entrada), o que
  permite **parar e continuar** sem refazer o que já saiu.
- **Cadeia de executores**: `bindings[0]` é o principal; os demais são fallback, tentados em ordem
  com `retry.max`/`backoffMs` e evento `step.fallback`. **Provedor não instalado não é tentado**:
  a etapa pula direto para o próximo da cadeia (sem gastar retries).
- **Escopos**: `project` (uma execução) e `scene` (uma por cena, com `onlySceneKinds` opcional).
- **Cenas em paralelo**: `project.sceneConcurrency` ou `settings.defaults.sceneConcurrency`
  (1–8). Etapas de GPU local (ComfyUI/Wan2GP) ficam **uma por vez**; texto/API/provedor rodam em
  paralelo. `runScenePipeline` percorre as etapas de cena por cena com semáforos por etapa.
- **Limites**: `maxProductionMin` (aborta a execução), `timeoutSec` por etapa, cancelamento por
  `AbortController` (propaga para os processos filhos).
- **Progresso** (`run.progress`): modo **cenas** (quando o projeto tem cenas) ou **entregáveis**
  (etapas de projeto), com `done`, `total`, `elapsedMs` e **ETA** pela média por unidade concluída.
- **Pré-checagem** (`run.preflight`): ao iniciar, resolve o provedor/modelo de cada etapa (inclusive
  `auto`), confere se o comando existe e publica a lista — aparece na aba Execução, no log e na
  linha `provedor/modelo da rota` do editor.
- **Estados de cena por etapa**: `pending | running | done | failed | skipped | stale`; editar um
  campo visual/áudio marca `stale` e dispara regeneração quando pedido.
- **Log persistido**: cada execução grava linhas com hora em `project.log` (consultável depois,
  inclusive pelo MCP).

---

## 4. Projetos (dados em disco)

```
<projectsDir>/<id>/
  project.json      projeto completo (cenas, rota congelada, skill, plugins, params, log)
  scenes.json       espelho só das cenas (lido pelo modelo na etapa scene_plan)
  script.md, brief.md, ideas.json, metadata.json, thumbnail.png …
  scenes/<sNN>/     frame.png, clip.mp4, code.mp4, motion.mp4, audio/, stock/, sfx/, words.json
  out/              final.mp4, subtitles.srt, music.*
  cache/index.json  cache por etapa/cena
  edits/<ts>/       respostas JSON da edição por prompt
```

`project.json` guarda também: `params` (rota, qualidade, formato, idioma, concorrência, tempo
máximo, **plugins** e o executor de cada etapa) e `log` (últimas execuções).

---

## 5. Rotas, skills, tipos e agentes

- **Rotas**: CRUD na aba Rotas; `validateRoute` checa ids, tipos, escopos, executores e ciclos.
  **Exportar/importar em JSON** (por rota ou todas). Rotas padrão são somente leitura.
- **Skills**: guardadas em **`<workspace>/library/skills/<id>.md`** (front-matter YAML + seções
  `## Global` e `## Etapa: <id>`), legíveis/editáveis fora do app. JSON antigo é migrado
  automaticamente. **Exportar/importar em Markdown**; importar nunca sobrescreve (cria `-2`, `-3`…).
- **Tipos de vídeo** (`CustomVideoType`): combinam rota + skill + aparência + apresentação.
- **Agentes**: orquestrador escreve `brief.md` (todas as raízes passam a depender dele); obreiros
  assumem etapas por `handles` (id ou tipo) e podem ter provedor/modelo próprios.
- **Dobras de nicho** (`NicheFold`): entidade persistente em **`<workspace>/library/folds/<id>.json`**
  (um arquivo por dobra). Campos: `name`, `channel` (slug da marca), `angle`, `why`, `audience`,
  `exampleTitles`, `skillId`, `routeId`, `chosen` (uma ativa por canal), `status`
  (`idea → testing → scaling → retired`), `createdAt/updatedAt`. O clone de canal salva as 10 dobras
  automaticamente (`ensureFolds`, idempotente: re-clonar não duplica nem desfaz a escolha do usuário).
  `fold:choose` marca a ativa; `fold:apply` grava o bloco `<!-- dobra:start --> … <!-- dobra:end -->`
  em `skill.global` (vai no prompt de toda etapa, ver `prompts.skillText`) e a nota `🔗` em
  `outputStyle`, de forma idempotente. Projetos guardam `foldId` + cópia `fold` (nome/canal/ângulo);
  `fold:list` devolve `metrics` agregadas (projetos e último uso).

---

## 6. Provedores (harnesses)

`settings.harnesses` mapeia `HarnessId → HarnessConfig`:

| id | tipo | comando/base | observações |
|---|---|---|---|
| `claude` | CLI | `claude` | prompt por stdin, `--permission-mode acceptEdits` |
| `opencode` | CLI | `opencode` (ou `opencode-cli.exe` do OpenCode Desktop) | `run --model … --auto` |
| `codex` | CLI | `codex exec --full-auto` | |
| `antigravity` | CLI | `agy` (`%LOCALAPPDATA%\agy\bin\agy.exe`) | `--model … --mode accept-edits --dangerously-skip-permissions --print "<prompt>"`; modelos por `agy models` |
| `openclaw` | CLI | `openclaw agent --message` | |
| `ollama` | HTTP | `http://127.0.0.1:11434` | protocolo `ollama` (`/api/chat`) |
| `llamacpp` | HTTP | `http://127.0.0.1:8080` | protocolo `openai` (`/v1/chat/completions`) |
| `lmstudio` | HTTP | `http://127.0.0.1:1234` | protocolo `openai` |

Regras:

- **Descoberta**: comando procurado no PATH e em caminhos conhecidos (ex.: `agy`, `opencode-cli`).
- **Detecção**: CLIs por `--version`; HTTP por `/api/tags` (Ollama) ou `/v1/models` (OpenAI-compat).
  Um comando inexistente **nunca** conta como instalado.
- **Modelos**: `Consultar modelos` usa `agy models` (Antigravity), `opencode models`, ou as APIs HTTP.
- **`auto`**: primeira opção instalada na ordem `claude → antigravity → codex → opencode → openclaw
  → ollama → lmstudio → llamacpp` (cache de 30 s), com motivo da falha quando nenhuma responde.
  **As rotas embutidas usam `auto` como executor principal** (fallback para a API OpenAI), então um
  projeto novo funciona com o que estiver instalado — sem começar por um provedor ausente.
- **Rota congelada**: o projeto guarda uma cópia da rota. Se a rota da biblioteca mudar, o editor
  avisa (`⚠ a rota deste projeto está diferente…`) e oferece **"Aplicar rota atual"**.
- **Execução no Windows**: `.exe` roda **sem shell** (preserva acentos/quotes); só `.cmd/.bat`
  (shims do npm) usam `cmd.exe`. Saída é emitida em **linhas completas**.
- **Ferramentas** (`tools: true`, padrão nos HTTP): o modelo pode chamar
  `list_files`, `read_file`, `write_file`, `http_request`, `web_search`, `run_command`, executados
  pelo app **confinados à pasta do projeto**; cada chamada aparece no log. Se o modelo não aceita
  tools, a execução segue sem elas.

### APIs de mídia (voz, imagem, vídeo, música)

`settings.providers` (Configurações → **APIs de voz / imagens / vídeos / músicas**) — `kind` decide
o adaptador em `providers.ts`:

| kind | uso | detalhes |
|---|---|---|
| `openai` | texto, imagem, voz | `/chat/completions`, `/images/generations`, `/audio/speech` |
| `gemini` | texto, imagem, voz | `generateContent`, `generateContent` de imagem, TTS (`gemini-2.5-*-preview-tts`) |
| `seedance` | vídeo | BytePlus ModelArk (tarefas assíncronas) |
| `snapgen` | imagem, vídeo | `x-api-key`, saldo em `/uapi/v1/account` |
| **`fish`** | **voz (TTS)** | **Fish Audio** — ver abaixo |

**Fish Audio** (`kind: 'fish'`, padrão `https://api.fish.audio`):

- `POST /v1/tts` com `Authorization: Bearer <chave>`, `Content-Type: application/json` e o **modelo no
  header `model`** (`s2.1-pro-free` = nível gratuito; também `s2.1-pro`, `s2-pro`, `s1`, `drama-3`).
  Corpo: `text`, `format: 'mp3'`, `normalize`, `prosody` e `reference_id` (a **voz**).
- **Voz** = `reference_id`: id de um modelo de voz da conta/biblioteca. Aceita o id puro ou o link
  `fish.audio/m/<id>` (o id é extraído). Sem voz, o servidor usa a voz padrão da conta.
- `drama-3` aceita direções de tom em colchetes; a instrução de narração é prefixada como `[tom] texto`.
- **Testar** valida a chave e carrega as vozes: as da conta (`GET /model?page_size=100&self=true`) e as
  mais usadas da **biblioteca pública** (`sort_by=task_count&licensed=true`, filtradas pelo idioma do app —
  `language=pt` para pt-BR). Guarda `id → título` em `provider.voiceLabels`; a interface mostra o título
  e o ▶ de cada voz gera uma amostra (cacheada por voz + idioma, em `library/voice-preview`).
- `s1` será descontinuado em 31/12/2026 (o Fish passa a atender essas chamadas com `s2.1-pro`).

**ffmpeg/ffprobe**: `resolveBin()` (ffmpeg.ts) não depende de caminho fixo nem de configuração manual —
a **cópia embutida no app tem prioridade**: `win-unpacked\ffmpeg\` (ao lado do `FilmForge.exe`) e
`resources\tools\ffmpeg\win\` (empacotado de `tools/ffmpeg/win`). Depois procura no `PATH`, em
`%LOCALAPPDATA%\Microsoft\WinGet\Links`, `%ProgramFiles%\ffmpeg\bin` e em pastas `*ffmpeg*` de
Downloads/Documentos/home (`bin/`). Se o caminho configurado em Configurações → Aplicação → Geral sumir,
volta a procurar em vez de falhar. O botão **🔍 Detectar ffmpeg** (IPC `ffmpeg:detect` → `detectBins()`)
preenche os dois campos com o que encontrou. Assim o app funciona mesmo sem ffmpeg instalado e mesmo que
o antivírus bloqueie o executável de outra pasta.

**Rede corporativa / TLS**: em redes com inspeção de TLS (CA própria no Windows, PAC), o `fetch` do
Node falha com `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` ("fetch failed" na interface). Por isso o processo
principal usa `src/main/http.ts` → `httpFetch()`: `net.fetch` do Electron (pilha do Chromium, que
confia nos certificados do Windows e usa o proxy/PAC do sistema) e, para `127.0.0.1`/`localhost`,
o `fetch` do Node (servidores locais nunca passam pelo proxy). Nos testes em Node puro cai no `fetch`
global.

---

## 7. Ferramentas locais (`src/main/tools.ts`)

| Ferramenta | Uso |
|---|---|
| `list_files` | lista a pasta (recursivo opcional) |
| `read_file` / `write_file` | lê/grava texto (com `append`), cria pastas |
| `http_request` | GET/POST/PUT/DELETE para APIs REST (corpo truncado, timeout 60 s) |
| `web_search` | busca no DuckDuckGo (título, link, resumo) |
| `run_command` | comando no sistema dentro do projeto (ffmpeg, python…), saída limitada |

Confinamento: todo caminho é resolvido e validado contra as raízes liberadas (projeto + pasta da cena).

---

## 8. Plugins (formato Claude)

- Pasta com `.claude-plugin/plugin.json` (+ opcional `skills/`, `commands/`, `agents/`, `hooks/hooks.json`,
  `.mcp.json`), instalável **de uma pasta** ou **de uma URL do GitHub** (baixa o zip, extrai e acha
  o manifesto). Ficam em `<workspace>/plugins/<id>`.
- **Por projeto** (`project.plugins[]`, opcional): as instruções do plugin entram no prompt de todas
  as etapas, além da diretiva `use [nome do plugin]` — o harness não tem o plugin instalado, então o
  texto é o que realmente muda a saída.
- Na UI: instalar/remover/listar e **"Ver o que vai no prompt"** (Configurações → Plugins).
- Vídeo livre é exceção: o prompt enviado é **só o texto do usuário** + a linha de entrega.

---

## 9. Servidor MCP (o app como MCP server)

Ativação: **`FilmForge.exe --mcp`** (sem janela; protocolo em stdout, diagnósticos em stderr).
Implementação em `src/main/mcp.ts` (JSON-RPC 2.0 / MCP `2024-11-05`).

- **Handshake**: `initialize` → `capabilities.tools` + `capabilities.resources`, `serverInfo`
  `filmforge`, `instructions` com o fluxo recomendado.
- **Notificações** (`notifications/initialized|cancelled`) não geram resposta; métodos
  desconhecidos devolvem `-32601`; JSON inválido devolve `-32700`.
- **Stdio no Electron**: o processo gráfico fecha o stream de `stdin`; o servidor detecta isso e
  passa a ler o **descritor 0** diretamente (por isso funciona empacotado).
- **15 ferramentas**:

| Ferramenta | Para quê |
|---|---|
| `filmforge_projects` | listar projetos (status, cenas, vídeo final, rota, skill) |
| `filmforge_project` | detalhar projeto (cenas, status por etapa, arquivos, log) |
| `filmforge_create_project` | criar projeto (skill/rota/formato/idioma/qualidade/plugins/concorrência) |
| `filmforge_run` | executar a rota (assíncrono; `resume` continua do cache; `stepIds`/`sceneIds` filtram) |
| `filmforge_cancel` | parar a execução (mantendo o que já saiu) |
| `filmforge_status` | rodando?, progresso (cenas/entregáveis), ETA, parâmetros, cauda do log |
| `filmforge_log` | log da última execução |
| `filmforge_render_final` | remontar `out/final.mp4` |
| `filmforge_scene_update` | editar cena (e regerar a mídia, opcional) |
| `filmforge_skills` / `filmforge_routes` | biblioteca |
| `filmforge_providers` / `filmforge_provider_models` | provedores, disponibilidade e modelos |
| `filmforge_plugins` | plugins instalados (e o prompt injetado) |
| `filmforge_settings` | configurações com **chaves de API mascaradas** |

- **Recursos**: `filmforge://projects`, `filmforge://project/{id}`, `filmforge://project/{id}/log`,
  `filmforge://library/skills`, `filmforge://library/routes`, `filmforge://providers`.
- **Configuração do cliente** (Configurações → MCP, com botão copiar):
  ```json
  { "mcpServers": { "filmforge": { "command": "C:\\caminho\\FilmForge.exe", "args": ["--mcp"] } } }
  ```
- **Teste embutido**: o botão "Testar servidor MCP" sobe o servidor, faz o handshake e informa
  protocolo + número de ferramentas.

---

## 10. Interface

- **Abas**: Projetos, Novo projeto, Lote, Editor, Execução, Rotas, Skills, Agentes, Configurações.
- **Projetos**: filtros, miniatura (primeiro frame), status, tempos, ações por linha — Editar,
  Executar/**Parar**, **Continuar**, **↻ Atualizar**, Lote, Duplicar, Renomear, Pasta, Excluir.
- **Editor** (estilo CapCut): palco com prévia (vídeo/imagem/narração/legenda/efeitos), transporte
  (**Reproduzir a cena**, `tudo`, parar, anterior/próxima), timeline com trilhas (vídeo, narração,
  legendas, música), arrastar para reordenar, puxar a borda para duração, inspetor de cena,
  efeitos, legendas, "Reescrever com IA", "Refazer visual", regenerar etapa, produção
  (tempo máximo, cenas simultâneas, plugins) e **barra de progresso com ETA**.
- **Execução**: barra de progresso, **pré-checagem** (provedor/modelo por etapa), parâmetros da
  última execução e log (com prévias de mídia).
- **Configurações**: Pastas · Aplicação (idioma da interface + tema) · Produção (cenas em paralelo) ·
  **Providers (provedores)** · ComfyUI/Wan2GP · APIs (voz/imagem/vídeo/música) · Bancos de mídia ·
  Plugins · **MCP** · Whisper/thumbnails.
- **Idioma**: pt-BR, en, es (dicionário aplicado ao DOM + `t()`; o que não tem tradução fica em pt-BR).
  O idioma **do vídeo** é por projeto.

---

## 11. APIs internas (IPC)

`window.forge` (preload) — principais grupos:

- **Biblioteca**: `meta`, `catalog`, `listRoutes/saveLibRoute/deleteLibRoute/validateRoute`,
  `listSkills/saveSkill/deleteSkill`, `listVTypes/saveVType/deleteVType`, `listAgents/saveAgent/deleteAgent`,
  `exportRoute/importRoutes/exportSkill/importSkills/exportLibrary`.
- **Dobras de nicho**: `listFolds`, `saveFold`, `deleteFold`, `chooseFold`, `applyFold`, `ensureFolds`.
- **Projetos**: `listProjects`, `refreshProject`, `createProject`, `getProject`, `updateProject`,
  `deleteProjects`, `duplicateProject`, `batchCreate`, `saveRoute`, `projectMedia`, `openFolder`,
  `projectsRoot`, `setProjectsDir`.
- **Cenas**: `addScene`, `updateScene`, `deleteScenes`, `moveScene`, `duplicateScene`,
  `rewriteScenes`, `visualPrompt`, `regenerate`, `renderFinal`.
- **Execução**: `run`, `resume`, `cancel`, `runBatch`, `cancelBatch`, `onEvent`.
- **Provedores**: `testHarness`, `harnessModels`, `testPrompt`, `detectHarnesses`, `toolList`.
- **Plugins**: `listPlugins`, `installPluginFolder`, `installPluginUrl`, `removePlugin`,
  `openPluginsFolder`, `pluginPrompt`.
- **MCP**: `mcpInfo`, `mcpSelftest`, `copyText`.
- **Outros**: `getSettings/setSettings`, `setTheme`, `openFile/openDir`, `importMedia`, `skillPreviews`,
  `mediaUrl` (protocolo `forge-file://`, restrito ao workspace).

---

## 12. Configurações (`settings.json`)

`workspace`, `projectsDir`, `ffmpeg`/`ffprobe`, `harnesses` (com `protocol`, `tools`, modelos),
`comfyServers`, `wan2gp`, `wan2gpModels`, `defaults` (workflows + `sceneConcurrency`), `stock`,
`whisper`, `thumbnails`, `providers` (APIs), `memories`, `theme`, `uiLanguage`, `pluginsDir`.
Chaves de API são criptografadas (`safeStorage`) e **mascaradas** quando expostas ao MCP.
Migrações automáticas no boot: argumentos do opencode (`--auto`), protocolo/ferramentas dos HTTP,
config do Antigravity (`agy`, `--print`, `promptVia: arg`, modelos), skills JSON → Markdown.

---

## 13. Testes e build

- **Testes** (`src/test`, rodam com Node puro): `engine`, `ops`, `library`, `skills`, `features`,
  `workflows`, `wan2gp`, `e2e`. Cobrem cache/retries/fallback, concorrência, progresso (cenas e
  entregáveis), pré-checagem, vídeo livre, plugins, ferramentas, MCP, skills em MD, import/export,
  biblioteca e ffmpeg (quando disponível). Diagnósticos avulsos: `harness.diag`, `agy.diag`, `auto.diag`.
- **Build**: `node scripts/build.mjs` (esbuild: main, preload, renderer, testes).
- **Instaladores**: `node node_modules/electron-builder/out/cli/cli.js --win --publish never`
  → `release/win-unpacked`, `release/FilmForge 0.1.0.exe` (portátil) e `release/FilmForge Setup 0.1.0.exe`.
- **Utilitários**: `scripts/pack-asar.cjs` (reempacotar o asar sem electron-builder),
  `scripts/check-asar.cjs` (conferir o conteúdo do asar), `scripts/mcp-smoke.cjs` (teste de fumaça do MCP).

---

## 14. Limites conhecidos

- Vídeo por IA depende de ComfyUI/Wan2GP/API externa; os CLIs de agente cobrem texto, código e
  montagem (via `ffmpeg`).
- Provedores HTTP sem suporte a tools seguem sem ferramentas (o modelo não grava arquivos sozinho).
- O idioma da interface cobre os textos do dicionário; textos dinâmicos fora dele ficam em pt-BR.
- O servidor MCP não abre porta: é stdio por processo (um cliente por instância).
