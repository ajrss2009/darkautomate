# Paris lo-fi — 2 faixas, 16-bit + MiniMax, loop perfeito (Ollama/Qwen)

> Pedido: compilação de **2 músicas** lo-fi instrumentais, tema **tarde aconchegante em Paris**,
> visual **16-bit por código** e **MiniMax H3**, com **loop perfeito**, nome da faixa e waveform.

## 1. O que foi ajustado para este pedido

- **2 faixas** (o `clip-musical` agora aceita de 2 a 5; a rota fixa `tracks: 2`).
- **Músicas de 12 s** (o plano do `script.md` é respeitado).
- **Loop perfeito (pingpong)**: o visual é cortado em **12 s** e concatenado com ele mesmo
  **reverso** → **24 s**. Com 2 faixas de 12 s, o **final tem 24 s** e fecha o loop inteiro
  (vídeo + playlist) sem salto.
- **Template 16-bit Paris** embutido: se o Ollama não conseguir gerar a cena por código, o app
  renderiza um loop 16-bit de Paris (Torre Eiffel, café, xícara, carros, chuva, gato) e usa no clipe —
  o resultado continua sendo código/canvas.
- **Waveform lateral** + **nome da faixa** (ASS) a cada 12 s.

## 2. Projetos

| projeto | rota | visual | faixas | final |
|---|---|---|---|---|
| `paris-lo-fi-16-bit-ollama-c-digo-1fcd5d` | `clipe-musical-code-ol` | **16-bit por código** (template Paris, pois o 9B não gravou `code/scene.html`) | Acordeão de Montmartre · Chuva na Rue de Seine | **24,0 s** 1920×1080 **30 fps** |
| `paris-lo-fi-16-bit-ollama-minima-801948` | `clipe-musical-video-ol` | **Krea → MiniMax H3** | Acordeão de Montmartre · Vinil da Torre Eiffel | **24,0 s** 1920×1080 **24 fps** |

## 3. Loop — por que está perfeito

- `out/visual-12.mp4` = **12 s** exatos (recorta/repete o clipe).
- `out/visual-loop.mp4` = **forward 12 s + reverse 12 s = 24 s**.
- Playlist = **2 × 12 s = 24 s**.
- `final.mp4` = **24 s**; o visual e a playlist têm **exatamente o mesmo comprimento**.
- Frames conferidos: **0 s e 23,9 s** mostram a mesma cena/posição (o 23,9 s é o espelho de 0,1 s);
  em **12 s** ocorre a troca de faixa (e o espelho do vídeo), sem corte seco.
- Não há `requestAnimationFrame` no render de código (o frame é `seek(t)` + `pause()`), então o
  loop também não “pisca”.

## 4. O que aparece no vídeo

- **Código (30 fps):** Paris 16-bit com Torre Eiffel, céu em degradê, carros, chuva, xícara
  fumegante, luzes e gato; **waveform** à direita; nome da faixa no topo.
- **MiniMax (24 fps):** café parisiense com janela, Torre Eiffel ao fundo, carros, chuva, folhas,
  gato, xícara e neon; **waveform** à direita; nomes “Acordeão de Montmartre” e
  “Vinil da Torre Eiffel”.

## 5. Ollama/Qwen

- `script` e `scene_plan` rodaram no **`tobestyledintro/qwen3.8-9b-distill:latest`**.
- No projeto de **código**, o modelo **não gravou** `code/scene.html`; o app usou o **template 16-bit**
  (mesma linguagem visual) e o clipe foi entregue. No **MiniMax**, o fluxo foi 100% pelo modelo +
  ComfyUI.
- Para código **gerado pelo modelo** com mais confiabilidade, o harness indicado continua sendo o
  **Antigravity** (o 9B falha no contrato `window.__forge`).

## 6. Verificação

- `tsc`: **0**; testes `engine/ops/skills/features/workflows`: **OK**.
- **Validação da biblioteca: 56 itens, 0 erros.**
- Finais:
  - `paris-lo-fi-16-bit-ollama-c-digo-1fcd5d/out/final.mp4` — 24 s, 9,5 MB, 30 fps.
  - `paris-lo-fi-16-bit-ollama-minima-801948/out/final.mp4` — 24 s, 26 MB, 24 fps.
- Relatório: este arquivo; manifesto: `docs/paris-manifest.json`.

## 7. Como repetir

1. Skill **Clipe musical em loop** → **Estilo musical** `lo-fi, chanson française, acordeão suave,
   café, vinil, instrumental, sem vocais, aconchegante`.
2. Rota **`clipe-musical-code-ol`** (código) ou **`clipe-musical-video-ol`** (MiniMax).
3. A rota já leva `tracks: 2` e `loopMode: pingpong`.
