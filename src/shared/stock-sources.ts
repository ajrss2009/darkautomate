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
