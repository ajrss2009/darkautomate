# Relatório — Clipe musical em loop (pixel, café/janela, low-fi)

> Skill **`clipe-musical`** com 3 faixas instrumentais geradas, visual em loop (código ou MiniMax H3),
> **nome da faixa atual** e **waveform lateral**. Estilo musical escolhido no projeto.

## 1. O que foi criado

### Skill `clipe-musical`
- Nome: **Clipe musical em loop**
- Aparência: **pixel_art** · 16:9 · 12 s de animação
- Rota padrão: `clipe-musical-code-ag`
- Instruções: **não é narração**; o `script.md` traz um bloco `MUSIC_PLAN:` com **3 faixas**
  (`name`, `style`, `seconds`); a cena é **1 loop de 12 s** (pixel art ou vídeo).

### Rotas
| rota | visual | harness |
|---|---|---|
| `clipe-musical-code-ag` | cena HTML pixel art (código) | Antigravity |
| `clipe-musical-video-ag` | imagem Krea + vídeo MiniMax H3 | Antigravity |
| `clipe-musical-video-ol` | imagem Krea + vídeo MiniMax H3 | Ollama |

### Etapa nova `clip-musical` (builtin)
1. lê `MUSIC_PLAN` do `script.md` (ou usa nomes temáticos de fallback);
2. gera **3 faixas** no **Yue 2** (ComfyUI) com o `musicStyle` do projeto;
3. concatena a playlist;
4. pega o visual da cena e coloca em **loop** (`-stream_loop -1`);
5. adiciona **waveform lateral** (`showwaves`, 340×1080 à direita) e **nome da faixa** (`ASS`,
   trocando a cada 18 s);
6. grava **`out/final.mp4`** (1920×1080, H.264 + AAC).

### Estilo musical no projeto
- Campo novo **“Estilo musical”** em **Novo projeto** (`Project.musicStyle`), usado no prompt e na
  geração das faixas.
- Exemplo usado: `lo-fi, chill, café, vinil, noturno, instrumental, sem vocais`.

## 2. Projetos criados

| projeto | rota | visual | estado |
|---|---|---|---|
| `clipe-pixel-ag-c-digo-5aa5da` | código AG | pixel art HTML | ✅ **54,0 s**, 3 faixas |
| `clipe-pixel-ag-minimax-cdae0b` | video AG | Krea + MiniMax H3 | ✅ **54,0 s**, 3 faixas |
| `clipe-pixel-ol-minimax-908aac` | video OL | Krea + MiniMax H3 | ✅ **54,0 s**, 3 faixas |

## 2.1 Resultado dos três

| projeto | visual | faixas | final | fps |
|---|---|---|---|---|
| `clipe-pixel-ag-c-digo-5aa5da` | pixel art por código (AG) | Vapor Noturno · Luzes de Âmbar · Chuva na Vidraça | **54,0 s** 1920×1080 | 30 |
| `clipe-pixel-ag-minimax-cdae0b` | pixel art Krea → **MiniMax H3** (AG) | Chuva no Vidro · Luzes de Âmbar · (3ª faixa) | **54,0 s** 1920×1080 | 24* |
| `clipe-pixel-ol-minimax-908aac` | pixel art Krea → **MiniMax H3** (Ollama) | Café & Chuva · Neon Drive · Velvet Night | **54,0 s** 1920×1080 | 24* |

\* o MiniMax H3 entrega 24 fps; o ffmpeg preservou a taxa do clipe. O visual entra em loop e a
waveform/nome continuam corretos. Se quiser tudo em 30 fps, é só adicionar `-r 30` na montagem.


## 3. Resultado do primeiro (código + Antigravity)

- **Final:** `54,0 s`, 1920×1080, H.264 + AAC estéreo (3 faixas × 18 s).
- **Faixas:** “Vapor Noturno”, “Luzes de Âmbar”, “Chuva na Vidraça”.
- **Visual:** pixel art de lanchonete à noite, **café fumegante**, **janela** com a cidade, carros e
  letreiro neon “LO-FI CAFE”; loop de 12 s repetido.
- **Faixa atual:** nome no topo esquerdo, mudando em **0 s / 18 s / 36 s**.
- **Waveform:** barra lateral direita “viva”, sincronizada com a playlist.
- **Frames conferidos:** 5 s, 25 s e 45 s — cada um com o nome correto e a waveform.
- **MiniMax (AG):** frames de 5/25 s mostram o café, a janela, os carros e o neon, com
  “Chuva no Vidro” e “Luzes de Âmbar” e a waveform à direita.
- **MiniMax (Ollama):** “Café & Chuva”, “Neon Drive” e “Velvet Night”, também com waveform e loop;
  o AG/OL geraram o plano de músicas e o visual pixel art.

## 4. Como usar no app

1. **Novo projeto** → skill **Clipe musical em loop**.
2. Preencha **Estilo musical** (ex.: lo-fi, jazz, synthwave).
3. Escolha a rota:
   - **código** (pixel art por HTML) — Antigravity;
   - **MiniMax H3** — Antigravity ou Ollama.
4. Crie e execute. O app gera 3 músicas, o loop e o `final.mp4` com nomes + waveform.

## 5. Observações

- O **Yue 2** gera as 3 faixas; a etapa `clip-musical` concatena e faz a playlist.
- O **visual** (12 s no código / clipe MiniMax) é **repetido** até o fim da playlist (54 s).
- Se o filtro de waveform falhar no ffmpeg, o app gera o clipe **sem waveform** e registra no log.
- A animação MiniMax é gerada com a duração da cena (12 s quando o modelo permitir) e, de qualquer
  forma, entra em **loop** na montagem.
- **Validação:** **55 itens (rotas + skills), 0 erros**; testes `engine/ops/skills/features/workflows` **OK**.
- **Projetos:** `G:\PROJECTS\CLAUDE FILMFORGE\21 10 2026 - Copia\projects\clipe-pixel-*`.
- **Relatório:** este arquivo + `docs/music-manifest.json`.
