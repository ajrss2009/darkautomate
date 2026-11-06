# cartoon3d — "Curta cartoon 3D" do FilmForge

Personagens 2D chapados, com contorno ameixa, num mundo 3D colorido e pintado, com contorno preto a tinta. Tem também céu saturado, desfoque de fundo, câmera deslizando e grade de cor.

Tudo roda em Three.js local, sem rede, dentro das cenas por código do FilmForge, com o contrato `window.__forge` / `seek(t)`.

## Origem e licença

O visual foi portado de **[github.com/mromidev/claude-animated-shorts](https://github.com/mromidev/claude-animated-shorts)** (MIT, © 2026 Mr omi). Veja `LICENSE`.

Arquivos copiados, só com o cabeçalho de crédito acrescentado:
- `src/toon.ts`: elenco e efeitos em Canvas 2D.
- `src/paint.ts`: texturas pintadas.
- `src/shade.ts`: luz em duas tonalidades.
- `src/lights.ts`: presets de dia e dourado.
- `src/cardshade.ts`: luz nos cartões dos personagens.

Arquivo adaptado:
- `src/ink.ts`: o mesmo passe de contorno, sem a classe base do pacote `postprocessing`.

Arquivo do FilmForge:
- `src/stage.ts`: substitui o Remotion, o React Three Fiber e o `postprocessing` por um compositor WebGL simples. A ordem é cena MSAA 4, depois tinta, desfoque de lente, tone map Neutral e grade. Também acrescenta as luzes `night` e `interior`, ruas, salas, objetos, câmera e efeitos.

Em `reference/` ficam o `SKILL.md`, o `STYLE_BIBLE.md`, os relatórios medidos e os templates originais, para consulta.

As folhas de quadros de referência do repositório não vêm com o app. São material de estudo de outro canal e o próprio repositório pede que não sejam publicadas.

## Como usar numa página

```html
<script type="importmap">{"imports":{"three":".../three.module.min.js","cartoon3d":".../cartoon3d.js"}}</script>
<script type="module">
import * as C from "cartoon3d";
const st = C.createStage({ width: 1080, height: 1920, light: "day" });
st.street({ length: 70, width: 11 });
const cop = st.actor(C.OUTFITS.police, { x: 0, z: -2, seed: 3 });
function seek(t) {
  st.camFrom(C.camAt([{ t: 0, pos: [0, 1.5, 4], look: [0, 1.2, -2] }], t));
  cop.set({ mode: "stroll", phase: t, expr: "stern", blink: C.blink(t, 3) });
  st.render({ dof: 10 });
}
window.__forge = { duration: 5, fps: 30, seek, pause() {} };
</script>
```

Num projeto, o FilmForge copia `three` e `cartoon3d` para `plugins/_three` e `plugins/_cartoon3d` e corrige o import map de cada cena. A API completa vai no pedido de cada cena (`src/main/cartoon3d.ts`), e o exemplo completo está em `demo.html`.

## Compilar

`node scripts/build-cartoon3d.mjs` gera o `cartoon3d.js` com o `three` externo. Esse script também roda dentro de `node scripts/build.mjs`.
