# FilmForge — verificação e correções (22/10/2026)

> Pasta verificada: `G:\PROJECTS\CLAUDE FILMFORGE\21 10 2026 - Copia\filmforge`.
> Harness dos testes: **Antigravity** (`agy`) com **`gemini-3.8-flash-low`**. Claude/OpenCode não foram usados.

## 1. Por que as cenas não apareciam no editor quando a skill pedia cenas

A causa era a **combinação rota × skill**:

- a skill `explicativo-codigo` (e as demais de vídeo) pede cenas no texto `steps.scene_plan`;
- mas o projeto tinha sido criado com a rota **`video-livre-…`**, que só tem a etapa `free`
  (prompt → harness). Sem etapa `scene_plan`, o `scenes.json` ficava `[]`, o `project.scenes`
  ficava vazio e o editor não tinha o que mostrar — o vídeo saía num arquivo único, sem cenas.

Projetos afetados encontrados: `iphone-ptbr-48850a`, `iphone-10-cf6f47` (route `video-livre-…`, `scenes: 0`).

**Correção** (`src/main/settings.ts` → `reconcileRoute`, usado por `createProject`/MCP/UI):

- skill que **não** é de vídeo livre + rota **sem** `scene_plan` → a rota passa a ser a da própria skill
  (ou a rota padrão da aparência);
- skill de **vídeo livre** + rota com cenas → volta para a rota `video-livre`;
- a UI avisa quando a rota foi ajustada (`renderer.ts`).

Comprovação: criar um projeto com `skillId: explicativo-codigo` + rota `video-livre-…` agora devolve
`routeId: explainer-mixed` (que tem `scene_plan`).

## 2. Idioma da narração na tarefa de narração

`src/main/prompts.ts` ganhou o caso **`narration`** (antes caía no genérico "Execute a etapa"):

- exige o idioma do projeto (`languageName(p.language)`), sem traduzir/resumir;
- manda ler a narração da cena (ou o trecho do `script.md`), gravar `audio/narration.mp3`
  com voz natural, sem silêncios longos/ruído/música;
- respeita voz/referência da skill.

## 3. ComfyUI: voz falhava com HTTP 400

O `/prompt` recusava o grafo do OmniVoice com `value_bigger_than_max` no `seed`: o app gerava
seeds de até 4,29 bi e o nó valida `max = 2147483647`.

- `executors.ts` (`commonVars`): seed agora em **32 bits** (`% 2147483647`).
- `comfyui.ts` (`submit`): o erro 400 agora mostra os **`node_errors`** (antes só "Prompt outputs failed validation").

Validado: Krea 2 (imagem 1344×752 em ~21 s) e OmniVoice (MP3 em ~7 s) no ComfyUI 0.42.1 / RTX 4070 Ti.

## 4. ffmpeg/ffprobe fora do PATH

- `ffmpeg.ts`: resolve `ffmpeg`/`ffprobe` nas pastas comuns (`E:\DOWNLOAD\ffmpeg\bin`, `C:\ffmpeg\bin`, …)
  quando o nome puro não está no PATH.
- `%APPDATA%\filmforge\settings.json` e `%APPDATA%\FilmForge\settings.json` apontam para
  `E:/DOWNLOAD/ffmpeg/bin/{ffmpeg,ffprobe}.exe` (backup `.bak`).

## 5. Arquivos imutáveis (cópia/drive sincronizado)

Nesta cópia, arquivos **existentes** não podem ser renomeados/apagados (só sobrescritos). Ajustes:

- `scripts/build.mjs`: não apaga `dist`; compila para `*.tmp.*` e **sobrescreve** por cópia;
- `engine.ts`/`ops.ts`: escrita atômica com fallback (rename → copyFile);
- `executors.ts`: trim de silêncio, legendas queimadas e limpeza de `out/segments` com fallback;
- `main.ts`: mover projetos já tinha fallback.

## 6. Harness que ficava pendurado

`runHarness` agora tem um **teto rígido** (`timeoutSec` da etapa) que mata a árvore do processo
(`taskkill /T /F`) mesmo que o timer externo não dispare; mensagem clara de timeout.

## 7. Modo headless (`--run-project`)

- `electron . --run-project <id>` executa a rota sem janela e imprime os eventos JSON;
- **bug corrigido**: `window-all-closed` encerrava o app quando a janela oculta usada para
  renderizar as cenas de código era destruída — no modo headless o app agora **não** encerra.


Também foi adicionado o modo **headless**:

```bash
npm run build
node_modules\electron\dist\electron.exe . --run-project <id>
# imprime os eventos (JSON) e sai com 0/1
```

## 7. Como validar

```bash
cd "G:\PROJECTS\CLAUDE FILMFORGE\21 10 2026 - Copia\filmforge"
npm run typecheck
# testes (o PATH precisa de ffmpeg; python3 é opcional):
$env:PATH = "E:\DOWNLOAD\ffmpeg\bin;" + $env:PATH
npm test
npm start
```

Projetos de verificação deixados em `G:\PROJECTS\CLAUDE FILMFORGE\21 10 2026 - Copia\projects`:

| projeto | rota | o que testa |
|---|---|---|
| `forge-comfy-smoke` | smoke (imagem + narração) | acesso ao ComfyUI (Krea 2 + OmniVoice) |
| `teste-codigo-antigravity-a5d2e5` | `explicativo-por-codigo-antigravity-stickman-flat` | roteiro/cenas/código por **Antigravity** + **gemini-3.8-flash-low**, narração OmniVoice, música Yue 2, montagem |
| `teste-midia-comfyui-antigravity-51de7b` | `forge-midia-comfyui-antigravity` | cenas `code` + `mixed` + `video`: código, bancos, **imagem Krea 2**, **vídeo MiniMax H3**, voz, montagem |

> `forge-comfy-smoke` já produziu `frames/frame.png` (1344×752) e `audio/narration.mp3` (1,89 s).

## Resultado A — `teste-codigo-antigravity-a5d2e5`

Rota `explicativo-por-codigo-antigravity-stickman-flat` (tudo por **Antigravity / gemini-3.8-flash-low**,
narração OmniVoice, música Yue 2):

- 3 cenas `code` geradas (HTML determinístico, `window.__forge.seek`, 1920×1080) e renderizadas:
  `scenes/s01/clips/code.mp4` (3,5 MB / 11,83 s), `s02` (1,2 MB / 12,63 s), `s03` (2,3 MB / 9,67 s);
- narração OmniVoice em pt-BR por cena (`audio/narration.mp3`), transcrição por estimativa
  (Whisper não instalado → fallback `estimate-words`);
- `out/music.mp3` (Yue 2, 34 s), `out/subtitles.srt`, `out/thumbnail.png`, `out/metadata.json`;
- **`out/final.mp4`: 34,01 s, 1920×1080, H.264 + AAC estéreo, 7,3 MB** (narração + trilha com ducking).

> O agente escreveu HTML sem `Math.random`, `Date.now`, `fetch` ou rede — respeitou o contrato determinístico.

## Resultado B — `teste-midia-comfyui-antigravity-51de7b`

Rota `forge-midia-comfyui-antigravity` (criada para o teste; **Antigravity/gemini-3.8-flash-low** em
roteiro/cenas/código/metadados, ComfyUI para mídia):

- **s01 `code`**: HTML + `clips/code.mp4` (3,2 MB);
- **s02 `mixed`**: bancos de mídia **sem chave Pexels/Pixabay** → fallback **Wikipedia**
  (2 imagens CC0, 1600 px) + motion graphics por código (`clips/code.mp4`, 8,1 MB);
- **s03 `video`**: **imagem Krea 2** (1,1 MB) → **vídeo MiniMax H3** (832×480, 24 fps, 5,17 s, 1,3 MB);
- **voz OmniVoice** nas 3 cenas (4,31 / 4,24 / 4,80 s), **música Yue 2**, `.srt`, thumbnail e metadados;
- **`out/final.mp4`: 13,69 s, 1920×1080, H.264 + AAC estéreo, 13,4 MB**.

Observações de qualidade (ajustáveis):

- o vídeo do MiniMax foi gerado a **0,4 MP** (`megapixels` no `minimax-h3-ref2v.map.json`) e
  ampliado na montagem — subir para ~0,7–0,8 MP melhora a nitidez, mas exige mais VRAM/tempo;
- sem chaves de Pexels/Pixabay o stock usa **Wikipedia**; para B-roll profissional, configure as chaves;
- o thumbnail usa o **nome do projeto** na primeira execução (o `metadata.json` só nasce depois);
  em re-execuções/render final ele já usa `metadata.title`/`thumbnailText` (corrigido em `prompts.ts`).

## Limitações do ambiente (não são bugs do app)

- `library`/`wan2gp`/`e2e` dos testes exigem `python3`/`sh`/ffmpeg no PATH; aqui só o ffmpeg foi
  adicionado (`E:\DOWNLOAD\ffmpeg\bin`). O e2e usa um harness `.sh` (Unix) — no Windows ele cai no
  fallback de API e falha; os demais testes (engine, ops, skills, features, workflows) passam.
- Os testes `library`/`wan2gp` chamam `python3` diretamente; o Whisper **do app** já está instalado
  no venv (`settings.whisper.python`), mas esses testes não usam essa configuração.

---

# Segunda rodada (22/10/2026) — Whisper, Pexels, Ollama, YouTube

## 8. Whisper: instalação automática

- Botão **Configurações → Misc → Whisper → “Baixar/instalar Whisper”** (IPC `whisper:install`),
  CLI `electron . --install-whisper` e instalação automática no passo de transcrição quando o
  `faster-whisper` não está disponível (`ensureWhisper` em `src/main/whisper-install.ts`).
- Cria um **venv isolado** em `<workspace>/tools/whisper-venv` usando o Python encontrado
  (Python do sistema **ou** o do ComfyUI) e roda `pip install faster-whisper`; **não mexe** no
  Python do ComfyUI. O caminho fica salvo em `settings.whisper.python` e é detectado sozinho no
  próximo início.
- Correções necessárias:
  - **PyAV 19** removeu o kwarg `metadata_errors` que o faster-whisper ainda passa →
    monkey-patch em `tools/whisper_words.py`;
  - `device=auto` escolhia CUDA e falhava com `cublas64_12.dll` → CPU + `int8` por padrão
    (suficiente para narrações curtas; GPU continua disponível escolhendo “GPU (CUDA)”).
- Testado: narração de 11,8 s → **40 palavras com tempo**, `source: faster-whisper` (pt).
- Testado **do zero**: renomeando o venv e rodando `--install-whisper`, o app detectou o Python do
  ComfyUI, criou um venv novo, instalou `faster-whisper 1.2.1`, salvou o caminho e transcreveu
  **24 palavras** em pt-BR na sequência.

## 9. Pexels (chave já configurada)

- A chave fica criptografada (`safeStorage`) e é decriptada no app; o teste
  `forge-stock-pexels` baixou **2 vídeos 1920×1080** (Pexels License, autores nos créditos) em ~5 s.

## 10. Ollama — vídeo simples com modelo local

- Modelo **`tobestyledintro/qwen3.8-9b-distill:latest`** já instalado no Ollama e **suporta
  ferramentas** (`tool_calls`); não foi preciso instalar nada além dele.
- Rota `forge-ollama-pexels`: roteiro/cenas pelo Ollama → Pexels → OmniVoice → Yue 2 → montagem.
- Bugs corrigidos:
  - modelos que usam ferramentas e terminam com **texto vazio** eram tratados como falha
    (`resposta vazia`) mesmo tendo gravado o arquivo → `runHttp` agora considera sucesso quando
    houve ferramenta; o executor valida o arquivo esperado;
  - o planejador podia pedir tipos de cena sem etapa na rota (viravam **segmento preto**) →
    `engine.ts` converte para um tipo disponível (`fitKinds`) e o prompt de `scene_plan` lista os
    tipos que a rota produz;
  - `searchTerms` ausente fazia a busca cair na narração longa em português → agora o prompt exige
    **searchTerms em inglês** e, se faltar, o app gera palavras-chave curtas (título/visualIntent).
- Testado: 3 cenas `stock`, final 1920×1080 com voz e trilha (≈23 s). O modelo 9B às vezes escolhe
  imagens pouco específicas; a checagem visual (abaixo) e o YouTube tendem a casar melhor.
- Segunda execução (sem cache): o modelo passou a preencher **`searchTerms` em inglês**
  (`blue sky atmosphere scattering sunlight particles`, `red sunset sky clouds horizon…`), a busca
  do Pexels ficou precisa (1 clipe por cena) e o final saiu com **2 cenas / 10,8 s**.

## 11. YouTube como fonte de vídeo (com checagem da cena)

- Nova fonte **`youtube`** em Bancos de mídia (sem chave): baixa o **yt-dlp.exe** automaticamente em
  `<workspace>/tools` e usa `ytsearch` com os `searchTerms`/narração.
- Baixa **somente o trecho** necessário (`--download-sections`), **sem arquivos de legenda**
  (`--no-write-subs`, `--no-write-auto-subs`) e **sem o áudio original** (`-an`).
- **Recorte**: remove a faixa do rodapé (12%) e o topo (2%) — onde ficam legendas queimadas/créditos —
  e faz **cover** na resolução do projeto (sem barras pretas).
- **“Ver a cena”**: um modelo de visão local (`qwen3-vl:4b` no Ollama) olha um frame e responde
  `{"match":0-10,"hasText":true/false}`; trechos com baixa relação com a narração ou com
  texto/marca d’água são **rejeitados** e o próximo resultado é tentado (`src/main/vision.ts`).
- **Ranking**: prefere 4K/HD, “stock footage/cinemático”, clipes de 8 s–10 min e com audiência;
  penaliza “ambience / 10 hours / sleep / relax / storm” (visual parado e sem foco).
- Testado: 2 trechos de pôr do sol casando com a narração, final 4,69 s 1920×1080.
- A checagem visual respondeu **`visão 9/10 → aceito`** para o trecho de nuvens de pôr do sol.
- Teste **Antigravity + YouTube** (`teste-youtube-antigravity-16a197`): 2 cenas planejadas pela IA,
  **final 13,16 s 1920×1080**; `s01` escolheu “Ocean Sea Waves | Drone Aerial View | Free stock
  footage” (**visão 10/10**), `s02` rejeitou “Giant Wave Crash” (**8/10 + texto/marca**) e aceitou
  “WHAT IT LOOKS LIKE BENEATH A CRASHING WAVE” (7/10); Whisper real (24 e 20 palavras).

> Direitos: o `stock.json` grava autor e licença; o YouTube é marcado como “confira a licença e o
> uso permitido”. Prefira canais Creative Commons/reuso permitido.

## 12. Validação de todas as skills/rotas

- `electron . --validate` percorre **todas as rotas e skills**, valida etapas/dependências/bindings,
  workflows do ComfyUI, servidores, harnesses instalados, provedores de API e tenta `createProject`
  para cada skill. Resultado: **49 itens, 0 erros** (`<workspace>/validation.json`) — inclui as 10
  rotas deste relatório.
- Correções feitas na validação:
  - removido o fallback `api:fal/kling` (provedor `fal` não existe no app) das rotas de vídeo;
  - rota `local-only` trocada de OpenCode/OpenClaw para **Ollama** (100% local de verdade).
- Testes unitários: `engine`, `ops`, `skills`, `features`, `workflows` **OK**.

## 13. Projetos deixados para verificação (`G:\PROJECTS\CLAUDE FILMFORGE\21 10 2026 - Copia\projects`)

| projeto | o que testa | resultado |
|---|---|---|
| `forge-comfy-smoke` | Krea 2 + OmniVoice isolados | imagem 1344×752 + MP3 1,89 s |
| `teste-codigo-antigravity-a5d2e5` | Antigravity + cenas de código + música | **final 34,01 s** 1920×1080 |
| `teste-midia-comfyui-antigravity-51de7b` | code + mixed + imagem Krea + vídeo MiniMax | **final 13,69 s** |
| `forge-stock-pexels` | chave Pexels | 2 vídeos 1920×1080 |
| `forge-youtube-teste` | YouTube + recorte + visão | **final 4,69 s**, visão 9/10 |
| `teste-ollama-video-simples-2-cc8b4b` | Ollama + Pexels (searchTerms EN) | **final 10,83 s**, 2 cenas stock |
| `teste-youtube-antigravity-16a197` | **Antigravity + YouTube + visão + Whisper** | **final 13,16 s**, visão 10/10; rejeitou 1 com texto |

## 14. Comandos úteis

```bash
npm run build
node_modules\electron\dist\electron.exe . --install-whisper        # baixa/instala o faster-whisper
node_modules\electron\dist\electron.exe . --validate               # todas as skills/rotas (grava workspace/validation.json)
node_modules\electron\dist\electron.exe . --run-project <id>       # executa sem janela
node_modules\electron\dist\electron.exe . --run-project <id> --no-cache  # ignora cache
```

Ferramentas instaladas nesta rodada: `yt-dlp 2026.10.21` (`<workspace>/tools/yt-dlp.exe`),
`faster-whisper 1.2.1` (`<workspace>/tools/whisper-venv`), modelos do Ollama
`tobestyledintro/qwen3.8-9b-distill:latest` (texto/tools) e `qwen3-vl:4b` (visão).




