// tools/capture_article.mjs — screenshot a public web page (news article, statement, filing) and locate phrases on it,
// so U.screenshot() can sweep a highlighter over the exact words being read.
//   node tools/capture_article.mjs --url "https://..." --out projects/X/assets/articles/cnn_1.png \
//        --phrases "looked loose when it came back|someone fell off" [--width 1400] [--height 2200] [--scroll-to "first phrase"]
// Writes the PNG plus <out>.json: { src, w, h, boxes:[{phrase, x, y, w, h}] } (image px). Removes cookie banners,
// sticky headers and ads where it can. Log the capture in research/media_log.csv (tools/media_log.py).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = {}; { const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; args[k] = v; } }
if (!args.url || !args.out) { console.error('usage: node tools/capture_article.mjs --url URL --out FILE.png [--phrases "a|b"] [--width 1400] [--height 2200]'); process.exit(1); }
const W = +(args.width || 1400), H = +(args.height || 2200); const phrases = args.phrases ? String(args.phrases).split('|').map((s) => s.trim()).filter(Boolean) : [];
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: W, height: 1000 }, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
try {
  await page.goto(String(args.url), { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(2500);
  // dismiss / remove overlays
  for (const label of ['Accept', 'Accept all', 'I agree', 'Agree', 'OK', 'Got it', 'Continue', 'Close']) { try { const b = page.getByRole('button', { name: label, exact: false }).first(); if (await b.isVisible({ timeout: 300 })) await b.click({ timeout: 800 }); } catch {} }
  await page.evaluate(() => { for (const el of [...document.querySelectorAll('body *')]) { const cs = getComputedStyle(el); if ((cs.position === 'fixed' || cs.position === 'sticky') && el.getBoundingClientRect().height < innerHeight * 0.9) el.style.setProperty('display', 'none', 'important'); }
    for (const sel of ['[id*=cookie]', '[class*=cookie]', '[class*=consent]', '[id*=consent]', '[class*=paywall]', 'iframe', '[class*=ad-]', '[id*=google_ads]']) document.querySelectorAll(sel).forEach((e) => e.remove()); });
  // scroll so the first phrase sits ~35% down the capture
  const first = args['scroll-to'] || phrases[0];
  const y0 = first ? await page.evaluate((ph) => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.textContent.indexOf(ph); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + Math.min(ph.length, n.textContent.length - i)); return r.getBoundingClientRect().top + scrollY; } } return 0; }, first) : 0;
  const top = Math.max(0, Math.round(y0 - H * 0.35));
  await page.setViewportSize({ width: W, height: H }); await page.evaluate((t) => scrollTo(0, t), top); await page.waitForTimeout(800);
  const boxes = await page.evaluate((phs) => { const out = []; for (const ph of phs) { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n, found = false;
    while ((n = w.nextNode()) && !found) { const i = n.textContent.indexOf(ph); if (i < 0) continue; const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + ph.length);
      for (const rc of r.getClientRects()) if (rc.width > 2) out.push({ phrase: ph, x: Math.round(rc.left), y: Math.round(rc.top), w: Math.round(rc.width), h: Math.round(rc.height) }); found = true; }
    if (!found) out.push({ phrase: ph, missing: true }); } return out; }, phrases);
  fs.mkdirSync(path.dirname(path.resolve(String(args.out))), { recursive: true });
  await page.screenshot({ path: String(args.out), clip: { x: 0, y: 0, width: W, height: H } });
  const rel = String(args.out).replace(/\\/g, '/'); const ai = rel.lastIndexOf('assets/'); const meta = { src: ai >= 0 ? '/project/' + rel.slice(ai) : rel, url: String(args.url), captured: new Date().toISOString(), w: W, h: H, boxes };
  fs.writeFileSync(String(args.out) + '.json', JSON.stringify(meta, null, 1));
  const miss = boxes.filter((b) => b.missing).map((b) => b.phrase);
  console.log(`captured ${args.out} (${W}x${H}); ${boxes.filter((b) => !b.missing).length} highlight box(es)${miss.length ? '; NOT FOUND: ' + miss.join(' | ') : ''}`);
  console.log(`In a shot: const m = ${JSON.stringify({ src: meta.src, w: W, h: H })}; U.screenshot({ ...m, boxes: <boxes from ${String(args.out)}.json with at: info.w('<word>')> })`);
} catch (e) { console.error('capture failed:', e.message, '\nIf the site blocks automated browsers, open it in Chrome, take the screenshot manually, or re-typeset the quote with U.article().'); process.exitCode = 1; }
finally { await browser.close(); }
