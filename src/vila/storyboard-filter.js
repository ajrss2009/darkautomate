/* Filtro cinematográfico na barra superior (em linha com os demais controles) */
(function () {
  const $ = (id) => document.getElementById(id);
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-right:6px';
  wrap.innerHTML = '<label style="margin:0;color:#9aa7b4;font-size:11px">Filtro</label><select id="fx-filter" style="width:auto;padding:5px 8px"><option value="none" selected>Sem filtro (estilo Storyboarder)</option><option value="technicolor">Technicolor 3 tiras</option><option value="noir">Noir</option><option value="golden">Dourado</option></select>';
  const header = document.querySelector('header');
  const anchor = document.getElementById('btnPreset');
  header.insertBefore(wrap, anchor);
  const F = {
    none: 'none',
    technicolor: 'saturate(1.25) contrast(1.08) sepia(0.06) hue-rotate(-4deg)',
    noir: 'grayscale(1) contrast(1.45) brightness(0.92)',
    golden: 'sepia(0.45) saturate(1.5) contrast(1.15) brightness(1.05)'
  };
  function apply(v) {
    const f = F[v] || 'none';
    window.__FILTER = f;
    document.querySelectorAll('canvas').forEach((c) => { c.style.filter = f; });
    renderer.render(scene, camera);
    log('filtro: ' + v);
  }
  $('fx-filter').onchange = () => apply($('fx-filter').value);
  setTimeout(() => apply($('fx-filter').value), 300);
  log('filtros prontos: Technicolor 3 tiras');
})();
