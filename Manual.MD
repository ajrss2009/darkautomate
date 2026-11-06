# Manual do FilmForge

**Versão:** 0.1.0  
**Atualizado em:** 23/10/2026

FilmForge é um estúdio de vídeo por IA orientado a cenas. O app cria projetos, executa rotas com etapas de roteiro, narração, imagem, vídeo, código, banco de mídia, música, edição e revisão, e também funciona como **servidor MCP** para ChatGPT, Claude, Cursor, VS Code, OpenCode, LM Studio e outros clientes.

---

## 1. Instalação e primeiro uso

### Versão instalada

- Instalador: `release/FilmForge Setup 0.1.0.exe`
- Portátil: `release/FilmForge 0.1.0.exe`
- App desempacotado: `release/win-unpacked/FilmForge.exe`

O usuário final não precisa de Node.js. O instalador/portátil já contém o Electron e o código do app.

### Primeira execução

1. Abra o FilmForge.
2. Em **Configurações**, confira:
   - **Workspace**: pasta de trabalho do app.
   - **Pasta de projetos**: onde ficam os projetos (`projects/`).
   - **ffmpeg/ffprobe**: caminho do executável ou `ffmpeg` se estiver no PATH.
   - **ComfyUI local**: normalmente `http://127.0.0.1:8188`.
   - **Harnesses**: Claude, Codex, Antigravity (`agy`), Ollama, OpenCode etc.
   - **Bancos de mídia**: Pexels, Pixabay, Wikimedia e YouTube.
   - **Vozes**: arquivos de referência em `voices/`.
3. Salve as configurações.

### Serviços locais usados

- **ComfyUI** em `127.0.0.1:8188`: imagens (Krea 2/Z-Image), vídeo (MiniMax H3), TTS (OmniVoice), música (Yue 2).
- **Ollama** em `127.0.0.1:11434`: modelos locais de texto/código.
- **Antigravity (`agy`)**: roteiro, planejamento, cenas de código, revisão.
- **yt-dlp**: clips do YouTube. O app usa o `tools/yt-dlp.exe` do workspace.

---

## 2. Conceitos principais

### Skill

Uma skill é o “tipo de vídeo” ou a receita editorial. Ela define aparência, rota sugerida, formato, duração, instruções por etapa e fontes de mídia.

Exemplos:

- `stickman`, `realistic`, `anime_2d`, `pixel_art`, `paper_cut`, `code_3d`.
- `explicativo-codigo`, `shorts-viral`, `documentario`.
- `clipe-musical-loop`, `clipe-musical-loop-codigo`.
- `coletanea-lo-fi-codigo`.

### Rota

A rota é o pipeline executável: lista de etapas, dependências, escopos e executores.

Exemplos comuns:

- `stickman-explainer`: cenas de código.
- `explainer-mixed`: código + bancos de mídia.
- `shorts-autopilot`: imagem → vídeo.
- `realistic-cinematic`: imagem → vídeo MiniMax.
- `clipe-musical-loop`: imagem → loop MiniMax H3 → Yue 2.
- `clipe-musical-loop-codigo`: cena de código → Yue 2.
- `gta6-quality`: código + imagem + vídeo generativo + gameplay GTA VI + OmniVoice + revisão.

### Cena

Cada cena tem:

- título;
- narração;
- intenção visual;
- tipo (`image`, `video`, `code`, `motion`, `mixed`, `stock`);
- duração;
- câmera;
- termos de busca;
- prompt de vídeo;
- efeitos;
- status e artefatos.

### Etapas

- `script`: roteiro.
- `scene_plan`: divide em cenas.
- `narration`: gera voz com OmniVoice.
- `transcribe`: transcreve/estima palavras.
- `stock`: baixa mídia de banco (YouTube/Pexels/Pixabay).
- `image`: gera imagem (Krea 2/Z-Image).
- `video`: gera vídeo (MiniMax H3).
- `code_scene`: desenha HTML/Canvas/WebGL.
- `subtitles`: gera SRT.
- `music`: escolhe trilha da biblioteca.
- `edit`: monta segmentos, mixa trilha, queima legendas e masteriza.
- `review`: agente revisor dá nota.
- `metadata`/`thumbnail`: SEO e capa.

### Harness

Harness é o provedor de IA (CLI ou HTTP) usado em uma etapa: Antigravity, Ollama, Claude, Codex etc. O nome do projeto deve registrar a skill e o harness usado.

---

## 3. Criar um projeto

1. Clique em **Novo projeto**.
2. Escolha a **skill**.
3. Escolha a **rota** (o app sugere a padrão da skill).
4. Defina:
   - nome do projeto;
   - ideia/prompt;
   - formato (`16:9`, `9:16`, `1:1`, `4:5`);
   - duração alvo;
   - idioma;
   - qualidade (`standard`, `depth`, `polished`, `verified`, `ultra`);
   - concorrência de cenas;
   - tempo máximo de produção.
5. Se for música:
   - estilo musical;
   - modo (`instrumental` ou `song`);
   - waveform (`line`, `p2p`, `cline`, `dot`).
6. Clique em **Criar**.
7. Use **Executar** para rodar a rota.

### Nome recomendado

Inclua a skill e o harness no nome:

```text
GTA VI — Realista / cinematográfico — Skill: realistic — Harness: Antigravity + OmniVoice
```

Isso facilita auditoria, comparação e relatórios.

---

## 4. Executar e acompanhar

- **Executar** inicia a rota.
- **Retomar** usa o cache e evita refazer etapas concluídas.
- **Executar sem cache** refaz as etapas selecionadas.
- **Cancelar** para a execução; o que já foi gerado fica salvo.
- **Status** mostra progresso, ETA, cenas com mídia e últimas linhas do log.
- **Log** mostra o histórico detalhado.
- **Renderizar final** remonta o `out/final.mp4` a partir das cenas existentes.

### Cache

O cache fica em `projects/<id>/cache/index.json`. Se uma etapa já produziu um arquivo válido, ela pode ser pulada. Use **sem cache** quando mudar prompt, cena, duração ou quiser variar o resultado.

---

## 5. Editar cenas e evoluir o projeto

No editor de cenas você pode:

- alterar título, narração, legenda, intenção visual, duração e tipo;
- pedir regeneração da mídia;
- trocar cena de `image` para `video`, `code`, `stock` etc.;
- ajustar câmera e efeitos;
- duplicar/remover cenas;
- usar o revisor para identificar problemas.

### Regenerar uma cena

1. Abra a cena.
2. Ajuste a narração/visual/notas.
3. Clique em **Regenerar**.
4. O app executa apenas as etapas de mídia daquela cena.

### Corrigir duração

Se um vídeo ficar com menos de 3 minutos:

1. Veja `out/review.json` e o log.
2. Aumente a duração de uma cena ou adicione uma cena.
3. Rode `edit` novamente.
4. Confira com `ffprobe`:

```powershell
ffprobe -v error -show_entries format=duration -of csv=p=0 out\final.mp4
```

---

## 6. Mídia: código, imagens, vídeo e bancos

### Código (`code_scene`)

O harness escreve um HTML autocontido com Canvas 2D, SVG ou WebGL puro. O renderizador chama `window.__forge.seek(t)` para cada quadro, em 30 fps. A cena deve ser determinística:

```js
window.__forge = {
  duration: 12,
  fps: 30,
  seek(t) { /* desenha o quadro em t */ },
  pause() { /* cancela requestAnimationFrame */ }
};
```

### Imagem (`image`)

Workflows: Krea 2 Turbo, Z-Image Turbo, Wan2GP, API OpenAI.

### Vídeo generativo (`video`)

MiniMax H3, incluindo o workflow de loop perfeito (primeiro frame = último frame).

### Bancos (`stock`)

- YouTube: o app baixa um trecho, recorta bordas e pode validar o frame.
- Pexels/Pixabay: exigem chave de API em Configurações.
- Wikimedia: imagens.

### GTA VI

A rota `gta6-quality` usa uma lista curada de gameplays/trailers reais de GTA VI:

- evita mods de GTA V, “concept trailers”, “Los Santos” e comparativos falsos;
- usa uma semente por projeto/cena para variar os trechos entre sessões;
- mistura **código + imagem + vídeo generativo + gameplay real** em cada vídeo.

---

## 7. Música e coletâneas

### Clipe musical em loop

Rotas:

- `clipe-musical-loop`: imagem → vídeo MiniMax H3 em loop → Yue 2.
- `clipe-musical-loop-codigo`: cena de código → Yue 2.
- `clipe-musical-code-ag`: código com Antigravity.
- `clipe-musical-code-ol`: código com Ollama.
- `clipe-musical-code-ol-8bit`: variante 8-bit.
- `clipe-musical-code-ol-anime`: template anime forçado.

### Instrumental

Para música instrumental, o app usa:

```text
workflows/yue2-instrumental.json
```

com o LoRA `ar_lora_inst_v3abc_comfyui.safetensors` e letra:

```text
[instrumental]
```

O workflow `yue2-text2music.json` é usado para canções com letra.

### Duração de compilado

O `clip-musical` aceita:

- 2 a 15 faixas;
- 120 a 360 s no total (2 a 6 min);
- cada faixa com `seconds` próprio;
- faixas antigas de 12 s são promovidas para a duração mínima;
- `maxTotalSeconds` e `minTotalSeconds`;
- `targetTotalSeconds`;
- `trackSeconds`.

### Um loop por faixa ou loop único

No parâmetro `edit` da rota:

```json
{
  "perTrackLoop": true
}
```

- `true`: uma cena/loop visual por música.
- `false`: o mesmo loop visual para a coletânea inteira.

### Parâmetros úteis

```json
{
  "tracks": 10,
  "trackSeconds": 36,
  "targetTotalSeconds": 360,
  "maxTotalSeconds": 360,
  "minTotalSeconds": 120,
  "loopSeconds": 12,
  "perTrackLoop": false,
  "template": "16bit",
  "forceTemplate": false,
  "perfectLoop": true
}
```

### Exemplos atuais

- `projects/colet-nea-lo-fi-instrumental-10--ba8f46/out/final.mp4` — Antigravity, 10 loops, 360 s.
- `projects/colet-nea-lo-fi-instrumental-10--d51044/out/final.mp4` — Ollama, loop único, 360 s.

---

## 8. GTA VI — qualidade YouTube

Rota: `gta6-quality`.

Estrutura típica de 5 cenas:

1. `code` — abertura/título animado (12–14 s).
2. `image` — cena cinematográfica (Ken Burns).
3. `video` — MiniMax H3 generativo.
4. `stock` — gameplay real de GTA VI.
5. `image` — imersão/mundo.

Cada vídeo:

- 180–300 s (3–5 min);
- 1920×1080 ou 1080×1920;
- narração OmniVoice com voz de referência;
- trilha em **15% do volume normal**;
- masterização **-14 LUFS / 48 kHz**;
- legendas queimadas;
- revisão com nota.

### Voz

A rota usa:

```text
C:/Users/ajrss/OneDrive/Documentos/FilmForge/voices/voz-antonio-enhanced.wav
```

Para trocar a voz, altere o `refAudio` da etapa `narration` na rota ou copie outra referência para `voices/`.

### Trilha

A trilha é escolhida da pasta:

```text
library/music/
```

A etapa `music` aceita `params.file` para escolher um arquivo específico. O volume padrão é `0.15` (15%).

### Relatório

- `projects/RELATORIO-GTA6-QUALITY.md`
- `gta6-quality-report.json`
- `gta6-music-report.json`

---

## 9. Revisor e notas

Agente:

```text
library/agents/revisor-youtube.json
```

A etapa `review` grava `out/review.json`:

```json
{
  "score": 8.5,
  "criteria": {
    "duracao": 9,
    "imagem": 9,
    "audio": 8,
    "narrativa": 8,
    "edicao": 8,
    "qualidade_youtube": 8
  },
  "issues": ["..."],
  "fixes": ["..."]
}
```

Critérios: duração 180–300 s, resolução, narração, música abaixo da voz, legendas, variedade visual, áudio sem clipping, gancho inicial e coerência com GTA VI.

Para melhorar a nota:

1. Leia `issues`/`fixes`.
2. Ajuste cenas, duração, narração ou mixagem.
3. Regenere/edite e rode `review` novamente.

---

## 10. MCP

O FilmForge é um servidor MCP padrão em dois transportes.

### 10.1 stdio — Claude Desktop, Claude Code, Cursor, VS Code, OpenCode, LM Studio

Comando:

```powershell
FilmForge.exe --mcp
```

Configuração:

```json
{
  "mcpServers": {
    "filmforge": {
      "command": "C:\\CAMINHO\\FilmForge.exe",
      "args": ["--mcp"]
    }
  }
}
```

No app: **Configurações → MCP → Copiar configuração**.

Formatos por cliente:

- Claude Desktop: `claude_desktop_config.json`.
- Cursor: `.cursor/mcp.json` ou configuração global.
- VS Code: `.vscode/mcp.json` com `servers`.
- OpenCode: configuração de MCP do cliente.
- LM Studio: configuração de servidor MCP externo.

Exemplo VS Code:

```json
{
  "servers": {
    "filmforge": {
      "type": "stdio",
      "command": "C:\\CAMINHO\\FilmForge.exe",
      "args": ["--mcp"]
    }
  }
}
```

### 10.2 HTTP/SSE — ChatGPT e clientes remotos

Comando:

```powershell
FilmForge.exe --mcp-http 3333 --mcp-host 127.0.0.1
```

- Endpoint MCP: `http://127.0.0.1:3333/mcp`
- Health: `http://127.0.0.1:3333/health`
- SSE antigo: `http://127.0.0.1:3333/sse`
- POST de mensagens SSE: `/messages?sessionId=...`
- Sessão: `Mcp-Session-Id`
- CORS habilitado
- Token opcional:

```powershell
FilmForge.exe --mcp-http 3333 --mcp-token MEU_TOKEN
```

Configuração:

```json
{
  "mcpServers": {
    "filmforge": {
      "url": "http://127.0.0.1:3333/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Também é possível iniciar/parar pela interface: **Configurações → MCP → Iniciar HTTP**.

### 10.3 Erro comum no ChatGPT: URL 127.0.0.1

Se o ChatGPT mostrar **“Algumas configurações do aplicativo foram rejeitadas. Verifique a URL do servidor...”**, quase sempre é porque foi usada uma URL local:

```text
http://127.0.0.1:3333/mcp   ❌ ChatGPT na nuvem não alcança
```

O ChatGPT custom connector exige uma URL **HTTPS pública**. Use um túnel:

```powershell
# terminal 1
FilmForge.exe --mcp-http 3333 --mcp-host 127.0.0.1

# terminal 2
cloudflared tunnel --url http://127.0.0.1:3333
```

O cloudflared imprime algo como:

```text
https://alguma-coisa-aleatoria.trycloudflare.com
```

No ChatGPT, use:

```text
https://alguma-coisa-aleatoria.trycloudflare.com/mcp
```

#### Exemplo real de conexão (23/10/2026)

O erro do print foi causado por esta URL local:

```text
http://127.0.0.1:3333/mcp   ❌ rejeitada pelo ChatGPT
```

Substituindo pelo túnel HTTPS, o endpoint usado foi:

```text
https://fifty-patents-collective-begun.trycloudflare.com/mcp
```

Configuração no diálogo **Adicionar servidor MCP personalizado**:

- **Conexão:** URL do servidor
- **URL do servidor:** `https://fifty-patents-collective-begun.trycloudflare.com/mcp`
- **Autenticação:** Sem autenticação
- **Ícone:** opcional (PNG 256×256 ou maior, até 10 KB)
- **Aviso:** marcar “Entendo e quero continuar”
- Clicar em **Criar como plugin**

O endpoint público respondeu `HTTP 200` no `initialize`, com:

```json
{"serverInfo":{"name":"filmforge","version":"0.1.0"}}
```

Isso confirma que o servidor MCP estava correto; o problema era somente a URL local.

> **Atenção:** esse Quick Tunnel é temporário. Ele deixa de funcionar quando o app/terminal é encerrado. Gere uma nova URL com `scripts\mcp-tunnel.ps1` ou use um Named Tunnel com domínio próprio.
>
> **Segurança:** sem token, qualquer pessoa com a URL pública pode criar e executar projetos no FilmForge. Use `--mcp-token`/`FILMFORGE_MCP_TOKEN` em túneis públicos e encerre o túnel após o teste.
Atalho no repositório:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mcp-tunnel.ps1
```

O script sobe o app, abre o túnel e imprime a URL `/mcp` pronta para colar no ChatGPT. A URL do Quick Tunnel é temporária e só funciona enquanto o script/terminal estiver aberto.

Para uso permanente, crie um **Cloudflare Named Tunnel** com domínio próprio ou publique o servidor em um host HTTPS estável. Para submissão pública de plugin, não use túnel temporário nem localhost.

Se a URL pública abrir, mas o ChatGPT ainda rejeitar:

- confirme que a URL termina em `/mcp` e não em `/health`;
- use `https://`, nunca `http://`;
- confirme que o túnel aponta para `http://127.0.0.1:3333`;
- se configurou token, use `Authorization: Bearer SEU_TOKEN`;
- reinicie o túnel e tente novamente.

### 10.4 ChatGPT na nuvem

O ChatGPT não acessa `127.0.0.1`. Use um túnel HTTPS:

```powershell
cloudflared tunnel --url http://127.0.0.1:3333
```

ou equivalente com ngrok. No ChatGPT:

1. Ative o modo de desenvolvedor/conectores MCP.
2. Adicione um conector com a URL pública terminando em `/mcp`.
3. Se usar token, configure o header `Authorization: Bearer MEU_TOKEN`.

### 10.5 Variáveis de ambiente

- `FILMFORGE_MCP_PORT` — porta HTTP (padrão 3333).
- `FILMFORGE_MCP_HOST` — host (padrão 127.0.0.1).
- `FILMFORGE_MCP_TOKEN` — token Bearer opcional.

### 10.6 Teste rápido

```powershell
$body = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"teste","version":"1"}}}'
Invoke-RestMethod "http://127.0.0.1:3333/mcp" -Method Post -ContentType "application/json" -Body $body
```

Resposta esperada: `serverInfo.name = filmforge`.

### 10.7 Ferramentas expostas

| Ferramenta | Uso |
|---|---|
| `filmforge_projects` | Lista projetos. |
| `filmforge_project` | Detalha projeto/cenas. |
| `filmforge_create_project` | Cria projeto. |
| `filmforge_run` | Executa rota (assíncrono). |
| `filmforge_cancel` | Cancela execução. |
| `filmforge_status` | Progresso, ETA e log. |
| `filmforge_log` | Log completo. |
| `filmforge_render_final` | Remonta o final. |
| `filmforge_scene_update` | Edita cena e opcionalmente regenera. |
| `filmforge_skills` | Lista skills. |
| `filmforge_routes` | Lista rotas. |
| `filmforge_providers` | Provedores/harnesses. |
| `filmforge_provider_models` | Modelos do provedor. |
| `filmforge_plugins` | Plugins. |
| `filmforge_settings` | Configurações mascaradas. |

Recursos:

```text
filmforge://projects
filmforge://project/{id}
filmforge://project/{id}/log
filmforge://library/skills
filmforge://library/routes
filmforge://providers
```

### 10.8 Exemplo de criação via MCP

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "tools/call",
  "params": {
    "name": "filmforge_create_project",
    "arguments": {
      "name": "GTA VI — Teste — Skill: realistic — Harness: Antigravity",
      "idea": "Vídeo de 3 a 5 minutos sobre GTA VI.",
      "skillId": "realistic",
      "routeId": "gta6-quality",
      "aspect": "16:9",
      "durationSec": 194,
      "language": "pt-BR"
    }
  }
}
```

Depois:

```json
{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"filmforge_run","arguments":{"projectId":"SEU_ID"}}}
```

Acompanhe com `filmforge_status` e finalize com `filmforge_render_final`.

### 10.9 Segurança

- O servidor HTTP escuta **loopback** por padrão.
- Não exponha `0.0.0.0` sem token e sem túnel confiável.
- Use `--mcp-token`/`FILMFORGE_MCP_TOKEN` em túneis públicos.
- O MCP pode criar e executar projetos, consumindo GPU e créditos. Confirme antes de executar em lote.

---

## 11. CLI

### Rodar um projeto

```powershell
FilmForge.exe --run-project ID
```

### Rodar etapas específicas

```powershell
FilmForge.exe --run-project ID --steps script,scene_plan
```

### Sem cache

```powershell
FilmForge.exe --run-project ID --steps edit --no-cache
```

### Validar biblioteca

```powershell
FilmForge.exe --validate
```

### Instalar Whisper

```powershell
FilmForge.exe --install-whisper
```

### Servidor MCP

```powershell
FilmForge.exe --mcp
FilmForge.exe --mcp-http 3333 --mcp-host 127.0.0.1
```

---

## 12. Pastas e backup

```text
FilmForge/
  workflows/            workflows ComfyUI (API + map.json)
  tools/                yt-dlp e utilitários
  voices/               vozes de referência
  library/
    routes/             rotas do usuário
    skills/             skills do usuário
    agents/             agentes do usuário
    types/              tipos de vídeo
    music/              trilhas
  projects/
    <id>/
      project.json
      scenes.json
      script.md
      scenes/s01/
        audio/narration.mp3
        frames/frame.png
        clips/code.mp4
        clips/clip.mp4
        stock/
      out/final.mp4
      out/subtitles.srt
      out/review.json
```

Configurações do app:

```text
%APPDATA%\filmforge\settings.json
```

Backup: copie `projects/`, `library/`, `voices/`, `workflows/` e `settings.json`.

---

## 13. Solução de problemas

### ComfyUI offline

- Verifique `http://127.0.0.1:8188/system_stats`.
- Inicie o ComfyUI.
- Confira o servidor `local` em Configurações.

### Yue 2 instrumental falha

- Confira o workflow `workflows/yue2-instrumental.json`.
- Confira o LoRA `ar_lora_inst_v3abc_comfyui.safetensors` na pasta de LoRAs do ComfyUI.
- A letra precisa ser `[instrumental]`.

### OmniVoice sem voz

- Confira `voices/voz-antonio-enhanced.wav`.
- Confira o `refAudio` na etapa `narration`.
- Teste o workflow `omnivoice-clone-tts.json` no ComfyUI.

### ffmpeg não encontrado

- Coloque o `ffmpeg` no PATH ou informe o caminho em Configurações.
- Caminhos conhecidos: `C:\ffmpeg\bin\ffmpeg.exe`, `E:\DOWNLOAD\ffmpeg\bin\ffmpeg.exe`.

### YouTube não baixa

- Alguns vídeos são restritos por idade. A lista curada evita esses casos.
- Atualize o `tools/yt-dlp.exe`.
- Verifique a rede/proxy.

### Vídeo com menos de 3 minutos

- Aumente a duração das cenas ou adicione uma cena.
- Rode `edit --no-cache`.
- Verifique `review.json`.

### Áudio com 96 kHz ou trilha alta

- Rode `edit --no-cache` em uma versão atual; o app masteriza em 48 kHz e usa `musicVolume: 0.15`.
- Para ajustar, mude `musicVolume` na etapa `edit`.

### Porta 3333 ocupada

- Use outra porta:

```powershell
FilmForge.exe --mcp-http 3334
```

### ChatGPT não conecta

- Use URL pública HTTPS, não `127.0.0.1`.
- Confirme que o túnel aponta para `http://127.0.0.1:3333`.
- O endpoint deve terminar em `/mcp`.
- Se houver token, configure `Authorization: Bearer ...`.

### MCP sem ferramentas

- O cliente deve enviar `initialize`, depois `tools/list`.
- Em HTTP, mantenha o `Mcp-Session-Id` retornado no initialize.

---

## 14. Receitas rápidas

### Criar uma coletânea lo-fi de 6 min

1. Skill: **Coletânea lo-fi em loop com código**.
2. Rota: `clipe-musical-code-ag` (Antigravity) ou `clipe-musical-code-ol` (Ollama).
3. Duração: 360 s.
4. Estilo: lo-fi instrumental.
5. `perTrackLoop: true` para um loop por faixa; `false` para loop único.
6. Execute `code_scene,edit`.

### Criar um vídeo GTA VI de 3–5 min

1. Skill de vídeo desejada.
2. Rota: `gta6-quality`.
3. Duração: 194 s.
4. Execute a rota completa.
5. Leia `out/review.json`; se a nota for baixa, ajuste e regenere.

### Criar um clipe musical GTA VI de 3 min

1. Skill de clipe (`clipe-musical-loop`, `clipe-musical-loop-codigo` etc.).
2. Rota correspondente.
3. 3 faixas de 60 s, `[instrumental]`.
4. `musicVolume` não se aplica (o clipe é a própria música).
5. Rode `image,video,edit,review` ou `code_scene,edit,review`.

---

## 15. Build e desenvolvimento

```powershell
# typecheck
npx tsc --noEmit

# build
node scripts/build.mjs

# app em dev
npx electron .

# pacote
npx electron-builder --win nsis portable
```

Observações:

- `ELECTRON_NO_ASAR=1` pode ser necessário no electron-builder.
- O ambiente sem Node no PATH pode usar `ELECTRON_RUN_AS_NODE=1` com o Electron do projeto.
- `ELECTRON_NO_ASAR=1` não é necessário para o usuário final.

---

## 16. Links úteis

- Relatório GTA VI: `projects/RELATORIO-GTA6-QUALITY.md`
- Dados: `gta6-quality-report.json`, `gta6-music-report.json`
- Especificação: `SPEC.md`
- Visão geral: `README.md`
- Workflows: `workflows/`
- Biblioteca: `library/`
