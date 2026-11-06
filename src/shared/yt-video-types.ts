/** Tipos de vídeo do YouTube para a aba Pesquisar: rótulo e o termo que cada público digita na busca (pt/en/es; os outros idiomas usam o inglês). */
export interface YtVideoType { id: string; icon: string; label: string; kw: { pt: string; en: string; es: string } }
export interface YtVideoTypeGroup { label: string; types: YtVideoType[] }

export const YT_VIDEO_TYPES: YtVideoTypeGroup[] = [
  { label: 'Informação e educação', types: [
    { id: 'documentario', icon: '🎞️', label: 'Documentário', kw: { pt: 'documentário', en: 'documentary', es: 'documental' } },
    { id: 'explicativo', icon: '🧠', label: 'Explicativo animado', kw: { pt: 'explicado animação', en: 'explained animation', es: 'explicado animación' } },
    { id: 'curiosidades', icon: '❓', label: 'Curiosidades / fatos', kw: { pt: 'curiosidades', en: 'facts you didn\'t know', es: 'curiosidades' } },
    { id: 'top10', icon: '🔟', label: 'Top 10 / ranking', kw: { pt: 'top 10', en: 'top 10', es: 'top 10' } },
    { id: 'tutorial', icon: '🛠️', label: 'Tutorial / passo a passo', kw: { pt: 'tutorial passo a passo', en: 'tutorial step by step', es: 'tutorial paso a paso' } },
    { id: 'aula', icon: '📚', label: 'Aula / resumo de estudo', kw: { pt: 'aula resumo', en: 'lesson explained', es: 'clase resumen' } },
    { id: 'historia', icon: '🏛️', label: 'História', kw: { pt: 'história de', en: 'history of', es: 'historia de' } },
    { id: 'ciencia', icon: '🔬', label: 'Ciência / espaço', kw: { pt: 'ciência', en: 'science', es: 'ciencia' } },
    { id: 'biografia', icon: '👤', label: 'Biografia', kw: { pt: 'biografia', en: 'biography', es: 'biografía' } },
    { id: 'noticias', icon: '📰', label: 'Notícias / análise', kw: { pt: 'notícias análise', en: 'news analysis', es: 'noticias análisis' } },
  ] },
  { label: 'Histórias e mistério', types: [
    { id: 'misterio', icon: '🕵️', label: 'Mistério / casos inexplicáveis', kw: { pt: 'mistério não resolvido', en: 'unsolved mystery', es: 'misterio sin resolver' } },
    { id: 'truecrime', icon: '🚨', label: 'True crime', kw: { pt: 'caso real crime', en: 'true crime', es: 'caso real crimen' } },
    { id: 'terror', icon: '👻', label: 'Histórias de terror', kw: { pt: 'história de terror', en: 'scary stories', es: 'historias de terror' } },
    { id: 'reddit', icon: '💬', label: 'Histórias do Reddit / relatos', kw: { pt: 'relatos reddit', en: 'reddit stories', es: 'historias de reddit' } },
    { id: 'contos', icon: '📖', label: 'Contos / narração de livros', kw: { pt: 'conto narrado', en: 'story narrated', es: 'cuento narrado' } },
    { id: 'drama', icon: '🎭', label: 'Microdrama / série curta', kw: { pt: 'minissérie drama', en: 'short drama series', es: 'mini serie drama' } },
  ] },
  { label: 'Entretenimento', types: [
    { id: 'reacao', icon: '😮', label: 'Reação (react)', kw: { pt: 'react reagindo', en: 'reaction', es: 'reacción' } },
    { id: 'humor', icon: '😂', label: 'Humor / esquetes', kw: { pt: 'humor esquete', en: 'comedy sketch', es: 'humor sketch' } },
    { id: 'desafio', icon: '🏆', label: 'Desafio', kw: { pt: 'desafio', en: 'challenge', es: 'reto' } },
    { id: 'pegadinha', icon: '🤡', label: 'Pegadinha', kw: { pt: 'pegadinha', en: 'prank', es: 'broma' } },
    { id: 'compilacao', icon: '🧩', label: 'Compilação / melhores momentos', kw: { pt: 'compilação melhores momentos', en: 'compilation best moments', es: 'recopilación mejores momentos' } },
    { id: 'gameplay', icon: '🎮', label: 'Gameplay / games', kw: { pt: 'gameplay', en: 'gameplay', es: 'gameplay' } },
    { id: 'animacao', icon: '🎨', label: 'Animação / desenho', kw: { pt: 'animação', en: 'animation', es: 'animación' } },
    { id: 'stickman', icon: '🧍', label: 'Stickman / bonecos de palito', kw: { pt: 'stickman animação', en: 'stickman animation', es: 'stickman animación' } },
    { id: 'satisfatorio', icon: '🫧', label: 'Satisfatório / oddly satisfying', kw: { pt: 'vídeo satisfatório', en: 'oddly satisfying', es: 'video satisfactorio' } },
    { id: 'asmr', icon: '🎧', label: 'ASMR', kw: { pt: 'asmr', en: 'asmr', es: 'asmr' } },
  ] },
  { label: 'Estilo de vida', types: [
    { id: 'vlog', icon: '📹', label: 'Vlog / rotina', kw: { pt: 'vlog rotina', en: 'vlog day in my life', es: 'vlog rutina' } },
    { id: 'receita', icon: '🍳', label: 'Receita / culinária', kw: { pt: 'receita fácil', en: 'easy recipe', es: 'receta fácil' } },
    { id: 'fitness', icon: '💪', label: 'Treino / fitness', kw: { pt: 'treino em casa', en: 'workout at home', es: 'entrenamiento en casa' } },
    { id: 'viagem', icon: '✈️', label: 'Viagem', kw: { pt: 'viagem roteiro', en: 'travel guide', es: 'viaje guía' } },
    { id: 'diy', icon: '🔨', label: 'Faça você mesmo (DIY)', kw: { pt: 'faça você mesmo', en: 'diy', es: 'hazlo tú mismo' } },
    { id: 'beleza', icon: '💄', label: 'Beleza / moda', kw: { pt: 'maquiagem moda', en: 'makeup fashion', es: 'maquillaje moda' } },
    { id: 'pets', icon: '🐶', label: 'Animais / pets', kw: { pt: 'animais', en: 'animals', es: 'animales' } },
    { id: 'natureza', icon: '🌿', label: 'Natureza / vida selvagem', kw: { pt: 'vida selvagem natureza', en: 'wildlife nature', es: 'vida salvaje naturaleza' } },
    { id: 'meditacao', icon: '🧘', label: 'Meditação / sono', kw: { pt: 'meditação para dormir', en: 'sleep meditation', es: 'meditación para dormir' } },
  ] },
  { label: 'Negócios e tecnologia', types: [
    { id: 'financas', icon: '💰', label: 'Finanças / investimentos', kw: { pt: 'finanças investimentos', en: 'personal finance investing', es: 'finanzas inversiones' } },
    { id: 'negocios', icon: '📈', label: 'Negócios / empreendedorismo', kw: { pt: 'empreendedorismo negócio', en: 'business entrepreneur', es: 'emprendimiento negocio' } },
    { id: 'renda', icon: '🤑', label: 'Renda extra / ganhar dinheiro', kw: { pt: 'como ganhar dinheiro', en: 'how to make money', es: 'cómo ganar dinero' } },
    { id: 'tecnologia', icon: '💻', label: 'Tecnologia / review', kw: { pt: 'review tecnologia', en: 'tech review', es: 'review tecnología' } },
    { id: 'unboxing', icon: '📦', label: 'Unboxing', kw: { pt: 'unboxing', en: 'unboxing', es: 'unboxing' } },
    { id: 'ia', icon: '🤖', label: 'Inteligência artificial', kw: { pt: 'inteligência artificial', en: 'artificial intelligence', es: 'inteligencia artificial' } },
    { id: 'motivacional', icon: '🔥', label: 'Motivacional / desenvolvimento', kw: { pt: 'motivação', en: 'motivation', es: 'motivación' } },
    { id: 'podcast', icon: '🎙️', label: 'Podcast / cortes', kw: { pt: 'podcast cortes', en: 'podcast clips', es: 'podcast clips' } },
  ] },
  { label: 'Música e áudio', types: [
    { id: 'lofi', icon: '🎵', label: 'Lo-fi / música para estudar', kw: { pt: 'lofi para estudar', en: 'lofi beats to study', es: 'lofi para estudiar' } },
    { id: 'musica', icon: '🎤', label: 'Clipe / música', kw: { pt: 'clipe oficial', en: 'music video', es: 'videoclip' } },
    { id: 'ambiente', icon: '🌧️', label: 'Sons ambiente / ruído', kw: { pt: 'sons para dormir', en: 'ambient sounds', es: 'sonidos para dormir' } },
    { id: 'karaoke', icon: '🎼', label: 'Letra / lyric video', kw: { pt: 'letra', en: 'lyrics', es: 'letra' } },
  ] },
  { label: 'Infantil', types: [
    { id: 'infantil', icon: '🧸', label: 'Desenho infantil', kw: { pt: 'desenho infantil', en: 'kids cartoon', es: 'dibujos animados infantiles' } },
    { id: 'educativo-kids', icon: '🔤', label: 'Educativo infantil', kw: { pt: 'educativo para crianças', en: 'educational for kids', es: 'educativo para niños' } },
  ] },
];

export const ytVideoType = (id?: string) => YT_VIDEO_TYPES.flatMap((g) => g.types).find((t) => t.id === id);
/** termo de busca do tipo no idioma (pt/en/es; os outros usam o inglês) */
export const ytTypeKeyword = (id: string | undefined, lang: string): string => {
  const t = ytVideoType(id);
  if (!t) return '';
  const l = lang.slice(0, 2);
  return l === 'pt' ? t.kw.pt : l === 'es' ? t.kw.es : t.kw.en;
};
