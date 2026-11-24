import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * AVATAR REATIVO (catálogo, Parte XLVIII): a pessoa entrega uma PASTA de poses (avatar_neutro.png, avatar_surpreso.png…)
 * — ou uma imagem só. O app copia para assets/user/avatar, reconhece a pose pelo nome (pt ou en) e passa a lista com os
 * caminhos exatos para o roteiro ([AVATAR:pose]) e para a cena por código. A marcação nunca é falada pela narração.
 */
export const POSES = ['neutro', 'surpreso', 'cetico', 'medo', 'riso', 'pensativo', 'apontando', 'perfil'] as const;
const ALIAS: Record<string, string> = {
  neutral: 'neutro', normal: 'neutro', idle: 'neutro', surprised: 'surpreso', surprise: 'surpreso', shocked: 'surpreso', susto: 'surpreso',
  skeptical: 'cetico', doubt: 'cetico', duvida: 'cetico', fear: 'medo', scared: 'medo', afraid: 'medo', laugh: 'riso', laughing: 'riso', happy: 'riso', feliz: 'riso', rindo: 'riso',
  thinking: 'pensativo', think: 'pensativo', pointing: 'apontando', point: 'apontando', aponta: 'apontando', profile: 'perfil', side: 'perfil', lado: 'perfil',
};
const IMG = /\.(png|webp)$/i;
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "avatar_Surpreso.png" → "surpreso"; "Avatar-Laugh-2.png" → "riso"; nome livre vira o próprio nome. Função pura. */
export function poseOf(file: string): string {
  const base = norm(path.basename(file).replace(/\.\w+$/, '')).replace(/^avatar[\s_-]*/, '').replace(/[\s_-]*\d+$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return ALIAS[base] ?? base ?? 'neutro';
}

/** Tira as marcações [AVATAR:pose] do texto falado/legendado. Função pura. */
export function stripAvatarTags(t: string): string {
  return t.replace(/\s*\[AVATAR:[^\]]*\]\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Copia a pasta (ou o arquivo) de poses para assets/user/avatar. Devolve pose → caminho relativo a assets/user. */
export function importAvatarPoses(userDir: string, src: string): Record<string, string> {
  if (!fs.existsSync(src)) throw new Error(`poses do avatar não encontradas: ${src}`);
  const files = fs.statSync(src).isDirectory() ? fs.readdirSync(src).filter((f) => IMG.test(f) || /\.jpe?g$/i.test(f)).map((f) => path.join(src, f)) : [src];
  if (!files.length) throw new Error('a pasta de poses não tem PNG/WebP (use avatar_neutro.png, avatar_surpreso.png…)');
  const out = path.join(userDir, 'avatar');
  fs.mkdirSync(out, { recursive: true });
  const poses: Record<string, string> = {};
  for (const f of files.sort()) {
    const pose = files.length === 1 ? 'neutro' : poseOf(f);
    if (poses[pose]) continue;                       // 1º arquivo de cada pose
    const name = `avatar_${pose}${path.extname(f).toLowerCase()}`;
    fs.copyFileSync(f, path.join(out, name));
    poses[pose] = `avatar/${name}`;
  }
  return poses;
}

/** Bloco do prompt: poses disponíveis com os caminhos exatos (roteiro, plano de cenas e cena por código). */
export function avatarPrompt(poses: Record<string, string> | undefined, userDir: string, kind: string): string {
  if (!poses || !Object.keys(poses).length || !['script', 'scene_plan', 'code_scene', 'review'].includes(kind)) return '';
  const list = Object.entries(poses).map(([k, rel]) => `- ${k}: ${path.join(userDir, rel)}`).join('\n');
  const missing = POSES.filter((p) => !poses[p]);
  return `AVATAR — poses que EXISTEM (PNG do usuário; use SÓ estas, com estes nomes em [AVATAR:<pose>]):\n${list}` +
    (missing.length ? `\nNão há: ${missing.join(', ')} — escolha a pose existente mais próxima (sem pose certa, use neutro${poses['neutro'] ? '' : ' ou a primeira da lista'}).` : '') +
    (kind === 'code_scene' ? '\nNa cena por código, carregue o PNG pelo caminho acima (file:///…) — nunca desenhe ou gere outro avatar.' : '');
}
