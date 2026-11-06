/* Instala o plugin do GitHub e mostra o que o FilmForge enxerga/injeta. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultSettings } from '../main/settings';
import { installPluginUrl, listPlugins, pluginPrompt, pluginsRoot } from '../main/plugins';

async function main() {
  const real = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA ?? '', 'filmforge', 'settings.json'), 'utf8'));
  const ws = real.workspace as string;
  const s = { ...defaultSettings(ws), ...real, workspace: ws } as ReturnType<typeof defaultSettings>;
  console.log('pluginsRoot:', pluginsRoot(s));
  const p = await installPluginUrl(s, 'https://github.com/buildwithhanif/claude-animation-skill');
  console.log('instalado:', JSON.stringify({ id: p.id, name: p.name, version: p.version, skills: p.skills, commands: p.commands, agents: p.agents, mcp: p.mcp }, null, 1));
  console.log('--- arquivos (2 níveis) ---');
  const walk = (d: string, depth: number) => {
    if (depth > 3) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      console.log('  '.repeat(depth) + (e.isDirectory() ? e.name + '/' : e.name));
      if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
    }
  };
  walk(p.dir, 0);
  const txt = pluginPrompt(s, [p.id]);
  console.log('--- pluginPrompt:', txt.length, 'caracteres ---');
  console.log(txt.slice(0, 1200));
  console.log('...');
  console.log('tem SKILL.md?', /SKILL\.md/.test(fs.readdirSync(p.dir, { recursive: true }).map(String).join('\n')));
}
void main();
