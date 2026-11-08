/**
 * Painéis ajustáveis do editor: medidas válidas para o tamanho atual (função pura).
 * Prévia: 260 px até (largura − 300 px), para o painel lateral não sumir; área de cima: 200 px até (altura − 140 px),
 * para a timeline continuar visível. 0/ausente = padrão do CSS.
 */
export function clampEdLayout(left: number, top: number, box: { width: number; height: number }): { left?: number; top?: number } {
  const l = left > 0 && box.width > 560 ? Math.round(Math.max(260, Math.min(box.width - 300, left))) : undefined;
  const t = top > 0 && box.height > 340 ? Math.round(Math.max(200, Math.min(box.height - 140, top))) : undefined;
  return { left: l, top: t };
}

/** "Prévia grande": ≈ 70% da largura para a prévia e a timeline enxuta (≈ 230 px para barra + ferramentas + trilhas). */
export const bigPreview = (box: { width: number; height: number }) => clampEdLayout(box.width * 0.7, box.height - 230, box);
