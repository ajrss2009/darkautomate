/* Pose mode simples (Blender-like): manequim articulado e arraste de juntas */
(function () {
  const $ = (id) => document.getElementById(id);
  const box = document.createElement('div');
  box.innerHTML = `<h3>Pose mode</h3>
    <button id="pm-new" style="width:100%">+ Manequim articulado</button>
    <label>Junta</label><select id="pm-joint"></select>
    <div class="row"><button id="pm-rx">↻ X</button><button id="pm-ry">↻ Y</button><button id="pm-rz">↻ Z</button></div>
    <button id="pm-reset" style="width:100%;margin-top:6px">Reset pose</button>
    <p class="muted" style="font-size:11px">Clique na esfera da junta e arraste para girar. Marlok é fixo.</p>`;
  document.querySelector('aside').appendChild(box);

  const J = {};
  function joint(parent, name, x, y, z) {
    const g = new THREE.Group(); g.name = name; g.userData.joint = true; g.position.set(x, y, z);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.07, 10, 8), new THREE.MeshBasicMaterial({ color: '#f59e0b', depthTest: false }));
    dot.renderOrder = 998; dot.userData.jointRef = g; g.add(dot);
    parent.add(g); J[name] = g; return g;
  }
  function limb(parent, color, h) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(.09, h, 6, 10), new THREE.MeshStandardMaterial({ color, roughness: .7 }));
    m.position.y = -h / 2; m.castShadow = true; parent.add(m);
  }
  function mannequin() {
    const r = new THREE.Group(); r.userData = { kind: 'mannequin', name: 'Manequim' };
    const hips = joint(r, 'quadril', 0, 1.0, 0); limb(hips, '#38bdf8', .18);
    const torso = joint(hips, 'tronco', 0, .14, 0); limb(torso, '#38bdf8', .55);
    const neck = joint(torso, 'pescoco', 0, .55, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.18, 18, 14), new THREE.MeshStandardMaterial({ color: '#e8c9a8' }));
    head.position.y = .16; head.castShadow = true; neck.add(head);
    for (const s of [-1, 1]) {
      const L = s < 0 ? 'E' : 'D';
      const sh = joint(torso, 'ombro' + L, s * .32, .48, 0); limb(sh, '#38bdf8', .34);
      const el = joint(sh, 'cotovelo' + L, 0, -.34, 0); limb(el, '#38bdf8', .32);
      const hp = joint(hips, 'perna' + L, s * .16, -.02, 0); limb(hp, '#1d4ed8', .42);
      const kn = joint(hp, 'joelho' + L, 0, -.42, 0); limb(kn, '#1d4ed8', .4);
    }
    return r;
  }
  $('pm-new').onclick = () => {
    const m = mannequin(); addObj(m, 0, 0); SB.sel = m;
    if (window.__hl) window.__hl(m);
    const s = $('pm-joint'); s.innerHTML = '';
    Object.keys(J).forEach((k, i) => { const o = document.createElement('option'); o.value = k; o.textContent = k; s.appendChild(o); });
    renderer.render(scene, camera); log('manequim articulado criado');
  };
  const current = () => J[$('pm-joint').value];
  const rot = (a, d) => { const j = current(); if (j) { j.rotation[a] += d * Math.PI / 12; renderer.render(scene, camera); } };
  $('pm-rx').onclick = () => rot('x', 1); $('pm-ry').onclick = () => rot('y', 1); $('pm-rz').onclick = () => rot('z', 1);
  $('pm-reset').onclick = () => { Object.values(J).forEach((j) => j.rotation.set(0, 0, 0)); renderer.render(scene, camera); };

  /* clique/arraste na esfera da junta = giro com o mouse */
  const rc = new THREE.Raycaster(), pv = new THREE.Vector2();
  let drag = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!SB.sel || SB.sel.userData?.kind !== 'mannequin') return;
    pv.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    rc.setFromCamera(pv, camera);
    const hit = rc.intersectObjects(objects, true).find((h) => h.object.userData.jointRef);
    if (hit) {
      const j = hit.object.userData.jointRef;
      $('pm-joint').value = j.name; drag = { j, x: e.clientX, y: e.clientY }; e.stopPropagation();
    }
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.j.rotation.z += (e.clientX - drag.x) * .012;
    drag.j.rotation.x += (e.clientY - drag.y) * .012;
    drag.x = e.clientX; drag.y = e.clientY; renderer.render(scene, camera);
  });
  window.addEventListener('pointerup', () => drag = null);
  /* versão corrigida: cada junta filha nasce no fim do segmento da mãe e as pontas são cobertas */
  mannequin = function () {
    Object.keys(J).forEach((k) => delete J[k]);
    const root = new THREE.Group(); root.userData = { kind: 'mannequin', name: 'Manequim' };
    const mk = (parent, name, x, y, len, color) => {
      const g = new THREE.Group(); g.name = name; g.userData.joint = true;
      g.position.set(x, y, 0); parent.add(g);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(.08, len, 6, 10), new THREE.MeshStandardMaterial({ color, roughness: .7 }));
      m.position.y = -len / 2; m.castShadow = true; g.add(m);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(.085, 10, 8), new THREE.MeshStandardMaterial({ color, roughness: .7 }));
      ball.position.y = -len; g.add(ball);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(.07, 10, 8), new THREE.MeshBasicMaterial({ color: '#f59e0b', depthTest: false }));
      dot.renderOrder = 998; dot.userData.jointRef = g; g.add(dot);
      J[name] = g; return g;
    };
    const hips = mk(root, 'quadril', 0, 1.05, .16, '#38bdf8');
    const torso = mk(hips, 'tronco', 0, 0, .55, '#38bdf8');
    const pescoco = mk(torso, 'pescoco', 0, 0, .12, '#38bdf8');
    const head = new THREE.Mesh(new THREE.SphereGeometry(.18, 18, 14), new THREE.MeshStandardMaterial({ color: '#e8c9a8', roughness: .8 }));
    head.position.y = -.22; head.castShadow = true; pescoco.add(head);
    for (const s of [-1, 1]) {
      const L = s < 0 ? 'E' : 'D';
      const sh = mk(torso, 'ombro' + L, s * .32, -.05, .34, '#38bdf8');
      const el = mk(sh, 'cotovelo' + L, 0, 0, .32, '#38bdf8');
      const hp = mk(hips, 'perna' + L, s * .16, 0, .42, '#1d4ed8');
      mk(hp, 'joelho' + L, 0, 0, .4, '#1d4ed8');
    }
    return root;
  };
  log('pose mode pronto: clique/arraste as esferas laranja');
})();
