/* teste automatico: 3 paineis com bonecos articulados, poses e objeto novo */
(function () {
  if (!location.search.includes('demo')) return;
  document.body.classList.add('clean');
  setTimeout(() => {
    const A = window.__makeRig('Marlok', '#5f7f3e');
    const B = window.__makeRig('Kyra', '#8b5cf6');
    addObj(A, -1.6, 0); addObj(B, 1.6, 0);
    addObj(makeRock(1.3), 0, -3.5);
    addObj(makeCactus(), 3.6, -1.5);
    const jt = (g, n) => { let r = null; g.traverse((o) => { if (o.name === n) r = o; }); return r; };
    jt(A, 'shoulderL').rotation.z = -1.1; jt(A, 'shoulderR').rotation.z = .7;
    jt(A, 'elbowL').rotation.x = -.6; jt(A, 'kneeR').rotation.x = .5; const nkA = jt(A, 'neck'); if (nkA) nkA.rotation.z = .15;
    jt(B, 'shoulderR').rotation.z = -1.3; jt(B, 'elbowR').rotation.x = -.9; jt(B, 'hipL').rotation.x = .35;
    const Q = new URLSearchParams(location.search);
    const shots = [
      { t: 'Plano 1 — os dois no deserto', s: 'Marlok: We are not alone.', a: 'Marlok e Kyra olham para a aranha.', cam: 'CAM-01 · aberto', theta: .7, phi: 1.2, r: 8, light: 'dourado' },
      { t: 'Plano 2 — Marlok aponta', s: 'Marlok: You need to stop the danger!', a: 'Marlok levanta o braço e aponta.', cam: 'CAM-02 · médio', theta: -.1, phi: 1.3, r: 4.6, light: 'contra-luz' },
      { t: 'Plano 3 — Kyra responde', s: "Kyra: I don't owe nothing!", a: 'Kyra cruza os braços, desafiante.', cam: 'CAM-02 · close', theta: .2, phi: 1.4, r: 3.2, light: 'azul-noite' }
    ];
    const sh = shots[Math.max(0, Math.min(2, Number(Q.get('shot') || 1) - 1))];
    $('pTitle').value = sh.t; $('pSpeak').value = sh.s; $('pAction').value = sh.a; $('pCam').value = sh.cam;
    $('pPrompt').value = 'photorealistic live-action desert epic, articulated characters, 35mm';
    $('lightPreset').value = sh.light; applyLight(sh.light);
    orbit.target.set(sh.id === 3 ? 1.6 : 0, 1.5, 0); orbit.theta = sh.theta; orbit.phi = sh.phi; orbit.r = sh.r;
    applyShot(sh.id === 3 ? 'close' : 'aberto'); camera.updateProjectionMatrix(); updateCam();
    renderer.render(scene, camera);
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
    const x = c.getContext('2d'); x.drawImage(renderer.domElement, 0, 0, 1920, 1080);
    const g = x.createLinearGradient(0, 780, 0, 1080); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.9)');
    x.fillStyle = g; x.fillRect(0, 780, 1920, 300);
    x.fillStyle = '#fff'; x.font = 'bold 44px Segoe UI'; x.fillText(sh.t, 56, 940);
    x.fillStyle = '#fca5a5'; x.font = 'bold 34px Segoe UI'; x.fillText(sh.s, 56, 990);
    x.fillStyle = '#93c5fd'; x.font = '26px Segoe UI'; x.fillText(sh.a + ' · ' + sh.cam, 56, 1035);
    const img = document.createElement('img'); img.src = c.toDataURL('image/png');
    img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:cover;z-index:9';
    document.body.appendChild(img);
  }, 250);
})();
