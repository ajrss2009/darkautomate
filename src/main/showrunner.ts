import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, Wan2gpConfig } from '../shared/types';
import { SHOWRUNNER_DIRECTORS } from '../shared/types';
import { wan2gpLanguage } from './wan2gp';

/*
 * Showrunner do Wan2GP: o "diretor" do próprio Wan2GP (Deepy Prime, LLM local) planeja as tomadas, escala o elenco, filma
 * com os modelos do Wan2GP, revisa as tomadas e monta. O FilmForge cria a produção a partir do projeto (ideia, roteiro,
 * duração, formato, idioma), escolhe os modelos que estão instalados, manda o diretor trabalhar sozinho e traz o vídeo
 * final para out/final.mp4. Fala com a API HTTP do Showrunner em <servidor do Wan2GP>/showrunner/api.
 */

export type ShowrunnerKind = 'music_video' | 'short_film' | 'ad' | 'trailer' | 'story' | 'free';
export const SHOWRUNNER_KINDS: Array<[ShowrunnerKind, string]> = [['free', 'Livre (a partir da ideia)'], ['short_film', 'Curta-metragem'], ['music_video', 'Clipe musical'],
  ['ad', 'Comercial'], ['trailer', 'Trailer'], ['story', 'História ilustrada']];

/** Formato da produção a partir do projeto (parâmetro da etapa vence). Função pura. */
export function showrunnerKind(p: Pick<Project, 'videoType' | 'idea' | 'name'>, param?: unknown): ShowrunnerKind {
  if (typeof param === 'string' && SHOWRUNNER_KINDS.some(([k]) => k === param)) return param as ShowrunnerKind;
  const t = `${p.videoType ?? ''} ${p.name ?? ''} ${p.idea ?? ''}`.toLowerCase();
  if (/clipe|music ?video|videoclipe|lyric/.test(t)) return 'music_video';
  if (/trailer/.test(t)) return 'trailer';
  if (/comercial|propaganda|an[úu]ncio|\bad\b|publicidade/.test(t)) return 'ad';
  if (/hist[óo]ria ilustrada|livro ilustrado|picture ?book|conto infantil/.test(t)) return 'story';
  if (/curta|short film|drama|dorama|novela|cinematic|cinematogr/.test(t)) return 'short_film';
  return 'free';
}

/** Brief do Showrunner a partir do projeto: ideia + roteiro (falas das cenas, se já houver), duração, formato e idioma. Função pura. */
export function showrunnerBrief(p: Pick<Project, 'name' | 'idea' | 'aspect' | 'targetDurationSec' | 'language' | 'videoStyle' | 'scenes'>, kind: ShowrunnerKind): { title: string; kind: ShowrunnerKind; brief: Record<string, unknown> } {
  const script = (p.scenes ?? []).map((s) => (s.narration ?? '').trim()).filter(Boolean).join('\n\n');
  const lang = (p.language ?? 'pt-BR').toLowerCase().split(/[-_]/)[0] || 'pt';
  return {
    title: (p.name || 'Produção').slice(0, 200), kind,
    brief: {
      text: p.idea ?? '', ...(script ? { script } : {}),
      duration_s: Math.max(5, Math.min(600, Math.round(p.targetDurationSec || 60))),
      aspect: p.aspect === '9:16' || p.aspect === '1:1' ? p.aspect : '16:9', resolution: '720p', language: lang,
      ...(p.videoStyle ? { style: p.videoStyle } : {}),
      plan_first: false,          // planeja e filma de uma vez (sem parar para revisão manual)
      review_before_edit: false,  // monta sozinho depois de revisar as tomadas
    },
  };
}

/** Modelos preferidos por papel (os instalados neste Wan2GP primeiro); o resto fica no automático do Showrunner. */
export const SHOWRUNNER_PREFS: Record<string, RegExp[]> = {
  images: [/z.?image/i, /moss/i, /krea/i],
  image_edits: [/krea.*(identity|edit)/i, /moss.*edit/i],
  /* MiniMax H3 baixados: FL2VA Pruned (PDD 8 passos) e Ref2VA Pruned (PDD 8 passos); FastH3/Omni/Lightx2v não estão no disco */
  shots_without_cast: [/fl2va pruned pdd/i, /fl2va pruned(?!.*(veda|vdn))/i, /ltx.?2\.?5/i],
  /* tomadas com fala (inclusive o narrador fora de cena): o H3 FL2VA PDD "With Sound" segue a fala como trilha; o automático (InfiniTalk) pede LoRAs do Wan 2.1 não baixados */
  cast_shots_lip_synced: [/^(?!.*(pika|flex|turbo|lightx)).*fl2va pruned pdd.*sound/i, /^(?!.*(pika|flex|turbo|lightx)).*h3.*pdd.*sound/i],
  cast_shots: [/^(?!.*(pika|flex)).*ref2va pruned pdd/i, /^(?!.*(pika|flex|turbo|lightx|veda|ptd)).*ref2va pruned/i],
  music: [/ace.?step/i, /yue/i, /stable.?audio/i],
  voices: [/omni.?voice/i, /fish/i, /auk/i],
  cloned_voices: [/omni.?voice/i, /h3.*(tts|voice)/i, /index.?tts/i, /fish/i],
};

export interface ShowrunnerRole { id: string; value?: string | null; auto?: string | null; choices: Array<{ value: string; label: string }> }

/** Escolha de modelo por papel: o primeiro da lista de preferências que existe no catálogo; nada quando já é o escolhido. Função pura. */
export function pickShowrunnerTemplates(roles: ShowrunnerRole[], prefs = SHOWRUNNER_PREFS): Array<{ role: string; template: string }> {
  const out: Array<{ role: string; template: string }> = [];
  for (const r of roles) {
    for (const re of prefs[r.id] ?? []) {
      const c = r.choices.find((x) => re.test(`${x.label} ${x.value}`));
      if (c) { if (c.value !== (r.value ?? r.auto)) out.push({ role: r.id, template: c.value }); break; }
    }
  }
  return out;
}


/**
 * Grava a versão do diretor no wgp_config.json do Wan2GP (llm_engines.deepy), com backup do original na 1ª troca.
 * Devolve true se mudou (o servidor precisa ser reaberto para valer).
 */
export function setWanDirector(root: string, engine: string | undefined): boolean {
  if (!engine || !SHOWRUNNER_DIRECTORS.some(([k]) => k && k === engine)) return false;
  const file = path.join(root, 'wgp_config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as { llm_engines?: Record<string, unknown> };
  if (cfg.llm_engines?.['deepy'] === engine) return false;
  const bak = `${file}.filmforge-bak`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  cfg.llm_engines = { ...(cfg.llm_engines ?? {}), deepy: engine };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 4), 'utf8');
  return true;
}

/** Template de voz clonada com a OmniVoice para o Showrunner (o Deepy só traz Fish/Index TTS 2/MOSS, não baixados aqui). */
export const OMNIVOICE_TEMPLATE = 'omnivoice/OmniVoice FilmForge.json';
/**
 * Grava o template personalizado do Deepy em <Wan2GP>/loras/omnivoice/OmniVoice FilmForge.json (o Wan2GP lista templates
 * personalizados pela pasta de LoRAs do modelo). Clonagem: audio_prompt_type A, a fala vem no prompt e a amostra em audio_guide.
 */
export function ensureOmniVoiceTemplate(root: string, language = 'auto'): string | undefined {
  const dir = path.join(root, 'loras', 'omnivoice');
  if (!fs.existsSync(path.join(root, 'wgp.py'))) return undefined;
  fs.mkdirSync(dir, { recursive: true });
  const tpl = { model_type: 'omnivoice', prompt: '', alt_prompt: '', audio_prompt_type: 'A', model_mode: language, multi_prompts_gen_type: 'FG', duration_seconds: 0, pause_seconds: 0.2,
    num_inference_steps: 32, guidance_scale: 2.0, temperature: 0.1, seed: -1, image_mode: 0, video_length: 0, batch_size: 1, repeat_generation: 1, prompt_enhancer: '', override_profile: -1, settings_version: 2.55 };
  const file = path.join(dir, 'OmniVoice FilmForge.json'), text = JSON.stringify(tpl, null, 4);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text, 'utf8');
  return OMNIVOICE_TEMPLATE;
}

/** Tomadas do Showrunner a partir das cenas do FilmForge (modo "o app planeja"): o que acontece, câmera, duração e a fala do narrador. Função pura. */
export function showrunnerShots(p: Pick<Project, 'scenes'>, narrator?: string): Array<Record<string, unknown>> {
  return (p.scenes ?? []).map((s) => {
    const sc = s as typeof s & { videoPrompt?: string };
    const line = (s.narration ?? '').trim();
    return {
      title: (s.title || `Cena ${s.index}`).slice(0, 120), section: '', intent: (sc.videoPrompt || s.visualIntent || s.title || '').trim(), camera: s.camera ?? '',
      duration_s: Math.max(2, Math.min(15, Math.round((s.durationSec ?? 5) * 10) / 10)),
      ...(narrator && line ? { dialogue: [{ speaker: narrator, line, note: '' }] } : {}),
    };
  });
}

/** URL base do servidor do Wan2GP (sem barra no fim). */
export const wanServer = (cfg: Wan2gpConfig) => (cfg.serverUrl?.trim() || 'http://127.0.0.1:7860').replace(/\/+$/, '');

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((r, j) => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); j(new Error('cancelado')); }, { once: true }); });

async function api<T>(base: string, p: string, init?: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
  const ctl = AbortSignal.timeout(init?.timeoutMs ?? 60_000);
  const res = await fetch(`${base}/showrunner/api${p}`, { method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined, signal: init?.signal ? AbortSignal.any([init.signal, ctl]) : ctl });
  const text = await res.text();
  if (!res.ok) { let d = text; try { d = (JSON.parse(text) as { detail?: string }).detail ?? text; } catch { /* texto puro */ } throw new Error(`Showrunner ${res.status}: ${String(d).slice(0, 300)}`); }
  return (text ? JSON.parse(text) : {}) as T;
}

/** O Showrunner responde? (servidor do Wan2GP aberto com o plugin ativo) */
export async function showrunnerUp(base: string): Promise<boolean> {
  try { await api(base, '/state', { timeoutMs: 4000 }); return true; } catch { return false; }
}

/** Garante o servidor do Wan2GP: se não estiver aberto, abre `python wgp.py --server-port N` na pasta do Wan2GP e espera o Showrunner. */
export async function ensureWanServer(cfg: Wan2gpConfig, log: (l: string) => void, signal?: AbortSignal, waitMs = 15 * 60_000, logFile?: string): Promise<string> {
  const base = wanServer(cfg);
  if (await showrunnerUp(base)) return base;
  if (!cfg.root || !fs.existsSync(path.join(cfg.root, 'wgp.py'))) throw new Error('Showrunner: servidor do Wan2GP fechado e pasta do Wan2GP não configurada (Configurações → Wan2GP)');
  const port = new URL(base).port || '7860';
  log(`Showrunner: abrindo o servidor do Wan2GP (${base}) — o primeiro carregamento demora alguns minutos${logFile ? ` (saída em ${logFile})` : ''}`);
  /* a saída do servidor vai para um arquivo: se ele cair, o motivo fica registrado */
  let out: number | 'ignore' = 'ignore';
  if (logFile) { fs.mkdirSync(path.dirname(logFile), { recursive: true }); out = fs.openSync(logFile, 'a'); }
  /* perfil de memória: o padrão do app é o 5, à prova de falhas (o diretor + os modelos não cabem na RAM com o 4.5, que reserva ~19 GB) */
  const profile = cfg.serverProfile ?? '5';
  const proc = spawn(cfg.python || 'python', ['wgp.py', '--server-port', port, ...(profile ? ['--profile', profile] : []), ...cfg.cliArgs], { cwd: cfg.root, detached: true, stdio: ['ignore', out, out], windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } });
  proc.unref();
  if (typeof out === 'number') fs.closeSync(out);
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    await sleep(5000, signal);
    if (await showrunnerUp(base)) { log(`Showrunner: servidor pronto em ${Math.round((Date.now() - t0) / 1000)} s`); return base; }
  }
  throw new Error(`Showrunner: o servidor do Wan2GP não respondeu em ${Math.round(waitMs / 60000)} min (${base})`);
}

interface ProductionDoc { id: string; stage: string; shots: Array<{ status?: string; included?: boolean }>; deliverables: Array<{ path?: string; kind?: string; revision?: number }>; director?: { state?: string } }
interface DirectorStatus { state: string; task?: string | null; running?: boolean; available?: boolean; reason?: string; last?: { status?: string; summary?: string; error?: string } | null; live?: { tools?: Array<{ name?: string; label?: string }> } }

/**
 * Produção completa: cria (ou retoma, pelo arquivo `stateFile`), escolhe os modelos instalados, manda o diretor planejar,
 * filmar e montar, acompanha até terminar e baixa o vídeo final para `dest`.
 */
export async function runShowrunner(o: { cfg: Wan2gpConfig; project: Project; kind: ShowrunnerKind; dest: string; stateFile: string; log: (l: string) => void; signal: AbortSignal; pollMs?: number; maxHours?: number;
  /** 'director' = o diretor do Wan2GP planeja e filma; 'app' = as cenas do FilmForge viram as tomadas e o Showrunner só filma e monta */ mode?: 'director' | 'app'; director?: string; narratorVoice?: string }): Promise<{ file: string; production: string }> {
  const mode = o.mode ?? 'director';
  /* versão do diretor: grava no wgp_config.json antes de abrir o servidor (só no modo diretor; o modo app não usa LLM) */
  if (mode === 'director' && o.director && o.cfg.root) {
    const up = await showrunnerUp(wanServer(o.cfg));
    if (setWanDirector(o.cfg.root, o.director)) {
      o.log(`Showrunner: diretor do Wan2GP trocado para ${o.director} (backup em wgp_config.json.filmforge-bak)`);
      if (up) throw new Error(`Showrunner: o Wan2GP está aberto com o diretor antigo — feche o Wan2GP e rode de novo para o app abri-lo com ${o.director}`);
    }
  }
  const base = await ensureWanServer(o.cfg, o.log, o.signal, undefined, path.join(path.dirname(o.stateFile), 'wan2gp-server.log'));
  if (mode === 'app') return runAppPlanned(base, o);
  const id = await openProduction(base, o, 'director');
  const pid = encodeURIComponent(id);
  let doc = await api<ProductionDoc>(base, `/productions/${pid}`);
  if (!doc.deliverables.some((d) => d.kind === 'video' && d.path)) {
    let st = await api<DirectorStatus>(base, `/productions/${pid}/director`);
    if (st.available === false) throw new Error(`Showrunner: o diretor (Deepy Prime) não está disponível — ${st.reason ?? 'configure em Configuration > Prompt Enhancer / Deepy no Wan2GP'}`);
    if (!st.running && (st.state === 'idle' || st.state === 'paused')) {
      const task = st.state === 'paused' ? 'resume' : doc.shots.length ? 'continue' : 'plan';
      st = await api<DirectorStatus>(base, `/productions/${pid}/director`, { body: { task, message: 'Plan, shoot, review and assemble the whole production on your own, without waiting for me.' } });
      o.log(`Showrunner: diretor trabalhando (${task}) — acompanhe também em ${base}/showrunner/`);
    }
    const t0 = Date.now(), maxMs = (o.maxHours ?? 8) * 3600_000;
    let lastLine = '', retries = 0, shootOrders = 0, misses = 0;
    let abort = () => {};
    o.signal.addEventListener('abort', abort = () => { void api(base, `/productions/${pid}/director/stop`, { body: {} }).catch(() => undefined); }, { once: true });
    try {
      for (;;) {
        await sleep(o.pollMs ?? 15_000, o.signal);
        /* durante a filmagem o servidor pode demorar a responder: tolera até 30 consultas seguidas sem resposta */
        try {
          st = await api<DirectorStatus>(base, `/productions/${pid}/director`, { timeoutMs: 120_000 });
          doc = await api<ProductionDoc>(base, `/productions/${pid}`, { timeoutMs: 120_000 });
          misses = 0;
        } catch (e) {
          if (o.signal.aborted) throw e;
          if (++misses > 30) throw new Error(`Showrunner: o servidor do Wan2GP parou de responder (${(e as Error).message.slice(0, 120)})`);
          if (misses === 1 || misses % 5 === 0) o.log(`Showrunner: servidor ocupado, sem resposta (${misses}/30) — continuo esperando`);
          continue;
        }
        const done = doc.shots.filter((s) => s.included !== false && (s.status === 'rendered' || s.status === 'approved')).length, total = doc.shots.filter((s) => s.included !== false).length;
        const tool = st.live?.tools?.slice(-1)[0];
        const line = `Showrunner: ${st.task ?? st.state} · ${doc.stage}${total ? ` · ${done}/${total} tomada(s)` : ''}${tool ? ` · ${tool.label ?? tool.name}` : ''}`;
        if (line !== lastLine) { o.log(line); lastLine = line; }
        if (!st.running && st.state === 'idle') {
          /* o diretor travou (ex.: falta de VRAM ao recarregar o LLM depois de gerar): continua de onde parou, até 2 vezes */
          const crashed = /cancel|crash|error|interrupt/i.test(`${st.last?.status ?? ''} ${(st.last as { text?: string } | null)?.text ?? ''}`) && !doc.deliverables.some((d) => d.kind === 'video' && d.path);
          /* o plano ficou pronto e o diretor parou para revisão: manda filmar (e, depois, montar) */
          const unshot = doc.shots.filter((s) => s.included !== false && !(s as { takes?: unknown[] }).takes?.length && s.status !== 'failed').length;
          if (!crashed && unshot && shootOrders < 2) {
            shootOrders++;
            o.log(`Showrunner: plano pronto (${doc.shots.length} tomada(s)) — mandando o diretor filmar e montar`);
            await api(base, `/productions/${pid}/director`, { body: { task: 'shoot', message: 'Shoot every planned shot, check the takes, redo the failed ones and assemble the edit, on your own, without waiting for me.' } });
            continue;
          }
          /* todas as tomadas filmadas e o diretor travou (ex.: sem RAM para recarregar o LLM): monta direto, sem o diretor */
          if (crashed && !unshot && doc.shots.length) { o.log('Showrunner: todas as tomadas filmadas — montando sem o diretor'); break; }
          if (crashed && retries < 2) {
            retries++;
            o.log(`Showrunner: o diretor parou (${String((st.last as { text?: string } | null)?.text ?? st.last?.status ?? '').slice(0, 140)}) — continuando (${retries}/2)`);
            await sleep(15_000, o.signal);   // dá tempo de a GPU esvaziar
            await api(base, `/productions/${pid}/director`, { body: { task: doc.shots.length ? 'continue' : 'plan', message: 'You stopped because of a GPU memory error. Continue the production from where you were, on your own, until the edit is assembled.' } });
            continue;
          }
          break;
        }
        if (Date.now() - t0 > maxMs) throw new Error(`Showrunner: passou de ${o.maxHours ?? 8} h — a produção continua no Wan2GP (${base}/showrunner/)`);
      }
    } finally { o.signal.removeEventListener('abort', abort); }
    if (st.last?.status && /error|fail|interrupt/i.test(st.last.status)) o.log(`Showrunner: o diretor terminou com "${st.last.status}"${st.last.error ? `: ${st.last.error.slice(0, 200)}` : ''}`);
    doc = await api<ProductionDoc>(base, `/productions/${pid}`);
    /* sem versão montada (o diretor parou antes): monta o que houver */
    if (!doc.deliverables.some((d) => d.kind === 'video' && d.path)) {
      const why = String((st.last as { text?: string } | null)?.text ?? st.last?.summary ?? '').slice(0, 220);
      if (!doc.shots.length) throw new Error(`Showrunner: o diretor não planejou nenhuma tomada${why ? ` — ${why}` : ''}`);
      if (!doc.shots.some((s) => (s as { takes?: unknown[] }).takes?.length)) throw new Error(`Showrunner: o diretor planejou ${doc.shots.length} tomada(s) mas não filmou nenhuma${why ? ` — ${why}` : ''}`);
      o.log('Showrunner: montando a versão final');
      await api(base, `/productions/${pid}/assemble`, { body: {}, timeoutMs: 3600_000 });
      doc = await api<ProductionDoc>(base, `/productions/${pid}`);
    }
  }
  return { file: await downloadLast(base, id, doc, o.dest, o.signal, o.log), production: id };
}

/** Retoma a produção gravada em `stateFile` ou cria uma nova (com os modelos instalados no lugar dos padrões do Deepy). */
async function openProduction(base: string, o: { cfg: Wan2gpConfig; project: Project; kind: ShowrunnerKind; stateFile: string; log: (l: string) => void }, mode: string): Promise<string> {
  let id = '';
  try { const st = JSON.parse(fs.readFileSync(o.stateFile, 'utf8')) as { production?: string; mode?: string }; id = (st.mode ?? 'director') === mode ? st.production ?? '' : ''; } catch { /* produção nova */ }
  if (id) { try { await api(base, `/productions/${encodeURIComponent(id)}`); o.log(`Showrunner: retomando a produção ${id}`); await pickInstalled(base, id, o.log); return id; } catch { id = ''; } }
  const b = showrunnerBrief(o.project, o.kind);
  /* falas com a OmniVoice (instalada) em vez dos modelos de voz do Deepy que não estão baixados */
  const omni = o.cfg.root ? ensureOmniVoiceTemplate(o.cfg.root, wan2gpLanguage(o.project.language).name) : undefined;
  if (omni) { b.brief['templates'] = { cloned_voices: `gen_speech_from_sample/${omni}` }; o.log('Showrunner: falas com a OmniVoice (voz clonada)'); }
  id = (await api<{ id: string }>(base, '/productions', { body: b })).id;
  fs.mkdirSync(path.dirname(o.stateFile), { recursive: true });
  fs.writeFileSync(o.stateFile, JSON.stringify({ production: id, server: base, kind: o.kind, mode, at: new Date().toISOString() }, null, 1));
  o.log(`Showrunner: produção "${b.title}" criada (${o.kind}, ${b.brief['duration_s']} s, ${mode === 'app' ? 'plano do FilmForge' : 'plano do diretor'}) — id ${id}`);
  await pickInstalled(base, id, o.log);
  return id;
}

/** Modelos instalados no lugar dos padrões do Deepy (que podem apontar para modelos não baixados); as tomadas no modelo antigo passam para o novo. */
async function pickInstalled(base: string, id: string, log: (l: string) => void): Promise<void> {
  try {
    const roles = (await api<{ roles: ShowrunnerRole[] }>(base, `/productions/${encodeURIComponent(id)}/templates`)).roles;
    for (const pk of pickShowrunnerTemplates(roles)) {
      try { await api(base, `/productions/${encodeURIComponent(id)}/templates`, { body: pk }); log(`Showrunner: ${pk.role} → ${pk.template}`); }
      catch (e) { log(`Showrunner: não deu para escolher ${pk.template} (${(e as Error).message.slice(0, 120)})`); }
    }
  } catch (e) { log(`Showrunner: modelos no automático (${(e as Error).message.slice(0, 120)})`); }
}

/** Baixa a última versão montada para `<dest>.download.<ext>` e devolve o caminho. */
async function downloadLast(base: string, id: string, doc: ProductionDoc, dest: string, signal: AbortSignal, log: (l: string) => void): Promise<string> {
  const last = [...doc.deliverables].reverse().find((d) => d.kind === 'video' && d.path);
  if (!last?.path) throw new Error('Showrunner: nenhuma versão montada para baixar');
  const res = await fetch(`${base}/showrunner/api/productions/${encodeURIComponent(id)}/file?path=${encodeURIComponent(last.path)}&download=true`, { signal });
  if (!res.ok) throw new Error(`Showrunner: não deu para baixar ${last.path} (${res.status})`);
  const tmp = `${dest}.download${path.extname(last.path) || '.mp4'}`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  log(`Showrunner: versão ${last.revision ?? ''} baixada (${path.basename(last.path)}, ${(fs.statSync(tmp).size / 1e6).toFixed(1)} MB)`);
  return tmp;
}

/**
 * Modo "o app planeja": as cenas do FilmForge (roteiro e plano já feitos pelo app) viram as tomadas da produção, com a fala do
 * narrador; o Showrunner filma cada uma ("Render now", sem o diretor) e monta. Não precisa do LLM do Wan2GP.
 */
async function runAppPlanned(base: string, o: { cfg: Wan2gpConfig; project: Project; kind: ShowrunnerKind; dest: string; stateFile: string; log: (l: string) => void; signal: AbortSignal; pollMs?: number; maxHours?: number; narratorVoice?: string }): Promise<{ file: string; production: string }> {
  if (!o.project.scenes?.length) throw new Error('Showrunner (plano do app): o projeto ainda não tem cenas — a etapa "Planejar cenas" vem antes');
  const id = await openProduction(base, o, 'app'), pid = encodeURIComponent(id);
  let doc = await api<ProductionDoc & { cast?: Array<{ name?: string }> }>(base, `/productions/${pid}`);
  if (!doc.shots.length) {
    const narrated = o.project.scenes.some((s) => (s.narration ?? '').trim());
    const ops: Array<Record<string, unknown>> = [];
    if (narrated) ops.push({ op: 'add_cast', fields: { name: 'Narrator', role: 'narrator', description: 'Off-screen narrator: heard, never shown.', voice_description: o.narratorVoice || 'warm, clear adult male narrator, calm documentary pace' } });
    ops.push({ op: 'add_shots', shots: showrunnerShots(o.project, narrated ? 'Narrator' : undefined) });
    await api(base, `/productions/${pid}/ops`, { body: { ops } });
    doc = await api(base, `/productions/${pid}`);
    o.log(`Showrunner: ${doc.shots.length} tomada(s) escritas pelo FilmForge${narrated ? ' (com o narrador)' : ''}`);
    /* a voz do projeto vira a amostra do narrador: as falas são clonadas dela (sem gerar uma voz pela descrição) */
    const voice = o.project.narrationVoice?.refAudio;
    const narrator = (doc as { cast?: Array<{ id: string; name?: string }> }).cast?.find((c) => c.name === 'Narrator');
    if (narrated && narrator && voice && fs.existsSync(voice)) {
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(voice)]), path.basename(voice));
      form.append('role', 'cast'); form.append('target', narrator.id);
      const res = await fetch(`${base}/showrunner/api/productions/${pid}/upload`, { method: 'POST', body: form, signal: AbortSignal.any([o.signal, AbortSignal.timeout(120_000)]) });
      if (res.ok) o.log(`Showrunner: voz do narrador = ${path.basename(voice)}`);
      else o.log(`Showrunner: não deu para enviar a voz do narrador (${res.status}: ${(await res.text()).slice(0, 160)}) — ele usa a voz da descrição`);
    } else if (narrated) o.log('Showrunner: o projeto não tem voz de narração — o Showrunner cria a voz pela descrição (modelo de voz do Deepy)');
  }
  type Shot = { id: string; status?: string; included?: boolean; takes?: unknown[]; title?: string };
  const shots = () => (doc.shots as Shot[]).filter((s) => s.included !== false);
  const todo = shots().filter((s) => !s.takes?.length && s.status !== 'rendering' && s.status !== 'queued').map((s) => s.id);
  if (todo.length) { await api(base, `/productions/${pid}/render`, { body: { shots: todo } }); o.log(`Showrunner: filmando ${todo.length} tomada(s) com os modelos do Wan2GP`); }
  const t0 = Date.now(), maxMs = (o.maxHours ?? 8) * 3600_000;
  let lastLine = '', misses = 0;
  for (;;) {
    try { doc = await api(base, `/productions/${pid}`, { timeoutMs: 120_000 }); misses = 0; }
    catch (e) {
      if (o.signal.aborted) throw e;
      if (++misses > 30) throw new Error(`Showrunner: o servidor do Wan2GP parou de responder (${(e as Error).message.slice(0, 120)})`);
      await sleep(o.pollMs ?? 10_000, o.signal);
      continue;
    }
    const all = shots(), busy = all.filter((s) => s.status === 'rendering' || s.status === 'queued').length, ok = all.filter((s) => s.takes?.length).length, failed = all.filter((s) => s.status === 'failed').length;
    const line = `Showrunner: ${ok}/${all.length} tomada(s) prontas${failed ? `, ${failed} com erro` : ''}${busy ? `, ${busy} em andamento` : ''}`;
    if (line !== lastLine) { o.log(line); lastLine = line; }
    if (!busy) break;
    if (Date.now() - t0 > maxMs) throw new Error(`Showrunner: passou de ${o.maxHours ?? 8} h — a produção continua no Wan2GP (${base}/showrunner/)`);
    await sleep(o.pollMs ?? 10_000, o.signal);
  }
  const ready = shots().filter((s) => s.takes?.length);
  if (!ready.length) {
    const log = ((doc as unknown as { log?: Array<{ text?: string }> }).log ?? []).slice(-3).map((x) => x.text).filter(Boolean).join(' | ');
    throw new Error(`Showrunner: nenhuma tomada foi filmada${log ? ` — ${log.slice(0, 300)}` : ''}`);
  }
  o.log('Showrunner: montando a versão final');
  await api(base, `/productions/${pid}/assemble`, { body: {}, timeoutMs: 3600_000 });
  doc = await api(base, `/productions/${pid}`);
  return { file: await downloadLast(base, id, doc, o.dest, o.signal, o.log), production: id };
}
