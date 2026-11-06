# FilmForge — Especificação de features

Estúdio desktop (Electron + TypeScript, ~11,4 mil linhas em `src/`) de **vídeo por IA orientado a cenas**.
O vídeo é dividido em **cenas** e produzido por **rotas** configuráveis: cada etapa roda num modelo de
linguagem (harness), no ComfyUI/Wan2GP local ou numa API comercial, com **fallback em cadeia**.
O **tipo de vídeo** é definido por **skill + rota**.

## 1. Motor de rotas
- Pipeline por cena: cada cena avança pelas etapas sem esperar as outras; GPU local (ComfyUI/Wan2GP) segue uma cena por vez por etapa.
- Retry, fallback em cadeia, timeout por etapa e tempo máximo por execução.
- Cache content-addressed e checkpoints; retomada de execução interrompida.
- Ajuste automático do tipo de cena quando a rota não tem etapa para o tipo planejado (evita cena preta).
- Perfis de execução (100 % local / comercial primeiro / barato) e níveis de qualidade (standard, depth, polished, verified, ultra).
- Tipos de etapa: `ideation`, `brief`, `script`, `scene_plan`, `asset_design`, `narration`, `transcribe`, `image`, `video`,
  `code_scene`, `motion_graphics`, `stock_media`, `music`, `sfx`, `subtitles`, `edit`, `review`, `thumbnail`, `metadata`, `publish`, `free`.
- Ferramentas internas (builtin): `assemble`, `clip-musical`, `subtitles`, `whisper`, `silence-trim`, `library-music`, `estimate-words`.

## 2. Executores e modelos
- **Harnesses:** Claude Code, OpenCode, Codex, Antigravity, OpenClaw, Ollama, llama.cpp e LM Studio — detectar, listar modelos, testar prompt; esforço de raciocínio por etapa.
- **Agente local:** harnesses HTTP recebem as ferramentas `list_files`, `read_file`, `write_file`, `http_request`, `web_search` e `run_command`, confinadas à pasta do projeto.
- **ComfyUI:** upload, fila, progresso, histórico, view e interrupção. Workflows prontos:
  - imagem: Krea 2 Turbo → Z-Image Turbo (fallback);
  - vídeo: MiniMax H3 (texto→vídeo, referência→vídeo, loop perfeito 3 passos e normal);
  - voz: OmniVoice (clonagem de voz de referência);
  - música: Yue 2 (texto→música, cover, instrumental).
- **Wan2GP** (ponte Python): LTX2 texto→vídeo e imagem→vídeo, imagem, voz e música.
- **APIs:** compatível com OpenAI (texto, imagem, TTS), Gemini, fal, Kling, MiniMax, Snapgen e Seedance. Chaves guardadas com `safeStorage`.
- **Bancos de mídia:** Pexels, Pixabay, Wikipedia e YouTube (busca e download de trechos via yt-dlp).

## 3. Áudio e montagem (ffmpeg)
- Segmentos, concatenação, trilha com ducking sob a narração, corte de silêncio.
- Legendas SRT e gravadas no vídeo (posição, tamanho, cor, fundo).
- Efeitos por cena: filtro de cor, Ken Burns, fade in/out.
- Masterização -14 LUFS / 48 kHz (rota GTA VI).
- Whisper (com instalação automática) para transcrição e tempos por palavra.
- Cenas por código (HTML Canvas/SVG/WebGL com `window.__forge.seek(t)`) renderizadas pelo próprio Electron, sem Playwright.

## 4. Tipos de vídeo (skills padrão)
Stickman, realista/cinematográfico, anime 2D, 3D cartoon, pixel art, flat explainer, MS Paint, Vox collage, low poly,
reconstrução 3D, documentário Netflix, quadro branco, motion graphics, microdrama, anúncio de produto, história interativa,
lyric video, vector, paper cut, 3D por código e personalizado. Skills de formato: explicativo com código, shorts viral,
documentário narrado, vídeo livre e misto (motion graphics + bancos + vídeo IA).

Especiais:
- **Clipe musical em loop perfeito (MiniMax H3):** mesma imagem como primeiro e último frame; faixas no Yue 2; N voltas inteiras; nome da faixa + waveform.
- **Clipe musical em loop por código:** custo zero de imagem/vídeo; coletâneas de 2 a 15 faixas (120–360 s); um loop por faixa ou um loop único.
- **GTA VI qualidade YouTube:** narração OmniVoice, código, imagem, vídeo IA e gameplay real curado; música a 15 %; revisão com nota 0–10.

## 5. Agentes e skills
- Agentes padrão: diretor criativo (orquestrador), roteirista, diretor de arte, animador, pesquisador, SEO, produtor ágil, cineasta livre; agente do usuário "Revisor de qualidade YouTube".
- O orquestrador escreve `brief.md`; os obreiros assumem etapas com harness/modelo próprios.
- Skills: instruções globais e por etapa, aparência, rota sugerida, formato, duração, idioma, apresentação (gerada/mista), fontes de mídia, estilo de saída e mídia de exemplo. Padrão = somente leitura ("Salvar como minha skill"); importar/exportar em Markdown.
- Tipo de vídeo personalizado = rota + skill.
- Referências: roteiro (texto, legenda ou áudio/vídeo transcrito) e vídeo de referência (quadros-chave).
- Revisão visual: modelo julga quadros contra a narração.

## 6. Interface (9 abas)
- **Projetos:** lista com miniatura, status, tempo de geração; criar vários de uma lista; duplicar, renomear, abrir pasta, excluir com confirmação.
- **Novo projeto:** skill, rota, estilo de roteiro e de vídeo, equipe de agentes, referências, tempo máximo, cenas simultâneas.
- **Execução:** acompanhamento ao vivo (pré-checagem, progresso, ETA, log).
- **Lote:** fila com prioridade, simultâneos, cancelar, reenfileirar com erro.
- **Editor:** timeline estilo CapCut, inspetor, transporte, regerar etapa/cena, reescrever cenas por prompt, efeitos e legendas.
- **Rotas:** criar, editar, validar, importar e exportar.
- **Skills** e **Agentes**.
- **Configurações:** harnesses, APIs, bancos de mídia, pastas, ComfyUI/Wan2GP, Whisper, MCP, templates de thumbnail.
- Plugins no formato Claude Code (pasta ou URL do GitHub), tema claro/escuro, interface em pt-BR/en/es.

## 7. Servidor MCP
- `FilmForge.exe --mcp` (stdio: Claude, Cursor, VS Code, OpenCode, LM Studio).
- `--mcp-http <porta>` (Streamable HTTP/SSE, token Bearer opcional; ChatGPT via túnel HTTPS).
- 16 ferramentas `filmforge_*`: criar projeto, executar, status, log, editar cena, renderizar final, cancelar, consultar rotas, skills, provedores, modelos, plugins e configurações; recursos `filmforge://...`.

## 8. Build e testes
- `npm test`: 8 suítes (motor, operações, biblioteca, skills, features, workflows, Wan2GP, ponta a ponta).
- `npm run dist`: NSIS e portable (Windows), dmg (macOS), AppImage e deb (Linux).

## 9. Revisão de skills e rotas (23/10/2026)
- **Perfis de provedores** (`src/shared/profiles.ts`): a rota define o que fazer; o perfil define quem executa cada categoria (texto, código, imagem, vídeo, voz, música). Janela ilustrada em Novo projeto e botão *Escolher…* em cada executor no editor de rotas (`src/renderer/providers-ui.ts`).
- **Compatibilidade skill × rota** (`src/shared/compat.ts`): erros/avisos em Novo projeto e no editor de skills.
- **Rotas novas:** documentário 3D, lyric video, microdrama com várias vozes. Rotas padrão corrigidas (filtros de cena, thumbnail após o SEO, rota padrão de cada aparência).
- **Skills:** `scriptEnding`, `multiVoice` (elenco), `reviewCriteria`; code_3d sem Three.js; vox collage e documentário apontam para rotas com banco de mídia.
- **Ferramentas internas novas:** `lyric-song`, `lyric-words`, `frame-thumbnail`.
- **Qualidade:** verified = revisão; ultra = revisão + correção automática de cenas.
- **TTS:** instruções de voz da skill enviadas ao gpt-4o-mini-tts; voz por personagem (OmniVoice ou API).
- **Testes:** `src/test/routes.test.ts` (9ª suíte); `e2e` passa também no Windows (harness falso via bash).

## 10. Não implementado
- Upload para YouTube/TikTok/Facebook/Kwai e módulo web em VPS (SPEC §17.8).
- TTS ElevenLabs/Fish.
