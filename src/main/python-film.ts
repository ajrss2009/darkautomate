import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { Binding, Settings } from '../shared/types';

/*
 * KIT COM MOTOR PYTHON ("python-film"): skills como a kaz-short-films renderizam o filme inteiro a partir de um
 * STORYBOARD JSON com o próprio script (scripts/render.py: Pillow + numpy + ffmpeg, sem rede). No FilmForge:
 *   1) a IA escreve o storyboard seguindo o schema do kit, o exemplo completo e as referências (regras do kit);
 *   2) o app VALIDA o JSON (cenas, durações, sets/paletas/poses que o motor conhece) e devolve o erro à IA uma vez;
 *   3) o motor do kit renderiza out/final.mp4 (e a folha de contato out/storyboard-sheet.jpg).
 * Assim o resultado sai com o MESMO visual do exemplo do kit — quem desenha é o código do autor, não a IA.
 */

export interface PythonFilm { root: string; render: string; schema?: string; refs: string[]; examples: string[] }

/** Procura o motor: <dir>/scripts/render.py + exemplos .json com "scenes" (até 5 níveis). */
export function detectPythonFilm(root: string): PythonFilm | undefined {
  const tryDir = (d: string): PythonFilm | undefined => {
    const render = path.join(d, 'scripts', 'render.py');
    if (!fs.existsSync(render)) return undefined;
    const exDir = path.join(d, 'examples');
    const examples = fs.existsSync(exDir) ? fs.readdirSync(exDir).filter((f) => /\.json$/i.test(f)).map((f) => path.join(exDir, f))
      .filter((f) => { try { return Array.isArray((JSON.parse(fs.readFileSync(f, 'utf8')) as { scenes?: unknown }).scenes); } catch { return false; } }) : [];
    if (!examples.length) return undefined;
    const refDir = path.join(d, 'references');
    const refs = fs.existsSync(refDir) ? fs.readdirSync(refDir).filter((f) => /\.md$/i.test(f)).map((f) => path.join(refDir, f)) : [];
    return { root: d, render, schema: refs.find((f) => /schema/i.test(path.basename(f))), refs, examples };
  };
  const walk = (d: string, depth: number): PythonFilm | undefined => {
    const hit = tryDir(d); if (hit) return hit;
    if (depth >= 5) return undefined;
    let es: fs.Dirent[] = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return undefined; }
    for (const e of es) if (e.isDirectory() && !/^(node_modules|\.git|__pycache__|reference_screenshots|assets)$/i.test(e.name)) { const r = walk(path.join(d, e.name), depth + 1); if (r) return r; }
    return undefined;
  };
  return walk(root, 0);
}

/** Vocabulário que o motor aceita, lido do schema (`set` → `bedroom` `couch`…). Função pura. */
export function schemaVocab(schema: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of schema.split(/\r?\n/)) {
    const m = /^\|\s*`([\w_]+)`[^|]*\|[^|]*\|\s*(.+)\|\s*$/.exec(line);
    if (!m) continue;
    const vals = [...m[2]!.matchAll(/`([a-z_]+)`/g)].map((x) => x[1]!);
    if (vals.length >= 3) out[m[1]!] = vals;
  }
  const pose = /`pose`\s*\(([^)]*)\)/.exec(schema)?.[1]; if (pose) out['pose'] = [...pose.matchAll(/`([a-z_]+)`/g)].map((x) => x[1]!);
  const mood = /`mood`\s*\(([^)]*)\)/.exec(schema)?.[1]; if (mood) out['mood'] = [...mood.matchAll(/`([a-z_]+)`/g)].map((x) => x[1]!);
  return out;
}

/** Confere o storyboard antes de renderizar: cenas, durações e os valores que o motor conhece. Função pura. */
export function storyboardProblem(j: unknown, vocab: Record<string, string[]>, targetSec?: number): string | undefined {
  const sb = j as { scenes?: Array<Record<string, unknown>> };
  if (!sb || !Array.isArray(sb.scenes) || !sb.scenes.length) return 'o JSON precisa de "scenes": [ … ] com pelo menos uma cena';
  const errs: string[] = [];
  let total = 0;
  sb.scenes.forEach((sc, i) => {
    const d = Number(sc['duration']);
    if (!(d > 0)) errs.push(`cena ${i}: "duration" (segundos) é obrigatório`); else total += d;
    for (const k of ['set', 'palette', 'music']) if (sc[k] !== undefined && vocab[k] && !vocab[k]!.includes(String(sc[k]))) errs.push(`cena ${i}: ${k} "${String(sc[k])}" não existe (use: ${vocab[k]!.join(', ')})`);
    const heroes = Array.isArray(sc['hero']) ? sc['hero'] as Array<Record<string, unknown>> : sc['hero'] ? [sc['hero'] as Record<string, unknown>] : [];
    for (const h of heroes) for (const k of ['pose', 'mood']) if (h[k] !== undefined && vocab[k] && !vocab[k]!.includes(String(h[k]))) errs.push(`cena ${i}: hero.${k} "${String(h[k])}" não existe (use: ${vocab[k]!.join(', ')})`);
  });
  if (targetSec && total > 0 && Math.abs(total - targetSec) > Math.max(0.6, targetSec * 0.12)) errs.push(`a soma das durações é ${total.toFixed(1)} s; o filme tem de ter ${targetSec} s`);
  return errs.length ? errs.slice(0, 8).join('; ') : undefined;
}

const read = (f?: string) => { try { return f ? fs.readFileSync(f, 'utf8') : ''; } catch { return ''; } };

/** Pedido à IA: storyboard JSON do filme, com o schema, as regras e o exemplo do kit. Função pura. */
export function storyboardPrompt(k: PythonFilm, o: { idea: string; script?: string; targetSec: number; language: string; out: string; rules?: string }): string {
  const ex = read(k.examples.find((f) => !/gallery/i.test(f)) ?? k.examples[0]).slice(0, 9000);
  const refs = k.refs.filter((f) => f !== k.schema).map((f) => `### ${path.basename(f)}\n${read(f).slice(0, 4500)}`).join('\n\n');
  return [
    `Escreva o STORYBOARD JSON de um filme de ${o.targetSec} segundos para o motor do kit (${path.basename(k.render)}). Grave em ${o.out} (e imprima o JSON).`,
    `IDEIA: ${o.idea}`,
    o.script ? `ROTEIRO JÁ ESCRITO (siga):\n${o.script.slice(0, 4000)}` : '',
    `Idioma dos textos na tela (caption, whisper, title, sub, punch): ${o.language}.`,
    'REGRAS DO KIT (obrigatórias):', o.rules ?? '',
    `SCHEMA (só estes campos e valores existem):\n${read(k.schema).slice(0, 6000)}`,
    refs ? `REFERÊNCIAS DO KIT:\n${refs}` : '',
    `EXEMPLO COMPLETO que funciona (copie a forma, não as falas):\n${ex}`,
    `A SOMA de "duration" de todas as cenas = ${o.targetSec} s exatos. Filme curto: poucas cenas (${o.targetSec <= 8 ? '1 a 2' : o.targetSec <= 20 ? '3 a 5' : '15 a 30'}), uma ideia por cena.`,
    'Responda SÓ com o JSON válido ({ "title": …, "scenes": [ … ] }), sem comentários nem markdown. Não rode comandos nem peça confirmação.',
  ].filter(Boolean).join('\n\n');
}

/** Python do app com Pillow + numpy (instala no ambiente do app na 1ª vez). */
export function ensurePythonDeps(python: string, log: (l: string) => void): void {
  const ok = () => spawnSync(python, ['-c', 'import PIL, numpy'], { encoding: 'utf8', timeout: 60_000, windowsHide: true }).status === 0;
  if (ok()) return;
  log(`instalando Pillow e numpy no Python do app (${python}) para o motor do kit…`);
  const r = spawnSync(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'pillow', 'numpy'], { encoding: 'utf8', timeout: 600_000, windowsHide: true });
  if (!ok()) throw new Error(`o motor do kit precisa de Pillow e numpy no Python (${python}): ${(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ')}`);
}

/** Roda o motor do kit: storyboard → MP4 (ffmpeg do app no PATH). */
export function runPythonFilm(python: string, k: PythonFilm, story: string, out: string, o: { ffmpeg: string; res?: number; sheet?: string; signal?: AbortSignal; log: (l: string) => void }): Promise<void> {
  const env = { ...process.env, PATH: `${path.dirname(o.ffmpeg)}${path.delimiter}${process.env['PATH'] ?? ''}`, PYTHONIOENCODING: 'utf-8',
    /* modo UTF-8: no Windows o open() do motor lia o storyboard como cp1252 e os acentos saíam "VocÃª" */
    PYTHONUTF8: '1' };
  const run = (args: string[]) => new Promise<void>((ok, fail) => {
    const ch = spawn(python, [k.render, ...args], { cwd: path.dirname(story), env, windowsHide: true });
    let err = '';
    ch.stdout.on('data', (d) => { for (const l of String(d).split(/\r?\n/).filter(Boolean)) o.log(l.slice(0, 200)); });
    ch.stderr.on('data', (d) => { err += String(d); });
    o.signal?.addEventListener('abort', () => ch.kill(), { once: true });
    ch.on('close', (code) => (code === 0 ? ok() : fail(new Error(`motor do kit saiu com código ${code}: ${err.trim().split('\n').slice(-3).join(' ').slice(0, 400)}`))));
    ch.on('error', fail);
  });
  return (async () => {
    if (o.sheet) { try { await run([story, '--sheet', o.sheet]); } catch (e) { o.log(`folha de contato: ${(e as Error).message.slice(0, 160)}`); } }
    await run([story, '-o', out, '--res', String(o.res ?? 720)]);
  })();
}

/** Bindings de texto do projeto (as da etapa de roteiro da rota), para a IA escrever o storyboard. */
export const textBindingsOf = (route?: { steps: Array<{ kind: string; bindings: Binding[] }> }): Binding[] =>
  route?.steps.find((s) => s.kind === 'script')?.bindings ?? [{ type: 'harness', harness: 'auto' }];

export const pythonOf = (s: Settings) => s.whisper?.python || 'python';
