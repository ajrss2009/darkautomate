import { httpFetch } from './http';
/** fetch do Chromium: certificados do Windows + proxy/PAC (ver http.ts) */
const fetch = httpFetch();

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Project, Settings } from '../shared/types';
import { pluginsRoot } from './plugins';

/*
 * KITS DE PLUGIN — plugins do Claude que trazem o PRÓPRIO motor de animação (código testado), não só instruções:
 *  - "player": aiTrends 2D Studio — skills/<s>/kit/{player.html, engine/*.js}; cenas = módulos registerShot(id, {draw})
 *    lidos de /__manifest; window.renderFrame(índice) desenha o quadro (gradação, barras, transições, legendas do kit).
 *  - "piece": Animate (cth9191) — skills/<s>/{kit/core.js, tools/build.mjs, styles/<estilo>/kit.js}; uma "peça"
 *    (piece.json + src/*.js) é montada num index.html único com renderFrame(segundos).
 *  - "pages": Lemo-Opuscar — o plugin só traz um SKILL.md que CLONA a biblioteca do repositório (core/lib.js, styles/<estilo>/
 *    {STYLE.md, style.json, demo/index.html}); o FilmForge guarda a biblioteca em _library/ e cada página segue o contrato
 *    window.READY + window.render(t) + window.DUR (servida com a biblioteca na raiz e o projeto em /@film/).
 *  - "node-film": claude-animation — lib/*.mjs + lib/film.mjs (run({ setup, frame })): filmes escritos para Node com
 *    @napi-rs/canvas; o FilmForge roda os exemplos NO NAVEGADOR com adaptadores (path/fs/url/canvas) e um run() que
 *    só captura setup/frame — e as cenas importam a mesma biblioteca.
 * A qualidade vem desse motor: o FilmForge usa o kit como está (sem reescrever) e só fornece tempo, cenas e render.
 */

export type KitKind = 'player' | 'piece' | 'pages' | 'node-film';
/** Um estilo da biblioteca (pages): nome, filme de demonstração e imagem do quadro-chave. */
export interface KitStyle { id: string; name: string; film?: string; summary?: string; cover?: string; demo?: string; frameSec?: number; dur?: number; category?: string }
export interface KitInfo {
  kind: KitKind; pluginDir: string; skillDir: string; kitDir: string;
  /** pages: pasta da biblioteca (_library) — vazia enquanto não for baixada; repo = de onde baixar */
  library?: string; repo?: string;
  /** pages: estilos com nome, demo e quadro-chave */
  styleInfo?: KitStyle[];
  /** referências do kit (style bible, API do motor…) */
  refs: string[];
  /** projetos/peças de exemplo (a prévia usa o primeiro) */
  examples: string[];
  /** estilos do kit (player: styles.js; piece: styles/<nome>) */
  styles: string[];
}

const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const subdirs = (p: string) => (isDir(p) ? fs.readdirSync(p).map((n) => path.join(p, n)).filter(isDir) : []);

/** Procura um kit com motor próprio dentro do plugin instalado. */
export function detectKit(pluginDir: string): KitInfo | undefined {
  for (const skillDir of subdirs(path.join(pluginDir, 'skills'))) {
    const kit = path.join(skillDir, 'kit');
    const refs = isDir(path.join(skillDir, 'references')) ? fs.readdirSync(path.join(skillDir, 'references')).filter((f) => f.endsWith('.md')).map((f) => path.join(skillDir, 'references', f)) : [];
    if (fs.existsSync(path.join(kit, 'player.html')) && fs.existsSync(path.join(kit, 'engine', 'core.js'))) {
      const examples = subdirs(path.join(kit, 'examples')).filter((d) => fs.existsSync(path.join(d, 'config.json')) && fs.existsSync(path.join(d, 'story', 'shots.json')));
      let styles: string[] = [];
      try {
        const src = fs.readFileSync(path.join(kit, 'engine', 'styles.js'), 'utf8');
        const at = src.search(/\bSTYLES\s*=/);
        if (at >= 0) styles = [...src.slice(at).matchAll(/^\s{2}([a-z][\w-]*)\s*:\s*\{/gm)].map((m) => m[1]!);
      } catch { /* sem estilos */ }
      return { kind: 'player', pluginDir, skillDir, kitDir: kit, refs, examples, styles };
    }
    if (fs.existsSync(path.join(kit, 'core.js')) && fs.existsSync(path.join(skillDir, 'tools', 'build.mjs')) && isDir(path.join(skillDir, 'styles'))) {
      const styleDirs = subdirs(path.join(skillDir, 'styles')).filter((d) => fs.existsSync(path.join(d, 'kit.js')));
      const examples = [...styleDirs.map((d) => path.join(d, 'demo')), ...subdirs(path.join(skillDir, 'examples'))].filter((d) => fs.existsSync(path.join(d, 'piece.json')) && isDir(path.join(d, 'src')));
      const docs = [path.join(skillDir, 'craft.md'), ...['FORMATS.md', 'FRAME.md', 'STORY.md'].map((f) => path.join(skillDir, 'grammar', f))].filter((f) => fs.existsSync(f));
      return { kind: 'piece', pluginDir, skillDir, kitDir: kit, refs: [...docs, ...refs], examples, styles: styleDirs.map((d) => path.basename(d)) };
    }
    /* node-film: lib/film.mjs com run({ setup, frame }) + filmes de exemplo (repositório → _gallery/examples) */
    const film = path.join(skillDir, 'lib', 'film.mjs');
    if (fs.existsSync(film) && /export\s+(async\s+)?function\s+run\b/.test(fs.readFileSync(film, 'utf8'))) {
      const examples = [...subdirs(path.join(pluginDir, '_gallery', 'examples')), ...subdirs(path.join(skillDir, 'examples'))].map((d) => path.join(d, 'film.mjs')).filter((f) => fs.existsSync(f));
      return { kind: 'node-film', pluginDir, skillDir, kitDir: path.join(skillDir, 'lib'), refs, examples, styles: [] };
    }
  }
  /* pages: biblioteca de estilos guardada em _library/ (ou ainda por baixar, se o SKILL.md a clona de um repositório) */
  const lib = path.join(pluginDir, '_library');
  const skillDir = subdirs(path.join(pluginDir, 'skills'))[0] ?? pluginDir;
  if (isLibrary(lib)) return pagesInfo(pluginDir, skillDir, lib);
  const repo = libraryRepo(pluginDir);
  if (repo) return { kind: 'pages', pluginDir, skillDir, kitDir: lib, repo, refs: [], examples: [], styles: [] };
  return undefined;
}

const isLibrary = (dir: string) => fs.existsSync(path.join(dir, 'core', 'lib.js')) && isDir(path.join(dir, 'styles'));

function pagesInfo(pluginDir: string, skillDir: string, lib: string): KitInfo {
  const styleInfo: KitStyle[] = [];
  for (const d of subdirs(path.join(lib, 'styles'))) {
    const id = path.basename(d);
    if (id.startsWith('_') || !fs.existsSync(path.join(d, 'STYLE.md'))) continue;
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(fs.readFileSync(path.join(d, 'style.json'), 'utf8')); } catch { /* sem style.json */ }
    const cover = [path.join(d, 'demo', 'stills', 'styleframe.jpg'), path.join(d, 'poster.jpg'), path.join(d, 'demo', 'poster.jpg')].find((f) => fs.existsSync(f));
    const demo = fs.existsSync(path.join(d, 'demo', 'index.html')) ? path.join(d, 'demo') : undefined;
    styleInfo.push({ id, name: String(j['en'] ?? id), film: j['film'] ? String(j['film']) : undefined, summary: j['line'] ? String(j['line']) : undefined, cover, demo,
      frameSec: typeof j['frame_sec'] === 'number' ? j['frame_sec'] : undefined, dur: typeof j['dur'] === 'number' ? j['dur'] : undefined, category: j['category_en'] ? String(j['category_en']) : undefined });
  }
  const refs = ['AGENTS.md', 'DIRECTOR.md', 'TECHNIQUE.md', 'core/README.md'].map((f) => path.join(lib, f)).filter((f) => fs.existsSync(f));
  return { kind: 'pages', pluginDir, skillDir, kitDir: lib, library: lib, refs, examples: styleInfo.filter((x) => x.demo).map((x) => x.demo!), styles: styleInfo.map((x) => x.id), styleInfo };
}

/** Repositório que o SKILL.md/scripts do plugin clonam (ex.: REPO=${…:-https://github.com/dono/repo.git}). */
function libraryRepo(pluginDir: string): string | undefined {
  for (const skill of subdirs(path.join(pluginDir, 'skills'))) {
    for (const f of [...(isDir(path.join(skill, 'scripts')) ? fs.readdirSync(path.join(skill, 'scripts')).map((x) => path.join(skill, 'scripts', x)) : []), path.join(skill, 'SKILL.md')]) {
      let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const m = /REPO=\$\{[A-Z_]+:-(https:\/\/github\.com\/[\w.-]+\/[\w.-]+?)(?:\.git)?\}/.exec(t) ?? (/\b(?:git clone|clones?)\b[^\n]*?(https:\/\/github\.com\/[\w.-]+\/[\w.-]+?)(?:\.git)?[\s"')]/.exec(t));
      if (m) return m[1];
    }
  }
  return undefined;
}

/** Copia a biblioteca de um repositório já extraído para <plugin>/_library (sem vídeos/áudios pesados). */
export function adoptLibrary(repoRoot: string, pluginDir: string): boolean {
  if (!isLibrary(repoRoot)) return false;
  const dest = path.join(pluginDir, '_library');
  const SKIP = /[\\/](\.git|node_modules|docs|styleboard|out|\.github)([\\/]|$)|\.(mp4|mov|webm|mkv|wav|mp3|flac|ogg|m4a)$/i;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(repoRoot)) {
    const src = path.join(repoRoot, name);
    if (isDir(src) ? !['core', 'styles', 'tools'].includes(name) : !/\.(md|json)$/i.test(name)) continue;
    fs.cpSync(src, path.join(dest, name), { recursive: true, force: true, filter: (f) => !SKIP.test(f.slice(repoRoot.length)) });
  }
  return true;
}

/** Baixa a biblioteca (pages) do repositório que o plugin indica. */
export async function ensureLibrary(kit: KitInfo, log: (l: string) => void, signal?: AbortSignal): Promise<KitInfo> {
  if (kit.kind !== 'pages' || kit.library) return kit;
  if (!kit.repo) throw new Error('o plugin não diz de onde baixar a biblioteca');
  const m = /github\.com\/([\w.-]+)\/([\w.-]+)/.exec(kit.repo)!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-lib-'));
  try {
    let zip = '';
    for (const br of ['main', 'master']) {
      log(`baixando a biblioteca do plugin (${m[1]}/${m[2]}@${br})…`);
      const r = await fetch(`https://codeload.github.com/${m[1]}/${m[2]}/zip/refs/heads/${br}`, { signal: signal ?? AbortSignal.timeout(1_800_000) });
      if (!r.ok) continue;
      zip = path.join(tmp, 'lib.zip');
      fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
      break;
    }
    if (!zip) throw new Error(`não consegui baixar ${kit.repo}`);
    const out = path.join(tmp, 'src');
    fs.mkdirSync(out);
    const x = spawnSync(sysTar(), ['-xf', zip, '-C', out], { windowsHide: true, encoding: 'utf8' });
    if (x.status !== 0) throw new Error(`não consegui extrair a biblioteca: ${x.stderr}`);
    const root = subdirs(out)[0] ?? out;
    if (!adoptLibrary(root, kit.pluginDir)) throw new Error('o repositório não tem core/lib.js e styles/ (biblioteca inesperada)');
    log('biblioteca do plugin pronta');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return detectKit(kit.pluginDir)!;
}

/* ───────── dependências do kit (three, fontes): baixadas do registro do npm, sem npm instalado ───────── */

const SKIP_DEPS = /^(playwright(-core)?|puppeteer(-core)?|@playwright\/.*)$/;
/**
 * Dependências dos plugins ficam DENTRO da pasta de plugins (`_deps/node_modules`): copiar a pasta de plugins (ou o
 * perfil portátil, ou o pacote .ffplugins) leva tudo junto e o plugin funciona em outro computador sem baixar nada.
 * A pasta antiga (`<workspace>/plugin-deps`) é migrada na primeira vez.
 */
export function kitModulesDir(s: Settings): string {
  const mods = path.join(pluginsRoot(s), '_deps', 'node_modules');
  const old = path.join(s.workspace, 'plugin-deps', 'node_modules');
  try {
    if (!fs.existsSync(mods) && fs.existsSync(old) && path.resolve(old) !== path.resolve(mods)) {
      fs.mkdirSync(path.dirname(mods), { recursive: true });
      fs.cpSync(old, mods, { recursive: true });
    }
  } catch { /* sem permissão: baixa de novo quando precisar */ }
  return mods;
}

function sysTar(): string { const t = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'; return fs.existsSync(t) ? t : 'tar'; }

export async function ensureKitDeps(s: Settings, kitDir: string, log: (l: string) => void, signal?: AbortSignal): Promise<string> {
  const mods = kitModulesDir(s);
  let deps: Record<string, string> = {};
  try { deps = (JSON.parse(fs.readFileSync(path.join(kitDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }).dependencies ?? {}; } catch { return mods; }
  for (const [name, spec] of Object.entries(deps)) {
    if (SKIP_DEPS.test(name)) continue;
    const dest = path.join(mods, ...name.split('/'));
    if (fs.existsSync(path.join(dest, 'package.json'))) continue;
    let version = spec.replace(/^[\^~=v]/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      const meta = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, { signal: signal ?? AbortSignal.timeout(60_000) }).then((r) => r.json()) as { 'dist-tags'?: { latest?: string } };
      version = meta['dist-tags']?.latest ?? version;
    }
    const base = name.includes('/') ? name.split('/')[1]! : name;
    log(`baixando a dependência do plugin ${name}@${version}…`);
    const r = await fetch(`https://registry.npmjs.org/${name}/-/${base}-${version}.tgz`, { signal: signal ?? AbortSignal.timeout(600_000) });
    if (!r.ok) throw new Error(`não consegui baixar ${name}@${version} (HTTP ${r.status})`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-dep-'));
    try {
      const tgz = path.join(tmp, 'pkg.tgz');
      fs.writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
      const x = spawnSync(sysTar(), ['-xzf', tgz, '-C', tmp], { windowsHide: true, encoding: 'utf8' });
      if (x.status !== 0 || !fs.existsSync(path.join(tmp, 'package'))) throw new Error(`não consegui extrair ${name}: ${x.stderr || x.stdout}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(path.join(tmp, 'package'), dest, { recursive: true });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  return mods;
}

/* ───────── "piece" (Animate): monta o index.html como o tools/build.mjs do plugin ───────── */

const PIECE_DEFAULT = ['src/head.html', 'kit/core.js', 'style', 'src/scenes.js', 'src/bridges.js', 'kit/morph.js', 'kit/board.js', 'kit/score-head.js', 'src/score.js', 'kit/score-tail.js'];

export function buildPiece(skillDir: string, pieceDir: string, outFile = path.join(pieceDir, 'index.html')): { file: string; fps: number; duration: number; w: number; h: number } {
  const meta = JSON.parse(fs.readFileSync(path.join(pieceDir, 'piece.json'), 'utf8')) as { style?: string; build?: string[]; scenes?: string[]; format?: { width?: number; height?: number; fps?: number; duration?: number } };
  const styleName = meta.style || 'cut-paper';
  const styleDir = (name: string): string => {
    for (let d = pieceDir; ; d = path.dirname(d)) {
      const c = path.join(d, 'styles', name);
      if (fs.existsSync(path.join(c, 'kit.js'))) return c;
      if (path.dirname(d) === d) break;
    }
    const c = path.join(skillDir, 'styles', name);
    if (!fs.existsSync(path.join(c, 'kit.js'))) throw new Error(`estilo "${name}" não existe no plugin`);
    return c;
  };
  const resolve = (p: string) => {
    if (p === 'style') return path.join(styleDir(styleName), 'kit.js');
    if (p === 'kit/paper.js') return path.join(skillDir, 'styles', 'cut-paper', 'kit.js');
    if (p.startsWith('kit/')) return path.join(skillDir, 'kit', p.slice(4));
    const m = p.match(/^styles\/([^/]+)\/(.+)$/);
    if (m && !fs.existsSync(path.join(pieceDir, p))) return path.join(styleDir(m[1]!), m[2]!);
    return path.join(pieceDir, p);
  };
  const parts = meta.build || (meta.scenes ? PIECE_DEFAULT.flatMap((p) => (p === 'src/scenes.js' ? meta.scenes! : [p])) : PIECE_DEFAULT);
  let out = '';
  for (const p of parts) {
    const f = resolve(p);
    if (!fs.existsSync(f)) throw new Error(`parte da peça ausente: ${p}`);
    out += fs.readFileSync(f, 'utf8').replace(/\s*$/, '\n');
  }
  const inject: string[] = [];
  for (const [file, name] of [['beats.json', 'BEATS'], ['voice.json', 'VOICE']] as const) {
    const fp = path.join(pieceDir, file);
    if (fs.existsSync(fp)) inject.push(`const ${name} = ${JSON.stringify(JSON.parse(fs.readFileSync(fp, 'utf8')))};`);
  }
  if (inject.length) {
    const at = out.indexOf('"use strict";') >= 0 ? out.indexOf('"use strict";') + 13 : out.indexOf('<script>') + 8;
    out = out.slice(0, at) + '\n' + inject.join('\n') + out.slice(at);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
  const fm = meta.format ?? {};
  return { file: outFile, fps: fm.fps ?? 24, duration: fm.duration ?? 6, w: fm.width ?? 1920, h: fm.height ?? 1080 };
}

/* ───────── prévia de 2–3 s (sem IA): o exemplo do próprio plugin, renderizado pelo motor dele ───────── */

export interface KitRenderer {
  host: (m: { root: string; project?: string; modules?: string; fallbackFont?: string }) => string;
  frames: (o: { url: string; w: number; h: number; ffmpeg: string; fps: number; mode: 'player' | 'piece' | 'page'; from: number; to: number; out?: string; stills?: number[]; stillDir?: string; log?: (l: string) => void }) => Promise<{ errors: string[]; files: string[] }>;
}

export const previewFile = (pluginDir: string) => path.join(pluginDir, '_gallery', 'preview.mp4');

/** Gera _gallery/preview.mp4 (≈3 s) a partir do exemplo do kit. */
export async function kitPreview(s: Settings, kitIn: KitInfo, r: KitRenderer, log: (l: string) => void, seconds = 3, styleId?: string): Promise<string> {
  const kit = kitIn.kind === 'pages' && !kitIn.library ? await ensureLibrary(kitIn, log) : kitIn;
  const out = styleId ? path.join(kit.pluginDir, '_gallery', `preview-${styleId}.mp4`) : previewFile(kit.pluginDir);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ffmpeg = s.ffmpeg || 'ffmpeg';
  /* pages: a demo do estilo (o escolhido ou o primeiro com demo), em torno do quadro-chave */
  if (kit.kind === 'pages') {
    /* o estilo pedido; para a prévia do plugin, o primeiro que renderizar (demos de arquivo/filmagem dependem de mídia que não vem na biblioteca) */
    const all = (kit.styleInfo ?? []).filter((x) => x.demo);
    const cands = styleId ? all.filter((x) => x.id === styleId) : all.slice(0, 6);
    if (!cands.length) throw new Error('a biblioteca não tem demos de estilo');
    const modules = await ensureKitDeps(s, kit.library!, log);
    const host = r.host({ root: kit.library!, modules, fallbackFont: libraryFallbackFont(kit.library!) });
    let last = '';
    for (const st of cands) {
      await ensureStyleFonts(st.demo!, log).catch(() => {});
      const rel = path.relative(kit.library!, st.demo!).split(path.sep).join('/');
      const mid = st.frameSec ?? 4, dur = st.dur ?? mid + seconds;
      const from = Math.max(0, Math.min(mid - seconds / 2, dur - seconds));
      log(`prévia: estilo ${st.name} ${from.toFixed(1)}–${(from + seconds).toFixed(1)} s`);
      try {
        const res = await r.frames({ url: `forge-scene://${host}/${rel}/index.html`, w: 1920, h: 1080, ffmpeg, fps: 24, mode: 'page', from, to: from + seconds, out, log });
        if (res.errors.length) log(`avisos do estilo: ${res.errors.slice(0, 3).join(' | ')}`);
        return out;
      } catch (e) { last = `${st.name}: ${(e as Error).message.slice(0, 200)}`; log(`estilo ${st.name} não renderizou — ${last}`); }
    }
    throw new Error(`nenhuma demo renderizou (${last})`);
  }
  /* node-film: um filme de exemplo rodado no navegador (adaptadores de Node + run() que só captura setup/frame) */
  if (kit.kind === 'node-film') {
    const film = kit.examples[0];
    if (!film) throw new Error('o plugin não traz filmes de exemplo');
    const page = writeFilmRunner(kit, film);
    const host = r.host({ root: kit.pluginDir });
    log(`prévia: exemplo ${path.basename(path.dirname(film))}`);
    const res = await r.frames({ url: `forge-scene://${host}/${page}`, w: 1920, h: 1080, ffmpeg, fps: 30, mode: 'page', from: 2, to: 2 + seconds, out, log });
    if (res.errors.length) log(`avisos do exemplo: ${res.errors.slice(0, 3).join(' | ')}`);
    return out;
  }
  const ex = kit.examples[0];
  if (!ex) throw new Error('o plugin não traz exemplo para a prévia');
  if (kit.kind === 'player') {
    const modules = await ensureKitDeps(s, kit.kitDir, log);
    const cfg = JSON.parse(fs.readFileSync(path.join(ex, 'config.json'), 'utf8')) as { aspect?: string; fps?: number };
    const story = JSON.parse(fs.readFileSync(path.join(ex, 'story', 'shots.json'), 'utf8')) as { shots: Array<{ start: number; end: number }> };
    const vertical = cfg.aspect === '9:16';
    const w = vertical ? 540 : 960, h = vertical ? 960 : 540;
    /* começa depois do fade de entrada, no meio do primeiro plano mais longo dos primeiros 20 s */
    const shot = [...story.shots].filter((x) => x.start < 20).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0] ?? story.shots[0]!;
    const from = Math.max(0.6, shot.start), to = from + seconds;
    const host = r.host({ root: kit.kitDir, project: ex, modules });
    log(`prévia: ${path.basename(ex)} ${from.toFixed(1)}–${to.toFixed(1)} s`);
    const res = await r.frames({ url: `forge-scene://${host}/player.html?scale=0.5`, w, h, ffmpeg, fps: cfg.fps ?? 24, mode: 'player', from, to, out, log });
    if (res.errors.length) log(`avisos do kit: ${res.errors.slice(0, 3).join(' | ')}`);
    return out;
  }
  const built = buildPiece(kit.skillDir, ex, path.join(kit.pluginDir, '_gallery', 'build', path.basename(path.dirname(ex)) + '-' + path.basename(ex), 'index.html'));
  const host = r.host({ root: path.dirname(built.file) });
  const vertical = built.h > built.w;
  const res = await r.frames({ url: `forge-scene://${host}/index.html?export=1`, w: vertical ? 540 : 960, h: vertical ? 960 : 540, ffmpeg, fps: built.fps, mode: 'piece', from: 0, to: Math.min(seconds, built.duration), out, log });
  if (res.errors.length) log(`avisos do kit: ${res.errors.slice(0, 3).join(' | ')}`);
  return out;
}

/* ───────── produção: projeto do FilmForge no formato do kit "player" ───────── */

export const projectKitDir = (projectDir: string) => path.join(projectDir, 'kit');

/** Motor do primeiro plugin marcado no projeto que produz cenas: "player" (planos) ou "pages" com a biblioteca baixada. */
export function projectKit(pluginsRoot: string, p: Pick<Project, 'plugins'>): KitInfo | undefined {
  for (const id of p.plugins ?? []) {
    const k = detectKit(path.join(pluginsRoot, id));
    if (k?.kind === 'player' || (k?.kind === 'pages' && k.library)) return k;
  }
  return undefined;
}

export interface KitTiming { [sceneId: string]: { start: number; end: number } }

/** Grava config.json, story/shots.json e timeline/words.json do projeto no formato do kit (cada cena = um plano). */
export function syncKitProject(p: Project, projectDir: string, o: { style?: string; resolution?: string; readWords: (sceneDir: string) => Array<{ w: string; start: number; end: number }> | undefined; sceneDir: (id: string) => string }): KitTiming {
  const dir = projectKitDir(projectDir);
  for (const d of ['story', 'timeline', 'scenes/shots', 'scenes/sets']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const timing: KitTiming = {};
  const shots: Array<Record<string, unknown>> = [];
  const words: Array<{ word: string; start: number; end: number }> = [];
  let t = 0;
  for (const sc of [...p.scenes].sort((a, b) => a.index - b.index)) {
    const dur = Math.max(0.5, sc.durationSec || 4);
    timing[sc.id] = { start: t, end: t + dur };
    shots.push({ id: sc.id, start: +t.toFixed(3), end: +(t + dur).toFixed(3), line: sc.narration ?? '', scene: sc.visualIntent ?? '', in: { type: 'cut' } });
    for (const w of o.readWords(o.sceneDir(sc.id)) ?? []) words.push({ word: w.w, start: +(t + w.start).toFixed(3), end: +(t + w.end).toFixed(3) });
    t += dur;
  }
  const cfgFile = path.join(dir, 'config.json');
  const prev = (() => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')) as Record<string, unknown>; } catch { return {}; } })();
  const cfg = { ...prev, title: p.name, aspect: p.aspect === '9:16' ? '9:16' : '16:9', resolution: o.resolution ?? '1080p', fps: 30, style: o.style ?? (prev['style'] as string) ?? 'dusk',
    duration: +t.toFixed(3), captions: false, bars: prev['bars'] ?? null, fadeIn: 0, fadeOut: 0, music: { enabled: false }, sfx: { enabled: false } };
  const write = (f: string, v: unknown) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 1)); fs.renameSync(tmp, f); };
  write(cfgFile, cfg);
  write(path.join(dir, 'story', 'shots.json'), { title: p.name, duration: +t.toFixed(3), shots });
  write(path.join(dir, 'timeline', 'words.json'), words);
  return timing;
}

/** Arquivo do plano (módulo registerShot) de uma cena. */
export const shotFileOf = (projectDir: string, sceneId: string) => path.join(projectKitDir(projectDir), 'scenes', 'shots', `${sceneId}.js`);

/* ───────── node-film: rodar no navegador um filme escrito para Node (claude-animation) ───────── */

/** Adaptador do @napi-rs/canvas para o navegador. */
export const CANVAS_SHIM = [
  '// Gerado pelo FilmForge: @napi-rs/canvas → canvas do navegador (cenas HTML).',
  'export function createCanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }',
  'export const Path2D = globalThis.Path2D;',
  'export const DOMMatrix = globalThis.DOMMatrix;',
  'export const ImageData = globalThis.ImageData;',
  'export const Image = globalThis.Image;',
  'export async function loadImage(src) { const i = new Image(); i.src = typeof src === "string" ? src : URL.createObjectURL(new Blob([src])); await i.decode(); return i; }',
  'export const GlobalFonts = { registerFromPath() { return true; }, register() { return true; }, families: [] };',
  'export default { createCanvas, Path2D, DOMMatrix, ImageData, Image, loadImage, GlobalFonts };',
].join('\n');

const NODE_SHIMS: Record<string, string> = {
  'path.mjs': [
    'const norm = (p) => { const abs = p.startsWith("/"); const out = []; for (const s of p.split("/")) { if (!s || s === ".") continue; if (s === "..") out.pop(); else out.push(s); } return (abs ? "/" : "") + out.join("/"); };',
    'export const join = (...a) => norm(a.filter((x) => x != null && x !== "").join("/"));',
    'export const resolve = (...a) => { let r = ""; for (const x of a) r = String(x).startsWith("/") ? String(x) : r + "/" + x; return norm(r || "/"); };',
    'export const dirname = (p) => { const n = norm(p); const i = n.lastIndexOf("/"); return i <= 0 ? (n.startsWith("/") ? "/" : ".") : n.slice(0, i); };',
    'export const basename = (p, ext) => { const b = norm(p).split("/").pop() || ""; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };',
    'export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; };',
    'export const sep = "/"; export const relative = (a, b) => b; export const isAbsolute = (p) => String(p).startsWith("/");',
    'export default { join, resolve, dirname, basename, extname, sep, relative, isAbsolute };',
  ].join('\n'),
  'fs.mjs': [
    'const no = () => false, none = () => undefined;',
    'export const existsSync = no, mkdirSync = none, writeFileSync = none, rmSync = none, unlinkSync = none, appendFileSync = none;',
    'export const readFileSync = () => { throw new Error("arquivo indisponível no navegador"); };',
    'export const readdirSync = () => [], statSync = () => ({ isDirectory: no, isFile: no, size: 0 });',
    'export const promises = { readFile: async () => { throw new Error("arquivo indisponível"); }, writeFile: async () => {}, mkdir: async () => {} };',
    'export default { existsSync, mkdirSync, writeFileSync, rmSync, unlinkSync, appendFileSync, readFileSync, readdirSync, statSync, promises };',
  ].join('\n'),
  'url.mjs': 'export const fileURLToPath = (u) => decodeURIComponent(new URL(String(u)).pathname); export const pathToFileURL = (p) => new URL(p, location.origin); export default { fileURLToPath, pathToFileURL };',
  'cp.mjs': 'export const spawn = () => { throw new Error("sem processos no navegador"); }; export const spawnSync = () => ({ status: 1 }); export const execSync = () => ""; export default { spawn, spawnSync, execSync };',
  'film.mjs': 'export async function run(F) { window.__FF_FILM = F; } export default { run };',
  'napi-canvas.mjs': '',
};

/** Escreve a página que roda um film.mjs de exemplo no navegador; devolve o caminho relativo ao plugin. */
export function writeFilmRunner(kit: KitInfo, film: string): string {
  const dir = path.join(kit.pluginDir, '_gallery', 'runner');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, src] of Object.entries(NODE_SHIMS)) fs.writeFileSync(path.join(dir, name), name === 'napi-canvas.mjs' ? CANVAS_SHIM : src);
  const url = (p: string) => '/' + path.relative(kit.pluginDir, p).split(path.sep).join('/');
  const lib = url(kit.kitDir);
  const R = url(dir);
  const imports: Record<string, string> = {};
  for (const [k, f] of [['path', 'path'], ['fs', 'fs'], ['url', 'url'], ['child_process', 'cp']]) { imports[k] = `${R}/${f}.mjs`; imports[`node:${k}`] = `${R}/${f}.mjs`; }
  imports['@napi-rs/canvas'] = `${R}/napi-canvas.mjs`;
  imports[`${lib}/film.mjs`] = `${R}/film.mjs`;
  imports[`${path.posix.dirname(lib)}/node_modules/@napi-rs/canvas/index.js`] = `${R}/napi-canvas.mjs`;
  const name = path.basename(path.dirname(film));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
<style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style>
<script type="importmap">${JSON.stringify({ imports })}</script></head><body>
<script>window.process = { env: { CLAUDE_ANIMATION_LIB: ${JSON.stringify(lib)}, HOME: "/home", FONT_DIR: "/fonts" }, argv: ["node", "film.mjs", "preview"], platform: "browser", cwd: () => "/", exit() {} };</script>
<script type="module">
import(${JSON.stringify(url(film))}).then(async () => {
  const F = window.__FF_FILM; if (!F) throw new Error('o filme não chamou run()');
  const S = F.setup ? await F.setup() : undefined;
  const W = F.W || 1920, H = F.H || 1080, fps = F.fps || 30;
  const c = document.createElement('canvas'); c.width = W; c.height = H; document.body.appendChild(c);
  const ctx = c.getContext('2d');
  window.DUR = F.dur || 10;
  window.render = async (t) => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); await F.frame(ctx, t, Math.round(t * fps), S); };
  window.READY = true;
}).catch((e) => { window.__FORGE_ERR = String((e && e.stack) || e); console.error('FILM ERROR', window.__FORGE_ERR); });
</script></body></html>`;
  const page = path.join(dir, `${name}.html`);
  fs.writeFileSync(page, html);
  return url(page).slice(1);
}

/* ───────── fontes das demos (pages): repositórios não versionam fontes de terceiros ───────── */

/** Fonte de reserva da biblioteca (core/fonts/*.woff2) para fontes que não puderam ser baixadas. */
export function libraryFallbackFont(lib: string): string | undefined {
  const d = path.join(lib, 'core', 'fonts');
  const f = isDir(d) ? fs.readdirSync(d).filter((x) => /\.(woff2?|ttf|otf)$/i.test(x)).sort()[0] : undefined;
  return f ? path.join(d, f) : undefined;
}

const WEIGHTS: Record<string, number> = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, book: 400, normal: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };

/** "ArchitectsDaughter-Regular.ttf" → { family: "Architects Daughter", weight: 400, italic: false } (função pura). */
export function fontFromFile(file: string): { family: string; weight: number; italic: boolean } {
  const base = path.basename(file).replace(/\.(ttf|otf|woff2?)$/i, '').replace(/\[.*?\]/g, '');
  const [name, style = 'Regular'] = base.split('-');
  const family = name!.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([0-9])([A-Z][a-z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  const st = style.toLowerCase();
  const italic = /italic|oblique/.test(st);
  const w = Object.entries(WEIGHTS).find(([k]) => st.replace(/italic|oblique/, '') === k)?.[1] ?? (italic && st.replace(/italic|oblique/, '') === '' ? 400 : 400);
  return { family, weight: w, italic };
}

/** Baixa do Google Fonts as fontes que o CSS do estilo cita e não existem na pasta (melhor esforço). */
export async function ensureStyleFonts(demoDir: string, log?: (l: string) => void): Promise<number> {
  const cssFiles = [path.join(demoDir, 'fonts', 'fonts.css'), ...fs.readdirSync(demoDir).filter((f) => f.endsWith('.css')).map((f) => path.join(demoDir, f))].filter((f) => fs.existsSync(f));
  let got = 0;
  for (const css of cssFiles) {
    const txt = fs.readFileSync(css, 'utf8');
    for (const m of txt.matchAll(/url\((['"]?)([^)'"]+\.(?:ttf|otf|woff2?))\1\)/gi)) {
      const rel = m[2]!;
      if (/^(https?:|data:|\/)/.test(rel)) continue;
      const dest = path.join(path.dirname(css), rel);
      if (fs.existsSync(dest)) continue;
      const f = fontFromFile(rel);
      try {
        const q = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family).replace(/%20/g, '+')}:ital,wght@${f.italic ? 1 : 0},${f.weight}`;
        const cssTxt = await (await fetch(q, { signal: AbortSignal.timeout(20_000) })).text();
        const u = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(cssTxt)?.[1];
        if (!u) continue;
        const b = Buffer.from(await (await fetch(u, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, b);
        got++;
      } catch { /* fica a fonte de reserva */ }
    }
  }
  if (got && log) log(`${got} fonte(s) do estilo baixada(s) do Google Fonts`);
  return got;
}
