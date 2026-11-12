/**
 * Execução headless de um projeto (fora do Electron) — usada para validar a produção sem abrir a janela.
 * Uso: node dist/dev/run-project.js <projectId>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultSettings, projectDirOf } from '../main/settings';
import { createExecutors } from '../main/executors';
import { runRoute } from '../main/engine';
import { openPortable } from '../main/portable';
import type { Project, Route, Settings } from '../shared/types';

const ROOT = path.resolve(__dirname, '..', '..');
const ID = process.argv[2] ?? 'dorama-10s-voz-de-referencia-1d7513';
const SETTINGS_FILE = 'C:/Users/ajrss/AppData/Roaming/filmforge/settings.json';
const DATA_ROOT = path.dirname(SETTINGS_FILE);
const LOG_FILE = path.join('C:/Users/ajrss/AppData/Local/Temp/opencode', `run-${ID}.log`);

/** As chaves de API ficam cifradas ("pk1:…") com o .keyring da pasta de dados: abre para o processo headless. */
function unseal<T>(v: T): T {
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') {
      if (!x.startsWith('pk1:')) return x;
      const plain = openPortable(DATA_ROOT, x);
      return plain || x;
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v) as T;
}

function readSettings(): Settings {
  const raw = unseal(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8').replace(/^\uFEFF/, '')) as Partial<Settings>);
  const def = defaultSettings(raw.workspace ?? 'C:/Users/ajrss/OneDrive/Documentos/FilmForge');
  return {
    ...def, ...raw,
    harnesses: { ...def.harnesses, ...(raw.harnesses ?? {}) },
    wan2gp: { ...def.wan2gp!, ...(raw.wan2gp ?? {}) },
    whisper: { ...def.whisper!, ...(raw.whisper ?? {}) },
    defaults: { ...def.defaults, ...(raw.defaults ?? {}) },
    providers: (raw.providers ?? def.providers) as Settings['providers'],
    // ffmpeg/ffprobe sempre os do pacote (o PATH deste processo pode não ter)
    ffmpeg: path.join(ROOT, 'tools', 'ffmpeg', 'win', 'ffmpeg.exe'),
    ffprobe: path.join(ROOT, 'tools', 'ffmpeg', 'win', 'ffprobe.exe'),
  } as Settings;
}

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
function log(line: string) {
  const s = line.replace(/\r?\n/g, ' ');
  console.log(s);
  logStream.write(s + '\n');
}

async function main() {
  const settings = readSettings();
  const dir = projectDirOf(settings, ID);
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')) as Project;
  process.env.PATH = `${path.join(ROOT, 'tools', 'ffmpeg', 'win')};${process.env.PATH ?? ''}`;

  log(`projeto: ${project.name} (${ID})`);
  log(`pasta: ${dir}`);
  log(`cenas: ${project.scenes.map((s) => `${s.id} ${s.durationSec}s "${s.narration}"`).join(' | ')}`);
  log(`ffmpeg: ${settings.ffmpeg}`);
  log(`wan2gp: ${settings.wan2gp?.python} (raiz ${settings.wan2gp?.root})`);

  const executors = createExecutors({
    workflowsDir: path.join(ROOT, 'workflows'),
    toolsDir: path.join(ROOT, 'tools'),
    renderHtml: (() => { throw new Error('renderHtml indisponível no modo headless'); }) as never,
    snapHtml: (() => { throw new Error('snapHtml indisponível no modo headless'); }) as never,
    kitRender: { host: '', frames: (async () => { throw new Error('kitRender indisponível no modo headless'); }) } as never,
  });

  const started = Date.now();
  const ac = new AbortController();
  process.on('SIGINT', () => { log('cancelando…'); ac.abort(); });

  const onlyArg = process.argv[3] ? { stepIds: process.argv[3].split(','), sceneIds: process.argv[4]?.split(',') } : undefined;
  const res = await runRoute({
    project,
    route: project.route as Route,
    projectDir: dir,
    signal: ac.signal,
    only: onlyArg,
    deps: {
      settings, executors,
      approve: async () => true,
      emit: (e) => {
        const el = Math.round((Date.now() - started) / 1000);
        const scope = 'sceneId' in e && e.sceneId ? `${e.sceneId} ` : '';
        if (e.t === 'log') log(`[${el}s] ${scope}${e.line}`);
        else log(`[${el}s] <${e.t}> ${scope}${JSON.stringify(e).slice(0, 400)}`);
      },
    },
  });

  log(`resultado: ${JSON.stringify(res)}`);
  const final = path.join(dir, 'out', 'final.mp4');
  if (fs.existsSync(final)) {
    const { execFileSync } = await import('node:child_process');
    const d = execFileSync(settings.ffprobe!, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', final]).toString().trim();
    log(`FINAL: ${final} — ${Number(d).toFixed(2)} s`);
  } else log('FINAL: out/final.mp4 não foi gerado');
  logStream.end();
}

main().catch((e) => { log(`ERRO: ${(e as Error).stack ?? e}`); logStream.end(); process.exitCode = 1; });
