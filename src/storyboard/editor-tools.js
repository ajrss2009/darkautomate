/* Barra de ferramentas estilo Blender: camera, objeto, cuts e balões */
(function () {
  const $ = (id) => document.getElementById(id);
  const aside = document.querySelector('aside');
  const bar = document.createElement('div');
  bar.innerHTML = `<h3>Ferramentas</h3>
    <div class="row"><button id="t-ol" title="Orbitar esquerda">⟲</button><button id="t-or" title="Orbitar direita">⟳</button><button id="t-up" title="Subir câmera">↑</button><button id="t-dn" title="Descer câmera">↓</button></div>
    <div class="row"><button id="t-panl" title="Pan esquerda">⇤</button><button id="t-panr" title="Pan direita">⇥</button><button id="t-zin" title="Zoom in">＋</button><button id="t-zout" title="Zoom out">－</button></div>
    <label>Objeto</label>
    <div class="row"><button id="t-ryl">↺</button><button id="t-ryr">↻</button><button id="t-mx">←</button><button id="t-mz">→</button></div>
    <div class="row"><button id="t-scu">escala +</button><button id="t-scd">escala −</button></div>
    <h3>Cuts</h3>
    <select id="t-cuts"></select>
    <div class="row"><button id="t-dup">Duplicar</button><button id="t-del">Excluir</button></div>
    <div class="row"><button id="t-bub">+ Balão de fala</button></div>`;
  aside.appendChild(bar);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cam = (dt, dp, dr) => { orbit.theta += dt; orbit.phi = clamp(orbit.phi + dp, .32, 1.6); orbit.r = clamp(orbit.r + dr, 1.5, 40); updateCam(); renderer.render(scene, camera); };
  $('t-ol').onclick = () => cam(.18, 0, 0);
  $('t-or').onclick = () => cam(-.18, 0, 0);
  $('t-up').onclick = () => cam(0, -.06, 0);
  $('t-dn').onclick = () => cam(0, .06, 0);
  $('t-zin').onclick = () => cam(0, 0, -.8);
  $('t-zout').onclick = () => cam(0, 0, .8);
  $('t-panl').onclick = () => { orbit.target.x -= .35; updateCam(); renderer.render(scene, camera); };
  $('t-panr').onclick = () => { orbit.target.x += .35; updateCam(); renderer.render(scene, camera); };
  const obj = (fn) => { if (SB.sel) { fn(SB.sel); window.__hl?.(SB.sel); if (window.syncSel) syncSel(); renderer.render(scene, camera); } };
  $('t-ryl').onclick = () => obj((o) => o.rotation.y += Math.PI / 12);
  $('t-ryr').onclick = () => obj((o) => o.rotation.y -= Math.PI / 12);
  $('t-mx').onclick = () => obj((o) => o.position.x -= .25);
  $('t-mz').onclick = () => obj((o) => o.position.z += .25);
  $('t-scu').onclick = () => obj((o) => o.scale.multiplyScalar(1.08));
  $('t-scd').onclick = () => obj((o) => o.scale.multiplyScalar(.92));

  function refresh() {
    const s = $('t-cuts'); s.innerHTML = '';
    SB.shots.forEach((sh, i) => { const o = document.createElement('option'); o.value = i; o.textContent = String(i + 1).padStart(2, '0') + ' · ' + sh.title; s.appendChild(o); });
    s.value = Math.max(0, SB.shots.length - 1);
  }
  const _save = $('btnShot').onclick;
  $('btnShot').onclick = () => { _save(); refresh(); };
  $('t-cuts').onchange = () => { const i = Number($('t-cuts').value); if (SB.shots[i]) loadState(SB.shots[i]); };
  $('t-dup').onclick = () => { const i = Number($('t-cuts').value); if (SB.shots[i]) { const c = { ...SB.shots[i], id: SB.shots.length + 1, title: SB.shots[i].title + ' (dup)' }; SB.shots.push(c); refresh(); renderShots(); } };
  $('t-del').onclick = () => { const i = Number($('t-cuts').value); if (SB.shots.length > 1) { SB.shots.splice(i, 1); refresh(); renderShots(); } };
  $('t-bub').onclick = () => {
    const t = prompt('Texto do balão', 'What the hell!'); if (!t) return;
    const sp = makeText(t); const p = new THREE.Vector3(); camera.getWorldDirection(p); sp.position.copy(orbit.target).add(new THREE.Vector3(0, 1.2, 0));
    scene.add(sp); objects.push(sp); window.__hl?.(sp); renderer.render(scene, camera); log('balão criado');
  };
  refresh();
  log('ferramentas: câmera, objeto, cuts e balão');
})();
