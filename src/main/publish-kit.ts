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

const ytTime = (sec: number) => { const s = Math.max(0, Math.floor(sec)); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const CH_LINE = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—]?\s+(.+?)\s*$/;
const parseTime = (t: string) => t.split(':').map(Number).reduce((a, x) => a * 60 + x, 0);

/**
 * Capítulos nos tempos REAIS: o modelo soma durações de cabeça e erra (até 20+ s em 15 min). Cada capítulo vai para o
 * início da primeira cena com o mesmo prefixo de título ("Link 4: …" → cena "Link 4: …") ou, sem prefixo, da cena
 * que mais compartilha palavras com ele; o 1º é sempre 0:00 e capítulos a menos de 10 s do anterior saem (regra do
 * YouTube). Sem correspondência, mantém o tempo dado. Função pura.
 */
export function alignChapters(lines: string[], scenes: Array<{ title: string; seconds: number }>): string[] {
  const starts: Array<{ title: string; at: number }> = [];
  let t = 0;
  for (const s of scenes) { starts.push({ title: s.title, at: t }); t += Math.max(0, s.seconds); }
  if (!starts.length) return lines;
  const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const key = (x: string) => (x.includes(':') ? norm(x.split(':')[0]!).replace(/\s+/g, ' ').trim() : '');
  const words = (x: string) => new Set(norm(x).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const out: string[] = [];
  let prev = -Infinity;
  for (const l of lines) {
    const m = CH_LINE.exec(l);
    if (!m) { out.push(l); continue; }
    const title = m[2]!;
    let at: number | undefined = out.length === 0 ? 0 : undefined;
    if (at === undefined && key(title)) at = starts.find((s) => s.at > prev && key(s.title) === key(title))?.at;
    if (at === undefined) {
      const tw = words(title);
      let best = 0;
      for (const s of starts) {
        if (s.at <= prev) continue;
        const sw = words(s.title), score = [...tw].filter((w) => sw.has(w)).length;
        if (score > best) { best = score; at = s.at; }
      }
      if (best < 2) at = undefined;
    }
    if (at === undefined) at = parseTime(m[1]!);
    if (out.length && at < prev + 10) continue;
    prev = at;
    out.push(`${ytTime(at)} ${title}`);
  }
  return out;
}

/** Conteúdo dos arquivos de texto da pasta (função pura). Com `scenes`, os capítulos vão para os tempos reais. */
export function publishTexts(p: Pick<Project, 'name' | 'idea' | 'aspect' | 'language'>, meta: PublishMeta, durationSec?: number, scenes?: Array<{ title: string; seconds: number }>): Record<string, string> {
  const title = meta.title?.trim() || p.name;
  const opts = (meta.titleOptions ?? []).map((o) => (typeof o === 'string' ? o : o.title ?? '')).filter((x) => x && x !== title);
  const tags = (Array.isArray(meta.tags) ? meta.tags : String(meta.tags ?? '').split(',')).map((x) => String(x).trim().replace(/^#/, '')).filter(Boolean);
  let chapters = (meta.chapters ?? []).map((c) => typeof c === 'string' ? c : `${c.time ?? (typeof c.at === 'number' ? mmss(c.at) : '')} ${c.title ?? ''}`.trim()).filter(Boolean);
  let desc = meta.description?.trim() || p.idea;
  if (scenes?.length) {
    /* capítulos da descrição (linhas "m:ss título") e da lista: os dois no tempo real */
    const descLines = desc.split(/\r?\n/), idx = descLines.map((l, i) => (CH_LINE.test(l) ? i : -1)).filter((i) => i >= 0);
    if (idx.length >= 2) {
      const fixed = alignChapters(idx.map((i) => descLines[i]!), scenes);
      const byTitle = new Map(fixed.map((l) => [CH_LINE.exec(l)![2]!, l]));
      desc = descLines.map((l, i) => (idx.includes(i) ? byTitle.get(CH_LINE.exec(l)![2]!) ?? null : l)).filter((l): l is string => l !== null).join('\n');
    }
    if (chapters.length) chapters = alignChapters(chapters, scenes);
  }
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
  /* tempos reais das cenas (ajustados à duração do vídeo final, que soma as cenas montadas) */
  const sc = (p.scenes ?? []).map((x) => ({ title: x.title, seconds: Math.max(0.5, x.durationSec ?? 4) }));
  const sum = sc.reduce((q, x) => q + x.seconds, 0), k = durationSec && sum > 0 && Math.abs(durationSec / sum - 1) < 0.05 ? durationSec / sum : 1;
  for (const [name, text] of Object.entries(publishTexts(p, meta, durationSec, sc.map((x) => ({ ...x, seconds: x.seconds * k }))))) { const f = path.join(dir, name); fs.writeFileSync(f, '﻿' + text, 'utf8'); files.push(f); }
  return { dir, video, files };
}
