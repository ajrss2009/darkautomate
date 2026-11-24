import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MediaBank, Route, Settings, Skill } from '../shared/types';
import { buildRoute, buildSkill, allErrors, textProfile, titleSpec, type SkillWizardState, type WizardRef } from '../shared/skill-wizard';
import * as ff from './ffmpeg';
import * as lib from './library';
import { scanBank } from './media-bank';
import { quickSha } from './media-index';
import { measureEditRhythm } from './references';
import { measurePalette } from './style-ref';

/*
 * Lado do app do ASSISTENTE DE SKILL (Parte LI): mede as referências (ritmo/paleta do vídeo, paleta da imagem, perfil
 * do .txt, padrão do título, inventário da pasta) e grava tudo de uma vez — referências copiadas por hash para a
 * biblioteca, pasta como banco de mídia, rota própria quando muda algo e a skill com id único (nunca sobrescreve).
 */
export type WizardAnalyzeInput = { kind: 'video' | 'image' | 'txt' | 'title' | 'media' | 'code'; file?: string; text?: string };

export async function wizardAnalyze(s: Settings, input: WizardAnalyzeInput, signal: AbortSignal): Promise<Record<string, unknown>> {
  const f = input.file;
  if (input.kind === 'title') return { spec: titleSpec(input.text ?? '') };
  if (input.kind === 'txt') {
    const text = input.text ?? (f ? fs.readFileSync(f, 'utf8') : '');
    if (!text.trim()) throw new Error('texto vazio');
    return { profile: textProfile(text) };
  }
  if (!f || !fs.existsSync(f)) throw new Error(`arquivo não encontrado: ${f ?? ''}`);
  if (input.kind === 'media') {
    const items = scanBank(f, 4000);
    const seen = new Set<string>(); let dup = 0;
    for (const it of items.slice(0, 400)) { try { const h = quickSha(it.file); if (seen.has(h)) dup++; else seen.add(h); } catch { /* ilegível */ } }
    return { count: { image: items.filter((x) => x.kind === 'image').length, video: items.filter((x) => x.kind === 'video').length, duplicates: dup } };
  }
  const sha = quickSha(f);
  if (input.kind === 'code') return { sha };
  const palette = await measurePalette(s.ffmpeg, f, 5).catch(() => []);
  if (input.kind === 'image') return { sha, palette };
  const duration = await ff.duration(s.ffprobe, f).catch(() => 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-wiz-'));
  try {
    const rhythm = await measureEditRhythm(s.ffmpeg, f, duration, dir, signal);
    return { sha, palette, duration: Math.round(duration * 10) / 10, rhythm };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Copia um arquivo para workspace/library/skill-refs/<hash><ext> (mesmo conteúdo = mesmo arquivo). */
export function storeRef(s: Settings, file: string): { file: string; sha: string } {
  const sha = quickSha(file);
  const dir = path.join(s.workspace, 'library', 'skill-refs');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${sha.slice(0, 16)}${path.extname(file).toLowerCase()}`);
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
  return { file: dest, sha };
}

const uniqueId = (taken: Set<string>, base: string) => { let id = base, i = 2; while (taken.has(id)) id = `${base}-${i++}`; return id; };
const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'skill';

/** Grava o contrato: referências, banco, rota (se mudou) e skill. Devolve o que foi criado. */
export function wizardSave(s: Settings, st0: SkillWizardState, saveSettings: (s: Settings) => void): { skill: Skill; route?: Route; bank?: MediaBank; warnings: string[] } {
  const errs = allErrors(st0);
  if (errs.length) throw new Error(errs.join(' '));
  const st: SkillWizardState = JSON.parse(JSON.stringify(st0));
  const warnings: string[] = [];
  /* referências → biblioteca por hash (nada de caminho solto que quebra quando o arquivo some) */
  const keep = (f: string | undefined) => { if (!f) return f; try { return fs.existsSync(f) ? storeRef(s, f).file : (warnings.push(`referência não encontrada: ${f}`), undefined); } catch { return f; } };
  st.refs = st.refs.map((r): WizardRef => { const got = fs.existsSync(r.file) ? storeRef(s, r.file) : undefined; if (!got) warnings.push(`referência não encontrada: ${r.file}`); return got ? { ...r, file: got.file, sha: got.sha } : r; }).filter((r) => fs.existsSync(r.file));
  st.thumb.image = keep(st.thumb.image);
  st.lipsync.faceRef = keep(st.lipsync.faceRef);
  st.voice.voiceRef = keep(st.voice.voiceRef);
  /* pasta de mídia → banco de mídia (reaproveita o que já aponta para a mesma pasta) */
  let bank: MediaBank | undefined;
  if (st.media.dir) {
    const norm = path.resolve(st.media.dir).toLowerCase();
    bank = (s.mediaBanks ?? []).find((b) => path.resolve(b.dir).toLowerCase() === norm);
    if (!bank) {
      bank = { id: uniqueId(new Set((s.mediaBanks ?? []).map((b) => b.id)), slug(path.basename(st.media.dir))), name: path.basename(st.media.dir), dir: st.media.dir, kinds: st.media.kinds, noRepeatAcross: st.media.noRepeatAcross };
      s.mediaBanks = [...(s.mediaBanks ?? []), bank];
      saveSettings(s);
    }
  }
  /* rota: a escolhida; se a skill muda algo (pasta, edição), grava uma cópia própria */
  const routes = lib.listRoutes(s);
  const base = routes.find((r) => r.id === st.routeId) ?? routes[0];
  if (!base) throw new Error('nenhuma rota disponível');
  let route: Route | undefined;
  const custom = buildRoute(st, base, bank?.id);
  if (custom) {
    custom.id = uniqueId(new Set(routes.map((r) => r.id)), slug(custom.name));
    route = lib.saveRoute(s, custom);
  }
  const skill = buildSkill(st, route?.id ?? base.id);
  skill.id = uniqueId(new Set(lib.listSkills(s).map((k) => k.id)), slug(skill.name));
  const saved = lib.saveSkill(s, skill);
  return { skill: saved, route, bank, warnings };
}
