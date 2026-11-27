/* UNDO (Ctrl+Z): transformações e objetos apagados */
(function () {
  const stack = [];
  let pending = null;
  const snap = () => objects.map((o) => ({ o, p: o.position.toArray(), r: [o.rotation.x, o.rotation.y, o.rotation.z], s: o.scale.x }));
  const restore = (s) => {
    if (!s) return;
    if (s.deleted) {
      scene.add(s.deleted); objects.push(s.deleted);
      if (s.deleted.userData) { SB.sel = s.deleted; if (window.__hl) window.__hl(s.deleted); }
    }
    (s.list || s).forEach((x) => { x.o.position.fromArray(x.p); x.o.rotation.set(x.r[0], x.r[1], x.r[2]); x.o.scale.setScalar(x.s); });
    renderer.render(scene, camera); log('undo');
  };
  document.addEventListener('pointerdown', () => { pending = { list: snap() }; }, true);
  document.addEventListener('pointerup', () => { if (pending) { stack.push(pending); pending = null; if (stack.length > 60) stack.shift(); } }, true);
  window.__undoPush = (o) => { stack.push({ list: snap(), deleted: o }); };
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    if (/input|textarea|select/i.test(document.activeElement?.tagName || '')) return;
    e.preventDefault(); restore(stack.pop());
  });
  log('undo: Ctrl+Z');
})();
