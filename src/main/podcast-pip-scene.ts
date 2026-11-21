/**
 * Cena determinística do Podcast 16:9 — o app monta o HTML, não o LLM.
 * Fundo = imagem gerada no Flow (frame.png) com zoom lento; sobre ela, o vídeo
 * original do podcast em PiP no canto pedido (quadro fixo); em cenas marcadas
 * TELA_CHEIA, o vídeo ocupa 100% sem zoom por 10-25 s e volta ao PiP.
 */

export interface PipSceneOpts {
  duration: number; fps?: number; aspect?: '9:16' | '16:9';
  pipCorner?: 'bl' | 'br' | 'tl' | 'tr'; pipWidth?: number;
  fullscreen?: { start: number; end: number };
  videoSrc?: string; frameSrc?: string;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');

/** HTML completo de uma cena de podcast com PiP. Função pura. */
export function podcastPipScene(o: PipSceneOpts): string {
  const dur = Math.max(1, Number(o.duration) || 8);
  const fps = Math.max(1, Math.round(o.fps || 30));
  const vertical = o.aspect === '9:16';
  const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080;
  const pw = Math.min(0.45, Math.max(0.15, o.pipWidth ?? 0.25));
  const corner = o.pipCorner || 'bl';
  const video = esc(o.videoSrc || 'web/podcast.mp4');
  const frame = esc(o.frameSrc || '../frames/frame.png');
  const fs = o.fullscreen && o.fullscreen.end > o.fullscreen.start
    ? { s: Math.max(0, o.fullscreen.start), e: Math.min(dur, o.fullscreen.end) }
    : undefined;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}
#c{display:block;width:100vw;height:100vh;object-fit:contain}
#v{position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;opacity:0;pointer-events:none}
</style></head><body><canvas id="c" width="${W}" height="${H}"></canvas>
<video id="v" src="${video}" preload="auto" muted playsinline></video><script>
(function(){
'use strict';
var W=${W},H=${H},DUR=${dur},FPS=${fps};
var PW=${pw}, CORNER='${corner}';
var FS=${fs ? `{s:${fs.s},e:${fs.e}}` : 'null'};
var c=document.getElementById('c'),ctx=c.getContext('2d',{alpha:false});
var v=document.getElementById('v');
var img=new Image(); img.src='${frame}';
var ready=false;
function clamp(x,a,b){return x<a?a:(x>b?b:x)}
function smooth(a,b,t){var u=clamp((t-a)/(b-a),0,1);return u*u*(3-2*u)}
function cover(im,x,y,w,h){var iw=im.naturalWidth,ih=im.naturalHeight;if(!iw||!ih)return;var s=Math.max(w/iw,h/ih),dw=iw*s,dh=ih*s;ctx.drawImage(im,x+(w-dw)/2,y+(h-dh)/2,dw,dh)}
function rr(x,y,w,h,r){r=Math.max(0,Math.min(r,w/2,h/2));ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath()}
function pipRect(){var w=Math.round(W*PW),h=Math.round(w*9/16),m=Math.round(W*0.045);
  var x=(CORNER==='br'||CORNER==='tr')?W-m-w:m;
  var y=(CORNER==='tl'||CORNER==='tr')?m:H-m-h;
  return {x:x,y:y,w:w,h:h}}
function pipAlpha(t){ if(!FS) return 0; return smooth(FS.s-0.15,FS.s,t)*(1-smooth(FS.e,FS.e+0.15,t)); }
function draw(t){
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);
  /* fundo: imagem do assunto com ZOOM LENTO (Ken Burns) */
  if(img.complete&&img.naturalWidth>0){var z=1+0.10*clamp(t/DUR,0,1);cover(img,W*(1-z)/2,H*(1-z)/2,W*z,H*z)}
  else {ctx.fillStyle='#0b0b0b';ctx.fillRect(0,0,W,H)}
  var a=pipAlpha(t), vr=pipRect();
  var vx=a>0?vr.x+(0-vr.x)*a:vr.x, vy=a>0?vr.y+(0-vr.y)*a:vr.y;
  var vw=a>0?vr.w+(W-vr.w)*a:vr.w, vh=a>0?vr.h+(H-vr.h)*a:vr.h;
  var vok=v.readyState>=2&&v.videoWidth>0;
  ctx.save();ctx.shadowColor='rgba(0,0,0,.75)';ctx.shadowBlur=26;ctx.fillStyle='#06090e';
  rr(vx,vy,vw,vh,a>0.5?0:18);ctx.fill();ctx.restore();
  if(vok){ctx.save();rr(vx,vy,vw,vh,a>0.5?0:18);ctx.clip();cover(v,vx,vy,vw,vh);ctx.restore()}
  ctx.save();rr(vx+.5,vy+.5,vw-1,vh-1,a>0.5?0:18);ctx.strokeStyle='rgba(230,238,246,.6)';ctx.lineWidth=2;ctx.stroke();ctx.restore();
}
function sync(t){ try{v.pause()}catch(e){}
  var target=clamp(t,0,DUR);
  if(v.readyState<1||Math.abs(v.currentTime-target)>0.0009){
    return new Promise(function(res){var done=false;function fin(){if(done)return;done=true;v.removeEventListener('seeked',fin);draw(t);res()}
      v.addEventListener('seeked',fin);try{v.currentTime=target}catch(e){fin()}setTimeout(fin,1200)});
  }
  draw(t);return Promise.resolve();
}
window.__forge={duration:DUR,fps:FPS,seek:function(t){draw(t);return sync(t)},pause:function(){try{v.pause()}catch(e){}},sfx:[]};
img.addEventListener('load',function(){draw(0)});
})();
</script></body></html>`;
}
