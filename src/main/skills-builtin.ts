import type { MixSource, ScriptEnding, Skill, VideoTypeId } from '../shared/types';
import { BUILTIN_SKILLS as BASE_SKILLS, MIXED_STOCK_SOURCES, VIDEO_TYPES } from './presets';

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
      `📦 Saída: final.mp4 (${v.defaultAspect}, ≈ ${v.defaultDurationSec}s) + legendas .srt + ${cover} + título/descrição/tags.`,
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
    outputStyle: '🎨 Visual: animações desenhadas por código, texto grande (≤ 6 palavras), clipes curtos de YouTube (2–4 s) inseridos no motion graphics quando útil; na reserva, imagens/vídeos de Pexels, Pixabay, Wikimedia, Openverse, NASA, Internet Archive, Smithsonian e Unsplash.\n⏱ Ritmo: cenas de 4–8 s, um conceito por cena, revelação sincronizada com a fala.\n🎙 Narração: calma e clara, pausas curtas.\n📦 Saída: final.mp4 (16:9, ≈ 120 s) + legendas + thumbnail + metadados SEO.' },
  'shorts-viral': { appearance: 'cartoon_3d', routeId: 'shorts-autopilot', aspect: '9:16', durationSec: 60, presentation: 'generated',
    outputStyle: '🎨 Visual: vertical, legenda grande no centro-inferior.\n⏱ Ritmo: corte a cada 2–4 s; gancho em 3 s; final que emenda com o início (loop).\n🎙 Narração: frases de até 12 palavras.\n📦 Saída: final.mp4 (9:16, 30–60 s) + legendas + capa vertical + título curto e ≤ 5 hashtags.' },
  'documentario': { appearance: 'doc_netflix', routeId: 'documentario-3d', aspect: '16:9', durationSec: 300, presentation: 'mixed', mediaSources: [...STOCK], mixSources: ['motion', 'stock', 'ai'],
    outputStyle: '🎨 Visual: B-roll de bancos de mídia + infográficos por código (mapas, linhas do tempo, números) + reconstituições em vídeo IA só onde não há arquivo.\n⏱ Ritmo: três atos, respiros entre revelações.\n🎙 Narração: séria, factual, com fatos e datas verificados.\n📦 Saída: final.mp4 (16:9, ≈ 5 min) + legendas + thumbnail + descrição com fontes e créditos.' },
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
    `📦 Saída: final.mp4 (${o.aspect}, ≈ ${o.durationSec}s) + legendas + capa + metadados.`,
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
  outputStyle: '🌐 Entrada: um ou vários links na ideia (ex.: "explique https://site.com/produto" ou "compare https://a.com e https://b.com") — até 20 links, explicados na ordem (com muitos links, cada página é lida e gravada de forma mais curta). Vídeos que tocam na página viram trechos curtos.\n🎥 Captura: o app abre a página num navegador invisível (sem os seus logins), grava a página rolando com paradas em cada seção e tira prints.\n🧠 Análise: o roteiro sai do conteúdo da página (títulos, seções e texto).\n🎨 Visual: motion graphics por código com trechos da página numa moldura de navegador, destaques, zoom e setas no instante da fala.\n📦 Saída: final.mp4 (16:9, ≈ 90 s) + legendas + thumbnail (print da página) + metadados com o link.',
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

/** Música com lipsync: canção no ACE-Step XL e cantor da biblioteca cantando no MiniMax H3 (LoRA de 4 passos). */
const MUSICA_LIPSYNC: Skill = {
  id: 'musica-lipsync', name: 'Música com lipsync (cantor da biblioteca)', builtin: true, multiVoice: true,
  description: 'Clipe de música original: a canção é composta e gerada no ACE-Step 1.5 XL (Wan2GP) e o cantor — um personagem da biblioteca — canta cada verso com os lábios sincronizados no MiniMax H3 (Ref2VA + LoRA de aceleração de 4 passos).',
  global: 'Você é COMPOSITOR e DIRETOR DE VIDEOCLIPE. A canção é original, cantável e curta; o clipe mostra o CANTOR (personagem da biblioteca, mesmo rosto em todas as cenas) cantando para a câmera, com cortes no ritmo da música. Não há narração: a canção é o único áudio e a letra vira legenda.',
  steps: {
    script: 'Grave `script.md` com: 1) `TITLE: <nome da canção>`; 2) `SINGER: <nome do cantor da biblioteca>` (se não houver, invente um nome curto); 3) `STYLE: <gênero, instrumentos, andamento em BPM, tipo de voz>` em inglês (ex.: "upbeat pop, acoustic guitar, 110 BPM, warm female vocals"); 4) `LYRICS:` com a letra no idioma do projeto, um verso por linha, blocos com rótulos [verse], [chorus], [bridge] e linha em branco entre blocos; 5) `VISUAL:` conceito do clipe (2–3 cenários, paleta, luz). Para 40–60 s: [verse] de 4 versos + [chorus] de 4 versos + [verse] curto ou [bridge] + [chorus] repetido. Versos de 5 a 9 palavras, rimas simples, refrão marcante.',
    asset_design: 'Em "## Personagens fixos", use EXATAMENTE o cantor da biblioteca (mesmo nome e aparência) com o figurino do clipe; em "## Cenários", 2 a 3 locais do VISUAL (palco, rua à noite, estúdio, campo…), com luz e paleta.',
    scene_plan: 'Use os tempos de `out/lyrics-timing.json`. Crie UMA cena por verso (ou por dois versos muito curtos), de 3 a 6 s, na ordem da canção, todas "kind":"video". `narration` = o(s) verso(s) EXATAMENTE como na letra (separados por " / "); `speaker` = o cantor quando há voz; intro/solo instrumental sem `speaker`. visualIntent em inglês: o cantor PELO NOME, cantando para a câmera em plano médio ou close (rosto e boca bem visíveis), o cenário e a luz; varie o enquadramento entre as cenas; o refrão é mais intenso (luz, movimento).',
    image: 'Quadro de videoclipe: o cantor da biblioteca idêntico à folha de personagem, de frente para a câmera, boca visível, luz cinematográfica, sem texto e sem microfone cobrindo a boca.',
    video: 'O cantor canta este trecho com os lábios sincronizados à voz, expressão coerente com a letra; movimento de câmera lento; nada passa na frente do rosto.',
    thumbnail: 'Close do cantor cantando com luz forte e o título da música em até 3 palavras.',
    metadata: 'Título com o nome da música e o clima; descrição com a letra completa e créditos (música gerada por IA); 5–10 tags de gênero.',
  },
  reviewCriteria: 'Boca do cantor acompanhando a voz em cada cena; o mesmo rosto em todas as cenas; cortes no começo dos versos; canção em volume cheio, sem narração; legendas com a letra certa.',
  appearance: 'music_lyric', routeId: 'musica-lipsync', aspect: '16:9', durationSec: 50, language: 'pt-BR', presentation: 'generated', mediaSources: [],
  outputStyle: '🎵 Canção original com letra (ACE-Step 1.5 XL no Wan2GP).\n🎤 Cantor da biblioteca cantando com lipsync (MiniMax H3 Ref2VA + LoRA de 4 passos; o trecho da canção de cada cena guia a boca).\n✂️ Uma cena por verso (3–6 s).\n🔇 Sem narração; letra como legenda.\n📤 Saída: final.mp4 com a canção em volume cheio.',
};

const SPECIAL: Skill[] = [
  UGC_PRODUTO,
  MUSICA_LIPSYNC,
  CARTOON_3D_SHORT,
  CARTOON_3D_LONG,
  LINK_EXPLAINER,
  MUSIC_VIDEO_PASTA,
  MUSIC_VIDEO_BANCO,
  ...CAST_STORIES,
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
    outputStyle: '🎨 Visual: motion graphics por código + fotos/vídeos de bancos + vídeo IA (MiniMax).\n⏱ Ritmo: cenas de 4–8 s; vídeo IA nos momentos de impacto.\n🎙 Narração: didática e clara, sincronizada com os gráficos.\n📦 Saída: final.mp4 (16:9, ≈ 120 s) + legendas + thumbnail + metadados SEO.' },
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
  outputStyle: '🎨 Visual: motion graphics explicando + trechos reais dos vídeos enviados (sem narração sobre o clipe).\n🎙 Narração: tutorial claro e direto, com pausas para as demonstrações.\n📎 Entrada: um ou mais vídeos anexados no Novo projeto (seção "Arquivos para o vídeo" → "Arquivos.") — eles são transcritos para o roteiro saber o que mostram.\n📦 Saída: final.mp4 (16:9) + legendas + thumbnail + metadados.',
};

export const BUILTIN_SKILLS: Skill[] = [
  ...SPECIAL,
  TUTORIAL_CLIPES,
  ...BASE_SKILLS.map((k) => ({ ...k, ...(BASE_EXTRA[k.id] ?? {}), builtin: true })),
  ...VIDEO_TYPES.map(fromType),
];
