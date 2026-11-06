import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginStyle } from '../shared/types';

/**
 * Repositórios de RECURSOS (não-plugins) viram plugins no formato do Claude:
 * uma coleção de prompts de estilo (prompts/*.md) ganha `.claude-plugin/plugin.json`
 * e uma skill por estilo (`skills/<id>/SKILL.md`), mais o `filmforge.json` com capas,
 * vídeos de exemplo, trilha sugerida (receitas do mgaudio) e recursos (lib/audio).
 * Exemplo: github.com/Vincentwei1021/mg-styles-15.
 */

export interface FilmforgeManifest {
  adapter: 'prompts-repo';
  homepage?: string;
  styles: PluginStyle[];
  resources: Array<{ id: string; label: string; path: string }>;
}

const CJK = /[⺀-鿿　-〿＀-￯「」『』（）：，。、]+/g;
/** Parte em alfabeto latino depois do último caractere chinês (títulos bilíngues "中文 English"). */
function latinTail(s: string): string {
  const all = [...s.matchAll(new RegExp(CJK.source, 'g'))];
  const last = all[all.length - 1];
  const tail = (last ? s.slice(last.index! + last[0].length) : s).replace(/^[\s:：·\-–)）/]+/, '').replace(/\s+/g, ' ').trim();
  return tail.length >= 3 ? tail : s.replace(CJK, ' ').replace(/^[\s:：·\-–/]+/, '').replace(/\s+/g, ' ').trim();
}
const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** É uma coleção de prompts de estilo? (pasta prompts/ com vários .md com bloco de prompt) */
export function isPromptsRepo(dir: string): boolean {
  const p = path.join(dir, 'prompts');
  if (!fs.existsSync(p)) return false;
  return fs.readdirSync(p).filter((f) => /\.md$/i.test(f) && /```/.test(read(path.join(p, f)))).length >= 2;
}

/** Receitas de trilha por estilo declaradas no mgaudio (recipes/__init__.py → STYLES). */
function mgRecipes(dir: string): Record<string, { recipe: string; sfx: string }> {
  const src = read(path.join(dir, 'lib', 'audio', 'mgaudio', 'recipes', '__init__.py'));
  const out: Record<string, { recipe: string; sfx: string }> = {};
  for (const m of src.matchAll(/'(\d\d-[\w-]+)':\s*\('(\w+)',[^\n]*?,\s*'([^']*)'\),?\s*$/gm)) out[m[1]!] = { recipe: m[2]!, sfx: m[3]! };
  for (const m of src.matchAll(/'(\d\d-[\w-]+)':\s*\('(\w+)'/g)) out[m[1]!] ??= { recipe: m[2]!, sfx: '' };
  return out;
}

const ADAPT_NOTE = (name: string) => [
  `ADAPTAÇÃO FILMFORGE (estilo "${name}"): o prompt original pede UM filme de 10 s (renderAt(t), audio.py, render.mjs).`,
  'No FilmForge o vídeo é dividido em CENAS: cada cena de código é UMA página HTML autocontida com o contrato window.__forge = { duration, fps, seek(t), pause() } e a duração da cena (não 10 s).',
  'Aplique a direção de arte, a técnica e as "Signature features" do estilo a CADA cena, mantendo a mesma paleta/tipografia entre as cenas; o "Creative seed" é só um exemplo: use o tema do projeto.',
  'Som: declare window.__forge.sfx = [{ t, name }] nos instantes dos eventos da animação; a trilha é gerada por código na etapa de música (mgaudio). Sem rede, sem bibliotecas externas (GSAP/Three só se o arquivo estiver embutido).',
].join('\n');

/** Converte (no lugar) a coleção em plugin do Claude e devolve o manifesto do FilmForge. */
export function adaptPromptsRepo(dir: string, opts: { name: string; homepage?: string }): FilmforgeManifest {
  const recipes = mgRecipes(dir);
  const styles: PluginStyle[] = [];
  for (const f of fs.readdirSync(path.join(dir, 'prompts')).filter((x) => /\.md$/i.test(x)).sort()) {
    const md = read(path.join(dir, 'prompts', f));
    const block = /```(?:text)?\r?\n([\s\S]*?)```/.exec(md)?.[1]?.trim();
    if (!block) continue;
    const id = f.replace(/\.md$/i, '');
    const heading = /^#\s+(.+)$/m.exec(md)?.[1] ?? id;
    const name = latinTail(heading) || id;
    /* "**原片**：隼眼-9 · 目标锁定 KESTREL-9 TARGET ACQUIRED · 1920×1080 · …" → "KESTREL-9 TARGET ACQUIRED" */
    const film = latinTail(/\*\*[^*]+\*\*[:：]\s*(.+?)\s*·\s*\d{3,4}\s*[×x]/.exec(md)?.[1] ?? '') || undefined;
    const style = name;
    const skill = id;
    const sdir = path.join(dir, 'skills', skill);
    fs.mkdirSync(sdir, { recursive: true });
    const desc = `Motion design no estilo ${style || name}: direção de arte, animação e som escritos em código.`;
    fs.writeFileSync(path.join(sdir, 'SKILL.md'), `---\nname: ${skill}\ndescription: "${desc.replace(/"/g, "'")}"\n---\n\n${ADAPT_NOTE(style || name)}\n\n## Prompt original do estilo\n\n${block}\n`, 'utf8');
    const cover = ['videos', 'docs'].map((d) => path.join(d, `${id}.jpg`)).find((r) => fs.existsSync(path.join(dir, r)));
    const r = recipes[id];
    styles.push({ id, name: style || name, film, summary: desc, skill, cover, video: `videos/${id}.mp4`,
      videoUrl: opts.homepage ? `${opts.homepage.replace(/\/+$/, '')}/videos/${id}.mp4` : undefined, music: r?.recipe, sfx: r?.sfx });
  }
  const resources: FilmforgeManifest['resources'] = [];
  if (fs.existsSync(path.join(dir, 'lib', 'audio', 'mgaudio'))) resources.push({ id: 'mgaudio', label: 'mgaudio — música e efeitos sonoros por código (Python)', path: 'lib/audio' });
  if (fs.existsSync(path.join(dir, 'harness', 'render.mjs'))) resources.push({ id: 'render', label: 'render.mjs — renderizador de quadros (referência)', path: 'harness/render.mjs' });
  if (fs.existsSync(path.join(dir, 'demos'))) resources.push({ id: 'demos', label: 'Código-fonte dos filmes de exemplo (referência para as cenas)', path: 'demos' });
  const manifest: FilmforgeManifest = { adapter: 'prompts-repo', homepage: opts.homepage, styles, resources };
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  const pkg = (() => { try { return JSON.parse(read(path.join(dir, 'package.json'))) as { version?: string; description?: string }; } catch { return {}; } })();
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: opts.name, version: pkg.version ?? '1.0.0',
    description: `${styles.length} estilos de motion design (cada um uma skill) + recursos de som por código${resources.some((x) => x.id === 'mgaudio') ? ' (mgaudio)' : ''}. Convertido pelo FilmForge.`,
    homepage: opts.homepage,
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'filmforge.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function readManifest(dir: string): FilmforgeManifest | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'filmforge.json'), 'utf8')) as FilmforgeManifest; } catch { return undefined; }
}

/** Arquivos pesados que não entram na instalação (vídeos de demonstração, site, dependências). */
export const skipOnInstall = (rel: string): boolean =>
  /(^|[\\/])(node_modules|\.git|site)([\\/]|$)/.test(rel) || /(^|[\\/])videos[\\/][^\\/]+\.(mp4|webm|mov)$/i.test(rel);
