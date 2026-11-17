import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Attachment, AttachmentKind, Project, Scene, Settings } from '../shared/types';
import { transcribe, wordsDigest } from './whisper';
import { ensureWhisper } from './whisper-install';
import * as ff from './ffmpeg';

/**
 * Arquivos do usuÃ¡rio anexados ao projeto (imagens, vÃ­deos, Ã¡udios, textos ou uma pasta inteira).
 * Ficam copiados em <projeto>/assets/user, entram no prompt das etapas de texto/cÃ³digo e sÃ£o usados na produÃ§Ã£o:
 * - imagem/vÃ­deo com uso "cena": o plano de cenas marca "userMedia" e a cena usa o arquivo no lugar do gerado
 *   (imagem â†’ quadro da cena, que ainda pode ser animado pelo vÃ­deo IA; vÃ­deo â†’ clipe da cena);
 * - Ã¡udio com uso "trilha": vira a trilha sonora;
 * - imagem com uso "personagem": vira o retrato do personagem (referÃªncia do MiniMax H3);
 * - textos: o conteÃºdo entra no prompt do roteiro, do plano e da bÃ­blia.
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
    if (!src || !fs.existsSync(src)) throw new Error(`arquivo nÃ£o encontrado: ${src}`);
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
  try { fs.rmSync(attachmentPath(projectDir, a), { force: true }); } catch { /* jÃ¡ nÃ£o existe */ }
  p.attachments = p.attachments!.filter((x) => x !== a);
  if (!p.attachments.length) delete p.attachments;
  for (const s of p.scenes) if (s.userMedia === file) delete s.userMedia;
}

export function updateAttachment(p: Project, file: string, patch: Partial<Pick<Attachment, 'use' | 'note' | 'character'>>): Attachment {
  const a = p.attachments?.find((x) => x.file === file);
  if (!a) throw new Error(`anexo nÃ£o encontrado: ${file}`);
  if (patch.use && ['scene', 'reference', 'music', 'character'].includes(patch.use)) a.use = patch.use;
  if ('note' in patch) { const n = String(patch.note ?? '').trim().slice(0, 500); if (n) a.note = n; else delete a.note; }
  if ('character' in patch) { const n = String(patch.character ?? '').trim().slice(0, 60); if (n) a.character = n; else delete a.character; }
  if (a.use !== 'character') delete a.character;
  /* trilha: sÃ³ uma */
  if (a.use === 'music') for (const x of p.attachments!) if (x !== a && x.use === 'music') x.use = 'reference';
  return a;
}

/** Arquivo do usuÃ¡rio marcado para a cena (sÃ³ se existir e for imagem/vÃ­deo). */
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
const KIND_LABEL: Record<AttachmentKind, string> = { image: 'imagem', video: 'vÃ­deo', audio: 'Ã¡udio', text: 'texto', other: 'arquivo' };
const USE_LABEL: Record<Attachment['use'], string> = { scene: 'usar numa cena', reference: 'referÃªncia', music: 'trilha sonora', character: 'foto de personagem' };

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ transcriÃ§Ã£o dos vÃ­deos/Ã¡udios anexados (base para a narraÃ§Ã£o e para os trechos) â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export const transcriptsDir = (projectDir: string) => path.join(userDir(projectDir), 'transcripts');
export const sheetsDir = (projectDir: string) => path.join(userDir(projectDir), 'sheets');
const transcriptBase = (a: Pick<Attachment, 'file'>) => path.basename(a.file).replace(/\.[^.]+$/, '');
/** Caminho do resumo transcrito (com tempos) do anexo, se jÃ¡ existe. */
export function attachmentTranscript(projectDir: string, a: Pick<Attachment, 'file'>): string | undefined {
  const f = path.join(transcriptsDir(projectDir), `${transcriptBase(a)}.txt`);
  return fs.existsSync(f) ? f : undefined;
}

/** Folhas de quadros (1 quadro a cada 30 s, 4Ã—3) do vÃ­deo anexado: o que aparece em cada momento. */
export interface AttachmentSheet { file: string; from: number; to: number }
export function attachmentSheets(projectDir: string, a: Pick<Attachment, 'file'>): AttachmentSheet[] {
  try { return JSON.parse(fs.readFileSync(path.join(sheetsDir(projectDir), `${transcriptBase(a)}.json`), 'utf8')) as AttachmentSheet[]; } catch { return []; }
}

/** Extrai a folha de quadros do vÃ­deo (1 quadro a cada 30 s, 12 por folha, em ordem). */
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
 * Grava out/music.lyrics.md (letra + palavras com tempo) a partir da transcriÃ§Ã£o da mÃºsica do projeto â€”
 * Ã© o que o diretor do videoclipe "ouve" antes de planejar as cenas.
 */
export function writeMusicLyrics(projectDir: string, file: string, wordsJson: string, log?: (l: string) => void): void {
  try {
    const j = JSON.parse(fs.readFileSync(wordsJson, 'utf8')) as { words?: Array<{ w: string; start: number; end: number }>; text?: string };
    let words = Array.isArray(j.words) ? j.words : [];
    /* transcriÃ§Ã£o degenerada (instrumental com voz picada: "e e e eâ€¦"): nÃ£o Ã© letra â€” o clipe se monta pela estrutura */
    const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const uniq = new Set(words.map((x) => norm(String(x.w ?? ''))).filter(Boolean)).size;
    const top = (() => { const m = new Map<string, number>(); for (const x of words) { const k = norm(String(x.w ?? '')); if (k) m.set(k, (m.get(k) ?? 0) + 1); } return Math.max(0, ...m.values()); })();
    const degenerate = words.length < 20 || uniq <= 3 || top > words.length * 0.6;
    if (degenerate) words = [];
    const text = degenerate ? '(instrumental / sem voz inteligÃ­vel â€” monte o clipe pela estrutura musical)' : ((j.text ?? words.map((x) => x.w).join(' ')).trim() || '(instrumental / sem voz detectada)');
    const rows = words.slice(0, 600).map((x) => `${Number(x.start).toFixed(2)}-${Number(x.end).toFixed(2)} ${x.w}`).join('\n');
    const lyrics = path.join(projectDir, 'out', 'music.lyrics.md');
    fs.mkdirSync(path.dirname(lyrics), { recursive: true });
    fs.writeFileSync(lyrics, `# Letra ouvida da mÃºsica do projeto (${path.basename(file)})\n\n## Letra (transcriÃ§Ã£o)\n\n${text}\n\n## Palavras com tempo\n\n${rows}\n`, 'utf8');
    log?.(degenerate ? 'mÃºsica ouvida: sem letra inteligÃ­vel (instrumental) â€” clipe pela estrutura musical' : `mÃºsica ouvida: letra com ${words.length} palavra(s) em out/music.lyrics.md`);
  } catch { /* sÃ³ registro */ }
}

/**
 * Transcreve (uma vez) os vÃ­deos e Ã¡udios anexados ao projeto e grava um resumo com tempos em
 * assets/user/transcripts. O roteiro passa a saber o que os vÃ­deos dizem e o plano de cenas
 * consegue escolher o trecho (clipStart) de cada demonstraÃ§Ã£o.
 */
export async function ensureAttachmentTranscripts(o: {
  settings: Settings; project: Project; projectDir: string; toolsDir: string;
  signal?: AbortSignal; log?: (line: string) => void;
}): Promise<number> {
  /* web/ = captura do link (sem som; jÃ¡ tem prints e os instantes das seÃ§Ãµes em web/pagina.md) */
  const list = (o.project.attachments ?? []).filter((a) => (a.kind === 'video' || a.kind === 'audio') && !a.file.startsWith('web/') && fs.existsSync(attachmentPath(o.projectDir, a)));
  let done = 0;
  for (const a of list) {
    const file = attachmentPath(o.projectDir, a);
    /* folhas de quadros: o roteiro e o plano precisam SABER o que aparece no vÃ­deo para casar a narraÃ§Ã£o */
    if (a.kind === 'video' && !attachmentSheets(o.projectDir, a).length) {
      await buildSheets(o.settings.ffmpeg || 'ffmpeg', file, o.projectDir, a, o.log);
    }
    if (attachmentTranscript(o.projectDir, a)) {
      /* jÃ¡ transcrito (execuÃ§Ã£o anterior): a mÃºsica ainda precisa da letra com tempos para o videoclipe */
      if (a.use === 'music') writeMusicLyrics(o.projectDir, file, attachmentTranscript(o.projectDir, a)!, o.log);
      continue;
    }
    const dir = transcriptsDir(o.projectDir);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${transcriptBase(a)}.words.json`);
    const script = path.join(o.toolsDir, 'whisper_words.py');
    let cfg = o.settings.whisper ?? { python: 'python', model: 'small', device: 'auto' };
    const ac = o.signal ?? new AbortController().signal;
    try {
      o.log?.(`transcrevendo o anexo "${a.file}" (base para a narraÃ§Ã£o e para os trechos)â€¦`);
      let w;
      try { w = await transcribe(cfg, script, file, out, undefined, ac); }
      catch (e) {
        if (cfg.autoInstall === false || !/faster-whisper|No module|ModuleNotFound|nÃ£o foi possÃ­vel executar|ENOENT|python/i.test((e as Error).message)) throw e;
        o.log?.('instalando o Whisper para transcrever os anexosâ€¦');
        const inst = await ensureWhisper(o.settings, { log: o.log, signal: o.signal });
        cfg = { ...cfg, python: inst.python, device: 'cpu' };
        w = await transcribe(cfg, script, file, out, undefined, ac);
      }
      fs.writeFileSync(path.join(dir, `${transcriptBase(a)}.txt`), wordsDigest(w, 140), 'utf8');
      /* MÃšSICA do projeto: a letra com tempos vai para out/music.lyrics.md â€” o roteiro e o plano de cenas do
         videoclipe leem daqui (o diretor "ouve" a faixa antes de planejar) */
      if (a.use === 'music') writeMusicLyrics(o.projectDir, file, out, o.log);
      o.log?.(`anexo "${a.file}": transcriÃ§Ã£o com ${w.words.length} palavras`);
      done++;
    } catch (e) {
      o.log?.(`aviso: sem transcriÃ§Ã£o de "${a.file}" (${(e as Error).message.slice(0, 140)})`);
    }
  }
  return done;
}

function excerpt(file: string, max: number): string {
  try { const t = fs.readFileSync(file, 'utf8').trim(); return t.length > max ? `${t.slice(0, max)}\n[â€¦]` : t; } catch { return ''; }
}

/** Bloco do prompt com os arquivos do usuÃ¡rio (o que cada etapa precisa saber). */
export function attachmentsText(p: Project, projectDir: string, kind: string, scene?: Pick<Scene, 'userMedia'>, pageDir?: string): string {
  const list = (p.attachments ?? []).filter((a) => fs.existsSync(attachmentPath(projectDir, a)));
  if (!list.length || (!PLAN_KINDS.has(kind) && !CODE_KINDS.has(kind))) return '';
  const line = (a: Attachment) => `- [${KIND_LABEL[a.kind]}] "${a.file}" (${USE_LABEL[a.use]}${a.character ? `: ${a.character}` : ''}) â€” ${attachmentPath(projectDir, a)}${a.note ? `\n  Nota do usuÃ¡rio: ${a.note}` : ''}`;
  const out = [`ARQUIVOS DO USUÃRIO (anexados ao projeto â€” eles fazem parte do pedido, use-os):\n${list.map(line).join('\n')}`];
  if (PLAN_KINDS.has(kind)) {
    let budget = 8000;
    for (const a of list.filter((x) => x.kind === 'text')) {
      if (budget <= 200) break;
      const t = excerpt(attachmentPath(projectDir, a), Math.min(4000, budget));
      if (t) { out.push(`--- conteÃºdo de "${a.file}" ---\n${t}\n---`); budget -= t.length; }
    }
    /* vÃ­deos/Ã¡udios: o resumo transcrito com tempos guia a narraÃ§Ã£o e a escolha dos trechos */
    let tbudget = 14000;
    const tr: string[] = [];
    for (const a of list.filter((x) => x.kind === 'video' || x.kind === 'audio')) {
      if (tbudget <= 400) break;
      const f = attachmentTranscript(projectDir, a);
      if (!f) continue;
      const t = excerpt(f, Math.min(6000, tbudget));
      if (!t) continue;
      tr.push(`--- transcriÃ§Ã£o de "${a.file}" (tempos em segundos) ---\n${t}\n---`);
      tbudget -= t.length;
    }
    if (tr.length) out.push(`TRANSCRIÃ‡Ã•ES DOS VÃDEOS/ÃUDIOS ANEXADOS (use para escrever a narraÃ§Ã£o e escolher os trechos):\n${tr.join('\n')}`);
    /* folhas de quadros: o modelo precisa ver o que aparece no vÃ­deo para a narraÃ§Ã£o casar com a tela */
    const sheets = list.filter((x) => x.kind === 'video').map((a) => ({ a, s: attachmentSheets(projectDir, a) })).filter((x) => x.s.length);
    if (sheets.length) out.push(`FOLHAS DE QUADROS DOS VÃDEOS ANEXADOS (1 quadro a cada 30 s, em ordem; ABRA/OLHE as imagens para saber o que aparece em cada momento):\n${sheets.map(({ a, s }) => `- "${a.file}": ${s.map((x) => `${path.join(sheetsDir(projectDir), x.file)} (${x.from}sâ€“${x.to}s)`).join(', ')}`).join('\n')}\nA narraÃ§Ã£o e o visualIntent devem corresponder ao que aparece nesses quadros.`);
  }
  const media = list.filter((a) => a.use === 'scene' && (a.kind === 'image' || a.kind === 'video'));
  if (kind === 'scene_plan' && media.length) {
    out.push(`MÃDIA DO USUÃRIO NAS CENAS: para usar uma imagem ou vÃ­deo do usuÃ¡rio como visual de uma cena, ponha nessa cena "userMedia": "<nome exato do arquivo, ex.: ${media[0]!.file}>" e um tipo que a rota produz: "image" (o vÃ­deo IA ainda pode animÃ¡-la), "video" ou, em rotas sÃ³ de cÃ³digo, "code" (a pÃ¡gina da cena mostra o arquivo). ` +
      'Use CADA arquivo marcado "usar numa cena" em pelo menos uma cena, onde combinar com a narraÃ§Ã£o; descreva em "visualIntent" o que o arquivo mostra (pela nota/nome).');
    const vids = media.filter((a) => a.kind === 'video' && !a.file.startsWith('web/'));
    const caps = media.filter((a) => /^web\/(?:l\d+\/)?pagina\.mp4$/.test(a.file)).map((a) => a.file);
    if (caps.length === 1)
      out.push(`CAPTURA DO LINK (${caps[0]}, a pÃ¡gina rolando, sem som): use TRECHOS dela â€” "userMedia": "${caps[0]}", "clipStart": <instante da seÃ§Ã£o em ${caps[0]!.replace(/\.mp4$/, '.md')}>, "durationSec": 4 a 8 â€” em cenas "code" (o motion graphics mostra o trecho numa moldura de navegador com destaques); NÃƒO precisa cobrir o vÃ­deo inteiro. Os prints web/*.png servem para cenas paradas e para a thumbnail.`);
    else if (caps.length > 1)
      out.push(`CAPTURAS DE ${caps.length} LINKS (Ã­ndice em web/links.md): ${caps.join(', ')} â€” cada uma Ã© a pÃ¡gina de UM link rolando, sem som. Explique os links NA ORDEM do Ã­ndice: as cenas do bloco de cada link usam TRECHOS da captura DELE â€” "userMedia": "web/lN/pagina.mp4", "clipStart": <instante da seÃ§Ã£o em web/lN/pagina.md>, "durationSec": 4 a 8 â€” em cenas "code" (moldura de navegador com a URL DESSE link e destaques). Todo link aparece em pelo menos 2 cenas; use uma cena "motion" de transiÃ§Ã£o entre um link e o prÃ³ximo (ex.: "Link 2 de ${caps.length}: <nome>"). Prints web/lN/*.png servem para cenas paradas e para a thumbnail.`);
    const pclips = media.filter((a) => /^web\/(?:l\d+\/)?video-\d+\.mp4$/.test(a.file)).map((a) => a.file);
    if (pclips.length)
      out.push(`TRECHOS DE VÃDEOS DAS PÃGINAS (${pclips.join(', ')}): vÃ­deos que tocavam na pÃ¡gina, gravados curtos e sem som. Use cada um em NO MÃXIMO uma cena de 3 a 6 s ("userMedia": "<arquivo>", "clipStart": 0), numa moldura, quando a fala citar esse vÃ­deo/resultado â€” Ã© conteÃºdo de terceiros, entÃ£o comente por cima e nÃ£o mostre mais que isso.`);
    if (vids.length) {
      out.push(`VÃDEOS DO USUÃRIO â€” USO COMPLETO: cubra 100% da duraÃ§Ã£o de cada vÃ­deo em segmentos CONTÃGUOS (o prÃ³ximo "clipStart" = fim do anterior), sem pular nenhum trecho. Em cada segmento: "userMedia": "<nome exato do arquivo>", "clipStart": <segundo inicial>, "manualDuration": true e "durationSec": <duraÃ§Ã£o>. TODA cena de clipe tem narraÃ§Ã£o descrevendo a aÃ§Ã£o que aparece na tela (o Ã¡udio original da captura NÃƒO Ã© usado â€” descreva o que Ã© aberto, clicado ou mostrado, usando as folhas de quadros).`);
      out.push(`CAPTURA DE TELA / OBS: comece depois que a janela do OBS sair da tela. Se a barra de tarefas/rodapÃ© com o Ã­cone do OBS aparecer, recorte com "clipCrop": {"w":1920,"h":1032,"x":0,"y":0} (1080p; corta os 48 px do rodapÃ©). NUNCA mostre o OBS. A narraÃ§Ã£o deve indicar o que ocorre na tela no trecho.`);
    }
  }
  const chars = list.filter((a) => a.use === 'character' && a.character);
  if ((kind === 'asset_design' || kind === 'script' || kind === 'scene_plan') && chars.length)
    out.push(`PERSONAGENS COM FOTO DO USUÃRIO: ${chars.map((a) => `${a.character} ("${a.file}"${a.note ? `, ${a.note}` : ''})`).join('; ')}. Use EXATAMENTE esses nomes; a aparÃªncia na bÃ­blia deve ser fiel Ã  foto.`);
  if (CODE_KINDS.has(kind)) {
    const own = scene?.userMedia ? list.find((a) => a.file === scene.userMedia) : undefined;
    const rel = (a: Attachment) => pageDir ? path.relative(pageDir, attachmentPath(projectDir, a)).split(path.sep).join('/') : attachmentPath(projectDir, a);
    out.push(`Na pÃ¡gina da cena carregue estes arquivos pelo caminho RELATIVO Ã  pÃ¡gina (nada de file://): ${list.filter((a) => a.kind === 'image' || a.kind === 'video').map((a) => `"${rel(a)}"`).join(', ') || '(nenhuma imagem/vÃ­deo)'}. Imagens com <img>/drawImage (espere carregar antes do 1Âº quadro); vÃ­deo com <video muted> e currentTime acompanhando o tempo da cena. ${own ? `ESTA CENA deve mostrar "${own.file}".` : 'Use-os quando combinarem com a cena.'}`);
  }
  if (list.some((a) => a.use === 'music') && (kind === 'script' || kind === 'scene_plan')) out.push('A trilha sonora do vÃ­deo Ã© o Ã¡udio do usuÃ¡rio marcado "trilha sonora".');
  return out.join('\n');
}
