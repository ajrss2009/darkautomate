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
  /** segundo do trecho original (web/podcast.mp4) em que esta cena começa: a PiP mostra a mesma fala que se ouve */
  videoStart?: number;
}

type PodScene = { id: string; durationSec?: number; clipStart?: number; notes?: string; narration?: string; title?: string; camera?: string };

/**
 * Onde cada cena começa no trecho original. As cenas são blocos CONTÍGUOS do trecho baixado,
 * então o início é a soma das durações anteriores — a não ser que o plano tenha dado clipStart.
 * A voz (recortada do mesmo ponto) e a PiP usam este número: a boca bate com o som.
 */
export function podcastOffsets(scenes: PodScene[]): Map<string, number> {
  const out = new Map<string, number>();
  let acc = 0;
  for (const s of scenes) {
    const start = Number.isFinite(Number(s.clipStart)) && s.clipStart !== undefined && Number(s.clipStart) >= 0 ? Number(s.clipStart) : acc;
    out.set(s.id, Math.round(start * 1000) / 1000);
    acc = start + Math.max(0, Number(s.durationSec) || 0);
  }
  return out;
}

export interface PodBlock { start: number; end: number; text: string }

/**
 * Blocos de 6-12 s da fala REAL do trecho (palavras do Whisper), fechando no fim de frase ou numa
 * pausa. São contíguos a partir do 0 do trecho: somados cobrem o áudio inteiro, sem buracos.
 */
export function podcastBlocks(words: Array<{ w: string; start: number; end: number }>, min = 6, max = 12): PodBlock[] {
  const out: PodBlock[] = [];
  let start = 0, buf: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!, next = words[i + 1];
    buf.push(w.w.trim());
    const dur = w.end - start;
    const sentence = /[.?!…]["”']?$/.test(w.w.trim());
    const pause = next ? next.start - w.end : 99;
    const tooLong = next ? next.end - start > max : false;
    if (!next || (dur >= min && (sentence || pause >= 0.6)) || tooLong) {
      /* o corte cai no meio da pausa: o bloco seguinte começa antes da primeira palavra dele */
      const end = next ? Math.round(((w.end + next.start) / 2) * 1000) / 1000 : Math.round(w.end * 1000) / 1000;
      out.push({ start, end, text: buf.join(' ').replace(/\s+/g, ' ').trim() });
      start = end; buf = [];
    }
  }
  /* último bloco curto demais: junta ao anterior */
  if (out.length > 1 && out[out.length - 1]!.end - out[out.length - 1]!.start < min / 2) {
    const last = out.pop()!;
    const prev = out[out.length - 1]!;
    out[out.length - 1] = { start: prev.start, end: last.end, text: `${prev.text} ${last.text}` };
  }
  return out;
}

/** Transcrição em blocos para o roteiro/plano lerem (web/podcast.transcript.md). Função pura. */
export function blocksMarkdown(blocks: PodBlock[]): string {
  return ['# Fala real do trecho (Whisper), em blocos contíguos de 6-12 s', '',
    'Use estes blocos EXATAMENTE: uma cena por bloco, FALA = o texto do bloco, TEMPO = fim − início. Não reescreva a fala.', '',
    ...blocks.map((b, i) => `${i + 1}. [${b.start.toFixed(2)}s–${b.end.toFixed(2)}s · ${(b.end - b.start).toFixed(1)} s] ${b.text}`)].join('\n');
}

/**
 * Encaixa as cenas do plano na fala real: cada cena recebe início (clipStart), duração e narração do
 * trecho. Mesmo número de cenas e blocos = 1 para 1; senão os cortes do plano (proporção das durações)
 * vão para a fronteira de bloco mais próxima. Muda as cenas no lugar; devolve quantas mudaram.
 */
export function alignPodcastScenes(scenes: Array<PodScene & { narration?: string; manualDuration?: boolean }>, blocks: PodBlock[]): number {
  if (!scenes.length || !blocks.length) return 0;
  const groups: PodBlock[][] = [];
  if (scenes.length === blocks.length) blocks.forEach((b) => groups.push([b]));
  else {
    const total = blocks[blocks.length - 1]!.end;
    const planned = scenes.map((s) => Math.max(0.5, Number(s.durationSec) || 8));
    const sum = planned.reduce((a, x) => a + x, 0);
    let acc = 0, bi = 0;
    for (let i = 0; i < scenes.length; i++) {
      acc += planned[i]! / sum * total;
      const g: PodBlock[] = [];
      const left = scenes.length - i - 1;
      /* pega blocos até passar do corte proporcional, deixando pelo menos um bloco por cena restante */
      while (bi < blocks.length - left && (g.length === 0 || i === scenes.length - 1 || Math.abs(blocks[bi]!.end - acc) < Math.abs(g[g.length - 1]!.end - acc))) g.push(blocks[bi++]!);
      groups.push(g);
    }
  }
  let n = 0;
  scenes.forEach((s, i) => {
    const g = groups[i];
    if (!g?.length) return;
    const start = g[0]!.start, end = g[g.length - 1]!.end;
    const text = g.map((b) => b.text).join(' ');
    if (s.clipStart !== start || s.durationSec !== Math.round((end - start) * 1000) / 1000 || s.narration !== text) n++;
    s.clipStart = start;
    s.durationSec = Math.round((end - start) * 1000) / 1000;
    s.narration = text;
    s.manualDuration = true;
  });
  return n;
}

/* curiosidade e tensão na fala: pergunta, exclamação, revelação, perigo, segredo, virada */
const TENSION = /\?|!|segred|mist[ée]ri|medo|mort[eo]|morr|verdade|ningu[ée]m|nunca|descobr|de repente|perig|amea[cç]|proib|escondid|revel|choc|terr[íi]vel|assust|sangue|crime|culpa|estranh|impossível|inacredit|ninguem|jamais|ningu|escuro|sombr|grit|sil[êe]ncio|o pior|a verdade|ent[ãa]o (eu|ele|ela)|foi a[ií] que|imagina|sabe o que/gi;
const FS_MARK = /TELA[_ ]CHEIA|FULL[_ ]?SCREEN/i;

/** Quanto a fala da cena prende a atenção (função pura, usada só quando o plano não marcou nada). */
export function tensionScore(s: Pick<PodScene, 'narration' | 'title' | 'camera'>): number {
  const text = [s.narration, s.title].filter(Boolean).join(' ');
  return (text.match(TENSION) ?? []).length + (/full screen|tela cheia/i.test(s.camera ?? '') ? 2 : 0);
}

/**
 * Cenas em que o vídeo original vai a TELA CHEIA: as que o plano marcou (TELA_CHEIA) ou, se ele não
 * marcou nenhuma, o momento de maior curiosidade/tensão da fala, estendido às cenas vizinhas até
 * ~25 s. Nunca passa de metade do vídeo e nunca é a primeira cena (o gancho mostra a imagem).
 */
export function fullscreenScenes(scenes: PodScene[], maxSec = 25): Set<string> {
  const marked = scenes.filter((s) => FS_MARK.test(s.notes ?? ''));
  if (marked.length) return new Set(marked.map((s) => s.id));
  if (scenes.length < 3) return new Set();
  const total = scenes.reduce((a, s) => a + (Number(s.durationSec) || 0), 0);
  const limit = Math.min(maxSec, total / 2);
  const scores = scenes.map(tensionScore);
  let best = -1;
  for (let i = 1; i < scenes.length; i++) if (best < 0 || scores[i]! > scores[best]!) best = i;
  if (best < 0 || scores[best]! <= 0) best = Math.max(1, Math.round(scenes.length * 0.6) - 1);
  const pick = new Set<number>([best]);
  let used = Number(scenes[best]!.durationSec) || 0;
  for (;;) {
    const lo = Math.min(...pick) - 1, hi = Math.max(...pick) + 1;
    const cand = [lo, hi].filter((i) => i >= 1 && i < scenes.length).sort((a, b) => scores[b]! - scores[a]!);
    const next = cand.find((i) => used + (Number(scenes[i]!.durationSec) || 0) <= limit);
    if (next === undefined || used >= 10 && scores[next]! <= 0) break;
    pick.add(next); used += Number(scenes[next]!.durationSec) || 0;
  }
  return new Set([...pick].map((i) => scenes[i]!.id));
}

/** Janela de tela cheia dentro da cena: cenas vizinhas em tela cheia emendam sem voltar ao PiP. */
export function fullscreenWindow(dur: number, prevFull: boolean, nextFull: boolean): { start: number; end: number } {
  const ramp = Math.min(0.4, dur / 4);
  return { start: prevFull ? 0 : ramp, end: nextFull ? dur + 1 : dur - ramp };
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
  /* fim depois da cena = continua em tela cheia na próxima (sem a rampa de volta ao PiP) */
  const fs = o.fullscreen && o.fullscreen.end > o.fullscreen.start && o.fullscreen.start < dur
    ? { s: Math.max(0, o.fullscreen.start), e: o.fullscreen.end > dur ? dur + 1 : o.fullscreen.end }
    : undefined;
  const vstart = Math.max(0, Number(o.videoStart) || 0);

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}
#c{display:block;width:100vw;height:100vh;object-fit:contain}
#v{position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;opacity:0;pointer-events:none}
</style></head><body><canvas id="c" width="${W}" height="${H}"></canvas>
<video id="v" src="${video}" preload="auto" muted playsinline></video><script>
(function(){
'use strict';
var W=${W},H=${H},DUR=${dur},FPS=${fps},VSTART=${vstart};
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
  /* velocidade constante (~0,8%/s, teto 8%): cena curta não ganha zoom mais rápido que a longa */
  if(img.complete&&img.naturalWidth>0){var z=1+Math.min(0.08,0.008*clamp(t,0,DUR));cover(img,W*(1-z)/2,H*(1-z)/2,W*z,H*z)}
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
  var target=VSTART+clamp(t,0,DUR);
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
