import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Attachment, AttachmentKind, Project, Scene, Settings } from '../shared/types';
import { transcribe, wordsDigest } from './whisper';
import { ensureWhisper } from './whisper-install';
import * as ff from './ffmpeg';

/**
 * Arquivos do usuário anexados ao projeto (imagens, vídeos, áudios, textos ou uma pasta inteira).
 * Ficam copiados em <projeto>/assets/user, entram no prompt das etapas de texto/código e são usados na produção:
 * - imagem/vídeo com uso "cena": o plano de cenas marca "userMedia" e a cena usa o arquivo no lugar do gerado
 *   (imagem → quadro da cena, que ainda pode ser animado pelo vídeo IA; vídeo → clipe da cena);
 * - áudio com uso "trilha": vira a trilha sonora;
 * - imagem com uso "personagem": vira o retrato do personagem (referência do MiniMax H3);
 * - textos: o conteúdo entra no prompt do roteiro, do plano e da bíblia.
 */

const EXT: Record<Exclude<AttachmentKind, 'other'>, RegExp> = {
  image: /\.(png|jpe?g|webp|gif|bmp)$/i,
  video: /\.(mp4|mov|webm|mkv|avi|m4v)$/i,
  audio: /\.(mp3|wav|m4a|ogg|flac|aac|opus)$/i,
  text: /\.(txt|md|markdown|srt|vtt|csv|json)$/i,
};
export function attachKind(file: string): AttachmentKind {
  return (Object.keys(EXT) as Array<keyof typeof EXT>).find((k) => EXT[k].test(file)) ?? 'other';
}
export const userDir = (projectDir: string) => path.join(projectDir, 'assets', 'user');
export const attachmentPath = (projectDir: string, a: Pick<Attachment, 'file'>) => path.join(userDir(projectDir), a.file);

const MAX_FILES = 300;
function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || out.length >= MAX_FILES) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || out.length >= MAX_FILES) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out, depth + 1);
    else if (e.isFile()) out.push(f);
  }
  return out;
}
function freeName(dir: string, rel: string): string {
  let r = rel, i = 2;
  while (fs.existsSync(path.join(dir, r))) { const ext = path.extname(rel); r = `${rel.slice(0, rel.length - ext.length)}-${i++}${ext}`; }
  return r;
}

/** Copia arquivos e pastas para assets/user e registra no projeto. Devolve os anexos novos. */
export function addAttachments(p: Project, projectDir: string, sources: string[]): Attachment[] {
  const dir = userDir(projectDir);
  const list = [...(p.attachments ?? [])];
  const added: Attachment[] = [];
  const items: Array<{ src: string; rel: string }> = [];
  for (const src of sources) {
    if (!src || !fs.existsSync(src)) throw new Error(`arquivo não encontrado: ${src}`);
    if (fs.statSync(src).isDirectory()) {
      const base = path.basename(src);
      for (const f of walk(src)) items.push({ src: f, rel: path.join(base, path.relative(src, f)) });
    } else items.push({ src, rel: path.basename(src) });
  }
  for (const it of items.slice(0, MAX_FILES)) {
    const rel = freeName(dir, it.rel.replace(/\\/g, '/'));
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(it.src, path.join(dir, rel));
    const kind = attachKind(rel);
    const hasMusic = list.some((a) => a.use === 'music');
    const a: Attachment = { file: rel, kind, use: kind === 'image' || kind === 'video' ? 'scene' : kind === 'audio' && !hasMusic ? 'music' : 'reference' };
    list.push(a); added.push(a);
  }
  if (list.length) p.attachments = list;
  return added;
}

export function removeAttachment(p: Project, projectDir: string, file: string): void {
  const a = p.attachments?.find((x) => x.file === file);
  if (!a) return;
  try { fs.rmSync(attachmentPath(projectDir, a), { force: true }); } catch { /* já não existe */ }
  p.attachments = p.attachments!.filter((x) => x !== a);
  if (!p.attachments.length) delete p.attachments;
  for (const s of p.scenes) if (s.userMedia === file) delete s.userMedia;
}

export function updateAttachment(p: Project, file: string, patch: Partial<Pick<Attachment, 'use' | 'note' | 'character'>>): Attachment {
  const a = p.attachments?.find((x) => x.file === file);
  if (!a) throw new Error(`anexo não encontrado: ${file}`);
  if (patch.use && ['scene', 'reference', 'music', 'character'].includes(patch.use)) a.use = patch.use;
  if ('note' in patch) { const n = String(patch.note ?? '').trim().slice(0, 500); if (n) a.note = n; else delete a.note; }
  if ('character' in patch) { const n = String(patch.character ?? '').trim().slice(0, 60); if (n) a.character = n; else delete a.character; }
  if (a.use !== 'character') delete a.character;
  /* trilha: só uma */
  if (a.use === 'music') for (const x of p.attachments!) if (x !== a && x.use === 'music') x.use = 'reference';
  return a;
}

/** Arquivo do usuário marcado para a cena (só se existir e for imagem/vídeo). */
export function sceneUserMedia(p: Project, projectDir: string, scene: Pick<Scene, 'userMedia'> | undefined): { file: string; kind: 'image' | 'video' } | undefined {
  if (!scene?.userMedia) return undefined;
  const a = p.attachments?.find((x) => x.file === scene.userMedia || path.basename(x.file) === scene.userMedia);
  const file = a ? attachmentPath(projectDir, a) : undefined;
  const kind = a && (a.kind === 'image' || a.kind === 'video') ? a.kind : undefined;
  return file && kind && fs.existsSync(file) ? { file, kind } : undefined;
}

export function musicAttachment(p: Project, projectDir: string): string | undefined {
  const a = p.attachments?.find((x) => x.use === 'music' && x.kind === 'audio');
  const f = a && attachmentPath(projectDir, a);
  return f && fs.existsSync(f) ? f : undefined;
}

const norm = (s: string) => s.trim().toLowerCase();
export function characterPhoto(p: Project, projectDir: string, name: string): string | undefined {
  const a = p.attachments?.find((x) => x.use === 'character' && x.kind === 'image' && x.character && norm(x.character) === norm(name));
  const f = a && attachmentPath(projectDir, a);
  return f && fs.existsSync(f) ? f : undefined;
}

const PLAN_KINDS = new Set(['brief', 'script', 'scene_plan', 'asset_design', 'ideation', 'metadata', 'review']);
const CODE_KINDS = new Set(['code_scene', 'motion_graphics', 'free']);
const KIND_LABEL: Record<AttachmentKind, string> = { image: 'imagem', video: 'vídeo', audio: 'áudio', text: 'texto', other: 'arquivo' };
const USE_LABEL: Record<Attachment['use'], string> = { scene: 'usar numa cena', reference: 'referência', music: 'trilha sonora', character: 'foto de personagem' };

/* ───────── transcrição dos vídeos/áudios anexados (base para a narração e para os trechos) ───────── */

export const transcriptsDir = (projectDir: string) => path.join(userDir(projectDir), 'transcripts');
export const sheetsDir = (projectDir: string) => path.join(userDir(projectDir), 'sheets');
const transcriptBase = (a: Pick<Attachment, 'file'>) => path.basename(a.file).replace(/\.[^.]+$/, '');
/** Caminho do resumo transcrito (com tempos) do anexo, se já existe. */
export function attachmentTranscript(projectDir: string, a: Pick<Attachment, 'file'>): string | undefined {
  const f = path.join(transcriptsDir(projectDir), `${transcriptBase(a)}.txt`);
  return fs.existsSync(f) ? f : undefined;
}

/** Folhas de quadros (1 quadro a cada 30 s, 4×3) do vídeo anexado: o que aparece em cada momento. */
export interface AttachmentSheet { file: string; from: number; to: number }
export function attachmentSheets(projectDir: string, a: Pick<Attachment, 'file'>): AttachmentSheet[] {
  try { return JSON.parse(fs.readFileSync(path.join(sheetsDir(projectDir), `${transcriptBase(a)}.json`), 'utf8')) as AttachmentSheet[]; } catch { return []; }
}

/** Extrai a folha de quadros do vídeo (1 quadro a cada 30 s, 12 por folha, em ordem). */
async function buildSheets(ffmpeg: string, file: string, projectDir: string, a: Pick<Attachment, 'file'>, log?: (l: string) => void): Promise<void> {
  const base = transcriptBase(a);
  const dir = sheetsDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  try {
    await ff.run(ffmpeg, ['-y', '-i', file, '-vf', 'fps=1/10,scale=320:-2,tile=4x3:padding=4:color=black', '-q:v', '4', path.join(dir, `${base}-%02d.jpg`)]);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}-`) && /\.jpg$/i.test(f)).sort();
    const sheets: AttachmentSheet[] = files.map((f, i) => ({ file: f, from: i * 12 * 10, to: (i + 1) * 12 * 10 }));
    if (sheets.length) {
      fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify(sheets, null, 1), 'utf8');
      log?.(`anexo "${a.file}": ${sheets.length} folha(s) de quadros (1 a cada 10 s)`);
    }
  } catch (e) { log?.(`aviso: sem folhas de quadros de "${a.file}" (${(e as Error).message.slice(0, 120)})`); }
}

/**
 * Transcreve (uma vez) os vídeos e áudios anexados ao projeto e grava um resumo com tempos em
 * assets/user/transcripts. O roteiro passa a saber o que os vídeos dizem e o plano de cenas
 * consegue escolher o trecho (clipStart) de cada demonstração.
 */
export async function ensureAttachmentTranscripts(o: {
  settings: Settings; project: Project; projectDir: string; toolsDir: string;
  signal?: AbortSignal; log?: (line: string) => void;
}): Promise<number> {
  /* web/ = captura do link (sem som; já tem prints e os instantes das seções em web/pagina.md) */
  const list = (o.project.attachments ?? []).filter((a) => (a.kind === 'video' || a.kind === 'audio') && !a.file.startsWith('web/') && fs.existsSync(attachmentPath(o.projectDir, a)));
  let done = 0;
  for (const a of list) {
    const file = attachmentPath(o.projectDir, a);
    /* folhas de quadros: o roteiro e o plano precisam SABER o que aparece no vídeo para casar a narração */
    if (a.kind === 'video' && !attachmentSheets(o.projectDir, a).length) {
      await buildSheets(o.settings.ffmpeg || 'ffmpeg', file, o.projectDir, a, o.log);
    }
    if (attachmentTranscript(o.projectDir, a)) continue;
    const dir = transcriptsDir(o.projectDir);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${transcriptBase(a)}.words.json`);
    const script = path.join(o.toolsDir, 'whisper_words.py');
    let cfg = o.settings.whisper ?? { python: 'python', model: 'small', device: 'auto' };
    const ac = o.signal ?? new AbortController().signal;
    try {
      o.log?.(`transcrevendo o anexo "${a.file}" (base para a narração e para os trechos)…`);
      let w;
      try { w = await transcribe(cfg, script, file, out, undefined, ac); }
      catch (e) {
        if (cfg.autoInstall === false || !/faster-whisper|No module|ModuleNotFound|não foi possível executar|ENOENT|python/i.test((e as Error).message)) throw e;
        o.log?.('instalando o Whisper para transcrever os anexos…');
        const inst = await ensureWhisper(o.settings, { log: o.log, signal: o.signal });
        cfg = { ...cfg, python: inst.python, device: 'cpu' };
        w = await transcribe(cfg, script, file, out, undefined, ac);
      }
      fs.writeFileSync(path.join(dir, `${transcriptBase(a)}.txt`), wordsDigest(w, 140), 'utf8');
      o.log?.(`anexo "${a.file}": transcrição com ${w.words.length} palavras`);
      done++;
    } catch (e) {
      o.log?.(`aviso: sem transcrição de "${a.file}" (${(e as Error).message.slice(0, 140)})`);
    }
  }
  return done;
}

function excerpt(file: string, max: number): string {
  try { const t = fs.readFileSync(file, 'utf8').trim(); return t.length > max ? `${t.slice(0, max)}\n[…]` : t; } catch { return ''; }
}

/** Bloco do prompt com os arquivos do usuário (o que cada etapa precisa saber). */
export function attachmentsText(p: Project, projectDir: string, kind: string, scene?: Pick<Scene, 'userMedia'>, pageDir?: string): string {
  const list = (p.attachments ?? []).filter((a) => fs.existsSync(attachmentPath(projectDir, a)));
  if (!list.length || (!PLAN_KINDS.has(kind) && !CODE_KINDS.has(kind))) return '';
  const line = (a: Attachment) => `- [${KIND_LABEL[a.kind]}] "${a.file}" (${USE_LABEL[a.use]}${a.character ? `: ${a.character}` : ''}) — ${attachmentPath(projectDir, a)}${a.note ? `\n  Nota do usuário: ${a.note}` : ''}`;
  const out = [`ARQUIVOS DO USUÁRIO (anexados ao projeto — eles fazem parte do pedido, use-os):\n${list.map(line).join('\n')}`];
  if (PLAN_KINDS.has(kind)) {
    let budget = 8000;
    for (const a of list.filter((x) => x.kind === 'text')) {
      if (budget <= 200) break;
      const t = excerpt(attachmentPath(projectDir, a), Math.min(4000, budget));
      if (t) { out.push(`--- conteúdo de "${a.file}" ---\n${t}\n---`); budget -= t.length; }
    }
    /* vídeos/áudios: o resumo transcrito com tempos guia a narração e a escolha dos trechos */
    let tbudget = 14000;
    const tr: string[] = [];
    for (const a of list.filter((x) => x.kind === 'video' || x.kind === 'audio')) {
      if (tbudget <= 400) break;
      const f = attachmentTranscript(projectDir, a);
      if (!f) continue;
      const t = excerpt(f, Math.min(6000, tbudget));
      if (!t) continue;
      tr.push(`--- transcrição de "${a.file}" (tempos em segundos) ---\n${t}\n---`);
      tbudget -= t.length;
    }
    if (tr.length) out.push(`TRANSCRIÇÕES DOS VÍDEOS/ÁUDIOS ANEXADOS (use para escrever a narração e escolher os trechos):\n${tr.join('\n')}`);
    /* folhas de quadros: o modelo precisa ver o que aparece no vídeo para a narração casar com a tela */
    const sheets = list.filter((x) => x.kind === 'video').map((a) => ({ a, s: attachmentSheets(projectDir, a) })).filter((x) => x.s.length);
    if (sheets.length) out.push(`FOLHAS DE QUADROS DOS VÍDEOS ANEXADOS (1 quadro a cada 30 s, em ordem; ABRA/OLHE as imagens para saber o que aparece em cada momento):\n${sheets.map(({ a, s }) => `- "${a.file}": ${s.map((x) => `${path.join(sheetsDir(projectDir), x.file)} (${x.from}s–${x.to}s)`).join(', ')}`).join('\n')}\nA narração e o visualIntent devem corresponder ao que aparece nesses quadros.`);
  }
  const media = list.filter((a) => a.use === 'scene' && (a.kind === 'image' || a.kind === 'video'));
  if (kind === 'scene_plan' && media.length) {
    out.push(`MÍDIA DO USUÁRIO NAS CENAS: para usar uma imagem ou vídeo do usuário como visual de uma cena, ponha nessa cena "userMedia": "<nome exato do arquivo, ex.: ${media[0]!.file}>" e um tipo que a rota produz: "image" (o vídeo IA ainda pode animá-la), "video" ou, em rotas só de código, "code" (a página da cena mostra o arquivo). ` +
      'Use CADA arquivo marcado "usar numa cena" em pelo menos uma cena, onde combinar com a narração; descreva em "visualIntent" o que o arquivo mostra (pela nota/nome).');
    const vids = media.filter((a) => a.kind === 'video' && !a.file.startsWith('web/'));
    const caps = media.filter((a) => /^web\/(?:l\d+\/)?pagina\.mp4$/.test(a.file)).map((a) => a.file);
    if (caps.length === 1)
      out.push(`CAPTURA DO LINK (${caps[0]}, a página rolando, sem som): use TRECHOS dela — "userMedia": "${caps[0]}", "clipStart": <instante da seção em ${caps[0]!.replace(/\.mp4$/, '.md')}>, "durationSec": 4 a 8 — em cenas "code" (o motion graphics mostra o trecho numa moldura de navegador com destaques); NÃO precisa cobrir o vídeo inteiro. Os prints web/*.png servem para cenas paradas e para a thumbnail.`);
    else if (caps.length > 1)
      out.push(`CAPTURAS DE ${caps.length} LINKS (índice em web/links.md): ${caps.join(', ')} — cada uma é a página de UM link rolando, sem som. Explique os links NA ORDEM do índice: as cenas do bloco de cada link usam TRECHOS da captura DELE — "userMedia": "web/lN/pagina.mp4", "clipStart": <instante da seção em web/lN/pagina.md>, "durationSec": 4 a 8 — em cenas "code" (moldura de navegador com a URL DESSE link e destaques). Todo link aparece em pelo menos 2 cenas; use uma cena "motion" de transição entre um link e o próximo (ex.: "Link 2 de ${caps.length}: <nome>"). Prints web/lN/*.png servem para cenas paradas e para a thumbnail.`);
    const pclips = media.filter((a) => /^web\/(?:l\d+\/)?video-\d+\.mp4$/.test(a.file)).map((a) => a.file);
    if (pclips.length)
      out.push(`TRECHOS DE VÍDEOS DAS PÁGINAS (${pclips.join(', ')}): vídeos que tocavam na página, gravados curtos e sem som. Use cada um em NO MÁXIMO uma cena de 3 a 6 s ("userMedia": "<arquivo>", "clipStart": 0), numa moldura, quando a fala citar esse vídeo/resultado — é conteúdo de terceiros, então comente por cima e não mostre mais que isso.`);
    if (vids.length) {
      out.push(`VÍDEOS DO USUÁRIO — USO COMPLETO: cubra 100% da duração de cada vídeo em segmentos CONTÍGUOS (o próximo "clipStart" = fim do anterior), sem pular nenhum trecho. Em cada segmento: "userMedia": "<nome exato do arquivo>", "clipStart": <segundo inicial>, "manualDuration": true e "durationSec": <duração>. TODA cena de clipe tem narração descrevendo a ação que aparece na tela (o áudio original da captura NÃO é usado — descreva o que é aberto, clicado ou mostrado, usando as folhas de quadros).`);
      out.push(`CAPTURA DE TELA / OBS: comece depois que a janela do OBS sair da tela. Se a barra de tarefas/rodapé com o ícone do OBS aparecer, recorte com "clipCrop": {"w":1920,"h":1032,"x":0,"y":0} (1080p; corta os 48 px do rodapé). NUNCA mostre o OBS. A narração deve indicar o que ocorre na tela no trecho.`);
    }
  }
  const chars = list.filter((a) => a.use === 'character' && a.character);
  if ((kind === 'asset_design' || kind === 'script' || kind === 'scene_plan') && chars.length)
    out.push(`PERSONAGENS COM FOTO DO USUÁRIO: ${chars.map((a) => `${a.character} ("${a.file}"${a.note ? `, ${a.note}` : ''})`).join('; ')}. Use EXATAMENTE esses nomes; a aparência na bíblia deve ser fiel à foto.`);
  if (CODE_KINDS.has(kind)) {
    const own = scene?.userMedia ? list.find((a) => a.file === scene.userMedia) : undefined;
    const rel = (a: Attachment) => pageDir ? path.relative(pageDir, attachmentPath(projectDir, a)).split(path.sep).join('/') : attachmentPath(projectDir, a);
    out.push(`Na página da cena carregue estes arquivos pelo caminho RELATIVO à página (nada de file://): ${list.filter((a) => a.kind === 'image' || a.kind === 'video').map((a) => `"${rel(a)}"`).join(', ') || '(nenhuma imagem/vídeo)'}. Imagens com <img>/drawImage (espere carregar antes do 1º quadro); vídeo com <video muted> e currentTime acompanhando o tempo da cena. ${own ? `ESTA CENA deve mostrar "${own.file}".` : 'Use-os quando combinarem com a cena.'}`);
  }
  if (list.some((a) => a.use === 'music') && (kind === 'script' || kind === 'scene_plan')) out.push('A trilha sonora do vídeo é o áudio do usuário marcado "trilha sonora".');
  return out.join('\n');
}
