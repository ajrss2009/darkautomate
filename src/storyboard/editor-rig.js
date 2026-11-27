/* Re-rig rápido: cria um pivô por peça do GLB para permitir poses independentes */
(function () {
  const b = document.createElement('button');
  b.textContent = 'Re-rig peças (GLB)'; b.style.width = '100%'; b.style.marginTop = '6px';
  document.querySelector('aside').appendChild(b);
  b.onclick = () => {
    if (!SB.sel) { log('selecione o dummy primeiro'); return; }
    const root = SB.sel;
    const meshes = [];
    root.traverse((o) => { if (o.isMesh && o.geometry) meshes.push(o); });
    let n = 0;
    for (const m of meshes) {
      const box = new THREE.Box3().setFromObject(m);
      const c = new THREE.Vector3(); box.getCenter(c);
      const pivot = new THREE.Group();
      pivot.name = 'peca ' + (++n);
      pivot.userData.joint = true;
      root.worldToLocal(c);
      pivot.position.copy(c);
      root.add(pivot);
      m.parent.remove(m);
      pivot.attach(m);
    }
    if (window.__poseBones) window.__poseBones();
    renderer.render(scene, camera);
    log('re-rig: ' + n + ' peças com pivô próprio — selecione e gire');
  };
})();
