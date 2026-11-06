# Relatório — frames das cenas de código + voz da narração

> Correção aplicada em 22/10/2026. Testes com **Antigravity `gemini-3.8-flash-low`** e
> **Ollama `qwen3.8-9b`** (distill para texto, coder para código).

## 1. Diagnóstico do “piscando / muito rápido”

As cenas de código tinham **30 fps e duração próxima da cena**, mas o HTML gerado mantinha um
**loop de pré-visualização com `requestAnimationFrame`** rodando **durante a captura**. O renderizador
chamava `seek(t)` e capturava, mas o RAF podia desenhar **outro instante** antes do `capturePage` —
daí o aspecto de **quadros fora de ordem / aceleração / piscar**. Além disso, o renderizador usava a
**duração e o fps declarados pela página**, não a duração real da cena no vídeo final.

Evidência (clipes antigos, todos 30 fps): 204 quadros / 6,80 s; 191 / 6,37 s; 142 / 4,73 s;
146 / 4,87 s; 116 / 3,87 s; 160 / 5,33 s; 180 / 6,00 s. O problema não era o número de quadros
em si, e sim **o relógio paralelo do RAF** durante a captura.

## 2. Correção

`src/main/render.ts` agora:

1. usa **a duração da cena** (`scene.durationSec`, narração + 0,15 s) e **30 fps**;
2. calcula **exatamente `round(duração × 30)` quadros**;
3. chama **`window.__forge.pause()`** e **desliga `requestAnimationFrame`** + animações CSS;
4. espera o compositor pintar e captura `seek(i/30)` quadro a quadro;
5. codifica com `-framerate 30 -r 30` (sem reamostragem);
6. a montagem **só repete** o clipe (`-stream_loop -1`) se ele for realmente mais curto que a cena;
   com o clipe de código exato, **não há loop** (antes repetia 1 quadro no fim).

`src/main/executors.ts` passa `duration`/`fps` ao renderizador e registra no log:
`render determinístico: 5,31s a 30 fps (159 quadros)`.

`src/main/prompts.ts` agora exige no contrato:

```js
window.__forge = {
  duration: <duração da cena>,
  fps: 30,
  seek(t) { /* desenha o quadro em t (0..duração), síncrono */ },
  pause() { /* cancela o requestAnimationFrame */ }
}
```

e proíbe `Date.now` / `performance.now` / `Math.random` sem seed como relógio.

**Resultado no teste 01 (Stickman + Antigravity):**
- cena 1: **159 quadros / 5,30 s** (era 204 / 6,80 s);
- cena 2: **184 quadros / 6,13 s** (era 191 / 6,37 s);
- final: **11,46 s** (a narração com a voz escolhida ficou mais curta que a anterior).

## 3. Voz da narração

- Pasta criada/listada: `C:\Users\ajrss\OneDrive\Documentos\FilmForge\voices`
- **Escolhida:** `ref_antonio_24k_mono.wav` (voz do Antônio, 24 kHz mono) — usada em todas as rotas
  de narração dos testes; o log mostra `voz de referência: ref_antonio_24k_mono.wav`.
- **Arquivos disponíveis:**
  `CapCut_TTS_Marcus.mp3`, `Dave PT-BR.MP3`, `Escarlete PT-BR.MP3`, `Knightley PT-BR.MP3`,
  `Marcus PT-BR.MP3`, `ref_antonio_24k_mono.wav`, `ref_antonio_dualidade2_12s.wav`,
  `ref_user_voice.wav`, `Valentino PT-BR.MP3`, `voz ANTONIO English.m4a`,
  `VOZ_ANTONIO (ENHANCED).wav`.
- **UI:** no editor da rota, a etapa **Narração** com executor **ComfyUI** ganhou o seletor
  **“Voz (referência)”** (lê a pasta `voices`). Para **API**, o seletor de voz já mostra as vozes do
  provedor; no OpenAI configurado: **alloy, nova, onyx**.
- O executor ComfyUI grava no log a voz usada e envia o arquivo ao ComfyUI antes da execução.

## 4. Testes desta rodada

| teste | harness | rota | voz | frames/cena | final | status |
|---|---|---|---|---|---|---|
| 01 Stickman | Antigravity | código | Antônio | **159, 184** | 11,43 s | ✅ |
| 02 Misto | Antigravity | misto | Antônio | **244, 137** | 16,67 s | ✅ |
| 03 Código+YouTube | Antigravity | código + YouTube 4 s | Antônio | **145, 203, 113** | 15,37 s | ✅* |
| 08 Stickman | Ollama | código (coder) | Antônio | falhou (3 cartões) | 21,60 s | ⚠️ |
| OL Misto | Ollama | misto | Antônio | falhou (2 cartões) | 14,50 s | ⚠️ |
| OL Código+YouTube | Ollama | código + YouTube 4 s | Antônio | falhou (2 cartões) + stock | 17,10 s | ⚠️ |

\* **03:** o YouTube foi tentado com **duas buscas** (a consulta e “stock footage”), mas **todos** os
clipes foram rejeitados pela visão por **texto/marca** (inclusive um 9/10). O app caiu para **Pexels**
(3 clipes limpos) e manteve o limite de **4 s** nos trechos do YouTube testados. O final tem b-roll
limpo, mas **não do YouTube** — é o trade-off de “sem legendas/marcas”.

### O que foi comprovado

- **Frames exatos**: em todas as cenas de código bem-sucedidas, `nb_frames` = `round(duração × 30)`:
  - 01: 5,31 s → **159**; 6,12 s → **184**;
  - 02: 8,13 s → **244**; 4,57 s → **137**;
  - 03: 4,82 s → **145**; 6,77 s → **203**; 3,78 s → **113**.
- **Sem loop de prévia**: o log do agente mostra `pause()` e “render determinístico: Xs a 30 fps (N quadros)”.
- **Voz**: todas as narrações usaram `ref_antonio_24k_mono.wav`; o log registra
  `voz de referência: ref_antonio_24k_mono.wav`.
- **03**: a visão rejeitou **todos** os clipes de YouTube encontrados (texto/marca), inclusive um 9/10;
  a reexecução busca também “stock footage” e, se necessário, usa **Pexels** como reserva (o YouTube
  continua sendo tentado primeiro).
- **Ollama 9B**: distill e coder não cumpriram `window.__forge.seek(t)` de forma confiável;
  o fallback de **cartão com título** evita fundo preto. O script do OL código+YouTube falhou por
  não gravar `script.md`; a reexecução força `retry` e proíbe `web_search` nessa etapa.
### Resultado dos testes (finais)

- **01 Stickman (AG):** final **11,43 s**; 2 cenas de código **159/184 quadros**; voz Antônio.
- **02 Misto (AG):** final **16,67 s**; `code` **244** e `mixed` **137 quadros** + vídeo MiniMax.
- **03 Código+YouTube (AG):** final **15,37 s**; **145/203/113 quadros**; YouTube todo rejeitado
  (texto) → **Pexels**; 3 clipes do Pexels, sem legendas.
- **08 Stickman (OL):** final **21,60 s**; 3 cenas de código falharam no contrato → **3 cartões**
  com narração; sem preto.
- **OL Misto:** final **14,50 s**; 2 cartões (code/mixed) + **vídeo MiniMax** na cena 3.
- **OL Código+YouTube:** final **17,10 s**; script corrigido (retry, sem web_search); cenas 1 e 3
  em **cartão**, cena 2 com **stock**; narração Antônio.

### Conclusão

- O defeito de **“piscando/acelerado”** era o **loop de pré-visualização (RAF)** durante a captura +
  uso da duração declarada pela página. Agora o renderizador **congela a prévia** e usa
  **duração da cena × 30 fps**, com **frames exatos** e **sem loop** de 1 quadro.
- A **voz** está escolhida e aplicada (`ref_antonio_24k_mono.wav`), com seletor no editor para
  ComfyUI e vozes de API no provedor.
- **YouTube “sem texto”** pode ser impossível para um tema específico; o app tenta, rejeita com
  visão e usa **Pexels** limpo como reserva.
- **Antigravity** entrega cenas de código boas; o **Ollama 9B** ainda não cumpre o contrato de
  `window.__forge` — os cartões mantêm o vídeo válido, mas o ideal é usar Antigravity para código.

## 5. Observações

- **YouTube:** `params.maxSeconds = 4` continua valendo; os clipes baixados têm no máximo 4 s.
- **Ollama 9B:** segue sem cumprir `window.__forge.seek(t)` de forma confiável (distill e coder);
  quando falha, a montagem usa **cartão de fallback** com o título da cena (sem fundo preto).
- **API de voz:** os testes usam ComfyUI/OmniVoice; para API OpenAI as vozes são **alloy, nova, onyx**.
