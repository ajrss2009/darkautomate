/* Filtros cinematográficos (Technicolor 3 tiras etc.) */
(function () {
  const $ = (id) => document.getElementById(id);
  const d = document.createElement('div');
  d.innerHTML = `<h3>Filtro cinematográfico</h3>
    <label>Preset</label>
    <select id="fx-filter">
      <option value="none">Sem filtro</option>
      <option value="technicolor" selected>Technicolor 3 tiras</option>
      <option value="noir">Noir</option>
      <option value="golden">Dourado / crepúsculo</option>
    </select>`;
  const aside = document.querySelector('aside');
  aside.insertBefore(d, aside.firstChild);
  const F = {
    none: 'none',
    technicolor: 'saturate(1.9) contrast(1.32) sepia(0.18) hue-rotate(-10deg) brightness(1.03)',
    noir: 'grayscale(1) contrast(1.45) brightness(0.92)',
    golden: 'sepia(0.45) saturate(1.5) contrast(1.15) brightness(1.05)'
  };
  function apply(v) {
    const f = F[v] || 'none';
    window.__FILTER = f;
    renderer.domElement.style.filter = f;
    document.querySelectorAll('canvas').forEach((c) => { c.style.filter = f; });
    renderer.render(scene, camera);
    log('filtro: ' + v);
  }
  $('fx-filter').onchange = () => apply($('fx-filter').value);
  setTimeout(() => apply($('fx-filter').value), 300);
  log('filtros prontos: Technicolor 3 tiras');
})();
