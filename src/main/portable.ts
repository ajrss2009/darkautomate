import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Modo portátil: TUDO o que o usuário cria (configurações, chaves de API, skills, rotas,
 * tipos, agentes, plugins, vozes, perfis) fica numa pasta `FilmForgeData` ao lado do .exe.
 * Copie a pasta do app (ou o pendrive) para outro PC e tudo vem junto.
 *
 * Ativa quando:
 *  - a variável FILMFORGE_DATA aponta uma pasta; ou
 *  - roda o executável portátil (electron-builder define PORTABLE_EXECUTABLE_DIR); ou
 *  - existe a pasta `FilmForgeData` (ou o arquivo `portable.txt`) ao lado do FilmForge.exe.
 *
 * Caminhos dentro da pasta de dados são gravados como `{DATA}/…`, então trocar a letra
 * do drive ou mover a pasta não quebra nada. As chaves de API são cifradas com uma chave
 * guardada na própria pasta (a criptografia do Windows prende a chave ao PC).
 */

export const DATA_TOKEN = '{DATA}';
export const DATA_DIR_NAME = 'FilmForgeData';

export interface DataRoot { root: string; reason: string }

export function resolveDataRoot(opts: { packaged: boolean; execPath: string }): DataRoot | undefined {
  const env = process.env.FILMFORGE_DATA?.trim();
  if (env) return { root: path.resolve(env), reason: 'FILMFORGE_DATA' };
  if (!opts.packaged) return undefined;
  const portableExe = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
  if (portableExe) return { root: path.join(portableExe, DATA_DIR_NAME), reason: 'executável portátil' };
  const exeDir = path.dirname(opts.execPath);
  if (fs.existsSync(path.join(exeDir, DATA_DIR_NAME)) || fs.existsSync(path.join(exeDir, 'portable.txt')))
    return { root: path.join(exeDir, DATA_DIR_NAME), reason: `pasta ${DATA_DIR_NAME} ao lado do app` };
  return undefined;
}

/** Troca caminhos absolutos dentro da pasta de dados por {DATA}/… (e o contrário). */
export function tokenize<T>(v: T, root: string): T {
  const base = path.resolve(root);
  const low = base.toLowerCase();
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') {
      const l = x.toLowerCase();
      if (l === low) return DATA_TOKEN;
      if (l.startsWith(low + '\\') || l.startsWith(low + '/')) return DATA_TOKEN + '/' + x.slice(base.length + 1).replace(/\\/g, '/');
      return x;
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v) as T;
}
export function expand<T>(v: T, root: string): T {
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return x === DATA_TOKEN ? root : x.startsWith(DATA_TOKEN + '/') ? path.join(root, ...x.slice(DATA_TOKEN.length + 1).split('/')) : x;
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v) as T;
}

/* ───────── chaves de API cifradas com uma chave que viaja junto com a pasta ───────── */

const keyFile = (appData: string) => path.join(appData, '.keyring');
function portableKey(appData: string): Buffer {
  const f = keyFile(appData);
  try { const k = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64'); if (k.length === 32) return k; } catch { /* cria */ }
  const k = crypto.randomBytes(32);
  fs.mkdirSync(appData, { recursive: true });
  fs.writeFileSync(f, k.toString('base64'));
  return k;
}
export function sealPortable(appData: string, plain: string): string {
  if (!plain) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', portableKey(appData), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'pk1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function openPortable(appData: string, s: string): string | undefined {
  if (!s?.startsWith('pk1:')) return undefined;
  try {
    const b = Buffer.from(s.slice(4), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', portableKey(appData), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
}

/* ───────── pasta movida: reescreve caminhos antigos em skills/rotas/projetos ───────── */

const TEXT = /\.(json|md)$/i;
/** Troca `from` por `to` em todos os .json/.md de library/ e no project.json de cada projeto. */
export function relocate(dirs: string[], from: string, to: string): number {
  if (!from || path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) return 0;
  const variants = [from, from.replace(/\\/g, '/'), from.replace(/\\/g, '\\\\')];
  const targets = [to, to.replace(/\\/g, '/'), to.replace(/\\/g, '\\\\')];
  let n = 0;
  const fix = (f: string) => {
    try {
      const txt = fs.readFileSync(f, 'utf8');
      let out = txt;
      variants.forEach((v, i) => { out = out.split(v).join(targets[i]!); });
      if (out !== txt) { fs.writeFileSync(f, out); n++; }
    } catch { /* ignora */ }
  };
  const walk = (d: string, depth: number) => {
    if (depth > 3 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^(node_modules|\.git|_gallery|scenes|out|cache)$/.test(e.name)) walk(full, depth + 1); }
      else if (TEXT.test(e.name) && (depth < 2 || e.name === 'project.json')) fix(full);
    }
  };
  for (const d of dirs) walk(d, 0);
  return n;
}


/** Copia o perfil (biblioteca, plugins, vozes… — tudo menos projetos e caches) de um workspace para outro. */
export function copyProfile(fromWorkspace: string, toWorkspace: string, overwrite = false): string[] {
  const done: string[] = [];
  if (!fs.existsSync(fromWorkspace)) return done;
  for (const e of fs.readdirSync(fromWorkspace, { withFileTypes: true })) {
    /* projetos (enormes) e instalações locais (venv do Whisper, dependências de plugins) não viajam: são do PC */
    if (/^(projects|tools|plugin-deps|node_modules)$/i.test(e.name) || /cache|tmp|temp|venv/i.test(e.name)) continue;
    const src = path.join(fromWorkspace, e.name), dst = path.join(toWorkspace, e.name);
    try {
      if (path.resolve(src) === path.resolve(dst)) continue;
      fs.cpSync(src, dst, { recursive: true, force: overwrite, errorOnExist: false });
      done.push(e.name);
    } catch { /* ignora o que não copiar */ }
  }
  return done;
}
