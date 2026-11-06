/*
 * Carrossel de instruções ("Como funciona?"): slides com ilustração, texto e passos.
 * Usado em Skills, Rotas, Provedores e Automações.
 */
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (typeof v === 'boolean') { if (v) el.setAttribute(k, ''); }
    else el.setAttribute(k, v);
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

export interface Slide {
  icon: string;               // emoji grande da ilustração
  title: string;
  text: string;
  /** desenho simples: sequência de "caixas" ligadas por setas (ex.: fases da rota) */
  flow?: Array<{ icon: string; label: string }>;
  bullets?: string[];
}

export const CAROUSELS: Record<string, { title: string; slides: Slide[] }> = {
  skills: { title: 'Como funcionam as skills', slides: [
    { icon: '🧠', title: 'Skill = o template do seu canal', text: 'Uma skill guarda o contexto do vídeo: estilo visual, tom, ritmo e estrutura das cenas. É o mesmo conceito de "template": você define uma vez e usa em todo vídeo.',
      flow: [{ icon: '🎨', label: 'Estilo visual' }, { icon: '🎙️', label: 'Tom' }, { icon: '🧱', label: 'Estrutura' }] },
    { icon: '🎨', title: 'Aparência, formato e duração', text: 'Escolha a aparência (stickman, anime, documentário…), o formato (16:9, 9:16…), a duração e o idioma. Esses são os padrões de todo projeto criado com a skill.',
      bullets: ['A aparência define o tipo de cena padrão (código, imagem, vídeo IA, banco de mídia).', 'Final do roteiro: emendar no início (shorts), gancho para o próximo ou conclusão.'] },
    { icon: '🛣️', title: 'A rota sugerida precisa combinar', text: 'A skill aponta para a rota que produz o que ela pede. O selo mostra se combina: ✓ tudo certo, ⚠ falta alguma etapa, ⛔ rota errada (ex.: clipe musical numa rota narrada).',
      flow: [{ icon: '🧠', label: 'Skill' }, { icon: '🔗', label: 'combina?' }, { icon: '🛣️', label: 'Rota' }] },
    { icon: '✍️', title: 'Instruções por atividade', text: 'As diretrizes gerais valem para todas as etapas; as instruções por atividade (roteiro, cenas, imagem, código, narração, thumbnail, SEO) entram só no prompt daquela etapa.',
      bullets: ['Escreva o que a IA deve fazer, não como o app funciona.', 'Preencha só o que importa: o resto usa o padrão.'] },
    { icon: '▶️', title: 'Usando a skill', text: 'Em Novo projeto escolha a skill, a rota e os provedores. As skills padrão são somente leitura: altere o que quiser e use "Salvar como minha skill".',
      flow: [{ icon: '1️⃣', label: 'Crie a skill' }, { icon: '2️⃣', label: 'Escolha no projeto' }, { icon: '3️⃣', label: 'Produza no padrão' }] },
  ] },
  routes: { title: 'Como funcionam as rotas', slides: [
    { icon: '🛣️', title: 'Rota = a linha de produção', text: 'Uma rota é a sequência de tarefas que transforma a ideia em vídeo. Cada tarefa produz um arquivo (roteiro, cenas, áudio, imagem, vídeo…) e as próximas usam esse arquivo.' },
    { icon: '🧭', title: 'As quatro fases', text: 'Toda rota passa pelas mesmas fases. As tarefas "por cena" rodam uma vez para cada cena, em paralelo.',
      flow: [{ icon: '✍️', label: 'Planejar' }, { icon: '🎬', label: 'Produzir cada cena' }, { icon: '🎞️', label: 'Montar' }, { icon: '🚀', label: 'Publicar' }] },
    { icon: '🧩', title: 'Tarefa = tipo + executor', text: 'Cada tarefa tem um tipo (roteiro, imagem, narração…) e uma cadeia de executores: o primeiro é o principal, os seguintes são reservas automáticas se ele falhar.',
      flow: [{ icon: '🖥️', label: 'Principal' }, { icon: '↳', label: 'Reserva 1' }, { icon: '↳', label: 'Reserva 2' }] },
    { icon: '🔗', title: 'Dependências e filtros', text: '"Depende de" diz o que precisa estar pronto antes. "Só para cenas do tipo" faz a tarefa rodar apenas onde faz sentido (ex.: vídeo IA só em cenas de vídeo).' },
    { icon: '🎛️', title: 'Rota × provedores', text: 'A rota diz O QUE fazer; o perfil de provedores diz QUEM faz (Antigravity, Ollama, ComfyUI, APIs). Você não precisa copiar a rota para cada provedor.',
      flow: [{ icon: '🛣️', label: 'Rota' }, { icon: '＋', label: '' }, { icon: '🎛️', label: 'Provedores' }, { icon: '=', label: '' }, { icon: '🎬', label: 'Vídeo' }] },
    { icon: '💾', title: 'Salvar e usar', text: 'Rotas padrão são somente leitura: edite e use "Salvar como minha rota". Valide antes de salvar; depois escolha a rota em Novo projeto ou aplique ao projeto aberto.' },
  ] },
  providers: { title: 'Perfis de provedores', slides: [
    { icon: '🎛️', title: 'Quem executa cada parte', text: 'Um perfil escolhe o executor de cada categoria: texto, código, imagem, vídeo IA, voz e música.',
      flow: [{ icon: '✍️', label: 'Texto' }, { icon: '🧑‍💻', label: 'Código' }, { icon: '🖼️', label: 'Imagem' }, { icon: '🎬', label: 'Vídeo' }, { icon: '🎙️', label: 'Voz' }, { icon: '🎵', label: 'Música' }] },
    { icon: '🧩', title: 'Perfil não é template', text: 'A skill (template) define como o vídeo fica; a rota define as etapas; o perfil define os provedores. Os três se combinam em Novo projeto.',
      flow: [{ icon: '🧠', label: 'Skill' }, { icon: '🛣️', label: 'Rota' }, { icon: '🎛️', label: 'Perfil' }] },
    { icon: '🔒', title: 'O que o perfil não troca', text: 'Ferramentas internas (montagem, legendas), bancos de mídia e loops perfeitos do MiniMax ficam como a rota define. Os executores da rota viram reserva.' },
  ] },
  automations: { title: 'Automações', slides: [
    { icon: '👤', title: 'Contas Google (até 20)', text: 'Cada conta tem um navegador próprio, com login feito por você na página do Google. O app nunca vê nem guarda a sua senha. "💳 Créditos" lê o saldo de cada conta no Flow.' },
    { icon: '🌊', title: 'Flow no navegador do app', text: 'Abra o Google Flow com a conta escolhida e a sua extensão carregada. Os arquivos baixados caem na pasta da conta e podem ir direto para uma cena de um projeto.',
      flow: [{ icon: '👤', label: 'Conta' }, { icon: '🌊', label: 'Flow + extensão' }, { icon: '📥', label: 'Downloads' }, { icon: '🎬', label: 'Cena' }] },
    { icon: '🪐', title: 'Antigravity por conta', text: 'Cada conta pode ter a própria sessão do Antigravity CLI. Escolha qual conta as rotas usam; a troca é manual e respeita os limites de cada conta.' },
    { icon: '💬', title: 'SRT de um áudio', text: 'Escolha um áudio ou vídeo, o Whisper transcreve com tempo por palavra e o app monta legendas .srt prontas (tamanho de linha e duração ajustáveis).' },
  ] },
};

/** Abre o carrossel. */
export function openCarousel(id: keyof typeof CAROUSELS | string) {
  const c = CAROUSELS[id]; if (!c) return;
  let i = 0;
  const stage = h('div', { class: 'car-stage' });
  const dots = h('div', { class: 'car-dots' });
  const prev = h('button', { class: 'car-prev', onclick: () => go(i - 1) }, '← Anterior');
  const next = h('button', { class: 'primary car-next', onclick: () => (i < c.slides.length - 1 ? go(i + 1) : close()) }, 'Próximo →');
  const go = (n: number) => {
    i = Math.max(0, Math.min(c.slides.length - 1, n));
    const s = c.slides[i]!;
    stage.replaceChildren(
      h('div', { class: 'car-art' }, h('span', { class: 'car-icon' }, s.icon),
        s.flow ? h('div', { class: 'car-flow' }, ...s.flow.flatMap((f, k) => [k ? h('span', { class: 'car-arrow' }, '→') : null, h('div', { class: 'car-box' }, h('span', {}, f.icon), f.label ? h('small', {}, f.label) : null)])) : null),
      h('div', { class: 'car-text' }, h('div', { class: 'muted' }, `${i + 1} de ${c.slides.length}`), h('h3', {}, s.title), h('p', {}, s.text),
        s.bullets ? h('ul', {}, ...s.bullets.map((b) => h('li', {}, b))) : null));
    dots.replaceChildren(...c.slides.map((_, k) => h('button', { class: `car-dot${k === i ? ' on' : ''}`, title: `Slide ${k + 1}`, onclick: () => go(k) })));
    prev.toggleAttribute('disabled', i === 0);
    next.textContent = i === c.slides.length - 1 ? 'Entendi ✓' : 'Próximo →';
  };
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); };
  const bg = h('div', { class: 'modal-bg', id: `carousel-${id}`, onclick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal carousel' },
      h('div', { class: 'row' }, h('h3', {}, c.title), h('span', { class: 'sp' }), h('button', { onclick: close, title: 'Fechar (Esc)' }, '✕')),
      stage, h('div', { class: 'row car-nav' }, prev, dots, next)));
  document.addEventListener('keydown', onKey);
  document.body.append(bg);
  go(0);
}

/** Botão "Como funciona?" para o cabeçalho das abas. */
export const helpButton = (id: string, label = '❔ Como funciona?') =>
  h('button', { class: 'helpbtn', 'data-help': id, onclick: () => openCarousel(id) }, label);
