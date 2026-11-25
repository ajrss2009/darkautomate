---
name: Clipe musical de pasta — determinístico
description: "Videoclipe determinístico com uma pasta de músicas e uma pasta de imagens/vídeos. Usa toda a mídia única antes de repetir, planos de 4–8 s no beat, zoom in/out nas imagens e cortes secos. Sem IA no vídeo (somente a thumbnail usa modelo de imagem com a referência enviada), sem narração e sem caminhos absolutos."
appearance: custom
routeId: clipe-musical-pasta-deterministico
aspect: "16:9"
durationSec: 60
language: pt-BR
presentation: mixed
mediaSources: []
mixSources: []
thumbnailTemplate: youtube-thumb-lx79njzodz8
scriptEnding: conclusion
multiVoice: false
musicVideo: true
freeform: false
reviewCriteria: "Duração igual à música; planos de 4–8 s; mídia única antes de repetir; repetição determinística com aviso só quando o estoque acaba; imagens somente com zoom in/out; vídeos contíguos e sem áudio; cortes secos; música íntegra a -14 LUFS; nenhuma IA no vídeo, narração, texto inventado ou banco externo; thumbnail gerada por modelo de imagem seguindo a referência enviada."
outputStyle: "🎵 Música do usuário · 📁 mídia do usuário · ✂️ planos de 4–8 s no beat · 🔁 único antes de repetir · 🖼 zoom in/out · 🎬 trecho contíguo sem áudio · 🔊 -14 LUFS · sem IA no vídeo; 🖼 thumbnail por modelo de imagem com a referência enviada."
---

## Global

A música é o relógio e a mídia do usuário é o visual. Use somente os anexos do projeto; nunca gere imagem, vídeo, narração ou música no VÍDEO — a thumbnail é a única exceção: ela é gerada por modelo de imagem e segue a imagem de referência enviada no projeto. A duração final é a duração real da faixa ou coletânea. A semente deriva do id do projeto e da faixa, tornando o plano reproduzível. Use todos os grupos únicos de mídia antes de repetir; se o estoque acabar, repita em ciclo determinístico, evite o grupo anterior quando houver alternativa e registre aviso. A skill e a rota não contêm caminhos absolutos nem dependência de banco local fixo.

## Etapa: music

Use exclusivamente o áudio marcado como trilha sonora nos anexos. Se for uma pasta, preserve a coletânea e o coletanea.json. Sem música do usuário, pare.

## Etapa: scene_plan

Monte a grade com beat-montage. Para cada faixa, crie planos de 4 a 8 s, encaixados no beat/downbeat quando houver confiança. Duplicatas perceptivas são um único grupo. Primeiro use os grupos ainda não usados; depois permita repetição determinística, dando preferência ao menos usado e evitando o grupo anterior quando houver alternativa. Se só existir um grupo, repita com aviso.

## Etapa: image

Use o arquivo do usuário em userMedia. Aplique somente zoom in ou zoom out determinístico; não use pan, tilt ou handheld. Crop central quando o aspecto diferir; nunca estique.

## Etapa: video

Use o arquivo do usuário em userMedia e um trecho contíguo semeado. Descarte o áudio do clipe. Se o vídeo for mais curto que o plano, reprove; não congele, não faça câmera lenta e não substitua por IA.

## Etapa: edit

Corte seco entre todos os planos, sem transição. Música do usuário em volume integral, masterizada para -14 LUFS. O vídeo termina exatamente no fim da música, sem cauda ou truncamento.

## Etapa: thumbnail

Gere a thumbnail com modelo de imagem/LLM (Google Flow → Z-Image local → API de imagem), usando a IMAGEM DE REFERÊNCIA enviada no projeto como modelo de estilo: mesma composição, enquadramento, posição e tamanho do texto, contraste, iluminação e paleta. O tema, o assunto e o título são deste vídeo/faixa — não copie o texto, a marca, o logo ou o rosto da referência. O quadro do vídeo só entra como reserva se nenhum gerador estiver disponível.

## Etapa: review

Reprovar se a duração não bater com a música, se algum plano sair de 4–8 s, se houver repetição enquanto ainda existia mídia única, se a repetição não for determinística ou não gerar aviso, se imagem usar pan/tilt, se vídeo tiver áudio ou trecho descontínuo, ou se houver IA no vídeo, banco externo, narração ou texto inventado. A thumbnail deve seguir a referência enviada sem copiar seus elementos.
