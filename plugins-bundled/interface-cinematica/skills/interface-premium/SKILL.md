---
name: interface-premium
description: Diretrizes para cenas por código e motion graphics com aparência de interface premium — grid, tipografia, paleta, movimento sincronizado à fala e legibilidade em 16:9 e 9:16.
---

# Interface premium em vídeo

Objetivo: cada cena deve parecer uma tela desenhada por um time de produto de primeira linha,
não um slide. Clareza primeiro, personalidade depois, efeito por último.

## 1. Antes de escrever código

- Leia a narração da cena e escreva (num comentário no topo do HTML) **uma frase** com a ideia
  que o espectador precisa entender. Tudo na tela serve a essa frase; o resto sai.
- Escolha **um** elemento-herói por cena (um número, um gráfico, uma palavra, um objeto).
  Ele ocupa 40–60% da área útil. Os demais elementos são apoio, menores e mais discretos.
- Defina a direção visual e mantenha-a em todas as cenas do projeto (se o brief ou a skill
  definirem estilo, eles vencem): ex. "editorial escuro", "painel técnico claro", "papel e tinta".

## 2. Grid e área segura

- 16:9 (1920×1080): margem de 96 px; grid de 12 colunas, calha de 24 px.
- 9:16 (1080×1920): margem lateral de 72 px; mantenha texto fora dos 220 px de baixo
  (legendas/botões das plataformas) e dos 160 px de cima.
- Alinhe tudo a uma grade de 8 px. Nada "quase alinhado".
- Respiro é conteúdo: no máximo 3 blocos de informação visíveis ao mesmo tempo.

## 3. Tipografia

- No máximo 2 famílias: uma de display (títulos, números) e uma de texto. Use fontes do
  sistema ou embutidas no HTML; nunca dependa de rede.
- Escala modular (razão 1,25–1,333). Em 1080p: corpo mínimo 34 px; títulos 72–140 px;
  número-herói 180–320 px. Em 9:16, aumente 15%.
- Pesos: 400 para texto, 600–800 para destaque. Entrelinha 1,15 em títulos, 1,4 em texto.
- Números em `font-variant-numeric: tabular-nums` quando animam ou formam colunas.
- Até 7 palavras por linha na tela; frases longas pertencem à narração, não ao quadro.

## 4. Cor

- Defina tokens CSS em `:root` (fundo, superfície, texto, texto-suave, acento, acento-2,
  positivo, negativo) e use só eles.
- Um acento dominante + um secundário. O acento marca exatamente o que a narração está
  dizendo naquele instante.
- Contraste mínimo 4,5:1 para texto (7:1 para texto pequeno). Evite preto puro sobre branco
  puro em telas grandes: prefira #0B0D12 / #F4F5F7.
- Gradientes sutis (≤ 8% de variação de luminosidade) e uma textura leve de ruído evitam
  banding na compressão do vídeo.

## 5. Movimento

- Toda animação é função do tempo `t` (determinística): nada de `Date.now()`, `setInterval`
  ou aleatório sem semente — o FilmForge renderiza quadro a quadro.
- Entradas 300–600 ms com `cubic-bezier(.2,.8,.2,1)`; saídas mais curtas (200–350 ms).
- Escalone elementos relacionados em 60–90 ms. Nunca anime mais de 3 coisas ao mesmo tempo.
- Sincronize os destaques com as palavras da narração (use os tempos por palavra quando
  disponíveis): o elemento aparece ~120 ms **antes** da palavra correspondente.
- Movimento de câmera contínuo e lento (zoom 2–4% por cena, paralaxe leve) dá vida sem distrair.
- Números contam até o valor com easing; gráficos crescem a partir da base; linhas se desenham
  no sentido de leitura.

## 6. Componentes que funcionam em vídeo

- **Cartão de dado**: rótulo pequeno em caixa-alta + número-herói + variação (▲/▼ colorida).
- **Gráfico**: no máximo 5 séries; rótulos diretos nas linhas/barras (sem legenda separada);
  eixos discretos; a série importante no acento, as outras em cinza.
- **Lista**: 3 itens, ícone simples + 2–4 palavras; o item falado fica 100% opaco, os demais 40%.
- **Comparação**: duas colunas simétricas, a diferença destacada com cor e tamanho.
- **Interface simulada** (app, painel, terminal): realista mas simplificada — 1 ação por vez,
  cursor visível, cliques com feedback (escala 0,97 + ripple).
- Ícones em SVG de traço uniforme (1,75–2 px a 1080p). Cantos com raio consistente (12–20 px).

## 7. Qualidade técnica

- Um único arquivo HTML autocontido; CSS e JS embutidos; sem chamadas de rede.
- Use `transform` e `opacity` para animar (sem layout a cada quadro).
- Teste mentalmente o primeiro, o do meio e o último quadro: os três precisam estar
  bonitos e legíveis sozinhos (o primeiro quadro vira miniatura).
- Nada de texto cortado, sobreposto ou fora da área segura em nenhum instante.

## 8. Checklist final da cena

1. A frase-ideia está clara em 2 segundos de tela?
2. Há um único herói e ele domina a composição?
3. Fontes, cores e raios são os mesmos das outras cenas?
4. Todo destaque coincide com a fala?
5. Legível num celular, com som desligado?
