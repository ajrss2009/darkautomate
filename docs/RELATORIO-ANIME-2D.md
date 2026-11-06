# Relatório — 2 projetos anime 2D (Ollama)

Data: 22/10/2026

## Objetivo

Criar mais dois clipes musicais com **Ollama/Qwen**, no estilo **anime 2D**, sem reverse e sem exigir loop matematicamente perfeito:

1. visual em **código** (template anime 2D do app);
2. visual em **MiniMax H3** (Krea 2 → MiniMax H3).

## Resultado

| Projeto | ID | Rota | Visual | Música | Waveform | Duração | Tempo de geração |
|---|---|---|---|---|---|---|---|
| Anime 2D (Ollama + código) | `anime-2d-ollama-c-digo-17bdc8` | `clipe-musical-code-ol-anime` | template anime 2D (canvas) | 2 faixas instrumentais, 12 s | `cline` (preenchida) | 24 s · 1920×1080 · 30 fps | **3m41s** (220,9 s) |
| Anime 2D (Ollama + MiniMax H3) | `anime-2d-ollama-minimax-h3-ec27e6` | `clipe-musical-video-ol` | Krea 2 + MiniMax H3 | 2 faixas canção, 12 s, com letra | `p2p` | 24 s · 1920×1080 · 24 fps | **4m23s** (263,3 s) |

Tempo da cena MiniMax (imagem + vídeo): **177,8 s** (≈2m58s).

## Arquivos finais

- `G:\PROJECTS\CLAUDE FILMFORGE\21 10 2026 - Copia\projects\anime-2d-ollama-c-digo-17bdc8\out\final.mp4`
- `G:\PROJECTS\CLAUDE FILMFORGE\21 10 2026 - Copia\projects\anime-2d-ollama-minimax-h3-ec27e6\out\final.mp4`

## Músicas

- Código: **Sakura Sunset** / **Tokyo Rain Loop** (instrumental).
- MiniMax: **Sakura Drift** / **Neon Rain** (canção; letras no `MUSIC_PLAN`).

## O que foi usado

- **Ollama/Qwen**: `tobestyledintro/qwen3.8-9b-distill:latest` para roteiro/planejamento.
- **Yue 2**: 2 faixas de 12 s.
- **MiniMax H3**: imagem Krea 2 + vídeo MiniMax H3 (projeto de vídeo).
- **Template anime 2D**: canvas 1920×1080, garota de fones na janela do trem, cidade ao pôr do sol, sakura, chuva; `window.__forge` com `duration 12`, `fps 30`, `seek(t)` e `pause()`.
- **Waveform sobreposta** ao vídeo (não lateral), com boost de contraste e `colorkey` para remover o fundo preto.
- **Loop forward** de 12 s (`-stream_loop`), sem reverse/pingpong.

## Observações

- O modelo de código 9B do Ollama não é confiável para compor a cena inteira; a rota de código usa o **template anime 2D** do app para garantir o resultado. O roteiro, o planejamento e a música continuam no Ollama.
- O projeto MiniMax usa a cena anime 2D gerada por IA; o loop é “loop-friendly” (câmera fixa e movimento cíclico), como pedido — não é um loop matematicamente perfeito.
- Validação da biblioteca: **58 itens, 0 erros**.
