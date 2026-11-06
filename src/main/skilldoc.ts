import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HarnessId, Settings, Skill } from '../shared/types';
import { isHttpHarness, resolveHarness, runHarness } from './harness';
import { activeAgyEnv } from './automations';
import { getAnyRoute, saveSkill } from './library';
import { finalizeSkillMd, skillRules } from './skillgen';

/*
 * Nova SKILL a partir de um DOCUMENTO de prompts/diretrizes de canal (.docx, .md, .txt): a IA escolhida
 * converte o documento numa skill do FilmForge — estratégia de temas → ideias, regras de roteiro → roteiro,
 * ritmo/planos → plano de cenas, thumbnails, SEO — preservando as regras concretas (números, voz, formato).
 */

export interface SkillDocInput { file: string; harness: HarnessId | 'auto'; model?: string; name?: string; language?: string; routeId?: string }

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Texto de um .docx (parágrafos do word/document.xml), .md ou .txt. */
export function documentText(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.md' || ext === '.txt' || ext === '.markdown') return fs.readFileSync(file, 'utf8');
  if (ext !== '.docx') throw new Error('use um arquivo .docx, .md ou .txt');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-docx-'));
  try {
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'unzip';
    const r = process.platform === 'win32' ? spawnSync(tar, ['-xf', file, '-C', tmp, 'word/document.xml'], { windowsHide: true, encoding: 'utf8' })
      : spawnSync('unzip', ['-o', file, 'word/document.xml', '-d', tmp], { encoding: 'utf8' });
    const xmlFile = path.join(tmp, 'word', 'document.xml');
    if (r.status !== 0 || !fs.existsSync(xmlFile)) throw new Error('não consegui abrir o .docx');
    const xml = fs.readFileSync(xmlFile, 'utf8');
    const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
    return paras.map((p) => unescapeXml((p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''))).filter((t) => t.trim()).join('\n');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export async function generateSkillFromDoc(s: Settings, input: SkillDocInput, log: (l: string) => void, signal?: AbortSignal): Promise<{ skill: Skill; routeName: string; warnings: string[] }> {
  if (!fs.existsSync(input.file)) throw new Error('arquivo não encontrado');
  const text = documentText(input.file).trim();
  if (text.length < 200) throw new Error('o documento tem pouco texto para virar uma skill');
  const workdir = path.join(s.workspace, 'skillgen', `doc-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, 'documento.txt'), text, 'utf8');
  const route = input.routeId ? getAnyRoute(s, input.routeId) : undefined;
  const lang = input.language || 'pt-BR';
  const prompt = `Você é o CRIADOR DE SKILLS do FilmForge. Converta o documento abaixo (prompts e regras de um canal do YouTube) em UMA skill do FilmForge, gravando skill.md nesta pasta.

## Documento (${path.basename(input.file)} — também em documento.txt)
${text.slice(0, 30000)}

## Como converter
- Cada seção do documento vira as instruções da etapa correspondente, PRESERVANDO as regras concretas (números de palavras, voz/pessoa, fórmulas de título, o que é proibido, formato de saída):
  temas/títulos → "## Etapa: ideation"; roteiro → "## Etapa: script"; ritmo, planos e o que se vê → "## Etapa: scene_plan" e "## Etapa: code_scene"; personagens/locais → "## Etapa: asset_design"; thumbnail → "## Etapa: thumbnail"; título/descrição/tags → "## Etapa: metadata".
- O que vale para tudo (público, tom, promessa do canal) vai em "## Global".
- Adapte o que for específico do outro sistema (formatos de saída do documento) ao que cada etapa do FilmForge grava; não invente regras que o documento não tem.
${route ? `- routeId OBRIGATÓRIO: ${route.id} (${route.name}).` : ''}

${skillRules(s, lang)}

Grave APENAS skill.md.`;
  const { id, cfg, model } = await resolveHarness(s, { type: 'harness', harness: input.harness, model: input.model });
  log(`convertendo o documento com ${id}${model ? '/' + model : ''}…`);
  const res = await runHarness(cfg, { cwd: workdir, prompt, model, signal: signal ?? new AbortController().signal, onLine: (l) => log(l.slice(0, 300)), timeoutSec: 1500,
    env: id === 'antigravity' ? activeAgyEnv(s) : undefined, tools: isHttpHarness(cfg) ? undefined : { roots: [workdir], allowShell: false } });
  const mdFile = path.join(workdir, 'skill.md');
  if (!fs.existsSync(mdFile) && res.stdout.includes('---')) fs.writeFileSync(mdFile, res.stdout.slice(res.stdout.indexOf('---')).replace(/\n```\s*$/, ''));
  if (!fs.existsSync(mdFile)) throw new Error(`${id} não gravou skill.md${res.ok ? '' : `: ${res.stderr.slice(-300)}`}`);
  const fin = finalizeSkillMd(s, fs.readFileSync(mdFile, 'utf8'), { name: input.name, language: lang, sourceNote: `Criada a partir do documento ${path.basename(input.file)}`, fallbackId: 'skill-de-documento' });
  let skill = fin.skill;
  if (route && skill.routeId !== route.id) skill = saveSkill(s, { ...skill, routeId: route.id });
  log(`skill "${skill.name}" salva (rota: ${route?.name ?? fin.route.name})`);
  return { skill, routeName: route?.name ?? fin.route.name, warnings: fin.warnings };
}
