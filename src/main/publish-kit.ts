import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project } from '../shared/types';

/*
 * Pasta "publicar" do vídeo: tudo pronto para subir no YouTube/TikTok/Instagram sem abrir JSON —
 *   <Título sugestivo>.mp4 · <Título> - thumbnail.png · titulo.txt (título + alternativas) · descricao.txt ·
 *   tags.txt · capitulos.txt · legendas.srt · LEIA-ME.txt (resumo do vídeo e onde usar cada arquivo).
 * Gerada no fim de cada execução que termina com o final.mp4 (e pelo botão "📦 Publicar" do editor).
 */

export interface PublishMeta {
  title?: string; titleOptions?: Array<string | { title?: string; type?: string }>; description?: string;
  tags?: string[] | string; chapters?: Array<string | { time?: string; at?: number; title?: string }>; hashtags?: string[]; thumbnailText?: string;
}

/** Nome de arquivo do Windows a partir do título (sem \ / : * ? " < > |, sem ponto final, até 120 caracteres). */
export function safeFileName(t: string): string {
  const s = t.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  const cut = s.length > 120 ? s.slice(0, 120).replace(/\s+\S*$/, '') : s;
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cut) || !cut ? 'video' : cut;
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Conteúdo dos arquivos de texto da pasta (função pura). */
export function publishTexts(p: Pick<Project, 'name' | 'idea' | 'aspect' | 'language'>, meta: PublishMeta, durationSec?: number): Record<string, string> {
  const title = meta.title?.trim() || p.name;
  const opts = (meta.titleOptions ?? []).map((o) => (typeof o === 'string' ? o : o.title ?? '')).filter((x) => x && x !== title);
  const tags = (Array.isArray(meta.tags) ? meta.tags : String(meta.tags ?? '').split(',')).map((x) => String(x).trim().replace(/^#/, '')).filter(Boolean);
  const chapters = (meta.chapters ?? []).map((c) => typeof c === 'string' ? c : `${c.time ?? (typeof c.at === 'number' ? mmss(c.at) : '')} ${c.title ?? ''}`.trim()).filter(Boolean);
  let desc = meta.description?.trim() || p.idea;
  /* capítulos que ainda não estão na descrição entram no fim (o YouTube cria os capítulos a partir dela) */
  if (chapters.length && !/^\s*0?0:00\b/m.test(desc)) desc += `\n\nCapítulos:\n${chapters.join('\n')}`;
  if (meta.hashtags?.length && !/#\w/.test(desc)) desc += `\n\n${meta.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}`;
  const out: Record<string, string> = {
    'titulo.txt': [title, ...(opts.length ? ['', 'Alternativas:', ...opts.map((o) => `- ${o}`)] : [])].join('\r\n') + '\r\n',
    'descricao.txt': desc.replace(/\r?\n/g, '\r\n') + '\r\n',
  };
  if (tags.length) out['tags.txt'] = tags.join(', ') + '\r\n';
  if (chapters.length) out['capitulos.txt'] = chapters.join('\r\n') + '\r\n';
  out['LEIA-ME.txt'] = [
    `${title}`,
    '',
    `Formato: ${p.aspect ?? '16:9'}${durationSec ? ` · duração ${mmss(durationSec)}` : ''}${p.language ? ` · idioma ${p.language}` : ''}`,
    meta.thumbnailText ? `Texto da thumbnail: ${meta.thumbnailText}` : '',
    '',
    'Arquivos desta pasta:',
    '- o .mp4 com o título é o vídeo final;',
    '- "- thumbnail.png" é a capa;',
    '- titulo.txt: título principal (1ª linha) e alternativas para teste A/B;',
    '- descricao.txt: cole na descrição (já tem os capítulos);',
    tags.length ? '- tags.txt: cole no campo de tags (separadas por vírgula);' : '',
    chapters.length ? '- capitulos.txt: os capítulos com os tempos;' : '',
    '- legendas.srt (se houver): envie como legenda do vídeo.',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\r\n') + '\r\n';
  return out;
}

/** Monta (ou atualiza) out/publicar. Devolve a pasta, ou undefined se ainda não existe final.mp4. */
export function writePublishKit(projectDir: string, p: Project, durationSec?: number): { dir: string; video: string; files: string[] } | undefined {
  const out = path.join(projectDir, 'out'), final = path.join(out, 'final.mp4');
  if (!fs.existsSync(final)) return undefined;
  let meta: PublishMeta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(out, 'metadata.json'), 'utf8')) as PublishMeta; } catch { /* sem SEO: usa o nome e a ideia */ }
  const title = meta.title?.trim() || p.name;
  const base = safeFileName(title), dir = path.join(out, 'publicar');
  /* recria a pasta: um título novo não deixa o vídeo antigo com outro nome para trás */
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const video = path.join(dir, `${base}.mp4`);
  try { fs.linkSync(final, video); } catch { fs.copyFileSync(final, video); }   // hard link: sem ocupar o dobro do disco
  files.push(video);
  const thumb = ['thumbnail.png', 'thumbnail.jpg', 'thumbnail.webp'].map((f) => path.join(out, f)).find((f) => fs.existsSync(f));
  if (thumb) { const t = path.join(dir, `${base} - thumbnail${path.extname(thumb)}`); fs.copyFileSync(thumb, t); files.push(t); }
  const srt = path.join(out, 'subtitles.srt');
  if (fs.existsSync(srt)) { const t = path.join(dir, 'legendas.srt'); fs.copyFileSync(srt, t); files.push(t); }
  for (const [name, text] of Object.entries(publishTexts(p, meta, durationSec))) { const f = path.join(dir, name); fs.writeFileSync(f, '﻿' + text, 'utf8'); files.push(f); }
  return { dir, video, files };
}
