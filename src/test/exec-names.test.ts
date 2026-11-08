import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { buildCatalog } from '../main/catalog';
import { defaultSettings } from '../main/settings';
import { modelName, reserveChain } from '../shared/exec-names';
import { applyExecutorProfile } from '../shared/profiles';
import type { Binding, Route } from '../shared/types';

async function main() {
  /* ───────── o OmniVoice do Wan2GP aparece com o nome do modelo (antes era só "wan2gp-tts") ───────── */
  const cat = buildCatalog(defaultSettings(path.resolve('tmp-ws')), path.resolve('workflows'));
  const voice = cat.wan2gpTemplates.filter((t) => t.capability === 'voice');
  assert.ok(voice.length >= 4, 'templates de voz do Wan2GP no catálogo');
  const names = Object.fromEntries(voice.map((t) => [t.file, modelName(t.file, t.label, t.modelType)]));
  assert.equal(names['wan2gp-tts.json'], 'OmniVoice');
  assert.equal(names['wan2gp-tts-chatterbox.json'], 'Chatterbox');
  assert.equal(names['wan2gp-tts-fish.json'], 'Fish Drama 3');
  assert.equal(names['wan2gp-tts-h3.json'], 'MiniMax H3 Voice Clone');
  assert.ok(voice.every((t) => names[t.file]), `todo template de voz tem nome: ${JSON.stringify(names)}`);
  assert.equal(voice.find((t) => t.file === 'wan2gp-tts.json')?.modelType, 'omnivoice');
  /* sem catálogo (seletor de voz): pelo arquivo */
  assert.equal(modelName('wan2gp-tts.json'), 'OmniVoice'); assert.equal(modelName('wan2gp-tts-h3.json'), 'MiniMax H3'); assert.equal(modelName('omnivoice-clone-tts.json'), 'OmniVoice');
  assert.equal(modelName('qualquer.json'), '');

  /* ───────── escolher Wan2GP não "some" com o OmniVoice da rota: ele continua nas reservas ───────── */
  const omniComfy: Binding = { type: 'comfyui', server: 'local', workflow: 'omnivoice-clone-tts.json' };
  const omniWan: Binding = { type: 'wan2gp', template: 'wan2gp-tts.json' };
  const fish: Binding = { type: 'wan2gp', template: 'wan2gp-tts-fish.json' };
  const route: Route = { id: 'r', name: 'r', description: '', videoTypes: [], steps: [{ id: 'narration', kind: 'narration', label: 'Narração', scope: 'scene', dependsOn: [], enabled: true, params: {},
    retry: { max: 1, backoffMs: 0 }, timeoutSec: 60, bindings: [omniComfy, omniWan] }] };
  const chains = { voice: [fish] };
  const eff = applyExecutorProfile(route, { id: 'x', name: 'x', chains }).steps[0]!.bindings;
  assert.deepEqual(eff, [fish, omniComfy, omniWan], 'a execução mantém os da rota atrás do escolhido');
  assert.deepEqual(reserveChain(eff, chains.voice), [omniComfy, omniWan], 'a tela mostra as reservas reais (antes: nenhuma)');
  const pickOmniWan = applyExecutorProfile(route, { id: 'x', name: 'x', chains: { voice: [omniWan] } }).steps[0]!.bindings;
  assert.deepEqual(reserveChain(pickOmniWan, [omniWan]), [omniComfy], 'escolher o OmniVoice do Wan2GP deixa o do ComfyUI de reserva');
  assert.deepEqual(reserveChain(undefined, [fish, omniWan, fish]), [omniWan], 'sem rota: as escolhas, sem repetir');

  console.log('exec-names: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
