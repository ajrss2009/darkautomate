/* Filtros cinematográficos no editor de storyboard */
(function () {
  const $ = (id) => document.getElementById(id);
  const d = document.createElement('div');
  d.innerHTML = `<h3>Filtro cinematográfico</h3>
    <label>Preset</label>
    <select id="fx-filter">
      <option value="none">Sem filtro</option>
      <option value="technicolor">Technicolor 3 tiras</option>
      <option value="noir">Noir</option>
      <option value="golden">Dourado / crepúsculo</option>
    </select>`;
  document.querySelector('aside').appendChild(d);
  const F = {
    none: 'none',
    technicolor: 'saturate(1.45) contrast(1.14) sepia(0.10) hue-rotate(-5deg)',
    noir: 'grayscale(1) contrast(1.30) brightness(0.95)',
    golden: 'sepia(0.25) saturate(1.25) contrast(1.08)'
  };
  $('fx-filter').onchange = () => {
    const v = F[$('fx-filter').value] || 'none';
    window.__FILTER = v;
    renderer.domElement.style.filter = v;
    renderer.render(scene, camera);
    log('filtro: ' + $('fx-filter').value);
  };
  renderer.domElement.style.transition = 'filter .2s';
  log('filtros prontos: Technicolor 3 tiras');
})();
