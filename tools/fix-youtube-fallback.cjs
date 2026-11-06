/* Fallback Pexels no YouTube + retry/no-web_search no script do OL código+YouTube. */
const fs = require('fs');
const path = require('path');
const ROUTES = 'C:/Users/ajrss/OneDrive/Documentos/FilmForge/library/routes';
const PROJECTS = 'G:/PROJECTS/CLAUDE FILMFORGE/21 10 2026 - Copia/projects';

for (const id of ['forge-ag-codigo-youtube', 'forge-ol-codigo-youtube']) {
  const f = path.join(ROUTES, `${id}.json`);
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const st of r.steps) {
    if (st.id === 'stock') for (const b of st.bindings) if (b.type === 'stock') b.sources = ['youtube', 'pexels'];
    if (id.startsWith('forge-ol') && ['script', 'scene_plan', 'code_scene'].includes(st.id)) st.retry = { max: 3, backoffMs: 1000 };
  }
  fs.writeFileSync(f, JSON.stringify(r, null, 2));
  console.log('rota:', id);
}

for (const id of ['rel-03-codigo-youtube-ag-fd160d', 'rel-ol-codigo-youtube-14e66e']) {
  const f = path.join(PROJECTS, id, 'project.json');
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const st of p.route.steps) {
    if (st.id === 'stock') for (const b of st.bindings) if (b.type === 'stock') b.sources = ['youtube', 'pexels'];
    if (id.includes('rel-ol') && ['script', 'scene_plan', 'code_scene'].includes(st.id)) st.retry = { max: 3, backoffMs: 1000 };
  }
  if (id.includes('rel-ol') && p.skill) {
    p.skill.steps = p.skill.steps || {};
    p.skill.steps.script = `${p.skill.steps.script || ''} IMPORTANTE: NÃO use web_search; grave o arquivo script.md diretamente com a ferramenta write_file.`.trim();
    p.skill.steps.scene_plan = `${p.skill.steps.scene_plan || ''} IMPORTANTE: NÃO use web_search; grave scenes.json diretamente com write_file. Use SOMENTE os tipos de cena que a rota produz.`.trim();
  }
  fs.writeFileSync(f, JSON.stringify(p, null, 2));
  console.log('projeto:', id);
}
