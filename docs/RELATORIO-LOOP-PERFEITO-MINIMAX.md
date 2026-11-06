# Clipe musical em loop perfeito — MiniMax H3 (primeiro = último frame)

> Pedido: ao criar **clipes musicais**, gerar a **imagem primeiro** (Krea 2 / Z-Image), usar essa
> **mesma imagem como first frame e last frame** no **MiniMax H3**, escrever o **prompt** do vídeo e
> fechar um **loop perfeito**. Teste: clipe **lo-fi** com estilo **anime 2D**, usando **Ollama**.

## 1. O que foi implementado

- **Workflow novo** `workflows/minimax-h3-perfect-loop.json` (+ `.map.json`), a partir do export
  enviado: `7` e `8` são `LoadImage` com a **mesma imagem** (`{{first_frame}}` / `{{last_frame}}`),
  o comprimento vem de `{{seconds}}` na grade **17k+5 a 24 fps**, e o prompt é `{{prompt}}`.
- **Execução ComfyUI**: ao ver `first_frame` e `last_frame`, o FilmForge faz **um único upload** da
  imagem da cena e usa o mesmo arquivo nos dois nós. Grava `scenes/<id>/clips/loop.json` como marca
  de que o clipe veio de um workflow de primeiro/último frame.
- **Prompt do vídeo**: o `scene_plan` agora preenche `videoPrompt` (novo campo de `Scene`), escrito
  pela IA no idioma do prompt (inglês) com movimento cíclico, câmera fixa, início = fim, sem cortes,
  sem texto e sem elementos saindo da borda. `visualPrompt()` usa esse texto no passo `video` de
  clipes musicais.
- **Loop exato no `clip-musical`**:
  1. lê o vídeo do MiniMax e remove o **último frame duplicado** (294 → 293 quadros; 12,250 s → 12,208 s);
  2. usa essa duração como **período do loop**;
  3. gera cada faixa no Yue 2 e a corta/completa para exatamente o período;
  4. monta `N` voltas inteiras do vídeo (`N × período`) com a playlist do mesmo tamanho;
  5. o frame seguinte ao fim é o primeiro quadro — loop **forward**, sem reverse/pingpong.
- **Cadeia de executores**: imagem `krea2-turbo-t2i.json` → fallback `z-image-turbo-t2i.json`;
  vídeo `minimax-h3-perfect-loop-3step.json` (LoRA taomate 3-step) → `minimax-h3-perfect-loop.json` →
  `minimax-h3-ref2v.json` → `minimax-h3-t2v.json`.
- **Redimensionamento do primeiro frame**: o H3 exige lados múltiplos de 32; a resolução antiga
  (832×480) não era 16:9 e **esticava** a imagem em ~2,5%. Agora o vídeo usa a **proporção exata**
  (`fitExactAspect`: 16:9 = **1024×576**, 9:16 = 576×1024, 1:1 = 768×768, 4:5 = 640×800) e o
  workflow aplica `ImageScale` com **crop central** no primeiro e no último frame. O frame não é
  mais esticado; a imagem só é cortada em ~0,5% nas bordas.
- **LoRA 3-step**: o workflow novo adiciona `LoraLoaderModelOnly`
  (`minimax_h3_taomate_3step_lora_avg_rank_19_bf16.safetensors`) e reduz o sampler para **3 steps**.
- **Rota padrão nova**: `clipe-musical-loop` — “Clipe musical em loop (MiniMax H3 — primeiro = último frame)”.
- **Skill** `clipe-musical` atualizada para pedir `videoPrompt`, uma única cena de 12 s e loop perfeito.
- **Robustez**: se o modelo pequeno devolver mais de uma cena para um clipe musical, o motor usa só a
  primeira (evita gerar dois vídeos para o mesmo loop).

## 2. Teste real (Ollama + ComfyUI)

| item | valor |
|---|---|
| Projeto | `clipe-lo-fi-anime-2d-loop-perfeito` |
| Rota | `clipe-musical-loop-ol` (Ollama `tobestyledintro/qwen3.8-9b-distill`) |
| Estilo | **anime 2D**, cel shading, café à noite, chuva, neon, estudante de fones, gato |
| Música | 2 faixas **lo-fi instrumentais**: “Chuva na Janela” e “Vapor de Café” |
| Imagem | Krea 2 Turbo, 1344×752 |
| Vídeo | MiniMax H3 **3-step LoRA taomate**, **1024×576 (16:9 exato)**, 294 quadros, **12,250 s** |
| Loop | `visual-perfect.mp4`: **293 quadros / 12,208 s** (último frame duplicado removido) |
| Playlist | **2 × 12,208 s = 24,416 s** |
| Final | `out/final.mp4` — **1920×1080, 24 fps, 586 quadros, 24,417 s, 27,6 MB** |
| Tempo | script 42 s · cenas 13 s · imagem 60 s · vídeo 168 s · montagem 42 s (**5,4 min**) |

O log registrou:

```text
loop: mesmo frame enviado como primeiro e último (frame.png)
ComfyUI prompt_id=9b039107-6c02-402c-a7be-702231cf6b61
loop perfeito: 293 quadros a 24 fps = 12.208s (último frame duplicado removido)
playlist: 2 faixas × 12.208s = 24.416s
clipe musical pronto: 24.42s = 2 × 12.208s (loop perfeito), waveform cline, 16:9
```

### 2.1 Redimensionamento do primeiro frame

- Antes: imagem 1344×752 (1,787) → vídeo 832×480 (1,733). O H3 redimensionava para o tamanho
  pedido e **esticava** a imagem ~2,5% na horizontal.
- Agora: vídeo em **1024×576 (16:9 exato)** e `ImageScale` com `crop: center` antes do H3. A imagem
  é reduzida/cortada em ~0,5% nas laterais, sem esticar.
- Teste isolado a 3 s: **1024×576, 73 quadros, 3,04 s**; o primeiro frame do vídeo ficou idêntico ao
  recorte central da imagem (mesma geometria, sem deformação).
- `fitExactAspect`: 16:9 = 1024×576, 9:16 = 576×1024, 1:1 = 768×768, 4:5 = 640×800 — todos com
  lados múltiplos de 32, como o H3 exige.
- O `final.mp4` agora escala 1024×576 → 1920×1080 **sem crop adicional** (mesma proporção).

## 3. Verificação do loop

- Vídeo original do H3: **294 quadros** (12,250 s).
- Loop: **293 quadros** (12,208 s) → o último frame gerado (duplicata do primeiro) é descartado.
- `final.mp4`: **586 quadros = 2 × 293**, então o arquivo termina exatamente numa borda de loop.
- Playlist e vídeo têm o **mesmo comprimento** (24,416 s), sem sobra nem corte.
- O primeiro e o último frame do H3 são estruturalmente iguais (mesma composição, personagem,
  enquadramento e luz); as diferenças de PSNR vêm da chuva/vapor/neon animados, não de mudança de cena.
- Frames extraídos para conferência: `%TEMP%\opencode\loopcheck\` (`src-first`, `src-last`,
  `loop-first`, `loop-last`, `final-first`, `final-last`).
- Manifesto: `docs/loop-perfeito-manifest.json`.

## 4. Como repetir

1. Skill **Clipe musical em loop** → estilo musical lo-fi / anime 2D desejado.
2. Rota **Clipe musical em loop (MiniMax H3 — primeiro = último frame)** (ou a rota Ollama
   `clipe-musical-video-ol`, que foi atualizada para o workflow novo). A cadeia começa no
   `minimax-h3-perfect-loop-3step.json` (LoRA taomate, 3 steps) e cai no workflow de 20 steps,
   `ref2v` e `t2v` se precisar.
3. Executar. A imagem é gerada no Krea 2 (fallback Z-Image), o H3 recebe a mesma imagem nos dois
   frames (com `ImageScale`/crop central e proporção exata), e o `clip-musical` fecha o loop com
   `tracks × período`.

## 5. Testes

- `tsc --noEmit`: **0 erros**.
- `engine`, `ops`, `skills`, `features`, `workflows`: **OK**.
- `workflows.test.ts` cobre os dois workflows de loop (first = last = mesma imagem, prompt, seed,
  duração, outputNode `21`), o `ImageScale` e o LoRA 3-step; e `fitExactAspect` (16:9, 9:16, 4:5).
- `--validate`: **60 itens, 0 erros** (rotas, skills e tipos).
- `library`, `wan2gp` e `e2e` não rodam neste ambiente porque exigem `python3`/shell POSIX
  (`spawn python3 ENOENT`); não é regressão deste trabalho.
