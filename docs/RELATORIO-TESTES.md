# Relatório de testes — FilmForge (22/10/2026)

> Harness: **Antigravity** com **`gemini-3.8-flash-low`** em todos os testes de skill/rota.
> Depois, os 4 testes locais com **Ollama `tobestyledintro/qwen3.8-9b-distill:latest`**.
> Mídia: **ComfyUI** (Krea 2 / MiniMax H3 / OmniVoice), **Pexels**, **YouTube** (yt-dlp + visão) e
> **faster-whisper**. Projetos em `G:\PROJECTS\CLAUDE FILMFORGE\21 10 2026 - Copia\projects`.

## Como os testes foram montados

- Rotas dedicadas com **bindings explícitos** (sem `auto`), para garantir Antigravity/Gemini 3.8 Flash Low
  ou Ollama conforme o teste. As rotas ficam em `…\FilmForge\library\routes\forge-*.json`.
- **YouTube:** `params.maxSeconds = 4` no passo de banco; o clipe baixado tem **no máximo 4 s** e é
  repetido na montagem para cobrir a narração.
- **Checagem visual:** `qwen3-vl:4b` aprova/rejeita cada trecho (`match 0-10`, `hasText`), rejeitando
  legendas/marcas d’água; a visão também rejeita baixa relação com a narração.
- Áudio: narração **OmniVoice** por cena; transcrição **faster-whisper**; legendas `.srt`; montagem ffmpeg.
- Durações curtas (10–15 s), 1 cena por vez nas etapas de GPU.

## Quadro geral

| # | Skill | Rota | Status | Cenas | Final | Tempo |
|---|---|---|---|---|---|---|
| 01 | `stickman` | `forge-ag-stickman` (Explicativo por código) | ✅ | 2 `code` | **13,19 s** 1920×1080 | 245 s |
| 02 | `misto-motion-banco-ia` | `forge-ag-misto` (Misto: motion + bancos + MiniMax) | ✅ | `code`/`mixed`/`video` | **15,16 s** 1920×1080 | 498 s |
| 03 | `explicativo-codigo` | `forge-ag-codigo-youtube` (código + YouTube 4 s) | ✅ | `code`/`mixed`/`code` | **15,22 s** 1920×1080 | 570 s |
| 04 | `shorts-viral` | `forge-ag-shorts` (vertical, código + MiniMax) | ✅ | `code`/`video` | **16,19 s** 1080×1920 | 301 s |
| 05 | `documentario` | `forge-ag-doc-youtube` (YouTube 4 s + motion + MiniMax) | ✅ | `mixed`/`video`/`code` | **16,79 s** 1920×1080 | 628 s |
| 06 | `anime_2d` | `forge-ag-livre` (Vídeo livre prompt → harness) | ✅* | livre | **8,00 s** 1280×720 | 79 s |
| 07 | `realistic` | `forge-ol-realista` (Krea + MiniMax) | ✅ Ollama | `video`/`video` | **10,26 s** 1920×1080 | 275 s |
| 08 | `stickman` | `forge-ol-stickman` (código) | ⚠️ | `code`/`code` | **11,09 s** cartões | 518 s |
| 09 | `cartoon_3d` | `forge-ol-cartoon` (Krea + MiniMax + código) | ✅ Ollama | `video`/`video` | **17,19 s** 1920×1080 | 297 s |
| 10 | `documentario` | `forge-ol-doc` (Pexels + código) | ✅ Ollama | `stock`/`mixed` | **9,56 s** 1920×1080 | 112 s |

\* o vídeo livre saiu **sem áudio** (o prompt não pedia trilha/narração).

## Detalhes dos concluídos

### 01 — Stickman + Explicativo por código (Antigravity)
- 2 cenas `code` (5–6 s), narração OmniVoice, **Whisper 27 palavras em cada cena**;
- `out/final.mp4`: **13,19 s**, 1920×1080, H.264 + AAC estéreo, 6,9 MB;
- determinístico (`window.__forge.seek`), legendas `.srt` geradas.

### 02 — Misto: motion + bancos + vídeo IA MiniMax (Antigravity)
- 3 cenas: `code`, `mixed` (Pexels) e `video` (**MiniMax H3**);
- 3 mídias do **Pexels** na cena `mixed` (autores/licenças em `stock.json`);
- `out/final.mp4`: **15,16 s**, 1920×1080, H.264 + AAC, 9,0 MB;
- Whisper real nas 3 cenas (15, 13 e 16 palavras).

### 03 — Código + imagens do YouTube (Antigravity)
- 3 cenas: `code`, `mixed` e `code`;
- **3 clipes do YouTube, todos com 4,00 s** (`ffprobe`), baixados sem legenda/áudio;
- **visão: 3 aceitos e 2 rejeitados** (um por texto/marca d’água, outro por baixa relação);
- `out/final.mp4`: **15,22 s**, 1920×1080, H.264 + AAC, 4,6 MB;
- Whisper real (15, 17 e 17 palavras).

### 04 — Shorts viral vertical (Antigravity)
- 9:16 **1080×1920**; 2 cenas: `code` (submarino/exploração oceânica) e `video` (**MiniMax H3**);
- `out/final.mp4`: **16,19 s**, H.264 + AAC, 8,8 MB; Whisper 22/25 palavras.

### 05 — Documentário com YouTube 4 s + motion + MiniMax (Antigravity)
- 3 cenas: `mixed`, `video` e `code`;
- **3 clipes do YouTube, todos com 4,00 s** (`ffprobe`), com **visão 3 aceitos / 3 rejeitados**
  (texto/marca ou baixa relação);
- `out/final.mp4`: **16,79 s**, 1920×1080, 6,6 MB; cena histórica com livro medieval e título “ANTERIOR A 1440”.

### 06 — Anime 2D com Vídeo livre (Antigravity)
- O harness **criou o vídeo do zero**: `generate_frames.py` (Pillow), 192 frames e ffmpeg;
- `out/final.mp4`: **8,00 s**, 1280×720, H.264, **sem áudio** (não foi pedido);
- cena anime: silhueta da guerreira na montanha, céu em gradiente, sol e partículas.

### 07 — Realista / cinematográfico (Ollama)
- Roteiro/cenas pelo **Ollama**; 2 cenas `video` com **Krea 2 → MiniMax H3**;
- `out/final.mp4`: **10,26 s**, 1920×1080, H.264 + AAC, 4,4 MB (farol na tempestade);
- Whisper real (17/19 palavras).

### 08 — Stickman (Ollama) — limitação encontrada
- O **distill** e o **coder** (`LisyNeko/qwen3.8-9b-coder`) escreveram HTML (14–19 KB), mas **não
  definiram `window.__forge.seek(t)`**; as 3 tentativas falharam;
- correção aplicada: **cartão de fallback** (título da cena + narração) em vez de fundo preto;
- `out/final.mp4`: **11,09 s**, 1920×1080, **cartões** “O mito da gravidade” etc., com narração;
- **recomendação:** para cenas por código, usar **Antigravity** (o teste 01 mostra que funciona);
  o Ollama entrega bem texto/planejamento e mídia (07/09/10).

### 09 — 3D Cartoon (Ollama)
- 2 cenas `video` (`Krea 2 → MiniMax H3`): robô vermelho reciclando;
- `out/final.mp4`: **17,19 s**, 1920×1080, 11,0 MB; Whisper 32/29 palavras.

### 10 — Documentário (Ollama)
- 2 cenas: `stock` (Pexels) e `mixed` (Pexels + código); Terra vista do espaço;
- `out/final.mp4`: **9,56 s**, 1920×1080, 2,8 MB; Whisper 14/11 palavras.

## Problemas encontrados/corrigidos nesta rodada

1. **Clipes do YouTube precisavam de limite por etapa** → `params.maxSeconds` no passo de banco
   (`stockExec` limita o trecho; a montagem repete o clipe até a duração da narração).
2. **`mediaSources` herdado da skill escondia o YouTube** quando a rota era explícita → a rota
   prevalece se o projeto não listar as fontes dela.
3. **Tipos de cena sem etapa** (ex.: `visual` sem `image`) → `fitKinds` converte para um tipo
   disponível e evita segmento preto.
4. **`searchTerms` vazio** → o prompt exige inglês e o app gera palavras-chave curtas.
5. **Visão com resposta vazia no qwen3-vl** (modelo “pensa” antes) → `num_predict` maior e leitura
   do `thinking`; rejeita texto/marca d’água.
6. **Ranking do YouTube** prioriza 4K/HD/stock curto e penaliza “ambience/10 hours/storm”.
7. **Ollama com contexto curto**: o `code_scene` (prompt + HTML) estourava o padrão e voltava vazio →
   `num_ctx: 24576` e `num_predict: 8192` no `/api/chat`; melhorou o texto, mas **os dois modelos
   9B ainda não cumpriram `window.__forge.seek(t)`** no HTML (limitação do modelo).
8. **Cena sem visual** (quando o código falha) → **cartão de fallback** com o título da cena e a
   narração, em vez de fundo preto (`executors.ts`).
9. **Validação final:** **49 itens (rotas + skills), 0 erros** — inclui as 10 rotas deste relatório;
   testes `engine/ops/skills/features/workflows` **OK**.

## Observações

- **Direitos:** o YouTube é marcado como “confira a licença e o uso permitido”; prefira canais
  Creative Commons. O `stock.json` guarda autor e licença.
- **Legendas/marcas queimadas:** o recorte + visão reduzem muito, mas não removem uma marca no centro
  do quadro.
- **Ollama 9B** tende a ser menos consistente que o Gemini; os testes 07–10 mostram o comportamento real.
- **Vídeo livre (06)**: o agente recebe instruções técnicas (Pillow + ffmpeg) para gerar o MP4.

## Arquivos

- Rotas: `C:\Users\ajrss\OneDrive\Documentos\FilmForge\library\routes\forge-*.json`
- Manifesto: `docs/report-manifest.json`
- Resumo automático: `docs/report-summary.json`
- Resultados da bateria: `docs/report-results.json`
- Logs: `%TEMP%\rep-<id>.log` (04–10) e `%TEMP%\forge-rel0*.log` (01–03)
