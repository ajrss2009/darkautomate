/**
 * Faixa de bytes pedida ("bytes=0-", "bytes=100-199", "bytes=-500") → [início, fim] inclusivo, ou undefined
 * quando não há pedido parcial válido. Função pura (usada pelo protocolo forge-scene:// para o <video> ser navegável).
 */
export function parseRange(header: string | null | undefined, size: number): [number, number] | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || size <= 0 || (!m[1] && !m[2])) return undefined;
  let start: number, end: number;
  if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(size - 1, Number(m[2])) : size - 1; }
  return start <= end && start < size ? [start, end] : undefined;
}
