/* Dummy de crash teste (.glb) no editor de storyboard */
(function () {
  const b = document.createElement('button');
  b.textContent = '+ Dummy (GLB)'; b.style.width = '100%'; b.style.marginTop = '6px';
  document.querySelector('aside').appendChild(b);
  b.onclick = async () => {
    try {
      let buf;
      if (window.forge?.storyboard3dAsset) {
        const b64 = await window.forge.storyboard3dAsset('crash_dummy.glb');
        const bin = atob(b64); const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        buf = arr.buffer;
      }
      const done = (g) => {
        const o = g.scene; o.userData = { kind: 'dummy', name: 'Crash Dummy' };
        addObj(o, 0, 0); SB.sel = o; if (window.__hl) window.__hl(o);
        renderer.render(scene, camera); log('dummy carregado: use os controles de rotação/gizmo para poses');
      };
      const err = (e) => log('erro ao carregar GLB: ' + (e.message || e));
      if (buf) new THREE.GLTFLoader().parse(buf, '', done, err);
      else new THREE.GLTFLoader().load('crash_dummy.glb', done, undefined, err);
    } catch (e) { log('erro ao carregar GLB: ' + e.message); }
  };
  if (location.search.includes('glb')) setTimeout(() => b.onclick(), 200);
})();
