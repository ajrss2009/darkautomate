import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { bankUsedFile, pickMedia, scanBank, scoreItem, takeMedia, words } from '../main/media-bank';
import { validateRoute } from '../main/library';
import { ROUTES } from '../main/presets';

/** PASTA / BANCO DE MÍDIA como provedor de imagem e de vídeo: escolhe por combinação com a cena e não repete. */
function main() {
  assert.deepEqual(words('Snowy_Main-Street at Dusk 2024 (copy).JPG'), ['snowy', 'main', 'street', 'dusk', 'jpg']);
  assert.equal(scoreItem({ words: ['snowy', 'street'] }, ['snow', 'street']), 3, 'igual vale 2, começo comum vale 1');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-bank-'));
  const put = (rel: string, txt?: string) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); if (txt) fs.writeFileSync(`${f}.txt`, txt); };
  put('natal/arvore-iluminada.jpg');
  put('natal/rua-neve-noite.png');
  put('praia/por-do-sol.jpg', 'sunset beach waves golden');
  put('clips/snow-street-cars.mp4');
  put('clips/office-typing.mov');
  put('.oculto/x.png');
  put('notas.txt');
  const items = scanBank(dir);
  assert.equal(items.length, 5, 'imagens e vídeos, sem ocultos nem texto');
  assert.ok(items.find((x) => x.rel === 'praia/por-do-sol.jpg')!.words.includes('sunset'), 'legenda .txt entra nas palavras');

  /* combina com a cena; sem repetir */
  const used = new Set<string>();
  const a = pickMedia(items, { kind: 'image', terms: words('rua com neve à noite'), used, seed: 's1' })!;
  assert.equal(a.rel, 'natal/rua-neve-noite.png');
  used.add(a.rel);
  const b = pickMedia(items, { kind: 'image', terms: words('rua com neve à noite'), used, seed: 's2' })!;
  assert.notEqual(b.rel, a.rel, 'não repete');
  assert.equal(pickMedia(items, { kind: 'image', terms: ['sunset'], used: new Set(), seed: 'x' })!.rel, 'praia/por-do-sol.jpg');
  assert.equal(pickMedia(items, { kind: 'video', terms: words('snowy street with cars'), used: new Set(), seed: 'x' })!.rel, 'clips/snow-street-cars.mp4');

  /* takeMedia: registra por projeto; cena refeita reaproveita o mesmo arquivo; acaba → undefined (próximo provedor) */
  const out = path.join(dir, 'out-proj');
  const bank = { id: 'b1', name: 'Meu banco', dir };
  const t1 = takeMedia({ banks: [bank], kind: 'video', terms: ['snow'], outDir: out, sceneKey: 'p/s01' })!;
  const t1b = takeMedia({ banks: [bank], kind: 'video', terms: ['snow'], outDir: out, sceneKey: 'p/s01' })!;
  assert.equal(t1b.item.rel, t1.item.rel, 'cena refeita: o mesmo clipe');
  const t2 = takeMedia({ banks: [bank], kind: 'video', terms: ['snow'], outDir: out, sceneKey: 'p/s02' })!;
  assert.notEqual(t2.item.rel, t1.item.rel);
  assert.equal(takeMedia({ banks: [bank], kind: 'video', terms: [], outDir: out, sceneKey: 'p/s03' }), undefined, 'acabaram os clipes');
  /* banco só de vídeos não serve para imagem */
  assert.equal(takeMedia({ banks: [{ ...bank, kinds: ['video'] }], kind: 'image', terms: [], outDir: path.join(dir, 'o2'), sceneKey: 'p/s01' }), undefined);
  /* não repetir entre vídeos: o 2º projeto não recebe o que o 1º usou */
  const across = { ...bank, id: 'b2', noRepeatAcross: true };
  const p1 = takeMedia({ banks: [across], kind: 'image', terms: words('árvore iluminada'), outDir: path.join(dir, 'pa'), sceneKey: 'pa/s01' })!;
  const p2 = takeMedia({ banks: [across], kind: 'image', terms: words('árvore iluminada'), outDir: path.join(dir, 'pb'), sceneKey: 'pb/s01' })!;
  assert.equal(p1.item.rel, 'natal/arvore-iluminada.jpg');
  assert.notEqual(p2.item.rel, p1.item.rel, 'outro vídeo não repete');
  assert.ok(JSON.parse(fs.readFileSync(bankUsedFile(across), 'utf8')).includes(p1.item.rel));

  /* a ferramenta vale numa rota (etapa de imagem e de vídeo) */
  const r = JSON.parse(JSON.stringify(ROUTES.find((x) => x.id === 'shorts-autopilot')));
  for (const st of r.steps) if (st.kind === 'image' || st.kind === 'video') st.bindings = [{ type: 'builtin', tool: 'media-folder', bank: 'b1' }, ...st.bindings];
  assert.deepEqual(validateRoute(r), []);
  fs.rmSync(dir, { recursive: true, force: true });
}

main();
console.log('media-bank tests: OK');
