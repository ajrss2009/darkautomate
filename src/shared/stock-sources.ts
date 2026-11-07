import type { StockSource } from './types';

/** Bancos de imagens e vídeos: o que cada um oferece, se precisa de chave e a licença típica. */
export interface StockSourceInfo {
  id: StockSource; label: string; icon: string; media: Array<'image' | 'video'>;
  key: 'obrigatória' | 'opcional' | 'não';
  keyUrl?: string; license: string; about: string; site: string;
}

export const STOCK_SOURCES: StockSourceInfo[] = [
  { id: 'pexels', label: 'Pexels', icon: '📷', media: ['image', 'video'], key: 'obrigatória', keyUrl: 'https://www.pexels.com/api/', license: 'Pexels License (uso livre, sem atribuição obrigatória)', about: 'Fotos e vídeos de estoque de alta qualidade.', site: 'https://www.pexels.com' },
  { id: 'pixabay', label: 'Pixabay', icon: '🌄', media: ['image', 'video'], key: 'obrigatória', keyUrl: 'https://pixabay.com/api/docs/', license: 'Pixabay Content License (uso livre)', about: 'Fotos, ilustrações e vídeos de estoque.', site: 'https://pixabay.com' },
  { id: 'unsplash', label: 'Unsplash', icon: '🖼️', media: ['image'], key: 'obrigatória', keyUrl: 'https://unsplash.com/developers', license: 'Unsplash License (uso livre)', about: 'Fotografia artística e editorial.', site: 'https://unsplash.com' },
  { id: 'wikipedia', label: 'Wikimedia Commons', icon: '📚', media: ['image', 'video'], key: 'não', license: 'CC / domínio público (varia por arquivo — créditos no stock.json)', about: 'Acervo da Wikipédia: fotos históricas, mapas, diagramas e vídeos (.webm).', site: 'https://commons.wikimedia.org' },
  { id: 'nasa', label: 'NASA', icon: '🚀', media: ['image', 'video'], key: 'não', license: 'Em geral domínio público (NASA Media Usage Guidelines)', about: 'Espaço, foguetes, Terra vista do espaço, missões e astronautas.', site: 'https://images.nasa.gov' },
  { id: 'archive', label: 'Internet Archive', icon: '🏛️', media: ['image', 'video'], key: 'não', license: 'Domínio público / Creative Commons (filtrado pela licença declarada)', about: 'Filmes antigos, cinejornais, documentários e coleções históricas.', site: 'https://archive.org' },
  { id: 'openverse', label: 'Openverse', icon: '🔓', media: ['image'], key: 'não', license: 'Creative Commons / domínio público (só licenças de uso comercial)', about: 'Busca em mais de 800 milhões de imagens abertas (Flickr, museus, Wikimedia…).', site: 'https://openverse.org' },
  { id: 'smithsonian', label: 'Smithsonian Open Access', icon: '🦕', media: ['image'], key: 'opcional', keyUrl: 'https://api.data.gov/signup/', license: 'CC0 (só itens com acesso CC0)', about: 'Museus Smithsonian: natureza, ciência, história, arte. Sem chave usa a DEMO_KEY (limite baixo).', site: 'https://www.si.edu/openaccess' },
  { id: 'youtube', label: 'YouTube', icon: '▶️', media: ['video'], key: 'opcional', keyUrl: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', license: 'Confira a licença de cada vídeo antes de publicar (ou use "Só Creative Commons")', about: 'Trechos curtos (2–4 s) de vídeos, checados visualmente. A chave (opcional) da YouTube Data API deixa a aba "Obter vídeos" mais rápida e completa.', site: 'https://www.youtube.com' },
];

export const stockInfo = (id: string) => STOCK_SOURCES.find((x) => x.id === id);

/**
 * Temas que pedem acervos específicos, com as fontes que vão para a frente da busca (na ordem). Ex.: imagens antigas →
 * Internet Archive primeiro (cinejornais, filmes e fotos de época), depois Wikimedia, Smithsonian e Openverse.
 */
export const STOCK_THEMES: Array<{ id: string; label: string; re: RegExp; first: StockSource[] }> = [
  { id: 'antigo', label: 'imagens antigas / históricas',
    re: /(?<![\p{L}\d])(antig[oa]s?|hist[óo]ric[oa]s?|hist[óo]ria|[ée]poca|vintage|retr[ôo]|historic(al)?|archival?|newsreel|cinejorna(l|is)|preto e branco|black and white|sépia|sepia|guerra mundial|world war|ww(1|2|i|ii)\b|segunda guerra|primeira guerra|guerra fria|cold war|imp[ée]rio|empire|colonial|medieva(l|is)|idade m[ée]dia|middle ages|renascen[çc]a|renaissance|vitorian[oa]|victorian|revolu[çc][ãa]o industrial|industrial revolution|s[ée]culo (xv|xvi|xvii|xviii|xix|xx)\b|(1[0-8]|19[0-7])\d(s|'s)?\b|d[ée]cada de (19)?[2-7]0|anos (19)?[2-7]0\b|19[2-7]0s|roaring twenties|great depression|grande depress[ãa]o|era de ouro|golden age)(?![\p{L}\d])/iu,
    first: ['archive', 'wikipedia', 'smithsonian', 'openverse'] },
  { id: 'espaco', label: 'espaço / astronomia',
    re: /(?<![\p{L}\d])(espa[çc]o sideral|universo|gal[áa]xias?|galax(y|ies)|planetas?|planets?|astronaut[ae]s?|astronauts?|foguetes?|rockets?|nasa|apollo|lua|moon|marte|mars|j[úu]piter|jupiter|saturno|saturn|nebulosas?|nebula|buracos? negros?|black holes?|sat[ée]lites?|satellites?|esta[çc][ãa]o espacial|space station|telesc[óo]pio|telescope|hubble|webb|cosmos|cosmic|c[óo]smic[oa]|sistema solar|solar system|outer space|in space|no espa[çc]o)(?![\p{L}\d])/iu,
    first: ['nasa', 'wikipedia', 'archive', 'smithsonian'] },
  { id: 'museu', label: 'natureza, ciência e museus',
    re: /(?<![\p{L}\d])(dinossauros?|dinosaurs?|f[óo]sseis|f[óo]ssil|fossils?|museus?|museums?|esp[ée]cies|species|bot[âa]nica|botany|zoologia|zoology|minerais|minerals?|meteoritos?|meteorites?|artefatos?|artifacts?|arqueologia|archaeology|antropologia|anthropology|obras? de arte|artworks?|pinturas?|paintings?|esculturas?|sculptures?|entomologia|insetos? raros|smithsonian)(?![\p{L}\d])/iu,
    first: ['smithsonian', 'wikipedia', 'openverse', 'archive'] },
  { id: 'enciclopedia', label: 'mapas, lugares e personalidades',
    re: /(?<![\p{L}\d])(mapas?|maps?|bandeiras?|flags?|biografia|biography|retratos?|portraits?|monumentos?|monuments?|cidades? hist[óo]ricas?|rei|rainha|king|queen|imperador|emperor|cientistas?|scientists?|inventor|fil[óo]sofos?|philosophers?|diagramas?|diagrams?)(?![\p{L}\d])/iu,
    first: ['wikipedia', 'openverse', 'archive', 'smithsonian'] },
];

/**
 * Ordem de busca para uma cena: o tema do TEXTO DA CENA (fala, intenção visual, termos) decide; sem tema na cena, vale o
 * tema do projeto (ideia/nome). Só reordena as fontes habilitadas (não adiciona nenhuma); sem tema, mantém a ordem dada.
 */
export function orderStockSources(sources: StockSource[], scene: string, project = ''): { sources: StockSource[]; theme?: string } {
  const theme = STOCK_THEMES.find((t) => t.re.test(scene)) ?? STOCK_THEMES.find((t) => t.re.test(project));
  if (!theme) return { sources: [...sources] };
  const front = theme.first.filter((x) => sources.includes(x));
  return { sources: [...front, ...sources.filter((x) => !front.includes(x))], theme: theme.label };
}
