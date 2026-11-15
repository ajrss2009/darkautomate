/*
 * Geração do RIG ARTICULADO com IA (Biblioteca → 🦴 Rig): referência de estilo opcional (imagens, quadros de um vídeo ou
 * 3 vistas renderizadas do modelo 3D do item), pedido à IA, validação e prévia PNG com 4 poses. Nada é gravado aqui.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Binding, Settings } from '../shared/types';
import * as characters from './characters';
import * as ff from './ffmpeg';
import { detectBins, run } from './ffmpeg';
import { llmJson } from './editor';
import { stageThree } from './plugins';
import { snapHtml } from './render';
import { cartoonSpecOf, cartoonThumbHtml, isCodeCharacter, normalizeRig, rigPrompt, rigPreviewHtml, rigThumbHtml, type Rig } from './rig';
import { stageCartoon3d } from './plugins';

export interface RigGenInput { id?: string; name?: string; look?: string; code?: string; style?: string; refs?: string[]; useModel?: boolean; previous?: boolean }

/** Renderiza 3 vistas (frente, 3/4, lado) de um modelo GLB/GLTF/OBJ num PNG — referência de estilo para o rig. */
export async function renderModelViews(model: string, workDir: string, views: number[] = [0, 45, 90]): Promise<string> {
  fs.mkdirSync(workDir, { recursive: true });
  const name = 'model' + path.extname(model).toLowerCase();
  fs.copyFileSync(model, path.join(workDir, name));
  if (/\.gltf$/i.test(model)) for (const f of fs.readdirSync(path.dirname(model))) if (/\.(bin|png|jpe?g|webp)$/i.test(f)) fs.copyFileSync(path.join(path.dirname(model), f), path.join(workDir, f));
  const three = stageThree(workDir, workDir);
  if (!three?.importmap['three/addons/']) throw new Error('Three.js com carregadores 3D não encontrado no app (vendor/three)');
  const obj = /\.obj$/i.test(name);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f4f6f8}</style><script type="importmap">${JSON.stringify({ imports: three.importmap })}</script></head><body><canvas id="c" width="${views.length * 400}" height="600"></canvas>
<script type="module">
import * as THREE from 'three';
import { ${obj ? 'OBJLoader' : 'GLTFLoader'} } from 'three/addons/loaders/${obj ? 'OBJLoader' : 'GLTFLoader'}.js';
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
r.setClearColor(0xf4f6f8); r.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2)); const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(3, 5, 4); scene.add(d);
const ready = new ${obj ? 'OBJLoader' : 'GLTFLoader'}().loadAsync('./${name}').then((g) => {
  const root = g.scene || g; scene.add(root);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const R = Math.max(size.x, size.y, size.z) || 1;
  ${JSON.stringify(views)}.forEach((deg, i) => {
    const cam = new THREE.PerspectiveCamera(30, 400 / 600, R / 100, R * 100);
    const a = deg * Math.PI / 180, dist = R * 2.2;
    cam.position.set(c.x + Math.sin(a) * dist, c.y + size.y * 0.1, c.z + Math.cos(a) * dist); cam.lookAt(c);
    r.setViewport(i * 400, 0, 400, 600); r.setScissor(i * 400, 0, 400, 600); r.setScissorTest(true); r.render(scene, cam);
  });
});
window.__forge = { duration: 1, fps: 30, seek: () => ready, pause() {} };
</script></body></html>`;
  const page = path.join(workDir, 'views.html'), png = path.join(workDir, 'views.png');
  fs.writeFileSync(page, html, 'utf8');
  await snapHtml(page, png, { w: views.length * 400, h: 600 });
  return png;
}

export async function generateRig(settings: Settings, input: RigGenInput, log: (l: string) => void = () => {}): Promise<{ rig?: Rig; png?: string; error?: string; binding?: string; refs: string[] }> {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 900_000);
    const dir = path.join(settings.workspace, 'cache', 'library-previews');
    fs.mkdirSync(dir, { recursive: true });
    const base = `rig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const images: string[] = [];
      let refKind: 'image' | 'video' | 'model' | undefined;
      for (const f of (input.refs ?? []).map(String).filter((x) => fs.existsSync(x)).slice(0, 4)) {
        if (/\.(png|jpe?g|webp|gif)$/i.test(f)) { images.push(f); refKind ??= 'image'; continue; }
        if (/\.(mp4|mov|webm|mkv|avi)$/i.test(f)) {
          const bin = detectBins().ffmpeg;
          if (!bin) throw new Error('ffmpeg não encontrado — necessário para tirar quadros do vídeo de referência');
          const dur = await ff.duration(detectBins().ffprobe ?? 'ffprobe', f).catch(() => 0);
          for (const [k, frac] of [0.15, 0.4, 0.65, 0.9].entries()) {
            const out = path.join(dir, `${base}-v${k}.jpg`);
            await run(bin, ['-y', '-ss', String(Math.max(0, (dur || 4) * frac)), '-i', f, '-frames:v', '1', '-vf', 'scale=768:-2', out], ac.signal).catch(() => undefined);
            if (fs.existsSync(out)) images.push(out);
          }
          refKind = 'video';
        }
      }
      if (input.useModel && input.id) {
        const ch = characters.getCharacter(settings, input.id);
        const model = (ch.models ?? []).map((m) => characters.charFile(settings, ch, m)).find((m): m is string => !!m && /\.(glb|gltf|obj)$/i.test(m));
        if (!model) throw new Error('este item não tem modelo 3D GLB/GLTF/OBJ — importe um em "Modelos 3D"');
        const png = await renderModelViews(model, path.join(dir, base + '-3d'));
        images.push(png); refKind = 'model';
      }
      const textish = (m: string) => !/(image|tts|audio|embed|imagen|banana|live|realtime)/i.test(m) && /(gpt-4|gpt-4o|gpt-5|gemini|deepseek|claude|qwen|llama|mistral|command|sonnet|opus|haiku|chat|flash|pro|mini)/i.test(m);
      const apiText = settings.providers.find((p) => p.apiKey && Array.isArray(p.models) && p.models.some(textish));
      const chain: Binding[] = apiText ? [{ type: 'api', provider: apiText.id, model: apiText.models.find(textish) ?? apiText.models[0] ?? '' }, { type: 'harness', harness: 'auto' }] : [{ type: 'harness', harness: 'auto' }];
      const prompt = rigPrompt({ what: 'personagem', name: input.name ?? '', look: input.look ?? '', code: input.code, style: input.style, hasRef: images.length > 0, refKind, previous: input.previous });
      let lastErr = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const { json, binding } = await llmJson(chain, settings, path.join(settings.workspace, 'tools', 'library'),
          prompt + (lastErr ? `\nA tentativa anterior falhou: ${lastErr}. Corrija.` : ''), ac.signal, log, images);
        let rig: Rig;
        try { rig = normalizeRig(json, input.name ?? ''); } catch (e) { lastErr = (e as Error).message; continue; }
        const htmlFile = path.join(dir, `${base}.html`), png = path.join(dir, `${base}.png`);
        fs.writeFileSync(htmlFile, rigPreviewHtml(rig), 'utf8');
        try { await snapHtml(htmlFile, png, { w: 1200, h: 600 }); } catch (e) { return { rig, error: `a prévia não renderizou: ${(e as Error).message.slice(0, 160)}`, refs: images }; }
        return { rig, png, binding, refs: images };
      }
      return { error: `a IA não devolveu um rig válido (${lastErr})`, refs: images };
    } finally { clearTimeout(timer); }
  }

/**
 * Miniatura automática (local, sem IA) para o item não aparecer sem imagem: rig parado ou a vista de frente do modelo 3D.
 * Não mexe em itens que já têm folha/retrato/imagem, a menos que force = true (ex.: rig novo).
 */
export async function makeThumb(settings: Settings, id: string, force = false): Promise<boolean> {
  const ch = characters.getCharacter(settings, id);
  if (!force && characters.hasPicture(settings, ch) && !ch.thumb) return false;
  const dir = path.join(settings.workspace, 'cache', 'library-previews', `thumb-${id}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const rig = characters.readCharacterRig(settings, ch);
    const spec = cartoonSpecOf(ch.look);
    let png: string | undefined;
    if (spec && !rig) {
      /* personagem da biblioteca cartoon3d: desenhado com a própria biblioteca (igual às cenas por código) */
      const kit = stageCartoon3d(dir, dir);
      if (!kit) throw new Error('biblioteca cartoon3d não encontrada no app (vendor/cartoon3d)');
      const html = path.join(dir, 'thumb.html'); png = path.join(dir, 'thumb.png');
      fs.writeFileSync(html, cartoonThumbHtml(spec, kit.importmap), 'utf8');
      await snapHtml(html, png, { w: 480, h: 480 });
    } else if (rig) {
      const html = path.join(dir, 'thumb.html'); png = path.join(dir, 'thumb.png');
      fs.writeFileSync(html, rigThumbHtml(rig), 'utf8');
      await snapHtml(html, png, { w: 480, h: 480 });
    } else {
      const model = (ch.models ?? []).map((m) => characters.charFile(settings, ch, m)).find((m): m is string => !!m && /\.(glb|gltf|obj)$/i.test(m));
      if (model) png = await renderModelViews(model, dir, [20]);
    }
    if (!png || !fs.existsSync(png)) return false;
    characters.setCharacterThumb(settings, id, png);
    return true;
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporário */ } }
}

/** Miniaturas que faltam (itens sem nenhuma imagem, com rig ou modelo 3D). Devolve quantas foram feitas. */
export async function makeMissingThumbs(settings: Settings): Promise<number> {
  let n = 0;
  for (const c of characters.listCharacters(settings)) {
    if (characters.hasPicture(settings, c) || (!c.rig && !c.models?.length && !cartoonSpecOf(c.look))) continue;
    try { if (await makeThumb(settings, c.id)) n++; } catch { /* segue com os outros */ }
  }
  return n;
}

/** Personagem por código: a imagem é DESENHADA EM CÓDIGO (cartoon3d, rig ou modelo 3D), nunca por um gerador de imagem. */
export const drawnByCode = (c: { kind?: string; code?: string; rig?: string; look?: string; models?: string[] }) => isCodeCharacter(c) && (!!c.rig || !!cartoonSpecOf(c.look) || !!c.models?.length);
