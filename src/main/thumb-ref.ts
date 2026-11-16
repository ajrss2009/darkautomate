import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, Settings } from '../shared/types';
import { measurePalette } from './style-ref';

/*
 * THUMBNAIL DE REFERÊNCIA DO PROJETO (Novo projeto → 🏷 Título e thumbnail → "Referência"):
 *  - uma imagem do usuário, ou o link de um vídeo (YouTube: a thumbnail maxres/hq do vídeo; outras páginas: og:image);
 *  - a imagem é copiada para assets/user/thumb-reference.<ext>, a paleta é MEDIDA nos pixels e o projeto guarda
 *    project.thumbRef; o prompt da thumbnail manda seguir a composição/estilo dela (sem copiar texto, logo ou rosto).
 * Prioridade da thumbnail: referência do projeto > modelo escolhido > modelo do canal > modelo da skill.
 */

export const youtubeId = (u: string) => /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(u)?.[1];
const isImageUrl = (u: string) => /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(u);

/** Candidatos de imagem para um link (função pura): YouTube → thumbnails do vídeo; imagem direta → ela mesma. */
export function thumbCandidates(url: string): string[] {
  const u = url.trim();
  const id = youtubeId(u);
  if (id) return [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/sddefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`];
  if (isImageUrl(u)) return [u];
  return [];
}

/** og:image / twitter:image de uma página HTML (função pura). */
export function ogImage(html: string): string | undefined {
  const m = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i.exec(html)
    ?? /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(html);
  return m?.[1]?.replace(/&amp;/g, '&');
}

async function download(url: string, file: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: signal ?? AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Mozilla/5.0 FilmForge' } });
    if (!r.ok || !/^image\//i.test(r.headers.get('content-type') ?? 'image/')) return false;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length < 1500) return false;                 // i.ytimg devolve um placeholder minúsculo quando não há maxres
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, b);
    return true;
  } catch { return false; }
}

/** Copia/baixa a referência para o projeto, mede a paleta e grava project.thumbRef + o anexo de referência. */
export async function prepareThumbRef(s: Settings, p: Project, projectDir: string, ref: { file?: string; url?: string; note?: string }, signal?: AbortSignal): Promise<Project['thumbRef'] | undefined> {
  const ud = path.join(projectDir, 'assets', 'user');
  let dest: string | undefined;
  let source = '';
  if (ref.file?.trim()) {
    const f = ref.file.trim();
    if (!fs.existsSync(f)) throw new Error(`imagem de referência da thumbnail não encontrada: ${f}`);
    dest = path.join(ud, `thumb-reference${path.extname(f).toLowerCase() || '.jpg'}`);
    fs.mkdirSync(ud, { recursive: true });
    fs.copyFileSync(f, dest);
    source = path.basename(f);
  } else if (ref.url?.trim()) {
    const url = ref.url.trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('o link da thumbnail de referência precisa começar com http(s)://');
    let cands = thumbCandidates(url);
    if (!cands.length) {
      try {
        const r = await fetch(url, { signal: signal ?? AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Mozilla/5.0 FilmForge' } });
        const og = r.ok ? ogImage(await r.text()) : undefined;
        if (og) cands = [new URL(og, url).toString()];
      } catch { /* página fora do ar */ }
    }
    const out = path.join(ud, 'thumb-reference.jpg');
    for (const c of cands) if (await download(c, out, signal)) { dest = out; break; }
    if (!dest) throw new Error(`não consegui baixar a thumbnail de ${url} (use um link de vídeo do YouTube, de uma imagem ou de uma página com og:image)`);
    source = url;
  }
  if (!dest) return undefined;
  let palette: string[] = [];
  try { palette = await measurePalette(s.ffmpeg, dest, 5); } catch { /* sem ffmpeg: segue sem paleta medida */ }
  const rel = path.relative(ud, dest).split(path.sep).join('/');
  const note = ref.note?.trim().slice(0, 300) || undefined;
  p.thumbRef = { file: dest, source, palette: palette.length ? palette : undefined, note };
  p.attachments = [...(p.attachments ?? []).filter((a) => a.file !== rel), { file: rel, kind: 'image', use: 'reference',
    note: `Thumbnail de REFERÊNCIA (${source}): siga a composição, o enquadramento, a posição/tamanho do texto, o contraste e a paleta${palette.length ? ` (${palette.join(', ')})` : ''} — sem copiar texto, logo, marca ou rosto real.${note ? ` ${note}` : ''}` }];
  return p.thumbRef;
}

/** Trecho do prompt da thumbnail (inglês, para os modelos de imagem) a partir da referência e do canal. */
export function thumbRefPrompt(p: Pick<Project, 'thumbRef'>): string {
  const r = p.thumbRef;
  if (!r) return '';
  return `. FOLLOW THE REFERENCE THUMBNAIL (${path.basename(r.file)}): same composition, framing, focal point position, text size and placement, contrast and lighting${r.palette?.length ? `, palette ${r.palette.join(' ')}` : ''}; new subject about this video — do NOT copy its text, logos, brands or real faces${r.note ? `. ${r.note}` : ''}`;
}
