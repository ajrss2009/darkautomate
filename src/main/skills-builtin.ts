import type { MixSource, ScriptEnding, Skill, VideoTypeId } from '../shared/types';
import { BUILTIN_SKILLS as BASE_SKILLS, MIXED_STOCK_SOURCES, VIDEO_TYPES } from './presets';
import { DRAMA_SKILLS } from './microdrama';

/**
 * Conteúdo editorial de cada tipo de vídeo. Cada tipo vira uma skill padrão (somente leitura).
 * ending: como o roteiro termina (padrão: loop nos verticais curtos, conclusão nos demais);
 * mix: fontes que a apresentação mista mescla; steps: instruções extras/específicas por etapa.
 */
interface TypeCopy {
  desc: string; visual: string; pace: string; voice: string; scenes: string; thumb: string; mixed?: boolean;
  mix?: MixSource[]; ending?: ScriptEnding; multiVoice?: boolean; review?: string; steps?: Record<string, string>;
}

const COPY: Partial<Record<VideoTypeId, TypeCopy>> = {
  slideshow: { desc: 'Slideshow narrado: uma imagem por ideia, com movimento de câmera (Ken Burns/pan), transições suaves, efeitos sonoros gerados por código no instante da fala e personagens fixos com a mesma aparência.',
    visual: 'Ilustrações coerentes entre si (mesma paleta, luz e traço); personagens recorrentes descritos UMA vez em "Personagens fixos" e citados pelo nome em cada cena; sem texto dentro das imagens.',
    pace: 'Uma imagem a cada 6–10 s; a imagem muda quando a ideia muda; ritmo de documentário didático.', voice: 'Narração clara, curiosa e didática, com fatos verificados e exemplos concretos.',
    scenes: 'Todas as cenas "image" (slides). visualIntent em inglês, com o nome dos personagens fixos que aparecem; "sfx" com 1–2 efeitos sincronizados por palavra da narração.',
    thumb: 'Comparação visual forte (antes × depois) com 2–3 palavras grandes.', ending: 'conclusion',
    review: 'Personagens com a mesma aparência em todas as imagens; nenhuma imagem com texto; efeitos sonoros no momento certo e discretos; narração com fatos corretos; sem música.',
    steps: {
      asset_design: 'Crie 2 a 4 personagens fixos que conduzem a história (ex.: um caçador-coletor e uma pessoa atual), com aparência detalhada e imutável.',
      scene_plan: 'Cenas "image" de 6–10 s (total = duração alvo). Em cada cena: visualIntent em inglês citando os personagens fixos pelo nome, enquadramento variado (plano geral, médio, close, detalhe); "sfx" com 1–2 efeitos no formato "nome:palavra" para tocarem quando a palavra é dita (ex.: "crunch:mastigar", "stone:pedra", "tick:anos").',
      image: 'Uma ilustração por cena, mesma paleta e traço em todas; personagens idênticos à ficha; sem texto, letras ou marcas d\'água.',
    } },
  stickman: { desc: 'Bonecos de palito expressivos explicando ideias, em fundo branco.', visual: 'Bonecos de palito com traço preto grosso, fundo branco, poses expressivas, poucos adereços; cores só para destacar um elemento.', pace: 'Cenas de 3–6 s, uma ideia por cena, humor leve.', voice: 'Narração animada e bem-humorada, frases curtas.', scenes: 'Cenas "code" (bonecos animados por código, desenhados e revelados junto com a fala); "motion" só para números e palavras-chave.', thumb: 'Boneco de palito grande com expressão exagerada e 2–3 palavras em fonte grossa.' },
  realistic: { desc: 'Vídeo fotorrealista e cinematográfico, com personagens consistentes.', visual: 'Fotorrealismo, luz cinematográfica, 35 mm, profundidade de campo rasa, câmera com movimentos suaves; personagens e locações consistentes entre cenas.', pace: 'Cenas de 4–8 s com cortes de ritmo médio; planos abertos alternados com close-ups.', voice: 'Narração grave e calma, com pausas dramáticas.', scenes: 'Cenas "video" (imagem → vídeo); descreva lente, luz e movimento de câmera em cada visualIntent.', thumb: 'Close cinematográfico, contraste alto, texto curto discreto.' },
  anime_2d: { desc: 'Anime 2D com arte de linha limpa e personagens consistentes.', visual: 'Estilo anime 2D, linhas limpas, cel shading, cores vibrantes; ficha de personagem fixa (cabelo, roupa, cores).', pace: 'Cenas de 3–6 s, ritmo dinâmico, golpes de câmera e frames de impacto.', voice: 'Narração expressiva, emocional, com energia.', scenes: 'Cenas "image" com leve animação (zoom/paralaxe) e algumas "video" nos momentos de ação.', thumb: 'Personagem em pose de impacto, cores saturadas, texto em fonte estilo mangá.' },
  cartoon_3d: { desc: 'Desenho 3D estilizado, divertido e colorido.', visual: '3D cartoon estilizado, iluminação suave, personagens simpáticos e ambiente detalhado e limpo.', pace: 'Cenas de 3–6 s, ritmo ágil, gancho forte.', voice: 'Narração animada e simpática.', scenes: 'Mistura de "image" e "video"; mantenha o mesmo elenco em todas as cenas.', thumb: 'Personagem 3D de frente com expressão forte e texto grosso.' },
  pixel_art: { desc: 'Cenas em pixel art 16-bit, estilo jogo clássico.', visual: 'Pixel art 16-bit, paleta limitada, pixels nítidos sem antialias, cenários de side-scroller.', pace: 'Cenas de 3–5 s, ritmo de jogo retrô, transições por tela cheia.', voice: 'Narração divertida, referências a jogos clássicos.', scenes: 'Cenas "code" (canvas com pixels grandes) e "image" em pixel art.', thumb: 'Sprite grande, paleta chapada de poucas cores, texto pixelado.' },
  flat_explainer: { desc: 'Explicativo flat com formas geométricas e cores sólidas.', visual: 'Ilustração flat vetorial, cores sólidas, formas geométricas simples, sem gradientes.', pace: 'Cenas de 4–7 s, uma ideia por cena, revelação progressiva de elementos.', voice: 'Narração didática, clara, tom profissional e amigável.', scenes: 'Predominância de "code" com infográficos e ícones; 1 analogia visual por conceito difícil.', thumb: 'Ícone grande e simples com 3 cores e título curto.' },
  ms_paint: { desc: 'Rabiscos estilo MS Paint, humor e caos controlado.', visual: 'Rabiscos toscos de MS Paint, linhas trêmulas, cores chapadas brilhantes, humor visual.', pace: 'Cenas de 2–4 s, cortes rápidos, piadas visuais.', voice: 'Narração irônica e acelerada.', scenes: '"code" e "image" com aspecto amador proposital; setas, círculos vermelhos e zoom brusco.', thumb: 'Rabisco exagerado, setas e círculos vermelhos, texto torto.' },
  vox_collage: { desc: 'Documentário em colagem de recortes, marca-texto e tipografia cinética.', visual: 'Colagem de papel com fotos recortadas, bordas rasgadas, marcações de marca-texto e tipografia cinética.', pace: 'Cenas de 3–6 s, ritmo editorial, destaque de palavras-chave na tela.', voice: 'Narração jornalística, clara e envolvente.', scenes: 'Cenas "mixed" (colagem por código com fotos de arquivo dos bancos de mídia recortadas) e "motion" para dados e palavras-chave; preencha searchTerms em inglês.', thumb: 'Recorte de foto com borda rasgada, marca-texto amarelo e título curto.', mixed: true, mix: ['motion', 'stock'],
    steps: { code_scene: 'Monte a colagem: as fotos de stock/ entram recortadas (clip-path com borda irregular), com sombra de papel e marca-texto animado sobre as palavras-chave no momento em que são faladas.' } },
  low_poly: { desc: 'Cenas 3D low poly com paleta pastel.', visual: 'Cena 3D low poly, triângulos com flat shading, paleta pastel, câmeras simples.', pace: 'Cenas de 4–6 s com movimentos de câmera suaves.', voice: 'Narração tranquila e contemplativa.', scenes: 'Cenas "code" (WebGL/Canvas) em low poly, rotação lenta de objetos.', thumb: 'Objeto low poly central com gradiente de fundo suave.' },
  recon_3d: { desc: 'Ambientes reconstruídos em 3D com câmera sobrevoando.', visual: 'Ambiente 3D reconstruído, geometria consistente, câmera virtual em sobrevoo.', pace: 'Cenas de 5–8 s, câmera contínua e fluida.', voice: 'Narração investigativa, tom factual.', scenes: 'Cenas "video" com movimento de câmera contínuo; evite cortes bruscos de geometria.', thumb: 'Vista aérea do ambiente com ponto de interesse destacado.' },
  doc_netflix: { desc: 'Documentário de prestígio com reconstituições 3D, imagens de arquivo e infográficos.', visual: 'Estética de documentário de streaming: ambientes 3D consistentes, luz dramática, texturas de arquivo, infográficos cinéticos.', pace: 'Narrativa em três atos, cenas de 5–10 s, respiros entre revelações.', voice: 'Narração séria, pausada, com tensão crescente.', scenes: 'Mistura de "video" (reconstituições 3D com câmera em sobrevoo lento), "stock" (arquivo real, com searchTerms em inglês) e "code" (mapas, linhas do tempo e números). No máximo 40% de cenas "video".', thumb: 'Cena dramática escura com título curto e um elemento em destaque.', mixed: true, mix: ['motion', 'stock', 'ai'], ending: 'conclusion',
    review: 'Três atos claros; fatos e datas coerentes; reconstituições sem geometria tremida; infográficos legíveis; música bem abaixo da voz; fontes na descrição.',
    steps: { video: 'Câmera virtual em sobrevoo lento e contínuo pelo ambiente reconstruído; geometria estável, sem cortes, luz dramática.', image: 'Quadro-chave do ambiente reconstruído em 3D, luz dramática, composição de documentário, sem texto.' } },
  whiteboard: { desc: 'Quadro branco desenhado à mão, com marcador azul e preto.', visual: 'Animação de quadro branco, desenho à mão com marcador preto e azul, sem preenchimentos coloridos.', pace: 'Cenas de 5–8 s; o desenho acompanha a fala, elemento por elemento.', voice: 'Narração de professor: calma, explicativa, passo a passo.', scenes: 'Cenas "code" com traço sendo desenhado (stroke-dashoffset) e legendas manuscritas.', thumb: 'Quadro com desenho simples e título manuscrito grande.' },
  motion_graphics: { desc: 'Motion graphics com tipografia cinética e gráficos animados.', visual: 'Motion graphics limpo, tipografia cinética, gráficos animados, paleta de marca consistente.', pace: 'Cenas de 3–6 s, easing suave, números que crescem junto com a fala.', voice: 'Narração objetiva e profissional.', scenes: 'Cenas "motion" e "code"; texto grande de até 6 palavras.', thumb: 'Tipografia grande sobre fundo de cor sólida e um gráfico simples.' },
  micro_drama: { desc: 'Microdrama/série vertical com atuação emocional, elenco consistente e uma voz por personagem.', visual: 'Drama curto, close-ups cinematográficos, atuação emocional, elenco e figurino consistentes.', pace: 'Episódio curto; cada cena termina em gancho; cliffhanger no final.', voice: 'Diálogos naturais e emoção contida; cada personagem fala com a própria voz (elenco do projeto); narrador só quando necessário.', scenes: 'Cenas "video" com UMA fala por cena: preencha "speaker" com o nome do personagem que fala e "narration" só com a fala (sem o nome). Repita a mesma descrição física de cada personagem em todo visualIntent em que ele aparece.', thumb: 'Close emocional de um personagem com frase de impacto.', ending: 'next', multiVoice: true,
    steps: { script: 'Escreva como roteiro de cena: cada fala numa linha no formato "NOME: fala". Use 2 a 4 personagens com nomes curtos e fixos. Termine em cliffhanger.' } },
  ad_product: { desc: 'Anúncio de produto premium com chamada para ação.', visual: 'Comercial premium: luz de estúdio, hero shots do produto, fundo limpo, chamada para ação em destaque.', pace: '20–40 s; benefício nos 3 primeiros segundos; CTA nos últimos 5 s.', voice: 'Narração confiante e persuasiva, sem exageros.', scenes: 'Cenas "video" e "image" com o produto sempre visível; a última cena é "code" com a oferta e a chamada para ação em texto grande.', thumb: 'Produto em destaque, fundo limpo e oferta em 2–3 palavras.', ending: 'conclusion' },
  interactive_story: { desc: 'Cenas de história visual (versão linear; ramificações em versão futura).', visual: 'Cenas de visual novel, personagens em primeiro plano, cenários pintados.', pace: 'Cenas de 5–8 s com pausas para decisões narrativas.', voice: 'Narração de contador de histórias.', scenes: 'Cenas "image" com legendas de diálogo.', thumb: 'Personagem principal e uma escolha em destaque.', ending: 'next' },
  music_lyric: { desc: 'Lyric video: a canção é gerada com a sua letra e cada verso aparece sincronizado em tipografia cinética.', visual: 'Visualizador reativo ao áudio, tipografia cinética sincronizada com a letra.', pace: 'Cenas acompanham os blocos da letra (verso/refrão); troque de visual a cada bloco.', voice: 'Sem narração falada: a canção é o áudio e a letra é o texto da tela.', scenes: 'Uma cena "code" por bloco da letra, na ordem da canção.', thumb: 'Título da música em tipografia grande sobre visual abstrato.',
    steps: {
      script: 'Grave `script.md` com: 1) uma linha `TITLE: <nome da canção>`; 2) uma linha `STYLE: <gênero, instrumentos, andamento, voz>` em inglês; 3) a linha `LYRICS:` seguida da letra, um verso por linha, com blocos separados por linha em branco e rótulos [verse], [chorus], [bridge] antes de cada bloco; 4) `VISUAL:` com o conceito visual (paleta em hex, tipografia, formas). Letra cantável, rimas simples, refrão repetido 2 vezes. Não escreva narração.',
      scene_plan: 'Use os tempos de `out/lyrics-timing.json` (um item por verso). Crie UMA cena "code" por bloco da letra, na ordem; `narration` = os versos do bloco exatamente como na letra (separados por " / "); `durationSec` = fim − início do bloco; `visualIntent` = como a tipografia e o fundo se comportam naquele bloco (refrão mais intenso).',
      code_scene: 'Tipografia cinética: cada verso entra no instante exato em que é cantado (TEMPOS DA NARRAÇÃO = tempos da letra) e sai antes do próximo; palavra cantada em destaque; fundo abstrato que pulsa no andamento. Texto grande e legível, nunca cortado na borda.',
      narration: 'Não há narração nesta rota.',
    } },
  vector: { desc: 'Ilustração vetorial limpa, com animações suaves e tipografia legível.', visual: 'Ilustração vetorial nítida, formas geométricas, paleta harmoniosa e limitada, sombras planas sutis, tipografia grande.', pace: 'Cenas de 4–7 s, easing suave, revelação sincronizada com a palavra falada.', voice: 'Narração calma, didática e clara.', scenes: 'Predominância de "code"; "mixed" quando houver foto ou vídeo real do tema.', thumb: 'Ilustração vetorial central, 3 cores e título de até 3 palavras.', mixed: true },
  paper_cut: { desc: 'Recorte de papel em camadas, com sombras e textura.', visual: 'Cenas de recorte de papel em camadas com sombras suaves, textura de papel, movimentos tipo stop-motion.', pace: 'Cenas de 4–7 s, movimentos levemente "picotados" (12 fps).', voice: 'Narração acolhedora, tom de contador de histórias.', scenes: '"code" com camadas de papel e paralaxe; "mixed" para fotos recortadas.', thumb: 'Cena de papel em camadas, cores quentes e título em recorte.', mixed: true },
  code_3d: { desc: 'Cenas 3D geradas por código (WebGL/Canvas).', visual: 'Cenas 3D por código, materiais simples, iluminação consistente, câmera orbital.', pace: 'Cenas de 4–7 s, câmera em movimento contínuo.', voice: 'Narração técnica, clara e objetiva.', scenes: 'Cenas "code" em WebGL puro ou Canvas 2D com projeção 3D própria (matrizes escritas no próprio HTML, sem bibliotecas externas); geometria leve.', thumb: 'Objeto 3D central com iluminação dramática e título curto.' },
  custom: { desc: 'Sem estilo fixo: você define o roteiro e o visual nos campos de estilo.', visual: 'Estilo livre: siga o "estilo de vídeo" informado no projeto.', pace: 'Ritmo definido pelo roteiro e pelo estilo informado.', voice: 'Tom definido pelo "estilo de roteiro" informado no projeto.', scenes: 'Escolha o tipo de cena mais adequado a cada trecho.', thumb: 'Imagem de impacto coerente com o tema.' },
};

const STOCK = MIXED_STOCK_SOURCES;

function fromType(v: (typeof VIDEO_TYPES)[number]): Skill {
  const cp = COPY[v.id]; if (!cp) throw new Error('skill padrão sem texto para o tipo ' + v.id);
  const mixed = !!cp.mixed;
  const global = `Tipo de vídeo: ${v.label}. Visual: ${cp.visual} Ritmo: ${cp.pace} Voz: ${cp.voice}`;
  /* verticais curtos fecham em loop (shorts); os demais terminam com conclusão */
  const ending: ScriptEnding = cp.ending ?? (v.defaultAspect === '9:16' && v.defaultDurationSec <= 90 ? 'loop' : 'conclusion');
  const cover = v.defaultAspect === '16:9' ? 'thumbnail 16:9' : `capa ${v.defaultAspect}`;
  return {
    id: v.id, name: v.label, builtin: true, description: cp.desc, global,
    appearance: v.id, routeId: v.defaultRoute, aspect: v.defaultAspect, durationSec: v.defaultDurationSec, language: 'pt-BR',
    presentation: mixed ? 'mixed' : 'generated', mediaSources: mixed ? [...STOCK] : [], mixSources: mixed ? (cp.mix ?? ['motion', 'stock']) : undefined,
    scriptEnding: ending, multiVoice: cp.multiVoice || undefined, reviewCriteria: cp.review,
    outputStyle: [
      `🎨 Visual: ${cp.visual}`,
      `⏱ Ritmo: ${cp.pace}`,
      `🎙 ${v.id === 'music_lyric' ? 'Áudio' : 'Narração'}: ${cp.voice}`,
      `🎬 Cenas: ${cp.scenes}`,
      `📦 Saída: final.mp4 (${v.defaultAspect}, ≈ ${v.defaultDurationSec}s) + legendas .srt (se ativadas no projeto/editor) + ${cover} + título/descrição/tags.`,
    ].join('\n'),
    steps: {
      script: `${cp.voice} ${cp.pace}`,
      scene_plan: cp.scenes,
      image: cp.visual, video: cp.visual, code_scene: cp.visual, motion_graphics: cp.visual,
      narration: cp.voice,
      thumbnail: cp.thumb,
      metadata: 'Título até 60 caracteres com a palavra-chave no início; descrição com 2 linhas de gancho, resumo, capítulos e hashtags; 10–15 tags.',
      ...(cp.steps ?? {}),
    },
  };
}

/** Estilo de saída das skills de formato (as 3 originais) — complementa o que elas já definem. */
const BASE_EXTRA: Record<string, Partial<Skill>> = {
  'explicativo-codigo': { appearance: 'vector', routeId: 'explainer-mixed', aspect: '16:9', durationSec: 120, presentation: 'mixed', mediaSources: [...STOCK], mixSources: ['motion', 'stock'],
    outputStyle: '🎨 Visual: animações desenhadas por código, texto grande (≤ 6 palavras), clipes curtos de YouTube (2–4 s) inseridos no motion graphics quando útil; na reserva, imagens/vídeos de Pexels, Pixabay, Wikimedia, Openverse, NASA, Internet Archive, Smithsonian e Unsplash.\n⏱ Ritmo: cenas de 4–8 s, um conceito por cena, revelação sincronizada com a fala.\n🎙 Narração: calma e clara, pausas curtas.\n📦 Saída: final.mp4 (16:9, ≈ 120 s) + legendas (se ativadas no projeto/editor) + thumbnail + metadados SEO.' },
  'shorts-viral': { appearance: 'cartoon_3d', routeId: 'shorts-autopilot', aspect: '9:16', durationSec: 60, presentation: 'generated',
    outputStyle: '🎨 Visual: vertical, legenda grande no centro-inferior.\n⏱ Ritmo: corte a cada 2–4 s; gancho em 3 s; final que emenda com o início (loop).\n🎙 Narração: frases de até 12 palavras.\n📦 Saída: final.mp4 (9:16, 30–60 s) + legendas (se ativadas no projeto/editor) + capa vertical + título curto e ≤ 5 hashtags.' },
  'documentario': { appearance: 'doc_netflix', routeId: 'documentario-3d', aspect: '16:9', durationSec: 300, presentation: 'mixed', mediaSources: [...STOCK], mixSources: ['motion', 'stock', 'ai'],
    outputStyle: '🎨 Visual: B-roll de bancos de mídia + infográficos por código (mapas, linhas do tempo, números) + reconstituições em vídeo IA só onde não há arquivo.\n⏱ Ritmo: três atos, respiros entre revelações.\n🎙 Narração: séria, factual, com fatos e datas verificados.\n📦 Saída: final.mp4 (16:9, ≈ 5 min) + legendas (se ativadas no projeto/editor) + thumbnail + descrição com fontes e créditos.' },
};

/* ── histórias com elenco: bíblia de personagens (aparência + voz), uma voz por personagem ── */
const CAST_BIBLE = 'Bíblia de personagens: 2 a 5 personagens com nomes curtos e fixos (os mesmos do roteiro). Para cada um: aparência que não muda entre cenas (rosto, cabelo, roupa, traço marcante), voz (gênero, idade, timbre, jeito de falar), o que quer, o que esconde e a relação com os outros.';
const castStory = (o: { id: string; name: string; description: string; global: string; script: string; scene: string; visual: string; code: boolean; aspect: '9:16' | '16:9'; durationSec: number; appearance: Skill['appearance'] }): Skill => ({
  id: o.id, name: o.name, builtin: true, multiVoice: true, description: o.description, global: o.global,
  steps: {
    script: o.script,
    bible: CAST_BIBLE + (o.code ? ' Inclua "## Desenho em código": formas e cores em hex de cada personagem, simples o bastante para desenhar em Canvas/SVG e inconfundíveis lado a lado.' : ' A aparência (em inglês) vira referência de rosto e figurino no MiniMax H3: seja específico e visual.'),
    sets: 'Cenários fixos: 2 a 4 locais onde as cenas acontecem, com planta (o que fica onde), época, materiais, cores e luz; objetos recorrentes com forma, material e escala. Descreva em inglês a aparência que não muda e repita os mesmos nomes no visualIntent. Se o vídeo é em código, inclua "## Desenho em código" dos cenários (camadas e cores hex).',
    scene_plan: o.scene,
    ...(o.code
      ? { code_scene: `${o.visual} Desenhe os personagens exatamente como na bíblia (mesmas formas e cores em todas as cenas); quem fala tem boca e gesto animados durante a fala; os outros reagem. Cenário fixo da bíblia para o local da cena.` }
      : {
        image: `${o.visual} Quadro-chave cinematográfico da cena com os personagens da bíblia (mesmo rosto e figurino), sem texto.`,
        video: 'Atuação contida e natural: quem fala move a boca e gesticula pouco, os outros reagem; câmera lenta e estável (push-in suave, contraplano ou plano fixo), sem cortes dentro do clipe e sem mudar rostos ou roupas.',
      }),
    thumbnail: 'Close do personagem principal no momento mais emocional, com título de até 3 palavras.',
  },
  appearance: o.appearance, routeId: o.code ? 'dorama-codigo' : 'dorama-elenco', aspect: o.aspect, durationSec: o.durationSec, language: 'pt-BR',
  presentation: 'generated', mediaSources: [],
  outputStyle: [
    `🎨 Visual: ${o.visual}`,
    `🎭 Elenco: bíblia de personagens (aparência + voz) → elenco montado sozinho, uma voz por personagem (pasta voices ou voz da API).`,
    o.code ? '🎬 Cenas: animadas por código com os personagens desenhados sempre iguais.' : '🎬 Cenas: quadro da cena + vídeo no MiniMax H3 ref2video com os retratos do elenco como referência.',
    `📦 Saída: final.mp4 (${o.aspect}, ≈ ${o.durationSec}s) + legendas (se ativadas no projeto/editor) + capa + metadados.`,
  ].join('\n'),
});

const CAST_STORIES: Skill[] = [
  castStory({ id: 'dorama', name: 'Dorama (elenco + vozes, MiniMax H3 ref2video)', code: false, aspect: '9:16', durationSec: 90, appearance: 'micro_drama',
    description: 'Episódio de dorama/k-drama vertical: romance, segredo e reviravolta; bíblia de personagens, uma voz por personagem e vídeo no MiniMax H3 com os retratos do elenco como referência.',
    global: 'Dorama: emoção contida, olhares, silêncios e uma reviravolta por episódio. Diálogos curtos e naturais; cada fala na voz do próprio personagem. Gancho nos 3 primeiros segundos e cliffhanger no final.',
    script: 'Roteiro de cena: cada fala numa linha "NOME: fala" (2 a 4 personagens, nomes curtos e fixos). Até 2 frases por fala. Indicações de ação entre colchetes numa linha própria. Termine em cliffhanger.',
    scene: 'UMA fala por cena, kind "video"; "speaker" = quem fala; visualIntent em inglês com o local da bíblia, quem está em quadro (pelo NOME), enquadramento (close, plano médio, contraplano) e a emoção; 3 a 8 s por cena.',
    visual: 'Dorama coreano: luz suave e quente, close-ups cinematográficos, profundidade de campo rasa, paleta pastel.' }),
  castStory({ id: 'historia-elenco', name: 'História com personagens (narrador + falas, MiniMax H3)', code: false, aspect: '16:9', durationSec: 180, appearance: 'interactive_story',
    description: 'Conto/história com narrador e diálogos: bíblia de personagens, voz própria para cada um (e para o NARRADOR) e vídeo no MiniMax H3 com o elenco consistente.',
    global: 'História contada: o NARRADOR conduz e os personagens falam nas cenas-chave, cada um com a própria voz. Começo, conflito, virada e desfecho claros.',
    script: 'Cada bloco numa linha "NOME: texto": "NARRADOR: …" para a narração e "Personagem: fala" para os diálogos. 2 a 4 personagens com nomes fixos.',
    scene: 'UMA linha do roteiro por cena, kind "video"; "speaker" = NARRADOR ou o personagem; visualIntent em inglês com o local, os personagens em quadro (pelo NOME), ação e câmera; 4 a 10 s por cena.',
    visual: 'Cinema de animação/ilustrado: luz de cinema, cenários fixos, figurinos consistentes.' }),
  castStory({ id: 'dorama-codigo', name: 'Dorama em código (elenco + vozes)', code: true, aspect: '9:16', durationSec: 90, appearance: 'custom',
    description: 'Dorama animado por código (Canvas/SVG): personagens desenhados sempre iguais pela bíblia, uma voz por personagem.',
    global: 'Dorama: emoção contida, olhares e uma reviravolta por episódio. Diálogos curtos; cada fala na voz do próprio personagem. Cliffhanger no final.',
    script: 'Roteiro de cena: cada fala numa linha "NOME: fala" (2 a 4 personagens, nomes curtos e fixos). Até 2 frases por fala. Termine em cliffhanger.',
    scene: 'Cenas "code" com UMA fala por cena; "speaker" = quem fala; "narration" = só a fala, sem o nome. Para manter o mesmo momento, repita cenário/posição no visualIntent das cenas seguidas; enquadramento e emoção no visualIntent.',
    visual: 'Ilustração 2D flat com paleta pastel de dorama, luz suave, personagens chibi elegantes.' }),
  castStory({ id: 'historia-codigo', name: 'História com personagens em código (narrador + falas)', code: true, aspect: '16:9', durationSec: 180, appearance: 'custom',
    description: 'Conto com narrador e diálogos animado por código: personagens da bíblia desenhados sempre iguais, voz própria para cada um e para o NARRADOR.',
    global: 'História contada: o NARRADOR conduz e os personagens falam nas cenas-chave, cada um com a própria voz. Começo, conflito, virada e desfecho.',
    script: 'Cada bloco numa linha "NOME: texto": "NARRADOR: …" para a narração e "Personagem: fala" para os diálogos. 2 a 4 personagens com nomes fixos.',
    scene: 'Cenas "code" com UMA linha do roteiro por cena; "speaker" = NARRADOR ou o personagem; "narration" = só a fala (sem o nome). Para manter o mesmo momento, repita cenário/posição no visualIntent das cenas seguidas; ação e câmera no visualIntent.',
    visual: 'Livro ilustrado animado: recortes de papel ou flat 2D, paleta quente, cenários fixos da bíblia.' }),
];

/**
 * Curta cartoon 3D: o estilo do github.com/mromidev/claude-animated-shorts (MIT) — personagens 2D chapados com contorno
 * num mundo 3D pintado com contorno preto, céu saturado, desfoque de fundo e câmera deslizando — feito por código em
 * Three.js com a biblioteca local cartoon3d (vendor/cartoon3d). Fórmula de roteiro do STYLE_BIBLE.
 */
const CARTOON_3D_SHORT: Skill = {
  id: 'curta-cartoon-3d', name: 'Curta cartoon 3D (2D em mundo 3D)', builtin: true, codeKit: 'cartoon3d',
  description: 'Curta animado de história real e surpreendente: personagens 2D com contorno num mundo 3D colorido e pintado, contorno a tinta, desfoque de fundo e câmera deslizando — tudo por código (Three.js local), sem IA de imagem ou vídeo.',
  global: 'Você faz um CURTA ANIMADO de uma história verdadeira e surpreendente, com causa e efeito físicos (visual). Narrador único, ritmo rápido (~3,7 palavras/s), quase sem pausas; frases faladas, curtas, com contrações. A piada vem de fatos reais pesquisados. Nunca descreva o que o espectador já vê. Personagens, roteiro e voz são SEMPRE originais.',
  steps: {
    script: 'Fórmula (STYLE_BIBLE): 1) GANCHO = o paradoxo dito como fato na 1ª frase, sem preparação (10–16 palavras); 2) CENÁRIO em 1–2 frases no presente (ano, lugar, um personagem comum com nome, números); 3) ESCALADA em 3–5 batidas, cada uma maior (outros riem/duvidam, falas curtas); 4) uma pergunta de mistério ("Mas por quê…?"); 5) a VIRADA começando com "Veja bem," → o mecanismo real, com uma analogia do dia a dia; 6) desfecho irônico curto na última frase (o vídeo acaba na última palavra). Fatos com a fonte no topo do script.md (linha "FONTES:"). Sem chamada para ação, sem "inscreva-se".',
    scene_plan: 'Todas as cenas "code" (Three.js com cartoon3d), seguindo a regra do app para vídeo em código (cenas de 10 a 19 s). Dentro de cada cena, descreva no visualIntent as 2 a 4 batidas da fórmula que ela cobre (gancho, cenário, escalada, virada, desfecho), cada uma com seu enquadramento: lugar/época concretos, quem está em quadro (roupa e expressão), o adereço que ilustra LITERALMENTE a frase, a luz ("day", "golden", "night" ou "interior") e o movimento de câmera entre elas (deslize, push-in, roll, tranco no impacto). Mesmo cenário e elenco entre cenas seguidas.',
    narration: 'Narrador único, tom firme e constante, rápido e sem pausas longas; ênfase leve nas palavras de impacto.',
    storyboard: 'Storyboard de diretor de animação: cada plano com enquadramento, câmera, luz, quem está em quadro e onde, o letreiro e o adereço da frase, nos tempos reais das palavras. Pense no que a câmera vê: ninguém atrás de objetos ou cortado ao meio, letreiros grandes e de frente, cores de material fixas.',
    code_scene: 'Siga o STORYBOARD da cena (planos, tempos, posições) e o visualIntent com a biblioteca cartoon3d: mundo da época, elenco 2D com expressões fortes, o adereço da frase aparecendo no instante da palavra (TEMPOS DA NARRAÇÃO), câmera deslizando com push-in e desfoque de fundo nos closes.',
    metadata: 'Título curiosidade/paradoxo (até 60 caracteres), descrição com os fatos e as fontes, 8–12 tags.',
  },
  appearance: 'custom', routeId: 'curta-cartoon-3d', aspect: '9:16', durationSec: 60, language: 'pt-BR', presentation: 'generated', mediaSources: [],
  outputStyle: '🎨 Visual: personagens 2D com contorno num mundo 3D pintado (Three.js local, biblioteca cartoon3d): contorno a tinta, céu saturado, desfoque de fundo, câmera deslizando.\n📝 Roteiro: gancho-paradoxo → escalada → "Veja bem," → desfecho irônico.\n🎞 Storyboard: elenco e paleta fixos + planos de cada cena nos tempos da fala, antes do código.\n🔎 Revisão de cena (cada quadro): personagens fora do quadro, bloqueados ou pela metade, letreiros ilegíveis e mudanças bruscas de cor voltam para correção.\n🎙 Narração única e rápida; efeitos e trilha por código.\n📦 Saída: final.mp4 (9:16) + thumbnail + metadados. Estilo de github.com/mromidev/claude-animated-shorts (MIT).',
};

/**
 * Cartoon 3D (vídeos longos, 3 a 10 min): a mesma biblioteca e o mesmo visual do curta (storyboard, revisão de cena,
 * cartoon3d), com estrutura de episódio — abertura, atos com capítulos, cenários recorrentes, elenco fixo que evolui,
 * mais cenas (≈ 1 a cada 10–19 s) e respiros entre os atos para o ritmo não cansar.
 */
const CARTOON_3D_LONG: Skill = {
  id: 'cartoon-3d', name: 'Cartoon 3D (episódio longo, 2D em mundo 3D)', builtin: true, codeKit: 'cartoon3d',
  description: 'Episódio animado de 3 a 10 minutos no visual do curta cartoon 3D: personagens 2D com contorno num mundo 3D pintado, tudo por código (Three.js local). Estrutura em atos com capítulos, cenários recorrentes e elenco fixo, storyboard de todas as cenas e revisão de cada quadro.',
  global: 'Você faz um EPISÓDIO ANIMADO (3 a 10 min) de uma história verdadeira e surpreendente, com causa e efeito físicos (visual). Narrador único, ritmo vivo (~3 palavras/s) com respiros curtos entre os atos; frases faladas e curtas. Os fatos vêm de pesquisa, com fontes. Elenco FIXO e original (nomes, roupas e jeito iguais do começo ao fim) e 3 a 6 CENÁRIOS RECORRENTES que voltam ao longo do episódio — o espectador reconhece os lugares. Nunca descreva o que o espectador já vê.',
  steps: {
    script: 'Estrutura de episódio (cada bloco em uma seção "## Capítulo N — título" no script.md, com "FONTES:" no topo): 0) ABERTURA (15–25 s): o paradoxo dito como fato + a promessa do episódio ("e no fim você vai entender por que…"); 1) CAPÍTULO 1 — CENÁRIO: época, lugar, o protagonista comum com nome, o problema e os números; 2) CAPÍTULO 2 — ESCALADA: 3 a 5 batidas cada vez maiores, com personagens secundários reagindo (falas curtas citadas pelo narrador) e uma mini-virada no fim; 3) CAPÍTULO 3 — COMPLICAÇÃO: o plano que dá errado, a consequência inesperada, uma pergunta de mistério ("Mas por quê…?"); 4) CAPÍTULO 4 — A VIRADA: começa com "Veja bem," → o mecanismo real explicado com 1 ou 2 analogias do dia a dia e um número que surpreende; 5) DESFECHO: o que mudou depois, ironia final em uma frase curta (o vídeo acaba na última palavra). Cada capítulo fecha com um gancho para o próximo. Sem "inscreva-se".',
    scene_plan: 'Todas as cenas "code" (Three.js com cartoon3d), na regra do app para vídeo em código (cenas de 10 a 19 s): um episódio de 5 min tem ≈ 20 cenas. Comece o "title" de cada cena com o capítulo ("Cap. 2 — …"). Na 1ª cena de cada capítulo, a abertura do capítulo: plano geral do cenário recorrente + letreiro grande com o nome do capítulo (até 3 palavras). Reutilize os MESMOS cenários (nomeie-os igual: "a rua do bar", "o escritório do delegado"…) e o MESMO elenco, citando os nomes no visualIntent. Em cada cena, descreva as 2 a 4 batidas que ela cobre, cada uma com enquadramento (geral, médio, close), quem está em quadro (roupa e expressão), o adereço que ilustra LITERALMENTE a frase, a luz ("day", "golden", "night", "interior") e o movimento de câmera (deslize, push-in, roll, tranco). Varie: não repita o mesmo enquadramento em cenas seguidas; alterne cenários a cada 2–4 cenas.',
    narration: 'Narrador único, tom firme e envolvente de contador de histórias; ritmo vivo, pausa curta (0,3 s) entre os capítulos; ênfase leve nas palavras de impacto e nos números.',
    storyboard: 'Storyboard de diretor de animação para o EPISÓDIO inteiro: elenco fixo (roupas reais da biblioteca, cada personagem inconfundível), paleta de materiais fixa e uma lista de CENÁRIOS RECORRENTES (nome, construção com a API, luz) usados pelas cenas. Depois, cada plano de cada cena nos tempos reais das palavras. Continuidade: quem sai por um lado entra pelo mesmo lado na cena seguinte; mesmo cenário = mesma posição das casas, adereços e cores. Ninguém atrás de objetos ou cortado ao meio, letreiros grandes e de frente.',
    code_scene: 'Siga o STORYBOARD da cena (planos, tempos, posições) e o visualIntent com a biblioteca cartoon3d: monte o cenário recorrente exatamente como no storyboard, elenco 2D com as mesmas roupas e expressões fortes, o adereço da frase aparecendo no instante da palavra (TEMPOS DA NARRAÇÃO), câmera deslizando com push-in e desfoque de fundo nos closes. Na abertura de capítulo, o letreiro do capítulo entra com um push-in lento.',
    metadata: 'Título curiosidade/paradoxo (até 60 caracteres); descrição com o resumo em 2 linhas, os CAPÍTULOS com os tempos (00:00 Abertura, … um por capítulo do roteiro), os fatos e as fontes; 10–15 tags.',
  },
  appearance: 'custom', routeId: 'cartoon-3d', aspect: '16:9', durationSec: 300, language: 'pt-BR', presentation: 'generated', mediaSources: [],
  outputStyle: '🎨 Visual: o do curta cartoon 3D (personagens 2D com contorno num mundo 3D pintado, Three.js local), em 16:9.\n📚 Episódio de 3 a 10 min: abertura + 4 capítulos (cenário, escalada, complicação, virada "Veja bem,") + desfecho irônico.\n🏘 3 a 6 cenários recorrentes e elenco fixo do começo ao fim; abertura de cada capítulo com letreiro.\n🎞 Storyboard do episódio inteiro antes do código; revisão de cada quadro (bloqueados, pela metade, letreiros, cores).\n🎙 Narração única; efeitos e trilha por código.\n📦 Saída: final.mp4 + thumbnail + título, descrição com capítulos e tags (pasta "publicar").',
};

/**
 * Evolução do "Vídeo explicativo com código": com um link na ideia, o app abre a página no navegador invisível, grava a
 * rolagem e lê o conteúdo (webcapture.ts); o roteiro explica a página e as cenas mostram trechos dela com motion graphics.
 */
const LINK_EXPLAINER: Skill = {
  id: 'explicativo-link', name: 'Vídeo explicativo de link (navegador + motion graphics)', builtin: true, linkCapture: true, scriptEnding: 'conclusion',
  description: 'Cole um ou vários links na ideia: o app abre cada página no navegador, grava um vídeo dela rolando, lê e analisa o conteúdo, escreve a narração e monta motion graphics por código com trechos da página destacados. Com vários links, o vídeo explica um de cada vez, na ordem, e fecha comparando/relacionando. Sem link, vira um explicativo por código normal.',
  global: 'Vídeo explicativo SOBRE UM OU VÁRIOS LINKS. A página capturada (web/pagina.md + web/pagina.mp4; com vários links, web/links.md lista cada um e a captura fica em web/l1, web/l2…) é a fonte da verdade: explique o que ela é, para quem serve e os pontos principais, com os nomes, números e termos exatos dela; não invente nada que não esteja lá. O espectador VÊ a página: mostre o trecho certo no instante em que ele é falado e destaque-o com motion graphics. Texto na tela curto (até 5 palavras), sempre legível.',
  steps: {
    script: 'Com VÁRIOS links (existe web/links.md): leia o índice e cada web/lN/pagina.md; gancho que une os links (o que têm em comum ou por que ver todos); um bloco por link NA ORDEM do índice, cada um com o nome exato, o que é e 2 a 3 pontos concretos tirados da página dele, com uma frase de transição clara ("agora, o segundo link…"); fechamento comparando/relacionando os links e dizendo que estão na descrição. Com UM link: leia web/pagina.md (conteúdo do link). Estrutura: 1) gancho com o benefício/novidade principal da página (até 14 palavras); 2) o que é e de quem é (nome exato do site/produto); 3) os 3 a 5 pontos principais NA ORDEM em que aparecem na página, cada um com um detalhe concreto (número, recurso, preço, data) tirado do texto; 4) para quem serve / como usar; 5) fechamento com o link ("o link está na descrição"). Tom conversacional, frases curtas. Sem link: explicativo didático normal sobre a ideia.',
    scene_plan: 'Pelo menos metade das cenas mostram a PÁGINA: kind "code" com "userMedia": "web/pagina.mp4", "clipStart" = instante da seção falada (lista em web/pagina.md) e "durationSec" de 4 a 8; visualIntent diz o que destacar (qual título, botão, número ou imagem da página) e como (círculo, sublinhado, zoom, seta, rótulo). Comece pelo topo da página (clipStart 0). Entre elas, cenas "motion" de motion graphics puro para o gancho, números grandes, comparações e o resumo final em 3 passos. Prints web/*.png podem ser usados como "userMedia" de cenas "code" paradas (com zoom lento).',
    code_scene: 'Motion graphics sobre a captura: a página aparece numa MOLDURA DE NAVEGADOR (barra com os 3 pontos e a URL do link, cantos arredondados, sombra suave) ocupando 70–85% do quadro sobre um fundo com gradiente da paleta; o vídeo da captura toca mudo a partir do clipStart da cena (video.currentTime = clipStart + t, espere "seeked" antes de desenhar). No instante da palavra (TEMPOS DA NARRAÇÃO): retângulo ou círculo desenhado marcando a área citada, zoom suave da moldura (escala 1 → 1,25) em direção ao ponto, rótulo de até 5 palavras e seta animada; nada cobre o ponto destacado. Easing suave, sem texto corrido.',
    motion_graphics: 'Tipografia cinética e gráficos limpos com a paleta da página (cores do site): números que crescem, ícones simples, listas em 3 passos; texto curto (até 5 palavras por bloco), sincronizado com a fala.',
    narration: 'Voz clara, confiante e amigável de apresentador de tecnologia; ritmo médio, pausas curtas entre os pontos.',
    thumbnail: 'Print do topo da página (web/pagina-topo.png) numa moldura de navegador inclinada, com 3 palavras grandes do benefício principal.',
    metadata: 'Título até 60 caracteres com o nome do site/produto e o benefício; descrição com o LINK na primeira linha (vários links: todos, um por linha, na ordem do vídeo), capítulos com um capítulo por link (tempo do início do bloco de cada link) além da abertura e do fechamento, resumo em 2 linhas, capítulos e hashtags; 10–15 tags.',
  },
  appearance: 'motion_graphics', routeId: 'explicativo-link', aspect: '16:9', durationSec: 90, language: 'pt-BR', presentation: 'mixed', mediaSources: [], mixSources: ['motion'],
  outputStyle: '🌐 Entrada: um ou vários links na ideia (ex.: "explique https://site.com/produto" ou "compare https://a.com e https://b.com") — até 20 links, explicados na ordem (com muitos links, cada página é lida e gravada de forma mais curta). Vídeos que tocam na página viram trechos curtos.\n🎥 Captura: o app abre a página num navegador invisível (sem os seus logins), grava a página rolando com paradas em cada seção e tira prints.\n🧠 Análise: o roteiro sai do conteúdo da página (títulos, seções e texto).\n🎨 Visual: motion graphics por código com trechos da página numa moldura de navegador, destaques, zoom e setas no instante da fala.\n📦 Saída: final.mp4 (16:9, ≈ 90 s) + legendas (se ativadas no projeto/editor) + thumbnail (print da página) + metadados com o link.',
};

/** Skills especiais: vídeo livre (vazia) e o misto motion + bancos + vídeo IA. */
const MUSIC_VIDEO_PASTA: Skill = {
  id: 'clipe-musical-pasta', name: 'Clipe musical com a sua pasta (fotos e vídeos, cortes de 3–5 s)', builtin: true, musicVideo: true,
  description: 'Videoclipe montado com as fotos e os vídeos de uma pasta: cada corte dura 3 a 5 s e entra no ritmo da música. Sem narração.',
  global: 'Você monta um VIDEOCLIPE, não uma narração. A música manda no ritmo; as fotos e os vídeos escolhidos pelo usuário são o visual. Nada de fala: a trilha é a única voz.',
  steps: {
    script: 'Grave `script.md` com um plano visual curto: clima, paleta, ordem dos arquivos e como cada corte conversa com a música. NÃO escreva narração falada.',
    scene_plan: 'Monte o videoclipe com os arquivos da pasta do usuário: UMA cena por corte, de 3 a 5 s, sem narração. Para VÍDEO: "kind":"video", "userMedia" com o nome exato, "clipStart" no segundo inicial do trecho, "manualDuration": true e "durationSec" 3–5. Para FOTO: "kind":"image", "userMedia" com o nome exato e "durationSec" 3–5. Use cada arquivo pelo menos uma vez e repita em ciclo quando faltar duração para fechar a música. Os cortes de um mesmo vídeo são contíguos (o próximo clipStart = fim do anterior) e não precisam esgotar o arquivo (ignore o resto se sobrarem menos de 3 s).',
    image: 'Foto do usuário (a cena usa o arquivo; não gere outra imagem).',
    video: 'Trecho do vídeo do usuário (3 a 5 s; a cena usa o arquivo; não gere outro vídeo).',
    thumbnail: 'O corte de maior impacto, com o nome da música em até 3 palavras.',
  },
  appearance: 'custom', routeId: 'clipe-musical-pasta', aspect: '16:9', durationSec: 60, language: 'pt-BR', presentation: 'mixed', mediaSources: [], mixSources: [],
  outputStyle: '🎬 Visual: fotos e vídeos da pasta do usuário, cortes de 3 a 5 s no ritmo da música.\n🎵 Música: o arquivo de áudio anexado ou gerada pela rota.\n🔇 Sem narração e sem texto falado.\n📤 Saída: final.mp4 com a trilha do projeto.',
};

const MUSIC_VIDEO_BANCO: Skill = {
  id: 'clipe-musical-banco', name: 'Clipe musical com banco de mídia (cortes de 3–5 s)', builtin: true, musicVideo: true,
  description: 'Videoclipe com imagens e vídeos de bancos de mídia: cada corte dura 3 a 5 s, escolhido pelos termos de busca, no ritmo da música. Sem narração.',
  global: 'Você monta um VIDEOCLIPE, não uma narração. A música manda no ritmo; os bancos de mídia (Pexels, Pixabay, Wikimedia, NASA, Internet Archive e YouTube) trazem o visual. Nada de fala.',
  steps: {
    script: 'Grave `script.md` com o conceito visual: clima, paleta e a sequência de imagens que a música pede. NÃO escreva narração falada.',
    scene_plan: 'Monte o videoclipe em cortes de 3 a 5 s, sem narração: cada cena tem "kind":"stock", "durationSec" 3–5 e "searchTerms" com 2–4 palavras EM INGLÊS descrevendo exatamente o plano (o banco é consultado por tema). Varie os planos (geral, detalhe, movimento) e cubra a duração da música.',
    stock_media: 'Escolha o trecho/imagem do banco que corresponde aos searchTerms da cena (3 a 5 s).',
    thumbnail: 'O quadro de maior impacto, com o nome da música em até 3 palavras.',
  },
  appearance: 'motion_graphics', routeId: 'clipe-musical-banco', aspect: '16:9', durationSec: 60, language: 'pt-BR', presentation: 'mixed', mediaSources: STOCK, mixSources: ['stock'],
  outputStyle: '🎬 Visual: imagens e vídeos de bancos de mídia, cortes de 3 a 5 s no ritmo da música.\n🎵 Música: gerada pela rota ou o áudio anexado.\n🔇 Sem narração.\n📤 Saída: final.mp4 com a trilha do projeto.',
};

/** UGC de produto: um especialista de marketing roteiriza; criador da biblioteca + fotos do produto como referência. */
const UGC_PRODUTO: Skill = {
  id: 'ugc-produto', name: 'UGC de produto (especialista de marketing)', builtin: true, scriptEnding: 'conclusion', multiVoice: true,
  description: 'Vídeo UGC de 30 a 40 s que vende um produto como um criador real: gancho, dor, demonstração, prova e chamada para ação. O criador é um personagem da biblioteca (mesmo rosto e voz) e o produto vem das fotos de referência anexadas ao projeto.',
  global: 'Você é um ESPECIALISTA EM MARKETING DE PERFORMANCE e diretor de UGC (user-generated content). O vídeo parece gravado por um criador real no celular — autêntico, próximo, nada de comercial de TV — e existe para VENDER o produto das fotos de referência. ' +
    'Estrutura obrigatória (30–40 s): 1) GANCHO em até 3 s (frase que para a rolagem: pergunta, contraste ou resultado surpreendente); 2) DOR/CONTEXTO (o problema do público, em uma frase); 3) DEMONSTRAÇÃO (o produto em uso, mostrando 2–3 benefícios concretos e visíveis); 4) PROVA (resultado, antes × depois, número ou reação sincera); 5) CTA claro e curto (o que fazer agora). ' +
    'Fale na primeira pessoa, frases curtas, vocabulário do dia a dia, sem jargão nem promessas impossíveis (nada de "cura", "garantido", "100%"). O PRODUTO é sempre o das fotos de referência: mesma forma, cor, rótulo e embalagem — nunca invente outro modelo nem outra marca.',
  steps: {
    script: 'Escreva em falas no formato "NOME: fala", com UM criador (personagem da biblioteca, se houver; senão crie um criador com nome curto). A voz do criador fala cerca de 3 palavras por segundo: escreva 105 a 125 palavras no total para 35–40 s (nunca menos de 100), em 9 a 12 falas de 8 a 14 palavras cada (o gancho pode ser mais curto). Marque as seções com comentários curtos em linhas próprias: [GANCHO], [DOR], [DEMO], [PROVA], [CTA]. O nome do produto aparece pelo menos 2 vezes; o CTA fecha o vídeo.',
    asset_design: 'Na seção "## Personagens fixos", mantenha EXATAMENTE o criador da biblioteca (mesmo nome e aparência); acrescente roupa casual de criador de conteúdo. Em "## Objetos fixos", descreva o PRODUTO como está nas fotos de referência (forma, cores, rótulo, tamanho na mão). Cenário: um lugar real e simples (cozinha, quarto, academia, carro, banheiro) coerente com o uso do produto.',
    scene_plan: 'Cenas de 3 a 5 s (UMA fala por cena, "speaker" = criador), todas "kind":"video". Alterne: (a) criador falando para a câmera segurando/usando o produto (selfie vertical, luz natural); (b) PLANO DE PRODUTO: close do produto em uso — nestas cenas preencha "userMedia" com o nome EXATO da foto de referência do produto, para o quadro ser a própria foto (o produto sai idêntico) e o vídeo só animar a câmera e a mão; (c) prova/resultado. Pelo menos 2 cenas de produto. visualIntent em inglês citando o criador PELO NOME e o produto pelo nome (nas cenas de comparação, o outro objeto é "a plain unbranded ...", sem o nome do produto), com enquadramento de celular (handheld, eye level, close-up). A última cena é o CTA com o produto bem visível.',
    image: 'Foto vertical de celular, luz natural, aparência real (não publicitária): o criador da biblioteca com o produto das fotos de referência na mão ou em uso; produto nítido e reconhecível, rótulo virado para a câmera; sem texto na imagem. Objeto de comparação (garrafa comum, produto antigo, concorrente) é genérico, SEM marca nem rótulo: o nome do produto só aparece no produto das fotos.',
    video: 'Movimento de celular na mão (leve tremor), criador falando para a câmera com naturalidade; o produto continua idêntico à foto (mesma forma, cor e rótulo) e sempre visível; sem texto, sem logotipos inventados.',
    narration: 'Voz do criador: natural, animada sem exagero, como quem conta uma descoberta para um amigo; ritmo rápido no gancho e mais calmo na demonstração.',
    thumbnail: 'Criador surpreso segurando o produto perto do rosto, produto bem nítido, 2–3 palavras grandes com o benefício principal.',
    metadata: 'Título com o benefício + nome do produto (até 60 caracteres); descrição com o problema, 3 benefícios em tópicos, o CTA e 5 hashtags; deixe claro que é um vídeo de demonstração do produto.',
  },
  reviewCriteria: 'Gancho nos 3 primeiros segundos; produto idêntico às fotos de referência em todas as cenas; criador com o mesmo rosto e voz; benefícios concretos e verdadeiros; CTA no final; 30–40 s.',
  appearance: 'ad_product', routeId: 'ugc-produto', aspect: '9:16', durationSec: 35, language: 'pt-BR', presentation: 'generated', mediaSources: [],
  outputStyle: '🎬 Visual: criador da biblioteca falando para a câmera + closes do produto (a foto de referência vira o quadro).\n🧠 Roteiro de especialista de marketing: gancho → dor → demo → prova → CTA.\n🎞 Vídeo: MiniMax H3 (Wan2GP, 4 passos) com criador + produto; reserva Snapgen Muse AI / MiniMax.\n🗣 Voz fixa do criador (OmniVoice/elenco).\n📐 Vertical 9:16, 30–40 s.',
};

/** Música com lipsync: o DIRETOR DE VIDEOCLIPE ouve a música (transcrição) ou compõe a canção, e o cantor da
 *  biblioteca canta em lipsync. Planos de até 10 s (SnapGen Muse / MiniMax H3 / LTX 2.3). */
const MUSICA_LIPSYNC: Skill = {
  id: 'musica-lipsync', name: 'Clipe musical com lipsync (cantor da biblioteca)', builtin: true, multiVoice: true,
  description: 'Videoclipe da música inteira: com música anexada (arquivo ou pasta) o app OUVE a faixa — transcreve letra e tempos — e o diretor monta o clipe em cima dela; sem música, a canção é composta no ACE-Step 1.5 XL. O cantor da biblioteca canta em lipsync e cada plano tem até 10 s (SnapGen Muse, MiniMax H3 no Wan2GP/ComfyUI ou LTX 2.3).',
  global: 'Você é o DIRETOR DE VIDEOCLIPE da canção. Regras: (1) a MÚSICA é o roteiro — quando o projeto traz uma música (arquivo, pasta ou gerada), use a LETRA e os TEMPOS REAIS que o app transcreveu (`out/music.words.json` / `out/lyrics-timing.json`); nunca invente outra letra; (2) o CANTOR é o personagem da biblioteca escolhido no projeto (mesmo rosto, roupa e voz em todas as cenas) e canta PARA A CÂMERA nos trechos com voz; (3) os planos duram no máximo 10 s (limite de cada clipe do SnapGen Muse) e começam no tempo do verso; (4) o clipe é montado na música inteira, do primeiro ao último segundo, com a canção em volume cheio, sem narração; (5) a letra vira legenda e o refrão é o ponto mais intenso (luz, cor, movimento).',
  steps: {
    script: 'O app transcreve a música anexada (ou a pasta: usa a faixa principal) e grava a letra com tempos em `out/music.words.json`. Grave `script.md` com: 1) `TITLE:` (o nome da faixa, se houver; senão o título que você criar); 2) `SINGER:` (o cantor da biblioteca); 3) `STYLE:` em inglês (gênero, instrumentos, BPM e tipo de voz — se a música já existe, DESCREVA o que você ouviu na transcrição, não invente outro estilo); 4) `LYRICS:` a letra REAL transcrita, um verso por linha, com [verse]/[chorus]/[bridge] — se a transcrição estiver vazia ou instrumental, escreva `[Instrumental]` e descreva as seções pela energia; 5) `VISUAL:` conceito do clipe em 2–3 cenários, paleta, luz e arco emocional ligado à letra. Sem música anexada: componha a letra curta e cantável (verso/refrão) e o app gera a canção no ACE-Step.',
    asset_design: 'Em "## Personagens fixos", use EXATAMENTE o cantor da biblioteca (mesmo nome e aparência) com o figurino do clipe; em "## Cenários", 2 a 3 locais do VISUAL (palco, rua à noite, estúdio, campo…), com luz e paleta coerentes com a letra.',
    scene_plan: 'Use a duração real da música e a transcrição com tempos. Crie UMA cena por frase musical (ou por verso curto), de 4 a 10 s — NUNCA mais de 10 s por cena (cada clipe do SnapGen Muse tem 10 s) —, na ordem da canção, todas "kind":"video". `narration` = o trecho EXATO da letra naquele intervalo (separado por " / "); `speaker` = o cantor quando há voz; intro/instrumental sem `speaker` (silêncio de voz, só música). `durationSec` = o tempo real do trecho. visualIntent em inglês: o cantor PELO NOME cantando para a câmera em plano médio ou close (rosto e boca bem visíveis), o cenário e a luz; varie o enquadramento e a intensidade (refrão mais forte). A soma das cenas = duração da música.',
    image: 'Quadro de videoclipe: o cantor da biblioteca idêntico à folha de personagem, de frente para a câmera, boca visível, luz cinematográfica, sem texto e sem microfone cobrindo a boca.',
    video: 'O cantor canta este trecho com os lábios sincronizados à voz, expressão coerente com a letra; câmera lenta, nada passa na frente do rosto. Se a cena for instrumental, o cantor performa (olha a câmera, anda, sente a música) sem mexer a boca em fala.',
    thumbnail: 'Close do cantor cantando com luz forte e o título da música em até 3 palavras.',
    metadata: 'Título com o nome da música e o clima; descrição com a letra completa e créditos (música: do projeto ou gerada por IA); 5–10 tags de gênero.',
  },
  reviewCriteria: 'Cada plano começa no tempo do verso e tem no máximo 10 s; a boca do cantor acompanha a voz; o mesmo rosto em todas as cenas; a letra da legenda é a da música; canção em volume cheio, sem narração; a marca d\'água do projeto aparece quando estiver ligada.',
  /* esta skill SEMPRE entrega o storyboard do plano em imagem na pasta do projeto (out/storyboard.png) */
  storyboard: true,
  appearance: 'music_lyric', routeId: 'musica-lipsync', aspect: '16:9', durationSec: 60, language: 'pt-BR', presentation: 'generated', mediaSources: [],
  outputStyle: '🎵 Música do projeto (ouvida e transcrita: letra + tempos) ou canção nova no ACE-Step 1.5 XL.\n🎤 Cantor da biblioteca cantando em lipsync (MiniMax H3 Ref2VA no Wan2GP/ComfyUI; fallback LTX 2.3).\n🎬 Planos de até 10 s (SnapGen Muse) começando no tempo de cada verso, na música inteira.\n🔇 Sem narração; letra como legenda; canção em volume cheio.\n🖋️ Marca d\'água/texto do projeto aplicada no final.',
};

/** Cartoon Short Studio: manual operacional (pauta com score, 5 beats, 3,7 palavras/s, twist final). */
const CARTOON_SHORT_STUDIO: Skill = {
  id: 'cartoon-short-studio', name: 'Cartoon Short Studio (story-driven)', builtin: true,
  description: 'Short animado story-driven: personagem-cartão (cabeça de feijão) num mundo 3D pintado, narração única e twist de ironia no último segundo. Pauta pontuada, banco de hooks, plano de ritmo e QA por métrica (9:16, 30 fps).',
  global: 'Regra zero: a spec abaixo é a fonte da verdade — números, proporções, timing e áudio não mudam se o motor mudar. Gate de pauta (5 filtros, falhar 1 = descartar): causa física visível, everyman sem nome de pessoa viva, escada de stakes, twist de ironia no fim, cenário construível. Score 0–2 em hook/twist/potencial visual/verificabilidade/novidade: CORTA EM <7. Veto: pessoa viva como alvo de piada, mascote/logo de marca, gore, sofrimento infantil, política partidária, recrear shot a shot. Selo de veracidade DOCUMENTADO/DISPUTADO/LENDA — se LENDA, a narração diz "dizem que". Narração a 3,7 palavras/segundo (30 s = 110 palavras, 10–13 planos), frases de 8–15 palavras, português falado, números por extenso, nunca descreva o que já está na tela. Nunca misture render de código com geração IA dentro do mesmo plano.',
  steps: {
    script: 'Escreva `script.md` com: 1) PAUTA com o score dos 5 critérios e o selo de veracidade; 2) HOOK como primeira frase, fato absurdo dito como fato (nunca "nesse vídeo eu vou te contar"); 3) CHÃO (quando/onde/quem + um detalhe concreto); 4) ESCALADA com 2–4 beats crescentes e exatamente UMA piada de exagero; 5) MECANISMO ("mas quando…" / "o detalhe é que…") com a causa física por analogia do dia a dia; 6) PAYOFF de uma frase — as ÚLTIMAS palavras são o twist, sem CTA falado (mata a releitura). Respeite 3,7 palavras/s e as palavras da tabela de duração.',
    asset_design: 'Personagem-cartão fixo (cabeça de feijão), com aparência idêntica em todos os planos; cenário construível (cidade, ponte, navio, castelo, deserto, mina, laboratório, cozinha). Evite multidão, esporte e interface de tela.',
    scene_plan: 'Um plano por frase (ou plano dividido em 2 inserts). 30 s = 10–13 planos de 2–4 s; tempo em QUADROS a 30 fps. Cada plano diz o que muda na tela e o beat (hook/chão/escalada/mecanismo/payoff). O último plano termina no twist.',
    code_scene: 'Cartoon 3D com contorno a tinta, mundo pintado, câmera viva e sem descrição visual redundante na narração. Um plano = 100% engine ou 100% gerado, nunca misturado. Último segundo = virada visual.',
    narration: 'Narrador profundo, PT-BR, 3,7 palavras/s, ritmo de história, sem CTA final.',
    music: 'Trilha discreta sob a voz, com queda/no intervalo no mecanismo e um ponto no payoff.',
    edit: 'Corte no quadro da frase, não no meio; sem "obrigado por assistir"; o vídeo acaba no twist e volta ao começo para incentivar releitura.',
  },
  reviewCriteria: 'Pauta com score ≥7 e selo; hook na frase 1; twist nas últimas palavras; 3,7 palavras/s; um plano por frase; sem CTA falado; personagem idêntico em todos os planos; áudio abaixo da voz; revisão por métrica (corte, retenção, clareza do twist).',
  appearance: 'cartoon_3d', routeId: 'curta-cartoon-3d', aspect: '9:16', durationSec: 30, language: 'pt-BR', presentation: 'generated', mediaSources: [],
  outputStyle: '🎬 Cartoon short 9:16, 30 fps, 30 s (110 palavras, 10–13 planos).\n📐 Pauta pontuada (≥7) + selo de veracidade + 5 beats.\n🎤 Narração única a 3,7 palavras/s; twist irônico nas últimas palavras; sem CTA falado.\n🎨 Personagem-cartão num mundo 3D pintado, um plano por frase.\n📤 Saída: final.mp4 + legendas (se ativadas no projeto/editor) + thumbnail + metadados.',
};

/** Cartoon-to-Real: sem narração, motor é a música + piada visual, 16:9, lineup de 4–8 pares. */
const CARTOON_TO_REAL: Skill = {
  id: 'cartoon-to-real-crossover', name: 'Cartoon-to-Real (crossover)', builtin: true,
  description: 'Personagem 2D clássico lado a lado com sua versão live-action fotorrealista no set de filmagem: cumprimento, pose e selfie final. Sem narração — música + piada visual; gate de IP obrigatório, 4–8 pares, 16:9.',
  global: 'Este formato NÃO tem narração: o motor é a música + a piada visual; quem escreve roteiro escreve QUADROS, não frases. IP semaphore obrigatório antes de qualquer prompt: VERDE = domínio público por obra e país ( Mickey 1928, Popeye, Tintin — ainda protegido na UE até 2054; Drácula, Frankenstein, Nosferatu); ÂMBAR = IP de 80/90 (fan-concept declarado, sem merch/endosso/logos, esperar claim); VERMELHO = trailers oficiais, designs modernos, pessoa viva sem autorização, shot-a-shot. Regra de ouro: personagem ORIGINAL desenhado no estilo anos 80 — controle total, zero risco. Gate do duplo: reconhecível em 120 px, contraste físico, gesto de encontro, quadro de screenshot. Score 0–2 em reconhecimento/contraste/gesto/screenshot/novidade: CORTA EM <7. Nunca vendas, nunca use logo/trade dress, nunca recomende o IP como marca do canal.',
  steps: {
    script: 'Escreva `script.md` com: 1) semáforo de IP do personagem escolhido e justificativa; 2) score do duplo (≥7); 3) LINEUP de 4–8 pares em ordem dramática (herói → sidekick → cômico → vilão); o vilão entra por último com queda de música; um único cameo de ator no meio; 4) um GESTO diferente por par (aperto, high five, abraço, autógrafo, selfie) — repetir o mesmo gesto mata o vídeo; 5) beat sheet de 90 s (0–3 hook com o par principal já em quadro = frame da thumb; 3–8 revelação do set; 8–20 lineup; 20–32 interação; 32–42 cameo; 42–58 vilão; 58–70 irmandade dos vilões; 70–90 selfie final). Nada de narração, nada de explicação.',
    asset_design: 'Cada par: personagem 2D original no estilo da época + ator live-action fotorrealista. Figurino e paleta fixos. Set de filmagem com green screen, luzes e equipe. Nenhum logo oficial.',
    scene_plan: 'Um quadro por beat, 3–5 s por plano (música manda). 90 s ≈ 22–28 planos. O frame de abertura é o da thumbnail. Nunca Morph/I2V na variante antes/depois: corte seco.',
    image: 'Still do par lado a lado no set, contraste chapado 2D × pele com poros, composição legível em 120 px. O selfie final é o quadro de screenshot.',
    video: 'I2V com keyframes só para os gestos de contato (aperto de mão, high five, selfie). Cada corte no beat da música. Sem路人, sem texto na imagem.',
    edit: 'Música licenciada em volume cheio, sem voz, cortes no beat, 90 s. Marca "Made with AI"/selo de IA e disclosure contínuo.',
    metadata: 'Título no formato "WHAT IF X WAS REAL?" (ou equivalente PT), descrição com fan-concept declarado e sem sugestão de endosso; selo de IA; 5–10 tags. Sem capítulos públicos neste formato.',
    thumbnail: 'O par principal já em quadro no set, selfie/cumprimento, legível em 120 px.',
  },
  reviewCriteria: 'Sem narração; 4–8 pares; gesto diferente por par; vilão por último; contraste 2D/live-action; quadro de abertura = thumbnail; selo de IA e disclosure; nenhum IP vermelho ou logo oficial.',
  appearance: 'custom', routeId: 'shorts-autopilot', aspect: '16:9', durationSec: 90, language: 'pt-BR', presentation: 'generated', mediaSources: [],
  musicVideo: true,
  outputStyle: '🎬 Crossover cartoon → live-action, 16:9, 90 s, sem narração.\n🎵 Música licenciada em volume cheio; cortes no beat; 4–8 pares com gestos de encontro diferentes.\n🚦 Gate de IP (verde/âmbar/vermelho) + score do duplo ≥7 antes de gerar.\n📸 Abertura = frame da thumb; selfie final = quadro de screenshot.\n📤 Saída: final.mp4 + thumbnail + metadados com selo de IA e disclosure.',
};

/* SKILLS REGISTRADAS DO CATÁLOGO (págs. 135-149): são padrão do app, com rota própria quando o catálogo exige. */

/** Podcast 16:9 — PiP do vídeo original + imagens do Google Flow baseadas no que é falado, com editor completo. */
const PODCAST_16_9: Skill = {
  id: 'podcast-16-9', name: 'Podcast 16:9 (imagens do falado + PiP)', builtin: true,
  description: 'Entrada: link real de vídeo + minuto inicial/final + canto do PiP (padrão: inferior esquerdo). O app baixa o trecho com yt-dlp/ffmpeg e usa o vídeo original em PiP com zoom lento sobre imagens geradas no Google Flow a cada 6-12 s, baseadas no que é falado. Em momentos interessantes o vídeo vai a TELA CHEIA por 10-25 s, sem zoom, e volta ao PiP. Trilha de suspense baixa sob a voz original. 16:9, menos de 1 minuto.',
  global: 'Entrada OBRIGATÓRIA: link de um vídeo real + minuto inicial + minuto final + canto do PiP no campo ideia (ex.: `https://www.youtube.com/watch?v=ID 46:04 - 58:11, canto inferior esquerdo`). 1) BAIXE o trecho com yt-dlp/ffmpeg e salve em `web/podcast.mp4` — esse é o vídeo original usado em PiP, nunca substitua por material gerado. 2) Transcreva a fala do trecho para dividir em blocos de 6 a 12 segundos. Cada bloco tem UMA frase e UMA imagem. 3) A imagem é gerada no Google Flow e retrata EXATAMENTE o ASSUNTO do que é falado: o objeto, o tema, o lugar, o evento ou a ideia citada na frase — NUNCA o apresentador/Daniel Mastral, que aparece apenas na PiP do vídeo original. Por exemplo: se fala de um documento antigo, mostre o documento; se fala de uma data, mostre o que aconteceu; se fala de uma pessoa citada, mostre essa pessoa, não quem narra. Sem texto escrito na imagem. 4) O vídeo original aparece em PiP de ~25% da largura NO CANTO PEDIDO (padrão: inferior esquerdo), com quadro FIXO e sem zoom, sem cobrir rosto/legendas. A IMAGEM DE FUNDO gerada no Flow recebe o ZOOM LENTO (Ken Burns suave, scale 1.0 → 1.08) durante cada bloco. 5) EM 1 A 2 MOMENTOS INTERESSANTES (revelação, confronto, dado surpreendente), o vídeo original OCUPA A TELA CHEIA por 10 a 25 SEGUNDOS, SEM ZOOM (quadro fixo), e depois volta ao PiP com transição suave — no máximo 2 vezes e nunca mais de 50% do vídeo. 6) Trilha sonora de SUSPENSE BAIXA (-20 a -24 LUFS, 5-8% sob a voz original) durante todo o vídeo. Crédito ao canal e link original SEMPRE na descrição. Sem narração adicional: a voz é a do trecho original.',
  steps: {
    script: 'Receba a ideia com o LINK REAL, MINUTO INICIAL, MINUTO FINAL e CANTO DO PiP. Baixe o trecho com yt-dlp/ffmpeg (`yt-dlp --download-sections "*46:04-58:11" -o web/podcast.mp4` — ajuste os tempos da ideia), transcreva a fala e escreva `script.md` com 4 a 6 blocos de 6 a 12 segundos (total ≤ 60 s), um por frase do trecho. Para cada bloco: `FALA:` com o que é dito, `IMAGEM:` com a descrição visual daquilo que está sendo falado e `TEMPO:` a duração. Marque 1 ou 2 blocos interessantes com `TELA_CHEIA 10-25s`. Nada de dado inventado.',
    scene_plan: 'Uma cena por bloco, 6 a 12 s, todas "kind":"image". `narration` = a fala daquele bloco (para o Flow saber o que é falado). `visualIntent` em inglês = exatamente o ASSUNTO falado (o que a frase descreve), nunca o apresentador, com paleta e luz coerentes entre as imagens, sem texto. Em 1 ou 2 cenas de maior interesse, marque `notes` com `TELA_CHEIA 10-25s` (sem zoom, quadro fixo do vídeo original); as demais ficam em PiP fixa, sem zoom (o zoom lento é aplicado à IMAGEM DE FUNDO, nunca à PiP). A soma das cenas ≤ 60 s.',
    transcribe: 'Use o Whisper no trecho original baixado (`web/podcast.mp4`) para obter as PALAVRAS COM TEMPOS (`out/music.words.json`). A narração de cada cena deve ser exatamente o trecho falado naquele intervalo e `durationSec` = fim − início das palavras daquela fala, limitado a 6-12 s. Nunca invente falas nem tempos: o alinhamento imagem-fala vem do Whisper.',
    image: 'Gere no Google Flow, em 16:9, UMA imagem por cena baseada EXATAMENTE no ASSUNTO da narração transcrita pelo Whisper daquela cena — o objeto, tema, lugar ou evento citado, NUNCA o apresentador/Daniel Mastral —, mantendo paleta e estilo coerentes entre as imagens, sem texto escrito na imagem e com espaço livre no canto do PiP.',
    code_scene: 'HTML/Canvas 16:9 determinístico (só `t` de `window.__forge`, 30 fps): pinte a imagem gerada em `frame.png` como fundo full-frame aplicando ZOOM LENTO contínuo (Ken Burns: scale 1.0 → 1.08 ao longo da cena) e sobreponha o VÍDEO ORIGINAL baixado (`web/podcast.mp4`) em PiP de ~25% da largura NO CANTO PEDIDO (padrão: inferior esquerdo), com cantos arredondados, sombra e borda e QUADRO FIXO (sem zoom na PiP). Use `<video>` com `currentTime = t + inicioDoTrecho`, `pause()`/`seek(t)` sincronizados via `window.__forge.seek`. Nas cenas marcadas `TELA_CHEIA 10-25s`, o vídeo original ocupa 100% do quadro por 10 a 25 s, SEM ZOOM (scale fixo 1.0, sem cantos), voltando ao PiP com fade suave. Sem texto inventado.',
    music: 'Trilha de SUSPENSE BAIXA durante todo o vídeo: 5-8% do volume, -20 a -24 LUFS, bem abaixo da voz original. Gerar no Wan2GP ACE-Step (`wan2gp-music-ace.json`) ou YuE2; tema tenso e discreto, sem vocal.',
    metadata: 'Descrição com o link original em primeiro lugar, crédito ao podcast e os tempos dos blocos.',
  },
  reviewCriteria: 'Link real baixado e usado como PiP; cada imagem muda a cada 6-12 s e retrata o que é falado; PiP no canto pedido com quadro fixo e zoom lento na IMAGEM DE FUNDO; 1-2 idas a tela cheia de 10-25 s sem zoom e volta ao PiP; trilha de suspense baixa sob a voz; 16:9; menos de 60 s; sem texto inventado nas imagens; crédito e link originais na descrição.',
  appearance: 'custom', routeId: 'podcast-16-9', aspect: '16:9', durationSec: 60, language: 'pt-BR', presentation: 'mixed', mediaSources: ['youtube'], mixSources: ['stock', 'ai'], scriptEnding: 'conclusion', multiVoice: false, plugins: ['youtube'], storyboard: false,
  outputStyle: '🔗 Entrada: link real + minuto inicial/final + canto do PiP (ides baixa com yt-dlp). 🎙️ PiP ~25% no canto pedido, quadro fixo · 🖼️ imagens no Flow a cada 6-12 s do falado, com zoom lento (Ken Burns) · ⛶ 1-2 idas a TELA CHEIA 10-25 s sem zoom · 🎵 trilha de suspense baixa · 📤 final.mp4 16:9 <60 s + descrição com crédito e link.',
};

/** Pág. 135 — skill órfã: só funciona com a rota free podcast-pip-slideshow (presente em presets). */
const PODCAST_PIP_SLIDESHOW: Skill = {
  id: 'podcast-pip-slideshow', name: 'Podcast PiP + Slideshow', builtin: true, freeform: true,
  description: 'Link de podcast + minuto inicial/final + canto do PiP no campo ideia: vídeo do podcast em PiP, slideshow de 8-12 s sobre o que é falado e blocos fullscreen aleatórios de 30-55 s.',
  global: 'Skill do catálogo: o ramo free NÃO injeta skillText — a ideia do projeto é o prompt entregue ao harness. freeform: true impediu o reconcileRoute de derrubar a rota free. Operação: cole link + minuto inicial + minuto final + canto do PiP. PiP e fullscreen dependem de yt-dlp + ffmpeg escritos pelo harness; não há builtin equivalente. Crédito ao podcast e link original SEMPRE na descrição. PiP ~25% da largura no canto pedido, sem cobrir rosto/legendas; slides 8-12 s; blocos fullscreen 30-55 s; crédito visível na barra inferior.',
  steps: {
    image: 'Gere o QUADRO-BASE do slideshow do episódio em 9:16, usando o tema da ideia (podcast + minuto inicial/final): uma imagem vertical cinematográfica, sem texto, sem logos, com espaço para PiP no canto escolhido. Este é o modelo de imagem que o usuário escolhe em Provedores → etapa "Imagem do slideshow"; o arquivo sai em frames/frame.png.',
    free: 'Receba a ideia (link, minuto inicial, minuto final, canto do PiP) e use a imagem gerada em frames/frame.png como base do slideshow. Baixe só o trecho com yt-dlp/ffmpeg, monte o PiP e a intercalação de slides (8-12 s, derivações da imagem-base) com blocos fullscreen aleatórios (30-55 s), e grave out/final.mp4 (9:16, 600 s). Escreva out/metadata.json com o link original em primeiro lugar e o crédito ao podcast.',
  },
  appearance: 'doc_netflix', routeId: 'podcast-pip-slideshow', aspect: '9:16', durationSec: 600, language: 'pt-BR', presentation: 'mixed', mediaSources: ['youtube'], mixSources: ['stock', 'ai'], scriptEnding: 'next', multiVoice: false, musicVideo: false, plugins: ['youtube'],
  outputStyle: '🎙️ PiP 25% da largura (canto inferior/superior esquerdo) · slides 8-12 s · blocos fullscreen aleatórios 30-55 s.\n🔗 Entrada: link + minuto inicial/final + canto do PiP no campo ideia.\n📤 Saída: final.mp4 + descrição com crédito e link originais.',
};

/** Pág. 136 — lista de jogos com shopping nativo (usa rota de documentário existente). */
const LISTA_JOGOS_AFILIADO: Skill = {
  id: 'lista-jogos-afiliado', name: 'Lista de Jogos com Afiliado', builtin: true,
  description: 'Lista 8-12 jogos a partir de links de trailer/gameplay; diz o que é bom e o que é ruim e marca produtos no Shopping. (estilo gamer_review)',
  global: 'Contrato do episódio (18-22 min): entrada = tema + lista de links (trailer/gameplay) + plataforma alvo. Introdução de 40-60 s com gancho em 5 s (pergunta ou afirmação surpreendente). Um capítulo por jogo, 90-150 s: o que prometeu, o que entrega, o que falha, para quem vale. Nunca invente dado de vendas, nota ou recurso — use o que aparece no material. Cada capítulo termina com ponte para o próximo; o último com pergunta para comentários. O produto marcado precisa aparecer no capítulo correspondente; #publi no começo e "recebo comissão" na mesma linha do link; no máximo 3 produtos por capítulo, verifique disponibilidade regional. Não prometer "o melhor jogo" como fato: opinião refundada no que foi visto. Paleta azul-marinho + laranja (prós/contras) fixa; legenda opcional de 4 palavras/linha (escolha do projeto/editor); thumbnail com o jogo mais polêmico + até 3 palavras. Crítica com critério vende mais que entusiasmo genérico.',
  steps: {
    script: 'Gancho em 5 s ("Esse jogo custa R$ 349 e quase ninguém lembra que ele existe."), introdução 40-60 s com o critério da lista, e um capítulo por jogo (promessa/entrega/falha/público) com frases curtas e opinião explícita. Ponte no fim de cada capítulo.',
    scene_plan: '40% stock (gameplay/trailer do link, searchTerms com nome do jogo), 30% image (comparativos, mapas, tabelas), 20% code_scene (gráficos de preço e prós/contras), 10% video IA só para o que não existe em material real. Cenas de 4-8 s, uma ideia por cena.',
    metadata: 'Título com tema + número + torção; capítulos com timestamp por jogo; bloco "🎮 Indicados neste vídeo" com produto + URL de afiliado + "link de afiliado" na mesma linha; descrição começando com #publi e terminando com pergunta. Preencha TAMBÉM o campo "shopping" do metadata.json com [{"name","url","platform","note","chapter"}] — o app gera produtos.txt no kit de publicação. Nunca invente URL: use só links reais do pedido/canal.',
    review: 'Nota 0-10. Reprovar se faltou pró/contra de algum jogo, produto marcado não aparece no capítulo, dado inventado, #publi ausente, gancho depois de 5 s ou nenhuma pergunta no fim.',
  },
  appearance: 'custom', routeId: 'gta6-quality', aspect: '16:9', durationSec: 1080, language: 'pt-BR', presentation: 'mixed', mediaSources: ['youtube'], mixSources: ['stock', 'ai'], scriptEnding: 'next', multiVoice: false, plugins: ['youtube'],
  outputStyle: '🎮 Gancho em 5 s · capítulos por jogo · prós/contras · Shopping tags. Lista boa não elogia tudo — diz onde o jogo falha.',
};

/** Pág. 138 — feed de notícias com mídia mista (links + pasta local, rota gta6-quality). */
const FEED_NOTICIAS_MIDIA: Skill = {
  id: 'feed-noticias-midia-mista', name: 'Feed de Notícias com Mídia Mista', builtin: true,
  description: 'Links de imagens/vídeos e/ou pasta local; vídeo de notícias com gancho e narração curta por item, com vídeos em moldura nas cores do canal.',
  global: 'Entrada em qualquer combinação: URLs (imagem/vídeo, uma por linha), caminho de pasta local (.jpg/.png/.mp4/.webm) e tema + duas cores hex do canal. Cada item vira bloco de 25-45 s, do mais impactante ao mais leve. Nunca afirmar dado fora do material ou de fonte citada; se for rumor, dizer "rumor" na narração; crédito da fonte sempre visível na barra inferior. Imagem pede explicação (narração 60-110 palavras, Ken Burns leve); vídeo pede curiosidade (narração 15-30 palavras, primeiro quadro congelado 1,5-2 s, depois clipe em moldura 80% da largura, cantos 12 px, sombra, fundo gradiente nas 2 cores do canal, barra de cor no topo). Áudio original do clipe abaixo da narração com ducking; se não houver, trilha leve. Gancho antes da mídia, nunca depois; ponte no fim de todo bloco; fonte de cada item na descrição com timestamp.',
  steps: {
    script: 'Para cada item da lista/pasta: tipo (imagem|vídeo), fonte (URL/caminho), gancho de até 12 palavras, narração longa para imagem ou curta para vídeo, crédito (autor/sub/canal + link). Ordem por impacto; nenhum fato fora da fonte.',
    asset_design: 'Duas cores do canal + uma fonte para a legenda, quando ativada; moldura de vídeo 80% da largura, 12 px de raio, sombra; índice da pasta local por extensão/sha256 — o tratamento é o mesmo venha de URL ou do disco.',
    code_scene: 'HTML/Canvas com <video>: poster do primeiro frame em PNG; seek(0) e pausa até o timecode da narração curta; play() no fim do gancho; CSS width 80%, border-radius 12px, box-shadow, background linear-gradient(cor1, cor2). Sincronize com window.__forge.seek(t).',
    metadata: 'Descrição com fonte e timestamp de cada item, créditos visíveis e link original.',
    review: 'Reprovar se o gancho vier depois da mídia, se faltar crédito visível, se houver dado inventado ou se o bloco terminar sem ponte.',
  },
  appearance: 'custom', routeId: 'gta6-quality', aspect: '16:9', durationSec: 480, language: 'pt-BR', presentation: 'mixed', mediaSources: ['youtube'], mixSources: ['stock', 'ai'], scriptEnding: 'next', multiVoice: false, plugins: ['youtube'],
  outputStyle: '⚡ Gancho 3 s · imagem = narração longa · vídeo = frame congelado + narração curta + playback em moldura colorida. O frame parado é o gancho; a moldura é a assinatura.',
};

/** Pág. 145 — cortes virais de lives (lote de MP4, rota shorts-autopilot). */
const CORTES_VIRAIS_LIVES: Skill = {
  id: 'cortes-virais-lives', name: 'Cortes Virais de Lives', builtin: true,
  description: 'Live longa vira vários vídeos curtos com gancho, edição leve e publicação pronta; a skill decide quantos cortes, onde começam e se entram avatar/narração. (estilo short_viral)',
  global: 'O usuário informa: link/arquivo da live (obrigatório), intervalo minuto inicial/final (opcional, padrão live inteira), quantidade de clipes (padrão 3, máximo 10), avatar (padrão não), narração de início (padrão sim, 1 frase) e estilo (engraçado/polêmico/ensino/emoção). Um corte viral tem pico de energia no áudio, rajada no chat no mesmo instante (>3× a mediana em 10 s), frase completa (não corta no meio da palavra), autossuficiente e uma emoção por clipe. Estrutura de cada clipe: 0-3 s gancho (narração/avatar/texto), 3-45 s corte da live com áudio original integral e legenda opcional de 4 palavras/linha (ativada no projeto/editor), 45-50 s fecho. Trilha -20 a -24 LUFS sob a voz da live (8-12%), ducking de 6-10 dB, master final -14 LUFS. Avatar opcional 6-8 s no canto inferior direito; mesmo timbre em toda a série; rótulo de IA se sintético. Crédito ao canal e link original na descrição; corte de live é reused content se não houver transformação — o gancho, a edição e (se ativada no projeto/editor) a legenda são a transformação.',
  steps: {
    script: 'Escolha os momentos por energia e frase completa (dedupe por trecho, sem sobreposição); escreva gancho, legenda e fecho de cada clipe.',
    scene_plan: 'Um plano por clipe com timecodes de entrada/saída da live; marque avatar e narração somente quando pedidos.',
    video: 'Corte a live com -ss/-t, converta para 9:16 com crop central/reframe; versão horizontal 16:9 opcional com a paleta do canal nas laterais.',
    narration: 'Gere a frase de abertura gravada ANTES do vídeo (a frase define a duração do gancho) somente quando marcada.',
    music: 'Trilha baixa 8-12% com ducking automático sob a voz da live.',
    edit: 'Monte, normalize a -14 LUFS e exporte um MP4 por clipe.',
    metadata: 'Título com gancho, capítulos, crédito ao canal e link da live, #publi se houver afiliado.',
  },
  appearance: 'custom', routeId: 'shorts-autopilot', aspect: '9:16', durationSec: 45, language: 'pt-BR', presentation: 'mixed', mediaSources: ['youtube'], mixSources: ['stock', 'ai'], scriptEnding: 'next', multiVoice: false, plugins: ['youtube'],
  outputStyle: '✂️ Gancho 1-3 s · legenda opcional 4 palavras · trilha 8-12% · avatar/narração opcionais · um MP4 por clipe. Live longa, clipe curto: um momento, uma emoção, um gancho.',
};

/** Pág. 147 — avatar reativo (folha de PNGs, rota documentario-3d). */
const AVATAR_REATIVO_VIDEO: Skill = {
  id: 'avatar-reativo-video', name: 'Avatar Reativo sobre Vídeo', builtin: true,
  description: 'Vídeo montado com narração e avatares estáticos em várias poses que entram e saem com efeito; pose e expressão seguem a emoção da narração.',
  global: 'Entrada: tema/filme/resumo (obrigatório), tom do canal, quantidade de avatares (1-3), posição (terço direito padrão ou inferior esquerdo). O avatar é IMAGEM ESTÁTICA, não vídeo falante: a narração é a do vídeo. Aparece entre 20% e 35% do tempo — acento, não segundo apresentador. Nos primeiros 3 s o gancho é do vídeo, nunca do avatar. Ritmo de aparição 2-4 s, espalhados. Identidade estável: mesmo rosto/cabelo/roupa/paleta em todas as poses. Bíblia: 6-8 poses fixas (neutro, surpreso, cético, medo, riso, pensativo, apontando, perfil), PNG transparente 1024x1024 com nomes avatar_neutro.png etc. Gere primeiro a folha de contato, aprove a identidade, depois exporte os individuais; se duas poses saírem com rostos diferentes, refaça a folha. Avatar sintético: rótulo de IA; pessoa real: consentimento por escrito. O avatar não apresenta — ele reage.',
  steps: {
    script: 'Marque a pose ao lado da frase: "Os animatrônicos se movem sozinhos. [AVATAR:medo]". No máximo 1 marcação por bloco de 8-12 s; nenhuma nos primeiros 3 s; sem marcação, o vídeo segue sem avatar.',
    scene_plan: 'Por marcação: caminho do PNG, posição, altura 25-35%, duração 2-4 s, efeito de entrada/saída. Avatar acima da zona de legenda, quando houver, fora da zona segura central.',
    code_scene: '<img> sobre o vídeo: opacity 0→1 em 0,3 s, scale 0,92→1 + translateY 8px→0, blur 6px→0 na entrada; saída invertida em 0,25 s; sincronize com window.__forge.seek(t); sem animação contínua de "respiração".',
    review: 'Reprovar se avatar >35% do tempo, entrada/saída sem efeito, pose contradiz a frase, rosto diferente entre poses, cobre legenda ou rótulo de IA ausente.',
  },
  appearance: 'doc_netflix', routeId: 'documentario-3d', aspect: '16:9', durationSec: 600, language: 'pt-BR', presentation: 'mixed', mediaSources: ['youtube', 'pexels'], mixSources: ['stock', 'ai'], scriptEnding: 'next', multiVoice: false, musicVideo: false,
  outputStyle: '🎭 Avatar 25-35% da altura · fade+escala 0,3 s · 20-35% do tempo. O avatar não apresenta — ele reage.',
};

const SPECIAL: Skill[] = [
  UGC_PRODUTO,
  MUSICA_LIPSYNC,
  CARTOON_SHORT_STUDIO,
  CARTOON_TO_REAL,
  PODCAST_16_9,
  PODCAST_PIP_SLIDESHOW,
  LISTA_JOGOS_AFILIADO,
  FEED_NOTICIAS_MIDIA,
  CORTES_VIRAIS_LIVES,
  AVATAR_REATIVO_VIDEO,
  CARTOON_3D_SHORT,
  CARTOON_3D_LONG,
  LINK_EXPLAINER,
  MUSIC_VIDEO_PASTA,
  MUSIC_VIDEO_BANCO,
  ...CAST_STORIES,
  ...DRAMA_SKILLS,
  { id: 'video-livre', name: 'Vídeo livre (só o seu prompt)', builtin: true, freeform: true,
    description: 'Skill vazia: não gera roteiro, cenas nem narração. O que você escrever no prompt vai direto ao harness pela rota "Vídeo livre".',
    global: '', steps: {}, appearance: 'custom', routeId: 'video-livre', aspect: '16:9', durationSec: 60, language: 'pt-BR', presentation: 'generated', mediaSources: [],
    outputStyle: '🎬 Sem roteiro, cenas ou narração.\n🧠 O harness recebe exatamente o seu prompt (mais estilos, arquivos de referência e o brief do orquestrador, se houver).\n📦 Saída: out/final.mp4 produzido pelo próprio harness (ffmpeg, código, modelos que ele tiver).' },
  { id: 'misto-motion-banco-ia', name: 'Misto: motion graphics + bancos + vídeo IA (MiniMax)', builtin: true,
    description: 'Mescla motion graphics por código, imagens e vídeos de bancos de mídia e cenas de vídeo geradas por IA (MiniMax no ComfyUI).',
    global: 'Vídeo explicativo misto. Motion graphics por código carregam dados, diagramas e texto na tela; bancos de mídia trazem o mundo real; vídeo IA entra nos momentos de impacto que não existem em banco. Paleta e tipografia consistentes em todas as fontes.',
    steps: {
      scene_plan: 'Distribua cerca de 50% de cenas "code"/"motion", 30% "stock"/"mixed" (com searchTerms em inglês) e 20% "video" (vídeo IA) nos momentos de maior impacto. visualIntent das cenas "video" descreve sujeito, ação, luz e câmera.',
      code_scene: 'Motion graphics com easing suave; se houver arquivos em stock/, insira-os na composição sem esticar. Sincronize com as palavras da narração.',
      image: 'Quadro-chave fotográfico e cinematográfico que servirá de referência para o vídeo IA.',
      video: 'Movimento de câmera lento e contínuo, 4–6 s, sem cortes, coerente com a paleta do vídeo.',
      thumbnail: 'Quadro de maior impacto do vídeo IA com título de até 3 palavras.',
    },
    appearance: 'motion_graphics', routeId: 'misto-motion-banco-ia', aspect: '16:9', durationSec: 120, language: 'pt-BR',
    presentation: 'mixed', mediaSources: [...STOCK], mixSources: ['motion', 'stock', 'ai'],
    outputStyle: '🎨 Visual: motion graphics por código + fotos/vídeos de bancos + vídeo IA (MiniMax).\n⏱ Ritmo: cenas de 4–8 s; vídeo IA nos momentos de impacto.\n🎙 Narração: didática e clara, sincronizada com os gráficos.\n📦 Saída: final.mp4 (16:9, ≈ 120 s) + legendas (se ativadas no projeto/editor) + thumbnail + metadados SEO.' },
  { id: 'remake-viggle', name: 'Remake de vídeo curto (Viggle)', builtin: true,
    description: 'Clona um vídeo curto trocando personagens, objetos, cenário, clima ou luz (Viggle Remake no Wan2GP), mantendo o movimento, a câmera, o tempo e o som do original.',
    global: 'Você refaz um VÍDEO CURTO anexado (até 15 s): o movimento, a câmera, os cortes, o tempo e o som vêm do vídeo original; só muda o que o pedido diz (pessoa/personagem → Viggle Swap; objeto, cenário, clima, luz ou estilo → Viggle Edit). As fotos anexadas como referência mostram o novo personagem/objeto. Se houver um quadro já editado anexado (nota "quadro editado"), ele manda no visual.',
    steps: {
      script: 'Grave `script.md` SOMENTE com o prompt do Viggle Remake, em INGLÊS, nas 6 seções nesta ordem, uma linha em branco entre elas, sem Markdown: subject_definitions:, summary:, retention_analysis:, detailed_description:, overall_soundscape:, non_diegetic_music:. Em subject_definitions: "<Video 1> is the source video: <descreva o vídeo anexado>", "<Picture 1> is a frame of the target video, exactly as the target video shows it at that moment.", "<Subject 1> is <nome> in <Picture 1>: <aparência exata da referência>. She/He replaces <quem sai>." Em summary comece com [video editing + character replacement] ou [video editing + object and scene change]. Descreva o vídeo FINAL no presente (nunca instruções como replace/change), com tempos MM:SS.mmm em detailed_description ([Shot 1] At 00:00.000 …). overall_soundscape: o som do <Video 1>. non_diegetic_music: N/A.',
      metadata: 'Título curto e curioso sobre a troca (ex.: "E se fosse um robô?"), descrição de 2 frases e 5 tags.',
      thumbnail: 'Quadro mais marcante do remake com 2–3 palavras grandes.',
    },
    appearance: 'custom', routeId: 'viggle-remake', aspect: '9:16', durationSec: 15, language: 'pt-BR',
    presentation: 'generated', mediaSources: [],
    outputStyle: '🎬 Entrada: um vídeo curto anexado (até 15 s) + foto(s) do novo personagem/objeto (ou um quadro já editado).\n🔁 Viggle Remake no Wan2GP: Swap (pessoas/personagens) ou Edit (objetos, cenário, clima, luz).\n🎙 Som, câmera, movimento e tempo do original.\n📦 Saída: o vídeo refeito + título, descrição e capa.' },
  { id: 'clipe-musical-loop', name: 'Clipe musical em loop (MiniMax H3)', builtin: true,
    description: 'Clipe musical em coletânea de N a M minutos (instrumental ou canção), visual em loop perfeito de 10–15 s (anime 2D, pixel art ou vídeo IA), nome da faixa e waveform.',
    global: 'Você cria um CLIPE MUSICAL, não uma narração. O visual é UM loop perfeito feito no MiniMax H3: a MESMA imagem da cena entra como first_frame e last_frame; a câmera fica fixa e o movimento é cíclico. Não use reverse/pingpong. O app gera as músicas, remove o frame duplicado do fim do vídeo, usa a duração exata como período do loop e sobrepõe o nome da faixa + waveform.',
    steps: {
      script: 'Grave `script.md` com: 1) um conceito visual curto e específico (anime 2D, personagem, cenário, hora do dia, paleta, luz); 2) a linha `MUSIC_PLAN:` seguida de um ARRAY JSON com o NÚMERO DE FAIXAS e os SEGUNDOS por faixa informados pelo app (coletânea de N a M minutos definida pelo usuário; cada faixa é uma música completa de 60 a 300 s): [{"name":"...","style":"...","seconds":150,"lyrics":"..."}]. Use o estilo musical do projeto; nomes curtos e temáticos. Se `musicMode=song`, inclua lyrics curtos e cantáveis; se instrumental, use "[Instrumental]". Não escreva narração falada.',
      scene_plan: 'Crie EXATAMENTE 1 cena de 12 s com kind "video" e narração vazia. `visualIntent`: UMA imagem estática em inglês que funcione como primeiro E último frame (personagem, pose, cenário, enquadramento, luz, paleta), sem texto. `videoPrompt`: OBRIGATÓRIO, em inglês, específico para MiniMax H3 image-to-video — movimento cíclico sutil (respiração, piscar, vapor, chuva, folhas, luzes, parallax suave), câmera fixa, começo e fim iguais, sem cortes, sem texto, sem zoom brusco e sem elementos atravessando a borda. Preencha `searchTerms` em inglês.',
      image: 'Key visual anime 2D 16:9: linha limpa, cel shading, cores saturadas, fundo pintado, personagem consistente, sem texto. A composição precisa caber inteira no quadro (é o primeiro e o último frame do loop).',
      video: 'Loop perfeito: câmera fixa, movimento cíclico sutil e contínuo, primeiro e último frame iguais; sem corte seco, sem reverse e sem elementos saindo pela borda.',
      thumbnail: 'Quadro de maior impacto do loop com título de até 3 palavras.',
    },
    appearance: 'anime_2d', routeId: 'clipe-musical-loop', aspect: '16:9', durationSec: 1800, language: 'pt-BR',
    presentation: 'generated', mediaSources: [],
    outputStyle: '🎨 Visual: anime 2D (linha limpa, cel shading) em loop perfeito.\n🎵 Música: coletânea de N a M minutos no YuE 2, faixas completas de 1 a 5 min até a duração pedida (mínimo e máximo definidos no projeto); instrumental local = YuE 2 com LoRA instrumental, sem voz.\n🔁 Loop: MiniMax H3 com a mesma imagem no primeiro e último frame; frame duplicado removido.\n📦 Saída: final.mp4 (16:9) com nome da faixa + waveform.' },
  { id: 'clipe-musical-loop-codigo', name: 'Clipe musical em loop com código (Canvas/WebGL)', builtin: true,
    description: 'Clipe musical em coletânea de N a M minutos (instrumental ou canção) e uma cena de 10–15 s desenhada por código em loop perfeito: sem imagem ou vídeo por IA, só Canvas/SVG/WebGL puro.',
    global: 'Você cria um CLIPE MUSICAL, não uma narração. O visual é UM loop perfeito desenhado por CÓDIGO: a cena inteira nasce de uma página HTML autocontida com Canvas 2D, SVG ou WebGL puro. Não use imagens, vídeos, ComfyUI, bibliotecas externas, fetch nem assets de rede. O app renderiza a cena em 30 fps, usa a duração exata como período do loop, gera as faixas no Yue 2 e sobrepõe o nome da faixa + waveform. O ciclo precisa fechar: seek(0) e seek(duração) são visualmente idênticos, sem reverse/pingpong.',
    steps: {
      script: 'Grave `script.md` com: 1) um conceito visual curto e específico, pensado para ser DESENHADO POR CÓDIGO (personagem/objeto simples, cenário em camadas, paleta, hora do dia, luz, movimento cíclico); 2) a linha `MUSIC_PLAN:` seguida de um ARRAY JSON com o NÚMERO DE FAIXAS e os SEGUNDOS por faixa informados pelo app (coletânea de N a M minutos definida pelo usuário; cada faixa é uma música completa de 60 a 300 s): [{"name":"...","style":"...","seconds":150,"lyrics":"..."}]. Use o estilo musical do projeto; nomes curtos e temáticos. Se `musicMode=song`, inclua lyrics curtos e cantáveis; se instrumental, use "[Instrumental]". Não escreva narração falada.',
      scene_plan: 'Crie EXATAMENTE 1 cena de 12 s com kind "code" e narração vazia. `visualIntent`: descreva em inglês UMA cena desenhável por código — composição, formas, camadas, paleta (hex), luz, personagem/objeto e o movimento cíclico sutil que fecha o loop (respiração, piscar, chuva, folhas, luzes, parallax). Sem texto na cena. Não preencha `videoPrompt`: não há vídeo por IA nesta rota. `searchTerms`: vazio.',
      code_scene: 'Crie uma página HTML autocontida (HTML+CSS+JS inline, sem rede, sem bibliotecas externas; Canvas 2D, SVG ou WebGL puro) que desenhe a cena de `visualIntent` em 1920×1080. Anime tudo com `seek(t)`: movimento cíclico contínuo de 12 s, primeiro e último quadro visualmente iguais, sem reverse, sem saltos, sem elementos atravessando a borda. Câmera fixa. Estilo anime 2D de linha limpa e cel shading (ou pixel art, se o projeto pedir), com paleta coerente. Não use Date.now, performance.now, Math.random sem seed, fetch, imagens ou fontes externas: o único relógio é `t`. Entregue exatamente o contrato `window.__forge` pedido pelo app.',
      thumbnail: 'Quadro de maior impacto do loop com título de até 3 palavras.',
    },
    appearance: 'anime_2d', routeId: 'clipe-musical-loop-codigo', aspect: '16:9', durationSec: 1800, language: 'pt-BR',
    presentation: 'generated', mediaSources: [],
    outputStyle: '🧑‍💻 Visual: loop perfeito de 12 s desenhado por código (HTML/Canvas/SVG/WebGL), sem imagem ou vídeo por IA.\n🎵 Música: coletânea de N a M minutos no YuE 2, faixas completas de 1 a 5 min até a duração pedida (mínimo e máximo definidos no projeto); instrumental local = YuE 2 com LoRA instrumental, sem voz.\n🔁 Loop: render determinístico a 30 fps; primeiro e último quadro iguais; fallback animado Paris se a cena de código falhar.\n📦 Saída: final.mp4 (16:9) com nome da faixa + waveform.' },
];

/** Tutorial com clipes: a narração explica, o motion graphics ilustra e os vídeos do usuário entram SEM narração. */
const TUTORIAL_CLIPES: Skill = {
  id: 'tutorial-clipes', name: 'Tutorial com clipes (vídeos do usuário)', builtin: true,
  description: 'Tutorial narrado a partir dos seus vídeos: a narração explica, o motion graphics ilustra e os trechos dos vídeos entram sem narração (como um tutorial de tela).',
  global: 'Você está montando um TUTORIAL a partir de vídeos enviados pelo usuário. OS CLIPES ENVIADOS SÃO O CONTEÚDO PRINCIPAL e devem ser usados POR COMPLETO (do 0 ao fim, em segmentos contíguos, sem pular trechos). O motion graphics é CURTO (2–4 s) e serve só para abertura, transições e explicar um conceito. A narração indica o que ocorre na tela e a fala deve ter relação direta com o que está sendo exibido.',
  steps: {
    script: `Escreva o roteiro de um TUTORIAL didático usando os vídeos anexados como fonte da verdade: leia as transcrições e OLHE as folhas de quadros (elas mostram o que aparece em cada momento). COBERTURA TOTAL: divida a duração INTEIRA de cada vídeo em blocos de 10–20 s, na ordem, sem pular nenhum trecho; cada bloco tem uma fala curta que indica o que está acontecendo na tela naquele momento (o que é aberto, clicado, digitado, mostrado) e por quê. Estrutura:
1) abertura curta (3–5 s, vira motion graphics): o problema e o que a pessoa vai aprender;
2) o tutorial em si: os blocos cobrindo os vídeos do começo ao fim, com a fala descrevendo a ação na tela;
3) fechamento curto (3–5 s, motion graphics): recapitulação em 3 passos + próximo passo.
Para cada trecho que deve aparecer, escreva uma linha no formato [CLIPE: <arquivo> | início <s> | duração <s> | com fala]. A narração SEMPRE acompanha o clipe (o áudio original da captura é substituído pela narração): descreva a ação que está na tela.`,
    scene_plan: `Monte cenas cobrindo 100% dos vídeos anexados:
- "video": cada segmento do clipe com "userMedia": "<arquivo>", "clipStart": <segundo inicial>, "manualDuration": true e "durationSec": <duração>; os segmentos são CONTÍGUOS (o próximo clipStart = fim do anterior) e juntos cobrem do 0 ao fim de CADA vídeo — não pule nenhum trecho;
- "motion": no máximo 2–3 cenas curtas (2–4 s) para abertura, transição e fechamento (motion graphics).
NARRAÇÃO: TODA cena de clipe tem narração descrevendo a ação que aparece na tela (o áudio original da captura NÃO é usado). Use as folhas de quadros para dizer o que é aberto, clicado ou mostrado. Soma das durações = duração dos vídeos + motion curto.
CAPTURA DE TELA / OBS: comece depois que a janela do OBS sair da tela. Se a barra de tarefas/rodapé com o ícone do OBS aparecer, recorte com "clipCrop": {"w":1920,"h":1032,"x":0,"y":0} (1080p; corta os 48 px do rodapé). NUNCA mostre o OBS.`,
    motion_graphics: 'Explique com motion graphics de tutorial: tipografia cinética, diagramas, ícones, passos numerados, barras/contadores e destaques; texto na tela curto (≤ 4 palavras por bloco) e sincronizado com a fala; paleta limpa de tutorial; sem imagens externas nem texto corrido.',
    narration: 'Voz clara e didática de tutorial: ritmo de conversa, frases curtas, pausas entre passos; energia amigável e confiante. Nunca narre por cima do clipe — a cena do clipe fica em silêncio.',
    metadata: 'Título de tutorial com a promessa e o resultado ("Como fazer X em Y", "X em N passos"), sem clickbait enganoso; descrição com capítulos nos tempos das cenas.',
  },
  appearance: 'motion_graphics', routeId: 'shorts-autopilot', aspect: '16:9', durationSec: 180, language: 'pt-BR',
  presentation: 'mixed', mediaSources: [], mixSources: ['motion'],
  outputStyle: '🎨 Visual: motion graphics explicando + trechos reais dos vídeos enviados (sem narração sobre o clipe).\n🎙 Narração: tutorial claro e direto, com pausas para as demonstrações.\n📎 Entrada: um ou mais vídeos anexados no Novo projeto (seção "Arquivos para o vídeo" → "Arquivos.") — eles são transcritos para o roteiro saber o que mostram.\n📦 Saída: final.mp4 (16:9) + legendas (se ativadas no projeto/editor) + thumbnail + metadados.',
};

export const BUILTIN_SKILLS: Skill[] = [
  ...SPECIAL,
  TUTORIAL_CLIPES,
  ...BASE_SKILLS.map((k) => ({ ...k, ...(BASE_EXTRA[k.id] ?? {}), builtin: true })),
  ...VIDEO_TYPES.map(fromType),
];
