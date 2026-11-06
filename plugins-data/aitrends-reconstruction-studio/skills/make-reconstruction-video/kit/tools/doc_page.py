"""tools/doc_page.py — render one PDF page (court filing, patent, report) to PNG and find phrases on it for highlights.

  python tools/doc_page.py --pdf projects/X/assets/docs/report.pdf --page 4 --phrases "a phrase|another" --out projects/X/assets/docs/report_p4.png [--dpi 150]

Needs PyMuPDF (pip install pymupdf). Writes the PNG and <out>.json {src, w, h, boxes:[{phrase,x,y,w,h}]} in image px,
ready for U.screenshot(). Scanned PDFs without a text layer won't find phrases: add boxes by hand from the PNG.
"""
import argparse, json, os, sys

ap = argparse.ArgumentParser(); ap.add_argument("--pdf", required=True); ap.add_argument("--page", type=int, default=1); ap.add_argument("--phrases", default="")
ap.add_argument("--out", required=True); ap.add_argument("--dpi", type=int, default=150)
a = ap.parse_args()
try:
    import fitz
except ImportError:
    sys.exit("PyMuPDF is not installed: python -m pip install pymupdf")
doc = fitz.open(a.pdf); pg = doc[a.page - 1]; z = a.dpi / 72
pix = pg.get_pixmap(matrix=fitz.Matrix(z, z)); os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True); pix.save(a.out)
boxes = []
for ph in [p.strip() for p in a.phrases.split("|") if p.strip()]:
    rects = pg.search_for(ph)
    if not rects: boxes.append({"phrase": ph, "missing": True})
    for r in rects: boxes.append({"phrase": ph, "x": round(r.x0 * z), "y": round(r.y0 * z), "w": round((r.x1 - r.x0) * z), "h": round((r.y1 - r.y0) * z)})
rel = a.out.replace("\\", "/"); ai = rel.rfind("assets/")
json.dump({"src": ("/project/" + rel[ai:]) if ai >= 0 else rel, "w": pix.width, "h": pix.height, "page": a.page, "boxes": boxes}, open(a.out + ".json", "w"), indent=1)
print(f"rendered page {a.page} -> {a.out} ({pix.width}x{pix.height}); {sum(1 for b in boxes if not b.get('missing'))} box(es)" + ("; NOT FOUND: " + ", ".join(b["phrase"] for b in boxes if b.get("missing")) if any(b.get("missing") for b in boxes) else ""))
