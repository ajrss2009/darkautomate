# Relatório — 14/11/2026: tempo de geração, skills UGC e Música com Lipsync

## 1. Pastas de release
- O pedido era "criar dark23 copiando de dark24", mas a **dark23 já existia** e a **dark24 não**. Para não sobrescrever nada, fiz o inverso: criei `release-2026-11-14-dark24` como clone git da `release-2026-11-13-dark23` (commit 044b6a4). A dark23 ficou intacta.
- Não gerei pacote/instalador novo (não foi pedido).

## 2. Por que os 3 últimos projetos estavam sem tempo de geração
- **Causa:** o cronômetro grava o tempo no `project.json` (`production.totalMs` e `runs`). Mas o índice do banco só regravava a linha quando o *hash* do projeto mudava, e esse hash **não incluía** o cronômetro. O app via o arquivo mais novo, recalculava o mesmo hash e só atualizava a data. Por isso `total_ms` ficava 0.
- **Correção (commit b840349):**
  - o hash agora inclui `totalMs`, o número de execuções, o fim da última execução, o vídeo final e as cenas com mídia;
  - o esquema subiu para **v3**, cuja migração força a reindexação de todos os projetos uma vez.
- **Verificado numa cópia do banco** com o código real (`ForgeDb.open` + `syncIndex`):
  - 287 projetos atualizados e 3 novos adicionados (os de teste);
  - os 3 "flagrei…" (be42ec, 8039b4, 5cbe50) passaram de 0 para **17,7 min, 6,1 min e 17,5 min**;
  - os projetos de teste também entraram com tempo: UGC v1 73,6 min e Música 43,5 min.
- O banco real se atualiza sozinho na próxima vez que você abrir o FilmForge (o modo headless não abre o banco, de propósito, para não haver duas instâncias gravando).

## 3. Skills novas (modo padrão, na lista "especiais")
### UGC de produto (`ugc-produto`)
- **Papel:** especialista em marketing de performance. Estrutura obrigatória: GANCHO (até 3 s) → DOR → DEMO → PROVA → CTA.
- **Formato:** 9:16, 30–40 s.
- **Criador:** personagem da biblioteca, com o mesmo rosto e a mesma voz em todas as cenas.
- **Produto:** vem das fotos de referência anexadas. Nas cenas de produto, a foto vira o quadro, e assim o produto sai idêntico.
- **Rota de vídeo:**
  1. MiniMax H3 Ref2VA no Wan2GP (LoRA *Lightx2v Ref2V 4 passos*), recebendo o retrato do criador e a foto do produto;
  2. Snapgen **Muse AI**;
  3. Snapgen MiniMax H3;
  4. os demais vídeos IA.
- **Narração:** com a voz do criador.

### Música com lipsync (`musica-lipsync`)
- **Canção:** gerada no **ACE-Step 1.5 XL** (Wan2GP), com o tempo de cada palavra medido pelo Whisper (`lyrics-timing.json`).
- **Cenas:** uma por verso, com duração tirada da canção.
- **Lipsync:** cada cena com o cantor vai para o **MiniMax H3 Ref2VA + LoRA de 4 passos** (`steps 4`, `guidance 1`, `flow_shift 12`, `euler`), com o trecho exato da música como trilha mantida (`audio_prompt_type AS`). A boca acompanha a voz.
- **Cenas sem cantor:** vão para o Snapgen Muse.
- **Templates novos:** `workflows/wan2gp-h3-lipsync-4step.json` e `workflows/wan2gp-h3-ugc-4step.json`.

## 4. Projetos de teste
Configuração pedida, aplicada nos dois projetos:
- imagens: z-image (Wan2GP);
- narração: OmniVoice (Wan2GP);
- vídeo: Snapgen Muse AI;
- música: ACE-Step XL.

Ressalva: no UGC, o vídeo começa pelo Muse e, na música, pelo H3 lipsync, porque o Muse não faz lipsync.

| Projeto | Formato | Duração | Resultado |
|---|---|---|---|
| UGC AquaTerm v2 (Do-hyun + foto do produto) | 9:16 | 31,2 s | ok |
| Luzes de Seul (Seo-yeon + Ponte de Seul) | 16:9 | 50,0 s | ok |

O produto AquaTerm 750 ml é fictício. Gerei a foto "oficial" dele no z-image.

### Análise dos vídeos
**Música (Luzes de Seul)**
- A Seo-yeon tem o mesmo rosto e a mesma roupa nas 12 cenas.
- A boca está em poses de canto, acompanhando o trecho da música.
- Ponte, rio e luzes da cidade estão coerentes, e a legenda segue a letra.
- 11 das 12 cenas usaram H3 lipsync, com 4 a 9 min por cena na RTX 4070 Ti.

**UGC (AquaTerm)**
- O Do-hyun é o mesmo em todas as cenas.
- A garrafa sai fiel à foto (verde-oliva, tampa de aço, "AQUATERM 750 ml").
- O roteiro segue GANCHO → DOR → DEMO → PROVA → CTA, e o CTA vem com 15% de desconto.
- A maioria das cenas usou Muse AI. O H3 4 passos entrou como reserva, quando o Snapgen teve timeout.

## 5. Problemas encontrados e corrigidos
1. **Clipe de música com 45,9 s em vez de 50, e versos deslocados.**
   - As cenas instrumentais (intro sem letra) "consumiam" versos, mas como não passam pela etapa de letra, ficavam com a duração do plano.
   - Algumas cenas ficaram com 0,5 s.
   - **Correção (49b3111):**
     - cenas sem letra não recebem versos;
     - o intervalo delas é repartido entre os versos vizinhos;
     - toda cena tem no mínimo 2,5 s;
     - todas as cenas ficam com a duração da canção.
   - Resultado: exatamente 50,0 s.
2. **Montagem não era refeita depois de cenas refeitas** (bug do motor, valia para qualquer projeto).
   - O cache das etapas de projeto (`edit`, `subtitles`) não considerava que clipes de cena tinham sido refeitos na mesma execução, e o vídeo final antigo continuava.
   - **Correção (bdc8bf1):** se uma dependência foi refeita nesta execução, a legenda e a montagem são refeitas. O registro mostra: `"image" foi refeita nesta execução → edit refeita`.
   - Teste novo em `engine.test`.
3. **UGC com 22 s em vez de 40.**
   - O roteiro saiu com cerca de 65 palavras, e a OmniVoice fala cerca de 3 palavras por segundo.
   - **Correção:** a skill agora pede 105–125 palavras (nunca menos de 100), em 9–12 falas. A v2 saiu com 100 palavras e 31 s.
   - Para ficar perto de 40 s, ainda dá para subir um pouco esse número.
4. **Foto do produto com faixas pretas** (foto quadrada num vídeo 9:16).
   - **Correção:** o quadro de foto do usuário agora preenche o formato do vídeo, com a foto inteira sobre ela mesma desfocada.
5. **Cenas de produto paradas.**
   - O planejador marcou as cenas de produto como "image" (foto fixa), apesar de a skill pedir vídeo.
   - **Correção:** a rota UGC tem `animateImages`, e essas cenas viram vídeo (a foto é animada).
6. **A garrafa PET de comparação ganhou o rótulo "AquaTerm".**
   - **Correção:** a skill pede que objetos de comparação sejam genéricos e sem marca.
   - Isso vale para projetos novos: a v2 de teste foi criada antes da correção e ainda mostra o defeito numa cena.
7. **Snapgen Muse escreveu texto na tela** na cena de intro do clipe.
   - **Correção:** o prompt do Muse sem fala agora proíbe texto, legendas e letras na imagem.

## 6. Pontos para você olhar
- **Snapgen:**
  - a consulta de conta responde `API_KEY_NOT_FOUND`, mas a geração de vídeo com Muse AI funciona; vale conferir a chave em Configurações → Providers;
  - houve vários `HTTP 500` e timeouts de 20 min no histórico do Snapgen, e o motor caiu corretamente para o H3 local.
- **`noFallback: true` está ligado globalmente.** Os projetos de teste desligaram isso só para eles. Com ele ligado, um timeout do Snapgen derrubaria a cena em vez de usar a reserva.
- **Tentativas repetidas:** quando o H3 lipsync recebe uma cena sem cantor, ele tenta 2 vezes antes de passar para o próximo provedor. O erro é previsível, então daria para pular direto (melhoria pequena).
- **Plugins:** as duas skills não têm cenas de código, então os plugins de cena por código não se aplicaram nestes testes.
- **Custo:** o reteste do UGC refez os vídeos de todas as cenas no Muse, porque um parâmetro novo da rota mudou a chave de cache. Isso só acontece em projetos criados antes dessa mudança.

## 7. Publicação (YouTube, canal "Gargamellus-m5b", não listado)
Os dois vídeos foram enviados pela automação do YouTube Studio, na conta g1 do canal ch1, como **não listados**, com título, descrição e thumbnail:
- **"Garrafa térmica AquaTerm: água gelada por 8 horas"**: UGC, 9:16, enviado às 11:08 UTC;
- **"Luzes de Seul — Balada Romântica no Rio Han (Lyric Video)"**: clipe, 16:9, enviado às 11:08 UTC.

O registro fica em `out/publish.json` de cada projeto. **Ponto de atenção:** a automação concluiu os envios ("vídeo salvo"), mas **não capturou o link** do vídeo (`url: null`); só gravou o link da lista de envios do Studio. Confira os dois em YouTube Studio → Conteúdo. Vale também melhorar a captura do link.

## 8. Commits (filmforge-contract, branch main)
- `b840349` Banco: tempo de geração chega ao índice
- `c430045` Skills UGC de produto e Música com lipsync
- `49b3111` Lipsync: tempo dos versos + Muse sem texto + UGC com mais palavras
- `bdc8bf1` Motor: montagem refeita quando a dependência é refeita; UGC anima foto do produto e preenche o formato

A suíte completa passou (58 arquivos de teste). Para enviar:

```bash
git push origin main
```
