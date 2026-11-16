import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';

/*
 * forge-file:// com Range (HTTP 206). O net.fetch(file://) do Electron ignora o cabeçalho Range e devolve 200 sem
 * Accept-Ranges: o <video> fica sem trechos pesquisáveis (seekable vazio) e clicar na barra volta o vídeo a 0
 * ("Ver final" do editor não deixava escolher o ponto). Aqui o arquivo é servido com Range, tamanho e tipo.
 */

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.pdf': 'application/pdf', '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt',
};
export const mimeOf = (file: string) => TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/** "bytes=a-b" | "bytes=a-" | "bytes=-n" → intervalo inclusivo; undefined = inválido/fora do arquivo (função pura). */
export function parseRange(header: string | null | undefined, size: number): { start: number; end: number } | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m || (!m[1] && !m[2]) || size <= 0) return undefined;
  let start: number, end: number;
  if (!m[1]) { const n = Number(m[2]); if (!n) return undefined; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return undefined;
  return { start, end };
}

/** Resposta do arquivo: 206 com Content-Range quando pedem um trecho, senão 200 com Accept-Ranges. */
export function fileResponse(file: string, rangeHeader?: string | null): Response {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return new Response('not found', { status: 404 }); }
  if (!st.isFile()) return new Response('not found', { status: 404 });
  const size = st.size;
  const base = { 'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Last-Modified': st.mtime.toUTCString() };
  const stream = (start: number, end: number) => Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream;
  if (rangeHeader) {
    const r = parseRange(rangeHeader, size);
    if (!r) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    return new Response(stream(r.start, r.end), { status: 206, headers: { ...base, 'Content-Range': `bytes ${r.start}-${r.end}/${size}`, 'Content-Length': String(r.end - r.start + 1) } });
  }
  return new Response(size ? stream(0, size - 1) : null, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
}
