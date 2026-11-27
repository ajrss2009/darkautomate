/* Pose de esqueleto (GLB) + apagar objeto + atalhos estilo Storyboarder */
(function () {
  const $ = (id) => document.getElementById(id);
  const p = document.createElement('div');
  p.innerHTML = `<h3>Pose / objeto</h3>
    <label>Junta (bones)</label><select id="pose-bone"></select>
    <div class="row"><button id="pose-x">↻ X</button><button id="pose-y">↻ Y</button><button id="pose-z">↻ Z</button></div>
    <div class="row"><button id="pose-rx">↺ X</button><button id="pose-ry">↺ Y</button><button id="pose-rz">↺ Z</button></div>
    <button id="pose-del" style="width:100%;margin-top:6px;background:#7f1d1d;border-color:#b91c1c">✕ Apagar objeto</button>
    <button id="pose-board" style="width:100%;margin-top:6px">+ Novo painel (N)</button>`;
  document.querySelector('aside').appendChild(p);

  let bone = null;
  function bones() {
    const s = $('pose-bone'); s.innerHTML = ''; bone = null;
    if (!SB.sel) return;
    const list = [];
    SB.sel.traverse((o) => { if (o.isBone || o.userData.joint || /^(bone|armature)/i.test(o.name || '')) list.push(o); });
    if (!list.length) { const o = document.createElement('option'); o.textContent = '(sem bones)'; s.appendChild(o); return; }
    list.forEach((b, i) => { const o = document.createElement('option'); o.value = i; o.textContent = b.name || 'osso ' + (i + 1); s.appendChild(o); });
    bone = list[0];
  }
  $('pose-bone').onchange = () => { const a = SB.sel ? [] : []; if (!SB.sel) return; SB.sel.traverse((o) => { if (o.isBone) a.push(o); }); bone = a[Number($('pose-bone').value)] || null; };
  const rot = (axis, s) => { if (bone) { bone.rotation[axis] += s * Math.PI / 12; renderer.render(scene, camera); log('junta ' + (bone.name || '') + ' girada'); } };
  $('pose-x').onclick = () => rot('x', 1); $('pose-y').onclick = () => rot('y', 1); $('pose-z').onclick = () => rot('z', 1);
  $('pose-rx').onclick = () => rot('x', -1); $('pose-ry').onclick = () => rot('y', -1); $('pose-rz').onclick = () => rot('z', -1);
  function del() {
    if (!SB.sel) return;
    const n = String(SB.sel.userData?.name || '');
    if (window.__undoPush && SB.sel) window.__undoPush(SB.sel);
    scene.remove(SB.sel);
    const i = objects.indexOf(SB.sel); if (i >= 0) objects.splice(i, 1);
    if (window.__hl) window.__hl(null);
    SB.sel = null; bones(); renderer.render(scene, camera); log('objeto apagado');
  }
  $('pose-del').onclick = del;
  $('pose-board').onclick = () => {
    $('shotN').textContent = SB.shots.length + 1;
    $('pTitle').value = 'Plano ' + (SB.shots.length + 1);
    saveShot(); log('novo painel adicionado');
  };
  window.addEventListener('keydown', (e) => {
    if (/input|textarea|select/i.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); }
    if (e.key.toLowerCase() === 'n') $('pose-board').click();
    if (e.key === 'ArrowLeft' && SB.shots.length) loadState(SB.shots[Math.max(0, Number($('shotN').textContent) - 2)]);
    if (e.key === 'ArrowRight' && SB.shots.length) loadState(SB.shots[Math.min(SB.shots.length - 1, Number($('shotN').textContent))]);
  });
  window.__poseBones = bones;
  const hl = window.__hl;
  window.__hl = (o) => { if (hl) hl(o); bones(); };
  bones();
  log('poses: selecione o dummy e escolha uma junta; Delete apaga; N novo painel');
})();
