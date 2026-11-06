import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canvasViolations, contractProblem, pageSyntaxProblem, scriptBlocks, smallModelBudget } from '../main/contract';
import { freeLibImport, pluginContract, pluginPrompt } from '../main/plugins';
import { defaultSettings } from '../main/settings';

/**
 * CONTRATO DA CENA com o plugin (modo modelo pequeno):
 *  1. pré-parse de sintaxe ANTES de gastar um render (node:vm);
 *  2. proibição de canvas cru quando a biblioteca do plugin tem rigs (config em filmforge.contract);
 *  3. orçamento de prompt para modelos locais pequenos (config maxPromptChars do plugin vence).
 */
async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-contract-'));
  const s = defaultSettings(ws);

  /* ── 1. pré-parse de sintaxe ── */
  const OK = `<!doctype html><html><body><script>
import { ant } from "./plugins/x/skill/lib/_all.mjs";
export const T = 3;
const g = document.getElementById("c").getContext("2d");
function render(t) { ant(g, 100 + t * 40, 500, {}); }
window.__forge = { duration: 1, fps: 30, seek(t) { render(t); }, pause() {} };
</script></body></html>`;
  assert.equal(pageSyntaxProblem(OK), undefined, 'módulo com import/export válido passa no pré-parse');

  const AWAIT = `<html><body><script type="module">
import L from "./plugin.js";
const img = await L.load();
L.draw(img, 0);
window.__forge = { duration: 1, fps: 30, seek(t) { L.draw(img, t); }, pause() {} };
</script></body></html>`;
  assert.equal(pageSyntaxProblem(AWAIT), undefined, 'await no nível do módulo não é falso positivo');

  const BROKEN = `<html><head></head><body><script>
function render(t) {
  const a = ;
  window.__forge = { duration: 1, fps: 30, seek(t) { render(t); }, pause() {} };
}
</script></body></html>`;
  const pb = pageSyntaxProblem(BROKEN)!;
  assert.match(pb!, /não compila/);
  assert.match(pb!, /Unexpected token ';'/, 'a mensagem traz o erro real do parse');
  assert.match(pb!, /linha ~\d+/);
  assert.match(pb!, /apontando "const a = ;"/, 'traz o trecho que o vm apontou');
  assert.match(pageSyntaxProblem('<html><body></body></html>')!, /nenhum <script>/);

  assert.match(pageSyntaxProblem('<html><body><script>const g = &lt;ctx&gt;;</script></body></html>')!, /entidade HTML/, 'modelo devolveu código escapado');

  /* ── 2. contrato de desenho (canvas cru) ── */
  const HANDMADE = `<html><body><script>
const g = document.querySelector("canvas").getContext("2d");
g.clearRect(0, 0, 1920, 1080);
g.fillStyle = "#1e1e24";
g.fillRect(0, 0, 1920, 1080);
g.beginPath();            // desenho à mão nº 1
g.arc(500, 400, 80, 0, Math.PI * 2);
g.fill();                 // nº 2
</script></body></html>`;
  const v = canvasViolations(HANDMADE);
  assert.equal(v.length, 3, 'beginPath, arc e fill() vazios = 3 violações');
  assert.equal(v[0]!.line, 6, 'linha certa no HTML (tag na nº1 → beginPath na nº6 de verdade)');
  assert.equal(canvasViolations(HANDMADE, ['beginPath']).length, 2, 'allowlist do plugin libera a linha declarada');
  assert.equal(canvasViolations(OK).filter((x) => /beginPath|lineTo/.test(x.what)).length, 0, 'chamada a L.* não dispara');

  const canvasProblem = contractProblem(HANDMADE, { forbidCanvas: true, pluginName: 'rigdemo' })!;
  assert.match(canvasProblem, /desenha à mão com primitivas cruas de Canvas/);
  assert.match(canvasProblem, /rigdemo/);
  /* rigs e requireLib: a mensagem deve dizer o que chamar e pegar página que ignora a lib */
  const canvasRigs = contractProblem(HANDMADE, { forbidCanvas: true, rigs: ['stickman', 'stickmanHead'] })!;
  assert.match(canvasRigs, /Rigs prontos desta biblioteca: stickman, stickmanHead/);
  assert.match(contractProblem(OK, { requireLib: true })!, /não usa a biblioteca do plugin|primitivas cruas/, 'página sem nenhuma chamada L. reprova quando requireLib');
  assert.equal(contractProblem(OK.replace('ant(g, 100 + t * 40, 500, {})', 'L.ant(g, 100 + t * 40, 500, {})'), { requireLib: true }), undefined, 'chamada L.x libera');
  assert.equal(contractProblem(HANDMADE, { forbidCanvas: false }), undefined, 'sem forbidCanvas, canvas cru não reprova');

  /* contrato de USO: não basta "ter L." — a lib precisa ser importada e o nome chamado precisa existir nela */
  const FAKE_API = OK.replace('ant(g, 100 + t * 40, 500, {})', 'L.ellipse(g, 10, 20, 30); L.line(g, [[1, 2], [3, 4]]);');
  const fake = contractProblem(FAKE_API, { requireLib: true, known: ['stickman', 'stickmanHead'] })!;
  assert.match(fake, /NÃO existem na biblioteca do plugin: L\.ellipse, L\.line/, 'API L.* inventada é reprovada');
  assert.match(fake, /stickman, stickmanHead/, 'a mensagem lista os nomes que existem');
  const noImport = `<html><body><script>const g = 1; L.stickman(g, 0, 0, {});</script></body></html>`;
  assert.match(contractProblem(noImport, { requireLib: true, known: ['stickman'] })!, /não importa a biblioteca do plugin/, 'sem import da lib, reprova');
  assert.equal(contractProblem(OK.replace('ant(g, 100 + t * 40, 500, {})', 'L.stickman(g, 540, 900, { t })'), { requireLib: true, known: ['stickman'] }), undefined, 'import + nome real da lib libera');
  const importmap = '<html><body><script type="importmap">{"imports":{"three":"./three.min.js"}}</script><script>const g = 1;</script></body></html>';
  assert.equal(contractProblem(importmap, { forbidCanvas: true }), undefined, 'importmap é ignorado (só código JS é checado)');

  /* ── 3. plugin de teste com lib/rigs → forbidCanvas por heurística ── */
  const plg = path.join(ws, 'plugins', 'rigdemo');
  fs.mkdirSync(path.join(plg, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(plg, 'skills', 'stick', 'lib', 'rigs'), { recursive: true });
  fs.writeFileSync(path.join(plg, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'rigdemo', description: 'personagens prontos' }));
  fs.writeFileSync(path.join(plg, 'skills', 'stick', 'SKILL.md'), '---\nname: stick\ndescription: desenha stickman\n---\n## Global\nUse L.stickman.\n');
  fs.writeFileSync(path.join(plg, 'skills', 'stick', 'lib', 'rigs', 'stickman.mjs'), `// stickman.mjs — personagem palito do plugin\nexport function stickman(ctx, x, y, opts = {}) { ctx.save(); ctx.restore(); }\nexport function stickmanHead(ctx, x, y, r) {}\n`);
  const ct = pluginContract(s, ['rigdemo']);
  assert.equal(ct.lib, true);
  assert.deepEqual(ct.rigs, ['stickman'], 'rig "stickman" detectado');
  assert.ok(ct.names.includes('stickman') && ct.names.includes('stickmanHead'), 'nomes exportados pela lib são conhecidos (contrato de uso)');
  assert.equal(ct.forbidCanvas, true, 'heurística: rigs prontos → página não desenha à mão');
  assert.equal(ct.plugin, 'rigdemo');

  /* ── 4. config do plugin (filmforge.contract) vence e muda o comportamento ── */
  fs.writeFileSync(path.join(plg, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'rigdemo', filmforge: { contract: { forbidCanvas: false, allow: ['.beginPath()'], maxPromptChars: 8000 } } }));
  const ct2 = pluginContract(s, ['rigdemo']);
  assert.equal(ct2.forbidCanvas, false, 'config do plugin (forbidCanvas:false) vence a heurística');
  assert.deepEqual(ct2.allow, ['.beginPath()']);
  assert.equal(ct2.maxPromptChars, 8000);
  assert.equal(contractProblem(HANDMADE, { forbidCanvas: ct2.forbidCanvas, allow: ct2.allow }), undefined, 'com a config do plugin, a página inteira passa');

  /* config de cap renormaliza os caps internos do bloco de plugins */
  fs.writeFileSync(path.join(plg, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'rigdemo' }));
  fs.writeFileSync(path.join(plg, 'skills', 'stick', 'SKILL.md'), `---\nname: stick\ndescription: x\n---\n## Global\nDiretriz do plugin: ${'A'.repeat(20000)}\n`);
  const full = pluginPrompt(s, ['rigdemo'], {}, {});
  const small = pluginPrompt(s, ['rigdemo'], {}, { budget: 9000 });
  assert.ok(small.length < full.length, `cap menor corta o bloco (${small.length} < ${full.length})`);
  assert.ok(small.length < 12000, `bloco de modelo pequeno fica em ~9k (${small.length})`);
  assert.ok(full.length > 10000, `sem orçamento o bloco fica maior (mais de 10k: ${full.length})`);
  fs.writeFileSync(path.join(plg, 'skills', 'stick', 'SKILL.md'), `---\nname: stick\ndescription: x\n---\n## Global\nUse L.stickman.\n`);

  /* ── 5. orçamento por modelo (smallModelBudget) ── */
  assert.equal(smallModelBudget('ollama', 'qwen3.5-9b-coder'), 9000, '9B nomeado');
  assert.equal(smallModelBudget('lmstudio', 'mistral-large'), 9000, 'harness local sem nome B');
  assert.equal(smallModelBudget('ollama', 'llama-70b'), undefined, '70B local: orçamento completo');
  assert.equal(smallModelBudget('claude', 'claude-sonnet-4-6'), undefined, 'modelo grande na nuvem');
  assert.equal(smallModelBudget('claude', undefined), undefined);
  assert.equal(smallModelBudget('glm', 'SenseNova-Loop-9B'), 9000, '9B com hífen e maiúscula');

  /* ── 6. freeLibImport devolve o contrato para o executor (vídeo livre) ── */
  const proj = path.join(ws, 'proj');
  fs.mkdirSync(path.join(proj, 'plugins', 'rigdemo', 'stick', 'lib', 'rigs'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'plugins', 'rigdemo', 'stick', 'lib', 'rigs', 'stickman.mjs'), '// stickman.mjs — palito\n');
  fs.writeFileSync(path.join(proj, 'plugins', 'rigdemo', 'stick', 'lib', '_all.mjs'), 'export * from "./rigs/stickman.mjs";\n');
  const fl = freeLibImport(s, ['rigdemo'], proj, proj);
  assert.ok(fl, 'lib staged encontrada');
  assert.equal(fl!.contract.forbidCanvas, false, 'contrato da config do plugin chega no executor');
  assert.equal(fl!.contract.plugin, 'rigdemo');
  const ctp = pluginContract(s, ['rigdemo'], proj);
  assert.ok(ctp.libFile?.endsWith('_all.mjs') && ctp.libFile.includes(path.join('plugins', 'rigdemo', 'stick')), 'libFile do staging vai no prompt de correção');

  console.log('contract tests: OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
