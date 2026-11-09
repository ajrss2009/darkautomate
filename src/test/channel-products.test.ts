import * as assert from 'node:assert/strict';
import { ctaProducts, mergeChannelProducts, patchChannelProducts, productCtaPrompt, projectCost, channelProductsContext } from '../main/clone-business';
import type { Project } from '../shared/types';

let fails = 0;
const t = (name: string, fn: () => void) => { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, (e as Error).message); } };
const idea = (name: string, fit: number, kind: 'info' | 'physical' = 'info') => ({ kind, name, fit, search: name });

t('merge mantém escolha e link do usuário e itens escolhidos fora da nova pesquisa', () => {
  let cp = mergeChannelProducts(undefined, { info: [idea('Curso A', 9), idea('Ebook B', 5)], physical: [idea('Mouse', 7, 'physical')] }, 'ai');
  assert.equal(cp.items.length, 3); assert.equal(cp.cta?.enabled, true); assert.ok(cp.items[0]!.links?.length);
  cp = patchChannelProducts(cp, { chosen: { 'curso a': true, Mouse: true }, urls: { Mouse: 'https://amzn.to/x', 'Curso A': 'javascript:alert(1)' } });
  assert.equal(cp.items.find((x) => x.name === 'Curso A')!.url, undefined);
  const again = mergeChannelProducts(cp, { info: [idea('Curso A', 8)], physical: [] }, 'ai');
  assert.equal(again.items.find((x) => x.name === 'Curso A')!.chosen, true);
  assert.equal(again.items.find((x) => x.name === 'Mouse')!.url, 'https://amzn.to/x');
  assert.equal(again.items.some((x) => x.name === 'Ebook B'), false);
});

t('CTA: só os marcados, até o máximo, por aderência; desligado = nada', () => {
  let cp = mergeChannelProducts(undefined, { info: [idea('A', 3), idea('B', 9), idea('C', 6)], physical: [] }, 'ai');
  assert.equal(productCtaPrompt(cp, 'script'), '');
  cp = patchChannelProducts(cp, { chosen: { A: true, B: true, C: true }, cta: { max: 2, placement: 'end' } });
  assert.deepEqual(ctaProducts(cp).map((x) => x.name), ['B', 'C']);
  const s = productCtaPrompt(cp, 'script');
  assert.match(s, /no fim/); assert.match(s, /B/); assert.doesNotMatch(s, /- A/);
  assert.match(productCtaPrompt(cp, 'metadata'), /\[coloque aqui o seu link\]/);
  assert.equal(productCtaPrompt(cp, 'image'), '');
  cp = patchChannelProducts(cp, { cta: { enabled: false } });
  assert.equal(productCtaPrompt(cp, 'script'), '');
  cp = patchChannelProducts(cp, { cta: { enabled: true, max: 9 } });
  assert.equal(cp.cta!.max, 3);
  cp = patchChannelProducts(cp, { remove: ['b'] });
  assert.equal(cp.items.some((x) => x.name === 'B'), false);
});

t('contexto do canal usa tipo, marca e títulos da análise', () => {
  const ctx = channelProductsContext({ name: 'Dev Rápido', platform: 'youtube', type: 'tech', brand: { names: [], description: 'tutoriais de programação', keywords: ['python'] } as never,
    analytics: { top: [{ id: '1', title: 'Python em 10 min' }] } as never }, 'Tecnologia');
  assert.match(ctx.niche, /Dev Rápido.*Tecnologia.*tutoriais/); assert.deepEqual(ctx.titles, ['Python em 10 min']);
});

t('custo do projeto: cenas e rota; vídeo por API pesa mais que imagem local', () => {
  const route = (vid: string) => ({ steps: [{ kind: 'video', enabled: true, bindings: [{ type: vid }] }, { kind: 'narration', enabled: true, bindings: [{ type: 'wan2gp' }] }] }) as unknown as Project['route'];
  const scenes = [{ kind: 'video', durationSec: 30 }, { kind: 'video', durationSec: 30 }] as unknown as Project['scenes'];
  const api = projectCost({ targetDurationSec: 60, scenes, route: route('api') } as Project);
  const local = projectCost({ targetDurationSec: 60, scenes, route: route('wan2gp') } as Project);
  assert.ok(api.perVideo > local.perVideo, `${api.perVideo} > ${local.perVideo}`);
  assert.ok(api.lines.some((l) => /Vídeo por IA/.test(l.item) && l.qty === '60 s'));
  const empty = projectCost({ targetDurationSec: 90, scenes: [], route: undefined } as unknown as Project);
  assert.ok(empty.perVideo >= 0); assert.match(empty.assumptions[0]!, /90 s/);
});

console.log(`falhas=${fails}`);
if (fails) process.exit(1);
