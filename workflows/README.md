# Workflows ComfyUI

Formato **API** (Save (API Format)). Cada `X.json` pode ter um `X.map.json` ao lado com `outputNode`, `vars`, `mapping`, `maxSide`, `multiple`, `refAudio`.

| Arquivo | Uso | Observações |
|---|---|---|
| `krea2-turbo-t2i.json` | imagem (Krea 2 Turbo int8) | Refinador de prompt ligado; LoRA `krea2_darkbrush` desligada (nó `30:23`). Saída: nó `29`. |
| `z-image-turbo-t2i.json` | imagem (Z-Image Turbo int8) | Fallback local do Krea. Saída: nó `9`. |
| `omnivoice-clone-tts.json` | narração com clonagem de voz (OmniVoice) | Precisa de áudio de referência: `refAudio` (caminho local, enviado ao ComfyUI) ou `vars.ref_audio` (arquivo em `ComfyUI/input`, padrão `Dave PT-BR.MP3`). Saída: nó `5`. |
| `t2i-basic.json` | imagem SD/SDXL genérica | Ajuste `vars.checkpoint`. |
| `minimax-h3-ref2v.json` | vídeo a partir da imagem da cena (MiniMax H3 referência→vídeo) | 1 imagem de referência = frame da cena. Gera áudio junto. Se a cena não tem imagem, falha e cai no próximo. |
| `minimax-h3-perfect-loop.json` | vídeo em loop perfeito (MiniMax H3 primeiro = último frame) | A MESMA imagem da cena entra em `first_frame` e `last_frame`. Duração snapped para a grade 17k+5 a 24 fps. O `clip-musical` remove o último frame duplicado e usa a duração exata como período do loop. Saída: nó `21`. |
| `minimax-h3-perfect-loop-3step.json` | loop perfeito com LoRA taomate 3-step | Mesmo fluxo do anterior, com `LoraLoaderModelOnly` (`minimax_h3_taomate_3step_lora_avg_rank_19_bf16`) e 3 steps. Usa `exactAspect` (16:9 = 1024×576) e `ImageScale` com crop central para o primeiro/último frame não esticar. Saída: nó `21`. |
| `minimax-h3-t2v.json` | vídeo texto→vídeo (MiniMax H3) | Inclui RTX Video Super Resolution 2x (nó 41); precisa de GPU/nós RTX. |
| `yue2-text2music.json` | trilha sonora (YuE2 texto→música) | `style`, `lyrics` ([Instrumental]), duração = duração do vídeo (10–360 s). |
| `yue2-music-cover.json` | trilha a partir de uma música de referência | Defina `refAudio` no `.map.json`. |
| `wan2gp-*.json` | **templates Wan2GP** (imagem, vídeo t2v/i2v, TTS, música) | Não são workflows ComfyUI: `{model_type, settings}` enviados à API Python do Wan2GP. |
| Moss Image | imagem | O arquivo enviado está no formato de **interface** (não API) e usa nós AusBoss em subgrafos: não pode ser enviado ao `/prompt`. No ComfyUI use **Exportar (API)** e salve como `moss-image-t2i.json` + `moss-image-t2i.map.json` (`outputNode` = nó SaveImage, troque o prompt por `{{prompt}}`, a semente por `{{seed}}`, o tamanho por `{{width}}`/`{{height}}`). |

Seus exports foram limpos: removi a cópia duplicada do subgrafo que não alimentava o nó de saída e troquei os campos editáveis por variáveis:
`{{prompt}}`, `{{seed}}`, `{{width}}`, `{{height}}`, `{{text}}`, `{{ref_audio}}`, `{{init_image}}`, `{{frames}}`, `{{fps}}`, `{{negative}}`.
No Krea, o `ResolutionSelector` foi substituído por largura/altura vindas do formato do projeto (9:16, 16:9…), limitadas por `maxSide`.
No OmniVoice, `keep_model_loaded` ficou `true` para não recarregar o modelo a cada cena (volte para `false` se faltar VRAM).
Modelos necessários no ComfyUI: `krea2_turbo_int8_convrot`, `qwen3vl_4b_fp8_scaled`, `qwen_image_vae`, `z_image_turbo_int8_convrot`, `qwen_3_4b_fp8_mixed`, `ae`, nós OmniVoice.

Variáveis extras: `{{seconds}}`/`{{seconds_int}}` (duração da cena, 2–12 s), `{{music_seconds}}`, `{{style}}`, `{{lyrics}}`, `{{init_image}}` (imagem da cena), `{{ref_audio}}`, `{{resolution}}` (`LxA`).
Resolução: `maxSide` (maior lado) ou `megapixels` (área) + `multiple` no `.map.json`. Variável sem valor = erro claro e fallback para o próximo binding.

## Wan2GP
Ponte Python persistente (`tools/wan2gp_bridge.py`, usa `shared.api` do Wan2GP; o modelo fica carregado entre cenas).
Em **Provedores → Wan2GP** informe `root` (pasta) e `python` (do venv do Wan2GP) e **não abra o Wan2GP ao mesmo tempo**.
Use *Listar modelos* e *Ver padrões do modelo* para confirmar `model_type` e as chaves. `ltx2_22B_distilled` e as chaves de vídeo vêm da documentação;
**`z_image`, `qwen3_tts_base`, `yue2` e as chaves de imagem inicial/áudio/música nos templates são suposições** — corrija os `wan2gp-*.json` conforme a lista do seu Wan2GP.
