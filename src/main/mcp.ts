import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, Settings } from '../shared/types';
import * as lib from './library';
import * as ops from './ops';
import { installPluginUrl, listPlugins, pluginPrompt } from './plugins';
import { createProject, projectsDir } from './settings';
import { detectHarnessAsync, listHarnessModels } from './harness';

/**
 * FilmForge como **servidor MCP** (Model Context Protocol) por stdio.
 *
 * Assim qualquer agente compatível (Claude Desktop/Code, OpenCode, Cursor, LM Studio…)
 * pode dirigir o estúdio: listar/criar projetos, executar rotas, acompanhar o progresso,
 * ler o log e as cenas, consultar provedores/modelos, plugins e biblioteca.
 *
 * Ativação: `FilmForge.exe --mcp` (o processo fica sem janela; o protocolo usa
 * stdout e os diagnósticos vão para stderr).
 */

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface McpDeps {
  getSettings: () => Settings;
  version: string;
  /** linhas da aba Projetos (status, miniaturas, mídia…) */
  listRows: () => Promise<Array<Record<string, unknown>>>;
  runProject: (id: string, only?: { stepIds?: string[]; sceneIds?: string[] }, resume?: boolean) => Promise<{ ok: boolean; error?: string }>;
  cancelProject: (id: string) => boolean;
  renderFinal: (id: string) => Promise<{ ok: boolean; error?: string }>;
  running: () => string[];
  progressOf: (id: string) => unknown;
  log?: (line: string) => void;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const obj = (props: Record<string, unknown>, required: string[] = []): Record<string, unknown> =>
  ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const bool = (description: string) => ({ type: 'boolean', description });
const arr = (description: string, items: Record<string, unknown>) => ({ type: 'array', description, items });

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'filmforge_projects',
    description: 'Lista os projetos do FilmForge (id, nome, status, cenas, se já existe vídeo final, rota e skill).',
    inputSchema: obj({ status: str('Filtra por status: new, running, done, failed, partial') }),
  },
  {
    name: 'filmforge_project',
    description: 'Detalha um projeto: cenas (narração, visual, duração, status por etapa), parâmetros da última execução e arquivos gerados.',
    inputSchema: obj({ projectId: str('id do projeto') }, ['projectId']),
  },
  {
    name: 'filmforge_create_project',
    description: 'Cria um projeto de vídeo. Sem skillId/routeId usa a rota "Vídeo livre" (o prompt vai direto ao provedor).',
    inputSchema: obj({
      name: str('nome do projeto'), idea: str('ideia, roteiro ou prompt do vídeo'),
      skillId: str('id da skill (tipo de vídeo) — opcional'), routeId: str('id da rota — opcional'),
      aspect: { type: 'string', enum: ['9:16', '16:9', '1:1', '4:5'], description: 'formato' },
      durationSec: num('duração alvo em segundos'),
      language: str('idioma do vídeo (ex.: pt-BR)'),
      quality: { type: 'string', enum: ['standard', 'depth', 'polished', 'verified', 'ultra'], description: 'nível de qualidade' },
      plugins: arr('ids de plugins (formato Claude) aplicados ao projeto', { type: 'string' }),
      sceneConcurrency: num('cenas em paralelo (1–8)'),
      maxProductionMin: num('tempo máximo de execução em minutos (0 = sem limite)'),
    }, ['name', 'idea']),
  },
  {
    name: 'filmforge_run',
    description: 'Executa a rota do projeto (assíncrono). Use filmforge_status para acompanhar. resume=true continua de onde parou (usa o cache).',
    inputSchema: obj({
      projectId: str('id do projeto'), resume: bool('continuar de onde parou'),
      stepIds: arr('executar só estas etapas da rota', { type: 'string' }),
      sceneIds: arr('executar só estas cenas', { type: 'string' }),
    }, ['projectId']),
  },
  {
    name: 'filmforge_cancel',
    description: 'Para a execução em andamento (o que já foi gerado fica salvo e pode ser retomado).',
    inputSchema: obj({ projectId: str('id do projeto') }, ['projectId']),
  },
  {
    name: 'filmforge_status',
    description: 'Status da execução: rodando ou não, progresso (cenas/entregáveis), ETA, parâmetros e as últimas linhas do log.',
    inputSchema: obj({ projectId: str('id do projeto'), tail: num('quantas linhas do log (padrão 20)') }, ['projectId']),
  },
  {
    name: 'filmforge_log',
    description: 'Log da última execução do projeto (mais recente no fim).',
    inputSchema: obj({ projectId: str('id do projeto'), tail: num('quantas linhas (padrão 80)') }, ['projectId']),
  },
  {
    name: 'filmforge_render_final',
    description: 'Remonta o vídeo final (out/final.mp4) a partir das cenas já geradas.',
    inputSchema: obj({ projectId: str('id do projeto') }, ['projectId']),
  },
  {
    name: 'filmforge_scene_update',
    description: 'Edita uma cena (título, narração, legenda, intenção visual, duração, tipo, notas). Use regenerate=true para regerar a mídia na hora.',
    inputSchema: obj({
      projectId: str('id do projeto'), sceneId: str('id da cena'),
      title: str('título'), narration: str('narração'), subtitle: str('texto da legenda'),
      visualIntent: str('descrição visual'), durationSec: num('duração em segundos'),
      kind: { type: 'string', enum: ['image', 'video', 'code', 'motion', 'mixed', 'stock'], description: 'tipo da cena' },
      notes: str('ajustes pedidos ao modelo'), regenerate: bool('regerar a mídia depois de salvar'),
    }, ['projectId', 'sceneId']),
  },
  {
    name: 'filmforge_skills',
    description: 'Lista as skills (tipos de vídeo) disponíveis, com descrição e se são "vídeo livre".',
    inputSchema: obj({}),
  },
  {
    name: 'filmforge_routes',
    description: 'Lista as rotas de produção com suas etapas e executores.',
    inputSchema: obj({ id: str('detalha só esta rota') }),
  },
  {
    name: 'filmforge_providers',
    description: 'Lista os provedores (harnesses CLI e servidores locais: claude, opencode, codex, antigravity/agy, openclaw, ollama, llama.cpp, LM Studio) com disponibilidade, modelos e ferramentas.',
    inputSchema: obj({ detect: bool('testar disponibilidade agora (padrão true)') }),
  },
  {
    name: 'filmforge_provider_models',
    description: 'Consulta os modelos de um provedor (ex.: antigravity → `agy models`; ollama → /api/tags).',
    inputSchema: obj({ id: str('id do provedor') }, ['id']),
  },
  {
    name: 'filmforge_plugins',
    description: 'Lista os plugins instalados (formato Claude) e, com id, mostra o texto que vai no prompt.',
    inputSchema: obj({ id: str('detalha o prompt deste plugin') }),
  },
  {
    name: 'filmforge_plugin_install',
    description: 'Instala (ou atualiza) um plugin a partir de uma URL do GitHub no formato do Claude (.claude-plugin/plugin.json, marketplace.json, skills/<nome>/SKILL.md, commands/, agents/) ou de uma coleção de prompts de estilo. Aceita repositório inteiro, subpasta (/tree/main/plugins/x) ou dono/repo.',
    inputSchema: obj({ url: str('URL do GitHub ou dono/repo') }, ['url']),
  },
  {
    name: 'filmforge_settings',
    description: 'Configurações atuais (chaves de API mascaradas): pastas, ffmpeg, provedores, ComfyUI, Wan2GP, idioma do app, plugins.',
    inputSchema: obj({}),
  },
];

/** Recursos (resources) que o agente pode ler direto. */
export function mcpResources(s: Settings): Array<{ uri: string; name: string; mimeType: string }> {
  const out = [
    { uri: 'filmforge://projects', name: 'Projetos', mimeType: 'application/json' },
    { uri: 'filmforge://library/skills', name: 'Skills', mimeType: 'application/json' },
    { uri: 'filmforge://library/routes', name: 'Rotas', mimeType: 'application/json' },
    { uri: 'filmforge://providers', name: 'Provedores', mimeType: 'application/json' },
  ];
  try {
    for (const p of fs.readdirSync(projectsDir(s))) {
      if (!fs.existsSync(path.join(projectsDir(s), p, 'project.json'))) continue;
      out.push({ uri: `filmforge://project/${p}`, name: `Projeto ${p}`, mimeType: 'application/json' });
      out.push({ uri: `filmforge://project/${p}/log`, name: `Log ${p}`, mimeType: 'text/plain' });
    }
  } catch { /* pasta ainda não existe */ }
  return out;
}

const maskKey = (k: string | undefined) => (k ? '••••' + k.slice(-4) : '');

const read = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return undefined; } };

/** Fila de execuções controlada pelo servidor (o agente dispara e acompanha). */
export function createMcpServer(deps: McpDeps) {
  const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const s = deps.getSettings();
    const need = (k: string): string => {
      const v = args[k];
      if (typeof v !== 'string' || !v.trim()) throw new Error(`argumento obrigatório: ${k}`);
      return v.trim();
    };
    const project = (k = 'projectId') => ops.readProject(s, need(k));
    switch (name) {
      case 'filmforge_projects': {
        const rows = await deps.listRows();
        const st = typeof args.status === 'string' && args.status ? args.status : '';
        const list = rows.filter((r) => !st || r['status'] === st).map((r) => ({
          id: r['id'], name: r['name'], status: r['status'], scenes: r['scenes'], scenesWithMedia: r['scenesWithMedia'],
          hasFinal: r['hasFinal'], skill: r['skillName'] ?? r['skillId'], route: r['routeName'], aspect: r['aspect'],
          durationSec: r['targetDurationSec'], updatedAt: r['updatedAt'], dir: r['dir'],
        }));
        return text(JSON.stringify(list, null, 1));
      }
      case 'filmforge_project': {
        const p = project();
        const dir = path.join(projectsDir(s), p.id);
        const files = (sub: string) => { try { return fs.readdirSync(path.join(dir, sub)).map((f) => `${sub}/${f}`); } catch { return []; } };
        return text(JSON.stringify({
          id: p.id, name: p.name, idea: p.idea, aspect: p.aspect, durationSec: p.targetDurationSec, language: p.language,
          quality: p.quality, routeId: p.routeId, routeName: p.route?.name, skillId: p.skillId, skillName: p.skill?.name,
          plugins: p.plugins ?? [], sceneConcurrency: p.sceneConcurrency, params: p.params,
          scenes: p.scenes.map((sc) => ({
            id: sc.id, index: sc.index, title: sc.title, narration: sc.narration, visualIntent: sc.visualIntent,
            kind: sc.kind, durationSec: sc.durationSec, status: sc.status, artifacts: Object.keys(sc.artifacts ?? {}),
          })),
          files: [...files('out'), ...files('audio'), ...files('edits')].slice(0, 60),
          log: (p.log ?? []).slice(-20),
        }, null, 1));
      }
      case 'filmforge_create_project': {
        const name = need('name'); const idea = need('idea');
        const skillId = typeof args.skillId === 'string' && args.skillId ? args.skillId : 'video-livre';
        const skill = lib.getSkill(s, skillId);
        if (!skill) throw new Error(`skill "${skillId}" não existe (use filmforge_skills)`);
        const routeId = typeof args.routeId === 'string' && args.routeId ? args.routeId : (skill.routeId ?? 'video-livre');
        const p = createProject(s, {
          name, idea, videoType: (skill.appearance ?? 'custom') as Project['videoType'], skillId, routeId,
          aspect: args.aspect as Project['aspect'] | undefined, targetDurationSec: typeof args.durationSec === 'number' ? args.durationSec : undefined,
          language: typeof args.language === 'string' ? args.language : undefined, quality: args.quality as Project['quality'] | undefined,
          musicStyle: typeof args.musicStyle === 'string' ? args.musicStyle : undefined,
          musicMode: args.musicMode === 'song' ? 'song' : args.musicMode === 'instrumental' ? 'instrumental' : undefined,
          waveform: typeof args.waveform === 'string' ? args.waveform as Project['waveform'] : undefined,
          plugins: Array.isArray(args.plugins) ? (args.plugins as string[]) : undefined,
          sceneConcurrency: typeof args.sceneConcurrency === 'number' ? args.sceneConcurrency : undefined,
          maxProductionMin: typeof args.maxProductionMin === 'number' ? args.maxProductionMin : undefined,
        });
        return text(`projeto criado: ${p.id}\n${JSON.stringify({ id: p.id, name: p.name, routeId: p.routeId, skillId: p.skillId, aspect: p.aspect, durationSec: p.targetDurationSec }, null, 1)}`);
      }
      case 'filmforge_run': {
        const id = need('projectId');
        const only = (Array.isArray(args.stepIds) || Array.isArray(args.sceneIds))
          ? { stepIds: args.stepIds as string[] | undefined, sceneIds: args.sceneIds as string[] | undefined } : undefined;
        const resume = args.resume === true;
        const r = await deps.runProject(id, only, resume);
        return text(r.ok ? `execução de ${id} iniciada (acompanhe com filmforge_status)` : `não foi possível executar: ${r.error ?? 'erro'}`, !r.ok);
      }
      case 'filmforge_cancel': {
        const id = need('projectId');
        const ok = deps.cancelProject(id);
        return text(ok ? `parada solicitada para ${id} (o que já foi gerado fica salvo)` : `${id} não está em execução`, !ok);
      }
      case 'filmforge_status': {
        const id = need('projectId');
        const p = project();
        const tail = typeof args.tail === 'number' ? Math.max(1, Math.min(500, args.tail)) : 20;
        const running = deps.running().includes(id);
        const row = (await deps.listRows()).find((r) => r['id'] === id) ?? {};
        return text(JSON.stringify({
          id, running, status: running ? 'running' : row['status'], progress: deps.progressOf(id) ?? null,
          scenes: row['scenes'], scenesWithMedia: row['scenesWithMedia'], hasFinal: row['hasFinal'],
          params: p.params ?? null, plugins: p.plugins ?? [],
          log: (p.log ?? []).slice(-tail),
        }, null, 1));
      }
      case 'filmforge_log': {
        const p = project();
        const tail = typeof args.tail === 'number' ? Math.max(1, Math.min(2000, args.tail)) : 80;
        return text((p.log ?? []).slice(-tail).join('\n') || '(sem log ainda)');
      }
      case 'filmforge_render_final': {
        const id = need('projectId');
        const r = await deps.renderFinal(id);
        return text(r.ok ? `vídeo final remontado em out/final.mp4 (${id})` : `falhou: ${r.error ?? 'erro'}`, !r.ok);
      }
      case 'filmforge_scene_update': {
        const id = need('projectId'); const sceneId = need('sceneId');
        const p = project();
        if (!p.scenes.some((x) => x.id === sceneId)) throw new Error(`cena "${sceneId}" não existe neste projeto`);
        const patch: Record<string, unknown> = {};
        for (const k of ['title', 'narration', 'subtitle', 'visualIntent', 'kind', 'notes'] as const) if (typeof args[k] === 'string') patch[k] = args[k];
        if (typeof args.durationSec === 'number') patch.durationSec = args.durationSec;
        const flags = ops.updateScene(p, sceneId, patch as never);
        ops.saveProjectFile(s, p);
        let run: { ok: boolean; error?: string } | undefined;
        if (args.regenerate === true) {
          const steps = ops.stepsFor(p.route, flags);
          if (steps.length) run = await deps.runProject(id, { sceneIds: [sceneId], stepIds: steps }, false);
        }
        return text(`cena ${sceneId} atualizada (${Object.keys(patch).join(', ') || 'nada'})${run ? ` · regeneração: ${run.ok ? 'iniciada' : run.error}` : ''}`);
      }
      case 'filmforge_skills': {
        const list = lib.listSkills(s).map((k) => ({ id: k.id, name: k.name, description: k.description, freeform: !!k.freeform, builtin: !!k.builtin, routeId: k.routeId, aspect: k.aspect, durationSec: k.durationSec }));
        return text(JSON.stringify(list, null, 1));
      }
      case 'filmforge_routes': {
        const want = typeof args.id === 'string' && args.id ? args.id : '';
        const list = lib.listRoutes(s).filter((r) => !want || r.id === want).map((r) => ({
          id: r.id, name: r.name, description: r.description, builtin: !!(r as { builtin?: boolean }).builtin,
          steps: r.steps.map((st) => ({ id: st.id, kind: st.kind, scope: st.scope, enabled: st.enabled, bindings: st.bindings.map((b) => b.type === 'harness' ? `harness:${b.harness}/${b.model ?? 'auto'}` : b.type) })),
        }));
        return text(JSON.stringify(list, null, 1));
      }
      case 'filmforge_providers': {
        const detect = args.detect !== false;
        const out: Record<string, unknown> = {};
        for (const [id, cfg] of Object.entries(s.harnesses)) {
          const d = detect ? await detectHarnessAsync(cfg).catch((e) => ({ installed: false, error: (e as Error).message })) : { installed: undefined };
          out[id] = {
            command: cfg.command, api: /^https?:\/\//i.test(cfg.command) ? (cfg.protocol ?? 'ollama') : 'cli',
            promptVia: cfg.promptVia, tools: cfg.tools !== false, defaultModel: cfg.defaultModel ?? null, models: cfg.models ?? [],
            installed: (d as { installed?: boolean }).installed, info: (d as { version?: string; error?: string }).version ?? (d as { error?: string }).error ?? null,
          };
        }
        return text(JSON.stringify(out, null, 1));
      }
      case 'filmforge_provider_models': {
        const id = need('id');
        const cfg = (s.harnesses as Record<string, typeof s.harnesses.claude>)[id];
        if (!cfg) throw new Error(`provedor "${id}" não existe (use filmforge_providers)`);
        const models = await listHarnessModels(cfg);
        return text(JSON.stringify({ id, models }, null, 1));
      }
      case 'filmforge_plugins': {
        const list = listPlugins(s);
        if (typeof args.id === 'string' && args.id) {
          const p = list.find((x) => x.id === args.id);
          if (!p) throw new Error(`plugin "${args.id}" não instalado`);
          return text(`plugin ${p.name}\n${JSON.stringify({ id: p.id, version: p.version, skills: p.skills, commands: p.commands, agents: p.agents, mcp: p.mcp, dir: p.dir }, null, 1)}\n\n--- prompt injetado ---\n${pluginPrompt(s, [p.id]).slice(0, 4000)}`);
        }
        return text(JSON.stringify(list.map((p) => ({ id: p.id, name: p.name, description: p.description, version: p.version, skills: p.skills, commands: p.commands, agents: p.agents })), null, 1));
      }
      case 'filmforge_plugin_install': {
        const p = await installPluginUrl(s, String(args.url ?? ''));
        return text(JSON.stringify({ id: p.id, name: p.name, displayName: p.displayName, version: p.version, author: p.author, skills: p.items?.filter((x) => x.kind === 'skill').map((x) => ({ name: x.name, description: x.description, files: x.files?.length ?? 0 })), commands: p.commands, agents: p.agents, gallery: p.gallery?.length ?? 0, examples: p.examples, requires: p.requires, also: p.also, dir: p.dir }, null, 1));
      }
      case 'filmforge_settings': {
        const safe: Record<string, unknown> = {
          workspace: s.workspace, projectsDir: projectsDir(s), ffmpeg: s.ffmpeg, ffprobe: s.ffprobe, uiLanguage: s.uiLanguage ?? 'pt-BR',
          sceneConcurrency: s.defaults?.sceneConcurrency ?? null, theme: s.theme ?? 'dark', memories: s.memories,
          comfyServers: s.comfyServers, wan2gp: s.wan2gp ? { root: s.wan2gp.root, python: s.wan2gp.python } : null,
          providers: (s.providers ?? []).map((p) => ({ id: p.id, kind: p.kind, baseUrl: p.baseUrl, apiKey: maskKey(p.apiKey), models: p.models, categories: p.categories })),
        };
        return text(JSON.stringify(safe, null, 1));
      }
      default:
        throw new Error(`ferramenta desconhecida: ${name}`);
    }
  }

  async function readResource(uri: string): Promise<string> {
    const s = deps.getSettings();
    const clean = uri.replace(/^filmforge:\/\//, '');
    if (clean === 'projects') return JSON.stringify(await deps.listRows(), null, 1);
    if (clean === 'library/skills') return JSON.stringify(lib.listSkills(s), null, 1);
    if (clean === 'library/routes') return JSON.stringify(lib.listRoutes(s), null, 1);
    if (clean === 'providers') return JSON.stringify(Object.fromEntries(Object.entries(s.harnesses).map(([id, c]) => [id, { command: c.command, models: c.models, defaultModel: c.defaultModel ?? null }])), null, 1);
    const m = clean.match(/^project\/([^/]+)(\/log)?$/);
    if (m) {
      const p = ops.readProject(s, m[1]!);
      if (m[2]) return (p.log ?? []).join('\n') || '(sem log ainda)';
      return JSON.stringify(p, null, 1);
    }
    throw new Error(`recurso desconhecido: ${uri}`);
  }

  /** Trata uma mensagem JSON-RPC. Devolve null quando é notificação (sem resposta). */
  async function handle(msg: unknown): Promise<unknown | null> {
    const m = msg as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
    const id = m?.id;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
    const isNote = id === undefined || id === null;
    try {
      switch (m?.method) {
        case 'initialize': {
          const want = typeof m.params?.['protocolVersion'] === 'string' ? (m.params['protocolVersion'] as string) : MCP_PROTOCOL_VERSION;
          return reply({
            protocolVersion: want,
            capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
            serverInfo: { name: 'filmforge', version: deps.version },
            instructions: 'FilmForge: estúdio de vídeo por IA. Use filmforge_projects/filmforge_create_project, dispare com filmforge_run e acompanhe com filmforge_status. Rotas, skills, provedores (harnesses/modelos) e plugins também estão expostos.',
          });
        }
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;
        case 'ping':
          return reply({});
        case 'tools/list':
          return reply({ tools: MCP_TOOLS });
        case 'tools/call': {
          const name = String(m.params?.['name'] ?? '');
          const args = (m.params?.['arguments'] ?? {}) as Record<string, unknown>;
          if (!name) return fail(-32602, 'nome da ferramenta ausente');
          return reply(await callTool(name, args));
        }
        case 'resources/list':
          return reply({ resources: mcpResources(deps.getSettings()) });
        case 'resources/read': {
          const uri = String(m.params?.['uri'] ?? '');
          if (!uri) return fail(-32602, 'uri ausente');
          const body = await readResource(uri);
          return reply({ contents: [{ uri, mimeType: uri.endsWith('/log') ? 'text/plain' : 'application/json', text: body }] });
        }
        case 'prompts/list':
          return reply({ prompts: [] });
        default:
          if (isNote) return null;
          return fail(-32601, `método não suportado: ${m?.method ?? '(vazio)'}`);
      }
    } catch (e) {
      const message = (e as Error).message;
      if (isNote) return null;
      return m?.method === 'tools/call' ? reply({ content: [{ type: 'text', text: `erro: ${message}` }], isError: true }) : fail(-32603, message);
    }
  }

  return { handle, callTool, readResource };
}

/** Servidor MCP por stdio (NDJSON). Nunca escreve nada além do protocolo em stdout. */
export function runMcpStdio(deps: McpDeps): void {
  const server = createMcpServer(deps);
  const log = deps.log ?? ((l: string) => { try { fs.writeSync(2, `[filmforge-mcp] ${l}\n`); } catch { process.stderr.write(`[filmforge-mcp] ${l}\n`); } });
  const write = (msg: unknown) => {
    const line = JSON.stringify(msg) + '\n';
    try { fs.writeSync(1, line); } catch { process.stdout.write(line); }
  };
  let buf = '';
  const feed = (chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      if (!line) continue;
      let msg: unknown;
      try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }); continue; }
      void server.handle(msg).then((r) => { if (r) write(r); }).catch((e) => log(`erro: ${(e as Error).message}`));
    }
  };

  /* O Electron (processo gráfico) costuma fechar o stream de stdin; nesse caso
     lemos o descritor 0 direto, que continua válido quando o cliente nos lança. */
  let fromStream = false;
  const readFd = () => {
    const size = 65536;
    const b = Buffer.alloc(size);
    const loop = () => {
      fs.read(0, b, 0, size, null, (err, n) => {
        if (err || n === 0) { log(err ? `fd 0: ${err.message}` : 'stdin encerrado; saindo'); setTimeout(() => process.exit(0), 50); return; }
        feed(b.subarray(0, n).toString('utf8'));
        loop();
      });
    };
    loop();
  };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => { fromStream = true; feed(c); });
    process.stdin.on('error', () => { /* sem stream: usa o fd */ });
    process.stdin.on('end', () => { if (fromStream) { log('stdin encerrado; saindo'); setTimeout(() => process.exit(0), 50); } else { log('stream de stdin fechado pelo Electron; lendo o descritor 0'); readFd(); } });
    process.stdin.resume();
  } catch { readFd(); }
  log('servidor MCP ativo (stdio) — aguardando o cliente');
}

/** Bloco pronto para colar na configuração do cliente MCP. */
export function mcpClientConfig(command: string, args: string[] = ['--mcp']): string {
  return JSON.stringify({ mcpServers: { filmforge: { command, args } } }, null, 2);
}

/** Configuração MCP padrão para clientes desktop que usam stdio (Claude, Cursor, VS Code, OpenCode...). */
export function mcpStdioConfig(command: string, args: string[] = ['--mcp']): Record<string, unknown> {
  return { mcpServers: { filmforge: { command, args } } };
}

/** Configuração MCP padrão para clientes remotos/HTTP (ChatGPT, Claude remote, etc.). */
export function mcpHttpConfig(url: string, token?: string): Record<string, unknown> {
  const server: Record<string, unknown> = { url, transport: 'streamable-http' };
  if (token) server.headers = { Authorization: `Bearer ${token}` };
  return { mcpServers: { filmforge: server } };
}

/** Bloco com os formatos mais usados (stdio, VS Code e HTTP remoto). */
export function mcpSetupConfigs(command: string, httpUrl: string, token?: string): Record<string, unknown> {
  return {
    stdio: mcpStdioConfig(command),
    vscode: { servers: { filmforge: { type: 'stdio', command, args: ['--mcp'] } } },
    http: mcpHttpConfig(httpUrl, token),
  };
}

export interface McpHttpOptions {
  host?: string;
  port?: number;
  path?: string;
  token?: string;
}

export interface McpHttpHandle {
  url: string;
  host: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Servidor MCP por **Streamable HTTP** (+ SSE legado) para ChatGPT, Claude remoto,
 * Cursor, VS Code e qualquer cliente MCP que aceite URL. O endpoint principal é
 * POST /mcp; GET /mcp mantém um stream SSE de keepalive; GET /sse + POST /messages
 * atendem o transporte SSE antigo.
 */
export function runMcpHttp(deps: McpDeps, opts: McpHttpOptions = {}): Promise<McpHttpHandle> {
  const server = createMcpServer(deps);
  const host = opts.host?.trim() || '127.0.0.1';
  const port = Math.max(0, Math.min(65535, Math.round(Number(opts.port ?? 3333) || 3333)));
  const mount = (opts.path?.trim() || '/mcp').startsWith('/') ? (opts.path?.trim() || '/mcp') : '/' + opts.path;
  const token = opts.token?.trim() || '';
  const log = deps.log ?? ((l: string) => { try { process.stderr.write(`[filmforge-mcp-http] ${l}\n`); } catch { /* ignore */ } });
  const sseClients = new Map<string, http.ServerResponse>();
  const sessions = new Set<string>();
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  };
  const send = (res: http.ServerResponse, code: number, body?: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(code, { ...cors, ...headers });
    if (body === undefined) res.end();
    else res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const authorized = (req: http.IncomingMessage) => {
    if (!token) return true;
    const h = String(req.headers.authorization ?? '');
    return h === `Bearer ${token}`;
  };
  const readBody = (req: http.IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 8 * 1024 * 1024) reject(new Error('body muito grande')); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
  const json = (req: http.IncomingMessage): Promise<unknown> => readBody(req).then((b) => b.trim() ? JSON.parse(b) : null);
  const handleOne = async (msg: unknown): Promise<unknown | null> => server.handle(msg);
  const handleBody = async (body: unknown): Promise<unknown | null> => {
    if (Array.isArray(body)) {
      const out: unknown[] = [];
      for (const m of body) { const r = await handleOne(m); if (r) out.push(r); }
      return out.length ? out : null;
    }
    return handleOne(body);
  };
  const sessionFor = (req: http.IncomingMessage, create = false) => {
    const id = String(req.headers['mcp-session-id'] ?? '') || (create ? randomUUID() : '');
    if (id && create) sessions.add(id);
    return id;
  };
  const httpServer = http.createServer(async (req, res) => {
    try {
      if (!authorized(req)) { send(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' }); return; }
      if (req.method === 'OPTIONS') { send(res, 204); return; }
      const u = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
      if (u.pathname === '/health') {
        send(res, 200, { ok: true, name: 'filmforge', protocol: MCP_PROTOCOL_VERSION, tools: MCP_TOOLS.length, endpoint: mount });
        return;
      }
      if (u.pathname === '/sse' && req.method === 'GET') {
        const id = randomUUID();
        sessions.add(id);
        res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'Mcp-Session-Id': id });
        res.write(`event: endpoint\ndata: /messages?sessionId=${encodeURIComponent(id)}\n\n`);
        sseClients.set(id, res);
        const timer = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 20_000);
        req.on('close', () => { clearInterval(timer); sseClients.delete(id); sessions.delete(id); });
        return;
      }
      if (u.pathname === '/messages' && req.method === 'POST') {
        const id = u.searchParams.get('sessionId') ?? '';
        const sse = sseClients.get(id);
        if (!sse) { send(res, 404, { error: 'sessão SSE não encontrada' }); return; }
        const body = await json(req);
        const reply = await handleBody(body);
        if (reply) { try { sse.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`); } catch { /* ignore */ } }
        send(res, 202, 'accepted', { 'Content-Type': 'text/plain' });
        return;
      }
      if ((u.pathname === mount || u.pathname === '/mcp') && req.method === 'POST') {
        const body = await json(req);
        if (!body) { send(res, 400, { error: 'JSON-RPC vazio' }); return; }
        const first = Array.isArray(body) ? body[0] : body;
        const isInit = first && typeof first === 'object' && (first as { method?: string }).method === 'initialize';
        const sid = sessionFor(req, isInit) || randomUUID();
        const reply = await handleBody(body);
        const headers: Record<string, string> = { 'Mcp-Session-Id': sid, 'Content-Type': 'application/json; charset=utf-8' };
        if (reply === null) send(res, 202, undefined, headers);
        else send(res, 200, reply, headers);
        return;
      }
      if ((u.pathname === mount || u.pathname === '/mcp') && req.method === 'GET') {
        const sid = sessionFor(req, true) || randomUUID();
        res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'Mcp-Session-Id': sid });
        res.write('event: ready\ndata: {"name":"filmforge"}\n\n');
        const timer = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 20_000);
        req.on('close', () => { clearInterval(timer); sessions.delete(sid); });
        return;
      }
      if ((u.pathname === mount || u.pathname === '/mcp') && req.method === 'DELETE') {
        const sid = String(req.headers['mcp-session-id'] ?? '');
        if (sid) sessions.delete(sid);
        send(res, 204);
        return;
      }
      send(res, 404, { error: 'not found', endpoint: mount, health: '/health' });
    } catch (e) {
      log(`erro: ${(e as Error).message}`);
      try { send(res, 500, { error: (e as Error).message }); } catch { /* ignore */ }
    }
  });
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      const addr = httpServer.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      const publicHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
      const url = `http://${publicHost}:${actual}${mount}`;
      log(`servidor MCP HTTP ativo em ${url}${token ? ' (Bearer token)' : ''}`);
      resolve({
        url, host, port: actual,
        close: () => new Promise<void>((done) => { for (const c of sseClients.values()) { try { c.end(); } catch { /* ignore */ } } sseClients.clear(); httpServer.close(() => done()); }),
      });
    });
  });
}