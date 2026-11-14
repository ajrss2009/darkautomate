import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyVariables, isUiFormat, placeholders } from '../main/comfyui';
import { fitArea, fitExactAspect, fitSize } from '../main/executors';
import { ROUTES } from '../main/presets';

const dir = path.resolve(__dirname, '../../workflows');
type G = Record<string, { inputs: Record<string, unknown>; class_type: string }>;

function check(file: string, vars: Record<string, string | number>) {
  const wf = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as G;
  const side = JSON.parse(fs.readFileSync(path.join(dir, file.replace(/\.json$/, '.map.json')), 'utf8'));
  const g = applyVariables(wf, { ...vars, ...(side.vars ?? {}) }, side.mapping) as G;
  assert.ok(!JSON.stringify(g).includes('{{'), `${file}: variável não substituída`);
  for (const [id, n] of Object.entries(g))
    for (const v of Object.values(n.inputs))
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string') assert.ok(g[v[0]], `${file}: nó ${id} referencia ${v[0]} inexistente`);
  assert.ok(g[side.outputNode], `${file}: outputNode ${side.outputNode} inexistente`);
  assert.match(g[side.outputNode]!.class_type, /^Save/, `${file}: outputNode deve ser um Save*`);
  return g;
}

const img = { prompt: 'um gato', seed: 123, ...fitSize(1080, 1920, 1344, 16) };
const k = check('krea2-turbo-t2i.json', img);
assert.equal(k['30:3']!.inputs['seed'], 123);
assert.equal(k['30:19']!.inputs['value'], 'krea-2 style, um gato');
assert.equal(k['30:5']!.inputs['width'], img.width);
const z = check('z-image-turbo-t2i.json', img);
assert.equal(z['57:27']!.inputs['text'], 'um gato');
const t = check('omnivoice-clone-tts.json', { text: 'Olá mundo', seed: 7 });
assert.equal(t['2']!.inputs['text'], 'Olá mundo');
assert.equal(t['3']!.inputs['audio'], 'Dave PT-BR.MP3');
const extra = { ...img, text: 't', seconds: 5, seconds_int: 5, music_seconds: 60, style: 'epic', lyrics: '[Instrumental]', init_image: 'a.png', first_frame: 'a.png', last_frame: 'a.png', ref_audio: 'r.mp3', negative: '', frames: 121, fps: 24 };
const mm = check('yue2-text2music.json', extra);
assert.equal(mm['33:25']!.inputs['max_duration'], 60);
assert.equal(mm['33:36']!.inputs['value'], 'epic');
check('yue2-music-cover.json', extra);
const h3 = check('minimax-h3-t2v.json', extra);
assert.equal(h3['8']!.inputs['value'], 5);
assert.equal(h3['10']!.inputs['width'], img.width);
const ref = check('minimax-h3-ref2v.json', extra);
assert.equal(ref['35']!.inputs['image'], 'a.png');
assert.ok(!('ref_images.ref_image_1' in ref['36']!.inputs));
const loop = check('minimax-h3-perfect-loop.json', extra);
assert.equal(loop['7']!.inputs['image'], 'a.png');
assert.equal(loop['8']!.inputs['image'], 'a.png');
assert.equal((loop['12']!.inputs['first_frame'] as unknown[])[0], '22');
assert.equal((loop['12']!.inputs['last_frame'] as unknown[])[0], '23');
assert.equal(loop['22']!.inputs['width'], img.width);
assert.equal(loop['12']!.inputs['prompt'], 'um gato');
assert.equal(loop['10']!.inputs['value'], 5);
assert.equal(loop['13']!.inputs['noise_seed'], 123);
assert.equal(loop['21']!.inputs['filename_prefix'], 'video/MiniMax_H3_perfect_loop');
const loop3 = check('minimax-h3-perfect-loop-3step.json', extra);
assert.equal(loop3['24']!.inputs['lora_name'], 'minimax_h3_taomate_3step_lora_avg_rank_19_bf16.safetensors');
assert.equal(loop3['15']!.inputs['steps'], 3);
assert.deepEqual(loop3['15']!.inputs['model'], ['24', 0]);
assert.deepEqual(loop3['16']!.inputs['model'], ['24', 0]);
// templates Wan2GP: todas as variáveis precisam existir
/* + as variáveis que o executor Wan2GP preenche (idioma, tempo de fala e o elenco como referência) */
const known = new Set([...Object.keys(extra), 'resolution', 'language_name', 'language_code', 'language_label', 'speech_seconds', 'ref_images', 'ref_prompt', 'delivery', 'sfx_prompt', 'sfx_seconds', 'seconds_ceil', 'song_slice']);
for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('wan2gp-'))) {
  const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  assert.ok(t.model_type && t.settings, `${f}: precisa de model_type e settings`);
  for (const k of placeholders(t.settings)) assert.ok(known.has(k) || k in (t.vars ?? {}), `${f}: variável desconhecida ${k}`);
}
assert.equal(isUiFormat({ nodes: [] }), true);
assert.equal(isUiFormat({ '1': { inputs: {}, class_type: 'X' } }), false);
check('t2i-basic.json', { prompt: 'x', negative: '', seed: 1, width: 512, height: 512 });

const { width, height } = fitSize(1080, 1920, 1344, 16);
assert.ok(width % 16 === 0 && height % 16 === 0 && Math.max(width, height) <= 1344 + 16);
assert.deepEqual(fitSize(512, 512, 1024, 8), { width: 512, height: 512 });
assert.deepEqual(fitExactAspect('16:9'), { width: 1024, height: 576 });
assert.deepEqual(fitExactAspect('9:16'), { width: 576, height: 1024 });
assert.equal(fitExactAspect('16:9').width / fitExactAspect('16:9').height, 16 / 9);
assert.equal(fitExactAspect('4:5').width / fitExactAspect('4:5').height, 4 / 5);
assert.deepEqual(fitArea(1920, 1080, 0.4, 32), { width: 832, height: 480 });
assert.notEqual(fitArea(1920, 1080, 0.4, 32).width / fitArea(1920, 1080, 0.4, 32).height, 16 / 9);

// toda rota aponta para workflows/templates existentes
const missing = new Set<string>();
for (const r of ROUTES) for (const s of r.steps) for (const b of s.bindings)
  { if (b.type === 'comfyui' && !fs.existsSync(path.join(dir, b.workflow))) missing.add(b.workflow);
    if (b.type === 'wan2gp' && !fs.existsSync(path.join(dir, b.template))) missing.add(b.template); }
assert.deepEqual([...missing], []);
console.log('workflow tests: OK');
