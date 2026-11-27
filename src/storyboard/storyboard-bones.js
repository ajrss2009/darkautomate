/* Personagens articulados (bones): cada junta é um grupo rotacionável */
(function () {
  const $ = (id) => document.getElementById(id);
  const aside = document.querySelector('aside');
  const b = document.createElement('button');
  b.id = 'rig-add'; b.textContent = '+ Boneco articulado';
  b.style.width = '100%'; b.style.marginTop = '6px';
  aside.appendChild(b);

  function seg(w, h, d, color) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: .75 }));
    m.position.y = -h / 2; m.castShadow = true; return m;
  }
  function joint(name, x, y, z, parent) {
    const g = new THREE.Group(); g.name = name; g.userData.joint = true; g.position.set(x, y, z);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshBasicMaterial({ color: '#22c55e' })));
    parent.add(g); return g;
  }
  function makeRig(name, color) {
    const root = new THREE.Group(); root.userData = { kind: 'rig', name: name || 'Boneco' };
    const hips = joint('hips', 0, 1.05, 0, root);
    hips.add(seg(.6, .16, .3, color));
    const torso = joint('torso', 0, .12, 0, hips); torso.add(seg(.6, .55, .34, color));
    const neck = joint('neck', 0, .55, 0, torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.19, 18, 14), new THREE.MeshStandardMaterial({ color: '#e8c9a8' }));
    head.position.y = .16; head.castShadow = true; neck.add(head);
    for (const s of [-1, 1]) {
      const sh = joint(s < 0 ? 'shoulderL' : 'shoulderR', s * .35, .48, 0, torso);
      sh.add(seg(.14, .34, .14, color));
      const el = joint(s < 0 ? 'elbowL' : 'elbowR', 0, -.34, 0, sh);
      el.add(seg(.12, .32, .12, color));
      const hip = joint(s < 0 ? 'hipL' : 'hipR', s * .17, -.02, 0, hips);
      hip.add(seg(.16, .42, .16, color));
      const kn = joint(s < 0 ? 'kneeL' : 'kneeR', 0, -.42, 0, hip);
      kn.add(seg(.14, .4, .14, color));
    }
    return root;
  }

  window.__makeRig = makeRig;
  b.onclick = () => {
    if (window.__newMannequin) { window.__newMannequin(); return; }
    const name = 'Boneco ' + (objects.length + 1);
    const color = '#8b5cf6';
    const r = makeRig(name, color);
    addObj(r, 0, -1); SB.sel = r; window.__hl?.(r); renderer.render(scene, camera);
    log('boneco articulado criado: clique numa junta (esferas verdes) e use ↺/↻');
  };

  /* seleção de junta: clicar numa junta seleciona o grupo, não o mesh */
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1), camera);
    const hit = r.intersectObjects(objects, true)[0]; if (!hit) return;
    let o = hit.object; while (o && o !== scene) { if (o.userData?.joint) { SB.sel = o; window.__hl?.(o); renderer.render(scene, camera); log('junta: ' + o.name); return; } o = o.parent; }
  }, true);

  /* rotação de junta nos eixos X/Z com Shift */
  window.addEventListener('keydown', (e) => {
    if (!SB.sel?.userData?.joint) return;
    const d = e.shiftKey ? -1 : 1;
    if (e.key === 'ArrowLeft') SB.sel.rotation.z += .12 * d;
    if (e.key === 'ArrowRight') SB.sel.rotation.z -= .12 * d;
    if (e.key === 'ArrowUp') SB.sel.rotation.x -= .12 * d;
    if (e.key === 'ArrowDown') SB.sel.rotation.x += .12 * d;
    renderer.render(scene, camera);
  });
  log('bones prontos: clique na junta e gire com as setas (Shift inverte)');
})();
