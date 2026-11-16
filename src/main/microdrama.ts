import type { Skill } from '../shared/types';

/*
 * MICRODRAMA e DRAMA em episódios — técnicas de short drama vertical (estrutura em 5 atos, gancho visual de 3 s,
 * cliffhanger escrito primeiro, falas de leitura rápida, tropo + torção, composição 9:16, cor-assinatura, clima
 * repetido, elenco consistente, storyboard fechado antes de gerar). Texto próprio do FilmForge, em regras curtas
 * que o roteiro, o plano de cenas e os prompts de imagem/vídeo seguem.
 */

export const DRAMA_STRUCTURE = [
  'ESTRUTURA DO EPISÓDIO em 5 atos (proporção do tempo): GANCHO 5% (os 3 primeiros segundos) → PRESSÃO 25% → CONFRONTO 30% → REVELAÇÃO 25% → CLIFFHANGER 15%.',
  'ESCREVA O CLIFFHANGER PRIMEIRO: decida a última imagem/fala (uma revelação, um tapa que não chega a encostar, um nome dito, uma mensagem no celular, alguém que entra) e construa o episódio inteiro em direção a ela.',
  'GANCHO DOS 3 PRIMEIROS SEGUNDOS: uma IMAGEM que faz uma pergunta, antes de qualquer fala — reação antes do contexto (alguém congela, um objeto cai, uma porta abre). Visual, não discurso.',
  'O FINAL NUNCA FECHA A HISTÓRIA: resolve só parte da pergunta e abre uma maior. A última cena dura 2–3 s a mais que as outras (a imagem fica no ar) e deixa sempre algo para o próximo episódio.',
  'TROPO + TORÇÃO: entregue o tropo que o público espera (CEO e mocinha comum, vingança, contrato de casamento, primeiro amor que volta, segredo de família) e torça UM detalhe concreto (um objeto, um nome, uma data).',
  'Episódio 2 em diante: um único plano de RECAPITULAÇÃO no começo (uma imagem que resume o que importa) e logo a pressão.',
  'Cada episódio é uma batida da temporada, não um filme à parte: mantenha os mesmos personagens, figurinos e objetos-chave.',
].join('\n');

export const DRAMA_DIALOGUE = [
  'FALAS DE LEITURA RÁPIDA: muita gente assiste sem som — cada fala cabe numa olhada (idealmente até 8 palavras; nunca mais de 2 frases). Ex.: "Você guardou." / "Ele sabia o tempo todo."',
  'Subtexto em vez de explicação: ninguém conta o que o público já vê. Nada de "como você sabe…".',
  'Emoção contida: capture o instante ANTES da explosão (o olhar, o silêncio, a mão que treme). Sem gritos abertos nem lágrimas exageradas.',
  'Cada personagem tem um jeito próprio de falar (curto/seco, doce, irônico) e o mesmo nome do começo ao fim.',
].join('\n');

export const DRAMA_VISUAL = [
  'FORMATO VERTICAL 9:16: um rosto por quadro OU dois de perfil (frente a frente); personagens em PROFUNDIDADE, nunca lado a lado como em tela larga. Rosto na metade de cima; o terço de baixo livre para a legenda (escreva no prompt: "room below for subtitles").',
  'OITO PLANOS DO GÊNERO (use pelo menos 5 por episódio): close de abertura; tapa (a reação, nunca o contato); dois num espaço estreito (elevador, corredor); revelação na tela do celular; entrada em contra-plongée; frente a frente de perfil; inserto do objeto-chave; última imagem segurada.',
  'COR-ASSINATURA: uma cor saturada que pertence à história (o guarda-chuva amarelo, o batom vermelho, o envelope azul), IGUAL em todos os planos e episódios; o resto do quadro mais frio e neutro. O código hex fica só na bíblia: nos prompts de imagem e vídeo escreva a cor POR EXTENSO (ex.: "saturated mustard-yellow umbrella", "cold electric-blue neon") e NUNCA "#2E6BF…" — o gerador desenha o código como letreiro na cena.',
  'SEM TEXTO NO QUADRO: nada de letras, números, códigos de cor ou letreiros legíveis nos prompts de imagem/vídeo (escreva "no readable text, no signage with letters or numbers"); a legenda entra na montagem.',
  'CLIMA REPETIDO: as mesmas palavras de clima e luz em TODO prompt da mesma cena (ex.: "night, light rain, wet asphalt reflecting neon, cold blue light, pink and cyan bokeh"). Noite, chuva, neon, vitrines e interiores dourados funcionam bem.',
  'ELENCO CONSISTENTE: repita, palavra por palavra, a descrição física e o figurino de cada personagem (da bíblia) em todo visualIntent em que ele aparece; objetos-chave sempre com a mesma forma e cor.',
  'Ritmo de cortes: planos de 1,5 a 3 s dentro de cada cena; câmera com intenção (push-in lento na revelação, câmera parada no silêncio).',
].join('\n');

export const DRAMA_STORYBOARD = 'STORYBOARD ANTES DE GERAR: cada cena com plano (um dos oito), ângulo, movimento de câmera, duração, quem fala e a emoção. Feche o storyboard antes de gerar imagens e vídeos — gerar é a parte cara; mudar o roteiro depois custa o dobro.';

const drama = (o: { id: string; name: string; description: string; routeId: string; durationSec: number; scene: string; video: string; image: string; extra?: string }): Skill => ({
  id: o.id, name: o.name, builtin: true, multiVoice: true, description: o.description,
  global: [
    'MICRODRAMA/DRAMA DE ALTA RETENÇÃO. Qualidade de roteiro acima de tudo: gancho, pressão, confronto, revelação e cliffhanger.',
    DRAMA_STRUCTURE, DRAMA_DIALOGUE, o.extra ?? '',
  ].filter(Boolean).join('\n\n'),
  steps: {
    script: [
      'Roteiro de episódio. ANTES de escrever, decida (e escreva no topo, em comentário entre colchetes): o tropo, a torção, o cliffhanger final e a cor-assinatura.',
      'Formato: cada fala numa linha "NOME: fala" (2 a 4 personagens com nomes curtos e fixos). Ações entre colchetes numa linha própria. Primeira linha = o gancho visual (ação entre colchetes), não uma fala.',
      DRAMA_STRUCTURE, DRAMA_DIALOGUE,
      'Termine com a linha do cliffhanger e, entre colchetes, "[PRÓXIMO EPISÓDIO: …]" com a pergunta que fica aberta.',
    ].join('\n'),
    bible: 'Bíblia do elenco: para cada personagem, aparência FIXA em inglês (rosto, cabelo, idade, corpo, figurino com cores), voz (gênero, idade, timbre, jeito de falar) e papel no tropo. Inclua a COR-ASSINATURA (hex) e o objeto-chave. Os personagens vão para a Biblioteca: capriche na descrição — ela é a referência de todas as gerações.',
    sets: 'Locais fixos (2 a 3): planta, época, materiais, luz e o CLIMA em inglês (as mesmas palavras serão repetidas em cada prompt da cena).',
    scene_plan: [o.scene, DRAMA_STORYBOARD, DRAMA_VISUAL].join('\n'),
    image: [o.image, DRAMA_VISUAL].join('\n'),
    video: o.video,
    thumbnail: 'Close do rosto no instante antes da explosão emocional, cor-assinatura visível, título de até 3 palavras que abre uma pergunta.',
    metadata: 'Título com o tropo + a torção em até 60 caracteres e o número do episódio ("Ep. 1"); descrição termina perguntando o que o público acha que acontece no próximo.',
    review: 'Confira: gancho visual nos 3 s; 5 atos nas proporções; cliffhanger que deixa pergunta aberta; falas de até ~8 palavras; mesmo rosto/figurino/cor-assinatura em todas as cenas; rosto na metade de cima e espaço para a legenda.',
  },
  appearance: 'micro_drama', routeId: o.routeId, aspect: '9:16', durationSec: o.durationSec, language: 'pt-BR', presentation: 'generated', mediaSources: [],
  scriptEnding: 'next',
  outputStyle: [
    '🎬 Microdrama vertical (9:16) em 5 atos: gancho visual → pressão → confronto → revelação → cliffhanger que puxa o próximo episódio.',
    '🎭 Elenco da Biblioteca com aparência e figurino fixos, cor-assinatura e clima repetidos em todo plano; storyboard antes de gerar.',
    `📦 Saída: final.mp4 (≈ ${o.durationSec}s) + legendas + capa + metadados com o número do episódio.`,
  ].join('\n'),
});

export const DRAMA_SKILLS: Skill[] = [
  drama({
    id: 'microdrama-muse', name: 'Microdrama vertical (Snapgen Muse, fala no clipe)', routeId: 'microdrama-muse', durationSec: 60,
    description: 'Episódio de 1 minuto em 6 cenas de ~10 s: roteiro com gancho e cliffhanger, bíblia do elenco, storyboard, quadro de cada cena e clipe no Snapgen Muse AI com a FALA gerada no próprio vídeo (voz, lábios e emoção juntos).',
    scene: 'Cenas de ATÉ 10 s (o Muse AI gera clipes de 10 s): para 60 s, 6 cenas. kind "video". UMA fala por cena (ou nenhuma, no gancho visual): "speaker" = quem fala, "narration" = só a fala (até ~15 palavras, cabe em 10 s com pausa), "emotion" = a emoção. visualIntent em inglês: plano (um dos oito), quem está em quadro pelo NOME com a descrição física da bíblia, o local com o clima, a cor-assinatura e "room below for subtitles". A ÚLTIMA cena é o cliffhanger: termine a fala cedo e deixe a imagem no ar.',
    image: 'Quadro-chave cinematográfico vertical da cena com os personagens da bíblia (mesmo rosto e figurino), luz e clima da cena; cores por extenso, sem códigos hex; no readable text, no signage with letters or numbers.',
    video: 'O clipe fala: a pessoa em quadro diz a fala da cena com a emoção pedida, lábios sincronizados; atuação contida (o instante antes da explosão); câmera lenta e intencional; sem mudar rosto ou roupa; sem texto na tela.',
  }),
  drama({
    id: 'drama-episodios', name: 'Drama em episódios (elenco + vozes, MiniMax H3)', routeId: 'dorama-elenco', durationSec: 150,
    description: 'Episódio de 2–3 min de série dramática (romance, vingança, família, sobrenatural): mesma estrutura de 5 atos com cliffhanger, elenco da Biblioteca com uma voz por personagem e vídeo com os retratos do elenco como referência.',
    scene: 'UMA fala por cena, kind "video", 3 a 8 s; "speaker" = quem fala; visualIntent em inglês com plano (um dos oito), personagens pelo NOME com a descrição da bíblia, local com o clima, cor-assinatura e "room below for subtitles".',
    image: 'Quadro-chave cinematográfico vertical com os personagens da bíblia (mesmo rosto e figurino), sem texto.',
    video: 'Atuação contida, quem fala move a boca e gesticula pouco, os outros reagem; câmera estável (push-in lento, contraplano, plano fixo); sem mudar rostos ou roupas.',
    extra: 'SUBGÊNEROS: romance CEO (elevadores, quase-beijos, luxo), vingança (humilhação no ep. 1, revanche pública depois; cliffhangers são revelações), sobrenatural (luar, névoa, olhos brilhando), família (filhos escondidos, testamento, mesa de jantar, corredor de hospital).',
  }),
];
