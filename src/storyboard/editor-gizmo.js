/* Gizmo de translação (3 eixos) para o editor de storyboard */
(function () {
  let giz = null, drag = null;
  const axes = [
    { v: new THREE.Vector3(1, 0, 0), c: 0xff5555 },
    { v: new THREE.Vector3(0, 1, 0), c: 0x55ff55 },
    { v: new THREE.Vector3(0, 0, 1), c: 0x5599ff }
  ];
  function build(o) {
    if (giz) { scene.remove(giz); giz = null; }
    if (!o) return;
    giz = new THREE.Group(); giz.position.copy(o.position);
    for (const a of axes) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .8, 6), new THREE.MeshBasicMaterial({ color: a.c, depthTest: false }));
      m.position.copy(a.v.clone().multiplyScalar(.4));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.v);
      m.userData.gizAxis = a.v; m.renderOrder = 999; giz.add(m);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(.09, .22, 8), new THREE.MeshBasicMaterial({ color: a.c, depthTest: false }));
      tip.position.copy(a.v.clone().multiplyScalar(.88));
      tip.quaternion.copy(m.quaternion); tip.userData.gizAxis = a.v; tip.renderOrder = 999; giz.add(tip);
    }
    scene.add(giz);
  }
  const hl = window.__hl;
  window.__hl = (o) => { hl ? hl(o) : null; build(o); };

  const rc = new THREE.Raycaster(), pv = new THREE.Vector2();
  function pick(e) {
    pv.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    rc.setFromCamera(pv, camera);
    const hit = rc.intersectObjects(giz ? giz.children : [], false)[0];
    return hit ? hit.object.userData.gizAxis : null;
  }
  const screenAxis = (v) => {
    const a = v.clone().transformDirection(camera.matrixWorldInverse);
    return new THREE.Vector2(a.x, -a.y);
  };
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!giz || !SB.sel) return;
    const ax = pick(e);
    if (ax) { drag = { ax, x: e.clientX, y: e.clientY, start: SB.sel.position.clone() }; e.stopPropagation(); }
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!drag || !SB.sel) return;
    const sa = screenAxis(drag.ax);
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const k = (dx * sa.x + dy * sa.y) * 0.012;
    SB.sel.position.copy(drag.start).add(drag.ax.clone().multiplyScalar(k));
    giz.position.copy(SB.sel.position);
    renderer.render(scene, camera);
  });
  window.addEventListener('pointerup', () => { drag = null; });
  log('gizmo: arraste as setas vermelha/verde/azul para mover');
})();
