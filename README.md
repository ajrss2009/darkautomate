# FilmForge

Estúdio desktop (Electron + TypeScript) de vídeo por IA, orientado a **cenas** e **rotas configuráveis**.
Cada etapa roda em um **harness** (Claude Code, OpenCode, Codex, Antigravity, OpenClaw), em **ComfyUI** (modelos locais) ou numa **API comercial**, com **fallback em cadeia**.

Especificação completa: [SPEC.md](./SPEC.md).

## Executar

```bash
npm install
npm start            # compila e abre o app
npm test             # motor, CRUD/edição/lote, biblioteca/bancos/APIs/harness simulados e teste ponta a ponta (ffmpeg real, ComfyUI/API/harness simulados)
npm run typecheck
npm run dist         # gera o executável (AppImage/deb, NSIS/portable, dmg) em release/
```

Requisitos: Node 20+, Python 3 (só se usar Wan2GP), `ffmpeg` e `ffprobe` no PATH (ou configure o caminho em *Configurações*).

## Primeiros passos

1. **Configurações → Harnesses** → *Testar/detectar*, *Consultar modelos* e *Testar prompt* (Ollama: informe a Base URL). Em *ComfyUI / Wan2GP* use *Testar*. Ajuste comando/argumentos dos harnesses à sua versão
   (`{prompt}` e `{model}` são tokens). Antigravity e OpenClaw vêm com argumentos de exemplo que você deve conferir.
2. **Configurações → APIs de voz / imagens / vídeos / músicas** e **Bancos de mídia**: cole as chaves (guardadas com `safeStorage`) e use *Testar*.
3. Wan2GP (opcional): em *Configurações → ComfyUI / Wan2GP* configure a pasta e o python do Wan2GP e `wan2gp.python` (venv do Wan2GP) e use *Listar modelos* para conferir os `model_type` dos templates em `workflows/wan2gp-*.json`.
3. ComfyUI: exporte seus workflows em *Save (API Format)* para `workflows/` (veja `workflows/README.md`).
4. **Projetos** → escolha tipo de vídeo, rota, qualidade e perfil (100 % local / comercial primeiro / barato) → **Executar rota**.
5. Aba **Rotas**: crie/edite rotas e tarefas (executor, modelo, fallback). Aba **Skills**: diga o que fazer em cada atividade. Aba **Tipos de vídeo**: Rota + Skill = novo tipo, usado em **Projetos** com aparência, idioma e apresentação mista (Pexels/Pixabay/Wikipedia).
6. Coloque músicas em `<workspace>/library/music` para a trilha automática com ducking.

## Editor, projetos e lote

Aba **Projetos**: criar (inclusive vários de uma lista), duplicar, renomear, excluir, executar em lote com concorrência.
Aba **Editor**: timeline estilo CapCut (reordenar, redimensionar, multisseleção), inspetor, regeneração por etapa/cena e
edição por prompt (reescrever texto/estrutura ou refazer só o visual). Cenas por código são renderizadas pelo Electron — **não precisa de Playwright**.

## Estado atual (M0)

Implementado: motor de rotas (fan-out por cena, retry, fallback, timeout, cache content-addressed, checkpoints), 5 adaptadores de harness,
cliente ComfyUI (upload, prompt, progresso, history, view, interrupt), provider OpenAI-compatível (texto/imagem/TTS), montagem ffmpeg
(segmentos, concat, trilha com ducking, SRT), renderizador de cenas por código (`window.__forge.seek(t)`), UI básica.

Não implementado ainda (ver SPEC §11): editor visual de rotas, TTS ElevenLabs/Fish, fal.ai/Kling nativos, rotinas/agendador, upload YouTube, biblioteca de assets.

## Em breve

Módulo de upload (Playwright: YouTube, TikTok, Facebook, Kwai) e módulo web em VPS via Tailscale — descritos na SPEC §17.8, ainda não implementados.

## Abas (fluxo de trabalho)

- **Projetos** — lista dos projetos salvos em `<workspace>/projects/`: frame inicial do vídeo (ou de uma cena, marcado "parcial", se ainda incompleto), status, datas, tempo de geração, ▶ Executar, ＋ Lote, duplicar, renomear, abrir pasta e excluir (sempre com confirmação).
- **Novo projeto** — o usuário sempre escolhe uma **skill** (= tipo de vídeo) e uma **rota**. Ao escolher a skill aparece o *estilo de saída* (visual, ritmo, narração, formato e arquivos gerados). Campos opcionais: **estilo de roteiro** e **estilo de vídeo**, que entram em todos os prompts com prioridade sobre a skill.
- **Lote** — fila de projetos: a ordem é a prioridade (⤒ ▲ ▼ ⤓), ✕ remove, ▶ executa um item, "Executar lote" roda a fila (com "Simultâneos"), "Cancelar lote", "Reenfileirar com erro".
- **Skills** — há uma skill padrão para cada tipo de vídeo (somente leitura; "Salvar como minha skill" cria uma cópia editável) com aparência, rota sugerida, formato, duração, idioma, apresentação, estilo de saída e instruções por atividade.

## Clipes musicais em loop perfeito (MiniMax H3)

A rota **Clipe musical em loop (MiniMax H3 — primeiro = último frame)** cria clipes musicais assim:

1. **Imagem** no ComfyUI com **Krea 2 Turbo** e fallback automático para **Z-Image Turbo**.
2. **Vídeo** no **MiniMax H3** com o workflow `workflows/minimax-h3-perfect-loop-3step.json` (LoRA turbo de 3 passos) e fallback `minimax-h3-perfect-loop.json`: a mesma imagem entra como **first frame** e **last frame**, câmera fixa e movimento cíclico. O primeiro/último frame passa por `ImageScale` com **crop central** e o vídeo usa a proporção exata do projeto (16:9 = **1024×576**), sem esticar a imagem.
3. O `scenes.json` traz um campo **`videoPrompt`** escrito pela IA (Ollama, Claude, Codex etc.) com o movimento do loop, sem cortes e sem texto.
4. O `clip-musical` remove o **último frame duplicado**, usa a duração exata como **período do loop**, gera as faixas no **Yue 2** com esse mesmo período e monta o `final.mp4` com **N voltas inteiras** — o vídeo fecha sem salto no começo/fim.
5. Nome da faixa + waveform seguem sobrepostos; o loop é **forward** (sem reverse/pingpong).

A skill **Clipe musical em loop** já aponta para essa rota; o estilo musical, a quantidade de faixas e a waveform são escolhidos no projeto.
### Coletâneas instrumentais (2 a 6 min)

- O `clip-musical` aceita 2 a 15 faixas e limita o compilado a **120–360 s** (`minTotalSeconds`/`maxTotalSeconds`). Faixas antigas de 12 s são promovidas para a duração mínima.
- Música instrumental usa o workflow **`workflows/yue2-instrumental.json`** (LoRA `ar_lora_inst_v3abc`) e grava **`[instrumental]`** na letra.
- `perTrackLoop: true` gera **um loop visual por faixa** (uma cena por música); `false` repete o mesmo loop na coletânea inteira.
- Para criar as duas coletâneas de 10 músicas com o mesmo prompt, use a skill **Coletânea lo-fi em loop com código** e as rotas `clipe-musical-code-ag` (Antigravity) e `clipe-musical-code-ol` (Ollama).

## Clipes musicais em loop com código (sem vídeo IA)

A rota **Clipe musical em loop com código (Canvas/WebGL)** cria o mesmo tipo de clipe, mas o visual é desenhado por código:

1. **Roteiro** define o conceito visual e o `MUSIC_PLAN` (2 a 15 faixas; coletânea padrão: 10 faixas de 36 s = 6 min).
2. **Cena única** de 12 s com `kind: "code"` e narração vazia; o `visualIntent` descreve uma cena desenhável (formas, camadas, paleta e movimento cíclico).
3. **`code_scene`** grava uma página HTML autocontida (Canvas 2D, SVG ou WebGL puro) com `window.__forge.seek(t)` determinístico. O renderizador gera `clips/code.mp4` a 30 fps, com o primeiro e o último quadro iguais.
4. O **`clip-musical`** usa esse vídeo como loop, gera as faixas no **Yue 2** com a duração de cada faixa (2–6 min no total) e monta o `final.mp4` com nome da faixa + waveform.
5. Se a cena de código falhar, a rota cai no template animado Paris embutido (anime/16-bit/8-bit) em vez de entregar uma cena preta.

A skill **Clipe musical em loop com código (Canvas/WebGL)** já aponta para essa rota. É a opção de custo zero de imagem/vídeo: o ComfyUI só é usado para a música (Yue 2).

Nas rotas locais da biblioteca, use **`clipe-musical-code-ol`** (16-bit, Ollama) ou **`clipe-musical-code-ol-8bit`** (8-bit). A skill **Clipe musical em loop com código** da biblioteca já aponta para a rota 16-bit; para usar a 8-bit, troque o `routeId` da skill para `clipe-musical-code-ol-8bit`.

## Novidades: vídeo livre, agentes, referências, prazo e editor

- **Vídeo livre** — a skill "Vídeo livre (só o seu prompt)" não gera roteiro, cenas nem narração: o prompt vai direto ao harness pela rota "Vídeo livre", que entrega `out/final.mp4`.
- **Misto definido na skill** — a skill escolhe o que mescla (motion graphics, bancos de imagens/vídeos, vídeo IA MiniMax). Há a skill e a rota "Misto: motion graphics + bancos + vídeo IA (MiniMax)".
- **Resumo e exemplo visual da skill** — ao escolher a skill em Novo projeto aparecem o resumo, o estilo de saída e um exemplo (vídeo/GIF/imagem escolhido na skill, ou o vídeo final mais recente feito com ela).
- **Referências** — roteiro de referência (texto, legenda ou áudio/vídeo transcrito pelo Whisper) e vídeo de referência (quadros-chave entregues aos harnesses), copiados para `<projeto>/reference/`.
- **Thumbnail** — janela com o esboço visual de cada template e criação de novos (composição, prompt e imagem de exemplo).
- **Tempo máximo** — cada execução é interrompida ao atingir o limite; o que já foi gerado fica em cache.
- **Cenas simultâneas** — cada cena avança pelas etapas sem esperar as outras; GPU local (ComfyUI/Wan2GP) segue uma cena por vez por etapa.
- **Agentes** — orquestrador (escreve `brief.md`, seguido por todas as etapas) e obreiros (assumem etapas, com instruções e harness/modelo próprios). Escolha a equipe em Novo projeto.
- **Editor** — escolha de projeto, transporte (⏮ ▶/⏸ ⏹ ⏭, régua clicável, playhead), efeitos por cena (cor, Ken Burns, fade) e legendas (posição, tamanho, cor, fundo, gravar no vídeo), aplicados na prévia e na montagem.
- **Pasta dos projetos** — Configurações → Pastas: escolha outro local e, se quiser, mova os projetos existentes.
- **Janela e tema** — sem barra de menu (só os botões da janela, em preto), menu lateral com ícones e tema claro/escuro.


## GTA VI — qualidade YouTube

A rota **`gta6-quality`** monta vídeos de 3–5 min com roteiro/narração, **OmniVoice** (voz de referência), cenas de **código**, **imagens** (Krea 2/Z-Image), **vídeo generativo** (MiniMax H3) e **gameplay real de GTA VI** no YouTube. A trilha entra em **15% do volume normal** (`musicVolume: 0.15`), o áudio final é masterizado para **-14 LUFS/48 kHz** e a etapa **`review`** usa o agente **Revisor de qualidade YouTube** para gravar `out/review.json` com nota 0–10, critérios, problemas e correções.

A lista de clipes de GTA VI é curada (evita mods de GTA V e concept trailers) e usa uma semente por projeto/cena para variar os trechos entre sessões.

## MCP padrão (ChatGPT, Claude, Cursor, VS Code, OpenCode)

O FilmForge expõe MCP em dois transportes:

- **stdio** — `FilmForge.exe --mcp` (Claude Desktop, Claude Code, Cursor, OpenCode, VS Code, LM Studio). Configuração pronta em Configurações → MCP → “Copiar configuração”.
- **Streamable HTTP/SSE** — `FilmForge.exe --mcp-http 3333 --mcp-host 127.0.0.1` (ChatGPT e clientes remotos). Endpoint: `http://127.0.0.1:3333/mcp`; health em `/health`; SSE legado em `/sse`.
  - Opcional: `--mcp-token SEU_TOKEN` (Bearer) ou `FILMFORGE_MCP_TOKEN`.
  - Para o ChatGPT na nuvem, exponha a porta por um túnel HTTPS (Cloudflare Tunnel/ngrok) e cadastre a URL pública terminando em `/mcp`.
  - Também é possível iniciar/parar o HTTP pela própria interface em Configurações → MCP.

As ferramentas permitem criar projetos, disparar rotas, acompanhar status, ler cenas/log, consultar rotas, skills, provedores, modelos, plugins e recursos `filmforge://...`.

## Skills × rotas × provedores (revisão de 23/10/2026)

- **Rota = o que fazer; perfil de provedores = quem faz.** Em *Novo projeto → 🎛 Provedores* uma janela mostra perfis prontos (100 % local, Antigravity + ComfyUI, Claude Code + ComfyUI, Comercial) e um cartão por categoria (texto, código, imagem, vídeo, voz, música) com status de instalação, local × nuvem e modelo. O executor escolhido vira o principal e os da rota ficam como reserva. Loops perfeitos, ferramentas internas e etapas com `params.lockExecutors` não são trocados. Perfis podem ser salvos e reutilizados.
- **Editor de rotas:** cada executor tem o botão *Escolher…*, que abre a mesma janela com cartões para aquela tarefa.
- **Compatibilidade:** ao escolher skill e rota, o app avisa se a rota não produz o que a skill pede (banco de mídia, vídeo IA, clipe musical, lyric video, várias vozes) e oferece a rota sugerida.
- **Rotas novas:** `documentario-3d` (reconstituição IA + arquivo + infográficos), `lyric-video` (canção no Yue 2 com a letra → tempos dos versos → tipografia por código) e `microdrama-vozes` (uma voz por personagem; elenco definido no projeto).
- **Prompts:** cena por código só é loop nos clipes musicais (ou com `params.loop`); nos explicativos é linear. O final do roteiro segue a skill (`scriptEnding`: loop, next, conclusion). A revisão usa critérios da skill/rota (`reviewCriteria`), sem regras fixas de GTA.
- **Qualidade:** `verified` adiciona revisão com nota; `ultra` refaz até 3 cenas apontadas pela revisão (1 rodada).
- **Thumbnail** no formato do projeto (capa 9:16 nos shorts), gerada depois do SEO; reserva final `frame-thumbnail` = quadro real do vídeo + texto.
- **Correção:** `musicMode` enviado pelo formulário não transforma mais qualquer projeto em clipe musical; clipe musical = rota com `clip-musical`.

## Interface visual, editor e automações (24/10/2026)

- **Skill = template** (estilo, tom, estrutura). **Rota** = etapas. **Perfil de provedores** = quem executa. Os três se combinam em Novo projeto.
- **Skills** e **Rotas** viraram galerias de cartões; a rota é editada como pipeline de 4 fases (Planejar → Cada cena → Montar → Publicar) e cada tarefa abre numa janela. Botão **❔ Como funciona?** abre carrosséis explicativos.
- **Provedores** (menu lateral): galeria de perfis; criar, editar, duplicar e excluir.
- **Editor:** 13 filtros de cor com amostra, vinheta (suave/forte), 15 transições entre cenas (xfade, sem mudar a duração nem a sincronia), e acabamento do vídeo final (filtro, vinheta, grão, letterbox).
- **Automações** (menu lateral): até 10 contas Google, cada uma com navegador próprio (login feito por você; o app não guarda senha); Google Flow com a sua extensão carregada e downloads enviados direto para uma cena; sessão do Antigravity CLI por conta (escolha manual); SRT a partir de um áudio/vídeo (Whisper).

## Manual completo

O guia de uso do app e do MCP está em [Manual.MD](Manual.MD).
