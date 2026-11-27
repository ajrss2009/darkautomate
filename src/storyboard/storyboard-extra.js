/* Extras do Editor de Storyboard: destaque, novo personagem, ambiente, export com textos */
(function () {
  const $x = (id) => document.getElementById(id);
  const aside = document.querySelector('aside');
  const box = document.createElement('div');
  box.innerHTML = `<h3>Criar</h3>
    <div class="row"><button id="x-char">+ Personagem</button><button id="x-env">+ Ambiente</button></div>
    <label>Formato ao salvar</label>
    <select id="x-fmt"><option value="png">PNG</option><option value="jpg">JPG</option></select>
    <label><input id="x-cap" type="checkbox" checked style="width:auto"> Queimar textos no painel</label>`;
  aside.appendChild(box);

  /* destaque do selecionado */
  let helper = null;
  window.__hl = (o) => {
    if (helper) { scene.remove(helper); helper.geometry.dispose?.(); helper = null; }
    if (o) { helper = new THREE.BoxHelper(o, 0x22c55e); scene.add(helper); }
  };
  const rc = new THREE.Raycaster(), pv = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    pv.x = (ev.clientX / window.innerWidth) * 2 - 1; pv.y = -(ev.clientY / window.innerHeight) * 2 + 1;
    rc.setFromCamera(pv, camera);
    const hit = rc.intersectObjects(objects, true)[0];
    if (!hit) { window.__hl(null); return; }
    let o = hit.object; while (o.parent && !objects.includes(o)) o = o.parent;
    window.__hl(o);
  }, true);

  /* novo personagem proxy */
  $x('x-char').onclick = () => {
    const name = prompt('Nome do personagem', 'Novo personagem'); if (!name) return;
    const color = prompt('Cor principal (hex)', '#8b5cf6') || '#8b5cf6';
    const h = Number(prompt('Altura (m)', '1.8')) || 1.8;
    const g = new THREE.Group();
    const s = h / 1.8;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.7, 6, 12), new THREE.MeshStandardMaterial({ color, roughness: .7 }));
    body.position.y = 1.05 * s; body.castShadow = true; body.scale.setScalar(s); g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 18, 14), new THREE.MeshStandardMaterial({ color: '#e8c9a8', roughness: .8 }));
    head.position.y = 1.75 * s; head.castShadow = true; g.add(head);
    g.userData = { kind: 'char', name };
    addObj(g, 0, -1); SB.sel = g; window.__hl(g); if (window.syncSel) syncSel();
    log('personagem criado: ' + name);
  };

  /* ambiente */
  $x('x-env').onclick = () => {
    const k = (prompt('Ambiente: 1 deserto, 2 noite, 3 interior', '1') || '1').trim();
    const E = {
      1: { g: '#c97b46', sky: ['#2b3a55', '#c98a5b', '#f2c078'], fog: '#c98a5b', sun: true },
      2: { g: '#1e2430', sky: ['#05070f', '#1e293b', '#334155'], fog: '#111827', sun: false },
      3: { g: '#6b7280', sky: ['#111827', '#374151', '#9ca3af'], fog: '#374151', sun: false }
    }[k] || null;
    if (!E) return;
    ground.material.color.set(E.g);
    sky.material.uniforms.top.value.set(E.sky[0]);
    sky.material.uniforms.mid.value.set(E.sky[1]);
    sky.material.uniforms.bot.value.set(E.sky[2]);
    scene.fog.color.set(E.fog);
    sun.visible = E.sun;
    log('ambiente alterado');
  };

  /* captura com textos */
  function capturePanel(fmt, withText) {
    renderer.render(scene, camera);
    const w = 1920, h = 1080;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.filter = window.__FILTER || 'none';
    x.drawImage(renderer.domElement, 0, 0, w, h);
    x.filter = 'none';
    if (withText) {
      const grd = x.createLinearGradient(0, h - 320, 0, h);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,.88)');
      x.fillStyle = grd; x.fillRect(0, h - 320, w, 320);
      const title = $x('pTitle').value || '';
      const speak = $x('pSpeak').value || '';
      const act = $x('pAction').value || '';
      const cam = $x('pCam').value || '';
      x.fillStyle = '#fff'; x.font = 'bold 44px Segoe UI,Arial'; x.fillText(title.slice(0, 60), 56, h - 190);
      if (speak) { x.fillStyle = '#fca5a5'; x.font = 'bold 34px Segoe UI,Arial'; x.fillText(speak.slice(0, 90), 56, h - 138); }
      x.fillStyle = '#e5e7eb'; x.font = '28px Segoe UI,Arial';
      if (act) x.fillText(act.slice(0, 110), 56, h - 92);
      x.fillStyle = '#93c5fd'; x.font = '24px Segoe UI,Arial'; x.fillText(cam + ' · HOLD ' + ($x('pHold').value || '10') + 's · ' + ($x('pCut').value || ''), 56, h - 50);
    }
    return c.toDataURL(fmt === 'jpg' ? 'image/jpeg' : 'image/png', .95);
  }

  /* pasta: pergunta na primeira vez */
  async function folder() {
    let f = localStorage.getItem('sb3dFolder') || '';
    if (f) return f;
    try { if (window.forge?.storyboard3dPickFolder) f = await window.forge.storyboard3dPickFolder(); } catch (e) { }
    if (!f) f = prompt('Pasta para salvar o storyboard', 'C:\\Users\\' + (navigator.userAgent ? '' : '') + '') || '';
    if (f) localStorage.setItem('sb3dFolder', f);
    return f;
  }

  $x('btnAll').onclick = async () => {
    if (!SB.shots.length) { log('nenhum painel salvo'); return; }
    const dir = await folder();
    if (!dir) { log('salvamento cancelado'); return; }
    const fmt = $x('x-fmt').value, withText = $x('x-cap').checked;
    const files = [];
    for (let i = 0; i < SB.shots.length; i++) {
      loadState(SB.shots[i]);
      const data = capturePanel(fmt, withText);
      files.push({ name: `${String(i + 1).padStart(4, '0')}.${fmt}`, dataUrl: data });
      files.push({ name: `${String(i + 1).padStart(4, '0')}.json`, text: JSON.stringify({ ...SB.shots[i], thumb: undefined }, null, 2) });
    }
    files.push({ name: 'storyboard.json', text: JSON.stringify({ title: 'Storyboard', dir, shots: SB.shots.map(({ thumb, ...r }) => r) }, null, 2) });
    try {
      if (window.forge?.storyboard3dSave) { const r = await window.forge.storyboard3dSave({ dir, files }); log('salvo em ' + (r?.dir || dir)); }
      else { for (const f of files) { const a = document.createElement('a'); a.href = f.dataUrl || URL.createObjectURL(new Blob([f.text], { type: 'application/json' })); a.download = f.name; a.click(); } log('baixado'); }
    } catch (e) { log('erro ao salvar: ' + e.message); }
  };
  log('extras prontos: criar personagem/ambiente, destaque, PNG/JPG com textos');
})();
